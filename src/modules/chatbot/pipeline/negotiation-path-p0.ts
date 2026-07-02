/**
 * P0.4 — Negotiation path: decideNextMove + persona LLM (counter-only, no MESO payload).
 *
 * @source vendor_message_pipeline.md Step 4d (counter mode)
 * @source convo/conversation-service.ts decide + intent + render (trimmed)
 */

import logger from "../../../config/logger.js";
import { formatPaymentTerms, extractPaymentDays } from "../engine/types.js";
import {
  decideNextMove,
  capTermsToVendorMax,
  extractVendorMaxTermsDays,
  calculateDynamicCounter,
} from "../engine/decide.js";
import { computeExplainability, totalUtility } from "../engine/utility.js";
import type { NegotiationConfig } from "../engine/utility.js";
import type { ChatbotDeal } from "../../../models/chatbot-deal.js";
import type { ChatbotMessage } from "../../../models/chatbot-message.js";
import type { Decision, Offer } from "../engine/types.js";
import {
  detectVendorTone,
  detectVendorStyle,
  extractVendorConcerns,
} from "../engine/tone-detector.js";
import {
  buildNegotiationIntent,
  formatHumanDate,
  type PersuasionBrief,
  type PersuasionAngle,
} from "../../../negotiation/intent/build-negotiation-intent.js";
import type { PersonaContext } from "../../../llm/persona-renderer.js";
import { buildConversationContextSummary } from "../../../llm/conversation-context-summary.js";
import { renderValidatedNegotiationMessage } from "../../../llm/render-negotiation-with-retry.js";
import {
  getPhrasings,
  safeRewriteOpener,
} from "../../../llm/phrasing-history.js";
import { ensureFirstPmGreeting, hasPriorPmWelcomeMessage } from "../../../llm/first-pm-greeting.js";
import chatbotRepo from "../chatbot.repo.js";
import {
  loadNegotiationConfigFromDeal,
  resolvePriceBoundariesForDeal,
  applyRfqBoundsToNegotiationConfig,
} from "./load-negotiation-config-from-deal.js";
import { resolvePmNegotiationRoundNumber } from "./negotiation-round.js";
import { applyConvergenceAcceptPolicies, applyFinalAlignmentAccept } from "./accept-convergence-policy.js";
import type { DealCommercialContext } from "./deal-commercial-context.js";
import type { ClassificationResult } from "./types.js";

export interface NegotiationPathInput {
  deal: ChatbotDeal;
  vendorMessage: string;
  classification: ClassificationResult;
  commercial: DealCommercialContext;
}

export interface NegotiationPathResult {
  content: string;
  fromLlm: boolean;
  decision: Decision;
  explainability: ReturnType<typeof computeExplainability> | null;
}

function buildVendorOffer(
  classification: ClassificationResult,
  deal: ChatbotDeal,
  maxTotalPrice?: number,
): Offer {
  const termsRequest = classification.termsRequest;
  const days = termsRequest?.requestedDays ?? classification.extractedDays;

  let totalPrice = classification.extractedPrice;
  if (
    classification.type === "VENDOR_TERMS_INQUIRY" &&
    totalPrice == null
  ) {
    const lastVendor = deal.latestVendorOffer as { total_price?: number } | null;
    totalPrice = lastVendor?.total_price ?? maxTotalPrice ?? null;
  }

  return {
    total_price: totalPrice,
    payment_terms: days != null ? formatPaymentTerms(days) : null,
    payment_terms_days: days,
  };
}

function honorVendorStatedTermsOnCounter(
  decision: Decision,
  classification: ClassificationResult,
  vendorOffer: Offer,
): Decision {
  if (
    decision.action !== "COUNTER" ||
    !decision.counterOffer
  ) {
    return decision;
  }

  const statedDays =
    classification.extractedDays ?? vendorOffer.payment_terms_days ?? null;
  if (statedDays == null) {
    return decision;
  }

  const isCompleteOffer =
    classification.extractedPrice != null && classification.extractedDays != null;
  const mustHonor =
    classification.isMeetingProposal === true || isCompleteOffer;

  const counterDays = extractPaymentDays(decision.counterOffer.payment_terms);
  if (mustHonor || (counterDays != null && counterDays > statedDays)) {
    const terms = formatPaymentTerms(statedDays);
    return {
      ...decision,
      counterOffer: {
        ...decision.counterOffer,
        payment_terms: terms,
        payment_terms_days: statedDays,
      },
      reasons: [
        ...decision.reasons,
        `Honoring vendor-stated terms: ${terms}`,
      ],
    };
  }

  return decision;
}

