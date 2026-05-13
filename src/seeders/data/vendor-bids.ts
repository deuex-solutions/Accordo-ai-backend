/**
 * Vendor Bids and Comparisons seed data
 * L1/L2/L3 = Lowest 3 vendor offers ranked by total RFQ value
 * Includes various scenarios: clear winner, close competition, trade-offs
 */

import { generateUUID } from '../helpers/id-generator.js';
import { daysFromDate, daysFromNow } from '../helpers/date-utils.js';
import { calculateBidScore, rankVendorBids, DEFAULT_SCORING_WEIGHTS, type ScoringWeights, type BidData } from '../helpers/price-utils.js';
import { allRequisitions, type RequisitionData } from './requisitions.js';
import { allChatbotDeals, allContracts, type ChatbotDealData, type ContractData } from './contracts.js';
import { getLastMessage, getVendorOffers } from './chat-messages.js';
import { getVendorRating, vendorCompanies } from './companies.js';

export interface VendorBidData {
  id: string;
  requisitionId: number;
  contractId: number;
  dealId: string;
  vendorCompanyId: number;
  vendorUserId: number;
  finalPrice: number;
  unitPrice: number;
  paymentTerms: string;
  deliveryDays: number;
  utilityScore: number;
  bidStatus: 'PENDING' | 'COMPLETED' | 'EXCLUDED' | 'SELECTED' | 'REJECTED';
  dealStatus: 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';
  chatSummaryMetrics: {
    totalRounds: number;
    startPrice: number;
    finalPrice: number;
    priceReduction: number;
    negotiationDays: number;
  };
  chatSummaryNarrative: string;
  rank: 'L1' | 'L2' | 'L3' | null;
  score: number;
  createdAt: Date;
}

export interface BidComparisonData {
  id: string;
  requisitionId: number;
  triggeredBy: 'ALL_COMPLETED' | 'DEADLINE_REACHED' | 'MANUAL';
  totalVendors: number;
  completedVendors: number;
  excludedVendors: number;
  topBids: Array<{
    rank: 'L1' | 'L2' | 'L3';
    vendorCompanyId: number;
    vendorName: string;
    finalPrice: number;
    score: number;
    paymentTerms: string;
    deliveryDays: number;
  }>;
  generatedAt: Date;
  pdfUrl: string | null;
}

// Narrative templates for different outcomes
const acceptedNarratives = [
  "Successful negotiation concluded after {rounds} rounds. Started at ${startPrice}, achieved ${finalPrice} ({reduction}% reduction). Vendor showed flexibility on price and delivery terms.",
  "Deal accepted following productive discussions over {rounds} rounds. Price negotiated from ${startPrice} to ${finalPrice}. Payment terms aligned with requirements.",
  "Negotiation completed successfully. Vendor agreed to ${finalPrice} (down from ${startPrice}) with favorable delivery timeline of {deliveryDays} days.",
];

const walkedAwayNarratives = [
  "Negotiation terminated after {rounds} rounds. Vendor's final offer of ${finalPrice} exceeded acceptable threshold. Started at ${startPrice}, insufficient movement.",
  "Unable to reach agreement after {rounds} rounds of negotiation. Price gap remained significant at ${finalPrice} vs target.",
  "Vendor walked away from negotiations. Final position of ${finalPrice} did not meet minimum requirements.",
];

const escalatedNarratives = [
  "Negotiation escalated for human review after {rounds} rounds. Current offer stands at ${finalPrice}. Complex terms require senior decision.",
  "Deal escalated to procurement team after extended negotiations. Price at ${finalPrice}, but non-price factors need human assessment.",
  "Escalation triggered after {rounds} rounds. Vendor offer of ${finalPrice} with {paymentTerms} payment terms requires management approval.",
];

const negotiatingNarratives = [
  "Active negotiation in progress. Currently at round {rounds}. Latest offer: ${finalPrice}. Discussions ongoing.",
  "Negotiation continuing with positive momentum. Current position: ${finalPrice}, trending towards target.",
  "Vendor engaged in active discussions. {rounds} rounds completed, working towards mutually acceptable terms.",
];

