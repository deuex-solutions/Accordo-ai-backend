import { Request, Response, NextFunction } from 'express';
import {
  createProductService,
  getProductService,
  getProductsService,
  deleteProductService,
  updateProductService,
  getAllProductService,
} from './product.service.js';

export const createProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await createProductService(req.body, req.context.userId);
    res.status(201).json({ message: 'Product created successfully', data });
  } catch (error) {
    next(error);
  }
};

export const getAllProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getAllProductService(req.context.userId);
    res.status(200).json({ message: 'Products', data });
  } catch (error) {
    next(error);
  }
};

export const getAllProducts = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = '1', limit = '10' } = req.query;
    const data = await getProductsService(
      search as string | undefined,
      page as string,
      limit as string,
      req.context.userId
    );
    res.status(201).json({ message: 'Products', ...data });
  } catch (error) {
    next(error);
  }
};

export const getProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getProductService({ id: Number(req.params.productId) });
    res.status(201).json({ message: 'Product', data });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await updateProductService(Number(req.params.productId), req.body);
    res.status(201).json({ message: 'Product updated successfully', data });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await deleteProductService({ id: Number(req.params.productId) });
    res.status(201).json({ message: 'Product deleted successfully', data });
  } catch (error) {
    next(error);
  }
};
