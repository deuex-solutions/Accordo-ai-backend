/**
 * MESO - Multiple Equivalent Simultaneous Offers
 *
 * Pactum-style negotiation technique that generates 2-3 equivalent-utility offers
 * per counter-offer round, enabling preference discovery through vendor selection.
 *
 * Key Concepts:
 * - All offers have approximately the same total utility (within 2% variance)
 * - Each offer trades off different parameters (price vs terms vs delivery)
 * - Vendor's choice reveals their true preferences
 * - Preferences are tracked to improve future counter-offers
 *
 * @module meso
 */

import type {
  Offer,
  ExtendedOffer,
  ResolvedNegotiationConfig,
  NegotiationState,
  MesoSelectionRecord,
  MesoCycleState,
  FinalOfferState,
  NegotiationPhase,
} from "./types.js";
import { calculateWeightedUtilityFromResolved } from "./weighted-utility.js";
import { humanRoundPrice } from "../../../negotiation/intent/build-negotiation-intent.js";
import {
  formatCurrency,
  type SupportedCurrency,
} from "../../../services/currency.service.js";

// ============================================
// Currency helpers
// ============================================

/** Default currency used when a deal does not specify one. */
const DEFAULT_CURRENCY: SupportedCurrency = "USD";

/**
 * Format a price for inclusion in a MESO option description or tradeoff.
 * Uses the deal's currency (from NegotiationConfig.currency) so every
 * MESO card stays consistent with the requisition and chat.
 */
function formatMesoPrice(
  amount: number | null | undefined,
  currency: SupportedCurrency,
): string {
  if (amount == null) return "N/A";
  return formatCurrency(amount, currency);
}

/**
 * Pluralize delivery/warranty labels — avoids "1 days" or "1 months" in MESO card text.
 */
function fmtDays(n: number | null | undefined): string {
  const v = n ?? 0;
  return v === 1 ? "1-day" : `${v}-day`;
}
function fmtMonths(n: number | null | undefined): string {
  const v = n ?? 0;
  return v === 1 ? "1-month" : `${v}-month`;
}

// ============================================
// VENDOR PREFERENCE PROFILE (Learning-Based MESO)
// ============================================

/**
 * Vendor preference profile learned from MESO selections
 */
export interface VendorPreferenceProfile {
  /** Inferred weight for price (0-1, higher = vendor prefers price-focused offers) */
  priceWeight: number;
  /** Inferred weight for payment terms (0-1) */
  termsWeight: number;
  /** Inferred weight for delivery (0-1) */
  deliveryWeight: number;
  /** Inferred weight for warranty (0-1) */
  warrantyWeight: number;
  /** Last selected offer type */
  lastSelectedOfferType:
    | "offer_1"
    | "offer_2"
    | "offer_3"
    | "price"
    | "terms"
    | "balanced"
    | null;
  /** History of selections with offer details */
  selectionHistory: MesoSelectionRecord[];
  /** Number of times vendor selected price-focused */
  priceSelectionCount: number;
  /** Number of times vendor selected terms-focused */
  termsSelectionCount: number;
  /** Number of times vendor selected balanced */
  balancedSelectionCount: number;
}

/**
 * Create empty vendor preference profile
 */
export function createEmptyPreferenceProfile(): VendorPreferenceProfile {
  return {
    priceWeight: 0.5,
    termsWeight: 0.5,
    deliveryWeight: 0.5,
    warrantyWeight: 0.5,
    lastSelectedOfferType: null,
    selectionHistory: [],
    priceSelectionCount: 0,
    termsSelectionCount: 0,
    balancedSelectionCount: 0,
  };
}

/**
 * Build vendor preference profile from negotiation state
 */
export function buildPreferenceProfile(
  state: NegotiationState | null,
): VendorPreferenceProfile {
  const profile = createEmptyPreferenceProfile();

  if (!state || !state.mesoSelections || state.mesoSelections.length === 0) {
    return profile;
  }

  profile.selectionHistory = state.mesoSelections;

  // Count selections by type
  for (const selection of state.mesoSelections) {
    const type = selection.selectedType;
    if (type === "offer_1" || type === "price") {
      profile.priceSelectionCount++;
    } else if (type === "offer_2" || type === "terms") {
      profile.termsSelectionCount++;
    } else if (type === "offer_3" || type === "balanced") {
      profile.balancedSelectionCount++;
    }
  }

  // Calculate weights based on selection frequency
  const totalSelections = state.mesoSelections.length;
  if (totalSelections > 0) {
    profile.priceWeight =
      0.5 + (profile.priceSelectionCount / totalSelections) * 0.3;
    profile.termsWeight =
      0.5 + (profile.termsSelectionCount / totalSelections) * 0.3;
    // Balanced selections indicate no strong preference, keep at 0.5
  }

  // Set last selected type
  const lastSelection = state.mesoSelections[state.mesoSelections.length - 1];
  profile.lastSelectedOfferType = lastSelection.selectedType;

  return profile;
}

/**
 * Previous MESO round data for ensuring dynamic offers
 */
export interface PreviousMesoRound {
  round: number;
  options: MesoOption[];
  selectedOptionId?: string;
}

// ============================================
// MESO Types
// ============================================

/**
 * A single MESO option
 */
export interface MesoOption {
  /** Unique identifier for this option */
  id: string;
  /** The counter-offer */
  offer: ExtendedOffer;
  /** Calculated utility score */
  utility: number;
  /** Human-readable label (e.g., "Price-Focused", "Terms-Focused") */
  label: string;
  /** Description of trade-offs in this option */
  description: string;
  /** Which parameters are emphasized */
  emphasis: ("price" | "payment_terms" | "delivery" | "warranty")[];
  /** Trade-offs made in this option */
  tradeoffs: string[];
  /** Pre-formatted labels for frontend display (May 2026) */
  formattedLabels?: {
    deliveryLabel: string;    // e.g. "1-day delivery" or "30-day delivery"
    warrantyLabel: string;    // e.g. "1-month warranty" or "12-month warranty"
    paymentLabel: string;     // e.g. "Net 30"
  };
}

/**
 * Result of MESO generation
 */
export interface MesoResult {
  /** 2-3 equivalent-utility options */
  options: MesoOption[];
  /** Target utility score */
  targetUtility: number;
  /** Actual variance between options (should be < 2%) */
  variance: number;
  /** Whether MESO generation was successful */
  success: boolean;
  /** Reason for failure if not successful */
  reason?: string;
  /**
   * Currency for all options (from the deal's NegotiationConfig).
   * The frontend uses this to format the numeric Price field on every card,
   * and the backend uses it to build `description` and `tradeoffs` strings.
   */
  currency: SupportedCurrency;

  // Flow control flags (February 2026 - MESO + Others flow)
  /** Whether to show "Others" button (false for final MESO) */
  showOthers: boolean;
  /** Whether this is the final MESO (no more cycles) */
  isFinal: boolean;
  /** Whether text input should be disabled when MESO is shown */
  inputDisabled: boolean;
  /** Message to show when input is disabled */
  disabledMessage?: string;
  /** Current negotiation phase */
  phase: NegotiationPhase;
  /** Stall prompt if detected ("Is this your final offer?") */
  stallPrompt?: string;
}

/**
 * Vendor's selection from MESO options
 */
export interface MesoSelection {
  /** Which option was selected */
  selectedOptionId: string;
  /** The selected offer */
  selectedOffer: ExtendedOffer;
  /** Inferred preferences based on selection */
  inferredPreferences: {
    /** Parameter with highest inferred importance */
    primaryPreference: string;
    /** Confidence in inference (0-1) */
    confidence: number;
    /** All inferred weights adjustments */
    preferenceAdjustments: Record<string, number>;
  };
}

/**
 * MESO round record for database storage
 */
export interface MesoRoundRecord {
  id?: string;
  dealId: string;
  round: number;
  options: MesoOption[];
  vendorSelection?: MesoSelection;
  inferredPreferences?: Record<string, number>;
  createdAt?: Date;
}

// ============================================
// MESO Generation
// ============================================

