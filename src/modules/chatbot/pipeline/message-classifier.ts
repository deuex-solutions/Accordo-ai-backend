/**
 * Step 2 — MessageClassifier: classifyMessage()
 *
 * Runs before scoring, policy, MESO, or persona rendering.
 * Every inbound vendor message should pass through this gate (P0.1).
 *
 * @source message_classifier_flow.md Step 2
 * @source vendor_message_pipeline.md Process A
 */

import {
  detectMeetingProposal,
  parseOfferRegex,
} from "../engine/parse-offer.js";
import type { SupportedCurrency } from "../../../services/currency.service.js";
import { detectMessageIntent } from "./detect-message-intent.js";
import type {
  ClassificationIntentType,
  ClassificationResult,
  ClassificationRoute,
  DealClassificationContext,
} from "./types.js";
import { CLASSIFIER_PRICE_BAND_MULTIPLIER } from "./types.js";

export type {
  ClassificationIntentType,
  ClassificationResult,
  ClassificationRoute,
  DealClassificationContext,
} from "./types.js";
export { CLASSIFIER_PRICE_BAND_MULTIPLIER } from "./types.js";

/**
 * Build classification context from resolved nominal anchors.
 */
export function buildDealClassificationContext(
  minTotalPrice: number,
  maxTotalPrice: number,
  extras?: Omit<DealClassificationContext, "expectedPriceRange">,
): DealClassificationContext {
  return {
    expectedPriceRange: {
      min: minTotalPrice,
      max: maxTotalPrice,
    },
    ...extras,
  };
}

function evaluatePriceInRange(
  price: number | null,
  rangeMax: number,
): boolean | null {
  if (price == null) {
    return null;
  }
  const ceiling = rangeMax * CLASSIFIER_PRICE_BAND_MULTIPLIER;
  return price <= ceiling;
}

function decideRoute(
  intent: ClassificationIntentType,
  priceInRange: boolean | null,
): ClassificationRoute {
  switch (intent) {
    case "OFF_TOPIC":
      return "REDIRECT";
    case "GREETING":
    case "SMALL_TALK":
    case "UNPARSEABLE":
      return "CHAT_RESPONSE";
    case "PARTIAL_OFFER":
      return "ASK_CLARIFICATION";
    case "VENDOR_TERMS_INQUIRY":
      return "FULL_NEGOTIATION_PIPELINE";
    case "NEGOTIATION_OFFER":
      if (priceInRange === false) {
        return "SOFT_DECLINE";
      }
      return "FULL_NEGOTIATION_PIPELINE";
    default: {
      const _exhaustive: never = intent;
      return _exhaustive;
    }
  }
}

/**
 * Classify an inbound vendor message and return routing metadata.
 *
 * Does NOT call utility scoring, policy, MESO, or LLM persona rendering.
 */
export async function classifyMessage(
  message: string,
  dealContext: DealClassificationContext,
): Promise<ClassificationResult> {
  const requisitionCurrency = dealContext.currencyCode as
    | SupportedCurrency
    | undefined;
  const parsed = parseOfferRegex(message, requisitionCurrency);
  const extractedPrice = parsed.total_price ?? null;
  const extractedDays = parsed.payment_terms_days ?? null;
  const isMeetingProposal = detectMeetingProposal(message);

  const intent = detectMessageIntent(message, {
    extractedPrice,
    extractedDays,
  });
  const { type, confidence, termsRequest } = intent;

  const effectiveDays = termsRequest?.requestedDays ?? extractedDays;

  const rangeMax = dealContext.expectedPriceRange.max;
  const priceInRange = evaluatePriceInRange(extractedPrice, rangeMax);
  const route = decideRoute(type, priceInRange);

  return {
    type,
    parseable: extractedPrice != null || termsRequest != null,
    priceInRange:
      type === "VENDOR_TERMS_INQUIRY" ? true : priceInRange,
    confidence,
    extractedPrice,
    extractedDays: effectiveDays,
    route,
    ...(termsRequest ? { termsRequest } : {}),
    ...(isMeetingProposal ? { isMeetingProposal: true } : {}),
    ...(route === "SOFT_DECLINE" ? { rangeMax } : {}),
  };
}
