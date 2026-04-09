import { Op, fn, col, literal } from 'sequelize';
import models from '../../models/index.js';
import { CustomError } from '../../utils/custom-error.js';
import logger from '../../config/logger.js';
import { selectVendor } from '../bidComparison/bidComparison.service.js';
import type {
  BidAnalysisFilters,
  RequisitionWithBidSummary,
  PaginatedResult,
  RequisitionBidDetail,
  TopBidInfo,
  BidWithDetails,
  BidActionHistoryEntry,
  RejectBidResult,
  RestoreBidResult,
  SelectBidResult,
  ACTION_LABELS,
  BidStatus,
  DealStatus,
  VendorNegotiationSummary,
  DealNegotiationMessage,
} from './bidAnalysis.types.js';
import type { BidActionType, ActionDetails } from '../../models/bidActionHistory.js';

const {
  Requisition,
  VendorBid,
  BidActionHistory,
  User,
  Project,
  Contract,
  VendorSelection,
  ChatbotDeal,
  ChatbotMessage,
} = models;

export function extractPrice(offer: any): number {
  if (!offer) return 0;
  return Number(offer.total_price || offer.unit_price || offer.unitPrice || offer.price || offer.totalPrice || offer.finalPrice || 0);
}

async function getLastVendorOffer(dealId: string): Promise<any> {
  const msg = await ChatbotMessage.findOne({
    where: { dealId, role: 'VENDOR' },
    attributes: ['extractedOffer'],
    order: [['round', 'DESC'], ['createdAt', 'DESC']],
  });
  return msg?.extractedOffer || null;
}

/**
 * Get requisitions available for bid analysis with filters
 */