/** Max single-round drop below vendor's meeting price (persuasion, not rejection). */
const MEETING_PROPOSAL_MAX_DROP_PCT = 0.03;

function applyMeetingProposalCounterPolicy(
  decision: Decision,
  classification: ClassificationResult,
  vendorOffer: Offer,
  previousPmOffer: Offer | null,
  maxTotalPrice: number | undefined,
): Decision {
  if (
    !classification.isMeetingProposal ||
    decision.action !== "COUNTER" ||
    !decision.counterOffer ||
    vendorOffer.total_price == null
  ) {
    return decision;
  }

  const vendorPrice = vendorOffer.total_price;
  const prevPmPrice = previousPmOffer?.total_price ?? null;
  let counterPrice = decision.counterOffer.total_price ?? vendorPrice;

  const minFromVendor = vendorPrice * (1 - MEETING_PROPOSAL_MAX_DROP_PCT);
  counterPrice = Math.max(counterPrice, minFromVendor);

  if (prevPmPrice != null && vendorPrice > prevPmPrice) {
    const midpoint = Math.round(((prevPmPrice + vendorPrice) / 2) * 100) / 100;
    counterPrice = Math.max(counterPrice, midpoint);
  }

  counterPrice = Math.min(counterPrice, vendorPrice - 0.01);

  if (prevPmPrice != null && counterPrice < prevPmPrice) {
    counterPrice = Math.min(prevPmPrice, vendorPrice - 0.01);
  }

  if (maxTotalPrice != null) {
    counterPrice = Math.min(counterPrice, maxTotalPrice);
  }

  counterPrice = Math.round(counterPrice * 100) / 100;

  const statedDays =
    classification.extractedDays ?? vendorOffer.payment_terms_days ?? null;
  const terms =
    statedDays != null
      ? formatPaymentTerms(statedDays)
      : decision.counterOffer.payment_terms;

  return {
    ...decision,
    counterOffer: {
      ...decision.counterOffer,
      total_price: counterPrice,
      payment_terms: terms,
      payment_terms_days: statedDays ?? decision.counterOffer.payment_terms_days,
    },
    reasons: [
      ...decision.reasons,
      `Meeting-proposal counter: capped within ${(MEETING_PROPOSAL_MAX_DROP_PCT * 100).toFixed(0)}% of vendor ${vendorPrice}, converging from prior PM`,
    ],
  };
}

const PERSUASION_ANGLES: PersuasionAngle[] = [
  "partnership",
  "philosophy",
  "economics",
];

function buildPersuasionBrief(
  roundNumber: number,
  vendorOffer: Offer,
  priorMessages: ChatbotMessage[],
  previousPmOffer: Offer | null,
  counterPrice: number | null | undefined,
): PersuasionBrief | undefined {
  const angle = PERSUASION_ANGLES[(roundNumber - 1) % PERSUASION_ANGLES.length];

  const lastVendor = [...priorMessages]
    .reverse()
    .find((m) => m.role === "VENDOR");
  const prevVendorPrice = (lastVendor?.extractedOffer as Offer | null)
    ?.total_price;
  const pmPrice = previousPmOffer?.total_price ?? null;

  let vendorMovedTowardUs = false;
  if (
    vendorOffer.total_price != null &&
    prevVendorPrice != null &&
    pmPrice != null &&
    prevVendorPrice > pmPrice &&
    vendorOffer.total_price < prevVendorPrice
  ) {
    vendorMovedTowardUs = true;
  }
  if (
    vendorOffer.total_price != null &&
    pmPrice != null &&
    vendorOffer.total_price <= pmPrice
  ) {
    vendorMovedTowardUs = true;
  }

  let gapNarrative: PersuasionBrief["gapNarrative"];
  if (
    vendorOffer.total_price != null &&
    counterPrice != null &&
    counterPrice > 0
  ) {
    const gapPct =
      (vendorOffer.total_price - counterPrice) / vendorOffer.total_price;
    if (gapPct >= 0.08) gapNarrative = "significant";
    else if (gapPct >= 0.03) gapNarrative = "moderate";
    else gapNarrative = "small";
  }

  return { angle, vendorMovedTowardUs, gapNarrative };
}

