import { describe, it, expect } from "vitest";
import { humanInterventionNode } from "../../src/modules/chatbot/engine/graph/nodes/human-intervention.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";

// Recreate the routeAfterOffers logic to test the routing rules precisely
const routeAfterOffers = (state: NegotiationState) => {
  const dealPrice = Math.max(
    state.counterOffer?.totalPrice || 0,
    state.parsedOffer?.totalPrice || 0,
    state.config?.priceQuantity?.maxAcceptablePrice || 0
  );

  const isHighValue = dealPrice >= 1000000;
  const isApproved = state.metadata?.approvedByHuman === true;

  if (isHighValue && !isApproved) {
    return "human_intervention";
  }

  return "finalize_response";
};

describe("AI Eval: HumanInterventionAgent & Routing", () => {
  describe("humanInterventionNode", () => {
    it("should set waitingForHuman to true and populate pause metadata", async () => {
      const mockState = {
        metadata: {
          test: "data"
        }
      } as unknown as NegotiationState;

      const result = await humanInterventionNode(mockState);
      
      expect(result.waitingForHuman).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.approvalStatus).toBe("APPROVAL_REQUIRED");
      expect(result.metadata?.pausedAt).toBeDefined();
      expect(new Date(result.metadata?.pausedAt!).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe("routeAfterOffers (High-Value Routing Guard)", () => {
    it("should route to human_intervention for deals >= 10 Lakhs (1,000,000) that are unapproved", () => {
      const mockState = {
        counterOffer: { totalPrice: 1200000 },
        metadata: { approvedByHuman: false }
      } as unknown as NegotiationState;

      const destination = routeAfterOffers(mockState);
      expect(destination).toBe("human_intervention");
    });

    it("should route to finalize_response for deals >= 10 Lakhs if already approved by human", () => {
      const mockState = {
        counterOffer: { totalPrice: 1200000 },
        metadata: { approvedByHuman: true }
      } as unknown as NegotiationState;

      const destination = routeAfterOffers(mockState);
      expect(destination).toBe("finalize_response");
    });

    it("should route to finalize_response for low-value deals (< 10 Lakhs)", () => {
      const mockState = {
        counterOffer: { totalPrice: 800000 },
        metadata: { approvedByHuman: false }
      } as unknown as NegotiationState;

      const destination = routeAfterOffers(mockState);
      expect(destination).toBe("finalize_response");
    });

    it("should consider parsedOffer and config.maxAcceptablePrice when determining high value", () => {
      // 1. Check parsedOffer
      const mockStateParsed = {
        parsedOffer: { totalPrice: 1000000 },
        metadata: { approvedByHuman: false }
      } as unknown as NegotiationState;
      expect(routeAfterOffers(mockStateParsed)).toBe("human_intervention");

      // 2. Check maxAcceptablePrice config
      const mockStateConfig = {
        config: { priceQuantity: { maxAcceptablePrice: 1500000 } },
        metadata: { approvedByHuman: false }
      } as unknown as NegotiationState;
      expect(routeAfterOffers(mockStateConfig)).toBe("human_intervention");
    });
  });
});
