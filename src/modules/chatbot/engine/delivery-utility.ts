/**
 * Delivery Utility Calculation Module
 *
 * Calculates utility scores for delivery dates based on:
 * - Required delivery date (must meet)
 * - Preferred delivery date (ideal)
 * - Offered delivery date from vendor
 *
 * Utility scoring:
 * - 1.0: On or before preferred date (excellent)
 * - 0.7-0.99: Between preferred and required dates (good)
 * - 0.3-0.69: After required but within acceptable range (warning)
 * - 0.0-0.29: Beyond acceptable range (critical)
 *
 * @module deliveryUtility
 */

import logger from '../../../config/logger.js';

/**
 * Configuration for delivery utility calculation
 */
export interface DeliveryConfig {
  /** Required delivery date (must meet) - ISO string */
  requiredDate: string | Date | null;
  /** Preferred delivery date (ideal) - ISO string, defaults to requiredDate */
  preferredDate?: string | Date | null;
  /** Maximum acceptable days beyond required date */
  maxLateDays?: number;
}

/**
 * Result of delivery utility calculation
 */
export interface DeliveryUtilityResult {
  utility: number;
  status: 'excellent' | 'good' | 'warning' | 'critical' | 'neutral';
  daysFromPreferred: number | null;
  daysFromRequired: number | null;
  offeredDate: Date | null;
  requiredDate: Date | null;
  preferredDate: Date | null;
  reason: string;
}

/**
 * Parse a delivery date from various formats
 *
 * Supports:
 * - ISO date strings (2026-03-15)
 * - Date objects
 * - Relative phrases ("within 30 days", "2 weeks")
 * - Natural language ("by March 15", "early March")
 */
export function parseDeliveryDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;

  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }

  const text = input.trim();

  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(text);
    return isNaN(d.getTime()) ? null : d;
  }

  // Try MM/DD/YYYY or DD/MM/YYYY format
  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const [, a, b, year] = slashMatch;
    // Assume MM/DD/YYYY for US format
    const fullYear = year.length === 2 ? `20${year}` : year;
    const d = new Date(`${fullYear}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`);
    return isNaN(d.getTime()) ? null : d;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Relative days: "within 30 days", "in 2 weeks", "15 days delivery"
  const relativeMatch = text.match(/(?:within|in|next)\s*(\d+)\s*(days?|weeks?|business\s*days?)/i);
  if (relativeMatch) {
    const num = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const multiplier = unit.includes('week') ? 7 : 1;
    const result = new Date(today);
    result.setDate(result.getDate() + num * multiplier);
    return result;
  }

  // Delivery days pattern: "30 days delivery", "delivery 2 weeks"
  const deliveryDaysMatch = text.match(/(\d+)\s*(days?|weeks?)\s*(?:delivery|shipping|lead\s*time)/i) ||
                            text.match(/(?:delivery|shipping|lead\s*time)\s*(?:in|of)?\s*(\d+)\s*(days?|weeks?)/i);
  if (deliveryDaysMatch) {
    const num = parseInt(deliveryDaysMatch[1], 10);
    const unit = deliveryDaysMatch[2].toLowerCase();
    const multiplier = unit.includes('week') ? 7 : 1;
    const result = new Date(today);
    result.setDate(result.getDate() + num * multiplier);
    return result;
  }

  // Natural language dates: "by March 15", "March 15th 2026", "15th March"
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  // Match "March 15" or "March 15th" or "15 March" or "15th March"
  const naturalMatch = text.match(
    new RegExp(`(?:by\\s+)?(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+)?(${monthNames.join('|')}|${monthAbbr.join('|')})(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?(?:,?\\s*(\\d{4}))?`, 'i')
  );

  if (naturalMatch) {
    const [, dayBefore, monthStr, dayAfter, yearStr] = naturalMatch;
    const day = parseInt(dayBefore || dayAfter || '1', 10);
    const monthLower = monthStr.toLowerCase();
    let month = monthNames.indexOf(monthLower);
    if (month === -1) {
      month = monthAbbr.indexOf(monthLower.substring(0, 3));
    }
    const year = yearStr ? parseInt(yearStr, 10) : today.getFullYear();

    if (month !== -1 && day >= 1 && day <= 31) {
      const result = new Date(year, month, day);
      // If the date is in the past this year, assume next year
      if (!yearStr && result < today) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return isNaN(result.getTime()) ? null : result;
    }
  }

  // Timeframe patterns: "early March", "mid February", "end of March"
  const timeframeMatch = text.match(
    new RegExp(`(early|mid|late|end\\s+of)\\s+(${monthNames.join('|')}|${monthAbbr.join('|')})(?:\\s*(\\d{4}))?`, 'i')
  );

  if (timeframeMatch) {
    const [, position, monthStr, yearStr] = timeframeMatch;
    const monthLower = monthStr.toLowerCase();
    let month = monthNames.indexOf(monthLower);
    if (month === -1) {
      month = monthAbbr.indexOf(monthLower.substring(0, 3));
    }
    const year = yearStr ? parseInt(yearStr, 10) : today.getFullYear();

    if (month !== -1) {
      let day = 15; // Default to mid-month
      const posLower = position.toLowerCase();
      if (posLower === 'early') day = 7;
      else if (posLower === 'mid') day = 15;
      else if (posLower === 'late' || posLower.includes('end')) {
        // Get last day of month
        day = new Date(year, month + 1, 0).getDate();
      }

      const result = new Date(year, month, day);
      if (!yearStr && result < today) {
        result.setFullYear(result.getFullYear() + 1);
      }
      return isNaN(result.getTime()) ? null : result;
    }
  }

  return null;
}

