import { buildModelOptions } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsForm } from './settings-form'

/**
 * The daily upload budget on the Publishing tab (decision 302). The runner
 * reads it before every upload, and a stored value outlives any change to the
 * default, so the owner sets it here rather than waiting on a deploy. Rendered
 * through `SettingsForm` with every other tab's actions module stubbed, the
 * way `brand-look.test.tsx` does.
 */

const saveSettings = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}))

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

vi.mock('./model-actions', () => ({ refreshModelListsAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

/** A fresh list, so the Models tab never refreshes by itself during the test. */
function modelOptions() {
  const now = new Date().toISOString()
  return buildModelOptions({
    listed: [],
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
      provider,
      lastAttemptAt: now,
      lastSuccessAt: now,
      lastError: null,
    })),
    keys: { anthropic: true, openai: true, google: true, fal: true },
    prices: EMPTY_MODEL_PRICES,
    mock: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
})

describe('the daily upload budget (decision 302)', () => {
  it('shows the stored budget and saves a new one', async () => {
    const user = userEvent.setup()
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.publish.dailyUploadBudget = 4
    render(
      <SettingsForm
        channelId="01J00000000000000000000001"
        channelSlug="first"
        initialSettings={settings}
        modelOptions={modelOptions()}
      />,
    )
    await user.click(screen.getByRole('tab', { name: 'Publishing' }))

    const budget = screen.getByLabelText('Uploads per quota day')
    expect((budget as HTMLSelectElement).value).toBe('4')

    await user.selectOptions(budget, '6')

    expect(saveSettings).toHaveBeenCalledWith(
      '01J00000000000000000000001',
      expect.objectContaining({
        publish: expect.objectContaining({ dailyUploadBudget: 6 }),
      }),
    )
  })

  it('defaults to six', () => {
    expect(DEFAULT_SETTINGS.publish.dailyUploadBudget).toBe(6)
  })
})
