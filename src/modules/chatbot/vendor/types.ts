/**
 * Type definitions for Vendor Simulation
 *
 * Vendor simulation allows testing negotiation strategies against AI-powered
 * vendor agents with different negotiation scenarios.
 */

/**
 * Vendor Scenarios
 *
 * - HARD: Very resistant to concessions, makes minimal price reductions
 * - MEDIUM: Moderately flexible, balanced negotiation approach
 * - SOFT: Willing to negotiate, makes reasonable concessions quickly
 * - WALK_AWAY: Inflexible, unlikely to make concessions, may terminate negotiation
 */
export type VendorScenario = 'HARD' | 'MEDIUM' | 'SOFT' | 'WALK_AWAY';

/**
 * Vendor negotiation policy/constraints
 */
export interface VendorPolicy {
  /**
   * Minimum price vendor is willing to accept (floor price)
   */
  minPrice: number;

  /**
   * Starting price (initial offer)
   */
  startPrice: number;

  /**
   * Preferred payment terms
   */
  preferredTerms: 'Net 30' | 'Net 60' | 'Net 90';

  /**
   * How much vendor will reduce price per round
   */
  concessionStep: number;

  /**
   * Maximum number of negotiation rounds before walking away
   */
  maxRounds: number;

  /**
   * Minimum acceptable payment terms (vendor's worst case)
   */
  minAcceptableTerms?: 'Net 30' | 'Net 60' | 'Net 90';
}

/**
 * Input for generating vendor reply
 */
export interface GenerateVendorReplyInput {
  /**
   * Deal ID
   */
  dealId: string;

  /**
   * Current negotiation round
   */
  round: number;

  /**
   * Last offer from Accordo
   */
  lastAccordoOffer: {
    total_price: number | null;
    payment_terms: string | null;
  } | null;

  /**
   * Vendor scenario (behavior pattern)
   */
  scenario?: VendorScenario;

  /**
   * Custom vendor policy (overrides scenario defaults)
   */
  customPolicy?: Partial<VendorPolicy>;

  /**
   * PM's price configuration from wizard (required for correct vendor pricing)
   * Vendor prices should be ABOVE PM's target price
   */
  pmPriceConfig?: {
    /** PM's minimum total price (what PM wants to pay - lowest) */
    minTotalPrice: number;
    /** PM's maximum total price (ceiling - vendor should start above this for HARD) */
    maxTotalPrice: number;
  };
}

/**
 * Result of vendor reply generation
 */
export interface VendorReplyResult {
  success: boolean;
  message: string;
  data?: {
    /**
     * Generated vendor message content
     */
    content: string;

    /**
     * Extracted offer from vendor message
     */
    offer: {
      total_price: number | null;
      payment_terms: string | null;
    };

    /**
     * Vendor scenario used
     */
    scenario: VendorScenario;
  };
  error?: string;
}

/**
 * Scenario detection result
 */
export interface ScenarioDetectionResult {
  /**
   * Detected scenario based on vendor's past behavior
   */
  scenario: VendorScenario;

  /**
   * Confidence level (0-1)
   */
  confidence: number;

  /**
   * Reasoning for the detection
   */
  reason: string;

  /**
   * Statistics used for detection
   */
  stats: {
    avgConcession: number;
    concessionCount: number;
    roundsNegotiated: number;
  };
}
