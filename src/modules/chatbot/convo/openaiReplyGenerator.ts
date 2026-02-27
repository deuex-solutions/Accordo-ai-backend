/**
 * OpenAI Reply Generator for Conversation Mode
 *
 * Generates professional procurement manager responses using OpenAI GPT-3.5 Turbo.
 * Falls back to Qwen3 (Ollama) if OpenAI is unavailable.
 *
 * This module replaces the intent-based llamaReplyGenerator with a more
 * context-aware approach using the full conversation history and deal context.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTE (Feb 2026): This file is NO LONGER called by conversationService.ts.
 *
 * The CONVERSATION mode pipeline now uses the deterministic intent layer:
 *   buildNegotiationIntent() → personaRenderer() → validateLlmOutput()
 *
 * This file is retained for:
 *   1. INSIGHTS mode compatibility (if ever routed here)
 *   2. Vendor simulation / test harnesses
 *   3. Reference implementation
 *
 * Do NOT re-add this to conversationService.ts without updating the intent layer.
 * See: src/llm/personaRenderer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ConversationIntent, Offer, Decision, RefusalType } from './types.js';
import { generateCompletion, type ChatMessage } from '../../../services/openai.service.js';
import { buildOpenAIMessages, type DealContext } from '../prompts/procurementManagerPrompt.js';
import logger from '../../../config/logger.js';
import models from '../../../models/index.js';
import type { NegotiationConfig } from '../engine/utility.js';

/**
 * Banned keywords that should never appear in responses
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
  'gpt',
  'openai',
  'ai model',
  'language model',
];

/**
 * Post-process the response to remove any banned keywords
 */
function sanitizeResponse(response: string): string {
  let sanitized = response;

  // Remove any mentions of banned keywords
  for (const keyword of BANNED_KEYWORDS) {
    const regex = new RegExp(keyword, 'gi');
    sanitized = sanitized.replace(regex, '');
  }

  // Clean up any double spaces or awkward formatting
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  return sanitized;
}

/**
 * Build additional context message based on intent and data
 * UPDATED Feb 2026: Changed from unit_price to total_price with warm & direct tone
 */
function buildIntentContext(
  intent: ConversationIntent,
  data?: {
    counterOffer?: Offer;
    vendorOffer?: Offer;
    decision?: Decision;
    preference?: string;
    refusalType?: RefusalType;
  }
): string {
  switch (intent) {
    case 'GREET':
      return 'Start the conversation with a warm, direct greeting. Introduce yourself as the procurement manager and ask the vendor to share their best offer including total price and payment terms.';

    case 'ASK_FOR_OFFER':
      // Fixed warm & direct clarification template for missing price/payment info
      return 'The vendor has not provided a complete offer yet. Use this exact response: "Thanks for getting back to us. Before we move forward, could you share the total price you\'re proposing along with your preferred payment terms?"';

    case 'COUNTER_DIRECT':
      if (data?.counterOffer) {
        return `Present a counter-offer to the vendor. Your counter-offer is: Total Price: $${data.counterOffer.total_price}, Payment Terms: ${data.counterOffer.payment_terms}. Be warm but direct. Provide brief business rationale for these terms.`;
      }
      return 'Make a counter-offer with improved terms.';

    case 'COUNTER_INDIRECT':
      return 'The current offer is not quite acceptable. Indicate that you need better terms without specifying exact numbers. Encourage the vendor to improve their total price offer.';

    case 'ACCEPT':
      if (data?.vendorOffer) {
        return `The vendor's offer is acceptable! Accept their total price offer of $${data.vendorOffer.total_price} with ${data.vendorOffer.payment_terms}. Express appreciation, confirm the agreement, and outline next steps (e.g., contract preparation, delivery scheduling).`;
      }
      return 'Accept the vendor\'s offer and confirm next steps.';

    case 'WALK_AWAY':
      if (data?.vendorOffer) {
        return `Unfortunately, the vendor's total price offer of $${data.vendorOffer.total_price} with ${data.vendorOffer.payment_terms} does not meet your requirements. Politely decline, thank them for their time, and leave the door open for future opportunities.`;
      }
      return 'The negotiation cannot proceed. Politely decline and thank the vendor.';

    case 'ESCALATE':
      return 'This negotiation requires human intervention. Inform the vendor that you will escalate to a senior procurement manager for review. Be warm but professional and provide an expected timeline for follow-up.';

    case 'ASK_FOR_PREFERENCE':
      return 'After several rounds of negotiation, ask the vendor about their priorities. Are they more focused on achieving a certain total price point, or are payment terms more important? This helps identify potential trade-offs.';

    case 'ACKNOWLEDGE_PREFERENCE':
      if (data?.preference) {
        return `The vendor has indicated their preference: ${data.preference}. Acknowledge this insight warmly and adjust your approach accordingly. Continue the negotiation with this understanding.`;
      }
      return 'Acknowledge the vendor\'s stated preference and continue negotiating.';

    case 'HANDLE_REFUSAL':
      const refusalResponses: Record<NonNullable<RefusalType>, string> = {
        NO: 'The vendor has declined to provide certain information. Acknowledge their position warmly and professionally, then continue the negotiation with available information.',
        LATER: 'The vendor wants to provide information later. Accept this graciously and suggest continuing with current terms while awaiting their update.',
        ALREADY_SHARED: 'The vendor believes they have already shared the requested information. Politely acknowledge and review what was previously discussed.',
        CONFUSED: 'The vendor seems unsure about your request. Clarify your question in simpler terms with a warm, helpful tone.',
      };
      return data?.refusalType ? refusalResponses[data.refusalType] : refusalResponses.NO;

    default:
      return 'Continue the negotiation professionally with a warm, direct tone.';
  }
}

