/**
 * Behavioral Analyzer Module
 *
 * Pactum-inspired behavioral analysis engine that extracts signals
 * from negotiation message history and computes adaptive strategies.
 *
 * Features:
 * - Concession velocity and acceleration tracking
 * - Price gap convergence/divergence detection
 * - Response time engagement signals
 * - Keyword-based sentiment analysis
 * - Composite momentum scoring
 * - Adaptive strategy computation (Holding Firm / Accelerating / Matching Pace / Final Push)
 *
 * All features are opt-in via adaptiveFeatures.enabled flag on the deal config.
 *
 * @module behavioralAnalyzer
 */

import type { BehavioralSignals, AdaptiveStrategyResult } from './types.js';
import type { NegotiationConfig } from './utility.js';

// ============================================
// TYPES
// ============================================

/**
 * Minimal message shape needed for behavioral analysis.
 * Matches ChatbotMessage model fields.
 */
export interface AnalyzableMessage {
  role: 'VENDOR' | 'ACCORDO' | 'SYSTEM' | 'PM';
  content: string;
  extractedOffer?: {
    total_price?: number | null;
    payment_terms?: string | null;
  } | null;
  counterOffer?: {
    total_price?: number | null;
    payment_terms?: string | null;
  } | null;
  createdAt: Date | string;
}

// ============================================
// SENTIMENT KEYWORDS
// ============================================

const POSITIVE_KEYWORDS = [
  'agree', 'works', 'acceptable', 'deal', 'sounds good', 'fair',
  'willing', 'happy', 'pleased', 'great', 'perfect', 'yes',
  'can do', 'no problem', 'of course', 'absolutely',
];

const RESISTANT_KEYWORDS = [
  'cannot', 'firm', 'impossible', 'final', 'non-negotiable',
  'refuse', 'unacceptable', 'too low', 'below cost', 'won\'t',
  'can\'t', 'not possible', 'out of question', 'no way',
  'bottom line', 'take it or leave',
];

const URGENT_KEYWORDS = [
  'deadline', 'urgent', 'asap', 'immediately', 'time-sensitive',
  'running out', 'expiring', 'last chance', 'today', 'end of day',
  'hurry', 'rush', 'quickly',
];

// ============================================
// SENTIMENT ANALYSIS
// ============================================

/**
 * Detect sentiment from message content using keyword matching.
 * Not LLM-based - uses simple keyword scanning for speed.
 */
function detectSentiment(content: string): 'positive' | 'neutral' | 'resistant' | 'urgent' {
  const lower = content.toLowerCase();

  let positiveScore = 0;
  let resistantScore = 0;
  let urgentScore = 0;

  for (const kw of POSITIVE_KEYWORDS) {
    if (lower.includes(kw)) positiveScore++;
  }
  for (const kw of RESISTANT_KEYWORDS) {
    if (lower.includes(kw)) resistantScore++;
  }
  for (const kw of URGENT_KEYWORDS) {
    if (lower.includes(kw)) urgentScore++;
  }

  // Urgent takes priority if detected
  if (urgentScore >= 2) return 'urgent';
  if (urgentScore > 0 && resistantScore === 0 && positiveScore === 0) return 'urgent';

  // Then resistant vs positive
  if (resistantScore > positiveScore && resistantScore >= 1) return 'resistant';
  if (positiveScore > resistantScore && positiveScore >= 1) return 'positive';

  return 'neutral';
}

// ============================================
// CORE ANALYSIS
// ============================================

/**
 * Analyze behavioral signals from a negotiation message history.
 *
 * Extracts:
 * - Vendor offer prices and concession patterns
 * - PM counter-offer prices for gap analysis
 * - Response time trends from timestamps
 * - Sentiment from latest vendor message
 * - Composite momentum score
 *
 * @param messages - All messages for the deal, ordered by createdAt ASC
 * @param currentRound - Current round number
 * @returns BehavioralSignals object
 */
