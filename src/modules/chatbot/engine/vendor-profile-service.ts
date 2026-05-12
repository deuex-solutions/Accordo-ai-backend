/**
 * Vendor Profile Service
 *
 * Manages persistent vendor negotiation profiles for Pactum-style
 * behavioral learning across deals.
 */

import type { Transaction } from 'sequelize';
import type {
  VendorNegotiationProfile,
  PreferredTermsJson,
  ResponseTimeStatsJson,
  ConcessionPatternsJson,
  MesoPreferencesJson,
  VendorNegotiationStyle,
} from '../../../models/vendor-negotiation-profile.js';

/**
 * Deal outcome data for profile updates
 */
export interface DealOutcome {
  dealId: string;
  vendorId: number;
  finalStatus: 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED';
  totalRounds: number;
  finalPriceReduction: number | null; // Percentage
  finalUtility: number | null;
  concessionHistory: Array<{
    round: number;
    priceChange: number; // Percentage change from previous round
    timestamp: Date;
  }>;
  finalTerms: {
    paymentTermsDays?: number;
    advancePaymentPercent?: number;
    deliveryDays?: number;
    warrantyMonths?: number;
  };
  mesoSelections?: Array<{
    round: number;
    selectedEmphasis: string;
    options: string[];
  }>;
}

/**
 * Profile summary for decision making
 */
export interface VendorProfileSummary {
  vendorId: number;
  totalDeals: number;
  successRate: number;
  negotiationStyle: VendorNegotiationStyle;
  styleConfidence: number;
  avgConcessionRate: number;
  avgRoundsToClose: number;
  preferredTerms: PreferredTermsJson | null;
  mesoPreferences: MesoPreferencesJson | null;
  recommendations: string[];
}

/**
 * Get or create a vendor negotiation profile
 */
export async function getOrCreateProfile(
  vendorId: number
): Promise<VendorNegotiationProfile> {
  // Dynamic import to avoid circular dependencies
  const { VendorNegotiationProfile } = await import('../../../models/vendor-negotiation-profile.js');

  let profile = await VendorNegotiationProfile.findOne({
    where: { vendorId },
  });

  if (!profile) {
    profile = await VendorNegotiationProfile.create({
      vendorId,
      totalDeals: 0,
      acceptedDeals: 0,
      walkedAwayDeals: 0,
      escalatedDeals: 0,
      negotiationStyle: 'unknown',
    });
  }

  return profile;
}

/**
 * Get vendor profile summary for decision making
 */
export async function getVendorProfileSummary(
  vendorId: number
): Promise<VendorProfileSummary | null> {
  const { VendorNegotiationProfile } = await import('../../../models/vendor-negotiation-profile.js');

  const profile = await VendorNegotiationProfile.findOne({
    where: { vendorId },
  });

  if (!profile || profile.totalDeals === 0) {
    return null;
  }

  const recommendations: string[] = [];

  // Generate recommendations based on profile
  if (profile.negotiationStyle === 'aggressive' && (profile.styleConfidence ?? 0) > 0.7) {
    recommendations.push('Vendor tends to be aggressive - consider stronger initial positions');
  } else if (profile.negotiationStyle === 'collaborative' && (profile.styleConfidence ?? 0) > 0.7) {
    recommendations.push('Vendor is collaborative - MESO options may be effective');
  } else if (profile.negotiationStyle === 'passive' && (profile.styleConfidence ?? 0) > 0.7) {
    recommendations.push('Vendor is passive - may accept first reasonable offer');
  }

  if (profile.avgRoundsToClose !== null && profile.avgRoundsToClose < 3) {
    recommendations.push('Vendor typically closes quickly - start closer to target');
  } else if (profile.avgRoundsToClose !== null && profile.avgRoundsToClose > 6) {
    recommendations.push('Vendor takes many rounds - be patient with concessions');
  }

  if (profile.mesoPreferences?.primaryPreference) {
    recommendations.push(
      `Vendor prioritizes ${profile.mesoPreferences.primaryPreference} - emphasize this in offers`
    );
  }

  return {
    vendorId: profile.vendorId,
    totalDeals: profile.totalDeals,
    successRate: profile.successRate ?? 0,
    negotiationStyle: profile.negotiationStyle,
    styleConfidence: profile.styleConfidence ?? 0,
    avgConcessionRate: profile.avgConcessionRate ?? 0,
    avgRoundsToClose: profile.avgRoundsToClose ?? 0,
    preferredTerms: profile.preferredTerms,
    mesoPreferences: profile.mesoPreferences,
    recommendations,
  };
}

