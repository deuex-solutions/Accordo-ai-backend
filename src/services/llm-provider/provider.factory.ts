/**
 * LLM provider factory + lazy singleton.
 *
 * Reads LLM_PROVIDER once and returns the matching provider. Dynamic imports
 * keep unused provider deps (e.g. heavy Bedrock SDK in Phase B) out of the
 * boot path until the matching provider is actually requested.
 */

import env from "../../config/env.js";
import logger from "../../config/logger.js";
import { LlmProvider } from "./llm-provider.interface.js";
import type { LlmProviderConfig, LlmProviderName } from "./types.js";

const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  openai: "gpt-3.5-turbo",
  ollama: "llama3.1:8b",
  bedrock: "meta.llama3-3-70b-instruct-v1:0",
};

let cachedProvider: LlmProvider | null = null;
let cachedProviderName: LlmProviderName | null = null;
let initPromise: Promise<LlmProvider> | null = null;

function resolveProviderName(): LlmProviderName {
  const raw = (env.llm.provider || "openai").toLowerCase();
  if (raw === "openai" || raw === "ollama" || raw === "bedrock") return raw;
  logger.warn(
    { configured: raw },
    "[llm-provider] Unknown LLM_PROVIDER value; defaulting to openai",
  );
  return "openai";
}

function resolveModelForProvider(name: LlmProviderName): string {
  switch (name) {
    case "openai":
      return env.openai.model || DEFAULT_MODELS.openai;
    case "ollama":
      return env.llm.ollamaModel || env.llm.model || DEFAULT_MODELS.ollama;
    case "bedrock":
      return env.llm.bedrockModel || DEFAULT_MODELS.bedrock;
  }
}

function resolveTimeoutForProvider(name: LlmProviderName): number {
  switch (name) {
    case "openai":
      return 30000;
    case "ollama":
      return env.llm.timeout;
    case "bedrock":
      return 30000;
  }
}

async function build(name: LlmProviderName): Promise<LlmProvider> {
  const config: LlmProviderConfig = {
    model: resolveModelForProvider(name),
    timeoutMs: resolveTimeoutForProvider(name),
    maxRetries: 3,
  };

  logger.info(
    { provider: name, model: config.model, timeoutMs: config.timeoutMs },
    "[llm-provider] Creating LLM provider",
  );

  let provider: LlmProvider;
  switch (name) {
    case "openai": {
      const { OpenAIProvider } = await import("./openai.provider.js");
      provider = new OpenAIProvider(config);
      break;
    }
    case "ollama": {
      const { OllamaProvider } = await import("./ollama.provider.js");
      provider = new OllamaProvider(config);
      break;
    }
    case "bedrock": {
      const { BedrockProvider } = await import("./bedrock.provider.js");
      provider = new BedrockProvider(config);
      break;
    }
  }

  await provider.initialize();
  logger.info(
    { provider: name, model: config.model },
    "[llm-provider] LLM provider initialized",
  );

  return provider;
}

/**
 * Get the configured LLM provider (lazy singleton).
 * Repeated calls return the same instance for the lifetime of the process.
 */
export async function getLlmProvider(): Promise<LlmProvider> {
  if (cachedProvider) return cachedProvider;
  if (initPromise) return initPromise;

  const name = resolveProviderName();
  cachedProviderName = name;

  initPromise = build(name).then((p) => {
    cachedProvider = p;
    return p;
  });

  try {
    return await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

/**
 * Reset the cached provider — used by tests so each test can swap providers.
 * Not for production code paths.
 */
export function _resetLlmProviderForTests(): void {
  cachedProvider = null;
  cachedProviderName = null;
  initPromise = null;
}

export function getActiveProviderName(): LlmProviderName | null {
  return cachedProviderName;
}
