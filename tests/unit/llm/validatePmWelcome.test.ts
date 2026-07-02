import { describe, it, expect } from "vitest";
import {
  normalizeWelcomeFormatting,
  sanitizeWelcomeText,
  validatePmWelcomeMessage,
  WelcomeValidationError,
} from "../../../src/llm/validate-pm-welcome.js";

const ctx = {
  buyerCompanyName: "Acme Foods Ltd",
  vendorName: "Rajesh Kumar",
  requisitionTitle: "test food",
};

const validWelcome = [
  "Good evening.",
  "On behalf of Acme Foods Ltd's procurement manager and the wider procurement team, I welcome you, Rajesh Kumar, to this negotiation.",
  "I will lead the commercial dialogue and ensure we address pricing, terms, delivery, and any other material aspects of test food in a clear and transparent way.",
  "Our objective is a balanced agreement that reflects market reality and our internal requirements.",
  "Share your proposal at your convenience, and we will take the discussion forward from there.",
].join("\n");

describe("validate-pm-welcome", () => {
  it("accepts multi-line welcome with company and vendor", () => {
    const out = validatePmWelcomeMessage(validWelcome, ctx);
    expect(out).toContain("Good evening.");
    expect(out).toContain("Acme Foods Ltd");
    expect(out).toContain("Rajesh Kumar");
    expect(out.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("preserves newlines through sanitizeWelcomeText", () => {
    const sanitized = sanitizeWelcomeText("Good evening.\n\nOn behalf of Acme.");
    expect(sanitized).toBe("Good evening.\n\nOn behalf of Acme.");
  });

  it("normalizes single paragraph into multiple lines", () => {
    const single =
      "Good evening. On behalf of the team, I welcome you. I will lead the dialogue on pricing and terms for this requisition in a transparent way. Our objective is a balanced agreement that reflects market reality and our internal commercial requirements. Share your proposal when ready and we will take the discussion forward from there.";
    const normalized = normalizeWelcomeFormatting(single);
    expect(normalized.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("rejects single dense paragraph without line breaks", () => {
    expect(() =>
      validatePmWelcomeMessage(
        "Good evening. " +
          "On behalf of the procurement team I welcome you to this negotiation and will lead pricing terms delivery and all material aspects in a clear way. " +
          "Our objective is fair transparent agreement. Please share your proposal.",
      ),
    ).toThrow(WelcomeValidationError);
  });

  it("requires company name when provided in context", () => {
    expect(() =>
      validatePmWelcomeMessage(
        validWelcome.replace(/Acme Foods Ltd/g, "our organization"),
        ctx,
      ),
    ).toThrow(WelcomeValidationError);
  });
});