/**
 * Update vendor profile after deal completion
 */
export async function updateProfileAfterDeal(
  outcome: DealOutcome,
  transaction?: Transaction
): Promise<VendorNegotiationProfile> {
  const {} = await import('../../../models/vendor-negotiation-profile.js');

  const profile = await getOrCreateProfile(outcome.vendorId);

  // Update deal counts
  const newTotalDeals = profile.totalDeals + 1;
  let newAcceptedDeals = profile.acceptedDeals;
  let newWalkedAwayDeals = profile.walkedAwayDeals;
  let newEscalatedDeals = profile.escalatedDeals;

  if (outcome.finalStatus === 'ACCEPTED') {
    newAcceptedDeals++;
  } else if (outcome.finalStatus === 'WALKED_AWAY') {
    newWalkedAwayDeals++;
  } else if (outcome.finalStatus === 'ESCALATED') {
    newEscalatedDeals++;
  }

  // Calculate new success rate
  const newSuccessRate = newAcceptedDeals / newTotalDeals;

  // Update average rounds to close (weighted average)
  const prevWeight = profile.totalDeals;
  const newAvgRoundsToClose =
    prevWeight > 0 && profile.avgRoundsToClose !== null
      ? (profile.avgRoundsToClose * prevWeight + outcome.totalRounds) / newTotalDeals
      : outcome.totalRounds;

  // Update average final utility
  const newAvgFinalUtility =
    outcome.finalUtility !== null
      ? prevWeight > 0 && profile.avgFinalUtility !== null
        ? (profile.avgFinalUtility * prevWeight + outcome.finalUtility) / newTotalDeals
        : outcome.finalUtility
      : profile.avgFinalUtility;

  // Update average price reduction
  const newAvgPriceReduction =
    outcome.finalPriceReduction !== null
      ? prevWeight > 0 && profile.avgPriceReduction !== null
        ? (profile.avgPriceReduction * prevWeight + outcome.finalPriceReduction) / newTotalDeals
        : outcome.finalPriceReduction
      : profile.avgPriceReduction;

  // Calculate concession patterns
  const newConcessionPatterns = calculateConcessionPatterns(
    outcome.concessionHistory,
    profile.concessionPatterns
  );

  // Update average concession rate from patterns
  const newAvgConcessionRate = newConcessionPatterns?.avgConcessionPerRound ?? profile.avgConcessionRate;

  // Update preferred terms
  const newPreferredTerms = updatePreferredTerms(
    outcome.finalTerms,
    profile.preferredTerms,
    newTotalDeals
  );

  // Update MESO preferences if available
  const newMesoPreferences = outcome.mesoSelections
    ? updateMesoPreferences(outcome.mesoSelections, profile.mesoPreferences, newTotalDeals)
    : profile.mesoPreferences;

  // Detect negotiation style
  const { style, confidence } = detectNegotiationStyle(
    newConcessionPatterns,
    newAvgRoundsToClose,
    newSuccessRate,
    newTotalDeals
  );

  // Update response time stats (if we have timing data)
  const newResponseTimeStats = updateResponseTimeStats(
    outcome.concessionHistory,
    profile.responseTimeStats
  );

  // Perform update
  await profile.update(
    {
      totalDeals: newTotalDeals,
      acceptedDeals: newAcceptedDeals,
      walkedAwayDeals: newWalkedAwayDeals,
      escalatedDeals: newEscalatedDeals,
      avgConcessionRate: newAvgConcessionRate,
      avgRoundsToClose: newAvgRoundsToClose,
      avgFinalUtility: newAvgFinalUtility,
      avgPriceReduction: newAvgPriceReduction,
      preferredTerms: newPreferredTerms,
      negotiationStyle: style,
      styleConfidence: confidence,
      successRate: newSuccessRate,
      responseTimeStats: newResponseTimeStats,
      concessionPatterns: newConcessionPatterns,
      mesoPreferences: newMesoPreferences,
      lastDealAt: new Date(),
    },
    { transaction }
  );

  return profile;
}

