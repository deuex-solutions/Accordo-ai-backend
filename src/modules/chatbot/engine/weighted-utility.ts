/**
 * Weighted Utility Calculator
 *
 * Combines individual parameter utilities into a total weighted utility score.
 * Uses weights from Step 4 of the deal wizard to calculate the overall offer utility.
 *
 * Formula: Total Utility = Σ (Parameter_Utility × Parameter_Weight / 100)
 *
 * Thresholds (user-configurable):
 * - Accept: ≥70% (default)
 * - Counter: 50-70% (escalate zone to accept zone)
 * - Escalate: 30-50% (walk away zone to counter zone)
 * - Walk Away: <30% (default)
 */

import type {
  WeightedParameterConfig,
  ParameterUtilityResult,
  ThresholdConfig,
  WeightedUtilityResult,
  WeightedNegotiationConfig,
  ParsedVendorOffer,
  WizardConfig,
  ResolvedNegotiationConfig,
  ExtendedOffer,
} from "./types.js";
import {
  DEFAULT_THRESHOLDS,
  getRecommendationFromUtility,
  ACCORDO_DEFAULTS,
  DEFAULT_WEIGHTS,
  parseWarrantyPeriodToMonths,
} from "./types.js";
import {
  calculateParameterUtility,
  parsePaymentTermsDays,
  getDefaultParameterConfigs,
} from "./parameter-utility.js";

/**
 * Calculate weighted utility from parsed vendor offer and configuration
 */
export function calculateWeightedUtility(
  vendorOffer: ParsedVendorOffer,
  config: WeightedNegotiationConfig
): WeightedUtilityResult {
  const parameterUtilities: Record<string, ParameterUtilityResult> = {};
  let totalUtility = 0;
  let totalWeight = 0;

  // Calculate utility for each configured parameter
  for (const [paramId, paramConfig] of Object.entries(config.parameters)) {
    const value = extractValueFromOffer(vendorOffer, paramId);
    const utilityResult = calculateParameterUtility(value, paramConfig);

    parameterUtilities[paramId] = utilityResult;
    totalUtility += utilityResult.contribution;
    totalWeight += paramConfig.weight;
  }

  // Normalize if weights don't sum to 100
  // (This shouldn't happen if Step 4 validates properly, but handle it gracefully)
  // Guard against division by zero when totalWeight is 0
  //
  // CRITICAL FIX (Jan 2026): The contribution is already calculated as:
  //   contribution = utility * (weight / 100)
  // So totalUtility is already in 0-1 scale when weights sum to 100.
  // When weights don't sum to 100, we need to normalize by scaling proportionally.
  // The correct formula is: totalUtility * (100 / totalWeight)
  // This ensures the utility is scaled as if weights summed to 100.
  if (totalWeight === 0) {
    // No parameters configured or all have zero weight
    totalUtility = 0;
  } else if (totalWeight !== 100) {
    // Scale up the utility proportionally
    // e.g., if totalWeight=50 and totalUtility=0.4, result = 0.4 * (100/50) = 0.8
    // This is correct because we're treating the 50% of weights as the full picture
    totalUtility = totalUtility * (100 / totalWeight);
  }

  // Clamp total utility to [0, 1]
  totalUtility = Math.max(0, Math.min(1, totalUtility));

  const thresholds = config.thresholds || DEFAULT_THRESHOLDS;
  const { action, reason } = getRecommendationFromUtility(totalUtility, thresholds);

  return {
    totalUtility,
    totalUtilityPercent: totalUtility * 100,
    parameterUtilities,
    thresholds,
    recommendation: action,
    recommendationReason: reason,
  };
}

/**
 * Extract the appropriate value from a vendor offer for a given parameter ID
 */
