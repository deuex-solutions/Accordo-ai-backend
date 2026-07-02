/**
 * Canonical pricing field names and dual-read helpers for the pricing refactor.
 *
 * Wizard fields store **total contract** values (not per-unit).
 * Canonical names: minTotalPrice / maxTotalPrice (wizard), min_total_price / max_total_price (engine).
 *
 * Legacy keys (targetUnitPrice, maxAcceptablePrice, target, max_acceptable) are read-only
 * for historical deals created before the refactor.
 */

/** Wizard / resolved-config camelCase keys */
export const WIZARD_PRICE_KEYS = {
  minTotalPrice: "minTotalPrice",
  maxTotalPrice: "maxTotalPrice",
} as const;

/** Parameter-weight key for minimum total price utility */
export const PRICE_WEIGHT_KEY = "minTotalPrice";

/** Legacy wizard keys (dual-read only — never written on new saves) */
export const LEGACY_WIZARD_PRICE_KEYS = {
  targetUnitPrice: "targetUnitPrice",
  maxAcceptablePrice: "maxAcceptablePrice",
} as const;

/** Engine total_price block snake_case keys */
export const ENGINE_TOTAL_PRICE_KEYS = {
  minTotalPrice: "min_total_price",
  maxTotalPrice: "max_total_price",
} as const;

/** Legacy engine keys (dual-read only) */
export const LEGACY_ENGINE_TOTAL_PRICE_KEYS = {
  target: "target",
  maxAcceptable: "max_acceptable",
} as const;

export interface WizardPriceQuantityFields {
  minTotalPrice?: number | null;
  maxTotalPrice?: number | null;
  /** @deprecated read-only legacy alias — per-unit when minTotalPrice absent */
  targetUnitPrice?: number | null;
  /** @deprecated read-only legacy alias — per-unit when maxTotalPrice absent */
  maxAcceptablePrice?: number | null;
  minOrderQuantity?: number | null;
  preferredQuantity?: number | null;
}

export interface EngineTotalPriceFields {
  anchor?: number;
  weight?: number;
  direction?: string;
  concession_step?: number;
  min_total_price?: number;
  max_total_price?: number;
  /** @deprecated read-only legacy alias */
  target?: number;
  /** @deprecated read-only legacy alias */
  max_acceptable?: number;
}

export interface ResolvedPriceFields {
  minTotalPrice: number;
  maxTotalPrice: number;
}

/** Order quantity for scaling legacy per-unit wizard prices to contract totals. */
export function readWizardOrderQuantity(
  priceQuantity: WizardPriceQuantityFields | null | undefined,
): number {
  if (!priceQuantity) return 1;
  const qty =
    priceQuantity.minOrderQuantity ??
    priceQuantity.preferredQuantity ??
    1;
  return Math.max(1, qty);
}

/** Read minimum total price from wizard priceQuantity (dual-read, scales legacy unit fields). */
export function readWizardMinTotalPrice(
  priceQuantity: WizardPriceQuantityFields | null | undefined,
): number | null | undefined {
  if (!priceQuantity) return undefined;
  if (priceQuantity.minTotalPrice != null) return priceQuantity.minTotalPrice;
  if (priceQuantity.targetUnitPrice != null) {
    return priceQuantity.targetUnitPrice * readWizardOrderQuantity(priceQuantity);
  }
  return undefined;
}

/** Read maximum total price from wizard priceQuantity (dual-read, scales legacy unit fields). */
export function readWizardMaxTotalPrice(
  priceQuantity: WizardPriceQuantityFields | null | undefined,
): number | null | undefined {
  if (!priceQuantity) return undefined;
  if (priceQuantity.maxTotalPrice != null) return priceQuantity.maxTotalPrice;
  if (priceQuantity.maxAcceptablePrice != null) {
    return priceQuantity.maxAcceptablePrice * readWizardOrderQuantity(priceQuantity);
  }
  if (priceQuantity.targetUnitPrice != null) {
    return priceQuantity.targetUnitPrice * readWizardOrderQuantity(priceQuantity) * 1.25;
  }
  return undefined;
}

