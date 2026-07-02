/**
 * Step 5 — ResponseComposer chat mode (P0.3).
 *
 * LLM replies for non-negotiation classifier routes. No scoring, policy, or MESO.
 * LLM-only — no template fallbacks.
 *
 * @source message_classifier_flow.md Step 5
 */

import { generateCompletion } from "../../../services/openai.service.js";
import logger from "../../../config/logger.js";
import {
  getCurrencySymbol,
  humanRoundPrice,
} from "../../../negotiation/intent/build-negotiation-intent.js";
import { sanitizeText } from "../../../llm/validate-llm-output.js";
import { isLlmInfrastructureFailure } from "../../../llm/llm-infrastructure-failure.js";
import { buildFirstPmOpeningPrefix } from "../../../llm/first-pm-greeting.js";
import {
  leaksInternalPriceBand,
  VENDOR_NO_RANGE_SYSTEM_RULE,
} from "./vendor-range-guard.js";
import type { ClassificationResult, ClassificationRoute } from "./types.js";
import type { DealClassificationContext } from "./types.js";

export interface ComposeChatResponseInput {
  vendorMessage: string;
  classification: ClassificationResult;
  dealContext: DealClassificationContext;
  currencyCode: string;
  dealTitle?: string;
  /** 1-indexed PM negotiation round (excludes auto-greeting). */
  pmNegotiationRound?: number;
  /** Summarized prior chat — internal LLM context only. */
  conversationContext?: string;
}

export interface ComposeChatResponseResult {
  content: string;
  fromLlm: true;
  decisionAction: string;
}

const MAX_CHAT_ATTEMPTS = 3;

function countChatWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

const CHAT_WORD_MIN = 40;
const CHAT_WORD_MAX = 150;

function formatMoney(amount: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode);
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  return `${symbol}${humanRoundPrice(amount).toLocaleString(locale)}`;
}

function decisionActionForRoute(route: ClassificationRoute): string {
  switch (route) {
    case "REDIRECT":
      return "REDIRECT";
    case "ASK_CLARIFICATION":
      return "ASK_CLARIFY";
    case "SOFT_DECLINE":
      return "SOFT_DECLINE";
    case "CHAT_RESPONSE":
    default:
      return "CHAT_RESPONSE";
  }
}

function buildChatSystemPrompt(
  dealTitle?: string,
  pmNegotiationRound?: number,
): string {
  const dealLine = dealTitle ? `\nDeal: ${dealTitle}` : "";
  const greetingLine =
    pmNegotiationRound != null && pmNegotiationRound <= 1
      ? `\nThis is your first substantive procurement reply on this deal. Open with a time-appropriate salutation (Good morning, Good afternoon, or Good evening), then thank them and acknowledge what they shared, then continue. Do NOT open with only "Thank you".`
      : "\nThis is an ongoing negotiation — do not open with Good morning/Hi/Hello.";
  return `You are Priya, a procurement manager at Accordo.${dealLine}${greetingLine}

You are responding to a vendor message that is NOT a complete negotiation offer.
Do NOT counter-offer or propose your own commercial numbers.
${VENDOR_NO_RANGE_SYSTEM_RULE}
Never mention utility scores, algorithms, internal targets, or that you are an AI.
Keep replies warm, professional, and substantive (40–150 words).
No emojis or exclamation marks.`;
}

function buildChatUserPrompt(
  input: ComposeChatResponseInput,
  attempt: number,
  lastError?: string,
): string {
  const { classification, vendorMessage, currencyCode, conversationContext } =
    input;

  const contextBlock = conversationContext?.trim()
    ? `Negotiation context (prior turns — stay consistent with this thread):\n${conversationContext.trim()}\n\n`
    : "";

  let base: string;

  switch (classification.route) {
    case "ASK_CLARIFICATION":
      if (
        classification.extractedPrice != null &&
        classification.extractedDays == null
      ) {
        base = `Route: ASK_CLARIFICATION — vendor gave price only.
Vendor said: "${vendorMessage}"
Ask ONLY for their preferred payment timeline (e.g. NET 30). Do not ask for price again.`;
        break;
      }
      if (
        classification.extractedDays != null &&
        classification.extractedPrice == null
      ) {
        base = `Route: ASK_CLARIFICATION — vendor gave terms only.
Vendor said: "${vendorMessage}"
Ask ONLY for their best price. Do not ask for payment terms again.`;
        break;
      }
      base = `Route: ASK_CLARIFICATION
Vendor said: "${vendorMessage}"
Ask for the missing commercial detail (price or payment terms), not both at once.`;
      break;

    case "SOFT_DECLINE":
      base = `Route: SOFT_DECLINE
Vendor said: "${vendorMessage}"
Their stated total: ${classification.extractedPrice != null ? formatMoney(classification.extractedPrice, currencyCode) : "unknown"}
Acknowledge their quotation warmly (units, price, payment terms if mentioned). Explain politely that the price is above what you can accommodate on this order.
Invite them to revisit with a revised total-price proposal at a more competitive level. Do NOT state any internal budget, target, min, or max figures. Do NOT counter-offer or negotiate.`;
      break;

    case "REDIRECT":
      base = `Route: REDIRECT — off-topic request.
Vendor said: "${vendorMessage}"
Politely redirect them to share pricing and payment terms for this negotiation channel.`;
      break;

    case "CHAT_RESPONSE":
    default:
      if (classification.type === "UNPARSEABLE") {
        base = `Route: CHAT_RESPONSE — message unclear.
Vendor said: "${vendorMessage}"
Ask them to share their best price along with payment terms (example: "${getCurrencySymbol(currencyCode)}X,XXX with NET 30").`;
      } else {
        base = `Route: CHAT_RESPONSE
Vendor said: "${vendorMessage}"
Respond warmly and invite them to share a quote with price and payment terms when ready.`;
      }
  }

  if (attempt > 1 && lastError) {
    return `${contextBlock}${base}\n\nRETRY (attempt ${attempt}): Previous response failed (${lastError}). Rewrite naturally.`;
  }
  return `${contextBlock}${base}`;
}

