import {
  ChannelNotFoundError,
  ChannelSlugTakenError,
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  FIRST_CHANNEL_ID,
  FIRST_CHANNEL_SLUG,
  ProjectNotFoundError,
} from '@boom-busters/schemas'
import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createCase } from './cases'
import {
  archiveChannel,
  channelForProject,
  createChannel,
  ensureFirstChannel,
  getChannel,
  getChannelBySlug,
  getChannelSettings,
  listChannels,
  updateChannel,
  updateChannelSettings,
} from './channels'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { getSettings, updateSettings } from './queries'
import { assets, cases, channels, projects, workspace, youtubeConnections } from './schema'
import { requireTestDatabase } from './test-database'
import { getWorkspace } from './workspace'
import {
  channelYoutubeConnection,
  channelYoutubeConnected,
  channelYoutubeReconnectNeeded,
  channelYoutubeToken,
  connectedChannelIds,
  recordChannelYoutubeVerify,
  saveChannelYoutubeConnection,
} from './youtube-connections'

/**
 * Channels, the workspace row and the per-channel YouTube connection against
 * a real database. The slug refusal, the per-channel settings merge and the
 * two partial asset indexes are constraints in Postgres, so a mock would only
 * test the mock.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip
const KEY = Buffer.alloc(32, 7).toString('base64')

function channelInput(slug: string) {
  return {
    name: `Channel ${slug}`,
    handle: null,
    slug,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  }
}

suite('channels', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${channels}, ${workspace}, ${youtubeConnections}, ${projects}, ${cases} restart identity cascade`,
    )
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('ensureFirstChannel creates the first channel and workspace once', async () => {
    const a = await ensureFirstChannel(db)
    const b = await ensureFirstChannel(db)
    expect(a.id).toBe(FIRST_CHANNEL_ID)
    expect(b.id).toBe(a.id)
    expect(a.slug).toBe(FIRST_CHANNEL_SLUG)
    expect((await listChannels(db)).length).toBe(1)
    expect((await getWorkspace(db)).defaultChannelId).toBe(FIRST_CHANNEL_ID)
  })

  it('getChannel for an unknown id throws, never creates', async () => {
    await expect(getChannel(db, '01BB0000000000000000000009')).rejects.toThrow(ChannelNotFoundError)
    expect((await listChannels(db)).length).toBe(0)
  })

  it('getChannelBySlug finds a channel and answers undefined for an unknown slug', async () => {
    const created = await createChannel(db, channelInput('alpha'))
    expect((await getChannelBySlug(db, 'alpha'))?.id).toBe(created.id)
    expect(await getChannelBySlug(db, 'nope')).toBeUndefined()
  })

  it('createChannel refuses a taken slug, archived included', async () => {
    const alpha = await createChannel(db, channelInput('alpha'))
    await expect(createChannel(db, channelInput('alpha'))).rejects.toThrow(ChannelSlugTakenError)

    await archiveChannel(db, alpha.id)
    await expect(createChannel(db, channelInput('alpha'))).rejects.toThrow(ChannelSlugTakenError)
  })

  it('listChannels hides archived unless asked', async () => {
    const alpha = await createChannel(db, channelInput('alpha'))
    await createChannel(db, channelInput('beta'))
    const archived = await archiveChannel(db, alpha.id)
    expect(archived.archivedAt).toBeInstanceOf(Date)

    expect((await listChannels(db)).map((c) => c.slug)).toEqual(['beta'])
    expect((await listChannels(db, { includeArchived: true })).map((c) => c.slug)).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('updateChannel changes the name, handle and bible only', async () => {
    const alpha = await createChannel(db, channelInput('alpha'))
    const bible = { ...EMPTY_BIBLE, subject: 'shipwrecks' }
    const updated = await updateChannel(db, alpha.id, { name: 'Alpha', handle: '@alpha', bible })

    expect(updated).toMatchObject({ slug: 'alpha', name: 'Alpha', handle: '@alpha', bible })
    expect(updated.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('updateChannelSettings merges one channel only', async () => {
    const a = await createChannel(db, channelInput('alpha'))
    const b = await createChannel(db, channelInput('beta'))

    const next = await updateChannelSettings(db, b.id, { tts: { voiceId: 'voice-b' } })
    expect(next.tts.voiceId).toBe('voice-b')
    expect((await getChannelSettings(db, b.id)).tts.voiceId).toBe('voice-b')
    expect(await getChannelSettings(db, a.id)).toEqual(DEFAULT_SETTINGS)
  })

  it('updateChannelSettings refuses an unknown channel', async () => {
    await expect(
      updateChannelSettings(db, '01BB0000000000000000000009', { tts: { voiceId: 'x' } }),
    ).rejects.toThrow(ChannelNotFoundError)
  })

  it('channelForProject returns the project channel', async () => {
    await ensureFirstChannel(db)
    const b = await createChannel(db, channelInput('beta'))
    const kase = await createCase(db, { title: 'Enron', category: 'collapse', channelId: b.id })
    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Enron' })

    expect(project.channelId).toBe(b.id)
    const resolved = await channelForProject(db, project.id)
    expect(resolved).toMatchObject({ channelId: b.id, slug: 'beta', bible: EMPTY_BIBLE })
    expect(resolved.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('channelForProject throws for a missing project', async () => {
    await expect(channelForProject(db, '01BB0000000000000000000009')).rejects.toBeInstanceOf(
      ProjectNotFoundError,
    )
  })

  it('getSettings wrapper merges workspace prices and budgets', async () => {
    await ensureFirstChannel(db)
    await updateSettings(db, { budgets: { monthlyCeilingUsd: 7 }, tts: { voiceId: 'voice-1' } })

    expect((await getWorkspace(db)).settings.budgets.monthlyCeilingUsd).toBe(7)
    expect((await getChannelSettings(db, FIRST_CHANNEL_ID)).tts.voiceId).toBe('voice-1')
    const settings = await getSettings(db)
    expect(settings.budgets.monthlyCeilingUsd).toBe(7)
    expect(settings.tts.voiceId).toBe('voice-1')
  })

  it('getSettings wrapper creates the first channel on an empty database', async () => {
    expect(await getSettings(db)).toEqual(DEFAULT_SETTINGS)
    expect((await listChannels(db)).map((c) => c.id)).toEqual([FIRST_CHANNEL_ID])
  })

  it('the same logo hash on two channels is two rows; the same music hash twice is one', async () => {
    const a = await createChannel(db, channelInput('alpha'))
    const b = await createChannel(db, channelInput('beta'))
    const logo = {
      kind: 'logo' as const,
      r2Key: 'logos/x.png',
      contentHash: 'logo-x',
      licence: 'owner',
    }

    await db.insert(assets).values({ ...logo, channelId: a.id })
    await db.insert(assets).values({ ...logo, channelId: b.id })
    await expect(db.insert(assets).values({ ...logo, channelId: a.id })).rejects.toThrow()
    expect(await db.select().from(assets).where(eq(assets.contentHash, 'logo-x'))).toHaveLength(2)

    const bed = {
      kind: 'music' as const,
      r2Key: 'music/m.mp3',
      contentHash: 'music-m',
      licence: 'lib',
    }
    await db.insert(assets).values(bed)
    await expect(db.insert(assets).values(bed)).rejects.toThrow()
    expect(await db.select().from(assets).where(eq(assets.contentHash, 'music-m'))).toHaveLength(1)
  })

  describe('youtube connections', () => {
    it('stores the token encrypted and reads it back per channel', async () => {
      const a = await createChannel(db, channelInput('alpha'))
      await saveChannelYoutubeConnection(db, a.id, {
        refreshToken: 'refresh-secret-1234',
        encryptionKey: KEY,
        youtubeChannelId: 'UC-a',
        youtubeChannelTitle: 'Alpha on YouTube',
      })

      const row = await channelYoutubeConnection(db, a.id)
      expect(row).toMatchObject({
        keyHint: '1234',
        youtubeChannelId: 'UC-a',
        youtubeChannelTitle: 'Alpha on YouTube',
        verifyStatus: 'unchecked',
      })
      expect(row?.encryptedRefreshToken).not.toContain('refresh-secret')
      expect(await channelYoutubeToken(db, a.id, KEY)).toBe('refresh-secret-1234')
      expect(await channelYoutubeToken(db, a.id, Buffer.alloc(32, 9).toString('base64'))).toBe(
        undefined,
      )
      expect(await channelYoutubeConnection(db, '01BB0000000000000000000009')).toBeUndefined()
    })

    it('recordChannelYoutubeVerify marks invalid when the YouTube channel id changes', async () => {
      const a = await createChannel(db, channelInput('alpha'))
      await saveChannelYoutubeConnection(db, a.id, {
        refreshToken: 'refresh-a',
        encryptionKey: KEY,
        youtubeChannelId: 'UC-a',
        youtubeChannelTitle: null,
      })

      await recordChannelYoutubeVerify(db, a.id, 'ok', 'UC-a')
      expect(await channelYoutubeConnected(db, a.id)).toBe(true)
      expect((await channelYoutubeConnection(db, a.id))?.lastVerifiedAt).toBeInstanceOf(Date)

      await recordChannelYoutubeVerify(db, a.id, 'ok', 'UC-other')
      expect(await channelYoutubeConnected(db, a.id)).toBe(false)
      const reconnect = await channelYoutubeReconnectNeeded(db, a.id)
      expect(reconnect.needed).toBe(true)
      expect(reconnect.since).toBeInstanceOf(Date)
      expect((await channelYoutubeConnection(db, a.id))?.youtubeChannelId).toBe('UC-a')
    })

    it('a verify fills a connection that has no YouTube channel id yet', async () => {
      const a = await createChannel(db, channelInput('alpha'))
      await saveChannelYoutubeConnection(db, a.id, {
        refreshToken: 'refresh-a',
        encryptionKey: KEY,
        youtubeChannelId: null,
        youtubeChannelTitle: null,
      })
      expect(await channelYoutubeReconnectNeeded(db, a.id)).toEqual({ needed: false, since: null })

      await recordChannelYoutubeVerify(db, a.id, 'ok', 'UC-a')
      expect(await channelYoutubeConnected(db, a.id)).toBe(true)
      expect((await channelYoutubeConnection(db, a.id))?.youtubeChannelId).toBe('UC-a')
    })

    it('connectedChannelIds lists every non-archived connection, invalid ones included', async () => {
      const a = await createChannel(db, channelInput('alpha'))
      const b = await createChannel(db, channelInput('beta'))
      const c = await createChannel(db, channelInput('gamma'))
      for (const channel of [a, b, c]) {
        await saveChannelYoutubeConnection(db, channel.id, {
          refreshToken: `refresh-${channel.slug}`,
          encryptionKey: KEY,
          youtubeChannelId: null,
          youtubeChannelTitle: null,
        })
      }
      await recordChannelYoutubeVerify(db, a.id, 'ok')
      await recordChannelYoutubeVerify(db, b.id, 'ok')
      await recordChannelYoutubeVerify(db, c.id, 'invalid')
      await archiveChannel(db, b.id)

      expect(await connectedChannelIds(db)).toEqual([a.id, c.id])
    })
  })
})
