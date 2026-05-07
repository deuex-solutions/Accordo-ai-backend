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

// ─────────────────────────────────────────────
// Same-message opener deduplication (May 2026)
// ─────────────────────────────────────────────

/** Common opener phrases that LLMs love to repeat within the same message. */
const DEDUP_OPENER_PATTERNS = [
  /\bI appreciate\b/i,
  /\bthank you for\b/i,
  /\bthanks for\b/i,
  /\bI understand\b/i,
  /\bI hear you\b/i,
];

/**
 * If the same opener phrase appears in two separate sentences within the
 * same message, remove the sentence containing the second occurrence.
 * This prevents "I appreciate your offer. ... I appreciate your position."
 */
function deduplicateOpeners(text: string): string {
  // Split into sentences (period/question mark boundaries)
  const sentences = text.split(/(?<=[.?])\s+/);
  if (sentences.length < 2) return text;

  const usedOpeners = new Set<number>();
  const keep: string[] = [];

  for (const sentence of sentences) {
    let isDuplicate = false;
    for (let i = 0; i < DEDUP_OPENER_PATTERNS.length; i++) {
      if (DEDUP_OPENER_PATTERNS[i].test(sentence)) {
        if (usedOpeners.has(i)) {
          // This opener already appeared in a prior sentence — skip this one
          isDuplicate = true;
          break;
        }
        usedOpeners.add(i);
      }
    }
    if (!isDuplicate) {
      keep.push(sentence);
    }
  }

  return keep.join(" ");
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
  // Basic grammar fixes — catch common LLM output issues silently.
  // 1. Capitalize the first letter of the message.
  if (s.length > 0 && /^[a-z]/.test(s)) {
    s = s[0].toUpperCase() + s.slice(1);
  }
  // 2. Capitalize first letter after sentence-ending punctuation.
  s = s.replace(/([.?])\s+([a-z])/g, (_, p, c) => `${p} ${c.toUpperCase()}`);
  // 3. Fix missing space after period/comma before a word.
  s = s.replace(/([.,])([A-Za-z])/g, "$1 $2");
  // 4. Fix double periods (LLM sometimes generates "terms.." or "forward..")
  s = s.replace(/\.{2,}/g, ".");
  // 4b. Convert ISO dates (YYYY-MM-DD) to "Month Day" format (May 2026).
  // LLM sometimes outputs "2026-06-05" despite Rule 17. Silently fix it.
  const ISO_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  s = s.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, yr, mo, dy) => {
    const monthName = ISO_MONTHS[parseInt(mo, 10) - 1];
    if (!monthName) return `${yr}-${mo}-${dy}`;
    const dayNum = parseInt(dy, 10);
    const currentYear = new Date().getFullYear().toString();
    return yr === currentYear ? `${monthName} ${dayNum}` : `${monthName} ${dayNum}, ${yr}`;
  });

  // 5. Subject-verb agreement fix: plural noun + "is" → "are".
  // Catches common LLM errors like "arrangements is", "terms is", "options is".
  s = s.replace(
    /\b(arrangements|terms|conditions|options|considerations|requirements|details|numbers|prices|specs|specifications|factors|alternatives|concerns)\s+is\b/gi,
    (_, noun) => `${noun} are`,
  );

  // 6. Same-message opener dedup (May 2026): if the same opener phrase appears
  // in two separate sentences, remove the second occurrence's sentence.
  // Catches "I appreciate your offer. ... I appreciate your position." etc.
  s = deduplicateOpeners(s);

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

  // Step 7: Fabrication catch — reject if LLM invents vendor concerns that
  // were never in the instruction. Rule 16 in the system prompt bans this,
  // but the LLM occasionally ignores prompt-level constraints, so a
  // validator-level safety net is necessary.
  if (
    action === "COUNTER" ||
    action === "MESO" ||
    action === "WALK_AWAY" ||
    action === "ESCALATE"
  ) {
    const fabricationPatterns: RegExp[] = [
      /\b(your|the vendor'?s?)\s+(cash ?flow|budget|financial|margin|overhead|payment\s+terms?)\s+(pressures?|constraints?|concerns?|considerations?|situations?|challenges?|issues?|limitations?|difficult\w*|needs?|problems?|requirements?|realit\w*|priorit\w*|arrangements?)/i,
      /\bunderstand\s+(your|the)\s+(cash ?flow|budget|financial|margin|payment\s+terms?)\s+(pressures?|constraints?|concerns?|considerations?|situations?|challenges?|needs?|problems?|requirements?|arrangements?)/i,
      /\bhear you on\s+(the\s+)?(cash ?flow|budget|financial|margin|payment\s+terms?)/i,
      /\b(tight|limited|stretched|squeezed)\s+(budget|cash ?flow|margin|financial|payment\s+terms?)/i,
      /\b(cash ?flow|budget|margin)\s+(is|seems?|must be|looks?)\s+(tight|limited|stretched|squeezed|challenging)/i,
      /\b(my boss|my manager|management)\s+(said|told|asked|wants|insisted|requires)/i,
      // Catch "Given/considering cash flow considerations/needs" pattern
      /\b(given|considering|acknowledging|recognizing|noting)\s+(your\s+)?(cash ?flow|budget|financial|margin|payment\s+terms?)\s+(considerations?|concerns?|constraints?|needs?|situations?|requirements?|priorit\w*|realit\w*|positions?|arrangements?)/i,
      // Catch "X is a factor" templatic fabrication
      /\b(cash ?flow|budget|margin|overhead|cost structure|financial arrangements?|financial considerations?|payment\s+terms?)\s+(is|are)\s+(a\s+)?(factor|considerations?|concerns?|priorit\w*|issues?)/i,
      // Catch "your/their financial arrangements" fabrication (not "payment arrangements" in general)
      /\b(your|their|the vendor'?s?)\s+(financial|current)\s+arrangements?/i,
    ];

    const concernsAllowed = intent.acknowledgeConcerns ?? [];
    const hasConcernInstruction = concernsAllowed.length > 0;

    for (const pattern of fabricationPatterns) {
      if (pattern.test(sanitized)) {
        // Only reject if the concern wasn't explicitly listed in acknowledgeConcerns
        const matchedText = sanitized.match(pattern)?.[0] ?? "";
        const isCovered = hasConcernInstruction && concernsAllowed.some(
          (c) => matchedText.toLowerCase().includes(c.toLowerCase()),
        );
        if (!isCovered) {
          throw new ValidationError(
            "fabricated_concern",
            "fabricated_concern",
          );
        }
      }
    }
  }

  // 6. Price normalization: replace any price token with the exact formatted
  //    allowedPrice so the LLM can't reformat prices (e.g. "349000" → "3,49,000").
  if (intent.allowedPrice != null && intent.currencySymbol) {
    const priceLocale = intent.currencySymbol === "₹" ? "en-IN" : "en-US";
    const formattedPrice = intent.allowedPrice.toLocaleString(priceLocale);
    const expectedFormatted = `${intent.currencySymbol}${formattedPrice}`;

    // Build regex that matches the currency symbol followed by any numeric
    // representation of the allowed price (with/without commas, with/without
    // decimal, with K/L/Cr suffix, or plain digits).
    // We match: ₹349000, ₹3,49,000, ₹349,000, ₹349K, ₹3.49L, etc.
    const escapedSymbol = intent.currencySymbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const priceDigits = String(Math.round(intent.allowedPrice));

    // Match currency symbol + any comma-grouped or plain number that rounds
    // to the same integer value as allowedPrice
    const pricePattern = new RegExp(
      `${escapedSymbol}\\s*[\\d,]+(?:\\.\\d+)?(?:\\s*(?:K|L|Cr|lakh|crore))?`,
      "gi",
    );

    sanitized = sanitized.replace(pricePattern, (match) => {
      // Extract numeric value from the matched price
      const numericStr = match
        .replace(new RegExp(escapedSymbol, "g"), "")
        .replace(/,/g, "")
        .trim();
      let matchedValue: number;

      if (/\d+(\.\d+)?\s*(cr|crore)/i.test(numericStr)) {
        matchedValue = parseFloat(numericStr) * 10000000;
      } else if (/\d+(\.\d+)?\s*(l|lakh)/i.test(numericStr)) {
        matchedValue = parseFloat(numericStr) * 100000;
      } else if (/\d+(\.\d+)?\s*k/i.test(numericStr)) {
        matchedValue = parseFloat(numericStr) * 1000;
      } else {
        matchedValue = parseFloat(numericStr);
      }

      // Only replace if the matched value rounds to the same integer as allowedPrice
      // (tolerance: within 1% to catch rounding differences)
      if (
        !isNaN(matchedValue) &&
        Math.abs(matchedValue - intent.allowedPrice!) / intent.allowedPrice! < 0.01
      ) {
        return expectedFormatted;
      }
      return match; // Different price (e.g. vendor's price echo) — leave as-is
    });
  }

  return sanitized;
}
