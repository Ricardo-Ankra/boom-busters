import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FIXTURE_CHANNEL_VIEW } from '../c/[slug]/settings/channel-view-fixture'
import { SettingsForm } from '../c/[slug]/settings/settings-form'
import { WorkspaceForm } from './workspace-form'

/**
 * The workspace settings page: provider keys, prices and the shared music
 * library, each reachable by a labelled tab, with every action mocked.
 */

const saveProviderKey = vi.fn()
const verifyProviderKey = vi.fn()
vi.mock('./workspace-actions', () => ({
  saveWorkspaceSettings: vi.fn(),
  saveProviderKey: (...args: unknown[]) => saveProviderKey(...args),
  verifyProviderKey: (...args: unknown[]) => verifyProviderKey(...args),
  createMusicUploadAction: vi.fn(),
  finaliseMusicBedAction: vi.fn(),
  recordMusicBedDurationAction: vi.fn(),
  deleteMusicBedAction: vi.fn(),
}))

vi.mock('@/app/(console)/c/[slug]/settings/model-actions', () => ({
  refreshModelListsAction: vi.fn(),
}))
vi.mock('../c/[slug]/settings/actions', () => ({ saveSettings: vi.fn() }))
vi.mock('../c/[slug]/settings/channel-actions', () => ({
  createChannelAction: vi.fn(),
  updateChannelAction: vi.fn(),
  archiveChannelAction: vi.fn(),
}))
vi.mock('../c/[slug]/settings/logo-actions', () => ({
  createLogoUploadAction: vi.fn(),
  finaliseLogoAction: vi.fn(),
  addLogoFromUrlAction: vi.fn(),
  renameLogoAction: vi.fn(),
  removeLogoAction: vi.fn(),
  setChannelMarkAction: vi.fn(),
}))
vi.mock('../c/[slug]/settings/voice-actions', () => ({
  listAuditionVoices: vi.fn(),
  cachedAuditions: vi.fn(),
  generateAuditions: vi.fn(),
  checkPronunciation: vi.fn(),
}))
vi.mock('../c/[slug]/settings/model-actions', () => ({ refreshModelListsAction: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const FRESH = new Date().toISOString()
const modelOptions = () =>
  buildModelOptions({
    listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
      provider,
      lastAttemptAt: FRESH,
      lastSuccessAt: FRESH,
      lastError: null,
    })),
    keys: { anthropic: true, openai: true, google: true, fal: true },
    prices: DEFAULT_WORKSPACE_SETTINGS.modelPrices,
    mock: false,
  })

const credential = {
  provider: 'anthropic' as const,
  masked: 'sk-ant…0000',
  verifyStatus: 'unchecked' as const,
}

function renderWorkspace(initialTab?: string) {
  return render(
    <WorkspaceForm
      initialSettings={DEFAULT_WORKSPACE_SETTINGS}
      credentials={[credential as never]}
      mockProviders
      modelOptions={modelOptions()}
      musicBeds={[
        {
          id: '01J00000000000000000000009',
          title: 'Slow strings',
          licence: 'cc0',
          moodTags: ['tense'],
          createdAt: '2026-10-01T00:00:00.000Z',
          attributionText: null,
          durationMs: 120_000,
        },
      ]}
      {...(initialTab ? { initialTab } : {})}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  saveProviderKey.mockResolvedValue({ ok: true })
  verifyProviderKey.mockResolvedValue({ ok: true, mocked: true })
})

describe('WorkspaceForm', () => {
  it('offers Connections, Prices and Music library as tabs', () => {
    renderWorkspace()
    for (const name of ['Connections', 'Prices', 'Music library']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument()
    }
  })

  it('opens on the provider keys, with no YouTube card among them', () => {
    renderWorkspace()
    expect(screen.getByLabelText('anthropic API key')).toBeInTheDocument()
    expect(screen.getByLabelText('openai API key')).toBeInTheDocument()
    expect(screen.queryByText(/Connect YouTube/i)).not.toBeInTheDocument()
  })

  it('saves a provider key from its card', async () => {
    renderWorkspace()
    await userEvent.type(screen.getByLabelText('openai API key'), 'sk-test-1')
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]!)
    expect(saveProviderKey).toHaveBeenCalledWith('openai', 'sk-test-1')
  })

  it('shows the price table on the Prices tab', async () => {
    renderWorkspace()
    await userEvent.click(screen.getByRole('tab', { name: 'Prices' }))
    expect(screen.getByText('Model prices')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh model lists' })).toBeInTheDocument()
  })

  it('shows the shared music library on the Music library tab', async () => {
    renderWorkspace()
    await userEvent.click(screen.getByRole('tab', { name: 'Music library' }))
    expect(screen.getByText('Slow strings')).toBeInTheDocument()
  })

  it('lands on the tab the page asks for', () => {
    renderWorkspace('music')
    expect(screen.getByText('Slow strings')).toBeInTheDocument()
  })
})

describe('the channel SettingsForm after the move', () => {
  it('no longer carries a price table, a music tab or provider keys', async () => {
    render(
      <SettingsForm
        channelId="01J00000000000000000000001"
        channelSlug="first"
        channel={FIXTURE_CHANNEL_VIEW}
        initialSettings={structuredClone(DEFAULT_SETTINGS)}
        modelOptions={modelOptions()}
      />,
    )
    expect(screen.queryByRole('tab', { name: 'Music library' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Prices' })).not.toBeInTheDocument()
    expect(screen.queryByText('Model prices')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Connections' }))
    expect(screen.queryByLabelText('anthropic API key')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the workspace keys' })).toHaveAttribute(
      'href',
      '/settings?tab=connections',
    )
  })
})
