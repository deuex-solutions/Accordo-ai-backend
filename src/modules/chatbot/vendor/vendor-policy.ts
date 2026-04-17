/**
 * Vendor Policy Configuration
 *
 * Defines default negotiation policies for different vendor scenarios.
 * Each scenario has different concession willingness and constraints.
 *
 * Updated January 2026:
 * - Added product category margins for vendor profit calculation
 * - Added vendor scenario generator for vendor-perspective negotiation
 * - Added AI-PM response generation for automated PM responses
 */

import type { VendorPolicy, VendorScenario } from './types.js';

// ============================================================================
// Product Category Margins
// ============================================================================

/**
 * Category margin configuration for vendor profit calculations
 */
export interface CategoryMargin {
  /** Target profit margin vendor aims for */
  target: number;
  /** Minimum acceptable profit margin */
  min: number;
  /** Maximum profit margin (aggressive pricing) */
  max: number;
}

/**
 * Default profit margins by product category
 * Used to generate vendor scenario chips based on profit goals
 */
export const CATEGORY_MARGINS: Record<string, CategoryMargin> = {
  'Electronics': { target: 0.15, min: 0.08, max: 0.25 },
  'Raw Materials': { target: 0.08, min: 0.05, max: 0.15 },
  'Office Supplies': { target: 0.20, min: 0.12, max: 0.30 },
  'Machinery': { target: 0.12, min: 0.06, max: 0.20 },
  'Packaging': { target: 0.18, min: 0.10, max: 0.28 },
  'Services': { target: 0.25, min: 0.15, max: 0.40 },
  'Chemicals': { target: 0.10, min: 0.05, max: 0.18 },
  'Textiles': { target: 0.18, min: 0.10, max: 0.30 },
  'Food & Beverage': { target: 0.12, min: 0.06, max: 0.22 },
  'Construction': { target: 0.15, min: 0.08, max: 0.25 },
  'default': { target: 0.15, min: 0.08, max: 0.25 },
};

/**
 * Get category margin for a product category
 */
export function getCategoryMargin(category: string): CategoryMargin {
  return CATEGORY_MARGINS[category] || CATEGORY_MARGINS['default'];
}

// ============================================================================
// Vendor Scenario Generation (for Vendor Perspective)
// ============================================================================

/**
 * Chip for displaying offer details
 */
export interface OfferChip {
  label: string;
  value: string;
  type: 'price' | 'terms' | 'delivery';
}

/**
 * Vendor scenario offer structure
 */
export interface VendorScenarioOffer {
  type: VendorScenario;
  label: string;
  description: string;
  offer: {
    price: number;
    paymentTerms: string;
    deliveryDate: string;
  };
  /** Pre-formatted chips for UI display */
  chips: OfferChip[];
  /** Natural language message with offer details inline */
  message: string;
  messages: string[];
  expectedPmReaction: string;
}

/**
 * Format price for display (localized)
 */
function formatPrice(price: number, locale: string = 'en-US', currency: string = 'USD'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
}

/**
 * Format date for display
 */
function formatDeliveryDate(dateStr: string, locale: string = 'en-US'): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

/**
 * Generate chips for a scenario offer
 */
function generateOfferChips(
  price: number,
  paymentTerms: string,
  deliveryDate: string,
  locale: string = 'en-US',
  currency: string = 'USD'
): OfferChip[] {
  return [
    { label: 'Price', value: formatPrice(price, locale, currency), type: 'price' },
    { label: 'Terms', value: paymentTerms, type: 'terms' },
    { label: 'Delivery', value: formatDeliveryDate(deliveryDate, locale), type: 'delivery' },
  ];
}

/**
 * Generate natural language message with offer details inline
 */
function generateInlineMessage(
  price: number,
  paymentTerms: string,
  deliveryDate: string,
  scenarioType: VendorScenario,
  locale: string = 'en-US',
  currency: string = 'USD'
): string {
  const priceStr = formatPrice(price, locale, currency);
  const dateStr = formatDeliveryDate(deliveryDate, locale);

  switch (scenarioType) {
    case 'HARD':
      return `I can offer ${priceStr}/unit with ${paymentTerms} payment terms. Delivery by ${dateStr}.`;
    case 'MEDIUM':
      return `We propose ${priceStr}/unit with ${paymentTerms}. Expected delivery: ${dateStr}.`;
    case 'SOFT':
      return `Our best offer: ${priceStr}/unit with ${paymentTerms}. We can deliver by ${dateStr}.`;
    default:
      return `Offer: ${priceStr}/unit, ${paymentTerms}, delivery by ${dateStr}.`;
  }
}

