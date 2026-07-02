/**
 * P0 accept overrides: price-led, gap-to-counter, and meeting-proposal convergence.
 */

import type { ChatbotMessage } from "../../../models/chatbot-message.js";
import type { NegotiationConfig } from "../engine/utility.js";
import { priceUtility, totalUtility } from "../engine/utility.js";
import { extractPaymentDays } from "../engine/types.js";
import type { Decision, Offer } from "../engine/types.js";
import type { ClassificationResult } from "./types.js";

/** Accept when price utility alone is strong (terms may be suboptimal e.g. Net 45). */
export const PRICE_LED_ACCEPT_UTILITY = 0.85;

/** Gap above PM counter: max 2% or absolute currency units (INR-scale deals). */
export const GAP_ACCEPT_MAX_PCT = 0.02;
export const GAP_ACCEPT_MAX_ABSOLUTE = 1_500;

/** Vendor restated the same price this many times (incl. current) — treat as firm ceiling. */
export const REPEATED_CEILING_MIN_COUNT = 2;

const PRICE_MATCH_TOLERANCE = 0.01;

export function pricesMatch(a: number, b: number): boolean {
  return Math.abs(a - b) < PRICE_MATCH_TOLERANCE;
}

export function paymentTermsCompatible(
  vendorTerms: string | null | undefined,
  pmTerms: string | null | undefined,
): boolean {
  const vendorDays = vendorTerms ? extractPaymentDays(vendorTerms) : null;
  const pmDays = pmTerms ? extractPaymentDays(pmTerms) : null;
  if (pmDays === null || vendorDays === null) return true;
  return vendorDays === pmDays || vendorDays >= pmDays;
}

export function offersCommerciallyAligned(
  vendorOffer: Offer,
  pmOffer: Pick<Offer, "total_price" | "payment_terms">,
): boolean {
  if (vendorOffer.total_price == null || pmOffer.total_price == null) {
    return false;
  }
  if (!pricesMatch(vendorOffer.total_price, pmOffer.total_price)) {
    return false;
  }
  return paymentTermsCompatible(
    vendorOffer.payment_terms,
    pmOffer.payment_terms,
  );
}

export function countTrailingSameVendorPrice(
  priorMessages: ChatbotMessage[],
  currentVendorPrice: number,
): number {
  const prices = priorMessages
    .filter((m) => m.role === "VENDOR")
    .map((m) => (m.extractedOffer as Offer | null)?.total_price)
    .filter((p): p is number => p != null);
  prices.push(currentVendorPrice);

  let same = 1;
  for (let i = prices.length - 2; i >= 0; i--) {
    if (pricesMatch(prices[i]!, currentVendorPrice)) {
      same += 1;
    } else {
      break;
    }
  }
  return same;
}

export function isVendorMaxCeilingMessage(text: string): boolean {
  return /\bmax\s+i\s+can\s+do\b/i.test(text);
}

/** Vendor must have lowered price this many consecutive rounds (incl. current). */
export const GAP_ACCEPT_MIN_VENDOR_DROPS = 2;

export function countTrailingVendorPriceDrops(
  priorMessages: ChatbotMessage[],
  currentVendorPrice: number,
): number {
  const prices = priorMessages
    .filter((m) => m.role === "VENDOR")
    .map((m) => (m.extractedOffer as Offer | null)?.total_price)
    .filter((p): p is number => p != null);
  prices.push(currentVendorPrice);

  let drops = 0;
  for (let i = prices.length - 1; i >= 1; i--) {
    if (prices[i]! < prices[i - 1]!) {
      drops += 1;
    } else {
      break;
    }
  }
  return drops;
}

export function isWithinGapAbovePmCounter(
  vendorPrice: number,
  pmCounter: number,
): boolean {
  if (vendorPrice <= pmCounter) return true;
  const gap = vendorPrice - pmCounter;
  return (
    gap <= GAP_ACCEPT_MAX_ABSOLUTE || gap / pmCounter <= GAP_ACCEPT_MAX_PCT
  );
}

function vendorPriceInBand(
  vendorPrice: number,
  minTotalPrice: number | undefined,
  maxTotalPrice: number | undefined,
): boolean {
  if (maxTotalPrice == null) return false;
  if (vendorPrice > maxTotalPrice) return false;
  if (minTotalPrice != null && vendorPrice < minTotalPrice) return false;
  return true;
}

export interface ConvergenceAcceptInput {
  decision: Decision;
  vendorOffer: Offer;
  config: NegotiationConfig;
  classification: ClassificationResult;
  minTotalPrice: number | undefined;
  maxTotalPrice: number | undefined;
  previousPmOffer: Offer | null;
  priorMessages: ChatbotMessage[];
}

/**
 * Layered accept policies after decideNextMove — only when vendor price is in band.
 */
