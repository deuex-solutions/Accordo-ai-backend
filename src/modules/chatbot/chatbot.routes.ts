import { Router } from 'express';
import * as controller from './chatbot.controller.js';
import * as templateController from './template.controller.js';
import * as vendorSimulatorController from './vendor/vendor-simulator.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import {
  validateBody,
  validateParams,
  validateQuery,
  createDealWithConfigSchema,
  processMessageSchema,
  dealIdSchema,
  listDealsQuerySchema,
  rfqIdSchema,
  rfqVendorSchema,
  nestedDealSchema,
  modeQuerySchema,
  mesoSelectSchema,
  mesoOthersSchema,
  finalOfferConfirmSchema,
} from './chatbot.validator.js';

const chatbotRouter = Router();

/**
 * Chatbot Module Routes - Restructured API
 * All routes are prefixed with /api/chatbot
 *
 * NEW STRUCTURE (January 2026):
 * - Nested URLs: /requisitions/:rfqId/vendors/:vendorId/deals/:dealId/...
 * - Merged INSIGHTS + CONVERSATION modes via ?mode= query parameter
 * - Hierarchical structure matches user flow: Requisition → Vendor → Deal
 *
 * NOTE: Module permissions can be added later when chatbot module is registered
 * For now, using authMiddleware only to ensure authenticated access
 */

// ==================== Deal Lookup (Flat Access) ====================

/**
 * Look up a deal by ID only - returns deal with context (rfqId, vendorId)
 * GET /api/chatbot/deals/:dealId/lookup
 *
 * This convenience endpoint allows the frontend to look up a deal when only
 * the dealId is available (e.g., from URL params). The returned context can
 * be used to construct proper nested URLs for subsequent API calls.
 */
chatbotRouter.get(
  '/deals/:dealId/lookup',
  authMiddleware,
  validateParams(dealIdSchema),
  controller.lookupDeal
);

// ==================== Requisition Views ====================

/**
 * Get all requisitions with their deal summaries
 * GET /api/chatbot/requisitions
 * Query params: projectId, status, dateFrom, dateTo, sortBy, sortOrder, page, limit
 */
chatbotRouter.get(
  '/requisitions',
  authMiddleware,
  controller.getRequisitionsWithDeals
);

/**
 * Get requisitions available for negotiation (from requisition module)
 * GET /api/chatbot/requisitions/for-negotiation
 */
chatbotRouter.get(
  '/requisitions/for-negotiation',
  authMiddleware,
  controller.getRequisitionsForNegotiation
);

/**
 * Get all deals for a specific requisition (cross-vendor view)
 * GET /api/chatbot/requisitions/:rfqId/deals
 * Query params: status, sortBy, sortOrder
 */
chatbotRouter.get(
  '/requisitions/:rfqId/deals',
  authMiddleware,
  validateParams(rfqIdSchema),
  controller.getRequisitionDeals
);

/**
 * Get vendors attached to a requisition
 * GET /api/chatbot/requisitions/:rfqId/vendors
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors',
  authMiddleware,
  validateParams(rfqIdSchema),
  controller.getRequisitionVendors
);

/**
 * Archive a requisition (cascades to all deals)
 * POST /api/chatbot/requisitions/:rfqId/archive
 */
chatbotRouter.post(
  '/requisitions/:rfqId/archive',
  authMiddleware,
  validateParams(rfqIdSchema),
  controller.archiveRequisition
);

/**
 * Unarchive a requisition
 * POST /api/chatbot/requisitions/:rfqId/unarchive
 */
chatbotRouter.post(
  '/requisitions/:rfqId/unarchive',
  authMiddleware,
  validateParams(rfqIdSchema),
  controller.unarchiveRequisition
);

// ==================== Smart Defaults & Drafts ====================

/**
 * Get smart defaults for a vendor/RFQ combination
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/smart-defaults
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/smart-defaults',
  authMiddleware,
  validateParams(rfqVendorSchema),
  controller.getSmartDefaults
);

/**
 * Save a draft deal configuration
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/drafts',
  authMiddleware,
  validateParams(rfqVendorSchema),
  controller.saveDraft
);

/**
 * List drafts for a RFQ+Vendor
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/drafts',
  authMiddleware,
  validateParams(rfqVendorSchema),
  controller.listDrafts
);

/**
 * Get a specific draft
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId',
  authMiddleware,
  controller.getDraft
);

/**
 * Delete a draft
 * DELETE /api/chatbot/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId
 */
