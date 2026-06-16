import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DB_NAME: 'accordo_test',
      PGHOST: '127.0.0.1',
      PGPORT: '5432',
      PGUSER: 'postgres',
      PGPASSWORD: 'postgres',
      PGDATABASE: 'accordo_test',
      NODE_ENV: 'test',
      JWT_ACCESS_TOKEN_SECRET: 'test-secret-key',
      JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret-key',
    },
    setupFiles: './tests/helpers/setup.ts',
    include: [
      'tests/ai-evals/**/*.test.ts',
    ],
    testTimeout: 60000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
