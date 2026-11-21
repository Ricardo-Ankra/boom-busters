import { listShotSlots } from '@boom-busters/db'
import { BudgetExceededError } from '@boom-busters/schemas'
import type {
  DesignableBrief,
  GraphicCode,
  GraphicCodePayload,
  PointPlanRecord,
  PointPlanShot,
  PointScript,
  PointVoiceRecord,
} from '@boom-busters/schemas'
import {
  layoutPointNarration,
  pacePointShots,
  POINT_CHAPTER_ID,
  pointGraphicWindow,
} from '@boom-busters/timeline'
import type { AnswerRetry } from '@/lib/answer'
import { db } from '@/lib/db'
import {
  designGraphic,
  designIssueText,
  loadGraphicContext,
  reviewGraphic,
  type GraphicDesignContext,
  type GraphicSlotTiming,
} from '@/lib/graphic-design'
import { budgetGateData } from './gates'
import { designableBrief, untilAnswered, type StepRunner } from './graphic-steps'
import { pointParagraphAudio } from './point-build'

/**
 * A point Short's own graphics (decision 476). The planner lifts the film's
 * designed graphics from its library, but a lifted design is the film's: its
 * beats wait for the film's words, which the Short words differently, and it
 * was laid out for 16:9 first. So while the Short is made, each graphic shot
 * is designed again by the same designer: from the Short's words, for the
 * Short's 9:16 frame alone, shown the film's design for its idea and look,
 * then reviewed as a film design is. A design that cannot be made keeps the
 * film's, says why on the Short's card, and never stops the Short.
 *
 * Each design is its own steps, as the film's are (decisions 470 and 472):
 * the first answer, the retry it earned with a fresh 240 s, each collected
 * from the bridge over further steps, then the review.
 */

/** What a Short design says when the bridge never answered. */
export const SHORT_GAVE_UP_ISSUE =
  'the designer took too long (no answer after about 14 minutes); Re-plan the shots to try again'

/**
 * Why a graphic shot kept the film's design when no board brief holds the
 * code it plays: the film's graphic was redesigned after the film was last
 * assembled (or its slot is gone), so the lifted code is not on the board.
 */
export const NO_FILM_BRIEF_ISSUE =
  "the film's graphic has changed on the board since the film was last assembled, so its brief could not be found; assemble the film again, then Re-plan"

/** A shot playing a film graphic that this Short has not yet tried to design for itself. */
export function wantsShortDesign(shot: PointPlanShot): boolean {
  return shot.slot?.payload.kind === 'graphic-code' && shot.shortDesign === undefined
}

/**
 * The film's brief for a graphic shot: the board row whose stored design is
 * the code the shot plays. The master's slots carry no row id, so the code is
 * the join; a row redesigned since the master was compiled no longer matches.
 */
async function filmBrief(
  projectId: string,
  compiled: string,
): Promise<{ brief: DesignableBrief & { code: GraphicCode }; chapterId: string } | null> {
  for (const row of await listShotSlots(db, projectId)) {
    const brief = designableBrief(row)
    if (brief?.code?.compiled === compiled) {
      return { brief: { ...brief, code: brief.code }, chapterId: row.chapterId }
    }
  }
  return null
}

/** The Short's clock: its words and length, and its plan paced as the compile paces it. */
export function shortClock(script: PointScript, voice: PointVoiceRecord, plan: PointPlanRecord) {
  const narration = layoutPointNarration(pointParagraphAudio(script, voice))
  const shots = pacePointShots(plan.shots, narration.words, narration.narrationEndMs).shots
  return { narration, shots }
}

type Clock = ReturnType<typeof shortClock>

/**
 * What the designer is given for the graphic shot at `at`: the film's
 * context (its claims, logos and chapter), with the Short's narration as the
 * one paragraph and only the shot's cue words timed in it, and the window
 * `compileShortMaster` will play the code in. The brief is the film's, its
 * covered words the Short's.
 */
export async function shortDesignSlot(
  projectId: string,
  film: { brief: DesignableBrief; chapterId: string },
  clock: Clock,
  at: number,
  scriptText: string,
): Promise<{
  context: GraphicDesignContext
  slot: GraphicSlotTiming & { brief: DesignableBrief }
}> {
  const { words, narrationEndMs } = clock.narration
  const window = pointGraphicWindow(clock.shots, at, words, narrationEndMs)
  const cues = words
    .slice(window.firstWord, window.cueEndWord + 1)
    .map((word) => ({ text: word.text, startMs: word.startMs }))
  const filmContext = await loadGraphicContext(projectId, film.chapterId)
  return {
    context: {
      ...filmContext,
      paragraphs: [
        {
          chapterId: POINT_CHAPTER_ID,
          index: 0,
          text: scriptText,
          startMs: 0,
          durationMs: narrationEndMs,
          words: cues,
        },
      ],
    },
    slot: {
      chapterId: POINT_CHAPTER_ID,
      startMs: window.startMs,
      durationMs: window.plannedMs,
      brief: { ...film.brief, coversText: cues.map((word) => word.text).join(' ') },
    },
  }
}

/** The shot's payload playing the Short's design: the film's logos and chart data, the new code. */
export function shortPayload(film: GraphicCodePayload, code: GraphicCode): GraphicCodePayload {
  return {
    ...film,
    version: code.version,
    compiled: code.compiled,
    title: code.title,
    words: code.words,
    durationMs: code.durationMs,
    claimIds: [...new Set([...code.facts.map((fact) => fact.claimId), ...film.claimIds])],
  }
}

