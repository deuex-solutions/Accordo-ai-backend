import { NegotiationState } from "../state.js";
import { detectStallPattern, trackOffer, ParameterHistory } from "../../stall-detector.js";
import { ExtendedOffer } from "../../types.js";

/**
 * StallRecoveryAgent (Track 3: Adarsh) - Phase 4.1
 * 
 * @source src/modules/chatbot/engine/stall-detector.ts
 * 
 * Synergy Mandate:
 * - Detects "no progress" deadlocks (3+ rounds without movement)
 * - Integrates momentum analysis from intelligence layer
 * - Injects recovery probes via metadata
 */
export const stallRecoveryNode = async (state: NegotiationState) => {
  if (!state.parsedOffer) return {};

  // Retrieve existing histories from metadata or initialize empty array
  let histories: ParameterHistory[] = state.metadata?.parameterHistories || [];

  // Map state.parsedOffer to legacy ExtendedOffer schema expected by trackOffer
  const extendedOffer: ExtendedOffer = {
    total_price: state.parsedOffer.totalPrice ?? null,
    payment_terms: state.parsedOffer.paymentTerms ?? null,
    payment_terms_days: state.parsedOffer.paymentTermsDays ?? null,
    delivery_days: state.parsedOffer.deliveryDays ?? null,
    warranty_months: state.parsedOffer.warrantyMonths ?? null,
    partial_delivery_allowed: state.parsedOffer.partialDelivery ?? null,
  };

  // Track the new offer in history
  histories = trackOffer(histories, extendedOffer, state.round);

  // Detect deadlock (stall after 3 rounds)
  const analysis = detectStallPattern(histories, 3);

  // Port momentum analysis integration (translating Behavioral Analysis to Stall trend)
  let momentumTrend: "UP" | "DOWN" | "STABLE" = "STABLE";
  if (state.analysis?.behavior?.momentum === "ACCELERATING") momentumTrend = "UP";
  else if (state.analysis?.behavior?.momentum === "DECELERATING") momentumTrend = "DOWN";

  const roundsWithoutProgress = analysis.pattern ? analysis.pattern.consecutiveRounds : 0;

  return {
    stallStatus: {
      isStalled: analysis.isStalled,
      roundsWithoutProgress,
      momentumTrend
    },
    metadata: {
      ...state.metadata,
      parameterHistories: histories,
      stallRecoveryPrompt: analysis.pattern?.prompt || null
    }
  };
};
