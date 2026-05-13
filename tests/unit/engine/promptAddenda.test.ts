/**
 * Tests for promptAddenda.ts (Feature #7: Dynamic Prompt Addenda)
 *
 * Validates that addenda are generated correctly based on
 * negotiation context: round, utility, tone, behavior, and action.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  generatePromptAddenda,
  type AddendaContext,
} from '../../../src/modules/chatbot/engine/prompt-addenda.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeCtx(overrides?: Partial<AddendaContext>): AddendaContext {
  return {
    round: 3,
    maxRounds: 10,
    utilityScore: 0.55,
    action: 'COUNTER',
    vendorTone: 'friendly',
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Result structure
// ─────────────────────────────────────────────

describe('generatePromptAddenda – result structure', () => {
  it('returns addenda array and promptSuffix', () => {
    const result = generatePromptAddenda(makeCtx());
    expect(result).toHaveProperty('addenda');
    expect(result).toHaveProperty('promptSuffix');
    expect(Array.isArray(result.addenda)).toBe(true);
    expect(typeof result.promptSuffix).toBe('string');
  });

  it('each addendum has id, label, and instruction', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1 }));
    for (const addendum of result.addenda) {
      expect(addendum).toHaveProperty('id');
      expect(addendum).toHaveProperty('label');
      expect(addendum).toHaveProperty('instruction');
      expect(addendum.id.length).toBeGreaterThan(0);
      expect(addendum.label.length).toBeGreaterThan(0);
      expect(addendum.instruction.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────
// Round-based addenda
// ─────────────────────────────────────────────

describe('generatePromptAddenda – round-based', () => {
  it('fires first_round on round 1', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('first_round');
  });

  it('does NOT fire first_round on round 2', () => {
    const result = generatePromptAddenda(makeCtx({ round: 2 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('first_round');
  });

  it('fires final_rounds near the end', () => {
    const result = generatePromptAddenda(makeCtx({ round: 9, maxRounds: 10 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('final_rounds');
  });

  it('fires last_round on the final round', () => {
    const result = generatePromptAddenda(makeCtx({ round: 10, maxRounds: 10 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('last_round');
  });

  it('does NOT fire final_rounds on round 1 even if maxRounds is 1', () => {
    // Round 1 with maxRounds=1 should NOT fire final_rounds (because round > 1 required)
    const result = generatePromptAddenda(makeCtx({ round: 1, maxRounds: 1 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('final_rounds');
  });

  it('fires both final_rounds and last_round on the last round', () => {
    const result = generatePromptAddenda(makeCtx({ round: 10, maxRounds: 10 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('final_rounds');
    expect(ids).toContain('last_round');
  });

  it('final_rounds instruction mentions the round numbers', () => {
    const result = generatePromptAddenda(makeCtx({ round: 9, maxRounds: 10 }));
    const finalRounds = result.addenda.find(a => a.id === 'final_rounds');
    expect(finalRounds?.instruction).toContain('9');
    expect(finalRounds?.instruction).toContain('10');
  });
});

// ─────────────────────────────────────────────
// Utility-based addenda
// ─────────────────────────────────────────────

describe('generatePromptAddenda – utility-based', () => {
  it('fires near_accept when utility is close to accept threshold', () => {
    // Default accept threshold = 0.75, so 90% of that = 0.675
    const result = generatePromptAddenda(makeCtx({ utilityScore: 0.70, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_accept');
  });

  it('does NOT fire near_accept when utility is low', () => {
    const result = generatePromptAddenda(makeCtx({ utilityScore: 0.40, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('near_accept');
  });

  it('does NOT fire near_accept on ACCEPT action (only COUNTER)', () => {
    const result = generatePromptAddenda(makeCtx({ utilityScore: 0.80, action: 'ACCEPT' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('near_accept');
  });

  it('fires near_walkaway when utility is close to walkaway threshold', () => {
    // Default walkaway threshold = 0.30, so 130% of that = 0.39
    const result = generatePromptAddenda(makeCtx({ utilityScore: 0.35, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_walkaway');
  });

  it('does NOT fire near_walkaway when utility is healthy', () => {
    const result = generatePromptAddenda(makeCtx({ utilityScore: 0.60, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('near_walkaway');
  });

  it('respects custom accept threshold', () => {
    // Accept threshold 0.90, 90% = 0.81 — score of 0.85 should fire
    const result = generatePromptAddenda(makeCtx({
      utilityScore: 0.85,
      action: 'COUNTER',
      acceptThreshold: 0.90,
    }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_accept');
  });

  it('respects custom walkaway threshold', () => {
    // Walkaway threshold 0.20, 130% = 0.26 — score of 0.22 should fire
    const result = generatePromptAddenda(makeCtx({
      utilityScore: 0.22,
      action: 'COUNTER',
      walkawayThreshold: 0.20,
    }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_walkaway');
  });
});

// ─────────────────────────────────────────────
// Tone-based addenda
// ─────────────────────────────────────────────

describe('generatePromptAddenda – tone-based', () => {
  it('fires firm_vendor when vendor tone is firm', () => {
    const result = generatePromptAddenda(makeCtx({ vendorTone: 'firm' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('firm_vendor');
  });

  it('fires urgent_vendor when vendor tone is urgent', () => {
    const result = generatePromptAddenda(makeCtx({ vendorTone: 'urgent' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('urgent_vendor');
  });

  it('does NOT fire tone addenda for friendly tone', () => {
    const result = generatePromptAddenda(makeCtx({ vendorTone: 'friendly' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('firm_vendor');
    expect(ids).not.toContain('urgent_vendor');
  });

  it('does NOT fire tone addenda for casual tone', () => {
    const result = generatePromptAddenda(makeCtx({ vendorTone: 'casual' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('firm_vendor');
    expect(ids).not.toContain('urgent_vendor');
  });

  it('does NOT fire tone addenda for formal tone', () => {
    const result = generatePromptAddenda(makeCtx({ vendorTone: 'formal' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('firm_vendor');
    expect(ids).not.toContain('urgent_vendor');
  });
});

// ─────────────────────────────────────────────
// Behavioral addenda
// ─────────────────────────────────────────────

describe('generatePromptAddenda – behavioral', () => {
  it('fires stall_detected when stall is true', () => {
    const result = generatePromptAddenda(makeCtx({ stallDetected: true }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('stall_detected');
  });

  it('does NOT fire stall_detected when not set', () => {
    const result = generatePromptAddenda(makeCtx());
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('stall_detected');
  });

  it('fires counter_fatigue on 3+ consecutive counters', () => {
    const result = generatePromptAddenda(makeCtx({ consecutiveCounters: 3 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('counter_fatigue');
  });

  it('fires counter_fatigue on 5 consecutive counters', () => {
    const result = generatePromptAddenda(makeCtx({ consecutiveCounters: 5 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('counter_fatigue');
  });

  it('does NOT fire counter_fatigue on 2 consecutive counters', () => {
    const result = generatePromptAddenda(makeCtx({ consecutiveCounters: 2 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('counter_fatigue');
  });

  it('counter_fatigue instruction mentions the count', () => {
    const result = generatePromptAddenda(makeCtx({ consecutiveCounters: 4 }));
    const fatigue = result.addenda.find(a => a.id === 'counter_fatigue');
    expect(fatigue?.instruction).toContain('4');
  });

  it('fires vendor_conceded when vendor made concession', () => {
    const result = generatePromptAddenda(makeCtx({ vendorConceded: true }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('vendor_conceded');
  });

  it('does NOT fire vendor_conceded when not set', () => {
    const result = generatePromptAddenda(makeCtx());
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('vendor_conceded');
  });
});

// ─────────────────────────────────────────────
// Action-specific addenda
// ─────────────────────────────────────────────

describe('generatePromptAddenda – action-specific', () => {
  it('fires acceptance_warmth on ACCEPT', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'ACCEPT' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('acceptance_warmth');
  });

  it('fires escalation_reassurance on ESCALATE', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'ESCALATE' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('escalation_reassurance');
  });

  it('fires walkaway_grace on WALK_AWAY', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'WALK_AWAY' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('walkaway_grace');
  });

  it('does NOT fire acceptance_warmth on COUNTER', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('acceptance_warmth');
  });

  it('does NOT fire walkaway_grace on ACCEPT', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'ACCEPT' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).not.toContain('walkaway_grace');
  });
});

// ─────────────────────────────────────────────
// Composability — multiple addenda fire together
// ─────────────────────────────────────────────

describe('generatePromptAddenda – composability', () => {
  it('can fire multiple addenda at once', () => {
    const result = generatePromptAddenda(makeCtx({
      round: 10,
      maxRounds: 10,
      action: 'COUNTER',
      vendorTone: 'firm',
      stallDetected: true,
      utilityScore: 0.35,
    }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('final_rounds');
    expect(ids).toContain('last_round');
    expect(ids).toContain('near_walkaway');
    expect(ids).toContain('firm_vendor');
    expect(ids).toContain('stall_detected');
    expect(result.addenda.length).toBeGreaterThanOrEqual(5);
  });

  it('first round + vendor conceded + friendly', () => {
    const result = generatePromptAddenda(makeCtx({
      round: 1,
      vendorConceded: true,
    }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('first_round');
    expect(ids).toContain('vendor_conceded');
  });
});

// ─────────────────────────────────────────────
// Prompt suffix formatting
// ─────────────────────────────────────────────

describe('generatePromptAddenda – promptSuffix', () => {
  it('returns empty string when no addenda fire', () => {
    // Mid-round, neutral utility, friendly tone, COUNTER, no behavioral signals
    const result = generatePromptAddenda(makeCtx({
      round: 3,
      maxRounds: 10,
      utilityScore: 0.55,
      action: 'COUNTER',
      vendorTone: 'friendly',
    }));
    expect(result.promptSuffix).toBe('');
  });

  it('starts with ADDITIONAL CONTEXT header when addenda exist', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1 }));
    expect(result.promptSuffix).toContain('ADDITIONAL CONTEXT:');
  });

  it('each addendum instruction appears in the suffix', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1 }));
    for (const addendum of result.addenda) {
      expect(result.promptSuffix).toContain(addendum.instruction);
    }
  });

  it('uses dash-prefixed list format', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1, stallDetected: true }));
    const lines = result.promptSuffix.split('\n').filter(l => l.trim().startsWith('-'));
    expect(lines.length).toBe(result.addenda.length);
  });
});

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('generatePromptAddenda – edge cases', () => {
  it('handles round 0 gracefully', () => {
    const result = generatePromptAddenda(makeCtx({ round: 0 }));
    expect(Array.isArray(result.addenda)).toBe(true);
  });

  it('handles negative utility gracefully', () => {
    const result = generatePromptAddenda(makeCtx({ utilityScore: -0.1, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_walkaway');
  });

  it('handles utility above 1 gracefully', () => {
    const result = generatePromptAddenda(makeCtx({ utilityScore: 1.5, action: 'COUNTER' }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_accept');
  });

  it('handles maxRounds of 1', () => {
    const result = generatePromptAddenda(makeCtx({ round: 1, maxRounds: 1 }));
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('first_round');
    expect(ids).toContain('last_round');
  });

  it('handles unknown action without crashing', () => {
    const result = generatePromptAddenda(makeCtx({ action: 'UNKNOWN_ACTION' }));
    expect(Array.isArray(result.addenda)).toBe(true);
  });
});
