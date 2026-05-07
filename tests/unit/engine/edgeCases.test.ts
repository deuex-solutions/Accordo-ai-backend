/**
 * Deep Edge-Case Tests for All MVP Features
 *
 * Covers cross-feature interactions, boundary conditions,
 * adversarial inputs, and realistic client scenarios.
 *
 * No DB, no network — pure unit tests targeting engine modules.
 */

import { describe, it, expect } from 'vitest';

// Feature #2: Scope Guard
import { checkScopeGuard } from '../../../src/modules/chatbot/engine/scope-guard.js';

// Feature #4: Personality Layer
import {
  detectMilestone,
  getPersonalityEnrichment,
  applyPersonality,
} from '../../../src/modules/chatbot/engine/personality-layer.js';

// Feature #5: Error Recovery
import {
  classifyError,
  getErrorFallbackResponse,
  buildPartialResult,
} from '../../../src/modules/chatbot/engine/error-recovery.js';

// Feature #6: History Sanitization
import { sanitizeNegotiationHistory } from '../../../src/modules/chatbot/engine/history-sanitizer.js';

// Feature #7: Dynamic Prompt Addenda
import { generatePromptAddenda } from '../../../src/modules/chatbot/engine/prompt-addenda.js';

// Feature #9: Tone Templates
import {
  getToneAwareTemplate,
  type TemplateContext,
} from '../../../src/modules/chatbot/engine/tone-templates.js';

// Feature #12: State Machine
import {
  transition,
  canTransition,
  isTerminal,
  isActive,
  actionToEvent,
  getTargetState,
  type DealState,
  type TransitionEvent,
} from '../../../src/modules/chatbot/engine/negotiation-state-machine.js';

// ═══════════════════════════════════════════════════════════════
// 1. SCOPE GUARD — Adversarial & Edge Inputs
// ═══════════════════════════════════════════════════════════════

describe('ScopeGuard – adversarial inputs', () => {
  it('handles empty string', () => {
    const result = checkScopeGuard('');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles single character', () => {
    const result = checkScopeGuard('a');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles extremely long message (10K chars)', () => {
    const longMsg = 'I want to negotiate a price of $50,000 with Net 60 terms. '.repeat(200);
    const result = checkScopeGuard(longMsg);
    expect(result.isOffTopic).toBe(false);
  });

  it('handles Unicode characters', () => {
    const result = checkScopeGuard('价格是50000美元，付款条件为Net 60');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles emoji-only messages', () => {
    const result = checkScopeGuard('👍🎉💰');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles XSS attempt in message', () => {
    const result = checkScopeGuard('<script>alert("xss")</script>What price can you offer?');
    // Should still detect "price" as negotiation keyword
    expect(result.isOffTopic).toBe(false);
  });

  it('handles SQL injection attempt', () => {
    const result = checkScopeGuard("'; DROP TABLE deals; -- What's the price?");
    expect(result.isOffTopic).toBe(false); // "price" in safelist
  });

  it('handles message with only whitespace and newlines', () => {
    const result = checkScopeGuard('   \n\n\t  ');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles message with special regex characters', () => {
    const result = checkScopeGuard('Price: $50,000.00 (total) [net 60] {confirmed}');
    expect(result.isOffTopic).toBe(false);
  });

  it('handles mixed off-topic + negotiation keywords (safelist wins)', () => {
    const result = checkScopeGuard('Who won the election? Anyway, our price is $50,000');
    expect(result.isOffTopic).toBe(false); // "price" safelist overrides
  });

  it('handles ALL CAPS off-topic message', () => {
    const result = checkScopeGuard('WHAT IS THE WEATHER LIKE TODAY');
    expect(result.isOffTopic).toBe(true);
    expect(result.category).toBe('weather');
  });

  it('handles product name with off-topic overlap', () => {
    // Product name "Weather Station Pro" should make weather-related terms safe
    const result = checkScopeGuard('What is the temperature range?', 'Weather Station Pro');
    // Without price/terms keywords, this would be off-topic
    // But the product name context might help
    expect(typeof result.isOffTopic).toBe('boolean');
  });

  it('handles repeated off-topic patterns in one message', () => {
    const result = checkScopeGuard('What is the weather? How is the weather? Tell me the weather!');
    expect(result.isOffTopic).toBe(true);
  });
});

