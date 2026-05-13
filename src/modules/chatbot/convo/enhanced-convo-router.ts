/**
 * Enhanced Conversation Router
 *
 * Sophisticated state machine for managing conversation flow with vendors.
 * Handles intent classification, refusal detection, small talk management,
 * and multi-turn context awareness.
 */

import { generateChatbotLlamaCompletion } from '../llm/chatbot-llama-client.js';
import logger from '../../../config/logger.js';
import { CustomError } from '../../../utils/custom-error.js';
import type { ConvoIntent } from './conversation-templates.js';

/**
 * Conversation phases tracking negotiation progression
 */
export type ConvoPhase = 'GREET' | 'ASK_OFFER' | 'NEGOTIATING' | 'CLOSED';

/**
 * Types of vendor refusals to share information
 */
export type RefusalType =
  | 'NO' // Direct refusal
  | 'LATER' // Will share later
  | 'ALREADY_SHARED' // Claims already shared
  | 'CONFUSED' // Doesn't understand request
  | null;

/**
 * Vendor message intent classification
 */
export type VendorIntent =
  | 'PROVIDE_OFFER' // Shares pricing/terms
  | 'REFUSAL' // Refuses to share info
  | 'SMALL_TALK' // General conversation
  | 'ASK_QUESTION' // Asking for clarification
  | 'NEGOTIATE' // Counter-offer or pushback
  | 'GREETING' // Initial greeting
  | 'AGREE'; // Accepts Accordo's terms

/**
 * Conversation state structure
 * Stored in deal.convoStateJson
 */
export interface ConvoState {
  /** Current conversation phase */
  phase: ConvoPhase;

  /** Number of times vendor has refused */
  refusalCount: number;

  /** Type of last refusal */
  lastRefusalType: RefusalType;

  /** Whether we've asked for vendor's preferences */
  askedForPreferences: boolean;

  /** Number of small talk exchanges */
  smallTalkCount: number;

  /** Total conversation turns */
  turnCount: number;

  /** Last classified Accordo intent */
  lastIntent: ConvoIntent | null;

  /** Contextual information about what's been discussed */
  context: {
    mentionedPrice: boolean;
    mentionedTerms: boolean;
    sharedConstraints: boolean;
  };

  /** Timestamp of last update */
  lastUpdatedAt?: string;
}

/**
 * Initialize default conversation state
 */
export function initializeConvoState(): ConvoState {
  return {
    phase: 'GREET',
    refusalCount: 0,
    lastRefusalType: null,
    askedForPreferences: false,
    smallTalkCount: 0,
    turnCount: 0,
    lastIntent: null,
    context: {
      mentionedPrice: false,
      mentionedTerms: false,
      sharedConstraints: false,
    },
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Classify vendor message intent using LLM
 *
 * @param message - Vendor's message text
 * @param conversationHistory - Previous messages for context
 * @returns Classified vendor intent
 */
export async function classifyVendorIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }> = []
): Promise<VendorIntent> {
  const systemPrompt = `You are an expert at analyzing negotiation messages. Classify the vendor's intent from their message.

Possible intents:
- PROVIDE_OFFER: Vendor shares specific pricing, payment terms, or concrete offer details
- REFUSAL: Vendor refuses to share information or declines request
- SMALL_TALK: General conversation, pleasantries, or non-business chat
- ASK_QUESTION: Vendor asks for clarification or more information
- NEGOTIATE: Vendor pushes back on terms or makes counter-arguments
- GREETING: Initial greeting or introduction
- AGREE: Vendor accepts proposed terms or shows agreement

Analyze the message and respond with ONLY the intent label (e.g., "PROVIDE_OFFER"), nothing else.`;

  try {
    logger.info('[EnhancedConvoRouter] Classifying vendor intent', {
      messageLength: message.length,
    });

    const response = await generateChatbotLlamaCompletion(
      systemPrompt,
      [
        ...conversationHistory.slice(-4), // Last 4 messages for context
        { role: 'VENDOR', content: message },
      ],
      { temperature: 0.3, maxTokens: 50 }
    );

    const intent = response.trim().toUpperCase();

    // Validate response
    const validIntents: VendorIntent[] = [
      'PROVIDE_OFFER',
      'REFUSAL',
      'SMALL_TALK',
      'ASK_QUESTION',
      'NEGOTIATE',
      'GREETING',
      'AGREE',
    ];

    if (validIntents.includes(intent as VendorIntent)) {
      logger.info('[EnhancedConvoRouter] Intent classified', { intent });
      return intent as VendorIntent;
    }

    // Fallback to heuristics if LLM returns invalid intent
    logger.warn('[EnhancedConvoRouter] Invalid LLM intent, using fallback', {
      llmResponse: response,
    });
    return fallbackIntentClassification(message);
  } catch (error) {
    logger.error('[EnhancedConvoRouter] Intent classification failed', {
      error,
    });
    // Use heuristic fallback
    return fallbackIntentClassification(message);
  }
}

