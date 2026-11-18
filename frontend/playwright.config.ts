import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { defineConfig, devices } from '@playwright/test';

if (existsSync('.env.e2e')) loadEnvFile('.env.e2e');

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4200',
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    launchOptions: { slowMo: 200 },
    trace: 'off',
    video: { mode: 'on', size: { width: 1280, height: 720 } },
    screenshot: 'off',
  },
});
