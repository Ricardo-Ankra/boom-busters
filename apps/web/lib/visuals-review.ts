import {
  getArticleSources,
  getClaims,
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listCastMembers,
  listProjectSets,
  listShotSlots,
  listVoiceTakes,
  logoById,
  scriptableClaims,
  slotNeedsResolution,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import { BANNED_PROMPT_WORDS, LIVE_IMAGE_GEN_ADAPTERS } from '@boom-busters/providers'
import {
  ArticleMetadataSchema,
  articleSourceLabel,
  CANDIDATES_SHOWN,
  claimCarriesArticle,
  craftFindings,
  DirectorsBookSchema,
  findingContext,
  normaliseArticleUrl,
  latestTakes,
  nameMatches,
  castWarnings,
  planWarnings,
  referenceWarnings,
  repairSummary,
  ShotBriefSchema,
  SlotCandidateSchema,
  SlotRefusalSchema,
  SlotDraftStateSchema,
  StillRouteSchema,
  visualsApprovalBlockedReason,
  visualsCoverage,
} from '@boom-busters/schemas'
import type {
  ArticleMetadata,
  CastMember,
  DirectorsBook,
  ProjectSet,
  RepairSummary,
  ShotBrief,
  ShotSlotStatus,
  SlotCandidate,
  SlotRefusal,
  SlotDraftState,
  StillRoute,
  VisualsCoverage,
} from '@boom-busters/schemas'
import { anchoredTimes, timedParagraphs } from '@/inngest/lib/shot-list'
import { presignGet, storageConfigured } from './storage'
import { routeForBrief, stillsEstimateUsd } from './visual-assets'
import { reuseView, sharedShotWarnings, type ReusableRow, type ReuseSource } from './visuals-reuse'

/**
 * What the visual board shows, and what the visuals gate refuses on — one
 * model behind both, same rule as `lib/voice-review.ts` and for the same
 * reason: a disabled button and a server-side refusal that disagree are worse
 * than either alone.
 *
 * Briefs and candidates come out of jsonb through their schemas rather than
 * by cast. A brief that no longer parses renders as an ERROR CARD, never as a
 * chart — that is the spec's chart rule generalised: broken data must look
 * broken.
 */

/**
 * One call a still or hero brief makes on a reference library, and whether it
 * lands (decisions 253 and 264).
 *
 * The board rendered none of this before: a still's `depicts` appeared only
 * inside the policy-refusal block and its `set` appeared nowhere at all, so
 * a film generated entirely without its photographs looked exactly like one
 * generated with them. Since `generateStillCandidates` never even reads the
 * cast or sets tables unless these fields are filled, a brief that omits
 * them is the difference between a likeness and a stranger, and it was
 * invisible.
 *
 * `resolved` is the same rule the generator applies, not a looser one: a
 * name the library has never seen and a name it holds without a photograph
 * both condition nothing, so both read as unresolved here.
 */
export interface SlotReference {
  kind: 'person' | 'set'
  /** The name exactly as the brief wrote it, role suffix and all. */
  name: string
  /** Whether a stored photograph or plate actually backs it. */
  resolved: boolean
}

export interface SlotView {
  id: string
  type: string
  status: ShotSlotStatus
  chapterIndex: number
  chapterTitle: string
  startMs: number
  durationMs: number
  /** `null` when the stored brief failed its schema — see `briefError`. */
  brief: ShotBrief | null
  briefError: string | undefined
  /** Top candidates, scored order, chosen first among equals. */
  candidates: SlotCandidate[]
  /** How many more were fetched than the strip shows. */
  extraCandidates: number
  /**
   * Whether the next fetch pass owes this slot work (staged-visuals design):
   * unresolved, or resolved for an older brief than the one it carries now.
   */
  needsFetch: boolean
  /**
   * A model-assisted re-type in flight (`drafting`) or declined (`refused`,
   * with the model's reason). Null when nothing is pending — which is always,
   * for mechanical conversions: those finish inside the button press.
   */
  retype: SlotDraftState | null
  /** An image model declined this slot's prompt (decision 252). */
  refusal: SlotRefusal | null
  /**
   * The cited article, for headline slots (decision 257). Null on every other
   * type, and on a headline slot whose claim no longer has a readable source.
   * Carries its own failure reason, so the card can ask for the four fields
   * rather than showing an error.
   */
  article: ArticleMetadata | null
  /** The slot whose shot this one shows (decision 261), or null when it has its own. */
  reuse: ReuseSource | null
  /**
   * The model the owner chose for this slot (decision 264), overriding the
   * derived route below. Null means nothing is stored and generation falls
   * back to `derivedRoute`.
   */
  route: StillRoute | null
  /**
   * What the routing rule picks for this slot (decision 264): a still or
   * hero brief's own route, computed from the cast, the sets and the
   * settings' model routing; every other slot type gets
   * `settings.modelRouting.stills`, so the field is always present even
   * where the board renders no select for it.
   */
  derivedRoute: StillRoute
  /**
   * Presigned GET per graphic logo asset id, board-wide (decision 268, Plan
   * B), the same shared shape as `photoUrls`: empty when storage is not
   * configured, or when nothing on the board cites a mark yet.
   */
  logoUrls: Record<string, string>
  /** What this brief calls on from the reference libraries, and what lands. */
  references: SlotReference[]
}

export interface ChapterSlots {
  chapterIndex: number
  chapterTitle: string
  slots: SlotView[]
}

/**
 * A claim this project's headline cards are allowed to quote (decision 257):
 * `major_outlet` with a surviving URL, which is exactly what
 * `resolvePlannedBrief` lets the shot-list model cite.
 *
 * The board's format picker lists these, because choosing WHICH article is the
 * only decision a re-type to headline carries — every string on the card comes
 * from the article itself, so there is nothing for a model to draft, and
 * nothing to spend a call on.
 */
export interface ArticleClaimOption {
  id: string
  /** The claim's own text, so the owner can see which fact the card backs. */
  text: string
  /** The outlet where one has been read, else the address, elided to fit. */
  label: string
}

/** One paragraph of narration, for the scrubber: where it sits and what plays it. */
export interface NarrationSegment {
  takeId: string | null
  startMs: number
  durationMs: number
}

export interface VisualsReviewModel {
  chapters: ChapterSlots[]
  coverage: VisualsCoverage
  /**
   * Why Approve is refused, or `undefined` when it can proceed. Placeholders
   * deliberately do NOT appear here — they gate through the button's own
   * wording ("Approve with N placeholders"), which the action verifies by
   * count. This field is the unresolved-slots blocker only.
   */
  blockedReason: string | undefined
  /** Drives the approve button's explicit wording. */
  placeholders: number
  segments: NarrationSegment[]
  totalMs: number
  /**
   * Which visuals checkpoint the project sits at (staged-visuals design):
   * `plan` shows editable briefs and the Fetch button, `board` shows the
   * candidate strips, null means the stage has not run.
   */
  phase: 'plan' | 'board' | null
  /** How many slots the next fetch pass will actually touch. */
  toFetch: number
  /** The paid subset of `toFetch` — generated stills. */
  stillsToFetch: number
  /** What "Fetch visuals" will spend, in USD. Stills are the whole bill. */
  fetchEstimateUsd: number
  /** The Director's Book (decision 252), null before the visuals stage drafts one. */
  direction: DirectorsBook | null
  /** Craft notes from `planWarnings`, in screen order. */
  warnings: string[]
  /**
   * What the Fix button would do (decision 271): the slots with an auto or
   * manual finding, how many of them are stock slots the fix makes into
   * generated stills, and how many chapters that spends a call on.
   */
  repair: RepairSummary
  /**
   * The articles a slot may be re-typed to quote (decision 257). Empty means
   * this project's dossier has no news claim, and the picker says so rather
   * than offering a button that can only fail.
   */
  articleClaims: ArticleClaimOption[]
}

/**
 * The shape for pages with no business paying visuals queries (decision 186):
 * the project page loads this instead of querying when neither the viewed
 * stage nor the project's own stage is `visuals`.
 */
export function emptyVisualsModel(): VisualsReviewModel {
  return {
    chapters: [],
    coverage: { slots: 0, resolved: 0, placeholder: 0, unresolved: 0 },
    blockedReason: undefined,
    placeholders: 0,
    segments: [],
    totalMs: 0,
    phase: null,
    toFetch: 0,
    stillsToFetch: 0,
    fetchEstimateUsd: 0,
    direction: null,
    warnings: [],
    repair: { slots: 0, becomeStills: 0, chapters: 0 },
    articleClaims: [],
  }
}

function parseCandidates(raw: unknown): SlotCandidate[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    const parsed = SlotCandidateSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * The stored article record behind each cited claim, by claim id.
 *
 * Read-only and read-through nothing: a board render must never open a socket
 * to a publisher, so a claim with no stored record simply has none, and the
 * card asks for the fields. Normalisation happens here rather than in SQL
 * because the URL the dossier stored and the URL the store is keyed by are the
 * same address written two ways.
 */
async function articlesForClaims(
  db: Database,
  claimIds: readonly string[],
): Promise<Map<string, ArticleMetadata>> {
  const found = new Map<string, ArticleMetadata>()
  if (claimIds.length === 0) return found

  const claims = await getClaims(db, [...new Set(claimIds)])
  const urlByClaim = new Map<string, string>()
  for (const claim of claims) {
    const url = claim.sourceUrl === null ? null : normaliseArticleUrl(claim.sourceUrl)
    if (url !== null) urlByClaim.set(claim.id, url)
  }

  const rows = await getArticleSources(db, [...new Set(urlByClaim.values())])
  const byUrl = new Map(rows.map((row) => [row.url, row]))
  for (const [claimId, url] of urlByClaim) {
    const row = byUrl.get(url)
    if (!row) continue
    const parsed = ArticleMetadataSchema.safeParse({
      url: row.url,
      outlet: row.outlet,
      headline: row.headline,
      author: row.author,
      publishedAt: row.publishedAt,
      description: row.description,
      provenance: row.provenance,
      status: row.status,
      failureReason: row.failureReason,
    })
    if (parsed.success) found.set(claimId, parsed.data)
  }
  return found
}

/**
 * The claims the format picker may offer as a headline's article.
 *
 * Read-only for the same reason `articlesForClaims` is: this runs on a page
 * load. A claim with no stored record yet is still offered — the article is
 * read when the slot resolves, so the label falls back to the address, which
 * is enough to tell two sources apart in a list.
 */
async function articleClaimOptions(db: Database, projectId: string): Promise<ArticleClaimOption[]> {
  const eligible = (await scriptableClaims(db, projectId)).filter((claim) =>
    claimCarriesArticle(claim),
  )
  if (eligible.length === 0) return []

  const urlByClaim = new Map<string, string>()
  for (const claim of eligible) {
    const url = claim.sourceUrl === null ? null : normaliseArticleUrl(claim.sourceUrl)
    if (url !== null) urlByClaim.set(claim.id, url)
  }

  const rows = await getArticleSources(db, [...new Set(urlByClaim.values())])
  const outletByUrl = new Map(rows.flatMap((row) => (row.outlet ? [[row.url, row.outlet]] : [])))

  return eligible.flatMap((claim) => {
    const url = urlByClaim.get(claim.id)
    // A URL that will not normalise is not an address we could ever read.
    if (url === undefined) return []
    return [
      { id: claim.id, text: claim.text, label: outletByUrl.get(url) ?? articleSourceLabel(url) },
    ]
  })
}

/**
 * What one brief calls on from the reference libraries, and what lands.
 *
 * The resolution rule is deliberately the generator's own (`depictedFrom`
 * and `setFrom` in `lib/visual-assets.ts`), not a looser one: a name the
 * library never held and a name it holds with no photograph both condition
 * nothing, so the card must not show either as a hit. The join is
 * `nameMatches`, so a planner that wrote "Markus Braun, chief executive"
 * still reads as naming Markus Braun — the same allowance decision 262 put
 * in the generator, which an exact-string check here would quietly undo.
 */
function slotReferences(
  brief: ShotBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
): SlotReference[] {
  // Graphics are deliberately absent. A graphic's logos are already on its
  // own card, as an upload button per unmatched mark, and that button judges
  // "matched" more strictly than an `assetId` can: the library row an id
  // names may have been deleted since, so the board keys off whether the
  // preview can actually draw the mark. A chip resolved on the id alone would
  // sit beside that button contradicting it.
  if (brief.type !== 'still' && brief.type !== 'hero') return []

  const people: SlotReference[] = (brief.depicts ?? [])
    .filter((entry) => entry.trim().length > 0)
    .map((entry) => ({
      kind: 'person' as const,
      name: entry,
      resolved: cast.some((member) => nameMatches(entry, member.name) && member.photos.length > 0),
    }))

  const named = brief.set?.trim()
  const set: SlotReference[] = named
    ? [
        {
          kind: 'set' as const,
          name: named,
          resolved: sets.some(
            (candidate) => nameMatches(named, candidate.name) && candidate.plates.length > 0,
          ),
        },
      ]
    : []

  return [...people, ...set]
}

export async function visualsReviewModel(
  db: Database,
  projectId: string,
  options: { phase?: 'plan' | 'board' | null } = {},
): Promise<VisualsReviewModel> {
  const [rows, sources, takes, project, articleClaims] = await Promise.all([
    listShotSlots(db, projectId),
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
    getProject(db, projectId),
    articleClaimOptions(db, projectId),
  ])

  /**
   * The scrubber's clock is the same clock the runner stamped the slots with:
   * `timedParagraphs` over the same chapters and takes. Recomputed here rather
   * than stored, so an edited script shows its drift instead of hiding it.
   */
  const paragraphs = timedParagraphs({ chapters: sources.chapters, takes })

  /**
   * And the slots are put on the words they cover, the same way and with the
   * same function the compiler uses (decision 255, amended). Recomputed for
   * the same reason: a project planned before the rule, or re-voiced since,
   * carries the planner's guessed seconds in its rows, and a card that seeks
   * to a different moment than the render cuts to is a card that lies.
   */
  const briefs = rows.map((row) => ShotBriefSchema.safeParse(row.brief))

  /**
   * The cited articles, read in one query (decision 257). Read-only here: the
   * board is a screen, and a page load must never open a socket to a
   * publisher. Resolution and the Re-fetch button are what fetch.
   */
  const claimIds = briefs.flatMap((brief) =>
    brief.success && brief.data.type === 'headline' ? [brief.data.sourceClaimId] : [],
  )
  const articlesByClaim = await articlesForClaims(db, claimIds)

  const times = anchoredTimes(
    rows.map((row, at) => {
      const brief = briefs[at]
      return {
        startMs: row.startMs,
        durationMs: row.durationMs,
        coversText: brief?.success === true ? brief.data.coversText : null,
      }
    }),
    paragraphs,
  )

  // The rows as the reuse helpers read them (decision 261): anchored times,
  // parsed candidates, the link column.
  const reusable: ReusableRow[] = rows.map((row, at) => ({
    id: row.id,
    chapterIndex: row.chapterIndex,
    startMs: times[at]!.startMs,
    status: row.status,
    reuseOfSlotId: row.reuseOfSlotId,
    candidates: parseCandidates(row.candidates),
  }))

  /**
   * The three loads every slot's route needs (decision 264): the cast and
   * sets a still or hero brief may depict, and the settings that hold the
   * fallback routing. One read of each for the whole board, not one per
   * slot. `castWarnings` below reuses this same cast rather than loading it
   * again.
   */
  const [cast, sets, settings] = await Promise.all([
    listCastMembers(db, projectId),
    listProjectSets(db, projectId),
    getSettings(db),
  ])

  /**
   * Every graphic logo's presigned URL, board-wide, the same shared-object
   * shape `page.tsx` builds `photoUrls` in (decision 268, Plan B): read here
   * rather than there, because only this function has already parsed every
   * brief to find which asset ids a scene cites. Mock storage (no R2) leaves
   * this empty, same as `photoUrls`, so a matched mark falls back to the
   * preview's "upload" box rather than a broken `<image>`.
   */
  const graphicLogoUrls: Record<string, string> = {}
  if (storageConfigured()) {
    const assetIds = new Set(
      briefs.flatMap((parsed) =>
        parsed.success && parsed.data.type === 'graphic'
          ? parsed.data.scene.elements.flatMap((element) =>
              element.kind === 'logo' && element.assetId !== undefined ? [element.assetId] : [],
            )
          : [],
      ),
    )
    for (const assetId of assetIds) {
      const logo = await logoById(db, assetId)
      if (logo) graphicLogoUrls[assetId] = await presignGet(logo.r2Key)
    }
  }

  const slots: SlotView[] = rows.map((row, at) => {
    const parsed = briefs[at]!
    const candidates = parseCandidates(row.candidates)
    // Chosen first, then by score — the strip reads left to right as "what
    // will be used, then the alternatives, best first".
    const ordered = [...candidates].sort(
      (a, b) =>
        Number(b.chosen ?? false) - Number(a.chosen ?? false) || (b.score ?? -1) - (a.score ?? -1),
    )

    return {
      id: row.id,
      type: row.type,
      status: row.status,
      chapterIndex: row.chapterIndex,
      chapterTitle: row.chapterTitle,
      startMs: times[at]!.startMs,
      durationMs: times[at]!.durationMs,
      brief: parsed.success ? parsed.data : null,
      briefError: parsed.success
        ? undefined
        : 'This brief no longer matches its schema and cannot be rendered or re-fetched as is.',
      candidates: ordered.slice(0, CANDIDATES_SHOWN),
      extraCandidates: Math.max(0, ordered.length - CANDIDATES_SHOWN),
      needsFetch: slotNeedsResolution(row),
      article:
        parsed.success && parsed.data.type === 'headline'
          ? (articlesByClaim.get(parsed.data.sourceClaimId) ?? null)
          : null,
      retype: ((): SlotDraftState | null => {
        const state = SlotDraftStateSchema.safeParse(row.retype)
        return state.success ? state.data : null
      })(),
      refusal: ((): SlotRefusal | null => {
        const state = SlotRefusalSchema.safeParse(row.refusal)
        return state.success ? state.data : null
      })(),
      reuse: reuseView(reusable[at]!, reusable),
      route: ((): StillRoute | null => {
        const stored = StillRouteSchema.nullable().safeParse(row.route)
        if (!stored.success || stored.data === null) return null
        // A model the provider has retired is no longer an option the select
        // can show, so the slot reads as being on the planned default, which
        // is what it will actually generate on (decision 264).
        const offered = LIVE_IMAGE_GEN_ADAPTERS[stored.data.provider].models.some(
          (model) => model.id === stored.data!.model,
        )
        return offered ? stored.data : null
      })(),
      // `routeForBrief` already falls back to `settings.modelRouting.stills`
      // for every type but still and hero, so a brief that failed to parse
      // gets the same fallback rather than a special case here.
      derivedRoute: parsed.success
        ? routeForBrief(parsed.data, cast, sets, settings.modelRouting)
        : settings.modelRouting.stills,
      logoUrls: graphicLogoUrls,
      references: parsed.success ? slotReferences(parsed.data, cast, sets) : [],
    }
  })

  const chapters: ChapterSlots[] = []
  for (const slot of slots) {
    const group = chapters.find((chapter) => chapter.chapterIndex === slot.chapterIndex)
    if (group) group.slots.push(slot)
    else
      chapters.push({
        chapterIndex: slot.chapterIndex,
        chapterTitle: slot.chapterTitle,
        slots: [slot],
      })
  }

  const current = latestTakes(takes)
  const takeByParagraph = new Map(
    current.map((take) => [`${take.chapterId}:${take.paragraphIndex}`, take]),
  )

  const segments: NarrationSegment[] = paragraphs.map((paragraph) => {
    const take = takeByParagraph.get(`${paragraph.chapterId}:${paragraph.index}`)
    return {
      takeId: take && take.r2Key !== null ? take.id : null,
      startMs: paragraph.startMs,
      durationMs: paragraph.durationMs,
    }
  })

  const coverage = visualsCoverage(slots)

  const toFetch = slots.filter((slot) => slot.needsFetch)
  const stillsToFetch = toFetch.filter((slot) => slot.type === 'still').length
  /**
   * Priced brief by brief, not slot count times a flat rate. Every brief is
   * written by the time this checkpoint is on screen, so which route each
   * still takes — and therefore what it costs — is known (decision 253,
   * amended). Quoting the dearer route for all of them made the number
   * useless the moment the two routes differed.
   *
   * Priced from the rows, not from `slots` (decision 264): a route stored on
   * a slot lives on the database row (`route`, jsonb), not on `SlotView`, and
   * pricing a re-routed slot at its derived route would quote a number the
   * fetch will not spend. Brief and route are zipped together before either
   * array is built, so they stay aligned index for index.
   */
  const toFetchEntries = rows
    .map((row, at) => ({ row, brief: briefs[at]! }))
    .filter(({ row }) => slotNeedsResolution(row))
    .flatMap(({ row, brief }) => {
      if (!brief.success) return []
      const route = StillRouteSchema.nullable().safeParse(row.route)
      return [{ brief: brief.data, route: route.success ? route.data : null }]
    })
  const fetchEstimateUsd = await stillsEstimateUsd(
    toFetchEntries.map((entry) => entry.brief),
    projectId,
    toFetchEntries.map((entry) => entry.route),
  )

  const direction = ((): DirectorsBook | null => {
    const parsed = DirectorsBookSchema.safeParse(project?.direction)
    return parsed.success ? parsed.data : null
  })()

  // One craft check over the whole film (decision 271), the same one the Fix
  // button runs, so the count on the button is the set of slots it rewrites.
  const findingSlots = slots.flatMap((slot) =>
    slot.brief ? [{ brief: slot.brief, chapter: `chapter ${slot.chapterIndex + 1}` }] : [],
  )
  const findings = craftFindings(
    findingSlots,
    findingContext({
      direction,
      cast: cast.map((member) => ({ name: member.name, photographed: member.photos.length > 0 })),
      sets,
    }),
  )

  return {
    chapters,
    coverage,
    // Acknowledged := the actual count, so ONLY the unresolved blocker
    // surfaces here; the placeholder consent happens at the button.
    blockedReason: visualsApprovalBlockedReason(slots, coverage.placeholder),
    placeholders: coverage.placeholder,
    segments,
    totalMs: segments.reduce((total, segment) => total + segment.durationMs, 0),
    phase: options.phase ?? null,
    toFetch: toFetch.length,
    stillsToFetch,
    fetchEstimateUsd,
    direction,
    // Craft notes (decision 252), in screen order; never a blocker. Motif
    // counts per chapter (decision 260), plus any cast member the book forgot
    // (decision 253).
    warnings: [
      ...planWarnings(
        findingSlots,
        BANNED_PROMPT_WORDS,
        direction?.motifs ?? [],
        sets.map((set) => set.name),
        direction?.eraLocks.map((lock) => lock.rules) ?? [],
      ),
      // The people and rooms a sentence names but its shot leaves out, which
      // planWarnings has no words for (decision 271).
      ...findings
        .filter((finding) => finding.kind === 'ignored-person' || finding.kind === 'ignored-set')
        .map((finding) => `${finding.message} (slot ${finding.slotIndex})`),
      ...castWarnings(
        direction,
        cast.map((member) => member.name),
      ),
      // The silent half of the same story: references the producer uploaded
      // that no brief calls on, so the photographs are never sent at all.
      ...referenceWarnings(
        findingSlots,
        cast.filter((member) => member.photos.length > 0).map((member) => member.name),
        sets.filter((set) => set.plates.length > 0).map((set) => set.name),
      ),
      ...sharedShotWarnings(reusable),
    ],
    repair: repairSummary(findingSlots, findings),
    articleClaims,
  }
}
