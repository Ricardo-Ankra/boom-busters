/**
 * Repairs for a model's answer (decision 292): a fixable overrun is cut down
 * here, with no extra call, rather than refused and asked again. Only for
 * free text. A field that carries a fact (a number, a link, a name, a claim
 * reference, an enum) is never repaired: cutting it would change what it says.
 */

/**
 * `text` cut to at most `max` characters: at the last sentence end inside the
 * limit when it lies in the limit's second half (an early "Dr." or "Ltd."
 * would throw most of the text away), else at the last space, else hard.
 * A sentence end is ".", "!" or "?" followed by whitespace or the end of the
 * text, so the point in "$1.5" is not one.
 */
export function trimText(text: string, max: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= max) return text
  const head = trimmed.slice(0, max)
  let sentenceEnd = -1
  for (const match of head.matchAll(/[.!?]/g)) {
    const next = trimmed[match.index + 1]
    if (next === undefined || /\s/.test(next)) sentenceEnd = match.index
  }
  if (sentenceEnd >= max / 2) return head.slice(0, sentenceEnd + 1)
  const space = head.lastIndexOf(' ')
  if (space > 0) return head.slice(0, space).trimEnd()
  return head
}
