import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The snapshot suite bundles the Remotion project with webpack and
    // renders stills through headless Chrome — minutes, not milliseconds.
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
