import { Router, type Request, type Response, type NextFunction } from 'express';
import Joi from 'joi';
import * as chatbotService from './chatbot.service.js';
import * as templateService from './template.service.js';
import * as vendorSimulatorService from './vendor/vendor-simulator.service.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { CustomError } from '../../utils/custom-error.js';
import logger from '../../config/logger.js';
import { getParam, getNumericParam } from '../../utils/types.js';

const chatbotRouter = Router();

// ============================================================================
// Chatbot Validation Schemas & Middlewares
// ============================================================================

export const createDealSchema = Joi.object({
  title: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'Title is required',
    'string.max': 'Title cannot exceed 255 characters',
  }),
  counterparty: Joi.string().allow('', null).optional(),
  mode: Joi.string().valid('CONVERSATION').default('CONVERSATION').optional(),
  templateId: Joi.string().uuid().allow(null).optional(),
  requisitionId: Joi.number().integer().positive().allow(null).optional(),
  contractId: Joi.number().integer().positive().allow(null).optional(),
  vendorId: Joi.number().integer().positive().allow(null).optional(),
});

export const createDealWithConfigSchema = Joi.object({
  title: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'Title is required',
    'string.max': 'Title cannot exceed 255 characters',
  }),
  counterparty: Joi.string().allow('', null).optional(),
  mode: Joi.string().valid('CONVERSATION').default('CONVERSATION').optional(),
  requisitionId: Joi.number().integer().positive().required().messages({
    'any.required': 'Requisition ID is required',
    'number.positive': 'Requisition ID must be positive',
  }),
  vendorId: Joi.number().integer().positive().required().messages({
    'any.required': 'Vendor ID is required',
    'number.positive': 'Vendor ID must be positive',
  }),
  priority: Joi.string().valid('HIGH', 'MEDIUM', 'LOW').default('MEDIUM').required(),
  priceQuantity: Joi.object({
    minTotalPrice: Joi.number().positive().optional(),
    minUnitPrice: Joi.number().positive().optional(),
    targetUnitPrice: Joi.number().positive().optional(),
    maxTotalPrice: Joi.number().positive().optional(),
    maxUnitPrice: Joi.number().positive().optional(),
    maxAcceptablePrice: Joi.number().positive().optional(),
    minOrderQuantity: Joi.number().integer().positive().required().messages({ 'any.required': 'Minimum order quantity is required' }),
    preferredQuantity: Joi.number().integer().positive().allow(null).optional(),
  }).required(),
  paymentTerms: Joi.object({
    minDays: Joi.number().integer().positive().required().messages({ 'any.required': 'Minimum payment days is required' }),
    maxDays: Joi.number().integer().positive().required().messages({ 'any.required': 'Maximum payment days is required' }),
    acceptedMethods: Joi.array().items(Joi.string().valid('BANK_TRANSFER', 'CREDIT', 'LC')).default(['BANK_TRANSFER']),
  }).required(),
  delivery: Joi.object({
    requiredDate: Joi.string().isoDate().required().messages({ 'any.required': 'Required delivery date is required', 'string.isoDate': 'Required delivery date must be a valid date', 'string.empty': 'Required delivery date is required' }),
    preferredDate: Joi.string().isoDate().allow(null, '').optional(),
    locationId: Joi.string().allow(null, '').optional(),
    locationAddress: Joi.string().allow(null).optional(),
    partialDelivery: Joi.object({
      allowed: Joi.boolean().default(false),
      type: Joi.string().valid('QUANTITY', 'PERCENTAGE').allow(null).optional(),
      minValue: Joi.number().positive().allow(null).optional(),
    }).default({ allowed: false, type: null, minValue: null }),
  }).required(),
  contractSla: Joi.object({
    warrantyPeriod: Joi.string().valid('0_MONTHS', '6_MONTHS', '1_YEAR', '2_YEARS', '3_YEARS', '5_YEARS', 'CUSTOM').required().messages({ 'any.required': 'Warranty period is required' }),
    customWarrantyMonths: Joi.when('warrantyPeriod', {
      is: 'CUSTOM',
      then: Joi.number().integer().min(0).max(120).required().messages({ 'any.required': 'Custom warranty months is required when warranty period is CUSTOM' }),
      otherwise: Joi.any().allow(null).optional(),
    }),
    defectLiabilityMonths: Joi.number().integer().positive().allow(null).optional(),
    lateDeliveryPenaltyPerDay: Joi.number().min(0.5).max(2).required().messages({ 'any.required': 'Late delivery penalty is required' }),
    maxPenaltyCap: Joi.object({
      type: Joi.string().valid('PERCENTAGE', 'FIXED').required(),
      value: Joi.number().positive().allow(null).optional(),
    }).allow(null).optional(),
    qualityStandards: Joi.array().items(Joi.string()).default([]),
  }).required(),
  negotiationControl: Joi.object({
    deadline: Joi.string().isoDate().allow(null, '').optional().default(null),
    maxRounds: Joi.number().integer().min(5).max(20).allow(null).default(10),
    walkawayThreshold: Joi.number().min(10).max(30).allow(null).default(20),
  }).default({ deadline: null, maxRounds: 10, walkawayThreshold: 20 }),
  parameterWeights: Joi.object().pattern(Joi.string(), Joi.number().min(0).max(100)).optional().default({}),
  contractId: Joi.number().integer().positive().allow(null).optional(),
  previousContractId: Joi.number().integer().positive().allow(null).optional(),
  customParameters: Joi.array().items(
    Joi.object({
      id: Joi.string().optional(),
      name: Joi.string().required(),
      type: Joi.string().valid('BOOLEAN', 'NUMBER', 'TEXT', 'DATE').required(),
      targetValue: Joi.alternatives().try(Joi.boolean(), Joi.number(), Joi.string()).required(),
      flexibility: Joi.string().valid('FIXED', 'FLEXIBLE', 'NICE_TO_HAVE').default('FLEXIBLE'),
      includeInNegotiation: Joi.boolean().default(true),
    })
  ).default([]),
});

