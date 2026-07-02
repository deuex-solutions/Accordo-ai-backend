/**
 * Unified vendor message pipeline (P0 → P4).
 */

export {
  classifyMessage,
  buildDealClassificationContext,
  CLASSIFIER_PRICE_BAND_MULTIPLIER,
  type ClassificationIntentType,
  type ClassificationResult,
  type ClassificationRoute,
  type DealClassificationContext,
} from "./message-classifier.js";

export { detectMessageIntent } from "./detect-message-intent.js";
export type { ParsedOfferSnapshot } from "./detect-message-intent.js";

export { buildClassificationContextFromDeal } from "./load-agent-turn-context.js";
export {
  resolveDealCommercialContext,
  resolveRfqCurrencyCode,
  resolveRfqCurrencyCodeSync,
  type DealCommercialContext,
} from "./deal-commercial-context.js";
export {
  loadNegotiationConfigFromDeal,
  getPriceBoundariesFromDeal,
  resolveDealCurrency,
  resolveDealCurrencyAsync,
} from "./load-negotiation-config-from-deal.js";
export { PM_RESPONSE_TIMEOUT_MS } from "./pipeline-timing.js";

export { composeChatResponse } from "./compose-chat-response.js";
export { runNegotiationPathP0 } from "./negotiation-path-p0.js";

export { runAgentTurn, type AgentTurnInput, type AgentTurnResult } from "./run-agent-turn.js";
export { runPmResponseViaPipeline } from "./pm-response-via-pipeline.js";
export { runVendorTurnFromInternalApp } from "./vendor-turn-from-internal-app.js";
export {
  dispatchByRoute,
  handlerStageForRoute,
  type AgentTurnDispatchContext,
  type RouteHandlerResult,
} from "./dispatch-by-route.js";

export type {
  PipelineEntryChannel,
  AgentTurnEntryContext,
  AgentTurnHandlerStage,
  PipelineClassificationRecord,
} from "./types.js";
