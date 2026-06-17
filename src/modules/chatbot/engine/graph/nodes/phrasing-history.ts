import { NegotiationState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import { hasRecentOpener, rewriteOpener, recordPhrasing } from "../../../../../llm/phrasing-history.js";
import logger from "../../../../../config/logger.js";

/**
 * PhrasingHistoryNode (Track 2: Yug) - Phase 7.1
 * 
 * Responsibilities:
 * - Checks if the generated response message opener repeats recent openings.
 * - Rewrites opener variations if a repetition is detected.
 * - Records final phrasing fingerprint to prevent future duplicates.
 */
export const phrasingHistoryNode = async (state: NegotiationState) => {
  logger.info(`[Node: phrasing_history] Running phrasing history node...`);

  const dealId = state.dealId;
  if (!dealId) {
    logger.warn(`[Node: phrasing_history] Missing dealId in state. Skipping.`);
    return {};
  }

  const messages = state.messages || [];
  if (messages.length === 0) {
    logger.info(`[Node: phrasing_history] No messages in state. Skipping.`);
    return {};
  }

  // Retrieve the latest generated message (should be an AIMessage)
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage._getType() !== "ai") {
    logger.info(`[Node: phrasing_history] Last message is not an AI message. Skipping phrasing check.`);
    return {};
  }

  const text = typeof lastMessage.content === "string" ? lastMessage.content : "";
  if (!text) {
    logger.info(`[Node: phrasing_history] Last AI message has no string content. Skipping phrasing check.`);
    return {};
  }

  const action = state.decision?.action || "COUNTER";

  try {
    let finalResponse = text;
    if (hasRecentOpener(dealId, action, text)) {
      logger.info(`[Node: phrasing_history] Duplicate opener detected for deal ${dealId}. Rewriting...`);
      finalResponse = rewriteOpener(dealId, action, text);
      logger.info(`[Node: phrasing_history] Rewrote response to: "${finalResponse.substring(0, 50)}..."`);
    } else {
      logger.info(`[Node: phrasing_history] Opener is unique. Recording phrasing fingerprint.`);
    }

    // Record the final chosen phrasing
    recordPhrasing(dealId, action, finalResponse);

    // Overwrite the last message with the final response text by matching its ID
    return {
      messages: [
        new AIMessage({
          content: finalResponse,
          id: lastMessage.id,
        })
      ]
    };
  } catch (err) {
    logger.error(`[Node: phrasing_history] Failed to execute phrasing history node`, err);
    return {};
  }
};