/**
 * Calculate concession patterns from history
 */
function calculateConcessionPatterns(
  history: DealOutcome['concessionHistory'],
  existingPatterns: ConcessionPatternsJson | null
): ConcessionPatternsJson | null {
  if (!history || history.length === 0) {
    return existingPatterns;
  }

  const concessions = history.map((h) => Math.abs(h.priceChange));
  const avgConcession = concessions.reduce((a, b) => a + b, 0) / concessions.length;
  const firstRound = concessions[0] || 0;
  const finalConcession = concessions[concessions.length - 1] || 0;

  // Detect if concessions are accelerating (larger later)
  let accelerating = false;
  if (concessions.length >= 3) {
    const firstHalf = concessions.slice(0, Math.floor(concessions.length / 2));
    const secondHalf = concessions.slice(Math.floor(concessions.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    accelerating = secondAvg > firstAvg * 1.2;
  }

  const newPattern: ConcessionPatternsJson = {
    avgConcessionPerRound: avgConcession,
    firstRoundConcession: firstRound,
    accelerating,
    finalConcession,
    roundPattern: concessions,
  };

  // Merge with existing patterns (weighted average)
  if (existingPatterns && existingPatterns.avgConcessionPerRound !== undefined) {
    const weight = 0.7; // Weight towards new data
    return {
      avgConcessionPerRound:
        existingPatterns.avgConcessionPerRound * (1 - weight) +
        newPattern.avgConcessionPerRound * weight,
      firstRoundConcession:
        existingPatterns.firstRoundConcession * (1 - weight) +
        newPattern.firstRoundConcession * weight,
      accelerating: newPattern.accelerating,
      finalConcession:
        existingPatterns.finalConcession * (1 - weight) + newPattern.finalConcession * weight,
      roundPattern: newPattern.roundPattern,
    };
  }

  return newPattern;
}

/**
 * Update preferred terms based on deal outcome
 */
function updatePreferredTerms(
  finalTerms: DealOutcome['finalTerms'],
  existingTerms: PreferredTermsJson | null,
  totalDeals: number
): PreferredTermsJson | null {
  if (!finalTerms || Object.keys(finalTerms).length === 0) {
    return existingTerms;
  }

  const weight = totalDeals > 1 ? 1 / totalDeals : 1;
  const existingWeight = 1 - weight;

  const newTerms: PreferredTermsJson = {
    paymentTermsDays:
      finalTerms.paymentTermsDays !== undefined
        ? existingTerms?.paymentTermsDays !== undefined
          ? Math.round(
              existingTerms.paymentTermsDays * existingWeight +
                finalTerms.paymentTermsDays * weight
            )
          : finalTerms.paymentTermsDays
        : existingTerms?.paymentTermsDays,
    advancePaymentPercent:
      finalTerms.advancePaymentPercent !== undefined
        ? existingTerms?.advancePaymentPercent !== undefined
          ? existingTerms.advancePaymentPercent * existingWeight +
            finalTerms.advancePaymentPercent * weight
          : finalTerms.advancePaymentPercent
        : existingTerms?.advancePaymentPercent,
    deliveryDays:
      finalTerms.deliveryDays !== undefined
        ? existingTerms?.deliveryDays !== undefined
          ? Math.round(
              existingTerms.deliveryDays * existingWeight + finalTerms.deliveryDays * weight
            )
          : finalTerms.deliveryDays
        : existingTerms?.deliveryDays,
    warrantyMonths:
      finalTerms.warrantyMonths !== undefined
        ? existingTerms?.warrantyMonths !== undefined
          ? Math.round(
              existingTerms.warrantyMonths * existingWeight + finalTerms.warrantyMonths * weight
            )
          : finalTerms.warrantyMonths
        : existingTerms?.warrantyMonths,
    flexibility: existingTerms?.flexibility || {},
  };

  return newTerms;
}

/**
 * Update MESO preferences from selections
 */
function updateMesoPreferences(
  mesoSelections: DealOutcome['mesoSelections'],
  existingPreferences: MesoPreferencesJson | null,
  totalDeals: number
): MesoPreferencesJson | null {
  if (!mesoSelections || mesoSelections.length === 0) {
    return existingPreferences;
  }

  // Count emphasis selections
  const emphasisCounts: Record<string, number> = {};
  for (const selection of mesoSelections) {
    const emphasis = selection.selectedEmphasis.toLowerCase();
    emphasisCounts[emphasis] = (emphasisCounts[emphasis] || 0) + 1;
  }

  // Calculate preference scores
  const totalSelections = mesoSelections.length;
  const scores = {
    price: (emphasisCounts['price'] || emphasisCounts['value'] || 0) / totalSelections,
    paymentTerms: (emphasisCounts['payment'] || emphasisCounts['terms'] || 0) / totalSelections,
    delivery: (emphasisCounts['delivery'] || emphasisCounts['speed'] || 0) / totalSelections,
    warranty: (emphasisCounts['warranty'] || emphasisCounts['quality'] || 0) / totalSelections,
    quality: (emphasisCounts['quality'] || 0) / totalSelections,
  };

  // Find primary preference
  const maxScore = Math.max(...Object.values(scores));
  const primaryPreference =
    (Object.entries(scores).find(([_, v]) => v === maxScore)?.[0] as string) || 'price';

  const newPreferences: MesoPreferencesJson = {
    scores,
    primaryPreference,
    confidence: maxScore > 0.4 ? 0.8 : maxScore > 0.2 ? 0.5 : 0.3,
    mesoRoundsAnalyzed: totalSelections,
  };

  // Merge with existing
  if (existingPreferences && existingPreferences.mesoRoundsAnalyzed > 0) {
    const weight = totalSelections / (existingPreferences.mesoRoundsAnalyzed + totalSelections);
    const existingWeight = 1 - weight;

    return {
      scores: {
        price: existingPreferences.scores.price * existingWeight + scores.price * weight,
        paymentTerms:
          existingPreferences.scores.paymentTerms * existingWeight + scores.paymentTerms * weight,
        delivery: existingPreferences.scores.delivery * existingWeight + scores.delivery * weight,
        warranty: existingPreferences.scores.warranty * existingWeight + scores.warranty * weight,
        quality: existingPreferences.scores.quality * existingWeight + scores.quality * weight,
      },
      primaryPreference: newPreferences.primaryPreference,
      confidence: Math.max(existingPreferences.confidence, newPreferences.confidence),
      mesoRoundsAnalyzed: existingPreferences.mesoRoundsAnalyzed + totalSelections,
    };
  }

  return newPreferences;
}

/**
 * Detect negotiation style from patterns
 */
function detectNegotiationStyle(
  patterns: ConcessionPatternsJson | null,
  avgRoundsToClose: number,
  successRate: number,
  totalDeals: number
): { style: VendorNegotiationStyle; confidence: number } {
  if (totalDeals < 2) {
    return { style: 'unknown', confidence: 0.1 };
  }

  let aggressiveScore = 0;
  let collaborativeScore = 0;
  let passiveScore = 0;

  // Analyze concession patterns
  if (patterns) {
    // Aggressive: low concessions, holds firm
    if (patterns.avgConcessionPerRound < 2) aggressiveScore += 0.3;
    if (patterns.firstRoundConcession < 1) aggressiveScore += 0.2;

    // Collaborative: moderate, steady concessions
    if (patterns.avgConcessionPerRound >= 2 && patterns.avgConcessionPerRound <= 5) {
      collaborativeScore += 0.3;
    }
    if (!patterns.accelerating) collaborativeScore += 0.1;

    // Passive: high concessions, accelerating
    if (patterns.avgConcessionPerRound > 5) passiveScore += 0.3;
    if (patterns.accelerating) passiveScore += 0.2;
  }

  // Analyze rounds to close
  if (avgRoundsToClose < 3) passiveScore += 0.2;
  else if (avgRoundsToClose > 6) aggressiveScore += 0.2;
  else collaborativeScore += 0.2;

  // Analyze success rate
  if (successRate > 0.8) passiveScore += 0.1;
  else if (successRate < 0.4) aggressiveScore += 0.1;
  else collaborativeScore += 0.1;

  // Determine style
  const maxScore = Math.max(aggressiveScore, collaborativeScore, passiveScore);
  let style: VendorNegotiationStyle = 'unknown';
  let confidence = 0;

  if (maxScore >= 0.3) {
    if (aggressiveScore === maxScore) style = 'aggressive';
    else if (collaborativeScore === maxScore) style = 'collaborative';
    else if (passiveScore === maxScore) style = 'passive';

    // Confidence based on total deals and score margin
    const secondMax = [aggressiveScore, collaborativeScore, passiveScore]
      .filter((s) => s !== maxScore)
      .sort((a, b) => b - a)[0] || 0;
    const margin = maxScore - secondMax;
    confidence = Math.min(0.3 + totalDeals * 0.1 + margin * 2, 0.95);
  }

  return { style, confidence };
}

/**
 * Update response time statistics
 */
function updateResponseTimeStats(
  history: DealOutcome['concessionHistory'],
  existingStats: ResponseTimeStatsJson | null
): ResponseTimeStatsJson | null {
  if (!history || history.length < 2) {
    return existingStats;
  }

  // Calculate response times between rounds
  const responseTimes: number[] = [];
  for (let i = 1; i < history.length; i++) {
    const diff = history[i].timestamp.getTime() - history[i - 1].timestamp.getTime();
    if (diff > 0 && diff < 7 * 24 * 60 * 60 * 1000) {
      // Max 7 days
      responseTimes.push(diff);
    }
  }

  if (responseTimes.length === 0) {
    return existingStats;
  }

  const avgMs = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
  const minMs = Math.min(...responseTimes);
  const maxMs = Math.max(...responseTimes);

  const newStats: ResponseTimeStatsJson = {
    avgMs,
    minMs,
    maxMs,
    sampleCount: responseTimes.length,
  };

  // Merge with existing
  if (existingStats && existingStats.sampleCount > 0) {
    const totalSamples = existingStats.sampleCount + newStats.sampleCount;
    return {
      avgMs:
        (existingStats.avgMs * existingStats.sampleCount + avgMs * newStats.sampleCount) /
        totalSamples,
      minMs: Math.min(existingStats.minMs, minMs),
      maxMs: Math.max(existingStats.maxMs, maxMs),
      sampleCount: totalSamples,
    };
  }

  return newStats;
}

/**
 * Get all vendor profiles with deal history
 */
export async function getAllVendorProfiles(
  minDeals = 1
): Promise<VendorNegotiationProfile[]> {
  const { VendorNegotiationProfile } = await import('../../../models/vendor-negotiation-profile.js');
  const { Op } = await import('sequelize');

  return VendorNegotiationProfile.findAll({
    where: {
      totalDeals: {
        [Op.gte]: minDeals,
      },
    },
    order: [['totalDeals', 'DESC']],
  });
}

/**
 * Find similar vendors by negotiation style
 */
export async function findSimilarVendors(
  vendorId: number,
  limit = 5
): Promise<VendorNegotiationProfile[]> {
  const { VendorNegotiationProfile } = await import('../../../models/vendor-negotiation-profile.js');
  const { Op } = await import('sequelize');

  const profile = await VendorNegotiationProfile.findOne({
    where: { vendorId },
  });

  if (!profile || profile.negotiationStyle === 'unknown') {
    return [];
  }

  return VendorNegotiationProfile.findAll({
    where: {
      vendorId: {
        [Op.ne]: vendorId,
      },
      negotiationStyle: profile.negotiationStyle,
      totalDeals: {
        [Op.gte]: 2,
      },
    },
    order: [
      ['styleConfidence', 'DESC'],
      ['totalDeals', 'DESC'],
    ],
    limit,
  });
}

export default {
  getOrCreateProfile,
  getVendorProfileSummary,
  updateProfileAfterDeal,
  getAllVendorProfiles,
  findSimilarVendors,
};
