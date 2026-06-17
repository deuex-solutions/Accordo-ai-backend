import { describe, it, expect, beforeAll } from "vitest";
import { createNegotiationGraph } from "@/modules/chatbot/engine/graph/index";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { getCheckpointer } from "@/modules/chatbot/engine/graph/checkpointer";

describe("AI Eval: Track 2 Intelligence Layer Integration", () => {
  beforeAll(async () => {
    const checkpointer = await getCheckpointer();
    try {
      await checkpointer.setup();
    } catch (err) {
      // Ignore if schema already exists
    }
  });

  it("should extract formal and urgent tone from vendor messages", async () => {
    const graph = await createNegotiationGraph();

    const initialState = {
      messages: [
        new HumanMessage("Dear Sir, we request your immediate confirmation on the proposal. Respectfully yours. This is urgent."),
      ],
      dealId: "d0000000-0000-0000-0000-000000000201",
      round: 1,
    };

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    const result = await graph.invoke(initialState, config);

    expect(result.analysis).toBeDefined();
    expect(result.analysis.tone).toBeDefined();
    expect(result.analysis.tone.formality).toBeGreaterThanOrEqual(0.5);
    expect(result.analysis.tone.urgency).toBeGreaterThanOrEqual(0.5);
    expect(result.analysis.urgency).toMatch(/HIGH|MEDIUM/);
    expect(result.analysis.tone.styleSignals.hasGreeting).toBe(1);
    expect(result.analysis.tone.styleSignals.formality).toBeGreaterThan(0.5);
  });

  it("should detect vendor pricing concerns", async () => {
    const graph = await createNegotiationGraph();

    const initialState = {
      messages: [
        new HumanMessage("The raw material costs and inflation have increased significantly this quarter."),
      ],
      dealId: "d0000000-0000-0000-0000-000000000202",
      round: 1,
    };

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    const result = await graph.invoke(initialState, config);

    expect(result.analysis).toBeDefined();
    expect(result.analysis.concerns).toBeDefined();
    expect(result.analysis.concerns.length).toBeGreaterThan(0);

    const priceConcern = result.analysis.concerns.find(
      (c: any) => c.category === "PRICING"
    );
    expect(priceConcern).toBeDefined();
    expect(priceConcern?.priority).toBeDefined();
  });

  it("should track concession velocity and behavior signals correctly over multiple turns", async () => {
    const graph = await createNegotiationGraph();

    const threadId = uuidv4();
    const config = { configurable: { thread_id: threadId } };

    // Turn 1
    const state1 = {
      messages: [
        new HumanMessage("We offer ₹1,00,000 for the products."),
      ],
      dealId: "d0000000-0000-0000-0000-000000000203",
      round: 1,
    };
    let result = await graph.invoke(state1, config);

    // Turn 2: Vendor drops slightly to 95,000 (slow concession)
    const state2 = {
      messages: [
        ...result.messages,
        new AIMessage("We can only buy at ₹80,000."),
        new HumanMessage("Best we can do is ₹98,000, our margins are tight."),
      ],
      round: 2,
    };
    result = await graph.invoke(state2, config);

    expect(result.analysis).toBeDefined();
    expect(result.analysis.behavior).toBeDefined();
    expect(result.analysis.behavior.concessionVelocity).toBeDefined();
    expect(result.analysis.behavior.rigidityScore).toBeGreaterThanOrEqual(0);
  });
});