function honorRequestedTermsOnCounter(
  decision: Decision,
  classification: ClassificationResult,
): Decision {
  const termsRequest = classification.termsRequest;
  if (
    !termsRequest ||
    decision.action !== "COUNTER" ||
    !decision.counterOffer
  ) {
    return decision;
  }

  const terms = formatPaymentTerms(termsRequest.requestedDays);
  return {
    ...decision,
    counterOffer: {
      ...decision.counterOffer,
      payment_terms: terms,
      payment_terms_days: termsRequest.requestedDays,
    },
    reasons: [
      ...decision.reasons,
      `Honoring vendor-requested terms: ${termsRequest.matchedText}`,
    ],
  };
}

function mesoToCounterFallback(
  decision: Decision,
  config: NegotiationConfig,
  vendorOffer: Offer,
  roundNumber: number,
  previousPmOffer: Offer | null,
  negotiationState: Parameters<typeof decideNextMove>[3],
): Decision {
  const vendorMatch = decision.reasons.some((r) =>
    r.includes("Counter equals vendor offer"),
  );
  if (vendorMatch && vendorOffer.total_price != null) {
    return {
      action: "ACCEPT",
      utilityScore:
        decision.utilityScore > 0
          ? decision.utilityScore
          : totalUtility(config, vendorOffer),
      counterOffer: null,
      reasons: [
        ...decision.reasons,
        "P0: Vendor-aligned offer — accept (MESO suppressed)",
      ],
    };
  }

  const dynamic = calculateDynamicCounter(
    config,
    vendorOffer,
    roundNumber,
    negotiationState,
    previousPmOffer,
  );
  const counterPrice = dynamic.price;

  logger.warn("[Pipeline] MESO suppressed in P0 — using dynamic counter fallback", {
    counterPrice,
    roundNumber,
  });

  return {
    action: "COUNTER",
    utilityScore: decision.utilityScore,
    counterOffer: {
      total_price: counterPrice,
      payment_terms:
        vendorOffer.payment_terms ?? dynamic.terms ?? "Net 30",
      payment_terms_days: vendorOffer.payment_terms_days ?? 30,
    },
    reasons: [...decision.reasons, "P0: MESO suppressed — counter-only LLM"],
  };
}

function applyCounterGuards(
  decision: Decision,
  vendorOffer: Offer,
  vendorMessage: string,
  deal: ChatbotDeal,
): Decision {
  let next = decision;

  if (next.counterOffer?.payment_terms) {
    const vendorMaxDays = extractVendorMaxTermsDays(vendorMessage);
    if (vendorMaxDays != null) {
      const capped = capTermsToVendorMax(
        next.counterOffer.payment_terms,
        vendorMaxDays,
      );
      if (capped !== next.counterOffer.payment_terms) {
        next = {
          ...next,
          counterOffer: { ...next.counterOffer, payment_terms: capped },
        };
      }
    }
  }

  if (
    next.counterOffer?.total_price != null &&
    vendorOffer.total_price != null &&
    next.counterOffer.total_price > vendorOffer.total_price
  ) {
    next = {
      ...next,
      counterOffer: {
        ...next.counterOffer,
        total_price: vendorOffer.total_price,
      },
    };
  }

  const prevPmPrice =
    (deal.latestOfferJson as { total_price?: number } | null)?.total_price ??
    null;
  if (
    next.action === "COUNTER" &&
    next.counterOffer?.total_price != null &&
    vendorOffer.total_price != null &&
    prevPmPrice != null &&
    next.counterOffer.total_price < prevPmPrice
  ) {
    const floored = Math.min(prevPmPrice, vendorOffer.total_price - 0.01);
    next = {
      ...next,
      counterOffer: {
        ...next.counterOffer,
        total_price: Math.round(floored * 100) / 100,
      },
    };
  }

  return next;
}

