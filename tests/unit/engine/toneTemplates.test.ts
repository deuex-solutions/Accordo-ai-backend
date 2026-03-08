/**
 * Tests for toneTemplates.ts (Feature #9: Tone-Aware Templates)
 *
 * Validates that every action × tone combination produces
 * valid, non-empty, tone-appropriate responses.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  getToneAcceptTemplate,
  getToneCounterTemplate,
  getToneWalkAwayTemplate,
  getToneEscalateTemplate,
  getToneAskClarifyTemplate,
  getToneAwareTemplate,
  type TemplateContext,
} from '../../../src/modules/chatbot/engine/toneTemplates.js';
import type { VendorTone } from '../../../src/modules/chatbot/engine/toneDetector.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

const allTones: VendorTone[] = ['formal', 'casual', 'firm', 'urgent', 'friendly'];

function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
  return {
    vendorPrice: '$95,000.00',
    vendorTerms: 'Net 30',
    vendorDelivery: 'within 14 days',
    counterPrice: '$88,000.00',
    counterTerms: 'Net 60',
    counterDelivery: 'by March 15',
    concernAck: '',
    round: 3,
    maxRounds: 10,
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// ACCEPT templates
// ─────────────────────────────────────────────

describe('getToneAcceptTemplate', () => {
  for (const tone of allTones) {
    it(`returns non-empty string for tone=${tone}`, () => {
      const result = getToneAcceptTemplate(makeCtx(), tone);
      expect(result.length).toBeGreaterThan(0);
    });

    it(`includes vendor price for tone=${tone}`, () => {
      const result = getToneAcceptTemplate(makeCtx(), tone);
      expect(result).toContain('$95,000.00');
    });

    it(`includes vendor terms for tone=${tone}`, () => {
      const result = getToneAcceptTemplate(makeCtx(), tone);
      expect(result).toContain('Net 30');
    });
  }

  it('formal tone uses professional language', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneAcceptTemplate(makeCtx(), 'formal'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/pleased|pleasure|appreciate|value/);
  });

  it('casual tone uses informal language', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneAcceptTemplate(makeCtx(), 'casual'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/deal|sounds|rolling|we're in/);
  });

  it('firm tone is direct', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneAcceptTemplate(makeCtx(), 'firm'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/accepted|accept|meets/);
  });

  it('urgent tone is concise', () => {
    const result = getToneAcceptTemplate(makeCtx(), 'urgent');
    expect(result.length).toBeLessThan(200);
  });

  it('includes concern acknowledgment when provided', () => {
    const ctx = makeCtx({ concernAck: 'We understand the supply chain challenges. ' });
    const result = getToneAcceptTemplate(ctx, 'friendly');
    expect(result).toContain('supply chain challenges');
  });
});

// ─────────────────────────────────────────────
// COUNTER templates
// ─────────────────────────────────────────────

describe('getToneCounterTemplate', () => {
  for (const tone of allTones) {
    it(`returns non-empty string for tone=${tone}`, () => {
      const result = getToneCounterTemplate(makeCtx(), tone);
      expect(result.length).toBeGreaterThan(0);
    });

    it(`includes counter price for tone=${tone}`, () => {
      const result = getToneCounterTemplate(makeCtx(), tone);
      expect(result).toContain('$88,000.00');
    });

    it(`includes counter terms for tone=${tone}`, () => {
      const result = getToneCounterTemplate(makeCtx(), tone);
      expect(result).toContain('Net 60');
    });
  }

  it('formal tone uses professional language', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneCounterTemplate(makeCtx(), 'formal'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/respectfully|appreciate|trust|engagement/);
  });

  it('urgent tone mentions speed', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneCounterTemplate(makeCtx(), 'urgent'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/finalize|today|quickly/);
  });

  it('friendly tone is warm', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneCounterTemplate(makeCtx(), 'friendly'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/love|hope|thanks|appreciate/);
  });
});

// ─────────────────────────────────────────────
// WALK_AWAY templates
// ─────────────────────────────────────────────

describe('getToneWalkAwayTemplate', () => {
  for (const tone of allTones) {
    it(`returns non-empty string for tone=${tone}`, () => {
      const result = getToneWalkAwayTemplate(makeCtx(), tone);
      expect(result.length).toBeGreaterThan(0);
    });

    it(`does not contain technical jargon for tone=${tone}`, () => {
      const result = getToneWalkAwayTemplate(makeCtx(), tone);
      const banned = ['utility', 'algorithm', 'threshold', 'score'];
      for (const term of banned) {
        expect(result.toLowerCase()).not.toContain(term);
      }
    });
  }

  it('formal tone mentions future collaboration', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneWalkAwayTemplate(makeCtx(), 'formal'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/future|collaboration|opportunities/);
  });

  it('casual tone is empathetic', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneWalkAwayTemplate(makeCtx(), 'casual'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/thanks|appreciate|touch/);
  });

  it('friendly tone expresses hope', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneWalkAwayTemplate(makeCtx(), 'friendly'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/hope|great|touch/);
  });
});

// ─────────────────────────────────────────────
// ESCALATE templates
// ─────────────────────────────────────────────

describe('getToneEscalateTemplate', () => {
  for (const tone of allTones) {
    it(`returns non-empty string for tone=${tone}`, () => {
      const result = getToneEscalateTemplate(makeCtx(), tone);
      expect(result.length).toBeGreaterThan(0);
    });

    it(`mentions follow-up for tone=${tone}`, () => {
      const results = new Set<string>();
      for (let i = 0; i < 20; i++) {
        results.add(getToneEscalateTemplate(makeCtx(), tone));
      }
      const all = [...results].join(' ').toLowerCase();
      expect(all).toMatch(/shortly|soon|touch|reach/);
    });
  }

  it('urgent tone conveys speed', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneEscalateTemplate(makeCtx(), 'urgent'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/right away|expedite|now/);
  });
});

// ─────────────────────────────────────────────
// ASK_CLARIFY templates
// ─────────────────────────────────────────────

describe('getToneAskClarifyTemplate', () => {
  for (const tone of allTones) {
    it(`returns non-empty string for tone=${tone}`, () => {
      const result = getToneAskClarifyTemplate(tone, [], ['price']);
      expect(result.length).toBeGreaterThan(0);
    });

    it(`requests missing price for tone=${tone}`, () => {
      const result = getToneAskClarifyTemplate(tone, [], ['price']);
      expect(result.toLowerCase()).toMatch(/price|pricing/);
    });

    it(`requests missing terms for tone=${tone}`, () => {
      const result = getToneAskClarifyTemplate(tone, [], ['payment terms']);
      expect(result.toLowerCase()).toMatch(/term|payment/);
    });
  }

  it('includes acknowledgment when items are provided', () => {
    const result = getToneAskClarifyTemplate('friendly', ['$45,000 total price'], ['payment terms']);
    expect(result).toContain('$45,000 total price');
  });

  it('formal tone uses polite language', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneAskClarifyTemplate('formal', [], ['price']));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/kindly|appreciate|would/);
  });

  it('firm tone is direct', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneAskClarifyTemplate('firm', [], ['price']));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).toMatch(/need|require|provide/);
  });
});

// ─────────────────────────────────────────────
// getToneAwareTemplate dispatcher
// ─────────────────────────────────────────────

describe('getToneAwareTemplate', () => {
  const actions = ['ACCEPT', 'COUNTER', 'WALK_AWAY', 'ESCALATE', 'ASK_CLARIFY'];

  for (const action of actions) {
    for (const tone of allTones) {
      it(`${action} × ${tone} returns non-empty string`, () => {
        const result = getToneAwareTemplate(
          action,
          makeCtx(),
          tone,
          { provided: [], missing: ['price'] }
        );
        expect(result.length).toBeGreaterThan(0);
      });
    }
  }

  it('defaults to COUNTER for unknown action', () => {
    const result = getToneAwareTemplate('UNKNOWN_ACTION', makeCtx(), 'friendly');
    // Should return a counter template (contains counter price)
    expect(result).toContain('$88,000.00');
  });

  it('never exposes utility or algorithm language', () => {
    for (const action of actions) {
      for (const tone of allTones) {
        for (let i = 0; i < 5; i++) {
          const result = getToneAwareTemplate(
            action,
            makeCtx(),
            tone,
            { provided: [], missing: ['price'] }
          );
          const banned = ['utility', 'algorithm', 'threshold', 'score', 'calculation'];
          for (const term of banned) {
            expect(result.toLowerCase()).not.toContain(term);
          }
        }
      }
    }
  });
});

// ─────────────────────────────────────────────
// Tone differentiation — each tone produces different text
// ─────────────────────────────────────────────

describe('Tone differentiation', () => {
  it('formal and casual ACCEPT templates are different', () => {
    // Collect unique templates per tone
    const formalSet = new Set<string>();
    const casualSet = new Set<string>();
    for (let i = 0; i < 30; i++) {
      formalSet.add(getToneAcceptTemplate(makeCtx(), 'formal'));
      casualSet.add(getToneAcceptTemplate(makeCtx(), 'casual'));
    }
    // At least one template from each set should not appear in the other
    const formalAll = [...formalSet].join('|||');
    const casualAll = [...casualSet].join('|||');
    // They should be different strings
    expect(formalAll).not.toBe(casualAll);
  });

  it('formal COUNTER does not use casual words', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneCounterTemplate(makeCtx(), 'formal'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).not.toMatch(/\bcool\b|\bawesome\b|\bhey\b/);
  });

  it('casual COUNTER does not use overly formal words', () => {
    const results = new Set<string>();
    for (let i = 0; i < 20; i++) {
      results.add(getToneCounterTemplate(makeCtx(), 'casual'));
    }
    const all = [...results].join(' ').toLowerCase();
    expect(all).not.toMatch(/\bhereby\b|\bpursuant\b|\bsincere\b/);
  });
});
