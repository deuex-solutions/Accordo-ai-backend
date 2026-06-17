import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: './tests/helpers/setup.ts',
    include: ['tests/integration/**/*.test.ts', 'tests/ai-evals/**/*.test.ts'],
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
