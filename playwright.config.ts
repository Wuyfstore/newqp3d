import { defineConfig, devices } from '@playwright/test'

const desktopChrome = devices['Desktop Chrome']
const pixel7 = devices['Pixel 7']

export default defineConfig({
  testDir: 'apps/web/e2e',
  timeout: 60_000,
  webServer: {
    command: 'node apps/web/e2e/static-server.mjs',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium-desktop', use: desktopChrome },
    { name: 'chromium-mobile', use: pixel7 },
  ],
})
