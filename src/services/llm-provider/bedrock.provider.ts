/**
 * AWS Bedrock LLM provider — Phase B stub.
 *
 * Real implementation lands when staging migrates to Llama 3.3 70B on
 * Bedrock managed inference. Until then this throws a clear error so a
 * misconfigured LLM_PROVIDER=bedrock fails loudly at startup instead of
 * silently degrading to fallback templates at request time.
 */

import logger from "../../config/logger.js";
import { LlmProvider } from "./llm-provider.interface.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderHealth,
  LlmProviderName,
} from "./types.js";

export class BedrockProvider extends LlmProvider {
  readonly providerName: LlmProviderName = "bedrock";

  async initialize(): Promise<void> {
    logger.warn(
      { provider: this.providerName, model: this.config.model },
      "[llm-provider] Bedrock provider selected but not yet implemented (Phase B)",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async generateCompletion(
    _messages: ChatMessage[],
    _options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResponse> {
    throw new Error(
      "Bedrock LLM provider is not implemented yet (Phase B). " +
        "Set LLM_PROVIDER=openai or LLM_PROVIDER=ollama.",
    );
  }

  async checkHealth(): Promise<LlmProviderHealth> {
    return {
      available: false,
      provider: this.providerName,
      model: this.config.model,
      error: "Bedrock provider not implemented (Phase B)",
    };
  }
}
