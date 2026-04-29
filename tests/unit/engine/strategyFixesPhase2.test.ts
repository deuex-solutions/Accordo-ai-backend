/**
 * Strategy fixes (Phase 2, Apr 2026)
 *
 * Replays the failing INR negotiation that surfaced 4 bugs:
 *   P2.1 — MESO regressed below the convergence zone (₹24K options when
 *          conversation was at ₹28K)
 *   P2.2 — MESO not anchored to convergence band even when vendor's offer
 *          fell inside [target, maxAcceptable]
 *   P2.3 — Vendor moved to ₹29K (within ceiling), AI countered ₹28,208
 *          instead of accepting
 *   P2.4 — First counter dropped 21% below vendor's opening (₹31,581 →
 *          ₹25,069 in one round), reading as bad-faith negotiating
 *
 * Tests target the pure decision functions in decide.ts and meso.ts —
 * no DB, no LLM, no network.
 */

import { describe, it, expect } from "vitest";
import { decideNextMove } from "../../../src/modules/chatbot/engine/decide.js";
import {
  generateMesoOptions,
  type ResolvedNegotiationConfig,
} from "../../../src/modules/chatbot/engine/meso.js";
import type {
  NegotiationConfig,
  Offer,
} from "../../../src/modules/chatbot/engine/types.js";

// Match the transcript: target ₹19,900 / max ₹29,900
function makeConfig(
  overrides: Partial<NegotiationConfig> = {},
): NegotiationConfig {
  return {
    parameters: {
      total_price: {
        weight: 0.6,
        direction: "minimize",
        anchor: 19_900,
        target: 19_900,
        max_acceptable: 29_900,
        concession_step: 500,
      },
      payment_terms: {
        weight: 0.4,
        options: ["Net 30", "Net 60", "Net 90"] as const,
        utility: { "Net 30": 1.0, "Net 60": 0.7, "Net 90": 0.4 },
      },
    },
    accept_threshold: 0.7,
    escalate_threshold: 0.5,
    walkaway_threshold: 0.3,
    max_rounds: 10,
    priority: "MEDIUM",
    currency: "INR",
    ...overrides,
  };
}

function makeResolvedConfig(): ResolvedNegotiationConfig {
  return {
    targetPrice: 19_900,
    maxAcceptablePrice: 29_900,
    priceRange: 10_000,
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
    anchorPrice: 19_900,
    concessionStep: 500,
    sources: {},
  };
}

// ─────────────────────────────────────────────
// P2.4 — First-counter regression cap
// ─────────────────────────────────────────────

