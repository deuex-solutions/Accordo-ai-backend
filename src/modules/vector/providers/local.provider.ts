/**
 * Local Embedding Provider
 * Calls a local Ollama server (default http://localhost:11434) via /api/embeddings.
 * Default model: gpt-oss:20b (configurable via EMBEDDING_MODEL).
 *
 * Replaces the previous @huggingface/transformers (ONNX) implementation. For
 * production, set EMBEDDING_PROVIDER=bedrock with a custom-imported gpt-oss:20b
 * model ARN — same model family, different transport.
 */

import axios, { AxiosInstance } from "axios";
import env from "../../../config/env.js";
import logger from "../../../config/logger.js";
import { EmbeddingProvider } from "./embedding-provider.interface.js";
import type { EmbeddingProviderConfig } from "./embedding-provider.interface.js";
import type { EmbeddingServiceHealth } from "../vector.types.js";

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export class LocalEmbeddingProvider extends EmbeddingProvider {
  readonly providerName = "local";
  private client: AxiosInstance;
  private nativeDimension: number = 0;
  private readonly baseURL: string;

  constructor(config: EmbeddingProviderConfig) {
    super(config);
    this.baseURL = env.llm.baseURL;
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: this.config.timeout,
    });
  }

  async initialize(): Promise<void> {
    logger.info(
      `Initializing local embedding provider via Ollama at ${this.baseURL} (model: ${this.config.model})`,
    );

    const probe = await this.requestEmbedding("test");
    this.nativeDimension = probe.length;

    if (this.nativeDimension < this.config.dimension) {
      logger.warn(
        `Native embedding dimension (${this.nativeDimension}) is smaller than configured target (${this.config.dimension}). ` +
          `Vectors will be returned at native length; downstream code expecting ${this.config.dimension} dims may break.`,
      );
    }

    logger.info(
      `Local embedding provider ready (native dim: ${this.nativeDimension}, target dim: ${this.config.dimension})`,
    );
  }

  async embed(text: string, instruction?: string): Promise<number[]> {
    const input = instruction ? `${instruction}: ${text}` : text;
    const raw = await this.requestEmbedding(input);

    if (this.config.dimension > 0 && this.config.dimension < raw.length) {
      return this.truncateAndNormalize(raw, this.config.dimension);
    }
    return raw;
  }

  async embedBatch(texts: string[], instruction?: string): Promise<number[][]> {
    if (texts.length === 0) return [];
    // Ollama's embeddings endpoint takes one prompt per call. Serial is fine on CPU.
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text, instruction));
    }
    return results;
  }

  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      await this.requestEmbedding("health check");
      return {
        status: "healthy",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "ollama",
        gpu_available: false,
      };
    } catch (error) {
      logger.error("Local embedding health check failed:", error);
      return {
        status: "unavailable",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "ollama",
        gpu_available: false,
      };
    }
  }

  private async requestEmbedding(prompt: string): Promise<number[]> {
    const { data } = await this.client.post<OllamaEmbeddingResponse>(
      "/api/embeddings",
      {
        model: this.config.model,
        prompt,
      },
    );
    if (
      !data?.embedding ||
      !Array.isArray(data.embedding) ||
      data.embedding.length === 0
    ) {
      throw new Error(
        `Ollama returned empty embedding for model "${this.config.model}". Is the model pulled? Try: ollama pull ${this.config.model}`,
      );
    }
    return data.embedding;
  }

  private truncateAndNormalize(
    embedding: number[],
    targetDim: number,
  ): number[] {
    const truncated = embedding.slice(0, targetDim);

    let norm = 0;
    for (let i = 0; i < truncated.length; i++) {
      norm += truncated[i] * truncated[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < truncated.length; i++) {
        truncated[i] /= norm;
      }
    }

    return truncated;
  }
}
