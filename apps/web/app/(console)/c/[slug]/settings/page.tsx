import {
  getSettings,
  listCredentials,
  listLogos,
  listMusicBeds,
  maskKey,
  channelYoutubeConnection,
} from '@boom-busters/db'
import { hasEnvGroup } from '@boom-busters/schemas'
import { channelFromSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'
import { loadModelOptions } from '@/lib/model-catalogue'
import { exemplarViews } from '@/lib/exemplar-views'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { presignGet, storageConfigured } from '@/lib/storage'
import { exemplarLogoFor } from './exemplar-logo'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · Boom-Busters' }

const TABS = [
  'models',
  'brand-kit',
  'voice',
  'music',
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
  const [settings, credentials, connectionRow, beds, logos, params] = await Promise.all([
    getSettings(db),
    listCredentials(db),
    channelYoutubeConnection(db, channel.id),
    listMusicBeds(db),
    listLogos(db),
    searchParams,
  ])

  // The dropdowns' options: the cached live lists merged with the catalogue
  // and priced with the owner's overrides (decision 288). Needs the settings,
  // so it runs after the batch above.
  const youtubeConnection = connectionRow
    ? {
        masked: maskKey(connectionRow.keyHint),
        verifyStatus: connectionRow.verifyStatus,
        lastVerifiedAt: connectionRow.lastVerifiedAt,
        youtubeChannelTitle: connectionRow.youtubeChannelTitle,
      }
    : undefined

  const modelOptions = await loadModelOptions(settings)

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
          Behavioural configuration lives here, not in environment variables — changing a model, a
          budget or the brand never needs a redeploy.
        </p>
      </header>

      <SettingsForm
        initialSettings={settings}
        credentials={credentials}
        youtubeConnection={youtubeConnection}
        channelId={channel.id}
        channelSlug={channel.slug}
        mockProviders={mockProvidersEnabled()}
        youtubeEnvReady={hasEnvGroup('youtube')}
        initialTab={tab}
        musicBeds={beds.map((bed) => ({
          id: bed.id,
          title: bed.title ?? 'Untitled track',
          licence: bed.licence,
          moodTags: bed.moodTags,
          createdAt: bed.createdAt.toISOString(),
          attributionText: bed.attributionText,
          durationMs: bed.durationMs,
        }))}
        logos={logoViews}
        channelMarkKey={settings.brandKit.look.logoR2Key}
        modelOptions={modelOptions}
        exemplars={exemplarViews()}
        exemplarLogo={exemplarLogoFor(logoViews, settings.brandKit.look.logoR2Key)}
      />
    </div>
  )
}
