/**
 * Conversation Template System
 *
 * Provides natural language variations for each conversation intent type.
 * Uses deterministic template selection based on dealId + round + intent
 * for consistency across conversation turns.
 */

import { createHash } from 'crypto';

/**
 * Conversation intent types for Accordo's responses
 */
export type ConvoIntent =
  | 'GREET'
  | 'ASK_FOR_OFFER'
  | 'ASK_CLARIFY'
  | 'COUNTER'
  | 'ACCEPT'
  | 'ESCALATE'
  | 'WALK_AWAY'
  | 'SMALL_TALK';

/**
 * Template structure with substitution variables
 */
export interface ConversationTemplate {
  intent: ConvoIntent;
  templates: string[];
  requiresSubstitution: boolean;
  variables?: string[];
}

/**
 * Variables available for template substitution
 */
export interface TemplateVariables {
  counterparty?: string;
  targetPrice?: number;
  currentPrice?: number;
  paymentTerms?: string;
  reason?: string;
  productName?: string;
  quantity?: number;
  deliveryDate?: string;
  minAcceptablePrice?: number;
  maxAcceptablePrice?: number;
  currentTerms?: string;
  targetTerms?: string;
}

/**
 * All conversation templates organized by intent
 */
const CONVERSATION_TEMPLATES: Record<ConvoIntent, ConversationTemplate> = {
  GREET: {
    intent: 'GREET',
    requiresSubstitution: true,
    variables: ['counterparty'],
    templates: [
      "Hello {counterparty}! Thanks for reaching out. I'm looking forward to discussing this opportunity with you.",
      "Hi {counterparty}, great to connect with you. Let's explore how we can work together on this.",
      "Good to hear from you, {counterparty}! I appreciate you taking the time to engage with us on this negotiation.",
      "Hello {counterparty}! I'm excited to discuss this deal with you. Let's see if we can find a mutually beneficial agreement.",
      "Hi {counterparty}, thanks for getting in touch. I'm ready to explore the possibilities here.",
      "Greetings {counterparty}! I'm pleased to be working with you on this. Looking forward to a productive conversation.",
      "Hello {counterparty}! Thanks for your interest. I'm optimistic we can reach a great outcome together.",
    ],
  },

  ASK_FOR_OFFER: {
    intent: 'ASK_FOR_OFFER',
    requiresSubstitution: true,
    variables: ['counterparty', 'productName', 'quantity'],
    templates: [
      "Thanks for connecting, {counterparty}. To move forward, could you please share your pricing and payment terms for this opportunity?",
      "I'd like to understand your proposal better. Could you provide your unit price and payment terms for the {quantity} units we're looking at?",
      "Before we proceed, {counterparty}, could you share your offer? I'm particularly interested in your pricing structure and payment terms.",
      "To help us evaluate this opportunity, could you please provide your pricing and terms? This will help me understand if we're aligned.",
      "Thanks, {counterparty}. What pricing and payment terms are you proposing for this deal?",
      "I appreciate your interest. Could you outline your offer including unit price and payment terms so we can assess the fit?",
      "Let's get started with the specifics. What are you proposing in terms of price and payment terms for these {quantity} units?",
    ],
  },

  ASK_CLARIFY: {
    intent: 'ASK_CLARIFY',
    requiresSubstitution: true,
    variables: ['counterparty', 'reason'],
    templates: [
      "Thanks for that, {counterparty}. I need a bit more clarity on {reason}. Could you provide more details?",
      "I appreciate your response, but I'm unclear on {reason}. Could you elaborate on that point?",
      "Thanks, {counterparty}. To make sure I understand correctly, could you clarify {reason}?",
      "I want to make sure we're on the same page. Could you provide more information about {reason}?",
      "{counterparty}, I'm having trouble understanding {reason} from your last message. Could you help clarify?",
      "Before we move forward, I'd like to better understand {reason}. Could you expand on that?",
      "Thanks for the update. I need some clarification on {reason} to proceed effectively. Can you help with that?",
    ],
  },

  COUNTER: {
    intent: 'COUNTER',
    requiresSubstitution: true,
    variables: [
      'currentPrice',
      'targetPrice',
      'paymentTerms',
      'reason',
      'counterparty',
    ],
    templates: [
      "Thank you for your offer of ${currentPrice}, {counterparty}. Based on our analysis and market conditions, I'd like to propose ${targetPrice} with {paymentTerms}. {reason}",
      "I appreciate your proposal at ${currentPrice}. However, our target is closer to ${targetPrice} with {paymentTerms}. {reason}",
      "Thanks for the offer, {counterparty}. We're looking at a price point of ${targetPrice} with {paymentTerms} rather than ${currentPrice}. Here's why: {reason}",
      "{counterparty}, I've reviewed your ${currentPrice} proposal. Our position is ${targetPrice} with {paymentTerms}. {reason}",
      "I appreciate you sharing ${currentPrice} as your offer. Our evaluation suggests ${targetPrice} with {paymentTerms} would be more aligned with our objectives. {reason}",
      "Thank you, {counterparty}. While I see you've proposed ${currentPrice}, we're targeting ${targetPrice} with {paymentTerms}. {reason}",
      "Thanks for your offer. Our analysis indicates that ${targetPrice} with {paymentTerms} would work better for us than your ${currentPrice} proposal. {reason}",
    ],
  },

  ACCEPT: {
    intent: 'ACCEPT',
    requiresSubstitution: true,
    variables: ['counterparty', 'currentPrice', 'paymentTerms'],
    templates: [
      "Excellent, {counterparty}! I'm pleased to accept your offer of ${currentPrice} with {paymentTerms}. This works well for both of us. I'll prepare the necessary documentation.",
      "Great news, {counterparty}! Your proposal of ${currentPrice} with {paymentTerms} is acceptable. Let's move forward with finalizing this agreement.",
      "Perfect, {counterparty}! I'm happy to accept ${currentPrice} with {paymentTerms}. This meets our requirements and I believe it's a fair deal for both parties.",
      "Wonderful, {counterparty}! Your offer of ${currentPrice} and {paymentTerms} works for us. I'm ready to proceed with the next steps.",
      "Excellent offer, {counterparty}! I'm accepting ${currentPrice} with {paymentTerms}. Looking forward to a successful partnership.",
      "That works perfectly, {counterparty}! ${currentPrice} with {paymentTerms} is acceptable. Let's finalize this deal.",
      "Great, {counterparty}! I'm pleased to move forward with your proposal of ${currentPrice} and {paymentTerms}. This is a win-win agreement.",
    ],
  },

  ESCALATE: {
    intent: 'ESCALATE',
    requiresSubstitution: true,
    variables: ['counterparty', 'reason'],
    templates: [
      "{counterparty}, I appreciate our discussion, but I think we need additional expertise here. {reason} I'm going to bring in a colleague to help us move forward effectively.",
      "Thanks for your engagement, {counterparty}. Given {reason}, I'd like to involve my team lead to ensure we're making the best decision for both parties.",
      "{counterparty}, this negotiation requires input beyond my scope. {reason} I'll loop in a senior team member who can provide better guidance.",
      "I value our conversation, {counterparty}, but {reason} I think it's best to escalate this to someone with more authority to help us reach an agreement.",
      "{counterparty}, to ensure we handle this properly, I need to bring in additional support. {reason} A colleague will be in touch shortly.",
      "Thanks, {counterparty}. Due to {reason}, I'm going to escalate this to my manager who can work with you directly on finding a solution.",
      "{counterparty}, I want to make sure we get this right. {reason} I'm going to involve someone from my team who can help us navigate this more effectively.",
    ],
  },

  WALK_AWAY: {
    intent: 'WALK_AWAY',
    requiresSubstitution: true,
    variables: ['counterparty', 'reason'],
    templates: [
      "{counterparty}, I appreciate the time we've spent on this, but {reason} I don't think we can reach an agreement that works for both of us. I wish you the best in finding another partner.",
      "Thank you for your efforts, {counterparty}. Unfortunately, {reason} we're not able to move forward with this deal. I appreciate your understanding.",
      "{counterparty}, after careful consideration, {reason} I've concluded that we should part ways on this opportunity. Thanks for your time and professionalism.",
      "I've valued our discussion, {counterparty}, but {reason} I don't believe we can find mutually acceptable terms. Best of luck with your business.",
      "{counterparty}, I appreciate your engagement, but {reason} this deal isn't the right fit for us. Thank you for your time.",
      "Thanks for working with me, {counterparty}. Regrettably, {reason} I need to step away from this negotiation. I hope we can collaborate on future opportunities.",
      "{counterparty}, after reviewing everything, {reason} I've decided not to proceed further. I appreciate your professionalism throughout this process.",
    ],
  },

  SMALL_TALK: {
    intent: 'SMALL_TALK',
    requiresSubstitution: true,
    variables: ['counterparty'],
    templates: [
      "Thanks for sharing, {counterparty}! I appreciate the conversation. Now, let's focus on the business at hand. What are your thoughts on the pricing and terms?",
      "That's great to hear, {counterparty}! I enjoy our exchanges. Let's circle back to the negotiation - could you share your proposal?",
      "I appreciate that, {counterparty}. It's good to build rapport. Now, shall we discuss the specifics of your offer?",
      "Thanks, {counterparty}! Good to connect on a personal level. Let's get down to business though - what are you proposing for this deal?",
      "That's interesting, {counterparty}! I'm glad we're building a relationship. Could we shift focus back to the pricing and payment terms?",
      "I hear you, {counterparty}! It's nice to chat. Let's make sure we address the core business items - what's your offer looking like?",
      "Thanks for that, {counterparty}! Good conversation. Now, let's ensure we're making progress on the actual negotiation. Your thoughts on pricing?",
    ],
  },
};

