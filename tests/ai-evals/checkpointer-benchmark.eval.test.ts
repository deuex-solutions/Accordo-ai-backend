import { describe, it, expect, beforeAll } from "vitest";
import { getCheckpointer, wrapSerializer } from "../../src/modules/chatbot/engine/graph/checkpointer.js";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { v4 as uuidv4 } from "uuid";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

describe("AI Eval: Checkpointer Persistence & Tuning", () => {
  let dbCheckpointer: PostgresSaver;

  beforeAll(async () => {
    // Retrieve the checkpointer which connects to the PG test database
    dbCheckpointer = await getCheckpointer();
    try {
      await dbCheckpointer.setup();
    } catch (err) {
      // Ignore schema exists errors
    }
  });

  describe("wrapSerializer Unit Tests", () => {
    const mockBaseSerde = {
      async dumpsTyped(value: any) {
        const str = JSON.stringify(value);
        return ["json", new TextEncoder().encode(str)];
      },
      async loadsTyped(type: string, blob: Uint8Array) {
        const str = new TextDecoder().decode(blob);
        return JSON.parse(str);
      }
    };

    const compressedSerde = wrapSerializer(mockBaseSerde);

    it("should not compress small payloads (under 512 bytes)", async () => {
      const smallVal = { msg: "hello world" };
      const [type, blob] = await compressedSerde.dumpsTyped(smallVal);
      
      expect(type).toBe("json");
      expect(blob.length).toBeLessThan(512);

      const restored = await compressedSerde.loadsTyped(type, blob);
      expect(restored).toEqual(smallVal);
    });

    it("should compress large payloads (over 512 bytes)", async () => {
      const largeVal = {
        messages: Array.from({ length: 20 }, (_, idx) => ({
          role: "VENDOR",
          content: `This is a very long simulated context string that will make our payload exceed the 512-byte threshold. Round number: ${idx}. RAG Context details: ACCORDO is the leading procurement system.`
        }))
      };

      const [type, blob] = await compressedSerde.dumpsTyped(largeVal);
      
      expect(type).toBe("json/gzip");

      const restored = await compressedSerde.loadsTyped(type, blob);
      expect(restored).toEqual(largeVal);
    });

    it("should be backward compatible with raw JSON payloads", async () => {
      const rawVal = { compat: "check compatibility" };
      const [rawType, rawBlob] = await mockBaseSerde.dumpsTyped(rawVal);
      
      expect(rawType).toBe("json");
      
      const restored = await compressedSerde.loadsTyped(rawType, rawBlob);
      expect(restored).toEqual(rawVal);
    });
  });

  describe("E2E Database Benchmark", () => {
    it("should successfully save, load, and benchmark state payloads in PostgreSQL", async () => {
      const threadId = uuidv4();
      const config = { configurable: { thread_id: threadId } };

      // Build a large conversation state (50 messages)
      const largeState = {
        v: 1,
        id: uuidv4(),
        channel_values: {
          messages: Array.from({ length: 50 }, (_, idx) => 
            idx % 2 === 0 
              ? new HumanMessage({ content: `Simulated vendor proposal offering discount and delivery timeline. Index: ${idx}` })
              : new AIMessage({ content: `Warm, professional response from Procurement Manager holding target parameters. Index: ${idx}` })
          ),
          dealId: "benchmark-deal-999",
          round: 25,
          analysis: {
            tone: { sentiment: "NEUTRAL" as const, formality: 0.8, urgency: 0.5, styleSignals: {} },
            behavior: { concessionVelocity: "STEADY" as const, momentum: "STABLE" as const, rigidityScore: 0.3 }
          }
        },
        channel_versions: {
          messages: "1",
          dealId: "1",
          round: "1",
          analysis: "1"
        },
        versions_seen: {},
        pending_sends: []
      };

      const newVersions = {
        messages: "1",
        dealId: "1",
        round: "1",
        analysis: "1"
      };

      // Measure Save Time (put)
      const startSave = performance.now();
      const nextConfig = await dbCheckpointer.put(config, largeState, { step: 1 }, newVersions);
      const saveDuration = performance.now() - startSave;

      // Measure Load Time (getTuple)
      const startLoad = performance.now();
      const restoredTuple = await dbCheckpointer.getTuple(nextConfig);
      const loadDuration = performance.now() - startLoad;

      expect(restoredTuple).toBeDefined();
      expect(restoredTuple?.checkpoint).toBeDefined();
      
      // Verify values are fully intact
      expect(restoredTuple?.checkpoint.channel_values.dealId).toBe("benchmark-deal-999");
      expect(restoredTuple?.checkpoint.channel_values.messages.length).toBe(50);
      expect(restoredTuple?.checkpoint.channel_values.analysis.behavior.concessionVelocity).toBe("STEADY");

      // Log results to console
      console.log(`\n=== PostgreSQL Checkpointer Benchmark ===`);
      console.log(`Save (put) latency: ${saveDuration.toFixed(2)} ms`);
      console.log(`Load (getTuple) latency: ${loadDuration.toFixed(2)} ms`);
      console.log("=========================================\n");

      // Ensure latency is reasonably low (e.g. < 200ms in local environment)
      expect(saveDuration).toBeLessThan(200);
      expect(loadDuration).toBeLessThan(200);
    });
  });
});
