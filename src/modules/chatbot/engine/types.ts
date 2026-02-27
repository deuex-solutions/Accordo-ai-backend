import { z } from "zod";

/**
 * Standard payment terms enum (for backwards compatibility)
 */
export const StandardPaymentTerms = ["Net 30", "Net 60", "Net 90"] as const;
export type StandardPaymentTerm = typeof StandardPaymentTerms[number];

/**
 * Payment terms can now be any "Net X" format where X is 1-120 days
 * We store as string format "Net X" for consistency
 */
export const OfferSchema = z.object({
  total_price: z.number().nullable(),
  // Accept any "Net X" format (X = 1-120 days) or standard terms
  payment_terms: z.string().nullable(),
  // Payment terms in days for calculations (e.g., 45 for "Net 45")
  payment_terms_days: z.number().nullable().optional(),
  // Delivery fields
  delivery_date: z.string().nullable().optional(),      // ISO date string (YYYY-MM-DD)
  delivery_days: z.number().nullable().optional(),      // Days from today
  meta: z.object({
    raw_terms_days: z.number().optional(),
    non_standard_terms: z.boolean().optional(),
    // Delivery meta
    delivery_source: z.enum(['explicit_date', 'relative_days', 'timeframe', 'asap']).optional(),
    raw_delivery_text: z.string().optional(),
    // Price parsing meta (February 2026)
    raw_price_text: z.string().optional(),
    raw_terms_text: z.string().optional(),
    // Currency meta (February 2026)
    currency_detected: z.enum(['USD', 'INR', 'EUR', 'GBP', 'AUD']).optional(),
    currency_converted: z.boolean().optional(),
    original_currency: z.enum(['USD', 'INR', 'EUR', 'GBP', 'AUD']).optional(),
    original_price: z.number().optional(),
  }).optional(),
});
export type Offer = z.infer<typeof OfferSchema>;

// ============================================
// OFFER ACCUMULATION TYPES (February 2026)
// ============================================

/**
 * Components of an offer that can be provided separately
 */
export type OfferComponent = 'price' | 'payment terms' | 'delivery';

/**
 * Accumulated offer that tracks partial offers across messages
 * Used to merge vendor's partial responses (e.g., "37000" then "Net 30")
 */
export interface AccumulatedOffer extends Offer {
  accumulation: {
    /** When price component was last updated */
    priceUpdatedAt: Date | null;
    /** When payment terms component was last updated */
    termsUpdatedAt: Date | null;
    /** When delivery component was last updated */
    deliveryUpdatedAt: Date | null;
    /** Message IDs that contributed to this accumulated offer (audit trail) */
    sourceMessageIds: string[];
    /** True when price AND terms are both present (delivery optional) */
    isComplete: boolean;
  };
}

// ============================================
// NEGOTIATION STATE TYPES (February 2026)
// ============================================

/**
 * Vendor's negotiation emphasis based on keyword analysis and concession patterns
 */
export type VendorEmphasis = 'price-focused' | 'terms-focused' | 'balanced' | 'unknown';

/**
 * Record of a price or terms concession made during negotiation
 */
export interface ConcessionRecord {
  /** Round when concession was made */
  round: number;
  /** Previous value (price in dollars or terms in days) */
  previousValue: number;
  /** New value after concession */
  newValue: number;
  /** Amount of change (positive = moved toward PM's target) */
  change: number;
  /** Percentage change relative to range */
  changePercent: number;
  /** When this concession was recorded */
  timestamp: Date;
}

/**
 * PM counter-offer history for tracking our own concessions
 */
export interface PmCounterRecord {
  /** Round number */
  round: number;
  /** Counter-offer price */
  price: number;
  /** Counter-offer payment terms (e.g., "Net 60") */
  terms: string;
  /** Counter-offer delivery days */
  deliveryDays: number | null;
  /** When this counter was made */
  timestamp: Date;
}

/**
 * Keywords detected in vendor messages
 */
