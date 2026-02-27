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

import { v4 as uuidv4 } from 'uuid';
import { Op } from 'sequelize';
import { CustomError } from '../../../utils/custom-error.js';
import logger from '../../../config/logger.js';
import models from '../../../models/index.js';
import { parseOfferRegex } from '../engine/parseOffer.js';
import { decideNextMove } from '../engine/decide.js';
import { computeExplainability, totalUtility } from '../engine/utility.js';
import { buildConfigFromRequisition } from '../chatbot.service.js';
import type { NegotiationConfig } from '../engine/utility.js';
import type { Offer, Decision, Explainability } from '../engine/types.js';
import type { ChatbotDeal } from '../../../models/chatbotDeal.js';
import type { ChatbotMessage } from '../../../models/chatbotMessage.js';
import type {
  ConversationState,
  ProcessConversationMessageInput,
  ProcessConversationMessageResult,
} from './types.js';
import {
  initializeConversationState,
  detectVendorPreference,
  classifyRefusal,
  mergeWithLastOffer,
  determineIntent,
  updateConversationState,
  shouldAutoStartConversation,
  getDefaultGreeting,
} from './conversationManager.js';
import { detectVendorTone } from '../engine/toneDetector.js';
import { buildNegotiationIntent } from '../../../negotiation/intent/buildNegotiationIntent.js';
import { renderNegotiationMessage } from '../../../llm/personaRenderer.js';
import { validateLlmOutput, ValidationError } from '../../../llm/validateLlmOutput.js';
import { getFallbackResponse } from '../../../llm/fallbackTemplates.js';
import { simulateTypingDelay } from '../../../delivery/simulateTypingDelay.js';
import { logNegotiationStep } from '../../../metrics/logNegotiationStep.js';

/**
 * Start a new conversation
 *
 * Initializes conversation state and sends automatic greeting message.
 * Should be called once when conversation mode is first accessed.
 */