export function analyzeBehavior(
  messages: AnalyzableMessage[],
  currentRound: number
): BehavioralSignals {
  // Extract vendor offers (prices) and PM counters
  const vendorPrices: number[] = [];
  const pmCounterPrices: number[] = [];

  for (const msg of messages) {
    if (msg.role === 'VENDOR' && msg.extractedOffer?.total_price != null) {
      vendorPrices.push(msg.extractedOffer.total_price);
    }
    if ((msg.role === 'ACCORDO' || msg.role === 'PM') && msg.counterOffer?.total_price != null) {
      pmCounterPrices.push(msg.counterOffer.total_price);
    }
  }

  // --- Concession analysis ---
  const concessionVelocity = computeConcessionVelocity(vendorPrices, currentRound);
  const concessionAccelerating = computeConcessionAcceleration(vendorPrices);
  const lastConcessionSize = computeLastConcession(vendorPrices);

  // --- Convergence analysis ---
  const priceGapTrend = computePriceGapTrend(vendorPrices, pmCounterPrices);
  const convergenceRate = computeConvergenceRate(priceGapTrend);
  const isConverging = convergenceRate > 0.05 && priceGapTrend.length >= 2;
  const isStalling = detectStalling(vendorPrices, pmCounterPrices);
  const isDiverging = convergenceRate < -0.05 && priceGapTrend.length >= 2;

  // --- Engagement signals ---
  const { avgResponseTimeMs, responseTimeTrend } = computeResponseTimes(messages);

  // --- Sentiment ---
  const vendorMessages = messages.filter(m => m.role === 'VENDOR');
  const latestVendorContent = vendorMessages.length > 0
    ? vendorMessages[vendorMessages.length - 1].content
    : '';
  const latestSentiment = detectSentiment(latestVendorContent);

  // --- Momentum ---
  const momentum = computeMomentum({
    convergenceRate,
    isConverging,
    isStalling,
    isDiverging,
    concessionVelocity,
    concessionAccelerating,
    latestSentiment,
    responseTimeTrend,
  });

  return {
    concessionVelocity,
    concessionAccelerating,
    lastConcessionSize,
    priceGapTrend,
    convergenceRate,
    isConverging,
    isStalling,
    isDiverging,
    avgResponseTimeMs,
    responseTimeTrend,
    latestSentiment,
    momentum,
  };
}

// ============================================
// ADAPTIVE STRATEGY COMPUTATION
// ============================================

/**
 * Compute adaptive strategy based on behavioral signals.
 *
 * Strategy rules:
 * - Converging + Vendor conceding fast -> "Holding Firm": reduce aggressiveness 30%
 * - Stalling (flat offers 2+ rounds) -> "Accelerating": increase aggressiveness 20%, or signal escalation
 * - Diverging (gap growing) -> "Final Push": one large concession attempt, then escalation
 * - Healthy convergence -> "Matching Pace": use base aggressiveness with standard adjustment
 *
 * @param signals - Behavioral signals from analyzeBehavior()
 * @param config - Negotiation configuration
 * @param round - Current round number
 * @returns Adaptive strategy result
 */
