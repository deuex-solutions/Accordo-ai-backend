import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // No Postgres setup file to keep tests isolated and in-memory
    include: [
      'tests/ai-evals/**/*.test.ts',
    ],
    testTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
