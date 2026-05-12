/**
 * Human-Like Response Generator Module
 *
 * Generates context-aware, human-like PM responses that:
 * - Always include delivery terms
 * - Adapt to vendor's tone
 * - Acknowledge vendor concerns
 * - Provide high variation (10+ styles per action)
 * - Use dynamic length based on complexity
 * - Hide internal utility calculations
 *
 * Uses LLM with fallback to enhanced templates.
 *
 * @module responseGenerator
 */

import logger from "../../../config/logger.js";
import { chatCompletion } from "../../../services/llm.service.js";
import {
  detectVendorTone,
  getToneDescription,
  type VendorTone,
  type ToneMessage,
} from "./tone-detector.js";
import {
  extractVendorConcerns,
  getAcknowledgmentSentence,
  type VendorConcern,
  type ConcernMessage,
} from "./concern-extractor.js";
import {
  formatDeliveryShort,
  type DeliveryConfig,
} from "./delivery-utility.js";
import type {
  Offer,
  Decision,
  AccumulatedOffer,
} from "./types.js";
import type { NegotiationConfig } from "./utility.js";
import { getCurrencySymbol } from "../../../negotiation/intent/build-negotiation-intent.js";
import {
  getProvidedComponents,
  getMissingComponents,
} from "./offer-accumulator.js";
import {
  detectMilestone,
  getPersonalityEnrichment,
  applyPersonality,
  type MilestoneDetectionInput,
} from "./personality-layer.js";
import {
  getToneAwareTemplate,
  type TemplateContext,
} from "./tone-templates.js";
import {
  generatePromptAddenda,
  type AddendaContext,
} from "./prompt-addenda.js";

/**
 * Input for response generation
 */
export interface ResponseGeneratorInput {
  decision: Decision;
  config: NegotiationConfig;
  conversationHistory: Array<{ role: string; content: string }>;
  vendorOffer: Offer;
  counterOffer: Offer | null;
  deliveryConfig?: DeliveryConfig;
  dealTitle?: string;
  round?: number;
  maxRounds?: number;
  /** Current partial extraction from vendor's latest message (for ASK_CLARIFY) */
  currentExtraction?: Offer;
  /** Accumulated offer state (for ASK_CLARIFY acknowledgment) */
  accumulatedOffer?: AccumulatedOffer;
  /** Whether a stall was detected in the negotiation */
  stallDetected?: boolean;
  /** Number of consecutive counter-offers */
  consecutiveCounters?: number;
  /** Whether the vendor made a concession from their previous offer */
  vendorConceded?: boolean;
}

/**
 * Result from response generation
 */
export interface ResponseGeneratorResult {
  response: string;
  source: "llm" | "fallback";
  tone: VendorTone;
  concerns: VendorConcern[];
  generationTimeMs: number;
}

/**
 * Format delivery from offer for display
 */
function formatDeliveryFromOffer(offer: Offer | null | undefined): string {
  if (!offer) return "as agreed";

  // Check for delivery_date or delivery_days in the offer
  const extendedOffer = offer as any;

  if (extendedOffer.delivery_date) {
    const date = new Date(extendedOffer.delivery_date);
    return formatDeliveryShort(date);
  }

  if (extendedOffer.delivery_days) {
    return `within ${extendedOffer.delivery_days} days`;
  }

  return "as agreed";
}

/**
 * Format delivery config for display
 */
function formatDeliveryFromConfig(config?: DeliveryConfig): string {
  if (!config) return "per agreement";

  if (config.requiredDate) {
    const date =
      typeof config.requiredDate === "string"
        ? new Date(config.requiredDate)
        : config.requiredDate;
    return `by ${formatDeliveryShort(date)}`;
  }

  return "per agreement";
}

/**
 * Build natural ASK_CLARIFY LLM prompt that acknowledges what was provided
 * and asks naturally for what's missing
 */
