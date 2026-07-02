import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatbotDeal } from "../../../src/models/chatbot-deal.js";
import {
  resolveRfqCurrencyCode,
  resolveRfqCurrencyCodeSync,
  resolveDealCommercialContext,
} from "../../../src/modules/chatbot/pipeline/deal-commercial-context.js";

vi.mock("../../../src/models/index.js", () => ({
  default: {
    Requisition: {
      findByPk: vi.fn(),
    },
  },
}));

import models from "../../../src/models/index.js";

function makeDeal(
  overrides: Partial<ChatbotDeal> & {
    Requisition?: { typeOfCurrency?: string | null };
  } = {},
): ChatbotDeal {
  return {
    id: "deal-1",
    requisitionId: "req-1",
    negotiationConfigJson: { currency: "USD" },
    ...overrides,
  } as ChatbotDeal;
}

describe("resolveRfqCurrencyCodeSync", () => {
  it("uses requisition typeOfCurrency and ignores stale stored USD", () => {
    const deal = makeDeal({
      Requisition: { typeOfCurrency: "INR" },
      negotiationConfigJson: { currency: "USD" },
    });
    expect(resolveRfqCurrencyCodeSync(deal)).toBe("INR");
  });

  it("throws when requisitionId exists but Requisition was not included", () => {
    const deal = makeDeal({ negotiationConfigJson: { currency: "USD" } });
    expect(() => resolveRfqCurrencyCodeSync(deal)).toThrow(
      /Requisition currency required/,
    );
  });

  it("uses stored config only when deal has no requisitionId", () => {
    const deal = makeDeal({
      requisitionId: null as unknown as string,
      negotiationConfigJson: { currency: "EUR" },
    });
    expect(resolveRfqCurrencyCodeSync(deal)).toBe("EUR");
  });

  it("throws when currency cannot be resolved", () => {
    const deal = makeDeal({
      requisitionId: null as unknown as string,
      negotiationConfigJson: null,
    });
    expect(() => resolveRfqCurrencyCodeSync(deal)).toThrow(
      /cannot be resolved/,
    );
  });
});

describe("resolveRfqCurrencyCode", () => {
  beforeEach(() => {
    vi.mocked(models.Requisition.findByPk).mockReset();
  });

  it("loads INR from requisition when deal was fetched without include", async () => {
    const deal = makeDeal({ negotiationConfigJson: { currency: "USD" } });
    vi.mocked(models.Requisition.findByPk).mockResolvedValue({
      typeOfCurrency: "INR",
    } as never);

    await expect(resolveRfqCurrencyCode(deal)).resolves.toBe("INR");
  });

  it("throws when requisition has no typeOfCurrency", async () => {
    const deal = makeDeal();
    vi.mocked(models.Requisition.findByPk).mockResolvedValue({
      typeOfCurrency: null,
    } as never);

    await expect(resolveRfqCurrencyCode(deal)).rejects.toThrow(
      /has no typeOfCurrency/,
    );
  });
});

describe("resolveDealCommercialContext", () => {
  it("returns symbol and locale for INR", async () => {
    const deal = makeDeal({ Requisition: { typeOfCurrency: "INR" } });
    await expect(resolveDealCommercialContext(deal)).resolves.toEqual({
      currencyCode: "INR",
      currencySymbol: "₹",
      priceLocale: "en-IN",
    });
  });
});
