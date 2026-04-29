/**
 * Simulate Typing Delay
 *
 * Adds a human-like delay before delivering Accordo's response.
 * The delay simulates realistic typing/thinking time based on action complexity.
 *
 * Delay ranges (server-side):
 *   COUNTER    → 6–12 seconds  (complex — reviewing and calculating)
 *   MESO       → 8–15 seconds  (complex — preparing multiple options)
 *   ACCEPT     → 3–6 seconds   (positive — quick but not instant)
 *   WALK_AWAY  → 2–4 seconds   (brief — concluded)
 *   ESCALATE   → 4–8 seconds   (moderate — needs to check with team)
 *   ASK_CLARIFY → 2–4 seconds  (quick — just asking a question)
 *   default    → 3–6 seconds
 *
 * Also returns delayMs so the frontend can show a typing indicator
 * for the exact duration of the server delay.
 */

import type { NegotiationAction } from "../negotiation/intent/build-negotiation-intent.js";

// ─────────────────────────────────────────────
// Delay ranges in milliseconds
// ─────────────────────────────────────────────

const DELAY_RANGES: Record<NegotiationAction, [number, number]> = {
  COUNTER: [6000, 12000],
  MESO: [8000, 15000],
  ACCEPT: [3000, 6000],
  WALK_AWAY: [2000, 4000],
  ESCALATE: [4000, 8000],
  ASK_CLARIFY: [2000, 4000],
};

const DEFAULT_RANGE: [number, number] = [3000, 6000];

// ─────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────

export interface TypingDelayResult {
  /** The actual delay that was applied (in milliseconds) */
  delayMs: number;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Returns a random integer in [min, max] inclusive.
 */
function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────

/**
 * Wait for a human-like delay appropriate to the negotiation action.
 *
 * Call this AFTER generating the response and BEFORE sending it to the client.
 * The returned delayMs should be included in the API response so the frontend
 * knows how long to show the typing indicator.
 *
 * @param action - The negotiation action (COUNTER, ACCEPT, etc.)
 * @returns TypingDelayResult with the delay that was applied
 *
 * @example
 * const { delayMs } = await simulateTypingDelay('COUNTER');
 * // delayMs is between 6000–12000
 * return { ...response, delayMs };
 */
export async function simulateTypingDelay(
  action: NegotiationAction,
  options: {
    /** Word count of Accordo's reply — longer messages get longer delays. */
    outputWordCount?: number;
    /** Word count of vendor's incoming message — longer/complex messages need more "reading" time. */
    vendorMessageWordCount?: number;
  } = {},
): Promise<TypingDelayResult> {
  const [baseMin, baseMax] = DELAY_RANGES[action] ?? DEFAULT_RANGE;
  let min = baseMin;
  let max = baseMax;

  // Complexity scaling (Apr 2026 humanization).
  // Real humans read longer vendor messages and type longer replies.
  // We scale within ±35% of the base range, clamped so quick acks stay quick
  // and complex counters don't run away.
  const out = options.outputWordCount ?? 0;
  const inn = options.vendorMessageWordCount ?? 0;
  if (out > 0 || inn > 0) {
    // Output words contribute ~120ms each; input words ~80ms each.
    const outBoost = Math.min(out * 120, 4500);
    const inBoost = Math.min(inn * 80, 3000);
    const totalBoost = outBoost + inBoost;
    // Apply boost only to the upper end so short replies still feel snappy.
    max = Math.min(max + totalBoost, baseMax + 7500);
    // For brief acknowledgments we tighten the floor slightly so it feels reactive.
    if (out > 0 && out <= 12) {
      min = Math.max(Math.round(baseMin * 0.5), 1500);
    }
  }

  if (min > max) min = max;
  const delayMs = randomInRange(min, max);
  await sleep(delayMs);
  return { delayMs };
}

/**
 * Get the expected delay range for a given action (without waiting).
 * Useful for the frontend to know the maximum wait time upfront.
 */
export function getDelayRange(action: NegotiationAction): {
  min: number;
  max: number;
} {
  const [min, max] = DELAY_RANGES[action] ?? DEFAULT_RANGE;
  return { min, max };
}
