import { Request, Response, NextFunction } from 'express';
import { CustomError } from '../../utils/custom-error.js';
import models from '../../models/index.js';
import {
  checkCompletionStatus,
  getTopBids,
  generateAndSendComparison,
  selectVendor,
} from './bidComparison.service.js';
import { triggerDeadlineCheck } from './scheduler/deadlineChecker.js';
import type { SelectionMethod } from './bidComparison.types.js';
import { getParam, getNumericParam } from '../../types/index.js';

const { Requisition, VendorBid, BidComparison, VendorSelection, VendorNotification, User, Project } = models;

/**
 * Validate that a requisition belongs to the user's company.
 * Returns the requisition if valid, throws 404 if not found or not owned.
 */
async function validateRequisitionOwnership(requisitionId: number, companyId: number | null | undefined): Promise<any> {
  const requisition = await Requisition.findByPk(requisitionId, {
    include: [{ model: Project, as: 'Project', attributes: ['id', 'companyId'] }],
  });
  if (!requisition) {
    throw new CustomError('Requisition not found', 404);
  }
  if (companyId && (requisition as any).Project?.companyId !== companyId) {
    throw new CustomError('Requisition not found', 404);
  }
  return requisition;
}

/**
 * Get comparison status for a requisition
 * GET /api/bid-comparison/:requisitionId
 */
