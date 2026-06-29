import { Router, type Request, type Response, type NextFunction } from 'express';
import Joi from 'joi';
import {
  submitVendorQuote,
  canEditQuote,
  editVendorQuote,
  getDealForVendor,
  vendorEnterChat,
  vendorSendMessageInstant,
  generatePMResponse,
  selectMesoOptionService,
  submitOthersService,
  confirmFinalOfferService,
  submitInitialDiscountService,
  submitPaymentTermsService,
} from './vendor-chat.service.js';

/**
 * Vendor Chat Routes & Unified Endpoint Handlers
 * ALL routes are PUBLIC - NO authMiddleware
 * Authentication is via uniqueToken in request body/query
 */
const vendorChatRouter = Router();

// ============================================================================
// Validation Schemas
// ============================================================================

const submitQuoteSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  contractDetails: Joi.object({
    products: Joi.array().items(
      Joi.object({
        productId: Joi.number().required(),
        productName: Joi.string().required(),
        quantity: Joi.number().required().min(0),
        quotedPrice: Joi.alternatives().try(Joi.number().min(0), Joi.string().allow('')).required(),
        deliveryDate: Joi.string().allow('').optional(),
      })
    ).required(),
    additionalTerms: Joi.object({
      paymentTerms: Joi.string().allow('').optional(),
      netPaymentDay: Joi.alternatives().try(Joi.number().min(0), Joi.string().allow('')).optional(),
      prePaymentPercentage: Joi.alternatives().try(Joi.number().min(0).max(100), Joi.string().allow('')).optional(),
      postPaymentPercentage: Joi.alternatives().try(Joi.number().min(0).max(100), Joi.string().allow('')).optional(),
      additionalNotes: Joi.string().allow('').optional(),
    }).optional(),
  }).required(),
});

const editQuoteSchema = submitQuoteSchema;

const uniqueTokenQuerySchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
});

const enterChatSchema = uniqueTokenQuerySchema;

const sendMessageSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  content: Joi.string().required().min(1).max(5000),
});

const pmResponseSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  vendorMessageId: Joi.string().required().uuid(),
});

const mesoSelectSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  selectedOptionId: Joi.string().required().min(1).max(100),
});

const mesoOthersSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  totalPrice: Joi.number().required().positive(),
  paymentTermsDays: Joi.number().required().integer().min(1).max(180),
});

const finalOfferConfirmSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  isConfirmedFinal: Joi.boolean().required(),
});

const submitDiscountSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  percent: Joi.number().required().integer().min(0).max(100),
});

const submitPaymentTermsSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  days: Joi.number().required().integer().min(0).max(365),
});

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

vendorChatRouter.post('/quote', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = submitQuoteSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await submitVendorQuote(value.uniqueToken, value.contractDetails);
    res.status(200).json({ message: 'Quote submitted successfully', data: { contractId: result.contract.id, dealId: result.deal?.id || null, canEdit: result.canEdit, chatUrl: result.chatUrl, status: 'InitialQuotation' } });
  } catch (err) { next(err); }
});

vendorChatRouter.get('/can-edit-quote', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = uniqueTokenQuerySchema.validate(req.query);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await canEditQuote(value.uniqueToken);
    res.status(200).json({ message: result.reason, data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.put('/quote', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = editQuoteSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const contract = await editVendorQuote(value.uniqueToken, value.contractDetails);
    res.status(200).json({ message: 'Quote updated successfully', data: { contractId: contract.id, status: contract.status } });
  } catch (err) { next(err); }
});

vendorChatRouter.get('/deal', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = uniqueTokenQuerySchema.validate(req.query);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await getDealForVendor(value.uniqueToken);
    res.status(200).json({ message: 'Deal data retrieved', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/enter', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const uniqueToken = req.query.uniqueToken || req.body.uniqueToken;
    const { error, value } = enterChatSchema.validate({ uniqueToken });
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await vendorEnterChat(value.uniqueToken);
    res.status(200).json({ message: result.openingMessage ? 'Chat entered, opening message created' : 'Chat entered', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/message', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = sendMessageSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await vendorSendMessageInstant(value.uniqueToken, value.content);
    res.status(200).json({ message: 'Message sent', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/pm-response', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = pmResponseSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await generatePMResponse(value.uniqueToken, value.vendorMessageId);
    res.status(200).json({ message: 'PM response generated', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/meso/select', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = mesoSelectSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await selectMesoOptionService(value.uniqueToken, value.selectedOptionId);
    res.status(200).json({ message: 'MESO option selected successfully', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/meso/others', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = mesoOthersSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await submitOthersService(value.uniqueToken, value.totalPrice, value.paymentTermsDays);
    res.status(200).json({ message: 'Others offer submitted successfully', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/final-offer/confirm', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = finalOfferConfirmSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await confirmFinalOfferService(value.uniqueToken, value.isConfirmedFinal);
    res.status(200).json({ message: 'Final offer response recorded', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/discount', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = submitDiscountSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await submitInitialDiscountService(value.uniqueToken, value.percent);
    res.status(200).json({ message: 'Discount submitted successfully', data: result });
  } catch (err) { next(err); }
});

vendorChatRouter.post('/payment-terms', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { error, value } = submitPaymentTermsSchema.validate(req.body);
    if (error) { res.status(400).json({ message: error.details[0].message }); return; }
    const result = await submitPaymentTermsService(value.uniqueToken, value.days);
    res.status(200).json({ message: 'Payment terms submitted successfully', data: result });
  } catch (err) { next(err); }
});

export default vendorChatRouter;
