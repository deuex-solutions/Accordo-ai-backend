/**
 * Negotiation State Machine
 *
 * Formalizes deal lifecycle with explicit states, valid transitions,
 * and guards. All state changes in the negotiation flow go through
 * this module instead of ad-hoc status assignments.
 *
 * States: NEGOTIATING → ACCEPTED | WALKED_AWAY | ESCALATED
 * Reverse: ESCALATED → NEGOTIATING (resume only)
 *
 * @module negotiationStateMachine
 */

import logger from '../../../config/logger.js';

/**
 * Valid deal states
 */
export type DealState = 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';

/**
 * Events that trigger state transitions
 */
export type TransitionEvent =
  | 'ACCEPT'          // Vendor's offer accepted
  | 'WALK_AWAY'       // PM walks away from the deal
  | 'ESCALATE'        // Deal needs human review
  | 'COUNTER'         // Counter-offer (stays NEGOTIATING)
  | 'ASK_CLARIFY'     // Ask for clarification (stays NEGOTIATING)
  | 'RESUME'          // Resume an escalated deal
  | 'MAX_ROUNDS'      // Max rounds reached (auto-escalate)
  | 'REDIRECT';       // Off-topic redirect (stays NEGOTIATING)

/**
 * Terminal states — no further negotiation allowed
 */
export const TERMINAL_STATES: ReadonlySet<DealState> = new Set([
  'ACCEPTED',
  'WALKED_AWAY',
]);

/**
 * States that allow further action
 */
export const ACTIVE_STATES: ReadonlySet<DealState> = new Set([
  'NEGOTIATING',
  'ESCALATED',
]);

/**
 * Transition result
 */
export interface TransitionResult {
  /** Whether the transition is valid */
  valid: boolean;
  /** The new state after transition (same as current if invalid) */
  newState: DealState;
  /** Reason for invalid transition */
  reason?: string;
}

/**
 * Valid transitions map: from state → event → to state
 */
const TRANSITIONS: Record<DealState, Partial<Record<TransitionEvent, DealState>>> = {
  NEGOTIATING: {
    ACCEPT: 'ACCEPTED',
    WALK_AWAY: 'WALKED_AWAY',
    ESCALATE: 'ESCALATED',
    COUNTER: 'NEGOTIATING',
    ASK_CLARIFY: 'NEGOTIATING',
    MAX_ROUNDS: 'ESCALATED',
    REDIRECT: 'NEGOTIATING',
  },
  ESCALATED: {
    RESUME: 'NEGOTIATING',
  },
  ACCEPTED: {
    // Terminal — no transitions allowed
  },
  WALKED_AWAY: {
    // Terminal — no transitions allowed
  },
};

/**
 * Attempt a state transition.
 *
 * Returns whether the transition is valid and the resulting state.
 * Never throws — invalid transitions return `{ valid: false }`.
 *
 * @param currentState - The deal's current state
 * @param event - The event triggering the transition
 * @returns TransitionResult with validity and new state
 */
export function transition(currentState: DealState, event: TransitionEvent): TransitionResult {
  const stateTransitions = TRANSITIONS[currentState];
  const newState = stateTransitions?.[event];

  if (newState === undefined) {
    const reason = TERMINAL_STATES.has(currentState)
      ? `Deal is in terminal state '${currentState}' — no further transitions allowed`
      : `Event '${event}' is not valid from state '${currentState}'`;

    logger.warn('[StateMachine] Invalid transition attempted', {
      currentState,
      event,
      reason,
    });

    return {
      valid: false,
      newState: currentState,
      reason,
    };
  }

  logger.info('[StateMachine] State transition', {
    from: currentState,
    event,
    to: newState,
  });

  return {
    valid: true,
    newState,
  };
}

/**
 * Check if a transition is valid without executing it
 */
export function canTransition(currentState: DealState, event: TransitionEvent): boolean {
  return TRANSITIONS[currentState]?.[event] !== undefined;
}

/**
 * Check if a deal is in a terminal state
 */
export function isTerminal(state: DealState): boolean {
  return TERMINAL_STATES.has(state);
}

/**
 * Check if a deal is active (can receive messages)
 */
export function isActive(state: DealState): boolean {
  return state === 'NEGOTIATING';
}

/**
 * Get all valid events for a given state
 */
export function getValidEvents(state: DealState): TransitionEvent[] {
  const stateTransitions = TRANSITIONS[state];
  return Object.keys(stateTransitions || {}) as TransitionEvent[];
}

/**
 * Map a decision action to a transition event
 */
export function actionToEvent(action: string): TransitionEvent {
  const mapping: Record<string, TransitionEvent> = {
    ACCEPT: 'ACCEPT',
    COUNTER: 'COUNTER',
    WALK_AWAY: 'WALK_AWAY',
    ESCALATE: 'ESCALATE',
    ASK_CLARIFY: 'ASK_CLARIFY',
    REDIRECT: 'REDIRECT',
    ERROR_RECOVERY: 'COUNTER', // Error recovery keeps deal in NEGOTIATING
  };

  return mapping[action] || 'COUNTER';
}

/**
 * Get the target state for a decision action without transitioning.
 * Useful for preview or planning.
 */
export function getTargetState(currentState: DealState, action: string): DealState {
  const event = actionToEvent(action);
  const result = transition(currentState, event);
  return result.newState;
}
