'use server'

import {
  channelForProject,
  claimPointWork,
  getLatestScript,
  getRender,
  getShort,
  latestScriptParagraphSources,
  latestTimeline,
  releasePointWork,
  savePointShotChoice,
  settlePointWork,
  updateShort,
} from '@boom-busters/db'
import type { ShortRow } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import {
  BudgetExceededError,
  CropFocusSchema,
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointScriptSchema,
  PointShotMotionSchema,
  PointVoiceRecordSchema,
  pointScriptIssues,
  TimelineSchema,
  TimelineSlotSchema,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  CropFocus,
  PointFetchesRecord,
  PointPlanRecord,
  PointShotMotion,
  PointWork,
  ShortPhase,
  SlotCandidate,
} from '@boom-busters/schemas'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'
import {
  assemblePointShort,
  BRIDGE_LABEL,
  countNewPictures,
  framedPrompt,
  pointParagraphAudio,
} from '@/inngest/lib/point-build'
import { POINT_WORK_COOLDOWN_MS, pointWorkPending } from '@/lib/point-studio-model'
import { ingestCandidateBytes } from '@/lib/stock-ingest'
import { slotFromTeaserCandidate, teaserCandidateReady } from '@/lib/teaser-fetch'
import {
  fetchStockCandidates,
  generateStillCandidates,
  requireVisualKeys,
} from '@/lib/visual-assets'

/**
 * The point Short studio's actions (playbook Shorts design 6). Saving a script
 * and picking a shot are free and take effect at Assemble; Re-voice and
 * Re-plan send to the point-studio-runner; a stock search or a generated still
 * runs here, through the teaser fetcher's adapters, and fills the Short's
 * pool. Everything that spends wins an atomic claim on the Short's one slot of
 * work first (`claimPointWork`, decision 234's cooldown), so a double click
 * never pays twice.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

/** How many stock results a search keeps, as the teaser's strip does. */
const STOCK_KEPT = 12

/** The record cap `PointFetchesRecordSchema` holds. */
const POOL_MAX = 60

const WORK_WORDS: Record<PointWork, string> = {
  stock: 'stock search',
  still: 'still',
  ingest: 'download',
  voice: 're-voice',
  plan: 're-plan',
  assemble: 'assemble',
  rebuild: 'rebuild',
}

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

/** The point Short, or why there is none. */
async function loadPoint(shortId: string): Promise<{ short: ShortRow } | { error: string }> {
  if (!UlidSchema.safeParse(shortId).success) return { error: 'Unknown Short' }
  const short = await getShort(db, shortId)
  if (!short) return { error: 'Unknown Short' }
  if (short.kind !== 'point') return { error: 'Only a point Short opens in this studio.' }
  return { short }
}

/** The work in flight on this Short, within its cooldown; null when idle. */
function workInFlight(short: ShortRow): PointWork | null {
  const fetches = PointFetchesRecordSchema.safeParse(short.pointFetches)
  return fetches.success ? pointWorkPending(fetches.data.state) : null
}

function busyMessage(what: PointWork): string {
  return `A ${WORK_WORDS[what]} is already running for this Short. It lands in a moment.`
}

/** Win the Short's slot of work, or say that it is taken. */
async function win(shortId: string, what: PointWork): Promise<ActionResult> {
  const won = await claimPointWork(db, shortId, what, new Date(Date.now() - POINT_WORK_COOLDOWN_MS))
  if (won) return { ok: true }
  const short = await getShort(db, shortId)
  const running = short ? workInFlight(short) : null
  return { ok: false, error: running ? busyMessage(running) : 'This Short is busy. Try again.' }
}

