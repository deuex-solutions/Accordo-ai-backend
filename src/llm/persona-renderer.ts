/**
 * Persona Renderer
 *
 * The ONLY file that communicates with the LLM for negotiation responses.
 *
 * Hard boundary rules:
 * - Receives ONLY NegotiationIntent + vendorMessage + minimal non-commercial context.
 * - Never receives: utility scores, weights, thresholds, target price, max price,
 *   config objects, scoring formulas, or MESO reasoning.
 * - The LLM may ONLY express a decision — not make one.
 * - Injects allowedPrice explicitly when action is COUNTER.
 * - Response length: 40–150 words (compact ACCEPT 15–80 when vendor at/below max).
 * - Temperature: 0.7 for natural variation across rounds.
 */

import { generateCompletion } from "../services/openai.service.js";
import logger from "../config/logger.js";
import type {
  NegotiationIntent,
  PersuasionAngle,
} from "../negotiation/intent/build-negotiation-intent.js";

// ─────────────────────────────────────────────
// Non-commercial context (safe to pass to LLM)
// ─────────────────────────────────────────────

export interface PersonaContext {
  /** Deal title — e.g. "Q1 Office Supplies" */
  dealTitle?: string;
  /** Vendor name — e.g. "Apex Supply Co." */
  vendorName?: string;
  /** Product category — e.g. "Industrial Equipment" */
  productCategory?: string;
  /** Compact negotiation arc summary (deterministic, safe fields only) */
  arcSummary?: string;
  /** Injected when a validation retry is needed */
  validationRetryHint?: string;
}

// ─────────────────────────────────────────────
// Static system prompt (hardcoded — never generated)
// ─────────────────────────────────────────────

function buildSystemPrompt(context: PersonaContext): string {
  const dealLine = context.dealTitle ? `\nDeal: ${context.dealTitle}` : "";
  const vendorLine = context.vendorName
    ? `\nVendor: ${context.vendorName}`
    : "";
  const categoryLine = context.productCategory
    ? `\nProduct Category: ${context.productCategory}`
    : "";

  return `You are Accordo, a professional procurement manager.${dealLine}${vendorLine}${categoryLine}

Your job: express the negotiation decision you are given, in natural human business chat.

Hard rules — never break these:
1. Express ONLY the decision provided. Never invent, modify, or infer commercial terms.
2. Never mention utility, algorithms, scores, calculations, thresholds, models, AI, automated systems, or any internal tooling.
3. If a price is provided, use it exactly — no rounding, no omitting, no rephrasing as ranges.
4. Never invent prices, dates, payment terms, or delivery details that weren't given to you.

Voice rules — sound like a real person:
5. Use contractions (we're, I'd, can't). Brief acknowledgments before the substance are good ("appreciate the quick turnaround" / "thanks for breaking that down").
6. Soft hedges and light empathy are OK ("honestly", "I hear you on the margins") — but NEVER weak apologies ("sorry to push back", "I hate to ask") and NEVER fake personal anecdotes ("my boss said…").
7. NO emojis, NO exclamation marks, NO slang or regional idioms.
8. NO em-dashes (—). Use commas, periods, or "so" / "and" instead. Hyphens (-) and en-dashes (–) for ranges like "Net 30–60" are fine.
9. NO performative AI phrases: "we'd love to", "this better aligns with our needs", "let us know your thoughts", "feel free to", "I hope this helps", "I understand [X] is a factor", "I understand [X] is important", "taking [X] into account". Talk like a buyer, not a helpful assistant. Avoid template-sounding sentence structures where you slot a topic into a fixed frame.
8. Mirror the vendor's formality (how casual / formal they are) — but NEVER mirror hostility, rudeness, or sarcasm. If the vendor is hostile, stay calm and professional.
9. If the vendor's message is in another language and you're told they're confident in it, reply in that language. Otherwise reply in English.
10. Greetings only when told this is round 1. After round 1, jump straight in like a real ongoing chat — no "Hi <vendor>".

Structure rules:
11. If the vendor asked a direct question AND stated a price, address the price first, the question second.
12. If the vendor asked questions previously that weren't answered, address those briefly before the negotiation thread.
13. If the vendor is just making smalltalk, give a short warm reply and redirect to the deal.
14. Write 40–150 words for substantive negotiation replies unless told this is a compact acceptance. Include genuine synthesized reasoning when countering.
15. Single message only. No bullet points unless presenting MESO options.
16. NEVER invent, infer, or fabricate vendor concerns, motivations, or financial situations. Only acknowledge concerns explicitly listed in the instruction below. If no concerns are listed, do NOT reference ANY vendor concern or circumstance. Specifically banned when no concerns are listed: "cash flow", "budget", "financial considerations", "financial needs", "margin pressure", "cash flow considerations", "budget constraints", "financial arrangements", "overhead", "cost structure". Do not use "given your/their..." or "considering your/their..." followed by any financial term. Do not use "[X] is a factor" or "[X] is a consideration" when referencing the vendor's situation.
17. Never output dates in YYYY-MM-DD format. Always use Month Day format (e.g. June 5 or June 5, 2026).`;
}

