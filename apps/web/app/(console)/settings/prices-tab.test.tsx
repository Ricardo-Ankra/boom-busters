import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_WORKSPACE_SETTINGS, EMPTY_MODEL_PRICES } from '@boom-busters/schemas'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceForm } from './workspace-form'

/**
 * The Prices tab, rendered through `WorkspaceForm` so the wiring from a price
 * form to `saveWorkspaceSettings` is what is under test, not a stub `commit`.
 */

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

const refreshModelListsAction = vi.fn()
vi.mock('@/app/(console)/c/[slug]/settings/model-actions', () => ({
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

function renderPrices(
  options = modelOptions(),
  prices = EMPTY_MODEL_PRICES,
  routedKeys: string[] = [],
) {
  return render(
    <WorkspaceForm
      initialSettings={{ ...DEFAULT_WORKSPACE_SETTINGS, modelPrices: prices }}
      credentials={[]}
      mockProviders
      modelOptions={options}
      routedKeys={routedKeys}
      initialTab="prices"
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  saveWorkspaceSettings.mockResolvedValue({ ok: true })
  refreshModelListsAction.mockResolvedValue({ ok: true, results: [] })
})

describe('pricing language models (decision 288)', () => {
  it('lists a model with no price, and saves a price for it to the workspace', async () => {
    renderPrices()
    expect(screen.getByText(/Needs a price before it can run/)).toBeInTheDocument()

    await userEvent.click(
      screen.getByRole('button', { name: 'Set price for Claude Mock Unpriced' }),
    )
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), '7')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveWorkspaceSettings).toHaveBeenCalledWith({
      modelPrices: {
        llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
        image: {},
      },
    })
  })

  it.each(['0', '-1', 'abc', '4,5'])('refuses the price %s and saves nothing', async (typed) => {
    renderPrices()
    await userEvent.click(
      screen.getByRole('button', { name: 'Set price for Claude Mock Unpriced' }),
    )
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), typed)
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))
    expect(saveWorkspaceSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()
  })

  it('names the price form and announces a refused price on the fields it covers', async () => {
    renderPrices()
    await userEvent.click(
      screen.getByRole('button', { name: 'Set price for Claude Mock Unpriced' }),
    )
    expect(
      screen.getByRole('form', { name: 'Your price for Claude Mock Unpriced.' }),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), 'abc')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a price above zero, using a full stop for decimals.')
    const input = screen.getByLabelText('Input, $ per million tokens')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', alert.id)
  })

  it('sets a price on an estimated model from its estimate', async () => {
    renderPrices()
    expect(screen.getAllByText(/Estimated: \$5 in, \$25 out/).length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Set price for Claude Opus Mock 9' }))
    const input = screen.getByLabelText('Input, $ per million tokens')
    // Prefilled with the family's price, Opus 5's.
    expect(input).toHaveValue('5')
    expect(screen.getByLabelText('Output, $ per million tokens')).toHaveValue('25')
    await userEvent.clear(input)
    await userEvent.type(input, '4')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveWorkspaceSettings).toHaveBeenCalledWith({
      modelPrices: {
        llm: {
          'anthropic:claude-opus-mock-9': {
            inputPerMTok: 4,
            outputPerMTok: 25,
            cachedInputPerMTok: 0.5,
          },
        },
        image: {},
      },
    })
  })

  it('clears the owner’s price on a model its family can still price', async () => {
    const prices = {
      llm: { 'anthropic:claude-opus-mock-9': { inputPerMTok: 4, outputPerMTok: 20 } },
      image: {},
    }
    renderPrices(modelOptions(prices), prices)

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear price for Claude Opus Mock 9' }),
    )
    expect(saveWorkspaceSettings).toHaveBeenCalledWith({
      modelPrices: { llm: {}, image: {} },
    })
  })

  it('refuses to clear the price of a model a channel still routes to', async () => {
    const prices = {
      llm: { 'anthropic:claude-mock-unpriced': { inputPerMTok: 7, outputPerMTok: 30 } },
      image: {},
    }
    renderPrices(modelOptions(prices), prices, ['anthropic:claude-mock-unpriced'])

    await userEvent.click(
      screen.getByRole('button', { name: 'Clear price for Claude Mock Unpriced' }),
    )
    expect(saveWorkspaceSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('A channel routes to this model. Pick another model on that channel first.'),
    ).toBeInTheDocument()
  })

  it('puts the price back on screen when the save is refused', async () => {
    saveWorkspaceSettings.mockResolvedValue({ ok: false, error: 'nope' })
    renderPrices()
    await userEvent.click(
      screen.getByRole('button', { name: 'Set price for Claude Mock Unpriced' }),
    )
    await userEvent.type(screen.getByLabelText('Input, $ per million tokens'), '7')
    await userEvent.type(screen.getByLabelText('Output, $ per million tokens'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Could not save', description: 'nope' }),
      ),
    )
    expect(screen.getByText(/Needs a price before it can run/)).toBeInTheDocument()
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

  it('asks for a per-image price with an optional 4K price on a Google model', async () => {
    const options = modelOptions()
    options.image.google.push(unpriced)
    renderPrices(options)

    await userEvent.click(screen.getByRole('button', { name: 'Set price for Imagen Mock' }))
    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0.05')
    await userEvent.type(screen.getByLabelText('4K price per image ($, optional)'), '0.2')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveWorkspaceSettings).toHaveBeenCalledWith({
      modelPrices: {
        llm: {},
        image: { 'google:imagen-mock': { pricePerImage: 0.05, pricesBySize: { '4K': 0.2 } } },
      },
    })
  })

  it('refuses a bad per-image price and saves nothing', async () => {
    const options = modelOptions()
    options.image.google.push(unpriced)
    renderPrices(options)

    await userEvent.click(screen.getByRole('button', { name: 'Set price for Imagen Mock' }))
    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0,05')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))
    expect(saveWorkspaceSettings).not.toHaveBeenCalled()
    expect(
      screen.getByText('Enter a price above zero, using a full stop for decimals.'),
    ).toBeInTheDocument()
  })

  it('asks only for a per-image price on a fal model', async () => {
    const options = modelOptions()
    options.image.fal.push({ ...unpriced, id: 'fal-ai/unpriced', label: 'Unpriced fal' })
    renderPrices(options)

    await userEvent.click(screen.getByRole('button', { name: 'Set price for Unpriced fal' }))
    expect(screen.queryByLabelText('4K price per image ($, optional)')).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Price per image ($)'), '0.03')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))

    expect(saveWorkspaceSettings).toHaveBeenCalledTimes(1)
    expect(saveWorkspaceSettings).toHaveBeenCalledWith({
      modelPrices: { llm: {}, image: { 'fal:fal-ai/unpriced': { pricePerImage: 0.03 } } },
    })
  })

  it('refuses to clear the price of an image model a channel routes to', async () => {
    const prices = { llm: {}, image: { 'google:imagen-mock': { pricePerImage: 0.05 } } }
    const options = modelOptions(prices)
    options.image.google.push({
      ...unpriced,
      status: 'override',
      price: { kind: 'image', pricePerImage: 0.05 },
    })
    renderPrices(options, prices, ['google:imagen-mock'])

    expect(screen.getByText(/Your price: \$0.05 per image/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear price for Imagen Mock' }))
    expect(saveWorkspaceSettings).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('A channel routes to this model.')
  })
})

describe('the model lists', () => {
  it('refreshes when asked, and stays busy until the action returns', async () => {
    let finish: (value: unknown) => void = () => {}
    refreshModelListsAction.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPrices()
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
    const { unmount } = renderPrices(stale)
    await waitFor(() => expect(refreshModelListsAction).toHaveBeenCalledTimes(1))
    unmount()

    refreshModelListsAction.mockClear()
    renderPrices(
      buildModelOptions({
        listed: [],
        refresh: [],
        keys: { anthropic: false, openai: false, google: false, fal: false },
        prices: EMPTY_MODEL_PRICES,
        mock: false,
      }),
    )
    expect(refreshModelListsAction).not.toHaveBeenCalled()
  })

  it('says so when every listed model is priced', () => {
    renderPrices(
      buildModelOptions({
        listed: [],
        refresh: [],
        keys: { anthropic: false, openai: false, google: false, fal: false },
        prices: EMPTY_MODEL_PRICES,
        mock: false,
      }),
    )
    expect(screen.getByText(/Nothing needs a price/)).toBeInTheDocument()
  })
})
