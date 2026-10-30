// @vitest-environment node

import {
  bibleDrafts,
  createChannel,
  getBibleDraft,
  openBibleDraft,
  requireTestDatabase,
  seed,
  truncateRunMirror,
  updateWorkspace,
  writeBibleDraft,
} from '@boom-busters/db'
import type * as ProvidersModule from '@boom-busters/providers'
import { mockResearchDigest } from '@boom-busters/providers'
import {
  BIBLE_SECTION_LABELS,
  BIBLE_SECTION_ORDER,
  BIBLE_SECTIONS,
  DEFAULT_SETTINGS,
  DEFAULT_WORKSPACE_SETTINGS,
  EMPTY_BIBLE,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_ID,
  bibleDraftUnits,
  bibleSaveBlockers,
  isBibleComplete,
  sectionIsEmpty,
  unitKey,
} from '@boom-busters/schemas'
import type {
  BibleDraft,
  BibleDraftUnit,
  BibleResearchDigest,
  ChannelBible,
} from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { bibleDrafter } from './bible-drafter'

/**
 * The bible drafter in mock-provider mode against the real database. A seam
 * replaces the mock answer for a unit, so a test can hand it a bad answer, a
 * copied line or a failure; every request the drafter builds is recorded.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

type Seam = (unit: BibleDraftUnit) => Partial<ChannelBible> | undefined

const seams = vi.hoisted(() => ({
  answers: [] as unknown[],
  requests: [] as { unit: BibleDraftUnit; steer?: string; previousError?: string }[],
}))

vi.mock('@boom-busters/providers', async (importOriginal) => {
  const original = await importOriginal<typeof ProvidersModule>()
  return {
    ...original,
    buildBibleUnitRequest: (input: Parameters<typeof original.buildBibleUnitRequest>[0]) => {
      seams.requests.push({
        unit: input.unit,
        ...(input.steer ? { steer: input.steer } : {}),
        ...(input.previousError ? { previousError: input.previousError } : {}),
      })
      return original.buildBibleUnitRequest(input)
    },
    mockBibleUnit: (unit: BibleDraftUnit) => {
      const next = seams.answers.shift() as Seam | Error | undefined
      if (next instanceof Error) throw next
      return (next && next(unit)) ?? original.mockBibleUnit(unit)
    },
  }
})

const describeDb = requireTestDatabase() ? describe : describe.skip

const INPUTS = {
  description: 'How minds work',
  audience: 'Curious adults',
  admiredChannels: [],
  videos: [],
  avoid: '',
}

const unique = () => `ch-${Math.random().toString(36).slice(2, 9)}`

/** The first ten words of a text, as a run a copy would share. */
const firstWords = (text: string, n: number) => text.split(/\s+/).slice(0, n).join(' ')

const request = (
  channelId: string,
  units: BibleDraftUnit[],
  steer?: string,
): { events: [{ name: string; data: Record<string, unknown> }] } => ({
  events: [
    {
      name: 'bible/draft.requested',
      data: { channelId, units, ...(steer ? { steer } : {}) },
    },
  ],
})

/** A digest holding one pattern with the given quote and sources' ownership. */
function digestWith(quote: string, own: boolean[]): BibleResearchDigest {
  const base = mockResearchDigest(INPUTS)
  return {
    ...base,
    patterns: [
      {
        kind: 'hook',
        pattern: 'A pattern',
        quote,
        sources: own.map((o, i) => ({
          videoId: `vid${i}`,
          channel: o ? 'Mine' : 'Other Channel',
          title: `Title ${i}`,
          own: o,
        })),
      },
    ],
  }
}

