import { describe, it, expect, beforeAll, vi } from "vitest";
import { createNegotiationGraph } from "@/modules/chatbot/engine/graph/index";
import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { getCheckpointer } from "@/modules/chatbot/engine/graph/checkpointer";

describe("AI Eval: Multi-Agent Workflow Integrated", () => {
  beforeAll(async () => {
    // Setup the checkpointer schema for LangGraph testing
    const checkpointer = await getCheckpointer();
    try {
      await checkpointer.setup();
    } catch (err) {
      // Ignore schema exists errors
    }
  });

  it("should compile the workflow and route through nodes correctly", async () => {
    const graph = await createNegotiationGraph();
    
    const initialState = {
      messages: [new HumanMessage("I want a discount on the latest offer.")],
      dealId: "workflow-test-123",
      round: 0,
    };

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    const result = await graph.invoke(initialState, config);

    // Verify state management incremented round correctly (mock parseInputNode also increments)
    expect(result.round).toBe(2);
    
    // Verify intelligence/sentiment ran
    expect(result.analysis).toBeDefined();
    expect(result.analysis.sentiment).toBe("NEUTRAL");
    
    // Verify decision ran
    expect(result.decision).toBeDefined();
    expect(result.decision.action).toBe("COUNTER");

    // Verify MESO generated offers
    expect(result.counterOffer).toBeDefined();
    
    // Verify response generation ran
    expect(result.metadata).toBeDefined();
    expect(result.metadata.lastUpdated).toBeDefined();
    
    // Since state_management runs AFTER DECIDE_STRATEGY, and the decision was COUNTER, 
    // it should have transitioned the dealStatus or set lastTransition
    expect(result.metadata.lastTransition).toBe("COUNTER");
  });
});
