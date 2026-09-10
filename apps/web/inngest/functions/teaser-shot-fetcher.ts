import { getShort, updateShort } from '@boom-busters/db'
import {
  BudgetExceededError,
  parseEventData,
  TeaserFetchesRecordSchema,
  TeaserScriptRecordSchema,
  TeaserShotsRecordSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { SlotCandidate, TeaserFetchesRecord, TeaserFetchState } from '@boom-busters/schemas'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { ingestCandidateBytes } from '@/lib/stock-ingest'
import { slotFromTeaserCandidate } from '@/lib/teaser-fetch'
import {
  fetchStockCandidates,
  generateStillCandidates,
  requireVisualKeys,
} from '@/lib/visual-assets'
import { inngest } from '../client'
import { events } from '../events'

/**
 * teaser-shot-fetcher (decision 231): the studio's per-beat new material.
 * Three ops on one event. `stock` searches the providers with the edited
 * query (free, unscored: the strip is picked by eye), `still` generates from
 * the edited prompt (paid, routed and cost-guarded exactly like a board
 * still), `ingest` pulls a picked stock candidate's bytes into R2 and stores
 * the slot snapshot as the beat's choice.
 *
 * Like the teaser-rebuild-runner, this is not a stage runner: the project may
 * sit at shorts or publish while a teaser is reworked, so failures never
 * touch the stage. They land as words in the beat's fetch state, which the
 * studio renders, and as a notification for the case where the studio was
 * closed before the runner finished.
 */

const FUNCTION_ID = 'teaser-shot-fetcher'

/** How many stock results a beat's strip keeps per search. */
export const TEASER_STOCK_KEPT = 12

function isStillCandidate(candidate: SlotCandidate): boolean {
  return candidate.provider === 'fal' || candidate.provider === 'google'
}

export const teaserShotFetcher = inngest.createFunction(
  {
    id: FUNCTION_ID,
    name: 'Teaser shot fetch',
    retries: 2,
    cancelOn: [
      {
        event: 'project/cancelled',
        if: 'async.data.projectId == event.data.projectId',
      },
    ],
    onFailure: async ({ event }) => {
      // Retries exhausted on an unexpected throw: leave words, not a spinner.
      const data = event.data.event.data
      const shortId = data['shortId']
      const beatIndex = data['beatIndex']
      const projectId = data['projectId']
      if (typeof shortId !== 'string' || typeof beatIndex !== 'number') return
      const what = data['op'] === 'still' ? 'still' : data['op'] === 'ingest' ? 'ingest' : 'stock'
      await writeBeatState(shortId, beatIndex, {
        state: 'failed',
        what,
        reason: 'The fetch stopped unexpectedly. Ask again to retry.',
      })
      if (typeof projectId === 'string') {
        await notify({
          kind: 'run-failed',
          title: 'The teaser shot fetch stopped',
          body: `Beat ${beatIndex + 1}'s ${what} request failed after retries.`,
          href: `/projects/${projectId}?stage=shorts`,
        })
      }
    },
    triggers: [events.teaserShotsRequested],
  },
  async ({ event, step }) => {
    const data = parseEventData('teaser/shots.requested', event.data)
    const { projectId, shortId, beatIndex } = data

    const beat = await step.run('load-beat', async () => {
      const short = await getShort(db, shortId)
      if (!short) throw new NonRetriableError(`Short ${shortId} no longer exists`)
      if (short.kind !== 'teaser') {
        throw new NonRetriableError('Only a teaser fetches new shots; excerpts slice the master.')
      }
      const script = TeaserScriptRecordSchema.safeParse(short.teaserScript)
      if (!script.success || script.data.paragraphs[beatIndex] === undefined) {
        throw new NonRetriableError(`The teaser has no beat ${beatIndex + 1} to fetch for.`)
      }
      return { text: script.data.paragraphs[beatIndex]!.text }
    })

    const failed = async (stepName: string, what: TeaserFetchState['what'], reason: string) => {
      await step.run(stepName, async () => {
        await writeBeatState(shortId, beatIndex, { state: 'failed', what, reason })
        await notify({
          kind: 'run-failed',
          title: 'The teaser shot fetch stopped',
          body: `Beat ${beatIndex + 1}: ${reason}`,
          href: `/projects/${projectId}?stage=shorts`,
        })
      })
      return { projectId, shortId, beatIndex, outcome: 'failed' as const, reason }
    }

    // -------------------------------------------------------------------
    // stock: search, keep the freshest results, keep every paid still
    // -------------------------------------------------------------------
    if (data.op === 'stock') {
      const outcome = await step.run('fetch-stock', async () => {
        try {
          await requireVisualKeys(new Set(['stock']))
          const found = await fetchStockCandidates({
            type: 'stock',
            coversText: beat.text,
            description: data.query,
            query: data.query,
            rejectionCriteria: [],
            motion: { kind: 'static' },
            transition: 'cut',
          })
          return { ok: true as const, found: found.slice(0, TEASER_STOCK_KEPT) }
        } catch (error) {
          if (error instanceof ValidationError) {
            return { ok: false as const, reason: error.message }
          }
          throw error
        }
      })
      if (!outcome.ok) return failed('stock-refused', 'stock', outcome.reason)

      await step.run('store-stock', () =>
        writeBeat(shortId, beatIndex, (stored) => ({
          state: null,
          // A re-search replaces the free results; bought stills stay.
          candidates: [...stored.candidates.filter(isStillCandidate), ...outcome.found],
        })),
      )
      return {
        projectId,
        shortId,
        beatIndex,
        outcome: 'fetched' as const,
        kept: outcome.found.length,
      }
    }

    // -------------------------------------------------------------------
    // still: paid generation, cost-guarded exactly like a board still
    // -------------------------------------------------------------------
    if (data.op === 'still') {
      const outcome = await step.run('generate-still', async () => {
        try {
          const made = await generateStillCandidates(
            {
              type: 'still',
              coversText: beat.text,
              description: data.prompt,
              prompt: data.prompt,
              motion: { kind: 'static' },
              transition: 'cut',
            },
            projectId,
          )
          return { ok: true as const, made }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, reason: `the budget ceiling refused it: ${error.message}` }
          }
          if (error instanceof ValidationError) {
            return { ok: false as const, reason: error.message }
          }
          throw error
        }
      })
      if (!outcome.ok) return failed('still-refused', 'still', outcome.reason)

      await step.run('store-still', () =>
        writeBeat(shortId, beatIndex, (stored) => ({
          state: null,
          // Paid pixels accumulate; they are never silently discarded.
          candidates: [...stored.candidates, ...outcome.made],
        })),
      )
      return {
        projectId,
        shortId,
        beatIndex,
        outcome: 'generated' as const,
        made: outcome.made.length,
      }
    }

    // -------------------------------------------------------------------
    // ingest: the picked stock candidate's bytes become ours, then the choice
    // -------------------------------------------------------------------
    const outcome = await step.run('ingest-pick', async () => {
      const short = await getShort(db, shortId)
      if (!short) throw new NonRetriableError(`Short ${shortId} no longer exists`)
      const fetches = TeaserFetchesRecordSchema.safeParse(short.teaserFetches)
      const candidate = fetches.success
        ? fetches.data.beats[beatIndex]?.candidates.find((entry) => entry.id === data.candidateId)
        : undefined
      if (!candidate) {
        return { ok: false as const, reason: 'the picked option is no longer in the beat’s pool' }
      }

      const mocked = mockProvidersEnabled()
      const settled = mocked
        ? { ok: true as const, candidate }
        : await ingestCandidateBytes(candidate)
      if (!settled.ok) return settled

      const slot = slotFromTeaserCandidate(settled.candidate, { mocked })
      if (!slot) {
        return { ok: false as const, reason: 'the option could not become a timeline slot' }
      }

      // Write the enriched candidate back (a re-pick is then instant), clear
      // the state, and store the slot snapshot as the beat's choice.
      await writeBeat(shortId, beatIndex, (stored) => ({
        state: null,
        candidates: stored.candidates.map((entry) =>
          entry.id === data.candidateId ? settled.candidate : entry,
        ),
      }))
      const shots = TeaserShotsRecordSchema.safeParse(short.teaserShots)
      const choices = shots.success ? [...shots.data.choices] : []
      while (choices.length <= beatIndex) choices.push(null)
      choices[beatIndex] = slot
      await updateShort(db, shortId, {
        teaserShots: { choices } as unknown as Record<string, unknown>,
      })
      return { ok: true as const }
    })
    if (!outcome.ok) return failed('ingest-refused', 'ingest', outcome.reason)

    return { projectId, shortId, beatIndex, outcome: 'picked' as const }
  },
)

