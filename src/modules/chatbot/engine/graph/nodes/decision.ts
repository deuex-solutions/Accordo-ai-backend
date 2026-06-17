import { NegotiationState, NegotiationDecision } from "../state.js";
import { resolveNegotiationConfig, calculateWeightedUtilityFromResolved } from "../../weighted-utility.js";

/**
 * DecisionAgent (Track 1: Vatsal) - Phase 4.1 Advanced
 * 
 * @source src/modules/chatbot/engine/decide.ts
 * 
 * Synergy Mandate:
 * - Implements weighted utility scoring
 * - Implements "Walk Away" logic
 * - Adds post-decision safety guard (Strict Ceiling check)
 */
export const decisionNode = async (state: NegotiationState) => {
  if (!state.config || !state.parsedOffer) {
    return { decision: null };
  }

  const { config, parsedOffer, round } = state;

  const currentPrice = parsedOffer.totalPrice;

  if (currentPrice == null) {
    return {
      decision: {
        action: "WAIT",
        reasoning: "Missing total_price in vendor offer.",
        confidence: 1.0
      } as NegotiationDecision
    };
  }

  // 1. Resolve configuration and calculate weighted utility
  const resolvedConfig = resolveNegotiationConfig(undefined, config);
  
  const extendedOffer = {
    total_price: parsedOffer.totalPrice ?? undefined,
    payment_terms_days: parsedOffer.paymentTermsDays ?? undefined,
    payment_terms: parsedOffer.paymentTermsDays ? `Net ${parsedOffer.paymentTermsDays}` : undefined,
    delivery_days: parsedOffer.deliveryDays ?? undefined,
    warranty_months: parsedOffer.warrantyMonths ?? undefined,
  };

  const utilityResult = calculateWeightedUtilityFromResolved(extendedOffer as any, resolvedConfig);
  const { totalUtility, recommendation, thresholds } = utilityResult;

  // 2. Hard Escalate trigger if round > maxRounds (default 5)
  if (round > resolvedConfig.maxRounds) {
    return {
      decision: {
        action: "ESCALATE",
        reasoning: `Round number ${round} exceeds maximum threshold of ${resolvedConfig.maxRounds}.`,
        confidence: 1.0,
        utilityScore: totalUtility,
        parametersFailed: ["round"]
      } as NegotiationDecision
    };
  }

  // 3. "Walk Away" logic based on utility thresholds
  if (totalUtility < thresholds.walkAway) {
    return {
      decision: {
        action: "WALK_AWAY",
        reasoning: `Utility score ${totalUtility.toFixed(2)} is below walk-away threshold ${thresholds.walkAway}.`,
        confidence: 1.0,
        utilityScore: totalUtility
      } as NegotiationDecision
    };
  }

  // 4. Post-decision safety guard (Strict Ceiling check)
  if (recommendation === "ACCEPT" && currentPrice > resolvedConfig.maxAcceptablePrice) {
    return {
      decision: {
        action: "COUNTER",
        reasoning: `Utility suggests ACCEPT, but price ${currentPrice} exceeds strict ceiling ${resolvedConfig.maxAcceptablePrice}. Forcing COUNTER.`,
        confidence: 1.0,
        utilityScore: totalUtility,
        parametersFailed: ["totalPrice"]
      } as NegotiationDecision
    };
  }

  // Proceed with utility-based recommendation
  return {
    decision: {
      action: recommendation as any,
      reasoning: `Utility score ${totalUtility.toFixed(2)} dictates ${recommendation}.`,
      confidence: 0.9,
      utilityScore: totalUtility,
      parametersMet: recommendation === "ACCEPT" ? ["utility"] : [],
      parametersFailed: recommendation !== "ACCEPT" ? ["utility"] : []
    } as NegotiationDecision
  };
};
