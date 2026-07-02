import { describe, it, expect, vi } from "vitest";
import { MemorySaver } from "@langchain/langgraph";

// Mock the checkpointer to return MemorySaver directly
const mockMemorySaver = new MemorySaver();
vi.mock("../../src/modules/chatbot/engine/graph/checkpointer.js", () => {
  return {
    getCheckpointer: () => {
      return mockMemorySaver;
    },
  };
});

// Mock database models to avoid database queries during the workflow E2E run
vi.mock("../../src/models/index.js", () => {
  return {
    default: {
      ChatbotDeal: {
        findByPk: vi.fn().mockResolvedValue({
          id: "workflow-test-123",
          status: "NEGOTIATING",
          Messages: [],
        }),
      },
    },
  };
});

// Mock context service queries
vi.mock("../../src/services/context.service.js", () => {
  return {
    getRequisitionContext: vi.fn().mockResolvedValue({
      id: 1,
      rfqId: "rfq-test",
      subject: "Test Requisition",
      category: "Test Category",
    }),
    getUserPreferences: vi.fn().mockResolvedValue({
      batna: 800,
      maxDiscount: 0.2,
      priceWeight: 50,
      deliveryWeight: 50,
    }),
  };
});

// Mock vector service queries
vi.mock("../../src/modules/vector/vector.service.js", () => {
  return {
    buildRAGContext: vi.fn().mockResolvedValue({
      systemPromptAddition: "[Retrieved Context] Similar successful negotiation details...",
      fewShotExamples: ["past response 1", "past response 2"],
      similarNegotiations: ["negotiation 1"],
      relevanceScores: [0.85],
    }),
  };
});

import { createNegotiationGraph } from "../../src/modules/chatbot/engine/graph/index.js";
import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

describe("AI Eval: Multi-Agent Workflow Integrated", () => {
  it("should compile the workflow and route through nodes correctly", async () => {
    const graph = await createNegotiationGraph();
    
    const initialState = {
      messages: [new HumanMessage("I want a discount on the latest offer.")],
      dealId: "workflow-test-123",
      rfqId: 1,
      vendorId: 2,
      round: 0,
      config: {
        priceQuantity: { targetUnitPrice: 800, maxAcceptablePrice: 1000 },
        priority: "MEDIUM",
        paymentTerms: { minDays: 15, maxDays: 45 },
        parameterWeights: { targetUnitPrice: 50, paymentTermsDays: 50 }
      },
      parsedOffer: {
        totalPrice: 900,
        paymentTermsDays: 30
      }
    };

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    const result = await graph.invoke(initialState, config);

    // Verify state management incremented round correctly
    expect(result.round).toBe(1);
    
    // Verify intelligence/sentiment ran
    expect(result.analysis).toBeDefined();
    expect(result.analysis.tone?.sentiment).toBe("POSITIVE");
    
    // Verify decision ran
    expect(result.decision).toBeDefined();
    expect(result.decision.action).toBe("COUNTER");
    expect(result.decision.utilityScore).toBeCloseTo(0.502, 3); // verified that weightedUtilityNode ran!

    // Verify RAG context was assembled and fused in metadata
    expect(result.metadata.ragContext).toBeDefined();
    expect(result.metadata.ragContext.requisition?.rfqId).toBe("rfq-test");
    expect(result.metadata.ragContext.preferences?.batna).toBe(800);
    expect(result.metadata.ragContext.vectorRAG?.systemPromptAddition).toContain("Similar successful negotiation");

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
