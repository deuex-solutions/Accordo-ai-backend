/**
 * OpenAI Service - Integration with OpenAI GPT-3.5 Turbo for Procurement Manager
 *
 * This service handles all OpenAI API interactions for the ACCORDO chatbot.
 * It includes:
 * - Chat completions with GPT-3.5 Turbo
 * - Token counting and context management
 * - Usage tracking for cost monitoring
 * - Automatic fallback to Qwen3 (Ollama) on failure
 */

import OpenAI from "openai";
// tiktoken is dynamically imported on first use to keep cold-start light.
// Type imported for compile-time only — emits nothing at runtime.
import type {
  encoding_for_model as EncodingForModel,
  TiktokenModel,
} from "tiktoken";
type EncodingForModelFn = typeof EncodingForModel;

let cachedEncodingForModel: EncodingForModelFn | null = null;
async function getEncodingForModel(): Promise<EncodingForModelFn | null> {
  if (cachedEncodingForModel) return cachedEncodingForModel;
  try {
    const mod = await import("tiktoken");
    cachedEncodingForModel = mod.encoding_for_model;
    return cachedEncodingForModel;
  } catch (error) {
    logger.warn("[OpenAI] tiktoken not available, will use char estimate", {
      error,
    });
    return null;
  }
}
import env from "../config/env.js";
import logger from "../config/logger.js";
import models from "../models/index.js";
import { chatCompletion as ollamaChatCompletion } from "./llm.service.js";

// OpenAI client instance
let openaiClient: OpenAI | null = null;

// Token limits for GPT-3.5 Turbo
const GPT35_MAX_CONTEXT_TOKENS = 16384;
const RESERVED_OUTPUT_TOKENS = 1500; // Reserve tokens for response
const MAX_INPUT_TOKENS = GPT35_MAX_CONTEXT_TOKENS - RESERVED_OUTPUT_TOKENS;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenAICompletionOptions {
  temperature?: number;
  maxTokens?: number;
  dealId?: string;
  userId?: number;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface OpenAIResponse {
  content: string;
  usage: TokenUsage;
  model: string;
  fallbackUsed: boolean;
}

/**
 * Initialize OpenAI client
 */
function getOpenAIClient(): OpenAI | null {
  if (!env.openai.apiKey) {
    logger.warn("[OpenAI] No API key configured, will use fallback");
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.openai.apiKey,
    });
    logger.info("[OpenAI] Client initialized", { model: env.openai.model });
  }

  return openaiClient;
}

/**
 * Estimate tokens from character count. Used as fallback when tiktoken isn't
 * loaded yet or fails. ~4 chars per token is the standard heuristic.
 */
function estimateTokens(messages: ChatMessage[]): number {
  return Math.ceil(messages.reduce((acc, m) => acc + m.content.length, 0) / 4);
}

/**
 * Count tokens in a message array using tiktoken (when loaded). Falls back to
 * the char-estimate heuristic synchronously if tiktoken hasn't been loaded yet —
 * callers can pre-warm by awaiting `warmTokenCounter()` at startup if needed.
 */
export function countTokens(
  messages: ChatMessage[],
  model: string = "gpt-3.5-turbo",
): number {
  if (!cachedEncodingForModel) {
    void getEncodingForModel();
    return estimateTokens(messages);
  }
  try {
    const encoding = cachedEncodingForModel(model as TiktokenModel);
    let totalTokens = 0;

    for (const message of messages) {
      // Each message has overhead: role tokens + content tokens + separators
      totalTokens += 4; // <|start|>role<|sep|>
      totalTokens += encoding.encode(message.role).length;
      totalTokens += encoding.encode(message.content).length;
    }
    totalTokens += 2; // <|end|>

    encoding.free();
    return totalTokens;
  } catch (error) {
    logger.warn("[OpenAI] Token counting failed, using estimate", { error });
    return estimateTokens(messages);
  }
}

/** Force-load tiktoken. Call once at startup if you want accurate counts on
 *  the first request instead of an estimate. */
export async function warmTokenCounter(): Promise<void> {
  await getEncodingForModel();
}

/**
 * Truncate messages to fit within token limit
 * Keeps system message and most recent messages
 */
export function truncateMessages(
  messages: ChatMessage[],
  maxTokens: number = MAX_INPUT_TOKENS,
): ChatMessage[] {
  if (messages.length === 0) return messages;

  const systemMessage = messages.find((m) => m.role === "system");
  const otherMessages = messages.filter((m) => m.role !== "system");

  // Start with system message
  const result: ChatMessage[] = systemMessage ? [systemMessage] : [];
  let currentTokens = systemMessage ? countTokens([systemMessage]) : 0;

  // Add messages from most recent to oldest
  const reversedMessages = [...otherMessages].reverse();
  const messagesToAdd: ChatMessage[] = [];

  for (const message of reversedMessages) {
    const messageTokens = countTokens([message]);
    if (currentTokens + messageTokens <= maxTokens) {
      messagesToAdd.unshift(message);
      currentTokens += messageTokens;
    } else {
      logger.info("[OpenAI] Truncating conversation", {
        originalCount: messages.length,
        truncatedCount: result.length + messagesToAdd.length,
        tokensUsed: currentTokens,
        maxTokens,
      });
      break;
    }
  }

  return [...result, ...messagesToAdd];
}

