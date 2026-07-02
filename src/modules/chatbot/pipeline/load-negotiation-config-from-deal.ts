/**
 * Load NegotiationConfig from deal.negotiationConfigJson (P0 pipeline).
 * @source convo/conversation-service.ts config loading
 */

import { CustomError } from "../../../utils/custom-error.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import { buildConfigFromRequisition } from "../chatbot.service.js";
import type { NegotiationConfig } from "../engine/utility.js";
import {
  buildResolvedPriceFields,
  readEngineMaxTotalPrice,
  readEngineMinTotalPrice,
  readWizardMaxTotalPrice,
  readWizardMinTotalPrice,
  resolveEngineTotalPriceBlock,
  writeEngineTotalPriceFields,
} from "../engine/pricing-field-keys.js";
import {
  resolveRfqCurrencyCode,
  resolveRfqCurrencyCodeSync,
} from "./deal-commercial-context.js";
import models from "../../../models/index.js";

export async function loadNegotiationConfigFromDeal(
  deal: ChatbotDeal,
): Promise<NegotiationConfig> {
  const currency = await resolveRfqCurrencyCode(deal);

  if (deal.negotiationConfigJson) {
    const stored = deal.negotiationConfigJson as NegotiationConfig & {
      wizardConfig?: unknown;
    };
    return {
      parameters: stored.parameters,
      accept_threshold: stored.accept_threshold,
      escalate_threshold: stored.escalate_threshold,
      walkaway_threshold: stored.walkaway_threshold,
      max_rounds: stored.max_rounds,
      priority: stored.priority,
      currency,
    };
  }

  if (deal.requisitionId) {
    const fromReq = await buildConfigFromRequisition(deal.requisitionId);
    return { ...fromReq, currency };
  }

  throw new CustomError(
    "Deal must have negotiationConfigJson or requisitionId",
    400,
  );
}

/** @deprecated Use resolveRfqCurrencyCode / resolveDealCommercialContext */
export async function resolveDealCurrencyAsync(
  deal: ChatbotDeal,
  _configCurrency?: string | null,
): Promise<string> {
  return resolveRfqCurrencyCode(deal);
}

/** @deprecated Use resolveRfqCurrencyCodeSync / resolveDealCommercialContext */
export function resolveDealCurrency(
  deal: ChatbotDeal,
  _configCurrency?: string | null,
): string {
  return resolveRfqCurrencyCodeSync(deal);
}

export function getPriceBoundariesFromDeal(
  deal: ChatbotDeal,
  resolvedCurrencyCode?: string,
): {
  minTotalPrice?: number;
  maxTotalPrice?: number;
  currency: string;
} {
  const currency =
    resolvedCurrencyCode ??
    (() => {
      try {
        return resolveRfqCurrencyCodeSync(deal);
      } catch {
        const stored = deal.negotiationConfigJson as { currency?: string } | null;
        return stored?.currency ?? "USD";
      }
    })();

  const rfqBounds = readRfqPriceBoundsFromDeal(deal);
  if (rfqBounds) {
    return { ...rfqBounds, currency };
  }

  const stored = deal.negotiationConfigJson as Record<string, unknown> | null;
  const wizard = stored?.wizardConfig as
    | {
        priceQuantity?: {
          minTotalPrice?: number;
          maxTotalPrice?: number;
          targetUnitPrice?: number;
          maxAcceptablePrice?: number;
          minOrderQuantity?: number;
          preferredQuantity?: number;
        };
      }
    | undefined;
  const totalPrice = stored?.parameters as
    | {
        total_price?: {
          min_total_price?: number;
          max_total_price?: number;
          target?: number;
          max_acceptable?: number;
        };
      }
    | undefined;

  const wizardMin = readWizardMinTotalPrice(wizard?.priceQuantity);
  const wizardMax = readWizardMaxTotalPrice(wizard?.priceQuantity);
  const engineMin =
    wizardMin ??
    (totalPrice?.total_price
      ? readEngineMinTotalPrice(totalPrice.total_price)
      : undefined);
  const engineMax =
    wizardMax ??
    (totalPrice?.total_price
      ? readEngineMaxTotalPrice(totalPrice.total_price)
      : undefined);

  const resolved =
    engineMin != null && engineMax != null
      ? buildResolvedPriceFields(engineMin, engineMax)
      : engineMin != null
        ? { minTotalPrice: engineMin }
        : engineMax != null
          ? { maxTotalPrice: engineMax }
          : {};

  return {
    ...resolved,
    currency,
  };
}

type DealWithRfq = ChatbotDeal & {
  Requisition?: {
    minTotalPrice?: number | null;
    maxTotalPrice?: number | null;
  };
};

/**
 * RFQ requisition minTotalPrice / maxTotalPrice are authoritative for price bands.
 */
export function readRfqPriceBoundsFromDeal(
  deal: ChatbotDeal,
): { minTotalPrice: number; maxTotalPrice: number } | null {
  const req = (deal as DealWithRfq).Requisition;
  if (!req) return null;

  const min = req.minTotalPrice;
  const max = req.maxTotalPrice;
  if (
    min == null ||
    max == null ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min <= 0 ||
    max < min
  ) {
    return null;
  }

  return { minTotalPrice: min, maxTotalPrice: max };
}

/**
 * Resolve price band — loads RFQ from DB when Requisition include is missing.
 */
export async function resolvePriceBoundariesForDeal(
  deal: ChatbotDeal,
): Promise<{
  minTotalPrice?: number;
  maxTotalPrice?: number;
  currency: string;
}> {
  const fromInclude = readRfqPriceBoundsFromDeal(deal);
  const currency = await resolveRfqCurrencyCode(deal);

  if (fromInclude) {
    return { ...fromInclude, currency };
  }

  if (deal.requisitionId) {
    const req = await models.Requisition.findByPk(deal.requisitionId, {
      attributes: ["minTotalPrice", "maxTotalPrice"],
    });
    if (
      req?.minTotalPrice != null &&
      req?.maxTotalPrice != null &&
      req.minTotalPrice > 0 &&
      req.maxTotalPrice >= req.minTotalPrice
    ) {
      return {
        minTotalPrice: req.minTotalPrice,
        maxTotalPrice: req.maxTotalPrice,
        currency,
      };
    }
  }

  return getPriceBoundariesFromDeal(deal, currency);
}

/**
 * Align engine utility/counter math with authoritative RFQ total bounds.
 * Stale wizard unit prices (e.g. 400/480) must not drive decideNextMove().
 */
export function applyRfqBoundsToNegotiationConfig(
  config: NegotiationConfig,
  minTotalPrice?: number,
  maxTotalPrice?: number,
): NegotiationConfig {
  if (
    minTotalPrice == null ||
    maxTotalPrice == null ||
    !Number.isFinite(minTotalPrice) ||
    !Number.isFinite(maxTotalPrice) ||
    minTotalPrice <= 0 ||
    maxTotalPrice < minTotalPrice
  ) {
    return config;
  }

  const parameters = { ...(config.parameters ?? {}) };
  const block = resolveEngineTotalPriceBlock(parameters);
  const total_price = writeEngineTotalPriceFields(minTotalPrice, maxTotalPrice, {
    weight: typeof block?.weight === "number" ? block.weight : 40,
    direction: typeof block?.direction === "string" ? block.direction : "decrease",
    anchor: minTotalPrice,
    concession_step:
      typeof block?.concession_step === "number" ? block.concession_step : 0.05,
  });

  return {
    ...config,
    parameters: {
      ...parameters,
      total_price,
    },
  };
}
