/**
 * Build Negotiation Intent
 *
 * Translates the deterministic engine Decision into a NegotiationIntent object.
 * This is the hard boundary between the commercial engine and the LLM renderer.
 *
 * The LLM ONLY ever sees the NegotiationIntent — never utility scores, weights,
 * thresholds, configs, or pricing formulas.
 *
 * Rules:
 * - ACCEPT:    No pricing fields exposed.
 * - COUNTER:   allowedPrice must be within [targetPrice, maxAcceptablePrice].
 * - WALK_AWAY: No pricing fields exposed.
 * - ESCALATE:  No pricing fields exposed.
 * - MESO:      offerVariants passed through unchanged from engine.
 *
 * Zero external dependencies (except a small currency-symbol map).
 */

// ─────────────────────────────────────────────
// Currency symbol lookup (no external deps)
// ─────────────────────────────────────────────

const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  USD: "$",
  INR: "₹",
  EUR: "€",
  GBP: "£",
  AUD: "A$",
};

export function getCurrencySymbol(code?: string): string {
  return CURRENCY_SYMBOL_MAP[(code || "USD").toUpperCase()] || "$";
}

/**
 * Format a price with locale-aware grouping and currency symbol.
 * Uses en-IN for INR (₹3,55,000) and en-US for others ($355,000).
 * Strips .00 decimals for whole numbers.
 */
function formatPriceForDisplay(amount: number, currencyCode?: string): string {
  const code = (currencyCode || "USD").toUpperCase();
  const symbol = CURRENCY_SYMBOL_MAP[code] || "$";
  const locale = code === "INR" ? "en-IN" : "en-US";
  const isWhole = amount === Math.floor(amount);
  const formatted = amount.toLocaleString(locale, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: isWhole ? 0 : 2,
  });
  return `${symbol}${formatted}`;
}

/**
 * Round a price to a clean, human-sounding number.
 * Procurement managers don't quote to the penny.
 *
 * Rules:
 * - < $1,000:      round to nearest $10
 * - $1,000–$9,999: round to nearest $50
 * - $10K–$99,999:  round to nearest $500
 * - $100K–$999K:   round to nearest $1,000
 * - $1M+:          round to nearest $5,000
 *
 * Always rounds UP (ceil) to avoid accidentally going below target.
 */
export function humanRoundPrice(price: number): number {
  if (price <= 0) return price;

  let step: number;
  if (price < 1_000) step = 10;
  else if (price < 10_000) step = 50;
  else if (price < 100_000) step = 500;
  else if (price < 1_000_000) step = 1_000;
  else step = 5_000;

  return Math.ceil(price / step) * step;
}

/**
 * Convert ISO-style dates to human-readable format for vendor-facing messages.
 * "2026-03-15" → "March 15, 2026"
 * "2026-03-15T00:00:00Z" → "March 15, 2026"
 * Anything else passes through unchanged.
 */
function humanizeDeliveryDate(delivery: string): string {
  const isoMatch = delivery.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthName = months[parseInt(month, 10) - 1];
    const dayNum = parseInt(day, 10);
    // Omit year when it's the current year (May 2026 humanization)
    const currentYear = new Date().getFullYear().toString();
    if (year === currentYear) {
      return `${monthName} ${dayNum}`;
    }
    return `${monthName} ${dayNum}, ${year}`;
  }
  return delivery;
}

/**
 * Format an ISO date string for use in MESO descriptions, system messages,
 * and any engine-generated text. Exported so meso.ts and other modules can
 * share the same formatting. (May 2026)
 */
export function formatHumanDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  return humanizeDeliveryDate(isoDate);
}

/**
 * Normalize delivery strings: humanize ISO dates, strip leading prepositions
 * to prevent "by by" or "on on" when templates prepend their own preposition.
 */
function normalizeDelivery(
  delivery: string | null | undefined,
): string | undefined {
  if (!delivery) return undefined;
  let normalized = humanizeDeliveryDate(delivery.trim());
  normalized = normalized
    .replace(/^\s*(by|on|within|before|after)\s+/i, "")
    .trim();
  return normalized || undefined;
}

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type NegotiationAction =
  | "ACCEPT"
  | "COUNTER"
  | "ESCALATE"
  | "WALK_AWAY"
  | "MESO"
  | "ASK_CLARIFY";