export function computeAdaptiveStrategy(
  signals: BehavioralSignals,
  config: NegotiationConfig,
  round: number
): AdaptiveStrategyResult {
  const priority = config.priority || 'MEDIUM';
  const baseAggressiveness: Record<string, number> = {
    HIGH: 0.15,
    MEDIUM: 0.40,
    LOW: 0.55,
  };
  const base = baseAggressiveness[priority] ?? 0.40;

  // Round adjustment: same as original (2% per round, max 10%)
  const roundAdjustment = Math.min(0.10, round * 0.02);

  // Determine strategy based on behavioral signals
  if (signals.isDiverging) {
    // GAP GROWING: Final Push - one large concession, then signal escalation
    const adjusted = Math.min(0.95, base + roundAdjustment + 0.20);
    return {
      adjustedAggressiveness: clampAggressiveness(adjusted),
      strategyLabel: 'Final Push',
      shouldExtendRounds: false,
      shouldEscalateEarly: round >= Math.ceil(config.max_rounds * 0.5),
      reasoning: `Gap is growing (convergence rate: ${(signals.convergenceRate * 100).toFixed(0)}%). Making final concession push before escalation.`,
    };
  }

  if (signals.isStalling) {
    // STALLING: Accelerating - increase aggressiveness or signal early escalation
    const minRoundsForEscalation = Math.ceil(config.max_rounds * 0.6);
    const shouldEscalate = round >= minRoundsForEscalation;
    const adjusted = base + roundAdjustment + 0.08; // +8% more aggressive (concede more to break deadlock)

    return {
      adjustedAggressiveness: clampAggressiveness(adjusted),
      strategyLabel: 'Accelerating',
      shouldExtendRounds: false,
      shouldEscalateEarly: shouldEscalate,
      reasoning: shouldEscalate
        ? `Stalling detected after ${round} rounds. Vendor offers flat for 2+ rounds. Recommending escalation.`
        : `Stalling detected. Increasing concession pace by 20% to break deadlock.`,
    };
  }

  if (signals.isConverging && signals.concessionAccelerating) {
    // CONVERGING + VENDOR CONCEDING FAST: Hold firm
    const adjusted = Math.max(0.05, (base + roundAdjustment) * 0.70); // 30% reduction

    return {
      adjustedAggressiveness: clampAggressiveness(adjusted),
      strategyLabel: 'Holding Firm',
      shouldExtendRounds: true,
      shouldEscalateEarly: false,
      reasoning: `Vendor conceding at accelerating pace ($${signals.concessionVelocity.toFixed(0)}/round). Holding firm — vendor is moving toward our position.`,
    };
  }

  if (signals.isConverging && !signals.concessionAccelerating) {
    // CONVERGING but steady pace: hold firm if velocity is decent
    if (signals.concessionVelocity > 0 && signals.convergenceRate > 0.10) {
      const adjusted = Math.max(0.05, (base + roundAdjustment) * 0.75);
      return {
        adjustedAggressiveness: clampAggressiveness(adjusted),
        strategyLabel: 'Holding Firm',
        shouldExtendRounds: true,
        shouldEscalateEarly: false,
        reasoning: `Steady convergence at ${(signals.convergenceRate * 100).toFixed(0)}%/round. Holding firm with minor concessions.`,
      };
    }
  }

  // DEFAULT: Matching Pace - standard aggressiveness with round adjustment
  const adjusted = base + roundAdjustment;
  return {
    adjustedAggressiveness: clampAggressiveness(adjusted),
    strategyLabel: 'Matching Pace',
    shouldExtendRounds: signals.convergenceRate > 0.05,
    shouldEscalateEarly: false,
    reasoning: `Standard negotiation pace. Convergence rate: ${(signals.convergenceRate * 100).toFixed(0)}%/round.`,
  };
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Clamp aggressiveness to valid range [0.05, 0.95]
 */
function clampAggressiveness(value: number): number {
  return Math.max(0.05, Math.min(0.95, value));
}

/**
 * Compute average concession velocity ($/round).
 * Positive = vendor is dropping price (good for buyer).
 */
function computeConcessionVelocity(vendorPrices: number[], rounds: number): number {
  if (vendorPrices.length < 2 || rounds < 1) return 0;
  const firstOffer = vendorPrices[0];
  const latestOffer = vendorPrices[vendorPrices.length - 1];
  return (firstOffer - latestOffer) / rounds;
}

/**
 * Detect whether concessions are getting larger (accelerating).
 */
function computeConcessionAcceleration(vendorPrices: number[]): boolean {
  if (vendorPrices.length < 3) return false;

  const concessions: number[] = [];
  for (let i = 1; i < vendorPrices.length; i++) {
    concessions.push(vendorPrices[i - 1] - vendorPrices[i]);
  }

  // Check if the last concession is larger than the average of previous ones
  if (concessions.length < 2) return false;
  const lastConcession = concessions[concessions.length - 1];
  const previousAvg = concessions.slice(0, -1).reduce((a, b) => a + b, 0) / (concessions.length - 1);

  return lastConcession > previousAvg * 1.1; // 10% larger than average
}

/**
 * Get the most recent price change amount.
 */
function computeLastConcession(vendorPrices: number[]): number {
  if (vendorPrices.length < 2) return 0;
  return vendorPrices[vendorPrices.length - 2] - vendorPrices[vendorPrices.length - 1];
}

/**
 * Compute price gap trend (vendor price - PM counter) for last 3 rounds.
 */
function computePriceGapTrend(vendorPrices: number[], pmCounterPrices: number[]): number[] {
  const minLen = Math.min(vendorPrices.length, pmCounterPrices.length);
  if (minLen === 0) return [];

  const gaps: number[] = [];
  for (let i = 0; i < minLen; i++) {
    gaps.push(vendorPrices[i] - pmCounterPrices[i]);
  }

  // Return last 3 gaps
  return gaps.slice(-3);
}

/**
 * Compute convergence rate from price gap trend.
 * Positive = converging, negative = diverging.
 */
function computeConvergenceRate(priceGapTrend: number[]): number {
  if (priceGapTrend.length < 2) return 0;

  let totalReduction = 0;
  let count = 0;

  for (let i = 1; i < priceGapTrend.length; i++) {
    const prevGap = Math.abs(priceGapTrend[i - 1]);
    const currGap = Math.abs(priceGapTrend[i]);
    if (prevGap > 0) {
      totalReduction += (prevGap - currGap) / prevGap;
      count++;
    }
  }

  return count > 0 ? totalReduction / count : 0;
}

/**
 * Detect stalling: vendor offers barely changing for 2+ consecutive rounds.
 * Stalling = |concession| < 2% of the gap for 2+ consecutive rounds.
 */
function detectStalling(vendorPrices: number[], pmCounterPrices: number[]): boolean {
  if (vendorPrices.length < 3) return false;

  // Check last 2 concessions
  const lastTwo = vendorPrices.slice(-3);
  const c1 = Math.abs(lastTwo[0] - lastTwo[1]);
  const c2 = Math.abs(lastTwo[1] - lastTwo[2]);

  // Use the average price as reference for "2% threshold"
  const avgPrice = vendorPrices.reduce((a, b) => a + b, 0) / vendorPrices.length;
  const threshold = avgPrice * 0.02; // 2% of average price

  return c1 < threshold && c2 < threshold;
}

/**
 * Compute response times from message timestamps.
 * Looks at deltas between consecutive ACCORDO -> VENDOR message pairs.
 */
function computeResponseTimes(messages: AnalyzableMessage[]): {
  avgResponseTimeMs: number;
  responseTimeTrend: 'faster' | 'slower' | 'stable';
} {
  const responseTimes: number[] = [];

  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];

    // Vendor responding to ACCORDO message
    if ((prev.role === 'ACCORDO' || prev.role === 'PM') && curr.role === 'VENDOR') {
      const prevTime = new Date(prev.createdAt).getTime();
      const currTime = new Date(curr.createdAt).getTime();
      const delta = currTime - prevTime;
      if (delta > 0 && delta < 7 * 24 * 60 * 60 * 1000) { // Ignore gaps > 7 days
        responseTimes.push(delta);
      }
    }
  }

  if (responseTimes.length === 0) {
    return { avgResponseTimeMs: 0, responseTimeTrend: 'stable' };
  }

  const avgResponseTimeMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;

  // Determine trend from last 3 response times
  let responseTimeTrend: 'faster' | 'slower' | 'stable' = 'stable';
  if (responseTimes.length >= 3) {
    const recent = responseTimes.slice(-3);
    const firstHalf = recent.slice(0, Math.ceil(recent.length / 2));
    const secondHalf = recent.slice(Math.ceil(recent.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const changePct = (secondAvg - firstAvg) / firstAvg;
    if (changePct < -0.15) responseTimeTrend = 'faster';
    else if (changePct > 0.15) responseTimeTrend = 'slower';
  }

  return { avgResponseTimeMs, responseTimeTrend };
}

/**
 * Compute composite momentum score from -1 (losing) to +1 (winning).
 *
 * Factors:
 * - Convergence rate (weight: 0.30)
 * - Concession velocity direction (weight: 0.25)
 * - Sentiment (weight: 0.20)
 * - Response time trend (weight: 0.15)
 * - Stalling/diverging penalty (weight: 0.10)
 */
function computeMomentum(signals: {
  convergenceRate: number;
  isConverging: boolean;
  isStalling: boolean;
  isDiverging: boolean;
  concessionVelocity: number;
  concessionAccelerating: boolean;
  latestSentiment: 'positive' | 'neutral' | 'resistant' | 'urgent';
  responseTimeTrend: 'faster' | 'slower' | 'stable';
}): number {
  let momentum = 0;

  // Convergence contribution (0.30)
  if (signals.isConverging) {
    momentum += Math.min(0.30, signals.convergenceRate * 2);
  } else if (signals.isDiverging) {
    momentum -= 0.30;
  }

  // Concession velocity contribution (0.25)
  if (signals.concessionVelocity > 0) {
    momentum += signals.concessionAccelerating ? 0.25 : 0.15;
  } else if (signals.concessionVelocity < 0) {
    momentum -= 0.15;
  }

  // Sentiment contribution (0.20)
  const sentimentScores: Record<string, number> = {
    positive: 0.20,
    neutral: 0.05,
    resistant: -0.15,
    urgent: 0.10, // Urgency often means vendor wants to close
  };
  momentum += sentimentScores[signals.latestSentiment] ?? 0;

  // Response time trend contribution (0.15)
  const timeTrendScores: Record<string, number> = {
    faster: 0.10,
    stable: 0.05,
    slower: -0.10,
  };
  momentum += timeTrendScores[signals.responseTimeTrend] ?? 0;

  // Stalling penalty (0.10)
  if (signals.isStalling) {
    momentum -= 0.20;
  }

  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, momentum));
}

export default {
  analyzeBehavior,
  computeAdaptiveStrategy,
};
