/**
 * Unit tests for weightedUtility.ts (Pactum-style 5-param engine)
 *
 * Covers:
 * 1. calculateWeightedUtilityFromResolved — 5-param calculation
 * 2. Payment terms utility (new: replaces maxAcceptablePrice)
 * 3. Delivery tolerance derived from preferredDeliveryDate - deliveryDate
 * 4. Quality standards excluded when no certs configured
 * 5. resolveNegotiationConfig — weight resolution and DEFAULT_WEIGHTS
 */

import { describe, it, expect } from 'vitest';
import {
  calculateWeightedUtilityFromResolved,
  resolveNegotiationConfig,
} from '../../../src/modules/chatbot/engine/weighted-utility.js';
import { DEFAULT_WEIGHTS } from '../../../src/modules/chatbot/engine/types.js';
import type { ResolvedNegotiationConfig, ExtendedOffer } from '../../../src/modules/chatbot/engine/types.js';

// ─────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────

function makeResolvedConfig(overrides: Partial<ResolvedNegotiationConfig> = {}): ResolvedNegotiationConfig {
  const requiredDate = new Date('2026-06-01');
  const preferredDate = new Date('2026-05-15'); // 17 days before required

  return {
    targetPrice: 90000,
    maxAcceptablePrice: 110000,
    paymentTermsMinDays: 30,
    paymentTermsMaxDays: 90,
    deliveryDate: requiredDate,
    preferredDeliveryDate: preferredDate,
    partialDeliveryAllowed: false,
    warrantyPeriodMonths: 12,
    lateDeliveryPenaltyPerDay: 1,
    qualityStandards: [],
    maxRounds: 50,
    walkawayThreshold: 20,
    priority: 'MEDIUM',
    weights: { ...DEFAULT_WEIGHTS },
    weightsAreUserModified: false,
    acceptThreshold: 0.70,
    escalateThreshold: 0.50,
    walkAwayThreshold: 0.30,
    anchorPrice: 76500,
    priceRange: 20000,
    concessionStep: 400,
    sources: {},
    ...overrides,
  };
}