/** Whether the Short's current render is still moving: a re-assemble must not null it. */
async function renderStillMoving(short: { renderId: string | null }): Promise<boolean> {
  if (!short.renderId) return false
  const render = await getRender(db, short.renderId)
  if (!render) return false
  return ['queued', 'invoking', 'rendering', 'qc'].includes(render.status)
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

/**
 * Save the edited script. Refuses a script the rule book's structure cannot
 * hold (missing or out-of-order phases, a chapter past the last). Stored on
 * the row with the render pointer nulled: the last render is a render of the
 * old words. Nothing is re-voiced here: Re-voice spends, a Save never does.
 *
 * `scriptVersion` is the long form's script version the Short was written
 * from, so an edit keeps it: bumping it would make the card claim the Short
 * is behind a script it is not, and would re-buy every unchanged paragraph
 * (the voice's idempotency key carries the version).
 */
export async function savePointScript(
  shortId: string,
  paragraphs: { phase: ShortPhase; text: string; chapterIndex: number }[],
): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded
  const running = workInFlight(short)
  if (running) return { ok: false, error: busyMessage(running) }

  const stored = PointScriptRecordSchema.safeParse(short.pointScript)
  if (!stored.success) return { ok: false, error: 'This Short has no stored script to edit.' }

  const script = PointScriptSchema.safeParse({
    title: stored.data.title,
    paragraphs: paragraphs.map((paragraph) => ({ ...paragraph, text: paragraph.text.trim() })),
  })
  if (!script.success) {
    return {
      ok: false,
      error: 'That script does not fit a Short: 5 to 12 paragraphs, each 10 to 400 characters.',
    }
  }
  const chapterCount = (await getLatestScript(db, short.projectId))?.chapters.length
  const issues = pointScriptIssues(script.data, chapterCount ?? Number.MAX_SAFE_INTEGER)
  if (issues.length > 0)
    return { ok: false, error: `That script is not valid: ${issues.join('; ')}.` }

  await updateShort(db, shortId, {
    pointScript: { ...stored.data, paragraphs: script.data.paragraphs },
    renderId: null,
  })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Re-voice and re-plan (the studio runner)
// ---------------------------------------------------------------------------

async function requestStudioWork(
  short: ShortRow,
  op: 'voice' | 'plan',
  note: string | null,
): Promise<ActionResult> {
  const claim = await win(short.id, op)
  if (!claim.ok) return claim
  try {
    await inngest.send(
      events.shortsPointStudioRequested.create({
        projectId: short.projectId,
        shortId: short.id,
        op,
        note,
      }),
    )
  } catch (error) {
    console.error('[point studio] could not request the work', error)
    // Nothing is coming: give the slot back.
    await settlePointWork(db, short.id, null)
    return { ok: false, error: 'Could not reach Inngest to start the work.' }
  }
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/** Ask the studio runner to voice the stored script: changed paragraphs only are bought. */
export async function revoicePoint(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  if (!PointScriptRecordSchema.safeParse(loaded.short.pointScript).success) {
    return { ok: false, error: 'This Short has no stored script to voice.' }
  }
  return requestStudioWork(loaded.short, 'voice', null)
}

/** Ask the studio runner to plan the shots again over the stored voice, with an optional note. */
export async function replanPoint(shortId: string, note: string): Promise<ActionResult> {
  await requireOwner()
  const trimmed = note.trim()
  if (trimmed.length > 500) return { ok: false, error: 'A note is limited to 500 characters.' }
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded

  const script = PointScriptRecordSchema.safeParse(short.pointScript)
  const voice = PointVoiceRecordSchema.safeParse(short.pointVoice)
  if (!script.success || !voice.success) {
    return { ok: false, error: 'The script is not voiced yet. Re-voice it first.' }
  }
  try {
    pointParagraphAudio(script.data, voice.data)
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        ok: false,
        error: `The voice is not the script's: ${error.message}. Re-voice first.`,
      }
    }
    throw error
  }
  return requestStudioWork(short, 'plan', trimmed === '' ? null : trimmed)
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

/**
 * Choose one shot's picture, crop and motion. A full slot snapshot is stored,
 * never an index: the long form's library is numbered for one master only
 * (design 5.1), so `{ ref }` is read off the master now and a picked fetched
 * option is stored as the slot it becomes. A live stock option whose bytes
 * are not ours yet is downloaded into R2 first. `choice: null` keeps the shot's
 * picture and changes only its crop and motion. Free: it takes effect at
 * Assemble.
 */
export async function savePointShot(
  shortId: string,
  shotIndex: number,
  choice: { ref: number } | { candidateId: string } | null,
  crop: CropFocus,
  motion: PointShotMotion,
): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded
  const running = workInFlight(short)
  if (running) return { ok: false, error: busyMessage(running) }

  const plan = PointPlanRecordSchema.safeParse(short.pointPlan)
  if (!plan.success) return { ok: false, error: 'This Short has no shot plan yet. Re-plan first.' }
  if (!Number.isInteger(shotIndex) || shotIndex < 0 || shotIndex >= plan.data.shots.length) {
    return { ok: false, error: 'Unknown shot.' }
  }
  const cropped = CropFocusSchema.safeParse(crop)
  const moved = PointShotMotionSchema.safeParse(motion)
  if (!cropped.success || !moved.success) return { ok: false, error: 'Unknown crop or motion.' }

  const current = plan.data.shots[shotIndex]!
  let slot = current.slot
  let settledCandidate: SlotCandidate | null = null
  let claimedIngest = false

  if (choice !== null && 'ref' in choice) {
    const timelineRow = await latestTimeline(db, short.projectId)
    const master = timelineRow ? TimelineSchema.safeParse(timelineRow.json) : null
    if (!master?.success)
      return { ok: false, error: 'There is no master timeline to lift shots from.' }
    const picked = Number.isInteger(choice.ref) ? master.data.slots[choice.ref] : undefined
    if (!picked) return { ok: false, error: "That is not one of the long form's shots." }
    slot = TimelineSlotSchema.parse(picked)
  } else if (choice !== null) {
    const fetches = PointFetchesRecordSchema.safeParse(short.pointFetches)
    const candidate = fetches.success
      ? fetches.data.candidates.find((entry) => entry.id === choice.candidateId)
      : undefined
    if (!fetches.success || !candidate) {
      return { ok: false, error: 'That option is no longer in this Short’s pool.' }
    }
    const mocked = mockProvidersEnabled()
    let settled: SlotCandidate = candidate
    if (!teaserCandidateReady(candidate, mocked)) {
      // The download is slow and the plan was read before it: hold the Short's
      // slot of work so no other action starts meanwhile.
      const claim = await win(shortId, 'ingest')
      if (!claim.ok) return claim
      claimedIngest = true
      const ingested = await ingestCandidateBytes(candidate).catch(async (error: unknown) => {
        await releasePointWork(db, shortId, 'ingest')
        throw error
      })
      if (!ingested.ok) {
        await releasePointWork(db, shortId, 'ingest')
        return { ok: false, error: `The picture could not be stored: ${ingested.reason}` }
      }
      settled = ingested.candidate
      settledCandidate = settled
    }
    const built = slotFromTeaserCandidate(settled, { mocked })
    if (!built) {
      if (claimedIngest) await releasePointWork(db, shortId, 'ingest')
      return { ok: false, error: 'That option could not become a timeline shot.' }
    }
    slot = built
  }

  const shots = plan.data.shots.map((shot, index) =>
    index === shotIndex ? { ...current, slot, pending: null, crop, motion } : shot,
  )
  const record: PointPlanRecord = { ...plan.data, shots }
  // One conditional write: the plan only if it is still the one read, and just
  // the settled candidate in the pool (a re-pick is then instant), so the work
  // state, a newer plan or a picture bought meanwhile are never overwritten.
  const saved = await savePointShotChoice(db, shortId, {
    expectedPlan: short.pointPlan,
    plan: record,
    ...(settledCandidate ? { settled: settledCandidate } : {}),
  })
  if (claimedIngest) await releasePointWork(db, shortId, 'ingest')
  if (!saved) {
    return {
      ok: false,
      error: 'This Short’s shots changed while you were choosing. Reload and pick again.',
    }
  }
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

type FetchOp = { op: 'stock'; query: string } | { op: 'still'; prompt: string }

/**
 * One fetch for the Short's pool, run here through the same adapters the
 * teaser's fetcher uses. The claim is won first, so the studio shows
 * "fetching" on its next render and a second press is refused; the claim is
 * always given back, as words when the work was refused.
 */
async function fetchIntoPool(
  shortId: string,
  shotIndex: number,
  op: FetchOp,
): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded
  const plan = PointPlanRecordSchema.safeParse(short.pointPlan)
  if (
    !plan.success ||
    !Number.isInteger(shotIndex) ||
    shotIndex < 0 ||
    shotIndex >= plan.data.shots.length
  ) {
    return { ok: false, error: 'Unknown shot.' }
  }

  const claim = await win(shortId, op.op)
  if (!claim.ok) return claim

  try {
    const fresh = await getShort(db, shortId)
    const stored = PointFetchesRecordSchema.safeParse(fresh?.pointFetches)
    const existing = stored.success ? stored.data.candidates : []
    let candidates: SlotCandidate[]
    if (op.op === 'stock') {
      await requireVisualKeys(new Set(['stock']))
      const found = await fetchStockCandidates({
        type: 'stock',
        coversText: op.query,
        description: op.query,
        query: op.query,
        rejectionCriteria: [],
        motion: { kind: 'static' },
        transition: 'cut',
      })
      // A re-search replaces the free results; bought stills stay.
      candidates = [
        ...existing.filter((entry) => entry.provider === 'fal' || entry.provider === 'google'),
        ...found.slice(0, STOCK_KEPT),
      ]
    } else {
      const prompt = framedPrompt(op.prompt)
      const made = await generateStillCandidates(
        {
          type: 'still',
          coversText: prompt,
          description: prompt,
          prompt,
          motion: { kind: 'static' },
          transition: 'cut',
        },
        short.projectId,
        null,
        'short',
      )
      // Paid pixels accumulate; they are never silently discarded.
      candidates = [...existing, ...made]
    }
    const record: PointFetchesRecord = { candidates: candidates.slice(-POOL_MAX), state: null }
    await updateShort(db, shortId, { pointFetches: record })
  } catch (error) {
    const reason =
      error instanceof BudgetExceededError
        ? `the budget ceiling refused it: ${error.message}`
        : error instanceof ValidationError
          ? error.message
          : 'The fetch stopped unexpectedly. Ask again to retry.'
    if (!(error instanceof BudgetExceededError) && !(error instanceof ValidationError)) {
      console.error('[point studio] the fetch stopped', error)
    }
    await settlePointWork(db, shortId, { state: 'failed', what: op.op, reason })
    revalidatePath(`/projects/${short.projectId}`)
    return { ok: false, error: reason }
  }
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/** Search the stock providers for one shot: free, and results replace the last search. */
export async function fetchPointShotOptions(
  shortId: string,
  shotIndex: number,
  query: string,
): Promise<ActionResult> {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed.length > 200) {
    return { ok: false, error: 'A search needs 2 to 200 characters.' }
  }
  return fetchIntoPool(shortId, shotIndex, { op: 'stock', query: trimmed })
}

