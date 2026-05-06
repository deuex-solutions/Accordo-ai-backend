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
    ]);
  });

  it("returns an empty list for unknown deals", () => {
    expect(getPhrasings("ghost-deal")).toEqual([]);
  });

  it("dedupes the same fingerprint within a deal", () => {
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update today");
    recordPhrasing("deal-1", "COUNTER", "Thanks for the quick update tomorrow");
    // Same first-5-words → same fingerprint → only one entry
    expect(getPhrasings("deal-1")).toHaveLength(1);
  });

  it("isolates phrasings between different deals", () => {
    recordPhrasing("deal-A", "COUNTER", "Thanks for the update today");
    recordPhrasing("deal-B", "COUNTER", "Appreciate the proposal here today");
    expect(getPhrasings("deal-A")).toEqual([
      "COUNTER|thanks:for:the:update:today",
    ]);
    expect(getPhrasings("deal-B")).toEqual([
      "COUNTER|appreciate:the:proposal:here:today",
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
    expect(list[2]).toContain("good:to:hear:back:from");
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
