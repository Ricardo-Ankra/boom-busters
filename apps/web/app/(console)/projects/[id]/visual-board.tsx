'use client'

import {
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  ImagePlus,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RefreshCw,
  Search,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { SOCIAL_EXCERPT_TOO_LONG, SOCIAL_TOO_LONG } from '@boom-busters/compositions/social'
import {
  isFrontPage,
  JOB_STALE_MS,
  LOGO_ACCEPT,
  missingArticleFields,
  postPublicUrl,
  REUSABLE_SLOT_TYPES,
  SHOT_SLOT_TYPES,
  STILL_PROVIDERS,
  suggestEmphasis,
} from '@boom-busters/schemas'
import type {
  BrandKitStored,
  GraphicElement,
  GraphicScene,
  SetPlateView,
  ShotBrief,
  SlotCandidate,
  StillProvider,
  VisualsJobOp,
} from '@boom-busters/schemas'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { CandidateLightbox, candidateThumb } from '@/components/candidate-media'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmButton } from '@/components/confirm-button'
import { Label, Select } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { readImageSize, toUploadableImage, toUploadableLogo } from '@/lib/client-image'
import type { StillModelOption } from '@/lib/model-catalogue'
import type {
  ArticleClaimOption,
  PostClaimOption,
  SlotJobView,
  SlotReference,
  SlotView,
  VisualsJobView,
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
  refetchSocialPostAction,
  linkCastHandleAction,
  unlinkCastHandleAction,
  removeSocialImageAction,
  repairPlanAction,
  reuseSlotShotAction,
  saveHeadlineAction,
  saveSocialCardAction,
  saveSocialPostAction,
  setHeadlineArticleAction,
  setSocialPostAction,
  replanShotsAction,
  retypeSlotAction,
  rebriefSlotAction,
  retypeToHeadlineAction,
  retypeToSocialAction,
  setSlotRouteAction,
  showSetPhotoAction,
  unlinkSlotReuseAction,
  type ActionResult,
} from './visuals-actions'
import { CameraRow } from './camera-row'
import { DirectionCard } from './direction-card'
import {
  ChartErrorCard,
  ChartPreview,
  GraphicPreview,
  HeadlinePreview,
  MapPreview,
  type BrandChartColors,
} from './slot-previews'
import { SocialPreview } from './social-preview'

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

/**
 * The board's one runner (decision 240, brought to the board). `key` is what
 * it locks: a slot id, or one of the plan card's actions. `press` names the
 * control that spins while the rest of what `key` locks stands disabled.
 */
type Act = (
  key: string,
  run: () => Promise<ActionResult>,
  success: string,
  press?: string,
) => Promise<ActionResult>

/**
 * One slot's lock, from the press until the refreshed card is on screen:
 * `busy` holds every action on the card, `pressed` names the one that spins.
 * A context rather than a prop because it reaches a dozen nested controls,
 * and a control that forgot the prop was exactly how the board came to have
 * buttons that took a second click mid-save.
 */
interface SlotLock {
  busy: boolean
  pressed: string | null
}
const SlotLockContext = React.createContext<SlotLock>({ busy: false, pressed: null })

/** A key's entry on the board: the pressed control, and whether only the refresh is left. */
interface Lock {
  pressed: string | null
  settling: boolean
}
const useSlotLock = (): SlotLock => React.useContext(SlotLockContext)

/** The plan card's own keys: while any is in flight, none of them is offered. */
const PLAN_KEYS = ['plan', 'repair', 'replan', 'direction-save', 'direction-redraft'] as const

/**
 * The server's clock, carried forward here (decision 286): the model's
 * `renderedAt` plus the time that has passed in this browser since it arrived.
 * A browser clock that is hours out cannot lock a fresh card or unlock a live
 * one, and the first render matches the server's. Ticks every 15 s, only
 * while there is a stamp to age.
 */
function useServerNow(renderedAt: string, ticking: boolean): number {
  const base = Date.parse(renderedAt)
  const [now, setNow] = React.useState(base)
  React.useEffect(() => {
    const arrived = Date.now()
    setNow(base)
    if (!ticking) return
    const timer = window.setInterval(() => setNow(base + (Date.now() - arrived)), 15_000)
    return () => window.clearInterval(timer)
  }, [base, ticking])
  return now
}

const jobAgeMs = (startedAt: string, now: number) => Math.max(0, now - Date.parse(startedAt))
const jobIsLive = (startedAt: string, now: number) => jobAgeMs(startedAt, now) < JOB_STALE_MS

/** The amber line a stale stamp gets, on a card or on the plan card. */
function staleJobWords(startedAt: string, now: number): string {
  const minutes = Math.floor(jobAgeMs(startedAt, now) / 60_000)
  return `This has been running for ${minutes} minutes, longer than it should. It may have stopped. You can try again.`
}

/** Which plan-card control spins for a plan-level job (the decision 285 press names). */
const PLAN_JOB_PRESS: Record<VisualsJobOp, string> = {
  fetch: 'plan',
  repair: 'repair',
  shots: 'replan',
  direction: 'direction-redraft',
}

const PLAN_JOB_WORDS: Record<VisualsJobOp, { doing: string; then: string }> = {
  shots: { doing: 'Re-planning the shot list', then: ' The plan below is replaced when it lands.' },
  repair: { doing: 'Fixing the flagged slots', then: ' The flagged cards change when it lands.' },
  direction: {
    doing: 'Redrafting the direction',
    then: ' The book above is replaced when it lands.',
  },
  fetch: { doing: 'Sending the fetch', then: '' },
}

