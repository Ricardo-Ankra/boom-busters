import { z } from 'zod'
import { UlidSchema } from './ids'

/**
 * The visuals stage's shared vocabulary (build spec sections 5 and 7.4;
 * product spec section "Stage 5: Visual Plan").
 *
 * The load-bearing idea: **a slot is a full creative brief, not a keyword.**
 * The shot-list model writes the brief, the adapters fetch against it, the
 * scoring pass judges candidates against it, and the board shows it — so its
 * shape has to be agreed on once, here, as a discriminated union per slot
 * type. A brief that parses is a brief every stage downstream can act on.
 *
 * Two rules are enforced at the schema level rather than by prompt etiquette:
 *
 *  - **A chart brief REQUIRES claim refs.** Charts are sourced, never
 *    invented (product spec: "the exact data series with values and units
 *    pulled from the dossier"). A chart with no `dataRefs` fails validation,
 *    which the runner surfaces as a `ValidationError` — and the board renders
 *    an error card, never a chart.
 *  - **`hero` slots are typed but feature-flagged off.** The schema, brief
 *    type and UI badge exist so the flag is a switch rather than a project;
 *    no video-generation adapter is built until post-monetisation (spec
 *    section 5, shot_slots).
 */

// ---------------------------------------------------------------------------
// Types and statuses (mirror the pg enums in `packages/db`)
// ---------------------------------------------------------------------------

export const SHOT_SLOT_TYPES = [
  'stock',
  'archival',
  'still',
  'chart',
  'map',
  'headline',
  'hero',
] as const
export const ShotSlotTypeSchema = z.enum(SHOT_SLOT_TYPES)
export type ShotSlotType = z.infer<typeof ShotSlotTypeSchema>

/** The slot types that may reuse a shot or be reused (decision 261): pictures, never data. */
export const REUSABLE_SLOT_TYPES: readonly ShotSlotType[] = ['stock', 'still', 'archival']

export const SHOT_SLOT_STATUSES = ['unresolved', 'resolved', 'placeholder'] as const
export const ShotSlotStatusSchema = z.enum(SHOT_SLOT_STATUSES)
export type ShotSlotStatus = z.infer<typeof ShotSlotStatusSchema>

/**
 * AI-video slots stay off until the flag flips post-monetisation. The
 * shot-list prompt reads this to decide whether `hero` may be emitted, and
 * the board reads it to caption the badge — one constant, so the prompt and
 * the UI can never disagree about whether the feature exists.
 */
export const HERO_SLOTS_ENABLED = false

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * How a still or clip moves on screen, as the brief specifies it. Deliberately
 * simpler than M6's timeline `motion` (kenburns/static/draw-on/camera-path):
 * this is creative direction the timeline compiler maps onto real
 * interpolation params, not the params themselves.
 */
export const MotionSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static') }),
  z.object({
    kind: z.literal('kenburns'),
    direction: z.enum(['in', 'out']),
    speed: z.enum(['slow', 'medium', 'fast']),
  }),
  z.object({
    kind: z.literal('pan'),
    /** Plain-English path: "left to right across the trading floor". */
    path: z.string().min(1),
  }),
])
export type MotionSpec = z.infer<typeof MotionSpecSchema>

export const TRANSITIONS = ['cut', 'dissolve'] as const
export const TransitionSchema = z.enum(TRANSITIONS)
export type Transition = z.infer<typeof TransitionSchema>

// ---------------------------------------------------------------------------
// Briefs — the discriminated union
// ---------------------------------------------------------------------------

/**
 * Common to every slot type (product spec: "the script sentence(s) it covers,
 * on-screen duration, a detailed visual description, motion spec, and
 * transition"). Duration lives on the slot row (startMs/durationMs), not in
 * the brief: the brief says what to show, the timing comes from narration.
 */
/** The shot sizes the bible names (decision 252). `graphic` is charts and maps. */
export const SHOT_SIZES = ['wide', 'medium', 'close', 'macro', 'aerial', 'graphic'] as const
export const ShotSizeSchema = z.enum(SHOT_SIZES)
export type ShotSize = z.infer<typeof ShotSizeSchema>

