/**
 * Parameter Utility Calculator
 *
 * Calculates utility scores (0-1) for individual parameters based on their type,
 * configuration, and current vendor offer values.
 *
 * Utility Types:
 * - linear: Linear interpolation between min and max
 * - binary: Either 0 or 1 based on condition
 * - stepped: Predefined utility values for discrete options
 * - date: Utility based on date proximity to target
 * - percentage: Linear percentage calculation
 * - boolean: Binary value (true/false)
 */

import type {
  WeightedParameterConfig,
  ParameterUtilityResult,
  ParameterStatus,
} from "./types.js";
import { getStatusFromUtility, getStatusColor } from "./types.js";

/**
 * Calculate utility for a linear parameter (lower_better or higher_better)
 * E.g., unit price where lower is better
 */
export function calculateLinearUtility(
  value: number | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  const target = config.target as number;
  const max = config.max as number;
  const min = config.min as number;

  if (config.direction === "lower_better") {
    // Lower values are better (e.g., price)
    // Utility = 1 when value <= target, 0 when value >= max
    if (value <= target) return 1;
    if (value >= max) return 0;
    // Linear interpolation between target and max
    // Guard against division by zero when max === target
    const range = max - target;
    if (range === 0) return 0;
    return 1 - (value - target) / range;
  } else if (config.direction === "higher_better") {
    // Higher values are better (e.g., warranty months)
    // Utility = 1 when value >= target, 0 when value <= min
    if (value >= target) return 1;
    if (min !== undefined && min !== null && value <= min) return 0;
    if (min !== undefined && min !== null) {
      // Guard against division by zero when target === min
      const range = target - min;
      if (range === 0) return 0;
      return (value - min) / range;
    }
    // If no min defined, use 0 as min
    // Guard against division by zero when target === 0
    if (target === 0) return 0;
    return value / target;
  } else if (config.direction === "closer_better") {
    // Closer to target is better
    const distance = Math.abs(value - target);
    const maxDistance =
      max !== undefined && max !== null
        ? Math.abs(max - target)
        : target; // Default max distance is the target itself
    if (distance === 0) return 1;
    if (distance >= maxDistance) return 0;
    return 1 - distance / maxDistance;
  }

  return 0;
}

/**
 * Calculate utility for stepped/discrete options (e.g., payment terms)
 * Uses predefined utility mappings for each option
 */
export function calculateSteppedUtility(
  value: string | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  // Check if we have predefined utilities
  if (config.optionUtilities && config.optionUtilities[value] !== undefined) {
    return config.optionUtilities[value];
  }

  // If no predefined utilities, calculate based on option position
  if (config.options && config.options.length > 0) {
    const index = config.options.indexOf(value);
    if (index === -1) return 0;

    // First option is best (utility = 1), last is worst (utility approaches 0)
    if (config.options.length === 1) return 1;
    return 1 - index / (config.options.length - 1);
  }

  return 0;
}

/**
 * Calculate utility for date parameters
 * Based on how close the offered date is to the target date
 */
export function calculateDateUtility(
  value: string | Date | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  const offeredDate = new Date(value);
  const targetDate = new Date(config.target as string);

  if (isNaN(offeredDate.getTime()) || isNaN(targetDate.getTime())) {
    return 0;
  }

  // Calculate days difference
  const diffMs = offeredDate.getTime() - targetDate.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (config.direction === "lower_better") {
    // Earlier dates are better (e.g., delivery date)
    if (diffDays <= 0) return 1; // On or before target = perfect
    const maxDays =
      config.max !== undefined && config.max !== null
        ? Math.abs(
            new Date(config.max as string).getTime() - targetDate.getTime()
          ) /
          (1000 * 60 * 60 * 24)
        : 30; // Default 30 days tolerance
    if (diffDays >= maxDays) return 0;
    return 1 - diffDays / maxDays;
  } else if (config.direction === "higher_better") {
    // Later dates are better (rare case)
    if (diffDays >= 0) return 1;
    const minDays =
      config.min !== undefined && config.min !== null
        ? Math.abs(
            targetDate.getTime() - new Date(config.min as string).getTime()
          ) /
          (1000 * 60 * 60 * 24)
        : 30;
    if (Math.abs(diffDays) >= minDays) return 0;
    return 1 - Math.abs(diffDays) / minDays;
  } else if (config.direction === "closer_better") {
    // Closer to target is better
    const maxDays =
      config.max !== undefined && config.max !== null
        ? Math.abs(
            new Date(config.max as string).getTime() - targetDate.getTime()
          ) /
          (1000 * 60 * 60 * 24)
        : 30;
    const absDiffDays = Math.abs(diffDays);
    if (absDiffDays === 0) return 1;
    if (absDiffDays >= maxDays) return 0;
    return 1 - absDiffDays / maxDays;
  }

  return 0;
}

/**
 * Calculate utility for percentage parameters
 * E.g., advance payment percentage (lower is better)
 */
export function calculatePercentageUtility(
  value: number | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  // Clamp to valid percentage range
  const clampedValue = Math.max(0, Math.min(100, value));
  const target = config.target as number;

  if (config.direction === "lower_better") {
    // Lower percentage is better (e.g., advance payment)
    if (clampedValue <= target) return 1;
    const max = (config.max as number) ?? 100;
    if (clampedValue >= max) return 0;
    // Guard against division by zero when max === target
    const range = max - target;
    if (range === 0) return 0;
    return 1 - (clampedValue - target) / range;
  } else if (config.direction === "higher_better") {
    // Higher percentage is better (e.g., volume discount)
    if (clampedValue >= target) return 1;
    const min = (config.min as number) ?? 0;
    if (clampedValue <= min) return 0;
    // Guard against division by zero when target === min
    const range = target - min;
    if (range === 0) return 0;
    return (clampedValue - min) / range;
  }

  return 0;
}

