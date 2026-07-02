/**
 * Resolve 1-indexed PM negotiation round from persisted messages.
 * Ignores WELCOME and other non-negotiation ACCORDO rows.
 */

import type { ChatbotMessage } from "../../../models/chatbot-message.js";
import { isPmNegotiationAction } from "./decision-actions.js";

export function countPriorPmNegotiationReplies(
  priorMessages: Pick<ChatbotMessage, "role" | "decisionAction">[],
): number {
  return priorMessages.filter(
    (m) => m.role === "ACCORDO" && isPmNegotiationAction(m.decisionAction),
  ).length;
}

/**
 * Next PM negotiation round (1 = first counter/accept/clarify after vendor opens).
 * Based only on prior PM negotiation rows — not deal.round (which may already
 * reflect the inbound vendor message in async two-phase flows).
 */
export function resolvePmNegotiationRoundNumber(
  priorMessages: Pick<ChatbotMessage, "role" | "decisionAction">[],
  _dealRound?: number,
): number {
  return countPriorPmNegotiationReplies(priorMessages) + 1;
}
