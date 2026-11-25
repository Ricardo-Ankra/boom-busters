'use client'

import * as React from 'react'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { IDEA_LABELS, PACKAGES_MAX, THUMBNAIL_IDEAS } from '@boom-busters/schemas'
import type { ThumbnailIdea } from '@boom-busters/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { PublishItemModel, ThumbnailPackageProp } from '@/lib/publish-review'
import { testRunningReason } from '@/lib/test-running'
import { useAction } from './project-controls'
import {
  approveThumbnailSet,
  generateThumbnailSet,
  makeDefaultThumbnail,
  markTestStarted,
  recordTestResult,
  regenerateThumbnailPicture,
  removeThumbnailPackageAction,
  saveThumbnailPackage,
} from './thumbnail-actions'

/**
 * A master's thumbnail and title set on the Publish card (design 2026-11-24,
 * 7.7): up to three packages, each a picture with its title, and after the
 * upload the hand-off for the Studio test. Masters only; a Short keeps the
 * plain upload strip.
 */

/** What the screen calls each title slot a title can lack. */
export const SLOT_LABEL = {
  topic: 'topic',
  formatKeyword: 'format keyword',
  pillar: 'pillar',
  runtime: 'runtime',
} as const

/** How often the route is re-read while a run is working. */
const POLL_MS = 3000

const TITLE_MAX = 100
const HEADLINE_MAX = 60

const FIELD_CLASS =
  'rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]'

/**
 * A field the owner can type in. It follows the saved value when that changes
 * and the owner has not touched the field; a refresh never overwrites typing.
 * Derived during render, not in an effect that resets state from props.
 */
function useDraft(saved: string): [string, (value: string) => void] {
  const [seen, setSeen] = React.useState(saved)
  const [value, setValue] = React.useState(saved)
  if (saved !== seen) {
    setSeen(saved)
    // Untouched (its trimmed text is what was saved) or just saved: show the saved text.
    if (value.trim() === seen || value.trim() === saved) setValue(saved)
  }
  return [value, setValue]
}

/** Whether the record still lets the owner change the set (design 7.1: open until the upload). */
function editable(status: string | undefined): boolean {
  return status === undefined || status === 'draft' || status === 'failed'
}

function PreviewGround({ pack, tone }: { pack: ThumbnailPackageProp; tone: 'dark' | 'light' }) {
  const ground =
    tone === 'dark'
      ? 'bg-[var(--color-background)] text-[var(--color-text-primary)]'
      : 'bg-[var(--color-text-primary)] text-[var(--color-background)]'
  return (
    <div
      data-testid={`preview-${tone}`}
      className={`flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-2 ${ground}`}
    >
      {[320, 168].map((width) => (
        <div key={width} className="flex flex-col gap-1" style={{ width }}>
          {/* A presigned R2 URL, not an optimisable asset: plain img. */}
          <img
            src={pack.url ?? ''}
            alt=""
            width={width}
            className="aspect-video w-full rounded-[4px] object-cover"
          />
          <span className="text-[12px] leading-4 break-words">{pack.title}</span>
        </div>
      ))}
    </div>
  )
}

