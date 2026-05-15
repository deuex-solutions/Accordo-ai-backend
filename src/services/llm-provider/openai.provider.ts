/**
 * OpenAI LLM provider.
 *
 * Thin adapter over the existing src/services/openai.service.ts so we don't
 * duplicate token-counting / usage-logging / retry logic. The legacy service
 * keeps working unchanged; this just exposes it through the provider contract.
 */

import env from "../../config/env.js";
import logger from "../../config/logger.js";
import {
  generateCompletion as legacyGenerateCompletion,
  checkHealth as legacyCheckHealth,
} from "../openai.service.js";
import { LlmProvider } from "./llm-provider.interface.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderHealth,
  LlmProviderName,
} from "./types.js";

export class OpenAIProvider extends LlmProvider {
  readonly providerName: LlmProviderName = "openai";

  async initialize(): Promise<void> {
    if (!env.openai.apiKey) {
      logger.warn(
        { provider: this.providerName },
        "[llm-provider] OpenAI selected but OPENAI_API_KEY is not set",
      );
    }
  }

  async generateCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResponse> {
    const response = await legacyGenerateCompletion(messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      dealId: options.dealId,
      userId: options.userId,
    });

    return {
      content: response.content,
      usage: response.usage,
      model: response.model,
      provider: response.fallbackUsed ? "ollama" : "openai",
      fallbackUsed: response.fallbackUsed,
    };
  }

  async checkHealth(): Promise<LlmProviderHealth> {
    const result = await legacyCheckHealth();
    return {
      available: result.available,
      provider: this.providerName,
      model: result.model,
      error: result.error,
    };
  }
}
