import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Database } from './client'
import { decryptSecret } from './crypto'
import { FIXTURE_CASE_ID, FIXTURE_PROJECT_ID, fixtureClaims } from './fixtures'
import {
  countMusicBeds,
  getSettings,
  hasCredential,
  importProviderEnvSeeds,
  listCredentials,
  setCredential,
  updateSettings,
} from './queries'
import { seed } from './seed'
import { cases, claims, dossiers, projects, providerCredentials, settings } from './schema'
import { requireTestDatabase } from './test-database'

const DATABASE_URL = requireTestDatabase()
const KEY = Buffer.alloc(32, 3).toString('base64')

/**
 * These exercise real SQL: the singleton settings row, the seed's
 * idempotency, and the credential encryption round-trip through Postgres.
 * They skip rather than fail when no database is configured, so `pnpm test`
 * still works on a fresh clone; CI always sets DATABASE_URL, so they always
 * run there.
 */
const describeDb = DATABASE_URL ? describe : describe.skip

describeDb('database integration', () => {
  let connection: ReturnType<typeof createDb>
  let db: Database

  beforeAll(async () => {
    connection = createDb(DATABASE_URL as string, { max: 2 })
    db = connection.db
    // Start from a known state; the migration must already be applied.
    await db.execute(
      sql`TRUNCATE TABLE ${settings}, ${providerCredentials}, ${cases}, ${projects}, ${dossiers}, ${claims} RESTART IDENTITY CASCADE`,
    )
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  describe('getSettings', () => {
    it('creates the singleton row from defaults on first read', async () => {
      expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS)

      const rows = await db.select().from(settings)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.id).toBe('singleton')
    })

    it('never creates a second row', async () => {
      await getSettings(db)
      await getSettings(db)
      expect(await db.select().from(settings)).toHaveLength(1)
    })
  })

  describe('updateSettings', () => {
    it('persists a patch and leaves untouched sections alone', async () => {
      await updateSettings(db, { budgets: { killSwitch: true } })
      const stored = await getSettings(db)

      expect(stored.budgets.killSwitch).toBe(true)
      expect(stored.modelRouting).toEqual(DEFAULT_SETTINGS.modelRouting)

      await updateSettings(db, { budgets: { killSwitch: false } })
      expect((await getSettings(db)).budgets.killSwitch).toBe(false)
    })

    it('rejects a patch that would store an invalid row', async () => {
      await expect(updateSettings(db, { render: { concurrency: 99 } })).rejects.toThrow()
      expect((await getSettings(db)).render.concurrency).toBe(DEFAULT_SETTINGS.render.concurrency)
    })
  })

  describe('provider credentials', () => {
    it('stores the key encrypted and returns only a mask', async () => {
      await setCredential(db, 'anthropic', 'sk-ant-api03-secretvalue4f2a', KEY)

      const [row] = await db.select().from(providerCredentials)
      expect(row?.encryptedKey).not.toContain('secretvalue')
      expect(decryptSecret(row?.encryptedKey as string, KEY)).toBe('sk-ant-api03-secretvalue4f2a')

      const masked = await listCredentials(db)
      expect(masked).toEqual([
        expect.objectContaining({
          provider: 'anthropic',
          masked: '••••4f2a',
          verifyStatus: 'unchecked',
        }),
      ])
      expect(JSON.stringify(masked)).not.toContain('secretvalue')
    })

    it('replaces a key in place rather than adding a second row', async () => {
      await setCredential(db, 'anthropic', 'sk-ant-rotated-9999', KEY)

      const rows = await db.select().from(providerCredentials)
      expect(rows).toHaveLength(1)
      expect(decryptSecret(rows[0]?.encryptedKey as string, KEY)).toBe('sk-ant-rotated-9999')
      expect(rows[0]?.keyHint).toBe('9999')
    })

    it('imports env seeds only when no row exists yet', async () => {
      const env = { ANTHROPIC_API_KEY: 'sk-from-env-0000', PEXELS_API_KEY: 'px-from-env-1111' }

      const imported = await importProviderEnvSeeds(db, KEY, env)

      // anthropic already had a row from the previous test: env must not win.
      expect(imported).toEqual(['pexels'])
      const [anthropic] = await db.select().from(providerCredentials)
      expect(decryptSecret(anthropic?.encryptedKey as string, KEY)).toBe('sk-ant-rotated-9999')
      expect(await hasCredential(db, 'pexels')).toBe(true)
    })
  })

  describe('seed', () => {
    it('inserts the fixture case, project, dossier and claims', async () => {
      await seed(db)

      const [project] = await db.select().from(projects)
      expect(project?.id).toBe(FIXTURE_PROJECT_ID)
      expect(project?.caseId).toBe(FIXTURE_CASE_ID)
      expect(project?.stageStatus).toBe('queued')

      const storedClaims = await db.select().from(claims)
      expect(storedClaims).toHaveLength(fixtureClaims.length)
      expect(storedClaims.filter((c) => c.confidence === 'unverified')).toHaveLength(1)
    })

    it('is idempotent — a second run changes nothing', async () => {
      await seed(db)
      await seed(db)

      expect(await db.select().from(cases)).toHaveLength(1)
      expect(await db.select().from(projects)).toHaveLength(1)
      expect(await db.select().from(dossiers)).toHaveLength(1)
      expect(await db.select().from(claims)).toHaveLength(fixtureClaims.length)
    })

    it('leaves the first-run music-bed check honestly unsatisfied', async () => {
      // The seed must not fabricate music assets: the beds are licensed
      // downloads the human uploads, so the checklist has to show not-done.
      expect(await countMusicBeds(db)).toBe(0)
    })
  })
})
