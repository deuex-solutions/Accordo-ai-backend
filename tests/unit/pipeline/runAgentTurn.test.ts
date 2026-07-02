/**
 * P0.2–P0.4 — pipeline router and runAgentTurn tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handlerStageForRoute,
  dispatchByRoute,
} from "../../../src/modules/chatbot/pipeline/dispatch-by-route.js";
import { buildClassificationContextFromDeal } from "../../../src/modules/chatbot/pipeline/load-agent-turn-context.js";
import { composeChatResponse } from "../../../src/modules/chatbot/pipeline/compose-chat-response.js";
import { runNegotiationPathP0 } from "../../../src/modules/chatbot/pipeline/negotiation-path-p0.js";
import { runAgentTurn } from "../../../src/modules/chatbot/pipeline/run-agent-turn.js";
import type { ChatbotDeal } from "../../../src/models/chatbot-deal.js";

vi.mock("../../../src/modules/chatbot/pipeline/deal-commercial-context.js", () => ({
  resolveDealCommercialContext: vi.fn().mockResolvedValue({
    currencyCode: "INR",
    currencySymbol: "₹",
    priceLocale: "en-IN",
  }),
  resolveRfqCurrencyCode: vi.fn().mockResolvedValue("INR"),
  resolveRfqCurrencyCodeSync: vi.fn().mockReturnValue("INR"),
}));

vi.mock("../../../src/services/openai.service.js", () => ({
  generateCompletion: vi.fn(),
}));

vi.mock("../../../src/modules/chatbot/pipeline/compose-chat-response.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/chatbot/pipeline/compose-chat-response.js")>();
  return {
    ...actual,
    composeChatResponse: vi.fn(),
  };
});

vi.mock("../../../src/modules/chatbot/pipeline/negotiation-path-p0.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/modules/chatbot/pipeline/negotiation-path-p0.js")>();
  return {
    ...actual,
    runNegotiationPathP0: vi.fn(),
  };
});

vi.mock("../../../src/modules/chatbot/chatbot.repo.js", () => ({
  default: {
    findDealById: vi.fn(),
    findMessageById: vi.fn(),
    findMessagesByDealId: vi.fn(),
    createMessage: vi.fn(),
    updateDeal: vi.fn(),
  },
}));

import chatbotRepo from "../../../src/modules/chatbot/chatbot.repo.js";

const mockDeal = {
  id: "deal-1",
  userId: 42,
  status: "NEGOTIATING",
  round: 2,
  title: "Electronics RFQ",
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
      priority: "MEDIUM",
      priceQuantity: {
        targetUnitPrice: 35_000,
        maxAcceptablePrice: 50_000,
        minOrderQuantity: 1,
      },
      paymentTerms: { minDays: 30, maxDays: 90 },
      delivery: { requiredDate: null, partialDelivery: { allowed: false } },
      contractSla: { warrantyPeriod: "1_YEAR", lateDeliveryPenaltyPerDay: 1 },
      negotiationControl: { maxRounds: 6, walkawayThreshold: 30 },
    },
  },
} as unknown as ChatbotDeal;

describe("handlerStageForRoute", () => {
  it("maps FULL_NEGOTIATION_PIPELINE to P0.4", () => {
    expect(handlerStageForRoute("FULL_NEGOTIATION_PIPELINE")).toBe(
      "P0.4_NEGOTIATION",
    );
  });

  it("maps chat routes to P0.3", () => {
    for (const route of [
      "CHAT_RESPONSE",
      "ASK_CLARIFICATION",
      "SOFT_DECLINE",
      "REDIRECT",
    ] as const) {
      expect(handlerStageForRoute(route)).toBe("P0.3_CHAT");
    }
  });
});

describe("buildClassificationContextFromDeal", () => {
  it("resolves target and max from wizardConfig", () => {
    const ctx = buildClassificationContextFromDeal(mockDeal);
    expect(ctx.expectedPriceRange).toEqual({ min: 35_000, max: 50_000 });
  });
});

const mockCommercial = {
  currencyCode: "INR",
  currencySymbol: "₹",
  priceLocale: "en-IN" as const,
};

describe("dispatchByRoute", () => {
  beforeEach(() => {
    vi.mocked(chatbotRepo.findMessagesByDealId).mockResolvedValue([]);
    vi.mocked(composeChatResponse).mockResolvedValue({
      content: "Please share payment terms when you can.",
      fromLlm: true,
      decisionAction: "ASK_CLARIFICATION",
    });
    vi.mocked(runNegotiationPathP0).mockResolvedValue({
      content: "We can work with ₹40,000 on Net 45.",
      fromLlm: true,
      decision: {
        action: "COUNTER",
        utilityScore: 0.55,
        counterOffer: {
          total_price: 40_000,
          payment_terms: "Net 45",
          payment_terms_days: 45,
        },
        reasons: ["test"],
      },
      explainability: null,
    });
  });

  it("delegates to negotiation path for FULL_NEGOTIATION_PIPELINE", async () => {
    const classification = {
      type: "NEGOTIATION_OFFER" as const,
      parseable: true,
      priceInRange: true,
      confidence: 0.97,
      extractedPrice: 38_500,
      extractedDays: 45,
      route: "FULL_NEGOTIATION_PIPELINE" as const,
    };

    const result = await dispatchByRoute({
      deal: mockDeal,
      message: "₹38,500, NET 45",
      classification,
      dealContext: {
        ...buildClassificationContextFromDeal(mockDeal),
        currencyCode: "INR",
      },
      commercial: mockCommercial,
    });

    expect(runNegotiationPathP0).toHaveBeenCalled();
    expect(result.handlerStage).toBe("P0.4_NEGOTIATION");
    expect(result.pmContent).toContain("40,000");
    expect(result.decisionAction).toBe("COUNTER");
  });

  it("delegates to chat path for soft decline", async () => {
    const result = await dispatchByRoute({
      deal: mockDeal,
      message: "₹2,50,000 NET 30",
      classification: {
        type: "NEGOTIATION_OFFER",
        parseable: true,
        priceInRange: false,
        confidence: 0.98,
        extractedPrice: 250_000,
        extractedDays: 30,
        route: "SOFT_DECLINE",
      },
      dealContext: {
        ...buildClassificationContextFromDeal(mockDeal),
        currencyCode: "INR",
      },
      commercial: mockCommercial,
    });

    expect(composeChatResponse).toHaveBeenCalled();
    expect(result.handlerStage).toBe("P0.3_CHAT");
  });
});

describe("runAgentTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(chatbotRepo.findDealById).mockResolvedValue(mockDeal);
    vi.mocked(chatbotRepo.findMessagesByDealId).mockResolvedValue([]);
    vi.mocked(chatbotRepo.createMessage)
      .mockResolvedValueOnce({ id: "msg-vendor-1" } as Awaited<
        ReturnType<typeof chatbotRepo.createMessage>
      >)
      .mockResolvedValueOnce({ id: "msg-pm-1" } as Awaited<
        ReturnType<typeof chatbotRepo.createMessage>
      >);
    vi.mocked(chatbotRepo.updateDeal).mockResolvedValue([1, []]);

    vi.mocked(runNegotiationPathP0).mockResolvedValue({
      content: "Counter at ₹40,000 on Net 45.",
      fromLlm: true,
      decision: {
        action: "COUNTER",
        utilityScore: 0.55,
        counterOffer: {
          total_price: 40_000,
          payment_terms: "Net 45",
          payment_terms_days: 45,
        },
        reasons: [],
      },
      explainability: null,
    });

    vi.mocked(composeChatResponse).mockResolvedValue({
      content: "Hi, share a quote when ready.",
      fromLlm: true,
      decisionAction: "CHAT_RESPONSE",
    });
  });

  it("persists vendor + PM messages and returns pmContent", async () => {
    const result = await runAgentTurn({
      dealId: "deal-1",
      message: "₹38,500, NET 45, 25-day delivery.",
      entryContext: { entryChannel: "internal_app", dealOwnerUserId: 42 },
    });

    expect(result.route).toBe("FULL_NEGOTIATION_PIPELINE");
    expect(result.handlerStage).toBe("P0.4_NEGOTIATION");
    expect(result.pmContent).toContain("40,000");
    expect(result.pmMessageId).toBe("msg-pm-1");
    expect(result.vendorMessageId).toBe("msg-vendor-1");
    expect(result.round).toBe(3);
    expect(result.generationSource).toBeDefined();
    expect(result.dealStatus).toBe("NEGOTIATING");
    expect(chatbotRepo.createMessage).toHaveBeenCalledTimes(2);
    expect(chatbotRepo.updateDeal).toHaveBeenCalled();
  });

  it("routes nonsense to chat LLM path", async () => {
    const result = await runAgentTurn({
      dealId: "deal-1",
      message: "asdfjkl 999 xyz pqr",
      entryContext: { entryChannel: "vendor_portal" },
    });

    expect(result.route).toBe("CHAT_RESPONSE");
    expect(result.handlerStage).toBe("P0.3_CHAT");
    expect(composeChatResponse).toHaveBeenCalled();
  });

  it("uses existing vendor message in phase-2 flow without duplicating vendor row", async () => {
    vi.mocked(chatbotRepo.findMessageById).mockResolvedValue({
      id: "msg-vendor-existing",
      dealId: "deal-1",
      role: "VENDOR",
      content: "₹38,500, NET 45, 25-day delivery.",
      round: 3,
    } as Awaited<ReturnType<typeof chatbotRepo.findMessageById>>);

    vi.mocked(chatbotRepo.createMessage).mockReset();
    vi.mocked(chatbotRepo.createMessage).mockResolvedValueOnce({
      id: "msg-pm-2",
    } as Awaited<ReturnType<typeof chatbotRepo.createMessage>>);

    const result = await runAgentTurn({
      dealId: "deal-1",
      existingVendorMessageId: "msg-vendor-existing",
      entryContext: { entryChannel: "vendor_portal" },
    });

    expect(result.vendorMessageId).toBe("msg-vendor-existing");
    expect(result.pmMessageId).toBe("msg-pm-2");
    expect(chatbotRepo.createMessage).toHaveBeenCalledTimes(1);
  });
});
