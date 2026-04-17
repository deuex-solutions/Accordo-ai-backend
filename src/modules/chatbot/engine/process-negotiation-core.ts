/**
 * process-negotiation-core.ts
 *
 * Shared negotiation core used by BOTH INSIGHTS and CONVERSATION modes.
 * Extracts the deterministic decision pipeline:
 *   1. Load deal + config
 *   2. Parse vendor offer
 *   3. Calculate weighted utility
 *   4. Run decision engine (decideNextMove)
 *   5. Compute explainability
 *   6. Check MESO conditions
 *
 * Response generation is NOT included — each mode handles that:
 *   - INSIGHTS: template-based (generateAccordoResponse)
 *   - CONVERSATION: LLM-rendered (personaRenderer)
 *
 * @module process-negotiation-core
 */

import { parseOfferRegex } from "./parse-offer.js";
import { decideNextMove } from "./decide.js";
import {
  computeExplainability,
  priceUtility,
  termsUtility,
  type NegotiationConfig,
} from "./utility.js";
import type { Offer, Decision, Explainability } from "./types.js";
import {
  transition,
  actionToEvent,
  type DealState,
} from "./negotiation-state-machine.js";
import logger from "../../../config/logger.js";
import * as negotiationLogger from "./negotiation-logger.js";
import models from "../../../models/index.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";

// ============================================================================
// Types
// ============================================================================

export interface NegotiationCoreInput {
  dealId: string;
  vendorMessage: string;
}

export interface NegotiationCoreResult {
  deal: ChatbotDeal;
  config: NegotiationConfig;
  currentRound: number;
  extractedOffer: Offer;
  decision: Decision;
  explainability: Explainability | null;
  newStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED";
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load negotiation config from deal's stored config or template
 * CRITICAL: Prioritize stored negotiationConfigJson to preserve priority-based thresholds
 */
export async function loadNegotiationConfig(
  deal: ChatbotDeal,
): Promise<NegotiationConfig> {
  // Priority 1: Use stored negotiation config (includes priority-adjusted thresholds and weights)
  if (deal.negotiationConfigJson) {
    const storedConfig = deal.negotiationConfigJson as NegotiationConfig & {
      wizardConfig?: unknown;
    };
    return {
      parameters: storedConfig.parameters,
      accept_threshold: storedConfig.accept_threshold,
      escalate_threshold: storedConfig.escalate_threshold,
      walkaway_threshold: storedConfig.walkaway_threshold,
      max_rounds: storedConfig.max_rounds,
      priority: storedConfig.priority,
    };
  }

  // Priority 2: Fallback to template config (for legacy deals)
  if (!deal.templateId) {
    throw new Error("Deal has no negotiation config or template configured");
  }

  const template = await models.ChatbotTemplate.findByPk(deal.templateId);
  if (!template) {
    throw new Error(`Template ${deal.templateId} not found`);
  }

  return template.configJson as unknown as NegotiationConfig;
}

/**
 * Determine new deal status based on decision action using the state machine
 */
export function getDealStatus(
  action: Decision["action"],
  currentStatus?: string,
): "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED" {
  const currentState = (currentStatus || "NEGOTIATING") as DealState;
  const event = actionToEvent(action);
  const result = transition(currentState, event);
  return result.newState;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Run the shared negotiation core pipeline.
 *
 * This does NOT generate a response message or save to DB — callers handle that.
 * This does NOT require a transaction — callers wrap in their own transaction.
 *
 * @param input - Deal ID and vendor message
 * @returns Decision result with all computed data
 */
export async function runNegotiationCore(
  input: NegotiationCoreInput,
): Promise<NegotiationCoreResult> {
  const { dealId, vendorMessage } = input;

  // 1. Load Deal
  const deal = await models.ChatbotDeal.findByPk(dealId);
  if (!deal) {
    throw new Error(`Deal ${dealId} not found`);
  }

  if (deal.status !== "NEGOTIATING") {
    throw new Error(
      `Deal ${dealId} is in ${deal.status} status. Cannot process new messages.`,
    );
  }

  // 2. Load Config
  const config = await loadNegotiationConfig(deal);
  const currentRound = deal.round + 1;

  // Enhanced logging
  negotiationLogger.logRoundStart(dealId, currentRound, config.max_rounds);
  negotiationLogger.logConfigThresholds(config, config.priority || "MEDIUM");

  // 3. Parse Vendor Offer
  logger.info(`[NegotiationCore] Parsing vendor message for deal ${dealId}`);
  const extractedOffer = parseOfferRegex(vendorMessage);
  negotiationLogger.logVendorOffer(vendorMessage, extractedOffer);

  // 4. Calculate utilities for logging
  const pUtility =
    extractedOffer.total_price !== null
      ? priceUtility(config, extractedOffer.total_price)
      : 0;
  const tUtility =
    extractedOffer.payment_terms !== null
      ? termsUtility(config, extractedOffer.payment_terms)
      : 0;
  const priceWeight =
    (config.parameters?.total_price ?? (config.parameters as any)?.unit_price)
      ?.weight ?? 0.6;
  const termsWeight = config.parameters?.payment_terms?.weight ?? 0.4;
  const totalUtil = pUtility * priceWeight + tUtility * termsWeight;
  negotiationLogger.logUtilityCalculation(
    pUtility,
    tUtility,
    totalUtil,
    config,
  );

  // 5. Run Decision Engine
  logger.info(
    `[NegotiationCore] Running decision engine (round ${currentRound})`,
  );
  const decision = decideNextMove(config, extractedOffer, currentRound);
  negotiationLogger.logDecision(decision, currentRound);

  // 6. Compute Explainability
  let explainability: Explainability | null = null;
  if (
    extractedOffer.total_price !== null &&
    extractedOffer.payment_terms !== null
  ) {
    explainability = computeExplainability(config, extractedOffer, decision);
  }

  // 7. Determine new status
  const newStatus = getDealStatus(decision.action, deal.status);

  // Enhanced logging: Round summary
  negotiationLogger.logRoundSummary(
    currentRound,
    extractedOffer.total_price,
    decision.counterOffer?.total_price ?? null,
    decision.utilityScore,
    decision.action,
    newStatus,
  );

  if (newStatus !== "NEGOTIATING") {
    negotiationLogger.logDealStatus(
      newStatus,
      decision.reasons[0] || "Deal concluded",
    );
  }

  negotiationLogger.logSeparator();

  return {
    deal,
    config,
    currentRound,
    extractedOffer,
    decision,
    explainability,
    newStatus,
  };
}