function toContextMessages(messages: ChatbotMessage[]) {
  return messages.map((msg) => ({
    role: msg.role,
    content: msg.content,
    extractedOffer: msg.extractedOffer,
    counterOffer: msg.counterOffer,
    decisionAction: msg.decisionAction,
  }));
}

function resolvePreviousPmOffer(
  deal: ChatbotDeal,
  priorMessages: ChatbotMessage[],
): Offer | null {
  const lastPm = [...priorMessages]
    .reverse()
    .find((m) => m.role === "ACCORDO" && m.counterOffer);
  const fromHistory = (lastPm?.counterOffer as Offer) ?? null;
  if (fromHistory?.total_price != null) {
    return fromHistory;
  }

  const fromDeal = deal.latestOfferJson as Offer | null;
  return fromDeal?.total_price != null ? fromDeal : null;
}

function computeVendorMovement(
  vendorOffer: Offer,
  priorMessages: ChatbotMessage[],
): "significant" | "moderate" | "minor" | undefined {
  const lastVendor = [...priorMessages]
    .reverse()
    .find((m) => m.role === "VENDOR");
  const previousPrice = (lastVendor?.extractedOffer as Offer | null)
    ?.total_price;
  if (
    previousPrice == null ||
    previousPrice <= 0 ||
    vendorOffer.total_price == null ||
    vendorOffer.total_price >= previousPrice
  ) {
    return undefined;
  }
  const dropPercent = (previousPrice - vendorOffer.total_price) / previousPrice;
  if (dropPercent >= 0.05) return "significant";
  if (dropPercent >= 0.02) return "moderate";
  if (dropPercent > 0) return "minor";
  return undefined;
}

function priorVendorToneMessages(
  priorMessages: ChatbotMessage[],
  vendorMessage: string,
) {
  const vendorRows = priorMessages
    .filter((m) => m.role === "VENDOR")
    .map((m) => ({ role: "VENDOR" as const, content: m.content }));

  const last = vendorRows[vendorRows.length - 1];
  if (!last || last.content.trim() !== vendorMessage.trim()) {
    vendorRows.push({ role: "VENDOR", content: vendorMessage });
  }

  return vendorRows;
}

/**
 * Run negotiation path: engine decision → intent (no MESO) → LLM → validate.
 */
