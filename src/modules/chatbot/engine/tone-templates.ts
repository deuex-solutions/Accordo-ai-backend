/**
 * Tone-Aware Response Templates
 *
 * Provides tone-adapted fallback templates for each negotiation action.
 * When the LLM is unavailable or its output fails validation, these
 * templates ensure the vendor always gets a response that matches
 * their communication style.
 *
 * 5 tones × 5 actions = 25 template sets, each with 2-3 variations.
 *
 * @module toneTemplates
 */

import type { VendorTone } from './tone-detector.js';

/**
 * Template context passed to template functions
 */
export interface TemplateContext {
  vendorPrice: string;
  vendorTerms: string;
  vendorDelivery: string;
  counterPrice: string;
  counterTerms: string;
  counterDelivery: string;
  concernAck: string;
  round: number;
  maxRounds: number;
}

/**
 * Pick a random template from an array
 */
function pick(templates: string[]): string {
  return templates[Math.floor(Math.random() * templates.length)];
}

// ────────────────────────────────────────────────────────────────
// ACCEPT templates by tone
// ────────────────────────────────────────────────────────────────

const ACCEPT_TEMPLATES: Record<VendorTone, (ctx: TemplateContext) => string> = {
  formal: (ctx) => pick([
    `We are pleased to formally accept your offer of ${ctx.vendorPrice} total with ${ctx.vendorTerms} payment terms and delivery ${ctx.vendorDelivery}. ${ctx.concernAck || 'We appreciate your professionalism throughout this negotiation.'}`,
    `It is our pleasure to confirm acceptance of your terms: ${ctx.vendorPrice} total, ${ctx.vendorTerms}, delivery ${ctx.vendorDelivery}. ${ctx.concernAck || 'We value the thoroughness of this engagement.'}`,
  ]),

  casual: (ctx) => pick([
    `Deal! ${ctx.vendorPrice} total, ${ctx.vendorTerms}, ${ctx.vendorDelivery}. ${ctx.concernAck || 'Thanks for working this out with us!'}`,
    `Sounds great — ${ctx.vendorPrice} total, ${ctx.vendorTerms}, delivered ${ctx.vendorDelivery}. ${ctx.concernAck || "Let's get the paperwork rolling!"}`,
    `We're in! ${ctx.vendorPrice} total with ${ctx.vendorTerms} and ${ctx.vendorDelivery} delivery. ${ctx.concernAck || 'Looking forward to it!'}`,
  ]),

  firm: (ctx) => pick([
    `Accepted. ${ctx.vendorPrice} total, ${ctx.vendorTerms}, delivery ${ctx.vendorDelivery}. ${ctx.concernAck || 'We appreciate you meeting our requirements.'}`,
    `We accept your terms: ${ctx.vendorPrice} total, ${ctx.vendorTerms}, ${ctx.vendorDelivery}. ${ctx.concernAck || 'This meets our expectations.'}`,
  ]),

  urgent: (ctx) => pick([
    `Confirmed — ${ctx.vendorPrice} total, ${ctx.vendorTerms}, ${ctx.vendorDelivery}. ${ctx.concernAck || "Let's proceed immediately."}`,
    `Accepted. ${ctx.vendorPrice}, ${ctx.vendorTerms}, ${ctx.vendorDelivery}. ${ctx.concernAck || 'We can begin right away.'}`,
  ]),

  friendly: (ctx) => pick([
    `Great news! We're happy to accept: ${ctx.vendorPrice} total, ${ctx.vendorTerms}, delivery ${ctx.vendorDelivery}. ${ctx.concernAck || 'Really appreciate your flexibility!'}`,
    `Wonderful — we have a deal! ${ctx.vendorPrice} total with ${ctx.vendorTerms} and ${ctx.vendorDelivery} delivery. ${ctx.concernAck || 'Looking forward to a great partnership.'}`,
    `Excellent! We accept: ${ctx.vendorPrice} total, ${ctx.vendorTerms}, ${ctx.vendorDelivery}. ${ctx.concernAck || 'Thank you for working with us on this!'}`,
  ]),
};

// ────────────────────────────────────────────────────────────────
// COUNTER templates by tone
// ────────────────────────────────────────────────────────────────

