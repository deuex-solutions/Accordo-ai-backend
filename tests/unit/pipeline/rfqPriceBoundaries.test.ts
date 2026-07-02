import { describe, it, expect } from "vitest";
import type { ChatbotDeal } from "../../../src/models/chatbot-deal.js";
import {
  getPriceBoundariesFromDeal,
  readRfqPriceBoundsFromDeal,
  applyRfqBoundsToNegotiationConfig,
} from "../../../src/modules/chatbot/pipeline/load-negotiation-config-from-deal.js";
import { readEngineMinTotalPrice, readEngineMaxTotalPrice, resolveEngineTotalPriceBlock } from "../../../src/modules/chatbot/engine/pricing-field-keys.js";

function makeDeal(
  overrides: Partial<ChatbotDeal> & {
    Requisition?: { minTotalPrice?: number; maxTotalPrice?: number; typeOfCurrency?: string };
  } = {},
): ChatbotDeal {
  return {
    id: "deal-1",
    requisitionId: 1,
    negotiationConfigJson: {
      currency: "INR",
      wizardConfig: {
        priceQuantity: {
          targetUnitPrice: 400,
          maxAcceptablePrice: 480,
          minOrderQuantity: 1,
        },
      },
      parameters: {
        total_price: {
          min_total_price: 400,
          max_total_price: 480,
        },
      },
    },
    ...overrides,
  } as ChatbotDeal;
}

describe("readRfqPriceBoundsFromDeal", () => {
  it("returns RFQ min/max totals when present", () => {
    const bounds = readRfqPriceBoundsFromDeal(
      makeDeal({
        Requisition: {
          minTotalPrice: 39_900,
          maxTotalPrice: 59_900,
          typeOfCurrency: "INR",
        },
      }),
    );
    expect(bounds).toEqual({
      minTotalPrice: 39_900,
      maxTotalPrice: 59_900,
    });
  });
});

describe("getPriceBoundariesFromDeal", () => {
  it("prefers RFQ totals over stale wizard unit prices", () => {
    const result = getPriceBoundariesFromDeal(
      makeDeal({
        Requisition: {
          minTotalPrice: 39_900,
          maxTotalPrice: 59_900,
          typeOfCurrency: "INR",
        },
      }),
      "INR",
    );
    expect(result.minTotalPrice).toBe(39_900);
    expect(result.maxTotalPrice).toBe(59_900);
  });
});

describe("applyRfqBoundsToNegotiationConfig", () => {
  it("overwrites stale engine totals with RFQ band", () => {
    const deal = makeDeal({
      Requisition: {
        minTotalPrice: 39_900,
        maxTotalPrice: 59_900,
        typeOfCurrency: "INR",
      },
    });
    const raw = deal.negotiationConfigJson as import("../../../src/modules/chatbot/engine/utility.js").NegotiationConfig;
    const patched = applyRfqBoundsToNegotiationConfig(
      raw,
      39_900,
      59_900,
    );
    const block = resolveEngineTotalPriceBlock(patched.parameters);
    expect(readEngineMinTotalPrice(block)).toBe(39_900);
    expect(readEngineMaxTotalPrice(block)).toBe(59_900);
  });
});