export function extractValueFromOffer(
  offer: ParsedVendorOffer,
  paramId: string
): number | string | boolean | Date | null {
  switch (paramId) {
    case "unitPrice":
      return offer.unitPrice ?? null;
    case "totalPrice":
      return offer.totalPrice ?? null;
    case "volumeDiscount":
      return offer.volumeDiscount ?? null;
    case "paymentTermsDays":
      // Try to get days directly, or parse from string
      if (offer.paymentTermsDays !== undefined) {
        return offer.paymentTermsDays;
      }
      if (offer.paymentTerms) {
        return parsePaymentTermsDays(offer.paymentTerms);
      }
      return null;
    case "paymentTerms":
      return offer.paymentTerms ?? null;
    case "advancePayment":
      return offer.advancePayment ?? null;
    case "deliveryDate":
      return offer.deliveryDate ?? null;
    case "partialDelivery":
      return offer.partialDelivery ?? null;
    case "warrantyMonths":
      return offer.warrantyMonths ?? null;
    case "lateDeliveryPenalty":
      return offer.lateDeliveryPenalty ?? null;
    case "qualityCertifications":
      // For array values, check if any certifications exist
      return offer.qualityCertifications && offer.qualityCertifications.length > 0
        ? true
        : false;
    default:
      // Check custom parameters
      if (offer.customParameters && paramId in offer.customParameters) {
        return offer.customParameters[paramId];
      }
      return null;
  }
}

/**
 * Build weighted parameter configs from deal wizard form data
 * Combines Step 2 (Commercial) + Step 3 (Contract) data with Step 4 (Weights)
 */
export function buildWeightedConfig(
  step2Data: {
    targetUnitPrice?: number;
    maxAcceptablePrice?: number;
    paymentTermsMin?: number;
    paymentTermsMax?: number;
    deliveryDate?: string | Date;
    partialDelivery?: boolean;
  },
  step3Data: {
    warrantyPeriod?: number;
    lateDeliveryPenalty?: number;
    qualityStandards?: string[];
    maxRounds?: number;
    walkawayThreshold?: number;
    customParameters?: Array<{
      name: string;
      type: string;
      value: string | number | boolean;
      includeInNegotiation: boolean;
    }>;
  },
  step4Weights: Record<string, number>,
  thresholds?: ThresholdConfig
): WeightedNegotiationConfig {
  const defaults = getDefaultParameterConfigs();
  const parameters: Record<string, WeightedParameterConfig> = {};

  // Build unit price config
  if (step4Weights.unitPrice && step4Weights.unitPrice > 0) {
    parameters.unitPrice = {
      id: "unitPrice",
      ...defaults.unitPrice,
      weight: step4Weights.unitPrice,
      target: step2Data.targetUnitPrice ?? 0,
      max: step2Data.maxAcceptablePrice ?? step2Data.targetUnitPrice ?? 0,
    } as WeightedParameterConfig;
  }

  // Build payment terms config
  if (step4Weights.paymentTermsDays && step4Weights.paymentTermsDays > 0) {
    const termsOptions = ["Net 30", "Net 60", "Net 90"];
    const minDays = step2Data.paymentTermsMin ?? 30;
    const maxDays = step2Data.paymentTermsMax ?? 90;

    // Create utility mapping where longer terms are better for buyer
    const optionUtilities: Record<string, number> = {};
    for (const term of termsOptions) {
      const days = parsePaymentTermsDays(term) ?? 30;
      if (days <= minDays) {
        optionUtilities[term] = 0;
      } else if (days >= maxDays) {
        optionUtilities[term] = 1;
      } else {
        optionUtilities[term] = (days - minDays) / (maxDays - minDays);
      }
    }

    parameters.paymentTermsDays = {
      id: "paymentTermsDays",
      ...defaults.paymentTermsDays,
      weight: step4Weights.paymentTermsDays,
      target: maxDays,
      min: minDays,
      max: maxDays,
      options: termsOptions,
      optionUtilities,
    } as WeightedParameterConfig;
  }

  // Build delivery date config
  if (step4Weights.deliveryDate && step4Weights.deliveryDate > 0) {
    const targetDate = step2Data.deliveryDate
      ? new Date(step2Data.deliveryDate)
      : new Date();
    const maxDate = new Date(targetDate);
    maxDate.setDate(maxDate.getDate() + 30); // 30 days tolerance

    parameters.deliveryDate = {
      id: "deliveryDate",
      ...defaults.deliveryDate,
      weight: step4Weights.deliveryDate,
      target: targetDate.toISOString(),
      max: maxDate.toISOString(),
    } as WeightedParameterConfig;
  }

  // Build partial delivery config
  if (step4Weights.partialDelivery && step4Weights.partialDelivery > 0) {
    parameters.partialDelivery = {
      id: "partialDelivery",
      ...defaults.partialDelivery,
      weight: step4Weights.partialDelivery,
      target: step2Data.partialDelivery ?? true,
    } as WeightedParameterConfig;
  }

  // Build warranty config
  if (step4Weights.warrantyMonths && step4Weights.warrantyMonths > 0) {
    parameters.warrantyMonths = {
      id: "warrantyMonths",
      ...defaults.warrantyMonths,
      weight: step4Weights.warrantyMonths,
      target: step3Data.warrantyPeriod ?? 12,
      min: 0,
    } as WeightedParameterConfig;
  }

  // Build late delivery penalty config
  if (step4Weights.lateDeliveryPenalty && step4Weights.lateDeliveryPenalty > 0) {
    parameters.lateDeliveryPenalty = {
      id: "lateDeliveryPenalty",
      ...defaults.lateDeliveryPenalty,
      weight: step4Weights.lateDeliveryPenalty,
      target: step3Data.lateDeliveryPenalty ?? 5,
      min: 0,
    } as WeightedParameterConfig;
  }

  // Build quality certifications config
  if (step4Weights.qualityCertifications && step4Weights.qualityCertifications > 0) {
    parameters.qualityCertifications = {
      id: "qualityCertifications",
      ...defaults.qualityCertifications,
      weight: step4Weights.qualityCertifications,
      target: true, // We want certifications
    } as WeightedParameterConfig;
  }

  // Add custom parameters
  if (step3Data.customParameters) {
    for (const customParam of step3Data.customParameters) {
      if (!customParam.includeInNegotiation) continue;

      const paramId = `custom_${customParam.name.toLowerCase().replace(/\s+/g, "_")}`;
      const weight = step4Weights[paramId] ?? 0;

      if (weight > 0) {
        let utilityType: "linear" | "boolean" | "stepped" = "linear";
        let direction: "lower_better" | "higher_better" | "match_target" = "match_target";

        switch (customParam.type) {
          case "boolean":
            utilityType = "boolean";
            direction = "match_target";
            break;
          case "select":
            utilityType = "stepped";
            direction = "match_target";
            break;
          default:
            utilityType = "linear";
            direction = "higher_better";
        }

        parameters[paramId] = {
          id: paramId,
          name: customParam.name,
          weight,
          source: "custom",
          utilityType,
          direction,
          target: customParam.value,
        };
      }
    }
  }

  return {
    parameters,
    thresholds: thresholds ?? DEFAULT_THRESHOLDS,
    maxRounds: step3Data.maxRounds ?? 5,
  };
}

