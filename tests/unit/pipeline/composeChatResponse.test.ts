/**
 * P0.3 — composeChatResponse unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { composeChatResponse } from "../../../src/modules/chatbot/pipeline/compose-chat-response.js";

vi.mock("../../../src/services/openai.service.js", () => ({
  generateCompletion: vi.fn(),
}));

import { generateCompletion } from "../../../src/services/openai.service.js";

const dealContext = {
  expectedPriceRange: { min: 35_000, max: 50_000 },
};

describe("composeChatResponse", () => {
  beforeEach(() => {
    vi.mocked(generateCompletion).mockResolvedValue({
      content:
        "Thanks for reaching out on this opportunity. We appreciate you connecting with us on this requisition and sharing your interest in partnering with us. To evaluate your proposal properly, could you share your best total price together with your preferred NET payment terms? That will help us compare options fairly and move the conversation forward constructively this week.",
      model: "test",
      fallbackUsed: false,
    });
  });

  it("uses LLM for ASK_CLARIFICATION partial offer", async () => {
    const result = await composeChatResponse({
      vendorMessage: "We can do ₹37,000.",
      classification: {
        type: "PARTIAL_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.89,
        extractedPrice: 37_000,
        extractedDays: null,
        route: "ASK_CLARIFICATION",
      },
      dealContext,
      currencyCode: "INR",
    });

    expect(result.fromLlm).toBe(true);
    expect(result.decisionAction).toBe("ASK_CLARIFY");
    expect(result.content.length).toBeGreaterThan(10);
  });

  it("returns deterministic fallback when LLM fails after retries", async () => {
    vi.mocked(generateCompletion).mockRejectedValue(
      new Error("Both OpenAI and Qwen3 fallback failed"),
    );

    const result = await composeChatResponse({
      vendorMessage: "Total price: ₹60,000 Net 30",
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: false,
        confidence: 0.95,
        extractedPrice: 60_000,
        extractedDays: 30,
        route: "SOFT_DECLINE",
      },
      dealContext: {
        expectedPriceRange: { min: 40_000, max: 48_000 },
        currencyCode: "INR",
      },
      currencyCode: "INR",
      pmNegotiationRound: 1,
    });

    expect(result.fromLlm).toBe(true);
    expect(result.decisionAction).toBe("SOFT_DECLINE");
    expect(result.content).toMatch(/^Good (morning|afternoon|evening)\./);
    expect(result.content).toContain("Thank you for your quotation");
    expect(result.content).toContain("₹60,000");
    expect(result.content).not.toContain("₹40,000");
    expect(result.content).not.toContain("₹48,000");
    expect(result.content).not.toContain("budget range");
    expect(result.content).not.toContain("₹400");
  });
});
