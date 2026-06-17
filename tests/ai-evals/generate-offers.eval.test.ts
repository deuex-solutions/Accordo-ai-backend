import { describe, it, expect } from "vitest";
import { generateOffersNode } from "@/modules/chatbot/engine/graph/nodes/generate-offers";
import { HumanMessage } from "@langchain/core/messages";

describe("AI Eval: Generate Offers Node (generateOffersNode)", () => {
  it("should generate MESO options and populate counterOffer when decision is COUNTER", async () => {
    const config = {
      targetPrice: 800,
      maxAcceptablePrice: 1000,
      priceRange: 200,
      priority: "MEDIUM",
      paymentTermsMinDays: 15,
      paymentTermsMaxDays: 45,
      warrantyPeriodMonths: 12,
      partialDeliveryAllowed: true,
      weights: { targetUnitPrice: 50, paymentTermsDays: 30, warrantyPeriodMonths: 10, deliveryDate: 10 }
    };

    const state: any = {
      config,
      round: 1,
      decision: { action: "COUNTER" },
      parsedOffer: {
        totalPrice: 1200,
        paymentTermsDays: 10,
        deliveryDays: 30,
        warrantyMonths: 6
      },
      messages: [
        new HumanMessage({ content: "We can do $1200", id: "msg-1" })
      ],
      metadata: { lastParsedMessageId: "msg-1" }
    };

    const result = await generateOffersNode(state);

    // Verify MESO options are generated
    expect(result.mesoOptions).toBeDefined();
    expect(result.mesoOptions?.length).toBeGreaterThan(1);
    
    // Verify counterOffer is set to the first MESO option
    expect(result.counterOffer).toBeDefined();
    expect(result.counterOffer?.totalPrice).toBeDefined();
    expect(result.counterOffer?.totalPrice).toBeLessThan(1200);

    // Verify stallStatus
    expect(result.stallStatus).toBeDefined();
    expect(result.stallStatus?.isStalled).toBe(false);
  });

  it("should detect stalls when the same offer is passed multiple times", async () => {
    const config = {
      targetPrice: 800,
      maxAcceptablePrice: 1000,
      priceRange: 200,
      priority: "MEDIUM",
      paymentTermsMinDays: 15,
      paymentTermsMaxDays: 45,
      warrantyPeriodMonths: 12,
      partialDeliveryAllowed: true,
      weights: { targetUnitPrice: 50, paymentTermsDays: 30, warrantyPeriodMonths: 10, deliveryDate: 10 }
    };

    const state: any = {
      config,
      round: 4,
      decision: { action: "COUNTER" },
      parsedOffer: {
        totalPrice: 1200,
        paymentTermsDays: 10,
        deliveryDays: 30,
        warrantyMonths: 6
      },
      messages: [
        new HumanMessage({ content: "We can do $1200 and Net 30", id: "msg-1" }),
        new HumanMessage({ content: "Still $1200 but Net 45", id: "msg-2" }),
        new HumanMessage({ content: "Final $1200 and Net 60", id: "msg-3" })
      ],
      metadata: { lastParsedMessageId: "msg-3" }
    };

    const result = await generateOffersNode(state);

    expect(result.stallStatus).toBeDefined();
    // 3 rounds of the same offer should trigger stall
    expect(result.stallStatus?.isStalled).toBe(true);
    expect(result.stallStatus?.roundsWithoutProgress).toBeGreaterThanOrEqual(3);
  });
});
