'use server'

import { getRender, getShort, latestTimeline, updateShort } from '@boom-busters/db'
import {
  teaserTextHash,
  TeaserFetchesRecordSchema,
  TeaserScriptRecordSchema,
  TeaserShotsRecordSchema,
  TeaserVoiceRecordSchema,
  TimelineSchema,
  TimelineSlotSchema,
  UlidSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  TeaserFetchesRecord,
  TeaserFetchState,
  TeaserShotsRecord,
} from '@boom-busters/schemas'
import { compileTeaserMaster, TEASER_CHAPTER_ID } from '@boom-busters/timeline'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { db } from '@/lib/db'
import { inngest } from '@/inngest/client'
import { events } from '@/inngest/events'

/**
 * The Shorts screen's actions (build spec section 11.3): edit a card's
 * metadata, toggle its ending, tick the related-link checklist, and ask for
 * a (re-)render. Scheduling is NOT here — that is the Publish screen (M7.7).
 * The related-link chip is bookkeeping, not a scheduling precondition
 * (decision 226): the Publish screen also calls `setShortRelatedLink` from
 * its post-upload reminder.
 */

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * How long a beat's `fetching` state refuses a second request (decision 234).
 * Long enough to outlive the runner's retries on a slow provider; short
 * enough that a runner that vanished without writing its failure cannot lock
 * the beat for good.
 */
const TEASER_FETCH_COOLDOWN_MS = 10 * 60 * 1000

async function requireOwner(): Promise<void> {
  const session = await auth()
  if (!session?.user?.email) throw new Error('Not signed in')
}

async function loadShort(shortId: string) {
  if (!UlidSchema.safeParse(shortId).success) return undefined
  return getShort(db, shortId)
}

/**
 * Whether the card's current render is still moving (decision 234). The
 * runner points `renderId` at its row the moment one is queued, so this is
 * the truth a re-render or re-assemble must check before spending again;
 * the runner's singleton covers the seconds before that pointer lands.
 */
async function renderStillMoving(short: { renderId: string | null }): Promise<boolean> {
  if (!short.renderId) return false
  const render = await getRender(db, short.renderId)
  if (!render) return false
  return ['queued', 'invoking', 'rendering', 'qc'].includes(render.status)
}