/**
 * Generate MESO options for a counter-offer round
 *
 * Strategy:
 * 1. Calculate base counter-offer using standard logic
 * 2. Generate variations that trade off different parameters
 * 3. Ensure all options have utility within 2% of each other
 * 4. Return 2-3 options for vendor selection
 *
 * @param config - Resolved negotiation configuration
 * @param vendorOffer - Current vendor offer
 * @param round - Current negotiation round
 * @param targetUtility - Target utility for counter-offers (0-1)
 */
export function generateMesoOptions(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  targetUtility: number = 0.65,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  lastAccordoCounterPrice?: number | null,
): MesoResult {
  const options: MesoOption[] = [];
  const variance_target = 0.02; // 2% variance

  try {
    // ============================================
    // Option 1: Best Price + Best Delivery + Medium Terms + Min Warranty
    // "Value-focused" - lowest price, fastest delivery, shorter warranty
    // ============================================

    const offer1 = generatePriceFocusedOffer(
      config,
      vendorOffer,
      round,
      targetUtility,
      lastAccordoCounterPrice,
    );
    const offer1Utility = calculateWeightedUtilityFromResolved(offer1, config);

    options.push({
      id: `meso_${round}_offer1`,
      offer: offer1,
      utility: offer1Utility.totalUtility,
      label: "Offer 1",
      description: `${formatMesoPrice(offer1.total_price, currency)}, ${fmtDays(offer1.delivery_days)} delivery, Net ${offer1.payment_terms_days}`,
      emphasis: ["price", "delivery"],
      tradeoffs: [
        `${offer1.warranty_months || 0} ${(offer1.warranty_months || 0) === 1 ? "month" : "months"} warranty`,
        `Net ${offer1.payment_terms_days} payment`,
      ],
    });

    // ============================================
    // Option 2: Medium Price + Best Terms + Medium Delivery + Standard Warranty
    // "Cash flow friendly" - longest payment terms
    // ============================================

    const offer2 = generateTermsFocusedOffer(
      config,
      vendorOffer,
      round,
      targetUtility,
      lastAccordoCounterPrice,
    );
    const offer2Utility = calculateWeightedUtilityFromResolved(offer2, config);

    options.push({
      id: `meso_${round}_offer2`,
      offer: offer2,
      utility: offer2Utility.totalUtility,
      label: "Offer 2",
      description: `${formatMesoPrice(offer2.total_price, currency)}, Net ${offer2.payment_terms_days}, ${fmtMonths(offer2.warranty_months)} warranty`,
      emphasis: ["payment_terms"],
      tradeoffs: [
        `${formatMesoPrice(offer2.total_price, currency)} price`,
        `${fmtDays(offer2.delivery_days)} delivery`,
      ],
    });

    // ============================================
    // Option 3: Medium Price + Medium Terms + Best Delivery + Extended Warranty
    // "Full service" - best delivery + extended warranty
    // ============================================

    const offer3 = generateBalancedOffer(
      config,
      vendorOffer,
      round,
      targetUtility,
      lastAccordoCounterPrice,
    );
    const offer3Utility = calculateWeightedUtilityFromResolved(offer3, config);

    options.push({
      id: `meso_${round}_offer3`,
      offer: offer3,
      utility: offer3Utility.totalUtility,
      label: "Offer 3",
      description: `${formatMesoPrice(offer3.total_price, currency)}, ${fmtDays(offer3.delivery_days)} delivery, ${fmtMonths(offer3.warranty_months)} warranty`,
      emphasis: ["delivery", "warranty"],
      tradeoffs: [
        `${formatMesoPrice(offer3.total_price, currency)} price`,
        `Net ${offer3.payment_terms_days} payment`,
      ],
    });

    // ============================================
    // Normalize utilities to minimize variance
    // ============================================

    const utilities = options.map((o) => o.utility);
    const avgUtility = utilities.reduce((a, b) => a + b, 0) / utilities.length;
    const maxVariance = Math.max(
      ...utilities.map((u) => Math.abs(u - avgUtility)),
    );

    // If variance is too high, adjust offers
    if (maxVariance > variance_target) {
      // Re-adjust offers to bring them closer together
      adjustOffersForVariance(options, config, avgUtility, variance_target);
    }

    // Recalculate final variance
    const finalUtilities = options.map((o) => o.utility);
    const finalAvg =
      finalUtilities.reduce((a, b) => a + b, 0) / finalUtilities.length;
    const finalVariance = Math.max(
      ...finalUtilities.map((u) => Math.abs(u - finalAvg)),
    );

    // Dedup guard (May 2026): when the convergence floor clamps Option 1's
    // price discount, multiple options can end up identical on all visible
    // dimensions (price, delivery, payment_terms). Detect and force variation.
    deduplicateMesoOptions(options, config);

    // Re-render labels with FINAL prices (Apr 2026): variance adjustment
    // can mutate offer.total_price after the original description was set.
    renderMesoDescriptions(options, currency);

    return {
      options,
      targetUtility: finalAvg,
      variance: finalVariance,
      success: true,
      currency,
      // Flow control flags for phased negotiation
      showOthers: true,
      isFinal: false,
      inputDisabled: true,
      disabledMessage:
        'Select an offer above or click "Others" to enter your counter-offer',
      phase: "MESO_PRESENTATION" as NegotiationPhase,
    };
  } catch (error) {
    return {
      options: [],
      targetUtility,
      variance: 0,
      success: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown error generating MESO options",
      currency,
      // Default flow control flags for failed generation
      showOthers: false,
      isFinal: false,
      inputDisabled: false,
      phase: "NORMAL_NEGOTIATION" as NegotiationPhase,
    };
  }
}

// ============================================
// MESO OFFER GENERATION HELPERS
// ============================================

/**
 * Calculate base counter-offer price based on round and priority
 */
function calculateBasePrice(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  lastAccordoCounterPrice?: number | null,
): number {
  const { targetPrice, maxAcceptablePrice, priceRange, priority } = config;

  // Base aggressiveness by priority
  const aggressiveness =
    priority === "HIGH" ? 0.25 : priority === "LOW" ? 0.45 : 0.35;
  const roundAdjustment = Math.min(0.1, round * 0.02);

  // Convergence-band path (Apr 2026, tolerance updated): when the vendor's
  // offer is already within our acceptable range (with ~1.5% tolerance to
  // handle small drift / rounding) AND we've made a prior counter, anchor
  // the base price INSIDE [lastAccordoCounter, vendorOffer]. Bracketing the
  // convergence zone — instead of restarting from config target — prevents
  // MESO from offering options below where the negotiation already settled.
  //
  // Tolerance reason: when our last counter sits at e.g. £418,999.99 and
  // maxAcceptable is £418,900, a strict `<= maxAcceptable` check disables
  // the floor entirely. A 1.5% tolerance keeps the convergence anchor live
  // even when prices drift fractionally above the configured ceiling.
  const TOLERANCE = 0.015;
  const ceilingWithTol = maxAcceptablePrice * (1 + TOLERANCE);
  const vendorPrice = vendorOffer.total_price ?? null;
  const hasFloor =
    lastAccordoCounterPrice != null &&
    lastAccordoCounterPrice > 0 &&
    lastAccordoCounterPrice <= ceilingWithTol;
  const vendorWithinBand =
    vendorPrice != null &&
    vendorPrice >= targetPrice &&
    vendorPrice <= ceilingWithTol;

  if (hasFloor && vendorWithinBand) {
    const floor = lastAccordoCounterPrice as number;
    const ceiling = vendorPrice as number;
    const span = Math.max(0, ceiling - floor);
    const innerProgress = 0.55 + Math.min(0.15, round * 0.03);
    let basePrice = floor + span * innerProgress;
    basePrice = Math.min(basePrice, ceiling);
    basePrice = Math.max(basePrice, floor);
    return humanRoundPrice(Math.round(basePrice * 100) / 100);
  }

  // Standard path (no convergence band): use the original formula.
  let basePrice = targetPrice + priceRange * (aggressiveness + roundAdjustment);
  if (vendorPrice != null) {
    basePrice = Math.min(basePrice, vendorPrice);
  }
  basePrice = Math.min(basePrice, maxAcceptablePrice);

  // Apply convergence floor in case we have one but vendor is outside band.
  if (hasFloor) {
    basePrice = Math.max(basePrice, lastAccordoCounterPrice as number);
  }

  return humanRoundPrice(Math.round(basePrice * 100) / 100);
}

