import { NegotiationState, NegotiationDecision } from "../state.js";

/**
 * DecisionAgent (Track 1: Vatsal) - Phase 3.1 Foundation
 * 
 * @source src/modules/chatbot/engine/decide.ts
 * 
 * Synergy Mandate:
 * - Implements basic "Accept" trigger if price <= target_price
 * - Implements "Escalate" trigger if round_number > 5
 */
export const decisionNode = async (state: NegotiationState) => {
  if (!state.config || !state.parsedOffer) {
    return { decision: null };
  }

  const { config, parsedOffer, round } = state;

  // Extract config targets safely
  const targetPrice = config.parameters?.total_price?.target ?? config.targetPrice ?? 1000;
  const maxAcceptablePrice = config.parameters?.total_price?.max_acceptable ?? config.maxAcceptablePrice ?? 1500;
  
  const currentPrice = parsedOffer.totalPrice;

  // Handle missing price
  if (currentPrice == null) {
    return {
      decision: {
        action: "WAIT",
        reasoning: "Missing total_price in vendor offer.",
        confidence: 1.0
      } as NegotiationDecision
    };
  }

  // Hard Escalate trigger if round > 5
  if (round > 5) {
    return {
      decision: {
        action: "ESCALATE",
        reasoning: `Round number ${round} exceeds maximum threshold of 5.`,
        confidence: 1.0,
        parametersFailed: ["round"]
      } as NegotiationDecision
    };
  }

  // Basic Accept trigger: if price is less than or equal to the target price
  if (currentPrice <= targetPrice) {
    return {
      decision: {
        action: "ACCEPT",
        reasoning: `Price ${currentPrice} is at or below target price ${targetPrice}.`,
        confidence: 0.95,
        parametersMet: ["totalPrice"]
      } as NegotiationDecision
    };
  }

  // Default to Counter
  return {
    decision: {
      action: "COUNTER",
      reasoning: `Price ${currentPrice} is above target ${targetPrice}. Proceeding to formulate counter strategy.`,
      confidence: 0.8,
      parametersFailed: ["totalPrice"]
    } as NegotiationDecision
  };
};
