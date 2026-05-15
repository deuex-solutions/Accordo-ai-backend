/**
 * Local Embedding Provider
 * Uses @huggingface/transformers (ONNX) for CPU-based embeddings in Node.js.
 * Default model: Xenova/bge-large-en-v1.5 (1024 dimensions native).
 */

import logger from "../../../config/logger.js";
import { EmbeddingProvider } from "./embedding-provider.interface.js";
import type { EmbeddingProviderConfig } from "./embedding-provider.interface.js";
import type { EmbeddingServiceHealth } from "../vector.types.js";

// The feature-extraction pipeline returns a Tensor, but the generic pipeline type
// returns a wide union. We use a typed wrapper to access .data and .dims safely.
interface TensorResult {
  data: Float32Array;
  dims: number[];
}

type FeatureExtractionPipeline = (
  text: string,
  options?: Record<string, unknown>,
) => Promise<TensorResult>;

export class LocalEmbeddingProvider extends EmbeddingProvider {
  readonly providerName = "local";
  private pipeline: FeatureExtractionPipeline | null = null;
  private nativeDimension: number = 0;

  async initialize(): Promise<void> {
    logger.info(
      `Loading local embedding model: ${this.config.model} (this may take a moment on first run)...`,
    );

    // Dynamic import — ESM, large library, lazy-loaded; optional dep
    // @ts-ignore - optional dep, may not be installed if not using local embedding provider
    const { pipeline, env } = await import("@huggingface/transformers");

    // Disable remote model downloads warning in production
    env.allowLocalModels = true;

    const pipe = await pipeline("feature-extraction", this.config.model, {
      dtype: "q8" as never,
    });
    this.pipeline = pipe as unknown as FeatureExtractionPipeline;

    // Determine native dimension by running a test embedding
    const testOutput = await this.pipeline("test", {
      pooling: "cls",
      normalize: true,
    });
    this.nativeDimension = testOutput.dims[testOutput.dims.length - 1];

    logger.info(
      `Local embedding model loaded: ${this.config.model} (native dim: ${this.nativeDimension}, target dim: ${this.config.dimension})`,
    );
  }

  async embed(text: string, instruction?: string): Promise<number[]> {
    if (!this.pipeline) {
      throw new Error("Local embedding provider not initialized");
    }

    // BGE models use instruction prefixes
    const input = instruction ? `${instruction}: ${text}` : text;

    const output = await this.pipeline(input, {
      pooling: "cls",
      normalize: true,
    });

    let embedding = Array.from(output.data).slice(0, this.nativeDimension);

    // Truncate + re-normalize if target dimension < native dimension
    if (this.config.dimension < this.nativeDimension) {
      embedding = this.truncateAndNormalize(embedding, this.config.dimension);
    }

    return embedding;
  }

  async embedBatch(texts: string[], instruction?: string): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Serial processing — CPU has no parallelism benefit
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text, instruction));
    }
    return results;
  }

  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      if (!this.pipeline) {
        return {
          status: "initializing",
          model: this.config.model,
          dimension: this.config.dimension,
          device: "cpu",
          gpu_available: false,
        };
      }

      // Quick test embed
      await this.embed("health check");

      return {
        status: "healthy",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "cpu",
        gpu_available: false,
      };
    } catch (error) {
      logger.error("Local embedding health check failed:", error);
      return {
        status: "unavailable",
        model: this.config.model,
        dimension: this.config.dimension,
        device: "cpu",
        gpu_available: false,
      };
    }
  }

  private truncateAndNormalize(
    embedding: number[],
    targetDim: number,
  ): number[] {
    const truncated = embedding.slice(0, targetDim);

    // Re-normalize after truncation
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
