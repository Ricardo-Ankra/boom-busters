import {
  channelForProject,
  getLatestScript,
  getProject,
  insertShort,
  MOCK_KEY_PREFIX,
  shortForPoint,
  updateShort,
} from '@boom-busters/db'
import { mockPointPlan, mockPointScript, mockProvidersEnabled } from '@boom-busters/providers'
import type { PlanLibraryEntry, Repair } from '@boom-busters/providers'
import {
  BudgetExceededError,
  PointFetchesRecordSchema,
  PointPlanRecordSchema,
  PointScriptRecordSchema,
  PointVoiceRecordSchema,
  serialiseError,
  splitParagraphs,
  stripNarrationMarkup,
  teaserTextHash,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  PointFetchesRecord,
  PointPending,
  PointPlanRecord,
  PointPlanShot,
  PointScript,
  PointScriptRecord,
  PointVoiceRecord,
  SlotCandidate,
  TalkingPoint,
  Timeline,
  TimelineSlot,
} from '@boom-busters/schemas'
import {
  checkShortRules,
  compileShortMaster,
  layoutPointNarration,
  masterChapterIds,
  POINT_CHAPTER_ID,
} from '@boom-busters/timeline'
import type { PointParagraphAudio, ResolvedPointShot, RuleFinding } from '@boom-busters/timeline'
import { NonRetriableError } from 'inngest'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { planPointShotsWith, writePointScriptWith } from '@/lib/point-answers'
import { putObject, takeStorage } from '@/lib/storage'
import { ingestCandidateBytes } from '@/lib/stock-ingest'
import { slotFromTeaserCandidate } from '@/lib/teaser-fetch'
import { synthesise } from '@/lib/tts'
import {
  fetchStockCandidates,
  generateStillCandidates,
  requireVisualKeys,
} from '@/lib/visual-assets'
import { budgetGateData } from './gates'
import type { TeaserVoiceResult } from './teaser-build'

/**
 * A point Short's build steps (playbook Shorts design 3.4), shared by the
 * point-short-runner (which builds one per approved talking point) and the
 * Short studio's runner (which redoes a voice or a plan). One implementation,
 * so the two can never disagree about an idempotency key or an audio key:
 * that agreement is what makes a re-voice re-serve unchanged paragraphs for
 * free, the rule `teaser-build.ts` keeps for the teaser.
 *
 * Every function here is meant to run inside one Inngest step. Nothing a later
 * step relies on is read outside a step, and nothing is compared to a stored
 * row by `JSON.stringify` (step data comes back with its keys sorted).
 */

/** The bridge's arrow label (design 4.6). */
export const BRIDGE_LABEL = 'Full video'

/** How many stock results a fetched shot's pool keeps, as the teaser's strip does. */
const STOCK_KEPT = 12

/** The record caps `PointFetchesRecordSchema` holds. */
const FETCH_POOL_MAX = 60

// ---------------------------------------------------------------------------
// The long form's numbered library (design 5.1)
// ---------------------------------------------------------------------------

const BRIEF_MAX = 160

function clip(text: string, max = BRIEF_MAX): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/** What a slot shows, in a line. Slots carry no brief, so this reads the payload. */
function describePayload(slot: TimelineSlot): string {
  const payload = slot.payload
  switch (payload.kind) {
    case 'headline':
      return clip(`${payload.outlet}: "${payload.headline}"`)
    case 'social':
      return clip(`${payload.authorName} (@${payload.handle}): ${payload.text}`)
    case 'chart':
      return clip(`${payload.chartKind} chart. ${payload.takeaway}`)
    case 'map':
      return `map of ${payload.locations.length} place${payload.locations.length === 1 ? '' : 's'}`
    case 'graphic':
      return 'a composed graphic'
    case 'graphic-code':
      return clip(payload.title || 'a composed graphic')
    case 'video':
      return `${slot.type} footage`
    case 'image':
      return `${slot.type} image`
  }
}

/**
 * The master's slots as a numbered library for one plan call. `entries[i].ref`
 * is `i` and `slots[i]` is the full snapshot, so a planned
 * `{ kind: 'library', ref }` is `slots[ref]` and nothing else: the number is
 * valid for the one master this was built from (design 5.1).
 */
