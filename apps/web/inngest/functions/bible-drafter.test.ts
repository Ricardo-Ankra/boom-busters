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
  jobIsRunning,
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
import { bibleDrafter, failBibleDraft } from './bible-drafter'

/**
 * The bible drafter in mock-provider mode against the real database. A seam
 * replaces the mock answer for a unit, so a test can hand it a bad answer, a
 * copied line or a failure; every request the drafter builds is recorded.
 */

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

type Seam = (unit: BibleDraftUnit) => Partial<ChannelBible> | undefined

const seams = vi.hoisted(() => ({
  answers: [] as unknown[],
  requests: [] as { unit: BibleDraftUnit; text: string; steer?: string; previousError?: string }[],
}))

vi.mock('@boom-busters/providers', async (importOriginal) => {
  const original = await importOriginal<typeof ProvidersModule>()
  return {
    ...original,
    buildBibleUnitRequest: (input: Parameters<typeof original.buildBibleUnitRequest>[0]) => {
      const built = original.buildBibleUnitRequest(input)
      seams.requests.push({
        unit: input.unit,
        text: built.messages.map((m) => m.content).join(' '),
        ...(input.steer ? { steer: input.steer } : {}),
        ...(input.previousError ? { previousError: input.previousError } : {}),
      })
      return built
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
  jobStartedAt?: string,
): { events: [{ name: string; data: Record<string, unknown> }] } => ({
  events: [
    {
      name: 'bible/draft.requested',
      data: {
        channelId,
        units,
        ...(steer ? { steer } : {}),
        ...(jobStartedAt ? { jobStartedAt } : {}),
      },
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
    expect(draft.tooClose).toEqual({})
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

  it('compares every slot kind with Boom & Busters, the craft wording aside', async () => {
    const copyOf = (kind: string) => {
      const slot = EXAMPLE_SLOTS.find(
        (s) =>
          s.kind === kind && (FIRST_CHANNEL_BIBLE.examples[s.id] ?? '').split(/\s+/).length >= 10,
      )!
      return { slot, copy: firstWords(FIRST_CHANNEL_BIBLE.examples[slot.id]!, 10) }
    }
    const passage = copyOf('passage')
    const line = copyOf('line')
    const direction = EXAMPLE_SLOTS.find((s) => s.id === 'direction-worked-example')!
    const worked = {
      slot: direction,
      copy: firstWords(FIRST_CHANNEL_BIBLE.examples[direction.id]!, 10),
    }
    await prepare(channelId)
    for (const { slot, copy } of [worked, passage, line]) {
      seams.answers = [() => ({ examples: { [slot.id]: copy } })]
      await engine.execute(request(channelId, [{ section: 'examples', slotId: slot.id }]))
    }
    const flags = (await draftOf()).tooClose
    expect(flags[`examples.${worked.slot.id}`]).toMatchObject({ source: 'Boom & Busters' })
    expect(flags[`examples.${passage.slot.id}`]).toMatchObject({ source: 'Boom & Busters' })
    expect(flags[`examples.${line.slot.id}`]).toMatchObject({ source: 'Boom & Busters' })
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

  it('leaves the list and example flags alone when another section is redrafted', async () => {
    await prepare(channelId, mockResearchDigest(INPUTS))
    const flag = { source: 'Somewhere', run: 'a b c d e f g h' }
    const flags = { 'hooks.0': flag, 'titles.1': flag, 'examples.script-foreshadow': flag }
    await writeBibleDraft(db, channelId, (draft) => ({ ...draft, tooClose: flags }), {
      allowWhileRunning: true,
    })
    await engine.execute(request(channelId, [{ section: 'voice' }]))
    expect((await draftOf()).tooClose).toEqual(flags)
  })

  it('a single-slot unit writes only that slot, keeping the others and their flags', async () => {
    await prepare(channelId)
    const [slot, other] = EXAMPLE_SLOTS.filter((s) => s.kind === 'line')
    const flag = { source: 'Somewhere', run: 'a b c d e f g h' }
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        bible: { ...draft.bible, examples: { [other!.id]: 'kept as it was' } },
        tooClose: { [`examples.${other!.id}`]: flag },
      }),
      { allowWhileRunning: true },
    )
    await engine.execute(request(channelId, [{ section: 'examples', slotId: slot!.id }]))
    const draft = await draftOf()
    expect(Object.keys(draft.bible.examples).sort()).toEqual([slot!.id, other!.id].sort())
    expect(draft.bible.examples[other!.id]).toBe('kept as it was')
    expect(draft.bible.examples[slot!.id]).toBeTruthy()
    expect(draft.tooClose).toEqual({ [`examples.${other!.id}`]: flag })
    expect(draft.statuses.examples).toBe('drafted')
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
    expect(seams.requests[0]?.text).toContain('The owner asks: more clinical')
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
  describe('the job it owns', () => {
    const FORTY_MINUTES_AGO = () => new Date(Date.now() - 40 * 60_000).toISOString()

    /** A draft whose running job began at `startedAt`, with the requested units stored. */
    async function startJob(
      startedAt: string,
      extra: Partial<NonNullable<BibleDraft['job']>> = {},
    ) {
      await prepare(channelId)
      await writeBibleDraft(
        db,
        channelId,
        (draft) => ({
          ...draft,
          job: {
            ...draft.job!,
            startedAt,
            units: [{ section: 'voice' }],
            steer: 'shorter',
            ...extra,
          },
        }),
        { allowWhileRunning: true },
      )
    }

    it('refreshes the heartbeat as each unit is written, so a long run stays alive', async () => {
      const startedAt = FORTY_MINUTES_AGO()
      await startJob(startedAt)
      expect(jobIsRunning((await draftOf()).job!)).toBe(false)

      // The first unit starts and the run is then lost: the heartbeat is still fresh.
      seams.answers = [new Error('the model is down')]
      await engine.execute(request(channelId, [{ section: 'voice' }], undefined, startedAt))
      const job = (await draftOf()).job!
      expect(job.startedAt).toBe(startedAt)
      expect(Date.now() - Date.parse(job.heartbeatAt!)).toBeLessThan(60_000)
      expect(jobIsRunning(job)).toBe(true)
    })

    it('a run that lost its job writes no section, spends nothing and leaves the newer job alone', async () => {
      const newer = new Date().toISOString()
      await startJob(newer)
      const before = await draftOf()

      const staleStart = new Date(Date.now() - 5 * 60_000).toISOString()
      const { result } = await engine.execute(
        request(channelId, [{ section: 'voice' }], undefined, staleStart),
      )
      expect(result).toMatchObject({ outcome: 'drafted' })

      const after = await draftOf()
      expect(after.bible).toEqual(before.bible)
      expect(after.statuses).toEqual(before.statuses)
      expect(after.errors).toEqual({})
      // `finish` did not write `done` over the newer job.
      expect(after.job).toEqual(before.job)
      expect(seams.requests).toHaveLength(0)
    })

    it('a run that owns the job finishes it, keeping the stored units and steer', async () => {
      const startedAt = new Date().toISOString()
      await startJob(startedAt)
      await engine.execute(request(channelId, [{ section: 'voice' }], 'shorter', startedAt))
      expect((await draftOf()).job).toMatchObject({
        state: 'done',
        startedAt,
        units: [{ section: 'voice' }],
        steer: 'shorter',
      })
    })

    it('the fail writer keeps the units and steer, and leaves a newer job alone', async () => {
      const startedAt = new Date().toISOString()
      await startJob(startedAt)

      await failBibleDraft(channelId, 'old run died', new Date(Date.now() - 60_000).toISOString())
      expect((await draftOf()).job).toMatchObject({ state: 'running', error: null })

      await failBibleDraft(channelId, 'the model is down', startedAt)
      expect((await draftOf()).job).toMatchObject({
        state: 'failed',
        error: 'the model is down',
        units: [{ section: 'voice' }],
        steer: 'shorter',
      })
    })
  })
})