/**
 * Re-render MESO descriptions with the FINAL prices/terms (Apr 2026).
 * Variance normalization can change offer prices after the initial
 * description was written, leaving stale prices while the
 * actual offer is £365,159. Calling this after adjustOffersForVariance
 * rewrites the labels so they always match the actual offer.
 */
export function renderMesoDescriptions(
  options: MesoOption[],
  currency: SupportedCurrency,
): void {
  // Render descriptions, tradeoffs, AND formattedLabels for each option
  for (const opt of options) {
    const o = opt.offer;
    opt.description = `${formatMesoPrice(o.total_price, currency)}, ${fmtDays(o.delivery_days)} delivery, Net ${o.payment_terms_days}`;
    opt.formattedLabels = {
      deliveryLabel: `${fmtDays(o.delivery_days)} delivery`,
      warrantyLabel: `${fmtMonths(o.warranty_months)} warranty`,
      paymentLabel: `Net ${o.payment_terms_days}`,
    };
  }

  // Per-option tradeoff arrays (highlight what each option trades away)
  if (options[0]) {
    const o = options[0].offer;
    options[0].tradeoffs = [
      `${o.warranty_months || 0} ${(o.warranty_months || 0) === 1 ? "month" : "months"} warranty`,
      `Net ${o.payment_terms_days} payment`,
    ];
  }
  if (options[1]) {
    const o = options[1].offer;
    options[1].tradeoffs = [
      `${formatMesoPrice(o.total_price, currency)} price`,
      `${fmtDays(o.delivery_days)} delivery`,
    ];
  }
  if (options[2]) {
    const o = options[2].offer;
    options[2].tradeoffs = [
      `${formatMesoPrice(o.total_price, currency)} price`,
      `Net ${o.payment_terms_days} payment`,
    ];
  }
}

/**
 * Shared convergence floor (Apr 2026): once we've made a counter, no MESO
 * option price may regress below it. Used by both generateMesoOptions and
 * generateDynamicMesoOptions paths so the floor is consistent.
 *
 * Applies a 1.5% tolerance against maxAcceptablePrice so the floor stays
 * active even when our last counter has drifted fractionally above ceiling
 * (e.g. £418,999.99 vs £418,900).
 */
export function applyConvergenceFloor(
  basePrice: number,
  config: ResolvedNegotiationConfig,
  lastAccordoCounterPrice?: number | null,
): number {
  if (lastAccordoCounterPrice == null || lastAccordoCounterPrice <= 0) {
    return basePrice;
  }
  const TOLERANCE = 0.015;
  if (lastAccordoCounterPrice > config.maxAcceptablePrice * (1 + TOLERANCE)) {
    return basePrice;
  }
  return Math.max(basePrice, lastAccordoCounterPrice);
}

/**
 * Calculate medium (midpoint) payment terms in days
 */
function getMediumPaymentDays(config: ResolvedNegotiationConfig): number {
  return Math.round(
    (config.paymentTermsMinDays + config.paymentTermsMaxDays) / 2,
  );
}

/**
 * Calculate best (fastest) delivery days
 * Uses preferred date if available, otherwise improves on vendor's offer
 */
function getBestDeliveryDays(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
): number {
  const vendorDelivery = vendorOffer.delivery_days ?? 30;

  // If we have a preferred delivery date, calculate days from now
  if (config.preferredDeliveryDate) {
    const preferredDays = Math.ceil(
      (config.preferredDeliveryDate.getTime() - Date.now()) /
        (1000 * 60 * 60 * 24),
    );
    // Floor at 3 days — anything less doesn't make business sense in a MESO card
    return Math.max(3, Math.min(preferredDays, vendorDelivery));
  }

  // Otherwise, aim for 10-20% faster than vendor's offer
  const improvement = Math.max(2, Math.floor(vendorDelivery * 0.15));
  return Math.max(7, vendorDelivery - improvement);
}

/**
 * Calculate medium delivery days (vendor's offer or required date)
 */
function getMediumDeliveryDays(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
): number {
  const vendorDelivery = vendorOffer.delivery_days ?? 30;

  // If we have a required delivery date, use it as ceiling
  if (config.deliveryDate) {
    const requiredDays = Math.ceil(
      (config.deliveryDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
    );
    // Floor at 3 days — anything less doesn't make business sense
    return Math.max(3, Math.min(vendorDelivery, requiredDays));
  }

  return Math.max(3, vendorDelivery);
}

/**
 * Generate Offer 1: BEST Price + BEST Delivery + MEDIUM Terms + MINIMUM Warranty
 * This is the "value-focused" option - lowest price, fastest delivery, shorter warranty
 */
function generatePriceFocusedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  targetUtility: number,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  const basePrice = calculateBasePrice(
    config,
    vendorOffer,
    round,
    lastAccordoCounterPrice,
  );

  // BEST price: 2.5% lower than base (within strict boundaries)
  const priceDiscount = 0.025; // 2.5%
  let bestPrice = basePrice * (1 - priceDiscount);
  // Floor: max of config target, and (if set) the last Accordo counter — so
  // MESO's "best price" option still respects the convergence floor.
  const priceFloor =
    lastAccordoCounterPrice != null &&
    lastAccordoCounterPrice > 0 &&
    lastAccordoCounterPrice <= config.maxAcceptablePrice
      ? Math.max(config.targetPrice, lastAccordoCounterPrice)
      : config.targetPrice;
  bestPrice = Math.max(priceFloor, bestPrice);
  bestPrice = humanRoundPrice(Math.round(bestPrice * 100) / 100);

  // MEDIUM payment terms
  const mediumPaymentDays = getMediumPaymentDays(config);

  // BEST delivery (fastest)
  const bestDeliveryDays = getBestDeliveryDays(config, vendorOffer);

  // MINIMUM warranty: config - 6 months (floor at 0)
  const minWarranty = Math.max(0, config.warrantyPeriodMonths - 6);

  return {
    total_price: bestPrice,
    payment_terms: `Net ${mediumPaymentDays}`,
    payment_terms_days: mediumPaymentDays,
    delivery_days: bestDeliveryDays,
    delivery_date: vendorOffer.delivery_date ?? undefined,
    warranty_months: minWarranty,
    partial_delivery_allowed: config.partialDeliveryAllowed,
  };
}

/**
 * Generate Offer 2: MEDIUM Price + BEST Terms + MEDIUM Delivery + STANDARD Warranty
 * This is the "cash flow friendly" option - longer payment terms, standard everything else
 */
function generateTermsFocusedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  targetUtility: number,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  // MEDIUM price (base price, no discount)
  const mediumPrice = calculateBasePrice(
    config,
    vendorOffer,
    round,
    lastAccordoCounterPrice,
  );

  // BEST payment terms (longest, using wizard max)
  const bestPaymentDays = config.paymentTermsMaxDays;

  // MEDIUM delivery
  const mediumDeliveryDays = getMediumDeliveryDays(config, vendorOffer);

  // STANDARD warranty (config value)
  const standardWarranty = config.warrantyPeriodMonths;

  return {
    total_price: mediumPrice,
    payment_terms: `Net ${bestPaymentDays}`,
    payment_terms_days: bestPaymentDays,
    delivery_days: mediumDeliveryDays,
    delivery_date: vendorOffer.delivery_date ?? undefined,
    warranty_months: standardWarranty,
    partial_delivery_allowed: config.partialDeliveryAllowed,
  };
}

/**
 * Generate Offer 3: MEDIUM Price + MEDIUM Terms + BEST Delivery + EXTENDED Warranty
 * This is the "full service" option - best delivery, best warranty, fair price/terms
 */
function generateBalancedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  targetUtility: number,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  // MEDIUM price (base price, no discount)
  const mediumPrice = calculateBasePrice(
    config,
    vendorOffer,
    round,
    lastAccordoCounterPrice,
  );

  // MEDIUM payment terms
  const mediumPaymentDays = getMediumPaymentDays(config);

  // BEST delivery (fastest)
  const bestDeliveryDays = getBestDeliveryDays(config, vendorOffer);

  // EXTENDED warranty: config + 6 months
  const extendedWarranty = config.warrantyPeriodMonths + 6;

  return {
    total_price: mediumPrice,
    payment_terms: `Net ${mediumPaymentDays}`,
    payment_terms_days: mediumPaymentDays,
    delivery_days: bestDeliveryDays,
    warranty_months: extendedWarranty,
    partial_delivery_allowed: true, // Request flexibility for full service
  };
}

/**
 * Adjust offers to minimize variance
 */
function adjustOffersForVariance(
  options: MesoOption[],
  config: ResolvedNegotiationConfig,
  targetUtility: number,
  maxVariance: number,
): void {
  // Simple adjustment: scale prices to bring utilities closer
  for (const option of options) {
    const utilityDiff = option.utility - targetUtility;

    if (Math.abs(utilityDiff) > maxVariance) {
      // Adjust price to compensate
      const priceAdjustment = utilityDiff * config.priceRange * 0.1;

      if (option.offer.total_price != null) {
        option.offer.total_price = humanRoundPrice(
          Math.round((option.offer.total_price + priceAdjustment) * 100) / 100,
        );

        // Ensure variance adjustment didn't push below target price floor
        option.offer.total_price = Math.max(
          option.offer.total_price,
          config.targetPrice,
        );

        // Recalculate utility
        const newUtility = calculateWeightedUtilityFromResolved(
          option.offer,
          config,
        );
        option.utility = newUtility.totalUtility;
      }
    }
  }
}

// ============================================
// MESO DEDUPLICATION (May 2026)
// ============================================

/**
 * Detect and fix duplicate MESO options.
 *
 * Root cause: when the convergence floor clamps Option 1's price discount,
 * it can match Option 3's base price. Both share the same delivery (best)
 * and payment terms (medium), leaving only warranty as a differentiator —
 * which may also get flattened by adjustOffersForVariance.
 *
 * Strategy: compare each pair on (price, delivery_days, payment_terms_days).
 * If two match on all three, shift the later option's most flexible dimension:
 *   1. Payment terms: shift by ±10 days (within config bounds)
 *   2. Delivery days: shift by ±5 days (within bounds)
 *   3. Price: shift by ±2% (within bounds)
 */
function deduplicateMesoOptions(
  options: MesoOption[],
  config: ResolvedNegotiationConfig,
): void {
  for (let i = 0; i < options.length; i++) {
    for (let j = i + 1; j < options.length; j++) {
      const a = options[i].offer;
      const b = options[j].offer;

      const samePrice = a.total_price === b.total_price;
      const sameDelivery = a.delivery_days === b.delivery_days;
      const samePayment = a.payment_terms_days === b.payment_terms_days;

      if (samePrice && sameDelivery && samePayment) {
        // Duplicate detected — force variation on option j
        const shifted = forceVariation(options[j], config, options[i]);
        options[j] = shifted;
      }
    }
  }
}

/**
 * Force a MESO option to differ from its duplicate by shifting the most
 * flexible dimension first.
 */
function forceVariation(
  dup: MesoOption,
  config: ResolvedNegotiationConfig,
  original: MesoOption,
): MesoOption {
  const offer = { ...dup.offer };

  // Try 1: Shift payment terms by +10 days (longer terms = vendor-friendly)
  const newPayment = (offer.payment_terms_days ?? 30) + 10;
  if (newPayment <= config.paymentTermsMaxDays) {
    offer.payment_terms_days = newPayment;
    offer.payment_terms = `Net ${newPayment}`;
    const newUtility = calculateWeightedUtilityFromResolved(offer, config);
    return { ...dup, offer, utility: newUtility.totalUtility };
  }

  // Try 2: Shift payment terms by -10 days (shorter terms)
  const shorterPayment = Math.max(config.paymentTermsMinDays, (offer.payment_terms_days ?? 30) - 10);
  if (shorterPayment !== offer.payment_terms_days) {
    offer.payment_terms_days = shorterPayment;
    offer.payment_terms = `Net ${shorterPayment}`;
    const newUtility = calculateWeightedUtilityFromResolved(offer, config);
    return { ...dup, offer, utility: newUtility.totalUtility };
  }

  // Try 3: Shift delivery by +5 days (slower delivery = price room)
  const slowerDelivery = (offer.delivery_days ?? 30) + 5;
  offer.delivery_days = slowerDelivery;
  // Compensate with a 1.5% price reduction
  if (offer.total_price != null) {
    const reducedPrice = humanRoundPrice(Math.round(offer.total_price * 0.985 * 100) / 100);
    offer.total_price = Math.max(config.targetPrice, reducedPrice);
  }
  const newUtility = calculateWeightedUtilityFromResolved(offer, config);
  return { ...dup, offer, utility: newUtility.totalUtility };
}

// ============================================
// Preference Tracking
// ============================================

/**
 * Analyze vendor's MESO selection to infer preferences
 *
 * @param selection - The option selected by the vendor
 * @param allOptions - All options that were presented
 */
export function inferPreferencesFromSelection(
  selection: MesoOption,
  allOptions: MesoOption[],
): MesoSelection {
  const preferenceAdjustments: Record<string, number> = {};
  let primaryPreference = "price";
  let confidence = 0.5;

  // Analyze selection emphasis
  if (selection.emphasis.includes("price")) {
    preferenceAdjustments["price"] = 0.1; // Increase price weight
    preferenceAdjustments["payment_terms"] = -0.05;
    primaryPreference = "price";
    confidence = 0.7;
  } else if (selection.emphasis.includes("payment_terms")) {
    preferenceAdjustments["payment_terms"] = 0.1;
    preferenceAdjustments["price"] = -0.05;
    primaryPreference = "payment_terms";
    confidence = 0.7;
  } else if (selection.emphasis.includes("delivery")) {
    preferenceAdjustments["delivery"] = 0.1;
    preferenceAdjustments["price"] = -0.03;
    preferenceAdjustments["payment_terms"] = -0.03;
    primaryPreference = "delivery";
    confidence = 0.65;
  } else if (selection.emphasis.includes("warranty")) {
    preferenceAdjustments["warranty"] = 0.1;
    primaryPreference = "warranty";
    confidence = 0.6;
  }

  // Increase confidence if selection was consistent with previous patterns
  // (This would integrate with preference tracker - placeholder for now)

  return {
    selectedOptionId: selection.id,
    selectedOffer: selection.offer,
    inferredPreferences: {
      primaryPreference,
      confidence,
      preferenceAdjustments,
    },
  };
}

/**
 * Convert MESO option to standard Offer format
 */
export function mesoOptionToOffer(option: MesoOption): Offer {
  return {
    total_price: option.offer.total_price,
    payment_terms: option.offer.payment_terms,
    delivery_date: option.offer.delivery_date ?? null,
    delivery_days: option.offer.delivery_days ?? null,
  };
}

// ============================================
// PHASED MESO NEGOTIATION (February 2026)
// ============================================

/** Configuration for phased MESO negotiation */
export const MESO_PHASE_CONFIG = {
  /** Initial normal rounds before first MESO (rounds 1-5) */
  INITIAL_NORMAL_ROUNDS: 5,
  /** Normal rounds after "Others" selection before next MESO */
  POST_OTHERS_ROUNDS: 4,
  /** Maximum MESO presentation cycles */
  MAX_MESO_CYCLES: 5,
  /** Stall detection threshold (consecutive identical offers) */
  STALL_THRESHOLD: 3,
} as const;

/** Parameters for shouldUseMeso function */
export interface ShouldUseMesoParams {
  round: number;
  mesoCycleState?: MesoCycleState;
  finalOfferState?: FinalOfferState;
}