export async function getRequisitionsForBidAnalysis(
  userId: number,
  companyId: number | null,
  filters: BidAnalysisFilters
): Promise<PaginatedResult<RequisitionWithBidSummary>> {
  const {
    search,
    status = 'all',
    projectId,
    dateFrom,
    dateTo,
    page = 1,
    limit = 10,
    sortBy = 'negotiationClosureDate',
    sortOrder = 'desc',
  } = filters;

  // Build where clause
  const where: any = {};

  // Company filter (if user belongs to a company)
  if (companyId) {
    where['$Project.companyId$'] = companyId;
  }

  // Search filter
  if (search) {
    where[Op.or] = [
      { rfqId: { [Op.iLike]: `%${search}%` } },
      { subject: { [Op.iLike]: `%${search}%` } },
    ];
  }

  // Project filter
  if (projectId) {
    where.projectId = projectId;
  }

  // Date range filter
  if (dateFrom || dateTo) {
    where.negotiationClosureDate = {};
    if (dateFrom) {
      where.negotiationClosureDate[Op.gte] = new Date(dateFrom);
    }
    if (dateTo) {
      where.negotiationClosureDate[Op.lte] = new Date(dateTo);
    }
  }

  // Status filter
  // Note: 'ready' and 'awaiting' filters are handled in post-processing
  // because they depend on deal completion status which requires querying ChatbotDeal
  if (status !== 'all') {
    if (status === 'awarded') {
      where.status = 'Awarded';
    } else if (status === 'ready' || status === 'awaiting') {
      // Exclude awarded requisitions - final filtering done in post-processing
      where.status = { [Op.ne]: 'Awarded' };
    }
  }

  // Get total count first
  const totalCount = await Requisition.count({
    where,
    include: [
      { model: Project, as: 'Project', attributes: [] },
    ],
  });

  // Build order clause
  const orderField = sortBy === 'rfqId' ? 'rfqId'
    : sortBy === 'subject' ? 'subject'
    : sortBy === 'negotiationClosureDate' ? 'negotiationClosureDate'
    : 'negotiationClosureDate';

  const order: any[] = [[orderField, sortOrder.toUpperCase()]];

  // Fetch requisitions with bid stats
  const requisitions = await Requisition.findAll({
    where,
    include: [
      {
        model: Project,
        as: 'Project',
        attributes: ['id', 'projectName', 'companyId'],
      },
    ],
    order,
    limit,
    offset: (page - 1) * limit,
  });

  // Get bid stats for each requisition
  const requisitionsWithBidSummary: RequisitionWithBidSummary[] = await Promise.all(
    requisitions.map(async (req) => {
      // Get deals from ChatbotDeal instead of VendorBid
      const deals = await ChatbotDeal.findAll({
        where: { requisitionId: req.id },
        attributes: ['id', 'status', 'latestVendorOffer', 'latestUtility', 'negotiationConfigJson'],
      });

      // Map deal statuses to bid statuses
      const completedDeals = deals.filter((d: any) => ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'].includes(d.status));
      const pendingDeals = deals.filter((d: any) => d.status === 'NEGOTIATING');
      const excludedDeals: any[] = []; // No excluded concept in deals

      // Extract prices from latestVendorOffer JSONB field, falling back to message offers
      const prices = (await Promise.all(
        completedDeals.map(async (d: any) => {
          const offer = d.latestVendorOffer || await getLastVendorOffer(d.id);
          return extractPrice(offer);
        })
      )).filter(p => p > 0);

      const lowestPrice = prices.length > 0 ? Math.min(...prices) : null;
      const highestPrice = prices.length > 0 ? Math.max(...prices) : null;
      const averagePrice = prices.length > 0
        ? prices.reduce((a, b) => a + b, 0) / prices.length
        : null;

      // Check if awarded
      const selection = await VendorSelection.findOne({
        where: { requisitionId: req.id },
        include: [{ model: User, as: 'SelectedVendor', attributes: ['name'] }],
      });

      // Check if ready for analysis
      const deadlinePassed = req.negotiationClosureDate
        ? new Date(req.negotiationClosureDate) < new Date()
        : false;
      const allCompleted = pendingDeals.length === 0 && completedDeals.length > 0;
      const isReadyForAnalysis = (deadlinePassed || allCompleted) && !selection;

      return {
        id: req.id,
        rfqId: req.rfqId || `RFQ-${req.id}`,
        subject: req.subject || 'Untitled',
        description: req.category || null, // Using category as description since model doesn't have description
        status: req.status || '',
        negotiationClosureDate: req.negotiationClosureDate,
        deliveryDate: req.deliveryDate,
        projectId: req.projectId,
        projectName: (req as any).Project?.projectName || null,
        createdBy: req.createdBy,
        createdByName: null, // User association not available on Requisition
        bidsCount: deals.length,
        completedBidsCount: completedDeals.length,
        pendingBidsCount: pendingDeals.length,
        excludedBidsCount: excludedDeals.length,
        lowestPrice,
        highestPrice,
        averagePrice,
        isReadyForAnalysis,
        hasAwardedVendor: !!selection,
        awardedVendorName: (selection as any)?.SelectedVendor?.name || null,
      };
    })
  );

  // Apply status filter for 'ready' (post-processing since it depends on bid completion)
  let filteredResults = requisitionsWithBidSummary;
  if (status === 'ready') {
    filteredResults = filteredResults.filter(r => r.isReadyForAnalysis);
  } else if (status === 'awaiting') {
    filteredResults = filteredResults.filter(r => !r.isReadyForAnalysis && !r.hasAwardedVendor);
  }

  // Sort by bidsCount or lowestPrice if needed (not sortable at DB level)
  if (sortBy === 'bidsCount') {
    filteredResults.sort((a, b) => sortOrder === 'asc'
      ? a.bidsCount - b.bidsCount
      : b.bidsCount - a.bidsCount
    );
  } else if (sortBy === 'lowestPrice') {
    filteredResults.sort((a, b) => {
      const priceA = a.lowestPrice ?? Infinity;
      const priceB = b.lowestPrice ?? Infinity;
      return sortOrder === 'asc' ? priceA - priceB : priceB - priceA;
    });
  }

  const totalPages = Math.ceil(totalCount / limit);

  return {
    data: filteredResults,
    pagination: {
      page,
      limit,
      totalItems: totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

/**
 * Get detailed bid analysis for a specific requisition
 */
export async function getRequisitionBidDetail(
  requisitionId: number,
  companyId?: number | null
): Promise<RequisitionBidDetail> {
  // Get requisition with project
  const requisition = await Requisition.findByPk(requisitionId, {
    include: [
      { model: Project, as: 'Project', attributes: ['id', 'projectName', 'companyId'] },
    ],
  });

  if (!requisition) {
    throw new CustomError('Requisition not found', 404);
  }

  // Company isolation check — null-tolerant for legacy projects.
  {
    const projectCompanyId = (requisition as any).Project?.companyId ?? null;
    if (companyId && projectCompanyId !== null && projectCompanyId !== companyId) {
      throw new CustomError('Requisition not found', 404);
    }
  }

  // Get all deals for this requisition from ChatbotDeal
  const deals = await ChatbotDeal.findAll({
    where: { requisitionId },
    include: [
      { model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] },
    ],
    order: [['latestUtility', 'DESC']], // Order by utility score (best first)
  });

  // Get rejection history for deals (using dealId as bidId)
  const rejectionHistory = await BidActionHistory.findAll({
    where: {
      requisitionId,
      action: 'REJECTED',
    },
    include: [{ model: User, as: 'User', attributes: ['name'] }],
    order: [['createdAt', 'DESC']],
  });

  const rejectionMap = new Map<string, any>();
  rejectionHistory.forEach(h => {
    if (h.bidId && !rejectionMap.has(h.bidId)) {
      rejectionMap.set(h.bidId, h);
    }
  });

  // Check if vendor was selected
  const selection = await VendorSelection.findOne({
    where: { requisitionId },
    include: [{ model: User, as: 'SelectedVendor', attributes: ['id', 'name'] }],
  });

  // Build bid details from deals
  const allBids: BidWithDetails[] = await Promise.all(deals.map(async (deal: any, index: number) => {
    const rejection = rejectionMap.get(deal.id);
    // Check if this deal was rejected in the action history
    const isRejected = !!rejection;

    // Extract price from latestVendorOffer JSONB, falling back to message offers
    const offer = deal.latestVendorOffer || await getLastVendorOffer(deal.id) || {};
    const finalPrice = extractPrice(offer);

    // Map deal status to bid status
    let bidStatus: BidStatus = 'PENDING';
    if (deal.status === 'ACCEPTED') bidStatus = 'COMPLETED';
    else if (deal.status === 'WALKED_AWAY' || deal.status === 'ESCALATED') bidStatus = 'COMPLETED';
    else if (deal.status === 'NEGOTIATING') bidStatus = 'PENDING';
    if (isRejected) bidStatus = 'REJECTED';
    if (selection?.selectedBidId === deal.id) bidStatus = 'SELECTED';

    return {
      bidId: deal.id,
      rank: index + 1,
      vendorId: deal.vendorId || 0,
      vendorName: deal.Vendor?.name || deal.counterparty || 'Unknown',
      vendorEmail: deal.Vendor?.email || '',
      finalPrice,
      unitPrice: offer.total_price ? Number(offer.total_price) : (offer.unit_price ? Number(offer.unit_price) : (offer.unitPrice ? Number(offer.unitPrice) : null)),
      paymentTerms: offer.payment_terms || offer.paymentTerms || null,
      deliveryDate: offer.delivery_date || offer.deliveryDate || null,
      utilityScore: deal.latestUtility ? Number(deal.latestUtility) : null,
      bidStatus,
      dealStatus: deal.status as DealStatus,
      dealId: deal.id,
      chatLink: `/chatbot/deals/${deal.id}`,
      chatSummaryMetrics: null, // Not stored on ChatbotDeal
      chatSummaryNarrative: null, // Not stored on ChatbotDeal
      contractId: deal.contractId || 0,
      completedAt: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'].includes(deal.status) ? deal.updatedAt : null,
      createdAt: deal.createdAt,
      updatedAt: deal.updatedAt,
      isRejected,
      rejectedAt: isRejected && rejection ? rejection.createdAt : null,
      rejectedBy: isRejected && rejection ? (rejection as any).User?.name : null,
      rejectedRemarks: isRejected && rejection ? rejection.remarks : null,
    };
  }));

  // Sort by price (lowest first) for ranking, then re-rank
  const sortedBids = [...allBids]
    .filter(b => b.finalPrice > 0)
    .sort((a, b) => a.finalPrice - b.finalPrice);

  // Re-assign ranks based on price
  sortedBids.forEach((bid, idx) => {
    bid.rank = idx + 1;
  });

  // Add bids with no price at the end
  const noPriceBids = allBids.filter(b => b.finalPrice === 0);
  noPriceBids.forEach((bid, idx) => {
    bid.rank = sortedBids.length + idx + 1;
  });

  const rankedBids = [...sortedBids, ...noPriceBids];

  // Top 3 bids (excluding rejected)
  const activeBids = rankedBids.filter(b => !b.isRejected);
  const topBids: TopBidInfo[] = activeBids.slice(0, 3);

  // Calculate price stats
  const prices = activeBids
    .map(b => b.finalPrice)
    .filter(p => p > 0);

  const priceRange = {
    lowest: prices.length > 0 ? Math.min(...prices) : null,
    highest: prices.length > 0 ? Math.max(...prices) : null,
    average: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
    targetPrice: requisition.totalPrice ? Number(requisition.totalPrice) : null,
    maxAcceptablePrice: requisition.discountedValue ? Number(requisition.discountedValue) : null,
  };

  // Get total vendors from contracts
  const totalVendors = await Contract.count({
    where: { requisitionId },
  });

  // Count completed vendors based on deal status
  const completedVendors = deals.filter((d: any) =>
    ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'].includes(d.status)
  ).length;

  return {
    requisition: {
      id: requisition.id,
      rfqId: requisition.rfqId || `RFQ-${requisition.id}`,
      subject: requisition.subject || 'Untitled',
      description: requisition.category || null, // Using category as description
      category: requisition.category,
      targetPrice: requisition.totalPrice ? Number(requisition.totalPrice) : null,
      maxAcceptablePrice: requisition.discountedValue ? Number(requisition.discountedValue) : null,
      negotiationClosureDate: requisition.negotiationClosureDate,
      deliveryDate: requisition.deliveryDate,
      status: requisition.status || '',
      projectId: requisition.projectId,
      projectName: (requisition as any).Project?.projectName || null,
      createdBy: requisition.createdBy,
      createdByName: null, // User association not available on Requisition
      totalVendors,
      completedVendors,
    },
    priceRange,
    topBids,
    allBids: rankedBids,
    selectedBidId: selection?.selectedBidId || null,
    selectedVendorId: selection?.selectedVendorId || null,
    selectedVendorName: (selection as any)?.SelectedVendor?.name || null,
    isAwarded: requisition.status === 'Awarded',
  };
}

/**
 * Get action history for a requisition
 */
export async function getActionHistory(
  requisitionId: number,
  companyId?: number | null
): Promise<BidActionHistoryEntry[]> {
  // Company isolation check — null-tolerant for legacy projects.
  if (companyId) {
    const requisition = await Requisition.findByPk(requisitionId, {
      include: [{ model: Project, as: 'Project', attributes: ['id', 'companyId'] }],
    });
    if (!requisition) {
      throw new CustomError('Requisition not found', 404);
    }
    const projectCompanyId = (requisition as any).Project?.companyId ?? null;
    if (projectCompanyId !== null && projectCompanyId !== companyId) {
      throw new CustomError('Requisition not found', 404);
    }
  }

  const history = await BidActionHistory.findAll({
    where: { requisitionId },
    include: [
      { model: User, as: 'User', attributes: ['id', 'name', 'email'] },
    ],
    order: [['createdAt', 'DESC']],
  });

  // Get deal info for each history entry that has a bidId (dealId)
  const dealIds = history.map(h => h.bidId).filter(Boolean) as string[];
  const deals = await ChatbotDeal.findAll({
    where: { id: dealIds },
    include: [{ model: User, as: 'Vendor', attributes: ['name'] }],
  });
  const dealMap = new Map(deals.map(d => [d.id, d]));

  const actionLabels: Record<BidActionType, string> = {
    SELECTED: 'Selected vendor',
    REJECTED: 'Rejected deal',
    RESTORED: 'Restored deal',
    VIEWED: 'Viewed analysis',
    EXPORTED: 'Exported PDF',
    COMPARISON_GENERATED: 'Generated comparison',
  };

  return history.map(h => {
    const deal = h.bidId ? dealMap.get(h.bidId) : null;
    const offer = (deal as any)?.latestVendorOffer || {};
    const bidPrice = extractPrice(offer);

    return {
      id: h.id,
      requisitionId: h.requisitionId,
      bidId: h.bidId,
      userId: h.userId,
      userName: (h as any).User?.name || 'Unknown',
      userEmail: (h as any).User?.email || '',
      action: h.action,
      actionDetails: h.actionDetails,
      remarks: h.remarks,
      createdAt: h.createdAt,
      actionLabel: actionLabels[h.action] || h.action,
      vendorName: (deal as any)?.Vendor?.name || h.actionDetails?.vendorName || null,
      bidPrice: bidPrice || h.actionDetails?.bidPrice || null,
    };
  });
}

/**
 * Log an action in the history
 * @param requisitionId - The requisition ID
 * @param action - The action type
 * @param userId - The user performing the action
 * @param vendorBidId - The VendorBid ID (FK to vendor_bids table)
 * @param dealId - The ChatbotDeal ID (FK to chatbot_deals table)
 * @param details - Additional action details
 * @param remarks - User remarks
 */
export async function logAction(
  requisitionId: number,
  action: BidActionType,
  userId: number,
  vendorBidId?: string | null,
  dealId?: string | null,
  details?: ActionDetails,
  remarks?: string
): Promise<any> {
  return BidActionHistory.create({
    requisitionId,
    bidId: vendorBidId || null,
    dealId: dealId || null,
    userId,
    action,
    actionDetails: details || null,
    remarks: remarks || null,
  });
}

/**
 * Reject a bid (deal)
 * Since we're using ChatbotDeal, rejection is tracked in BidActionHistory
 *
 * Note: The bidId parameter is a ChatbotDeal ID.
 */
export async function rejectBid(
  requisitionId: number,
  bidId: string,  // This is a ChatbotDeal ID
  userId: number,
  remarks?: string
): Promise<RejectBidResult> {
  // Validate deal exists and belongs to requisition
  const deal = await ChatbotDeal.findByPk(bidId, {
    include: [{ model: User, as: 'Vendor', attributes: ['id', 'name'] }],
  });

  if (!deal) {
    throw new CustomError('Deal not found', 404);
  }

  if (deal.requisitionId !== requisitionId) {
    throw new CustomError('Deal does not belong to this requisition', 400);
  }

  // Check if already rejected (via action history) - search by dealId (ChatbotDeal ID)
  const existingRejection = await BidActionHistory.findOne({
    where: { dealId: bidId, action: 'REJECTED' },
  });

  if (existingRejection) {
    throw new CustomError('Deal is already rejected', 400);
  }

  // Check if already selected - need to check both by dealId and by VendorBid
  const vendorBid = await VendorBid.findOne({ where: { dealId: bidId } });
  const selectionByDeal = await VendorSelection.findOne({
    where: { requisitionId, selectedBidId: bidId },
  });
  const selectionByVendorBid = vendorBid ? await VendorSelection.findOne({
    where: { requisitionId, selectedBidId: vendorBid.id },
  }) : null;

  if (selectionByDeal || selectionByVendorBid) {
    throw new CustomError('Cannot reject a selected deal', 400);
  }

  const previousStatus = deal.status || 'UNKNOWN';

  // Safely extract price from latestVendorOffer, falling back to message offers
  const offer = (deal as any).latestVendorOffer || await getLastVendorOffer(bidId) || {};
  const bidPrice = extractPrice(offer);

  // Get vendor name safely
  const vendorName = (deal as any).Vendor?.name || 'Unknown Vendor';

  try {
    // Log rejection action with both IDs (we don't update deal status, just track in history)
    // For rejection, vendorBid may or may not exist - use it if available
    const historyEntry = await logAction(
      requisitionId,
      'REJECTED',
      userId,
      vendorBid?.id || null,  // VendorBid ID (may be null if never auto-created)
      bidId,                   // ChatbotDeal ID
      {
        vendorId: deal.vendorId ?? undefined,
        vendorName,
        bidPrice,
        previousStatus,
        newStatus: 'REJECTED',
      },
      remarks
    );

    logger.info(`Deal ${bidId} rejected by user ${userId} for requisition ${requisitionId}`);

    return {
      success: true,
      bidId,
      previousStatus,
      newStatus: 'REJECTED',
      historyId: historyEntry.id,
    };
  } catch (error) {
    logger.error(`Failed to reject deal ${bidId}`, { error: (error as Error).message });
    throw new CustomError('Failed to record rejection. Please try again.', 500);
  }
}

/**
 * Restore a rejected deal
 * Removes the rejection from action history
 */
export async function restoreBid(
  requisitionId: number,
  bidId: string,
  userId: number
): Promise<RestoreBidResult> {
  // Validate deal exists and belongs to requisition
  const deal = await ChatbotDeal.findByPk(bidId, {
    include: [{ model: User, as: 'Vendor', attributes: ['name'] }],
  });

  if (!deal) {
    throw new CustomError('Deal not found', 404);
  }

  if (deal.requisitionId !== requisitionId) {
    throw new CustomError('Deal does not belong to this requisition', 400);
  }

  // Check if rejected (via action history) - search by dealId (ChatbotDeal ID)
  const existingRejection = await BidActionHistory.findOne({
    where: { dealId: bidId, action: 'REJECTED' },
  });

  if (!existingRejection) {
    throw new CustomError('Deal is not rejected', 400);
  }

  // Remove the rejection record
  await existingRejection.destroy();

  // Get VendorBid if it exists
  const vendorBid = await VendorBid.findOne({ where: { dealId: bidId } });

  // Extract price from latestVendorOffer, falling back to message offers
  const offer = (deal as any).latestVendorOffer || await getLastVendorOffer(bidId) || {};
  const bidPrice = extractPrice(offer);

  // Log restoration action with both IDs
  const historyEntry = await logAction(
    requisitionId,
    'RESTORED',
    userId,
    vendorBid?.id || null,  // VendorBid ID
    bidId,                   // ChatbotDeal ID
    {
      vendorId: deal.vendorId ?? undefined,
      vendorName: (deal as any).Vendor?.name,
      bidPrice,
      previousStatus: 'REJECTED',
      newStatus: 'COMPLETED',
    }
  );

  logger.info(`Deal ${bidId} restored by user ${userId} for requisition ${requisitionId}`);

  return {
    success: true,
    bidId,
    previousStatus: 'REJECTED',
    newStatus: 'COMPLETED',
    historyId: historyEntry.id,
  };
}

/**
 * Select a deal (award requisition to vendor)
 * Wraps the existing selectVendor function and adds history logging
 *
 * Note: The bidId parameter is a ChatbotDeal ID, not a VendorBid ID.
 * This function will automatically create a VendorBid record if one doesn't exist.
 */
export async function selectBidForAnalysis(
  requisitionId: number,
  bidId: string,  // This is a ChatbotDeal ID
  userId: number,
  remarks?: string
): Promise<SelectBidResult> {
  // Get deal details
  const deal = await ChatbotDeal.findByPk(bidId, {
    include: [
      { model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] },
      { model: Contract, as: 'Contract' },
    ],
  });

  if (!deal) {
    throw new CustomError('Deal not found', 404);
  }

  if (deal.requisitionId !== requisitionId) {
    throw new CustomError('Deal does not belong to this requisition', 400);
  }

  // Extract price from latestVendorOffer, falling back to message offers
  const offer = (deal as any).latestVendorOffer || await getLastVendorOffer(bidId) || {};
  const finalPrice = extractPrice(offer);
  const unitPrice = Number(offer.total_price || offer.unit_price || offer.unitPrice || 0);

  // Find or create VendorBid from ChatbotDeal
  // selectVendor expects a VendorBid ID, not a ChatbotDeal ID
  let vendorBid = await VendorBid.findOne({
    where: { dealId: bidId }
  });

  if (!vendorBid) {
    // Validate required fields before creating VendorBid
    if (!deal.vendorId) {
      throw new CustomError('Cannot select deal: vendor information is missing', 400);
    }

    // Get contractId - try from deal first, then lookup from Contract table
    let contractId = deal.contractId;
    if (!contractId) {
      // Try to find contract by requisitionId and vendorId
      const contract = await Contract.findOne({
        where: {
          requisitionId: deal.requisitionId,
          vendorId: deal.vendorId,
        },
      });
      if (contract) {
        contractId = contract.id;
      }
    }

    if (!contractId) {
      throw new CustomError('Cannot select deal: contract information is missing', 400);
    }

    // Auto-create VendorBid from ChatbotDeal data
    vendorBid = await VendorBid.create({
      requisitionId: deal.requisitionId!,
      contractId: contractId,
      dealId: deal.id,
      vendorId: deal.vendorId,
      finalPrice,
      unitPrice: unitPrice || null,
      paymentTerms: offer.payment_terms || offer.paymentTerms || null,
      deliveryDate: offer.delivery_date || offer.deliveryDate || null,
      utilityScore: (deal as any).latestUtility || null,
      bidStatus: 'COMPLETED',
      dealStatus: deal.status,
      chatSummaryMetrics: null,
      chatSummaryNarrative: null,
    });

    logger.info(`Auto-created VendorBid ${vendorBid.id} from ChatbotDeal ${bidId}`);
  }

  // Use existing selectVendor function with VendorBid ID
  const result = await selectVendor(
    requisitionId,
    vendorBid.id,  // Use VendorBid ID, not ChatbotDeal ID
    userId,
    'PORTAL',
    remarks
  );

  // Log action with both VendorBid ID and ChatbotDeal ID
  const historyEntry = await logAction(
    requisitionId,
    'SELECTED',
    userId,
    vendorBid.id,  // VendorBid ID (FK to vendor_bids)
    bidId,         // ChatbotDeal ID (FK to chatbot_deals)
    {
      vendorId: deal.vendorId ?? undefined,
      vendorName: (deal as any).Vendor?.name,
      bidPrice: finalPrice,
      selectionId: result.selectionId,
      poId: result.poId,
    },
    remarks
  );

  logger.info(`Deal ${bidId} selected by user ${userId} for requisition ${requisitionId}`);

  return {
    success: true,
    selectionId: result.selectionId,
    vendorId: result.vendorId,
    vendorName: (deal as any).Vendor?.name || 'Unknown',
    poId: result.poId,
    notificationsSent: result.notificationsSent,
    historyId: historyEntry.id,
  };
}

/**
 * Log a view action
 */
export async function logViewAction(
  requisitionId: number,
  userId: number
): Promise<void> {
  await logAction(requisitionId, 'VIEWED', userId, null, null);
}

/**
 * Log an export action
 */
export async function logExportAction(
  requisitionId: number,
  userId: number,
  pdfUrl?: string
): Promise<void> {
  await logAction(requisitionId, 'EXPORTED', userId, null, null, { pdfUrl });
}

/**
 * Get negotiation history for all deals in a requisition.
 * Returns per-vendor summaries with round-by-round messages for PDF pages.
 */
export async function getNegotiationHistory(
  requisitionId: number
): Promise<VendorNegotiationSummary[]> {
  const deals = await ChatbotDeal.findAll({
    where: { requisitionId },
    include: [
      { model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] },
    ],
    order: [['latestUtility', 'DESC']],
  });

  const summaries: VendorNegotiationSummary[] = [];

  for (const deal of deals) {
    const d = deal as any;
    const vendorName = d.Vendor?.name || d.counterparty || 'Unknown';
    const vendorEmail = d.Vendor?.email || '';

    // Fetch VENDOR + ACCORDO messages ordered by round/time
    const messages = await ChatbotMessage.findAll({
      where: {
        dealId: d.id,
        role: { [Op.in]: ['VENDOR', 'ACCORDO'] },
      },
      attributes: ['role', 'extractedOffer', 'decisionAction', 'utilityScore', 'round', 'createdAt'],
      order: [['round', 'ASC'], ['createdAt', 'ASC']],
    });

    // Build per-message snapshots
    const msgSnapshots: DealNegotiationMessage[] = messages.map((m: any) => ({
      round: m.round ?? 0,
      role: m.role,
      price: extractPrice(m.extractedOffer),
      decisionAction: m.decisionAction || null,
      utilityScore: m.utilityScore != null ? Number(m.utilityScore) : null,
      createdAt: m.createdAt,
    }));

    // Starting price = first vendor message price (or 0)
    const firstVendorMsg = msgSnapshots.find(m => m.role === 'VENDOR' && m.price > 0);
    const startingPrice = firstVendorMsg?.price ?? 0;

    // Final price from latestVendorOffer, falling back to last vendor message
    const offer = d.latestVendorOffer || await getLastVendorOffer(d.id);
    let finalPrice = extractPrice(offer);
    if (finalPrice === 0) {
      const lastVendorMsg = [...msgSnapshots].reverse().find(m => m.role === 'VENDOR' && m.price > 0);
      finalPrice = lastVendorMsg?.price ?? 0;
    }

    // % reduction
    const priceReductionPercent =
      startingPrice > 0 && finalPrice > 0
        ? Number((((startingPrice - finalPrice) / startingPrice) * 100).toFixed(1))
        : 0;

    // Max rounds from negotiation config, default 6
    const config = d.negotiationConfigJson as any;
    const maxRounds = config?.maxRounds ?? config?.max_rounds ?? 6;

    // Payment terms from latest offer
    const latestOffer = d.latestVendorOffer || offer || {};
    const paymentTerms = (latestOffer as any).payment_terms || (latestOffer as any).paymentTerms || null;

    summaries.push({
      dealId: d.id,
      vendorName,
      vendorEmail,
      dealStatus: d.status,
      mode: d.mode || 'CONVERSATION',
      startingPrice,
      finalPrice,
      priceReductionPercent,
      roundsTaken: d.round ?? 0,
      maxRounds,
      utilityScore: d.latestUtility != null ? Number(d.latestUtility) : null,
      paymentTerms,
      messages: msgSnapshots,
    });
  }

  return summaries;
}
