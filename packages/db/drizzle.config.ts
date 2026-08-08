import { defineConfig } from 'drizzle-kit'
import { databaseUrlOrPlaceholder } from './src/scripts/load-env'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  // `generate` diffs the schema against ./drizzle and never connects; only
  // `push`, `pull` and `studio` use these credentials.
  dbCredentials: { url: databaseUrlOrPlaceholder() },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
