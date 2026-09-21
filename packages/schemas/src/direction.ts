import { z } from 'zod'
import { nameMatches } from './cast'
import type { ShotBrief } from './visuals'

/**
 * The Director's Book (decision 252): the per-film layer of visual direction.
 *
 * The House Visual Bible (`providers/prompts/direction-craft.md`) is fixed and
 * decides everything that does not change between films: the register, the
 * shot grammar, the people rules. This document decides only what
 * legitimately varies for one film, and every chapter's shot-list call
 * receives it rendered as prose in the cacheable prefix, so eight chapters
 * planned by eight separate calls still read as one film.
 */

export const DEPICTIONS = ['likeness', 'anonymous', 'archival-only'] as const
export const DepictionSchema = z.enum(DEPICTIONS)
export type Depiction = z.infer<typeof DepictionSchema>

export const SHOT_FAMILIES = ['environment', 'document', 'human', 'data', 'map', 'object'] as const
export const ShotFamilySchema = z.enum(SHOT_FAMILIES)
export type ShotFamily = z.infer<typeof ShotFamilySchema>

const line = z.string().trim().min(1).max(600)

export const PrincipalSchema = z.object({
  name: line,
  role: line,
  depiction: DepictionSchema,
  /** Pasted verbatim into every prompt that shows this person. */
  identityString: line,
  /** The per-person depiction rule, specific to what the claims establish. */
  guardrail: line,
})
export type Principal = z.infer<typeof PrincipalSchema>

export const ChapterDirectionSchema = z.object({
  /** 1-based position in the script, the numbering the prompt shows the model. */
  chapter: z.number().int().min(1),
  dominantShotFamily: ShotFamilySchema,
  moodShift: line,
  keyImage: line,
})
export type ChapterDirection = z.infer<typeof ChapterDirectionSchema>

export const DirectorsBookSchema = z.object({
  visualThesis: line,
  eraLocks: z
    .array(z.object({ span: line, rules: line }))
    .min(1)
    .max(6),
  palette: z.object({
    accent: line,
    temperature: z.enum(['cold', 'neutral', 'warm']),
    note: line,
  }),
  motifs: z.array(line).length(3, 'a film has exactly three motifs'),
  anchorObject: line,
  neverShow: z.array(line).max(12),
  principals: z.array(PrincipalSchema).max(12),
  locations: z.array(z.object({ name: line, look: line })).max(12),
  chapters: z.array(ChapterDirectionSchema).min(1),
  finalImage: line,
})
export type DirectorsBook = z.infer<typeof DirectorsBookSchema>

/** The book as prose sections, for the shot-list prompt's cacheable prefix. */
export function renderDirectorsBook(book: DirectorsBook): string {
  const lines: string[] = [
    `Visual thesis: ${book.visualThesis}`,
    `Era locks: ${book.eraLocks.map((lock) => `${lock.span}: ${lock.rules}`).join(' | ')}`,
    `Palette: accent ${book.palette.accent}, ${book.palette.temperature}; ${book.palette.note}`,
    `Motifs: ${book.motifs.join('; ')}`,
    `Anchor object: ${book.anchorObject}`,
  ]
  if (book.neverShow.length > 0) lines.push(`Never show: ${book.neverShow.join('; ')}`)
  if (book.principals.length > 0) {
    lines.push('Principals:')
    for (const person of book.principals) {
      lines.push(
        `- ${person.name} (${person.depiction}), ${person.role}. Identity: ${person.identityString}. ` +
          `Guardrail: ${person.guardrail}`,
      )
    }
  }
  if (book.locations.length > 0) {
    lines.push('Locations:')
    for (const place of book.locations) lines.push(`- ${place.name}: ${place.look}`)
  }
  lines.push('Chapters:')
  for (const chapter of book.chapters) {
    lines.push(
      `- Chapter ${chapter.chapter}: leans towards ${chapter.dominantShotFamily} shots; ` +
        `${chapter.moodShift}; ` +
        `key image: ${chapter.keyImage}`,
    )
  }
  lines.push(`Final image: ${book.finalImage}`)
  return lines.join('\n')
}

export interface WarnableSlot {
  brief: ShotBrief
  /**
   * The chapter this slot belongs to, in the words a note should use
   * ("chapter 3"). Groups the motif count; absent, the whole list is one
   * chapter.
   */
  chapter?: string | undefined
}

/**
 * The head noun of a motif as a whole-word pattern that also takes the
 * plural (decision 260): "server racks" matches "rack" and "racks",
 * "reflections in dark glass" matches "glass" and "glasses". English noun
 * phrases are head-final, so the last word is the thing itself and the words
 * before it are modifiers a prompt may drop or vary. A heuristic, which is
 * why what it finds is a note and never a rejection.
 */
