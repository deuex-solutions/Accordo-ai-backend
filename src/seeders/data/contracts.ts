/**
 * Contracts and Chatbot Deals seed data
 * One contract per vendor-requisition pair
 * Chatbot deals for requisitions in 'NegotiationStarted' status
 */

import { daysFromNow, daysFromDate } from '../helpers/date-utils.js';
import { generateUUID } from '../helpers/id-generator.js';
import { allRequisitions, type RequisitionData } from './requisitions.js';
import { vendorCompanies, getVendorRating } from './companies.js';
import { vendorUsers, getProcurementUsers } from './users.js';
import { getProductById } from './products.js';

export interface ContractData {
  id: number;
  requisitionId: number;
  vendorCompanyId: number;
  vendorUserId: number;
  status: 'Draft' | 'Sent' | 'Opened' | 'InNegotiation' | 'Accepted' | 'Rejected' | 'Expired';
  chatbotDealId: string | null;
  createdAt: Date;
  sentAt: Date | null;
  openedAt: Date | null;
}

export interface ChatbotDealData {
  id: string; // UUID
  title: string;
  requisitionId: number;
  vendorId: number; // Vendor user ID
  contractId: number;
  mode: 'CONVERSATION' | 'INSIGHTS';
  status: 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';
  round: number;
  createdById: number;
  negotiationConfigJson: NegotiationConfigData;
  createdAt: Date;
}

export interface NegotiationConfigData {
  // Price parameters
  targetPrice: number;
  maxAcceptablePrice: number;
  anchorPrice: number;
  // Delivery parameters
  targetDeliveryDays: number;
  maxDeliveryDays: number;
  // Payment parameters
  targetPaymentDays: number;
  minPaymentDays: number;
  // Negotiation control
  maxRounds: number;
  walkawayThreshold: number; // utility score below this = walk away
  escalationThreshold: number; // rounds at which to escalate
  // Weights
  scoringWeights: {
    price: number;
    delivery: number;
    paymentTerms: number;
    vendorRating: number;
    pastPerformance: number;
    qualityCertifications: number;
  };
  // Vendor context
  vendorRating: number;
  pastPerformance: number;
  hasCertifications: boolean;
}

// Get vendor user ID by company ID
function getVendorUserIdByCompany(companyId: number): number {
  const vendorUser = vendorUsers.find(u => u.companyId === companyId && u.role === 'Sales Representative');
  return vendorUser?.id || vendorUsers[0].id;
}

// Generate negotiation config based on requisition
function generateNegotiationConfig(
  requisition: RequisitionData,
  vendorCompanyId: number
): NegotiationConfigData {
  // Calculate total value from products
  const totalTargetPrice = requisition.products.reduce(
    (sum, p) => sum + p.targetUnitPrice * p.quantity,
    0
  );

  const vendorRating = getVendorRating(vendorCompanyId);

  return {
    targetPrice: totalTargetPrice,
    maxAcceptablePrice: totalTargetPrice * 1.2, // 20% above target
    anchorPrice: totalTargetPrice * 0.85, // Start 15% below target
    targetDeliveryDays: 21,
    maxDeliveryDays: 45,
    targetPaymentDays: 45,
    minPaymentDays: 30,
    maxRounds: 10,
    walkawayThreshold: 0.4, // Walk away if utility < 40%
    escalationThreshold: 7, // Escalate after round 7
    scoringWeights: requisition.scoringWeights,
    vendorRating,
    pastPerformance: 75 + Math.random() * 20, // 75-95%
    hasCertifications: Math.random() > 0.3, // 70% have certifications
  };
}

// Deal status distribution for active negotiations
const dealStatusDistribution: ChatbotDealData['status'][] = [
  'NEGOTIATING', 'NEGOTIATING', 'NEGOTIATING', 'NEGOTIATING', 'NEGOTIATING',
  'NEGOTIATING', 'NEGOTIATING', 'NEGOTIATING', // 8 negotiating
  'ACCEPTED', 'ACCEPTED', 'ACCEPTED', // 3 accepted
  'WALKED_AWAY', 'WALKED_AWAY', // 2 walked away
  'ESCALATED', // 1 escalated
];

// Contract status mapping based on deal status
function getContractStatusFromDealStatus(dealStatus: ChatbotDealData['status']): ContractData['status'] {
  switch (dealStatus) {
    case 'NEGOTIATING': return 'InNegotiation';
    case 'ACCEPTED': return 'Accepted';
    case 'WALKED_AWAY': return 'Rejected';
    case 'ESCALATED': return 'InNegotiation';
    default: return 'InNegotiation';
  }
}

// Generate all contracts and deals
export const allContracts: ContractData[] = [];
export const allChatbotDeals: ChatbotDealData[] = [];

let contractId = 1;
let dealStatusIndex = 0;

