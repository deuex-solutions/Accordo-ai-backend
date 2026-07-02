/**
 * Step 3 — runAgentTurn() router
 *
 * Invariant: every turn is inbound VENDOR (seller) message → outbound ACCORDO (PM) reply.
 * entryContext.entryChannel identifies the HTTP surface only (internal app vs vendor portal).
 *
 * @source message_classifier_flow.md Step 3
 * @source vendor_message_pipeline.md Process A
 */

import { v4 as uuidv4 } from "uuid";
import { CustomError } from "../../../utils/custom-error.js";
import logger from "../../../config/logger.js";
import chatbotRepo from "../chatbot.repo.js";
import type { DealStatus } from "../../../models/chatbot-deal.js";
import type { Decision } from "../engine/types.js";
import { classifyMessage } from "./message-classifier.js";
import { buildClassificationContextFromDealAsync } from "./load-agent-turn-context.js";
import type {
  DealCommercialContext,
} from "./deal-commercial-context.js";
import { resolveDealCommercialContext } from "./deal-commercial-context.js";
import { dispatchByRoute } from "./dispatch-by-route.js";
import { recordPhrasing } from "../../../llm/phrasing-history.js";
import type {
  AgentTurnInput,
  AgentTurnResult,
  PipelineClassificationRecord,
} from "./types.js";

export type { AgentTurnInput, AgentTurnResult } from "./types.js";

async function assertDealReadyForTurn(
  dealId: string,
  entryContext: AgentTurnInput["entryContext"],
): Promise<{
  deal: NonNullable<Awaited<ReturnType<typeof chatbotRepo.findDealById>>>;
}> {
  const deal = await chatbotRepo.findDealById(dealId);
  if (!deal) {
    throw new CustomError("Deal not found", 404);
  }

  if (entryContext.entryChannel === "internal_app") {
    if (entryContext.dealOwnerUserId == null) {
      throw new CustomError(
        "dealOwnerUserId is required for internal_app agent turns",
        400,
      );
    }
    if (deal.userId !== entryContext.dealOwnerUserId) {
      throw new CustomError(
        "Unauthorized: Only deal creator can send messages",
        403,
      );
    }
  }

  if (deal.status !== "NEGOTIATING") {
    throw new CustomError(
      `Cannot process messages for deal with status: ${deal.status}`,
      400,
    );
  }

  return { deal };
}

async function resolveInboundMessage(
  input: AgentTurnInput,
  dealId: string,
  dealRound: number,
): Promise<{
  message: string;
  vendorMessageId: string | null;
  messageRound: number;
  skipVendorPersist: boolean;
}> {
  if (input.existingVendorMessageId) {
    const existing = await chatbotRepo.findMessageById(
      input.existingVendorMessageId,
    );
    if (!existing || existing.dealId !== dealId) {
      throw new CustomError("Vendor message not found", 404);
    }
    if (existing.role !== "VENDOR") {
      throw new CustomError("Message is not a vendor message", 400);
    }

    return {
      message: existing.content,
      vendorMessageId: existing.id,
      messageRound: existing.round || dealRound + 1,
      skipVendorPersist: true,
    };
  }

  if (!input.message?.trim()) {
    throw new CustomError("Message content is required", 400);
  }

  return {
    message: input.message.trim(),
    vendorMessageId: null,
    messageRound: dealRound + 1,
    skipVendorPersist: false,
  };
}

function buildVendorMessagePayload(
  dealId: string,
  message: string,
  messageRound: number,
  entryContext: AgentTurnInput["entryContext"],
  classification: AgentTurnResult["classification"],
): {
  id: string;
  dealId: string;
  role: "VENDOR";
  content: string;
  extractedOffer: object;
  engineDecision: PipelineClassificationRecord;
  round: number;
} {
  const engineDecision: PipelineClassificationRecord = {
    pipelineVersion: "P0.3",
    entryChannel: entryContext.entryChannel,
    classification,
  };

  return {
    id: uuidv4(),
    dealId,
    role: "VENDOR",
    content: message,
    extractedOffer: {
      total_price: classification.extractedPrice,
      payment_terms_days: classification.extractedDays,
    },
    engineDecision,
    round: messageRound,
  };
}