chatbotRouter.delete(
  '/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId',
  authMiddleware,
  controller.deleteDraft
);

// ==================== Deal Management (Nested) ====================

/**
 * List deals for a specific RFQ+Vendor combination
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals',
  authMiddleware,
  validateParams(rfqVendorSchema),
  validateQuery(listDealsQuerySchema),
  controller.listDeals
);

/**
 * Create a new deal with full wizard configuration
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals
 * Body: wizard config (price, payment, delivery, contract, custom params)
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals',
  authMiddleware,
  validateParams(rfqVendorSchema),
  validateBody(createDealWithConfigSchema),
  controller.createDealWithConfig
);

/**
 * Get a specific deal with messages
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getDeal
);

/**
 * Get negotiation config for a deal
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/config
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/config',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getDealConfig
);

/**
 * Get weighted utility calculation for a deal
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/utility
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/utility',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getDealUtility
);

/**
 * Get deal summary for modal display
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/summary
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/summary',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getDealSummary
);

/**
 * Export deal summary as PDF
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/export-pdf
 *
 * Returns PDF file as buffer for direct download.
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/export-pdf',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.exportDealPDF
);

/**
 * Email deal summary PDF to specified recipient
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/email-pdf
 *
 * Body: { email: string }
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/email-pdf',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.emailDealPDF
);

/**
 * Get explainability data for a deal
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/explainability
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/explainability',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getLastExplainability
);

/**
 * Get behavioral analysis data for a deal (Adaptive Negotiation Engine)
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/behavioral
 *
 * Returns behavioral signals, adaptive strategy, convergence data,
 * round history, and dynamic rounds info.
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/behavioral',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getBehavioralData
);

// ==================== Messaging (Merged INSIGHTS + CONVERSATION) ====================

/**
 * Send a message (unified endpoint for both modes)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/messages
 * Query: ?mode=INSIGHTS or ?mode=CONVERSATION
 *
 * - mode=INSIGHTS: Deterministic decision engine (processVendorMessage)
 * - mode=CONVERSATION: LLM-driven conversational (sendConversationMessage)
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/messages',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateQuery(modeQuerySchema),
  validateBody(processMessageSchema),
  controller.sendMessage
);

/**
 * Start a conversation (CONVERSATION mode only)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start
 * Query: ?mode=CONVERSATION
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.startConversation
);

// ==================== Two-Phase Messaging (Instant Vendor + Async PM) ====================

/**
 * Save vendor message instantly (Phase 1)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message-instant
 *
 * This endpoint saves the vendor message immediately and returns without waiting
 * for PM response generation. Used for instant UI feedback.
 *
 * Body: { content: string }
 * Returns: { vendorMessage, deal } - Vendor message and updated deal state
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message-instant',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateBody(processMessageSchema),
  controller.saveVendorMessageInstant
);

/**
 * Generate PM response asynchronously (Phase 2)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-async
 *
 * Called after vendor message is saved. Generates human-like PM response
 * using LLM with tone detection and concern acknowledgment.
 *
 * Returns: { pmMessage, decision, utility, suggestions } - Full PM response with context
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-async',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.generatePMResponseAsync
);

/**
 * Generate PM fallback response (Timeout Handler)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-fallback
 *
 * Called when LLM response times out (5+ seconds). Generates a quick
 * template-based response to maintain conversation flow.
 *
 * Returns: { pmMessage, decision } - Fallback PM response
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-fallback',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.generatePMResponseFallback
);

// ==================== Deal Lifecycle ====================

/**
 * Reset a deal (clear messages and state)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/reset
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/reset',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.resetDeal
);

/**
 * Archive a deal
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/archive
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/archive',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.archiveDeal
);

/**
 * Unarchive a deal
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/unarchive
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/unarchive',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.unarchiveDeal
);

/**
 * Retry sending deal notification email to vendor
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/retry-email
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/retry-email',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.retryDealEmail
);

// ==================== Vendor Simulation & Demo ====================

/**
 * Generate simulated vendor message (autopilot)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/simulate
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/simulate',
  authMiddleware,
  validateParams(nestedDealSchema),
  vendorSimulatorController.generateNextVendorMessage
);

/**
 * Run full demo negotiation
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/demo
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/demo',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.runDemo
);

/**
 * Resume an escalated deal
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/resume
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/resume',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.resumeDeal
);

// ==================== Vendor Negotiation (AI-PM Mode) ====================
// These endpoints support the vendor-perspective negotiation flow where:
// - Vendor is the active user who sends offers
// - AI simulates the Procurement Manager (PM) and responds automatically
// - Scenario chips are generated based on vendor's profit goals

/**
 * Start negotiation - generates AI-PM's opening offer
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start-negotiation
 *
 * Called when vendor opens the deal for the first time.
 * AI-PM generates opening offer based on wizard config values.
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start-negotiation',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.startNegotiation
);

/**
 * Get vendor scenarios - scenario chips for vendor based on current state
 * GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-scenarios
 *
 * Returns HARD/MEDIUM/SOFT scenario chips calculated from:
 * - PM's last offer
 * - Product category margins
 * - Vendor's profit goals
 */
