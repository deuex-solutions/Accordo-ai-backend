import { describe, it, expect, beforeEach } from "vitest";
import { processConversationTurn } from "../../src/modules/chatbot/convo/process-conversation-turn.js";
import models from "../../src/models/index.js";
const { ChatbotDeal, ChatbotTemplate, ChatbotMessage } = models;
import { getCheckpointer } from "../../src/modules/chatbot/engine/graph/checkpointer.js";
import { v4 as uuidv4 } from "uuid";

import {
  classifyVendorIntent,
  classifyRefusal,
  handleRefusal,
  handleSmallTalk,
  determineNextIntent,
  updateConvoState,
  initializeConvoState,
  type VendorIntent,
  type RefusalType,
} from "../../src/modules/chatbot/convo/enhanced-convo-router.js";
import {
  generateConversationMessage,
  type ConvoIntent,
} from "../../src/modules/chatbot/convo/conversation-templates.js";
import { checkScopeGuard } from "../../src/modules/chatbot/engine/scope-guard.js";
import { prepareTemplateVariables } from "../../src/modules/chatbot/convo/process-conversation-turn.js";

// Legacy in-memory implementation for 1-to-1 comparison
async function legacyProcessConversationTurn(
  deal: any,
  template: any,
  convoState: any,
  vendorMessage: string,
  conversationHistory: any[]
) {
  // Scope Guard
  const scopeCheck = checkScopeGuard(vendorMessage, deal.title);
  if (scopeCheck.isOffTopic) {
    return {
      accordoMessage: scopeCheck.response!,
      accordoIntent: 'REDIRECT' as ConvoIntent,
      updatedState: convoState,
      vendorIntent: 'SMALL_TALK' as VendorIntent,
      refusalType: undefined,
    };
  }

  // Classify vendor intent
  const vendorIntent = await classifyVendorIntent(vendorMessage, conversationHistory);

  let refusalType: RefusalType | undefined;
  let nextIntent: ConvoIntent;

  if (vendorIntent === 'REFUSAL') {
    refusalType = await classifyRefusal(vendorMessage);
    nextIntent = handleRefusal(convoState, refusalType);
  } else if (vendorIntent === 'SMALL_TALK') {
    nextIntent = handleSmallTalk(convoState);
  } else {
    nextIntent = determineNextIntent(convoState, vendorIntent, vendorMessage);
  }

  // Prepare template variables
  const templateVariables = await prepareTemplateVariables(
    deal,
    template,
    convoState,
    nextIntent,
    vendorMessage
  );

  // Generate Accordo message using templates
  const accordoMessage = generateConversationMessage(
    deal.id,
    deal.round,
    nextIntent,
    templateVariables
  );

  // Update conversation state
  const updatedState = updateConvoState(
    { ...convoState },
    vendorIntent,
    nextIntent
  );

  return {
    accordoMessage,
    accordoIntent: nextIntent,
    updatedState,
    vendorIntent,
    refusalType,
  };
}

