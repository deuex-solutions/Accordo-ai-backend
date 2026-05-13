import { Router } from "express";
import {
  getAllCustomers,
  createCustomer,
  updateCustomer,
  getCustomers,
} from "./customer.controller.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";

const customerRouter = Router();
const moduleId = 1;

customerRouter.get(
  "/get-all",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllCustomers,
);

customerRouter.get(
  "/get-all-customer",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getCustomers,
);

customerRouter.post(
  "/create",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createCustomer,
);

customerRouter.put(
  "/update/:customerid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  updateCustomer,
);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
customerRouter.get(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllCustomers,
);
customerRouter.post(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createCustomer,
);
customerRouter.put(
  "/:customerid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  updateCustomer,
);

export default customerRouter;
