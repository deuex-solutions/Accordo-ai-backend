/**
 * Offer Accumulator Module
 *
 * Merges partial vendor offers across multiple messages.
 * Tracks which components have been provided and when.
 * Marks offers as complete when both price AND terms are present.
 *
 * @module offerAccumulator
 */

import type { Offer } from './types.js';
import type { AccumulatedOffer, OfferComponent } from './types.js';

/**
 * Merge a new partial offer with previously accumulated state
 *
 * @param accumulated - Previously accumulated offer (or null for first message)
 * @param current - Newly extracted offer from current message
 * @param messageId - ID of the current message for audit trail
 * @returns Merged accumulated offer
 *
 * @example
 * ```typescript
 * // First message: "37000"
 * const offer1 = mergeOffers(null, { total_price: 37000, payment_terms: null }, 'msg-1');
 * // offer1.isComplete = false (missing terms)
 *
 * // Second message: "Net 30"
 * const offer2 = mergeOffers(offer1, { total_price: null, payment_terms: 'Net 30' }, 'msg-2');
 * // offer2.isComplete = true (has price AND terms)
 * ```
 */
export function mergeOffers(
  accumulated: AccumulatedOffer | null,
  current: Offer,
  messageId: string
): AccumulatedOffer {
  const now = new Date();

  // Start with previous accumulated values or empty state.
  // Defensive: if `accumulated` is a plain Offer (no `accumulation` block)
  // — e.g. legacy data written by an earlier code path — treat the values
  // as-is but synthesise a fresh `accumulation` wrapper so downstream reads
  // don't crash.
  const base: AccumulatedOffer = accumulated
    ? {
        ...accumulated,
        accumulation: accumulated.accumulation ?? {
          priceUpdatedAt: accumulated.total_price !== null ? now : null,
          termsUpdatedAt: accumulated.payment_terms !== null ? now : null,
          deliveryUpdatedAt:
            accumulated.delivery_date !== null || accumulated.delivery_days !== null
              ? now
              : null,
          sourceMessageIds: [],
          isComplete:
            accumulated.total_price !== null && accumulated.payment_terms !== null,
        },
      }
    : {
        total_price: null,
        payment_terms: null,
        payment_terms_days: null,
        delivery_date: null,
        delivery_days: null,
        meta: {},
        accumulation: {
          priceUpdatedAt: null,
          termsUpdatedAt: null,
          deliveryUpdatedAt: null,
          sourceMessageIds: [],
          isComplete: false,
        },
      };

  // Track this message in the audit trail
  const sourceMessageIds = [...base.accumulation.sourceMessageIds, messageId];

  // Merge price - latest value always wins
  let priceUpdatedAt = base.accumulation.priceUpdatedAt;
  if (current.total_price !== null) {
    base.total_price = current.total_price;
    priceUpdatedAt = now;
  }

  // Merge payment terms - latest value always wins
  let termsUpdatedAt = base.accumulation.termsUpdatedAt;
  if (current.payment_terms !== null) {
    base.payment_terms = current.payment_terms;
    base.payment_terms_days = current.payment_terms_days ?? null;
    termsUpdatedAt = now;
  }

  // Merge delivery - latest value always wins
  let deliveryUpdatedAt = base.accumulation.deliveryUpdatedAt;
  if (current.delivery_date !== null || current.delivery_days !== null) {
    base.delivery_date = current.delivery_date ?? base.delivery_date;
    base.delivery_days = current.delivery_days ?? base.delivery_days;
    deliveryUpdatedAt = now;
  }

  // Merge meta information
  if (current.meta) {
    base.meta = {
      ...base.meta,
      ...current.meta,
    };
  }

  // Check completeness: price AND terms required (delivery optional)
  const isComplete = base.total_price !== null && base.payment_terms !== null;

  return {
    ...base,
    accumulation: {
      priceUpdatedAt,
      termsUpdatedAt,
      deliveryUpdatedAt,
      sourceMessageIds,
      isComplete,
    },
  };
}

/**
 * Get list of missing offer components
 *
 * @param offer - Offer to check
 * @returns Array of missing component names
 *
 * @example
 * ```typescript
 * const missing = getMissingComponents({ total_price: 37000, payment_terms: null });
 * // missing = ['payment terms']
 * ```
 */
export function getMissingComponents(offer: Offer | AccumulatedOffer | null): OfferComponent[] {
  const missing: OfferComponent[] = [];

  if (!offer) {
    return ['price', 'payment terms'];
  }

  if (offer.total_price === null) {
    missing.push('price');
  }

  if (offer.payment_terms === null) {
    missing.push('payment terms');
  }

  return missing;
}

/**
 * Get list of components provided in the current extraction
 *
 * @param current - Currently extracted offer
 * @returns Array of provided component descriptions
 *
 * @example
 * ```typescript
 * const provided = getProvidedComponents({ total_price: 37000, payment_terms: null });
 * // provided = ['$37,000']
 * ```
 */
export function getProvidedComponents(current: Offer): string[] {
  const provided: string[] = [];

  if (current.total_price !== null) {
    provided.push(`$${current.total_price.toLocaleString()}`);
  }

  if (current.payment_terms !== null) {
    provided.push(current.payment_terms);
  }

  if (current.delivery_date !== null) {
    provided.push(`delivery by ${current.delivery_date}`);
  } else if (current.delivery_days !== null) {
    provided.push(`delivery in ${current.delivery_days} days`);
  }

  return provided;
}

/**
 * Check if an offer is complete (has required components)
 *
 * @param offer - Offer to check
 * @returns True if offer has price AND terms
 */
export function isOfferComplete(offer: Offer | AccumulatedOffer | null): boolean {
  if (!offer) return false;
  return offer.total_price !== null && offer.payment_terms !== null;
}

/**
 * Check if an offer is an AccumulatedOffer with accumulation data
 */
export function isAccumulatedOffer(offer: Offer | AccumulatedOffer | null): offer is AccumulatedOffer {
  return offer !== null && 'accumulation' in offer;
}

/**
 * Create a fresh accumulated offer from a standard offer
 * Used when a vendor provides a complete new offer that should reset accumulation
 *
 * @param offer - Standard offer to convert
 * @param messageId - Message ID for audit trail
 * @returns New accumulated offer
 */
export function createAccumulatedOffer(offer: Offer, messageId: string): AccumulatedOffer {
  const now = new Date();

  return {
    ...offer,
    accumulation: {
      priceUpdatedAt: offer.total_price !== null ? now : null,
      termsUpdatedAt: offer.payment_terms !== null ? now : null,
      deliveryUpdatedAt: (offer.delivery_date !== null || offer.delivery_days !== null) ? now : null,
      sourceMessageIds: [messageId],
      isComplete: offer.total_price !== null && offer.payment_terms !== null,
    },
  };
}

/**
 * Determine if we should reset accumulation based on current extraction
 *
 * If vendor provides a complete offer (price AND terms), we start fresh
 * to avoid confusing old partial state with new complete offer.
 *
 * @param current - Currently extracted offer
 * @returns True if accumulation should reset
 */
export function shouldResetAccumulation(current: Offer): boolean {
  // Reset if vendor provides both price AND terms in single message
  return current.total_price !== null && current.payment_terms !== null;
}

export default {
  mergeOffers,
  getMissingComponents,
  getProvidedComponents,
  isOfferComplete,
  isAccumulatedOffer,
  createAccumulatedOffer,
  shouldResetAccumulation,
};