export function applyConvergenceAcceptPolicies(
  input: ConvergenceAcceptInput,
): Decision {
  const {
    decision,
    vendorOffer,
    config,
    classification,
    minTotalPrice,
    maxTotalPrice,
    previousPmOffer,
    priorMessages,
  } = input;

  if (vendorOffer.total_price == null) return decision;
  if (decision.action === "ACCEPT") return decision;

  const vendorPrice = vendorOffer.total_price;
  if (!vendorPriceInBand(vendorPrice, minTotalPrice, maxTotalPrice)) {
    return decision;
  }

  const acceptThreshold = config.accept_threshold ?? 0.7;
  const escalateThreshold = config.escalate_threshold ?? 0.5;
  const utility =
    decision.utilityScore > 0
      ? decision.utilityScore
      : totalUtility(config, vendorOffer);

  if (utility >= acceptThreshold) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        `Vendor offer within band [${minTotalPrice ?? "—"}, ${maxTotalPrice}] at utility ${(utility * 100).toFixed(0)}% — accept`,
      ],
    };
  }

  const priceU = priceUtility(config, vendorPrice);
  if (priceU >= PRICE_LED_ACCEPT_UTILITY) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        `Price utility ${(priceU * 100).toFixed(0)}% ≥ ${(PRICE_LED_ACCEPT_UTILITY * 100).toFixed(0)}% within max band — price-led accept`,
      ],
    };
  }

  if (classification.isMeetingProposal && utility >= escalateThreshold) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        `Meeting/convergence proposal within band at utility ${(utility * 100).toFixed(0)}% — accept as negotiator`,
      ],
    };
  }

  const pmCounter = previousPmOffer?.total_price ?? null;
  if (pmCounter != null) {
    const drops = countTrailingVendorPriceDrops(priorMessages, vendorPrice);
    if (
      drops >= GAP_ACCEPT_MIN_VENDOR_DROPS &&
      isWithinGapAbovePmCounter(vendorPrice, pmCounter)
    ) {
      return {
        action: "ACCEPT",
        utilityScore: utility,
        counterOffer: null,
        reasons: [
          ...decision.reasons,
          `Vendor within ${(GAP_ACCEPT_MAX_PCT * 100).toFixed(0)}% / ₹${GAP_ACCEPT_MAX_ABSOLUTE} of PM counter ${pmCounter} after ${drops} consecutive price drops — gap accept`,
        ],
      };
    }
  }

  return decision;
}

export interface FinalAlignmentAcceptInput {
  decision: Decision;
  vendorOffer: Offer;
  vendorMessage: string;
  config: NegotiationConfig;
  classification: ClassificationResult;
  previousPmOffer: Offer | null;
  priorMessages: ChatbotMessage[];
}

function resolveLastPmCounterFromHistory(
  priorMessages: ChatbotMessage[],
  previousPmOffer: Offer | null,
): Offer | null {
  if (previousPmOffer?.total_price != null) {
    return previousPmOffer;
  }
  const lastPm = [...priorMessages]
    .reverse()
    .find((m) => m.role === "ACCORDO" && m.counterOffer);
  return (lastPm?.counterOffer as Offer) ?? null;
}

/**
 * Final pass after counter terms/price guards — accept when aligned, not echo as COUNTER.
 */
export function applyFinalAlignmentAccept(
  input: FinalAlignmentAcceptInput,
): Decision {
  const {
    decision,
    vendorOffer,
    vendorMessage,
    config,
    classification,
    previousPmOffer,
    priorMessages,
  } = input;

  if (vendorOffer.total_price == null) return decision;
  if (decision.action === "ACCEPT") return decision;

  const utility =
    decision.utilityScore > 0
      ? decision.utilityScore
      : totalUtility(config, vendorOffer);

  const effectivePmOffer = resolveLastPmCounterFromHistory(
    priorMessages,
    previousPmOffer,
  );

  if (
    decision.action === "COUNTER" &&
    decision.counterOffer &&
    offersCommerciallyAligned(vendorOffer, decision.counterOffer)
  ) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        "PM counter matches vendor offer — accept instead of echoing the same terms",
      ],
    };
  }

  if (
    effectivePmOffer &&
    vendorOffer.total_price != null &&
    vendorOffer.total_price <= (effectivePmOffer.total_price ?? Infinity) &&
    paymentTermsCompatible(
      vendorOffer.payment_terms,
      effectivePmOffer.payment_terms,
    )
  ) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        `Vendor at or below PM counter ${effectivePmOffer.total_price} with compatible terms — accept`,
      ],
    };
  }

  const vendorPrice = vendorOffer.total_price;
  const samePriceCount = countTrailingSameVendorPrice(
    priorMessages,
    vendorPrice,
  );
  const pmCounter = effectivePmOffer?.total_price ?? null;

  if (
    pmCounter != null &&
    samePriceCount >= REPEATED_CEILING_MIN_COUNT &&
    (isVendorMaxCeilingMessage(vendorMessage) ||
      classification.isMeetingProposal) &&
    isWithinGapAbovePmCounter(vendorPrice, pmCounter)
  ) {
    return {
      action: "ACCEPT",
      utilityScore: utility,
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        `Vendor restated firm ceiling ${vendorPrice} ${samePriceCount}× within gap of PM counter ${pmCounter} — repeated-ceiling accept`,
      ],
    };
  }

  return decision;
}
