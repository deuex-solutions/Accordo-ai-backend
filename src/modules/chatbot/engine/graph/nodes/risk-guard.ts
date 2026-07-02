import { NegotiationState } from "../state.js";
import logger from "../../../../../config/logger.js";

/**
 * 4. RiskGuard
 * 
 * Pre-reply compliance validator. Ensures the composed message adheres to policy limits.
 * Handles the human-in-the-loop approval routing for high-value contracts.
 */
export const riskGuardAgent = async (state: NegotiationState) => {
  logger.info("[Agent: RiskGuard] Running compliance and policy validation");

  const dealPrice = Math.max(
    state.counterOffer?.totalPrice || 0,
    state.parsedOffer?.totalPrice || 0,
    state.config?.priceQuantity?.maxAcceptablePrice || 0
  );

  const currency = state.config?.currency || "USD";
  const HIGH_VALUE_THRESHOLD = 1000000000; // 1 Billion

  const isHighValue = dealPrice >= HIGH_VALUE_THRESHOLD;
  const isApproved = state.metadata?.approvedByHuman === true;

  if (isHighValue && !isApproved) {
    logger.warn("[Agent: RiskGuard] High-value deal requires manual approval. Halting flow.");
    return {
      waitingForHuman: true,
      metadata: {
        ...state.metadata,
        approvalStatus: "APPROVAL_REQUIRED",
        pausedAt: new Date().toISOString(),
      }
    };
  }

  logger.info("[Agent: RiskGuard] Compliance checks passed successfully.");
  return {
    metadata: {
      ...state.metadata,
      approvalStatus: isHighValue ? "APPROVED" : "NOT_REQUIRED",
      validatedAt: new Date().toISOString(),
    }
  };
};