function buildAskClarifyPrompt(
  input: ResponseGeneratorInput,
  tone: VendorTone,
): string {
  const { vendorOffer, currentExtraction, accumulatedOffer } = input;
  const toneDescription = getToneDescription(tone);

  // Determine what was provided in current message vs what's missing
  const currentProvided = currentExtraction
    ? getProvidedComponents(currentExtraction)
    : [];
  const missing = getMissingComponents(accumulatedOffer || vendorOffer);

  // Build context about what we have and what we need
  const providedText =
    currentProvided.length > 0
      ? `Vendor just provided: ${currentProvided.join(", ")}`
      : "Vendor message did not include specific offer details";

  const missingText =
    missing.length > 0
      ? `Still need: ${missing.join(" and ")}`
      : "All required information received";

  // Format accumulated state
  const clarifyCs = getCurrencySymbol(input.config?.currency);
  const accumulatedText = accumulatedOffer
    ? `Current accumulated offer: ${accumulatedOffer.total_price ? `${clarifyCs}${accumulatedOffer.total_price.toLocaleString()}` : "no price"}, ${accumulatedOffer.payment_terms || "no terms"}`
    : "";

  return `
You are Accordo, a Procurement Manager. Generate a natural ${toneDescription} response that acknowledges what the vendor provided and asks for what's missing.

CURRENT MESSAGE CONTEXT:
${providedText}
${accumulatedText}
${missingText}

TONE: ${tone} (conversational, not robotic)

REQUIREMENTS:
1. FIRST acknowledge what the vendor just provided (if anything)
   - For price: "Got it - $37K" or "Thanks for the pricing at $37,000" or "$37K - noted"
   - For terms: "Net 60 works" or "Thanks for confirming Net 60"
2. THEN naturally ask for the missing piece(s)
   - For missing price: "What about the total price?" or "And the pricing?"
   - For missing terms: "What about payment terms?" or "How about terms - Net 30, 60, or something else?"
3. Keep it SHORT - 1-2 sentences max
4. Sound natural and human, like a real conversation
5. DO NOT say "I need clarification" or "Could you please provide" - too formal
6. DO NOT mention: utility, algorithm, system, analysis

EXAMPLE RESPONSES:
- "Got it - $37K. What about payment terms?"
- "Net 60 works for us. And the total price?"
- "Thanks for that. Can you confirm both the price and payment terms?"
- "$37,000 noted. How about terms - Net 30, 60?"

Generate response:`;
}

/**
 * Build LLM prompt for response generation
 */