function makeOffer(overrides: Partial<ExtendedOffer> = {}): ExtendedOffer {
  return {
    total_price: null,
    payment_terms: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// DEFAULT_WEIGHTS shape (Feb 2026)
// ─────────────────────────────────────────────

describe('DEFAULT_WEIGHTS', () => {
  it('sums to 100', () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
  });

  it('has paymentTerms (not maxAcceptablePrice)', () => {
    expect('paymentTerms' in DEFAULT_WEIGHTS).toBe(true);
    expect('maxAcceptablePrice' in DEFAULT_WEIGHTS).toBe(false);
  });

  it('has correct weight distribution', () => {
    expect(DEFAULT_WEIGHTS.targetUnitPrice).toBe(40);
    expect(DEFAULT_WEIGHTS.paymentTerms).toBe(25);
    expect(DEFAULT_WEIGHTS.deliveryDate).toBe(20);
    expect(DEFAULT_WEIGHTS.warrantyPeriod).toBe(10);
    expect(DEFAULT_WEIGHTS.qualityStandards).toBe(5);
  });

  it('primary params (price+terms+delivery) cover 85% of total weight', () => {
    const primaryWeight = DEFAULT_WEIGHTS.targetUnitPrice + DEFAULT_WEIGHTS.paymentTerms + DEFAULT_WEIGHTS.deliveryDate;
    expect(primaryWeight).toBe(85);
  });
});

// ─────────────────────────────────────────────
// Price utility in calculateWeightedUtilityFromResolved
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — price parameter', () => {
  it('scores 1.0 when price equals target', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 90000, payment_terms: null });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['targetUnitPrice']?.utility).toBe(1);
  });

  it('scores 0.0 when price equals max_acceptable', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 110000 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['targetUnitPrice']?.utility).toBe(0);
  });

  it('scores 0.5 at the midpoint between target and max', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 100000 }); // midpoint of 90000-110000
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['targetUnitPrice']?.utility).toBeCloseTo(0.5, 3);
  });

  it('does NOT score price when total_price is null', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: null });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['targetUnitPrice']).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// Payment terms utility (replaces maxAcceptablePrice)
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — paymentTerms parameter (new)', () => {
  it('scores 0.0 for Net 30 (worst for buyer — shortest terms)', () => {
    const cfg = makeResolvedConfig(); // minDays=30, maxDays=90
    const offer = makeOffer({ payment_terms: 'Net 30', payment_terms_days: 30 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['paymentTerms']?.utility).toBeCloseTo(0.0, 3);
  });

  it('scores 1.0 for Net 90 (best for buyer — longest terms)', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ payment_terms: 'Net 90', payment_terms_days: 90 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['paymentTerms']?.utility).toBeCloseTo(1.0, 3);
  });

  it('scores ~0.5 for Net 60 (midpoint between 30 and 90)', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ payment_terms: 'Net 60', payment_terms_days: 60 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['paymentTerms']?.utility).toBeCloseTo(0.5, 3);
  });

  it('Net 90 utility > Net 60 > Net 30 (longer = better for buyer)', () => {
    const cfg = makeResolvedConfig();
    const u30 = calculateWeightedUtilityFromResolved(
      makeOffer({ payment_terms: 'Net 30', payment_terms_days: 30 }), cfg
    ).parameterUtilities['paymentTerms']?.utility ?? 0;
    const u60 = calculateWeightedUtilityFromResolved(
      makeOffer({ payment_terms: 'Net 60', payment_terms_days: 60 }), cfg
    ).parameterUtilities['paymentTerms']?.utility ?? 0;
    const u90 = calculateWeightedUtilityFromResolved(
      makeOffer({ payment_terms: 'Net 90', payment_terms_days: 90 }), cfg
    ).parameterUtilities['paymentTerms']?.utility ?? 0;

    expect(u90).toBeGreaterThan(u60);
    expect(u60).toBeGreaterThan(u30);
  });

  it('does NOT score paymentTerms when payment_terms is null', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 90000, payment_terms: null });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['paymentTerms']).toBeUndefined();
  });

  it('parses days from payment_terms string when payment_terms_days not set', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ payment_terms: 'Net 90' }); // no payment_terms_days
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['paymentTerms']?.utility).toBeCloseTo(1.0, 1);
  });
});

