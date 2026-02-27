import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createProductSchema,
  updateProductSchema,
  productIdSchema,
} from '../../../src/modules/product/product.validator.js';
import {
  createProductService,
  getProductService,
  getProductsService,
  updateProductService,
  deleteProductService,
} from '../../../src/modules/product/product.service.js';
import { createMockProduct, createMockProductNonGst, createMockUser, createMockCompany, createMockRole } from '../../helpers/factories.js';
import models from '../../../src/models/index.js';

describe('Product Validator', () => {
  describe('createProductSchema', () => {
    it('should validate a valid GST product', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 18,
        tds: 12345,
        type: 'Goods',
        UOM: 'units',
      };

      const { error, value } = createProductSchema.validate(data);
      expect(error).toBeUndefined();
      expect(value).toEqual(data);
    });

    it('should validate a valid Non-GST product', () => {
      const data = {
        productName: 'Test Service',
        category: 'Consulting',
        brandName: 'Service Corp',
        gstType: 'Non-GST',
        tds: 54321,
        type: 'Services',
        UOM: 'units',
      };

      const { error, value } = createProductSchema.validate(data);
      expect(error).toBeUndefined();
      expect(value.gstType).toBe('Non-GST');
    });

    it('should reject invalid GST type', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'Non-Gst', // Wrong case - should be "Non-GST"
        tds: 12345,
        type: 'Goods',
        UOM: 'units',
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('GST type must be either "GST" or "Non-GST"');
    });

    it('should require GST percentage when GST type is GST', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        // Missing gstPercentage
        tds: 12345,
        type: 'Goods',
        UOM: 'units',
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('GST percentage is required');
    });

    it('should reject invalid GST percentage values', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 15, // Invalid - must be 0, 5, 12, 18, or 28
        tds: 12345,
        type: 'Goods',
        UOM: 'units',
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('GST percentage must be one of');
    });

    it('should reject missing required fields', () => {
      const data = {
        productName: 'Test Product',
        // Missing category, brandName, gstType, tds, type, UOM
      };

      const { error } = createProductSchema.validate(data, { abortEarly: false });
      expect(error).toBeDefined();
      expect(error?.details.length).toBeGreaterThan(1);
    });

    it('should reject invalid product type', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 18,
        tds: 12345,
        type: 'InvalidType', // Invalid - must be "Goods" or "Services"
        UOM: 'units',
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('Type must be either "Goods" or "Services"');
    });

    it('should reject invalid UOM', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 18,
        tds: 12345,
        type: 'Goods',
        UOM: 'pieces', // Invalid - not in valid UOM list
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('UOM must be one of');
    });

    it('should reject negative tds', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 18,
        tds: -100, // Invalid - must be positive
        type: 'Goods',
        UOM: 'units',
      };

      const { error } = createProductSchema.validate(data);
      expect(error).toBeDefined();
      expect(error?.details[0].message).toContain('HSN Code must be a positive number');
    });

    it('should strip unknown fields', () => {
      const data = {
        productName: 'Test Product',
        category: 'Electronics',
        brandName: 'Test Brand',
        gstType: 'GST',
        gstPercentage: 18,
        tds: 12345,
        type: 'Goods',
        UOM: 'units',
        unknownField: 'should be stripped',
        companyId: 123, // Should also be stripped
      };

      const { error, value } = createProductSchema.validate(data, { stripUnknown: true });
      expect(error).toBeUndefined();
      expect(value.unknownField).toBeUndefined();
      expect(value.companyId).toBeUndefined();
    });
  });

  describe('updateProductSchema', () => {
    it('should allow partial updates', () => {
      const data = {
        productName: 'Updated Name',
      };

      const { error, value } = updateProductSchema.validate(data);
      expect(error).toBeUndefined();
      expect(value.productName).toBe('Updated Name');
    });

    it('should validate GST percentage when updating to GST type', () => {
      const data = {
        gstType: 'GST',
        gstPercentage: 18,
      };

      const { error, value } = updateProductSchema.validate(data);
      expect(error).toBeUndefined();
      expect(value.gstType).toBe('GST');
      expect(value.gstPercentage).toBe(18);
    });
  });

  describe('productIdSchema', () => {
    it('should validate a valid product ID', () => {
      const data = {
        productid: 1,
      };

      const { error, value } = productIdSchema.validate(data);
      expect(error).toBeUndefined();
      expect(value.productid).toBe(1);
    });

    it('should reject non-positive product ID', () => {
      const data = {
        productid: 0,
      };

      const { error } = productIdSchema.validate(data);
      expect(error).toBeDefined();
    });

    it('should reject non-integer product ID', () => {
      const data = {
        productid: 1.5,
      };

      const { error } = productIdSchema.validate(data);
      expect(error).toBeDefined();
    });
  });
});

