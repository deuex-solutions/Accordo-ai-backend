import { literal, QueryTypes } from 'sequelize';
import models, { sequelize } from '../../models/index.js';
import type { Requisition } from '../../models/requisition.js';
import type { RequisitionProduct } from '../../models/requisition-product.js';
import type { RequisitionAttachment } from '../../models/requisition-attachment.js';
import type { Transaction, WhereOptions } from 'sequelize';

export interface RequisitionData {
  projectId?: number;
  requisitionNumber?: string;
  requisitionName?: string;
  requisitionType?: string;
  shipTo?: string;
  deliveryDate?: Date;
  budgetedAmount?: number;
  status?: string;
  companyId?: number;
  productData?: any; // Can be array or JSON string
  [key: string]: any; // Allow additional properties from Requisition model
}

export interface RequisitionProductData {
  requisitionId?: number;
  productId?: number | null;
  quantity?: number | null;
  qty?: number | null;
  unitPrice?: number | null;
  targetPrice?: number | null;
  maximum_price?: number | null;
  gstType?: string;
  gstPercentage?: number | null;
  tds?: number | null;
  specification?: string;
  createdBy?: number;
}

export interface RequisitionAttachmentData {
  requisitionId?: number;
  filename?: string;
  filepath?: string;
  mimetype?: string;
  size?: number;
}

export interface RequisitionQueryOptions {
  where?: WhereOptions<Requisition>;
  limit?: number;
  offset?: number;
  order?: Array<[string, string]>;
  include?: any[];
  attributes?: any;
  having?: any;
  group?: string[];
  subQuery?: boolean;
}

export interface FindAndCountResult {
  rows: Requisition[];
  count: number;
}