/**
 * Generate vendor scenarios based on PM's price range configuration
 *
 * UPDATED January 2026: Vendor scenarios now generate prices based on PM's
 * target and max acceptable prices from the wizard configuration.
 *
 * From PM's perspective:
 * - target = lowest price PM wants to pay (ideal)
 * - max_acceptable = ceiling PM will pay (walkaway above this)
 *
 * From VENDOR's perspective (this function):
 * - HARD: Aggressive vendor position (10-25% above PM's max) - risks rejection
 *         Example: Target=$90, Max=$100 -> HARD=$110-$125
 * - MEDIUM: Competitive offer (near PM's max) - balanced approach
 *         Example: Target=$90, Max=$100 -> MEDIUM=$95-$100
 * - SOFT: Quick close (near PM's target) - prioritize closing
 *         Example: Target=$90, Max=$100 -> SOFT=$90-$95
 *
 * @param pmLastOffer - PM's last counter-offer (if any)
 * @param productCategory - Product category for context
 * @param pmTargetPrice - PM's target unit price (what PM wants to pay)
 * @param pmMaxPrice - PM's maximum acceptable price (PM's ceiling)
 * @param quantity - Order quantity
 * @param locale - Locale for formatting
 * @param currency - Currency for formatting
 */
export function generateVendorScenarios(
  pmLastOffer: { price: number; paymentTerms: string; deliveryDate: string } | null,
  productCategory: string,
  pmTargetPrice: number,
  pmMaxPrice: number,
  quantity: number = 1,
  locale: string = 'en-US',
  currency: string = 'USD'
): VendorScenarioOffer[] {
  const pmTerms = pmLastOffer?.paymentTerms || 'Net 30';
  const pmDelivery = pmLastOffer?.deliveryDate || getDateInDays(30);

  // Calculate the range between target and max
  const priceRange = pmMaxPrice - pmTargetPrice;

  // HARD: 10-25% above PM's max (aggressive, risks WALK_AWAY from PM)
  // Vendor prioritizes maximum profit over closing the deal
  // For Target=$90, Max=$100 -> HARD ~ $117.50 (17.5% above max)
  const hardPrice = Math.round(pmMaxPrice * 1.175 * 100) / 100;

  // MEDIUM: At or near PM's max (competitive but profitable)
  // Balanced approach - PM will likely counter, negotiation continues
  // For Target=$90, Max=$100 -> MEDIUM ~ $97.50 (between target and max, slightly above midpoint)
  const mediumPrice = Math.round((pmTargetPrice + priceRange * 0.75) * 100) / 100;

  // SOFT: Near PM's target (prioritize closing)
  // Quick close - near PM's ideal, likely to be accepted with minimal counter
  // For Target=$90, Max=$100 -> SOFT ~ $92.50 (midpoint between target and 50% of range)
  const softPrice = Math.round((pmTargetPrice + priceRange * 0.25) * 100) / 100;

  // Delivery dates for each scenario
  const hardDelivery = getDateInDays(45);  // Longer delivery for HARD
  const mediumDelivery = getDateInDays(30); // Standard delivery

  return [
    {
      type: 'HARD',
      label: 'Maximum Profit',
      description: `Above max (~$${hardPrice.toFixed(2)})`,
      offer: {
        price: hardPrice,
        paymentTerms: 'Net 15',
        deliveryDate: hardDelivery,
      },
      chips: generateOfferChips(hardPrice, 'Net 15', hardDelivery, locale, currency),
      message: generateInlineMessage(hardPrice, 'Net 15', hardDelivery, 'HARD', locale, currency),
      messages: generateHardScenarioMessages(hardPrice, quantity, pmMaxPrice),
      expectedPmReaction: 'WALK_AWAY',
    },
    {
      type: 'MEDIUM',
      label: 'Balanced Deal',
      description: `Near max (~$${mediumPrice.toFixed(2)})`,
      offer: {
        price: mediumPrice,
        paymentTerms: 'Net 45',
        deliveryDate: mediumDelivery,
      },
      chips: generateOfferChips(mediumPrice, 'Net 45', mediumDelivery, locale, currency),
      message: generateInlineMessage(mediumPrice, 'Net 45', mediumDelivery, 'MEDIUM', locale, currency),
      messages: generateMediumScenarioMessages(mediumPrice, quantity, pmMaxPrice),
      expectedPmReaction: 'COUNTER',
    },
    {
      type: 'SOFT',
      label: 'Quick Close',
      description: `Near target (~$${softPrice.toFixed(2)})`,
      offer: {
        price: softPrice,
        paymentTerms: pmTerms,
        deliveryDate: pmDelivery,
      },
      chips: generateOfferChips(softPrice, pmTerms, pmDelivery, locale, currency),
      message: generateInlineMessage(softPrice, pmTerms, pmDelivery, 'SOFT', locale, currency),
      messages: generateSoftScenarioMessages(softPrice, quantity, pmMaxPrice, pmTerms),
      expectedPmReaction: 'ACCEPT',
    },
  ];
}

