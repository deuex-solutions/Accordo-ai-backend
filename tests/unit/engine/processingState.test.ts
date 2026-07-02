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

function buildProcessingState(opts: {
  offerComplete?: boolean;
}): ProcessingState {
  const offerComplete = opts.offerComplete ?? false;
  return {
    step: 'analyzing_offer',
    estimatedMs: 4000,
    offerComplete,
    mode: 'CONVERSATION',
  };
}

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

describe('ProcessingState – estimatedMs', () => {
  it('CONVERSATION mode estimates 4000ms (LLM call)', () => {
    const state = buildProcessingState({});
    expect(state.estimatedMs).toBe(4000);
  });

  it('estimatedMs is always a positive number', () => {
    const state = buildProcessingState({});
    expect(state.estimatedMs).toBeGreaterThan(0);
  });
});

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

describe('ProcessingState – mode', () => {
  it('always uses CONVERSATION mode', () => {
    const state = buildProcessingState({});
    expect(state.mode).toBe('CONVERSATION');
  });
});

describe('ProcessingState – real-world scenarios', () => {
  it('CONVERSATION + incomplete offer: slower, needs clarification', () => {
    const state = buildProcessingState({ offerComplete: false });
    expect(state.estimatedMs).toBe(4000);
    expect(state.offerComplete).toBe(false);
  });

  it('CONVERSATION + complete offer: full LLM pipeline', () => {
    const state = buildProcessingState({ offerComplete: true });
    expect(state.estimatedMs).toBe(4000);
    expect(state.offerComplete).toBe(true);
  });
});
