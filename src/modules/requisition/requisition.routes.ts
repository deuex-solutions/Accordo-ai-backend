import { Router } from "express";
import {
  createRequisition,
  getAllRequisitions,
  getRequisition,
  updateRequisition,
  deleteRequisition,
  getRequisitionsForNegotiation,
  getRequisitionVendors,
} from "./requisition.controller.js";
import {
  authMiddleware,
  checkPermission,
} from "../../middlewares/auth.middleware.js";
import { upload } from "../../middlewares/upload.middleware.js";

const requisitionRouter = Router();
const moduleId = 3;

requisitionRouter.post(
  "/create",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  upload.array("files", 10),
  createRequisition,
);

requisitionRouter.get(
  "/get-all",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllRequisitions,
);

// Get requisitions available for negotiation (for deal wizard dropdown)
requisitionRouter.get(
  "/for-negotiation",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisitionsForNegotiation,
);

// Get vendors attached to a specific requisition (for deal wizard vendor dropdown)
requisitionRouter.get(
  "/:requisitionId/vendors",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisitionVendors,
);

requisitionRouter.get(
  "/get/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisition,
);

requisitionRouter.put(
  "/update/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  upload.array("files", 10),
  updateRequisition,
);

requisitionRouter.delete(
  "/delete/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  deleteRequisition,
);

// RESTful aliases (frontend uses these; verbose paths above kept for back-compat)
requisitionRouter.post(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  upload.array("files", 10),
  createRequisition,
);
requisitionRouter.get(
  "/",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllRequisitions,
);
requisitionRouter.get(
  "/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisition,
);
requisitionRouter.put(
  "/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  upload.array("files", 10),
  updateRequisition,
);
requisitionRouter.delete(
  "/:requisitionid",
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  deleteRequisition,
);

export default requisitionRouter;
