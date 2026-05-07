/**
 * Preference Tracker
 *
 * Tracks vendor preferences discovered through MESO selections and
 * negotiation patterns. Used to improve future counter-offers.
 *
 * @module preferenceTracker
 */

import type { MesoOption, MesoSelection, MesoRoundRecord } from './meso.js';
import type { NegotiationState, VendorEmphasis } from './types.js';

// ============================================
// Types
// ============================================

/**
 * Vendor preference profile built from MESO selections
 */
export interface VendorPreferenceProfile {
  /** Vendor ID */
  vendorId: number;
  /** Deal ID for this profile */
  dealId: string;
  /** Number of MESO rounds tracked */
  mesoRoundsTracked: number;
  /** Accumulated preference scores */
  preferenceScores: {
    price: number;
    paymentTerms: number;
    delivery: number;
    warranty: number;
    quality: number;
  };
  /** Confidence in the profile (0-1) */
  confidence: number;
  /** Primary preference (highest score) */
  primaryPreference: string;
  /** Secondary preference */
  secondaryPreference: string | null;
  /** History of MESO selections */
  selectionHistory: MesoSelectionHistory[];
  /** Last updated timestamp */
  lastUpdatedAt: Date;
}

/**
 * Historical record of a MESO selection
 */
export interface MesoSelectionHistory {
  round: number;
  selectedOptionId: string;
  selectedEmphasis: string[];
  timestamp: Date;
}

/**
 * Preference adjustment recommendations
 */
export interface PreferenceAdjustment {
  /** Parameter to adjust */
  parameter: string;
  /** Adjustment amount (-1 to 1) */
  adjustment: number;
  /** Confidence in this adjustment */
  confidence: number;
  /** Reasoning for the adjustment */
  reason: string;
}

// ============================================
// Preference Profile Management
// ============================================

/**
 * Create an empty preference profile
 */
export function createEmptyProfile(vendorId: number, dealId: string): VendorPreferenceProfile {
  return {
    vendorId,
    dealId,
    mesoRoundsTracked: 0,
    preferenceScores: {
      price: 0.5,
      paymentTerms: 0.5,
      delivery: 0.5,
      warranty: 0.5,
      quality: 0.5,
    },
    confidence: 0,
    primaryPreference: 'unknown',
    secondaryPreference: null,
    selectionHistory: [],
    lastUpdatedAt: new Date(),
  };
}

/**
 * Update preference profile based on MESO selection
 */
export function updateProfileFromSelection(
  profile: VendorPreferenceProfile,
  selection: MesoSelection,
  selectedOption: MesoOption,
  round: number
): VendorPreferenceProfile {
  const updatedProfile = { ...profile };

  // Record selection in history
  updatedProfile.selectionHistory.push({
    round,
    selectedOptionId: selection.selectedOptionId,
    selectedEmphasis: selectedOption.emphasis,
    timestamp: new Date(),
  });

  // Update preference scores based on selection emphasis
  const { preferenceAdjustments } = selection.inferredPreferences;

  for (const [param, adjustment] of Object.entries(preferenceAdjustments)) {
    const key = normalizePreferenceKey(param);
    if (key in updatedProfile.preferenceScores) {
      // Apply adjustment with decay (older selections matter less)
      const decayFactor = 0.9; // Recent selections weighted more
      const currentScore = updatedProfile.preferenceScores[key as keyof typeof updatedProfile.preferenceScores];
      updatedProfile.preferenceScores[key as keyof typeof updatedProfile.preferenceScores] =
        currentScore * decayFactor + adjustment * (1 - decayFactor);

      // Clamp to [0, 1]
      updatedProfile.preferenceScores[key as keyof typeof updatedProfile.preferenceScores] =
        Math.max(0, Math.min(1, updatedProfile.preferenceScores[key as keyof typeof updatedProfile.preferenceScores]));
    }
  }

  // Update tracking counts
  updatedProfile.mesoRoundsTracked += 1;

  // Update confidence based on number of rounds tracked
  updatedProfile.confidence = Math.min(0.9, 0.3 + updatedProfile.mesoRoundsTracked * 0.15);

  // Determine primary and secondary preferences
  const sortedPreferences = Object.entries(updatedProfile.preferenceScores)
    .sort(([, a], [, b]) => b - a);

  updatedProfile.primaryPreference = sortedPreferences[0][0];
  updatedProfile.secondaryPreference =
    sortedPreferences.length > 1 && sortedPreferences[1][1] > 0.4
      ? sortedPreferences[1][0]
      : null;

  updatedProfile.lastUpdatedAt = new Date();

  return updatedProfile;
}