// Helper to fill template
function fillNarrativeTemplate(template: string, values: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

// Generate vendor bids from completed deals
export const allVendorBids: VendorBidData[] = [];

// Process deals to create bids
allChatbotDeals.forEach(deal => {
  const contract = allContracts.find(c => c.id === deal.contractId);
  if (!contract) return;

  const requisition = allRequisitions.find(r => r.id === deal.requisitionId);
  if (!requisition) return;

  // Get final offer from chat messages
  const vendorOffers = getVendorOffers(deal.id);
  const lastOffer = vendorOffers[vendorOffers.length - 1];

  // Calculate prices
  const config = deal.negotiationConfigJson;
  const startPrice = config.targetPrice * (1.15 + Math.random() * 0.15);
  let finalPrice: number;
  let unitPrice: number;
  let paymentTerms: string;
  let deliveryDays: number;

  if (lastOffer?.extractedOffer) {
    finalPrice = lastOffer.extractedOffer.price;
    paymentTerms = lastOffer.extractedOffer.paymentTerms;
    deliveryDays = lastOffer.extractedOffer.deliveryDays;
  } else {
    // Generate reasonable final values based on status
    if (deal.status === 'ACCEPTED') {
      finalPrice = config.targetPrice * (1 + Math.random() * 0.1); // 0-10% above target
    } else if (deal.status === 'WALKED_AWAY') {
      finalPrice = config.targetPrice * (1.15 + Math.random() * 0.1); // 15-25% above
    } else {
      finalPrice = config.targetPrice * (1.05 + Math.random() * 0.15); // 5-20% above
    }
    paymentTerms = `Net ${[30, 45, 60][Math.floor(Math.random() * 3)]}`;
    deliveryDays = 14 + Math.floor(Math.random() * 28);
  }

  // Calculate unit price from total
  const totalQuantity = requisition.products.reduce((sum, p) => sum + p.quantity, 0);
  unitPrice = finalPrice / totalQuantity;

  // Calculate score using the 6-factor scoring system
  const vendorRating = getVendorRating(contract.vendorCompanyId);
  const bidData: BidData = {
    price: finalPrice,
    targetPrice: config.targetPrice,
    deliveryDays,
    targetDeliveryDays: config.targetDeliveryDays,
    paymentTermsDays: parseInt(paymentTerms.replace('Net ', ''), 10) || 30,
    vendorRating,
    pastPerformance: config.pastPerformance,
    hasCertifications: config.hasCertifications,
  };

  const score = calculateBidScore(bidData, requisition.scoringWeights);

  // Calculate utility score
  const utilityScore = Math.max(0, Math.min(1,
    1 - (finalPrice - config.targetPrice) / (config.maxAcceptablePrice - config.targetPrice)
  ));

  // Generate narrative
  const priceReduction = Math.round((1 - finalPrice / startPrice) * 100);
  const narrativeValues = {
    rounds: deal.round,
    startPrice: Math.round(startPrice).toLocaleString(),
    finalPrice: Math.round(finalPrice).toLocaleString(),
    reduction: Math.abs(priceReduction),
    deliveryDays,
    paymentTerms,
  };

  let narrative: string;
  let narrativeTemplates: string[];

  switch (deal.status) {
    case 'ACCEPTED':
      narrativeTemplates = acceptedNarratives;
      break;
    case 'WALKED_AWAY':
      narrativeTemplates = walkedAwayNarratives;
      break;
    case 'ESCALATED':
      narrativeTemplates = escalatedNarratives;
      break;
    default:
      narrativeTemplates = negotiatingNarratives;
  }

  narrative = fillNarrativeTemplate(
    narrativeTemplates[Math.floor(Math.random() * narrativeTemplates.length)],
    narrativeValues
  );

  // Determine bid status
  let bidStatus: VendorBidData['bidStatus'];
  if (deal.status === 'NEGOTIATING') {
    bidStatus = 'PENDING';
  } else if (deal.status === 'WALKED_AWAY') {
    bidStatus = 'EXCLUDED';
  } else if (deal.status === 'ACCEPTED') {
    bidStatus = 'COMPLETED';
  } else {
    bidStatus = 'PENDING'; // Escalated still pending
  }

  allVendorBids.push({
    id: generateUUID(),
    requisitionId: requisition.id,
    contractId: contract.id,
    dealId: deal.id,
    vendorCompanyId: contract.vendorCompanyId,
    vendorUserId: contract.vendorUserId,
    finalPrice: Math.round(finalPrice * 100) / 100,
    unitPrice: Math.round(unitPrice * 100) / 100,
    paymentTerms,
    deliveryDays,
    utilityScore: Math.round(utilityScore * 100) / 100,
    bidStatus,
    dealStatus: deal.status,
    chatSummaryMetrics: {
      totalRounds: deal.round,
      startPrice: Math.round(startPrice * 100) / 100,
      finalPrice: Math.round(finalPrice * 100) / 100,
      priceReduction,
      negotiationDays: Math.ceil(deal.round / 2),
    },
    chatSummaryNarrative: narrative,
    rank: null, // Will be set during comparison
    score: Math.round(score * 10) / 10,
    createdAt: new Date(deal.createdAt),
  });
});

// Generate comparisons for completed requisitions
export const allBidComparisons: BidComparisonData[] = [];

// Group bids by requisition
const bidsByRequisition = new Map<number, VendorBidData[]>();
allVendorBids.forEach(bid => {
  const existing = bidsByRequisition.get(bid.requisitionId) || [];
  existing.push(bid);
  bidsByRequisition.set(bid.requisitionId, existing);
});

// Create comparisons for requisitions with completed vendors
bidsByRequisition.forEach((bids, requisitionId) => {
  const requisition = allRequisitions.find(r => r.id === requisitionId);
  if (!requisition) return;

  // Only create comparisons for requisitions that are awarded or have completed bids
  if (requisition.status !== 'Awarded' && requisition.status !== 'NegotiationStarted') return;

  const completedBids = bids.filter(b => b.bidStatus === 'COMPLETED' || b.bidStatus === 'PENDING');
  const excludedBids = bids.filter(b => b.bidStatus === 'EXCLUDED');

  if (completedBids.length === 0) return;

  // Rank bids by price (L1 = lowest price)
  const rankedBids = rankVendorBids(
    completedBids.map(b => ({
      vendorId: b.vendorCompanyId,
      price: b.finalPrice,
      score: b.score,
    }))
  );

  // Update bid ranks
  rankedBids.forEach(ranked => {
    const bid = completedBids.find(b => b.vendorCompanyId === ranked.vendorId);
    if (bid && ranked.rank) {
      bid.rank = ranked.rank;
    }
  });

  // Build top bids array
  const topBids = rankedBids
    .filter(r => r.rank !== null)
    .map(ranked => {
      const bid = completedBids.find(b => b.vendorCompanyId === ranked.vendorId)!;
      const vendor = vendorCompanies.find(v => v.id === ranked.vendorId);
      return {
        rank: ranked.rank!,
        vendorCompanyId: ranked.vendorId,
        vendorName: vendor?.companyName || 'Unknown Vendor',
        finalPrice: bid.finalPrice,
        score: bid.score,
        paymentTerms: bid.paymentTerms,
        deliveryDays: bid.deliveryDays,
      };
    });

  allBidComparisons.push({
    id: generateUUID(),
    requisitionId,
    triggeredBy: requisition.status === 'Awarded' ? 'ALL_COMPLETED' : 'DEADLINE_REACHED',
    totalVendors: requisition.vendors.length,
    completedVendors: completedBids.length,
    excludedVendors: excludedBids.length,
    topBids,
    generatedAt: daysFromNow(-Math.floor(Math.random() * 14)),
    pdfUrl: `/uploads/pdfs/comparison_${requisitionId}.pdf`,
  });
});

// Helper functions
export const getBidById = (id: string): VendorBidData | undefined =>
  allVendorBids.find(b => b.id === id);

export const getBidsByRequisition = (requisitionId: number): VendorBidData[] =>
  allVendorBids.filter(b => b.requisitionId === requisitionId);

export const getBidsByVendor = (vendorCompanyId: number): VendorBidData[] =>
  allVendorBids.filter(b => b.vendorCompanyId === vendorCompanyId);

export const getBidsByStatus = (status: VendorBidData['bidStatus']): VendorBidData[] =>
  allVendorBids.filter(b => b.bidStatus === status);

export const getBidsByRank = (rank: 'L1' | 'L2' | 'L3'): VendorBidData[] =>
  allVendorBids.filter(b => b.rank === rank);

export const getL1Bids = (): VendorBidData[] => getBidsByRank('L1');
export const getL2Bids = (): VendorBidData[] => getBidsByRank('L2');
export const getL3Bids = (): VendorBidData[] => getBidsByRank('L3');

export const getCompletedBids = (): VendorBidData[] =>
  allVendorBids.filter(b => b.bidStatus === 'COMPLETED');

export const getExcludedBids = (): VendorBidData[] =>
  allVendorBids.filter(b => b.bidStatus === 'EXCLUDED');

// Comparison helpers
export const getComparisonById = (id: string): BidComparisonData | undefined =>
  allBidComparisons.find(c => c.id === id);

export const getComparisonByRequisition = (requisitionId: number): BidComparisonData | undefined =>
  allBidComparisons.find(c => c.requisitionId === requisitionId);

export const getComparisonsWithMultipleBids = (): BidComparisonData[] =>
  allBidComparisons.filter(c => c.topBids.length >= 2);

export const getComparisonsWithCloseCompetition = (maxScoreDiff: number = 5): BidComparisonData[] =>
  allBidComparisons.filter(c => {
    if (c.topBids.length < 2) return false;
    const scoreDiff = Math.abs(c.topBids[0].score - c.topBids[1].score);
    return scoreDiff <= maxScoreDiff;
  });

// Get bids for a specific scenario
export const getClearWinnerScenarios = (): BidComparisonData[] =>
  allBidComparisons.filter(c => {
    if (c.topBids.length < 2) return true; // Single bid is always clear winner
    const priceDiff = (c.topBids[1].finalPrice - c.topBids[0].finalPrice) / c.topBids[0].finalPrice;
    return priceDiff > 0.1; // More than 10% price difference
  });

export const getTradeOffScenarios = (): BidComparisonData[] =>
  allBidComparisons.filter(c => {
    if (c.topBids.length < 2) return false;
    // L1 has best price but L2 has better score (due to other factors)
    return c.topBids[0].score < c.topBids[1].score;
  });
