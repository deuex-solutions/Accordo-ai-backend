/**
 * Shared types and enums for the multi-agent negotiation system.
 */

export enum AgentName {
  OFFER_PARSER = "offer_parser",
  NEGOTIATION_DECISION = "negotiation_decision",
  RESPONSE_GENERATOR = "response_generator",
  TONE_ANALYZER = "tone_analyzer",
  BEHAVIORAL_ANALYZER = "behavioral_analyzer",
  MESO_GENERATOR = "meso_generator",
  STALL_RECOVERY = "stall_recovery",
  VENDOR_PROFILER = "vendor_profiler",
  ORCHESTRATOR = "orchestrator",
}

export enum NodeName {
  START = "__start__",
  END = "__end__",
  PARSE_INPUT = "parse_input",
  ANALYZE_SENTIMENT = "analyze_sentiment",
  DECIDE_STRATEGY = "decide_strategy",
  GENERATE_OFFERS = "generate_offers",
  FINALIZE_RESPONSE = "finalize_response",
  HUMAN_INTERVENTION = "human_intervention",
  EMAIL_NOTIFICATION = "email_notification",
  DOCUMENT_GENERATION = "document_generation",
}

export interface AgentNodeResult {
  next?: string;
  updates: Partial<any>;
}
