/**
 * Dynamic Prompt Addenda
 *
 * Generates contextual instructions appended to LLM prompts based
 * on the current negotiation state. These addenda guide the LLM
 * to produce more situationally appropriate responses.
 *
 * Addenda are composable — multiple can fire at once when conditions
 * overlap (e.g., late round + firm vendor + near walkaway).
 *
 * @module promptAddenda
 */

import type { VendorTone } from './toneDetector.js';

/**
 * Input context for generating addenda
 */
export interface AddendaContext {
  /** Current negotiation round */
  round: number;
  /** Maximum rounds allowed */
  maxRounds: number;
  /** Current utility score (0-1) */
  utilityScore: number;
  /** Decision action */
  action: string;
  /** Detected vendor tone */
  vendorTone: VendorTone;
  /** Whether a stall was detected */
  stallDetected?: boolean;
  /** Number of consecutive counters */
  consecutiveCounters?: number;
  /** Previous vendor action/intent (if known) */
  previousVendorAction?: string;
  /** Deal title for context */
  dealTitle?: string;
  /** Whether the vendor made a concession */
  vendorConceded?: boolean;
  /** Acceptance threshold */
  acceptThreshold?: number;
  /** Walkaway threshold */
  walkawayThreshold?: number;
}

/**
 * A single addendum with its condition and instruction
 */
export interface Addendum {
  /** Unique identifier for the addendum */
  id: string;
  /** Human label for logging */
  label: string;
  /** The instruction text to append to the prompt */
  instruction: string;
}

/**
 * Result of generating addenda
 */
export interface AddendaResult {
  /** The addenda that were triggered */
  addenda: Addendum[];
  /** Combined instruction text (joined by newlines) */
  promptSuffix: string;
}

/**
 * Generate dynamic prompt addenda based on negotiation context.
 *
 * Returns an ordered list of addenda and a combined prompt suffix
 * string ready to append to the LLM system prompt.
 */
export function generatePromptAddenda(ctx: AddendaContext): AddendaResult {
  const addenda: Addendum[] = [];

  // ── Round-based addenda ──────────────────────────────────────

  if (ctx.round === 1) {
    addenda.push({
      id: 'first_round',
      label: 'First round opening',
      instruction: 'This is the first round. Set a collaborative tone — be welcoming but clearly state your position. Do not concede too much upfront.',
    });
  }

  if (ctx.round >= ctx.maxRounds - 1 && ctx.round > 1) {
    addenda.push({
      id: 'final_rounds',
      label: 'Nearing final round',
      instruction: `This is round ${ctx.round} of ${ctx.maxRounds}. Time is running out. Convey urgency and push for resolution. If countering, signal this may be the last opportunity.`,
    });
  }

  if (ctx.round === ctx.maxRounds) {
    addenda.push({
      id: 'last_round',
      label: 'Final round',
      instruction: 'This is the FINAL round. Make your best and final position clear. If accepting, express relief. If walking away, be gracious but definitive.',
    });
  }

  // ── Utility-based addenda ────────────────────────────────────

  const acceptThreshold = ctx.acceptThreshold ?? 0.75;
  const walkawayThreshold = ctx.walkawayThreshold ?? 0.30;

  if (ctx.utilityScore >= acceptThreshold * 0.9 && ctx.action === 'COUNTER') {
    addenda.push({
      id: 'near_accept',
      label: 'Near acceptance threshold',
      instruction: 'The offer is very close to our acceptable range. Be encouraging about progress. Signal willingness to close with minor adjustments.',
    });
  }

  if (ctx.utilityScore <= walkawayThreshold * 1.3 && ctx.action === 'COUNTER') {
    addenda.push({
      id: 'near_walkaway',
      label: 'Near walkaway threshold',
      instruction: 'The offer is far from our target. Express concern about the gap without being confrontational. Emphasize the need for significant movement to continue.',
    });
  }

  // ── Tone-based addenda ───────────────────────────────────────

  if (ctx.vendorTone === 'firm') {
    addenda.push({
      id: 'firm_vendor',
      label: 'Firm vendor detected',
      instruction: 'The vendor is being firm. Avoid being confrontational — acknowledge their position respectfully while maintaining yours. Use collaborative framing.',
    });
  }

  if (ctx.vendorTone === 'urgent') {
    addenda.push({
      id: 'urgent_vendor',
      label: 'Urgent vendor detected',
      instruction: 'The vendor seems pressed for time. Be responsive and efficient in your communication. Acknowledge their timeline while keeping your position.',
    });
  }

  // ── Behavioral addenda ───────────────────────────────────────

  if (ctx.stallDetected) {
    addenda.push({
      id: 'stall_detected',
      label: 'Negotiation stall',
      instruction: 'The negotiation appears stalled. Introduce a creative angle — mention non-price value (delivery speed, payment flexibility) or ask a question that moves the conversation forward.',
    });
  }

  if (ctx.consecutiveCounters && ctx.consecutiveCounters >= 3) {
    addenda.push({
      id: 'counter_fatigue',
      label: 'Counter-offer fatigue',
      instruction: `There have been ${ctx.consecutiveCounters} consecutive counter-offers. Acknowledge the effort both sides have put in. Suggest finding middle ground or exploring alternative terms.`,
    });
  }

  if (ctx.vendorConceded) {
    addenda.push({
      id: 'vendor_conceded',
      label: 'Vendor made concession',
      instruction: 'The vendor has made a concession. Acknowledge their flexibility positively before presenting your response. This reinforces good-faith negotiation.',
    });
  }

  // ── Action-specific addenda ──────────────────────────────────

  if (ctx.action === 'ACCEPT') {
    addenda.push({
      id: 'acceptance_warmth',
      label: 'Acceptance celebration',
      instruction: 'Express genuine warmth and forward-looking optimism. Mention next steps or partnership expectations. Keep the energy positive.',
    });
  }

  if (ctx.action === 'ESCALATE') {
    addenda.push({
      id: 'escalation_reassurance',
      label: 'Escalation reassurance',
      instruction: 'The vendor should feel reassured, not worried. Frame escalation as bringing in someone who can help close the deal, not as a negative signal.',
    });
  }

  if (ctx.action === 'WALK_AWAY') {
    addenda.push({
      id: 'walkaway_grace',
      label: 'Graceful exit',
      instruction: 'End on a graceful note. Express genuine appreciation for their time. Leave the door open for future opportunities. Never blame the vendor.',
    });
  }

  // ── Build combined suffix ────────────────────────────────────

  const promptSuffix = addenda.length > 0
    ? '\n\nADDITIONAL CONTEXT:\n' + addenda.map(a => `- ${a.instruction}`).join('\n')
    : '';

  return { addenda, promptSuffix };
}
