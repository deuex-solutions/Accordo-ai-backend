import { offerParsingNode } from "./nodes/offer-parser.js";
import { weightedUtilityNode } from "./nodes/weighted-utility.js";
import { humanInterventionNode } from "./nodes/human-intervention.js";

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
  return { 
    decision: { 
      action: "COUNTER" as const, 
      reasoning: "Mock reasoning", 
      confidence: 0.9,
      utilityScore: state.decision?.utilityScore,
    } 
  };
};

// TRACK 3: ADARSH (Strategy/MESO)
const generateOffersNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.GENERATE_OFFERS}] Generating counter-offers...`);
  return { counterOffer: { totalPrice: 1000 } };
};

// FINAL RESPONSE
const finalizeResponseNode = async (state: NegotiationState) => {
  console.log(`[Node: ${NodeName.FINALIZE_RESPONSE}] Preparing final message...`);
  return { metadata: { lastUpdated: new Date().toISOString() } };
};

/**
 * Routing logic for human-in-the-loop validation
 */
const routeAfterOffers = (state: NegotiationState) => {
  // Check if deal is high-value (> ₹10L / 1,000,000)
  const dealPrice = Math.max(
    state.counterOffer?.totalPrice || 0,
    state.parsedOffer?.totalPrice || 0,
    state.config?.priceQuantity?.maxAcceptablePrice || 0
  );

  const isHighValue = dealPrice >= 1000000;
  const isApproved = state.metadata?.approvedByHuman === true;

  if (isHighValue && !isApproved) {
    console.log(`[Router] High-value deal (${dealPrice}) requires human approval. Pausing.`);
    return NodeName.HUMAN_INTERVENTION;
  }

  return NodeName.FINALIZE_RESPONSE;
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
    .addNode(NodeName.WEIGHTED_UTILITY, weightedUtilityNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.HUMAN_INTERVENTION, humanInterventionNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
    // Define Edges (The Flow)
    .addEdge("__start__", NodeName.PARSE_INPUT)
    .addEdge(NodeName.PARSE_INPUT, NodeName.ANALYZE_SENTIMENT)
    .addEdge(NodeName.ANALYZE_SENTIMENT, NodeName.WEIGHTED_UTILITY)
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
    .addEdge(NodeName.FINALIZE_RESPONSE, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    interruptBefore: [NodeName.HUMAN_INTERVENTION],
  });
}
