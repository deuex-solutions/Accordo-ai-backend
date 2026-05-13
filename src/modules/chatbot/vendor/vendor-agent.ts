/**
 * Vendor Agent - LLM-based Vendor Simulator
 *
 * Generates realistic vendor responses for INSIGHTS mode (demo/testing).
 * Uses LLM to create natural language vendor messages that follow
 * specific negotiation policies and scenarios.
 */

import type { VendorScenario, VendorPolicy, GenerateVendorReplyInput, VendorReplyResult } from './types.js';
import { getScenarioPolicy, mergeVendorPolicy, calculateNextVendorPrice, calculateNextVendorTerms, shouldVendorWalkAway } from './vendor-policy.js';
import { generateChatbotLlamaCompletion } from '../llm/chatbot-llama-client.js';
import { parseOfferRegex } from '../engine/parse-offer.js';
import logger from '../../../config/logger.js';

// Fast fallback timeout - if LLM takes longer than this, use template
const LLM_FAST_TIMEOUT_MS = 5000;  // 5 second hard limit for fast fallback

/**
 * Scenario-specific vendor persona prompts
 */
const VENDOR_PERSONAS: Record<VendorScenario, string> = {
  HARD: `You are a tough, experienced vendor negotiator who is resistant to concessions.
You hold firm on your prices and rarely budge on payment terms.
You make small, reluctant concessions only when absolutely necessary.
Be professional but assertive. Don't give in easily.
Keep responses brief (2-3 sentences).`,

  MEDIUM: `You are a practical, balanced vendor negotiator who is open to fair deals.
You're willing to make moderate concessions on price and payment terms when the buyer shows commitment.
You seek win-win solutions but maintain reasonable boundaries.
Be professional, measured, and business-focused.
Keep responses brief (2-3 sentences).`,

  SOFT: `You are a flexible, collaborative vendor who values long-term relationships.
You're willing to negotiate and find mutually beneficial solutions.
You make reasonable concessions on both price and payment terms.
Be friendly, professional, and open to discussion.
Keep responses brief (2-3 sentences).`,

  WALK_AWAY: `You are a vendor with limited flexibility due to business constraints.
Your prices are firm and you cannot offer extended payment terms.
If the buyer cannot meet your terms, you'll politely decline and end negotiation.
Be polite but clear about your constraints.
Keep responses brief (2-3 sentences).`,
};

/**
 * Generate vendor reply using LLM with policy constraints
 *
 * Algorithm:
 * 1. Calculate next vendor offer based on policy
 * 2. Generate natural language message via LLM
 * 3. Parse generated message to extract offer
 * 4. Validate offer matches policy constraints
 * 5. Return message + extracted offer
 *
 * @param input - Vendor reply generation input
 * @returns Vendor message and extracted offer
 */