export interface DetectedKeywords {
  /** Price-related keywords found */
  priceKeywords: string[];
  /** Terms-related keywords found */
  termsKeywords: string[];
}

/**
 * MESO selection record
 */
export interface MesoSelectionRecord {
  /** Round when selection was made */
  round: number;
  /** Which option was selected */
  selectedOptionId: string;
  /** Type of option selected (legacy: price/terms/balanced, new: offer_1/offer_2/offer_3) */
  selectedType: 'price' | 'terms' | 'balanced' | 'offer_1' | 'offer_2' | 'offer_3';
  /** When selection was made */
  timestamp: Date;
}

/**
 * Utility score history record for tracking negotiation progress
 */
export interface UtilityHistoryRecord {
  /** Round number */
  round: number;
  /** Utility score at this round (0-1) */
  utility: number;
  /** When this was recorded */
  timestamp: Date;
}

/**
 * Complete negotiation state tracking across rounds
 * Stored in deal.convoStateJson for persistence
 */
export interface NegotiationState {
  /** History of vendor's price concessions */
  priceConcessions: ConcessionRecord[];
  /** History of vendor's terms concessions */
  termsConcessions: ConcessionRecord[];
  /** History of PM's counter-offers */
  pmCounterHistory: PmCounterRecord[];
  /** Detected vendor emphasis (what they care more about) */
  vendorEmphasis: VendorEmphasis;
  /** Confidence in the emphasis detection (0.5-0.9) */
  emphasisConfidence: number;
  /** Keywords detected in vendor messages */
  detectedKeywords: DetectedKeywords;
  /** When this state was last updated */
  lastUpdatedAt: Date;
  /** History of MESO selections by vendor (February 2026) */
  mesoSelections?: MesoSelectionRecord[];
  /** Count of consecutive 'balanced' MESO selections */
  consecutiveBalancedSelections?: number;
  /** Round when preference exploration started (after first balanced selection) */
  preferenceExplorationStartRound?: number;
  /** History of utility scores per round (February 2026) */
  utilityHistory?: UtilityHistoryRecord[];
  /** Count of consecutive rounds with no utility improvement */
  consecutiveNoImprovementRounds?: number;

  /** MESO cycle tracking for phased negotiation (February 2026) */
  mesoCycleState?: MesoCycleState;

  /** Others form state for structured counter-offers (February 2026) */
  othersFormState?: OthersFormState;

  /** Final offer confirmation state (February 2026) */
  finalOfferState?: FinalOfferState;
}

// ============================================
// MESO CYCLE STATE TYPES (February 2026)
// ============================================

/** MESO cycle tracking - controls when MESO is shown */
export interface MesoCycleState {
  /** Which MESO presentation cycle (1-5 max) */
  mesoCycleNumber: number;
  /** Round number when last MESO was shown */
  lastMesoShownAtRound: number;
  /** Rounds completed in current post-Others phase (0-4) */
  roundsInCurrentCycle: number;
  /** How many times vendor has selected "Others" total */
  othersSelectedCount: number;
  /** Whether we're in post-Others negotiation phase */
  inPostOthersPhase: boolean;
}

/** Others form state - tracks vendor's custom counter-offers */
export interface OthersFormState {
  /** Last submitted "Others" offer */
  lastOthersOffer?: {
    totalPrice: number;
    paymentTermsDays: number;
    submittedAt: string; // ISO date
  };
}

/** Final offer state - tracks stall detection and confirmation */
export interface FinalOfferState {
  /** Whether vendor has confirmed "Yes, this is my final offer" */
  vendorConfirmedFinal: boolean;
  /** The stalled price value (used for MESO generation) */
  stalledPrice?: number;
  /** Whether we've shown final MESO (no "Others" option) */
  finalMesoShown: boolean;
}

