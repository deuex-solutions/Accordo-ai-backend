/**
 * Conversation Service
 *
 * Main orchestrator for CONVERSATION mode negotiation.
 * Processes vendor messages through the full pipeline:
 * 1. Validate deal and permissions
 * 2. Parse vendor offer
 * 3. Get decision from engine (deterministic — unchanged)
 * 4. Classify intent
 * 5. Build NegotiationIntent (hard boundary — no commercial data leaks to LLM)
 * 6. Render response via personaRenderer (LLM as language renderer only)
 * 7. Validate LLM output (untrusted — enforce price and word rules)
 * 8. Simulate typing delay + trigger frontend indicator
 * 9. Update conversation state
 * 10. Save messages and deal state
 */

import { v4 as uuidv4 } from "uuid";
import { Op } from "sequelize";
import { CustomError } from "../../../utils/custom-error.js";
import logger from "../../../config/logger.js";
import models from "../../../models/index.js";
import { parseOfferRegex } from "../engine/parse-offer.js";
import {
  decideNextMove,
  extractVendorMaxTermsDays,
  capTermsToVendorMax,
} from "../engine/decide.js";
import { computeExplainability } from "../engine/utility.js";
import {
  resolveNegotiationConfig,
  calculateWeightedUtilityFromResolved,
} from "../engine/weighted-utility.js";
import { buildConfigFromRequisition } from "../chatbot.service.js";
import type { NegotiationConfig } from "../engine/utility.js";
import type {
  Offer,
  Decision,
  Explainability,
  ExtendedOffer,
} from "../engine/types.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import type { ChatbotMessage } from "../../../models/chatbot-message.js";
import type {
  ConversationState,
  ProcessConversationMessageInput,
  ProcessConversationMessageResult,
} from "./types.js";
import {
  initializeConversationState,
  detectVendorPreference,
  classifyRefusal,
  mergeWithLastOffer,
  determineIntent,
  updateConversationState,
  shouldAutoStartConversation,
  getDefaultGreeting,
} from "./conversation-manager.js";
import {
  detectVendorTone,
  detectStrictFirmness,
  detectVendorStyle,
  type VendorStyle,
} from "../engine/tone-detector.js";
import { recordPhrasing, getPhrasings } from "../../../llm/phrasing-history.js";
import { buildNegotiationIntent } from "../../../negotiation/intent/build-negotiation-intent.js";
import { renderNegotiationMessage } from "../../../llm/persona-renderer.js";
import {
  validateLlmOutput,
  ValidationError,
} from "../../../llm/validate-llm-output.js";
import { getFallbackResponse } from "../../../llm/fallback-templates.js";
import { simulateTypingDelay } from "../../../delivery/simulate-typing-delay.js";
import { logNegotiationStep } from "../../../metrics/log-negotiation-step.js";
import {
  transition,
  actionToEvent,
  type DealState,
} from "../engine/negotiation-state-machine.js";
import {
  generateMesoOptions,
  shouldUseMeso,
  buildPreferenceProfile,
  type MesoResult,
  type MesoOption,
  MESO_PHASE_CONFIG,
} from "../engine/meso.js";
import { resolveNegotiationConfig as resolveMesoConfig } from "../engine/weighted-utility.js";
import type {
  MesoCycleState,
  FinalOfferState,
  NegotiationState,
  ExtendedOffer as EngineExtendedOffer,
} from "../engine/types.js";
import type { SupportedCurrency } from "../../../services/currency.service.js";

/**
 * Start a new conversation
 *
 * Initializes conversation state and sends automatic greeting message.
 * Should be called once when conversation mode is first accessed.
 */
