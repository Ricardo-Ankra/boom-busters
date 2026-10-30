import { currentBible, getBibleDraft, getChannel, writeBibleDraft } from '@boom-busters/db'
import {
  buildBibleUnitRequest,
  mergeBibleUnit,
  mockBibleUnit,
  mockProvidersEnabled,
  parseBibleUnit,
} from '@boom-busters/providers'
import {
  BIBLE_SECTION_LABELS,
  EXAMPLE_SLOTS,
  FIRST_CHANNEL_ID,
  parseEventData,
  tooCloseTo,
  unitKey,
} from '@boom-busters/schemas'
import type {
  BibleDraft,
  BibleDraftUnit,
  BibleExampleEntry,
  ChannelBible,
  OverlapSource,
  TooCloseFlags,
} from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { callForAnswer } from '@/lib/answer'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { inngest } from '../client'
import { events } from '../events'

/**
 * bible-drafter: fills a channel's bible draft one unit at a time (a section,
 * one craft file's example slots, or one slot).
 *
 * Each unit is a step of its own and reads the draft inside the step, so it
 * sees the units drafted before it and a parked run never replays an old
 * bible. A unit that is refused twice leaves its reason on the draft and the
 * run moves on. A drafted unit is marked "drafted" for the owner to approve,
 * and its examples, hooks, openings and titles are checked for eight-word
 * overlap with other creators' research quotes (and, on a second channel,
 * with Boom & Busters' own bible). The channel's own words are never a source.
 */

const FUNCTION_ID = 'bible-drafter'
const LISTS = ['hooks', 'openings', 'titles'] as const
const FIRST_CHANNEL_LABEL = 'Boom & Busters'

/** Marks the draft's job failed with the reason; the owner sees it on the draft. */
export async function failBibleDraft(channelId: string, message: string): Promise<void> {
  try {
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({
        ...draft,
        job: {
          kind: 'draft',
          state: 'failed',
          current: null,
          error: message,
          startedAt: draft.job?.startedAt ?? new Date().toISOString(),
        },
      }),
      { allowWhileRunning: true },
    )
  } catch (error) {
    console.error('[bible-drafter] could not record the failure', error)
  }
}

/** The draft's job with the unit in progress named; null when the draft has no job. */
function withCurrent(draft: BibleDraft, current: string | null): BibleDraft['job'] {
  return draft.job ? { ...draft.job, current } : null
}

/** Other creators' quotes from the research digest: patterns whose every source is not the channel's own. */
function digestSources(draft: BibleDraft): OverlapSource[] {
  const sources: OverlapSource[] = []
  for (const pattern of draft.research?.patterns ?? []) {
    const first = pattern.sources[0]
    if (!pattern.quote || !first || pattern.sources.some((s) => s.own)) continue
    sources.push({ label: `${first.channel}: ${first.title}`, text: pattern.quote })
  }
  return sources
}

/** Craft sentences the slots' `teaches` lines quote: every channel keeps them word for word. */
const CRAFT_TEXTS: readonly string[] = EXAMPLE_SLOTS.map((slot) => slot.teaches)

/** Worked examples share their scaffolding (headers, component code) with every channel's: not compared. */
const WORKED_PATHS: ReadonlySet<string> = new Set(
  EXAMPLE_SLOTS.filter((slot) => slot.kind === 'worked').map((slot) => `examples.${slot.id}`),
)

interface Sources {
  /** Other creators' research quotes: no exemption. */
  digest: OverlapSource[]
  /** Boom & Busters' own bible, on a second channel; craft wording is exempt. */
  firstChannel: OverlapSource[]
}

/** On a channel other than the first, the first channel's current bible is a source too. */
async function overlapSources(channelId: string, draft: BibleDraft): Promise<Sources> {
  const sources: Sources = { digest: digestSources(draft), firstChannel: [] }
  if (channelId === FIRST_CHANNEL_ID) return sources
  const first = (await currentBible(db, FIRST_CHANNEL_ID)).bible
  const texts = [
    ...Object.values(first.examples),
    ...LISTS.flatMap((list) => first[list].map((entry) => entry.text)),
  ]
  for (const text of texts) sources.firstChannel.push({ label: FIRST_CHANNEL_LABEL, text })
  return sources
}

/** Entries keep only the videos the research names; with no research, none. */
function knownSources(
  entries: BibleExampleEntry[],
  videoIds: ReadonlySet<string>,
): BibleExampleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    drawnFrom: entry.drawnFrom.filter((from) => videoIds.has(from.videoId)),
  }))
}

