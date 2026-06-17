import { NegotiationState } from "../state.js";
import { checkScopeGuard } from "../../scope-guard.js";
import { AIMessage } from "@langchain/core/messages";

/**
 * ScopeGuardAgent (Track 2: Yug) - Phase 4.2
 * 
 * @source src/modules/chatbot/engine/scope-guard.ts
 * 
 * Synergy Mandate:
 * - Implements content filtering for off-topic requests before heavy processing
 * - Returns automated corrections/redirections when vendors go off-topic
 */
export const scopeGuardNode = async (state: NegotiationState) => {
  if (!state.messages || state.messages.length === 0) return {};
  
  // We only evaluate the latest vendor (human) message
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage._getType() !== "human") {
    return {};
  }

  const messageContent = typeof lastMessage.content === "string" 
    ? lastMessage.content 
    : JSON.stringify(lastMessage.content);
  
  // Use deal ID or generic fallback if product name isn't explicitly mapped
  const productName = state.config?.dealTitle || undefined;
  
  const result = checkScopeGuard(messageContent, productName);

  if (result.isOffTopic && result.response) {
    return {
      // Inject the canned redirection message immediately
      messages: [new AIMessage(result.response)],
      // Flag the decision to halt the rest of the LangGraph execution path
      decision: {
        action: "OFF_TOPIC",
        reasoning: `Message flagged as off-topic category: ${result.category}`,
        confidence: result.confidence
      },
      metadata: { ...state.metadata, scopeGuardFailed: true }
    };
  }

  return {
    metadata: { ...state.metadata, scopeGuardPassed: true }
  };
};
