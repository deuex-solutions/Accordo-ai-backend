import { describe, it, expect } from "vitest";
import { composeIntentFaithfulReply } from "../../../src/llm/compose-intent-faithful-reply.js";
import {
  validateLlmOutput,
} from "../../../src/llm/validate-llm-output.js";
import type { NegotiationIntent } from "../../../src/negotiation/intent/build-negotiation-intent.js";

function counterIntent(
  overrides: Partial<NegotiationIntent> = {},
): NegotiationIntent {
  return {
    action: "COUNTER",
    firmness: 0.55,
    commercialPosition: "test",
    acknowledgeConcerns: [],
    vendorTone: "formal",
    currencySymbol: "₹",
    allowedPrice: 55_000,
    allowedPaymentTerms: "Net 30",
    roundNumber: 1,
    ...overrides,
  };
}

describe("composeIntentFaithfulReply", () => {
  it("includes exact INR counter price and Net 30", () => {
    const text = composeIntentFaithfulReply(counterIntent());
    expect(text).toMatch(/^Good (morning|afternoon|evening)\./);
    expect(text).toContain("Thank you for your quotation");
    expect(text).toContain("₹");
    expect(text).toContain("55,000");
    expect(text).toMatch(/Net\s*30/i);
    expect(text.split(/\s+/).length).toBeGreaterThanOrEqual(40);
    expect(() => validateLlmOutput(text, counterIntent())).not.toThrow();
  });

  it("opens with greeting on round 1 even when template index > 0", () => {
    const text = composeIntentFaithfulReply(
      counterIntent({
        roundNumber: 1,
        persuasionBrief: { angle: "philosophy", vendorMovedTowardUs: false },
      }),
    );
    expect(text).toMatch(
      /^Good (morning|afternoon|evening)\. (Thank you for your quotation|Thanks for putting|We appreciate you sending)/i,
    );
    expect(text).toContain("₹55,000");
  });

  it("varies counter wording across rounds", () => {
    const round1 = composeIntentFaithfulReply(counterIntent({ roundNumber: 1 }));
    const round3 = composeIntentFaithfulReply(
      counterIntent({
        roundNumber: 3,
        persuasionBrief: {
          angle: "economics",
          vendorMovedTowardUs: true,
        },
        vendorMovement: "moderate",
      }),
    );
    expect(round1).not.toBe(round3);
    expect(round3).toMatch(/adjusting your numbers|movement on price/i);
  });
});
