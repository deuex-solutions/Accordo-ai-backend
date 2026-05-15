/**
 * Public surface of the LLM provider abstraction.
 *
 * Call sites should import from here and never reach into the concrete
 * provider files. The single function `generateChatCompletion` routes
 * to whichever provider LLM_PROVIDER selects.
 *
 * Example:
 *   import { generateChatCompletion } from "../../services/llm-provider/index.js";
 *   const { content } = await generateChatCompletion(messages, { temperature: 0.7 });
 */

import logger from "../../config/logger.js";
import { getLlmProvider } from "./provider.factory.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderHealth,
} from "./types.js";

export type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderHealth,
  LlmProviderName,
  TokenUsage,
} from "./types.js";

export {
  getLlmProvider,
  getActiveProviderName,
  _resetLlmProviderForTests,
} from "./provider.factory.js";

/**
 * Generate a chat completion through the configured provider.
 * Single entry point for every CONVERSATION-mode / summarization LLM call.
 */
export async function generateChatCompletion(
  messages: ChatMessage[],
  options: ChatCompletionOptions = {},
): Promise<ChatCompletionResponse> {
  const provider = await getLlmProvider();
  try {
    return await provider.generateCompletion(messages, options);
  } catch (error) {
    logger.error(
      {
        provider: provider.providerName,
        messageCount: messages.length,
        error: error instanceof Error ? error.message : String(error),
      },
      "[llm-provider] generateChatCompletion failed",
    );
    throw error;
  }
}

/** Health probe for the active provider. */
export async function checkLlmHealth(): Promise<LlmProviderHealth> {
  const provider = await getLlmProvider();
  return provider.checkHealth();
}
