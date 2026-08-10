import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The guard's integration tests share one database and truncate the
    // ledger; running files in parallel would have them erasing each other.
    fileParallelism: false,
    // Network-bound against a hosted Postgres (Neon): a single test makes
    // several ~100ms round trips, which blows Vitest's 5s default even when
    // nothing is wrong. The pure price tests finish in milliseconds anyway.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
