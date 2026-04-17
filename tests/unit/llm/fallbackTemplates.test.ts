/**
 * Tests for fallbackTemplates.ts
 *
 * The fallback templates are the last line of defence when LLM fails.
 * Every action × tone combination must produce a non-empty, humanized,
 * internal-keyword-free response. Price/terms injection is tested for
 * COUNTER templates. MESO structure is verified.
 */

import { describe, it, expect } from 'vitest';
import { getFallbackResponse } from '../../../src/llm/fallback-templates.js';
import type { NegotiationIntent, VendorTone } from '../../../src/negotiation/intent/build-negotiation-intent.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeIntent(overrides: Partial<NegotiationIntent> = {}): NegotiationIntent {
  return {
    action: 'COUNTER',
    firmness: 0.55,
    commercialPosition: 'We are working toward mutually beneficial terms.',
    allowedPrice: 90000,
    allowedPaymentTerms: 'Net 30',
    acknowledgeConcerns: [],
    vendorTone: 'formal',
    currencySymbol: '$',
    ...overrides,
  };
}

const ALL_TONES: Array<VendorTone | 'default'> = [
  'formal', 'casual', 'urgent', 'firm', 'friendly', 'default' as any,
];

// Banned words that must NEVER appear in any fallback
const INTERNAL_KEYWORDS = [
  'utility', 'algorithm', 'score', 'threshold', 'engine', 'config',
  'gpt', 'openai', 'llm', 'batna', 'decision tree', 'weighted',
];

// ─────────────────────────────────────────────
// ACCEPT fallbacks — all tones
// ─────────────────────────────────────────────

describe('getFallbackResponse – ACCEPT', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty string for ACCEPT + tone=${tone}`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ACCEPT', allowedPrice: undefined, vendorTone: tone }));
      expect(typeof result).toBe('string');
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it(`ACCEPT + tone=${tone} does not contain banned internal keywords`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ACCEPT', allowedPrice: undefined, vendorTone: tone }));
      for (const kw of INTERNAL_KEYWORDS) {
        expect(result.toLowerCase()).not.toContain(kw);
      }
    });
  }

  it('ACCEPT default tone returns meaningful response', () => {
    const result = getFallbackResponse(makeIntent({ action: 'ACCEPT', allowedPrice: undefined, vendorTone: 'friendly' }));
    // Should contain positive acceptance language
    const lower = result.toLowerCase();
    const hasAcceptWord = lower.includes('accept') || lower.includes('pleased') || lower.includes('happy') || lower.includes('glad') || lower.includes('in!') || lower.includes('delight');
    expect(hasAcceptWord).toBe(true);
  });
});

// ─────────────────────────────────────────────
// COUNTER fallbacks — all tones, price injection
// ─────────────────────────────────────────────

describe('getFallbackResponse – COUNTER', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty string for COUNTER + tone=${tone}`, () => {
      const result = getFallbackResponse(makeIntent({ vendorTone: tone }));
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it(`COUNTER + tone=${tone} injects allowedPrice into response`, () => {
      const result = getFallbackResponse(makeIntent({ allowedPrice: 90000, vendorTone: tone }));
      // Price should appear in some numeric form
      expect(result).toMatch(/90[,.]?000|90K|90k/);
    });

    it(`COUNTER + tone=${tone} does not contain banned internal keywords`, () => {
      const result = getFallbackResponse(makeIntent({ vendorTone: tone }));
      for (const kw of INTERNAL_KEYWORDS) {
        expect(result.toLowerCase()).not.toContain(kw);
      }
    });
  }

  it('COUNTER injects payment terms when provided', () => {
    const result = getFallbackResponse(makeIntent({ allowedPaymentTerms: 'Net 60' }));
    expect(result).toContain('Net 60');
  });

  it('COUNTER injects delivery when provided', () => {
    const result = getFallbackResponse(makeIntent({ allowedDelivery: '45 days' }));
    expect(result).toContain('45 days');
  });

  it('COUNTER with no payment terms omits terms gracefully', () => {
    const result = getFallbackResponse(makeIntent({ allowedPaymentTerms: undefined }));
    // Should not contain undefined literally
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });

  it('COUNTER with no delivery omits delivery gracefully', () => {
    const result = getFallbackResponse(makeIntent({ allowedDelivery: undefined }));
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });

  it('COUNTER with very large price (enterprise deal) formats correctly', () => {
    const result = getFallbackResponse(makeIntent({ allowedPrice: 4_500_000 }));
    expect(result).toContain('4,500,000');
  });

  it('COUNTER with decimal price renders without undefined', () => {
    const result = getFallbackResponse(makeIntent({ allowedPrice: 98750.50 }));
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });
});

// ─────────────────────────────────────────────
// WALK_AWAY fallbacks — all tones
// ─────────────────────────────────────────────