export const smartDefaultsQuerySchema = Joi.object({ rfqId: Joi.number().integer().positive().required(), vendorId: Joi.number().integer().positive().required() });
export const processMessageSchema = Joi.object({ content: Joi.string().required().min(1).messages({ 'string.empty': 'Message content is required' }), role: Joi.string().valid('VENDOR', 'ACCORDO', 'SYSTEM').default('VENDOR').optional() });
export const createSystemMessageSchema = Joi.object({ content: Joi.string().required().min(1).messages({ 'string.empty': 'Message content is required' }) });
export const dealIdSchema = Joi.object({ dealId: Joi.string().uuid().required().messages({ 'string.guid': 'Invalid deal ID format', 'any.required': 'Deal ID is required' }) });
export const rfqIdSchema = Joi.object({ rfqId: Joi.number().integer().positive().required().messages({ 'number.base': 'RFQ ID must be a number', 'number.positive': 'RFQ ID must be positive', 'any.required': 'RFQ ID is required' }) });
export const rfqVendorSchema = Joi.object({ rfqId: Joi.number().integer().positive().required().messages({ 'number.base': 'RFQ ID must be a number', 'number.positive': 'RFQ ID must be positive', 'any.required': 'RFQ ID is required' }), vendorId: Joi.number().integer().positive().required().messages({ 'number.base': 'Vendor ID must be a number', 'number.positive': 'Vendor ID must be positive', 'any.required': 'Vendor ID is required' }) });
export const nestedDealSchema = Joi.object({ rfqId: Joi.number().integer().positive().required().messages({ 'number.base': 'RFQ ID must be a number', 'number.positive': 'RFQ ID must be positive', 'any.required': 'RFQ ID is required' }), vendorId: Joi.number().integer().positive().required().messages({ 'number.base': 'Vendor ID must be a number', 'number.positive': 'Vendor ID must be positive', 'any.required': 'Vendor ID is required' }), dealId: Joi.string().uuid().required().messages({ 'string.guid': 'Invalid deal ID format', 'any.required': 'Deal ID is required' }) });
export const modeQuerySchema = Joi.object({ mode: Joi.string().valid('CONVERSATION').default('CONVERSATION').optional().messages({ 'any.only': 'Mode must be CONVERSATION' }) });
export const listDealsQuerySchema = Joi.object({ status: Joi.string().valid('NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED').optional(), mode: Joi.string().valid('CONVERSATION').optional(), archived: Joi.string().valid('true', 'false').optional(), deleted: Joi.string().valid('true', 'false').optional(), userId: Joi.number().integer().positive().optional(), vendorId: Joi.number().integer().positive().optional(), page: Joi.number().integer().positive().default(1).optional(), limit: Joi.number().integer().positive().max(100).default(10).optional() });
export const mesoSelectSchema = Joi.object({ selectedOptionId: Joi.string().required().messages({ 'string.empty': 'Selected option ID is required', 'any.required': 'Selected option ID is required' }) });
export const mesoOthersSchema = Joi.object({ totalPrice: Joi.number().positive().required().messages({ 'number.positive': 'Total price must be a positive number', 'any.required': 'Total price is required' }), paymentTermsDays: Joi.number().integer().min(1).max(180).required().messages({ 'number.min': 'Payment terms must be at least 1 day', 'number.max': 'Payment terms cannot exceed 180 days', 'any.required': 'Payment terms (days) is required' }) });
export const finalOfferConfirmSchema = Joi.object({ isConfirmedFinal: Joi.boolean().required().messages({ 'any.required': 'isConfirmedFinal (true/false) is required' }) });

