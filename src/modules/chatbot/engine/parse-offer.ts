import type { Offer } from "./types.js";
import { parseDeliveryDate, calculateDeliveryDays } from "./delivery-utility.js";
import {
  detectCurrency,
  convertCurrencySync,
  type SupportedCurrency,
} from "../../../services/currency.service.js";

/**
 * Enhanced Offer Parser
 *
 * Parses informal vendor messages to extract:
 * - Price (with K/M shorthand, regional formats, currency detection)
 * - Payment terms (flexible formats: n45, net-45, 45 days)
 * - Delivery dates (explicit, relative, natural language)
 *
 * Updated February 2026:
 * - Added K/M shorthand support (29k, 1.5M)
 * - Added regional number formats (29,000 vs 29.000)
 * - Added flexible net term parsing (n45, net-45, payment in 45 days)
 * - Added multi-currency support with auto-conversion
 * - Added more date formats including ASAP, immediately
 *
 * @module parseOffer
 */

/**
 * Parse delivery information from text
 * Returns delivery date, days from today, and source type
 */
function parseDeliveryFromText(text: string): {
  delivery_date: string | null;
  delivery_days: number | null;
  delivery_source: 'explicit_date' | 'relative_days' | 'timeframe' | 'asap' | undefined;
  raw_delivery_text: string | undefined;
} {
  const t = text.toLowerCase();

  // Pattern 0: ASAP/Immediately - treat as 1-3 days
  const asapPatterns = [
    /\b(asap|immediately|urgent|right away|as soon as possible)\b/i,
  ];
  for (const pattern of asapPatterns) {
    const match = text.match(pattern);
    if (match) {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 2); // ASAP = 2 days
      return {
        delivery_date: deliveryDate.toISOString().split('T')[0],
        delivery_days: 2,
        delivery_source: 'asap',
        raw_delivery_text: match[0]
      };
    }
  }

  // Pattern 1: Explicit dates - "by March 15", "delivery March 15th 2026", "deliver by 2026-03-15"
  const explicitDatePatterns = [
    /(?:deliver(?:y|ed)?|ship(?:ping)?|by|before|on)\s+(?:by\s+)?(\w+\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?)/i,
    /(\d{4}-\d{2}-\d{2})/,  // ISO format
    /(\d{1,2}\/\d{1,2}\/\d{2,4})/,  // MM/DD/YYYY or DD/MM/YYYY
    /(\d{1,2}-\d{1,2}-\d{2,4})/,  // DD-MM-YYYY format
    /(\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?)/i,
  ];

  for (const pattern of explicitDatePatterns) {
    const match = text.match(pattern);
    if (match) {
      const parsedDate = parseDeliveryDate(match[1] || match[0]);
      if (parsedDate) {
        const days = calculateDeliveryDays(parsedDate);
        return {
          delivery_date: parsedDate.toISOString().split('T')[0],
          delivery_days: days,
          delivery_source: 'explicit_date',
          raw_delivery_text: match[0]
        };
      }
    }
  }

  // Pattern 2: Relative days - "within 30 days", "in 2 weeks", "15 day delivery", "5 days", "a week"
  const relativeDaysPatterns = [
    /(?:within|in|next)\s+(\d+)\s*(?:days?|business\s+days?)/i,
    /(\d+)\s*(?:days?|weeks?)\s*(?:delivery|shipping|lead\s*time)/i,
    /(?:delivery|shipping|lead\s*time)\s*(?:in|of|within)?\s*(\d+)\s*(?:days?|weeks?)/i,
    /\b(\d+)\s*days?\b(?!\s*(?:net|payment|terms))/i,  // Standalone "X days" not followed by payment terms
    /(?:within\s+)?(?:a|one)\s+(week|month)/i,  // "a week", "one month", "within a week"
  ];

  for (const pattern of relativeDaysPatterns) {
    const match = text.match(pattern);
    if (match) {
      let days: number;

      // Check for "a week" / "one week" / "a month" / "one month" patterns
      if (/\b(?:a|one)\s+week/i.test(match[0])) {
        days = 7;
      } else if (/\b(?:a|one)\s+month/i.test(match[0])) {
        days = 30;
      } else if (/week/i.test(match[0])) {
        // "X weeks" pattern
        const numMatch = match[1] ? parseInt(match[1], 10) : 1;
        days = numMatch * 7;
      } else if (/month/i.test(match[0])) {
        days = 30;
      } else {
        days = parseInt(match[1], 10);
      }

      // Skip if days is NaN
      if (isNaN(days)) {
        continue;
      }

      // Skip if this looks like payment terms (30, 45, 60, 90 days without delivery context)
      if ([30, 45, 60, 90].includes(days) && !/deliver|ship|within/i.test(match[0])) {
        continue;
      }

      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + days);

      return {
        delivery_date: deliveryDate.toISOString().split('T')[0],
        delivery_days: days,
        delivery_source: 'relative_days',
        raw_delivery_text: match[0]
      };
    }
  }

  // Pattern 3: Timeframes - "early March", "mid February", "end of March", "by end of April"
  const timeframePattern = /(?:by\s+)?(?:early|mid|late|end\s+of)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/i;
  const timeframeMatch = text.match(timeframePattern);
  if (timeframeMatch) {
    const parsedDate = parseDeliveryDate(timeframeMatch[0]);
    if (parsedDate) {
      const days = calculateDeliveryDays(parsedDate);
      return {
        delivery_date: parsedDate.toISOString().split('T')[0],
        delivery_days: days,
        delivery_source: 'timeframe',
        raw_delivery_text: timeframeMatch[0]
      };
    }
  }

  return {
    delivery_date: null,
    delivery_days: null,
    delivery_source: undefined,
    raw_delivery_text: undefined
  };
}

