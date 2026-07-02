/**
 * Detect LLM provider outages (OpenAI quota, Ollama down) vs validation retries.
 * Used to fail fast into intent-faithful compose instead of burning 4 slow retry loops.
 */

import { ValidationError } from "./validate-llm-output.js";

export function isLlmInfrastructureFailure(error: unknown): boolean {
  if (error instanceof ValidationError) {
    return false;
  }

  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes("Both OpenAI and Qwen3") ||
    msg.includes("insufficient_quota") ||
    msg.includes("Failed to get response from LLM") ||
    msg.includes("No API key configured") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ETIMEDOUT")
  );
}
