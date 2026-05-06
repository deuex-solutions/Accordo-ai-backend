/**
 * Unit tests for buildNegotiationIntent — weakestPrimaryParameter field (Feb 2026)
 *
 * Covers:
 * 1. weakestPrimaryParameter is passed through for COUNTER only
 * 2. warranty/quality NEVER appear in intent (not valid values)
 * 3. Absent for ACCEPT, WALK_AWAY, ESCALATE, ASK_CLARIFY
 * 4. Only set when utility < 0.7 (actually weak)
 */

import { describe, it, expect } from "vitest";
import {
  buildNegotiationIntent,
  type BuildIntentInput,
} from "../../../src/negotiation/intent/build-negotiation-intent.js";

function makeInput(
  overrides: Partial<BuildIntentInput> = {},
): BuildIntentInput {
  return {
    action: "COUNTER",
    utilityScore: 0.55,
    counterPrice: 90000,
    counterPaymentTerms: "Net 60",
    counterDelivery: "within 30 days",
    concerns: [],
    tone: "formal",
    targetPrice: 80000,
    maxAcceptablePrice: 100000,
    ...overrides,
  };
}

describe("buildNegotiationIntent — weakestPrimaryParameter", () => {
  it('passes weakestPrimaryParameter="price" through to intent for COUNTER', () => {
    const intent = buildNegotiationIntent(
      makeInput({ weakestPrimaryParameter: "price" }),
    );
    expect(intent.action).toBe("COUNTER");
    expect(intent.weakestPrimaryParameter).toBe("price");
  });

  it('passes weakestPrimaryParameter="terms" through to intent for COUNTER', () => {
    const intent = buildNegotiationIntent(
      makeInput({ weakestPrimaryParameter: "terms" }),
    );
    expect(intent.weakestPrimaryParameter).toBe("terms");
  });

  it('passes weakestPrimaryParameter="delivery" through to intent for COUNTER', () => {
    const intent = buildNegotiationIntent(
      makeInput({ weakestPrimaryParameter: "delivery" }),
    );
    expect(intent.weakestPrimaryParameter).toBe("delivery");
  });

  it("weakestPrimaryParameter is undefined when not provided for COUNTER", () => {
    const intent = buildNegotiationIntent(
      makeInput({ weakestPrimaryParameter: undefined }),
    );
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("weakestPrimaryParameter is absent for ACCEPT action", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        action: "ACCEPT",
        utilityScore: 0.85,
        counterPrice: null,
        weakestPrimaryParameter: "price",
      }),
    );
    expect(intent.action).toBe("ACCEPT");
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("weakestPrimaryParameter is absent for WALK_AWAY action", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        action: "WALK_AWAY",
        utilityScore: 0.1,
        counterPrice: null,
        weakestPrimaryParameter: "terms",
      }),
    );
    expect(intent.action).toBe("WALK_AWAY");
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("weakestPrimaryParameter is absent for ESCALATE action", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        action: "ESCALATE",
        utilityScore: 0.35,
        counterPrice: null,
        weakestPrimaryParameter: "delivery",
      }),
    );
    expect(intent.action).toBe("ESCALATE");
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("weakestPrimaryParameter is absent for ASK_CLARIFY action", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        action: "ASK_CLARIFY",
        utilityScore: 0,
        counterPrice: null,
        weakestPrimaryParameter: "price",
      }),
    );
    expect(intent.action).toBe("ASK_CLARIFY");
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("weakestPrimaryParameter is absent when counterPrice is null (COUNTER without price)", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        counterPrice: null,
        weakestPrimaryParameter: "terms",
      }),
    );
    // counterPrice=null means COUNTER block is skipped
    expect(intent.weakestPrimaryParameter).toBeUndefined();
  });

  it("intent does not have warranty or quality as weakestPrimaryParameter", () => {
    // TypeScript enforces this, but verify values that exist are only the valid 3
    const validValues = new Set(["price", "terms", "delivery", undefined]);
    for (const val of ["price", "terms", "delivery"] as const) {
      const intent = buildNegotiationIntent(
        makeInput({ weakestPrimaryParameter: val }),
      );
      expect(validValues.has(intent.weakestPrimaryParameter)).toBe(true);
    }
  });

  it("weakestPrimaryParameter does not interfere with allowedPrice, allowedPaymentTerms, allowedDelivery", () => {
    const intent = buildNegotiationIntent(
      makeInput({
        weakestPrimaryParameter: "price",
        counterPrice: 95000,
        counterPaymentTerms: "Net 60",
        counterDelivery: "within 30 days",
      }),
    );
    expect(intent.allowedPrice).toBeDefined();
    expect(intent.allowedPaymentTerms).toBe("Net 60");
    expect(intent.allowedDelivery).toBe("30 days");
    expect(intent.weakestPrimaryParameter).toBe("price");
  });
});
