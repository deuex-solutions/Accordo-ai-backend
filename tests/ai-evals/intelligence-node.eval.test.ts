import { describe, it, expect } from "vitest";
import { 
  toneAnalysisNode, 
  behavioralAnalysisNode, 
  concernExtractionNode, 
  mergeAnalysisNode 
} from "../../src/modules/chatbot/engine/graph/nodes/intelligence-node";
import { HumanMessage, AIMessage } from "@langchain/core/messages";

describe("AI Eval: Parallel Intelligence Nodes", () => {
  it("should run tone analysis and behavioral analysis on a hostile message", async () => {
    const state: any = {
      messages: [
        new AIMessage("We can offer $1000."),
        new HumanMessage("This quote is an absolute joke. I am not gonna happen. Final offer.")
      ],
      round: 1,
      analysis: {}
    };

    // 1. Run tone analysis
    const toneResult = await toneAnalysisNode(state);
    expect(toneResult.analysis?.tone?.sentiment).toBe("NEGATIVE");
    expect(toneResult.analysis?.tone?.styleSignals.hostility).toBe(1);

    // 2. Run behavioral analysis
    const behaviorResult = await behavioralAnalysisNode(state);
    expect(behaviorResult.analysis?.behavior?.rigidityScore).toBeGreaterThan(0.6);
  });

  it("should extract timeline concerns via concern extraction node", async () => {
    const state: any = {
      messages: [
        new AIMessage("We can deliver in 3 weeks."),
        new HumanMessage("This timeline is extremely urgent. We have a strict deadline and cannot afford shipping delays.")
      ],
      round: 2,
      analysis: {}
    };

    const concernResult = await concernExtractionNode(state);
    expect(concernResult.analysis?.concerns).toBeDefined();
    
    const deliveryConcern = concernResult.analysis?.concerns?.find(c => c.category === "DELIVERY");
    expect(deliveryConcern).toBeDefined();
    expect(deliveryConcern?.priority).toBe("HIGH");
  });

  it("should merge parallel results and calculate global urgency correctly", async () => {
    // Mock the state representing parallel nodes completing and writing to the state
    const state: any = {
      messages: [
        new AIMessage("We can deliver in 3 weeks."),
        new HumanMessage("This timeline is extremely urgent. We have a strict deadline and cannot afford shipping delays.")
      ],
      round: 2,
      analysis: {
        tone: {
          sentiment: "NEGATIVE",
          formality: 0.8,
          urgency: 1.0, // High tone urgency
          styleSignals: { hostility: 0, hasQuestion: 0, isNumberOnly: 0, repeatedOfferCount: 0 }
        },
        behavior: {
          concessionVelocity: "STEADY",
          momentum: "STABLE",
          rigidityScore: 0.5
        },
        concerns: [
          { category: "DELIVERY", description: "This timeline is extremely urgent", priority: "HIGH" }
        ]
      }
    };

    const mergedResult = await mergeAnalysisNode(state);
    
    expect(mergedResult.analysis).toBeDefined();
    expect(mergedResult.analysis.urgency).toBe("HIGH");
    expect(mergedResult.analysis.tone?.urgency).toBe(1.0);
  });
});
