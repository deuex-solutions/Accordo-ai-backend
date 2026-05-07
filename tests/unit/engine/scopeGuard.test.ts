/**
 * Tests for scopeGuard.ts (Feature #2: Scope Guard)
 *
 * Validates off-topic detection and negotiation safelist logic.
 * Tests cover: weather, sports, politics, coding, entertainment,
 * personal questions, negotiation keywords, edge cases, and
 * mixed-content messages.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  checkScopeGuard,
  type ScopeGuardResult,
  type OffTopicCategory,
} from '../../../src/modules/chatbot/engine/scope-guard.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function expectOnTopic(result: ScopeGuardResult) {
  expect(result.isOffTopic).toBe(false);
  expect(result.category).toBeNull();
  expect(result.response).toBeNull();
}

function expectOffTopic(result: ScopeGuardResult, expectedCategory: OffTopicCategory) {
  expect(result.isOffTopic).toBe(true);
  expect(result.category).toBe(expectedCategory);
  expect(result.response).toBeTruthy();
  expect(typeof result.response).toBe('string');
  expect(result.confidence).toBeGreaterThanOrEqual(0.7);
}

// ─────────────────────────────────────────────
// Negotiation messages — MUST be on-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – negotiation messages (on-topic)', () => {
  it('allows price offer: "$45,000"', () => {
    expectOnTopic(checkScopeGuard('Our price is $45,000'));
  });

  it('allows price with currency symbol: "₹3,50,000"', () => {
    expectOnTopic(checkScopeGuard('We offer ₹3,50,000'));
  });

  it('allows "Net 30" payment terms', () => {
    expectOnTopic(checkScopeGuard('We can do Net 30 payment terms'));
  });

  it('allows "Net 60" terms discussion', () => {
    expectOnTopic(checkScopeGuard('Would you accept Net 60?'));
  });

  it('allows delivery discussion', () => {
    expectOnTopic(checkScopeGuard('We can deliver within 30 days'));
  });

  it('allows price negotiation language', () => {
    expectOnTopic(checkScopeGuard('Can you offer a discount on bulk orders?'));
  });

  it('allows counter-offer message', () => {
    expectOnTopic(checkScopeGuard('We counter with $38,000 and Net 45'));
  });

  it('allows warranty discussion', () => {
    expectOnTopic(checkScopeGuard('We provide 12 months warranty on all products'));
  });

  it('allows quantity discussion', () => {
    expectOnTopic(checkScopeGuard('The minimum order quantity is 500 units'));
  });

  it('allows acceptance message', () => {
    expectOnTopic(checkScopeGuard('We accept your terms and can proceed with the deal'));
  });

  it('allows rejection message', () => {
    expectOnTopic(checkScopeGuard('We cannot agree to those payment terms'));
  });

  it('allows vendor/supplier context', () => {
    expectOnTopic(checkScopeGuard('As your preferred vendor, we can offer better rates'));
  });

  it('allows RFQ/quotation reference', () => {
    expectOnTopic(checkScopeGuard('Regarding the RFQ, here is our quotation'));
  });

  it('allows quality/specification talk', () => {
    expectOnTopic(checkScopeGuard('Our products meet ISO 9001 quality standards'));
  });

  it('allows advance payment discussion', () => {
    expectOnTopic(checkScopeGuard('We require 30% advance payment before shipment'));
  });

  it('allows logistics and shipping talk', () => {
    expectOnTopic(checkScopeGuard('Shipping will be handled by our logistics partner'));
  });
});

// ─────────────────────────────────────────────
// Weather — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – weather (off-topic)', () => {
  it('blocks "how is the weather"', () => {
    expectOffTopic(checkScopeGuard("How's the weather today?"), 'weather');
  });

  it('blocks "will it rain"', () => {
    expectOffTopic(checkScopeGuard('Will it rain tomorrow?'), 'weather');
  });

  it('blocks temperature question', () => {
    expectOffTopic(checkScopeGuard('What is the temperature outside?'), 'weather');
  });

  it('blocks forecast request', () => {
    expectOffTopic(checkScopeGuard('Can you check the weather forecast?'), 'weather');
  });
});

// ─────────────────────────────────────────────
// Sports — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – sports (off-topic)', () => {
  it('blocks cricket question', () => {
    expectOffTopic(checkScopeGuard('Who won the cricket match today?'), 'sports');
  });

  it('blocks football/soccer', () => {
    expectOffTopic(checkScopeGuard('Did you watch the football game?'), 'sports');
  });

  it('blocks IPL reference', () => {
    expectOffTopic(checkScopeGuard('What is the IPL score?'), 'sports');
  });

  it('blocks World Cup', () => {
    expectOffTopic(checkScopeGuard('When is the next World Cup?'), 'sports');
  });

  it('blocks NBA reference', () => {
    expectOffTopic(checkScopeGuard('The NBA finals were amazing'), 'sports');
  });
});

// ─────────────────────────────────────────────
// Politics — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – politics (off-topic)', () => {
  it('blocks election question', () => {
    expectOffTopic(checkScopeGuard('Who won the election?'), 'politics');
  });

  it('blocks president question', () => {
    expectOffTopic(checkScopeGuard('Who is the president of USA?'), 'politics');
  });

  it('blocks political party mention', () => {
    expectOffTopic(checkScopeGuard('The Democrats and Republicans are debating'), 'politics');
  });

  it('blocks parliament mention', () => {
    expectOffTopic(checkScopeGuard('What did parliament decide?'), 'politics');
  });
});

// ─────────────────────────────────────────────
// General knowledge — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – general knowledge (off-topic)', () => {
  it('blocks "capital of" question', () => {
    expectOffTopic(checkScopeGuard('What is the capital of France?'), 'general_knowledge');
  });

  it('blocks joke request', () => {
    expectOffTopic(checkScopeGuard('Tell me a joke please'), 'general_knowledge');
  });

  it('blocks invention question', () => {
    expectOffTopic(checkScopeGuard('Who invented the telephone?'), 'general_knowledge');
  });
});

// ─────────────────────────────────────────────
// Coding — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – coding (off-topic)', () => {
  it('blocks coding request', () => {
    expectOffTopic(checkScopeGuard('Write a javascript function for me please'), 'coding');
  });

  it('blocks programming help', () => {
    expectOffTopic(checkScopeGuard('How do I code a react component for me'), 'coding');
  });

  it('blocks bug fix request', () => {
    expectOffTopic(checkScopeGuard('Fix my code bug please help'), 'coding');
  });
});

// ─────────────────────────────────────────────
// Entertainment — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – entertainment (off-topic)', () => {
  it('blocks movie question', () => {
    expectOffTopic(checkScopeGuard('What movie should I watch tonight?'), 'entertainment');
  });

  it('blocks Netflix mention', () => {
    expectOffTopic(checkScopeGuard('Have you seen the new Netflix series?'), 'entertainment');
  });

  it('blocks music question', () => {
    expectOffTopic(checkScopeGuard('Recommend a song for me'), 'entertainment');
  });
});

// ─────────────────────────────────────────────
// Personal questions — off-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – personal questions (off-topic)', () => {
  it('blocks "are you a robot"', () => {
    expectOffTopic(checkScopeGuard('Are you a robot?'), 'personal');
  });

  it('blocks "what is your name"', () => {
    expectOffTopic(checkScopeGuard("What's your name?"), 'personal');
  });

  it('blocks "do you feel"', () => {
    expectOffTopic(checkScopeGuard('Do you feel emotions?'), 'personal');
  });

  it('blocks "who created you"', () => {
    expectOffTopic(checkScopeGuard('Who created you?'), 'personal');
  });
});

// ─────────────────────────────────────────────
// Edge cases — should be on-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – edge cases', () => {
  it('allows very short messages (< 3 chars)', () => {
    expectOnTopic(checkScopeGuard('ok'));
  });

  it('allows empty string', () => {
    expectOnTopic(checkScopeGuard(''));
  });

  it('allows whitespace-only', () => {
    expectOnTopic(checkScopeGuard('   '));
  });

  it('allows numbers only (possible price)', () => {
    expectOnTopic(checkScopeGuard('45000'));
  });

  it('allows greeting "hello"', () => {
    // Short greeting, no off-topic patterns
    expectOnTopic(checkScopeGuard('hello'));
  });

  it('allows "yes" / "no" responses', () => {
    expectOnTopic(checkScopeGuard('yes'));
    expectOnTopic(checkScopeGuard('no'));
  });

  it('allows "thank you"', () => {
    expectOnTopic(checkScopeGuard('thank you'));
  });
});

// ─────────────────────────────────────────────
// Mixed content — negotiation keyword overrides
// ─────────────────────────────────────────────

describe('ScopeGuard – mixed content (safelist wins)', () => {
  it('allows message with both weather AND price', () => {
    // "It's raining but our price is $45,000" — safelist matches price
    expectOnTopic(checkScopeGuard("It's raining but our price is $45,000"));
  });

  it('allows sports metaphor with delivery terms', () => {
    expectOnTopic(checkScopeGuard('We hit a home run — delivery within 30 days'));
  });

  it('allows movie reference with payment terms', () => {
    expectOnTopic(checkScopeGuard('Like a Netflix deal, our payment is Net 60'));
  });

  it('allows casual football mention with discount', () => {
    expectOnTopic(checkScopeGuard('After the football match, let me offer a 10% discount'));
  });
});

// ─────────────────────────────────────────────
// Response format
// ─────────────────────────────────────────────

describe('ScopeGuard – response format', () => {
  it('response mentions negotiation/pricing/terms', () => {
    const result = checkScopeGuard("What's the weather?");
    expect(result.response).toBeTruthy();
    expect(result.response!.toLowerCase()).toMatch(/negotiation|pricing|terms|agreement/);
  });

  it('response includes product name when provided', () => {
    const result = checkScopeGuard("What's the weather?", 'Steel Beams');
    expect(result.response).toBeTruthy();
    expect(result.response).toContain('Steel Beams');
  });

  it('response works without product name', () => {
    const result = checkScopeGuard("What's the weather?");
    expect(result.response).toBeTruthy();
    // Should not contain "undefined" or "null"
    expect(result.response).not.toContain('undefined');
    expect(result.response).not.toContain('null');
  });

  it('confidence is between 0 and 1', () => {
    const offTopic = checkScopeGuard("What's the weather?");
    expect(offTopic.confidence).toBeGreaterThanOrEqual(0);
    expect(offTopic.confidence).toBeLessThanOrEqual(1);

    const onTopic = checkScopeGuard('Our price is $45,000');
    expect(onTopic.confidence).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Real vendor messages — should be on-topic
// ─────────────────────────────────────────────

describe('ScopeGuard – real vendor messages', () => {
  it('allows "Dear Sir, our revised offer is 29000 INR per unit, Net 45"', () => {
    expectOnTopic(checkScopeGuard('Dear Sir, our revised offer is 29000 INR per unit, Net 45'));
  });

  it('allows "We can offer 5% volume discount for orders over 1000 units"', () => {
    expectOnTopic(checkScopeGuard('We can offer 5% volume discount for orders over 1000 units'));
  });

  it('allows "37000 net45 within 30 days"', () => {
    expectOnTopic(checkScopeGuard('37000 net45 within 30 days'));
  });

  it('allows "This is our final offer — $90,000, take it or leave it"', () => {
    expectOnTopic(checkScopeGuard('This is our final offer — $90,000, take it or leave it'));
  });

  it('allows "We appreciate the opportunity and propose a win-win deal"', () => {
    expectOnTopic(checkScopeGuard('We appreciate the opportunity and propose a win-win deal'));
  });

  it('allows "Can we extend the delivery timeline by 2 weeks?"', () => {
    expectOnTopic(checkScopeGuard('Can we extend the delivery timeline by 2 weeks?'));
  });

  it('allows "Our quotation includes freight and insurance costs"', () => {
    expectOnTopic(checkScopeGuard('Our quotation includes freight and insurance costs'));
  });

  it('allows "We need advance payment of 25% before we start production"', () => {
    expectOnTopic(checkScopeGuard('We need advance payment of 25% before we start production'));
  });
});
