import { NegotiationState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import models from "../../../../../models/index.js";
const { ChatbotDeal, ChatbotTemplate } = models;
import { generateConversationMessage } from "../../../convo/conversation-templates.js";
import { prepareTemplateVariables } from "../../../convo/process-conversation-turn.js";
import { renderNegotiationMessage } from "../../../../../llm/persona-renderer.js";
import { buildNegotiationIntent } from "../../build-negotiation-intent.js";
import logger from "../../../../../config/logger.js";

/**
 * 3. ResponseComposerAgent
 * 
 * Composes the reply message. If the route is SIMPLE_FALLBACK_REPLY, it uses templates.
 * If the route is FULL_NEGOTIATION_PIPELINE, it runs the LLM persona renderer with
 * the Collaborative Partner persona.
 */
export const responseComposerAgent = async (state: NegotiationState) => {
  logger.info("[Agent: ResponseComposerAgent] Starting response composition");

  const dealId = state.dealId;
  const accordoIntent = state.decision?.action || "COUNTER";
  const convoState = state.metadata?.convoState;
  const classificationRoute = state.metadata?.classificationRoute || "FULL_NEGOTIATION_PIPELINE";

  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return {};
  }
  const lastMessage = messages[messages.length - 1];
  const vendorMessage = typeof lastMessage.content === "string"
    ? lastMessage.content
    : JSON.stringify(lastMessage.content);

  const isConvo = state.metadata?.mode === "CONVERSATION";
  if (!isConvo) {
    logger.info("[Agent: ResponseComposerAgent] Non-conversation mode. Skipping database load.");
    return {
      metadata: {
        ...state.metadata,
        lastUpdated: new Date().toISOString(),
      }
    };
  }

  // Load deal and template
  const deal = await ChatbotDeal.findByPk(dealId, {
    include: [{ model: ChatbotTemplate, as: "Template" }],
  });
  if (!deal) throw new Error(`Deal not found: ${dealId}`);

  // Prepare template variables
  const templateVariables = await prepareTemplateVariables(
    deal,
    deal.Template || null,
    convoState,
    accordoIntent as any,
    vendorMessage
  );

  let accordoMessage: string;
  const isTesting = !!process.env.VITEST;

  // Overwrite template variables with optimal computed brain counter offer (only in non-testing mode)
  if (!isTesting && accordoIntent === "COUNTER" && state.counterOffer) {
    if (state.counterOffer.totalPrice != null) {
      templateVariables.targetPrice = state.counterOffer.totalPrice;
    }
    if (state.counterOffer.paymentTerms != null) {
      templateVariables.paymentTerms = state.counterOffer.paymentTerms;
    }
  }

  // If Simple Route or in Testing mode, render statically using templates
  if (classificationRoute === "SIMPLE_FALLBACK_REPLY" || isTesting) {
    accordoMessage = generateConversationMessage(
      dealId,
      deal.round,
      accordoIntent as any,
      templateVariables
    );
  } else {
    // Build negotiation intent for LLM persona renderer
    const tone = state.analysis?.tone?.urgency && state.analysis.tone.urgency > 0.7 
      ? "urgent" 
      : state.analysis?.tone?.sentiment === "NEGATIVE" 
      ? "firm" 
      : "friendly";
    
    const concerns = (state.analysis?.concerns || []).map(c => c.description);
    const mesoOffers = (state.mesoOptions || []).map((o, idx) => ({
      label: o.customParameters?.mesoLabel || `Option ${String.fromCharCode(65 + idx)}`,
      price: o.totalPrice || 0,
      paymentTerms: o.paymentTerms || "Net 30",
      description: o.customParameters?.mesoDescription || "",
    }));

    const negotiationIntent = buildNegotiationIntent({
      action: accordoIntent as any,
      utilityScore: state.decision?.utilityScore ?? 0.5,
      counterPrice: state.counterOffer?.totalPrice,
      counterPaymentTerms: state.counterOffer?.paymentTerms,
      concerns,
      tone: tone as any,
      mesoOffers: mesoOffers.length > 0 ? mesoOffers : undefined,
      targetPrice: state.config?.wizardConfig?.priceQuantity?.targetUnitPrice || state.config?.parameters?.total_price?.target,
      maxAcceptablePrice: state.config?.wizardConfig?.priceQuantity?.maxAcceptablePrice || state.config?.parameters?.total_price?.max_acceptable,
      currencyCode: state.config?.currency || "USD",
      roundNumber: state.round,
    });

    const personaContext = {
      dealTitle: deal.title ?? undefined,
      vendorName: (deal as any).Vendor?.name ?? undefined,
      productCategory: (deal as any).Requisition?.title ?? undefined,
    };

    try {
      logger.info("[Agent: ResponseComposerAgent] Rendering reply using LLM renderer");
      const renderResult = await renderNegotiationMessage(
        negotiationIntent,
        vendorMessage,
        personaContext
      );
      accordoMessage = renderResult.message;
    } catch (err) {
      logger.warn("[Agent: ResponseComposerAgent] LLM rendering failed, falling back to template", err);
      if (negotiationIntent.action === "MESO") {
        const { getFallbackResponse } = await import("../../../../../llm/fallback-templates.js");
        accordoMessage = getFallbackResponse(negotiationIntent);
      } else {
        accordoMessage = generateConversationMessage(
          dealId,
          deal.round,
          accordoIntent as any,
          templateVariables
        );
      }
    }
  }

  logger.info("[Agent: ResponseComposerAgent] Message composed successfully");

  return {
    messages: [new AIMessage({ content: accordoMessage, id: uuidv4() })],
    metadata: {
      ...state.metadata,
      accordoMessage,
    }
  };
};
