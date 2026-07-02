import { offerParsingNode } from "./nodes/offer-parser.js";
import { 
  toneAnalysisNode, 
  behavioralAnalysisNode, 
  concernExtractionNode, 
  mergeAnalysisNode 
} from "./nodes/intelligence-node.js";
import { ragContextNode } from "./nodes/rag-context.js";
import { decideStrategyNode as baseDecideStrategyNode } from "./nodes/decide-strategy.js";
import { generateOffersNode as baseGenerateOffersNode } from "./nodes/generate-offers.js";
import { weightedUtilityNode } from "./nodes/weighted-utility.js";
import { humanInterventionNode } from "./nodes/human-intervention.js";
import { emailNotificationNode } from "./nodes/email-notification.js";
import { documentGenerationNode } from "./nodes/document-generation.js";
import { bidComparisonNode } from "./nodes/bid-comparison.js";
import { phrasingHistoryNode } from "./nodes/phrasing-history.js";
import { vendorIntentAgent } from "./nodes/vendor-intent-agent.js";
import { negotiationManagerAgent } from "./nodes/negotiation-manager-agent.js";
import { responseComposerAgent } from "./nodes/response-composer-agent.js";
import { riskGuardAgent } from "./nodes/risk-guard.js";

import { StateGraph } from "@langchain/langgraph";
import { NegotiationState, NegotiationStateAnnotation } from "./state.js";
import { NodeName } from "./types.js";
import { getCheckpointer } from "./checkpointer.js";
import { stateManagementNode } from "./nodes/state-management.js";

import { AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { ChatbotDeal } from "../../../../models/chatbot/chatbot-deal.js";
import { ChatbotTemplate } from "../../../../models/chatbot/chatbot-template.js";
import { generateConversationMessage } from "../../convo/conversation-templates.js";
import {
  classifyVendorIntent,
  classifyRefusal,
  handleRefusal,
  handleSmallTalk,
  determineNextIntent,
  type RefusalType,
  type ConvoState,
} from "../../convo/enhanced-convo-router.js";
import { prepareTemplateVariables } from "../../convo/process-conversation-turn.js";
import logger from "../../../../config/logger.js";
import { renderNegotiationMessage } from "../../../../llm/persona-renderer.js";
import { validateLlmOutput } from "../../../../llm/validate-llm-output.js";
import { buildNegotiationIntent } from "../build-negotiation-intent.js";

/**
 * Routing logic for human-in-the-loop validation
 */
const routeAfterOffers = (state: NegotiationState) => {
  const currency = state.config?.currency || state.parsedOffer?.currency || "USD";
  
  // High-value threshold: Above 100 CR in INR (100 * 10,000,000) or Above 1 Billion in other currencies
  const HIGH_VALUE_THRESHOLD = 1000000000; // 1,000,000,000 (1B / 100 Cr)

  const dealPrice = Math.max(
    state.counterOffer?.totalPrice || 0,
    state.parsedOffer?.totalPrice || 0,
    state.config?.priceQuantity?.maxAcceptablePrice || 0
  );

  const isHighValue = dealPrice >= HIGH_VALUE_THRESHOLD;
  const isApproved = state.metadata?.approvedByHuman === true;

  if (isHighValue && !isApproved) {
    const unitDisplay = currency === "INR"
      ? `${(dealPrice / 10000000).toFixed(2)} Cr`
      : `${(dealPrice / 1000000000).toFixed(2)}B`;

    console.log(`[Router] High-value deal (${currency} ${dealPrice.toLocaleString()} / ~${unitDisplay}) requires human approval. Pausing.`);
    return NodeName.HUMAN_INTERVENTION;
  }

  return NodeName.FINALIZE_RESPONSE;
};

// TRACK 1: VATSAL (Core Logic)
const decideStrategyNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";

  if (isConvo) {
    const convoState = state.metadata.convoState as ConvoState;
    const dealId = state.dealId;

    // Get latest message content
    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    const vendorMessage = typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Get conversation history for context
    const conversationHistory = messages.slice(0, -1).map((msg) => ({
      role: msg._getType() === "human" ? "VENDOR" : "ACCORDO",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));

    // Classify vendor intent
    const vendorIntent = await classifyVendorIntent(vendorMessage, conversationHistory);

    let refusalType: RefusalType | undefined;
    let nextIntent: any;

    if (vendorIntent === "REFUSAL") {
      refusalType = await classifyRefusal(vendorMessage);
      nextIntent = handleRefusal(convoState, refusalType);
    } else if (vendorIntent === "SMALL_TALK") {
      nextIntent = handleSmallTalk(convoState);
    } else {
      nextIntent = determineNextIntent(convoState, vendorIntent, vendorMessage);
    }

    let decision = {
      action: nextIntent,
      reasoning: `Vendor intent: ${vendorIntent}${refusalType ? ` (${refusalType})` : ""}`,
      confidence: 1.0,
      utilityScore: 0.5,
    } as any;

    const isTesting = !!process.env.VITEST;

    if (!isTesting && (nextIntent === "COUNTER" || nextIntent === "ACCEPT" || nextIntent === "WALK_AWAY" || nextIntent === "ESCALATE")) {
      try {
        const baseResult = await baseDecideStrategyNode(state);
        if (baseResult?.decision) {
          decision = {
            ...decision,
            ...baseResult.decision,
            action: nextIntent === "COUNTER" ? baseResult.decision.action : nextIntent,
          };
        }
      } catch (err) {
        logger.error("[Node: decideStrategyNode] Utility decision failed in CONVERSATION mode", err);
      }
    }

    return {
      decision,
      metadata: {
        ...state.metadata,
        vendorIntent,
        refusalType: refusalType || undefined,
        accordoIntent: decision.action,
      }
    };
  }

  return baseDecideStrategyNode(state);
};

// TRACK 3: ADARSH (Strategy/MESO)
const generateOffersNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";

  if (isConvo) {
    const isTesting = !!process.env.VITEST;
    if (!isTesting && state.decision?.action === "COUNTER") {
      return baseGenerateOffersNode(state);
    }
    return {};
  }

  return baseGenerateOffersNode(state);
};

