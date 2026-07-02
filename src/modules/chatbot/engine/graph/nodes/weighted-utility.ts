import { NegotiationState } from "../state.js";
import { calculateWeightedUtilityFromResolved } from "../../weighted-utility.js";
import logger from "../../../../../config/logger.js";

/**
 * WeightedUtilityNode (Track 1: Vatsal)
 * 
 * Calculates the overall utility of the parsed vendor offer using configured weights and parameters.
 * Stores the utility result in state.metadata.utilityResult and updates state.decision.utilityScore.
 */
export const weightedUtilityNode = async (state: NegotiationState) => {
  logger.info(`[Node: weighted_utility] Calculating offer utility...`);

  const parsedOffer = state.parsedOffer;
  const config = state.config;

  if (!parsedOffer) {
    logger.warn(`[Node: weighted_utility] No parsedOffer in state. Skipping.`);
    return {};
  }

  if (!config) {
    logger.warn(`[Node: weighted_utility] No config in state. Skipping.`);
    return {};
  }

  // Extract weights
  const weights = {
    targetUnitPrice: config.parameterWeights?.targetUnitPrice || 0,
    paymentTerms: config.parameterWeights?.paymentTermsDays || 0,
    deliveryDate: config.parameterWeights?.deliveryDate || 0,
    warrantyPeriod: config.parameterWeights?.warrantyMonths || 0,
    qualityStandards: config.parameterWeights?.qualityCertifications || 0,
  };

  const resolvedConfig = {
    weights,
    targetPrice: config.priceQuantity?.targetUnitPrice || 0,
    maxAcceptablePrice: config.priceQuantity?.maxAcceptablePrice || 0,
    costOfCapital: config.costOfCapital !== undefined ? config.costOfCapital : 0.1000,
    paymentTermsMinDays: config.paymentTerms?.minDays || 0,
    paymentTermsMaxDays: config.paymentTerms?.maxDays || 0,
    deliveryDate: config.deliveryDate ? new Date(config.deliveryDate) : undefined,
    preferredDeliveryDate: config.preferredDeliveryDate ? new Date(config.preferredDeliveryDate) : undefined,
    warrantyPeriodMonths: config.warrantyPeriodMonths || 12,
    qualityStandards: config.qualityStandards || [],
  };

  // Map parsedOffer to ExtendedOffer format (snake_case)
  const legacyOffer = {
    total_price: parsedOffer.totalPrice,
    unit_price: parsedOffer.unitPrice,
    payment_terms: parsedOffer.paymentTerms,
    payment_terms_days: parsedOffer.paymentTermsDays,
    delivery_days: parsedOffer.deliveryDays,
    warranty_months: parsedOffer.warrantyMonths,
    quality_certifications: parsedOffer.qualityCertifications,
  };

  try {
    const utilityResult = calculateWeightedUtilityFromResolved(legacyOffer as any, resolvedConfig as any);
    logger.info(`[Node: weighted_utility] Utility score: ${utilityResult.totalUtilityPercent.toFixed(1)}%`);

    return {
      decision: state.decision ? {
        ...state.decision,
        utilityScore: utilityResult.totalUtility,
      } : {
        action: "COUNTER" as const,
        reasoning: `Calculated utility score: ${utilityResult.totalUtilityPercent.toFixed(1)}%`,
        confidence: 1.0,
        utilityScore: utilityResult.totalUtility,
      },
      metadata: {
        ...state.metadata,
        utilityResult,
      }
    };
  } catch (err) {
    logger.error(`[Node: weighted_utility] Failed to calculate utility`, err);
    return {};
  }
};