/**
 * Parse a number from text with support for:
 * - K/M shorthand (29k, 1.5M, 500K)
 * - Regional formats:
 *   - US: 1,234.56 (comma thousands, period decimal)
 *   - EU: 1.234,56 (period thousands, comma decimal)
 *   - Indian: 1,50,000 (lakhs format with irregular grouping)
 * - Currency removal
 *
 * @param text - Text containing a number
 * @returns Parsed number or null
 */
function parseNumber(text: string): number | null {
  if (!text) return null;

  let t = text.trim();

  // Remove currency symbols and codes
  t = t.replace(/[$€£₹]|rs\.?|inr|usd|eur|gbp|aud/gi, '').trim();

  // Handle K/M shorthand
  const shorthandMatch = t.match(/^([0-9]+(?:[.,][0-9]+)?)\s*([kmKM])$/);
  if (shorthandMatch) {
    const baseNum = parseFloat(shorthandMatch[1].replace(',', '.'));
    const multiplier = shorthandMatch[2].toLowerCase() === 'k' ? 1000 : 1000000;
    return baseNum * multiplier;
  }

  // Handle regional formats - detect format type and normalize

  // Indian format: 1,50,000 or 12,34,567 (lakhs/crores system)
  // Pattern: digits, then groups of 2 digits separated by commas
  if (/^\d{1,2}(?:,\d{2})*,\d{3}$/.test(t)) {
    // Indian lakhs format: 1,50,000 → 150000
    t = t.replace(/,/g, '');
  }
  // European format with decimal: 1.234,56 (period thousands, comma decimal)
  else if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(t)) {
    // EU format: 1.234,56 → 1234.56
    t = t.replace(/\./g, '').replace(',', '.');
  }
  // European format without decimal: 1.234 or 29.000 (period thousands only)
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(t)) {
    // EU format: 29.000 → 29000
    t = t.replace(/\./g, '');
  }
  // US format with decimal: 1,234.56 (comma thousands, period decimal)
  else if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(t)) {
    // US format: 1,234.56 → 1234.56
    t = t.replace(/,/g, '');
  }
  // US format without decimal: 1,234 or 29,000 (comma thousands only)
  else if (/^\d{1,3}(?:,\d{3})+$/.test(t)) {
    // US format: 29,000 → 29000
    t = t.replace(/,/g, '');
  }
  // Simple comma as decimal: 1234,56 (no thousands separator)
  else if (/^\d+,\d{1,2}$/.test(t)) {
    // Simple EU decimal: 1234,56 → 1234.56
    t = t.replace(',', '.');
  }
  // Fallback: remove all commas (treat as thousands separators)
  else {
    t = t.replace(/,/g, '');
  }

  const num = parseFloat(t);
  return isNaN(num) ? null : num;
}

/**
 * Number pattern that matches various regional formats:
 * - Plain: 29000, 1500.50
 * - US: 29,000 or 1,234.56
 * - EU: 29.000 or 1.234,56
 * - Indian: 1,50,000 or 12,34,567
 */
const REGIONAL_NUMBER_PATTERN = '(?:' +
  '[0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3}' +  // Indian: 1,50,000
  '|[0-9]{1,3}(?:\\.[0-9]{3})+(?:,[0-9]{1,2})?' +  // EU: 29.000 or 1.234,56
  '|[0-9]{1,3}(?:,[0-9]{3})+(?:\\.[0-9]+)?' +  // US: 29,000 or 1,234.56
  '|[0-9]+(?:[.,][0-9]+)?' +  // Plain: 29000 or 1500.50
  ')';

