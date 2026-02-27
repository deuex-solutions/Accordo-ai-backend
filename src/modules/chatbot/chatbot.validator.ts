import Joi from 'joi';

/**
 * Chatbot Validation Schemas
 */

/**
 * Schema for creating a deal
 */
export const createDealSchema = Joi.object({
  title: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'Title is required',
    'string.max': 'Title cannot exceed 255 characters',
  }),
  counterparty: Joi.string().allow('', null).optional(),
  mode: Joi.string()
    .valid('INSIGHTS', 'CONVERSATION')
    .default('CONVERSATION')
    .optional(),
  templateId: Joi.string().uuid().allow(null).optional(),
  requisitionId: Joi.number().integer().positive().allow(null).optional(),
  contractId: Joi.number().integer().positive().allow(null).optional(),
  vendorId: Joi.number().integer().positive().allow(null).optional(),
});

/**
 * Schema for creating a deal with full configuration (wizard mode)
 */
export const createDealWithConfigSchema = Joi.object({
  // Basic info (required)
  title: Joi.string().required().min(1).max(255).messages({
    'string.empty': 'Title is required',
    'string.max': 'Title cannot exceed 255 characters',
  }),
  counterparty: Joi.string().allow('', null).optional(),
  mode: Joi.string()
    .valid('INSIGHTS', 'CONVERSATION')
    .default('INSIGHTS')
    .required(),
  requisitionId: Joi.number().integer().positive().required().messages({
    'any.required': 'Requisition ID is required',
    'number.positive': 'Requisition ID must be positive',
  }),
  vendorId: Joi.number().integer().positive().required().messages({
    'any.required': 'Vendor ID is required',
    'number.positive': 'Vendor ID must be positive',
  }),
  priority: Joi.string()
    .valid('HIGH', 'MEDIUM', 'LOW')
    .default('MEDIUM')
    .required(),

  // Price & Quantity
  priceQuantity: Joi.object({
    targetUnitPrice: Joi.number().positive().required().messages({
      'any.required': 'Target unit price is required',
      'number.positive': 'Target unit price must be positive',
    }),
    maxAcceptablePrice: Joi.number().positive().required().messages({
      'any.required': 'Maximum acceptable price is required',
    }),
    minOrderQuantity: Joi.number().integer().positive().required().messages({
      'any.required': 'Minimum order quantity is required',
    }),
    preferredQuantity: Joi.number().integer().positive().allow(null).optional(),
  }).required(),

  // Payment Terms
  paymentTerms: Joi.object({
    minDays: Joi.number().integer().positive().required().messages({
      'any.required': 'Minimum payment days is required',
    }),
    maxDays: Joi.number().integer().positive().required().messages({
      'any.required': 'Maximum payment days is required',
    }),
    acceptedMethods: Joi.array()
      .items(Joi.string().valid('BANK_TRANSFER', 'CREDIT', 'LC'))
      .default(['BANK_TRANSFER']),
  }).required(),

  // Delivery
  delivery: Joi.object({
    requiredDate: Joi.string().isoDate().required().messages({
      'any.required': 'Required delivery date is required',
      'string.isoDate': 'Required delivery date must be a valid date',
      'string.empty': 'Required delivery date is required',
    }),
    preferredDate: Joi.string().isoDate().allow(null, '').optional(),
    locationId: Joi.string().allow(null, '').optional(),
    locationAddress: Joi.string().allow(null).optional(),
    partialDelivery: Joi.object({
      allowed: Joi.boolean().default(false),
      type: Joi.string().valid('QUANTITY', 'PERCENTAGE').allow(null).optional(),
      minValue: Joi.number().positive().allow(null).optional(),
    }).default({ allowed: false, type: null, minValue: null }),
  }).required(),

  // Contract & SLA
  contractSla: Joi.object({
    warrantyPeriod: Joi.string()
      .valid('0_MONTHS', '6_MONTHS', '1_YEAR', '2_YEARS', '3_YEARS', '5_YEARS', 'CUSTOM')
      .required()
      .messages({
        'any.required': 'Warranty period is required',
      }),
    customWarrantyMonths: Joi.when('warrantyPeriod', {
      is: 'CUSTOM',
      then: Joi.number().integer().min(0).max(120).required().messages({
        'any.required': 'Custom warranty months is required when warranty period is CUSTOM',
      }),
      otherwise: Joi.any().allow(null).optional(),
    }),
    defectLiabilityMonths: Joi.number().integer().positive().allow(null).optional(),
    lateDeliveryPenaltyPerDay: Joi.number().min(0.5).max(2).required().messages({
      'any.required': 'Late delivery penalty is required',
    }),
    maxPenaltyCap: Joi.object({
      type: Joi.string().valid('PERCENTAGE', 'FIXED').required(),
      value: Joi.number().positive().allow(null).optional(),
    }).allow(null).optional(),
    qualityStandards: Joi.array().items(Joi.string()).default([]),
  }).required(),

  // Negotiation Control
  // Note: maxRounds and walkawayThreshold were removed from frontend wizard UI (Feb 2026)
  // Backend applies defaults when these are missing from the request body
  negotiationControl: Joi.object({
    deadline: Joi.string().isoDate().allow(null, '').optional().default(null),
    maxRounds: Joi.number().integer().min(5).max(20).allow(null).default(10),
    walkawayThreshold: Joi.number().min(10).max(30).allow(null).default(20),
  }).default({ deadline: null, maxRounds: 10, walkawayThreshold: 20 }),

  // Parameter Weights (from Step 4 of wizard)
  parameterWeights: Joi.object().pattern(
    Joi.string(),
    Joi.number().min(0).max(100)
  ).optional().default({}),

  // Optional: contract reference
  contractId: Joi.number().integer().positive().allow(null).optional(),
  previousContractId: Joi.number().integer().positive().allow(null).optional(),

  // Custom Parameters
  customParameters: Joi.array().items(
    Joi.object({
      id: Joi.string().optional(),
      name: Joi.string().required(),
      type: Joi.string().valid('BOOLEAN', 'NUMBER', 'TEXT', 'DATE').required(),
      targetValue: Joi.alternatives().try(
        Joi.boolean(),
        Joi.number(),
        Joi.string()
      ).required(),
      flexibility: Joi.string().valid('FIXED', 'FLEXIBLE', 'NICE_TO_HAVE').default('FLEXIBLE'),
      includeInNegotiation: Joi.boolean().default(true),
    })
  ).default([]),
});

