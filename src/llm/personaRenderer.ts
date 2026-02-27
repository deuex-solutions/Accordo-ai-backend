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
 * - Limits responses to ~120 words.
 * - Temperature: 0.5 for controlled, consistent output.
 */

import { generateCompletion } from '../services/openai.service.js';
import { getFallbackResponse } from './fallbackTemplates.js';
import logger from '../config/logger.js';
import type { NegotiationIntent } from '../negotiation/intent/buildNegotiationIntent.js';

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
}

// ─────────────────────────────────────────────
// Static system prompt (hardcoded — never generated)
// ─────────────────────────────────────────────

function buildSystemPrompt(context: PersonaContext): string {
  const dealLine = context.dealTitle ? `\nDeal: ${context.dealTitle}` : '';
  const vendorLine = context.vendorName ? `\nVendor: ${context.vendorName}` : '';
  const categoryLine = context.productCategory ? `\nProduct Category: ${context.productCategory}` : '';

  return `You are Accordo, a professional procurement manager.${dealLine}${vendorLine}${categoryLine}

Your role is to express a negotiation decision in natural, human language.

Strict rules:
1. Express ONLY the decision given to you — do not invent, modify, or infer any commercial terms.
2. Never mention utility, algorithm, score, calculation, threshold, model, AI, automated system, or any internal tool.
3. Keep your response under 120 words.
4. Sound like a real person — warm but professional.
5. Never invent prices, dates, or terms not explicitly provided to you.
6. If a price is given to you, use it exactly as provided — do not round, change, or omit it.
7. Mirror the vendor's tone as instructed.`;
}

// ─────────────────────────────────────────────
// Instruction builder (structured, safe fields only)
// ─────────────────────────────────────────────

function buildInstruction(intent: NegotiationIntent, vendorMessage: string): string {
  const toneInstruction = `Mirror the vendor's ${intent.vendorTone} tone.`;
  const firmnessInstruction = intent.firmness >= 0.75
    ? 'Be firm and clear. Hold your position.'
    : intent.firmness >= 0.55
      ? 'Be moderate — polite but direct.'
      : 'Be warm and collaborative.';

  const concernsText = intent.acknowledgeConcerns.length > 0
    ? `Acknowledge these vendor concerns naturally: ${intent.acknowledgeConcerns.join(', ')}.`
    : '';

  let actionInstruction = '';

  switch (intent.action) {
    case 'ACCEPT':
      actionInstruction = `Accept the vendor's offer. Express genuine appreciation. Confirm the deal is agreed and mention next steps briefly. Do NOT include any prices or numbers — just confirm acceptance warmly.`;
      break;

    case 'COUNTER':
      if (intent.allowedPrice != null) {
        const termsText = intent.allowedPaymentTerms ? `, payment terms: ${intent.allowedPaymentTerms}` : '';
        const deliveryText = intent.allowedDelivery ? `, delivery: ${intent.allowedDelivery}` : '';
        actionInstruction = `Counter the vendor's offer. The EXACT counter is: total price $${intent.allowedPrice.toLocaleString()}${termsText}${deliveryText}. You MUST include this exact price. Provide a brief, natural business reason (budget constraints, project requirements, or similar). Keep it conversational.`;
      } else {
        actionInstruction = 'Indicate that the current offer needs improvement and ask the vendor to reconsider their terms. Be polite but clear.';
      }
      break;

    case 'WALK_AWAY':
      actionInstruction = `Professionally end the negotiation. Thank the vendor for their time. Leave the door open for future opportunities. Do NOT include any prices.`;
      break;

    case 'ESCALATE':
      actionInstruction = `Inform the vendor that this negotiation requires senior team review. A colleague will follow up within 2 business days. Be reassuring and professional.`;
      break;

    case 'MESO':
      if (intent.offerVariants && intent.offerVariants.length > 0) {
        const options = intent.offerVariants
          .map((v, i) => `Option ${i + 1} — ${v.label}: $${v.price.toLocaleString()}, ${v.paymentTerms}. ${v.description}`)
          .join('\n');
        actionInstruction = `Present these options to the vendor. You MUST present all options with EXACT prices as given:\n${options}\nAsk the vendor which works best for them. Present them as fair alternatives.`;
      } else {
        actionInstruction = 'Ask the vendor to consider alternative arrangements and suggest discussing different combinations of price and terms.';
      }
      break;

    case 'ASK_CLARIFY':
      actionInstruction = `The vendor's message was unclear or incomplete. Naturally ask them to provide the missing information (total price and/or payment terms). Keep it brief and friendly.`;
      break;

    default:
      actionInstruction = 'Respond professionally and continue the negotiation.';
  }

  return [
    `Vendor's message: "${vendorMessage}"`,
    '',
    `Your action: ${actionInstruction}`,
    '',
    toneInstruction,
    firmnessInstruction,
    concernsText,
    `Position context: ${intent.commercialPosition}`,
    '',
    'Respond in a single paragraph, under 120 words. Do not use bullet points.',
  ].filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────
// Main renderer
// ─────────────────────────────────────────────

export interface RenderResult {
  message: string;
  /** Whether the response was generated by LLM (true) or a fallback template (false) */
  fromLlm: boolean;
}

/**
 * Render a negotiation message using the LLM.
 *
 * The LLM receives ONLY:
 * - A hardcoded system prompt (persona + deal title/vendor/category only)
 * - The NegotiationIntent fields (no commercial data except allowedPrice for COUNTER)
 * - The vendor's message (for tone mirroring)
 *
 * Returns a RenderResult. If LLM fails, returns a humanized fallback template.
 */
export async function renderNegotiationMessage(
  intent: NegotiationIntent,
  vendorMessage: string,
  context: PersonaContext = {}
): Promise<RenderResult> {
  try {
    const systemPrompt = buildSystemPrompt(context);
    const userInstruction = buildInstruction(intent, vendorMessage);

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userInstruction },
    ];

    logger.info('[PersonaRenderer] Rendering message', {
      action: intent.action,
      tone: intent.vendorTone,
      firmness: intent.firmness,
      hasAllowedPrice: intent.allowedPrice != null,
    });

    const response = await generateCompletion(messages, {
      temperature: 0.5,
      maxTokens: 200, // ~120 words + buffer
    });

    logger.info('[PersonaRenderer] LLM response received', {
      action: intent.action,
      length: response.content.length,
      model: response.model,
      fallbackUsed: response.fallbackUsed,
    });

    return {
      message: response.content,
      fromLlm: true,
    };
  } catch (error) {
    logger.warn('[PersonaRenderer] LLM call failed, using fallback template', {
      action: intent.action,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      message: getFallbackResponse(intent),
      fromLlm: false,
    };
  }
}
