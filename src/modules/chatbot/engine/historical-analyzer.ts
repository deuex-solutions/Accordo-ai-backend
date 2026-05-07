/**
 * Historical Analyzer Module
 *
 * Provides adaptive anchoring by analyzing past deal outcomes
 * for the same vendor or product category. Uses DealEmbedding and
 * NegotiationPattern models to derive historical insights.
 *
 * Features:
 * - Query completed deals for a vendor to build behavioral profile
 * - Compute anchor effectiveness from historical outcomes
 * - Adjust opening anchor based on past vendor behavior
 *
 * All features are opt-in via adaptiveFeatures.enabled flag.
 *
 * @module historicalAnalyzer
 */

import type { HistoricalInsights } from './types.js';
import models from '../../../models/index.js';
import logger from '../../../config/logger.js';
import { Op } from 'sequelize';

// ============================================
// HISTORICAL INSIGHTS
// ============================================

/**
 * Get historical negotiation insights for a vendor and/or product category.
 *
 * Queries DealEmbedding model for completed deals with this vendor,
 * and NegotiationPattern model for category-level patterns.
 *
 * @param vendorId - Vendor user ID
 * @param productCategory - Optional product category for pattern matching
 * @returns Historical insights or null if no history available
 */
export async function getHistoricalInsights(
  vendorId: number,
  productCategory?: string
): Promise<HistoricalInsights> {
  try {
    // Query DealEmbedding for completed deals with this vendor
    const vendorDeals = await models.DealEmbedding.findAll({
      where: {
        vendorId,
        finalStatus: {
          [Op.in]: ['ACCEPTED', 'WALKED_AWAY', 'ESCALATED'],
        },
        embeddingType: 'outcome',
      },
      order: [['createdAt', 'DESC']],
      limit: 20, // Last 20 deals for analysis
    });

    if (vendorDeals.length === 0) {
      // No history - return defaults
      return {
        avgRoundsToClose: 0,
        avgPriceReduction: 0,
        anchorEffectiveness: 0,
        vendorBehaviorProfile: 'unknown',
        sampleSize: 0,
      };
    }

    // Compute averages from historical deals
    let totalRounds = 0;
    let totalPriceReduction = 0;
    let totalAnchorEffectiveness = 0;
    let acceptedCount = 0;
    let walkedAwayCount = 0;
    let validPriceDeals = 0;

    for (const deal of vendorDeals) {
      // Rounds to close
      if (deal.totalRounds != null) {
        totalRounds += deal.totalRounds;
      }

      // Price reduction
      const anchor = deal.anchorPrice != null ? Number(deal.anchorPrice) : null;
      const target = deal.targetPrice != null ? Number(deal.targetPrice) : null;
      const final = deal.finalPrice != null ? Number(deal.finalPrice) : null;

      if (anchor != null && target != null && final != null && anchor > 0) {
        const priceReduction = (anchor - final) / anchor;
        totalPriceReduction += priceReduction;

        // Anchor effectiveness: how much of (anchor - target) gap was captured
        const gap = anchor - target;
        if (gap > 0) {
          const captured = anchor - final;
          totalAnchorEffectiveness += captured / gap;
        }
        validPriceDeals++;
      }

      // Status counting
      if (deal.finalStatus === 'ACCEPTED') acceptedCount++;
      if (deal.finalStatus === 'WALKED_AWAY') walkedAwayCount++;
    }

    const sampleSize = vendorDeals.length;
    const avgRoundsToClose = totalRounds / sampleSize;
    const avgPriceReduction = validPriceDeals > 0 ? totalPriceReduction / validPriceDeals : 0;
    const anchorEffectiveness = validPriceDeals > 0 ? totalAnchorEffectiveness / validPriceDeals : 0;

    // Determine vendor behavior profile
    let vendorBehaviorProfile: HistoricalInsights['vendorBehaviorProfile'] = 'unknown';
    if (sampleSize >= 2) {
      if (avgRoundsToClose < 3 && acceptedCount / sampleSize > 0.6) {
        vendorBehaviorProfile = 'quick_closer';
      } else if (walkedAwayCount / sampleSize > 0.4) {
        vendorBehaviorProfile = 'walker';
      } else if (avgRoundsToClose >= 5) {
        vendorBehaviorProfile = 'hard_negotiator';
      }
    }

    // Optionally enrich with NegotiationPattern data
    if (productCategory) {
      try {
        const patterns = await models.NegotiationPattern.findAll({
          where: {
            isActive: true,
            productCategories: {
              [Op.contains]: [productCategory],
            },
            patternType: 'successful_negotiation',
          },
          limit: 5,
        });

        // If we have category patterns with better sample sizes, blend them in
        for (const pattern of patterns) {
          if (pattern.sampleCount > sampleSize * 2) {
            // Category has much more data - weight it
            const catWeight = 0.3;
            const vendorWeight = 0.7;
            if (pattern.avgPriceReduction != null) {
              const blended = avgPriceReduction * vendorWeight + Number(pattern.avgPriceReduction) * catWeight;
              // Only update if we have vendor data too (otherwise skip)
              if (validPriceDeals > 0) {
                return {
                  avgRoundsToClose: pattern.avgRounds != null
                    ? avgRoundsToClose * vendorWeight + Number(pattern.avgRounds) * catWeight
                    : avgRoundsToClose,
                  avgPriceReduction: blended,
                  anchorEffectiveness,
                  vendorBehaviorProfile,
                  sampleSize,
                };
              }
            }
          }
        }
      } catch (patternError) {
        // Non-critical: continue with vendor-only data
        logger.debug('[HistoricalAnalyzer] Category pattern lookup failed:', patternError);
      }
    }

    return {
      avgRoundsToClose,
      avgPriceReduction,
      anchorEffectiveness,
      vendorBehaviorProfile,
      sampleSize,
    };
  } catch (error) {
    logger.warn('[HistoricalAnalyzer] Failed to get historical insights:', error);
    // Return safe defaults on error
    return {
      avgRoundsToClose: 0,
      avgPriceReduction: 0,
      anchorEffectiveness: 0,
      vendorBehaviorProfile: 'unknown',
      sampleSize: 0,
    };
  }
}

