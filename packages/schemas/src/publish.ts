import { z } from 'zod'

/**
 * The publish description, composed rather than generated (build spec
 * section 9): "hook paragraph + chapter timestamps + sources from dossier +
 * disclaimer". Everything in it already exists on file, so a model is never
 * asked to restate it — the one editable part is the opening body, which the
 * screen seeds with the script's hook paragraph and the human owns from
 * there. The blocks are appended deterministically, and the live preview on
 * the Publish screen renders exactly what this function returns.
 */

/** YouTube's own description ceiling. */
export const DESCRIPTION_MAX_CHARS = 5000

/**
 * The standing disclaimer, baked in rather than configurable: it is legal
 * copy, and a settings field would make "forgot to set it" a publishable
 * state. The AI-disclosure sentence is part of it — narration and some
 * imagery are synthetic on every video this pipeline makes, so disclosing it
 * is not conditional (spec section 9 lists the disclosure flag; the words
 * belong here where every description gets them).
 */
export const PUBLISH_DISCLAIMER =
  'This video is documentary commentary for education. It is not financial advice. ' +
  'Narration is AI-generated and some visuals are re-creations; sources are listed above.'

/**
 * Draft fields the Publish screen stores in `publish_records.metadata`
 * while an item is being prepared. They live beside the final
 * `PublishMetadataSchema` keys (title/description/tags) in the same jsonb;
 * the runner's schema ignores keys it does not know.
 */
export const PublishDraftSchema = z.object({
  title: z.string().trim().max(100).optional(),
  titleOptions: z.array(z.string()).max(12).default([]),
  /** The human-owned opening — the auto-blocks are appended at compose time. */
  descriptionBody: z.string().max(DESCRIPTION_MAX_CHARS).optional(),
  tags: z.array(z.string().trim().min(1).max(100)).max(60).default([]),
})
export type PublishDraft = z.infer<typeof PublishDraftSchema>

/** `825000` → "13:45"; `4923000` → "1:22:03". YouTube's timestamp format. */
export function formatTimestamp(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  const seconds = totalSec % 60
  const mmss = `${hours > 0 ? String(minutes).padStart(2, '0') : minutes}:${String(
    seconds,
  ).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${mmss}` : mmss
}

export interface DescriptionChapter {
  title: string
  startMs: number
}

export interface ComposeDescriptionInput {
  /** The editable opening. Usually seeded with the script's hook paragraph. */
  body: string
  /** In playback order. Fewer than three means no chapter block — YouTube
   *  ignores chapter markers below three, so emitting them would be noise. */
  chapters: readonly DescriptionChapter[]
  /** Source URLs from the dossier's verified claims, already deduplicated. */
  sources: readonly string[]
}

export interface ComposedDescription {
  description: string
  /** How many sources were dropped to fit the 5000-character ceiling. */
  droppedSources: number
}

/**
 * Body, then chapters, then sources, then the disclaimer — and it always
 * fits. The ceiling is enforced by dropping sources from the end of the list
 * (the block that grows without bound), never by truncating mid-sentence:
 * a description YouTube would cut off is a bug, and a disclaimer that got
 * cut off is a liability.
 */
export function composeDescription(input: ComposeDescriptionInput): ComposedDescription {
  const body = input.body.trim()

  const chapterBlock =
    input.chapters.length >= 3
      ? ['Chapters:']
          .concat(
            input.chapters.map(
              // YouTube requires the first stamp to be exactly 0:00.
              (chapter, index) =>
                `${index === 0 ? '0:00' : formatTimestamp(chapter.startMs)} ${chapter.title}`,
            ),
          )
          .join('\n')
      : null

  const build = (sources: readonly string[]): string => {
    const sourceBlock = sources.length > 0 ? ['Sources:'].concat(sources).join('\n') : null
    return [body, chapterBlock, sourceBlock, PUBLISH_DISCLAIMER]
      .filter((block): block is string => block !== null && block !== '')
      .join('\n\n')
  }

  let kept = [...input.sources]
  let description = build(kept)
  while (description.length > DESCRIPTION_MAX_CHARS && kept.length > 0) {
    kept = kept.slice(0, -1)
    description = build(kept)
  }

  return { description, droppedSources: input.sources.length - kept.length }
}
