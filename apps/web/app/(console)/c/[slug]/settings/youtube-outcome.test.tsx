import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FIXTURE_CHANNEL_VIEW } from './channel-view-fixture'
import { SettingsForm } from './settings-form'

/**
 * The Connections tab says in one plain sentence how the YouTube connect flow
 * ended, from the `?youtube=` outcome.
 */

vi.mock('./actions', () => ({
  saveSettings: vi.fn(),
  verifyYoutubeConnection: vi.fn(),
  disconnectYoutubeAction: vi.fn(),
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

function renderTab(youtubeOutcome: string | undefined) {
  render(
    <SettingsForm
      channelId={FIXTURE_CHANNEL_VIEW.id}
      channelSlug="first"
      channel={{ ...FIXTURE_CHANNEL_VIEW, archived: false }}
      initialSettings={structuredClone(DEFAULT_SETTINGS)}
      modelOptions={modelOptions}
      initialTab="connections"
      youtubeEnvReady={true}
      youtubeOutcome={youtubeOutcome}
    />,
  )
}

describe('the Connections tab outcome sentence', () => {
  it('says a YouTube channel is already taken', () => {
    renderTab('channel-taken')
    expect(
      screen.getByText(
        'That YouTube channel is already connected to another channel in this console. Choose a different account.',
      ),
    ).toBeInTheDocument()
  })

  it('says the account changed', () => {
    renderTab('channel-changed')
    expect(
      screen.getByText(/different YouTube channel from the one connected here/),
    ).toBeInTheDocument()
  })

  it('shows nothing for no outcome or an unknown one', () => {
    renderTab('made-up')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
