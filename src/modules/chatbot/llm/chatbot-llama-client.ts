/**
 * Dedicated LLM Client for Chatbot Negotiation
 *
 * This client uses a separate Ollama instance/model specifically for chatbot negotiations.
 * It allows configuration independence from the main LLM service used for insights/summarization.
 *
 * Environment Variables:
 * - CHATBOT_LLM_BASE_URL: Ollama base URL (defaults to main LLM_BASE_URL)
 * - CHATBOT_LLM_MODEL: Model name (defaults to 'qwen3')
 */

import axios, { AxiosError } from 'axios';
import env from '../../../config/env.js';
import logger from '../../../config/logger.js';

// Chatbot-specific LLM configuration
const CHATBOT_LLM_BASE_URL =
  process.env.CHATBOT_LLM_BASE_URL || env.llm.baseURL || 'http://localhost:11434';
const CHATBOT_LLM_MODEL = process.env.CHATBOT_LLM_MODEL || 'qwen3';

// Performance-optimized defaults for Qwen3 model
const DEFAULT_MAX_TOKENS = 120;  // Qwen3 is efficient, moderate token limit for responses
const DEFAULT_TEMPERATURE = 0.6;  // Balanced temperature for coherent, natural responses
const DEFAULT_NUM_CTX = 4096;  // Qwen3 supports good context window
const FAST_TIMEOUT_MS = 8000;  // 8 second timeout - Qwen3 is fast and lightweight

/**
 * Message interface for chat completion
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Options for LLM completion
 */
export interface CompletionOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

/**
 * Generate a chat completion using Ollama
 *
 * @param systemPrompt - System instructions for the LLM
 * @param conversationHistory - Array of previous messages
 * @param options - Optional parameters (temperature, maxTokens)
 * @returns Generated text response
 * @throws Error if LLM request fails
 */
export async function generateChatbotLlamaCompletion(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  options: CompletionOptions = {}
): Promise<string> {
  try {
    const {
      temperature = DEFAULT_TEMPERATURE,
      maxTokens = DEFAULT_MAX_TOKENS,
      topP = 0.9,  // Balanced top-p for natural responses with Qwen3
    } = options;

    // Prepare messages array
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.map((msg) => ({
        role: msg.role === 'VENDOR' ? 'user' : 'assistant',
        content: msg.content,
      })) as ChatMessage[],
    ];

    logger.info('[ChatbotLLM] Sending request to Ollama', {
      baseUrl: CHATBOT_LLM_BASE_URL,
      model: CHATBOT_LLM_MODEL,
      messageCount: messages.length,
      temperature,
    });

    // Make request to Ollama chat endpoint with optimized settings
    const response = await axios.post(
      `${CHATBOT_LLM_BASE_URL}/api/chat`,
      {
        model: CHATBOT_LLM_MODEL,
        messages,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: topP,
          num_ctx: DEFAULT_NUM_CTX,  // Limit context window for speed
        },
      },
      {
        timeout: FAST_TIMEOUT_MS,  // Faster timeout for better UX
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    const generatedText = response.data?.message?.content?.trim();

    if (!generatedText) {
      logger.error('[ChatbotLLM] Empty response from Ollama', {
        responseData: response.data,
      });
      throw new Error('Empty response from LLM');
    }

    logger.info('[ChatbotLLM] Successfully generated reply', {
      length: generatedText.length,
    });

    return generatedText;
  } catch (error) {
    if (error instanceof AxiosError) {
      logger.error('[ChatbotLLM] Ollama request failed', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });

      if (error.code === 'ECONNREFUSED') {
        throw new Error(
          `Cannot connect to chatbot LLM at ${CHATBOT_LLM_BASE_URL}. Is Ollama running?`
        );
      }

      if (error.response?.status === 404) {
        throw new Error(
          `Model "${CHATBOT_LLM_MODEL}" not found. Run: ollama pull ${CHATBOT_LLM_MODEL}`
        );
      }

      throw new Error(`LLM request failed: ${error.message}`);
    }

    logger.error('[ChatbotLLM] Unexpected error', { error });
    throw error;
  }
}

