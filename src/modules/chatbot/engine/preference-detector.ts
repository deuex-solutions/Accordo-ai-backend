/**
 * Vendor Preference Detector Module
 *
 * Detects whether vendor is price-focused or terms-focused based on:
 * 1. Keyword analysis in messages
 * 2. Concession patterns (what they're more willing to move on)
 *
 * Used by the dynamic counter-offer engine to:
 * - Concede on factors the vendor cares less about
 * - Push harder on factors the vendor seems flexible on
 *
 * @module preferenceDetector
 */

import type { Offer, AccumulatedOffer } from './types.js';
import type {
  NegotiationState,
  VendorEmphasis,
  ConcessionRecord,
  PmCounterRecord,
  DetectedKeywords,
} from './types.js';
import { createEmptyNegotiationState, extractPaymentDays } from './types.js';

// ============================================
// KEYWORD PATTERNS
// ============================================

/**
 * Keywords indicating vendor is price-focused
 */
const PRICE_KEYWORDS = [
  'budget',
  'cost',
  'costs',
  'expensive',
  'cheap',
  'cheaper',
  'discount',
  'price',
  'pricing',
  'afford',
  'affordable',
  'rate',
  'rates',
  'dollars',
  'margin',
  'margins',
  'profit',
  'bottom line',
  'reduce',
  'reduction',
  'lower',
  'lowest',
  'best price',
  'competitive',
  'value',
  'savings',
  '$',
];

/**
 * Keywords indicating vendor is terms-focused
 */
const TERMS_KEYWORDS = [
  'cash flow',
  'cashflow',
  'payment',
  'payments',
  'net',
  'credit',
  'days',
  'invoice',
  'invoicing',
  'billing',
  'receivables',
  'due',
  'duration',
  'timing',
  'terms',
  'upfront',
  'advance',
  'installment',
  'flexible',
  'flexibility',
  'pay later',
  'extended',
  'extension',
];

// ============================================
// KEYWORD ANALYSIS
// ============================================

/**
 * Analyze message content for price and terms keywords
 *
 * @param content - Message content to analyze
 * @returns Object with detected price and terms keywords
 *
 * @example
 * ```typescript
 * const result = analyzeMessageKeywords("The price is too high for our budget");
 * // result = { priceKeywords: ['price', 'budget'], termsKeywords: [] }
 * ```
 */
export function analyzeMessageKeywords(content: string): DetectedKeywords {
  const lowerContent = content.toLowerCase();

  const priceKeywords = PRICE_KEYWORDS.filter((kw) =>
    lowerContent.includes(kw.toLowerCase())
  );

  const termsKeywords = TERMS_KEYWORDS.filter((kw) =>
    lowerContent.includes(kw.toLowerCase())
  );

  return { priceKeywords, termsKeywords };
}

/**
 * Merge detected keywords from multiple messages
 *
 * @param existing - Existing detected keywords
 * @param newKeywords - New keywords to merge
 * @returns Merged keywords (deduplicated)
 */
export function mergeKeywords(
  existing: DetectedKeywords,
  newKeywords: DetectedKeywords
): DetectedKeywords {
  return {
    priceKeywords: [...new Set([...(existing?.priceKeywords ?? []), ...(newKeywords?.priceKeywords ?? [])])],
    termsKeywords: [...new Set([...(existing?.termsKeywords ?? []), ...(newKeywords?.termsKeywords ?? [])])],
  };
}

// ============================================
// CONCESSION CALCULATION
// ============================================

/**
 * Calculate a concession record for price
 *
 * @param previousPrice - Previous vendor offer price
 * @param currentPrice - Current vendor offer price
 * @param pmTarget - PM's target price
 * @param pmMax - PM's max acceptable price
 * @param round - Current negotiation round
 * @returns Concession record or null if no concession
 */
export function calculatePriceConcession(
  previousPrice: number,
  currentPrice: number,
  pmTarget: number,
  pmMax: number,
  round: number
): ConcessionRecord | null {
  // No concession if price went up (away from PM's target)
  if (currentPrice >= previousPrice) return null;

  const change = previousPrice - currentPrice; // Positive = vendor dropped price
  const range = pmMax - pmTarget;
  const changePercent = range > 0 ? (change / range) * 100 : 0;

  return {
    round,
    previousValue: previousPrice,
    newValue: currentPrice,
    change,
    changePercent,
    timestamp: new Date(),
  };
}

