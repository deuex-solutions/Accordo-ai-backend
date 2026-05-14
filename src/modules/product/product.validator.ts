import Joi from "joi";
import type { Request, Response, NextFunction } from "express";

/**
 * Valid GST types - must match the backend ENUM exactly
 */
const gstTypeEnum = ["GST", "Non-GST"] as const;

/**
 * Valid product types
 */
const productTypeEnum = ["Goods", "Services"] as const;

/**
 * Valid UOM values
 */
const uomEnum = [
  "units",
  "kgs",
  "liters",
  "boxes",
  "packs",
  "tons",
  "meters",
  "lots",
  "license",
] as const;

/**
 * Valid GST percentage values
 */
const gstPercentageValues = [0, 5, 12, 18, 28] as const;

/**
 * Validation schema for creating a product
 */
export const createProductSchema = Joi.object({
  productName: Joi.string().required().min(1).max(255).messages({
    "string.empty": "Product name is required",
    "string.min": "Product name must be at least 1 character",
    "string.max": "Product name cannot exceed 255 characters",
    "any.required": "Product name is required",
  }),
  category: Joi.string().required().min(1).max(255).messages({
    "string.empty": "Category is required",
    "string.min": "Category must be at least 1 character",
    "string.max": "Category cannot exceed 255 characters",
    "any.required": "Category is required",
  }),
  brandName: Joi.string().required().min(1).max(255).messages({
    "string.empty": "Brand name is required",
    "string.min": "Brand name must be at least 1 character",
    "string.max": "Brand name cannot exceed 255 characters",
    "any.required": "Brand name is required",
  }),
  gstType: Joi.string()
    .valid(...gstTypeEnum)
    .required()
    .messages({
      "any.only": 'GST type must be either "GST" or "Non-GST"',
      "any.required": "GST type is required",
    }),
  gstPercentage: Joi.when("gstType", {
    is: "GST",
    then: Joi.number()
      .valid(...gstPercentageValues)
      .required()
      .messages({
        "any.only": "GST percentage must be one of: 0, 5, 12, 18, 28",
        "any.required": 'GST percentage is required when GST type is "GST"',
      }),
    otherwise: Joi.number().allow(null).optional(),
  }),
  tds: Joi.number().positive().required().messages({
    "number.positive": "HSN Code must be a positive number",
    "any.required": "HSN Code is required",
  }),
  type: Joi.string()
    .valid(...productTypeEnum)
    .required()
    .messages({
      "any.only": 'Type must be either "Goods" or "Services"',
      "any.required": "Type is required",
    }),
  UOM: Joi.string()
    .valid(...uomEnum)
    .required()
    .messages({
      "any.only":
        'UOM must be one of: "units", "kgs", "liters", "boxes", "packs", "tons", "meters", "lots", "license"',
      "any.required": "UOM is required",
    }),
});

/**
 * Validation schema for updating a product
 */
export const updateProductSchema = Joi.object({
  productName: Joi.string().min(1).max(255).optional().messages({
    "string.min": "Product name must be at least 1 character",
    "string.max": "Product name cannot exceed 255 characters",
  }),
  category: Joi.string().min(1).max(255).optional().messages({
    "string.min": "Category must be at least 1 character",
    "string.max": "Category cannot exceed 255 characters",
  }),
  brandName: Joi.string().min(1).max(255).optional().messages({
    "string.min": "Brand name must be at least 1 character",
    "string.max": "Brand name cannot exceed 255 characters",
  }),
  gstType: Joi.string()
    .valid(...gstTypeEnum)
    .optional()
    .messages({
      "any.only": 'GST type must be either "GST" or "Non-GST"',
    }),
  gstPercentage: Joi.when("gstType", {
    is: "GST",
    then: Joi.number()
      .valid(...gstPercentageValues)
      .required()
      .messages({
        "any.only": "GST percentage must be one of: 0, 5, 12, 18, 28",
        "any.required": 'GST percentage is required when GST type is "GST"',
      }),
    otherwise: Joi.number().allow(null).optional(),
  }),
  tds: Joi.number().positive().optional().messages({
    "number.positive": "HSN Code must be a positive number",
  }),
  type: Joi.string()
    .valid(...productTypeEnum)
    .optional()
    .messages({
      "any.only": 'Type must be either "Goods" or "Services"',
    }),
  UOM: Joi.string()
    .valid(...uomEnum)
    .optional()
    .messages({
      "any.only":
        'UOM must be one of: "units", "kgs", "liters", "boxes", "packs", "tons", "meters", "lots", "license"',
    }),
});

/**
 * Validation schema for product ID parameter
 */
export const productIdSchema = Joi.object({
  productId: Joi.number().integer().positive().required().messages({
    "number.base": "Product ID must be a number",
    "number.integer": "Product ID must be an integer",
    "number.positive": "Product ID must be a positive number",
    "any.required": "Product ID is required",
  }),
});

/**
 * Middleware function to validate request body
 */
export const validateBody = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
      return;
    }

    req.body = value;
    next();
  };
};

/**
 * Middleware function to validate request params
 */
export const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req.params, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => detail.message);
      res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
      return;
    }

    req.params = value;
    next();
  };
};
