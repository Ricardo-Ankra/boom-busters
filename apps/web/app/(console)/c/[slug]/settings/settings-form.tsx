'use client'

import {
  type BibleDraft,
  type GradePreset,
  type Settings,
  type SettingsPatch,
} from '@boom-busters/schemas'
import type { ModelOptions } from '@boom-busters/providers'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, Label, Select } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BibleTab, type BibleVersionView } from './bible-tab'
import type { KeywordReadings } from './bible-measurements'
import type { MeasuredPaceView } from './bible-fields'
import type { SearchSpaceReadings } from './bible-search-space'
import type { CopySource } from './copy-from-channel'
import { ModelsTab } from './models-tab'
import { VoiceTab } from './voice-tab'
import { LogosTab, type LogoView } from './logos-tab'
import type { ChannelExemplarView } from '@/lib/exemplar-channel-views'
import type { DerivationEstimateTable } from '@/lib/derivation-estimate'
import type { DerivationView } from './exemplar-actions'
import { ExemplarsTab } from './exemplars-tab'
import { MotionTab, type TechniqueOption } from './motion-tab'
import type { ReferenceView } from './references-section'
import type { ExemplarLogo } from './exemplar-logo'
import type { ExemplarView } from '@/lib/exemplar-views'
import type { ReelPiece } from '@/lib/specimen-reel'
import { YoutubeCard, type YoutubeConnectionView } from './youtube-card'
import { YOUTUBE_OUTCOMES } from './youtube-outcome'
import { useToast } from '@/components/ui/toast'
import { CHANNEL_ARCHIVED_MESSAGE } from '@/lib/channel-archived'
import { saveSettings } from './actions'
import { updateChannelAction } from './channel-actions'
import { ChannelTab, type ChannelPatch, type ChannelView } from './channel-tab'
import { ScheduleSlotsCard } from './schedule-slots-card'

/**
 * Loaded on demand: the specimen carries @remotion/player and the whole
 * composition library, which the other five tabs never need. `ssr: false`
 * because the Player draws frames — there is nothing to server-render.
 */
const BrandSpecimenPanel = dynamic(
  () => import('./brand-specimen').then((module) => module.BrandSpecimenPanel),
  {
    ssr: false,
    loading: () => (
      <p className="text-[13px] text-[var(--color-text-muted)]">Loading the specimen…</p>
    ),
  },
)

