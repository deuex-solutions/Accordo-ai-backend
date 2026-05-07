/**
 * Tests for negotiationStateMachine.ts (Feature #12: Negotiation State Machine)
 *
 * Validates state transitions, guards, terminal states,
 * and action mapping for the negotiation lifecycle.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  transition,
  canTransition,
  isTerminal,
  isActive,
  getValidEvents,
  actionToEvent,
  getTargetState,
  TERMINAL_STATES,
  ACTIVE_STATES,
  type DealState,
  type TransitionEvent,
} from '../../../src/modules/chatbot/engine/negotiation-state-machine.js';

// ─────────────────────────────────────────────
// Valid transitions from NEGOTIATING
// ─────────────────────────────────────────────

describe('transition – from NEGOTIATING', () => {
  it('ACCEPT → ACCEPTED', () => {
    const result = transition('NEGOTIATING', 'ACCEPT');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('ACCEPTED');
  });

  it('WALK_AWAY → WALKED_AWAY', () => {
    const result = transition('NEGOTIATING', 'WALK_AWAY');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('WALKED_AWAY');
  });

  it('ESCALATE → ESCALATED', () => {
    const result = transition('NEGOTIATING', 'ESCALATE');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('ESCALATED');
  });

  it('COUNTER → NEGOTIATING (stays)', () => {
    const result = transition('NEGOTIATING', 'COUNTER');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('ASK_CLARIFY → NEGOTIATING (stays)', () => {
    const result = transition('NEGOTIATING', 'ASK_CLARIFY');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('MAX_ROUNDS → ESCALATED', () => {
    const result = transition('NEGOTIATING', 'MAX_ROUNDS');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('ESCALATED');
  });

  it('REDIRECT → NEGOTIATING (stays)', () => {
    const result = transition('NEGOTIATING', 'REDIRECT');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('RESUME is invalid from NEGOTIATING', () => {
    const result = transition('NEGOTIATING', 'RESUME');
    expect(result.valid).toBe(false);
    expect(result.newState).toBe('NEGOTIATING');
    expect(result.reason).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// Valid transitions from ESCALATED
// ─────────────────────────────────────────────

describe('transition – from ESCALATED', () => {
  it('RESUME → NEGOTIATING', () => {
    const result = transition('ESCALATED', 'RESUME');
    expect(result.valid).toBe(true);
    expect(result.newState).toBe('NEGOTIATING');
  });

  it('COUNTER is invalid from ESCALATED', () => {
    const result = transition('ESCALATED', 'COUNTER');
    expect(result.valid).toBe(false);
    expect(result.newState).toBe('ESCALATED');
  });

  it('ACCEPT is invalid from ESCALATED', () => {
    const result = transition('ESCALATED', 'ACCEPT');
    expect(result.valid).toBe(false);
    expect(result.newState).toBe('ESCALATED');
  });

  it('WALK_AWAY is invalid from ESCALATED', () => {
    const result = transition('ESCALATED', 'WALK_AWAY');
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Terminal states — no transitions allowed
// ─────────────────────────────────────────────

describe('transition – from terminal states', () => {
  const terminalStates: DealState[] = ['ACCEPTED', 'WALKED_AWAY'];
  const allEvents: TransitionEvent[] = [
    'ACCEPT', 'WALK_AWAY', 'ESCALATE', 'COUNTER',
    'ASK_CLARIFY', 'RESUME', 'MAX_ROUNDS', 'REDIRECT',
  ];

  for (const state of terminalStates) {
    for (const event of allEvents) {
      it(`${state} + ${event} → invalid`, () => {
        const result = transition(state, event);
        expect(result.valid).toBe(false);
        expect(result.newState).toBe(state);
        expect(result.reason).toContain('terminal');
      });
    }
  }
});

// ─────────────────────────────────────────────
// canTransition
// ─────────────────────────────────────────────

describe('canTransition', () => {
  it('returns true for valid transitions', () => {
    expect(canTransition('NEGOTIATING', 'ACCEPT')).toBe(true);
    expect(canTransition('NEGOTIATING', 'COUNTER')).toBe(true);
    expect(canTransition('NEGOTIATING', 'ESCALATE')).toBe(true);
    expect(canTransition('ESCALATED', 'RESUME')).toBe(true);
  });

  it('returns false for invalid transitions', () => {
    expect(canTransition('ACCEPTED', 'COUNTER')).toBe(false);
    expect(canTransition('WALKED_AWAY', 'ACCEPT')).toBe(false);
    expect(canTransition('NEGOTIATING', 'RESUME')).toBe(false);
    expect(canTransition('ESCALATED', 'COUNTER')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isTerminal
// ─────────────────────────────────────────────

describe('isTerminal', () => {
  it('ACCEPTED is terminal', () => {
    expect(isTerminal('ACCEPTED')).toBe(true);
  });

  it('WALKED_AWAY is terminal', () => {
    expect(isTerminal('WALKED_AWAY')).toBe(true);
  });

  it('NEGOTIATING is not terminal', () => {
    expect(isTerminal('NEGOTIATING')).toBe(false);
  });

  it('ESCALATED is not terminal', () => {
    expect(isTerminal('ESCALATED')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// isActive
// ─────────────────────────────────────────────

describe('isActive', () => {
  it('NEGOTIATING is active', () => {
    expect(isActive('NEGOTIATING')).toBe(true);
  });

  it('ACCEPTED is not active', () => {
    expect(isActive('ACCEPTED')).toBe(false);
  });

  it('WALKED_AWAY is not active', () => {
    expect(isActive('WALKED_AWAY')).toBe(false);
  });

  it('ESCALATED is not active', () => {
    expect(isActive('ESCALATED')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// getValidEvents
// ─────────────────────────────────────────────

describe('getValidEvents', () => {
  it('NEGOTIATING has 7 valid events', () => {
    const events = getValidEvents('NEGOTIATING');
    expect(events).toContain('ACCEPT');
    expect(events).toContain('COUNTER');
    expect(events).toContain('WALK_AWAY');
    expect(events).toContain('ESCALATE');
    expect(events).toContain('ASK_CLARIFY');
    expect(events).toContain('MAX_ROUNDS');
    expect(events).toContain('REDIRECT');
    expect(events).toHaveLength(7);
  });

  it('ESCALATED has 1 valid event (RESUME)', () => {
    const events = getValidEvents('ESCALATED');
    expect(events).toEqual(['RESUME']);
  });

  it('ACCEPTED has 0 valid events', () => {
    const events = getValidEvents('ACCEPTED');
    expect(events).toHaveLength(0);
  });

  it('WALKED_AWAY has 0 valid events', () => {
    const events = getValidEvents('WALKED_AWAY');
    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// actionToEvent mapping
// ─────────────────────────────────────────────

describe('actionToEvent', () => {
  it('maps ACCEPT to ACCEPT', () => {
    expect(actionToEvent('ACCEPT')).toBe('ACCEPT');
  });

  it('maps COUNTER to COUNTER', () => {
    expect(actionToEvent('COUNTER')).toBe('COUNTER');
  });

  it('maps WALK_AWAY to WALK_AWAY', () => {
    expect(actionToEvent('WALK_AWAY')).toBe('WALK_AWAY');
  });

  it('maps ESCALATE to ESCALATE', () => {
    expect(actionToEvent('ESCALATE')).toBe('ESCALATE');
  });

  it('maps ASK_CLARIFY to ASK_CLARIFY', () => {
    expect(actionToEvent('ASK_CLARIFY')).toBe('ASK_CLARIFY');
  });

  it('maps REDIRECT to REDIRECT', () => {
    expect(actionToEvent('REDIRECT')).toBe('REDIRECT');
  });

  it('maps ERROR_RECOVERY to COUNTER (keeps negotiating)', () => {
    expect(actionToEvent('ERROR_RECOVERY')).toBe('COUNTER');
  });

  it('maps unknown action to COUNTER (safe default)', () => {
    expect(actionToEvent('SOME_UNKNOWN')).toBe('COUNTER');
  });
});

// ─────────────────────────────────────────────
// getTargetState
// ─────────────────────────────────────────────

describe('getTargetState', () => {
  it('ACCEPT from NEGOTIATING → ACCEPTED', () => {
    expect(getTargetState('NEGOTIATING', 'ACCEPT')).toBe('ACCEPTED');
  });

  it('COUNTER from NEGOTIATING → NEGOTIATING', () => {
    expect(getTargetState('NEGOTIATING', 'COUNTER')).toBe('NEGOTIATING');
  });

  it('WALK_AWAY from NEGOTIATING → WALKED_AWAY', () => {
    expect(getTargetState('NEGOTIATING', 'WALK_AWAY')).toBe('WALKED_AWAY');
  });

  it('COUNTER from ACCEPTED → ACCEPTED (invalid, no change)', () => {
    expect(getTargetState('ACCEPTED', 'COUNTER')).toBe('ACCEPTED');
  });

  it('ERROR_RECOVERY from NEGOTIATING → NEGOTIATING', () => {
    expect(getTargetState('NEGOTIATING', 'ERROR_RECOVERY')).toBe('NEGOTIATING');
  });
});

// ─────────────────────────────────────────────
// TERMINAL_STATES and ACTIVE_STATES sets
// ─────────────────────────────────────────────

describe('State sets', () => {
  it('TERMINAL_STATES contains ACCEPTED and WALKED_AWAY', () => {
    expect(TERMINAL_STATES.has('ACCEPTED')).toBe(true);
    expect(TERMINAL_STATES.has('WALKED_AWAY')).toBe(true);
  });

  it('TERMINAL_STATES does NOT contain NEGOTIATING or ESCALATED', () => {
    expect(TERMINAL_STATES.has('NEGOTIATING')).toBe(false);
    expect(TERMINAL_STATES.has('ESCALATED')).toBe(false);
  });

  it('ACTIVE_STATES contains NEGOTIATING and ESCALATED', () => {
    expect(ACTIVE_STATES.has('NEGOTIATING')).toBe(true);
    expect(ACTIVE_STATES.has('ESCALATED')).toBe(true);
  });

  it('ACTIVE_STATES does NOT contain terminal states', () => {
    expect(ACTIVE_STATES.has('ACCEPTED')).toBe(false);
    expect(ACTIVE_STATES.has('WALKED_AWAY')).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Full lifecycle scenarios
// ─────────────────────────────────────────────

describe('Full lifecycle scenarios', () => {
  it('typical successful negotiation: COUNTER → COUNTER → ACCEPT', () => {
    let state: DealState = 'NEGOTIATING';

    const r1 = transition(state, 'COUNTER');
    expect(r1.valid).toBe(true);
    state = r1.newState;
    expect(state).toBe('NEGOTIATING');

    const r2 = transition(state, 'COUNTER');
    expect(r2.valid).toBe(true);
    state = r2.newState;
    expect(state).toBe('NEGOTIATING');

    const r3 = transition(state, 'ACCEPT');
    expect(r3.valid).toBe(true);
    state = r3.newState;
    expect(state).toBe('ACCEPTED');

    // No further transitions possible
    expect(transition(state, 'COUNTER').valid).toBe(false);
  });

  it('escalation and resume: COUNTER → ESCALATE → RESUME → ACCEPT', () => {
    let state: DealState = 'NEGOTIATING';

    state = transition(state, 'COUNTER').newState;
    expect(state).toBe('NEGOTIATING');

    state = transition(state, 'ESCALATE').newState;
    expect(state).toBe('ESCALATED');

    // Can't negotiate while escalated
    expect(transition(state, 'COUNTER').valid).toBe(false);

    // Resume
    state = transition(state, 'RESUME').newState;
    expect(state).toBe('NEGOTIATING');

    // Now can accept
    state = transition(state, 'ACCEPT').newState;
    expect(state).toBe('ACCEPTED');
  });

  it('walk away path: COUNTER → WALK_AWAY', () => {
    let state: DealState = 'NEGOTIATING';

    state = transition(state, 'COUNTER').newState;
    state = transition(state, 'WALK_AWAY').newState;
    expect(state).toBe('WALKED_AWAY');

    // No further transitions
    expect(transition(state, 'RESUME').valid).toBe(false);
    expect(transition(state, 'COUNTER').valid).toBe(false);
  });

  it('max rounds auto-escalation: COUNTER × N → MAX_ROUNDS', () => {
    let state: DealState = 'NEGOTIATING';

    for (let i = 0; i < 5; i++) {
      state = transition(state, 'COUNTER').newState;
      expect(state).toBe('NEGOTIATING');
    }

    state = transition(state, 'MAX_ROUNDS').newState;
    expect(state).toBe('ESCALATED');
  });

  it('scope guard redirect does not change state', () => {
    let state: DealState = 'NEGOTIATING';

    state = transition(state, 'REDIRECT').newState;
    expect(state).toBe('NEGOTIATING');

    // Still can negotiate normally
    state = transition(state, 'COUNTER').newState;
    expect(state).toBe('NEGOTIATING');
  });

  it('ask clarify does not change state', () => {
    let state: DealState = 'NEGOTIATING';

    state = transition(state, 'ASK_CLARIFY').newState;
    expect(state).toBe('NEGOTIATING');

    state = transition(state, 'ASK_CLARIFY').newState;
    expect(state).toBe('NEGOTIATING');

    state = transition(state, 'ACCEPT').newState;
    expect(state).toBe('ACCEPTED');
  });
});
