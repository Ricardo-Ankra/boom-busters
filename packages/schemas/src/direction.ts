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
 * The fields of a brief the craft rules read (decision 271). Narrow on
 * purpose, so the same rules run over a planned brief straight from the
 * model and a stored brief from the database.
 */
export interface FindingBrief {
  type: string
  shotSize?: string | undefined
  coversText: string
  description?: string | undefined
  prompt?: string | undefined
  query?: string | undefined
  depicts?: readonly string[] | undefined
  set?: string | undefined
}

export interface FindingSlot {
  brief: FindingBrief
  /** The chapter this slot belongs to, as a note says it ("chapter 3"). */
  chapter?: string | undefined
  /**
   * The slot shows another slot's picture (a reuse link). It carries no
   * finding: its picture is another slot's, so rewriting its words changes
   * nothing on screen, and retyping it would break the rule every retype
   * action enforces (`linkedSlotRefusal`). It still counts toward size runs
   * and set runs, because its picture is on screen.
   */
  linked?: boolean | undefined
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `text` contains `phrase` as whole words, ignoring the width of the
 * whitespace between them and, unless asked otherwise, case (decision 271).
 * "Parker" is not in "Parkerton"; "data center" is in "the data  center".
 */
export function containsPhrase(
  text: string,
  phrase: string,
  options: { caseSensitive?: boolean } = {},
): boolean {
  const parts = phrase
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  if (parts.length === 0) return false
  return new RegExp(
    `\\b${parts.map(escapeRegExp).join('\\s+')}\\b`,
    options.caseSensitive ? '' : 'i',
  ).test(text)
}

/** Name suffixes a surname sits in front of, as whole case-sensitive tokens. */
const NAME_SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV'])

/**
 * The word a sentence would use for a cast member: the last token of the
 * name, skipping a trailing suffix, so "Martin Luther King Jr." is "King".
 */
function surnameOf(name: string): string | undefined {
  const tokens = name.trim().split(/\s+/)
  while (tokens.length > 1 && NAME_SUFFIXES.has(tokens[tokens.length - 1]!)) tokens.pop()
  const last = tokens[tokens.length - 1]
  return last === undefined || last.length === 0 ? undefined : last
}

/** Set-name words too general to identify one room on their own. */
const GENERIC_SET_WORDS = new Set([
  'center',
  'centre',
  'room',
  'office',
  'building',
  'floor',
  'space',
  'area',
])

/**
 * The words a sentence would use for a set (decision 271): the name's last
 * word, or its last two when the last is too general to mean one room.
 * "Venture Capital Boardroom" is "boardroom"; "Cloud Computing Data Center" is
 * "data center", so "at the center of it" does not put a shot in the data
 * centre.
 */
export function setKeyNoun(name: string): string | null {
  const words = name.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []
  const last = words[words.length - 1]
  if (last === undefined) return null
  const before = words[words.length - 2]
  return GENERIC_SET_WORDS.has(last) && before !== undefined ? `${before} ${last}` : last
}

/**
 * A brief's words with the book's era-lock lists taken out (decision 271).
 * The bible used to have every prompt paste the era lock verbatim, and an era
 * lock is a list of objects, so a motif noun inside it ("rack" in
 * "rack-mounted blade servers") counted as the motif in every still of the
 * film.
 */
function withoutEraLocks(text: string, eraLocks: readonly string[]): string {
  let out = text
  for (const rules of eraLocks) {
    const trimmed = rules.trim()
    if (trimmed.length > 0) out = out.replace(new RegExp(escapeRegExp(trimmed), 'gi'), ' ')
  }
  return out
}

/** The words of a brief a motif could hide in. Charts, maps and headlines have none. */
function motifText(brief: FindingBrief, eraLocks: readonly string[] = []): string | null {
  const words =
    brief.type === 'still' || brief.type === 'hero'
      ? `${brief.description ?? ''} ${brief.prompt ?? ''}`
      : brief.type === 'stock' || brief.type === 'archival'
        ? `${brief.description ?? ''} ${brief.query ?? ''}`
        : null
  return words === null ? null : withoutEraLocks(words, eraLocks)
}

/** The set a slot names, or null. Only picture briefs can name one. */
function slotSet(brief: FindingBrief): string | null {
  if (brief.type !== 'still' && brief.type !== 'hero') return null
  return brief.set?.trim() || null
}

/**
 * Whether a slot's own sentence puts it in this set (decision 271). A room
 * the sentence names is the right room however often it recurs, so this is
 * what separates a justified run of shots in one set from the "room on every
 * slot" mistake.
 */
function sentencePlacesIn(brief: FindingBrief, set: string): boolean {
  const key = setKeyNoun(set)
  return key !== null && containsPhrase(brief.coversText, key)
}

/** Briefs that are photographs of a kind, and so have a shot size a run can share. */
const PICTURE_TYPES = new Set(['still', 'hero', 'stock', 'archival'])

/**
 * The size a brief brings to a same-size run, or undefined when it breaks
 * one. A chart, map, headline or graphic is the "graphic" family and breaks a
 * run of photographs rather than joining one, whatever size it is tagged, and
 * so does a picture with no size. One rule for the plan-screen note and the
 * craft finding, so the two never disagree about a run.
 */
function runSize(brief: { type: string; shotSize?: string | undefined }): string | undefined {
  return PICTURE_TYPES.has(brief.type) ? brief.shotSize : undefined
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
  /** The book's era-lock `rules` strings, taken out before a motif is looked for (decision 271). */
  eraLocks: readonly string[] = [],
): string[] {
  const warnings: string[] = []

  let run = 0
  let previous: string | undefined
  for (const [index, slot] of slots.entries()) {
    const size = runSize(slot.brief)
    run = size !== undefined && size === previous ? run + 1 : size === undefined ? 0 : 1
    previous = size
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
  const texts = slots.map((slot) => motifText(slot.brief, eraLocks))
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
    if (
      here &&
      next &&
      here === next &&
      !sentencePlacesIn(slots[index + 1]!.brief, next) &&
      !adjacent.has(here)
    ) {
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

/**
 * References the producer holds that no brief calls on (the silent half of
 * decision 253 and 264).
 *
 * The whole reference system hangs on two optional fields the planner has to
 * volunteer: a still's `depicts` and its `set`. When they are absent
 * `generateStillCandidates` never even reads the cast or sets tables, so an
 * uploaded photograph conditions nothing and the still is generated plain.
 * Every existing note points the other way — `planWarnings` warns when a set
 * is named too OFTEN, `castWarnings` when the book forgot a person — and a
 * film whose briefs name nothing at all drew no note of any kind. That is the
 * one case where the producer has paid for photographs and the run quietly
 * ignores them, which is exactly the case worth saying out loud.
 *
 * A note, never a rejection: a chapter of maps and charts legitimately names
 * nobody, and only the producer can tell that from a planner that forgot.
 */
export function referenceWarnings(
  slots: readonly WarnableSlot[],
  /** Cast members holding at least one photograph, by exact name. */
  photographed: readonly string[],
  /** Sets holding at least one plate, by exact name. */
  platedSets: readonly string[],
): string[] {
  const pictures = slots.filter((slot) => slot.brief.type === 'still' || slot.brief.type === 'hero')
  if (pictures.length === 0) return []
  if (photographed.length === 0 && platedSets.length === 0) return []

  const warnings: string[] = []

  const namesPerson = (name: string) =>
    pictures.some(
      (slot) =>
        (slot.brief.type === 'still' || slot.brief.type === 'hero') &&
        (slot.brief.depicts ?? []).some((entry) => nameMatches(entry, name)),
    )
  const namesSet = (name: string) =>
    pictures.some((slot) => {
      const named = slotSet(slot.brief)
      return named !== null && nameMatches(named, name)
    })

  const usedPeople = photographed.filter(namesPerson).length
  const usedSets = platedSets.filter(namesSet).length

  // The headline first, and only when NOTHING is used: one line that explains
  // a whole board of plain stills, before the per-reference notes below.
  if (usedPeople === 0 && usedSets === 0) {
    const held = [
      photographed.length > 0
        ? `${photographed.length} photographed cast member${photographed.length === 1 ? '' : 's'}`
        : null,
      platedSets.length > 0
        ? `${platedSets.length} photographed set${platedSets.length === 1 ? '' : 's'}`
        : null,
    ].filter((part): part is string => part !== null)
    warnings.push(
      `none of the ${pictures.length} picture briefs names a reference, so every one is ` +
        `generated without your ${held.join(' or ')}`,
    )
  }

  for (const name of photographed) {
    if (!namesPerson(name)) {
      warnings.push(`no brief depicts ${name}, so their photographs are never sent`)
    }
  }
  for (const name of platedSets) {
    if (!namesSet(name)) {
      warnings.push(`no brief names the set "${name}", so its plates are never sent`)
    }
  }

  return warnings
}

// ---------------------------------------------------------------------------
// Graded findings (decision 271)
// ---------------------------------------------------------------------------

export type CraftFindingKind =
  'size-run' | 'motif-repeat' | 'set-run' | 'ignored-person' | 'ignored-set'

/**
 * Who may spend on fixing a finding. `auto`: the automatic repair after each
 * chapter is planned, and the Fix button. `manual`: only the Fix button,
 * because the fix is real but not clearly better unasked (it turns a free
 * slot into a paid still, or puts a real person on screen from a description
 * alone).
 */
export type RepairLevel = 'auto' | 'manual'

export interface CraftFinding {
  kind: CraftFindingKind
  /** Index into the slots passed in. */
  slotIndex: number
  /** What the producer reads, and what the repair call is told. */
  message: string
  repair: RepairLevel
}

export interface FindingContext {
  motifs: readonly string[]
  /** The book's era-lock `rules` strings, taken out before a motif is looked for. */
  eraLocks: readonly string[]
  /** Every cast member; `photographed` means at least one photograph is held. */
  cast: readonly { name: string; photographed: boolean }[]
  /** Every set the film holds, by name. */
  sets: readonly string[]
}

const LIKENESS_TYPES = new Set(['still', 'hero'])

/**
 * What a craft check needs to know about the film, read from the book, the
 * cast and the sets. One function so the automatic pass, the board and the
 * Fix button cannot read different motifs or era locks.
 *
 * A cast member the book depicts other than by likeness (archival-only or
 * anonymous) is left out of the cast the checks read. "Archival-only" is the
 * producer's legal call, and a finding that asks the repair to show that
 * person argues against it. A member with no principal entry is kept.
 */
export function findingContext(input: {
  direction:
    | (Pick<DirectorsBook, 'motifs' | 'eraLocks'> & {
        principals?: readonly { name: string; depiction: string }[]
      })
    | null
  cast: readonly { name: string; photographed: boolean }[]
  sets: readonly { name: string }[]
}): FindingContext {
  const principals = input.direction?.principals ?? []
  return {
    motifs: input.direction?.motifs ?? [],
    eraLocks: input.direction?.eraLocks.map((lock) => lock.rules) ?? [],
    cast: input.cast.filter(
      (member) =>
        !principals.some(
          (principal) =>
            principal.depiction !== 'likeness' && nameMatches(principal.name, member.name),
        ),
    ),
    sets: input.sets.map((set) => set.name),
  }
}

/**
 * Whether a repair may turn this slot into a generated still: a stock slot
 * whose sentence names a person or a set it cannot show. One predicate, so
 * the button's "N become stills" and the job's permission are the same rule.
 */
export function mayBecomeStill(
  brief: Pick<FindingBrief, 'type'>,
  findings: readonly Pick<CraftFinding, 'kind'>[],
): boolean {
  return (
    brief.type === 'stock' &&
    findings.some((finding) => finding.kind === 'ignored-person' || finding.kind === 'ignored-set')
  )
}

/** "A", "A or B", "A, B or C". */
function orList(names: readonly string[]): string {
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]!}`
}

/**
 * The problems in a plan a repair can act on, one finding per problem per
 * slot, graded by who may spend on fixing it. It shares its predicates with
 * `planWarnings` (`motifPattern`, `motifText`, `slotSet`, `sentencePlacesIn`),
 * so the plan screen and the repair agree about what is wrong.
 *
 * Only picture briefs are ever flagged. A chart, map, headline or graphic
 * carries claim references that are validated elsewhere, and a repair has no
 * business rewriting them.
 */
export function craftFindings(
  slots: readonly FindingSlot[],
  context: FindingContext,
): CraftFinding[] {
  const findings: CraftFinding[] = []

  // Size runs: the photograph that makes a third in a row at one size, by
  // `runSize`, the rule the plan-screen note uses. The count restarts after a
  // flagged slot, because repairing it breaks the run there. A linked slot
  // cannot be repaired, so a run that reaches three on one is carried on and
  // the next slot of that size, which can be, is flagged instead.
  let run = 0
  let size: string | undefined
  for (const [index, { brief, linked }] of slots.entries()) {
    const here = runSize(brief)
    if (here === undefined) {
      run = 0
      size = undefined
      continue
    }
    run = here === size ? run + 1 : 1
    size = here
    if (run >= 3 && !linked) {
      const nth = ['third', 'fourth', 'fifth'][run - 3] ?? `${run}th`
      run = 0
      findings.push({
        kind: 'size-run',
        slotIndex: index,
        repair: 'auto',
        message: `this is the ${nth} "${here}" shot in a row; use a different shot size`,
      })
    }
  }

  // Motifs: every use after the first in a chapter, and the second of two
  // adjacent uses wherever they fall. Era-lock text is taken out first.
  const texts = slots.map((slot) => motifText(slot.brief, context.eraLocks))
  for (const motif of context.motifs) {
    const pattern = motifPattern(motif)
    if (!pattern) continue
    const usedIn = new Set<string>()
    let previous = -2
    for (const [index, slot] of slots.entries()) {
      const text = texts[index]
      if (text === null || text === undefined || !pattern.test(text)) continue
      const chapter = slot.chapter ?? ''
      const adjacent = previous === index - 1
      if (usedIn.has(chapter) || adjacent) {
        findings.push({
          kind: 'motif-repeat',
          slotIndex: index,
          repair: 'auto',
          message:
            `the motif "${motif}" is already used ` +
            `${adjacent ? 'in the slot before' : 'earlier in this chapter'}; ` +
            'show what the sentence says instead',
        })
      }
      usedIn.add(chapter)
      previous = index
    }
  }

  // Set runs: two adjacent shots in one room, unless the sentence puts this
  // one there (the ignored-set rule below would ask for exactly that room).
  for (let index = 1; index < slots.length; index += 1) {
    const brief = slots[index]!.brief
    const here = slotSet(brief)
    if (here && here === slotSet(slots[index - 1]!.brief) && !sentencePlacesIn(brief, here)) {
      findings.push({
        kind: 'set-run',
        slotIndex: index,
        repair: 'auto',
        message:
          `the shot before is also in "${here}" and this sentence does not put us there; ` +
          'set it where its sentence is, or in no set',
      })
    }
  }

  // People and rooms the sentence names but the shot leaves out.
  for (const [index, { brief }] of slots.entries()) {
    const likeness = LIKENESS_TYPES.has(brief.type)
    if (!likeness && brief.type !== 'stock') continue

    for (const member of context.cast) {
      // The surname matches WITH case, as the cast spells it. Surnames such
      // as Jobs, Lay, Gates, Cook and Page are ordinary lower-case words in a
      // money documentary, and automatic repair acts only where the problem
      // is unambiguous. Set key nouns stay case-insensitive.
      const surname = surnameOf(member.name)
      if (
        surname === undefined ||
        !containsPhrase(brief.coversText, surname, { caseSensitive: true })
      ) {
        continue
      }
      const shown =
        likeness && (brief.depicts ?? []).some((entry) => nameMatches(entry, member.name))
      if (shown) continue
      findings.push(
        !likeness
          ? {
              kind: 'ignored-person',
              slotIndex: index,
              repair: 'manual',
              message:
                `${member.name} is named here but the shot is stock; ` +
                `fixing makes it a generated still of ${member.name}`,
            }
          : member.photographed
            ? {
                kind: 'ignored-person',
                slotIndex: index,
                repair: 'auto',
                message:
                  `${member.name} is named here and photographed, but the shot does not ` +
                  `show ${member.name}; show ${member.name} and list the name in "depicts"`,
              }
            : {
                kind: 'ignored-person',
                slotIndex: index,
                repair: 'manual',
                message:
                  `${member.name} is named here but not shown; fixing puts ${member.name} ` +
                  'on screen from a description, with no photograph',
              },
      )
    }

    // Every held set the sentence could mean: two rooms can share a key noun
    // ("Stability AI Boardroom", "Coatue Boardroom"), and a shot in either
    // is in the sentence's room. One finding per slot, naming them all.
    const placed = context.sets.filter((name) => sentencePlacesIn(brief, name))
    if (placed.length > 0) {
      const named = slotSet(brief)
      const inOne =
        likeness && named !== null && placed.some((name) => nameMatches(named, name))
      if (!inOne) {
        const only = placed.length === 1 ? placed[0]! : null
        const where = orList(placed)
        const target = only === null ? 'one of them' : `"${only}"`
        findings.push(
          likeness
            ? {
                kind: 'ignored-set',
                slotIndex: index,
                repair: 'auto',
                message:
                  `the sentence is in ${where}, but the shot ` +
                  `${named === null ? 'names no set' : `is set in "${named}"`}; set it in ${target}`,
              }
            : {
                kind: 'ignored-set',
                slotIndex: index,
                repair: 'manual',
                message:
                  `the sentence is in ${where} but the shot is stock; ` +
                  `fixing makes it a generated still set in ${target}`,
              },
        )
      }
    }
  }

  // A linked slot carries no finding (see `FindingSlot.linked`); it has been
  // counted above for the runs its picture takes part in.
  return findings
    .filter((finding) => slots[finding.slotIndex]?.linked !== true)
    .sort((a, b) => a.slotIndex - b.slotIndex)
}

export interface RepairTarget {
  slotIndex: number
  findings: CraftFinding[]
}

/**
 * The slots a repair rewrites: each once, carrying every finding of the given
 * levels, in slot order. Once per slot matters: the repair answers one brief
 * per target, in order, so a slot sent twice would put one answer on the
 * wrong slot.
 */
export function repairTargets(
  findings: readonly CraftFinding[],
  levels: readonly RepairLevel[],
): RepairTarget[] {
  const bySlot = new Map<number, CraftFinding[]>()
  for (const finding of findings) {
    if (!levels.includes(finding.repair)) continue
    bySlot.set(finding.slotIndex, [...(bySlot.get(finding.slotIndex) ?? []), finding])
  }
  return [...bySlot.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slotIndex, group]) => ({ slotIndex, findings: group }))
}

export interface RepairSummary {
  /** Distinct slots the Fix button would rewrite. */
  slots: number
  /** How many of them are stock slots whose fix makes them a generated, paid still. */
  becomeStills: number
  /** Distinct chapters among them: the button spends one call per chapter. */
  chapters: number
}

/** What the Fix button would do, for its label and its confirm step. */
export function repairSummary(
  slots: readonly FindingSlot[],
  findings: readonly CraftFinding[],
): RepairSummary {
  const targets = repairTargets(findings, ['auto', 'manual'])
  return {
    slots: targets.length,
    becomeStills: targets.filter((target) => {
      const slot = slots[target.slotIndex]
      return slot !== undefined && mayBecomeStill(slot.brief, target.findings)
    }).length,
    chapters: new Set(targets.map((target) => slots[target.slotIndex]?.chapter ?? '')).size,
  }
}