function buildPmEngineDecision(
  handler: Awaited<ReturnType<typeof dispatchByRoute>>,
  classification: AgentTurnResult["classification"],
): object {
  const base =
    (handler.decision as object) ??
    ({
      action: handler.decisionAction,
      pipelineRoute: handler.handlerStage,
    } as object);

  if (
    classification.route === "ASK_CLARIFICATION" &&
    classification.extractedPrice != null &&
    classification.extractedDays == null
  ) {
    return {
      ...base,
      pendingPrompt: { type: "payment_terms" },
    };
  }

  return base;
}

function resolveDealStatus(decision: Decision | undefined): DealStatus {
  if (!decision) {
    return "NEGOTIATING";
  }
  switch (decision.action) {
    case "ACCEPT":
      return "ACCEPTED";
    case "WALK_AWAY":
      return "WALKED_AWAY";
    case "ESCALATE":
      return "ESCALATED";
    default:
      return "NEGOTIATING";
  }
}

async function applyTerminalDealSideEffects(
  dealId: string,
  status: DealStatus,
  contractId: number | null,
  requisitionId: number | null,
): Promise<void> {
  if (!["ACCEPTED", "WALKED_AWAY", "ESCALATED"].includes(status)) {
    return;
  }

  const { syncContractStatus } = await import("../chatbot.service.js");
  const { captureVendorBid, checkAndTriggerComparison } = await import(
    "../../bid-comparison/bid-comparison.service.js"
  );

  syncContractStatus(dealId, status, contractId).catch((err) =>
    logger.error(
      `[Pipeline] Failed to sync contract status: ${(err as Error).message}`,
    ),
  );

  captureVendorBid(dealId)
    .then(() => {
      if (requisitionId != null) {
        return checkAndTriggerComparison(requisitionId);
      }
    })
    .catch((err: Error) =>
      logger.error(
        `[Pipeline] Failed terminal bid capture: ${err.message}`,
      ),
    );
}

async function persistPmResponse(
  dealId: string,
  messageRound: number,
  handler: Awaited<ReturnType<typeof dispatchByRoute>>,
  classification: AgentTurnResult["classification"],
): Promise<string> {
  const pmMessage = await chatbotRepo.createMessage({
    id: uuidv4(),
    dealId,
    role: "ACCORDO",
    content: handler.pmContent,
    extractedOffer: null,
    engineDecision: buildPmEngineDecision(handler, classification) as object,
    decisionAction: handler.decisionAction,
    utilityScore: handler.decision?.utilityScore ?? null,
    counterOffer: (handler.decision?.counterOffer as object) ?? null,
    explainabilityJson: (handler.explainability as object) ?? null,
    round: messageRound,
  });
  return pmMessage.id;
}

async function persistDealProgress(
  dealId: string,
  messageRound: number,
  handler: Awaited<ReturnType<typeof dispatchByRoute>>,
  vendorOffer: { total_price: number | null; payment_terms_days: number | null },
  skipVendorOfferUpdate: boolean,
  contractId: number | null,
  requisitionId: number | null,
): Promise<DealStatus> {
  const finalStatus = resolveDealStatus(handler.decision);
  const updates: Record<string, unknown> = {
    round: messageRound,
    status: finalStatus,
    lastMessageAt: new Date(),
  };

  if (!skipVendorOfferUpdate) {
    updates.latestVendorOffer = {
      total_price: vendorOffer.total_price,
      payment_terms:
        vendorOffer.payment_terms_days != null
          ? `Net ${vendorOffer.payment_terms_days}`
          : null,
      payment_terms_days: vendorOffer.payment_terms_days,
    };
  }

  if (handler.decision) {
    updates.latestDecisionAction = handler.decision.action;
    updates.latestUtility = handler.decision.utilityScore;
    if (handler.decision.counterOffer) {
      updates.latestOfferJson = handler.decision.counterOffer;
    }
  }

  await chatbotRepo.updateDeal(dealId, updates as Parameters<
    typeof chatbotRepo.updateDeal
  >[1]);

  await applyTerminalDealSideEffects(
    dealId,
    finalStatus,
    contractId,
    requisitionId,
  );

  return finalStatus;
}