// FINAL RESPONSE
const finalizeResponseNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";

  if (isConvo) {
    const dealId = state.dealId;
    const accordoIntent = state.metadata.accordoIntent;
    const convoState = state.metadata.convoState;

    const messages = state.messages;
    const lastMessage = messages[messages.length - 1];
    const vendorMessage = typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);

    // Load deal and template
    const deal = await ChatbotDeal.findByPk(dealId, {
      include: [{ model: ChatbotTemplate, as: "Template" }],
    });
    if (!deal) throw new Error(`Deal not found: ${dealId}`);

    // Prepare fallback variables first to override if needed
    const templateVariables = await prepareTemplateVariables(
      deal,
      deal.Template || null,
      convoState,
      accordoIntent,
      vendorMessage
    );

    // Overwrite static template variables with computed brain offers if countering
    if (accordoIntent === "COUNTER" && state.counterOffer) {
      if (state.counterOffer.totalPrice != null) {
        templateVariables.targetPrice = state.counterOffer.totalPrice;
      }
      if (state.counterOffer.paymentTerms != null) {
        templateVariables.paymentTerms = state.counterOffer.paymentTerms;
      }
    }

    // Map LangGraph state to buildNegotiationIntent inputs
    const tone = state.analysis?.tone?.urgency && state.analysis.tone.urgency > 0.7 
      ? "urgent" 
      : state.analysis?.tone?.sentiment === "NEGATIVE" 
      ? "firm" 
      : "friendly";
    
    const concerns = (state.analysis?.concerns || []).map(c => c.description);

    const mesoOffers = (state.mesoOptions || []).map((o, idx) => ({
      label: o.customParameters?.label || `Option ${String.fromCharCode(65 + idx)}`,
      price: o.totalPrice || 0,
      paymentTerms: o.paymentTerms || "Net 30",
      description: o.customParameters?.description || "",
    }));

    const negotiationIntent = buildNegotiationIntent({
      action: accordoIntent as any,
      utilityScore: state.decision?.utilityScore ?? 0.5,
      counterPrice: state.counterOffer?.totalPrice,
      counterPaymentTerms: state.counterOffer?.paymentTerms,
      concerns,
      tone: tone as any,
      mesoOffers: mesoOffers.length > 0 ? mesoOffers : undefined,
      targetPrice: state.config?.wizardConfig?.priceQuantity?.targetUnitPrice || state.config?.parameters?.total_price?.target,
      maxAcceptablePrice: state.config?.wizardConfig?.priceQuantity?.maxAcceptablePrice || state.config?.parameters?.total_price?.max_acceptable,
      currencyCode: state.config?.currency || "USD",
      roundNumber: state.round,
    });

    const personaContext = {
      dealTitle: deal.title ?? undefined,
      vendorName: (deal as any).Vendor?.name ?? undefined,
      productCategory: (deal as any).Requisition?.title ?? undefined,
    };

    let accordoMessage: string;
    const isTesting = !!process.env.VITEST;

    if (isTesting) {
      // Use template generation directly in Vitest to maintain test parity and avoid live API calls
      accordoMessage = generateConversationMessage(
        dealId,
        deal.round,
        accordoIntent,
        templateVariables
      );
    } else {
      try {
        logger.info("[Node: finalizeResponseNode] Rendering response via LLM persona renderer", { dealId });
        const renderResult = await renderNegotiationMessage(
          negotiationIntent,
          vendorMessage,
          personaContext
        );
        
        accordoMessage = validateLlmOutput(
          renderResult.message,
          negotiationIntent
        );
        logger.info("[Node: finalizeResponseNode] LLM response validated successfully", { dealId });
      } catch (err) {
        logger.warn("[Node: finalizeResponseNode] LLM response failed or validation error, using template fallback", {
          dealId,
          error: err instanceof Error ? err.message : String(err),
        });

        // Generate reply message using templates
        accordoMessage = generateConversationMessage(
          dealId,
          deal.round,
          accordoIntent,
          templateVariables
        );
      }
    }

    return {
      messages: [new AIMessage({ content: accordoMessage, id: uuidv4() })],
      metadata: {
        ...state.metadata,
        accordoMessage,
      }
    };
  }

  console.log(`[Node: ${NodeName.FINALIZE_RESPONSE}] Preparing final message...`);
  return { metadata: { ...state.metadata, lastUpdated: new Date().toISOString() } };
};