/**
 * Normalize preference key names
 */
function normalizePreferenceKey(key: string): string {
  const mapping: Record<string, string> = {
    price: 'price',
    total_price: 'price',
    targetUnitPrice: 'price',
    payment_terms: 'paymentTerms',
    paymentTerms: 'paymentTerms',
    paymentTermsRange: 'paymentTerms',
    delivery: 'delivery',
    deliveryDate: 'delivery',
    warranty: 'warranty',
    warrantyPeriod: 'warranty',
    quality: 'quality',
    qualityStandards: 'quality',
  };

  return mapping[key] || key;
}

// ============================================
// Preference Analysis
// ============================================

/**
 * Analyze preference profile to generate strategy recommendations
 */
export function analyzePreferences(
  profile: VendorPreferenceProfile
): PreferenceAdjustment[] {
  const adjustments: PreferenceAdjustment[] = [];

  if (profile.confidence < 0.3) {
    return adjustments; // Not enough data for reliable adjustments
  }

  const { preferenceScores, confidence } = profile;

  // Strong price preference
  if (preferenceScores.price > 0.7) {
    adjustments.push({
      parameter: 'price',
      adjustment: 0.15,
      confidence: confidence * 0.9,
      reason: 'Vendor shows strong price sensitivity',
    });
    adjustments.push({
      parameter: 'paymentTerms',
      adjustment: -0.10,
      confidence: confidence * 0.7,
      reason: 'Can concede on payment terms for better price',
    });
  }

  // Strong payment terms preference
  if (preferenceScores.paymentTerms > 0.7) {
    adjustments.push({
      parameter: 'paymentTerms',
      adjustment: 0.15,
      confidence: confidence * 0.9,
      reason: 'Vendor prioritizes payment flexibility',
    });
    adjustments.push({
      parameter: 'price',
      adjustment: -0.08,
      confidence: confidence * 0.7,
      reason: 'Can push harder on price for longer terms',
    });
  }

  // Strong delivery preference
  if (preferenceScores.delivery > 0.7) {
    adjustments.push({
      parameter: 'delivery',
      adjustment: 0.12,
      confidence: confidence * 0.85,
      reason: 'Vendor values quick delivery',
    });
  }

  // Strong warranty preference
  if (preferenceScores.warranty > 0.7) {
    adjustments.push({
      parameter: 'warranty',
      adjustment: 0.10,
      confidence: confidence * 0.8,
      reason: 'Vendor values warranty coverage',
    });
  }

  return adjustments;
}

/**
 * Convert preference profile to vendor emphasis for legacy system
 */
export function profileToVendorEmphasis(
  profile: VendorPreferenceProfile
): { emphasis: VendorEmphasis; confidence: number } {
  if (profile.confidence < 0.3) {
    return { emphasis: 'unknown', confidence: profile.confidence };
  }

  const { primaryPreference, preferenceScores } = profile;

  if (primaryPreference === 'price' && preferenceScores.price > 0.6) {
    return { emphasis: 'price-focused', confidence: profile.confidence };
  }

  if (primaryPreference === 'paymentTerms' && preferenceScores.paymentTerms > 0.6) {
    return { emphasis: 'terms-focused', confidence: profile.confidence };
  }

  return { emphasis: 'balanced', confidence: profile.confidence };
}

// ============================================
// Cross-Deal Learning Integration
// ============================================

/**
 * Merge preference profiles from multiple deals for vendor-level learning
 */
