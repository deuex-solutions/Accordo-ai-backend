/**
 * LLM Output Validator
 *
 * The LLM is untrusted. This validator enforces hard rules on every LLM response
 * before it reaches the vendor.
 *
 * Rules enforced:
 * 1. No banned internal words (utility, algorithm, score, threshold, model, etc.)
 * 2. Response length checked per-action (ACCEPT 8–60, COUNTER 25–110, MESO 25–140, etc.).
 * 3. For COUNTER action with allowedPrice:
 *    - A price must be present in the response.
 *    - The price must be within [targetPrice, maxAcceptablePrice] (fuzzy match).
 *    - No other significantly different prices may appear.
 * 4. Strips soft filler phrases that sound overly robotic or sycophantic.
 *
 * On failure: throws ValidationError so the caller can use a fallback template.
 */

import type { NegotiationIntent } from "../negotiation/intent/build-negotiation-intent.js";

// ─────────────────────────────────────────────
// Validation error
// ─────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// ─────────────────────────────────────────────
// Hard bans (Apr 2026, two-tier)
//
// Tier 1 — strategy-leak phrases that ALWAYS reject:
//   AI/system identifiers and explicit algorithm references.
// Tier 2 — context-sensitive bans (REJECT only when the word appears NEAR a
//   number or strategy verb, e.g. "our target is $4500" → leak;
//   "what's your target delivery date?" → fine).
//
// Rejection returns rule codes only — the rejected text is never logged.
// ─────────────────────────────────────────────

