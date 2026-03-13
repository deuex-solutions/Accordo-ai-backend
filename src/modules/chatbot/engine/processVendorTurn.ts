/**
 * processVendorTurn Module
 *
 * Vendor turn processor for INSIGHTS mode.
 * Orchestrates the complete vendor message processing flow:
 * 1. Parse offer from vendor message
 * 2. Run decision engine
 * 3. Compute explainability
 * 4. Generate Accordo response message
 * 5. Update deal state
 * 6. Save messages to database
 *
 * This module provides a unified entry point for processing vendor turns
 * in INSIGHTS mode, ensuring consistent state management and error handling.
 *
 * @module processVendorTurn
 * @example
 * ```typescript
 * const result = await processVendorTurn({
 *   dealId: 'deal-123',
 *   vendorMessage: 'I can offer $95 with Net 60 terms',
 *   userId: 1
 * });
 * ```
 */

import { parseOfferRegex } from './parseOffer.js';
import { decideNextMove, decideWithWeightedUtility, type WeightedDecision } from './decide.js';
import { computeExplainability, priceUtility, termsUtility, type NegotiationConfig } from './utility.js';
import type { Offer, Decision, Explainability, WizardConfig, ExtendedOffer } from './types.js';
import { sequelize } from '../../../config/database.js';
import logger from '../../../config/logger.js';
import * as negotiationLogger from './negotiationLogger.js';
import { transition, actionToEvent, type DealState } from './negotiationStateMachine.js';

// ============================================================================
// Import Models
// ============================================================================

import models from '../../../models/index.js';
import type { ChatbotDeal } from '../../../models/chatbotDeal.js';
import type { ChatbotMessage } from '../../../models/chatbotMessage.js';
import type { ChatbotTemplate } from '../../../models/chatbotTemplate.js';

// ============================================================================
// Types
// ============================================================================

export interface ProcessVendorTurnInput {
  dealId: string;
  vendorMessage: string;
  userId: number;
}

