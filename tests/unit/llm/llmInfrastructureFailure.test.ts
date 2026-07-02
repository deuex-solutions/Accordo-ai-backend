import { describe, it, expect } from "vitest";
import { isLlmInfrastructureFailure } from "../../../src/llm/llm-infrastructure-failure.js";
import { ValidationError } from "../../../src/llm/validate-llm-output.js";

describe("isLlmInfrastructureFailure", () => {
  it("returns false for validation errors", () => {
    expect(
      isLlmInfrastructureFailure(
        new ValidationError("wrong_price", "missing price"),
      ),
    ).toBe(false);
  });

  it("returns true for provider outage messages", () => {
    expect(
      isLlmInfrastructureFailure(
        new Error("Both OpenAI and Qwen3 fallback failed"),
      ),
    ).toBe(true);
    expect(
      isLlmInfrastructureFailure(new Error("insufficient_quota")),
    ).toBe(true);
  });
});
