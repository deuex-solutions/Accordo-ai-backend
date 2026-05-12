/**
 * Fallback Templates
 *
 * Humanized, deterministic response templates used when LLM output
 * fails validation or the LLM is unavailable.
 *
 * Rules:
 * - 5+ variations per action type so responses never feel robotic.
 * - Tone-aware variants (formal, casual, urgent, firm, friendly).
 * - All price/terms injected from NegotiationIntent, never hardcoded.
 * - No utility, algorithm, score, threshold or internal system words.
 */

import type {
  NegotiationIntent,
  VendorTone,
} from "../negotiation/intent/build-negotiation-intent.js";
import { buildFingerprint } from "./phrasing-history.js";
import { sanitizeText } from "./validate-llm-output.js";

// ─────────────────────────────────────────────
// Template pools by action + tone
// ─────────────────────────────────────────────

type TemplatePool = ((intent: NegotiationIntent) => string)[];

// ACCEPT templates
const ACCEPT_TEMPLATES: Record<VendorTone | "default", TemplatePool> = {
  formal: [
    (_i) =>
      `We are pleased to formally confirm acceptance of your offer. We look forward to moving ahead together.`,
    (_i) =>
      `Your proposal has been reviewed and accepted. We appreciate your professionalism throughout this process.`,
    (_i) =>
      `We are happy to confirm acceptance of the terms as discussed. We will proceed with the necessary documentation.`,
  ],
  casual: [
    (_i) => `We're in, great offer! We'll get the paperwork moving right away.`,
    (_i) =>
      `Deal! Really appreciate the flexibility. Let's get this wrapped up.`,
    (_i) => `Works for us. Looking forward to getting started together.`,
  ],
  urgent: [
    (_i) =>
      `Accepted. Moving quickly on our end to get everything finalized promptly.`,
    (_i) =>
      `We're good to go, accepted. We'll expedite our side to meet the timeline.`,
    (_i) =>
      `Agreed. We'll prioritize the next steps to keep things on schedule.`,
  ],
  firm: [
    (_i) =>
      `We accept the terms as proposed. We appreciate your clear position throughout this discussion.`,
    (_i) =>
      `Accepted. The terms meet our requirements and we are ready to proceed.`,
    (_i) =>
      `We confirm acceptance. We respect the firmness with which you've approached this and are glad to reach agreement.`,
  ],
  friendly: [
    (_i) =>
      `Wonderful, we're happy to accept! It's been a pleasure working through this with you.`,
    (_i) => `Great news, we're in! Really looking forward to this partnership.`,
    (_i) =>
      `We're delighted to accept. This has been a genuinely collaborative process and we appreciate it.`,
  ],
  default: [
    (_i) =>
      `We are pleased to accept your offer and look forward to working together.`,
    (_i) =>
      `Your offer has been accepted. We will be in touch to finalize the details.`,
    (_i) =>
      `Accepted, thank you for your time and flexibility through this process.`,
    (_i) => `We're happy to confirm acceptance. Let's move to next steps.`,
    (_i) => `Your proposal meets our requirements and we are ready to proceed.`,
  ],
};