describe('Product Service', () => {
  let testCompany: any;
  let testUser: any;
  let testRole: any;

  beforeEach(async () => {
    // Create test role first (required for user)
    testRole = await models.Role.create(createMockRole());

    // Create test company
    testCompany = await models.Company.create(createMockCompany());

    // Create test user with company
    testUser = await models.User.create(
      createMockUser({
        companyId: testCompany.id,
        roleId: testRole.id,
      })
    );
  });

  describe('createProductService', () => {
    it('should create a GST product successfully', async () => {
      const productData = createMockProduct();
      delete productData.companyId; // Should be set by service

      const product = await createProductService(productData, testUser.id);

      expect(product).toBeDefined();
      expect(product.productName).toBe(productData.productName);
      expect(product.gstType).toBe('GST');
      expect(product.gstPercentage).toBe(18);
      expect(product.companyId).toBe(testCompany.id);
    });

    it('should create a Non-GST product successfully', async () => {
      const productData = createMockProductNonGst();
      delete productData.companyId;

      const product = await createProductService(productData, testUser.id);

      expect(product).toBeDefined();
      expect(product.productName).toBe(productData.productName);
      expect(product.gstType).toBe('Non-GST');
      expect(product.gstPercentage).toBeNull();
    });

    it('should throw error if user not found', async () => {
      const productData = createMockProduct();
      delete productData.companyId;

      await expect(createProductService(productData, 99999)).rejects.toThrow('User not found');
    });

    it('should throw error if user has no company', async () => {
      // Create user without company
      const userWithoutCompany = await models.User.create(
        createMockUser({
          email: 'nocompany@example.com',
          companyId: null,
          roleId: testRole.id,
        })
      );

      const productData = createMockProduct();
      delete productData.companyId;

      await expect(createProductService(productData, userWithoutCompany.id)).rejects.toThrow(
        'User is not associated with any company'
      );
    });

    it('should clear GST percentage when type is Non-GST', async () => {
      const productData = {
        ...createMockProductNonGst(),
        gstPercentage: 18, // Should be cleared
      };
      delete productData.companyId;

      const product = await createProductService(productData, testUser.id);

      expect(product.gstType).toBe('Non-GST');
      expect(product.gstPercentage).toBeNull();
    });
  });

  describe('getProductService', () => {
    it('should retrieve an existing product', async () => {
      const created = await models.Product.create(
        createMockProduct({ companyId: testCompany.id })
      );

      const product = await getProductService({ id: created.id });

      expect(product).toBeDefined();
      expect(product?.id).toBe(created.id);
    });

    it('should throw error for non-existent product', async () => {
      await expect(getProductService({ id: 99999 })).rejects.toThrow('Product not found');
    });
  });

  describe('getProductsService', () => {
    it('should retrieve paginated products', async () => {
      // Create multiple products
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Product 1' }));
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Product 2' }));
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Product 3' }));

      const result = await getProductsService(undefined, 1, 10, testUser.id);

      expect(result.data.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should search products by name', async () => {
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Apple iPhone' }));
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Samsung Galaxy' }));
      await models.Product.create(createMockProduct({ companyId: testCompany.id, productName: 'Apple MacBook' }));

      const result = await getProductsService('Apple', 1, 10, testUser.id);

      expect(result.data.length).toBe(2);
      expect(result.data.every((p: any) => p.productName.includes('Apple'))).toBe(true);
    });
  });

  describe('updateProductService', () => {
    it('should update a product successfully', async () => {
      const created = await models.Product.create(
        createMockProduct({ companyId: testCompany.id })
      );

      const [affectedCount] = await updateProductService(created.id, {
        productName: 'Updated Product',
      });

      expect(affectedCount).toBe(1);

      const updated = await models.Product.findByPk(created.id);
      expect(updated?.productName).toBe('Updated Product');
    });

    it('should throw error for non-existent product', async () => {
      await expect(
        updateProductService(99999, { productName: 'Updated' })
      ).rejects.toThrow('Product not found');
    });

    it('should clear GST percentage when updating to Non-GST', async () => {
      const created = await models.Product.create(
        createMockProduct({ companyId: testCompany.id, gstType: 'GST', gstPercentage: 18 })
      );

      await updateProductService(created.id, {
        gstType: 'Non-GST',
      });

      const updated = await models.Product.findByPk(created.id);
      expect(updated?.gstType).toBe('Non-GST');
      expect(updated?.gstPercentage).toBeNull();
    });
  });

  describe('deleteProductService', () => {
    it('should delete a product successfully', async () => {
      const created = await models.Product.create(
        createMockProduct({ companyId: testCompany.id })
      );

      const result = await deleteProductService({ id: created.id });

      expect(result).toBe(1);

      const deleted = await models.Product.findByPk(created.id);
      expect(deleted).toBeNull();
    });

    it('should throw error for non-existent product', async () => {
      await expect(deleteProductService({ id: 99999 })).rejects.toThrow('Product not found');
    });
  });
});