type DesignOutcome =
  | { ok: true; pending: true }
  | { ok: true; code: GraphicCode }
  | { ok: true; issue: string; retry?: AnswerRetry }
  | { ok: false; gate: Record<string, unknown> }

export type ShortGraphicsResult =
  | {
      ok: true
      plan: PointPlanRecord
      /** True when any shot was tried, so the caller stores the plan. */
      changed: boolean
      /** One line per graphic that kept the film's design, for the Short's card. */
      kept: string[]
    }
  | { ok: false; gate: Record<string, unknown> }

/**
 * Design every graphic shot of a plan for the Short (decision 476), each in
 * steps of its own named `<prefix>-<n>`. The plan comes back paced, as the
 * compile paces it, with each tried graphic marked `shortDesign`; a shot
 * already marked, as on a resumed build, is left as it is. Running out of
 * budget stops it; nothing else does.
 */
export async function designShortGraphics(
  run: StepRunner,
  input: {
    projectId: string
    script: PointScript
    voice: PointVoiceRecord
    plan: PointPlanRecord
    /** The Inngest run, which names each attempt's bridge job (decision 472). */
    runId?: string
    prefix?: string
    /**
     * Store the plan after each graphic, in a step of its own (`<id>-save`),
     * so a later run of the first build reuses what was designed rather than
     * buying it again. The studio's Re-plan stores once, at the end.
     */
    save?: (plan: PointPlanRecord) => Promise<void>
  },
): Promise<ShortGraphicsResult> {
  const prefix = input.prefix ?? 'short-graphic'
  const clock = shortClock(input.script, input.voice, input.plan)
  const scriptText = input.script.paragraphs.map((paragraph) => paragraph.text).join('\n\n')
  const shots: PointPlanShot[] = []
  let n = 0

  for (const [at, shot] of clock.shots.entries()) {
    const payload = shot.slot?.payload
    if (!wantsShortDesign(shot) || payload?.kind !== 'graphic-code') {
      shots.push(shot)
      continue
    }
    const id = `${prefix}-${n}`
    n += 1

    const design =
      (options: { firstOnly: true } | { resume: AnswerRetry }, scope: string) =>
      async (): Promise<DesignOutcome> => {
        const film = await filmBrief(input.projectId, payload.compiled)
        if (!film) return { ok: true, issue: NO_FILM_BRIEF_ISSUE }
        const { context, slot } = await shortDesignSlot(
          input.projectId,
          film,
          clock,
          at,
          scriptText,
        )
        try {
          const result = await designGraphic(context, slot, {
            ...options,
            frame: 'short',
            filmDesign: film.brief.code,
            ...(input.runId ? { bridgeJobScope: `${input.runId}/${scope}` } : {}),
          })
          // Still being written on the bridge: nothing to keep yet (decision 472).
          if (!result.ok && result.pending) return { ok: true, pending: true }
          if (result.ok) return { ok: true, code: result.code }
          return { ok: true, issue: result.issue, ...(result.retry ? { retry: result.retry } : {}) }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false, gate: budgetGateData(error) }
          }
          throw error
        }
      }

    const first = await untilAnswered(run, id, design({ firstOnly: true }, id))
    const second =
      first.ok && 'retry' in first && first.retry
        ? await untilAnswered(run, `${id}-retry`, design({ resume: first.retry }, `${id}-retry`))
        : first
    if (!second.ok) return { ok: false, gate: second.gate }

    if (!('code' in second)) {
      const issue = designIssueText('pending' in second ? SHORT_GAVE_UP_ISSUE : second.issue)
      shots.push({ ...shot, shortDesign: { outcome: 'kept', issue } })
    } else {
      // The review, in a step of its own with its whole time (decision 389).
      // A skipped review keeps the design as it was.
      const designed = second.code
      const reviewed = await run(`${id}-review`, async () => {
        const film = await filmBrief(input.projectId, payload.compiled)
        if (!film) return null
        const { context, slot } = await shortDesignSlot(
          input.projectId,
          film,
          clock,
          at,
          scriptText,
        )
        const result = await reviewGraphic(
          context,
          { ...slot, brief: { ...slot.brief, code: designed } },
          { frame: 'short', filmDesign: film.brief.code },
        )
        return result.outcome === 'skipped' ? null : result.code
      })
      shots.push({
        ...shot,
        slot: { ...shot.slot!, payload: shortPayload(payload, reviewed ?? designed) },
        shortDesign: { outcome: 'designed' },
      })
    }

    // What is designed so far, stored before the next graphic is asked for.
    const save = input.save
    if (save) {
      const sofar: PointPlanRecord = {
        ...input.plan,
        shots: [...shots, ...clock.shots.slice(at + 1)],
      }
      await run(`${id}-save`, () => save(sofar))
    }
  }

  // Every graphic that plays the film's, including those an earlier run tried.
  const kept = shots.flatMap((shot, index) =>
    shot.shortDesign?.outcome === 'kept'
      ? [
          `Shot ${index + 1} plays the film's graphic: the Short's own could not be made: ${shot.shortDesign.issue}`,
        ]
      : [],
  )
  return { ok: true, plan: { ...input.plan, shots }, changed: n > 0, kept }
}