/**
 * Test connection to chatbot LLM service
 *
 * @returns True if connection successful
 */
export async function testChatbotLLMConnection(): Promise<boolean> {
  try {
    logger.info('[ChatbotLLM] Testing connection...', {
      baseUrl: CHATBOT_LLM_BASE_URL,
      model: CHATBOT_LLM_MODEL,
    });

    const response = await axios.get(`${CHATBOT_LLM_BASE_URL}/api/tags`, {
      timeout: 5000,
    });

    const models = response.data?.models || [];
    const modelExists = models.some((m: any) => m.name === CHATBOT_LLM_MODEL);

    if (!modelExists) {
      logger.warn('[ChatbotLLM] Model not found in available models', {
        requestedModel: CHATBOT_LLM_MODEL,
        availableModels: models.map((m: any) => m.name),
      });
      return false;
    }

    logger.info('[ChatbotLLM] Connection test successful', {
      modelCount: models.length,
    });

    return true;
  } catch (error) {
    logger.error('[ChatbotLLM] Connection test failed', { error });
    return false;
  }
}

/**
 * Get chatbot LLM configuration info
 */
export function getChatbotLLMConfig(): {
  baseUrl: string;
  model: string;
} {
  return {
    baseUrl: CHATBOT_LLM_BASE_URL,
    model: CHATBOT_LLM_MODEL,
  };
}

/**
 * Stream a chat completion using Ollama with SSE
 *
 * This function streams the response chunk by chunk for better perceived performance.
 * Each chunk is passed to the onChunk callback as it arrives.
 *
 * @param systemPrompt - System instructions for the LLM
 * @param conversationHistory - Array of previous messages
 * @param onChunk - Callback function called for each text chunk
 * @param options - Optional parameters (temperature, maxTokens)
 * @returns Complete generated text
 */
export async function streamChatbotLlamaCompletion(
  systemPrompt: string,
  conversationHistory: Array<{ role: string; content: string }>,
  onChunk: (chunk: string) => void,
  options: CompletionOptions = {}
): Promise<string> {
  const {
    temperature = DEFAULT_TEMPERATURE,
    maxTokens = DEFAULT_MAX_TOKENS,
    topP = 0.9,  // Balanced top-p for natural responses with Qwen3
  } = options;

  // Prepare messages array
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.map((msg) => ({
      role: msg.role === 'VENDOR' ? 'user' : 'assistant',
      content: msg.content,
    })) as ChatMessage[],
  ];

  logger.info('[ChatbotLLM] Starting streaming request to Ollama', {
    baseUrl: CHATBOT_LLM_BASE_URL,
    model: CHATBOT_LLM_MODEL,
    messageCount: messages.length,
  });

  try {
    const response = await axios.post(
      `${CHATBOT_LLM_BASE_URL}/api/chat`,
      {
        model: CHATBOT_LLM_MODEL,
        messages,
        stream: true,  // Enable streaming
        options: {
          temperature,
          num_predict: maxTokens,
          top_p: topP,
          num_ctx: DEFAULT_NUM_CTX,
        },
      },
      {
        timeout: FAST_TIMEOUT_MS,
        responseType: 'stream',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    let fullText = '';

    return new Promise<string>((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              const textChunk = data.message.content;
              fullText += textChunk;
              onChunk(textChunk);
            }
            if (data.done) {
              logger.info('[ChatbotLLM] Streaming completed', {
                totalLength: fullText.length,
              });
              resolve(fullText.trim());
            }
          } catch (parseError) {
            // Ignore parse errors for incomplete chunks
          }
        }
      });

      response.data.on('error', (error: Error) => {
        logger.error('[ChatbotLLM] Stream error', { error: error.message });
        reject(error);
      });

      response.data.on('end', () => {
        if (fullText) {
          resolve(fullText.trim());
        }
      });
    });
  } catch (error) {
    if (error instanceof AxiosError) {
      logger.error('[ChatbotLLM] Streaming request failed', {
        status: error.response?.status,
        message: error.message,
      });
      throw new Error(`LLM streaming failed: ${error.message}`);
    }
    throw error;
  }
}
