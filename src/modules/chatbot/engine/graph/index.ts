import { offerParsingNode } from "./nodes/offer-parser.js";
import { 
  toneAnalysisNode, 
  behavioralAnalysisNode, 
  concernExtractionNode, 
  mergeAnalysisNode 
} from "./nodes/intelligence-node.js";
import { ragContextNode } from "./nodes/rag-context.js";

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
    .addNode(NodeName.TONE_ANALYSIS, toneAnalysisNode)
    .addNode(NodeName.BEHAVIORAL_ANALYSIS, behavioralAnalysisNode)
    .addNode(NodeName.CONCERN_EXTRACTION, concernExtractionNode)
    .addNode(NodeName.RAG_CONTEXT, ragContextNode)
    .addNode(NodeName.MERGE_ANALYSIS, mergeAnalysisNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
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
    .addEdge(NodeName.MERGE_ANALYSIS, NodeName.DECIDE_STRATEGY)
    .addEdge(NodeName.DECIDE_STRATEGY, "state_management")
    .addEdge("state_management", NodeName.GENERATE_OFFERS)
    .addEdge(NodeName.GENERATE_OFFERS, NodeName.FINALIZE_RESPONSE)
    .addEdge(NodeName.FINALIZE_RESPONSE, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
  });
}
