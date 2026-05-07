import { Op } from 'sequelize';
import models from '../../models/index.js';
import { CustomError } from '../../utils/custom-error.js';
import logger from '../../config/logger.js';
import env from '../../config/env.js';
import { generateMetricsSummary, generateNarrativeSummary } from './summary/summary-generator.js';
import { generateComparisonPDF } from './pdf/pdf-generator.js';
import { sendComparisonEmail, sendVendorWonEmail, sendVendorLostEmail } from './bid-comparison.email.js';
import type {
  CaptureVendorBidResult,
  ComparisonCheckResult,
  TopBidsResult,
  GenerateComparisonResult,
  SelectVendorResult,
  TriggerType,
  TopBidInfo,
} from './bid-comparison.types.js';

const { ChatbotDeal, ChatbotMessage, Contract, Requisition, User, VendorBid, BidComparison, VendorSelection, VendorNotification, Po } = models;

/**
 * Capture a vendor's final bid when their negotiation completes
 */
export async function captureVendorBid(dealId: string): Promise<CaptureVendorBidResult> {
  const deal = await ChatbotDeal.findByPk(dealId, {
    include: [
      { model: Contract, as: 'Contract' },
    ],
  });

  if (!deal) {
    throw new CustomError('Deal not found', 404);
  }

  if (!deal.requisitionId || !deal.Contract) {
    throw new CustomError('Deal is not linked to a requisition or contract', 400);
  }

  // Check if bid already exists
  const existingBid = await VendorBid.findOne({
    where: { dealId },
  });

  if (existingBid) {
    // Update existing bid
    const bidStatus = determineBidStatus(deal.status as string);
    await existingBid.update({
      finalPrice: extractFinalPrice(deal.latestVendorOffer),
      unitPrice: extractUnitPrice(deal.latestVendorOffer),
      paymentTerms: extractPaymentTerms(deal.latestVendorOffer),
      utilityScore: deal.latestUtility,
      bidStatus,
      dealStatus: deal.status as 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED',
      completedAt: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'].includes(deal.status) ? new Date() : null,
    });

    return {
      bidId: existingBid.id,
      requisitionId: deal.requisitionId,
      vendorId: deal.Contract.vendorId!,
      finalPrice: existingBid.finalPrice,
      bidStatus: existingBid.bidStatus,
      dealStatus: existingBid.dealStatus,
    };
  }

  // Get vendor info
  const vendorId = deal.Contract.vendorId;
  if (!vendorId) {
    throw new CustomError('Contract has no vendor assigned', 400);
  }
  const vendor = await User.findByPk(vendorId);
  if (!vendor) {
    throw new CustomError('Vendor not found', 404);
  }

  // Generate chat summary
  const messages = await ChatbotMessage.findAll({
    where: { dealId },
    order: [['createdAt', 'ASC']],
  });

  const summaryMetrics = await generateMetricsSummary(deal, messages);
  let summaryNarrative: string | null = null;

  try {
    summaryNarrative = await generateNarrativeSummary(deal, messages);
  } catch (error) {
    logger.warn(`Failed to generate narrative summary for deal ${dealId}: ${(error as Error).message}`);
  }

  // Determine bid status based on deal status
  const bidStatus = determineBidStatus(deal.status as string);

  // Create vendor bid
  const bid = await VendorBid.create({
    requisitionId: deal.requisitionId,
    contractId: deal.Contract.id,
    dealId: deal.id,
    vendorId: deal.Contract.vendorId!,
    finalPrice: extractFinalPrice(deal.latestVendorOffer),
    unitPrice: extractUnitPrice(deal.latestVendorOffer),
    paymentTerms: extractPaymentTerms(deal.latestVendorOffer),
    deliveryDate: null, // Can be extracted from deal if available
    utilityScore: deal.latestUtility,
    bidStatus,
    dealStatus: deal.status as 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED',
    chatSummaryMetrics: summaryMetrics,
    chatSummaryNarrative: summaryNarrative,
    chatLink: `${env.chatbotFrontendUrl}/chatbot/requisitions/${deal.requisitionId}/vendors/${deal.Contract.vendorId}/deals/${dealId}`,
    completedAt: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'].includes(deal.status) ? new Date() : null,
  });

  logger.info(`Captured vendor bid ${bid.id} for deal ${dealId}`);

  return {
    bidId: bid.id,
    requisitionId: deal.requisitionId,
    vendorId: deal.Contract.vendorId!,
    finalPrice: bid.finalPrice,
    bidStatus: bid.bidStatus,
    dealStatus: bid.dealStatus,
  };
}

/**
 * Check if all vendors have completed negotiations for a requisition
 */