export type VendorTone = "formal" | "casual" | "urgent" | "firm" | "friendly";

export interface MesoOfferVariant {
  label: string;
  price: number;
  paymentTerms: string;
  description: string;
}

/**
 * The ONLY object the LLM renderer ever receives from the commercial engine.
 * Every field is safe to expose to the LLM — no scores, no weights, no formulas.
 */
export interface NegotiationIntent {
  /** What action the engine decided */
  action: NegotiationAction;

  /**
   * Firmness level derived from utility gap (0 = soft, 1 = hard).
   * Tells the LLM how assertive to sound.
   * Utility ≥80% → 0.15 | 65–80% → 0.35 | 50–65% → 0.55 | 35–50% → 0.75 | <35% → 0.90
   */
  firmness: number;

  /**
   * A fixed, pre-written phrase describing the commercial position.
   * Selected deterministically — never generated by the LLM.
   */
  commercialPosition: string;

  /**
   * The ONLY price the LLM is allowed to mention in a COUNTER response.
   * Always within [targetPrice, maxAcceptablePrice].
   * Absent for ACCEPT, WALK_AWAY, ESCALATE.
   */
  allowedPrice?: number;

  /**
   * Payment terms for COUNTER responses (e.g. "Net 60").
   * Absent for non-COUNTER actions.
   */
  allowedPaymentTerms?: string;

  /**
   * Delivery information for COUNTER responses.
   * Absent for non-COUNTER actions.
   */
  allowedDelivery?: string;

  /**
   * The primary parameter with the lowest utility score for COUNTER responses.
   * Only 'price', 'terms', or 'delivery' — NEVER 'warranty' or 'quality'.
   * Used to help the LLM address the weakest negotiation dimension naturally.
   * Absent for non-COUNTER actions or when primary params are all strong.
   */
  weakestPrimaryParameter?: "price" | "terms" | "delivery";

  /**
   * MESO offer variants, passed through unchanged from the engine.
   * The LLM may only present these — never modify or invent them.
   */
  offerVariants?: MesoOfferVariant[];

  /** Vendor concerns to acknowledge (e.g. supply chain, timeline) */
  acknowledgeConcerns: string[];

  /** Detected vendor tone — drives phrasing style in the LLM response */
  vendorTone: VendorTone;

  /** Currency symbol for price display (e.g. "$", "₹", "€"). Defaults to "$" if not set. */
  currencySymbol: string;

  // ── Humanization signals (Apr 2026) ─────────────────────────────────────
  // Optional and additive: legacy callers that don't supply these still work.

  /**
   * Deterministic vendor-style signals derived from the latest vendor message.
   * Drives adaptive humanization (formality mirroring, language choice, hostility
   * neutralizing, smalltalk redirect, price-before-question ordering, etc.).
   */
  vendorStyle?: VendorStyleSignals;

  /** 1-indexed round number. Persona-renderer suppresses greetings when > 1. */
  roundNumber?: number;

  /**
   * Recent phrasing fingerprints already used in this deal — the renderer
   * passes these to the LLM and the fallback selector uses them to avoid
   * repeating the same opener. See src/llm/phrasing-history.ts.
   */
  phrasingHistory?: string[];

  /**
   * Vendor questions previously asked but not yet answered. The LLM is told
   * to address these before continuing the negotiation thread.
   */
  openQuestions?: Array<{ question: string; askedAtRound: number }>;

  /**
   * Indicates the vendor moved their price toward our position since last round.
   * 'significant' (>=5% drop), 'moderate' (2–5%), 'minor' (<2%), or undefined
   * (no movement, increase, or first round). Used by the persona-renderer to
   * acknowledge concessions naturally.
   */
  vendorMovement?: "significant" | "moderate" | "minor";

  /**
   * Vendor's last stated price, pre-formatted with locale-aware currency
   * (e.g. "₹3,55,000" or "$26,000"). When present, the persona-renderer
   * instructs the LLM to echo this exact string instead of raw numbers.
   * Only set when the vendor has stated a price.
   */
  vendorPriceFormatted?: string;
}

