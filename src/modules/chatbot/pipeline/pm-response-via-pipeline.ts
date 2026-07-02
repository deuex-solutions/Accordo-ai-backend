/**
 * P0.5 — Thin adapter from generatePMResponseAsyncService → runAgentTurn.
 */

import { CustomError } from "../../../utils/custom-error.js";
import chatbotRepo from "../chatbot.repo.js";
import type { ChatbotMessage } from "../../../models/chatbot-message.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import type { Decision, Explainability } from "../engine/types.js";
import { runAgentTurn } from "./run-agent-turn.js";

export interface PmResponsePipelineInput {
  dealId: string;
  vendorMessageId: string;
  userId: number;
}

export interface PmResponsePipelineResult {
  message: ChatbotMessage;
  decision: Decision;
  explainability: Explainability;
  deal: ChatbotDeal;
  generationSource: "llm" | "fallback";
  meso: null;
}

function buildDecisionFromTurn(
  turn: Awaited<ReturnType<typeof runAgentTurn>>,
): Decision {
  const action = (turn.decisionAction ?? "CHAT_RESPONSE") as Decision["action"];
  return {
    action,
    utilityScore: 0,
    counterOffer: null,
    reasons: [`Pipeline route: ${turn.route}`],
  };
}

export async function runPmResponseViaPipeline(
  input: PmResponsePipelineInput,
): Promise<PmResponsePipelineResult> {
  const entryContext =
    input.userId > 0
      ? {
          entryChannel: "internal_app" as const,
          dealOwnerUserId: input.userId,
        }
      : { entryChannel: "vendor_portal" as const };

  const turn = await runAgentTurn({
    dealId: input.dealId,
    existingVendorMessageId: input.vendorMessageId,
    entryContext,
  });

  if (!turn.pmMessageId) {
    throw new CustomError("Pipeline did not persist a PM response", 500);
  }

  const [pmMessage, deal] = await Promise.all([
    chatbotRepo.findMessageById(turn.pmMessageId),
    chatbotRepo.findDealById(input.dealId),
  ]);

  if (!pmMessage || !deal) {
    throw new CustomError("Failed to load PM response after pipeline turn", 500);
  }

  const decisionFromMessage = pmMessage.engineDecision as Decision | null;
  const decision =
    decisionFromMessage?.action != null
      ? {
          action: decisionFromMessage.action,
          utilityScore:
            pmMessage.utilityScore ?? decisionFromMessage.utilityScore ?? 0,
          counterOffer:
            (pmMessage.counterOffer as Decision["counterOffer"]) ??
            decisionFromMessage.counterOffer ??
            null,
          reasons: decisionFromMessage.reasons ?? [],
        }
      : buildDecisionFromTurn(turn);

  return {
    message: pmMessage,
    decision,
    explainability:
      (pmMessage.explainabilityJson as Explainability) ?? ({} as Explainability),
    deal,
    generationSource: turn.generationSource,
    meso: null,
  };
}
