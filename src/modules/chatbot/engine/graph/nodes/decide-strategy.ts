import { NegotiationState, NegotiationDecision } from "../state.js";
import { NodeName } from "../types.js";

import { calculateWeightedUtilityFromResolved, resolveNegotiationConfig } from "../../weighted-utility.js";
import logger from "../../../../../config/logger.js";
import { ExtendedOffer } from "../../types.js";

/**
 * DecideStrategyNode (Track 1: Vatsal)
 * 
 * Acts as the brain of the negotiation. Ingests all data (parsed offer, 
 * intelligence analysis, vendor profile) and calculates the next strategic 
 * move using the weighted utility engine.
 */
export const decideStrategyNode = async (state: NegotiationState) => {
  logger.info(`[Node: ${NodeName.DECIDE_STRATEGY}] Determining next move...`);

  // Default fallback decision if we can't compute a real one
  let decision: NegotiationDecision = {
    action: "COUNTER",
    reasoning: "Fallback to counter due to missing state data.",
    confidence: 0.5
  };

  if (!state.parsedOffer) {
    logger.warn(`[Node: ${NodeName.DECIDE_STRATEGY}] Missing parsed offer. Escalate or wait.`);
    return {
      decision: {
        action: "WAIT",
        reasoning: "No parsed offer available to evaluate.",
        confidence: 1.0
      }
    };
  }

  // 1. Resolve Config for the Utility Engine
  // Assuming state.config is passed in from the DB on graph initialization
  let resolvedConfig;
  try {
    resolvedConfig = resolveNegotiationConfig(state.config);
  } catch (err) {
    logger.error(`[Node: ${NodeName.DECIDE_STRATEGY}] Error resolving config`, err);
    // Continue with a fallback if possible or return
    return { decision };
  }

  // 2. Map state.parsedOffer to legacy ExtendedOffer for the engine
  const extVendorOffer: ExtendedOffer = {
    total_price: state.parsedOffer.totalPrice ?? undefined,
    payment_terms_days: state.parsedOffer.paymentTermsDays ?? undefined,
    delivery_days: state.parsedOffer.deliveryDays ?? undefined,
    warranty_months: state.parsedOffer.warrantyMonths ?? undefined
  };

  // 3. Compute the current weighted utility
  const utilityResult = calculateWeightedUtilityFromResolved(extVendorOffer, resolvedConfig);

  // 4. Adapt to Yug's Intelligence
  // If Yug's node flagged high urgency, we might want to increase our likelihood to ACCEPT or lower expectations.
  const isUrgent = state.analysis?.urgency === "HIGH" || state.analysis?.tone?.urgency > 0.7;

    // 5. Determine Action based on new Utility Engine
    let action: NegotiationDecision["action"] = "COUNTER";
    
    // Map Pactum recommendation to LangGraph actions
    if (utilityResult.recommendation === "ACCEPT") action = "ACCEPT";
    else if (utilityResult.recommendation === "WALK_AWAY") action = "WALK_AWAY";
    else if (utilityResult.recommendation === "ESCALATE") action = "ESCALATE";
    
    // Check round limits for WALK_AWAY
    if (action === "WALK_AWAY" && (state.round || 1) < 10) {
      // Don't walk away too early, give them a chance
      action = "COUNTER";
    }

    // Adjust for extreme urgency
    if (action === "COUNTER" && isUrgent && utilityResult.totalUtility > resolvedConfig.escalateThreshold) {
      // Future logic here
    }

    const parametersMet = Object.values(utilityResult.parameterUtilities)
      .filter(p => p.utility > 0.5)
      .map(p => p.parameterName);

    const parametersFailed = Object.values(utilityResult.parameterUtilities)
      .filter(p => p.utility <= 0.5)
      .map(p => p.parameterName);

    decision = {
      action,
      reasoning: utilityResult.recommendationReason,
      confidence: 0.9,
      utilityScore: utilityResult.totalUtility,
      parametersMet,
      parametersFailed
    };

  return { decision };
};
