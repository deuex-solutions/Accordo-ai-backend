import { Router } from 'express';
import {
  createVendor,
  createVendorWithCompany,
  createVendorStep,
  updateVendorStep,
  getVendorForReview,
  getAllVendors,
  getVendor,
  updateVendor,
  deleteVendor,
} from './vendor.controller.js';
import {
  authMiddleware,
  checkPermission,
} from '../../middlewares/auth.middleware.js';

const vendorRouter = Router();
const moduleId = 5;

/**
 * Step-based vendor creation endpoints
 * POST /create-vendor?step=1 - Creates vendor + company (returns companyId)
 * PUT /create-vendor/:companyId?step=2 - Adds address
 * PUT /create-vendor/:companyId?step=3 - Adds banking info
 * PUT /create-vendor/:companyId?step=4 - Adds contact info
 * GET /create-vendor/:companyId?step=5 - Review (read-only)
 */
vendorRouter.post(
  '/create-vendor',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createVendorStep
);

vendorRouter.put(
  '/create-vendor/:companyId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  updateVendorStep
);

vendorRouter.get(
  '/create-vendor/:companyId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getVendorForReview
);

// Legacy unified endpoint (kept for backward compatibility)
vendorRouter.post(
  '/company/create',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createVendorWithCompany
);

// Legacy endpoint: Create vendor only (kept for backward compatibility)
vendorRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createVendor
);

vendorRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllVendors
);

vendorRouter.get(
  '/:vendorId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getVendor
);

vendorRouter.put(
  '/:vendorId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  updateVendor
);

vendorRouter.delete(
  '/:vendorId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  deleteVendor
);

export default vendorRouter;
