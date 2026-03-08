/**
 * Scope Guard — Off-Topic Rejection Filter
 *
 * Prevents the LLM from wasting tokens on off-topic messages.
 * Vendors type directly into the chatbot, so we need to filter out
 * questions about weather, sports, politics, general coding, trivia,
 * and redirect them back to the negotiation.
 *
 * This runs BEFORE any LLM call or decision engine processing.
 */

import logger from '../../../config/logger.js';

/**
 * Result of scope guard check
 */
export interface ScopeGuardResult {
  /** Whether the message is off-topic */
  isOffTopic: boolean;
  /** The category of off-topic content (null if on-topic) */
  category: OffTopicCategory | null;
  /** Canned response to send back (null if on-topic) */
  response: string | null;
  /** Confidence level of the detection (0-1) */
  confidence: number;
}

/**
 * Categories of off-topic content
 */
export type OffTopicCategory =
  | 'weather'
  | 'sports'
  | 'politics'
  | 'general_knowledge'
  | 'coding'
  | 'entertainment'
  | 'personal'
  | 'unrelated_business';

/**
 * Pattern definitions for off-topic detection.
 * Each pattern group has:
 * - patterns: regex patterns to match
 * - category: the off-topic category
 * - weight: how strongly this pattern indicates off-topic (0-1)
 */
interface PatternGroup {
  patterns: RegExp[];
  category: OffTopicCategory;
  weight: number;
}

