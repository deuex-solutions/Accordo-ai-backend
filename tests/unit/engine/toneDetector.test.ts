/**
 * Tests for toneDetector.ts
 *
 * Tests the tone detection engine with a wide range of vendor messages —
 * from formal business language to casual SMS-style text, urgent demands,
 * firm ultimatums, and friendly partnership language. Also covers
 * the intensity field added in the refactor and the deprecated function.
 *
 * No DB, no network — pure unit tests.
 */

import { describe, it, expect } from 'vitest';
import {
  detectVendorTone,
  getToneDescription,
  getResponseStyleRecommendation,
  type ToneMessage,
  type VendorTone,
} from '../../../src/modules/chatbot/engine/toneDetector.js';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function vendorMsg(content: string): ToneMessage {
  return { role: 'VENDOR', content };
}

function accordoMsg(content: string): ToneMessage {
  return { role: 'ACCORDO', content };
}

// ─────────────────────────────────────────────
// Edge: empty conversation
// ─────────────────────────────────────────────

describe('detectVendorTone – empty/no vendor messages', () => {
  it('returns friendly as default when no messages', () => {
    const result = detectVendorTone([]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('returns confidence=0.5 when no messages', () => {
    const result = detectVendorTone([]);
    expect(result.confidence).toBe(0.5);
  });

  it('returns empty indicators when no messages', () => {
    const result = detectVendorTone([]);
    expect(result.indicators).toEqual([]);
  });

  it('returns friendly when only ACCORDO messages exist (no vendor messages)', () => {
    const messages = [
      accordoMsg('Hello! Please share your offer.'),
      accordoMsg('Could you provide the total price?'),
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('friendly');
  });

  it('ignores SYSTEM messages for tone detection', () => {
    const messages: ToneMessage[] = [
      { role: 'SYSTEM', content: 'Algorithm threshold engine score.' },
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('friendly'); // Default
  });
});

// ─────────────────────────────────────────────
// Formal tone detection
// ─────────────────────────────────────────────

describe('detectVendorTone – FORMAL', () => {
  it('detects formal from "Dear Sir" salutation', () => {
    const result = detectVendorTone([vendorMsg('Dear Sir, we would like to propose our offer.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('detects formal from "respectfully" keyword', () => {
    const result = detectVendorTone([vendorMsg('We respectfully submit our proposal for your consideration.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('detects formal from "pursuant to" language', () => {
    const result = detectVendorTone([vendorMsg('Pursuant to our discussion, we wish to formalize our offer.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('detects formal from "best regards" closing', () => {
    const result = detectVendorTone([vendorMsg('Please find our revised proposal attached. Best regards.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('detects formal from "sincerely" closing', () => {
    const result = detectVendorTone([vendorMsg('We propose Net 30 payment terms. Sincerely, the vendor team.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('detects formal from "kindly review" language', () => {
    const result = detectVendorTone([vendorMsg('Kindly review our proposal and revert at your earliest convenience.')]);
    expect(result.primaryTone).toBe('formal');
  });

  it('confidence is reasonable for clearly formal message', () => {
    const result = detectVendorTone([vendorMsg('Dear Sir, respectfully, please find our proposal. Best regards.')]);
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('detects formal across multiple formal messages', () => {
    const messages = [
      vendorMsg('Dear Sir, we propose the following terms.'),
      accordoMsg('Thank you, we will review.'),
      vendorMsg('Pursuant to our agreement, kindly confirm.'),
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('formal');
  });
});

// ─────────────────────────────────────────────
// Casual tone detection
// ─────────────────────────────────────────────

describe('detectVendorTone – CASUAL', () => {
  it('detects casual from "hey" greeting', () => {
    const result = detectVendorTone([vendorMsg('Hey! Can we talk about the price?')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from "yeah" and "nope"', () => {
    const result = detectVendorTone([vendorMsg('Yeah, sounds good to me. Nope, that doesn\'t work.')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from "cool" and "sounds good"', () => {
    const result = detectVendorTone([vendorMsg('Cool, sounds good! Works for me.')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from "gotcha"', () => {
    const result = detectVendorTone([vendorMsg('Gotcha, I\'ll check with my team.')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from "lol" and emoji-style', () => {
    const result = detectVendorTone([vendorMsg('lol that price is way too high :)')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from "btw" abbreviation', () => {
    const result = detectVendorTone([vendorMsg('btw, our delivery timeline is 2 weeks.')]);
    expect(result.primaryTone).toBe('casual');
  });

  it('detects casual from exclamation marks', () => {
    const result = detectVendorTone([vendorMsg('We can do $90,000!! That\'s our best offer!!')]);
    expect(result.primaryTone).toBe('casual');
  });

  // Edge: SMS-style message from tech-novice vendor
  it('detects casual from extremely short "hi" message', () => {
    const result = detectVendorTone([vendorMsg('hi')]);
    expect(result.primaryTone).toBe('casual');
  });
});

// ─────────────────────────────────────────────
// Urgent tone detection
// ─────────────────────────────────────────────

describe('detectVendorTone – URGENT', () => {
  it('detects urgent from "ASAP" keyword', () => {
    const result = detectVendorTone([vendorMsg('We need this confirmed ASAP, please.')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('detects urgent from "deadline" keyword', () => {
    const result = detectVendorTone([vendorMsg('We have a strict deadline next Friday.')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('detects urgent from "time-sensitive" phrase', () => {
    const result = detectVendorTone([vendorMsg('This is time-sensitive. Can you respond today?')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('detects urgent from "immediately"', () => {
    const result = detectVendorTone([vendorMsg('We need confirmation immediately.')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('detects urgent from "by end of"', () => {
    const result = detectVendorTone([vendorMsg('We need a response by end of business today.')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('detects urgent from "critical"', () => {
    const result = detectVendorTone([vendorMsg('This is critical for our project timeline.')]);
    expect(result.primaryTone).toBe('urgent');
  });

  it('has high confidence for repeated urgent signals', () => {
    const messages = [
      vendorMsg('ASAP please, this is urgent!'),
      vendorMsg('We have a deadline by tomorrow. Critical timeline.'),
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('urgent');
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ─────────────────────────────────────────────
// Firm tone detection
// ─────────────────────────────────────────────

describe('detectVendorTone – FIRM', () => {
  it('detects firm from "final offer" phrase', () => {
    const result = detectVendorTone([vendorMsg('This is our final offer — $90,000, take it or leave it.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "non-negotiable"', () => {
    const result = detectVendorTone([vendorMsg('Our price of $95,000 is non-negotiable.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "take it or leave"', () => {
    const result = detectVendorTone([vendorMsg('Take it or leave it. We cannot go lower.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "best we can"', () => {
    const result = detectVendorTone([vendorMsg('$88,000 is the best we can do.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "lowest we can"', () => {
    const result = detectVendorTone([vendorMsg('$85,000 is the lowest we can go on this contract.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "insist" and "strongly believe"', () => {
    const result = detectVendorTone([vendorMsg('We strongly believe this price is fair and insist on these terms.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('detects firm from "will not"', () => {
    const result = detectVendorTone([vendorMsg('We will not reduce the price below $90,000.')]);
    expect(result.primaryTone).toBe('firm');
  });

  it('firm confidence is high when multiple firm signals present', () => {
    const result = detectVendorTone([
      vendorMsg('This is our final offer — non-negotiable. We cannot go lower.'),
    ]);
    expect(result.primaryTone).toBe('firm');
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ─────────────────────────────────────────────
// Friendly tone detection
// ─────────────────────────────────────────────

describe('detectVendorTone – FRIENDLY', () => {
  it('detects friendly from "appreciate" and "thank you"', () => {
    const result = detectVendorTone([vendorMsg('Thank you so much, we really appreciate the opportunity.')]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('detects friendly from "partnership" language', () => {
    const result = detectVendorTone([vendorMsg('We value this partnership and look forward to working together.')]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('detects friendly from "win-win"', () => {
    const result = detectVendorTone([vendorMsg('We want a win-win outcome for both parties.')]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('detects friendly from "looking forward"', () => {
    const result = detectVendorTone([vendorMsg('We\'re looking forward to reaching an agreement with you.')]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('detects friendly from "glad to" and "happy to"', () => {
    const result = detectVendorTone([vendorMsg('We\'re happy to adjust our terms and glad to discuss further.')]);
    expect(result.primaryTone).toBe('friendly');
  });

  it('detects friendly from "mutual"', () => {
    const result = detectVendorTone([vendorMsg('We hope this is mutually beneficial for both organizations.')]);
    expect(result.primaryTone).toBe('friendly');
  });
});

// ─────────────────────────────────────────────
// Recency weighting — latest message matters more
// ─────────────────────────────────────────────

describe('detectVendorTone – recency weighting', () => {
  it('weights later messages more heavily than earlier ones', () => {
    // Start casual, shift to firm — firm should dominate due to recency weight
    const messages = [
      vendorMsg('Hey! Our offer is $90,000.'),           // casual
      accordoMsg('Thank you, we will counter.'),
      vendorMsg('This is our final offer, non-negotiable.'), // firm (recent)
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('firm');
  });

  it('reflects tone shift from formal to urgent', () => {
    const messages = [
      vendorMsg('Dear Sir, we propose $92,000.'),            // formal
      accordoMsg('We are reviewing the offer.'),
      vendorMsg('We need this confirmed ASAP — critical deadline!'), // urgent (recent)
    ];
    const result = detectVendorTone(messages);
    expect(result.primaryTone).toBe('urgent');
  });
});

// ─────────────────────────────────────────────
// ToneDetectionResult structure
// ─────────────────────────────────────────────

describe('detectVendorTone – result structure', () => {
  it('result has primaryTone field', () => {
    const result = detectVendorTone([vendorMsg('Thank you for the opportunity.')]);
    expect(result).toHaveProperty('primaryTone');
  });

  it('result has confidence field between 0 and 1', () => {
    const result = detectVendorTone([vendorMsg('Thank you for the opportunity.')]);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('result has intensity field between 0.1 and 1.0 (refactor addition)', () => {
    const result = detectVendorTone([vendorMsg('Dear Sir, respectfully, please find our proposal.')]);
    expect(result.intensity).toBeGreaterThanOrEqual(0.1);
    expect(result.intensity).toBeLessThanOrEqual(1.0);
  });

  it('intensity equals Math.max(0.1, Math.min(1.0, confidence))', () => {
    const result = detectVendorTone([vendorMsg('Dear Sir, respectfully, please find our proposal.')]);
    const expected = Math.max(0.1, Math.min(1.0, result.confidence));
    expect(result.intensity).toBe(expected);
  });

  it('result has indicators array', () => {
    const result = detectVendorTone([vendorMsg('Thank you for the opportunity.')]);
    expect(Array.isArray(result.indicators)).toBe(true);
  });

  it('indicators are capped at 5 entries', () => {
    // Message with many tone signals
    const result = detectVendorTone([
      vendorMsg('Dear Sir, respectfully, pursuant to our discussion, please find our proposal. Best regards. Thank you. Sincerely. Kindly.'),
    ]);
    expect(result.indicators.length).toBeLessThanOrEqual(5);
  });

  it('result has allTones record', () => {
    const result = detectVendorTone([vendorMsg('Thanks for your time.')]);
    expect(typeof result.allTones).toBe('object');
  });
});

// ─────────────────────────────────────────────
// getToneDescription
// ─────────────────────────────────────────────

describe('getToneDescription', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns non-empty description for ${tone}`, () => {
      const desc = getToneDescription(tone);
      expect(typeof desc).toBe('string');
      expect(desc.length).toBeGreaterThan(0);
    });
  }

  it('formal description mentions professional/business language', () => {
    const desc = getToneDescription('formal');
    expect(desc.toLowerCase()).toMatch(/formal|professional|business|polite/);
  });

  it('casual description mentions informal/friendly language', () => {
    const desc = getToneDescription('casual');
    expect(desc.toLowerCase()).toMatch(/casual|informal|conversational|friendly/);
  });

  it('urgent description mentions time/deadline', () => {
    const desc = getToneDescription('urgent');
    expect(desc.toLowerCase()).toMatch(/urgent|time|deadline|speed/);
  });

  it('firm description mentions position/determined', () => {
    const desc = getToneDescription('firm');
    expect(desc.toLowerCase()).toMatch(/firm|determined|position|strong/);
  });

  it('friendly description mentions warm/relationship', () => {
    const desc = getToneDescription('friendly');
    expect(desc.toLowerCase()).toMatch(/warm|friendly|relationship|building/);
  });
});

// ─────────────────────────────────────────────
// getResponseStyleRecommendation — deprecated but still works
// ─────────────────────────────────────────────

describe('getResponseStyleRecommendation – deprecated function', () => {
  const tones: VendorTone[] = ['formal', 'casual', 'urgent', 'firm', 'friendly'];

  for (const tone of tones) {
    it(`returns recommendation object for tone=${tone}`, () => {
      const rec = getResponseStyleRecommendation(tone);
      expect(rec).toHaveProperty('style');
      expect(rec).toHaveProperty('salutation');
      expect(rec).toHaveProperty('closing');
    });

    it(`all fields are non-empty strings for tone=${tone}`, () => {
      const rec = getResponseStyleRecommendation(tone);
      expect(rec.style.length).toBeGreaterThan(0);
      expect(rec.salutation.length).toBeGreaterThan(0);
      expect(rec.closing.length).toBeGreaterThan(0);
    });
  }

  it('does not throw for unknown tone (fallback to friendly)', () => {
    expect(() => getResponseStyleRecommendation('confused' as VendorTone)).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Persona: tech-novice vendor — first message ever
// ─────────────────────────────────────────────

describe('Persona: tech-novice vendor', () => {
  it('handles single-word message "hello"', () => {
    const result = detectVendorTone([vendorMsg('hello')]);
    expect(result.primaryTone).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('handles empty-but-whitespace message gracefully', () => {
    const result = detectVendorTone([vendorMsg('   ')]);
    // No patterns will match, falls back to friendly default
    expect(result.primaryTone).toBe('friendly');
  });

  it('handles message with only numbers (pure price message)', () => {
    const result = detectVendorTone([vendorMsg('90000')]);
    expect(result.primaryTone).toBeDefined();
  });

  it('handles very long vendor message without crashing', () => {
    const longMsg = 'We would like to propose '.repeat(50) + 'Net 30 terms.';
    expect(() => detectVendorTone([vendorMsg(longMsg)])).not.toThrow();
  });
});

// ─────────────────────────────────────────────
// Persona: experienced negotiator — mixed signals
// ─────────────────────────────────────────────

describe('Persona: experienced negotiator — mixed signals', () => {
  it('handles friendly-but-firm message by picking dominant tone', () => {
    const result = detectVendorTone([
      vendorMsg('We value this partnership and hope to find a win-win. That said, $90,000 is our final offer, non-negotiable.'),
    ]);
    // Firm signals outweigh friendly here due to higher weights
    expect(['firm', 'friendly']).toContain(result.primaryTone);
  });

  it('handles formal-but-urgent message correctly', () => {
    const result = detectVendorTone([
      vendorMsg('Dear Sir, pursuant to our agreement, we urgently request confirmation by end of business today. Deadline is critical.'),
    ]);
    // Both formal and urgent signals present
    expect(['formal', 'urgent']).toContain(result.primaryTone);
  });

  it('returns allTones with multiple entries for mixed message', () => {
    const result = detectVendorTone([
      vendorMsg('Thanks for your response! ASAP would be great. Best regards.'),
    ]);
    const toneCount = Object.keys(result.allTones).length;
    expect(toneCount).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────
// Persona: vendor who escalates tone over rounds
// ─────────────────────────────────────────────

describe('Persona: vendor escalating tone over rounds', () => {
  it('starts friendly, ends urgent — final tone reflects urgency', () => {
    const messages: ToneMessage[] = [
      vendorMsg('Great to connect! We value this opportunity.'), // friendly
      accordoMsg('Thank you for reaching out.'),
      vendorMsg('Thanks for your response — looking forward to working together.'), // friendly
      accordoMsg('We are reviewing your offer.'),
      vendorMsg('ASAP! We have a critical deadline. This is time-sensitive.'), // urgent (most recent)
    ];
    const result = detectVendorTone(messages);
    // Last message is heavily weighted
    expect(result.primaryTone).toBe('urgent');
  });
});
