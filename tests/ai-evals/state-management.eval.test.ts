import { describe, it, expect } from "vitest";
import { stateManagementNode } from "../../src/modules/chatbot/engine/graph/nodes/state-management.js";
import { NegotiationState } from "../../src/modules/chatbot/engine/graph/state.js";

describe("AI Eval: StateManagementAgent", () => {
  it("should transition NEGOTIATING -> ACCEPTED when action is ACCEPT", async () => {
    const mockState = {
      decision: { action: "ACCEPT", reasoning: "Fair price", confidence: 1.0 },
      metadata: {
        dealStatus: "NEGOTIATING",
        mode: "INSIGHTS"
      },
      round: 1
    } as unknown as NegotiationState;

    const result = await stateManagementNode(mockState);
    
    expect(result.metadata?.dealStatus).toBe("ACCEPTED");
    expect(result.metadata?.lastTransition).toBe("ACCEPT");
    expect(result.metadata?.transitionTime).toBeDefined();
    expect(result.round).toBeUndefined(); // Should not increment round for accept
  });

  it("should increment round when action is COUNTER", async () => {
    const mockState = {
      decision: { action: "COUNTER", reasoning: "Need closer match", confidence: 0.9 },
      metadata: {
        dealStatus: "NEGOTIATING"
      },
      round: 2
    } as unknown as NegotiationState;

    const result = await stateManagementNode(mockState);
    
    expect(result.metadata?.dealStatus).toBe("NEGOTIATING");
    expect(result.round).toBe(3); // Increment round (2 + 1)
  });

  it("should set waitingForHuman to true and update state on ESCALATE action", async () => {
    const mockState = {
      decision: { action: "ESCALATE", reasoning: "Hard negotiation", confidence: 1.0 },
      metadata: {
        dealStatus: "NEGOTIATING"
      },
      round: 1
    } as unknown as NegotiationState;

    const result = await stateManagementNode(mockState);
    
    expect(result.waitingForHuman).toBe(true);
    expect(result.metadata?.dealStatus).toBe("ESCALATED");
  });

  it("should transition NEGOTIATING -> WALKED_AWAY when action is WALK_AWAY", async () => {
    const mockState = {
      decision: { action: "WALK_AWAY", reasoning: "Price is too high", confidence: 1.0 },
      metadata: {
        dealStatus: "NEGOTIATING"
      },
      round: 1
    } as unknown as NegotiationState;

    const result = await stateManagementNode(mockState);
    
    expect(result.metadata?.dealStatus).toBe("WALKED_AWAY");
  });

  it("should update convoState when in CONVERSATION mode", async () => {
    // Mock a valid conversation state
    const mockState = {
      decision: { action: "COUNTER" },
      metadata: {
        mode: "CONVERSATION",
        vendorIntent: "OFFER",
        convoState: {
          phase: "ASK_OFFER",
          turnCount: 1,
          refusalCount: 0,
          smallTalkCount: 0,
          context: {
            mentionedPrice: true,
            mentionedTerms: false,
          }
        }
      },
      round: 1
    } as unknown as NegotiationState;

    const result = await stateManagementNode(mockState);
    
    expect(result.metadata?.convoState).toBeDefined();
    // Verify turn count was updated within convoState
    expect(result.metadata?.convoState?.turnCount).toBe(2);
  });
});