// ─────────────────────────────────────────────
// Instruction builder (structured, safe fields only)
// ─────────────────────────────────────────────

// Map language codes to natural-language names for the LLM prompt.
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  es: "Spanish",
  hi: "Hindi",
  fr: "French",
  de: "German",
  pt: "Portuguese",
};

// ─────────────────────────────────────────────
// Counter reasoning variety (rotates by round)
// ─────────────────────────────────────────────

const COUNTER_REASONING_HINTS: string[] = [
  "what we can work with on this one",
  "where we see the numbers landing",
  "what makes sense for this order",
  "the pricing on our end",
  "what we had in mind for this",
  "the range we're working within",
  "how we're looking at this deal",
];

function getCounterReasoningHint(round: number): string {
  const safeRound = Math.max(1, round);
  const idx = (safeRound - 1) % COUNTER_REASONING_HINTS.length;
  return COUNTER_REASONING_HINTS[idx];
}

const PERSUASION_ANGLE_HINTS: Record<PersuasionAngle, string> = {
  partnership:
    "Synthesize 2–4 sentences on long-term partnership, repeat business, and growing the relationship. Invent the reasoning yourself.",
  philosophy:
    "Synthesize 2–4 sentences on fair dealing, balanced risk, and what makes a sustainable agreement. Invent the reasoning yourself.",
  economics:
    "Synthesize 2–4 sentences on order-of-magnitude business economics (scale, efficiency, stewardship) without citing internal targets, margins, or our budget limits. Invent the reasoning yourself.",
};

// Length guidance the LLM aims for; the validator enforces hard bounds.
function lengthHintForAction(
  action: string,
  _vendorWordCount: number,
  roundNumber: number,
  compactAccept?: boolean,
): string {
  if (action === "ACCEPT" && compactAccept) {
    return "Aim for ~15–60 words: warm acceptance and brief next steps. No prices.";
  }

  switch (action) {
    case "COUNTER":
    case "MESO":
      if (roundNumber <= 1) {
        return "Aim for ~50–90 words: salutation (Good morning/afternoon/evening), acknowledgment of their quotation, 2–4 sentences of synthesized business reasoning, then your exact counter.";
      }
      return "Aim for ~40–120 words: acknowledge their position, 2–4 sentences of synthesized reasoning that supports our counter, then state the exact counter clearly.";
    case "WALK_AWAY":
    case "ESCALATE":
      return "Aim for ~40–100 words.";
    case "ACCEPT":
      return "Aim for ~40–80 words: warm acceptance and next steps. No prices.";
    case "ASK_CLARIFY":
      return "Aim for ~40–80 words.";
    default:
      return "Aim for ~40–100 words.";
  }
}

