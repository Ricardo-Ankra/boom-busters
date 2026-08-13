import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { latestTakes, splitParagraphs, TTS_CREDENTIAL_PROVIDER } from '@boom-busters/schemas'
import type { TtsProvider, VoiceTakeStatus } from '@boom-busters/schemas'
import type { Database } from './client'
import { chapters, scripts, voiceAuditions, voiceTakes } from './schema'
import type { VoiceAuditionRow, VoiceTakeRow } from './schema'

/**
 * Voice-take queries (build spec sections 5, 7.3 and 11.3).
 *
 * The two rules this module exists to hold:
 *
 * **A take is bought once.** `idempotencyKey` is
 * `hash(projectId, chapterId, paragraphIndex, textHash, voiceId)`, so re-running
 * the voice stage over an unchanged script pays for nothing (spec principle 5).
 * `claimTake` is the only way to create one, and it looks before it buys.
 *
 * **A retake never destroys the take it replaces.** Take numbers accumulate
 * under the same key; the review row A/Bs between them, and a retake you like
 * less than the original has a way back. Only the highest number counts as
 * current, which is what `latestTakes` in `packages/schemas` decides — one
 * function, so the runner, the gate and the screen cannot disagree about which
 * audio is the one.
 */

/**
 * The key a take gets when nothing was really stored.
 *
 * `MOCK_PROVIDERS=1` runs have no bucket — CI certainly does not — and the
 * alternative to a marked key was writing a plausible-looking `boom-busters/…`
 * path that points at nothing. A row you cannot tell apart from a real one is
 * exactly the kind of thing that gets discovered three milestones later, at
 * assembly, when something finally tries to read the audio.
 *
 * So mock takes say so in their key, and the audio route regenerates their
 * bytes deterministically instead of fetching them. It lives here rather than
 * with the rest of the storage helpers because the runner, the route and the
 * E2E seed must all write the same shape, and the seed cannot import from
 * `apps/web`.
 */
export const MOCK_KEY_PREFIX = 'mock://'

export function isMockKey(key: string | null): boolean {
  return key !== null && key.startsWith(MOCK_KEY_PREFIX)
}

export function mockVoiceTakeKey(takeId: string): string {
  return `${MOCK_KEY_PREFIX}voice/${takeId}.wav`
}

export interface ParagraphRef {
  chapterId: string
  paragraphIndex: number
}

/** Every take of a project, oldest first — the retake history included. */
export async function listVoiceTakes(db: Database, projectId: string): Promise<VoiceTakeRow[]> {
  return db
    .select()
    .from(voiceTakes)
    .where(eq(voiceTakes.projectId, projectId))
    .orderBy(asc(voiceTakes.chapterId), asc(voiceTakes.paragraphIndex), asc(voiceTakes.takeNumber))
}

export async function getVoiceTake(db: Database, id: string): Promise<VoiceTakeRow | undefined> {
  const [row] = await db.select().from(voiceTakes).where(eq(voiceTakes.id, id)).limit(1)
  return row
}

/**
 * The take a paragraph currently speaks with, if any.
 *
 * Ordered by take number rather than by `createdAt`: two retakes requested in
 * the same second are ordered by the number they were given, and a clock is not
 * a sequence.
 */
export async function currentTake(
  db: Database,
  ref: ParagraphRef,
): Promise<VoiceTakeRow | undefined> {
  const [row] = await db
    .select()
    .from(voiceTakes)
    .where(
      and(
        eq(voiceTakes.chapterId, ref.chapterId),
        eq(voiceTakes.paragraphIndex, ref.paragraphIndex),
      ),
    )
    .orderBy(desc(voiceTakes.takeNumber))
    .limit(1)

  return row
}

/**
 * A take together with the words it speaks.
 *
 * The text is not stored on the take — it lives on the chapter, split by
 * `splitParagraphs`, and duplicating it would create a second copy that a
 * script edit could silently leave behind. So it is re-derived from the same
 * function the runner used, which is the only way "paragraph 4" means the same
 * thing to both.
 *
 * `undefined` text is a real state, not an error: a chapter edited down to
 * fewer paragraphs leaves takes pointing past its end, and the review screen
 * needs to say so rather than crash.
 */
export async function takeWithParagraph(
  db: Database,
  id: string,
): Promise<{ take: VoiceTakeRow; text: string | undefined } | undefined> {
  const take = await getVoiceTake(db, id)
  if (!take) return undefined

  const [chapter] = await db
    .select({ contentMd: chapters.contentMd })
    .from(chapters)
    .where(eq(chapters.id, take.chapterId))
    .limit(1)

  return {
    take,
    text: chapter ? splitParagraphs(chapter.contentMd)[take.paragraphIndex] : undefined,
  }
}

