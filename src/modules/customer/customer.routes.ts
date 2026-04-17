import { Router } from 'express';
import {
  getAllCustomers,
  createCustomer,
  updateCustomer,
  getCustomers,
} from './customer.controller.js';
import {
  authMiddleware,
  checkPermission,
} from '../../middlewares/auth.middleware.js';

const customerRouter = Router();
const moduleId = 1;

customerRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getAllCustomers
);

customerRouter.get(
  '/all',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  getCustomers
);

customerRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  createCustomer
);

customerRouter.put(
  '/:customerId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  updateCustomer
);

export default customerRouter;