// COUNTER templates — 7 per tone for sufficient variety across multi-round negotiations
const COUNTER_TEMPLATES: Record<VendorTone | "default", TemplatePool> = {
  formal: [
    (i) => `Thank you for the proposal. We'd like to counter at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We think this is a fair position for both sides.`,
    (i) => `We appreciate the offer. On our end, we're at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Hoping we can find common ground here.`,
    (i) => `Noted, thank you. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We're open to continuing the discussion.`,
    (i) => `We've reviewed the numbers and our position is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We think this works well given the scope.`,
    (i) => `Thank you for the detailed offer. We're proposing ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms} terms` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Looking forward to your thoughts.`,
    (i) => `We appreciate the time on this. Our counter stands at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We think these terms are workable.`,
    (i) => `Good to have the updated numbers. We're looking at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Let us know how that sits with you.`,
  ],
  casual: [
    (i) => `Thanks for coming back to us. Here's what we can work with: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")} total${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Think we can make that work?`,
    (i) => `Appreciate the offer, our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, and delivery ${i.allowedDelivery}` : ""}. Let us know what you think.`,
    (i) => `Good to hear from you. We're looking at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Does that work on your end?`,
    (i) => `Thanks for that. On our side, we're at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Hoping we can land somewhere close to this.`,
    (i) => `Noted, thanks. We can do ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ""}. Let me know if that's in the right ballpark.`,
    (i) => `Alright, here's where we are: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")} total${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms} terms` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Think there's room to meet here?`,
    (i) => `Got it. From our end, ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""} is where we need to be. Can we work with that?`,
  ],
  urgent: [
    (i) => `Given our timeline, we need to move quickly. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Can we confirm this today?`,
    (i) => `To keep things on track, here's our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` / ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? ` / delivery ${i.allowedDelivery}` : ""}. We'd appreciate a fast turnaround.`,
    (i) => `We're working against a deadline. Our offer is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Please let us know as soon as possible.`,
    (i) => `Time-sensitive on our end. We're at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Need a response by end of day if possible.`,
    (i) => `Hoping to wrap this up quickly: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Our team needs an answer to proceed with scheduling.`,
    (i) => `We're pressed for time, so being direct: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ""}. Can you confirm?`,
    (i) => `Need to move this along. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Hoping for a quick resolution.`,
  ],
  firm: [
    (i) => `We have reviewed the offer and our counter stands at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. This reflects our firm position given current constraints.`,
    (i) => `Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ""}. We have limited flexibility beyond this.`,
    (i) => `After internal review, our position is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` / ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? ` / delivery ${i.allowedDelivery}` : ""}. We hope we can reach agreement on these terms.`,
    (i) => `To be direct: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""} is where we are. This is based on firm budget constraints.`,
    (i) => `We're holding at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We've reviewed internally and this is our best position.`,
    (i) => `Our counter remains ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. The budget on this one is tight and we don't have much room.`,
    (i) => `${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. That's our position. We're constrained on this and can't go higher.`,
  ],
  friendly: [
    (i) => `Really appreciate your proposal. We think there's a fair middle ground here, our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. What do you think?`,
    (i) => `Thanks so much for the offer, we're making progress. Our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ""}. Hoping we can find the right fit.`,
    (i) => `We value this partnership and want to find terms that work for everyone. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Happy to discuss further.`,
    (i) => `This is going well. From our end, ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""} feels fair for both sides. Thoughts?`,
    (i) => `Appreciate you working through this with us. We're at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Think we're getting close.`,
    (i) => `Thanks for the flexibility so far. Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms} terms` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. We're optimistic we can land this.`,
    (i) => `Good progress. We can work with ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Looking forward to wrapping this up together.`,
  ],
  default: [
    (i) => `Our counter is ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Think we can work with that?`,
    (i) => `We're at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Let us know what you think.`,
    (i) => `Here's where we are: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Can we make this work?`,
    (i) => `Noted. We can do ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms} terms` : ""}${i.allowedDelivery ? `, ${i.allowedDelivery} delivery` : ""}. Does that land for you?`,
    (i) => `Thanks. Our counter: ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` with ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Let's see if we can close on this.`,
    (i) => `Got it. From our side, ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? `, ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. Hoping we can land here.`,
    (i) => `Appreciate the offer. We're looking at ${i.currencySymbol}${i.allowedPrice?.toLocaleString("en-US")}${i.allowedPaymentTerms ? ` on ${i.allowedPaymentTerms}` : ""}${i.allowedDelivery ? `, delivery ${i.allowedDelivery}` : ""}. What do you think?`,
  ],
};

