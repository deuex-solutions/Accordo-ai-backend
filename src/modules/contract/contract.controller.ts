import type { Request, Response, NextFunction } from 'express';
import {
  createContractService,
  getContractService,
  getContractsService,
  updateContractService,
  deleteContractService,
  getContractDetailsService,
  updateContractStatusService,
} from './contract.service.js';
import { getNumericParam } from '../../types/index.js';

/**
 * Get contract details by unique token (public endpoint for vendors)
 */
export const getContractDetails = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const uniqueToken = req.query.uniquetoken;
    if (!uniqueToken || typeof uniqueToken !== 'string' || uniqueToken.trim().length === 0) {
      res.status(400).json({ message: 'uniqueToken is required' });
      return;
    }
    const contractDetails = await getContractDetailsService(uniqueToken);
    res.status(200).json({ message: 'Contract Details', data: contractDetails });
  } catch (error) {
    next(error);
  }
};

/**
 * Create a new contract
 */
export const createContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Extract options from request body
    const { skipEmail, skipChatbot, ...contractData } = req.body;

    const data = await createContractService(
      {
        ...contractData,
        createdBy: req.context.userId,
      },
      { skipEmail, skipChatbot }
    );
    res.status(201).json({ message: 'Contract created successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get a single contract by ID
 */
export const getContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) {
      res.status(400).json({ message: 'Invalid contract ID' });
      return;
    }
    const data = await getContractService(contractId);
    res.status(200).json({ message: 'Contract', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all contracts with pagination and filtering
 */
export const getAllContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = 1, limit = 10, requisitionid, filters } = req.query;
    const parsedPage = parseInt(page as string, 10);
    const parsedLimit = parseInt(limit as string, 10);

    if (isNaN(parsedPage) || parsedPage < 1) {
      res.status(400).json({ message: 'Invalid page number' });
      return;
    }
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      res.status(400).json({ message: 'Invalid limit. Must be between 1 and 100' });
      return;
    }

    const parsedRequisitionId = requisitionid ? parseInt(requisitionid as string, 10) : null;
    if (requisitionid && (isNaN(parsedRequisitionId!) || parsedRequisitionId! <= 0)) {
      res.status(400).json({ message: 'Invalid requisition ID' });
      return;
    }

    const data = await getContractsService(
      search as string | undefined,
      parsedPage,
      parsedLimit,
      parsedRequisitionId,
      filters as string | undefined
    );
    res.status(200).json({ message: 'Contracts', ...data });
  } catch (error) {
    next(error);
  }
};

/**
 * Resolve user ID from request context
 */
const resolveUserId = (context?: { userId: number }): number | undefined => context?.userId;

/**
 * Complete a contract (vendor endpoint)
 */
export const completeContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = resolveUserId(req.context);
    if (!userId) {
      res.status(401).json({ message: 'User authentication required' });
      return;
    }
    const payload = {
      ...req.body,
      updatedBy: userId,
      status: 'Completed',
    };
    const data = await updateContractService(null, payload, userId, req.body.uniqueToken);
    res.status(200).json({ message: 'Contract updated successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Approve a contract
 */
export const approveContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) {
      res.status(400).json({ message: 'Invalid contract ID' });
      return;
    }
    const userId = resolveUserId(req.context);
    if (!userId) {
      res.status(401).json({ message: 'User authentication required' });
      return;
    }
    const data = await updateContractService(
      contractId,
      { ...req.body, status: 'Approved' },
      userId
    );
    res.status(200).json({ message: 'Contract approved successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Update a contract
 */
export const updateContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) {
      res.status(400).json({ message: 'Invalid contract ID' });
      return;
    }

    if (!req.context || !req.context.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const userId = resolveUserId(req.context);
    if (!userId) {
      res.status(401).json({ message: 'User ID not found in context' });
      return;
    }

    const data = await updateContractService(
      contractId,
      req.body,
      userId,
      req.body.uniqueToken
    );

    if (!data) {
      res.status(404).json({ message: 'Contract not found' });
      return;
    }

    res.status(200).json({ message: 'Contract updated successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a contract
 */
export const deleteContract = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const contractId = getNumericParam(req.params.contractId);
    if (isNaN(contractId) || contractId <= 0) {
      res.status(400).json({ message: 'Invalid contract ID' });
      return;
    }
    const data = await deleteContractService(contractId);
    res.status(200).json({ message: 'Contract deleted successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Update contract status (vendor endpoint via unique token)
 */
export const updateContractStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.body.uniqueToken) {
      res.status(400).json({ message: 'uniqueToken is required' });
      return;
    }
    const data = await updateContractStatusService(req.body);
    res.status(200).json({ message: 'Contract status updated successfully', data });
  } catch (error) {
    next(error);
  }
};