/**
 * Calculate a concession record for payment terms
 *
 * Terms concession = vendor accepting longer payment terms (better for PM)
 *
 * @param previousDays - Previous payment terms in days
 * @param currentDays - Current payment terms in days
 * @param pmMinDays - PM's minimum acceptable days
 * @param pmMaxDays - PM's preferred maximum days (e.g., 90)
 * @param round - Current negotiation round
 * @returns Concession record or null if no concession
 */
export function calculateTermsConcession(
  previousDays: number,
  currentDays: number,
  pmMinDays: number,
  pmMaxDays: number,
  round: number
): ConcessionRecord | null {
  // Concession = vendor accepting LONGER terms (better for PM)
  if (currentDays <= previousDays) return null;

  const change = currentDays - previousDays; // Positive = more days (better for PM)
  const range = pmMaxDays - pmMinDays;
  const changePercent = range > 0 ? (change / range) * 100 : 0;

  return {
    round,
    previousValue: previousDays,
    newValue: currentDays,
    change,
    changePercent,
    timestamp: new Date(),
  };
}

// ============================================
// EMPHASIS DETECTION
// ============================================

/**
 * Detect vendor's emphasis based on accumulated data
 *
 * Scoring:
 * - Keyword difference × 0.3 (minor signal)
 * - Concession pattern × 2.0 (strong signal)
 *
 * Confidence ranges:
 * - 0.5: No data (unknown)
 * - 0.6: Keywords only
 * - 0.7: Some concession data
 * - 0.8: Multiple concessions
 * - 0.9: Clear pattern
 *
 * @param state - Current negotiation state
 * @returns Object with emphasis and confidence
 */
export function detectVendorEmphasis(state: NegotiationState): {
  emphasis: VendorEmphasis;
  confidence: number;
} {
  // Defensive: ensure arrays exist
  const priceConcessions = state.priceConcessions ?? [];
  const termsConcessions = state.termsConcessions ?? [];
  const detectedKeywords = state.detectedKeywords ?? { priceKeywords: [], termsKeywords: [] };

  // Calculate keyword score
  const priceKeywordCount = detectedKeywords.priceKeywords?.length ?? 0;
  const termsKeywordCount = detectedKeywords.termsKeywords?.length ?? 0;
  const keywordDiff = priceKeywordCount - termsKeywordCount;
  const keywordScore = keywordDiff * 0.3; // Positive = price-focused

  // Calculate concession score
  // Vendor making MORE price concessions = they care LESS about price
  // So we invert: more price concessions = vendor is terms-focused
  const totalPriceConcessionPercent = priceConcessions.reduce(
    (sum, c) => sum + c.changePercent,
    0
  );
  const totalTermsConcessionPercent = termsConcessions.reduce(
    (sum, c) => sum + c.changePercent,
    0
  );

  // Positive score = vendor conceded more on terms, so they're price-focused
  // Negative score = vendor conceded more on price, so they're terms-focused
  const concessionScore = (totalTermsConcessionPercent - totalPriceConcessionPercent) * 2.0;

  // Combined score
  const combinedScore = keywordScore + concessionScore;

  // Determine emphasis
  let emphasis: VendorEmphasis;
  if (Math.abs(combinedScore) < 5) {
    emphasis = 'balanced';
  } else if (combinedScore > 0) {
    emphasis = 'price-focused';
  } else {
    emphasis = 'terms-focused';
  }

  // Calculate confidence
  let confidence = 0.5;
  const hasKeywords = priceKeywordCount > 0 || termsKeywordCount > 0;
  const hasConcessions = priceConcessions.length > 0 || termsConcessions.length > 0;
  const hasMultipleConcessions =
    priceConcessions.length > 1 || termsConcessions.length > 1;

  if (!hasKeywords && !hasConcessions) {
    emphasis = 'unknown';
    confidence = 0.5;
  } else if (hasKeywords && !hasConcessions) {
    confidence = 0.6;
  } else if (hasConcessions && !hasMultipleConcessions) {
    confidence = 0.7;
  } else if (hasMultipleConcessions) {
    confidence = Math.abs(combinedScore) > 15 ? 0.9 : 0.8;
  }

  return { emphasis, confidence };
}

// ============================================
// STATE UPDATE
// ============================================

