/**
 * Tests for buildNegotiationIntent.ts
 *
 * Covers every persona from tech-novice vendor to power-user procurement manager.
 * All tests are pure unit tests — no DB, no network, no LLM.
 */

import { describe, it, expect } from 'vitest';
import {
  buildNegotiationIntent,
  mapUtilityToFirmness,
  type BuildIntentInput,
  type NegotiationAction,
  type VendorTone,
} from '../../../src/negotiation/intent/buildNegotiationIntent.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeInput(overrides: Partial<BuildIntentInput> = {}): BuildIntentInput {
  return {
    action: 'COUNTER',
    utilityScore: 0.55,
    counterPrice: 90000,
    counterPaymentTerms: 'Net 30',
    counterDelivery: '30 days',
    concerns: [],
    tone: 'formal',
    targetPrice: 80000,
    maxAcceptablePrice: 100000,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// mapUtilityToFirmness
// ─────────────────────────────────────────────

describe('mapUtilityToFirmness', () => {
  it('returns 0.25 when utility is exactly 0.70 (acceptance zone boundary)', () => {
    expect(mapUtilityToFirmness(0.70)).toBe(0.25);
  });

  it('returns 0.25 when utility is above 0.70 (very favourable offer)', () => {
    expect(mapUtilityToFirmness(0.85)).toBe(0.25);
    expect(mapUtilityToFirmness(1.0)).toBe(0.25);
  });

  it('returns 0.55 in the negotiation zone (50–69%)', () => {
    expect(mapUtilityToFirmness(0.50)).toBe(0.55);
    expect(mapUtilityToFirmness(0.60)).toBe(0.55);
    expect(mapUtilityToFirmness(0.69)).toBe(0.55);
  });

  it('returns 0.75 in the escalation zone (30–49%)', () => {
    expect(mapUtilityToFirmness(0.30)).toBe(0.75);
    expect(mapUtilityToFirmness(0.45)).toBe(0.75);
    expect(mapUtilityToFirmness(0.49)).toBe(0.75);
  });

  it('returns 0.90 when utility is below 0.30 (walk-away zone)', () => {
    expect(mapUtilityToFirmness(0.29)).toBe(0.90);
    expect(mapUtilityToFirmness(0.10)).toBe(0.90);
    expect(mapUtilityToFirmness(0.0)).toBe(0.90);
  });

  it('handles boundary: 0.50 is negotiation zone (not escalation)', () => {
    expect(mapUtilityToFirmness(0.50)).toBe(0.55);
  });

  it('handles boundary: 0.30 is escalation zone (not walk-away)', () => {
    expect(mapUtilityToFirmness(0.30)).toBe(0.75);
  });

  // Edge: out-of-range utility (defensive)
  it('handles utility > 1 gracefully (clamped to accept zone)', () => {
    expect(mapUtilityToFirmness(1.5)).toBe(0.25);
  });

  it('handles negative utility (clamped to walk-away zone)', () => {
    expect(mapUtilityToFirmness(-0.1)).toBe(0.90);
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — action routing
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – action routing', () => {
  it('returns ACCEPT action when engine says ACCEPT', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'ACCEPT' }));
    expect(intent.action).toBe('ACCEPT');
  });

  it('returns WALK_AWAY action when engine says WALK_AWAY', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'WALK_AWAY' }));
    expect(intent.action).toBe('WALK_AWAY');
  });

  it('returns ESCALATE action when engine says ESCALATE', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'ESCALATE' }));
    expect(intent.action).toBe('ESCALATE');
  });

  it('returns COUNTER action when engine says COUNTER', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'COUNTER' }));
    expect(intent.action).toBe('COUNTER');
  });

  it('overrides action to MESO when mesoOffers are provided', () => {
    const intent = buildNegotiationIntent(makeInput({
      action: 'COUNTER',
      mesoOffers: [
        { label: 'Option A', price: 88000, paymentTerms: 'Net 30', description: 'Fastest delivery' },
        { label: 'Option B', price: 90000, paymentTerms: 'Net 60', description: 'Better terms' },
      ],
    }));
    expect(intent.action).toBe('MESO');
  });

  it('does NOT override action to MESO when mesoOffers is empty array', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'COUNTER', mesoOffers: [] }));
    expect(intent.action).toBe('COUNTER');
  });

  it('does NOT override action to MESO when mesoOffers is undefined', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'COUNTER', mesoOffers: undefined }));
    expect(intent.action).toBe('COUNTER');
  });

  it('returns ASK_CLARIFY when engine says ASK_CLARIFY', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'ASK_CLARIFY', counterPrice: null }));
    expect(intent.action).toBe('ASK_CLARIFY');
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — firmness calculation
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – firmness', () => {
  it('firmness is 0.25 for high-utility (near acceptance)', () => {
    const intent = buildNegotiationIntent(makeInput({ utilityScore: 0.75 }));
    expect(intent.firmness).toBe(0.25);
  });

  it('firmness is 0.55 for mid-range utility', () => {
    const intent = buildNegotiationIntent(makeInput({ utilityScore: 0.60 }));
    expect(intent.firmness).toBe(0.55);
  });

  it('firmness is 0.75 for low utility (escalation zone)', () => {
    const intent = buildNegotiationIntent(makeInput({ utilityScore: 0.40 }));
    expect(intent.firmness).toBe(0.75);
  });

  it('firmness is 0.90 for very low utility (walk-away zone)', () => {
    const intent = buildNegotiationIntent(makeInput({ utilityScore: 0.15 }));
    expect(intent.firmness).toBe(0.90);
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — price boundaries (COUNTER)
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – price boundary guard (COUNTER)', () => {
  it('passes through counterPrice when within [targetPrice, maxAcceptablePrice]', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPrice: 90000, targetPrice: 80000, maxAcceptablePrice: 100000 }));
    expect(intent.allowedPrice).toBe(90000);
  });

  it('clamps counterPrice to max when above maxAcceptablePrice', () => {
    // Engine somehow computed 110000 — must be clamped to 100000
    const intent = buildNegotiationIntent(makeInput({ counterPrice: 110000, targetPrice: 80000, maxAcceptablePrice: 100000 }));
    expect(intent.allowedPrice).toBe(100000);
  });

  it('clamps counterPrice to min when below targetPrice', () => {
    // Engine somehow computed 70000 — must be clamped to 80000
    const intent = buildNegotiationIntent(makeInput({ counterPrice: 70000, targetPrice: 80000, maxAcceptablePrice: 100000 }));
    expect(intent.allowedPrice).toBe(80000);
  });

  it('passes through counterPrice when bounds are undefined (no config)', () => {
    const intent = buildNegotiationIntent(makeInput({
      counterPrice: 50000,
      targetPrice: undefined,
      maxAcceptablePrice: undefined,
    }));
    expect(intent.allowedPrice).toBe(50000);
  });

  it('returns undefined allowedPrice when counterPrice is null', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPrice: null }));
    expect(intent.allowedPrice).toBeUndefined();
  });

  it('returns undefined allowedPrice when counterPrice is undefined', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPrice: undefined }));
    expect(intent.allowedPrice).toBeUndefined();
  });

  it('handles reversed bounds (maxAcceptablePrice < targetPrice) without crashing', () => {
    // Misconfigured: target=100000, max=80000
    const intent = buildNegotiationIntent(makeInput({
      counterPrice: 90000,
      targetPrice: 100000,
      maxAcceptablePrice: 80000,
    }));
    // Should still clamp within [80000, 100000]
    expect(intent.allowedPrice).toBeGreaterThanOrEqual(80000);
    expect(intent.allowedPrice).toBeLessThanOrEqual(100000);
  });

  it('handles counterPrice exactly at targetPrice boundary', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPrice: 80000, targetPrice: 80000, maxAcceptablePrice: 100000 }));
    expect(intent.allowedPrice).toBe(80000);
  });

  it('handles counterPrice exactly at maxAcceptablePrice boundary', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPrice: 100000, targetPrice: 80000, maxAcceptablePrice: 100000 }));
    expect(intent.allowedPrice).toBe(100000);
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — non-COUNTER actions have no pricing
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – ACCEPT/WALK_AWAY/ESCALATE have no pricing fields', () => {
  const noPrice: Array<BuildIntentInput['action']> = ['ACCEPT', 'WALK_AWAY', 'ESCALATE'];

  for (const action of noPrice) {
    it(`${action} intent has no allowedPrice`, () => {
      const intent = buildNegotiationIntent(makeInput({ action }));
      expect(intent.allowedPrice).toBeUndefined();
    });

    it(`${action} intent has no allowedPaymentTerms`, () => {
      const intent = buildNegotiationIntent(makeInput({ action }));
      expect(intent.allowedPaymentTerms).toBeUndefined();
    });

    it(`${action} intent has no allowedDelivery`, () => {
      const intent = buildNegotiationIntent(makeInput({ action }));
      expect(intent.allowedDelivery).toBeUndefined();
    });

    it(`${action} intent has no offerVariants`, () => {
      const intent = buildNegotiationIntent(makeInput({ action }));
      expect(intent.offerVariants).toBeUndefined();
    });
  }
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — COUNTER optional fields
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – COUNTER optional fields', () => {
  it('includes allowedPaymentTerms when provided', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPaymentTerms: 'Net 60' }));
    expect(intent.allowedPaymentTerms).toBe('Net 60');
  });

  it('omits allowedPaymentTerms when not provided', () => {
    const intent = buildNegotiationIntent(makeInput({ counterPaymentTerms: null }));
    expect(intent.allowedPaymentTerms).toBeUndefined();
  });

  it('includes allowedDelivery when provided', () => {
    const intent = buildNegotiationIntent(makeInput({ counterDelivery: '45 days' }));
    expect(intent.allowedDelivery).toBe('45 days');
  });

  it('omits allowedDelivery when not provided', () => {
    const intent = buildNegotiationIntent(makeInput({ counterDelivery: null }));
    expect(intent.allowedDelivery).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — MESO pass-through
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – MESO', () => {
  const mesoOffers = [
    { label: 'Option A', price: 88000, paymentTerms: 'Net 30', description: 'Fastest delivery' },
    { label: 'Option B', price: 90000, paymentTerms: 'Net 60', description: 'Better terms' },
    { label: 'Option C', price: 92000, paymentTerms: 'Net 90', description: 'Extended warranty' },
  ];

  it('passes MESO offers through unchanged', () => {
    const intent = buildNegotiationIntent(makeInput({ mesoOffers }));
    expect(intent.offerVariants).toEqual(mesoOffers);
  });

  it('MESO intent has no allowedPrice', () => {
    const intent = buildNegotiationIntent(makeInput({ mesoOffers }));
    expect(intent.allowedPrice).toBeUndefined();
  });

  it('MESO preserves all variant labels', () => {
    const intent = buildNegotiationIntent(makeInput({ mesoOffers }));
    const labels = intent.offerVariants?.map(v => v.label);
    expect(labels).toEqual(['Option A', 'Option B', 'Option C']);
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — vendor tone & concerns
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – tone & concerns', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`preserves vendor tone: ${tone}`, () => {
      const intent = buildNegotiationIntent(makeInput({ tone }));
      expect(intent.vendorTone).toBe(tone);
    });
  }

  it('passes acknowledgeConcerns through', () => {
    const concerns = ['supply chain delay', 'currency risk'];
    const intent = buildNegotiationIntent(makeInput({ concerns }));
    expect(intent.acknowledgeConcerns).toEqual(concerns);
  });

  it('handles empty concerns array', () => {
    const intent = buildNegotiationIntent(makeInput({ concerns: [] }));
    expect(intent.acknowledgeConcerns).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// buildNegotiationIntent — commercialPosition is always a non-empty string
// ─────────────────────────────────────────────

describe('buildNegotiationIntent – commercialPosition', () => {
  const actions: BuildIntentInput['action'][] = ['ACCEPT', 'COUNTER', 'WALK_AWAY', 'ESCALATE', 'ASK_CLARIFY'];

  for (const action of actions) {
    it(`returns non-empty commercialPosition for action=${action}`, () => {
      const intent = buildNegotiationIntent(makeInput({ action }));
      expect(typeof intent.commercialPosition).toBe('string');
      expect(intent.commercialPosition.length).toBeGreaterThan(0);
    });
  }

  it('selects high_firmness position when firmness ≥ 0.75 (COUNTER)', () => {
    const intent = buildNegotiationIntent(makeInput({ utilityScore: 0.35, tone: 'formal' }));
    expect(intent.commercialPosition).toContain('budget constraints');
  });

  it('selects friendly ACCEPT position when tone is friendly', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'ACCEPT', tone: 'friendly' }));
    expect(intent.commercialPosition).toContain('happy');
  });

  it('selects formal ACCEPT position when tone is formal', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'ACCEPT', tone: 'formal' }));
    expect(intent.commercialPosition).toContain('formal');
  });

  it('selects firm WALK_AWAY position when tone is firm', () => {
    const intent = buildNegotiationIntent(makeInput({ action: 'WALK_AWAY', tone: 'firm' }));
    expect(intent.commercialPosition).toContain('limit');
  });
});

