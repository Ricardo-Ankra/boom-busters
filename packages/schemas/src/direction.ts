import { z } from 'zod'
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
      `- Chapter ${chapter.chapter}: ${chapter.dominantShotFamily} shots; ${chapter.moodShift}; ` +
        `key image: ${chapter.keyImage}`,
    )
  }
  lines.push(`Final image: ${book.finalImage}`)
  return lines.join('\n')
}

/**
 * Craft misses the model let through, in words for the plan summary. Never a
 * rejection: a same-size run is a note for the owner, not a broken slot.
 * Slots arrive in screen order. The banned list is passed in because this
 * package must not import the providers package that owns the bible.
 */
export function planWarnings(
  slots: readonly { brief: ShotBrief }[],
  bannedWords: readonly string[],
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

  return warnings
}