/**
 * Update negotiation state with new data from a round
 *
 * @param state - Current negotiation state (or null for first round)
 * @param previousVendorOffer - Vendor's previous offer (or null)
 * @param currentVendorOffer - Vendor's current offer
 * @param vendorMessage - Vendor's message content
 * @param pmCounter - PM's counter-offer from this round (if any)
 * @param round - Current round number
 * @param config - Negotiation config with targets
 * @returns Updated negotiation state
 */
export function updateNegotiationState(
  state: NegotiationState | null,
  previousVendorOffer: Offer | AccumulatedOffer | null,
  currentVendorOffer: Offer | AccumulatedOffer,
  vendorMessage: string,
  pmCounter: Offer | null,
  round: number,
  config: {
    pmTargetPrice: number;
    pmMaxPrice: number;
    pmMinTermsDays: number;
    pmMaxTermsDays: number;
  }
): NegotiationState {
  // Start from existing state or create new
  // Always merge with empty state to ensure all arrays are initialized
  const emptyState = createEmptyNegotiationState();
  const current: NegotiationState = state ? {
    ...emptyState,
    ...state,
    // Ensure arrays are always defined (in case state from DB is missing them)
    priceConcessions: state.priceConcessions ?? [],
    termsConcessions: state.termsConcessions ?? [],
    pmCounterHistory: state.pmCounterHistory ?? [],
    detectedKeywords: state.detectedKeywords ?? emptyState.detectedKeywords,
  } : emptyState;

  // Update keywords from message
  const newKeywords = analyzeMessageKeywords(vendorMessage);
  current.detectedKeywords = mergeKeywords(current.detectedKeywords ?? emptyState.detectedKeywords, newKeywords);

  // Calculate price concession if we have previous offer
  if (
    previousVendorOffer != null &&
    previousVendorOffer.total_price != null &&
    currentVendorOffer.total_price != null
  ) {
    const priceConcession = calculatePriceConcession(
      previousVendorOffer.total_price,
      currentVendorOffer.total_price,
      config.pmTargetPrice,
      config.pmMaxPrice,
      round
    );
    if (priceConcession) {
      current.priceConcessions = [...current.priceConcessions, priceConcession];
    }
  }

  // Calculate terms concession if we have previous offer
  const previousTermsDays = previousVendorOffer?.payment_terms
    ? extractPaymentDays(previousVendorOffer.payment_terms)
    : null;
  const currentTermsDays = currentVendorOffer.payment_terms
    ? extractPaymentDays(currentVendorOffer.payment_terms)
    : null;

  if (previousTermsDays !== null && currentTermsDays !== null) {
    const termsConcession = calculateTermsConcession(
      previousTermsDays,
      currentTermsDays,
      config.pmMinTermsDays,
      config.pmMaxTermsDays,
      round
    );
    if (termsConcession) {
      current.termsConcessions = [...current.termsConcessions, termsConcession];
    }
  }

  // Record PM's counter-offer
  if (pmCounter) {
    const pmRecord: PmCounterRecord = {
      round,
      price: pmCounter.total_price ?? 0,
      terms: pmCounter.payment_terms ?? 'Net 30',
      deliveryDays: pmCounter.delivery_days ?? null,
      timestamp: new Date(),
    };
    current.pmCounterHistory = [...current.pmCounterHistory, pmRecord];
  }

  // Update emphasis detection
  const { emphasis, confidence } = detectVendorEmphasis(current);
  current.vendorEmphasis = emphasis;
  current.emphasisConfidence = confidence;
  current.lastUpdatedAt = new Date();

  return current;
}

/**
 * Get the last PM counter-offer from state
 */
export function getLastPmCounter(state: NegotiationState | null): PmCounterRecord | null {
  if (!state || !state.pmCounterHistory || state.pmCounterHistory.length === 0) return null;
  return state.pmCounterHistory[state.pmCounterHistory.length - 1];
}

/**
 * Get total vendor price concession percentage
 */
export function getTotalPriceConcession(state: NegotiationState): number {
  if (!state.priceConcessions) return 0;
  return state.priceConcessions.reduce((sum, c) => sum + c.changePercent, 0);
}

/**
 * Get total vendor terms concession percentage
 */
export function getTotalTermsConcession(state: NegotiationState): number {
  if (!state.termsConcessions) return 0;
  return state.termsConcessions.reduce((sum, c) => sum + c.changePercent, 0);
}

