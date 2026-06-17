import { describe, it, expect } from "vitest";
import { concernExtractionNode } from "@/modules/chatbot/engine/graph/nodes/concern-extraction";
import { NegotiationState } from "@/modules/chatbot/engine/graph/state";
class HumanMessage {
  content: string;
  constructor(content: string) { this.content = content; }
  _getType() { return "human"; }
}

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
    expect(deliveryConcern?.priority).toBe("MEDIUM");
    expect(result.analysis?.urgency).toBe("MEDIUM");
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

  // REGRESSION TESTS
  it("should handle empty messages array gracefully without crashing", async () => {
    const mockState = { messages: [] } as NegotiationState;
    const result = await concernExtractionNode(mockState);
    expect(result).toEqual({});
  });

  it("should handle unexpected message types gracefully (e.g., system messages)", async () => {
    const mockState = {
      messages: [
        { _getType: () => "system", content: "Internal system error" },
        new HumanMessage("Due to inflation and rising material costs, we cannot lower the price.")
      ]
    } as any;
    const result = await concernExtractionNode(mockState);
    expect(result.analysis?.concerns).toBeDefined();
    expect(result.analysis?.concerns?.some((c: any) => c.category === "PRICING")).toBe(true);
  });
});
