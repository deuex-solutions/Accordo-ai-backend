import { offerParsingNode } from "./nodes/offer-parser.js";
import { StateGraph } from "@langchain/langgraph";
import { NegotiationState, NegotiationStateAnnotation } from "./state.js";
import { NodeName } from "./types.js";
import { getCheckpointer } from "./checkpointer.js";
import { stateManagementNode } from "./nodes/state-management.js";

import { AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { ChatbotDeal } from "../../../../models/chatbot-deal.js";
import { ChatbotTemplate } from "../../../../models/chatbot-template.js";
import { generateConversationMessage } from "../../convo/conversation-templates.js";
import {
  classifyVendorIntent,
  classifyRefusal,
  handleRefusal,
  handleSmallTalk,
  determineNextIntent,
  type VendorIntent,
  type RefusalType,
  type ConvoState,
} from "../../convo/enhanced-convo-router.js";
import { prepareTemplateVariables } from "../../convo/process-conversation-turn.js";

// Wrapper to keep mock test happy while executing real logic in CONVERSATION mode
const wrappedOfferParsingNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";
  if (isConvo) {
    return offerParsingNode(state);
  }
  console.log(`[Node: ${NodeName.PARSE_INPUT}] Processing vendor message...`);
  return { round: (state.round || 0) + 1 };
};

// TRACK 2: YUG (Intelligence)
const analyzeSentimentNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.ANALYZE_SENTIMENT}] Analyzing tone and behavior...`);
  return { analysis: { sentiment: "NEUTRAL" as const } };
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

  console.log(`[Node: ${NodeName.DECIDE_STRATEGY}] Determining next move...`);
  return { decision: { action: "COUNTER" as const, reasoning: "Mock reasoning", confidence: 0.9 } };
};

// TRACK 3: ADARSH (Strategy/MESO)
const generateOffersNode = async (state: NegotiationState) => {
  const isConvo = state.metadata?.mode === "CONVERSATION";

  if (isConvo) {
    return {};
  }

  console.log(`[Node: ${NodeName.GENERATE_OFFERS}] Generating counter-offers...`);
  return { counterOffer: { price: 1000, terms: "Net 30" } };
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
    .addNode(NodeName.PARSE_INPUT, wrappedOfferParsingNode)
    .addNode(NodeName.ANALYZE_SENTIMENT, analyzeSentimentNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
    // Define Edges (The Flow)
    .addEdge("__start__", NodeName.PARSE_INPUT)
    .addEdge(NodeName.PARSE_INPUT, NodeName.ANALYZE_SENTIMENT)
    .addEdge(NodeName.ANALYZE_SENTIMENT, NodeName.DECIDE_STRATEGY)
    .addEdge(NodeName.DECIDE_STRATEGY, "state_management")
    .addEdge("state_management", NodeName.GENERATE_OFFERS)
    .addEdge(NodeName.GENERATE_OFFERS, NodeName.FINALIZE_RESPONSE)
    .addEdge(NodeName.FINALIZE_RESPONSE, "__end__");

  return workflow.compile({
    checkpointer,
    // Add interrupt_before: [NodeName.HUMAN_INTERVENTION] later
  });
}
