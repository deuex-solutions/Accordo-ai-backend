import { describe, it, expect } from "vitest";
import { vendorProfilingNode } from "../../../src/modules/chatbot/engine/graph/nodes/vendor-profiling.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";

describe("AI Eval: VendorProfilingAgent", () => {
  it("should generate a default preference profile when no history exists", async () => {
    const mockState = {
      vendorId: null, // No DB hit
      mesoSelections: []
    } as any;

    const result = await vendorProfilingNode(mockState);
    
    expect(result.vendorProfile).toBeDefined();
    expect(result.vendorProfile.priceWeight).toBe(0.5);
    expect(result.vendorProfile.termsWeight).toBe(0.5);
  });

  it("should learn preferences based on MESO selection history", async () => {
    const mockState = {
      vendorId: null, // No DB hit
      mesoSelections: [
        { selectedType: "price" },
        { selectedType: "price" },
        { selectedType: "terms" }
      ]
    } as any;

    const result = await vendorProfilingNode(mockState);
    
    expect(result.vendorProfile).toBeDefined();
    // Price was selected 2 out of 3 times, so weight should be > 0.5
    expect(result.vendorProfile.priceWeight).toBeGreaterThan(0.5);
    // Terms was selected 1 out of 3 times, weight is updated too
    expect(result.vendorProfile.termsWeight).toBeGreaterThan(0.5);
    expect(result.vendorProfile.lastSelectedOfferType).toBe("terms");
  });
});
