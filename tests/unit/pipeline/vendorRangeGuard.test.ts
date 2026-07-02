/**
 * Vendor range guard — do not leak internal min/max band to vendors.
 */

import { describe, it, expect } from "vitest";
import { leaksInternalPriceBand } from "../../../src/modules/chatbot/pipeline/vendor-range-guard.js";

describe("leaksInternalPriceBand", () => {
  it("flags explicit budget range with both bounds", () => {
    const text =
      "Our approximate budget range for the full order is ₹40,000 to ₹48,000.";
    expect(leaksInternalPriceBand(text, 40_000, 48_000, "INR")).toBe(true);
  });

  it("flags band phrases without numbers", () => {
    expect(
      leaksInternalPriceBand(
        "Please revisit within that band when you can.",
        40_000,
        48_000,
        "INR",
      ),
    ).toBe(true);
  });

  it("allows vendor-only price acknowledgment", () => {
    const text =
      "We've reviewed your total of ₹60,000. The price is above what we can accommodate.";
    expect(leaksInternalPriceBand(text, 40_000, 48_000, "INR")).toBe(false);
  });
});
