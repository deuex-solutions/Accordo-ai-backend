/**
 * Vendor Selections and Purchase Orders seed data
 * Single winner selection per requisition with documented reasons
 * Approval workflow based on amount thresholds
 */

import { generateUUID, generatePoNumber } from '../helpers/id-generator.js';
import { daysFromDate, daysFromNow } from '../helpers/date-utils.js';
import { allRequisitions, type RequisitionData } from './requisitions.js';
import { allBidComparisons, allVendorBids, getBidsByRequisition, type VendorBidData, type BidComparisonData } from './vendor-bids.js';
import { vendorCompanies } from './companies.js';
import { getApprovers, enterpriseUsers } from './users.js';

export interface VendorSelectionData {
  id: string;
  requisitionId: number;
  comparisonId: string;
  selectedVendorId: number; // Vendor company ID
  selectedBidId: string;
  selectedPrice: number;
  selectedByUserId: number;
  selectionReason: string;
  selectionMethod: 'EMAIL_LINK' | 'PORTAL' | 'API';
  approvalRequired: boolean;
  approvalStatus: 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED';
  approvedByUserId: number | null;
  approvedAt: Date | null;
  poId: number | null;
  createdAt: Date;
}

export interface VendorNotificationData {
  id: string;
  selectionId: string;
  vendorCompanyId: number;
  vendorUserId: number;
  bidId: string;
  notificationType: 'SELECTION_WON' | 'SELECTION_LOST';
  sentAt: Date;
}

export interface PurchaseOrderData {
  id: number;
  poNumber: string;
  requisitionId: number;
  selectionId: string;
  vendorCompanyId: number;
  vendorUserId: number;
  totalAmount: number;
  status: 'Draft' | 'Sent' | 'Acknowledged' | 'Fulfilled' | 'Cancelled';
  paymentTerms: string;
  deliveryDate: Date;
  createdById: number;
  createdAt: Date;
  sentAt: Date | null;
}

// Selection reason templates
const selectionReasons: Record<string, string[]> = {
  'L1_LOWEST_PRICE': [
    "Selected as L1 (lowest price) vendor. Offer of ${price} represents best value for the organization.",
    "Awarded to lowest bidder. Price point of ${price} meets budget requirements.",
    "L1 selection based on competitive pricing at ${price}. All quality requirements met.",
  ],
  'L2_BETTER_TERMS': [
    "Selected L2 vendor despite higher price due to superior payment terms ({paymentTerms}) and delivery timeline ({deliveryDays} days).",
    "L2 chosen for better overall value. While price is ${price}, the combination of {paymentTerms} payment and {deliveryDays} day delivery is more favorable.",
    "Awarded to L2 based on holistic evaluation. Score of {score} reflects better vendor rating and past performance.",
  ],
  'L3_STRATEGIC': [
    "L3 vendor selected for strategic partnership considerations. Strong track record and certifications outweigh price premium.",
    "Selected L3 for supply chain diversification. Vendor's quality certifications critical for compliance requirements.",
  ],
  'SINGLE_VENDOR': [
    "Only qualifying vendor after negotiations. Awarded at ${price}.",
    "Single responsive vendor selected. Terms accepted at ${price} with {paymentTerms} payment.",
  ],
};

// Get approver based on amount
function getApproverForAmount(companyId: number, amount: number): { userId: number; required: boolean } {
  const companyApprovers = enterpriseUsers.filter(u =>
    u.companyId === companyId && u.approvalLimit !== undefined && u.approvalLimit > 0
  ).sort((a, b) => (a.approvalLimit || 0) - (b.approvalLimit || 0));

  if (amount < 10000) {
    return { userId: 0, required: false }; // No approval needed under $10K
  }

  // Find appropriate approver
  const approver = companyApprovers.find(a => (a.approvalLimit || 0) >= amount);
  return approver
    ? { userId: approver.id, required: true }
    : { userId: companyApprovers[companyApprovers.length - 1]?.id || 0, required: true };
}

