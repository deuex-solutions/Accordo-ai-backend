import {
  Decision,
  Offer,
  extractPaymentDays,
  formatPaymentTerms,
  NegotiationState,
  PmCounterRecord,
  BehavioralSignals,
  AdaptiveStrategyResult,
  DynamicRoundConfig,
  ExtendedOffer,
  WizardConfig,
  ResolvedNegotiationConfig,
} from "./types.js";
import {
  totalUtility,
  NegotiationConfig,
} from "./utility.js";
import { getCurrencySymbol } from "../../../negotiation/intent/build-negotiation-intent.js";
import {
  resolveNegotiationConfig,
  calculateWeightedUtilityFromResolved,
} from "./weighted-utility.js";
import {
  getTotalPriceConcession,
  isInPreferenceExploration,
  getPreferenceExplorationRoundsRemaining,
  isNegotiationStalled,
  isVendorRigid,
  getUtilityTrend,
} from "./preference-detector.js";
import * as negotiationLogger from "./negotiation-logger.js";

/**
 * Extract the vendor's stated maximum payment terms from their message.
 * Handles patterns like:
 *   "max I can do is net 60"
 *   "maximum we can offer is net 45"
 *   "can only do net 30"
 *   "net 90 not possible, max net 60"
 *
 * Returns the max days the vendor is willing to offer, or null if not stated.
 */
export function extractVendorMaxTermsDays(
  vendorMessage?: string | null,
): number | null {
  if (!vendorMessage) return null;
  const lower = vendorMessage.toLowerCase();

  // Pattern 1: "max/maximum [I/we] can [do/offer/accept] is net X"
  const maxPattern =
    /\b(?:max(?:imum)?|most)\s+(?:i|we)\s+can\s+(?:do|offer|accept|go|provide)\s+is\s+net\s*(\d+)/i;
  const maxMatch = lower.match(maxPattern);
  if (maxMatch) return parseInt(maxMatch[1], 10);

  // Pattern 2: "can only [do/offer] net X"
  const onlyPattern =
    /\bcan\s+only\s+(?:do|offer|accept|go|provide)\s+net\s*(\d+)/i;
  const onlyMatch = lower.match(onlyPattern);
  if (onlyMatch) return parseInt(onlyMatch[1], 10);

  // Pattern 3: "net X not possible" + "max net Y" or "net Y max"
  const notPossibleWithMax =
    /net\s*(\d+)\s+(?:is\s+)?not\s+possible.*?(?:max(?:imum)?\s+(?:is\s+)?net\s*(\d+)|net\s*(\d+)\s+(?:is\s+)?(?:the\s+)?max)/i;
  const notPossMatch = lower.match(notPossibleWithMax);
  if (notPossMatch) return parseInt(notPossMatch[2] || notPossMatch[3], 10);

  // Pattern 4: "max [is] net X" / "maximum net X"
  const simpleMax = /\b(?:max(?:imum)?)\s+(?:is\s+)?net\s*(\d+)/i;
  const simpleMaxMatch = lower.match(simpleMax);
  if (simpleMaxMatch) return parseInt(simpleMaxMatch[1], 10);

  // Pattern 5: "net X is [the/our] max/maximum/limit"
  const termsIsMax =
    /net\s*(\d+)\s+(?:is\s+)?(?:the\s+|our\s+)?(?:max(?:imum)?|limit|best\s+(?:i|we)\s+can\s+(?:do|offer))/i;
  const termsIsMaxMatch = lower.match(termsIsMax);
  if (termsIsMaxMatch) return parseInt(termsIsMaxMatch[1], 10);

  return null;
}

/**
 * Cap the chosen payment terms to not exceed the vendor's stated maximum.
 * If vendor said "max net 60", ensure we don't counter with net 90.
 */
export function capTermsToVendorMax(
  chosenTerms: string,
  vendorMaxDays: number,
): string {
  const chosenDays = extractPaymentDays(chosenTerms);
  if (chosenDays === null) return chosenTerms;

  if (chosenDays > vendorMaxDays) {
    return `Net ${vendorMaxDays}`;
  }
  return chosenTerms;
}

/**
 * Decision Engine with Weighted Utility Thresholds
 *
 * Threshold Zones (based on cumulative weighted utility):
 * - Accept Zone:    utility >= 70% (accept_threshold)
 * - Counter Zone:   50% <= utility < 70% (escalate_threshold to accept_threshold)
 * - Escalate Zone:  30% <= utility < 50% (walkaway_threshold to escalate_threshold)
 * - Walk Away Zone: utility < 30% (walkaway_threshold)
 *
 * Default thresholds: accept=0.70, escalate=0.50, walkaway=0.30
 */

/**
 * Get delivery date and days for counter-offer
 * Uses vendor's delivery if provided, otherwise falls back to config or 30-day default
 */
