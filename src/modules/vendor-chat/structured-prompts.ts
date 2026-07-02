/**
 * Structured Prompt Templates (vendor-chat)
 *
 * Deterministic message templates + helpers for structured interaction flows.
 *
 *   Payment terms dropdown ask (when vendor sends price without terms)
 *
 * These bypass the negotiation engine/LLM entirely — the backend crafts the
 * message from a fixed pool of variations and attaches a `pendingPrompt`
 * marker to the ACCORDO message so the frontend can switch its composer into
 * the matching structured-input mode.
 */

import { sanitizeText } from "../../llm/validate-llm-output.js";

// ============================================================================
// Shared types
// ============================================================================

export type StructuredPromptType = "payment_terms";

export interface PaymentTermsPendingPrompt {
  type: "payment_terms";
  paymentTerms: {
    presets: number[]; // [0, 30, 60, 90]
  };
}

export type PendingPrompt = PaymentTermsPendingPrompt;

// ============================================================================
// Random helper
// ============================================================================

function pickRandom<T>(variations: readonly T[]): T {
  return variations[Math.floor(Math.random() * variations.length)];
}

// ============================================================================
// Payment terms dropdown
// ============================================================================

/**
 * Build the AI PM message asking for payment terms when the vendor's latest
 * offer has a price but no terms. Three variations picked at random.
 */
export function buildPaymentTermsPromptMessage(): {
  content: string;
  pendingPrompt: PaymentTermsPendingPrompt;
} {
  const variations = [
    `Thanks for the price. Could you share your preferred payment terms?`,
    `Great, one more thing. What payment terms work best for you?`,
    `Noted on the price. Please select the payment terms you can offer.`,
  ];
  return {
    content: sanitizeText(pickRandom(variations)),
    pendingPrompt: {
      type: "payment_terms",
      paymentTerms: { presets: [0, 30, 60, 90] },
    },
  };
}

/**
 * Build the vendor's chat bubble text for a submitted payment terms choice.
 * - 0 days  → "I can offer immediate payment."
 * - N days  → "My payment terms are Net N."
 */
export function buildVendorPaymentTermsBubble(days: number): string {
  if (days === 0) {
    return `I can offer immediate payment.`;
  }
  return `My payment terms are Net ${days}.`;
}

/**
 * Canonical label for a given day count — matches the phrasing used by the
 * offer-parser elsewhere in the codebase.
 */
export function formatPaymentTermsLabel(days: number): string {
  if (days === 0) return "Immediate";
  return `Net ${days}`;
}
