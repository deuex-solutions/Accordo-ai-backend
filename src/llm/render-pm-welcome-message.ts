/**
 * Standalone PM welcome message for new negotiations (Option 1 opener).
 * Senior-spec: 80–150 words, unique wording, procurement-team voice, no prices.
 */

import { generateCompletion } from "../services/openai.service.js";
import logger from "../config/logger.js";
import { resolveTimeOfDayGreeting } from "../utils/time-of-day-greeting.js";
import {
  validatePmWelcomeMessage,
  WelcomeValidationError,
} from "./validate-pm-welcome.js";
import { isLlmInfrastructureFailure } from "./llm-infrastructure-failure.js";

export interface PmWelcomeContext {
  dealId?: string;
  dealTitle?: string;
  requisitionTitle?: string;
  /** Procuring organization (buyer) — mention early in the welcome. */
  buyerCompanyName?: string;
  /** Supplier contact name for personalization. */
  vendorName?: string;
  productCategory?: string;
}

const MAX_ATTEMPTS = 3;

function buildWelcomeSystemPrompt(): string {
  return `You represent the procurement team as an enterprise tender negotiation assistant and experienced procurement manager.

Generate ONLY the opening welcome message for a new supplier negotiation.

Voice:
- Professional, confident, and welcoming — collaborative, not adversarial.
- Sound like an experienced procurement professional, not a chatbot.
- You may blend "procurement team", "tender negotiation", and "procurement manager" naturally.
- Use contractions sparingly; stay enterprise-formal.

Content (weave naturally, vary order each time):
- Early in the message, name the procuring company (buyer) when provided.
- Address the supplier contact by name when provided — once, naturally, not repeatedly.
- State you will guide the negotiation on behalf of the procurement team.
- Note the discussion may cover pricing, commercial terms, delivery, payment, service levels, warranties, contractual obligations, or risk — as relevant to a tender.
- Emphasize a fair, transparent, mutually beneficial agreement while protecting the organization's interests.
- Invite the supplier to share their proposal to begin.

Formatting:
- Write like a human chat message: 4–6 short lines, each on its own line (use a single newline between lines).
- Line 1: time-appropriate salutation only (e.g. "Good evening.").
- Line 2: welcome — include the buyer company name and supplier name when provided.
- Lines 3–5: one complete thought per line (commercial scope, objective, invitation).
- Do NOT run everything into one dense paragraph.

Hard rules:
- 60–150 words total across all lines. No bullet points. No emojis.
- Open with a time-appropriate salutation (Good morning / Good afternoon / Good evening).
- Do NOT include any prices, currency amounts, or specific commercial numbers.
- Do NOT say you are an AI, assistant, or language model.
- Do NOT use "How can I help you today?" or generic chatbot phrases.
- Do NOT repeat stock phrases like "Welcome to the Tender Negotiation Assistant."
- Output ONLY the greeting message.`;
}

function buildWelcomeUserPrompt(ctx: PmWelcomeContext, attempt: number): string {
  const salutation = resolveTimeOfDayGreeting();
  const lines = [
    `Begin line 1 with "${salutation}." only (salutation on its own line).`,
    ctx.buyerCompanyName
      ? `Procuring company (buyer — mention by name in line 2): ${ctx.buyerCompanyName}.`
      : "Procuring company name not provided — use 'our organization' or 'our procurement team' without inventing a company name.",
    ctx.vendorName
      ? `Supplier contact (address by name in line 2, e.g. "I welcome you, ${ctx.vendorName},"): ${ctx.vendorName}.`
      : "",
    ctx.requisitionTitle
      ? `Requisition / scope: ${ctx.requisitionTitle}.`
      : ctx.dealTitle
        ? `Deal: ${ctx.dealTitle}.`
        : "",
    ctx.productCategory ? `Category: ${ctx.productCategory}.` : "",
    "Use single newlines between lines — not one long paragraph.",
    attempt > 1
      ? "Rewrite with completely different vocabulary and sentence structure from any prior draft."
      : "Generate a fresh, unique opening — do not use a template-sounding frame.",
  ].filter(Boolean);

  return lines.join("\n");
}

