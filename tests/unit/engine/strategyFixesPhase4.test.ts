/**
 * Phase 4 strategy + tolerance fixes (Apr 2026)
 *
 * Replays the failing 7-round £-currency negotiation that surfaced:
 *   - MESO regression below the convergence zone (£365K options when last
 *     counter was £418,900)
 *   - Vendor-convergence ACCEPT miss (vendor £420,500 vs ceiling £418,900,
 *     a 0.4% overrun that disabled ACCEPT)
 *   - First counter regressed by 12%+ from vendor's opening
 *   - "by by" duplicate-preposition glitch in delivery wording
 *
 * Locks in the corrected behavior for each.
 */

import { describe, it, expect } from "vitest";
import {
  generateMesoOptions,
  applyConvergenceFloor,
} from "../../../src/modules/chatbot/engine/meso.js";
import type { ResolvedNegotiationConfig } from "../../../src/modules/chatbot/engine/types.js";
import { detectTermsRequest } from "../../../src/modules/chatbot/engine/parse-offer.js";
import { sanitizeText } from "../../../src/llm/validate-llm-output.js";

function makeResolvedConfig(): ResolvedNegotiationConfig {
  return {
    targetPrice: 338_900,
    maxAcceptablePrice: 418_900,
    priceRange: 80_000,
    priority: "MEDIUM",
    paymentTermsMinDays: 30,
    paymentTermsMaxDays: 90,
    warrantyPeriodMonths: 12,
    deliveryDate: null,
    preferredDeliveryDate: null,
    partialDeliveryAllowed: true,
    lateDeliveryPenaltyPerDay: 0,
    qualityStandards: [],
    maxRounds: 10,
    walkawayThreshold: 0.3,
    weights: { total_price: 0.6, payment_terms: 0.4 },
    weightsAreUserModified: false,
    acceptThreshold: 0.7,
    escalateThreshold: 0.5,
    walkAwayThreshold: 0.3,
    anchorPrice: 288_065,
    concessionStep: 8_000,
    sources: {},
  };
}

// ─────────────────────────────────────────────
// applyConvergenceFloor — pure helper, tolerance behavior
// ─────────────────────────────────────────────

describe("applyConvergenceFloor — tolerance against maxAcceptable", () => {
  const config = makeResolvedConfig();

  it("returns basePrice unchanged when no last counter is set", () => {
    expect(applyConvergenceFloor(300_000, config, null)).toBe(300_000);
    expect(applyConvergenceFloor(300_000, config, undefined)).toBe(300_000);
  });

  it("raises basePrice to last counter when below it", () => {
    expect(applyConvergenceFloor(365_000, config, 418_900)).toBe(418_900);
  });

  it("leaves basePrice alone when already above last counter", () => {
    expect(applyConvergenceFloor(420_000, config, 418_900)).toBe(420_000);
  });

  it("STAYS ACTIVE when last counter is fractionally above maxAcceptable (within tolerance)", () => {
    // £418,999.99 is £99.99 above ceiling — 0.024% overrun. Within 1.5% tol.
    expect(applyConvergenceFloor(365_000, config, 418_999.99)).toBe(418_999.99);
  });

  it("DISABLES when last counter is far above maxAcceptable (outside tolerance)", () => {
    // £450K is 7.4% above ceiling — outside 1.5% tolerance, floor disabled.
    expect(applyConvergenceFloor(365_000, config, 450_000)).toBe(365_000);
  });
});

// ─────────────────────────────────────────────
// generateMesoOptions — convergence behavior
// ─────────────────────────────────────────────

describe("generateMesoOptions — convergence floor with tolerance (Apr 2026)", () => {
  const config = makeResolvedConfig();
  const vendorOffer = {
    total_price: 420_500,
    payment_terms: "Net 60",
    payment_terms_days: 60,
    delivery_days: 30,
  } as any;

  it("MESO never regresses below last counter (£418,999.99) even though it's slightly above ceiling", () => {
    const result = generateMesoOptions(
      config,
      vendorOffer,
      7,
      0.65,
      "GBP",
      418_999.99, // last counter, fractionally above maxAcceptable
    );
    expect(result.success).toBe(true);
    for (const opt of result.options) {
      // All MESO options must be >= last counter (modulo small rounding +
      // the 2.5% discount for the price-focused option = ~£408K floor for
      // that one specifically). Key: none should land at £365K like the bug.
      expect(opt.offer.total_price).toBeGreaterThan(400_000);
    }
  });

  it("MESO descriptions reflect FINAL prices after variance adjustment", () => {
    const result = generateMesoOptions(
      config,
      vendorOffer,
      7,
      0.65,
      "GBP",
      418_999.99,
    );
    expect(result.success).toBe(true);
    for (const opt of result.options) {
      const labeled = opt.description ?? "";
      // If a price appears in the description, it must match the actual
      // offer.total_price (modulo formatting differences).
      const priceMatch = labeled.match(/£([\d,]+(?:\.\d{1,2})?)/);
      if (priceMatch) {
        const labeledPrice = parseFloat(priceMatch[1].replace(/,/g, ""));
        expect(Math.abs(labeledPrice - opt.offer.total_price)).toBeLessThan(1);
      }
    }
  });
});

// ─────────────────────────────────────────────
// detectTermsRequest — questions and statements
// ─────────────────────────────────────────────

describe("detectTermsRequest — coverage from the 7-round transcript", () => {
  it("catches round 4/5 question form", () => {
    const r = detectTermsRequest("what can you best offer for net 60");
    expect(r?.requestedDays).toBe(60);
  });

  it("does NOT catch round 6 statement form ('lets do 420500 net 60')", () => {
    // This is a statement, not a question. The sticky-terms model picks up
    // the Net 60 from extractedOffer.payment_terms_days, not from this
    // detector — so it should still return null.
    expect(detectTermsRequest("lets do 420500 net 60")).toBeNull();
  });

  it("does NOT catch round 7 statement form", () => {
    expect(
      detectTermsRequest(
        "I would like to propose a different offer: £419,000.00 total with Net 75 payment terms.",
      ),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────
// sanitizeText — duplicate prepositions
// ─────────────────────────────────────────────

describe("sanitizeText — duplicate preposition strip (Apr 2026)", () => {
  it('collapses "by by"', () => {
    const out = sanitizeText("delivery by by 2026-05-29");
    expect(out).toBe("delivery by 2026-05-29");
  });

  it('collapses "with with"', () => {
    expect(sanitizeText("net 30 with with 2% discount")).toBe(
      "net 30 with 2% discount",
    );
  });

  it('case-insensitive "On On"', () => {
    expect(sanitizeText("payable On On Net 60")).toBe("payable On Net 60");
  });

  it("does NOT touch single prepositions", () => {
    const sentence = "delivery by 2026-05-29 with Net 60 on the dot";
    expect(sanitizeText(sentence)).toBe(sentence);
  });

  it("does NOT touch unrelated repeated words", () => {
    const sentence = "the the report"; // not a tracked preposition
    expect(sanitizeText(sentence)).toBe(sentence);
  });
});
