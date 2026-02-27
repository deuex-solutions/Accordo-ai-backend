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
  const { target, max_acceptable } = config.parameters.total_price;
  if (price <= target) return 1;  // At or below target = 100% utility
  if (price >= max_acceptable) return 0;  // At or above max = 0% utility
  // Linear interpolation between target and max_acceptable
  return clamp01(1 - (price - target) / (max_acceptable - target));
}

/**
 * Calculate utility for payment terms
 * UPDATED January 2026: Now supports any "Net X" format with interpolation
 *
 * Standard terms use configured utility values:
 * - Net 30: 1.0 (best for buyer - shorter payment time)
 * - Net 60: 0.7
 * - Net 90: 0.5 (worst for buyer - longer payment time)
 *
 * Non-standard terms are interpolated based on days:
 * - Net 45: interpolated between Net 30 (1.0) and Net 60 (0.7) = 0.85
 * - Net 21: extrapolated above Net 30 = ~1.0 (capped)
 * - Net 75: interpolated between Net 60 (0.7) and Net 90 (0.5) = 0.6
 *
 * @param config - Negotiation configuration
 * @param terms - Payment terms string (e.g., "Net 45") or days number
 */
export function termsUtility(
  config: NegotiationConfig,
  terms: string | number | null
): number {
  if (terms === null || terms === undefined) return 0;

  // If standard term string, use configured utility
  const utils = config.parameters.payment_terms.utility;
  if (typeof terms === 'string' && terms in utils) {
    return utils[terms as keyof typeof utils];
  }

  // Extract days from term string or use number directly
  const days = typeof terms === 'number' ? terms : extractPaymentDays(terms);
  if (days === null || days < 1 || days > 120) return 0;

  // Reference points for interpolation
  // Shorter payment time = better for buyer = higher utility
  const points = [
    { days: 30, utility: utils['Net 30'] },  // 1.0
    { days: 60, utility: utils['Net 60'] },  // 0.7
    { days: 90, utility: utils['Net 90'] },  // 0.5
  ];

  // If exactly matches a standard point
  for (const p of points) {
    if (days === p.days) return p.utility;
  }

  // Interpolate/extrapolate based on days
  if (days < 30) {
    // Better than Net 30 - cap at 1.0
    return Math.min(1.0, points[0].utility + (30 - days) * 0.01);
  } else if (days < 60) {
    // Between Net 30 and Net 60
    const ratio = (days - 30) / (60 - 30);
    return points[0].utility - ratio * (points[0].utility - points[1].utility);
  } else if (days < 90) {
    // Between Net 60 and Net 90
    const ratio = (days - 60) / (90 - 60);
    return points[1].utility - ratio * (points[1].utility - points[2].utility);
  } else {
    // Worse than Net 90 - continue linear decline but floor at 0.1
    const decline = (days - 90) * 0.01;
    return Math.max(0.1, points[2].utility - decline);
  }
}

export function totalUtility(config: NegotiationConfig, offer: Offer) {
  const wP = config.parameters.total_price.weight;
  const wT = config.parameters.payment_terms.weight;

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
  const wP = config.parameters.total_price.weight;
  const wT = config.parameters.payment_terms.weight;

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
        anchor: config.parameters.total_price.anchor,
        target: config.parameters.total_price.target,
        max: config.parameters.total_price.max_acceptable,
        step: config.parameters.total_price.concession_step,
      },
      termOptions: [...config.parameters.payment_terms.options],
    },
  };
}