/** Read minimum total from engine total_price block (dual-read). */
export function readEngineMinTotalPrice(
  block: EngineTotalPriceFields | null | undefined,
  fallback = 0,
): number {
  if (!block) return fallback;
  return block.min_total_price ?? block.target ?? fallback;
}

/** Read maximum total from engine total_price block (dual-read). */
export function readEngineMaxTotalPrice(
  block: EngineTotalPriceFields | null | undefined,
  fallback = 0,
): number {
  if (!block) return fallback;
  return block.max_total_price ?? block.max_acceptable ?? fallback;
}

/** Resolve total_price block from NegotiationConfig.parameters. */
export function resolveEngineTotalPriceBlock(
  parameters: {
    total_price?: EngineTotalPriceFields;
    /** @deprecated read-only legacy block */
    unit_price?: EngineTotalPriceFields;
  } | null | undefined,
): EngineTotalPriceFields | undefined {
  const totalBlock = parameters?.total_price;
  if (totalBlock) return totalBlock;
  const legacyBlock = parameters?.unit_price;
  if (!legacyBlock) return undefined;
  return {
    ...legacyBlock,
    min_total_price: legacyBlock.min_total_price ?? legacyBlock.target,
    max_total_price: legacyBlock.max_total_price ?? legacyBlock.max_acceptable,
  };
}

/** Build resolved price fields (canonical only). */
export function buildResolvedPriceFields(
  minTotalPrice: number,
  maxTotalPrice: number,
): ResolvedPriceFields {
  return { minTotalPrice, maxTotalPrice };
}

export interface RfqPriceBoundsInput {
  minTotalPrice?: number | null;
  maxTotalPrice?: number | null;
}

/**
 * Authoritative RFQ total band for wizard + engine.
 * 1) Requisition.minTotalPrice / maxTotalPrice
 * 2) Sum of line-item totals when RFQ fields absent
 */
export function resolveRfqTotalPriceBounds(
  requisition: RfqPriceBoundsInput,
  computedFromProducts?: RfqPriceBoundsInput,
): { minTotalPrice: number | null; maxTotalPrice: number | null } {
  const rfqMin = requisition.minTotalPrice;
  const rfqMax = requisition.maxTotalPrice;
  if (
    rfqMin != null &&
    rfqMax != null &&
    Number.isFinite(rfqMin) &&
    Number.isFinite(rfqMax) &&
    rfqMin > 0 &&
    rfqMax >= rfqMin
  ) {
    return { minTotalPrice: rfqMin, maxTotalPrice: rfqMax };
  }

  const prodMin = computedFromProducts?.minTotalPrice;
  const prodMax = computedFromProducts?.maxTotalPrice;
  if (prodMin != null && Number.isFinite(prodMin) && prodMin > 0) {
    const max =
      prodMax != null && Number.isFinite(prodMax) && prodMax >= prodMin
        ? prodMax
        : Math.round(prodMin * 1.2 * 100) / 100;
    return { minTotalPrice: prodMin, maxTotalPrice: max };
  }

  return { minTotalPrice: null, maxTotalPrice: null };
}

export interface RequisitionProductPriceRow {
  qty?: number | null;
  minUnitPrice?: number | null;
  maxUnitPrice?: number | null;
  /** @deprecated legacy column — not on current model */
  targetPrice?: number | null;
  /** @deprecated legacy column */
  maximum_price?: number | null;
}

/**
 * Sum qty × unit prices across RFQ line items (matches ProductDetails UI).
 */
