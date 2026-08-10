import { describe, expect, it } from 'vitest'
import { resolveMigrationUrl } from './scripts/load-env'

const POOLED =
  'postgresql://neondb_owner:pw@ep-quiet-breeze-pooler.eu-central-1.aws.neon.tech/neondb'
const DIRECT = 'postgresql://neondb_owner:pw@ep-quiet-breeze.eu-central-1.aws.neon.tech/neondb'
const LOCAL = 'postgresql://postgres:postgres@localhost:5432/boom_busters'

describe('resolveMigrationUrl', () => {
  it('uses DATABASE_URL when there is no unpooled endpoint', () => {
    expect(resolveMigrationUrl(LOCAL)).toBe(LOCAL)
    expect(resolveMigrationUrl(LOCAL, '')).toBe(LOCAL)
    expect(resolveMigrationUrl(LOCAL, '   ')).toBe(LOCAL)
  })

  it('prefers the direct endpoint — DDL does not belong on a pooler', () => {
    expect(resolveMigrationUrl(POOLED, DIRECT)).toBe(DIRECT)
  })

  it('accepts the pair Neon actually issues, which differs only in hostname', () => {
    expect(() => resolveMigrationUrl(POOLED, DIRECT)).not.toThrow()
  })

  it('refuses to migrate one database while the app reads another', () => {
    // The exact trap: DATABASE_URL overridden in the shell, a stale
    // DATABASE_URL_UNPOOLED still in .env.local. Silently migrating the wrong
    // database surfaces much later as "relation does not exist".
    expect(() => resolveMigrationUrl(LOCAL, DIRECT)).toThrow(/different databases/)
  })

  it('catches a different database name on the same host', () => {
    const other = LOCAL.replace('/boom_busters', '/some_other_db')
    expect(() => resolveMigrationUrl(LOCAL, other)).toThrow(/different databases/)
  })

  it('catches a different user on the same database', () => {
    const other = LOCAL.replace('postgres:postgres@', 'someone_else:pw@')
    expect(() => resolveMigrationUrl(LOCAL, other)).toThrow(/different databases/)
  })
})
