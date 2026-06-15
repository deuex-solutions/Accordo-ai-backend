import { describe, it, expect } from "vitest";
import { decideStrategyNode } from "@/modules/chatbot/engine/graph/nodes/decide-strategy";

describe("AI Eval: Decide Strategy Node (decideStrategyNode)", () => {
  const config = {
    priceQuantity: { targetUnitPrice: 800, maxAcceptablePrice: 1000 },
    priority: "MEDIUM",
    paymentTerms: { minDays: 15, maxDays: 45 },
    contractSla: { warrantyPeriod: "1 year" },
    delivery: { partialDelivery: { allowed: true } },
    parameterWeights: { targetUnitPrice: 50, paymentTermsDays: 30, warrantyPeriodMonths: 10, deliveryDate: 10 }
  };

  it("should decide to ACCEPT if vendor offer matches or beats target", async () => {
    const state: any = {
      config,
      round: 2,
      parsedOffer: {
        totalPrice: 800, // Matches target perfectly
        paymentTermsDays: 45, // Best terms
        deliveryDays: 10, // Good delivery
        warrantyMonths: 12 // Good warranty
      }
    };

    const result = await decideStrategyNode(state);

    expect(result.decision).toBeDefined();
    expect(result.decision?.action).toBe("ACCEPT");
    expect(result.decision?.utilityScore).toBeGreaterThanOrEqual(0.7);
  });

  it("should decide to COUNTER if vendor offer is in acceptable range but not target", async () => {
    const state: any = {
      config,
      round: 1,
      parsedOffer: {
        totalPrice: 950, // Between target (800) and max (1000)
        paymentTermsDays: 30,
        deliveryDays: 30,
        warrantyMonths: 6
      }
    };

    const result = await decideStrategyNode(state);

    expect(result.decision).toBeDefined();
    expect(result.decision?.action).toBe("COUNTER");
  });

  it("should decide to WALK_AWAY if price exceeds max acceptable after 10 rounds", async () => {
    const state: any = {
      config,
      round: 11,
      parsedOffer: {
        totalPrice: 1200, // Exceeds max (1000)
        paymentTermsDays: 10,
        deliveryDays: 30,
        warrantyMonths: 0
      }
    };

    const result = await decideStrategyNode(state);

    expect(result.decision).toBeDefined();
    expect(result.decision?.action).toBe("WALK_AWAY");
  });
});