/** The field paths a unit's answer wrote, with the text at each. */
function writtenFields(unit: BibleDraftUnit, answer: Partial<ChannelBible>): [string, string][] {
  if (unit.section === 'examples') {
    return Object.entries(answer.examples ?? {}).map(([id, text]) => [`examples.${id}`, text])
  }
  if (unit.section !== 'hooks') return []
  return LISTS.flatMap((list) =>
    (answer[list] ?? []).map((entry, i): [string, string] => [`${list}.${i}`, entry.text]),
  )
}

/** Whether a flag's path belongs to the fields a unit writes (so it is cleared before the new ones). */
function belongsTo(unit: BibleDraftUnit, path: string, written: readonly string[]): boolean {
  if (unit.section === 'examples') return written.includes(path)
  if (unit.section === 'hooks') return LISTS.some((list) => path.startsWith(`${list}.`))
  return false
}

async function draftUnit(input: {
  channelId: string
  unit: BibleDraftUnit
  steer: string | undefined
}): Promise<void> {
  const { channelId, unit, steer } = input
  const key = unitKey(unit)

  const start = await getBibleDraft(db, channelId)
  if (!start) throw new NonRetriableError('The channel has no bible draft to write')
  const channel = await getChannel(db, channelId)
  await writeBibleDraft(
    db,
    channelId,
    (draft) => ({ ...draft, job: withCurrent(draft, BIBLE_SECTION_LABELS[unit.section]) }),
    { allowWhileRunning: true },
  )

  const build = (previousError?: string) =>
    buildBibleUnitRequest({
      unit,
      channelName: channel.name,
      inputs: start.inputs,
      research: start.research,
      draft: start.bible,
      ...(steer ? { steer } : {}),
      ...(previousError ? { previousError } : {}),
    })

  const answer = await callForAnswer({
    request: build(),
    parse: (text) => parseBibleUnit(unit, text),
    retryWithReason: (reason) => build(reason),
    // Charged to the channel, to no project.
    complete: async (request, call) =>
      mockProvidersEnabled()
        ? { text: JSON.stringify(mockBibleUnit(unit)) }
        : callLlm(request, { channelId, ...(call === 'answer' ? {} : { purpose: call }) }),
  })

  if (!answer.ok) {
    // The section keeps its status: a unit that failed is not "drafted".
    await writeBibleDraft(
      db,
      channelId,
      (draft) => ({ ...draft, errors: { ...draft.errors, [key]: answer.issue } }),
      { allowWhileRunning: true },
    )
    return
  }

  const sources = await overlapSources(channelId, start)
  await writeBibleDraft(
    db,
    channelId,
    (draft) => {
      const videoIds = new Set((draft.research?.videos ?? []).map((v) => v.videoId))
      const value: Partial<ChannelBible> = { ...answer.value }
      for (const list of LISTS) {
        const entries = value[list]
        if (entries) value[list] = knownSources(entries, videoIds)
      }

      const fields = writtenFields(unit, value)
      const written = fields.map(([path]) => path)
      const tooClose: TooCloseFlags = Object.fromEntries(
        Object.entries(draft.tooClose).filter(([path]) => !belongsTo(unit, path, written)),
      )
      for (const [path, text] of fields) {
        const found =
          tooCloseTo(text, sources.digest) ??
          (WORKED_PATHS.has(path) ? null : tooCloseTo(text, sources.firstChannel, 8, CRAFT_TEXTS))
        if (found) tooClose[path] = found
      }

      const errors = { ...draft.errors }
      delete errors[key]
      return {
        ...draft,
        bible: mergeBibleUnit(draft.bible, unit, value),
        statuses: { ...draft.statuses, [unit.section]: 'drafted' },
        tooClose,
        errors,
      }
    },
    { allowWhileRunning: true },
  )
}

export const bibleDrafter = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Bible drafting',
    retries: 2,
    concurrency: [{ key: 'event.data.channelId', limit: 1 }],
    onFailure: async ({ event }) => {
      const channelId = event.data.event.data['channelId']
      if (typeof channelId !== 'string') return
      await failBibleDraft(channelId, String(event.data.error?.message ?? 'Unknown error'))
    },
    triggers: [events.bibleDraftRequested],
  },
  async ({ event, step }) => {
    const { channelId, units, steer } = parseEventData('bible/draft.requested', event.data)

    for (const unit of units) {
      await step.run(`draft-${unitKey(unit)}`, () => draftUnit({ channelId, unit, steer }))
    }

    await step.run('finish', async () => {
      await writeBibleDraft(
        db,
        channelId,
        (draft) => ({
          ...draft,
          job: {
            kind: 'draft',
            state: 'done',
            current: null,
            error: null,
            startedAt: draft.job?.startedAt ?? new Date().toISOString(),
          },
        }),
        { allowWhileRunning: true },
      )
    })

    return { outcome: 'drafted' as const, units: units.length }
  },
)