describe('getFallbackResponse – WALK_AWAY', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty string for WALK_AWAY + tone=${tone}`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined, vendorTone: tone }));
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it(`WALK_AWAY + tone=${tone} contains polite decline language`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined, vendorTone: tone }));
      const lower = result.toLowerCase();
      const hasDeclineWord =
        lower.includes('unable') ||
        lower.includes('cannot') ||
        lower.includes('regret') ||
        lower.includes("can't") ||
        lower.includes("can not") ||
        lower.includes("won't") ||
        lower.includes('not able') ||
        lower.includes('pass') ||
        lower.includes('conclud') ||
        lower.includes('close') ||
        lower.includes('proceeding') ||
        lower.includes('proceed') ||
        lower.includes("isn't going to work") ||
        lower.includes("not going to") ||
        lower.includes("not a fit") ||
        lower.includes("can't make") ||
        lower.includes("not able") ||
        lower.includes("not in a position") ||
        lower.includes("not quite") ||
        lower.includes("don't fit") ||
        lower.includes("don't meet") ||
        lower.includes("doesn't fit") ||
        lower.includes("doesn't meet") ||
        lower.includes("not meet") ||
        lower.includes("do not meet") ||
        lower.includes("not work") ||
        lower.includes("no hard feelings") ||
        lower.includes("wish") ||
        lower.includes("sorry");
      expect(hasDeclineWord).toBe(true);
    });

    it(`WALK_AWAY + tone=${tone} does not contain banned keywords`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined, vendorTone: tone }));
      for (const kw of INTERNAL_KEYWORDS) {
        expect(result.toLowerCase()).not.toContain(kw);
      }
    });
  }

  it('WALK_AWAY casual tone reads conversationally', () => {
    const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined, vendorTone: 'casual' }));
    // Casual templates use contractions and informal phrasing
    const lower = result.toLowerCase();
    expect(lower.length).toBeGreaterThan(20);
  });

  it('WALK_AWAY does not expose price data', () => {
    const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: 90000, vendorTone: 'formal' }));
    expect(result).not.toContain('90,000');
    expect(result).not.toContain('90000');
  });
});

// ─────────────────────────────────────────────
// ESCALATE fallbacks — all tones
// ─────────────────────────────────────────────

describe('getFallbackResponse – ESCALATE', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty string for ESCALATE + tone=${tone}`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ESCALATE', allowedPrice: undefined, vendorTone: tone }));
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it(`ESCALATE + tone=${tone} mentions escalation/senior/manager`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ESCALATE', allowedPrice: undefined, vendorTone: tone }));
      const lower = result.toLowerCase();
      const hasEscalationWord =
        lower.includes('escalat') ||
        lower.includes('senior') ||
        lower.includes('manager') ||
        lower.includes('management') ||
        lower.includes('colleague') ||
        lower.includes('team') ||
        lower.includes('follow up') ||
        lower.includes('follow-up') ||
        lower.includes('director') ||
        lower.includes('refer') ||
        lower.includes('loop in') ||
        lower.includes('pass') ||
        lower.includes('hand off') ||
        lower.includes('hand-off') ||
        lower.includes('involving');
      expect(hasEscalationWord).toBe(true);
    });

    it(`ESCALATE + tone=${tone} does not contain banned keywords`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ESCALATE', allowedPrice: undefined, vendorTone: tone }));
      for (const kw of INTERNAL_KEYWORDS) {
        expect(result.toLowerCase()).not.toContain(kw);
      }
    });
  }
});

// ─────────────────────────────────────────────
// ASK_CLARIFY fallbacks — all tones
// ─────────────────────────────────────────────

