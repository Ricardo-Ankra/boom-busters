/**
 * The live graphics harness's arguments (decision 289 follow-up). Pure, like
 * `live-plan-args.ts`, whose cap rules it shares: a cap above $1 is the
 * owner's decision, never a flag.
 */
import { optionalText, parseCap, readRawFlags } from './live-set-args'

/** The slots a run designs: named ones, or the first few graphics in film order. */
export type LiveGraphicSelection =
  { kind: 'slots'; ids: string[] } | { kind: 'first'; count: number }

export interface LiveGraphicArgs {
  project: string
  selection: LiveGraphicSelection
  /** Producer guidance sent with every design, as Redesign graphic's steering field does. */
  steer?: string
  /** Send each slot's stored scene as the redesign input, instead of designing from the intent. */
  redesign: boolean
  /** An Anthropic model id; absent means production's graphics route. */
  model?: string
  cap: number
  /** Names the run folder. */
  label: string
  out?: string
}

const DEFAULT_FIRST = 5

export function parseLiveGraphicArgs(argv: readonly string[]): LiveGraphicArgs {
  const raw = readRawFlags(argv)
  const project = optionalText(raw, 'project')
  if (!project) throw new Error('--project is required (the project id).')

  const slotsText = optionalText(raw, 'slots')
  const firstText = optionalText(raw, 'first')
  if (slotsText !== undefined && firstText !== undefined) {
    throw new Error('Pass --slots or --first, not both.')
  }

  let selection: LiveGraphicSelection
  if (slotsText !== undefined) {
    const ids = slotsText
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id !== '')
    if (ids.length === 0) throw new Error('--slots needs at least one slot id, comma-separated.')
    if (new Set(ids).size !== ids.length) throw new Error('--slots names a slot more than once.')
    selection = { kind: 'slots', ids }
  } else {
    const count = firstText === undefined ? DEFAULT_FIRST : Number(firstText)
    if (!Number.isInteger(count) || count < 1) {
      throw new Error('--first must be a whole number of at least 1, for example 5.')
    }
    selection = { kind: 'first', count }
  }

  const label = optionalText(raw, 'label') ?? 'graphics'
  if (!/^[a-z0-9-]+$/i.test(label)) {
    throw new Error('--label may hold only letters, digits and hyphens.')
  }
  const steer = optionalText(raw, 'steer')
  const model = optionalText(raw, 'model')
  const out = optionalText(raw, 'out')

  return {
    project,
    selection,
    ...(steer ? { steer } : {}),
    redesign: 'redesign' in raw,
    ...(model ? { model } : {}),
    cap: parseCap(raw.cap),
    label,
    ...(out ? { out } : {}),
  }
}
