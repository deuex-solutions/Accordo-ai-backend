/**
 * processVendorTurn Module
 *
 * Vendor turn processor for INSIGHTS mode.
 * Uses the shared negotiation core for decision-making,
 * then applies template-based response generation.
 *
 * @module processVendorTurn
 */

import {
  runNegotiationCore,
  type NegotiationCoreResult,
} from "./process-negotiation-core.js";
import type { Offer, Decision, Explainability } from "./types.js";
import { sequelize } from "../../../config/database.js";
import logger from "../../../config/logger.js";
import models from "../../../models/index.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import type { ChatbotMessage } from "../../../models/chatbot-message.js";

// ============================================================================
// Types
// ============================================================================

export interface ProcessVendorTurnInput {
  dealId: string;
  vendorMessage: string;
  userId: number;
}

export interface ProcessVendorTurnResult {
  extractedOffer: Offer | null;
  decision: Decision;
  accordoMessage: ChatbotMessage;
  vendorMessageRecord: ChatbotMessage;
  explainability: Explainability | null;
  updatedDeal: ChatbotDeal;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate Accordo response message based on decision (template-based for INSIGHTS)
 */
function generateAccordoResponse(decision: Decision, _round: number): string {
  const { action, counterOffer } = decision;

  switch (action) {
    case "ACCEPT":
      return `Great! I accept your offer. Let's finalize the agreement.`;

    case "COUNTER":
      if (
        !counterOffer ||
        !counterOffer.total_price ||
        !counterOffer.payment_terms
      ) {
        return `I'd like to discuss this further. Can we explore other options?`;
      }
      return `Thank you for your offer. I'd like to propose a counter-offer: $${counterOffer.total_price.toFixed(
        2,
      )} per unit with ${counterOffer.payment_terms} payment terms. Does this work for you?`;

    case "WALK_AWAY":
      return `I appreciate your time, but unfortunately your offer exceeds our budget constraints. We'll need to explore other options.`;

    case "ESCALATE":
      return `We've reached the maximum number of negotiation rounds. I'll need to escalate this to my team for further review.`;

    case "ASK_CLARIFY":
      return `I'd like to clarify your offer. Could you please provide both the unit price and payment terms explicitly?`;

    default:
      return `I've received your message. Let me review and get back to you.`;
  }
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Process a vendor turn in INSIGHTS mode.
 *
 * Uses shared negotiation core for decision-making,
 * then applies template-based response generation and saves to DB.
 */
export async function processVendorTurn(
  input: ProcessVendorTurnInput,
): Promise<ProcessVendorTurnResult> {
  const { dealId, vendorMessage } = input;

  // Start database transaction
  const transaction = await sequelize.transaction();

  try {
    // 1. Run shared negotiation core (offer parsing → utility → decision)
    const core: NegotiationCoreResult = await runNegotiationCore({
      dealId,
      vendorMessage,
    });

    // 2. Validate mode
    if (core.deal.mode !== "INSIGHTS") {
      throw new Error(
        `Deal ${dealId} is in ${core.deal.mode} mode. processVendorTurn only works for INSIGHTS mode.`,
      );
    }

    // 3. Generate template-based response (INSIGHTS mode)
    const accordoContent = generateAccordoResponse(
      core.decision,
      core.currentRound,
    );
    logger.info(
      `[processVendorTurn] Generated INSIGHTS response: "${accordoContent}"`,
    );

    // 4. Save vendor message record
    const vendorMessageRecord = await models.ChatbotMessage.create(
      {
        dealId: core.deal.id,
        role: "VENDOR",
        content: vendorMessage,
        extractedOffer:
          core.extractedOffer.total_price !== null ||
          core.extractedOffer.payment_terms !== null
            ? (core.extractedOffer as any)
            : null,
        engineDecision: null,
        decisionAction: null,
        utilityScore: null,
        counterOffer: null,
        explainabilityJson: null,
      },
      { transaction },
    );

    // 5. Save Accordo response message record
    const accordoMessageRecord = await models.ChatbotMessage.create(
      {
        dealId: core.deal.id,
        role: "ACCORDO",
        content: accordoContent,
        extractedOffer: null,
        engineDecision: core.decision as any,
        decisionAction: core.decision.action,
        utilityScore: core.decision.utilityScore ?? null,
        counterOffer: core.decision.counterOffer as any,
        explainabilityJson: core.explainability as any,
      },
      { transaction },
    );

    // 6. Update deal state
    await core.deal.update(
      {
        round: core.currentRound,
        status: core.newStatus,
        latestOfferJson: core.extractedOffer,
        latestVendorOffer: core.extractedOffer,
        latestDecisionAction: core.decision.action,
        latestUtility: core.decision.utilityScore ?? null,
        lastMessageAt: new Date(),
      },
      { transaction },
    );

    // 7. Commit transaction
    await transaction.commit();

    logger.info(
      `[processVendorTurn] Successfully processed vendor turn for deal ${dealId}`,
    );

    return {
      extractedOffer: core.extractedOffer,
      decision: core.decision,
      accordoMessage: accordoMessageRecord,
      vendorMessageRecord,
      explainability: core.explainability,
      updatedDeal: core.deal,
    };
  } catch (error) {
    await transaction.rollback();
    logger.error(`[processVendorTurn] Failed for deal ${dealId}:`, error);
    throw error;
  }
}

export default processVendorTurn;