export async function startConversation(
  dealId: string,
  userId: number,
): Promise<ProcessConversationMessageResult> {
  try {
    logger.info("[ConversationService] Starting conversation", {
      dealId,
      userId,
    });

    // 1. Validate deal
    const deal = (await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.ChatbotMessage, as: "Messages" },
        { model: models.Contract, as: "Contract" },
      ],
    })) as ChatbotDeal & { Messages?: ChatbotMessage[] };

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Only deal creator can start conversation
    if (deal.userId !== userId) {
      throw new CustomError(
        "Unauthorized: Only deal creator can start conversation",
        403,
      );
    }

    // Conversation mode only
    if (deal.mode !== "CONVERSATION") {
      throw new CustomError(
        "This operation is only available in CONVERSATION mode",
        400,
      );
    }

    // Check if already started
    const messageCount = deal.Messages?.length || 0;
    if (messageCount > 0) {
      return {
        success: true,
        message: "Conversation already started",
        data: {
          accordoMessage: deal.Messages![deal.Messages!.length - 1] as any,
          conversationState:
            (deal.convoStateJson as ConversationState) ||
            initializeConversationState(),
          revealAvailable: false,
          dealStatus: deal.status,
        },
      };
    }

    // 2. Initialize conversation state
    const initialState = initializeConversationState();
    deal.convoStateJson = initialState as any;
    await deal.save();

    // 3. Send automatic greeting
    const greeting = getDefaultGreeting();
    const greetingMessage = await models.ChatbotMessage.create({
      id: uuidv4(),
      dealId: deal.id,
      role: "ACCORDO",
      content: greeting,
      extractedOffer: null,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
      createdAt: new Date(),
    });

    // 4. Update deal
    deal.round = 0;
    deal.lastMessageAt = new Date();
    await deal.save();

    logger.info("[ConversationService] Conversation started successfully", {
      dealId,
      messageId: greetingMessage.id,
    });

    return {
      success: true,
      message: "Conversation started successfully",
      data: {
        accordoMessage: greetingMessage as any,
        conversationState: initialState,
        revealAvailable: false,
        dealStatus: deal.status,
      },
    };
  } catch (error) {
    logger.error("[ConversationService] Failed to start conversation", {
      dealId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(`Failed to start conversation: ${error}`, 500);
  }
}

/**
 * Process a vendor message in conversation mode
 *
 * Full pipeline:
 * 1. Validate deal and permissions
 * 2. Check for refusal
 * 3. Parse vendor offer
 * 4. Merge with last offer if incomplete
 * 5. Get decision from engine
 * 6. Detect vendor preference
 * 7. Determine conversation intent
 * 8. Generate LLM reply
 * 9. Update conversation state
 * 10. Save vendor message
 * 11. Save Accordo reply
 * 12. Update deal state
 */
export async function processConversationMessage(
  input: ProcessConversationMessageInput,
): Promise<ProcessConversationMessageResult> {
  const { dealId, vendorMessage, userId } = input;

  try {
    logger.info("[ConversationService] Processing message", {
      dealId,
      userId,
      messageLength: vendorMessage.length,
    });

    // 1. Validate deal
    const deal = (await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.ChatbotMessage, as: "Messages" },
        { model: models.Contract, as: "Contract" },
        { model: models.Requisition, as: "Requisition" },
      ],
    })) as ChatbotDeal & { Messages?: ChatbotMessage[] };

    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Only deal creator can send messages
    if (deal.userId !== userId) {
      throw new CustomError(
        "Unauthorized: Only deal creator can send messages",
        403,
      );
    }

    // Conversation mode only
    if (deal.mode !== "CONVERSATION") {
      throw new CustomError(
        "This operation is only available in CONVERSATION mode",
        400,
      );
    }

    // Cannot modify terminal deals
    if (deal.status !== "NEGOTIATING") {
      throw new CustomError(
        `Cannot send messages to a deal with status: ${deal.status}`,
        400,
      );
    }

    // 2. Get conversation state
    let conversationState =
      (deal.convoStateJson as ConversationState) ||
      initializeConversationState();

    // 3. Get negotiation config - CRITICAL: Use stored config to preserve priority-based thresholds
    let config: NegotiationConfig;
    if (deal.negotiationConfigJson) {
      // Use stored negotiation config from deal (includes priority-adjusted thresholds and weights)
      const storedConfig = deal.negotiationConfigJson as NegotiationConfig & {
        wizardConfig?: unknown;
      };
      config = {
        parameters: storedConfig.parameters,
        accept_threshold: storedConfig.accept_threshold,
        escalate_threshold: storedConfig.escalate_threshold,
        walkaway_threshold: storedConfig.walkaway_threshold,
        max_rounds: storedConfig.max_rounds,
        priority: storedConfig.priority,
        currency: storedConfig.currency,
      };
    } else if (deal.requisitionId) {
      // Fallback to building from requisition (for legacy deals without stored config)
      config = await buildConfigFromRequisition(deal.requisitionId);
    } else {
      throw new CustomError(
        "Deal must be linked to a requisition for negotiation config",
        400,
      );
    }

    // Backfill currency from requisition for legacy deals that don't have it in stored config
    const requisition = (deal as any).Requisition;
    if (!config.currency && requisition?.typeOfCurrency) {
      config.currency = requisition.typeOfCurrency as string;
    }

    // 4. Check for refusal
    const refusalType = classifyRefusal(vendorMessage);

    // 5. Parse vendor offer (with currency conversion if requisition has different currency)
    // Get requisition currency for proper conversion (February 2026)
    const requisitionCurrency = requisition?.typeOfCurrency as
      | "USD"
      | "INR"
      | "EUR"
      | "GBP"
      | "AUD"
      | undefined;
    let parsedOffer = parseOfferRegex(vendorMessage, requisitionCurrency);

    // 5-pre. Affirmative-acceptance fast path.
    // If vendor sends a short acceptance phrase ("agree", "i accept", "deal", "ok", etc.)
    // AND we have an active PM counter on the table (deal.latestOfferJson),
    // treat it as ACCEPT of the PM's last counter. This prevents the bot from
    // re-running utility scoring and accidentally generating yet another counter.
    const AFFIRMATIVE_PATTERN =
      /^\s*(ok|okay|sure|agreed|agree|deal|yes|yeah|yep|accept|accepted|i\s+accept(\s+the\s+offer)?|we\s+accept|i\s+agree|we\s+agree|yes\s+i\s+agree|yes\s+i\s+accept|confirm|confirmed|sounds\s+good|looks\s+good|that\s+works|works\s+for\s+me|perfect|fine|great|done|alright|alright\s+then|absolutely|of\s+course|let'?s\s+do\s+it)\s*[.!]?\s*$/i;
    const previousPmCounter =
      (deal.latestOfferJson as {
        total_price?: number;
        payment_terms?: string;
        payment_terms_days?: number | null;
        delivery_date?: string | null;
        delivery_days?: number | null;
      } | null) ?? null;
    const isVendorAffirmative =
      AFFIRMATIVE_PATTERN.test(vendorMessage.trim()) &&
      previousPmCounter?.total_price != null;
    if (isVendorAffirmative && previousPmCounter) {
      logger.info(
        `[ConversationService] Affirmative message detected ("${vendorMessage.trim()}") — forcing ACCEPT on PM's last counter`,
        { dealId, pmCounter: previousPmCounter },
      );
      // Rewrite parsedOffer to mirror the PM counter so downstream logic sees a
      // "complete" offer matching what the vendor is agreeing to.
      parsedOffer = {
        total_price: previousPmCounter.total_price ?? null,
        payment_terms: previousPmCounter.payment_terms ?? null,
        payment_terms_days: previousPmCounter.payment_terms_days ?? null,
        delivery_date: previousPmCounter.delivery_date ?? null,
        delivery_days: previousPmCounter.delivery_days ?? null,
      };
    }

    // 5b. Payment terms interception: if vendor sent a price but no terms,
    // ask for terms instead of merging with old terms and making a decision.
    // This ensures the vendor explicitly states their terms for each new price.
    const hasPriceInCurrentMsg = parsedOffer.total_price !== null;
    const termsMissingInCurrentMsg =
      parsedOffer.payment_terms == null &&
      parsedOffer.payment_terms_days == null;

    if (hasPriceInCurrentMsg && termsMissingInCurrentMsg) {
      logger.info(
        "[ConversationService] Price without terms — asking for payment terms",
        {
          dealId,
          price: parsedOffer.total_price,
        },
      );

      // Save vendor message
      const vendorMsgRecord = await models.ChatbotMessage.create({
        id: uuidv4(),
        dealId: deal.id,
        role: "VENDOR",
        content: vendorMessage,
        extractedOffer: parsedOffer as any,
        engineDecision: null,
        decisionAction: null,
        utilityScore: null,
        counterOffer: null,
        explainabilityJson: null,
        createdAt: new Date(),
      });

      // Generate LLM-rendered "ask for terms" message
      const termsAskIntent = buildNegotiationIntent({
        action: "ASK_CLARIFY",
        utilityScore: 0,
        counterPrice: null,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal",
        currencyCode: (config.currency as string) || "USD",
      });

      const personaCtx = {
        dealTitle: deal.title ?? undefined,
        vendorName: (deal as any).Vendor?.name ?? undefined,
        productCategory: (deal as any).Requisition?.title ?? undefined,
      };

      let termsAskContent: string;
      try {
        const renderResult = await renderNegotiationMessage(
          termsAskIntent,
          vendorMessage,
          personaCtx,
        );
        termsAskContent = validateLlmOutput(
          renderResult.message,
          termsAskIntent,
        );
      } catch {
        termsAskContent = `Thanks for the price. Could you share your preferred payment terms?`;
      }

      const accordoMsgRecord = await models.ChatbotMessage.create({
        id: uuidv4(),
        dealId: deal.id,
        role: "ACCORDO",
        content: termsAskContent,
        extractedOffer: null,
        engineDecision: {
          action: "ASK_CLARIFY",
          pendingPrompt: { type: "payment_terms" },
        } as any,
        decisionAction: "ASK_CLARIFY",
        utilityScore: null,
        counterOffer: null,
        explainabilityJson: null,
        createdAt: new Date(),
      });

      // Update conversation state with the price (but not terms)
      const updatedState = updateConversationState(
        conversationState,
        "ASK_FOR_OFFER" as any,
        {
          action: "ASK_CLARIFY",
          utilityScore: 0,
          counterOffer: null,
          reasons: ["Awaiting payment terms"],
        },
        parsedOffer,
        conversationState.detectedPreference,
      );

      deal.lastMessageAt = new Date();
      deal.convoStateJson = updatedState as any;
      deal.latestVendorOffer = parsedOffer as any;
      await deal.save();

      return {
        success: true,
        message: "Asking for payment terms",
        data: {
          accordoMessage: accordoMsgRecord as any,
          conversationState: updatedState,
          revealAvailable: false,
          dealStatus: deal.status,
          meso: null,
        },
      };
    }

    // 6. Merge with last known offer if incomplete
    const vendorOffer = mergeWithLastOffer(
      parsedOffer,
      conversationState.lastVendorOffer,
    );

    // 7. Get decision from engine (if we have a complete offer)
    let decision: Decision;
    let explainability: Explainability | null = null;
    let weakestPrimaryParameter: "price" | "terms" | "delivery" | undefined;

    if (
      vendorOffer.total_price !== null &&
      vendorOffer.payment_terms !== null
    ) {
      decision = decideNextMove(config, vendorOffer, deal.round + 1);
      explainability = computeExplainability(config, vendorOffer, decision);

      // 7-pre-0. Affirmative override: if vendor's message was a short acceptance
      // phrase, force ACCEPT regardless of utility score. The vendor is agreeing
      // to OUR last counter — finalize the deal on those terms.
      if (isVendorAffirmative) {
        decision = {
          action: "ACCEPT",
          utilityScore: decision.utilityScore,
          counterOffer: null,
          reasons: [
            `Vendor sent affirmative acceptance ("${vendorMessage.trim()}"). Locking in PM's last counter.`,
          ],
        };
        explainability = computeExplainability(config, vendorOffer, decision);
      }

      // 7-pre-A. Firmness handling — vendor signals "this is final / best price / non-negotiable"
      // Strategy: if vendor's price is at or below max_acceptable → ACCEPT.
      // If over budget and we have not yet made our last attempt → counter at max_acceptable
      // and mark lastAttemptUsed. If over budget and lastAttemptUsed already → ESCALATE.
      const firmnessSignal = isVendorAffirmative
        ? { isFirm: false, matched: null }
        : detectStrictFirmness(vendorMessage);
      const priceParamsForFirm =
        config.parameters?.total_price ??
        ((config.parameters as any)?.unit_price as
          | { target: number; max_acceptable: number }
          | undefined);
      if (
        firmnessSignal.isFirm &&
        vendorOffer.total_price != null &&
        priceParamsForFirm
      ) {
        const maxAcc = priceParamsForFirm.max_acceptable;
        if (vendorOffer.total_price <= maxAcc) {
          // Within budget — accept the firm price
          logger.info(
            `[ConversationService] Firmness detected ("${firmnessSignal.matched}") and within budget — ACCEPT`,
            { dealId, vendorPrice: vendorOffer.total_price, maxAcc },
          );
          decision = {
            action: "ACCEPT",
            utilityScore: decision.utilityScore,
            counterOffer: null,
            reasons: [
              ...decision.reasons,
              `Vendor firm signal: "${firmnessSignal.matched}". Price within max_acceptable — accepting.`,
            ],
          };
        } else if (conversationState.lastAttemptUsed) {
          // Already tried our last attempt — escalate
          logger.info(
            `[ConversationService] Firm vendor over-budget after last-attempt — ESCALATE`,
            { dealId, vendorPrice: vendorOffer.total_price, maxAcc },
          );
          decision = {
            action: "ESCALATE",
            utilityScore: decision.utilityScore,
            counterOffer: null,
            reasons: [
              ...decision.reasons,
              `Vendor firm at ${vendorOffer.total_price} (over max_acceptable ${maxAcc}). Last attempt already used — needs human review.`,
            ],
          };
        } else {
          // Make our one last attempt at max_acceptable
          logger.info(
            `[ConversationService] Firm vendor — making last attempt at max_acceptable`,
            { dealId, vendorPrice: vendorOffer.total_price, maxAcc },
          );
          decision = {
            action: "COUNTER",
            utilityScore: decision.utilityScore,
            counterOffer: {
              total_price: maxAcc,
              payment_terms:
                vendorOffer.payment_terms ??
                decision.counterOffer?.payment_terms ??
                "Net 30",
              payment_terms_days: vendorOffer.payment_terms_days ?? null,
              delivery_date: vendorOffer.delivery_date ?? null,
              delivery_days: vendorOffer.delivery_days ?? null,
            },
            reasons: [
              ...decision.reasons,
              `Vendor firm signal: "${firmnessSignal.matched}". Last attempt at max_acceptable ${maxAcc}.`,
            ],
          };
          conversationState.lastAttemptUsed = true;
        }
      }

      // 7-pre-B. Identical-counter stall → force MESO this round
      // If our last 2 PM counters were the exact same price, switching MESO
      // breaks the loop with an equivalent-bundles offer.
      const pmHist = conversationState.pmCounterHistory ?? [];
      const lastTwoIdentical =
        pmHist.length >= 2 &&
        pmHist[pmHist.length - 1] === pmHist[pmHist.length - 2];
      if (
        lastTwoIdentical &&
        decision.action === "COUNTER" &&
        decision.counterOffer?.total_price === pmHist[pmHist.length - 1]
      ) {
        logger.info(
          `[ConversationService] Two identical PM counters in a row — forcing MESO`,
          { dealId, repeatedPrice: pmHist[pmHist.length - 1] },
        );
        decision = {
          ...decision,
          action: "MESO",
          reasons: [
            ...decision.reasons,
            `Two identical PM counters at ${pmHist[pmHist.length - 1]} — switching to MESO to break stall.`,
          ],
        };
      }

      // REJECT_TERMS guard: if vendor is rejecting terms (e.g., "329,650 is not possible")
      // the engine may return ACCEPT because it scored the mentioned price favorably.
      // Override to COUNTER — never accept on a rejection message.
      if (refusalType === "REJECT_TERMS" && decision.action === "ACCEPT") {
        logger.info(
          "[ConversationService] Overriding ACCEPT → COUNTER due to REJECT_TERMS refusal",
          {
            dealId,
            originalAction: decision.action,
            vendorMessage: vendorMessage.substring(0, 100),
          },
        );
        // Generate a counter-offer instead of accepting
        const priceConfig =
          config.parameters?.total_price ??
          (config.parameters as any)?.unit_price;
        let counterPrice = priceConfig
          ? Math.round(
              (priceConfig.target +
                (priceConfig.max_acceptable - priceConfig.target) * 0.5) *
                100,
            ) / 100
          : vendorOffer.total_price * 0.9;
        // Never counter above vendor's offer
        if (
          vendorOffer.total_price != null &&
          counterPrice > vendorOffer.total_price
        ) {
          counterPrice = vendorOffer.total_price;
        }
        decision = {
          action: "COUNTER",
          utilityScore: decision.utilityScore,
          counterOffer: {
            total_price: counterPrice,
            payment_terms: vendorOffer.payment_terms,
          },
          reasons: [
            ...decision.reasons,
            "Overridden: vendor expressed rejection — cannot accept",
          ],
        };
        explainability = computeExplainability(config, vendorOffer, decision);
      }

      // Compute weakestPrimaryParameter using 5-param weighted utility
      // Only computed for COUNTER decisions — no need for terminal actions
      if (decision.action === "COUNTER") {
        try {
          const wizardConfig = (deal.negotiationConfigJson as any)
            ?.wizardConfig;
          const resolvedConfig = resolveNegotiationConfig(wizardConfig, {
            total_price:
              config.parameters?.total_price ??
              (config.parameters as any)?.unit_price,
            accept_threshold: config.accept_threshold,
            escalate_threshold: config.escalate_threshold,
            walkaway_threshold: config.walkaway_threshold,
            max_rounds: config.max_rounds,
            priority: config.priority,
          });
          const extendedOffer: ExtendedOffer = {
            total_price: vendorOffer.total_price,
            payment_terms: vendorOffer.payment_terms,
            payment_terms_days: vendorOffer.payment_terms_days ?? null,
            delivery_date: vendorOffer.delivery_date ?? null,
            delivery_days: vendorOffer.delivery_days ?? null,
          };
          const utilityResult = calculateWeightedUtilityFromResolved(
            extendedOffer,
            resolvedConfig,
          );
          const paramUtils = utilityResult.parameterUtilities;

          // Identify weakest AMONG primary params only (price, terms, delivery)
          // Warranty and quality are NEVER surfaced to vendor
          const primaryParams: Array<{
            key: string;
            label: "price" | "terms" | "delivery";
          }> = [
            { key: "targetUnitPrice", label: "price" },
            { key: "paymentTerms", label: "terms" },
            { key: "deliveryDate", label: "delivery" },
          ];
          // Only consider params that were actually scored (vendor mentioned them)
          const scoredPrimary = primaryParams.filter(
            (p) => paramUtils[p.key] !== undefined,
          );
          if (scoredPrimary.length > 0) {
            const weakest = scoredPrimary.reduce((min, p) =>
              (paramUtils[p.key]?.utility ?? 1) <
              (paramUtils[min.key]?.utility ?? 1)
                ? p
                : min,
            );
            // Only set if utility is below 0.7 (actually weak, not just slightly lower)
            if ((paramUtils[weakest.key]?.utility ?? 1) < 0.7) {
              weakestPrimaryParameter = weakest.label;
            }
          }
        } catch {
          // Non-critical — if resolution fails, proceed without weakestPrimaryParameter
        }
      }
    } else {
      // No complete offer, ask for clarification
      decision = {
        action: "ASK_CLARIFY",
        utilityScore: 0,
        counterOffer: null,
        reasons: ["Missing complete offer (total_price or payment_terms)"],
      };
    }

    // 7b. MESO handling: Generate MESO options when conditions are met
    let mesoResult: MesoResult | null = null;

    // Check if MESO should trigger based on round and cycle state
    const negotiationState = (deal as any)
      .negotiationStateJson as NegotiationState | null;
    const mesoCycleState = negotiationState?.mesoCycleState as
      | MesoCycleState
      | undefined;
    const finalOfferState = negotiationState?.finalOfferState as
      | FinalOfferState
      | undefined;

    const mesoCheck = shouldUseMeso({
      round: deal.round + 1,
      mesoCycleState,
      finalOfferState,
    });

    // If MESO should show OR the decision engine returned MESO action
    if (
      mesoCheck.shouldShow ||
      decision.action === "MESO" ||
      (decision.action as string) === "MESO"
    ) {
      try {
        const wizardConfig = (deal.negotiationConfigJson as any)?.wizardConfig;
        const resolvedConfig = resolveMesoConfig(wizardConfig, {
          total_price:
            config.parameters?.total_price ??
            (config.parameters as any)?.unit_price,
          accept_threshold: config.accept_threshold,
          escalate_threshold: config.escalate_threshold,
          walkaway_threshold: config.walkaway_threshold,
          max_rounds: config.max_rounds,
          priority: config.priority,
        });

        const extendedVendorOffer: EngineExtendedOffer = {
          total_price: vendorOffer.total_price,
          payment_terms: vendorOffer.payment_terms,
          payment_terms_days: vendorOffer.payment_terms_days ?? null,
          delivery_date: vendorOffer.delivery_date ?? null,
          delivery_days: vendorOffer.delivery_days ?? null,
        };

        const currency = (config.currency || "USD") as SupportedCurrency;
        const lastAccordoCounterPrice =
          (deal.latestOfferJson as any)?.total_price ?? null;
        mesoResult = generateMesoOptions(
          resolvedConfig,
          extendedVendorOffer,
          deal.round + 1,
          0.65,
          currency,
          lastAccordoCounterPrice,
        );

        // Apply flow control flags from shouldUseMeso
        mesoResult.showOthers = mesoCheck.showOthers;
        mesoResult.isFinal = mesoCheck.isFinal;
        mesoResult.phase = mesoCheck.phase;
        mesoResult.inputDisabled = mesoCheck.inputDisabled;
        mesoResult.disabledMessage = mesoCheck.disabledMessage;

        if (mesoResult.success && mesoResult.options.length > 0) {
          // Save MESO round to DB so processMesoSelection can find it
          await models.MesoRound.create({
            dealId: deal.id,
            round: deal.round + 1,
            options: mesoResult.options as any,
          } as any);

          // Override decision to COUNTER for the LLM text generation
          // (the actual MESO options are sent separately in the response)
          decision = {
            action: "COUNTER",
            utilityScore: decision.utilityScore,
            counterOffer:
              (mesoResult.options[0]?.offer as any) ?? decision.counterOffer,
            reasons: [
              ...decision.reasons,
              "MESO options generated — presenting to vendor",
            ],
          };

          logger.info("[ConversationService] MESO options generated", {
            dealId,
            round: deal.round + 1,
            optionCount: mesoResult.options.length,
            showOthers: mesoCheck.showOthers,
            isFinal: mesoCheck.isFinal,
            phase: mesoCheck.phase,
          });
        } else {
          // MESO generation failed — fall through to normal COUNTER
          const failReason = mesoResult?.reason;
          mesoResult = null;
          logger.warn(
            "[ConversationService] MESO generation failed, using normal COUNTER",
            {
              dealId,
              reason: failReason,
            },
          );
        }
      } catch (mesoError) {
        // Non-critical — if MESO fails, continue with normal COUNTER
        mesoResult = null;
        logger.warn(
          "[ConversationService] MESO generation error, falling back to COUNTER",
          {
            dealId,
            error:
              mesoError instanceof Error
                ? mesoError.message
                : String(mesoError),
          },
        );
      }

      // If MESO didn't work, convert to a regular COUNTER
      if (
        !mesoResult &&
        (decision.action === "MESO" || (decision.action as string) === "MESO")
      ) {
        const priceParams =
          config.parameters?.total_price ??
          (config.parameters as any)?.unit_price;
        const target = priceParams?.target ?? 0;
        const maxAcceptable = priceParams?.max_acceptable ?? 0;
        const counterPrice =
          target > 0
            ? Math.round((target + (maxAcceptable - target) * 0.4) * 100) / 100
            : maxAcceptable;

        decision = {
          action: "COUNTER",
          utilityScore: decision.utilityScore,
          counterOffer: {
            total_price: counterPrice,
            payment_terms: vendorOffer.payment_terms ?? "Net 30",
            payment_terms_days: vendorOffer.payment_terms_days ?? 30,
            delivery_date: null,
            delivery_days: null,
          },
          reasons: [
            ...decision.reasons,
            "MESO generation failed — fallback COUNTER",
          ],
        };
      }
    }

    // 7c. Cap counter-offer payment terms to vendor's stated maximum (if any)
    if (decision.counterOffer?.payment_terms) {
      const vendorMaxDays = extractVendorMaxTermsDays(vendorMessage);
      if (vendorMaxDays !== null) {
        const cappedTerms = capTermsToVendorMax(
          decision.counterOffer.payment_terms,
          vendorMaxDays,
        );
        if (cappedTerms !== decision.counterOffer.payment_terms) {
          logger.info(
            `[ConversationService] Capped counter payment terms from ${decision.counterOffer.payment_terms} to ${cappedTerms} (vendor max: Net ${vendorMaxDays})`,
            { dealId },
          );
          decision.counterOffer.payment_terms = cappedTerms;
        }
      }
    }

    // 7d. Guard: PM counter price must NEVER exceed vendor's current offer price
    if (
      decision.counterOffer?.total_price != null &&
      vendorOffer.total_price != null
    ) {
      if (decision.counterOffer.total_price > vendorOffer.total_price) {
        logger.info(
          `[ConversationService] Capping counter price from ${decision.counterOffer.total_price} to vendor's offer ${vendorOffer.total_price}`,
          { dealId },
        );
        decision.counterOffer.total_price = vendorOffer.total_price;
      }
    }

    // 7e. Monotonic floor: PM counter must never go BELOW our previous counter.
    // Source of truth: deal.latestOfferJson (last persisted PM counter).
    // Once we've offered X to the vendor, walking back to <X weakens our position.
    if (
      decision.action === "COUNTER" &&
      decision.counterOffer?.total_price != null &&
      vendorOffer.total_price != null
    ) {
      const prevPmPrice =
        (deal.latestOfferJson as { total_price?: number } | null)
          ?.total_price ?? null;
      if (
        prevPmPrice != null &&
        decision.counterOffer.total_price < prevPmPrice
      ) {
        // Floor at previous counter, but stay strictly below vendor's current price.
        const flooredPrice = Math.min(
          prevPmPrice,
          vendorOffer.total_price - 0.01,
        );
        if (flooredPrice > decision.counterOffer.total_price) {
          logger.info(
            `[ConversationService] Monotonic floor: lifting counter from ${decision.counterOffer.total_price} to ${flooredPrice} (prev PM counter ${prevPmPrice})`,
            { dealId },
          );
          decision.counterOffer.total_price =
            Math.round(flooredPrice * 100) / 100;
        }
      }
    }

    // 8. Detect vendor preference
    const allMessages = deal.Messages || [];
    const detectedPreference = detectVendorPreference(allMessages);

    // 9. Determine conversation intent
    const intent = determineIntent(
      conversationState,
      decision,
      vendorOffer,
      refusalType,
      deal.round,
    );

    logger.info("[ConversationService] Intent classified", {
      dealId,
      intent,
      decision: decision.action,
      preference: detectedPreference,
      refusalType,
    });

    // 10. Detect vendor tone (metadata only — feeds NegotiationIntent)
    const toneHistory = allMessages.map((msg) => ({
      role: msg.role as "VENDOR" | "ACCORDO" | "SYSTEM",
      content: msg.content,
    }));
    const toneResult = detectVendorTone([
      ...toneHistory,
      { role: "VENDOR", content: vendorMessage },
    ]);

    // 10b. Detect deterministic vendor-style signals (Apr 2026 humanization).
    //      Includes repeatedOfferCount used by the escape hatch below.
    const vendorStyle: VendorStyle = detectVendorStyle(
      vendorMessage,
      toneHistory,
    );

    // 11. Resolve price boundaries for intent builder (used to clamp allowedPrice)
    const storedConfig = deal.negotiationConfigJson as any;
    const targetPrice: number | undefined =
      storedConfig?.parameters?.total_price?.target ??
      storedConfig?.wizardConfig?.priceQuantity?.targetUnitPrice ??
      undefined;
    const maxAcceptablePrice: number | undefined =
      storedConfig?.parameters?.total_price?.max_acceptable ??
      storedConfig?.wizardConfig?.priceQuantity?.maxAcceptablePrice ??
      undefined;

    // 11b. Repeat-offer escape hatch (Apr 2026).
    //      When the vendor restates the same exact price 3+ times in a row, we
    //      stop the back-and-forth: ACCEPT if their price fits our ceiling, or
    //      send a final MESO at maxAcceptable. If we already sent that MESO
    //      last round and they still won't move, we walk away politely.
    //      Strategy lives here — the LLM only ever sees the resulting intent.
    const convoState = (deal.convoStateJson as any) || {};
    const lastWasCeilingMeso = convoState?.lastCeilingMesoRound === deal.round;
    let escapeHatchApplied:
      | "accept"
      | "ceiling-meso"
      | "post-meso-walk"
      | null = null;

    if (
      vendorStyle.repeatedOfferCount >= 3 &&
      vendorStyle.lastVendorPrice != null
    ) {
      if (lastWasCeilingMeso) {
        // Vendor still won't move after our maxAcceptable counter — walk away.
        decision.action = "WALK_AWAY";
        decision.counterOffer = null;
        escapeHatchApplied = "post-meso-walk";
      } else if (
        maxAcceptablePrice != null &&
        vendorStyle.lastVendorPrice <= maxAcceptablePrice
      ) {
        // Vendor's stuck price is within our ceiling — close the deal.
        decision.action = "ACCEPT";
        decision.counterOffer = {
          ...(decision.counterOffer || {}),
          total_price: vendorStyle.lastVendorPrice,
        } as any;
        escapeHatchApplied = "accept";
      } else if (maxAcceptablePrice != null) {
        // Above ceiling — send a final counter at maxAcceptable, framed as a
        // regular meet-in-the-middle move (no "this is final" signal leaks).
        decision.action = "COUNTER";
        decision.counterOffer = {
          ...(decision.counterOffer || {}),
          total_price: maxAcceptablePrice,
        } as any;
        escapeHatchApplied = "ceiling-meso";
      }

      if (escapeHatchApplied) {
        logger.info("[ConversationService] Repeat-offer escape hatch applied", {
          dealId,
          mode: escapeHatchApplied,
          repeatedOfferCount: vendorStyle.repeatedOfferCount,
          vendorPrice: vendorStyle.lastVendorPrice,
        });
      }
    }

    // 12. Build NegotiationIntent — the hard boundary between engine and LLM
    const phrasingHistory = getPhrasings(dealId);
    const openQuestions =
      (deal.openQuestions as Array<{
        question: string;
        askedAtRound: number;
      }>) ?? [];
    const negotiationIntent = buildNegotiationIntent({
      action: decision.action as
        | "ACCEPT"
        | "COUNTER"
        | "ESCALATE"
        | "WALK_AWAY"
        | "ASK_CLARIFY",
      utilityScore: decision.utilityScore,
      counterPrice: decision.counterOffer?.total_price ?? null,
      counterPaymentTerms: decision.counterOffer?.payment_terms ?? null,
      counterDelivery: decision.counterOffer?.delivery_date
        ? `by ${decision.counterOffer.delivery_date}`
        : decision.counterOffer?.delivery_days
          ? `within ${decision.counterOffer.delivery_days} days`
          : null,
      concerns: [],
      tone: toneResult.primaryTone,
      targetPrice,
      maxAcceptablePrice,
      weakestPrimaryParameter,
      currencyCode: storedConfig?.currency || "USD",
      vendorStyle,
      roundNumber: deal.round + 1,
      phrasingHistory,
      openQuestions,
    });

    // 13. Get non-commercial context for persona (safe to pass to LLM)
    const personaContext = {
      dealTitle: deal.title ?? undefined,
      vendorName: (deal as any).Vendor?.name ?? undefined,
      productCategory: (deal as any).Requisition?.title ?? undefined,
    };

    // 14. Render response via LLM persona renderer
    //     LLM receives: intent (no commercial data except allowedPrice for COUNTER) + vendorMessage + dealTitle/vendor/category
    let accordoReplyContent: string;
    let fromLlm = false;

    const renderResult = await renderNegotiationMessage(
      negotiationIntent,
      vendorMessage,
      personaContext,
    );

    // 15. Validate LLM output — LLM is untrusted
    try {
      accordoReplyContent = validateLlmOutput(
        renderResult.message,
        negotiationIntent,
      );
      fromLlm = renderResult.fromLlm;
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        logger.warn(
          "[ConversationService] LLM output failed validation, using fallback",
          {
            dealId,
            reason: validationError.reason,
            action: negotiationIntent.action,
          },
        );
      }
      // Silent fallback — vendor never knows
      accordoReplyContent = getFallbackResponse(negotiationIntent);
      fromLlm = false;
    }

    // 15b. Record the phrasing fingerprint so the next round avoids reusing it.
    recordPhrasing(dealId, negotiationIntent.action, accordoReplyContent);

    // 16. Log the negotiation step (audit trail — no LLM text, no scores)
    logNegotiationStep({
      action: negotiationIntent.action,
      firmness: negotiationIntent.firmness,
      round: deal.round + 1,
      counterPrice: negotiationIntent.allowedPrice,
      vendorTone: negotiationIntent.vendorTone,
      dealId,
      fromLlm,
      vendorStyle: {
        formality: vendorStyle.formality,
        language: vendorStyle.language,
        languageConfidence: vendorStyle.languageConfidence,
        hostility: vendorStyle.hostility,
        hasQuestion: vendorStyle.hasQuestion,
        repeatedOfferCount: vendorStyle.repeatedOfferCount,
        acceptanceDetected: vendorStyle.acceptanceDetected,
      },
      escapeHatchApplied,
      messageWordCount: accordoReplyContent.trim().split(/\s+/).filter(Boolean)
        .length,
    });

    // 17. Simulate typing delay + capture delayMs for frontend typing indicator.
    //      Pass output and vendor-message word counts for complexity scaling.
    const replyWordCount = accordoReplyContent
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const vendorWordCount = (vendorMessage || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    const { delayMs } = await simulateTypingDelay(negotiationIntent.action, {
      outputWordCount: replyWordCount,
      vendorMessageWordCount: vendorWordCount,
    });

    const newConversationState = updateConversationState(
      conversationState,
      intent,
      decision,
      vendorOffer,
      detectedPreference,
    );

    // 19. Save vendor message
    const vendorMessageRecord = await models.ChatbotMessage.create({
      id: uuidv4(),
      dealId: deal.id,
      role: "VENDOR",
      content: vendorMessage,
      extractedOffer: vendorOffer as any,
      engineDecision: null,
      decisionAction: null,
      utilityScore: null,
      counterOffer: null,
      explainabilityJson: null,
      createdAt: new Date(),
    });

    // 20. Save Accordo reply
    const accordoMessageRecord = await models.ChatbotMessage.create({
      id: uuidv4(),
      dealId: deal.id,
      role: "ACCORDO",
      content: accordoReplyContent,
      extractedOffer: null,
      engineDecision: decision as any,
      decisionAction: decision.action,
      utilityScore: decision.utilityScore,
      counterOffer: (decision.counterOffer as any) || null,
      explainabilityJson: explainability as any,
      createdAt: new Date(),
    });

    // 21. Update deal state
    deal.round += 1;
    deal.latestVendorOffer = vendorOffer as any;
    deal.latestDecisionAction = decision.action;
    deal.latestUtility = decision.utilityScore;
    deal.latestOfferJson = (decision.counterOffer as any) || null;
    // Track the round we sent the maxAcceptable counter so next round can walk
    // away if the vendor still hasn't moved.
    const updatedConvoState: any = { ...(newConversationState as any) };
    if (escapeHatchApplied === "ceiling-meso") {
      updatedConvoState.lastCeilingMesoRound = deal.round + 1;
    }
    deal.convoStateJson = updatedConvoState;
    deal.lastMessageAt = new Date();

    // 21b. Update openQuestions list:
    //  - Existing questions are considered addressed (the persona-renderer was
    //    instructed to answer them) so we clear what was carried in.
    //  - New questions in this vendor message that we couldn't fully address
    //    (heuristic: COUNTER/MESO/ACCEPT actions tend to focus on price, not
    //    payment-term/delivery questions) get appended for the next round.
    const newQuestions: Array<{ question: string; askedAtRound: number }> = [];
    if (vendorStyle.hasQuestion) {
      const sentences = vendorMessage.split(/(?<=[.?!])\s+/);
      for (const sent of sentences) {
        const trimmed = sent.trim();
        if (!trimmed.endsWith("?")) continue;
        if (trimmed.length < 6 || trimmed.length > 240) continue;
        // Skip rhetorical "is that right?" / "ok?" filler.
        if (/^(is\s+that|ok|okay|right|sure)\b/i.test(trimmed)) continue;
        newQuestions.push({ question: trimmed, askedAtRound: deal.round });
      }
    }
    deal.openQuestions = newQuestions;

    // Update status via state machine
    const event = actionToEvent(decision.action);
    const stateTransition = transition(deal.status as DealState, event);
    if (stateTransition.valid) {
      deal.status = stateTransition.newState;
    }

    await deal.save();

    logger.info("[ConversationService] Message processed successfully", {
      dealId,
      round: deal.round,
      status: deal.status,
      decision: decision.action,
    });

    return {
      success: true,
      message: "Message processed successfully",
      data: {
        accordoMessage: accordoMessageRecord as any,
        conversationState: newConversationState,
        revealAvailable: explainability !== null,
        dealStatus: deal.status,
        delayMs,
        meso:
          mesoResult && mesoResult.success
            ? {
                options: mesoResult.options.map((o) => ({
                  id: o.id,
                  offer: o.offer as unknown as Record<string, unknown>,
                  utility: o.utility,
                  label: o.label,
                  description: o.description,
                  emphasis: o.emphasis,
                  tradeoffs: o.tradeoffs,
                })),
                showOthers: mesoResult.showOthers,
                isFinal: mesoResult.isFinal,
                phase: mesoResult.phase,
                currency: mesoResult.currency,
                inputDisabled: mesoResult.inputDisabled,
                disabledMessage: mesoResult.disabledMessage,
              }
            : null,
      },
    };
  } catch (error) {
    logger.error("[ConversationService] Failed to process message", {
      dealId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(`Failed to process message: ${error}`, 500);
  }
}

/**
 * Get explainability for the last Accordo message
 *
 * Returns the decision breakdown (utility scores, reasons, counter-offer)
 * for the most recent Accordo reply that has explainability data.
 */
export async function getLastExplainability(
  dealId: string,
  userId: number,
): Promise<Explainability | null> {
  try {
    logger.info("[ConversationService] Getting last explainability", {
      dealId,
      userId,
    });

    // Validate deal
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError("Deal not found", 404);
    }

    // Only deal creator can view explainability
    if (deal.userId !== userId) {
      throw new CustomError(
        "Unauthorized: Only deal creator can view explainability",
        403,
      );
    }

    // Find last Accordo message with explainability
    const lastAccordoMessage = await models.ChatbotMessage.findOne({
      where: {
        dealId,
        role: "ACCORDO",
        explainabilityJson: { [Op.ne]: null },
      },
      order: [["createdAt", "DESC"]],
    });

    if (!lastAccordoMessage || !lastAccordoMessage.explainabilityJson) {
      return null;
    }

    return lastAccordoMessage.explainabilityJson as Explainability;
  } catch (error) {
    logger.error("[ConversationService] Failed to get explainability", {
      dealId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(`Failed to get explainability: ${error}`, 500);
  }
}
