import { offerParsingNode } from "./nodes/offer-parser.js";
import { analyzeSentimentNode } from "./nodes/intelligence-node.js";
import { decideStrategyNode } from "./nodes/decide-strategy.js";
import { generateOffersNode } from "./nodes/generate-offers.js";
import { weightedUtilityNode } from "./nodes/weighted-utility.js";
import { humanInterventionNode } from "./nodes/human-intervention.js";
import { emailNotificationNode } from "./nodes/email-notification.js";
import { documentGenerationNode } from "./nodes/document-generation.js";

import { StateGraph } from "@langchain/langgraph";
import { NegotiationState, NegotiationStateAnnotation } from "./state.js";
import { NodeName } from "./types.js";
import { getCheckpointer } from "./checkpointer.js";
import { stateManagementNode } from "./nodes/state-management.js";

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
    .addNode(NodeName.WEIGHTED_UTILITY, weightedUtilityNode)
    .addNode(NodeName.DECIDE_STRATEGY, decideStrategyNode)
    .addNode(NodeName.GENERATE_OFFERS, generateOffersNode)
    .addNode(NodeName.HUMAN_INTERVENTION, humanInterventionNode)
    .addNode(NodeName.FINALIZE_RESPONSE, finalizeResponseNode)
    .addNode("state_management", stateManagementNode)
    .addNode(NodeName.EMAIL_NOTIFICATION, emailNotificationNode)
    .addNode(NodeName.DOCUMENT_GENERATION, documentGenerationNode)
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
    .addEdge(NodeName.FINALIZE_RESPONSE, NodeName.EMAIL_NOTIFICATION)
    .addEdge(NodeName.EMAIL_NOTIFICATION, NodeName.DOCUMENT_GENERATION)
    .addEdge(NodeName.DOCUMENT_GENERATION, "__end__");

  return workflow.compile({
    checkpointer: checkpointer as any,
    interruptBefore: [NodeName.HUMAN_INTERVENTION],
  });
}