/**
 * Calculate delivery days from today
 */
export function calculateDeliveryDays(date: Date | null): number | null {
  if (!date) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  return diffDays;
}

/**
 * Format a delivery date for display
 */
export function formatDeliveryDate(date: Date | null): string {
  if (!date) return 'Not specified';

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

/**
 * Format delivery in short form (e.g., "Mar 15")
 */
export function formatDeliveryShort(date: Date | null): string {
  if (!date) return 'TBD';

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Calculate utility score for a delivery date
 *
 * @param offeredDate - Date offered by vendor
 * @param config - Delivery configuration with required/preferred dates
 * @returns Delivery utility result with score and metadata
 *
 * @example
 * ```typescript
 * const result = calculateDeliveryUtility(
 *   new Date('2026-03-15'),
 *   {
 *     requiredDate: '2026-03-20',
 *     preferredDate: '2026-03-10',
 *     maxLateDays: 14
 *   }
 * );
 * // result.utility = 0.85 (between preferred and required)
 * ```
 */
export function calculateDeliveryUtility(
  offeredDate: Date | string | null | undefined,
  config: DeliveryConfig
): DeliveryUtilityResult {
  // Parse dates
  const offered = offeredDate instanceof Date ? offeredDate : parseDeliveryDate(offeredDate);
  const required = config.requiredDate instanceof Date
    ? config.requiredDate
    : parseDeliveryDate(config.requiredDate);
  const preferred = config.preferredDate
    ? (config.preferredDate instanceof Date ? config.preferredDate : parseDeliveryDate(config.preferredDate))
    : required; // Default preferred to required if not specified

  const maxLateDays = config.maxLateDays ?? 14; // Default 2 weeks grace

  // If no delivery info, return neutral
  if (!offered || !required) {
    return {
      utility: 0.5, // Neutral
      status: 'neutral',
      daysFromPreferred: null,
      daysFromRequired: null,
      offeredDate: offered,
      requiredDate: required,
      preferredDate: preferred,
      reason: !offered
        ? 'No delivery date specified by vendor'
        : 'No required delivery date configured'
    };
  }

  // Set times to midnight for fair comparison
  const offeredNorm = new Date(offered);
  offeredNorm.setHours(0, 0, 0, 0);
  const requiredNorm = new Date(required);
  requiredNorm.setHours(0, 0, 0, 0);
  const preferredNorm = preferred ? new Date(preferred) : requiredNorm;
  preferredNorm.setHours(0, 0, 0, 0);

  // Calculate days difference
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysFromPreferred = Math.floor((offeredNorm.getTime() - preferredNorm.getTime()) / msPerDay);
  const daysFromRequired = Math.floor((offeredNorm.getTime() - requiredNorm.getTime()) / msPerDay);

  let utility: number;
  let status: DeliveryUtilityResult['status'];
  let reason: string;

  if (daysFromPreferred <= 0) {
    // On or before preferred date = excellent
    utility = 1.0;
    status = 'excellent';
    reason = daysFromPreferred === 0
      ? 'Delivery exactly on preferred date'
      : `Delivery ${Math.abs(daysFromPreferred)} days before preferred date`;
  } else if (daysFromRequired <= 0) {
    // Between preferred and required dates = good
    // Linear interpolation from 0.7 to 0.99
    const range = Math.abs(requiredNorm.getTime() - preferredNorm.getTime()) / msPerDay;
    if (range > 0) {
      utility = 0.7 + 0.29 * (1 - daysFromPreferred / range);
    } else {
      utility = 1.0; // If preferred == required and we're on it
    }
    status = 'good';
    reason = daysFromRequired === 0
      ? 'Delivery exactly on required date'
      : `Delivery ${Math.abs(daysFromRequired)} days before required date`;
  } else if (daysFromRequired <= maxLateDays) {
    // After required but within acceptable window = warning
    // Linear interpolation from 0.3 to 0.69
    utility = 0.3 + 0.39 * (1 - daysFromRequired / maxLateDays);
    status = 'warning';
    reason = `Delivery ${daysFromRequired} days after required date (within ${maxLateDays}-day grace period)`;
  } else {
    // Beyond acceptable window = critical
    // Utility drops from 0.3 down to minimum 0
    const extraDays = daysFromRequired - maxLateDays;
    utility = Math.max(0, 0.3 - extraDays * 0.03);
    status = 'critical';
    reason = `Delivery ${daysFromRequired} days after required date (exceeds ${maxLateDays}-day grace period)`;
  }

  logger.debug('[DeliveryUtility] Calculated', {
    offered: offeredNorm.toISOString().split('T')[0],
    required: requiredNorm.toISOString().split('T')[0],
    preferred: preferredNorm.toISOString().split('T')[0],
    daysFromPreferred,
    daysFromRequired,
    utility,
    status
  });

  return {
    utility,
    status,
    daysFromPreferred,
    daysFromRequired,
    offeredDate: offered,
    requiredDate: required,
    preferredDate: preferred,
    reason
  };
}

/**
 * Generate a counter-offer delivery date based on config
 *
 * @param config - Delivery configuration
 * @param vendorOffer - Vendor's offered date (to consider)
 * @returns Counter delivery date
 */
export function generateCounterDeliveryDate(
  config: DeliveryConfig,
  vendorOffer?: Date | string | null
): Date | null {
  const required = config.requiredDate instanceof Date
    ? config.requiredDate
    : parseDeliveryDate(config.requiredDate);

  if (!required) return null;

  const preferred = config.preferredDate
    ? (config.preferredDate instanceof Date ? config.preferredDate : parseDeliveryDate(config.preferredDate))
    : required;

  // Counter with preferred date if it exists and is before required
  if (preferred && preferred < required) {
    return preferred;
  }

  return required;
}

export default {
  parseDeliveryDate,
  calculateDeliveryDays,
  formatDeliveryDate,
  formatDeliveryShort,
  calculateDeliveryUtility,
  generateCounterDeliveryDate
};
