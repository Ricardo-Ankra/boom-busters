import { BIBLE_SECTION_ORDER } from '@boom-busters/schemas'
import type { BibleSection } from '@boom-busters/schemas'

/** The bible's lists of entries; their flags are `hooks.<i>`, `openings.<i>` and `titles.<i>`. */
export const BIBLE_ENTRY_LISTS = ['hooks', 'openings', 'titles'] as const

/** The section a flag's path (`examples.<id>`, `hooks.<i>`) belongs to. */
export function flagSection(path: string): BibleSection | null {
  const head = path.split('.')[0] ?? ''
  if (head === 'examples') return 'examples'
  return (BIBLE_ENTRY_LISTS as readonly string[]).includes(head) ? 'hooks' : null
}

/**
 * The section an error's key belongs to: a unit key (`voice`, `examples:<file>`,
 * `slot:<id>`), or one field of a section drafted by field (`hooks:openings`).
 */
export function errorSection(key: string): BibleSection | null {
  if (key.startsWith('examples:') || key.startsWith('slot:')) return 'examples'
  const head = key.split(':')[0] ?? ''
  return BIBLE_SECTION_ORDER.find((section) => section === head) ?? null
}
