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

function renderForm(archived: boolean) {
  render(
    <SettingsForm
      channelId={FIXTURE_CHANNEL_VIEW.id}
      channelSlug="first"
      channel={{ ...FIXTURE_CHANNEL_VIEW, archived }}
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      modelOptions={modelOptions}
      initialTab="channel"
    />,
  )
}

describe('SettingsForm for an archived channel', () => {
  it('shows the notice and disables the Channel tab saves', () => {
    renderForm(true)

    expect(screen.getByText(/This channel is archived/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save name and handle' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save bible' })).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Subject')).toBeDisabled()
  })

  it('disables the controls of the other tabs too, but keeps the tabs themselves usable', async () => {
    renderForm(true)
    await userEvent.click(screen.getByRole('tab', { name: 'Publishing' }))

    expect(screen.getByLabelText('Uploads per quota day')).toBeDisabled()
    expect(screen.getByRole('tab', { name: 'Models' })).toBeEnabled()
  })

  it('leaves a live channel editable and shows no notice', () => {
    renderForm(false)

    expect(screen.queryByText(/This channel is archived/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Save bible' })).toBeEnabled()
  })
})
