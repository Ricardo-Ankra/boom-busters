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
export const THUMB_MARK_HEIGHT_RATIO = 0.08
export const THUMB_MARK_ALPHA = 0.8
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

/** Where the channel mark sits on a thumbnail; never bottom right, where the duration badge sits. */
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

export const PictureBriefSchema = z.object({
  subject: z.string().trim().min(1).max(400),
  framing: z.string().trim().max(400).default(''),
  textSide: z.enum(['left', 'right']),
  stillSlotIds: z.array(z.string()).max(6).default([]),
  depicts: z.array(z.string()).max(5).default([]),
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

export const ThumbnailSetRequestedSchema = z
  .object({
    projectId: UlidSchema,
    targetId: UlidSchema,
    mode: z.enum(['set', 'paint', 'compose']),
    packageId: UlidSchema.optional(),
  })
  .refine((value) => value.mode === 'set' || value.packageId !== undefined, {
    message: 'A request for one package needs its id.',
    path: ['packageId'],
  })
export type ThumbnailSetRequested = z.infer<typeof ThumbnailSetRequestedSchema>

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function headlineWords(headline: string): number {
  const trimmed = headline.trim()
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
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

  if (candidate.idea === 'person' && candidate.picture.depicts.length === 0) {
    return 'A person package must show someone from the cast.'
  }

  return null
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
