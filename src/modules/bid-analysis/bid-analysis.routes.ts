import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import {
  getRequisitions,
  getRequisitionDetail,
  getHistory,
  selectBid,
  rejectBidHandler,
  restoreBidHandler,
  exportPdfHandler,
  downloadPdfHandler,
} from './bid-analysis.controller.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Requisition list with bid summaries
router.get('/requisitions', getRequisitions);

// Requisition detail with top bids
router.get('/requisitions/:requisitionId', getRequisitionDetail);

// Action history for a requisition
router.get('/requisitions/:requisitionId/history', getHistory);

// Download PDF comparison report (generated on-the-fly)
router.get('/requisitions/:requisitionId/pdf', downloadPdfHandler);

// Select a bid (award to vendor)
router.post('/requisitions/:requisitionId/select/:bidId', selectBid);

// Reject a bid
router.post('/requisitions/:requisitionId/reject/:bidId', rejectBidHandler);

// Restore a rejected bid
router.post('/requisitions/:requisitionId/restore/:bidId', restoreBidHandler);

// Log export action
router.post('/requisitions/:requisitionId/export', exportPdfHandler);

export default router;