export interface ClaimTakeInput {
  projectId: string
  chapterId: string
  paragraphIndex: number
  idempotencyKey: string
  /** The narrator. Stored as the account it bills to — see `TTS_CREDENTIAL_PROVIDER`. */
  provider: TtsProvider
  voiceId: string
  builtFromScriptVersion: number
  /** A retake asks for the next number; the runner always asks for 1. */
  takeNumber?: number
  note?: string
}

export type ClaimTakeResult =
  { kind: 'existing'; take: VoiceTakeRow } | { kind: 'claimed'; take: VoiceTakeRow }

/**
 * Reserve the row a synthesis will fill, or hand back the audio already bought.
 *
 * This is the money decision, so it is one statement rather than a read
 * followed by a write. Two paragraphs of a fan-out that happened to hash the
 * same, or an Inngest step retried while its first attempt was still in flight,
 * would both slip through a check-then-insert and pay twice — which is exactly
 * what the idempotency key exists to prevent.
 *
 * A `pending` row that was claimed and never filled is deliberately *not*
 * treated as existing audio: the caller re-synthesises into it. A run that died
 * between claiming and storing must be resumable, and the alternative is a
 * paragraph that is silent forever with a row saying otherwise.
 */
export async function claimTake(db: Database, input: ClaimTakeInput): Promise<ClaimTakeResult> {
  const takeNumber = input.takeNumber ?? 1

  const [existing] = await db
    .select()
    .from(voiceTakes)
    .where(
      and(
        eq(voiceTakes.idempotencyKey, input.idempotencyKey),
        eq(voiceTakes.takeNumber, takeNumber),
      ),
    )
    .limit(1)

  if (existing && existing.r2Key !== null) return { kind: 'existing', take: existing }

  const [row] = await db
    .insert(voiceTakes)
    .values({
      projectId: input.projectId,
      chapterId: input.chapterId,
      paragraphIndex: input.paragraphIndex,
      idempotencyKey: input.idempotencyKey,
      provider: TTS_CREDENTIAL_PROVIDER[input.provider],
      voiceId: input.voiceId,
      builtFromScriptVersion: input.builtFromScriptVersion,
      takeNumber,
      status: 'pending',
      ...(input.note === undefined ? {} : { note: input.note }),
    })
    .onConflictDoUpdate({
      target: [voiceTakes.idempotencyKey, voiceTakes.takeNumber],
      // Re-claiming an unfilled row: keep its id so anything already pointing
      // at it stays valid, and refresh the fields a re-run may have changed.
      set: {
        provider: TTS_CREDENTIAL_PROVIDER[input.provider],
        voiceId: input.voiceId,
        builtFromScriptVersion: input.builtFromScriptVersion,
        status: 'pending',
        updatedAt: sql`now()`,
      },
    })
    .returning()

  if (!row) throw new Error(`Could not claim a voice take for ${input.idempotencyKey}`)
  return { kind: 'claimed', take: row }
}

/** Fill a claimed take with the audio that was bought for it. */
export async function storeTakeAudio(
  db: Database,
  id: string,
  audio: { r2Key: string; durationMs: number; costUsd: number; waveform: number[] },
): Promise<VoiceTakeRow> {
  const [row] = await db
    .update(voiceTakes)
    .set({
      r2Key: audio.r2Key,
      durationMs: audio.durationMs,
      costUsd: audio.costUsd.toFixed(6),
      waveform: audio.waveform,
      status: 'generated',
      updatedAt: sql`now()`,
    })
    .where(eq(voiceTakes.id, id))
    .returning()

  if (!row) throw new Error(`Voice take ${id} no longer exists`)
  return row
}

/**
 * Flag a take for a retake, with the note that says what was wrong.
 *
 * The note travels with the take rather than with the retake request, because
 * it is the reason this audio is unacceptable — and it has to survive long
 * enough to be shown beside the replacement.
 */
export async function flagTake(db: Database, id: string, note: string): Promise<VoiceTakeRow> {
  const [row] = await db
    .update(voiceTakes)
    .set({ status: 'flagged', note, updatedAt: sql`now()` })
    .where(eq(voiceTakes.id, id))
    .returning()

  if (!row) throw new Error(`Voice take ${id} no longer exists`)
  return row
}

/**
 * Clear a flag without buying a replacement.
 *
 * The escape hatch for a flag pressed by accident, or a second listen that
 * changed your mind. Without it the only way past a mis-click is to pay for a
 * retake of audio that was fine.
 */
export async function unflagTake(db: Database, id: string): Promise<VoiceTakeRow> {
  const [row] = await db
    .update(voiceTakes)
    .set({ status: 'generated', note: null, updatedAt: sql`now()` })
    .where(and(eq(voiceTakes.id, id), eq(voiceTakes.status, 'flagged')))
    .returning()

  if (!row) throw new Error(`Voice take ${id} is not flagged`)
  return row
}