describe("Conversation Orchestrator Parity & AI Eval", () => {
  let template: ChatbotTemplate;

  beforeEach(async () => {
    // Sync LangGraph checkpointer DB schema
    const checkpointer = await getCheckpointer();
    try {
      await checkpointer.setup();
    } catch (err) {
      // Ignore if schema already exists
    }

    // Seed a standard template
    template = await ChatbotTemplate.create({
      id: uuidv4(),
      name: "Default Template",
      configJson: {
        productName: "Server Racks",
        quantity: 50,
        targetPrice: 900,
        marketPrice: 950,
        volume: 50,
        paymentTerms: "Net 30",
        maxAcceptablePrice: 1100,
      },
    });
  });

  const testCases = [
    // 1. Greetings
    {
      name: "Greeting - formal",
      message: "Hello there, glad to connect. Hope we can align on terms.",
      startPhase: "GREET",
    },
    {
      name: "Greeting - informal",
      message: "Hi, let's talk about the order requirements.",
      startPhase: "GREET",
    },
    // 2. Small Talk
    {
      name: "Small Talk - weather",
      message: "Nice sunny day in San Francisco today, isn't it?",
      startPhase: "GREET",
    },
    {
      name: "Small Talk - weekend",
      message: "Hope you had a nice weekend, let's get back to business.",
      startPhase: "ASK_OFFER",
    },
    // 3. Direct Refusals
    {
      name: "Refusal - direct no",
      message: "We cannot share our internal manufacturing cost or price sheets.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Refusal - share later",
      message: "I will get back to you with the unit price tomorrow.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Refusal - already shared",
      message: "I already sent all details in the initial bid package.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Refusal - confused",
      message: "I don't understand what specific breakdown you are asking for.",
      startPhase: "ASK_OFFER",
    },
    // 4. Questions & Clarifications
    {
      name: "Question - delivery details",
      message: "Could you clarify what your target delivery dates are?",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Question - payment terms",
      message: "What are your preferred payment terms for this volume?",
      startPhase: "ASK_OFFER",
    },
    // 5. Price Offers
    {
      name: "Price Offer - high price",
      message: "Our price is $1,250 per unit.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Price Offer - target price match",
      message: "We can agree to $900 per unit.",
      startPhase: "ASK_OFFER",
    },
    // 6. Payment Terms
    {
      name: "Payment Terms - Net 30",
      message: "Our terms require payment Net 30 days.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Payment Terms - Net 60",
      message: "We accept payment Net 60 days.",
      startPhase: "ASK_OFFER",
    },
    // 7. Offers (Pricing + Terms combined)
    {
      name: "Provide Offer - balanced package",
      message: "We can do $950 per unit with Net 45 payment terms.",
      startPhase: "ASK_OFFER",
    },
    {
      name: "Provide Offer - premium package",
      message: "Price is $1,050 per unit with Net 30 days.",
      startPhase: "NEGOTIATING",
    },
    // 8. Agreement
    {
      name: "Agreement - direct accept",
      message: "That works for us. We accept your proposal.",
      startPhase: "NEGOTIATING",
    },
    {
      name: "Agreement - informal acceptance",
      message: "Looks good, agreed. Let's do it.",
      startPhase: "NEGOTIATING",
    },
    // 9. Pushing back / Negotiating
    {
      name: "Negotiate - price pushback",
      message: "We can't go that low. The absolute minimum we can offer is $980.",
      startPhase: "NEGOTIATING",
    },
    {
      name: "Negotiate - payment terms pushback",
      message: "We need Net 45 days, Net 30 is too tight for our cash flow.",
      startPhase: "NEGOTIATING",
    },
    // 10. Off-topic (Scope Guard)
    {
      name: "Off-topic - cooking recipe",
      message: "Do you have a good recipe for chocolate chip cookies?",
      startPhase: "NEGOTIATING",
    },
  ];

  for (const tc of testCases) {
    it(`should match legacy behavior for case: "${tc.name}"`, async () => {
      // 1. Initialize states
      const startConvoState = initializeConvoState();
      startConvoState.phase = tc.startPhase as any;
      if (tc.startPhase === "NEGOTIATING") {
        startConvoState.context.mentionedPrice = true;
        startConvoState.context.mentionedTerms = true;
      }

      // Create a unique deal ID
      const dealId = uuidv4();

      // Seed the deal in the database for the LangGraph orchestrator
      const deal = await ChatbotDeal.create({
        id: dealId,
        title: "Database Server Rack Procurement",
        mode: "CONVERSATION",
        status: "NEGOTIATING",
        round: 1,
        templateId: template.id,
        convoStateJson: startConvoState,
        counterparty: "VendorCo",
      });

      // 2. Run the legacy version in-memory
      const legacyResult = await legacyProcessConversationTurn(
        deal,
        template,
        startConvoState,
        tc.message,
        [] // Start with empty history
      );

      // 3. Run the new LangGraph-based turn orchestrator
      const newResult = await processConversationTurn({
        dealId: deal.id,
        vendorMessage: tc.message,
        userId: 999,
      });

      // 4. Verify outputs parity
      expect(newResult.accordoIntent).toBe(legacyResult.accordoIntent);
      expect(newResult.vendorIntent).toBe(legacyResult.vendorIntent);
      expect(newResult.refusalType).toBe(legacyResult.refusalType);
      expect(newResult.accordoMessage).toBe(legacyResult.accordoMessage);

      // 5. Verify conversation state channel parity
      expect(newResult.updatedState.phase).toBe(legacyResult.updatedState.phase);
      expect(newResult.updatedState.turnCount).toBe(legacyResult.updatedState.turnCount);
      expect(newResult.updatedState.refusalCount).toBe(legacyResult.updatedState.refusalCount);
      expect(newResult.updatedState.smallTalkCount).toBe(legacyResult.updatedState.smallTalkCount);
    });
  }
});
