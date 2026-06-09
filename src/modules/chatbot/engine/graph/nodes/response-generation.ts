import { NegotiationState } from "../state.js";
import { generateHumanLikeResponse, ResponseGeneratorInput } from "../../response-generator.js";
import { AIMessage } from "@langchain/core/messages";
import { Decision } from "../../types.js";

/**
 * ResponseGenerationAgent (Track 2: Yug) - Phase 3.2
 * 
 * @source src/modules/chatbot/engine/response-generator.ts
 * 
 * Synergy Mandate:
 * - State-aware LLM rendering node
 * - PM persona rendering (professional, vendor-friendly)
 * - Template-based fallback logic
 */
export const responseGenerationNode = async (state: NegotiationState) => {
  if (!state.decision || !state.config) {
    return {};
  }

  // Map state messages to expected format
  const conversationHistory = (state.messages || []).map((m: any) => {
    let role = 'SYSTEM';
    if (m._getType() === "human") role = "VENDOR";
    else if (m._getType() === "ai") role = "ACCORDO";
    return { role, content: m.content as string };
  });

  // Map generic NegotiationDecision to legacy Decision type
  const decision: Decision = {
    action: state.decision.action as any,
    reasons: [state.decision.reasoning],
    utilityScore: state.decision.utilityScore || 0,
    counterOffer: state.counterOffer as any || null
  };

  const input: ResponseGeneratorInput = {
    decision,
    config: state.config,
    conversationHistory,
    vendorOffer: state.parsedOffer as any || { total_price: null },
    counterOffer: state.counterOffer as any || null,
    round: state.round,
    maxRounds: state.config.dynamicRounds?.hardMaxRounds || 6
  };

  const result = await generateHumanLikeResponse(input);

  // Return the new generated text as an AIMessage to append to the graph
  return {
    messages: [new AIMessage(result.response)]
  };
};
