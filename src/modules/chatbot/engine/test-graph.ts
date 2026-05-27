import { createNegotiationGraph } from "./graph/index.js";
import { HumanMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";

/**
 * DEMO SCRIPT
 * Run this to verify the basic graph setup.
 */
async function runDemo() {
  const graph = await createNegotiationGraph();
  
  const initialState = {
    messages: [new HumanMessage("I want a discount on the latest offer.")],
    dealId: "demo-deal-123",
    round: 0,
  };

  const config = { configurable: { thread_id: uuidv4() } };

  console.log("--- Starting Negotiation Flow ---");
  const result = await graph.invoke(initialState, config);
  console.log("--- Flow Complete ---");
  console.log("Final State:", JSON.stringify(result, null, 2));
}

// Only run if called directly
if (import.meta.url.endsWith(process.argv[1])) {
  runDemo().catch(console.error);
}
