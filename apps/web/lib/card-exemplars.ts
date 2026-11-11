import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { approvedExemplar } from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { DESIGNS } from '@boom-busters/providers'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { CardCode, GraphicCodeWord } from '@boom-busters/schemas'
import { compileGraphicSource } from '@/lib/graphic-code/compile'

export type CardCodeSource = Omit<CardCode, 'words' | 'durationMs'>

/**
 * True when the sample has no label line: no word before the last ends a
 * sentence. A card drawn from a labelled sample would show the label where
 * the film has only a title to give it.
 */
export function isTitleOnlySample(words: readonly GraphicCodeWord[]): boolean {
  return !words.slice(0, -1).some((word) => word.text.endsWith('.'))
}

/** The house design for a technique, compiled under the motion preamble; null when there is none. */
function houseCard(technique: 'chapter-title'): CardCodeSource | null {
  const design = DESIGNS[technique]
  if (!design) return null
  const result = compileGraphicSource(design.source)
  if (!result.ok) return null
  return {
    version: GRAPHIC_CODE_VERSION,
    compiled: `${MOTION_PREAMBLE}\n${result.compiled}`,
    title: design.title,
  }
}

/**
 * The exemplar code for the film's chapter and title cards (spec 2026-11-11).
 * The channel's approved chapter-title is used when its sample is title only;
 * a labelled version falls back to the house design, with a note saying so.
 * The title card has no design yet (a later task adds film-title), so it is
 * null and the composition's built-in card stands.
 */
export async function cardCodesFor(
  db: Database,
  channelId: string,
): Promise<{ chapter: CardCodeSource | null; title: CardCodeSource | null; notes: string[] }> {
  const notes: string[] = []
  let chapter: CardCodeSource | null = null
  const approved = await approvedExemplar(db, channelId, 'chapter-title')
  if (approved) {
    if (isTitleOnlySample(approved.code.words)) {
      chapter = {
        version: approved.code.version,
        compiled: approved.code.compiled,
        title: approved.code.title,
      }
    } else {
      notes.push(
        `Chapter title v${approved.version} has a label line, so the house chapter title is used`,
      )
    }
  }
  chapter ??= houseCard('chapter-title')
  return { chapter, title: null, notes }
}