// ─────────────────────────────────────────────
// Persona: Tech-novice vendor
// Scenario: Vendor just types "hello" — no offer, no structure
// Engine decides ASK_CLARIFY
// ─────────────────────────────────────────────

describe('Persona: tech-novice vendor — incomplete/missing offer', () => {
  it('ASK_CLARIFY intent has correct structure for a first-time vendor', () => {
    const intent = buildNegotiationIntent({
      action: 'ASK_CLARIFY',
      utilityScore: 0,
      counterPrice: null,
      concerns: [],
      tone: 'casual',
    });
    expect(intent.action).toBe('ASK_CLARIFY');
    expect(intent.firmness).toBe(0.90); // utility=0 → walk-away zone firmness
    expect(intent.allowedPrice).toBeUndefined();
    expect(intent.commercialPosition).toBeTruthy();
  });

  it('handles repeated ASK_CLARIFY with no change in intent structure', () => {
    for (let i = 0; i < 5; i++) {
      const intent = buildNegotiationIntent({
        action: 'ASK_CLARIFY',
        utilityScore: 0,
        counterPrice: null,
        concerns: [],
        tone: 'confused' as any, // unknown tone — shouldn't crash
      });
      expect(intent.action).toBe('ASK_CLARIFY');
    }
  });
});

