/**
 * Prevent leaking PM internal price band (min/max targets) to vendors.
 */

import {
  getCurrencySymbol,
  humanRoundPrice,
} from "../../../negotiation/intent/build-negotiation-intent.js";

const BAND_LEAK_PHRASES = [
  /\bbudget\s+range\b/i,
  /\bprice\s+range\b/i,
  /\bwithin\s+that\s+band\b/i,
  /\bour\s+(?:approximate\s+)?(?:budget|range)\b/i,
  /\b(?:min(?:imum)?|max(?:imum)?)\s+(?:total|price|budget)\b/i,
  /\btarget\s+price\b/i,
  /\bmax(?:imum)?\s+acceptable\b/i,
];

function formatBound(amount: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode);
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  return `${symbol}${humanRoundPrice(amount).toLocaleString(locale)}`;
}

function numericToken(amount: number, currencyCode: string): string {
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  return humanRoundPrice(amount).toLocaleString(locale);
}

/**
 * True when vendor-facing text appears to disclose internal min/max band.
 */
export function leaksInternalPriceBand(
  text: string,
  minTotalPrice: number,
  maxTotalPrice: number,
  currencyCode: string,
): boolean {
  if (BAND_LEAK_PHRASES.some((p) => p.test(text))) {
    return true;
  }

  const minFmt = formatBound(minTotalPrice, currencyCode);
  const maxFmt = formatBound(maxTotalPrice, currencyCode);
  const hasMin =
    text.includes(minFmt) || text.includes(numericToken(minTotalPrice, currencyCode));
  const hasMax =
    text.includes(maxFmt) || text.includes(numericToken(maxTotalPrice, currencyCode));

  return hasMin && hasMax;
}

export const VENDOR_NO_RANGE_SYSTEM_RULE = `Never disclose internal budget, target price, min/max acceptable totals, or any internal price band to the vendor. You may acknowledge the vendor's stated price only.`;