// ─────────────────────────────────────────────
// Delivery utility with derived tolerance
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — deliveryDate with derived tolerance', () => {
  it('scores 1.0 when delivery is on the required date', () => {
    const cfg = makeResolvedConfig();
    // Calculate days from today to required date (2026-06-01)
    const requiredDays = Math.ceil(
      (new Date('2026-06-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const offer = makeOffer({ delivery_days: requiredDays });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['deliveryDate']?.utility).toBeCloseTo(1.0, 3);
  });

  it('scores 1.0 when delivery is before the required date', () => {
    const cfg = makeResolvedConfig();
    const requiredDays = Math.ceil(
      (new Date('2026-06-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const offer = makeOffer({ delivery_days: requiredDays - 5 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['deliveryDate']?.utility).toBeCloseTo(1.0, 3);
  });

  it('scores below 1.0 when delivery exceeds required date', () => {
    const cfg = makeResolvedConfig();
    const requiredDays = Math.ceil(
      (new Date('2026-06-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const offer = makeOffer({ delivery_days: requiredDays + 10 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    const utility = result.parameterUtilities['deliveryDate']?.utility ?? 0;
    expect(utility).toBeGreaterThan(0);
    expect(utility).toBeLessThan(1.0);
  });

  it('does NOT score delivery when delivery_days is null', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 90000, delivery_days: null });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['deliveryDate']).toBeUndefined();
  });

  it('does NOT score delivery when deliveryDate is null in config', () => {
    const cfg = makeResolvedConfig({ deliveryDate: null });
    const offer = makeOffer({ delivery_days: 30 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['deliveryDate']).toBeUndefined();
  });

  it('uses tolerance derived from preferredDate gap (not hardcoded 30)', () => {
    // preferredDate is 2026-05-15, requiredDate is 2026-06-01 => ~17 day gap => tolerance=17
    // With a 17-day late delivery, utility should be 0 (or near 0)
    const cfg = makeResolvedConfig();
    const requiredDays = Math.ceil(
      (new Date('2026-06-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    // 17 days past required date: should reach 0 utility with 17-day tolerance
    const offer = makeOffer({ delivery_days: requiredDays + 17 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    const utility = result.parameterUtilities['deliveryDate']?.utility ?? 1;
    // With 17-day tolerance, 17 days late = exactly 0
    expect(utility).toBeCloseTo(0, 1);
  });
});

// ─────────────────────────────────────────────
// Quality standards exclusion logic
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — quality standards exclusion', () => {
  it('does NOT score quality when no certs required in config (empty qualityStandards)', () => {
    const cfg = makeResolvedConfig({ qualityStandards: [] });
    const offer = makeOffer({ quality_certifications: ['ISO 9001'] });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    // Should be excluded entirely — no phantom 100% score
    expect(result.parameterUtilities['qualityStandards']).toBeUndefined();
  });

  it('does NOT score quality when vendor does not mention certifications', () => {
    const cfg = makeResolvedConfig({ qualityStandards: ['ISO 9001'] });
    const offer = makeOffer({ total_price: 90000 }); // no quality_certifications
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['qualityStandards']).toBeUndefined();
  });

  it('scores quality when certs are configured AND vendor offers certs', () => {
    const cfg = makeResolvedConfig({ qualityStandards: ['ISO 9001', 'ISO 14001'] });
    const offer = makeOffer({ quality_certifications: ['ISO 9001'] }); // 1 of 2 matches
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    const utility = result.parameterUtilities['qualityStandards']?.utility;
    expect(utility).toBeDefined();
    expect(utility).toBeCloseTo(0.5, 3); // 1/2 certs matched
  });

  it('scores 1.0 when all required certs are offered', () => {
    const cfg = makeResolvedConfig({ qualityStandards: ['ISO 9001'] });
    const offer = makeOffer({ quality_certifications: ['ISO 9001'] });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['qualityStandards']?.utility).toBe(1.0);
  });

  it('excludion means quality weight is dropped from totalWeight normalization', () => {
    // With no certs, quality is excluded from totalWeight
    // So total should be normalized against 95% (not 100%)
    const cfg = makeResolvedConfig({ qualityStandards: [] });
    const offer = makeOffer({ total_price: 90000, payment_terms: 'Net 90', payment_terms_days: 90 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    // Price (40%) at 1.0 + Terms (25%) at 1.0 = 65% contribution
    // totalWeight = 65, normalized by 100/65
    // totalUtility = (40/100 + 25/100) * (100/65) = 0.65 * (100/65) = 1.0
    // (because delivery is also excluded when delivery_days is null)
    // Only price+terms scored: both 1.0, so final is 1.0
    expect(result.totalUtility).toBeCloseTo(1.0, 3);
  });
});

// ─────────────────────────────────────────────
// Warranty utility
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — warranty parameter', () => {
  it('does NOT score warranty when vendor offer has no warranty info', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 90000 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['warrantyPeriod']).toBeUndefined();
  });

  it('scores 1.0 when vendor offers full required warranty', () => {
    const cfg = makeResolvedConfig({ warrantyPeriodMonths: 12 });
    const offer = makeOffer({ warranty_months: 12 });
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['warrantyPeriod']?.utility).toBeCloseTo(1.0, 3);
  });

  it('scores proportionally when vendor offers partial warranty', () => {
    const cfg = makeResolvedConfig({ warrantyPeriodMonths: 12 });
    const offer = makeOffer({ warranty_months: 6 }); // 50% of required
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['warrantyPeriod']?.utility).toBeCloseTo(0.5, 3);
  });

  it('caps warranty utility at 1.0 when vendor exceeds requirement', () => {
    const cfg = makeResolvedConfig({ warrantyPeriodMonths: 12 });
    const offer = makeOffer({ warranty_months: 24 }); // 2x required
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.parameterUtilities['warrantyPeriod']?.utility).toBeLessThanOrEqual(1.0);
  });
});

