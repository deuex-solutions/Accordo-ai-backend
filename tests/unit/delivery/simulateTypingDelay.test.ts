/**
 * Tests for simulate-typing-delay.ts complexity scaling (Apr 2026).
 *
 * We don't want to actually wait in tests, so we monkey-patch setTimeout
 * via vi.useFakeTimers, but the simpler path is to call the function and
 * assert the returned delayMs against expected ranges. We mock Math.random
 * for determinism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { simulateTypingDelay } from "../../../src/delivery/simulate-typing-delay.js";

describe("simulateTypingDelay – complexity scaling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function getDelayMs(action: any, options: any = {}): Promise<number> {
    // Force Math.random() = 1 so we always get the upper bound (predictable).
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    const promise = simulateTypingDelay(action, options);
    // Advance past any sleep
    await vi.runAllTimersAsync();
    const result = await promise;
    return result.delayMs;
  }

  it("base COUNTER without options stays in [6000, 12000]", async () => {
    const ms = await getDelayMs("COUNTER");
    expect(ms).toBeGreaterThanOrEqual(6000);
    expect(ms).toBeLessThanOrEqual(12000);
  });

  it("COUNTER with long output extends the upper bound", async () => {
    const baseline = await getDelayMs("COUNTER");
    const extended = await getDelayMs("COUNTER", {
      outputWordCount: 80,
      vendorMessageWordCount: 40,
    });
    expect(extended).toBeGreaterThan(baseline);
  });

  it("COUNTER with very long output is capped", async () => {
    const ms = await getDelayMs("COUNTER", {
      outputWordCount: 500,
      vendorMessageWordCount: 500,
    });
    // Base max 12000 + cap 7500 = 19500 ceiling
    expect(ms).toBeLessThanOrEqual(19500);
  });

  it("ACCEPT with a brief reply tightens the floor", async () => {
    // Force Math.random() = 0 so we get the lower bound.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const promise = simulateTypingDelay("ACCEPT", { outputWordCount: 8 });
    await vi.runAllTimersAsync();
    const { delayMs } = await promise;
    // Tightened floor is min(baseMin*0.5, 1500) = 1500
    expect(delayMs).toBeGreaterThanOrEqual(1500);
    expect(delayMs).toBeLessThan(3000); // strict — base ACCEPT min is 3000
  });

  it("unknown action falls through to default range", async () => {
    const ms = await getDelayMs("UNKNOWN_ACTION");
    expect(ms).toBeGreaterThanOrEqual(3000);
    expect(ms).toBeLessThanOrEqual(6000);
  });
});
