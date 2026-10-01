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
      'gemini-9-flash-image',
    ])

    await userEvent.selectOptions(select, 'gemini-3.1-flash-image')

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { setSheet: { provider: 'google', model: 'gemini-3.1-flash-image' } },
    })
  })
})

describe('live model lists (decision 288)', () => {
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

  it('offers a price for a saved route already on an unpriced model, and saves only the price', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-mock-unpriced' }
    renderModelsTab(modelOptions(), settings)

    expect(
      screen.getByText('Claude Mock Unpriced needs a price before it can run.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }))
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), '7')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({
      modelPrices: {
        llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
        image: {},
      },
    })
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

describe('live image models (decision 288)', () => {
  it('offers a live Gemini image model for stills, estimated at its family', async () => {
    renderModelsTab()
    const select = screen.getByRole('combobox', { name: 'Still images model' })
    await userEvent.selectOptions(select, 'gemini-9-flash-image')
    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { stills: { provider: 'google', model: 'gemini-9-flash-image' } },
    })
    expect(
      await screen.findByText(/Estimated at Gemini 3.1 Flash Image's price: \$0.07 per image\./),
    ).toBeInTheDocument()
  })

  it('offers a live 4K-capable Gemini model for set sheets', () => {
    renderModelsTab()
    const sheet = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(Array.from(sheet.querySelectorAll('option')).map((o) => o.value)).toContain(
      'gemini-9-flash-image',
    )
  })

  it('shows a fal endpoint it cannot send as disabled, with the reason', async () => {
    const options = modelOptions()
    options.image.fal.push({
      id: 'fal-ai/one-at-a-time',
      label: 'One at a time',
      status: 'incompatible',
      preview: false,
      selectable: false,
      price: null,
      pricedAs: null,
      reason: 'Makes one image per request, or takes an input this app cannot send.',
      catalogued: false,
      fallsBackTo: null,
    })
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stills = { provider: 'fal', model: 'fal-ai/flux/dev' }
    renderModelsTab(options, settings)
    expect(screen.getByRole('option', { name: 'One at a time (not compatible)' })).toBeDisabled()
    expect(
      screen.getByText(
        'One at a time is not offered: Makes one image per request, or takes an input this app cannot send.',
      ),
    ).toBeInTheDocument()
    // One endpoint keeps its own line; the summary is for many.
    expect(screen.queryByText('Show them')).not.toBeInTheDocument()
  })

  it('sums up many fal endpoints it cannot send in one line, with the names behind Show them', () => {
    const options = modelOptions()
    for (const [id, label] of [
      ['fal-ai/one-at-a-time', 'One at a time'],
      ['fal-ai/needs-a-mask', 'Needs a mask'],
      ['fal-ai/video-only', 'Video only'],
    ] as const) {
      options.image.fal.push({
        id,
        label,
        status: 'incompatible',
        preview: false,
        selectable: false,
        price: null,
        pricedAs: null,
        reason: 'Makes one image per request, or takes an input this app cannot send.',
        catalogued: false,
        fallsBackTo: null,
      })
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stills = { provider: 'fal', model: 'fal-ai/flux/dev' }
    renderModelsTab(options, settings)
    expect(
      screen.getByText(
        '3 fal.ai endpoints are listed but not compatible: they make one image per request, or take an input this app cannot send.',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/is not offered:/)).not.toBeInTheDocument()
    const summary = screen.getByText('Show them')
    expect(summary.tagName).toBe('SUMMARY')
    const names = Array.from(summary.closest('details')!.querySelectorAll('li')).map(
      (li) => li.textContent,
    )
    expect(names).toEqual(['One at a time', 'Needs a mask', 'Video only'])
  })

  it('shows each image option with its price per image', () => {
    renderModelsTab()
    const stills = screen.getByRole('combobox', { name: 'Still images model' })
    const texts = Array.from(stills.querySelectorAll('option')).map((o) => o.textContent)
    expect(texts).toContain('Gemini 3.1 Flash Image ($0.07/image)')
    expect(texts).toContain('Gemini 9 Flash Image (mock) ($0.07/image) (estimated)')
  })

  it('requires a 4K price when pricing a set sheet model', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.setSheet = { provider: 'google', model: 'gemini-9-flash-image' }
    renderModelsTab(modelOptions(), settings)

    await userEvent.click(screen.getByRole('button', { name: 'Set price' }))
    const fourK = screen.getByLabelText('4K price per image ($)')
    await userEvent.clear(fourK)
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()

    await userEvent.type(fourK, '0.3')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))
    expect(saveSettings).toHaveBeenCalledWith({
      modelPrices: {
        llm: {},
        image: {
          'google:gemini-9-flash-image': {
            pricePerImage: 0.07,
            pricesBySize: { '1K': 0.07, '2K': 0.11, '4K': 0.3 },
          },
        },
      },
    })
  })
})

