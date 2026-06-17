import { NegotiationState } from "../state.js";
import logger from "../../../../../config/logger.js";

/**
 * HumanInterventionNode (Track 1: Vatsal)
 * 
 * Pauses negotiation workflow when high-value deals (> ₹10L) require manual approval.
 */
export const humanInterventionNode = async (state: NegotiationState) => {
  logger.info(`[Node: human_intervention] Pausing graph for human review.`);

  return {
    waitingForHuman: true,
    metadata: {
      ...state.metadata,
      approvalStatus: "APPROVAL_REQUIRED",
      pausedAt: new Date().toISOString(),
    }
  };
};