// ─────────────────────────────────────────────
// Persona: Power user / experienced vendor
// Scenario: Very tight counter-offer, knows exactly what they want
// ─────────────────────────────────────────────

describe('Persona: experienced vendor — precision counter-offer', () => {
  it('handles very precise counter prices (decimals)', () => {
    const intent = buildNegotiationIntent(makeInput({
      counterPrice: 98750.50,
      targetPrice: 95000,
      maxAcceptablePrice: 100000,
    }));
    expect(intent.allowedPrice).toBe(98750.50);
  });

  it('handles very large deal values (enterprise scale)', () => {
    const intent = buildNegotiationIntent(makeInput({
      counterPrice: 4_500_000,
      targetPrice: 4_000_000,
      maxAcceptablePrice: 5_000_000,
    }));
    expect(intent.allowedPrice).toBe(4_500_000);
  });

  it('clamps enterprise-scale price that exceeds max', () => {
    const intent = buildNegotiationIntent(makeInput({
      counterPrice: 6_000_000,
      targetPrice: 4_000_000,
      maxAcceptablePrice: 5_000_000,
    }));
    expect(intent.allowedPrice).toBe(5_000_000);
  });
});

// ─────────────────────────────────────────────
// Persona: Firm/impatient vendor — final offer declared
// ─────────────────────────────────────────────