/**
 * Fallback heuristic-based intent classification
 * Used when LLM fails or returns invalid response
 */
function fallbackIntentClassification(message: string): VendorIntent {
  const lowerMessage = message.toLowerCase();

  // Check for greetings
  if (
    lowerMessage.match(/^(hi|hello|hey|greetings|good morning|good afternoon)/i)
  ) {
    return 'GREETING';
  }

  // Check for price/terms mentions (offer)
  if (
    lowerMessage.includes('price') ||
    lowerMessage.includes('$') ||
    lowerMessage.includes('payment') ||
    lowerMessage.includes('terms') ||
    lowerMessage.match(/\d+\s*(days|net|upon)/i)
  ) {
    return 'PROVIDE_OFFER';
  }

  // Check for refusals
  if (
    lowerMessage.includes("can't") ||
    lowerMessage.includes("won't") ||
    lowerMessage.includes('unable to') ||
    lowerMessage.includes('not share') ||
    lowerMessage.includes('later') ||
    lowerMessage.includes('already sent')
  ) {
    return 'REFUSAL';
  }

  // Check for questions
  if (
    lowerMessage.includes('?') ||
    lowerMessage.match(/^(what|how|when|where|why|could you|can you)/i)
  ) {
    return 'ASK_QUESTION';
  }

  // Check for agreement
  if (
    lowerMessage.includes('agree') ||
    lowerMessage.includes('accept') ||
    lowerMessage.includes('sounds good') ||
    lowerMessage.includes("that works") ||
    lowerMessage.includes('perfect')
  ) {
    return 'AGREE';
  }

  // Default to negotiate
  return 'NEGOTIATE';
}

/**
 * Classify type of refusal using LLM
 *
 * @param message - Vendor's refusal message
 * @returns Type of refusal
 */
export async function classifyRefusal(message: string): Promise<RefusalType> {
  const systemPrompt = `Analyze this vendor refusal message and classify the type of refusal.

Types:
- NO: Direct refusal or unwilling to share
- LATER: Will share later or needs time
- ALREADY_SHARED: Claims they already provided the information
- CONFUSED: Doesn't understand what's being asked

Respond with ONLY the refusal type (e.g., "NO"), nothing else.`;

  try {
    logger.info('[EnhancedConvoRouter] Classifying refusal type', {
      messageLength: message.length,
    });

    const response = await generateChatbotLlamaCompletion(
      systemPrompt,
      [{ role: 'VENDOR', content: message }],
      { temperature: 0.2, maxTokens: 20 }
    );

    const refusalType = response.trim().toUpperCase();

    const validTypes: RefusalType[] = [
      'NO',
      'LATER',
      'ALREADY_SHARED',
      'CONFUSED',
    ];

    if (validTypes.includes(refusalType as RefusalType)) {
      logger.info('[EnhancedConvoRouter] Refusal classified', { refusalType });
      return refusalType as RefusalType;
    }

    // Fallback
    return fallbackRefusalClassification(message);
  } catch (error) {
    logger.error('[EnhancedConvoRouter] Refusal classification failed', {
      error,
    });
    return fallbackRefusalClassification(message);
  }
}

/**
 * Fallback heuristic-based refusal classification
 */
function fallbackRefusalClassification(message: string): RefusalType {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('later') || lowerMessage.includes('soon')) {
    return 'LATER';
  }

  if (
    lowerMessage.includes('already') ||
    lowerMessage.includes('sent') ||
    lowerMessage.includes('shared')
  ) {
    return 'ALREADY_SHARED';
  }

  if (
    lowerMessage.includes('understand') ||
    lowerMessage.includes('unclear') ||
    lowerMessage.includes('confused')
  ) {
    return 'CONFUSED';
  }

  return 'NO';
}

/**
 * Handle vendor refusal and determine next Accordo intent
 *
 * @param state - Current conversation state
 * @param refusalType - Type of refusal detected
 * @returns Next Accordo intent
 */
