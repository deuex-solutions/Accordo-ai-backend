/**
 * Vendor Scenario Auto-Detection
 *
 * Analyzes vendor's negotiation behavior to automatically detect
 * which scenario (HARD, SOFT, WALK_AWAY) best matches their style.
 */

import type { VendorScenario, ScenarioDetectionResult } from './types.js';
import type { ChatbotMessage } from '../../../models/chatbot-message.js';
import logger from '../../../config/logger.js';

/**
 * Detect vendor scenario based on their negotiation history
 *
 * Algorithm:
 * 1. Calculate average price concession per round
 * 2. Classify based on concession magnitude:
 *    - 0 concessions → WALK_AWAY
 *    - Small concessions (< 2%) → HARD
 *    - Large concessions (≥ 3%) → SOFT
 *
 * @param messages - All messages in the deal (both VENDOR and ACCORDO)
 * @returns Detected scenario with confidence and reasoning
 */
export function detectVendorScenario(messages: ChatbotMessage[]): ScenarioDetectionResult {
  try {
    // Filter vendor messages only
    const vendorMessages = messages.filter((msg) => msg.role === 'VENDOR');

    if (vendorMessages.length < 2) {
      // Not enough data, default to SOFT (neutral scenario)
      return {
        scenario: 'SOFT',
        confidence: 0.3,
        reason: 'Insufficient data (< 2 vendor messages). Defaulting to SOFT scenario.',
        stats: {
          avgConcession: 0,
          concessionCount: 0,
          roundsNegotiated: vendorMessages.length,
        },
      };
    }

    // Calculate price concessions
    let totalConcession = 0;
    let concessionCount = 0;

    for (let i = 1; i < vendorMessages.length; i++) {
      const prevOffer = vendorMessages[i - 1].extractedOffer as {
        total_price: number | null;
        payment_terms: string | null;
      } | null;
      const currentOffer = vendorMessages[i].extractedOffer as {
        total_price: number | null;
        payment_terms: string | null;
      } | null;

      if (!prevOffer || !currentOffer) continue;
      if (prevOffer.total_price === null || currentOffer.total_price === null) continue;

      // Calculate concession (price reduction)
      const concession = prevOffer.total_price - currentOffer.total_price;

      if (concession > 0) {
        // Only count positive concessions (price reductions)
        totalConcession += concession;
        concessionCount++;
      }
    }

    const avgConcession = concessionCount > 0 ? totalConcession / concessionCount : 0;

    logger.info('[ScenarioDetector] Calculated concession stats', {
      avgConcession,
      concessionCount,
      totalConcession,
      roundsNegotiated: vendorMessages.length,
    });

    // Classify based on average concession
    let scenario: VendorScenario;
    let confidence: number;
    let reason: string;

    if (concessionCount === 0) {
      // No concessions made
      scenario = 'WALK_AWAY';
      confidence = 0.9;
      reason = 'Vendor made no price concessions. Inflexible negotiation style.';
    } else if (avgConcession >= 3) {
      // Large concessions (≥ 3 units on average)
      scenario = 'SOFT';
      confidence = 0.85;
      reason = `Vendor made large concessions (avg: ${avgConcession.toFixed(2)}). Flexible negotiation style.`;
    } else if (avgConcession <= 1) {
      // Very small concessions
      scenario = 'HARD';
      confidence = 0.85;
      reason = `Vendor made minimal concessions (avg: ${avgConcession.toFixed(2)}). Resistant negotiation style.`;
    } else {
      // Medium concessions (1-3 units)
      scenario = 'SOFT';
      confidence = 0.7;
      reason = `Vendor made moderate concessions (avg: ${avgConcession.toFixed(2)}). Reasonably flexible.`;
    }

    // Adjust confidence based on sample size
    if (concessionCount < 3) {
      confidence *= 0.8; // Reduce confidence with small sample
    }

    return {
      scenario,
      confidence: Math.min(confidence, 1.0),
      reason,
      stats: {
        avgConcession,
        concessionCount,
        roundsNegotiated: vendorMessages.length,
      },
    };
  } catch (error) {
    logger.error('[ScenarioDetector] Failed to detect scenario', { error });

    // Fallback to SOFT on error
    return {
      scenario: 'SOFT',
      confidence: 0.3,
      reason: `Error during detection: ${error}. Defaulting to SOFT scenario.`,
      stats: {
        avgConcession: 0,
        concessionCount: 0,
        roundsNegotiated: messages.filter((m) => m.role === 'VENDOR').length,
      },
    };
  }
}

/**
 * Get scenario description for UI display
 */
export function getScenarioDescription(scenario: VendorScenario): string {
  const descriptions: Record<VendorScenario, string> = {
    HARD: 'Resistant to concessions. Makes small price reductions only. Likely to hold firm on terms.',
    MEDIUM: 'Balanced approach. Open to negotiation with moderate concessions on both sides.',
    SOFT: 'Willing to negotiate. Makes reasonable concessions on both price and terms.',
    WALK_AWAY: 'Inflexible. Take it or leave it attitude. Unlikely to make concessions.',
  };

  return descriptions[scenario];
}

/**
 * Get emoji representation of scenario
 */
export function getScenarioEmoji(scenario: VendorScenario): string {
  const emojis: Record<VendorScenario, string> = {
    HARD: '🔒', // Lock (difficult to move)
    MEDIUM: '⚖️', // Balance (moderate approach)
    SOFT: '🤝', // Handshake (collaborative)
    WALK_AWAY: '🚪', // Door (ready to leave)
  };

  return emojis[scenario];
}
