/**
 * Concern Extractor Module
 *
 * Analyzes vendor messages to identify and extract their concerns,
 * justifications, and pain points. Used to generate empathetic
 * PM responses that acknowledge vendor perspectives.
 *
 * Concern types:
 * - cost: Material costs, inflation, pricing pressures
 * - timeline: Lead times, production schedules, delays
 * - quality: Standards, certifications, testing requirements
 * - volume: Order quantities, minimum orders, capacity
 * - logistics: Shipping, freight, warehousing
 * - payment: Cash flow, advance payment, credit concerns
 * - relationship: Partnership, long-term business, trust
 *
 * @module concernExtractor
 */

import logger from '../../../config/logger.js';

/**
 * Types of vendor concerns
 */
export type ConcernType =
  | 'cost'
  | 'timeline'
  | 'quality'
  | 'volume'
  | 'logistics'
  | 'payment'
  | 'relationship'
  | 'other';

/**
 * Extracted vendor concern with context
 */
export interface VendorConcern {
  type: ConcernType;
  text: string;
  matchedPhrase: string;
  confidence: number;
}

/**
 * Message interface for concern extraction
 */
export interface ConcernMessage {
  role: 'VENDOR' | 'ACCORDO' | 'SYSTEM';
  content: string;
}

/**
 * Concern pattern definitions
 */
interface ConcernPattern {
  type: ConcernType;
  patterns: RegExp[];
  contextWindow: number; // Characters around match to extract
}

/**
 * Concern patterns with associated context
 */
const CONCERN_PATTERNS: ConcernPattern[] = [
  {
    type: 'cost',
    patterns: [
      /\bmaterial\s*costs?\b/i,
      /\bsupply\s*chain\b/i,
      /\binflation\b/i,
      /\bprice\s*increase\b/i,
      /\bcosts?\s*(?:have|has)\s*(?:risen|increased|gone\s*up)\b/i,
      /\bmargin\b/i,
      /\bprofit\s*margin\b/i,
      /\braw\s*material\b/i,
      /\bcommodity\s*prices?\b/i,
      /\boverhead\b/i,
      /\boperating\s*costs?\b/i,
      /\blabor\s*costs?\b/i,
      /\benergy\s*costs?\b/i,
    ],
    contextWindow: 100
  },
  {
    type: 'timeline',
    patterns: [
      /\blead\s*time\b/i,
      /\bproduction\s*schedule\b/i,
      /\bshipping\s*delay\b/i,
      /\bbacklog\b/i,
      /\bmanufacturing\s*(?:time|schedule|capacity)\b/i,
      /\bdelivery\s*(?:delay|constraint|challenge)\b/i,
      /\bscheduling\s*(?:issue|conflict|problem)\b/i,
      /\btight\s*(?:deadline|timeline|schedule)\b/i,
      /\bproduction\s*(?:bottleneck|constraint)\b/i,
      /\bcapacity\s*constraint\b/i,
    ],
    contextWindow: 100
  },
  {
    type: 'quality',
    patterns: [
      /\bpremium\s*quality\b/i,
      /\bcertification\b/i,
      /\btesting\b/i,
      /\bcompliance\b/i,
      /\bquality\s*(?:control|assurance|standard)\b/i,
      /\bISO\s*\d+/i,
      /\bstandard(?:s)?\b/i,
      /\binspection\b/i,
      /\bwarranty\b/i,
      /\bspecification\b/i,
      /\bdurability\b/i,
      /\breliability\b/i,
    ],
    contextWindow: 80
  },
  {
    type: 'volume',
    patterns: [
      /\bminimum\s*(?:order|quantity|MOQ)\b/i,
      /\bMOQ\b/,
      /\bvolume\s*(?:requirement|commitment|discount)\b/i,
      /\border\s*(?:size|quantity|volume)\b/i,
      /\bbulk\s*(?:order|discount)\b/i,
      /\bsmall\s*(?:order|quantity)\b/i,
      /\blarge\s*(?:order|quantity)\b/i,
      /\bcapacity\b/i,
    ],
    contextWindow: 80
  },
  {
    type: 'logistics',
    patterns: [
      /\bshipping\b/i,
      /\bfreight\b/i,
      /\blogistics\b/i,
      /\bwarehouse\b/i,
      /\binventory\b/i,
      /\btransportation\b/i,
      /\bdelivery\s*(?:cost|charge|fee)\b/i,
      /\bimport\b/i,
      /\bexport\b/i,
      /\bcustoms\b/i,
      /\bduty\b/i,
      /\btariff\b/i,
      /\bport\b/i,
    ],
    contextWindow: 80
  },
  {
    type: 'payment',
    patterns: [
      /\bcash\s*flow\b/i,
      /\badvance\s*payment\b/i,
      /\bpayment\s*(?:terms|conditions|timeline)\b/i,
      /\bcredit\b/i,
      /\bletter\s*of\s*credit\b/i,
      /\bL\/C\b/i,
      /\bprepayment\b/i,
      /\bdeposit\b/i,
      /\binvoice\b/i,
      /\bbilling\b/i,
      /\bnet\s*(?:\d+)\s*(?:too\s*short|not\s*enough)\b/i,
    ],
    contextWindow: 80
  },
  {
    type: 'relationship',
    patterns: [
      /\blong[\s-]*term\b/i,
      /\bpartnership\b/i,
      /\brelationship\b/i,
      /\bongoing\s*business\b/i,
      /\breliable\s*(?:partner|supplier|vendor)\b/i,
      /\btrust\b/i,
      /\bloyalty\b/i,
      /\brepeat\s*(?:business|order|customer)\b/i,
      /\bhistory\b/i,
      /\bworked\s*together\b/i,
    ],
    contextWindow: 80
  }
];

