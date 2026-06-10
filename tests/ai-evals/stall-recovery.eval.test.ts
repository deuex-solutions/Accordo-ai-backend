import { describe, it, expect } from "vitest";
import { stallRecoveryNode } from "../../../src/modules/chatbot/engine/graph/nodes/stall-recovery.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";

describe("AI Eval: StallRecoveryAgent", () => {
  it("should not detect stall on early rounds", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 10000, paymentTermsDays: 30 },
      metadata: {}
    } as NegotiationState;

    const result = await stallRecoveryNode(mockState);
    expect(result.stallStatus?.isStalled).toBe(false);
    expect(result.stallStatus?.roundsWithoutProgress).toBe(0);
    expect(result.metadata?.parameterHistories).toBeDefined();
    expect(result.metadata?.parameterHistories.length).toBeGreaterThan(0);
  });

  it("should detect stall after 3 rounds of identical values with varying parameters", async () => {
    // Round 1 and 2 histories (Price is stuck at 10000, delivery is changing)
    const mockHistories = [
      {
        parameter: "price",
        values: [
          { round: 1, value: 10000, timestamp: new Date() },
          { round: 2, value: 10000, timestamp: new Date() }
        ]
      },
      {
        parameter: "delivery_days",
        values: [
          { round: 1, value: 10, timestamp: new Date() },
          { round: 2, value: 15, timestamp: new Date() }
        ]
      }
    ];

    // Round 3 state
    const mockState = {
      round: 3,
      parsedOffer: { totalPrice: 10000, deliveryDays: 20 }, // Price still stuck, delivery changed
      metadata: { parameterHistories: mockHistories }
    } as NegotiationState;

    const result = await stallRecoveryNode(mockState);
    
    expect(result.stallStatus?.isStalled).toBe(true);
    expect(result.stallStatus?.roundsWithoutProgress).toBe(3);
    expect(result.metadata?.stallRecoveryPrompt).toContain("10,000"); // Should contain the stalled value
  });

  it("should integrate momentum trend from intelligence layer", async () => {
    const mockState = {
      round: 1,
      parsedOffer: { totalPrice: 5000 },
      analysis: {
        behavior: { momentum: "DECELERATING" }
      },
      metadata: {}
    } as unknown as NegotiationState;

    const result = await stallRecoveryNode(mockState);
    expect(result.stallStatus?.momentumTrend).toBe("DOWN");
  });
});
