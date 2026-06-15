import { describe, it, expect } from "vitest";
import { mesoGenerationNode } from "@/modules/chatbot/engine/graph/nodes/meso-generation";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";

describe("AI Eval: MESOGenerationAgent", () => {
  it("should generate 3 equivalent-utility MESO options", async () => {
    const mockState = {
      round: 2,
      config: {
        targetPrice: 10000,
        maxAcceptablePrice: 15000,
        priceRange: 5000,
        priority: "MEDIUM",
        paymentTermsMinDays: 15,
        paymentTermsMaxDays: 45,
        warrantyPeriodMonths: 12,
        partialDeliveryAllowed: false,
        currency: "USD",
        weights: { price: 0.5, paymentTerms: 0.2, delivery: 0.2, warranty: 0.1 }
      },
      parsedOffer: { totalPrice: 14000, deliveryDays: 30 },
      analysis: { behavior: { momentum: "STABLE", concessionVelocity: "STEADY" } }
    } as unknown as NegotiationState;

    const result = await mesoGenerationNode(mockState);
    expect(result.mesoOptions).toBeDefined();
    expect(result.mesoOptions?.length).toBe(3);
    const labels = result.mesoOptions?.map(o => o.customParameters?.mesoLabel);
    expect(labels).toContain("Offer 1");
  });

  it("should handle missing config gracefully", async () => {
    const mockState = {} as NegotiationState;
    const result = await mesoGenerationNode(mockState);
    expect(result.mesoOptions).toBeUndefined();
  });

  it("should adjust target utility aggressively when momentum is ACCELERATING", async () => {
    const mockState = {
      round: 2,
      config: {
        targetPrice: 10000, maxAcceptablePrice: 15000, priceRange: 5000, priority: "MEDIUM",
        weights: { price: 0.5, paymentTerms: 0.2, delivery: 0.2, warranty: 0.1 }
      },
      parsedOffer: { totalPrice: 14000 },
      analysis: { behavior: { momentum: "ACCELERATING", concessionVelocity: "FAST" } }
    } as unknown as NegotiationState;

    const result = await mesoGenerationNode(mockState);
    expect(result.mesoOptions).toBeDefined();
    const priceFocused = result.mesoOptions?.find(o => o.customParameters?.mesoEmphasis?.includes('price'));
    expect(priceFocused).toBeDefined();
  });

  it("should safely return empty array if parsedOffer misses totalPrice", async () => {
    const mockState = {
      round: 2,
      config: { targetPrice: 10000, maxAcceptablePrice: 15000, priority: "MEDIUM" },
      parsedOffer: { totalPrice: null, paymentTermsDays: 30 }
    } as unknown as NegotiationState;

    const result = await mesoGenerationNode(mockState);
    expect(result.mesoOptions).toStrictEqual([]);
  });
});
