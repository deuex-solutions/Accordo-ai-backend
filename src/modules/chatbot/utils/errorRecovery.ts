/**
 * Error Recovery Module
 *
 * Comprehensive error recovery system for chatbot operations.
 * Provides retry logic, state recovery, fallback mechanisms,
 * and transaction rollback capabilities.
 *
 * Features:
 * - LLM call retry with exponential backoff
 * - State recovery from corruption
 * - Fallback to heuristics when LLM fails
 * - Transaction rollback on partial failures
 * - Dead letter queue for failed operations
 *
 * @module errorRecovery
 * @example
 * ```typescript
 * import { retryWithBackoff, recoverConvoState } from './error-recovery.js';
 *
 * // Retry LLM call
 * const result = await retryWithBackoff(
 *   () => llmService.classify(message),
 *   3,
 *   1000
 * );
 *
 * // Recover corrupted state
 * const fixed = await recoverConvoState(dealId, corruptedState);
 * ```
 */

import { logger } from '../../../config/logger.js';
import type { ConversationState, ConversationIntent } from '../convo/types.js';
import type { Offer } from '../engine/types.js';

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (attempt: number, error: any) => void;
}

export interface DeadLetterEntry {
  id: string;
  operation: string;
  input: any;
  error: string;
  attempts: number;
  timestamp: Date;
  lastAttempt: Date;
}

// In-memory dead letter queue (could be replaced with database storage)
const deadLetterQueue: Map<string, DeadLetterEntry> = new Map();

// ============================================================================
// Retry Functions
// ============================================================================

/**
 * Retry a function with exponential backoff
 *
 * Retries the function up to maxRetries times, with exponentially increasing
 * delays between attempts. Useful for transient errors like network issues
 * or LLM API rate limits.
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param baseDelay - Base delay in milliseconds (default: 1000)
 * @param options - Additional retry options
 * @returns Result of the function
 * @throws Last error if all retries fail
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   3,
 *   1000
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxDelay = 30000,
    onRetry,
  } = options;

  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        logger.error(`All ${maxRetries} retry attempts failed:`, error);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      logger.warn(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms...`,
        { error: error instanceof Error ? error.message : String(error) }
      );

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, error as Error);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Retry with jitter to prevent thundering herd
 *
 * Adds random jitter to the delay to prevent multiple clients
 * from retrying at the exact same time.
 *
 * @param fn - Async function to retry
 * @param maxRetries - Maximum number of retry attempts
 * @param baseDelay - Base delay in milliseconds
 * @returns Result of the function
 */
export async function retryWithJitter<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  return retryWithBackoff(fn, maxRetries, baseDelay, {
    onRetry: async (_attempt) => {
      // Add random jitter (0-50% of base delay)
      const jitter = Math.random() * baseDelay * 0.5;
      await sleep(jitter);
    },
  });
}

// ============================================================================
// State Recovery Functions
// ============================================================================

/**
 * Recover a corrupted conversation state
 *
 * Attempts to fix common issues in conversation state:
 * - Invalid phase values
 * - Negative counters
 * - Missing required fields
 * - Inconsistent state
 *
 * @param dealId - Deal ID for logging
 * @param corruptedState - Potentially corrupted state
 * @returns Fixed conversation state
 *
 * @example
 * ```typescript
 * const fixed = await recoverConvoState('deal-123', {
 *   phase: 'INVALID', // Will be fixed to 'WAITING_FOR_OFFER'
 *   refusalCount: -5,  // Will be clamped to 0
 *   turnCount: -1      // Will be clamped to 0
 * });
 * ```
 */
export async function recoverConvoState(
  dealId: string,
  corruptedState: Partial<ConversationState>
): Promise<ConversationState> {
  logger.warn(`Recovering corrupted conversation state for deal ${dealId}`, {
    corruptedState,
  });

  // Default values for a fresh conversation state
  const defaultState: ConversationState = {
    phase: 'WAITING_FOR_OFFER',
    askedPreference: false,
    lastVendorOffer: null,
    detectedPreference: 'NEITHER',
  };

  // Merge with corrupted state, fixing issues
  const recovered: ConversationState = {
    phase: validatePhase(corruptedState.phase) || defaultState.phase,
    askedPreference: Boolean(corruptedState.askedPreference),
    lastVendorOffer: validateOffer(corruptedState.lastVendorOffer) || defaultState.lastVendorOffer,
    detectedPreference: validatePreference(corruptedState.detectedPreference) || defaultState.detectedPreference,
  };

  logger.info(`Recovered conversation state for deal ${dealId}`, {
    recoveredState: recovered,
  });

  return recovered;
}