/** Result of shouldUseMeso function with flow control */
export interface ShouldUseMesoResult {
  shouldShow: boolean;
  showOthers: boolean;
  isFinal: boolean;
  phase: NegotiationPhase;
  inputDisabled: boolean;
  disabledMessage?: string;
}

/**
 * Check if MESO should be shown for this round with phased negotiation logic
 *
 * PHASED APPROACH (February 2026):
 * 1. Rounds 1-5: Normal text-based negotiation (NO MESO)
 * 2. After Round 5: Show MESO offers + "Others" option
 * 3. MESO Selection: Auto-accept deal
 * 4. Others Selection: 4 more normal rounds, then MESO again
 * 5. Repeat cycle (max 5 cycles)
 * 6. Final MESO: If vendor confirms final offer, show MESO without "Others"
 *
 * @param params - Parameters including round, mesoCycleState, and finalOfferState
 * @returns ShouldUseMesoResult with flow control flags
 */
export function shouldUseMeso(
  params: ShouldUseMesoParams,
): ShouldUseMesoResult {
  const { round, mesoCycleState, finalOfferState } = params;

  // Phase 1: Normal Negotiation (Rounds 1-5) - NO MESO
  if (round <= MESO_PHASE_CONFIG.INITIAL_NORMAL_ROUNDS) {
    return {
      shouldShow: false,
      showOthers: false,
      isFinal: false,
      phase: "NORMAL_NEGOTIATION",
      inputDisabled: false,
    };
  }

  // Check for final MESO (stall confirmed)
  if (
    finalOfferState?.vendorConfirmedFinal &&
    !finalOfferState.finalMesoShown
  ) {
    return {
      shouldShow: true,
      showOthers: false, // Hide Others for final MESO
      isFinal: true,
      phase: "FINAL_MESO",
      inputDisabled: true,
      disabledMessage: "Select one of the final offers above to close the deal",
    };
  }

  // Check if in post-Others negotiation phase (4 rounds after Others)
  if (mesoCycleState?.inPostOthersPhase) {
    if (
      mesoCycleState.roundsInCurrentCycle < MESO_PHASE_CONFIG.POST_OTHERS_ROUNDS
    ) {
      return {
        shouldShow: false,
        showOthers: false,
        isFinal: false,
        phase: "POST_OTHERS",
        inputDisabled: false,
      };
    }
    // 4 rounds completed in post-Others phase, show MESO again
  }

  // Check max MESO cycles (5 max)
  const cycleNumber = mesoCycleState?.mesoCycleNumber ?? 1;
  if (cycleNumber > MESO_PHASE_CONFIG.MAX_MESO_CYCLES) {
    return {
      shouldShow: false,
      showOthers: false,
      isFinal: false,
      phase: "ESCALATED",
      inputDisabled: true,
      disabledMessage: "This negotiation has been escalated to a human PM",
    };
  }

  // Show MESO with Others option
  return {
    shouldShow: true,
    showOthers: true,
    isFinal: false,
    phase: "MESO_PRESENTATION",
    inputDisabled: true,
    disabledMessage:
      'Select an offer above or click "Others" to enter your counter-offer',
  };
}

/**
 * Legacy shouldUseMeso function for backwards compatibility
 * @deprecated Use shouldUseMeso(params) instead
 */
export function shouldUseMesoLegacy(
  round: number,
  _maxRounds: number,
  _previousMesoRounds: number = 0,
): boolean {
  // For backwards compatibility, use simple round check
  return round > MESO_PHASE_CONFIG.INITIAL_NORMAL_ROUNDS;
}

// ============================================
// DYNAMIC MESO GENERATION (Learning-Based)
// ============================================

/**
 * Concession rates based on round number
 * Early rounds: larger concessions
 * Later rounds: smaller concessions
 */
function getConcessionRate(round: number, isPrimary: boolean): number {
  if (round <= 5) {
    return isPrimary ? 0.025 : 0.015; // 2.5% primary, 1.5% secondary
  } else if (round <= 10) {
    return isPrimary ? 0.015 : 0.01; // 1.5% primary, 1% secondary
  } else {
    return isPrimary ? 0.01 : 0.005; // 1% primary, 0.5% secondary
  }
}

/**
 * Generate MESO options with learning-based dynamic adjustments
 *
 * This function generates offers that:
 * 1. Differ from previous round offers (no identical MESOs)
 * 2. Adjust based on vendor's selection history (learning)
 * 3. Apply progressive concessions (larger early, smaller later)
 *
 * @param config - Resolved negotiation configuration
 * @param vendorOffer - Current vendor offer
 * @param round - Current negotiation round
 * @param negotiationState - Negotiation state with MESO selection history
 * @param previousMeso - Previous round's MESO options (to ensure different values)
 * @param targetUtility - Target utility for counter-offers (0-1)
 */
export function generateDynamicMesoOptions(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  negotiationState: NegotiationState | null,
  previousMeso: PreviousMesoRound | null = null,
  targetUtility: number = 0.65,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  lastAccordoCounterPrice?: number | null,
): MesoResult {
  const options: MesoOption[] = [];
  const variance_target = 0.03; // 3% variance for dynamic MESO

  try {
    // Build vendor preference profile from history
    const preferenceProfile = buildPreferenceProfile(negotiationState);

    // Calculate base concession rate for this round
    const primaryConcession = getConcessionRate(round, true);
    const secondaryConcession = getConcessionRate(round, false);

    // Determine emphasis adjustments based on vendor preferences
    const priceEmphasis = preferenceProfile.priceWeight;
    const termsEmphasis = preferenceProfile.termsWeight;

    // Get previous round prices to ensure we generate different values
    const prevOffer1Price = previousMeso?.options.find((o) =>
      o.id.includes("offer1"),
    )?.offer.total_price;
    const prevOffer2Price = previousMeso?.options.find((o) =>
      o.id.includes("offer2"),
    )?.offer.total_price;
    const prevOffer3Price = previousMeso?.options.find((o) =>
      o.id.includes("offer3"),
    )?.offer.total_price;

    // ============================================
    // Option 1: Price-Focused (with dynamic adjustment)
    // ============================================

    const offer1 = generateDynamicPriceFocusedOffer(
      config,
      vendorOffer,
      round,
      primaryConcession,
      priceEmphasis,
      prevOffer1Price,
      lastAccordoCounterPrice,
    );
    const offer1Utility = calculateWeightedUtilityFromResolved(offer1, config);

    options.push({
      id: `meso_${round}_offer1`,
      offer: offer1,
      utility: offer1Utility.totalUtility,
      label: "Offer 1",
      description: `${formatMesoPrice(offer1.total_price, currency)}, ${fmtDays(offer1.delivery_days)} delivery, Net ${offer1.payment_terms_days}`,
      emphasis: ["price"],
      tradeoffs: [],
    });

    // ============================================
    // Option 2: Terms-Focused (with dynamic adjustment)
    // ============================================

    const offer2 = generateDynamicTermsFocusedOffer(
      config,
      vendorOffer,
      round,
      primaryConcession,
      termsEmphasis,
      prevOffer2Price,
      lastAccordoCounterPrice,
    );
    const offer2Utility = calculateWeightedUtilityFromResolved(offer2, config);

    options.push({
      id: `meso_${round}_offer2`,
      offer: offer2,
      utility: offer2Utility.totalUtility,
      label: "Offer 2",
      description: `${formatMesoPrice(offer2.total_price, currency)}, Net ${offer2.payment_terms_days}, ${fmtMonths(offer2.warranty_months)} warranty`,
      emphasis: ["payment_terms"],
      tradeoffs: [],
    });

    // ============================================
    // Option 3: Balanced (always include for variety)
    // ============================================

    const offer3 = generateDynamicBalancedOffer(
      config,
      vendorOffer,
      round,
      secondaryConcession,
      prevOffer3Price,
      lastAccordoCounterPrice,
    );
    const offer3Utility = calculateWeightedUtilityFromResolved(offer3, config);

    options.push({
      id: `meso_${round}_offer3`,
      offer: offer3,
      utility: offer3Utility.totalUtility,
      label: "Offer 3",
      description: `${formatMesoPrice(offer3.total_price, currency)}, ${fmtDays(offer3.delivery_days)} delivery, ${fmtMonths(offer3.warranty_months)} warranty`,
      emphasis: ["delivery", "warranty"],
      tradeoffs: [],
    });

    // ============================================
    // Normalize utilities to minimize variance
    // ============================================

    const utilities = options.map((o) => o.utility);
    const avgUtility = utilities.reduce((a, b) => a + b, 0) / utilities.length;
    const maxVariance = Math.max(
      ...utilities.map((u) => Math.abs(u - avgUtility)),
    );

    if (maxVariance > variance_target) {
      adjustOffersForVariance(options, config, avgUtility, variance_target);
    }

    // Recalculate final variance
    const finalUtilities = options.map((o) => o.utility);
    const finalAvg =
      finalUtilities.reduce((a, b) => a + b, 0) / finalUtilities.length;
    const finalVariance = Math.max(
      ...finalUtilities.map((u) => Math.abs(u - finalAvg)),
    );

    // Dedup guard (May 2026): when the convergence floor clamps Option 1's
    // price discount, multiple options can end up identical on all visible
    // dimensions (price, delivery, payment_terms). Detect and force variation.
    deduplicateMesoOptions(options, config);

    // Re-render labels with FINAL prices (Apr 2026): variance adjustment
    // can mutate offer.total_price after the original description was set.
    renderMesoDescriptions(options, currency);

    return {
      options,
      targetUtility: finalAvg,
      variance: finalVariance,
      success: true,
      currency,
      // Flow control flags for phased negotiation
      showOthers: true,
      isFinal: false,
      inputDisabled: true,
      disabledMessage:
        'Select an offer above or click "Others" to enter your counter-offer',
      phase: "MESO_PRESENTATION" as NegotiationPhase,
    };
  } catch (error) {
    return {
      options: [],
      targetUtility,
      variance: 0,
      success: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown error generating dynamic MESO options",
      currency,
      // Default flow control flags for failed generation
      showOthers: false,
      isFinal: false,
      inputDisabled: false,
      phase: "NORMAL_NEGOTIATION" as NegotiationPhase,
    };
  }
}

