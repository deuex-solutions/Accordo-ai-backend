import { NegotiationState } from "../state.js";
import { transition, actionToEvent, DealState } from "../../negotiation-state-machine.js";

/**
 * StateManagementAgent (Track 1: Vatsal)
 * 
 * Responsible for managing the lifecycle of the negotiation.
 * This node handles state transitions (NEGOTIATING -> ACCEPTED/WALKED_AWAY/ESCALATED)
 * based on the brain's decision and updates the round count.
 */
export const stateManagementNode = async (state: NegotiationState) => {
  const { decision, metadata } = state;
  const currentDealStatus = (metadata?.dealStatus as DealState) || "NEGOTIATING";

  let nextDealStatus = currentDealStatus;
  let updates: Partial<NegotiationState> = {};

  if (decision) {
    const event = actionToEvent(decision.action);
    const result = transition(currentDealStatus, event);

    if (result.valid) {
      nextDealStatus = result.newState;
    }

    // Increment round if the action was a counter or clarification
    if (decision.action === "COUNTER" || decision.action === "STALL") {
      updates.round = (state.round || 0) + 1;
    }
  }

  // Sync HITL flag based on decision
  if (decision?.action === "ESCALATE") {
    updates.waitingForHuman = true;
  }

  const isConvo = metadata?.mode === "CONVERSATION";
  let updatedConvoState = metadata?.convoState;

  if (isConvo && decision && metadata?.convoState) {
    const { updateConvoState } = await import("../../../convo/enhanced-convo-router.js");
    updatedConvoState = updateConvoState(
      metadata.convoState,
      metadata.vendorIntent,
      decision.action as any
    );
  }

  return {
    ...updates,
    metadata: {
      ...state.metadata,
      dealStatus: nextDealStatus,
      lastTransition: decision ? decision.action : "INITIALIZE",
      transitionTime: new Date().toISOString(),
      convoState: updatedConvoState,
    },
  };
};
