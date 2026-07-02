import { describe, it, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

// Mock the checkpointer to return MemorySaver directly
const mockMemorySaver = new MemorySaver();
vi.mock("../../src/modules/chatbot/engine/graph/checkpointer.js", () => {
  return {
    getCheckpointer: () => {
      return mockMemorySaver;
    },
  };
});

import { createNegotiationGraph } from "../../src/modules/chatbot/engine/graph/index.js";
import { weightedUtilityNode } from "../../src/modules/chatbot/engine/graph/nodes/weighted-utility.js";

describe("Track 1 Week 6: Weighted Utility & HITL Interruption Hooks", () => {
  it("should calculate utility correctly in weightedUtilityNode", async () => {
    const state: any = {
      parsedOffer: {
        totalPrice: 900,
        paymentTermsDays: 30,
      },
      config: {
        priceQuantity: { targetUnitPrice: 800, maxAcceptablePrice: 1000 },
        parameterWeights: { targetUnitPrice: 100, paymentTermsDays: 0 },
        acceptThreshold: 0.7,
        escalateThreshold: 0.5,
        walkAwayThreshold: 0.3,
      },
      metadata: {},
    };

    const result = await weightedUtilityNode(state);

    expect(result.decision?.utilityScore).toBeDefined();
    // NPV-based Effective Cost Utility score = 0.537
    expect(result.decision?.utilityScore).toBeCloseTo(0.537, 3);
    expect(result.metadata?.utilityResult.totalUtility).toBeCloseTo(0.537, 3);
  });

  it("should compile graph and interrupt on high-value deal, then resume on approval", async () => {
    const graph = await createNegotiationGraph();

    const initialState = {
      messages: [new HumanMessage("We want to negotiate.")],
      dealId: "d0000000-0000-0000-0000-000000000123",
      round: 0,
      config: {
        priceQuantity: { targetUnitPrice: 800000000, maxAcceptablePrice: 1200000000 },
        parameterWeights: { targetUnitPrice: 100 },
      },
      parsedOffer: {
        totalPrice: 1100000000, // ₹110 Cr (High value!)
      },
      metadata: {},
    };

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    // Invoke graph: it should run up to the human_intervention node and interrupt (pause)
    const result = await graph.invoke(initialState, config);

    // Verify it paused before entering risk_guard
    const stateHistory = await graph.getState(config);
    expect(stateHistory.next).toContain("risk_guard");

    // Now, resume the graph with human approval.
    // Update the state to indicate approval and resume
    await graph.updateState(config, {
      metadata: { approvedByHuman: true },
    });

    // Resume the graph by invoking it with null input
    const finalResult = await graph.invoke(null, config);

    // Verify the graph completed and did NOT pause again
    const finalState = await graph.getState(config);
    expect(finalState.next).toEqual([]); // completed!
    expect(finalResult.metadata.approvedByHuman).toBe(true);
  });
});