const repo = {
  /**
   * Check if a product exists by ID
   */
  checkProductExists: async (productId: number): Promise<boolean> => {
    const product = await models.Product.findByPk(productId);
    return product !== null;
  },

  /**
   * Check if multiple products exist by their IDs
   * Returns an array of IDs that don't exist
   */
  checkProductsExist: async (productIds: number[]): Promise<number[]> => {
    const existingProducts = await models.Product.findAll({
      where: { id: productIds },
      attributes: ['id'],
    });
    const existingIds = existingProducts.map((p: any) => p.id);
    return productIds.filter(id => !existingIds.includes(id));
  },

  createRequisition: async (
    requisitionData: RequisitionData
  ): Promise<Requisition> => {
    return models.Requisition.create(requisitionData as any);
  },

  /**
   * Get all requisitions
   * Super Admin users (userType === 'super_admin') see all requisitions across companies
   */
  getAllRequisitions: async (userId?: number): Promise<Requisition[]> => {
    if (userId) {
      const user = await models.User.findByPk(userId);
      // Super Admin users see all requisitions, other users only see their company's
      const isAdmin = user?.userType === 'super_admin';
      if (!isAdmin && user?.companyId) {
        return models.Requisition.findAll({
          where: { companyId: user.companyId } as any,
        });
      }
    }
    return models.Requisition.findAll();
  },

  /**
   * Get requisitions with filtering and pagination
   * Super Admin users (userType === 'super_admin') see all requisitions across companies
   */
  getRequisitions: async (
    queryOptions: RequisitionQueryOptions = {},
    userId?: number
  ): Promise<FindAndCountResult> => {
    const options = { ...queryOptions };
    options.where = { ...(options.where || {}) };

    if (userId) {
      const user = await models.User.findByPk(userId);

      // Vendor users cannot view requisitions
      if (user?.userType === 'vendor') {
        return { rows: [], count: 0 };
      }

      // Super Admin sees all; others see only their company's (via Project.companyId)
      const isSuperAdmin = user?.userType === 'super_admin';
      if (!isSuperAdmin && user?.companyId) {
        (options as any).projectCompanyId = user.companyId;
      }
    }

    // Two-phase query for performance
    // First: Get count with contract aggregation
    const projectCompanyId = (options as any).projectCompanyId;
    const baseOptions: RequisitionQueryOptions = {
      attributes: [
        'id',
        [
          sequelize.fn('COUNT', sequelize.col('Contract.id')),
          'contractCount',
        ],
      ],
      include: [
        {
          model: models.Contract,
          as: 'Contract',
          attributes: [],
          required: false,
        },
        ...(projectCompanyId ? [{
          model: models.Project,
          as: 'Project',
          attributes: [],
          where: { companyId: projectCompanyId },
          required: true,
        }] : []),
      ],
      group: ['Requisition.id'],
      having: literal('COUNT("Contract"."id") > 0'),
      subQuery: false,
      where: options.where,
    };

    const countResult = await models.Requisition.findAll(baseOptions);
    const count = countResult.length;

    // Second: Get detailed data with pagination
    const detailOptions: RequisitionQueryOptions = {
      where: options.where,
      limit: options.limit,
      offset: options.offset,
      order: options.order || [['createdAt', 'DESC']],
      include: [
        {
          model: models.RequisitionProduct,
          as: 'RequisitionProduct',
          include: [
            {
              model: models.Product,
              as: 'Product',
            },
          ],
        },
        {
          model: models.RequisitionAttachment,
          as: 'RequisitionAttachment',
        },
        {
          model: models.Contract,
          as: 'Contract',
          include: [
            {
              model: models.User,
              as: 'Vendor',
              attributes: ['id', 'name', 'email'],
            },
          ],
        },
        {
          model: models.Project,
          as: 'Project',
          ...(projectCompanyId ? { where: { companyId: projectCompanyId }, required: true } : {}),
        },
      ],
    };

    const rows = await models.Requisition.findAll(detailOptions);

    return { rows, count };
  },

  getRequisition: async ({
    id,
  }: {
    id: number;
  }): Promise<Requisition | null> => {
    return models.Requisition.findByPk(id, {
      include: [
        {
          model: models.RequisitionProduct,
          as: 'RequisitionProduct',
          include: [
            {
              model: models.Product,
              as: 'Product',
            },
          ],
        },
        {
          model: models.RequisitionAttachment,
          as: 'RequisitionAttachment',
        },
        {
          model: models.Contract,
          as: 'Contract',
          include: [
            {
              model: models.User,
              as: 'Vendor',
              attributes: ['id', 'name', 'email'],
            },
          ],
        },
        {
          model: models.Project,
          as: 'Project',
        },
      ],
    });
  },

  deleteRequisition: async ({ id }: { id: number }): Promise<number> => {
    return models.Requisition.destroy({ where: { id } });
  },

  updateRequisition: async (
    requisitionId: number,
    requisitionData: RequisitionData
  ): Promise<[affectedCount: number]> => {
    const [count] = await models.Requisition.update(requisitionData as any, {
      where: { id: requisitionId },
    });
    return [count];
  },

  createRequisitionProduct: async (
    productData: RequisitionProductData
  ): Promise<RequisitionProduct> => {
    return models.RequisitionProduct.create(productData);
  },

  updateRequisitionProduct: async (
    requisitionProductId: number,
    productData: RequisitionProductData
  ): Promise<[affectedCount: number]> => {
    return models.RequisitionProduct.update(productData, {
      where: { id: requisitionProductId },
    });
  },

  deleteRequisitionProduct: async ({
    id,
  }: {
    id: number;
  }): Promise<number> => {
    return models.RequisitionProduct.destroy({ where: { id } });
  },

  createRequisitionAttachment: async (
    attachmentData: RequisitionAttachmentData
  ): Promise<RequisitionAttachment> => {
    return models.RequisitionAttachment.create(attachmentData);
  },

  deleteRequisitionAttachment: async ({
    id,
  }: {
    id: number;
  }): Promise<number> => {
    return models.RequisitionAttachment.destroy({ where: { id } });
  },

  deleteRequisitionAttachments: async (
    requisitionId: number,
    transaction?: Transaction
  ): Promise<number> => {
    return models.RequisitionAttachment.destroy({
      where: { requisitionId },
      transaction,
    });
  },

  deleteRequisitionProducts: async (
    requisitionId: number,
    transaction?: Transaction
  ): Promise<number> => {
    return models.RequisitionProduct.destroy({
      where: { requisitionId },
      transaction,
    });
  },

  /**
   * Get requisitions available for negotiation with summary data
   * Returns requisitions that have vendors attached (via Contracts)
   * Super Admin users see all requisitions, others see only their company's
   */
  getRequisitionsForNegotiation: async (userId: number): Promise<{
    id: number;
    rfqNumber: string;
    title: string;
    projectName: string;
    estimatedValue: number;
    productCount: number;
    vendorCount: number;
    negotiationClosureDate?: string;
  }[]> => {
    const user = await models.User.findByPk(userId);
    const isAdmin = user?.userType === 'super_admin';

    // Build WHERE clause based on user type
    const companyFilter = (!isAdmin && user?.companyId) ? `AND r."companyId" = ${user.companyId}` : '';

    const query = `
      SELECT
        r.id,
        r."rfqId" as "rfqNumber",
        r.subject as title,
        p."projectName" as "projectName",
        COALESCE(r."totalPrice", 0) as "estimatedValue",
        COALESCE(product_counts.product_count, 0)::int as "productCount",
        COALESCE(vendor_counts.vendor_count, 0)::int as "vendorCount",
        r."negotiationClosureDate" as "negotiationClosureDate"
      FROM "Requisitions" r
      LEFT JOIN "Projects" p ON p.id = r."projectId"
      LEFT JOIN (
        SELECT "requisitionId", COUNT(*) as product_count
        FROM "RequisitionProducts"
        GROUP BY "requisitionId"
      ) product_counts ON product_counts."requisitionId" = r.id
      LEFT JOIN (
        SELECT "requisitionId", COUNT(*) as vendor_count
        FROM "Contracts"
        GROUP BY "requisitionId"
      ) vendor_counts ON vendor_counts."requisitionId" = r.id
      WHERE vendor_counts.vendor_count > 0
      ${companyFilter}
      ORDER BY r."createdAt" DESC
    `;

    const results = await sequelize.query(query, {
      type: QueryTypes.SELECT,
    });

    return results as any[];
  },

  /**
   * Get vendors attached to a specific requisition via Contracts
   * Also counts past deals for each vendor and returns their delivery addresses
   *
   * IMPORTANT: If no contracts exist for this requisition, returns ALL vendors
   * so that deals can still be created. This supports the workflow where
   * users create deals before formally attaching vendors via contracts.
   */
  getRequisitionVendors: async (requisitionId: number): Promise<{
    id: number;
    name: string;
    companyName?: string;
    companyId?: number;
    pastDealsCount: number;
    addresses: {
      id: number;
      label: string;
      address: string;
      city: string | null;
      state: string | null;
      country: string | null;
      postalCode: string | null;
      isDefault: boolean;
    }[];
  }[]> => {
    // First, check if any contracts exist for this requisition
    const contractCountQuery = `
      SELECT COUNT(*) as count FROM "Contracts" WHERE "requisitionId" = :requisitionId
    `;
    const contractCountResult = await sequelize.query(contractCountQuery, {
      replacements: { requisitionId },
      type: QueryTypes.SELECT,
    }) as { count: string }[];

    const hasContracts = parseInt(contractCountResult[0]?.count || '0') > 0;

    // Query for vendors (either from contracts or all vendors)
    let vendorQuery: string;
    let queryReplacements: { requisitionId?: number } = {};

    if (hasContracts) {
      vendorQuery = `
        SELECT DISTINCT
          u.id,
          u.name,
          co.id as "companyId",
          co."companyName" as "companyName",
          COALESCE(deal_counts.deal_count, 0)::int as "pastDealsCount"
        FROM "Contracts" c
        JOIN "User" u ON u.id = c."vendorId"
        LEFT JOIN "Companies" co ON co.id = u."companyId"
        LEFT JOIN (
          SELECT cd.vendor_id, COUNT(*) as deal_count
          FROM chatbot_deals cd
          WHERE cd.status IN ('ACCEPTED', 'WALKED_AWAY', 'ESCALATED')
          GROUP BY cd.vendor_id
        ) deal_counts ON deal_counts.vendor_id = u.id
        WHERE c."requisitionId" = :requisitionId
        ORDER BY u.name
      `;
      queryReplacements = { requisitionId };
    } else {
      // No contracts exist - return ALL vendors (users with userType = 'vendor')
      vendorQuery = `
        SELECT DISTINCT
          u.id,
          u.name,
          co.id as "companyId",
          co."companyName" as "companyName",
          COALESCE(deal_counts.deal_count, 0)::int as "pastDealsCount"
        FROM "User" u
        LEFT JOIN "Companies" co ON co.id = u."companyId"
        LEFT JOIN (
          SELECT cd.vendor_id, COUNT(*) as deal_count
          FROM chatbot_deals cd
          WHERE cd.status IN ('ACCEPTED', 'WALKED_AWAY', 'ESCALATED')
          GROUP BY cd.vendor_id
        ) deal_counts ON deal_counts.vendor_id = u.id
        WHERE u."userType" = 'vendor'
        ORDER BY u.name
      `;
    }

    const vendors = await sequelize.query(vendorQuery, {
      replacements: queryReplacements,
      type: QueryTypes.SELECT,
    }) as { id: number; name: string; companyId?: number; companyName?: string; pastDealsCount: number }[];

    // Get company IDs for all vendors
    const companyIds = vendors
      .map(v => v.companyId)
      .filter((id): id is number => id !== null && id !== undefined);

    if (companyIds.length === 0) {
      // No companies found - return vendors without addresses
      return vendors.map(v => ({ ...v, addresses: [] }));
    }

    // Fetch all addresses for these companies in a single query
    const addressQuery = `
      SELECT
        id,
        "companyId",
        label,
        address,
        city,
        state,
        country,
        "postalCode",
        "isDefault"
      FROM "Addresses"
      WHERE "companyId" IN (:companyIds)
      ORDER BY "companyId", "isDefault" DESC, label
    `;

    const addresses = await sequelize.query(addressQuery, {
      replacements: { companyIds },
      type: QueryTypes.SELECT,
    }) as {
      id: number;
      companyId: number;
      label: string;
      address: string;
      city: string | null;
      state: string | null;
      country: string | null;
      postalCode: string | null;
      isDefault: boolean;
    }[];

    // Group addresses by companyId for efficient lookup
    const addressesByCompany = addresses.reduce((acc, addr) => {
      if (!acc[addr.companyId]) {
        acc[addr.companyId] = [];
      }
      acc[addr.companyId].push({
        id: addr.id,
        companyId: addr.companyId,
        label: addr.label,
        address: addr.address,
        city: addr.city,
        state: addr.state,
        country: addr.country,
        postalCode: addr.postalCode,
        isDefault: addr.isDefault,
      });
      return acc;
    }, {} as Record<number, typeof addresses>);

    // Map addresses to each vendor
    return vendors.map(vendor => ({
      ...vendor,
      addresses: vendor.companyId ? (addressesByCompany[vendor.companyId] || []) : [],
    }));
  },
};

export default repo;