/**
 * Generate messages for HARD scenario (maximize vendor profit)
 * @param vendorPrice - The vendor's asking price (above PM's max)
 * @param quantity - Order quantity
 * @param pmMaxPrice - PM's maximum acceptable price (for reference in message)
 */
function generateHardScenarioMessages(vendorPrice: number, quantity: number, pmMaxPrice: number): string[] {
  return [
    `Thank you for your interest. For ${quantity} units, our price is $${vendorPrice.toFixed(2)} per unit with payment due within 15 days. This includes our premium quality guarantee and priority support.`,
    `I appreciate the inquiry. Given current market conditions and our quality standards, we can offer $${vendorPrice.toFixed(2)} per unit with Net 15 terms. Delivery can be arranged within 6 weeks.`,
    `After reviewing your requirements, our offer is $${vendorPrice.toFixed(2)} per unit. This pricing reflects our commitment to quality and includes comprehensive warranty coverage.`,
  ];
}

/**
 * Generate messages for MEDIUM scenario (balanced approach)
 * UPDATED January 2026: Changed from Net 30 to Net 45 for better middle ground
 * @param vendorPrice - The vendor's asking price (slightly above PM's max)
 * @param quantity - Order quantity
 * @param pmMaxPrice - PM's maximum acceptable price (for reference in message)
 */
function generateMediumScenarioMessages(vendorPrice: number, quantity: number, pmMaxPrice: number): string[] {
  return [
    `I've reviewed your offer carefully. We can meet at $${vendorPrice.toFixed(2)} per unit with Net 45 payment terms. This is a fair compromise that works for both parties.`,
    `Thank you for your proposal. Let me offer $${vendorPrice.toFixed(2)} per unit with Net 45 terms. We can arrange delivery within 4 weeks.`,
    `I understand your position. Would $${vendorPrice.toFixed(2)} per unit with Net 45 payment work for you? I believe this balances both our needs.`,
  ];
}

/**
 * Generate messages for SOFT scenario (close to PM's max - quick close)
 * @param vendorPrice - The vendor's asking price (near PM's max)
 * @param quantity - Order quantity
 * @param pmMaxPrice - PM's maximum acceptable price (for reference)
 * @param pmTerms - PM's preferred payment terms
 */
function generateSoftScenarioMessages(vendorPrice: number, quantity: number, pmMaxPrice: number, pmTerms: string): string[] {
  return [
    `I want to make this work. I can offer $${vendorPrice.toFixed(2)} per unit with your ${pmTerms} terms. Let's finalize this deal.`,
    `We'd be happy to work with you. My best offer is $${vendorPrice.toFixed(2)} per unit, accepting your payment terms. Shall we proceed?`,
    `To move forward, I can accept $${vendorPrice.toFixed(2)} per unit with ${pmTerms}. This is close to what you're asking - can we close?`,
  ];
}

/**
 * Helper to get date string N days from now
 */
function getDateInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// ============================================================================
// AI-PM Response Generation
// ============================================================================

/**
 * AI-PM decision result
 */