export async function checkCompletionStatus(requisitionId: number): Promise<ComparisonCheckResult> {
  const requisition = await Requisition.findByPk(requisitionId);
  if (!requisition) {
    throw new CustomError('Requisition not found', 404);
  }

  // Get all contracts (vendors) for this requisition
  const contracts = await Contract.findAll({
    where: { requisitionId },
    include: [{ model: ChatbotDeal, as: 'ChatbotDeal' }],
  });

  const totalVendors = contracts.length;
  let completedVendors = 0;
  let pendingVendors = 0;
  let excludedVendors = 0;

  for (const contract of contracts) {
    const deal = (contract as any).ChatbotDeal;
    if (!deal) {
      pendingVendors++;
      continue;
    }

    const status = deal.status;
    if (status === 'ACCEPTED') {
      completedVendors++;
    } else if (status === 'WALKED_AWAY') {
      // Check if escalation was resolved
      excludedVendors++;
    } else if (status === 'ESCALATED') {
      // Check if escalation was resolved with a final offer
      const hasResolvedOffer = deal.latestVendorOffer && deal.latestUtility;
      if (hasResolvedOffer) {
        completedVendors++;
      } else {
        pendingVendors++;
      }
    } else {
      pendingVendors++;
    }
  }

  const allCompleted = pendingVendors === 0 && totalVendors > 0;
  const deadlinePassed = requisition.negotiationClosureDate
    ? new Date(requisition.negotiationClosureDate) < new Date()
    : false;

  let shouldTrigger = false;
  let triggerReason: TriggerType | null = null;

  // Check if comparison already exists
  const existingComparison = await BidComparison.findOne({
    where: { requisitionId },
  });

  if (!existingComparison) {
    if (allCompleted) {
      shouldTrigger = true;
      triggerReason = 'ALL_COMPLETED';
    } else if (deadlinePassed && completedVendors > 0) {
      shouldTrigger = true;
      triggerReason = 'DEADLINE_REACHED';
    }
  }

  return {
    requisitionId,
    totalVendors,
    completedVendors,
    pendingVendors,
    excludedVendors,
    allCompleted,
    deadlinePassed,
    shouldTrigger,
    triggerReason,
  };
}

/**
 * Check completion status and trigger comparison if needed
 */
export async function checkAndTriggerComparison(requisitionId: number): Promise<GenerateComparisonResult | null> {
  const status = await checkCompletionStatus(requisitionId);

  if (status.shouldTrigger && status.triggerReason) {
    return generateAndSendComparison(requisitionId, status.triggerReason);
  }

  return null;
}

/**
 * Get top bids for a requisition, ranked by price
 */
export async function getTopBids(requisitionId: number, limit: number = 3): Promise<TopBidsResult> {
  // Get all completed bids (exclude WALKED_AWAY unless resolved)
  const bids = await VendorBid.findAll({
    where: {
      requisitionId,
      bidStatus: { [Op.in]: ['COMPLETED', 'SELECTED'] },
      finalPrice: { [Op.not]: null },
    },
    include: [
      { model: User, as: 'Vendor', attributes: ['id', 'name', 'email'] },
    ],
    order: [['finalPrice', 'ASC']],
  });

  const excludedCount = await VendorBid.count({
    where: {
      requisitionId,
      bidStatus: 'EXCLUDED',
    },
  });

  const topBids: TopBidInfo[] = bids.slice(0, limit).map((bid, index) => ({
    bidId: bid.id,
    vendorId: bid.vendorId,
    vendorName: (bid as any).Vendor?.name || 'Unknown',
    vendorEmail: (bid as any).Vendor?.email || '',
    finalPrice: Number(bid.finalPrice),
    unitPrice: bid.unitPrice ? Number(bid.unitPrice) : null,
    paymentTerms: bid.paymentTerms,
    deliveryDate: bid.deliveryDate ? bid.deliveryDate.toISOString() : null,
    utilityScore: bid.utilityScore ? Number(bid.utilityScore) : null,
    rank: index + 1,
    chatLink: bid.chatLink,
  }));

  return {
    bids: topBids,
    totalBids: bids.length,
    includedBids: bids.length,
    excludedBids: excludedCount,
  };
}

/**
 * Generate comparison report and send to procurement owner
 */
