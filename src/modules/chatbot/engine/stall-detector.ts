/**
 * Stall Detector Module
 *
 * Detects when a vendor is repeatedly offering the same value for a parameter
 * while varying other parameters. This indicates they may have reached their
 * final position on that parameter.
 *
 * When detected, generates a "Is this your final offer?" prompt to push
 * toward conclusion.
 *
 * @module stallDetector
 */

import type { ExtendedOffer, NegotiationState } from './types.js';

// ============================================
// TYPES
// ============================================

/**
 * History entry for a parameter's value across rounds
 */
export interface ParameterHistoryEntry {
  round: number;
  value: number | string | boolean | null;
  timestamp: Date;
}

/**
 * History of values for a specific parameter
 */
export interface ParameterHistory {
  parameter: string;
  values: ParameterHistoryEntry[];
}

/**
 * Detected stall pattern
 */
export interface StallPattern {
  /** Which parameter is stuck (not changing) */
  stalledParameter: string;
  /** The value that keeps repeating */
  stalledValue: number | string | boolean | null;
  /** How many consecutive rounds with the same value */
  consecutiveRounds: number;
  /** Which parameters ARE changing */
  varyingParameters: string[];
  /** Suggested prompt to ask vendor */
  prompt: string;
}

/**
 * Complete stall analysis result
 */
export interface StallAnalysis {
  /** Whether a stall was detected */
  isStalled: boolean;
  /** The detected stall pattern (if any) */
  pattern: StallPattern | null;
  /** All parameter histories for debugging/analysis */
  histories: ParameterHistory[];
}

// ============================================
// PARAMETER EXTRACTION
// ============================================

/**
 * Extract parameter values from an offer for tracking
 */
export function extractParameterValues(offer: ExtendedOffer): Record<string, number | string | boolean | null> {
  return {
    price: offer.total_price,
    payment_terms_days: offer.payment_terms_days ?? null,
    delivery_days: offer.delivery_days ?? null,
    warranty_months: offer.warranty_months ?? null,
    partial_delivery: offer.partial_delivery_allowed ?? null,
  };
}

/**
 * Track a new offer's parameter values in history
 */
export function trackOffer(
  histories: ParameterHistory[],
  offer: ExtendedOffer,
  round: number
): ParameterHistory[] {
  const values = extractParameterValues(offer);
  const now = new Date();

  // Create new histories array with updated values
  const updatedHistories: ParameterHistory[] = [];

  for (const [param, value] of Object.entries(values)) {
    const existingHistory = histories.find(h => h.parameter === param);

    if (existingHistory) {
      updatedHistories.push({
        parameter: param,
        values: [
          ...existingHistory.values,
          { round, value, timestamp: now },
        ],
      });
    } else {
      updatedHistories.push({
        parameter: param,
        values: [{ round, value, timestamp: now }],
      });
    }
  }

  return updatedHistories;
}

// ============================================
// STALL DETECTION
// ============================================

/**
 * Check if a value is effectively the same as another
 * Handles numeric tolerance for prices
 */
function valuesMatch(
  a: number | string | boolean | null,
  b: number | string | boolean | null,
  parameter: string
): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  // For prices, allow small tolerance (0.1% or $10, whichever is larger)
  if (parameter === 'price' && typeof a === 'number' && typeof b === 'number') {
    const tolerance = Math.max(10, Math.abs(a) * 0.001);
    return Math.abs(a - b) <= tolerance;
  }

  return a === b;
}

/**
 * Count consecutive rounds with the same value
 */
function countConsecutiveSameValues(
  history: ParameterHistory,
  parameter: string
): { count: number; value: number | string | boolean | null } {
  const values = history.values;
  if (values.length < 2) {
    return { count: values.length, value: values[0]?.value ?? null };
  }

  // Start from the latest value and count backwards
  const latestValue = values[values.length - 1].value;
  let count = 1;

  for (let i = values.length - 2; i >= 0; i--) {
    if (valuesMatch(values[i].value, latestValue, parameter)) {
      count++;
    } else {
      break;
    }
  }

  return { count, value: latestValue };
}

/**
 * Check if a parameter is varying (changing between rounds)
 */
function isParameterVarying(history: ParameterHistory, parameter: string): boolean {
  const values = history.values;
  if (values.length < 2) return false;

  // Check last 3 rounds for variation
  const recentValues = values.slice(-3);
  for (let i = 1; i < recentValues.length; i++) {
    if (!valuesMatch(recentValues[i].value, recentValues[i - 1].value, parameter)) {
      return true;
    }
  }

  return false;
}

/**
 * Detect stall patterns in vendor offers
 *
 * A stall is detected when:
 * 1. One parameter has the same value for N consecutive rounds
 * 2. At least one other parameter is varying
 *
 * @param histories - Parameter history arrays
 * @param minConsecutiveRounds - Minimum rounds to consider a stall (default 3)
 */
