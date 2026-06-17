import { describe, it, expect } from "vitest";
import { decisionNode } from "@/modules/chatbot/engine/graph/nodes/decision";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";

describe("AI Eval: DecisionAgent Foundation", () => {
  it("should trigger ACCEPT if price is below target", async () => {
    const mockState = {
      round: 2,
      config: { total_price: { target: 1000, max_acceptable: 1500 } },
      parsedOffer: { totalPrice: 950 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("ACCEPT");
  });

  it("should trigger ACCEPT if price is exactly target", async () => {
    const mockState = {
      round: 3,
      config: { total_price: { target: 1000, max_acceptable: 1500 } },
      parsedOffer: { totalPrice: 1000 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("ACCEPT");
  });

  it("should trigger COUNTER if price is above target", async () => {
    const mockState = {
      round: 2,
      config: { total_price: { target: 1000, max_acceptable: 1500 } },
      parsedOffer: { totalPrice: 1200 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("COUNTER");
  });

  it("should trigger ESCALATE if round is greater than 5", async () => {
    const mockState = {
      round: 6,
      config: { total_price: { target: 1000, max_acceptable: 1500 }, max_rounds: 5 },
      parsedOffer: { totalPrice: 1100 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("ESCALATE");
  });

  it("should handle missing price with WAIT", async () => {
    const mockState = {
      round: 1,
      config: { targetPrice: 1000 },
      parsedOffer: { totalPrice: null }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("WAIT");
  });

  // REGRESSION TESTS
  it("should handle missing config gracefully by returning null decision", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 1000 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision).toBeNull();
  });

  it("should handle missing parsedOffer gracefully by returning null decision", async () => {
    const mockState = {
      round: 1,
      config: { targetPrice: 1000 }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision).toBeNull();
  });
});
