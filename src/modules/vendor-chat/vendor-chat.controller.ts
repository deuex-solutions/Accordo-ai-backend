import type { Request, Response, NextFunction } from 'express';
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
import {
  submitQuoteSchema,
  editQuoteSchema,
  uniqueTokenQuerySchema,
  enterChatSchema,
  sendMessageSchema,
  pmResponseSchema,
  mesoSelectSchema,
  mesoOthersSchema,
  finalOfferConfirmSchema,
  submitDiscountSchema,
  submitPaymentTermsSchema,
} from './vendor-chat.validator.js';


/**
 * Vendor Chat Controller
 * Handles public vendor chat endpoints (no authentication required)
 * All endpoints authenticate via uniqueToken
 */

/**
 * Submit initial vendor quotation
 * POST /api/vendor-chat/quote
 */
export const submitQuote = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = submitQuoteSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, contractDetails } = value;
    const result = await submitVendorQuote(uniqueToken, contractDetails);

    res.status(200).json({
      message: 'Quote submitted successfully',
      data: {
        contractId: result.contract.id,
        dealId: result.deal?.id || null,
        canEdit: result.canEdit,
        chatUrl: result.chatUrl,
        status: 'InitialQuotation',
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Check if quote can be edited
 * GET /api/vendor-chat/can-edit-quote?uniqueToken=x
 */
export const checkCanEditQuote = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = uniqueTokenQuerySchema.validate(req.query);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const result = await canEditQuote(value.uniqueToken);

    res.status(200).json({
      message: result.reason,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Edit quote (if no messages yet)
 * PUT /api/vendor-chat/quote
 */
export const editQuote = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = editQuoteSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, contractDetails } = value;
    const contract = await editVendorQuote(uniqueToken, contractDetails);

    res.status(200).json({
      message: 'Quote updated successfully',
      data: {
        contractId: contract.id,
        status: contract.status,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get deal data for vendor (strips PM targets)
 * GET /api/vendor-chat/deal?uniqueToken=x
 */
export const getDeal = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = uniqueTokenQuerySchema.validate(req.query);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const result = await getDealForVendor(value.uniqueToken);

    res.status(200).json({
      message: 'Deal data retrieved',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Enter chat - creates opening message from quote
 * POST /api/vendor-chat/enter?uniqueToken=x
 */
export const enterChat = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Accept token from query or body
    const uniqueToken = req.query.uniqueToken || req.body.uniqueToken;
    const { error, value } = enterChatSchema.validate({ uniqueToken });
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const result = await vendorEnterChat(value.uniqueToken);

    res.status(200).json({
      message: result.openingMessage
        ? 'Chat entered, opening message created'
        : 'Chat entered',
      data: {
        deal: result.deal,
        openingMessage: result.openingMessage,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Send vendor message (instant save - Phase 1)
 * POST /api/vendor-chat/message
 */
export const sendMessage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = sendMessageSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, content } = value;
    const result = await vendorSendMessageInstant(uniqueToken, content);

    res.status(200).json({
      message: 'Message sent',
      data: {
        vendorMessage: result.vendorMessage,
        deal: result.deal,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get PM response (async - Phase 2)
 * POST /api/vendor-chat/pm-response
 */
export const getPMResponse = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = pmResponseSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, vendorMessageId } = value;
    const result = await generatePMResponse(uniqueToken, vendorMessageId);

    res.status(200).json({
      message: 'PM response generated',
      data: {
        pmMessage: result.pmMessage,
        decision: result.decision,
        deal: result.deal,
        meso: result.meso, // MESO options for vendor selection
        explainability: result.explainability,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ============================================================================
// MESO + Others Flow Controllers (February 2026)
// ============================================================================

/**
 * Select a MESO option (auto-accepts deal)
 * POST /api/vendor-chat/meso/select
 */
export const selectMesoOption = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = mesoSelectSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, selectedOptionId } = value;
    const result = await selectMesoOptionService(uniqueToken, selectedOptionId);

    res.status(200).json({
      message: 'MESO option selected successfully',
      data: {
        deal: result.deal,
        message: result.message,
        selectedOffer: result.selectedOffer,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit "Others" form with custom price/terms
 * POST /api/vendor-chat/meso/others
 */
export const submitOthers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = mesoOthersSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, totalPrice, paymentTermsDays } = value;
    const result = await submitOthersService(uniqueToken, totalPrice, paymentTermsDays);

    res.status(200).json({
      message: 'Others offer submitted successfully',
      data: {
        vendorMessage: result.vendorMessage,
        pmMessage: result.pmMessage,
        decision: result.decision,
        deal: result.deal,
        meso: result.meso,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Confirm or deny final offer
 * POST /api/vendor-chat/final-offer/confirm
 */
export const confirmFinalOffer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = finalOfferConfirmSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, isConfirmedFinal } = value;
    const result = await confirmFinalOfferService(uniqueToken, isConfirmedFinal);

    res.status(200).json({
      message: 'Final offer response recorded',
      data: {
        pmMessage: result.pmMessage,
        decision: result.decision,
        deal: result.deal,
        meso: result.meso,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit initial discount (Feature 1)
 * POST /api/vendor-chat/discount
 */
export const submitDiscount = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = submitDiscountSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, percent } = value;
    const result = await submitInitialDiscountService(uniqueToken, percent);

    res.status(200).json({
      message: 'Discount submitted successfully',
      data: {
        vendorMessage: result.vendorMessage,
        pmMessage: result.pmMessage,
        decision: result.decision,
        deal: result.deal,
        meso: result.meso,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit payment terms (Feature 2)
 * POST /api/vendor-chat/payment-terms
 */
export const submitPaymentTerms = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { error, value } = submitPaymentTermsSchema.validate(req.body);
    if (error) {
      res.status(400).json({ message: error.details[0].message });
      return;
    }

    const { uniqueToken, days } = value;
    const result = await submitPaymentTermsService(uniqueToken, days);

    res.status(200).json({
      message: 'Payment terms submitted successfully',
      data: {
        vendorMessage: result.vendorMessage,
        pmMessage: result.pmMessage,
        decision: result.decision,
        deal: result.deal,
        meso: result.meso,
      },
    });
  } catch (error) {
    next(error);
  }
};

export default {
  submitQuote,
  checkCanEditQuote,
  editQuote,
  getDeal,
  enterChat,
  sendMessage,
  getPMResponse,
  selectMesoOption,
  submitOthers,
  confirmFinalOffer,
  submitDiscount,
  submitPaymentTerms,
};