// Fill selection reason template
function fillReasonTemplate(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

// Generate selections and POs
export const allSelections: VendorSelectionData[] = [];
export const allNotifications: VendorNotificationData[] = [];
export const allPurchaseOrders: PurchaseOrderData[] = [];

let poNumber = 1;

// Process awarded requisitions
const awardedRequisitions = allRequisitions.filter(r => r.status === 'Awarded');

awardedRequisitions.forEach(requisition => {
  const comparison = allBidComparisons.find(c => c.requisitionId === requisition.id);
  if (!comparison || comparison.topBids.length === 0) return;

  const bids = getBidsByRequisition(requisition.id);
  if (bids.length === 0) return;

  // Determine which vendor to select
  // Usually L1, but sometimes L2 for better terms or L3 for strategic reasons
  let selectedBid: VendorBidData;
  let reasonCategory: string;

  const l1Bid = bids.find(b => b.rank === 'L1');
  const l2Bid = bids.find(b => b.rank === 'L2');
  const l3Bid = bids.find(b => b.rank === 'L3');

  // 70% L1, 25% L2, 5% L3 selection
  const selectionRoll = Math.random();

  if (bids.length === 1) {
    selectedBid = bids[0];
    reasonCategory = 'SINGLE_VENDOR';
  } else if (selectionRoll < 0.70 && l1Bid) {
    selectedBid = l1Bid;
    reasonCategory = 'L1_LOWEST_PRICE';
  } else if (selectionRoll < 0.95 && l2Bid) {
    selectedBid = l2Bid;
    reasonCategory = 'L2_BETTER_TERMS';
  } else if (l3Bid) {
    selectedBid = l3Bid;
    reasonCategory = 'L3_STRATEGIC';
  } else if (l2Bid) {
    selectedBid = l2Bid;
    reasonCategory = 'L2_BETTER_TERMS';
  } else if (l1Bid) {
    selectedBid = l1Bid;
    reasonCategory = 'L1_LOWEST_PRICE';
  } else {
    selectedBid = bids[0];
    reasonCategory = 'SINGLE_VENDOR';
  }

  // Generate selection reason
  const reasonTemplates = selectionReasons[reasonCategory];
  const reasonTemplate = reasonTemplates[Math.floor(Math.random() * reasonTemplates.length)];
  const reason = fillReasonTemplate(reasonTemplate, {
    price: selectedBid.finalPrice.toLocaleString(),
    paymentTerms: selectedBid.paymentTerms,
    deliveryDays: selectedBid.deliveryDays,
    score: selectedBid.score,
  });

  // Check if approval is required
  const approvalInfo = getApproverForAmount(requisition.companyId, selectedBid.finalPrice);

  const selectionId = generateUUID();
  const selectionDate = daysFromNow(-Math.floor(Math.random() * 30));

  // Create selection
  const selection: VendorSelectionData = {
    id: selectionId,
    requisitionId: requisition.id,
    comparisonId: comparison.id,
    selectedVendorId: selectedBid.vendorCompanyId,
    selectedBidId: selectedBid.id,
    selectedPrice: selectedBid.finalPrice,
    selectedByUserId: requisition.createdById,
    selectionReason: reason,
    selectionMethod: ['EMAIL_LINK', 'PORTAL', 'API'][Math.floor(Math.random() * 3)] as VendorSelectionData['selectionMethod'],
    approvalRequired: approvalInfo.required,
    approvalStatus: approvalInfo.required ? 'APPROVED' : 'NOT_REQUIRED', // All awarded ones are approved
    approvedByUserId: approvalInfo.required ? approvalInfo.userId : null,
    approvedAt: approvalInfo.required ? daysFromDate(selectionDate, 1) : null,
    poId: poNumber,
    createdAt: selectionDate,
  };

  allSelections.push(selection);

  // Update selected bid status
  selectedBid.bidStatus = 'SELECTED';

  // Update other bids as rejected
  bids.forEach(bid => {
    if (bid.id !== selectedBid.id && bid.bidStatus === 'COMPLETED') {
      bid.bidStatus = 'REJECTED';
    }
  });

  // Create notifications
  bids.forEach(bid => {
    if (bid.bidStatus === 'EXCLUDED') return; // Don't notify walked-away vendors

    allNotifications.push({
      id: generateUUID(),
      selectionId,
      vendorCompanyId: bid.vendorCompanyId,
      vendorUserId: bid.vendorUserId,
      bidId: bid.id,
      notificationType: bid.id === selectedBid.id ? 'SELECTION_WON' : 'SELECTION_LOST',
      sentAt: daysFromDate(selectionDate, 0.5),
    });
  });

  // Create PO for selected vendor
  const vendor = vendorCompanies.find(v => v.id === selectedBid.vendorCompanyId);
  const poDate = daysFromDate(selectionDate, 2);

  allPurchaseOrders.push({
    id: poNumber,
    poNumber: generatePoNumber(2026, poNumber),
    requisitionId: requisition.id,
    selectionId,
    vendorCompanyId: selectedBid.vendorCompanyId,
    vendorUserId: selectedBid.vendorUserId,
    totalAmount: selectedBid.finalPrice,
    status: 'Sent',
    paymentTerms: selectedBid.paymentTerms,
    deliveryDate: requisition.deliveryDate,
    createdById: requisition.createdById,
    createdAt: poDate,
    sentAt: daysFromDate(poDate, 0.5),
  });

  poNumber++;
});

// Helper functions - Selections
export const getSelectionById = (id: string): VendorSelectionData | undefined =>
  allSelections.find(s => s.id === id);

export const getSelectionByRequisition = (requisitionId: number): VendorSelectionData | undefined =>
  allSelections.find(s => s.requisitionId === requisitionId);

export const getSelectionsByVendor = (vendorCompanyId: number): VendorSelectionData[] =>
  allSelections.filter(s => s.selectedVendorId === vendorCompanyId);

export const getSelectionsByApprovalStatus = (status: VendorSelectionData['approvalStatus']): VendorSelectionData[] =>
  allSelections.filter(s => s.approvalStatus === status);

export const getPendingApprovals = (): VendorSelectionData[] =>
  allSelections.filter(s => s.approvalStatus === 'PENDING');

export const getApprovedSelections = (): VendorSelectionData[] =>
  allSelections.filter(s => s.approvalStatus === 'APPROVED' || s.approvalStatus === 'NOT_REQUIRED');

// Helper functions - Notifications
export const getNotificationsBySelection = (selectionId: string): VendorNotificationData[] =>
  allNotifications.filter(n => n.selectionId === selectionId);

export const getNotificationsByVendor = (vendorCompanyId: number): VendorNotificationData[] =>
  allNotifications.filter(n => n.vendorCompanyId === vendorCompanyId);

export const getWinNotifications = (): VendorNotificationData[] =>
  allNotifications.filter(n => n.notificationType === 'SELECTION_WON');

export const getLostNotifications = (): VendorNotificationData[] =>
  allNotifications.filter(n => n.notificationType === 'SELECTION_LOST');

// Helper functions - Purchase Orders
export const getPoById = (id: number): PurchaseOrderData | undefined =>
  allPurchaseOrders.find(p => p.id === id);

export const getPoByNumber = (poNumber: string): PurchaseOrderData | undefined =>
  allPurchaseOrders.find(p => p.poNumber === poNumber);

export const getPoByRequisition = (requisitionId: number): PurchaseOrderData | undefined =>
  allPurchaseOrders.find(p => p.requisitionId === requisitionId);

export const getPosByVendor = (vendorCompanyId: number): PurchaseOrderData[] =>
  allPurchaseOrders.filter(p => p.vendorCompanyId === vendorCompanyId);

export const getPosByStatus = (status: PurchaseOrderData['status']): PurchaseOrderData[] =>
  allPurchaseOrders.filter(p => p.status === status);

export const getOpenPos = (): PurchaseOrderData[] =>
  allPurchaseOrders.filter(p => p.status === 'Sent' || p.status === 'Acknowledged');

export const getTotalPoValue = (): number =>
  allPurchaseOrders.reduce((sum, p) => sum + p.totalAmount, 0);

export const getPoValueByVendor = (vendorCompanyId: number): number =>
  getPosByVendor(vendorCompanyId).reduce((sum, p) => sum + p.totalAmount, 0);