export async function generateAndSendComparison(
  requisitionId: number,
  triggeredBy: TriggerType
): Promise<GenerateComparisonResult> {
  const requisition = await Requisition.findByPk(requisitionId, {
    include: [
      { model: models.Project, as: 'Project' },
    ],
  });

  if (!requisition) {
    throw new CustomError('Requisition not found', 404);
  }

  // Get procurement owner
  if (!requisition.createdBy) {
    throw new CustomError('Requisition has no owner', 400);
  }
  const owner = await User.findByPk(requisition.createdBy);
  if (!owner) {
    throw new CustomError('Requisition owner not found', 404);
  }
  if (!owner.email) {
    throw new CustomError('Requisition owner has no email', 400);
  }
  const ownerEmail = owner.email;
  const ownerName = owner.name || owner.email;

  // Get top bids
  const topBidsResult = await getTopBids(requisitionId, 3);

  // Get vendor counts
  const status = await checkCompletionStatus(requisitionId);

  // Generate PDF
  const pdfPath = await generateComparisonPDF({
    requisition: {
      rfqId: requisition.rfqId || `RFQ-${requisitionId}`,
      subject: requisition.subject || 'Untitled Requisition',
      projectName: (requisition as any).Project?.projectName || 'Unknown Project',
      category: requisition.category || 'General',
      deliveryDate: requisition.deliveryDate,
      negotiationClosureDate: requisition.negotiationClosureDate,
      totalVendors: status.totalVendors,
      completedVendors: status.completedVendors,
      excludedVendors: status.excludedVendors,
    },
    bids: topBidsResult.bids.map((bid) => ({
      rank: bid.rank,
      vendorName: bid.vendorName,
      vendorEmail: bid.vendorEmail,
      finalPrice: bid.finalPrice,
      unitPrice: bid.unitPrice,
      paymentTerms: bid.paymentTerms || 'Not specified',
      deliveryDate: bid.deliveryDate,
      utilityScore: bid.utilityScore,
      chatLink: bid.chatLink,
      summaryNarrative: null, // Will be fetched if needed
    })),
    generatedAt: new Date(),
  });

  // Create comparison record
  const comparison = await BidComparison.create({
    requisitionId,
    triggeredBy,
    totalVendors: status.totalVendors,
    completedVendors: status.completedVendors,
    excludedVendors: status.excludedVendors,
    topBidsJson: topBidsResult.bids,
    pdfUrl: pdfPath,
    sentToUserId: owner.id,
    sentToEmail: ownerEmail,
    emailStatus: 'PENDING',
    generatedAt: new Date(),
  });

  // Send email with PDF
  let emailSent = false;
  try {
    await sendComparisonEmail({
      recipientEmail: ownerEmail,
      recipientName: ownerName,
      requisitionId,
      requisitionTitle: requisition.subject || 'Untitled Requisition',
      projectName: (requisition as any).Project?.projectName || 'Unknown Project',
      rfqId: requisition.rfqId || `RFQ-${requisitionId}`,
      topBids: topBidsResult.bids,
      totalVendors: status.totalVendors,
      completedVendors: status.completedVendors,
      triggeredBy,
      pdfPath,
    });

    await comparison.update({
      emailStatus: 'SENT',
      sentAt: new Date(),
    });
    emailSent = true;
  } catch (error) {
    logger.error(`Failed to send comparison email: ${(error as Error).message}`);
    await comparison.update({
      emailStatus: 'FAILED',
    });
  }

  logger.info(`Generated comparison ${comparison.id} for requisition ${requisitionId}`);

  return {
    comparisonId: comparison.id,
    pdfPath,
    topBids: topBidsResult.bids,
    emailSent,
  };
}

/**
 * Select a vendor for a requisition
 */
