/**
 * Email Logs seed data
 * All email types: vendor_attached, status_change, comparison_ready,
 * selection_won, selection_lost, po_created, escalation
 */

import { generateUniqueToken } from '../helpers/id-generator.js';
import { daysFromDate, daysFromNow } from '../helpers/date-utils.js';
import { allContracts, type ContractData } from './contracts.js';
import { allBidComparisons, type BidComparisonData } from './vendor-bids.js';
import { allNotifications, allPurchaseOrders, type VendorNotificationData, type PurchaseOrderData } from './selections.js';
import { allRequisitions } from './requisitions.js';
import { vendorUsers, enterpriseUsers } from './users.js';
import { vendorCompanies } from './companies.js';

export interface EmailLogData {
  id: number;
  recipientEmail: string;
  recipientId: number | null;
  subject: string;
  emailType: 'vendor_attached' | 'status_change' | 'comparison_ready' | 'selection_won' | 'selection_lost' | 'po_created' | 'escalation' | 'deadline_reminder';
  status: 'pending' | 'sent' | 'failed' | 'bounced';
  contractId: number | null;
  requisitionId: number | null;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  retryCount: number;
  messageId: string;
  sentAt: Date;
  createdAt: Date;
}

export const allEmailLogs: EmailLogData[] = [];
let emailLogId = 1;

// Helper to get vendor email by company ID
function getVendorEmailByCompany(companyId: number): { email: string; userId: number } {
  const vendorUser = vendorUsers.find(u => u.companyId === companyId && u.role === 'Sales Representative');
  return vendorUser
    ? { email: vendorUser.email, userId: vendorUser.id }
    : { email: 'unknown@vendor.com', userId: 0 };
}

// Helper to get procurement user email by company
function getProcurementEmailByCompany(companyId: number): { email: string; userId: number } {
  const procUser = enterpriseUsers.find(u => u.companyId === companyId && u.role.includes('Procurement'));
  return procUser
    ? { email: procUser.email, userId: procUser.id }
    : { email: 'procurement@company.com', userId: 0 };
}

// 1. Vendor Attached emails (one per contract that was sent)
allContracts
  .filter(c => c.status !== 'Draft')
  .forEach(contract => {
    const requisition = allRequisitions.find(r => r.id === contract.requisitionId);
    const vendor = getVendorEmailByCompany(contract.vendorCompanyId);
    const vendorCompany = vendorCompanies.find(v => v.id === contract.vendorCompanyId);

    allEmailLogs.push({
      id: emailLogId++,
      recipientEmail: vendor.email,
      recipientId: vendor.userId,
      subject: `New RFQ Invitation: ${requisition?.title || 'Procurement Request'}`,
      emailType: 'vendor_attached',
      status: 'sent',
      contractId: contract.id,
      requisitionId: contract.requisitionId,
      metadata: {
        vendorCompanyName: vendorCompany?.companyName,
        rfqId: requisition?.rfqId,
        estimatedValue: requisition?.estimatedValue,
        deadline: requisition?.negotiationClosureDate,
      },
      errorMessage: null,
      retryCount: 0,
      messageId: generateUniqueToken(),
      sentAt: contract.sentAt || new Date(contract.createdAt),
      createdAt: contract.sentAt || new Date(contract.createdAt),
    });
  });

// 2. Status Change emails (for contracts that changed status)
allContracts
  .filter(c => c.status === 'InNegotiation' || c.status === 'Accepted' || c.status === 'Rejected')
  .forEach(contract => {
    const requisition = allRequisitions.find(r => r.id === contract.requisitionId);
    const vendor = getVendorEmailByCompany(contract.vendorCompanyId);

    // Only add if different from vendor_attached (which would be Sent status)
    if (contract.status !== 'Sent') {
      allEmailLogs.push({
        id: emailLogId++,
        recipientEmail: vendor.email,
        recipientId: vendor.userId,
        subject: `Contract Status Update: ${requisition?.title || 'Contract'} - ${contract.status}`,
        emailType: 'status_change',
        status: 'sent',
        contractId: contract.id,
        requisitionId: contract.requisitionId,
        metadata: {
          oldStatus: 'Sent',
          newStatus: contract.status,
          rfqId: requisition?.rfqId,
        },
        errorMessage: null,
        retryCount: 0,
        messageId: generateUniqueToken(),
        sentAt: contract.openedAt || daysFromDate(new Date(contract.createdAt), 2),
        createdAt: contract.openedAt || daysFromDate(new Date(contract.createdAt), 2),
      });
    }
  });

