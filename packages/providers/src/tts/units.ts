import { splitParagraphs } from '@boom-busters/schemas'

/**
 * What one narration request covers: a paragraph.
 *
 * This was briefly provider-dependent — Gemini read scene-sized units because
 * an LLM performing each request independently made per-paragraph units sound
 * like 38 narrators taking turns, and its daily request quota made small units
 * expensive. Gemini is gone, and on ElevenLabs the paragraph is simply right:
 * small units keep repairs cheap, re-runs free, and every review row a thing
 * you can regenerate on its own.
 *
 * The unit model survives the scene era because everything downstream came to
 * address `(chapterId, unitIndex)` through it — the runner, the review screen,
 * the retaker and the audio route all derive units from one function over the
 * approved script, which is what keeps "paragraph 2" meaning the same thing
 * to all four. `unitIndex` is stored in `voice_takes.paragraph_index`, and
 * with paragraph units the two are the same number.
 */

export interface NarrationUnit {
  chapterId: string
  chapterTitle: string
  /** Position within the chapter — the value stored as `paragraph_index`. */
  unitIndex: number
  /** Exactly what will be synthesised (and fingerprinted). */
  text: string
}

/**
 * The units of a script, in speaking order. Deterministic: the same chapters
 * always split into the same units, because the unit text is what a take's
 * fingerprint is computed from.
 */
export function narrationUnits(input: {
  chapters: readonly { id: string; title: string; contentMd: string }[]
}): NarrationUnit[] {
  return input.chapters.flatMap((chapter) =>
    splitParagraphs(chapter.contentMd).map((text, index): NarrationUnit => ({
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      unitIndex: index,
      text,
    })),
  )
}
