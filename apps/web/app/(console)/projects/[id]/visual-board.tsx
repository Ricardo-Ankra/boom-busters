'use client'

import {
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { imageGenModel, LIVE_IMAGE_GEN_ADAPTERS } from '@boom-busters/providers'
import {
  LOGO_ACCEPT,
  REUSABLE_SLOT_TYPES,
  SHOT_SLOT_TYPES,
  STILL_PROVIDERS,
} from '@boom-busters/schemas'
import type {
  BrandKitStored,
  GraphicElement,
  GraphicScene,
  ShotBrief,
  SlotCandidate,
  StillProvider,
} from '@boom-busters/schemas'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/confirm-button'
import { Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { readImageSize, toUploadableImage, toUploadableLogo } from '@/lib/client-image'
import type {
  ArticleClaimOption,
  SlotReference,
  SlotView,
  VisualsReviewModel,
} from '@/lib/visuals-review'
import { CLOSE_REUSE_MS, describeGap, timecode } from '@/lib/visuals-reuse'
import { createLogoUploadAction, finaliseLogoAction } from '@/app/(console)/settings/logo-actions'
import {
  addSlotImageFromUrlAction,
  approvePlanAction,
  attachGraphicLogosAction,
  chooseCandidateAction,
  createOwnUploadAction,
  dismissRetypeAction,
  editBriefAction,
  finaliseOwnUploadAction,
  redirectSceneAction,
  refetchArticleAction,
  refetchSlotAction,
  repairPlanAction,
  reuseSlotShotAction,
  saveHeadlineAction,
  replanShotsAction,
  retypeSlotAction,
  rebriefSlotAction,
  retypeToHeadlineAction,
  setSlotRouteAction,
  unlinkSlotReuseAction,
  type ActionResult,
} from './visuals-actions'
import { DirectionCard } from './direction-card'
import {
  ChartErrorCard,
  ChartPreview,
  GraphicPreview,
  HeadlinePreview,
  MapPreview,
  type BrandChartColors,
} from './slot-previews'

/**
 * The visual board (build spec section 11.3): a filmstrip synced to an audio
 * scrubber, slot cards with candidate strips, and per-slot repairs — every
 * action a labelled button on the card it affects.
 *
 * The scrubber plays the narration takes laid end to end on the same clock
 * the slots were timed with. Clicking a slot — in the filmstrip or on its
 * card — seeks the audio to the moment that slot is on screen. (True
 * gapless concatenated audio is an M6 alignment product; here each paragraph
 * take plays in sequence, which is the same audio at the same moments.)
 */

function candidateThumb(candidate: SlotCandidate): string | undefined {
  if (candidate.thumbUrl) return candidate.thumbUrl
  if (candidate.assetId) return `/api/assets/${candidate.assetId}/file`
  if (candidate.sourceUrl.startsWith('data:') || candidate.sourceUrl.startsWith('http')) {
    return candidate.sourceUrl
  }
  return undefined
}

/**
 * The best URL for the ENLARGED view, which is not the thumbnail's order:
 * bytes we hold (stills, uploads) beat the provider's full-size URL, and the
 * small thumb is the last resort rather than the first. Mock candidates'
 * `mock://` sources fall through to their data: thumbs.
 */
function candidateFull(candidate: SlotCandidate): string | undefined {
  if (candidate.assetId) return `/api/assets/${candidate.assetId}/file`
  if (candidate.sourceUrl.startsWith('data:') || candidate.sourceUrl.startsWith('http')) {
    return candidate.sourceUrl
  }
  return candidate.thumbUrl
}

const STATUS_TONE: Record<string, BadgeTone> = {
  resolved: 'success',
  placeholder: 'warning',
  unresolved: 'muted',
  planned: 'muted',
}

/** Where a field came from, so a guess never reads as a fact. */
const PROVENANCE_LABEL: Record<string, string> = {
  jsonld: 'from the article',
  og: 'from the article',
  meta: 'from the article',
  title: 'from the page title',
  domain: 'guessed from the domain',
  archive: 'from an archived copy',
  manual: 'typed by you',
}

/**
 * The headline card (decision 257): what the article said, where each field
 * came from, and a form to correct any of it.
 *
 * The manual path is not a repair here, it is the normal path for a paywalled
 * article, so the empty state asks rather than apologises.
 */
function HeadlineSlot({
  slot,
  brief,
  projectId,
  act,
  colors,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'headline' }>
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  colors: BrandChartColors
}) {
  const article = slot.article
  const [editing, setEditing] = React.useState(false)

  if (!article) {
    return (
      <p className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-muted)]">
        The claim this card cites no longer has a source to read. Give the claim a source URL on the
        dossier screen, or change this slot to another type.
      </p>
    )
  }

  const provenance = article.provenance as Record<string, string>

  return (
    <div className="flex flex-col gap-2">
      <HeadlinePreview
        article={article}
        emphasis={brief.emphasis}
        showDeck={brief.showDeck === true}
        colors={colors}
      />

      {article.headline === null ? (
        <p className="text-[13px] text-[var(--color-warning)]">
          {article.failureReason ?? 'The article did not say.'} Open it and fill these in.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1" aria-label="Where each field came from">
          {(['outlet', 'headline', 'author', 'publishedAt'] as const).map((field) =>
            provenance[field] === undefined ? null : (
              <li
                key={field}
                className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
              >
                {field === 'publishedAt' ? 'date' : field} · {PROVENANCE_LABEL[provenance[field]]}
              </li>
            ),
          )}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setEditing((open) => !open)}>
          {editing ? 'Close' : article.headline === null ? 'Fill these in' : 'Correct the details'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            void act(slot.id, () => refetchArticleAction(projectId, slot.id), 'Article read again')
          }
        >
          Re-fetch
        </Button>
        {/* A link, but one of our controls: same 40px target as the buttons. */}
        <a
          href={article.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-10 items-center px-2 font-mono text-[11px] text-[var(--color-accent-text)] underline"
        >
          Open the article
        </a>
      </div>

      {editing ? (
        <HeadlineForm
          slot={slot}
          brief={brief}
          article={article}
          projectId={projectId}
          act={act}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </div>
  )
}

function HeadlineForm({
  slot,
  brief,
  article,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'headline' }>
  article: NonNullable<SlotView['article']>
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  onDone: () => void
}) {
  const [outlet, setOutlet] = React.useState(article.outlet ?? '')
  const [headline, setHeadline] = React.useState(article.headline ?? '')
  const [author, setAuthor] = React.useState(article.author ?? '')
  const [publishedAt, setPublishedAt] = React.useState(article.publishedAt ?? '')
  const [description, setDescription] = React.useState(article.description ?? '')
  const [emphasis, setEmphasis] = React.useState(brief.emphasis ?? '')
  const [showDeck, setShowDeck] = React.useState(brief.showDeck === true)

  const field =
    'rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'
  const label = 'flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]'

  return (
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () =>
            saveHeadlineAction(projectId, slot.id, {
              outlet,
              headline,
              author,
              publishedAt,
              description,
              emphasis,
              showDeck,
            }),
          'Headline saved',
        ).then((result) => {
          if (result.ok) onDone()
        })
      }}
    >
      <label className={label}>
        Publication
        <input value={outlet} onChange={(e) => setOutlet(e.target.value)} className={field} />
      </label>
      <label className={label}>
        Headline, word for word as published
        <textarea
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
          rows={2}
          className={field}
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className={label}>
          Byline
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="leave empty if it has none"
            className={field}
          />
        </label>
        <label className={label}>
          Published (YYYY-MM-DD)
          <input
            value={publishedAt}
            onChange={(e) => setPublishedAt(e.target.value)}
            placeholder="2023-03-14"
            className={`${field} font-mono`}
          />
        </label>
      </div>
      <label className={label}>
        Standfirst
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={field}
        />
      </label>
      <label className="flex items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
        <input
          type="checkbox"
          checked={showDeck}
          onChange={(e) => setShowDeck(e.target.checked)}
          className="size-4"
        />
        Show the standfirst on the card
      </label>
      <label className={label}>
        Highlight this phrase
        <input
          value={emphasis}
          onChange={(e) => setEmphasis(e.target.value)}
          placeholder="must appear in the headline"
          className={field}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Every claim id a graphic's figure and bars items cite, in scene order, each once. */
function graphicClaimIds(scene: GraphicScene): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const element of scene.elements) {
    const refs = element.kind === 'figure' ? [element.claimRef] : []
    const barRefs = element.kind === 'bars' ? element.items.map((item) => item.claimRef) : []
    for (const ref of [...refs, ...barRefs]) {
      if (seen.has(ref)) continue
      seen.add(ref)
      ids.push(ref)
    }
  }
  return ids
}