export function handleRefusal(
  state: ConvoState,
  refusalType: RefusalType
): ConvoIntent {
  state.refusalCount += 1;
  state.lastRefusalType = refusalType;

  logger.info('[EnhancedConvoRouter] Handling refusal', {
    count: state.refusalCount,
    type: refusalType,
  });

  // After 5 refusals, escalate to human
  if (state.refusalCount >= 5) {
    logger.warn('[EnhancedConvoRouter] Too many refusals, escalating', {
      count: state.refusalCount,
    });
    state.phase = 'CLOSED';
    return 'ESCALATE';
  }

  // After 3 refusals, ask for vendor preferences
  if (state.refusalCount >= 3 && !state.askedForPreferences) {
    logger.info('[EnhancedConvoRouter] Multiple refusals, asking preferences');
    state.askedForPreferences = true;
    return 'ASK_CLARIFY';
  }

  // Handle specific refusal types
  switch (refusalType) {
    case 'CONFUSED':
      // Clarify the request
      return 'ASK_CLARIFY';

    case 'ALREADY_SHARED':
      // Politely ask again with different wording
      return 'ASK_CLARIFY';

    case 'LATER':
      // Acknowledge and gently push
      return 'ASK_FOR_OFFER';

    case 'NO':
    default:
      // Try different approach
      return 'ASK_CLARIFY';
  }
}

/**
 * Handle small talk and determine next Accordo intent
 *
 * @param state - Current conversation state
 * @returns Next Accordo intent
 */
export function handleSmallTalk(state: ConvoState): ConvoIntent {
  state.smallTalkCount += 1;

  logger.info('[EnhancedConvoRouter] Handling small talk', {
    count: state.smallTalkCount,
  });

  // After 2 small talk exchanges, redirect to business
  if (state.smallTalkCount >= 2) {
    logger.info(
      '[EnhancedConvoRouter] Too much small talk, redirecting to business'
    );
    return state.phase === 'GREET' ? 'ASK_FOR_OFFER' : 'ASK_CLARIFY';
  }

  // Acknowledge small talk politely
  return 'SMALL_TALK';
}

/**
 * Determine next Accordo intent based on vendor intent and state
 *
 * Main state machine logic for conversation flow
 *
 * @param state - Current conversation state
 * @param vendorIntent - Classified vendor intent
 * @param vendorMessage - Raw vendor message for context
 * @returns Next Accordo intent
 */
export function determineNextIntent(
  state: ConvoState,
  vendorIntent: VendorIntent,
  vendorMessage: string
): ConvoIntent {
  logger.info('[EnhancedConvoRouter] Determining next intent', {
    phase: state.phase,
    vendorIntent,
    turnCount: state.turnCount,
  });

  // Handle based on current phase
  switch (state.phase) {
    case 'GREET':
      return handleGreetPhase(state, vendorIntent);

    case 'ASK_OFFER':
      return handleAskOfferPhase(state, vendorIntent);

    case 'NEGOTIATING':
      return handleNegotiatingPhase(state, vendorIntent);

    case 'CLOSED':
      // Should not receive messages in closed phase
      logger.warn('[EnhancedConvoRouter] Message received in CLOSED phase');
      return 'ESCALATE';

    default:
      logger.error('[EnhancedConvoRouter] Unknown phase', {
        phase: state.phase,
      });
      return 'ASK_CLARIFY';
  }
}

/**
 * Handle GREET phase logic
 */
function handleGreetPhase(
  state: ConvoState,
  vendorIntent: VendorIntent
): ConvoIntent {
  switch (vendorIntent) {
    case 'GREETING':
      // Greet back and move to asking for offer
      state.phase = 'ASK_OFFER';
      return 'GREET';

    case 'PROVIDE_OFFER':
      // Vendor jumped straight to offer
      state.phase = 'NEGOTIATING';
      return 'COUNTER'; // Will be determined by decision engine

    case 'ASK_QUESTION':
      return 'ASK_CLARIFY';

    case 'SMALL_TALK':
      return handleSmallTalk(state);

    case 'REFUSAL':
      return 'ASK_FOR_OFFER';

    default:
      state.phase = 'ASK_OFFER';
      return 'GREET';
  }
}

/**
 * Handle ASK_OFFER phase logic
 */