chatbotRouter.get(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-scenarios',
  authMiddleware,
  validateParams(nestedDealSchema),
  controller.getVendorScenarios
);

/**
 * Vendor sends message - vendor sends offer, AI-PM responds immediately
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message
 *
 * Flow:
 * 1. Vendor sends message
 * 2. System parses vendor's offer
 * 3. AI-PM evaluates against PM's config
 * 4. AI-PM generates response (ACCEPT/COUNTER/ESCALATE/WALK_AWAY)
 * 5. Both messages returned to frontend
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateBody(processMessageSchema),
  controller.vendorSendMessage
);

// ==================== MESO Selection Endpoints (February 2026) ====================

/**
 * Handle MESO option selection (Offer 1, 2, or 3)
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/select
 *
 * When vendor selects a MESO offer:
 * - Deal status changes to ACCEPTED
 * - Returns "under review" confirmation message
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/select',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateBody(mesoSelectSchema),
  controller.processMesoSelection
);

/**
 * Handle "Others" selection with counter-offer form data
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/others
 *
 * Body: { totalPrice: number, paymentTermsDays: number }
 *
 * When vendor submits Others form:
 * - Creates vendor message with offer
 * - Triggers PM response generation
 * - Starts post-Others negotiation phase (4 rounds)
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/others',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateBody(mesoOthersSchema),
  controller.processOthersSelection
);

/**
 * Handle "Is this your final offer?" response
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/final-offer/confirm
 *
 * Body: { isConfirmedFinal: boolean }
 *
 * If Yes: Generate final MESO based on vendor's price (no Others option)
 * If No: Continue normal negotiation
 */
chatbotRouter.post(
  '/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/final-offer/confirm',
  authMiddleware,
  validateParams(nestedDealSchema),
  validateBody(finalOfferConfirmSchema),
  controller.processFinalOfferConfirmation
);

// ==================== Vendor Addresses ====================

/**
 * Get delivery addresses for a specific vendor
 * GET /api/chatbot/vendors/:vendorId/addresses
 */
chatbotRouter.get(
  '/vendors/:vendorId/addresses',
  authMiddleware,
  controller.getVendorAddresses
);

// ==================== Template Management ====================

/**
 * Get default template
 * GET /api/chatbot/templates/default
 * NOTE: This route must come BEFORE /api/chatbot/templates/:id
 */
chatbotRouter.get(
  '/templates/default',
  authMiddleware,
  templateController.getDefaultTemplate
);

/**
 * Create a new template
 * POST /api/chatbot/templates
 */
chatbotRouter.post(
  '/templates',
  authMiddleware,
  templateController.createTemplate
);

/**
 * List all templates
 * GET /api/chatbot/templates
 */
chatbotRouter.get(
  '/templates',
  authMiddleware,
  templateController.listTemplates
);

/**
 * Get a template by ID
 * GET /api/chatbot/templates/:id
 */
chatbotRouter.get(
  '/templates/:id',
  authMiddleware,
  templateController.getTemplate
);

/**
 * Update a template by ID
 * PUT /api/chatbot/templates/:id
 */
chatbotRouter.put(
  '/templates/:id',
  authMiddleware,
  templateController.updateTemplate
);

/**
 * Set a template as default
 * POST /api/chatbot/templates/:id/set-default
 */
chatbotRouter.post(
  '/templates/:id/set-default',
  authMiddleware,
  templateController.setDefaultTemplate
);

/**
 * Delete a template by ID (soft delete)
 * DELETE /api/chatbot/templates/:id
 */
chatbotRouter.delete(
  '/templates/:id',
  authMiddleware,
  templateController.deleteTemplate
);

/**
 * Permanently delete a template by ID
 * DELETE /api/chatbot/templates/:id/permanent
 */
chatbotRouter.delete(
  '/templates/:id/permanent',
  authMiddleware,
  templateController.permanentDeleteTemplate
);

export default chatbotRouter;
