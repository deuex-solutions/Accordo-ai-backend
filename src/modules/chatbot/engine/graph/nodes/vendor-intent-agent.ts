import { NegotiationState, Offer } from "../state.js";
import { parseOfferRegex } from "../../parse-offer.js";
import { SupportedCurrency } from "../../../../../services/currency.service.js";
import {
  classifyVendorIntent,
  classifyRefusal,
  handleRefusal,
  handleSmallTalk,
  determineNextIntent,
  type RefusalType,
  type ConvoState,
} from "../../../convo/enhanced-convo-router.js";
import logger from "../../../../../config/logger.js";

/**
 * 1. VendorIntentAgent
 * 
 * Gatekeeper node. Parses incoming offer parameters and classifies vendor intent
 * to determine the correct routing path (direct fallback reply vs. full strategic negotiation).
 */
export const vendorIntentAgent = async (state: NegotiationState) => {
  logger.info("[Agent: VendorIntentAgent] Parsing offer and classifying vendor intent");

  const messages = state.messages;
  if (!messages || messages.length === 0) {
    return {};
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage._getType() !== "human") {
    return {};
  }

  const rawText = typeof lastMessage.content === "string" 
    ? lastMessage.content 
    : JSON.stringify(lastMessage.content);

  // 1. Parse offer parameters from the raw text
  const reqCurrency = state.config?.currency as SupportedCurrency | undefined;
  const legacyParsedOffer = parseOfferRegex(rawText, reqCurrency);

  const newOffer: Offer = {
    totalPrice: legacyParsedOffer.total_price || null,
    paymentTerms: legacyParsedOffer.payment_terms || null,
    paymentTermsDays: legacyParsedOffer.payment_terms_days || null,
    deliveryDate: legacyParsedOffer.delivery_date || null,
    deliveryDays: legacyParsedOffer.delivery_days || null,
    customParameters: legacyParsedOffer.meta ? { meta: legacyParsedOffer.meta } : undefined,
  };

  // 2. Classify Vendor Intent
  const convoState = state.metadata?.convoState as ConvoState || {
    phase: "GREET",
    turnCount: 0,
    refusalCount: 0,
    smallTalkCount: 0,
    context: {},
  };

  const conversationHistory = messages.slice(0, -1).map((msg) => ({
    role: msg._getType() === "human" ? "VENDOR" : "ACCORDO",
    content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
  }));

  const vendorIntent = await classifyVendorIntent(rawText, conversationHistory);

  let refusalType: RefusalType | undefined;
  let nextIntent: any;

  if (vendorIntent === "REFUSAL") {
    refusalType = await classifyRefusal(rawText);
    nextIntent = handleRefusal(convoState, refusalType);
  } else if (vendorIntent === "SMALL_TALK") {
    nextIntent = handleSmallTalk(convoState);
  } else {
    nextIntent = determineNextIntent(convoState, vendorIntent, rawText);
  }

  // Determine classification route
  const classificationRoute = (state.metadata?.mode === "CONVERSATION" &&
    (nextIntent !== "COUNTER" && nextIntent !== "ACCEPT" && nextIntent !== "WALK_AWAY" && nextIntent !== "ESCALATE"))
    ? "SIMPLE_FALLBACK_REPLY"
    : "FULL_NEGOTIATION_PIPELINE";

  let updatedConvoState = state.metadata?.convoState;
  const isConvo = state.metadata?.mode === "CONVERSATION";
  let nextDealStatus = state.metadata?.dealStatus || "NEGOTIATING";

  if (classificationRoute === "SIMPLE_FALLBACK_REPLY" && isConvo && state.metadata?.convoState) {
    const { updateConvoState } = await import("../../../convo/enhanced-convo-router.js");
    updatedConvoState = updateConvoState(
      state.metadata.convoState,
      vendorIntent,
      nextIntent
    );

    const { transition, actionToEvent } = await import("../../negotiation-state-machine.js");
    const event = actionToEvent(nextIntent);
    const transitionResult = transition(nextDealStatus as any, event);
    if (transitionResult.valid) {
      nextDealStatus = transitionResult.newState;
    }
  }

  logger.info("[Agent: VendorIntentAgent] Classification complete", {
    vendorIntent,
    refusalType,
    nextIntent,
    classificationRoute,
  });

  return {
    parsedOffer: newOffer.totalPrice !== null || newOffer.paymentTerms !== null || newOffer.deliveryDate !== null ? newOffer : state.parsedOffer,
    decision: {
      action: nextIntent,
      reasoning: `Vendor intent: ${vendorIntent}${refusalType ? ` (${refusalType})` : ""}`,
      confidence: 0.95,
      utilityScore: state.decision?.utilityScore ?? 0.5,
    },
    metadata: {
      ...state.metadata,
      lastParsedMessageId: lastMessage.id,
      vendorIntent,
      refusalType: refusalType || undefined,
      accordoIntent: nextIntent,
      messageType: vendorIntent,
      classificationRoute,
      classificationConfidence: 0.95,
      convoState: updatedConvoState,
      dealStatus: nextDealStatus,
    }
  };
};
