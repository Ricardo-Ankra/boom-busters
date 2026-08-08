import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; running files in parallel would
    // have them truncating each other's tables.
    fileParallelism: false,
  },
})
