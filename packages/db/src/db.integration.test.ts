import { DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, type Database } from './client'
import { decryptSecret } from './crypto'
import {
  FIXTURE_CASE_ID,
  FIXTURE_PROJECT_ID,
  fixtureClaims,
  fixtureDocuments,
  fixtureSupports,
} from './fixtures'
import {
  countMusicBeds,
  getSettings,
  hasCredential,
  importProviderEnvSeeds,
  listCredentials,
  setCredential,
} from './queries'
import { seed } from './seed'
import {
  assets,
  cases,
  channels,
  claimSupports,
  claims,
  dossierDocuments,
  dossiers,
  projects,
  providerCredentials,
  researchDocuments,
  workspace,
} from './schema'
import { requireTestDatabase } from './test-database'

const DATABASE_URL = requireTestDatabase()
const KEY = Buffer.alloc(32, 3).toString('base64')

/**
 * These exercise real SQL: the first channel the seed creates, the seed's
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
    // `assets` is here because the music-bed test asserts over it: an E2E run
    // uploads beds through the Settings UI and leaves them (found 2026-08-19,
    // when this suite first ran after one), so without the truncate this
    // suite's result depends on which suite ran before it. `channels` is
    // here so the seed's first channel starts from defaults.
    await db.execute(
      sql`TRUNCATE TABLE ${channels}, ${workspace}, ${providerCredentials}, ${cases}, ${projects}, ${dossiers}, ${claims}, ${assets}, ${researchDocuments} RESTART IDENTITY CASCADE`,
    )
  })

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 })
  })

  describe('getSettings', () => {
    it('reads the seeded first channel merged with the workspace', async () => {
      await seed(db)

      expect(await getSettings(db)).toEqual({ ...DEFAULT_SETTINGS, ...DEFAULT_WORKSPACE_SETTINGS })
      expect(await db.select().from(channels)).toHaveLength(1)
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

      expect(await db.select().from(researchDocuments)).toHaveLength(fixtureDocuments.length)
      const links = await db.select().from(dossierDocuments)
      expect(links.map((l) => l.rank).sort()).toEqual([1, 2])
      // The link carries the kind's tier: a regulator record is tier 5, reporting tier 2.
      expect(links.map((l) => l.tier).sort()).toEqual([2, 5])
      const supports = await db.select().from(claimSupports)
      expect(supports).toHaveLength(fixtureSupports.length)
      expect(supports.every((s) => s.found && (s.offset ?? -1) >= 0)).toBe(true)
    })

    it('is idempotent — a second run changes nothing', async () => {
      await seed(db)
      await seed(db)

      expect(await db.select().from(cases)).toHaveLength(1)
      expect(await db.select().from(projects)).toHaveLength(1)
      expect(await db.select().from(dossiers)).toHaveLength(1)
      expect(await db.select().from(claims)).toHaveLength(fixtureClaims.length)
      expect(await db.select().from(researchDocuments)).toHaveLength(fixtureDocuments.length)
      expect(await db.select().from(dossierDocuments)).toHaveLength(fixtureDocuments.length)
      expect(await db.select().from(claimSupports)).toHaveLength(fixtureSupports.length)
    })

    it('leaves the first-run music-bed check honestly unsatisfied', async () => {
      // The seed must not fabricate music assets: the beds are licensed
      // downloads the human uploads, so the checklist has to show not-done.
      expect(await countMusicBeds(db)).toBe(0)
    })
  })
})
