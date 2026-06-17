import { describe, it, expect, vi, beforeEach } from "vitest";
import { emailNotificationNode } from "../../src/modules/chatbot/engine/graph/nodes/email-notification";

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

// Mock email service
const mockSendVendorAttachedEmail = vi.fn();
const mockSendStatusChangeEmail = vi.fn();
vi.mock("../../src/services/email.service.js", () => {
  return {
    sendVendorAttachedEmail: (...args: any[]) => mockSendVendorAttachedEmail(...args),
    sendStatusChangeEmail: (...args: any[]) => mockSendStatusChangeEmail(...args),
  };
});

import models from "../../src/models/index.js";

describe("Track 3 Week 6: Email Notification Node", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send vendor welcome email on round 1 if not already sent", async () => {
    const mockDeal = {
      id: "deal-123",
      status: "NEGOTIATING",
      Contract: {
        id: 1,
        vendorId: 2,
        Vendor: { name: "Test Vendor", email: "vendor@test.com" },
      },
      Requisition: {
        id: 1,
        subject: "Test Requisition",
        Project: { name: "Test Project" },
        RequisitionProduct: [
          { Product: { productName: "Item A" }, qty: 10, targetPrice: 100 },
        ],
        toJSON: function () {
          return this;
        },
      },
    };

    vi.mocked(models.ChatbotDeal.findByPk).mockResolvedValue(mockDeal as any);

    const state: any = {
      dealId: "deal-123",
      round: 1,
      metadata: {
        sentEmails: [],
      },
    };

    const result = await emailNotificationNode(state);

    expect(mockSendVendorAttachedEmail).toHaveBeenCalled();
    expect(result.metadata?.sentEmails).toContain("vendor_attached");
  });

  it("should send status change email if deal status changed", async () => {
    const mockDeal = {
      id: "deal-123",
      status: "NEGOTIATING",
      Contract: {
        id: 1,
        vendorId: 2,
        Vendor: { name: "Test Vendor", email: "vendor@test.com" },
      },
      Requisition: {
        id: 1,
        subject: "Test Requisition",
        toJSON: function () {
          return this;
        },
      },
    };

    vi.mocked(models.ChatbotDeal.findByPk).mockResolvedValue(mockDeal as any);

    const state: any = {
      dealId: "deal-123",
      round: 2,
      metadata: {
        dealStatus: "ACCEPTED",
        sentEmails: [],
      },
    };

    const result = await emailNotificationNode(state);

    expect(mockSendStatusChangeEmail).toHaveBeenCalled();
    expect(result.metadata?.sentEmails).toContain("status_change_ACCEPTED");
  });
});