export async function startConversation(
  dealId: string,
  userId: number
): Promise<ProcessConversationMessageResult> {
  try {
    logger.info('[ConversationService] Starting conversation', { dealId, userId });

    // 1. Validate deal
    const deal = (await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.ChatbotMessage, as: 'Messages' },
        { model: models.Contract, as: 'Contract' },
      ],
    })) as ChatbotDeal & { Messages?: ChatbotMessage[] };

    if (!deal) {
      throw new CustomError('Deal not found', 404);
    }

    // Only deal creator can start conversation
    if (deal.userId !== userId) {
      throw new CustomError('Unauthorized: Only deal creator can start conversation', 403);
    }

    // Conversation mode only
    if (deal.mode !== 'CONVERSATION') {
      throw new CustomError('This operation is only available in CONVERSATION mode', 400);
    }

    // Check if already started
    const messageCount = deal.Messages?.length || 0;
    if (messageCount > 0) {
      return {
        success: true,
        message: 'Conversation already started',
        data: {
          accordoMessage: deal.Messages![deal.Messages!.length - 1] as any,
          conversationState: (deal.convoStateJson as ConversationState) || initializeConversationState(),
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
      role: 'ACCORDO',
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

    logger.info('[ConversationService] Conversation started successfully', {
      dealId,
      messageId: greetingMessage.id,
    });

    return {
      success: true,
      message: 'Conversation started successfully',
      data: {
        accordoMessage: greetingMessage as any,
        conversationState: initialState,
        revealAvailable: false,
        dealStatus: deal.status,
      },
    };
  } catch (error) {
    logger.error('[ConversationService] Failed to start conversation', {
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
  input: ProcessConversationMessageInput
): Promise<ProcessConversationMessageResult> {
  const { dealId, vendorMessage, userId } = input;

  try {
    logger.info('[ConversationService] Processing message', {
      dealId,
      userId,
      messageLength: vendorMessage.length,
    });

    // 1. Validate deal
    const deal = (await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.ChatbotMessage, as: 'Messages' },
        { model: models.Contract, as: 'Contract' },
        { model: models.Requisition, as: 'Requisition' },
      ],
    })) as ChatbotDeal & { Messages?: ChatbotMessage[] };

    if (!deal) {
      throw new CustomError('Deal not found', 404);
    }

    // Only deal creator can send messages
    if (deal.userId !== userId) {
      throw new CustomError('Unauthorized: Only deal creator can send messages', 403);
    }

    // Conversation mode only
    if (deal.mode !== 'CONVERSATION') {
      throw new CustomError('This operation is only available in CONVERSATION mode', 400);
    }

    // Cannot modify terminal deals
    if (deal.status !== 'NEGOTIATING') {
      throw new CustomError(`Cannot send messages to a deal with status: ${deal.status}`, 400);
    }

    // 2. Get conversation state
    let conversationState = (deal.convoStateJson as ConversationState) || initializeConversationState();

    // 3. Get negotiation config - CRITICAL: Use stored config to preserve priority-based thresholds
    let config: NegotiationConfig;
    if (deal.negotiationConfigJson) {
      // Use stored negotiation config from deal (includes priority-adjusted thresholds and weights)
      const storedConfig = deal.negotiationConfigJson as NegotiationConfig & { wizardConfig?: unknown };
      config = {
        parameters: storedConfig.parameters,
        accept_threshold: storedConfig.accept_threshold,
        escalate_threshold: storedConfig.escalate_threshold,
        walkaway_threshold: storedConfig.walkaway_threshold,
        max_rounds: storedConfig.max_rounds,
        priority: storedConfig.priority,
      };
    } else if (deal.requisitionId) {
      // Fallback to building from requisition (for legacy deals without stored config)
      config = await buildConfigFromRequisition(deal.requisitionId);
    } else {
      throw new CustomError('Deal must be linked to a requisition for negotiation config', 400);
    }

    // 4. Check for refusal
    const refusalType = classifyRefusal(vendorMessage);

    // 5. Parse vendor offer (with currency conversion if requisition has different currency)
    // Get requisition currency for proper conversion (February 2026)
    const requisition = (deal as any).Requisition;
    const requisitionCurrency = requisition?.typeOfCurrency as 'USD' | 'INR' | 'EUR' | 'GBP' | 'AUD' | undefined;
    const parsedOffer = parseOfferRegex(vendorMessage, requisitionCurrency);

    // 6. Merge with last known offer if incomplete
    const vendorOffer = mergeWithLastOffer(parsedOffer, conversationState.lastVendorOffer);

    // 7. Get decision from engine (if we have a complete offer)
    let decision: Decision;
    let explainability: Explainability | null = null;

    if (vendorOffer.total_price !== null && vendorOffer.payment_terms !== null) {
      decision = decideNextMove(config, vendorOffer, deal.round + 1);
      explainability = computeExplainability(config, vendorOffer, decision);
    } else {
      // No complete offer, ask for clarification
      decision = {
        action: 'ASK_CLARIFY',
        utilityScore: 0,
        counterOffer: null,
        reasons: ['Missing complete offer (total_price or payment_terms)'],
      };
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
      deal.round
    );

    logger.info('[ConversationService] Intent classified', {
      dealId,
      intent,
      decision: decision.action,
      preference: detectedPreference,
      refusalType,
    });

    // 10. Detect vendor tone (metadata only — feeds NegotiationIntent)
    const toneHistory = allMessages.map((msg) => ({ role: msg.role as 'VENDOR' | 'ACCORDO' | 'SYSTEM', content: msg.content }));
    const toneResult = detectVendorTone([...toneHistory, { role: 'VENDOR', content: vendorMessage }]);

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

    // 12. Build NegotiationIntent — the hard boundary between engine and LLM
    const negotiationIntent = buildNegotiationIntent({
      action: decision.action as 'ACCEPT' | 'COUNTER' | 'ESCALATE' | 'WALK_AWAY' | 'ASK_CLARIFY',
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

    const renderResult = await renderNegotiationMessage(negotiationIntent, vendorMessage, personaContext);

    // 15. Validate LLM output — LLM is untrusted
    try {
      accordoReplyContent = validateLlmOutput(renderResult.message, negotiationIntent);
      fromLlm = renderResult.fromLlm;
    } catch (validationError) {
      if (validationError instanceof ValidationError) {
        logger.warn('[ConversationService] LLM output failed validation, using fallback', {
          dealId,
          reason: validationError.reason,
          action: negotiationIntent.action,
        });
      }
      // Silent fallback — vendor never knows
      accordoReplyContent = getFallbackResponse(negotiationIntent);
      fromLlm = false;
    }

    // 16. Log the negotiation step (audit trail — no LLM text, no scores)
    logNegotiationStep({
      action: negotiationIntent.action,
      firmness: negotiationIntent.firmness,
      round: deal.round + 1,
      counterPrice: negotiationIntent.allowedPrice,
      vendorTone: negotiationIntent.vendorTone,
      dealId,
      fromLlm,
    });

    // 17. Simulate typing delay + capture delayMs for frontend typing indicator
    const { delayMs } = await simulateTypingDelay(negotiationIntent.action);

    const newConversationState = updateConversationState(
      conversationState,
      intent,
      decision,
      vendorOffer,
      detectedPreference
    );

    // 19. Save vendor message
    const vendorMessageRecord = await models.ChatbotMessage.create({
      id: uuidv4(),
      dealId: deal.id,
      role: 'VENDOR',
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
      role: 'ACCORDO',
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
    deal.convoStateJson = newConversationState as any;
    deal.lastMessageAt = new Date();

    // Update status if terminal
    if (decision.action === 'ACCEPT') {
      deal.status = 'ACCEPTED';
    } else if (decision.action === 'WALK_AWAY') {
      deal.status = 'WALKED_AWAY';
    } else if (decision.action === 'ESCALATE') {
      deal.status = 'ESCALATED';
    }

    await deal.save();

    logger.info('[ConversationService] Message processed successfully', {
      dealId,
      round: deal.round,
      status: deal.status,
      decision: decision.action,
    });

    return {
      success: true,
      message: 'Message processed successfully',
      data: {
        accordoMessage: accordoMessageRecord as any,
        conversationState: newConversationState,
        revealAvailable: explainability !== null,
        dealStatus: deal.status,
        delayMs,
      },
    };
  } catch (error) {
    logger.error('[ConversationService] Failed to process message', {
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
  userId: number
): Promise<Explainability | null> {
  try {
    logger.info('[ConversationService] Getting last explainability', { dealId, userId });

    // Validate deal
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      throw new CustomError('Deal not found', 404);
    }

    // Only deal creator can view explainability
    if (deal.userId !== userId) {
      throw new CustomError('Unauthorized: Only deal creator can view explainability', 403);
    }

    // Find last Accordo message with explainability
    const lastAccordoMessage = await models.ChatbotMessage.findOne({
      where: {
        dealId,
        role: 'ACCORDO',
        explainabilityJson: { [Op.ne]: null },
      },
      order: [['createdAt', 'DESC']],
    });

    if (!lastAccordoMessage || !lastAccordoMessage.explainabilityJson) {
      return null;
    }

    return lastAccordoMessage.explainabilityJson as Explainability;
  } catch (error) {
    logger.error('[ConversationService] Failed to get explainability', {
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
