/**
 * Load deal state and build classification context for runAgentTurn() (P0.2).
 */

import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import {
  buildDealClassificationContext,
  type DealClassificationContext,
} from "./message-classifier.js";
import {
  getPriceBoundariesFromDeal,
  resolvePriceBoundariesForDeal,
} from "./load-negotiation-config-from-deal.js";
import { resolveRfqCurrencyCodeSync } from "./deal-commercial-context.js";

/**
 * Resolve price band context from RFQ requisition totals, then deal config.
 */
export async function buildClassificationContextFromDealAsync(
  deal: ChatbotDeal,
): Promise<DealClassificationContext> {
  const boundaries = await resolvePriceBoundariesForDeal(deal);
  const minTotalPrice = boundaries.minTotalPrice ?? 0;
  const maxTotalPrice =
    boundaries.maxTotalPrice ?? Math.max(minTotalPrice * 1.25, minTotalPrice);

  return buildDealClassificationContext(minTotalPrice, maxTotalPrice, {
    round: deal.round,
    productName: deal.title ?? undefined,
    currencyCode: boundaries.currency,
  });
}

/**
 * @deprecated Prefer buildClassificationContextFromDealAsync when requisition may be omitted from include.
 */
export function buildClassificationContextFromDeal(
  deal: ChatbotDeal,
): DealClassificationContext {
  let currencyCode: string | undefined;
  try {
    currencyCode = resolveRfqCurrencyCodeSync(deal);
  } catch {
    currencyCode = undefined;
  }

  const boundaries = getPriceBoundariesFromDeal(deal, currencyCode);
  const minTotalPrice = boundaries.minTotalPrice ?? 0;
  const maxTotalPrice =
    boundaries.maxTotalPrice ?? Math.max(minTotalPrice * 1.25, minTotalPrice);

  return buildDealClassificationContext(minTotalPrice, maxTotalPrice, {
    round: deal.round,
    productName: deal.title ?? undefined,
    currencyCode,
  });
}
