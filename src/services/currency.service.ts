/**
 * Currency Exchange Rate Service
 *
 * Provides real-time currency conversion using external API.
 * Includes caching to minimize API calls and fallback rates.
 *
 * @module currency.service
 */

import logger from '../config/logger.js';

/**
 * Supported currencies (matches requisition model)
 */
export type SupportedCurrency = 'USD' | 'INR' | 'EUR' | 'GBP' | 'AUD';

/**
 * Currency symbol mapping
 */
export const CURRENCY_SYMBOLS: Record<string, SupportedCurrency> = {
  '$': 'USD',
  '₹': 'INR',
  '€': 'EUR',
  '£': 'GBP',
  'A$': 'AUD',
};

/**
 * Currency code aliases (case-insensitive matching)
 */
export const CURRENCY_ALIASES: Record<string, SupportedCurrency> = {
  'usd': 'USD',
  'dollar': 'USD',
  'dollars': 'USD',
  'inr': 'INR',
  'rs': 'INR',
  'rs.': 'INR',
  'rupee': 'INR',
  'rupees': 'INR',
  'eur': 'EUR',
  'euro': 'EUR',
  'euros': 'EUR',
  'gbp': 'GBP',
  'pound': 'GBP',
  'pounds': 'GBP',
  'aud': 'AUD',
};

/**
 * Exchange rate cache entry
 */
interface CacheEntry {
  rates: Record<string, number>;
  timestamp: number;
}

/**
 * Fallback exchange rates (approximate, for when API is unavailable)
 * Base: USD
 */
const FALLBACK_RATES: Record<SupportedCurrency, number> = {
  USD: 1.0,
  INR: 83.5,    // 1 USD = ~83.5 INR
  EUR: 0.92,    // 1 USD = ~0.92 EUR
  GBP: 0.79,    // 1 USD = ~0.79 GBP
  AUD: 1.53,    // 1 USD = ~1.53 AUD
};

/**
 * Cache duration in milliseconds (1 hour)
 */
const CACHE_DURATION_MS = 60 * 60 * 1000;

/**
 * Rate cache (keyed by base currency)
 */
const rateCache: Map<string, CacheEntry> = new Map();

/**
 * Detect currency from text
 *
 * @param text - Text containing currency indicator
 * @returns Detected currency or null
 *
 * @example
 * detectCurrency("$500") // 'USD'
 * detectCurrency("500 INR") // 'INR'
 * detectCurrency("€1000") // 'EUR'
 * detectCurrency("Rs. 5000") // 'INR'
 */
