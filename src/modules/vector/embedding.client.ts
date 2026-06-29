/**
 * Embedding Client - Facade delegating to the active embedding provider.
 * Same public API as the original HTTP client for full backward compatibility.
 */

import logger from '../../config/logger.js';
import type { EmbeddingServiceHealth } from './vector.types.js';
import type { EmbeddingProvider } from './providers/provider.factory.js';
import { createEmbeddingProvider } from './providers/provider.factory.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

class EmbeddingClient {
  private provider: EmbeddingProvider | null = null;
  private initPromise: Promise<void> | null = null;
  private isHealthy: boolean = false;
  private lastHealthCheck: Date | null = null;
  private healthCheckInterval: number = 30000; // 30 seconds

  constructor() {
    logger.info('Embedding client created (provider will be initialized on first use)');
  }

  /**
   * Ensure the provider is initialized (lazy, once).
   */
  private async ensureInitialized(): Promise<EmbeddingProvider> {
    if (this.provider) return this.provider;

    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          this.provider = await createEmbeddingProvider();
          this.isHealthy = true;
        } catch (error) {
          this.initPromise = null; // Allow retry on next call
          throw error;
        }
      })();
    }

    await this.initPromise;
    return this.provider!;
  }

  /**
   * Check if the embedding service is healthy
   */
  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      const provider = await this.ensureInitialized();
      const health = await provider.checkHealth();
      this.isHealthy = health.status === 'healthy';
      this.lastHealthCheck = new Date();
      return health;
    } catch (error) {
      this.isHealthy = false;
      logger.error('Embedding health check failed:', error);
      return {
        status: 'unavailable',
        model: 'unknown',
        dimension: 0,
        device: 'unknown',
        gpu_available: false,
      };
    }
  }

  /**
   * Get cached health status or refresh if stale
   */
  async getHealthStatus(): Promise<EmbeddingServiceHealth> {
    const now = new Date();
    if (
      !this.lastHealthCheck ||
      now.getTime() - this.lastHealthCheck.getTime() > this.healthCheckInterval
    ) {
      return this.checkHealth();
    }

    if (this.provider) {
      return {
        status: this.isHealthy ? 'healthy' : 'unavailable',
        model: this.provider.providerName,
        dimension: 0,
        device: 'cached',
        gpu_available: false,
      };
    }

    return this.checkHealth();
  }

  /**
   * Wait for the embedding service to be ready
   */
  async waitForService(maxWaitMs: number = 60000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 2000;

    while (Date.now() - startTime < maxWaitMs) {
      const health = await this.checkHealth();
      if (health.status === 'healthy') {
        logger.info('Embedding service is ready');
        return true;
      }
      logger.info('Waiting for embedding service to be ready...');
      await this.sleep(checkInterval);
    }

    logger.error('Embedding service did not become ready in time');
    return false;
  }

  /**
   * Generate embedding for a single text
   */
  async embed(text: string, instruction?: string): Promise<number[]> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const provider = await this.ensureInitialized();
        return await provider.embed(text, instruction);
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;
        this.handleError(error, 'embed', isLastAttempt);

        if (!isLastAttempt) {
          await this.sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw new Error('Failed to generate embedding after max retries');
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedBatch(texts: string[], instruction?: string): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const provider = await this.ensureInitialized();
        return await provider.embedBatch(texts, instruction);
      } catch (error) {
        const isLastAttempt = attempt === MAX_RETRIES;
        this.handleError(error, 'embedBatch', isLastAttempt);

        if (!isLastAttempt) {
          await this.sleep(RETRY_DELAY_MS * attempt);
        }
      }
    }

    throw new Error('Failed to generate batch embeddings after max retries');
  }

  /**
   * Compute similarity between two texts
   */
  async computeSimilarity(text1: string, text2: string): Promise<number> {
    const [emb1, emb2] = await this.embedBatch([text1, text2]);
    return this.cosineSimilarity(emb1, emb2);
  }

  /**
   * Compute cosine similarity between two vectors
   */
  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    // For normalized vectors, norms should be 1, so just return dot product
    if (Math.abs(norm1 - 1) < 0.001 && Math.abs(norm2 - 1) < 0.001) {
      return dotProduct;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Handle and log errors
   */
  private handleError(error: unknown, operation: string, shouldThrow: boolean): void {
    if (error instanceof Error) {
      logger.error(`Embedding error during ${operation}: ${error.message}`);
      if (shouldThrow) {
        throw new Error(`Embedding service error: ${error.message}`);
      }
    } else {
      logger.error(`Unexpected error during ${operation}:`, error);
      if (shouldThrow) {
        throw error;
      }
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const embeddingClient = new EmbeddingClient();
export default embeddingClient;