function getDeliveryForCounter(
  vendorOffer: Offer,
  config: NegotiationConfig,
): { delivery_date: string; delivery_days: number } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Priority 1: Use vendor's delivery if provided
  if (vendorOffer.delivery_date) {
    const deliveryDate = new Date(vendorOffer.delivery_date);
    const days = Math.ceil(
      (deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      delivery_date: vendorOffer.delivery_date,
      delivery_days: Math.max(1, days),
    };
  }

  // Priority 2: Use vendor's delivery_days if provided
  if (vendorOffer.delivery_days && vendorOffer.delivery_days > 0) {
    const deliveryDate = new Date(today);
    deliveryDate.setDate(deliveryDate.getDate() + vendorOffer.delivery_days);
    return {
      delivery_date: deliveryDate.toISOString().split("T")[0],
      delivery_days: vendorOffer.delivery_days,
    };
  }

  // Priority 3: Use config delivery if available
  // Note: config doesn't currently have delivery, but we'll check anyway for future compatibility
  const configDelivery = (
    config as unknown as {
      delivery?: { requiredDate?: string; preferredDate?: string };
    }
  ).delivery;
  if (configDelivery?.preferredDate || configDelivery?.requiredDate) {
    const dateStr =
      configDelivery.preferredDate || configDelivery.requiredDate!;
    const deliveryDate = new Date(dateStr);
    const days = Math.ceil(
      (deliveryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return {
      delivery_date: dateStr,
      delivery_days: Math.max(1, days),
    };
  }

  // Priority 4: Default to 30 days
  const defaultDate = new Date(today);
  defaultDate.setDate(defaultDate.getDate() + 30);
  return {
    delivery_date: defaultDate.toISOString().split("T")[0],
    delivery_days: 30,
  };
}

/**
 * Get the next better payment terms for buyer
 * UPDATED January 2026: Now supports any "Net X" format
 *
 * Strategy: If current terms are standard (30/60/90), move to next option
 * If non-standard, move toward the nearest better standard term
 * Better = longer payment time = better for buyer
 */
function nextBetterTerms(
  config: NegotiationConfig,
  t: Offer["payment_terms"],
): string {
  const opts =
    config.parameters?.payment_terms?.options ??
    (["Net 30", "Net 60", "Net 90"] as const);

  // If null or undefined, return first option
  if (!t) return opts[0];

  // Check if it's a standard term
  const idx = opts.indexOf(t as "Net 30" | "Net 60" | "Net 90");
  if (idx >= 0) {
    // Standard term - move to next option (longer is better for buyer)
    return opts[Math.min(idx + 1, opts.length - 1)];
  }

  // Non-standard term - extract days and find nearest better standard
  const days = extractPaymentDays(t);
  if (days === null) return opts[0];

  // Find the next standard term with more days (better for buyer)
  if (days < 30) return "Net 30";
  if (days < 60) return "Net 60";
  if (days < 90) return "Net 90";

  // Already better than all standard options, keep the same
  return t;
}

/**
 * Get the best payment terms for buyer from config
 * Typically Net 90 (longest payment time)
 */
function bestTerms(config: NegotiationConfig): string {
  const opts = config.parameters?.payment_terms?.options ?? [
    "Net 30",
    "Net 60",
    "Net 90",
  ];
  return opts[opts.length - 1];
}

/**
 * Calculate counter-offer price based on priority strategy
 *
 * Priority strategies (aggressiveness = how much PM moves toward vendor's offer):
 * - HIGH (Maximize Savings): 15% of range - PM stays very close to target (hardest negotiator)
 * - MEDIUM (Fair Deal): 40% of range - PM moves moderately toward vendor
 * - LOW (Quick Close): 55% of range - PM moves more toward vendor (faster closure)
 *
 * Formula: Counter = PM's Target + (Aggressiveness × Range)
 * Where Range = Vendor's Offer - PM's Target
 */
function _calculateCounterPrice(
  config: NegotiationConfig,
  vendorOffer: Offer,
  round: number,
): number {
  // Defensive: handle missing total_price config
  const priceParams = config.parameters?.total_price ??
    ((config.parameters as Record<string, unknown>)
      ?.unit_price as typeof config.parameters.total_price) ?? {
      target: 1000,
      max_acceptable: 1500,
      anchor: 1000,
      concession_step: 50,
    };
  const { target, max_acceptable } = priceParams;
  const priceRange = max_acceptable - target;
  const priority = config.priority || "MEDIUM";

  let counterPrice: number;

  switch (priority) {
    case "HIGH": {
      // Maximize Savings: Counter at 15% of range above target (very aggressive)
      // Small concessions as rounds progress: starts at 10%, max 15%
      const aggressiveOffset = Math.min(0.15, 0.1 + round * 0.01); // 10% + 1% per round, max 15%
      counterPrice = target + priceRange * aggressiveOffset;
      break;
    }
    case "LOW": {
      // Quick Close: Counter at 55% of range above target
      // More willing to meet vendor halfway for faster closure
      const quickCloseOffset = Math.min(0.55, 0.5 + round * 0.01); // 50% + 1% per round, max 55%
      counterPrice = target + priceRange * quickCloseOffset;
      break;
    }
    case "MEDIUM":
    default: {
      // Fair Deal: Counter at 40% of range above target
      const balancedOffset = Math.min(0.4, 0.35 + round * 0.01); // 35% + 1% per round, max 40%
      counterPrice = target + priceRange * balancedOffset;
      break;
    }
  }

  // Never exceed max acceptable
  counterPrice = Math.min(counterPrice, max_acceptable);

  // Convergence adjustment (May 2026): the base formula uses a near-static
  // offset from target, so it barely moves after round 5. When the vendor
  // has come down significantly, blend toward the midpoint between our
  // base counter and the vendor's offer — this shows good-faith movement
  // and prevents the PM from looking stuck at the same number.
  if (
    vendorOffer.total_price !== null &&
    vendorOffer.total_price > 0 &&
    round >= 3
  ) {
    const midpoint = (counterPrice + vendorOffer.total_price) / 2;
    // Blend factor increases with round: round 3 = 15%, round 5 = 35%, round 7+ = 50%
    const blendFactor = Math.min(0.5, 0.05 + round * 0.05);
    const blendedPrice = counterPrice + (midpoint - counterPrice) * blendFactor;
    // Only apply if blended price is still within our acceptable range
    if (blendedPrice <= max_acceptable && blendedPrice > counterPrice) {
      counterPrice = blendedPrice;
    }
  }

  // Never counter at or above vendor's offer — always go below
  if (
    vendorOffer.total_price !== null &&
    counterPrice >= vendorOffer.total_price
  ) {
    const effectiveMax = Math.min(vendorOffer.total_price, max_acceptable);
    counterPrice = Math.round(((target + effectiveMax) / 2) * 100) / 100;
    if (counterPrice >= vendorOffer.total_price) {
      counterPrice = target;
    }
  }

  // First-counter-regression cap (Apr 2026): never drop more than 12% below
  // the vendor's current offer in a single round. Prevents the "vendor
  // quoted ₹31.5K → PM countered ₹23.4K" leap that reads as bad-faith
  // negotiating. The convergence floor only kicks in after we've already
  // made a counter; this protects the FIRST counter when there is none.
  if (vendorOffer.total_price != null && vendorOffer.total_price > 0) {
    const minCounterPrice = vendorOffer.total_price * 0.88; // floor: 12% below vendor
    // Only apply when our config target allows us to go that high (i.e. the
    // floor is still ≤ max_acceptable). Otherwise hold at config max.
    const cappedFloor = Math.min(minCounterPrice, max_acceptable);
    counterPrice = Math.max(counterPrice, cappedFloor);
  }

  // Guard: counter price must never be 0 or negative — fall back to target
  if (counterPrice <= 0 && target > 0) {
    counterPrice = target;
  }

  // Round to 2 decimal places
  return Math.round(counterPrice * 100) / 100;
}

/**
 * Generate flexible payment terms (not limited to 30/60/90)
 *
 * @param currentDays - Current payment terms in days
 * @param direction - 'increase' for longer terms (better for buyer), 'decrease' for shorter
 * @param step - Step size in days (default 15)
 * @returns New payment terms string (e.g., "Net 45", "Net 55")
 *
 * @example
 * ```typescript
 * generateFlexibleTerms(30, 'increase', 15) // "Net 45"
 * generateFlexibleTerms(60, 'decrease', 10) // "Net 50"
 * ```
 */
export function generateFlexibleTerms(
  currentDays: number,
  direction: "increase" | "decrease",
  step: number = 15,
): string {
  const newDays =
    direction === "increase"
      ? Math.min(currentDays + step, 120) // Max 120 days
      : Math.max(currentDays - step, 7); // Min 7 days

  return formatPaymentTerms(newDays);
}

/**
 * Calculate dynamic counter-offer based on vendor preference detection
 *
 * Strategy:
 * - If vendor is price-focused: Offer HIGHER price, push for LONGER payment terms
 * - If vendor is terms-focused: Push for LOWER price, offer FLEXIBLE terms
 * - If balanced/unknown: Use standard priority-based calculation
 *
 * @param config - Negotiation configuration
 * @param vendorOffer - Current vendor offer
 * @param round - Current round number
 * @param negotiationState - Tracked negotiation state (optional)
 * @param previousPmOffer - Previous PM counter-offer (optional)
 * @returns Counter-offer with price and terms
 */
export function calculateDynamicCounter(
  config: NegotiationConfig,
  vendorOffer: Offer,
  round: number,
  negotiationState?: NegotiationState | null,
  previousPmOffer?: Offer | PmCounterRecord | null,
  adaptiveStrategy?: AdaptiveStrategyResult | null,
): { price: number; terms: string; strategy: string } {
  // Defensive: handle missing total_price config
  const priceParams = config.parameters?.total_price ??
    ((config.parameters as Record<string, unknown>)
      ?.unit_price as typeof config.parameters.total_price) ?? {
      target: 1000,
      max_acceptable: 1500,
    };
  const { target, max_acceptable } = priceParams;
  const priceRange = max_acceptable - target;
  const priority = config.priority || "MEDIUM";

  // Use adaptive aggressiveness when available, otherwise fall back to static base
  const baseAggressiveness = adaptiveStrategy
    ? adaptiveStrategy.adjustedAggressiveness
    : ({
        HIGH: 0.15, // 15% above target
        MEDIUM: 0.4, // 40% above target
        LOW: 0.55, // 55% above target
      }[priority] ?? 0.4);

  // Round adjustment: 3% per round, max 20% — PM gradually concedes over time
  const roundAdjustment = Math.min(0.2, round * 0.03);

  // Calculate concession bonus from vendor's price drops (up to 10%)
  let concessionBonus = 0;
  if (negotiationState) {
    const totalConcession = getTotalPriceConcession(negotiationState);
    concessionBonus = Math.min(0.1, totalConcession / 100);
  }

  // Rejection-based concession: when vendor rejects without a new offer,
  // the PM should concede toward the vendor's position.
  // Each rejection without a counter adds 5% of the price range to the offset.
  let rejectionConcession = 0;
  if (previousPmOffer && vendorOffer.total_price !== null) {
    const prevPmPrice =
      typeof previousPmOffer === "object" && "price" in previousPmOffer
        ? (previousPmOffer as PmCounterRecord).price
        : (previousPmOffer as Offer).total_price;

    // If vendor's offer is the same as last round (they rejected without a new price),
    // the PM should concede by moving toward the midpoint
    if (prevPmPrice != null && vendorOffer.total_price != null) {
      const gap = vendorOffer.total_price - prevPmPrice;
      if (gap > 0) {
        // Each round of rejection: concede 15% of the gap between PM and vendor
        rejectionConcession = (gap / priceRange) * 0.15 * Math.min(round, 5);
      }
    }
  }

  // Detect vendor emphasis and calculate emphasis adjustment
  let emphasisAdjustment = 0;
  let chosenTerms: string;
  let strategy: string;

  if (
    negotiationState &&
    negotiationState.vendorEmphasis !== "unknown" &&
    negotiationState.emphasisConfidence >= 0.7
  ) {
    const { vendorEmphasis, emphasisConfidence } = negotiationState;

    if (vendorEmphasis === "price-focused") {
      // Vendor cares about price - offer higher price, push for longer terms
      emphasisAdjustment = 0.1 * emphasisConfidence; // Up to +10% on price
      // Push for longer terms
      const currentTermsDays = vendorOffer.payment_terms
        ? (extractPaymentDays(vendorOffer.payment_terms) ?? 30)
        : 30;
      chosenTerms = generateFlexibleTerms(currentTermsDays, "increase", 15);
      strategy = `Dynamic (price-focused vendor): Conceding ${(emphasisAdjustment * 100).toFixed(0)}% on price, pushing ${chosenTerms}`;
    } else if (vendorEmphasis === "terms-focused") {
      // Vendor cares about terms - push harder on price, be flexible on terms
      emphasisAdjustment = -0.05 * emphasisConfidence; // Up to -5% on price (harder)
      // Accept or slightly improve vendor's terms
      chosenTerms = vendorOffer.payment_terms ?? bestTerms(config);
      strategy = `Dynamic (terms-focused vendor): Pushing ${(Math.abs(emphasisAdjustment) * 100).toFixed(0)}% harder on price, accepting ${chosenTerms}`;
    } else {
      // Balanced - use standard priority-based terms
      chosenTerms =
        priority === "HIGH"
          ? bestTerms(config)
          : nextBetterTerms(config, vendorOffer.payment_terms);
      strategy = `Balanced: Standard priority-based counter`;
    }
  } else {
    // Unknown emphasis - use standard priority-based terms
    chosenTerms =
      priority === "HIGH"
        ? bestTerms(config)
        : nextBetterTerms(config, vendorOffer.payment_terms);
    strategy = `Standard: ${priority} priority counter`;
  }

  // Calculate final counter price
  // rejectionConcession makes PM gradually move toward vendor's position when rejected
  const totalOffset =
    baseAggressiveness +
    roundAdjustment +
    concessionBonus +
    emphasisAdjustment +
    rejectionConcession;
  let counterPrice = target + priceRange * totalOffset;
  let priceCapped = false;

  // Never exceed max acceptable
  counterPrice = Math.min(counterPrice, max_acceptable);

  // ── Convergence blend: from round 3+, blend counter toward midpoint with vendor ──
  // This prevents the counter from staying flat at max_acceptable for many rounds.
  if (
    round >= 3 &&
    vendorOffer.total_price !== null &&
    vendorOffer.total_price > counterPrice
  ) {
    const blendFactor = Math.min(0.5, 0.10 + round * 0.07);
    const midpoint = (counterPrice + vendorOffer.total_price) / 2;
    const blended = counterPrice + (midpoint - counterPrice) * blendFactor;
    // Blended price must still respect max_acceptable ceiling
    counterPrice = Math.min(blended, max_acceptable);
  }

  // ── Minimum step guard: if counter equals our last counter, force at least 1% movement ──
  if (previousPmOffer && vendorOffer.total_price !== null && vendorOffer.total_price > counterPrice) {
    const prevPmPriceForStep =
      typeof previousPmOffer === "object" && "price" in previousPmOffer
        ? (previousPmOffer as PmCounterRecord).price
        : (previousPmOffer as Offer).total_price;
    if (
      prevPmPriceForStep != null &&
      Math.abs(counterPrice - prevPmPriceForStep) < 0.01
    ) {
      const step = (vendorOffer.total_price - counterPrice) * 0.01;
      counterPrice = Math.min(counterPrice + Math.max(step, 1), max_acceptable);
    }
  }

  // Never counter above vendor's offer — counter should always be BELOW vendor's price
  // If counter ends up at or above vendor's price, use a meaningful counter below it
  if (
    vendorOffer.total_price !== null &&
    counterPrice >= vendorOffer.total_price
  ) {
    // Counter at midpoint between target and vendor's offer (or max_acceptable, whichever is lower)
    const effectiveMax = Math.min(vendorOffer.total_price, max_acceptable);
    counterPrice = Math.round(((target + effectiveMax) / 2) * 100) / 100;
    // If midpoint is still above vendor's price, use target
    if (counterPrice >= vendorOffer.total_price) {
      counterPrice = target;
    }
    priceCapped = true;
  }

  // First-counter-regression cap (Apr 2026): never drop more than 12% below
  // the vendor's current offer in a single round. Same protection as the
  // simpler counter-price path above.
  if (vendorOffer.total_price != null && vendorOffer.total_price > 0) {
    const minCounterPrice = vendorOffer.total_price * 0.88;
    const cappedFloor = Math.min(minCounterPrice, max_acceptable);
    counterPrice = Math.max(counterPrice, cappedFloor);
  }

  // Guard: counter price must never be 0 or negative — fall back to target
  if (counterPrice <= 0 && target > 0) {
    counterPrice = target;
  }

  // Round to 2 decimal places
  counterPrice = Math.round(counterPrice * 100) / 100;

  // GUARD: PM counter price must never go BELOW the previous PM counter.
  // Negotiations should be monotonic on price — once we've offered X, we don't
  // walk it back to <X in a later round (that would weaken our position and
  // confuse the vendor). Clamp upward to the previous PM counter if needed,
  // but stay below the vendor's current price (the no-cross guard above).
  if (previousPmOffer && vendorOffer.total_price !== null) {
    const prevPmPrice =
      typeof previousPmOffer === "object" && "price" in previousPmOffer
        ? (previousPmOffer as PmCounterRecord).price
        : (previousPmOffer as Offer).total_price;
    if (prevPmPrice != null && counterPrice < prevPmPrice) {
      const flooredPrice = Math.min(
        prevPmPrice,
        vendorOffer.total_price - 0.01,
      );
      if (flooredPrice > counterPrice) {
        counterPrice = Math.round(flooredPrice * 100) / 100;
        strategy += ` (floored to previous PM counter ${prevPmPrice} — monotonic)`;
      }
    }
  }

  // GUARD: PM counter should NEVER have shorter payment terms than vendor's offer.
  // Longer terms = better for buyer (more cash flow time). If the counter terms are
  // shorter than what the vendor already offered, use the vendor's terms instead.
  if (vendorOffer.payment_terms) {
    const vendorDays = extractPaymentDays(vendorOffer.payment_terms);
    const chosenDays = extractPaymentDays(chosenTerms);
    if (vendorDays !== null && chosenDays !== null && chosenDays < vendorDays) {
      chosenTerms = vendorOffer.payment_terms;
      strategy += ` (terms kept at vendor's ${vendorOffer.payment_terms} — already favorable for buyer)`;
    }
  }

  // ENHANCED LOGGING: Dynamic Counter Calculation
  negotiationLogger.logDynamicCounter({
    priority,
    baseAggressiveness,
    roundAdjustment,
    concessionBonus,
    emphasisAdjustment,
    totalOffset,
    counterPrice,
    chosenTerms,
    strategy,
    vendorEmphasis: negotiationState?.vendorEmphasis,
    emphasisConfidence: negotiationState?.emphasisConfidence,
    priceCapped,
  });

  return { price: counterPrice, terms: chosenTerms, strategy };
}

/**
 * Returns true if the proposed counter offer is effectively identical to the vendor's offer.
 * In that case we should ACCEPT rather than echo the vendor's own terms back as a "counter".
 */
function counterMatchesVendorOffer(
  counter: Offer,
  vendorOffer: Offer,
): boolean {
  const priceMatch =
    counter.total_price != null &&
    vendorOffer.total_price != null &&
    Math.abs(counter.total_price - vendorOffer.total_price) < 0.01;
  const termsMatch = counter.payment_terms === vendorOffer.payment_terms;
  return priceMatch && termsMatch;
}

export function decideNextMove(
  config: NegotiationConfig,
  vendorOffer: Offer,
  round: number,
  negotiationState?: NegotiationState | null,
  previousPmOffer?: Offer | PmCounterRecord | null,
  behavioralSignals?: BehavioralSignals | null,
  adaptiveStrategy?: AdaptiveStrategyResult | null,
): Decision {
  const reasons: string[] = [];
  // removed dead: const _priority = config.priority || "MEDIUM";
  const cs = getCurrencySymbol(config.currency);

  // Get thresholds with defaults (70%, 50%, 30%)
  const acceptThreshold = config.accept_threshold ?? 0.7;
  const escalateThreshold = config.escalate_threshold ?? 0.5;
  const walkawayThreshold = config.walkaway_threshold ?? 0.3;

  // Log adaptive strategy if present
  if (adaptiveStrategy) {
    negotiationLogger.logAdaptiveStrategy(adaptiveStrategy);
  }

  // Dynamic round limits (Phase 3)
  const dynamicRounds = (
    config as NegotiationConfig & { dynamicRounds?: DynamicRoundConfig }
  ).dynamicRounds;

  if (dynamicRounds?.autoExtendEnabled && behavioralSignals) {
    const softMax = dynamicRounds.softMaxRounds;
    const hardMax = dynamicRounds.hardMaxRounds;

    // Hard safety net - never exceeded
    if (round > hardMax) {
      return {
        action: "ESCALATE",
        utilityScore: 0,
        counterOffer: null,
        reasons: [`Hard max rounds (${hardMax}) exceeded`],
      };
    }

    // Past soft max: check if we should auto-extend or escalate
    if (round > softMax) {
      if (
        behavioralSignals.isConverging &&
        behavioralSignals.convergenceRate > 0.1
      ) {
        // Auto-extend: offers are converging, gap decreasing >10%/round
        reasons.push(
          `Auto-extending: convergence rate ${(behavioralSignals.convergenceRate * 100).toFixed(0)}%/round`,
        );
        // Continue to negotiation logic below (don't escalate)
      } else {
        return {
          action: "ESCALATE",
          utilityScore: 0,
          counterOffer: null,
          reasons: [
            `Past soft max (${softMax}) rounds and not converging (rate: ${(behavioralSignals.convergenceRate * 100).toFixed(0)}%/round)`,
          ],
        };
      }
    }

    // Early escalation: before soft max but stalling
    if (round >= Math.ceil(softMax * 0.6) && behavioralSignals.isStalling) {
      if (adaptiveStrategy?.shouldEscalateEarly) {
        return {
          action: "ESCALATE",
          utilityScore: 0,
          counterOffer: null,
          reasons: [
            `Stalling detected after ${round} rounds (early escalation triggered)`,
          ],
        };
      }
    }
  }
  // NOTE: Removed hard round limit - negotiations can continue indefinitely
  // Escalation/walk-away now based on stall detection and vendor rigidity

  // Clarify if missing
  if (vendorOffer.total_price == null || vendorOffer.payment_terms == null) {
    return {
      action: "ASK_CLARIFY",
      utilityScore: 0,
      counterOffer: null,
      reasons: ["Missing total_price or payment_terms in vendor offer."],
    };
  }

  // Defensive: handle missing total_price config
  const priceConfig = config.parameters?.total_price ??
    ((config.parameters as Record<string, unknown>)
      ?.unit_price as typeof config.parameters.total_price) ?? {
      target: 1000,
      max_acceptable: 1500,
    };
  const max = priceConfig.max_acceptable;
  // Feb 2026: Minimum 10 rounds before walking away
  // Walk-away only happens after vendor shows rigidity (no concessions) for 10+ rounds
  const minRoundsBeforeWalkaway = 10;
  // Check vendor rigidity - are they making any concessions?
  const vendorIsRigid = isVendorRigid(negotiationState ?? null, 10);
  // Check if negotiation is stalled (no utility improvement for 3+ rounds)
  const negotiationStalled = isNegotiationStalled(negotiationState ?? null, 3);

  // If price exceeds max acceptable
  if (vendorOffer.total_price > max) {
    // In early rounds, counter with max acceptable price instead of walking away
    // This gives vendors a chance to come down to an acceptable range
    if (round < minRoundsBeforeWalkaway) {
      const delivery = getDeliveryForCounter(vendorOffer, config);
      const dynamicCounter = calculateDynamicCounter(
        config,
        vendorOffer,
        round,
        negotiationState,
        previousPmOffer,
        adaptiveStrategy,
      );
      const counter: Offer = {
        total_price: dynamicCounter.price,
        payment_terms: dynamicCounter.terms,
        delivery_date: delivery.delivery_date,
        delivery_days: delivery.delivery_days,
      };

      if (counterMatchesVendorOffer(counter, vendorOffer)) {
        return {
          action: "MESO",
          utilityScore: totalUtility(config, vendorOffer),
          counterOffer: null,
          reasons: [
            `Counter equals vendor offer — presenting MESO options instead.`,
          ],
        };
      }
      return {
        action: "COUNTER",
        utilityScore: 0,
        counterOffer: counter,
        reasons: [
          `Price ${cs}${vendorOffer.total_price} exceeds our budget of ${cs}${max}. I can offer ${cs}${dynamicCounter.price.toFixed(2)} with ${dynamicCounter.terms} - can you work within this range?`,
        ],
      };
    }

    // After minimum rounds, walk away if price still exceeds max
    return {
      action: "WALK_AWAY",
      utilityScore: 0,
      counterOffer: null,
      reasons: [
        `Price ${vendorOffer.total_price} > max acceptable ${max} after ${round} rounds of negotiation`,
      ],
    };
  }

  // ============================================================================
  // Implausible-vendor-drop sanity guard (April 2026)
  // ============================================================================
  // If the vendor's price drops suspiciously far (below PM's `target`, or
  // >60% lower than their previous offer in one round), the engine should
  // NOT silently accept. Such a drop is almost always a typo (e.g. 32000
  // instead of 320000) or an edge case that deserves PM review. We return
  // ASK_CLARIFY so the vendor gets a chance to confirm/correct, instead of
  // the engine locking in an accidental give-away through either the
  // auto-accept-vs-last-counter path OR the utility-based accept path.
  {
    const targetPrice = priceConfig.target;
    const belowTarget =
      typeof targetPrice === "number" &&
      vendorOffer.total_price !== null &&
      vendorOffer.total_price < targetPrice;

    // Big-jump guard — the most recent recorded price concession's
    // `previousValue` holds the vendor's prior-round price
    // (updateNegotiationState pushes a new record right before decide runs).
    const priceConcessions = negotiationState?.priceConcessions ?? [];
    const lastConcession = priceConcessions[priceConcessions.length - 1];
    const previousVendorPrice =
      lastConcession && typeof lastConcession.previousValue === "number"
        ? lastConcession.previousValue
        : null;
    const isBigJump =
      typeof previousVendorPrice === "number" &&
      previousVendorPrice > 0 &&
      vendorOffer.total_price !== null &&
      vendorOffer.total_price < previousVendorPrice * 0.4;

    if (belowTarget && isBigJump) {
      // Both guards tripped simultaneously — strong signal this is a typo
      // or a wild drop. Ask the vendor to confirm.
      return {
        action: "ASK_CLARIFY",
        utilityScore: 0,
        counterOffer: null,
        reasons: [
          `Vendor price ${cs}${vendorOffer.total_price} is below target (${cs}${targetPrice}) ` +
            `and represents a ${Math.round((1 - vendorOffer.total_price! / previousVendorPrice!) * 100)}% drop ` +
            `from the previous offer of ${cs}${previousVendorPrice}. This looks unusually low — ` +
            `can you please confirm the total price you're proposing?`,
        ],
      };
    }
  }

  // Auto-accept: if vendor's offer meets or beats PM's last counter, accept immediately
  // e.g., PM countered at $309,000 Net 60 and vendor offers $305,800 Net 60 → accept
  if (previousPmOffer && vendorOffer.total_price !== null) {
    const pmCounterPrice =
      (previousPmOffer as PmCounterRecord).price ??
      (previousPmOffer as Offer).total_price ??
      null;
    const pmCounterTerms =
      (previousPmOffer as PmCounterRecord).terms ??
      (previousPmOffer as Offer).payment_terms ??
      null;

    if (pmCounterPrice !== null && vendorOffer.total_price <= pmCounterPrice) {
      // Vendor price is at or below PM's last counter — check terms too
      const vendorDays = vendorOffer.payment_terms
        ? extractPaymentDays(vendorOffer.payment_terms)
        : null;
      const pmDays = pmCounterTerms ? extractPaymentDays(pmCounterTerms) : null;

      // Terms are acceptable if: vendor terms match or are shorter (better for buyer = shorter payment)
      // OR if PM didn't specify terms
      const termsAcceptable =
        pmDays === null || vendorDays === null || vendorDays <= pmDays;

      if (termsAcceptable) {
        return {
          action: "ACCEPT",
          utilityScore: totalUtility(config, vendorOffer),
          counterOffer: null,
          reasons: [
            `Vendor offer (${cs}${vendorOffer.total_price}, ${vendorOffer.payment_terms}) meets or beats PM's last counter (${cs}${pmCounterPrice}, ${pmCounterTerms}) — auto-accept`,
          ],
        };
      }
    }
  }

  const u = totalUtility(config, vendorOffer);

  // Decision zones based on cumulative weighted utility:
  // Accept Zone: utility >= 70%
  if (u >= acceptThreshold) {
    return {
      action: "ACCEPT",
      utilityScore: u,
      counterOffer: null,
      reasons: [
        `Utility ${(u * 100).toFixed(0)}% >= accept threshold ${(acceptThreshold * 100).toFixed(0)}%`,
      ],
    };
  }

  // Walk Away Zone: utility < walkaway threshold
  // Feb 2026: Walk away ONLY if vendor is rigid (no concessions) after 10+ rounds AND utility is below threshold
  // MESO Preference Exploration: If vendor selected "Balanced", extend negotiation
  const inPreferenceExploration = isInPreferenceExploration(
    negotiationState ?? null,
  );
  const explorationRoundsRemaining = getPreferenceExplorationRoundsRemaining(
    negotiationState ?? null,
  );

  if (u < walkawayThreshold) {
    // Only walk away if:
    // 1. We've had 10+ rounds AND
    // 2. Vendor is rigid (no concessions) AND
    // 3. NOT in preference exploration mode
    const shouldWalkAway =
      round >= minRoundsBeforeWalkaway &&
      vendorIsRigid &&
      !inPreferenceExploration;

    if (shouldWalkAway) {
      return {
        action: "WALK_AWAY",
        utilityScore: u,
        counterOffer: null,
        reasons: [
          `Utility ${(u * 100).toFixed(0)}% < walkaway threshold after ${round} rounds. Vendor has shown no flexibility on price or terms.`,
        ],
      };
    }

    // Otherwise, keep countering
    const delivery = getDeliveryForCounter(vendorOffer, config);
    const dynamicCounter = calculateDynamicCounter(
      config,
      vendorOffer,
      round,
      negotiationState,
      previousPmOffer,
      adaptiveStrategy,
    );
    const counter: Offer = {
      total_price: dynamicCounter.price,
      payment_terms: dynamicCounter.terms,
      delivery_date: delivery.delivery_date,
      delivery_days: delivery.delivery_days,
    };

    if (counterMatchesVendorOffer(counter, vendorOffer)) {
      return {
        action: "MESO",
        utilityScore: u,
        counterOffer: null,
        reasons: [
          `Counter equals vendor offer — presenting MESO options instead.`,
        ],
      };
    }

    let reason = `Utility ${(u * 100).toFixed(0)}% below threshold`;
    if (inPreferenceExploration) {
      reason += ` - preference exploration: ${explorationRoundsRemaining} round(s) remaining`;
    } else if (round < minRoundsBeforeWalkaway) {
      reason += ` - round ${round}/${minRoundsBeforeWalkaway}, continuing negotiation`;
    } else {
      reason += ` - vendor still showing flexibility, continuing negotiation`;
    }
    reason += `. Counter at ${cs}${dynamicCounter.price.toFixed(2)} with ${dynamicCounter.terms}.`;

    return {
      action: "COUNTER",
      utilityScore: u,
      counterOffer: counter,
      reasons: [reason],
    };
  }

  // Escalate Zone: 30% <= utility < 50%
  // UPDATED Feb 2026: Escalate ONLY if:
  // 1. At least 10 rounds have passed AND
  // 2. Negotiation is stalled (no utility improvement for 3+ consecutive rounds)
  const minRoundsBeforeEscalate = 10;

  if (u < escalateThreshold) {
    const delivery = getDeliveryForCounter(vendorOffer, config);
    const dynamicCounter = calculateDynamicCounter(
      config,
      vendorOffer,
      round,
      negotiationState,
      previousPmOffer,
      adaptiveStrategy,
    );

    const counter: Offer = {
      total_price: dynamicCounter.price,
      payment_terms: dynamicCounter.terms,
      delivery_date: delivery.delivery_date,
      delivery_days: delivery.delivery_days,
    };

    // Determine if we should escalate
    // Conditions: 10+ rounds AND stalled for 3+ rounds AND NOT in preference exploration
    const shouldEscalate =
      round >= minRoundsBeforeEscalate &&
      negotiationStalled &&
      !inPreferenceExploration;

    if (shouldEscalate) {
      return {
        action: "ESCALATE",
        utilityScore: u,
        counterOffer: counter,
        reasons: [
          `Utility ${(u * 100).toFixed(0)}% in escalate zone after ${round} rounds. No progress for 3+ consecutive rounds. Proposing ${cs}${dynamicCounter.price.toFixed(2)} with ${dynamicCounter.terms} - needs human review.`,
        ],
      };
    }

    // Otherwise, keep countering
    let reason = `Utility ${(u * 100).toFixed(0)}% in escalate zone`;
    if (round < minRoundsBeforeEscalate) {
      reason += ` - round ${round}/${minRoundsBeforeEscalate}, continuing negotiation`;
    } else if (inPreferenceExploration) {
      reason += ` - preference exploration: ${explorationRoundsRemaining} round(s) remaining`;
    } else if (!negotiationStalled) {
      const trend = getUtilityTrend(negotiationState ?? null, 5);
      reason += ` - negotiation ${trend}, continuing`;
    }
    reason += `. Counter at ${cs}${dynamicCounter.price.toFixed(2)} with ${dynamicCounter.terms}.`;

    if (counterMatchesVendorOffer(counter, vendorOffer)) {
      return {
        action: "MESO",
        utilityScore: u,
        counterOffer: null,
        reasons: [
          `Counter equals vendor offer — presenting MESO options instead.`,
        ],
      };
    }

    return {
      action: "COUNTER",
      utilityScore: u,
      counterOffer: counter,
      reasons: [reason],
    };
  }

  // Counter Zone: 50% <= utility < 70%
  // Continue negotiating with counter-offers using dynamic strategy

  const delivery = getDeliveryForCounter(vendorOffer, config);
  const dynamicCounter = calculateDynamicCounter(
    config,
    vendorOffer,
    round,
    negotiationState,
    previousPmOffer,
    adaptiveStrategy,
  );

  const counter: Offer = {
    total_price: dynamicCounter.price,
    payment_terms: dynamicCounter.terms,
    delivery_date: delivery.delivery_date,
    delivery_days: delivery.delivery_days,
  };

  reasons.push(
    `${dynamicCounter.strategy}: Counter at ${cs}${dynamicCounter.price.toFixed(2)} with ${dynamicCounter.terms}.`,
  );

  if (counterMatchesVendorOffer(counter, vendorOffer)) {
    return {
      action: "MESO",
      utilityScore: u,
      counterOffer: null,
      reasons: [
        `Counter equals vendor offer — presenting MESO options instead.`,
      ],
    };
  }

  return { action: "COUNTER", utilityScore: u, counterOffer: counter, reasons };
}

// ============================================
// PACTUM-STYLE WEIGHTED DECISION (Feb 2026)
// ============================================

/**
 * Extended Decision interface with utility breakdown
 */
export interface WeightedDecision extends Decision {
  utilityBreakdown?: {
    totalUtility: number;
    totalUtilityPercent: number;
    parameterUtilities: Record<
      string,
      {
        parameterId: string;
        parameterName: string;
        utility: number;
        weight: number;
        contribution: number;
        currentValue: number | string | boolean | null;
        targetValue: number | string | boolean | null;
      }
    >;
    recommendation: string;
    recommendationReason: string;
  };
  resolvedConfig?: ResolvedNegotiationConfig;
}

/**
 * Decide next move using full weighted utility from wizard config
 * This is the Pactum-style decision function that uses all 12+ parameters
 *
 * @param wizardConfig - Full wizard configuration from deal creation
 * @param legacyConfig - Legacy config for backwards compatibility
 * @param vendorOffer - Extended vendor offer with all parameters
 * @param round - Current negotiation round
 * @param negotiationState - Tracked negotiation state (optional)
 * @param previousPmOffer - Previous PM counter-offer (optional)
 * @param behavioralSignals - Behavioral analysis signals (optional)
 * @param adaptiveStrategy - Adaptive strategy result (optional)
 */
export function decideWithWeightedUtility(
  wizardConfig: WizardConfig | null | undefined,
  legacyConfig: NegotiationConfig | null | undefined,
  vendorOffer: ExtendedOffer,
  round: number,
  negotiationState?: NegotiationState | null,
  previousPmOffer?: Offer | PmCounterRecord | null,
  behavioralSignals?: BehavioralSignals | null,
  adaptiveStrategy?: AdaptiveStrategyResult | null,
): WeightedDecision {
  const reasons: string[] = [];
  const cs = getCurrencySymbol(legacyConfig?.currency);

  // ============================================
  // Resolve configuration with user/default priority
  // ============================================

  const resolvedConfig = resolveNegotiationConfig(
    wizardConfig,
    legacyConfig
      ? {
          total_price:
            legacyConfig.parameters?.total_price ??
            (legacyConfig.parameters as any)?.unit_price,
          accept_threshold: legacyConfig.accept_threshold,
          escalate_threshold: legacyConfig.escalate_threshold,
          walkaway_threshold: legacyConfig.walkaway_threshold,
          max_rounds: legacyConfig.max_rounds,
          priority: legacyConfig.priority,
        }
      : undefined,
  );

  const priority = resolvedConfig.priority;

  // Log config resolution
  negotiationLogger.logConfigThresholds(
    {
      accept_threshold: resolvedConfig.acceptThreshold,
      escalate_threshold: resolvedConfig.escalateThreshold,
      walkaway_threshold: resolvedConfig.walkAwayThreshold,
      max_rounds: resolvedConfig.maxRounds,
      parameters: {
        total_price: {
          weight: resolvedConfig.weights.targetUnitPrice / 100,
          direction: "minimize",
          anchor: resolvedConfig.anchorPrice,
          target: resolvedConfig.targetPrice,
          max_acceptable: resolvedConfig.maxAcceptablePrice,
          concession_step: resolvedConfig.concessionStep,
        },
        payment_terms: {
          weight: resolvedConfig.weights.paymentTermsRange / 100,
          options: ["Net 30", "Net 60", "Net 90"] as const,
          utility: { "Net 30": 0.5, "Net 60": 0.75, "Net 90": 1.0 },
        },
      },
    },
    priority,
  );

  // Log adaptive strategy if present
  if (adaptiveStrategy) {
    negotiationLogger.logAdaptiveStrategy(adaptiveStrategy);
  }

  // ============================================
  // Check round limits
  // ============================================

  const dynamicRounds = (
    legacyConfig as NegotiationConfig & { dynamicRounds?: DynamicRoundConfig }
  )?.dynamicRounds;

  if (dynamicRounds?.autoExtendEnabled && behavioralSignals) {
    const softMax = dynamicRounds.softMaxRounds;
    const hardMax = dynamicRounds.hardMaxRounds;

    // Hard safety net - never exceeded
    if (round > hardMax) {
      return {
        action: "ESCALATE",
        utilityScore: 0,
        counterOffer: null,
        reasons: [`Hard max rounds (${hardMax}) exceeded`],
        resolvedConfig,
      };
    }

    // Past soft max: check if we should auto-extend or escalate
    if (round > softMax) {
      if (
        behavioralSignals.isConverging &&
        behavioralSignals.convergenceRate > 0.1
      ) {
        reasons.push(
          `Auto-extending: convergence rate ${(behavioralSignals.convergenceRate * 100).toFixed(0)}%/round`,
        );
      } else {
        return {
          action: "ESCALATE",
          utilityScore: 0,
          counterOffer: null,
          reasons: [
            `Past soft max (${softMax}) rounds and not converging (rate: ${(behavioralSignals.convergenceRate * 100).toFixed(0)}%/round)`,
          ],
          resolvedConfig,
        };
      }
    }

    // Early escalation: before soft max but stalling
    if (round >= Math.ceil(softMax * 0.6) && behavioralSignals.isStalling) {
      if (adaptiveStrategy?.shouldEscalateEarly) {
        return {
          action: "ESCALATE",
          utilityScore: 0,
          counterOffer: null,
          reasons: [
            `Stalling detected after ${round} rounds (early escalation triggered)`,
          ],
          resolvedConfig,
        };
      }
    }
  } else {
    // Backward compat: use max_rounds from resolved config
    if (round > resolvedConfig.maxRounds) {
      return {
        action: "ESCALATE",
        utilityScore: 0,
        counterOffer: null,
        reasons: [`Max rounds (${resolvedConfig.maxRounds}) exceeded`],
        resolvedConfig,
      };
    }
  }

  // ============================================
  // Handle missing required fields
  // ============================================

  if (vendorOffer.total_price == null && vendorOffer.payment_terms == null) {
    return {
      action: "ASK_CLARIFY",
      utilityScore: 0,
      counterOffer: null,
      reasons: ["Missing total_price and payment_terms in vendor offer."],
      resolvedConfig,
    };
  }

  // ============================================
  // Calculate weighted utility
  // ============================================

  const utilityResult = calculateWeightedUtilityFromResolved(
    vendorOffer,
    resolvedConfig,
  );
  const u = utilityResult.totalUtility;

  // Log utility calculation
  negotiationLogger.logUtilityCalculation(
    utilityResult.parameterUtilities["targetUnitPrice"]?.utility ?? 0,
    utilityResult.parameterUtilities["paymentTermsRange"]?.utility ?? 0,
    u,
    {
      parameters: {
        total_price: {
          weight: resolvedConfig.weights.targetUnitPrice / 100,
          direction: "minimize",
          anchor: resolvedConfig.anchorPrice,
          target: resolvedConfig.targetPrice,
          max_acceptable: resolvedConfig.maxAcceptablePrice,
          concession_step: resolvedConfig.concessionStep,
        },
        payment_terms: {
          weight: resolvedConfig.weights.paymentTermsRange / 100,
          options: ["Net 30", "Net 60", "Net 90"] as const,
          utility: { "Net 30": 0.5, "Net 60": 0.75, "Net 90": 1.0 },
        },
      },
      accept_threshold: resolvedConfig.acceptThreshold,
      walkaway_threshold: resolvedConfig.walkAwayThreshold,
      max_rounds: resolvedConfig.maxRounds,
    },
  );

  // ============================================
  // Decision logic based on utility thresholds
  // ============================================

  const acceptThreshold = resolvedConfig.acceptThreshold;
  const escalateThreshold = resolvedConfig.escalateThreshold;
  const walkawayThreshold = resolvedConfig.walkAwayThreshold;

  // Feb 2026: Minimum 10 rounds before walk-away/escalation
  const minRoundsBeforeWalkaway = 10;
  const minRoundsBeforeEscalateWeighted = 10;

  // Check vendor rigidity and stall detection
  const vendorIsRigidWeighted = isVendorRigid(negotiationState ?? null, 10);
  const negotiationStalledWeighted = isNegotiationStalled(
    negotiationState ?? null,
    3,
  );

  // Check if price exceeds max acceptable
  if (
    vendorOffer.total_price != null &&
    vendorOffer.total_price > resolvedConfig.maxAcceptablePrice
  ) {
    // Only walk away if vendor is rigid after 10+ rounds
    if (round < minRoundsBeforeWalkaway || !vendorIsRigidWeighted) {
      const counterOffer = generateCounterOffer(
        resolvedConfig,
        vendorOffer,
        round,
        negotiationState,
        adaptiveStrategy,
      );
      return {
        action: "COUNTER",
        utilityScore: 0,
        counterOffer,
        reasons: [
          `Price ${cs}${vendorOffer.total_price} exceeds our budget of ${cs}${resolvedConfig.maxAcceptablePrice}. Proposing ${cs}${counterOffer.total_price?.toFixed(2)} with ${counterOffer.payment_terms}.`,
        ],
        utilityBreakdown: {
          totalUtility: utilityResult.totalUtility,
          totalUtilityPercent: utilityResult.totalUtilityPercent,
          parameterUtilities: utilityResult.parameterUtilities,
          recommendation: utilityResult.recommendation,
          recommendationReason: utilityResult.recommendationReason,
        },
        resolvedConfig,
      };
    }

    return {
      action: "WALK_AWAY",
      utilityScore: 0,
      counterOffer: null,
      reasons: [
        `Price ${vendorOffer.total_price} > max acceptable ${resolvedConfig.maxAcceptablePrice} after ${round} rounds`,
      ],
      resolvedConfig,
    };
  }

  // Auto-accept: if vendor's offer meets or beats PM's last counter, accept immediately
  if (previousPmOffer && vendorOffer.total_price != null) {
    const pmCounterPrice =
      (previousPmOffer as PmCounterRecord).price ??
      (previousPmOffer as Offer).total_price ??
      null;
    const pmCounterTerms =
      (previousPmOffer as PmCounterRecord).terms ??
      (previousPmOffer as Offer).payment_terms ??
      null;

    if (pmCounterPrice !== null && vendorOffer.total_price <= pmCounterPrice) {
      const vendorDays = vendorOffer.payment_terms
        ? extractPaymentDays(vendorOffer.payment_terms)
        : null;
      const pmDays = pmCounterTerms ? extractPaymentDays(pmCounterTerms) : null;
      const termsAcceptable =
        pmDays === null || vendorDays === null || vendorDays <= pmDays;

      if (termsAcceptable) {
        return {
          action: "ACCEPT",
          utilityScore: u,
          counterOffer: null,
          reasons: [
            `Vendor offer (${cs}${vendorOffer.total_price}, ${vendorOffer.payment_terms}) meets or beats PM's last counter (${cs}${pmCounterPrice}, ${pmCounterTerms}) — auto-accept`,
          ],
          utilityBreakdown: {
            totalUtility: utilityResult.totalUtility,
            totalUtilityPercent: utilityResult.totalUtilityPercent,
            parameterUtilities: utilityResult.parameterUtilities,
            recommendation: utilityResult.recommendation,
            recommendationReason: utilityResult.recommendationReason,
          },
          resolvedConfig,
        };
      }
    }
  }

  // Accept Zone: utility >= accept threshold
  if (u >= acceptThreshold) {
    return {
      action: "ACCEPT",
      utilityScore: u,
      counterOffer: null,
      reasons: [
        `Utility ${(u * 100).toFixed(0)}% >= accept threshold ${(acceptThreshold * 100).toFixed(0)}%`,
      ],
      utilityBreakdown: {
        totalUtility: utilityResult.totalUtility,
        totalUtilityPercent: utilityResult.totalUtilityPercent,
        parameterUtilities: utilityResult.parameterUtilities,
        recommendation: utilityResult.recommendation,
        recommendationReason: utilityResult.recommendationReason,
      },
      resolvedConfig,
    };
  }

  // Walk Away Zone: utility < walkaway threshold
  // MESO Preference Exploration: If vendor selected "Balanced", extend negotiation
  const inPreferenceExplorationWeighted = isInPreferenceExploration(
    negotiationState ?? null,
  );
  const explorationRoundsRemainingWeighted =
    getPreferenceExplorationRoundsRemaining(negotiationState ?? null);

  // Walk Away Zone: utility < walkaway threshold
  // Feb 2026: Walk away ONLY if vendor is rigid (no concessions) after 10+ rounds
  if (u < walkawayThreshold) {
    const shouldWalkAway =
      round >= minRoundsBeforeWalkaway &&
      vendorIsRigidWeighted &&
      !inPreferenceExplorationWeighted;

    if (shouldWalkAway) {
      return {
        action: "WALK_AWAY",
        utilityScore: u,
        counterOffer: null,
        reasons: [
          `Utility ${(u * 100).toFixed(0)}% < walkaway threshold after ${round} rounds. Vendor has shown no flexibility.`,
        ],
        utilityBreakdown: {
          totalUtility: utilityResult.totalUtility,
          totalUtilityPercent: utilityResult.totalUtilityPercent,
          parameterUtilities: utilityResult.parameterUtilities,
          recommendation: utilityResult.recommendation,
          recommendationReason: utilityResult.recommendationReason,
        },
        resolvedConfig,
      };
    }

    // Otherwise, keep countering
    const counterOffer = generateCounterOffer(
      resolvedConfig,
      vendorOffer,
      round,
      negotiationState,
      adaptiveStrategy,
    );
    let reason = `Utility ${(u * 100).toFixed(0)}% below threshold`;
    if (inPreferenceExplorationWeighted) {
      reason += ` - preference exploration: ${explorationRoundsRemainingWeighted} round(s) remaining`;
    } else if (round < minRoundsBeforeWalkaway) {
      reason += ` - round ${round}/${minRoundsBeforeWalkaway}, continuing`;
    } else {
      reason += ` - vendor still showing flexibility, continuing`;
    }
    reason += `. Counter at ${cs}${counterOffer.total_price?.toFixed(2)} with ${counterOffer.payment_terms}.`;

    return {
      action: "COUNTER",
      utilityScore: u,
      counterOffer,
      reasons: [reason],
      utilityBreakdown: {
        totalUtility: utilityResult.totalUtility,
        totalUtilityPercent: utilityResult.totalUtilityPercent,
        parameterUtilities: utilityResult.parameterUtilities,
        recommendation: utilityResult.recommendation,
        recommendationReason: utilityResult.recommendationReason,
      },
      resolvedConfig,
    };
  }

  // Escalate Zone: walkaway <= utility < escalate
  // Feb 2026: Escalate ONLY if 10+ rounds AND stalled for 3+ consecutive rounds
  if (u < escalateThreshold) {
    const counterOffer = generateCounterOffer(
      resolvedConfig,
      vendorOffer,
      round,
      negotiationState,
      adaptiveStrategy,
    );

    // Determine if we should escalate
    const shouldEscalate =
      round >= minRoundsBeforeEscalateWeighted &&
      negotiationStalledWeighted &&
      !inPreferenceExplorationWeighted;

    if (shouldEscalate) {
      return {
        action: "ESCALATE",
        utilityScore: u,
        counterOffer,
        reasons: [
          `Utility ${(u * 100).toFixed(0)}% in escalate zone after ${round} rounds. No progress for 3+ consecutive rounds. Proposing ${cs}${counterOffer.total_price?.toFixed(2)} with ${counterOffer.payment_terms} - needs human review.`,
        ],
        utilityBreakdown: {
          totalUtility: utilityResult.totalUtility,
          totalUtilityPercent: utilityResult.totalUtilityPercent,
          parameterUtilities: utilityResult.parameterUtilities,
          recommendation: utilityResult.recommendation,
          recommendationReason: utilityResult.recommendationReason,
        },
        resolvedConfig,
      };
    }

    // Otherwise, keep countering
    let reason = `Utility ${(u * 100).toFixed(0)}% in escalate zone`;
    if (round < minRoundsBeforeEscalateWeighted) {
      reason += ` - round ${round}/${minRoundsBeforeEscalateWeighted}, continuing`;
    } else if (inPreferenceExplorationWeighted) {
      reason += ` - preference exploration: ${explorationRoundsRemainingWeighted} round(s) remaining`;
    } else if (!negotiationStalledWeighted) {
      const trend = getUtilityTrend(negotiationState ?? null, 5);
      reason += ` - negotiation ${trend}, continuing`;
    }
    reason += `. Counter at ${cs}${counterOffer.total_price?.toFixed(2)} with ${counterOffer.payment_terms}.`;

    return {
      action: "COUNTER",
      utilityScore: u,
      counterOffer,
      reasons: [reason],
      utilityBreakdown: {
        totalUtility: utilityResult.totalUtility,
        totalUtilityPercent: utilityResult.totalUtilityPercent,
        parameterUtilities: utilityResult.parameterUtilities,
        recommendation: utilityResult.recommendation,
        recommendationReason: utilityResult.recommendationReason,
      },
      resolvedConfig,
    };
  }

  // Counter Zone: escalate <= utility < accept
  const counterOffer = generateCounterOffer(
    resolvedConfig,
    vendorOffer,
    round,
    negotiationState,
    adaptiveStrategy,
  );
  reasons.push(
    `Weighted utility ${(u * 100).toFixed(0)}%: Counter at ${cs}${counterOffer.total_price?.toFixed(2)} with ${counterOffer.payment_terms}.`,
  );

  return {
    action: "COUNTER",
    utilityScore: u,
    counterOffer,
    reasons,
    utilityBreakdown: {
      totalUtility: utilityResult.totalUtility,
      totalUtilityPercent: utilityResult.totalUtilityPercent,
      parameterUtilities: utilityResult.parameterUtilities,
      recommendation: utilityResult.recommendation,
      recommendationReason: utilityResult.recommendationReason,
    },
    resolvedConfig,
  };
}

/**
 * Generate counter offer using resolved config and vendor emphasis
 */
function generateCounterOffer(
  resolvedConfig: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  negotiationState?: NegotiationState | null,
  adaptiveStrategy?: AdaptiveStrategyResult | null,
): Offer {
  const { priority, targetPrice, maxAcceptablePrice, priceRange } =
    resolvedConfig;

  // Use adaptive aggressiveness when available
  const baseAggressiveness = adaptiveStrategy
    ? adaptiveStrategy.adjustedAggressiveness
    : ({
        HIGH: 0.15,
        MEDIUM: 0.4,
        LOW: 0.55,
      }[priority] ?? 0.4);

  // Round adjustment: 2% per round, max 10%
  const roundAdjustment = Math.min(0.1, round * 0.02);

  // Concession bonus based on vendor's previous concessions
  let concessionBonus = 0;
  if (negotiationState && negotiationState.priceConcessions.length > 0) {
    const totalConcession = negotiationState.priceConcessions.reduce(
      (sum, c) => sum + c.changePercent,
      0,
    );
    concessionBonus = Math.min(0.1, totalConcession / 100);
  }

  // Calculate counter price
  const totalOffset = baseAggressiveness + roundAdjustment + concessionBonus;
  let counterPrice = targetPrice + priceRange * totalOffset;

  // Never counter above vendor's offer
  if (vendorOffer.total_price != null) {
    counterPrice = Math.min(counterPrice, vendorOffer.total_price);
  }

  // Never exceed max acceptable
  counterPrice = Math.min(counterPrice, maxAcceptablePrice);

  // Convergence blend (May 2026): the base formula uses a near-static offset
  // from target, so it barely moves after round 5. When the vendor has come
  // down significantly, blend toward the midpoint between our base counter
  // and the vendor's offer — this shows good-faith movement and prevents
  // the PM from looking stuck at the same number.
  if (
    vendorOffer.total_price !== null &&
    vendorOffer.total_price > 0 &&
    round >= 3
  ) {
    const midpoint = (counterPrice + vendorOffer.total_price) / 2;
    // Blend factor increases with round: round 3 = 31%, round 5 = 45%, round 7+ = 50%
    const blendFactor = Math.min(0.5, 0.10 + round * 0.07);
    const blendedPrice = counterPrice + (midpoint - counterPrice) * blendFactor;
    // Only apply if blended price is still within our acceptable range
    if (blendedPrice <= maxAcceptablePrice && blendedPrice > counterPrice) {
      counterPrice = blendedPrice;
    }
  }

  // Minimum step guard (May 2026): if the counter is the same as (or barely
  // different from) the previous PM counter, force at least a 1% movement
  // toward the vendor's offer. Without this, humanRoundPrice() downstream
  // can eat small blend movements and the PM appears stuck.
  if (
    negotiationState &&
    negotiationState.pmCounterHistory.length > 0 &&
    vendorOffer.total_price != null &&
    vendorOffer.total_price > 0 &&
    round >= 2
  ) {
    const lastPmCounter =
      negotiationState.pmCounterHistory[
        negotiationState.pmCounterHistory.length - 1
      ].price;
    if (lastPmCounter != null && lastPmCounter > 0) {
      const diff = Math.abs(counterPrice - lastPmCounter);
      const onePercent = lastPmCounter * 0.01;
      // If diff is less than 1% of the last counter, bump by 1% toward vendor
      if (diff < onePercent) {
        const stepped = lastPmCounter + onePercent;
        // Only apply if stepped price is still within bounds
        if (
          stepped <= maxAcceptablePrice &&
          stepped < vendorOffer.total_price
        ) {
          counterPrice = stepped;
        }
      }
    }
  }

  counterPrice = Math.round(counterPrice * 100) / 100;

  // Determine payment terms
  let counterTerms: string;
  if (priority === "HIGH") {
    counterTerms = `Net ${resolvedConfig.paymentTermsMaxDays}`;
  } else {
    const currentDays = vendorOffer.payment_terms_days ?? 30;
    const targetDays = Math.min(
      currentDays + 15,
      resolvedConfig.paymentTermsMaxDays,
    );
    counterTerms = `Net ${targetDays}`;
  }

  // Calculate delivery
  const today = new Date();
  let deliveryDate: string;
  let deliveryDays: number;

  if (vendorOffer.delivery_date) {
    deliveryDate = vendorOffer.delivery_date;
    const offerDate = new Date(vendorOffer.delivery_date);
    deliveryDays = Math.ceil(
      (offerDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
  } else if (vendorOffer.delivery_days) {
    deliveryDays = vendorOffer.delivery_days;
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + deliveryDays);
    deliveryDate = futureDate.toISOString().split("T")[0];
  } else if (resolvedConfig.deliveryDate) {
    deliveryDate = resolvedConfig.deliveryDate.toISOString().split("T")[0];
    deliveryDays = Math.ceil(
      (resolvedConfig.deliveryDate.getTime() - today.getTime()) /
        (1000 * 60 * 60 * 24),
    );
  } else {
    // Default 30 days
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 30);
    deliveryDate = futureDate.toISOString().split("T")[0];
    deliveryDays = 30;
  }

  return {
    total_price: counterPrice,
    payment_terms: counterTerms,
    delivery_date: deliveryDate,
    delivery_days: deliveryDays,
  };
}
