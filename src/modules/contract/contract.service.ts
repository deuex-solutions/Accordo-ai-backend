import crypto from 'crypto';
import { Op } from 'sequelize';
import repo from './contract.repo.js';
import requisitionRepo from '../requisition/requisition.repo.js';
import { CustomError } from '../../utils/custom-error.js';
import util from '../common/util.js';
import models from '../../models/index.js';
import { createDeal } from '../../services/chatbot.service.js';
import {
  sendVendorAttachedEmail,
  sendStatusChangeEmail,
} from '../../services/email.service.js';
import logger from '../../config/logger.js';
import type { Contract } from '../../models/procurement/contract.js';
import type { ContractData } from './contract.repo.js';

export interface CreateContractOptions {
  skipEmail?: boolean;
  skipChatbot?: boolean;
}

export interface PaginatedContractsResponse {
  data: Contract[];
  total: number;
  page: number;
  totalPages: number;
}

export interface UpdateContractStatusData {
  uniqueToken: string;
  status: string;
  finalContractDetails?: string | object;
  message?: string;
  end?: boolean;
}

export const getContractDetailsService = async (
  uniqueToken: string
): Promise<Contract | null> => {
  try {
    return repo.getContractDetails(uniqueToken);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

export const createContractService = async (
  contractData: ContractData,
  options: CreateContractOptions = {}
): Promise<Contract> => {
  try {
    // Extract options
    const { skipEmail = false, skipChatbot = false } = options;

    // Remove non-model fields from contractData
    const { skipEmail: _, skipChatbot: __, ...cleanContractData } = contractData as any;

    // Ensure IDs are numbers (frontend may send strings)
    if (cleanContractData.vendorId) {
      cleanContractData.vendorId = parseInt(String(cleanContractData.vendorId), 10);
    }
    if (cleanContractData.requisitionId) {
      cleanContractData.requisitionId = parseInt(String(cleanContractData.requisitionId), 10);
    }

    // Fetch vendor details
    const vendor = await models.User.findByPk(cleanContractData.vendorId);
    if (!vendor) {
      throw new CustomError('Vendor not found', 404);
    }
    if (!vendor.email && !skipEmail) {
      throw new CustomError('Vendor email is required to send notification', 400);
    }

    // Fetch requisition details with products and project
    const requisition = await requisitionRepo.getRequisition({
      id: cleanContractData.requisitionId,
    });
    if (!requisition) {
      throw new CustomError('Requisition not found', 404);
    }

    const projectName = (requisition as any).Project?.name || 'Project';
    const requisitionTitle =
      requisition.subject || 'Requisition';
    const vendorName = vendor.name || vendor.email;

    let dealId: string | null = null;

    // Create deal in chatbot system (unless skipped)
    if (!skipChatbot) {
      logger.info(`Creating chatbot deal for vendor ${vendorName}`);
      dealId = await createDeal(
        vendorName || 'Vendor',
        projectName,
        requisitionTitle,
        cleanContractData.requisitionId || undefined,
        undefined, // contractId will be set after contract creation
        cleanContractData.createdBy || undefined,
        cleanContractData.vendorId || undefined
      );
    } else {
      logger.info(`Skipping chatbot deal creation for vendor ${vendorName}`);
    }

    // Create contract with chatbot deal ID
    const uniqueToken = crypto.randomBytes(16).toString('hex');
    let contract: Contract;

    try {
      contract = await repo.createContract({
        ...cleanContractData,
        status: 'Created',
        uniqueToken,
        chatbotDealId: dealId,
      });
    } catch (createError) {
      // Check if this is a sequence sync error (id must be unique)
      if (
        (createError as any).name === 'SequelizeUniqueConstraintError' &&
        (createError as any).errors?.some((e: any) => e.path === 'id')
      ) {
        logger.warn('Contract sequence out of sync, attempting to fix...');

        // Reset the sequence and retry once
        await repo.resetContractSequence();

        contract = await repo.createContract({
          ...cleanContractData,
          status: 'Created',
          uniqueToken,
          chatbotDealId: dealId,
        });

        logger.info('Contract created successfully after sequence reset');
      } else {
        throw createError;
      }
    }

    // Send email notification to vendor (unless skipped)
    if (!skipEmail && vendor.email) {
      logger.info(`Sending vendor attached email to ${vendor.email}`);
      await sendVendorAttachedEmail(
        contract,
        requisition as any,
        dealId || undefined
      );
    } else {
      logger.info(
        `Skipping email notification for vendor ${vendor.email || cleanContractData.vendorId}`
      );
    }

    logger.info(
      `Contract created successfully with ID ${contract.id}${dealId ? `, deal ID ${dealId}` : ''}`
    );
    return contract;
  } catch (error) {
    // Re-throw CustomError as-is
    if (error instanceof CustomError) {
      throw error;
    }
    // Log the actual error for debugging
    logger.error('Contract creation failed with error:', {
      errorName: (error as any).name,
      errorMessage: (error as Error).message,
      errorStack: (error as Error).stack,
      errors: (error as any).errors?.map((e: any) => ({ message: e.message, path: e.path, value: e.value })),
    });
    throw new CustomError((error as Error).message || String(error), 400);
  }
};

export const getContractService = async (
  contractId: number
): Promise<Contract | null> => {
  try {
    return repo.getContract(contractId);
  } catch (error) {
    throw new CustomError(String(error), 400);
  }
};

export const getContractsService = async (
  search: string | undefined,
  page: number | string = 1,
  limit: number | string = 10,
  requisitionId: number | null,
  filters?: string
): Promise<PaginatedContractsResponse> => {
  try {
    const parsedPage = Number.parseInt(String(page), 10) || 1;
    const parsedLimit = Number.parseInt(String(limit), 10) || 10;
    const offset = (parsedPage - 1) * parsedLimit;

    const queryOptions: any = {
      where: { requisitionId },
      limit: parsedLimit,
      offset,
    };

    if (search) {
      queryOptions.where.contractDetails = {
        [Op.like]: `%${search}%`,
      };
    }

    if (filters) {
      try {
        const filterData = JSON.parse(decodeURIComponent(filters));
        queryOptions.where = util.filterUtil(filterData);
      } catch (error) {
        throw new CustomError('Invalid filters format', 400);
      }
    }

    const { rows, count } = await repo.getContracts(queryOptions);
    return {
      data: rows,
      total: count,
      page: parsedPage,
      totalPages: Math.ceil(count / parsedLimit),
    };
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};

const stringifyIfObject = (value: any): string | null | undefined => {
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  // If it's already a string, return it as-is
  // If it's null or undefined, return it
  return value;
};

const applyStatusSideEffects = async (
  contractId: number,
  contractData: ContractData
): Promise<void> => {
  switch (contractData.status) {
    case 'Opened':
      contractData.openedAt = new Date();
      break;
    case 'Verified':
      contractData.verifiedAt = new Date();
      break;
    case 'Accepted':
      contractData.acceptedAt = new Date();
      break;
    case 'Rejected':
      contractData.rejectedAt = new Date();
      break;
    case 'Expired':
      contractData.expiredAt = new Date();
      break;
    case 'Approved': {
      const contractToApprove = await repo.getContract(contractId);
      if (!contractToApprove) {
        throw new CustomError('Contract not found', 404);
      }
      const requisition = await requisitionRepo.getRequisition({
        id: contractToApprove.requisitionId as number,
      });
      if ((requisition as any)?.Contract) {
        for (const contract of (requisition as any).Contract) {
          if (contract.id !== contractId) {
            await repo.updateContract(contract.id, {
              status: 'Rejected',
              rejectedAt: new Date(),
              acceptedAt: null,
            });
          }
        }
      }
      await repo.updateContract(contractId, {
        status: 'Accepted',
        rejectedAt: null,
        acceptedAt: new Date(),
      });
      return;
    }
    case 'InitialQuotation':
      if (!contractData.contractDetails) {
        throw new CustomError('contractDetails is required', 400);
      }
      contractData.contractDetails = stringifyIfObject(contractData.contractDetails);
      contractData.quotedAt = new Date();
      break;
    case 'Completed':
      if (!contractData.finalContractDetails) {
        throw new CustomError('finalContractDetails is required', 400);
      }
      contractData.finalContractDetails = stringifyIfObject(
        contractData.finalContractDetails
      );
      contractData.completedAt = new Date();
      break;
    default:
      break;
  }
};

export const updateContractService = async (
  contractId: number | null,
  contractData: ContractData,
  userId: number,
  uniqueToken?: string
): Promise<Contract | null> => {
  try {
    if (!contractId && !uniqueToken) {
      throw new CustomError('Either contractId or uniqueToken is required', 400);
    }

    // Get the old contract to track status changes
    const oldContract = contractId
      ? await repo.getContract(contractId)
      : await repo.getContractByToken(uniqueToken!);

    if (!oldContract) {
      throw new CustomError('Contract not found', 404);
    }

    const oldStatus = oldContract.status;
    const newStatus = contractData.status;

    contractData.updatedBy = userId;
    if (contractId) {
      await applyStatusSideEffects(contractId, contractData);
    }

    if (uniqueToken) {
      const [affectedRows] = await repo.updateContractByToken(
        uniqueToken,
        contractData
      );
      if (affectedRows === 0) {
        throw new CustomError('Contract not found', 404);
      }
    } else if (contractId) {
      const [affectedRows] = await repo.updateContract(contractId, contractData);
      if (affectedRows === 0) {
        throw new CustomError('Contract not found', 404);
      }
    } else {
      throw new CustomError('Either contractId or uniqueToken is required', 400);
    }

    const contract = contractId
      ? await repo.getContract(contractId)
      : await repo.getContractByToken(uniqueToken!);

    if (!contract) {
      throw new CustomError('Contract not found', 404);
    }

    const requisitionId = contract.requisitionId;
    if (!requisitionId) {
      return contract;
    }

    const requisition = await requisitionRepo.getRequisition({ id: requisitionId });
    const contracts = (requisition as any)?.Contract || [];
    if (contracts.length) {
      const allInitialQuotation = contracts.every(
        (item: any) => item.status === 'InitialQuotation'
      );
      if (allInitialQuotation) {
        await requisitionRepo.updateRequisition(requisitionId, {
          status: 'Created',
        });
      }
    }

    // Send status change email if status changed
    if (newStatus && oldStatus !== newStatus) {
      try {
        const vendor = await models.User.findByPk(contract.vendorId as any);
        if (vendor?.email) {
          logger.info(
            `Sending status change email to ${vendor.email}: ${oldStatus} -> ${newStatus}`
          );
          await sendStatusChangeEmail(
            contract,
            requisition as any,
            oldStatus,
            newStatus
          );
        } else {
          logger.warn(
            `Cannot send status change email: vendor ${contract.vendorId} has no email`
          );
        }
      } catch (emailError) {
        // Log error but don't fail the update - status change email is secondary to contract update
        logger.error(`Failed to send status change email: ${(emailError as Error).message}`);
      }
    }

    return contract;
  } catch (error) {
    // If it's already a CustomError, re-throw it
    if (error instanceof CustomError) {
      throw error;
    }
    // Handle Sequelize validation errors
    if (
      (error as any).name === 'SequelizeValidationError' ||
      (error as any).name === 'SequelizeUniqueConstraintError'
    ) {
      const message =
        (error as any).errors?.map((e: any) => e.message).join(', ') ||
        (error as Error).message;
      throw new CustomError(message, 400);
    }
    // Handle other Sequelize errors
    if ((error as any).name?.startsWith('Sequelize')) {
      throw new CustomError((error as Error).message || 'Database error occurred', 400);
    }
    // Otherwise, wrap it with a proper error message
    throw new CustomError(
      (error as Error).message || `Service error: ${String(error)}`,
      400
    );
  }
};

export const updateContractStatusService = async (
  contractData: UpdateContractStatusData
): Promise<Contract | null> => {
  try {
    const { uniqueToken, status, finalContractDetails, message, end } = contractData;

    // Get the old contract to track status changes
    const oldContract = await repo.getContractByToken(uniqueToken);
    if (!oldContract) {
      throw new CustomError('Contract not found', 404);
    }
    const oldStatus = oldContract.status;

    const updateData: ContractData = {
      status,
      message,
      end,
    };

    if (status === 'Accepted') {
      updateData.acceptedAt = new Date();
      updateData.rejectedAt = null;
    } else if (status === 'Rejected') {
      updateData.rejectedAt = new Date();
      updateData.acceptedAt = null;
    }

    if (finalContractDetails) {
      updateData.finalContractDetails = stringifyIfObject(finalContractDetails);
    }

    await repo.updateContractByToken(uniqueToken, updateData);
    const contractDetails = await repo.getContractDetails(uniqueToken);

    // Send status change email if status changed
    if (status && oldStatus !== status) {
      try {
        const vendor = await models.User.findByPk(oldContract.vendorId as any);
        if (vendor?.email) {
          const requisition = await requisitionRepo.getRequisition({
            id: oldContract.requisitionId as number,
          });
          logger.info(
            `Sending status change email to ${vendor.email}: ${oldStatus} -> ${status}`
          );
          await sendStatusChangeEmail(
            contractDetails!,
            requisition as any,
            oldStatus,
            status
          );
        } else {
          logger.warn(
            `Cannot send status change email: vendor ${oldContract.vendorId} has no email`
          );
        }
      } catch (emailError) {
        // Log error but don't fail the update - status change email is secondary
        logger.error(`Failed to send status change email: ${(emailError as Error).message}`);
      }
    }

    return contractDetails;
  } catch (error) {
    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError(`Service ${error}`, 400);
  }
};

export const deleteContractService = async (
  contractId: number
): Promise<number> => {
  try {
    return repo.deleteContract(contractId);
  } catch (error) {
    throw new CustomError(`Service ${error}`, 400);
  }
};
