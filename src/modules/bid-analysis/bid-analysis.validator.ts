import Joi from 'joi';

export const getRequisitionsSchema = Joi.object({
  search: Joi.string().allow('').optional(),
  status: Joi.string().valid('ready', 'awaiting', 'awarded', 'all').optional().default('all'),
  projectId: Joi.number().integer().positive().optional(),
  dateFrom: Joi.string().isoDate().optional(),
  dateTo: Joi.string().isoDate().optional(),
  page: Joi.number().integer().min(1).optional().default(1),
  limit: Joi.number().integer().min(1).max(100).optional().default(10),
  sortBy: Joi.string().valid('rfqId', 'subject', 'negotiationClosureDate', 'bidsCount', 'lowestPrice').optional().default('negotiationClosureDate'),
  sortOrder: Joi.string().valid('asc', 'desc').optional().default('desc'),
});

export const requisitionIdParamSchema = Joi.object({
  requisitionId: Joi.number().integer().positive().required(),
});

export const bidIdParamSchema = Joi.object({
  requisitionId: Joi.number().integer().positive().required(),
  bidId: Joi.string().uuid().required(),
});

export const selectBidBodySchema = Joi.object({
  remarks: Joi.string().max(1000).allow('').optional(),
});

export const rejectBidBodySchema = Joi.object({
  remarks: Joi.string().max(1000).allow('').optional(),
});