export function planLibrary(
  master: Timeline,
  script: { chapters: readonly { index: number; contentMd: string }[] },
): { entries: PlanLibraryEntry[]; slots: TimelineSlot[] } {
  const chapterIds = masterChapterIds(master)
  const segments = [...master.narration].sort((a, b) => a.startMs - b.startMs)
  const slots = [...master.slots]

  const entries = slots.map((slot, ref): PlanLibraryEntry => {
    const segment =
      [...segments].reverse().find((candidate) => candidate.startMs <= slot.startMs) ?? segments[0]
    const chapterIndex = segment ? Math.max(0, chapterIds.indexOf(segment.chapterId)) : 0

    // The sentence it covered: the narration paragraph under the slot's start,
    // else the words the captions have there.
    const chapter = script.chapters.find((candidate) => candidate.index === chapterIndex)
    const paragraph =
      segment && chapter ? splitParagraphs(chapter.contentMd)[segment.paragraphIndex] : undefined
    const spoken = master.captions.words
      .filter(
        (word) => word.startMs >= slot.startMs && word.startMs < slot.startMs + slot.durationMs,
      )
      .map((word) => word.text)
      .join(' ')
    const covered = paragraph ? stripNarrationMarkup(paragraph) : spoken

    return {
      ref,
      type: slot.type,
      payloadKind: slot.payload.kind,
      covered: clip(covered),
      brief: describePayload(slot),
      chapterIndex,
    }
  })
  return { entries, slots }
}

// ---------------------------------------------------------------------------
// Script
// ---------------------------------------------------------------------------

export type PointWriteResult =
  | { ok: true; script: PointScript; scriptVersion: number; repairs: Repair[] }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

/**
 * Write one point's script on the answer helper (decision 293): at most two
 * calls, the second told what was wrong. Two refused answers skip the Short
 * with the reason; the budget keeps its gate; a provider outage is thrown so
 * Inngest retries the step instead of skipping a Short a passing outage cost.
 * The notices are the caller's, written once the row exists.
 */
