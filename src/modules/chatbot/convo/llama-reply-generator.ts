/**
 * LLM Reply Generator for Conversation Mode
 *
 * Generates natural language replies from Accordo based on conversation intent.
 * Uses dedicated chatbot LLM with intent-specific prompts and validation.
 */

import type { ConversationIntent, Offer, Decision, RefusalType } from './types.js';
import { generateChatbotLlamaCompletion } from '../llm/chatbot-llama-client.js';
import logger from '../../../config/logger.js';

/**
 * Intent-specific prompt templates
 * Each intent maps to a specific system prompt that guides LLM behavior
 */
const INTENT_PROMPTS: Record<
  ConversationIntent,
  string | ((data: any) => string)
> = {
  GREET: `You are Accordo, an AI negotiation assistant helping a buyer procure products.
Generate a warm, professional greeting to start the negotiation.
Keep it concise (2-3 sentences). Ask the vendor to share their best offer with unit price and payment terms.
DO NOT mention utility scores, algorithms, or internal decision logic.`,

  ASK_FOR_OFFER: `You are Accordo, an AI negotiation assistant.
The vendor hasn't provided their offer yet (or it's incomplete).
Politely ask them to share their unit price and payment terms.
Keep it brief and friendly. DO NOT mention utility scores or algorithms.`,

  COUNTER_DIRECT: (data: { counterOffer: Offer }) => `You are Accordo, an AI negotiation assistant.
Present this counter-offer to the vendor: $${data.counterOffer.total_price} with ${data.counterOffer.payment_terms}.
Be professional and direct. Provide brief reasoning if helpful.
DO NOT mention utility scores, algorithms, or internal calculations.
Keep response under 150 words.`,

  COUNTER_INDIRECT: (_data: { decision: Decision }) => `You are Accordo, an AI negotiation assistant.
The vendor's offer isn't quite acceptable yet. Respond strategically without revealing exact counter-offer values.
Suggest that you need better terms. Be polite but firm.
DO NOT mention utility scores, algorithms, or specific numbers unless absolutely necessary.
Keep response under 100 words.`,

  ACCEPT: (data: { vendorOffer: Offer }) => `You are Accordo, an AI negotiation assistant.
The vendor's offer of $${data.vendorOffer.total_price} with ${data.vendorOffer.payment_terms} is acceptable!
Generate a professional acceptance message. Express appreciation and confirm next steps.
DO NOT mention utility scores or algorithms.
Keep response under 100 words.`,

  WALK_AWAY: (data: { vendorOffer: Offer }) => `You are Accordo, an AI negotiation assistant.
Unfortunately, the vendor's offer of $${data.vendorOffer.total_price} with ${data.vendorOffer.payment_terms} is not acceptable.
Politely decline and thank them for their time. Be respectful but firm.
DO NOT mention utility scores or internal thresholds.
Keep response under 100 words.`,

  ESCALATE: `You are Accordo, an AI negotiation assistant.
This negotiation requires human intervention. Inform the vendor that you'll escalate to a human negotiator.
Be professional and courteous. Provide estimated timeline if possible.
DO NOT mention utility scores or algorithms.
Keep response under 100 words.`,

  ASK_FOR_PREFERENCE: `You are Accordo, an AI negotiation assistant.
After several rounds of negotiation, ask the vendor about their priorities.
Are they more concerned about price or payment terms?
Be casual and conversational. This helps understand their flexibility.
DO NOT mention utility scores or algorithms.
Keep response under 80 words.`,

  ACKNOWLEDGE_PREFERENCE: (data: { preference: string }) => `You are Accordo, an AI negotiation assistant.
The vendor indicated their preference: ${data.preference}.
Acknowledge their input warmly and continue the negotiation.
DO NOT mention utility scores or algorithms.
Keep response under 60 words.`,

  HANDLE_REFUSAL: (data: { refusalType: RefusalType }) => {
    const responses: Record<NonNullable<RefusalType>, string> = {
      NO: `You are Accordo, an AI negotiation assistant.
The vendor declined to share information. Respond politely and professionally.
Acknowledge their position and suggest continuing the negotiation anyway.
Keep response under 60 words.`,
      LATER: `You are Accordo, an AI negotiation assistant.
The vendor wants to share information later. Acknowledge and suggest moving forward with current terms.
Be understanding but keep the negotiation progressing.
Keep response under 60 words.`,
      ALREADY_SHARED: `You are Accordo, an AI negotiation assistant.
The vendor claims they already shared the information. Politely acknowledge and continue.
Keep response under 50 words.`,
      CONFUSED: `You are Accordo, an AI negotiation assistant.
The vendor seems confused. Clarify your question politely and simply.
Keep response under 60 words.`,
      REJECT_TERMS: `You are Accordo, an AI negotiation assistant.
The vendor has rejected the proposed terms. Acknowledge their position respectfully and propose a revised counter-offer.
Keep response under 60 words.`,
    };
    return (data.refusalType && responses[data.refusalType]) || responses.NO;
  },
};

/**
 * Banned keywords that should never appear in LLM replies
 * These reveal internal decision logic that vendors shouldn't see
 */
const BANNED_KEYWORDS = [
  'utility',
  'algorithm',
  'score',
  'calculation',
  'threshold',
  'engine',
  'decision tree',
  'weighted',
  'batna',
  'config',
  'parameters',
];

/**
 * Validate LLM reply to ensure it meets quality standards
 *
 * Checks:
 * 1. Length (10-550 characters)
 * 2. No banned keywords
 * 3. Intent-specific validation (e.g., counter-offer must include exact values)
 *
 * @returns True if valid, false otherwise
 */
