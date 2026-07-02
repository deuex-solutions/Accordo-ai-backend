/**
 * Tests for validateLlmOutput.ts
 *
 * The LLM is untrusted — every response must pass hard validation.
 * Apr 2026 (humanization pass): the validator now uses two-tier banned-word
 * lists (hard-always vs proximity-to-strategy), per-action length floors and
 * ceilings instead of a blanket 160-word cap, and rule-code-only error reasons.
 */

import { describe, it, expect } from "vitest";
import {
  validateLlmOutput,
  ValidationError,
} from "../../../src/llm/validate-llm-output.js";
import type { NegotiationIntent } from "../../../src/negotiation/intent/build-negotiation-intent.js";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeIntent(
  overrides: Partial<NegotiationIntent> = {},
): NegotiationIntent {
  return {
    action: "COUNTER",
    firmness: 0.55,
    commercialPosition: "We are working toward mutually beneficial terms.",
    allowedPrice: 95000,
    allowedPaymentTerms: "Net 30",
    acknowledgeConcerns: [],
    vendorTone: "formal",
    currencySymbol: "$",
    roundNumber: 2,
    ...overrides,
  };
}

function makeAcceptIntent(
  overrides: Partial<NegotiationIntent> = {},
): NegotiationIntent {
  return makeIntent({
    action: "ACCEPT",
    allowedPrice: undefined,
    ...overrides,
  });
}

function makeWalkAwayIntent(): NegotiationIntent {
  return makeIntent({ action: "WALK_AWAY", allowedPrice: undefined });
}

/** Build a COUNTER response that meets the 40-word floor and contains $95,000. */
function counterBody(
  prefix = "Thanks for the proposal. After reviewing the scope and delivery expectations with our team,",
  suffix = "we believe this reflects fair value given the current volume, timeline, and the commercial framework we need to stay within for this quarter.",
): string {
  return `${prefix} our counter is $95,000 with Net 30. ${suffix}`;
}

const WORD_PAD =
  "We appreciate the commercial details shared so far and want to keep this discussion constructive and moving toward a fair close on this order.";

/** Pad text to meet the 40-word PM floor used in production validation. */
function padWords(text: string, min = 40): string {
  let out = text.trim();
  while (out.split(/\s+/).filter(Boolean).length < min) {
    out += ` ${WORD_PAD}`;
  }
  return out;
}

// ─────────────────────────────────────────────
// Empty / null response
// ─────────────────────────────────────────────

