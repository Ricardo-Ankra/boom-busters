import { getLatestScript, getProject, MOCK_KEY_PREFIX } from '@boom-busters/db'
import {
  buildTeaserRequest,
  mockProvidersEnabled,
  mockTeaser,
  parseTeaser,
  tensionFromOutline,
} from '@boom-busters/providers'
import {
  BudgetExceededError,
  OutlineSchema,
  serialiseError,
  teaserTextHash,
} from '@boom-busters/schemas'
import type { NoticeTarget, TeaserParagraph } from '@boom-busters/schemas'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { callForAnswer } from '@/lib/answer'
import { completeForProject } from '@/lib/answer-call'
import { db } from '@/lib/db'
import { recordRepairs, recordStop } from '@/lib/notices'
import { putObject, takeStorage } from '@/lib/storage'
import { synthesise } from '@/lib/tts'
import { budgetGateData } from './gates'

/**
 * The teaser's build steps, shared by the shorts-runner (which builds one
 * when none exists, decision 225) and the teaser-rebuild-runner (which
 * re-voices an edited script and recuts, decision 227). One implementation,
 * because the two must never disagree about idempotency keys or audio keys —
 * that agreement is what makes a rebuild re-serve unchanged beats for free.
 */

export type TeaserWriteResult =
  | { ok: true; title: string; paragraphs: TeaserParagraph[]; scriptVersion: number }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

/** How the Teaser card's place says a stopped script (decision 293), unless the caller words it. */
const TEASER_SKIPPED = 'The teaser was skipped'

/**
 * Write the teaser script from the latest script's chapters and tension, on
 * the answer helper (decision 293): at most two calls, the second told what
 * was wrong. Its notices are written here, inside the caller's step, so no
 * new field crosses a step boundary: what a repair trimmed, or why the script
 * stopped, on the Teaser card's place. Two refused answers skip the teaser;
 * the budget keeps its gate; anything else the call throws (a provider
 * outage) is thrown, so Inngest retries the step instead of skipping a teaser
 * a passing outage cost. `stopped` words a stop's notice for the caller's act;
 * `null` when the caller records the stop itself (the teaser rebuild).
 */
export async function writeTeaserScript(
  projectId: string,
  stopped: string | null = TEASER_SKIPPED,
): Promise<TeaserWriteResult> {
  const latest = await getLatestScript(db, projectId)
  if (!latest) return { ok: false, skipped: 'there is no script to write a teaser from' }
  const chapterSources = latest.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    contentMd: chapter.contentMd,
  }))
  const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
  const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined
  const target: NoticeTarget = { projectId, subject: 'teaser', subjectId: null }

  if (mockProvidersEnabled()) {
    await recordRepairs(target)
    return { ok: true, ...mockTeaser(chapterSources), scriptVersion: latest.script.version }
  }

  try {
    const project = await getProject(db, projectId)
    const answer = await callForAnswer({
      request: buildTeaserRequest({
        caseTitle: project?.title ?? '',
        chapters: chapterSources,
        ...(tension ? { tension } : {}),
      }),
      parse: (text, note) => parseTeaser(text, chapterSources.length, note),
      complete: completeForProject(projectId),
    })
    if (!answer.ok) {
      if (stopped !== null) await recordStop(target, 'skipped', `${stopped}: ${answer.issue}`)
      return { ok: false, skipped: `the teaser script failed: ${answer.issue}` }
    }
    await recordRepairs(target, answer.repairs)
    return { ok: true, ...answer.value, scriptVersion: latest.script.version }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { ok: false, gate: budgetGateData(error) }
    }
    throw error
  }
}

export type TeaserVoiceResult =
  | {
      ok: true
      r2Key: string
      durationMs: number
      wordTimings: TeaserParagraphAudio['wordTimings']
    }
  | { ok: false; gate: Record<string, unknown> }
  | { ok: false; skipped: string }

/**
 * The beat's synthesis identity: same project, version, position and TEXT
 * re-serves the earlier purchase. The text rides as a hash, not a length —
 * an edit that happened to keep the character count used to be handed the
 * old audio back.
 */
export function teaserBeatIdempotencyKey(
  projectId: string,
  scriptVersion: number,
  index: number,
  text: string,
): string {
  return `teaser:${projectId}:${scriptVersion}:${index}:${teaserTextHash(text)}`
}

/** Synthesise one teaser beat and store its audio; budget-gated like all TTS. */
export async function voiceTeaserBeat(input: {
  projectId: string
  scriptVersion: number
  index: number
  paragraph: TeaserParagraph
}): Promise<TeaserVoiceResult> {
  const { projectId, scriptVersion, index, paragraph } = input
  try {
    const narration = await synthesise({
      text: paragraph.text,
      idempotencyKey: teaserBeatIdempotencyKey(projectId, scriptVersion, index, paragraph.text),
      projectId,
    })
    const r2Key =
      takeStorage() === 'r2'
        ? (
            await putObject(
              `boom-busters/voice/${projectId}/teaser/v${scriptVersion}-${index}.wav`,
              narration.wav,
              'audio/wav',
            )
          ).key
        : `${MOCK_KEY_PREFIX}voice/teaser-${projectId}-${index}.wav`
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
      skipped: `beat ${index + 1} could not be synthesised: ${String(serialiseError(error).message ?? 'unknown')}`,
    }
  }
}