export async function getComparisonStatus(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    const companyId = req.context?.companyId || null;
    await validateRequisitionOwnership(reqId, companyId);

    // Get completion status
    const status = await checkCompletionStatus(reqId);

    // Get latest comparison
    const comparison = await BidComparison.findOne({
      where: { requisitionId: reqId },
      order: [['createdAt', 'DESC']],
    });

    // Get selection if exists
    const selection = await VendorSelection.findOne({
      where: { requisitionId: reqId },
    });

    res.json({
      success: true,
      data: {
        requisitionId: reqId,
        hasComparison: !!comparison,
        comparisonId: comparison?.id || null,
        triggeredBy: comparison?.triggeredBy || null,
        generatedAt: comparison?.generatedAt || null,
        emailStatus: comparison?.emailStatus || null,
        pdfUrl: comparison?.pdfUrl || null,
        totalVendors: status.totalVendors,
        completedVendors: status.completedVendors,
        excludedVendors: status.excludedVendors,
        allCompleted: status.allCompleted,
        deadlinePassed: status.deadlinePassed,
        hasSelection: !!selection,
        selectionId: selection?.id || null,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List all bids for a requisition
 * GET /api/bid-comparison/:requisitionId/bids
 */
export async function listBids(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    const companyId = req.context?.companyId || null;
    await validateRequisitionOwnership(reqId, companyId);

    const bids = await VendorBid.findAll({
      where: { requisitionId: reqId },
      include: [{ model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] }],
      order: [['finalPrice', 'ASC']],
    });

    res.json({
      success: true,
      data: {
        bids: bids.map((bid) => ({
          id: bid.id,
          vendorId: bid.vendorId,
          vendorName: (bid as any).Vendor?.name || 'Unknown',
          vendorEmail: (bid as any).Vendor?.email || '',
          finalPrice: bid.finalPrice ? Number(bid.finalPrice) : null,
          unitPrice: bid.unitPrice ? Number(bid.unitPrice) : null,
          paymentTerms: bid.paymentTerms,
          deliveryDate: bid.deliveryDate,
          utilityScore: bid.utilityScore ? Number(bid.utilityScore) : null,
          bidStatus: bid.bidStatus,
          dealStatus: bid.dealStatus,
          chatLink: bid.chatLink,
          chatSummaryNarrative: bid.chatSummaryNarrative,
          completedAt: bid.completedAt,
        })),
        totalCount: bids.length,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get top bids for a requisition
 * GET /api/bid-comparison/:requisitionId/top
 */
export async function getTop(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 3;
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    const companyId = req.context?.companyId || null;
    await validateRequisitionOwnership(reqId, companyId);

    const result = await getTopBids(reqId, limit);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Download comparison PDF
 * GET /api/bid-comparison/:requisitionId/pdf
 */
export async function downloadPDF(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    const companyId = req.context?.companyId || null;
    await validateRequisitionOwnership(reqId, companyId);

    const comparison = await BidComparison.findOne({
      where: { requisitionId: reqId },
      order: [['createdAt', 'DESC']],
    });

    if (!comparison || !comparison.pdfUrl) {
      throw new CustomError('PDF not found. Generate comparison first.', 404);
    }

    res.redirect(comparison.pdfUrl);
  } catch (error) {
    next(error);
  }
}

/**
 * Manually trigger comparison generation
 * POST /api/bid-comparison/:requisitionId/generate
 */
export async function generateComparison(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    // Check authorization (only requisition owner)
    const requisition = await Requisition.findByPk(reqId);
    if (!requisition) {
      throw new CustomError('Requisition not found', 404);
    }

    if (requisition.createdBy !== req.context?.userId) {
      throw new CustomError('Only the requisition owner can generate comparisons', 403);
    }

    const result = await generateAndSendComparison(reqId, 'MANUAL');

    res.json({
      success: true,
      message: 'Comparison generated successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Select a vendor
 * POST /api/bid-comparison/:requisitionId/select/:bidId
 */
export async function selectVendorHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const bidId = getParam(req.params.bidId);
    const { reason, method } = req.body;
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    if (!bidId) {
      throw new CustomError('Bid ID is required', 400);
    }

    // Check authorization
    const requisition = await Requisition.findByPk(reqId);
    if (!requisition) {
      throw new CustomError('Requisition not found', 404);
    }

    if (requisition.createdBy !== req.context?.userId) {
      throw new CustomError('Only the requisition owner can select vendors', 403);
    }

    const selectionMethod: SelectionMethod = method || 'API';
    const result = await selectVendor(
      reqId,
      bidId,
      req.context!.userId,
      selectionMethod,
      reason
    );

    res.json({
      success: true,
      message: 'Vendor selected successfully',
      data: result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get selection details
 * GET /api/bid-comparison/:requisitionId/selection
 */
export async function getSelectionDetails(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const reqId = getNumericParam(req.params.requisitionId);

    if (isNaN(reqId)) {
      throw new CustomError('Invalid requisition ID', 400);
    }

    const companyId = req.context?.companyId || null;
    await validateRequisitionOwnership(reqId, companyId);

    const selection = await VendorSelection.findOne({
      where: { requisitionId: reqId },
      include: [
        { model: User, as: 'SelectedVendor', attributes: ['id', 'name', 'email'] },
        { model: User, as: 'SelectedBy', attributes: ['id', 'name', 'email'] },
        { model: VendorBid, as: 'SelectedBid' },
      ],
    });

    if (!selection) {
      res.json({
        success: true,
        data: null,
        message: 'No vendor has been selected yet',
      });
      return;
    }

    // Get notifications
    const notifications = await VendorNotification.findAll({
      where: { selectionId: selection.id },
      include: [{ model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] }],
    });

    res.json({
      success: true,
      data: {
        selectionId: selection.id,
        requisitionId: selection.requisitionId,
        selectedVendor: {
          id: (selection as any).SelectedVendor?.id,
          name: (selection as any).SelectedVendor?.name,
          email: (selection as any).SelectedVendor?.email,
        },
        selectedPrice: Number(selection.selectedPrice),
        selectedBy: {
          id: (selection as any).SelectedBy?.id,
          name: (selection as any).SelectedBy?.name,
          email: (selection as any).SelectedBy?.email,
        },
        selectionReason: selection.selectionReason,
        selectionMethod: selection.selectionMethod,
        selectedAt: selection.selectedAt,
        poId: selection.poId,
        notifications: notifications.map((n) => ({
          vendorId: n.vendorId,
          vendorName: (n as any).Vendor?.name || 'Unknown',
          notificationType: n.notificationType,
          emailStatus: n.emailStatus,
          sentAt: n.sentAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Manually trigger deadline check (admin only)
 * POST /api/bid-comparison/admin/check-deadlines
 */
export async function checkDeadlines(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Super Admin check
    if (req.context?.userType !== 'super_admin') {
      throw new CustomError('Admin access required', 403);
    }

    await triggerDeadlineCheck();

    res.json({
      success: true,
      message: 'Deadline check triggered successfully',
    });
  } catch (error) {
    next(error);
  }
}