/**
 * Hash function for deterministic template selection
 * Uses SHA-256 for consistent, reproducible results
 */
function hashString(input: string): number {
  const hash = createHash('sha256').update(input).digest('hex');
  // Convert first 8 characters of hex to integer
  return parseInt(hash.substring(0, 8), 16);
}

/**
 * Select a template deterministically based on deal context
 *
 * @param dealId - Unique deal identifier
 * @param round - Current negotiation round
 * @param intent - Conversation intent type
 * @returns Selected template string (without substitution)
 */
export function selectTemplate(
  dealId: string,
  round: number,
  intent: ConvoIntent
): string {
  const templateSet = CONVERSATION_TEMPLATES[intent];
  if (!templateSet) {
    throw new Error(`No templates found for intent: ${intent}`);
  }

  // Create deterministic seed
  const seed = `${dealId}-${round}-${intent}`;
  const hash = hashString(seed);

  // Select template using modulo
  const index = hash % templateSet.templates.length;
  return templateSet.templates[index];
}

/**
 * Get all templates for a specific intent (for testing/debugging)
 */
export function getTemplatesForIntent(intent: ConvoIntent): string[] {
  const templateSet = CONVERSATION_TEMPLATES[intent];
  if (!templateSet) {
    throw new Error(`No templates found for intent: ${intent}`);
  }
  return templateSet.templates;
}

