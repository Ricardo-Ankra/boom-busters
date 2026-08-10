import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; running files in parallel would
    // have them truncating each other's tables.
    fileParallelism: false,
    // These are network-bound. Against a hosted Postgres (Neon) a single test
    // makes several round trips of ~100ms each, which blows Vitest's 5s
    // default even though nothing is wrong. The pure unit tests in this
    // package finish in milliseconds either way.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
