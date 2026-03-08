/**
 * Adaptive Personality Layer
 *
 * Adds human warmth at negotiation milestones while adapting
 * to the vendor's communication style. This layer wraps the
 * decision engine's response with contextual personality.
 *
 * KEY PRINCIPLE: Personality is applied AFTER the decision engine
 * produces its result. It never changes the decision itself.
 *
 * @module personalityLayer
 */

import type { VendorTone } from './toneDetector.js';

/**
 * Milestone types that trigger personality enrichment
 */
export type NegotiationMilestone =
  | 'deal_accepted'        // Deal closed successfully
  | 'long_negotiation'     // 5+ rounds completed
  | 'vendor_walked_away'   // Vendor terminated
  | 'escalated'            // Escalated to human
  | 'first_counter'        // First counter-offer in negotiation
  | 'significant_concession' // Vendor made a large concession
  | 'final_round'          // Last round before maxRounds
  | 'none';                // No milestone

/**
 * Personality enrichment result
 */
export interface PersonalityEnrichment {
  /** The milestone detected */
  milestone: NegotiationMilestone;
  /** Prefix text to prepend to the response (empty if no milestone) */
  prefix: string;
  /** Suffix text to append to the response (empty if no milestone) */
  suffix: string;
}

/**
 * Input for milestone detection
 */
export interface MilestoneDetectionInput {
  action: string;
  round: number;
  maxRounds: number;
  previousUtility?: number;
  currentUtility?: number;
  dealStatus?: string;
}

/**
 * Detect which milestone (if any) applies to this negotiation turn
 */
export function detectMilestone(input: MilestoneDetectionInput): NegotiationMilestone {
  const { action, round, maxRounds, previousUtility, currentUtility } = input;

  if (action === 'ACCEPT') {
    return 'deal_accepted';
  }

  if (action === 'WALK_AWAY') {
    return 'vendor_walked_away';
  }

  if (action === 'ESCALATE') {
    return 'escalated';
  }

  if (round === maxRounds) {
    return 'final_round';
  }

  if (round >= 5 && action === 'COUNTER') {
    return 'long_negotiation';
  }

  if (round === 1 && action === 'COUNTER') {
    return 'first_counter';
  }

  // Significant concession: utility jumped 15%+ from previous round
  if (previousUtility != null && currentUtility != null) {
    const improvement = currentUtility - previousUtility;
    if (improvement >= 0.15) {
      return 'significant_concession';
    }
  }

  return 'none';
}

/**
 * Tone-adapted personality templates.
 *
 * Each milestone has templates grouped by vendor tone.
 * The system matches the vendor's communication style:
 * - formal vendor → formal personality
 * - casual vendor → casual personality
 * - firm vendor → respectful personality
 * - urgent vendor → efficient personality
 * - friendly vendor → warm personality
 */
const PERSONALITY_TEMPLATES: Record<
  Exclude<NegotiationMilestone, 'none'>,
  Record<VendorTone, { prefixes: string[]; suffixes: string[] }>
