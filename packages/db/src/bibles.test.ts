import {
  DEFAULT_SETTINGS,
  EMPTY_BIBLE,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_BIBLE_ID,
  FIRST_CHANNEL_ID,
} from '@boom-busters/schemas'
import { eq, sql as dsql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { bibleVersionById, currentBible, listBibleVersions, saveBibleVersion } from './bibles'
import { createCase } from './cases'
import { channelForProject, createChannel, ensureFirstChannel, getChannel } from './channels'
import { createDb } from './client'
import { createProjectFromCase } from './projects'
import { cases, channelBibles, channels, projects, workspace, youtubeConnections } from './schema'
import { requireTestDatabase } from './test-database'

/**
 * Bible versions and the project freeze against a real database: the unique
 * (channel, version) index, the circular keys and the transaction that moves
 * the current pointer are Postgres behaviour a mock would only imitate.
 */

const url = requireTestDatabase()
const suite = url ? describe : describe.skip

function channelInput(slug: string) {
  return {
    name: `Channel ${slug}`,
    handle: null,
    slug,
    settings: DEFAULT_SETTINGS,
    bible: EMPTY_BIBLE,
  }
}

suite('bible versions', () => {
  const { sql, db } = createDb(url ?? 'postgres://unused', { max: 2 })

  beforeEach(async () => {
    await db.execute(
      dsql`truncate table ${channels}, ${channelBibles}, ${workspace}, ${youtubeConnections}, ${projects}, ${cases} restart identity cascade`,
    )
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('createChannel writes version 1 and points the channel at it', async () => {
    const channel = await createChannel(db, channelInput('alpha'))
    expect(channel).toMatchObject({ bibleVersion: 1, bible: EMPTY_BIBLE })
    expect(channel.slotIds).toEqual([...EXAMPLE_SLOT_IDS])

    const current = await currentBible(db, channel.id)
    expect(current).toMatchObject({ id: channel.bibleId, version: 1, note: 'Created' })
  })

  it('a save appends the next version and moves the pointer; the old version is untouched', async () => {
    const channel = await createChannel(db, channelInput('alpha'))
    const v1 = await currentBible(db, channel.id)

    const bible = { ...FIRST_CHANNEL_BIBLE, subject: 'shipwrecks' }
    const v2 = await saveBibleVersion(db, channel.id, bible, 'Edited in Settings')

    expect(v2).toMatchObject({ version: 2, note: 'Edited in Settings', complete: true })
    expect(v2.slotIds).toEqual([...EXAMPLE_SLOT_IDS])
    expect((await currentBible(db, channel.id)).id).toBe(v2.id)
    expect((await getChannel(db, channel.id)).bible.subject).toBe('shipwrecks')

    // Version 1 is exactly as it was written.
    expect(await bibleVersionById(db, v1.id)).toEqual(v1)
  })

  it('stores complete false for an empty bible', async () => {
    const channel = await createChannel(db, channelInput('alpha'))
    const saved = await saveBibleVersion(db, channel.id, EMPTY_BIBLE, 'Edited in Settings')
    expect(saved.complete).toBe(false)

    const full = await saveBibleVersion(db, channel.id, FIRST_CHANNEL_BIBLE, 'Edited in Settings')
    expect(full.complete).toBe(true)
  })

  it('createProjectFromCase freezes the current version; a later save does not move it', async () => {
    const channel = await createChannel(db, channelInput('alpha'))
    const kase = await createCase(db, {
      title: 'Enron',
      category: 'collapse',
      channelId: channel.id,
    })

    const project = await createProjectFromCase(db, { caseId: kase.id, title: 'Enron' })
    expect(project.bibleId).toBe(channel.bibleId)

    await saveBibleVersion(
      db,
      channel.id,
      { ...EMPTY_BIBLE, subject: 'shipwrecks' },
      'Edited in Settings',
    )

    const frozen = await channelForProject(db, project.id)
    expect(frozen).toMatchObject({
      channelId: channel.id,
      slug: 'alpha',
      bibleId: channel.bibleId,
      bibleVersion: 1,
      bible: EMPTY_BIBLE,
    })
    expect(frozen.slotIds).toEqual([...EXAMPLE_SLOT_IDS])
    expect((await getChannel(db, channel.id)).bibleVersion).toBe(2)

    // A project started after the save freezes the new version.
    const later = await createProjectFromCase(db, { caseId: kase.id, title: 'Enron again' })
    expect((await channelForProject(db, later.id)).bibleVersion).toBe(2)
  })

  it('refuses a version that belongs to another channel for the case', async () => {
    const a = await createChannel(db, channelInput('alpha'))
    const b = await createChannel(db, channelInput('beta'))
    const kase = await createCase(db, { title: 'Enron', category: 'collapse', channelId: a.id })

    await expect(
      createProjectFromCase(db, { caseId: kase.id, title: 'Enron', bibleId: b.bibleId }),
    ).rejects.toThrow('bible version belongs to another channel')
    expect(await db.select().from(projects)).toHaveLength(0)
  })

  it('ensureFirstChannel run twice leaves one version, with the fixed id', async () => {
    await ensureFirstChannel(db)
    const again = await ensureFirstChannel(db)

    const versions = await db
      .select()
      .from(channelBibles)
      .where(eq(channelBibles.channelId, FIRST_CHANNEL_ID))
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({
      id: FIRST_CHANNEL_BIBLE_ID,
      version: 1,
      complete: true,
      note: 'Lifted from code',
      bible: FIRST_CHANNEL_BIBLE,
    })
    expect(again).toMatchObject({ bibleId: FIRST_CHANNEL_BIBLE_ID, bibleVersion: 1 })
  })

  it('a version stored with only the eleven stage A keys is parsed with defaults on every read', async () => {
    const channel = await createChannel(db, channelInput('stage-a'))
    const stageA = {
      subject: 'corporate collapses',
      whatACaseIs: 'A good case has a paper trail.',
      subjectKind: 'the common name',
      audience: 'adults',
      narrationRegister: 'plain',
      visualRegister: 'dark',
      titleStyle: 'sober',
      ctaLine: 'The full story is on the channel',
      caseCategories: [{ key: 'collapse', label: 'Collapse' }],
      scriptRulesMd: '',
      directionRulesMd: '',
    }
    const [row] = await db
      .insert(channelBibles)
      .values({
        channelId: channel.id,
        version: 2,
        bible: stageA as never,
        slotIds: [],
        complete: false,
        note: 'Stage A',
      })
      .returning()
    await db.update(channels).set({ currentBibleId: row!.id }).where(eq(channels.id, channel.id))

    const current = await currentBible(db, channel.id)
    const byId = await bibleVersionById(db, row!.id)
    const listed = (await listBibleVersions(db, channel.id)).find((v) => v.id === row!.id)

    for (const version of [current, byId, listed!]) {
      expect(version.bible.examples).toEqual({})
      expect(version.bible.subject).toBe('corporate collapses')
      expect(version.bible.subjectNoun).toEqual(EMPTY_BIBLE.subjectNoun)
    }
  })

  it('a save for an unknown channel throws and writes nothing', async () => {
    await expect(
      saveBibleVersion(db, '01BB0000000000000000000009', EMPTY_BIBLE, 'Edited in Settings'),
    ).rejects.toThrow()
    expect(await db.select().from(channelBibles)).toHaveLength(0)
  })
})
