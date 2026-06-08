import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

/**
 * Analysis results from intelligence agents (Track 2: Yug).
 */
export interface IntelligenceAnalysis {
  tone?: {
    sentiment: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "MIXED";
    formality: number; // 0-1 (0 = Casual, 1 = Formal)
    urgency: number;   // 0-1 (0 = Relaxed, 1 = Urgent)
    styleSignals: Record<string, number>; // The 11 signals from tone-detector.ts
  };
  behavior?: {
    concessionVelocity: "FAST" | "STEADY" | "SLOW" | "STALLED";
    momentum: "ACCELERATING" | "DECELERATING" | "STABLE";
    rigidityScore: number; // 0-1 (0 = Flexible, 1 = Rigid)
  };
  concerns?: Array<{
    category: "PRICING" | "DELIVERY" | "QUALITY" | "PAYMENT_TERMS" | "OTHER";
    description: string;
    priority: "HIGH" | "MEDIUM" | "LOW";
  }>;
  urgency?: "HIGH" | "MEDIUM" | "LOW"; // Global urgency level
}

/**
 * Common Offer interface used across all agents.
 * Derived from existing Offer and ParsedVendorOffer types in the codebase.
 */
export interface Offer {
  totalPrice: number | null;
  unitPrice?: number | null;
  paymentTerms?: string | null;
  paymentTermsDays?: number | null;
  deliveryDate?: string | null;
  deliveryDays?: number | null;
  partialDelivery?: boolean | null;
  warrantyMonths?: number | null;
  lateDeliveryPenalty?: number | null;
  qualityCertifications?: string[] | null;
  advancePayment?: number | null;
  volumeDiscount?: number | null;
  currency?: string;
  customParameters?: Record<string, any>;
  isComplete?: boolean;
}

/**
 * Strategic decision from the brain (Track 1: Vatsal).
 */
export interface NegotiationDecision {
  action: "ACCEPT" | "COUNTER" | "ESCALATE" | "STALL" | "WAIT" | "WALK_AWAY";
  reasoning: string;
  confidence: number;
  utilityScore?: number;
  parametersMet?: string[];
  parametersFailed?: string[];
}

/**
 * NegotiationState represents the single source of truth for the entire agentic workflow.
 * This interface is the immutable contract shared between all three tracks (Vatsal, Yug, Adarsh).
 */
export const NegotiationStateAnnotation = Annotation.Root({
  /**
   * History of all messages (vendor, accordo, system).
   * MessagesAnnotation handles standard message merging logic.
   */
  ...MessagesAnnotation.spec,

  /**
   * Core identifiers.
   */
  dealId: Annotation<string>,
  rfqId: Annotation<number | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),
  vendorId: Annotation<number | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),
  
  /**
   * Negotiation configuration and constraints.
   */
  config: Annotation<any | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * The current negotiation round number.
   */
  round: Annotation<number>({
    reducer: (old, newest) => newest ?? old,
    default: () => 1,
  }),

  /**
   * The parsed offer extracted from the latest vendor message.
   */
  parsedOffer: Annotation<Offer | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Analysis results from intelligence agents (Track 2: Yug).
   */
  analysis: Annotation<IntelligenceAnalysis>({
    reducer: (old, newest) => ({ ...old, ...newest }),
    default: () => ({}),
  }),

  /**
   * Vendor profile and historical preferences (Track 3: Adarsh).
   */
  vendorProfile: Annotation<any | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Multi-equivalent simultaneous offers (Track 3: Adarsh).
   */
  mesoOptions: Annotation<Offer[]>({
    reducer: (old, newest) => newest ?? old,
    default: () => [],
  }),

  /**
   * Negotiation health and stall detection status (Track 3: Adarsh).
   */
  stallStatus: Annotation<{
    isStalled: boolean;
    roundsWithoutProgress: number;
    momentumTrend: "UP" | "DOWN" | "STABLE";
  } | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Strategic decision from the brain (Track 1: Vatsal).
   */
  decision: Annotation<NegotiationDecision | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Proposed counter-offer details (Track 3: Adarsh).
   */
  counterOffer: Annotation<Offer | null>({
    reducer: (old, newest) => newest ?? old,
    default: () => null,
  }),

  /**
   * Flag for Human-in-the-Loop interruptions.
   */
  waitingForHuman: Annotation<boolean>({
    reducer: (old, newest) => newest ?? old,
    default: () => false,
  }),

  /**
   * Metadata for tracing, debugging, and audit trails.
   */
  metadata: Annotation<Record<string, any>>({
    reducer: (old, newest) => ({ ...old, ...newest }),
    default: () => ({}),
  }),
});

export type NegotiationState = typeof NegotiationStateAnnotation.State;
