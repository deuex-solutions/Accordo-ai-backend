/**
 * Tone Detector Module
 *
 * Analyzes vendor messages to detect communication tone and style.
 * Used to adapt PM responses to match vendor's communication style.
 *
 * Detected tones:
 * - formal: Professional, business-like language
 * - casual: Friendly, informal language
 * - urgent: Time-sensitive, pressing communication
 * - firm: Strong stance, non-negotiable signals
 * - friendly: Warm, relationship-building tone
 *
 * @module toneDetector
 */

import logger from "../../../config/logger.js";

/**
 * Detected vendor tone types
 */
export type VendorTone = "formal" | "casual" | "urgent" | "firm" | "friendly";

/**
 * Tone detection result with confidence score
 *
 * Role in the new pipeline (Feb 2026):
 * - primaryTone and intensity feed NegotiationIntent.vendorTone
 * - Tone is now metadata only — it no longer drives template selection or wording
 * - getResponseStyleRecommendation() is deprecated (kept for INSIGHTS mode compatibility)
 */
export interface ToneDetectionResult {
  primaryTone: VendorTone;
  confidence: number;
  /**
   * Intensity of the detected tone (0–1).
   * Derived from confidence — a stronger signal = higher intensity.
   * Used by NegotiationIntent to calibrate firmness expression.
   */
  intensity: number;
  indicators: string[];
  allTones: Partial<Record<VendorTone, number>>;
}

/**
 * Message interface for tone detection
 */
export interface ToneMessage {
  role: "VENDOR" | "ACCORDO" | "SYSTEM";
  content: string;
}

/**
 * Tone indicator patterns with associated weights
 */
const TONE_PATTERNS: Record<
  VendorTone,
  { patterns: RegExp[]; weight: number }[]
> = {
  formal: [
    {
      patterns: [/\bdear\b/i, /\bsir\b/i, /\bmadam\b/i, /\brespectfully\b/i],
      weight: 2,
    },
    {
      patterns: [/\bplease find\b/i, /\bkindly\b/i, /\bI would like to\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bwe would like to\b/i, /\bthank you for\b/i, /\bregards\b/i],
      weight: 1,
    },
    {
      patterns: [/\bpursuant to\b/i, /\bin accordance with\b/i, /\bhereby\b/i],
      weight: 2,
    },
    {
      patterns: [/\bbest regards\b/i, /\bsincerely\b/i, /\bfaithfully\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bwe propose\b/i, /\bour proposal\b/i, /\bwe offer\b/i],
      weight: 1,
    },
  ],
  casual: [
    { patterns: [/\bhey\b/i, /\bhi\b/i, /\byeah\b/i, /\bnope\b/i], weight: 2 },
    { patterns: [/\bsure\b/i, /\bsounds good\b/i, /\bcool\b/i], weight: 1.5 },
    {
      patterns: [/\bworks for me\b/i, /\bno problem\b/i, /\bgotcha\b/i],
      weight: 1.5,
    },
    { patterns: [/\bguess\b/i, /\bkinda\b/i, /\bsorta\b/i], weight: 1 },
    { patterns: [/!{2,}/i, /\bbtw\b/i, /\bfyi\b/i], weight: 1 },
    { patterns: [/\blol\b/i, /\bhaha\b/i, /:\)/i, /:D/i], weight: 2 },
  ],
  urgent: [
    { patterns: [/\basap\b/i, /\burgent\b/i, /\bimmediately\b/i], weight: 2.5 },
    {
      patterns: [/\bdeadline\b/i, /\btime-sensitive\b/i, /\btime sensitive\b/i],
      weight: 2,
    },
    {
      patterns: [
        /\bas soon as possible\b/i,
        /\bright away\b/i,
        /\bimmediately\b/i,
      ],
      weight: 2,
    },
    {
      patterns: [/\bcrucial\b/i, /\bcritical\b/i, /\bpressing\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bcan't wait\b/i, /\bcan not wait\b/i, /\bneed this\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bby today\b/i, /\bby tomorrow\b/i, /\bby end of\b/i],
      weight: 1.5,
    },
  ],
  firm: [
    {
      patterns: [/\bfinal offer\b/i, /\bfinal price\b/i, /\bfinal terms\b/i],
      weight: 2.5,
    },
    {
      patterns: [
        /\bbest we can\b/i,
        /\blowest we can\b/i,
        /\bhighest we can\b/i,
      ],
      weight: 2,
    },
    {
      patterns: [
        /\bnon-negotiable\b/i,
        /\bnonnegotiable\b/i,
        /\bnot negotiable\b/i,
      ],
      weight: 2.5,
    },
    {
      patterns: [
        /\btake it or leave\b/i,
        /\bthat's it\b/i,
        /\bcan't go lower\b/i,
      ],
      weight: 2,
    },
    {
      patterns: [/\bunfortunately\b/i, /\bregrettably\b/i, /\bunable to\b/i],
      weight: 1,
    },
    {
      patterns: [/\bfirmly\b/i, /\bstrongly believe\b/i, /\binsist\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bcannot\b/i, /\bwill not\b/i, /\brefuse to\b/i],
      weight: 1.5,
    },
  ],
  friendly: [
    {
      patterns: [/\bappreciate\b/i, /\bthank you\b/i, /\bthanks\b/i],
      weight: 1,
    },
    {
      patterns: [/\bhappy to\b/i, /\bglad to\b/i, /\bpleased to\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\blook forward\b/i, /\blooking forward\b/i, /\bexcited\b/i],
      weight: 1.5,
    },
    {
      patterns: [/\bpartnership\b/i, /\brelationship\b/i, /\bwork together\b/i],
      weight: 1.5,
    },
    { patterns: [/\bhope\b/i, /\btrust\b/i, /\bvalue\b/i], weight: 1 },
    {
      patterns: [/\bwin-win\b/i, /\bmutual\b/i, /\bboth parties\b/i],
      weight: 1.5,
    },
    { patterns: [/\bhelp\b/i, /\bsupport\b/i, /\bassist\b/i], weight: 1 },
  ],
};