export interface AiPmDecision {
  action: 'ACCEPT' | 'COUNTER' | 'ESCALATE' | 'WALK_AWAY' | 'ASK_CLARIFY';
  message: string;
  counterOffer?: {
    price: number;
    paymentTerms: string;
    deliveryDate: string;
  };
  utility: number;
  reasoning: string;
}

/**
 * PM's negotiation stance from wizard config
 */
export interface PmStance {
  targetUnitPrice: number;
  maxAcceptablePrice: number;
  idealPaymentDays: number;
  maxPaymentDays: number;
  requiredDeliveryDate: string;
  preferredDeliveryDate?: string;
  walkawayThreshold: number;
  acceptThreshold: number;
  escalateThreshold: number;
  maxRounds: number;
}

/**
 * Generate AI-PM response based on vendor's offer and PM's stance
 *
 * @param vendorOffer - The vendor's offer (price, terms, delivery)
 * @param pmStance - PM's negotiation parameters from wizard config
 * @param currentRound - Current negotiation round
 * @returns AI-PM decision with response message
 */
export function generateAiPmResponse(
  vendorOffer: {
    price: number | null;
    paymentTerms: string | null;
    deliveryDate: string | null;
  },
  pmStance: PmStance,
  currentRound: number
): AiPmDecision {
  // Handle incomplete offer
  if (vendorOffer.price === null) {
    return {
      action: 'ASK_CLARIFY',
      message: `I need more details on your pricing. Could you provide a specific unit price for this order?`,
      utility: 0,
      reasoning: 'Vendor did not provide a clear price',
    };
  }

  // Calculate utility score
  const priceUtility = calculatePriceUtility(vendorOffer.price, pmStance);
  const termsUtility = calculateTermsUtility(vendorOffer.paymentTerms, pmStance);
  const deliveryUtility = calculateDeliveryUtility(vendorOffer.deliveryDate, pmStance);

  // Weighted average (price most important)
  const totalUtility = priceUtility * 0.50 + termsUtility * 0.30 + deliveryUtility * 0.20;

  // Check for max rounds
  if (currentRound >= pmStance.maxRounds) {
    return {
      action: 'ESCALATE',
      message: `We've reached our maximum negotiation rounds. I'll need to escalate this to our procurement committee for a final decision. Thank you for your patience.`,
      utility: totalUtility,
      reasoning: `Max rounds (${pmStance.maxRounds}) reached`,
    };
  }

  // Decision based on utility thresholds
  if (totalUtility >= pmStance.acceptThreshold) {
    return {
      action: 'ACCEPT',
      message: `I'm pleased to accept your offer of $${vendorOffer.price.toFixed(2)} per unit${vendorOffer.paymentTerms ? ` with ${vendorOffer.paymentTerms} terms` : ''}. This meets our requirements. Let's proceed with the agreement.`,
      utility: totalUtility,
      reasoning: `Utility ${(totalUtility * 100).toFixed(0)}% >= accept threshold ${(pmStance.acceptThreshold * 100).toFixed(0)}%`,
    };
  }

  if (totalUtility < pmStance.walkawayThreshold) {
    return {
      action: 'WALK_AWAY',
      message: `I appreciate your time, but unfortunately this offer of $${vendorOffer.price.toFixed(2)} is significantly above our budget. We'll need to explore other options for this procurement.`,
      utility: totalUtility,
      reasoning: `Utility ${(totalUtility * 100).toFixed(0)}% < walkaway threshold ${(pmStance.walkawayThreshold * 100).toFixed(0)}%`,
    };
  }

  if (totalUtility < pmStance.escalateThreshold) {
    // Generate counter-offer closer to PM's targets
    const counterPrice = calculateCounterPrice(vendorOffer.price, pmStance, currentRound);
    const counterTerms = pmStance.idealPaymentDays <= 30 ? 'Net 30' :
                         pmStance.idealPaymentDays <= 60 ? 'Net 60' : 'Net 90';

    return {
      action: 'COUNTER',
      message: `Thank you for your offer. However, $${vendorOffer.price.toFixed(2)} is higher than our target. Based on our budget and market analysis, I can offer $${counterPrice.toFixed(2)} per unit with ${counterTerms} payment terms. What do you think?`,
      counterOffer: {
        price: counterPrice,
        paymentTerms: counterTerms,
        deliveryDate: pmStance.requiredDeliveryDate,
      },
      utility: totalUtility,
      reasoning: `Utility ${(totalUtility * 100).toFixed(0)}% between walkaway and escalate, countering`,
    };
  }

  // Counter with more aggressive offer
  const counterPrice = calculateCounterPrice(vendorOffer.price, pmStance, currentRound);
  const counterTerms = pmStance.idealPaymentDays <= 30 ? 'Net 30' :
                       pmStance.idealPaymentDays <= 60 ? 'Net 60' : 'Net 90';

  return {
    action: 'COUNTER',
    message: `I appreciate the offer of $${vendorOffer.price.toFixed(2)}. We're getting closer. I can go up to $${counterPrice.toFixed(2)} per unit with ${counterTerms} terms and delivery by ${pmStance.requiredDeliveryDate}. Can we close at this?`,
    counterOffer: {
      price: counterPrice,
      paymentTerms: counterTerms,
      deliveryDate: pmStance.requiredDeliveryDate,
    },
    utility: totalUtility,
    reasoning: `Utility ${(totalUtility * 100).toFixed(0)}% in counter zone, making progress`,
  };
}