/**
 * Schema for smart defaults query
 */
export const smartDefaultsQuerySchema = Joi.object({
  rfqId: Joi.number().integer().positive().required(),
  vendorId: Joi.number().integer().positive().required(),
});

/**
 * Schema for processing a vendor message
 */
export const processMessageSchema = Joi.object({
  content: Joi.string().required().min(1).messages({
    'string.empty': 'Message content is required',
  }),
  role: Joi.string().valid('VENDOR', 'ACCORDO', 'SYSTEM').default('VENDOR').optional(),
});

/**
 * Schema for creating a system message
 */
export const createSystemMessageSchema = Joi.object({
  content: Joi.string().required().min(1).messages({
    'string.empty': 'Message content is required',
  }),
});

/**
 * Schema for deal ID parameter
 */
export const dealIdSchema = Joi.object({
  dealId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid deal ID format',
    'any.required': 'Deal ID is required',
  }),
});

/**
 * Schema for rfqId parameter (requisition ID)
 */
export const rfqIdSchema = Joi.object({
  rfqId: Joi.number().integer().positive().required().messages({
    'number.base': 'RFQ ID must be a number',
    'number.positive': 'RFQ ID must be positive',
    'any.required': 'RFQ ID is required',
  }),
});

/**
 * Schema for rfqId + vendorId parameters
 */
