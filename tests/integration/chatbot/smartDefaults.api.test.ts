// Set JWT secret BEFORE importing any modules that use it
process.env.JWT_ACCESS_SECRET = 'test-secret-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key';

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Express } from 'express';
import models from '../../../src/models/index.js';
import chatbotRoutes from '../../../src/modules/chatbot/chatbot.routes.js';
import { errorHandler } from '../../../src/middlewares/error-handler.js';
import {
  createMockCompany,
  createMockUser,
  createMockProject,
  createMockRequisition,
  createMockRequisitionProduct,
  createMockRole,
  createMockProduct,
  createMockVendor,
} from '../../helpers/factories.js';
import jwt from 'jsonwebtoken';

// Test JWT secret
const TEST_JWT_SECRET = 'test-secret-key';

describe('Smart Defaults API - Date Extraction', () => {
  let app: Express;
  let company: any;
  let role: any;
  let user: any;
  let project: any;
  let product: any;
  let vendor: any;
  let requisition: any;
  let authToken: string;

  beforeAll(() => {
    // Create express app for testing
    app = express();
    app.use(express.json());
    app.use('/api/chatbot', chatbotRoutes);
    app.use(errorHandler);
  });

  beforeEach(async () => {
    // Create test data
    company = await models.Company.create(createMockCompany());
    role = await models.Role.create(createMockRole({ companyId: company.id }));
    user = await models.User.create(createMockUser({ companyId: company.id, roleId: role.id }));
    project = await models.Project.create(createMockProject({ companyId: company.id }));
    product = await models.Product.create(createMockProduct({ companyId: company.id }));
    vendor = await models.VendorCompany.create(createMockVendor({ companyId: company.id }));

    // Generate auth token
    authToken = jwt.sign(
      { userId: user.id, userType: user.userType, companyId: company.id },
      TEST_JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('GET /api/chatbot/requisitions/:rfqId/vendors/:vendorId/smart-defaults', () => {
    it('should return smart defaults with maxDeliveryDate', async () => {
      // Arrange
      const maxDeliveryDate = new Date('2026-03-20');
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
          targetPrice: 50,
          qty: 100,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data).toBeDefined();
      expect(response.body.data.delivery.maxDeliveryDate).toBe('2026-03-20');
    });

    it('should return smart defaults with negotiationClosureDate', async () => {
      // Arrange
      const negotiationClosureDate = new Date('2026-02-28');
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          negotiationClosureDate,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
          targetPrice: 50,
          qty: 100,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data).toBeDefined();
      expect(response.body.data.delivery.negotiationClosureDate).toBe('2026-02-28');
    });

    it('should return both dates when both are present', async () => {
      // Arrange
      const maxDeliveryDate = new Date('2026-03-20');
      const negotiationClosureDate = new Date('2026-02-28');

      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate,
          negotiationClosureDate,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
          targetPrice: 50,
          qty: 100,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data.delivery.maxDeliveryDate).toBe('2026-03-20');
      expect(response.body.data.delivery.negotiationClosureDate).toBe('2026-02-28');
    });

    it('should return null for dates when not present', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: null,
          negotiationClosureDate: null,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data.delivery.maxDeliveryDate).toBeNull();
      expect(response.body.data.delivery.negotiationClosureDate).toBeNull();
    });

    it('should format dates in ISO format (YYYY-MM-DD)', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: new Date('2026-03-20T10:30:00Z'),
          negotiationClosureDate: new Date('2026-02-28T15:45:00Z'),
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data.delivery.maxDeliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(response.body.data.delivery.negotiationClosureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(response.body.data.delivery.maxDeliveryDate).toBe('2026-03-20');
      expect(response.body.data.delivery.negotiationClosureDate).toBe('2026-02-28');
    });

    it('should return 404 when requisition not found', async () => {
      // Act & Assert
      const response = await request(app)
        .get(`/api/chatbot/requisitions/999999/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);

      expect(response.body.message).toBeDefined();
    });

    it('should return complete smart defaults structure', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: new Date('2026-03-20'),
          negotiationClosureDate: new Date('2026-02-28'),
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
          targetPrice: 50,
          qty: 100,
        })
      );

      // Act
      const response = await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Assert
      expect(response.body.data).toHaveProperty('priceQuantity');
      expect(response.body.data).toHaveProperty('paymentTerms');
      expect(response.body.data).toHaveProperty('delivery');
      expect(response.body.data).toHaveProperty('source');
      expect(response.body.data).toHaveProperty('confidence');

      expect(response.body.data.delivery).toHaveProperty('typicalDeliveryDays');
      expect(response.body.data.delivery).toHaveProperty('maxDeliveryDate');
      expect(response.body.data.delivery).toHaveProperty('negotiationClosureDate');
    });

    it('should return 401 when no auth token provided', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
        })
      );

      // Act & Assert
      await request(app)
        .get(`/api/chatbot/requisitions/${requisition.id}/vendors/${vendor.id}/smart-defaults`)
        .expect(401);
    });
  });
});
