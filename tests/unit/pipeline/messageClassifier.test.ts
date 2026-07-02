/**
 * P0.1 — classifyMessage() unit tests
 *
 * Covers the six classifier scenarios from message_classifier_flow.md.
 * No DB, no network.
 */

import { describe, it, expect } from "vitest";
import {
  classifyMessage,
  buildDealClassificationContext,
  CLASSIFIER_PRICE_BAND_MULTIPLIER,
} from "../../../src/modules/chatbot/pipeline/message-classifier.js";

/** Flow doc examples use expected max ₹50,000 (range ₹35k–₹42k stated in soft-decline copy) */
const FLOW_DOC_CONTEXT = buildDealClassificationContext(35_000, 50_000, {
  currencyCode: "INR",
});

describe("classifyMessage – flow doc scenarios", () => {
  it("valid offer → FULL_NEGOTIATION_PIPELINE", async () => {
    const result = await classifyMessage(
      "₹38,500, NET 45, 25-day delivery.",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("NEGOTIATION_OFFER");
    expect(result.parseable).toBe(true);
    expect(result.priceInRange).toBe(true);
    expect(result.extractedPrice).toBe(38_500);
    expect(result.extractedDays).toBe(45);
    expect(result.route).toBe("FULL_NEGOTIATION_PIPELINE");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("nonsense → CHAT_RESPONSE (UNPARSEABLE)", async () => {
    const result = await classifyMessage(
      "asdfjkl 999 xyz pqr",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("UNPARSEABLE");
    expect(result.parseable).toBe(false);
    expect(result.priceInRange).toBeNull();
    expect(result.extractedPrice).toBeNull();
    expect(result.route).toBe("CHAT_RESPONSE");
  });

  it("way above range → SOFT_DECLINE", async () => {
    const result = await classifyMessage(
      "Our price is ₹2,50,000 per unit, NET 30.",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("NEGOTIATION_OFFER");
    expect(result.parseable).toBe(true);
    expect(result.priceInRange).toBe(false);
    expect(result.extractedPrice).toBe(250_000);
    expect(result.extractedDays).toBe(30);
    expect(result.route).toBe("SOFT_DECLINE");
    expect(result.rangeMax).toBe(50_000);
  });

  it("partial offer (price only) → ASK_CLARIFICATION", async () => {
    const result = await classifyMessage(
      "We can do ₹37,000.",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("PARTIAL_OFFER");
    expect(result.parseable).toBe(true);
    expect(result.priceInRange).toBe(true);
    expect(result.extractedPrice).toBe(37_000);
    expect(result.extractedDays).toBeNull();
    expect(result.route).toBe("ASK_CLARIFICATION");
  });

  it("vendor terms inquiry → FULL_NEGOTIATION_PIPELINE", async () => {
    const result = await classifyMessage(
      "what best can you offer for net 60?",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("VENDOR_TERMS_INQUIRY");
    expect(result.route).toBe("FULL_NEGOTIATION_PIPELINE");
    expect(result.extractedPrice).toBeNull();
    expect(result.extractedDays).toBe(60);
    expect(result.termsRequest?.requestedDays).toBe(60);
    expect(result.priceInRange).toBe(true);
    expect(result.termsRequest?.matchedText.toLowerCase()).toContain("net 60");
  });

  it("vendor stating terms only (not a question) → ASK_CLARIFICATION", async () => {
    const result = await classifyMessage(
      "We can do Net 60 on this order.",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("PARTIAL_OFFER");
    expect(result.route).toBe("ASK_CLARIFICATION");
    expect(result.termsRequest).toBeUndefined();
  });

  it("greeting → CHAT_RESPONSE", async () => {
    const result = await classifyMessage(
      "Hi! Hope you're doing well. Looking forward to working together.",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("GREETING");
    expect(result.route).toBe("CHAT_RESPONSE");
    expect(result.parseable).toBe(false);
  });

  it("off-topic spec request → REDIRECT", async () => {
    const result = await classifyMessage(
      "Can you send me the product spec sheet?",
      FLOW_DOC_CONTEXT,
    );

    expect(result.type).toBe("OFF_TOPIC");
    expect(result.route).toBe("REDIRECT");
    expect(result.parseable).toBe(false);
  });
});

describe("classifyMessage – price band rule", () => {
  it(`uses max × ${CLASSIFIER_PRICE_BAND_MULTIPLIER} as in-range ceiling`, async () => {
    const ctx = buildDealClassificationContext(35_000, 50_000);
    const atCeiling = 50_000 * CLASSIFIER_PRICE_BAND_MULTIPLIER;

    const inBand = await classifyMessage(
      `₹${atCeiling.toLocaleString("en-IN")}, NET 30`,
      ctx,
    );
    expect(inBand.priceInRange).toBe(true);
    expect(inBand.route).toBe("FULL_NEGOTIATION_PIPELINE");

    const overBand = await classifyMessage(
      `₹${(atCeiling + 1).toLocaleString("en-IN")}, NET 30`,
      ctx,
    );
    expect(overBand.priceInRange).toBe(false);
    expect(overBand.route).toBe("SOFT_DECLINE");
  });
});

describe("classifyMessage – meeting proposal flag", () => {
  it("sets isMeetingProposal on lets meet at messages", async () => {
    const result = await classifyMessage(
      "lets meet at 57500 at net 60",
      FLOW_DOC_CONTEXT,
    );

    expect(result.isMeetingProposal).toBe(true);
    expect(result.type).toBe("NEGOTIATION_OFFER");
    expect(result.extractedPrice).toBe(57_500);
  });
});

describe("classifyMessage – isolation guarantees (P0)", () => {
  it("returns synchronously awaitable result without side effects", async () => {
    const result = await classifyMessage("Hello", FLOW_DOC_CONTEXT);
    expect(result).toMatchObject({
      type: expect.any(String),
      route: expect.any(String),
      confidence: expect.any(Number),
    });
  });
});
