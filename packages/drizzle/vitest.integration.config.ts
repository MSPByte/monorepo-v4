import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['__tests__/integration/**/*.integration.test.ts'],
    testTimeout: 30000,
  },
});
