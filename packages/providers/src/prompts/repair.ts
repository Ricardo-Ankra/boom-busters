import { NOTICE_MESSAGE_MAX } from '@boom-busters/schemas'

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

/**
 * One change a parser made to a model's answer instead of refusing it
 * (decision 293). `field` is already words for the owner ("era rule 1",
 * "claim 37"), never a path: it is shown on the card the answer lands on.
 */
export type Repair =
  | { action: 'trimmed'; field: string }
  | { action: 'capped'; field: string; kept: number }
  | { action: 'dropped'; field: string; reason: string }
  | { action: 'rounded'; field: string; from: number; to: number }

/** Where a parser reports a repair; the answer helper collects them per attempt. */
export type Note = (repair: Repair) => void

/** For a parser called outside the helper: the repairs still happen, unreported. */
export const ignoreRepairs: Note = () => {}

/** `trimText`, reporting the trim. Anything but a string is left for the schema to refuse. */
export function trimField(value: unknown, max: number, field: string, note: Note): unknown {
  if (typeof value !== 'string') return value
  const trimmed = trimText(value, max)
  if (trimmed !== value) note({ action: 'trimmed', field })
  return trimmed
}

/** The first `max` items of a list, reporting the cut. Anything but a list is left alone. */
export function capList(value: unknown, max: number, field: string, note: Note): unknown {
  if (!Array.isArray(value) || value.length <= max) return value
  note({ action: 'capped', field, kept: max })
  return value.slice(0, max)
}

/**
 * The items of a list `bad` has no reason against; each one dropped is
 * reported under `label`, counted from the list as the model wrote it.
 */
export function dropItems(
  value: unknown,
  bad: (item: unknown) => string | null,
  label: (item: unknown, index: number) => string,
  note: Note,
): unknown {
  if (!Array.isArray(value)) return value
  return value.filter((item, index) => {
    const reason = bad(item)
    if (reason === null) return true
    note({ action: 'dropped', field: label(item, index), reason })
    return false
  })
}

/** "its text ran over 1,000 characters": a drop's reason in words. */
export function overLimit(what: string, max: number): string {
  return `${what} ran over ${max.toLocaleString('en-GB')} characters`
}

/** One line for the owner saying what an answer's repairs changed, or null when nothing was. */
export function describeRepairs(repairs: readonly Repair[]): string | null {
  if (repairs.length === 0) return null
  const parts: string[] = []
  const trimmed = repairs.filter((repair) => repair.action === 'trimmed').map((r) => r.field)
  if (trimmed.length > 0) parts.push(`Trimmed to fit: ${trimmed.join('; ')}.`)
  for (const repair of repairs) {
    if (repair.action === 'capped') parts.push(`Kept the first ${repair.kept} ${repair.field}.`)
    if (repair.action === 'dropped') parts.push(`Dropped ${repair.field}: ${repair.reason}.`)
    if (repair.action === 'rounded') {
      parts.push(`Rounded ${repair.field} from ${repair.from} to ${repair.to}.`)
    }
  }
  return trimText(parts.join(' '), NOTICE_MESSAGE_MAX)
}