/**
 * Routing logic for the intent classification route
 */
const routeAfterIntent = (state: NegotiationState) => {
  const route = state.metadata?.classificationRoute || "FULL_NEGOTIATION_PIPELINE";
  if (route === "SIMPLE_FALLBACK_REPLY") {
    return "response_composer_agent";
  }
  return "negotiation_manager_agent";
};

/**
 * GRAPH DEFINITION
 * This is the common "skeleton" that all three tracks will build upon.
 */
export async function createNegotiationGraph() {
  const checkpointer = await getCheckpointer();

  const workflow = new StateGraph(NegotiationStateAnnotation)
    // Add Nodes
    .addNode("vendor_intent_agent", vendorIntentAgent)
    .addNode("negotiation_manager_agent", negotiationManagerAgent)
    .addNode("response_composer_agent", responseComposerAgent)
    .addNode("risk_guard", riskGuardAgent)
    .addNode(NodeName.EMAIL_NOTIFICATION, emailNotificationNode)
    .addNode(NodeName.DOCUMENT_GENERATION, documentGenerationNode)
    .addNode(NodeName.BID_COMPARISON, bidComparisonNode)
    .addNode(NodeName.PHRASING_HISTORY, phrasingHistoryNode)
    
    // Define Edges (The Flow)
    .addEdge("__start__", "vendor_intent_agent")
    
    // Conditional routing based on classification
    .addConditionalEdges(
      "vendor_intent_agent",
      routeAfterIntent,
      {
        "response_composer_agent": "response_composer_agent",
        "negotiation_manager_agent": "negotiation_manager_agent"
      }
    )
    
    // Negotiation pipeline edges
    .addEdge("negotiation_manager_agent", "response_composer_agent")
    .addEdge("response_composer_agent", "risk_guard")
    
    // Parallel sidecars fan-out from RiskGuard
    .addEdge("risk_guard", NodeName.PHRASING_HISTORY)
    .addEdge("risk_guard", NodeName.BID_COMPARISON)
    .addEdge("risk_guard", NodeName.EMAIL_NOTIFICATION)
    .addEdge("risk_guard", NodeName.DOCUMENT_GENERATION)
    
    .addEdge(NodeName.PHRASING_HISTORY, "__end__")
    .addEdge(NodeName.BID_COMPARISON, "__end__")
    .addEdge(NodeName.EMAIL_NOTIFICATION, "__end__")
    .addEdge(NodeName.DOCUMENT_GENERATION, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    interruptBefore: ["risk_guard"],
  });
}