export async function generateVendorReply(
  input: GenerateVendorReplyInput
): Promise<VendorReplyResult> {
  const { dealId, round, lastAccordoOffer, scenario = 'SOFT', customPolicy, pmPriceConfig } = input;

  try {
    logger.info('[VendorAgent] Generating vendor reply', {
      dealId,
      round,
      scenario,
      lastAccordoOffer,
      pmPriceConfig,
    });

    // IMPORTANT: Vendor prices should be ABOVE PM's target price
    // Use PM's max acceptable price as the baseline for vendor policy calculations
    // This ensures vendor starts with offers that are competitive but above PM's target
    //
    // From PM's perspective:
    // - targetUnitPrice = lowest price PM wants to pay (ideal)
    // - maxAcceptablePrice = ceiling PM will pay (walkaway above this)
    //
    // From VENDOR's perspective:
    // - Vendor should start ABOVE PM's max (for HARD scenario)
    // - Vendor's floor (minPrice) should be around PM's target to max range
    // - Vendor wants to maximize profit, so starts high and makes concessions
    const basePrice = pmPriceConfig?.maxAcceptablePrice || lastAccordoOffer?.total_price || 100;
    const policy = mergeVendorPolicy(scenario, customPolicy || {}, basePrice);

    // Check if vendor should walk away
    const shouldWalkAway = shouldVendorWalkAway(
      policy,
      round,
      policy.startPrice, // Current vendor price
      lastAccordoOffer?.total_price || null
    );

    if (shouldWalkAway) {
      return {
        success: true,
        message: 'Vendor walked away',
        data: {
          content: "I appreciate your time, but we're unable to proceed with these terms. Thank you for considering our offer.",
          offer: {
            total_price: null,
            payment_terms: null,
          },
          scenario,
        },
      };
    }

    // Calculate next vendor offer based on policy
    const currentPrice = round === 0 ? policy.startPrice : policy.startPrice - (policy.concessionStep * round);
    const nextPrice = calculateNextVendorPrice(
      policy,
      currentPrice,
      round,
      lastAccordoOffer?.total_price || null
    );

    const nextTerms = calculateNextVendorTerms(
      policy,
      policy.preferredTerms,
      (lastAccordoOffer?.payment_terms as 'Net 30' | 'Net 60' | 'Net 90') || null
    );

    logger.info('[VendorAgent] Calculated next vendor offer', {
      dealId,
      nextPrice,
      nextTerms,
      currentPrice,
      policyMinPrice: policy.minPrice,
    });

    // Build prompt for LLM
    const systemPrompt = VENDOR_PERSONAS[scenario];
    const userPrompt = buildVendorPrompt(round, lastAccordoOffer, nextPrice, nextTerms, scenario);

    // Generate vendor message via LLM with fast timeout fallback
    let vendorMessage: string;
    const startTime = Date.now();

    try {
      // Create a timeout promise for fast fallback
      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('LLM_TIMEOUT')), LLM_FAST_TIMEOUT_MS)
      );

      // Race between LLM response and timeout
      vendorMessage = await Promise.race([
        generateChatbotLlamaCompletion(
          systemPrompt,
          [{ role: 'user', content: userPrompt }],
          {
            temperature: 0.6,  // Reduced for faster convergence
            maxTokens: 80,     // Reduced - vendor messages are 2-3 sentences
          }
        ),
        timeoutPromise,
      ]);

      logger.info('[VendorAgent] LLM response received', {
        dealId,
        responseTimeMs: Date.now() - startTime,
      });
    } catch (llmError) {
      // Fallback to template if LLM fails or times out
      const errorMsg = llmError instanceof Error ? llmError.message : String(llmError);
      const isTimeout = errorMsg === 'LLM_TIMEOUT';

      logger.warn('[VendorAgent] LLM generation failed, using fallback template', {
        error: errorMsg,
        isTimeout,
        elapsedMs: Date.now() - startTime,
      });
      vendorMessage = buildFallbackVendorMessage(round, nextPrice, nextTerms, scenario);
    }

    // Parse vendor message to extract offer
    const extractedOffer = parseOfferRegex(vendorMessage);

    // Validate extracted offer matches policy
    // If LLM generated incorrect values, replace with policy-calculated values
    let finalOffer = extractedOffer;
    if (extractedOffer.total_price !== nextPrice || extractedOffer.payment_terms !== nextTerms) {
      logger.warn('[VendorAgent] LLM-generated offer does not match policy, using policy values', {
        extracted: extractedOffer,
        policy: { total_price: nextPrice, payment_terms: nextTerms },
      });

      // Re-generate message with explicit values
      vendorMessage = buildFallbackVendorMessage(round, nextPrice, nextTerms, scenario);
      finalOffer = { total_price: nextPrice, payment_terms: nextTerms };
    }

    logger.info('[VendorAgent] Vendor reply generated successfully', {
      dealId,
      messageLength: vendorMessage.length,
      offer: finalOffer,
    });

    return {
      success: true,
      message: 'Vendor reply generated successfully',
      data: {
        content: vendorMessage,
        offer: finalOffer,
        scenario,
      },
    };
  } catch (error) {
    logger.error('[VendorAgent] Failed to generate vendor reply', {
      dealId,
      round,
      scenario,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: 'Failed to generate vendor reply',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Build prompt for LLM vendor generation
 */
function buildVendorPrompt(
  round: number,
  lastAccordoOffer: { total_price: number | null; payment_terms: string | null } | null,
  nextPrice: number,
  nextTerms: string,
  scenario: VendorScenario
): string {
  if (round === 0) {
    // Initial vendor offer
    return `Make your initial offer to the buyer:
- Your unit price: $${nextPrice}
- Your payment terms: ${nextTerms}

Introduce yourself briefly and present your offer clearly.`;
  }

  // Response to buyer's counter-offer
  const accordoPrice = lastAccordoOffer?.total_price || 'unknown';
  const accordoTerms = lastAccordoOffer?.payment_terms || 'unknown';

  return `The buyer offered: $${accordoPrice} with ${accordoTerms}

Your counter-offer:
- Your unit price: $${nextPrice}
- Your payment terms: ${nextTerms}

Respond to their offer ${scenario === 'HARD' ? 'firmly' : scenario === 'SOFT' ? 'collaboratively' : 'politely but inflexibly'}.
Include your counter-offer in your response.`;
}

/**
 * Fallback vendor message template (when LLM fails)
 */
function buildFallbackVendorMessage(
  round: number,
  price: number,
  terms: string,
  scenario: VendorScenario
): string {
  const templates: Record<VendorScenario, (r: number, p: number, t: string) => string> = {
    HARD: (r, p, t) => {
      if (r === 0) return `Our standard pricing is $${p} with ${t} payment terms. This reflects our quality and market position.`;
      return `We can adjust slightly to $${p} with ${t}, but that's as competitive as we can be.`;
    },
    MEDIUM: (r, p, t) => {
      if (r === 0) return `Thank you for reaching out. We can offer $${p} with ${t} payment terms. We're open to discussion.`;
      return `We've reviewed your request. How about $${p} with ${t}? We can be flexible on some terms.`;
    },
    SOFT: (r, p, t) => {
      if (r === 0) return `Thanks for your interest! We can offer $${p} with ${t} payment terms. Let's work together to find a solution.`;
      return `I appreciate your offer. We can do $${p} with ${t}. How does that sound?`;
    },
    WALK_AWAY: (r, p, t) => {
      if (r === 0) return `Our pricing is $${p} with ${t} payment terms. Unfortunately, we have limited flexibility on these terms.`;
      return `I'm afraid $${p} with ${t} is our final offer. We cannot go lower due to our cost structure.`;
    },
  };

  return templates[scenario](round, price, terms);
}
