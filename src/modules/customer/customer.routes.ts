import { Router, type Request, type Response, type NextFunction } from 'express';
import { getCustomersService, getAllCustomerService } from './customer.service.js';
import { createUserService, updateUserService } from '../user/user.service.js';
import {
  authMiddleware,
  checkPermission,
} from '../../middlewares/auth.middleware.js';

const customerRouter = Router();
const moduleId = 1;

// ============================================================================
// Endpoint Handlers & Routes
// ============================================================================

customerRouter.get(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await getCustomersService(req.context.userId);
      res.status(200).json({ message: 'Customers', data });
    } catch (error) { next(error); }
  }
);

customerRouter.get(
  '/all',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 1),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { search, page = '1', limit = '10' } = req.query;
      const customers = await getAllCustomerService(
        search as string | undefined,
        page as string | number,
        limit as string | number
      );
      res.status(201).json({ message: 'Customers', customers });
    } catch (error) { next(error); }
  }
);

customerRouter.post(
  '/',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 3),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const customerData = { ...req.body, userType: 'procurement' };
      const data = await createUserService(customerData, req.context.userId);
      res.status(201).json({ message: 'Customer created successfully', data });
    } catch (error) { next(error); }
  }
);

customerRouter.put(
  '/:customerId',
  authMiddleware,
  (req, res, next) => checkPermission(req, res, next, moduleId, 2),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const data = await updateUserService(Number(req.params.customerId), req.body);
      res.status(201).json({ message: 'Customer updated successfully', data });
    } catch (error) { next(error); }
  }
);

export default customerRouter;
