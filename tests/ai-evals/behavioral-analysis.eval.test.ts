import { describe, it, expect } from "vitest";
import { behavioralAnalysisNode } from "@/modules/chatbot/engine/graph/nodes/behavioral-analysis";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";
class HumanMessage {
  content: string;
  constructor(content: string) { this.content = content; }
  _getType() { return "human"; }
}
class AIMessage {
  content: string;
  constructor(content: string) { this.content = content; }
  _getType() { return "ai"; }
}

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
    expect(result.analysis?.behavior?.rigidityScore).toBeGreaterThan(0.5);
    expect(result.analysis?.behavior?.momentum).toBe("STABLE");
  });

  // REGRESSION TESTS
  it("should handle a single vendor message gracefully without failing", async () => {
    const mockState = {
      round: 1,
      messages: [
        new HumanMessage("This is our opening offer: $50000"),
      ],
    } as NegotiationState;

    const result = await behavioralAnalysisNode(mockState);
    expect(result.analysis?.behavior).toBeDefined();
    // With only one message, momentum should likely be stable
    expect(["STABLE", "DECELERATING", "ACCELERATING"]).toContain(result.analysis?.behavior?.momentum);
  });

  it("should handle missing price in human messages gracefully", async () => {
    const mockState = {
      round: 2,
      messages: [
        new HumanMessage("We can't agree to the timeline."),
        new AIMessage("How about $45000?"),
        new HumanMessage("Let me check with my manager."),
      ],
    } as NegotiationState;

    const result = await behavioralAnalysisNode(mockState);
    expect(result.analysis?.behavior).toBeDefined();
    expect(result.analysis?.behavior?.rigidityScore).toBeGreaterThanOrEqual(0);
  });
});
