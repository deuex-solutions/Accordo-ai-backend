/**
 * Fallback Templates
 *
 * Humanized, deterministic response templates used when LLM output
 * fails validation or the LLM is unavailable.
 *
 * Rules:
 * - 5+ variations per action type so responses never feel robotic.
 * - Tone-aware variants (formal, casual, urgent, firm, friendly).
 * - All price/terms injected from NegotiationIntent — never hardcoded.
 * - No utility, algorithm, score, threshold or internal system words.
 */

import type { NegotiationIntent, VendorTone } from '../negotiation/intent/build-negotiation-intent.js';

// ─────────────────────────────────────────────
// Template pools by action + tone
// ─────────────────────────────────────────────

type TemplatePool = ((intent: NegotiationIntent) => string)[];

// ACCEPT templates
const ACCEPT_TEMPLATES: Record<VendorTone | 'default', TemplatePool> = {
  formal: [
    (i) => `We are pleased to formally confirm acceptance of your offer. We look forward to moving ahead together.`,
    (i) => `Your proposal has been reviewed and accepted. We appreciate your professionalism throughout this process.`,
    (i) => `We are happy to confirm acceptance of the terms as discussed. We will proceed with the necessary documentation.`,
  ],
  casual: [
    (i) => `We're in — great offer! We'll get the paperwork moving right away.`,
    (i) => `Deal! Really appreciate the flexibility. Let's get this wrapped up.`,
    (i) => `Works for us. Looking forward to getting started together.`,
  ],
  urgent: [
    (i) => `Accepted. Moving quickly on our end to get everything finalized promptly.`,
    (i) => `We're good to go — accepted. We'll expedite our side to meet the timeline.`,
    (i) => `Agreed. We'll prioritize the next steps to keep things on schedule.`,
  ],
  firm: [
    (i) => `We accept the terms as proposed. We appreciate your clear position throughout this discussion.`,
    (i) => `Accepted. The terms meet our requirements and we are ready to proceed.`,
    (i) => `We confirm acceptance. We respect the firmness with which you've approached this and are glad to reach agreement.`,
  ],
  friendly: [
    (i) => `Wonderful — we're happy to accept! It's been a pleasure working through this with you.`,
    (i) => `Great news — we're in! Really looking forward to this partnership.`,
    (i) => `We're delighted to accept. This has been a genuinely collaborative process and we appreciate it.`,
  ],
  default: [
    (i) => `We are pleased to accept your offer and look forward to working together.`,
    (i) => `Your offer has been accepted. We will be in touch to finalize the details.`,
    (i) => `Accepted — thank you for your time and flexibility through this process.`,
    (i) => `We're happy to confirm acceptance. Let's move to next steps.`,
    (i) => `Your proposal meets our requirements and we are ready to proceed.`,
  ],
};

