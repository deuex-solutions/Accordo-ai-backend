/**
 * Step 3 router branch — maps classification.route to P0.3 / P0.4 handlers.
 */

import { composeChatResponse } from "./compose-chat-response.js";
import { runNegotiationPathP0 } from "./negotiation-path-p0.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import type {
  AgentTurnHandlerStage,
  ClassificationResult,
  ClassificationRoute,
  DealClassificationContext,
} from "./types.js";
import type { Decision } from "../engine/types.js";
import type { Explainability } from "../engine/types.js";
import type { DealCommercialContext } from "./deal-commercial-context.js";
import chatbotRepo from "../chatbot.repo.js";
import { resolvePmNegotiationRoundNumber } from "./negotiation-round.js";
import { buildConversationContextSummary } from "../../../llm/conversation-context-summary.js";

export interface AgentTurnDispatchContext {
  deal: ChatbotDeal;
  message: string;
  classification: ClassificationResult;
  dealContext: DealClassificationContext;
  commercial: DealCommercialContext;
}

export interface RouteHandlerResult {
  handlerStage: AgentTurnHandlerStage;
  pmContent: string;
  fromLlm: boolean;
  decisionAction: string;
  decision?: Decision;
  explainability?: Explainability | null;
}

export function handlerStageForRoute(
  route: ClassificationRoute,
): AgentTurnHandlerStage {
  return route === "FULL_NEGOTIATION_PIPELINE"
    ? "P0.4_NEGOTIATION"
    : "P0.3_CHAT";
}

export async function dispatchByRoute(
  ctx: AgentTurnDispatchContext,
): Promise<RouteHandlerResult> {
  if (ctx.classification.route === "FULL_NEGOTIATION_PIPELINE") {
    const result = await runNegotiationPathP0({
      deal: ctx.deal,
      vendorMessage: ctx.message,
      classification: ctx.classification,
      commercial: ctx.commercial,
    });

    return {
      handlerStage: "P0.4_NEGOTIATION",
      pmContent: result.content,
      fromLlm: result.fromLlm,
      decisionAction: result.decision.action,
      decision: result.decision,
      explainability: result.explainability,
    };
  }

  const priorMessages = await chatbotRepo.findMessagesByDealId(ctx.deal.id);
  const pmRound = resolvePmNegotiationRoundNumber(
    priorMessages,
    ctx.deal.round,
  );
  const conversationContext = buildConversationContextSummary(
    priorMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      extractedOffer: msg.extractedOffer,
      counterOffer: msg.counterOffer,
      decisionAction: msg.decisionAction,
    })),
    ctx.commercial.currencySymbol,
    { currentVendorMessage: ctx.message },
  );
  const chat = await composeChatResponse({
    vendorMessage: ctx.message,
    classification: ctx.classification,
    dealContext: ctx.dealContext,
    currencyCode: ctx.commercial.currencyCode,
    dealTitle: ctx.deal.title ?? undefined,
    pmNegotiationRound: pmRound,
    conversationContext: conversationContext || undefined,
  });

  return {
    handlerStage: "P0.3_CHAT",
    pmContent: chat.content,
    fromLlm: chat.fromLlm,
    decisionAction: chat.decisionAction,
  };
}