/**
 * Subset of VendorStyle (defined in tone-detector) safe to forward to the LLM
 * layer. Kept minimal and structural to avoid cross-module type coupling.
 */
export interface VendorStyleSignals {
  formality: number;
  length: number;
  language: "en" | "es" | "hi" | "fr" | "de" | "pt" | "und";
  languageConfidence: number;
  hostility: boolean;
  hasQuestion: boolean;
  isNumberOnly: boolean;
  hasGreeting: boolean;
  repeatedOfferCount: number;
  lastVendorPrice: number | null;
  acceptanceDetected: boolean;
}

// ─────────────────────────────────────────────
// Fixed Commercial Position Templates
// Selected by action + firmness — NO AI generation
// ─────────────────────────────────────────────

const COMMERCIAL_POSITIONS: Record<
  NegotiationAction,
  Record<string, string[]>
> = {
  ACCEPT: {
    default: [
      "The terms work for us and we're good to move forward.",
      "This lines up with what we need, we're confirming.",
      "We're on board with this, let's get it wrapped up.",
    ],
    friendly: [
      "Really happy with where we landed on this one.",
      "This works well for both sides, glad we got here.",
      "Great outcome, looking forward to getting started.",
    ],
    formal: [
      "We confirm acceptance of the terms as discussed.",
      "The terms meet our requirements and we are prepared to proceed.",
    ],
  },
  COUNTER: {
    high_firmness: [
      "We don't have much room on this one and need to hold here.",
      "The budget on this is tight, so we need to stay close to these numbers.",
      "We've looked at this internally and can't stretch much further.",
    ],
    medium_firmness: [
      "We think there's a fair landing zone here and this is what works on our end.",
      "We're trying to find something that makes sense for both sides.",
      "Here's where we can be on this, hoping we can meet somewhere close.",
    ],
    low_firmness: [
      "We're flexible here and want to find something that works for everyone.",
      "There's room to work with on our side, so here's what we're thinking.",
      "We want to make this work and are open to finding the right fit.",
    ],
    urgent: [
      "We're on a timeline here and need to land on terms soon.",
      "Need to move on this quickly, so here's where we are.",
      "We're pressed for time and hoping to close this out.",
    ],
  },
  WALK_AWAY: {
    default: [
      "We've given this a good look but the terms aren't going to work for us.",
      "Unfortunately the gap is too wide for us to close on this one.",
      "We're not going to be able to make this work at these terms.",
    ],
    firm: [
      "We've reached as far as we can go on this.",
      "The numbers just aren't workable for us at this point.",
    ],
  },
  ESCALATE: {
    default: [
      "We'd like to loop in our senior team to continue this discussion.",
      "This one needs a bit more review on our end before we can move forward.",
      "Going to bring in our procurement lead to pick this up.",
    ],
  },
  MESO: {
    default: [
      "We've put together a few options that might work.",
      "Here are some alternatives we think could land well for both sides.",
      "We're offering a few different paths forward on this.",
    ],
  },
  ASK_CLARIFY: {
    default: [
      "We need a couple more details before we can come back with a proper response.",
      "Can you fill in a few gaps for us so we can move this along?",
      "Just need a bit more info on your end to keep things moving.",
    ],
  },
};

/**
 * Select a commercial position phrase deterministically.
 * Rotates through available phrases by round number to avoid repetition.
 * No LLM involved — purely a lookup.
 */
function selectCommercialPosition(
  action: NegotiationAction,
  firmness: number,
  tone: VendorTone,
  roundNumber?: number,
): string {
  const pool = COMMERCIAL_POSITIONS[action];
  const round = roundNumber ?? 1;

  let phrases: string[];

  if (action === "COUNTER") {
    if (firmness >= 0.7) phrases = pool["high_firmness"];
    else if (firmness >= 0.5) phrases = pool["medium_firmness"];
    else if (tone === "urgent") phrases = pool["urgent"];
    else phrases = pool["low_firmness"];
  } else if (action === "ACCEPT") {
    if (tone === "friendly") phrases = pool["friendly"];
    else if (tone === "formal") phrases = pool["formal"];
    else phrases = pool["default"];
  } else if (action === "WALK_AWAY") {
    if (tone === "firm") phrases = pool["firm"];
    else phrases = pool["default"];
  } else {
    phrases = pool["default"] ?? [
      "We are working toward a mutually beneficial agreement.",
    ];
  }

  const safeRound = Math.max(1, round);
  const idx = (safeRound - 1) % phrases.length;
  return phrases[idx];
}

