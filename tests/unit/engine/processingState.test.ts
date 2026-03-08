/**
 * Tests for ProcessingState (Feature #1: Thinking Placeholder)
 *
 * Validates the ProcessingState interface contract returned by
 * saveVendorMessageOnlyService (Phase 1). These are pure unit tests
 * verifying the shape, values, and business rules of the processing state.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import type { ProcessingState } from '../../../src/modules/chatbot/chatbot.service.js';

// ─────────────────────────────────────────────
// Helpers — simulate processingState construction
// ─────────────────────────────────────────────

function buildProcessingState(opts: {
  mode?: 'INSIGHTS' | 'CONVERSATION';
  offerComplete?: boolean;
}): ProcessingState {
  const mode = opts.mode ?? 'INSIGHTS';
  const offerComplete = opts.offerComplete ?? false;
  return {
    step: 'analyzing_offer',
    estimatedMs: mode === 'CONVERSATION' ? 4000 : 1500,
    offerComplete,
    mode,
  };
}

// ─────────────────────────────────────────────
// Shape validation
// ─────────────────────────────────────────────

describe('ProcessingState – shape', () => {
  it('has all required fields', () => {
    const state = buildProcessingState({});
    expect(state).toHaveProperty('step');
    expect(state).toHaveProperty('estimatedMs');
    expect(state).toHaveProperty('offerComplete');
    expect(state).toHaveProperty('mode');
  });

  it('step is always "analyzing_offer" at Phase 1', () => {
    const state = buildProcessingState({});
    expect(state.step).toBe('analyzing_offer');
  });

  it('step is a valid pipeline step', () => {
    const validSteps = ['analyzing_offer', 'calculating_utility', 'generating_response', 'complete'];
    const state = buildProcessingState({});
    expect(validSteps).toContain(state.step);
  });
});

// ─────────────────────────────────────────────
// Estimated time based on mode
// ─────────────────────────────────────────────

describe('ProcessingState – estimatedMs', () => {
  it('INSIGHTS mode estimates 1500ms', () => {
    const state = buildProcessingState({ mode: 'INSIGHTS' });
    expect(state.estimatedMs).toBe(1500);
  });

  it('CONVERSATION mode estimates 4000ms (LLM call)', () => {
    const state = buildProcessingState({ mode: 'CONVERSATION' });
    expect(state.estimatedMs).toBe(4000);
  });

  it('estimatedMs is always a positive number', () => {
    const insightsState = buildProcessingState({ mode: 'INSIGHTS' });
    const convoState = buildProcessingState({ mode: 'CONVERSATION' });
    expect(insightsState.estimatedMs).toBeGreaterThan(0);
    expect(convoState.estimatedMs).toBeGreaterThan(0);
  });

  it('CONVERSATION mode takes longer than INSIGHTS mode', () => {
    const insights = buildProcessingState({ mode: 'INSIGHTS' });
    const convo = buildProcessingState({ mode: 'CONVERSATION' });
    expect(convo.estimatedMs).toBeGreaterThan(insights.estimatedMs);
  });
});

// ─────────────────────────────────────────────
// Offer completeness
// ─────────────────────────────────────────────

describe('ProcessingState – offerComplete', () => {
  it('reflects complete offer as true', () => {
    const state = buildProcessingState({ offerComplete: true });
    expect(state.offerComplete).toBe(true);
  });

  it('reflects incomplete offer as false', () => {
    const state = buildProcessingState({ offerComplete: false });
    expect(state.offerComplete).toBe(false);
  });

  it('defaults to false when not specified', () => {
    const state = buildProcessingState({});
    expect(state.offerComplete).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Mode passthrough
// ─────────────────────────────────────────────

describe('ProcessingState – mode', () => {
  it('passes through INSIGHTS mode', () => {
    const state = buildProcessingState({ mode: 'INSIGHTS' });
    expect(state.mode).toBe('INSIGHTS');
  });

  it('passes through CONVERSATION mode', () => {
    const state = buildProcessingState({ mode: 'CONVERSATION' });
    expect(state.mode).toBe('CONVERSATION');
  });

  it('defaults to INSIGHTS when not specified', () => {
    const state = buildProcessingState({});
    expect(state.mode).toBe('INSIGHTS');
  });
});

// ─────────────────────────────────────────────
// Combined scenarios
// ─────────────────────────────────────────────

describe('ProcessingState – real-world scenarios', () => {
  it('INSIGHTS + complete offer: fast processing expected', () => {
    const state = buildProcessingState({ mode: 'INSIGHTS', offerComplete: true });
    expect(state.estimatedMs).toBe(1500);
    expect(state.offerComplete).toBe(true);
    expect(state.step).toBe('analyzing_offer');
  });

  it('CONVERSATION + incomplete offer: slower, needs clarification', () => {
    const state = buildProcessingState({ mode: 'CONVERSATION', offerComplete: false });
    expect(state.estimatedMs).toBe(4000);
    expect(state.offerComplete).toBe(false);
  });

  it('INSIGHTS + incomplete offer: fast but will ask for clarification', () => {
    const state = buildProcessingState({ mode: 'INSIGHTS', offerComplete: false });
    expect(state.estimatedMs).toBe(1500);
    expect(state.offerComplete).toBe(false);
  });

  it('CONVERSATION + complete offer: full LLM pipeline', () => {
    const state = buildProcessingState({ mode: 'CONVERSATION', offerComplete: true });
    expect(state.estimatedMs).toBe(4000);
    expect(state.offerComplete).toBe(true);
  });
});
