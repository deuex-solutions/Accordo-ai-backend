import { describe, it, expect } from "vitest";
import {
  buildFirstPmOpeningPrefix,
  ensureFirstPmGreeting,
  hasNegotiatorGreeting,
  hasSocialSalutation,
} from "../../../src/llm/first-pm-greeting.js";

function kolkataAt(hour: number): Date {
  const hh = String(hour).padStart(2, "0");
  return new Date(`2026-07-02T${hh}:00:00+05:30`);
}

describe("first-pm-greeting", () => {
  it("requires social salutation, not thank-you alone", () => {
    expect(hasSocialSalutation("Thank you for your quotation.")).toBe(false);
    expect(hasNegotiatorGreeting("Thank you for your quotation.")).toBe(false);
    expect(hasSocialSalutation("Good morning. Thank you for your quotation.")).toBe(
      true,
    );
  });

  it("buildFirstPmOpeningPrefix combines salutation and acknowledgment", () => {
    expect(buildFirstPmOpeningPrefix(0, kolkataAt(9))).toBe(
      "Good morning. Thank you for your quotation and for sharing the details. ",
    );
    expect(buildFirstPmOpeningPrefix(0, kolkataAt(14))).toMatch(
      /^Good afternoon\. Thank you for your quotation/,
    );
  });

  it("prepends salutation + acknowledgment when missing on round 1", () => {
    const out = ensureFirstPmGreeting(
      "From our side we can work with ₹55,000 total, Net 30.",
      1,
      kolkataAt(9),
    );
    expect(out).toMatch(/^Good morning\. Thank you for your quotation/);
    expect(out).toContain("₹55,000");
  });

  it("prepends salutation only when thank-you opener lacks salutation", () => {
    const out = ensureFirstPmGreeting(
      "Thank you for your quotation. After internal review, our counter is ₹54,000.",
      1,
      kolkataAt(9),
    );
    expect(out).toMatch(
      /^Good morning\. Thank you for your quotation\. After internal review/,
    );
  });

  it("does not double-greet when salutation already present", () => {
    const original =
      "Good afternoon. Thank you for your quotation. Our counter is ₹55,000.";
    expect(ensureFirstPmGreeting(original, 1, kolkataAt(14))).toBe(original);
  });

  it("skips on round 2+", () => {
    const original = "We can hold at ₹55,000 on Net 30.";
    expect(ensureFirstPmGreeting(original, 2)).toBe(original);
  });

  it("uses acknowledgment only when prior PM welcome was sent", () => {
    const out = ensureFirstPmGreeting(
      "From our side we can work with ₹55,000 total, Net 30.",
      1,
      kolkataAt(9),
      true,
    );
    expect(out).toMatch(/^Thank you for your quotation/);
    expect(out).not.toMatch(/^Good morning/);
    expect(out).toContain("₹55,000");
  });
});