function handleAskOfferPhase(
  state: ConvoState,
  vendorIntent: VendorIntent
): ConvoIntent {
  switch (vendorIntent) {
    case 'PROVIDE_OFFER':
      // Vendor provided offer, move to negotiating
      state.phase = 'NEGOTIATING';
      state.context.mentionedPrice = true;
      state.context.mentionedTerms = true;
      return 'COUNTER'; // Decision engine will decide actual action

    case 'REFUSAL':
      // Vendor refuses to share offer
      return 'ASK_FOR_OFFER'; // handleRefusal will be called separately

    case 'ASK_QUESTION':
      // Vendor needs clarification
      return 'ASK_CLARIFY';

    case 'SMALL_TALK':
      return handleSmallTalk(state);

    case 'NEGOTIATE':
      // Vendor pushes back without offering specifics
      return 'ASK_CLARIFY';

    default:
      return 'ASK_FOR_OFFER';
  }
}

/**
 * Handle NEGOTIATING phase logic
 */
function handleNegotiatingPhase(
  state: ConvoState,
  vendorIntent: VendorIntent
): ConvoIntent {
  switch (vendorIntent) {
    case 'PROVIDE_OFFER':
      // Vendor provided new offer or counter
      state.context.mentionedPrice = true;
      state.context.mentionedTerms = true;
      return 'COUNTER'; // Decision engine decides

    case 'AGREE':
      // Vendor accepts our terms
      state.phase = 'CLOSED';
      return 'ACCEPT';

    case 'REFUSAL':
      // Vendor refuses to continue
      return 'ASK_CLARIFY'; // handleRefusal will be called

    case 'ASK_QUESTION':
      return 'ASK_CLARIFY';

    case 'NEGOTIATE':
      // Vendor is negotiating without specific offer
      return 'ASK_CLARIFY';

    case 'SMALL_TALK':
      return handleSmallTalk(state);

    default:
      return 'COUNTER';
  }
}

/**
 * Update conversation state based on intents
 *
 * @param state - Current conversation state
 * @param vendorIntent - Classified vendor intent
 * @param accordoIntent - Determined Accordo intent
 * @returns Updated conversation state
 */
export function updateConvoState(
  state: ConvoState,
  vendorIntent: VendorIntent,
  accordoIntent: ConvoIntent
): ConvoState {
  // Increment turn count
  state.turnCount += 1;

  // Update last intent
  state.lastIntent = accordoIntent;

  // Update phase based on Accordo intent
  if (accordoIntent === 'ACCEPT' || accordoIntent === 'WALK_AWAY' || accordoIntent === 'ESCALATE') {
    state.phase = 'CLOSED';
  }

  // Update context
  if (vendorIntent === 'PROVIDE_OFFER') {
    state.context.mentionedPrice = true;
    state.context.mentionedTerms = true;
  }

  // Reset small talk counter if we're back to business
  if (
    accordoIntent !== 'SMALL_TALK' &&
    vendorIntent !== 'SMALL_TALK'
  ) {
    state.smallTalkCount = 0;
  }

  // Update timestamp
  state.lastUpdatedAt = new Date().toISOString();

  logger.info('[EnhancedConvoRouter] State updated', {
    phase: state.phase,
    turnCount: state.turnCount,
    refusalCount: state.refusalCount,
  });

  return state;
}

/**
 * Detect if vendor message contains pricing information
 * Helper for offer detection
 */
export function containsPriceInfo(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for currency symbols or price patterns
  if (message.match(/\$\d+|\d+\s*USD|USD\s*\d+/i)) {
    return true;
  }

  // Check for price-related keywords
  const priceKeywords = [
    'price',
    'cost',
    'quote',
    'rate',
    'pricing',
    'charge',
  ];

  return priceKeywords.some((keyword) => lowerMessage.includes(keyword));
}

/**
 * Detect if vendor message contains payment terms information
 */
export function containsTermsInfo(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for payment terms patterns
  if (message.match(/\d+\s*days|net\s*\d+|upon\s+delivery/i)) {
    return true;
  }

  // Check for terms-related keywords
  const termsKeywords = [
    'payment',
    'terms',
    'net',
    'days',
    'delivery',
    'due',
  ];

  return termsKeywords.some((keyword) => lowerMessage.includes(keyword));
}

/**
 * Validate conversation state structure
 */
export function validateConvoState(state: any): state is ConvoState {
  return (
    state &&
    typeof state === 'object' &&
    typeof state.phase === 'string' &&
    typeof state.refusalCount === 'number' &&
    typeof state.smallTalkCount === 'number' &&
    typeof state.turnCount === 'number' &&
    typeof state.context === 'object'
  );
}

/**
 * Get conversation state summary for logging
 */
export function getStateSummary(state: ConvoState): string {
  return `Phase: ${state.phase}, Turn: ${state.turnCount}, Refusals: ${state.refusalCount}, SmallTalk: ${state.smallTalkCount}`;
}