/**
 * The graphic card (decision 268, Plan B): the same preview the board shows
 * beside a headline card, the claim chips over what the scene cites, and one
 * `Add logo for <entity>` button per mark the library does not yet hold.
 * Resolution, flipping the slot to resolved once every mark is found, is
 * `attachGraphicLogosAction`'s job (Task 9); this card only calls it.
 */
function GraphicSlot({
  slot,
  brief,
  projectId,
  act,
  brand,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'graphic' }>
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  brand: BrandKitStored
}) {
  const claimIds = graphicClaimIds(brief.scene)
  // An `assetId` alone is not proof the mark is still there: the library row
  // it names can have been deleted since this brief was resolved. The board
  // offers the same repair either way, keyed off whether the preview can
  // actually draw it, not off whether the brief once thought it could.
  const missingLogos = brief.scene.elements.filter(
    (element): element is Extract<GraphicElement, { kind: 'logo' }> =>
      element.kind === 'logo' &&
      (element.assetId === undefined || slot.logoUrls[element.assetId] === undefined),
  )

  return (
    <div className="flex flex-col gap-2">
      <GraphicPreview brief={brief} brand={brand} logoUrls={slot.logoUrls} />
      {claimIds.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="Source claims">
          {claimIds.map((claimId, index) => (
            <span
              key={claimId}
              title={claimId}
              className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
            >
              claim {index + 1}
            </span>
          ))}
        </div>
      ) : null}
      {missingLogos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {missingLogos.map((element) => (
            <GraphicLogoUploader
              key={element.id}
              entity={element.entity}
              projectId={projectId}
              slotId={slot.id}
              act={act}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The inline uploader for a mark the library does not yet hold (decision
 * 268, Plan B, Task 9's follow-on): the presigned two-step shape every own
 * upload here takes, then `attachGraphicLogosAction` re-runs the library
 * match over the whole scene, so a second missing mark on the same graphic
 * is still asked for rather than silently dropped.
 */
function GraphicLogoUploader({
  entity,
  projectId,
  slotId,
  act,
}: {
  entity: string
  projectId: string
  slotId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const upload = async (picked: File): Promise<ActionResult> => {
    const ready = await toUploadableLogo(picked)
    if (!ready.ok) return ready
    const file = ready.file

    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const contentHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const created = await createLogoUploadAction({
      fileType: file.type,
      fileSize: file.size,
      contentHash,
    })
    if (!created.ok || !created.url || !created.key) return created

    const put = await fetch(created.url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!put.ok) {
      return { ok: false, error: `Storage refused the upload (${put.status}). Try again.` }
    }

    const size = await readImageSize(file)
    const finalised = await finaliseLogoAction({
      key: created.key,
      contentHash,
      title: entity,
      width: size.width,
      height: size.height,
    })
    if (!finalised.ok) return finalised

    return attachGraphicLogosAction(projectId, slotId)
  }

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <ImagePlus aria-hidden />
        {`Add logo for ${entity}`}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={LOGO_ACCEPT}
        className="hidden"
        aria-label={`Choose a logo file for ${entity}`}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void act(slotId, () => upload(file), 'Mark added; the graphic has it now')
        }}
      />
    </>
  )
}

function StatusChip({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'muted'}>{status}</Badge>
}

/**
 * How each slot type reads to a human (decision 214). The wire ids stay —
 * they live in stored briefs, a pg enum and timeline JSON — but the words
 * say what each type IS: archival is the owner's real footage (upload only),
 * still is a machine-made image, hero is the switched-off AI video.
 */
const SLOT_TYPE_LABELS: Record<string, string> = {
  stock: 'stock',
  archival: 'real footage',
  still: 'AI image',
  chart: 'chart',
  map: 'map',
  headline: 'news headline',
  graphic: 'graphic',
  hero: 'AI video',
}

const slotTypeLabel = (type: string) => SLOT_TYPE_LABELS[type] ?? type

function TypeBadge({ type }: { type: string }) {
  return <Badge shape="tag">{slotTypeLabel(type)}</Badge>
}

/**
 * One reference a brief calls on: the name, and whether anything backs it.
 *
 * An unresolved chip is the actionable half. It means the brief named
 * something the library cannot supply, so the shot is generated plain — the
 * producer's fix is to upload the photograph or correct the name, and
 * neither is possible if the screen never says which.
 */
function ReferenceChip({ reference }: { reference: SlotReference }) {
  const noun = reference.kind === 'person' ? 'photograph' : 'plate'
  const title = reference.resolved
    ? `${reference.name}: the stored ${noun} is sent with this shot`
    : `${reference.name}: no ${noun} is stored, so this shot is generated without one`
  return (
    <span
      title={title}
      className={
        'rounded-full border px-2 py-0.5 text-[11px] ' +
        (reference.resolved
          ? 'border-[var(--color-border-strong)] text-[var(--color-text-secondary)]'
          : 'border-[var(--color-warning)] text-[var(--color-warning)]')
      }
    >
      {reference.resolved ? '' : 'no '}
      {noun} · {reference.name}
    </span>
  )
}

/** What one re-plan of every chapter costs, the Director's Book estimate's twin. */
const REPLAN_ESTIMATE = '≈$0.15'

/**
 * What one chapter's repair call costs (decision 271). It answers only the
 * flagged briefs under rules the chapter was already planned with, so it costs
 * less than planning the chapter did: the re-plan's ≈$0.15 across a typical
 * seven chapters is ≈$0.02 each, rounded up here because every estimate in
 * this app errs against the budget.
 */
const REPAIR_ESTIMATE_PER_CHAPTER_USD = 0.03

export function VisualBoard({
  projectId,
  model,
  colors,
  brand,
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
  brand: BrandKitStored
}) {
  const router = useRouter()
  const { toast } = useToast()
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [segmentIndex, setSegmentIndex] = React.useState(0)
  const [positionMs, setPositionMs] = React.useState(0)
  const [busySlot, setBusySlot] = React.useState<string | null>(null)
  const pendingSeekSec = React.useRef(0)

  const playable = model.segments.some((segment) => segment.takeId !== null)
  const allSlots = model.chapters.flatMap((chapter) => chapter.slots)

  /**
   * Every slot button goes through here, and it RETURNS what happened: a
   * refused save must leave the form open with what the owner typed in it,
   * which is not possible if the caller cannot tell success from failure.
   */
  const act = React.useCallback(
    async (
      slotId: string,
      run: () => Promise<ActionResult>,
      success: string,
    ): Promise<ActionResult> => {
      setBusySlot(slotId)
      try {
        const result = await run()
        if (result.ok) {
          toast({ title: success })
          router.refresh()
        } else {
          toast({ title: 'That did not work', description: result.error, variant: 'error' })
        }
        return result
      } catch {
        // A rejected action call (network drop, request refused before the
        // action ran) previously surfaced as nothing happening at all — the
        // worst possible answer to a button press.
        toast({
          title: 'That did not work',
          description: 'The request never reached the server. Check the connection and try again.',
          variant: 'error',
        })
        return { ok: false, error: 'The request never reached the server.' }
      } finally {
        setBusySlot(null)
      }
    },
    [router, toast],
  )

  const loadSegment = React.useCallback(
    (index: number, offsetMs: number, andPlay: boolean) => {
      const audio = audioRef.current
      const segment = model.segments[index]
      if (!audio || !segment?.takeId) return

      setSegmentIndex(index)
      pendingSeekSec.current = offsetMs / 1000
      audio.src = `/api/voice-takes/${segment.takeId}/audio`
      audio.load()
      if (andPlay) void audio.play().catch(() => setPlaying(false))
    },
    [model.segments],
  )

  const seekToMs = React.useCallback(
    (ms: number, andPlay: boolean) => {
      let index = model.segments.findIndex(
        (segment) => ms >= segment.startMs && ms < segment.startMs + segment.durationMs,
      )
      if (index === -1) index = 0
      // A paragraph with no audio cannot be played from; the nearest
      // following one that can be is the honest place to land.
      while (index < model.segments.length && model.segments[index]?.takeId === null) index += 1
      const segment = model.segments[index]
      if (!segment) return
      setPositionMs(Math.max(segment.startMs, ms))
      loadSegment(index, Math.max(0, ms - segment.startMs), andPlay)
    },
    [loadSegment, model.segments],
  )

  const jumpToSlot = React.useCallback(
    (slot: SlotView) => {
      seekToMs(slot.startMs, playing)
      document.getElementById(`slot-${slot.id}`)?.scrollIntoView({ block: 'center' })
    },
    [playing, seekToMs],
  )

  return (
    <div className="flex flex-col gap-4">
      {/* ------------------------------------------------------------------ */}
      {/* The plan checkpoint (staged-visuals design): the one spend button   */}
      {/* ------------------------------------------------------------------ */}
      {model.phase === 'plan' ? (
        <>
          {/* The Director's Book (decision 252): edited above the plan it shapes. */}
          <DirectionCard
            projectId={projectId}
            direction={model.direction}
            busy={busySlot !== null && busySlot.startsWith('direction-')}
            act={act}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Shot plan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-[13px] text-[var(--color-text-secondary)]">
                Nothing has been fetched or generated yet. Edit any brief, change a slot&apos;s
                format, or fetch a single slot to try it; when the plan reads right, fetch the lot.
                Slots already fetched for their current brief are never bought twice.
              </p>
              {model.warnings.length > 0 ? (
                <ul
                  className="list-disc pl-5 text-[12px] text-[var(--color-warning)]"
                  aria-label="Craft notes"
                >
                  {model.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <ConfirmButton
                  variant="primary"
                  confirmVariant="primary"
                  label={
                    <>
                      Fetch visuals · {model.toFetch} slot{model.toFetch === 1 ? '' : 's'} · est. $
                      {model.fetchEstimateUsd.toFixed(2)}
                    </>
                  }
                  confirmLabel="Fetch now"
                  consequence={
                    model.stillsToFetch > 0
                      ? `Fetches stock, chart and map candidates (free) and generates ` +
                        `${model.stillsToFetch} AI image${model.stillsToFetch === 1 ? '' : 's'} at ` +
                        `est. $${model.fetchEstimateUsd.toFixed(2)}. Real-footage slots wait for ` +
                        `your uploads. The board review follows.`
                      : 'Fetches stock, chart and map candidates — all free. Real-footage slots ' +
                        'wait for your uploads. The board review follows.'
                  }
                  onConfirm={() =>
                    act(
                      'plan',
                      () => approvePlanAction(projectId),
                      'Fetching — the board fills in as candidates land',
                    )
                  }
                />
                {/* Beside the notes it acts on (decision 271): fix only what
                    the craft check flagged, rather than plan everything again. */}
                {model.repair.slots > 0 ? (
                  <ConfirmButton
                    variant="outline"
                    confirmVariant="primary"
                    label={
                      `Fix these ${model.repair.slots} slot${model.repair.slots === 1 ? '' : 's'} · ≈$` +
                      (REPAIR_ESTIMATE_PER_CHAPTER_USD * model.repair.chapters).toFixed(2) +
                      (model.repair.becomeStills > 0
                        ? ` · ${model.repair.becomeStills} ${
                            model.repair.becomeStills === 1 ? 'becomes a still' : 'become stills'
                          }`
                        : '')
                    }
                    confirmLabel="Fix now"
                    consequence={
                      `Rewrites only the flagged briefs, one call per chapter ` +
                      `(${model.repair.chapters}). Slots already fetched for them are fetched again.` +
                      (model.repair.becomeStills > 0
                        ? ` ${model.repair.becomeStills} ${
                            model.repair.becomeStills === 1
                              ? 'becomes a generated still'
                              : 'become generated stills'
                          }, which adds to the Fetch estimate.`
                        : '')
                    }
                    onConfirm={() =>
                      act('repair', () => repairPlanAction(projectId), 'Fixing the flagged slots')
                    }
                  />
                ) : null}
                {/* Beside the spend it competes with (decision 252, amended):
                    the producer decides the plan reads wrong while looking at
                    the plan, not while looking at the book above it. */}
                <ConfirmButton
                  variant="outline"
                  confirmVariant="primary"
                  label={`Re-plan shot list · ${REPLAN_ESTIMATE}`}
                  confirmLabel="Re-plan now"
                  consequence={
                    'Every chapter is planned again from the saved direction.' +
                    (model.coverage.resolved > 0
                      ? ` ${model.coverage.resolved} slot${
                          model.coverage.resolved === 1 ? '' : 's'
                        } already fetched are discarded.`
                      : '') +
                    ' Any image model you picked per shot is discarded with them.'
                  }
                  onConfirm={() =>
                    act('replan', () => replanShotsAction(projectId), 'Re-planning the shot list')
                  }
                />
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* Scrubber + filmstrip                                                */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              disabled={!playable}
              aria-label={playing ? 'Pause narration' : 'Play narration'}
              onClick={() => {
                const audio = audioRef.current
                if (!audio) return
                if (playing) {
                  audio.pause()
                } else if (audio.src) {
                  void audio.play().catch(() => setPlaying(false))
                } else {
                  seekToMs(0, true)
                }
              }}
            >
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
              {playing ? 'Pause' : 'Play'}
            </Button>
            <span className="font-mono text-[12px] text-[var(--color-text-secondary)]">
              {timecode(positionMs)} / {timecode(model.totalMs)}
            </span>
            {!playable ? (
              <span className="text-[12px] text-[var(--color-text-muted)]">
                No narration audio to scrub — the board still reviews.
              </span>
            ) : null}
          </div>

          {/* The timeline as slot bands — presentational only. Jumping is the
              filmstrip's and the cards' job, whose targets clear 40px; a 12px
              band could never be a legal button under spec 11.1. */}
          <div
            className="relative flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-background)]"
            aria-hidden
          >
            {allSlots.map((slot) => (
              <div
                key={slot.id}
                title={`${slotTypeLabel(slot.type)} · ${timecode(slot.startMs)}`}
                className="h-full border-r border-[var(--color-surface)]"
                style={{
                  width: `${model.totalMs > 0 ? (slot.durationMs / model.totalMs) * 100 : 0}%`,
                  background:
                    slot.status === 'placeholder'
                      ? 'var(--color-warning)'
                      : slot.status === 'unresolved'
                        ? 'var(--color-border-strong)'
                        : 'var(--color-accent)',
                  opacity: 0.55,
                }}
              />
            ))}
            <div
              className="pointer-events-none absolute top-0 h-full w-[2px] bg-[var(--color-text-primary)]"
              style={{ left: `${model.totalMs > 0 ? (positionMs / model.totalMs) * 100 : 0}%` }}
            />
          </div>

          {/* Filmstrip: one thumb per slot, in narration order. */}
          <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Filmstrip">
            {allSlots.map((slot) => {
              const chosen = slot.candidates.find((candidate) => candidate.chosen)
              const thumb = chosen ? candidateThumb(chosen) : undefined
              return (
                <button
                  key={slot.id}
                  type="button"
                  role="listitem"
                  onClick={() => jumpToSlot(slot)}
                  className="flex h-[64px] w-[96px] shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] text-[10px] text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
                  aria-label={`Jump to ${slotTypeLabel(slot.type)} slot at ${timecode(slot.startMs)}`}
                >
                  {thumb ? (
                    // Plain <img> on purpose: provider-CDN and data: thumbnails,
                    // which next/image can neither optimise nor allowlist.
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <>
                      <span className="font-mono uppercase">{slotTypeLabel(slot.type)}</span>
                      <span className="font-mono">{timecode(slot.startMs)}</span>
                    </>
                  )}
                </button>
              )
            })}
          </div>

          <audio
            ref={audioRef}
            className="hidden"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = pendingSeekSec.current
              pendingSeekSec.current = 0
            }}
            onTimeUpdate={(event) => {
              const segment = model.segments[segmentIndex]
              if (segment) setPositionMs(segment.startMs + event.currentTarget.currentTime * 1000)
            }}
            onEnded={() => {
              // Continue into the next paragraph that has audio; stop at the end.
              let next = segmentIndex + 1
              while (next < model.segments.length && model.segments[next]?.takeId === null)
                next += 1
              const segment = model.segments[next]
              if (segment) loadSegment(next, 0, true)
              else setPlaying(false)
            }}
          />
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Slot cards, by chapter                                              */}
      {/* ------------------------------------------------------------------ */}
      {model.chapters.map((chapter) => (
        <section key={chapter.chapterIndex} className="flex flex-col gap-3">
          <h2 className="text-[15px] font-semibold">
            Chapter {chapter.chapterIndex + 1} — {chapter.chapterTitle}
          </h2>
          {chapter.slots.map((slot) => (
            <SlotCard
              key={slot.id}
              slot={slot}
              projectId={projectId}
              colors={colors}
              brand={brand}
              busy={busySlot === slot.id}
              act={act}
              phase={model.phase}
              articleClaims={model.articleClaims}
              sources={allSlots}
            />
          ))}
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One slot
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  projectId,
  colors,
  brand,
  busy,
  act,
  phase,
  articleClaims,
  sources,
}: {
  slot: SlotView
  projectId: string
  colors: BrandChartColors
  brand: BrandKitStored
  busy: boolean
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  phase: VisualsReviewModel['phase']
  articleClaims: ArticleClaimOption[]
  sources: SlotView[]
}) {
  const [editing, setEditing] = React.useState(false)
  const [rebriefing, setRebriefing] = React.useState(false)
  const [reusing, setReusing] = React.useState(false)
  // Which candidate the lightbox shows, or null when it is closed. Opens on
  // the current choice, since "how does the selected media actually look at
  // size" is the question the button answers.
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null)
  const brief = slot.brief
  const planning = phase === 'plan'
  const linked = slot.reuse
  const lends = sources.filter((other) => other.reuse?.sourceSlotId === slot.id)
  const picture = REUSABLE_SLOT_TYPES.includes(slot.type as (typeof REUSABLE_SLOT_TYPES)[number])

  return (
    <Card id={`slot-${slot.id}`}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={slot.type} />
          {/* During plan review an unresolved slot is not late, it is a plan. */}
          <StatusChip status={planning && slot.status === 'unresolved' ? 'planned' : slot.status} />
          {linked ? (
            <Badge tone="muted">
              Reused from ch {linked.chapterIndex + 1} · {timecode(linked.startMs)}
            </Badge>
          ) : null}
          <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
            {timecode(slot.startMs)} · {Math.round(slot.durationMs / 1000)}s
          </span>
        </div>
        {brief ? (
          <CardTitle className="text-[13px] font-normal text-[var(--color-text-secondary)]">
            “{brief.coversText}”
          </CardTitle>
        ) : null}
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {brief ? (
          <p className="text-[13px] text-[var(--color-text-primary)]">{brief.description}</p>
        ) : null}

        {/*
          What this brief actually calls on from the reference libraries. A
          brief that names nobody is generated with no photograph at all, and
          until this row existed that was indistinguishable on screen from a
          brief that names someone — the one thing the producer most needs to
          see before pressing Fetch, since it decides whether the money buys
          a likeness or a stranger.
        */}
        {slot.references.length > 0 ? (
          <div className="flex flex-wrap gap-1" aria-label="References this brief uses">
            {slot.references.map((reference) => (
              <ReferenceChip key={`${reference.kind}-${reference.name}`} reference={reference} />
            ))}
          </div>
        ) : null}

        {linked && slot.candidates.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Reuses the shot at {timecode(linked.startMs)}, which has none yet.
            {planning
              ? ' Fetch visuals copies it when that slot lands.'
              : ' Fetch or regenerate that slot, then pick it again.'}
          </p>
        ) : null}
        {lends.length > 0 ? (
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Also used at {lends.map((other) => timecode(other.startMs)).join(', ')}.
          </p>
        ) : null}

        {/* The type-specific middle. */}
        {slot.briefError ? (
          <ChartErrorCard message={slot.briefError} />
        ) : brief?.type === 'chart' ? (
          <div className="flex flex-col gap-2">
            <ChartPreview brief={brief} colors={colors} />
            <p className="text-[12px] text-[var(--color-text-secondary)]">{brief.takeaway}</p>
            <div className="flex flex-wrap gap-1" aria-label="Source claims">
              {brief.dataRefs.map((claimId, index) => (
                <span
                  key={claimId}
                  title={claimId}
                  className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
                >
                  claim {index + 1}
                </span>
              ))}
            </div>
          </div>
        ) : brief?.type === 'map' ? (
          <MapPreview brief={brief} colors={colors} />
        ) : brief?.type === 'headline' ? (
          <HeadlineSlot slot={slot} brief={brief} projectId={projectId} act={act} colors={colors} />
        ) : brief?.type === 'graphic' ? (
          <GraphicSlot slot={slot} brief={brief} projectId={projectId} act={act} brand={brand} />
        ) : brief?.type === 'hero' ? (
          <p className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-muted)]">
            AI video (hero) is switched off until post-monetisation. This slot stays a placeholder;
            the brief is kept for the day the flag flips.
          </p>
        ) : (
          <CandidateStrip slot={slot} projectId={projectId} act={act} />
        )}

        {slot.status === 'placeholder' && brief?.type === 'archival' ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            Real footage is yours to source — nothing is fetched for this slot. The brief says what
            to look for and what it must show; upload the image or clip when you have it.
          </p>
        ) : null}

        {/* A policy refusal (decision 252): the two ways out, on the card. */}
        {!linked && slot.refusal && brief?.type === 'still' ? (
          <div
            className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-warning)] p-3"
            role="group"
            aria-label="Refused by the image model"
          >
            <p className="text-[13px] text-[var(--color-warning)]">
              The image model declined this person: {slot.refusal.reason}
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Redirect the scene to the same beat without the likeness, or upload a real image. It
              should show: {brief.description}
              {brief.depicts?.length ? ` Showing ${brief.depicts.join(', ')}.` : ''}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                busy={busy}
                onClick={() =>
                  act(
                    slot.id,
                    () => redirectSceneAction(projectId, slot.id),
                    'Redirecting the scene',
                  )
                }
              >
                Redirect the scene · ≈$0.02
              </Button>
              <UploadOwnButton projectId={projectId} slotId={slot.id} act={act} archival={false} />
            </div>
          </div>
        ) : null}

        {slot.status === 'placeholder' &&
        !slot.refusal &&
        brief?.type !== 'hero' &&
        brief?.type !== 'archival' ? (
          <p className="text-[13px] text-[var(--color-warning)]">
            Nothing usable was found for this slot. Edit the brief and re-fetch, or upload your own
            image — approving the board with this still a placeholder must say so explicitly.
          </p>
        ) : null}

        {slot.status === 'unresolved' && !planning ? (
          <p className="text-[13px] text-[var(--color-text-muted)]" role="status">
            Being fetched — this row updates itself when candidates land.
          </p>
        ) : null}

        {/* The format picker (staged-visuals design): the suggested type is a
            suggestion, not a lock. Chart and map conversions get their
            structured data drafted by the model, then land back here to edit. */}
        {!linked && brief && !slot.briefError ? (
          <TypePicker
            slot={slot}
            projectId={projectId}
            act={act}
            busy={busy}
            articleClaims={articleClaims}
          />
        ) : null}

        {/* Repairs. Chart and map slots are edited through their briefs too,
            but their data is claim-sourced — the useful repair is re-fetch
            after a dossier change, which Regenerate covers. */}
        {brief && !slot.briefError ? (
          <div className="flex flex-wrap items-center gap-2">
            {slot.candidates.length > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  const chosen = slot.candidates.findIndex((candidate) => candidate.chosen)
                  setPreviewIndex(chosen === -1 ? 0 : chosen)
                }}
              >
                <Maximize2 aria-hidden />
                Preview
              </Button>
            ) : null}
            {brief.type !== 'hero' ? (
              <>
                <Button
                  variant="outline"
                  busy={busy && editing}
                  onClick={() => setEditing((value) => !value)}
                >
                  <Search aria-hidden />
                  {editing
                    ? 'Close brief editor'
                    : planning || brief.type === 'archival' || linked !== null
                      ? 'Edit brief'
                      : 'Edit brief & re-fetch'}
                </Button>
                {/* A card that lends its shot does not offer the picker: a
                    link from it would be a chain, which the action refuses. */}
                {picture && !linked && lends.length === 0 ? (
                  <Button
                    variant="outline"
                    aria-expanded={reusing}
                    onClick={() => setReusing((value) => !value)}
                  >
                    {reusing ? 'Close shot picker' : 'Use an existing shot'}
                  </Button>
                ) : null}
                {linked ? (
                  <Button
                    variant="outline"
                    busy={busy}
                    onClick={() =>
                      act(
                        slot.id,
                        () => unlinkSlotReuseAction(projectId, slot.id),
                        'This slot will fetch its own shot again',
                      )
                    }
                  >
                    Choose its own shot
                  </Button>
                ) : null}
                {/* Editing the words yourself and re-planning the whole film
                    were the only two ways to change an idea (decision 258).
                    A headline card is never offered one: every word on it is
                    read from the article, so there is no idea to have again. */}
                {!linked && brief.type !== 'headline' ? (
                  <Button
                    variant="outline"
                    busy={busy && rebriefing}
                    disabled={slot.retype?.state === 'rebriefing'}
                    aria-expanded={rebriefing}
                    onClick={() => setRebriefing((value) => !value)}
                  >
                    {rebriefing ? 'Close' : 'Draft a different brief'}
                  </Button>
                ) : null}
                {/* Real footage has nothing to fetch (decision 214): the
                    brief guides the owner's own search, so the only actions
                    are editing it and uploading against it. */}
                {!linked && brief.type !== 'archival' ? (
                  <Button
                    variant="outline"
                    busy={busy && !editing}
                    onClick={() =>
                      act(
                        slot.id,
                        () =>
                          refetchSlotAction(
                            projectId,
                            slot.id,
                            planning ? 'Fetched early from the plan' : 'Regenerate',
                          ),
                        planning
                          ? 'Fetching this slot — the card updates when candidates land'
                          : 'Re-fetching — the row updates when new candidates land',
                      )
                    }
                  >
                    <RefreshCw aria-hidden />
                    {/* Two variants at the dearer generator's price (Gemini,
                        $0.04/image) — the label errs against the budget, like
                        every estimate. */}
                    {planning
                      ? brief.type === 'still'
                        ? 'Fetch this slot · ≈$0.08'
                        : 'Fetch this slot'
                      : brief.type === 'still'
                        ? 'Regenerate · ≈$0.08'
                        : 'Regenerate'}
                  </Button>
                ) : null}
              </>
            ) : null}
            {!linked &&
            (brief.type === 'stock' || brief.type === 'archival' || brief.type === 'still') ? (
              <UploadOwnButton
                projectId={projectId}
                slotId={slot.id}
                act={act}
                archival={brief.type === 'archival'}
              />
            ) : null}
          </div>
        ) : null}

        {editing && brief ? (
          <BriefEditor
            slot={slot}
            projectId={projectId}
            act={act}
            onDone={() => setEditing(false)}
            planning={planning || linked !== null}
          />
        ) : null}

        {rebriefing && brief ? (
          <RebriefForm
            slot={slot}
            projectId={projectId}
            act={act}
            onDone={() => setRebriefing(false)}
          />
        ) : null}

        {reusing ? (
          <ReusePicker
            slot={slot}
            sources={sources}
            phase={phase}
            projectId={projectId}
            act={act}
            onDone={() => setReusing(false)}
          />
        ) : null}

        {previewIndex !== null ? (
          <MediaLightbox
            slot={slot}
            projectId={projectId}
            index={Math.min(previewIndex, slot.candidates.length - 1)}
            onIndexChange={setPreviewIndex}
            onClose={() => setPreviewIndex(null)}
            act={act}
            busy={busy}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * What the card says is being drafted, per target.
 *
 * A lookup rather than a ternary on purpose (fixed 2026-09-18): the two-way
 * version called everything that was not a chart a map, so the day a seventh
 * format arrived the card started announcing map locations for it.
 */
const DRAFTING_NOUN: Record<string, string> = {
  chart: 'chart series and claim refs',
  map: 'map locations',
}
const draftingNoun = (target: string): string =>
  DRAFTING_NOUN[target] ?? `${slotTypeLabel(target)} brief`

/**
 * Which article a headline card quotes (decision 257).
 *
 * The only decision a re-type to headline carries, and the owner's to make.
 * Every string on the card is read from the article itself, so there is
 * nothing here for a model to draft and no call to pay for: the list is this
 * project's news-sourced claims, and picking one writes the brief on the spot.
 * An empty list is an answer, not an error state.
 */
function ArticleChooser({
  slot,
  projectId,
  act,
  busy,
  articleClaims,
  onDone,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  busy: boolean
  articleClaims: ArticleClaimOption[]
  onDone: () => void
}) {
  // What this card quotes today, when it is already a headline: that row is
  // marked and cannot be re-picked, and every other row moves the card.
  const quoting = slot.brief?.type === 'headline' ? slot.brief.sourceClaimId : null

  return (
    <div
      role="group"
      aria-label="Which article this card quotes"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border-strong)] p-2"
    >
      {articleClaims.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          A headline card quotes a real news article, and no claim in this project’s dossier has one
          behind it yet. Source a claim to a news outlet on the dossier screen, then come back.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {quoting === null
              ? 'Pick the article. Every word on the card is read from it: the outlet, the headline, the byline and the date.'
              : 'Pick a different article. The card is redrawn from that one, and a highlight you set for this headline is dropped rather than moved across.'}
          </p>
          {articleClaims.map((claim) => (
            <div key={claim.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">
                <span className="text-[var(--color-text-secondary)]">{claim.label}</span>{' '}
                <span className="text-[var(--color-text-muted)]">·</span> {claim.text}
              </span>
              {claim.id === quoting ? (
                <Badge shape="tag">quoted now</Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  busy={busy}
                  onClick={() =>
                    void act(
                      slot.id,
                      () => retypeToHeadlineAction(projectId, slot.id, claim.id),
                      `Now quoting ${claim.label}`,
                    ).then((result) => {
                      if (result.ok) onDone()
                    })
                  }
                >
                  Quote this
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

/**
 * The format picker: one labelled button per slot type, the current one
 * pressed. Re-typing to a text-driven type converts inside the click — the
 * badge changes on the refresh the button itself triggers. Chart and map
 * need a model draft, so the card says `drafting` until it lands (or shows
 * the model's refusal, dismissably). Headline asks instead of converting: it
 * opens the chooser, because only the owner may say which article is quoted.
 * Hero stays off the picker while its flag is down — a button that always
 * errors is not a button.
 */
function TypePicker({
  slot,
  projectId,
  act,
  busy,
  articleClaims,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  busy: boolean
  articleClaims: ArticleClaimOption[]
}) {
  const types = SHOT_SLOT_TYPES.filter((type) => type !== 'hero' || slot.type === 'hero')
  const job = slot.retype
  // Either kind of model job holds every button: a second request racing the
  // first would write over whichever landed last.
  const drafting = job?.state === 'drafting' || job?.state === 'rebriefing'
  const refused = job?.state === 'refused' ? job : null
  const rebriefRefused = job?.state === 'rebrief-refused' ? job : null
  const [choosing, setChoosing] = React.useState(false)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Slot format">
        <span className="text-[11px] text-[var(--color-text-muted)]">Format</span>
        {types.map((type) => {
          const current = type === slot.type
          // Headline is the one format that cannot be chosen by pressing a
          // button: the card quotes an article, and which one is the owner's
          // to say (decision 257). So this button opens the chooser below.
          const asks = type === 'headline'
          return (
            <Button
              key={type}
              variant={current ? 'selected' : 'ghost'}
              aria-pressed={current}
              {...(asks ? { 'aria-expanded': choosing } : {})}
              /* The one exception to "the current format is disabled": on a
                 headline slot this button is not how you change the format,
                 it is how you change WHICH article the card quotes. */
              disabled={(current && !asks) || busy || drafting}
              onClick={() => {
                if (asks) {
                  setChoosing((open) => !open)
                  return
                }
                // Any other format answers the question the chooser was
                // asking, so it goes away with the answer.
                setChoosing(false)
                void act(
                  slot.id,
                  () => retypeSlotAction(projectId, slot.id, type),
                  type === 'chart' || type === 'map' || type === 'graphic'
                    ? `Drafting the ${type} — this card updates when it lands`
                    : `Re-typed to ${slotTypeLabel(type)}`,
                )
              }}
            >
              {slotTypeLabel(type)}
            </Button>
          )
        })}
      </div>

      {choosing ? (
        <ArticleChooser
          slot={slot}
          projectId={projectId}
          act={act}
          busy={busy}
          articleClaims={articleClaims}
          onDone={() => setChoosing(false)}
        />
      ) : null}

      {job?.state === 'drafting' ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]" role="status">
          Claude is drafting the {draftingNoun(job.target)}. This card updates when it lands.
        </p>
      ) : null}

      {job?.state === 'rebriefing' ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]" role="status">
          Claude is drafting a new brief. This card updates when it lands.
        </p>
      ) : null}

      {refused ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-warning)] p-2"
        >
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">
            Could not re-type to {slotTypeLabel(refused.target)}: {refused.reason} The slot keeps
            its current brief.
          </p>
          <Button
            variant="outline"
            busy={busy}
            onClick={() => act(slot.id, () => dismissRetypeAction(projectId, slot.id), 'Dismissed')}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {rebriefRefused ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-warning)] p-2"
        >
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">
            No new brief: {rebriefRefused.reason} The slot keeps the one it has.
          </p>
          <Button
            variant="outline"
            busy={busy}
            onClick={() => act(slot.id, () => dismissRetypeAction(projectId, slot.id), 'Dismissed')}
          >
            Dismiss
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The enlarged view of a slot's candidates: one at a time at real size, with
 * the same choose action the strip has — judging a clip at thumbnail size
 * and committing to it full-screen are different acts, and the second is the
 * one the gate's approval is really about. Videos play here (muted, looped),
 * which the 168px strip cannot do at all.
 */
function MediaLightbox({
  slot,
  projectId,
  index,
  onIndexChange,
  onClose,
  act,
  busy,
}: {
  slot: SlotView
  projectId: string
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  busy: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement | null>(null)
  const candidate = slot.candidates[index]

  // Escape closes — on top of the visible Close button, never instead of it.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  React.useEffect(() => {
    closeRef.current?.focus()
  }, [])

  if (!candidate) return null
  const full = candidateFull(candidate)
  const chosen = candidate.chosen === true

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${slot.brief?.coversText ?? slot.id}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(event) => {
        // The backdrop, not anything inside the panel.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-[960px] flex-col gap-3 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              “{slot.brief?.coversText}”
            </p>
            <p className="font-mono text-[11px] text-[var(--color-text-muted)]">
              {candidate.kind}
              {candidate.score !== undefined ? ` · score ${Math.round(candidate.score)}` : ''}
              {` · candidate ${index + 1} of ${slot.candidates.length}`}
            </p>
          </div>
          <Button ref={closeRef} variant="ghost" onClick={onClose}>
            <X aria-hidden />
            Close
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center rounded-[8px] bg-[var(--color-background)]">
          {full && candidate.kind === 'video' ? (
            // Muted + looped: this is a framing check, and the narration is
            // the scrubber's job. Provider CDN URLs are fine here — the
            // board's preview is exactly what they are for.
            <video
              src={full}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="max-h-[60vh] max-w-full rounded-[8px]"
              aria-label={candidate.summary ?? candidate.id}
            />
          ) : full ? (
            // Plain <img> on purpose: provider-CDN and data: sources, which
            // next/image can neither optimise nor allowlist.
            <img
              src={full}
              alt={candidate.summary ?? candidate.id}
              className="max-h-[60vh] max-w-full rounded-[8px] object-contain"
            />
          ) : (
            <p className="p-8 text-[13px] text-[var(--color-text-muted)]">
              This candidate has no previewable media URL.
            </p>
          )}
        </div>

        <p className="text-[11px] text-[var(--color-text-muted)]">
          {candidate.licence}
          {candidate.attributionText ? ` · ${candidate.attributionText}` : ''}
          {candidate.references && candidate.references.length > 0
            ? ` · reference: ${candidate.references.join(', ')}`
            : ''}
          {candidate.summary ? ` · ${candidate.summary}` : ''}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={index === 0}
              onClick={() => onIndexChange(index - 1)}
            >
              <ChevronLeft aria-hidden />
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={index >= slot.candidates.length - 1}
              onClick={() => onIndexChange(index + 1)}
            >
              Next
              <ChevronRight aria-hidden />
            </Button>
          </div>
          <Button
            variant="primary"
            disabled={chosen}
            busy={busy}
            onClick={() =>
              act(
                slot.id,
                () => chooseCandidateAction(projectId, slot.id, candidate.id),
                'Selected',
              )
            }
          >
            {chosen ? 'Selected for this slot' : 'Use this candidate'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function CandidateStrip({
  slot,
  projectId,
  act,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
}) {
  if (slot.candidates.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2" role="list" aria-label="Candidates">
        {slot.candidates.map((candidate) => {
          const thumb = candidateThumb(candidate)
          const chosen = candidate.chosen === true
          return (
            <button
              key={candidate.id}
              type="button"
              role="listitem"
              disabled={chosen}
              onClick={() =>
                act(
                  slot.id,
                  () => chooseCandidateAction(projectId, slot.id, candidate.id),
                  'Selected',
                )
              }
              title={[
                candidate.summary,
                candidate.score !== undefined
                  ? `score ${Math.round(candidate.score)}: ${candidate.scoreReason ?? ''}`
                  : null,
              ]
                .filter(Boolean)
                .join(' — ')}
              className={`relative flex h-[104px] w-[168px] flex-col overflow-hidden rounded-[8px] border-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ${
                chosen
                  ? 'border-[var(--color-accent)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
              }`}
            >
              {thumb ? (
                // Plain <img> on purpose: provider-CDN and data: thumbnails,
                // which next/image can neither optimise nor allowlist.
                <img
                  src={thumb}
                  alt={candidate.summary ?? candidate.id}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-[var(--color-background)] p-2 text-center text-[11px] text-[var(--color-text-muted)]">
                  {candidate.summary ?? candidate.id}
                </span>
              )}
              <span className="absolute top-1 left-1 rounded-[4px] bg-black/60 px-1 font-mono text-[10px] text-white uppercase">
                {candidate.kind}
                {candidate.score !== undefined ? ` · ${Math.round(candidate.score)}` : ''}
              </span>
              {chosen ? (
                <span className="absolute right-1 bottom-1 rounded-[4px] bg-[var(--color-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  Selected
                </span>
              ) : null}
            </button>
          )
        })}
        {slot.extraCandidates > 0 ? (
          <span className="self-center text-[11px] text-[var(--color-text-muted)]">
            +{slot.extraCandidates} more fetched
          </span>
        ) : null}
      </div>
      <ChosenFacts slot={slot} />
    </div>
  )
}

/** Licence and attribution of the current choice — the audit line. */
function ChosenFacts({ slot }: { slot: SlotView }) {
  const chosen = slot.candidates.find((candidate) => candidate.chosen)
  if (!chosen) return null
  return (
    <p className="text-[11px] text-[var(--color-text-muted)]">
      {chosen.licence}
      {chosen.attributionText ? ` · ${chosen.attributionText}` : ''}
      {chosen.references && chosen.references.length > 0
        ? ` · reference: ${chosen.references.join(', ')}`
        : ''}
      {chosen.pageUrl ? (
        <>
          {' · '}
          {/* Padded to the 40px hit target the sweep enforces — a bare text
              link at caption size is an illegal control under spec 11.1. */}
          <a
            href={chosen.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[40px] items-center px-1 underline hover:text-[var(--color-text-secondary)]"
          >
            source
          </a>
        </>
      ) : null}
    </p>
  )
}

/**
 * "Draft a different brief" (decision 258): the idea is rejected, and the
 * owner may say what they are picturing instead.
 *
 * The steer is optional on purpose. "I do not like this one, give me another"
 * is a complete instruction, and demanding a reason for it would turn a small
 * button into a form to fill in. It is also one-off: it steers this draft and
 * is not kept, which the form says plainly rather than letting the owner
 * discover it when a re-plan wipes the result.
 */
function RebriefForm({
  slot,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  onDone: () => void
}) {
  const [guidance, setGuidance] = React.useState('')

  return (
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () => rebriefSlotAction(projectId, slot.id, guidance),
          'Drafting a new brief — this card updates when it lands',
        ).then((result) => {
          if (result.ok) onDone()
        })
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        What are you picturing? (optional)
        <textarea
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          rows={2}
          maxLength={600}
          placeholder="Leave this empty to just ask for a different idea."
          className="rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        />
      </label>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        This replaces the brief this slot has. The steer is used once and not kept, so re-planning
        the shot list later will draft this slot again from the Director&rsquo;s Book.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Draft it
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** The pictures a source can lend: its chosen one, then anything whose bytes the app holds. */
function lendable(source: SlotView): SlotCandidate[] {
  return source.candidates.filter(
    (candidate) =>
      candidate.chosen === true || candidate.assetId !== undefined || candidate.r2Key !== undefined,
  )
}

/**
 * "Use an existing shot" (decision 261): the film's other picture slots and,
 * for each, the shots it holds that this slot could show instead of fetching
 * its own. Built from the model the board already loaded; nothing is queried.
 *
 * Before Fetch nothing has a picture yet, so a row carries one button and the
 * link is filled when the fan-out lands. On the board a slot with nothing to
 * lend is not offered: no copy step runs there, so a link to it would never
 * be filled. Dependants are not offered either; the original is.
 */
function ReusePicker({
  slot,
  sources,
  phase,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  sources: SlotView[]
  phase: VisualsReviewModel['phase']
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  onDone: () => void
}) {
  const planning = phase === 'plan'
  const offered = sources.filter(
    (source) =>
      source.id !== slot.id &&
      REUSABLE_SLOT_TYPES.includes(source.type as (typeof REUSABLE_SLOT_TYPES)[number]) &&
      source.reuse === null &&
      (planning || lendable(source).length > 0),
  )

  const use = (source: SlotView, candidateId: string | undefined) =>
    void act(
      slot.id,
      () => reuseSlotShotAction(projectId, slot.id, source.id, candidateId),
      planning
        ? 'Linked. Fetch visuals will copy the shot when it lands'
        : `Now showing the shot from ${timecode(source.startMs)}`,
    ).then((result) => {
      if (result.ok) onDone()
    })

  return (
    <div
      role="group"
      aria-label="Shots to reuse"
      className="flex flex-col gap-3 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <p className="text-[12px] text-[var(--color-text-muted)]">
        {planning
          ? 'Fetch visuals will skip this slot and copy the shot the one you pick ends up with.'
          : 'This slot shows the shot you pick instead of fetching its own.'}
        {slot.candidates.length > 0
          ? ` This replaces the ${slot.candidates.length} candidate${
              slot.candidates.length === 1 ? '' : 's'
            } fetched for this slot.`
          : ''}
      </p>
      {offered.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No other stock, AI image or real-footage slot in this film has a shot to offer yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {offered.map((source) => {
            const pictures = lendable(source)
            // The row is named because every row's buttons read "Use this":
            // without a name on the row a screen reader hears the same label
            // three times and nothing says which shot each belongs to.
            return (
              <li
                key={source.id}
                role="group"
                aria-label={`Shot at ${timecode(source.startMs)}`}
                className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-text-secondary)]">
                  <span className="font-mono text-[11px]">
                    ch {source.chapterIndex + 1} · {timecode(source.startMs)}
                  </span>
                  <span>{describeGap(slot.startMs, source.startMs)}</span>
                  {Math.abs(source.startMs - slot.startMs) < CLOSE_REUSE_MS ? (
                    <Badge tone="warning">plays within a minute of this slot</Badge>
                  ) : null}
                </div>
                {source.brief ? (
                  <p className="text-[13px] text-[var(--color-text-primary)]">
                    “{source.brief.coversText}”
                  </p>
                ) : null}
                {source.brief ? (
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    {source.brief.description}
                  </p>
                ) : null}
                {pictures.length === 0 ? (
                  <div>
                    <Button variant="outline" onClick={() => use(source, undefined)}>
                      Use whatever this slot chooses
                    </Button>
                  </div>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label="Shots this slot can lend">
                    {pictures.map((candidate) => {
                      const thumb = candidateThumb(candidate)
                      return (
                        <li key={candidate.id} className="flex flex-col items-start gap-1">
                          {thumb ? (
                            <img
                              src={thumb}
                              alt=""
                              className="h-16 w-28 rounded-[6px] object-cover"
                            />
                          ) : null}
                          <Button variant="outline" onClick={() => use(source, candidate.id)}>
                            {candidate.chosen ? 'Use this' : 'Use this variant'}
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <div>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** The two image providers as people write them, not as the code keys them. */
const PROVIDER_LABELS: Record<StillProvider, string> = { google: 'Google', fal: 'fal.ai' }

/** A model's label off its own adapter, or the stored id itself if the adapter no longer lists it. */
function stillModelLabel(provider: StillProvider, model: string): string {
  try {
    return imageGenModel(LIVE_IMAGE_GEN_ADAPTERS[provider], model).label
  } catch {
    return model
  }
}

/**
 * The model select on a still or hero brief (decision 264): what the routing
 * rule would pick, plus every model either image provider offers, so the
 * owner can see the plan's own choice and put it back. Changing it writes at
 * once. Nothing here waits on the form's Save button, because the model is
 * not a word in the brief, it is which generator spends the money.
 */
function ModelRouteSelect({
  slot,
  projectId,
  act,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
}) {
  const id = `route-${slot.id}`
  const value = slot.route ? `${slot.route.provider}:${slot.route.model}` : ''
  const defaultLabel = stillModelLabel(slot.derivedRoute.provider, slot.derivedRoute.model)

  return (
    <div className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
      <Label htmlFor={id}>Image model</Label>
      <Select
        id={id}
        value={value}
        onChange={(event) => {
          const raw = event.target.value
          const route =
            raw === ''
              ? null
              : ((): { provider: string; model: string } => {
                  const at = raw.indexOf(':')
                  return { provider: raw.slice(0, at), model: raw.slice(at + 1) }
                })()
          void act(
            slot.id,
            () => setSlotRouteAction(projectId, slot.id, route),
            'Model changed; re-fetch this shot to buy it',
          )
        }}
      >
        <option value="">{`Planned default (${defaultLabel})`}</option>
        {STILL_PROVIDERS.map((provider) => (
          <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
            {LIVE_IMAGE_GEN_ADAPTERS[provider].models.map((candidate) => (
              <option key={`${provider}:${candidate.id}`} value={`${provider}:${candidate.id}`}>
                {candidate.label}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  )
}

function BriefEditor({
  slot,
  projectId,
  act,
  onDone,
  planning,
}: {
  slot: SlotView
  projectId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  onDone: () => void
  /** Plan phase: an edit just saves — nothing is fetched until "Fetch visuals". */
  planning: boolean
}) {
  const brief = slot.brief
  const [description, setDescription] = React.useState(brief?.description ?? '')
  const [query, setQuery] = React.useState(
    brief && (brief.type === 'stock' || brief.type === 'archival') ? brief.query : '',
  )
  const [mustShow, setMustShow] = React.useState(brief?.type === 'archival' ? brief.mustShow : '')
  const [prompt, setPrompt] = React.useState(brief?.type === 'still' ? brief.prompt : '')
  if (!brief) return null

  const field =
    'rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'

  return (
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () =>
            editBriefAction(projectId, slot.id, {
              description,
              ...(brief.type === 'stock' || brief.type === 'archival' ? { query } : {}),
              ...(brief.type === 'archival' ? { mustShow } : {}),
              ...(brief.type === 'still' ? { prompt } : {}),
            }),
          planning || brief.type === 'archival'
            ? 'Brief saved'
            : 'Brief saved — re-fetching against it now',
        ).then((result) => {
          if (result.ok) onDone()
        })
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        Visual description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          className={field}
        />
      </label>
      {brief.type === 'stock' || brief.type === 'archival' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          {/* Same stored field, different job: stock sends it to an API,
              archival hands it to the human as search guidance. */}
          {brief.type === 'archival' ? 'Where to look' : 'Search query'}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={field}
          />
        </label>
      ) : null}
      {brief.type === 'archival' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Must show
          <input
            value={mustShow}
            onChange={(event) => setMustShow(event.target.value)}
            className={field}
          />
        </label>
      ) : null}
      {brief.type === 'still' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Generation prompt
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={3}
            className={field}
          />
        </label>
      ) : null}
      {brief.type === 'still' || brief.type === 'hero' ? (
        <ModelRouteSelect slot={slot} projectId={projectId} act={act} />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary">
          {planning || brief.type === 'archival'
            ? 'Save'
            : `Save & re-fetch${brief.type === 'still' ? ' · ≈$0.08' : ''}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Repeated server-side; here so an oversized pick fails before uploading. */
const UPLOAD_OWN_IMAGE_MAX_BYTES = 8 * 1024 * 1024
const UPLOAD_OWN_VIDEO_MAX_BYTES = 200 * 1024 * 1024

/** Duration and dimensions, read from the picked video before it uploads. */
function readVideoMetadata(
  file: File,
): Promise<{ durationMs: number; width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve({
        durationMs: Math.round(video.duration * 1000),
        width: video.videoWidth,
        height: video.videoHeight,
      })
    }
    // Unreadable metadata is not a reason to refuse the upload — the server
    // stores what it gets and the compiler treats it like any other clip.
    video.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(undefined)
    }
    video.src = url
  })
}

/**
 * Browser → R2 directly (decision 213, the decision-205 shape): Vercel
 * refuses request bodies over about 4.5 MB at its edge, so the file can
 * never travel through a server action. Presign, PUT, then finalise —
 * all three steps inside one `act` call so the button gets a busy state
 * and every failure gets a toast. Archival slots take real footage, image
 * or video (decision 214); everything else takes a poster image. Either kind
 * of slot also takes an image by web address, fetched and stored server-side
 * exactly as the Cast card does it (decision 214, amended).
 */
function UploadOwnButton({
  projectId,
  slotId,
  act,
  archival,
}: {
  projectId: string
  slotId: string
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
  archival: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [url, setUrl] = React.useState('')

  const upload = async (picked: File): Promise<ActionResult> => {
    // An AVIF becomes a JPEG first; video passes straight through untouched
    // (decision 266). The size check below then measures what is uploaded.
    const ready = await toUploadableImage(picked)
    if (!ready.ok) return ready
    const file = ready.file

    const video = file.type.startsWith('video/')
    const maxBytes = video ? UPLOAD_OWN_VIDEO_MAX_BYTES : UPLOAD_OWN_IMAGE_MAX_BYTES
    if (file.size > maxBytes) {
      return {
        ok: false,
        error: `That file is over the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`,
      }
    }

    // The Uint8Array view matters: digest() rejects an ArrayBuffer from
    // another realm (jsdom in tests), and a fresh view is always local.
    const bytes = new Uint8Array(await file.arrayBuffer())
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const contentHash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')

    const created = await createOwnUploadAction({
      projectId,
      slotId,
      fileType: file.type,
      fileSize: file.size,
      contentHash,
    })
    if (!created.ok || !created.url) return created

    const put = await fetch(created.url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    })
    if (!put.ok) {
      return { ok: false, error: `Storage refused the upload (${put.status}). Try again.` }
    }

    const metadata = video ? await readVideoMetadata(file) : undefined
    return finaliseOwnUploadAction({
      projectId,
      slotId,
      fileType: file.type,
      fileName: file.name,
      contentHash,
      ...(metadata ?? {}),
    })
  }

  return (
    <>
      <Button variant="outline" onClick={() => inputRef.current?.click()}>
        <ImagePlus aria-hidden />
        {archival ? 'Upload footage' : 'Upload own'}
      </Button>
      {/* Real footage is usually found online, so saving it first only to
          upload it is a step for nothing (decision 214, amended). Images
          only: video still goes browser to R2 on the presigned path. */}
      <input
        type="url"
        value={url}
        placeholder="or paste an image address"
        aria-label={
          archival
            ? 'Add your real footage for this slot by image address'
            : 'Add your own image for this slot by image address'
        }
        onChange={(event) => setUrl(event.target.value)}
        className="min-w-[180px] flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px]"
      />
      <Button
        variant="outline"
        disabled={url.trim() === ''}
        onClick={() =>
          void act(
            slotId,
            async () => {
              const result = await addSlotImageFromUrlAction({ projectId, slotId, url })
              if (result.ok) setUrl('')
              return result
            },
            'Added and selected',
          )
        }
      >
        Add from address
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={
          archival
            ? 'image/png,image/jpeg,image/webp,image/avif,.avif,video/mp4,video/quicktime,video/webm'
            : 'image/png,image/jpeg,image/webp,image/avif,.avif'
        }
        className="hidden"
        aria-label={
          archival
            ? 'Upload your real footage for this slot — image or video'
            : 'Upload your own image for this slot'
        }
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void act(slotId, () => upload(file), 'Uploaded and selected')
        }}
      />
    </>
  )
}