export const validateBody = (schema: Joi.ObjectSchema) => (req: any, res: any, next: any) => { const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true }); if (error) return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) }); req.body = value; next(); };
export const validateParams = (schema: Joi.ObjectSchema) => (req: any, res: any, next: any) => { const { error, value } = schema.validate(req.params, { abortEarly: false, stripUnknown: true }); if (error) return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) }); req.params = value; next(); };
export const validateQuery = (schema: Joi.ObjectSchema) => (req: any, res: any, next: any) => { const { error, value } = schema.validate(req.query, { abortEarly: false, stripUnknown: true }); if (error) return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) }); req.query = value; next(); };

// ============================================================================
// Template Controllers
// ============================================================================

export const createTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { name, description, configJson, isActive } = req.body; if (!name) throw new CustomError('Template name is required', 400); const template = await templateService.createTemplateService({ name, description, configJson, isActive }); res.status(201).json({ success: true, message: 'Template created successfully', data: { template } }); } catch (error) { next(error); } };
export const getTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const id = getParam(req.params.id); const includeParameters = req.query.includeParameters === 'true'; const template = await templateService.getTemplateService(id, includeParameters); res.status(200).json({ success: true, message: 'Template retrieved successfully', data: { template } }); } catch (error) { next(error); } };
export const listTemplates = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { isActive, page, limit } = req.query; const query: any = {}; if (isActive !== undefined) query.isActive = isActive === 'true'; if (page) query.page = parseInt(page as string, 10); if (limit) query.limit = parseInt(limit as string, 10); const result = await templateService.listTemplatesService(query); res.status(200).json({ success: true, message: 'Templates retrieved successfully', data: result }); } catch (error) { next(error); } };
export const updateTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const id = getParam(req.params.id); const { name, description, configJson, isActive } = req.body; const template = await templateService.updateTemplateService(id, { name, description, configJson, isActive }); res.status(200).json({ success: true, message: 'Template updated successfully', data: { template } }); } catch (error) { next(error); } };
export const deleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const id = getParam(req.params.id); await templateService.deleteTemplateService(id); res.status(200).json({ success: true, message: 'Template deleted successfully' }); } catch (error) { next(error); } };
export const permanentDeleteTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const id = getParam(req.params.id); await templateService.permanentDeleteTemplateService(id); res.status(200).json({ success: true, message: 'Template permanently deleted successfully' }); } catch (error) { next(error); } };
export const getDefaultTemplate = async (_req: Request, res: Response, next: NextFunction): Promise<void> => { try { const template = await templateService.getDefaultTemplateService(); if (!template) { res.status(200).json({ success: true, message: 'No default template found', data: { template: null } }); return; } res.status(200).json({ success: true, message: 'Default template retrieved successfully', data: { template } }); } catch (error) { next(error); } };
export const setDefaultTemplate = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const id = getParam(req.params.id); const { deactivateOthers } = req.body; const template = await templateService.setDefaultTemplateService(id, deactivateOthers === true); res.status(200).json({ success: true, message: 'Default template set successfully', data: { template } }); } catch (error) { next(error); } };

// ============================================================================
// Chatbot Deal Controllers
// ============================================================================