export async function selectVendor(
  requisitionId: number,
  bidId: string,
  selectedByUserId: number,
  selectionMethod: 'EMAIL_LINK' | 'PORTAL' | 'API',
  selectionReason?: string
): Promise<SelectVendorResult> {
  // Validate requisition
  const requisition = await Requisition.findByPk(requisitionId, {
    include: [{ model: models.Project, as: 'Project' }],
  });
  if (!requisition) {
    throw new CustomError('Requisition not found', 404);
  }

  if (requisition.status === 'Awarded') {
    throw new CustomError('Requisition has already been awarded', 400);
  }

  // Validate bid
  const selectedBid = await VendorBid.findByPk(bidId, {
    include: [{ model: User, as: 'Vendor' }],
  });
  if (!selectedBid) {
    throw new CustomError('Bid not found', 404);
  }

  if (selectedBid.requisitionId !== requisitionId) {
    throw new CustomError('Bid does not belong to this requisition', 400);
  }

  if (selectedBid.bidStatus === 'EXCLUDED') {
    throw new CustomError('Cannot select an excluded bid', 400);
  }

  // Get the latest comparison
  const comparison = await BidComparison.findOne({
    where: { requisitionId },
    order: [['createdAt', 'DESC']],
  });

  // Create selection record
  const selection = await VendorSelection.create({
    requisitionId,
    comparisonId: comparison?.id || null,
    selectedVendorId: selectedBid.vendorId,
    selectedBidId: bidId,
    selectedPrice: selectedBid.finalPrice || 0,
    selectedByUserId,
    selectionReason: selectionReason || null,
    selectionMethod,
    selectedAt: new Date(),
  });

  // Update selected bid status
  await selectedBid.update({ bidStatus: 'SELECTED' });

  // Update other bids to REJECTED
  await VendorBid.update(
    { bidStatus: 'REJECTED' },
    {
      where: {
        requisitionId,
        id: { [Op.ne]: bidId },
        bidStatus: { [Op.in]: ['COMPLETED', 'PENDING'] },
      },
    }
  );

  // Update requisition status
  await requisition.update({
    status: 'Awarded',
    finalPrice: selectedBid.finalPrice,
  });

  // Auto-generate PO
  let poId: number | null = null;
  try {
    const po = await Po.create({
      contractId: selectedBid.contractId,
      requisitionId,
      companyId: (requisition as any).Project?.companyId || null,
      vendorId: selectedBid.vendorId,
      lineItems: null,
      subTotal: selectedBid.finalPrice,
      taxTotal: 0,
      total: selectedBid.finalPrice,
      deliveryDate: selectedBid.deliveryDate || requisition.deliveryDate,
      paymentTerms: selectedBid.paymentTerms,
      status: 'Created',
      addedBy: selectedByUserId,
    });
    poId = po.id;
    await selection.update({ poId });
    logger.info(`Created PO ${poId} for selection ${selection.id}`);
  } catch (error) {
    logger.error(`Failed to create PO: ${(error as Error).message}`);
  }

  // Send notifications to all vendors
  let notificationsSent = 0;
  const allBids = await VendorBid.findAll({
    where: { requisitionId },
    include: [{ model: User, as: 'Vendor' }],
  });

  for (const bid of allBids) {
    const vendor = (bid as any).Vendor;
    if (!vendor) continue;

    const notificationType = bid.id === bidId ? 'SELECTION_WON' : 'SELECTION_LOST';

    const notification = await VendorNotification.create({
      selectionId: selection.id,
      vendorId: bid.vendorId,
      bidId: bid.id,
      notificationType,
      emailStatus: 'PENDING',
    });

    try {
      if (notificationType === 'SELECTION_WON') {
        await sendVendorWonEmail({
          recipientEmail: vendor.email,
          vendorName: vendor.name || vendor.email,
          requisitionTitle: requisition.subject || 'Untitled Requisition',
          projectName: (requisition as any).Project?.projectName || 'Unknown Project',
          selectedPrice: Number(selectedBid.finalPrice),
          chatSummary: selectedBid.chatSummaryNarrative,
        });
      } else {
        await sendVendorLostEmail({
          recipientEmail: vendor.email,
          vendorName: vendor.name || vendor.email,
          requisitionTitle: requisition.subject || 'Untitled Requisition',
          projectName: (requisition as any).Project?.projectName || 'Unknown Project',
          bidPrice: Number(bid.finalPrice),
          winningPrice: Number(selectedBid.finalPrice),
        });
      }

      await notification.update({
        emailStatus: 'SENT',
        sentAt: new Date(),
      });
      notificationsSent++;
    } catch (error) {
      logger.error(`Failed to send ${notificationType} notification: ${(error as Error).message}`);
      await notification.update({ emailStatus: 'FAILED' });
    }
  }

  logger.info(`Vendor ${selectedBid.vendorId} selected for requisition ${requisitionId}`);

  return {
    selectionId: selection.id,
    vendorId: selectedBid.vendorId,
    poId,
    notificationsSent,
  };
}

// Helper functions
function determineBidStatus(dealStatus: string): 'PENDING' | 'COMPLETED' | 'EXCLUDED' {
  switch (dealStatus) {
    case 'ACCEPTED':
      return 'COMPLETED';
    case 'WALKED_AWAY':
      return 'EXCLUDED';
    case 'ESCALATED':
      return 'PENDING'; // Will be reviewed
    default:
      return 'PENDING';
  }
}

function extractFinalPrice(offer: any): number | null {
  if (!offer) return null;
  if (typeof offer === 'object' && offer.unit_price) {
    return Number(offer.unit_price);
  }
  if (typeof offer === 'object' && offer.price) {
    return Number(offer.price);
  }
  return null;
}

function extractUnitPrice(offer: any): number | null {
  if (!offer) return null;
  if (typeof offer === 'object' && offer.unit_price) {
    return Number(offer.unit_price);
  }
  return null;
}

function extractPaymentTerms(offer: any): string | null {
  if (!offer) return null;
  if (typeof offer === 'object' && offer.payment_terms) {
    return String(offer.payment_terms);
  }
  return null;
}

