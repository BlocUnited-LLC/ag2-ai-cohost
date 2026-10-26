'use strict';

const { defineConfig, devices } = require('@playwright/test');

const frontendPort = process.env.COHOST_TEST_FRONTEND_PORT || '3301';
const backendPort = process.env.COHOST_TEST_BACKEND_PORT || '5350';
const frontend = `http://127.0.0.1:${frontendPort}`;
const backend = `http://127.0.0.1:${backendPort}`;

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: frontend,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      launchOptions: { args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ] },
    },
  }],
  webServer: [
    {
      command: 'node tests/fixtures/start-backend.js',
      url: `${backend}/__test/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        COHOST_TEST_BACKEND_PORT: backendPort,
        COHOST_ALLOWED_ORIGINS: `${frontend},http://localhost:${frontendPort},${backend}`,
        PYTHONDONTWRITEBYTECODE: '1',
      },
    },
    {
      command: 'node server.js',
      url: frontend,
      timeout: 30_000,
      reuseExistingServer: false,
      env: { PORT: frontendPort, AG2_BACKEND_URL: backend },
    },
  ],
});
