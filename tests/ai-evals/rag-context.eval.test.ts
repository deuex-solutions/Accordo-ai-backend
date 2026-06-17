import { describe, it, expect, vi, beforeEach } from "vitest";
import { ragContextNode } from "../../src/modules/chatbot/engine/graph/nodes/rag-context.js";

// Mock context service
const mockGetRequisitionContext = vi.fn();
const mockGetUserPreferences = vi.fn();
vi.mock("../../src/services/context.service.js", () => {
  return {
    getRequisitionContext: (...args: any[]) => mockGetRequisitionContext(...args),
    getUserPreferences: (...args: any[]) => mockGetUserPreferences(...args),
  };
});

// Mock vector service
const mockBuildRAGContext = vi.fn();
vi.mock("../../src/modules/vector/vector.service.js", () => {
  return {
    buildRAGContext: (...args: any[]) => mockBuildRAGContext(...args),
  };
});

describe("Track 2 Week 6: RAG Context Node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return empty context when no identifiers are present in the state", async () => {
    const state: any = {
      messages: [],
      dealId: null,
      rfqId: null,
      vendorId: null,
      metadata: {},
    };

    const result = await ragContextNode(state);

    expect(mockGetRequisitionContext).not.toHaveBeenCalled();
    expect(mockGetUserPreferences).not.toHaveBeenCalled();
    expect(mockBuildRAGContext).not.toHaveBeenCalled();

    expect(result.metadata?.ragContext).toEqual({
      requisition: null,
      preferences: null,
      vectorRAG: null,
    });
  });

  it("should query all sources when identifiers and latest message exist", async () => {
    mockGetRequisitionContext.mockResolvedValue({ id: 1, subject: "Standard Laptops" });
    mockGetUserPreferences.mockResolvedValue({ batna: 750 });
    mockBuildRAGContext.mockResolvedValue({
      systemPromptAddition: "Similar successful negotiation details...",
      fewShotExamples: ["example 1"],
      similarNegotiations: ["negotiation A"],
      relevanceScores: [0.9],
    });

    const state: any = {
      messages: [{ _getType: () => "human", content: "We offer $900 unit price." }],
      dealId: "deal-456",
      rfqId: 1,
      vendorId: 2,
      metadata: {},
    };

    const result = await ragContextNode(state);

    expect(mockGetRequisitionContext).toHaveBeenCalledWith(1);
    expect(mockGetUserPreferences).toHaveBeenCalledWith(2);
    expect(mockBuildRAGContext).toHaveBeenCalledWith("deal-456", "We offer $900 unit price.");

    expect(result.metadata?.ragContext).toEqual({
      requisition: { id: 1, subject: "Standard Laptops" },
      preferences: { batna: 750 },
      vectorRAG: {
        systemPromptAddition: "Similar successful negotiation details...",
        fewShotExamples: ["example 1"],
        similarNegotiations: ["negotiation A"],
        relevanceScores: [0.9],
      },
    });
  });

  it("should apply dynamic context window management by trimming excessive lines", async () => {
    const longPromptAddition = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join("\n");
    mockBuildRAGContext.mockResolvedValue({
      systemPromptAddition: longPromptAddition,
      fewShotExamples: [],
      similarNegotiations: [],
      relevanceScores: [],
    });

    const state: any = {
      messages: [{ _getType: () => "human", content: "Need discount." }],
      dealId: "deal-789",
      metadata: {},
    };

    const result = await ragContextNode(state);

    expect(result.metadata?.ragContext?.vectorRAG?.systemPromptAddition).toContain("... (truncated for context window budget)");
    const lines = result.metadata?.ragContext?.vectorRAG?.systemPromptAddition.split("\n");
    expect(lines.length).toBeLessThan(30); // prunes to 25 lines + truncation message
  });
});
