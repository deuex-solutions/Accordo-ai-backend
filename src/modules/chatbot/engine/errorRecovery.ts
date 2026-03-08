/**
 * Error Recovery with Template Fallback
 *
 * Categorizes errors and always returns a human-readable template
 * response. Never exposes raw JSON or error details to the user.
 *
 * The engine's decisions are never lost — if the decision engine
 * succeeded but LLM rendering failed, the decision is preserved
 * and a template response is generated from it.
 *
 * @module errorRecovery
 */

import logger from '../../../config/logger.js';

/**
 * Error categories for negotiation processing
 */
export type ErrorCategory =
  | 'parse_failure'       // Could not extract offer from message
  | 'llm_timeout'         // LLM did not respond in time
  | 'llm_error'           // LLM returned an error
  | 'db_error'            // Database read/write failed
  | 'config_missing'      // Deal has no negotiation config
  | 'deal_not_found'      // Deal ID does not exist
  | 'invalid_state'       // Deal in unexpected status
  | 'unknown';            // Unclassified error

/**
 * Processing steps in the PM response pipeline
 */
export type ProcessingStep =
  | 'load_deal'
  | 'load_messages'
  | 'parse_offer'
  | 'load_config'
  | 'calculate_utility'
  | 'decide'
  | 'generate_response'
  | 'save_message'
  | 'update_deal';

/**
 * Partial result when processing fails mid-pipeline
 */
export interface PartialResult {
  /** Whether this is a partial result (always true) */
  isPartial: true;
  /** Steps that completed successfully */
  completedSteps: ProcessingStep[];
  /** The step that failed */
  failedStep: ProcessingStep;
  /** The error category */
  errorCategory: ErrorCategory;
  /** Human-readable template response to send to the user */
  fallbackResponse: string;
  /** The decision if it was computed before the failure (null otherwise) */
  decision: { action: string; utilityScore: number } | null;
}

/**
 * Classify an error into a category based on error type and message
 */
export function classifyError(error: unknown): ErrorCategory {
  if (error == null) return 'unknown';

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  // Database errors
  if (
    lowerMessage.includes('sequelize') ||
    lowerMessage.includes('database') ||
    lowerMessage.includes('connection refused') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('query') ||
    lowerMessage.includes('relation') ||
    lowerMessage.includes('constraint')
  ) {
    return 'db_error';
  }

  // LLM errors
  if (
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('aborted')
  ) {
    return 'llm_timeout';
  }

  if (
    lowerMessage.includes('ollama') ||
    lowerMessage.includes('llm') ||
    lowerMessage.includes('model') ||
    lowerMessage.includes('openai') ||
    lowerMessage.includes('chat completion')
  ) {
    return 'llm_error';
  }

  // Config errors
  if (
    lowerMessage.includes('config') ||
    lowerMessage.includes('configuration') ||
    lowerMessage.includes('no negotiation')
  ) {
    return 'config_missing';
  }

  // Not found
  if (lowerMessage.includes('not found') || lowerMessage.includes('404')) {
    return 'deal_not_found';
  }

  // Invalid state
  if (
    lowerMessage.includes('not in negotiating') ||
    lowerMessage.includes('invalid status') ||
    lowerMessage.includes('already accepted') ||
    lowerMessage.includes('already closed')
  ) {
    return 'invalid_state';
  }

  // Parse errors
  if (
    lowerMessage.includes('parse') ||
    lowerMessage.includes('extract') ||
    lowerMessage.includes('regex')
  ) {
    return 'parse_failure';
  }

  return 'unknown';
}

/**
 * Template responses by error category.
 * These are always human-readable and never expose internals.
 */
