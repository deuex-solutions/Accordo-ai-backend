/**
 * Cross-Deal Learning Integration
 *
 * Connects the negotiation engine to historical patterns and embeddings
 * to improve decisions based on past successful negotiations.
 *
 * Uses:
 * - negotiation_patterns table for pattern matching
 * - deal_embeddings table for semantic similarity
 * - Vector service for embedding-based search
 *
 * @module crossDealLearning
 */

import logger from '../../../config/logger.js';
import type { ExtendedOffer, ResolvedNegotiationConfig } from './types.js';

// ============================================
// Types
// ============================================

/**
 * Historical pattern match result
 */
export interface PatternMatch {
  /** Pattern ID */
  patternId: string;
  /** Pattern name */
  patternName: string;
  /** Pattern type */
  patternType: 'successful_negotiation' | 'failed_negotiation' | 'escalation' | 'walkaway' | 'quick_acceptance';
  /** Similarity score (0-1) */
  similarity: number;
  /** Average utility achieved with this pattern */
  avgUtility: number;
  /** Average rounds to close */
  avgRounds: number;
  /** Average price reduction achieved */
  avgPriceReduction: number;
  /** Success rate for this pattern */
  successRate: number;
  /** Key factors that led to this pattern */
  keyFactors: Record<string, unknown>;
  /** Recommended actions based on pattern */
  recommendedActions: string[];
}

/**
 * Similar deal match result
 */
export interface SimilarDealMatch {
  /** Deal ID */
  dealId: string;
  /** Deal title */
  dealTitle: string;
  /** Similarity score (0-1) */
  similarity: number;
  /** Final status of the deal */
  finalStatus: string;
  /** Total rounds taken */
  totalRounds: number;
  /** Final utility achieved */
  finalUtility: number;
  /** Final price */
  finalPrice: number | null;
  /** Final terms */
  finalTerms: string | null;
  /** Price reduction achieved */
  priceReductionPercent: number | null;
}

/**
 * Cross-deal learning context for decision making
 */
export interface LearningContext {
  /** Best matching patterns */
  patternMatches: PatternMatch[];
  /** Similar historical deals */
  similarDeals: SimilarDealMatch[];
  /** Overall insights */
  insights: {
    /** Expected outcome based on patterns */
    expectedOutcome: 'accept' | 'counter' | 'escalate' | 'walkaway' | 'unknown';
    /** Confidence in expected outcome */
    confidence: number;
    /** Expected rounds to close */
    expectedRounds: number | null;
    /** Expected price reduction */
    expectedPriceReduction: number | null;
    /** Recommended strategy adjustments */
    strategyAdjustments: StrategyAdjustment[];
  };
  /** Whether cross-deal data was available */
  hasHistoricalData: boolean;
}

/**
 * Strategy adjustment recommendation
 */
export interface StrategyAdjustment {
  /** Parameter to adjust */
  parameter: string;
  /** Adjustment direction */
  direction: 'increase' | 'decrease' | 'maintain';
  /** Adjustment magnitude (0-1) */
  magnitude: number;
  /** Reason for adjustment */
  reason: string;
  /** Confidence in this adjustment */
  confidence: number;
}

/**
 * Deal state for pattern matching
 */
export interface DealState {
  /** Current round */
  round: number;
  /** Latest vendor offer */
  vendorOffer: ExtendedOffer;
  /** Current utility */
  currentUtility: number;
  /** Price gap (vendor - target) */
  priceGap: number;
  /** Terms gap (target - vendor in days) */
  termsGap: number;
  /** Vendor's concession rate */
  concessionRate: number;
  /** Is negotiation stalling */
  isStalling: boolean;
  /** Vendor category/type if known */
  vendorType?: string;
  /** Product category if known */
  productCategory?: string;
}

// ============================================
// Pattern Matching
// ============================================

/**
 * Find similar negotiation patterns from historical data
 *
 * @param dealState - Current deal state
 * @param config - Resolved negotiation config
 * @param minSimilarity - Minimum similarity threshold (default 0.75)
 */
