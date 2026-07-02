/**
 * Amazon Bedrock Embedding Provider
 * Uses Titan Embed Text v2 via the Bedrock Runtime API.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import logger from '../../../config/logger.js';
import { EmbeddingProvider } from './provider.factory.js';
import type { EmbeddingProviderConfig } from './provider.factory.js';
import type { EmbeddingServiceHealth } from '../vector.types.js';

interface BedrockCredentials {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

interface TitanEmbedResponse {
  embedding: number[];
}

const MAX_CONCURRENT = 10;

export class BedrockEmbeddingProvider extends EmbeddingProvider {
  readonly providerName = 'bedrock';
  private client!: BedrockRuntimeClient;

  constructor(config: EmbeddingProviderConfig, private credentials: BedrockCredentials) {
    super(config);
  }

  async initialize(): Promise<void> {
    const clientConfig: ConstructorParameters<typeof BedrockRuntimeClient>[0] = {
      region: this.credentials.region,
    };

    // Use explicit credentials if provided, otherwise fall back to default chain (IAM roles, etc.)
    if (this.credentials.accessKeyId && this.credentials.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: this.credentials.accessKeyId,
        secretAccessKey: this.credentials.secretAccessKey,
      };
    }

    this.client = new BedrockRuntimeClient(clientConfig);
    logger.info(
      `Bedrock embedding provider initialized with model: ${this.config.model}, region: ${this.credentials.region}`
    );
  }

  async embed(text: string, _instruction?: string): Promise<number[]> {
    const body = JSON.stringify({
      inputText: text,
      dimensions: this.config.dimension,
      normalize: true,
    });

    const command = new InvokeModelCommand({
      modelId: this.config.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body)
    ) as TitanEmbedResponse;

    return responseBody.embedding;
  }

  async embedBatch(texts: string[], instruction?: string): Promise<number[][]> {
    if (texts.length === 0) return [];

    // No native batch API — process concurrently with a concurrency limit
    const results: number[][] = new Array(texts.length);

    for (let i = 0; i < texts.length; i += MAX_CONCURRENT) {
      const chunk = texts.slice(i, i + MAX_CONCURRENT);
      const chunkResults = await Promise.all(
        chunk.map((text) => this.embed(text, instruction))
      );
      for (let j = 0; j < chunkResults.length; j++) {
        results[i + j] = chunkResults[j];
      }
    }

    return results;
  }

  async checkHealth(): Promise<EmbeddingServiceHealth> {
    try {
      await this.embed('health check');

      return {
        status: 'healthy',
        model: this.config.model,
        dimension: this.config.dimension,
        device: `bedrock-${this.credentials.region}`,
        gpu_available: true,
      };
    } catch (error) {
      logger.error('Bedrock embedding health check failed:', error);
      return {
        status: 'unavailable',
        model: this.config.model,
        dimension: this.config.dimension,
        device: `bedrock-${this.credentials.region}`,
        gpu_available: false,
      };
    }
  }
}
