import {
  currentBible,
  getBibleDraft,
  getChannelSettings,
  getWorkspace,
  hasCredential,
  keywordsToMeasure,
  searchSpaceKeywords,
  latestKeywordMeasurements,
  latestSearchSpace,
  listBibleVersions,
  measuredPace,
  listChannels,
  getAsset,
  listLogos,
  listMotionReferences,
  maskKey,
  channelYoutubeConnection,
} from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { hasEnvGroup } from '@boom-busters/schemas'
import { redirect } from 'next/navigation'
import { channelFromSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'
import { loadModelOptions } from '@/lib/model-catalogue'
import { MANIFEST } from '@boom-busters/providers'
import { exemplarViews } from '@/lib/exemplar-views'
import { identityDraftEstimateUsd, readingEstimateUsd } from '@/lib/motion-estimates'
import { presignGet, storageConfigured } from '@/lib/storage'
import type { ReferenceView } from './references-section'
import { exemplarLogoFor } from './exemplar-logo'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · Boom-Busters' }

const TABS = [
  'channel',
  'bible',
  'models',
  'brand-kit',
  'motion',
  'voice',
  'logos',
  'exemplars',
  'publishing',
  'connections',
] as const
type SettingsTab = (typeof TABS)[number]

export default async function SettingsPage({
  params: routeParams,
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
  params: Promise<{ slug: string }>
}) {
  const { slug } = await routeParams
  const channel = await channelFromSlug(slug)
  const [
    settings,
    workspace,
    connectionRow,
    logos,
    references,
    allChannels,
    params,
    draft,
    versions,
    current,
    vidiqKey,
    latestReadings,
    latestSpace,
    pace,
  ] = await Promise.all([
    getChannelSettings(db, channel.id),
    getWorkspace(db),
    channelYoutubeConnection(db, channel.id),
    listLogos(db, channel.id),
    listMotionReferences(db, channel.id),
    listChannels(db, { includeArchived: true }),
    searchParams,
    // Never opened here: a draft exists once the owner changes something.
    getBibleDraft(db, channel.id),
    listBibleVersions(db, channel.id),
    currentBible(db, channel.id),
    hasCredential(db, 'vidiq'),
    latestKeywordMeasurements(db, channel.id),
    latestSearchSpace(db, channel.id),
    measuredPace(db, channel.id),
  ])

  // The music library and the price table are the workspace's now; an old
  // bookmark to either lands on the workspace page.
  const requestedTab = typeof params['tab'] === 'string' ? params['tab'] : undefined
  if (requestedTab === 'music' || requestedTab === 'prices') {
    redirect(`/settings?tab=${requestedTab}`)
  }

  // The dropdowns' options: the cached live lists merged with the catalogue
  // and priced with the workspace's overrides (decision 288). Needs the
  // settings, so it runs after the batch above.
  const youtubeConnection = connectionRow
    ? {
        masked: maskKey(connectionRow.keyHint),
        verifyStatus: connectionRow.verifyStatus,
        lastVerifiedAt: connectionRow.lastVerifiedAt,
        youtubeChannelTitle: connectionRow.youtubeChannelTitle,
      }
    : undefined

  // Each format and pillar keyword's latest VidIQ reading, and how many the
  // button would buy: counted over the draft when one is open, as the action does.
  const keywordReadings = Object.fromEntries(
    [...latestReadings].map(([key, row]) => [
      key,
      {
        volume: row.volume,
        competition: row.competition,
        measuredAt: row.measuredAt.toISOString(),
      },
    ]),
  )
  const measureCount = keywordsToMeasure(
    draft?.bible ?? current.bible,
    latestReadings,
    new Date(),
  ).length

  // Each format keyword's latest search-space analysis, and per format how many
  // of its keywords the button would buy: counted over the draft, as the action does.
  const searchSpace = Object.fromEntries(
    [...latestSpace].map(([key, row]) => [
      key,
      {
        measuredAt: row.measuredAt.toISOString(),
        titlePatterns: row.titlePatterns,
        durations: row.durations,
      },
    ]),
  )
  const searchSpaceCounts = Object.fromEntries(
    (draft?.bible ?? current.bible).formats.map((format) => [
      format.key,
      searchSpaceKeywords(format.keywords, latestSpace, new Date()).length,
    ]),
  )

  const modelOptions = await loadModelOptions({
    routing: settings.modelRouting,
    prices: workspace.settings.modelPrices,
  })

  const logoViews = await Promise.all(
    logos.map(async (logo) => ({
      id: logo.id,
      title: logo.title ?? 'Unnamed mark',
      r2Key: logo.r2Key,
      width: logo.width,
      height: logo.height,
      url:
        storageConfigured() && !logo.r2Key.startsWith('mock://')
          ? await presignGet(logo.r2Key)
          : null,
    })),
  )

  // The reference pack's cards: the first frame, the sheets and, for a clip,
  // the original, each presigned when storage holds it (spec 2026-11-04, 11.2).
  const sign = async (key: string | null | undefined) =>
    key && storageConfigured() && !key.startsWith('mock://') ? await presignGet(key) : null
  const referenceViews: ReferenceView[] = await Promise.all(
    references.map(async (row) => {
      const asset = await getAsset(db, row.assetId)
      return {
        id: row.id,
        kind: row.kind === 'video' ? ('video' as const) : ('image' as const),
        title: row.title,
        sourceUrl: row.sourceUrl,
        rights: row.rights,
        purpose: row.purpose,
        negative: row.negative,
        windowStartMs: row.windowStartMs,
        windowEndMs: row.windowEndMs,
        carryOver: row.carryOver,
        avoid: row.avoid,
        readState: row.readState,
        readError: row.readError,
        reading: row.reading ?? null,
        thumbUrl: await sign(row.frames.dense[0]?.r2Key),
        denseSheetUrl: await sign(row.denseSheetKey),
        contactSheetUrl: await sign(row.contactSheetKey),
        clipUrl: row.kind === 'video' ? await sign(asset?.r2Key) : null,
        contentHash: asset?.contentHash ?? '',
        durationMs: asset?.durationMs ?? null,
        width: asset?.width ?? 1,
        height: asset?.height ?? 1,
      }
    }),
  )

  // Every checklist and cross-link in the app addresses a tab as `?tab=`;
  // until this was honoured, all of them landed on Models.
  const requested = typeof params['tab'] === 'string' ? params['tab'] : undefined
  const tab: SettingsTab = (TABS as readonly string[]).includes(requested ?? '')
    ? (requested as SettingsTab)
    : 'models'

  return (
    <div className="prose-measure mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">Settings</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          This channel&apos;s bible, routing, brand, voice and publishing. Provider keys, prices and
          the music library are shared and live in the workspace settings.
        </p>
      </header>

      <SettingsForm
        initialSettings={settings}
        youtubeConnection={youtubeConnection}
        channelId={channel.id}
        channelSlug={channel.slug}
        channel={{
          id: channel.id,
          slug: channel.slug,
          name: channel.name,
          handle: channel.handle,
          bible: channel.bible,
          archived: channel.archivedAt !== null,
        }}
        channels={allChannels
          .filter((entry) => entry.archivedAt === null)
          .map((entry) => ({ id: entry.id, name: entry.name }))}
        copySources={allChannels
          .filter((entry) => entry.id !== channel.id)
          .map((entry) => ({
            id: entry.id,
            name: entry.name,
            archived: entry.archivedAt !== null,
            version: entry.bibleVersion,
          }))}
        showNewChannel={params['new'] === '1'}
        youtubeEnvReady={hasEnvGroup('youtube')}
        youtubeOutcome={typeof params['youtube'] === 'string' ? params['youtube'] : undefined}
        initialTab={tab}
        logos={logoViews}
        channelMarkKey={settings.brandKit.look.logoR2Key}
        modelOptions={modelOptions}
        exemplars={exemplarViews()}
        techniqueOptions={MANIFEST.map((entry) => ({
          technique: entry.technique,
          description: entry.description,
        }))}
        exemplarLogo={exemplarLogoFor(logoViews, settings.brandKit.look.logoR2Key)}
        references={referenceViews}
        storageReady={storageConfigured()}
        readingEstimateUsd={readingEstimateUsd(settings, workspace.settings)}
        draftEstimateUsd={identityDraftEstimateUsd(settings, workspace.settings, references.length)}
        draft={draft}
        versions={versions.map((row) => ({
          id: row.id,
          version: row.version,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        }))}
        currentVersion={{ id: current.id, version: current.version, bible: current.bible }}
        vidiqReady={mockProvidersEnabled() || vidiqKey}
        keywordReadings={keywordReadings}
        measureCount={measureCount}
        searchSpace={searchSpace}
        searchSpaceCounts={searchSpaceCounts}
        measuredPace={pace}
      />
    </div>
  )
}