export async function setTakeStatus(
  db: Database,
  id: string,
  status: VoiceTakeStatus,
): Promise<void> {
  await db
    .update(voiceTakes)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(voiceTakes.id, id))
}

/**
 * Mark every current take approved, at the voice gate.
 *
 * Only the current take of each paragraph: superseded takes stay as they were,
 * because "approved" is a statement about the audio that will be assembled, and
 * a take that lost an A/B comparison is not that.
 */
export async function approveCurrentTakes(db: Database, projectId: string): Promise<number> {
  const rows = await listVoiceTakes(db, projectId)
  const current = latestTakes(
    rows.map((row) => ({
      id: row.id,
      chapterId: row.chapterId,
      paragraphIndex: row.paragraphIndex,
      takeNumber: row.takeNumber,
      status: row.status,
    })),
  )

  for (const take of current) {
    await setTakeStatus(db, take.id, 'approved')
  }

  return current.length
}

/**
 * How many paragraphs the latest script expects narration for.
 *
 * Counted from the same `splitParagraphs` the runner used, so "60 of 61
 * paragraphs have audio" cannot be an artefact of two different opinions about
 * where a paragraph ends. The caller does the splitting; this only fetches the
 * text, ordered.
 */
export async function latestScriptParagraphSources(
  db: Database,
  projectId: string,
): Promise<{
  scriptVersion: number
  chapters: { id: string; title: string; contentMd: string }[]
}> {
  const [script] = await db
    .select({ id: scripts.id, version: scripts.version })
    .from(scripts)
    .where(eq(scripts.projectId, projectId))
    .orderBy(desc(scripts.version))
    .limit(1)

  if (!script) return { scriptVersion: 0, chapters: [] }

  const rows = await db
    .select({ id: chapters.id, title: chapters.title, contentMd: chapters.contentMd })
    .from(chapters)
    .where(eq(chapters.scriptId, script.id))
    .orderBy(asc(chapters.index))

  return { scriptVersion: script.version, chapters: rows }
}

// ---------------------------------------------------------------------------
// Audition cache
// ---------------------------------------------------------------------------

/**
 * How many auditions are kept before the oldest are dropped.
 *
 * Comfortably more than the voices one provider offers, so a full pass through
 * a catalogue never evicts the earlier half of its own comparison — and small
 * enough that a settings table does not quietly become the largest thing in the
 * database.
 */
export const AUDITION_CACHE_LIMIT = 120

/** A cached audition, or `undefined` when this voice has not read this sample. */
export async function findAudition(
  db: Database,
  key: { provider: TtsProvider; voiceId: string; sampleHash: string },
): Promise<VoiceAuditionRow | undefined> {
  const [row] = await db
    .select()
    .from(voiceAuditions)
    .where(
      and(
        eq(voiceAuditions.provider, TTS_CREDENTIAL_PROVIDER[key.provider]),
        eq(voiceAuditions.voiceId, key.voiceId),
        eq(voiceAuditions.sampleHash, key.sampleHash),
      ),
    )
    .limit(1)

  return row
}

/**
 * Keep an audition so replaying it is free.
 *
 * The prune runs on write rather than on a schedule: there is no cron in this
 * app but the analytics one (spec section 7.9), and a cache that only grows is
 * a cache nobody remembers to empty.
 */
export async function saveAudition(
  db: Database,
  input: {
    provider: TtsProvider
    voiceId: string
    sampleHash: string
    audioBase64: string
    durationMs: number
    costUsd: number
  },
  /** Injected by tests, so the prune can be exercised without 120 round trips. */
  limit: number = AUDITION_CACHE_LIMIT,
): Promise<void> {
  await db
    .insert(voiceAuditions)
    .values({
      provider: TTS_CREDENTIAL_PROVIDER[input.provider],
      voiceId: input.voiceId,
      sampleHash: input.sampleHash,
      audioBase64: input.audioBase64,
      durationMs: input.durationMs,
      costUsd: input.costUsd.toFixed(6),
    })
    .onConflictDoUpdate({
      target: [voiceAuditions.provider, voiceAuditions.voiceId, voiceAuditions.sampleHash],
      set: { audioBase64: input.audioBase64, durationMs: input.durationMs, updatedAt: sql`now()` },
    })

  await db.execute(sql`
    delete from voice_auditions
    where id in (
      select id from voice_auditions
      order by created_at desc, id desc
      offset ${limit}
    )`)
}

/** Every cached audition for a sample, so the panel opens with what it has. */
export async function listAuditions(db: Database, sampleHash: string): Promise<VoiceAuditionRow[]> {
  return db.select().from(voiceAuditions).where(eq(voiceAuditions.sampleHash, sampleHash))
}