/**
 * Parse price from text with enhanced pattern matching
 * Supports US, EU, and Indian number formats
 *
 * @param text - Original message text
 * @returns Parsed price info
 */
function parsePriceFromText(text: string): {
  price: number | null;
  currency: SupportedCurrency | null;
  raw_price_text: string | undefined;
} {
  const t = text.trim();

  // Detect currency
  const currency = detectCurrency(t);

  // Try multiple price patterns (order matters - most specific first)
  let priceMatch: RegExpMatchArray | null = null;

  // Pattern 0: "Total:" or "Grand Total:" label — prefer this over individual line items
  // This handles multi-product vendor messages where individual prices appear before the total
  const totalLabelPattern = new RegExp(
    '(?:grand\\s+)?total\\s*:?\\s*(?:[$€£₹]|rs\\.?|inr|usd|eur|gbp|aud)?\\s*(' + REGIONAL_NUMBER_PATTERN + ')',
    'im'
  );
  priceMatch = t.match(totalLabelPattern);
  if (priceMatch) {
    const price = parseNumber(priceMatch[1]);
    if (price !== null && price > 0) {
      return { price, currency, raw_price_text: priceMatch[0] };
    }
  }

  // Pattern 1: Currency symbol/code + K/M shorthand (e.g., "$29k", "₹1.5M", "USD 500K")
  const kmPatterns = [
    /(?:[$€£₹]|rs\.?|inr|usd|eur|gbp|aud)\s*([0-9]+(?:[.,][0-9]+)?)\s*([kmKM])/gi,
    /([0-9]+(?:[.,][0-9]+)?)\s*([kmKM])\s*(?:[$€£₹]|rs\.?|inr|usd|eur|gbp|aud)/gi,
  ];
  for (const pattern of kmPatterns) {
    const match = t.match(pattern);
    if (match) {
      const numMatch = match[0].match(/([0-9]+(?:[.,][0-9]+)?)\s*([kmKM])/i);
      if (numMatch) {
        const baseNum = parseFloat(numMatch[1].replace(',', '.'));
        const multiplier = numMatch[2].toLowerCase() === 'k' ? 1000 : 1000000;
        return {
          price: baseNum * multiplier,
          currency,
          raw_price_text: match[0]
        };
      }
    }
  }

  // Pattern 2: Currency symbol + regional number format
  // Handles: ₹1,50,000, €29.000, $29,000, £1,234.56
  const currencyWithRegionalPattern = new RegExp(
    '(?:[$€£₹]|rs\\.?|inr|usd|eur|gbp|aud)\\s*(' + REGIONAL_NUMBER_PATTERN + ')',
    'i'
  );
  priceMatch = t.match(currencyWithRegionalPattern);
  if (priceMatch) {
    const price = parseNumber(priceMatch[1]);
    if (price !== null && price > 0) {
      return { price, currency, raw_price_text: priceMatch[0] };
    }
  }

  // Pattern 2b: Regional number + currency symbol (e.g., "29,000 USD", "1,50,000₹")
  const regionalWithCurrencyPattern = new RegExp(
    '(' + REGIONAL_NUMBER_PATTERN + ')\\s*(?:[$€£₹]|rs\\.?|inr|usd|eur|gbp|aud)',
    'i'
  );
  priceMatch = t.match(regionalWithCurrencyPattern);
  if (priceMatch) {
    const price = parseNumber(priceMatch[1]);
    if (price !== null && price > 0) {
      return { price, currency, raw_price_text: priceMatch[0] };
    }
  }

  // Pattern 3: "X per unit" or "X/unit"
  const perUnitPattern = new RegExp('(' + REGIONAL_NUMBER_PATTERN + ')\\s*(?:per\\s+unit|\\/unit)', 'i');
  priceMatch = t.match(perUnitPattern);
  if (priceMatch) {
    const price = parseNumber(priceMatch[1]);
    if (price !== null) {
      return { price, currency, raw_price_text: priceMatch[0] };
    }
  }

  // Pattern 4: "X Net Y" format (e.g., "29000 Net 60", "1,50,000 net45")
  const netPatternMatch = t.match(new RegExp(
    '\\b(' + REGIONAL_NUMBER_PATTERN + ')\\s+n(?:et)?\\s*[-]?\\s*(\\d+)(?:\\s*days?)?\\b',
    'i'
  ));
  if (netPatternMatch) {
    const price = parseNumber(netPatternMatch[1]);
    if (price !== null && price > 100) {
      return { price, currency, raw_price_text: netPatternMatch[0] };
    }
  }

  // Pattern 5: Standalone regional number (likely a price if large enough)
  // Match Indian, EU, or US formatted numbers
  const standalonePatterns = [
    // Indian format: 1,50,000 or 12,34,567
    /\b([0-9]{1,2}(?:,[0-9]{2})*,[0-9]{3})\b/,
    // EU format: 29.000 or 1.234,56
    /\b([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?)\b/,
    // US format: 29,000 or 1,234.56
    /\b([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?)\b/,
    // Plain large number: 29000
    /\b([0-9]{4,}(?:\.[0-9]+)?)\b/,
  ];

  for (const pattern of standalonePatterns) {
    const match = t.match(pattern);
    if (match) {
      const price = parseNumber(match[1]);
      if (price !== null && price > 100) {
        // Check if this number appears to be net terms
        const beforeNum = t.slice(0, match.index || 0);
        const afterNum = t.slice((match.index || 0) + match[0].length);
        const looksLikeTerms = /n(?:et)?$/i.test(beforeNum.trim()) || /^(?:\s*days?)/i.test(afterNum);

        if (!looksLikeTerms) {
          return { price, currency, raw_price_text: match[0] };
        }
      }
    }
  }

  return { price: null, currency, raw_price_text: undefined };
}

/**
 * Parse payment terms from text with flexible matching
 *
 * Supports:
 * - "Net 30", "Net 45", "Net 60", "Net 90"
 * - "n30", "n45", "n60", "n90" (shorthand)
 * - "net-30", "net-45" (hyphenated)
 * - "30 days", "45 days" (standalone)
 * - "payment in 30 days", "pay within 45 days"
 * - "30 day terms", "45-day payment"
 *
 * @param text - Original message text
 * @returns Parsed payment terms info
 */
function parsePaymentTermsFromText(text: string): {
  payment_terms: string | null;
  payment_terms_days: number | null;
  raw_terms_days: number | null;
  non_standard_terms: boolean;
  raw_terms_text: string | undefined;
} {
  const t = text.toLowerCase();

  // Pattern 1: "Net X" or "Net X days" - accept ANY number (1-120)
  let termsMatch = t.match(/\bn(?:et)?\s*[-]?\s*(\d+)(?:\s*days?)?\b/i);
  if (termsMatch) {
    const days = Number(termsMatch[1]);
    if (days >= 1 && days <= 120) {
      return {
        payment_terms: `Net ${days}`,
        payment_terms_days: days,
        raw_terms_days: days,
        non_standard_terms: days !== 30 && days !== 60 && days !== 90,
        raw_terms_text: termsMatch[0]
      };
    }
  }

  // Pattern 2: "payment terms X", "terms X", "payment X days"
  termsMatch = t.match(/\b(?:payment\s+)?terms?\s*(?:of\s+)?(\d+)\s*(?:days?)?\b/i);
  if (termsMatch) {
    const days = Number(termsMatch[1]);
    if (days >= 1 && days <= 120) {
      return {
        payment_terms: `Net ${days}`,
        payment_terms_days: days,
        raw_terms_days: days,
        non_standard_terms: days !== 30 && days !== 60 && days !== 90,
        raw_terms_text: termsMatch[0]
      };
    }
  }

  // Pattern 3: "pay(ment) in X days", "pay within X days"
  termsMatch = t.match(/\bpay(?:ment)?\s+(?:in|within)\s+(\d+)\s*days?\b/i);
  if (termsMatch) {
    const days = Number(termsMatch[1]);
    if (days >= 1 && days <= 120) {
      return {
        payment_terms: `Net ${days}`,
        payment_terms_days: days,
        raw_terms_days: days,
        non_standard_terms: days !== 30 && days !== 60 && days !== 90,
        raw_terms_text: termsMatch[0]
      };
    }
  }

  // Pattern 4: "X day(s) payment" or "X-day terms"
  termsMatch = t.match(/\b(\d+)\s*[-]?\s*days?\s*(?:payment|terms?|credit)\b/i);
  if (termsMatch) {
    const days = Number(termsMatch[1]);
    if (days >= 15 && days <= 120) {
      return {
        payment_terms: `Net ${days}`,
        payment_terms_days: days,
        raw_terms_days: days,
        non_standard_terms: days !== 30 && days !== 60 && days !== 90,
        raw_terms_text: termsMatch[0]
      };
    }
  }

  // Pattern 5: Standalone "X days" - only if X is in typical payment range (15-120)
  // and NOT associated with delivery context
  termsMatch = t.match(/\b(\d+)\s*days?\b(?!\s*(?:delivery|shipping|lead|within|by|before))/i);
  if (termsMatch) {
    const days = Number(termsMatch[1]);
    // Only consider as payment terms if in typical range and not clearly delivery
    if (days >= 15 && days <= 120 && !/deliver|ship|arriv/i.test(t)) {
      return {
        payment_terms: `Net ${days}`,
        payment_terms_days: days,
        raw_terms_days: days,
        non_standard_terms: days !== 30 && days !== 60 && days !== 90,
        raw_terms_text: termsMatch[0]
      };
    }
  }

  return {
    payment_terms: null,
    payment_terms_days: null,
    raw_terms_days: null,
    non_standard_terms: false,
    raw_terms_text: undefined
  };
}

/**
 * Main offer parsing function - enhanced with all new patterns
 *
 * @param text - Vendor message text
 * @param requisitionCurrency - Currency of the requisition (for conversion)
 * @returns Parsed offer
 */
export function parseOfferRegex(text: string, requisitionCurrency?: SupportedCurrency): Offer {
  // Parse price
  const priceInfo = parsePriceFromText(text);
  let total_price = priceInfo.price;

  // Convert currency if needed
  let currencyConverted = false;
  let originalCurrency: SupportedCurrency | null = null;
  let originalPrice: number | null = null;

  if (total_price !== null && priceInfo.currency && requisitionCurrency && priceInfo.currency !== requisitionCurrency) {
    originalCurrency = priceInfo.currency;
    originalPrice = total_price;
    total_price = convertCurrencySync(total_price, priceInfo.currency, requisitionCurrency);
    currencyConverted = true;
  }

  // Parse payment terms
  const termsInfo = parsePaymentTermsFromText(text);

  // Parse delivery
  const deliveryInfo = parseDeliveryFromText(text);

  // Build meta object
  const meta: {
    raw_terms_days?: number;
    non_standard_terms?: boolean;
    delivery_source?: 'explicit_date' | 'relative_days' | 'timeframe' | 'asap';
    raw_delivery_text?: string;
    raw_price_text?: string;
    raw_terms_text?: string;
    currency_detected?: SupportedCurrency;
    currency_converted?: boolean;
    original_currency?: SupportedCurrency;
    original_price?: number;
  } = {};

  if (termsInfo.raw_terms_days !== null) {
    meta.raw_terms_days = termsInfo.raw_terms_days;
    meta.non_standard_terms = termsInfo.non_standard_terms;
  }

  if (deliveryInfo.delivery_source) {
    meta.delivery_source = deliveryInfo.delivery_source;
  }

  if (deliveryInfo.raw_delivery_text) {
    meta.raw_delivery_text = deliveryInfo.raw_delivery_text;
  }

  if (priceInfo.raw_price_text) {
    meta.raw_price_text = priceInfo.raw_price_text;
  }

  if (termsInfo.raw_terms_text) {
    meta.raw_terms_text = termsInfo.raw_terms_text;
  }

  if (priceInfo.currency) {
    meta.currency_detected = priceInfo.currency;
  }

  if (currencyConverted) {
    meta.currency_converted = true;
    meta.original_currency = originalCurrency!;
    meta.original_price = originalPrice!;
  }

  return {
    total_price,
    payment_terms: termsInfo.payment_terms,
    payment_terms_days: termsInfo.payment_terms_days,
    delivery_date: deliveryInfo.delivery_date,
    delivery_days: deliveryInfo.delivery_days,
    meta: Object.keys(meta).length > 0 ? meta : undefined
  };
}

/**
 * Enhanced parseOffer that includes delivery parsing
 * Alias for parseOfferRegex with full delivery support
 */
export function parseOfferWithDelivery(text: string, requisitionCurrency?: SupportedCurrency): Offer {
  return parseOfferRegex(text, requisitionCurrency);
}

/**
 * Parse shorthand message format (e.g., "29000 net45 5days")
 * Optimized for compact vendor messages
 *
 * @param text - Compact message text
 * @param requisitionCurrency - Currency for conversion
 * @returns Parsed offer
 */
export function parseShorthandOffer(text: string, requisitionCurrency?: SupportedCurrency): Offer {
  // For shorthand, use the same parser - it handles these cases
  return parseOfferRegex(text, requisitionCurrency);
}

export default {
  parseOfferRegex,
  parseOfferWithDelivery,
  parseShorthandOffer,
};
