import { Request, Response, NextFunction } from 'express';
import { getCustomersService, getAllCustomerService } from './customer.service.js';
import { createUserService, updateUserService } from '../user/user.service.js';

export const getAllCustomers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getCustomersService(req.context.userId);
    res.status(200).json({ message: 'Customers', data });
  } catch (error) {
    next(error);
  }
};

export const getCustomers = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = '1', limit = '10' } = req.query;
    const customers = await getAllCustomerService(
      search as string | undefined,
      page as string | number,
      limit as string | number
    );
    res.status(201).json({ message: 'Customers', customers });
  } catch (error) {
    next(error);
  }
};

export const createCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const customerData = { ...req.body, userType: 'procurement' };
    const data = await createUserService(customerData, req.context.userId);
    res.status(201).json({ message: 'Customer created successfully', data });
  } catch (error) {
    next(error);
  }
};

export const updateCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await updateUserService(Number(req.params.customerId), req.body);
    res.status(201).json({ message: 'Customer updated successfully', data });
  } catch (error) {
    next(error);
  }
};