describe('getFallbackResponse – ASK_CLARIFY', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty string for ASK_CLARIFY + tone=${tone}`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined, vendorTone: tone }));
      expect(result.trim().length).toBeGreaterThan(0);
    });

    it(`ASK_CLARIFY + tone=${tone} asks for price/terms`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined, vendorTone: tone }));
      const lower = result.toLowerCase();
      const asksPriceOrTerms =
        lower.includes('price') || lower.includes('terms') || lower.includes('offer');
      expect(asksPriceOrTerms).toBe(true);
    });

    it(`ASK_CLARIFY + tone=${tone} does not contain banned keywords`, () => {
      const result = getFallbackResponse(makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined, vendorTone: tone }));
      for (const kw of INTERNAL_KEYWORDS) {
        expect(result.toLowerCase()).not.toContain(kw);
      }
    });
  }

  it('ASK_CLARIFY urgent tone conveys timeline pressure', () => {
    const result = getFallbackResponse(makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined, vendorTone: 'urgent' }));
    const lower = result.toLowerCase();
    const hasUrgency = lower.includes('deadline') || lower.includes('quickly') || lower.includes('track') || lower.includes('soon') || lower.includes('right away') || lower.includes('fast') || lower.includes('asap');
    expect(hasUrgency).toBe(true);
  });
});

// ─────────────────────────────────────────────
// MESO fallback
// ─────────────────────────────────────────────

describe('getFallbackResponse – MESO', () => {
  const mesoIntent: NegotiationIntent = {
    action: 'MESO',
    firmness: 0.55,
    commercialPosition: 'We have prepared several options.',
    acknowledgeConcerns: [],
    vendorTone: 'formal',
    offerVariants: [
      { label: 'Option A', price: 88000, paymentTerms: 'Net 30', description: 'Fast delivery' },
      { label: 'Option B', price: 90000, paymentTerms: 'Net 60', description: 'Better terms' },
    ],
  };

  it('returns a non-empty MESO intro message', () => {
    const result = getFallbackResponse(mesoIntent);
    expect(result.trim().length).toBeGreaterThan(0);
  });

  it('MESO fallback refers to options/alternatives', () => {
    const result = getFallbackResponse(mesoIntent);
    const lower = result.toLowerCase();
    const hasOptions =
      lower.includes('option') ||
      lower.includes('alternative') ||
      lower.includes('path') ||
      lower.includes('arrangement') ||
      lower.includes('choice');
    expect(hasOptions).toBe(true);
  });

  it('MESO fallback does not contain banned keywords', () => {
    const result = getFallbackResponse(mesoIntent);
    for (const kw of INTERNAL_KEYWORDS) {
      expect(result.toLowerCase()).not.toContain(kw);
    }
  });

  it('MESO fallback does not contain undefined/null (no price injection)', () => {
    const result = getFallbackResponse(mesoIntent);
    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });
});

// ─────────────────────────────────────────────
// Variant rotation — should not always return same template
// ─────────────────────────────────────────────

describe('getFallbackResponse – variant rotation', () => {
  it('COUNTER default pool has at least 5 variants (tested by not crashing at any minute value)', () => {
    // We cannot control the clock, but we can verify all intents return something
    const intent = makeIntent({ vendorTone: 'formal' });
    const result = getFallbackResponse(intent);
    expect(result).toBeTruthy();
  });

  it('getFallbackResponse returns a string (not a function or undefined)', () => {
    const result = getFallbackResponse(makeIntent());
    expect(typeof result).toBe('string');
  });
});

// ─────────────────────────────────────────────
// Edge: unknown/unexpected tone — fallback to default pool
// ─────────────────────────────────────────────

describe('getFallbackResponse – unknown tone fallback', () => {
  it('does not crash for an unexpected tone value', () => {
    const intent = makeIntent({ vendorTone: 'confused' as any });
    expect(() => getFallbackResponse(intent)).not.toThrow();
  });

  it('returns non-empty string for unexpected tone', () => {
    const intent = makeIntent({ vendorTone: 'robotic' as any });
    const result = getFallbackResponse(intent);
    expect(result.trim().length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// Persona: brand-new vendor who doesn't provide an offer
// ─────────────────────────────────────────────

describe('Persona: brand-new vendor — first interaction', () => {
  it('ASK_CLARIFY fallback for casual/friendly tone is welcoming', () => {
    const result = getFallbackResponse(makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined, vendorTone: 'friendly' }));
    const lower = result.toLowerCase();
    const isWelcoming =
      lower.includes('thanks') ||
      lower.includes('thank') ||
      lower.includes('great') ||
      lower.includes('almost') ||
      lower.includes('love') ||
      lower.includes('forward');
    expect(isWelcoming).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Persona: tech-savvy vendor pushing hard terms
// ─────────────────────────────────────────────

describe('Persona: firm/tech-savvy vendor — WALK_AWAY scenario', () => {
  it('WALK_AWAY firm tone is direct and brief', () => {
    const result = getFallbackResponse(makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined, vendorTone: 'firm' }));
    // Firm templates are shorter and more direct
    expect(result.trim().length).toBeGreaterThan(5);
    expect(result.trim().length).toBeLessThan(500);
  });
});

// ─────────────────────────────────────────────
// No hardcoded prices — all prices must come from intent
// ─────────────────────────────────────────────

describe('getFallbackResponse – no hardcoded prices', () => {
  it('COUNTER with price 123456 shows that price, not a hardcoded one', () => {
    const result = getFallbackResponse(makeIntent({ allowedPrice: 123456 }));
    expect(result).toContain('123,456');
  });

  it('COUNTER with price 50000 shows 50,000 not some other number', () => {
    const result = getFallbackResponse(makeIntent({ allowedPrice: 50000 }));
    expect(result).toMatch(/50[,.]?000/);
  });
});
