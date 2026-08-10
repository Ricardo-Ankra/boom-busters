import { defineConfig, devices } from '@playwright/test'
import { e2eDatabaseUrl } from './database'

const PORT = 3100
// `localhost`, not `127.0.0.1`: Next's dev server blocks cross-origin
// requests for its own chunks from any host it was not started on.
const baseURL = `http://localhost:${PORT}`

/**
 * E2E runs in mock-provider mode (build spec section 13): no paid API calls,
 * and the credentials sign-in stands in for Google OAuth.
 *
 * The dev server is used rather than a production build because the
 * credentials provider is hard-guarded off when NODE_ENV=production — that
 * guard is the point, so the suite works with it rather than around it.
 */
export default defineConfig({
  testDir: './tests',
  // Resets the fixture project, run mirror and ledger, so the suite does not
  // inherit whatever the Inngest integration tests left in the database.
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      // Spec section 11.4: review screens are responsive to 390px and
      // approving from a phone is a first-class flow.
      name: 'mobile-390',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'pnpm --filter @boom-busters/web dev --port 3100',
    cwd: '..',
    // Probe /signin, not /: the root redirects, and the app is only really
    // ready once a page renders.
    url: `${baseURL}/signin`,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      MOCK_PROVIDERS: '1',
      NODE_ENV: 'development',
      // Auth.js rewrites the request origin from AUTH_URL, and proxy.ts builds
      // its redirects from that. Leaving the developer's own AUTH_URL in place
      // would send every protected route to whatever port they use for dev.
      AUTH_URL: baseURL,
      // The app under test must read the same database global setup prepared.
      // Without this the dev server would pick DATABASE_URL out of .env.local
      // — the deployment's database — and the suite would assert against one
      // database while having seeded another.
      DATABASE_URL: e2eDatabaseUrl(),
    },
  },
})
