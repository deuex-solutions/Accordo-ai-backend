/**
 * Tests for simulateTypingDelay.ts
 *
 * Validates delay ranges per action, getDelayRange helper,
 * return type, and graceful handling of unknown actions.
 * simulateTypingDelay itself is tested with a fast vi.useFakeTimers()
 * approach so tests stay milliseconds fast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { simulateTypingDelay, getDelayRange } from '../../../src/delivery/simulate-typing-delay.js';
import type { NegotiationAction } from '../../../src/negotiation/intent/build-negotiation-intent.js';

// ─────────────────────────────────────────────
// Expected ranges (mirrors the implementation)
// ─────────────────────────────────────────────

const EXPECTED_RANGES: Record<NegotiationAction, [number, number]> = {
  COUNTER:     [6000,  12000],
  MESO:        [8000,  15000],
  ACCEPT:      [3000,   6000],
  WALK_AWAY:   [2000,   4000],
  ESCALATE:    [4000,   8000],
  ASK_CLARIFY: [2000,   4000],
};

// ─────────────────────────────────────────────
// getDelayRange — synchronous helper
// ─────────────────────────────────────────────

describe('getDelayRange', () => {
  const actions = Object.keys(EXPECTED_RANGES) as NegotiationAction[];

  for (const action of actions) {
    const [min, max] = EXPECTED_RANGES[action];

    it(`returns correct min for ${action}`, () => {
      expect(getDelayRange(action).min).toBe(min);
    });

    it(`returns correct max for ${action}`, () => {
      expect(getDelayRange(action).max).toBe(max);
    });

    it(`min is less than max for ${action}`, () => {
      const range = getDelayRange(action);
      expect(range.min).toBeLessThan(range.max);
    });
  }

  it('returns default range [3000, 6000] for unknown action', () => {
    const range = getDelayRange('UNKNOWN_ACTION' as NegotiationAction);
    expect(range.min).toBe(3000);
    expect(range.max).toBe(6000);
  });

  it('MESO has the longest possible delay (max 15000)', () => {
    const meso = getDelayRange('MESO');
    const allMaxes = Object.keys(EXPECTED_RANGES).map(a => getDelayRange(a as NegotiationAction).max);
    expect(meso.max).toBe(Math.max(...allMaxes));
  });

  it('WALK_AWAY and ASK_CLARIFY have the shortest delay range', () => {
    const walkAway = getDelayRange('WALK_AWAY');
    const askClarify = getDelayRange('ASK_CLARIFY');
    expect(walkAway.max).toBe(4000);
    expect(askClarify.max).toBe(4000);
  });

  it('COUNTER delay range is longer than ACCEPT (more complex decision)', () => {
    const counter = getDelayRange('COUNTER');
    const accept = getDelayRange('ACCEPT');
    expect(counter.max).toBeGreaterThan(accept.max);
  });

  it('MESO delay range is longer than COUNTER (most complex)', () => {
    const meso = getDelayRange('MESO');
    const counter = getDelayRange('COUNTER');
    expect(meso.min).toBeGreaterThanOrEqual(counter.min);
    expect(meso.max).toBeGreaterThan(counter.max);
  });
});

// ─────────────────────────────────────────────
// simulateTypingDelay — returns delayMs within range
// Uses fake timers so tests run fast
// ─────────────────────────────────────────────

describe('simulateTypingDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: run the async function while advancing fake timers
  async function runWithFakeTimer(action: NegotiationAction) {
    const promise = simulateTypingDelay(action);
    // Advance by the maximum possible delay for this action to ensure resolution
    const { max } = getDelayRange(action);
    vi.advanceTimersByTime(max + 1000);
    return promise;
  }

  it('resolves for COUNTER action', async () => {
    const result = await runWithFakeTimer('COUNTER');
    expect(result).toBeDefined();
    expect(typeof result.delayMs).toBe('number');
  });

  it('resolves for MESO action', async () => {
    const result = await runWithFakeTimer('MESO');
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('resolves for ACCEPT action', async () => {
    const result = await runWithFakeTimer('ACCEPT');
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('resolves for WALK_AWAY action', async () => {
    const result = await runWithFakeTimer('WALK_AWAY');
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('resolves for ESCALATE action', async () => {
    const result = await runWithFakeTimer('ESCALATE');
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('resolves for ASK_CLARIFY action', async () => {
    const result = await runWithFakeTimer('ASK_CLARIFY');
    expect(result.delayMs).toBeGreaterThan(0);
  });

  it('returns delayMs within [min, max] range for COUNTER', async () => {
    const result = await runWithFakeTimer('COUNTER');
    const { min, max } = getDelayRange('COUNTER');
    expect(result.delayMs).toBeGreaterThanOrEqual(min);
    expect(result.delayMs).toBeLessThanOrEqual(max);
  });

  it('returns delayMs within [min, max] range for ACCEPT', async () => {
    const result = await runWithFakeTimer('ACCEPT');
    const { min, max } = getDelayRange('ACCEPT');
    expect(result.delayMs).toBeGreaterThanOrEqual(min);
    expect(result.delayMs).toBeLessThanOrEqual(max);
  });

  it('returns delayMs within [min, max] range for WALK_AWAY', async () => {
    const result = await runWithFakeTimer('WALK_AWAY');
    const { min, max } = getDelayRange('WALK_AWAY');
    expect(result.delayMs).toBeGreaterThanOrEqual(min);
    expect(result.delayMs).toBeLessThanOrEqual(max);
  });

  it('returns delayMs within [min, max] range for ESCALATE', async () => {
    const result = await runWithFakeTimer('ESCALATE');
    const { min, max } = getDelayRange('ESCALATE');
    expect(result.delayMs).toBeGreaterThanOrEqual(min);
    expect(result.delayMs).toBeLessThanOrEqual(max);
  });

  it('returns delayMs within [min, max] range for ASK_CLARIFY', async () => {
    const result = await runWithFakeTimer('ASK_CLARIFY');
    const { min, max } = getDelayRange('ASK_CLARIFY');
    expect(result.delayMs).toBeGreaterThanOrEqual(min);
    expect(result.delayMs).toBeLessThanOrEqual(max);
  });

  it('returns delayMs as an integer (whole milliseconds)', async () => {
    const result = await runWithFakeTimer('COUNTER');
    expect(Number.isInteger(result.delayMs)).toBe(true);
  });

  it('resolves for unknown action (uses default range)', async () => {
    const result = await runWithFakeTimer('UNKNOWN_ACTION' as NegotiationAction);
    expect(result.delayMs).toBeGreaterThanOrEqual(3000);
    expect(result.delayMs).toBeLessThanOrEqual(6000);
  });

  it('TypingDelayResult has only the delayMs field', async () => {
    const result = await runWithFakeTimer('ACCEPT');
    const keys = Object.keys(result);
    expect(keys).toEqual(['delayMs']);
  });
});

// ─────────────────────────────────────────────
// Delay ordering — confirms human-feel hierarchy
// ─────────────────────────────────────────────

describe('getDelayRange – semantic hierarchy', () => {
  it('MESO max > COUNTER max (preparing options takes longest)', () => {
    expect(getDelayRange('MESO').max).toBeGreaterThan(getDelayRange('COUNTER').max);
  });

  it('COUNTER min > ACCEPT min (countering is harder than accepting)', () => {
    expect(getDelayRange('COUNTER').min).toBeGreaterThan(getDelayRange('ACCEPT').min);
  });

  it('ESCALATE max > ACCEPT max (escalation needs thought)', () => {
    expect(getDelayRange('ESCALATE').max).toBeGreaterThan(getDelayRange('ACCEPT').max);
  });

  it('WALK_AWAY max <= ASK_CLARIFY max (both are quick/brief)', () => {
    expect(getDelayRange('WALK_AWAY').max).toBeLessThanOrEqual(getDelayRange('ASK_CLARIFY').max + 1);
  });

  it('all delays are positive numbers', () => {
    const actions = Object.keys(EXPECTED_RANGES) as NegotiationAction[];
    for (const action of actions) {
      const { min, max } = getDelayRange(action);
      expect(min).toBeGreaterThan(0);
      expect(max).toBeGreaterThan(0);
    }
  });

  it('no delay minimum is below 2 seconds (prevents instant-feeling responses)', () => {
    const actions = Object.keys(EXPECTED_RANGES) as NegotiationAction[];
    for (const action of actions) {
      expect(getDelayRange(action).min).toBeGreaterThanOrEqual(2000);
    }
  });

  it('no delay maximum exceeds 15 seconds (prevents unacceptable waits)', () => {
    const actions = Object.keys(EXPECTED_RANGES) as NegotiationAction[];
    for (const action of actions) {
      expect(getDelayRange(action).max).toBeLessThanOrEqual(15000);
    }
  });
});