// COUNTER templates
const COUNTER_TEMPLATES: Record<VendorTone | 'default', TemplatePool> = {
  formal: [
    (i) => `Thank you for your proposal. After careful review, we would like to respectfully counter with a total price of ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? `, with ${i.allowedPaymentTerms} payment terms` : ''}${i.allowedDelivery ? `, and delivery ${i.allowedDelivery}` : ''}. We believe these terms represent a fair path forward.`,
    (i) => `We appreciate the offer and wish to propose the following counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()} total${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. We trust this aligns with both parties' objectives.`,
    (i) => `Following our review, we propose ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? ` and delivery by ${i.allowedDelivery}` : ''} as our counter. We remain open to discussion.`,
  ],
  casual: [
    (i) => `Thanks for coming back to us! Here's what we can work with: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()} total${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Think we can make that work?`,
    (i) => `Appreciate the offer — our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, and delivery ${i.allowedDelivery}` : ''}. Let us know what you think!`,
    (i) => `Good to hear from you. We'd like to propose ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Does that work for you?`,
  ],
  urgent: [
    (i) => `Given our timeline, we need to move quickly. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Can we confirm this today?`,
    (i) => `To keep things on track, here's our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` / ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? ` / delivery ${i.allowedDelivery}` : ''}. We'd appreciate a fast turnaround.`,
    (i) => `We're working against a deadline — our offer is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Please let us know as soon as possible.`,
  ],
  firm: [
    (i) => `We have reviewed the offer and our counter stands at ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. This reflects our firm position given current constraints.`,
    (i) => `Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ''}. We have limited flexibility beyond this.`,
    (i) => `After internal review, our position is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` / ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? ` / delivery ${i.allowedDelivery}` : ''}. We hope we can reach agreement on these terms.`,
  ],
  friendly: [
    (i) => `Really appreciate your proposal! We'd love to meet somewhere in the middle — our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. What do you think?`,
    (i) => `Thanks so much for the offer — we're making progress! Our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ''}. Hoping we can find the right fit.`,
    (i) => `We value this partnership and want to find terms that work for everyone. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Happy to discuss further!`,
  ],
  default: [
    (i) => `Thank you for your offer. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()} total${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. We believe this is a fair step forward.`,
    (i) => `We appreciate your proposal. After consideration, we're countering with ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` / ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? ` / ${i.allowedDelivery}` : ''}. Can we find common ground here?`,
    (i) => `I appreciate your offer and want to keep this moving. Our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ''}. Open to your thoughts.`,
    (i) => `Thanks for the proposal — here's our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms} terms` : ''}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ''}. Let's see if we can land on this.`,
    (i) => `We've reviewed your offer carefully. Our counter position is ${i.currencySymbol}${i.allowedPrice?.toLocaleString()}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ''}${i.allowedDelivery ? ` with delivery ${i.allowedDelivery}` : ''}. Looking forward to your response.`,
  ],
};

// WALK_AWAY templates
const WALK_AWAY_TEMPLATES: Record<VendorTone | 'default', TemplatePool> = {
  formal: [
    (i) => `After careful consideration, we regret to inform you that the current terms do not align with our procurement requirements. We appreciate your time and professionalism, and hope to have the opportunity to work together in the future.`,
    (i) => `We have reviewed the offer in detail and, unfortunately, are unable to proceed under the current terms. Thank you for your engagement and the effort you have invested in this process.`,
    (i) => `It is with regret that we must conclude this negotiation. The terms as presented fall outside what we are able to accept. We genuinely appreciate your time and remain open to future opportunities.`,
  ],
  casual: [
    (i) => `We've thought it over and unfortunately this one isn't going to work for us. No hard feelings — we genuinely appreciate the time you've put in.`,
    (i) => `Sorry to say, but we're going to have to pass on this one. The terms just aren't a fit right now, but we wish you the best.`,
    (i) => `We've had a good run at this, but we're not going to be able to make the numbers work. Thanks for bearing with us.`,
  ],
  urgent: [
    (i) => `Given our constraints, we are unable to proceed with the current offer. We need to move in a different direction. Thank you for your time.`,
    (i) => `Unfortunately, the terms don't fit within our current requirements and we need to close this out. We appreciate the effort — thank you.`,
    (i) => `We have to close this negotiation as the terms don't meet our needs. Thank you for your responsiveness throughout.`,
  ],
  firm: [
    (i) => `The terms presented do not meet our requirements and we will not be proceeding. We appreciate the discussion.`,
    (i) => `After thorough review, we cannot move forward with this offer. Thank you for your time.`,
    (i) => `We must conclude this negotiation here. The terms are not workable for us. We thank you for your engagement.`,
  ],
  friendly: [
    (i) => `It's been a pleasure working through this with you, and I genuinely wish we could find a way to make it work. Unfortunately, the terms aren't quite where we need them to be at this time. Let's stay in touch for future opportunities.`,
    (i) => `Thank you so much for your patience and flexibility throughout this process. Sadly, we're not able to proceed on the current terms, but I hope we'll have another chance to work together soon.`,
    (i) => `I've really enjoyed this conversation and I'm sorry we couldn't land on something. The current terms don't fit for us right now, but please do reach out again in the future.`,
  ],
  default: [
    (i) => `Thank you for the time you've invested in this negotiation. Unfortunately, the current terms don't meet our requirements and we are unable to proceed. We wish you well and hope to have the opportunity to work together in the future.`,
    (i) => `We appreciate your offer and your efforts throughout this process. The terms as they stand don't align with what we need, so we'll be concluding the negotiation here. Thank you.`,
    (i) => `After careful consideration, we're not in a position to move forward with this offer. Thank you sincerely for the engagement — we genuinely hope our paths cross again.`,
    (i) => `I appreciate the discussions we've had. Unfortunately, we've reached a point where the terms aren't workable for us and we need to close this negotiation. Thank you for your time.`,
    (i) => `This has been a productive exchange, but we're unable to accept the current terms. We appreciate your time and wish you well.`,
  ],
};