export async function writePointScript(
  projectId: string,
  point: TalkingPoint,
): Promise<PointWriteResult> {
  const latest = await getLatestScript(db, projectId)
  if (!latest) return { ok: false, skipped: 'there is no script to write a Short from' }
  const chapters = latest.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    contentMd: chapter.contentMd,
  }))

  if (mockProvidersEnabled()) {
    return {
      ok: true,
      script: mockPointScript(point),
      scriptVersion: latest.script.version,
      repairs: [],
    }
  }

  try {
    const project = await getProject(db, projectId)
    const bible = await channelForProject(db, projectId)
    const written = await writePointScriptWith(
      completeForProject(projectId),
      {
        bible,
        caseTitle: project?.title ?? '',
        point,
        chapters,
        ctaLine: bible.bible.ctaLine || null,
      },
      chapters.length,
    )
    return {
      ok: true,
      script: written.script,
      scriptVersion: latest.script.version,
      repairs: written.repairs,
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    // A stopped answer (two refusals, a rejected key) is a skip, not a retry.
    if (error instanceof NonRetriableError) {
      return { ok: false, skipped: `its script could not be written: ${error.message}` }
    }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/**
 * The paragraph's synthesis identity: same project, Short, version, position
 * and TEXT re-serves the earlier purchase (the text rides as a hash, not a
 * length, as the teaser's does).
 */
export function pointParagraphIdempotencyKey(
  projectId: string,
  shortKey: string,
  scriptVersion: number,
  index: number,
  text: string,
): string {
  return `point:${projectId}:${shortKey}:${scriptVersion}:${index}:${teaserTextHash(text)}`
}

/** Synthesise one paragraph and store its audio; budget-gated like all TTS. */
export async function voicePointParagraph(input: {
  projectId: string
  shortKey: string
  scriptVersion: number
  index: number
  text: string
}): Promise<TeaserVoiceResult> {
  const { projectId, shortKey, scriptVersion, index, text } = input
  try {
    const { settings } = await channelForProject(db, projectId)
    const narration = await synthesise(
      {
        text,
        idempotencyKey: pointParagraphIdempotencyKey(
          projectId,
          shortKey,
          scriptVersion,
          index,
          text,
        ),
        projectId,
      },
      settings,
    )
    const r2Key =
      takeStorage() === 'r2'
        ? (
            await putObject(
              `boom-busters/voice/${projectId}/point/${shortKey}/v${scriptVersion}-${index}.wav`,
              narration.wav,
              'audio/wav',
            )
          ).key
        : `${MOCK_KEY_PREFIX}voice/point-${projectId}-${shortKey}-${index}.wav`
    return {
      ok: true,
      r2Key,
      durationMs: narration.durationMs,
      wordTimings: narration.wordTimings ?? null,
    }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { ok: false, gate: budgetGateData(error) }
    }
    return {
      ok: false,
      skipped: `paragraph ${index + 1} could not be synthesised: ${String(serialiseError(error).message ?? 'unknown')}`,
    }
  }
}

/** A digest of what was voiced, so a plan can say which voice it was made for. */
export function pointVoiceHash(voice: PointVoiceRecord): string {
  return teaserTextHash(
    [
      voice.scriptVersion,
      ...voice.paragraphs.map((p) => `${p.textHash}:${p.durationMs}:${p.r2Key}`),
    ].join('|'),
  )
}

/**
 * The script's paragraphs joined to their voiced audio. A voice that is not
 * the script's (a different count, or a paragraph whose text was edited since
 * it was voiced) cannot be cut, and says so rather than cutting the wrong words.
 */
export function pointParagraphAudio(
  script: PointScript,
  voice: PointVoiceRecord,
): PointParagraphAudio[] {
  if (voice.paragraphs.length !== script.paragraphs.length) {
    throw new ValidationError(
      `the voice has ${voice.paragraphs.length} paragraphs but the script has ${script.paragraphs.length}`,
      { field: 'voice' },
    )
  }
  return script.paragraphs.map((paragraph, index) => {
    const voiced = voice.paragraphs[index]!
    if (voiced.textHash !== teaserTextHash(paragraph.text)) {
      throw new ValidationError(
        `paragraph ${index + 1} was edited after it was voiced; voice it again`,
        { field: 'voice' },
      )
    }
    return {
      text: paragraph.text,
      phase: paragraph.phase,
      r2Key: voiced.r2Key,
      durationMs: voiced.durationMs,
      wordTimings: voiced.wordTimings,
    }
  })
}

// ---------------------------------------------------------------------------
// Shot plan
// ---------------------------------------------------------------------------

export type PointPlanResult =
  | { ok: true; plan: PointPlanRecord; repairs: Repair[] }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

/**
 * Plan the shots over the voiced words and the master's numbered library.
 * Reuses are stored as full slot snapshots (design 5.1), so a re-assembled
 * master can never shift a Short's pictures. `sourceChapters` is the point's,
 * the chapters the planner is told to prefer.
 */
export async function planPointShots(
  projectId: string,
  input: {
    script: PointScript
    voice: PointVoiceRecord
    master: Timeline
    sourceChapters: readonly number[]
    note: string | null
  },
): Promise<PointPlanResult> {
  const audio = pointParagraphAudio(input.script, input.voice)
  const words = layoutPointNarration(audio).words.map((word, index) => ({
    index,
    text: word.text,
    startMs: word.startMs,
  }))
  const latest = await getLatestScript(db, projectId)
  const library = planLibrary(input.master, { chapters: latest?.chapters ?? [] })

  let planned
  let repairs: Repair[] = []
  if (mockProvidersEnabled()) {
    planned = mockPointPlan(words, library.entries)
  } else {
    try {
      const answered = await planPointShotsWith(completeForProject(projectId), {
        bible: await channelForProject(db, projectId),
        script: input.script,
        words,
        library: library.entries,
        sourceChapters: input.sourceChapters,
        note: input.note,
      })
      planned = answered.shots
      repairs = answered.repairs
    } catch (error) {
      if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
      if (error instanceof NonRetriableError) {
        return { ok: false, skipped: `its shots could not be planned: ${error.message}` }
      }
      throw error
    }
  }

  const shots: PointPlanShot[] = planned.map((shot) => ({
    startWord: shot.startWord,
    crop: shot.crop,
    motion: shot.motion,
    slot: shot.source.kind === 'library' ? library.slots[shot.source.ref]! : null,
    pending:
      shot.source.kind === 'stock'
        ? { kind: 'stock', query: shot.source.query }
        : shot.source.kind === 'still'
          ? { kind: 'still', prompt: shot.source.prompt }
          : null,
  }))
  return {
    ok: true,
    plan: {
      shots,
      plannedFor: {
        scriptVersion: input.voice.scriptVersion,
        voiceHash: pointVoiceHash(input.voice),
      },
    },
    repairs,
  }
}

// ---------------------------------------------------------------------------
// New pictures (design 5.2)
// ---------------------------------------------------------------------------

export type PendingOutcome =
  | { ok: true; slot: TimelineSlot; candidates: SlotCandidate[] }
  | { ok: false; reason: string }
  | { ok: false; gate: Record<string, unknown> }

/** The still model follows the opening words: make sure they name the 9:16 frame. */
export function framedPrompt(prompt: string): string {
  return /^\s*vertical\b/i.test(prompt) ? prompt : `Vertical 9:16 frame: ${prompt}`
}

/**
 * Fetch one new picture. Stock takes the first result and ingests its bytes;
 * a still is generated through the same cost-guarded path as a board still,
 * framed 9:16. A refusal the provider or the keys cause comes back as words
 * (the shot before simply runs on); the budget keeps its gate; anything else
 * is thrown for Inngest to retry.
 */
export async function fetchPendingShot(
  projectId: string,
  pending: PointPending,
): Promise<PendingOutcome> {
  const mocked = mockProvidersEnabled()
  try {
    let pool: SlotCandidate[]
    if (pending.kind === 'stock') {
      await requireVisualKeys(new Set(['stock']))
      const found = await fetchStockCandidates({
        type: 'stock',
        coversText: pending.query,
        description: pending.query,
        query: pending.query,
        rejectionCriteria: [],
        motion: { kind: 'static' },
        transition: 'cut',
      })
      pool = found.slice(0, STOCK_KEPT)
    } else {
      const prompt = framedPrompt(pending.prompt)
      pool = await generateStillCandidates(
        {
          type: 'still',
          coversText: prompt,
          description: prompt,
          prompt,
          motion: { kind: 'static' },
          transition: 'cut',
        },
        projectId,
        null,
        'short',
      )
    }

    const first = pool[0]
    if (!first) return { ok: false, reason: 'nothing came back for it' }
    const settled = mocked
      ? { ok: true as const, candidate: first }
      : await ingestCandidateBytes(first)
    if (!settled.ok) return { ok: false, reason: settled.reason }
    const slot = slotFromTeaserCandidate(settled.candidate, { mocked })
    if (!slot) return { ok: false, reason: 'the picture could not become a timeline shot' }
    return { ok: true, slot, candidates: [settled.candidate, ...pool.slice(1)] }
  } catch (error) {
    if (error instanceof BudgetExceededError) return { ok: false, gate: budgetGateData(error) }
    if (error instanceof ValidationError) return { ok: false, reason: error.message }
    throw error
  }
}

export type PointFetchResult =
  | {
      ok: true
      plan: PointPlanRecord
      fetches: PointFetchesRecord
      /** How many new pictures the Short now holds, for the rule book's cap. */
      fetched: number
      /** One `dropped` repair per shot a failed fetch removed. */
      repairs: Repair[]
    }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

type RunFetch = (name: string, fn: () => Promise<PendingOutcome>) => Promise<PendingOutcome>

/**
 * Settle every pending shot of a plan. A failed fetch drops its shot, so the
 * shot before it runs on (the plan stays valid and the card says so through
 * the repairs); a first shot that fails hands word 0 to the next. `run` lets
 * the runner make each fetch its own Inngest step, so a retry after the third
 * paid still never buys the first two again; it defaults to calling directly.
 */
export async function fetchPendingShots(
  projectId: string,
  plan: PointPlanRecord,
  run: RunFetch = (_name, fn) => fn(),
): Promise<PointFetchResult> {
  const shots: PointPlanShot[] = []
  const candidates: SlotCandidate[] = []
  const repairs: Repair[] = []
  let fetched = 0

  for (const [index, shot] of plan.shots.entries()) {
    if (shot.pending === null) {
      shots.push(shot)
      continue
    }
    const pending = shot.pending
    const outcome = await run(`fetch-new-${index}`, () => fetchPendingShot(projectId, pending))
    if ('gate' in outcome) return { ok: false, gate: outcome.gate }
    if (!outcome.ok) {
      repairs.push({
        action: 'dropped',
        field: `shot ${index + 1}`,
        reason: `a new ${pending.kind} could not be fetched: ${outcome.reason}`,
      })
      continue
    }
    shots.push({ ...shot, slot: outcome.slot, pending: null })
    candidates.push(...outcome.candidates)
    fetched++
  }

  if (shots.length === 0) {
    return { ok: false, skipped: 'none of its new pictures could be fetched and it has no others' }
  }
  // Word 0 always opens the Short, whichever shot ended up first.
  shots[0] = { ...shots[0]!, startWord: 0 }

  return {
    ok: true,
    plan: { ...plan, shots },
    fetches: { candidates: candidates.slice(-FETCH_POOL_MAX), state: null },
    fetched,
    repairs,
  }
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

/**
 * The Short's own master and what the rule book says of it. Free and
 * synchronous: it touches no provider. A plan that still holds a pending shot
 * is not assemblable, and says so.
 */
export function assemblePointShort(input: {
  master: Timeline
  script: PointScript
  voice: PointVoiceRecord
  plan: PointPlanRecord
  bridge: { label: string; channelName: string; handle: string }
  newImageCount: number
}): { timeline: Timeline; findings: RuleFinding[] } {
  const paragraphs = pointParagraphAudio(input.script, input.voice)
  const shots = input.plan.shots.map((shot, index): ResolvedPointShot => {
    if (shot.slot === null) {
      throw new ValidationError(`shot ${index + 1} still waits for its new picture`, {
        field: `plan.shots.${index}`,
      })
    }
    return { startWord: shot.startWord, slot: shot.slot, crop: shot.crop, motion: shot.motion }
  })
  const timeline = compileShortMaster({
    master: input.master,
    paragraphs,
    shots,
    bridge: input.bridge,
  })
  const findings = checkShortRules({
    timeline,
    paragraphs,
    newImageCount: input.newImageCount,
  })
  return { timeline, findings }
}

/**
 * Store a built Short on its row: inserted when the point has none, otherwise
 * its script, voice, plan, pool and compiled master are replaced. The row's
 * title and the owner's other edits are never touched on an update.
 */
export async function savePointShort(input: {
  projectId: string
  pointId: string
  script: PointScriptRecord
  voice: PointVoiceRecord
  plan: PointPlanRecord
  fetches: PointFetchesRecord
  timeline: Timeline
}): Promise<{ shortId: string; created: boolean }> {
  const sourceTimeline = input.timeline as unknown as Record<string, unknown>
  const existing = await shortForPoint(db, input.projectId, input.pointId)
  if (existing) {
    await updateShort(db, existing.id, {
      sourceTimeline,
      pointScript: input.script,
      pointVoice: input.voice,
      pointPlan: input.plan,
      pointFetches: input.fetches,
    })
    return { shortId: existing.id, created: false }
  }
  const row = await insertShort(db, {
    projectId: input.projectId,
    title: input.script.title,
    segmentRef: {
      chapterId: POINT_CHAPTER_ID,
      fromParagraph: 0,
      toParagraph: input.script.paragraphs.length - 1,
    },
    kind: 'point',
    sourceTimeline,
    pointId: input.pointId,
    pointScript: input.script,
    pointVoice: input.voice,
    pointPlan: input.plan,
    pointFetches: input.fetches,
  })
  return { shortId: row.id, created: true }
}

// ---------------------------------------------------------------------------
// Progress and resuming
// ---------------------------------------------------------------------------

/**
 * Every paid call lands on the point's row as it finishes (the row is a draft,
 * not a Short, until its master is compiled: `isAssembledShort`), so a second
 * run for the same point (a budget Re-run, an exhausted retry, a re-sent event)
 * reuses what was bought instead of buying it again. The script call has no
 * idempotency key of its own, and new text would change every paragraph's key.
 */
export async function savePointProgress(input: {
  projectId: string
  pointId: string
  script?: PointScriptRecord
  voice?: PointVoiceRecord
  plan?: PointPlanRecord
  fetches?: PointFetchesRecord
}): Promise<void> {
  const { projectId, pointId, ...records } = input
  const existing = await shortForPoint(db, projectId, pointId)
  const patch = {
    ...(records.script ? { pointScript: records.script } : {}),
    ...(records.voice ? { pointVoice: records.voice } : {}),
    ...(records.plan ? { pointPlan: records.plan } : {}),
    ...(records.fetches ? { pointFetches: records.fetches } : {}),
  }
  if (existing) {
    await updateShort(db, existing.id, patch)
    return
  }
  if (!records.script) return
  await insertShort(db, {
    projectId,
    title: records.script.title,
    segmentRef: {
      chapterId: POINT_CHAPTER_ID,
      fromParagraph: 0,
      toParagraph: records.script.paragraphs.length - 1,
    },
    kind: 'point',
    pointId,
    ...patch,
  })
}

/** The point's stored records, each undefined when absent or not parseable. */
async function storedRecords(projectId: string, pointId: string) {
  const row = await shortForPoint(db, projectId, pointId)
  const script = PointScriptRecordSchema.safeParse(row?.pointScript)
  const voice = PointVoiceRecordSchema.safeParse(row?.pointVoice)
  const plan = PointPlanRecordSchema.safeParse(row?.pointPlan)
  const fetches = PointFetchesRecordSchema.safeParse(row?.pointFetches)
  return {
    script: script.success && script.data.pointId === pointId ? script.data : undefined,
    voice: voice.success ? voice.data : undefined,
    plan: plan.success ? plan.data : undefined,
    fetches: fetches.success ? fetches.data : undefined,
  }
}

/** The stored script when there is one (no model call), otherwise write and store it. */
export async function writeOrReusePointScript(
  projectId: string,
  point: TalkingPoint,
): Promise<PointWriteResult> {
  const stored = (await storedRecords(projectId, point.id)).script
  if (stored) {
    return {
      ok: true,
      script: { title: stored.title, paragraphs: stored.paragraphs },
      scriptVersion: stored.scriptVersion,
      repairs: [],
    }
  }
  const written = await writePointScript(projectId, point)
  if (written.ok) {
    await savePointProgress({
      projectId,
      pointId: point.id,
      script: PointScriptRecordSchema.parse({
        ...written.script,
        scriptVersion: written.scriptVersion,
        pointId: point.id,
      }),
    })
  }
  return written
}

/**
 * One paragraph's audio: the stored paragraph when its version and text are
 * unchanged (no synthesis call at all), otherwise voiced and stored. Voicing
 * is sequential, so the stored voice is always a prefix of the script's.
 */
export async function voiceOrReusePointParagraph(input: {
  projectId: string
  pointId: string
  scriptVersion: number
  index: number
  text: string
}): Promise<TeaserVoiceResult> {
  const { projectId, pointId, scriptVersion, index, text } = input
  const stored = (await storedRecords(projectId, pointId)).voice
  const current = stored && stored.scriptVersion === scriptVersion ? stored : undefined
  const kept = current?.paragraphs[index]
  if (kept && kept.textHash === teaserTextHash(text)) {
    return {
      ok: true,
      r2Key: kept.r2Key,
      durationMs: kept.durationMs,
      wordTimings: kept.wordTimings,
    }
  }
  const spoken = await voicePointParagraph({
    projectId,
    shortKey: pointId,
    scriptVersion,
    index,
    text,
  })
  const prefix = current?.paragraphs.slice(0, index) ?? []
  if (spoken.ok && prefix.length === index) {
    await savePointProgress({
      projectId,
      pointId,
      voice: {
        scriptVersion,
        paragraphs: [
          ...prefix,
          {
            textHash: teaserTextHash(text),
            r2Key: spoken.r2Key,
            durationMs: spoken.durationMs,
            wordTimings: spoken.wordTimings,
          },
        ],
      },
    })
  }
  return spoken
}

export type PointPlanOrReuse =
  | { ok: true; plan: PointPlanRecord; repairs: Repair[]; fetches: PointFetchesRecord | null }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

/**
 * The stored plan when it was made for this script version and this voice (no
 * model call, and its fetched pictures with it), otherwise plan and store it.
 */
export async function planOrReusePointShots(
  projectId: string,
  pointId: string,
  input: Parameters<typeof planPointShots>[1],
): Promise<PointPlanOrReuse> {
  const stored = await storedRecords(projectId, pointId)
  if (
    stored.plan &&
    stored.plan.plannedFor.scriptVersion === input.voice.scriptVersion &&
    stored.plan.plannedFor.voiceHash === pointVoiceHash(input.voice)
  ) {
    return { ok: true, plan: stored.plan, repairs: [], fetches: stored.fetches ?? null }
  }
  const planned = await planPointShots(projectId, input)
  if (!planned.ok) return planned
  await savePointProgress({
    projectId,
    pointId,
    plan: planned.plan,
    fetches: { candidates: [], state: null },
  })
  return { ...planned, fetches: null }
}

/** How many of a plan's shots are new pictures: those whose file is in the fetched pool. */
export function countNewPictures(
  plan: PointPlanRecord,
  fetches: PointFetchesRecord | null,
): number {
  const keys = new Set<string>()
  for (const candidate of fetches?.candidates ?? []) {
    if (candidate.r2Key !== undefined) keys.add(candidate.r2Key)
  }
  return plan.shots.filter((shot) => {
    const src = shot.slot && 'src' in shot.slot.payload ? shot.slot.payload.src : undefined
    return src?.r2Key !== undefined && keys.has(src.r2Key)
  }).length
}