export function detectStallPattern(
  histories: ParameterHistory[],
  minConsecutiveRounds: number = 3
): StallAnalysis {
  if (histories.length === 0) {
    return {
      isStalled: false,
      pattern: null,
      histories,
    };
  }

  // Check each parameter for stalling
  const stalledParams: Array<{
    parameter: string;
    value: number | string | boolean | null;
    count: number;
  }> = [];

  const varyingParams: string[] = [];

  for (const history of histories) {
    if (history.values.length < minConsecutiveRounds) continue;

    const { count, value } = countConsecutiveSameValues(history, history.parameter);

    if (count >= minConsecutiveRounds) {
      stalledParams.push({
        parameter: history.parameter,
        value,
        count,
      });
    }

    if (isParameterVarying(history, history.parameter)) {
      varyingParams.push(history.parameter);
    }
  }

  // A stall pattern exists if:
  // 1. At least one parameter is stalled
  // 2. At least one other parameter is varying
  if (stalledParams.length > 0 && varyingParams.length > 0) {
    // Find the most "interesting" stall (price or payment terms take priority)
    const priorityOrder = ['price', 'payment_terms_days', 'delivery_days', 'warranty_months'];
    let mainStall = stalledParams[0];

    for (const param of priorityOrder) {
      const found = stalledParams.find(s => s.parameter === param);
      if (found) {
        mainStall = found;
        break;
      }
    }

    const pattern: StallPattern = {
      stalledParameter: mainStall.parameter,
      stalledValue: mainStall.value,
      consecutiveRounds: mainStall.count,
      varyingParameters: varyingParams,
      prompt: generateFinalOfferPrompt(mainStall.parameter, mainStall.value, mainStall.count, varyingParams),
    };

    return {
      isStalled: true,
      pattern,
      histories,
    };
  }

  return {
    isStalled: false,
    pattern: null,
    histories,
  };
}

// ============================================
// PROMPT GENERATION
// ============================================

/**
 * Generate a "Is this your final offer?" prompt based on the stall pattern
 */
export function generateFinalOfferPrompt(
  stalledParameter: string,
  stalledValue: number | string | boolean | null,
  consecutiveRounds: number,
  varyingParameters: string[]
): string {
  // Format the stalled value for display
  let formattedValue = String(stalledValue);
  if (stalledParameter === 'price' && typeof stalledValue === 'number') {
    formattedValue = `$${stalledValue.toLocaleString()}`;
  } else if (stalledParameter === 'payment_terms_days' && typeof stalledValue === 'number') {
    formattedValue = `Net ${stalledValue}`;
  } else if (stalledParameter === 'warranty_months' && typeof stalledValue === 'number') {
    formattedValue = `${stalledValue} months`;
  } else if (stalledParameter === 'delivery_days' && typeof stalledValue === 'number') {
    formattedValue = `${stalledValue} days`;
  }

  // Format the varying parameters
  const varyingFormatted = varyingParameters
    .map(p => {
      switch (p) {
        case 'price': return 'price';
        case 'payment_terms_days': return 'payment terms';
        case 'delivery_days': return 'delivery timeline';
        case 'warranty_months': return 'warranty period';
        default: return p;
      }
    })
    .join(' and ');

  // Generate contextual prompt based on which parameter is stalled
  switch (stalledParameter) {
    case 'price':
      return `I notice you've maintained ${formattedValue} for the past ${consecutiveRounds} rounds while adjusting ${varyingFormatted}. Is this your final price position? If so, let's focus on finding the right terms to close this deal.`;

    case 'payment_terms_days':
      return `You've held firm on ${formattedValue} payment terms for ${consecutiveRounds} consecutive rounds. Is this a hard requirement for your organization? Understanding this will help us reach an agreement faster.`;

    case 'delivery_days':
      return `I see the ${formattedValue} delivery timeline has remained consistent. Is this delivery date fixed, or is there room for adjustment if we can find agreement on other terms?`;

    case 'warranty_months':
      return `You've maintained a ${formattedValue} warranty position throughout our discussion. Is this your final stance on warranty coverage?`;

    default:
      return `I notice ${stalledParameter} has remained at ${formattedValue} for ${consecutiveRounds} rounds. Is this your final position on this term?`;
  }
}

/**
 * Check if we should ask the "final offer" question
 * Returns the prompt if conditions are met, null otherwise
 */
export function shouldAskFinalOffer(
  histories: ParameterHistory[],
  round: number,
  minRoundsBeforeAsking: number = 3
): string | null {
  // Don't ask too early
  if (round < minRoundsBeforeAsking) {
    return null;
  }

  const analysis = detectStallPattern(histories, 3);

  if (analysis.isStalled && analysis.pattern) {
    return analysis.pattern.prompt;
  }

  return null;
}

export default {
  extractParameterValues,
  trackOffer,
  detectStallPattern,
  generateFinalOfferPrompt,
  shouldAskFinalOffer,
};
