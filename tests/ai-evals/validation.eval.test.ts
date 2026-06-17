import { describe, it, expect } from "vitest";
import { validationNode } from "../../src/modules/chatbot/engine/graph/nodes/validation.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";
import { AIMessage } from "@langchain/core/messages";

describe("AI Eval: ValidationAgent", () => {
  it("should pass valid output and clean soft phrases", async () => {
    // "I am here to help" is a SOFT_PHRASE that should be stripped
    const rawContent = "I am here to help! We are happy to accept the offer at $10,000, and we will proceed with the agreement.";
    const mockState = {
      decision: { action: "ASK_CLARIFY" },
      config: { currency: "USD" },
      messages: [new AIMessage({ content: rawContent, id: "msg-1" })]
    } as unknown as NegotiationState;

    const result = await validationNode(mockState);
    expect(result.metadata?.validationStatus).toBe("PASSED_SANITIZED");
    expect(result.messages?.[0].content).toContain("We are happy to accept the offer at $10,000");
    expect(result.messages?.[0].content).not.toContain("I am here to help");
  });

  it("should fail on hard bans (utility leak)", async () => {
    const rawContent = "Based on our utility score, we can counter at $9,000.";
    const mockState = {
      decision: { action: "COUNTER" },
      config: { currency: "USD" },
      counterOffer: { totalPrice: 9000 },
      messages: [new AIMessage({ content: rawContent, id: "msg-2" })]
    } as unknown as NegotiationState;

    const result = await validationNode(mockState);
    expect(result.metadata?.validationFailed).toBe(true);
    expect(result.metadata?.validationError).toBe("banned_keyword_hard");
  });

  it("should fail when price is unauthorized in COUNTER", async () => {
    // The target price is 8000, but the text hallucinates 8500
    const rawContent = "Thank you for your proposal. We have reviewed the specifications and logistics, and our counter offer is $8,500 for the total package, which we believe is fair.";
    const mockState = {
      decision: { action: "COUNTER" },
      config: { currency: "USD" },
      counterOffer: { totalPrice: 8000 },
      messages: [new AIMessage({ content: rawContent, id: "msg-3" })]
    } as unknown as NegotiationState;

    const result = await validationNode(mockState);
    expect(result.metadata?.validationFailed).toBe(true);
    expect(result.metadata?.validationError).toBe("wrong_price");
  });
});