/**
 * Detect tone from a single message
 */
function detectToneFromMessage(
  content: string,
): Partial<Record<VendorTone, number>> {
  const scores: Partial<Record<VendorTone, number>> = {};

  for (const [tone, patternGroups] of Object.entries(TONE_PATTERNS)) {
    let totalScore = 0;

    for (const { patterns, weight } of patternGroups) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          totalScore += weight;
        }
      }
    }

    if (totalScore > 0) {
      scores[tone as VendorTone] = totalScore;
    }
  }

  return scores;
}

/**
 * Get matched tone indicators from a message
 */
function getMatchedIndicators(content: string): string[] {
  const indicators: string[] = [];

  for (const [tone, patternGroups] of Object.entries(TONE_PATTERNS)) {
    for (const { patterns } of patternGroups) {
      for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
          indicators.push(`${tone}: "${match[0]}"`);
        }
      }
    }
  }

  return indicators;
}

/**
 * Detect vendor tone from conversation history
 *
 * Analyzes vendor messages to determine their communication style.
 * Focuses on the most recent messages with higher weight.
 *
 * @param messages - Conversation history
 * @returns Tone detection result with primary tone and confidence
 *
 * @example
 * ```typescript
 * const result = detectVendorTone([
 *   { role: 'VENDOR', content: 'Dear Sir, I would like to propose...' },
 *   { role: 'ACCORDO', content: 'Thank you for your offer...' },
 *   { role: 'VENDOR', content: 'Respectfully, our final offer is...' }
 * ]);
 * // result.primaryTone = 'formal'
 * // result.confidence = 0.85
 * ```
 */
export function detectVendorTone(messages: ToneMessage[]): ToneDetectionResult {
  const vendorMessages = messages.filter((m) => m.role === "VENDOR");

  if (vendorMessages.length === 0) {
    // Default to friendly if no vendor messages
    return {
      primaryTone: "friendly",
      confidence: 0.5,
      intensity: 0.5,
      indicators: [],
      allTones: { friendly: 1 },
    };
  }

  // Aggregate scores with recency weighting (newer = higher weight)
  const aggregatedScores: Partial<Record<VendorTone, number>> = {};
  let allIndicators: string[] = [];

  vendorMessages.forEach((msg, index) => {
    // Weight increases with recency (last message has highest weight)
    const recencyWeight = 1 + index / vendorMessages.length;
    const messageScores = detectToneFromMessage(msg.content);
    const indicators = getMatchedIndicators(msg.content);
    allIndicators = allIndicators.concat(indicators);

    for (const [tone, score] of Object.entries(messageScores)) {
      const weightedScore = (score || 0) * recencyWeight;
      aggregatedScores[tone as VendorTone] =
        (aggregatedScores[tone as VendorTone] || 0) + weightedScore;
    }
  });

  // Find primary tone
  let primaryTone: VendorTone = "friendly"; // Default
  let maxScore = 0;
  let totalScore = 0;

  for (const [tone, score] of Object.entries(aggregatedScores)) {
    totalScore += score || 0;
    if ((score || 0) > maxScore) {
      maxScore = score || 0;
      primaryTone = tone as VendorTone;
    }
  }

  // Calculate confidence (0-1)
  let confidence = 0.5; // Default confidence
  if (totalScore > 0 && maxScore > 0) {
    // Confidence based on how dominant the primary tone is
    confidence = Math.min(1, 0.5 + (maxScore / totalScore) * 0.5);
  }

  // Deduplicate indicators
  const uniqueIndicators = [...new Set(allIndicators)].slice(0, 5);

  logger.debug("[ToneDetector] Detected tone", {
    primaryTone,
    confidence,
    scores: aggregatedScores,
    indicatorCount: uniqueIndicators.length,
  });

  return {
    primaryTone,
    confidence,
    // Intensity mirrors confidence — capped at 1.0, floored at 0.1
    intensity: Math.max(0.1, Math.min(1.0, confidence)),
    indicators: uniqueIndicators,
    allTones: aggregatedScores,
  };
}