// 3. Comparison Ready emails (sent to procurement when all bids are in)
allBidComparisons.forEach(comparison => {
  const requisition = allRequisitions.find(r => r.id === comparison.requisitionId);
  if (!requisition) return;

  const procUser = getProcurementEmailByCompany(requisition.companyId);

  allEmailLogs.push({
    id: emailLogId++,
    recipientEmail: procUser.email,
    recipientId: procUser.userId,
    subject: `Bid Comparison Ready: ${requisition.title}`,
    emailType: 'comparison_ready',
    status: 'sent',
    contractId: null,
    requisitionId: comparison.requisitionId,
    metadata: {
      rfqId: requisition.rfqId,
      totalVendors: comparison.totalVendors,
      completedVendors: comparison.completedVendors,
      excludedVendors: comparison.excludedVendors,
      triggeredBy: comparison.triggeredBy,
      topBidsCount: comparison.topBids.length,
      l1Price: comparison.topBids[0]?.finalPrice,
      l1Vendor: comparison.topBids[0]?.vendorName,
    },
    errorMessage: null,
    retryCount: 0,
    messageId: generateUniqueToken(),
    sentAt: comparison.generatedAt,
    createdAt: comparison.generatedAt,
  });
});

// 4. Selection Won/Lost emails
allNotifications.forEach(notification => {
  const vendor = getVendorEmailByCompany(notification.vendorCompanyId);
  const vendorCompany = vendorCompanies.find(v => v.id === notification.vendorCompanyId);

  // Find the requisition through the selection
  let requisitionTitle = 'Procurement Request';
  const contract = allContracts.find(c => c.vendorCompanyId === notification.vendorCompanyId);
  if (contract) {
    const requisition = allRequisitions.find(r => r.id === contract.requisitionId);
    if (requisition) requisitionTitle = requisition.title;
  }

  allEmailLogs.push({
    id: emailLogId++,
    recipientEmail: vendor.email,
    recipientId: vendor.userId,
    subject: notification.notificationType === 'SELECTION_WON'
      ? `Congratulations! You've been selected: ${requisitionTitle}`
      : `Vendor Selection Update: ${requisitionTitle}`,
    emailType: notification.notificationType === 'SELECTION_WON' ? 'selection_won' : 'selection_lost',
    status: 'sent',
    contractId: null,
    requisitionId: contract?.requisitionId || null,
    metadata: {
      vendorCompanyName: vendorCompany?.companyName,
      notificationType: notification.notificationType,
      selectionId: notification.selectionId,
      bidId: notification.bidId,
    },
    errorMessage: null,
    retryCount: 0,
    messageId: generateUniqueToken(),
    sentAt: notification.sentAt,
    createdAt: notification.sentAt,
  });
});

// 5. PO Created emails
allPurchaseOrders.forEach(po => {
  const vendor = getVendorEmailByCompany(po.vendorCompanyId);
  const vendorCompany = vendorCompanies.find(v => v.id === po.vendorCompanyId);
  const requisition = allRequisitions.find(r => r.id === po.requisitionId);

  allEmailLogs.push({
    id: emailLogId++,
    recipientEmail: vendor.email,
    recipientId: vendor.userId,
    subject: `Purchase Order Created: ${po.poNumber}`,
    emailType: 'po_created',
    status: 'sent',
    contractId: null,
    requisitionId: po.requisitionId,
    metadata: {
      poNumber: po.poNumber,
      totalAmount: po.totalAmount,
      paymentTerms: po.paymentTerms,
      deliveryDate: po.deliveryDate,
      vendorCompanyName: vendorCompany?.companyName,
      rfqId: requisition?.rfqId,
    },
    errorMessage: null,
    retryCount: 0,
    messageId: generateUniqueToken(),
    sentAt: po.sentAt || daysFromDate(new Date(po.createdAt), 0.5),
    createdAt: new Date(po.createdAt),
  });
});

// 6. Escalation emails (for escalated deals)
import { allChatbotDeals } from './contracts.js';

allChatbotDeals
  .filter(d => d.status === 'ESCALATED')
  .forEach(deal => {
    const requisition = allRequisitions.find(r => r.id === deal.requisitionId);
    if (!requisition) return;

    const procUser = getProcurementEmailByCompany(requisition.companyId);
    const contract = allContracts.find(c => c.chatbotDealId === deal.id);
    const vendorCompany = contract ? vendorCompanies.find(v => v.id === contract.vendorCompanyId) : null;

    allEmailLogs.push({
      id: emailLogId++,
      recipientEmail: procUser.email,
      recipientId: procUser.userId,
      subject: `Escalation Required: ${deal.title}`,
      emailType: 'escalation',
      status: 'sent',
      contractId: contract?.id || null,
      requisitionId: deal.requisitionId,
      metadata: {
        dealId: deal.id,
        dealTitle: deal.title,
        vendorCompanyName: vendorCompany?.companyName,
        currentRound: deal.round,
        chatbotLink: `/conversation/deals/${deal.id}`,
      },
      errorMessage: null,
      retryCount: 0,
      messageId: generateUniqueToken(),
      sentAt: daysFromDate(new Date(deal.createdAt), deal.round),
      createdAt: daysFromDate(new Date(deal.createdAt), deal.round),
    });
  });

