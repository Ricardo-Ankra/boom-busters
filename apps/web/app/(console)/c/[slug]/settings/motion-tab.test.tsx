import { buildModelOptions, MANIFEST } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'
import { SettingsForm } from './settings-form'

/**
 * The Motion tab (spec 2026-11-04, section 11.1, plan 1): the channel's motion
 * identity, edited through the settings patch like the Brand Kit. Rendered
 * through `SettingsForm` the way `brand-look.test.tsx` does, with every other
 * tab's actions module stubbed.
 */

const saveSettings = vi.fn()

vi.mock('./actions', () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}))

vi.mock('./bible-actions', () => ({
  approveBibleSectionAction: vi.fn(),
  copyBibleFromChannelAction: vi.fn(),
  discardBibleDraftAction: vi.fn(),
  draftBibleAction: vi.fn(),
  editBibleSectionAction: vi.fn(),
  saveBibleAction: vi.fn(),
  restoreBibleVersionAction: vi.fn(),
  viewBibleVersionAction: vi.fn(),
  previewStagePromptAction: vi.fn(async () => ({ ok: true, text: '' })),
}))
vi.mock('./channel-actions', () => ({
  createChannelAction: vi.fn(),
  updateChannelAction: vi.fn(),
  archiveChannelAction: vi.fn(),
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

const TECHNIQUE_OPTIONS = MANIFEST.map((entry) => ({
  technique: entry.technique,
  description: entry.description,
}))

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
})

async function openMotionTab(): Promise<void> {
  // The house defaults: what a channel that never set its identity reads as.
  render(
    <SettingsForm
      channelId="01J00000000000000000000001"
      channelSlug="first"
      channel={FIXTURE_CHANNEL_VIEW}
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      modelOptions={modelOptions()}
      techniqueOptions={TECHNIQUE_OPTIONS}
    />,
  )
  await userEvent.click(screen.getByRole('tab', { name: 'Motion' }))
}

describe('the Motion tab (spec 2026-11-04)', () => {
  it('shows the house values for a channel that never set them', async () => {
    await openMotionTab()
    expect((screen.getByLabelText('Change cadence (ms)') as HTMLInputElement).value).toBe('1500')
    expect((screen.getByLabelText('Still limit (ms)') as HTMLInputElement).value).toBe('6000')
    expect((screen.getByLabelText('Overshoot') as HTMLSelectElement).value).toBe('hair')
    expect((screen.getByLabelText('Signature easing') as HTMLSelectElement).value).toBe('soft')
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(TECHNIQUE_OPTIONS.length)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect((screen.getByLabelText('Never') as HTMLTextAreaElement).value).toContain('glows')
  })

  it('saves one field as a motion patch', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    await user.selectOptions(screen.getByLabelText('Overshoot'), 'none')
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: { overshoot: 'none' },
    })
  })

  it('lets the still limit be typed, and saves it once on blur (final review, issue 1)', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    const still = screen.getByLabelText('Still limit (ms)')
    await user.clear(still)
    await user.type(still, '9000')
    expect(saveSettings).not.toHaveBeenCalled()
    await user.tab()
    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: { stillMaxMs: 9000 },
    })
  })

  it('saves an unticked technique as the list without it', async () => {
    const user = userEvent.setup()
    await openMotionTab()
    await user.click(screen.getByLabelText('racing-chart'))
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      motion: {
        techniques: TECHNIQUE_OPTIONS.map((option) => option.technique).filter(
          (technique) => technique !== 'racing-chart',
        ),
      },
    })
  })

  it('cannot untick a last resort', async () => {
    await openMotionTab()
    const wordStack = screen.getByLabelText('kinetic-word-stack') as HTMLInputElement
    expect(wordStack.checked).toBe(true)
    expect(wordStack.disabled).toBe(true)
    expect((screen.getByLabelText('bar-chart') as HTMLInputElement).disabled).toBe(true)
  })

  it('shows the refusal when the action refuses', async () => {
    saveSettings.mockResolvedValue({ ok: false, error: 'motion: "glows" is in both lists' })
    const user = userEvent.setup()
    await openMotionTab()
    await user.selectOptions(screen.getByLabelText('Overshoot'), 'none')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'motion: "glows" is in both lists' }),
    )
    // The optimistic value is put back.
    expect((screen.getByLabelText('Overshoot') as HTMLSelectElement).value).toBe('hair')
  })
})
