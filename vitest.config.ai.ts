import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DB_NAME: 'accordo_test',
      NODE_ENV: 'test',
      JWT_ACCESS_TOKEN_SECRET: 'test-secret-key',
      JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret-key',
    },
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