export function detectCurrency(text: string): SupportedCurrency | null {
  const t = text.trim();

  // Check for symbols first (more specific)
  for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
    if (t.includes(symbol)) {
      return currency;
    }
  }

  // Check for currency codes/names (case-insensitive)
  const lower = t.toLowerCase();
  for (const [alias, currency] of Object.entries(CURRENCY_ALIASES)) {
    // Use word boundary matching to avoid false positives
    const regex = new RegExp(`\\b${alias.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(lower)) {
      return currency;
    }
  }

  return null;
}

/**
 * Fetch exchange rates from external API
 *
 * Uses exchangerate-api.com free tier (1500 requests/month)
 *
 * @param baseCurrency - Base currency for rates
 * @returns Exchange rates or null on failure
 */
async function fetchExchangeRates(baseCurrency: SupportedCurrency): Promise<Record<string, number> | null> {
  try {
    // Check cache first
    const cached = rateCache.get(baseCurrency);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      logger.debug('[CurrencyService] Using cached rates', { baseCurrency });
      return cached.rates;
    }

    // Fetch from API
    // Note: For production, use EXCHANGE_RATE_API_KEY from env
    const apiKey = process.env.EXCHANGE_RATE_API_KEY || 'free';
    const url = apiKey === 'free'
      ? `https://api.exchangerate-api.com/v4/latest/${baseCurrency}`
      : `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${baseCurrency}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json() as { rates: Record<string, number> };

    // Cache the rates
    rateCache.set(baseCurrency, {
      rates: data.rates,
      timestamp: Date.now(),
    });

    logger.info('[CurrencyService] Fetched fresh exchange rates', {
      baseCurrency,
      ratesCount: Object.keys(data.rates).length,
    });

    return data.rates;
  } catch (error) {
    logger.warn('[CurrencyService] Failed to fetch exchange rates, using fallback', {
      baseCurrency,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Convert amount between currencies
 *
 * @param amount - Amount to convert
 * @param fromCurrency - Source currency
 * @param toCurrency - Target currency
 * @returns Converted amount
 *
 * @example
 * await convertCurrency(1000, 'USD', 'INR') // ~83500
 * await convertCurrency(5000, 'INR', 'USD') // ~60
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency
): Promise<number> {
  // Same currency - no conversion needed
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // Try to get live rates
  const rates = await fetchExchangeRates(fromCurrency);

  if (rates && rates[toCurrency]) {
    const converted = amount * rates[toCurrency];
    logger.debug('[CurrencyService] Converted using live rates', {
      amount,
      fromCurrency,
      toCurrency,
      rate: rates[toCurrency],
      result: converted,
    });
    return converted;
  }

  // Fallback: Convert via USD as intermediate
  const amountInUSD = amount / FALLBACK_RATES[fromCurrency];
  const converted = amountInUSD * FALLBACK_RATES[toCurrency];

  logger.debug('[CurrencyService] Converted using fallback rates', {
    amount,
    fromCurrency,
    toCurrency,
    result: converted,
  });

  return converted;
}

/**
 * Synchronous conversion using fallback rates only
 * Use when async conversion is not possible
 *
 * @param amount - Amount to convert
 * @param fromCurrency - Source currency
 * @param toCurrency - Target currency
 * @returns Converted amount using fallback rates
 */
export function convertCurrencySync(
  amount: number,
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency
): number {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // Convert via USD as intermediate
  const amountInUSD = amount / FALLBACK_RATES[fromCurrency];
  return amountInUSD * FALLBACK_RATES[toCurrency];
}

/**
 * Get exchange rate between two currencies
 *
 * @param fromCurrency - Source currency
 * @param toCurrency - Target currency
 * @returns Exchange rate or fallback
 */
export async function getExchangeRate(
  fromCurrency: SupportedCurrency,
  toCurrency: SupportedCurrency
): Promise<number> {
  if (fromCurrency === toCurrency) {
    return 1.0;
  }

  const rates = await fetchExchangeRates(fromCurrency);

  if (rates && rates[toCurrency]) {
    return rates[toCurrency];
  }

  // Fallback calculation
  return FALLBACK_RATES[toCurrency] / FALLBACK_RATES[fromCurrency];
}

/**
 * Format currency for display
 *
 * @param amount - Amount to format
 * @param currency - Currency code
 * @returns Formatted string
 */
export function formatCurrency(amount: number, currency: SupportedCurrency): string {
  // Locale-aware formatting (May 2026):
  // - INR uses 'en-IN' for Indian comma grouping (X,XX,XXX)
  // - All others use 'en-US' for Western grouping (XXX,XXX)
  // - Strip .00 decimals for whole numbers (human-natural)
  const locale = currency === 'INR' ? 'en-IN' : 'en-US';
  const isWholeNumber = amount === Math.floor(amount);

  const symbols: Record<SupportedCurrency, string> = {
    USD: '$',
    INR: '₹',
    EUR: '€',
    GBP: '£',
    AUD: 'A$',
  };

  const symbol = symbols[currency] || currency;
  const formatted = amount.toLocaleString(locale, {
    minimumFractionDigits: isWholeNumber ? 0 : 2,
    maximumFractionDigits: isWholeNumber ? 0 : 2,
  });

  return `${symbol}${formatted}`;
}

/**
 * Clear the rate cache (useful for testing)
 */
export function clearRateCache(): void {
  rateCache.clear();
}

export default {
  detectCurrency,
  convertCurrency,
  convertCurrencySync,
  getExchangeRate,
  formatCurrency,
  clearRateCache,
  CURRENCY_SYMBOLS,
  CURRENCY_ALIASES,
  FALLBACK_RATES,
};