// Process each requisition
allRequisitions.forEach(requisition => {
  const createdDate = new Date(requisition.createdAt);

  requisition.vendors.forEach(vendor => {
    const vendorUserId = getVendorUserIdByCompany(vendor.vendorCompanyId);
    const vendorCompany = vendorCompanies.find(c => c.id === vendor.vendorCompanyId);

    // Determine if this contract should have a chatbot deal
    const shouldHaveDeal = requisition.status === 'NegotiationStarted' ||
                           requisition.status === 'Awarded';

    let chatbotDealId: string | null = null;
    let contractStatus: ContractData['status'];

    if (shouldHaveDeal) {
      // Generate chatbot deal
      const dealId = generateUUID();
      chatbotDealId = dealId;

      // Get deal status (cycle through distribution)
      const dealStatus = requisition.status === 'Awarded'
        ? 'ACCEPTED'
        : dealStatusDistribution[dealStatusIndex % dealStatusDistribution.length];
      dealStatusIndex++;

      contractStatus = getContractStatusFromDealStatus(dealStatus);

      // Calculate round based on status
      let round: number;
      if (dealStatus === 'NEGOTIATING') {
        round = Math.floor(Math.random() * 6) + 1; // 1-6 rounds
      } else if (dealStatus === 'ACCEPTED') {
        round = Math.floor(Math.random() * 5) + 3; // 3-7 rounds to accept
      } else if (dealStatus === 'WALKED_AWAY') {
        round = Math.floor(Math.random() * 4) + 5; // 5-8 rounds before walk away
      } else {
        round = Math.floor(Math.random() * 3) + 7; // 7-9 rounds before escalation
      }

      // Build deal title
      const projectName = requisition.title.split(' - ')[0];
      const dealTitle = `${projectName} - ${vendorCompany?.companyName || 'Vendor'}`;

      allChatbotDeals.push({
        id: dealId,
        title: dealTitle,
        requisitionId: requisition.id,
        vendorId: vendorUserId,
        contractId,
        mode: 'CONVERSATION', // All deals use CONVERSATION mode per user requirement
        status: dealStatus,
        round,
        createdById: requisition.createdById,
        negotiationConfigJson: generateNegotiationConfig(requisition, vendor.vendorCompanyId),
        createdAt: daysFromDate(createdDate, 1),
      });
    } else {
      // No deal - draft requisition
      contractStatus = requisition.status === 'Draft' ? 'Draft' : 'Sent';
    }

    // Create contract
    const sentAt = contractStatus !== 'Draft' ? daysFromDate(createdDate, 1) : null;
    const openedAt = ['InNegotiation', 'Accepted', 'Rejected'].includes(contractStatus)
      ? daysFromDate(createdDate, 2)
      : null;

    allContracts.push({
      id: contractId,
      requisitionId: requisition.id,
      vendorCompanyId: vendor.vendorCompanyId,
      vendorUserId,
      status: contractStatus,
      chatbotDealId,
      createdAt: createdDate,
      sentAt,
      openedAt,
    });

    contractId++;
  });
});

// Helper functions
export const getContractById = (id: number): ContractData | undefined =>
  allContracts.find(c => c.id === id);

export const getContractsByRequisition = (requisitionId: number): ContractData[] =>
  allContracts.filter(c => c.requisitionId === requisitionId);

export const getContractsByVendor = (vendorCompanyId: number): ContractData[] =>
  allContracts.filter(c => c.vendorCompanyId === vendorCompanyId);

export const getContractsByStatus = (status: ContractData['status']): ContractData[] =>
  allContracts.filter(c => c.status === status);

export const getContractsWithDeals = (): ContractData[] =>
  allContracts.filter(c => c.chatbotDealId !== null);

// Chatbot deal helpers
export const getDealById = (id: string): ChatbotDealData | undefined =>
  allChatbotDeals.find(d => d.id === id);

export const getDealsByStatus = (status: ChatbotDealData['status']): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.status === status);

export const getDealsByRequisition = (requisitionId: number): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.requisitionId === requisitionId);

export const getDealsByVendor = (vendorId: number): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.vendorId === vendorId);

export const getActiveDeals = (): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.status === 'NEGOTIATING');

export const getCompletedDeals = (): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.status === 'ACCEPTED' || d.status === 'WALKED_AWAY');

export const getEscalatedDeals = (): ChatbotDealData[] =>
  allChatbotDeals.filter(d => d.status === 'ESCALATED');

// Get deal with contract info
export const getDealWithContract = (dealId: string): { deal: ChatbotDealData; contract: ContractData } | undefined => {
  const deal = getDealById(dealId);
  if (!deal) return undefined;
  const contract = getContractById(deal.contractId);
  if (!contract) return undefined;
  return { deal, contract };
};