// ============================================
// ADAPTIVE ANCHORING
// ============================================

/**
 * Adjust the opening anchor price based on historical vendor behavior.
 *
 * Rules:
 * - Quick closers (< 3 rounds avg): vendor probably would have gone lower,
 *   decrease anchor by 5% (more aggressive opening)
 * - Walkers (history of walking away): increase anchor by 5% (less aggressive opening)
 * - No history: return base anchor unchanged
 * - Clamp: never go below 70% of target or above target
 *
 * @param baseAnchor - The original anchor from wizard config
 * @param target - The PM's target price
 * @param insights - Historical insights for this vendor
 * @returns Adjusted anchor price
 */
export function adjustAnchorFromHistory(
  baseAnchor: number,
  target: number,
  insights: HistoricalInsights
): number {
  // No history - return unchanged
  if (insights.sampleSize === 0 || insights.vendorBehaviorProfile === 'unknown') {
    return baseAnchor;
  }

  let adjustedAnchor = baseAnchor;

  switch (insights.vendorBehaviorProfile) {
    case 'quick_closer':
      // Vendor accepts quickly - we can be more aggressive (lower anchor)
      adjustedAnchor = baseAnchor * 0.95;
      break;

    case 'walker':
      // Vendor tends to walk away - be less aggressive (higher anchor)
      adjustedAnchor = baseAnchor * 1.05;
      break;

    case 'hard_negotiator':
      // Hard negotiator - slight adjustment based on anchor effectiveness
      if (insights.anchorEffectiveness > 0.8) {
        // Our anchoring works well against this vendor - keep it aggressive
        adjustedAnchor = baseAnchor * 0.97;
      } else if (insights.anchorEffectiveness < 0.4) {
        // Our anchor doesn't work well - ease off slightly
        adjustedAnchor = baseAnchor * 1.03;
      }
      break;
  }

  // Clamp: never below 70% of target and never above target
  const floor = target * 0.70;
  adjustedAnchor = Math.max(floor, Math.min(target, adjustedAnchor));

  return Math.round(adjustedAnchor * 100) / 100;
}

export default {
  getHistoricalInsights,
  adjustAnchorFromHistory,
};
