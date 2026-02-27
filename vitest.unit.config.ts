/**
 * Vitest config for pure unit tests.
 *
 * These tests have NO database dependency — they test deterministic logic
 * in the negotiation engine, LLM boundary layer, and delivery modules.
 * The global setupFiles (tests/setup.ts) is intentionally excluded here
 * because that file connects to PostgreSQL and would block unit tests from
 * running without a test DB.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No setupFiles — these tests are pure unit tests with no DB
    include: [
      'tests/unit/**/*.test.ts',
    ],
    testTimeout: 15000,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/negotiation/**/*.ts',
        'src/llm/**/*.ts',
        'src/delivery/**/*.ts',
        'src/metrics/**/*.ts',
        'src/modules/chatbot/engine/toneDetector.ts',
        'src/modules/product/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
