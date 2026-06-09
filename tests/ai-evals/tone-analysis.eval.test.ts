import { describe, it, expect } from "vitest";
import { toneAnalysisNode } from "../../../src/modules/chatbot/engine/graph/nodes/tone-analysis.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("AI Eval: ToneAnalysisAgent", () => {
  it("should classify a formal vendor message correctly", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Dear Sir, please find our revised proposal. We respectfully request you to review it."),
      ],
    } as NegotiationState;

    const result = await toneAnalysisNode(mockState);
    
    expect(result.analysis?.tone).toBeDefined();
    expect(result.analysis?.tone?.sentiment).toBe("NEUTRAL");
    // Formality should be > 0.5 for formal messages
    expect(result.analysis?.tone?.formality).toBeGreaterThan(0.5);
    expect(result.analysis?.tone?.styleSignals).toHaveProperty("formality");
  });

  it("should classify a hostile vendor message correctly", async () => {
    const mockState = {
      messages: [
        new HumanMessage("This price is a joke. Don't insult us and stop wasting our time."),
      ],
    } as NegotiationState;

    const result = await toneAnalysisNode(mockState);
    
    expect(result.analysis?.tone).toBeDefined();
    expect(result.analysis?.tone?.sentiment).toBe("NEGATIVE");
    expect(result.analysis?.tone?.styleSignals.hostility).toBe(1);
  });

  it("should detect urgent tones accurately", async () => {
    const mockState = {
      messages: [
        new HumanMessage("We need this ASAP! The deadline is immediately approaching and it is very urgent."),
      ],
    } as NegotiationState;

    const result = await toneAnalysisNode(mockState);
    
    expect(result.analysis?.tone).toBeDefined();
    expect(result.analysis?.tone?.urgency).toBeGreaterThan(0.5);
  });

  it("should detect a friendly tone correctly", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Hello! We are very happy to work together and look forward to a great partnership. Thank you!"),
      ],
    } as NegotiationState;

    const result = await toneAnalysisNode(mockState);
    
    expect(result.analysis?.tone).toBeDefined();
    expect(result.analysis?.tone?.sentiment).toBe("POSITIVE");
  });

  it("should extract number only style signal", async () => {
    const mockState = {
      messages: [
        new HumanMessage("55000"),
      ],
    } as NegotiationState;

    const result = await toneAnalysisNode(mockState);
    
    expect(result.analysis?.tone?.styleSignals.isNumberOnly).toBe(1);
  });
});
