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
      DATABASE_URL: '',
      JWT_ACCESS_TOKEN_SECRET: 'test-secret-key-length-32-characters-long',
      JWT_REFRESH_TOKEN_SECRET: 'test-refresh-secret-key-length-32-characters-long',
    },
    setupFiles: './tests/helpers/setup.ts',
    include: [
      'tests/integration/**/*.test.ts',
      'tests/ai-evals/**/*.test.ts',
    ],
    testTimeout: 60000,
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
