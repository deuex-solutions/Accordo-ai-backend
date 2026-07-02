/**
 * detectMeetingProposal — convergence / meeting-point messages
 */

import { describe, it, expect } from "vitest";
import { detectMeetingProposal } from "../../../src/modules/chatbot/engine/parse-offer.js";

describe("detectMeetingProposal", () => {
  it("detects lets meet at price", () => {
    expect(detectMeetingProposal("lets meet at 57500 at net 60")).toBe(true);
  });

  it("ignores questions", () => {
    expect(detectMeetingProposal("can we meet at 50000?")).toBe(false);
  });

  it("ignores unrelated messages", () => {
    expect(detectMeetingProposal("We can do Net 60 on this order.")).toBe(
      false,
    );
  });

  it("detects lets do with price", () => {
    expect(detectMeetingProposal("lets do 61000 for net 45")).toBe(true);
  });

  it("detects willing to do", () => {
    expect(detectMeetingProposal("i am willing to do 59500 for net 45")).toBe(
      true,
    );
  });

  it("detects max i can do", () => {
    expect(detectMeetingProposal("max i can do is 59000 for net 45")).toBe(
      true,
    );
  });
});