/** Generate a still for one shot: paid; the cost guard holds the ceiling. */
export async function generatePointStill(
  shortId: string,
  shotIndex: number,
  prompt: string,
): Promise<ActionResult> {
  const trimmed = prompt.trim()
  if (trimmed.length < 4 || trimmed.length > 2000) {
    return { ok: false, error: 'A generation prompt needs 4 to 2000 characters.' }
  }
  return fetchIntoPool(shortId, shotIndex, { op: 'still', prompt: trimmed })
}

// ---------------------------------------------------------------------------
// Assemble and rebuild
// ---------------------------------------------------------------------------

/**
 * The studio's final act: compile the Short's master from the stored script,
 * voice and plan (free and synchronous, no vendor touched), then queue the
 * render. The rule book's findings are recomputed from the stored master
 * wherever they are shown, so nothing is stored beside it. Refuses in words
 * when a render is already moving, the voice is behind the script, or a shot
 * still waits for its picture.
 */
export async function assemblePoint(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded

  if (await renderStillMoving(short)) {
    return { ok: false, error: 'This Short is already rendering. The card updates as it moves.' }
  }
  const script = PointScriptRecordSchema.safeParse(short.pointScript)
  const voice = PointVoiceRecordSchema.safeParse(short.pointVoice)
  const plan = PointPlanRecordSchema.safeParse(short.pointPlan)
  if (!script.success) return { ok: false, error: 'This Short has no stored script yet.' }
  if (!voice.success)
    return { ok: false, error: 'The script is not voiced yet. Re-voice it first.' }
  if (!plan.success) return { ok: false, error: 'This Short has no shot plan yet. Re-plan first.' }
  const timelineRow = await latestTimeline(db, short.projectId)
  if (!timelineRow) return { ok: false, error: 'There is no master timeline to lift visuals from.' }

  const claim = await win(shortId, 'assemble')
  if (!claim.ok) return claim

  try {
    const channel = await channelForProject(db, short.projectId)
    const fetches = PointFetchesRecordSchema.safeParse((await getShort(db, shortId))?.pointFetches)
    const { timeline } = assemblePointShort({
      master: TimelineSchema.parse(timelineRow.json),
      script: script.data,
      voice: voice.data,
      plan: plan.data,
      bridge: { label: BRIDGE_LABEL, channelName: channel.name, handle: channel.handle ?? '' },
      newImageCount: countNewPictures(plan.data, fetches.success ? fetches.data : null),
    })
    await updateShort(db, shortId, {
      sourceTimeline: timeline as unknown as Record<string, unknown>,
      // The old render is a render of the old cut.
      renderId: null,
    })
  } catch (error) {
    await settlePointWork(db, shortId, null)
    if (error instanceof ValidationError) {
      return { ok: false, error: `The Short could not be assembled: ${error.message}` }
    }
    throw error
  }
  // The `assemble` claim stays held through the send: the render runner gives
  // it back once the render is recorded (a stale one is released by the
  // cooldown), so a second press before then is refused, not paid twice.
  try {
    await inngest.send(events.shortsRenderRequested.create({ projectId: short.projectId, shortId }))
  } catch (error) {
    console.error('[point studio] could not request the render', error)
    await settlePointWork(db, shortId, null)
    return {
      ok: false,
      error: 'The cut is saved, but Inngest could not be reached to start the render.',
    }
  }
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * Build this Short again from the long form's newer script (design 3.5):
 * nothing is rebuilt or re-bought without this click. The row's script,
 * voice, plan, pool and compiled master are cleared, so it becomes a draft
 * and the build does not reuse the old script, then the build is requested.
 * A draft is hidden from the Shorts screen, so the card is gone until the
 * rebuild assembles; the studio says so before the owner confirms. If Inngest
 * cannot be reached the records are put back.
 */
export async function rebuildPointFromScript(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const loaded = await loadPoint(shortId)
  if ('error' in loaded) return { ok: false, error: loaded.error }
  const { short } = loaded
  const script = PointScriptRecordSchema.safeParse(short.pointScript)
  const pointId = short.pointId
  if (!script.success || !pointId) {
    return { ok: false, error: 'This Short has no script of its own to rebuild from.' }
  }
  const sources = await latestScriptParagraphSources(db, short.projectId)
  if (sources.scriptVersion <= script.data.scriptVersion) {
    return {
      ok: false,
      error: 'This Short was written from the current script. There is nothing to rebuild.',
    }
  }
  if (await renderStillMoving(short)) {
    return { ok: false, error: 'This Short is rendering. Rebuild it once the render has finished.' }
  }

  const claim = await win(shortId, 'rebuild')
  if (!claim.ok) return claim

  await updateShort(db, shortId, {
    pointScript: null,
    pointVoice: null,
    pointPlan: null,
    pointFetches: null,
    sourceTimeline: null,
    renderId: null,
  })
  try {
    await inngest.send(
      events.shortsPointBuildRequested.create({ projectId: short.projectId, pointId }),
    )
  } catch (error) {
    console.error('[point studio] could not request the rebuild', error)
    // Nothing is coming, and a draft is hidden: put the Short back as it was.
    await updateShort(db, shortId, {
      pointScript: PointScriptRecordSchema.parse(short.pointScript),
      pointVoice: PointVoiceRecordSchema.safeParse(short.pointVoice).data ?? null,
      pointPlan: PointPlanRecordSchema.safeParse(short.pointPlan).data ?? null,
      pointFetches: PointFetchesRecordSchema.safeParse(short.pointFetches).data ?? null,
      sourceTimeline: short.sourceTimeline as Record<string, unknown> | null,
      renderId: short.renderId,
    })
    return {
      ok: false,
      error: 'Could not reach Inngest to start the rebuild. Nothing was changed.',
    }
  }
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}
