// @vitest-environment node

import type * as Db from '@boom-busters/db'
import {
  createCase,
  createChannel,
  createProjectFromCase,
  ensurePublishRecord,
  channelYoutubeConnection,
  ensureRun,
  insertLogo,
  listLogos,
  saveChannelYoutubeConnection,
  setProjectStage,
  getChannel,
  getWorkspace,
  listBibleVersions,
  listChannels,
  recordRunEvent,
  requireTestDatabase,
  seed,
  setDefaultChannel,
  setRunStatus,
  truncateRunMirror,
  updateChannelSettings,
  updatePublishRecord,
} from '@boom-busters/db'
import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
} from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { archiveChannelAction, createChannelAction, updateChannelAction } from './channel-actions'

/**
 * The Channel tab's actions against the test database, with the session, the
 * cache and the switcher cookie replaced.
 */

vi.mock('@/auth', () => ({ auth: async () => ({ user: { email: 'owner@example.com' } }) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const cookieJar = vi.hoisted(() => ({ deleted: [] as string[] }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    delete: (name: string) => {
      cookieJar.deleted.push(name)
    },
  }),
}))

// The last-channel refusal cannot be reached honestly in a shared database that
// other suites fill with channels, so one test narrows the list the action sees.
const listing = vi.hoisted(() => ({ only: null as string | null }))
vi.mock('@boom-busters/db', async (importOriginal) => {
  const original = await importOriginal<typeof Db>()
  return {
    ...original,
    listChannels: async (...args: Parameters<typeof original.listChannels>) => {
      const all = await original.listChannels(...args)
      return listing.only === null ? all : all.filter((entry) => entry.id === listing.only)
    },
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

const unique = () => `ch-${Math.random().toString(36).slice(2, 9)}`

async function makeChannel(over: Partial<Parameters<typeof createChannel>[1]> = {}) {
  return createChannel(db, {
    name: 'Test channel',
    handle: null,
    slug: unique(),
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
    ...over,
  })
}

describeDb('channel actions', () => {
  beforeEach(async () => {
    await seed(db)
    await truncateRunMirror(db)
    cookieJar.deleted.length = 0
    listing.only = null
  })

  describe('createChannelAction', () => {
    it('creates from the house defaults with an empty bible', async () => {
      const slug = unique()
      const result = await createChannelAction({
        name: 'Psychology',
        handle: '@psych',
        slug,
        startFrom: 'defaults',
      })

      expect(result).toEqual({ ok: true, slug })
      const created = (await listChannels(db)).find((channel) => channel.slug === slug)
      expect(created?.bible).toEqual(EMPTY_BIBLE)
      expect(created?.settings).toEqual(DEFAULT_SETTINGS)
      expect(created?.handle).toBe('@psych')
    })

    it("copies another channel's voice and routing but not its logo mark or YouTube", async () => {
      const source = await makeChannel()
      await saveChannelYoutubeConnection(db, source.id, {
        refreshToken: 'refresh-token-from-a',
        encryptionKey: Buffer.alloc(32, 1).toString('base64'),
        youtubeChannelId: 'UC-source',
        youtubeChannelTitle: 'Source',
      })
      await insertLogo(db, source.id, {
        r2Key: 'a/logos/mark.png',
        contentHash: 'b'.repeat(64),
        title: 'Acme',
        width: 10,
        height: 10,
      })
      await updateChannelSettings(db, source.id, {
        tts: { voiceId: 'voice-from-a' },
        brandKit: {
          ...source.settings.brandKit,
          look: { ...source.settings.brandKit.look, logoR2Key: 'a/logos/mark.png' },
        },
        publish: { dailyUploadBudget: 5 },
        features: { ...source.settings.features },
      })

      const slug = unique()
      const result = await createChannelAction({
        name: 'Copy',
        handle: null,
        slug,
        startFrom: { copyFromChannelId: source.id },
      })
      expect(result.ok).toBe(true)

      const copy = (await listChannels(db)).find((channel) => channel.slug === slug)!
      expect(copy.settings.tts.voiceId).toBe('voice-from-a')
      expect(copy.settings.publish.dailyUploadBudget).toBe(5)
      // The mark belongs to the source channel's logo library.
      expect(copy.settings.brandKit.look.logoR2Key).toBeNull()
      expect(copy.settings.features).toEqual(DEFAULT_SETTINGS.features)
      expect(copy.bible).toEqual(EMPTY_BIBLE)
      // What lives outside the settings does not travel either.
      expect(await channelYoutubeConnection(db, copy.id)).toBeUndefined()
      expect(await listLogos(db, copy.id)).toEqual([])
      expect(await channelYoutubeConnection(db, source.id)).toBeDefined()
      expect(await listLogos(db, source.id)).toHaveLength(1)
    })

    it('refuses a copy from a channel that does not exist', async () => {
      const before = (await listChannels(db)).length
      const result = await createChannelAction({
        name: 'Copy',
        handle: null,
        slug: unique(),
        startFrom: { copyFromChannelId: '01BB0000000000000000000099' },
      })
      expect(result).toEqual({ ok: false, error: 'Unknown channel' })
      expect((await listChannels(db)).length).toBe(before)
    })

    it.each([
      ['settings', 'That address is reserved'],
      ['api', 'That address is reserved'],
      ['boom-busters', 'That address is taken'],
    ])('refuses the address %s and inserts nothing', async (slug, error) => {
      const before = (await listChannels(db, { includeArchived: true })).length
      const result = await createChannelAction({
        name: 'Refused',
        handle: null,
        slug,
        startFrom: 'defaults',
      })
      expect(result).toEqual({ ok: false, error })
      expect((await listChannels(db, { includeArchived: true })).length).toBe(before)
    })

    it.each(['', 'Has Capitals', '-leading', 'trailing-', 'a'.repeat(41), 'under_score'])(
      'refuses the malformed address %j and inserts nothing',
      async (slug) => {
        const before = (await listChannels(db, { includeArchived: true })).length
        const result = await createChannelAction({
          name: 'Refused',
          handle: null,
          slug,
          startFrom: 'defaults',
        })
        expect(result.ok).toBe(false)
        expect((await listChannels(db, { includeArchived: true })).length).toBe(before)
      },
    )

    it('refuses an address an archived channel once held', async () => {
      const archived = await makeChannel()
      await archiveChannelAction(archived.id, archived.slug)
      const result = await createChannelAction({
        name: 'Again',
        handle: null,
        slug: archived.slug,
        startFrom: 'defaults',
      })
      expect(result).toEqual({ ok: false, error: 'That address is taken' })
    })
  })

  describe('updateChannelAction', () => {
    it('saves the name, handle and bible, and refuses a bad one', async () => {
      const channel = await makeChannel()
      const bible = { ...FIRST_CHANNEL_BIBLE, subject: 'psychology experiments' }

      expect(await updateChannelAction(channel.id, { name: 'Renamed', handle: '', bible })).toEqual(
        { ok: true },
      )
      const saved = await getChannel(db, channel.id)
      expect(saved.name).toBe('Renamed')
      expect(saved.handle).toBeNull()
      expect(saved.bible.subject).toBe('psychology experiments')

      const bad = await updateChannelAction(channel.id, {
        bible: { ...bible, caseCategories: [{ key: 'Bad Key', label: 'x' }] },
      })
      expect(bad.ok).toBe(false)
      expect((await getChannel(db, channel.id)).bible.subject).toBe('psychology experiments')
    })

    it('makes every bible save a version: created, then two edits', async () => {
      const channel = await makeChannel()
      expect(channel.bibleVersion).toBe(1)

      const first = { ...FIRST_CHANNEL_BIBLE, subject: 'psychology experiments' }
      const second = { ...FIRST_CHANNEL_BIBLE, subject: 'shipwrecks' }
      expect(await updateChannelAction(channel.id, { bible: first })).toEqual({ ok: true })
      expect(await updateChannelAction(channel.id, { bible: second })).toEqual({ ok: true })

      const saved = await getChannel(db, channel.id)
      expect(saved.bibleVersion).toBe(3)
      expect(saved.bible.subject).toBe('shipwrecks')
      const versions = (await listBibleVersions(db, channel.id)).map(({ version, note }) => ({
        version,
        note,
      }))
      expect(versions).toEqual([
        { version: 1, note: 'Created' },
        { version: 2, note: 'Edited in Settings' },
        { version: 3, note: 'Edited in Settings' },
      ])
    })

    it('says so for a well-formed id that names no channel', async () => {
      expect(await updateChannelAction('01BB0000000000000000000099', { name: 'x' })).toEqual({
        ok: false,
        error: 'Unknown channel',
      })
    })
  })

  describe('archiveChannelAction', () => {
    it('refuses a wrong typed slug', async () => {
      const channel = await makeChannel()
      const result = await archiveChannelAction(channel.id, 'nope')
      expect(result.ok).toBe(false)
      expect((await getChannel(db, channel.id)).archivedAt).toBeNull()
    })

    it('refuses while a run of the channel is live', async () => {
      const channel = await makeChannel()
      await ensureRun(db, {
        inngestRunId: `live-${channel.id}`,
        functionName: 'demo-runner',
        channelId: channel.id,
      })
      const result = await archiveChannelAction(channel.id, channel.slug)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/running/i)
      expect((await getChannel(db, channel.id)).archivedAt).toBeNull()
    })

    it('refuses while a budget gate of the channel is open', async () => {
      const channel = await makeChannel()
      const runId = await ensureRun(db, {
        inngestRunId: `gate-${channel.id}`,
        functionName: 'demo-runner',
        channelId: channel.id,
      })
      await recordRunEvent(db, { runId, kind: 'gate.opened', data: { gate: 'budget' } })
      await setRunStatus(db, runId, 'awaiting_gate')

      const result = await archiveChannelAction(channel.id, channel.slug)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/budget/i)
    })

    it('refuses while a run is parked at a gate that is not a budget gate', async () => {
      const channel = await makeChannel()
      const runId = await ensureRun(db, {
        inngestRunId: `park-${channel.id}`,
        functionName: 'demo-runner',
        channelId: channel.id,
      })
      await recordRunEvent(db, { runId, kind: 'gate.opened', data: { gate: 'dossier' } })
      await setRunStatus(db, runId, 'awaiting_gate')

      const result = await archiveChannelAction(channel.id, channel.slug)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/parked at a gate/)
      expect((await getChannel(db, channel.id)).archivedAt).toBeNull()
    })

    it('refuses while a project of the channel is awaiting review', async () => {
      const channel = await makeChannel()
      const kase = await createCase(db, { channelId: channel.id, title: 'Review', category: 'con' })
      const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Review' })
      await setProjectStage(db, project.id, { stage: 'dossier', stageStatus: 'awaiting_review' })

      const result = await archiveChannelAction(channel.id, channel.slug)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/waiting on your review/)
      expect((await getChannel(db, channel.id)).archivedAt).toBeNull()
    })

    it('refuses while a publish is scheduled', async () => {
      const channel = await makeChannel()
      const kase = await createCase(db, {
        channelId: channel.id,
        title: 'Scheduled',
        category: 'collapse',
      })
      const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Scheduled' })
      const record = await ensurePublishRecord(db, 'master', project.id)
      await updatePublishRecord(db, record.id, {
        status: 'scheduled',
        publishAt: new Date('2030-01-01T10:00:00Z'),
      })

      const result = await archiveChannelAction(channel.id, channel.slug)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/scheduled/i)
    })

    it('is not refused by a running cron row that belongs to no channel', async () => {
      const channel = await makeChannel()
      const cron = await ensureRun(db, { inngestRunId: 'cron-1', functionName: 'analytics-cron' })
      const gate = await ensureRun(db, { inngestRunId: 'cron-2', functionName: 'analytics-cron' })
      await recordRunEvent(db, { runId: gate, kind: 'gate.opened', data: { gate: 'budget' } })
      await setRunStatus(db, gate, 'awaiting_gate')
      expect(cron).toBeTruthy()

      expect((await archiveChannelAction(channel.id, channel.slug)).ok).toBe(true)
    })

    it('archives, hides the channel from listChannels, clears the cookie and names the default', async () => {
      const channel = await makeChannel()
      const result = await archiveChannelAction(channel.id, channel.slug)

      expect(result.ok).toBe(true)
      const { defaultChannelId } = await getWorkspace(db)
      expect(result.slug).toBe((await getChannel(db, defaultChannelId!)).slug)
      expect((await listChannels(db)).some((entry) => entry.id === channel.id)).toBe(false)
      expect(cookieJar.deleted).toEqual(['bb-last-channel'])
    })

    it('moves the workspace default to the oldest other live channel first', async () => {
      const channel = await makeChannel()
      await setDefaultChannel(db, channel.id)
      try {
        const result = await archiveChannelAction(channel.id, channel.slug)
        expect(result.ok).toBe(true)

        const oldest = (await listChannels(db)).find((entry) => entry.id !== channel.id)!
        expect((await getWorkspace(db)).defaultChannelId).toBe(oldest.id)
        expect(result.slug).toBe(oldest.slug)
      } finally {
        await setDefaultChannel(db, FIRST_CHANNEL_ID)
      }
    })

    it('refuses to archive the last live channel', async () => {
      const channel = await makeChannel()
      listing.only = channel.id
      try {
        const result = await archiveChannelAction(channel.id, channel.slug)
        expect(result).toEqual({
          ok: false,
          error: 'Create another channel before archiving this one',
        })
      } finally {
        listing.only = null
      }
      expect((await getChannel(db, channel.id)).archivedAt).toBeNull()
    })
  })
})
