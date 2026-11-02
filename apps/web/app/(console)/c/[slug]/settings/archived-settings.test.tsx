import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'
import { SettingsForm } from './settings-form'

/**
 * An archived channel's settings can be read and nothing else: the notice
 * says so, and every control on every tab is disabled.
 */

vi.mock('./actions', () => ({ saveSettings: vi.fn() }))
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
  listAuditionVoices: vi.fn().mockResolvedValue([]),
  cachedAuditions: vi.fn().mockResolvedValue({}),
  generateAuditions: vi.fn(),
  checkPronunciation: vi.fn(),
}))
vi.mock('./model-actions', () => ({ refreshModelListsAction: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const FRESH = new Date().toISOString()
const modelOptions = buildModelOptions({
  listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
  refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
    provider,
    lastAttemptAt: FRESH,
    lastSuccessAt: FRESH,
    lastError: null,
  })),
  keys: { anthropic: true, openai: true, google: true, fal: true },
  prices: EMPTY_MODEL_PRICES,
  mock: false,
})

function renderForm(archived: boolean, initialTab = 'channel') {
  render(
    <SettingsForm
      channelId={FIXTURE_CHANNEL_VIEW.id}
      channelSlug="first"
      channel={{ ...FIXTURE_CHANNEL_VIEW, archived }}
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      modelOptions={modelOptions}
      initialTab={initialTab}
    />,
  )
}

describe('SettingsForm for an archived channel', () => {
  it('shows the notice and disables the Channel tab saves', () => {
    renderForm(true)

    expect(screen.getByText(/This channel is archived/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save name and handle' })).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeDisabled()
  })

  it('disables the controls of the other tabs too, but keeps the tabs themselves usable', async () => {
    renderForm(true)
    await userEvent.click(screen.getByRole('tab', { name: 'Publishing' }))

    expect(screen.getByLabelText('Uploads per quota day')).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Models' })).toBeEnabled()

    await userEvent.click(screen.getByRole('tab', { name: 'Bible' }))
    expect(screen.getByRole('button', { name: 'Edit Identity' })).toBeDisabled()
  })

  it('leaves a live channel editable and shows no notice', () => {
    renderForm(false)

    expect(screen.queryByText(/This channel is archived/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save name and handle' })).toBeEnabled()
  })

  it('opens the Bible tab from the Channel tab link every time, after a hand-made tab switch', async () => {
    renderForm(false, 'bible')
    expect(screen.getByRole('button', { name: 'Edit Identity' })).toBeVisible()

    await userEvent.click(screen.getByRole('tab', { name: 'Channel' }))
    expect(window.location.search).toContain('tab=channel')
    expect(screen.queryByRole('button', { name: 'Edit Identity' })).toBeNull()

    await userEvent.click(screen.getByRole('link', { name: 'Open the Bible tab' }))
    expect(screen.getByRole('button', { name: 'Edit Identity' })).toBeVisible()
    expect(screen.getByRole('tab', { name: 'Bible' })).toHaveAttribute('data-state', 'active')
  })
})
