/**
 * Deterministic PM reply from NegotiationIntent when LLM is unavailable.
 * Uses exact engine terms (price, currency, payment) — not legacy tone-templates.
 * Wording rotates by round / persuasion angle to avoid copy-paste repetition.
 */

import type {
  NegotiationIntent,
  PersuasionAngle,
} from "../negotiation/intent/build-negotiation-intent.js";
import {
  isFirstPmNegotiationRound,
  pickRound1GreetingVariant,
  buildFirstCounterAckPrefix,
} from "./first-pm-greeting.js";

const MOVEMENT_ACK: Record<
  NonNullable<NegotiationIntent["vendorMovement"]>,
  string
> = {
  significant:
    "We appreciate the meaningful movement on price since your last message. ",
  moderate: "Thanks for adjusting your numbers in our direction. ",
  minor: "We note the small step you've taken on price. ",
};

const COUNTER_CORE_TEMPLATES: Array<
  (price: string, terms: string, delivery: string) => string
> = [
  (price, terms, delivery) =>
    `After internal review, our counter is ${price} total${terms}${delivery}.`,
  (price, terms, delivery) =>
    `From our side we can work with ${price} total${terms}${delivery} on this order.`,
  (price, terms, delivery) =>
    `We are positioned at ${price} total${terms}${delivery} for this requisition.`,
];

const COUNTER_CLOSERS: Record<PersuasionAngle, string[]> = {
  partnership: [
    "We value the relationship on this account and would like to close this cleanly if these terms work for you.",
    "There is good scope to build on this partnership if we can align on these numbers.",
  ],
  philosophy: [
    "Our approach is to land on terms that are fair for both sides rather than drag this out.",
    "We prefer a straightforward close when the commercial gap is manageable.",
  ],
  economics: [
    "The volume and timeline on this order support holding at this level.",
    "This reflects what we can justify internally given scope and delivery expectations.",
  ],
};

const ACCEPT_VARIANTS = [
  "We are pleased to accept your offer and look forward to formalizing next steps with your team on this requisition.",
  "We are happy to move ahead on these terms and will coordinate next steps with your team shortly.",
  "Your offer works for us — we accept and look forward to progressing the order together.",
];

const PERSUASION_PAD_BY_ANGLE: Record<PersuasionAngle, string[]> = {
  partnership: [
    "We would like to keep momentum on this order and find terms that work for both sides.",
    "We see room to build a longer-term working relationship once we align commercially.",
  ],
  philosophy: [
    "We prefer to resolve the remaining gap pragmatically rather than extend the back-and-forth.",
    "A clean close at workable terms benefits both teams on timing and planning.",
  ],
  economics: [
    "The economics on this requisition support closing at a sensible midpoint.",
    "Holding unnecessarily on a small gap adds cost to both sides on this timeline.",
  ],
};

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function padToMinWords(
  text: string,
  min: number,
  angle: PersuasionAngle = "partnership",
): string {
  const pads = PERSUASION_PAD_BY_ANGLE[angle];
  let out = text.trim();
  let i = 0;
  while (wordCount(out) < min) {
    out += ` ${pads[i % pads.length]}`;
    i += 1;
  }
  return out;
}

function formatCounterPrice(intent: NegotiationIntent): string {
  if (intent.allowedPrice == null) {
    throw new Error("COUNTER intent requires allowedPrice");
  }
  const locale = intent.currencySymbol === "₹" ? "en-IN" : "en-US";
  return `${intent.currencySymbol}${intent.allowedPrice.toLocaleString(locale)}`;
}

function resolveAngle(intent: NegotiationIntent): PersuasionAngle {
  return intent.persuasionBrief?.angle ?? "partnership";
}

function roundIndex(intent: NegotiationIntent): number {
  return Math.max(0, (intent.roundNumber ?? 1) - 1);
}

function movementAck(intent: NegotiationIntent): string {
  if (!intent.persuasionBrief?.vendorMovedTowardUs) return "";
  if (!intent.vendorMovement) return "Thanks for working with us on the numbers. ";
  return MOVEMENT_ACK[intent.vendorMovement];
}

function round1Prefix(intent: NegotiationIntent, idx: number): string {
  if (!isFirstPmNegotiationRound(intent.roundNumber)) return "";
  if (intent.priorPmWelcomeSent) return buildFirstCounterAckPrefix();
  return pickRound1GreetingVariant(idx);
}

function buildCounterBody(intent: NegotiationIntent): string {
  const price = formatCounterPrice(intent);
  const terms = intent.allowedPaymentTerms
    ? `, ${intent.allowedPaymentTerms}`
    : "";
  const delivery = intent.allowedDelivery
    ? `, delivery ${intent.allowedDelivery}`
    : "";

  const angle = resolveAngle(intent);
  const idx = roundIndex(intent);
  const greet = round1Prefix(intent, idx);
  const core =
    COUNTER_CORE_TEMPLATES[idx % COUNTER_CORE_TEMPLATES.length](
      price,
      terms,
      delivery,
    );
  const closers = COUNTER_CLOSERS[angle];
  const closer = closers[idx % closers.length];

  return `${greet}${movementAck(intent)}${core} ${closer}`;
}

export function composeIntentFaithfulReply(intent: NegotiationIntent): string {
  const angle = resolveAngle(intent);
  const idx = roundIndex(intent);

  switch (intent.action) {
    case "COUNTER": {
      return padToMinWords(buildCounterBody(intent), 40, angle);
    }
    case "ACCEPT": {
      const min = intent.compactAccept ? 15 : 40;
      const greet = round1Prefix(intent, idx);
      const body = `${greet}${movementAck(intent)}${ACCEPT_VARIANTS[idx % ACCEPT_VARIANTS.length]}`;
      return padToMinWords(body, min, angle);
    }
    case "WALK_AWAY": {
      const body = `${round1Prefix(intent, 0)}Thank you for the time on this negotiation. Unfortunately we cannot proceed at the current terms, but we appreciate your engagement and remain open to future opportunities.`;
      return padToMinWords(body, 40, angle);
    }
    case "ESCALATE": {
      const body = `${round1Prefix(intent, 1)}Thank you for your proposal. We would like a senior colleague to review this with you and will follow up shortly with a response.`;
      return padToMinWords(body, 40, angle);
    }
    case "ASK_CLARIFY": {
      const body = `${round1Prefix(intent, 2)}Could you share your best total price along with your preferred payment terms so we can continue the discussion on this requisition?`;
      return padToMinWords(body, 40, angle);
    }
    case "MESO": {
      const body = `${round1Prefix(intent, 0)}We have a few structured options we would like you to consider. Please review the alternatives and let us know which works best for your team.`;
      return padToMinWords(body, 40, angle);
    }
    default: {
      const _exhaustive: never = intent.action;
      return _exhaustive;
    }
  }
}