describe("validateLlmOutput – empty/null response", () => {
  it("throws ValidationError for empty string", () => {
    expect(() => validateLlmOutput("", makeIntent())).toThrow(ValidationError);
  });

  it("throws ValidationError for whitespace-only string", () => {
    expect(() => validateLlmOutput("   \n\t  ", makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "empty_response" for blank input', () => {
    try {
      validateLlmOutput("", makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe("empty_response");
    }
  });
});

// ─────────────────────────────────────────────
// Hard bans — always reject (AI/system identifiers)
// ─────────────────────────────────────────────

describe("validateLlmOutput – hard always-bans", () => {
  const ALWAYS_BANNED = [
    "utility",
    "algorithm",
    "weighted",
    "batna",
    "decision tree",
    "gpt",
    "openai",
    "ai model",
    "language model",
    "llm",
    "automated system",
  ];

  for (const word of ALWAYS_BANNED) {
    it(`rejects response containing "${word}"`, () => {
      const response = `Our ${word} suggests $95,000 on Net 30 — please confirm whether this works for your team and timeline.`;
      expect(() => validateLlmOutput(response, makeIntent())).toThrow(
        ValidationError,
      );
    });
  }

  it("error reason is banned_keyword_hard", () => {
    try {
      validateLlmOutput(
        counterBody("Our utility shows", "we propose this."),
        makeIntent(),
      );
    } catch (e: any) {
      expect(e.reason).toBe("banned_keyword_hard");
    }
  });
});

// ─────────────────────────────────────────────
// Tier-2 hard bans — context-sensitive (proximity to a price/strategy verb)
// ─────────────────────────────────────────────

describe("validateLlmOutput – tier-2 strategy-leak bans", () => {
  it('rejects "our target is $4500" (target near price)', () => {
    const intent = makeIntent({ allowedPrice: 4500 });
    const response = `Our target is $4,500 on Net 30 because that's the most we can pay for this scope of work without internal review.`;
    expect(() => validateLlmOutput(response, intent)).toThrow(ValidationError);
  });

  it('does NOT reject "what\'s your target delivery date" (target without price)', () => {
    const intent = makeAcceptIntent();
    const response = padWords(
      `Quick question — what's your target delivery date so we can plan accordingly on the procurement and onboarding side?`,
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });

  it('rejects "our score on this is 0.85" (score near number)', () => {
    const response = `Our score on this is 0.85 — counter is $95,000 on Net 30 with delivery in four weeks as previously agreed.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('does NOT reject "engine team" without strategy context', () => {
    const intent = makeAcceptIntent();
    const response = padWords(
      `Thanks — looping in our engine team to confirm spec details, but the commercial side is good to proceed from here.`,
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Length bounds — adaptive per action
// ─────────────────────────────────────────────

describe("validateLlmOutput – per-action length bounds", () => {
  it("rejects COUNTER below 40-word floor", () => {
    const response = `Counter at $95,000 Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "too_short" for under-floor COUNTER', () => {
    try {
      validateLlmOutput("Counter $95,000 Net 30.", makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe("too_short");
    }
  });

  it("rejects COUNTER above 150-word ceiling", () => {
    const tooLong = `${counterBody()} ${"This is a filler word repeated many times. ".repeat(25)}`;
    expect(() => validateLlmOutput(tooLong, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "too_long" for over-ceiling response', () => {
    const tooLong = `Counter at $95,000 Net 30. ${"word ".repeat(120)}`;
    try {
      validateLlmOutput(tooLong, makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe("too_long");
    }
  });

  it("ACCEPT accepts compact reply when vendor at/below max", () => {
    const response = `Accepted — thanks for working through this with us today. We are glad to move ahead together on this order.`;
    expect(() =>
      validateLlmOutput(response, makeAcceptIntent({ compactAccept: true })),
    ).not.toThrow();
  });

  it("ACCEPT rejects a 1-word reply even in compact mode", () => {
    expect(() =>
      validateLlmOutput("Accepted.", makeAcceptIntent({ compactAccept: true })),
    ).toThrow(ValidationError);
  });

  it("ASK_CLARIFY accepts a 40+ word response", () => {
    const intent = makeIntent({
      action: "ASK_CLARIFY",
      allowedPrice: undefined,
    });
    const response = padWords(
      `Could you share the total price and payment terms so we can proceed?`,
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Soft phrase stripping — narrow list (most fillers stay so humanization holds)
// ─────────────────────────────────────────────

describe("validateLlmOutput – soft phrase stripping", () => {
  it('strips "happy to help"', () => {
    const response = `Happy to help — ${counterBody()}`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/happy to help/i);
  });

  it('strips "please note that"', () => {
    const response = `Please note that ${counterBody()}`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/please note that/i);
  });

  it("strips weak apologies", () => {
    const response = `I'm sorry to push back, but ${counterBody()}`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/sorry to push back/i);
  });
});

// ─────────────────────────────────────────────
// Price validation: COUNTER action
// ─────────────────────────────────────────────

describe("validateLlmOutput – COUNTER price validation", () => {
  it("passes when response contains exact allowedPrice", () => {
    expect(() => validateLlmOutput(counterBody(), makeIntent())).not.toThrow();
  });

  it("passes for price written as $95K (K notation)", () => {
    const body = padWords(
      `Thanks for circling back. Our counter is $95K on Net 30, which reflects fair value given our budget for this quarter and the project scope we agreed last week.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).not.toThrow();
  });

  it('passes for price written as "95 thousand"', () => {
    const body = padWords(
      `Thanks for circling back on this. Our counter is 95 thousand dollars on Net 30, reflecting current scope and budget for this work and we are open to discussing further on a call this week.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).not.toThrow();
  });

  it("passes for price written as $95,000.00", () => {
    const body = padWords(
      `Thanks for the revised proposal. Our counter is $95,000.00 with Net 30 payment terms, reflecting fair value for the scope we discussed and happy to discuss any concerns on your end before we finalize.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).not.toThrow();
  });

  it("passes for price within 0.5% tolerance ($95,400 vs $95,000)", () => {
    const body = padWords(
      `Thanks for the revised proposal. Our counter is $95,400 with Net 30 payment terms, reflecting fair value for the scope we discussed and happy to discuss any concerns on your end before we finalize.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).not.toThrow();
  });

  it("fails when COUNTER response has NO price at all (and is long enough)", () => {
    const body = padWords(
      `Thanks for the proposal. After internal review, we would like to come back with revised terms and ensure both sides reach a workable arrangement that fits the project budget.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "missing_price" when no price is present', () => {
    try {
      validateLlmOutput(
        padWords(
          "Thanks for the proposal. After internal review, we would like to come back with revised terms and ensure both sides reach a workable arrangement that fits the project budget.",
        ),
        makeIntent(),
      );
    } catch (e: any) {
      expect(e.reason).toBe("missing_price");
    }
  });

  it("fails when price in response is far from allowedPrice ($50,000 vs $95,000)", () => {
    const body = padWords(
      `Thanks for the revised proposal. Our counter is $50,000 with Net 30 payment terms, reflecting fair value for the scope we discussed and happy to discuss any concerns on your end before we finalize.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "wrong_price" when price deviates significantly', () => {
    try {
      validateLlmOutput(
        padWords(
          `Thanks for the revised proposal. Our counter is $50,000 with Net 30 payment terms, reflecting fair value for the scope we discussed and happy to discuss any concerns on your end before we finalize.`,
        ),
        makeIntent(),
      );
    } catch (e: any) {
      expect(e.reason).toBe("wrong_price");
    }
  });

  it("fails when an unauthorized rogue price appears alongside correct price", () => {
    const body = padWords(
      `Thanks for the proposal. Our counter is $95,000 on Net 30. However for the extended scope of additional services it would actually be $200,000 with the same terms.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('error reason is "unauthorized_price" when rogue price appears', () => {
    try {
      validateLlmOutput(
        padWords(
          `Thanks for the proposal. Our counter is $95,000 on Net 30. However for the extended scope of additional services it would actually be $200,000 with the same terms.`,
        ),
        makeIntent(),
      );
    } catch (e: any) {
      expect(e.reason).toBe("unauthorized_price");
    }
  });

  it("passes when allowedPrice is undefined (no price check needed)", () => {
    const intent = makeIntent({
      allowedPrice: undefined,
      allowedPaymentTerms: undefined,
    });
    const body = padWords(
      `Thanks for circling back. We are reviewing the latest set of terms and will respond shortly with our position once internal sign-off is complete on our end this week.`,
    );
    expect(() => validateLlmOutput(body, intent)).not.toThrow();
  });

  it("handles million-dollar prices correctly ($4.5M)", () => {
    const intent = makeIntent({
      allowedPrice: 4_500_000,
      allowedPaymentTerms: "Net 60",
    });
    const body = padWords(
      `Thanks for the revised proposal. Our counter is $4.5M on Net 60 payment terms, reflecting fair value for the scope we discussed and happy to discuss any concerns on your end before we finalize.`,
    );
    expect(() => validateLlmOutput(body, intent)).not.toThrow();
  });

  it("handles plain number $95000 without comma", () => {
    const body = padWords(
      `Thanks for the revised proposal. Counter: $95000 with Net 30 payment terms, which reflects fair value for the scope we discussed and our budget for the current quarter overall.`,
    );
    expect(() => validateLlmOutput(body, makeIntent())).not.toThrow();
  });

  it('rejects Net 90 when intent requires Net 60', () => {
    const intent = makeIntent({
      allowedPaymentTerms: "Net 60",
      allowedPrice: 53_300,
    });
    const body = padWords(
      `I appreciate the offer. Our counter: $53,300 total, Net 90. Hope we can meet in the middle!`,
    );
    expect(() => validateLlmOutput(body, intent)).toThrow(ValidationError);
    try {
      validateLlmOutput(body, intent);
    } catch (e: any) {
      expect(e.reason).toBe("wrong_terms");
    }
  });

  it("rejects $ when intent currency is ₹", () => {
    const intent = makeIntent({
      currencySymbol: "₹",
      allowedPrice: 57_000,
      allowedPaymentTerms: "Net 60",
    });
    const body = padWords(
      `I appreciate the offer of $57,500. Our counter: $57,000 total, Net 60. Hope we can meet in the middle on this order!`,
    );
    expect(() => validateLlmOutput(body, intent)).toThrow(ValidationError);
    try {
      validateLlmOutput(body, intent);
    } catch (e: any) {
      expect(e.reason).toBe("wrong_currency_symbol");
    }
  });
});

// ─────────────────────────────────────────────
// Price validation: ACCEPT and WALK_AWAY (no price check)
// ─────────────────────────────────────────────

describe("validateLlmOutput – ACCEPT/WALK_AWAY skip price validation", () => {
  it("ACCEPT passes without any price in response", () => {
    const response = padWords(
      `Accepted — thanks for working through this with us. Excited to move ahead.`,
    );
    expect(() => validateLlmOutput(response, makeAcceptIntent())).not.toThrow();
  });

  it("WALK_AWAY passes without any price in response", () => {
    const response = padWords(
      `Unfortunately the terms do not align with our requirements this quarter, but we appreciate the engagement and hope to work together in future.`,
    );
    expect(() =>
      validateLlmOutput(response, makeWalkAwayIntent()),
    ).not.toThrow();
  });

  it("ESCALATE passes without any price in response", () => {
    const intent = makeIntent({ action: "ESCALATE", allowedPrice: undefined });
    const response = padWords(
      `This needs senior management review on our side, so a colleague will follow up directly within the next two business days.`,
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// MESO price containment
// ─────────────────────────────────────────────

describe("validateLlmOutput – MESO price containment", () => {
  const mesoIntent = makeIntent({
    action: "MESO",
    allowedPrice: undefined,
    offerVariants: [
      {
        label: "Option A",
        price: 88000,
        paymentTerms: "Net 30",
        description: "Fast delivery",
      },
      {
        label: "Option B",
        price: 90000,
        paymentTerms: "Net 60",
        description: "Better terms",
      },
      {
        label: "Option C",
        price: 92000,
        paymentTerms: "Net 90",
        description: "Extended warranty",
      },
    ],
  });

  it("passes when response only mentions MESO variant prices", () => {
    const response = padWords(
      `We have prepared three options for your review. Option A is $88,000 with Net 30. Option B is $90,000 with Net 60. Option C is $92,000 with Net 90 — happy to discuss whichever works best.`,
    );
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });

  it("passes when response mentions no prices at all (intro MESO message)", () => {
    const response = padWords(
      `We have prepared several alternatives that may work for both parties. Please take a look and let us know which direction works best on your side.`,
    );
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });

  it("fails when response contains a price not in MESO variants", () => {
    const response = padWords(
      `Here are our options for your review: $88,000 with Net 30, or $100,000 with Net 60 — happy to discuss whichever works best on your end.`,
    );
    expect(() => validateLlmOutput(response, mesoIntent)).toThrow(
      ValidationError,
    );
  });

  it('error reason is "meso_unauthorized_price" for rogue MESO price', () => {
    try {
      validateLlmOutput(
        padWords(
          `Here are the options for your review: Option A at $88,000 on Net 30, or Option D at $150,000 on Net 90 with extended terms — happy to discuss.`,
        ),
        mesoIntent,
      );
    } catch (e: any) {
      expect(e.reason).toBe("meso_unauthorized_price");
    }
  });

  it("passes for MESO with K notation matching a variant", () => {
    const response = padWords(
      `Here are the options for your review. Option A costs $88K with Net 30, while Option B is $90K with Net 60 — happy to discuss whichever direction works.`,
    );
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// ValidationError class
// ─────────────────────────────────────────────

describe("ValidationError", () => {
  it("is an instance of Error", () => {
    const err = new ValidationError("test", "test_reason");
    expect(err).toBeInstanceOf(Error);
  });

  it('name is "ValidationError"', () => {
    const err = new ValidationError("test", "reason");
    expect(err.name).toBe("ValidationError");
  });

  it("exposes reason field", () => {
    const err = new ValidationError("msg", "banned_keyword_hard");
    expect(err.reason).toBe("banned_keyword_hard");
  });

  it("exposes message field (rule-code only — never rejected text)", () => {
    const err = new ValidationError("too_long", "too_long");
    expect(err.message).toBe("too_long");
  });
});

// ─────────────────────────────────────────────
// Persona scenarios
// ─────────────────────────────────────────────

describe("Persona: ACCEPT and ASK_CLARIFY responses", () => {
  it("a brief but non-trivial ACCEPT response passes all checks", () => {
    const result = validateLlmOutput(
      padWords(
        "Accepted — thanks for working through this with us today.",
      ),
      makeAcceptIntent(),
    );
    expect(result.length).toBeGreaterThan(0);
  });

  it("a brief clarification request (ASK_CLARIFY) passes all checks", () => {
    const intent = makeIntent({
      action: "ASK_CLARIFY",
      allowedPrice: undefined,
    });
    const response = padWords(
      `Could you share the total price and payment terms so we can proceed?`,
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

describe("Persona: LLM hallucination scenarios", () => {
  it('catches LLM mentioning "utility score"', () => {
    const response = counterBody(
      "Based on your utility score of 0.65,",
      "please confirm if that works for your team.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('catches LLM mentioning "our algorithm"', () => {
    const response = counterBody(
      "Our algorithm determined this is fair, so",
      "please confirm whether that works for your team and timeline.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it("catches LLM revealing it is a GPT system", () => {
    const response = counterBody(
      "As a GPT assistant, I can offer",
      "please let us know whether that works for your team and timeline.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it("catches LLM mentioning BATNA", () => {
    const response = counterBody(
      "Our BATNA in this deal supports this position, so",
      "please let us know if that works for your team.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it("catches LLM referencing decision tree", () => {
    const response = counterBody(
      "Following the decision tree, we propose",
      "please let us know whether that works for your team and timeline.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });

  it('catches LLM mentioning "automated system"', () => {
    const response = counterBody(
      "Our automated system has determined this is fair, so",
      "please confirm whether that works for your team.",
    );
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(
      ValidationError,
    );
  });
});

describe("Persona: experienced vendor — complex but valid LLM response", () => {
  it("accepts sophisticated professional language without internal keywords", () => {
    const response = padWords(
      counterBody(
        "Thank you for your revised proposal. After thorough internal review,",
        "We believe this reflects fair value for both parties and hope to reach a mutually agreeable arrangement.",
      ),
    );
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it("strips narrow soft phrases from verbose response and still passes", () => {
    const response = `Happy to help — ${counterBody()}`.replace(
      /^Thanks/,
      "Good morning. Thanks",
    );
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/happy to help/i);
    expect(result).not.toMatch(/please note that/i);
    expect(result).toContain("$95,000");
  });
});

describe("validateLlmOutput – round 1 social salutation", () => {
  it('rejects thank-you-only opener on round 1 COUNTER', () => {
    const intent = makeIntent({ roundNumber: 1 });
    const response = padWords(
      counterBody(
        "Thank you for your quotation. After internal review,",
        "we believe this is a fair landing point for both sides on this order.",
      ),
    );
    expect(() => validateLlmOutput(response, intent)).toThrow(ValidationError);
    try {
      validateLlmOutput(response, intent);
    } catch (e: any) {
      expect(e.reason).toBe("missing_greeting");
    }
  });

  it("accepts Good morning salutation before acknowledgment on round 1", () => {
    const intent = makeIntent({ roundNumber: 1 });
    const response = padWords(
      counterBody(
        "Good morning. Thank you for your quotation. After internal review,",
        "we believe this is a fair landing point for both sides on this order.",
      ),
    );
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});
