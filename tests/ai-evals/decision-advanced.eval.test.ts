import { describe, it, expect, vi } from "vitest";
import { decisionNode } from "@/modules/chatbot/engine/graph/nodes/decision";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";
import * as utility from "@/modules/chatbot/engine/weighted-utility";

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
    // Spy on utility calculator to force an ACCEPT recommendation despite the high price
    vi.spyOn(utility, "calculateWeightedUtilityFromResolved").mockReturnValueOnce({
      totalUtility: 0.9,
      totalUtilityPercent: 90,
      parameterUtilities: {},
      thresholds: { walkAway: 0.3, escalate: 0.6, accept: 0.8 },
      recommendation: "ACCEPT",
      recommendationReason: "Mocked ACCEPT"
    } as any);

    const mockState = {
      round: 1,
      // Add payment_terms to ensure legacy utility calculator doesn't skip it
      parsedOffer: { totalPrice: 2000, paymentTermsDays: 120, payment_terms: "Net 120" } as any,
      config: {
        total_price: { target: 1000, max_acceptable: 1500, weight: 10 },
        payment_terms: { target: 120, max_acceptable: 0, weight: 90 },
        accept_threshold: 0.5
      }
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("COUNTER");
    expect(result.decision?.reasoning).toContain("exceeds strict ceiling");
    vi.restoreAllMocks();
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

  // REGRESSION TESTS
  it("should handle completely empty config properties without crashing", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 1000 },
      config: {} // Missing everything
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    // Even with empty config, it should compute some utility or fallback to WAIT/COUNTER without crashing
    expect(result.decision).toBeDefined();
    expect(["COUNTER", "ACCEPT", "WALK_AWAY"]).toContain(result.decision?.action);
  });

  it("should escalate if maxRounds is breached using explicitly set maxRounds resolution", async () => {
    const mockState = {
      round: 6, // Greater than explicit 5
      parsedOffer: { totalPrice: 1000 },
      config: { max_rounds: 5 } 
    } as unknown as NegotiationState;

    const result = await decisionNode(mockState);
    expect(result.decision?.action).toBe("ESCALATE");
  });
});
