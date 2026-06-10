import { describe, it, expect } from "vitest";
import { decisionNode } from "../../../src/modules/chatbot/engine/graph/nodes/decision.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";

describe("AI Eval: DecisionAgent Advanced", () => {
  it("should enforce WALK_AWAY logic when utility is below threshold", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 50000, paymentTermsDays: 0 }, // Terrible offer
      config: {
        total_price: { target: 1000, max_acceptable: 1500 },
        walkaway_threshold: 0.3
      }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("WALK_AWAY");
    expect(result.decision?.utilityScore).toBeLessThan(0.3);
  });

  it("should enforce STRICT CEILING guard, forcing COUNTER even if utility says ACCEPT", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 2000, paymentTermsDays: 120 }, // Great payment terms to boost utility, but price is above ceiling
      config: {
        total_price: { target: 1000, max_acceptable: 1500, weight: 10 },
        payment_terms: { weight: 90, options: ["Net 120"] }
      }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("COUNTER");
    expect(result.decision?.reasoning).toContain("exceeds strict ceiling");
  });

  it("should ACCEPT when utility is high and price is below ceiling", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 900, paymentTermsDays: 90 }, // Perfect offer
      config: {
        total_price: { target: 1000, max_acceptable: 1500 },
        accept_threshold: 0.7
      }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("ACCEPT");
    expect(result.decision?.utilityScore).toBeGreaterThanOrEqual(0.7);
  });
});
