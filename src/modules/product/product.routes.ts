import { Router, type Request, type Response, type NextFunction } from "express";
import Joi from "joi";
import {
  createProductService,
  getProductService,
  getProductsService,
  deleteProductService,
  updateProductService,
  getAllProductService,
} from "./product.service.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";

const productRouter = Router();
const moduleId = 4;

// ============================================================================
// Validators & Schemas
// ============================================================================

const gstTypeEnum = ["GST", "Non-GST"] as const;
const productTypeEnum = ["Goods", "Services"] as const;
const uomEnum = ["units", "kgs", "liters", "boxes", "packs", "tons", "meters", "lots", "license"] as const;
const gstPercentageValues = [0, 5, 12, 18, 28] as const;

export const createProductSchema = Joi.object({
  productName: Joi.string().required().min(1).max(255),
  category: Joi.string().required().min(1).max(255),
  brandName: Joi.string().required().min(1).max(255),
  gstType: Joi.string().valid(...gstTypeEnum).required(),
  gstPercentage: Joi.when("gstType", {
    is: "GST",
    then: Joi.number().valid(...gstPercentageValues).required(),
    otherwise: Joi.number().allow(null).optional(),
  }),
  tds: Joi.number().positive().required(),
  type: Joi.string().valid(...productTypeEnum).required(),
  UOM: Joi.string().valid(...uomEnum).required(),
});

export const updateProductSchema = Joi.object({
  productName: Joi.string().min(1).max(255).optional(),
  category: Joi.string().min(1).max(255).optional(),
  brandName: Joi.string().min(1).max(255).optional(),
  gstType: Joi.string().valid(...gstTypeEnum).optional(),
  gstPercentage: Joi.when("gstType", {
    is: "GST",
    then: Joi.number().valid(...gstPercentageValues).required(),
    otherwise: Joi.number().allow(null).optional(),
  }),
  tds: Joi.number().positive().optional(),
  type: Joi.string().valid(...productTypeEnum).optional(),
  UOM: Joi.string().valid(...uomEnum).optional(),
});

export const productIdSchema = Joi.object({
  productId: Joi.number().integer().positive().required(),
});

const validateBody = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ success: false, message: "Validation error", errors: error.details.map((d) => d.message) });
    req.body = value;
    next();
  };
};

const validateParams = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req.params, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ success: false, message: "Validation error", errors: error.details.map((d) => d.message) });
    req.params = value;
    next();
  };
};

// ============================================================================
// Route Handlers & Endpoints
// ============================================================================

productRouter.post(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateBody(createProductSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await createProductService(req.body, req.context.userId);
      res.status(201).json({ message: "Product created successfully", data });
    } catch (error) { next(error); }
  }
);

productRouter.get(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search, page = "1", limit = "10" } = req.query;
      const data = await getProductsService(search as string | undefined, page as string, limit as string, req.context.userId);
      res.status(201).json({ message: "Products", ...data });
    } catch (error) { next(error); }
  }
);

productRouter.get(
  "/all",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getAllProductService(req.context.userId);
      res.status(200).json({ message: "Products", data });
    } catch (error) { next(error); }
  }
);

productRouter.get(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  validateParams(productIdSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getProductService({ id: Number(req.params.productId) });
      res.status(201).json({ message: "Product", data });
    } catch (error) { next(error); }
  }
);

productRouter.put(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  validateParams(productIdSchema),
  validateBody(updateProductSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await updateProductService(Number(req.params.productId), req.body);
      res.status(201).json({ message: "Product updated successfully", data });
    } catch (error) { next(error); }
  }
);

productRouter.delete(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateParams(productIdSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await deleteProductService({ id: Number(req.params.productId) });
      res.status(201).json({ message: "Product deleted successfully", data });
    } catch (error) { next(error); }
  }
);

export default productRouter;