/**
 * Convert legacy negotiation config to weighted format
 * For backwards compatibility with existing deals
 * UPDATED Feb 2026: Now accepts both total_price (new) and unit_price (legacy)
 */
export function convertLegacyConfig(
  legacyConfig: {
    total_price?: {
      weight?: number;
      anchor?: number;
      target?: number;
      max_acceptable?: number;
      concession_step?: number;
    };
    unit_price?: {
      weight?: number;
      anchor?: number;
      target?: number;
      max_acceptable?: number;
      concession_step?: number;
    };
    payment_terms?: {
      weight?: number;
      options?: readonly string[] | string[];
      utility?: Record<string, number>;
    };
    accept_threshold?: number;
    walkaway_threshold?: number;
    max_rounds?: number;
  }
): WeightedNegotiationConfig {
  const parameters: Record<string, WeightedParameterConfig> = {};

  // Convert total price (new format) or unit price (legacy)
  const priceConfig = legacyConfig.total_price || legacyConfig.unit_price;
  if (priceConfig) {
    parameters.totalPrice = {
      id: "totalPrice",
      name: "Total Price",
      weight: priceConfig.weight ?? 60,
      source: "step2",
      utilityType: "linear",
      direction: "lower_better",
      target: priceConfig.target ?? priceConfig.anchor ?? 0,
      max: priceConfig.max_acceptable ?? priceConfig.target ?? 0,
    };
  }

  // Convert payment terms
  if (legacyConfig.payment_terms) {
    const termsConfig = legacyConfig.payment_terms;
    parameters.paymentTermsDays = {
      id: "paymentTermsDays",
      name: "Payment Terms",
      weight: termsConfig.weight ?? 40,
      source: "step2",
      utilityType: "stepped",
      direction: "higher_better",
      target: 90, // Net 90 is best for buyer
      options: termsConfig.options ? [...termsConfig.options] : ["Net 30", "Net 60", "Net 90"],
      optionUtilities: termsConfig.utility ?? {
        "Net 30": 0.5,
        "Net 60": 0.75,
        "Net 90": 1.0,
      },
    };
  }

  // Map legacy thresholds to new format
  const thresholds: ThresholdConfig = {
    accept: legacyConfig.accept_threshold ?? DEFAULT_THRESHOLDS.accept,
    escalate: DEFAULT_THRESHOLDS.escalate,
    walkAway: legacyConfig.walkaway_threshold ?? DEFAULT_THRESHOLDS.walkAway,
  };

  // Use total_price (new) or fall back to unit_price (legacy) for output
  const outputPriceConfig = legacyConfig.total_price || legacyConfig.unit_price;

  return {
    parameters,
    thresholds,
    maxRounds: legacyConfig.max_rounds ?? 5,
    legacyConfig: {
      total_price: {
        weight: outputPriceConfig?.weight ?? 60,
        anchor: outputPriceConfig?.anchor ?? 0,
        target: outputPriceConfig?.target ?? 0,
        max_acceptable: outputPriceConfig?.max_acceptable ?? 0,
        concession_step: outputPriceConfig?.concession_step ?? 0,
      },
      payment_terms: {
        weight: legacyConfig.payment_terms?.weight ?? 40,
        options: legacyConfig.payment_terms?.options ? [...legacyConfig.payment_terms.options] : ["Net 30", "Net 60", "Net 90"],
        utility: legacyConfig.payment_terms?.utility ?? {
          "Net 30": 0.5,
          "Net 60": 0.75,
          "Net 90": 1.0,
        },
      },
    },
  };
}

