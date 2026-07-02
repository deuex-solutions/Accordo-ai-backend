/**
 * P0.5 — Internal app HTTP adapter (authenticated negotiation room).
 *
 * The internal user submits seller-side content; the pipeline persists it as
 * role VENDOR and returns an ACCORDO (PM) reply.
 */

import chatbotRepo from "../chatbot.repo.js";
import type {
  ConversationState,
  ProcessConversationMessageResult,
} from "../convo/types.js";
import { runAgentTurn } from "./run-agent-turn.js";

export async function runVendorTurnFromInternalApp(input: {
  dealId: string;
  vendorMessage: string;
  dealOwnerUserId: number;
}): Promise<ProcessConversationMessageResult> {
  const turn = await runAgentTurn({
    dealId: input.dealId,
    message: input.vendorMessage,
    entryContext: {
      entryChannel: "internal_app",
      dealOwnerUserId: input.dealOwnerUserId,
    },
  });

  if (!turn.pmMessageId) {
    throw new Error("Pipeline did not persist a PM response");
  }

  const pmMessage = await chatbotRepo.findMessageById(turn.pmMessageId);
  if (!pmMessage) {
    throw new Error("PM message not found after pipeline turn");
  }

  const revealAvailable =
    turn.handlerStage === "P0.4_NEGOTIATION" &&
    pmMessage.explainabilityJson != null;

  const conversationState = {
    phase: "NEGOTIATING",
    lastVendorOffer: {
      total_price: turn.classification.extractedPrice,
      payment_terms_days: turn.classification.extractedDays,
    },
    pipelineRoute: turn.route,
    pipelineVersion: "P0.5",
  } as unknown as ConversationState;

  return {
    success: true,
    message: "Message processed successfully",
    data: {
      accordoMessage: {
        id: pmMessage.id,
        role: "ACCORDO",
        content: pmMessage.content,
        createdAt: pmMessage.createdAt,
      },
      conversationState,
      revealAvailable,
      dealStatus: turn.dealStatus,
      meso: null,
    },
  };
}
