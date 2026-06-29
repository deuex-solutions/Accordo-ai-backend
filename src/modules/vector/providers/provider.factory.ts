/**
 * Embedding Provider Factory & Base Interfaces
 */

import env from '../../../config/env.js';
import logger from '../../../config/logger.js';
import type { EmbeddingServiceHealth } from '../vector.types.js';

export interface EmbeddingProviderConfig {
  model: string;
  dimension: number;
  timeout: number;
  maxBatchSize: number;
}

export abstract class EmbeddingProvider {
  abstract readonly providerName: string;
  protected config: EmbeddingProviderConfig;

  constructor(config: EmbeddingProviderConfig) {
    this.config = config;
  }

  abstract initialize(): Promise<void>;
  abstract embed(text: string, instruction?: string): Promise<number[]>;
  abstract embedBatch(texts: string[], instruction?: string): Promise<number[][]>;
  abstract checkHealth(): Promise<EmbeddingServiceHealth>;
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'text-embedding-3-small',
  bedrock: 'amazon.titan-embed-text-v2:0',
  local: 'Xenova/bge-large-en-v1.5',
};

export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
  const providerType = env.vector.embeddingProvider;
  const model = env.vector.embeddingModel || DEFAULT_MODELS[providerType] || DEFAULT_MODELS.local;
  const dimension = env.vector.embeddingDimension;
  const timeout = env.vector.embeddingTimeout;

  logger.info(`Creating embedding provider: ${providerType} (model: ${model}, dimension: ${dimension})`);

  const baseConfig: EmbeddingProviderConfig = {
    model,
    dimension,
    timeout,
    maxBatchSize: 100,
  };

  let provider: EmbeddingProvider;

  switch (providerType) {
    case 'openai': {
      const { OpenAIEmbeddingProvider } = await import('./openai.provider.js');
      provider = new OpenAIEmbeddingProvider(baseConfig, env.openai.apiKey || '');
      break;
    }
    case 'bedrock': {
      const { BedrockEmbeddingProvider } = await import('./bedrock.provider.js');
      provider = new BedrockEmbeddingProvider(baseConfig, {
        region: env.vector.awsRegion,
        accessKeyId: env.vector.awsAccessKeyId,
        secretAccessKey: env.vector.awsSecretAccessKey,
      });
      break;
    }
    case 'local': {
      const { LocalEmbeddingProvider } = await import('./local.provider.js');
      provider = new LocalEmbeddingProvider(baseConfig);
      break;
    }
    default:
      throw new Error(`Unknown embedding provider: ${providerType}. Use 'openai', 'bedrock', or 'local'.`);
  }

  await provider.initialize();
  logger.info(`Embedding provider '${providerType}' initialized successfully`);

  return provider;
}
