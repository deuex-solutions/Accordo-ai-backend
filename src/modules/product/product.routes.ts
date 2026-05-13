import { Router } from "express";
import {
  createProduct,
  getAllProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  getAllProduct,
} from "./product.controller.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";
import {
  validateBody,
  validateParams,
  createProductSchema,
  updateProductSchema,
  productIdSchema,
} from "./product.validator.js";

const productRouter = Router();
const moduleId = 4;

productRouter.post(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateBody(createProductSchema),
  createProduct,
);

productRouter.get(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllProducts,
);

productRouter.get(
  "/all",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllProduct,
);

productRouter.get(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  validateParams(productIdSchema),
  getProduct,
);

productRouter.put(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  validateParams(productIdSchema),
  validateBody(updateProductSchema),
  updateProduct,
);

productRouter.delete(
  "/:productId",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateParams(productIdSchema),
  deleteProduct,
);

export default productRouter;
