/**
 * Value Function Modeling
 *
 * Pactum-style explicit $/value trade-off calculations for each negotiation term.
 * Provides dollar-impact analysis for parameter changes.
 *
 * Key Concepts:
 * - Each parameter has a $/unit value (e.g., payment_terms = $150/day)
 * - Trade-offs can be calculated as equivalent dollar amounts
 * - Enables "I'll accept $X higher price for Y days longer payment terms"
 *
 * @module valueFunction
 */

import type { ResolvedNegotiationConfig, ExtendedOffer } from './types.js';

// ============================================
// Types
// ============================================

/**
 * Value function for a single parameter
 */
export interface ValueFunction {
  /** Parameter ID */
  parameterId: string;
  /** Parameter display name */
  parameterName: string;
  /** Dollar value per unit change */
  unitValue: number;
  /** Unit description (e.g., "per day", "per %", "per month") */
  unitDescription: string;
  /** How to calculate the impact */
  calculate: (current: number | null, proposed: number | null) => ValueImpact;
}

/**
 * Result of a value calculation
 */
export interface ValueImpact {
  /** Dollar impact (positive = benefit to PM, negative = cost to PM) */
  dollarImpact: number;
  /** Percentage change from current */
  percentChange: number;
  /** Human-readable narrative */
  narrative: string;
  /** Unit change (raw number) */
  unitChange: number;
  /** Whether this is favorable for PM */
  isFavorable: boolean;
}

/**
 * Complete value breakdown for an offer
 */
export interface OfferValueBreakdown {
  /** Total dollar value impact */
  totalDollarImpact: number;
  /** Per-parameter breakdowns */
  parameterImpacts: Record<string, ValueImpact>;
  /** Summary narratives */
  summaries: {
    overall: string;
    keyTradeoffs: string[];
    recommendations: string[];
  };
}

/**
 * Trade-off analysis between two parameters
 */
export interface TradeoffAnalysis {
  /** Parameter gaining value */
  gaining: string;
  /** Parameter losing value */
  losing: string;
  /** Net dollar impact */
  netImpact: number;
  /** Whether the trade-off is favorable */
  isFavorable: boolean;
  /** Narrative description */
  narrative: string;
}

// ============================================
// Value Function Factory
// ============================================

/**
 * Create value functions for all negotiation parameters
 *
 * @param config - Resolved negotiation configuration
 * @param dealValue - Total deal value for percentage calculations
 */
