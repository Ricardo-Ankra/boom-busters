import { z } from 'zod'

/**
 * The mechanisms (spec 2026-11-04, section 8.5): a global list of the moves
 * a motion graphic can be built on, seeded from the 28-film grammar and the
 * house exemplars. Each house exemplar names the ones it uses, the designer
 * may name the ones its design is built on, and the critic checks whether
 * each named one is actually on the frames. Nothing else enforces them.
 *
 * Here beside the technique keys, not in the providers package, for the same
 * reason those moved: the designer's answer schema needs the enum.
 */

export const MECHANISMS = [
  {
    key: 'persistent-actor',
    definition: 'one element stays on screen through the slot and carries every change',
  },
  {
    key: 'foreground-becomes-transition',
    definition: 'an element grows, turns or moves until it is the next layout',
  },
  {
    key: 'cause-to-effect',
    definition: 'one thing visibly makes the next thing happen',
  },
  {
    key: 'density-from-hierarchy',
    definition: 'the busiest layer is the least important; the point sits alone',
  },
  {
    key: 'change-of-speed',
    definition: 'a fast move set against a slow one, so each reads by contrast',
  },
  { key: 'hard-cut', definition: 'a change with no transition at all' },
  {
    key: 'word-splits-open',
    definition: 'a word or line parts in the middle to let the next thing through',
  },
  { key: 'docking', definition: 'a moving element settles into a slot made for it' },
  { key: 'drum', definition: 'a count that strikes each figure in turn, beat by beat' },
  { key: 'reel', definition: 'a column of values spins and stops on the answer' },
  { key: 'draw-on', definition: 'a line, shape or path drawn as the viewer watches' },
  {
    key: 'rise-from-baseline',
    definition: 'bars and figures grow up from their rule, never morph across',
  },
  { key: 'tally', definition: 'marks that accumulate one at a time until the count is shown' },
  { key: 'door', definition: 'a panel opens or slides away to reveal what was behind it' },
  { key: 'marker-stroke', definition: 'a hand-drawn underline, circle or strike over the type' },
  { key: 'camera-push', definition: 'the whole frame drifts slowly in, so nothing is ever still' },
] as const

export const MECHANISM_KEYS = MECHANISMS.map((mechanism) => mechanism.key) as unknown as [
  (typeof MECHANISMS)[number]['key'],
  ...(typeof MECHANISMS)[number]['key'][],
]

export const MechanismSchema = z.enum(MECHANISM_KEYS)
export type Mechanism = z.infer<typeof MechanismSchema>

/** A design names at most this many; more is a list, not a design. */
export const MECHANISMS_PER_DESIGN_MAX = 6

/** The key in words: "rise from baseline". */
export function mechanismName(key: Mechanism): string {
  return key.replaceAll('-', ' ')
}
