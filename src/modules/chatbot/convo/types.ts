/**
 * Type definitions for Conversation Mode
 *
 * This module handles natural language negotiation between internal users (buyers)
 * and vendors. Unlike INSIGHTS mode (demo/simulation), CONVERSATION mode requires
 * a real vendor user to be attached to the contract.
 */

/**
 * Conversation Phase Transitions:
 * WAITING_FOR_OFFER → User sends greeting or asks for offer
 * NEGOTIATING → Vendor provides offer, decision engine evaluates
 * WAITING_FOR_PREFERENCE → After multiple rounds, ask vendor preference
 * TERMINAL → Deal reaches final state (ACCEPTED, WALKED_AWAY, ESCALATED)
 */
export type ConversationPhase =
  | "WAITING_FOR_OFFER"
  | "NEGOTIATING"
  | "WAITING_FOR_PREFERENCE"
  | "TERMINAL";

/**
 * Vendor Preference Detection
 * Based on analyzing negotiation history to detect if vendor prioritizes:
 * - PRICE: More price concessions than terms concessions
 * - TERMS: More terms concessions than price concessions
 * - NEITHER: No clear preference detected
 */
export type VendorPreference = "PRICE" | "TERMS" | "NEITHER";

/**
 * Types of vendor refusals to share information
 */
export type RefusalType =
  | "NO"
  | "LATER"
  | "ALREADY_SHARED"
  | "CONFUSED"
  | "REJECT_TERMS"
  | null;

/**
 * Conversation Intent Classification
 * Determines what type of reply to generate from Accordo
 */
export type ConversationIntent =
  | "GREET" // Vendor sends initial greeting
  | "ASK_FOR_OFFER" // Vendor hasn't provided offer yet
  | "COUNTER_DIRECT" // Counter-offer with explicit values
  | "COUNTER_INDIRECT" // Counter-offer with vague/strategic language
  | "ACCEPT" // Accept vendor's offer
  | "WALK_AWAY" // End negotiation (unacceptable offer)
  | "ESCALATE" // Request human intervention
  | "ASK_FOR_PREFERENCE" // Ask vendor about their priorities
  | "ACKNOWLEDGE_PREFERENCE" // Acknowledge vendor's stated preference
  | "HANDLE_REFUSAL"; // Respond to vendor refusing to share info

/**
 * Offer structure (from engine/types.ts)
 * Using snake_case to match engine types
 * UPDATED January 2026: payment_terms now accepts any "Net X" format (X = 1-120 days)
 * UPDATED February 2026: Changed from unit_price to total_price
 * UPDATED February 2026: Added currency detection and conversion meta fields
 */
export interface Offer {
  total_price: number | null;
  payment_terms: string | null; // Any "Net X" format (e.g., "Net 45", "Net 30", etc.)
  payment_terms_days?: number | null; // Days value for utility calculations
  delivery_date?: string | null; // ISO date string (YYYY-MM-DD)
  delivery_days?: number | null; // Days from today
  meta?: {
    raw_terms_days?: number;
    non_standard_terms?: boolean;
    // Delivery meta
    delivery_source?: "explicit_date" | "relative_days" | "timeframe" | "asap";
    raw_delivery_text?: string;
    // Price parsing meta (February 2026)
    raw_price_text?: string;
    raw_terms_text?: string;
    // Currency meta (February 2026)
    currency_detected?: "USD" | "INR" | "EUR" | "GBP" | "AUD";
    currency_converted?: boolean;
    original_currency?: "USD" | "INR" | "EUR" | "GBP" | "AUD";
    original_price?: number;
  };
}

/**
 * Conversation State (persisted in chatbot_deals.convo_state_json)
 */
export interface ConversationState {
  /**
   * Current phase of the conversation
   */
  phase: ConversationPhase;

  /**
   * Whether we've explicitly asked vendor about their preference
   */
  askedPreference: boolean;

  /**
   * Last known vendor offer (used for merging incomplete offers)
   */
  lastVendorOffer: Offer | null;

  /**
   * Auto-detected vendor preference based on concession patterns
   */
  detectedPreference: VendorPreference;

  /**
   * Timestamp of last state transition (for debugging)
   */
  lastTransitionAt?: string;

  /**
   * Rolling history of PM counter prices (most recent last).
   * Used for monotonic-floor enforcement and identical-counter stall detection.
   */
  pmCounterHistory?: number[];

  /**
   * True once we've made our "last attempt" counter at max_acceptable in
   * response to a vendor firmness signal. If the vendor is still firm and
   * over-budget on the next round, we escalate.
   */
  lastAttemptUsed?: boolean;

  // ── Endgame flow state (May 2026) ──
  // Tracks the MESO-before-walkaway state machine.

  /**
   * Current endgame phase:
   * - undefined / "NORMAL": standard negotiation
   * - "COUNTERING_AT_MAX": vendor above max but within 10%, countering at max
   * - "FINAL_MESO_SHOWN": final MESO with Others presented after 2 max-counters
   */
  endgamePhase?: "NORMAL" | "COUNTERING_AT_MAX" | "FINAL_MESO_SHOWN";

  /** How many consecutive rounds we've countered at max_acceptable during endgame */
  endgameCounterRounds?: number;

  /** Round at which endgame MESO was first shown (for dedup) */
  endgameMesoRound?: number;

  /** Round at which final endgame MESO was shown */
  endgameFinalMesoRound?: number;
}

/**
 * Input for processing a conversation message
 */
export interface ProcessConversationMessageInput {
  dealId: string;
  vendorMessage: string;
  userId: number; // Internal user (buyer) managing the deal
}

/**
 * Result of processing a conversation message
 */
export interface ProcessConversationMessageResult {
  success: boolean;
  message: string;
  data?: {
    /**
     * The Accordo reply generated by LLM
     */
    accordoMessage: {
      id: string;
      role: "ACCORDO";
      content: string;
      createdAt: Date;
    };

    /**
     * Updated conversation state
     */
    conversationState: ConversationState;

    /**
     * Whether explainability is available for this round
     */
    revealAvailable: boolean;

    /**
     * Updated deal status
     */
    dealStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED";

    /**
     * Delay in milliseconds that was applied server-side before sending this response.
     * Frontend should show a typing indicator for this duration before rendering the message.
     */
    delayMs?: number;

    /**
     * MESO options if MESO was triggered this round.
     * Frontend should render MESO cards when this is present.
     */
    meso?: {
      options: Array<{
        id: string;
        offer: Record<string, unknown>;
        utility: number;
        label: string;
        description: string;
        emphasis: string[];
        tradeoffs: string[];
      }>;
      showOthers: boolean;
      isFinal: boolean;
      phase: string;
      currency: string;
      inputDisabled: boolean;
      disabledMessage?: string;
    } | null;
  };
  error?: string;
}

/**
 * Decision structure (from engine/types.ts)
 * Using snake_case to match engine types
 */
export interface Decision {
  action:
    | "ACCEPT"
    | "COUNTER"
    | "WALK_AWAY"
    | "ESCALATE"
    | "ASK_CLARIFY"
    | "MESO";
  utilityScore: number;
  counterOffer: Offer | null;
  reasons: string[];
}

/**
 * Explainability structure (from engine/types.ts)
 * Re-exported here for convenience
 */
export interface Explainability {
  round: number;
  vendorOffer: Offer;
  utilityBreakdown: {
    priceUtility: number;
    termsUtility: number;
    totalUtility: number;
  };
  decision: Decision;
  timestamp: string;
}
