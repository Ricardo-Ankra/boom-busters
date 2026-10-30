import { EXAMPLE_SLOT_IDS } from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { LIFT_CASES } from './lift/lift-cases'

/** The stages the Bible tab can show the composed system prompt for. */
export const PREVIEW_STAGES = [
  'script',
  'shotlist',
  'direction',
  'graphics',
  'metadata',
  'dossier',
] as const
export type PreviewStage = (typeof PREVIEW_STAGES)[number]

/** The `LIFT_CASES` entry whose system prompt stands for each stage: the stage's main builder. */
export const PREVIEW_CASE: Record<PreviewStage, string> = {
  script: 'script-outline',
  shotlist: 'shotlist-sets',
  direction: 'direction-book-full',
  graphics: 'graphics-graphic-minimal',
  metadata: 'metadata-titles-master',
  dossier: 'dossier-brief-full-case',
}

/** Every missing or blank example slot says what is needed, so an unfinished draft still previews. */
function previewBible(bible: ChannelBible): ChannelBible {
  const examples = { ...bible.examples }
  for (const id of EXAMPLE_SLOT_IDS) {
    if ((examples[id] ?? '').trim().length === 0) examples[id] = `[example needed: ${id}]`
  }
  return { ...bible, examples }
}

/**
 * The system prompt the stage's main builder sends for this bible: what the
 * models are told. The builder's other inputs are the lift case's fixed ones.
 */
export function composeStagePrompt(stage: PreviewStage, bible: ChannelBible): string {
  const name = PREVIEW_CASE[stage]
  const found = LIFT_CASES.find((c) => c.name === name)
  if (!found) throw new Error(`no lift case named ${name}`)
  return found.build({ bible: previewBible(bible), slotIds: EXAMPLE_SLOT_IDS }).system
}
