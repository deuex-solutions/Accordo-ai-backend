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

import logger from "../config/logger.js";
import type {
  NegotiationAction,
  VendorTone,
} from "../negotiation/intent/build-negotiation-intent.js";

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

  // ── Humanization metrics (Apr 2026) ─────────────────────────────────────
  // Health targets (monitor in dashboards):
  //   • fallbackRate (1 - fromLlm)            target: < 15%
  //   • validationFailureReason distribution  target: no single rule > 50%
  //   • messageWordCount per action           target: COUNTER/MESO 25–80,
  //                                                    REJECT 20–60,
  //                                                    ACCEPT  8–40,
  //                                                    ASK     10–40
  //   • escapeHatchApplied                    target: < 5% of turns
  //
  // No PII / strategy data is logged — only structural signals and rule codes.

  /** Subset of detected vendor-style signals (no message text). */
  vendorStyle?: {
    formality: number;
    language: string;
    languageConfidence: number;
    hostility: boolean;
    hasQuestion: boolean;
    repeatedOfferCount: number;
    acceptanceDetected: boolean;
  };
  /** Which validation rule fired ("banned_keyword_hard", "too_long", etc.). Never the rejected text. */
  validationFailureReason?: string;
  /** Repeat-offer escape-hatch mode applied this turn, if any. */
  escapeHatchApplied?: "accept" | "ceiling-meso" | "post-meso-walk" | null;
  /** Length distribution signal — final word count of the message that went to vendor. */
  messageWordCount?: number;
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
  logger.info("negotiation_step", {
    event: "negotiation_step",
    action: record.action,
    firmness: record.firmness,
    round: record.round,
    ...(record.counterPrice != null
      ? { counterPrice: record.counterPrice }
      : {}),
    vendorTone: record.vendorTone,
    dealId: record.dealId,
    fromLlm: record.fromLlm ?? null,
    ...(record.vendorStyle ? { vendorStyle: record.vendorStyle } : {}),
    ...(record.validationFailureReason
      ? { validationFailureReason: record.validationFailureReason }
      : {}),
    ...(record.escapeHatchApplied
      ? { escapeHatchApplied: record.escapeHatchApplied }
      : {}),
    ...(record.messageWordCount != null
      ? { messageWordCount: record.messageWordCount }
      : {}),
  });
}