/**
 * Fallback templates for when both OpenAI and Qwen3 fail
 * UPDATED Feb 2026: Changed from unit_price to total_price with warm & direct tone
 */
const FALLBACK_TEMPLATES: Record<ConversationIntent, string | ((data: any) => string)> = {
  GREET: "Hello! I'm the procurement manager handling this negotiation. Please share your best offer with the total price and payment terms, and we'll work together to find mutually agreeable terms.",

  ASK_FOR_OFFER: "Thanks for getting back to us. Before we move forward, could you share the total price you're proposing along with your preferred payment terms?",

  COUNTER_DIRECT: (data: { counterOffer: Offer }) =>
    `Thanks for your offer. After careful consideration, we'd like to propose a total price of $${data.counterOffer.total_price} with ${data.counterOffer.payment_terms}. These terms align with our budget requirements while ensuring a fair partnership. What do you think?`,

  COUNTER_INDIRECT: "We appreciate your offer, but we'd need improved terms to move forward. Could you review your total pricing and payment conditions? We're committed to finding a solution that works for both parties.",

  ACCEPT: (data: { vendorOffer: Offer }) =>
    `Excellent! We're pleased to accept your offer of $${data.vendorOffer.total_price} total with ${data.vendorOffer.payment_terms}. We'll prepare the necessary documentation and be in touch shortly to finalize the agreement. Thanks for your partnership.`,

  WALK_AWAY: "Unfortunately, the current terms don't align with our requirements, and we're unable to proceed at this time. We appreciate the time you've invested in this discussion. Should circumstances change, we'd welcome the opportunity to reconnect.",

  ESCALATE: "This negotiation involves considerations that require senior management review. I'll escalate this to our procurement director, who will follow up with you within 2 business days. Thanks for your patience.",

  ASK_FOR_PREFERENCE: "We've had several productive exchanges. To help us find the best path forward, could you share what's most important to you in this deal - achieving a specific total price point, or having flexible payment terms?",

  ACKNOWLEDGE_PREFERENCE: "Thanks for sharing that insight. Understanding your priorities helps us work toward a solution that addresses your key concerns. Let's continue our discussion with this in mind.",

  HANDLE_REFUSAL: "I understand. Let's proceed with the information we have and work toward an agreement. Please feel free to share additional details whenever you're ready.",
};

/**
 * Get deal context from database
 */