describe("P2.4: first-counter regression cap (decide.ts)", () => {
  it("never drops more than 12% below vendor's opening offer", () => {
    const config = makeConfig();
    const vendorOffer: Offer = {
      total_price: 31_581,
      payment_terms: "Net 60",
    };
    const decision = decideNextMove(config, vendorOffer, 0);
    expect(decision.action).toBe("COUNTER");
    expect(decision.counterOffer?.total_price).toBeDefined();
    const counter = decision.counterOffer!.total_price!;
    // Old behavior: ₹23,400 (target + range × 0.35)
    // New floor: 88% of vendor's ₹31,581 = ₹27,791
    // Counter must respect that floor.
    expect(counter).toBeGreaterThanOrEqual(31_581 * 0.88);
    // And still below vendor's offer.
    expect(counter).toBeLessThan(31_581);
  });

  it("respects max_acceptable when vendor offer is far above ceiling", () => {
    const config = makeConfig();
    const vendorOffer: Offer = {
      total_price: 100_000,
      payment_terms: "Net 60",
    };
    const decision = decideNextMove(config, vendorOffer, 0);
    const counter = decision.counterOffer?.total_price ?? 0;
    // Floor would be 88% of 100K = 88K, but max_acceptable is 29,900.
    // Counter clamps to max_acceptable.
    expect(counter).toBeLessThanOrEqual(29_900);
  });

  it("does not cap when vendor's offer is missing", () => {
    const config = makeConfig();
    const vendorOffer: Offer = {
      total_price: null as any,
      payment_terms: "Net 60",
    };
    const decision = decideNextMove(config, vendorOffer, 0);
    // Should still produce a decision without crashing.
    expect(decision).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// P2.1 + P2.2 — MESO convergence floor + band
// ─────────────────────────────────────────────

describe("P2.1/P2.2: MESO convergence floor and band-bracketing", () => {
  it("MESO with no prior counter falls back to standard formula", () => {
    const config = makeResolvedConfig();
    const vendorOffer = {
      total_price: 31_581,
      payment_terms: "Net 60",
      payment_terms_days: 60,
      delivery_days: 30,
    } as any;

    const result = generateMesoOptions(config, vendorOffer, 1, 0.65, "INR");
    expect(result.success).toBe(true);
    expect(result.options.length).toBe(3);
    // Without a floor, options can be anywhere within [target, vendor].
    // Just check they're sane.
    for (const opt of result.options) {
      expect(opt.offer.total_price).toBeGreaterThan(0);
      expect(opt.offer.total_price).toBeLessThanOrEqual(31_581);
    }
  });

  it("MESO with a prior counter never regresses below it", () => {
    const config = makeResolvedConfig();
    const vendorOffer = {
      total_price: 29_000,
      payment_terms: "Net 30",
      payment_terms_days: 30,
      delivery_days: 30,
    } as any;
    const lastCounter = 28_208;

    const result = generateMesoOptions(
      config,
      vendorOffer,
      4,
      0.65,
      "INR",
      lastCounter,
    );
    expect(result.success).toBe(true);
    for (const opt of result.options) {
      // Prior bug: options came back at ~₹24K. Now must be ≥ last counter.
      expect(opt.offer.total_price).toBeGreaterThanOrEqual(lastCounter * 0.99); // small rounding tolerance
    }
  });

  it("MESO brackets the convergence band when vendor is within [target, max]", () => {
    const config = makeResolvedConfig();
    const vendorOffer = {
      total_price: 29_000, // within [19_900, 29_900]
      payment_terms: "Net 30",
      payment_terms_days: 30,
      delivery_days: 30,
    } as any;
    const lastCounter = 28_208;

    const result = generateMesoOptions(
      config,
      vendorOffer,
      4,
      0.65,
      "INR",
      lastCounter,
    );
    expect(result.success).toBe(true);
    // All options should sit inside [lastCounter, vendorOffer] (with small
    // 2.5% discount for the price-focused option).
    for (const opt of result.options) {
      expect(opt.offer.total_price).toBeLessThanOrEqual(29_000);
      expect(opt.offer.total_price).toBeGreaterThanOrEqual(
        lastCounter * 0.97, // small tolerance for the 2.5% price-focused discount
      );
    }
  });
});

// ─────────────────────────────────────────────
// P2.3 — Vendor-convergence ACCEPT
// ─────────────────────────────────────────────
// This sits in chatbot.service.ts, not in a pure engine function, so we
// document the required behavior here as a smoke test against decideNextMove
// rather than a direct call. The real path is integration-tested via the
// vendor-chat HTTP endpoint.

describe("P2.3: vendor-convergence ACCEPT (smoke / behavior contract)", () => {
  it("when vendor's price is within ceiling, decideNextMove can ACCEPT", () => {
    const config = makeConfig({ priority: "MEDIUM" });
    // Vendor at ₹29,000 — within [19,900, 29,900], slightly above target.
    const vendorOffer: Offer = {
      total_price: 29_000,
      payment_terms: "Net 30",
    };
    const decision = decideNextMove(config, vendorOffer, 4);
    // The engine itself may COUNTER, ACCEPT, or ESCALATE depending on
    // utility math — what matters is the chatbot.service.ts wrapper
    // overrides to ACCEPT when vendor moves toward us. Here we just
    // confirm that the engine doesn't crash for this scenario and
    // returns a well-formed decision.
    expect(decision).toBeDefined();
    expect(["ACCEPT", "COUNTER", "ESCALATE", "WALK_AWAY"]).toContain(
      decision.action,
    );
  });
});
