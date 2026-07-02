/**
 * Canonical decisionAction values for chatbot messages.
 */

export const PM_WELCOME_ACTION = "WELCOME" as const;

/** Engine-driven PM negotiation moves (count toward negotiation round). */
export const PM_NEGOTIATION_ACTIONS = new Set([
  "ACCEPT",
  "COUNTER",
  "MESO",
  "WALK_AWAY",
  "ESCALATE",
  "ASK_CLARIFY",
]);

export function isPmNegotiationAction(
  action: string | null | undefined,
): boolean {
  return action != null && PM_NEGOTIATION_ACTIONS.has(action);
}

export function isPmWelcomeAction(action: string | null | undefined): boolean {
  return action === PM_WELCOME_ACTION;
}