/**
 * Substitute variables in a template string
 *
 * @param template - Template string with {variable} placeholders
 * @param variables - Object containing variable values
 * @returns Template with substituted values
 */
export function substituteVariables(
  template: string,
  variables: TemplateVariables
): string {
  let result = template;

  // Replace each variable placeholder with its value
  Object.entries(variables).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const placeholder = `{${key}}`;
      const replacement = String(value);
      result = result.replace(new RegExp(placeholder, 'g'), replacement);
    }
  });

  // Check if there are still unreplaced variables
  const unreplacedVars = result.match(/\{[a-zA-Z]+\}/g);
  if (unreplacedVars) {
    // Log warning but don't fail - some variables may be optional
    console.warn(
      `Template has unreplaced variables: ${unreplacedVars.join(', ')}`
    );
  }

  return result;
}

/**
 * Generate a complete conversation message
 *
 * Combines template selection and variable substitution
 *
 * @param dealId - Unique deal identifier
 * @param round - Current negotiation round
 * @param intent - Conversation intent type
 * @param variables - Variables for template substitution
 * @returns Fully formed conversation message
 */
export function generateConversationMessage(
  dealId: string,
  round: number,
  intent: ConvoIntent,
  variables: TemplateVariables
): string {
  // Select template deterministically
  const template = selectTemplate(dealId, round, intent);

  // Substitute variables
  const message = substituteVariables(template, variables);

  return message;
}

/**
 * Validate that all required variables are present
 *
 * @param intent - Conversation intent type
 * @param variables - Variables provided for substitution
 * @returns True if all required variables are present, false otherwise
 */
export function validateTemplateVariables(
  intent: ConvoIntent,
  variables: TemplateVariables
): boolean {
  const templateSet = CONVERSATION_TEMPLATES[intent];
  if (!templateSet || !templateSet.requiresSubstitution) {
    return true; // No validation needed
  }

  const requiredVars = templateSet.variables || [];
  const missingVars = requiredVars.filter(
    (varName) => variables[varName as keyof TemplateVariables] === undefined
  );

  if (missingVars.length > 0) {
    console.warn(
      `Missing required variables for ${intent}: ${missingVars.join(', ')}`
    );
    return false;
  }

  return true;
}

/**
 * Get metadata about a template set
 */
export function getTemplateMetadata(intent: ConvoIntent): {
  intent: ConvoIntent;
  count: number;
  requiresSubstitution: boolean;
  variables: string[];
} {
  const templateSet = CONVERSATION_TEMPLATES[intent];
  if (!templateSet) {
    throw new Error(`No templates found for intent: ${intent}`);
  }

  return {
    intent: templateSet.intent,
    count: templateSet.templates.length,
    requiresSubstitution: templateSet.requiresSubstitution,
    variables: templateSet.variables || [],
  };
}

/**
 * Get all available intent types
 */
export function getAllIntents(): ConvoIntent[] {
  return Object.keys(CONVERSATION_TEMPLATES) as ConvoIntent[];
}

/**
 * Get total template count across all intents
 */
export function getTotalTemplateCount(): number {
  return Object.values(CONVERSATION_TEMPLATES).reduce(
    (sum, template) => sum + template.templates.length,
    0
  );
}
