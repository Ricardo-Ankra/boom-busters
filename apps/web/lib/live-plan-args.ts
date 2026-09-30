/**
 * The live plan harness's arguments (decision 285). Pure, like
 * `live-set-args.ts`, whose cap rules it shares: a cap above $1 is the
 * owner's decision, never a flag.
 */
import { optionalText, parseCap, readRawFlags } from './live-set-args'

export interface LivePlanArgs {
  project: string
  /** The chapter's stored index, zero-based (`chapters.index`). */
  chapter: number
  cap: number
  /** Names the run folder: "before", "after", or any folder-safe word. */
  label: string
  out?: string
  /** A previous run folder: generate its briefs again instead of planning afresh. */
  briefsFrom?: string
  /** Overrides the production shot-list model, which must otherwise be a Google one. */
  plannerModel?: string
}

export function parseLivePlanArgs(argv: readonly string[]): LivePlanArgs {
  const raw = readRawFlags(argv)
  const project = optionalText(raw, 'project')
  if (!project) throw new Error('--project is required (the project id).')
  const chapterText = optionalText(raw, 'chapter')
  const chapter = Number(chapterText)
  if (chapterText === undefined || !Number.isInteger(chapter) || chapter < 0) {
    throw new Error('--chapter is required: the zero-based chapter index, for example 5.')
  }
  const label = optionalText(raw, 'label') ?? 'run'
  if (!/^[a-z0-9-]+$/i.test(label)) {
    throw new Error('--label may hold only letters, digits and hyphens.')
  }
  const out = optionalText(raw, 'out')
  const briefsFrom = optionalText(raw, 'briefs-from')
  const plannerModel = optionalText(raw, 'planner-model')
  return {
    project,
    chapter,
    cap: parseCap(raw.cap),
    label,
    ...(out ? { out } : {}),
    ...(briefsFrom ? { briefsFrom } : {}),
    ...(plannerModel ? { plannerModel } : {}),
  }
}