const COUNTER_TEMPLATES: Record<VendorTone, (ctx: TemplateContext) => string> = {
  formal: (ctx) => pick([
    `${ctx.concernAck}Thank you for your proposal. We would like to respectfully counter with ${ctx.counterPrice} total, ${ctx.counterTerms} payment terms, and delivery ${ctx.counterDelivery}. We believe this arrangement would be mutually beneficial.`,
    `${ctx.concernAck}We appreciate your offer of ${ctx.vendorPrice}. After careful consideration, we propose ${ctx.counterPrice} total with ${ctx.counterTerms} and delivery ${ctx.counterDelivery}. We trust this better reflects the scope of the engagement.`,
  ]),

  casual: (ctx) => pick([
    `${ctx.concernAck}Thanks for the offer. How about ${ctx.counterPrice} total, ${ctx.counterTerms}, delivered ${ctx.counterDelivery}? That works better for us.`,
    `${ctx.concernAck}Appreciate the ${ctx.vendorPrice} offer. Can we do ${ctx.counterPrice} total with ${ctx.counterTerms} and ${ctx.counterDelivery} delivery? Let me know.`,
    `${ctx.concernAck}Your offer's noted. We're thinking ${ctx.counterPrice} total, ${ctx.counterTerms}, ${ctx.counterDelivery}. Does that work for you?`,
  ]),

  firm: (ctx) => pick([
    `${ctx.concernAck}We've reviewed your offer carefully. Our position is ${ctx.counterPrice} total with ${ctx.counterTerms} and delivery ${ctx.counterDelivery}. This is what our budget allows.`,
    `${ctx.concernAck}Your proposal is noted. We need to be at ${ctx.counterPrice} total, ${ctx.counterTerms}, ${ctx.counterDelivery}. This reflects our project constraints.`,
  ]),

  urgent: (ctx) => pick([
    `${ctx.concernAck}Understood. Our counter: ${ctx.counterPrice} total, ${ctx.counterTerms}, ${ctx.counterDelivery}. Can we finalize today?`,
    `${ctx.concernAck}Got it. We need ${ctx.counterPrice} total with ${ctx.counterTerms} and ${ctx.counterDelivery} delivery. Let's close this quickly.`,
  ]),

  friendly: (ctx) => pick([
    `${ctx.concernAck}Thank you for your offer! We'd love to propose ${ctx.counterPrice} total with ${ctx.counterTerms} and delivery ${ctx.counterDelivery}. This better aligns with our needs — let us know your thoughts!`,
    `${ctx.concernAck}I appreciate the offer of ${ctx.vendorPrice}. Our counter: ${ctx.counterPrice} total, ${ctx.counterTerms}, ${ctx.counterDelivery}. Hope we can meet in the middle!`,
    `${ctx.concernAck}Thanks for working with us! We're looking at ${ctx.counterPrice} total, ${ctx.counterTerms}, delivered ${ctx.counterDelivery}. What do you think?`,
  ]),
};

// ────────────────────────────────────────────────────────────────
// WALK_AWAY templates by tone
// ────────────────────────────────────────────────────────────────

const WALK_AWAY_TEMPLATES: Record<VendorTone, (ctx: TemplateContext) => string> = {
  formal: (_ctx) => pick([
    `We sincerely appreciate the time and effort invested in this negotiation. Regrettably, we are unable to proceed with the current terms. We hope to explore future opportunities together.`,
    `Thank you for your professionalism throughout these discussions. Unfortunately, we cannot reach an agreement at this time. We remain open to future collaboration.`,
  ]),

  casual: (_ctx) => pick([
    `Thanks for all the back and forth on this. Unfortunately, we can't make the current terms work. Hope we can connect again on something else down the road.`,
    `Appreciate the effort here. The numbers just don't work for us right now. Let's keep in touch for future opportunities though.`,
  ]),

  firm: (_ctx) => pick([
    `We've carefully considered your position. The current terms don't meet our requirements, so we'll need to step back from this negotiation. Thank you for your time.`,
    `After thorough review, we cannot proceed at these terms. We appreciate your directness throughout the process and wish you well.`,
  ]),

  urgent: (_ctx) => pick([
    `Given our constraints, we're unable to move forward with the current offer. Thank you for the discussions, and we hope to reconnect soon.`,
    `Unfortunately we need to close this out — the terms don't align with what we need. Appreciate the quick engagement.`,
  ]),

  friendly: (_ctx) => pick([
    `I want to thank you for your patience and willingness to work with us. Unfortunately, we can't quite make this work with the current terms. I really hope we can work together on something else in the future!`,
    `It's been great discussing this with you, and I appreciate the flexibility you've shown. Sadly, the numbers don't line up for us right now. Let's definitely keep in touch!`,
  ]),
};

// ────────────────────────────────────────────────────────────────
// ESCALATE templates by tone
// ────────────────────────────────────────────────────────────────

const ESCALATE_TEMPLATES: Record<VendorTone, (ctx: TemplateContext) => string> = {
  formal: (_ctx) => pick([
    `Your offer warrants further consideration by our senior team. A colleague will be in touch shortly to continue these discussions.`,
    `We'd like to bring in a senior colleague to give this the attention it deserves. You will hear from us in due course.`,
  ]),

  casual: (_ctx) => pick([
    `Let me bring in a teammate who can help move this forward. Someone will reach out soon!`,
    `I'd like to loop in someone from our team on this. You'll hear from them shortly.`,
  ]),

  firm: (_ctx) => pick([
    `This needs review from our leadership team. A senior colleague will follow up with you directly.`,
    `We're bringing in a decision-maker to review this. Someone will be in touch to continue.`,
  ]),

  urgent: (_ctx) => pick([
    `I'm escalating this to our senior team right away. You'll hear back from them very soon.`,
    `Bringing in a colleague now to expedite this. They'll be in touch shortly.`,
  ]),

  friendly: (_ctx) => pick([
    `I want to make sure this gets the attention it deserves! Let me bring in a colleague who can help. Someone will reach out to you soon.`,
    `Your offer is looking interesting! I'd like a teammate to review this with fresh eyes. They'll be in touch shortly.`,
  ]),
};

