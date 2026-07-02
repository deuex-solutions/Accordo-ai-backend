import { describe, it, expect } from "vitest";
import {
  countPriorPmNegotiationReplies,
  resolvePmNegotiationRoundNumber,
} from "../../../src/modules/chatbot/pipeline/negotiation-round.js";

describe("negotiation-round", () => {
  it("ignores auto-greeting ACCORDO rows without decisionAction", () => {
    const prior = [
      { role: "ACCORDO" as const, decisionAction: null },
      { role: "VENDOR" as const, decisionAction: null },
    ];
    expect(countPriorPmNegotiationReplies(prior)).toBe(0);
    expect(resolvePmNegotiationRoundNumber(prior, 0)).toBe(1);
  });

  it("increments after prior COUNTER replies", () => {
    const prior = [
      { role: "ACCORDO" as const, decisionAction: null },
      { role: "ACCORDO" as const, decisionAction: "COUNTER" },
      { role: "VENDOR" as const, decisionAction: null },
    ];
    expect(resolvePmNegotiationRoundNumber(prior, 1)).toBe(2);
  });

  it("first PM reply is round 1 even when deal.round already advanced (async vendor save)", () => {
    const prior = [{ role: "VENDOR" as const, decisionAction: null }];
    expect(resolvePmNegotiationRoundNumber(prior, 1)).toBe(1);
  });

  it("ignores WELCOME decisionAction when counting negotiation rounds", () => {
    const prior = [
      { role: "ACCORDO" as const, decisionAction: "WELCOME" },
      { role: "VENDOR" as const, decisionAction: null },
    ];
    expect(countPriorPmNegotiationReplies(prior)).toBe(0);
    expect(resolvePmNegotiationRoundNumber(prior, 1)).toBe(1);
  });
});
