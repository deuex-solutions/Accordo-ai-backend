import { describe, it, expect, beforeEach } from "vitest";
import { processConversationTurn } from "../../src/modules/chatbot/convo/process-conversation-turn.js";
import models from "../../src/models/index.js";
import { getCheckpointer } from "../../src/modules/chatbot/engine/graph/checkpointer.js";
import { v4 as uuidv4 } from "uuid";
import { initializeConvoState } from "../../src/modules/chatbot/convo/enhanced-convo-router.js";

const { ChatbotDeal, ChatbotTemplate } = models;

describe("AI Eval: Scenario-based Negotiation Workflows", () => {
  let template: any;

  beforeEach(async () => {
    // Setup checkpointer schema
    const checkpointer = await getCheckpointer();
    try {
      await checkpointer.setup();
    } catch (err) {
      // Ignore if schema already exists
    }

    // Seed default template
    template = await ChatbotTemplate.create({
      id: uuidv4(),
      name: "Procurement Template",
      configJson: {
        productName: "High Performance GPUs",
        quantity: 10,
        targetPrice: 3000,
        marketPrice: 3200,
        volume: 10,
        paymentTerms: "Net 30",
        maxAcceptablePrice: 3500,
      },
    });
  });

  it("should trigger Scope Guard and Redirect for off-topic small talk", async () => {
    const dealId = uuidv4();
    const deal = await ChatbotDeal.create({
      id: dealId,
      title: "GPU Server Procurement",
      mode: "CONVERSATION",
      status: "NEGOTIATING",
      round: 1,
      templateId: template.id,
      convoStateJson: initializeConvoState(),
      counterparty: "NVIDIA Reseller",
    });

    const result = await processConversationTurn({
      dealId: deal.id,
      vendorMessage: "Can you write a python script for me to parse CSV files?",
      userId: 1
    });

    expect(result.accordoIntent).toBe("REDIRECT");
    expect(result.vendorIntent).toBe("SMALL_TALK");
    expect(result.accordoMessage).toContain("focused on our negotiation");
  });

  it("should parse vendor price and update conversation state context", async () => {
    const dealId = uuidv4();
    const startState = initializeConvoState();
    const deal = await ChatbotDeal.create({
      id: dealId,
      title: "GPU Server Procurement",
      mode: "CONVERSATION",
      status: "NEGOTIATING",
      round: 1,
      templateId: template.id,
      convoStateJson: startState,
      counterparty: "NVIDIA Reseller",
    });

    const result = await processConversationTurn({
      dealId: deal.id,
      vendorMessage: "We can do a special rate of $3,400 per unit.",
      userId: 1
    });

    // Check that vendor offer was parsed
    expect(result.vendorIntent).toBe("PROVIDE_OFFER");
    expect(result.updatedState.context.mentionedPrice).toBe(true);
  });

  it("should fail with NotFoundError when processing an invalid deal ID", async () => {
    const invalidId = uuidv4();
    
    await expect(
      processConversationTurn({
        dealId: invalidId,
        vendorMessage: "Hello",
        userId: 1
      })
    ).rejects.toThrow();
  });
});
