/**
 * Vendor Simulator Service
 *
 * Handles autopilot vendor message generation for demo scenarios.
 * Powers the "Auto Next" button in VendorControls and demo mode.
 */

import { generateVendorReply } from './vendor-agent.js';
import * as chatbotService from '../chatbot.service.js';
import { CustomError } from '../../../utils/custom-error.js';
import logger from '../../../config/logger.js';
import type { VendorScenario } from './types.js';
import type { ChatbotMessage } from '../../../models/chatbot-message.js';
import type { ChatbotDeal } from '../../../models/chatbot-deal.js';
import type { Offer } from '../engine/types.js';

/**
 * Input for generating next vendor message
 */
export interface GenerateVendorMessageInput {
  dealId: string;
  scenario: VendorScenario;
  userId?: number; // Optional, for permission checking
}

/**
 * Result of vendor message generation
 */
export interface VendorMessageResult {
  vendorMessage: ChatbotMessage;
  accordoMessage: ChatbotMessage | null;
  deal: ChatbotDeal;
  completed: boolean; // True if deal reached terminal state
}

/**
 * Generate next vendor message for a deal (autopilot)
 *
 * Algorithm:
 * 1. Load deal and validate state
 * 2. Get Accordo's last counter-offer (if any)
 * 3. Generate vendor message using vendorAgent
 * 4. Save vendor message to database
 * 5. Process vendor message through decision engine
 * 6. Return vendor message + Accordo's response + updated deal
 *
 * @param input - Vendor message generation input
 * @returns Generated vendor message and Accordo's response
 */
export async function generateNextVendorMessage(
  input: GenerateVendorMessageInput
): Promise<VendorMessageResult> {
  const { dealId, scenario, userId } = input;

  try {
    logger.info('[VendorSimulator] Generating next vendor message', {
      dealId,
      scenario,
      userId,
    });

    // Get deal with messages
    const dealData = await chatbotService.getDealService(dealId);
    const { deal, messages } = dealData;

    // Validate deal is in negotiable state
    if (deal.status === 'ACCEPTED') {
      throw new CustomError('Deal is already accepted', 400);
    }
    if (deal.status === 'WALKED_AWAY') {
      throw new CustomError('Deal has already been walked away from', 400);
    }
    if (deal.status === 'ESCALATED') {
      throw new CustomError('Deal has been escalated to human', 400);
    }

    // Validate deal mode is INSIGHTS (demo mode)
    if (deal.mode !== 'INSIGHTS') {
      throw new CustomError('Vendor simulation only works in INSIGHTS mode', 400);
    }

    // Get last Accordo message to extract counter-offer
    const lastAccordoMessage = messages
      .filter((m) => m.role === 'ACCORDO')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    const lastAccordoOffer = (lastAccordoMessage?.counterOffer as Offer) || null;

    // Extract PM's price config from deal configuration
    // This ensures vendor offers are ABOVE PM's target price
    const configJson = deal.negotiationConfigJson as Record<string, unknown> | null;
    const wizardConfig = configJson?.wizardConfig as Record<string, unknown> | undefined;
    const priceQuantity = (wizardConfig?.priceQuantity || configJson?.priceQuantity || {}) as {
      targetUnitPrice?: number;
      maxAcceptablePrice?: number;
    };

    const pmPriceConfig = priceQuantity.targetUnitPrice && priceQuantity.maxAcceptablePrice
      ? {
          targetUnitPrice: priceQuantity.targetUnitPrice,
          maxAcceptablePrice: priceQuantity.maxAcceptablePrice,
        }
      : undefined;

    logger.info('[VendorSimulator] PM price config extracted', {
      dealId,
      pmPriceConfig,
      hasConfig: !!pmPriceConfig,
    });

    // Generate vendor reply using vendorAgent
    const vendorReplyResult = await generateVendorReply({
      dealId,
      round: deal.round,
      lastAccordoOffer,
      scenario,
      customPolicy: undefined, // Use default scenario policy
      pmPriceConfig, // Pass PM's price config for correct vendor pricing
    });

    if (!vendorReplyResult.success || !vendorReplyResult.data) {
      throw new CustomError(
        vendorReplyResult.message || 'Failed to generate vendor reply',
        500
      );
    }

    const { content, offer } = vendorReplyResult.data;

    // Save vendor message to database
    const vendorMessage = await chatbotService.createMessageService({
      dealId,
      role: 'VENDOR',
      content,
      extractedOffer: offer as Offer,
    });

    logger.info('[VendorSimulator] Vendor message saved', {
      dealId,
      messageId: vendorMessage.id,
      offer,
    });

    // Process vendor message through decision engine (INSIGHTS mode)
    const processResult = await chatbotService.processVendorMessageService({
      dealId,
      content,
      role: 'VENDOR',
      userId: userId || 0, // Use 0 for system/autopilot
    });

    const { accordoMessage, decision } = processResult;

    // Reload deal to get updated status
    const updatedDealData = await chatbotService.getDealService(dealId);
    const updatedDeal = updatedDealData.deal;

    // Check if deal reached terminal state
    const completed =
      updatedDeal.status === 'ACCEPTED' ||
      updatedDeal.status === 'WALKED_AWAY' ||
      updatedDeal.status === 'ESCALATED';

    logger.info('[VendorSimulator] Vendor message processed', {
      dealId,
      vendorMessageId: vendorMessage.id,
      accordoMessageId: accordoMessage.id,
      decision: decision.action,
      completed,
      finalStatus: updatedDeal.status,
    });

    return {
      vendorMessage,
      accordoMessage,
      deal: updatedDeal,
      completed,
    };
  } catch (error) {
    logger.error('[VendorSimulator] Failed to generate vendor message', {
      dealId,
      scenario,
      error: error instanceof Error ? error.message : String(error),
    });

    if (error instanceof CustomError) {
      throw error;
    }

    throw new CustomError(
      `Failed to generate vendor message: ${error instanceof Error ? error.message : String(error)}`,
      500
    );
  }
}

/**
 * Validate scenario parameter
 *
 * @param scenario - Scenario string to validate
 * @returns Validated scenario
 */
export function validateScenario(scenario: string): VendorScenario {
  const validScenarios: VendorScenario[] = ['HARD', 'SOFT', 'WALK_AWAY'];

  if (!validScenarios.includes(scenario as VendorScenario)) {
    throw new CustomError(
      `Invalid scenario: ${scenario}. Must be one of: ${validScenarios.join(', ')}`,
      400
    );
  }

  return scenario as VendorScenario;
}