/** Negotiation phase for frontend state management */
export type NegotiationPhase =
  | 'NORMAL_NEGOTIATION'    // Rounds 1-5, text input enabled
  | 'MESO_PRESENTATION'     // MESO shown with Others, input disabled
  | 'OTHERS_FORM'           // Vendor clicked Others, show form
  | 'POST_OTHERS'           // Rounds after Others, text input enabled
  | 'FINAL_MESO'            // Final MESO, no Others option
  | 'STALL_QUESTION'        // "Is this your final offer?" shown
  | 'DEAL_ACCEPTED'         // Vendor selected MESO, deal closed
  | 'ESCALATED';            // Human PM takeover

/**
 * Create an empty negotiation state
 */
export function createEmptyNegotiationState(): NegotiationState {
  return {
    priceConcessions: [],
    termsConcessions: [],
    pmCounterHistory: [],
    vendorEmphasis: 'unknown',
    emphasisConfidence: 0.5,
    detectedKeywords: {
      priceKeywords: [],
      termsKeywords: [],
    },
    lastUpdatedAt: new Date(),
    mesoSelections: [],
    consecutiveBalancedSelections: 0,
    preferenceExplorationStartRound: undefined,
    utilityHistory: [],
    consecutiveNoImprovementRounds: 0,
    // MESO cycle state (February 2026)
    mesoCycleState: {
      mesoCycleNumber: 0,
      lastMesoShownAtRound: 0,
      roundsInCurrentCycle: 0,
      othersSelectedCount: 0,
      inPostOthersPhase: false,
    },
    othersFormState: undefined,
    finalOfferState: {
      vendorConfirmedFinal: false,
      stalledPrice: undefined,
      finalMesoShown: false,
    },
  };
}

/**
 * Create empty MESO cycle state
 */
export function createEmptyMesoCycleState(): MesoCycleState {
  return {
    mesoCycleNumber: 0,
    lastMesoShownAtRound: 0,
    roundsInCurrentCycle: 0,
    othersSelectedCount: 0,
    inPostOthersPhase: false,
  };
}

/**
 * Create empty final offer state
 */
export function createEmptyFinalOfferState(): FinalOfferState {
  return {
    vendorConfirmedFinal: false,
    stalledPrice: undefined,
    finalMesoShown: false,
  };
}

/**
 * Helper to check if a payment term is standard (Net 30/60/90)
 */
export function isStandardPaymentTerm(term: string | null): term is StandardPaymentTerm {
  return term !== null && StandardPaymentTerms.includes(term as StandardPaymentTerm);
}

/**
 * Extract days from payment terms string (e.g., "Net 45" -> 45)
 */