export const createDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { title, counterparty, mode, templateId, requisitionId, contractId, vendorId } = req.body; if (!title) throw new CustomError("Title is required", 400); const deal = await chatbotService.createDealService({ title, counterparty, mode, templateId, requisitionId, contractId, userId: req.context.userId, vendorId }); logger.info(`Deal created: ${deal.id} by user ${req.context.userId}`); res.status(201).json({ message: "Deal created successfully", data: deal }); } catch (error) { next(error); } };
export const createDealWithConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const result = await chatbotService.createDealWithConfigService({ ...req.body, userId: req.context.userId }); logger.info(`Deal with config created: ${result.id} by user ${req.context.userId}`); const emailStatus = (result as any).emailStatus; let message = "Deal created successfully"; if (emailStatus && !emailStatus.success) message = "Deal created successfully, but email notification to vendor failed"; else if (emailStatus && emailStatus.success) message = "Deal created successfully and email notification sent to vendor"; res.status(201).json({ message, data: result }); } catch (error) { next(error); } };
export const getSmartDefaults = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqIdParam = req.params.rfqId || req.query.rfqId; const vendorIdParam = req.params.vendorId || req.query.vendorId; if (!rfqIdParam || !vendorIdParam) throw new CustomError("rfqId and vendorId are required", 400); const defaults = await chatbotService.getSmartDefaultsService(getNumericParam(rfqIdParam as string), getNumericParam(vendorIdParam as string)); res.status(200).json({ message: "Smart defaults retrieved successfully", data: defaults }); } catch (error) { next(error); } };
export const lookupDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.getDealService(dealId); if (!result.deal.requisitionId || !result.deal.vendorId) throw new CustomError("Deal is missing required requisitionId or vendorId. This deal cannot be used with the hierarchical API structure.", 400); res.status(200).json({ message: "Deal lookup successful", data: { deal: result.deal, messages: result.messages, context: { rfqId: result.deal.requisitionId, vendorId: result.deal.vendorId, dealId: result.deal.id } } }); } catch (error) { next(error); } };
export const getDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.getDealService(dealId); res.status(200).json({ message: "Deal retrieved successfully", data: result }); } catch (error) { next(error); } };
export const listDeals = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { status, mode, archived, deleted, userId, vendorId, page = 1, limit = 10 } = req.query; const filters: chatbotService.ListDealsFilters = {}; if (status) filters.status = status as any; if (mode) filters.mode = mode as any; if (archived !== undefined) filters.archived = archived === "true"; if (deleted !== undefined) filters.deleted = deleted === "true"; if (userId) filters.userId = parseInt(userId as string, 10); if (vendorId) filters.vendorId = parseInt(vendorId as string, 10); filters.companyId = req.context?.userType === "super_admin" ? null : req.context?.companyId || null; const result = await chatbotService.listDealsService(filters, parseInt(page as string, 10), parseInt(limit as string, 10)); res.status(200).json({ message: "Deals retrieved successfully", data: result }); } catch (error) { next(error); } };
export const processVendorMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content, role = "VENDOR" } = req.body; if (!content) throw new CustomError("Message content is required", 400); const result = await chatbotService.processVendorMessageService({ dealId, content, role, userId: req.context.userId }); logger.info(`Vendor message processed for deal ${dealId}: ${result.decision.action}`); const dealWithMessages = await chatbotService.getDealService(dealId); res.status(200).json({ message: "Message processed successfully", data: { deal: dealWithMessages.deal, messages: dealWithMessages.messages, latestMessage: result.message, decision: result.decision, explainability: result.explainability } }); } catch (error) { next(error); } };
export const resetDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const deal = await chatbotService.resetDealService(dealId); logger.info(`Deal reset: ${dealId} by user ${req.context.userId}`); res.status(200).json({ message: "Deal reset successfully", data: { deal, messages: [] } }); } catch (error) { next(error); } };
export const getDealConfig = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const config = await chatbotService.getDealConfigService(dealId); res.status(200).json({ message: "Config retrieved successfully", data: { config } }); } catch (error) { next(error); } };
export const getLastExplainability = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const explainability = await chatbotService.getLastExplainabilityService(dealId); if (!explainability) throw new CustomError("No explainability data found", 404); res.status(200).json({ message: "Explainability retrieved successfully", data: explainability }); } catch (error) { next(error); } };
export const archiveDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const deal = await chatbotService.archiveDealService(dealId); logger.info(`Deal archived: ${dealId} by user ${req.context.userId}`); res.status(200).json({ message: "Deal archived successfully", data: deal }); } catch (error) { next(error); } };
export const unarchiveDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const deal = await chatbotService.unarchiveDealService(dealId); logger.info(`Deal unarchived: ${dealId} by user ${req.context.userId}`); res.status(200).json({ message: "Deal unarchived successfully", data: deal }); } catch (error) { next(error); } };
export const retryDealEmail = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.retryDealEmailService(dealId); if (result.success) { logger.info(`Deal email retried successfully: ${dealId} by user ${req.context.userId}`); res.status(200).json({ message: "Email sent successfully", data: result }); } else { logger.warn(`Deal email retry failed: ${dealId} - ${result.error}`); res.status(200).json({ message: "Email retry failed", data: result }); } } catch (error) { next(error); } };
export const createSystemMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content } = req.body; if (!content) throw new CustomError("Message content is required", 400); const message = await chatbotService.createSystemMessageService(dealId, content); res.status(201).json({ message: "System message created successfully", data: message }); } catch (error) { next(error); } };

