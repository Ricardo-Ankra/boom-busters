import type { BibleInUse, ChannelBible } from '@boom-busters/schemas'

export class BibleSlotMissingError extends Error {
  readonly slotId: string

  constructor(slotId: string) {
    super(`the channel bible has no example for slot "${slotId}"`)
    this.name = 'BibleSlotMissingError'
    this.slotId = slotId
  }
}

const IF_BLOCK = /\[\[if:([a-z0-9-]+)\]\]([\s\S]*?)\[\[\/if\]\]/g
const EXAMPLE_MARKER = /\[\[example:([a-z0-9-]+)\]\]/g
const ANY_MARKER = /\[\[(?:example|if):([a-z0-9-]+)\]\]/g

/**
 * Resolves a prompt's bible markers. `[[if:id]]...[[/if]]` blocks go first, then
 * each `[[example:id]]` is replaced in one pass by a replacer function, so the
 * inserted text is literal (`$&` and friends mean nothing) and never re-scanned.
 */
export function fillSlots(text: string, inUse: BibleInUse): string {
  const kept = text.replace(IF_BLOCK, (_match, id: string, inner: string) => {
    if (inner.includes('[[if:')) throw new Error('nested [[if:]] blocks are not supported')
    return inUse.slotIds.includes(id) ? inner : ''
  })
  return kept.replace(EXAMPLE_MARKER, (_match, id: string) => {
    const example = inUse.bible.examples[id]
    if (example === undefined) throw new BibleSlotMissingError(id)
    return example
  })
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
