/**
 * Conversation Manager
 *
 * Core conversation logic for intent classification, preference detection,
 * refusal handling, and offer merging.
 */

import type {
  ConversationState,
  ConversationPhase,
  ConversationIntent,
  VendorPreference,
  RefusalType,
  Offer,
  Decision,
} from './types.js';
import type { ChatbotMessage } from '../../../models/chatbot-message.js';

/**
 * Initialize conversation state for a new deal
 */
export function initializeConversationState(): ConversationState {
  return {
    phase: 'WAITING_FOR_OFFER',
    askedPreference: false,
    lastVendorOffer: null,
    detectedPreference: 'NEITHER',
    lastTransitionAt: new Date().toISOString(),
  };
}

/**
 * Detect vendor preference based on negotiation history
 *
 * Analyzes all vendor messages to determine if vendor prioritizes:
 * - PRICE: More price changes than terms changes (ratio > 1.5)
 * - TERMS: More terms changes than price changes (ratio > 1.5)
 * - NEITHER: No clear preference detected
 */
export function detectVendorPreference(
  messages: ChatbotMessage[]
): VendorPreference {
  const vendorMessages = messages.filter((msg) => msg.role === 'VENDOR');

  if (vendorMessages.length < 2) {
    return 'NEITHER'; // Need at least 2 messages to detect pattern
  }

  let priceChanges = 0;
  let termsChanges = 0;

  for (let i = 1; i < vendorMessages.length; i++) {
    const prev = vendorMessages[i - 1].extractedOffer as Offer | null;
    const current = vendorMessages[i].extractedOffer as Offer | null;

    if (!prev || !current) continue;

    // Check if price changed
    if (prev.total_price !== null && current.total_price !== null) {
      if (prev.total_price !== current.total_price) {
        priceChanges++;
      }
    }

    // Check if terms changed
    if (prev.payment_terms !== null && current.payment_terms !== null) {
      if (prev.payment_terms !== current.payment_terms) {
        termsChanges++;
      }
    }
  }

  // Determine preference based on change frequency
  if (priceChanges === 0 && termsChanges === 0) {
    return 'NEITHER'; // No changes detected
  }

  if (priceChanges > termsChanges * 1.5) {
    return 'PRICE'; // Vendor is more flexible on price
  }

  if (termsChanges > priceChanges * 1.5) {
    return 'TERMS'; // Vendor is more flexible on terms
  }

  return 'NEITHER'; // No clear preference
}

/**
 * Classify vendor refusal types
 *
 * Detects when vendor refuses to share information or continues negotiation:
 * - NO: Explicit refusal ("no", "nope", "I won't share")
 * - LATER: Delay tactic ("later", "next time", "not right now")
 * - ALREADY_SHARED: Claim to have already provided info
 * - CONFUSED: Vendor doesn't understand the question
 * - null: Not a refusal (normal negotiation message)
 */
