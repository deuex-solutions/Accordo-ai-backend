/**
 * renderValidatedNegotiationMessage — LLM-only, no template fallback
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderValidatedNegotiationMessage } from "../../../src/llm/render-negotiation-with-retry.js";
import { ValidationError } from "../../../src/llm/validate-llm-output.js";
import type { NegotiationIntent } from "../../../src/negotiation/intent/build-negotiation-intent.js";

vi.mock("../../../src/llm/persona-renderer.js", () => ({
  renderNegotiationMessage: vi.fn(),
}));

vi.mock("../../../src/llm/validate-llm-output.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/llm/validate-llm-output.js")
  >();
  return {
    ...actual,
    validateLlmOutput: vi.fn(),
  };
});

import { renderNegotiationMessage } from "../../../src/llm/persona-renderer.js";
import { validateLlmOutput } from "../../../src/llm/validate-llm-output.js";

const baseIntent: NegotiationIntent = {
  action: "COUNTER",
  vendorTone: "neutral",
  firmness: 0.55,
  commercialPosition: "within budget",
  allowedPrice: 56_500,
  currencySymbol: "₹",
  allowedPaymentTerms: "Net 60",
  allowedDelivery: null,
  acknowledgeConcerns: [],
};

describe("renderValidatedNegotiationMessage", () => {
  beforeEach(() => {
    vi.mocked(renderNegotiationMessage).mockReset();
    vi.mocked(validateLlmOutput).mockReset();
  });

  it("returns validated LLM content", async () => {
    vi.mocked(renderNegotiationMessage).mockResolvedValue({
      message: "We can offer ₹56,500 at Net 60.",
      fromLlm: true,
    });
    vi.mocked(validateLlmOutput).mockReturnValue(
      "We can offer ₹56,500 at Net 60.",
    );

    const result = await renderValidatedNegotiationMessage(
      baseIntent,
      "what best for net 60?",
    );

    expect(result.fromLlm).toBe(true);
    expect(result.content).toContain("₹56,500");
    expect(renderNegotiationMessage).toHaveBeenCalledTimes(1);
  });

  it("uses intent-faithful compose when validation retries are exhausted", async () => {
    vi.mocked(renderNegotiationMessage).mockResolvedValue({
      message: "Let us know your best price.",
      fromLlm: true,
    });
    vi.mocked(validateLlmOutput).mockImplementation((text: string) => {
      if (text.includes("56,500")) {
        return text;
      }
      throw new ValidationError("wrong_price", "missing required price");
    });

    const result = await renderValidatedNegotiationMessage(
      baseIntent,
      "what best for net 60?",
    );

    expect(result.source).toBe("intent_compose");
    expect(result.content).toContain("₹56,500");
    expect(result.content).toMatch(/Net\s*60/i);
    expect(renderNegotiationMessage).toHaveBeenCalledTimes(4);
  });
});
