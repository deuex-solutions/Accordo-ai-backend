/**
 * Ollama Embedding Provider
 *
 * Talks to the local Ollama daemon (default http://localhost:11434/api/embeddings).
 * Default model: bge-m3 (1024 dimensions, multilingual, 8192 token context window —
 * functional match for Bedrock Titan Embed Text v2 used in the staging/prod target).
 *
 * Ollama returns un-normalized embeddings; this provider L2-normalizes the output
 * so cosine-similarity math matches the other providers (which all return unit vectors).
 */

import axios, { AxiosError } from "axios";
import env from "../../../config/env.js";
import logger from "../../../config/logger.js";
import { EmbeddingProvider } from "./embedding-provider.interface.js";
import type { EmbeddingProviderConfig } from "./embedding-provider.interface.js";
import type { EmbeddingServiceHealth } from "../vector.types.js";

interface OllamaEmbedResponse {
  embedding: number[];
}

const INITIAL_RETRY_DELAY_MS = 500;

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

function l2Normalize(vec: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = vec[i] / norm;
  }
  return out;
}

export class OllamaEmbeddingProvider extends EmbeddingProvider {
  readonly providerName = "ollama";

  private readonly baseURL: string;
  private readonly maxRetries: number = 3;
  /** Discovered after the first successful call (some models lie about their dim). */
  private nativeDimension: number = 0;

  constructor(config: EmbeddingProviderConfig) {
    super(config);
    this.baseURL = env.llm.ollamaBaseURL;
  }

  async initialize(): Promise<void> {
    logger.info(
      {
        provider: this.providerName,
        baseURL: this.baseURL,
        model: this.config.model,
        targetDimension: this.config.dimension,
      },
      "[ollama-embed] Initializing Ollama embedding provider",
    );

    try {
      const probe = await this.rawEmbed("dimension probe");
      this.nativeDimension = probe.length;
      logger.info(
        {
          provider: this.providerName,
          model: this.config.model,
          nativeDimension: this.nativeDimension,
          targetDimension: this.config.dimension,
        },
        "[ollama-embed] Probe successful — daemon reachable, model responsive",
      );

      if (
        this.config.dimension > 0 &&
        this.nativeDimension < this.config.dimension
      ) {
        logger.warn(
          {
            nativeDimension: this.nativeDimension,
            targetDimension: this.config.dimension,
            model: this.config.model,
          },
          "[ollama-embed] Native dimension is smaller than target — will pad with zeros (consider switching model)",
        );
      }
    } catch (error) {
      logger.warn(
        {
          provider: this.providerName,
          baseURL: this.baseURL,
          model: this.config.model,
          error: error instanceof Error ? error.message : String(error),
        },
        "[ollama-embed] Initialization probe failed; provider will retry on first embed() call",
      );
    }
  }

  async embed(text: string, _instruction?: string): Promise<number[]> {
    const raw = await this.rawEmbed(text);
    return this.shapeOutput(raw);
  }

  async embedBatch(texts: string[], instruction?: string): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Ollama embeddings API is single-input. Use bounded concurrency to avoid
    // overwhelming the daemon on large batches (matches Bedrock provider pattern).
    const CONCURRENCY = 5;
    const results: number[][] = new Array(texts.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < texts.length) {
        const idx = cursor++;
        results[idx] = await this.embed(texts[idx], instruction);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, texts.length) }, () =>
        worker(),
      ),
    );
    return results;
  }

  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      await axios.get(`${this.baseURL}/api/tags`, { timeout: 5000 });
      return {
        status: this.nativeDimension > 0 ? "healthy" : "initializing",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "ollama",
        gpu_available: false,
      };
    } catch {
      return {
        status: "unavailable",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "ollama",
        gpu_available: false,
      };
    }
  }

  /** POST to Ollama and return the raw (un-normalized, native-dim) vector. */
  private async rawEmbed(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const { data } = await axios.post<OllamaEmbedResponse>(
          `${this.baseURL}/api/embeddings`,
          {
            model: this.config.model,
            prompt: text,
          },
          { timeout: this.config.timeout },
        );

        if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
          throw new Error("Ollama returned empty embedding");
        }

        return data.embedding;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < this.maxRetries && isRetryableError(error)) {
          await sleep(INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt));
          continue;
        }

        logger.error(
          {
            provider: this.providerName,
            model: this.config.model,
            attempt: attempt + 1,
            error: lastError.message,
          },
          "[ollama-embed] Embedding request failed",
        );
        break;
      }
    }

    throw lastError ?? new Error("Ollama embedding failed after all retries");
  }

  /** Pad/truncate to configured dimension and L2-normalize. */
  private shapeOutput(raw: number[]): number[] {
    const target = this.config.dimension;
    let shaped = raw;

    if (target > 0 && raw.length !== target) {
      if (raw.length > target) {
        shaped = raw.slice(0, target);
      } else {
        // Pad with zeros — defensive, shouldn't fire for bge-m3 (1024d native).
        shaped = raw.concat(new Array<number>(target - raw.length).fill(0));
      }
    }

    return l2Normalize(shaped);
  }
}
