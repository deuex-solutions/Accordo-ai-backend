import { describe, it, expect } from "vitest";
import { analyzeSentimentNode } from "@/modules/chatbot/engine/graph/nodes/intelligence-node";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("AI Eval: Intelligence Node (analyzeSentimentNode)", () => {
  it("should detect firm and negative tone correctly from hostile messages", async () => {
    const state: any = {
      messages: [
        new AIMessage("We can offer $1000."),
        new HumanMessage("This quote is an absolute joke. I am not gonna happen. Final offer.")
      ],
      round: 1
    };

    const result = await analyzeSentimentNode(state);

    expect(result.analysis).toBeDefined();
    
    // Tone
    expect(result.analysis.tone?.sentiment).toBe("NEGATIVE");
    expect(result.analysis.tone?.styleSignals.hostility).toBe(1);
    
    // Rigidity Score should be high because of strict firmness + hostility
    expect(result.analysis.behavior?.rigidityScore).toBeGreaterThan(0.6);
  });

  it("should extract timeline concerns and mark global urgency as HIGH", async () => {
    const state: any = {
      messages: [
        new AIMessage("We can deliver in 3 weeks."),
        new HumanMessage("This timeline is extremely urgent. We have a strict deadline and cannot afford shipping delays.")
      ],
      round: 2
    };

    const result = await analyzeSentimentNode(state);

    expect(result.analysis).toBeDefined();
    
    // Urgency
    expect(result.analysis.urgency).toBe("HIGH");
    
    // Concerns
    expect(result.analysis.concerns).toBeDefined();
    const deliveryConcern = result.analysis.concerns?.find(c => c.category === "DELIVERY");
    expect(deliveryConcern).toBeDefined();
    expect(deliveryConcern?.priority).toBe("HIGH");
  });

  it("should detect positive tone and stable momentum from friendly messages", async () => {
    const state: any = {
      messages: [
        new HumanMessage("Hi! Thanks for the proposal. We agree to the terms. Let's make this work.")
      ],
      round: 1
    };

    const result = await analyzeSentimentNode(state);

    expect(result.analysis).toBeDefined();
    
    // Tone
    expect(result.analysis.tone?.sentiment).toBe("POSITIVE");
    
    // Momentum
    expect(["ACCELERATING", "STABLE"]).toContain(result.analysis.behavior?.momentum);
    
    // Should have greeting detected
    expect(result.analysis.tone?.formality).toBeLessThan(0.7); // Casual/friendly
  });
});
