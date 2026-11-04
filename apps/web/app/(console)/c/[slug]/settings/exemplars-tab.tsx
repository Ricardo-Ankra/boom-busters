'use client'

import { CRITIC_AXES, EXEMPLAR_STEER_MAX } from '@boom-busters/schemas'
import type { BrandKitStored, Technique } from '@boom-busters/schemas'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import type { ChannelExemplarVersionView, ChannelExemplarView } from '@/lib/exemplar-channel-views'
import type { ExemplarView } from '@/lib/exemplar-views'
import type { DerivationEstimateTable } from '@/lib/motion-estimates'
import { GraphicPlayback, GraphicPlaybackProvider } from '../../../projects/[id]/graphic-playback'
import { DeriveDialog, techniqueName } from './derive-dialog'
import { approveExemplarVersionAction, refineExemplarAction } from './exemplar-actions'
import { exemplarCodeLogos, type ExemplarLogo } from './exemplar-logo'
import { CriticLines, SideBySide, VersionsList } from './exemplar-versions'
import type { TechniqueOption } from './motion-tab'

/**
 * The exemplar corpus (decision 305), per channel since spec 2026-11-04
 * section 11.4: each technique card shows the channel's approved version
 * (or the house exemplar when none), its player, its concept and the
 * critic's last scores, with Refine, Derive this one and Versions. The
 * side by side after a refine lives here. One plays at a time. The
 * logo-reveal example plays the channel mark, when one is set.
 */

const REFINE_POLL_MS = 5000
const REFINE_WAIT_MS = 5 * 60_000

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const textareaClass =
  'min-h-[72px] w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-50'

