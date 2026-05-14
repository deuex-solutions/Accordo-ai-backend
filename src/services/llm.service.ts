/**
 * LLM Service - Integration with Ollama for AI chat completions
 */

import axios from "axios";
import env from "../config/env.js";
import logger from "../config/logger.js";

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /** Number of retry attempts for transient failures */
  retries?: number;
}

interface LLMHealthResponse {
  available: boolean;
  model: string;
  error?: string;
}

// Use centralized config from env.ts
const LLM_BASE_URL = env.llm.baseURL;
const LLM_MODEL = env.llm.model;
const LLM_TIMEOUT = env.llm.timeout;

// Retry configuration
const DEFAULT_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Sleep for a specified duration
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Determine if an error is retryable (transient failure)
 */
function isRetryableError(error: unknown): boolean {
  const axiosError = error as { code?: string; response?: { status?: number } };

  // Network errors
  if (
    axiosError.code === "ECONNRESET" ||
    axiosError.code === "ETIMEDOUT" ||
    axiosError.code === "ECONNREFUSED"
  ) {
    return true;
  }

  // Server errors (5xx) are retryable
  const status = axiosError.response?.status;
  if (status && status >= 500 && status < 600) {
    return true;
  }

  // Rate limiting (429) is retryable
  if (status === 429) {
    return true;
  }

  return false;
}

/**
 * Check if LLM service is available
 */
export async function checkHealth(): Promise<LLMHealthResponse> {
  try {
    await axios.get(`${LLM_BASE_URL}/api/tags`, {
      timeout: 5000,
    });

    return {
      available: true,
      model: LLM_MODEL,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const axiosError = error as { code?: string };
    logger.error("LLM health check failed:", {
      message: errorMessage,
      code: axiosError.code,
    });
    return {
      available: false,
      model: LLM_MODEL,
      error: errorMessage,
    };
  }
}

/**
 * Send a chat completion request to the LLM with retry logic
 */
export async function chatCompletion(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<string> {
  const maxRetries = options.retries ?? DEFAULT_RETRIES;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${LLM_BASE_URL}/api/chat`,
        {
          model: options.model || LLM_MODEL,
          messages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 1.0,
            num_predict: options.maxTokens ?? 2048,
          },
        },
        {
          timeout: LLM_TIMEOUT,
        },
      );

      return response.data.message?.content || "";
    } catch (error) {
      // Extract safe error details to avoid circular reference issues with axios errors
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const axiosError = error as {
        response?: { status?: number; data?: unknown };
        code?: string;
      };

      lastError = new Error(`Failed to get response from LLM: ${errorMessage}`);

      // Check if we should retry
      if (attempt < maxRetries && isRetryableError(error)) {
        const delayMs = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt);
        logger.warn("LLM chat completion failed, retrying...", {
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          message: errorMessage,
          status: axiosError.response?.status,
          code: axiosError.code,
        });
        await sleep(delayMs);
        continue;
      }

      logger.error("LLM chat completion failed:", {
        message: errorMessage,
        status: axiosError.response?.status,
        code: axiosError.code,
        responseData: axiosError.response?.data,
        attemptsMade: attempt + 1,
      });
      throw lastError;
    }
  }

  // Should not reach here, but just in case
  throw lastError || new Error("LLM request failed after all retries");
}

/**
 * Stream a chat completion request to the LLM
 */
export async function streamChatCompletion(
  messages: LLMMessage[],
  onChunk: (chunk: string) => void,
  options: LLMOptions = {},
): Promise<void> {
  try {
    const response = await axios.post(
      `${LLM_BASE_URL}/api/chat`,
      {
        model: options.model || LLM_MODEL,
        messages,
        stream: true,
        options: {
          temperature: options.temperature ?? 0.7,
          top_p: options.topP ?? 1.0,
          num_predict: options.maxTokens ?? 2048,
        },
      },
      {
        responseType: "stream",
        timeout: 120000,
      },
    );

    response.data.on("data", (chunk: Buffer) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (data.message?.content) {
            onChunk(data.message.content);
          }
        } catch (e) {
          // Ignore parse errors for incomplete chunks
        }
      }
    });

    return new Promise((resolve, reject) => {
      response.data.on("end", resolve);
      response.data.on("error", reject);
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const axiosError = error as {
      response?: { status?: number };
      code?: string;
    };
    logger.error("LLM stream completion failed:", {
      message: errorMessage,
      status: axiosError.response?.status,
      code: axiosError.code,
    });
    throw new Error(`Failed to stream response from LLM: ${errorMessage}`);
  }
}

export default {
  checkHealth,
  chatCompletion,
  streamChatCompletion,
};
