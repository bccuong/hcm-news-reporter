import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 60_000,
  workers: 1, // tests share one server/data dir and run in order
  reporter: [['list']],
  // Windows: use the preinstalled Microsoft Edge (Chromium); CI (Linux): Playwright's bundled Chromium
  use: { baseURL: 'http://127.0.0.1:5179', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', screenshot: 'only-on-failure', channel: process.env.CI ? undefined : 'msedge' },
  webServer: {
    command: 'npx vite build && npx tsx scripts/e2e-server.ts',
    url: 'http://127.0.0.1:5179/api/health',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
