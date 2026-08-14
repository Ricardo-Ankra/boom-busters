import { splitParagraphs } from '@boom-busters/schemas'
import type { TtsProvider } from '@boom-busters/schemas'
import { promptSteered } from './registry'

/**
 * What one narration request covers: the unit.
 *
 * Two facts decide it, and both are the vendor's:
 *
 *  - **On Gemini, the unit is the scene.** Each request is an independent
 *    performance — an LLM with no memory of how the neighbouring text was
 *    read — so per-paragraph units made a 38-paragraph script sound like 38
 *    narrators taking turns. One request per scene is one continuous
 *    performance, which is also Google's own chunking guidance. And Gemini's
 *    API tier allows a few hundred requests per *day*, so 38 requests per run
 *    was spending a scarce resource to make the output worse.
 *
 *  - **On Chirp and ElevenLabs, the unit stays the paragraph.** Chirp is
 *    deterministic — paragraphs cannot drift apart — and small units keep
 *    repairs cheap and re-runs free. Cloud TTS also caps a request at ~4,000
 *    bytes, which a chapter can exceed.
 *
 * `unitIndex` is stored in `voice_takes.paragraph_index`; everything that
 * addressed a paragraph now addresses a unit, and in paragraph mode the two
 * are the same thing.
 */

export type NarrationUnitKind = 'paragraph' | 'scene'

export interface NarrationUnit {
  chapterId: string
  chapterTitle: string
  /** Position within the chapter — the value stored as `paragraph_index`. */
  unitIndex: number
  /** Exactly what will be synthesised (and fingerprinted). */
  text: string
  /** Which source paragraphs this unit covers: `[start, endExclusive)`. */
  paragraphSpan: readonly [number, number]
}

export function narrationUnitKind(
  provider: TtsProvider,
  env: Record<string, string | undefined> = process.env,
): NarrationUnitKind {
  // Prompt-steered is the honest proxy: the same fact that makes a narrator's
  // paragraphs drift apart (an LLM performing per request) is the one that
  // lets a scene-length request hold together.
  return promptSteered(provider, env) ? 'scene' : 'paragraph'
}

/**
 * Gemini-TTS documents a 4,000-byte cap on the text field (Cloud TTS surface;
 * the Gemini API is roomier). Scenes pack to comfortably under it, so a unit
 * is valid on either surface — at ~150 words a minute this is still two-plus
 * minutes of narration per request, chapter-sized for this channel.
 */
export const SCENE_TEXT_BYTE_BUDGET = 3_500

/**
 * The units of a script, in speaking order. Deterministic: the same chapters
 * always pack into the same units, because the unit text is what a take's
 * fingerprint is computed from.
 */
export function narrationUnits(input: {
  provider: TtsProvider
  chapters: readonly { id: string; title: string; contentMd: string }[]
  env?: Record<string, string | undefined>
}): NarrationUnit[] {
  const kind = narrationUnitKind(input.provider, input.env ?? process.env)

  return input.chapters.flatMap((chapter) => {
    const paragraphs = splitParagraphs(chapter.contentMd)

    if (kind === 'paragraph') {
      return paragraphs.map((text, index): NarrationUnit => ({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        unitIndex: index,
        text,
        paragraphSpan: [index, index + 1],
      }))
    }

    // Scene: greedily pack whole paragraphs up to the byte budget. Usually a
    // chapter fits in one unit; an oversized paragraph gets a unit to itself,
    // because a unit boundary inside a paragraph would be audible.
    const units: NarrationUnit[] = []
    let start = 0
    let batch: string[] = []
    let bytes = 0

    const flush = (endExclusive: number): void => {
      if (batch.length === 0) return
      units.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        unitIndex: units.length,
        text: batch.join('\n\n'),
        paragraphSpan: [start, endExclusive],
      })
      batch = []
      bytes = 0
    }

    paragraphs.forEach((text, index) => {
      const added = Buffer.byteLength(text, 'utf8') + (batch.length > 0 ? 2 : 0)
      if (batch.length > 0 && bytes + added > SCENE_TEXT_BYTE_BUDGET) flush(index)
      if (batch.length === 0) start = index
      batch.push(text)
      bytes += Buffer.byteLength(text, 'utf8') + (batch.length > 1 ? 2 : 0)
    })
    flush(paragraphs.length)

    return units
  })
}
