/**
 * Tests for detectVendorStyle() — the vendor-style detector added to
 * tone-detector.ts as part of the Apr 2026 humanization pass.
 *
 * detectVendorStyle is a pure deterministic function that extracts
 * humanization signals from the latest vendor message (and prior offers).
 */

import { describe, it, expect } from "vitest";
import {
  detectVendorStyle,
  type ToneMessage,
} from "../../../src/modules/chatbot/engine/tone-detector.js";

describe("detectVendorStyle – basics", () => {
  it("returns sane defaults on an empty message", () => {
    const result = detectVendorStyle("", []);
    expect(result.length).toBe(0);
    expect(result.hasGreeting).toBe(false);
    expect(result.hostility).toBe(false);
    expect(result.hasQuestion).toBe(false);
    expect(result.acceptanceDetected).toBe(false);
    expect(result.lastVendorPrice).toBeNull();
    expect(result.repeatedOfferCount).toBe(0);
  });

  it("computes word count for a normal message", () => {
    const result = detectVendorStyle(
      "Thanks for the proposal we will review and come back tomorrow.",
      [],
    );
    expect(result.length).toBe(11);
  });
});

describe("detectVendorStyle – formality", () => {
  it("scores formal messages above 0.6", () => {
    const result = detectVendorStyle(
      "Dear Sir, kindly find our revised proposal attached. Best regards.",
      [],
    );
    expect(result.formality).toBeGreaterThan(0.6);
  });

  it("scores casual messages below 0.4", () => {
    const result = detectVendorStyle(
      "hey, yeah we can do that — sounds cool, gotcha",
      [],
    );
    expect(result.formality).toBeLessThan(0.4);
  });
});

describe("detectVendorStyle – greetings", () => {
  it("flags hasGreeting for English greetings", () => {
    expect(detectVendorStyle("Hi team — quick update.", []).hasGreeting).toBe(
      true,
    );
    expect(
      detectVendorStyle("Good morning, here is the update.", []).hasGreeting,
    ).toBe(true);
  });

  it("flags hasGreeting for non-English greetings", () => {
    expect(
      detectVendorStyle("Namaste, here is our quote.", []).hasGreeting,
    ).toBe(true);
    expect(
      detectVendorStyle("Hola, gracias por el mensaje.", []).hasGreeting,
    ).toBe(true);
  });

  it("does NOT flag greeting when the message starts with substance", () => {
    expect(
      detectVendorStyle("Our final price is $26,000.", []).hasGreeting,
    ).toBe(false);
  });
});

describe("detectVendorStyle – hostility", () => {
  it("flags hostility for explicit rude language", () => {
    expect(
      detectVendorStyle("This price is a joke — are you serious?", [])
        .hostility,
    ).toBe(true);
    expect(
      detectVendorStyle("That offer is ridiculous and insulting.", [])
        .hostility,
    ).toBe(true);
  });

  it("does NOT flag hostility for firm but polite refusals", () => {
    expect(
      detectVendorStyle("Unfortunately we cannot go below $26,000.", [])
        .hostility,
    ).toBe(false);
  });
});

describe("detectVendorStyle – questions", () => {
  it("flags hasQuestion when message ends with ?", () => {
    expect(detectVendorStyle("Can you do Net 60?", []).hasQuestion).toBe(true);
  });

  it("does NOT flag hasQuestion for plain statements", () => {
    expect(
      detectVendorStyle("Our final price is $26,000.", []).hasQuestion,
    ).toBe(false);
  });
});

describe("detectVendorStyle – acceptance detection", () => {
  it("detects explicit acceptance phrases", () => {
    expect(
      detectVendorStyle("Ok, deal at $26,000.", []).acceptanceDetected,
    ).toBe(true);
    expect(
      detectVendorStyle("We accept your terms.", []).acceptanceDetected,
    ).toBe(true);
    expect(detectVendorStyle("Done.", []).acceptanceDetected).toBe(true);
  });

  it("does NOT confuse 'agreed pricing' with acceptance", () => {
    expect(
      detectVendorStyle(
        "Could you share the previously agreed pricing schedule for review?",
        [],
      ).acceptanceDetected,
    ).toBe(false);
  });
});

describe("detectVendorStyle – isNumberOnly", () => {
  it("flags isNumberOnly for short price-only messages", () => {
    expect(detectVendorStyle("$26,000", []).isNumberOnly).toBe(true);
    expect(detectVendorStyle("26000", []).isNumberOnly).toBe(true);
  });

  it("does NOT flag isNumberOnly for prose with a price", () => {
    expect(detectVendorStyle("Our price is $26,000.", []).isNumberOnly).toBe(
      false,
    );
  });
});

describe("detectVendorStyle – language detection", () => {
  it("detects English with confidence", () => {
    const r = detectVendorStyle(
      "Thank you for the proposal — we will review and respond tomorrow.",
      [],
    );
    expect(r.language).toBe("en");
    expect(r.languageConfidence).toBeGreaterThan(0.3);
  });

  it("detects Spanish from common stop-words", () => {
    const r = detectVendorStyle(
      "Hola, gracias por el mensaje. Por favor revise nuestra propuesta.",
      [],
    );
    expect(r.language).toBe("es");
  });

  it("returns 'und' on too-short input", () => {
    const r = detectVendorStyle("ok", []);
    expect(r.language).toBe("und");
  });
});

describe("detectVendorStyle – repeated offer count (escape-hatch trigger)", () => {
  function vendorMsg(content: string): ToneMessage {
    return { role: "VENDOR", content };
  }

  it("count is 1 for a fresh price", () => {
    const r = detectVendorStyle("Our price is $26,000.", []);
    expect(r.lastVendorPrice).toBe(26000);
    expect(r.repeatedOfferCount).toBe(1);
  });

  it("count is 2 when vendor restates the same price once", () => {
    const history = [vendorMsg("Our price is $26,000.")];
    const r = detectVendorStyle("Still $26,000 — final.", history);
    expect(r.repeatedOfferCount).toBe(2);
  });

  it("count is 3 when vendor restates the same price twice (trigger)", () => {
    const history = [
      vendorMsg("Our price is $26,000."),
      vendorMsg("Still $26,000 from our side."),
    ];
    const r = detectVendorStyle("$26,000 is the number.", history);
    expect(r.repeatedOfferCount).toBe(3);
  });

  it("chain breaks on a different price", () => {
    const history = [
      vendorMsg("Our price is $26,000."),
      vendorMsg("Now we can do $25,500."),
    ];
    const r = detectVendorStyle("Back to $26,000.", history);
    // Latest is $26,000 but prior was $25,500 → chain reset
    expect(r.repeatedOfferCount).toBe(1);
  });

  it("ignores prior vendor messages without a price (no chain break)", () => {
    const history = [
      vendorMsg("Our price is $26,000."),
      vendorMsg("Could you share the spec sheet?"),
    ];
    const r = detectVendorStyle("Still at $26,000.", history);
    expect(r.repeatedOfferCount).toBe(2);
  });

  it("uses exact-match (no tolerance) per spec — $25,999 ≠ $26,000", () => {
    const history = [vendorMsg("Our price is $26,000.")];
    const r = detectVendorStyle("Final at $25,999.", history);
    expect(r.repeatedOfferCount).toBe(1);
  });
});