export interface ProcessVendorTurnResult {
  extractedOffer: Offer | null;
  decision: Decision;
  accordoMessage: ChatbotMessage;
  vendorMessageRecord: ChatbotMessage;
  explainability: Explainability | null;
  updatedDeal: ChatbotDeal;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load negotiation config from deal's stored config or template
 * CRITICAL: Prioritize stored negotiationConfigJson to preserve priority-based thresholds
 */
async function loadNegotiationConfig(deal: ChatbotDeal): Promise<NegotiationConfig> {
  // Priority 1: Use stored negotiation config (includes priority-adjusted thresholds and weights)
  if (deal.negotiationConfigJson) {
    const storedConfig = deal.negotiationConfigJson as NegotiationConfig & { wizardConfig?: unknown };
    return {
      parameters: storedConfig.parameters,
      accept_threshold: storedConfig.accept_threshold,
      escalate_threshold: storedConfig.escalate_threshold,
      walkaway_threshold: storedConfig.walkaway_threshold,
      max_rounds: storedConfig.max_rounds,
      priority: storedConfig.priority,
    };
  }

  // Priority 2: Fallback to template config (for legacy deals)
  if (!deal.templateId) {
    throw new Error('Deal has no negotiation config or template configured');
  }

  const template = await models.ChatbotTemplate.findByPk(deal.templateId);
  if (!template) {
    throw new Error(`Template ${deal.templateId} not found`);
  }

  // Template.configJson is already parsed by Sequelize (JSON column)
  return template.configJson as unknown as NegotiationConfig;
}

/**
 * Generate Accordo response message based on decision
 */
function generateAccordoResponse(decision: Decision, round: number): string {
  const { action, counterOffer, reasons } = decision;

  switch (action) {
    case 'ACCEPT':
      return `Great! I accept your offer. Let's finalize the agreement.`;

    case 'COUNTER':
      if (!counterOffer || !counterOffer.total_price || !counterOffer.payment_terms) {
        return `I'd like to discuss this further. Can we explore other options?`;
      }
      return `Thank you for your offer. I'd like to propose a counter-offer: $${counterOffer.total_price.toFixed(
        2
      )} per unit with ${counterOffer.payment_terms} payment terms. Does this work for you?`;

    case 'WALK_AWAY':
      return `I appreciate your time, but unfortunately your offer exceeds our budget constraints. We'll need to explore other options.`;

    case 'ESCALATE':
      return `We've reached the maximum number of negotiation rounds. I'll need to escalate this to my team for further review.`;

    case 'ASK_CLARIFY':
      return `I'd like to clarify your offer. Could you please provide both the unit price and payment terms explicitly?`;

    default:
      return `I've received your message. Let me review and get back to you.`;
  }
}

/**
 * Determine new deal status based on decision action using the state machine
 */
function getDealStatus(action: Decision['action'], currentStatus?: string): 'NEGOTIATING' | 'ACCEPTED' | 'WALKED_AWAY' | 'ESCALATED' {
  const currentState = (currentStatus || 'NEGOTIATING') as DealState;
  const event = actionToEvent(action);
  const result = transition(currentState, event);
  return result.newState;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Process a vendor turn in INSIGHTS mode
 *
 * This function orchestrates the entire vendor turn processing flow:
 * 1. Load deal and config
 * 2. Parse vendor offer
 * 3. Run decision engine
 * 4. Compute explainability
 * 5. Generate response
 * 6. Update deal state
 * 7. Save messages
 *
 * All operations are wrapped in a database transaction for atomicity.
 *
 * @param input - Vendor turn input parameters
 * @returns Complete processing result
 * @throws Error if deal not found, config missing, or database error
 */
export async function processVendorTurn(
  input: ProcessVendorTurnInput
): Promise<ProcessVendorTurnResult> {
  const { dealId, vendorMessage, userId } = input;

  // Start database transaction
  const transaction = await sequelize.transaction();

  try {
    // ============================================================================
    // 1. Load Deal and Config
    // ============================================================================

    logger.info(`Processing vendor turn for deal ${dealId}`);

    const deal = await models.ChatbotDeal.findByPk(dealId, { transaction });
    if (!deal) {
      throw new Error(`Deal ${dealId} not found`);
    }

    if (deal.mode !== 'INSIGHTS') {
      throw new Error(
        `Deal ${dealId} is in ${deal.mode} mode. processVendorTurn only works for INSIGHTS mode.`
      );
    }

    if (deal.status !== 'NEGOTIATING') {
      throw new Error(
        `Deal ${dealId} is in ${deal.status} status. Cannot process new messages.`
      );
    }

    const config = await loadNegotiationConfig(deal);
    const currentRound = deal.round + 1; // Increment round

    // ============================================================================
    // ENHANCED LOGGING: Round Start
    // ============================================================================
    negotiationLogger.logRoundStart(dealId, currentRound, config.max_rounds);
    negotiationLogger.logConfigThresholds(config, config.priority || 'MEDIUM');

    // ============================================================================
    // 2. Parse Vendor Offer
    // ============================================================================

    logger.info(`Parsing vendor message: "${vendorMessage}"`);
    const extractedOffer = parseOfferRegex(vendorMessage);

    // ENHANCED LOGGING: Vendor Offer
    negotiationLogger.logVendorOffer(vendorMessage, extractedOffer);

    logger.info(`Extracted offer:`, {
      total_price: extractedOffer.total_price,
      payment_terms: extractedOffer.payment_terms,
      meta: extractedOffer.meta,
    });

    // ============================================================================
    // 3. Run Decision Engine
    // ============================================================================

    logger.info(`Running decision engine (round ${currentRound})`);

    // Calculate individual utilities for logging
    const pUtility = extractedOffer.total_price !== null
      ? priceUtility(config, extractedOffer.total_price)
      : 0;
    const tUtility = extractedOffer.payment_terms !== null
      ? termsUtility(config, extractedOffer.payment_terms)
      : 0;
    const priceWeight = (config.parameters?.total_price ?? (config.parameters as any)?.unit_price)?.weight ?? 0.6;
    const termsWeight = config.parameters?.payment_terms?.weight ?? 0.4;
    const totalUtil = pUtility * priceWeight + tUtility * termsWeight;

    // ENHANCED LOGGING: Utility Calculation
    negotiationLogger.logUtilityCalculation(pUtility, tUtility, totalUtil, config);

    const decision = decideNextMove(config, extractedOffer, currentRound);

    // ENHANCED LOGGING: Decision
    negotiationLogger.logDecision(decision, currentRound);

    logger.info(`Decision:`, {
      action: decision.action,
      utilityScore: decision.utilityScore,
      counterOffer: decision.counterOffer,
      reasons: decision.reasons,
    });

    // ============================================================================
    // 4. Compute Explainability
    // ============================================================================

    let explainability: Explainability | null = null;

    if (extractedOffer.total_price !== null && extractedOffer.payment_terms !== null) {
      explainability = computeExplainability(config, extractedOffer, decision);
      logger.info(`Computed explainability:`, {
        total_utility: explainability.utilities.total,
        price_utility: explainability.utilities.priceUtility,
        terms_utility: explainability.utilities.termsUtility,
      });
    } else {
      logger.warn(`Cannot compute explainability: incomplete offer`);
    }

    // ============================================================================
    // 5. Generate Accordo Response
    // ============================================================================

    const accordoContent = generateAccordoResponse(decision, currentRound);
    logger.info(`Generated Accordo response: "${accordoContent}"`);

    // ============================================================================
    // 6. Save Messages to Database
    // ============================================================================

    // Create vendor message record
    const vendorMessageRecord = await models.ChatbotMessage.create(
      {
        dealId: deal.id,
        role: 'VENDOR',
        content: vendorMessage,
        extractedOffer:
          extractedOffer.total_price !== null || extractedOffer.payment_terms !== null
            ? (extractedOffer as any)
            : null,
        engineDecision: null, // Vendor messages don't have engine decisions
        decisionAction: null,
        utilityScore: null,
        counterOffer: null,
        explainabilityJson: null,
      },
      { transaction }
    );

    // Create Accordo response message record
    const accordoMessageRecord = await models.ChatbotMessage.create(
      {
        dealId: deal.id,
        role: 'ACCORDO',
        content: accordoContent,
        extractedOffer: null, // Accordo messages don't extract offers
        engineDecision: decision as any,
        decisionAction: decision.action,
        utilityScore: decision.utilityScore ?? null,
        counterOffer: decision.counterOffer as any,
        explainabilityJson: explainability as any,
      },
      { transaction }
    );

    // ============================================================================
    // 7. Update Deal State
    // ============================================================================

    const newStatus = getDealStatus(decision.action, deal.status);
    const newRound = currentRound;

    await deal.update(
      {
        round: newRound,
        status: newStatus,
        latestOfferJson: extractedOffer,
        latestVendorOffer: extractedOffer,
        latestDecisionAction: decision.action,
        latestUtility: decision.utilityScore ?? null,
        lastMessageAt: new Date(),
      },
      { transaction }
    );

    logger.info(`Updated deal state:`, {
      round: newRound,
      status: newStatus,
      latestDecisionAction: decision.action,
    });

    // ============================================================================
    // ENHANCED LOGGING: Round Summary
    // ============================================================================
    negotiationLogger.logRoundSummary(
      newRound,
      extractedOffer.total_price,
      decision.counterOffer?.total_price ?? null,
      decision.utilityScore,
      decision.action,
      newStatus
    );

    // Log final status if deal is complete
    if (newStatus !== 'NEGOTIATING') {
      negotiationLogger.logDealStatus(newStatus, decision.reasons[0] || 'Deal concluded');
    }

    negotiationLogger.logSeparator();

    // ============================================================================
    // 8. Commit Transaction
    // ============================================================================

    await transaction.commit();

    logger.info(`Successfully processed vendor turn for deal ${dealId}`);

    // ============================================================================
    // 9. Return Result
    // ============================================================================

    return {
      extractedOffer,
      decision,
      accordoMessage: accordoMessageRecord,
      vendorMessageRecord,
      explainability,
      updatedDeal: deal,
    };
  } catch (error) {
    // Rollback transaction on error
    await transaction.rollback();

    logger.error(`Failed to process vendor turn for deal ${dealId}:`, error);
    throw error;
  }
}

export default processVendorTurn;

// ============================================================================
// Example Usage
// ============================================================================

/**
 * Example 1: Basic vendor turn processing
 *
 * ```typescript
 * const result = await processVendorTurn({
 *   dealId: 'deal-123',
 *   vendorMessage: 'I can offer $95 with Net 60 terms',
 *   userId: 1
 * });
 *
 * console.log('Decision:', result.decision.action);
 * console.log('Accordo Response:', result.accordoMessage.content);
 * ```
 *
 * Example 2: Handle different decision types
 *
 * ```typescript
 * const result = await processVendorTurn({
 *   dealId: 'deal-456',
 *   vendorMessage: '$120 per unit, Net 30',
 *   userId: 2
 * });
 *
 * if (result.decision.action === 'WALK_AWAY') {
 *   console.log('Price too high, walking away');
 * } else if (result.decision.action === 'COUNTER') {
 *   console.log('Counter offer:', result.decision.counterOffer);
 * }
 * ```
 *
 * Example 3: Access explainability data
 *
 * ```typescript
 * const result = await processVendorTurn({
 *   dealId: 'deal-789',
 *   vendorMessage: '$90 Net 90',
 *   userId: 3
 * });
 *
 * if (result.explainability) {
 *   console.log('Total Utility:', result.explainability.utilities.total);
 *   console.log('Price Utility:', result.explainability.utilities.priceUtility);
 *   console.log('Terms Utility:', result.explainability.utilities.termsUtility);
 * }
 * ```
 *
 * Example 4: Error handling
 *
 * ```typescript
 * try {
 *   const result = await processVendorTurn({
 *     dealId: 'invalid-deal',
 *     vendorMessage: 'Test message',
 *     userId: 4
 *   });
 * } catch (error) {
 *   if (error.message.includes('not found')) {
 *     console.error('Deal does not exist');
 *   } else if (error.message.includes('mode')) {
 *     console.error('Wrong deal mode');
 *   } else {
 *     console.error('Unexpected error:', error);
 *   }
 * }
 * ```
 */

// ============================================================================
// Test Cases
// ============================================================================

/**
 * Test 1: Parse Valid Offer
 * - Should extract price and terms correctly
 * - Should run decision engine
 * - Should generate appropriate response
 *
 * Test 2: Parse Incomplete Offer (Missing Terms)
 * - Should extract price only
 * - Decision should be ASK_CLARIFY
 * - Response should request complete offer
 *
 * Test 3: Parse Incomplete Offer (Missing Price)
 * - Should extract terms only
 * - Decision should be ASK_CLARIFY
 * - Response should request complete offer
 *
 * Test 4: Accept Decision
 * - Offer meets accept threshold
 * - Decision should be ACCEPT
 * - Deal status should be ACCEPTED
 * - Response should confirm acceptance
 *
 * Test 5: Counter Decision
 * - Offer below accept threshold
 * - Decision should be COUNTER with counter-offer
 * - Deal status should remain NEGOTIATING
 * - Response should propose counter-offer
 *
 * Test 6: Walk Away Decision
 * - Price exceeds max acceptable
 * - Decision should be WALK_AWAY
 * - Deal status should be WALKED_AWAY
 * - Response should politely decline
 *
 * Test 7: Escalate Decision
 * - Round exceeds max_rounds
 * - Decision should be ESCALATE
 * - Deal status should be ESCALATED
 * - Response should mention escalation
 *
 * Test 8: Explainability Computation
 * - Should compute utilities correctly
 * - Should include config snapshot
 * - Should be null for incomplete offers
 *
 * Test 9: Database Transaction Rollback
 * - Simulate error during message save
 * - Transaction should rollback
 * - Deal state should remain unchanged
 * - No messages should be saved
 *
 * Test 10: Round Increment
 * - Deal round should increment by 1
 * - Decision should use new round number
 * - Round should persist in database
 *
 * Test 11: Invalid Deal Mode
 * - Deal in CONVERSATION mode
 * - Should throw error
 * - Transaction should rollback
 *
 * Test 12: Invalid Deal Status
 * - Deal in ACCEPTED status
 * - Should throw error
 * - Transaction should rollback
 *
 * Test 13: Missing Template
 * - Deal has no templateId
 * - Should throw error
 * - Transaction should rollback
 */
