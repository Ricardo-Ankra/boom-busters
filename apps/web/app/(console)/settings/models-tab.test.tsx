import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsForm } from './settings-form'

/**
 * The Models tab, rendered through `SettingsForm` the way `voice-tab.test.tsx`
 * renders the Voice tab — the model routing lives in `SettingsForm`'s own
 * state, so a panel tested in isolation with a stub `commit` would not catch
 * a wiring bug the way this does. Models is the default tab, so no tab click
 * is needed to reach it.
 */

const saveSettings = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
  saveProviderKey: vi.fn(),
  verifyProviderKey: vi.fn(),
}))

// `SettingsForm` statically imports every tab, including Voice and Logos —
// unmounted panels never call these, but the modules still load, and their
// `'use server'` chains reach `next-auth` and R2 in ways this suite has no
// use for. Stubbed the same way `voice-tab.test.tsx` stubs them.
vi.mock('./logo-actions', () => ({
  createLogoUploadAction: vi.fn(),
  finaliseLogoAction: vi.fn(),
  addLogoFromUrlAction: vi.fn(),
  renameLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  setChannelMarkAction: vi.fn(),
}))

vi.mock('./voice-actions', () => ({
  listAuditionVoices: vi.fn(),
  cachedAuditions: vi.fn(),
  generateAuditions: vi.fn(),
  checkPronunciation: vi.fn(),
}))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
})

function renderModelsTab(): void {
  render(
    <SettingsForm
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      credentials={[]}
      mockProviders
    />,
  )
}

describe('routing the set sheet generator (decision 275)', () => {
  it('routes set sheets among the Google image models', async () => {
    renderModelsTab()

    const select = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(select).toHaveValue('gemini-3-pro-image')

    await userEvent.selectOptions(select, 'gemini-3.1-flash-image')

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { setSheet: { provider: 'google', model: 'gemini-3.1-flash-image' } },
    })
  })
})
