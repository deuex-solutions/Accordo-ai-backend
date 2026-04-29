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
  _resetPhrasingHistoryForTests,
} from "../../../src/llm/phrasing-history.js";

describe("buildFingerprint", () => {
  it("uses first 3 lowercased words + action", () => {
    expect(
      buildFingerprint(
        "COUNTER",
        "Thanks for the quick update — counter is $95K",
      ),
    ).toBe("COUNTER|thanks:for:the");
  });

  it("strips punctuation when building fingerprint", () => {
    expect(
      buildFingerprint("ACCEPT", "Done! Accepted, thanks for the partnership."),
    ).toBe("ACCEPT|done:accepted:thanks");
  });

  it("collapses whitespace and is case-insensitive", () => {
    const a = buildFingerprint("MESO", "We have prepared three options");
    const b = buildFingerprint("MESO", "we   HAVE prepared options for you");
    expect(a).toBe("MESO|we:have:prepared");
    expect(b).toBe("MESO|we:have:prepared");
  });

  it("handles short messages (< 3 words)", () => {
    expect(buildFingerprint("ACCEPT", "Done")).toBe("ACCEPT|done");
  });
});

describe("recordPhrasing / getPhrasings", () => {
  beforeEach(() => {
    _resetPhrasingHistoryForTests();
  });

  it("records and retrieves a fingerprint", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update");
    expect(getPhrasings("deal-1")).toEqual(["COUNTER|thanks:for:the"]);
  });

  it("returns an empty list for unknown deals", () => {
    expect(getPhrasings("ghost-deal")).toEqual([]);
  });

  it("dedupes the same fingerprint within a deal", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update");
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick reply");
    // Same first-3-words → same fingerprint → only one entry
    expect(getPhrasings("deal-1")).toHaveLength(1);
  });

  it("isolates phrasings between different deals", () => {
    recordPhrasing("deal-A", "COUNTER", "Thanks for the update");
    recordPhrasing("deal-B", "COUNTER", "Appreciate the proposal here");
    expect(getPhrasings("deal-A")).toEqual(["COUNTER|thanks:for:the"]);
    expect(getPhrasings("deal-B")).toEqual(["COUNTER|appreciate:the:proposal"]);
  });

  it("preserves order from oldest to newest", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for sharing the update");
    recordPhrasing("deal-1", "COUNTER", "Appreciate the quick turnaround here");
    recordPhrasing("deal-1", "COUNTER", "Good to hear back from you");
    const list = getPhrasings("deal-1");
    expect(list[0]).toContain("thanks:for:sharing");
    expect(list[2]).toContain("good:to:hear");
  });

  it("hasRecentPhrasing returns true when fingerprint already used", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the update");
    expect(hasRecentPhrasing("deal-1", "COUNTER", "Thanks for the same")).toBe(
      true,
    );
    expect(
      hasRecentPhrasing("deal-1", "COUNTER", "Appreciate the proposal"),
    ).toBe(false);
  });

  it("ignores empty inputs without throwing", () => {
    recordPhrasing("", "COUNTER", "anything");
    recordPhrasing("deal-1", "COUNTER", "");
    expect(getPhrasings("deal-1")).toEqual([]);
  });
});
