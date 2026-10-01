import { buildModelOptions } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsForm } from './settings-form'

/**
 * The Photographic look card on the Brand Kit tab (decision 287): image
 * prompts carry no grade or grain, so Grade and Grain are set here, once, for
 * the compositor. Rendered through `SettingsForm` the way `models-tab.test.tsx`
 * and `voice-tab.test.tsx` do, with every other tab's actions module stubbed
 * so the suite does not fail on an unrelated `'use server'` import.
 */

const saveSettings = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
  saveProviderKey: vi.fn(),
  verifyProviderKey: vi.fn(),
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

// The Models tab is the default tab, so it mounts first (decision 288): its
// refresh action and the router it refreshes need stubbing too.
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

async function openBrandKitTab(): Promise<void> {
  render(
    <SettingsForm
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      credentials={[]}
      mockProviders
      modelOptions={modelOptions()}
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Brand Kit' }))
}

describe('the Photographic look card (decision 287)', () => {
  it('offers grain and grade on the Brand Kit tab, and saves a choice', async () => {
    const user = userEvent.setup()
    await openBrandKitTab()

    const grade = screen.getByLabelText('Grade')
    expect((grade as HTMLSelectElement).value).toBe('muted')

    await user.selectOptions(grade, 'strong')

    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        brandKit: expect.objectContaining({
          look: expect.objectContaining({ gradePreset: 'strong' }),
        }),
      }),
    )
    expect(screen.getByLabelText('Grain')).toBeInTheDocument()
  })
})