/** What a card says while its own job runs. */
function slotJobWords(job: SlotJobView, now: number, planning: boolean): string {
  const age = timecode(jobAgeMs(job.startedAt, now))
  if (job.kind === 'redirect') {
    return `Redirecting the scene without the likeness, started ${age} ago.`
  }
  return planning
    ? `Fetching this slot, started ${age} ago. The card updates when it lands.`
    : `Regenerating, started ${age} ago. The new candidates replace these when they land.`
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
  act: Act
  colors: BrandChartColors
}) {
  const article = slot.article
  const { busy, pressed } = useSlotLock()
  const [editing, setEditing] = React.useState(false)
  // A front page is no article (decision 280): the address form opens by
  // itself there, because the card cannot be right until it has one.
  const frontPage = article ? isFrontPage(article.url) : false
  const [addressing, setAddressing] = React.useState(frontPage)
  const [address, setAddress] = React.useState(frontPage ? '' : (article?.url ?? ''))

  if (!article) {
    return (
      <p className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-muted)]">
        The claim this card cites no longer has a source to read. Give the claim a source URL on the
        dossier screen, or change this slot to another type.
      </p>
    )
  }

  const provenance = article.provenance as Record<string, string>
  // What the card still needs, said whenever it cannot show (decision 280),
  // not only when the headline itself is missing.
  const missing = missingArticleFields(article)

  return (
    <div className="flex flex-col gap-2">
      <HeadlinePreview
        article={article}
        emphasis={brief.emphasis}
        showDeck={brief.showDeck === true}
        colors={colors}
      />

      {missing.length > 0 ? (
        <p className="text-[13px] text-[var(--color-warning)]">
          {article.failureReason ?? 'The article did not say.'} This card stays a placeholder until
          it has {missing.join(', ')}. Open it and fill these in.
        </p>
      ) : null}
      {article.headline === null ? null : (
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
          {editing ? 'Close' : missing.length > 0 ? 'Fill these in' : 'Correct the details'}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={addressing}
          onClick={() => setAddressing((open) => !open)}
        >
          {addressing ? 'Close' : "Set the article's address"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          busy={pressed === 'refetch-article'}
          disabled={busy}
          onClick={() =>
            void act(
              slot.id,
              () => refetchArticleAction(projectId, slot.id),
              'Article read again',
              'refetch-article',
            )
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
          {frontPage ? "Open the site's front page" : 'Open the article'}
        </a>
      </div>

      {addressing ? (
        <form
          aria-label="The article's address"
          className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void act(
              slot.id,
              () => setHeadlineArticleAction(projectId, slot.id, address),
              'Article address saved and read',
              'article-address',
            ).then((result) => {
              if (result.ok) setAddressing(false)
            })
          }}
        >
          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            {frontPage
              ? "The claim behind this card names only the site's front page. Paste the address of the article it quotes; the claim will cite it too."
              : 'The address of the article this card quotes. The claim behind it will cite it too.'}
            <input
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://www.example.com/2023/10/article-title"
              className="rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 font-mono text-[12px] text-[var(--color-text-primary)]"
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={pressed === 'article-address'}
              disabled={busy || address.trim() === ''}
            >
              Use this article
            </Button>
          </div>
        </form>
      ) : null}

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
  act: Act
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
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
          'headline',
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
        <Button type="submit" variant="primary" busy={pressed === 'headline'} disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** A cast member as the post card's "one of the cast?" question offers them. */
export interface CastOption {
  id: string
  name: string
}

/** The four fields a post card shows, in the card's words. */
const POST_FIELD_LABELS = [
  ['authorName', 'name'],
  ['handle', 'handle'],
  ['text', 'text'],
  ['postedAt', 'date'],
] as const

/** Where one post field came from, so a typed correction never reads as X's own. */
function postFieldSource(
  post: NonNullable<NonNullable<SlotView['social']>['post']>,
  field: (typeof POST_FIELD_LABELS)[number][0],
): string {
  if (post[field] === null) return 'missing'
  const provenance = post.provenance[field]
  if (provenance === 'manual') return 'typed by you'
  if (provenance === 'oembed') return 'from X'
  // Only the handle can be known with no reader answer: the address carried it.
  return 'from the address'
}

const SOCIAL_FIELD_CLASS =
  'rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]'
const SOCIAL_LABEL_CLASS = 'flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]'

/**
 * The post card (decision 284, spec section 9): the render's own card at
 * rest, where each of its four fields came from, and every correction as a
 * labelled button on the card it affects.
 *
 * A post X would not give up is not an error here, it is the start of the
 * manual path, so the card opens the address form (and the details form, for
 * a failed read) by itself and says what it lacks in the resolution's words.
 */
function SocialSlot({
  slot,
  brief,
  projectId,
  act,
  brand,
  castMembers,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'social' }>
  projectId: string
  act: Act
  brand: BrandKitStored
  castMembers: readonly CastOption[]
}) {
  const { busy, pressed } = useSlotLock()
  const social = slot.social
  const post = social?.post ?? null
  // No readable post: the address is the first thing the card needs.
  const unreadable = post === null || post.status === 'failed'
  const [addressing, setAddressing] = React.useState(unreadable)
  const [address, setAddress] = React.useState(unreadable ? '' : brief.postUrl)
  // A failed read opens the details too (spec section 13): typing them is the way on.
  const [editing, setEditing] = React.useState(post?.status === 'failed')

  if (!social) {
    return (
      <p className="rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-muted)]">
        This post card has nothing to show yet. Fetch the slot to read the post.
      </p>
    )
  }

  const shown = brief.excerpt ?? post?.text ?? null
  const attached = social.mediaUrl !== null || brief.mediaAssetId !== undefined
  const offerExcerpt =
    social.suggestedExcerpt !== null ||
    brief.excerpt !== undefined ||
    social.issues.includes(SOCIAL_TOO_LONG) ||
    social.issues.includes(SOCIAL_EXCERPT_TOO_LONG)

  return (
    <div className="flex flex-col gap-2">
      {social.payload ? <SocialPreview payload={social.payload} brand={brand} /> : null}

      {post?.status === 'failed' && post.failureReason ? (
        <p className="text-[13px] text-[var(--color-warning)]">
          {post.failureReason} Paste the address of another post, or type what this one says.
        </p>
      ) : null}

      {social.issues.length > 0 ? (
        <ul
          className="list-disc pl-5 text-[13px] text-[var(--color-warning)]"
          aria-label="What this card still needs"
        >
          {social.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {/* With no preview to read them from, the words as stored. */}
      {!social.payload && post && (post.authorName || post.text) ? (
        <blockquote
          aria-label="The post as read"
          className="flex flex-col gap-1 rounded-[8px] border border-[var(--color-border)] p-3 text-[13px] text-[var(--color-text-primary)]"
        >
          <span className="text-[12px] text-[var(--color-text-secondary)]">
            {[post.authorName, post.handle ? `@${post.handle}` : null, post.postedAt]
              .filter((part): part is string => part !== null)
              .join(' · ')}
          </span>
          {post.text ? <span className="line-clamp-6 whitespace-pre-line">{post.text}</span> : null}
        </blockquote>
      ) : null}

      {post ? (
        <ul className="flex flex-wrap gap-1" aria-label="Where each field came from">
          {POST_FIELD_LABELS.map(([field, label]) => (
            <li
              key={field}
              className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]"
            >
              {label} · {postFieldSource(post, field)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          aria-expanded={editing}
          onClick={() => setEditing((open) => !open)}
        >
          {editing ? 'Close details' : 'Edit details'}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={addressing}
          onClick={() => setAddressing((open) => !open)}
        >
          {addressing ? 'Close address' : "Set the post's address"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          busy={pressed === 'read-post'}
          disabled={busy}
          onClick={() =>
            void act(
              slot.id,
              () => refetchSocialPostAction(projectId, slot.id),
              'Post read again',
              'read-post',
            )
          }
        >
          Read again
        </Button>
        {/* A link, but one of our controls: same 40px target as the buttons. */}
        <a
          href={post ? postPublicUrl(post) : brief.postUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-h-10 items-center px-2 font-mono text-[11px] text-[var(--color-accent-text)] underline"
        >
          Open the post
        </a>
      </div>

      {addressing ? (
        <form
          aria-label="The post's address"
          className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void act(
              slot.id,
              () => setSocialPostAction(projectId, slot.id, address),
              'Post address saved',
              'post-address',
            ).then((result) => {
              if (result.ok) setAddressing(false)
            })
          }}
        >
          <label className={SOCIAL_LABEL_CLASS}>
            The address of the post this card shows. The claim keeps its own source.
            <input
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://x.com/handle/status/1234567890123456789"
              className={`${SOCIAL_FIELD_CLASS} font-mono text-[12px]`}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={pressed === 'post-address'}
              disabled={busy || address.trim() === ''}
            >
              Use this post
            </Button>
          </div>
        </form>
      ) : null}

      {editing ? (
        <SocialDetailsForm
          slot={slot}
          post={post}
          projectId={projectId}
          act={act}
          onDone={() => setEditing(false)}
        />
      ) : null}

      {shown !== null ? (
        <SocialHighlightForm
          key={`highlight-${brief.emphasis ?? ''}-${shown}`}
          slot={slot}
          initial={brief.emphasis ?? suggestEmphasis(shown) ?? ''}
          projectId={projectId}
          act={act}
        />
      ) : null}

      {offerExcerpt && post?.text ? (
        <SocialExcerptForm
          key={`excerpt-${brief.excerpt ?? ''}-${social.suggestedExcerpt ?? ''}`}
          slot={slot}
          initial={brief.excerpt ?? social.suggestedExcerpt ?? ''}
          chosen={brief.excerpt !== undefined}
          projectId={projectId}
          act={act}
        />
      ) : null}

      <div
        role="group"
        aria-label="Profile picture"
        className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
      >
        {social.avatar.url ? (
          // Plain <img> on purpose: a short-lived presigned URL next/image cannot allowlist.
          <img src={social.avatar.url} alt="" className="size-10 rounded-full object-cover" />
        ) : null}
        <p className="min-w-0 flex-1 text-[13px] text-[var(--color-text-secondary)]">
          {social.avatar.source === 'upload'
            ? 'Profile picture: uploaded by you.'
            : social.avatar.source === 'cast'
              ? `Profile picture: the cast photo of ${social.avatar.castName ?? 'a cast member'}.`
              : social.avatar.castName !== null
                ? `Profile picture: initials. ${social.avatar.castName} is linked to this account but has no photo yet; add one on the Cast card.`
                : 'Profile picture: initials, until you upload one or link the account to a cast member.'}
        </p>
        {social.avatar.source !== 'upload' && social.avatar.castId !== null ? (
          <Button
            type="button"
            variant="ghost"
            busy={pressed === 'unlink-cast'}
            disabled={busy}
            onClick={() => {
              const castId = social.avatar.castId
              if (castId === null) return
              void act(
                slot.id,
                () => unlinkCastHandleAction(projectId, castId, slot.id),
                `${social.avatar.castName ?? 'The cast member'} unlinked from this account`,
                'unlink-cast',
              )
            }}
          >
            Unlink
          </Button>
        ) : null}
        <SocialImageButton
          projectId={projectId}
          slotId={slot.id}
          act={act}
          purpose="social-avatar"
          label="Upload profile picture"
          inputLabel="Choose a profile picture for this post"
          success="Profile picture uploaded"
        />
        {social.avatar.source === 'upload' ? (
          <Button
            type="button"
            variant="ghost"
            busy={pressed === 'remove-avatar'}
            disabled={busy}
            onClick={() =>
              void act(
                slot.id,
                () => removeSocialImageAction(projectId, slot.id, 'avatar'),
                'Profile picture removed',
                'remove-avatar',
              )
            }
          >
            Remove profile picture
          </Button>
        ) : null}
        {social.avatar.source !== 'cast' &&
        social.avatar.castName === null &&
        post?.handle &&
        castMembers.length > 0 ? (
          <CastHandleLink
            projectId={projectId}
            slotId={slot.id}
            handle={post.handle}
            castMembers={castMembers}
            act={act}
          />
        ) : null}
      </div>

      <div
        role="group"
        aria-label="Attached image"
        className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
      >
        {social.mediaUrl ? (
          <img
            src={social.mediaUrl}
            alt="The image attached to this post"
            className="h-16 w-auto rounded-[6px] object-cover"
          />
        ) : null}
        {post?.endedWithMediaLink && !attached ? (
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">
            This post ended with a link, usually its image. Upload it to show it under the text.
          </p>
        ) : null}
        <SocialImageButton
          projectId={projectId}
          slotId={slot.id}
          act={act}
          purpose="social-image"
          label="Upload the post's image"
          inputLabel="Choose the post's image"
          success="Image attached"
        />
        {attached ? (
          <Button
            type="button"
            variant="ghost"
            busy={pressed === 'remove-media'}
            disabled={busy}
            onClick={() =>
              void act(
                slot.id,
                () => removeSocialImageAction(projectId, slot.id, 'media'),
                'Image removed',
                'remove-media',
              )
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** "Edit details": the post record's four fields, shared by every slot that shows this post. */
function SocialDetailsForm({
  slot,
  post,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  post: NonNullable<SlotView['social']>['post']
  projectId: string
  act: Act
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
  const [authorName, setAuthorName] = React.useState(post?.authorName ?? '')
  const [handle, setHandle] = React.useState(post?.handle ?? '')
  const [text, setText] = React.useState(post?.text ?? '')
  const [postedAt, setPostedAt] = React.useState(post?.postedAt ?? '')

  return (
    <form
      aria-label="The post's details"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () => saveSocialPostAction(projectId, slot.id, { authorName, handle, text, postedAt }),
          'Post details saved',
          'post-details',
        ).then((result) => {
          if (result.ok) onDone()
        })
      }}
    >
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Every slot that shows this post uses these details. A field you type is kept when the post
        is read again.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className={SOCIAL_LABEL_CLASS}>
          Name
          <input
            value={authorName}
            onChange={(event) => setAuthorName(event.target.value)}
            maxLength={50}
            className={SOCIAL_FIELD_CLASS}
          />
        </label>
        <label className={SOCIAL_LABEL_CLASS}>
          Handle
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="without the @"
            className={`${SOCIAL_FIELD_CLASS} font-mono`}
          />
        </label>
      </div>
      <label className={SOCIAL_LABEL_CLASS}>
        Posted (YYYY-MM-DD)
        <input
          value={postedAt}
          onChange={(event) => setPostedAt(event.target.value)}
          placeholder="2024-03-23"
          className={`${SOCIAL_FIELD_CLASS} font-mono`}
        />
      </label>
      <label className={SOCIAL_LABEL_CLASS}>
        Text, word for word as posted
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={4}
          className={SOCIAL_FIELD_CLASS}
        />
      </label>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={pressed === 'post-details'} disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** The phrase the marker sweeps under: pre-filled with the first figure, refused unless word for word. */
function SocialHighlightForm({
  slot,
  initial,
  projectId,
  act,
}: {
  slot: SlotView
  initial: string
  projectId: string
  act: Act
}) {
  const { busy, pressed } = useSlotLock()
  const [emphasis, setEmphasis] = React.useState(initial)
  return (
    <form
      aria-label="The highlight"
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        const value = emphasis.trim()
        void act(
          slot.id,
          () => saveSocialCardAction(projectId, slot.id, { emphasis: value === '' ? null : value }),
          value === '' ? 'Highlight cleared' : 'Highlight saved',
          'highlight',
        )
      }}
    >
      <label className={`${SOCIAL_LABEL_CLASS} min-w-[200px] flex-1`}>
        Highlight
        <input
          value={emphasis}
          onChange={(event) => setEmphasis(event.target.value)}
          maxLength={120}
          placeholder="words from the post, or leave empty"
          className={SOCIAL_FIELD_CLASS}
        />
      </label>
      <Button type="submit" variant="outline" busy={pressed === 'highlight'} disabled={busy}>
        Save highlight
      </Button>
    </form>
  )
}

/** The part of a long post the card shows (spec 5.5): a continuous stretch, word for word. */
function SocialExcerptForm({
  slot,
  initial,
  chosen,
  projectId,
  act,
}: {
  slot: SlotView
  initial: string
  chosen: boolean
  projectId: string
  act: Act
}) {
  const { busy, pressed } = useSlotLock()
  const [excerpt, setExcerpt] = React.useState(initial)
  return (
    <form
      aria-label="The excerpt"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        const value = excerpt.trim()
        void act(
          slot.id,
          () => saveSocialCardAction(projectId, slot.id, { excerpt: value === '' ? null : value }),
          'Excerpt saved',
          'excerpt',
        )
      }}
    >
      <label className={SOCIAL_LABEL_CLASS}>
        Excerpt
        <textarea
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
          maxLength={2000}
          rows={4}
          className={SOCIAL_FIELD_CLASS}
        />
      </label>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        Copy one continuous stretch of the post, word for word. The card marks each cut end with an
        ellipsis.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="outline"
          busy={pressed === 'excerpt'}
          disabled={busy || excerpt.trim() === ''}
        >
          Save excerpt
        </Button>
        {chosen ? (
          <Button
            type="button"
            variant="ghost"
            busy={pressed === 'whole-post'}
            disabled={busy}
            onClick={() =>
              void act(
                slot.id,
                () => saveSocialCardAction(projectId, slot.id, { excerpt: null }),
                'Showing the whole post',
                'whole-post',
              )
            }
          >
            Show the whole post
          </Button>
        ) : null}
      </div>
    </form>
  )
}

/** "Is @handle one of the cast?": saves the handle on the member chosen, never matched by name. */
function CastHandleLink({
  projectId,
  slotId,
  handle,
  castMembers,
  act,
}: {
  projectId: string
  slotId: string
  handle: string
  castMembers: readonly CastOption[]
  act: Act
}) {
  const { busy, pressed } = useSlotLock()
  const [memberId, setMemberId] = React.useState('')
  const chosen = castMembers.find((member) => member.id === memberId)
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <span className="text-[13px] text-[var(--color-text-secondary)]">
        Is @{handle} one of the cast?
      </span>
      <Select
        aria-label="Cast member"
        className="w-auto min-w-[180px]"
        value={memberId}
        onChange={(event) => setMemberId(event.target.value)}
      >
        <option value="">Choose a cast member</option>
        {castMembers.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        variant="outline"
        busy={pressed === 'link-cast'}
        disabled={busy || !chosen}
        onClick={() =>
          chosen
            ? void act(
                slotId,
                () => linkCastHandleAction(projectId, chosen.id, handle),
                `@${handle} linked to ${chosen.name}`,
                'link-cast',
              )
            : undefined
        }
      >
        Link
      </Button>
    </div>
  )
}

/** A social card's avatar or attached image: the same presigned pair as Upload own, with its purpose. */
function SocialImageButton({
  projectId,
  slotId,
  act,
  purpose,
  label,
  inputLabel,
  success,
}: {
  projectId: string
  slotId: string
  act: Act
  purpose: 'social-avatar' | 'social-image'
  label: string
  inputLabel: string
  success: string
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const { busy, pressed } = useSlotLock()
  return (
    <>
      <Button
        type="button"
        variant="outline"
        busy={pressed === purpose}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus aria-hidden />
        {label}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/avif,.avif"
        className="hidden"
        aria-label={inputLabel}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void act(
            slotId,
            () => uploadOwnFile({ projectId, slotId, picked: file, purpose }),
            success,
            purpose,
          )
        }}
      />
    </>
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
  act: Act
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
  act: Act
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

  const { busy, pressed } = useSlotLock()
  return (
    <>
      <Button
        variant="outline"
        busy={pressed === `logo:${entity}`}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
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
          void act(
            slotId,
            () => upload(file),
            'Mark added; the graphic has it now',
            `logo:${entity}`,
          )
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
  social: 'Post on X',
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

/**
 * A set's photos as "Use an existing shot" offers them (decision 278): the
 * plates the producer holds of a room, each with the address its thumbnail
 * loads from (absent without storage).
 */
export interface SetPhotoGroup {
  id: string
  name: string
  plates: {
    contentHash: string
    view: SetPlateView
    origin: 'uploaded' | 'generated'
    url?: string
  }[]
}

export function VisualBoard({
  projectId,
  model,
  colors,
  brand,
  setPhotos = [],
  castMembers = [],
}: {
  projectId: string
  model: VisualsReviewModel
  colors: BrandChartColors
  brand: BrandKitStored
  setPhotos?: readonly SetPhotoGroup[]
  /** The project's cast, for a post card's "one of the cast?" question (decision 284). */
  castMembers?: readonly CastOption[]
}) {
  const router = useRouter()
  const { toast } = useToast()
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [segmentIndex, setSegmentIndex] = React.useState(0)
  const [positionMs, setPositionMs] = React.useState(0)
  /**
   * Every key with an action in flight, and the control that pressed it.
   * A map, not the single `busySlot` it replaces: with one slot of state, a
   * press on card B overwrote card A's lock, and A finishing then unlocked B
   * while B was still saving.
   */
  const [locks, setLocks] = React.useState<ReadonlyMap<string, Lock>>(() => new Map())
  // A ref, not state: a double-click fires both handlers in one tick,
  // before any re-render could show the first press.
  const running = React.useRef(new Set<string>())
  // The refresh runs in a transition so a lock spans it (decision 240): the
  // button stays busy until the refreshed card is on screen, not merely
  // until the server replied.
  const [refreshing, startTransition] = React.useTransition()
  const pendingSeekSec = React.useRef(0)

  // A settled action lets go of its lock once no refresh is still landing.
  React.useEffect(() => {
    if (refreshing) return
    setLocks((current) => {
      if (![...current.values()].some((lock) => lock.settling)) return current
      return new Map([...current].filter(([, lock]) => !lock.settling))
    })
  }, [refreshing, locks])

  const playable = model.segments.some((segment) => segment.takeId !== null)
  const allSlots = model.chapters.flatMap((chapter) => chapter.slots)

  /**
   * Every slot button goes through here, and it RETURNS what happened: a
   * refused save must leave the form open with what the owner typed in it,
   * which is not possible if the caller cannot tell success from failure.
   */
  const act = React.useCallback<Act>(
    async (key, run, success, press) => {
      if (running.current.has(key)) {
        return { ok: false, error: 'That is already in progress.' }
      }
      running.current.add(key)
      const pressed = press ?? null
      setLocks((current) => new Map(current).set(key, { pressed, settling: false }))
      let ok = false
      try {
        const result = await run()
        ok = result.ok
        if (result.ok) {
          toast({ title: success })
          startTransition(() => router.refresh())
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
        running.current.delete(key)
        setLocks((current) => {
          const next = new Map(current)
          if (ok) next.set(key, { pressed, settling: true })
          else next.delete(key)
          return next
        })
      }
    },
    [router, toast],
  )

  // Background jobs (decision 286): a stamp younger than the limit locks what
  // it affects just as a press in flight does, and names the control to spin.
  const stamped = model.job !== null || model.fetching || allSlots.some((slot) => slot.job !== null)
  const now = useServerNow(model.renderedAt, stamped)
  const boardJob: VisualsJobView | null =
    model.job && jobIsLive(model.job.startedAt, now) ? model.job : null
  const boardLocked = model.fetching || boardJob !== null
  const boardPress = model.fetching ? 'plan' : boardJob ? PLAN_JOB_PRESS[boardJob.op] : null
  const planPressed = (key: string) => locks.has(key) || boardPress === key

  const planBusy = PLAN_KEYS.some((key) => locks.has(key)) || boardLocked
  const slotLock = (slot: SlotView): SlotLock => {
    const lock = locks.get(slot.id)
    const job = slot.job && jobIsLive(slot.job.startedAt, now) ? slot.job : null
    const jobPress = job ? (job.kind === 'refetch' ? 'regenerate' : 'redirect') : null
    return {
      busy: lock !== undefined || job !== null || boardLocked,
      pressed: lock?.pressed ?? jobPress,
    }
  }

  // Which chapters are folded. Remembered per project in this browser only:
  // it is a reading convenience, and a board that opens folded somewhere else
  // would hide work the producer expects to see.
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<number>>(() => new Set())
  const collapsedKey = `boom-busters:visual-board:collapsed:${projectId}`
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(collapsedKey)
      const parsed: unknown = stored ? JSON.parse(stored) : null
      if (Array.isArray(parsed)) {
        setCollapsed(new Set(parsed.filter((entry): entry is number => Number.isInteger(entry))))
      }
    } catch {
      // Blocked or corrupt storage: every chapter open, which is the default.
    }
  }, [collapsedKey])
  const foldChapters = React.useCallback(
    (next: ReadonlySet<number>) => {
      setCollapsed(next)
      try {
        window.localStorage.setItem(collapsedKey, JSON.stringify([...next]))
      } catch {
        // Not remembered, but still folded for this visit.
      }
    },
    [collapsedKey],
  )
  const toggleChapter = (chapterIndex: number) => {
    const next = new Set(collapsed)
    if (!next.delete(chapterIndex)) next.add(chapterIndex)
    foldChapters(next)
  }

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

  const jumpToSlot = (slot: SlotView) => {
    seekToMs(slot.startMs, playing)
    // A folded chapter opens for the jump: its card has no box to scroll to
    // while hidden, so the scroll waits a frame for the open chapter to paint.
    if (collapsed.has(slot.chapterIndex)) {
      const next = new Set(collapsed)
      next.delete(slot.chapterIndex)
      foldChapters(next)
    }
    window.requestAnimationFrame(() =>
      document.getElementById(`slot-${slot.id}`)?.scrollIntoView({ block: 'center' }),
    )
  }

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
            busy={planBusy}
            pressed={
              planPressed('direction-save')
                ? 'direction-save'
                : planPressed('direction-redraft')
                  ? 'direction-redraft'
                  : null
            }
            act={act}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-[14px]">Shot plan</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {model.fetching ? (
                <p className="text-[13px] text-[var(--color-text-primary)]" role="status">
                  Fetching visuals: {model.toFetch} slot{model.toFetch === 1 ? '' : 's'} still to
                  land.
                </p>
              ) : model.job && !boardJob ? (
                <p className="text-[13px] text-[var(--color-warning)]" role="status">
                  {staleJobWords(model.job.startedAt, now)}
                </p>
              ) : boardJob ? (
                <p className="text-[13px] text-[var(--color-text-primary)]" role="status">
                  {PLAN_JOB_WORDS[boardJob.op].doing}, started{' '}
                  {timecode(jobAgeMs(boardJob.startedAt, now))} ago.
                  {PLAN_JOB_WORDS[boardJob.op].then}
                </p>
              ) : (
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Nothing has been fetched or generated yet. Edit any brief, change a slot&apos;s
                  format, or fetch a single slot to try it; when the plan reads right, fetch the
                  lot. Slots already fetched for their current brief are never bought twice.
                </p>
              )}
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
              {/* Apart from the craft notes (decision 277): the Fix button
                  cannot clear these, so they are not counted against it. */}
              {model.decisions.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
                    For you to decide
                  </p>
                  <ul
                    className="list-disc pl-5 text-[12px] text-[var(--color-text-secondary)]"
                    aria-label="For you to decide"
                  >
                    {model.decisions.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {/* One lock over the three (decision 240): a fetch sent while a
                    re-plan is being sent would buy slots the re-plan is
                    about to discard. */}
                <ConfirmButton
                  variant="primary"
                  confirmVariant="primary"
                  busy={planPressed('plan')}
                  disabled={planBusy}
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
                    busy={planPressed('repair')}
                    disabled={planBusy}
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
                  busy={planPressed('replan')}
                  disabled={planBusy}
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
              // The list item wraps the button rather than being it: a
              // `role` on a <button> replaces its role, so every thumb used
              // to be announced as a list item nobody could tell was pressable.
              return (
                <div key={slot.id} role="listitem" className="shrink-0">
                  <button
                    type="button"
                    onClick={() => jumpToSlot(slot)}
                    className="flex h-[64px] w-[96px] flex-col items-center justify-center gap-1 overflow-hidden rounded-[6px] border border-[var(--color-border)] bg-[var(--color-background)] text-[10px] text-[var(--color-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
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
                </div>
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
      {model.chapters.length > 1 ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            disabled={model.chapters.every((chapter) => !collapsed.has(chapter.chapterIndex))}
            onClick={() => foldChapters(new Set())}
          >
            <ChevronsUpDown aria-hidden />
            Expand all chapters
          </Button>
          <Button
            variant="ghost"
            disabled={model.chapters.every((chapter) => collapsed.has(chapter.chapterIndex))}
            onClick={() =>
              foldChapters(new Set(model.chapters.map((chapter) => chapter.chapterIndex)))
            }
          >
            <ChevronsDownUp aria-hidden />
            Collapse all chapters
          </Button>
        </div>
      ) : null}

      {model.chapters.map((chapter) => (
        <ChapterSection
          key={chapter.chapterIndex}
          chapter={chapter}
          phase={model.phase}
          slotNotes={model.slotNotes}
          now={now}
          collapsed={collapsed.has(chapter.chapterIndex)}
          onToggle={() => toggleChapter(chapter.chapterIndex)}
        >
          {chapter.slots.map((slot) => (
            <SlotLockContext.Provider key={slot.id} value={slotLock(slot)}>
              <SlotCard
                slot={slot}
                now={now}
                projectId={projectId}
                colors={colors}
                brand={brand}
                act={act}
                phase={model.phase}
                notes={model.slotNotes[slot.id] ?? []}
                articleClaims={model.articleClaims}
                postClaims={model.postClaims}
                supportClaims={model.supportClaims}
                stillModelOptions={model.stillModelOptions}
                sources={allSlots}
                setPhotos={setPhotos}
                castMembers={castMembers}
              />
            </SlotLockContext.Provider>
          ))}
        </ChapterSection>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One chapter
// ---------------------------------------------------------------------------

/** What a chapter holds, counted the way its cards say it, zeroes left out. */
function chapterTally(
  slots: readonly SlotView[],
  phase: VisualsReviewModel['phase'],
  slotNotes: Record<string, string[]>,
  now: number,
): { text: string; warn: boolean }[] {
  const count = (test: (slot: SlotView) => boolean) => slots.filter(test).length
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const planning = phase === 'plan'
  const liveJob = (slot: SlotView) => slot.job !== null && jobIsLive(slot.job.startedAt, now)
  const inProgress = count(
    (slot) =>
      slot.retype?.state === 'drafting' || slot.retype?.state === 'rebriefing' || liveJob(slot),
  )
  // Everything the card itself asks the producer to act on, a stuck job included.
  const toLookAt = count(
    (slot) =>
      slot.refusal !== null ||
      slot.retype?.state === 'refused' ||
      slot.retype?.state === 'rebrief-refused' ||
      slot.retype?.state === 'fix-note' ||
      (slot.job !== null && !liveJob(slot)),
  )
  const notes = slots.reduce((total, slot) => total + (slotNotes[slot.id]?.length ?? 0), 0)
  const ready = count((slot) => slot.status === 'resolved')
  const placeholders = count((slot) => slot.status === 'placeholder')
  const fetching = count((slot) => slot.status === 'unresolved')

  const parts: { n: number; text: string; warn: boolean }[] = [
    { n: slots.length, text: plural(slots.length, 'shot', 'shots'), warn: false },
  ]
  // Before Fetch every slot is simply planned; what matters is the craft check.
  if (planning) {
    parts.push({ n: notes, text: plural(notes, 'craft note', 'craft notes'), warn: true })
  } else {
    parts.push(
      { n: ready, text: `${ready} ready`, warn: false },
      { n: placeholders, text: plural(placeholders, 'placeholder', 'placeholders'), warn: true },
      { n: fetching, text: `${fetching} being fetched`, warn: false },
    )
  }
  parts.push(
    { n: inProgress, text: `${inProgress} in progress`, warn: false },
    { n: toLookAt, text: `${toLookAt} to look at`, warn: true },
  )
  return parts.filter((part) => part.n > 0).map(({ text, warn }) => ({ text, warn }))
}

/**
 * A chapter of the board, foldable so a long film is not one long scroll.
 * The header is the fold button (the accordion shape: a button inside the
 * heading) and it carries the chapter's tally, so a folded chapter still
 * says what in it needs the producer. Folding hides the cards rather than
 * unmounting them: a brief half-typed in a folded chapter is still there
 * when it opens.
 */
function ChapterSection({
  chapter,
  phase,
  slotNotes,
  now,
  collapsed,
  onToggle,
  children,
}: {
  chapter: VisualsReviewModel['chapters'][number]
  phase: VisualsReviewModel['phase']
  slotNotes: Record<string, string[]>
  now: number
  collapsed: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const bodyId = `chapter-${chapter.chapterIndex}-shots`
  const tally = chapterTally(chapter.slots, phase, slotNotes, now)
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[15px] font-semibold">
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-10 w-full items-start gap-3 rounded-[8px] px-2 py-2 text-left transition-colors duration-150 hover:bg-[var(--color-surface-raised)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        >
          <ChevronDown
            aria-hidden
            className={`mt-[3px] size-4 shrink-0 text-[var(--color-text-secondary)] transition-transform duration-150 motion-reduce:transition-none ${
              collapsed ? '-rotate-90' : ''
            }`}
          />
          {/* Title and tally share one column, so on a phone the tally wraps
              under the title rather than back under the chevron. */}
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>
              Chapter {chapter.chapterIndex + 1} — {chapter.chapterTitle}
            </span>
            {/* The commas are for a screen reader: side-by-side spans carry no
              text between them, so the name ran "The collapse1 shot1 placeholder". */}
            <span className="sr-only">: </span>
            <span className="flex flex-wrap gap-x-2 text-[12px] font-normal text-[var(--color-text-secondary)]">
              {tally.map((part, index) => (
                <span
                  key={part.text}
                  className={part.warn ? 'text-[var(--color-warning)]' : undefined}
                >
                  {index > 0 ? (
                    <>
                      <span className="sr-only">, </span>
                      <span aria-hidden className="mr-2 text-[var(--color-text-muted)]">
                        ·
                      </span>
                    </>
                  ) : null}
                  {part.text}
                </span>
              ))}
            </span>
          </span>
        </button>
      </h2>
      <div id={bodyId} hidden={collapsed} className={collapsed ? 'hidden' : 'flex flex-col gap-3'}>
        {children}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// One slot
// ---------------------------------------------------------------------------

function SlotCard({
  slot,
  now,
  projectId,
  colors,
  brand,
  act,
  phase,
  notes,
  articleClaims,
  postClaims,
  supportClaims,
  stillModelOptions,
  sources,
  setPhotos,
  castMembers,
}: {
  slot: SlotView
  /** The server's clock, carried forward (decision 286). */
  now: number
  projectId: string
  colors: BrandChartColors
  brand: BrandKitStored
  act: Act
  phase: VisualsReviewModel['phase']
  /** This slot's craft notes (decision 277), the ones the plan card lists by chapter and time. */
  notes: readonly string[]
  articleClaims: ArticleClaimOption[]
  postClaims: PostClaimOption[]
  supportClaims: PostClaimOption[]
  stillModelOptions: readonly StillModelOption[]
  sources: SlotView[]
  setPhotos: readonly SetPhotoGroup[]
  castMembers: readonly CastOption[]
}) {
  const [editing, setEditing] = React.useState(false)
  const [rebriefing, setRebriefing] = React.useState(false)
  const [reusing, setReusing] = React.useState(false)
  // Which candidate the lightbox shows, or null when it is closed. Opens on
  // the current choice, since "how does the selected media actually look at
  // size" is the question the button answers.
  const [previewIndex, setPreviewIndex] = React.useState<number | null>(null)
  const { busy, pressed } = useSlotLock()
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
        {/* A background job on this card (decision 286): what it is and how
            long it has run, and once it is past the limit, that it may have
            stopped and the card is free again. */}
        {slot.job ? (
          <p
            role="status"
            className={
              jobIsLive(slot.job.startedAt, now)
                ? 'text-[13px] text-[var(--color-text-primary)]'
                : 'text-[13px] text-[var(--color-warning)]'
            }
          >
            {jobIsLive(slot.job.startedAt, now)
              ? slotJobWords(slot.job, now, planning)
              : staleJobWords(slot.job.startedAt, now)}
          </p>
        ) : null}
        {brief ? (
          <p className="text-[13px] text-[var(--color-text-primary)]">{brief.description}</p>
        ) : null}

        {/* On the card as well as in the plan card's list: with chapters
            folded, a note listed only at the top named a shot nobody could
            see. */}
        {planning && notes.length > 0 ? (
          <ul
            className="list-disc pl-5 text-[12px] text-[var(--color-warning)]"
            aria-label="Craft notes on this shot"
          >
            {notes.map((note, index) => (
              <li key={`${index}-${note}`}>{note}</li>
            ))}
          </ul>
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
        ) : brief?.type === 'social' ? (
          <SocialSlot
            slot={slot}
            brief={brief}
            projectId={projectId}
            act={act}
            brand={brand}
            castMembers={castMembers}
          />
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
                busy={pressed === 'redirect'}
                disabled={busy}
                onClick={() =>
                  act(
                    slot.id,
                    () => redirectSceneAction(projectId, slot.id),
                    'Redirecting the scene',
                    'redirect',
                  )
                }
              >
                Redirect the scene · ≈$0.02
              </Button>
              <UploadOwnButton projectId={projectId} slotId={slot.id} act={act} archival={false} />
            </div>
          </div>
        ) : null}

        {/* A post card says what it lacks itself, in resolution's words. */}
        {slot.status === 'placeholder' &&
        !slot.refusal &&
        brief?.type !== 'hero' &&
        brief?.type !== 'archival' &&
        brief?.type !== 'social' ? (
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
            articleClaims={articleClaims}
            postClaims={postClaims}
            supportClaims={supportClaims}
          />
        ) : null}

        {/* A still in a named set carries a camera (decision 275): where it
            stands decides which plates ride along with the prompt. */}
        {!linked && brief?.type === 'still' && brief.set && !slot.briefError ? (
          <CameraRow
            slotId={slot.id}
            projectId={projectId}
            camera={brief.camera}
            busy={busy}
            pressed={pressed}
            act={act}
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
                  aria-expanded={editing}
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
                    busy={pressed === 'unlink-reuse'}
                    disabled={busy}
                    onClick={() =>
                      act(
                        slot.id,
                        () => unlinkSlotReuseAction(projectId, slot.id),
                        'This slot will fetch its own shot again',
                        'unlink-reuse',
                      )
                    }
                  >
                    Choose its own shot
                  </Button>
                ) : null}
                {/* Editing the words yourself and re-planning the whole film
                    were the only two ways to change an idea (decision 258).
                    A headline card is never offered one: every word on it is
                    read from the article, so there is no idea to have again.
                    A post card neither, for the same reason (decision 284). */}
                {!linked && brief.type !== 'headline' && brief.type !== 'social' ? (
                  <Button
                    variant="outline"
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
                    busy={pressed === 'regenerate'}
                    disabled={busy}
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
                        'regenerate',
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
            stillModelOptions={stillModelOptions}
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
            setPhotos={setPhotos}
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
  articleClaims,
  onDone,
}: {
  slot: SlotView
  projectId: string
  act: Act
  articleClaims: ArticleClaimOption[]
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
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
                  busy={pressed === `quote:${claim.id}`}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      slot.id,
                      () => retypeToHeadlineAction(projectId, slot.id, claim.id),
                      `Now quoting ${claim.label}`,
                      `quote:${claim.id}`,
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
 * Which post a post card shows (decision 284), the article chooser's twin.
 *
 * Every word on the card is read from the post, so the only decision is
 * which one, and it is the owner's. Two ways in: a claim already sourced to a
 * post, picked from the list; or any post, pasted, filed under whichever
 * claim it supports (amended 2026-09-30). The pasted address lives on the
 * brief, so the claim keeps the source it was verified against.
 */
function PostChooser({
  slot,
  projectId,
  act,
  postClaims,
  supportClaims,
  onDone,
}: {
  slot: SlotView
  projectId: string
  act: Act
  postClaims: PostClaimOption[]
  supportClaims: PostClaimOption[]
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
  const [address, setAddress] = React.useState('')
  const [claimId, setClaimId] = React.useState('')
  const showing = slot.brief?.type === 'social' ? slot.brief.sourceClaimId : null

  return (
    <div
      role="group"
      aria-label="Which post this card shows"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border-strong)] p-2"
    >
      {postClaims.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No claim in this project’s dossier is sourced to a post on X yet. Paste the post’s address
          below and choose the claim it supports.
        </p>
      ) : (
        <>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {showing === null
              ? 'Pick the post. Every word on the card is read from it: the name, the handle, the text and the date.'
              : 'Pick a different post. The card is redrawn from that one, and the highlight and excerpt chosen for this post are dropped.'}
          </p>
          {postClaims.map((claim) => (
            <div key={claim.id} className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] text-[var(--color-text-primary)]">
                {claim.label}
              </span>
              {claim.id === showing ? (
                <Badge shape="tag">shown now</Badge>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  busy={pressed === `post:${claim.id}`}
                  disabled={busy}
                  onClick={() =>
                    void act(
                      slot.id,
                      () => retypeToSocialAction(projectId, slot.id, claim.id),
                      'Now a post card',
                      `post:${claim.id}`,
                    ).then((result) => {
                      if (result.ok) onDone()
                    })
                  }
                >
                  Show this post
                </Button>
              )}
            </div>
          ))}
        </>
      )}

      {supportClaims.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          This project’s dossier has no claims to file a post under yet.
        </p>
      ) : (
        <form
          aria-label="Paste a post"
          className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
          onSubmit={(event) => {
            event.preventDefault()
            void act(
              slot.id,
              () => retypeToSocialAction(projectId, slot.id, claimId, address),
              'Now a post card',
              'paste-post',
            ).then((result) => {
              if (result.ok) onDone()
            })
          }}
        >
          <label className={SOCIAL_LABEL_CLASS}>
            {postClaims.length === 0
              ? 'The post’s address'
              : 'Or paste the address of another post'}
            <input
              type="url"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="https://x.com/handle/status/1234567890123456789"
              className={`${SOCIAL_FIELD_CLASS} font-mono text-[12px]`}
            />
          </label>
          <label className={SOCIAL_LABEL_CLASS}>
            The claim this post supports. Its own source stays as it is.
            <Select value={claimId} onChange={(event) => setClaimId(event.target.value)}>
              <option value="">Choose a claim</option>
              {supportClaims.map((claim) => (
                <option key={claim.id} value={claim.id}>
                  {claim.label}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              busy={pressed === 'paste-post'}
              disabled={busy || address.trim() === '' || claimId === ''}
            >
              Use this post
            </Button>
          </div>
        </form>
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
 * Post on X asks the same way, for which post (decision 284).
 * Hero stays off the picker while its flag is down — a button that always
 * errors is not a button.
 */
function TypePicker({
  slot,
  projectId,
  act,
  articleClaims,
  postClaims,
  supportClaims,
}: {
  slot: SlotView
  projectId: string
  act: Act
  articleClaims: ArticleClaimOption[]
  postClaims: PostClaimOption[]
  supportClaims: PostClaimOption[]
}) {
  const { busy, pressed } = useSlotLock()
  const types = SHOT_SLOT_TYPES.filter((type) => type !== 'hero' || slot.type === 'hero')
  const job = slot.retype
  // Either kind of model job holds every button: a second request racing the
  // first would write over whichever landed last.
  const drafting = job?.state === 'drafting' || job?.state === 'rebriefing'
  const refused = job?.state === 'refused' ? job : null
  const rebriefRefused = job?.state === 'rebrief-refused' ? job : null
  const fixNote = job?.state === 'fix-note' ? job : null
  // Which chooser is open: the article a headline quotes, or the post a
  // post card shows. One at a time; opening either closes the other.
  const [choosing, setChoosing] = React.useState<'headline' | 'social' | null>(null)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Slot format">
        <span className="text-[11px] text-[var(--color-text-muted)]">Format</span>
        {types.map((type) => {
          const current = type === slot.type
          // Headline and Post on X are the formats that cannot be chosen by
          // pressing a button: the card quotes an article or shows a post, and
          // which one is the owner's to say (decisions 257 and 284). So these
          // buttons open a chooser below.
          const asks = type === 'headline' || type === 'social'
          return (
            <Button
              key={type}
              variant={current ? 'selected' : 'ghost'}
              aria-pressed={current}
              {...(asks ? { 'aria-expanded': choosing === type } : {})}
              /* The one exception to "the current format is disabled": on a
                 headline slot this button is not how you change the format,
                 it is how you change WHICH article the card quotes, and on
                 a post card, WHICH post it shows. */
              disabled={(current && !asks) || busy || drafting}
              busy={pressed === `type:${type}`}
              onClick={() => {
                if (asks) {
                  setChoosing((open) => (open === type ? null : type))
                  return
                }
                // Any other format answers the question the chooser was
                // asking, so it goes away with the answer.
                setChoosing(null)
                void act(
                  slot.id,
                  () => retypeSlotAction(projectId, slot.id, type),
                  type === 'chart' || type === 'map' || type === 'graphic'
                    ? `Drafting the ${type} — this card updates when it lands`
                    : `Re-typed to ${slotTypeLabel(type)}`,
                  `type:${type}`,
                )
              }}
            >
              {slotTypeLabel(type)}
            </Button>
          )
        })}
      </div>

      {choosing === 'headline' ? (
        <ArticleChooser
          slot={slot}
          projectId={projectId}
          act={act}
          articleClaims={articleClaims}
          onDone={() => setChoosing(null)}
        />
      ) : null}

      {choosing === 'social' ? (
        <PostChooser
          slot={slot}
          projectId={projectId}
          act={act}
          postClaims={postClaims}
          supportClaims={supportClaims}
          onDone={() => setChoosing(null)}
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
            busy={pressed === 'dismiss'}
            disabled={busy}
            onClick={() =>
              act(slot.id, () => dismissRetypeAction(projectId, slot.id), 'Dismissed', 'dismiss')
            }
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
            busy={pressed === 'dismiss'}
            disabled={busy}
            onClick={() =>
              act(slot.id, () => dismissRetypeAction(projectId, slot.id), 'Dismissed', 'dismiss')
            }
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      {/* What the Fix button did here, when it did not simply clear the
          slot (decision 277). */}
      {fixNote ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-[8px] border border-[var(--color-warning)] p-2"
        >
          <p className="min-w-0 flex-1 text-[13px] text-[var(--color-warning)]">{fixNote.note}</p>
          <Button
            variant="outline"
            busy={pressed === 'dismiss'}
            disabled={busy}
            onClick={() =>
              act(slot.id, () => dismissRetypeAction(projectId, slot.id), 'Dismissed', 'dismiss')
            }
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
}: {
  slot: SlotView
  projectId: string
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  act: Act
}) {
  const { busy, pressed } = useSlotLock()
  return (
    <CandidateLightbox
      label={`Preview: ${slot.brief?.coversText ?? slot.id}`}
      caption={`“${slot.brief?.coversText ?? ''}”`}
      candidates={slot.candidates}
      index={index}
      onIndexChange={onIndexChange}
      onClose={onClose}
      isChosen={(candidate) => candidate.chosen === true}
      chooseLabel="Use this candidate"
      chosenLabel="Selected for this slot"
      onChoose={(candidate) =>
        void act(
          slot.id,
          () => chooseCandidateAction(projectId, slot.id, candidate.id),
          'Selected',
          `choose:${candidate.id}`,
        )
      }
      busy={pressed?.startsWith('choose:') ?? false}
      chooseDisabled={busy}
    />
  )
}

function CandidateStrip({ slot, projectId, act }: { slot: SlotView; projectId: string; act: Act }) {
  const { busy, pressed } = useSlotLock()
  if (slot.candidates.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-2" role="list" aria-label="Candidates">
        {slot.candidates.map((candidate) => {
          const thumb = candidateThumb(candidate)
          const chosen = candidate.chosen === true
          const choosing = pressed === `choose:${candidate.id}`
          return (
            // The list item wraps the button: a `role` on the <button> itself
            // replaced its role, and the thumbs stopped reading as pressable.
            <div key={candidate.id} role="listitem">
              <button
                type="button"
                disabled={chosen || busy}
                aria-busy={choosing || undefined}
                onClick={() =>
                  act(
                    slot.id,
                    () => chooseCandidateAction(projectId, slot.id, candidate.id),
                    'Selected',
                    `choose:${candidate.id}`,
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
                    : 'border-[var(--color-border)] enabled:hover:border-[var(--color-border-strong)]'
                } ${busy && !chosen && !choosing ? 'opacity-60' : ''}`}
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
                {/* Where the press landed, until the refreshed strip marks it. */}
                {choosing ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 aria-hidden className="size-5 animate-spin text-white" />
                  </span>
                ) : null}
              </button>
            </div>
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
  act: Act
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
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
          'rebrief',
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
        <Button type="submit" variant="primary" busy={pressed === 'rebrief'} disabled={busy}>
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
/** A plate's caption in the picker. */
const PLATE_VIEW_LABELS: Record<SetPlateView, string> = {
  north: 'North wall',
  east: 'East wall',
  south: 'South wall',
  west: 'West wall',
  detail: 'Detail',
  other: 'Photo',
}

function ReusePicker({
  slot,
  sources,
  setPhotos,
  phase,
  projectId,
  act,
  onDone,
}: {
  slot: SlotView
  sources: SlotView[]
  setPhotos: readonly SetPhotoGroup[]
  phase: VisualsReviewModel['phase']
  projectId: string
  act: Act
  onDone: () => void
}) {
  const { busy, pressed } = useSlotLock()
  const planning = phase === 'plan'
  const offered = sources.filter(
    (source) =>
      source.id !== slot.id &&
      REUSABLE_SLOT_TYPES.includes(source.type as (typeof REUSABLE_SLOT_TYPES)[number]) &&
      source.reuse === null &&
      (planning || lendable(source).length > 0),
  )

  // A real-footage slot takes only a photo the producer uploaded (decision
  // 278): a generated plate is not footage of the real place.
  const archival = slot.brief?.type === 'archival'
  const rooms = setPhotos
    .map((set) => ({
      ...set,
      plates: set.plates.filter((plate) => !archival || plate.origin === 'uploaded'),
    }))
    .filter((set) => set.plates.length > 0)

  const photoPress = (set: SetPhotoGroup, contentHash: string) => `photo:${set.id}:${contentHash}`
  const showPhoto = (set: SetPhotoGroup, contentHash: string) =>
    void act(
      slot.id,
      () => showSetPhotoAction({ projectId, slotId: slot.id, setId: set.id, contentHash }),
      `Now showing a photo of ${set.name}`,
      photoPress(set, contentHash),
    ).then((result) => {
      if (result.ok) onDone()
    })

  const reusePress = (source: SlotView, candidateId: string | undefined) =>
    `reuse:${source.id}:${candidateId ?? ''}`
  const use = (source: SlotView, candidateId: string | undefined) =>
    void act(
      slot.id,
      () => reuseSlotShotAction(projectId, slot.id, source.id, candidateId),
      planning
        ? 'Linked. Fetch visuals will copy the shot when it lands'
        : `Now showing the shot from ${timecode(source.startMs)}`,
      reusePress(source, candidateId),
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
      {offered.length === 0 && rooms.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          No other stock, AI image or real-footage slot in this film has a shot to offer yet.
        </p>
      ) : offered.length === 0 ? null : (
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
                    <Button
                      variant="outline"
                      busy={pressed === reusePress(source, undefined)}
                      disabled={busy}
                      onClick={() => use(source, undefined)}
                    >
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
                          <Button
                            variant="outline"
                            busy={pressed === reusePress(source, candidate.id)}
                            disabled={busy}
                            onClick={() => use(source, candidate.id)}
                          >
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
      {rooms.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
            Photos of the film&apos;s sets
          </p>
          {rooms.map((set) => (
            <div
              key={set.id}
              role="group"
              aria-label={`Photos of ${set.name}`}
              className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-2"
            >
              <p className="text-[13px] text-[var(--color-text-primary)]">{set.name}</p>
              <ul className="flex flex-wrap gap-2">
                {set.plates.map((plate) => (
                  <li key={plate.contentHash} className="flex flex-col items-start gap-1">
                    {plate.url ? (
                      <img
                        src={plate.url}
                        alt={`${set.name}, ${PLATE_VIEW_LABELS[plate.view]}`}
                        className="h-16 w-28 rounded-[6px] object-cover"
                      />
                    ) : null}
                    <span className="text-[11px] text-[var(--color-text-muted)]">
                      {PLATE_VIEW_LABELS[plate.view]}
                      {plate.origin === 'generated' ? ' · generated' : ''}
                    </span>
                    <Button
                      variant="outline"
                      aria-label={`Use the ${PLATE_VIEW_LABELS[plate.view].toLowerCase()} photo of ${set.name}`}
                      busy={pressed === photoPress(set, plate.contentHash)}
                      disabled={busy}
                      onClick={() => showPhoto(set, plate.contentHash)}
                    >
                      Use this photo
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
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

/** A model's label from the board's options, or the stored id itself if no list holds it. */
function stillModelLabel(
  options: readonly StillModelOption[],
  provider: StillProvider,
  model: string,
): string {
  return options.find((o) => o.provider === provider && o.id === model)?.label ?? model
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
  options,
}: {
  slot: SlotView
  projectId: string
  act: Act
  /** Every model either provider offers, live lists included (decision 287). */
  options: readonly StillModelOption[]
}) {
  const { busy } = useSlotLock()
  const id = `route-${slot.id}`
  const value = slot.route ? `${slot.route.provider}:${slot.route.model}` : ''
  const defaultLabel = stillModelLabel(options, slot.derivedRoute.provider, slot.derivedRoute.model)

  return (
    <div className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
      <Label htmlFor={id}>Image model</Label>
      <Select
        id={id}
        value={value}
        // Held while the choice saves: a second pick racing the first could
        // land first and leave the select showing the model that lost.
        disabled={busy}
        aria-busy={busy || undefined}
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
            'route',
          )
        }}
      >
        <option value="">{`Planned default (${defaultLabel})`}</option>
        {STILL_PROVIDERS.map((provider) => (
          <optgroup key={provider} label={PROVIDER_LABELS[provider]}>
            {options
              .filter((option) => option.provider === provider)
              .map((candidate) => (
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
  stillModelOptions,
  onDone,
  planning,
}: {
  slot: SlotView
  projectId: string
  act: Act
  stillModelOptions: readonly StillModelOption[]
  onDone: () => void
  /** Plan phase: an edit just saves — nothing is fetched until "Fetch visuals". */
  planning: boolean
}) {
  const { busy, pressed } = useSlotLock()
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
          'brief',
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
        <ModelRouteSelect slot={slot} projectId={projectId} act={act} options={stillModelOptions} />
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" busy={pressed === 'brief'} disabled={busy}>
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
 * One file, browser to R2 and then recorded (decision 213): presign, PUT,
 * finalise. Shared by Upload own and the post card's two image buttons
 * (decision 284), which differ only in `purpose`: what the finalised upload
 * becomes on the server. Absent `purpose` is the slot's own shot, sent
 * exactly as before.
 */
async function uploadOwnFile(input: {
  projectId: string
  slotId: string
  picked: File
  purpose?: 'social-avatar' | 'social-image'
}): Promise<ActionResult> {
  const { projectId, slotId, purpose } = input
  // An AVIF becomes a JPEG first; video passes straight through untouched
  // (decision 266). The size check below then measures what is uploaded.
  const ready = await toUploadableImage(input.picked)
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
    ...(purpose ? { purpose } : {}),
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
    ...(purpose ? { purpose } : {}),
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
  act: Act
  archival: boolean
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [url, setUrl] = React.useState('')
  const { busy, pressed } = useSlotLock()

  const upload = (picked: File): Promise<ActionResult> =>
    uploadOwnFile({ projectId, slotId, picked })

  return (
    <>
      {/* Busy for the whole presign, PUT and finalise: a 200 MB clip takes
          a while, and a button that looked idle through it invited a second
          upload of the same file. */}
      <Button
        variant="outline"
        busy={pressed === 'upload'}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
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
        busy={pressed === 'address'}
        disabled={busy || url.trim() === ''}
        onClick={() =>
          void act(
            slotId,
            async () => {
              const result = await addSlotImageFromUrlAction({ projectId, slotId, url })
              if (result.ok) setUrl('')
              return result
            },
            'Added and selected',
            'address',
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
          void act(slotId, () => upload(file), 'Uploaded and selected', 'upload')
        }}
      />
    </>
  )
}