const ERROR_TEMPLATES: Record<ErrorCategory, string[]> = {
  parse_failure: [
    "Thank you for your message. I couldn't fully understand the details — could you please provide your price and payment terms more clearly? For example: '$45,000 with Net 60 payment terms'.",
    "I appreciate your message. Could you please restate your offer with the total price and payment terms?",
  ],
  llm_timeout: [
    "Thank you for your message. I'm reviewing your offer and will respond with our position shortly.",
    "I've received your message and am working on a detailed response. Thank you for your patience.",
  ],
  llm_error: [
    "Thank you for your message. I've noted your offer and will provide a detailed response shortly.",
    "Your message has been received. I'm preparing our response and will get back to you soon.",
  ],
  db_error: [
    "We're experiencing a temporary issue. Your message has been received and we'll respond shortly.",
    "A temporary system issue occurred. Please send your message again and we'll continue our discussion.",
  ],
  config_missing: [
    "Thank you for your message. Our team is setting up the negotiation parameters. We'll respond once the configuration is complete.",
  ],
  deal_not_found: [
    "I couldn't find the negotiation you're referring to. Please check the link or contact our team for assistance.",
  ],
  invalid_state: [
    "This negotiation has already concluded. If you'd like to discuss new terms, please start a new negotiation.",
    "This deal is no longer active. Please reach out to our team if you'd like to reopen discussions.",
  ],
  unknown: [
    "Thank you for your message. We encountered an unexpected issue but your message has been saved. We'll respond shortly.",
    "Thank you for your patience. We're having a brief technical moment — your message is safe and we'll get back to you soon.",
  ],
};

/**
 * Get a template fallback response for an error category
 */
export function getErrorFallbackResponse(category: ErrorCategory): string {
  const templates = ERROR_TEMPLATES[category];
  return templates[Math.floor(Math.random() * templates.length)];
}

/**
 * Build a partial result when processing fails mid-pipeline.
 *
 * This ensures the frontend always gets a usable response,
 * even when the backend fails at any step.
 *
 * @param error - The error that occurred
 * @param completedSteps - Steps that completed successfully
 * @param failedStep - The step that failed
 * @param decision - The decision if it was computed before failure
 * @returns A PartialResult with a human-readable fallback
 */
export function buildPartialResult(
  error: unknown,
  completedSteps: ProcessingStep[],
  failedStep: ProcessingStep,
  decision?: { action: string; utilityScore: number } | null
): PartialResult {
  const errorCategory = classifyError(error);

  logger.warn('[ErrorRecovery] Building partial result', {
    errorCategory,
    completedSteps,
    failedStep,
    hasDecision: !!decision,
    errorMessage: error instanceof Error ? error.message : String(error),
  });

  // If we have a decision, generate a response from it
  let fallbackResponse: string;
  if (decision) {
    fallbackResponse = buildResponseFromDecision(decision);
  } else {
    fallbackResponse = getErrorFallbackResponse(errorCategory);
  }

  return {
    isPartial: true,
    completedSteps,
    failedStep,
    errorCategory,
    fallbackResponse,
    decision: decision ?? null,
  };
}

/**
 * Generate a template response from a raw decision.
 * Used when the LLM fails but the decision engine succeeded.
 */
function buildResponseFromDecision(decision: { action: string; utilityScore: number; counterOffer?: { total_price?: number | null; payment_terms?: string | null } | null }): string {
  switch (decision.action) {
    case 'ACCEPT':
      return "We're pleased to accept your offer. Let's proceed with the agreement.";

    case 'COUNTER': {
      const counter = decision.counterOffer;
      if (counter?.total_price && counter?.payment_terms) {
        return `Thank you for your offer. We'd like to propose $${counter.total_price.toLocaleString()} with ${counter.payment_terms} payment terms. Let us know your thoughts.`;
      }
      if (counter?.total_price) {
        return `Thank you for your offer. We'd like to propose $${counter.total_price.toLocaleString()}. Let us know your thoughts.`;
      }
      return "Thank you for your offer. We have a counter-proposal and will share the details shortly.";
    }

    case 'ESCALATE':
      return "Your offer is being reviewed by our senior team. Someone will follow up with you shortly.";

    case 'WALK_AWAY':
      return "Thank you for your time and effort. Unfortunately, we're unable to proceed with the current terms.";

    case 'ASK_CLARIFY':
      return "Thank you for your message. Could you provide both the total price and payment terms so we can evaluate your offer?";

    default:
      return "Thank you for your message. We're reviewing your offer and will respond shortly.";
  }
}