// WALK_AWAY templates
const WALK_AWAY_TEMPLATES: Record<VendorTone | "default", TemplatePool> = {
  formal: [
    (_i) =>
      `After careful consideration, we regret to inform you that the current terms do not align with our procurement requirements. We appreciate your time and professionalism, and hope to have the opportunity to work together in the future.`,
    (_i) =>
      `We have reviewed the offer in detail and, unfortunately, are unable to proceed under the current terms. Thank you for your engagement and the effort you have invested in this process.`,
    (_i) =>
      `It is with regret that we must conclude this negotiation. The terms as presented fall outside what we are able to accept. We genuinely appreciate your time and remain open to future opportunities.`,
  ],
  casual: [
    (_i) =>
      `We've thought it over and unfortunately this one isn't going to work for us. No hard feelings, we genuinely appreciate the time you've put in.`,
    (_i) =>
      `Sorry to say, but we're going to have to pass on this one. The terms just aren't a fit right now, but we wish you the best.`,
    (_i) =>
      `We've had a good run at this, but we're not going to be able to make the numbers work. Thanks for bearing with us.`,
  ],
  urgent: [
    (_i) =>
      `Given our constraints, we are unable to proceed with the current offer. We need to move in a different direction. Thank you for your time.`,
    (_i) =>
      `Unfortunately, the terms don't fit within our current requirements and we need to close this out. We appreciate the effort, thank you.`,
    (_i) =>
      `We have to close this negotiation as the terms don't meet our needs. Thank you for your responsiveness throughout.`,
  ],
  firm: [
    (_i) =>
      `The terms presented do not meet our requirements and we will not be proceeding. We appreciate the discussion.`,
    (_i) =>
      `After thorough review, we cannot move forward with this offer. Thank you for your time.`,
    (_i) =>
      `We must conclude this negotiation here. The terms are not workable for us. We thank you for your engagement.`,
  ],
  friendly: [
    (_i) =>
      `It's been a pleasure working through this with you, and I genuinely wish we could find a way to make it work. Unfortunately, the terms aren't quite where we need them to be at this time. Let's stay in touch for future opportunities.`,
    (_i) =>
      `Thank you so much for your patience and flexibility throughout this process. Sadly, we're not able to proceed on the current terms, but I hope we'll have another chance to work together soon.`,
    (_i) =>
      `I've really enjoyed this conversation and I'm sorry we couldn't land on something. The current terms don't fit for us right now, but please do reach out again in the future.`,
  ],
  default: [
    (_i) =>
      `Thank you for the time you've invested in this negotiation. Unfortunately, the current terms don't meet our requirements and we are unable to proceed. We wish you well and hope to have the opportunity to work together in the future.`,
    (_i) =>
      `We appreciate your offer and your efforts throughout this process. The terms as they stand don't align with what we need, so we'll be concluding the negotiation here. Thank you.`,
    (_i) =>
      `After careful consideration, we're not in a position to move forward with this offer. Thank you sincerely for the engagement, we genuinely hope our paths cross again.`,
    (_i) =>
      `I appreciate the discussions we've had. Unfortunately, we've reached a point where the terms aren't workable for us and we need to close this negotiation. Thank you for your time.`,
    (_i) =>
      `This has been a productive exchange, but we're unable to accept the current terms. We appreciate your time and wish you well.`,
  ],
};

