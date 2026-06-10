import { describe, it, expect } from "vitest";
import { recoveryProbeNode } from "../../../src/modules/chatbot/engine/graph/nodes/recovery-probe.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";

describe("AI Eval: RecoveryProbeAgent", () => {
  it("should not trigger recovery if not stalled", async () => {
    const mockState = {
      stallStatus: { isStalled: false, roundsWithoutProgress: 0, momentumTrend: "STABLE" }
    } as NegotiationState;

    const result = await recoveryProbeNode(mockState);
    expect(result.metadata).toBeUndefined();
  });

  it("should trigger automated nudge if stalled for 3 rounds with UP momentum", async () => {
    const mockState = {
      stallStatus: { isStalled: true, roundsWithoutProgress: 3, momentumTrend: "UP" },
      metadata: {}
    } as NegotiationState;

    const result = await recoveryProbeNode(mockState);
    expect(result.metadata?.recoveryStrategy).toBe("AUTOMATED_NUDGE");
    expect(result.metadata?.recoveryNudge).toContain("meet halfway");
  });

  it("should trigger value-add (payment terms) if stalled for 3 rounds with STABLE momentum", async () => {
    const mockState = {
      stallStatus: { isStalled: true, roundsWithoutProgress: 3, momentumTrend: "STABLE" },
      counterOffer: { totalPrice: 10000, paymentTermsDays: 30 },
      metadata: {}
    } as NegotiationState;

    const result = await recoveryProbeNode(mockState);
    expect(result.metadata?.recoveryStrategy).toBe("VALUE_ADD");
    expect(result.metadata?.recoveryNudge).toContain("extended payment terms");
    expect(result.counterOffer?.paymentTermsDays).toBe(60); // 30 + 30
  });

  it("should trigger deadline extension if stalled for 4 rounds", async () => {
    const mockState = {
      stallStatus: { isStalled: true, roundsWithoutProgress: 4, momentumTrend: "DOWN" },
      counterOffer: { totalPrice: 10000, deliveryDays: 10 },
      metadata: {}
    } as NegotiationState;

    const result = await recoveryProbeNode(mockState);
    expect(result.metadata?.recoveryStrategy).toBe("DEADLINE_EXTENSION");
    expect(result.counterOffer?.deliveryDays).toBe(25); // 10 + 15
  });

  it("should escalate if stalled for 5 rounds", async () => {
    const mockState = {
      stallStatus: { isStalled: true, roundsWithoutProgress: 5, momentumTrend: "STABLE" },
      decision: { action: "COUNTER", reasoning: "Countering", confidence: 0.8 },
      metadata: {}
    } as NegotiationState;

    const result = await recoveryProbeNode(mockState);
    expect(result.metadata?.recoveryStrategy).toBe("ESCALATE");
    expect(result.decision?.action).toBe("ESCALATE");
  });
});