const FALLBACK_WELCOMES: Array<(salutation: string, ctx: PmWelcomeContext) => string> = [
  (salutation, ctx) => {
    const company = ctx.buyerCompanyName ?? "our organization";
    const scope = ctx.requisitionTitle ?? "this tender";
    const welcomeLine = ctx.vendorName
      ? `On behalf of ${company}'s procurement team, I welcome you, ${ctx.vendorName}, to this negotiation.`
      : `On behalf of ${company}'s procurement manager and the wider procurement team, I welcome you to this negotiation.`;
    return [
      `${salutation}.`,
      welcomeLine,
      `I will guide our commercial dialogue and ensure we address pricing, terms, delivery, payment, and any other material aspects of ${scope} in a clear and transparent way.`,
      `Our aim is a fair, transparent, and mutually beneficial agreement that reflects market reality and protects ${company}'s interests while respecting yours as a supplier.`,
      `When you are ready, please share your proposal with your best view on price, quantities, and terms, and we will take the discussion forward from there.`,
    ].join("\n");
  },

  (salutation, ctx) => {
    const company = ctx.buyerCompanyName ?? "our procurement team";
    const scope = ctx.requisitionTitle ?? "this requisition";
    const welcomeLine = ctx.vendorName
      ? `${ctx.vendorName}, thank you for joining this negotiation on behalf of ${company}.`
      : `Thank you for joining this negotiation on behalf of ${company}.`;
    return [
      `${salutation}.`,
      welcomeLine,
      `I will lead the commercial review and we will work through total price, payment terms, delivery expectations, service levels, and any contractual or risk points your proposal raises.`,
      `We approach this collaboratively and aim for an outcome that is commercially sound for both parties.`,
      `Please share your quotation when ready so we can begin the structured discussion on ${scope}.`,
    ].join("\n");
  },

  (salutation, ctx) => {
    const company = ctx.buyerCompanyName ?? "our organization";
    const scope = ctx.requisitionTitle ?? "your offer";
    const welcomeLine = ctx.vendorName
      ? `On behalf of ${company}'s procurement manager and the wider procurement team, I welcome you, ${ctx.vendorName}, to this negotiation.`
      : `On behalf of ${company}'s procurement manager and the wider procurement team, I welcome you to this negotiation.`;
    return [
      `${salutation}.`,
      welcomeLine,
      `I will lead the commercial dialogue and ensure we address pricing, terms, delivery, and any other material aspects of ${scope} in a clear and transparent way.`,
      `Our objective is a balanced agreement that reflects market reality and our internal requirements.`,
      `Share your proposal at your convenience, and we will take the discussion forward from there.`,
    ].join("\n");
  },
];

function pickFallbackWelcome(ctx: PmWelcomeContext): string {
  const salutation = resolveTimeOfDayGreeting();
  const seed = (ctx.dealId ?? "0")
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const template = FALLBACK_WELCOMES[seed % FALLBACK_WELCOMES.length]!;
  return template(salutation, ctx);
}

export async function renderPmWelcomeMessage(
  ctx: PmWelcomeContext,
): Promise<string> {
  let lastReason = "unknown";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const completion = await generateCompletion({
        messages: [
          { role: "system", content: buildWelcomeSystemPrompt() },
          { role: "user", content: buildWelcomeUserPrompt(ctx, attempt) },
        ],
        temperature: 0.85,
        maxTokens: 320,
        dealId: ctx.dealId,
      });

      return validatePmWelcomeMessage(completion.content, ctx);
    } catch (error) {
      if (error instanceof WelcomeValidationError) {
        lastReason = error.reason;
        logger.warn("[PmWelcome] Validation failed, retrying", {
          attempt,
          reason: error.reason,
        });
        continue;
      }

      if (isLlmInfrastructureFailure(error)) {
        logger.warn("[PmWelcome] LLM infrastructure failure — using fallback", {
          error: error instanceof Error ? error.message : String(error),
        });
        break;
      }

      lastReason = error instanceof Error ? error.message : "llm_error";
      logger.warn("[PmWelcome] LLM call failed", { attempt, lastReason });
    }
  }

  const fallback = pickFallbackWelcome(ctx);
  try {
    return validatePmWelcomeMessage(fallback, ctx);
  } catch {
    logger.error("[PmWelcome] Fallback failed validation", { lastReason });
    return fallback.trim();
  }
}
