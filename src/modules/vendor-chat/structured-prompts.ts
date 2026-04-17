/**
 * Structured Prompt Templates (vendor-chat)
 *
 * Deterministic message templates + helpers for the two new structured
 * interaction flows:
 *
 *   1. Initial discount ask (Round 1 AI PM message)
 *   2. Payment terms dropdown ask (when vendor sends price without terms)
 *
 * These bypass the negotiation engine/LLM entirely — the backend crafts the
 * message from a fixed pool of variations and attaches a `pendingPrompt`
 * marker to the ACCORDO message so the frontend can switch its composer into
 * the matching structured-input mode.
 */

import { formatCurrency, type SupportedCurrency } from '../../services/currency.service.js';

// ============================================================================
// Shared types
// ============================================================================

export type StructuredPromptType = 'discount_percent' | 'payment_terms';

export interface DiscountPendingPrompt {
  type: 'discount_percent';
  discount: {
    originalTotal: number;
    currency: SupportedCurrency;
  };
}

export interface PaymentTermsPendingPrompt {
  type: 'payment_terms';
  paymentTerms: {
    presets: number[]; // [0, 30, 60, 90]
  };
}

export type PendingPrompt = DiscountPendingPrompt | PaymentTermsPendingPrompt;

// ============================================================================
// Random helper
// ============================================================================

function pickRandom<T>(variations: readonly T[]): T {
  return variations[Math.floor(Math.random() * variations.length)];
}

// ============================================================================
// Feature 1 — Initial discount
// ============================================================================

/**
 * Build the Round-1 AI PM message asking the vendor for an initial discount.
 * Two-line structure: acknowledgement of the quote total, then a polite ask
 * with soft framing. Randomised across 3 variations to avoid feeling canned.
 */
export function buildInitialDiscountPromptMessage(
  grandTotal: number,
  currency: SupportedCurrency
): { content: string; pendingPrompt: DiscountPendingPrompt } {
  const totalText = formatCurrency(grandTotal, currency);
  const variations = [
    `Thank you for your quotation of ${totalText}.\n` +
      `Before we discuss further, would you be willing to offer an initial discount on this total? Even a small concession would help us move forward quickly.`,

    `Thanks for sharing your quotation of ${totalText}.\n` +
      `As a first step, could you offer us an initial discount on this total? Any goodwill gesture on your side would go a long way in finalizing this deal.`,

    `We've received your quotation of ${totalText} — thank you.\n` +
      `Before we dive into the details, would you consider offering an initial discount as a gesture of partnership? It would really help us align quickly.`,
  ];
  return {
    content: pickRandom(variations),
    pendingPrompt: {
      type: 'discount_percent',
      discount: { originalTotal: grandTotal, currency },
    },
  };
}

/**
 * Build the vendor's chat bubble text for a submitted discount percentage.
 * - 0%: one of two "no discount" phrasings, picked at random.
 * - >0%: one of three positive phrasings, picked at random.
 */
export function buildVendorDiscountBubble(percent: number): string {
  if (percent === 0) {
    const zero = [
      `I would like to keep the current offer as it is.`,
      `I am unable to offer an initial discount at this time.`,
    ];
    return pickRandom(zero);
  }
  const positive = [
    `I am willing to offer ${percent}% discount.`,
    `I can offer a ${percent}% discount on the total.`,
    `How about a ${percent}% discount on my quotation?`,
  ];
  return pickRandom(positive);
}

/**
 * Build the PM's Round-3 acknowledgement line that is prepended to the
 * engine's normal output (counter/accept/walk-away text) after the vendor
 * submits their discount.
 */
export function buildDiscountAcknowledgement(
  percent: number,
  originalTotal: number,
  discountedTotal: number,
  currency: SupportedCurrency
): string {
  if (percent === 0) {
    return `Thank you — we'll work with the current offer of ${formatCurrency(originalTotal, currency)}. `;
  }
  return `Thank you for offering a ${percent}% discount — that brings your offer to ${formatCurrency(discountedTotal, currency)}. `;
}

// ============================================================================
// Feature 2 — Payment terms dropdown
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
    `Great — one more thing. What payment terms work best for you?`,
    `Noted on the price. Please select the payment terms you can offer.`,
  ];
  return {
    content: pickRandom(variations),
    pendingPrompt: {
      type: 'payment_terms',
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
  if (days === 0) return 'Immediate';
  return `Net ${days}`;
}
