import type { BidActionType, ActionDetails } from '../../models/bid-action-history.js';

// Bid status - maps to what we use in bid analysis (derived from deal status)
export type BidStatus = 'PENDING' | 'COMPLETED' | 'EXCLUDED' | 'SELECTED' | 'REJECTED';

// Deal status - from ChatbotDeal model
export type DealStatus = 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';

// Chat summary metrics structure
export interface ChatSummaryMetrics {
  rounds: number;
  duration: number;
  priceReduction: number;
  [key: string]: unknown;
}

// Filter types for requisition list
export interface BidAnalysisFilters {
  search?: string;
  status?: 'ready' | 'awaiting' | 'awarded' | 'all';
  projectId?: number;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  limit: number;
  sortBy?: 'rfqId' | 'subject' | 'negotiationClosureDate' | 'bidsCount' | 'lowestPrice';
  sortOrder?: 'asc' | 'desc';
}

// Requisition summary for list view
export interface RequisitionWithBidSummary {
  id: number;
  rfqId: string;
  subject: string;
  description: string | null;
  status: string;
  negotiationClosureDate: Date | null;
  deliveryDate: Date | null;
  projectId: number | null;
  projectName: string | null;
  createdBy: number | null;
  createdByName: string | null;
  // Bid statistics
  bidsCount: number;
  completedBidsCount: number;
  pendingBidsCount: number;
  excludedBidsCount: number;
  // Price range
  lowestPrice: number | null;
  highestPrice: number | null;
  averagePrice: number | null;
  // Analysis status
  isReadyForAnalysis: boolean;
  hasAwardedVendor: boolean;
  awardedVendorName: string | null;
}

// Paginated result
export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

// Top bid information (L1, L2, L3)
export interface TopBidInfo {
  bidId: string;
  rank: number;
  vendorId: number;
  vendorName: string;
  vendorEmail: string;
  finalPrice: number;
  unitPrice: number | null;
  paymentTerms: string | null;
  deliveryDate: string | null;
  utilityScore: number | null;
  bidStatus: BidStatus;
  dealStatus: DealStatus;
  dealId: string;
  chatLink: string | null;
  chatSummaryMetrics: ChatSummaryMetrics | null;
  chatSummaryNarrative: string | null;
  isRejected: boolean;
  rejectedAt: Date | null;
  rejectedBy: string | null;
  rejectedRemarks: string | null;
}

// Full bid details for allocation table
export interface BidWithDetails extends TopBidInfo {
  contractId: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// Requisition detail response
export interface RequisitionBidDetail {
  requisition: {
    id: number;
    rfqId: string;
    subject: string;
    description: string | null;
    category: string | null;
    targetPrice: number | null;
    maxAcceptablePrice: number | null;
    negotiationClosureDate: Date | null;
    deliveryDate: Date | null;
    status: string;
    projectId: number | null;
    projectName: string | null;
    createdBy: number | null;
    createdByName: string | null;
    totalVendors: number;
    completedVendors: number;
  };
  priceRange: {
    lowest: number | null;
    highest: number | null;
    average: number | null;
    targetPrice: number | null;
    maxAcceptablePrice: number | null;
  };
  topBids: TopBidInfo[];
  allBids: BidWithDetails[];
  selectedBidId: string | null;
  selectedVendorId: number | null;
  selectedVendorName: string | null;
  isAwarded: boolean;
}

// Action history entry
export interface BidActionHistoryEntry {
  id: number;
  requisitionId: number;
  bidId: string | null;
  userId: number;
  userName: string;
  userEmail: string;
  action: BidActionType;
  actionDetails: ActionDetails | null;
  remarks: string | null;
  createdAt: Date;
  // Formatted for display
  actionLabel: string;
  vendorName: string | null;
  bidPrice: number | null;
}

// Reject bid result
export interface RejectBidResult {
  success: boolean;
  bidId: string;
  previousStatus: DealStatus | BidStatus | string;
  newStatus: BidStatus | string;
  historyId: number;
}

// Restore bid result
export interface RestoreBidResult {
  success: boolean;
  bidId: string;
  previousStatus: BidStatus | string;
  newStatus: BidStatus | string;
  historyId: number;
}

// Select bid result (extends existing from bidComparison)
export interface SelectBidResult {
  success: boolean;
  selectionId: string;
  vendorId: number;
  vendorName: string;
  poId: number | null;
  notificationsSent: number;
  historyId: number;
}

// API response wrapper
export interface ApiResponse<T> {
  message: string;
  data: T;
}

// Action labels for history display
export const ACTION_LABELS: Record<BidActionType, string> = {
  SELECTED: 'Selected vendor',
  REJECTED: 'Rejected bid',
  RESTORED: 'Restored bid',
  VIEWED: 'Viewed analysis',
  EXPORTED: 'Exported PDF',
  COMPARISON_GENERATED: 'Generated comparison',
};

// Negotiation message snapshot used in price-history tables
export interface DealNegotiationMessage {
  round: number;
  role: 'VENDOR' | 'ACCORDO' | 'SYSTEM';
  price: number;
  decisionAction: string | null;
  utilityScore: number | null;
  createdAt: Date;
}

// Per-vendor negotiation summary for PDF pages
export interface VendorNegotiationSummary {
  dealId: string;
  vendorName: string;
  vendorEmail: string;
  dealStatus: DealStatus;
  mode: string;
  startingPrice: number;
  finalPrice: number;
  priceReductionPercent: number;
  roundsTaken: number;
  maxRounds: number;
  utilityScore: number | null;
  paymentTerms: string | null;
  messages: DealNegotiationMessage[];
}