export function extractPaymentDays(term: string | null): number | null {
  if (!term) return null;
  const match = term.match(/Net\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Format days as payment terms string (e.g., 45 -> "Net 45")
 */
export function formatPaymentTerms(days: number): string {
  return `Net ${days}`;
}

export const DecisionSchema = z.object({
  action: z.enum(["ACCEPT", "COUNTER", "WALK_AWAY", "ESCALATE", "ASK_CLARIFY"]),
  utilityScore: z.number(),
  counterOffer: OfferSchema.nullable(),
  reasons: z.array(z.string()),
});
export type Decision = z.infer<typeof DecisionSchema>;

export type Explainability = {
  vendorOffer: { total_price: number | null; payment_terms: string | null };
  utilities: {
    priceUtility: number | null;
    termsUtility: number | null;
    weightedPrice: number | null;
    weightedTerms: number | null;
    total: number | null;
  };
  decision: {
    action: string;
    reasons: string[];
    counterOffer?: { total_price: number | null; payment_terms: string | null } | null;
  };
  configSnapshot: {
    weights: { price: number; terms: number };
    thresholds: { accept: number; escalate: number; walkaway: number };
    totalPrice: { anchor: number; target: number; max: number; step: number };
    termOptions: string[];
  };
};

// ============================================
// WEIGHTED UTILITY TYPES (Step 4 Integration)
// ============================================

/**
 * Parameter utility types - how utility is calculated for each parameter
 */
export type ParameterUtilityType = 'linear' | 'binary' | 'stepped' | 'date' | 'percentage' | 'boolean';

/**
 * Parameter direction - which direction is better
 */
export type ParameterDirection = 'lower_better' | 'higher_better' | 'match_target' | 'closer_better';

/**
 * Parameter status based on utility score
 */
export type ParameterStatus = 'excellent' | 'good' | 'warning' | 'critical';

/**
 * Configuration for a single weighted parameter
 */
export interface WeightedParameterConfig {
  id: string;
  name: string;
  weight: number;                    // 0-100, from Step 4 wizard
  source: 'step2' | 'step3' | 'custom';
  utilityType: ParameterUtilityType;
  direction: ParameterDirection;
  target: number | string | boolean | null;
  min?: number | string | null;
  max?: number | string | null;
  // For stepped utility (like payment terms)
  options?: string[];
  optionUtilities?: Record<string, number>;
}

/**
 * Individual parameter utility result
 */
export interface ParameterUtilityResult {
  parameterId: string;
  parameterName: string;
  utility: number;                   // 0-1
  weight: number;                    // 0-100
  contribution: number;              // utility × (weight / 100)
  currentValue: number | string | boolean | null;
  targetValue: number | string | boolean | null;
  maxValue?: number | string | null;
  status: ParameterStatus;
  color: string;                     // For UI display
}

/**
 * Threshold configuration for decisions
 */
export interface ThresholdConfig {
  accept: number;                    // Default: 0.70 (70%)
  escalate: number;                  // Default: 0.50 (50%)
  walkAway: number;                  // Default: 0.30 (30%)
}

/**
 * Default threshold values
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  accept: 0.70,
  escalate: 0.50,
  walkAway: 0.30,
};

/**
 * Complete weighted utility calculation result
 */
export interface WeightedUtilityResult {
  totalUtility: number;              // 0-1
  totalUtilityPercent: number;       // 0-100 for display
  parameterUtilities: Record<string, ParameterUtilityResult>;
  thresholds: ThresholdConfig;
  recommendation: 'ACCEPT' | 'COUNTER' | 'ESCALATE' | 'WALK_AWAY';
  recommendationReason: string;
}

/**
 * Extended negotiation config with weighted parameters
 */
export interface WeightedNegotiationConfig {
  parameters: Record<string, WeightedParameterConfig>;
  thresholds: ThresholdConfig;
  maxRounds: number;
  // Legacy support
  legacyConfig?: {
    total_price: {
      weight: number;
      anchor: number;
      target: number;
      max_acceptable: number;
      concession_step: number;
    };
    payment_terms: {
      weight: number;
      options: string[];
      utility: Record<string, number>;
    };
  };
}

/**
 * Parsed offer from vendor message - extended with all parameters
 */
export interface ParsedVendorOffer {
  // Step 2 - Commercial
  unitPrice?: number | null;
  totalPrice?: number | null;
  volumeDiscount?: number | null;
  paymentTermsDays?: number | null;
  paymentTerms?: string | null;
  advancePayment?: number | null;
  deliveryDate?: string | Date | null;
  partialDelivery?: boolean | null;
  // Step 3 - Contract
  warrantyMonths?: number | null;
  lateDeliveryPenalty?: number | null;
  qualityCertifications?: string[] | null;
  // Custom parameters
  customParameters?: Record<string, number | string | boolean | null>;
  // Raw extracted text for debugging
  _raw?: Record<string, string>;
}

/**
 * Helper function to get status from utility score
 */
export function getStatusFromUtility(utility: number): ParameterStatus {
  if (utility >= 0.80) return 'excellent';
  if (utility >= 0.60) return 'good';
  if (utility >= 0.40) return 'warning';
  return 'critical';
}

/**
 * Helper function to get status color
 */
export function getStatusColor(status: ParameterStatus): string {
  switch (status) {
    case 'excellent': return '#22c55e';  // green-500
    case 'good': return '#3b82f6';       // blue-500
    case 'warning': return '#eab308';    // yellow-500
    case 'critical': return '#ef4444';   // red-500
  }
}

/**
 * Helper function to get recommendation from utility score
 */
export function getRecommendationFromUtility(
  utility: number,
  thresholds: ThresholdConfig = DEFAULT_THRESHOLDS
): { action: 'ACCEPT' | 'COUNTER' | 'ESCALATE' | 'WALK_AWAY'; reason: string } {
  if (utility >= thresholds.accept) {
    return {
      action: 'ACCEPT',
      reason: `Utility score (${(utility * 100).toFixed(0)}%) meets acceptance threshold (${(thresholds.accept * 100).toFixed(0)}%)`
    };
  }
  if (utility < thresholds.walkAway) {
    return {
      action: 'WALK_AWAY',
      reason: `Utility score (${(utility * 100).toFixed(0)}%) is below walk-away threshold (${(thresholds.walkAway * 100).toFixed(0)}%)`
    };
  }
  if (utility < thresholds.escalate) {
    return {
      action: 'ESCALATE',
      reason: `Utility score (${(utility * 100).toFixed(0)}%) is in escalation zone (${(thresholds.walkAway * 100).toFixed(0)}%-${(thresholds.escalate * 100).toFixed(0)}%)`
    };
  }
  return {
    action: 'COUNTER',
    reason: `Utility score (${(utility * 100).toFixed(0)}%) is in negotiation zone (${(thresholds.escalate * 100).toFixed(0)}%-${(thresholds.accept * 100).toFixed(0)}%)`
  };
}

// ============================================
// BEHAVIORAL ANALYSIS TYPES (February 2026)
// ============================================

/**
 * Behavioral signals extracted from negotiation message history.
 * Used by the adaptive negotiation engine to adjust strategy dynamically.
 */
export interface BehavioralSignals {
  // Concession analysis
  /** Average price concession per round ($/round) */
  concessionVelocity: number;
  /** Are concessions getting bigger over successive rounds? */
  concessionAccelerating: boolean;
  /** Most recent price change amount */
  lastConcessionSize: number;

  // Convergence analysis
  /** Gap between vendor and PM offers for last 3 rounds */
  priceGapTrend: number[];
  /** % gap reduction per round (positive = converging) */
  convergenceRate: number;
  /** Gap shrinking consistently? */
  isConverging: boolean;
  /** Same/similar offers for 2+ rounds? */
  isStalling: boolean;
  /** Gap growing? */
  isDiverging: boolean;

  // Engagement signals (computed from message timestamps)
  /** Average vendor response time in milliseconds */
  avgResponseTimeMs: number;
  /** Trend of response times */
  responseTimeTrend: 'faster' | 'slower' | 'stable';

  // Sentiment (keyword-based, not LLM)
  /** Latest detected sentiment from vendor message */
  latestSentiment: 'positive' | 'neutral' | 'resistant' | 'urgent';

  // Overall momentum: -1 (losing) to +1 (winning)
  /** Composite momentum score */
  momentum: number;
}

/**
 * Result of adaptive strategy computation.
 * Replaces static base aggressiveness when adaptive features are enabled.
 */
export interface AdaptiveStrategyResult {
  /** Modified aggressiveness (replaces static base) */
  adjustedAggressiveness: number;
  /** Human-readable strategy label */
  strategyLabel: 'Holding Firm' | 'Accelerating' | 'Matching Pace' | 'Final Push';
  /** Dynamic round extension signal */
  shouldExtendRounds: boolean;
  /** Early escalation signal */
  shouldEscalateEarly: boolean;
  /** Human-readable explanation */
  reasoning: string;
}

/**
 * Configuration for dynamic round limits.
 * Stored in negotiationConfigJson when adaptive features are enabled.
 */
export interface DynamicRoundConfig {
  /** Current max_rounds becomes this (user's chosen value) */
  softMaxRounds: number;
  /** Hard ceiling (softMax * 1.5) - never exceeded */
  hardMaxRounds: number;
  /** Feature flag for auto-extension */
  autoExtendEnabled: boolean;
}

/**
 * Historical insights for a vendor/category from past deals.
 * Used for adaptive anchoring.
 */
export interface HistoricalInsights {
  /** Average rounds to close for this vendor */
  avgRoundsToClose: number;
  /** Average price reduction percentage achieved */
  avgPriceReduction: number;
  /** Ratio of (anchor - finalPrice) / (anchor - target) */
  anchorEffectiveness: number;
  /** Behavioral profile of the vendor */
  vendorBehaviorProfile: 'quick_closer' | 'hard_negotiator' | 'walker' | 'unknown';
  /** Number of historical deals analyzed */
  sampleSize: number;
}

/**
 * Adaptive features configuration flags.
 * Stored in negotiationConfigJson.adaptiveFeatures
 */
export interface AdaptiveFeaturesConfig {
  /** Master flag - all adaptive features gated behind this */
  enabled: boolean;
  /** Whether historical anchor adjustment was applied */
  historicalAnchor: boolean;
  /** Dynamic round limit configuration */
  dynamicRounds?: DynamicRoundConfig;
  /** Original anchor before historical adjustment (for transparency) */
  originalAnchor?: number;
}

// ============================================
// PACTUM-STYLE EXTENDED TYPES (February 2026)
// ============================================

/**
 * Accordo default VALUES from the wizard
 * Used when user doesn't modify values in the Deal Wizard
 */
export const ACCORDO_DEFAULTS = {
  targetUnitPrice: null as number | null,
  maxAcceptablePrice: null as number | null,
  paymentTermsMinDays: 30,        // Net 30
  paymentTermsMaxDays: 60,        // Net 60
  warrantyPeriodMonths: 12,       // 1 year
  lateDeliveryPenaltyPerDay: 1,   // 1%
  qualityStandards: [] as string[],
  maxRounds: 50,                  // Feb 2026: Increased from 10 to 50 for extended negotiations
  walkawayThreshold: 20,          // 20%
  priority: 'MEDIUM' as 'HIGH' | 'MEDIUM' | 'LOW',
  mode: 'CONVERSATION' as 'INSIGHTS' | 'CONVERSATION',
} as const;

/**
 * Accordo default WEIGHTS from Step 4 of the Deal Wizard
 * Used when user keeps AI-suggested weights (aiSuggested = true)
 * Updated Feb 2026: Simplified to 7 core utility parameters
 * Removed: paymentTermsRange, partialDelivery, lateDeliveryPenalty, maxRounds, walkawayThreshold
 */
export const DEFAULT_WEIGHTS = {
  targetUnitPrice: 40,
  maxAcceptablePrice: 25,
  deliveryDate: 15,
  warrantyPeriod: 15,
  qualityStandards: 5,
} as const;

/**
 * Extended offer type with all Pactum-style parameters
 * Supports full multi-parameter negotiation
 */
export interface ExtendedOffer {
  // Price
  total_price: number | null;
  unit_price?: number | null;
  volume_discount?: number | null;

  // Payment
  payment_terms: string | null;           // "Net 30", "Net 60", etc.
  payment_terms_days?: number | null;     // Parsed: 30, 60, 90
  advance_payment_percent?: number | null;

  // Delivery
  delivery_date?: string | null;
  delivery_days?: number | null;
  partial_delivery_allowed?: boolean | null;

  // Contract
  warranty_months?: number | null;
  late_penalty_percent?: number | null;
  quality_certifications?: string[] | null;

  // Custom/Marketing
  marketing_allowance?: number | null;

  // Metadata
  meta?: {
    raw_terms_days?: number;
    non_standard_terms?: boolean;
    delivery_source?: 'explicit_date' | 'relative_days' | 'timeframe' | 'asap';
    raw_delivery_text?: string;
    raw_price_text?: string;
    raw_terms_text?: string;
    currency_detected?: 'USD' | 'INR' | 'EUR' | 'GBP' | 'AUD';
    currency_converted?: boolean;
    original_currency?: 'USD' | 'INR' | 'EUR' | 'GBP' | 'AUD';
    original_price?: number;
  };
}

/**
 * Wizard configuration from Deal Wizard Steps 1-4
 * Stored in negotiationConfigJson.wizardConfig
 */
export interface WizardConfig {
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  priceQuantity: {
    targetUnitPrice: number | null;
    maxAcceptablePrice: number | null;
    minOrderQuantity: number | null;
    preferredQuantity?: number | null;
  };
  paymentTerms: {
    minDays: number | null;
    maxDays: number | null;
    acceptedMethods?: ('BANK_TRANSFER' | 'CREDIT' | 'LC')[];
  };
  delivery: {
    requiredDate: string | null;
    preferredDate?: string | null;
    locationId?: number | null;
    locationAddress?: string | null;
    partialDelivery: {
      allowed: boolean;
      type?: 'QUANTITY' | 'PERCENTAGE' | null;
      minValue?: number | null;
    };
  };
  contractSla: {
    warrantyPeriod: '0_MONTHS' | '6_MONTHS' | '1_YEAR' | '2_YEARS' | '3_YEARS' | '5_YEARS' | 'CUSTOM';
    customWarrantyMonths?: number;
    defectLiabilityMonths?: number;
    lateDeliveryPenaltyPerDay: number;
    maxPenaltyCap?: {
      type: 'PERCENTAGE' | 'FIXED';
      value?: number;
    };
    qualityStandards?: string[];
  };
  negotiationControl: {
    deadline?: string | null;
    maxRounds: number;
    walkawayThreshold: number;
  };
  customParameters?: Array<{
    id?: string;
    name: string;
    type: 'BOOLEAN' | 'NUMBER' | 'TEXT' | 'DATE';
    targetValue: boolean | number | string;
    flexibility: 'FIXED' | 'FLEXIBLE' | 'NICE_TO_HAVE';
    includeInNegotiation: boolean;
  }>;
  /** Step 4 weights - record of parameterId -> weight (0-100) */
  parameterWeights?: Record<string, number>;
  /** Whether weights are AI-suggested (true) or user-modified (false) */
  aiSuggested?: boolean;
}

/**
 * Resolved configuration with user values taking priority over defaults
 * Used internally by the negotiation engine
 */
export interface ResolvedNegotiationConfig {
  // Resolved VALUES (user if provided, else default)
  targetPrice: number;
  maxAcceptablePrice: number;
  paymentTermsMinDays: number;
  paymentTermsMaxDays: number;
  deliveryDate: Date | null;
  preferredDeliveryDate: Date | null;
  partialDeliveryAllowed: boolean;
  warrantyPeriodMonths: number;
  lateDeliveryPenaltyPerDay: number;
  qualityStandards: string[];
  maxRounds: number;
  walkawayThreshold: number;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';

  // Resolved WEIGHTS (user-modified or AI-suggested defaults)
  weights: Record<string, number>;
  weightsAreUserModified: boolean;

  // Thresholds
  acceptThreshold: number;
  escalateThreshold: number;
  walkAwayThreshold: number;

  // Calculated values
  anchorPrice: number;
  priceRange: number;
  concessionStep: number;

  // Source tracking for explainability
  sources: Record<string, 'user' | 'default' | 'calculated'>;
}

/**
 * Parse warranty period string to months
 */
export function parseWarrantyPeriodToMonths(period: string | null | undefined): number {
  if (!period) return ACCORDO_DEFAULTS.warrantyPeriodMonths;

  const mapping: Record<string, number> = {
    '0_MONTHS': 0,
    '6_MONTHS': 6,
    '1_YEAR': 12,
    '2_YEARS': 24,
    '3_YEARS': 36,
    '5_YEARS': 60,
  };

  return mapping[period] ?? ACCORDO_DEFAULTS.warrantyPeriodMonths;
}