/**
 * Get a description of the detected tone for prompt engineering
 */
export function getToneDescription(tone: VendorTone): string {
  const descriptions: Record<VendorTone, string> = {
    formal: "formal and professional, using polite business language",
    casual: "casual and conversational, using friendly informal language",
    urgent: "urgent and time-sensitive, emphasizing deadlines and speed",
    firm: "firm and determined, holding their position strongly",
    friendly: "warm and friendly, focused on building a good relationship",
  };

  return descriptions[tone] || descriptions.friendly;
}

/**
 * Get recommended response style for a given tone
 *
 * @deprecated Feb 2026 — Tone is now metadata only in the CONVERSATION pipeline.
 * In the new pipeline, vendorTone is passed into NegotiationIntent and the LLM
 * is instructed to mirror it. This function is kept only for INSIGHTS mode
 * compatibility (responseGenerator.ts) and should not be used in new code.
 */
export function getResponseStyleRecommendation(tone: VendorTone): {
  style: string;
  salutation: string;
  closing: string;
} {
  const recommendations: Record<
    VendorTone,
    { style: string; salutation: string; closing: string }
  > = {
    formal: {
      style: "Use formal, professional language with proper structure",
      salutation: "Thank you for your proposal",
      closing: "We look forward to reaching a mutually beneficial agreement",
    },
    casual: {
      style: "Keep it conversational and friendly, be direct",
      salutation: "Thanks for getting back to us",
      closing: "Let's make this work",
    },
    urgent: {
      style: "Be concise and action-oriented, acknowledge their timeline",
      salutation: "I understand time is of the essence",
      closing: "Let's finalize this quickly",
    },
    firm: {
      style: "Be respectful but equally clear about your position",
      salutation: "I appreciate your position",
      closing: "I hope we can find common ground",
    },
    friendly: {
      style: "Match their warmth while staying professional",
      salutation: "Great to hear from you",
      closing: "Looking forward to working together",
    },
  };

  return recommendations[tone] || recommendations.friendly;
}

/**
 * Strict firmness signals from the CURRENT vendor message.
 * Higher bar than the multi-message tone scoring above — used by CONVERSATION
 * mode to switch to last-attempt / escalate behavior.
 */
const STRICT_FIRMNESS_PATTERNS: RegExp[] = [
  /\bfinal\s+(offer|price|terms|number|quote)\b/i,
  /\bis\s+final\b/i,
  /\bnon[- ]?negotiable\b/i,
  /\bnot\s+negotiable\b/i,
  /\btake\s+it\s+or\s+leave\s+it\b/i,
  /\bcan('?t|not)\s+go\s+(any\s+)?lower\b/i,
  /\bwon('?t|not)\s+go\s+(any\s+)?lower\b/i,
  /\b(my|our)\s+best\s+(price|offer)\b/i,
  /\bbest\s+i\s+can\s+do\b/i,
  /\blowest\s+i\s+can\s+(go|offer)\b/i,
  /\bthat'?s\s+(my|our)\s+(final|last)\b/i,
  /\blast\s+offer\b/i,
];

/**
 * Detect strict firmness in a single vendor message.
 * Returns true only when the message contains an unambiguous "this is final"
 * signal — used for triggering last-attempt / escalation logic.
 */
export function detectStrictFirmness(message: string): {
  isFirm: boolean;
  matched: string | null;
} {
  if (!message) return { isFirm: false, matched: null };
  for (const pattern of STRICT_FIRMNESS_PATTERNS) {
    const match = message.match(pattern);
    if (match) return { isFirm: true, matched: match[0] };
  }
  return { isFirm: false, matched: null };
}

export default {
  detectVendorTone,
  getToneDescription,
  getResponseStyleRecommendation,
  detectStrictFirmness,
};