async function getDealContext(dealId: string): Promise<DealContext | null> {
  try {
    const deal = await models.ChatbotDeal.findByPk(dealId, {
      include: [
        { model: models.Requisition, as: 'Requisition' },
        { model: models.User, as: 'Vendor' },
      ],
    });

    if (!deal) {
      return null;
    }

    const vendor = (deal as any).Vendor;
    const negotiationConfig = deal.negotiationConfigJson as NegotiationConfig;
    const wizardConfig = (deal.negotiationConfigJson as any)?.wizardConfig;
    // Priority is stored in negotiationConfigJson, not as a direct field
    const priority = (negotiationConfig as any)?.priority || wizardConfig?.priority || 'MEDIUM';

    return {
      dealId: deal.id,
      title: deal.title,
      vendorId: deal.vendorId || undefined,
      vendorName: vendor?.name || undefined,
      vendorEmail: vendor?.email || undefined,
      requisitionId: deal.requisitionId || undefined,
      priority: priority as 'HIGH' | 'MEDIUM' | 'LOW',
      negotiationConfig,
      wizardConfig,
    };
  } catch (error) {
    logger.error('[OpenAIReplyGenerator] Failed to get deal context', { dealId, error });
    return null;
  }
}

/**
 * Generate Accordo's reply using OpenAI GPT-3.5 Turbo
 *
 * @param intent - Conversation intent (determines additional context)
 * @param conversationHistory - Previous messages for context
 * @param data - Intent-specific data (counter-offer, vendor offer, etc.)
 * @param dealId - Deal ID for fetching full context
 * @returns Generated reply text
 */
export async function generateAccordoReplyWithOpenAI(
  intent: ConversationIntent,
  conversationHistory: Array<{ role: string; content: string }>,
  data?: {
    counterOffer?: Offer;
    vendorOffer?: Offer;
    decision?: Decision;
    preference?: string;
    refusalType?: RefusalType;
  },
  dealId?: string
): Promise<string> {
  try {
    // Get deal context if dealId is provided
    let dealContext: DealContext | null = null;
    if (dealId) {
      dealContext = await getDealContext(dealId);
    }

    // Build messages for OpenAI
    let messages: ChatMessage[];

    if (dealContext) {
      // Use full context with procurement manager prompt
      messages = await buildOpenAIMessages(dealContext, conversationHistory);
    } else {
      // Fallback: simple system prompt without full context
      messages = [
        {
          role: 'system',
          content: `You are a professional procurement manager negotiating on behalf of your organization.
Be professional, formal, and courteous. Keep responses concise (2-3 paragraphs max).
Never mention AI, algorithms, utility scores, or internal systems.`,
        },
        ...conversationHistory.map((msg) => ({
          role: (msg.role === 'VENDOR' ? 'user' : 'assistant') as 'user' | 'assistant',
          content: msg.content,
        })),
      ];
    }

    // Add intent-specific context as the final user message
    const intentContext = buildIntentContext(intent, data);
    messages.push({
      role: 'user',
      content: `[Internal guidance - respond to the vendor's last message]: ${intentContext}`,
    });

    logger.info('[OpenAIReplyGenerator] Generating reply', {
      intent,
      historyLength: conversationHistory.length,
      hasDealContext: !!dealContext,
      dealId,
    });

    // Generate completion with OpenAI (falls back to Qwen3 automatically)
    const response = await generateCompletion(messages, {
      temperature: 0.7,
      maxTokens: 500,
      dealId,
      userId: dealContext?.vendorId,
    });

    // Sanitize response
    const sanitizedResponse = sanitizeResponse(response.content);

    logger.info('[OpenAIReplyGenerator] Successfully generated reply', {
      intent,
      length: sanitizedResponse.length,
      model: response.model,
      fallbackUsed: response.fallbackUsed,
      tokensUsed: response.usage.totalTokens,
    });

    return sanitizedResponse;
  } catch (error) {
    logger.error('[OpenAIReplyGenerator] Generation failed, using fallback', {
      intent,
      error: error instanceof Error ? error.message : String(error),
    });

    // Use static fallback template
    const fallback = FALLBACK_TEMPLATES[intent];
    return typeof fallback === 'function' ? fallback(data || {}) : fallback;
  }
}

// Export as default for easy switching
export { generateAccordoReplyWithOpenAI as generateAccordoReply };

export default {
  generateAccordoReply: generateAccordoReplyWithOpenAI,
};
