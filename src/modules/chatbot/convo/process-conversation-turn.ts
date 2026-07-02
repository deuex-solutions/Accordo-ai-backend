/**
 * Process Conversation Turn
 *
 * Main orchestrator for processing vendor messages and generating Accordo responses.
 * Integrates conversation templates, enhanced router, and decision engine.
 */

import logger from '../../../config/logger.js';
import { CustomError, NotFoundError } from '../../../utils/custom-error.js';
import { ChatbotDeal } from '../../../models/chatbot/chatbot-deal.js';
import { ChatbotTemplate } from '../../../models/chatbot/chatbot-template.js';
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
import { ChatbotMessage } from '../../../models/chatbot/chatbot-message.js';
import { checkScopeGuard } from '../engine/scope-guard.js';
import { classifyError, getErrorFallbackResponse } from '../engine/error-recovery.js';
import { sanitizeNegotiationHistory } from '../engine/history-sanitizer.js';
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { createNegotiationGraph } from "../engine/graph/index.js";

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
  analysis?: any;
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

  logger.info('[ProcessConversationTurn] Starting turn processing via LangGraph', {
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

    // Step 3: Map history to LangGraph message formats
    const historyMessages = conversationHistory.map((msg) => {
      if (msg.role === 'VENDOR') {
        return new HumanMessage({ content: msg.content, id: uuidv4() });
      } else {
        return new AIMessage({ content: msg.content, id: uuidv4() });
      }
    });

    const latestMessage = new HumanMessage({ content: vendorMessage, id: uuidv4() });

    // Resolve negotiation config from deal or template
    let dealConfig = null;
    if (deal.negotiationConfigJson) {
      dealConfig = deal.negotiationConfigJson;
    } else if (template?.configJson) {
      const tc = template.configJson as any;
      dealConfig = {
        priceQuantity: {
          targetUnitPrice: tc.targetPrice,
          maxAcceptablePrice: tc.maxAcceptablePrice || (tc.targetPrice * 1.25),
        },
        paymentTerms: {
          minDays: tc.paymentTermsMinDays || 15,
          maxDays: tc.paymentTerms === "Net 30" ? 30 : tc.paymentTermsMaxDays || 45,
        },
        currency: tc.currency || "USD",
        parameterWeights: tc.weights || { targetUnitPrice: 60, paymentTermsDays: 25, warrantyPeriodMonths: 15 },
      };
    }

    // Step 4: Compile graph and prepare input state
    const graph = await createNegotiationGraph();
    
    // Map database JSON to Offer format
    const dbCounter = deal.latestOfferJson as any;
    const dbVendor = deal.latestVendorOffer as any;
    
    const counterOffer = dbCounter ? {
      totalPrice: dbCounter.totalPrice ?? dbCounter.total_price ?? null,
      paymentTerms: dbCounter.paymentTerms ?? dbCounter.payment_terms ?? null,
      paymentTermsDays: dbCounter.paymentTermsDays ?? dbCounter.payment_terms_days ?? null,
      deliveryDays: dbCounter.deliveryDays ?? dbCounter.delivery_days ?? null,
      warrantyMonths: dbCounter.warrantyMonths ?? dbCounter.warranty_months ?? null,
    } : null;

    const parsedOffer = dbVendor ? {
      totalPrice: dbVendor.totalPrice ?? dbVendor.total_price ?? null,
      paymentTerms: dbVendor.paymentTerms ?? dbVendor.payment_terms ?? null,
      paymentTermsDays: dbVendor.paymentTermsDays ?? dbVendor.payment_terms_days ?? null,
      deliveryDays: dbVendor.deliveryDays ?? dbVendor.delivery_days ?? null,
      warrantyMonths: dbVendor.warrantyMonths ?? dbVendor.warranty_months ?? null,
    } : null;

    const initialState = {
      messages: [...historyMessages, latestMessage],
      dealId,
      round: deal.round,
      config: dealConfig,
      counterOffer,
      parsedOffer,
      metadata: {
        convoState,
        userId,
        mode: "CONVERSATION",
        dealStatus: deal.status,
      }
    };

    // Step 5: Invoke the graph
    const config = { configurable: { thread_id: dealId } };
    const finalState = await graph.invoke(initialState, config);

    // Step 6: Extract results
    const accordoMessage = finalState.metadata?.accordoMessage || "";
    const accordoIntent = finalState.metadata?.accordoIntent as ConvoIntent;
    const updatedState = finalState.metadata?.convoState as ConvoState;
    const vendorIntent = finalState.metadata?.vendorIntent as VendorIntent;
    const refusalType = finalState.metadata?.refusalType as RefusalType;
    const analysis = finalState.analysis;

    // Step 7: Save updated state to database
    await saveDealState(deal, updatedState, analysis, finalState);

    logger.info('[ProcessConversationTurn] Turn processing complete via LangGraph', {
      dealId,
      stateSummary: getStateSummary(updatedState),
    });

    return {
      accordoMessage,
      accordoIntent,
      updatedState,
      vendorIntent,
      refusalType,
      analysis,
    };
  } catch (error) {
    // Error Recovery: return human-readable fallback instead of crashing
    const errorCategory = classifyError(error);
    logger.error('[ProcessConversationTurn] Turn processing failed — using error recovery', {
      dealId,
      errorCategory,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
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
export { prepareTemplateVariables } from "./template-variables.js";

/**
 * Save updated conversation state to deal
 */
async function saveDealState(
  deal: ChatbotDeal,
  convoState: ConvoState,
  analysis: any,
  finalState: any
): Promise<void> {
  console.log("DEBUG: finalState.counterOffer =", JSON.stringify(finalState.counterOffer, null, 2));
  console.log("DEBUG: finalState.mesoOptions =", JSON.stringify(finalState.mesoOptions, null, 2));

  const updatedConvoState = {
    ...convoState,
    latestAnalysis: analysis || convoState.latestAnalysis,
  };

  const costOfCapital = deal.costOfCapital || 0.10;
  
  // Calculate NPV for current counter-offer if available
  let latestNpv = null;
  const counter = finalState.counterOffer;
  if (counter && counter.totalPrice != null) {
    const paymentDays = counter.paymentTermsDays ?? 30;
    latestNpv = counter.totalPrice * (1 - (costOfCapital / 365) * paymentDays);
  }

  // Append to effectiveCostTrajectory trajectory
  let trajectory = Array.isArray(deal.effectiveCostTrajectory) ? [...deal.effectiveCostTrajectory] : [];
  if (latestNpv != null) {
    trajectory.push({
      round: finalState.round || deal.round || 1,
      totalPrice: counter.totalPrice,
      paymentTermsDays: counter.paymentTermsDays || 30,
      npv: Math.round(latestNpv * 100) / 100,
      timestamp: new Date().toISOString(),
    });
  }

  // Learn vendor term preference
  let termPref = deal.vendorTermPref;
  const vendor = finalState.parsedOffer;
  if (vendor && vendor.paymentTermsDays != null) {
    if (vendor.paymentTermsDays <= 15) {
      termPref = "NEEDS_FAST_CASH";
    } else if (vendor.paymentTermsDays >= 45) {
      termPref = "COMFORTABLE_WAITING";
    }
  }

  await deal.update({
    convoStateJson: updatedConvoState as any,
    round: finalState.round || deal.round,
    latestOfferJson: finalState.counterOffer || deal.latestOfferJson,
    latestVendorOffer: finalState.parsedOffer || deal.latestVendorOffer,
    latestDecisionAction: finalState.decision?.action || deal.latestDecisionAction,
    latestUtility: finalState.decision?.utilityScore || deal.latestUtility,
    mesoOptionsSent: finalState.mesoOptions || deal.mesoOptionsSent,
    vendorTermPref: termPref,
    effectiveCostTrajectory: trajectory as any,
    status: finalState.metadata?.dealStatus || deal.status,
    lastMessageAt: new Date(),
  });

  logger.info('[ProcessConversationTurn] State saved to database', {
    dealId: deal.id,
    phase: convoState.phase,
    turnCount: convoState.turnCount,
    round: finalState.round,
    dealStatus: finalState.metadata?.dealStatus,
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