export function mergeProfiles(
  profiles: VendorPreferenceProfile[]
): VendorPreferenceProfile | null {
  if (profiles.length === 0) return null;

  const vendorId = profiles[0].vendorId;

  // Create merged profile
  const mergedProfile: VendorPreferenceProfile = {
    vendorId,
    dealId: 'merged',
    mesoRoundsTracked: profiles.reduce((sum, p) => sum + p.mesoRoundsTracked, 0),
    preferenceScores: {
      price: 0.5,
      paymentTerms: 0.5,
      delivery: 0.5,
      warranty: 0.5,
      quality: 0.5,
    },
    confidence: 0,
    primaryPreference: 'unknown',
    secondaryPreference: null,
    selectionHistory: [],
    lastUpdatedAt: new Date(),
  };

  // Weight more recent profiles higher
  const totalWeight = profiles.reduce((sum, p, i) => {
    const recencyWeight = Math.pow(0.9, profiles.length - 1 - i); // More recent = higher weight
    return sum + p.confidence * recencyWeight;
  }, 0);

  if (totalWeight === 0) return mergedProfile;

  // Weighted average of preference scores
  for (const profile of profiles) {
    const weight = profile.confidence / totalWeight;

    for (const [key, value] of Object.entries(profile.preferenceScores)) {
      mergedProfile.preferenceScores[key as keyof typeof mergedProfile.preferenceScores] +=
        value * weight;
    }
  }

  // Normalize to [0, 1]
  for (const key of Object.keys(mergedProfile.preferenceScores)) {
    const val = mergedProfile.preferenceScores[key as keyof typeof mergedProfile.preferenceScores];
    mergedProfile.preferenceScores[key as keyof typeof mergedProfile.preferenceScores] =
      Math.max(0, Math.min(1, val));
  }

  // Calculate merged confidence
  mergedProfile.confidence = Math.min(0.95, totalWeight / profiles.length);

  // Merge selection histories
  mergedProfile.selectionHistory = profiles
    .flatMap((p) => p.selectionHistory)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 20); // Keep last 20 selections

  // Determine primary/secondary preferences
  const sortedPreferences = Object.entries(mergedProfile.preferenceScores)
    .sort(([, a], [, b]) => b - a);

  mergedProfile.primaryPreference = sortedPreferences[0][0];
  mergedProfile.secondaryPreference =
    sortedPreferences.length > 1 && sortedPreferences[1][1] > 0.4
      ? sortedPreferences[1][0]
      : null;

  return mergedProfile;
}

/**
 * Apply learned preferences to weight adjustments
 */
export function applyPreferencesToWeights(
  baseWeights: Record<string, number>,
  profile: VendorPreferenceProfile | null,
  adjustmentStrength: number = 0.3
): Record<string, number> {
  if (!profile || profile.confidence < 0.3) {
    return { ...baseWeights };
  }

  const adjustedWeights = { ...baseWeights };
  const adjustments = analyzePreferences(profile);

  for (const adjustment of adjustments) {
    const paramKey = mapPreferenceToWeightKey(adjustment.parameter);
    if (paramKey && paramKey in adjustedWeights) {
      const currentWeight = adjustedWeights[paramKey];
      const weightAdjustment = adjustment.adjustment * adjustmentStrength * 100;
      adjustedWeights[paramKey] = Math.max(0, Math.min(100, currentWeight + weightAdjustment));
    }
  }

  // Normalize weights to sum to 100
  const totalWeight = Object.values(adjustedWeights).reduce((a, b) => a + b, 0);
  if (totalWeight > 0 && totalWeight !== 100) {
    const scale = 100 / totalWeight;
    for (const key of Object.keys(adjustedWeights)) {
      adjustedWeights[key] = Math.round(adjustedWeights[key] * scale);
    }
  }

  return adjustedWeights;
}

/**
 * Map preference parameter to weight key
 */
function mapPreferenceToWeightKey(preference: string): string | null {
  const mapping: Record<string, string> = {
    price: 'targetUnitPrice',
    paymentTerms: 'paymentTermsRange',
    delivery: 'deliveryDate',
    warranty: 'warrantyPeriod',
    quality: 'qualityStandards',
  };

  return mapping[preference] || null;
}