// ─────────────────────────────────────────────
// Firmness mapping from utility score
// ─────────────────────────────────────────────

/**
 * Map a utility score (0–1) to a firmness value (0–1).
 * Higher firmness = more assertive LLM tone.
 *
 * Utility ≥ 80%  → firmness 0.15  (near acceptance, very soft)
 * Utility 65–80% → firmness 0.35  (comfortable zone, warm)
 * Utility 50–65% → firmness 0.55  (negotiating zone, moderate)
 * Utility 35–50% → firmness 0.75  (escalation zone, firm)
 * Utility < 35%  → firmness 0.90  (walk-away zone, very firm)
 */
export function mapUtilityToFirmness(utilityScore: number): number {
  if (utilityScore >= 0.8) return 0.15;
  if (utilityScore >= 0.65) return 0.35;
  if (utilityScore >= 0.5) return 0.55;
  if (utilityScore >= 0.35) return 0.75;
  return 0.9;
}

// ─────────────────────────────────────────────
// Price boundary guard
// ─────────────────────────────────────────────

/**
 * Ensures allowedPrice stays within [targetPrice, maxAcceptablePrice].
 * If counterPrice is outside bounds, clamp it.
 * Returns undefined if bounds are not available (safe fallback).
 */
function resolveAllowedPrice(
  counterPrice: number | null | undefined,
  targetPrice?: number,
  maxAcceptablePrice?: number,
): number | undefined {
  if (counterPrice == null) return undefined;
  if (targetPrice == null || maxAcceptablePrice == null) return counterPrice;

  const min = Math.min(targetPrice, maxAcceptablePrice);
  const max = Math.max(targetPrice, maxAcceptablePrice);

  // Clamp within valid range
  return Math.min(max, Math.max(min, counterPrice));
}

// ─────────────────────────────────────────────
// Main builder function
// ─────────────────────────────────────────────

export interface BuildIntentInput {
  /** Decision action from the engine */
  action: "ACCEPT" | "COUNTER" | "ESCALATE" | "WALK_AWAY" | "ASK_CLARIFY";
  /** Raw utility score from the engine (0–1) */
  utilityScore: number;
  /** Counter-offer price from the engine (only used for COUNTER) */
  counterPrice?: number | null;
  /** Counter-offer payment terms from the engine (only used for COUNTER) */
  counterPaymentTerms?: string | null;
  /** Counter-offer delivery info from the engine (only used for COUNTER) */
  counterDelivery?: string | null;
  /** Vendor concerns detected in conversation */
  concerns: string[];
  /** Detected vendor tone */
  tone: VendorTone;
  /** MESO offer variants from the engine (only used for MESO action) */
  mesoOffers?: MesoOfferVariant[];
  /** PM's target price — used to validate allowedPrice boundary */
  targetPrice?: number;
  /** PM's maximum acceptable price — used to validate allowedPrice boundary */
  maxAcceptablePrice?: number;
  /**
   * The primary negotiation parameter with the lowest utility, for COUNTER responses only.
   * Only 'price', 'terms', or 'delivery' — warranty/quality are NEVER surfaced to vendor.
   * Computed in conversationService from parameterUtilities before calling buildNegotiationIntent.
   */
  weakestPrimaryParameter?: "price" | "terms" | "delivery";
  /** Currency code from the negotiation config (e.g. "USD", "INR"). Defaults to "USD". */
  currencyCode?: string;