// ESCALATE templates
const ESCALATE_TEMPLATES: Record<VendorTone | 'default', TemplatePool> = {
  formal: [
    (i) => `This matter requires the attention of our senior procurement team. I will escalate accordingly and a colleague will be in contact with you within two business days. Thank you for your patience.`,
    (i) => `Given the complexity of the current terms, I will be referring this to our procurement director for further review. You can expect to hear from them shortly.`,
    (i) => `We appreciate your continued engagement. This negotiation will now be escalated to senior management who will be better placed to address your proposal. Thank you for your understanding.`,
  ],
  casual: [
    (i) => `I need to loop in a colleague on this one — they'll be better placed to take it from here. Expect to hear from them in a couple of days.`,
    (i) => `This needs a senior pair of eyes. I'll get someone on my team to follow up with you shortly.`,
    (i) => `Going to hand this off to someone more senior who can give it the attention it deserves. They'll reach out soon.`,
  ],
  urgent: [
    (i) => `Given the urgency, I'm escalating this immediately to a senior team member. They will follow up with you as quickly as possible.`,
    (i) => `To keep things moving, I'm escalating to my manager right now. They'll be in touch with you very shortly.`,
    (i) => `I'm flagging this urgently to our senior team. Expect a prompt response from a colleague.`,
  ],
  firm: [
    (i) => `This requires senior review. A member of our management team will contact you with our position shortly.`,
    (i) => `We are escalating this negotiation to ensure the right decision is made. You will hear from our team soon.`,
    (i) => `I am referring this to senior management for a final assessment. They will follow up directly.`,
  ],
  friendly: [
    (i) => `I want to make sure you get the best response possible on this, so I'm passing it along to a senior colleague who can give it proper attention. They'll be in touch very soon!`,
    (i) => `You deserve a more thorough look at this than I can provide right now — I'm escalating to someone who can really dig in. They'll reach out shortly!`,
    (i) => `To do this justice, I'm bringing in a senior team member. They'll be in contact with you in the next couple of days. Thanks for your patience!`,
  ],
  default: [
    (i) => `This negotiation requires additional review from our senior procurement team. A colleague will follow up with you within two business days. Thank you for your patience and continued engagement.`,
    (i) => `To give this the proper attention it deserves, I'm escalating to a senior member of our team. They will reach out to you shortly to continue the discussion.`,
    (i) => `We want to make sure we get this right, so I'll be passing this along to our procurement manager for review. Expect to hear back within 48 hours.`,
    (i) => `This requires a higher level of review on our side. A senior colleague will be in touch with you soon to continue where we left off.`,
    (i) => `I'm involving our senior procurement team to ensure we can address this appropriately. You'll hear from them within two business days.`,
  ],
};

