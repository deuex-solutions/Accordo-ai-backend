/**
 * Process Conversation Turn
 *
 * Main orchestrator for processing vendor messages and generating Accordo responses.
 * Integrates conversation templates, enhanced router, and decision engine.
 */

import logger from '../../../config/logger.js';
import { CustomError, NotFoundError } from '../../../utils/custom-error.js';
import { ChatbotDeal } from '../../../models/chatbot-deal.js';
import { ChatbotTemplate } from '../../../models/chatbot-template.js';
import {
  generateConversationMessage,
  substituteVariables,
  selectTemplate,
  type ConvoIntent,
  type TemplateVariables,
} from './conversation-templates.js';
import {
  classifyVendorIntent,
  classifyRefusal,
  handleRefusal,
  handleSmallTalk,
  determineNextIntent,
  updateConvoState,
  initializeConvoState,
  validateConvoState,
  getStateSummary,
  containsPriceInfo,
  containsTermsInfo,
  type ConvoState,
  type VendorIntent,
  type RefusalType,
} from './enhanced-convo-router.js';
import { ChatbotMessage } from '../../../models/chatbot-message.js';
import { checkScopeGuard } from '../engine/scope-guard.js';
import { classifyError, getErrorFallbackResponse } from '../engine/error-recovery.js';
import { sanitizeNegotiationHistory } from '../engine/history-sanitizer.js';

/**
 * Input for processing a conversation turn
 */
export interface ProcessConversationTurnInput {
  dealId: string;
  vendorMessage: string;
  userId: number;
}

/**
 * Result of processing a conversation turn
 */
export interface ProcessConversationTurnResult {
  accordoMessage: string;
  accordoIntent: ConvoIntent;
  updatedState: ConvoState;
  vendorIntent: VendorIntent;
  refusalType?: RefusalType;
}

/**
 * Main function to process a conversation turn
 *
 * @param input - Deal context and vendor message
 * @returns Accordo's response and updated state
 */
