import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.TEST_BASE_URL || 'http://127.0.0.1:4173';
const webkitTurnURL = process.env.WEBKIT_TEST_TURN_URL;
const webkitStorageState = webkitTurnURL ? {
  cookies: [],
  origins: [{
    origin: new URL(baseURL).origin,
    localStorage: [{
      name: 'p2p:turn-config',
      value: JSON.stringify({
        url: webkitTurnURL,
        username: 'playwright',
        credential: process.env.WEBKIT_TEST_TURN_PASSWORD,
      }),
    }],
  }],
} : undefined;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: baseURL.endsWith('/') ? baseURL : `${baseURL}/`,
    trace: 'on-first-retry',
  },
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'node scripts/serve-e2e.mjs',
        port: 4173,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], storageState: webkitStorageState },
    },
  ],
});