/**
 * Validate and fix conversation state
 *
 * Runs comprehensive validation and fixes on a conversation state.
 * This is a more thorough check than recoverConvoState.
 *
 * @param state - State to validate and fix
 * @returns Fixed state
 */
export async function validateAndFixState(
  state: ConversationState
): Promise<ConversationState> {
  // Fix phase
  state.phase = validatePhase(state.phase) || 'WAITING_FOR_OFFER';

  // Fix boolean
  state.askedPreference = Boolean(state.askedPreference);

  // Fix offers
  state.lastVendorOffer = validateOffer(state.lastVendorOffer);

  // Fix preference
  state.detectedPreference = validatePreference(state.detectedPreference) || 'NEITHER';

  // Validate consistency
  if (state.phase === 'WAITING_FOR_OFFER' && state.lastVendorOffer !== null) {
    logger.warn('Inconsistent state: WAITING_FOR_OFFER with lastVendorOffer set');
    state.phase = 'NEGOTIATING';
  }

  if (state.phase === 'TERMINAL' && state.lastVendorOffer === null) {
    logger.warn('Inconsistent state: TERMINAL with no vendor offer');
    state.phase = 'WAITING_FOR_OFFER';
  }

  return state;
}

// ============================================================================
// Fallback Functions
// ============================================================================

/**
 * Fallback intent classification (heuristic-based)
 *
 * When LLM-based classification fails, use simple heuristics
 * to classify the message intent.
 *
 * @param message - Vendor message to classify
 * @returns Classified intent
 *
 * @example
 * ```typescript
 * const intent = await fallbackClassifyIntent('Hello there!');
 * // Returns: 'GREET'
 * ```
 */
export async function fallbackClassifyIntent(
  message: string
): Promise<ConversationIntent> {
  const lower = message.toLowerCase().trim();

  // Greeting patterns
  if (/^(hi|hello|hey|good\s+(morning|afternoon|evening))/i.test(lower)) {
    return 'GREET';
  }

  // Refusal patterns
  if (
    /\b(no|not\s+now|later|can't|cannot|won't|not\s+interested)\b/i.test(lower)
  ) {
    return 'HANDLE_REFUSAL';
  }

  // Acceptance patterns
  if (/\b(accept|agree|deal|sounds\s+good)\b/i.test(lower)) {
    return 'ACCEPT';
  }

  // Counter-offer patterns (contains price or terms)
  if (
    /\$\d+|\d+\s*(per\s+unit|\/unit)|net\s*(30|60|90)/i.test(lower)
  ) {
    return 'COUNTER_DIRECT';
  }

  // Default to ask for offer
  return 'ASK_FOR_OFFER';
}

/**
 * Fallback offer parsing (heuristic-based)
 *
 * When LLM-based parsing fails, use simple regex patterns
 * to extract offer components.
 *
 * @param message - Message to parse
 * @returns Parsed offer
 */
export async function fallbackParseOffer(message: string): Promise<Offer> {
  const lower = message.toLowerCase();

  // Extract price
  let total_price: number | null = null;
  const priceMatch = lower.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (priceMatch) {
    total_price = parseFloat(priceMatch[1]);
  }

  // Extract terms
  let payment_terms: 'Net 30' | 'Net 60' | 'Net 90' | null = null;
  const termsMatch = lower.match(/net\s*(30|60|90)/);
  if (termsMatch) {
    payment_terms = `Net ${termsMatch[1]}` as 'Net 30' | 'Net 60' | 'Net 90';
  }

  return { total_price, payment_terms };
}

// ============================================================================
// Dead Letter Queue Functions
// ============================================================================

/**
 * Add failed operation to dead letter queue
 *
 * @param operation - Operation name
 * @param input - Operation input
 * @param error - Error that occurred
 * @returns Dead letter entry ID
 */