// ASK_CLARIFY templates
const ASK_CLARIFY_TEMPLATES: Record<VendorTone | 'default', TemplatePool> = {
  formal: [
    (i) => `Thank you for your message. To proceed with our evaluation, could you please provide the complete offer including total price and payment terms?`,
    (i) => `We appreciate your response. We would require the full offer details — specifically the total price and payment terms — before we can move forward.`,
  ],
  casual: [
    (i) => `Thanks for that! Just need a couple more details — can you share the total price and payment terms so we can keep things moving?`,
    (i) => `Good to hear from you! Could you fill in the blanks for us — total price and payment terms? Then we're good to go.`,
  ],
  urgent: [
    (i) => `To keep things on track, we need the complete offer — total price and payment terms — as soon as possible.`,
    (i) => `We're working against a deadline. Could you send over the total price and payment terms right away so we can move ahead?`,
  ],
  firm: [
    (i) => `We need the complete offer — including total price and payment terms — before we can respond. Please provide these details.`,
    (i) => `Without the total price and payment terms, we cannot proceed. Please share the complete offer.`,
  ],
  friendly: [
    (i) => `Almost there! Just need the total price and payment terms from you and we'll be able to take the next step.`,
    (i) => `Thanks for reaching out! We'd love to move forward — could you share the total price and your preferred payment terms?`,
  ],
  default: [
    (i) => `Thank you for your message. Could you share the complete offer including total price and payment terms so we can give you a proper response?`,
    (i) => `To move forward, we'll need the full offer details — total price and payment terms. Could you provide those?`,
    (i) => `We'd like to keep this moving. Could you confirm the total price and payment terms for us?`,
    (i) => `Almost ready to respond — we just need your total price and payment terms to complete the picture.`,
    (i) => `Thanks for that context. To evaluate properly, could you share the total price and payment terms as well?`,
  ],
};

// MESO templates (structural — LLM presents the options)
const MESO_TEMPLATES: TemplatePool = [
  (i) => `We've put together a few options that could work well for both of us. Each one reflects slightly different priorities — happy to discuss whichever direction suits you best.`,
  (i) => `To help us find the right fit, we've prepared several alternatives with equivalent overall value. Take a look and let us know which works best for your situation.`,
  (i) => `We want to make this work for you, so we've outlined a few different paths forward. All options are structured to be fair — it just depends on what matters most to you.`,
  (i) => `Here are a few options we've prepared. Each takes a different approach to the terms, so you can choose the one that best fits your needs.`,
  (i) => `We've put some thought into this and come up with a few arrangements that could work. Have a look and let us know what resonates.`,
];

// ─────────────────────────────────────────────
// Template selector
// ─────────────────────────────────────────────

/** Simple deterministic rotation based on current minute to add variety */
function getVariantIndex(pool: TemplatePool): number {
  return new Date().getMinutes() % pool.length;
}

/**
 * Get a humanized fallback response for a given NegotiationIntent.
 * Selects the appropriate template pool by action + tone, then picks a variant.
 */
export function getFallbackResponse(intent: NegotiationIntent): string {
  const tone = intent.vendorTone;

  let pool: TemplatePool;

  switch (intent.action) {
    case 'ACCEPT': {
      const templates = ACCEPT_TEMPLATES[tone] ?? ACCEPT_TEMPLATES['default'];
      pool = templates.length > 0 ? templates : ACCEPT_TEMPLATES['default'];
      break;
    }
    case 'COUNTER': {
      const templates = COUNTER_TEMPLATES[tone] ?? COUNTER_TEMPLATES['default'];
      pool = templates.length > 0 ? templates : COUNTER_TEMPLATES['default'];
      break;
    }
    case 'WALK_AWAY': {
      const templates = WALK_AWAY_TEMPLATES[tone] ?? WALK_AWAY_TEMPLATES['default'];
      pool = templates.length > 0 ? templates : WALK_AWAY_TEMPLATES['default'];
      break;
    }
    case 'ESCALATE': {
      const templates = ESCALATE_TEMPLATES[tone] ?? ESCALATE_TEMPLATES['default'];
      pool = templates.length > 0 ? templates : ESCALATE_TEMPLATES['default'];
      break;
    }
    case 'ASK_CLARIFY': {
      const templates = ASK_CLARIFY_TEMPLATES[tone] ?? ASK_CLARIFY_TEMPLATES['default'];
      pool = templates.length > 0 ? templates : ASK_CLARIFY_TEMPLATES['default'];
      break;
    }
    case 'MESO': {
      pool = MESO_TEMPLATES;
      break;
    }
    default: {
      pool = COUNTER_TEMPLATES['default'];
    }
  }

  const idx = getVariantIndex(pool);
  return pool[idx](intent);
}