export const startConversation = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const userId = req.context.userId; const { startConversation } = await import("./convo/conversation-service.js"); const result = await startConversation(dealId, userId); res.status(200).json(result); } catch (error) { next(error); } };
export const sendConversationMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content } = req.body; const userId = req.context.userId; if (!content) throw new CustomError("Message content is required", 400); const { processConversationMessage } = await import("./convo/conversation-service.js"); const result = await processConversationMessage({ dealId, vendorMessage: content, userId }); res.status(200).json(result); } catch (error) { next(error); } };
export const getConversationExplainability = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const userId = req.context.userId; const { getLastExplainability } = await import("./convo/conversation-service.js"); const explainability = await getLastExplainability(dealId, userId); if (!explainability) { res.status(404).json({ message: "No explainability available for this deal" }); return; } res.status(200).json({ message: "Explainability retrieved successfully", data: explainability }); } catch (error) { next(error); } };

export const runDemo = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { scenario, maxRounds = 10 } = req.body; if (!scenario) throw new CustomError("Scenario is required", 400); const validScenarios = ["HARD", "MEDIUM", "SOFT", "WALK_AWAY"]; if (!validScenarios.includes(scenario)) throw new CustomError(`Invalid scenario: ${scenario}. Must be one of: ${validScenarios.join(", ")}`, 400); const result = await chatbotService.runDemoService(dealId, scenario, maxRounds); logger.info(`[RunDemo] Demo completed for deal ${dealId}`, { scenario, totalRounds: result.totalRounds, finalStatus: result.finalStatus, userId: req.context.userId }); res.status(200).json({ message: "Demo completed successfully", data: result }); } catch (error) { next(error); } };
export const resumeDeal = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const deal = await chatbotService.resumeDealService(dealId); logger.info(`[ResumeController] Deal resumed: ${dealId}`, { userId: req.context.userId }); res.status(200).json({ message: "Deal resumed successfully", data: deal }); } catch (error) { next(error); } };

