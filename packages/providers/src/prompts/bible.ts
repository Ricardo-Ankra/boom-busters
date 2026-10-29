import { SLOT_ID_PATTERN } from '@boom-busters/schemas'
import type { BibleInUse, ChannelBible } from '@boom-busters/schemas'

export class BibleSlotMissingError extends Error {
  readonly slotId: string

  constructor(slotId: string) {
    super(`the channel bible has no example for slot "${slotId}"`)
    this.name = 'BibleSlotMissingError'
    this.slotId = slotId
  }
}

// The slot id pattern without its anchors, so the markers and the schema agree on what an id is.
const SLOT_ID = SLOT_ID_PATTERN.source.slice(1, -1)
const IF_BLOCK = new RegExp(`\\[\\[if:(${SLOT_ID})\\]\\]([\\s\\S]*?)\\[\\[\\/if\\]\\]`, 'g')
const EXAMPLE_MARKER = new RegExp(`\\[\\[example:(${SLOT_ID})\\]\\]`, 'g')
const ANY_MARKER = new RegExp(`\\[\\[(?:example|if):(${SLOT_ID})\\]\\]`, 'g')
const MARKER_START = /\[\[\/?(?:if|example)/

/** Fails closed: any marker-looking text that is not a well-formed marker or pair throws. */
function assertWellFormed(text: string): void {
  const residue = text
    .replace(IF_BLOCK, (_match, _id: string, inner: string) => {
      if (inner.includes('[[if:')) throw new Error('nested [[if:]] blocks are not supported')
      return inner
    })
    .replace(EXAMPLE_MARKER, '')
  const stray = MARKER_START.exec(residue)
  if (stray) {
    throw new Error(`malformed bible marker near "${residue.slice(stray.index, stray.index + 40)}"`)
  }
}

// Two private-use characters: cannot occur in craft text, and stand in for `[[` while a prompt is filled.
const LITERAL_OPEN = '\uE000\uE000'

/**
 * Protects owner-typed bible text (a field value, the channel's rules) from
 * `fillSlots`: every `[[` becomes a sentinel that is no marker, and `fillSlots`
 * puts `[[` back as its last step, so the sent text is exactly what was typed.
 * Wrap every bible field a prompt interpolates before `fillSlots` runs.
 */
export function literalBibleText(text: string): string {
  return text.replaceAll('[[', LITERAL_OPEN)
}

/**
 * Resolves a prompt's bible markers. `[[if:id]]...[[/if]]` blocks go first, then
 * each `[[example:id]]` is replaced in one pass by a replacer function, so the
 * inserted text is literal (`$&` and friends mean nothing) and never re-scanned.
 */
export function fillSlots(text: string, inUse: BibleInUse): string {
  assertWellFormed(text)
  const kept = text.replace(IF_BLOCK, (_match, id: string, inner: string) => {
    return inUse.slotIds.includes(id) ? inner : ''
  })
  const filled = kept.replace(EXAMPLE_MARKER, (_match, id: string) => {
    const example = inUse.bible.examples[id]
    if (example === undefined) throw new BibleSlotMissingError(id)
    return example
  })
  return filled.replaceAll(LITERAL_OPEN, '[[')
}

/** Slot ids of every example and if marker, in order of first appearance. */
export function markersIn(text: string): string[] {
  const ids: string[] = []
  for (const match of text.matchAll(ANY_MARKER)) {
    const id = match[1]!
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

export function noun(bible: ChannelBible, form: 'singular' | 'plural'): string {
  return bible.subjectNoun[form]
}

/** The channel's own rules, appended to a stage prompt; empty when it has none. */
export function channelRulesBlock(bible: ChannelBible, stage: 'script' | 'direction'): string {
  const pieces: string[] = []
  if (stage === 'script') {
    for (const line of bible.voiceDos) pieces.push(`- Do: ${line}`)
    for (const line of bible.voiceDonts) pieces.push(`- Don't: ${line}`)
  }
  const md = (stage === 'script' ? bible.scriptRulesMd : bible.directionRulesMd).trim()
  if (md.length > 0) pieces.push(md)
  if (pieces.length === 0) return ''
  return `\n\n## This channel's rules\n\n${pieces.join('\n')}`
}

/**
 * One of the channel's drafted lists (hooks, openings, titles) as a headed
 * block of `- ` lines, appended after a prompt's existing rules; empty when
 * the list is, so a channel without them changes nothing. The text and the
 * note are the owner's, so they come back already through `literalBibleText`.
 */
export function exampleEntriesBlock(
  heading: string,
  entries: readonly { text: string; note: string }[],
): string {
  if (entries.length === 0) return ''
  const lines = entries.map((entry) => {
    const text = entry.text.trim().replaceAll('\n', '\n  ')
    const note = entry.note.trim()
    return literalBibleText(`- ${text}${note ? ` (${note})` : ''}`)
  })
  return `\n\n## ${heading}\n\n${lines.join('\n')}`
}
