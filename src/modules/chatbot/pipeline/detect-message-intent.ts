/**
 * Rule-based message intent detection for classifyMessage() (P0).
 *
 * Flow docs reference a cheap LLM call here; P0 uses deterministic rules so
 * classifier tests run without network. LLM hook can replace/augment later.
 *
 * @source message_classifier_flow.md Step 2
 */

import { detectTermsRequest } from "../engine/parse-offer.js";
import type { ClassificationIntentType, VendorTermsRequest } from "./types.js";

export interface MessageIntentResult {
  type: ClassificationIntentType;
  confidence: number;
  termsRequest?: VendorTermsRequest;
}

export interface ParsedOfferSnapshot {
  extractedPrice: number | null;
  extractedDays: number | null;
}

const GREETING_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|greetings)\b/i,
  /\bhope you(?:'re| are) doing well\b/i,
  /\bnice to (?:meet|connect with) you\b/i,
];

const SMALL_TALK_PATTERNS: RegExp[] = [
  /\blooking forward to working (?:with|together)\b/i,
  /\bexcited to (?:collaborate|partner|work)\b/i,
  /\bpleasure to (?:work|do business)\b/i,
];

/** Off-topic for negotiation channel — distinct from scope-guard weather/sports */
const NEGOTIATION_REDIRECT_PATTERNS: RegExp[] = [
  /\b(?:send|share|provide|forward)\s+(?:me\s+)?(?:the\s+)?(?:product\s+)?(?:spec(?:ification)?s?\s+sheet|datasheet|brochure|catalogue|catalog)\b/i,
  /\b(?:product\s+)?spec(?:ification)?s?\s+sheet\b/i,
  /\bcan you (?:send|email|share)\s+(?:me\s+)?(?:the\s+)?(?:document|pdf|file|attachment)\b/i,
  /\b(?:company\s+)?(?:profile|registration|certificate)\s+(?:copy|document)\b/i,
];

const UNPARSEABLE_PATTERNS: RegExp[] = [
  /^[a-z]{5,}$/i, // single gibberish token
  /\b(?:asdf|qwer|xyz|pqr|jkl)\b/i,
];

function hasGreetingCue(message: string): boolean {
  return GREETING_PATTERNS.some((p) => p.test(message));
}

function hasSmallTalkCue(message: string): boolean {
  return SMALL_TALK_PATTERNS.some((p) => p.test(message));
}

function isNegotiationRedirect(message: string): boolean {
  return NEGOTIATION_REDIRECT_PATTERNS.some((p) => p.test(message));
}

function looksUnparseable(message: string, parsed: ParsedOfferSnapshot): boolean {
  if (parsed.extractedPrice != null || parsed.extractedDays != null) {
    return false;
  }
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return UNPARSEABLE_PATTERNS.some((p) => p.test(trimmed));
}

function hasCompleteOffer(parsed: ParsedOfferSnapshot): boolean {
  return parsed.extractedPrice != null && parsed.extractedDays != null;
}

function hasPartialOffer(parsed: ParsedOfferSnapshot): boolean {
  const hasPrice = parsed.extractedPrice != null;
  const hasTerms = parsed.extractedDays != null;
  return (hasPrice && !hasTerms) || (!hasPrice && hasTerms);
}

/**
 * Detect message intent from text + lightweight parse snapshot.
 */
export function detectMessageIntent(
  message: string,
  parsed: ParsedOfferSnapshot,
): MessageIntentResult {
  const trimmed = message.trim();

  if (trimmed.length === 0) {
    return { type: "UNPARSEABLE", confidence: 0.95 };
  }

  if (isNegotiationRedirect(trimmed) && !hasCompleteOffer(parsed)) {
    return { type: "OFF_TOPIC", confidence: 0.93 };
  }

  if (hasCompleteOffer(parsed)) {
    return { type: "NEGOTIATION_OFFER", confidence: 0.97 };
  }

  // Vendor asking PM for price at specific terms — not a partial offer statement.
  const termsRequest = detectTermsRequest(trimmed);
  if (termsRequest) {
    return {
      type: "VENDOR_TERMS_INQUIRY",
      confidence: 0.94,
      termsRequest,
    };
  }

  if (hasPartialOffer(parsed)) {
    return { type: "PARTIAL_OFFER", confidence: 0.89 };
  }

  if (looksUnparseable(trimmed, parsed)) {
    return { type: "UNPARSEABLE", confidence: 0.91 };
  }

  if (hasGreetingCue(trimmed)) {
    return { type: "GREETING", confidence: 0.95 };
  }

  if (hasSmallTalkCue(trimmed)) {
    return { type: "SMALL_TALK", confidence: 0.92 };
  }

  return { type: "UNPARSEABLE", confidence: 0.85 };
}
