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
  "/create",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateBody(createProductSchema),
  createProduct,
);

productRouter.get(
  "/get-all",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllProducts,
);

productRouter.get(
  "/get/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  validateParams(productIdSchema),
  getProduct,
);

productRouter.get(
  "/getall",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllProduct,
);

productRouter.put(
  "/update/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  validateParams(productIdSchema),
  validateBody(updateProductSchema),
  updateProduct,
);

productRouter.delete(
  "/delete/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateParams(productIdSchema),
  deleteProduct,
);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
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
  "/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  validateParams(productIdSchema),
  getProduct,
);
productRouter.put(
  "/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  validateParams(productIdSchema),
  validateBody(updateProductSchema),
  updateProduct,
);
productRouter.delete(
  "/:productid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  validateParams(productIdSchema),
  deleteProduct,
);

export default productRouter;
