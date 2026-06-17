import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      DB_NAME: 'accordo_test',
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/tests/',
        'dist/',
        'migrations/',
        '**/*.test.{ts,js}',
        '**/*.spec.{ts,js}',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    testTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