/** Read-modify-write one beat of the fetches record. */
async function writeBeat(
  shortId: string,
  beatIndex: number,
  update: (stored: {
    state: TeaserFetchState | null
    candidates: SlotCandidate[]
  }) => TeaserFetchesRecord['beats'][number],
): Promise<void> {
  const short = await getShort(db, shortId)
  if (!short) return
  const parsed = TeaserFetchesRecordSchema.safeParse(short.teaserFetches)
  const beats = parsed.success ? [...parsed.data.beats] : []
  while (beats.length <= beatIndex) beats.push(null)
  const stored = beats[beatIndex] ?? { state: null, candidates: [] }
  const next = update({ state: stored.state, candidates: [...stored.candidates] })
  // The record must always parse back (schema caps candidates at 40): a beat
  // hoarding more keeps its newest: old stock re-earns free, and 28+ stills
  // on one beat is a pathology, not a workflow.
  beats[beatIndex] = next === null ? null : { ...next, candidates: next.candidates.slice(-40) }
  const record: TeaserFetchesRecord = { beats }
  await updateShort(db, shortId, {
    teaserFetches: record as unknown as Record<string, unknown>,
  })
}

async function writeBeatState(
  shortId: string,
  beatIndex: number,
  state: TeaserFetchState,
): Promise<void> {
  await writeBeat(shortId, beatIndex, (stored) => ({ ...stored, state }))
}
