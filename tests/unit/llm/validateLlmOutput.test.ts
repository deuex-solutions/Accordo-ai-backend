/**
 * Tests for validateLlmOutput.ts
 *
 * The LLM is untrusted — every response must pass hard validation.
 * These tests cover banned words, word limits, price fuzzy-matching,
 * MESO price containment, soft-phrase stripping, and edge cases from
 * real-world vendor conversations.
 */

import { describe, it, expect } from 'vitest';
import { validateLlmOutput, ValidationError } from '../../../src/llm/validateLlmOutput.js';
import type { NegotiationIntent } from '../../../src/negotiation/intent/buildNegotiationIntent.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function makeIntent(overrides: Partial<NegotiationIntent> = {}): NegotiationIntent {
  return {
    action: 'COUNTER',
    firmness: 0.55,
    commercialPosition: 'We are working toward mutually beneficial terms.',
    allowedPrice: 95000,
    allowedPaymentTerms: 'Net 30',
    acknowledgeConcerns: [],
    vendorTone: 'formal',
    currencySymbol: '$',
    ...overrides,
  };
}

function makeAcceptIntent(): NegotiationIntent {
  return makeIntent({ action: 'ACCEPT', allowedPrice: undefined });
}

function makeWalkAwayIntent(): NegotiationIntent {
  return makeIntent({ action: 'WALK_AWAY', allowedPrice: undefined });
}

// ─────────────────────────────────────────────
// Empty / null response
// ─────────────────────────────────────────────

