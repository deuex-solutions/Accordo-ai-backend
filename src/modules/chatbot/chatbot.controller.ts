import { Request, Response, NextFunction } from 'express';
import * as chatbotService from './chatbot.service.js';
import { CustomError } from '../../utils/custom-error.js';
import logger from '../../config/logger.js';
import { getParam, getNumericParam } from '../../types/index.js';

/**
 * Chatbot Controller
 * Handles HTTP requests for negotiation chatbot operations
 */

/**
 * Create a new negotiation deal
 * POST /api/chatbot/deals
 */
export const createDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { title, counterparty, mode, templateId, requisitionId, contractId, vendorId } = req.body;

    if (!title) {
      throw new CustomError('Title is required', 400);
    }

    const deal = await chatbotService.createDealService({
      title,
      counterparty,
      mode,
      templateId,
      requisitionId,
      contractId,
      userId: req.context.userId,
      vendorId,
    });

    logger.info(`Deal created: ${deal.id} by user ${req.context.userId}`);
    res.status(201).json({ message: 'Deal created successfully', data: deal });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new deal with full wizard configuration
 * POST /api/chatbot/deals/with-config
 */
export const createDealWithConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const result = await chatbotService.createDealWithConfigService({
      ...req.body,
      userId: req.context.userId,
    });

    logger.info(`Deal with config created: ${result.id} by user ${req.context.userId}`);

    // Determine message based on email status
    const emailStatus = (result as any).emailStatus;
    let message = 'Deal created successfully';
    if (emailStatus && !emailStatus.success) {
      message = 'Deal created successfully, but email notification to vendor failed';
    } else if (emailStatus && emailStatus.success) {
      message = 'Deal created successfully and email notification sent to vendor';
    }

    res.status(201).json({ message, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Get smart defaults for a vendor/RFQ combination
 * NEW: GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/smart-defaults (path params)
 * LEGACY: GET /api/chatbot/deals/smart-defaults?rfqId=X&vendorId=Y (query params)
 */
export const getSmartDefaults = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Support both path params (new) and query params (legacy)
    const rfqIdParam = req.params.rfqId || req.query.rfqId;
    const vendorIdParam = req.params.vendorId || req.query.vendorId;

    if (!rfqIdParam || !vendorIdParam) {
      throw new CustomError('rfqId and vendorId are required', 400);
    }

    const defaults = await chatbotService.getSmartDefaultsService(
      getNumericParam(rfqIdParam as string),
      getNumericParam(vendorIdParam as string)
    );

    res.status(200).json({ message: 'Smart defaults retrieved successfully', data: defaults });
  } catch (error) {
    next(error);
  }
};

/**
 * Look up a deal by ID only (no nested path required)
 * GET /api/chatbot/deals/:dealId/lookup
 *
 * This is a convenience endpoint for the frontend when only dealId is available
 * (e.g., from URL params). Returns the deal with its context (rfqId, vendorId)
 * which can then be used for subsequent nested API calls.
 *
 * NOTE: Returns 400 if deal is missing requisitionId or vendorId since these
 * are required for the hierarchical API structure.
 */
