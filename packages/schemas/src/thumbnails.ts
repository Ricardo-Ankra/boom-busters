import { z } from 'zod'
import { depictedMembers, nameMatches } from './cast'
import { UlidSchema } from './ids'

// ---------------------------------------------------------------------------
// Constants (spec 2026-11-24, generated thumbnails and title sets)
// ---------------------------------------------------------------------------

export const THUMB_WIDTH = 1920
export const THUMB_HEIGHT = 1080
export const THUMB_JPEG_QUALITY = 90
export const PACKAGES_MAX = 3
export const HEADLINE_WORDS_MAX = 4
export const HEADLINE_MIN_PX = 120
export const HEADLINE_CONTRAST_MIN = 4.5
export const THUMB_MARK_HEIGHT_RATIO = 0.12
export const THUMB_MARK_ALPHA = 1
/** The share of the frame, from the left and from the top, the player's overlays leave free. */
export const THUMB_KEEP_OUT = { left: 0.78, top: 0.84 } as const
export const THUMB_REFERENCES_MAX = 6
export const THUMB_REFERENCES_IN_USE_MAX = 3
export const WINS_MIN_TESTS = 5

export const THUMBNAIL_IDEAS = ['person', 'figure', 'object', 'moment', 'contrast'] as const
export type ThumbnailIdea = (typeof THUMBNAIL_IDEAS)[number]

export const IDEA_LABELS: Record<ThumbnailIdea, string> = {
  person: 'Person',
  figure: 'Figure',
  object: 'Object',
  moment: 'Moment',
  contrast: 'Contrast',
}

/**
 * Where the channel mark sits on a thumbnail; never bottom right, where the
 * duration badge sits. `tl` and `tr` both mean the top corner on the headline's
 * side: the page picks the corner from the text side. Both values are kept so
 * stored settings and deployed code keep reading each other.
 */
export const THUMB_MARK_PLACEMENTS = ['none', 'tl', 'tr', 'bl'] as const
export type ThumbMarkPlacement = (typeof THUMB_MARK_PLACEMENTS)[number]

export const PACKAGE_STATES = ['planned', 'painting', 'ready', 'failed'] as const
export type PackageState = (typeof PACKAGE_STATES)[number]

/** A planned or painting package untouched for this long is a lost run, not work in progress. */
export const PACKAGE_STALE_MS = 15 * 60_000

/** True while a run may still be working on the package: planned or painting, and touched recently. */
export function packageInFlight(row: { state: string; updatedAt: Date }, now: Date): boolean {
  return (
    (row.state === 'planned' || row.state === 'painting') &&
    now.getTime() - row.updatedAt.getTime() <= PACKAGE_STALE_MS
  )
}

/**
 * True while a Generate claim is fresh: a set was requested and its plan has
 * not landed, so no package row exists yet. A claim older than
 * `PACKAGE_STALE_MS` is a run that died.
 */
export function setBeingPlanned(requestedAtIso: string | undefined, now: Date): boolean {
  return (
    requestedAtIso !== undefined && now.getTime() - Date.parse(requestedAtIso) <= PACKAGE_STALE_MS
  )
}

export const TEST_RESULTS = ['won', 'lost', 'same', 'inconclusive'] as const
export type TestResult = (typeof TEST_RESULTS)[number]

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** The longest a picture's subject, its framing, and the list of cast members it shows can be. */
export const PICTURE_SUBJECT_MAX = 400
export const PICTURE_FRAMING_MAX = 400
export const PICTURE_DEPICTS_MAX = 5

export const PictureBriefSchema = z.object({
  subject: z.string().trim().min(1).max(PICTURE_SUBJECT_MAX),
  framing: z.string().trim().max(PICTURE_FRAMING_MAX).default(''),
  textSide: z.enum(['left', 'right']),
  stillSlotIds: z.array(z.string()).max(6).default([]),
  depicts: z.array(z.string()).max(PICTURE_DEPICTS_MAX).default([]),
})
export type PictureBrief = z.infer<typeof PictureBriefSchema>

export const PlannedPackageSchema = z.object({
  idea: z.enum(THUMBNAIL_IDEAS),
  angle: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(100),
  headline: z.string().trim().max(60),
  picture: PictureBriefSchema,
  claimIds: z.array(z.string()).min(1),
})
export type PlannedPackage = z.infer<typeof PlannedPackageSchema>

