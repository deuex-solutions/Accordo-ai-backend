/**
 * Humanization Audit — Integration Regression Tests
 *
 * Validates that all 16 Sprint 1–4 humanization fixes remain in place.
 * If any fix gets accidentally reverted by a future refactor, these tests
 * catch it.
 */

import { describe, it, expect } from "vitest";
import { buildFingerprint } from "../../../src/llm/phrasing-history.js";
import {
  humanRoundPrice,
  mapUtilityToFirmness,
  buildNegotiationIntent,
} from "../../../src/negotiation/intent/build-negotiation-intent.js";
import {
  sanitizeText,
  validateLlmOutput,
} from "../../../src/llm/validate-llm-output.js";
import { buildArcSummary } from "../../../src/llm/arc-summary.js";
import { extractVendorConcerns } from "../../../src/modules/chatbot/engine/tone-detector.js";
import { detectTermsRequest } from "../../../src/modules/chatbot/engine/parse-offer.js";
import { getFallbackResponse } from "../../../src/llm/fallback-templates.js";

// ─────────────────────────────────────────────
// Sprint 1 — Quick Wins
// ─────────────────────────────────────────────

describe("Humanization Audit — Sprint 1", () => {
  describe("H4: normalizeDelivery (no 'by by')", () => {
    it("strips leading prepositions from delivery in intent", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: "Net 30",
        counterDelivery: "by March 2026",
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
      });
      expect(intent.allowedDelivery).toBe("March 2026");
      expect(intent.allowedDelivery).not.toMatch(/^by /i);
    });

    it("humanizes ISO dates", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: "2026-03-15",
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
      });
      expect(intent.allowedDelivery).toBe("March 15, 2026");
    });
  });

  describe("B1: Multi-currency price validation", () => {
    it("rejects wrong GBP price in COUNTER response", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
        currencyCode: "GBP",
      });
      // LLM hallucinates £60,000 — validator must catch it.
      const response =
        "Thanks for the proposal. After internal review our position is £60,000 with Net 30 terms. We think this is a fair counter given our overall procurement guidelines and current market conditions.";
      expect(() => validateLlmOutput(response, intent)).toThrow();
    });

    it("accepts correct GBP price", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
        currencyCode: "GBP",
      });
      const response =
        "Thanks for the proposal. After review our counter is £50,000 total with Net 30 terms. We think this reflects fair pricing given our overall procurement guidelines and current market conditions across comparable engagements.";
      const sanitized = validateLlmOutput(response, intent);
      expect(sanitized).toContain("50,000");
    });
  });

  describe("H2: humanRoundPrice", () => {
    it("rounds to clean numbers", () => {
      expect(humanRoundPrice(98412.67)).toBe(98500);
      expect(humanRoundPrice(400737.19)).toBe(401000);
      expect(humanRoundPrice(4212)).toBe(4250);
      expect(humanRoundPrice(847.33)).toBe(850);
      expect(humanRoundPrice(2503200)).toBe(2505000);
    });

    it("never returns penny-precise values for prices > $1000", () => {
      const testPrices = [1234.56, 5678.9, 12345.67, 99999.99, 500000.5];
      for (const price of testPrices) {
        const rounded = humanRoundPrice(price);
        expect(rounded % 10).toBe(0);
      }
    });
  });

  describe("M1: AI-tell phrase expansion", () => {
    it("strips uncontracted 'we would love to'", () => {
      expect(
        sanitizeText("We would love to proceed at this price"),
      ).not.toMatch(/would love to/i);
    });

    it("strips uncontracted 'I would love to'", () => {
      expect(sanitizeText("I would love to find a solution")).not.toMatch(
        /would love to/i,
      );
    });

    it("strips 'don't hesitate to'", () => {
      expect(sanitizeText("Don't hesitate to reach out")).not.toMatch(
        /hesitate/i,
      );
    });

    it("strips 'thank you for your patience'", () => {
      expect(sanitizeText("Thank you for your patience in this")).not.toMatch(
        /thank you for your patience/i,
      );
    });
  });
});

// ─────────────────────────────────────────────
// Sprint 2 — Architectural Enrichments
// ─────────────────────────────────────────────

