/**
 * Conversation History Sanitizer
 *
 * Removes stale negotiation context from conversation history
 * before LLM calls. Old messages containing outdated statements
 * like "vendor has declined" can poison the LLM, causing it to
 * repeat outdated positions even when the vendor has changed stance.
 *
 * Inspired by Owl's conversation history sanitization pattern.
 *
 * @module historySanitizer
 */

import logger from '../../../config/logger.js';

/**
 * A conversation message for sanitization
 */
export interface SanitizableMessage {
  role: string;
  content: string;
  [key: string]: unknown;
}

/**
 * Result of sanitization
 */
export interface SanitizationResult {
  /** The sanitized messages */
  messages: SanitizableMessage[];
  /** Number of messages that were sanitized */
  sanitizedCount: number;
  /** The patterns that triggered sanitization */
  triggeredPatterns: string[];
}

/**
 * Stale negotiation patterns that should be neutralized.
 *
 * Each pattern represents a statement that was true at the time
 * but may no longer be accurate. When detected in ACCORDO messages,
 * the text is replaced with a neutral note so the LLM doesn't
 * repeat outdated context.
 */
const STALE_NEGOTIATION_PATTERNS: { pattern: RegExp; label: string }[] = [
  // Vendor position statements that may have changed
  {
    pattern: /vendor\s+(?:has\s+)?(?:already\s+)?(?:declined|rejected|refused|turned down)/i,
    label: 'vendor_declined',
  },
  {
    pattern: /vendor\s+(?:is\s+)?(?:not\s+)?(?:willing|interested|open)\s+to/i,
    label: 'vendor_unwilling',
  },
  {
    pattern: /vendor\s+(?:will\s+)?(?:not|never)\s+(?:accept|agree|go below|go above)/i,
    label: 'vendor_will_not',
  },

  // Deal state statements that may have changed
  {
    pattern: /deal\s+(?:is\s+)?(?:already\s+)?(?:locked|closed|finalized|concluded|terminated)/i,
    label: 'deal_locked',
  },
  {
    pattern: /negotiation\s+(?:has\s+)?(?:already\s+)?(?:ended|concluded|failed|terminated)/i,
    label: 'negotiation_ended',
  },

  // Authority/policy statements that may be outdated
  {
    pattern: /(?:insufficient|no|lack)\s+(?:of\s+)?(?:authority|permission|approval)\s+to/i,
    label: 'no_authority',
  },
  {
    pattern: /cannot\s+(?:proceed|continue|negotiate)\s+(?:because|due to)\s+(?:policy|regulation|compliance)/i,
    label: 'policy_block',
  },

  // Availability statements
  {
    pattern: /(?:product|item|material)\s+(?:is\s+)?(?:no longer|not)\s+(?:available|in stock)/i,
    label: 'not_available',
  },

  // Price floor/ceiling statements that may have shifted
  {
    pattern: /(?:cannot|will not|won't)\s+go\s+(?:below|above|lower|higher)\s+(?:than\s+)?\$?[\d,]+/i,
    label: 'price_boundary',
  },
];

/**
 * The replacement text for sanitized messages.
 * This is neutral and instructs the LLM to use current deal state.
 */
const SANITIZED_REPLACEMENT = '[Previous context may be outdated. Use the current deal state and latest vendor message for your response.]';

/**
 * Sanitize conversation history by detecting and neutralizing
 * stale negotiation context in ACCORDO messages.
 *
 * Only ACCORDO (PM) messages are sanitized — vendor messages
 * are preserved as-is since they represent actual vendor statements.
 * SYSTEM messages are also preserved.
 *
 * @param messages - The conversation history to sanitize
 * @returns Sanitized messages with metadata
 */
export function sanitizeNegotiationHistory(messages: SanitizableMessage[]): SanitizationResult {
  let sanitizedCount = 0;
  const triggeredPatterns: string[] = [];

  const sanitized = messages.map(msg => {
    // Only sanitize ACCORDO messages — vendor and system messages are preserved
    if (msg.role !== 'ACCORDO') {
      return msg;
    }

    const content = msg.content || '';

    // Check against all stale patterns
    let hasStaleContent = false;
    for (const { pattern, label } of STALE_NEGOTIATION_PATTERNS) {
      if (pattern.test(content)) {
        hasStaleContent = true;
        if (!triggeredPatterns.includes(label)) {
          triggeredPatterns.push(label);
        }
      }
    }

    if (hasStaleContent) {
      sanitizedCount++;
      logger.info('[HistorySanitizer] Sanitized stale ACCORDO message', {
        contentPreview: content.substring(0, 80),
        patterns: triggeredPatterns,
      });

      return {
        ...msg,
        content: SANITIZED_REPLACEMENT,
      };
    }

    return msg;
  });

  if (sanitizedCount > 0) {
    logger.info('[HistorySanitizer] Sanitization complete', {
      totalMessages: messages.length,
      sanitizedCount,
      triggeredPatterns,
    });
  }

  return {
    messages: sanitized,
    sanitizedCount,
    triggeredPatterns,
  };
}
