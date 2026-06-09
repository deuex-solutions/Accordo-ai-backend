import { describe, it, expect } from "vitest";
import { mesoGenerationNode } from "../../../src/modules/chatbot/engine/graph/nodes/meso-generation.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";

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
        weights: {
          price: 0.5,
          paymentTerms: 0.2,
          delivery: 0.2,
          warranty: 0.1
        }
      },
      parsedOffer: {
        totalPrice: 14000,
        deliveryDays: 30
      },
      analysis: {
        behavior: {
          momentum: "STABLE",
          concessionVelocity: "STEADY"
        }
      }
    } as unknown as NegotiationState;

    const result = await mesoGenerationNode(mockState);
    
    expect(result.mesoOptions).toBeDefined();
    expect(result.mesoOptions?.length).toBe(3);
    
    // Check that we have different tradeoffs
    const labels = result.mesoOptions?.map(o => o.customParameters?.mesoLabel);
    expect(labels).toContain("Offer 1");
    expect(labels).toContain("Offer 2");
    expect(labels).toContain("Offer 3");

    // Options should focus on different elements
    const emphases = result.mesoOptions?.map(o => o.customParameters?.mesoEmphasis);
    expect(emphases[0]).toContain("price"); // Offer 1 is price focused
    expect(emphases[1]).toContain("payment_terms"); // Offer 2 is terms focused

    // Utilities should be somewhat close (variance < 5%)
    const utilities = result.mesoOptions?.map(o => o.customParameters?.mesoUtility) as number[];
    const avg = utilities.reduce((a, b) => a + b, 0) / utilities.length;
    utilities.forEach(u => {
      expect(Math.abs(u - avg)).toBeLessThan(0.05); // Using 5% tolerance for test strictness
    });
  });

  it("should handle missing config gracefully", async () => {
    const mockState = {} as NegotiationState;
    const result = await mesoGenerationNode(mockState);
    expect(result.mesoOptions).toBeUndefined(); // Node just returns empty object if missing
  });
});
