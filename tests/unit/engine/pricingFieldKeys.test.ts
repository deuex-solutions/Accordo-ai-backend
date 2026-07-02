import { describe, it, expect } from "vitest";
import {
  readWizardMinTotalPrice,
  readWizardMaxTotalPrice,
  resolveRfqTotalPriceBounds,
  resolveRfqTotalPriceBoundsWithProducts,
  sumRequisitionProductTotals,
} from "../../../src/modules/chatbot/engine/pricing-field-keys.js";

describe("readWizardMinTotalPrice / readWizardMaxTotalPrice", () => {
  it("scales legacy per-unit fields by order quantity", () => {
    const pq = {
      minTotalPrice: null,
      maxTotalPrice: null,
      targetUnitPrice: 400,
      maxAcceptablePrice: 480,
      minOrderQuantity: 100,
    };
    expect(readWizardMinTotalPrice(pq)).toBe(40_000);
    expect(readWizardMaxTotalPrice(pq)).toBe(48_000);
  });

  it("uses canonical totals without scaling", () => {
    const pq = {
      minTotalPrice: 35_000,
      maxTotalPrice: 50_000,
      targetUnitPrice: 400,
      maxAcceptablePrice: 480,
      minOrderQuantity: 100,
    };
    expect(readWizardMinTotalPrice(pq)).toBe(35_000);
    expect(readWizardMaxTotalPrice(pq)).toBe(50_000);
  });
});

describe("resolveRfqTotalPriceBounds", () => {
  it("prefers RFQ header min/max totals", () => {
    expect(
      resolveRfqTotalPriceBounds(
        { minTotalPrice: 39_900, maxTotalPrice: 59_900 },
        { minTotalPrice: 400, maxTotalPrice: 480 },
      ),
    ).toEqual({ minTotalPrice: 39_900, maxTotalPrice: 59_900 });
  });

  it("falls back to summed product totals", () => {
    expect(
      resolveRfqTotalPriceBounds(
        { minTotalPrice: null, maxTotalPrice: null },
        { minTotalPrice: 50_000, maxTotalPrice: 60_000 },
      ),
    ).toEqual({ minTotalPrice: 50_000, maxTotalPrice: 60_000 });
  });
});

describe("sumRequisitionProductTotals", () => {
  it("multiplies qty × unit price like ProductDetails UI", () => {
    expect(
      sumRequisitionProductTotals([
        { qty: 100, minUnitPrice: 399, maxUnitPrice: 599 },
      ]),
    ).toEqual({
      minTotalPrice: 39_900,
      maxTotalPrice: 59_900,
      totalQuantity: 100,
    });
  });
});

describe("resolveRfqTotalPriceBoundsWithProducts", () => {
  it("rejects header unit price when product sum is contract total", () => {
    expect(
      resolveRfqTotalPriceBoundsWithProducts(
        { minTotalPrice: 399, maxTotalPrice: null },
        [{ qty: 100, minUnitPrice: 399, maxUnitPrice: 599 }],
      ),
    ).toEqual({ minTotalPrice: 39_900, maxTotalPrice: 59_900 });
  });
});