const OFF_TOPIC_PATTERNS: PatternGroup[] = [
  {
    category: 'weather',
    weight: 0.9,
    patterns: [
      /\b(?:weather|forecast|temperature|rain(?:ing|y)?|snow(?:ing|y)?|sunny|cloudy|humid(?:ity)?|storm)\b/i,
      /\bhow(?:'s| is) (?:the )?weather\b/i,
      /\bwill it rain\b/i,
    ],
  },
  {
    category: 'sports',
    weight: 0.9,
    patterns: [
      /\b(?:football|soccer|cricket|basketball|baseball|tennis|golf|tournament|world cup|super bowl|olympics|nfl|nba|ipl|fifa)\b/i,
      /\bwho (?:won|scored|plays?) (?:the )?(?:match|game|series|cup|tournament|final)\b/i,
      /\b(?:score|goal|wicket|touchdown|slam dunk)\b.*\b(?:match|game|today|yesterday)\b/i,
    ],
  },
  {
    category: 'politics',
    weight: 0.9,
    patterns: [
      /\b(?:election|president|prime minister|parliament|congress|senator|democrats?|republicans?|political|politics|government|legislation)\b/i,
      /\bwho (?:is|was) (?:the )?(?:president|pm|prime minister)\b/i,
      /\bwho (?:won|lost) (?:the )?election\b/i,
    ],
  },
  {
    category: 'general_knowledge',
    weight: 0.8,
    patterns: [
      /\b(?:capital of|tallest|largest|smallest|oldest|youngest)\b/i,
      /\bwho (?:invented|discovered|founded|created)\b/i,
      /\btell me (?:a )?(?:joke|story|riddle|fun fact)\b/i,
      /\bwhat (?:is|are) (?:the )?(?:meaning|definition) of\b/i,
    ],
  },
  {
    category: 'coding',
    weight: 0.85,
    patterns: [
      /\b(?:write|code|program|debug|compile|javascript|python|java|react|angular|vue|html|css|sql|api|function|class|variable|algorithm)\b.*\b(?:for me|please|help|how to)\b/i,
      /\bhow (?:do I|to) (?:code|program|build|create|make) (?:a|an)\b/i,
      /\bfix (?:my|this|the) (?:code|bug|error|script)\b/i,
    ],
  },
  {
    category: 'entertainment',
    weight: 0.85,
    patterns: [
      /\b(?:movie|film|series|show|song|music|actor|actress|singer|band|album|netflix|spotify|youtube|game|video game)\b/i,
      /\bwhat (?:should I|to) watch\b/i,
      /\brecommend (?:a|some) (?:movie|show|song|book)\b/i,
    ],
  },
  {
    category: 'personal',
    weight: 0.85,
    patterns: [
      /\b(?:are you (?:a |an )?(?:robot|ai|human|real|alive|sentient))\b/i,
      /\bwhat(?:'s| is) your (?:name|age|favorite|opinion)\b/i,
      /\bdo you (?:feel|think|believe|like|love|hate)\b/i,
      /\btell me about yourself\b/i,
      /\bwho (?:are|made|created) you\b/i,
    ],
  },
  {
    category: 'unrelated_business',
    weight: 0.7,
    patterns: [
      /\b(?:stock|crypto|bitcoin|ethereum|forex|investment|mutual fund|real estate)\b.*\b(?:price|buy|sell|invest|tip|advice)\b/i,
      /\bhow (?:to|do I) (?:invest|trade|buy stocks)\b/i,
    ],
  },
];

/**
 * Negotiation-related patterns that should NEVER be flagged as off-topic.
 * If any of these match, the message is considered on-topic regardless of
 * other pattern matches.
 */
const NEGOTIATION_SAFELIST: RegExp[] = [
  // Price & payment
  /\b(?:\$|USD|INR|EUR|GBP|AUD|₹|€|£)\s*[\d,.]+/i,
  /\b[\d,.]+\s*(?:dollars|rupees|euros|pounds)\b/i,
  /\bnet\s*\d+\b/i,
  /\b(?:price|cost|amount|total|unit price|rate|quote|bid|offer|proposal|counter|discount)\b/i,
  /\b(?:payment|pay|invoice|advance|installment|credit|terms)\b/i,

  // Delivery & logistics
  /\b(?:deliver|delivery|ship|shipping|logistics|lead time|timeline|eta|dispatch)\b/i,
  /\b(?:by|within|before|after)\s+\d+\s*(?:days?|weeks?|months?)\b/i,

  // Negotiation actions
  /\b(?:accept|reject|agree|disagree|counter|negotiate|deal|contract|order|requisition)\b/i,
  /\b(?:warranty|guarantee|penalty|liability|quality|specification|standard|certification)\b/i,
  /\b(?:quantity|volume|bulk|minimum order|moq)\b/i,

  // General business context
  /\b(?:vendor|supplier|buyer|procurement|purchase|rfq|quotation|tender)\b/i,
];

/**
 * Build a negotiation-focused redirection response.
 *
 * @param productName - Name of the product being negotiated (if available)
 * @param category - The off-topic category detected
 */
function buildRedirectionResponse(productName?: string, category?: OffTopicCategory | null): string {
  const productRef = productName ? ` for ${productName}` : '';

  const responses = [
    `I appreciate your message, but I'm focused on our negotiation${productRef}. Could we continue discussing pricing, payment terms, or delivery?`,
    `Thank you, but let's stay focused on our current negotiation${productRef}. I'm here to help us reach a mutually beneficial agreement on pricing and terms.`,
    `I'd love to help, but my expertise is in procurement negotiations. Let's continue our discussion${productRef} — shall we talk about the pricing or delivery terms?`,
  ];

  // Select based on category for slight variety
  const index = category
    ? Math.abs(category.charCodeAt(0)) % responses.length
    : 0;

  return responses[index];
}

/**
 * Check if a message is off-topic for a negotiation context.
 *
 * Returns immediately if the message contains negotiation-related content
 * (safelist check). Otherwise, checks against off-topic patterns.
 *
 * @param message - The vendor's message text
 * @param productName - Optional product name for context in the response
 * @returns ScopeGuardResult indicating if the message is off-topic
 */
export function checkScopeGuard(message: string, productName?: string): ScopeGuardResult {
  const trimmed = message.trim();

  // Very short messages (< 3 chars) are likely greetings or acknowledgments — let through
  if (trimmed.length < 3) {
    return { isOffTopic: false, category: null, response: null, confidence: 0 };
  }

  // SAFELIST CHECK: If message contains ANY negotiation keyword, it's on-topic
  for (const pattern of NEGOTIATION_SAFELIST) {
    if (pattern.test(trimmed)) {
      return { isOffTopic: false, category: null, response: null, confidence: 0 };
    }
  }

  // OFF-TOPIC CHECK: Match against off-topic patterns
  let bestMatch: { category: OffTopicCategory; confidence: number } | null = null;

  for (const group of OFF_TOPIC_PATTERNS) {
    for (const pattern of group.patterns) {
      if (pattern.test(trimmed)) {
        const confidence = group.weight;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { category: group.category, confidence };
        }
      }
    }
  }

  if (bestMatch && bestMatch.confidence >= 0.7) {
    logger.info('[ScopeGuard] Off-topic message detected', {
      category: bestMatch.category,
      confidence: bestMatch.confidence,
      messagePreview: trimmed.substring(0, 50),
    });

    return {
      isOffTopic: true,
      category: bestMatch.category,
      response: buildRedirectionResponse(productName, bestMatch.category),
      confidence: bestMatch.confidence,
    };
  }

  return { isOffTopic: false, category: null, response: null, confidence: 0 };
}