// ESCALATE templates
const ESCALATE_TEMPLATES: Record<VendorTone | "default", TemplatePool> = {
  formal: [
    (_i) =>
      `This matter requires the attention of our senior procurement team. I will escalate accordingly and a colleague will be in contact with you within two business days. Thank you for your patience.`,
    (_i) =>
      `Given the complexity of the current terms, I will be referring this to our procurement director for further review. You can expect to hear from them shortly.`,
    (_i) =>
      `We appreciate your continued engagement. This negotiation will now be escalated to senior management who will be better placed to address your proposal. Thank you for your understanding.`,
  ],
  casual: [
    (_i) =>
      `I need to loop in a colleague on this one, they'll be better placed to take it from here. Expect to hear from them in a couple of days.`,
    (_i) =>
      `This needs a senior pair of eyes. I'll get someone on my team to follow up with you shortly.`,
    (_i) =>
      `Going to hand this off to someone more senior who can give it the attention it deserves. They'll reach out soon.`,
  ],
  urgent: [
    (_i) =>
      `Given the urgency, I'm escalating this immediately to a senior team member. They will follow up with you as quickly as possible.`,
    (_i) =>
      `To keep things moving, I'm escalating to my manager right now. They'll be in touch with you very shortly.`,
    (_i) =>
      `I'm flagging this urgently to our senior team. Expect a prompt response from a colleague.`,
  ],
  firm: [
    (_i) =>
      `This requires senior review. A member of our management team will contact you with our position shortly.`,
    (_i) =>
      `We are escalating this negotiation to ensure the right decision is made. You will hear from our team soon.`,
    (_i) =>
      `I am referring this to senior management for a final assessment. They will follow up directly.`,
  ],
  friendly: [
    (_i) =>
      `I want to make sure you get the best response possible on this, so I'm passing it along to a senior colleague who can give it proper attention. They'll be in touch very soon!`,
    (_i) =>
      `You deserve a more thorough look at this than I can provide right now, I'm escalating to someone who can really dig in. They'll reach out shortly!`,
    (_i) =>
      `To do this justice, I'm bringing in a senior team member. They'll be in contact with you in the next couple of days. Thanks for your patience!`,
  ],
  default: [
    (_i) =>
      `This negotiation requires additional review from our senior procurement team. A colleague will follow up with you within two business days. Thank you for your patience and continued engagement.`,
    (_i) =>
      `To give this the proper attention it deserves, I'm escalating to a senior member of our team. They will reach out to you shortly to continue the discussion.`,
    (_i) =>
      `We want to make sure we get this right, so I'll be passing this along to our procurement manager for review. Expect to hear back within 48 hours.`,
    (_i) =>
      `This requires a higher level of review on our side. A senior colleague will be in touch with you soon to continue where we left off.`,
    (_i) =>
      `I'm involving our senior procurement team to ensure we can address this appropriately. You'll hear from them within two business days.`,
  ],
};

// ASK_CLARIFY templates
const ASK_CLARIFY_TEMPLATES: Record<VendorTone | "default", TemplatePool> = {
  formal: [
    (_i) =>
      `Thank you for your message. To proceed with our evaluation, could you please provide the complete offer including total price and payment terms?`,
    (_i) =>
      `We appreciate your response. We would require the full offer details, specifically the total price and payment terms, before we can move forward.`,
  ],
  casual: [
    (_i) =>
      `Thanks for that! Just need a couple more details, can you share the total price and payment terms so we can keep things moving?`,
    (_i) =>
      `Good to hear from you! Could you fill in the blanks for us, total price and payment terms? Then we're good to go.`,
  ],
  urgent: [
    (_i) =>
      `To keep things on track, we need the complete offer, total price and payment terms, as soon as possible.`,
    (_i) =>
      `We're working against a deadline. Could you send over the total price and payment terms right away so we can move ahead?`,
  ],
  firm: [
    (_i) => `We need the complete offer, including total price and payment terms, before we can respond. Please provide these details.`,
    (_i) => `Without the total price and payment terms, we cannot proceed. Please share the complete offer.`,
  ],
  friendly: [
    (_i) => `Almost there! Just need the total price and payment terms from you and we'll be able to take the next step.`,
    (_i) =>
      `Thanks for reaching out. We'd like to move forward, could you share the total price and your preferred payment terms?`,
  ],
  default: [
    (_i) =>
      `Thank you for your message. Could you share the complete offer including total price and payment terms so we can give you a proper response?`,
    (_i) =>
      `To move forward, we'll need the full offer details, total price and payment terms. Could you provide those?`,
    (_i) =>
      `We'd like to keep this moving. Could you confirm the total price and payment terms for us?`,
    (_i) =>
      `Almost ready to respond, we just need your total price and payment terms to complete the picture.`,
    (_i) =>
      `Thanks for that context. To evaluate properly, could you share the total price and payment terms as well?`,
  ],
};

