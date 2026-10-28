import { getWorkspace, listChannels, listCredentials, listMusicBeds } from '@boom-busters/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { LLM_TASKS, modelPriceKey } from '@boom-busters/schemas'
import { ConsoleShell } from '@/components/console-shell'
import { channelFromSlug, landingSlug } from '@/lib/channel-context'
import { db } from '@/lib/db'
import { redirectToLandingChannel } from '@/lib/legacy-redirect'
import type { SearchParams } from '@/lib/legacy-redirect'
import { loadModelOptions } from '@/lib/model-catalogue'
import { loadShellData } from '@/lib/shell-data'
import { WorkspaceForm } from './workspace-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Workspace settings · Boom-Busters' }

const TABS = ['connections', 'prices', 'music'] as const

/**
 * The workspace settings: provider keys, the model price table and the shared
 * music library. Everything else that used to live at `/settings?tab=...`
 * belongs to a channel now, so any other tab forwards to the landing channel's
 * settings with the query kept and an old bookmark still lands where it did.
 */
export default async function WorkspaceSettingsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const params = await searchParams
  const requested = typeof params['tab'] === 'string' ? params['tab'] : undefined
  if (requested !== undefined && !(TABS as readonly string[]).includes(requested)) {
    return redirectToLandingChannel('/settings', searchParams)
  }
  const tab = (requested ?? 'connections') as (typeof TABS)[number]

  const [workspace, credentials, beds, channels, slug] = await Promise.all([
    getWorkspace(db),
    listCredentials(db),
    listMusicBeds(db),
    listChannels(db),
    landingSlug(),
  ])

  // The prices list is about models, not about one channel's routes; it
  // needs to know which models any channel still routes to, so that clearing
  // a price never leaves a route every run refuses.
  const routedKeys = [
    ...new Set(
      channels.flatMap(({ settings }) => {
        const { modelRouting } = settings
        const routes = [
          ...LLM_TASKS.map((task) => modelRouting[task]),
          modelRouting.stills,
          modelRouting.stillsLikeness,
          modelRouting.setSheet,
        ]
        return routes.flatMap((route) =>
          route ? [modelPriceKey(route.provider, route.model)] : [],
        )
      }),
    ),
  ]

  // Google models some channel routes for set sheets: a sheet is billed at 4K,
  // so a price saved for one of them must carry a 4K price.
  const setSheetKeys = [
    ...new Set(
      channels.flatMap(({ settings }) => {
        const route = settings.modelRouting.setSheet
        return route.provider === 'google' ? [modelPriceKey(route.provider, route.model)] : []
      }),
    ),
  ]

  const modelOptions = await loadModelOptions({ prices: workspace.settings.modelPrices })
  const channel = await channelFromSlug(slug)
  const shell = await loadShellData(channel)

  return (
    <ConsoleShell {...shell}>
      <div className="prose-measure mx-auto flex max-w-4xl flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold">Workspace settings</h1>
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            Provider keys, model prices and the music library, shared by every channel. Each
            channel&apos;s own routing, brand, voice and publishing are under its Settings.
          </p>
        </header>

        <WorkspaceForm
          initialSettings={workspace.settings}
          credentials={credentials}
          mockProviders={mockProvidersEnabled()}
          initialTab={tab}
          routedKeys={routedKeys}
          setSheetKeys={setSheetKeys}
          modelOptions={modelOptions}
          musicBeds={beds.map((bed) => ({
            id: bed.id,
            title: bed.title ?? 'Untitled track',
            licence: bed.licence,
            moodTags: bed.moodTags,
            createdAt: bed.createdAt.toISOString(),
            attributionText: bed.attributionText,
            durationMs: bed.durationMs,
          }))}
        />
      </div>
    </ConsoleShell>
  )
}
