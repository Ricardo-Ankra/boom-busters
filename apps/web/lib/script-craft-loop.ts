import { trimText } from '@boom-busters/providers'
import { craftWarning, NOTICE_MESSAGE_MAX } from '@boom-busters/schemas'
import type { GutterWarning, NewNotice, ScriptCraftFinding } from '@boom-busters/schemas'

/**
 * What one craft check of a chapter came back with (decision 463). `stopped`
 * is the reason a check that could not be read gives; its loop ends there.
 */
export type CraftPass = { findings: ScriptCraftFinding[]; stopped?: string }

const sentenceIn = (text: string, finding: ScriptCraftFinding) =>
  text.includes(finding.sentence.trim())

const stop = (message: string): NewNotice => ({ kind: 'stopped', message })

/**
 * Turns the craft loop's results for one chapter into gutter warnings and
 * notice lines. `chapterNumber` is 1-based. `draftMd` and `revisedMd` may carry
 * the format's fixed lines: the runner passes the stored texts, because the
 * format is read only inside steps. That is safe, since a finding's sentence
 * is quoted from text that never held the fixed lines, so the substring tests
 * below give the same answer with or without them. A finding is fixed when its sentence is in the draft and no
 * longer in the revision: a finding whose sentence the model paraphrased is
 * not in the draft, so it is never counted as fixed.
 */
export function settleCraft(input: {
  chapterNumber: number
  draftMd: string
  first: CraftPass
  revisedMd: string | null
  reviseStopped?: string
  recheck: CraftPass | null
}): { warnings: GutterWarning[]; notices: NewNotice[] } {
  const { chapterNumber: n, draftMd, first, revisedMd, reviseStopped, recheck } = input
  if (first.stopped !== undefined) {
    return {
      warnings: [],
      notices: [
        stop(
          `Chapter ${n}: the craft check stopped: ${first.stopped}. The chapter keeps its first draft.`,
        ),
      ],
    }
  }
  if (first.findings.length === 0) return { warnings: [], notices: [] }

  const all = first.findings.map(craftWarning)
  if (reviseStopped !== undefined) {
    return {
      warnings: all,
      notices: [
        stop(
          `Chapter ${n}: the craft revision stopped: ${reviseStopped}. Its craft notes are in the gutter.`,
        ),
      ],
    }
  }
  if (revisedMd === null) return { warnings: all, notices: [] }

  const problems: string[] = []
  for (const finding of first.findings) {
    if (!sentenceIn(draftMd, finding) || sentenceIn(revisedMd, finding)) continue
    const problem = finding.problem.trim().replace(/\.+$/, '')
    if (!problems.includes(problem)) problems.push(problem)
  }
  const notices: NewNotice[] =
    problems.length === 0
      ? []
      : [
          {
            kind: 'trimmed',
            message: trimText(
              `Chapter ${n} revised for craft: ${problems.join('; ')}.`,
              NOTICE_MESSAGE_MAX,
            ),
          },
        ]

  if (recheck !== null && recheck.stopped === undefined) {
    return { warnings: recheck.findings.map(craftWarning), notices }
  }
  if (recheck !== null && recheck.stopped !== undefined) {
    notices.push(stop(`Chapter ${n}: the craft recheck stopped: ${recheck.stopped}.`))
  }
  return {
    warnings: first.findings.filter((f) => sentenceIn(revisedMd, f)).map(craftWarning),
    notices,
  }
}