export function createValueFunctions(
  config: ResolvedNegotiationConfig,
  dealValue: number
): Record<string, ValueFunction> {
  const functions: Record<string, ValueFunction> = {};

  // ============================================
  // Payment Terms Value Function
  // Value: Cost of money per day of payment terms
  // Formula: Deal Value × Daily Interest Rate
  // Typical: ~0.015% per day (5.5% annual rate / 365)
  // ============================================

  const dailyInterestRate = 0.00015; // ~5.5% annual rate
  const paymentTermsUnitValue = dealValue * dailyInterestRate;

  functions['paymentTermsRange'] = {
    parameterId: 'paymentTermsRange',
    parameterName: 'Payment Terms',
    unitValue: paymentTermsUnitValue,
    unitDescription: 'per day of payment terms',
    calculate: (current, proposed) => {
      const currentDays = current ?? config.paymentTermsMinDays;
      const proposedDays = proposed ?? currentDays;
      const unitChange = proposedDays - currentDays;
      const dollarImpact = unitChange * paymentTermsUnitValue;

      // Longer terms = better for PM (positive value)
      const isFavorable = unitChange > 0;

      return {
        dollarImpact: Math.round(dollarImpact * 100) / 100,
        percentChange: currentDays > 0 ? (unitChange / currentDays) * 100 : 0,
        unitChange,
        isFavorable,
        narrative: unitChange === 0
          ? 'No change in payment terms'
          : isFavorable
            ? `${Math.abs(unitChange)} extra days = $${Math.abs(dollarImpact).toLocaleString()} saved in financing costs`
            : `${Math.abs(unitChange)} fewer days = $${Math.abs(dollarImpact).toLocaleString()} additional financing cost`,
      };
    },
  };

  // ============================================
  // Price Value Function
  // Value: Direct dollar impact
  // Formula: Direct price difference
  // ============================================

  functions['targetUnitPrice'] = {
    parameterId: 'targetUnitPrice',
    parameterName: 'Price',
    unitValue: 1, // $1 per $1
    unitDescription: 'per dollar',
    calculate: (current, proposed) => {
      const currentPrice = current ?? config.targetPrice;
      const proposedPrice = proposed ?? currentPrice;
      const dollarImpact = currentPrice - proposedPrice;
      const unitChange = proposedPrice - currentPrice;

      // Lower price = better for PM (positive value)
      const isFavorable = dollarImpact > 0;

      return {
        dollarImpact: Math.round(dollarImpact * 100) / 100,
        percentChange: currentPrice > 0 ? (unitChange / currentPrice) * 100 : 0,
        unitChange,
        isFavorable,
        narrative: unitChange === 0
          ? 'No change in price'
          : isFavorable
            ? `$${Math.abs(dollarImpact).toLocaleString()} price reduction`
            : `$${Math.abs(dollarImpact).toLocaleString()} price increase`,
      };
    },
  };

  // ============================================
  // Delivery Value Function
  // Value: Cost of delay (inventory holding, project delays)
  // Typical: 0.1-0.5% of deal value per day
  // ============================================

  const deliveryUnitValue = dealValue * 0.002; // 0.2% per day

  functions['deliveryDate'] = {
    parameterId: 'deliveryDate',
    parameterName: 'Delivery Time',
    unitValue: deliveryUnitValue,
    unitDescription: 'per day',
    calculate: (current, proposed) => {
      const currentDays = current ?? 30;
      const proposedDays = proposed ?? currentDays;
      const unitChange = proposedDays - currentDays;
      const dollarImpact = -unitChange * deliveryUnitValue; // Negative because delay is a cost

      // Faster delivery = better for PM
      const isFavorable = unitChange < 0;

      return {
        dollarImpact: Math.round(dollarImpact * 100) / 100,
        percentChange: currentDays > 0 ? (unitChange / currentDays) * 100 : 0,
        unitChange,
        isFavorable,
        narrative: unitChange === 0
          ? 'No change in delivery time'
          : isFavorable
            ? `${Math.abs(unitChange)} days faster = $${Math.abs(dollarImpact).toLocaleString()} value`
            : `${unitChange} days delay = $${Math.abs(dollarImpact).toLocaleString()} cost`,
      };
    },
  };

  // ============================================
  // Warranty Value Function
  // Value: Risk reduction per month of warranty
  // Formula: Expected defect rate × Repair cost × Time covered
  // ============================================

  const defectRate = 0.02; // 2% annual defect rate
  const avgRepairCost = dealValue * 0.15; // 15% of deal value to repair
  const warrantyUnitValue = (defectRate / 12) * avgRepairCost; // Per month

  functions['warrantyPeriod'] = {
    parameterId: 'warrantyPeriod',
    parameterName: 'Warranty Period',
    unitValue: warrantyUnitValue,
    unitDescription: 'per month of warranty',
    calculate: (current, proposed) => {
      const currentMonths = current ?? config.warrantyPeriodMonths;
      const proposedMonths = proposed ?? currentMonths;
      const unitChange = proposedMonths - currentMonths;
      const dollarImpact = unitChange * warrantyUnitValue;

      // Longer warranty = better for PM
      const isFavorable = unitChange > 0;

      return {
        dollarImpact: Math.round(dollarImpact * 100) / 100,
        percentChange: currentMonths > 0 ? (unitChange / currentMonths) * 100 : 0,
        unitChange,
        isFavorable,
        narrative: unitChange === 0
          ? 'No change in warranty period'
          : isFavorable
            ? `${unitChange} extra months warranty = $${Math.abs(dollarImpact).toLocaleString()} risk reduction`
            : `${Math.abs(unitChange)} fewer months warranty = $${Math.abs(dollarImpact).toLocaleString()} increased risk`,
      };
    },
  };

  // ============================================
  // Late Delivery Penalty Value Function
  // Value: Protection against delivery delays
  // ============================================

  const expectedDelay = 5; // Expected days of delay
  const lateDeliveryPenaltyUnitValue = dealValue * expectedDelay * 0.001; // Per 0.1% penalty

  functions['lateDeliveryPenalty'] = {
    parameterId: 'lateDeliveryPenalty',
    parameterName: 'Late Delivery Penalty',
    unitValue: lateDeliveryPenaltyUnitValue,
    unitDescription: 'per 0.1% daily penalty',
    calculate: (current, proposed) => {
      const currentPenalty = current ?? config.lateDeliveryPenaltyPerDay;
      const proposedPenalty = proposed ?? currentPenalty;
      const unitChange = proposedPenalty - currentPenalty;
      const dollarImpact = unitChange * lateDeliveryPenaltyUnitValue;

      // Higher penalty = better for PM
      const isFavorable = unitChange > 0;

      return {
        dollarImpact: Math.round(dollarImpact * 100) / 100,
        percentChange: currentPenalty > 0 ? (unitChange / currentPenalty) * 100 : 0,
        unitChange,
        isFavorable,
        narrative: unitChange === 0
          ? 'No change in late delivery penalty'
          : isFavorable
            ? `${unitChange}% higher penalty = $${Math.abs(dollarImpact).toLocaleString()} protection`
            : `${Math.abs(unitChange)}% lower penalty = $${Math.abs(dollarImpact).toLocaleString()} less protection`,
      };
    },
  };

  return functions;
}

// ============================================
// Value Analysis Functions
// ============================================

/**
 * Calculate complete value breakdown for an offer
 */
