/**
 * Single source of truth for deal commercial display context (P0).
 * Currency always comes from the linked RFQ requisition when present.
 */

import { CustomError } from "../../../utils/custom-error.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import models from "../../../models/index.js";
import { getCurrencySymbol } from "../../../negotiation/intent/build-negotiation-intent.js";

export type DealPriceLocale = "en-IN" | "en-US";

export interface DealCommercialContext {
  /** ISO currency code from RFQ (e.g. INR, USD) */
  currencyCode: string;
  currencySymbol: string;
  priceLocale: DealPriceLocale;
}

type DealWithRequisition = ChatbotDeal & {
  Requisition?: { typeOfCurrency?: string | null };
};

const SUPPORTED_CURRENCIES = new Set(["USD", "INR", "EUR", "GBP", "AUD"]);

function normalizeCurrencyCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(code)) {
    throw new CustomError(`Unsupported currency code: ${raw}`, 400);
  }
  return code;
}

function currencyFromRequisitionInclude(deal: ChatbotDeal): string | null {
  const value = (deal as DealWithRequisition).Requisition?.typeOfCurrency;
  return value ? normalizeCurrencyCode(value as string) : null;
}

function currencyFromStoredConfig(deal: ChatbotDeal): string | null {
  const stored = deal.negotiationConfigJson as { currency?: string } | null;
  return stored?.currency ? normalizeCurrencyCode(stored.currency) : null;
}

function buildCommercialContext(currencyCode: string): DealCommercialContext {
  return {
    currencyCode,
    currencySymbol: getCurrencySymbol(currencyCode),
    priceLocale: currencyCode === "INR" ? "en-IN" : "en-US",
  };
}

/**
 * Resolve RFQ currency synchronously when deal was loaded with Requisition include.
 * Deals with requisitionId but no include must use resolveRfqCurrencyCode().
 */
export function resolveRfqCurrencyCodeSync(deal: ChatbotDeal): string {
  const fromInclude = currencyFromRequisitionInclude(deal);
  if (fromInclude) return fromInclude;

  if (deal.requisitionId) {
    throw new CustomError(
      "Requisition currency required: load deal with Requisition include or use resolveRfqCurrencyCode()",
      500,
    );
  }

  const stored = currencyFromStoredConfig(deal);
  if (stored) return stored;

  throw new CustomError(
    "Deal currency cannot be resolved: link a requisition with typeOfCurrency or set negotiationConfigJson.currency",
    400,
  );
}

/**
 * Resolve RFQ currency — requisition.typeOfCurrency is authoritative when requisitionId exists.
 */
export async function resolveRfqCurrencyCode(deal: ChatbotDeal): Promise<string> {
  const fromInclude = currencyFromRequisitionInclude(deal);
  if (fromInclude) return fromInclude;

  if (deal.requisitionId) {
    const req = await models.Requisition.findByPk(deal.requisitionId, {
      attributes: ["typeOfCurrency"],
    });
    if (req?.typeOfCurrency) {
      return normalizeCurrencyCode(req.typeOfCurrency as string);
    }
    throw new CustomError(
      `Requisition ${deal.requisitionId} has no typeOfCurrency`,
      400,
    );
  }

  const stored = currencyFromStoredConfig(deal);
  if (stored) return stored;

  throw new CustomError(
    "Deal currency cannot be resolved: link a requisition with typeOfCurrency or set negotiationConfigJson.currency",
    400,
  );
}

export async function resolveDealCommercialContext(
  deal: ChatbotDeal,
): Promise<DealCommercialContext> {
  const currencyCode = await resolveRfqCurrencyCode(deal);
  return buildCommercialContext(currencyCode);
}