function buildPrompt(
  input: ResponseGeneratorInput,
  tone: VendorTone,
  concerns: VendorConcern[],
): string {
  const {
    decision,
    config,
    vendorOffer,
    counterOffer,
    deliveryConfig,
    round,
    maxRounds,
  } = input;
  const { action } = decision;
  const cs = getCurrencySymbol(config?.currency);

  const toneDescription = getToneDescription(tone);
  const concernsText =
    concerns.length > 0
      ? `Vendor concerns to acknowledge: ${concerns.map((c) => c.text).join(", ")}`
      : "No specific concerns mentioned";

  const vendorDelivery = formatDeliveryFromOffer(vendorOffer);
  const counterDelivery = counterOffer
    ? formatDeliveryFromOffer(counterOffer)
    : formatDeliveryFromConfig(deliveryConfig);

  // Build base prompt based on action
  const actionPrompts: Record<string, string> = {
    ACCEPT: `
You are Accordo, a Procurement Manager. Generate a ${toneDescription} acceptance response.

VENDOR'S OFFER:
- Total Price: ${cs}${vendorOffer.total_price?.toFixed(2) || "not specified"} (for entire order)
- Payment: ${vendorOffer.payment_terms || "not specified"}
- Delivery: ${vendorDelivery}

${concernsText}

TONE: ${tone} (mirror the vendor's communication style)

REQUIREMENTS:
1. Confirm ALL THREE terms: total price, payment, delivery
2. Express genuine appreciation
3. ${concerns.length > 0 ? "Briefly acknowledge their efforts/challenges positively" : "Thank them for the negotiation"}
4. Keep to 2-3 sentences
5. DO NOT mention: utility, algorithm, score, threshold, calculation, analysis
6. Sound human and warm, not robotic
7. IMPORTANT: Always refer to the price as "total" or "total price" - NOT per unit
8. IMPORTANT: Use the ${cs} currency symbol for all prices — do NOT use any other currency symbol

Generate response:`,

    COUNTER: `
You are Accordo, a Procurement Manager. Generate a ${toneDescription} counter-offer response.

VENDOR'S OFFER:
- Total Price: ${cs}${vendorOffer.total_price?.toFixed(2) || "not specified"} (for entire order)
- Payment: ${vendorOffer.payment_terms || "not specified"}
- Delivery: ${vendorDelivery}

OUR COUNTER:
- Total Price: ${cs}${counterOffer?.total_price?.toFixed(2) || vendorOffer.total_price?.toFixed(2) || "to be discussed"} (for entire order)
- Payment: ${counterOffer?.payment_terms || vendorOffer.payment_terms || "flexible"}
- Delivery: ${counterDelivery}

${concernsText}

BUSINESS REASONING (pick one naturally, don't reveal numbers):
- "This aligns better with our budget constraints"
- "We need to balance quality with cost-effectiveness"
- "Extended payment terms help our cash flow planning"
- "Our project timeline requires this delivery schedule"

TONE: ${tone} (match their formality level)
ROUND: ${round || 1} of ${maxRounds || 6}

REQUIREMENTS:
1. ${concerns.length > 0 ? `First acknowledge briefly: something about ${concerns[0].text}` : "Acknowledge their offer respectfully"}
2. Present ALL THREE counter terms clearly
3. Provide brief business reasoning (not calculations)
4. Keep door open for negotiation
5. Length: 2-4 sentences
6. DO NOT mention: utility, algorithm, score, threshold, calculation, percentage, analysis
7. Sound collaborative, not demanding
8. IMPORTANT: Always refer to the price as "total" or "total price" - NOT per unit

Generate response:`,

    WALK_AWAY: `
You are Accordo, a Procurement Manager. Generate a professional, regretful response declining to continue.

FINAL SITUATION:
- Vendor's offer: ${cs}${vendorOffer.total_price?.toFixed(2) || "N/A"}, ${vendorOffer.payment_terms || "N/A"}, ${vendorDelivery}
- Round: ${round || "final"} of ${maxRounds || 6}
- Gap: Too far from our requirements

TONE: Professional regret (regardless of vendor's tone)

REQUIREMENTS:
1. Express genuine appreciation for their time and effort
2. Be clear but kind that we cannot proceed
3. Brief reason: "budget constraints" or "timeline requirements" (not specific numbers)
4. Leave door open for future opportunities
5. 2-3 sentences maximum
6. DO NOT blame or criticize their offer
7. DO NOT mention: utility, algorithm, score, threshold, calculation, analysis

Generate response:`,

    ESCALATE: `
You are Accordo, a Procurement Manager. The negotiation needs human review.

SITUATION: Complex situation requiring human decision-maker involvement

TONE: Reassuring and professional

REQUIREMENTS:
1. Reassure vendor their offer is being seriously considered
2. Explain a colleague will review (don't say "escalate" or "algorithm")
3. Maintain positive tone about potential partnership
4. 2-3 sentences

Generate response:`,

    ASK_CLARIFY: buildAskClarifyPrompt(input, tone),
  };

  return actionPrompts[action] || actionPrompts.COUNTER;
}

/**
 * Validate LLM response quality
 */