function validateReply(reply: string, intent: ConversationIntent, data?: any): boolean {
  // Length check
  if (reply.length < 10 || reply.length > 550) {
    logger.warn('[LlamaReplyGenerator] Reply length out of bounds', {
      length: reply.length,
      intent,
    });
    return false;
  }

  // Banned keywords check
  const lowerReply = reply.toLowerCase();
  for (const keyword of BANNED_KEYWORDS) {
    if (lowerReply.includes(keyword)) {
      logger.warn('[LlamaReplyGenerator] Reply contains banned keyword', {
        keyword,
        intent,
      });
      return false;
    }
  }

  // Intent-specific validation
  switch (intent) {
    case 'COUNTER_DIRECT':
      // Must include the exact counter-offer values
      if (data?.counterOffer) {
        const hasPrice = reply.includes(String(data.counterOffer.total_price));
        const hasTerms = reply.includes(data.counterOffer.payment_terms);
        if (!hasPrice || !hasTerms) {
          logger.warn('[LlamaReplyGenerator] Counter-offer missing exact values', {
            intent,
            hasPrice,
            hasTerms,
          });
          return false;
        }
      }
      break;

    case 'ACCEPT':
      // Must express positive sentiment
      const acceptKeywords = ['accept', 'agree', 'deal', 'great', 'excellent', 'perfect'];
      const hasPositive = acceptKeywords.some((kw) => lowerReply.includes(kw));
      if (!hasPositive) {
        logger.warn('[LlamaReplyGenerator] Acceptance reply lacks positive sentiment', {
          intent,
        });
        return false;
      }
      break;

    case 'WALK_AWAY':
      // Must express polite decline
      const declineKeywords = ['unfortunately', 'decline', 'unable', 'cannot', 'not acceptable'];
      const hasDecline = declineKeywords.some((kw) => lowerReply.includes(kw));
      if (!hasDecline) {
        logger.warn('[LlamaReplyGenerator] Walk-away reply lacks decline sentiment', {
          intent,
        });
        return false;
      }
      break;
  }

  return true;
}

/**
 * Fallback templates for when LLM fails or is unavailable
 */
const FALLBACK_TEMPLATES: Record<ConversationIntent, string | ((data: any) => string)> = {
  GREET: "Hello! I'm ready to discuss this procurement. Please share your best offer with unit price and payment terms.",

  ASK_FOR_OFFER: "Could you please provide your unit price and payment terms so we can proceed?",

  COUNTER_DIRECT: (data: { counterOffer: Offer }) =>
    `We can offer $${data.counterOffer.total_price} with ${data.counterOffer.payment_terms}. Can you work with these terms?`,

  COUNTER_INDIRECT: "We'd need better terms to move forward. What flexibility do you have?",

  ACCEPT: (data: { vendorOffer: Offer }) =>
    `Great! We accept your offer of $${data.vendorOffer.total_price} with ${data.vendorOffer.payment_terms}. Thank you for negotiating with us.`,

  WALK_AWAY: "Unfortunately, we cannot proceed with the current terms. Thank you for your time.",

  ESCALATE: "This requires human review. I'll escalate to a team member who will follow up shortly.",

  ASK_FOR_PREFERENCE: "After these rounds, I'm curious: are you more flexible on price or payment terms?",

  ACKNOWLEDGE_PREFERENCE: "Thanks for sharing that. Let's continue our discussion.",

  HANDLE_REFUSAL: "I understand. Let's continue with the negotiation based on what we have so far.",
};

/**
 * Generate Accordo's reply using LLM
 *
 * @param intent - Conversation intent (determines prompt and validation)
 * @param conversationHistory - Previous messages for context
 * @param data - Intent-specific data (counter-offer, vendor offer, etc.)
 * @returns Generated reply text
 */
export async function generateAccordoReply(
  intent: ConversationIntent,
  conversationHistory: Array<{ role: string; content: string }>,
  data?: {
    counterOffer?: Offer;
    vendorOffer?: Offer;
    decision?: Decision;
    preference?: string;
    refusalType?: RefusalType;
  }
): Promise<string> {
  try {
    // Get intent-specific system prompt
    const promptTemplate = INTENT_PROMPTS[intent];
    const systemPrompt =
      typeof promptTemplate === 'function' ? promptTemplate(data || {}) : promptTemplate;

    logger.info('[LlamaReplyGenerator] Generating reply', {
      intent,
      historyLength: conversationHistory.length,
    });

    // Generate reply with LLM
    const reply = await generateChatbotLlamaCompletion(systemPrompt, conversationHistory, {
      temperature: 0.7,
      maxTokens: 200,
    });

    // Validate reply
    if (!validateReply(reply, intent, data)) {
      logger.warn('[LlamaReplyGenerator] Validation failed, using fallback', { intent });
      const fallback = FALLBACK_TEMPLATES[intent];
      return typeof fallback === 'function' ? fallback(data || {}) : fallback;
    }

    logger.info('[LlamaReplyGenerator] Successfully generated reply', {
      intent,
      length: reply.length,
    });

    return reply;
  } catch (error) {
    logger.error('[LlamaReplyGenerator] LLM generation failed, using fallback', {
      intent,
      error: error instanceof Error ? error.message : String(error),
    });

    // Use fallback template
    const fallback = FALLBACK_TEMPLATES[intent];
    return typeof fallback === 'function' ? fallback(data || {}) : fallback;
  }
}