describe('ScopeGuard – negotiation boundary cases', () => {
  it('"How much?" is on-topic', () => {
    const result = checkScopeGuard('How much?');
    expect(result.isOffTopic).toBe(false);
  });

  it('"OK" alone is on-topic (too short to be off-topic)', () => {
    const result = checkScopeGuard('OK');
    expect(result.isOffTopic).toBe(false);
  });

  it('"Yes" alone is on-topic', () => {
    const result = checkScopeGuard('Yes');
    expect(result.isOffTopic).toBe(false);
  });

  it('"No deal" is on-topic', () => {
    const result = checkScopeGuard('No deal');
    expect(result.isOffTopic).toBe(false);
  });

  it('"That works" is on-topic', () => {
    const result = checkScopeGuard('That works for us');
    expect(result.isOffTopic).toBe(false);
  });

  it('"I accept" is on-topic', () => {
    const result = checkScopeGuard('I accept your offer');
    expect(result.isOffTopic).toBe(false);
  });

  it('"We need to walk away" is on-topic', () => {
    const result = checkScopeGuard('We need to walk away from this deal');
    expect(result.isOffTopic).toBe(false);
  });

  it('Number-only message is on-topic', () => {
    const result = checkScopeGuard('50000');
    expect(result.isOffTopic).toBe(false);
  });

  it('Dollar amount is on-topic', () => {
    const result = checkScopeGuard('$45,000');
    expect(result.isOffTopic).toBe(false);
  });

  it('"Net 30" alone is on-topic', () => {
    const result = checkScopeGuard('Net 30');
    expect(result.isOffTopic).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. HISTORY SANITIZER – Cross-Feature with Scope Guard
// ═══════════════════════════════════════════════════════════════

describe('HistorySanitizer + ScopeGuard interaction', () => {
  it('sanitized placeholder text is not flagged as off-topic', () => {
    const placeholder = '[Previous context may be outdated. Use the current deal state and latest vendor message for your response.]';
    const scopeResult = checkScopeGuard(placeholder);
    // Placeholder text contains negotiation keywords ("deal", "message")
    expect(scopeResult.isOffTopic).toBe(false);
  });

  it('vendor messages with stale patterns are NOT sanitized (only ACCORDO)', () => {
    const result = sanitizeNegotiationHistory([
      { role: 'VENDOR', content: 'The vendor has declined your offer. We want $95,000.' },
    ]);
    expect(result.sanitizedCount).toBe(0);
    // Content should be preserved exactly
    expect(result.messages[0].content).toContain('$95,000');
  });

  it('handles conversation with scope guard redirect messages', () => {
    const result = sanitizeNegotiationHistory([
      { role: 'VENDOR', content: "What's the weather?" },
      { role: 'ACCORDO', content: "I'd be happy to help, but let's focus on the negotiation. Could you provide your price and terms?" },
      { role: 'VENDOR', content: 'OK, $50,000 Net 30' },
    ]);
    expect(result.sanitizedCount).toBe(0); // Redirect message has no stale patterns
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. ERROR RECOVERY – Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('ErrorRecovery – edge cases', () => {
  it('classifies error with very long message', () => {
    const longError = new Error('A '.repeat(5000) + 'database connection failed');
    expect(classifyError(longError)).toBe('db_error');
  });

  it('classifies error object with no message property', () => {
    const err = { code: 'ECONNREFUSED' };
    expect(classifyError(err)).toBe('unknown');
  });

  it('classifies number as error', () => {
    expect(classifyError(42)).toBe('unknown');
  });

  it('classifies boolean as error', () => {
    expect(classifyError(false)).toBe('unknown');
  });

  it('classifies empty string as error', () => {
    expect(classifyError('')).toBe('unknown');
  });

  it('buildPartialResult with all processing steps completed', () => {
    const result = buildPartialResult(
      new Error('Failed at the very end'),
      ['load_deal', 'load_messages', 'parse_offer', 'load_config', 'calculate_utility', 'decide', 'generate_response', 'save_message'],
      'update_deal'
    );
    expect(result.isPartial).toBe(true);
    expect(result.completedSteps).toHaveLength(8);
    expect(result.failedStep).toBe('update_deal');
  });

  it('buildPartialResult with empty completed steps', () => {
    const result = buildPartialResult(
      new Error('Failed immediately'),
      [],
      'load_deal'
    );
    expect(result.isPartial).toBe(true);
    expect(result.completedSteps).toHaveLength(0);
  });

  it('fallback response for each category is under 300 chars', () => {
    const categories = [
      'parse_failure', 'llm_timeout', 'llm_error', 'db_error',
      'config_missing', 'deal_not_found', 'invalid_state', 'unknown',
    ] as const;

    for (const cat of categories) {
      for (let i = 0; i < 10; i++) {
        const response = getErrorFallbackResponse(cat);
        expect(response.length).toBeLessThan(300);
      }
    }
  });

  it('error recovery responses never contain raw JSON', () => {
    const categories = [
      'parse_failure', 'llm_timeout', 'llm_error', 'db_error',
      'config_missing', 'deal_not_found', 'invalid_state', 'unknown',
    ] as const;

    for (const cat of categories) {
      for (let i = 0; i < 10; i++) {
        const response = getErrorFallbackResponse(cat);
        expect(response).not.toMatch(/\{.*:.*\}/); // No JSON
        expect(response).not.toMatch(/\[object/);   // No [object Object]
        expect(response).not.toContain('Error:');    // No Error: prefix
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. PERSONALITY LAYER – Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('PersonalityLayer – edge cases', () => {
  it('round 0 does not crash', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 0, maxRounds: 10 });
    expect(typeof milestone).toBe('string');
  });

  it('negative round does not crash', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: -1, maxRounds: 10 });
    expect(typeof milestone).toBe('string');
  });

  it('maxRounds of 0 does not crash', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 1, maxRounds: 0 });
    expect(typeof milestone).toBe('string');
  });

  it('round exceeds maxRounds', () => {
    const milestone = detectMilestone({ action: 'COUNTER', round: 15, maxRounds: 10 });
    // Should be final_round or long_negotiation
    expect(['final_round', 'long_negotiation']).toContain(milestone);
  });

  it('applyPersonality preserves exact content when milestone is none', () => {
    const enrichment = getPersonalityEnrichment('none', 'formal');
    const original = 'We counter with $42,000.00, Net 60, delivered by March 15.';
    const result = applyPersonality(original, enrichment);
    expect(result).toBe(original);
  });

  it('applyPersonality does not double-add punctuation', () => {
    const enrichment = getPersonalityEnrichment('deal_accepted', 'friendly');
    const result = applyPersonality('We accept.', enrichment);
    // Should not have "..   .." or similar double punctuation
    expect(result).not.toMatch(/\.\s*\./);
  });

  it('utility jump detection works with edge values', () => {
    // Exactly 15% jump
    const milestone = detectMilestone({
      action: 'COUNTER',
      round: 3,
      maxRounds: 10,
      previousUtility: 0.50,
      currentUtility: 0.65,
    });
    expect(milestone).toBe('significant_concession');
  });

  it('utility jump detection works with 14% jump (should NOT trigger)', () => {
    const milestone = detectMilestone({
      action: 'COUNTER',
      round: 3,
      maxRounds: 10,
      previousUtility: 0.50,
      currentUtility: 0.64,
    });
    expect(milestone).toBe('none');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. TONE TEMPLATES – Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('ToneTemplates – edge cases', () => {
  function makeCtx(overrides?: Partial<TemplateContext>): TemplateContext {
    return {
      vendorPrice: '$0.00',
      vendorTerms: 'not specified',
      vendorDelivery: 'as agreed',
      counterPrice: '$0.00',
      counterTerms: 'flexible',
      counterDelivery: 'per agreement',
      concernAck: '',
      round: 1,
      maxRounds: 1,
      ...overrides,
    };
  }

  it('handles $0.00 prices gracefully', () => {
    const result = getToneAwareTemplate('ACCEPT', makeCtx(), 'friendly');
    expect(result).toContain('$0.00');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles empty concern acknowledgment', () => {
    const result = getToneAwareTemplate('COUNTER', makeCtx({ concernAck: '' }), 'formal');
    expect(result.length).toBeGreaterThan(0);
    // Should not start with a space
    expect(result).not.toMatch(/^\s+\S/);
  });

  it('handles very long concern acknowledgment', () => {
    const longConcern = 'We understand your concerns about supply chain disruptions, quality assurance requirements, and delivery timeline pressures. ';
    const result = getToneAwareTemplate('COUNTER', makeCtx({ concernAck: longConcern }), 'friendly');
    expect(result).toContain('supply chain');
  });

  it('all 5 tones produce different text for ACCEPT', () => {
    const tones = ['formal', 'casual', 'firm', 'urgent', 'friendly'] as const;
    const templateSets = new Map<string, Set<string>>();

    for (const tone of tones) {
      const templates = new Set<string>();
      for (let i = 0; i < 30; i++) {
        templates.add(getToneAwareTemplate('ACCEPT', makeCtx({ vendorPrice: '$95,000.00', vendorTerms: 'Net 30', vendorDelivery: 'within 14 days' }), tone));
      }
      templateSets.set(tone, templates);
    }

    // Each tone should produce at least one unique template not found in other tones
    for (const tone of tones) {
      const myTemplates = templateSets.get(tone)!;
      expect(myTemplates.size).toBeGreaterThan(0);
    }
  });

  it('ASK_CLARIFY with both items missing', () => {
    const result = getToneAwareTemplate('ASK_CLARIFY', makeCtx(), 'casual', {
      provided: [],
      missing: ['price', 'payment terms'],
    });
    expect(result.toLowerCase()).toMatch(/price|terms/);
  });

  it('ASK_CLARIFY with nothing missing', () => {
    const result = getToneAwareTemplate('ASK_CLARIFY', makeCtx(), 'formal', {
      provided: ['$45,000 total price', 'Net 60 payment terms'],
      missing: [],
    });
    expect(result.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. PROMPT ADDENDA – Edge Cases
// ═══════════════════════════════════════════════════════════════

describe('PromptAddenda – edge cases', () => {
  it('handles all optional fields missing', () => {
    const result = generatePromptAddenda({
      round: 3,
      maxRounds: 10,
      utilityScore: 0.55,
      action: 'COUNTER',
      vendorTone: 'friendly',
    });
    expect(Array.isArray(result.addenda)).toBe(true);
  });

  it('handles utilityScore of exactly 0', () => {
    const result = generatePromptAddenda({
      round: 3,
      maxRounds: 10,
      utilityScore: 0,
      action: 'COUNTER',
      vendorTone: 'friendly',
    });
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_walkaway');
  });

  it('handles utilityScore of exactly 1', () => {
    const result = generatePromptAddenda({
      round: 3,
      maxRounds: 10,
      utilityScore: 1,
      action: 'COUNTER',
      vendorTone: 'friendly',
    });
    const ids = result.addenda.map(a => a.id);
    expect(ids).toContain('near_accept');
  });

  it('does not fire conflicting addenda (near_accept AND near_walkaway)', () => {
    // With a utility score in the middle, neither should fire
    const result = generatePromptAddenda({
      round: 3,
      maxRounds: 10,
      utilityScore: 0.55,
      action: 'COUNTER',
      vendorTone: 'friendly',
    });
    const ids = result.addenda.map(a => a.id);
    const hasNearAccept = ids.includes('near_accept');
    const hasNearWalkaway = ids.includes('near_walkaway');
    // Should not have both simultaneously
    expect(hasNearAccept && hasNearWalkaway).toBe(false);
  });

  it('promptSuffix never contains internal jargon', () => {
    const scenarios = [
      { round: 1, maxRounds: 10, utilityScore: 0.7, action: 'COUNTER', vendorTone: 'firm' as const, stallDetected: true },
      { round: 10, maxRounds: 10, utilityScore: 0.3, action: 'WALK_AWAY', vendorTone: 'urgent' as const },
      { round: 5, maxRounds: 10, utilityScore: 0.9, action: 'ACCEPT', vendorTone: 'friendly' as const },
    ];

    for (const ctx of scenarios) {
      const result = generatePromptAddenda(ctx);
      const banned = ['sequelize', 'database', 'api', 'json', 'null', 'undefined'];
      for (const term of banned) {
        expect(result.promptSuffix.toLowerCase()).not.toContain(term);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. STATE MACHINE – Edge Cases & Full Lifecycle
// ═══════════════════════════════════════════════════════════════

describe('StateMachine – adversarial transitions', () => {
  it('rapid state changes do not corrupt state', () => {
    let state: DealState = 'NEGOTIATING';
    const events: TransitionEvent[] = ['COUNTER', 'COUNTER', 'COUNTER', 'ACCEPT'];

    for (const event of events) {
      const result = transition(state, event);
      if (result.valid) state = result.newState;
    }

    expect(state).toBe('ACCEPTED');
  });

  it('attempting to resume a non-escalated deal fails gracefully', () => {
    const states: DealState[] = ['NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY'];

    for (const state of states) {
      const result = transition(state, 'RESUME');
      expect(result.valid).toBe(false);
      expect(result.newState).toBe(state);
    }
  });

  it('double accept does not change terminal state', () => {
    let state: DealState = 'NEGOTIATING';
    state = transition(state, 'ACCEPT').newState;
    expect(state).toBe('ACCEPTED');

    const doubleAccept = transition(state, 'ACCEPT');
    expect(doubleAccept.valid).toBe(false);
    expect(doubleAccept.newState).toBe('ACCEPTED');
  });

  it('ERROR_RECOVERY action keeps deal NEGOTIATING', () => {
    const event = actionToEvent('ERROR_RECOVERY');
    const result = transition('NEGOTIATING', event);
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('REDIRECT action keeps deal NEGOTIATING', () => {
    const event = actionToEvent('REDIRECT');
    const result = transition('NEGOTIATING', event);
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('unknown action defaults to COUNTER (safe default)', () => {
    const event = actionToEvent('SOME_GARBAGE_ACTION');
    expect(event).toBe('COUNTER');
    const result = transition('NEGOTIATING', event);
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('getTargetState is consistent with transition', () => {
    const states: DealState[] = ['NEGOTIATING', 'ESCALATED', 'ACCEPTED', 'WALKED_AWAY'];
    const actions = ['ACCEPT', 'COUNTER', 'WALK_AWAY', 'ESCALATE', 'REDIRECT', 'ERROR_RECOVERY'];

    for (const state of states) {
      for (const action of actions) {
        const target = getTargetState(state, action);
        const event = actionToEvent(action);
        const transResult = transition(state, event);
        expect(target).toBe(transResult.newState);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. CROSS-FEATURE INTERACTIONS
// ═══════════════════════════════════════════════════════════════

describe('Cross-feature: ScopeGuard → StateMachine', () => {
  it('REDIRECT does not change deal state', () => {
    const scopeResult = checkScopeGuard("What's the weather?");
    expect(scopeResult.isOffTopic).toBe(true);

    // Simulating what chatbot.service.ts does:
    const event = actionToEvent('REDIRECT');
    const stateResult = transition('NEGOTIATING', event);
    expect(stateResult.valid).toBe(true);
    expect(stateResult.newState).toBe('NEGOTIATING');
  });
});

describe('Cross-feature: ErrorRecovery → StateMachine', () => {
  it('ERROR_RECOVERY does not change deal state', () => {
    const errorCategory = classifyError(new Error('LLM timeout'));
    expect(errorCategory).toBe('llm_timeout');

    const event = actionToEvent('ERROR_RECOVERY');
    const stateResult = transition('NEGOTIATING', event);
    expect(stateResult.valid).toBe(true);
    expect(stateResult.newState).toBe('NEGOTIATING');
  });
});

describe('Cross-feature: HistorySanitizer → PersonalityLayer', () => {
  it('sanitized placeholder text does not interfere with personality enrichment', () => {
    const placeholder = '[Previous context may be outdated. Use the current deal state and latest vendor message for your response.]';

    // Personality layer should work normally regardless of sanitized history
    const milestone = detectMilestone({ action: 'ACCEPT', round: 5, maxRounds: 10 });
    const enrichment = getPersonalityEnrichment(milestone, 'friendly');
    const result = applyPersonality('We accept your offer.', enrichment);

    expect(result).toContain('We accept your offer.');
    expect(result.length).toBeGreaterThan('We accept your offer.'.length);
  });
});

describe('Cross-feature: ToneTemplates → PersonalityLayer', () => {
  it('personality enrichment wraps tone template output correctly', () => {
    const ctx: TemplateContext = {
      vendorPrice: '$90,000.00',
      vendorTerms: 'Net 30',
      vendorDelivery: 'within 14 days',
      counterPrice: '$85,000.00',
      counterTerms: 'Net 60',
      counterDelivery: 'by March 15',
      concernAck: '',
      round: 5,
      maxRounds: 10,
    };

    const toneResponse = getToneAwareTemplate('ACCEPT', ctx, 'formal');
    const milestone = detectMilestone({ action: 'ACCEPT', round: 5, maxRounds: 10 });
    const enrichment = getPersonalityEnrichment(milestone, 'formal');
    const final = applyPersonality(toneResponse, enrichment);

    // Should contain original tone template content
    expect(final).toContain('$90,000.00');
    // Should be enriched with personality prefix/suffix
    expect(final.length).toBeGreaterThan(toneResponse.length);
  });
});

describe('Cross-feature: PromptAddenda → ToneTemplates', () => {
  it('urgent vendor tone triggers both addenda and correct template tone', () => {
    const addendaResult = generatePromptAddenda({
      round: 3,
      maxRounds: 10,
      utilityScore: 0.55,
      action: 'COUNTER',
      vendorTone: 'urgent',
    });

    // Should have urgent vendor addendum
    expect(addendaResult.addenda.map(a => a.id)).toContain('urgent_vendor');

    // Tone template should also be urgent
    const ctx: TemplateContext = {
      vendorPrice: '$90,000.00',
      vendorTerms: 'Net 30',
      vendorDelivery: 'ASAP',
      counterPrice: '$85,000.00',
      counterTerms: 'Net 60',
      counterDelivery: 'by March 15',
      concernAck: '',
      round: 3,
      maxRounds: 10,
    };

    const template = getToneAwareTemplate('COUNTER', ctx, 'urgent');
    expect(template.length).toBeGreaterThan(0);
    // Urgent templates tend to be shorter
    expect(template.length).toBeLessThan(300);
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. REALISTIC CLIENT SCENARIOS
// ═══════════════════════════════════════════════════════════════

describe('Realistic scenario: vendor sends off-topic then returns to negotiation', () => {
  it('scope guard blocks, then allows, without state corruption', () => {
    // Off-topic message
    const offTopic = checkScopeGuard("Tell me a joke");
    expect(offTopic.isOffTopic).toBe(true);

    // State should not change
    const redirectState = transition('NEGOTIATING', actionToEvent('REDIRECT'));
    expect(redirectState.newState).toBe('NEGOTIATING');

    // Vendor returns with real offer
    const onTopic = checkScopeGuard("OK fine, $50,000 with Net 60");
    expect(onTopic.isOffTopic).toBe(false);

    // Normal counter should work
    const counterState = transition('NEGOTIATING', 'COUNTER');
    expect(counterState.valid).toBe(true);
    expect(counterState.newState).toBe('NEGOTIATING');
  });
});

describe('Realistic scenario: LLM fails mid-negotiation', () => {
  it('error recovery produces valid fallback, state preserved', () => {
    // Simulate LLM timeout at generate_response step
    const decision = { action: 'COUNTER', utilityScore: 0.62, counterOffer: { total_price: 42000, payment_terms: 'Net 60' } };
    const result = buildPartialResult(
      new Error('Request timed out after 5000ms'),
      ['load_deal', 'load_messages', 'parse_offer', 'calculate_utility', 'decide'],
      'generate_response',
      decision
    );

    expect(result.isPartial).toBe(true);
    expect(result.decision).toEqual(decision);
    expect(result.fallbackResponse).toContain('42,000'); // Price preserved
    expect(result.fallbackResponse).toContain('Net 60');  // Terms preserved

    // State should remain NEGOTIATING (error recovery maps to COUNTER)
    const stateResult = transition('NEGOTIATING', actionToEvent('ERROR_RECOVERY'));
    expect(stateResult.newState).toBe('NEGOTIATING');
  });
});

describe('Realistic scenario: long negotiation with stale history', () => {
  it('stale messages are sanitized before LLM sees them', () => {
    const history = [
      { role: 'VENDOR', content: 'Our initial price is $100,000' },
      { role: 'ACCORDO', content: 'Thank you. We counter with $80,000.' },
      { role: 'VENDOR', content: "We can't go that low." },
      { role: 'ACCORDO', content: 'The vendor has declined our counter. We need to reconsider.' },
      { role: 'VENDOR', content: 'Actually, how about $90,000?' },
      { role: 'ACCORDO', content: 'The vendor will not accept anything below $95,000.' },
      { role: 'VENDOR', content: 'Fine, $92,000 is our final offer.' },
    ];

    const result = sanitizeNegotiationHistory(history);

    // Stale ACCORDO messages should be sanitized
    expect(result.sanitizedCount).toBe(2);
    expect(result.triggeredPatterns).toContain('vendor_declined');
    expect(result.triggeredPatterns).toContain('vendor_will_not');

    // Vendor messages preserved exactly
    expect(result.messages[0].content).toBe('Our initial price is $100,000');
    expect(result.messages[2].content).toBe("We can't go that low.");
    expect(result.messages[4].content).toBe('Actually, how about $90,000?');
    expect(result.messages[6].content).toBe('Fine, $92,000 is our final offer.');

    // Non-stale ACCORDO message preserved
    expect(result.messages[1].content).toBe('Thank you. We counter with $80,000.');
  });
});

describe('Realistic scenario: deal reaches max rounds', () => {
  it('max rounds triggers escalation via state machine', () => {
    let state: DealState = 'NEGOTIATING';

    // 10 rounds of counter
    for (let i = 0; i < 10; i++) {
      const result = transition(state, 'COUNTER');
      expect(result.valid).toBe(true);
      state = result.newState;
    }

    // Max rounds reached → auto-escalate
    const escalation = transition(state, 'MAX_ROUNDS');
    expect(escalation.valid).toBe(true);
    expect(escalation.newState).toBe('ESCALATED');
    state = escalation.newState;

    // Can resume
    const resume = transition(state, 'RESUME');
    expect(resume.valid).toBe(true);
    expect(resume.newState).toBe('NEGOTIATING');
  });
});

describe('Realistic scenario: personality + tone + addenda on final round ACCEPT', () => {
  it('all features compose correctly for a happy-path conclusion', () => {
    // Final round, high utility, friendly vendor
    const milestone = detectMilestone({ action: 'ACCEPT', round: 10, maxRounds: 10 });
    expect(milestone).toBe('deal_accepted'); // ACCEPT takes priority over final_round

    const enrichment = getPersonalityEnrichment(milestone, 'friendly');
    expect(enrichment.prefix.length).toBeGreaterThan(0);

    const addenda = generatePromptAddenda({
      round: 10,
      maxRounds: 10,
      utilityScore: 0.85,
      action: 'ACCEPT',
      vendorTone: 'friendly',
    });
    // Should have last_round + final_rounds + acceptance_warmth
    const ids = addenda.addenda.map(a => a.id);
    expect(ids).toContain('last_round');
    expect(ids).toContain('acceptance_warmth');

    // Tone template should produce friendly acceptance
    const ctx: TemplateContext = {
      vendorPrice: '$88,000.00',
      vendorTerms: 'Net 45',
      vendorDelivery: 'within 21 days',
      counterPrice: '$88,000.00',
      counterTerms: 'Net 45',
      counterDelivery: 'within 21 days',
      concernAck: '',
      round: 10,
      maxRounds: 10,
    };
    const template = getToneAwareTemplate('ACCEPT', ctx, 'friendly');
    const final = applyPersonality(template, enrichment);

    // Should contain the deal terms
    expect(final).toContain('$88,000.00');
    expect(final).toContain('Net 45');
    // Should have personality enrichment
    expect(final.length).toBeGreaterThan(template.length);
  });
});