const HARD_BANS_ALWAYS: RegExp[] = [
  /\butility\b/i,
  /\balgorithm\b/i,
  /\bweighted\b/i,
  /\bbatna\b/i,
  /\bdecision tree\b/i,
  /\bgpt\b/i,
  /\bopenai\b/i,
  /\bai model\b/i,
  /\blanguage model\b/i,
  /\bllm\b/i,
  /\bautomated system\b/i,
  /\bas an ai\b/i,
  /\bI('m| am) (an? )?ai\b/i,
];

/**
 * Tier-2 hard bans: only fire when the keyword sits within 5 tokens of a price
 * or strategy verb. Catches "our max is $4500" but not "what's your max delivery date?".
 */
const HARD_BANS_NEAR_STRATEGY: Array<{ word: RegExp; label: string }> = [
  {
    word: /\b(target|maximum|max|ceiling|threshold|limit)\b/i,
    label: "strategy_leak_target",
  },
  { word: /\b(score|scoring)\b/i, label: "strategy_leak_score" },
  {
    word: /\b(model|engine|config|parameters?)\b/i,
    label: "strategy_leak_internal",
  },
];

const STRATEGY_PROXIMITY =
  /[\$₹€£]\s*[\d,]+|[\d,]{4,}|\b(can('?t|not)? (go|pay|exceed)|won('?t|not) (exceed|go))\b/i;

// ─────────────────────────────────────────────
// Per-action length bounds (Apr 2026, adaptive)
//
// Replaces the old blanket 160-word cap. The persona-renderer aims for these;
// the validator enforces them.
// ─────────────────────────────────────────────

const LENGTH_BOUNDS: Record<
  "ACCEPT" | "COUNTER" | "MESO" | "WALK_AWAY" | "ESCALATE" | "ASK_CLARIFY",
  { min: number; max: number }
> = {
  COUNTER: { min: 25, max: 110 },
  MESO: { min: 25, max: 140 },
  ACCEPT: { min: 8, max: 60 },
  WALK_AWAY: { min: 20, max: 90 },
  ESCALATE: { min: 20, max: 90 },
  ASK_CLARIFY: { min: 10, max: 60 },
};

// ─────────────────────────────────────────────
// Soft filler phrases to strip
// ─────────────────────────────────────────────

// Soft phrases — stripped silently, never reject for these. Stays narrow so we
// don't strip humanization touches like "honestly" or "appreciate".
const SOFT_PHRASES: RegExp[] = [
  /\bhappy to help\b/gi,
  /\bI('m| am) here to help\b/gi,
  /\bplease note that\b/gi,
  /\bit is important to note\b/gi,
];

// Weak-apology phrases — stripped silently (off-limits per spec).
const WEAK_APOLOGY_PHRASES: RegExp[] = [
  /\b(I'?m|I am) sorry to push back\b/gi,
  /\bI hate to ask\b/gi,
  /\bsorry for being difficult\b/gi,
];

// AI-tell phrases — performative-helpful filler that reads as LLM output.
// Stripped silently; the surrounding sentence usually reads fine without them.
const AI_TELL_PHRASES: RegExp[] = [
  /\bwe('d| would) love to\b/gi,
  /\bI('d| would) love to\b/gi,
  /\bthis better aligns with our needs\b/gi,
  /\blet us know your thoughts\b/gi,
  /\bfeel free to\b/gi,
  /\bI hope this helps\b/gi,
  /\bI'?m happy to discuss\b/gi,
  /\blooking forward to hearing\b/gi,
  /\bdon'?t hesitate to\b/gi,
  /\bwe appreciate your understanding\b/gi,
  /\bplease don'?t hesitate\b/gi,
  /\bwe'?re confident (that |this )?(will|can)\b/gi,
  /\bthank you for your patience\b/gi,
];

// ─────────────────────────────────────────────
// Price extraction (fuzzy)
// ─────────────────────────────────────────────

/**
 * Extract all numeric price values mentioned in text.
 * Handles: $98,000 | $98K | $98k | 98,000 | $98.5K | 98 thousand | $98000
 *
 * Returns an array of numeric values (in full dollars).
 */
function extractPrices(text: string): number[] {
  const prices: number[] = [];

  // Currency symbol pattern — covers $, £, €, ₹, and A$ (Australian dollar)
  const SYM = `(?:A\\$|\\$|£|€|₹)`;

  // Match patterns like $98,000 | £98,000.00 | €98000 | ₹1,50,000
  const basePattern = new RegExp(`${SYM}\\s*([\\d,]+(?:\\.\\d{1,2})?)`, "g");
  let match;
  while ((match = basePattern.exec(text)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Match patterns like $98K | £98.5k | ₹98.5K
  const kPattern = new RegExp(`${SYM}\\s*([\\d.]+)\\s*[kK]\\b`, "g");
  while ((match = kPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Match patterns like $1.5M | £2M | €1.2M
  const mPattern = new RegExp(`${SYM}\\s*([\\d.]+)\\s*[mM]\\b`, "g");
  while ((match = mPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1_000_000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Match "98 thousand" or "1.5 million" (currency-agnostic)
  const wordPattern = /([\d.]+)\s+thousand\b/gi;
  while ((match = wordPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }
  const millionPattern = /([\d.]+)\s+million\b/gi;
  while ((match = millionPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1_000_000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Indian numbering: lakh (100,000) and crore (10,000,000)
  const lakhPattern = /([\d.]+)\s+lakh\b/gi;
  while ((match = lakhPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 100_000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }
  const crorePattern = /([\d.]+)\s+crore\b/gi;
  while ((match = crorePattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 10_000_000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  return [...new Set(prices)];
}

/**
 * Check if a detected price is approximately equal to the reference price.
 * Tolerance: within 0.5% of reference.
 */
function isPriceMatch(detected: number, reference: number): boolean {
  const tolerance = reference * 0.005; // 0.5%
  return Math.abs(detected - reference) <= tolerance;
}

/**
 * Check if a price is within [min, max] range (inclusive, with 0.5% tolerance on bounds).
 */
function isPriceInRange(price: number, min: number, max: number): boolean {
  const lowerBound = Math.min(min, max) * 0.995;
  const upperBound = Math.max(min, max) * 1.005;
  return price >= lowerBound && price <= upperBound;
}

// ─────────────────────────────────────────────
// Word count
// ─────────────────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ─────────────────────────────────────────────
// Strip soft phrases
// ─────────────────────────────────────────────

function stripSoftPhrases(text: string): string {
  let cleaned = text;
  for (const pattern of SOFT_PHRASES) {
    cleaned = cleaned.replace(pattern, "");
  }
  // Clean up extra whitespace / double spaces
  return cleaned.replace(/\s{2,}/g, " ").trim();
}

/**
 * Apply all silent text scrubbers — soft phrases, weak apologies, AI-tells,
 * em-dashes, exclamation marks. Used by both the LLM-output validator and
 * the fallback-template renderer so vendor-facing text is consistently clean
 * regardless of source.
 *
 * Exported so callers (like fallback-templates.ts) can apply the same scrub
 * pass without re-implementing the rules.
 */
export function sanitizeText(text: string): string {
  let s = stripSoftPhrases(text);
  for (const pattern of WEAK_APOLOGY_PHRASES) s = s.replace(pattern, "");
  for (const pattern of AI_TELL_PHRASES) s = s.replace(pattern, "");
  // Em-dashes → comma. Hyphens / en-dashes preserved.
  s = s.replace(/\s*—\s*/g, ", ");
  // Exclamation marks → period.
  s = s.replace(/!/g, ".");
  // Duplicate prepositions / conjunctions glitch (e.g. "delivery by by 2026...")
  // — usually a template-concat bug where the value already starts with the
  // preposition that the template also injects. Catches "by by", "on on",
  // "with with", "at at", "in in", "for for", "to to", "of of".
  s = s.replace(/\b(by|on|with|at|in|for|to|of)\s+\1\b/gi, (_, w) => w);
  // Collapse strip artifacts.
  s = s
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\.\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
  return s;
}

// ─────────────────────────────────────────────
// Main validator
// ─────────────────────────────────────────────

/**
 * Validate and sanitize an LLM response against the NegotiationIntent.
 *
 * @param response - Raw LLM output string
 * @param intent - The NegotiationIntent that was sent to the LLM
 * @returns Sanitized response string
 * @throws ValidationError if the response violates any hard rules
 */
export function validateLlmOutput(
  response: string,
  intent: NegotiationIntent,
): string {
  if (!response || response.trim().length === 0) {
    throw new ValidationError("empty_response", "empty_response");
  }

  // Step 1: Apply all silent scrubs (soft phrases, weak apologies, AI-tells,
  // em-dashes, exclamation marks). Same pass used for fallback templates.
  let sanitized = sanitizeText(response);

  // Step 2a: Hard bans — always reject (AI/system identifiers).
  for (const pattern of HARD_BANS_ALWAYS) {
    if (pattern.test(sanitized)) {
      throw new ValidationError("banned_keyword_hard", "banned_keyword_hard");
    }
  }

  // Step 2b: Tier-2 hard bans — reject only when keyword sits within 60 chars
  // of a price/strategy verb (catches "our max is $4500" but not "max delivery").
  for (const { word, label } of HARD_BANS_NEAR_STRATEGY) {
    const m = sanitized.match(word);
    if (!m || m.index == null) continue;
    const window = sanitized.slice(
      Math.max(0, m.index - 60),
      Math.min(sanitized.length, m.index + 60),
    );
    if (STRATEGY_PROXIMITY.test(window)) {
      throw new ValidationError(label, label);
    }
  }

  // Step 3: Adaptive per-action length bounds (replaces blanket 160-word cap).
  const action = intent.action;
  const bounds = LENGTH_BOUNDS[action as keyof typeof LENGTH_BOUNDS];
  const wordCount = countWords(sanitized);
  if (bounds) {
    if (wordCount > bounds.max) {
      throw new ValidationError("too_long", "too_long");
    }
    if (wordCount < bounds.min) {
      throw new ValidationError("too_short", "too_short");
    }
  }

  // Step 4: Price validation for COUNTER action (factual checks unchanged).
  if (
    action === "COUNTER" &&
    intent.allowedPrice != null &&
    intent.allowedPrice <= 0
  ) {
    throw new ValidationError("zero_price", "zero_price");
  }
  if (action === "COUNTER" && intent.allowedPrice != null) {
    const detectedPrices = extractPrices(sanitized);
    if (detectedPrices.length === 0) {
      throw new ValidationError("missing_price", "missing_price");
    }
    const hasCorrectPrice = detectedPrices.some((p) =>
      isPriceMatch(p, intent.allowedPrice!),
    );
    if (!hasCorrectPrice) {
      throw new ValidationError("wrong_price", "wrong_price");
    }
    const rogue = detectedPrices.filter((p) => {
      const deviation =
        Math.abs(p - intent.allowedPrice!) / intent.allowedPrice!;
      return deviation > 0.1;
    });
    if (rogue.length > 0) {
      throw new ValidationError("unauthorized_price", "unauthorized_price");
    }
  }

  // Step 5: For ACCEPT action, reject if LLM hallucinated a price.
  if (action === "ACCEPT") {
    const detectedPrices = extractPrices(sanitized);
    if (detectedPrices.length > 0) {
      throw new ValidationError("accept_has_price", "accept_has_price");
    }
  }

  // Step 6: For MESO action, verify MESO prices are present and no rogue prices.
  if (
    action === "MESO" &&
    intent.offerVariants &&
    intent.offerVariants.length > 0
  ) {
    const detectedPrices = extractPrices(sanitized);
    const mesoAllowedPrices = intent.offerVariants.map((v) => v.price);
    if (detectedPrices.length > 0) {
      const roguePrices = detectedPrices.filter(
        (detected) =>
          !mesoAllowedPrices.some((allowed) => isPriceMatch(detected, allowed)),
      );
      if (roguePrices.length > 0) {
        throw new ValidationError(
          "meso_unauthorized_price",
          "meso_unauthorized_price",
        );
      }
    }
  }

  return sanitized;
}
