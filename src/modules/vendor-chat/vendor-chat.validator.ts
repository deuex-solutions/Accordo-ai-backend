import Joi from 'joi';

/**
 * Validation schemas for vendor-chat module
 * All endpoints are public (no auth) - validation is key for security
 */

export const submitQuoteSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  contractDetails: Joi.object({
    products: Joi.array().items(
      Joi.object({
        productId: Joi.number().required(),
        productName: Joi.string().required(),
        quantity: Joi.number().required().min(0),
        quotedPrice: Joi.alternatives().try(
          Joi.number().min(0),
          Joi.string().allow('')
        ).required(),
        deliveryDate: Joi.string().allow('').optional(),
      })
    ).required(),
    additionalTerms: Joi.object({
      paymentTerms: Joi.string().allow('').optional(),
      netPaymentDay: Joi.alternatives().try(
        Joi.number().min(0),
        Joi.string().allow('')
      ).optional(),
      prePaymentPercentage: Joi.alternatives().try(
        Joi.number().min(0).max(100),
        Joi.string().allow('')
      ).optional(),
      postPaymentPercentage: Joi.alternatives().try(
        Joi.number().min(0).max(100),
        Joi.string().allow('')
      ).optional(),
      additionalNotes: Joi.string().allow('').optional(),
    }).optional(),
  }).required(),
});

export const editQuoteSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  contractDetails: Joi.object({
    products: Joi.array().items(
      Joi.object({
        productId: Joi.number().required(),
        productName: Joi.string().required(),
        quantity: Joi.number().required().min(0),
        quotedPrice: Joi.alternatives().try(
          Joi.number().min(0),
          Joi.string().allow('')
        ).required(),
        deliveryDate: Joi.string().allow('').optional(),
      })
    ).required(),
    additionalTerms: Joi.object({
      paymentTerms: Joi.string().allow('').optional(),
      netPaymentDay: Joi.alternatives().try(
        Joi.number().min(0),
        Joi.string().allow('')
      ).optional(),
      prePaymentPercentage: Joi.alternatives().try(
        Joi.number().min(0).max(100),
        Joi.string().allow('')
      ).optional(),
      postPaymentPercentage: Joi.alternatives().try(
        Joi.number().min(0).max(100),
        Joi.string().allow('')
      ).optional(),
      additionalNotes: Joi.string().allow('').optional(),
    }).optional(),
  }).required(),
});

export const uniqueTokenQuerySchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
});

export const enterChatSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
});

export const sendMessageSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  content: Joi.string().required().min(1).max(5000),
});

export const pmResponseSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  vendorMessageId: Joi.string().required().uuid(),
});

// ============================================================================
// MESO + Others Flow Schemas (February 2026)
// ============================================================================

export const mesoSelectSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  selectedOptionId: Joi.string().required().min(1).max(100),
});

export const mesoOthersSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  totalPrice: Joi.number().required().positive(),
  paymentTermsDays: Joi.number().required().integer().min(1).max(180),
});

export const finalOfferConfirmSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  isConfirmedFinal: Joi.boolean().required(),
});

// ============================================================================
// Structured Prompt Schemas (April 2026)
// Feature 1: initial discount ask; Feature 2: payment terms dropdown
// ============================================================================

export const submitDiscountSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  percent: Joi.number().required().integer().min(0).max(100),
});

export const submitPaymentTermsSchema = Joi.object({
  uniqueToken: Joi.string().required().min(10).max(100),
  // 0 = Immediately; otherwise 1..365 (see Q8 in the design discussion)
  days: Joi.number()
    .required()
    .integer()
    .min(0)
    .max(365),
});

export default {
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
};