const briefCommon = {
  /** The script sentence(s) this slot covers, verbatim. */
  coversText: z.string().min(1),
  /** Subject, composition, era, mood, lighting/colour grade. */
  description: z.string().min(1),
  motion: MotionSpecSchema,
  transition: TransitionSchema,
  /** Optional so rows planned before decision 252 keep parsing. */
  shotSize: ShotSizeSchema.optional(),
}

export const StockBriefSchema = z.object({
  type: z.literal('stock'),
  ...briefCommon,
  /** The literal search query sent to the stock APIs. */
  query: z.string().min(1),
  /** "no watermarks", "no modern tech in a 1990s segment", … */
  rejectionCriteria: z.array(z.string().min(1)),
})
export type StockBrief = z.infer<typeof StockBriefSchema>

export const ArchivalBriefSchema = z.object({
  type: z.literal('archival'),
  ...briefCommon,
  /** The literal search query sent to the archival source. */
  query: z.string().min(1),
  /** What the photo must actually show to be usable. */
  mustShow: z.string().min(1),
  /** Acceptable era, plain English: "1990–1995", "pre-war". */
  eraRange: z.string().min(1).optional(),
})
export type ArchivalBrief = z.infer<typeof ArchivalBriefSchema>

export const StillBriefSchema = z.object({
  type: z.literal('still'),
  ...briefCommon,
  /** The complete generation prompt, style anchors included. */
  prompt: z.string().min(1),
  negativePrompt: z.string().min(1).optional(),
  /** Real people shown by likeness, full names. Drives the label and the refusal fallback (decision 252). */
  depicts: z.array(z.string().min(1)).optional(),
  /**
   * The set this shot happens in, by exact name (decision 264). Its plates
   * ride along with the prompt, so the same room is the same room in every
   * shot of it. A name the project does not hold generates as a plain
   * still and is noted on the plan screen.
   */
  set: z.string().min(1).optional(),
})
export type StillBrief = z.infer<typeof StillBriefSchema>

export const CHART_KINDS = ['line', 'area', 'bar', 'stacked', 'waterfall'] as const
export const ChartKindSchema = z.enum(CHART_KINDS)
export type ChartKind = z.infer<typeof ChartKindSchema>

export const ChartPointSchema = z.object({
  /** X value as a label — a date, a year, a quarter. Charts here are categorical or temporal, never scatter. */
  x: z.string().min(1),
  y: z.number(),
})

export const ChartSeriesSchema = z.object({
  label: z.string().min(1),
  /**
   * Which vertical scale this series is drawn against (decision 259).
   *
   * Optional, and almost always absent: series measured in the same thing
   * share one scale, which is what makes them comparable. It exists for the
   * chart that puts two different measures side by side — a valuation in
   * billions against a margin in percent — where a single shared scale
   * flattens the smaller one onto the floor and labels it with the other
   * one's unit. Omitted, the layout infers the split from the units rather
   * than drawing a chart that misleads.
   */
  axis: z.enum(['left', 'right']).optional(),
  /**
   * "USD", "USD Millions", "€bn", "%". Not an axis caption: the renderer folds
   * it into every figure it writes, so a series of 4000 in "USD Millions"
   * reads "$4 Billion" on the bar (decision 254). It must exist for that.
   */
  unit: z.string().min(1),
  points: z.array(ChartPointSchema).min(2, 'a chart series needs at least two points'),
})
export type ChartSeries = z.infer<typeof ChartSeriesSchema>

export const ChartBriefSchema = z.object({
  type: z.literal('chart'),
  ...briefCommon,
  chartKind: ChartKindSchema,
  series: z.array(ChartSeriesSchema).min(1),
  /**
   * The claim IDs this chart's numbers come from. Non-optional and non-empty
   * BY SCHEMA: build spec section 7.4 — "a chart brief without claim refs is
   * a ValidationError". This is the anti-slop rule with teeth.
   */
  dataRefs: z.array(UlidSchema).min(1, 'a chart must cite the claims its numbers come from'),
  /** The single thing the chart must make the viewer see. */
  takeaway: z.string().min(1),
  annotations: z.array(z.object({ atX: z.string().min(1), text: z.string().min(1) })).optional(),
  reveal: z.enum(['draw-on', 'none']),
})
export type ChartBrief = z.infer<typeof ChartBriefSchema>