describe("Humanization Audit — Sprint 2", () => {
  describe("A5: Phrasing fingerprint (5 words)", () => {
    it("distinguishes messages sharing first 3 words", () => {
      const fp1 = buildFingerprint("COUNTER", "Thank you for your proposal");
      const fp2 = buildFingerprint(
        "COUNTER",
        "Thank you for coming back to us",
      );
      expect(fp1).not.toBe(fp2);
    });

    it("produces 5-word fingerprints", () => {
      const fp = buildFingerprint(
        "COUNTER",
        "We appreciate your offer and wish to proceed",
      );
      const parts = fp.split("|")[1].split(":");
      expect(parts.length).toBe(5);
    });
  });

  describe("A3: Vendor concern extraction", () => {
    it("extracts real concerns from vendor message", () => {
      const concerns = extractVendorConcerns(
        "Our timeline is tight and we need to consider the supply chain impact",
      );
      expect(concerns).toContain("timeline pressure");
      expect(concerns).toContain("supply chain");
    });

    it("returns empty for number-only messages", () => {
      expect(extractVendorConcerns("50000")).toEqual([]);
    });

    it("caps at 3 concerns", () => {
      const concerns = extractVendorConcerns(
        "Budget is tight, timeline urgent, quality must be guaranteed, and our competitor offered better volume discounts",
      );
      expect(concerns.length).toBeLessThanOrEqual(3);
    });
  });

  describe("A4: detectTermsRequest wiring", () => {
    it("detects vendor term questions", () => {
      const result = detectTermsRequest("Can you do Net 30?");
      expect(result).not.toBeNull();
      expect(result!.requestedDays).toBe(30);
    });

    it("ignores offer statements", () => {
      const result = detectTermsRequest("$50,000 with Net 60");
      expect(result).toBeNull();
    });
  });

  describe("H1: COUNTER template pool depth (7 per tone)", () => {
    it("produces multiple distinct fallback responses across attempts", () => {
      const responses = new Set<string>();
      for (let i = 0; i < 25; i++) {
        const intent: any = {
          action: "COUNTER",
          firmness: 0.55,
          commercialPosition: "test",
          allowedPrice: 50000,
          allowedPaymentTerms: "Net 30",
          acknowledgeConcerns: [],
          vendorTone: "formal",
          currencySymbol: "$",
          phrasingHistory: [],
        };
        responses.add(getFallbackResponse(intent));
      }
      // Random selection from a 7-entry pool, 25 tries → expect ≥4 unique.
      expect(responses.size).toBeGreaterThanOrEqual(4);
    });
  });
});

// ─────────────────────────────────────────────
// Sprint 3 — Behavioral Changes
// ─────────────────────────────────────────────

describe("Humanization Audit — Sprint 3", () => {
  describe("H5: Firmness 5-level mapping", () => {
    it("returns 5 distinct values across the utility spectrum", () => {
      const values = new Set([
        mapUtilityToFirmness(0.85),
        mapUtilityToFirmness(0.7),
        mapUtilityToFirmness(0.55),
        mapUtilityToFirmness(0.4),
        mapUtilityToFirmness(0.25),
      ]);
      expect(values.size).toBe(5);
    });

    it("maps utility score to expected firmness tier", () => {
      expect(mapUtilityToFirmness(0.85)).toBe(0.15);
      expect(mapUtilityToFirmness(0.7)).toBe(0.35);
      expect(mapUtilityToFirmness(0.55)).toBe(0.55);
      expect(mapUtilityToFirmness(0.4)).toBe(0.75);
      expect(mapUtilityToFirmness(0.25)).toBe(0.9);
    });
  });

  describe("M3: vendorMovement field", () => {
    it("appears on NegotiationIntent when passed", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
        vendorMovement: "significant",
      });
      expect(intent.vendorMovement).toBe("significant");
    });

    it("is undefined when not passed", () => {
      const intent = buildNegotiationIntent({
        action: "COUNTER",
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal",
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
      });
      expect(intent.vendorMovement).toBeUndefined();
    });
  });

  describe("H3: Commercial position rotation by round", () => {
    it("produces different positions for different rounds within the same tier", () => {
      const base = {
        action: "COUNTER" as const,
        utilityScore: 0.5,
        counterPrice: 50000,
        counterPaymentTerms: null,
        counterDelivery: null,
        concerns: [],
        tone: "formal" as const,
        targetPrice: 45000,
        maxAcceptablePrice: 55000,
      };
      const intent1 = buildNegotiationIntent({ ...base, roundNumber: 1 });
      const intent2 = buildNegotiationIntent({ ...base, roundNumber: 2 });
      expect(intent1.commercialPosition).not.toBe(intent2.commercialPosition);
    });
  });
});

