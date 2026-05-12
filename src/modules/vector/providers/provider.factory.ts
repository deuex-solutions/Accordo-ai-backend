/**
 * Embedding Provider Factory
 * Creates and initializes the appropriate embedding provider based on configuration.
 */

import env from "../../../config/env.js";
import logger from "../../../config/logger.js";
import type {
  EmbeddingProvider,
  EmbeddingProviderConfig,
} from "./embedding-provider.interface.js";

/** Default models per provider when EMBEDDING_MODEL is not set */
const DEFAULT_MODELS: Record<string, string> = {
  openai: "text-embedding-3-small",
  bedrock: "amazon.titan-embed-text-v2:0",
  local: "gpt-oss:20b",
};

/**
 * Create and initialize an embedding provider based on environment config.
 * Uses dynamic imports so unused providers are never loaded.
 */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
  const providerType = env.vector.embeddingProvider;
  const model =
    env.vector.embeddingModel ||
    DEFAULT_MODELS[providerType] ||
    DEFAULT_MODELS.local;
  const dimension = env.vector.embeddingDimension;
  const timeout = env.vector.embeddingTimeout;

  logger.info(
    `Creating embedding provider: ${providerType} (model: ${model}, dimension: ${dimension})`,
  );

  const baseConfig: EmbeddingProviderConfig = {
    model,
    dimension,
    timeout,
    maxBatchSize: 100,
  };

  let provider: EmbeddingProvider;

  switch (providerType) {
    case "openai": {
      const { OpenAIEmbeddingProvider } = await import("./openai.provider.js");
      provider = new OpenAIEmbeddingProvider(
        baseConfig,
        env.openai.apiKey || "",
      );
      break;
    }
    case "bedrock": {
      const { BedrockEmbeddingProvider } =
        await import("./bedrock.provider.js");
      provider = new BedrockEmbeddingProvider(baseConfig, {
        region: env.vector.awsRegion,
        accessKeyId: env.vector.awsAccessKeyId,
        secretAccessKey: env.vector.awsSecretAccessKey,
      });
      break;
    }
    case "local": {
      const { LocalEmbeddingProvider } = await import("./local.provider.js");
      provider = new LocalEmbeddingProvider(baseConfig);
      break;
    }
    default:
      throw new Error(
        `Unknown embedding provider: ${providerType}. Use 'openai', 'bedrock', or 'local'.`,
      );
  }

  await provider.initialize();
  logger.info(`Embedding provider '${providerType}' initialized successfully`);

  return provider;
}