describeDb('bible-drafter (mock mode)', () => {
  let engine: InngestTestEngine
  let channelId: string

  async function prepare(id: string, research: BibleResearchDigest | null = null) {
    await openBibleDraft(db, id)
    await writeBibleDraft(
      db,
      id,
      (draft) => ({
        ...draft,
        inputs: INPUTS,
        research,
        job: {
          kind: 'draft',
          state: 'running',
          current: null,
          error: null,
          startedAt: new Date().toISOString(),
        },
      }),
      { allowWhileRunning: true },
    )
  }

  const draftOf = async (id = channelId): Promise<BibleDraft> => {
    const draft = await getBibleDraft(db, id)
    if (!draft) throw new Error('no draft')
    return draft
  }

  beforeEach(async () => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    seams.answers = []
    seams.requests = []
    engine = new InngestTestEngine({ function: bibleDrafter })
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await updateWorkspace(db, DEFAULT_WORKSPACE_SETTINGS)
    await db.delete(bibleDrafts)
    const channel = await createChannel(db, {
      name: 'Minds',
      handle: null,
      slug: unique(),
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    channelId = channel.id
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('drafts every unit into an empty channel and leaves each filled section drafted', async () => {
    await prepare(channelId, mockResearchDigest(INPUTS))
    const { result } = await engine.execute(request(channelId, bibleDraftUnits()))
    expect(result).toMatchObject({ outcome: 'drafted' })

    const draft = await draftOf()
    const filled = BIBLE_SECTION_ORDER.filter((s) => !sectionIsEmpty(draft.bible, s))
    expect(filled.length).toBeGreaterThan(0)
    for (const section of filled) expect(draft.statuses[section]).toBe('drafted')
    expect(isBibleComplete(draft.bible)).toBe(true)
    expect(bibleSaveBlockers(draft)).toEqual(
      expect.arrayContaining(
        filled.map((section) => `${BIBLE_SECTION_LABELS[section]} is drafted, not approved`),
      ),
    )
    expect(draft.errors).toEqual({})
    // The mock psychology examples reuse some craft wording of Boom & Busters' own,
    // which the check rightly flags; the hooks share nothing with the digest.
    const flags = Object.entries(draft.tooClose)
    expect(
      flags.every(
        ([path, flag]) => path.startsWith('examples.') && flag.source === 'Boom & Busters',
      ),
    ).toBe(true)
    expect(draft.job).toMatchObject({ kind: 'draft', state: 'done', current: null, error: null })
    // The sources the research names survive.
    expect(draft.bible.hooks[0]?.drawnFrom.length).toBeGreaterThan(0)
  })

  it('keeps the good answer after a refused first one, and records no error', async () => {
    await prepare(channelId)
    const unit = bibleDraftUnits(['examples'])[0]!
    const key = unitKey(unit)
    await writeBibleDraft(db, channelId, (draft) => ({ ...draft, errors: { [key]: 'old' } }), {
      allowWhileRunning: true,
    })
    seams.answers = [() => ({ examples: { 'not-a-slot-id': 'x' } })]

    await engine.execute(request(channelId, [unit]))

    const draft = await draftOf()
    expect(draft.errors).toEqual({})
    expect(draft.statuses.examples).toBe('drafted')
    const slot = EXAMPLE_SLOTS.find((s) => 'source' in unit && s.source === unit.source)!
    expect(draft.bible.examples[slot.id]).toBeTruthy()
    expect(draft.bible.examples['not-a-slot-id']).toBeUndefined()
    // The second request carries the first refusal.
    expect(seams.requests).toHaveLength(2)
    expect(seams.requests[1]?.previousError).toBeTruthy()
  })

  it('writes the error after two bad answers, leaves the status, and drafts the next unit', async () => {
    await prepare(channelId)
    const [first] = bibleDraftUnits(['examples'])
    const bad: Seam = () => ({ examples: { 'not-a-slot-id': 'x' } })
    seams.answers = [bad, bad]

    await engine.execute(request(channelId, [first!, { section: 'voice' }]))

    const draft = await draftOf()
    expect(draft.errors[unitKey(first!)]).toBeTruthy()
    expect(draft.statuses.examples).toBe('approved')
    expect(Object.keys(draft.bible.examples)).toEqual([])
    expect(draft.statuses.voice).toBe('drafted')
    expect(draft.bible.narrationRegister).not.toBe('')
    expect(draft.job).toMatchObject({ state: 'done' })
  })

  it('flags a hook sharing eight words with another creator’s quote, not an own one', async () => {
    const quote = 'one two three four five six seven eight nine'
    const copied: Seam = () => ({
      hooks: [
        { text: `Start ${quote} end`, note: 'n', drawnFrom: [] },
        { text: 'A wholly different line with its own words and shape', note: 'n', drawnFrom: [] },
      ],
      openings: [],
      titles: [],
    })

    await prepare(channelId, digestWith(quote, [false]))
    seams.answers = [copied]
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    const flagged = await draftOf()
    expect(Object.keys(flagged.tooClose)).toEqual(['hooks.0'])
    expect(flagged.tooClose['hooks.0']?.source).toBe('Other Channel: Title 0')
    expect(bibleSaveBlockers(flagged)).toContain('hooks.0 is too close to its source')

    await db.delete(bibleDrafts)
    await prepare(channelId, digestWith(quote, [true]))
    seams.answers = [copied]
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    expect((await draftOf()).tooClose).toEqual({})

    // A pattern with any own source is the channel's own words, not a source.
    await db.delete(bibleDrafts)
    await prepare(channelId, digestWith(quote, [false, true]))
    seams.answers = [copied]
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    expect((await draftOf()).tooClose).toEqual({})
  })

  it('flags an example that copies Boom & Busters’ bible on a second channel only', async () => {
    const slot = EXAMPLE_SLOTS.find(
      (s) => (FIRST_CHANNEL_BIBLE.examples[s.id] ?? '').split(/\s+/).length >= 10,
    )!
    const copy = firstWords(FIRST_CHANNEL_BIBLE.examples[slot.id]!, 10)
    const unit: BibleDraftUnit = { section: 'examples', slotId: slot.id }
    const answer: Seam = () => ({ examples: { [slot.id]: copy } })

    await prepare(channelId)
    seams.answers = [answer]
    await engine.execute(request(channelId, [unit]))
    const second = await draftOf()
    expect(second.tooClose[`examples.${slot.id}`]).toMatchObject({ source: 'Boom & Busters' })

    // The first channel's own bible is never a source for itself.
    await prepare(FIRST_CHANNEL_ID)
    seams.answers = [answer]
    await engine.execute(request(FIRST_CHANNEL_ID, [unit]))
    expect((await draftOf(FIRST_CHANNEL_ID)).tooClose).toEqual({})
  })

  it('clears the unit’s earlier flags and leaves other fields’ flags alone', async () => {
    await prepare(channelId, mockResearchDigest(INPUTS))
    const flag = { source: 'Somewhere', run: 'a b c d e f g h' }
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        tooClose: { 'hooks.0': flag, 'titles.1': flag, 'examples.script-foreshadow': flag },
      }),
      { allowWhileRunning: true },
    )
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    expect((await draftOf()).tooClose).toEqual({ 'examples.script-foreshadow': flag })
  })

  it('drops a drawnFrom entry the research does not name, and keeps none without research', async () => {
    const digest = mockResearchDigest(INPUTS)
    const named = digest.videos[0]!
    await prepare(channelId, { ...digest, videos: [named] })
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    const kept = await draftOf()
    const ids = [...kept.bible.hooks, ...kept.bible.openings, ...kept.bible.titles].flatMap((e) =>
      e.drawnFrom.map((from) => from.videoId),
    )
    expect(ids.every((id) => id === named.videoId)).toBe(true)

    await db.delete(bibleDrafts)
    await prepare(channelId, null)
    await engine.execute(request(channelId, [{ section: 'hooks' }]))
    const bare = await draftOf()
    const entries = [...bare.bible.hooks, ...bare.bible.openings, ...bare.bible.titles]
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every((e) => e.drawnFrom.length === 0)).toBe(true)
  })

  it('redraws one section with the steer and changes only that section’s keys', async () => {
    await prepare(channelId)
    const before: ChannelBible = { ...EMPTY_BIBLE, subject: 'Minds', language: 'en' }
    await writeBibleDraft(db, channelId, (draft) => ({ ...draft, bible: before }), {
      allowWhileRunning: true,
    })

    await engine.execute(request(channelId, [{ section: 'voice' }], 'more clinical'))

    expect(seams.requests[0]).toMatchObject({ unit: { section: 'voice' }, steer: 'more clinical' })
    const after = (await draftOf()).bible
    const changed = (Object.keys(after) as (keyof ChannelBible)[]).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]),
    )
    expect(changed.length).toBeGreaterThan(0)
    for (const key of changed) expect(BIBLE_SECTIONS.voice).toContain(key)
  })

  it('shows the unit in progress, and onFailure leaves the reason on the draft', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await prepare(channelId)
    seams.answers = [new Error('the model is down')]
    const { error } = await engine.execute(request(channelId, [{ section: 'voice' }]))
    expect(JSON.stringify(error)).toContain('the model is down')
    expect((await draftOf()).job).toMatchObject({ state: 'running', current: 'Voice' })

    // The harness does not run `onFailure`, so it is called as Inngest would.
    const opts = (
      bibleDrafter as unknown as { opts: { onFailure: (args: unknown) => Promise<void> } }
    ).opts
    await opts.onFailure({
      event: {
        data: {
          event: { data: { channelId } },
          error: { message: 'the model is down' },
        },
      },
    })
    expect((await draftOf()).job).toMatchObject({
      state: 'failed',
      current: null,
      error: 'the model is down',
    })
  })
})