/**
 * Generate dynamic Offer 1: Best Price + Best Delivery + Medium Terms + Min Warranty
 * Applies round-based concessions and ensures different from previous round
 */
function generateDynamicPriceFocusedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  concessionRate: number,
  priceEmphasis: number,
  previousPrice: number | null | undefined,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  const { targetPrice, maxAcceptablePrice, priceRange, priority } = config;

  // Base aggressiveness adjusted by vendor preference
  const baseAggressiveness =
    priority === "HIGH" ? 0.2 : priority === "LOW" ? 0.4 : 0.3;
  const emphasisAdjustment = (priceEmphasis - 0.5) * 0.1;

  // Round-based concession: move toward vendor each round
  const roundConcession = round * concessionRate;

  let basePrice =
    targetPrice +
    priceRange * (baseAggressiveness + emphasisAdjustment + roundConcession);

  // Ensure different from previous round (at least $50 or 0.5% different)
  if (previousPrice != null) {
    const minDiff = Math.max(50, previousPrice * 0.005);
    if (Math.abs(basePrice - previousPrice) < minDiff) {
      basePrice = previousPrice + minDiff;
    }
  }

  // Never exceed vendor's offer
  if (vendorOffer.total_price != null) {
    basePrice = Math.min(basePrice, vendorOffer.total_price);
  }
  basePrice = Math.min(basePrice, maxAcceptablePrice);

  // Convergence floor (Apr 2026): never regress below our last counter.
  basePrice = applyConvergenceFloor(basePrice, config, lastAccordoCounterPrice);

  // BEST price: 2.5% discount from base
  let bestPrice = basePrice * 0.975;
  // Floor at convergence too (so the 2.5% discount doesn't drop us below it)
  bestPrice = applyConvergenceFloor(bestPrice, config, lastAccordoCounterPrice);
  bestPrice = Math.max(config.targetPrice, bestPrice);
  bestPrice = humanRoundPrice(Math.round(bestPrice * 100) / 100);

  // MEDIUM payment terms
  const mediumPaymentDays = getMediumPaymentDays(config);

  // BEST delivery
  const bestDeliveryDays = getBestDeliveryDays(config, vendorOffer);

  // MINIMUM warranty
  const minWarranty = Math.max(0, config.warrantyPeriodMonths - 6);

  return {
    total_price: bestPrice,
    payment_terms: `Net ${mediumPaymentDays}`,
    payment_terms_days: mediumPaymentDays,
    delivery_days: bestDeliveryDays,
    delivery_date: vendorOffer.delivery_date ?? undefined,
    warranty_months: minWarranty,
    partial_delivery_allowed: config.partialDeliveryAllowed,
  };
}

/**
 * Generate dynamic Offer 2: Medium Price + Best Terms + Medium Delivery + Standard Warranty
 * Applies round-based concessions and ensures different from previous round
 */
function generateDynamicTermsFocusedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  concessionRate: number,
  termsEmphasis: number,
  previousPrice: number | null | undefined,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  const { targetPrice, maxAcceptablePrice, priceRange, priority } = config;

  // Base aggressiveness for medium price
  const baseAggressiveness =
    priority === "HIGH" ? 0.3 : priority === "LOW" ? 0.5 : 0.4;
  const emphasisAdjustment = (termsEmphasis - 0.5) * 0.1;

  // Round-based concession
  const roundConcession = round * concessionRate;

  let mediumPrice =
    targetPrice +
    priceRange * (baseAggressiveness + emphasisAdjustment + roundConcession);

  // Ensure different from previous round
  if (previousPrice != null) {
    const minDiff = Math.max(50, previousPrice * 0.005);
    if (Math.abs(mediumPrice - previousPrice) < minDiff) {
      mediumPrice = previousPrice + minDiff;
    }
  }

  if (vendorOffer.total_price != null) {
    mediumPrice = Math.min(mediumPrice, vendorOffer.total_price);
  }
  mediumPrice = Math.min(mediumPrice, maxAcceptablePrice);
  mediumPrice = applyConvergenceFloor(
    mediumPrice,
    config,
    lastAccordoCounterPrice,
  );
  mediumPrice = humanRoundPrice(Math.round(mediumPrice * 100) / 100);

  // BEST payment terms (longest)
  const bestPaymentDays = config.paymentTermsMaxDays;

  // MEDIUM delivery
  const mediumDeliveryDays = getMediumDeliveryDays(config, vendorOffer);

  // STANDARD warranty
  const standardWarranty = config.warrantyPeriodMonths;

  return {
    total_price: mediumPrice,
    payment_terms: `Net ${bestPaymentDays}`,
    payment_terms_days: bestPaymentDays,
    delivery_days: mediumDeliveryDays,
    delivery_date: vendorOffer.delivery_date ?? undefined,
    warranty_months: standardWarranty,
    partial_delivery_allowed: config.partialDeliveryAllowed,
  };
}

/**
 * Generate dynamic Offer 3: Medium Price + Medium Terms + Best Delivery + Extended Warranty
 * Applies round-based concessions and ensures different from previous round
 */