export async function processConversationTurn(
  input: ProcessConversationTurnInput
): Promise<ProcessConversationTurnResult> {
  const { dealId, vendorMessage, userId } = input;

  logger.info('[ProcessConversationTurn] Starting turn processing', {
    dealId,
    userId,
    messageLength: vendorMessage.length,
  });

  try {
    // Step 1: Load deal and current state
    const { deal, template, convoState } = await loadDealContext(dealId);

    // Step 1.5: Scope Guard — reject off-topic messages before any processing
    const scopeCheck = checkScopeGuard(vendorMessage, deal.title);
    if (scopeCheck.isOffTopic) {
      logger.info('[ProcessConversationTurn] Off-topic message blocked by scope guard', {
        dealId,
        category: scopeCheck.category,
        confidence: scopeCheck.confidence,
      });

      return {
        accordoMessage: scopeCheck.response!,
        accordoIntent: 'REDIRECT' as ConvoIntent,
        updatedState: convoState,
        vendorIntent: 'SMALL_TALK' as VendorIntent,
        refusalType: undefined,
      };
    }

    // Step 2: Load conversation history for context
    const conversationHistory = await loadConversationHistory(dealId);

    // Step 3: Classify vendor intent
    const vendorIntent = await classifyVendorIntent(
      vendorMessage,
      conversationHistory
    );

    logger.info('[ProcessConversationTurn] Vendor intent classified', {
      dealId,
      vendorIntent,
    });

    // Step 4: Handle refusals if detected
    let refusalType: RefusalType | undefined;
    let nextIntent: ConvoIntent;

    if (vendorIntent === 'REFUSAL') {
      refusalType = await classifyRefusal(vendorMessage);
      nextIntent = handleRefusal(convoState, refusalType);

      logger.info('[ProcessConversationTurn] Refusal handled', {
        dealId,
        refusalType,
        nextIntent,
      });
    } else if (vendorIntent === 'SMALL_TALK') {
      // Handle small talk
      nextIntent = handleSmallTalk(convoState);
    } else {
      // Step 5: Determine next Accordo intent using state machine
      nextIntent = determineNextIntent(convoState, vendorIntent, vendorMessage);
    }

    logger.info('[ProcessConversationTurn] Next intent determined', {
      dealId,
      nextIntent,
      currentPhase: convoState.phase,
    });

    // Step 6: For COUNTER intent, check if we need decision engine
    // (This will be integrated with decision engine in future)
    const shouldUseDecisionEngine = nextIntent === 'COUNTER' &&
      (containsPriceInfo(vendorMessage) || containsTermsInfo(vendorMessage));

    if (shouldUseDecisionEngine) {
      logger.info('[ProcessConversationTurn] Should use decision engine', {
        dealId,
      });
      // TODO: Integrate with decision engine
      // For now, use COUNTER template
    }

    // Step 7: Prepare template variables
    const templateVariables = await prepareTemplateVariables(
      deal,
      template,
      convoState,
      nextIntent,
      vendorMessage
    );

    // Step 8: Generate Accordo message using templates
    const accordoMessage = generateConversationMessage(
      dealId,
      deal.round,
      nextIntent,
      templateVariables
    );

    logger.info('[ProcessConversationTurn] Message generated', {
      dealId,
      intent: nextIntent,
      messageLength: accordoMessage.length,
    });

    // Step 9: Update conversation state
    const updatedState = updateConvoState(
      convoState,
      vendorIntent,
      nextIntent
    );

    // Step 10: Save updated state to database
    await saveDealState(deal, updatedState);

    logger.info('[ProcessConversationTurn] Turn processing complete', {
      dealId,
      stateSummary: getStateSummary(updatedState),
    });

    return {
      accordoMessage,
      accordoIntent: nextIntent,
      updatedState,
      vendorIntent,
      refusalType,
    };
  } catch (error) {
    // Error Recovery: return human-readable fallback instead of crashing
    const errorCategory = classifyError(error);
    logger.error('[ProcessConversationTurn] Turn processing failed — using error recovery', {
      dealId,
      errorCategory,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    // For not-found errors, still throw (controller needs to return 404)
    if (error instanceof CustomError && error.statusCode === 404) {
      throw error;
    }

    // Return a graceful fallback response instead of crashing
    const fallbackResponse = getErrorFallbackResponse(errorCategory);
    return {
      accordoMessage: fallbackResponse,
      accordoIntent: 'ERROR_RECOVERY' as ConvoIntent,
      updatedState: initializeConvoState(),
      vendorIntent: 'UNKNOWN' as VendorIntent,
      refusalType: undefined,
    };
  }
}

/**
 * Load deal context including template and conversation state
 */
async function loadDealContext(dealId: string): Promise<{
  deal: ChatbotDeal;
  template: ChatbotTemplate | null;
  convoState: ConvoState;
}> {
  // Load deal with template
  const deal = await ChatbotDeal.findByPk(dealId, {
    include: [
      {
        model: ChatbotTemplate,
        as: 'Template',
      },
    ],
  });

  if (!deal) {
    throw new NotFoundError(`Deal not found: ${dealId}`);
  }

  // Load or initialize conversation state
  let convoState: ConvoState;

  if (deal.convoStateJson && validateConvoState(deal.convoStateJson)) {
    convoState = deal.convoStateJson as ConvoState;
    logger.info('[ProcessConversationTurn] Loaded existing state', {
      dealId,
      stateSummary: getStateSummary(convoState),
    });
  } else {
    convoState = initializeConvoState();
    logger.info('[ProcessConversationTurn] Initialized new state', {
      dealId,
    });
  }

  return {
    deal,
    template: deal.Template || null,
    convoState,
  };
}

/**
 * Load conversation history from database
 */
async function loadConversationHistory(
  dealId: string
): Promise<Array<{ role: string; content: string }>> {
  const messages = await ChatbotMessage.findAll({
    where: { dealId },
    order: [['createdAt', 'ASC']],
    limit: 10, // Last 10 messages for context
  });

  const rawHistory = messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  // Sanitize stale negotiation context before passing to LLM
  const { messages: sanitizedHistory, sanitizedCount } = sanitizeNegotiationHistory(rawHistory);
  if (sanitizedCount > 0) {
    logger.info(`[ProcessConversationTurn] Sanitized ${sanitizedCount} stale messages for deal ${dealId}`);
  }

  return sanitizedHistory;
}

/**
 * Prepare template variables based on deal context and intent
 */
async function prepareTemplateVariables(
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

/**
 * Save updated conversation state to deal
 */
async function saveDealState(
  deal: ChatbotDeal,
  convoState: ConvoState
): Promise<void> {
  await deal.update({
    convoStateJson: convoState as any,
    lastMessageAt: new Date(),
  });

  logger.info('[ProcessConversationTurn] State saved to database', {
    dealId: deal.id,
    phase: convoState.phase,
    turnCount: convoState.turnCount,
  });
}

/**
 * Helper to check if offer parsing is needed
 */
export function shouldParseOffer(
  vendorIntent: VendorIntent,
  vendorMessage: string
): boolean {
  return (
    vendorIntent === 'PROVIDE_OFFER' &&
    (containsPriceInfo(vendorMessage) || containsTermsInfo(vendorMessage))
  );
}

/**
 * Helper to check if decision engine should be invoked
 */
export function shouldInvokeDecisionEngine(
  accordoIntent: ConvoIntent,
  vendorIntent: VendorIntent
): boolean {
  return (
    accordoIntent === 'COUNTER' &&
    (vendorIntent === 'PROVIDE_OFFER' || vendorIntent === 'NEGOTIATE')
  );
}

/**
 * Get conversation phase summary for debugging
 */
export function getConversationSummary(
  deal: ChatbotDeal,
  convoState: ConvoState
): {
  dealId: string;
  title: string;
  round: number;
  phase: string;
  turnCount: number;
  refusalCount: number;
  hasTemplate: boolean;
} {
  return {
    dealId: deal.id,
    title: deal.title,
    round: deal.round,
    phase: convoState.phase,
    turnCount: convoState.turnCount,
    refusalCount: convoState.refusalCount,
    hasTemplate: !!deal.templateId,
  };
}

/**
 * Validate that deal is in valid state for conversation
 */
export function validateDealForConversation(deal: ChatbotDeal): void {
  if (deal.status === 'ACCEPTED') {
    throw new CustomError(
      'Cannot process messages for accepted deals',
      400
    );
  }

  if (deal.status === 'WALKED_AWAY') {
    throw new CustomError(
      'Cannot process messages for deals that have been walked away from',
      400
    );
  }

  if (deal.status === 'ESCALATED') {
    throw new CustomError(
      'Cannot process messages for escalated deals',
      400
    );
  }

  if (deal.mode !== 'CONVERSATION') {
    throw new CustomError(
      'Deal is not in CONVERSATION mode',
      400
    );
  }
}

/**
 * Extract vendor preferences from conversation history
 * (For future use with preference detection)
 */
export async function extractVendorPreferences(
  dealId: string
): Promise<{
  preferredNegotiationStyle: 'price' | 'terms' | 'balanced' | 'unknown';
  responsiveness: 'high' | 'medium' | 'low';
  priceFlexibility: 'high' | 'medium' | 'low' | 'unknown';
}> {
  // Placeholder for future implementation
  // This would analyze conversation history to detect patterns
  return {
    preferredNegotiationStyle: 'unknown',
    responsiveness: 'medium',
    priceFlexibility: 'unknown',
  };
}
