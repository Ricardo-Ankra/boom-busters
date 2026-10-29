import type { MaskedCredential } from '@boom-busters/db'
import { buildModelOptions } from '@boom-busters/providers'
import { DEFAULT_WORKSPACE_SETTINGS } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceForm } from './workspace-form'

/** The VidIQ card under Connections: its key, and the monthly credit cap beside it. */

const saveWorkspaceSettings = vi.fn()
vi.mock('./workspace-actions', () => ({
  saveWorkspaceSettings: (...args: unknown[]) => saveWorkspaceSettings(...args),
  saveProviderKey: vi.fn(),
  verifyProviderKey: vi.fn(),
  createMusicUploadAction: vi.fn(),
  finaliseMusicBedAction: vi.fn(),
  recordMusicBedDurationAction: vi.fn(),
  deleteMusicBedAction: vi.fn(),
}))
vi.mock('@/app/(console)/c/[slug]/settings/model-actions', () => ({
  refreshModelListsAction: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const modelOptions = () =>
  buildModelOptions({
    listed: [],
    refresh: [],
    keys: { anthropic: false, openai: false, google: false, fal: false },
    prices: DEFAULT_WORKSPACE_SETTINGS.modelPrices,
    mock: false,
  })

function renderConnections(credentials: MaskedCredential[] = []) {
  return render(
    <WorkspaceForm
      initialSettings={DEFAULT_WORKSPACE_SETTINGS}
      credentials={credentials}
      mockProviders
      modelOptions={modelOptions()}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  saveWorkspaceSettings.mockResolvedValue({ ok: true })
})

describe('the VidIQ connection', () => {
  it('has a VidIQ key card and a cap field showing the default of 1000', () => {
    renderConnections()
    expect(screen.getByLabelText('vidiq API key')).toBeInTheDocument()
    expect(screen.getByLabelText('Monthly VidIQ credit cap')).toHaveValue(1000)
    expect(
      screen.getByText('Bible research and topic research stop before crossing it.'),
    ).toBeInTheDocument()
  })

  it('saves 500 through saveWorkspaceSettings', async () => {
    renderConnections()
    const field = screen.getByLabelText('Monthly VidIQ credit cap')
    await userEvent.clear(field)
    await userEvent.type(field, '500')
    await userEvent.click(screen.getByRole('button', { name: 'Save cap' }))
    expect(saveWorkspaceSettings).toHaveBeenCalledWith({ vidiq: { monthlyCreditCap: 500 } })
  })

  it('offers no Verify button for the VidIQ key yet', () => {
    renderConnections([
      { provider: 'vidiq', masked: 'vq…0000', verifyStatus: 'unchecked', lastVerifiedAt: null },
    ])
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })
})
