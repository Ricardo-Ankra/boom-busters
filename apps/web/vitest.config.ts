import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, '.'),
      // Build-time markers with no runtime module to resolve outside Next's
      // bundler. The guarantee they provide is a build-time one.
      'server-only': resolve(import.meta.dirname, 'test/empty-module.ts'),
      'client-only': resolve(import.meta.dirname, 'test/empty-module.ts'),
    },
  },
  test: {
    // Components need a DOM; the Inngest integration tests opt into `node`
    // with a `@vitest-environment` docblock of their own.
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['{app,components,inngest,lib}/**/*.test.{ts,tsx}'],
    // The Inngest tests share one database and truncate the run mirror
    // between files.
    fileParallelism: false,
    // Network-bound against a hosted Postgres: several ~100ms round trips per
    // test blow Vitest's 5s default even when nothing is wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
