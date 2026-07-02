/**
 * Tests for phrasing-history.ts — in-memory LRU cache used to avoid
 * repeating the same opener/hedge across rounds in a single deal.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildFingerprint,
  recordPhrasing,
  getPhrasings,
  hasRecentPhrasing,
  safeRewriteOpener,
  _resetPhrasingHistoryForTests,
} from "../../../src/llm/phrasing-history.js";

describe("buildFingerprint", () => {
  it("uses first 5 lowercased words + action", () => {
    expect(
      buildFingerprint(
        "COUNTER",
        "Thanks for the quick update — counter is $95K",
      ),
    ).toBe("COUNTER|thanks:for:the:quick:update");
  });

  it("strips punctuation when building fingerprint", () => {
    expect(
      buildFingerprint("ACCEPT", "Done! Accepted, thanks for the partnership."),
    ).toBe("ACCEPT|done:accepted:thanks:for:the");
  });

  it("collapses whitespace and is case-insensitive", () => {
    const a = buildFingerprint("MESO", "We have prepared three options today");
    const b = buildFingerprint(
      "MESO",
      "we   HAVE prepared three OPTIONS today",
    );
    expect(a).toBe("MESO|we:have:prepared:three:options");
    expect(b).toBe("MESO|we:have:prepared:three:options");
  });

  it("handles short messages (< 5 words)", () => {
    expect(buildFingerprint("ACCEPT", "Done")).toBe("ACCEPT|done");
  });

  it("distinguishes messages that share only the first 3 words", () => {
    const a = buildFingerprint("COUNTER", "Thank you for your proposal");
    const b = buildFingerprint("COUNTER", "Thank you for coming back");
    expect(a).not.toBe(b);
  });
});

describe("recordPhrasing / getPhrasings", () => {
  beforeEach(() => {
    _resetPhrasingHistoryForTests();
  });

  it("records and retrieves a fingerprint", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update today");
    expect(getPhrasings("deal-1")).toEqual([
      "COUNTER|thanks:for:the:quick:update",
      "OPENER|COUNTER|thanks:for:the",
    ]);
  });

  it("returns an empty list for unknown deals", () => {
    expect(getPhrasings("ghost-deal")).toEqual([]);
  });

  it("dedupes the same fingerprint within a deal", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update today");
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update tomorrow");
    // Same first-5-words → same fingerprint → only one entry
    expect(getPhrasings("deal-1")).toHaveLength(2);
  });

  it("isolates phrasings between different deals", () => {
    recordPhrasing("deal-A", "COUNTER", "Thanks for the update today");
    recordPhrasing("deal-B", "COUNTER", "Appreciate the proposal here today");
    expect(getPhrasings("deal-A")).toEqual([
      "COUNTER|thanks:for:the:update:today",
      "OPENER|COUNTER|thanks:for:the",
    ]);
    expect(getPhrasings("deal-B")).toEqual([
      "COUNTER|appreciate:the:proposal:here:today",
      "OPENER|COUNTER|appreciate:the:proposal",
    ]);
  });

  it("preserves order from oldest to newest", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for sharing the update today");
    recordPhrasing(
      "deal-1",
      "COUNTER",
      "Appreciate the quick turnaround here folks",
    );
    recordPhrasing("deal-1", "COUNTER", "Good to hear back from you");
    const list = getPhrasings("deal-1");
    expect(list[0]).toContain("thanks:for:sharing:the:update");
    expect(list[4]).toContain("good:to:hear:back:from");
  });

  it("hasRecentPhrasing returns true when fingerprint already used", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the update today");
    expect(
      hasRecentPhrasing("deal-1", "COUNTER", "Thanks for the update today!"),
    ).toBe(true);
    expect(
      hasRecentPhrasing("deal-1", "COUNTER", "Appreciate the proposal here"),
    ).toBe(false);
  });

  it("ignores empty inputs without throwing", () => {
    recordPhrasing("", "COUNTER", "anything");
    recordPhrasing("deal-1", "COUNTER", "");
    expect(getPhrasings("deal-1")).toEqual([]);
  });
});

describe("safeRewriteOpener", () => {
  beforeEach(() => {
    _resetPhrasingHistoryForTests();
  });

  it("returns original when rewrite would drop required price", () => {
    const dealId = "deal-price-guard";
    const original =
      "From our side, we can work with ₹56,500 with Net 60. Thanks for sharing.";

    recordPhrasing(
      dealId,
      "COUNTER",
      "From our side, we can work with ₹55,000 with Net 45. Appreciate the update.",
    );

    const result = safeRewriteOpener(dealId, "COUNTER", original, {
      requiredPrice: 56_500,
      currencySymbol: "₹",
    });

    expect(result).toBe(original);
    expect(result).toContain("₹56,500");
  });

  it("allows rewrite when price remains in the body", () => {
    const dealId = "deal-price-ok";
    const original =
      "Thanks for the update. From our side, we can work with ₹57,500 at Net 60.";

    recordPhrasing(
      dealId,
      "COUNTER",
      "Thanks for the update. From our side, we can work with ₹56,000 at Net 45.",
    );

    const result = safeRewriteOpener(dealId, "COUNTER", original, {
      requiredPrice: 57_500,
      currencySymbol: "₹",
    });

    expect(result).not.toBe(original);
    expect(result).toContain("₹57,500");
  });
});