function validateResponse(response: string, action: string): boolean {
  if (!response || response.length < 20) return false;
  if (response.length > 500) return false;

  // Check for forbidden phrases
  const forbidden = [
    /utility\s*score/i,
    /algorithm/i,
    /threshold/i,
    /calculation/i,
    /\d+%\s*utility/i,
    /based on our analysis/i,
    /our system/i,
    /automated/i,
  ];

  for (const pattern of forbidden) {
    if (pattern.test(response)) {
      logger.warn(
        "[ResponseGenerator] LLM response contains forbidden phrase",
        { pattern: pattern.source },
      );
      return false;
    }
  }

  // For ACCEPT/COUNTER, check for delivery mention
  if (action === "ACCEPT" || action === "COUNTER") {
    const hasDelivery =
      /deliver|by\s+\w+\s+\d+|within\s+\d+|ship|timeline|schedule/i.test(
        response,
      );
    if (!hasDelivery) {
      logger.warn("[ResponseGenerator] LLM response missing delivery terms");
      // Don't fail, we'll add delivery in post-processing if needed
    }
  }

  return true;
}

/**
 * Generate LLM response with timeout
 */
async function generateLLMResponse(
  prompt: string,
  timeoutMs: number = 4000,
): Promise<string | null> {
  const startTime = Date.now();

  try {
    const response = await Promise.race([
      chatCompletion([
        {
          role: "system",
          content:
            "You are Accordo, a professional Procurement Manager. Generate natural, human-like negotiation responses. Never mention algorithms, scores, or calculations.",
        },
        { role: "user", content: prompt },
      ]),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("LLM timeout")), timeoutMs),
      ),
    ]);

    const elapsed = Date.now() - startTime;
    logger.info("[ResponseGenerator] LLM response generated", {
      elapsedMs: elapsed,
    });

    return response || null;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    logger.warn("[ResponseGenerator] LLM generation failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      elapsedMs: elapsed,
    });
    return null;
  }
}

/**
 * Build template context from response generator input
 */
function buildTemplateContext(
  input: ResponseGeneratorInput,
  concerns: VendorConcern[],
): TemplateContext {
  const { vendorOffer, counterOffer, deliveryConfig, config } = input;
  const cs = getCurrencySymbol(config?.currency);
  const vendorDelivery =
    formatDeliveryFromOffer(vendorOffer) ||
    formatDeliveryFromConfig(deliveryConfig);
  const counterDelivery = counterOffer
    ? formatDeliveryFromOffer(counterOffer)
    : formatDeliveryFromConfig(deliveryConfig);
  const concernAck =
    concerns.length > 0 ? getAcknowledgmentSentence(concerns) : "";

  return {
    vendorPrice: `${cs}${vendorOffer.total_price?.toFixed(2) || "not specified"}`,
    vendorTerms: vendorOffer.payment_terms || "not specified",
    vendorDelivery,
    counterPrice: `${cs}${counterOffer?.total_price?.toFixed(2) || vendorOffer.total_price?.toFixed(2) || "to be discussed"}`,
    counterTerms:
      counterOffer?.payment_terms || vendorOffer.payment_terms || "flexible",
    counterDelivery,
    concernAck: concernAck ? concernAck + " " : "",
    round: input.round || 1,
    maxRounds: input.maxRounds || 6,
  };
}

/**
 * Generate tone-aware fallback response
 */
function generateFallback(
  input: ResponseGeneratorInput,
  tone: VendorTone,
  concerns: VendorConcern[],
): string {
  const { action } = input.decision;
  const ctx = buildTemplateContext(input, concerns);

  // For ASK_CLARIFY, pass provided/missing info
  if (action === "ASK_CLARIFY") {
    const currentProvided = input.currentExtraction
      ? getProvidedComponents(input.currentExtraction)
      : [];
    const missing = getMissingComponents(
      input.accumulatedOffer || input.vendorOffer,
    );
    return getToneAwareTemplate(action, ctx, tone, {
      provided: currentProvided,
      missing,
    });
  }

  return getToneAwareTemplate(action, ctx, tone);
}