// MESO templates (structural, LLM presents the options)
const MESO_TEMPLATES: TemplatePool = [
  (_i) =>
    `We've put together a few options that could work well for both of us. Each one reflects slightly different priorities, happy to discuss whichever direction suits you best.`,
  (_i) => `To help us find the right fit, we've prepared several alternatives with equivalent overall value. Take a look and let us know which works best for your situation.`,
  (_i) => `We want to make this work for you, so we've outlined a few different paths forward. All options are structured to be fair, it just depends on what matters most to you.`,
  (_i) => `Here are a few options we've prepared. Each takes a different approach to the terms, so you can choose the one that best fits your needs.`,
  (_i) => `We've put some thought into this and come up with a few arrangements that could work. Have a look and let us know what resonates.`,
];

// ─────────────────────────────────────────────
// Template selector
// ─────────────────────────────────────────────

/**
 * Pick a variant index. Filters out variants whose first-3-words fingerprint
 * matches the recent phrasing history (so consecutive fallbacks avoid the
 * same opener). Random within remaining candidates.
 */
function pickVariantIndex(
  pool: TemplatePool,
  intent: NegotiationIntent,
  action: string,
): number {
  const history = intent.phrasingHistory ?? [];
  if (history.length === 0 || pool.length === 1) {
    return Math.floor(Math.random() * pool.length);
  }

  const candidates: number[] = [];
  for (let i = 0; i < pool.length; i++) {
    const rendered = pool[i](intent);
    const fingerprint = buildFingerprint(action, rendered);
    if (!history.includes(fingerprint)) candidates.push(i);
  }

  // If every variant has been used, just pick at random rather than blocking.
  const eligible = candidates.length > 0 ? candidates : pool.map((_, i) => i);
  return eligible[Math.floor(Math.random() * eligible.length)];
}

/**
 * Get a humanized fallback response for a given NegotiationIntent.
 * Selects the appropriate template pool by action + tone, then picks a variant.
 */
export function getFallbackResponse(intent: NegotiationIntent): string {
  const tone = intent.vendorTone;

  let pool: TemplatePool;

  switch (intent.action) {
    case "ACCEPT": {
      const templates = ACCEPT_TEMPLATES[tone] ?? ACCEPT_TEMPLATES["default"];
      pool = templates.length > 0 ? templates : ACCEPT_TEMPLATES["default"];
      break;
    }
    case "COUNTER": {
      const templates = COUNTER_TEMPLATES[tone] ?? COUNTER_TEMPLATES["default"];
      pool = templates.length > 0 ? templates : COUNTER_TEMPLATES["default"];
      break;
    }
    case "WALK_AWAY": {
      const templates =
        WALK_AWAY_TEMPLATES[tone] ?? WALK_AWAY_TEMPLATES["default"];
      pool = templates.length > 0 ? templates : WALK_AWAY_TEMPLATES["default"];
      break;
    }
    case "ESCALATE": {
      const templates =
        ESCALATE_TEMPLATES[tone] ?? ESCALATE_TEMPLATES["default"];
      pool = templates.length > 0 ? templates : ESCALATE_TEMPLATES["default"];
      break;
    }
    case "ASK_CLARIFY": {
      const templates =
        ASK_CLARIFY_TEMPLATES[tone] ?? ASK_CLARIFY_TEMPLATES["default"];
      pool =
        templates.length > 0 ? templates : ASK_CLARIFY_TEMPLATES["default"];
      break;
    }
    case "MESO": {
      pool = MESO_TEMPLATES;
      break;
    }
    default: {
      pool = COUNTER_TEMPLATES["default"];
    }
  }

  const idx = pickVariantIndex(pool, intent, intent.action);
  // Apply the same scrubs the validator runs on LLM output: removes
  // exclamation marks, em-dashes, and AI-tell phrases (e.g. "we'd love to")
  // that may exist in the literal templates. Keeps templates readable while
  // ensuring the vendor-facing text is consistent regardless of source.
  return sanitizeText(pool[idx](intent));
}
