import { describe, it, expect } from "vitest";
import { behavioralAnalysisNode } from "../../../src/modules/chatbot/engine/graph/nodes/behavioral-analysis.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("AI Eval: BehavioralAnalysisAgent", () => {
  it("should detect STALLED concession velocity when vendor repeats offers", async () => {
    const mockState = {
      round: 3,
      messages: [
        new HumanMessage("We can offer $10000"),
        new AIMessage("That is too high, how about $8000?"),
        new HumanMessage("Best we can do is $9950"), // tiny drop
        new AIMessage("Can we do $8500?"),
        new HumanMessage("No, $9950 is final"), // stalled
      ],
    } as NegotiationState;

    const result = await behavioralAnalysisNode(mockState);
    
    expect(result.analysis?.behavior).toBeDefined();
    expect(result.analysis?.behavior?.concessionVelocity).toBe("STALLED");
    expect(result.analysis?.behavior?.rigidityScore).toBeGreaterThan(0.8);
  });

  it("should detect ACCELERATING momentum when vendor concedes rapidly", async () => {
    const mockState = {
      round: 3,
      messages: [
        new HumanMessage("We can offer $20000"),
        new AIMessage("We need $15000"),
        new HumanMessage("Okay, $18000"), // 2k drop
        new AIMessage("Still too high, $15500?"),
        new HumanMessage("Alright, $16000 it is!"), // 2k drop, converging
      ],
    } as NegotiationState;

    const result = await behavioralAnalysisNode(mockState);
    
    expect(result.analysis?.behavior).toBeDefined();
    expect(result.analysis?.behavior?.momentum).toBe("ACCELERATING");
    expect(result.analysis?.behavior?.concessionVelocity).toBe("FAST");
  });

  it("should detect high rigidity when diverging", async () => {
    const mockState = {
      round: 3,
      messages: [
        new HumanMessage("Our price is $10000"),
        new AIMessage("We need $8000"),
        new HumanMessage("Due to supply chain, it is now $11000"), // Price went UP (diverging)
      ],
    } as NegotiationState;

    const result = await behavioralAnalysisNode(mockState);
    
    expect(result.analysis?.behavior).toBeDefined();
    expect(result.analysis?.behavior?.rigidityScore).toBeGreaterThan(0.7);
    expect(result.analysis?.behavior?.momentum).toBe("DECELERATING");
  });
});
