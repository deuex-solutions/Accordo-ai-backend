/**
 * accept-convergence-policy — gap, price-led, alignment, and repeated-ceiling accept
 */

import { describe, it, expect } from "vitest";
import {
  applyConvergenceAcceptPolicies,
  applyFinalAlignmentAccept,
  offersCommerciallyAligned,
} from "../../../src/modules/chatbot/pipeline/accept-convergence-policy.js";
import type { NegotiationConfig } from "../../../src/modules/chatbot/engine/utility.js";
import type { Decision, Offer } from "../../../src/modules/chatbot/engine/types.js";
import type { ChatbotMessage } from "../../../src/models/chatbot-message.js";

const baseConfig: NegotiationConfig = {
  currency: "INR",
  accept_threshold: 0.7,
  escalate_threshold: 0.5,
  walkaway_threshold: 0.3,
  parameters: {
    total_price: {
      min_total_price: 55_000,
      max_total_price: 65_000,
      anchor: 52_000,
      weight: 0.6,
      concession_step: 500,
    },
    payment_terms: {
      weight: 0.4,
      options: ["Net 30", "Net 60", "Net 90"],
      utility: { "Net 30": 0.2, "Net 60": 0.6, "Net 90": 1.0 },
    },
  },
};

const counterDecision: Decision = {
  action: "COUNTER",
  utilityScore: 0.45,
  counterOffer: {
    total_price: 58_000,
    payment_terms: "Net 45",
    payment_terms_days: 45,
  },
  reasons: ["Utility below threshold"],
};

function vendorMsg(price: number): ChatbotMessage {
  return {
    id: `v-${price}`,
    role: "VENDOR",
    extractedOffer: { total_price: price },
  } as ChatbotMessage;
}

describe("applyConvergenceAcceptPolicies", () => {
  it("gap-accepts when vendor is within 2% of PM counter after consecutive drops", () => {
    const vendorOffer: Offer = {
      total_price: 59_000,
      payment_terms: "Net 45",
      payment_terms_days: 45,
    };
    const previousPmOffer: Offer = {
      total_price: 58_000,
      payment_terms: "Net 45",
      payment_terms_days: 45,
    };
    const priorMessages = [vendorMsg(61_000), vendorMsg(59_500)];

    const result = applyConvergenceAcceptPolicies({
      decision: counterDecision,
      vendorOffer,
      config: baseConfig,
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.95,
        extractedPrice: 59_000,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
        isMeetingProposal: true,
      },
      minTotalPrice: 55_000,
      maxTotalPrice: 65_000,
      previousPmOffer,
      priorMessages,
    });

    expect(result.action).toBe("ACCEPT");
    expect(result.reasons.some((r) => r.includes("gap accept"))).toBe(true);
  });

  it("does not gap-accept when vendor is still far above PM counter", () => {
    const result = applyConvergenceAcceptPolicies({
      decision: counterDecision,
      vendorOffer: {
        total_price: 62_000,
        payment_terms: "Net 45",
        payment_terms_days: 45,
      },
      config: baseConfig,
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.95,
        extractedPrice: 62_000,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
      },
      minTotalPrice: 55_000,
      maxTotalPrice: 65_000,
      previousPmOffer: { total_price: 58_000, payment_terms: "Net 45" },
      priorMessages: [vendorMsg(63_000)],
    });

    expect(result.action).toBe("COUNTER");
  });
});

describe("applyFinalAlignmentAccept", () => {
  it("accepts when PM counter equals vendor offer after guards", () => {
    const vendorOffer = {
      total_price: 59_000,
      payment_terms: "Net 45",
      payment_terms_days: 45,
    };
    const result = applyFinalAlignmentAccept({
      decision: {
        action: "COUNTER",
        utilityScore: 0.55,
        counterOffer: { ...vendorOffer },
        reasons: ["Counter zone"],
      },
      vendorOffer,
      vendorMessage: "max i can do is 59000 for net 45",
      config: baseConfig,
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.95,
        extractedPrice: 59_000,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
        isMeetingProposal: true,
      },
      previousPmOffer: {
        total_price: 59_000,
        payment_terms: "Net 45",
      },
      priorMessages: [vendorMsg(59_000)],
    });

    expect(result.action).toBe("ACCEPT");
    expect(result.reasons.some((r) => r.includes("matches vendor offer"))).toBe(
      true,
    );
  });

  it("accepts when vendor repeats firm max at PM counter", () => {
    const vendorOffer = {
      total_price: 59_000,
      payment_terms: "Net 45",
      payment_terms_days: 45,
    };
    const result = applyFinalAlignmentAccept({
      decision: counterDecision,
      vendorOffer,
      vendorMessage: "max i can do is 59000 for net 45",
      config: baseConfig,
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.95,
        extractedPrice: 59_000,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
        isMeetingProposal: true,
      },
      previousPmOffer: {
        total_price: 59_000,
        payment_terms: "Net 45",
      },
      priorMessages: [vendorMsg(59_000), vendorMsg(59_000)],
    });

    expect(result.action).toBe("ACCEPT");
    expect(
      result.reasons.some(
        (r) =>
          r.includes("repeated-ceiling accept") ||
          r.includes("at or below PM counter"),
      ),
    ).toBe(true);
  });
});

describe("offersCommerciallyAligned", () => {
  it("matches price and net terms", () => {
    expect(
      offersCommerciallyAligned(
        { total_price: 59_000, payment_terms: "Net 45" },
        { total_price: 59_000, payment_terms: "Net 45" },
      ),
    ).toBe(true);
  });
});
