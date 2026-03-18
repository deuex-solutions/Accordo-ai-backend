import { Offer, Explainability, Decision, extractPaymentDays } from './types.js';

/**
 * NegotiationConfig defines the parameters and thresholds for utility-based negotiations.
 *
 * Threshold Zones (based on cumulative weighted utility 0-100%):
 * - Accept Zone: utility >= accept_threshold (default 70%)
 * - Counter Zone: utility >= escalate_threshold AND < accept_threshold (50-70%)
 * - Escalate Zone: utility >= walkaway_threshold AND < escalate_threshold (30-50%)
 * - Walk Away Zone: utility < walkaway_threshold (< 30%)
 *
 * UPDATED January 2026: Payment terms now support any "Net X" format (X = 1-120 days)
 * Non-standard terms (not 30/60/90) are interpolated for utility calculation.
 *
 * UPDATED February 2026: Changed from unit_price to total_price.
 * Negotiation is now based on total price instead of per-unit pricing.
 */
export interface NegotiationConfig {
  parameters: {
    total_price: {
      weight: number;
      direction: string;
      anchor: number;
      target: number;
      max_acceptable: number;
      concession_step: number;
    };
    payment_terms: {
      weight: number;
      options: readonly ['Net 30', 'Net 60', 'Net 90'];
      utility: {
        'Net 30': number;
        'Net 60': number;
        'Net 90': number;
      };
    };
  };
  /** Accept threshold - utility >= this triggers ACCEPT (default: 0.70 = 70%) */
  accept_threshold: number;
  /** Escalate threshold - utility >= this but < accept triggers COUNTER, < this triggers ESCALATE (default: 0.50 = 50%) */
  escalate_threshold?: number;
  /** Walk away threshold - utility < this triggers WALK_AWAY (default: 0.30 = 30%) */
  walkaway_threshold: number;
  max_rounds: number;
  /** Negotiation priority/strategy: HIGH=Maximize Savings, MEDIUM=Fair Deal, LOW=Quick Close */
  priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Currency code from the requisition (e.g. "USD", "INR", "GBP") */
  currency?: string;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function priceUtility(config: NegotiationConfig, price: number) {
  // CRITICAL FIX (Jan 2026): Use TARGET as the 100% utility point, not ANCHOR
  // The anchor is our opening position (aggressive), target is what we actually want
  // This ensures we only ACCEPT when vendor meets or beats our target, not just our anchor
  // UPDATED Feb 2026: Now uses total_price instead of unit_price
  const priceConfig = config.parameters?.total_price ?? (config.parameters as any)?.unit_price;
  if (!priceConfig) return 0;
  const { target, max_acceptable } = priceConfig;
  if (price <= target) return 1;  // At or below target = 100% utility
  if (price >= max_acceptable) return 0;  // At or above max = 0% utility
  // Linear interpolation between target and max_acceptable
  return clamp01(1 - (price - target) / (max_acceptable - target));
}

/**
 * Calculate utility for payment terms
 * UPDATED January 2026: Now supports any "Net X" format with interpolation
 * FIXED February 2026: Corrected direction — longer terms = BETTER for buyer (pays later)
 *
 * Canonical utility values (buyer perspective: longer = better):
 * - Net 30: 0.2 (worst for buyer — must pay quickly)
 * - Net 60: 0.6
 * - Net 90: 1.0 (best for buyer — maximum payment deferral)
 *
 * Non-standard terms are interpolated based on days:
 * - Net 45: interpolated between Net 30 (0.2) and Net 60 (0.6) = 0.4
 * - Net 75: interpolated between Net 60 (0.6) and Net 90 (1.0) = 0.8
 * - Net 21: extrapolated below Net 30 → ~0.0 (floored at 0)
 *
 * @param config - Negotiation configuration
 * @param terms - Payment terms string (e.g., "Net 45") or days number
 */
export function termsUtility(
  config: NegotiationConfig,
  terms: string | number | null
): number {
  if (terms === null || terms === undefined) return 0;

  // Canonical utility mapping (longer = better for buyer)
  const canonicalUtils: Record<string, number> = {
    'Net 30': 0.2,
    'Net 60': 0.6,
    'Net 90': 1.0,
  };

  // If a configured utility is present and different from canonical, use configured
  const configUtils = config.parameters?.payment_terms?.utility;

  // Use configured values IF they follow the correct direction (longer = higher)
  // Otherwise fall back to canonical
  const utils = configUtils && configUtils['Net 30'] <= configUtils['Net 90']
    ? configUtils   // correct direction — use configured
    : canonicalUtils; // inverted config — use canonical

  if (typeof terms === 'string' && terms in utils) {
    return utils[terms as keyof typeof utils];
  }

  // Extract days from term string or use number directly
  const days = typeof terms === 'number' ? terms : extractPaymentDays(terms);
  if (days === null || days < 1 || days > 120) return 0;

  // Reference points for interpolation (longer = better for buyer)
  const points = [
    { days: 30, utility: utils['Net 30'] ?? 0.2 },  // 0.2
    { days: 60, utility: utils['Net 60'] ?? 0.6 },  // 0.6
    { days: 90, utility: utils['Net 90'] ?? 1.0 },  // 1.0
  ];

  // If exactly matches a standard point
  for (const p of points) {
    if (days === p.days) return p.utility;
  }

  // Interpolate/extrapolate based on days
  if (days < 30) {
    // Worse than Net 30 for buyer — extrapolate down, floor at 0
    const ratio = days / 30;
    return Math.max(0, points[0].utility * ratio);
  } else if (days < 60) {
    // Between Net 30 and Net 60
    const ratio = (days - 30) / (60 - 30);
    return points[0].utility + ratio * (points[1].utility - points[0].utility);
  } else if (days < 90) {
    // Between Net 60 and Net 90
    const ratio = (days - 60) / (90 - 60);
    return points[1].utility + ratio * (points[2].utility - points[1].utility);
  } else {
    // Better than Net 90 for buyer — cap at 1.0
    return Math.min(1.0, points[2].utility + (days - 90) * 0.004);
  }
}

export function totalUtility(config: NegotiationConfig, offer: Offer) {
  const priceCfg = config.parameters?.total_price ?? (config.parameters as any)?.unit_price;
  const termsCfg = config.parameters?.payment_terms;
  const wP = priceCfg?.weight ?? 0.6;
  const wT = termsCfg?.weight ?? 0.4;

  const pu =
    offer.total_price == null ? 0 : priceUtility(config, offer.total_price);
  const tu =
    offer.payment_terms == null
      ? 0
      : termsUtility(config, offer.payment_terms);
  return clamp01(pu * wP + tu * wT);
}

/**
 * Compute explainability payload from config, vendor offer, and decision
 * This provides a complete audit trail of how the decision was made
 * UPDATED Feb 2026: Now uses total_price instead of unit_price
 */
export function computeExplainability(
  config: NegotiationConfig,
  vendorOffer: Offer,
  decision: Decision
): Explainability {
  const priceCfg = config.parameters?.total_price ?? (config.parameters as any)?.unit_price;
  const termsCfg = config.parameters?.payment_terms;
  const wP = priceCfg?.weight ?? 0.6;
  const wT = termsCfg?.weight ?? 0.4;

  const pu =
    vendorOffer.total_price == null
      ? null
      : priceUtility(config, vendorOffer.total_price);
  const tu =
    vendorOffer.payment_terms == null
      ? null
      : termsUtility(config, vendorOffer.payment_terms);

  const weightedPrice = pu == null ? null : pu * wP;
  const weightedTerms = tu == null ? null : tu * wT;

  const total =
    weightedPrice == null || weightedTerms == null
      ? null
      : clamp01(weightedPrice + weightedTerms);

  return {
    vendorOffer: {
      total_price: vendorOffer.total_price,
      payment_terms: vendorOffer.payment_terms,
    },
    utilities: {
      priceUtility: pu,
      termsUtility: tu,
      weightedPrice,
      weightedTerms,
      total,
    },
    decision: {
      action: decision.action,
      reasons: decision.reasons,
      counterOffer: decision.counterOffer ?? null,
    },
    configSnapshot: {
      weights: { price: wP, terms: wT },
      thresholds: {
        accept: config.accept_threshold,
        escalate: config.escalate_threshold ?? 0.50,
        walkaway: config.walkaway_threshold,
      },
      totalPrice: {
        anchor: priceCfg?.anchor ?? 0,
        target: priceCfg?.target ?? 0,
        max: priceCfg?.max_acceptable ?? 0,
        step: priceCfg?.concession_step ?? 0,
      },
      termOptions: [...(termsCfg?.options ?? ['Net 30', 'Net 60', 'Net 90'])],
    },
  };
}
