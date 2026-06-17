import { NegotiationState } from "../state.js";
import { NodeName } from "../types.js";
import models from "../../../../../models/index.js";
import { getDealSummaryService } from "../../../chatbot.service.js";
import { saveDealSummaryPDF } from "../../../pdf/deal-summary-pdf-generator.js";
import { generateAndSendComparison, checkCompletionStatus } from "../../../../bid-comparison/bid-comparison.service.js";
import logger from "../../../../../config/logger.js";

/**
 * DocumentGenerationNode (Track 3: Adarsh)
 * 
 * Responsibilities:
 * - Generates individual deal summary PDFs once a deal is completed.
 * - Saves the PDF to the designated upload directory.
 * - Triggers batch bid comparison PDF reports if all vendor negotiations for the RFQ are complete.
 * 
 * @source src/modules/chatbot/pdf/deal-summary-pdf-generator.ts
 * @source src/modules/bid-comparison/bid-comparison.service.ts
 */
export const documentGenerationNode = async (state: NegotiationState) => {
  logger.info(`[Node: document_generation] Evaluating document generation triggers...`);

  const dealId = state.dealId;
  const rfqId = state.rfqId;

  if (!dealId) {
    logger.warn(`[Node: document_generation] No dealId present in state. Skipping.`);
    return {};
  }

  // Load the current status of the deal from the DB
  const deal = await models.ChatbotDeal.findByPk(dealId, {
    include: [
      {
        model: models.ChatbotMessage,
        as: "Messages",
        order: [["createdAt", "ASC"]],
      },
    ],
  });

  if (!deal) {
    logger.error(`[Node: document_generation] ChatbotDeal with ID ${dealId} not found.`);
    return {};
  }

  const oldStatus = deal.status;
  const newStatus = state.metadata?.dealStatus || oldStatus;

  const pdfGenerated = state.metadata?.pdfGenerated || false;
  let pdfPath = state.metadata?.pdfPath || null;
  let comparisonPath = state.metadata?.comparisonPath || null;

  // 1. Generate individual Deal Summary PDF on terminal state transition
  const isTerminal = ["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(newStatus);

  if (isTerminal && !pdfGenerated) {
    try {
      logger.info(`[Node: document_generation] Generating Deal Summary PDF for deal ${dealId}...`);

      // Fetch summary details
      const summary = await getDealSummaryService(dealId);
      const messages = (deal.Messages || []) as any[];

      // Pair vendor offer & accordo response prices
      const timelineWithPrices = summary.timeline.map((item) => {
        let vendorPrice: number | null = null;
        let accordoPrice: number | null = null;

        const vendorMatch = item.vendorOffer.match(/\$[\d,]+(?:\.\d{2})?/);
        if (vendorMatch) {
          vendorPrice = parseFloat(vendorMatch[0].replace(/[$,]/g, ""));
        }

        const accordoMatch = item.accordoResponse.match(/\$[\d,]+(?:\.\d{2})?/);
        if (accordoMatch) {
          accordoPrice = parseFloat(accordoMatch[0].replace(/[$,]/g, ""));
        }

        return {
          ...item,
          vendorPrice,
          accordoPrice,
        };
      });

      const pdfInput = {
        deal: summary.deal,
        finalOffer: summary.finalOffer,
        metrics: summary.metrics,
        timeline: timelineWithPrices,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt.toISOString(),
          extractedOffer: m.extractedOffer,
        })),
        rfqId: rfqId || 0,
        generatedAt: new Date(),
      };

      pdfPath = await saveDealSummaryPDF(pdfInput);
      logger.info(`[Node: document_generation] Deal Summary PDF saved to ${pdfPath}`);
    } catch (err) {
      logger.error(`[Node: document_generation] Failed to generate Deal Summary PDF`, err);
    }
  }

  // 2. Batch trigger for RFQ Bid Comparison PDF if all vendor negotiations are complete
  if (isTerminal && rfqId) {
    try {
      const completionStatus = await checkCompletionStatus(rfqId);
      if (completionStatus.allCompleted) {
        logger.info(`[Node: document_generation] All bids for RFQ ${rfqId} completed. Generating Comparison PDF...`);
        const comparisonResult = await generateAndSendComparison(rfqId, "ALL_COMPLETED");
        comparisonPath = comparisonResult.pdfPath;
        logger.info(`[Node: document_generation] Bid Comparison PDF generated and sent. Path: ${comparisonPath}`);
      }
    } catch (err) {
      logger.error(`[Node: document_generation] Failed to trigger RFQ Bid Comparison PDF`, err);
    }
  }

  return {
    metadata: {
      ...state.metadata,
      pdfGenerated: isTerminal ? true : pdfGenerated,
      pdfPath,
      comparisonPath,
    },
  };
};
