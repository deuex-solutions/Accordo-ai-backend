/**
 * Negotiation Step Logger
 *
 * Logs a structured, lightweight audit record for each negotiation turn.
 *
 * Rules:
 * - Writes to the existing Winston logger (no new infrastructure).
 * - Logs ONLY: action, firmness, round, counterPrice, vendorTone, dealId.
 * - NEVER logs: LLM prompts, LLM responses, utility scores, weights, thresholds,
 *   vendor messages, or any PII.
 *
 * Output example (JSON):
 * {
 *   "level": "info",
 *   "event": "negotiation_step",
 *   "action": "COUNTER",
 *   "firmness": 0.55,
 *   "round": 3,
 *   "counterPrice": 98000,
 *   "vendorTone": "formal",
 *   "dealId": "uuid",
 *   "timestamp": "2026-02-27T..."
 * }
 */

import logger from '../config/logger.js';
import type { NegotiationAction, VendorTone } from '../negotiation/intent/build-negotiation-intent.js';

// ─────────────────────────────────────────────
// Step record type
// ─────────────────────────────────────────────

export interface NegotiationStepRecord {
  /** The action taken this round */
  action: NegotiationAction;
  /** Firmness level (0–1) derived from utility */
  firmness: number;
  /** Current negotiation round number */
  round: number;
  /** Counter price (only present for COUNTER and MESO actions) */
  counterPrice?: number;
  /** Detected vendor tone */
  vendorTone: VendorTone;
  /** Deal identifier */
  dealId: string;
  /** Whether the LLM was used or a fallback template was served */
  fromLlm?: boolean;
}

// ─────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────

/**
 * Log a single negotiation step for audit and monitoring purposes.
 *
 * This function is synchronous — no await needed.
 * It writes to Winston's combined log file via the existing logger.
 *
 * @example
 * logNegotiationStep({
 *   action: 'COUNTER',
 *   firmness: 0.55,
 *   round: 3,
 *   counterPrice: 98000,
 *   vendorTone: 'formal',
 *   dealId: 'abc-123',
 *   fromLlm: true,
 * });
 */
export function logNegotiationStep(record: NegotiationStepRecord): void {
  logger.info('negotiation_step', {
    event: 'negotiation_step',
    action: record.action,
    firmness: record.firmness,
    round: record.round,
    ...(record.counterPrice != null ? { counterPrice: record.counterPrice } : {}),
    vendorTone: record.vendorTone,
    dealId: record.dealId,
    fromLlm: record.fromLlm ?? null,
  });
}
