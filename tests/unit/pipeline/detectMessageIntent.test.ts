/**
 * detectMessageIntent — vendor terms inquiry vs partial offer
 */

import { describe, it, expect } from "vitest";
import { detectMessageIntent } from "../../../src/modules/chatbot/pipeline/detect-message-intent.js";

describe("detectMessageIntent – vendor terms inquiry", () => {
  it("classifies question with net 60 as VENDOR_TERMS_INQUIRY", () => {
    const result = detectMessageIntent("what best can you offer for net 60?", {
      extractedPrice: null,
      extractedDays: 60,
    });

    expect(result.type).toBe("VENDOR_TERMS_INQUIRY");
    expect(result.termsRequest?.requestedDays).toBe(60);
  });

  it("classifies terms statement without question as PARTIAL_OFFER", () => {
    const result = detectMessageIntent("We can do Net 60 on this order.", {
      extractedPrice: null,
      extractedDays: 60,
    });

    expect(result.type).toBe("PARTIAL_OFFER");
    expect(result.termsRequest).toBeUndefined();
  });

  it("complete offer still wins over terms-inquiry heuristic", () => {
    const result = detectMessageIntent(
      "What is your best offer for net 60? Our price is ₹50,000 net 60.",
      { extractedPrice: 50_000, extractedDays: 60 },
    );

    expect(result.type).toBe("NEGOTIATION_OFFER");
  });
});