/**
 * Get a summary of the utility calculation for display
 */
export function getUtilitySummary(result: WeightedUtilityResult): {
  overall: {
    score: number;
    percent: string;
    recommendation: string;
    reason: string;
  };
  parameters: Array<{
    name: string;
    utility: number;
    weight: number;
    contribution: number;
    status: string;
    color: string;
    currentValue: string;
    targetValue: string;
  }>;
  thresholds: {
    accept: string;
    escalate: string;
    walkAway: string;
  };
} {
  const parameters = Object.values(result.parameterUtilities).map((p) => ({
    name: p.parameterName,
    utility: Math.round(p.utility * 100),
    weight: p.weight,
    contribution: Math.round(p.contribution * 100),
    status: p.status,
    color: p.color,
    currentValue: formatValue(p.currentValue),
    targetValue: formatValue(p.targetValue),
  }));

  // Sort by weight descending
  parameters.sort((a, b) => b.weight - a.weight);

  return {
    overall: {
      score: result.totalUtility,
      percent: `${result.totalUtilityPercent.toFixed(0)}%`,
      recommendation: result.recommendation,
      reason: result.recommendationReason,
    },
    parameters,
    thresholds: {
      accept: `${(result.thresholds.accept * 100).toFixed(0)}%`,
      escalate: `${(result.thresholds.escalate * 100).toFixed(0)}%`,
      walkAway: `${(result.thresholds.walkAway * 100).toFixed(0)}%`,
    },
  };
}

/**
 * Format a value for display
 */
function formatValue(value: number | string | boolean | null): string {
  if (value === null || value === undefined) return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // Format as currency if it looks like a price
    if (value >= 1) {
      return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    // Format as percentage if decimal
    return `${(value * 100).toFixed(0)}%`;
  }
  // Check for ISO date string format
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toLocaleDateString();
    }
  }
  return String(value);
}

// ============================================
// PACTUM-STYLE CONFIG RESOLUTION (Feb 2026)
// ============================================

/**
 * Resolve negotiation configuration from wizard config
 * Applies user-provided values with fallback to Accordo defaults
 *
 * Priority system:
 * 1. User-provided value (from wizard) takes priority
 * 2. Accordo default value is used when user hasn't modified
 *
 * This ensures the negotiation engine uses appropriate values
 * whether the user customized them or not.
 */