/**
 * Extract context around a match
 */
function extractContext(text: string, match: RegExpMatchArray, windowSize: number): string {
  const matchStart = match.index || 0;
  const matchEnd = matchStart + match[0].length;

  const contextStart = Math.max(0, matchStart - windowSize);
  const contextEnd = Math.min(text.length, matchEnd + windowSize);

  let context = text.substring(contextStart, contextEnd).trim();

  // Clean up partial words at boundaries
  if (contextStart > 0) {
    const firstSpace = context.indexOf(' ');
    if (firstSpace > 0 && firstSpace < 20) {
      context = context.substring(firstSpace + 1);
    }
    context = '...' + context;
  }

  if (contextEnd < text.length) {
    const lastSpace = context.lastIndexOf(' ');
    if (lastSpace > context.length - 20) {
      context = context.substring(0, lastSpace);
    }
    context = context + '...';
  }

  return context;
}

/**
 * Get concern phrase for PM response acknowledgment
 */
function getConcernPhrase(type: ConcernType): string {
  const phrases: Record<ConcernType, string[]> = {
    cost: [
      'rising material costs',
      'cost pressures',
      'pricing challenges',
      'margin constraints'
    ],
    timeline: [
      'production timeline',
      'lead time requirements',
      'scheduling challenges',
      'delivery timeline'
    ],
    quality: [
      'quality standards',
      'certification requirements',
      'compliance needs',
      'quality assurance'
    ],
    volume: [
      'volume requirements',
      'order quantity considerations',
      'capacity constraints',
      'minimum order concerns'
    ],
    logistics: [
      'logistics challenges',
      'shipping requirements',
      'delivery arrangements',
      'supply chain needs'
    ],
    payment: [
      'payment terms',
      'cash flow considerations',
      'financial arrangements',
      'billing requirements'
    ],
    relationship: [
      'our partnership',
      'our business relationship',
      'working together',
      'long-term collaboration'
    ],
    other: [
      'your concerns',
      'your situation',
      'your requirements',
      'your needs'
    ]
  };

  const phrasesForType = phrases[type] || phrases.other;
  return phrasesForType[Math.floor(Math.random() * phrasesForType.length)];
}

/**
 * Extract concerns from a single message
 */
function extractConcernsFromMessage(content: string): VendorConcern[] {
  const concerns: VendorConcern[] = [];
  const seen = new Set<string>(); // Track seen concern types to avoid duplicates

  for (const pattern of CONCERN_PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = content.match(regex);
      if (match && !seen.has(pattern.type)) {
        const contextText = extractContext(content, match, pattern.contextWindow);

        concerns.push({
          type: pattern.type,
          text: getConcernPhrase(pattern.type),
          matchedPhrase: match[0],
          confidence: 0.8 // Base confidence for pattern match
        });

        seen.add(pattern.type);
        break; // Only one match per concern type per message
      }
    }
  }

  return concerns;
}

