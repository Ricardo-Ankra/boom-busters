import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES, type Settings } from '@boom-busters/schemas'
import { render, screen, waitFor } from '@testing-library/react'
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

const refreshModelListsAction = vi.fn()
vi.mock('./model-actions', () => ({
  refreshModelListsAction: (...args: unknown[]) => refreshModelListsAction(...args),
}))
const routerRefresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: routerRefresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const FRESH = new Date().toISOString()

/** Every provider listed and freshly refreshed, built with no network. */
function modelOptions(prices = EMPTY_MODEL_PRICES) {
  return buildModelOptions({
    listed: (['anthropic', 'openai', 'google', 'fal'] as const).flatMap(mockListedModels),
    refresh: (['anthropic', 'openai', 'google', 'fal'] as const).map((provider) => ({
      provider,
      lastAttemptAt: FRESH,
      lastSuccessAt: FRESH,
      lastError: null,
    })),
    keys: { anthropic: true, openai: true, google: true, fal: true },
    prices,
    mock: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  saveSettings.mockResolvedValue({ ok: true })
  refreshModelListsAction.mockResolvedValue({ ok: true, results: [] })
})

function renderModelsTab(
  options = modelOptions(),
  settings: Settings = structuredClone(DEFAULT_SETTINGS),
) {
  return render(
    <SettingsForm
      initialSettings={settings}
      credentials={[]}
      mockProviders
      modelOptions={options}
    />,
  )
}

describe('routing the set sheet generator (decision 275)', () => {
  it('routes set sheets among the Google image models', async () => {
    renderModelsTab()

    const select = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(select).toHaveValue('gemini-3-pro-image')
    // Only the Gemini 3 models: 2.5 Flash has one small output size, and a
    // sheet is cut into four plates.
    expect(Array.from(select.querySelectorAll('option')).map((option) => option.value)).toEqual([
      'gemini-3.1-flash-image',
      'gemini-3-pro-image',
    ])

    await userEvent.selectOptions(select, 'gemini-3.1-flash-image')

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { setSheet: { provider: 'google', model: 'gemini-3.1-flash-image' } },
    })
  })
})

describe('live model lists (decision 287)', () => {
  it('offers a live family model, labelled estimated, and says what it is priced as', async () => {
    renderModelsTab()
    const select = screen.getByRole('combobox', { name: 'Research (dossiers) model' })
    expect(
      screen.getAllByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }).length,
    ).toBeGreaterThan(0)

    await userEvent.selectOptions(select, 'claude-opus-mock-9')
    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { research: { provider: 'anthropic', model: 'claude-opus-mock-9' } },
    })
    expect(
      await screen.findByText(/Estimated at Opus 5's price: \$5 in, \$25 out per million tokens\./),
    ).toBeInTheDocument()
  })

  it('asks for a price before routing to a model with none, then saves both together', async () => {
    renderModelsTab()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Research (dossiers) model' }),
      'claude-mock-unpriced',
    )
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Claude Mock Unpriced needs a price before it can run.'),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), '7')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { research: { provider: 'anthropic', model: 'claude-mock-unpriced' } },
      modelPrices: {
        llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
        image: {},
      },
    })
  })

  it.each(['0', '-1', 'abc', '4,5'])('refuses the price %s and saves nothing', async (typed) => {
    renderModelsTab()
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Research (dossiers) model' }),
      'claude-mock-unpriced',
    )
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), typed)
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()
  })

  it('refuses to clear the price of a model a route still needs it for', async () => {
    const prices = {
      llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
      image: {},
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-mock-unpriced' }
    settings.modelPrices = prices
    renderModelsTab(modelOptions(prices), settings)

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear price' })[0]!)
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Research (dossiers) uses this model. Pick another model first.'),
    ).toBeInTheDocument()
  })

  it('refreshes when asked, and stays busy until the action returns', async () => {
    let finish: (value: unknown) => void = () => {}
    refreshModelListsAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderModelsTab()
    const button = screen.getByRole('button', { name: 'Refresh model lists' })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    finish({ ok: true, results: [] })
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    await waitFor(() => expect(button).not.toBeDisabled())
  })

  it('refreshes by itself on a stale list, once, and never when nothing can be refreshed', async () => {
    const stale = buildModelOptions({
      listed: [],
      refresh: [],
      keys: { anthropic: true, openai: false, google: false, fal: false },
      prices: EMPTY_MODEL_PRICES,
      mock: false,
    })
    const { unmount } = renderModelsTab(stale)
    await waitFor(() => expect(refreshModelListsAction).toHaveBeenCalledTimes(1))
    unmount()

    refreshModelListsAction.mockClear()
    renderModelsTab(
      buildModelOptions({
        listed: [],
        refresh: [],
        keys: { anthropic: false, openai: false, google: false, fal: false },
        prices: EMPTY_MODEL_PRICES,
        mock: false,
      }),
    )
    expect(refreshModelListsAction).not.toHaveBeenCalled()
    expect(
      screen.getAllByText(/Add a key in Connections to load live models\./).length,
    ).toBeGreaterThan(0)
  })

  it('names a failed refresh and keeps the old list', () => {
    const failed = buildModelOptions({
      listed: mockListedModels('anthropic'),
      refresh: [
        {
          provider: 'anthropic',
          lastAttemptAt: FRESH,
          lastSuccessAt: '2026-10-01T09:15:00.000Z',
          lastError: 'key rejected',
        },
      ],
      keys: { anthropic: true, openai: true, google: true, fal: true },
      prices: EMPTY_MODEL_PRICES,
      mock: false,
    })
    renderModelsTab(failed)
    expect(
      screen.getByText(/Anthropic: refresh failed .*key rejected\. Showing the list from/),
    ).toBeInTheDocument()
    expect(
      screen.getAllByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }).length,
    ).toBeGreaterThan(0)
  })
})