export function classifyRefusal(content: string): RefusalType {
  const lower = content.toLowerCase().trim();

  // Check for explicit "no"
  if (/\b(no|nope|nah|not interested)\b/.test(lower)) {
    return 'NO';
  }

  // Check for delay tactics
  if (/\b(later|next\s+time|some\s+other\s+time|not\s+(right\s+)?now)\b/.test(lower)) {
    return 'LATER';
  }

  // Check for "already shared"
  if (/\b(already\s+(told|shared|said|mentioned)|I\s+said)\b/.test(lower)) {
    return 'ALREADY_SHARED';
  }

  // Check for confusion
  if (/\b(what|huh|don't\s+understand|confused|not\s+sure\s+what)\b/.test(lower)) {
    return 'CONFUSED';
  }

  // Check for rejection of proposed terms (vendor disagrees but may include a price)
  // e.g., "329,650 is not possible", "too low margin", "can't accept this price"
  if (/\b(not\s+possible|not\s+acceptable|not\s+feasible|cannot\s+accept|can'?t\s+accept|too\s+low|too\s+high|too\s+much|not\s+workable|not\s+viable|impossible|unacceptable|won'?t\s+work|doesn'?t\s+work|doesn'?t\s+meet|not\s+enough|low\s+margin|no\s+margin|thin\s+margin|reject|decline)\b/i.test(lower)) {
    return 'REJECT_TERMS';
  }

  // Not a refusal
  return null;
}

/**
 * Merge incomplete vendor offer with last known offer
 *
 * If vendor only mentions price (e.g., "$95") without payment terms,
 * fill in the payment terms from the last offer.
 */
export function mergeWithLastOffer(
  newOffer: Offer,
  lastOffer: Offer | null
): Offer {
  if (!lastOffer) {
    return newOffer; // No previous offer to merge with
  }

  return {
    total_price: newOffer.total_price ?? lastOffer.total_price,
    payment_terms: newOffer.payment_terms ?? lastOffer.payment_terms,
  };
}

/**
 * Determine conversation intent based on current state and decision
 *
 * This function maps the decision engine's action to a conversation-specific intent
 * that determines what type of natural language reply to generate.
 */
export function determineIntent(
  state: ConversationState,
  decision: Decision,
  vendorOfferExtracted: Offer | null,
  refusalType: RefusalType,
  round: number
): ConversationIntent {
  // Handle refusals first
  // REJECT_TERMS is special: vendor disagrees but may include a price (e.g., "329,650 is not possible")
  // We still parse the offer but never accept — always counter
  if (refusalType !== null && refusalType !== 'REJECT_TERMS') {
    return 'HANDLE_REFUSAL';
  }

  // If no offer extracted yet, ask for one
  if (vendorOfferExtracted === null || vendorOfferExtracted.total_price === null) {
    if (round === 0) {
      return 'GREET'; // First message from Accordo
    }
    return 'ASK_FOR_OFFER';
  }

  // Map decision actions to intents
  switch (decision.action) {
    case 'ACCEPT':
      return 'ACCEPT';

    case 'WALK_AWAY':
      return 'WALK_AWAY';

    case 'ESCALATE':
      return 'ESCALATE';

    case 'COUNTER':
      // After several rounds, ask about preference
      if (round >= 3 && !state.askedPreference) {
        return 'ASK_FOR_PREFERENCE';
      }

      // If counter-offer has specific values, use direct language
      if (decision.counterOffer?.total_price !== null) {
        return 'COUNTER_DIRECT';
      }

      // Otherwise use strategic/vague language
      return 'COUNTER_INDIRECT';

    case 'ASK_CLARIFY':
      return 'ASK_FOR_OFFER'; // Ask vendor to clarify their offer

    default:
      return 'COUNTER_INDIRECT'; // Fallback
  }
}

/**
 * Update conversation state based on intent and decision
 *
 * Transitions between phases:
 * - WAITING_FOR_OFFER → NEGOTIATING (when vendor provides offer)
 * - NEGOTIATING → WAITING_FOR_PREFERENCE (after round 3)
 * - WAITING_FOR_PREFERENCE → NEGOTIATING (after asking preference)
 * - Any phase → TERMINAL (when deal reaches final status)
 */
export function updateConversationState(
  currentState: ConversationState,
  intent: ConversationIntent,
  decision: Decision,
  vendorOffer: Offer | null,
  detectedPreference: VendorPreference
): ConversationState {
  const newState: ConversationState = {
    ...currentState,
    lastTransitionAt: new Date().toISOString(),
  };

  // Update last vendor offer
  if (vendorOffer && vendorOffer.total_price !== null) {
    newState.lastVendorOffer = {
      total_price: vendorOffer.total_price,
      payment_terms: vendorOffer.payment_terms,
    };
  }

  // Update detected preference
  newState.detectedPreference = detectedPreference;

  // Update phase based on intent
  switch (intent) {
    case 'GREET':
    case 'ASK_FOR_OFFER':
      newState.phase = 'WAITING_FOR_OFFER';
      break;

    case 'COUNTER_DIRECT':
    case 'COUNTER_INDIRECT':
      newState.phase = 'NEGOTIATING';
      break;

    case 'ASK_FOR_PREFERENCE':
      newState.phase = 'WAITING_FOR_PREFERENCE';
      newState.askedPreference = true;
      break;

    case 'ACKNOWLEDGE_PREFERENCE':
      newState.phase = 'NEGOTIATING';
      break;

    case 'ACCEPT':
    case 'WALK_AWAY':
    case 'ESCALATE':
      newState.phase = 'TERMINAL';
      break;

    case 'HANDLE_REFUSAL':
      // Keep current phase
      break;

    default:
      // Keep current phase
      break;
  }

  return newState;
}

/**
 * Check if conversation should auto-start with greeting
 *
 * Conversation mode automatically sends a greeting message when:
 * 1. Deal is newly created (round = 0)
 * 2. No messages exist yet
 * 3. Mode is CONVERSATION (not INSIGHTS)
 */
export function shouldAutoStartConversation(
  dealMode: string,
  round: number,
  messageCount: number
): boolean {
  return dealMode === 'CONVERSATION' && round === 0 && messageCount === 0;
}

/**
 * Get default greeting message for auto-start
 */
export function getDefaultGreeting(): string {
  return "Hello! I'm ready to discuss this negotiation. Please share your best offer with unit price and payment terms.";
}
