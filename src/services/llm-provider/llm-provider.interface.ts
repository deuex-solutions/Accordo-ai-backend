/**
 * Abstract base class for LLM chat-completion providers.
 *
 * Mirrors the embedding-provider pattern. Concrete implementations:
 * - OllamaProvider (local dev, http://localhost:11434)
 * - OpenAIProvider (current production, wraps existing openai.service.ts)
 * - BedrockProvider (Phase B target, currently a stub)
 */

import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderConfig,
  LlmProviderHealth,
  LlmProviderName,
} from "./types.js";

export abstract class LlmProvider {
  abstract readonly providerName: LlmProviderName;

  protected config: LlmProviderConfig;

  constructor(config: LlmProviderConfig) {
    this.config = config;
  }

  /** Initialize the provider (verify credentials, daemon reachability, etc.) */
  abstract initialize(): Promise<void>;

  /** Generate a chat completion. Implementations handle their own retry/backoff. */
  abstract generateCompletion(
    messages: ChatMessage[],
    options?: ChatCompletionOptions,
  ): Promise<ChatCompletionResponse>;

  /** Quick health probe — used by /api/health and the factory's selection guard. */
  abstract checkHealth(): Promise<LlmProviderHealth>;
}