describe('pricing image models (decision 288)', () => {
  /** A live Google image model with no family and no price. */
  const unpriced = {
    id: 'imagen-mock',
    label: 'Imagen Mock',
    status: 'needs-price' as const,
    preview: false,
    selectable: true,
    price: null,
    pricedAs: null,
    reason: null,
    catalogued: false,
    fallsBackTo: null,
  }

  it('asks for a per-image price before routing stills to an unpriced model, then saves both', async () => {
    const options = modelOptions()
    options.image.google.push(unpriced)
    renderModelsTab(options)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Still images model' }),
      'imagen-mock',
    )
    expect(saveSettings).not.toHaveBeenCalled()
    expect(screen.getByText('Imagen Mock needs a price before it can run.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0.05')
    await userEvent.type(screen.getByLabelText('4K price per image ($, optional)'), '0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))

    expect(saveSettings).toHaveBeenCalledWith({
      modelRouting: { stills: { provider: 'google', model: 'imagen-mock' } },
      modelPrices: {
        llm: {},
        image: { 'google:imagen-mock': { pricePerImage: 0.05, pricesBySize: { '4K': 0.2 } } },
      },
    })
  })

  it('refuses a bad per-image price and saves nothing', async () => {
    const options = modelOptions()
    options.image.google.push(unpriced)
    renderModelsTab(options)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Still images model' }),
      'imagen-mock',
    )
    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0,05')
    await userEvent.click(screen.getByRole('button', { name: 'Save price and use' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()
  })

  it('asks only for a per-image price on a fal model', async () => {
    const options = modelOptions()
    options.image.fal.push({ ...unpriced, id: 'fal-ai/unpriced', label: 'Unpriced fal' })
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stills = { provider: 'fal', model: 'fal-ai/unpriced' }
    renderModelsTab(options, settings)

    expect(screen.getByText('Unpriced fal needs a price before it can run.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }))
    expect(screen.queryByLabelText('4K price per image ($, optional)')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0.03')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveSettings).toHaveBeenCalledTimes(1)
    expect(saveSettings).toHaveBeenCalledWith({
      modelPrices: { llm: {}, image: { 'fal:fal-ai/unpriced': { pricePerImage: 0.03 } } },
    })
  })

  it('refuses to clear the price of an image model the cast stills still need it for', async () => {
    const prices = { llm: {}, image: { 'google:imagen-mock': { pricePerImage: 0.05 } } }
    const options = modelOptions(prices)
    options.image.google.push({
      ...unpriced,
      status: 'override',
      price: { kind: 'image', pricePerImage: 0.05 },
    })
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stillsLikeness = { provider: 'google', model: 'imagen-mock' }
    settings.modelPrices = prices
    renderModelsTab(options, settings)

    expect(screen.getByText('Your price: $0.05 per image.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear price' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Stills showing the cast uses this model. Pick another model first.'),
    ).toBeInTheDocument()
  })
})