export function motifPattern(motif: string): RegExp | null {
  const words = motif.toLowerCase().match(/[a-z][a-z'-]*/g)
  const head = words ? words[words.length - 1] : undefined
  if (!head) return null
  const stem =
    head.endsWith('s') && !head.endsWith('ss') && head.length > 3 ? head.slice(0, -1) : head
  return new RegExp(`\\b${stem.replace(/[-']/g, '\\$&')}(?:s|es)?\\b`, 'i')
}

/** The words of a brief a motif could hide in. Charts, maps and headlines have none. */
function motifText(brief: ShotBrief): string | null {
  switch (brief.type) {
    case 'still':
    case 'hero':
      return `${brief.description} ${brief.prompt}`
    case 'stock':
    case 'archival':
      return `${brief.description} ${brief.query}`
    default:
      return null
  }
}

/** The set a warnable slot names, or null. Only picture briefs can name one. */
function slotSet(brief: WarnableSlot['brief']): string | null {
  if (brief.type !== 'still' && brief.type !== 'hero') return null
  return brief.set?.trim() || null
}

/**
 * Craft misses the model let through, in words for the plan summary. Never a
 * rejection: a same-size run is a note for the owner, not a broken slot.
 * Slots arrive in screen order. The banned list is passed in because this
 * package must not import the providers package that owns the bible; the
 * motifs are passed in because they are the film's, from its book.
 */
export function planWarnings(
  slots: readonly WarnableSlot[],
  bannedWords: readonly string[],
  motifs: readonly string[] = [],
  setNames: readonly string[] = [],
): string[] {
  const warnings: string[] = []

  let run = 1
  for (let index = 1; index < slots.length; index += 1) {
    const size = slots[index]!.brief.shotSize
    const previous = slots[index - 1]!.brief.shotSize
    run = size !== undefined && size === previous ? run + 1 : 1
    if (run === 3) {
      warnings.push(`three adjacent slots share the size "${size}" (from slot ${index - 1})`)
    }
  }

  const seen = new Set<string>()
  for (const [index, slot] of slots.entries()) {
    const brief = slot.brief
    if (brief.type !== 'still' && brief.type !== 'hero') continue
    const prompt = brief.prompt.toLowerCase()
    for (const word of bannedWords) {
      if (!seen.has(word) && prompt.includes(word.toLowerCase())) {
        seen.add(word)
        warnings.push(`a prompt uses the banned word "${word}" (slot ${index})`)
      }
    }
  }

  // Motifs (decision 260): the floor is one per chapter and so is the
  // ceiling, so a motif in two picture briefs of one chapter is a note, and
  // so is the same motif in two slots that play back to back.
  const texts = slots.map((slot) => motifText(slot.brief))
  const groups = new Map<string, string[]>()
  for (const [index, slot] of slots.entries()) {
    const text = texts[index]
    if (text === null || text === undefined) continue
    const key = slot.chapter ?? ''
    groups.set(key, [...(groups.get(key) ?? []), text])
  }
  for (const motif of motifs) {
    const pattern = motifPattern(motif)
    if (!pattern) continue
    for (const [chapter, group] of groups) {
      const hits = group.filter((text) => pattern.test(text)).length
      if (hits > 1) {
        warnings.push(
          `motif "${motif}" appears in ${hits} of ${group.length} picture briefs` +
            (chapter === '' ? '' : ` in ${chapter}`),
        )
      }
    }
    for (let index = 1; index < texts.length; index += 1) {
      const previous = texts[index - 1]
      const current = texts[index]
      if (
        previous !== null &&
        previous !== undefined &&
        current !== null &&
        current !== undefined &&
        pattern.test(previous) &&
        pattern.test(current)
      ) {
        warnings.push(`motif "${motif}" appears in two adjacent slots (from slot ${index - 1})`)
        break
      }
    }
  }

  // Sets carry decision 260's risk in a new place: a room named on every
  // brief is the new empty chair. Counted per chapter, like a motif, and
  // never a rejection.
  const byChapter = new Map<string, { total: number; sets: Map<string, number> }>()
  for (const slot of slots) {
    const chapter = slot.chapter ?? 'the film'
    const entry = byChapter.get(chapter) ?? { total: 0, sets: new Map() }
    if (slot.brief.type === 'still' || slot.brief.type === 'hero') {
      entry.total += 1
      const named = slotSet(slot.brief)
      if (named) entry.sets.set(named, (entry.sets.get(named) ?? 0) + 1)
    }
    byChapter.set(chapter, entry)
  }
  for (const [chapter, entry] of byChapter) {
    for (const [name, count] of entry.sets) {
      if (entry.total > 1 && count * 2 > entry.total) {
        warnings.push(
          `the set "${name}" carries ${count} of ${entry.total} picture briefs in ${chapter}`,
        )
      }
    }
  }

  // One note per set, like the motif walk above: a run of four slots in one
  // room is one problem to fix, and three lines about it reads as three.
  const adjacent = new Set<string>()
  for (const [index, slot] of slots.entries()) {
    const here = slotSet(slot.brief)
    const next = slots[index + 1] ? slotSet(slots[index + 1]!.brief) : null
    if (here && next && here === next && !adjacent.has(here)) {
      adjacent.add(here)
      warnings.push(`the set "${here}" fills two adjacent slots (from slot ${index})`)
    }
  }

  // A set nothing holds conditions nothing, exactly like a depicts name with
  // no photograph, and is worth saying before the money is spent. A project
  // with no sets at all is the loudest case of it, not an exemption.
  const unknown = new Set<string>()
  for (const slot of slots) {
    const named = slotSet(slot.brief)
    if (named && !setNames.some((name) => nameMatches(named, name))) unknown.add(named)
  }
  for (const name of unknown) {
    warnings.push(`the film has no set named "${name}", so that shot is generated plain`)
  }

  return warnings
}

/**
 * The cast members the book forgot (decision 253). A note for the plan
 * screen, never a rejection: the producer can redraft or add the principal
 * by hand, and a book that covers four of five people still plans four.
 */
export function castWarnings(
  book: { principals: readonly { name: string }[] } | null,
  castNames: readonly string[],
): string[] {
  if (!book) return []
  const named = new Set(book.principals.map((principal) => principal.name.trim().toLowerCase()))
  return castNames
    .filter((name) => !named.has(name.trim().toLowerCase()))
    .map(
      (name) => `the book has no principal for ${name}; redraft the direction or add them by hand`,
    )
}