export function SettingsForm({
  initialSettings,
  youtubeConnection,
  channelId,
  channelSlug,
  channel: initialChannel,
  channels = [],
  showNewChannel = false,
  youtubeEnvReady = false,
  youtubeOutcome,
  initialTab = 'models',
  logos = [],
  channelMarkKey = null,
  modelOptions,
  exemplars = [],
  specimenReel = [],
  exemplarLogo = null,
  techniqueOptions = [],
  references = [],
  storageReady = false,
  readingEstimateUsd = 0,
  draftEstimateUsd = 0,
  channelExemplars = [],
  derivation = null,
  jobRunning = false,
  mechanismReferences = 0,
  estimateTable,
  draft = null,
  versions = [],
  currentVersion,
  vidiqReady = false,
  copySources = [],
  keywordReadings,
  measureCount = 0,
  searchSpace,
  searchSpaceCounts,
  measuredPace,
}: {
  initialSettings: Settings
  /** This channel's YouTube connection, masked. */
  youtubeConnection?: YoutubeConnectionView
  channelId: string
  channelSlug: string
  /** The channel's name, handle and bible, as stored. */
  channel: ChannelView
  /** Every live channel, for the New channel form's Copy from list. */
  channels?: { id: string; name: string }[]
  /** `?new=1`: open the New channel form on the Channel tab. */
  showNewChannel?: boolean
  /** Whether the YouTube OAuth client env vars exist — server-resolved too. */
  youtubeEnvReady?: boolean
  /** The `?youtube=` outcome the connect flow came back with. */
  youtubeOutcome?: string
  /** From `?tab=`, validated by the page — deep links land on the right tab. */
  initialTab?: string
  logos?: LogoView[]
  channelMarkKey?: string | null
  /** Live lists merged with the catalogue, built on the server (decision 288). */
  modelOptions: ModelOptions
  /** The exemplar corpus, compiled on the server (decision 305). */
  exemplars?: ExemplarView[]
  /** The Brand Kit's package reel, chosen on the server from the exemplars. */
  specimenReel?: ReelPiece[]
  /** The technique catalogue, for the Motion tab's techniques in use (spec 2026-11-04). */
  techniqueOptions?: readonly TechniqueOption[]
  /** The channel's reference pack, for the Motion tab (spec 2026-11-04, section 11.2). */
  references?: readonly ReferenceView[]
  /** R2 is configured, so the Motion tab can upload references. */
  storageReady?: boolean
  /** What one reference reading costs on the graphics route, in dollars. */
  readingEstimateUsd?: number
  /** What one identity draft costs on the graphics route, in dollars. */
  draftEstimateUsd?: number
  /** The channel's own exemplar versions, per technique (spec 2026-11-04, section 11.4). */
  channelExemplars?: readonly ChannelExemplarView[]
  /** Live mechanism references that are read (spec 8.5): the Derive dialogue offers the proposal when there is one. */
  mechanismReferences?: number
  /** The latest derivation, for the Motion tab's Derive section (section 11.3). */
  derivation?: DerivationView | null
  /** A derivation is running on this channel: Derive, Refine and Copy wait. */
  jobRunning?: boolean
  /** The derivation's prices on the channel's routes; absent, Derive and Copy are not shown. */
  estimateTable?: DerivationEstimateTable
  /** The channel mark the logo-reveal example plays (`exemplarLogoFor`). */
  exemplarLogo?: ExemplarLogo | null
  /** The bible's working draft, or null when there is none. */
  draft?: BibleDraft | null
  /** Every saved version of the bible, oldest first. */
  versions?: BibleVersionView[]
  /** The saved bible the channel runs on; defaults to the channel's own. */
  currentVersion?: { id: string; version: number; bible: ChannelView['bible'] }
  /** A VidIQ key is on file, or mocks stand in for it. */
  vidiqReady?: boolean
  /** Every other channel, archived ones included, for the Bible tab's copy. */
  copySources?: CopySource[]
  keywordReadings?: KeywordReadings
  /** The latest search-space analysis of each format keyword, by lower-cased keyword. */
  searchSpace?: SearchSpaceReadings
  /** Per format key, how many of its keywords have no analysis from the last 30 days. */
  searchSpaceCounts?: Record<string, number>
  /** The pace the channel's voice measured at; null when no take qualifies. */
  measuredPace?: MeasuredPaceView | null
  measureCount?: number
}) {
  const [settings, setSettings] = React.useState(initialSettings)
  const [saving, setSaving] = React.useState(false)

  // The techniques in use change on the server when a channel's own technique
  // is approved or kept on the Exemplars tab (spec 8.5); the refreshed page
  // brings the new list here. Only a changed list is taken, so this never
  // resets a field the owner is editing (the memory note on no-op setState).
  const serverTechniques = initialSettings.motion.techniques
  React.useEffect(() => {
    setSettings((current) => {
      const own = current.motion.techniques
      const same =
        own.length === serverTechniques.length &&
        own.every((key, index) => key === serverTechniques[index])
      return same
        ? current
        : { ...current, motion: { ...current.motion, techniques: serverTechniques } }
    })
    // Only the server's list: the rest of the form keeps its own state until a save.
  }, [serverTechniques])
  const { toast } = useToast()
  const router = useRouter()

  /**
   * Optimistic update with a rollback toast on failure (spec section 11.1).
   * The previous value is captured before the write so a rejected patch
   * restores exactly what was on screen, not a stale refetch.
   */
  const commit = React.useCallback(
    async (patch: SettingsPatch, optimistic: Settings) => {
      const previous = settings
      setSettings(optimistic)
      setSaving(true)

      const result = await saveSettings(channelId, patch)

      setSaving(false)
      if (!result.ok) {
        setSettings(previous)
        toast({ title: 'Could not save', description: result.error, variant: 'error' })
      } else {
        toast({ title: 'Saved' })
      }
    },
    [settings, toast, channelId],
  )

  const [channel, setChannel] = React.useState(initialChannel)
  // A saved bible version arrives with the refresh; the Channel tab's status line follows it.
  React.useEffect(() => {
    // A no-op update must not re-render the form after hydration, or a controlled field changed before
    // hydration is reset to the server value and its old value saved.
    setChannel((current) =>
      current.bible === initialChannel.bible
        ? current
        : { ...current, bible: initialChannel.bible },
    )
  }, [initialChannel.bible])

  // Controlled, so an in-page link to `?tab=bible` switches the tab.
  const [tab, setTab] = React.useState(initialTab)
  React.useEffect(() => setTab(initialTab), [initialTab])
  // The URL follows the tab, so a deep link and the in-page link agree with what is shown.
  // A null state, so Next's router learns the URL too: handed its own state, it took the call
  // for one of its own and kept the old URL, which every refresh then put back, and any full
  // load of that (a deploy since the page opened, a failed refresh) opened on Models.
  const selectTab = React.useCallback((next: string) => {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', next)
    window.history.replaceState(null, '', url)
  }, [])

  /** The same optimistic-with-rollback save, for the channel's own row. */
  const commitChannel = React.useCallback(
    async (patch: ChannelPatch) => {
      const previous = channel
      setChannel({
        ...channel,
        ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
        ...(patch.handle === undefined ? {} : { handle: patch.handle.trim() || null }),
      })
      setSaving(true)

      const result = await updateChannelAction(channelId, patch)

      setSaving(false)
      if (!result.ok) {
        setChannel(previous)
        toast({ title: 'Could not save', description: result.error, variant: 'error' })
      } else {
        toast({ title: 'Saved' })
        router.refresh()
      }
    },
    [channel, channelId, toast, router],
  )

  return (
    <div className="flex flex-col gap-3">
      {channel.archived ? (
        <p
          role="status"
          className="rounded-[8px] border border-[var(--color-warning)]/40 p-3 text-[13px]"
        >
          {CHANNEL_ARCHIVED_MESSAGE}. Its settings can be read but not changed.
        </p>
      ) : null}
      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList>
          <TabsTrigger value="channel">Channel</TabsTrigger>
          <TabsTrigger value="bible">Bible</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="brand-kit">Brand Kit</TabsTrigger>
          <TabsTrigger value="motion">Motion</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="logos">Logos</TabsTrigger>
          <TabsTrigger value="exemplars">Exemplars</TabsTrigger>
          <TabsTrigger value="publishing">Publishing</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="channel">
          <Lock archived={channel.archived}>
            {' '}
            <ChannelTab
              channel={channel}
              channels={channels}
              showNew={showNewChannel}
              onOpenBible={() => selectTab('bible')}
              saving={saving}
              commit={commitChannel}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="bible">
          <Lock archived={channel.archived}>
            <BibleTab
              channel={channel}
              draft={draft}
              versions={versions}
              currentVersion={currentVersion ?? { id: '', version: 1, bible: channel.bible }}
              vidiqReady={vidiqReady}
              archived={channel.archived}
              copySources={copySources}
              {...(keywordReadings ? { readings: keywordReadings } : {})}
              measureCount={measureCount}
              {...(searchSpace ? { searchSpace } : {})}
              {...(searchSpaceCounts ? { searchSpaceCounts } : {})}
              {...(measuredPace !== undefined ? { measuredPace } : {})}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="models">
          <Lock archived={channel.archived}>
            {' '}
            <ModelsTab settings={settings} saving={saving} commit={commit} options={modelOptions} />
          </Lock>
        </TabsContent>

        <TabsContent value="brand-kit">
          <Lock archived={channel.archived}>
            {' '}
            <BrandKitTab settings={settings} saving={saving} commit={commit} reel={specimenReel} />
          </Lock>
        </TabsContent>

        <TabsContent value="motion">
          <Lock archived={channel.archived}>
            {' '}
            <MotionTab
              channelId={channelId}
              archived={channel.archived}
              settings={settings}
              saving={saving}
              commit={commit}
              techniqueOptions={techniqueOptions}
              references={references}
              storageReady={storageReady}
              readingEstimateUsd={readingEstimateUsd}
              draftEstimateUsd={draftEstimateUsd}
              derivation={derivation}
              jobRunning={jobRunning}
              mechanismReferences={mechanismReferences}
              {...(estimateTable ? { estimateTable } : {})}
              approvedTechniques={channelExemplars
                .filter((view) => view.approved !== null)
                .map((view) => view.technique)}
              copySources={copySources.map((source) => ({
                id: source.id,
                name: source.name,
                archived: source.archived,
              }))}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="voice">
          <Lock archived={channel.archived}>
            {' '}
            <VoiceTab
              channelId={channelId}
              settings={settings}
              saving={saving}
              commit={commit}
              auditionLine={channel.bible.auditionLine}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="logos">
          <Lock archived={channel.archived}>
            {' '}
            <LogosTab
              channelId={channelId}
              logos={logos}
              channelMarkKey={channelMarkKey}
              brandBackground={settings.brandKit.colors.background}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="exemplars">
          <Lock archived={channel.archived}>
            {' '}
            <ExemplarsTab
              exemplars={exemplars}
              brand={settings.brandKit}
              exemplarLogo={exemplarLogo}
              {...(estimateTable
                ? {
                    channelId,
                    channel: channelExemplars,
                    archived: channel.archived,
                    jobRunning,
                    techniqueOptions,
                    mechanismReferences,
                    techniquesInUse: settings.motion.techniques,
                    estimateTable,
                    storageReady,
                    lastRun:
                      derivation && derivation.state !== 'running'
                        ? derivation.progress.map((entry) => ({
                            technique: entry.technique,
                            costUsd: entry.costUsd,
                          }))
                        : null,
                  }
                : {})}
            />
          </Lock>
        </TabsContent>

        <TabsContent value="publishing">
          <Lock archived={channel.archived}>
            {' '}
            <PublishingTab settings={settings} saving={saving} commit={commit} />
          </Lock>
        </TabsContent>

        <TabsContent value="connections">
          <Lock archived={channel.archived}>
            {' '}
            <ConnectionsTab
              youtubeConnection={youtubeConnection}
              channelId={channelId}
              channelSlug={channelSlug}
              youtubeEnvReady={youtubeEnvReady}
              youtubeOutcome={youtubeOutcome}
            />
          </Lock>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/** Disables every control inside it while the channel is archived. */
function Lock({ archived, children }: { archived: boolean; children: React.ReactNode }) {
  return (
    <fieldset disabled={archived} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  )
}

interface TabProps {
  settings: Settings
  saving: boolean
  commit: (patch: SettingsPatch, optimistic: Settings) => Promise<void>
}

function BrandKitTab({ settings, saving, commit, reel }: TabProps & { reel: ReelPiece[] }) {
  const { colors } = settings.brandKit

  const setColor = (key: 'primary' | 'accent' | 'captionHighlight', value: string) => {
    const next = structuredClone(settings)
    next.brandKit.colors[key] = value
    void commit({ brandKit: { ...next.brandKit } }, next)
  }

  const setLook = <K extends 'gradePreset' | 'grainPreset' | 'chapterMarking'>(
    key: K,
    value: Settings['brandKit']['look'][K],
  ) => {
    const next = structuredClone(settings)
    next.brandKit.look[key] = value
    void commit({ brandKit: { ...next.brandKit } }, next)
  }

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>Colours</CardTitle>
          <CardDescription>
            Timelines snapshot these at compile time, so a rebrand never changes how an old project
            re-renders.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          {(['primary', 'accent', 'captionHighlight'] as const).map((key) => (
            <div key={key} className="flex flex-col gap-1.5">
              <Label htmlFor={`colour-${key}`}>{key}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`colour-${key}`}
                  type="color"
                  className="h-10 w-14 p-1"
                  disabled={saving}
                  defaultValue={colors[key]}
                  onBlur={(event) => setColor(key, event.target.value)}
                />
                <span className="font-mono text-[13px] text-[var(--color-text-secondary)]">
                  {colors[key]}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Photographic look</CardTitle>
          <CardDescription>
            Applied to every photograph in the film at render: stills, stock and archival. Image
            prompts carry no grade or grain, so this is the one place the film&apos;s look is set.{' '}
            The opening chapter never gets a card; this chooses what marks the chapters after it. A
            format can override it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-grade">Grade</Label>
            <Select
              id="look-grade"
              aria-label="Grade"
              value={settings.brandKit.look.gradePreset ?? 'muted'}
              disabled={saving}
              onChange={(event) => setLook('gradePreset', event.target.value as GradePreset)}
            >
              <option value="none">None</option>
              <option value="muted">Muted</option>
              <option value="strong">Strong</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-grain">Grain</Label>
            <Select
              id="look-grain"
              aria-label="Grain"
              value={settings.brandKit.look.grainPreset}
              disabled={saving}
              onChange={(event) =>
                setLook(
                  'grainPreset',
                  event.target.value as Settings['brandKit']['look']['grainPreset'],
                )
              }
            >
              <option value="none">None</option>
              <option value="subtle">Subtle</option>
              <option value="film">Film</option>
              <option value="heavy">Heavy</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-chapter-marking">Chapter marking</Label>
            <Select
              id="look-chapter-marking"
              aria-label="Chapter marking"
              value={settings.brandKit.look.chapterMarking}
              disabled={saving}
              onChange={(event) =>
                setLook(
                  'chapterMarking',
                  event.target.value as Settings['brandKit']['look']['chapterMarking'],
                )
              }
            >
              <option value="cards">A card at every chapter after the opening</option>
              <option value="title">The film&apos;s title once, after the opening</option>
              <option value="none">No cards</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Chart series palette</CardTitle>
          <CardDescription>
            Ordered and colour-blind safe. Charts are the anti-slop differentiator, so this palette
            is used in order, never randomly.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {colors.chartSeries.map((colour, index) => (
            <span
              key={`${colour}-${index}`}
              className="flex items-center gap-2 rounded-[8px] border border-[var(--color-border)] px-2 py-1"
            >
              <span
                aria-hidden
                className="size-4 rounded-[4px]"
                style={{ backgroundColor: colour }}
              />
              <span className="font-mono text-[12px]">{colour}</span>
            </span>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Live specimen</CardTitle>
          <CardDescription>
            The film title, chapter card, lower third, a chart and a counter, drawn by this
            channel&apos;s approved exemplars (or the house designs) with these exact values. Colour
            edits above show up here as they save.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BrandSpecimenPanel settings={settings} reel={reel} />
        </CardContent>
      </Card>
    </div>
  )
}

function PublishingTab({ settings, saving, commit }: TabProps) {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>YouTube API audit</CardTitle>
          <CardDescription>
            Until the audit passes, the publish screen shows a manual &ldquo;flip to public in
            Studio&rdquo; checklist instead of pretending the API can do it.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Switch
            id="api-audit"
            checked={settings.publish.apiAuditPassed}
            disabled={saving}
            onCheckedChange={(checked) => {
              const next = structuredClone(settings)
              next.publish.apiAuditPassed = checked
              void commit({ publish: { ...next.publish } }, next)
            }}
          />
          <Label htmlFor="api-audit">
            {settings.publish.apiAuditPassed ? 'Audit passed' : 'Audit not passed yet'}
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily upload budget</CardTitle>
          <CardDescription>
            Upload starts allowed per YouTube quota day, which resets at midnight Pacific. Anything
            over the budget waits for the next quota day on its own.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 sm:max-w-xs">
          <Label htmlFor="daily-upload-budget">Uploads per quota day</Label>
          <Select
            id="daily-upload-budget"
            aria-label="Uploads per quota day"
            value={String(settings.publish.dailyUploadBudget)}
            disabled={saving}
            onChange={(event) => {
              const next = structuredClone(settings)
              next.publish.dailyUploadBudget = Number(event.target.value)
              void commit({ publish: { ...next.publish } }, next)
            }}
          >
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        </CardContent>
      </Card>

      <ScheduleSlotsCard settings={settings} saving={saving} commit={commit} />
    </div>
  )
}

function ConnectionsTab({
  youtubeConnection,
  channelId,
  channelSlug,
  youtubeEnvReady,
  youtubeOutcome,
}: {
  youtubeConnection: YoutubeConnectionView | undefined
  channelId: string
  channelSlug: string
  youtubeEnvReady: boolean
  youtubeOutcome: string | undefined
}) {
  const outcome = youtubeOutcome ? YOUTUBE_OUTCOMES[youtubeOutcome] : undefined
  return (
    <div className="flex flex-col gap-3">
      {outcome ? (
        <p
          role="status"
          className={`text-[13px] ${
            outcome.good ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'
          }`}
        >
          {outcome.text}
        </p>
      ) : null}
      {/* OAuth, not a key paste. Each channel connects its own account. */}
      <YoutubeCard
        connection={youtubeConnection}
        envReady={youtubeEnvReady}
        channelId={channelId}
        slug={channelSlug}
      />

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-[var(--color-text-secondary)]">
        <p>Provider keys are shared by every channel and live in the workspace settings.</p>
        <Button asChild variant="outline">
          <Link href="/settings?tab=connections">Open the workspace keys</Link>
        </Button>
      </div>
    </div>
  )
}