export async function findSimilarPatterns(
  dealState: DealState,
  config: ResolvedNegotiationConfig,
  minSimilarity: number = 0.75
): Promise<PatternMatch[]> {
  try {
    // Import models dynamically to avoid circular dependency
    const { NegotiationPattern } = await import('../../../models/index.js');
    const { Op } = await import('sequelize');

    // Build pattern query based on deal state
    const whereClause: Record<string, unknown> = {
      isActive: true,
    };

    // Filter by scenario if we can determine it
    const scenario = determineScenario(dealState);
    if (scenario) {
      whereClause.scenario = scenario;
    }

    // Get patterns from database
    const patterns = await NegotiationPattern.findAll({
      where: whereClause,
      order: [['successRate', 'DESC']],
      limit: 10,
    });

    // Calculate similarity scores
    const matches: PatternMatch[] = [];

    for (const pattern of patterns) {
      const similarity = calculatePatternSimilarity(dealState, pattern);

      if (similarity >= minSimilarity) {
        matches.push({
          patternId: pattern.id,
          patternName: pattern.patternName,
          patternType: pattern.patternType,
          similarity,
          avgUtility: Number(pattern.avgUtility) || 0,
          avgRounds: Number(pattern.avgRounds) || 0,
          avgPriceReduction: Number(pattern.avgPriceReduction) || 0,
          successRate: Number(pattern.successRate) || 0,
          keyFactors: (pattern.keyFactors as Record<string, unknown>) || {},
          recommendedActions: extractRecommendedActions(pattern),
        });
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);

    return matches.slice(0, 5); // Return top 5 matches
  } catch (error) {
    logger.error('Error finding similar patterns:', error);
    return [];
  }
}

/**
 * Determine negotiation scenario from deal state
 */
function determineScenario(dealState: DealState): string | null {
  if (dealState.isStalling) {
    return 'HARD';
  }

  if (dealState.concessionRate > 5) {
    return 'SOFT';
  }

  if (dealState.priceGap > 0.3) {
    return 'HARD';
  }

  if (dealState.round >= 5 && dealState.currentUtility < 0.5) {
    return 'HARD';
  }

  return 'MEDIUM';
}

/**
 * Calculate similarity between deal state and a pattern
 */
function calculatePatternSimilarity(
  dealState: DealState,
  pattern: {
    avgRounds: number | null;
    avgUtility: number | null;
    avgPriceReduction: number | null;
    scenario: string | null;
    keyFactors: object | null;
  }
): number {
  let similarity = 0;
  let factorCount = 0;

  // Round similarity
  if (pattern.avgRounds != null) {
    const roundDiff = Math.abs(dealState.round - Number(pattern.avgRounds));
    similarity += Math.max(0, 1 - roundDiff / 10);
    factorCount++;
  }

  // Utility similarity
  if (pattern.avgUtility != null) {
    const utilityDiff = Math.abs(dealState.currentUtility - Number(pattern.avgUtility));
    similarity += Math.max(0, 1 - utilityDiff);
    factorCount++;
  }

  // Price gap similarity
  if (pattern.avgPriceReduction != null) {
    const gapDiff = Math.abs(dealState.priceGap - Number(pattern.avgPriceReduction));
    similarity += Math.max(0, 1 - gapDiff);
    factorCount++;
  }

  // Scenario match bonus
  const scenario = determineScenario(dealState);
  if (pattern.scenario && scenario === pattern.scenario) {
    similarity += 0.3;
    factorCount++;
  }

  return factorCount > 0 ? similarity / factorCount : 0;
}

/**
 * Extract recommended actions from pattern
 */
function extractRecommendedActions(pattern: {
  patternType: string;
  keyFactors: object | null;
  avgPriceReduction: number | null;
  successRate: number | null;
}): string[] {
  const actions: string[] = [];

  switch (pattern.patternType) {
    case 'successful_negotiation':
      actions.push('Continue current strategy - pattern shows success');
      if (Number(pattern.avgPriceReduction) > 10) {
        actions.push('Push for additional price concessions');
      }
      break;

    case 'quick_acceptance':
      actions.push('Consider accepting - pattern suggests good outcome');
      break;

    case 'escalation':
      actions.push('Prepare for escalation - pattern shows escalation likely');
      actions.push('Consider pre-emptive human review');
      break;

    case 'walkaway':
      actions.push('Be prepared to walk away - pattern shows low success rate');
      actions.push('Set clear boundaries early');
      break;

    case 'failed_negotiation':
      actions.push('Review strategy - pattern shows high failure rate');
      actions.push('Consider alternative approach');
      break;
  }

  return actions;
}

// ============================================
// Similar Deal Search
// ============================================

/**
 * Find similar historical deals using embeddings
 *
 * @param dealState - Current deal state
 * @param config - Resolved negotiation config
 * @param vendorId - Vendor ID (optional, for vendor-specific learning)
 * @param minSimilarity - Minimum similarity threshold
 */
export async function findSimilarDeals(
  dealState: DealState,
  config: ResolvedNegotiationConfig,
  vendorId?: number,
  minSimilarity: number = 0.75
): Promise<SimilarDealMatch[]> {
  try {
    const { DealEmbedding } = await import('../../../models/index.js');
    const { Op } = await import('sequelize');

    // Build query
    const whereClause: Record<string, unknown> = {
      embeddingType: 'summary',
      finalStatus: { [Op.in]: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'] },
    };

    // Optionally filter by vendor for vendor-specific learning
    if (vendorId) {
      whereClause.vendorId = vendorId;
    }

    // Get deal embeddings
    const embeddings = await DealEmbedding.findAll({
      where: whereClause,
      order: [['finalUtility', 'DESC']],
      limit: 20,
    });

    // Calculate similarity and filter
    const matches: SimilarDealMatch[] = [];

    for (const embedding of embeddings) {
      // Simple feature-based similarity (would use vector similarity in production)
      const similarity = calculateDealSimilarity(dealState, config, embedding);

      if (similarity >= minSimilarity) {
        // Calculate price reduction if available
        let priceReductionPercent: number | null = null;
        if (embedding.anchorPrice && embedding.finalPrice) {
          priceReductionPercent =
            ((Number(embedding.anchorPrice) - Number(embedding.finalPrice)) /
              Number(embedding.anchorPrice)) *
            100;
        }

        matches.push({
          dealId: embedding.dealId,
          dealTitle: embedding.dealTitle || 'Unknown Deal',
          similarity,
          finalStatus: embedding.finalStatus || 'UNKNOWN',
          totalRounds: embedding.totalRounds || 0,
          finalUtility: Number(embedding.finalUtility) || 0,
          finalPrice: embedding.finalPrice ? Number(embedding.finalPrice) : null,
          finalTerms: embedding.finalTerms || null,
          priceReductionPercent: priceReductionPercent
            ? Math.round(priceReductionPercent * 100) / 100
            : null,
        });
      }
    }

    // Sort by similarity descending
    matches.sort((a, b) => b.similarity - a.similarity);

    return matches.slice(0, 5);
  } catch (error) {
    logger.error('Error finding similar deals:', error);
    return [];
  }
}

/**
 * Calculate similarity between deal state and historical deal
 */
function calculateDealSimilarity(
  dealState: DealState,
  config: ResolvedNegotiationConfig,
  embedding: {
    totalRounds: number | null;
    finalUtility: number | null;
    targetPrice: number | null;
    finalPrice: number | null;
    productCategory: string | null;
  }
): number {
  let similarity = 0;
  let factorCount = 0;

  // Round similarity
  if (embedding.totalRounds != null) {
    const roundDiff = Math.abs(dealState.round - embedding.totalRounds);
    similarity += Math.max(0, 1 - roundDiff / 10);
    factorCount++;
  }

  // Price range similarity
  if (embedding.targetPrice != null && embedding.finalPrice != null) {
    const historicalGap =
      (Number(embedding.finalPrice) - Number(embedding.targetPrice)) /
      Number(embedding.targetPrice);
    const currentGapRatio = dealState.priceGap;
    const gapDiff = Math.abs(historicalGap - currentGapRatio);
    similarity += Math.max(0, 1 - gapDiff);
    factorCount++;
  }

  // Product category match
  if (embedding.productCategory && dealState.productCategory) {
    if (
      embedding.productCategory.toLowerCase() ===
      dealState.productCategory.toLowerCase()
    ) {
      similarity += 1;
      factorCount++;
    }
  }

  return factorCount > 0 ? similarity / factorCount : 0;
}

// ============================================
// Learning Context Building
// ============================================

/**
 * Build complete learning context for decision making
 */
export async function buildLearningContext(
  dealState: DealState,
  config: ResolvedNegotiationConfig,
  vendorId?: number
): Promise<LearningContext> {
  // Fetch patterns and similar deals in parallel
  const [patternMatches, similarDeals] = await Promise.all([
    findSimilarPatterns(dealState, config),
    findSimilarDeals(dealState, config, vendorId),
  ]);

  const hasHistoricalData = patternMatches.length > 0 || similarDeals.length > 0;

  // Generate insights
  const insights = generateInsights(patternMatches, similarDeals, dealState);

  return {
    patternMatches,
    similarDeals,
    insights,
    hasHistoricalData,
  };
}

/**
 * Generate insights from pattern and deal matches
 */
function generateInsights(
  patterns: PatternMatch[],
  deals: SimilarDealMatch[],
  dealState: DealState
): LearningContext['insights'] {
  // Default insights
  const insights: LearningContext['insights'] = {
    expectedOutcome: 'unknown',
    confidence: 0,
    expectedRounds: null,
    expectedPriceReduction: null,
    strategyAdjustments: [],
  };

  if (patterns.length === 0 && deals.length === 0) {
    return insights;
  }

  // Analyze pattern outcomes
  if (patterns.length > 0) {
    const topPattern = patterns[0];

    switch (topPattern.patternType) {
      case 'successful_negotiation':
      case 'quick_acceptance':
        insights.expectedOutcome = 'accept';
        break;
      case 'escalation':
        insights.expectedOutcome = 'escalate';
        break;
      case 'walkaway':
      case 'failed_negotiation':
        insights.expectedOutcome = 'walkaway';
        break;
      default:
        insights.expectedOutcome = 'counter';
    }

    insights.confidence = topPattern.similarity * topPattern.successRate;
    insights.expectedRounds = topPattern.avgRounds || null;
    insights.expectedPriceReduction = topPattern.avgPriceReduction || null;
  }

  // Enhance with deal data
  if (deals.length > 0) {
    const acceptedDeals = deals.filter((d) => d.finalStatus === 'ACCEPTED');

    if (acceptedDeals.length > 0) {
      const avgRounds =
        acceptedDeals.reduce((sum, d) => sum + d.totalRounds, 0) /
        acceptedDeals.length;
      const avgReduction =
        acceptedDeals
          .filter((d) => d.priceReductionPercent != null)
          .reduce((sum, d) => sum + (d.priceReductionPercent || 0), 0) /
        acceptedDeals.filter((d) => d.priceReductionPercent != null).length;

      if (insights.expectedRounds === null) {
        insights.expectedRounds = Math.round(avgRounds);
      }
      if (insights.expectedPriceReduction === null && !isNaN(avgReduction)) {
        insights.expectedPriceReduction = Math.round(avgReduction * 100) / 100;
      }
    }
  }

  // Generate strategy adjustments
  insights.strategyAdjustments = generateStrategyAdjustments(
    patterns,
    deals,
    dealState
  );

  return insights;
}

/**
 * Generate strategy adjustments based on historical data
 */
function generateStrategyAdjustments(
  patterns: PatternMatch[],
  deals: SimilarDealMatch[],
  dealState: DealState
): StrategyAdjustment[] {
  const adjustments: StrategyAdjustment[] = [];

  // Adjustment based on stalling
  if (dealState.isStalling && patterns.some((p) => p.patternType === 'escalation')) {
    adjustments.push({
      parameter: 'aggressiveness',
      direction: 'increase',
      magnitude: 0.15,
      reason: 'Negotiation stalling - increase pressure to avoid escalation',
      confidence: 0.7,
    });
  }

  // Adjustment based on successful patterns
  const successfulPatterns = patterns.filter(
    (p) => p.patternType === 'successful_negotiation' && p.successRate > 0.7
  );
  if (successfulPatterns.length > 0) {
    const avgPriceReduction =
      successfulPatterns.reduce((sum, p) => sum + p.avgPriceReduction, 0) /
      successfulPatterns.length;

    if (dealState.priceGap > avgPriceReduction * 1.2) {
      adjustments.push({
        parameter: 'price',
        direction: 'decrease',
        magnitude: 0.1,
        reason: 'Current price gap exceeds successful pattern average',
        confidence: 0.6,
      });
    }
  }

  // Adjustment based on similar accepted deals
  const acceptedDeals = deals.filter(
    (d) => d.finalStatus === 'ACCEPTED' && d.similarity > 0.8
  );
  if (acceptedDeals.length > 0) {
    const avgUtility =
      acceptedDeals.reduce((sum, d) => sum + d.finalUtility, 0) /
      acceptedDeals.length;

    if (dealState.currentUtility > avgUtility + 0.1) {
      adjustments.push({
        parameter: 'acceptThreshold',
        direction: 'maintain',
        magnitude: 0,
        reason: 'Current utility exceeds similar successful deals - consider accepting',
        confidence: 0.75,
      });
    }
  }

  return adjustments;
}

/**
 * Apply learning context to decision making
 */
export function applyLearningToDecision(
  context: LearningContext,
  currentDecision: {
    action: string;
    utilityScore: number;
  }
): {
  adjustedAction: string;
  adjustmentReason: string | null;
  confidenceBoost: number;
} {
  if (!context.hasHistoricalData || context.insights.confidence < 0.5) {
    return {
      adjustedAction: currentDecision.action,
      adjustmentReason: null,
      confidenceBoost: 0,
    };
  }

  let adjustedAction = currentDecision.action;
  let adjustmentReason: string | null = null;
  let confidenceBoost = 0;

  // Check if current decision aligns with expected outcome
  const { expectedOutcome, confidence } = context.insights;

  if (
    expectedOutcome !== 'unknown' &&
    confidence > 0.6 &&
    currentDecision.action.toLowerCase() !== expectedOutcome
  ) {
    // Consider adjusting based on historical patterns
    if (
      expectedOutcome === 'accept' &&
      currentDecision.action === 'COUNTER' &&
      currentDecision.utilityScore > 0.65
    ) {
      // Patterns suggest accepting might be better
      adjustmentReason = `Historical patterns (${Math.round(confidence * 100)}% confidence) suggest accepting at this utility level`;
      confidenceBoost = 0.1;
    } else if (
      expectedOutcome === 'escalate' &&
      currentDecision.action === 'COUNTER'
    ) {
      // Patterns suggest escalation is likely
      adjustmentReason = `Historical patterns suggest escalation may be necessary - prepare for human review`;
      confidenceBoost = -0.05; // Reduce confidence
    }
  }

  // Boost confidence if decision aligns with patterns
  if (
    expectedOutcome !== 'unknown' &&
    currentDecision.action.toLowerCase() === expectedOutcome
  ) {
    confidenceBoost = Math.min(0.15, confidence * 0.2);
    adjustmentReason = `Decision aligns with successful historical patterns`;
  }

  return {
    adjustedAction,
    adjustmentReason,
    confidenceBoost,
  };
}
