import { createHash } from 'node:crypto'
import { getLatestScript, getProject, MOCK_KEY_PREFIX } from '@boom-busters/db'
import {
  buildTeaserRequest,
  mockProvidersEnabled,
  mockTeaser,
  parseTeaser,
  tensionFromOutline,
} from '@boom-busters/providers'
import { BudgetExceededError, OutlineSchema, serialiseError } from '@boom-busters/schemas'
import type { TeaserParagraph } from '@boom-busters/schemas'
import type { TeaserParagraphAudio } from '@boom-busters/timeline'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
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

/** Write the teaser script from the latest script's chapters and tension. */
export async function writeTeaserScript(projectId: string): Promise<TeaserWriteResult> {
  const latest = await getLatestScript(db, projectId)
  if (!latest) return { ok: false, skipped: 'there is no script to write a teaser from' }
  const chapterSources = latest.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    contentMd: chapter.contentMd,
  }))
  const parsedOutline = OutlineSchema.safeParse(latest.script.outline)
  const tension = parsedOutline.success ? tensionFromOutline(parsedOutline.data) : undefined

  try {
    const project = await getProject(db, projectId)
    const teaser = mockProvidersEnabled()
      ? mockTeaser(chapterSources)
      : parseTeaser(
          (
            await callLlm(
              buildTeaserRequest({
                caseTitle: project?.title ?? '',
                chapters: chapterSources,
                ...(tension ? { tension } : {}),
              }),
              { projectId },
            )
          ).text,
        )
    return { ok: true, ...teaser, scriptVersion: latest.script.version }
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      return { ok: false, gate: budgetGateData(error) }
    }
    return {
      ok: false,
      skipped: `the teaser script failed: ${String(serialiseError(error).message ?? 'unknown')}`,
    }
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
  const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
  return `teaser:${projectId}:${scriptVersion}:${index}:${digest}`
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
