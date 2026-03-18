import { Request, Response, NextFunction } from 'express';
import {
  createRequisionService,
  getRequisitionService,
  getRequisitionsService,
  deleteRequisitionService,
  updateRequisitionService,
  getRequisitionsForNegotiationService,
  getRequisitionVendorsService,
} from './requisition.service.js';

export const createRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log('=== CREATE REQUISITION CONTROLLER ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('Content-Type:', req.headers['content-type']);
    console.log('User context:', req.context);

    const attachmentFiles = req.files as Express.Multer.File[];
    const data = await createRequisionService(
      req.body,
      req.context.userId,
      attachmentFiles
    );
    res.status(201).json({ message: 'Requisition created successfully', data });
  } catch (error) {
    console.error('createRequisition controller error:', error);
    next(error);
  }
};

export const getAllRequisitions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { search, page = '1', limit = '10', projectId, ...filters } = req.query;
    const data = await getRequisitionsService(
      search as string | undefined,
      page as string,
      limit as string,
      projectId ? Number(projectId) : undefined,
      req.context.userId,
      filters
    );
    res.status(200).json({ message: 'Requisitions', ...data });
  } catch (error) {
    next(error);
  }
};

export const getRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const requisitionId = Number(req.params.requisitionid);
    if (Number.isNaN(requisitionId)) {
      res.status(400).json({ message: 'Invalid requisition ID' });
      return;
    }
    const data = await getRequisitionService(requisitionId);
    res.status(200).json({ message: 'Requisition', data });
  } catch (error) {
    next(error);
  }
};

export const updateRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    console.log('updateRequisition controller - params:', req.params);
    console.log('updateRequisition controller - body keys:', Object.keys(req.body));
    console.log('updateRequisition controller - body:', req.body);

    const requisitionId = Number(req.params.requisitionid);
    if (Number.isNaN(requisitionId)) {
      res.status(400).json({ message: 'Invalid requisition ID' });
      return;
    }

    // Fetch the existing requisition to check permissions
    const existingRequisition = await getRequisitionService(requisitionId);
    if (!existingRequisition) {
      res.status(404).json({ message: 'Requisition not found' });
      return;
    }

    // Block editing for cancelled requisitions
    if (existingRequisition.status === 'Cancelled') {
      res.status(400).json({ message: 'Cannot edit cancelled requisitions' });
      return;
    }

    // Permission: Super Admin can edit any; others can only edit own
    const userType = req.context.userType;
    const userId = req.context.userId;
    if (userType !== 'super_admin' && existingRequisition.createdBy !== userId) {
      res.status(403).json({ message: 'You can only edit requisitions you created' });
      return;
    }

    const attachmentFiles = req.files as Express.Multer.File[];
    console.log('updateRequisition controller - files:', attachmentFiles?.length || 0);

    const data = await updateRequisitionService(
      requisitionId,
      req.body,
      req.context.userId,
      attachmentFiles
    );
    res.status(200).json({ message: 'Requisition updated successfully', data });
  } catch (error) {
    console.error('updateRequisition controller error:', error);
    next(error);
  }
};

export const deleteRequisition = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const requisitionId = Number(req.params.requisitionid);
    if (Number.isNaN(requisitionId)) {
      res.status(400).json({ message: 'Invalid requisition ID' });
      return;
    }
    const data = await deleteRequisitionService(requisitionId);
    res.status(200).json({ message: 'Requisition deleted successfully', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get requisitions available for negotiation (for deal creation dropdown)
 */
export const getRequisitionsForNegotiation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const data = await getRequisitionsForNegotiationService(req.context.userId);
    res.status(200).json({ message: 'Requisitions for negotiation', data });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vendors attached to a specific requisition (for deal creation vendor dropdown)
 */
export const getRequisitionVendors = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const requisitionId = Number(req.params.requisitionId);
    if (Number.isNaN(requisitionId)) {
      res.status(400).json({ message: 'Invalid requisition ID' });
      return;
    }
    const data = await getRequisitionVendorsService(requisitionId, req.context.userId);
    res.status(200).json({ message: 'Requisition vendors', data });
  } catch (error) {
    next(error);
  }
};