export const ThumbnailReferenceSchema = z.object({
  id: UlidSchema,
  r2Key: z.string().min(1),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  note: z.string().trim().max(200).default(''),
  inUse: z.boolean().default(false),
})
export type ThumbnailReference = z.infer<typeof ThumbnailReferenceSchema>

export const ThumbnailSettingsSchema = z
  .object({
    styleNote: z.string().trim().max(600).default(''),
    markPlacement: z.enum(THUMB_MARK_PLACEMENTS).default('tl'),
    references: z.array(ThumbnailReferenceSchema).max(THUMB_REFERENCES_MAX).default([]),
  })
  .refine(
    (value) => value.references.filter((ref) => ref.inUse).length <= THUMB_REFERENCES_IN_USE_MAX,
    { message: 'At most three reference thumbnails can be in use.', path: ['references'] },
  )
export type ThumbnailSettings = z.infer<typeof ThumbnailSettingsSchema>

/** The longest note the owner can write to ask for a change to a picture. */
export const PICTURE_CHANGE_MAX = 300

/** The longest highlight the owner can name: a run of the headline's words. */
export const HIGHLIGHT_MAX = 60

export const ThumbnailSetRequestedSchema = z
  .object({
    projectId: UlidSchema,
    targetId: UlidSchema,
    mode: z.enum(['set', 'paint', 'compose', 'change']),
    packageId: UlidSchema.optional(),
    /** A change: what the owner asked for. Present exactly when the mode is `change`. */
    note: z.string().trim().min(1).max(PICTURE_CHANGE_MAX).optional(),
    /** The picture a change starts from, or a paint's pick of one (null: none). Never on set or compose. */
    baseKey: z.string().min(1).nullable().optional(),
    /** A set run: the stamp of the claim it was sent under. Absent on events sent before it existed. */
    requestedAt: z.string().datetime().optional(),
  })
  .refine((value) => value.mode === 'set' || value.packageId !== undefined, {
    message: 'A request for one package needs its id.',
    path: ['packageId'],
  })
  .refine((value) => (value.mode === 'change') === (value.note !== undefined), {
    message: 'A note goes with a change, and only a change.',
    path: ['note'],
  })
  .refine(
    (value) =>
      value.mode === 'change'
        ? typeof value.baseKey === 'string'
        : value.mode === 'paint' || value.baseKey === undefined,
    {
      message: 'A change needs its base key; only a paint may carry one otherwise.',
      path: ['baseKey'],
    },
  )
export type ThumbnailSetRequested = z.infer<typeof ThumbnailSetRequestedSchema>

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function headlineWords(headline: string): number {
  const trimmed = headline.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
}

/** A word's key: lower-cased, stripped at both ends of all but letters and digits; a word that strips to nothing keeps itself. */
function wordKey(word: string): string {
  const lower = word.toLowerCase()
  const stripped = lower.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')
  return stripped.length > 0 ? stripped : lower
}

/**
 * Where a highlight sits in a headline: the first run of neighbouring whole words
 * that equals the highlight's words, or null when there is none. The text is
 * returned as the headline writes it, split into what comes before, the hit and
 * what comes after, with single spaces between words.
 */
export function headlineHighlight(
  headline: string,
  highlight: string,
): { before: string; hit: string; after: string } | null {
  const words = headline.trim().split(/\s+/).filter(Boolean)
  const wanted = highlight.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || wanted.length === 0 || wanted.length > words.length) return null

  const keys = words.map(wordKey)
  const wantedKeys = wanted.map(wordKey)
  for (let start = 0; start + wantedKeys.length <= words.length; start++) {
    if (wantedKeys.every((key, offset) => keys[start + offset] === key)) {
      const end = start + wantedKeys.length
      const before = words.slice(0, start).join(' ')
      const after = words.slice(end).join(' ')
      return {
        before: before === '' ? '' : `${before} `,
        hit: words.slice(start, end).join(' '),
        after: after === '' ? '' : ` ${after}`,
      }
    }
  }
  return null
}

/** Every number in a text, commas removed, so "47,000" and "47000" are one figure. */
export function figuresIn(text: string): string[] {
  const runs = text.match(/\d[\d,.]*\d|\d/g) ?? []
  return runs.map((run) => run.replace(/,/g, '').replace(/\.$/, ''))
}

