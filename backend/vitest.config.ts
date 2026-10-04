import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // API test files share one database and truncate it between tests.
    fileParallelism: false,
    projects: [
      {
        test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.api.test.ts'] },
      },
      {
        test: {
          name: 'api',
          include: ['src/**/*.api.test.ts'],
          globalSetup: ['src/test/global-setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/test/**', 'src/cli/**', 'src/server.ts'],
      thresholds: {
        lines: 70,
        'src/finance/**': { lines: 100, functions: 100, statements: 100 },
      },
    },
  },
});
