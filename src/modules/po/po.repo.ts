import models from '../../models/index.js';
import type { Po } from '../../models/po.js';
import type { WhereOptions } from 'sequelize';

export interface PoData {
  requisitionId?: number;
  contractId?: number;
  vendorId?: number;
  companyId?: number;
  poNumber?: string;
  poDate?: Date;
  deliveryDate?: Date;
  paymentTerms?: string;
  shippingAddress?: string;
  billingAddress?: string;
  status?: string;
  lineItems?: string | object;
  subTotal?: number;
  taxTotal?: number;
  total?: number;
  termsAndConditions?: string;
  notes?: string;
  addedBy?: number;
}

export interface PoQueryOptions {
  where?: WhereOptions<Po>;
  limit?: number;
  offset?: number;
  order?: Array<[string, string]>;
  include?: any[];
  distinct?: boolean;
}

export interface FindAndCountResult {
  rows: Po[];
  count: number;
}

const repo = {
  createPo: async (poData: PoData): Promise<Po> => {
    return models.Po.create(poData as any);
  },

  getAllPo: async (poData: PoData): Promise<Po[]> => {
    return models.Po.findAll({
      where: { vendorId: poData.vendorId, companyId: poData.companyId },
    });
  },

  getPo: async (poId: number): Promise<Po | null> => {
    return models.Po.findByPk(poId, {
      include: [
        {
          model: models.Contract,
          as: 'Contract',
        },
        {
          model: models.Requisition,
          as: 'Requisition',
        },
        {
          model: models.Company,
          as: 'Company',
        },
        {
          model: models.User,
          as: 'Vendor',
          include: [{ model: models.Company, as: 'Company' }],
        },
      ],
    });
  },

  getPos: async (queryOptions: PoQueryOptions): Promise<FindAndCountResult> => {
    const options: any = {
      ...queryOptions,
      include: [
        {
          model: models.Contract,
          as: 'Contract',
        },
        {
          model: models.Requisition,
          as: 'Requisition',
        },
        {
          model: models.Company,
          as: 'Company',
        },
        {
          model: models.User,
          as: 'Vendor',
        },
      ],
      distinct: true,
    };
    return models.Po.findAndCountAll(options);
  },

  updatePo: async (
    poId: number,
    poData: PoData
  ): Promise<[affectedCount: number]> => {
    const result = await models.Po.update(poData as any, { where: { id: poId } });
    return result as [affectedCount: number];
  },
};

export default repo;