export function resolveNegotiationConfig(
  wizardConfig: WizardConfig | null | undefined,
  legacyConfig?: {
    total_price?: { target?: number; max_acceptable?: number; anchor?: number };
    accept_threshold?: number;
    escalate_threshold?: number;
    walkaway_threshold?: number;
    max_rounds?: number;
    priority?: 'HIGH' | 'MEDIUM' | 'LOW';
  }
): ResolvedNegotiationConfig {
  const sources: Record<string, 'user' | 'default' | 'calculated'> = {};

  // Helper to track source
  const getValueWithSource = <T>(
    key: string,
    userValue: T | null | undefined,
    defaultValue: T
  ): T => {
    if (userValue !== null && userValue !== undefined) {
      sources[key] = 'user';
      return userValue;
    }
    sources[key] = 'default';
    return defaultValue;
  };

  // ============================================
  // Resolve VALUES from wizard or legacy config
  // ============================================

  // Price values
  let targetPrice: number;
  let maxAcceptablePrice: number;

  if (wizardConfig?.priceQuantity?.targetUnitPrice != null) {
    targetPrice = wizardConfig.priceQuantity.targetUnitPrice;
    sources['targetPrice'] = 'user';
  } else if (legacyConfig?.total_price?.target != null) {
    targetPrice = legacyConfig.total_price.target;
    sources['targetPrice'] = 'user';
  } else {
    targetPrice = 1000; // Fallback default
    sources['targetPrice'] = 'default';
  }

  if (wizardConfig?.priceQuantity?.maxAcceptablePrice != null) {
    maxAcceptablePrice = wizardConfig.priceQuantity.maxAcceptablePrice;
    sources['maxAcceptablePrice'] = 'user';
  } else if (legacyConfig?.total_price?.max_acceptable != null) {
    maxAcceptablePrice = legacyConfig.total_price.max_acceptable;
    sources['maxAcceptablePrice'] = 'user';
  } else {
    maxAcceptablePrice = targetPrice * 1.25; // 25% above target
    sources['maxAcceptablePrice'] = 'calculated';
  }

  // Payment terms
  const paymentTermsMinDays = getValueWithSource(
    'paymentTermsMinDays',
    wizardConfig?.paymentTerms?.minDays,
    ACCORDO_DEFAULTS.paymentTermsMinDays
  );

  const paymentTermsMaxDays = getValueWithSource(
    'paymentTermsMaxDays',
    wizardConfig?.paymentTerms?.maxDays,
    ACCORDO_DEFAULTS.paymentTermsMaxDays
  );

  // Delivery dates
  let deliveryDate: Date | null = null;
  if (wizardConfig?.delivery?.requiredDate) {
    deliveryDate = new Date(wizardConfig.delivery.requiredDate);
    sources['deliveryDate'] = 'user';
  } else {
    sources['deliveryDate'] = 'default';
  }

  let preferredDeliveryDate: Date | null = null;
  if (wizardConfig?.delivery?.preferredDate) {
    preferredDeliveryDate = new Date(wizardConfig.delivery.preferredDate);
    sources['preferredDeliveryDate'] = 'user';
  } else {
    sources['preferredDeliveryDate'] = 'default';
  }

  const partialDeliveryAllowed = getValueWithSource(
    'partialDeliveryAllowed',
    wizardConfig?.delivery?.partialDelivery?.allowed,
    false
  );

  // Contract SLA
  const warrantyPeriodMonths = wizardConfig?.contractSla?.warrantyPeriod
    ? parseWarrantyPeriodToMonths(wizardConfig.contractSla.warrantyPeriod)
    : ACCORDO_DEFAULTS.warrantyPeriodMonths;
  sources['warrantyPeriodMonths'] = wizardConfig?.contractSla?.warrantyPeriod ? 'user' : 'default';

  // Use custom months if CUSTOM period is selected
  if (wizardConfig?.contractSla?.warrantyPeriod === 'CUSTOM' && wizardConfig.contractSla.customWarrantyMonths) {
    sources['warrantyPeriodMonths'] = 'user';
  }

  const lateDeliveryPenaltyPerDay = getValueWithSource(
    'lateDeliveryPenaltyPerDay',
    wizardConfig?.contractSla?.lateDeliveryPenaltyPerDay,
    ACCORDO_DEFAULTS.lateDeliveryPenaltyPerDay
  );

  const qualityStandards = getValueWithSource(
    'qualityStandards',
    wizardConfig?.contractSla?.qualityStandards,
    ACCORDO_DEFAULTS.qualityStandards
  );

  // Negotiation control
  let maxRounds = getValueWithSource(
    'maxRounds',
    wizardConfig?.negotiationControl?.maxRounds,
    legacyConfig?.max_rounds ?? ACCORDO_DEFAULTS.maxRounds
  );

  let walkawayThreshold = getValueWithSource(
    'walkawayThreshold',
    wizardConfig?.negotiationControl?.walkawayThreshold,
    legacyConfig?.walkaway_threshold ? legacyConfig.walkaway_threshold * 100 : ACCORDO_DEFAULTS.walkawayThreshold
  );

  const priority = getValueWithSource(
    'priority',
    wizardConfig?.priority ?? legacyConfig?.priority,
    ACCORDO_DEFAULTS.priority
  );

  // ============================================
  // Resolve WEIGHTS from wizard or defaults
  // ============================================

  let weights: Record<string, number>;
  let weightsAreUserModified: boolean;

  if (wizardConfig?.aiSuggested === false && wizardConfig.parameterWeights) {
    // User modified weights
    weights = { ...wizardConfig.parameterWeights };
    weightsAreUserModified = true;
  } else if (wizardConfig?.parameterWeights) {
    // AI-suggested weights from wizard
    weights = { ...wizardConfig.parameterWeights };
    weightsAreUserModified = false;
  } else {
    // Use Accordo defaults
    weights = { ...DEFAULT_WEIGHTS };
    weightsAreUserModified = false;
  }

  // Ensure all default weights exist (for backwards compatibility)
  for (const [key, value] of Object.entries(DEFAULT_WEIGHTS)) {
    if (!(key in weights)) {
      weights[key] = value;
    }
  }

  // ============================================
  // Calculate derived thresholds based on priority
  // ============================================

  let acceptThreshold: number;
  let escalateThreshold: number;
  let walkAwayThreshold: number;

  if (legacyConfig?.accept_threshold != null) {
    acceptThreshold = legacyConfig.accept_threshold;
    escalateThreshold = legacyConfig.escalate_threshold ?? 0.50;
    walkAwayThreshold = legacyConfig.walkaway_threshold ?? 0.30;
  } else {
    // Priority-based thresholds
    switch (priority) {
      case 'HIGH':
        // Maximize Savings: Stricter thresholds
        acceptThreshold = 0.75;
        escalateThreshold = 0.55;
        walkAwayThreshold = 0.35;
        break;
      case 'LOW':
        // Quick Close: Relaxed thresholds
        acceptThreshold = 0.65;
        escalateThreshold = 0.45;
        walkAwayThreshold = 0.25;
        break;
      case 'MEDIUM':
      default:
        // Fair Deal: Balanced thresholds
        acceptThreshold = 0.70;
        escalateThreshold = 0.50;
        walkAwayThreshold = 0.30;
    }
  }

  // Override with user-specified walkaway if provided
  if (wizardConfig?.negotiationControl?.walkawayThreshold != null) {
    walkAwayThreshold = wizardConfig.negotiationControl.walkawayThreshold / 100;
  }

  // ============================================
  // Calculate price-related values
  // ============================================

  const anchorPrice = legacyConfig?.total_price?.anchor ?? targetPrice * 0.85;
  sources['anchorPrice'] = legacyConfig?.total_price?.anchor != null ? 'user' : 'calculated';

  const priceRange = maxAcceptablePrice - targetPrice;
  sources['priceRange'] = 'calculated';

  const concessionStep = priceRange / (maxRounds > 0 ? maxRounds : 10);
  sources['concessionStep'] = 'calculated';

  return {
    // Values
    targetPrice,
    maxAcceptablePrice,
    paymentTermsMinDays,
    paymentTermsMaxDays,
    deliveryDate,
    preferredDeliveryDate,
    partialDeliveryAllowed,
    warrantyPeriodMonths,
    lateDeliveryPenaltyPerDay,
    qualityStandards,
    maxRounds,
    walkawayThreshold,
    priority,

    // Weights
    weights,
    weightsAreUserModified,

    // Thresholds
    acceptThreshold,
    escalateThreshold,
    walkAwayThreshold,

    // Calculated
    anchorPrice,
    priceRange,
    concessionStep,

    // Source tracking
    sources,
  };
}

