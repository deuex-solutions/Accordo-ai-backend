/**
 * First PM reply: social salutation (Good morning/afternoon/evening) then
 * acknowledgment, then counter — not thank-you-only.
 */

import { resolveTimeOfDayGreeting } from "../utils/time-of-day-greeting.js";
import { PM_WELCOME_ACTION, isPmWelcomeAction } from "../modules/chatbot/pipeline/decision-actions.js";

/** @deprecated Use buildFirstPmOpeningPrefix — acknowledgment only, no salutation */
export const FIRST_PM_GREETING_PREFIX =
  "Thank you for your quotation and for sharing the details. ";

const SOCIAL_SALUTATION_OPENERS =
  /^(good\s+(morning|afternoon|evening)|hello|hi|hey|dear|greetings|namaste)\b/i;

const ACKNOWLEDGMENT_OPENERS =
  /^(thank\s+you|thanks\b|we appreciate)/i;

const ACKNOWLEDGMENT_VARIANTS = [
  "Thank you for your quotation and for sharing the details.",
  "Thanks for putting this proposal together.",
  "We appreciate you sending this through.",
];

/** Interpersonal salutation — Good morning/afternoon/evening, Hello, etc. */
export function hasSocialSalutation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SOCIAL_SALUTATION_OPENERS.test(trimmed);
}

/** Round-1 PM opener must start with a social salutation, not thank-you alone. */
export function hasNegotiatorGreeting(text: string): boolean {
  return hasSocialSalutation(text);
}

export function isFirstPmNegotiationRound(
  roundNumber: number | undefined,
): boolean {
  return (roundNumber ?? 1) <= 1;
}

export function buildFirstPmOpeningPrefix(
  seed = 0,
  date: Date = new Date(),
): string {
  const salutation = resolveTimeOfDayGreeting(date);
  const ack =
    ACKNOWLEDGMENT_VARIANTS[Math.abs(seed) % ACKNOWLEDGMENT_VARIANTS.length]!;
  return `${salutation}. ${ack} `;
}

export function hasPriorPmWelcomeMessage(
  priorMessages: Pick<{ role: string; decisionAction?: string | null }, "role" | "decisionAction">[],
): boolean {
  return priorMessages.some(
    (m) => m.role === "ACCORDO" && isPmWelcomeAction(m.decisionAction),
  );
}

/** @deprecated Prefer buildFirstPmOpeningPrefix */
export function pickRound1GreetingVariant(seed: number): string {
  return buildFirstPmOpeningPrefix(seed);
}

const ROUND1_ACK_ONLY = "Thank you for your quotation and for sharing the details. ";

export function buildFirstCounterAckPrefix(): string {
  return ROUND1_ACK_ONLY;
}

/**
 * Ensure round-1 PM replies open with salutation + acknowledgment before substance.
 */
export function ensureFirstPmGreeting(
  content: string,
  roundNumber: number | undefined,
  date: Date = new Date(),
  priorPmWelcomeSent = false,
): string {
  if (!isFirstPmNegotiationRound(roundNumber)) {
    return content.trim();
  }

  let trimmed = content.trim();
  if (!trimmed) {
    if (priorPmWelcomeSent) {
      return ROUND1_ACK_ONLY.trim();
    }
    return buildFirstPmOpeningPrefix(0, date).trim();
  }

  if (priorPmWelcomeSent) {
    if (ACKNOWLEDGMENT_OPENERS.test(trimmed)) {
      return trimmed;
    }
    return `${ROUND1_ACK_ONLY}${trimmed}`;
  }

  if (hasSocialSalutation(trimmed)) {
    return trimmed;
  }

  if (ACKNOWLEDGMENT_OPENERS.test(trimmed)) {
    return `${resolveTimeOfDayGreeting(date)}. ${trimmed}`;
  }

  return `${buildFirstPmOpeningPrefix(0, date)}${trimmed}`;
}
