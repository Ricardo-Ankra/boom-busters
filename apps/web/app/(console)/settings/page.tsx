import { getSettings, listCredentials } from '@boom-busters/db'
import { db } from '@/lib/db'
import { SettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings · Boom-Busters' }

export default async function SettingsPage() {
  const [settings, credentials] = await Promise.all([getSettings(db), listCredentials(db)])

  return (
    <div className="prose-measure mx-auto flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold">Settings</h1>
        <p className="text-[14px] text-[var(--color-text-secondary)]">
          Behavioural configuration lives here, not in environment variables — changing a model, a
          budget or the brand never needs a redeploy.
        </p>
      </header>

      <SettingsForm initialSettings={settings} credentials={credentials} />
    </div>
  )
}