export function calculateOfferValue(
  currentOffer: ExtendedOffer,
  proposedOffer: ExtendedOffer,
  config: ResolvedNegotiationConfig,
  dealValue: number
): OfferValueBreakdown {
  const valueFunctions = createValueFunctions(config, dealValue);
  const parameterImpacts: Record<string, ValueImpact> = {};
  let totalDollarImpact = 0;

  // Calculate price impact
  if (valueFunctions['targetUnitPrice']) {
    const impact = valueFunctions['targetUnitPrice'].calculate(
      currentOffer.total_price,
      proposedOffer.total_price
    );
    parameterImpacts['targetUnitPrice'] = impact;
    totalDollarImpact += impact.dollarImpact;
  }

  // Calculate payment terms impact
  if (valueFunctions['paymentTermsRange']) {
    const impact = valueFunctions['paymentTermsRange'].calculate(
      currentOffer.payment_terms_days ?? null,
      proposedOffer.payment_terms_days ?? null
    );
    parameterImpacts['paymentTermsRange'] = impact;
    totalDollarImpact += impact.dollarImpact;
  }

  // Calculate delivery impact
  if (valueFunctions['deliveryDate']) {
    const impact = valueFunctions['deliveryDate'].calculate(
      currentOffer.delivery_days ?? null,
      proposedOffer.delivery_days ?? null
    );
    parameterImpacts['deliveryDate'] = impact;
    totalDollarImpact += impact.dollarImpact;
  }

  // Calculate warranty impact
  if (valueFunctions['warrantyPeriod']) {
    const impact = valueFunctions['warrantyPeriod'].calculate(
      currentOffer.warranty_months ?? null,
      proposedOffer.warranty_months ?? null
    );
    parameterImpacts['warrantyPeriod'] = impact;
    totalDollarImpact += impact.dollarImpact;
  }

  // Generate summaries
  const keyTradeoffs: string[] = [];
  const recommendations: string[] = [];

  for (const [param, impact] of Object.entries(parameterImpacts)) {
    if (Math.abs(impact.dollarImpact) > dealValue * 0.01) {
      // Significant impact (>1% of deal)
      keyTradeoffs.push(impact.narrative);
    }

    if (!impact.isFavorable && Math.abs(impact.dollarImpact) > dealValue * 0.02) {
      recommendations.push(
        `Consider negotiating ${valueFunctions[param]?.parameterName || param} - potential $${Math.abs(impact.dollarImpact).toLocaleString()} value`
      );
    }
  }

  const overall = totalDollarImpact >= 0
    ? `Net value gain of $${totalDollarImpact.toLocaleString()}`
    : `Net value loss of $${Math.abs(totalDollarImpact).toLocaleString()}`;

  return {
    totalDollarImpact,
    parameterImpacts,
    summaries: {
      overall,
      keyTradeoffs,
      recommendations,
    },
  };
}

/**
 * Analyze trade-off between two parameters
 */
export function analyzeTradeoff(
  param1: string,
  param1Change: number,
  param2: string,
  param2Change: number,
  config: ResolvedNegotiationConfig,
  dealValue: number
): TradeoffAnalysis {
  const valueFunctions = createValueFunctions(config, dealValue);

  const impact1 = valueFunctions[param1]?.calculate(null, param1Change);
  const impact2 = valueFunctions[param2]?.calculate(null, param2Change);

  if (!impact1 || !impact2) {
    return {
      gaining: '',
      losing: '',
      netImpact: 0,
      isFavorable: false,
      narrative: 'Unable to analyze trade-off',
    };
  }

  const netImpact = impact1.dollarImpact + impact2.dollarImpact;
  const gaining = impact1.dollarImpact > impact2.dollarImpact ? param1 : param2;
  const losing = impact1.dollarImpact > impact2.dollarImpact ? param2 : param1;

  return {
    gaining,
    losing,
    netImpact,
    isFavorable: netImpact > 0,
    narrative: `Trading ${valueFunctions[losing]?.parameterName} for ${valueFunctions[gaining]?.parameterName}: Net ${netImpact >= 0 ? 'gain' : 'loss'} of $${Math.abs(netImpact).toLocaleString()}`,
  };
}

/**
 * Calculate equivalent value trade-offs
 * e.g., "How much price increase is equivalent to 15 extra payment days?"
 */
export function calculateEquivalentValue(
  sourceParam: string,
  sourceChange: number,
  targetParam: string,
  config: ResolvedNegotiationConfig,
  dealValue: number
): { equivalentChange: number; narrative: string } {
  const valueFunctions = createValueFunctions(config, dealValue);

  const sourceFunc = valueFunctions[sourceParam];
  const targetFunc = valueFunctions[targetParam];

  if (!sourceFunc || !targetFunc) {
    return { equivalentChange: 0, narrative: 'Unable to calculate equivalent' };
  }

  const sourceImpact = sourceFunc.calculate(null, sourceChange);
  const equivalentChange = Math.abs(sourceImpact.dollarImpact) / targetFunc.unitValue;

  const rounded = Math.round(equivalentChange * 100) / 100;

  return {
    equivalentChange: rounded,
    narrative: `${sourceChange} ${sourceFunc.unitDescription} of ${sourceFunc.parameterName} is equivalent to ${rounded} ${targetFunc.unitDescription} of ${targetFunc.parameterName}`,
  };
}
