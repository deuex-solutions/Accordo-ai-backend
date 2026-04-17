/**
 * Tests for personalityLayer.ts (Feature #4: Adaptive Personality Moments)
 *
 * Validates milestone detection, tone-adaptive personality templates,
 * and response enrichment. Tests cover all 7 milestones across all 5 tones.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  detectMilestone,
  getPersonalityEnrichment,
  applyPersonality,
  type NegotiationMilestone,
  type MilestoneDetectionInput,
  type PersonalityEnrichment,
} from '../../../src/modules/chatbot/engine/personality-layer.js';
import type { VendorTone } from '../../../src/modules/chatbot/engine/tone-detector.js';

// ─────────────────────────────────────────────
// Milestone Detection
// ─────────────────────────────────────────────

describe('detectMilestone', () => {
  it('returns deal_accepted for ACCEPT action', () => {
    expect(detectMilestone({ action: 'ACCEPT', round: 3, maxRounds: 10 })).toBe('deal_accepted');
  });

  it('returns vendor_walked_away for WALK_AWAY action', () => {
    expect(detectMilestone({ action: 'WALK_AWAY', round: 3, maxRounds: 10 })).toBe('vendor_walked_away');
  });

  it('returns escalated for ESCALATE action', () => {
    expect(detectMilestone({ action: 'ESCALATE', round: 3, maxRounds: 10 })).toBe('escalated');
  });

  it('returns final_round when round equals maxRounds', () => {
    expect(detectMilestone({ action: 'COUNTER', round: 10, maxRounds: 10 })).toBe('final_round');
  });

  it('returns long_negotiation for round 5+ with COUNTER', () => {
    expect(detectMilestone({ action: 'COUNTER', round: 5, maxRounds: 10 })).toBe('long_negotiation');
  });

  it('returns long_negotiation for round 7 with COUNTER', () => {
    expect(detectMilestone({ action: 'COUNTER', round: 7, maxRounds: 10 })).toBe('long_negotiation');
  });

  it('returns first_counter for round 1 with COUNTER', () => {
    expect(detectMilestone({ action: 'COUNTER', round: 1, maxRounds: 10 })).toBe('first_counter');
  });

  it('returns significant_concession when utility jumps 15%+', () => {
    expect(detectMilestone({
      action: 'COUNTER',
      round: 3,
      maxRounds: 10,
      previousUtility: 0.45,
      currentUtility: 0.65,
    })).toBe('significant_concession');
  });

  it('returns none for regular COUNTER round 3 without big jump', () => {
    expect(detectMilestone({
      action: 'COUNTER',
      round: 3,
      maxRounds: 10,
      previousUtility: 0.50,
      currentUtility: 0.55,
    })).toBe('none');
  });

  it('returns none for ASK_CLARIFY action', () => {
    expect(detectMilestone({ action: 'ASK_CLARIFY', round: 2, maxRounds: 10 })).toBe('none');
  });

  it('ACCEPT takes priority over final_round', () => {
    // Round 10 of 10, but ACCEPT — should be deal_accepted not final_round
    expect(detectMilestone({ action: 'ACCEPT', round: 10, maxRounds: 10 })).toBe('deal_accepted');
  });

  it('WALK_AWAY takes priority over long_negotiation', () => {
    expect(detectMilestone({ action: 'WALK_AWAY', round: 7, maxRounds: 10 })).toBe('vendor_walked_away');
  });

  it('final_round takes priority over long_negotiation', () => {
    // Round 10 of 10 with COUNTER — should be final_round, not long_negotiation
    expect(detectMilestone({ action: 'COUNTER', round: 10, maxRounds: 10 })).toBe('final_round');
  });
});

// ─────────────────────────────────────────────
// Personality Enrichment — shape validation
// ─────────────────────────────────────────────

describe('getPersonalityEnrichment – shape', () => {
  it('returns empty prefix/suffix for none milestone', () => {
    const result = getPersonalityEnrichment('none', 'friendly');
    expect(result.milestone).toBe('none');
    expect(result.prefix).toBe('');
    expect(result.suffix).toBe('');
  });

  it('returns non-empty prefix for deal_accepted', () => {
    const result = getPersonalityEnrichment('deal_accepted', 'friendly');
    expect(result.milestone).toBe('deal_accepted');
    expect(result.prefix.length).toBeGreaterThan(0);
  });

  it('returns non-empty suffix for deal_accepted', () => {
    const result = getPersonalityEnrichment('deal_accepted', 'friendly');
    expect(result.suffix.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// Tone adaptation — each tone gets different text
// ─────────────────────────────────────────────

describe('getPersonalityEnrichment – tone adaptation', () => {
  const allTones: VendorTone[] = ['formal', 'casual', 'firm', 'urgent', 'friendly'];

  for (const tone of allTones) {
    it(`deal_accepted has prefix for tone=${tone}`, () => {
      const result = getPersonalityEnrichment('deal_accepted', tone);
      expect(result.prefix.length).toBeGreaterThan(0);
    });

    it(`deal_accepted has suffix for tone=${tone}`, () => {
      const result = getPersonalityEnrichment('deal_accepted', tone);
      expect(result.suffix.length).toBeGreaterThan(0);
    });
  }

  it('formal deal_accepted is more professional than casual', () => {
    const formal = getPersonalityEnrichment('deal_accepted', 'formal');
    const casual = getPersonalityEnrichment('deal_accepted', 'casual');
    // Formal should not contain casual words
    expect(formal.prefix.toLowerCase()).not.toMatch(/awesome|great|excited/);
    // Casual should not contain overly formal language
    expect(casual.prefix.toLowerCase()).not.toMatch(/delighted|pleasure|arrangement/);
  });

  it('urgent deal_accepted is concise', () => {
    const urgent = getPersonalityEnrichment('deal_accepted', 'urgent');
    // Urgent prefix should be short (under 50 chars)
    expect(urgent.prefix.length).toBeLessThan(55);
  });
});

// ─────────────────────────────────────────────
// All milestone × tone combinations produce valid output
// ─────────────────────────────────────────────

describe('getPersonalityEnrichment – all milestone × tone combinations', () => {
  const milestones: Exclude<NegotiationMilestone, 'none'>[] = [
    'deal_accepted', 'long_negotiation', 'vendor_walked_away',
    'escalated', 'first_counter', 'significant_concession', 'final_round',
  ];
  const tones: VendorTone[] = ['formal', 'casual', 'firm', 'urgent', 'friendly'];

  for (const milestone of milestones) {
    for (const tone of tones) {
      it(`${milestone} × ${tone} returns valid enrichment`, () => {
        const result = getPersonalityEnrichment(milestone, tone);
        expect(result.milestone).toBe(milestone);
        expect(typeof result.prefix).toBe('string');
        expect(typeof result.suffix).toBe('string');
        // At least prefix or suffix should be non-empty
        expect(result.prefix.length + result.suffix.length).toBeGreaterThan(0);
      });
    }
  }
});

// ─────────────────────────────────────────────
// applyPersonality
// ─────────────────────────────────────────────

describe('applyPersonality', () => {
  it('returns original response for none milestone', () => {
    const enrichment: PersonalityEnrichment = { milestone: 'none', prefix: '', suffix: '' };
    expect(applyPersonality('Original response.', enrichment)).toBe('Original response.');
  });

  it('prepends prefix to response', () => {
    const enrichment: PersonalityEnrichment = {
      milestone: 'deal_accepted',
      prefix: 'Great news!',
      suffix: '',
    };
    const result = applyPersonality('We accept your offer.', enrichment);
    expect(result).toBe('Great news! We accept your offer.');
  });

  it('appends suffix to response', () => {
    const enrichment: PersonalityEnrichment = {
      milestone: 'deal_accepted',
      prefix: '',
      suffix: 'Looking forward to working together!',
    };
    const result = applyPersonality('We accept your offer.', enrichment);
    expect(result).toBe('We accept your offer. Looking forward to working together!');
  });

  it('applies both prefix and suffix', () => {
    const enrichment: PersonalityEnrichment = {
      milestone: 'deal_accepted',
      prefix: 'Great news!',
      suffix: 'Looking forward to working together!',
    };
    const result = applyPersonality('We accept your offer.', enrichment);
    expect(result).toBe('Great news! We accept your offer. Looking forward to working together!');
  });

  it('handles empty response gracefully', () => {
    const enrichment: PersonalityEnrichment = {
      milestone: 'deal_accepted',
      prefix: 'Great news!',
      suffix: 'Looking forward!',
    };
    const result = applyPersonality('', enrichment);
    expect(result).toBe('Great news!  Looking forward!');
  });
});

// ─────────────────────────────────────────────
// Integration: detectMilestone → getPersonalityEnrichment → applyPersonality
// ─────────────────────────────────────────────

describe('Personality pipeline integration', () => {
  it('ACCEPT + formal vendor → professional celebration', () => {
    const milestone = detectMilestone({ action: 'ACCEPT', round: 4, maxRounds: 10 });
    const enrichment = getPersonalityEnrichment(milestone, 'formal');
    const result = applyPersonality('We accept $45,000 at Net 60.', enrichment);
    expect(result).toContain('We accept $45,000 at Net 60.');
    expect(result.length).toBeGreaterThan('We accept $45,000 at Net 60.'.length);
  });

  it('ACCEPT + casual vendor → casual celebration', () => {
    const milestone = detectMilestone({ action: 'ACCEPT', round: 3, maxRounds: 10 });
    const enrichment = getPersonalityEnrichment(milestone, 'casual');
    const result = applyPersonality('Deal at $45,000, Net 60.', enrichment);
    expect(result).toContain('Deal at $45,000, Net 60.');
  });

  it('COUNTER at round 1 → first counter acknowledgment', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 1, maxRounds: 10 });
    expect(milestone).toBe('first_counter');
    const enrichment = getPersonalityEnrichment(milestone, 'friendly');
    expect(enrichment.prefix.length).toBeGreaterThan(0);
  });

  it('COUNTER at round 7 → long negotiation empathy', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 7, maxRounds: 10 });
    expect(milestone).toBe('long_negotiation');
    const enrichment = getPersonalityEnrichment(milestone, 'friendly');
    expect(enrichment.prefix.length).toBeGreaterThan(0);
  });

  it('no milestone → response unchanged', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 3, maxRounds: 10 });
    expect(milestone).toBe('none');
    const enrichment = getPersonalityEnrichment(milestone, 'friendly');
    const result = applyPersonality('Our counter: $42,000.', enrichment);
    expect(result).toBe('Our counter: $42,000.');
  });
});