export type VetInput = {
  packages: PlannedPackage[]
  /** Not dismissed. */
  cast: { name: string }[]
  /** Removed from the cast: never to be described. */
  dismissed?: { name: string }[]
  /** Verified. */
  claims: { id: string; text: string }[]
  stills: { slotId: string; depicts: string[] }[]
  heldIdeas: ThumbnailIdea[]
  places: number
}

export type VetResult = {
  kept: PlannedPackage[]
  dropped: { idea: ThumbnailIdea; reason: string }[]
}

function firstFailure(
  candidate: PlannedPackage,
  input: VetInput,
  taken: ReadonlySet<ThumbnailIdea>,
): string | null {
  if (taken.has(candidate.idea)) return `The ${candidate.idea} idea is already in the set.`

  const claimText: string[] = []
  for (const id of candidate.claimIds) {
    const claim = input.claims.find((c) => c.id === id)
    if (!claim) return `Claim ${id} is not a verified claim of this film.`
    claimText.push(claim.text)
  }

  const held = new Set(figuresIn(claimText.join(' ')))
  for (const figure of new Set([...figuresIn(candidate.title), ...figuresIn(candidate.headline)])) {
    if (!held.has(figure)) return `The figure ${figure} is in no cited claim.`
  }

  if (headlineWords(candidate.headline) > HEADLINE_WORDS_MAX) {
    return `The headline is longer than ${HEADLINE_WORDS_MAX} words.`
  }

  const named: { slotId: string; depicts: string[] }[] = []
  for (const slotId of candidate.picture.stillSlotIds) {
    const still = input.stills.find((s) => s.slotId === slotId)
    if (!still) return `Still ${slotId} is not a still of this film.`
    named.push(still)
  }

  for (const entry of candidate.picture.depicts) {
    if (!input.cast.some((member) => nameMatches(entry, member.name))) {
      return `${entry} is not in the cast.`
    }
  }

  for (const member of depictedMembers(candidate.picture.depicts, input.cast)) {
    const shown = named.some((still) => depictedMembers(still.depicts, [member]).length > 0)
    if (!shown) return `No named still shows ${member.name}.`
  }

  // The subject and framing go to the image model word for word, so a cast
  // member named there but not listed as shown would escape the likeness rules.
  const listed = depictedMembers(candidate.picture.depicts, input.cast)
  const described = `${candidate.picture.subject} ${candidate.picture.framing}`
  for (const member of input.cast) {
    if (listed.includes(member)) continue
    if (namesWholeName(described, member.name)) {
      return `${member.name} is described in the picture but is not listed as shown.`
    }
  }
  for (const entry of input.dismissed ?? []) {
    if (isCastSpelling(entry.name, input.cast)) continue
    if (namesWholeName(described, entry.name)) {
      return `${entry.name} is described in the picture but was removed from the cast.`
    }
  }

  if (candidate.idea === 'person' && candidate.picture.depicts.length === 0) {
    return 'A person package must show someone from the cast.'
  }

  return null
}

/** Back in the cast, or a shorter spelling of someone who is: the cast rules own them, not the dismissed rule. */
function isCastSpelling(name: string, cast: { name: string }[]): boolean {
  return cast.some((member) => nameMatches(name, member.name) || namesWholeName(member.name, name))
}

/**
 * Why an owner's note asking for a change to a picture cannot go ahead, or null.
 * `cast` is not dismissed; `depicts` is who the picture shows.
 */
export function changeNoteIssue(input: {
  note: string
  depicts: string[]
  cast: { name: string }[]
  dismissed?: { name: string }[]
}): string | null {
  const note = input.note.trim()
  if (note.length === 0) return 'Write what to change.'
  if (note.length > PICTURE_CHANGE_MAX) {
    return `A change is at most ${PICTURE_CHANGE_MAX} characters.`
  }
  const shown = depictedMembers(input.depicts, input.cast)
  for (const member of input.cast) {
    if (shown.includes(member)) continue
    if (namesWholeName(note, member.name)) {
      return `${member.name} is not shown in this picture. A change cannot add a person.`
    }
  }
  const removed = dismissedNamed(note, input.cast, input.dismissed ?? [])
  if (removed !== null) return `${removed} was removed from the cast.`
  return null
}

/**
 * The first person removed from the cast that a text names, or null. Someone
 * back in the cast, or a shorter spelling of someone who is, is left to the
 * cast's own rules.
 */
