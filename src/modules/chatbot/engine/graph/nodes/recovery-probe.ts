import { NegotiationState, Offer } from "../state.js";

/**
 * RecoveryProbeAgent (Track 3: Adarsh) - Phase 4.2
 * 
 * Synergy Mandate:
 * - Implement recovery probe strategies (value-add offers, deadline extensions).
 * - Escalation timing optimization based on stall depth.
 * - Automated nudge generation for minor stalls.
 */
export const recoveryProbeNode = async (state: NegotiationState) => {
  if (!state.stallStatus?.isStalled) return {};

  const { roundsWithoutProgress, momentumTrend } = state.stallStatus;
  
  let recoveryStrategy = "NONE";
  let proposedCounter: Offer | null = state.counterOffer ? { ...state.counterOffer } : null;
  let nudgeMessage: string | null = null;
  let escalationRecommended = false;

  if (roundsWithoutProgress >= 5) {
    // Escalation timing optimization: 5 rounds of no progress is a hard stop
    escalationRecommended = true;
    recoveryStrategy = "ESCALATE";
  } else if (roundsWithoutProgress === 4) {
    // Deadline extension probe
    recoveryStrategy = "DEADLINE_EXTENSION";
    nudgeMessage = "We've been stuck here for a while. If we can finalize this soon, we can extend the delivery timeline to give you more flexibility. Does that help bridge the gap?";
    if (proposedCounter && proposedCounter.deliveryDays) {
      proposedCounter.deliveryDays += 15; // Provide more time as a value-add
    }
  } else if (roundsWithoutProgress === 3) {
    if (momentumTrend === "UP") {
      // Automated nudge: momentum is good, just push slightly
      recoveryStrategy = "AUTOMATED_NUDGE";
      nudgeMessage = "We are making great progress and are very close to an agreement. Can we meet halfway on this final point to close the deal?";
    } else {
      // Value-add offer: momentum is dead, inject value
      recoveryStrategy = "VALUE_ADD";
      nudgeMessage = "To help move us forward, we are willing to offer extended payment terms if you can agree to our target price. How does that sound?";
      if (proposedCounter && proposedCounter.paymentTermsDays) {
        proposedCounter.paymentTermsDays += 30; // Better payment terms as a value-add
      }
    }
  }

  const newDecision = escalationRecommended && state.decision ? 
    { ...state.decision, action: "ESCALATE" as const, reasoning: "Escalated due to 5+ rounds of negotiation stall." } 
    : undefined;

  return {
    metadata: {
      ...state.metadata,
      recoveryStrategy,
      recoveryNudge: nudgeMessage
    },
    // Return updated counterOffer if a value-add changed it
    ...(proposedCounter && { counterOffer: proposedCounter }),
    // Overwrite decision if escalating
    ...(newDecision && { decision: newDecision })
  };
};