export const getRequisitionsWithDeals = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const { projectId, status, dateFrom, dateTo, sortBy, archived, page = 1, limit = 10 } = req.query; const filters: chatbotService.RequisitionsWithDealsFilters = {}; if (projectId) filters.projectId = parseInt(projectId as string, 10); if (status) filters.status = status as any; if (dateFrom) filters.dateFrom = dateFrom as string; if (dateTo) filters.dateTo = dateTo as string; if (sortBy) filters.sortBy = sortBy as any; if (archived) filters.archived = archived as "active" | "archived" | "all"; filters.companyId = req.context?.userType === "super_admin" ? null : req.context?.companyId || null; const result = await chatbotService.getRequisitionsWithDealsService(filters, parseInt(page as string, 10), parseInt(limit as string, 10)); res.status(200).json({ message: "Requisitions retrieved successfully", data: { requisitions: result.data, total: result.total, page: result.page, totalPages: result.totalPages } }); } catch (error) { next(error); } };
export const getRequisitionDeals = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqIdParam = req.params.rfqId || req.params.requisitionId; const { status, sortBy, sortOrder, archived } = req.query; const companyId = req.context?.userType === "super_admin" ? null : req.context?.companyId || null; const result = await chatbotService.getRequisitionDealsService(getNumericParam(rfqIdParam), { status: status as string, sortBy: sortBy as string, sortOrder: sortOrder as "asc" | "desc", archived: archived as "active" | "archived" | "all" }, companyId); res.status(200).json({ message: "Requisition deals retrieved successfully", data: result }); } catch (error) { next(error); } };
export const getDealSummary = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.getDealSummaryService(dealId); res.status(200).json({ message: "Deal summary retrieved successfully", data: result }); } catch (error) { next(error); } };
export const exportDealPDF = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const rfqId = getNumericParam(req.params.rfqId); const result = await chatbotService.exportDealPDFService(dealId, rfqId); res.setHeader("Content-Type", "application/pdf"); res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`); res.setHeader("Content-Length", result.data.length); res.send(result.data); } catch (error) { next(error); } };
export const emailDealPDF = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const rfqId = getNumericParam(req.params.rfqId); const { email } = req.body; if (!email || typeof email !== "string") { res.status(400).json({ message: "Email address is required" }); return; } await chatbotService.emailDealPDFService(dealId, rfqId, email); res.status(200).json({ message: `Deal summary PDF sent to ${email}`, data: { email, sentAt: new Date().toISOString() } }); } catch (error) { next(error); } };
export const getDealUtility = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.getDealUtilityService(dealId); res.status(200).json({ message: "Utility calculated successfully", data: result }); } catch (error) { next(error); } };
export const getVendorAddresses = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const vendorId = getNumericParam(req.params.vendorId); const addresses = await chatbotService.getVendorAddressesService(vendorId); res.status(200).json({ message: "Vendor addresses retrieved successfully", data: addresses }); } catch (error) { next(error); } };
export const getBehavioralData = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.getBehavioralDataService(dealId); res.status(200).json({ message: "Behavioral data retrieved successfully", data: result }); } catch (error) { next(error); } };
export const getRequisitionsForNegotiation = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const companyId = req.context?.userType === "super_admin" ? null : req.context?.companyId || null; const result = await chatbotService.getRequisitionsForNegotiationService(companyId); res.status(200).json({ message: "Requisitions for negotiation retrieved successfully", data: result }); } catch (error) { next(error); } };
export const getRequisitionVendors = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqId = getNumericParam(req.params.rfqId); const result = await chatbotService.getRequisitionVendorsService(rfqId); res.status(200).json({ message: "Requisition vendors retrieved successfully", data: result }); } catch (error) { next(error); } };

export const sendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content, role = "VENDOR" } = req.body; const { mode = "CONVERSATION" } = req.query; if (!content) throw new CustomError("Message content is required", 400); if (mode === "CONVERSATION") { const { processConversationMessage } = await import("./convo/conversation-service.js"); const result = await processConversationMessage({ dealId, vendorMessage: content, userId: req.context.userId }); const dealWithMessages = await chatbotService.getDealService(dealId); res.status(200).json({ message: "Message processed successfully", data: { deal: dealWithMessages.deal, messages: dealWithMessages.messages, latestMessage: result.data?.accordoMessage, conversationState: result.data?.conversationState, dealStatus: result.data?.dealStatus, meso: result.data?.meso ?? null } }); } else { const result = await chatbotService.processVendorMessageService({ dealId, content, role, userId: req.context.userId }); logger.info(`Vendor message processed for deal ${dealId}: ${result.decision.action}`); const dealWithMessages = await chatbotService.getDealService(dealId); res.status(200).json({ message: "Message processed successfully", data: { deal: dealWithMessages.deal, messages: dealWithMessages.messages, latestMessage: result.message, decision: result.decision, explainability: result.explainability } }); } } catch (error) { next(error); } };
export const saveDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqId = getNumericParam(req.params.rfqId); const vendorId = getNumericParam(req.params.vendorId); const draftData = req.body; const draft = await chatbotService.saveDraftService({ rfqId, vendorId, userId: req.context.userId, data: draftData }); res.status(201).json({ message: "Draft saved successfully", data: draft }); } catch (error) { next(error); } };
export const listDrafts = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqId = getNumericParam(req.params.rfqId); const vendorId = getNumericParam(req.params.vendorId); const drafts = await chatbotService.listDraftsService(rfqId, vendorId, req.context.userId); res.status(200).json({ message: "Drafts retrieved successfully", data: drafts }); } catch (error) { next(error); } };
export const getDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const draftId = getParam(req.params.draftId); const draft = await chatbotService.getDraftService(draftId); res.status(200).json({ message: "Draft retrieved successfully", data: draft }); } catch (error) { next(error); } };
export const deleteDraft = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const draftId = getParam(req.params.draftId); await chatbotService.deleteDraftService(draftId); res.status(200).json({ message: "Draft deleted successfully" }); } catch (error) { next(error); } };

export const startNegotiation = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const result = await chatbotService.startNegotiationService(dealId); logger.info(`Negotiation started for deal ${dealId} with AI-PM opening offer`); res.status(200).json({ message: "Negotiation started successfully", data: result }); } catch (error) { next(error); } };
export const getVendorScenarios = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const scenarios = await chatbotService.getVendorScenariosService(dealId); res.status(200).json({ message: "Vendor scenarios retrieved successfully", data: scenarios }); } catch (error) { next(error); } };
export const vendorSendMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content } = req.body; if (!content || !content.trim()) throw new CustomError("Message content is required", 400); const result = await chatbotService.vendorSendMessageService(dealId, content, req.context.userId); logger.info(`Vendor message processed for deal ${dealId}: AI-PM responded with ${result.pmDecision.action}`); res.status(200).json({ message: "Message processed successfully", data: result }); } catch (error) { next(error); } };

export const saveVendorMessageInstant = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { content } = req.body; const userId = req.context.userId; if (!content || !content.trim()) throw new CustomError("Message content is required", 400); const result = await chatbotService.saveVendorMessageOnlyService({ dealId, content, userId }); logger.info(`[Phase1] Vendor message saved instantly for deal ${dealId}`); res.status(200).json({ message: "Vendor message saved", data: { vendorMessage: result.message, deal: result.deal, extractedOffer: result.extractedOffer, pmProcessing: result.pmProcessing, processingState: result.processingState } }); } catch (error) { next(error); } };
export const generatePMResponseAsync = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { vendorMessageId } = req.body; const userId = req.context.userId; if (!vendorMessageId) throw new CustomError("vendorMessageId is required", 400); const result = await chatbotService.generatePMResponseAsyncService({ dealId, vendorMessageId, userId }); logger.info(`[Phase2] PM response generated for deal ${dealId}: ${result.decision.action}`); res.status(200).json({ message: "PM response generated", data: { pmMessage: result.message, decision: result.decision, explainability: result.explainability, deal: result.deal, generationSource: result.generationSource, meso: result.meso ?? null } }); } catch (error) { next(error); } };
export const generatePMResponseFallback = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { vendorMessageId } = req.body; const userId = req.context.userId; if (!vendorMessageId) throw new CustomError("vendorMessageId is required", 400); const result = await chatbotService.generatePMFallbackResponseService({ dealId, vendorMessageId, userId }); logger.info(`[Fallback] PM fallback response generated for deal ${dealId}`); res.status(200).json({ message: "PM fallback response generated", data: { pmMessage: result.message, decision: result.decision, explainability: result.explainability, deal: result.deal, generationSource: result.generationSource } }); } catch (error) { next(error); } };

export const processMesoSelection = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { selectedOptionId } = req.body; const result = await chatbotService.processMesoSelectionService({ dealId, selectedOptionId, userId: req.context.userId }); logger.info(`MESO selection processed for deal ${dealId}: option ${selectedOptionId}`); res.status(200).json({ message: "Deal accepted successfully", data: { deal: result.deal, message: result.message, selectedOption: result.selectedOption, phase: "DEAL_ACCEPTED" } }); } catch (error) { next(error); } };
export const processOthersSelection = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { totalPrice, paymentTermsDays } = req.body; const result = await chatbotService.processOthersSelectionService({ dealId, totalPrice, paymentTermsDays, userId: req.context.userId }); logger.info(`Others selection processed for deal ${dealId}: $${totalPrice}, Net ${paymentTermsDays}`); res.status(200).json({ message: "Counter-offer submitted successfully", data: { pmMessage: result.message, decision: result.decision, explainability: result.explainability, deal: result.deal, meso: result.meso, generationSource: result.generationSource } }); } catch (error) { next(error); } };
export const processFinalOfferConfirmation = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { isConfirmedFinal } = req.body; const result = await chatbotService.processFinalOfferConfirmationService({ dealId, isConfirmedFinal, userId: req.context.userId }); logger.info(`Final offer confirmation for deal ${dealId}: confirmed=${isConfirmedFinal}`); res.status(200).json({ message: isConfirmedFinal ? "Final offers generated" : "Continuing negotiation", data: { deal: result.deal, message: result.message, meso: result.meso, continueNegotiation: result.continueNegotiation, phase: result.continueNegotiation ? "NORMAL_NEGOTIATION" : "FINAL_MESO" } }); } catch (error) { next(error); } };

export const archiveRequisition = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqId = getNumericParam(req.params.rfqId); const result = await chatbotService.archiveRequisitionService(rfqId); res.status(200).json({ message: `Requisition archived successfully. ${result.archivedDealsCount} deals also archived.`, data: result }); } catch (error) { next(error); } };
export const unarchiveRequisition = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const rfqId = getNumericParam(req.params.rfqId); const unarchiveDeals = req.body.unarchiveDeals !== false; const result = await chatbotService.unarchiveRequisitionService(rfqId, unarchiveDeals); res.status(200).json({ message: `Requisition unarchived successfully. ${result.unarchivedDealsCount} deals also unarchived.`, data: result }); } catch (error) { next(error); } };

export const generateNextVendorMessage = async (req: Request, res: Response, next: NextFunction): Promise<void> => { try { const dealId = getParam(req.params.dealId); const { scenario } = req.body; if (!scenario) throw new CustomError('Scenario is required', 400); const validatedScenario = vendorSimulatorService.validateScenario(scenario); const result = await vendorSimulatorService.generateNextVendorMessage({ dealId, scenario: validatedScenario, userId: req.context?.userId }); logger.info(`[VendorSimController] Vendor message generated for deal ${dealId}: ${result.vendorMessage.id}`, { dealId, scenario: validatedScenario, completed: result.completed, userId: req.context?.userId }); res.status(200).json({ message: 'Vendor message generated successfully', data: { vendorMessage: result.vendorMessage, accordoMessage: result.accordoMessage, deal: result.deal, completed: result.completed } }); } catch (error) { next(error); } };

// ============================================================================
// Routes Setup
// ============================================================================

chatbotRouter.get('/deals/:dealId/lookup', authMiddleware, validateParams(dealIdSchema), lookupDeal);
chatbotRouter.get('/requisitions', authMiddleware, getRequisitionsWithDeals);
chatbotRouter.get('/requisitions/for-negotiation', authMiddleware, getRequisitionsForNegotiation);
chatbotRouter.get('/requisitions/:rfqId/deals', authMiddleware, validateParams(rfqIdSchema), getRequisitionDeals);
chatbotRouter.get('/requisitions/:rfqId/vendors', authMiddleware, validateParams(rfqIdSchema), getRequisitionVendors);
chatbotRouter.post('/requisitions/:rfqId/archive', authMiddleware, validateParams(rfqIdSchema), archiveRequisition);
chatbotRouter.post('/requisitions/:rfqId/unarchive', authMiddleware, validateParams(rfqIdSchema), unarchiveRequisition);

chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/smart-defaults', authMiddleware, validateParams(rfqVendorSchema), getSmartDefaults);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/drafts', authMiddleware, validateParams(rfqVendorSchema), saveDraft);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/drafts', authMiddleware, validateParams(rfqVendorSchema), listDrafts);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId', authMiddleware, getDraft);
chatbotRouter.delete('/requisitions/:rfqId/vendors/:vendorId/drafts/:draftId', authMiddleware, deleteDraft);

chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals', authMiddleware, validateParams(rfqVendorSchema), validateQuery(listDealsQuerySchema), listDeals);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals', authMiddleware, validateParams(rfqVendorSchema), validateBody(createDealWithConfigSchema), createDealWithConfig);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId', authMiddleware, validateParams(nestedDealSchema), getDeal);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/config', authMiddleware, validateParams(nestedDealSchema), getDealConfig);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/utility', authMiddleware, validateParams(nestedDealSchema), getDealUtility);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/summary', authMiddleware, validateParams(nestedDealSchema), getDealSummary);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/export-pdf', authMiddleware, validateParams(nestedDealSchema), exportDealPDF);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/email-pdf', authMiddleware, validateParams(nestedDealSchema), emailDealPDF);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/explainability', authMiddleware, validateParams(nestedDealSchema), getLastExplainability);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/behavioral', authMiddleware, validateParams(nestedDealSchema), getBehavioralData);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/messages', authMiddleware, validateParams(nestedDealSchema), validateQuery(modeQuerySchema), validateBody(processMessageSchema), sendMessage);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start', authMiddleware, validateParams(nestedDealSchema), startConversation);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message-instant', authMiddleware, validateParams(nestedDealSchema), validateBody(processMessageSchema), saveVendorMessageInstant);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-async', authMiddleware, validateParams(nestedDealSchema), generatePMResponseAsync);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/pm-response-fallback', authMiddleware, validateParams(nestedDealSchema), generatePMResponseFallback);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/reset', authMiddleware, validateParams(nestedDealSchema), resetDeal);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/archive', authMiddleware, validateParams(nestedDealSchema), archiveDeal);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/unarchive', authMiddleware, validateParams(nestedDealSchema), unarchiveDeal);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/retry-email', authMiddleware, validateParams(nestedDealSchema), retryDealEmail);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/simulate', authMiddleware, validateParams(nestedDealSchema), generateNextVendorMessage);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/demo', authMiddleware, validateParams(nestedDealSchema), runDemo);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/resume', authMiddleware, validateParams(nestedDealSchema), resumeDeal);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/start-negotiation', authMiddleware, validateParams(nestedDealSchema), startNegotiation);
chatbotRouter.get('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-scenarios', authMiddleware, validateParams(nestedDealSchema), getVendorScenarios);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/vendor-message', authMiddleware, validateParams(nestedDealSchema), validateBody(processMessageSchema), vendorSendMessage);

chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/select', authMiddleware, validateParams(nestedDealSchema), validateBody(mesoSelectSchema), processMesoSelection);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/others', authMiddleware, validateParams(nestedDealSchema), validateBody(mesoOthersSchema), processOthersSelection);
chatbotRouter.post('/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/final-offer/confirm', authMiddleware, validateParams(nestedDealSchema), validateBody(finalOfferConfirmSchema), processFinalOfferConfirmation);

chatbotRouter.get('/vendors/:vendorId/addresses', authMiddleware, getVendorAddresses);

chatbotRouter.get('/templates/default', authMiddleware, getDefaultTemplate);
chatbotRouter.post('/templates', authMiddleware, createTemplate);
chatbotRouter.get('/templates', authMiddleware, listTemplates);
chatbotRouter.get('/templates/:id', authMiddleware, getTemplate);
chatbotRouter.put('/templates/:id', authMiddleware, updateTemplate);
chatbotRouter.post('/templates/:id/set-default', authMiddleware, setDefaultTemplate);
chatbotRouter.delete('/templates/:id', authMiddleware, deleteTemplate);
chatbotRouter.delete('/templates/:id/permanent', authMiddleware, permanentDeleteTemplate);

export default chatbotRouter;
