/**
 * Unified message pipeline types (P0+).
 *
 * @see chatbot_pipeline_implementation_plan.md at repo root
 */

/** Intent detected in Step 2 — classifyMessage() */
export type ClassificationIntentType =
  | "NEGOTIATION_OFFER"
  | "PARTIAL_OFFER"
  /** Vendor asks PM for best price at specific terms (e.g. "what can you offer for net 60?") */
  | "VENDOR_TERMS_INQUIRY"
  | "GREETING"
  | "SMALL_TALK"
  | "OFF_TOPIC"
  | "UNPARSEABLE";

/** Vendor question about PM price at specific payment terms — from detectTermsRequest() */
export interface VendorTermsRequest {
  requestedDays: number;
  matchedText: string;
}

/** Router destination after classification */
export type ClassificationRoute =
  | "FULL_NEGOTIATION_PIPELINE"
  | "CHAT_RESPONSE"
  | "ASK_CLARIFICATION"
  | "SOFT_DECLINE"
  | "REDIRECT";

/** Deal context required for price-band checks */
export interface DealClassificationContext {
  expectedPriceRange: {
    min: number;
    max: number;
  };
  /** RFQ currency for parseOfferRegex — required on pipeline turns */
  currencyCode: string;
  round?: number;
  category?: string;
  productName?: string;
}

/** Output of classifyMessage() — Step 2 in unified pipeline */
export interface ClassificationResult {
  type: ClassificationIntentType;
  parseable: boolean;
  priceInRange: boolean | null;
  confidence: number;
  extractedPrice: number | null;
  extractedDays: number | null;
  route: ClassificationRoute;
  /** Present on SOFT_DECLINE — upper bound used for band check */
  rangeMax?: number;
  /** Present when vendor asks for PM counter at specific terms */
  termsRequest?: VendorTermsRequest;
  /** Vendor proposes a convergence / meeting price (e.g. "lets meet at X") */
  isMeetingProposal?: boolean;
}

/** Multiplier for classifier pre-gate (flow docs: allow up to 2× max before soft decline) */
export const CLASSIFIER_PRICE_BAND_MULTIPLIER = 2.0;

/**
 * Which HTTP surface invoked runAgentTurn — NOT the speaker role.
 *
 * Every turn is: inbound VENDOR (seller) message → outbound ACCORDO (PM) response.
 */
export type PipelineEntryChannel = "internal_app" | "vendor_portal";

export interface AgentTurnEntryContext {
  /** Authenticated internal app vs public vendor portal */
  entryChannel: PipelineEntryChannel;
  /** Required for internal_app — deal owner authorization (not the message author) */
  dealOwnerUserId?: number;
}

export interface AgentTurnInput {
  dealId: string;
  /** Required unless existingVendorMessageId is set (phase-2 async PM flow) */
  message?: string;
  /** When set, vendor message is already saved — only classify, respond, persist PM */
  existingVendorMessageId?: string;
  entryContext: AgentTurnEntryContext;
  /** When false, classify + route only — no DB writes (unit tests) */
  persist?: boolean;
}

/** Handler stage after P0.3 / P0.4 LLM */
export type AgentTurnHandlerStage = "P0.3_CHAT" | "P0.4_NEGOTIATION";

export interface AgentTurnResult {
  success: true;
  dealId: string;
  round: number;
  classification: ClassificationResult;
  route: ClassificationRoute;
  vendorMessageId: string | null;
  pmMessageId: string | null;
  pmContent: string | null;
  handlerStage: AgentTurnHandlerStage;
  entryChannel: PipelineEntryChannel;
  decisionAction: string | null;
  fromLlm: boolean;
  generationSource: "llm" | "fallback";
  dealStatus: "NEGOTIATING" | "ACCEPTED" | "WALKED_AWAY" | "ESCALATED";
}

/** Stored on vendor message engineDecision until classification DB columns (P4) */
export interface PipelineClassificationRecord {
  pipelineVersion: "P0.3";
  entryChannel: PipelineEntryChannel;
  classification: ClassificationResult;
}
