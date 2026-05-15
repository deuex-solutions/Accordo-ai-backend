/**
 * Shared types for the LLM provider abstraction layer.
 *
 * Mirrors the embedding-provider pattern in src/modules/vector/providers/.
 * One swap point (LLM_PROVIDER env var) routes every generation call to
 * the configured backend: ollama (local) / openai / bedrock.
 */

export type LlmProviderName = "openai" | "ollama" | "bedrock";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Override the configured model for a single call (e.g. negotiation-specific model) */
  modelOverride?: string;
  /** Retry attempts for transient failures */
  retries?: number;
  /** Per-call timeout in ms; falls back to provider default */
  timeoutMs?: number;
  /** Tracking metadata persisted to ApiUsageLog when available */
  dealId?: string;
  userId?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResponse {
  content: string;
  usage: TokenUsage;
  /** Actual model identifier returned by the provider (e.g. "gpt-3.5-turbo-0125", "llama3.1:8b") */
  model: string;
  /** Which provider produced this response */
  provider: LlmProviderName;
  /** True if the primary provider failed and a fallback served the request */
  fallbackUsed: boolean;
}

export interface LlmProviderHealth {
  available: boolean;
  provider: LlmProviderName;
  model: string;
  error?: string;
}

export interface LlmProviderConfig {
  model: string;
  timeoutMs: number;
  maxRetries: number;
}
