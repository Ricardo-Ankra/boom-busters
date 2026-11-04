import type { ChannelFormat } from './formats'

/** The two lines of a format that code places verbatim in the narration. */
export type FixedLines = Pick<ChannelFormat, 'introLine' | 'outroLine'>

const PARAGRAPH_BREAK = /\n{2,}/

/**
 * The format's fixed lines placed in a script's chapters: the opening line as
 * the first paragraph of the first chapter, the closing line as the last
 * paragraph of the last. Each only when set and not already there, so a second
 * pass changes nothing. Chapters are paragraphs separated by blank lines.
 */
export function withFixedLines(chapters: readonly string[], format: FixedLines): string[] {
  const out = [...chapters]
  const intro = format.introLine.trim()
  const outro = format.outroLine.trim()
  const last = out.length - 1
  if (last < 0) return out

  if (intro !== '') {
    const first = out[0] ?? ''
    const head = first.split(PARAGRAPH_BREAK)[0]?.trim()
    if (head !== intro) out[0] = first.trim() === '' ? intro : `${intro}\n\n${first}`
  }
  if (outro !== '') {
    const text = out[last] ?? ''
    const paragraphs = text.split(PARAGRAPH_BREAK)
    const tail = paragraphs[paragraphs.length - 1]?.trim()
    if (tail !== outro) out[last] = text.trim() === '' ? outro : `${text.trimEnd()}\n\n${outro}`
  }
  return out
}

/** Whether a paragraph is one of the format's fixed lines: an exact match after trimming. */
export function isFixedParagraph(text: string, format: FixedLines): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  return trimmed === format.introLine.trim() || trimmed === format.outroLine.trim()
}

/** The text without its fixed paragraphs, for every reader that must not see them. */
export function dropFixedParagraphs(text: string, format: FixedLines): string {
  if (format.introLine.trim() === '' && format.outroLine.trim() === '') return text
  return text
    .split(PARAGRAPH_BREAK)
    .filter((paragraph) => !isFixedParagraph(paragraph, format))
    .join('\n\n')
}

/**
 * A chapter's text split around the fixed paragraphs that open and close it,
 * for an editor that shows those read-only: `body` is what can be edited and
 * `joinFixedParagraphs` puts the pieces back, blank lines between.
 */
export function splitFixedParagraphs(
  text: string,
  format: FixedLines,
): { head: string[]; body: string; tail: string[] } {
  const paragraphs = text.split(PARAGRAPH_BREAK)
  let start = 0
  while (start < paragraphs.length && isFixedParagraph(paragraphs[start] ?? '', format)) start += 1
  let end = paragraphs.length
  while (end > start && isFixedParagraph(paragraphs[end - 1] ?? '', format)) end -= 1
  return {
    head: paragraphs.slice(0, start).map((p) => p.trim()),
    body: paragraphs.slice(start, end).join('\n\n'),
    tail: paragraphs.slice(end).map((p) => p.trim()),
  }
}

/** The inverse of `splitFixedParagraphs`. */
export function joinFixedParagraphs(parts: {
  head: readonly string[]
  body: string
  tail: readonly string[]
}): string {
  return [...parts.head, parts.body, ...parts.tail].filter((p) => p.trim() !== '').join('\n\n')
}