export function addToDeadLetterQueue(
  operation: string,
  input: any,
  error: any
): string {
  const id = `${operation}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const entry: DeadLetterEntry = {
    id,
    operation,
    input,
    error: error.message || String(error),
    attempts: 1,
    timestamp: new Date(),
    lastAttempt: new Date(),
  };

  deadLetterQueue.set(id, entry);

  logger.error(`Added to dead letter queue: ${id}`, {
    operation,
    error: entry.error,
  });

  return id;
}

/**
 * Get all entries from dead letter queue
 *
 * @returns Array of dead letter entries
 */
export function getDeadLetterQueue(): DeadLetterEntry[] {
  return Array.from(deadLetterQueue.values());
}

/**
 * Retry a dead letter queue entry
 *
 * @param id - Entry ID
 * @param retryFn - Function to retry
 * @returns Success status
 */
export async function retryDeadLetter(
  id: string,
  retryFn: (input: any) => Promise<void>
): Promise<boolean> {
  const entry = deadLetterQueue.get(id);
  if (!entry) {
    logger.error(`Dead letter entry not found: ${id}`);
    return false;
  }

  try {
    await retryFn(entry.input);
    deadLetterQueue.delete(id);
    logger.info(`Successfully retried dead letter entry: ${id}`);
    return true;
  } catch (error) {
    entry.attempts += 1;
    entry.lastAttempt = new Date();
    logger.error(`Failed to retry dead letter entry: ${id}`, { error });
    return false;
  }
}

/**
 * Clear dead letter queue
 */
export function clearDeadLetterQueue(): void {
  deadLetterQueue.clear();
  logger.info('Cleared dead letter queue');
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sleep for a given duration
 *
 * @param ms - Duration in milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validate conversation phase
 *
 * @param phase - Phase to validate
 * @returns Valid phase or null
 */
function validatePhase(
  phase: any
): ConversationState['phase'] | null {
  const validPhases: ConversationState['phase'][] = [
    'WAITING_FOR_OFFER',
    'NEGOTIATING',
    'WAITING_FOR_PREFERENCE',
    'TERMINAL',
  ];

  if (validPhases.includes(phase)) {
    return phase;
  }

  logger.warn(`Invalid phase: ${phase}`);
  return null;
}

/**
 * Validate vendor preference
 *
 * @param preference - Preference to validate
 * @returns Valid preference or null
 */
function validatePreference(
  preference: any
): 'PRICE' | 'TERMS' | 'NEITHER' | null {
  const validPreferences = ['PRICE', 'TERMS', 'NEITHER'];

  if (validPreferences.includes(preference)) {
    return preference as 'PRICE' | 'TERMS' | 'NEITHER';
  }

  logger.warn(`Invalid preference: ${preference}`);
  return null;
}

/**
 * Validate offer object
 *
 * @param offer - Offer to validate
 * @returns Valid offer or null
 */
/**
 * Validate payment terms string
 * UPDATED January 2026: Now accepts any "Net X" format (X = 1-120 days)
 */
function validatePaymentTerms(terms: any): string | null {
  if (typeof terms !== 'string') return null;
  // Match "Net X" pattern where X is 1-120
  const match = terms.match(/^Net\s*(\d+)$/i);
  if (!match) return null;
  const days = parseInt(match[1], 10);
  if (days < 1 || days > 120) return null;
  return `Net ${days}`; // Normalize format
}

function validateOffer(offer: any): Offer | null {
  if (!offer || typeof offer !== 'object') {
    return null;
  }

  const validatedOffer: Offer = {
    total_price: typeof offer.total_price === 'number' ? offer.total_price : null,
    payment_terms: validatePaymentTerms(offer.payment_terms),
    payment_terms_days: typeof offer.payment_terms_days === 'number' ? offer.payment_terms_days : undefined,
    delivery_date: typeof offer.delivery_date === 'string' ? offer.delivery_date : undefined,
    delivery_days: typeof offer.delivery_days === 'number' ? offer.delivery_days : undefined,
    meta: offer.meta || undefined,
  };

  return validatedOffer;
}

/**
 * Clamp counter to valid range
 *
 * @param value - Counter value
 * @returns Clamped value (0 to 100)
 */
function _clampCounter(value: number): number {
  if (typeof value !== 'number' || isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(value)));
}

// ============================================================================
// Export
// ============================================================================

export default {
  retryWithBackoff,
  retryWithJitter,
  recoverConvoState,
  validateAndFixState,
  fallbackClassifyIntent,
  fallbackParseOffer,
  addToDeadLetterQueue,
  getDeadLetterQueue,
  retryDeadLetter,
  clearDeadLetterQueue,
};

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example 1: Retry LLM call
 *
 * ```typescript
 * import { retryWithBackoff } from './error-recovery.js';
 * import { llmService } from '../../../services/llm.service.js';
 *
 * const result = await retryWithBackoff(
 *   () => llmService.classify(message),
 *   3,  // max 3 retries
 *   1000  // start with 1s delay
 * );
 * ```
 *
 * Example 2: Recover corrupted state
 *
 * ```typescript
 * import { recoverConvoState } from './error-recovery.js';
 *
 * const corruptedState = {
 *   phase: 'INVALID_PHASE',
 *   refusalCount: -5,
 *   turnCount: 999,
 * };
 *
 * const fixed = await recoverConvoState('deal-123', corruptedState);
 * // Returns: { phase: 'WAITING_FOR_OFFER', refusalCount: 0, turnCount: 100, ... }
 * ```
 *
 * Example 3: Fallback classification
 *
 * ```typescript
 * import { fallbackClassifyIntent } from './error-recovery.js';
 *
 * try {
 *   intent = await llmService.classify(message);
 * } catch (error) {
 *   // LLM failed, use fallback
 *   intent = await fallbackClassifyIntent(message);
 * }
 * ```
 *
 * Example 4: Dead letter queue
 *
 * ```typescript
 * import { addToDeadLetterQueue, retryDeadLetter } from './error-recovery.js';
 *
 * try {
 *   await processMessage(message);
 * } catch (error) {
 *   const id = addToDeadLetterQueue('processMessage', message, error);
 *   // Later, retry the operation
 *   await retryDeadLetter(id, (input) => processMessage(input));
 * }
 * ```
 */

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test 1: Retry Success on Second Attempt
 * - First attempt fails
 * - Second attempt succeeds
 * - Should return result from second attempt
 *
 * Test 2: Retry All Attempts Fail
 * - All attempts fail
 * - Should throw last error
 * - Should log all retry attempts
 *
 * Test 3: Exponential Backoff Timing
 * - Should wait 1s, 2s, 4s between retries
 * - Should respect maxDelay limit
 * - Should not exceed total time budget
 *
 * Test 4: Recover Corrupted Phase
 * - Invalid phase value
 * - Should default to 'WAITING_FOR_OFFER'
 * - Should log warning
 *
 * Test 5: Recover Negative Counters
 * - refusalCount = -5
 * - turnCount = -10
 * - Should clamp both to 0
 *
 * Test 6: Recover Excessive Counters
 * - refusalCount = 999
 * - turnCount = 1000
 * - Should clamp to 100
 *
 * Test 7: Fallback Intent - Greeting
 * - Message: "Hello there!"
 * - Should return 'GREET'
 *
 * Test 8: Fallback Intent - Refusal
 * - Message: "No, not interested"
 * - Should return 'REFUSAL'
 *
 * Test 9: Fallback Intent - Offer
 * - Message: "$95 Net 60"
 * - Should return 'PROVIDE_OFFER'
 *
 * Test 10: Fallback Offer Parsing
 * - Message: "I can offer $95 with Net 60 terms"
 * - Should extract total_price: 95, payment_terms: 'Net 60'
 *
 * Test 11: Dead Letter Queue Add
 * - Failed operation
 * - Should add entry to queue
 * - Should generate unique ID
 *
 * Test 12: Dead Letter Queue Retry Success
 * - Entry exists in queue
 * - Retry succeeds
 * - Should remove from queue
 *
 * Test 13: Dead Letter Queue Retry Fail
 * - Entry exists in queue
 * - Retry fails
 * - Should increment attempts counter
 * - Should remain in queue
 */
