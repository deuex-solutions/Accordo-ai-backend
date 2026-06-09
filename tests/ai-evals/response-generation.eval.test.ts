import { describe, it, expect, vi } from "vitest";
import { responseGenerationNode } from "../../../src/modules/chatbot/engine/graph/nodes/response-generation.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";
import { HumanMessage } from "@langchain/core/messages";

// Mock the LLM service to avoid actual API calls and test the pipeline
vi.mock("../../../src/services/llm.service.js", () => ({
  chatCompletion: vi.fn().mockResolvedValue("Mocked PM response recognizing the situation and offering a counter.")
}));

describe("AI Eval: ResponseGenerationAgent", () => {
  it("should generate an AIMessage based on ACCEPT decision", async () => {
    const mockState = {
      round: 3,
      messages: [new HumanMessage("We can do 1000.")],
      config: { currency: "USD", accept_threshold: 0.7 },
      decision: { action: "ACCEPT", reasoning: "Price is good", utilityScore: 0.8 },
      parsedOffer: { totalPrice: 1000 },
      counterOffer: null
    } as unknown as NegotiationState;

    const result = await responseGenerationNode(mockState);
    expect(result.messages).toBeDefined();
    expect(result.messages![0]._getType()).toBe("ai");
    expect(result.messages![0].content).toContain("Mocked PM response");
  });

  it("should handle COUNTER decision properly", async () => {
    const mockState = {
      round: 2,
      messages: [new HumanMessage("My best price is 1200.")],
      config: { currency: "USD" },
      decision: { action: "COUNTER", reasoning: "Too high", utilityScore: 0.5 },
      parsedOffer: { totalPrice: 1200 },
      counterOffer: { totalPrice: 1000 }
    } as unknown as NegotiationState;

    const result = await responseGenerationNode(mockState);
    expect(result.messages).toBeDefined();
    expect(result.messages![0].content).toContain("Mocked PM response");
  });

  it("should handle empty state gracefully", async () => {
    const mockState = {} as NegotiationState;
    const result = await responseGenerationNode(mockState);
    expect(result.messages).toBeUndefined();
  });
});