/**
 * Extract vendor concerns from conversation history
 *
 * Analyzes vendor messages to identify their concerns, justifications,
 * and pain points that should be acknowledged in PM responses.
 *
 * @param messages - Conversation history
 * @returns Array of extracted concerns, sorted by relevance
 *
 * @example
 * ```typescript
 * const concerns = extractVendorConcerns([
 *   { role: 'VENDOR', content: 'Due to rising material costs, we need to price at $95' },
 *   { role: 'ACCORDO', content: 'Thank you for your offer...' },
 *   { role: 'VENDOR', content: 'Our production schedule is tight this quarter' }
 * ]);
 * // concerns = [
 * //   { type: 'cost', text: 'rising material costs', ... },
 * //   { type: 'timeline', text: 'production timeline', ... }
 * // ]
 * ```
 */
export function extractVendorConcerns(messages: ConcernMessage[]): VendorConcern[] {
  const vendorMessages = messages.filter(m => m.role === 'VENDOR');

  if (vendorMessages.length === 0) {
    return [];
  }

  // Extract concerns from all vendor messages
  const allConcerns: VendorConcern[] = [];

  vendorMessages.forEach((msg, index) => {
    // Weight by recency (more recent = higher confidence)
    const recencyMultiplier = 0.7 + 0.3 * (index / vendorMessages.length);
    const messageConcerns = extractConcernsFromMessage(msg.content);

    messageConcerns.forEach(concern => {
      concern.confidence *= recencyMultiplier;
      allConcerns.push(concern);
    });
  });

  // Deduplicate by type, keeping highest confidence
  const concernsByType = new Map<ConcernType, VendorConcern>();
  for (const concern of allConcerns) {
    const existing = concernsByType.get(concern.type);
    if (!existing || concern.confidence > existing.confidence) {
      concernsByType.set(concern.type, concern);
    }
  }

  // Sort by confidence (highest first)
  const finalConcerns = Array.from(concernsByType.values())
    .sort((a, b) => b.confidence - a.confidence);

  logger.debug('[ConcernExtractor] Extracted concerns', {
    messageCount: vendorMessages.length,
    concernCount: finalConcerns.length,
    types: finalConcerns.map(c => c.type)
  });

  return finalConcerns;
}

/**
 * Generate acknowledgment phrases for PM response
 *
 * @param concerns - Extracted concerns to acknowledge
 * @param maxConcerns - Maximum number of concerns to acknowledge (default: 2)
 * @returns Array of acknowledgment phrases
 *
 * @example
 * ```typescript
 * const phrases = generateAcknowledgmentPhrases(concerns);
 * // phrases = [
 * //   "I understand the rising material costs you're facing",
 * //   "and acknowledge your production timeline constraints"
 * // ]
 * ```
 */
export function generateAcknowledgmentPhrases(
  concerns: VendorConcern[],
  maxConcerns: number = 2
): string[] {
  if (concerns.length === 0) {
    return [];
  }

  const prefixes = [
    'I understand',
    'I appreciate you mentioning',
    'I recognize',
    "I'm aware of",
    'Given'
  ];

  const connectors = [
    'and',
    'as well as',
    'along with'
  ];

  const phrases: string[] = [];
  const topConcerns = concerns.slice(0, maxConcerns);

  topConcerns.forEach((concern, index) => {
    const prefix = index === 0
      ? prefixes[Math.floor(Math.random() * prefixes.length)]
      : connectors[Math.floor(Math.random() * connectors.length)];

    phrases.push(`${prefix} ${concern.text}`);
  });

  return phrases;
}

/**
 * Get a single acknowledgment sentence for PM response
 */
export function getAcknowledgmentSentence(concerns: VendorConcern[]): string | null {
  if (concerns.length === 0) {
    return null;
  }

  const topConcern = concerns[0];

  const templates = [
    `I understand ${topConcern.text} is a factor in your pricing.`,
    `Given ${topConcern.text}, I appreciate your position.`,
    `I recognize the challenges around ${topConcern.text}.`,
    `Considering ${topConcern.text}, I understand where you're coming from.`,
    `I appreciate you sharing about ${topConcern.text}.`
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Check if any concerns warrant special handling in negotiation
 */
export function hasUrgentConcerns(concerns: VendorConcern[]): boolean {
  const urgentTypes: ConcernType[] = ['timeline', 'cost'];
  return concerns.some(c => urgentTypes.includes(c.type) && c.confidence > 0.8);
}

export default {
  extractVendorConcerns,
  generateAcknowledgmentPhrases,
  getAcknowledgmentSentence,
  hasUrgentConcerns
};