// ─────────────────────────────────────────────
// Total utility normalization
// ─────────────────────────────────────────────

describe('calculateWeightedUtilityFromResolved — total utility normalization', () => {
  it('normalizes when only some parameters are scored', () => {
    const cfg = makeResolvedConfig();
    // Only price scored (40% weight) — totalWeight = 40, not 100
    const offer = makeOffer({ total_price: 90000 }); // at target = utility 1.0
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    // Contribution = 1.0 * (40/100) = 0.4
    // Normalized: 0.4 * (100/40) = 1.0
    expect(result.totalUtility).toBeCloseTo(1.0, 3);
  });

  it('returns 0 when no parameters are scored', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({}); // nothing filled in
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.totalUtility).toBe(0);
  });

  it('clamps total utility to [0, 1]', () => {
    const cfg = makeResolvedConfig();
    const offer = makeOffer({ total_price: 1 }); // far below target
    const result = calculateWeightedUtilityFromResolved(offer, cfg);
    expect(result.totalUtility).toBeGreaterThanOrEqual(0);
    expect(result.totalUtility).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────
// resolveNegotiationConfig — weight resolution
// ─────────────────────────────────────────────

describe('resolveNegotiationConfig — weight resolution', () => {
  it('uses DEFAULT_WEIGHTS when no wizardConfig', () => {
    const resolved = resolveNegotiationConfig(null);
    expect(resolved.weights.targetUnitPrice).toBe(DEFAULT_WEIGHTS.targetUnitPrice);
    expect(resolved.weights.paymentTerms).toBe(DEFAULT_WEIGHTS.paymentTerms);
    expect(resolved.weights.deliveryDate).toBe(DEFAULT_WEIGHTS.deliveryDate);
    expect(resolved.weights.warrantyPeriod).toBe(DEFAULT_WEIGHTS.warrantyPeriod);
    expect(resolved.weights.qualityStandards).toBe(DEFAULT_WEIGHTS.qualityStandards);
  });

  it('uses user-modified weights when aiSuggested=false', () => {
    const customWeights = {
      targetUnitPrice: 50,
      paymentTerms: 20,
      deliveryDate: 20,
      warrantyPeriod: 5,
      qualityStandards: 5,
    };
    const resolved = resolveNegotiationConfig({
      aiSuggested: false,
      parameterWeights: customWeights,
      priority: 'MEDIUM',
      priceQuantity: { targetUnitPrice: 90000, maxAcceptablePrice: 110000, minOrderQuantity: 1 },
      paymentTerms: { minDays: 30, maxDays: 90 },
      delivery: { requiredDate: '2026-06-01', preferredDate: '2026-05-15', partialDelivery: { allowed: false } },
      contractSla: { warrantyPeriod: '1_YEAR', lateDeliveryPenaltyPerDay: 1 },
      negotiationControl: { maxRounds: 50, walkawayThreshold: 20 },
    });
    expect(resolved.weights.targetUnitPrice).toBe(50);
    expect(resolved.weightsAreUserModified).toBe(true);
  });

  it('falls back to DEFAULT_WEIGHTS keys that are missing in parameterWeights', () => {
    const resolved = resolveNegotiationConfig({
      aiSuggested: false,
      parameterWeights: { targetUnitPrice: 100 }, // missing other keys
      priority: 'MEDIUM',
      priceQuantity: { targetUnitPrice: 90000, maxAcceptablePrice: 110000, minOrderQuantity: 1 },
      paymentTerms: { minDays: 30, maxDays: 90 },
      delivery: { requiredDate: '2026-06-01', preferredDate: '2026-05-15', partialDelivery: { allowed: false } },
      contractSla: { warrantyPeriod: '1_YEAR', lateDeliveryPenaltyPerDay: 1 },
      negotiationControl: { maxRounds: 50, walkawayThreshold: 20 },
    });
    // Missing keys should be backfilled from DEFAULT_WEIGHTS
    expect(resolved.weights.paymentTerms).toBe(DEFAULT_WEIGHTS.paymentTerms);
    expect(resolved.weights.deliveryDate).toBe(DEFAULT_WEIGHTS.deliveryDate);
  });
});
