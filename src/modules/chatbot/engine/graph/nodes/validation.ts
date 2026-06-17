import { NegotiationState } from "../state.js";
import { validateLlmOutput } from "../../../../../llm/validate-llm-output.js";
import { AIMessage } from "@langchain/core/messages";

/**
 * ValidationAgent (Track 2: Yug) - Phase 4.1
 * 
 * @source src/llm/validate-llm-output.ts
 * 
 * Synergy Mandate:
 * - Enforce strict two-tier bans (e.g. utility, algorithm).
 * - Enforce price formatting and length bounds.
 * - Strip AI tells and robotic filler.
 */
export const validationNode = async (state: NegotiationState) => {
  if (!state.messages || state.messages.length === 0) return {};
  
  // Grab the latest message, expecting it to be an AI message
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage._getType() !== "ai") {
    return {};
  }

  const responseText = typeof lastMessage.content === "string" 
    ? lastMessage.content 
    : JSON.stringify(lastMessage.content);

  // Reconstruct minimal intent for the validator
  const intent: any = {
    action: state.decision?.action || "COUNTER",
    currencySymbol: state.config?.currency === "INR" ? "₹" : "$"
  };

  if (intent.action === "COUNTER" || intent.action === "ACCEPT") {
    intent.allowedPrice = state.counterOffer?.totalPrice || state.parsedOffer?.totalPrice || undefined;
  } else if (intent.action === "MESO") {
    intent.offerVariants = (state.mesoOptions || []).map((o: any) => ({ price: o.totalPrice }));
  }

  if (state.analysis?.concerns) {
    intent.acknowledgeConcerns = state.analysis.concerns.map(c => c.description);
  }

  try {
    const sanitizedText = validateLlmOutput(responseText, intent);

    // If validation passed but text was sanitized/normalized, update the message
    if (sanitizedText !== responseText) {
      if (lastMessage.id) {
        return {
          messages: [new AIMessage({ content: sanitizedText, id: lastMessage.id })],
          metadata: { ...state.metadata, validationStatus: "PASSED_SANITIZED" }
        };
      } else {
        // Fallback if no ID is present, though LangGraph usually assigns one
        return {
           metadata: { ...state.metadata, validationStatus: "PASSED_SANITIZED" }
        };
      }
    }

    return {
      metadata: { ...state.metadata, validationStatus: "PASSED" }
    };
  } catch (err: any) {
    if (err.name === "ValidationError") {
      // The Graph will catch this state flag and loop back to ResponseGeneration or Fallback
      return {
        metadata: {
          ...state.metadata,
          validationFailed: true,
          validationError: err.reason
        }
      };
    }
    throw err;
  }
};
