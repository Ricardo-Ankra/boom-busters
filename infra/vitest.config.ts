import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'lambdas/**/*.test.ts'],
    // CDK Template synthesis is slower than a unit test but has no network.
    testTimeout: 120_000,
  },
})