> = {
  deal_accepted: {
    formal: {
      prefixes: [
        'We are delighted to confirm this agreement.',
        'It is a pleasure to reach this arrangement.',
      ],
      suffixes: [
        'We look forward to a successful partnership.',
        'We value this professional relationship and anticipate fruitful collaboration.',
      ],
    },
    casual: {
      prefixes: [
        'Awesome, we have a deal!',
        'Great, this works perfectly!',
      ],
      suffixes: [
        'Looking forward to working together!',
        "Excited to get this going!",
      ],
    },
    firm: {
      prefixes: [
        'We appreciate your position and are glad we found common ground.',
        'Thank you for your directness — we have reached an agreement.',
      ],
      suffixes: [
        'We respect the way you negotiate and look forward to working together.',
        'This arrangement works well for both sides.',
      ],
    },
    urgent: {
      prefixes: [
        'Done — agreement confirmed.',
        'Confirmed. We are moving forward immediately.',
      ],
      suffixes: [
        "We'll initiate the next steps right away.",
        'Expect the paperwork shortly.',
      ],
    },
    friendly: {
      prefixes: [
        'Wonderful news — we have a deal!',
        'This is a great outcome for both of us!',
      ],
      suffixes: [
        "We truly appreciate the collaborative spirit you've shown.",
        "Here's to a great partnership ahead!",
      ],
    },
  },

  long_negotiation: {
    formal: {
      prefixes: ['We appreciate your continued engagement in these discussions.'],
      suffixes: ['Your patience in this process is valued.'],
    },
    casual: {
      prefixes: ["We've been at this for a while — let's find that sweet spot."],
      suffixes: ["Let's wrap this up with something that works for both of us."],
    },
    firm: {
      prefixes: ['We respect your position and remain committed to finding an agreement.'],
      suffixes: ['We believe a resolution is within reach.'],
    },
    urgent: {
      prefixes: ["Let's aim to close this out."],
      suffixes: ['Time to find the right balance and move forward.'],
    },
    friendly: {
      prefixes: ["We've had a productive discussion so far."],
      suffixes: ["We're confident we can find something that works for everyone."],
    },
  },

  vendor_walked_away: {
    formal: {
      prefixes: ['We regret that we were unable to reach mutually acceptable terms.'],
      suffixes: ['Please do not hesitate to reach out should circumstances change.'],
    },
    casual: {
      prefixes: ["Sorry we couldn't make it work this time."],
      suffixes: ['Hope we can try again in the future.'],
    },
    firm: {
      prefixes: ['We respect your decision.'],
      suffixes: ['Our door remains open should you wish to revisit this.'],
    },
    urgent: {
      prefixes: ['We understand the time constraints made this difficult.'],
      suffixes: ['If your timeline changes, we are ready to resume.'],
    },
    friendly: {
      prefixes: ["It's unfortunate we couldn't find the right fit this time."],
      suffixes: ["We'd love to work together on future opportunities."],
    },
  },

  escalated: {
    formal: {
      prefixes: ['We would like to ensure this receives the appropriate level of attention.'],
      suffixes: [],
    },
    casual: {
      prefixes: ["Let me bring in someone who can help us close this."],
      suffixes: [],
    },
    firm: {
      prefixes: ['We respect the complexity of your position.'],
      suffixes: [],
    },
    urgent: {
      prefixes: ['To move quickly, we are escalating this to a decision-maker.'],
      suffixes: [],
    },
    friendly: {
      prefixes: ['We want to give this the attention it deserves.'],
      suffixes: [],
    },
  },

  first_counter: {
    formal: {
      prefixes: ['Thank you for your initial proposal.'],
      suffixes: [],
    },
    casual: {
      prefixes: ['Thanks for kicking things off!'],
      suffixes: [],
    },
    firm: {
      prefixes: ['We appreciate your opening position.'],
      suffixes: [],
    },
    urgent: {
      prefixes: ['Received your proposal.'],
      suffixes: [],
    },
    friendly: {
      prefixes: ['Great start to our discussion!'],
      suffixes: [],
    },
  },

  significant_concession: {
    formal: {
      prefixes: ['We note and appreciate the significant movement in your proposal.'],
      suffixes: [],
    },
    casual: {
      prefixes: ['That is a big step — we appreciate the flexibility.'],
      suffixes: [],
    },
    firm: {
      prefixes: ['We acknowledge the meaningful adjustment in your offer.'],
      suffixes: [],
    },
    urgent: {
      prefixes: ['Good progress.'],
      suffixes: [],
    },
    friendly: {
      prefixes: ['We really appreciate you working with us on this!'],
      suffixes: [],
    },
  },

  final_round: {
    formal: {
      prefixes: ['As we approach the conclusion of our discussions...'],
      suffixes: ['We hope to finalize terms that work for both parties.'],
    },
    casual: {
      prefixes: ["This is our last shot at making this work."],
      suffixes: ["Let's make it count."],
    },
    firm: {
      prefixes: ['We are at the final stage of our negotiation.'],
      suffixes: ['We trust both sides are committed to finding resolution.'],
    },
    urgent: {
      prefixes: ['Final round.'],
      suffixes: ["Let's close this."],
    },
    friendly: {
      prefixes: ["We're nearing the finish line on this one."],
      suffixes: ["Let's find the right landing spot together."],
    },
  },
};

/**
 * Select a random element from an array
 */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Get personality enrichment for a negotiation turn.
 *
 * Returns prefix/suffix text to wrap around the core response.
 * If no milestone is detected, returns empty strings.
 *
 * @param milestone - The detected milestone
 * @param tone - The vendor's detected tone
 * @returns Prefix and suffix text
 */
export function getPersonalityEnrichment(
  milestone: NegotiationMilestone,
  tone: VendorTone
): PersonalityEnrichment {
  if (milestone === 'none') {
    return { milestone: 'none', prefix: '', suffix: '' };
  }

  const templates = PERSONALITY_TEMPLATES[milestone];
  const toneTemplates = templates[tone] ?? templates['friendly'];

  const prefix = toneTemplates.prefixes.length > 0 ? pick(toneTemplates.prefixes) : '';
  const suffix = toneTemplates.suffixes.length > 0 ? pick(toneTemplates.suffixes) : '';

  return { milestone, prefix, suffix };
}

/**
 * Apply personality enrichment to a response string.
 *
 * Intelligently prepends/appends personality text without
 * creating awkward double-greetings or redundant closings.
 *
 * @param response - The original response from decision engine/LLM
 * @param enrichment - The personality enrichment to apply
 * @returns The enriched response
 */
export function applyPersonality(response: string, enrichment: PersonalityEnrichment): string {
  if (enrichment.milestone === 'none') {
    return response;
  }

  const parts: string[] = [];

  if (enrichment.prefix) {
    parts.push(enrichment.prefix);
  }

  parts.push(response);

  if (enrichment.suffix) {
    parts.push(enrichment.suffix);
  }

  return parts.join(' ');
}
