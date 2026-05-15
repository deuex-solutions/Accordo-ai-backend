/**
 * Ollama LLM provider — local dev path.
 *
 * Talks directly to the Ollama daemon (default http://localhost:11434).
 * No OpenAI fallback here; if Ollama is unreachable the provider throws
 * and the factory's selection guard decides whether to fail or fall back.
 */

import axios, { AxiosError } from "axios";
import env from "../../config/env.js";
import logger from "../../config/logger.js";
import models from "../../models/index.js";
import { LlmProvider } from "./llm-provider.interface.js";
import type {
  ChatCompletionOptions,
  ChatCompletionResponse,
  ChatMessage,
  LlmProviderHealth,
  LlmProviderName,
  TokenUsage,
} from "./types.js";

const INITIAL_RETRY_DELAY_MS = 500;
const DEFAULT_RETRIES = 3;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableError(error: unknown): boolean {
  const axErr = error as AxiosError;
  if (
    axErr.code === "ECONNRESET" ||
    axErr.code === "ETIMEDOUT" ||
    axErr.code === "ECONNREFUSED"
  ) {
    return true;
  }
  const status = axErr.response?.status;
  if (status !== undefined && status >= 500 && status < 600) return true;
  if (status === 429) return true;
  return false;
}

/** Char-based token estimate — Ollama doesn't return exact counts pre-13.0. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface OllamaChatResponse {
  message?: { content?: string };
  model?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider extends LlmProvider {
  readonly providerName: LlmProviderName = "ollama";

  private readonly baseURL: string;

  constructor(config: {
    model: string;
    timeoutMs: number;
    maxRetries: number;
  }) {
    super(config);
    this.baseURL = env.llm.ollamaBaseURL;
  }

  async initialize(): Promise<void> {
    // Fire-and-forget health probe so the daemon is reachable before first request.
    // Failure here is non-fatal; generateCompletion() surfaces the real error.
    try {
      await axios.get(`${this.baseURL}/api/tags`, { timeout: 5000 });
      logger.info(
        {
          provider: this.providerName,
          baseURL: this.baseURL,
          model: this.config.model,
        },
        "[llm-provider] Ollama daemon reachable",
      );
    } catch (error) {
      logger.warn(
        {
          provider: this.providerName,
          baseURL: this.baseURL,
          error: error instanceof Error ? error.message : String(error),
        },
        "[llm-provider] Ollama daemon unreachable at startup",
      );
    }
  }

  async generateCompletion(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<ChatCompletionResponse> {
    const model = options.modelOverride || this.config.model;
    const temperature = options.temperature ?? 0.7;
    const topP = options.topP ?? 1.0;
    const numPredict = options.maxTokens ?? 2048;
    const timeout = options.timeoutMs ?? this.config.timeoutMs;
    const maxRetries =
      options.retries ?? this.config.maxRetries ?? DEFAULT_RETRIES;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const started = Date.now();
        const { data } = await axios.post<OllamaChatResponse>(
          `${this.baseURL}/api/chat`,
          {
            model,
            messages,
            stream: false,
            options: {
              temperature,
              top_p: topP,
              num_predict: numPredict,
            },
          },
          { timeout },
        );

        const content = data.message?.content ?? "";
        const elapsed = Date.now() - started;

        const promptTokens =
          data.prompt_eval_count ??
          messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
        const completionTokens = data.eval_count ?? estimateTokens(content);

        const usage: TokenUsage = {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        };

        await this.logUsage(usage, model, options).catch(() => undefined);

        logger.info(
          {
            provider: this.providerName,
            model,
            elapsedMs: elapsed,
            attempt: attempt + 1,
            usage,
          },
          "[llm-provider] Ollama chat completion successful",
        );

        return {
          content,
          usage,
          model: data.model ?? model,
          provider: "ollama",
          fallbackUsed: false,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const axErr = error as AxiosError;

        logger.warn(
          {
            provider: this.providerName,
            model,
            attempt: attempt + 1,
            maxRetries,
            status: axErr.response?.status,
            code: axErr.code,
            error: lastError.message,
          },
          "[llm-provider] Ollama request failed",
        );

        if (attempt < maxRetries && isRetryableError(error)) {
          await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        break;
      }
    }

    throw lastError ?? new Error("Ollama request failed after all retries");
  }

  async checkHealth(): Promise<LlmProviderHealth> {
    try {
      await axios.get(`${this.baseURL}/api/tags`, { timeout: 5000 });
      return {
        available: true,
        provider: this.providerName,
        model: this.config.model,
      };
    } catch (error) {
      return {
        available: false,
        provider: this.providerName,
        model: this.config.model,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async logUsage(
    usage: TokenUsage,
    model: string,
    options: ChatCompletionOptions,
  ): Promise<void> {
    if (!options.dealId && !options.userId) return;
    try {
      await models.ApiUsageLog.create({
        provider: "ollama",
        model,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        dealId: options.dealId || null,
        userId: options.userId || null,
        createdAt: new Date(),
      });
    } catch (error) {
      logger.error(
        {
          provider: this.providerName,
          error: error instanceof Error ? error.message : String(error),
        },
        "[llm-provider] Failed to log Ollama usage",
      );
    }
  }
}
