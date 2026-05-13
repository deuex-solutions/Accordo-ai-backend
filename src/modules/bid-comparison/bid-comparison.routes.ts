import { Router } from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import {
  getComparisonStatus,
  listBids,
  getTop,
  downloadPDF,
  generateComparison,
  selectVendorHandler,
  getSelectionDetails,
  checkDeadlines,
} from './bid-comparison.controller.js';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Comparison status and management
router.get('/:requisitionId', getComparisonStatus);
router.get('/:requisitionId/bids', listBids);
router.get('/:requisitionId/top', getTop);
router.get('/:requisitionId/pdf', downloadPDF);
router.post('/:requisitionId/generate', generateComparison);

// Vendor selection
router.post('/:requisitionId/select/:bidId', selectVendorHandler);
router.get('/:requisitionId/selection', getSelectionDetails);

// Admin routes
router.post('/admin/check-deadlines', checkDeadlines);

export default router;
