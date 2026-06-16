import { describe, it, expect, beforeEach } from "vitest";
import { phrasingHistoryNode } from "../../src/modules/chatbot/engine/graph/nodes/phrasing-history.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { recordPhrasing, _resetPhrasingHistoryForTests, getPhrasings } from "../../src/llm/phrasing-history.js";

describe("AI Eval: PhrasingHistoryNode", () => {
  beforeEach(() => {
    _resetPhrasingHistoryForTests();
  });

  it("should do nothing if dealId is missing", async () => {
    const mockState: NegotiationState = {
      dealId: "",
      messages: [new AIMessage({ content: "Thank you for the proposal. Let's start.", id: "msg-1" })],
    } as any;

    const result = await phrasingHistoryNode(mockState);
    expect(result).toEqual({});
  });

  it("should skip if messages list is empty", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-123",
      messages: [],
    } as any;

    const result = await phrasingHistoryNode(mockState);
    expect(result).toEqual({});
  });

  it("should skip if last message is not an AI message", async () => {
    const mockState: NegotiationState = {
      dealId: "deal-123",
      messages: [new HumanMessage({ content: "Hello", id: "msg-1" })],
    } as any;

    const result = await phrasingHistoryNode(mockState);
    expect(result).toEqual({});
  });

  it("should record phrasing and keep unique opener intact", async () => {
    const dealId = "deal-unique";
    const initialText = "Thank you for the quick turnaround. We accept the timeline.";
    const mockState: NegotiationState = {
      dealId,
      decision: { action: "COUNTER" },
      messages: [new AIMessage({ content: initialText, id: "msg-ai-1" })],
    } as any;

    const result = await phrasingHistoryNode(mockState);

    expect(result.messages).toBeDefined();
    expect(result.messages![0].content).toBe(initialText);
    expect(result.messages![0].id).toBe("msg-ai-1");

    // Phrasing should be fingerprinted & saved
    const history = getPhrasings(dealId);
    expect(history.length).toBeGreaterThan(0);
  });

  it("should detect duplicate opener and rewrite it", async () => {
    const dealId = "deal-dup";
    const action = "COUNTER";
    
    // Seed phrasing history with a recent message using the same opener
    // Opener check is first 3 words lowercased & stripped of punctuation: "thank:you:for"
    recordPhrasing(dealId, action, "Thank you for coming back. Here is our pricing.");

    const duplicateOpenerText = "Thank you for the quick response. We will check the logistics.";
    const mockState: NegotiationState = {
      dealId,
      decision: { action },
      messages: [new AIMessage({ content: duplicateOpenerText, id: "msg-ai-2" })],
    } as any;

    const result = await phrasingHistoryNode(mockState);

    expect(result.messages).toBeDefined();
    
    const finalContent = result.messages![0].content as string;
    expect(finalContent).not.toContain("Thank you for");
    expect(finalContent).toContain("We will check the logistics.");
    expect(result.messages![0].id).toBe("msg-ai-2");

    // The new rewritten phrase should be added to the history cache
    const history = getPhrasings(dealId);
    expect(history.some(fp => fp.includes("OPENER"))).toBe(true);
  });
});