export async function runNegotiationPathP0(
  input: NegotiationPathInput,
): Promise<NegotiationPathResult> {
  const { deal, vendorMessage, classification, commercial } = input;

  const [rawConfig, priorMessages] = await Promise.all([
    loadNegotiationConfigFromDeal(deal),
    chatbotRepo.findMessagesByDealId(deal.id),
  ]);

  const priceBoundaries = await resolvePriceBoundariesForDeal(deal);
  const { minTotalPrice, maxTotalPrice } = priceBoundaries;
  const config = applyRfqBoundsToNegotiationConfig(
    rawConfig,
    minTotalPrice,
    maxTotalPrice,
  );
  const resolvedCurrency = commercial.currencyCode;
  const currencySymbol = commercial.currencySymbol;
  const vendorOffer = buildVendorOffer(classification, deal, maxTotalPrice);
  const roundNumber = resolvePmNegotiationRoundNumber(
    priorMessages,
    deal.round,
  );
  const previousPmOffer = resolvePreviousPmOffer(deal, priorMessages);
  const vendorMovement = computeVendorMovement(vendorOffer, priorMessages);

  const negotiationState =
    (
      deal as ChatbotDeal & {
        negotiationStateJson?: Parameters<typeof decideNextMove>[3];
      }
    ).negotiationStateJson ?? null;

  let decision = decideNextMove(
    config,
    vendorOffer,
    roundNumber,
    negotiationState,
    previousPmOffer,
    null,
    null,
  );

  if (decision.action === "MESO") {
    decision = mesoToCounterFallback(
      decision,
      config,
      vendorOffer,
      roundNumber,
      previousPmOffer,
      negotiationState,
    );
  }

  decision = applyConvergenceAcceptPolicies({
    decision,
    vendorOffer,
    config,
    classification,
    minTotalPrice,
    maxTotalPrice,
    previousPmOffer,
    priorMessages,
  });

  decision = applyCounterGuards(decision, vendorOffer, vendorMessage, deal);
  decision = honorRequestedTermsOnCounter(decision, classification);
  decision = honorVendorStatedTermsOnCounter(
    decision,
    classification,
    vendorOffer,
  );
  decision = applyMeetingProposalCounterPolicy(
    decision,
    classification,
    vendorOffer,
    previousPmOffer,
    maxTotalPrice,
  );

  decision = applyFinalAlignmentAccept({
    decision,
    vendorOffer,
    vendorMessage,
    config,
    classification,
    previousPmOffer,
    priorMessages,
  });

  const vendorAtOrBelowMax =
    vendorOffer.total_price != null &&
    maxTotalPrice != null &&
    vendorOffer.total_price <= maxTotalPrice;

  const persuasionBrief =
    decision.action === "COUNTER"
      ? buildPersuasionBrief(
          roundNumber,
          vendorOffer,
          priorMessages,
          previousPmOffer,
          decision.counterOffer?.total_price,
        )
      : undefined;

  const explainability = computeExplainability(config, vendorOffer, decision);

  const vendorToneMessages = priorVendorToneMessages(
    priorMessages,
    vendorMessage,
  );
  const toneResult = detectVendorTone(vendorToneMessages);
  const priorVendorOnly = vendorToneMessages.slice(0, -1);
  const vendorStyle = detectVendorStyle(vendorMessage, priorVendorOnly);
  const vendorConcerns = extractVendorConcerns(vendorMessage);
  const phrasingHistory = getPhrasings(deal.id);
  const openQuestions = classification.termsRequest
    ? [
        {
          question: `Vendor asked for our best price at ${classification.termsRequest.matchedText}`,
          askedAtRound: roundNumber,
        },
      ]
    : [];

  const contextSummary = buildConversationContextSummary(
    toContextMessages(priorMessages),
    currencySymbol,
    { currentVendorMessage: vendorMessage },
  );

  const priorPmWelcomeSent = hasPriorPmWelcomeMessage(priorMessages);

  const negotiationIntent = buildNegotiationIntent({
    action: decision.action as
      | "ACCEPT"
      | "COUNTER"
      | "ESCALATE"
      | "WALK_AWAY"
      | "ASK_CLARIFY",
    utilityScore: decision.utilityScore,
    counterPrice: decision.counterOffer?.total_price ?? null,
    counterPaymentTerms: decision.counterOffer?.payment_terms ?? null,
    counterDelivery: decision.counterOffer?.delivery_date
      ? `by ${formatHumanDate(decision.counterOffer.delivery_date)}`
      : decision.counterOffer?.delivery_days
        ? `within ${decision.counterOffer.delivery_days} days`
        : null,
    concerns: vendorConcerns,
    tone: toneResult.primaryTone,
    minTotalPrice,
    maxTotalPrice,
    currencyCode: resolvedCurrency,
    vendorStyle,
    roundNumber,
    priorPmWelcomeSent,
    phrasingHistory,
    openQuestions,
    vendorMovement,
    persuasionBrief,
    compactAccept: decision.action === "ACCEPT" && vendorAtOrBelowMax,
  });

  const personaContext: PersonaContext = {
    dealTitle: deal.title ?? undefined,
    vendorName: (deal as ChatbotDeal & { Vendor?: { name?: string } }).Vendor
      ?.name,
    arcSummary: contextSummary || undefined,
  };

  const rendered = await renderValidatedNegotiationMessage(
    negotiationIntent,
    vendorMessage,
    personaContext,
  );

  let content = rendered.content;

  content = safeRewriteOpener(
    deal.id,
    negotiationIntent.action,
    content,
    negotiationIntent.allowedPrice != null
      ? {
          requiredPrice: negotiationIntent.allowedPrice,
          currencySymbol: negotiationIntent.currencySymbol,
        }
      : undefined,
  );

  content = ensureFirstPmGreeting(
    content,
    negotiationIntent.roundNumber,
    new Date(),
    priorPmWelcomeSent,
  );

  return { content, fromLlm: true, decision, explainability };
}
