/**
 * Render + validate negotiation messages — LLM only, no template fallbacks.
 */

import { CustomError } from "../utils/custom-error.js";
import logger from "../config/logger.js";
import type { NegotiationIntent } from "../negotiation/intent/build-negotiation-intent.js";
import {
  renderNegotiationMessage,
  type PersonaContext,
} from "./persona-renderer.js";
import {
  validateLlmOutput,
  ValidationError,
} from "./validate-llm-output.js";
import { ensureFirstPmGreeting, isFirstPmNegotiationRound } from "./first-pm-greeting.js";
import { composeIntentFaithfulReply } from "./compose-intent-faithful-reply.js";
import { isLlmInfrastructureFailure } from "./llm-infrastructure-failure.js";

const MAX_VALIDATION_ATTEMPTS = 4;

export interface RenderValidatedResult {
  content: string;
  fromLlm: boolean;
  attempts: number;
  source: "llm" | "intent_compose";
}

function formatRequiredPrice(intent: NegotiationIntent): string | null {
  if (intent.allowedPrice == null) return null;
  const locale = intent.currencySymbol === "₹" ? "en-IN" : "en-US";
  return `${intent.currencySymbol}${intent.allowedPrice.toLocaleString(locale)}`;
}

function buildConstrainedRetryHint(
  intent: NegotiationIntent,
  lastReason: string,
): string {
  const lines = [
    `Previous draft failed validation (${lastReason}).`,
    "Rewrite completely as one natural procurement-manager message.",
    "Do not mention utility, algorithms, targets, or AI.",
    "Never use YYYY-MM-DD date format — use Month Day format if needed.",
  ];

  const price = formatRequiredPrice(intent);
  if (intent.action === "COUNTER" && price) {
    lines.push(`You MUST include this exact total price: ${price}`);
    if (intent.allowedPaymentTerms) {
      lines.push(
        `You MUST include these payment terms: ${intent.allowedPaymentTerms}`,
      );
    }
    if (intent.allowedDelivery) {
      lines.push(`Delivery (if mentioned): ${intent.allowedDelivery}`);
    }
    lines.push("Answer the vendor directly — do not ask them to resend price or terms.");
  }

  if (intent.action === "ACCEPT") {
    lines.push("Confirm acceptance warmly. Do NOT include any price numbers.");
  }

  if (
    lastReason === "missing_greeting" ||
    (isFirstPmNegotiationRound(intent.roundNumber) && !intent.priorPmWelcomeSent)
  ) {
    lines.push(
      "You MUST open with a time-appropriate salutation (Good morning, Good afternoon, or Good evening), then thank them and acknowledge their proposal, BEFORE stating your counter or acceptance. Do NOT open with only Thank you.",
    );
  } else if (
    isFirstPmNegotiationRound(intent.roundNumber) &&
    intent.priorPmWelcomeSent
  ) {
    lines.push(
      "A welcome was already sent. Do NOT greet again — open with a brief acknowledgment of their quotation, then state your counter.",
    );
  }

  return lines.join(" ");
}

/**
 * Render a negotiation reply via LLM with validation retries only.
 * Throws if all attempts fail — no template or programmatic fallback.
 */
export async function renderValidatedNegotiationMessage(
  intent: NegotiationIntent,
  vendorMessage: string,
  context: PersonaContext = {},
): Promise<RenderValidatedResult> {
  let lastReason = "unknown";

  for (let attempt = 1; attempt <= MAX_VALIDATION_ATTEMPTS; attempt++) {
    const retryContext: PersonaContext =
      attempt === 1
        ? context
        : {
            ...context,
            validationRetryHint: buildConstrainedRetryHint(intent, lastReason),
          };

    try {
      const rendered = await renderNegotiationMessage(
        intent,
        vendorMessage,
        retryContext,
      );

      const validated = validateLlmOutput(rendered.message, intent);
      return {
        content: ensureFirstPmGreeting(
          validated,
          intent.roundNumber,
          new Date(),
          intent.priorPmWelcomeSent,
        ),
        fromLlm: true,
        attempts: attempt,
        source: "llm",
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        lastReason = error.reason;
        logger.warn("[RenderRetry] Validation failed, retrying LLM", {
          action: intent.action,
          attempt,
          reason: error.reason,
        });
        continue;
      }

      lastReason = error instanceof Error ? error.message : "llm_error";

      if (isLlmInfrastructureFailure(error)) {
        logger.warn(
          "[RenderRetry] LLM infrastructure failure — skipping remaining LLM attempts",
          {
            action: intent.action,
            attempt,
            error: lastReason,
          },
        );
        break;
      }

      logger.warn("[RenderRetry] LLM call failed, retrying", {
        action: intent.action,
        attempt,
        error: lastReason,
      });
    }
  }

  logger.error("[RenderRetry] All LLM attempts exhausted — using intent-faithful compose", {
    action: intent.action,
    lastReason,
  });

  try {
    const composed = composeIntentFaithfulReply(intent);
    const validated = validateLlmOutput(composed, intent);
    return {
      content: ensureFirstPmGreeting(
        validated,
        intent.roundNumber,
        new Date(),
        intent.priorPmWelcomeSent,
      ),
      fromLlm: true,
      attempts: MAX_VALIDATION_ATTEMPTS,
      source: "intent_compose",
    };
  } catch (composeError) {
    logger.error("[RenderRetry] Intent-faithful compose failed", {
      action: intent.action,
      error:
        composeError instanceof Error
          ? composeError.message
          : String(composeError),
    });
  }

  throw new CustomError(
    `Unable to generate a valid PM response after ${MAX_VALIDATION_ATTEMPTS} LLM attempts (${lastReason})`,
    503,
  );
}
