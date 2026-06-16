import { NegotiationState } from "../state.js";
import { captureVendorBid, checkCompletionStatus, generateAndSendComparison } from "../../../../bid-comparison/bid-comparison.service.js";
import logger from "../../../../../config/logger.js";

/**
 * BidComparisonNode (Track 3: Adarsh)
 * 
 * Responsibilities:
 * - On terminal transitions, captures the final negotiated bid and saves it in the db.
 * - Checks if negotiations are complete across all invited vendors for this RFQ.
 * - If complete, generates the consolidated Bid Comparison PDF report and alerts the purchasing manager.
 */
export const bidComparisonNode = async (state: NegotiationState) => {
  logger.info(`[Node: bid_comparison] Running bid comparison node...`);

  const dealId = state.dealId;
  const rfqId = state.rfqId;

  if (!dealId || !rfqId) {
    logger.warn(`[Node: bid_comparison] Missing dealId or rfqId in state. Skipping.`);
    return {};
  }

  const dealStatus = state.metadata?.dealStatus || "NEGOTIATING";
  const isTerminal = ["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(dealStatus);

  if (!isTerminal) {
    logger.info(`[Node: bid_comparison] Deal is active (${dealStatus}). Skipping bid capture.`);
    return {};
  }

  try {
    logger.info(`[Node: bid_comparison] Capturing vendor bid for deal ${dealId}...`);
    await captureVendorBid(dealId);

    logger.info(`[Node: bid_comparison] Checking completion status for RFQ ${rfqId}...`);
    const status = await checkCompletionStatus(rfqId);

    if (status.allCompleted) {
      logger.info(`[Node: bid_comparison] All bids for RFQ ${rfqId} completed! Triggering comparison report...`);
      const comparisonResult = await generateAndSendComparison(rfqId, status.triggerReason || "ALL_COMPLETED");
      
      logger.info(`[Node: bid_comparison] Generated comparison report. ID: ${comparisonResult.comparisonId}`);
      return {
        metadata: {
          ...state.metadata,
          bidComparisonResult: {
            allCompleted: true,
            comparisonId: comparisonResult.comparisonId,
            pdfPath: comparisonResult.pdfPath,
          }
        }
      };
    } else {
      logger.info(`[Node: bid_comparison] RFQ ${rfqId} has pending bids. Skipping report.`);
      return {
        metadata: {
          ...state.metadata,
          bidComparisonResult: {
            allCompleted: false,
          }
        }
      };
    }
  } catch (err) {
    logger.error(`[Node: bid_comparison] Failed to run bid comparison node`, err);
    return {};
  }
};