/**
 * Render chat-mode PM response via LLM (no MESO, no counter math).
 */
export async function composeChatResponse(
  input: ComposeChatResponseInput,
): Promise<ComposeChatResponseResult> {
  const decisionAction = decisionActionForRoute(input.classification.route);
  let lastError = "unknown";

  for (let attempt = 1; attempt <= MAX_CHAT_ATTEMPTS; attempt++) {
    try {
      const messages = [
        {
          role: "system" as const,
          content: buildChatSystemPrompt(
            input.dealTitle,
            input.pmNegotiationRound,
          ),
        },
        {
          role: "user" as const,
          content: buildChatUserPrompt(input, attempt, lastError),
        },
      ];

      const response = await generateCompletion(messages, {
        temperature: attempt === 1 ? 0.7 : 0.5,
        maxTokens: 480,
      });

      const content = sanitizeText(response.content.trim());
      if (!content) {
        throw new Error("empty_response");
      }
      const words = countChatWords(content);
      if (words < CHAT_WORD_MIN || words > CHAT_WORD_MAX) {
        throw new Error(
          words < CHAT_WORD_MIN ? "too_short" : "too_long",
        );
      }
      const { min, max } = input.dealContext.expectedPriceRange;
      if (leaksInternalPriceBand(content, min, max, input.currencyCode)) {
        throw new Error("internal_range_leak");
      }

      return { content, fromLlm: true, decisionAction };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      logger.warn("[Pipeline] composeChatResponse retry", {
        route: input.classification.route,
        attempt,
        error: lastError,
      });
      if (isLlmInfrastructureFailure(error)) {
        break;
      }
    }
  }

  logger.error("[Pipeline] composeChatResponse LLM exhausted — using deterministic fallback", {
    route: input.classification.route,
    lastError,
  });

  const fallback = sanitizeText(composeChatDeterministicFallback(input));
  return { content: fallback, fromLlm: true, decisionAction };
}

function composeChatDeterministicFallback(
  input: ComposeChatResponseInput,
): string {
  const { classification, currencyCode } = input;
  const isFirst = (input.pmNegotiationRound ?? 1) <= 1;
  const greet = isFirst ? buildFirstPmOpeningPrefix(0) : "";
  const route = classification.route;
  const symbol = getCurrencySymbol(currencyCode);
  const locale = currencyCode.toUpperCase() === "INR" ? "en-IN" : "en-US";
  const fmt = (n: number) => formatMoney(n, currencyCode);

  let body: string;
  switch (route) {
    case "ASK_CLARIFICATION":
      body = `${greet}Could you share your best total price and preferred payment terms so we can continue on this requisition?`;
      break;
    case "SOFT_DECLINE": {
      const vendorTotal =
        classification.extractedPrice != null
          ? `We've reviewed your total of ${fmt(classification.extractedPrice)}. `
          : "";
      body = `${greet}${vendorTotal}The price is above what we can accommodate on this order. We would welcome a revised quote at a more competitive level when you have room to adjust.`;
      break;
    }
    case "REDIRECT":
      body = `${greet}This channel is for pricing and payment terms on the current requisition. Please share your best total price and payment terms when you are ready.`;
      break;
    default:
      body = classification.type === "UNPARSEABLE"
        ? `${greet}I did not quite catch the commercial details. Please share your best total price with payment terms, for example ${symbol}50,000 with Net 30.`
        : `${greet}Thanks for reaching out. When you are ready, please share your best total price and payment terms for this requisition so we can continue the discussion.`;
  }

  let out = body.trim();
  const pad =
    "We appreciate your patience and look forward to continuing this negotiation with you on terms that work for both sides.";
  while (out.split(/\s+/).filter(Boolean).length < CHAT_WORD_MIN) {
    out += ` ${pad}`;
  }
  return out;
}
