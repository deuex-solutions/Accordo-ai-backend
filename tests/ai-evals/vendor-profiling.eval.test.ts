import { describe, it, expect } from "vitest";
import { vendorProfilingNode } from "@/modules/chatbot/engine/graph/nodes/vendor-profiling";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";

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

  // REGRESSION TESTS
  it("should handle malformed mesoSelections history gracefully without crashing", async () => {
    const mockState = {
      vendorId: "invalid-db-id", // Force DB or catch block
      mesoSelections: [ null, undefined, { wrongKey: "test" } ]
    } as any;

    const result = await vendorProfilingNode(mockState);
    expect(result.vendorProfile).toBeDefined();
    expect(result.vendorProfile.priceWeight).toBeDefined();
  });
});