export function dismissedNamed(
  text: string,
  cast: { name: string }[],
  dismissed: { name: string }[],
): string | null {
  for (const entry of dismissed) {
    if (isCastSpelling(entry.name, cast)) continue
    if (namesWholeName(text, entry.name)) return entry.name
  }
  return null
}

/**
 * Who a picture brief written by the owner shows, and why it cannot be
 * painted, or null. `cast` is not dismissed. A member is shown when the
 * subject or the framing holds their full name as whole words; a surname
 * alone names nobody. `shown` is the cast's own spelling, in cast order,
 * and is never cut, so the card can say who was named even when that is
 * too many.
 */
export function ownerBrief(input: {
  subject: string
  framing: string
  cast: { name: string; hasPortrait: boolean }[]
  dismissed?: { name: string }[]
}): { shown: string[]; issue: string | null } {
  const subject = input.subject.trim()
  const framing = input.framing.trim()
  const text = `${subject} ${framing}`
  const members = input.cast.filter((member) => namesWholeName(text, member.name))
  const shown = members.map((member) => member.name)

  const issue = (): string | null => {
    if (subject.length === 0) return 'Write what the picture shows.'
    if (subject.length > PICTURE_SUBJECT_MAX) {
      return `The picture is at most ${PICTURE_SUBJECT_MAX} characters.`
    }
    if (framing.length > PICTURE_FRAMING_MAX) {
      return `The framing is at most ${PICTURE_FRAMING_MAX} characters.`
    }
    const removed = dismissedNamed(text, input.cast, input.dismissed ?? [])
    if (removed !== null) return `${removed} was removed from the cast.`
    if (members.length > PICTURE_DEPICTS_MAX) {
      return `A picture shows at most ${PICTURE_DEPICTS_MAX} people from the cast.`
    }
    const faceless = members.find((member) => !member.hasPortrait)
    if (faceless) return `${faceless.name} has no portrait. Add one on the Cast card first.`
    return null
  }

  return { shown, issue: issue() }
}

/** Whether a text holds a full name as whole words, ignoring case and spacing. */
function namesWholeName(text: string, name: string): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return false
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

/**
 * What the channel's finished tests say, for the set planner: one sentence per
 * tested idea, most tested first (ties in the order of `THUMBNAIL_IDEAS`).
 * Null until `WINS_MIN_TESTS` tests have a winner. Tests that ended the same
 * or inconclusive are never mentioned.
 */
export function whatHasWon(
  results: { idea: ThumbnailIdea; tests: number; wins: number }[],
  withWinner: number,
): string | null {
  if (withWinner < WINS_MIN_TESTS) return null
  const order = (idea: ThumbnailIdea) => THUMBNAIL_IDEAS.indexOf(idea)
  const text = results
    .filter((row) => row.tests > 0)
    .sort((a, b) => b.tests - a.tests || order(a.idea) - order(b.idea))
    .map(
      (row) =>
        `${IDEA_LABELS[row.idea]}: won ${row.wins} of ${row.tests} ${row.tests === 1 ? 'test' : 'tests'}.`,
    )
    .join(' ')
  // Winners recorded, but none on an idea (left unlabelled): nothing to tell.
  return text === '' ? null : text
}

/**
 * The package that will be the default once the set is approved: the first, in
 * position order, among those already approved with an image and those
 * `Approve this set` would take (ready, with an image, not yet approved).
 * Null when none can go up.
 */
export function upcomingDefaultId(
  packages: readonly {
    id: string
    position: number
    state: string
    approved: boolean
    hasImage: boolean
  }[],
): string | null {
  const first = [...packages]
    .filter((pack) => pack.hasImage && (pack.approved || pack.state === 'ready'))
    .sort((a, b) => a.position - b.position)[0]
  return first?.id ?? null
}

/** The planner's packages that survive every rule, cut to the free places. */
export function vetPlannedPackages(input: VetInput): VetResult {
  const kept: PlannedPackage[] = []
  const dropped: VetResult['dropped'] = []
  const taken = new Set<ThumbnailIdea>(input.heldIdeas)
  for (const candidate of input.packages) {
    const reason = firstFailure(candidate, input, taken)
    if (reason !== null) {
      dropped.push({ idea: candidate.idea, reason })
      continue
    }
    kept.push(candidate)
    taken.add(candidate.idea)
  }
  return { kept: kept.slice(0, Math.max(0, input.places)), dropped }
}