/**
 * Calculate utility for price component (0-1)
 */
function calculatePriceUtility(vendorPrice: number, pmStance: PmStance): number {
  if (vendorPrice <= pmStance.targetUnitPrice) {
    return 1.0; // At or below target = perfect
  }
  if (vendorPrice >= pmStance.maxAcceptablePrice) {
    return 0.0; // At or above max = zero utility
  }
  // Linear interpolation between target and max
  const range = pmStance.maxAcceptablePrice - pmStance.targetUnitPrice;
  const distance = vendorPrice - pmStance.targetUnitPrice;
  return 1.0 - (distance / range);
}

/**
 * Calculate utility for payment terms component (0-1)
 */
function calculateTermsUtility(paymentTerms: string | null, pmStance: PmStance): number {
  if (!paymentTerms) return 0.5; // Neutral if not specified

  const daysMatch = paymentTerms.match(/Net\s*(\d+)/i);
  if (!daysMatch) return 0.5;

  const days = parseInt(daysMatch[1], 10);

  if (days <= pmStance.idealPaymentDays) {
    return 1.0; // Better than ideal
  }
  if (days >= pmStance.maxPaymentDays) {
    return 0.3; // At max acceptable
  }
  // Linear interpolation
  const range = pmStance.maxPaymentDays - pmStance.idealPaymentDays;
  const distance = days - pmStance.idealPaymentDays;
  return 1.0 - (distance / range) * 0.7; // Never goes below 0.3
}

/**
 * Calculate utility for delivery date component (0-1)
 */