export const lookupDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.getDealService(dealId);

    // Validate that the deal has the required context values for nested URLs
    if (!result.deal.requisitionId || !result.deal.vendorId) {
      throw new CustomError(
        'Deal is missing required requisitionId or vendorId. This deal cannot be used with the hierarchical API structure.',
        400
      );
    }

    // Return deal with context for frontend to use in subsequent calls
    res.status(200).json({
      message: 'Deal lookup successful',
      data: {
        deal: result.deal,
        messages: result.messages,
        // Context for nested URL construction
        context: {
          rfqId: result.deal.requisitionId,
          vendorId: result.deal.vendorId,
          dealId: result.deal.id,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a deal with messages
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId
 */
export const getDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.getDealService(dealId);

    res.status(200).json({ message: 'Deal retrieved successfully', data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * List deals with filters
 * GET /api/chatbot/deals
 */
export const listDeals = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      status,
      mode,
      archived,
      deleted,
      userId,
      vendorId,
      page = 1,
      limit = 10,
    } = req.query;

    const filters: chatbotService.ListDealsFilters = {};
    if (status) filters.status = status as any;
    if (mode) filters.mode = mode as any;
    if (archived !== undefined) filters.archived = archived === 'true';
    if (deleted !== undefined) filters.deleted = deleted === 'true';
    if (userId) filters.userId = parseInt(userId as string, 10);
    if (vendorId) filters.vendorId = parseInt(vendorId as string, 10);
    filters.companyId = req.context?.companyId || null;

    const result = await chatbotService.listDealsService(
      filters,
      parseInt(page as string, 10),
      parseInt(limit as string, 10)
    );

    res.status(200).json({ message: 'Deals retrieved successfully', data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Process a vendor message (INSIGHTS mode)
 * POST /api/chatbot/deals/:dealId/messages
 */
export const processVendorMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content, role = 'VENDOR' } = req.body;

    if (!content) {
      throw new CustomError('Message content is required', 400);
    }

    const result = await chatbotService.processVendorMessageService({
      dealId,
      content,
      role,
      userId: req.context.userId,
    });

    logger.info(
      `Vendor message processed for deal ${dealId}: ${result.decision.action}`
    );

    // Fetch updated deal and all messages to return to frontend
    const dealWithMessages = await chatbotService.getDealService(dealId);

    res.status(200).json({
      message: 'Message processed successfully',
      data: {
        deal: dealWithMessages.deal,
        messages: dealWithMessages.messages,
        latestMessage: result.message,
        decision: result.decision,
        explainability: result.explainability,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Reset a deal (clear messages and state)
 * POST /api/chatbot/deals/:dealId/reset
 */
export const resetDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const deal = await chatbotService.resetDealService(dealId);

    logger.info(`Deal reset: ${dealId} by user ${req.context.userId}`);
    res.status(200).json({
      message: 'Deal reset successfully',
      data: {
        deal,
        messages: [], // Messages are cleared on reset
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get negotiation config for a deal
 * GET /api/chatbot/deals/:dealId/config
 */
export const getDealConfig = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const config = await chatbotService.getDealConfigService(dealId);

    res.status(200).json({ message: 'Config retrieved successfully', data: { config } });
  } catch (error) {
    next(error);
  }
};

/**
 * Get last explainability for a deal
 * GET /api/chatbot/deals/:dealId/explainability
 */
export const getLastExplainability = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const explainability = await chatbotService.getLastExplainabilityService(dealId);

    if (!explainability) {
      throw new CustomError('No explainability data found', 404);
    }

    res.status(200).json({
      message: 'Explainability retrieved successfully',
      data: explainability,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Archive a deal
 * POST /api/chatbot/deals/:dealId/archive
 */
export const archiveDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const deal = await chatbotService.archiveDealService(dealId);

    logger.info(`Deal archived: ${dealId} by user ${req.context.userId}`);
    res.status(200).json({ message: 'Deal archived successfully', data: deal });
  } catch (error) {
    next(error);
  }
};

/**
 * Unarchive a deal
 * POST /api/chatbot/deals/:dealId/unarchive
 */
export const unarchiveDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const deal = await chatbotService.unarchiveDealService(dealId);

    logger.info(`Deal unarchived: ${dealId} by user ${req.context.userId}`);
    res.status(200).json({ message: 'Deal unarchived successfully', data: deal });
  } catch (error) {
    next(error);
  }
};

/**
 * Retry sending deal notification email to vendor
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/retry-email
 */
export const retryDealEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.retryDealEmailService(dealId);

    if (result.success) {
      logger.info(`Deal email retried successfully: ${dealId} by user ${req.context.userId}`);
      res.status(200).json({
        message: 'Email sent successfully',
        data: result,
      });
    } else {
      logger.warn(`Deal email retry failed: ${dealId} - ${result.error}`);
      res.status(200).json({
        message: 'Email retry failed',
        data: result,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Create a system message
 * POST /api/chatbot/deals/:dealId/system-message
 */
export const createSystemMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content } = req.body;

    if (!content) {
      throw new CustomError('Message content is required', 400);
    }

    const message = await chatbotService.createSystemMessageService(dealId, content);

    res.status(201).json({ message: 'System message created successfully', data: message });
  } catch (error) {
    next(error);
  }
};

/**
 * ==================== CONVERSATION MODE CONTROLLERS ====================
 */

/**
 * Start a conversation (CONVERSATION mode only)
 * POST /api/chatbot/conversation/deals/:dealId/start
 */
export const startConversation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const userId = req.context.userId;

    const { startConversation } = await import('./convo/conversationService.js');
    const result = await startConversation(dealId, userId);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Send a message in conversation mode
 * POST /api/chatbot/conversation/deals/:dealId/messages
 */
export const sendConversationMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content } = req.body;
    const userId = req.context.userId;

    if (!content) {
      throw new CustomError('Message content is required', 400);
    }

    const { processConversationMessage } = await import('./convo/conversationService.js');
    const result = await processConversationMessage({
      dealId,
      vendorMessage: content,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Get last explainability for conversation mode
 * GET /api/chatbot/conversation/deals/:dealId/explainability
 */
export const getConversationExplainability = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const userId = req.context.userId;

    const { getLastExplainability } = await import('./convo/conversationService.js');
    const explainability = await getLastExplainability(dealId, userId);

    if (!explainability) {
      res.status(404).json({ message: 'No explainability available for this deal' });
      return;
    }

    res.status(200).json({ message: 'Explainability retrieved successfully', data: explainability });
  } catch (error) {
    next(error);
  }
};

/**
 * ==================== DEMO MODE CONTROLLERS ====================
 */

/**
 * Run full demo negotiation with autopilot vendor
 * POST /api/chatbot/deals/:dealId/run-demo
 *
 * Request body:
 * {
 *   "scenario": "HARD" | "SOFT" | "WALK_AWAY",
 *   "maxRounds"?: number  // Default: 10
 * }
 *
 * Response:
 * {
 *   "message": "Demo completed successfully",
 *   "data": {
 *     "deal": Deal,
 *     "messages": Message[],
 *     "steps": Array<{ vendorMessage, accordoMessage, round }>,
 *     "finalStatus": string,
 *     "totalRounds": number,
 *     "finalUtility": number | null
 *   }
 * }
 */
export const runDemo = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { scenario, maxRounds = 10 } = req.body;

    if (!scenario) {
      throw new CustomError('Scenario is required', 400);
    }

    const validScenarios = ['HARD', 'MEDIUM', 'SOFT', 'WALK_AWAY'];
    if (!validScenarios.includes(scenario)) {
      throw new CustomError(
        `Invalid scenario: ${scenario}. Must be one of: ${validScenarios.join(', ')}`,
        400
      );
    }

    const result = await chatbotService.runDemoService(dealId, scenario, maxRounds);

    logger.info(`[RunDemo] Demo completed for deal ${dealId}`, {
      scenario,
      totalRounds: result.totalRounds,
      finalStatus: result.finalStatus,
      userId: req.context.userId,
    });

    res.status(200).json({
      message: 'Demo completed successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resume an escalated deal
 * POST /api/chatbot/deals/:dealId/resume
 *
 * Response:
 * {
 *   "message": "Deal resumed successfully",
 *   "data": Deal
 * }
 */
export const resumeDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const deal = await chatbotService.resumeDealService(dealId);

    logger.info(`[ResumeController] Deal resumed: ${dealId}`, {
      userId: req.context.userId,
    });

    res.status(200).json({
      message: 'Deal resumed successfully',
      data: deal,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== REQUISITION-BASED DEAL CONTROLLERS ====================

/**
 * Get all requisitions with deal statistics
 * GET /api/chatbot/requisitions
 */
export const getRequisitionsWithDeals = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      projectId,
      status,
      dateFrom,
      dateTo,
      sortBy,
      archived,
      page = 1,
      limit = 10,
    } = req.query;

    const filters: chatbotService.RequisitionsWithDealsFilters = {};
    if (projectId) filters.projectId = parseInt(projectId as string, 10);
    if (status) filters.status = status as any;
    if (dateFrom) filters.dateFrom = dateFrom as string;
    if (dateTo) filters.dateTo = dateTo as string;
    if (sortBy) filters.sortBy = sortBy as any;
    if (archived) filters.archived = archived as 'active' | 'archived' | 'all';
    filters.companyId = req.context?.companyId || null;

    const result = await chatbotService.getRequisitionsWithDealsService(
      filters,
      parseInt(page as string, 10),
      parseInt(limit as string, 10)
    );

    // Transform response to match frontend expected structure
    // Frontend expects: { data: { requisitions: [...], total, page, totalPages } }
    res.status(200).json({
      message: 'Requisitions retrieved successfully',
      data: {
        requisitions: result.data,
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all vendor deals for a specific requisition
 * GET /api/chatbot/requisitions/:rfqId/deals
 */
export const getRequisitionDeals = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Support both rfqId (new) and requisitionId (legacy) param names
    const rfqIdParam = req.params.rfqId || req.params.requisitionId;
    const { status, sortBy, sortOrder, archived } = req.query;

    const companyId = req.context?.companyId || null;
    const result = await chatbotService.getRequisitionDealsService(
      getNumericParam(rfqIdParam),
      {
        status: status as string,
        sortBy: sortBy as string,
        sortOrder: sortOrder as 'asc' | 'desc',
        archived: archived as 'active' | 'archived' | 'all',
      },
      companyId
    );

    res.status(200).json({
      message: 'Requisition deals retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get detailed deal summary for modal display
 * GET /api/chatbot/deals/:dealId/summary
 */
export const getDealSummary = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.getDealSummaryService(dealId);

    res.status(200).json({
      message: 'Deal summary retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Export deal summary as PDF
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/export-pdf
 *
 * Generates a comprehensive PDF report and returns it for download.
 */
export const exportDealPDF = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const rfqId = getNumericParam(req.params.rfqId);
    const result = await chatbotService.exportDealPDFService(dealId, rfqId);

    // Set headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Length', result.data.length);

    res.send(result.data);
  } catch (error) {
    next(error);
  }
};

/**
 * Email deal summary PDF to recipient
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/email-pdf
 *
 * Generates PDF and emails it to the specified address.
 */
export const emailDealPDF = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const rfqId = getNumericParam(req.params.rfqId);
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      res.status(400).json({
        message: 'Email address is required',
      });
      return;
    }

    await chatbotService.emailDealPDFService(dealId, rfqId, email);

    res.status(200).json({
      message: `Deal summary PDF sent to ${email}`,
      data: { email, sentAt: new Date().toISOString() },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get weighted utility calculation for a deal
 * GET /api/chatbot/deals/:dealId/utility
 *
 * Returns:
 * - Total weighted utility score (0-100%)
 * - Parameter-level breakdown with individual utilities
 * - Thresholds: Accept (≥70%), Escalate (30-50%), Walk Away (<30%)
 * - Recommendation based on current utility
 */
export const getDealUtility = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.getDealUtilityService(dealId);

    res.status(200).json({
      message: 'Utility calculated successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get delivery addresses for a specific vendor
 * GET /api/chatbot/vendors/:vendorId/addresses
 *
 * Returns the vendor's company address for delivery location selection
 * Format matches DeliveryAddress type: { id, name, address, type, isDefault }
 */
export const getVendorAddresses = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const vendorId = getNumericParam(req.params.vendorId);
    const addresses = await chatbotService.getVendorAddressesService(vendorId);

    res.status(200).json({
      message: 'Vendor addresses retrieved successfully',
      data: addresses,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get behavioral analysis data for a deal
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/behavioral
 */
export const getBehavioralData = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const result = await chatbotService.getBehavioralDataService(dealId);

    res.status(200).json({
      message: 'Behavioral data retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ==================== NEW API RESTRUCTURE CONTROLLERS (January 2026) ====================

/**
 * Get requisitions available for negotiation
 * GET /api/chatbot/requisitions/for-negotiation
 *
 * Proxies to the requisition module to get requisitions that can have deals created
 */
export const getRequisitionsForNegotiation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const companyId = req.context?.companyId || null;
    const result = await chatbotService.getRequisitionsForNegotiationService(companyId);

    res.status(200).json({
      message: 'Requisitions for negotiation retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vendors attached to a requisition
 * GET /api/chatbot/requisitions/:rfqId/vendors
 */
export const getRequisitionVendors = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rfqId = getNumericParam(req.params.rfqId);
    const result = await chatbotService.getRequisitionVendorsService(rfqId);

    res.status(200).json({
      message: 'Requisition vendors retrieved successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unified message endpoint (merged INSIGHTS + CONVERSATION)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/messages
 * Query: ?mode=INSIGHTS or ?mode=CONVERSATION
 */
export const sendMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content, role = 'VENDOR' } = req.body;
    const { mode = 'INSIGHTS' } = req.query;

    if (!content) {
      throw new CustomError('Message content is required', 400);
    }

    if (mode === 'CONVERSATION') {
      // Use CONVERSATION mode (LLM-driven)
      const { processConversationMessage } = await import('./convo/conversationService.js');
      const result = await processConversationMessage({
        dealId,
        vendorMessage: content,
        userId: req.context.userId,
      });

      // Fetch updated deal and all messages to return to frontend
      // This matches the INSIGHTS mode response structure for consistent frontend handling
      const dealWithMessages = await chatbotService.getDealService(dealId);

      res.status(200).json({
        message: 'Message processed successfully',
        data: {
          deal: dealWithMessages.deal,
          messages: dealWithMessages.messages,
          latestMessage: result.data?.accordoMessage,
          conversationState: result.data?.conversationState,
          dealStatus: result.data?.dealStatus,
        },
      });
    } else {
      // Use INSIGHTS mode (deterministic engine)
      const result = await chatbotService.processVendorMessageService({
        dealId,
        content,
        role,
        userId: req.context.userId,
      });

      logger.info(
        `Vendor message processed for deal ${dealId}: ${result.decision.action}`
      );

      // Fetch updated deal and all messages to return to frontend
      const dealWithMessages = await chatbotService.getDealService(dealId);

      res.status(200).json({
        message: 'Message processed successfully',
        data: {
          deal: dealWithMessages.deal,
          messages: dealWithMessages.messages,
          latestMessage: result.message,
          decision: result.decision,
          explainability: result.explainability,
        },
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Save a draft deal configuration
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts
 */
export const saveDraft = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rfqId = getNumericParam(req.params.rfqId);
    const vendorId = getNumericParam(req.params.vendorId);
    const draftData = req.body;

    const draft = await chatbotService.saveDraftService({
      rfqId,
      vendorId,
      userId: req.context.userId,
      data: draftData,
    });

    res.status(201).json({
      message: 'Draft saved successfully',
      data: draft,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List drafts for a RFQ+Vendor
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts
 */
export const listDrafts = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rfqId = getNumericParam(req.params.rfqId);
    const vendorId = getNumericParam(req.params.vendorId);

    const drafts = await chatbotService.listDraftsService(
      rfqId,
      vendorId,
      req.context.userId
    );

    res.status(200).json({
      message: 'Drafts retrieved successfully',
      data: drafts,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a specific draft
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId
 */
export const getDraft = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const draftId = getParam(req.params.draftId);

    const draft = await chatbotService.getDraftService(draftId);

    res.status(200).json({
      message: 'Draft retrieved successfully',
      data: draft,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a draft
 * DELETE /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId
 */
export const deleteDraft = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const draftId = getParam(req.params.draftId);

    await chatbotService.deleteDraftService(draftId);

    res.status(200).json({
      message: 'Draft deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// Vendor Negotiation (AI-PM Mode) Controllers
// ============================================================================

/**
 * Start negotiation - generates AI-PM's opening offer
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start-negotiation
 */
export const startNegotiation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);

    const result = await chatbotService.startNegotiationService(dealId);

    logger.info(`Negotiation started for deal ${dealId} with AI-PM opening offer`);
    res.status(200).json({
      message: 'Negotiation started successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vendor scenarios - scenario chips for vendor based on current state
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-scenarios
 */
export const getVendorScenarios = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);

    const scenarios = await chatbotService.getVendorScenariosService(dealId);

    res.status(200).json({
      message: 'Vendor scenarios retrieved successfully',
      data: scenarios,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Vendor sends message - vendor sends offer, AI-PM responds immediately
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message
 */
export const vendorSendMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content } = req.body;

    if (!content || !content.trim()) {
      throw new CustomError('Message content is required', 400);
    }

    const result = await chatbotService.vendorSendMessageService(
      dealId,
      content,
      req.context.userId
    );

    logger.info(`Vendor message processed for deal ${dealId}: AI-PM responded with ${result.pmDecision.action}`);
    res.status(200).json({
      message: 'Message processed successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// TWO-PHASE MESSAGE PROCESSING CONTROLLERS (PM Response Enhancement)
// ============================================================================
// Part A: Instant Vendor Message Display
// Part B: Human-like PM Responses with Delivery Terms
// ============================================================================

/**
 * Phase 1: Save vendor message only (instant API)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message-instant
 *
 * This endpoint saves the vendor message immediately and returns quickly.
 * The frontend should call /pm-response-async next to get the PM response.
 *
 * Response:
 * {
 *   "message": "Vendor message saved",
 *   "data": {
 *     "message": Message,
 *     "deal": Deal,
 *     "extractedOffer": Offer,
 *     "pmProcessing": true
 *   }
 * }
 */
export const saveVendorMessageInstant = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { content } = req.body;
    const userId = req.context.userId;

    if (!content || !content.trim()) {
      throw new CustomError('Message content is required', 400);
    }

    const result = await chatbotService.saveVendorMessageOnlyService({
      dealId,
      content,
      userId,
    });

    logger.info(`[Phase1] Vendor message saved instantly for deal ${dealId}`);
    res.status(200).json({
      message: 'Vendor message saved',
      data: {
        vendorMessage: result.message,  // Named vendorMessage for frontend consistency
        deal: result.deal,
        extractedOffer: result.extractedOffer,
        pmProcessing: result.pmProcessing,
        processingState: result.processingState,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Phase 2: Generate PM response asynchronously
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-async
 *
 * This endpoint generates a human-like PM response using LLM.
 * It may take 1-5 seconds. Frontend should show typing indicator while waiting.
 *
 * Request:
 * { "vendorMessageId": "uuid-of-vendor-message" }
 *
 * Response:
 * {
 *   "message": "PM response generated",
 *   "data": {
 *     "message": Message,
 *     "decision": Decision,
 *     "explainability": Explainability,
 *     "deal": Deal,
 *     "generationSource": "llm" | "fallback"
 *   }
 * }
 */
export const generatePMResponseAsync = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { vendorMessageId } = req.body;
    const userId = req.context.userId;

    if (!vendorMessageId) {
      throw new CustomError('vendorMessageId is required', 400);
    }

    const result = await chatbotService.generatePMResponseAsyncService({
      dealId,
      vendorMessageId,
      userId,
    });

    logger.info(`[Phase2] PM response generated for deal ${dealId}: ${result.decision.action}`);
    res.status(200).json({
      message: 'PM response generated',
      data: {
        pmMessage: result.message,  // Named pmMessage for frontend consistency
        decision: result.decision,
        explainability: result.explainability,
        deal: result.deal,
        generationSource: result.generationSource,
        meso: result.meso ?? null,  // Include MESO options for frontend
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Fallback: Generate PM response when async times out
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-fallback
 *
 * This endpoint generates a quick fallback response when the LLM takes too long.
 * It uses enhanced templates with delivery terms.
 *
 * Request:
 * { "vendorMessageId": "uuid-of-vendor-message" }
 *
 * Response:
 * {
 *   "message": "PM fallback response generated",
 *   "data": {
 *     "message": Message,
 *     "decision": Decision,
 *     "deal": Deal,
 *     "generationSource": "fallback"
 *   }
 * }
 */
export const generatePMResponseFallback = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { vendorMessageId } = req.body;
    const userId = req.context.userId;

    if (!vendorMessageId) {
      throw new CustomError('vendorMessageId is required', 400);
    }

    const result = await chatbotService.generatePMFallbackResponseService({
      dealId,
      vendorMessageId,
      userId,
    });

    logger.info(`[Fallback] PM fallback response generated for deal ${dealId}`);
    res.status(200).json({
      message: 'PM fallback response generated',
      data: {
        pmMessage: result.message,  // Named pmMessage for frontend consistency
        decision: result.decision,
        explainability: result.explainability,
        deal: result.deal,
        generationSource: result.generationSource,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// MESO Selection Controllers (February 2026)
// ============================================================================

/**
 * Process MESO option selection (Offer 1, 2, or 3)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/select
 *
 * When vendor selects a MESO offer:
 * - Deal status changes to ACCEPTED
 * - Returns "under review" confirmation message
 */
export const processMesoSelection = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { selectedOptionId } = req.body;

    const result = await chatbotService.processMesoSelectionService({
      dealId,
      selectedOptionId,
      userId: req.context.userId,
    });

    logger.info(`MESO selection processed for deal ${dealId}: option ${selectedOptionId}`);
    res.status(200).json({
      message: 'Deal accepted successfully',
      data: {
        deal: result.deal,
        message: result.message,
        selectedOption: result.selectedOption,
        phase: 'DEAL_ACCEPTED',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process "Others" selection with counter-offer form data
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/others
 *
 * When vendor submits Others form:
 * - Creates vendor message with offer
 * - Triggers PM response generation
 * - Starts post-Others negotiation phase (4 rounds)
 */
export const processOthersSelection = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { totalPrice, paymentTermsDays } = req.body;

    const result = await chatbotService.processOthersSelectionService({
      dealId,
      totalPrice,
      paymentTermsDays,
      userId: req.context.userId,
    });

    logger.info(`Others selection processed for deal ${dealId}: $${totalPrice}, Net ${paymentTermsDays}`);
    res.status(200).json({
      message: 'Counter-offer submitted successfully',
      data: {
        pmMessage: result.message,
        decision: result.decision,
        explainability: result.explainability,
        deal: result.deal,
        meso: result.meso,
        generationSource: result.generationSource,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process "Is this your final offer?" confirmation
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/final-offer/confirm
 *
 * If Yes: Generate final MESO based on vendor's price (no Others option)
 * If No: Continue normal negotiation
 */
export const processFinalOfferConfirmation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const dealId = getParam(req.params.dealId);
    const { isConfirmedFinal } = req.body;

    const result = await chatbotService.processFinalOfferConfirmationService({
      dealId,
      isConfirmedFinal,
      userId: req.context.userId,
    });

    logger.info(`Final offer confirmation for deal ${dealId}: confirmed=${isConfirmedFinal}`);
    res.status(200).json({
      message: isConfirmedFinal ? 'Final offers generated' : 'Continuing negotiation',
      data: {
        deal: result.deal,
        message: result.message,
        meso: result.meso,
        continueNegotiation: result.continueNegotiation,
        phase: result.continueNegotiation ? 'NORMAL_NEGOTIATION' : 'FINAL_MESO',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Archive a requisition (cascades to all deals)
 * POST /api/chatbot/requisitions/:rfqId/archive
 */
export const archiveRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rfqId = getNumericParam(req.params.rfqId);
    const result = await chatbotService.archiveRequisitionService(rfqId);
    res.status(200).json({
      message: `Requisition archived successfully. ${result.archivedDealsCount} deals also archived.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Unarchive a requisition
 * POST /api/chatbot/requisitions/:rfqId/unarchive
 */
export const unarchiveRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rfqId = getNumericParam(req.params.rfqId);
    const unarchiveDeals = req.body.unarchiveDeals !== false; // Default true
    const result = await chatbotService.unarchiveRequisitionService(rfqId, unarchiveDeals);
    res.status(200).json({
      message: `Requisition unarchived successfully. ${result.unarchivedDealsCount} deals also unarchived.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

