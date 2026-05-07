/**
 * Chatbot Service Integration
 *
 * This service provides integration between other modules (like Contract)
 * and the chatbot negotiation system.
 */

import { v4 as uuidv4 } from 'uuid';
import models from '../models/index.js';
import logger from '../config/logger.js';
import type { ChatbotDeal } from '../models/chatbot-deal.js';

/**
 * Create a chatbot deal when vendor is attached to contract
 *
 * This function is called automatically when a contract is created with a vendor.
 * It creates a CONVERSATION mode deal linked to the contract and requisition.
 *
 * @param vendorName - Name of the vendor company
 * @param projectName - Name of the project
 * @param requisitionTitle - Title of the requisition
 * @param requisitionId - Requisition ID (optional)
 * @param contractId - Contract ID (optional)
 * @param userId - Internal user managing the deal (optional)
 * @param vendorId - Vendor user ID (optional)
 * @returns Deal UUID
 */
export async function createDeal(
  vendorName: string,
  projectName: string,
  requisitionTitle: string,
  requisitionId?: number,
  contractId?: number,
  userId?: number,
  vendorId?: number
): Promise<string> {
  try {
    // Generate deal title: "{ProjectName} - {RequisitionTitle}"
    const title = `${projectName} - ${requisitionTitle}`;

    logger.info('[ChatbotService] Creating deal for contract', {
      title,
      vendorName,
      requisitionId,
      contractId,
      userId,
      vendorId,
    });

    // Create deal in CONVERSATION mode (vendor attached)
    const deal = (await models.ChatbotDeal.create({
      id: uuidv4(),
      title,
      counterparty: vendorName,
      mode: 'CONVERSATION',
      status: 'NEGOTIATING',
      round: 0,
      latestOfferJson: null,
      latestVendorOffer: null,
      latestDecisionAction: null,
      latestUtility: null,
      convoStateJson: null, // Will be initialized when conversation starts
      templateId: null, // Will use default template from requisition
      requisitionId: requisitionId || null,
      contractId: contractId || null,
      userId: userId || null,
      vendorId: vendorId || null,
      archivedAt: null,
      deletedAt: null,
      lastAccessed: new Date(),
      lastMessageAt: null,
      viewCount: 0,
    })) as ChatbotDeal;

    logger.info('[ChatbotService] Deal created successfully', {
      dealId: deal.id,
      title: deal.title,
    });

    return deal.id;
  } catch (error) {
    logger.error('[ChatbotService] Failed to create deal', {
      vendorName,
      projectName,
      requisitionTitle,
      error: error instanceof Error ? error.message : String(error),
    });

    // Don't throw error - allow contract creation to proceed even if chatbot deal fails
    logger.warn('[ChatbotService] Returning null due to chatbot deal creation failure');
    return null as any; // Return null to indicate failure (contract service handles this)
  }
}

/**
 * Track deal access for history
 *
 * Increments view count and updates last accessed timestamp
 *
 * @param dealId - Deal UUID
 */
export async function trackDealAccess(dealId: string): Promise<void> {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      logger.warn('[ChatbotService] Deal not found for tracking', { dealId });
      return;
    }

    await deal.update({
      lastAccessed: new Date(),
      viewCount: (deal.viewCount || 0) + 1,
    });

    logger.debug('[ChatbotService] Deal access tracked', {
      dealId,
      viewCount: deal.viewCount,
    });
  } catch (error) {
    logger.error('[ChatbotService] Failed to track deal access', {
      dealId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - tracking failure shouldn't break the app
  }
}

/**
 * Update last message timestamp
 *
 * Called automatically when a message is added to a deal
 *
 * @param dealId - Deal UUID
 */
export async function updateLastMessageTimestamp(dealId: string): Promise<void> {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId);
    if (!deal) {
      logger.warn('[ChatbotService] Deal not found for message timestamp update', { dealId });
      return;
    }

    await deal.update({
      lastMessageAt: new Date(),
    });

    logger.debug('[ChatbotService] Last message timestamp updated', { dealId });
  } catch (error) {
    logger.error('[ChatbotService] Failed to update last message timestamp', {
      dealId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - tracking failure shouldn't break the app
  }
}
