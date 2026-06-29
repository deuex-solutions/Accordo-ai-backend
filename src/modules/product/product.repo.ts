import models from '../../models/index.js';
import type { Product } from '../../models/procurement/product.js';

export interface ProductQueryOptions {
  where?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  order?: Array<[string, string]>;
}

export interface FindAndCountResult {
  rows: Product[];
  count: number;
}

const repo = {
  createProduct: async (productData: Partial<Product>): Promise<Product> => {
    return models.Product.create(productData);
  },

  getAllProducts: async (userId?: number): Promise<Product[]> => {
    if (userId) {
      const user = await models.User.findByPk(userId);
      if (user?.companyId) {
        return models.Product.findAll({ where: { companyId: user.companyId } });
      }
    }
    return models.Product.findAll();
  },

  getProducts: async (
    queryOptions: ProductQueryOptions = {},
    userId?: number
  ): Promise<FindAndCountResult> => {
    const options = { ...queryOptions };
    options.where = { ...(options.where || {}) };
    // Default sort by id ascending to maintain consistent order
    if (!options.order) {
      options.order = [['id', 'ASC']];
    }
    if (userId) {
      const user = await models.User.findByPk(userId);
      if (user?.companyId) {
        options.where.companyId = user.companyId;
      }
    }
    return models.Product.findAndCountAll(options);
  },

  getProduct: async ({ id }: { id: number }): Promise<Product | null> => {
    return models.Product.findByPk(id);
  },

  deleteProduct: async ({ id }: { id: number }): Promise<number> => {
    return models.Product.destroy({ where: { id } });
  },

  updateProduct: async (
    productId: number,
    productData: Partial<Product>
  ): Promise<[affectedCount: number]> => {
    return models.Product.update(productData, { where: { id: productId } });
  },
};

export default repo;