export const rfqVendorSchema = Joi.object({
  rfqId: Joi.number().integer().positive().required().messages({
    'number.base': 'RFQ ID must be a number',
    'number.positive': 'RFQ ID must be positive',
    'any.required': 'RFQ ID is required',
  }),
  vendorId: Joi.number().integer().positive().required().messages({
    'number.base': 'Vendor ID must be a number',
    'number.positive': 'Vendor ID must be positive',
    'any.required': 'Vendor ID is required',
  }),
});

/**
 * Schema for nested deal parameters (rfqId + vendorId + dealId)
 */
export const nestedDealSchema = Joi.object({
  rfqId: Joi.number().integer().positive().required().messages({
    'number.base': 'RFQ ID must be a number',
    'number.positive': 'RFQ ID must be positive',
    'any.required': 'RFQ ID is required',
  }),
  vendorId: Joi.number().integer().positive().required().messages({
    'number.base': 'Vendor ID must be a number',
    'number.positive': 'Vendor ID must be positive',
    'any.required': 'Vendor ID is required',
  }),
  dealId: Joi.string().uuid().required().messages({
    'string.guid': 'Invalid deal ID format',
    'any.required': 'Deal ID is required',
  }),
});

/**
 * Schema for mode query parameter (merged INSIGHTS/CONVERSATION)
 */
export const modeQuerySchema = Joi.object({
  mode: Joi.string()
    .valid('INSIGHTS', 'CONVERSATION')
    .default('INSIGHTS')
    .optional()
    .messages({
      'any.only': 'Mode must be either INSIGHTS or CONVERSATION',
    }),
});

/**
 * Schema for list deals query parameters
 */
export const listDealsQuerySchema = Joi.object({
  status: Joi.string()
    .valid('NEGOTIATING', 'ACCEPTED', 'WALKED_AWAY', 'ESCALATED')
    .optional(),
  mode: Joi.string().valid('INSIGHTS', 'CONVERSATION').optional(),
  archived: Joi.string().valid('true', 'false').optional(),
  deleted: Joi.string().valid('true', 'false').optional(),
  userId: Joi.number().integer().positive().optional(),
  vendorId: Joi.number().integer().positive().optional(),
  page: Joi.number().integer().positive().default(1).optional(),
  limit: Joi.number().integer().positive().max(100).default(10).optional(),
});

// ==================== MESO Selection Schemas (February 2026) ====================

/**
 * Schema for MESO option selection
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/select
 */
export const mesoSelectSchema = Joi.object({
  selectedOptionId: Joi.string().required().messages({
    'string.empty': 'Selected option ID is required',
    'any.required': 'Selected option ID is required',
  }),
});

/**
 * Schema for "Others" form submission
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/meso/others
 */
export const mesoOthersSchema = Joi.object({
  totalPrice: Joi.number().positive().required().messages({
    'number.positive': 'Total price must be a positive number',
    'any.required': 'Total price is required',
  }),
  paymentTermsDays: Joi.number().integer().min(1).max(180).required().messages({
    'number.min': 'Payment terms must be at least 1 day',
    'number.max': 'Payment terms cannot exceed 180 days',
    'any.required': 'Payment terms (days) is required',
  }),
});

/**
 * Schema for final offer confirmation
 * POST /api/chatbot/requisitions/:rfqId/vendors/:vendorId/deals/:dealId/final-offer/confirm
 */
export const finalOfferConfirmSchema = Joi.object({
  isConfirmedFinal: Joi.boolean().required().messages({
    'any.required': 'isConfirmedFinal (true/false) is required',
  }),
});

/**
 * Middleware function to validate request body
 */
export const validateBody = (schema: Joi.ObjectSchema) => {
  return (req: any, res: any, next: any) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.body = value;
    next();
  };
};

/**
 * Middleware function to validate request params
 */
export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: any, res: any, next: any) => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.params = value;
    next();
  };
};

/**
 * Middleware function to validate query parameters
 */
export const validateQuery = (schema: Joi.ObjectSchema) => {
  return (req: any, res: any, next: any) => {
    const { error, value } = schema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    req.query = value;
    next();
  };
};
