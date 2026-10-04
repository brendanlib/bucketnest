import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests against a running stack. Default: the Compose stack on :8080.
 * The stack must allow registration (ALLOW_REGISTRATION=true) for a fresh user.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
