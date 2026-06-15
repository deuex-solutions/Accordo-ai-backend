import { offerParsingNode } from "./nodes/offer-parser.js";
import { emailNotificationNode } from "./nodes/email-notification.js";
import { documentGenerationNode } from "./nodes/document-generation.js";

import { StateGraph } from "@langchain/langgraph";
import { NegotiationState, NegotiationStateAnnotation } from "./state.js";
import { NodeName } from "./types.js";
import { getCheckpointer } from "./checkpointer.js";
import { stateManagementNode } from "./nodes/state-management.js";

/**
 * MOCK NODES FOR TRACK INITIALIZATION
 * These should be replaced by actual implementations from each track.
 */



// TRACK 2: YUG (Intelligence)
const analyzeSentimentNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.ANALYZE_SENTIMENT}] Analyzing tone and behavior...`);
  return { analysis: { sentiment: "NEUTRAL" as const } };
};

// TRACK 1: VATSAL (Core Logic)
const decideStrategyNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.DECIDE_STRATEGY}] Determining next move...`);
  return { decision: { action: "COUNTER" as const, reasoning: "Mock reasoning", confidence: 0.9 } };
};

// TRACK 3: ADARSH (Strategy/MESO)
const generateOffersNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.GENERATE_OFFERS}] Generating counter-offers...`);
  return { counterOffer: { price: 1000, terms: "Net 30" } };
};

// FINAL RESPONSE
const finalizeResponseNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.FINALIZE_RESPONSE}] Preparing final message...`);
  return { metadata: { lastUpdated: new Date().toISOString() } };
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
    .addNode(NodeName.ANALYZE_SENTIMENT, analyzeSentimentNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
    .addNode(NodeName.EMAIL_NOTIFICATION, emailNotificationNode)
    .addNode(NodeName.DOCUMENT_GENERATION, documentGenerationNode)
    // Define Edges (The Flow)
    .addEdge("__start__", NodeName.PARSE_INPUT)
    .addEdge(NodeName.PARSE_INPUT, NodeName.ANALYZE_SENTIMENT)
    .addEdge(NodeName.ANALYZE_SENTIMENT, NodeName.DECIDE_STRATEGY)
    .addEdge(NodeName.DECIDE_STRATEGY, "state_management")
    .addEdge("state_management", NodeName.GENERATE_OFFERS)
    .addEdge(NodeName.GENERATE_OFFERS, NodeName.FINALIZE_RESPONSE)
    .addEdge(NodeName.FINALIZE_RESPONSE, NodeName.EMAIL_NOTIFICATION)
    .addEdge(NodeName.EMAIL_NOTIFICATION, NodeName.DOCUMENT_GENERATION)
    .addEdge(NodeName.DOCUMENT_GENERATION, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    // Add interrupt_before: [NodeName.HUMAN_INTERVENTION] later
  });
}
