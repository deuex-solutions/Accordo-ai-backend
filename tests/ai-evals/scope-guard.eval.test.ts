import { describe, it, expect } from "vitest";
import { scopeGuardNode } from "../../../src/modules/chatbot/engine/graph/nodes/scope-guard.js";
import { NegotiationState } from "../../../src/modules/chatbot/engine/graph/state.js";
import { HumanMessage } from "@langchain/core/messages";

describe("AI Eval: ScopeGuardAgent", () => {
  it("should block off-topic weather questions and issue a canned response", async () => {
    const mockState = {
      messages: [new HumanMessage("Hey, how is the weather over there today?")]
    } as NegotiationState;

    const result = await scopeGuardNode(mockState);
    
    expect(result.decision?.action).toBe("OFF_TOPIC");
    expect(result.metadata?.scopeGuardFailed).toBe(true);
    expect(result.messages).toBeDefined();
    expect(result.messages?.[0]._getType()).toBe("ai");
    expect(result.messages?.[0].content).toContain("could we continue discussing");
  });

  it("should pass standard negotiation messages (safelisted)", async () => {
    const mockState = {
      messages: [new HumanMessage("We can offer $12,000 for the shipment, let me know if you agree.")]
    } as NegotiationState;

    const result = await scopeGuardNode(mockState);
    
    // Should NOT return an OFF_TOPIC decision, should just pass
    expect(result.decision).toBeUndefined();
    expect(result.metadata?.scopeGuardPassed).toBe(true);
    expect(result.messages).toBeUndefined(); // no canned response injected
  });

  it("should block off-topic coding questions", async () => {
    const mockState = {
      messages: [new HumanMessage("Can you write a python script for me to parse CSV files?")]
    } as NegotiationState;

    const result = await scopeGuardNode(mockState);
    
    expect(result.decision?.action).toBe("OFF_TOPIC");
    expect(result.metadata?.scopeGuardFailed).toBe(true);
  });
});
