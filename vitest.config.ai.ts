import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './tests/helpers/setup.ts',
    env: {
      DB_NAME: 'accordo_test',
      NODE_ENV: 'test',
      DATABASE_URL: '',
      JWT_ACCESS_TOKEN_SECRET: 'test-secret-key-length-32-characters-long',
      JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret-key-length-32-characters-long',
    },
    include: [
      'tests/integration/**/*.test.ts',
      'tests/ai-evals/**/*.test.ts',
    ],
    testTimeout: 30000,
    fileParallelism: false,
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
