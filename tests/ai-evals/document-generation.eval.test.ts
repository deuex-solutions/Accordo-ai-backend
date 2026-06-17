import { describe, it, expect, vi, beforeEach } from "vitest";
import { documentGenerationNode } from "../../src/modules/chatbot/engine/graph/nodes/document-generation";

// Mock models
vi.mock("../../src/models/index.js", () => {
  return {
    default: {
      ChatbotDeal: {
        findByPk: vi.fn(),
      },
    },
  };
});

// Mock chatbot services
const mockGetDealSummaryService = vi.fn();
vi.mock("../../src/modules/chatbot/chatbot.service.js", () => {
  return {
    getDealSummaryService: (...args: any[]) => mockGetDealSummaryService(...args),
  };
});

// Mock PDF generator
const mockSaveDealSummaryPDF = vi.fn();
vi.mock("../../src/modules/chatbot/pdf/deal-summary-pdf-generator.js", () => {
  return {
    saveDealSummaryPDF: (...args: any[]) => mockSaveDealSummaryPDF(...args),
  };
});

// Mock bid comparison service
const mockGenerateAndSendComparison = vi.fn();
const mockCheckCompletionStatus = vi.fn();
vi.mock("../../src/modules/bid-comparison/bid-comparison.service.js", () => {
  return {
    generateAndSendComparison: (...args: any[]) => mockGenerateAndSendComparison(...args),
    checkCompletionStatus: (...args: any[]) => mockCheckCompletionStatus(...args),
  };
});

import models from "../../src/models/index.js";

describe("Track 3 Week 6: Document Generation Node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should not generate PDF if deal is still negotiating", async () => {
    const mockDeal = {
      id: "deal-123",
      status: "NEGOTIATING",
      Messages: [],
    };
    vi.mocked(models.ChatbotDeal.findByPk).mockResolvedValue(mockDeal as any);

    const state: any = {
      dealId: "deal-123",
      rfqId: 1,
      metadata: {
        dealStatus: "NEGOTIATING",
        pdfGenerated: false,
      },
    };

    const result = await documentGenerationNode(state);

    expect(mockSaveDealSummaryPDF).not.toHaveBeenCalled();
    expect(result.metadata?.pdfGenerated).toBe(false);
  });

  it("should generate Deal Summary PDF when deal transitions to accepted", async () => {
    const mockDeal = {
      id: "deal-123",
      status: "NEGOTIATING",
      Messages: [],
    };
    vi.mocked(models.ChatbotDeal.findByPk).mockResolvedValue(mockDeal as any);

    mockGetDealSummaryService.mockResolvedValue({
      deal: { id: "deal-123", vendorName: "Vendor A" },
      finalOffer: {},
      metrics: {},
      timeline: [],
    });
    mockSaveDealSummaryPDF.mockResolvedValue("/uploads/pdfs/summary.pdf");
    mockCheckCompletionStatus.mockResolvedValue({ allCompleted: false });

    const state: any = {
      dealId: "deal-123",
      rfqId: 1,
      metadata: {
        dealStatus: "ACCEPTED",
        pdfGenerated: false,
      },
    };

    const result = await documentGenerationNode(state);

    expect(mockSaveDealSummaryPDF).toHaveBeenCalled();
    expect(result.metadata?.pdfGenerated).toBe(true);
    expect(result.metadata?.pdfPath).toBe("/uploads/pdfs/summary.pdf");
    expect(mockGenerateAndSendComparison).not.toHaveBeenCalled();
  });

  it("should trigger RFQ Bid Comparison PDF if all deals are completed", async () => {
    const mockDeal = {
      id: "deal-123",
      status: "NEGOTIATING",
      Messages: [],
    };
    vi.mocked(models.ChatbotDeal.findByPk).mockResolvedValue(mockDeal as any);

    mockGetDealSummaryService.mockResolvedValue({
      deal: { id: "deal-123", vendorName: "Vendor A" },
      finalOffer: {},
      metrics: {},
      timeline: [],
    });
    mockSaveDealSummaryPDF.mockResolvedValue("/uploads/pdfs/summary.pdf");
    mockCheckCompletionStatus.mockResolvedValue({ allCompleted: true });
    mockGenerateAndSendComparison.mockResolvedValue({ pdfPath: "/uploads/pdfs/comparison.pdf" });

    const state: any = {
      dealId: "deal-123",
      rfqId: 1,
      metadata: {
        dealStatus: "ACCEPTED",
        pdfGenerated: false,
      },
    };

    const result = await documentGenerationNode(state);

    expect(mockSaveDealSummaryPDF).toHaveBeenCalled();
    expect(mockGenerateAndSendComparison).toHaveBeenCalledWith(1, "ALL_COMPLETED");
    expect(result.metadata?.comparisonPath).toBe("/uploads/pdfs/comparison.pdf");
  });
});