function buildInstruction(
  intent: NegotiationIntent,
  vendorMessage: string,
  context?: PersonaContext,
): string {
  const style = intent.vendorStyle;
  const round = intent.roundNumber ?? 1;
  const isFirstRound = round <= 1;

  // Tone mirroring — formality only, never hostility.
  const formalityHint = style
    ? style.formality >= 0.7
      ? "The vendor writes formally, match their formal register."
      : style.formality <= 0.3
        ? "The vendor writes casually and briefly. Match that energy: use contractions, keep your reply short and direct, skip preambles like 'Thank you for your offer' or 'We have given careful consideration'. Just get to the point."
        : style.length <= 8
          ? "The vendor's message is very short. Keep your reply similarly brief and direct, no long preambles."
          : "The vendor's tone is neutral, keep yours warm and professional."
    : `Mirror the vendor's ${intent.vendorTone} tone in formality only.`;

  const movementHint = intent.vendorMovement
    ? intent.vendorMovement === "significant"
      ? "The vendor has made a significant price concession since last round. Briefly acknowledge this positively before stating your counter."
      : intent.vendorMovement === "moderate"
        ? "The vendor moved their price down moderately. A brief positive acknowledgment is appropriate."
        : "The vendor made a small price adjustment. A subtle nod to their flexibility is fine but not required."
    : "";

  const hostilityHint = style?.hostility
    ? "The vendor is being hostile or rude. Do NOT mirror that. Stay calm, neutral-professional. Acknowledge their frustration in one short clause if natural, then move to the substance."
    : "";

  const languageHint =
    style &&
    style.languageConfidence >= 0.6 &&
    style.language !== "en" &&
    style.language !== "und"
      ? `Reply in ${LANGUAGE_NAMES[style.language] ?? "the vendor's language"}. Currency symbols and prices stay in the format given to you (do not localize numbers).`
      : "Reply in English.";

  const greetingHint =
    isFirstRound && intent.priorPmWelcomeSent
      ? "A standalone welcome was already sent on this deal. Do NOT greet with Good morning/Hi/Hello again. Open with one brief sentence acknowledging their quotation, then state your exact counter price and terms."
      : isFirstRound
        ? `This is the first procurement manager reply on this deal. REQUIRED structure: (1) time-appropriate salutation first (Good morning, Good afternoon, or Good evening — match the time of day), (2) one short sentence thanking them and acknowledging their quotation (units, price, terms, or delivery if mentioned), (3) state your exact counter price and terms, (4) optional brief reasoning. Do NOT open with only "Thank you" — the salutation must come first. Do NOT reference internal targets or budgets.`
        : "This is an ongoing chat — do NOT greet with Good morning/Hi/Hello, just continue the conversation.";

  const firmnessInstruction =
    intent.firmness >= 0.85
      ? "Be very firm. This is close to a final position."
      : intent.firmness >= 0.7
        ? "Be firm and clear. Hold your position."
        : intent.firmness >= 0.5
          ? "Be moderate — polite but direct."
          : intent.firmness >= 0.3
            ? "Be warm and collaborative. Show flexibility."
            : "Be very warm and accommodating. We're close to agreement.";

  const concernsText =
    intent.acknowledgeConcerns.length > 0
      ? `Acknowledge these vendor concerns naturally: ${intent.acknowledgeConcerns.join(", ")}.`
      : "";

  // Price-before-question ordering when both present.
  const orderingHint =
    style?.hasQuestion && style.lastVendorPrice != null
      ? "The vendor stated both a price and a question. Address the price/counter first, then briefly answer the question."
      : style?.hasQuestion
        ? "The vendor asked a question — answer it directly before continuing the negotiation."
        : "";

  // Smalltalk redirect.
  const smalltalkHint =
    style &&
    style.length > 0 &&
    style.length < 6 &&
    !style.lastVendorPrice &&
    !style.hasQuestion
      ? "The vendor's message reads like smalltalk. Reply with a brief warm acknowledgment, then redirect to the deal."
      : "";

  // Open questions list.
  const openQuestionsHint =
    intent.openQuestions && intent.openQuestions.length > 0
      ? `These vendor questions from earlier rounds were not yet answered — address them briefly first: ${intent.openQuestions.map((q) => `"${q.question}"`).join("; ")}.`
      : "";

  // Phrasing-history avoidance — coarse hint, no actual phrases revealed.
  const phrasingHint =
    intent.phrasingHistory && intent.phrasingHistory.length > 0
      ? `Vary your opener — you have already used these patterns in this deal: ${intent.phrasingHistory.slice(-6).join(" | ")}. Do not start with the same opening words.`
      : "";

  const lengthHint = lengthHintForAction(
    intent.action,
    style?.length ?? 0,
    round,
    intent.compactAccept,
  );

  const persuasionHint = intent.persuasionBrief
    ? [
        PERSUASION_ANGLE_HINTS[intent.persuasionBrief.angle],
        intent.persuasionBrief.vendorMovedTowardUs
          ? "The vendor has moved toward our position — acknowledge that positively before making the case for our counter."
          : "",
        intent.persuasionBrief.gapNarrative === "small"
          ? "The gap is small — keep reasoning collaborative and focused on closing."
          : intent.persuasionBrief.gapNarrative === "significant"
            ? "The gap is meaningful — explain why our counter is a fair landing point without revealing internal limits."
            : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const retryHint = context?.validationRetryHint
    ? `RETRY: ${context.validationRetryHint}`
    : "";

  // Vendor price echo — when present, LLM uses this exact string instead of
  // inventing its own formatting (prevents "355000" instead of "₹3,55,000").
  const vendorPriceHint = intent.vendorPriceFormatted
    ? `When referencing the vendor's price, use exactly: ${intent.vendorPriceFormatted}. Do not reformat or round it.`
    : "";

  let actionInstruction = "";

  switch (intent.action) {
    case "ACCEPT":
      actionInstruction = `Accept the vendor's offer. Express genuine appreciation. Confirm the deal is agreed and mention next steps briefly. Do NOT include any prices or numbers, just confirm acceptance. Keep the same tone and register you've been using throughout this conversation, do not suddenly become more formal or more casual than the chat has been.`;
      break;

    case "COUNTER":
      if (intent.allowedPrice != null) {
        const termsText = intent.allowedPaymentTerms
          ? `, payment terms: ${intent.allowedPaymentTerms}`
          : "";
        const deliveryText = intent.allowedDelivery
          ? `, delivery: ${intent.allowedDelivery}`
          : "";
        const reasonHint = getCounterReasoningHint(intent.roundNumber ?? 1);
        const priceLocale = intent.currencySymbol === "₹" ? "en-IN" : "en-US";
        const formattedCounter = intent.allowedPrice.toLocaleString(priceLocale);
        const ceilingHint = intent.atCeiling
          ? ` This is our best position on price. Convey firmness without saying "maximum", "limit", "ceiling", "cap", or "final offer". Use phrases like "this is where we are", "our best position", "the best we can do on this", or "we've stretched as far as we can". Be clear we're firm but not confrontational.`
          : "";
        const orderHint = isFirstRound
          ? "REQUIRED order: salutation (Good morning/afternoon/evening) → thank them and acknowledge their quotation → state counter. "
          : "";
        actionInstruction = `Counter the vendor's offer. ${orderHint}The EXACT counter is: total price ${intent.currencySymbol}${formattedCounter}${termsText}${deliveryText}. You MUST include this exact price with the ${intent.currencySymbol} symbol. Write 40–150 words total. After the greeting and counter, include 2–4 sentences of genuine business reasoning (synthesized by you — not from a template) that supports asking them to move toward our counter. Frame it around ${reasonHint}.${ceilingHint} Do NOT invent any vendor concern or motivation that isn't listed in this instruction.`;
      } else {
        actionInstruction =
          "Indicate that the current offer needs improvement and ask the vendor to reconsider their terms. Be polite but clear.";
      }
      break;

    case "WALK_AWAY":
      actionInstruction = `Professionally end the negotiation. Thank the vendor for their time. Leave the door open for future opportunities. Do NOT include any prices. Keep the same tone you've been using in this conversation.`;
      break;

    case "ESCALATE":
      actionInstruction = `Inform the vendor that this negotiation requires senior team review. A colleague will follow up within 2 business days. Be reassuring and professional.`;
      break;

    case "MESO":
      if (intent.offerVariants && intent.offerVariants.length > 0) {
        const options = intent.offerVariants
          .map(
            (v, i) =>
              `Option ${i + 1} — ${v.label}: ${intent.currencySymbol}${v.price.toLocaleString(intent.currencySymbol === "₹" ? "en-IN" : "en-US")}, ${v.paymentTerms}. ${v.description}`,
          )
          .join("\n");
        actionInstruction = `Present these options to the vendor. You MUST present all options with EXACT prices as given:\n${options}\nAsk the vendor which works best for them. Present them as fair alternatives.`;
      } else {
        actionInstruction =
          "Ask the vendor to consider alternative arrangements and suggest discussing different combinations of price and terms.";
      }
      break;

    case "ASK_CLARIFY":
      actionInstruction = `The vendor's message was unclear or incomplete. Naturally ask them to provide the missing information (total price and/or payment terms). Keep it brief and friendly.`;
      break;

    default:
      actionInstruction =
        "Respond professionally and continue the negotiation.";
  }

  return [
    ...(context?.arcSummary
      ? [`Negotiation context:\n${context.arcSummary}`, ""]
      : []),
    `Vendor's message: "${vendorMessage}"`,
    "",
    `Your action: ${actionInstruction}`,
    "",
    formalityHint,
    languageHint,
    greetingHint,
    hostilityHint,
    movementHint,
    vendorPriceHint,
    orderingHint,
    smalltalkHint,
    openQuestionsHint,
    phrasingHint,
    retryHint,
    firmnessInstruction,
    concernsText,
    persuasionHint,
    `Position context: ${intent.commercialPosition}`,
    "",
    `${lengthHint} Single message, no bullet points (except for MESO options).`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─────────────────────────────────────────────
// Main renderer
// ─────────────────────────────────────────────

export interface RenderResult {
  message: string;
  /** Always true — LLM failures throw; no template fallback on P0 path */
  fromLlm: true;
}

/**
 * Render a negotiation message using the LLM.
 *
 * The LLM receives ONLY:
 * - A hardcoded system prompt (persona + deal title/vendor/category only)
 * - The NegotiationIntent fields (no commercial data except allowedPrice for COUNTER)
 * - The vendor's message (for tone mirroring)
 *
 * Throws on LLM failure — callers must retry or surface 503.
 */
export async function renderNegotiationMessage(
  intent: NegotiationIntent,
  vendorMessage: string,
  context: PersonaContext = {},
): Promise<RenderResult> {
  try {
    const systemPrompt = buildSystemPrompt(context);
    const userInstruction = buildInstruction(intent, vendorMessage, context);

    const messages = [
      { role: "system" as const, content: systemPrompt },
      { role: "user" as const, content: userInstruction },
    ];

    logger.info("[PersonaRenderer] Rendering message", {
      action: intent.action,
      tone: intent.vendorTone,
      firmness: intent.firmness,
      hasAllowedPrice: intent.allowedPrice != null,
    });

    const response = await generateCompletion(messages, {
      // Slight bump from 0.5 → 0.7 for natural variation across rounds.
      temperature: 0.7,
      // ~150 words ceiling plus formatting buffer.
      maxTokens: 480,
    });

    logger.info("[PersonaRenderer] LLM response received", {
      action: intent.action,
      length: response.content.length,
      model: response.model,
      fallbackUsed: response.fallbackUsed,
    });

    return {
      message: response.content,
      fromLlm: true as const,
    };
  } catch (error) {
    logger.warn("[PersonaRenderer] LLM call failed", {
      action: intent.action,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
