import { offerParsingNode } from "./nodes/offer-parser.js";
import { analyzeSentimentNode } from "./nodes/sentiment-analyzer.js";

import { StateGraph } from "@langchain/langgraph";
import { NegotiationState, NegotiationStateAnnotation } from "./state.js";
import { NodeName } from "./types.js";
import { getCheckpointer } from "./checkpointer.js";
import { stateManagementNode } from "./nodes/state-management.js";

/**
 * MOCK NODES FOR TRACK INITIALIZATION
 * These should be replaced by actual implementations from each track.
 */

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
    // Define Edges (The Flow)
    .addEdge("__start__", NodeName.PARSE_INPUT)
    .addEdge(NodeName.PARSE_INPUT, NodeName.ANALYZE_SENTIMENT)
    .addEdge(NodeName.ANALYZE_SENTIMENT, NodeName.DECIDE_STRATEGY)
    .addEdge(NodeName.DECIDE_STRATEGY, "state_management")
    .addEdge("state_management", NodeName.GENERATE_OFFERS)
    .addEdge(NodeName.GENERATE_OFFERS, NodeName.FINALIZE_RESPONSE)
    .addEdge(NodeName.FINALIZE_RESPONSE, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    // Add interrupt_before: [NodeName.HUMAN_INTERVENTION] later
  });
}