export const MapLocationSchema = z.object({
  label: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})
export type MapLocation = z.infer<typeof MapLocationSchema>

export const MapBriefSchema = z.object({
  type: z.literal('map'),
  ...briefCommon,
  locations: z.array(MapLocationSchema).min(1).max(8),
  /** Draw the route through `locations` in order (money flows, HQ hops). */
  route: z.boolean(),
})
export type MapBrief = z.infer<typeof MapBriefSchema>

/**
 * A real news headline on screen, in the house clipping format (decision 257).
 *
 * The brief carries NO article text. It names the claim whose source article
 * the card shows, and the app reads the outlet, headline, byline and date from
 * that article's own declared metadata. This is the same rule charts live
 * under, for a harder reason: an invented chart is a wrong number, an invented
 * headline is a false statement attributed to a real publication and a real
 * journalist.
 */
export const HeadlineBriefSchema = z.object({
  type: z.literal('headline'),
  ...briefCommon,
  /** The claim this card cites. Its `sourceUrl` is the article that gets read. */
  sourceClaimId: UlidSchema,
  /**
   * The phrase the marker draws under. Chosen after the headline is known, by
   * heuristic or by the owner; dropped rather than approximated when it is not
   * in the headline verbatim.
   */
  emphasis: z.string().trim().min(1).max(120).optional(),
  /**
   * Whether the standfirst renders. Off by default: the string publishers put
   * in `og:description` is often a truncated teaser rather than the real
   * standfirst, and the card reads well without one.
   */
  showDeck: z.boolean().optional(),
})
export type HeadlineBrief = z.infer<typeof HeadlineBriefSchema>

export const HeroBriefSchema = z.object({
  type: z.literal('hero'),
  ...briefCommon,
  /** Full text-to-video prompt. No adapter consumes this while the flag is off. */
  prompt: z.string().min(1),
  cameraMovement: z.string().min(1),
  loop: z.boolean(),
  /** Real people shown by likeness, full names (decision 252). */
  depicts: z.array(z.string().min(1)).optional(),
  /** The set this shot happens in, by exact name (decision 264). */
  set: z.string().min(1).optional(),
})
export type HeroBrief = z.infer<typeof HeroBriefSchema>

export const ShotBriefSchema = z.discriminatedUnion('type', [
  StockBriefSchema,
  ArchivalBriefSchema,
  StillBriefSchema,
  ChartBriefSchema,
  MapBriefSchema,
  HeadlineBriefSchema,
  HeroBriefSchema,
])
export type ShotBrief = z.infer<typeof ShotBriefSchema>

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export const CANDIDATE_PROVIDERS = [
  'pexels',
  'pixabay',
  'wikimedia',
  'fal',
  'google',
  'upload',
] as const
export const CandidateProviderSchema = z.enum(CANDIDATE_PROVIDERS)
export type CandidateProvider = z.infer<typeof CandidateProviderSchema>

/**
 * One fetched/generated/uploaded option for a slot, as stored in the slot's
 * `candidates` jsonb.
 *
 * Provenance vs bytes: `sourceUrl`/`pageUrl` say where it came from; `r2Key`
 * is set once the bytes live in our storage. Stock candidates are shown from
 * the provider's CDN and only pulled into R2 when chosen; generated stills
 * are stored the moment they exist, because fal's output URLs expire. The
 * canonical rule (build spec 8.2) is that anything a timeline will reference
 * must be a stable storage key — presigned and provider URLs are for the
 * board's thumbnails only.
 */
