/**
 * Validator for standalone PM welcome messages (no commercial terms).
 */

import { hasSocialSalutation } from "./first-pm-greeting.js";
import type { PmWelcomeContext } from "./render-pm-welcome-message.js";

const WELCOME_MIN_WORDS = 60;
const WELCOME_MAX_WORDS = 150;
const WELCOME_MIN_LINES = 4;

const WELCOME_BANNED =
  /\b(i'?m an ai|ai assistant|language model|how can i help you today|as an ai)\b/i;

const PRICE_PATTERN =
  /(?:₹|\$|€|£|¥)\s*[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/;

const SALUTATION_LINE =
  /^(good\s+(morning|afternoon|evening)|hello|hi|hey|dear|greetings|namaste)\b/i;

export class WelcomeValidationError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "WelcomeValidationError";
  }
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Preserve intentional line breaks; collapse only within-line whitespace. */
export function sanitizeWelcomeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s{2,}/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function welcomeLines(text: string): string[] {
  return text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Split a single-block welcome into salutation + one thought per line.
 */
export function normalizeWelcomeFormatting(text: string): string {
  const sanitized = sanitizeWelcomeText(text);
  const lines = welcomeLines(sanitized);
  if (lines.length >= WELCOME_MIN_LINES) {
    return lines.join("\n");
  }

  const salutationMatch = sanitized.match(
    /^((?:Good\s+(?:morning|afternoon|evening)|Hello|Hi|Hey|Dear|Greetings|Namaste)[^.]*\.)\s*/i,
  );
  if (!salutationMatch) {
    return sanitized;
  }

  const remainder = sanitized.slice(salutationMatch[0].length).trim();
  const sentences =
    remainder.match(/[^.!?]+[.!?]+(?:\s|$)/g)?.map((s) => s.trim()) ?? [];
  if (sentences.length === 0) {
    return `${salutationMatch[1]}\n${remainder}`.trim();
  }

  return [salutationMatch[1], ...sentences].join("\n");
}

export function validatePmWelcomeMessage(
  text: string,
  ctx?: PmWelcomeContext,
): string {
  let sanitized = normalizeWelcomeFormatting(text);
  sanitized = sanitizeWelcomeText(sanitized);

  if (!sanitized) {
    throw new WelcomeValidationError("empty_response");
  }

  const words = countWords(sanitized);
  if (words < WELCOME_MIN_WORDS) {
    throw new WelcomeValidationError("too_short");
  }
  if (words > WELCOME_MAX_WORDS) {
    throw new WelcomeValidationError("too_long");
  }

  if (!hasSocialSalutation(sanitized)) {
    throw new WelcomeValidationError("missing_salutation");
  }

  const lines = welcomeLines(sanitized);
  if (lines.length < WELCOME_MIN_LINES) {
    throw new WelcomeValidationError("single_paragraph");
  }

  if (!SALUTATION_LINE.test(lines[0]!)) {
    throw new WelcomeValidationError("salutation_not_first_line");
  }

  if (WELCOME_BANNED.test(sanitized)) {
    throw new WelcomeValidationError("banned_phrase");
  }

  if (PRICE_PATTERN.test(sanitized)) {
    throw new WelcomeValidationError("contains_price");
  }

  if (/\n\s*[-•*]\s/m.test(sanitized)) {
    throw new WelcomeValidationError("contains_bullets");
  }

  if (ctx?.buyerCompanyName) {
    const company = ctx.buyerCompanyName.trim();
    if (company.length > 2 && !sanitized.includes(company)) {
      throw new WelcomeValidationError("missing_company_name");
    }
  }

  if (ctx?.vendorName) {
    const vendor = ctx.vendorName.trim();
    const firstName = vendor.split(/\s+/)[0];
    if (
      firstName &&
      firstName.length > 1 &&
      !sanitized.includes(vendor) &&
      !sanitized.includes(firstName)
    ) {
      throw new WelcomeValidationError("missing_vendor_name");
    }
  }

  return sanitized;
}