  // ── Humanization signals (Apr 2026) — all optional, additive ─────────────
  /** Deterministic vendor-style signals from tone-detector.detectVendorStyle(). */
  vendorStyle?: VendorStyleSignals;
  /** 1-indexed round number; round 1 allows greetings, > 1 suppresses them. */
  roundNumber?: number;
  /** Recent phrasing fingerprints for this deal — see src/llm/phrasing-history.ts. */
  phrasingHistory?: string[];
  /** Vendor questions previously asked but not yet answered. */
  openQuestions?: Array<{ question: string; askedAtRound: number }>;
  /** Vendor price-movement signal: 'significant', 'moderate', 'minor', or undefined. */
  vendorMovement?: "significant" | "moderate" | "minor";
}

/**
 * Build a NegotiationIntent from an engine Decision.
 *
 * This is the only bridge between the commercial engine and the LLM.
 * All commercial intelligence is distilled into safe, presentation-ready fields.
 */
export function buildNegotiationIntent(
  input: BuildIntentInput,
): NegotiationIntent {
  const {
    action,
    utilityScore,
    counterPrice,
    counterPaymentTerms,
    counterDelivery,
    concerns,
    tone,
    mesoOffers,
    targetPrice,
    maxAcceptablePrice,
    weakestPrimaryParameter,
    currencyCode,
    vendorStyle,
    roundNumber,
    phrasingHistory,
    openQuestions,
  } = input;

  // Determine if this is a MESO action (overrides base action when variants present)
  const finalAction: NegotiationAction =
    mesoOffers && mesoOffers.length > 0 ? "MESO" : action;

  const firmness = mapUtilityToFirmness(utilityScore);
  const commercialPosition = selectCommercialPosition(
    finalAction,
    firmness,
    tone,
    input.roundNumber,
  );

  const intent: NegotiationIntent = {
    action: finalAction,
    firmness,
    commercialPosition,
    acknowledgeConcerns: concerns,
    vendorTone: tone,
    currencySymbol: getCurrencySymbol(currencyCode),
  };

  // Forward humanization signals when supplied. Hard boundary still holds:
  // none of these contain utility scores, weights, thresholds, or config.
  if (vendorStyle) intent.vendorStyle = vendorStyle;
  if (roundNumber != null) intent.roundNumber = roundNumber;
  if (phrasingHistory && phrasingHistory.length > 0)
    intent.phrasingHistory = phrasingHistory;
  if (openQuestions && openQuestions.length > 0)
    intent.openQuestions = openQuestions;
  if (input.vendorMovement) intent.vendorMovement = input.vendorMovement;

  // Format the vendor's last stated price for display (May 2026).
  // The LLM echoes this exact string instead of inventing its own formatting.
  if (vendorStyle?.lastVendorPrice != null && vendorStyle.lastVendorPrice > 0) {
    intent.vendorPriceFormatted = formatPriceForDisplay(
      vendorStyle.lastVendorPrice,
      input.currencyCode,
    );
  }

  // Only COUNTER gets pricing fields and weakest parameter signal
  if (finalAction === "COUNTER" && counterPrice != null) {
    let resolved = resolveAllowedPrice(
      counterPrice,
      targetPrice,
      maxAcceptablePrice,
    );
    // Guard: never allow $0 counter-offer — fall back to target price
    if (resolved != null && resolved <= 0 && targetPrice && targetPrice > 0) {
      resolved = targetPrice;
    }
    if (resolved != null) {
      let humanPrice = humanRoundPrice(resolved);
      if (maxAcceptablePrice != null && humanPrice > maxAcceptablePrice) {
        humanPrice = maxAcceptablePrice;
      }
      intent.allowedPrice = humanPrice;
    }
    if (counterPaymentTerms) {
      intent.allowedPaymentTerms = counterPaymentTerms;
    }
    if (counterDelivery) {
      intent.allowedDelivery = normalizeDelivery(counterDelivery);
    }
    // Pass weakest primary parameter only for COUNTER — helps LLM focus the response.
    // Only 'price', 'terms', 'delivery' can appear here — warranty/quality are never surfaced.
    if (weakestPrimaryParameter) {
      intent.weakestPrimaryParameter = weakestPrimaryParameter;
    }
  }

  // MESO passes offer variants through unchanged
  if (finalAction === "MESO" && mesoOffers) {
    intent.offerVariants = mesoOffers;
  }

  // ACCEPT, WALK_AWAY, ESCALATE, ASK_CLARIFY: no pricing fields

  return intent;
}
