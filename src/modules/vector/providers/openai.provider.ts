/**
 * OpenAI Embedding Provider
 * Uses the OpenAI embeddings API with dimension reduction support.
 */

import OpenAI from 'openai';
import logger from '../../../config/logger.js';
import { EmbeddingProvider } from './provider.factory.js';
import type { EmbeddingProviderConfig } from './provider.factory.js';
import type { EmbeddingServiceHealth } from '../vector.types.js';

export class OpenAIEmbeddingProvider extends EmbeddingProvider {
  readonly providerName = 'openai';
  private client!: OpenAI;

  constructor(config: EmbeddingProviderConfig, private apiKey: string) {
    super(config);
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required for OpenAI embedding provider');
    }

    this.client = new OpenAI({ apiKey: this.apiKey });
    logger.info(`OpenAI embedding provider initialized with model: ${this.config.model}`);
  }

  async embed(text: string, _instruction?: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.config.model,
      input: text,
      dimensions: this.config.dimension,
    });

    return response.data[0].embedding;
  }

  async embedBatch(texts: string[], _instruction?: string): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    const chunkSize = this.config.maxBatchSize;

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const response = await this.client.embeddings.create({
        model: this.config.model,
        input: chunk,
        dimensions: this.config.dimension,
      });

      // Sort by index to preserve order
      const sorted = response.data.sort((a, b) => a.index - b.index);
      results.push(...sorted.map((d) => d.embedding));
    }

    return results;
  }

  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      await this.client.embeddings.create({
        model: this.config.model,
        input: 'health check',
        dimensions: this.config.dimension,
      });

      return {
        status: 'healthy',
        model: this.config.model,
        dimension: this.config.dimension,
        device: 'openai-api',
        gpu_available: true,
      };
    } catch (error) {
      logger.error('OpenAI embedding health check failed:', error);
      return {
        status: 'unavailable',
        model: this.config.model,
        dimension: this.config.dimension,
        device: 'openai-api',
        gpu_available: false,
      };
    }
  }
}