export const SlotCandidateSchema = z.object({
  /** Provider-scoped id — a Pexels photo id, a fal request id, an upload's asset id. */
  id: z.string().min(1),
  provider: CandidateProviderSchema,
  kind: z.enum(['image', 'video']),
  sourceUrl: z.string().min(1),
  /**
   * The provider's SMALL variant of the same clip (Pexels SD, Pixabay
   * small) — the browser preview's proxy. Videos only; expiring like
   * `sourceUrl`, so ingestion stores its bytes as `previewR2Key`.
   */
  previewSourceUrl: z.string().optional(),
  /** The human-facing page (attribution target), where the source has one. */
  pageUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  r2Key: z.string().optional(),
  /** Ingested bytes of `previewSourceUrl` — see `MediaRefSchema.previewR2Key`. */
  previewR2Key: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationMs: z.number().int().positive().optional(),
  /** Required. An asset whose licence nobody recorded is unusable (product spec: archival licence "to verify"). */
  licence: z.string().min(1),
  attributionText: z.string().optional(),
  /**
   * The source's own words about the asset — alt text, tags, a Commons file
   * description. This is what the scoring pass judges against the brief
   * (scoring reads metadata, not pixels), and what the board shows on hover.
   */
  summary: z.string().optional(),
  /**
   * Cast members whose reference photos conditioned this generation
   * (decision 253), by full name. Absent for text-only stills, stock and
   * uploads. The board shows it; nothing else reads it.
   */
  references: z.array(z.string().min(1)).optional(),
  /** 0–100 against the brief, from the scoring pass. Absent until scored. */
  score: z.number().min(0).max(100).optional(),
  scoreReason: z.string().optional(),
  /**
   * Whether this candidate is the slot's current choice. Lives on the
   * candidate rather than in `shot_slots.chosenAssetId` because a chosen
   * STOCK candidate has no asset row yet — bytes never stream through the
   * app layer (product-spec architecture rule), so stock is pulled into
   * storage by the render side in M6, not at choose time. `chosenAssetId`
   * is set only when the choice already has bytes in R2 (generated stills,
   * uploads) via `assetId` below.
   */
  chosen: z.boolean().optional(),
  /** The `assets` row holding this candidate's bytes, once any exist. */
  assetId: UlidSchema.optional(),
  /**
   * Where a copied candidate came from (decision 261): the slot whose shot
   * this one reuses, and the people that shot depicts, so the altered-content
   * label still counts a likeness that was reused into a stock slot.
   */
  reusedFrom: z
    .object({ slotId: UlidSchema, depicts: z.array(z.string().min(1)).optional() })
    .optional(),
})
export type SlotCandidate = z.infer<typeof SlotCandidateSchema>

/** How many candidates the board shows per slot (product spec: "top 4 scored"). */
export const CANDIDATES_SHOWN = 4

/**
 * The scoring model's output: one entry per candidate id it judged. Build
 * spec section 6 — one batched call per SLOT, never a call per candidate.
 */
export const CandidateScoresSchema = z.object({
  scores: z.array(
    z.object({
      id: z.string().min(1),
      score: z.number().min(0).max(100),
      reason: z.string().min(1),
    }),
  ),
})
export type CandidateScores = z.infer<typeof CandidateScoresSchema>

/**
 * Merge scores into candidates and order best-first. A candidate the model
 * did not score keeps no score and sorts last — visible as unscored rather
 * than silently dropped, so a model that judged half the list is a model
 * that can be caught doing it.
 */