describe('validateLlmOutput – empty/null response', () => {
  it('throws ValidationError for empty string', () => {
    expect(() => validateLlmOutput('', makeIntent())).toThrow(ValidationError);
  });

  it('throws ValidationError for whitespace-only string', () => {
    expect(() => validateLlmOutput('   \n\t  ', makeIntent())).toThrow(ValidationError);
  });

  it('error reason is "empty_response" for blank input', () => {
    try {
      validateLlmOutput('', makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe('empty_response');
    }
  });
});

// ─────────────────────────────────────────────
// Banned keywords
// ─────────────────────────────────────────────

describe('validateLlmOutput – banned keywords', () => {
  const BANNED = [
    'utility',
    'algorithm',
    'scoring',
    'score',
    'threshold',
    'model',
    'weighted',
    'batna',
    'decision tree',
    'engine',
    'config',
    'parameters',
    'gpt',
    'openai',
    'ai model',
    'language model',
    'llm',
    'automated system',
    'output',
    'prompt',
  ];

  for (const word of BANNED) {
    it(`rejects response containing banned word: "${word}"`, () => {
      const response = `We have reviewed your offer. Our ${word} shows this is acceptable. We propose $95,000.`;
      expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
    });

    it(`rejects case-insensitive variant: "${word.toUpperCase()}"`, () => {
      const response = `Our ${word.toUpperCase()} calculation is complete. Counter: $95,000.`;
      expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
    });
  }

  it('does NOT reject "model" when it refers to "business model" — wait, it DOES because word boundary matches', () => {
    // /\bmodel\b/ will still match "model" in "business model"
    const response = `Our business model requires us to counter at $95,000.`;
    // "model" is a banned word — this SHOULD be caught
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('passes clean professional response with correct price', () => {
    const response = `Thank you for your proposal. After careful review, we would like to counter with $95,000 on Net 30 terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Word count limit
// ─────────────────────────────────────────────

describe('validateLlmOutput – word count limit (160 words)', () => {
  it('accepts response at exactly 160 words', () => {
    // Build exactly 160 words; include the price so COUNTER passes
    const prefix = 'We counter with $95,000 on Net 30. ';
    const filler = 'This is a word. '.repeat(40).trim(); // 40 × 4 = 160 words including prefix
    // Build to exactly 160
    const words160 = (prefix + filler).split(' ').slice(0, 160).join(' ');
    expect(() => validateLlmOutput(words160, makeIntent())).not.toThrow();
  });

  it('rejects response with 161 words', () => {
    const prefix = 'We counter with $95,000. ';
    const words161 = (prefix + 'word '.repeat(200)).split(' ').slice(0, 161).join(' ');
    expect(() => validateLlmOutput(words161, makeIntent())).toThrow(ValidationError);
  });

  it('error reason is "too_long" for over-word-limit response', () => {
    const longResponse = 'word '.repeat(200);
    try {
      validateLlmOutput(longResponse, makeIntent({ action: 'ACCEPT', allowedPrice: undefined }));
    } catch (e: any) {
      expect(e.reason).toBe('too_long');
    }
  });

  it('single word response passes word count (ACCEPT)', () => {
    expect(() => validateLlmOutput('Accepted.', makeAcceptIntent())).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Soft phrase stripping
// ─────────────────────────────────────────────

describe('validateLlmOutput – soft phrase stripping', () => {
  it('strips "happy to help" from response', () => {
    const response = `Happy to help! We counter at $95,000 on Net 30.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/happy to help/i);
  });

  it('strips "certainly" from response', () => {
    const response = `Certainly, we can counter at $95,000.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/certainly/i);
  });

  it('strips "of course" from response', () => {
    const response = `Of course! Our counter is $95,000 with Net 30.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/of course/i);
  });

  it('strips "kindly" from response', () => {
    const response = `Please kindly review our counter of $95,000.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/kindly/i);
  });

  it('strips "please note that" from response', () => {
    const response = `Please note that our counter is $95,000 with Net 30.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/please note that/i);
  });

  it('strips "I\'m here to help" from response', () => {
    const response = `I'm here to help. We counter at $95,000.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/I'm here to help/i);
  });

  it('strips "as an AI" from response', () => {
    const response = `As an AI, I propose $95,000 on Net 30.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/as an ai/i);
  });

  it('returns clean response after stripping multiple soft phrases', () => {
    const response = `Certainly, happy to help! Of course, our counter is $95,000 on Net 30.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/certainly/i);
    expect(result).not.toMatch(/happy to help/i);
    expect(result).not.toMatch(/of course/i);
    expect(result).toContain('$95,000');
  });
});

// ─────────────────────────────────────────────
// Price validation: COUNTER action
// ─────────────────────────────────────────────

describe('validateLlmOutput – COUNTER price validation', () => {
  it('passes when response contains exact allowedPrice', () => {
    const response = `Our counter is $95,000 with Net 30 terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('passes for price written as $95K (K notation)', () => {
    const response = `We counter at $95K on Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('passes for price written as "95 thousand"', () => {
    const response = `Our counter is 95 thousand dollars on Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('passes for price written as $95,000.00', () => {
    const response = `We propose $95,000.00 with Net 30 terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('passes for price within 0.5% tolerance ($95,400 vs $95,000)', () => {
    // 95,400 is 0.42% above 95,000 — within tolerance
    const response = `We counter at $95,400 with Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('fails when COUNTER response has NO price at all', () => {
    const response = `We have reviewed your proposal and would like to proceed with new terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('error reason is "missing_price" when no price is present', () => {
    try {
      validateLlmOutput('We need to discuss further.', makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe('missing_price');
    }
  });

  it('fails when price in response is far from allowedPrice ($50,000 vs $95,000)', () => {
    const response = `We counter at $50,000 with Net 30 terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('error reason is "wrong_price" when price deviates significantly', () => {
    try {
      validateLlmOutput('Our counter is $50,000 on Net 30.', makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe('wrong_price');
    }
  });

  it('fails when an unauthorized rogue price appears alongside correct price', () => {
    // $95,000 is correct but $200,000 is rogue (>10% off)
    const response = `Our counter is $95,000. However, for extended scope it would be $200,000. Net 30 applies.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('error reason is "unauthorized_price" when rogue price appears', () => {
    try {
      validateLlmOutput('Counter is $95,000 but full package is $200,000.', makeIntent());
    } catch (e: any) {
      expect(e.reason).toBe('unauthorized_price');
    }
  });

  it('passes when allowedPrice is undefined (no price check needed)', () => {
    const intent = makeIntent({ allowedPrice: undefined });
    const response = `We are reviewing the terms and will respond shortly.`;
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });

  it('handles million-dollar prices correctly ($4.5M)', () => {
    const intent = makeIntent({ allowedPrice: 4_500_000 });
    const response = `Our counter is $4.5M on Net 60 terms.`;
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });

  it('handles plain number $95000 without comma', () => {
    const response = `Counter: $95000 with Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Price validation: ACCEPT and WALK_AWAY (no price check)
// ─────────────────────────────────────────────

describe('validateLlmOutput – ACCEPT/WALK_AWAY skip price validation', () => {
  it('ACCEPT passes without any price in response', () => {
    const response = `We are pleased to accept your proposal and look forward to working together.`;
    expect(() => validateLlmOutput(response, makeAcceptIntent())).not.toThrow();
  });

  it('WALK_AWAY passes without any price in response', () => {
    const response = `Unfortunately the terms do not align with our requirements. We wish you well.`;
    expect(() => validateLlmOutput(response, makeWalkAwayIntent())).not.toThrow();
  });

  it('ESCALATE passes without any price in response', () => {
    const intent = makeIntent({ action: 'ESCALATE', allowedPrice: undefined });
    const response = `This requires senior management review. We will be in touch within two business days.`;
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// MESO price containment
// ─────────────────────────────────────────────

describe('validateLlmOutput – MESO price containment', () => {
  const mesoIntent = makeIntent({
    action: 'MESO',
    allowedPrice: undefined,
    offerVariants: [
      { label: 'Option A', price: 88000, paymentTerms: 'Net 30', description: 'Fast delivery' },
      { label: 'Option B', price: 90000, paymentTerms: 'Net 60', description: 'Better terms' },
      { label: 'Option C', price: 92000, paymentTerms: 'Net 90', description: 'Extended warranty' },
    ],
  });

  it('passes when response only mentions MESO variant prices', () => {
    const response = `Option A is $88,000 with Net 30. Option B is $90,000 with Net 60. Option C is $92,000 with Net 90.`;
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });

  it('passes when response mentions no prices at all (intro MESO message)', () => {
    const response = `We have prepared several options that may work for both parties. Please review and let us know your preference.`;
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });

  it('fails when response contains a price not in MESO variants', () => {
    const response = `Here are our options: $88,000 with Net 30, or $100,000 with Net 60.`;
    // $100,000 is a rogue price not in variants
    expect(() => validateLlmOutput(response, mesoIntent)).toThrow(ValidationError);
  });

  it('error reason is "meso_unauthorized_price" for rogue MESO price', () => {
    try {
      validateLlmOutput('Option A: $88,000. Option D: $150,000.', mesoIntent);
    } catch (e: any) {
      expect(e.reason).toBe('meso_unauthorized_price');
    }
  });

  it('passes for MESO with K notation matching a variant', () => {
    const response = `Option A costs $88K with Net 30. Option B is $90K with Net 60.`;
    expect(() => validateLlmOutput(response, mesoIntent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// ValidationError class
// ─────────────────────────────────────────────

describe('ValidationError', () => {
  it('is an instance of Error', () => {
    const err = new ValidationError('test', 'test_reason');
    expect(err).toBeInstanceOf(Error);
  });

  it('name is "ValidationError"', () => {
    const err = new ValidationError('test', 'reason');
    expect(err.name).toBe('ValidationError');
  });

  it('exposes reason field', () => {
    const err = new ValidationError('msg', 'banned_keyword');
    expect(err.reason).toBe('banned_keyword');
  });

  it('exposes message field', () => {
    const err = new ValidationError('Something went wrong', 'too_long');
    expect(err.message).toBe('Something went wrong');
  });
});

// ─────────────────────────────────────────────
// Persona: first-time vendor — confused, short message
// ─────────────────────────────────────────────

describe('Persona: first-time vendor responses from Accordo', () => {
  it('a very short polite ACCEPT response passes all checks', () => {
    const result = validateLlmOutput('Accepted. Thank you for working with us.', makeAcceptIntent());
    expect(result.length).toBeGreaterThan(0);
  });

  it('a brief clarification request (ASK_CLARIFY) passes all checks', () => {
    const intent = makeIntent({ action: 'ASK_CLARIFY', allowedPrice: undefined });
    const response = `Could you share the total price and payment terms so we can proceed?`;
    expect(() => validateLlmOutput(response, intent)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Persona: LLM hallucinates internal details
// ─────────────────────────────────────────────

describe('Persona: LLM hallucination scenarios', () => {
  it('catches LLM mentioning "utility score"', () => {
    const response = `Based on your utility score of 0.65, we counter at $95,000.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('catches LLM mentioning "our algorithm"', () => {
    const response = `Our algorithm determined $95,000 is the right counter.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('catches LLM revealing it is a GPT system', () => {
    const response = `As a GPT assistant, I can offer $95,000 on Net 30 terms.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('catches LLM mentioning BATNA', () => {
    const response = `Our BATNA in this deal supports a counter of $95,000.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('catches LLM referencing decision tree', () => {
    const response = `Following the decision tree, we propose $95,000 on Net 30.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });

  it('catches LLM mentioning "automated system"', () => {
    const response = `Our automated system has determined $95,000 is the right price.`;
    expect(() => validateLlmOutput(response, makeIntent())).toThrow(ValidationError);
  });
});

// ─────────────────────────────────────────────
// Persona: experienced power-user — complex negotiation language
// ─────────────────────────────────────────────

describe('Persona: experienced vendor — complex but valid LLM response', () => {
  it('accepts sophisticated professional language without internal keywords', () => {
    const response = `Thank you for your revised proposal. After thorough internal review, we would like to counter with a total of $95,000 on Net 30 terms. We believe this reflects fair value for both parties and hope to reach a mutually agreeable arrangement by end of this week.`;
    expect(() => validateLlmOutput(response, makeIntent())).not.toThrow();
  });

  it('strips soft phrases from verbose response and still passes', () => {
    const response = `Certainly, happy to help move this forward. Of course, our position is $95,000 on Net 30, which we believe is fair given current market conditions. Please note that we are committed to a long-term partnership.`;
    const result = validateLlmOutput(response, makeIntent());
    expect(result).not.toMatch(/certainly/i);
    expect(result).not.toMatch(/happy to help/i);
    expect(result).not.toMatch(/of course/i);
    expect(result).not.toMatch(/please note that/i);
    expect(result).toContain('$95,000');
  });
});
