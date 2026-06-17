import { describe, it, expect, vi, beforeEach } from "vitest";
import { bidComparisonNode } from "../../src/modules/chatbot/engine/graph/nodes/bid-comparison.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";
import { captureVendorBid, checkCompletionStatus, generateAndSendComparison } from "../../src/modules/bid-comparison/bid-comparison.service.js";

// Mock the service functions
vi.mock("../../src/modules/bid-comparison/bid-comparison.service.js", () => {
  return {
    captureVendorBid: vi.fn(),
    checkCompletionStatus: vi.fn(),
    generateAndSendComparison: vi.fn(),
  };
});

describe("AI Eval: BidComparisonNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do nothing if dealId or rfqId is missing", async () => {
    const mockState: NegotiationState = {
      dealId: "",
      rfqId: undefined,
      metadata: { dealStatus: "ACCEPTED" },
    } as any;

    const result = await bidComparisonNode(mockState);
    expect(result).toEqual({});
    expect(captureVendorBid).not.toHaveBeenCalled();
  });

  it("should skip bid capture if the deal status is active (NEGOTIATING)", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-active-123",
      rfqId: 456,
      metadata: { dealStatus: "NEGOTIATING" },
    } as any;

    const result = await bidComparisonNode(mockState);
    expect(result).toEqual({});
    expect(captureVendorBid).not.toHaveBeenCalled();
  });

  it("should capture bid and check completion, returning allCompleted: false if other bids are pending", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-term-123",
      rfqId: 456,
      metadata: { dealStatus: "ACCEPTED" },
    } as any;

    vi.mocked(captureVendorBid).mockResolvedValue({
      bidId: "bid-123",
      requisitionId: 456,
      vendorId: 789,
      finalPrice: 1000,
      bidStatus: "SUBMITTED",
      dealStatus: "ACCEPTED",
    });

    vi.mocked(checkCompletionStatus).mockResolvedValue({
      allCompleted: false,
      completedBidsCount: 1,
      totalBidsCount: 3,
      pendingBidsCount: 2,
    });

    const result = await bidComparisonNode(mockState);

    expect(captureVendorBid).toHaveBeenCalledWith("deal-term-123");
    expect(checkCompletionStatus).toHaveBeenCalledWith(456);
    expect(generateAndSendComparison).not.toHaveBeenCalled();
    expect(result).toEqual({
      metadata: {
        dealStatus: "ACCEPTED",
        bidComparisonResult: {
          allCompleted: false,
        },
      },
    });
  });

  it("should capture bid, check completion, and trigger report if all bids are completed", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-term-final",
      rfqId: 789,
      metadata: { dealStatus: "WALKED_AWAY" },
    } as any;

    vi.mocked(captureVendorBid).mockResolvedValue({
      bidId: "bid-final",
      requisitionId: 789,
      vendorId: 999,
      finalPrice: 5000,
      bidStatus: "WALKED_AWAY",
      dealStatus: "WALKED_AWAY",
    });

    vi.mocked(checkCompletionStatus).mockResolvedValue({
      allCompleted: true,
      completedBidsCount: 3,
      totalBidsCount: 3,
      pendingBidsCount: 0,
      triggerReason: "ALL_COMPLETED",
    });

    vi.mocked(generateAndSendComparison).mockResolvedValue({
      comparisonId: "comparison-abc-123",
      pdfPath: "/reports/rfq-789-comparison.pdf",
    } as any);

    const result = await bidComparisonNode(mockState);

    expect(captureVendorBid).toHaveBeenCalledWith("deal-term-final");
    expect(checkCompletionStatus).toHaveBeenCalledWith(789);
    expect(generateAndSendComparison).toHaveBeenCalledWith(789, "ALL_COMPLETED");
    expect(result).toEqual({
      metadata: {
        dealStatus: "WALKED_AWAY",
        bidComparisonResult: {
          allCompleted: true,
          comparisonId: "comparison-abc-123",
          pdfPath: "/reports/rfq-789-comparison.pdf",
        },
      },
    });
  });

  it("should log error and return empty object if service call throws", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-error-123",
      rfqId: 456,
      metadata: { dealStatus: "ESCALATED" },
    } as any;

    vi.mocked(captureVendorBid).mockRejectedValue(new Error("DB Connection Error"));

    const result = await bidComparisonNode(mockState);
    expect(result).toEqual({});
  });
});