function dayOf(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** "Engagement 9 · Intent 9 · …" from the critic's last scores. */
function scoresLine(version: ChannelExemplarVersionView): string | null {
  if (!version.scores) return null
  const scores = version.scores
  return CRITIC_AXES.map((axis) => `${capitalised(axis)} ${scores[axis].score}`).join(' · ')
}

/** What the channel-level props carry; absent, the tab is the house corpus as before. */
export interface ChannelExemplarsProps {
  channelId: string
  channel: readonly ChannelExemplarView[]
  archived: boolean
  jobRunning: boolean
  techniqueOptions: readonly TechniqueOption[]
  estimateTable: DerivationEstimateTable
  storageReady: boolean
  lastRun: readonly { technique: string; costUsd: number }[] | null
}

export function ExemplarsTab({
  exemplars,
  brand,
  exemplarLogo = null,
  ...channelProps
}: {
  exemplars: readonly ExemplarView[]
  brand: BrandKitStored
  /** The channel mark, for the logo-reveal example (`exemplarLogoFor`); null when none is set. */
  exemplarLogo?: ExemplarLogo | null
} & Partial<ChannelExemplarsProps>) {
  const written = exemplars.filter((exemplar) => exemplar.title !== undefined).length
  const perChannel = channelProps.channelId ? (channelProps as ChannelExemplarsProps) : null
  const [deriving, setDeriving] = React.useState<Technique | null>(null)
  const router = useRouter()
  return (
    <GraphicPlaybackProvider>
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Exemplars</CardTitle>
            <CardDescription>
              Before the designer makes a graphic, it is shown one finished example of the same kind
              and patterns on it. Each example plays here with your Brand Kit, its own sample
              narration and, for a chart, its sample data. A technique with an approved version of
              this channel's own shows that in place of the house example.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-[14px]">
              {written} of {exemplars.length} examples written
            </p>
          </CardContent>
        </Card>
        {exemplars.map((exemplar) => (
          <ExemplarCard
            key={exemplar.technique}
            exemplar={exemplar}
            brand={brand}
            exemplarLogo={exemplarLogo}
            perChannel={perChannel}
            own={perChannel?.channel.find((view) => view.technique === exemplar.technique) ?? null}
            onDerive={() => setDeriving(exemplar.technique)}
          />
        ))}
        {perChannel && deriving ? (
          <DeriveDialog
            channelId={perChannel.channelId}
            techniques={perChannel.techniqueOptions}
            defaults={[deriving]}
            lastRun={perChannel.lastRun}
            estimateTable={perChannel.estimateTable}
            storageReady={perChannel.storageReady}
            onClose={() => setDeriving(null)}
            onLaunched={() => router.refresh()}
          />
        ) : null}
      </div>
    </GraphicPlaybackProvider>
  )
}

function ExemplarCard({
  exemplar,
  brand,
  exemplarLogo,
  perChannel,
  own,
  onDerive,
}: {
  exemplar: ExemplarView
  brand: BrandKitStored
  exemplarLogo: ExemplarLogo | null
  perChannel: ChannelExemplarsProps | null
  own: ChannelExemplarView | null
  onDerive: () => void
}) {
  const headingId = React.useId()
  const steerId = React.useId()
  const reviewId = React.useId()
  const router = useRouter()
  const { toast } = useToast()
  const name = techniqueName(exemplar.technique)
  const approved = own?.approved ?? null
  const draft = own?.pendingDraft ?? null
  const [steer, setSteer] = React.useState('')
  const [reviewOpen, setReviewOpen] = React.useState(false)
  const [versionsOpen, setVersionsOpen] = React.useState(false)
  const [refiningSince, setRefiningSince] = React.useState<number | null>(null)
  const steerRef = React.useRef<HTMLTextAreaElement>(null)
  const disabled = !perChannel || perChannel.archived || perChannel.jobRunning

  // After Refine, ask the page again every few seconds until the draft arrives or five minutes pass.
  React.useEffect(() => {
    if (refiningSince === null) return
    if (draft && new Date(draft.createdAt).getTime() > refiningSince) {
      setRefiningSince(null)
      return
    }
    if (Date.now() - refiningSince > REFINE_WAIT_MS) {
      setRefiningSince(null)
      return
    }
    const timer = setInterval(() => router.refresh(), REFINE_POLL_MS)
    return () => clearInterval(timer)
  }, [refiningSince, draft, router])

  const refine = async () => {
    if (!perChannel) return
    const parent = approved ?? draft
    if (!parent) return
    const result = await refineExemplarAction(perChannel.channelId, parent.id, steer.trim())
    if (!result.ok) {
      toast({ title: 'Could not start the refine', description: result.error, variant: 'error' })
      return
    }
    setSteer('')
    setRefiningSince(Date.now())
    toast({ title: 'Refining', description: 'The new version appears here when it is built.' })
  }

  const shown = approved
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId}>{name}</CardTitle>
        <CardDescription>{exemplar.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {shown ? (
          <>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Approved v{shown.version}, derived {dayOf(shown.createdAt)}
            </p>
            <p className="text-[14px] font-medium">{shown.code.title}</p>
            <p className="text-[13px]">{shown.concept}</p>
            {shown.verdict ? (
              <p className="text-[12px] text-[var(--color-text-muted)]">
                Reviewed by the critic:{' '}
                {shown.verdict === 'ready' ? 'ready.' : 'the critic wants one more pass.'}
              </p>
            ) : null}
            {scoresLine(shown) ? (
              <>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {scoresLine(shown)}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={reviewOpen}
                  aria-controls={reviewId}
                  onClick={() => setReviewOpen((open) => !open)}
                >
                  {reviewOpen ? 'Hide review' : 'Show review'}
                </Button>
                <div id={reviewId} hidden={!reviewOpen}>
                  <CriticLines version={shown} />
                </div>
              </>
            ) : null}
            <GraphicPlayback
              slotId={`exemplar-${exemplar.technique}-${shown.id}`}
              code={shown.code}
              {...(shown.data ? { data: shown.data } : {})}
              noun="example"
              brand={brand}
              logoUrls={{}}
              durationMs={shown.code.durationMs}
            />
          </>
        ) : (
          <>
            {perChannel ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">House exemplar</p>
            ) : null}
            {exemplar.title !== undefined ? (
              <p className="text-[14px] font-medium">{exemplar.title}</p>
            ) : (
              <p className="text-[14px] text-[var(--color-text-muted)]">Not written yet</p>
            )}
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Adapted from{' '}
              <a
                href={exemplar.template.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-10 items-center underline underline-offset-2"
              >
                {exemplar.template.name} <span className="sr-only">(opens in a new tab)</span>
              </a>{' '}
              in {exemplar.template.repository}, {exemplar.template.licence} licence
            </p>
            {exemplar.issue !== undefined ? (
              <p role="status" className="text-[13px] text-[var(--color-danger)]">
                This example cannot play: {exemplar.issue}
              </p>
            ) : null}
            {exemplar.code ? (
              <GraphicPlayback
                slotId={`exemplar-${exemplar.technique}`}
                code={exemplar.code}
                {...(exemplar.data ? { data: exemplar.data } : {})}
                codeLogos={exemplarCodeLogos(exemplar.technique, exemplarLogo)}
                noun="example"
                brand={brand}
                logoUrls={{}}
                durationMs={exemplar.code.durationMs}
              />
            ) : null}
          </>
        )}

        {perChannel && draft && (approved || draft.parentId) ? (
          <SideBySide
            channelId={perChannel.channelId}
            technique={exemplar.technique}
            draft={draft}
            against={
              approved ?? own?.versions.find((version) => version.id === draft.parentId) ?? draft
            }
            brand={brand}
            disabled={disabled}
            onRefineAgain={() => steerRef.current?.focus()}
          />
        ) : null}
        {perChannel && draft && !approved && !draft.parentId ? (
          <section
            aria-label="A draft to review"
            className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
          >
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Draft v{draft.version}, derived {dayOf(draft.createdAt)}
              {draft.verdict
                ? draft.verdict === 'ready'
                  ? ': ready for your review'
                  : ': the critic wants one more pass'
                : ''}
            </p>
            <p className="text-[13px]">{draft.concept}</p>
            <CriticLines version={draft} />
            <GraphicPlayback
              slotId={`exemplar-${exemplar.technique}-${draft.id}`}
              code={draft.code}
              {...(draft.data ? { data: draft.data } : {})}
              noun="example"
              brand={brand}
              logoUrls={{}}
              durationMs={draft.code.durationMs}
            />
            <DraftApprove channelId={perChannel.channelId} draft={draft} disabled={disabled} />
          </section>
        ) : null}

        {perChannel ? (
          <div className="flex flex-col gap-3">
            {approved || draft ? (
              <div className="flex flex-col gap-1">
                <Label htmlFor={steerId}>
                  Refine with a steer (plain words, {EXEMPLAR_STEER_MAX} characters)
                </Label>
                <textarea
                  id={steerId}
                  ref={steerRef}
                  className={textareaClass}
                  value={steer}
                  maxLength={EXEMPLAR_STEER_MAX}
                  onChange={(event) => setSteer(event.target.value)}
                  disabled={disabled || refiningSince !== null}
                />
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {approved || draft ? (
                <Button
                  type="button"
                  onClick={refine}
                  disabled={disabled || refiningSince !== null || steer.trim() === ''}
                >
                  {refiningSince !== null ? 'Refining' : 'Refine'}
                </Button>
              ) : null}
              <Button type="button" variant="outline" onClick={onDerive} disabled={disabled}>
                Derive this one
              </Button>
              {own && own.versions.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  aria-expanded={versionsOpen}
                  onClick={() => setVersionsOpen((open) => !open)}
                >
                  Versions
                </Button>
              ) : null}
            </div>
            {versionsOpen && own ? (
              <VersionsList
                channelId={perChannel.channelId}
                versions={own.versions}
                disabled={disabled}
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** "Approve this" on a first draft, with no version to set it beside. */
function DraftApprove({
  channelId,
  draft,
  disabled,
}: {
  channelId: string
  draft: ChannelExemplarVersionView
  disabled: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = React.useState(false)
  const approve = async () => {
    setBusy(true)
    try {
      const result = await approveExemplarVersionAction(channelId, draft.id)
      if (!result.ok) {
        toast({
          title: 'Could not approve the version',
          description: result.error,
          variant: 'error',
        })
        return
      }
      toast({ title: `Approved v${draft.version}` })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <Button type="button" onClick={approve} disabled={disabled || busy}>
        Approve this
      </Button>
    </div>
  )
}