/**
 * Process one inbound vendor (seller) message and produce one ACCORDO (PM) reply.
 */
export async function runAgentTurn(
  input: AgentTurnInput,
): Promise<AgentTurnResult> {
  const { dealId, entryContext } = input;
  const persist = input.persist !== false;

  const { deal } = await assertDealReadyForTurn(dealId, entryContext);
  const inbound = await resolveInboundMessage(input, dealId, deal.round);

  logger.info("[Pipeline] runAgentTurn", {
    dealId,
    entryChannel: entryContext.entryChannel,
    messageLength: inbound.message.length,
    persist,
    existingVendorMessageId: input.existingVendorMessageId ?? null,
    messageRound: inbound.messageRound,
  });

  const commercial = await resolveDealCommercialContext(deal);
  const classificationCtx = await buildClassificationContextFromDealAsync(deal);
  const dealContext = {
    ...classificationCtx,
    currencyCode: commercial.currencyCode,
  };
  const classification = await classifyMessage(inbound.message, dealContext);
  const handler = await dispatchByRoute({
    deal,
    message: inbound.message,
    classification,
    dealContext,
    commercial,
  });

  let vendorMessageId = inbound.vendorMessageId;
  let pmMessageId: string | null = null;
  let dealStatus: DealStatus = deal.status;

  if (persist) {
    if (!inbound.skipVendorPersist) {
      const vendorPayload = buildVendorMessagePayload(
        dealId,
        inbound.message,
        inbound.messageRound,
        entryContext,
        classification,
      );
      const savedVendor = await chatbotRepo.createMessage(vendorPayload);
      vendorMessageId = savedVendor.id;
    }

    pmMessageId = await persistPmResponse(
      dealId,
      inbound.messageRound,
      handler,
      classification,
    );

    const negotiationActions = new Set([
      "ACCEPT",
      "COUNTER",
      "ESCALATE",
      "WALK_AWAY",
      "ASK_CLARIFY",
    ]);
    if (negotiationActions.has(handler.decisionAction)) {
      recordPhrasing(dealId, handler.decisionAction, handler.pmContent);
    }

    dealStatus = await persistDealProgress(
      dealId,
      inbound.messageRound,
      handler,
      {
        total_price: classification.extractedPrice,
        payment_terms_days: classification.extractedDays,
      },
      inbound.skipVendorPersist,
      deal.contractId ?? null,
      deal.requisitionId ?? null,
    );
  }

  if (!handler.fromLlm) {
    throw new CustomError(
      "PM response must be LLM-generated; template fallback is disabled",
      503,
    );
  }

  const generationSource: AgentTurnResult["generationSource"] = "llm";

  logger.info("[Pipeline] runAgentTurn complete", {
    dealId,
    route: classification.route,
    handlerStage: handler.handlerStage,
    decisionAction: handler.decisionAction,
    fromLlm: handler.fromLlm,
    vendorMessageId,
    pmMessageId,
    dealStatus,
    entryChannel: entryContext.entryChannel,
  });

  return {
    success: true,
    dealId,
    round: inbound.messageRound,
    classification,
    route: classification.route,
    vendorMessageId,
    pmMessageId,
    pmContent: handler.pmContent,
    handlerStage: handler.handlerStage,
    entryChannel: entryContext.entryChannel,
    decisionAction: handler.decisionAction,
    fromLlm: handler.fromLlm,
    generationSource,
    dealStatus,
  };
}
