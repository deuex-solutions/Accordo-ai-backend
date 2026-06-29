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

    return {
      decision: {
        action: nextIntent,
        reasoning: `Vendor intent: ${vendorIntent}${refusalType ? ` (${refusalType})` : ""}`,
        confidence: 1.0,
      },
      metadata: {
        ...state.metadata,
        vendorIntent,
        refusalType: refusalType || undefined,
        accordoIntent: nextIntent,
      }
    };
  }

  return baseDecideStrategyNode(state);
};

// TRACK 3: ADARSH (Strategy/MESO)
const generateOffersNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";

  if (isConvo) {
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

    // Prepare variables
    const templateVariables = await prepareTemplateVariables(
      deal,
      deal.Template || null,
      convoState,
      accordoIntent,
      vendorMessage
    );

    // Generate reply message
    const accordoMessage = generateConversationMessage(
      dealId,
      deal.round,
      accordoIntent,
      templateVariables
    );

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
 * GRAPH DEFINITION
 * This is the common "skeleton" that all three tracks will build upon.
 */
export async function createNegotiationGraph() {
  const checkpointer = await getCheckpointer();

  const workflow = new StateGraph(NegotiationStateAnnotation)
    // Add Nodes
    .addNode(NodeName.PARSE_INPUT, offerParsingNode)
    .addNode(NodeName.TONE_ANALYSIS, toneAnalysisNode)
    .addNode(NodeName.BEHAVIORAL_ANALYSIS, behavioralAnalysisNode)
    .addNode(NodeName.CONCERN_EXTRACTION, concernExtractionNode)
    .addNode(NodeName.RAG_CONTEXT, ragContextNode)
    .addNode(NodeName.MERGE_ANALYSIS, mergeAnalysisNode)
    .addNode(NodeName.WEIGHTED_UTILITY, weightedUtilityNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.HUMAN_INTERVENTION, humanInterventionNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
    .addNode(NodeName.EMAIL_NOTIFICATION, emailNotificationNode)
    .addNode(NodeName.DOCUMENT_GENERATION, documentGenerationNode)
    .addNode(NodeName.BID_COMPARISON, bidComparisonNode)
    .addNode(NodeName.PHRASING_HISTORY, phrasingHistoryNode)
    // Define Edges (The Flow)
    .addEdge("__start__", NodeName.PARSE_INPUT)
    // Parallel fan-out
    .addEdge(NodeName.PARSE_INPUT, NodeName.TONE_ANALYSIS)
    .addEdge(NodeName.PARSE_INPUT, NodeName.BEHAVIORAL_ANALYSIS)
    .addEdge(NodeName.PARSE_INPUT, NodeName.CONCERN_EXTRACTION)
    .addEdge(NodeName.PARSE_INPUT, NodeName.RAG_CONTEXT)
    // Fan-in / Merge
    .addEdge(NodeName.TONE_ANALYSIS, NodeName.MERGE_ANALYSIS)
    .addEdge(NodeName.BEHAVIORAL_ANALYSIS, NodeName.MERGE_ANALYSIS)
    .addEdge(NodeName.CONCERN_EXTRACTION, NodeName.MERGE_ANALYSIS)
    .addEdge(NodeName.RAG_CONTEXT, NodeName.MERGE_ANALYSIS)
    // Sequential continuation
    .addEdge(NodeName.MERGE_ANALYSIS, NodeName.WEIGHTED_UTILITY)
    .addEdge(NodeName.WEIGHTED_UTILITY, NodeName.DECIDE_STRATEGY)
    .addEdge(NodeName.DECIDE_STRATEGY, "state_management")
    .addEdge("state_management", NodeName.GENERATE_OFFERS)
    // Conditional routing
    .addConditionalEdges(
      NodeName.GENERATE_OFFERS,
      routeAfterOffers,
      {
        [NodeName.HUMAN_INTERVENTION]: NodeName.HUMAN_INTERVENTION,
        [NodeName.FINALIZE_RESPONSE]: NodeName.FINALIZE_RESPONSE,
      }
    )
    .addEdge(NodeName.HUMAN_INTERVENTION, NodeName.FINALIZE_RESPONSE)
    .addEdge(NodeName.FINALIZE_RESPONSE, NodeName.PHRASING_HISTORY)
    .addEdge(NodeName.PHRASING_HISTORY, NodeName.BID_COMPARISON)
    .addEdge(NodeName.BID_COMPARISON, NodeName.EMAIL_NOTIFICATION)
    .addEdge(NodeName.EMAIL_NOTIFICATION, NodeName.DOCUMENT_GENERATION)
    .addEdge(NodeName.DOCUMENT_GENERATION, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    interruptBefore: [NodeName.HUMAN_INTERVENTION],
  });
}
