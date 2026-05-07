import type { BidStatus, DealStatus, ChatSummaryMetrics } from '../../models/vendor-bid.js';
import type { TriggerType, TopBidInfo } from '../../models/bid-comparison.js';
import type { SelectionMethod } from '../../models/vendor-selection.js';
import type { NotificationType } from '../../models/vendor-notification.js';

// Re-export types from models
export type { BidStatus, DealStatus, ChatSummaryMetrics, TriggerType, TopBidInfo, SelectionMethod, NotificationType };

// Service interfaces
export interface CaptureVendorBidInput {
  dealId: string;
}

export interface CaptureVendorBidResult {
  bidId: string;
  requisitionId: number;
  vendorId: number;
  finalPrice: number | null;
  bidStatus: BidStatus;
  dealStatus: DealStatus;
}

export interface ComparisonCheckResult {
  requisitionId: number;
  totalVendors: number;
  completedVendors: number;
  pendingVendors: number;
  excludedVendors: number;
  allCompleted: boolean;
  deadlinePassed: boolean;
  shouldTrigger: boolean;
  triggerReason: TriggerType | null;
}

export interface TopBidsResult {
  bids: TopBidInfo[];
  totalBids: number;
  includedBids: number;
  excludedBids: number;
}

export interface GenerateComparisonInput {
  requisitionId: number;
  triggeredBy: TriggerType;
}

export interface GenerateComparisonResult {
  comparisonId: string;
  pdfPath: string;
  topBids: TopBidInfo[];
  emailSent: boolean;
}

export interface SelectVendorInput {
  requisitionId: number;
  bidId: string;
  selectedByUserId: number;
  selectionMethod: SelectionMethod;
  selectionReason?: string;
}

export interface SelectVendorResult {
  selectionId: string;
  vendorId: number;
  poId: number | null;
  notificationsSent: number;
}

// PDF generation interfaces
export interface PDFBidData {
  rank: number;
  vendorName: string;
  vendorEmail: string;
  finalPrice: number;
  unitPrice: number | null;
  paymentTerms: string;
  deliveryDate: string | null;
  utilityScore: number | null;
  chatLink: string | null;
  summaryNarrative: string | null;
}

export interface PDFRequisitionData {
  rfqId: string;
  subject: string;
  projectName: string;
  category: string;
  deliveryDate: Date | null;
  negotiationClosureDate: Date | null;
  totalVendors: number;
  completedVendors: number;
  excludedVendors: number;
}

export interface GeneratePDFInput {
  requisition: PDFRequisitionData;
  bids: PDFBidData[];
  generatedAt: Date;
}

// Summary generation interfaces
export interface GenerateSummaryInput {
  dealId: string;
  messages: Array<{
    role: string;
    content: string;
    extractedOffer?: object | null;
    counterOffer?: object | null;
    utilityScore?: number | null;
    decisionAction?: string | null;
    createdAt: Date;
  }>;
  deal: {
    title: string;
    counterparty: string | null;
    status: DealStatus;
    round: number;
    latestUtility: number | null;
  };
}

export interface SummaryResult {
  metrics: ChatSummaryMetrics;
  narrative: string;
}

// Email template interfaces
export interface ComparisonEmailData {
  recipientName: string;
  requisitionTitle: string;
  projectName: string;
  rfqId: string;
  topBids: TopBidInfo[];
  totalVendors: number;
  completedVendors: number;
  triggeredBy: TriggerType;
  portalLink: string;
  pdfAttached: boolean;
}

export interface VendorWonEmailData {
  vendorName: string;
  requisitionTitle: string;
  projectName: string;
  selectedPrice: number;
  chatSummary: string | null;
}

export interface VendorLostEmailData {
  vendorName: string;
  requisitionTitle: string;
  projectName: string;
  bidPrice: number;
  winningPrice: number;
}

// API response interfaces
export interface ComparisonStatusResponse {
  requisitionId: number;
  hasComparison: boolean;
  comparisonId: string | null;
  triggeredBy: TriggerType | null;
  generatedAt: Date | null;
  emailStatus: string | null;
  pdfUrl: string | null;
  totalVendors: number;
  completedVendors: number;
  excludedVendors: number;
  hasSelection: boolean;
  selectionId: string | null;
}

export interface BidListResponse {
  bids: Array<{
    id: string;
    vendorId: number;
    vendorName: string;
    vendorEmail: string;
    finalPrice: number | null;
    unitPrice: number | null;
    paymentTerms: string | null;
    deliveryDate: Date | null;
    utilityScore: number | null;
    bidStatus: BidStatus;
    dealStatus: DealStatus;
    chatLink: string | null;
    chatSummaryNarrative: string | null;
    completedAt: Date | null;
  }>;
  totalCount: number;
}

export interface SelectionDetailsResponse {
  selectionId: string;
  requisitionId: number;
  selectedVendor: {
    id: number;
    name: string;
    email: string;
  };
  selectedPrice: number;
  selectedBy: {
    id: number;
    name: string;
    email: string;
  };
  selectionReason: string | null;
  selectionMethod: SelectionMethod;
  selectedAt: Date;
  poId: number | null;
  notifications: Array<{
    vendorId: number;
    vendorName: string;
    notificationType: NotificationType;
    emailStatus: string;
    sentAt: Date | null;
  }>;
}