/**
 * Calculate utility for boolean parameters
 * E.g., partial delivery allowed (true is better)
 */
export function calculateBooleanUtility(
  value: boolean | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  const targetValue = config.target as boolean;

  // Match target = full utility, mismatch = no utility
  return value === targetValue ? 1 : 0;
}

/**
 * Calculate utility for binary parameters
 * Similar to boolean but for numeric thresholds
 */
export function calculateBinaryUtility(
  value: number | string | boolean | Date | null,
  config: WeightedParameterConfig
): number {
  if (value === null || value === undefined) return 0;

  const target = config.target;

  // For numeric binary (e.g., meets minimum requirement)
  if (typeof value === "number" && typeof target === "number") {
    if (config.direction === "higher_better") {
      return value >= target ? 1 : 0;
    } else {
      return value <= target ? 1 : 0;
    }
  }

  // For string/boolean equality
  return value === target ? 1 : 0;
}

/**
 * Main function to calculate utility for any parameter
 * Routes to the appropriate utility function based on parameter type
 */
export function calculateParameterUtility(
  value: number | string | boolean | Date | null,
  config: WeightedParameterConfig
): ParameterUtilityResult {
  let utility = 0;

  switch (config.utilityType) {
    case "linear":
      utility = calculateLinearUtility(value as number | null, config);
      break;
    case "stepped":
      utility = calculateSteppedUtility(value as string | null, config);
      break;
    case "date":
      utility = calculateDateUtility(value as string | Date | null, config);
      break;
    case "percentage":
      utility = calculatePercentageUtility(value as number | null, config);
      break;
    case "boolean":
      utility = calculateBooleanUtility(value as boolean | null, config);
      break;
    case "binary":
      utility = calculateBinaryUtility(value, config);
      break;
    default:
      utility = 0;
  }

  // Clamp utility to [0, 1]
  utility = Math.max(0, Math.min(1, utility));

  const status: ParameterStatus = getStatusFromUtility(utility);
  const color = getStatusColor(status);
  const contribution = utility * (config.weight / 100);

  // Convert Date to string for display
  const displayValue = value instanceof Date ? value.toISOString() : value;

  return {
    parameterId: config.id,
    parameterName: config.name,
    utility,
    weight: config.weight,
    contribution,
    currentValue: displayValue,
    targetValue: config.target,
    maxValue: config.max,
    status,
    color,
  };
}

/**
 * Parse payment terms string to days
 * E.g., "Net 30" -> 30, "Net 60" -> 60
 */
export function parsePaymentTermsDays(terms: string | null): number | null {
  if (!terms) return null;

  const match = terms.match(/Net\s*(\d+)/i);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Try to parse just a number
  const num = parseInt(terms, 10);
  if (!isNaN(num)) {
    return num;
  }

  return null;
}

/**
 * Normalize payment terms to standard format
 * E.g., 30 -> "Net 30", "net30" -> "Net 30"
 */
export function normalizePaymentTerms(
  value: number | string | null
): string | null {
  if (value === null || value === undefined) return null;

  if (typeof value === "number") {
    return `Net ${value}`;
  }

  const days = parsePaymentTermsDays(value);
  if (days !== null) {
    return `Net ${days}`;
  }

  return value;
}

/**
 * Get default parameter configurations for standard negotiation parameters
 */
export function getDefaultParameterConfigs(): Record<
  string,
  Partial<WeightedParameterConfig>
> {
  return {
    unitPrice: {
      name: "Unit Price",
      utilityType: "linear",
      direction: "lower_better",
      source: "step2",
    },
    totalPrice: {
      name: "Total Price",
      utilityType: "linear",
      direction: "lower_better",
      source: "step2",
    },
    paymentTermsDays: {
      name: "Payment Terms",
      utilityType: "stepped",
      direction: "higher_better",
      source: "step2",
      options: ["Net 30", "Net 60", "Net 90"],
      optionUtilities: { "Net 30": 0.5, "Net 60": 0.75, "Net 90": 1.0 },
    },
    advancePayment: {
      name: "Advance Payment",
      utilityType: "percentage",
      direction: "lower_better",
      source: "step2",
    },
    volumeDiscount: {
      name: "Volume Discount",
      utilityType: "percentage",
      direction: "higher_better",
      source: "step2",
    },
    deliveryDate: {
      name: "Delivery Date",
      utilityType: "date",
      direction: "lower_better",
      source: "step2",
    },
    partialDelivery: {
      name: "Partial Delivery",
      utilityType: "boolean",
      direction: "match_target",
      source: "step2",
    },
    warrantyMonths: {
      name: "Warranty Period",
      utilityType: "linear",
      direction: "higher_better",
      source: "step3",
    },
    lateDeliveryPenalty: {
      name: "Late Delivery Penalty",
      utilityType: "percentage",
      direction: "higher_better",
      source: "step3",
    },
    qualityCertifications: {
      name: "Quality Certifications",
      utilityType: "binary",
      direction: "match_target",
      source: "step3",
    },
  };
}
