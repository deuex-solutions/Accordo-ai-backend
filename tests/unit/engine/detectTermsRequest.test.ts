/**
 * Tests for detectTermsRequest() (Apr 2026)
 *
 * Detects when a vendor is asking about a specific payment-terms scenario
 * rather than stating an offer. The chatbot.service.ts override uses this
 * to honor the vendor's requested terms in the counter (instead of letting
 * the engine pick whatever terms maximize utility).
 *
 * Replays the £418,900 / Net 75 bug: vendor asked "what's your best offer
 * for net 60?" and the AI countered with Net 75. Detection must catch the
 * "Net 60" in question form so the override can apply.
 */

import { describe, it, expect } from "vitest";
import { detectTermsRequest } from "../../../src/modules/chatbot/engine/parse-offer.js";

describe("detectTermsRequest – question patterns", () => {
  it("detects 'what is your best offer for net 60?'", () => {
    const r = detectTermsRequest("What is your best offer for net 60?");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(60);
  });

  it("detects 'can you do net 30?'", () => {
    const r = detectTermsRequest("can you do net 30?");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(30);
  });

  it("detects 'price for net 90?'", () => {
    const r = detectTermsRequest("price for net 90?");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(90);
  });

  it("detects 'what would your counter be on net 45'", () => {
    const r = detectTermsRequest("what would your counter be on net 45");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(45);
  });

  it("detects shorthand 'do you accept n60?'", () => {
    const r = detectTermsRequest("do you accept n60?");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(60);
  });
});

describe("detectTermsRequest – non-question messages return null", () => {
  it("returns null for a plain offer 'our price is $5000 net 30'", () => {
    expect(detectTermsRequest("Our price is $5000 net 30")).toBeNull();
  });

  it("returns null for affirmation 'ok, deal at net 60'", () => {
    expect(detectTermsRequest("ok, deal at net 60")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectTermsRequest("")).toBeNull();
  });

  it("returns null for question without terms", () => {
    expect(detectTermsRequest("can we close this today?")).toBeNull();
  });

  it("returns null for terms without question intent", () => {
    expect(detectTermsRequest("Final offer: $5000 with net 30")).toBeNull();
  });
});

describe("detectTermsRequest – edge cases", () => {
  it("returns matchedText preserving the matched fragment", () => {
    const r = detectTermsRequest("Can you do net 60 instead?");
    expect(r).not.toBeNull();
    expect(r!.matchedText.toLowerCase()).toContain("net 60");
  });

  it("ignores numbers outside payment-terms range", () => {
    // "for 200" isn't payment terms (200 days exceeds typical range)
    const r = detectTermsRequest("can you ship for 200 units?");
    expect(r).toBeNull();
  });

  it("treats prepositional 'on net X' as a request even without ?", () => {
    const r = detectTermsRequest("Best price you can do on net 60");
    expect(r).not.toBeNull();
    expect(r!.requestedDays).toBe(60);
  });
});
