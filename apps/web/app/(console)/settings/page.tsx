import { getSettings, listCredentials, listMusicBeds } from '@boom-busters/db'
import { db } from '@/lib/db'
import { mockProvidersEnabled } from '@boom-busters/providers'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · Boom-Busters' }

const TABS = ['models', 'brand-kit', 'voice', 'music', 'publishing', 'connections'] as const
type SettingsTab = (typeof TABS)[number]

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [settings, credentials, beds, params] = await Promise.all([
    getSettings(db),
    listCredentials(db),
    listMusicBeds(db),
    searchParams,
  ])

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
        mockProviders={mockProvidersEnabled()}
        initialTab={tab}
        musicBeds={beds.map((bed) => ({
          id: bed.id,
          title: bed.title ?? 'Untitled track',
          licence: bed.licence,
          moodTags: bed.moodTags,
          createdAt: bed.createdAt.toISOString(),
        }))}
      />
    </div>
  )
}
