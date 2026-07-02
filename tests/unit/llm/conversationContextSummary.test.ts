/**
 * Conversation context summary unit tests
 */

import { describe, it, expect } from "vitest";
import { buildConversationContextSummary } from "../../../src/llm/conversation-context-summary.js";

describe("buildConversationContextSummary", () => {
  it("returns empty when no prior messages", () => {
    expect(buildConversationContextSummary([], "₹")).toBe("");
  });

  it("builds structured + snippet context for prior turns", () => {
    const summary = buildConversationContextSummary(
      [
        {
          role: "VENDOR",
          content:
            "Hello, I'm submitting my quotation: ₹62,500, Net 30, 25-day delivery.",
          extractedOffer: {
            total_price: 62_500,
            payment_terms: "Net 30",
            delivery_days: 25,
          },
          counterOffer: null,
          decisionAction: null,
        },
        {
          role: "ACCORDO",
          content:
            "Good morning, thank you for your offer. We can work with ₹55,000 on Net 60.",
          extractedOffer: null,
          counterOffer: {
            total_price: 55_000,
            payment_terms: "Net 60",
          },
          decisionAction: "COUNTER",
        },
      ],
      "₹",
    );

    expect(summary).toContain("Structured history");
    expect(summary).toContain("₹62,500");
    expect(summary).toContain("₹55,000");
    expect(summary).toContain("Recent messages");
    expect(summary).toContain("Good morning");
  });

  it("excludes current vendor message when already persisted", () => {
    const current =
      "my final counter is 60000 net 60";

    const summary = buildConversationContextSummary(
      [
        {
          role: "VENDOR",
          content: "first offer 62500 net 30",
          extractedOffer: { total_price: 62_500, payment_terms: "Net 30" },
        },
        {
          role: "ACCORDO",
          content: "Good morning, thank you. We are at ₹55,000, Net 60.",
          counterOffer: { total_price: 55_000, payment_terms: "Net 60" },
          decisionAction: "COUNTER",
        },
        {
          role: "VENDOR",
          content: current,
          extractedOffer: { total_price: 60_000, payment_terms: "Net 60" },
        },
      ],
      "₹",
      { currentVendorMessage: current },
    );

    expect(summary).not.toContain("final counter");
    expect(summary).toContain("₹55,000");
  });

  it("includes current thread position for continuity", () => {
    const summary = buildConversationContextSummary(
      [
        {
          role: "VENDOR",
          content: "62500 net 30",
          extractedOffer: { total_price: 62_500, payment_terms: "Net 30" },
        },
        {
          role: "ACCORDO",
          content: "We are at ₹58,000, Net 45.",
          counterOffer: { total_price: 58_000, payment_terms: "Net 45" },
          decisionAction: "COUNTER",
        },
      ],
      "₹",
    );

    expect(summary).toContain("Current thread");
    expect(summary).toContain("₹58,000");
    expect(summary).toContain("₹62,500");
  });
});
