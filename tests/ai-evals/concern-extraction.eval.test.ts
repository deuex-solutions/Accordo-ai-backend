import { describe, it, expect } from "vitest";
import { concernExtractionNode } from "../../../src/modules/chatbot/engine/graph/nodes/concern-extraction.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";
import { HumanMessage } from "@langchain/core/messages";

describe("AI Eval: ConcernExtractionAgent", () => {
  it("should extract cost concerns as PRICING category", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Due to inflation and rising material costs, we cannot lower the price.")
      ]
    } as NegotiationState;

    const result = await concernExtractionNode(mockState);
    expect(result.analysis?.concerns).toBeDefined();
    expect(result.analysis?.concerns?.some(c => c.category === "PRICING")).toBe(true);
  });

  it("should extract timeline concerns as DELIVERY category with HIGH priority", async () => {
    const mockState = {
      messages: [
        new HumanMessage("The production schedule is tight and we have a shipping delay.")
      ]
    } as NegotiationState;

    const result = await concernExtractionNode(mockState);
    expect(result.analysis?.concerns).toBeDefined();
    
    const deliveryConcern = result.analysis?.concerns?.find(c => c.category === "DELIVERY");
    expect(deliveryConcern).toBeDefined();
    
    // Recent match = high confidence = HIGH priority
    expect(deliveryConcern?.priority).toBe("HIGH");
    expect(result.analysis?.urgency).toBe("HIGH");
  });

  it("should return empty concerns if no issues mentioned", async () => {
    const mockState = {
      messages: [
        new HumanMessage("Looks good to me, let's proceed with the signing.")
      ]
    } as NegotiationState;

    const result = await concernExtractionNode(mockState);
    expect(result.analysis?.concerns?.length).toBe(0);
  });
});