function PackageCard({
  pack,
  index,
  isDefault,
  open,
  locked,
  act,
  pressed,
}: {
  pack: ThumbnailPackageProp
  index: number
  isDefault: boolean
  /** The record still lets the owner change things. */
  open: boolean
  /** Another action or a run is working: buttons wait. */
  locked: boolean
  act: ReturnType<typeof useAction>['act']
  pressed: string | null
}) {
  const [title, setTitle] = useDraft(pack.title)
  const [headline, setHeadline] = useDraft(pack.headline)
  const [idea, setIdea] = useDraft(pack.idea ?? '')
  const generated = pack.source === 'generated'
  const died = (pack.state === 'planned' || pack.state === 'painting') && !pack.inFlight
  const waiting = locked || pack.inFlight

  const titleChanged = title.trim() !== pack.title
  const headlineChanged = generated && headline.trim() !== pack.headline
  const ideaChanged = !generated && idea !== (pack.idea ?? '')
  const changed = titleChanged || headlineChanged || ideaChanged

  const save = () =>
    act(
      () =>
        saveThumbnailPackage(pack.id, {
          ...(titleChanged ? { title: title.trim() } : {}),
          ...(headlineChanged ? { headline: headline.trim() } : {}),
          ...(ideaChanged ? { idea: idea === '' ? null : (idea as ThumbnailIdea) } : {}),
        }),
      'Changes saved',
      `save-${pack.id}`,
    )

  const otherSide = pack.textSide === 'left' ? 'right' : 'left'
  const misses = pack.slotMisses.map((slot) => SLOT_LABEL[slot])

  return (
    <article
      aria-label={`Thumbnail ${index + 1}`}
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-[var(--color-text-primary)]">
          {index + 1}
        </span>
        {isDefault ? <Badge tone="accent">Default</Badge> : null}
        {pack.approved ? <Badge tone="success">Approved</Badge> : null}
        {pack.inFlight ? (
          <Badge tone="muted">
            <Loader2 aria-hidden className="animate-spin" />
            Being made
          </Badge>
        ) : null}
      </div>

      {pack.url ? (
        // A presigned R2 URL, not an optimisable asset: plain img.
        <img
          src={pack.url}
          alt={`Thumbnail ${index + 1}`}
          className="aspect-video w-full rounded-[4px] border border-[var(--color-border)] object-cover"
        />
      ) : (
        <span className="flex aspect-video w-full items-center justify-center rounded-[4px] border border-[var(--color-border)] text-[12px] text-[var(--color-text-muted)]">
          PNG
        </span>
      )}

      {pack.url && pack.state === 'ready' ? (
        <div className="flex flex-wrap gap-2">
          <PreviewGround pack={pack} tone="dark" />
          <PreviewGround pack={pack} tone="light" />
        </div>
      ) : null}

      {generated ? (
        <>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Idea: {pack.idea ? IDEA_LABELS[pack.idea] : 'None'}
          </p>
          {pack.angle ? (
            <p className="text-[12px] text-[var(--color-text-secondary)]">Promises: {pack.angle}</p>
          ) : null}
        </>
      ) : null}

      {pack.depicts.length > 0 ? (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          Shows: {pack.depicts.join(', ')}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        Title
        <Input
          value={title}
          maxLength={TITLE_MAX}
          disabled={!open}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {generated ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Headline
          <Input
            value={headline}
            maxLength={HEADLINE_MAX}
            disabled={!open}
            onChange={(event) => setHeadline(event.target.value)}
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Idea
          <select
            value={idea}
            disabled={!open}
            onChange={(event) => setIdea(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">None</option>
            {THUMBNAIL_IDEAS.map((option) => (
              <option key={option} value={option}>
                {IDEA_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      )}

      {pack.state === 'failed' && pack.error ? (
        <p className="text-[12px] text-[var(--color-danger)]">{pack.error}</p>
      ) : null}
      {died ? <p className="text-[12px] text-[var(--color-danger)]">This did not finish.</p> : null}

      {pack.warnings.length > 0 || misses.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-[12px] text-[var(--color-warning)]">
          {pack.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
          {misses.length > 0 ? <li>Missing: {misses.join(', ')}</li> : null}
        </ul>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2">
          {changed ? (
            <Button
              variant="outline"
              busy={pressed === `save-${pack.id}`}
              disabled={waiting}
              onClick={() => void save()}
            >
              <Save aria-hidden className="h-4 w-4" />
              Save changes
            </Button>
          ) : null}
          {!isDefault ? (
            <Button
              variant="outline"
              busy={pressed === `default-${pack.id}`}
              disabled={waiting}
              onClick={() =>
                void act(
                  () => makeDefaultThumbnail(pack.id),
                  'Made the default',
                  `default-${pack.id}`,
                )
              }
            >
              Make default
            </Button>
          ) : null}
          {generated ? (
            <>
              <Button
                variant="outline"
                busy={pressed === `regen-${pack.id}`}
                disabled={waiting}
                onClick={() =>
                  void act(
                    () => regenerateThumbnailPicture(pack.id),
                    'Painting a new picture',
                    `regen-${pack.id}`,
                  )
                }
              >
                <RefreshCw aria-hidden className="h-4 w-4" />
                Regenerate picture
              </Button>
              <Button
                variant="outline"
                busy={pressed === `side-${pack.id}`}
                disabled={waiting}
                onClick={() =>
                  void act(
                    () => saveThumbnailPackage(pack.id, { textSide: otherSide }),
                    'Headline moved',
                    `side-${pack.id}`,
                  )
                }
              >
                {otherSide === 'right' ? 'Text right' : 'Text left'}
              </Button>
            </>
          ) : null}
          <Button
            variant="outline"
            busy={pressed === `remove-${pack.id}`}
            disabled={waiting}
            onClick={() =>
              void act(
                () => removeThumbnailPackageAction(pack.id),
                'Thumbnail removed',
                `remove-${pack.id}`,
              )
            }
          >
            Remove
          </Button>
        </div>
      ) : null}
    </article>
  )
}

/** The recorded result in words (design 7.8); the variant number is the one the panel shows. */
function resultSentence(approved: ThumbnailPackageProp[]): string | null {
  const won = approved.findIndex((pack) => pack.result === 'won')
  if (won >= 0) return `Variant ${won + 1} won.`
  if (approved[0]?.result === 'same') return 'The variants performed the same.'
  if (approved[0]?.result === 'inconclusive') return 'The test was inconclusive.'
  return null
}

/** Start and result of the Studio test: "I have started the test", then how it ended. */
function TestPanel({
  approved,
  targetId,
  startedAtIso,
  endedAtIso,
  act,
  pressed,
  locked,
}: {
  approved: ThumbnailPackageProp[]
  targetId: string
  startedAtIso: string | null
  endedAtIso: string | null
  act: ReturnType<typeof useAction>['act']
  pressed: string | null
  locked: boolean
}) {
  // Share fields keep local drafts, seeded from what was stored; never reset by an effect.
  const [shares, setShares] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      approved.flatMap((pack) =>
        pack.watchTimeShare === null ? [] : [[pack.id, String(pack.watchTimeShare)]],
      ),
    ),
  )
  const [changing, setChanging] = React.useState(false)

  if (!startedAtIso) {
    return (
      <div>
        <Button
          variant="outline"
          busy={pressed === 'test-started'}
          disabled={locked}
          onClick={() =>
            void act(
              () => markTestStarted('master', targetId),
              'Test marked as started',
              'test-started',
            )
          }
        >
          I have started the test
        </Button>
      </div>
    )
  }

  const sentence = endedAtIso ? resultSentence(approved) : null
  if (endedAtIso && !changing) {
    const given = approved.flatMap((pack, at) =>
      pack.watchTimeShare === null ? [] : [{ id: pack.id, n: at + 1, share: pack.watchTimeShare }],
    )
    return (
      <div className="flex flex-col gap-1">
        {sentence ? (
          <p className="text-[13px] font-semibold text-[var(--color-text-primary)]">{sentence}</p>
        ) : null}
        {given.length > 0 ? (
          <ul className="flex flex-col gap-0.5 text-[12px] text-[var(--color-text-secondary)]">
            {given.map((item) => (
              <li key={item.id}>
                Variant {item.n}: {item.share}%
              </li>
            ))}
          </ul>
        ) : null}
        <div>
          <Button variant="outline" disabled={locked} onClick={() => setChanging(true)}>
            Change the result
          </Button>
        </div>
      </div>
    )
  }

  const send = (outcome: { winner: string } | 'same' | 'inconclusive', press: string) => {
    const typed: Record<string, number> = {}
    for (const [id, text] of Object.entries(shares)) {
      if (text.trim() !== '') typed[id] = Number(text)
    }
    void act(
      () => recordTestResult('master', targetId, { outcome, shares: typed }),
      'Result recorded',
      press,
    ).then((ok) => {
      if (ok) setChanging(false)
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {!endedAtIso ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">
          {testRunningReason({ testStartedAt: new Date(startedAtIso), testEndedAt: null })}
        </p>
      ) : null}
      <h4 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
        How did the test end?
      </h4>
      <div className="flex flex-wrap gap-2">
        {approved.map((pack, at) => (
          <Button
            key={pack.id}
            variant="outline"
            busy={pressed === `won-${pack.id}`}
            disabled={locked}
            onClick={() => send({ winner: pack.id }, `won-${pack.id}`)}
          >
            {at + 1} won
          </Button>
        ))}
        <Button
          variant="outline"
          busy={pressed === 'result-same'}
          disabled={locked}
          onClick={() => send('same', 'result-same')}
        >
          Performed the same
        </Button>
        <Button
          variant="outline"
          busy={pressed === 'result-inconclusive'}
          disabled={locked}
          onClick={() => send('inconclusive', 'result-inconclusive')}
        >
          Inconclusive
        </Button>
      </div>
      <p className="text-[12px] text-[var(--color-text-secondary)]">Watch time share, optional</p>
      <div className="flex flex-wrap gap-2">
        {approved.map((pack, at) => (
          <label
            key={pack.id}
            className="flex items-center gap-1 text-[12px] text-[var(--color-text-secondary)]"
          >
            <span aria-hidden>{at + 1}</span>
            <Input
              type="number"
              min={0}
              max={100}
              step="any"
              aria-label={`Watch time share, variant ${at + 1}`}
              className="w-24"
              value={shares[pack.id] ?? ''}
              onChange={(event) => setShares({ ...shares, [pack.id]: event.target.value })}
            />
            %
          </label>
        ))}
      </div>
      {endedAtIso ? (
        <div>
          <Button variant="outline" onClick={() => setChanging(false)}>
            Keep the recorded result
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** After the upload: variant 1 is on the video, the others wait for a Studio test. */
function HandOff({
  approved,
  studioUrl,
  targetId,
  startedAtIso,
  endedAtIso,
  act,
  pressed,
  locked,
}: {
  approved: ThumbnailPackageProp[]
  studioUrl: string | null
  targetId: string
  startedAtIso: string | null
  endedAtIso: string | null
  act: ReturnType<typeof useAction>['act']
  pressed: string | null
  locked: boolean
}) {
  const { toast } = useToast()
  const others = approved.slice(1)
  const copyTitle = async (title: string) => {
    try {
      await navigator.clipboard.writeText(title)
      toast({ title: 'Title copied' })
    } catch {
      toast({
        title: 'The title could not be copied',
        description: 'Select it in the title field and copy it by hand.',
        variant: 'error',
      })
    }
  }
  return (
    <section
      aria-label="Test and compare in Studio"
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
    >
      <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
        Test &amp; Compare in Studio
      </h3>
      <p className="text-[13px] text-[var(--color-text-secondary)]">
        Variant 1 is on the video. Start a test with the other two:
      </p>
      <ul className="flex flex-col gap-2">
        {others.map((pack, at) => (
          <li key={pack.id} className="flex flex-wrap items-center gap-2">
            <span className="w-4 text-[13px] font-semibold">{at + 2}</span>
            {pack.url ? (
              <Button asChild variant="outline">
                <a href={pack.url} download>
                  <Download aria-hidden className="h-4 w-4" />
                  Download thumbnail
                </a>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                <Download aria-hidden className="h-4 w-4" />
                Download thumbnail
              </Button>
            )}
            <Button variant="outline" onClick={() => void copyTitle(pack.title)}>
              <Copy aria-hidden className="h-4 w-4" />
              Copy title
            </Button>
            <span className="text-[12px] text-[var(--color-text-muted)]">{pack.title}</span>
          </li>
        ))}
      </ul>
      {studioUrl ? (
        <div>
          <Button asChild variant="outline">
            <a href={studioUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden className="h-4 w-4" />
              Open this video in Studio
            </a>
          </Button>
        </div>
      ) : null}
      <TestPanel
        approved={approved}
        targetId={targetId}
        startedAtIso={startedAtIso}
        endedAtIso={endedAtIso}
        act={act}
        pressed={pressed}
        locked={locked}
      />
    </section>
  )
}

export function ThumbnailSet({ item, busy }: { item: PublishItemModel; busy: boolean }) {
  const router = useRouter()
  const { act, busy: acting, pressed } = useAction()
  const record = item.record
  const packages = record?.packages ?? []
  const open = editable(record?.status)
  const working = busy || acting
  const inFlight = packages.some((pack) => pack.inFlight)

  // The route is re-read while a run works. A run that died has inFlight false
  // and is not polled for.
  React.useEffect(() => {
    if (!inFlight) return
    const timer = setInterval(() => router.refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [inFlight, router])

  const approvedCount = packages.filter((pack) => pack.approved).length
  const full = approvedCount >= PACKAGES_MAX
  const approvable = packages.some((pack) => pack.state === 'ready' && !pack.approved)
  const saved = record?.title?.trim() ?? ''
  const defaultTitle = packages[0]?.title.trim() ?? ''
  const replaces = defaultTitle !== '' && saved !== '' && defaultTitle !== saved

  const generateLabel =
    item.thumbnailSetCostUsd === null
      ? 'Generate a set'
      : `Generate a set · about $${item.thumbnailSetCostUsd.toFixed(2)}`

  const showHandOff =
    (record?.status === 'uploaded' ||
      record?.status === 'scheduled' ||
      record?.status === 'live') &&
    approvedCount >= 2

  return (
    <div className="flex w-full flex-col gap-3">
      <h3 className="text-[13px] font-semibold text-[var(--color-text-primary)]">
        Thumbnails and titles
      </h3>

      {open ? (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              busy={pressed === 'generate-set'}
              disabled={working || inFlight || full}
              onClick={() =>
                void act(
                  () => generateThumbnailSet('master', item.targetId),
                  'Making the set',
                  'generate-set',
                )
              }
            >
              <Sparkles aria-hidden className="h-4 w-4" />
              {generateLabel}
            </Button>
            {full ? (
              <span className="text-[12px] text-[var(--color-text-secondary)]">
                Three thumbnails are already approved. Remove one to generate more.
              </span>
            ) : null}
          </div>
          {record?.thumbnailSetNote ? (
            <p className="text-[12px] text-[var(--color-warning)]">{record.thumbnailSetNote}</p>
          ) : null}
          {item.styleReferencesLeftOut ? (
            <p className="text-[12px] text-[var(--color-text-secondary)]">
              Reference thumbnails were left out: {item.styleReferencesLeftOut} takes none.
            </p>
          ) : null}
        </div>
      ) : null}

      {packages.length === 0 ? (
        <p className="text-[12px] text-[var(--color-text-muted)]">No thumbnails stored yet.</p>
      ) : (
        <div className="grid [grid-template-columns:repeat(auto-fit,minmax(340px,1fr))] gap-3">
          {packages.map((pack, index) => (
            <PackageCard
              key={pack.id}
              pack={pack}
              index={index}
              isDefault={index === 0}
              open={open}
              locked={working || inFlight}
              act={act}
              pressed={pressed}
            />
          ))}
        </div>
      )}

      {open && approvable ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            busy={pressed === 'approve-set'}
            disabled={working || inFlight}
            onClick={() =>
              void act(
                () => approveThumbnailSet('master', item.targetId),
                'Set approved',
                'approve-set',
              )
            }
          >
            <Check aria-hidden className="h-4 w-4" />
            Approve this set
          </Button>
          {replaces ? (
            <span className="text-[12px] text-[var(--color-text-secondary)]">
              This replaces the saved title &quot;{record?.title}&quot;.
            </span>
          ) : null}
        </div>
      ) : null}

      {showHandOff ? (
        <HandOff
          approved={packages.filter((pack) => pack.approved)}
          studioUrl={item.studioUrl}
          targetId={item.targetId}
          startedAtIso={record?.testStartedAtIso ?? null}
          endedAtIso={record?.testEndedAtIso ?? null}
          act={act}
          pressed={pressed}
          locked={working}
        />
      ) : null}
    </div>
  )
}
