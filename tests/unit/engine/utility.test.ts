/**
 * Unit tests for utility.ts — legacy 2-param engine
 *
 * Focuses on:
 * 1. priceUtility — correct linear interpolation
 * 2. termsUtility — corrected direction (longer = better for buyer)
 * 3. totalUtility — combined weighting
 */

import { describe, it, expect } from 'vitest';
import { priceUtility, termsUtility, totalUtility } from '../../../src/modules/chatbot/engine/utility.js';
import type { NegotiationConfig } from '../../../src/modules/chatbot/engine/utility.js';

// ─────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────

function makeConfig(overrides: Partial<NegotiationConfig> = {}): NegotiationConfig {
  return {
    parameters: {
      total_price: {
        weight: 0.6,
        direction: 'minimize',
        anchor: 80000,
        target: 90000,
        max_acceptable: 110000,
        concession_step: 5000,
      },
      payment_terms: {
        weight: 0.4,
        options: ['Net 30', 'Net 60', 'Net 90'] as const,
        utility: {
          'Net 30': 0.2,
          'Net 60': 0.6,
          'Net 90': 1.0,
        },
      },
    },
    accept_threshold: 0.70,
    escalate_threshold: 0.50,
    walkaway_threshold: 0.30,
    max_rounds: 10,
    priority: 'MEDIUM',
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// priceUtility
// ─────────────────────────────────────────────

describe('priceUtility', () => {
  const cfg = makeConfig();

  it('returns 1.0 when price equals target', () => {
    expect(priceUtility(cfg, 90000)).toBe(1);
  });

  it('returns 1.0 when price is below target', () => {
    expect(priceUtility(cfg, 70000)).toBe(1);
  });

  it('returns 0.0 when price equals max_acceptable', () => {
    expect(priceUtility(cfg, 110000)).toBe(0);
  });

  it('returns small positive decaying utility when price exceeds max_acceptable', () => {
    expect(priceUtility(cfg, 130000)).toBeGreaterThan(0);
    expect(priceUtility(cfg, 130000)).toBeLessThan(0.05);
  });

  it('returns 0.5 at the midpoint between target and max', () => {
    // midpoint = (90000 + 110000) / 2 = 100000
    expect(priceUtility(cfg, 100000)).toBeCloseTo(0.5, 5);
  });

  it('returns a value between 0 and 1 for any price in range', () => {
    for (let price = 90000; price <= 110000; price += 1000) {
      const u = priceUtility(cfg, price);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonically decreasing as price increases', () => {
    const prices = [90000, 95000, 100000, 105000, 110000];
    for (let i = 1; i < prices.length; i++) {
      expect(priceUtility(cfg, prices[i])).toBeLessThanOrEqual(priceUtility(cfg, prices[i - 1]));
    }
  });
});

// ─────────────────────────────────────────────
// termsUtility — corrected direction (Feb 2026)
// ─────────────────────────────────────────────

describe('termsUtility (corrected direction: longer = better for buyer)', () => {
  const cfg = makeConfig();

  it('returns 0.2 for Net 30 (worst for buyer)', () => {
    expect(termsUtility(cfg, 'Net 30')).toBeCloseTo(0.2, 5);
  });

  it('returns 0.6 for Net 60 (middle)', () => {
    expect(termsUtility(cfg, 'Net 60')).toBeCloseTo(0.6, 5);
  });

  it('returns 1.0 for Net 90 (best for buyer)', () => {
    expect(termsUtility(cfg, 'Net 90')).toBeCloseTo(1.0, 5);
  });

  it('Net 90 > Net 60 > Net 30 (longer = better)', () => {
    expect(termsUtility(cfg, 'Net 90')).toBeGreaterThan(termsUtility(cfg, 'Net 60'));
    expect(termsUtility(cfg, 'Net 60')).toBeGreaterThan(termsUtility(cfg, 'Net 30'));
  });

  it('interpolates Net 45 between Net 30 (0.2) and Net 60 (0.6)', () => {
    const u45 = termsUtility(cfg, 'Net 45');
    expect(u45).toBeGreaterThan(0.2);
    expect(u45).toBeLessThan(0.6);
    // Linear midpoint: 0.2 + (15/30) * (0.6 - 0.2) = 0.2 + 0.2 = 0.4
    expect(u45).toBeCloseTo(0.4, 1);
  });

  it('interpolates Net 75 between Net 60 (0.6) and Net 90 (1.0)', () => {
    const u75 = termsUtility(cfg, 'Net 75');
    expect(u75).toBeGreaterThan(0.6);
    expect(u75).toBeLessThan(1.0);
    // Linear midpoint: 0.6 + (15/30) * (1.0 - 0.6) = 0.6 + 0.2 = 0.8
    expect(u75).toBeCloseTo(0.8, 1);
  });

  it('returns 0 for null/undefined terms', () => {
    expect(termsUtility(cfg, null)).toBe(0);
  });

  it('returns a value ≤ 0.2 for terms shorter than Net 30 (worse for buyer)', () => {
    const u21 = termsUtility(cfg, 'Net 21');
    expect(u21).toBeLessThan(0.2);
    expect(u21).toBeGreaterThanOrEqual(0);
  });

  it('returns ≥ 1.0 for terms longer than Net 90 (capped)', () => {
    const u120 = termsUtility(cfg, 'Net 120');
    expect(u120).toBeLessThanOrEqual(1.0);
    expect(u120).toBeGreaterThanOrEqual(0.9);
  });

  it('accepts numeric days directly', () => {
    expect(termsUtility(cfg, 60)).toBeCloseTo(0.6, 1);
    expect(termsUtility(cfg, 90)).toBeCloseTo(1.0, 1);
  });

  it('is monotonically non-decreasing as days increase (longer = better)', () => {
    const dayValues = [15, 30, 45, 60, 75, 90, 100];
    for (let i = 1; i < dayValues.length; i++) {
      const prev = termsUtility(cfg, dayValues[i - 1]);
      const curr = termsUtility(cfg, dayValues[i]);
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });
});

// ─────────────────────────────────────────────
// totalUtility
// ─────────────────────────────────────────────

describe('totalUtility', () => {
  const cfg = makeConfig();

  it('returns 0 when both price and terms are null', () => {
    const offer = { total_price: null, payment_terms: null };
    expect(totalUtility(cfg, offer)).toBe(0);
  });

  it('returns correct weighted sum for known inputs', () => {
    const offer = { total_price: 90000, payment_terms: 'Net 90' };
    // priceUtility(90000) = 1.0 (at target)
    // termsUtility('Net 90') = 1.0
    // totalUtility = 1.0 * 0.6 + 1.0 * 0.4 = 1.0
    expect(totalUtility(cfg, offer)).toBeCloseTo(1.0, 5);
  });

  it('returns < accept threshold for worst offer', () => {
    const offer = { total_price: 120000, payment_terms: 'Net 30' };
    expect(totalUtility(cfg, offer)).toBeLessThan(cfg.accept_threshold);
  });

  it('returns clamped value in [0, 1]', () => {
    const offer = { total_price: 50000, payment_terms: 'Net 90' };
    const u = totalUtility(cfg, offer);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThanOrEqual(1);
  });
});
