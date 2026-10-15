import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Phase 2 end-to-end walkthrough.
 *
 * The spec drives the REAL web app against the FIREBASE EMULATORS
 * (project demo-workforce) — never the live project, never real data.
 * Start the emulators first:
 *
 *   firebase emulators:start --project demo-workforce --only auth,firestore,functions
 *   npm run test:e2e
 *
 * The webServer step rebuilds the app with VITE_USE_EMULATORS=true and
 * a forced emulator-project config (real env vars override any local
 * web/.env, so a stray .env can never point the spec at a real
 * project). Retries are 0 on purpose: the CI workflow retries the
 * whole command against a fresh emulator instead, so a retried spec
 * never runs against state left by a failed attempt.
 */
const EMULATOR_FIREBASE_ENV = [
  'VITE_USE_EMULATORS=true',
  'VITE_FIREBASE_API_KEY=demo-workforce-api-key',
  'VITE_FIREBASE_AUTH_DOMAIN=demo-workforce.firebaseapp.com',
  'VITE_FIREBASE_PROJECT_ID=demo-workforce',
  'VITE_FIREBASE_STORAGE_BUCKET=demo-workforce.appspot.com',
  'VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000',
  'VITE_FIREBASE_APP_ID=1:000000000000:web:000000000000',
].join(' ');

export default defineConfig({
  testDir: './e2e',
  testMatch: ['walkthrough.spec.ts', 'support.spec.ts'],
  timeout: 300_000, // one test, eight steps incl. the deletion job
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: `${EMULATOR_FIREBASE_ENV} npm run build && npx vite preview --port 4173 --strictPort`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
