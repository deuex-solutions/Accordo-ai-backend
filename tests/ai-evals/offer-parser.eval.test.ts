import { describe, it, expect } from "vitest";
import { offerParsingNode } from "../../src/modules/chatbot/engine/graph/nodes/offer-parser.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";

class HumanMessage {
  content: string;
  id: string;
  constructor(content: string, id: string = "msg-1") {
    this.content = content;
    this.id = id;
  }
  _getType() { return "human"; }
}

class AIMessage {
  content: string;
  id: string;
  constructor(content: string, id: string = "msg-2") {
    this.content = content;
    this.id = id;
  }
  _getType() { return "ai"; }
}

describe("AI Eval: OfferParsingAgent", () => {
  it("should parse K shorthand from vendor message", async () => {
    const mockState = {
      messages: [
        new HumanMessage("We can offer the units at $15k each.", "h-1")
      ],
      config: { currency: "USD" }
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result.parsedOffer).toBeDefined();
    expect(result.parsedOffer?.totalPrice).toBe(15000);
    expect(result.metadata?.lastParsedMessageId).toBe("h-1");
  });

  it("should parse M shorthand from vendor message", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Total for the order is $1.5M.", "h-1b")
      ],
      config: { currency: "USD" }
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result.parsedOffer).toBeDefined();
    expect(result.parsedOffer?.totalPrice).toBe(1500000);
  });

  it("should parse Indian lakhs formatted number", async () => {
    const mockState = {
      messages: [
        new HumanMessage("The absolute best price we can provide is Rs. 5,00,000.", "h-2")
      ],
      config: { currency: "INR" }
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result.parsedOffer).toBeDefined();
    expect(result.parsedOffer?.totalPrice).toBe(500000); // 5,00,000
    expect(result.metadata?.lastParsedMessageId).toBe("h-2");
  });

  it("should parse payment terms and delivery terms", async () => {
    const mockState = {
      messages: [
        new HumanMessage("We will sell for $5000 with payment Net 45 and delivery in 15 days.", "h-3")
      ],
      config: { currency: "USD" }
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result.parsedOffer).toBeDefined();
    expect(result.parsedOffer?.totalPrice).toBe(5000);
    expect(result.parsedOffer?.paymentTerms).toBe("Net 45");
    expect(result.parsedOffer?.paymentTermsDays).toBe(45);
    expect(result.parsedOffer?.deliveryDays).toBe(15);
  });

  it("should return empty state when last message is not from human", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Here is my bid: $5000", "h-4"),
        new AIMessage("Thank you, we will consider it.", "a-1")
      ]
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result).toEqual({});
  });

  it("should return empty state when no offer terms are present in the vendor message", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Hello, how was your weekend?", "h-5")
      ]
    } as unknown as NegotiationState;

    const result = await offerParsingNode(mockState);
    expect(result).toEqual({});
  });
});
