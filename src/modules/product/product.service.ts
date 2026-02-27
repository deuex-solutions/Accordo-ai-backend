import { Op } from 'sequelize';
import repo from './product.repo.js';
import userRepo from '../user/user.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import type { Product, GSTType } from '../../models/product.js';

export interface ProductData {
  productName: string;
  category: string;
  brandName: string;
  gstType: GSTType;
  gstPercentage?: number | null;
  tds: number;
  type: string;
  UOM: string;
}

export interface PaginatedProductsResponse {
  data: Product[];
  total: number;
  page: number;
  totalPages: number;
}

export const createProductService = async (
  productData: ProductData,
  userId: number
): Promise<Product> => {
  // Get user's company
  const user = await userRepo.getUser(userId);
  if (!user) {
    throw new CustomError('User not found', 404);
  }
  if (!user.companyId) {
    throw new CustomError('User is not associated with any company', 400);
  }

  // Validate GST percentage when GST type is GST
  if (productData.gstType === 'GST' && productData.gstPercentage === undefined) {
    throw new CustomError('GST percentage is required when GST type is "GST"', 400);
  }

  // Clear GST percentage if GST type is Non-GST
  if (productData.gstType === 'Non-GST') {
    productData.gstPercentage = null;
  }

  const payload: Partial<Product> = {
    ...productData,
    companyId: user.companyId,
  };

  try {
    return await repo.createProduct(payload);
  } catch (error) {
    // Handle specific database errors
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        throw new CustomError('Invalid product data: ' + error.message, 400);
      }
      if (error.name === 'SequelizeUniqueConstraintError') {
        throw new CustomError('A product with these details already exists', 409);
      }
      if (error.name === 'SequelizeDatabaseError') {
        // Handle ENUM constraint violations
        if (error.message.includes('invalid input value for enum')) {
          throw new CustomError('Invalid GST type. Must be "GST" or "Non-GST"', 400);
        }
        throw new CustomError('Database error: ' + error.message, 500);
      }
    }
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to create product',
      400
    );
  }
};

export const getAllProductService = async (userId: number): Promise<Product[]> => {
  try {
    return await repo.getAllProducts(userId);
  } catch (error) {
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to retrieve products',
      400
    );
  }
};

export const getProductsService = async (
  search: string | undefined,
  page: number | string = 1,
  limit: number | string = 10,
  userId: number
): Promise<PaginatedProductsResponse> => {
  const parsedPage = Number.parseInt(String(page), 10) || 1;
  const parsedLimit = Number.parseInt(String(limit), 10) || 10;
  const offset = (parsedPage - 1) * parsedLimit;

  const queryOptions: {
    where: Record<string, unknown>;
    limit: number;
    offset: number;
  } = {
    where: {},
    limit: parsedLimit,
    offset,
  };

  if (search) {
    // Multi-field OR search: Category, Name, Brand (tds is numeric, excluded from text search)
    queryOptions.where = {
      [Op.or]: [
        { category: { [Op.iLike]: `%${search}%` } },
        { productName: { [Op.iLike]: `%${search}%` } },
        { brandName: { [Op.iLike]: `%${search}%` } },
      ],
    };
  }

  try {
    const { rows, count } = await repo.getProducts(queryOptions, userId);
    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: parsedLimit ? Math.ceil(count / parsedLimit) : 1,
    };
  } catch (error) {
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to retrieve products',
      400
    );
  }
};

export const getProductService = async (productData: {
  id: number;
}): Promise<Product | null> => {
  try {
    const product = await repo.getProduct(productData);
    if (!product) {
      throw new CustomError('Product not found', 404);
    }
    return product;
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to retrieve product',
      400
    );
  }
};

export const updateProductService = async (
  productId: number,
  productData: Partial<ProductData>
): Promise<[affectedCount: number]> => {
  // Check if product exists
  const existingProduct = await repo.getProduct({ id: productId });
  if (!existingProduct) {
    throw new CustomError('Product not found', 404);
  }

  // Determine effective GST type (from update data or existing)
  const effectiveGstType = productData.gstType ?? existingProduct.gstType;

  // Validate GST percentage when GST type is GST
  if (effectiveGstType === 'GST') {
    const effectiveGstPercentage = productData.gstPercentage ?? existingProduct.gstPercentage;
    if (effectiveGstPercentage === undefined || effectiveGstPercentage === null) {
      throw new CustomError('GST percentage is required when GST type is "GST"', 400);
    }
  }

  // Clear GST percentage if GST type is being changed to Non-GST
  if (productData.gstType === 'Non-GST') {
    productData.gstPercentage = null;
  }

  try {
    const updatePayload: Partial<Product> = { ...productData };
    return await repo.updateProduct(productId, updatePayload);
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'SequelizeValidationError') {
        throw new CustomError('Invalid product data: ' + error.message, 400);
      }
      if (error.name === 'SequelizeDatabaseError') {
        if (error.message.includes('invalid input value for enum')) {
          throw new CustomError('Invalid GST type. Must be "GST" or "Non-GST"', 400);
        }
        throw new CustomError('Database error: ' + error.message, 500);
      }
    }
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to update product',
      400
    );
  }
};

export const deleteProductService = async (productData: {
  id: number;
}): Promise<number> => {
  // Check if product exists
  const existingProduct = await repo.getProduct(productData);
  if (!existingProduct) {
    throw new CustomError('Product not found', 404);
  }

  try {
    return await repo.deleteProduct(productData);
  } catch (error) {
    throw new CustomError(
      error instanceof Error ? error.message : 'Failed to delete product',
      400
    );
  }
};