describe('Persona: firm vendor — take it or leave it', () => {
  it('WALK_AWAY intent has correct structure when utility is below threshold', () => {
    const intent = buildNegotiationIntent({
      action: 'WALK_AWAY',
      utilityScore: 0.20,
      concerns: ['this is our final offer'],
      tone: 'firm',
    });
    expect(intent.action).toBe('WALK_AWAY');
    expect(intent.firmness).toBe(0.90);
    expect(intent.vendorTone).toBe('firm');
    expect(intent.allowedPrice).toBeUndefined();
    expect(intent.commercialPosition).toContain('limit');
  });
});

// ─────────────────────────────────────────────
// Persona: Escalation scenario
// ─────────────────────────────────────────────

describe('Persona: complex deal — escalation path', () => {
  it('ESCALATE intent does not leak any pricing data', () => {
    const intent = buildNegotiationIntent({
      action: 'ESCALATE',
      utilityScore: 0.38,
      counterPrice: 95000,        // should be ignored
      counterPaymentTerms: 'Net 45', // should be ignored
      concerns: ['legal review required'],
      tone: 'formal',
      targetPrice: 80000,
      maxAcceptablePrice: 100000,
    });
    expect(intent.action).toBe('ESCALATE');
    expect(intent.allowedPrice).toBeUndefined();
    expect(intent.allowedPaymentTerms).toBeUndefined();
    expect(intent.allowedDelivery).toBeUndefined();
  });
});

// ─────────────────────────────────────────────
// LLM boundary: NegotiationIntent must never contain internal fields
// ─────────────────────────────────────────────

describe('LLM boundary: no internal fields leak', () => {
  it('returned intent object does not have utilityScore', () => {
    const intent = buildNegotiationIntent(makeInput()) as any;
    expect(intent.utilityScore).toBeUndefined();
  });

  it('returned intent object does not have targetPrice', () => {
    const intent = buildNegotiationIntent(makeInput()) as any;
    expect(intent.targetPrice).toBeUndefined();
  });

  it('returned intent object does not have maxAcceptablePrice', () => {
    const intent = buildNegotiationIntent(makeInput()) as any;
    expect(intent.maxAcceptablePrice).toBeUndefined();
  });

  it('returned intent object does not have action weights or thresholds', () => {
    const intent = buildNegotiationIntent(makeInput()) as any;
    expect(intent.weights).toBeUndefined();
    expect(intent.thresholds).toBeUndefined();
  });
});