export function applyScores(
  candidates: readonly SlotCandidate[],
  scores: CandidateScores,
): SlotCandidate[] {
  const byId = new Map(scores.scores.map((entry) => [entry.id, entry]))

  return candidates
    .map((candidate) => {
      const entry = byId.get(candidate.id)
      if (!entry) return candidate
      return { ...candidate, score: entry.score, scoreReason: entry.reason }
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
}

/** How many generations a still prompt buys per resolution pass. */
export const STILL_GENERATIONS = 2

// ---------------------------------------------------------------------------
// Re-typing (staged-visuals design, 2026-08-26)
// ---------------------------------------------------------------------------

/**
 * Mechanical re-typing between the text-driven brief types: stock, archival
 * and still all express the same idea through different creative strings, so
 * converting between them derives the target's fields from the shared
 * description. Chart, map and hero need structured data no string can
 * mechanically supply (series values, claim refs, coordinates) — those
 * return null, and the caller asks a model to draft the new brief instead.
 *
 * The derivations are deliberately plain: search queries and prompts seed
 * from the DESCRIPTION (subject, era, mood — the planner's own words), not
 * from the source type's tuned string, because a still prompt full of style
 * anchors makes a terrible stock query. The owner edits from there.
 */
export function convertBrief(
  brief: ShotBrief,
  targetType: ShotSlotType,
  options: { stillStyleAnchors?: string; headlineClaimId?: string } = {},
): ShotBrief | null {
  /**
   * A headline card moved to a DIFFERENT article is a real change even though
   * its type has not moved, so it must not take the short circuit below. Every
   * other same-type conversion is genuinely a no-op.
   */
  const repointing = targetType === 'headline' && options.headlineClaimId !== undefined
  if (targetType === brief.type && !repointing) return brief

  const common = {
    coversText: brief.coversText,
    description: brief.description,
    motion: brief.motion,
    transition: brief.transition,
  }

  switch (targetType) {
    case 'stock':
      return { type: 'stock', ...common, query: brief.description, rejectionCriteria: [] }
    case 'archival':
      return { type: 'archival', ...common, query: brief.description, mustShow: brief.description }
    case 'still': {
      const anchors = options.stillStyleAnchors?.trim()
      return {
        type: 'still',
        ...common,
        prompt: anchors ? `${brief.description}. ${anchors}` : brief.description,
      }
    }
    case 'headline': {
      /**
       * A headline card quotes ONE claim, and nothing in the old brief says
       * which. No model may choose it either (decision 257) — every string on
       * the card comes from the article behind that claim. So this conversion
       * is mechanical ONCE the owner has picked, and null until then, which is
       * what sends the board to its chooser instead of to the retyper.
       */
      const claimId = options.headlineClaimId
      if (claimId === undefined) return null
      return {
        type: 'headline',
        ...common,
        sourceClaimId: claimId,
        /**
         * Moved to another article, the card keeps how it is drawn and loses
         * what it quoted: `showDeck` is a display preference, while `emphasis`
         * names words the OLD headline printed, and a marker over words this
         * publication did not print is the thing the emphasis rule exists to
         * prevent.
         */
        ...(brief.type === 'headline' && brief.showDeck !== undefined
          ? { showDeck: brief.showDeck }
          : {}),
      }
    }
    default:
      return null
  }
}

/**
 * A model-assisted change to one slot's brief, as the row records it. It
 * lives in the `retype` column, which re-typing was simply the first thing to
 * use (decision 258 added the second).
 *
 * Mechanical conversions never store one: they finish inside the button press.
 * The drafts that need a model happen in an Inngest function seconds later, so
 * the row carries a pending state from the moment the button returns, and a
 * refusal in the model's own words when the claims cannot honestly support
 * what was asked. The board must show both, or the button reads as dead.
 *
 * One column for both jobs on purpose: a slot may only have one model rewriting
 * its brief at a time, and sharing the state is what lets each button disable
 * while the other one's work is in flight.
 */
export const SlotDraftStateSchema = z.union([
  z.object({ state: z.literal('drafting'), target: ShotSlotTypeSchema }),
  z.object({
    state: z.literal('refused'),
    target: ShotSlotTypeSchema,
    reason: z.string().min(1),
  }),
  /**
   * A new brief for the SAME format, asked for by the owner (decision 258).
   * It carries no target because nothing about the format is in question.
   */
  z.object({ state: z.literal('rebriefing') }),
  z.object({ state: z.literal('rebrief-refused'), reason: z.string().min(1) }),
])
export type SlotDraftState = z.infer<typeof SlotDraftStateSchema>

/**
 * An image model declined this slot's prompt (decision 252). Stored on the
 * row so the card can say so and offer the two ways out: redirect the scene
 * without the likeness, or upload a real image against the depiction brief.
 */
export const SlotRefusalSchema = z.object({
  reason: z.string().min(1),
  at: z.iso.datetime(),
})
export type SlotRefusal = z.infer<typeof SlotRefusalSchema>

// ---------------------------------------------------------------------------
// The shot-list model's output
// ---------------------------------------------------------------------------

/**
 * What the shot-list model emits per slot, before the runner turns it into
 * rows. Two deliberate differences from the stored brief:
 *
 *  - Slots are anchored to a **paragraph index**, not a start time. The model
 *    plans coverage against the script; real times come from the narration
 *    takes' durations, computed deterministically by the runner. Asking a
 *    language model to do millisecond arithmetic is asking for drift.
 *  - Chart `dataRefs` arrive as **claim list numbers** (`[1]`, `[2]` — the
 *    same numbering every script prompt uses), mapped back to ULIDs by the
 *    caller. Models do not reproduce 26-character ULIDs reliably, and a
 *    mistyped id would silently orphan the chart's sourcing.
 */
/**
 * The wire shape a chart brief takes inside the model's JSON: identical to
 * `ChartBriefSchema` except `dataRefs` are 1-based claim numbers into the
 * prompt's numbered claim list. `resolvePlannedBrief` converts.
 */
export const PlannedChartBriefSchema = ChartBriefSchema.omit({ dataRefs: true }).extend({
  dataRefs: z
    .array(z.number().int().min(1))
    .min(1, 'a chart must cite the claims its numbers come from'),
})
export type PlannedChartBrief = z.infer<typeof PlannedChartBriefSchema>

/**
 * The wire shape of an archival brief: `ArchivalBriefSchema`, except
 * `eraRange` also arrives as an array. Live models write a range as
 * ["1919", "2008"] about as often as "1919–2008" whatever the prompt says —
 * the first real board burned five paid retries on exactly this. An array is
 * a faithful statement of the same fact, so the wire joins it; the stored
 * schema stays a single string.
 */
export const PlannedArchivalBriefSchema = ArchivalBriefSchema.extend({
  eraRange: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .transform((value) => (Array.isArray(value) ? value.join('–') : value))
    .optional(),
})
export type PlannedArchivalBrief = z.infer<typeof PlannedArchivalBriefSchema>

/**
 * The wire shape of a headline brief: a claim NUMBER instead of a claim id,
 * for the reason charts use one, and none of the fields that can only be
 * decided once the article has been read.
 */
export const PlannedHeadlineBriefSchema = HeadlineBriefSchema.omit({
  sourceClaimId: true,
  emphasis: true,
  showDeck: true,
}).extend({
  sourceRef: z.number().int().min(1),
})
export type PlannedHeadlineBrief = z.infer<typeof PlannedHeadlineBriefSchema>

export const PlannedBriefSchema = z.discriminatedUnion('type', [
  StockBriefSchema,
  PlannedArchivalBriefSchema,
  StillBriefSchema,
  PlannedChartBriefSchema,
  MapBriefSchema,
  PlannedHeadlineBriefSchema,
  HeroBriefSchema,
])
export type PlannedBrief = z.infer<typeof PlannedBriefSchema>

export const PlannedSlotSchema = z.object({
  paragraphIndex: z.number().int().min(0),
  /** On-screen seconds the model intends; clamped to the paragraph by the runner. */
  seconds: z.number().positive(),
  brief: PlannedBriefSchema,
})
export type PlannedSlot = z.infer<typeof PlannedSlotSchema>

export const ShotListOutputSchema = z.object({
  slots: z.array(PlannedSlotSchema).min(1, 'a chapter with narration needs at least one slot'),
})
export type ShotListOutput = z.infer<typeof ShotListOutputSchema>

/**
 * Swap a planned chart's claim numbers for real claim IDs. Returns `null`
 * when a number points outside the claim list — the caller treats that as the
 * chart failing validation (it cited a claim that does not exist), which is
 * exactly what it is.
 */
export function mapClaimRefs(
  refs: readonly number[],
  claimIds: readonly string[],
): string[] | null {
  const mapped: string[] = []
  for (const ref of refs) {
    const id = claimIds[ref - 1]
    if (id === undefined) return null
    mapped.push(id)
  }
  return [...new Set(mapped)]
}

/**
 * What resolution needs to know about a claim: its id, and enough to judge
 * whether it can back a headline card. A subset of `ScriptClaim`, so callers
 * pass the claim list they already hold.
 */
export interface PlanningClaim {
  id: string
  sourceType?: string
  sourceUrl?: string | null
}

/**
 * Whether this claim can back a headline shot: a news outlet published it, at
 * an address the app can read. Anything else (a court filing, a regulator's
 * notice, a claim whose URL did not survive validation) has no article behind
 * it to quote, so the card would have nothing true to show.
 */
export function claimCarriesArticle(claim: PlanningClaim | undefined): boolean {
  if (!claim || claim.sourceType !== 'major_outlet') return false
  return typeof claim.sourceUrl === 'string' && claim.sourceUrl.trim() !== ''
}

/**
 * A planned brief made storable: charts and headlines get real claim IDs,
 * everything else passes through untouched. `null` means the slot cited a
 * claim it may not cite — the caller decides whether that is a placeholder or
 * a re-ask, and `plannedBriefRejection` says which rule was broken.
 */
export function resolvePlannedBrief(
  brief: PlannedBrief,
  claims: readonly PlanningClaim[],
): ShotBrief | null {
  if (brief.type === 'chart') {
    const mapped = mapClaimRefs(
      brief.dataRefs,
      claims.map((claim) => claim.id),
    )
    if (!mapped) return null
    return { ...brief, dataRefs: mapped }
  }

  if (brief.type === 'headline') {
    const claim = claims[brief.sourceRef - 1]
    if (!claimCarriesArticle(claim) || !claim) return null
    return {
      type: 'headline',
      coversText: brief.coversText,
      description: brief.description,
      motion: brief.motion,
      transition: brief.transition,
      ...(brief.shotSize !== undefined ? { shotSize: brief.shotSize } : {}),
      sourceClaimId: claim.id,
    }
  }

  return brief
}

/**
 * Why `resolvePlannedBrief` refused, in the words the board's dropped-slot
 * line uses. Null when it did not refuse.
 */
export function plannedBriefRejection(
  brief: PlannedBrief,
  claims: readonly PlanningClaim[],
): string | null {
  if (brief.type === 'chart') {
    return mapClaimRefs(
      brief.dataRefs,
      claims.map((claim) => claim.id),
    )
      ? null
      : 'chart cited a claim number outside the claim list'
  }

  if (brief.type === 'headline') {
    const claim = claims[brief.sourceRef - 1]
    if (!claim) return 'headline cited a claim number outside the claim list'
    if (claim.sourceType !== 'major_outlet') {
      return 'headline cited a claim that is not a news report'
    }
    if (!claim.sourceUrl) return 'headline cited a news claim with no source URL to read'
  }

  return null
}

// ---------------------------------------------------------------------------
// Coverage and the gate
// ---------------------------------------------------------------------------

/** The minimum a caller must know about a slot to reason about the gate. */
export interface SlotRef {
  status: ShotSlotStatus
}

export interface VisualsCoverage {
  slots: number
  resolved: number
  placeholder: number
  unresolved: number
}

/** The counts behind the board's counter and the gate card. */
export function visualsCoverage(slots: readonly SlotRef[]): VisualsCoverage {
  return {
    slots: slots.length,
    resolved: slots.filter((slot) => slot.status === 'resolved').length,
    placeholder: slots.filter((slot) => slot.status === 'placeholder').length,
    unresolved: slots.filter((slot) => slot.status === 'unresolved').length,
  }
}

/**
 * Why the visuals gate cannot be approved yet, or `undefined` when it can.
 *
 * Read by the approve action as well as the screen, same rule as every gate
 * since the dossier: a disabled button is a hint, not a guarantee.
 *
 * Placeholders do NOT block — spec section 11.3 allows approving around them,
 * but "only via explicit 'approve with N placeholders' wording". That consent
 * is the `acknowledgedPlaceholders` argument: the action passes what the
 * button the user actually clicked said, so a board that gained a placeholder
 * after the screen rendered still refuses a stale approval.
 */
export function visualsApprovalBlockedReason(
  slots: readonly SlotRef[],
  acknowledgedPlaceholders?: number,
): string | undefined {
  if (slots.length === 0) return 'There is no shot list yet. Run the visuals stage first.'

  const coverage = visualsCoverage(slots)

  if (coverage.unresolved > 0) {
    return (
      `${coverage.unresolved} slot${coverage.unresolved === 1 ? ' is' : 's are'} still unresolved. ` +
      'Each one needs a chosen candidate, a re-fetch, or your own upload.'
    )
  }

  if (coverage.placeholder > 0 && acknowledgedPlaceholders !== coverage.placeholder) {
    return (
      `${coverage.placeholder} slot${coverage.placeholder === 1 ? ' has' : 's have'} only a placeholder. ` +
      'Approving must say so explicitly — use the "approve with placeholders" button.'
    )
  }

  return undefined
}