// 7. Deadline Reminder emails (for active negotiations nearing deadline)
allRequisitions
  .filter(r => r.status === 'NegotiationStarted')
  .slice(0, 5) // Add reminder emails for first 5 active requisitions
  .forEach(requisition => {
    const procUser = getProcurementEmailByCompany(requisition.companyId);

    allEmailLogs.push({
      id: emailLogId++,
      recipientEmail: procUser.email,
      recipientId: procUser.userId,
      subject: `Deadline Reminder: ${requisition.title} - 3 Days Remaining`,
      emailType: 'deadline_reminder',
      status: 'sent',
      contractId: null,
      requisitionId: requisition.id,
      metadata: {
        rfqId: requisition.rfqId,
        deadline: requisition.negotiationClosureDate,
        daysRemaining: 3,
        activeVendorCount: requisition.vendors.length,
      },
      errorMessage: null,
      retryCount: 0,
      messageId: generateUniqueToken(),
      sentAt: daysFromNow(-3),
      createdAt: daysFromNow(-3),
    });
  });

// Add a few failed emails for realistic testing
const failedEmailCount = Math.min(3, Math.floor(allEmailLogs.length * 0.05));
for (let i = 0; i < failedEmailCount; i++) {
  const randomIndex = Math.floor(Math.random() * allEmailLogs.length);
  const failedLog = { ...allEmailLogs[randomIndex] };
  failedLog.id = emailLogId++;
  failedLog.status = 'failed';
  failedLog.errorMessage = ['SMTP connection timeout', 'Invalid recipient address', 'Mailbox full'][i % 3];
  failedLog.retryCount = 3;
  failedLog.createdAt = daysFromNow(-Math.floor(Math.random() * 30));
  failedLog.sentAt = failedLog.createdAt;
  allEmailLogs.push(failedLog);
}

// Helper functions
export const getEmailLogById = (id: number): EmailLogData | undefined =>
  allEmailLogs.find(e => e.id === id);

export const getEmailLogsByRecipient = (email: string): EmailLogData[] =>
  allEmailLogs.filter(e => e.recipientEmail === email);

export const getEmailLogsByType = (emailType: EmailLogData['emailType']): EmailLogData[] =>
  allEmailLogs.filter(e => e.emailType === emailType);

export const getEmailLogsByStatus = (status: EmailLogData['status']): EmailLogData[] =>
  allEmailLogs.filter(e => e.status === status);

export const getEmailLogsByContract = (contractId: number): EmailLogData[] =>
  allEmailLogs.filter(e => e.contractId === contractId);

export const getEmailLogsByRequisition = (requisitionId: number): EmailLogData[] =>
  allEmailLogs.filter(e => e.requisitionId === requisitionId);

export const getSentEmails = (): EmailLogData[] =>
  allEmailLogs.filter(e => e.status === 'sent');

export const getFailedEmails = (): EmailLogData[] =>
  allEmailLogs.filter(e => e.status === 'failed');

export const getEmailsByDateRange = (startDate: Date, endDate: Date): EmailLogData[] =>
  allEmailLogs.filter(e => {
    const sentAt = new Date(e.sentAt);
    return sentAt >= startDate && sentAt <= endDate;
  });

// Summary stats
export const getEmailStats = () => ({
  total: allEmailLogs.length,
  sent: allEmailLogs.filter(e => e.status === 'sent').length,
  failed: allEmailLogs.filter(e => e.status === 'failed').length,
  byType: {
    vendor_attached: getEmailLogsByType('vendor_attached').length,
    status_change: getEmailLogsByType('status_change').length,
    comparison_ready: getEmailLogsByType('comparison_ready').length,
    selection_won: getEmailLogsByType('selection_won').length,
    selection_lost: getEmailLogsByType('selection_lost').length,
    po_created: getEmailLogsByType('po_created').length,
    escalation: getEmailLogsByType('escalation').length,
    deadline_reminder: getEmailLogsByType('deadline_reminder').length,
  },
});