function generateDynamicBalancedOffer(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  concessionRate: number,
  previousPrice: number | null | undefined,
  lastAccordoCounterPrice?: number | null,
): ExtendedOffer {
  const { targetPrice, maxAcceptablePrice, priceRange, priority } = config;

  // Base aggressiveness for medium price
  const baseAggressiveness =
    priority === "HIGH" ? 0.3 : priority === "LOW" ? 0.5 : 0.4;

  // Round-based concession
  const roundConcession = round * concessionRate;

  let mediumPrice =
    targetPrice + priceRange * (baseAggressiveness + roundConcession);

  // Ensure different from previous round
  if (previousPrice != null) {
    const minDiff = Math.max(50, previousPrice * 0.005);
    if (Math.abs(mediumPrice - previousPrice) < minDiff) {
      mediumPrice = previousPrice + minDiff;
    }
  }

  if (vendorOffer.total_price != null) {
    mediumPrice = Math.min(mediumPrice, vendorOffer.total_price);
  }
  mediumPrice = Math.min(mediumPrice, maxAcceptablePrice);
  mediumPrice = applyConvergenceFloor(
    mediumPrice,
    config,
    lastAccordoCounterPrice,
  );
  mediumPrice = humanRoundPrice(Math.round(mediumPrice * 100) / 100);

  // MEDIUM payment terms
  const mediumPaymentDays = getMediumPaymentDays(config);

  // BEST delivery
  const bestDeliveryDays = getBestDeliveryDays(config, vendorOffer);

  // EXTENDED warranty
  const extendedWarranty = config.warrantyPeriodMonths + 6;

  return {
    total_price: mediumPrice,
    payment_terms: `Net ${mediumPaymentDays}`,
    payment_terms_days: mediumPaymentDays,
    delivery_days: bestDeliveryDays,
    warranty_months: extendedWarranty,
    partial_delivery_allowed: true,
  };
}

// ============================================
// FINAL MESO (75%+ Utility Trigger)
// ============================================

/**
 * Check if we should trigger final MESO offers
 * @param utilityScore - Current utility score (0-1)
 * @param round - Current round
 * @param threshold - Utility threshold for final offers (default 0.75)
 */
export function shouldTriggerFinalMeso(
  utilityScore: number,
  round: number,
  threshold: number = 0.75,
): boolean {
  // Only trigger after round 2 (give some negotiation time)
  if (round < 2) return false;

  // Trigger when utility reaches threshold
  return utilityScore >= threshold;
}

/**
 * Generate final MESO options for deal closure
 * All three offers should be acceptable (>= 75% utility)
 * Uses the same parameter priority pattern as regular MESO
 */
export function generateFinalMesoOptions(
  config: ResolvedNegotiationConfig,
  vendorOffer: ExtendedOffer,
  round: number,
  currentUtility: number,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  lastAccordoCounterPrice?: number | null,
): MesoResult {
  const options: MesoOption[] = [];

  try {
    const { targetPrice, priceRange } = config;

    // Final offers are closer to vendor's position (we're ready to close)
    // Use small price variation (2-3%) for final closure

    // Base price for finals: closer to vendor's price
    const vendorPrice =
      vendorOffer.total_price ?? targetPrice + priceRange * 0.7;

    // ============================================
    // Final Offer 1: Best Price + Best Delivery + Medium Terms + Min Warranty
    // Slight discount from vendor price, fastest delivery
    // ============================================

    const finalPrice1 = humanRoundPrice(Math.round(vendorPrice * 0.97 * 100) / 100); // 3% off vendor
    const mediumTerms = getMediumPaymentDays(config);
    const bestDelivery = getBestDeliveryDays(config, vendorOffer);
    const minWarranty = Math.max(0, config.warrantyPeriodMonths - 6);

    const finalOffer1: ExtendedOffer = {
      total_price: applyConvergenceFloor(
        Math.max(targetPrice, finalPrice1),
        config,
        lastAccordoCounterPrice,
      ),
      payment_terms: `Net ${mediumTerms}`,
      payment_terms_days: mediumTerms,
      delivery_days: bestDelivery,
      warranty_months: minWarranty,
      partial_delivery_allowed: config.partialDeliveryAllowed,
    };
    const finalUtility1 = calculateWeightedUtilityFromResolved(
      finalOffer1,
      config,
    );

    options.push({
      id: `meso_${round}_final1`,
      offer: finalOffer1,
      utility: finalUtility1.totalUtility,
      label: "Offer 1",
      description: `${formatMesoPrice(finalOffer1.total_price, currency)}, ${fmtDays(bestDelivery)} delivery, Net ${mediumTerms}`,
      emphasis: ["price", "delivery"],
      tradeoffs: [
        `${minWarranty} ${minWarranty === 1 ? "month" : "months"} warranty`,
        `Net ${mediumTerms} payment`,
      ],
    });

    // ============================================
    // Final Offer 2: Medium Price + Best Terms + Medium Delivery + Standard Warranty
    // Vendor price, longest payment terms
    // ============================================

    const mediumDelivery = getMediumDeliveryDays(config, vendorOffer);
    const bestTerms = config.paymentTermsMaxDays;
    const standardWarranty = config.warrantyPeriodMonths;

    const finalOffer2: ExtendedOffer = {
      total_price: humanRoundPrice(applyConvergenceFloor(
        Math.round(vendorPrice * 100) / 100,
        config,
        lastAccordoCounterPrice,
      )),
      payment_terms: `Net ${bestTerms}`,
      payment_terms_days: bestTerms,
      delivery_days: mediumDelivery,
      warranty_months: standardWarranty,
      partial_delivery_allowed: config.partialDeliveryAllowed,
    };
    const finalUtility2 = calculateWeightedUtilityFromResolved(
      finalOffer2,
      config,
    );

    options.push({
      id: `meso_${round}_final2`,
      offer: finalOffer2,
      utility: finalUtility2.totalUtility,
      label: "Offer 2",
      description: `${formatMesoPrice(finalOffer2.total_price, currency)}, Net ${bestTerms}, ${standardWarranty}-month warranty`,
      emphasis: ["payment_terms"],
      tradeoffs: [
        `${formatMesoPrice(finalOffer2.total_price, currency)} price`,
        `${fmtDays(mediumDelivery)} delivery`,
      ],
    });

    // ============================================
    // Final Offer 3: Medium Price + Medium Terms + Best Delivery + Extended Warranty
    // Vendor price, fast delivery, bonus warranty
    // ============================================

    const extendedWarranty = config.warrantyPeriodMonths + 6;

    const finalOffer3: ExtendedOffer = {
      total_price: humanRoundPrice(applyConvergenceFloor(
        Math.round(vendorPrice * 100) / 100,
        config,
        lastAccordoCounterPrice,
      )),
      payment_terms: `Net ${mediumTerms}`,
      payment_terms_days: mediumTerms,
      delivery_days: bestDelivery,
      warranty_months: extendedWarranty,
      partial_delivery_allowed: true,
    };
    const finalUtility3 = calculateWeightedUtilityFromResolved(
      finalOffer3,
      config,
    );

    options.push({
      id: `meso_${round}_final3`,
      offer: finalOffer3,
      utility: finalUtility3.totalUtility,
      label: "Offer 3",
      description: `${formatMesoPrice(finalOffer3.total_price, currency)}, ${fmtDays(bestDelivery)} delivery, ${fmtMonths(extendedWarranty)} warranty`,
      emphasis: ["delivery", "warranty"],
      tradeoffs: [
        `${formatMesoPrice(finalOffer3.total_price, currency)} price`,
        `Net ${mediumTerms} payment`,
      ],
    });

    // Calculate final variance
    const utilities = options.map((o) => o.utility);
    const avgUtility = utilities.reduce((a, b) => a + b, 0) / utilities.length;
    const finalVariance = Math.max(
      ...utilities.map((u) => Math.abs(u - avgUtility)),
    );

    return {
      options,
      targetUtility: avgUtility,
      variance: finalVariance,
      success: true,
      currency,
      // Flow control flags for FINAL MESO (no Others option)
      showOthers: false,
      isFinal: true,
      inputDisabled: true,
      disabledMessage: "Select one of the final offers above to close the deal",
      phase: "FINAL_MESO" as NegotiationPhase,
    };
  } catch (error) {
    return {
      options: [],
      targetUtility: currentUtility,
      variance: 0,
      success: false,
      reason:
        error instanceof Error
          ? error.message
          : "Unknown error generating final MESO options",
      currency,
      // Default flow control flags for failed generation
      showOthers: false,
      isFinal: false,
      inputDisabled: false,
      phase: "NORMAL_NEGOTIATION" as NegotiationPhase,
    };
  }
}

// ============================================
// MESO CYCLE STATE MANAGEMENT (February 2026)
// ============================================

/**
 * Update MESO cycle state when MESO is shown
 */
