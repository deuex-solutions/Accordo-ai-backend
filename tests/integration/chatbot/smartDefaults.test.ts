import { describe, it, expect, beforeEach } from 'vitest';
import { getSmartDefaultsService } from '../../../src/modules/chatbot/chatbot.service.js';
import models from '../../../src/models/index.js';
import {
  createMockCompany,
  createMockUser,
  createMockProject,
  createMockRequisition,
  createMockRequisitionProduct,
  createMockRole,
  createMockProduct,
} from '../../helpers/factories.js';

describe('Smart Defaults Service - Date Extraction', () => {
  let company: any;
  let role: any;
  let user: any;
  let project: any;
  let product: any;
  let requisition: any;

  beforeEach(async () => {
    // Create test data
    company = await models.Company.create(createMockCompany());
    role = await models.Role.create(createMockRole({ companyId: company.id }));
    user = await models.User.create(createMockUser({ companyId: company.id, roleId: role.id }));
    project = await models.Project.create(createMockProject({ companyId: company.id }));
    product = await models.Product.create(createMockProduct({ companyId: company.id }));
  });

  describe('Date Extraction', () => {
    it('should return maxDeliveryDate when present in requisition', async () => {
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.maxDeliveryDate).toBe('2026-03-20');
    });

    it('should return negotiationClosureDate when present in requisition', async () => {
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.negotiationClosureDate).toBe('2026-02-28');
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.maxDeliveryDate).toBe('2026-03-20');
      expect(result.delivery.negotiationClosureDate).toBe('2026-02-28');
    });

    it('should return null for maxDeliveryDate when not present', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: null,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
        })
      );

      // Act
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.maxDeliveryDate).toBeNull();
    });

    it('should return null for negotiationClosureDate when not present', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.negotiationClosureDate).toBeNull();
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.maxDeliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.delivery.negotiationClosureDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(result.delivery.maxDeliveryDate).toBe('2026-03-20');
      expect(result.delivery.negotiationClosureDate).toBe('2026-02-28');
    });
  });

  describe('Response Structure', () => {
    it('should return complete smart defaults structure with dates', async () => {
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result).toHaveProperty('priceQuantity');
      expect(result).toHaveProperty('paymentTerms');
      expect(result).toHaveProperty('delivery');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('confidence');

      expect(result.delivery).toHaveProperty('typicalDeliveryDays');
      expect(result.delivery).toHaveProperty('maxDeliveryDate');
      expect(result.delivery).toHaveProperty('negotiationClosureDate');
    });

    it('should not break existing smart defaults functionality', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
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
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert - existing fields should still work
      expect(result.priceQuantity.targetUnitPrice).toBe(50);
      expect(result.priceQuantity.maxAcceptablePrice).toBe(60); // 20% higher
      expect(result.paymentTerms.minDays).toBe(30);
      expect(result.paymentTerms.maxDays).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when requisition not found', async () => {
      // Act & Assert
      await expect(
        getSmartDefaultsService(999999, user.id)
      ).rejects.toThrow('Requisition not found');
    });

    it('should handle requisitions without products gracefully', async () => {
      // Arrange
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: new Date('2026-03-20'),
        })
      );

      // Act
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert - should still return dates even without products
      expect(result.delivery.maxDeliveryDate).toBe('2026-03-20');
      expect(result.priceQuantity.targetUnitPrice).toBe(100); // Default value
    });
  });

  describe('Edge Cases', () => {
    it('should handle past dates correctly', async () => {
      // Arrange
      const pastDate = new Date('2020-01-01');
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          maxDeliveryDate: pastDate,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
        })
      );

      // Act
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert - should still return the date, validation happens in frontend
      expect(result.delivery.maxDeliveryDate).toBe('2020-01-01');
    });

    it('should handle future dates correctly', async () => {
      // Arrange
      const futureDate = new Date('2030-12-31');
      requisition = await models.Requisition.create(
        createMockRequisition({
          projectId: project.id,
          negotiationClosureDate: futureDate,
        })
      );

      await models.RequisitionProduct.create(
        createMockRequisitionProduct({
          requisitionId: requisition.id,
          productId: product.id,
        })
      );

      // Act
      const result = await getSmartDefaultsService(requisition.id, user.id);

      // Assert
      expect(result.delivery.negotiationClosureDate).toBe('2030-12-31');
    });
  });
});