export function sumRequisitionProductTotals(
  products: RequisitionProductPriceRow[] | null | undefined,
): {
  minTotalPrice: number | null;
  maxTotalPrice: number | null;
  totalQuantity: number | null;
} {
  if (!products?.length) {
    return { minTotalPrice: null, maxTotalPrice: null, totalQuantity: null };
  }

  let minTotal = 0;
  let maxTotal = 0;
  let totalQty = 0;
  let hasMin = false;
  let hasMax = false;

  for (const row of products) {
    const qty = row.qty ?? 0;
    if (qty <= 0) continue;

    totalQty += qty;
    const minUnit = row.minUnitPrice ?? row.targetPrice;
    const maxUnit = row.maxUnitPrice ?? row.maximum_price;

    if (minUnit != null && Number.isFinite(minUnit) && minUnit > 0) {
      minTotal += minUnit * qty;
      hasMin = true;
    }
    if (maxUnit != null && Number.isFinite(maxUnit) && maxUnit > 0) {
      maxTotal += maxUnit * qty;
      hasMax = true;
    }
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    minTotalPrice: hasMin ? round(minTotal) : null,
    maxTotalPrice: hasMax ? round(maxTotal) : null,
    totalQuantity: totalQty > 0 ? totalQty : null,
  };
}

/**
 * Resolve RFQ band: header totals → product sums → null.
 * Rejects header values that look like per-unit prices when product sums are larger.
 */
export function resolveRfqTotalPriceBoundsWithProducts(
  requisition: RfqPriceBoundsInput,
  products: RequisitionProductPriceRow[] | null | undefined,
): { minTotalPrice: number | null; maxTotalPrice: number | null } {
  const fromProducts = sumRequisitionProductTotals(products);
  const headerBounds = resolveRfqTotalPriceBounds(requisition, fromProducts);

  const headerMin = requisition.minTotalPrice;
  const headerMax = requisition.maxTotalPrice;
  const productMin = fromProducts.minTotalPrice;
  const productMax = fromProducts.maxTotalPrice;

  const headerLooksLikeUnitPrice =
    headerMin != null &&
    productMin != null &&
    headerMin > 0 &&
    productMin > headerMin * 10;

  if (headerLooksLikeUnitPrice && productMin != null) {
    return {
      minTotalPrice: productMin,
      maxTotalPrice:
        productMax != null && productMax >= productMin
          ? productMax
          : headerMax != null && headerMax > productMin
            ? headerMax
            : Math.round(productMin * 1.2 * 100) / 100,
    };
  }

  return headerBounds;
}

/** Normalize parameter weight map: legacy targetUnitPrice → minTotalPrice (read path). */
export function normalizePriceWeightKey(weights: Record<string, number>): Record<string, number> {
  const normalized = { ...weights };
  if (
    normalized[PRICE_WEIGHT_KEY] == null &&
    normalized[LEGACY_WIZARD_PRICE_KEYS.targetUnitPrice] != null
  ) {
    normalized[PRICE_WEIGHT_KEY] = normalized[LEGACY_WIZARD_PRICE_KEYS.targetUnitPrice];
  }
  return normalized;
}

/** Read price utility weight (dual-read). */
export function readPriceWeight(weights: Record<string, number>, fallback = 40): number {
  const normalized = normalizePriceWeightKey(weights);
  return normalized[PRICE_WEIGHT_KEY] ?? fallback;
}

/** Write canonical engine total_price keys only. */
export function writeEngineTotalPriceFields(
  minTotalPrice: number,
  maxTotalPrice: number,
  extras: {
    weight: number;
    direction: string;
    anchor: number;
    concession_step: number;
  },
): {
  weight: number;
  direction: string;
  anchor: number;
  concession_step: number;
  min_total_price: number;
  max_total_price: number;
} {
  return {
    ...extras,
    min_total_price: minTotalPrice,
    max_total_price: maxTotalPrice,
  };
}

/** @deprecated read-only — map legacy weight id to canonical */
export function normalizeParameterWeightId(parameterId: string): string {
  return parameterId === LEGACY_WIZARD_PRICE_KEYS.targetUnitPrice
    ? PRICE_WEIGHT_KEY
    : parameterId;
}
