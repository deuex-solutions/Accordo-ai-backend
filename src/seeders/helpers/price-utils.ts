/**
 * Price and scoring utility functions for seed data generation
 */

/**
 * Generate a random price within a range
 */
export function randomPrice(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

/**
 * Generate vendor offer based on target price
 * Vendors typically offer 10-30% above target
 */
export function generateVendorOffer(targetPrice: number, aggressiveness: 'low' | 'medium' | 'high' = 'medium'): number {
  const multipliers = {
    low: { min: 1.05, max: 1.15 },    // 5-15% above target
    medium: { min: 1.10, max: 1.25 }, // 10-25% above target
    high: { min: 1.20, max: 1.35 },   // 20-35% above target
  };

  const { min, max } = multipliers[aggressiveness];
  return Math.round(targetPrice * (min + Math.random() * (max - min)) * 100) / 100;
}

/**
 * Calculate weighted score for a vendor bid
 */
export interface ScoringWeights {
  price: number;
  delivery: number;
  paymentTerms: number;
  vendorRating: number;
  pastPerformance: number;
  qualityCertifications: number;
}

export interface BidData {
  price: number;
  targetPrice: number;
  deliveryDays: number;
  targetDeliveryDays: number;
  paymentTermsDays: number;
  vendorRating: number;
  pastPerformance: number; // 0-100%
  hasCertifications: boolean;
}

export function calculateBidScore(bid: BidData, weights: ScoringWeights): number {
  // Normalize each factor to 0-100 scale

  // Price score: lower is better (100 if at or below target, decreasing for higher prices)
  const priceRatio = bid.price / bid.targetPrice;
  const priceScore = Math.max(0, 100 - (priceRatio - 1) * 200); // -2 points per 1% above target

  // Delivery score: faster is better
  const deliveryRatio = bid.deliveryDays / bid.targetDeliveryDays;
  const deliveryScore = Math.max(0, Math.min(100, 100 - (deliveryRatio - 1) * 100));

  // Payment terms score: longer terms are better for buyer (Net 60 > Net 30)
  const termsScore = Math.min(100, bid.paymentTermsDays / 60 * 100);

  // Vendor rating score: direct 1-5 to 0-100
  const ratingScore = (bid.vendorRating / 5) * 100;

  // Past performance: direct percentage
  const performanceScore = bid.pastPerformance;

  // Certifications: binary
  const certScore = bid.hasCertifications ? 100 : 50;

  // Calculate weighted total
  const totalWeight = weights.price + weights.delivery + weights.paymentTerms +
    weights.vendorRating + weights.pastPerformance + weights.qualityCertifications;

  const weightedScore = (
    (priceScore * weights.price) +
    (deliveryScore * weights.delivery) +
    (termsScore * weights.paymentTerms) +
    (ratingScore * weights.vendorRating) +
    (performanceScore * weights.pastPerformance) +
    (certScore * weights.qualityCertifications)
  ) / totalWeight;

  return Math.round(weightedScore * 10) / 10;
}

/**
 * Default scoring weights
 */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  price: 35,
  delivery: 20,
  paymentTerms: 15,
  vendorRating: 15,
  pastPerformance: 10,
  qualityCertifications: 5,
};

/**
 * Generate L1/L2/L3 ranking from vendor bids
 */
export interface RankedBid {
  vendorId: number;
  price: number;
  score: number;
  rank: 'L1' | 'L2' | 'L3' | null;
}

export function rankVendorBids(bids: Array<{ vendorId: number; price: number; score: number }>): RankedBid[] {
  // Sort by price ascending (lowest first)
  const sorted = [...bids].sort((a, b) => a.price - b.price);

  return sorted.map((bid, index) => ({
    ...bid,
    rank: index === 0 ? 'L1' : index === 1 ? 'L2' : index === 2 ? 'L3' : null,
  }));
}

/**
 * Calculate utility score (0-1) for negotiation
 */
export function calculateUtilityScore(
  offeredPrice: number,
  targetPrice: number,
  maxPrice: number
): number {
  if (offeredPrice <= targetPrice) return 1.0;
  if (offeredPrice >= maxPrice) return 0.0;

  const range = maxPrice - targetPrice;
  const excess = offeredPrice - targetPrice;
  return Math.round((1 - (excess / range)) * 100) / 100;
}

/**
 * Generate payment terms days from string
 */
export function paymentTermsToDays(terms: string): number {
  const match = terms.match(/Net\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : 30;
}
