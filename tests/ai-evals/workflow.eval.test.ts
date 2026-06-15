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

// Mock models to return standard mock data for the email & document nodes
vi.mock("../../src/models/index.js", () => {
  return {
    default: {
      ChatbotDeal: {
        findByPk: vi.fn().mockResolvedValue({
          id: "workflow-test-123",
          status: "NEGOTIATING",
          Contract: { id: 1, Vendor: { name: "Vendor A", email: "vendor@test.com" } },
          Requisition: { id: 1, subject: "Req A", Project: { name: "Proj A" }, toJSON: function() { return this; } },
          Messages: [],
        }),
      },
    },
  };
});

// Mock email service
vi.mock("../../src/services/email.service.js", () => {
  return {
    sendVendorAttachedEmail: vi.fn(),
    sendStatusChangeEmail: vi.fn(),
  };
});

// Mock PDF generator
vi.mock("../../src/modules/chatbot/pdf/deal-summary-pdf-generator.js", () => {
  return {
    saveDealSummaryPDF: vi.fn().mockResolvedValue("/uploads/pdfs/summary.pdf"),
  };
});

// Mock bid comparison service
vi.mock("../../src/modules/bid-comparison/bid-comparison.service.js", () => {
  return {
    generateAndSendComparison: vi.fn(),
    checkCompletionStatus: vi.fn().mockResolvedValue({ allCompleted: false }),
  };
});

import { createNegotiationGraph } from "../../src/modules/chatbot/engine/graph/index";
import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

describe("AI Eval: Multi-Agent Workflow Integrated", () => {
  it("should compile the workflow and route through nodes correctly", async () => {
    const graph = await createNegotiationGraph();
    
    const initialState = {
      messages: [new HumanMessage("I want a discount on the latest offer.")],
      dealId: "workflow-test-123",
      rfqId: 1,
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