/**
 * Calculate weighted utility using resolved configuration
 * This is the main entry point for the Pactum-style utility calculation
 */
export function calculateWeightedUtilityFromResolved(
  vendorOffer: ExtendedOffer,
  resolvedConfig: ResolvedNegotiationConfig
): WeightedUtilityResult {
  const parameterUtilities: Record<string, ParameterUtilityResult> = {};
  let totalUtility = 0;
  let totalWeight = 0;

  const { weights } = resolvedConfig;

  // ============================================
  // Price Parameters
  // ============================================

  // Target Price Utility
  if (weights.targetUnitPrice > 0 && vendorOffer.total_price != null) {
    const priceUtility = calculatePriceUtility(
      vendorOffer.total_price,
      resolvedConfig.targetPrice,
      resolvedConfig.maxAcceptablePrice
    );
    const contribution = priceUtility * (weights.targetUnitPrice / 100);
    parameterUtilities['targetUnitPrice'] = {
      parameterId: 'targetUnitPrice',
      parameterName: 'Target Price',
      utility: priceUtility,
      weight: weights.targetUnitPrice,
      contribution,
      currentValue: vendorOffer.total_price,
      targetValue: resolvedConfig.targetPrice,
      maxValue: resolvedConfig.maxAcceptablePrice,
      status: getStatusFromScore(priceUtility),
      color: getColorFromScore(priceUtility),
    };
    totalUtility += contribution;
    totalWeight += weights.targetUnitPrice;
  }

  // Payment Terms Utility (longer terms = better for buyer)
  // Only scored when vendor explicitly provides payment terms in their offer
  if (weights.paymentTerms > 0 && vendorOffer.payment_terms != null) {
    const vendorDays = vendorOffer.payment_terms_days
      ?? (vendorOffer.payment_terms ? parseInt(vendorOffer.payment_terms.replace(/\D/g, ''), 10) || null : null);
    if (vendorDays != null) {
      const termsUtilityScore = calculatePaymentTermsUtility(
        vendorDays,
        resolvedConfig.paymentTermsMinDays,
        resolvedConfig.paymentTermsMaxDays
      );
      const contribution = termsUtilityScore * (weights.paymentTerms / 100);
      parameterUtilities['paymentTerms'] = {
        parameterId: 'paymentTerms',
        parameterName: 'Payment Terms',
        utility: termsUtilityScore,
        weight: weights.paymentTerms,
        contribution,
        currentValue: vendorOffer.payment_terms,
        targetValue: `Net ${resolvedConfig.paymentTermsMaxDays}`,
        status: getStatusFromScore(termsUtilityScore),
        color: getColorFromScore(termsUtilityScore),
      };
      totalUtility += contribution;
      totalWeight += weights.paymentTerms;
    }
  }

  // ============================================
  // Delivery Parameters
  // ============================================

  // Delivery Date Utility
  // Only scored when vendor explicitly provides delivery info in their offer
  if (weights.deliveryDate > 0 && vendorOffer.delivery_days != null && resolvedConfig.deliveryDate) {
    const requiredDays = Math.ceil(
      (resolvedConfig.deliveryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    // Derive tolerance from preferredDeliveryDate vs requiredDeliveryDate gap.
    // preferredDate is always set (mandatory in wizard); difference gives natural tolerance.
    const toleranceDays = resolvedConfig.preferredDeliveryDate && resolvedConfig.deliveryDate
      ? Math.max(
          7, // minimum 7-day tolerance
          Math.ceil(
            Math.abs(
              resolvedConfig.preferredDeliveryDate.getTime() - resolvedConfig.deliveryDate.getTime()
            ) / (1000 * 60 * 60 * 24)
          )
        )
      : 30; // fallback only if preferredDate unexpectedly absent
    const deliveryUtility = vendorOffer.delivery_days <= requiredDays
      ? 1
      : Math.max(0, 1 - (vendorOffer.delivery_days - requiredDays) / toleranceDays);
    const contribution = deliveryUtility * (weights.deliveryDate / 100);
    parameterUtilities['deliveryDate'] = {
      parameterId: 'deliveryDate',
      parameterName: 'Delivery Date',
      utility: deliveryUtility,
      weight: weights.deliveryDate,
      contribution,
      currentValue: vendorOffer.delivery_days,
      targetValue: requiredDays,
      status: getStatusFromScore(deliveryUtility),
      color: getColorFromScore(deliveryUtility),
    };
    totalUtility += contribution;
    totalWeight += weights.deliveryDate;
  }

  // ============================================
  // Contract Parameters
  // ============================================

  // Warranty Period Utility (higher is better)
  if (weights.warrantyPeriod > 0 && vendorOffer.warranty_months != null) {
    const warrantyUtility = Math.min(
      1,
      vendorOffer.warranty_months / resolvedConfig.warrantyPeriodMonths
    );
    const contribution = warrantyUtility * (weights.warrantyPeriod / 100);
    parameterUtilities['warrantyPeriod'] = {
      parameterId: 'warrantyPeriod',
      parameterName: 'Warranty Period',
      utility: warrantyUtility,
      weight: weights.warrantyPeriod,
      contribution,
      currentValue: vendorOffer.warranty_months,
      targetValue: resolvedConfig.warrantyPeriodMonths,
      status: getStatusFromScore(warrantyUtility),
      color: getColorFromScore(warrantyUtility),
    };
    totalUtility += contribution;
    totalWeight += weights.warrantyPeriod;
  }

  // Quality Standards Utility
  // Only scored when:
  // 1. qualityStandards weight is configured
  // 2. Required certifications are actually specified in config (non-empty)
  // 3. Vendor explicitly mentioned certifications in their offer
  // Rationale: if no certs required, quality isn't a negotiation dimension; exclude from total weight
  if (weights.qualityStandards > 0 && vendorOffer.quality_certifications) {
    const requiredCerts = resolvedConfig.qualityStandards ?? [];
    const offeredCerts = vendorOffer.quality_certifications ?? [];
    // Skip entirely when no certs are configured — avoids phantom 100% score inflating utility
    if (requiredCerts.length > 0) {
      const matchCount = offeredCerts.length > 0
        ? requiredCerts.filter((c) =>
            offeredCerts.some((o) => o.toLowerCase().includes(c.toLowerCase()))
          ).length
        : 0;
      const qualityUtility = matchCount / requiredCerts.length;
      const contribution = qualityUtility * (weights.qualityStandards / 100);
      parameterUtilities['qualityStandards'] = {
        parameterId: 'qualityStandards',
        parameterName: 'Quality Standards',
        utility: qualityUtility,
        weight: weights.qualityStandards,
        contribution,
        currentValue: offeredCerts.join(', '),
        targetValue: requiredCerts.join(', '),
        status: getStatusFromScore(qualityUtility),
        color: getColorFromScore(qualityUtility),
      };
      totalUtility += contribution;
      totalWeight += weights.qualityStandards;
    }
  }

  // ============================================
  // Normalize and finalize
  // ============================================

  // Normalize if weights don't sum to 100
  if (totalWeight > 0 && totalWeight !== 100) {
    totalUtility = totalUtility * (100 / totalWeight);
  }

  // Clamp to [0, 1]
  totalUtility = Math.max(0, Math.min(1, totalUtility));

  const thresholds: ThresholdConfig = {
    accept: resolvedConfig.acceptThreshold,
    escalate: resolvedConfig.escalateThreshold,
    walkAway: resolvedConfig.walkAwayThreshold,
  };

  const { action, reason } = getRecommendationFromUtility(totalUtility, thresholds);

  return {
    totalUtility,
    totalUtilityPercent: totalUtility * 100,
    parameterUtilities,
    thresholds,
    recommendation: action,
    recommendationReason: reason,
  };
}

// ============================================
// Helper Functions for Pactum-Style Utility
// ============================================

/**
 * Calculate price utility (lower is better)
 * Returns 1 when at or below target, 0 when at or above max
 */
function calculatePriceUtility(
  price: number,
  target: number,
  maxAcceptable: number
): number {
  if (price <= target) return 1;
  if (price >= maxAcceptable) return 0;
  return 1 - (price - target) / (maxAcceptable - target);
}

/**
 * Calculate payment terms utility (longer is better for buyer)
 * Returns 1 when at or above max days, 0 when at or below min days
 */
function calculatePaymentTermsUtility(
  days: number,
  minDays: number,
  maxDays: number
): number {
  if (days >= maxDays) return 1;
  if (days <= minDays) return 0;
  return (days - minDays) / (maxDays - minDays);
}

/**
 * Get status label from utility score
 */
function getStatusFromScore(utility: number): 'excellent' | 'good' | 'warning' | 'critical' {
  if (utility >= 0.80) return 'excellent';
  if (utility >= 0.60) return 'good';
  if (utility >= 0.40) return 'warning';
  return 'critical';
}

/**
 * Get color from utility score
 */
function getColorFromScore(utility: number): string {
  if (utility >= 0.80) return '#22c55e'; // green
  if (utility >= 0.60) return '#3b82f6'; // blue
  if (utility >= 0.40) return '#eab308'; // yellow
  return '#ef4444'; // red
}