/**
 * Generate a human-like PM response
 *
 * @param input - Response generation input
 * @returns Response with metadata
 *
 * @example
 * ```typescript
 * const result = await generateHumanLikeResponse({
 *   decision: { action: 'COUNTER', utilityScore: 0.65, ... },
 *   config: negotiationConfig,
 *   conversationHistory: messages,
 *   vendorOffer: { total_price: 98, payment_terms: 'Net 30' },
 *   counterOffer: { total_price: 94, payment_terms: 'Net 60' },
 *   deliveryConfig: { requiredDate: '2026-03-15' }
 * });
 * // result.response = "I understand the supply chain challenges..."
 * ```
 */
export async function generateHumanLikeResponse(
  input: ResponseGeneratorInput,
): Promise<ResponseGeneratorResult> {
  const startTime = Date.now();

  // Detect vendor tone
  const toneMessages: ToneMessage[] = input.conversationHistory.map((m) => ({
    role: m.role as "VENDOR" | "ACCORDO" | "SYSTEM",
    content: m.content,
  }));
  const toneResult = detectVendorTone(toneMessages);
  const tone = toneResult.primaryTone;

  // Extract concerns
  const concernMessages: ConcernMessage[] = input.conversationHistory.map(
    (m) => ({
      role: m.role as "VENDOR" | "ACCORDO" | "SYSTEM",
      content: m.content,
    }),
  );
  const concerns = extractVendorConcerns(concernMessages);

  logger.info("[ResponseGenerator] Starting generation", {
    action: input.decision.action,
    tone,
    concernCount: concerns.length,
    round: input.round,
  });

  // Detect milestone for personality enrichment
  const milestoneInput: MilestoneDetectionInput = {
    action: input.decision.action,
    round: input.round ?? 1,
    maxRounds: input.maxRounds ?? 10,
    previousUtility: undefined, // Caller can extend this
    currentUtility: input.decision.utilityScore,
  };
  const milestone = detectMilestone(milestoneInput);
  const enrichment = getPersonalityEnrichment(milestone, tone);

  if (milestone !== "none") {
    logger.info("[ResponseGenerator] Personality milestone detected", {
      milestone,
      tone,
      round: input.round,
    });
  }

  // Generate dynamic prompt addenda based on negotiation context
  const addendaCtx: AddendaContext = {
    round: input.round ?? 1,
    maxRounds: input.maxRounds ?? 10,
    utilityScore: input.decision.utilityScore,
    action: input.decision.action,
    vendorTone: tone,
    stallDetected: input.stallDetected,
    consecutiveCounters: input.consecutiveCounters,
    vendorConceded: input.vendorConceded,
    dealTitle: input.dealTitle,
    acceptThreshold: input.config.accept_threshold,
    walkawayThreshold: input.config.walkaway_threshold,
  };
  const { addenda, promptSuffix } = generatePromptAddenda(addendaCtx);

  if (addenda.length > 0) {
    logger.info("[ResponseGenerator] Dynamic addenda applied", {
      addendaIds: addenda.map((a) => a.id),
      round: input.round,
    });
  }

  // Try LLM first
  const prompt = buildPrompt(input, tone, concerns) + promptSuffix;
  const llmResponse = await generateLLMResponse(prompt);

  if (llmResponse && validateResponse(llmResponse, input.decision.action)) {
    const elapsed = Date.now() - startTime;
    return {
      response: applyPersonality(llmResponse.trim(), enrichment),
      source: "llm",
      tone,
      concerns,
      generationTimeMs: elapsed,
    };
  }

  // Fallback to enhanced templates
  logger.info("[ResponseGenerator] Using fallback templates");
  const fallbackResponse = generateFallback(input, tone, concerns);
  const elapsed = Date.now() - startTime;

  return {
    response: applyPersonality(fallbackResponse, enrichment),
    source: "fallback",
    tone,
    concerns,
    generationTimeMs: elapsed,
  };
}

/**
 * Generate a quick fallback response (for timeout scenarios)
 * This is synchronous and always returns immediately
 */
export function generateQuickFallback(input: ResponseGeneratorInput): string {
  // Use neutral tone and no concern acknowledgment for speed
  return generateFallback(input, "friendly", []);
}

export default {
  generateHumanLikeResponse,
  generateQuickFallback,
};