// ────────────────────────────────────────────────────────────────
// ASK_CLARIFY templates by tone
// ────────────────────────────────────────────────────────────────

const ASK_CLARIFY_ACKS: Record<VendorTone, string[]> = {
  formal: ['Thank you for that', 'Noted', 'We appreciate the information'],
  casual: ['Got it', 'Thanks for that', 'Cool', 'Perfect'],
  firm: ['Understood', 'Noted', 'Acknowledged'],
  urgent: ['Got it', 'Noted', 'Thanks'],
  friendly: ['Great, thanks!', 'Awesome', 'Thanks for sharing that', 'Perfect'],
};

const ASK_CLARIFY_REQUESTS: Record<VendorTone, Record<string, string[]>> = {
  formal: {
    price: ['Could you kindly confirm the total price?', 'We would appreciate the pricing details.'],
    'payment terms': ['Could you specify your preferred payment terms?', 'We would like to know your payment terms.'],
    'price and payment terms': ['Could you provide both the total price and payment terms?', 'We would appreciate the full pricing and payment details.'],
  },
  casual: {
    price: ['What about the total price?', 'And the pricing?', 'Can you share the price?'],
    'payment terms': ['What about payment terms?', 'How about terms — Net 30, 60?', 'And the payment terms?'],
    'price and payment terms': ['Can you confirm both price and payment terms?', 'What are you thinking for price and terms?'],
  },
  firm: {
    price: ['We need the total price to proceed.', 'Please provide the pricing.'],
    'payment terms': ['We require the payment terms to continue.', 'Please confirm the payment terms.'],
    'price and payment terms': ['We need both price and payment terms to evaluate.', 'Please provide the complete offer details.'],
  },
  urgent: {
    price: ['What total price are we looking at?', 'Need the price to move forward.'],
    'payment terms': ['And the payment terms?', 'Need the terms to proceed.'],
    'price and payment terms': ['Can you send price and terms? We need both to move quickly.', 'Need price and terms ASAP.'],
  },
  friendly: {
    price: ['What about the total price?', 'And the pricing? Would love to get the full picture!'],
    'payment terms': ['How about payment terms?', 'And what works for you on payment terms?'],
    'price and payment terms': ['Can you share both price and payment terms? That way we can give you a proper response!', 'What are you thinking for price and terms?'],
  },
};

/**
 * Get a tone-aware acceptance response
 */
export function getToneAcceptTemplate(ctx: TemplateContext, tone: VendorTone): string {
  return ACCEPT_TEMPLATES[tone](ctx);
}

/**
 * Get a tone-aware counter-offer response
 */
export function getToneCounterTemplate(ctx: TemplateContext, tone: VendorTone): string {
  return COUNTER_TEMPLATES[tone](ctx);
}

/**
 * Get a tone-aware walk-away response
 */
export function getToneWalkAwayTemplate(ctx: TemplateContext, tone: VendorTone): string {
  return WALK_AWAY_TEMPLATES[tone](ctx);
}

/**
 * Get a tone-aware escalation response
 */
export function getToneEscalateTemplate(ctx: TemplateContext, tone: VendorTone): string {
  return ESCALATE_TEMPLATES[tone](ctx);
}

/**
 * Get a tone-aware ask-clarify response
 */
export function getToneAskClarifyTemplate(
  tone: VendorTone,
  provided: string[],
  missing: string[]
): string {
  const acks = ASK_CLARIFY_ACKS[tone];
  const requests = ASK_CLARIFY_REQUESTS[tone];

  // Build acknowledgment
  let acknowledgment = '';
  if (provided.length > 0) {
    acknowledgment = `${pick(acks)} — ${provided.join(' and ')}. `;
  }

  // Build request
  const missingKey = missing.length >= 2 ? 'price and payment terms' : missing[0] || 'price';
  const requestOptions = requests[missingKey] || requests['price'];
  const request = pick(requestOptions);

  return `${acknowledgment}${request}`;
}

/**
 * Get a tone-aware template for any action
 */
export function getToneAwareTemplate(
  action: string,
  ctx: TemplateContext,
  tone: VendorTone,
  options?: { provided?: string[]; missing?: string[] }
): string {
  switch (action) {
    case 'ACCEPT':
      return getToneAcceptTemplate(ctx, tone);
    case 'COUNTER':
      return getToneCounterTemplate(ctx, tone);
    case 'WALK_AWAY':
      return getToneWalkAwayTemplate(ctx, tone);
    case 'ESCALATE':
      return getToneEscalateTemplate(ctx, tone);
    case 'ASK_CLARIFY':
      return getToneAskClarifyTemplate(
        tone,
        options?.provided || [],
        options?.missing || ['price']
      );
    default:
      return getToneCounterTemplate(ctx, tone);
  }
}