// ============================================
// MESO SELECTION TRACKING (February 2026)
// ============================================

/**
 * Detect MESO selection type from vendor message content
 * Looks for keywords like "Offer 1", "Offer 2", "Offer 3" (new)
 * Also supports legacy: "Best Price", "Best Terms", "Balanced"
 */
export function detectMesoSelectionFromMessage(content: string): 'offer_1' | 'offer_2' | 'offer_3' | 'price' | 'terms' | 'balanced' | null {
  const lowerContent = content.toLowerCase();

  // Check for new naming convention: Offer 1, Offer 2, Offer 3
  if (
    lowerContent.includes('offer 1') ||
    lowerContent.includes('offer one') ||
    lowerContent.includes('"offer 1"')
  ) {
    return 'offer_1';
  }

  if (
    lowerContent.includes('offer 2') ||
    lowerContent.includes('offer two') ||
    lowerContent.includes('"offer 2"')
  ) {
    return 'offer_2';
  }

  if (
    lowerContent.includes('offer 3') ||
    lowerContent.includes('offer three') ||
    lowerContent.includes('"offer 3"')
  ) {
    return 'offer_3';
  }

  // Legacy support: Check for price-focused selection
  if (
    lowerContent.includes('best price') ||
    lowerContent.includes('price-focused') ||
    lowerContent.includes('"best price"')
  ) {
    return 'price';
  }

  // Legacy support: Check for terms-focused selection
  if (
    lowerContent.includes('best terms') ||
    lowerContent.includes('terms-focused') ||
    lowerContent.includes('"best terms"')
  ) {
    return 'terms';
  }

  // Legacy support: Check for balanced selection
  if (
    lowerContent.includes('balanced') ||
    lowerContent.includes('"balanced"')
  ) {
    return 'balanced';
  }

  return null;
}

/**
 * Record a MESO selection and update negotiation state
 * Supports both new naming (offer_1/2/3) and legacy (price/terms/balanced)
 */
export function recordMesoSelection(
  state: NegotiationState,
  selectionType: 'offer_1' | 'offer_2' | 'offer_3' | 'price' | 'terms' | 'balanced',
  selectedOptionId: string,
  round: number
): NegotiationState {
  const mesoSelections = state.mesoSelections ?? [];
  const newSelection = {
    round,
    selectedOptionId,
    selectedType: selectionType,
    timestamp: new Date(),
  };

  // Update consecutive balanced count
  // Offer 3 is equivalent to "balanced" in the new naming
  let consecutiveBalanced = state.consecutiveBalancedSelections ?? 0;
  let explorationStartRound = state.preferenceExplorationStartRound;

  // Offer 3 or legacy "balanced" triggers preference exploration
  if (selectionType === 'balanced' || selectionType === 'offer_3') {
    consecutiveBalanced++;
    // Start preference exploration on first balanced selection
    if (!explorationStartRound) {
      explorationStartRound = round;
    }
  } else {
    // Reset consecutive count when non-balanced is selected
    consecutiveBalanced = 0;
    explorationStartRound = undefined;
  }

  return {
    ...state,
    mesoSelections: [...mesoSelections, newSelection],
    consecutiveBalancedSelections: consecutiveBalanced,
    preferenceExplorationStartRound: explorationStartRound,
    lastUpdatedAt: new Date(),
  };
}

/**
 * Check if we're in preference exploration mode
 * (vendor has selected balanced and we need more rounds to detect preference)
 */
export function isInPreferenceExploration(state: NegotiationState | null): boolean {
  if (!state) return false;
  const consecutiveBalanced = state.consecutiveBalancedSelections ?? 0;
  // In exploration mode if 1-2 balanced selections (not yet reached 3)
  return consecutiveBalanced > 0 && consecutiveBalanced < 3;
}

/**
 * Get the number of additional rounds needed for preference exploration
 * Returns 0 if not in exploration mode or already explored enough
 */
export function getPreferenceExplorationRoundsRemaining(state: NegotiationState | null): number {
  if (!state) return 0;
  const consecutiveBalanced = state.consecutiveBalancedSelections ?? 0;
  if (consecutiveBalanced === 0) return 0;
  // After 3 balanced selections, no more extra rounds needed
  if (consecutiveBalanced >= 3) return 0;
  // Return remaining rounds (3 - current count)
  return 3 - consecutiveBalanced;
}