export async function updateShortDetails(
  shortId: string,
  details: { title: string; description: string },
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  const title = details.title.trim()
  if (title === '') return { ok: false, error: 'A Short needs a title.' }
  if (title.length > 100) {
    // YouTube truncates at 100 characters; storing more would publish less.
    return { ok: false, error: 'YouTube titles are limited to 100 characters.' }
  }

  await updateShort(db, shortId, { title, description: details.description.trim() })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * The ending is part of what gets rendered, so changing it makes the last
 * render a render of something else: the card's pointer is nulled and the
 * card offers "Render" again. The old render row keeps existing — the money
 * it cost is still real.
 */
export async function setShortEnding(
  shortId: string,
  ending: 'loop' | 'cta',
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.ending === ending) return { ok: true }

  await updateShort(db, shortId, { ending, renderId: null })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

export async function setShortRelatedLink(
  shortId: string,
  checked: boolean,
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  await updateShort(db, shortId, { relatedLinkChecked: checked })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * The teaser studio's script save (decisions 227, 230). Edits are stored on
 * the row and the render pointer is nulled — the last render is a render of
 * the old words, the same rule the ending toggle lives by. Nothing is
 * re-voiced here: Voice the script spends, a Save never does.
 */
export async function saveTeaserScript(
  shortId: string,
  paragraphs: { text: string; chapterIndex: number }[],
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') {
    return { ok: false, error: 'Only a teaser has an editable script.' }
  }

  const stored = TeaserScriptRecordSchema.safeParse(short.teaserScript)
  const record = TeaserScriptRecordSchema.safeParse({
    title: stored.success ? stored.data.title : short.title.slice(0, 90),
    paragraphs,
    scriptVersion: stored.success ? stored.data.scriptVersion : 1,
  })
  if (!record.success) {
    return {
      ok: false,
      error:
        'That script does not fit a teaser — 2 to 5 beats, each 10 to 400 characters, read aloud.',
    }
  }

  await updateShort(db, shortId, {
    teaserScript: record.data as unknown as Record<string, unknown>,
    renderId: null,
  })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/** Ask the voice runner to synthesise the stored script's beats (decision 230). */
export async function rebuildTeaser(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') {
    return { ok: false, error: 'Only a teaser can be voiced here — excerpts slice the master.' }
  }

  try {
    await inngest.send(
      events.teaserRebuildRequested.create({ projectId: short.projectId, shortId }),
    )
  } catch (error) {
    console.error('[teaser] could not request the voicing', error)
    return { ok: false, error: 'Could not reach Inngest to start the voicing.' }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * Choose (or clear) one beat's shot (decision 230). A full slot snapshot is
 * stored, never an index — a re-assembled master reorders its slots, and an
 * index would silently point the choice at other footage. Free: choices take
 * effect at Assemble & render.
 */
export async function saveTeaserShot(
  shortId: string,
  beatIndex: number,
  slot: unknown | null,
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') return { ok: false, error: 'Only a teaser has a shot picker.' }
  if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex > 4) {
    return { ok: false, error: 'Unknown beat.' }
  }

  const chosen = slot === null ? null : TimelineSlotSchema.safeParse(slot)
  if (chosen !== null && !chosen.success) {
    return { ok: false, error: 'That is not a slot this master ever resolved.' }
  }

  const stored = TeaserShotsRecordSchema.safeParse(short.teaserShots)
  const choices = stored.success ? [...stored.data.choices] : []
  while (choices.length <= beatIndex) choices.push(null)
  choices[beatIndex] = chosen === null ? null : chosen.data

  const record: TeaserShotsRecord = { choices }
  await updateShort(db, shortId, {
    teaserShots: record as unknown as Record<string, unknown>,
  })
  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * The studio's final act (decision 230): compile the mini master from the
 * stored voice and shot choices — free and synchronous, no vendor touched —
 * then queue the render. Refuses in words when the voice is missing or has
 * fallen behind the script, because assembling stale audio would bake the
 * old words into a new cut.
 */
export async function assembleTeaser(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') return { ok: false, error: 'Only a teaser assembles here.' }

  // Re-assembling while the current cut renders would null the pointer the
  // card is tracking and queue a second spend (decision 234).
  if (await renderStillMoving(short)) {
    return { ok: false, error: 'This teaser is already rendering. The card updates as it moves.' }
  }

  const script = TeaserScriptRecordSchema.safeParse(short.teaserScript)
  if (!script.success) {
    return {
      ok: false,
      error: 'This teaser has no stored script yet — Voice the script first; it writes one.',
    }
  }
  const voice = TeaserVoiceRecordSchema.safeParse(short.teaserVoice)
  if (!voice.success) {
    return { ok: false, error: 'The beats are not voiced yet — Voice the script first.' }
  }
  const current = script.data.paragraphs.map((paragraph) => teaserTextHash(paragraph.text))
  const voicedHashes = voice.data.beats.map((beat) => beat.textHash)
  if (
    current.length !== voicedHashes.length ||
    current.some((hash, index) => hash !== voicedHashes[index])
  ) {
    return {
      ok: false,
      error: 'The script has changed since it was voiced — Voice the script again first.',
    }
  }

  const timelineRow = await latestTimeline(db, short.projectId)
  if (!timelineRow) {
    return { ok: false, error: 'There is no master timeline to lift visuals from.' }
  }

  const shots = TeaserShotsRecordSchema.safeParse(short.teaserShots)
  const paragraphs: TeaserParagraphAudio[] = script.data.paragraphs.map((paragraph, index) => ({
    text: paragraph.text,
    chapterIndex: paragraph.chapterIndex,
    r2Key: voice.data.beats[index]!.r2Key,
    durationMs: voice.data.beats[index]!.durationMs,
    wordTimings: voice.data.beats[index]!.wordTimings,
  }))

  try {
    const teaserTimeline = compileTeaserMaster({
      master: TimelineSchema.parse(timelineRow.json),
      paragraphs,
      ...(shots.success ? { chosen: shots.data.choices } : {}),
    })
    await updateShort(db, shortId, {
      sourceTimeline: teaserTimeline as unknown as Record<string, unknown>,
      segmentRef: {
        chapterId: TEASER_CHAPTER_ID,
        fromParagraph: 0,
        toParagraph: paragraphs.length - 1,
      },
      // The old render is a render of the old cut.
      renderId: null,
    })
  } catch (error) {
    if (error instanceof ValidationError) {
      return { ok: false, error: `The teaser could not be assembled: ${error.message}` }
    }
    throw error
  }

  try {
    await inngest.send(events.shortsRenderRequested.create({ projectId: short.projectId, shortId }))
  } catch (error) {
    console.error('[teaser] could not request the render', error)
    return {
      ok: false,
      error: 'The cut is saved, but Inngest could not be reached to start the render.',
    }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/**
 * Ask for one beat's new material or a fetched pick (decision 231): mark the
 * beat as fetching so the studio shows words immediately, then hand the op to
 * the teaser-shot-fetcher. Stock searches and ingests are free; a still
 * generation spends inside the runner's cost guard, and the UI's confirm
 * carries the estimate.
 */
async function requestTeaserFetch(
  shortId: string,
  beatIndex: number,
  op:
    | { op: 'stock'; query: string }
    | { op: 'still'; prompt: string }
    | { op: 'ingest'; candidateId: string },
): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }
  if (short.kind !== 'teaser') return { ok: false, error: 'Only a teaser fetches new shots.' }

  const script = TeaserScriptRecordSchema.safeParse(short.teaserScript)
  if (!script.success || script.data.paragraphs[beatIndex] === undefined) {
    return { ok: false, error: 'There is no such beat. Save the script first.' }
  }

  // The state is written BEFORE the event: the studio must show "fetching"
  // words on the very next render, not whenever the runner gets scheduled.
  const parsed = TeaserFetchesRecordSchema.safeParse(short.teaserFetches)
  const beats = parsed.success ? [...parsed.data.beats] : []
  while (beats.length <= beatIndex) beats.push(null)
  const stored = beats[beatIndex] ?? { state: null, candidates: [] }

  // One request per beat at a time (decision 234). A beat already fetching
  // refuses a second ask rather than double-spending or double-writing; the
  // cooldown is the escape hatch for a runner that died without a trace,
  // since a record with no timestamp predates the guard and may retry.
  if (stored.state?.state === 'fetching') {
    const startedAt = stored.state.startedAt ? Date.parse(stored.state.startedAt) : Number.NaN
    if (Number.isFinite(startedAt) && Date.now() - startedAt < TEASER_FETCH_COOLDOWN_MS) {
      return {
        ok: false,
        error: `Beat ${beatIndex + 1} is already fetching. Its results land in a moment.`,
      }
    }
  }

  const state: TeaserFetchState = {
    state: 'fetching',
    what: op.op,
    startedAt: new Date().toISOString(),
  }
  beats[beatIndex] = { ...stored, state }
  const record: TeaserFetchesRecord = { beats }
  await updateShort(db, shortId, {
    teaserFetches: record as unknown as Record<string, unknown>,
  })

  try {
    await inngest.send(
      events.teaserShotsRequested.create({
        projectId: short.projectId,
        shortId,
        beatIndex,
        ...op,
      }),
    )
  } catch (error) {
    console.error('[teaser] could not request the shot fetch', error)
    // Undo the optimistic state: nothing is coming.
    beats[beatIndex] = { ...stored, state: stored.state }
    await updateShort(db, shortId, {
      teaserFetches: { beats } as unknown as Record<string, unknown>,
    })
    return { ok: false, error: 'Could not reach Inngest to start the fetch.' }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}

/** Search the stock providers for one beat: free, and results replace the last search. */
export async function fetchTeaserShotOptions(
  shortId: string,
  beatIndex: number,
  query: string,
): Promise<ActionResult> {
  const trimmed = query.trim()
  if (trimmed.length < 2 || trimmed.length > 200) {
    return { ok: false, error: 'A search needs 2 to 200 characters.' }
  }
  if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex > 4) {
    return { ok: false, error: 'Unknown beat.' }
  }
  return requestTeaserFetch(shortId, beatIndex, { op: 'stock', query: trimmed })
}

/** Generate a still for one beat: paid; the runner's cost guard holds the ceiling. */
export async function generateTeaserStill(
  shortId: string,
  beatIndex: number,
  prompt: string,
): Promise<ActionResult> {
  const trimmed = prompt.trim()
  if (trimmed.length < 4 || trimmed.length > 2000) {
    return { ok: false, error: 'A generation prompt needs 4 to 2000 characters.' }
  }
  if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex > 4) {
    return { ok: false, error: 'Unknown beat.' }
  }
  return requestTeaserFetch(shortId, beatIndex, { op: 'still', prompt: trimmed })
}

/**
 * Pick a fetched stock option whose bytes are not ours yet: the runner
 * ingests them into R2 and stores the slot as the beat's choice. Fetched
 * options that already hold bytes (generated stills, mock mode, re-picks)
 * never come here; the studio saves their pre-built slot via
 * `saveTeaserShot` instead.
 */
export async function pickFetchedTeaserShot(
  shortId: string,
  beatIndex: number,
  candidateId: string,
): Promise<ActionResult> {
  if (candidateId.trim() === '') return { ok: false, error: 'Unknown option.' }
  if (!Number.isInteger(beatIndex) || beatIndex < 0 || beatIndex > 4) {
    return { ok: false, error: 'Unknown beat.' }
  }
  return requestTeaserFetch(shortId, beatIndex, { op: 'ingest', candidateId })
}

export async function requestShortRender(shortId: string): Promise<ActionResult> {
  await requireOwner()
  const short = await loadShort(shortId)
  if (!short) return { ok: false, error: 'Unknown Short' }

  if (await renderStillMoving(short)) {
    return { ok: false, error: 'This Short is already rendering. The card updates as it moves.' }
  }

  try {
    await inngest.send(events.shortsRenderRequested.create({ projectId: short.projectId, shortId }))
  } catch (error) {
    console.error('[shorts] could not request a render', error)
    return { ok: false, error: 'Could not reach Inngest to start the render.' }
  }

  revalidatePath(`/projects/${short.projectId}`)
  return { ok: true }
}
