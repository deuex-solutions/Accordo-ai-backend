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
  const wordCount = content.trim().split(/\s+/).length;

  // In Indian English, "sir" is a casual address term (like "bhai" or "ji"),
  // not a formality indicator. Detect when "sir" is the ONLY formal marker in
  // a short message and downweight it so it doesn't dominate tone detection.
  const hasSirOnly =
    /\bsir\b/i.test(content) &&
    !/\b(dear|madam|respectfully|kindly|sincerely|regards|pursuant|hereby|faithfully)\b/i.test(
      content,
    );
  const sirDownweight = hasSirOnly && wordCount <= 15;

  for (const [tone, patternGroups] of Object.entries(TONE_PATTERNS)) {
    let totalScore = 0;

    for (const { patterns, weight } of patternGroups) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          let effectiveWeight = weight;
          // Downweight "sir" in short messages without other formal cues
          if (
            sirDownweight &&
            tone === "formal" &&
            pattern.source.includes("sir")
          ) {
            effectiveWeight = 0.3;
          }
          totalScore += effectiveWeight;
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

// ─────────────────────────────────────────────
// Vendor-Style Detector (Apr 2026 — humanization pass)
//
// Pure function: extracts deterministic signals from the latest vendor message
// (and prior offers) so the persona-renderer and decision engine can react
// without leaking strategy. Used for adaptive humanization in CONVERSATION mode.
// ─────────────────────────────────────────────

/**
 * Detected language code (ISO 639-1 subset we explicitly support for mirroring).
 * "und" = undetermined / low confidence.
 */
export type VendorLanguage = "en" | "es" | "hi" | "fr" | "de" | "pt" | "und";

export interface VendorStyle {
  /** Formality on a 0–1 scale (0 = very casual, 1 = very formal). */
  formality: number;
  /** Word count of the latest vendor message. */
  length: number;
  /** Detected language of the latest vendor message. */
  language: VendorLanguage;
  /** Confidence in language detection (0–1). Below 0.6 → caller should inherit prev language. */
  languageConfidence: number;
  /** True when the vendor message reads as hostile/rude (drops adaptive mirroring). */
  hostility: boolean;
  /** True when the vendor asked a direct question. */
  hasQuestion: boolean;
  /** True when the message is essentially just a number/price with no prose. */
  isNumberOnly: boolean;
  /** True when the message opens with a greeting ("hi", "hola", "namaste", etc.). */
  hasGreeting: boolean;
  /**
   * How many times the vendor has stated this exact same price across recent rounds
   * (current message included). 1 = first time, 3 = trigger threshold for escape hatch.
   */
  repeatedOfferCount: number;
  /** The numeric price extracted from the latest vendor message, if any. */
  lastVendorPrice: number | null;
  /** True when the vendor message reads as an acceptance ("ok deal", "we accept", etc.). */
  acceptanceDetected: boolean;
}

// Hostility patterns — explicit rudeness or contempt (NOT mere firmness)
const HOSTILITY_PATTERNS: RegExp[] = [
  /\bare\s+you\s+(serious|kidding|joking)\b/i,
  /\bthis\s+(price|offer|quote)\s+is\s+a?\s*(joke|insult|ridiculous|absurd)\b/i,
  /\b(ridiculous|absurd|laughable|insulting|outrageous)\b/i,
  /\bwasting\s+(my|our)\s+time\b/i,
  /\bdon'?t\s+(insult|waste)\b/i,
  /\bget\s+real\b/i,
  /\bnot\s+gonna\s+happen\b/i,
];

// Acceptance patterns — vendor explicitly agreeing to a price/deal
const ACCEPTANCE_PATTERNS: RegExp[] = [
  /\b(ok|okay|alright|fine)[,.\s]+(deal|done|agreed|let'?s\s+go)\b/i,
  /\b(we|i)\s+(accept|agree|will\s+accept|are\s+in)\b/i,
  /\b(deal|done|agreed|sold)\b\s*[!.]?\s*$/i,
  /\bsounds\s+(good|great)\b.*\b(deal|agreed|let'?s)\b/i,
  /\blet'?s\s+(do\s+it|go\s+with\s+(that|it|this))\b/i,
];

// Simple greeting tokens across languages we support
const GREETING_PATTERNS: RegExp[] = [
  /^\s*(hi|hello|hey|good\s+(morning|afternoon|evening)|dear|greetings)\b/i,
  /^\s*(hola|buenos\s+(d[ií]as|tardes|noches))\b/i,
  /^\s*(namaste|namaskar)\b/i,
  /^\s*(bonjour|salut)\b/i,
  /^\s*(hallo|guten\s+(tag|morgen|abend))\b/i,
  /^\s*(ol[áa]|bom\s+dia|boa\s+(tarde|noite))\b/i,
];

// Lightweight language fingerprints — common stop-words
const LANGUAGE_HINTS: Record<Exclude<VendorLanguage, "und">, RegExp[]> = {
  en: [
    /\b(the|and|with|please|thanks|that|this|would|could|will|have|our|your)\b/gi,
  ],
  es: [
    /\b(el|la|los|las|de|por\s+favor|gracias|nuestro|nuestra|saludos|hola)\b/gi,
  ],
  hi: [
    /\b(aap|kya|hai|hain|kripaya|dhanyavaad|namaste|theek|bahut)\b/gi,
    /[\u0900-\u097F]/g,
  ],
  fr: [/\b(le|la|les|de|merci|s'il\s+vous\s+pla[ií]t|bonjour|nous|votre)\b/gi],
  de: [/\b(der|die|das|und|bitte|danke|wir|ihre|hallo|sehr)\b/gi],
  pt: [/\b(o|a|os|as|de|obrigado|obrigada|por\s+favor|nosso|nossa|ol[áa])\b/gi],
};

function detectLanguage(text: string): {
  language: VendorLanguage;
  confidence: number;
} {
  const trimmed = text.trim();
  if (trimmed.length < 4) return { language: "und", confidence: 0 };

  const scores: Record<string, number> = {};
  for (const [lang, patterns] of Object.entries(LANGUAGE_HINTS)) {
    let hits = 0;
    for (const pattern of patterns) {
      const matches = trimmed.match(pattern);
      if (matches) hits += matches.length;
    }
    if (hits > 0) scores[lang] = hits;
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return { language: "und", confidence: 0 };

  let topLang: VendorLanguage = "und";
  let topScore = 0;
  for (const [lang, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topLang = lang as VendorLanguage;
    }
  }

  // Confidence: top score share, scaled by message length signal
  const wordCount = trimmed.split(/\s+/).length;
  const share = topScore / total;
  const lengthFactor = Math.min(1, wordCount / 8);
  const confidence = Math.max(0, Math.min(1, share * lengthFactor));

  return { language: topLang, confidence };
}

function detectFormality(text: string, hasGreeting: boolean): number {
  const t = text.toLowerCase();
  let score = 0.5;

  // Formal signals
  if (/\b(dear|sir|madam|respectfully|kindly|sincerely|regards)\b/i.test(text))
    score += 0.25;
  if (
    /\b(pursuant\s+to|in\s+accordance\s+with|hereby|please\s+find)\b/i.test(
      text,
    )
  )
    score += 0.15;
  if (
    hasGreeting &&
    /\b(dear|good\s+(morning|afternoon|evening))\b/i.test(text)
  )
    score += 0.1;

  // Casual signals
  if (/\b(hey|yeah|nope|cool|gotcha|btw|fyi|lol|haha)\b/i.test(t))
    score -= 0.25;
  if (/!{2,}/.test(text)) score -= 0.1;

  // Contractions tilt casual
  const contractions = (t.match(/\b\w+'(s|t|re|ll|ve|d|m)\b/g) || []).length;
  if (contractions >= 2) score -= 0.1;

  // Short-message heuristic: messages under 8 words with no formal markers
  // are almost always casual/terse — pull toward 0.25.
  const wordCount = text.trim().split(/\s+/).length;
  const hasFormalMarker =
    /\b(dear|sir|madam|respectfully|kindly|sincerely|regards|pursuant|hereby)\b/i.test(
      text,
    );
  if (wordCount <= 8 && !hasFormalMarker && score >= 0.4) {
    score = Math.min(score, 0.25);
  }

  return Math.max(0, Math.min(1, score));
}

function isJustNumber(text: string): boolean {
  const stripped = text.replace(/[\s$₹€£,.\-:]/g, "");
  // Pure-digit (with optional currency/punctuation) and short
  return stripped.length > 0 && /^\d+$/.test(stripped) && stripped.length <= 12;
}

function extractFirstPrice(text: string): number | null {
  // Reuse the same patterns as the validator's price extractor (kept local to avoid cross-module deps)
  const dollarPattern = /[$₹€£]\s*([\d,]+(?:\.\d{1,2})?)/;
  const kPattern = /[$₹€£]?\s*([\d.]+)\s*[kK]\b/;
  const mPattern = /[$₹€£]?\s*([\d.]+)\s*[mM]\b/;

  let match = text.match(dollarPattern);
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(value) && value > 100) return value;
  }
  match = text.match(kPattern);
  if (match) {
    const value = parseFloat(match[1]) * 1000;
    if (!isNaN(value) && value > 100) return value;
  }
  match = text.match(mPattern);
  if (match) {
    const value = parseFloat(match[1]) * 1_000_000;
    if (!isNaN(value) && value > 100) return value;
  }

  // Lakh/crore suffix (3.5L = 350,000, 1.2Cr = 12,000,000)
  const lPattern = /\b([\d.]+)\s*(?:L|lakh|lac|lacs|lakhs)\b/i;
  const crPattern = /\b([\d.]+)\s*(?:Cr|crore|crores)\b/i;
  match = text.match(lPattern);
  if (match) {
    const value = parseFloat(match[1]) * 100_000;
    if (!isNaN(value) && value > 100) return value;
  }
  match = text.match(crPattern);
  if (match) {
    const value = parseFloat(match[1]) * 10_000_000;
    if (!isNaN(value) && value > 100) return value;
  }

  // Indian comma format: 3,55,000 or 12,34,567 (lakh grouping: X,XX,XXX)
  const indianComma = text.match(/\b(\d{1,2}(?:,\d{2})*,\d{3})\b/);
  if (indianComma) {
    const value = parseFloat(indianComma[1].replace(/,/g, ""));
    if (!isNaN(value) && value >= 1000) return value;
  }

  // Bare number ≥ 1000 (handles "26000" or "26,000" Western format)
  const bare = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d{1,2})?\b/);
  if (bare) {
    const value = parseFloat(bare[1].replace(/,/g, ""));
    if (!isNaN(value) && value >= 1000) return value;
  }

  return null;
}

/**
 * Count how many recent vendor messages stated the exact same price as `currentPrice`.
 * Includes the current message in the count.
 *
 * "Exact match" per spec: strict equality (no tolerance).
 */
function countRepeatedOffers(
  currentPrice: number | null,
  priorVendorMessages: ToneMessage[],
): number {
  if (currentPrice == null) return 0;

  let count = 1; // include the current statement
  // Walk backwards through prior vendor messages until a different price appears
  for (let i = priorVendorMessages.length - 1; i >= 0; i--) {
    const msg = priorVendorMessages[i];
    if (msg.role !== "VENDOR") continue;
    const priorPrice = extractFirstPrice(msg.content);
    if (priorPrice == null) continue; // non-pricing message — skip, don't break
    if (priorPrice === currentPrice) {
      count += 1;
    } else {
      break; // chain broken
    }
  }
  return count;
}

/**
 * Extract deterministic vendor-style signals from the latest vendor message.
 *
 * @param latestVendorMessage - The most recent vendor message text.
 * @param priorVendorMessages - Prior conversation history (used for repeat-offer chain detection).
 *                              Pass [] when called outside a deal context.
 *
 * Pure function: same inputs → same outputs. Safe to call repeatedly.
 */
export function detectVendorStyle(
  latestVendorMessage: string,
  priorVendorMessages: ToneMessage[] = [],
): VendorStyle {
  const text = latestVendorMessage || "";
  const trimmed = text.trim();
  const wordCount = trimmed === "" ? 0 : trimmed.split(/\s+/).length;

  const hasGreeting = GREETING_PATTERNS.some((p) => p.test(trimmed));
  const formality = detectFormality(text, hasGreeting);
  const hostility = HOSTILITY_PATTERNS.some((p) => p.test(text));
  const hasQuestion = /\?/.test(text);
  const isNumberOnly = isJustNumber(trimmed);
  const acceptanceDetected = ACCEPTANCE_PATTERNS.some((p) => p.test(text));
  const { language, confidence } = detectLanguage(text);
  const lastVendorPrice = extractFirstPrice(text);
  const repeatedOfferCount = countRepeatedOffers(
    lastVendorPrice,
    priorVendorMessages,
  );

  return {
    formality,
    length: wordCount,
    language,
    languageConfidence: confidence,
    hostility,
    hasQuestion,
    isNumberOnly,
    hasGreeting,
    repeatedOfferCount,
    lastVendorPrice,
    acceptanceDetected,
  };
}

// ─────────────────────────────────────────────
// Vendor Concern Extraction (deterministic, no LLM)
// ─────────────────────────────────────────────

/**
 * Extract concrete vendor concerns from their message.
 * ONLY returns concerns the vendor explicitly mentioned — never fabricates.
 * Returns an array of short, normalized concern labels safe to pass to the LLM.
 */
const CONCERN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /\b(timeline|deadline|time.?sensitive|urgent|asap|rush)\b/i,
    label: "timeline pressure",
  },
  {
    pattern: /\b(budget|cash.?flow|liquidity|payment.?cycle|fiscal)\b/i,
    label: "budget constraints",
  },
  {
    pattern: /\b(margin|margins|thin.?margins?|tight.?margins?)\b/i,
    label: "margin pressure",
  },
  {
    pattern:
      /\b(supply.?chain|raw.?material|shortage|availability|back.?order)\b/i,
    label: "supply chain",
  },
  {
    pattern: /\b(volume|bulk|large.?order|quantity.?discount|long.?term)\b/i,
    label: "volume commitment",
  },
  {
    pattern:
      /\b(quality|compliance|certification|standard|spec|specification)\b/i,
    label: "quality requirements",
  },
  {
    pattern:
      /\b(relationship|partnership|long.?standing|repeat.?business|loyal)\b/i,
    label: "relationship value",
  },
  {
    pattern:
      /\b(competitor|alternative|other.?vendor|other.?supplier|market.?rate|going.?rate)\b/i,
    label: "competitive alternatives",
  },
  {
    pattern: /\b(risk|warranty|guarantee|liability|insurance)\b/i,
    label: "risk concerns",
  },
];

export function extractVendorConcerns(vendorMessage: string): string[] {
  if (!vendorMessage || vendorMessage.trim().length < 10) return [];

  const concerns: string[] = [];
  for (const { pattern, label } of CONCERN_PATTERNS) {
    if (pattern.test(vendorMessage) && !concerns.includes(label)) {
      concerns.push(label);
    }
  }
  return concerns.slice(0, 3);
}

export default {
  detectVendorTone,
  getToneDescription,
  getResponseStyleRecommendation,
  detectStrictFirmness,
  detectVendorStyle,
  extractVendorConcerns,
};
