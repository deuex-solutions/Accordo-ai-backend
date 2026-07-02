import models, { sequelize } from '../../models/index.js';
import type { Contract } from '../../models/procurement/contract.js';
import type { WhereOptions, FindOptions } from 'sequelize';
import { QueryTypes } from 'sequelize';
import logger from '../../config/logger.js';

export interface ContractData {
  companyId?: number | null;
  requisitionId?: number | null;
  vendorId?: number | null;
  contractDetails?: string | null;
  finalContractDetails?: string | null;
  status?: string;
  uniqueToken?: string | null;
  chatbotDealId?: string | null;
  previousContractId?: number | null;
  createdBy?: number | null;
  updatedBy?: number | null;
  openedAt?: Date | null;
  verifiedAt?: Date | null;
  acceptedAt?: Date | null;
  rejectedAt?: Date | null;
  expiredAt?: Date | null;
  quotedAt?: Date | null;
  completedAt?: Date | null;
  message?: string;
  end?: boolean;
  rating?: number;
  benchmarkRating?: number | null;
  finalRating?: number | null;
}

export interface ContractQueryOptions {
  where?: WhereOptions<Contract>;
  limit?: number;
  offset?: number;
  order?: Array<[string, string]>;
  include?: any[];
}

export interface FindAndCountResult {
  rows: Contract[];
  count: number;
}

const repo = {
  getContractDetails: async (uniqueToken: string): Promise<Contract | null> => {
    return models.Contract.findOne({
      where: { uniqueToken },
      include: [
        {
          model: models.User,
          as: 'Vendor',
          attributes: { exclude: ['password'] },
        },
        {
          model: models.Requisition,
          as: 'Requisition',
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
          ],
        },
      ],
    });
  },

  createContract: async (contractData: ContractData): Promise<Contract> => {
    return models.Contract.create(contractData as any);
  },

  /**
   * Reset the Contracts table sequence to the max ID + 1
   * This fixes the "id must be unique" error when the sequence gets out of sync
   */
  resetContractSequence: async (): Promise<void> => {
    try {
      // Get the current max ID from the Contracts table
      const [result] = await sequelize.query<{ max_id: number }>(
        'SELECT COALESCE(MAX(id), 0) as max_id FROM "Contracts"',
        { type: QueryTypes.SELECT }
      );
      const maxId = result?.max_id || 0;

      // Reset the sequence to max_id + 1
      await sequelize.query(
        `SELECT setval('"Contracts_id_seq"', ${maxId + 1}, false)`
      );

      logger.info(`Contract sequence reset to ${maxId + 1}`);
    } catch (error) {
      logger.error('Failed to reset contract sequence:', error);
      throw error;
    }
  },

  getContract: async (contractId: number): Promise<Contract | null> => {
    return models.Contract.findByPk(contractId, {
      include: [
        {
          model: models.User,
          as: 'Vendor',
          attributes: { exclude: ['password'] },
        },
        {
          model: models.Requisition,
          as: 'Requisition',
        },
      ],
    });
  },

  getContractByToken: async (uniqueToken: string): Promise<Contract | null> => {
    return models.Contract.findOne({ where: { uniqueToken } });
  },

  getContracts: async (
    queryOptions: ContractQueryOptions
  ): Promise<FindAndCountResult> => {
    const options: FindOptions<Contract> = {
      ...queryOptions,
      include: [
        {
          model: models.User,
          as: 'Vendor',
          attributes: { exclude: ['password'] },
        },
        {
          model: models.Requisition,
          as: 'Requisition',
        },
      ],
    };

    return models.Contract.findAndCountAll(options);
  },

  deleteContract: async (contractId: number): Promise<number> => {
    return models.Contract.destroy({ where: { id: contractId } });
  },

  updateContractByToken: async (
    uniqueToken: string,
    contractData: ContractData
  ): Promise<[affectedCount: number]> => {
    const [count] = await models.Contract.update(contractData as any, { where: { uniqueToken } });
    return [count];
  },

  updateContract: async (
    contractId: number,
    contractData: ContractData
  ): Promise<[affectedCount: number]> => {
    const [count] = await models.Contract.update(contractData as any, { where: { id: contractId } });
    return [count];
  },

  updateContractByRequisitionAndVendor: async (
    requisitionId: number,
    vendorId: number,
    contractData: ContractData
  ): Promise<[affectedCount: number]> => {
    const [count] = await models.Contract.update(contractData as any, {
      where: { requisitionId, vendorId },
    });
    return [count];
  },
};

export default repo;
