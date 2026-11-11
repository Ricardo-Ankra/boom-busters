import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { approvedExemplar } from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { DESIGNS } from '@boom-busters/providers'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { CardCode } from '@boom-busters/schemas'
import { isTitleOnlySample } from '@/lib/card-sample'
import { compileGraphicSource } from '@/lib/graphic-code/compile'

export type CardCodeSource = Omit<CardCode, 'words' | 'durationMs'>

export { isTitleOnlySample }

type CardTechnique = 'chapter-title' | 'film-title'

/** The house design for a technique, compiled under the motion preamble; null when there is none. */
function houseCard(technique: CardTechnique): CardCodeSource | null {
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
 * One card's code: the channel's approved version when its sample is title
 * only; a labelled version falls back to the house design, with a note.
 */
async function cardFor(
  db: Database,
  channelId: string,
  technique: CardTechnique,
  name: string,
  notes: string[],
): Promise<CardCodeSource | null> {
  const approved = await approvedExemplar(db, channelId, technique)
  if (approved) {
    if (isTitleOnlySample(approved.code.words)) {
      return {
        version: approved.code.version,
        compiled: approved.code.compiled,
        title: approved.code.title,
      }
    }
    notes.push(
      `${name} v${approved.version} has a label line, so the house ${name.toLowerCase()} is used`,
    )
  }
  return houseCard(technique)
}

/**
 * The exemplar code for the film's chapter and title cards (spec 2026-11-11).
 * Each card uses the channel's approved exemplar when its sample is title only,
 * else the house design (chapter-title, film-title), with a note saying so.
 */
export async function cardCodesFor(
  db: Database,
  channelId: string,
): Promise<{ chapter: CardCodeSource | null; title: CardCodeSource | null; notes: string[] }> {
  const notes: string[] = []
  const chapter = await cardFor(db, channelId, 'chapter-title', 'Chapter title', notes)
  const title = await cardFor(db, channelId, 'film-title', 'Film title', notes)
  return { chapter, title, notes }
}
