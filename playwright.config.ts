import { defineConfig, devices } from '@playwright/test';

// All of this app's state (cart, catalog, customers, sales) persists to localStorage, so each
// test starts from a genuinely fresh browser context (Playwright's default) rather than relying
// on any reset endpoint - that matches how this app has actually been manually verified all
// along (a fresh browser = fresh seed data, see utils/seedData.ts).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Starts the real dev server (not a mock) - this suite exercises the actual app, including its
  // ERP-fallback and ZATCA-fallback paths, which only make sense against the real running app.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