/**
 * Check if preference exploration is complete
 * (either vendor made a clear choice or selected balanced 3 times)
 */
export function isPreferenceExplorationComplete(state: NegotiationState | null): boolean {
  if (!state) return true;
  const consecutiveBalanced = state.consecutiveBalancedSelections ?? 0;
  // Complete if: no balanced selections, or 3+ balanced selections
  return consecutiveBalanced === 0 || consecutiveBalanced >= 3;
}

// ============================================
// UTILITY HISTORY & STALL DETECTION (February 2026)
// ============================================

/**
 * Record utility score for a round and track improvement
 * Returns updated state with utility history and stall detection
 */
export function recordUtilityScore(
  state: NegotiationState,
  round: number,
  utility: number
): NegotiationState {
  const utilityHistory = state.utilityHistory ?? [];
  const newRecord = {
    round,
    utility,
    timestamp: new Date(),
  };

  // Get previous utility to check for improvement
  const previousUtility = utilityHistory.length > 0
    ? utilityHistory[utilityHistory.length - 1].utility
    : 0;

  // Check if utility improved (even small improvement counts)
  const improved = utility > previousUtility + 0.01; // 1% improvement threshold

  // Update consecutive no-improvement counter
  let consecutiveNoImprovement = state.consecutiveNoImprovementRounds ?? 0;
  if (improved) {
    consecutiveNoImprovement = 0;
  } else {
    consecutiveNoImprovement++;
  }

  return {
    ...state,
    utilityHistory: [...utilityHistory, newRecord],
    consecutiveNoImprovementRounds: consecutiveNoImprovement,
    lastUpdatedAt: new Date(),
  };
}

/**
 * Check if negotiation is stalled (no utility improvement for N rounds)
 * @param state - Current negotiation state
 * @param threshold - Number of rounds with no improvement to consider stalled (default 3)
 */
export function isNegotiationStalled(
  state: NegotiationState | null,
  threshold: number = 3
): boolean {
  if (!state) return false;
  const noImprovementRounds = state.consecutiveNoImprovementRounds ?? 0;
  return noImprovementRounds >= threshold;
}

/**
 * Check if vendor is rigid (no concessions made across multiple rounds)
 * @param state - Current negotiation state
 * @param minRounds - Minimum rounds to consider (default 10)
 */
export function isVendorRigid(
  state: NegotiationState | null,
  minRounds: number = 10
): boolean {
  if (!state) return false;

  const priceConcessions = state.priceConcessions ?? [];
  const termsConcessions = state.termsConcessions ?? [];
  const pmCounterHistory = state.pmCounterHistory ?? [];

  // Not enough rounds to determine rigidity
  if (pmCounterHistory.length < minRounds) return false;

  // Vendor is rigid if they made NO concessions in the last minRounds rounds
  const totalConcessions = priceConcessions.length + termsConcessions.length;
  return totalConcessions === 0;
}

/**
 * Get the utility trend over the last N rounds
 * Returns 'improving', 'declining', or 'flat'
 */
export function getUtilityTrend(
  state: NegotiationState | null,
  lookbackRounds: number = 5
): 'improving' | 'declining' | 'flat' {
  if (!state || !state.utilityHistory || state.utilityHistory.length < 2) {
    return 'flat';
  }

  const history = state.utilityHistory;
  const recentHistory = history.slice(-lookbackRounds);

  if (recentHistory.length < 2) return 'flat';

  const firstUtility = recentHistory[0].utility;
  const lastUtility = recentHistory[recentHistory.length - 1].utility;
  const change = lastUtility - firstUtility;

  // 2% threshold for determining trend
  if (change > 0.02) return 'improving';
  if (change < -0.02) return 'declining';
  return 'flat';
}

export default {
  analyzeMessageKeywords,
  mergeKeywords,
  calculatePriceConcession,
  calculateTermsConcession,
  detectVendorEmphasis,
  updateNegotiationState,
  getLastPmCounter,
  getTotalPriceConcession,
  getTotalTermsConcession,
  detectMesoSelectionFromMessage,
  recordMesoSelection,
  isInPreferenceExploration,
  getPreferenceExplorationRoundsRemaining,
  isPreferenceExplorationComplete,
  recordUtilityScore,
  isNegotiationStalled,
  isVendorRigid,
  getUtilityTrend,
};