function calculateDeliveryUtility(deliveryDate: string | null, pmStance: PmStance): number {
  if (!deliveryDate) return 0.5; // Neutral if not specified

  const vendorDate = new Date(deliveryDate);
  const requiredDate = new Date(pmStance.requiredDeliveryDate);
  const preferredDate = pmStance.preferredDeliveryDate
    ? new Date(pmStance.preferredDeliveryDate)
    : requiredDate;

  if (vendorDate <= preferredDate) {
    return 1.0; // Meets or beats preferred
  }
  if (vendorDate <= requiredDate) {
    return 0.8; // Meets required
  }
  // Late penalty
  const daysLate = Math.ceil((vendorDate.getTime() - requiredDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(0.1, 0.8 - (daysLate * 0.1)); // 10% penalty per day late
}

/**
 * Calculate PM's counter-offer price
 */
function calculateCounterPrice(vendorPrice: number, pmStance: PmStance, round: number): number {
  // Start closer to target, move toward max over rounds
  const progressFactor = Math.min(round / pmStance.maxRounds, 0.8);
  const range = pmStance.maxAcceptablePrice - pmStance.targetUnitPrice;
  const counterPrice = pmStance.targetUnitPrice + (range * progressFactor * 0.6);

  // Don't offer more than vendor is asking
  return Math.round(Math.min(counterPrice, vendorPrice * 0.95) * 100) / 100;
}

/**
 * Generate PM's opening offer message from wizard config
 */
export function generatePmOpeningOffer(
  pmStance: PmStance,
  productName: string,
  quantity: number
): string {
  const paymentTerms = pmStance.idealPaymentDays <= 30 ? 'Net 30' :
                       pmStance.idealPaymentDays <= 60 ? 'Net 60' : 'Net 90';

  return `Good day! I'm reaching out regarding our purchase of ${quantity} units of ${productName}. ` +
         `Based on our budget and market analysis, I'd like to propose $${pmStance.targetUnitPrice.toFixed(2)} per unit ` +
         `with ${paymentTerms} payment terms. We need delivery by ${pmStance.requiredDeliveryDate}. ` +
         `What can you offer us?`;
}

/**
 * Default vendor policy (baseline)
 */
export const DEFAULT_VENDOR_POLICY: VendorPolicy = {
  minPrice: 90,
  startPrice: 110,
  preferredTerms: 'Net 30',
  concessionStep: 2,
  maxRounds: 6,
  minAcceptableTerms: 'Net 60',
};

/**
 * Get vendor policy for a specific scenario
 *
 * IMPORTANT: basePrice should be PM's maxAcceptablePrice (from wizard config)
 * This ensures vendor prices are ABOVE PM's target price.
 *
 * From PM's perspective:
 * - targetUnitPrice = lowest price PM wants to pay (ideal)
 * - maxAcceptablePrice = ceiling PM will pay (walkaway above this)
 *
 * From VENDOR's perspective (this function):
 * - basePrice = PM's maxAcceptablePrice (reference point)
 * - startPrice = vendor's opening offer (should be >= basePrice)
 * - minPrice = vendor's floor price (lowest they'll go)
 *
 * Example with PM's target=$90, max=$100 (basePrice=$100):
 * - HARD:     startPrice=$115, minPrice=$100 (won't go below PM's max)
 * - MEDIUM:   startPrice=$110, minPrice=$95  (might go slightly below max)
 * - SOFT:     startPrice=$105, minPrice=$90  (can match PM's target)
 * - WALK_AWAY: startPrice=$110, minPrice=$100 (firm at PM's max)
 *
 * @param scenario - Vendor negotiation scenario
 * @param basePrice - PM's maxAcceptablePrice (what PM is willing to pay as ceiling)
 * @returns Vendor policy configuration
 */
export function getScenarioPolicy(
  scenario: VendorScenario,
  basePrice: number = 100
): VendorPolicy {
  switch (scenario) {
    case 'HARD':
      // Resistant vendor: small concessions, won't go below PM's max
      // Vendor believes their product is premium and worth more
      return {
        minPrice: basePrice * 1.0, // Floor at PM's max - vendor won't give discount
        startPrice: basePrice * 1.15, // Starts 15% above PM's max
        preferredTerms: 'Net 30',
        concessionStep: basePrice * 0.015, // 1.5% concessions only
        maxRounds: 8, // Willing to negotiate longer
        minAcceptableTerms: 'Net 30', // Won't budge on terms
      };

    case 'MEDIUM':
      // Balanced vendor: moderate concessions, can go slightly below PM's max
      // Vendor is competitive but maintains margins
      return {
        minPrice: basePrice * 0.95, // Can go 5% below PM's max (but still above target usually)
        startPrice: basePrice * 1.10, // Starts 10% above PM's max
        preferredTerms: 'Net 30',
        concessionStep: basePrice * 0.02, // 2% concessions
        maxRounds: 7, // Moderate negotiation length
        minAcceptableTerms: 'Net 60', // Moderate term flexibility
      };

    case 'SOFT':
      // Flexible vendor: eager to close, can match PM's expectations
      // Vendor prioritizes volume/relationship over margin
      return {
        minPrice: basePrice * 0.90, // Can go 10% below PM's max (near PM's target)
        startPrice: basePrice * 1.05, // Starts only 5% above PM's max
        preferredTerms: 'Net 30',
        concessionStep: basePrice * 0.025, // 2.5% concessions
        maxRounds: 6, // Standard negotiation length
        minAcceptableTerms: 'Net 90', // Flexible on terms
      };

    case 'WALK_AWAY':
      // Inflexible vendor: no concessions, take it or leave it
      // Vendor has other buyers or limited capacity
      return {
        minPrice: basePrice * 1.0, // Won't go below PM's max
        startPrice: basePrice * 1.10, // Starts 10% above PM's max
        preferredTerms: 'Net 30',
        concessionStep: 0, // No price concessions
        maxRounds: 3, // Quick to walk away
        minAcceptableTerms: 'Net 30', // No term flexibility
      };

    default:
      return DEFAULT_VENDOR_POLICY;
  }
}

/**
 * Merge custom policy with scenario defaults
 *
 * @param scenario - Base scenario
 * @param customPolicy - Custom policy overrides
 * @param basePrice - Base price for calculations
 * @returns Merged vendor policy
 */
export function mergeVendorPolicy(
  scenario: VendorScenario,
  customPolicy: Partial<VendorPolicy> = {},
  basePrice: number = 100
): VendorPolicy {
  const scenarioPolicy = getScenarioPolicy(scenario, basePrice);

  return {
    ...scenarioPolicy,
    ...customPolicy,
  };
}

/**
 * Calculate next vendor price based on policy and round
 *
 * @param policy - Vendor negotiation policy
 * @param currentPrice - Current vendor price
 * @param round - Current negotiation round
 * @param accordoPrice - Accordo's counter-offer price (influences concession)
 * @returns Next vendor price
 */
export function calculateNextVendorPrice(
  policy: VendorPolicy,
  currentPrice: number,
  round: number,
  accordoPrice: number | null
): number {
  // If at or below minimum price, don't go lower
  if (currentPrice <= policy.minPrice) {
    return policy.minPrice;
  }

  // If past max rounds, stick to minimum price or walk away
  if (round >= policy.maxRounds) {
    return policy.minPrice;
  }

  // Calculate concession
  let concession = policy.concessionStep;

  // If Accordo's price is close to vendor's, make smaller concession
  if (accordoPrice !== null) {
    const gap = currentPrice - accordoPrice;
    if (gap < policy.concessionStep * 2) {
      // If gap is small, make a final move toward middle
      concession = gap * 0.5;
    }
  }

  // Apply concession but don't go below min price
  const nextPrice = Math.max(currentPrice - concession, policy.minPrice);

  return Math.round(nextPrice * 100) / 100; // Round to 2 decimals
}

/**
 * Determine if vendor should walk away
 *
 * @param policy - Vendor policy
 * @param round - Current round
 * @param currentPrice - Current vendor price
 * @param accordoPrice - Accordo's latest offer
 * @returns True if vendor should walk away
 */
export function shouldVendorWalkAway(
  policy: VendorPolicy,
  round: number,
  currentPrice: number,
  accordoPrice: number | null
): boolean {
  // Walk away if exceeded max rounds
  if (round > policy.maxRounds) {
    return true;
  }

  // Walk away if Accordo's price is unreasonably low (below min price - 10%)
  if (accordoPrice !== null && accordoPrice < policy.minPrice * 0.9) {
    return true;
  }

  // Walk away if at minimum price and Accordo still wants lower
  if (currentPrice <= policy.minPrice && accordoPrice !== null && accordoPrice < currentPrice) {
    return true;
  }

  return false;
}

/**
 * Calculate next vendor payment terms based on policy
 *
 * @param policy - Vendor policy
 * @param currentTerms - Current payment terms
 * @param accordoTerms - Accordo's desired terms
 * @returns Next payment terms vendor will offer
 */
export function calculateNextVendorTerms(
  policy: VendorPolicy,
  currentTerms: 'Net 30' | 'Net 60' | 'Net 90',
  accordoTerms: 'Net 30' | 'Net 60' | 'Net 90' | null
): 'Net 30' | 'Net 60' | 'Net 90' {
  // If no flexibility, stick to preferred terms
  if (policy.minAcceptableTerms === policy.preferredTerms) {
    return policy.preferredTerms;
  }

  // If Accordo wants longer terms and vendor can accommodate
  if (accordoTerms) {
    const termsOrder = ['Net 30', 'Net 60', 'Net 90'];
    const accordoIndex = termsOrder.indexOf(accordoTerms);
    const minIndex = termsOrder.indexOf(policy.minAcceptableTerms || 'Net 90');

    if (accordoIndex <= minIndex) {
      // Vendor can accept Accordo's terms
      return accordoTerms;
    } else {
      // Vendor offers their worst acceptable terms
      return policy.minAcceptableTerms || 'Net 90';
    }
  }

  // Default to preferred terms
  return currentTerms || policy.preferredTerms;
}