export function updateMesoCycleStateOnShow(
  state: MesoCycleState | undefined,
  round: number,
): MesoCycleState {
  const currentState = state || {
    mesoCycleNumber: 0,
    lastMesoShownAtRound: 0,
    roundsInCurrentCycle: 0,
    othersSelectedCount: 0,
    inPostOthersPhase: false,
  };

  return {
    ...currentState,
    mesoCycleNumber: currentState.mesoCycleNumber + 1,
    lastMesoShownAtRound: round,
    inPostOthersPhase: false,
    roundsInCurrentCycle: 0,
  };
}

/**
 * Update MESO cycle state when "Others" is selected
 */
export function updateMesoCycleStateOnOthersSelection(
  state: MesoCycleState | undefined,
  round: number,
): MesoCycleState {
  const currentState = state || {
    mesoCycleNumber: 1,
    lastMesoShownAtRound: round,
    roundsInCurrentCycle: 0,
    othersSelectedCount: 0,
    inPostOthersPhase: false,
  };

  return {
    ...currentState,
    othersSelectedCount: currentState.othersSelectedCount + 1,
    inPostOthersPhase: true,
    roundsInCurrentCycle: 0,
  };
}

/**
 * Increment round counter in current post-Others cycle
 */
export function incrementPostOthersRound(
  state: MesoCycleState | undefined,
): MesoCycleState {
  if (!state || !state.inPostOthersPhase) {
    return (
      state || {
        mesoCycleNumber: 0,
        lastMesoShownAtRound: 0,
        roundsInCurrentCycle: 0,
        othersSelectedCount: 0,
        inPostOthersPhase: false,
      }
    );
  }

  return {
    ...state,
    roundsInCurrentCycle: state.roundsInCurrentCycle + 1,
  };
}

/**
 * Update final offer state when vendor confirms final
 */
export function updateFinalOfferStateOnConfirm(
  state: FinalOfferState | undefined,
  stalledPrice: number,
): FinalOfferState {
  return {
    vendorConfirmedFinal: true,
    stalledPrice,
    finalMesoShown: false,
  };
}

/**
 * Update final offer state when final MESO is shown
 */
export function updateFinalOfferStateOnMesoShown(
  state: FinalOfferState | undefined,
): FinalOfferState {
  const currentState = state || {
    vendorConfirmedFinal: false,
    stalledPrice: undefined,
    finalMesoShown: false,
  };

  return {
    ...currentState,
    finalMesoShown: true,
  };
}

/**
 * Check if escalation should be triggered
 */
export function checkEscalationTriggers(
  mesoCycleState: MesoCycleState | undefined,
  finalOfferState: FinalOfferState | undefined,
  lastOthersPrice?: number,
): { shouldEscalate: boolean; reason: string } {
  // Trigger 1: 5 MESO cycles exhausted
  if (
    mesoCycleState &&
    mesoCycleState.mesoCycleNumber > MESO_PHASE_CONFIG.MAX_MESO_CYCLES
  ) {
    return { shouldEscalate: true, reason: "Max MESO cycles reached" };
  }

  // Trigger 2: Final MESO shown but vendor still selecting Others at same price
  if (finalOfferState?.finalMesoShown && lastOthersPrice !== undefined) {
    if (
      finalOfferState.stalledPrice !== undefined &&
      lastOthersPrice === finalOfferState.stalledPrice
    ) {
      return {
        shouldEscalate: true,
        reason: "Vendor persists at stalled price after final MESO",
      };
    }
  }

  return { shouldEscalate: false, reason: "" };
}

/**
 * Generate MESO based on vendor's confirmed final price
 * Used when vendor confirms "Yes, this is my final offer"
 */
export function generateMesoFromVendorPrice(
  config: ResolvedNegotiationConfig,
  vendorPrice: number,
  round: number,
  currency: SupportedCurrency = DEFAULT_CURRENCY,
  lastAccordoCounterPrice?: number | null,
): MesoResult {
  const { maxAcceptablePrice, targetPrice } = config;

  // Check if vendor's price is within acceptable range
  let basePrice = vendorPrice;
  let priceAdjusted = false;

  if (vendorPrice > maxAcceptablePrice) {
    // Vendor's price exceeds our max - adjust MESO offers to acceptable range
    basePrice = maxAcceptablePrice;
    priceAdjusted = true;
  }

  // Convergence floor (Apr 2026): never regress below our last counter.
  basePrice = applyConvergenceFloor(basePrice, config, lastAccordoCounterPrice);

  // Generate 3 offers based on the base price
  const offer1Price = humanRoundPrice(Math.round(basePrice * 0.97 * 100) / 100); // 3% below
  const offer2Price = humanRoundPrice(Math.round(basePrice * 100) / 100);
  const offer3Price = humanRoundPrice(Math.round(basePrice * 1.02 * 100) / 100); // 2% above (up to max)

  const mediumTerms = Math.round(
    (config.paymentTermsMinDays + config.paymentTermsMaxDays) / 2,
  );
  const bestTerms = config.paymentTermsMaxDays;
  const bestDelivery = 14; // Fast delivery
  const mediumDelivery = 21;
  const minWarranty = Math.max(0, config.warrantyPeriodMonths - 6);
  const standardWarranty = config.warrantyPeriodMonths;
  const extendedWarranty = config.warrantyPeriodMonths + 6;

  const options: MesoOption[] = [
    {
      id: `meso_${round}_vendorprice1`,
      offer: {
        total_price: Math.max(targetPrice, offer1Price),
        payment_terms: `Net ${mediumTerms}`,
        payment_terms_days: mediumTerms,
        delivery_days: bestDelivery,
        warranty_months: minWarranty,
      },
      utility: 0.8,
      label: "Offer 1",
      description: `${formatMesoPrice(Math.max(targetPrice, offer1Price), currency)}, ${fmtDays(bestDelivery)} delivery, Net ${mediumTerms}`,
      emphasis: ["price", "delivery"],
      tradeoffs: [
        `${minWarranty} ${minWarranty === 1 ? "month" : "months"} warranty`,
        `Net ${mediumTerms} payment`,
      ],
    },
    {
      id: `meso_${round}_vendorprice2`,
      offer: {
        total_price: offer2Price,
        payment_terms: `Net ${bestTerms}`,
        payment_terms_days: bestTerms,
        delivery_days: mediumDelivery,
        warranty_months: standardWarranty,
      },
      utility: 0.8,
      label: "Offer 2",
      description: `${formatMesoPrice(offer2Price, currency)}, Net ${bestTerms}, ${standardWarranty}-month warranty`,
      emphasis: ["payment_terms"],
      tradeoffs: [
        `${formatMesoPrice(offer2Price, currency)} price`,
        `${fmtDays(mediumDelivery)} delivery`,
      ],
    },
    {
      id: `meso_${round}_vendorprice3`,
      offer: {
        total_price: Math.min(offer3Price, maxAcceptablePrice),
        payment_terms: `Net ${mediumTerms}`,
        payment_terms_days: mediumTerms,
        delivery_days: bestDelivery,
        warranty_months: extendedWarranty,
      },
      utility: 0.8,
      label: "Offer 3",
      description: `${formatMesoPrice(Math.min(offer3Price, maxAcceptablePrice), currency)}, ${fmtDays(bestDelivery)} delivery, ${fmtMonths(extendedWarranty)} warranty`,
      emphasis: ["delivery", "warranty"],
      tradeoffs: [
        `${formatMesoPrice(Math.min(offer3Price, maxAcceptablePrice), currency)} price`,
        `Net ${mediumTerms} payment`,
      ],
    },
  ];

  return {
    options,
    targetUtility: 0.8,
    variance: 0.02,
    success: true,
    currency,
    showOthers: false, // Final MESO - no Others option
    isFinal: true,
    inputDisabled: true,
    disabledMessage: priceAdjusted
      ? "Your price was above our maximum. Please select from the adjusted offers below."
      : "Select one of the final offers above to close the deal",
    phase: "FINAL_MESO" as NegotiationPhase,
  };
}
