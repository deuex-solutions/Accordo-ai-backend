/**
 * Tests for errorRecovery.ts (Feature #5: Error Recovery)
 *
 * Validates error classification, fallback response generation,
 * and partial result construction. Ensures user never sees raw
 * JSON or error internals.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyError,
  getErrorFallbackResponse,
  buildPartialResult,
  type ErrorCategory,
  type ProcessingStep,
  type PartialResult,
} from '../../../src/modules/chatbot/engine/error-recovery.js';

// ─────────────────────────────────────────────
// classifyError
// ─────────────────────────────────────────────

describe('classifyError', () => {
  it('classifies Sequelize errors as db_error', () => {
    expect(classifyError(new Error('SequelizeConnectionError: connection refused'))).toBe('db_error');
  });

  it('classifies database connection errors as db_error', () => {
    expect(classifyError(new Error('ECONNREFUSED to database'))).toBe('db_error');
  });

  it('classifies constraint errors as db_error', () => {
    expect(classifyError(new Error('unique constraint violation'))).toBe('db_error');
  });

  it('classifies timeout errors as llm_timeout', () => {
    expect(classifyError(new Error('Request timed out after 5000ms'))).toBe('llm_timeout');
  });

  it('classifies abort errors as llm_timeout', () => {
    expect(classifyError(new Error('The operation was aborted'))).toBe('llm_timeout');
  });

  it('classifies Ollama errors as llm_error', () => {
    expect(classifyError(new Error('Ollama service unavailable'))).toBe('llm_error');
  });

  it('classifies OpenAI errors as llm_error', () => {
    expect(classifyError(new Error('OpenAI API rate limit exceeded'))).toBe('llm_error');
  });

  it('classifies model errors as llm_error', () => {
    expect(classifyError(new Error('Model not found: qwen3'))).toBe('llm_error');
  });

  it('classifies config errors as config_missing', () => {
    expect(classifyError(new Error('No negotiation configuration found'))).toBe('config_missing');
  });

  it('classifies not found errors as deal_not_found', () => {
    expect(classifyError(new Error('Deal not found'))).toBe('deal_not_found');
  });

  it('classifies 404 errors as deal_not_found', () => {
    expect(classifyError(new Error('404: resource not found'))).toBe('deal_not_found');
  });

  it('classifies invalid state errors as invalid_state', () => {
    expect(classifyError(new Error('Deal is not in negotiating status'))).toBe('invalid_state');
  });

  it('classifies already accepted as invalid_state', () => {
    expect(classifyError(new Error('Deal already accepted'))).toBe('invalid_state');
  });

  it('classifies parse errors as parse_failure', () => {
    expect(classifyError(new Error('Failed to parse offer from message'))).toBe('parse_failure');
  });

  it('classifies unknown errors as unknown', () => {
    expect(classifyError(new Error('Something weird happened'))).toBe('unknown');
  });

  it('handles null error', () => {
    expect(classifyError(null)).toBe('unknown');
  });

  it('handles undefined error', () => {
    expect(classifyError(undefined)).toBe('unknown');
  });

  it('handles string error', () => {
    expect(classifyError('Database connection failed')).toBe('db_error');
  });
});

// ─────────────────────────────────────────────
// getErrorFallbackResponse
// ─────────────────────────────────────────────

describe('getErrorFallbackResponse', () => {
  const categories: ErrorCategory[] = [
    'parse_failure', 'llm_timeout', 'llm_error', 'db_error',
    'config_missing', 'deal_not_found', 'invalid_state', 'unknown',
  ];

  for (const category of categories) {
    it(`returns non-empty string for ${category}`, () => {
      const response = getErrorFallbackResponse(category);
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
    });

    it(`response for ${category} does not contain technical terms`, () => {
      const response = getErrorFallbackResponse(category);
      const technical = ['sequelize', 'database', 'sql', 'api', 'json', 'null', 'undefined', 'stack', 'error code', 'exception'];
      for (const term of technical) {
        expect(response.toLowerCase()).not.toContain(term);
      }
    });

    it(`response for ${category} sounds human`, () => {
      const response = getErrorFallbackResponse(category);
      // Should contain polite language
      expect(response.toLowerCase()).toMatch(/thank|please|sorry|appreciate|received|shortly|assist|patience/);
    });
  }

  it('parse_failure asks for clearer input', () => {
    // Run multiple times to check all templates
    const responses = new Set<string>();
    for (let i = 0; i < 20; i++) {
      responses.add(getErrorFallbackResponse('parse_failure'));
    }
    // At least one response should mention price or terms
    const allResponses = [...responses].join(' ');
    expect(allResponses.toLowerCase()).toMatch(/price|terms|offer/);
  });

  it('invalid_state mentions deal is concluded', () => {
    const responses = new Set<string>();
    for (let i = 0; i < 20; i++) {
      responses.add(getErrorFallbackResponse('invalid_state'));
    }
    const allResponses = [...responses].join(' ');
    expect(allResponses.toLowerCase()).toMatch(/concluded|no longer|already/);
  });
});

// ─────────────────────────────────────────────
// buildPartialResult
// ─────────────────────────────────────────────

describe('buildPartialResult', () => {
  it('returns a valid PartialResult shape', () => {
    const result = buildPartialResult(
      new Error('Timeout'),
      ['load_deal', 'parse_offer'],
      'calculate_utility'
    );
    expect(result.isPartial).toBe(true);
    expect(result.completedSteps).toEqual(['load_deal', 'parse_offer']);
    expect(result.failedStep).toBe('calculate_utility');
    expect(result.errorCategory).toBe('llm_timeout');
    expect(result.fallbackResponse.length).toBeGreaterThan(0);
    expect(result.decision).toBeNull();
  });

  it('includes decision when provided', () => {
    const decision = { action: 'COUNTER', utilityScore: 0.62 };
    const result = buildPartialResult(
      new Error('LLM failed'),
      ['load_deal', 'parse_offer', 'calculate_utility', 'decide'],
      'generate_response',
      decision
    );
    expect(result.decision).toEqual(decision);
    expect(result.failedStep).toBe('generate_response');
  });

  it('uses decision-based response when decision is available', () => {
    const decision = { action: 'ACCEPT', utilityScore: 0.85 };
    const result = buildPartialResult(
      new Error('LLM timeout'),
      ['load_deal', 'parse_offer', 'calculate_utility', 'decide'],
      'generate_response',
      decision
    );
    // Response should be about acceptance, not a generic error
    expect(result.fallbackResponse.toLowerCase()).toMatch(/accept|pleased|agreement/);
  });

  it('generates COUNTER response with price when counter-offer available', () => {
    const decision = {
      action: 'COUNTER',
      utilityScore: 0.62,
      counterOffer: { total_price: 42000, payment_terms: 'Net 60' },
    };
    const result = buildPartialResult(
      new Error('LLM timeout'),
      ['load_deal', 'parse_offer', 'decide'],
      'generate_response',
      decision
    );
    expect(result.fallbackResponse).toContain('42,000');
    expect(result.fallbackResponse).toContain('Net 60');
  });

  it('generates ESCALATE response from decision', () => {
    const decision = { action: 'ESCALATE', utilityScore: 0.35 };
    const result = buildPartialResult(
      new Error('LLM error'),
      ['load_deal', 'parse_offer', 'decide'],
      'generate_response',
      decision
    );
    expect(result.fallbackResponse.toLowerCase()).toMatch(/senior|team|follow up/);
  });

  it('generates WALK_AWAY response from decision', () => {
    const decision = { action: 'WALK_AWAY', utilityScore: 0.15 };
    const result = buildPartialResult(
      new Error('LLM error'),
      ['load_deal', 'parse_offer', 'decide'],
      'generate_response',
      decision
    );
    expect(result.fallbackResponse.toLowerCase()).toMatch(/unable|proceed|unfortunately/);
  });

  it('generates ASK_CLARIFY response from decision', () => {
    const decision = { action: 'ASK_CLARIFY', utilityScore: 0 };
    const result = buildPartialResult(
      new Error('LLM error'),
      ['load_deal', 'parse_offer', 'decide'],
      'generate_response',
      decision
    );
    expect(result.fallbackResponse.toLowerCase()).toMatch(/price|terms|provide/);
  });

  it('uses error template when no decision available', () => {
    const result = buildPartialResult(
      new Error('Database connection failed'),
      ['load_deal'],
      'load_messages'
    );
    expect(result.decision).toBeNull();
    expect(result.errorCategory).toBe('db_error');
    expect(result.fallbackResponse.toLowerCase()).toMatch(/temporary|system|issue/);
  });

  it('fallbackResponse never contains technical jargon', () => {
    const errors = [
      new Error('SequelizeConnectionError: ECONNREFUSED'),
      new Error('Request timed out after 5000ms'),
      new Error('Ollama model not loaded'),
      new Error('Something completely unknown'),
    ];

    for (const error of errors) {
      const result = buildPartialResult(error, ['load_deal'], 'parse_offer');
      const banned = ['sequelize', 'econnrefused', 'ollama', 'null', 'undefined', 'stack trace'];
      for (const term of banned) {
        expect(result.fallbackResponse.toLowerCase()).not.toContain(term);
      }
    }
  });
});
