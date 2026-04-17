import { Router } from 'express';
import {
  createRequisition,
  getAllRequisitions,
  getRequisition,
  updateRequisition,
  deleteRequisition,
  getRequisitionsForNegotiation,
  getRequisitionVendors,
} from './requisition.controller.js';
import {
  authMiddleware,
  checkPermission,
} from '../../middlewares/auth.middleware.js';
import { upload } from '../../middlewares/upload.middleware.js';

const requisitionRouter = Router();
const moduleId = 3;

requisitionRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  upload.array('files', 10),
  createRequisition
);

requisitionRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllRequisitions
);

// Get requisitions available for negotiation (for deal wizard dropdown)
requisitionRouter.get(
  '/for-negotiation',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisitionsForNegotiation
);

// Get vendors attached to a specific requisition (for deal wizard vendor dropdown)
requisitionRouter.get(
  '/:requisitionId/vendors',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisitionVendors
);

requisitionRouter.get(
  '/:requisitionId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getRequisition
);

requisitionRouter.put(
  '/:requisitionId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  upload.array('files', 10),
  updateRequisition
);

requisitionRouter.delete(
  '/:requisitionId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  deleteRequisition
);

export default requisitionRouter;