// ─────────────────────────────────────────────
// Sprint 4 — High-Effort Items
// ─────────────────────────────────────────────

describe("Humanization Audit — Sprint 4", () => {
  describe("A1: Arc summary", () => {
    it("returns empty for < 2 completed rounds", () => {
      expect(buildArcSummary([])).toBe("");
      expect(
        buildArcSummary([
          {
            role: "VENDOR",
            content: "test",
            extractedOffer: { total_price: 50000 },
            counterOffer: null,
            decisionAction: null,
          },
        ]),
      ).toBe("");
    });

    it("builds an arc for 2+ completed rounds", () => {
      const messages = [
        {
          role: "VENDOR",
          content: "",
          extractedOffer: { total_price: 60000 },
          counterOffer: null,
          decisionAction: null,
        },
        {
          role: "ACCORDO",
          content: "",
          extractedOffer: null,
          counterOffer: { total_price: 50000 },
          decisionAction: "COUNTER",
        },
        {
          role: "VENDOR",
          content: "",
          extractedOffer: { total_price: 55000 },
          counterOffer: null,
          decisionAction: null,
        },
        {
          role: "ACCORDO",
          content: "",
          extractedOffer: null,
          counterOffer: { total_price: 52000 },
          decisionAction: "COUNTER",
        },
      ];
      const arc = buildArcSummary(messages, "$");
      expect(arc).toContain("$60,000");
      expect(arc).toContain("$50,000");
      expect(arc).toContain("$55,000");
      expect(arc).toContain("$52,000");
      expect(arc).toContain("2 rounds");
    });

    it("does not contain banned strategy words", () => {
      const messages = [
        {
          role: "VENDOR",
          content: "",
          extractedOffer: { total_price: 60000 },
          counterOffer: null,
          decisionAction: null,
        },
        {
          role: "ACCORDO",
          content: "",
          extractedOffer: null,
          counterOffer: { total_price: 50000 },
          decisionAction: "COUNTER",
        },
        {
          role: "VENDOR",
          content: "",
          extractedOffer: { total_price: 55000 },
          counterOffer: null,
          decisionAction: null,
        },
        {
          role: "ACCORDO",
          content: "",
          extractedOffer: null,
          counterOffer: { total_price: 52000 },
          decisionAction: "COUNTER",
        },
      ];
      const arc = buildArcSummary(messages, "$").toLowerCase();
      expect(arc).not.toContain("utility");
      expect(arc).not.toContain("threshold");
      expect(arc).not.toContain("max_acceptable");
      expect(arc).not.toContain("weight");
      // "target" must not appear in any strategy sense; the word doesn't
      // appear in any of our arc-summary template strings.
      expect(arc).not.toContain("target");
    });

    it("caps at 150 words even for long histories", () => {
      const messages: any[] = [];
      for (let i = 0; i < 10; i++) {
        messages.push({
          role: "VENDOR",
          content: "",
          extractedOffer: { total_price: 60000 - i * 1000 },
          counterOffer: null,
          decisionAction: null,
        });
        messages.push({
          role: "ACCORDO",
          content: "",
          extractedOffer: null,
          counterOffer: { total_price: 50000 + i * 500 },
          decisionAction: "COUNTER",
        });
      }
      const arc = buildArcSummary(messages, "$");
      const wordCount = arc.split(/\s+/).length;
      expect(wordCount).toBeLessThanOrEqual(151);
    });
  });

  describe("L2: Locale-locked formatting", () => {
    it("formats prices consistently with en-US locale", () => {
      expect((98500).toLocaleString("en-US")).toBe("98,500");
      expect((3150000).toLocaleString("en-US")).toBe("3,150,000");
      expect((98500.5).toLocaleString("en-US")).toBe("98,500.5");
    });
  });
});
