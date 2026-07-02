/**
 * P0.4 — negotiation path (no MESO payload) unit tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runNegotiationPathP0 } from "../../../src/modules/chatbot/pipeline/negotiation-path-p0.js";
import type { ChatbotDeal } from "../../../src/models/chatbot-deal.js";

vi.mock("../../../src/modules/chatbot/pipeline/deal-commercial-context.js", () => ({
  resolveRfqCurrencyCode: vi.fn().mockResolvedValue("INR"),
  resolveRfqCurrencyCodeSync: vi.fn().mockReturnValue("INR"),
}));

vi.mock("../../../src/llm/render-negotiation-with-retry.js", () => ({
  renderValidatedNegotiationMessage: vi.fn().mockResolvedValue({
    content:
      "Good morning, and thank you for your offer. We appreciate the Net 45 terms and your delivery timeline. " +
      "After reviewing internally, we can move forward at ₹36,750 on Net 60 with delivery in four weeks. " +
      "Please confirm whether this works for your team so we can finalize next steps this week.",
    fromLlm: true,
    attempts: 1,
  }),
}));

vi.mock("../../../src/modules/chatbot/chatbot.repo.js", () => ({
  default: {
    findMessagesByDealId: vi.fn().mockResolvedValue([]),
  },
}));

import chatbotRepo from "../../../src/modules/chatbot/chatbot.repo.js";
import { renderValidatedNegotiationMessage } from "../../../src/llm/render-negotiation-with-retry.js";

const mockDeal = {
  id: "deal-1",
  requisitionId: "req-1",
  round: 1,
  title: "Test deal",
  Requisition: {
    typeOfCurrency: "INR",
    minTotalPrice: 35_000,
    maxTotalPrice: 50_000,
  },
  latestOfferJson: null,
  negotiationStateJson: null,
  negotiationConfigJson: {
    currency: "INR",
    accept_threshold: 0.7,
    escalate_threshold: 0.5,
    walkaway_threshold: 0.3,
    max_rounds: 6,
    parameters: {
      total_price: {
        target: 35_000,
        max_acceptable: 50_000,
        anchor: 30_000,
        weight: 0.6,
        concession_step: 2500,
      },
      payment_terms: {
        weight: 0.4,
        options: ["Net 30", "Net 60", "Net 90"],
        utility: { "Net 30": 0.2, "Net 60": 0.6, "Net 90": 1.0 },
      },
    },
    wizardConfig: {
      priceQuantity: {
        targetUnitPrice: 35_000,
        maxAcceptablePrice: 50_000,
      },
    },
  },
} as unknown as ChatbotDeal;

const mockCommercial = {
  currencyCode: "INR",
  currencySymbol: "₹",
  priceLocale: "en-IN" as const,
};

describe("runNegotiationPathP0", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns counter decision without MESO intent variants", async () => {
    const result = await runNegotiationPathP0({
      deal: mockDeal,
      vendorMessage: "₹38,500, NET 45, 25-day delivery.",
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.97,
        extractedPrice: 38_500,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
      },
      commercial: mockCommercial,
    });

    expect(["COUNTER", "ACCEPT", "ESCALATE", "WALK_AWAY"]).toContain(
      result.decision.action,
    );
    expect(result.decision.action).not.toBe("MESO");
    expect(result.content.length).toBeGreaterThan(10);
  });

  it("vendor terms inquiry routes to counter at requested net terms", async () => {
    const dealWithVendorOffer = {
      ...mockDeal,
      round: 2,
      latestVendorOffer: { total_price: 60_000, payment_terms: "Net 45" },
    } as unknown as ChatbotDeal;

    const result = await runNegotiationPathP0({
      deal: dealWithVendorOffer,
      vendorMessage: "what best can you offer for net 60?",
      classification: {
        type: "VENDOR_TERMS_INQUIRY",
        parseable: true,
        priceInRange: true,
        confidence: 0.94,
        extractedPrice: null,
        extractedDays: 60,
        route: "FULL_NEGOTIATION_PIPELINE",
        termsRequest: { requestedDays: 60, matchedText: "Net 60" },
      },
      commercial: mockCommercial,
    });

    expect(result.decision.action).toBe("COUNTER");
    expect(result.decision.counterOffer?.payment_terms).toBe("Net 60");
    expect(result.decision.counterOffer?.total_price).not.toBeNull();
    expect(result.content.length).toBeGreaterThan(10);
  });

  it("uses RFQ bounds and prior PM counter — not stale 400-level config", async () => {
    const staleDeal = {
      ...mockDeal,
      round: 3,
      latestOfferJson: { total_price: 40_000, payment_terms: "Net 45" },
      Requisition: {
        typeOfCurrency: "INR",
        minTotalPrice: 39_900,
        maxTotalPrice: 59_900,
      },
      negotiationConfigJson: {
        ...mockDeal.negotiationConfigJson,
        parameters: {
          total_price: {
            min_total_price: 400,
            max_total_price: 480,
            weight: 40,
            direction: "decrease",
            anchor: 400,
            concession_step: 0.05,
          },
          payment_terms: mockDeal.negotiationConfigJson.parameters.payment_terms,
        },
      },
    } as unknown as ChatbotDeal;

    vi.mocked(chatbotRepo.findMessagesByDealId).mockResolvedValue([
      {
        role: "VENDOR",
        content: "62000 net 30",
        extractedOffer: { total_price: 62_000 },
        counterOffer: null,
        decisionAction: null,
      },
      {
        role: "ACCORDO",
        content: "We are at ₹58,000 total, Net 45.",
        extractedOffer: null,
        counterOffer: { total_price: 58_000, payment_terms: "Net 45" },
        decisionAction: "COUNTER",
      },
    ] as Awaited<ReturnType<typeof chatbotRepo.findMessagesByDealId>>);

    const result = await runNegotiationPathP0({
      deal: staleDeal,
      vendorMessage: "i can go till 59000 net 45",
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: true,
        confidence: 0.96,
        extractedPrice: 59_000,
        extractedDays: 45,
        route: "FULL_NEGOTIATION_PIPELINE",
        isMeetingProposal: true,
      },
      commercial: mockCommercial,
    });

    expect(result.decision.action).not.toBe("MESO");
    if (result.decision.action === "COUNTER") {
      expect(result.decision.counterOffer?.total_price).toBeGreaterThanOrEqual(
        58_000,
      );
      expect(result.decision.counterOffer?.total_price).toBeLessThanOrEqual(
        59_000,
      );
    } else {
      expect(result.decision.action).toBe("ACCEPT");
    }

    const renderCall = vi.mocked(renderValidatedNegotiationMessage).mock
      .calls[0];
    const personaContext = renderCall?.[2] as { arcSummary?: string };
    expect(personaContext?.arcSummary).toContain("₹58,000");
  });
});
