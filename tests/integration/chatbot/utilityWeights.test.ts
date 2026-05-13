/**
 * Integration tests for utility weight system (Feb 2026)
 *
 * These tests verify the utility weight system's correctness at the integration
 * level — testing how resolveNegotiationConfig interacts with the weighted
 * utility calculator for realistic deal scenarios.
 *
 * No DB required: these tests use pure in-memory logic and are safe
 * to run alongside the integration test suite.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveNegotiationConfig,
  calculateWeightedUtilityFromResolved,
} from '../../../src/modules/chatbot/engine/weighted-utility.js';
import { DEFAULT_WEIGHTS } from '../../../src/modules/chatbot/engine/types.js';
import type { ExtendedOffer, WizardConfig } from '../../../src/modules/chatbot/engine/types.js';

function makeWizardConfig(overrides: Partial<WizardConfig> = {}): WizardConfig {
  return {
    priority: 'MEDIUM',
    priceQuantity: {
      targetUnitPrice: 100000,
      maxAcceptablePrice: 130000,
      minOrderQuantity: 50,
    },
    paymentTerms: {
      minDays: 30,
      maxDays: 90,
    },
    delivery: {
      requiredDate: '2026-08-01',
      preferredDate: '2026-07-15',
      partialDelivery: { allowed: false },
    },
    contractSla: {
      warrantyPeriod: '2_YEARS',
      lateDeliveryPenaltyPerDay: 2,
      qualityStandards: ['ISO 9001'],
    },
    negotiationControl: {
      maxRounds: 50,
      walkawayThreshold: 20,
    },
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Scenario: Procurement of IT equipment
// Target: $100K, Max: $130K, Terms: Net 30-90, Delivery: Aug 1
// ─────────────────────────────────────────────

describe('Utility weight system — IT equipment procurement scenario', () => {
  const wizard = makeWizardConfig();
  const resolved = resolveNegotiationConfig(wizard);

  it('DEFAULT_WEIGHTS do not include maxAcceptablePrice', () => {
    expect('maxAcceptablePrice' in DEFAULT_WEIGHTS).toBe(false);
    expect('paymentTerms' in DEFAULT_WEIGHTS).toBe(true);
  });

  it('resolved config has correct warranty period (2 years = 24 months)', () => {
    expect(resolved.warrantyPeriodMonths).toBe(24);
  });

  it('resolved config has correct quality standards from wizard', () => {
    expect(resolved.qualityStandards).toContain('ISO 9001');
  });

  it('vendor at target price + best terms → high utility', () => {
    const offer: ExtendedOffer = {
      total_price: 100000,    // at target → 1.0
      payment_terms: 'Net 90',
      payment_terms_days: 90, // best terms → 1.0
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    // price(40%)*1.0 + terms(25%)*1.0 = 65, normalized: 1.0
    expect(result.totalUtility).toBeCloseTo(1.0, 2);
    expect(result.recommendation).toBe('ACCEPT');
  });

  it('vendor at max price + worst terms → very low utility', () => {
    const offer: ExtendedOffer = {
      total_price: 130000,    // at max → 0.0
      payment_terms: 'Net 30',
      payment_terms_days: 30, // worst terms → 0.0
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    expect(result.totalUtility).toBeCloseTo(0.0, 2);
  });

  it('provides quality cert match when vendor offers required cert', () => {
    const offer: ExtendedOffer = {
      total_price: 100000,
      payment_terms: 'Net 90',
      payment_terms_days: 90,
      quality_certifications: ['ISO 9001'],
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    expect(result.parameterUtilities['qualityStandards']?.utility).toBe(1.0);
  });

  it('excludes quality from scoring when vendor provides no certs', () => {
    const offer: ExtendedOffer = {
      total_price: 100000,
      payment_terms: 'Net 90',
      payment_terms_days: 90,
      // No quality_certifications field
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    // Quality not scored — excluded from totalWeight normalization
    expect(result.parameterUtilities['qualityStandards']).toBeUndefined();
  });

  it('warranty scoring: vendor offers 12 months against 24-month requirement', () => {
    const offer: ExtendedOffer = {
      total_price: 100000,
      payment_terms: 'Net 90',
      payment_terms_days: 90,
      warranty_months: 12,  // 50% of required 24 months
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    expect(result.parameterUtilities['warrantyPeriod']?.utility).toBeCloseTo(0.5, 2);
  });
});

// ─────────────────────────────────────────────
// Scenario: User-modified weights (40% higher price focus)
// ─────────────────────────────────────────────

describe('User-modified weights — stricter price focus', () => {
  const wizard = makeWizardConfig({
    aiSuggested: false,
    parameterWeights: {
      targetUnitPrice: 60,   // user wants to prioritize price heavily
      paymentTerms: 15,
      deliveryDate: 15,
      warrantyPeriod: 7,
      qualityStandards: 3,
    },
  });
  const resolved = resolveNegotiationConfig(wizard);

  it('resolved weights match user-provided values', () => {
    expect(resolved.weights.targetUnitPrice).toBe(60);
    expect(resolved.weights.paymentTerms).toBe(15);
    expect(resolved.weightsAreUserModified).toBe(true);
  });

  it('bad price impacts utility more heavily with user weights', () => {
    const defaultWizard = makeWizardConfig(); // DEFAULT_WEIGHTS: price=40
    const defaultResolved = resolveNegotiationConfig(defaultWizard);

    const offer: ExtendedOffer = {
      total_price: 130000,    // at max → 0.0 price
      payment_terms: 'Net 90',
      payment_terms_days: 90, // perfect terms → 1.0
    };

    const defaultResult = calculateWeightedUtilityFromResolved(offer, defaultResolved);
    const userResult = calculateWeightedUtilityFromResolved(offer, resolved);

    // User weights: 60% on price (bad) vs 15% on terms (good)
    // Default weights: 40% on price (bad) vs 25% on terms (good)
    // User-modified should have lower utility (price counts more)
    expect(userResult.totalUtility).toBeLessThan(defaultResult.totalUtility);
  });

  it('perfect offer still scores 1.0 regardless of weight distribution', () => {
    const offer: ExtendedOffer = {
      total_price: 100000,    // at target → 1.0
      payment_terms: 'Net 90',
      payment_terms_days: 90, // best → 1.0
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    expect(result.totalUtility).toBeCloseTo(1.0, 2);
  });
});

// ─────────────────────────────────────────────
// Scenario: Delivery tolerance derived from preferred date
// ─────────────────────────────────────────────

describe('Delivery tolerance — derived from preferredDate gap', () => {
  const wizard = makeWizardConfig({
    delivery: {
      requiredDate: '2026-08-01',
      preferredDate: '2026-07-01', // 31-day gap → 31-day tolerance
      partialDelivery: { allowed: false },
    },
  });
  const resolved = resolveNegotiationConfig(wizard);

  it('vendor on required date scores 1.0', () => {
    const requiredDays = Math.ceil(
      (new Date('2026-08-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const offer: ExtendedOffer = {
      total_price: 100000,
      delivery_days: requiredDays,
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    expect(result.parameterUtilities['deliveryDate']?.utility).toBeCloseTo(1.0, 2);
  });

  it('vendor exactly at tolerance boundary (~31 days late) scores 0', () => {
    const requiredDays = Math.ceil(
      (new Date('2026-08-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    const offer: ExtendedOffer = {
      total_price: 100000,
      delivery_days: requiredDays + 31, // exactly at tolerance limit
    };
    const result = calculateWeightedUtilityFromResolved(offer, resolved);
    const utility = result.parameterUtilities['deliveryDate']?.utility ?? 1;
    expect(utility).toBeCloseTo(0.0, 1);
  });

  it('different preferredDate gaps produce different tolerances', () => {
    const tightWizard = makeWizardConfig({
      delivery: {
        requiredDate: '2026-08-01',
        preferredDate: '2026-07-25', // only 7-day gap → 7-day tolerance
        partialDelivery: { allowed: false },
      },
    });
    const looseWizard = makeWizardConfig({
      delivery: {
        requiredDate: '2026-08-01',
        preferredDate: '2026-06-01', // 61-day gap → 61-day tolerance
        partialDelivery: { allowed: false },
      },
    });

    const tightResolved = resolveNegotiationConfig(tightWizard);
    const looseResolved = resolveNegotiationConfig(looseWizard);

    const requiredDays = Math.ceil(
      (new Date('2026-08-01').getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // 20 days late — should hurt more with tight tolerance (7 days) than loose (61 days)
    const offer: ExtendedOffer = {
      total_price: 100000,
      delivery_days: requiredDays + 20,
    };

    const tightResult = calculateWeightedUtilityFromResolved(offer, tightResolved);
    const looseResult = calculateWeightedUtilityFromResolved(offer, looseResolved);

    const tightUtility = tightResult.parameterUtilities['deliveryDate']?.utility ?? 1;
    const looseUtility = looseResult.parameterUtilities['deliveryDate']?.utility ?? 1;

    // 20 days late vs 7-day tolerance → 0 utility (or near 0)
    // 20 days late vs 61-day tolerance → still some utility remaining
    expect(looseUtility).toBeGreaterThan(tightUtility);
  });
});