/**
 * Sleep for retry delay with exponential backoff
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Log API usage to database for cost tracking
 */
async function logUsage(
  usage: TokenUsage,
  model: string,
  dealId?: string,
  userId?: number,
  fallbackUsed: boolean = false,
): Promise<void> {
  try {
    await models.ApiUsageLog.create({
      provider: fallbackUsed ? "ollama" : "openai",
      model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      dealId: dealId || null,
      userId: userId || null,
      createdAt: new Date(),
    });
  } catch (error) {
    // Don't fail the request if logging fails
    logger.error("[OpenAI] Failed to log usage", { error });
  }
}

/**
 * Generate chat completion using OpenAI GPT-3.5 Turbo
 * Falls back to Qwen3 (Ollama) if OpenAI is unavailable
 */
export async function generateCompletion(
  messages: ChatMessage[],
  options: OpenAICompletionOptions = {},
): Promise<OpenAIResponse> {
  const {
    temperature = env.openai.temperature,
    maxTokens = env.openai.maxTokens,
    dealId,
    userId,
  } = options;

  // Truncate messages if needed
  const truncatedMessages = truncateMessages(messages);

  // Try OpenAI first
  const client = getOpenAIClient();

  if (client) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        logger.info("[OpenAI] Sending request", {
          model: env.openai.model,
          messageCount: truncatedMessages.length,
          temperature,
          maxTokens,
          attempt: attempt + 1,
        });

        const response = await client.chat.completions.create({
          model: env.openai.model,
          messages: truncatedMessages,
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content || "";
        const usage: TokenUsage = {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        };

        // Log usage for cost tracking
        await logUsage(usage, env.openai.model, dealId, userId, false);

        logger.info("[OpenAI] Request successful", {
          model: response.model,
          usage,
          contentLength: content.length,
        });

        return {
          content,
          usage,
          model: response.model,
          fallbackUsed: false,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const openaiError = error as { status?: number; code?: string };

        logger.warn("[OpenAI] Request failed", {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          status: openaiError.status,
          code: openaiError.code,
          message: lastError.message,
        });

        // Don't retry on client errors (4xx) except rate limits (429)
        if (
          openaiError.status &&
          openaiError.status >= 400 &&
          openaiError.status < 500 &&
          openaiError.status !== 429
        ) {
          break;
        }

        // Wait before retry with exponential backoff
        if (attempt < MAX_RETRIES - 1) {
          const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
          await sleep(delayMs);
        }
      }
    }

    logger.error("[OpenAI] All retries failed, falling back to Qwen3", {
      error: lastError?.message,
    });
  }

  // Fallback to Qwen3 (Ollama)
  return fallbackToQwen3(truncatedMessages, options);
}

/**
 * Fallback to Qwen3 (Ollama) when OpenAI is unavailable
 */
async function fallbackToQwen3(
  messages: ChatMessage[],
  options: OpenAICompletionOptions,
): Promise<OpenAIResponse> {
  const { dealId, userId, temperature = 0.7, maxTokens = 1000 } = options;

  logger.info("[OpenAI] Using Qwen3 fallback", {
    messageCount: messages.length,
  });

  try {
    const content = await ollamaChatCompletion(messages, {
      temperature,
      maxTokens,
    });

    // Estimate token usage for Ollama (no actual count available)
    const estimatedPromptTokens = countTokens(messages);
    const estimatedCompletionTokens = Math.ceil(content.length / 4);
    const usage: TokenUsage = {
      promptTokens: estimatedPromptTokens,
      completionTokens: estimatedCompletionTokens,
      totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
    };

    // Log usage
    await logUsage(usage, env.llm.model, dealId, userId, true);

    return {
      content,
      usage,
      model: env.llm.model,
      fallbackUsed: true,
    };
  } catch (error) {
    logger.error("[OpenAI] Qwen3 fallback also failed", { error });
    throw new Error("Both OpenAI and Qwen3 fallback failed");
  }
}

/**
 * Check if OpenAI service is available
 */
export async function checkHealth(): Promise<{
  available: boolean;
  model: string;
  error?: string;
}> {
  const client = getOpenAIClient();

  if (!client) {
    return {
      available: false,
      model: env.openai.model,
      error: "No API key configured",
    };
  }

  try {
    // Make a minimal request to check connectivity
    const response = await client.chat.completions.create({
      model: env.openai.model,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
    });

    return {
      available: true,
      model: response.model,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      available: false,
      model: env.openai.model,
      error: errorMessage,
    };
  }
}

/**
 * Get current OpenAI configuration
 */
export function getConfig(): {
  model: string;
  maxTokens: number;
  temperature: number;
  apiKeyConfigured: boolean;
} {
  return {
    model: env.openai.model,
    maxTokens: env.openai.maxTokens,
    temperature: env.openai.temperature,
    apiKeyConfigured: !!env.openai.apiKey,
  };
}

export default {
  generateCompletion,
  countTokens,
  truncateMessages,
  checkHealth,
  getConfig,
};
