/**
 * Template Variables Helper
 *
 * Extracted from process-conversation-turn.ts to break circular dependencies
 * between process-conversation-turn.ts and graph/index.ts.
 */

import logger from '../../../config/logger.js';
import { ChatbotDeal } from '../../../models/chatbot/chatbot-deal.js';
import { ChatbotTemplate } from '../../../models/chatbot/chatbot-template.js';
import type { ConvoIntent, TemplateVariables } from './conversation-templates.js';
import type { ConvoState } from './enhanced-convo-router.js';

/**
 * Prepare template variables based on deal, template, and intent
 */
export async function prepareTemplateVariables(
  deal: ChatbotDeal,
  template: ChatbotTemplate | null,
  convoState: ConvoState,
  intent: ConvoIntent,
  vendorMessage: string
): Promise<TemplateVariables> {
  const variables: TemplateVariables = {};

  // Always include counterparty name
  variables.counterparty = deal.counterparty || 'there';

  // Get template parameters if available
  const templateParams = template?.configJson as any;

  // Intent-specific variables
  switch (intent) {
    case 'GREET':
      // Just counterparty needed
      break;

    case 'ASK_FOR_OFFER':
      variables.productName = templateParams?.productName || 'this product';
      variables.quantity = templateParams?.quantity || 100;
      break;

    case 'ASK_CLARIFY':
      variables.reason = determineClairificationReason(
        convoState,
        vendorMessage
      );
      break;

    case 'COUNTER':
      // Extract pricing info from template/deal
      variables.targetPrice = templateParams?.targetPrice || 100;
      variables.currentPrice = extractCurrentPrice(vendorMessage, deal);
      variables.paymentTerms = templateParams?.paymentTerms || 'Net 30';
      variables.reason = generateCounterReason(
        templateParams,
        variables.targetPrice,
        variables.currentPrice
      );
      break;

    case 'ACCEPT':
      variables.currentPrice = extractCurrentPrice(vendorMessage, deal);
      variables.paymentTerms =
        extractPaymentTerms(vendorMessage) || 'the agreed terms';
      break;

    case 'ESCALATE':
      variables.reason = generateEscalationReason(convoState);
      break;

    case 'WALK_AWAY':
      variables.reason = generateWalkAwayReason(convoState, templateParams);
      break;

    case 'SMALL_TALK':
      // Just counterparty needed
      break;
  }

  logger.info('[ProcessConversationTurn] Template variables prepared', {
    dealId: deal.id,
    intent,
    variableKeys: Object.keys(variables),
  });

  return variables;
}

/**
 * Extract current price from vendor message
 */
function extractCurrentPrice(
  vendorMessage: string,
  deal: ChatbotDeal
): number | undefined {
  // Try to extract from message
  const priceMatch = vendorMessage.match(/\$(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (priceMatch) {
    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    return price;
  }

  // Try to get from deal's latest vendor offer
  const latestOffer = deal.latestVendorOffer as any;
  if (latestOffer?.total_price) {
    return latestOffer.total_price;
  }

  return undefined;
}

/**
 * Extract payment terms from vendor message
 */
function extractPaymentTerms(vendorMessage: string): string | null {
  // Look for payment terms patterns
  const termsMatch = vendorMessage.match(
    /(?:net\s*)?(\d+)\s*days?|upon\s+delivery/i
  );
  if (termsMatch) {
    if (termsMatch[0].toLowerCase().includes('upon')) {
      return 'upon delivery';
    }
    return `Net ${termsMatch[1]}`;
  }

  return null;
}

/**
 * Determine reason for clarification request
 */
function determineClairificationReason(
  convoState: ConvoState,
  vendorMessage: string
): string {
  if (convoState.lastRefusalType === 'CONFUSED') {
    return 'what specific information you need from me';
  }

  if (convoState.lastRefusalType === 'ALREADY_SHARED') {
    return 'the pricing details, as I may have missed them';
  }

  if (!convoState.context.mentionedPrice) {
    return 'your unit price';
  }

  if (!convoState.context.mentionedTerms) {
    return 'your payment terms';
  }

  return 'a few details in your last message';
}

/**
 * Generate reason for counter-offer
 */
function generateCounterReason(
  templateParams: any,
  targetPrice?: number,
  currentPrice?: number
): string {
  const reasons: string[] = [];

  if (currentPrice && targetPrice && currentPrice > targetPrice) {
    const diff = currentPrice - targetPrice;
    const percentDiff = ((diff / currentPrice) * 100).toFixed(1);
    reasons.push(
      `This represents a ${percentDiff}% adjustment that aligns better with our budget constraints`
    );
  }

  if (templateParams?.marketPrice) {
    reasons.push(
      `Our analysis shows the market rate is around $${templateParams.marketPrice}`
    );
  }

  if (templateParams?.volume) {
    reasons.push(
      `Given the volume of ${templateParams.volume} units, we believe this pricing is fair`
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      'This pricing aligns with our budget and market analysis'
    );
  }

  return reasons.join('. ') + '.';
}

/**
 * Generate reason for escalation
 */
function generateEscalationReason(convoState: ConvoState): string {
  if (convoState.refusalCount >= 5) {
    return "we've had difficulty getting the information needed to proceed";
  }

  if (convoState.turnCount > 15) {
    return 'this negotiation has become complex and needs additional oversight';
  }

  return 'this requires expertise beyond my current scope';
}

/**
 * Generate reason for walking away
 */
function generateWalkAwayReason(
  convoState: ConvoState,
  templateParams: any
): string {
  if (convoState.refusalCount > 3) {
    return "we haven't been able to establish clear terms for collaboration";
  }

  if (templateParams?.maxAcceptablePrice) {
    return `the pricing exceeds our maximum acceptable threshold of $${templateParams.maxAcceptablePrice}`;
  }

  return 'the terms do not align with our business requirements';
}
