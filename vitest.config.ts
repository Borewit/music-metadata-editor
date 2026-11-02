import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Full metadata-transfer regressions can exceed the default on CI runners.
    testTimeout: 30_000,
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'lcov', 'html']
    }
  }
});
