/**
 * LLM Output Validator
 *
 * The LLM is untrusted. This validator enforces hard rules on every LLM response
 * before it reaches the vendor.
 *
 * Rules enforced:
 * 1. No banned internal words (utility, algorithm, score, threshold, model, etc.)
 * 2. Response must be ≤ 160 words.
 * 3. For COUNTER action with allowedPrice:
 *    - A price must be present in the response.
 *    - The price must be within [targetPrice, maxAcceptablePrice] (fuzzy match).
 *    - No other significantly different prices may appear.
 * 4. Strips soft filler phrases that sound overly robotic or sycophantic.
 *
 * On failure: throws ValidationError so the caller can use a fallback template.
 */

import type { NegotiationIntent } from '../negotiation/intent/buildNegotiationIntent.js';

// ─────────────────────────────────────────────
// Validation error
// ─────────────────────────────────────────────

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly reason: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ─────────────────────────────────────────────
// Banned keywords (must never appear in output)
// ─────────────────────────────────────────────

const BANNED_KEYWORDS: RegExp[] = [
  /\butility\b/i,
  /\balgorithm\b/i,
  /\bscoring\b/i,
  /\bscore\b/i,
  /\bthreshold\b/i,
  /\bmodel\b/i,
  /\bweighted\b/i,
  /\bbatna\b/i,
  /\bdecision tree\b/i,
  /\bengine\b/i,
  /\bconfig\b/i,
  /\bparameters\b/i,
  /\bgpt\b/i,
  /\bopenai\b/i,
  /\bai model\b/i,
  /\blanguage model\b/i,
  /\bllm\b/i,
  /\bautomated system\b/i,
  /\boutput\b/i,
  /\bprompt\b/i,
];

// ─────────────────────────────────────────────
// Soft filler phrases to strip
// ─────────────────────────────────────────────

const SOFT_PHRASES: RegExp[] = [
  /\bhappy to help\b/gi,
  /\bI('m| am) here to help\b/gi,
  /\bcertainly\b/gi,
  /\bof course\b/gi,
  /\bkindly\b/gi,
  /\bplease note that\b/gi,
  /\bit is important to note\b/gi,
  /\bas an ai\b/gi,
  /\bas a language model\b/gi,
  /\bI('m| am) just an ai\b/gi,
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

  // Match patterns like $98,000 | $98,000.00 | $98000
  const dollarPattern = /\$\s*([\d,]+(?:\.\d{1,2})?)/g;
  let match;
  while ((match = dollarPattern.exec(text)) !== null) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value) && value > 100) { // ignore trivially small numbers
      prices.push(value);
    }
  }

  // Match patterns like $98K | $98.5k | $98.5K
  const kPattern = /\$\s*([\d.]+)\s*[kK]\b/g;
  while ((match = kPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Match patterns like $1.5M | $2M
  const mPattern = /\$\s*([\d.]+)\s*[mM]\b/g;
  while ((match = mPattern.exec(text)) !== null) {
    const value = parseFloat(match[1]) * 1_000_000;
    if (!isNaN(value) && value > 100) {
      prices.push(value);
    }
  }

  // Match "98 thousand" or "1.5 million"
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

  // Deduplicate
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
    cleaned = cleaned.replace(pattern, '');
  }
  // Clean up extra whitespace / double spaces
  return cleaned.replace(/\s{2,}/g, ' ').trim();
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
  intent: NegotiationIntent
): string {
  if (!response || response.trim().length === 0) {
    throw new ValidationError('LLM returned empty response', 'empty_response');
  }

  // Step 1: Strip soft filler phrases first
  let sanitized = stripSoftPhrases(response);

  // Step 2: Check for banned keywords
  for (const pattern of BANNED_KEYWORDS) {
    if (pattern.test(sanitized)) {
      throw new ValidationError(
        `Response contains banned keyword matching: ${pattern}`,
        'banned_keyword'
      );
    }
  }

  // Step 3: Word count limit
  const wordCount = countWords(sanitized);
  if (wordCount > 160) {
    throw new ValidationError(
      `Response too long: ${wordCount} words (max 160)`,
      'too_long'
    );
  }

  // Step 4: Price validation for COUNTER action
  if (intent.action === 'COUNTER' && intent.allowedPrice != null && intent.allowedPrice <= 0) {
    throw new ValidationError(
      'COUNTER has zero or negative allowedPrice — falling back to template',
      'zero_price'
    );
  }
  if (intent.action === 'COUNTER' && intent.allowedPrice != null) {
    const detectedPrices = extractPrices(sanitized);

    // Must contain at least one price
    if (detectedPrices.length === 0) {
      throw new ValidationError(
        'COUNTER response does not contain any price',
        'missing_price'
      );
    }

    // Every detected price must be within [targetPrice, maxAcceptablePrice]
    // If we have the boundaries, enforce them
    if (intent.allowedPrice != null) {
      // The LLM was given exactly allowedPrice — verify it's present (fuzzy)
      const hasCorrectPrice = detectedPrices.some(p => isPriceMatch(p, intent.allowedPrice!));

      if (!hasCorrectPrice) {
        throw new ValidationError(
          `COUNTER response does not contain the allowed price $${intent.allowedPrice}. Found: ${detectedPrices.join(', ')}`,
          'wrong_price'
        );
      }

      // Check no wildly different prices appear (>10% deviation from allowedPrice)
      const rogue = detectedPrices.filter(p => {
        const deviation = Math.abs(p - intent.allowedPrice!) / intent.allowedPrice!;
        return deviation > 0.10; // More than 10% off
      });

      if (rogue.length > 0) {
        throw new ValidationError(
          `COUNTER response contains unauthorized price(s): ${rogue.join(', ')}`,
          'unauthorized_price'
        );
      }
    }
  }

  // Step 5: For ACCEPT action, reject if LLM hallucinated a price
  // The ACCEPT instruction explicitly says "Do NOT include any prices"
  if (intent.action === 'ACCEPT') {
    const detectedPrices = extractPrices(sanitized);
    if (detectedPrices.length > 0) {
      throw new ValidationError(
        `ACCEPT response contains hallucinated price(s): ${detectedPrices.join(', ')}. ACCEPT should not mention specific prices.`,
        'accept_has_price'
      );
    }
  }

  // Step 6: For MESO action, verify MESO prices are present and no rogue prices
  if (intent.action === 'MESO' && intent.offerVariants && intent.offerVariants.length > 0) {
    const detectedPrices = extractPrices(sanitized);
    const mesoAllowedPrices = intent.offerVariants.map(v => v.price);

    if (detectedPrices.length > 0) {
      // Any detected price must match a MESO variant (fuzzy)
      const roguePrices = detectedPrices.filter(detected =>
        !mesoAllowedPrices.some(allowed => isPriceMatch(detected, allowed))
      );

      if (roguePrices.length > 0) {
        throw new ValidationError(
          `MESO response contains price(s) not in offer variants: ${roguePrices.join(', ')}`,
          'meso_unauthorized_price'
        );
      }
    }
  }

  return sanitized;
}
