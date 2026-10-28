import { buildModelOptions, mockListedModels } from '@boom-busters/providers'
import { DEFAULT_SETTINGS, EMPTY_MODEL_PRICES, type Settings } from '@boom-busters/schemas'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
      channelId="01J00000000000000000000001"
      channelSlug="first"
      initialSettings={settings}
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

    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      modelRouting: { setSheet: { provider: 'google', model: 'gemini-3.1-flash-image' } },
    })
  })

  /**
   * Decision 297: set sheets pick a provider like stills do. On fal every
   * listed model applies, because the plate always rides as a reference and
   * the adapter hands it to that model's reference endpoint; the 4K filter is
   * Google's alone, since fal prices per image.
   */
  it('routes set sheets to fal, offering every fal model', async () => {
    const options = modelOptions()
    renderModelsTab(options)

    const provider = screen.getByRole('combobox', { name: 'Set sheets provider' })
    expect(provider).toHaveValue('google')
    await userEvent.selectOptions(provider, 'fal')

    const first = options.image.fal.find((o) => o.selectable && o.status !== 'needs-price')!
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      modelRouting: { setSheet: { provider: 'fal', model: first.id } },
    })

    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.setSheet = { provider: 'fal', model: first.id }
    cleanup()
    renderModelsTab(options, settings)
    const select = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(select).toHaveValue(first.id)
    expect(Array.from(select.querySelectorAll('option')).map((option) => option.value)).toEqual(
      options.image.fal.map((o) => o.id),
    )
    expect(screen.getByText(/each plate comes out about 1,000 pixels wide/)).toBeInTheDocument()
  })
})

it('offers a Motion graphics route (decision 289)', () => {
  renderModelsTab()
  expect(screen.getByRole('combobox', { name: 'Motion graphics model' })).toHaveValue(
    'claude-opus-5-5',
  )
})

describe('live model lists (decision 288)', () => {
  it('offers a live family model, labelled estimated, and says what it is priced as', async () => {
    renderModelsTab()
    const select = screen.getByRole('combobox', { name: 'Research (dossiers) model' })
    expect(
      screen.getAllByRole('option', { name: 'Claude Opus Mock 9 (estimated)' }).length,
    ).toBeGreaterThan(0)

    await userEvent.selectOptions(select, 'claude-opus-mock-9')
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
      modelRouting: { research: { provider: 'anthropic', model: 'claude-opus-mock-9' } },
    })
    expect(
      await screen.findByText(/Estimated at Opus 5's price: \$5 in, \$25 out per million tokens\./),
    ).toBeInTheDocument()
  })

  it('does not let a model with no price be picked, and says where to set one', () => {
    renderModelsTab()
    const unpriced = screen.getAllByRole('option', { name: 'Claude Mock Unpriced (needs a price)' })
    expect(unpriced.length).toBeGreaterThan(0)
    for (const option of unpriced) expect(option).toBeDisabled()
    expect(saveSettings).not.toHaveBeenCalled()
  })

  it('names a saved route on an unpriced model and links to the workspace prices', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-mock-unpriced' }
    renderModelsTab(modelOptions(), settings)

    expect(
      screen.getByText(/Claude Mock Unpriced needs a price before it can run\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set its price' })).toHaveAttribute(
      'href',
      '/settings?tab=prices',
    )
    // Prices are the workspace's: no price form is offered here.
    expect(screen.queryByRole('button', { name: /price/i })).not.toBeInTheDocument()
  })

  it('shows a workspace price read-only, with a link to change it', () => {
    const prices = {
      llm: { 'anthropic:claude-opus-mock-9': { inputPerMTok: 4, outputPerMTok: 20 } },
      image: {},
    }
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-opus-mock-9' }
    renderModelsTab(modelOptions(prices), settings)

    expect(
      screen.getByText(/Your price: \$4 in, \$20 out per million tokens\./),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Change prices' })).toHaveAttribute(
      'href',
      '/settings?tab=prices',
    )
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
    expect(saveSettings).toHaveBeenCalledWith('01J00000000000000000000001', {
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
})

describe('unpriced image models (decision 288)', () => {
  it('does not let an image model with no price be picked for stills', () => {
    const options = modelOptions()
    options.image.google.push({
      id: 'imagen-mock',
      label: 'Imagen Mock',
      status: 'needs-price',
      preview: false,
      selectable: true,
      price: null,
      pricedAs: null,
      reason: null,
      catalogued: false,
      fallsBackTo: null,
    })
    renderModelsTab(options)
    expect(screen.getByRole('option', { name: 'Imagen Mock (needs a price)' })).toBeDisabled()
  })
})

describe('Models tab follow-ups (decision 288)', () => {
  it('shows a saved route no list holds any more as itself, not as unlisted', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-opus-6' }
    const options = buildModelOptions({
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
      routing: settings.modelRouting,
    })
    renderModelsTab(options, settings)

    const select = screen.getByRole('combobox', { name: 'Research (dossiers) model' })
    expect(select).toHaveValue('claude-opus-6')
    expect(
      screen.getByRole('option', { name: 'claude-opus-6 (no longer offered)' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /\(unlisted\)/ })).toBeNull()
    expect(
      screen.getByText(/claude-opus-6 is no longer listed by its provider\./),
    ).toBeInTheDocument()
  })

  it('offers a model kept for one route in that row alone', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.research = { provider: 'anthropic', model: 'claude-opus-6' }
    const options = modelOptions()
    options.llm.anthropic.push({
      id: 'claude-opus-6',
      label: 'claude-opus-6',
      status: 'retired',
      preview: false,
      selectable: true,
      price: { kind: 'llm', inputPerMTok: 5, outputPerMTok: 25, cachedInputPerMTok: 0.5 },
      pricedAs: 'Claude Opus 5',
      reason: null,
      catalogued: false,
      fallsBackTo: null,
      routedOnly: true,
    })
    renderModelsTab(options, settings)

    const scripting = screen.getByRole('combobox', { name: 'Script drafting model' })
    expect(scripting).toHaveValue('claude-sonnet-5')
    expect(Array.from(scripting.querySelectorAll('option')).map((o) => o.value)).not.toContain(
      'claude-opus-6',
    )
  })

  it('gives a vanished fal route its own reason, apart from the summary of the rest', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.modelRouting.stills = { provider: 'fal', model: 'fal-ai/gone' }
    const options = modelOptions()
    const incompatible = (id: string, label: string, reason: string, routedOnly?: true) => ({
      id,
      label,
      status: 'incompatible' as const,
      preview: false,
      selectable: false,
      price: null,
      pricedAs: null,
      reason,
      catalogued: false,
      fallsBackTo: null,
      ...(routedOnly ? { routedOnly } : {}),
    })
    const cannotSend = 'Makes one image per request, or takes an input this app cannot send.'
    options.image.fal.push(
      incompatible('fal-ai/one-at-a-time', 'One at a time', cannotSend),
      incompatible('fal-ai/needs-a-mask', 'Needs a mask', cannotSend),
      incompatible(
        'fal-ai/gone',
        'fal-ai/gone',
        'fal no longer lists this endpoint, so this app cannot tell what request it takes.',
        true,
      ),
    )
    renderModelsTab(options, settings)

    expect(
      screen.getByText(
        'fal-ai/gone is not offered: fal no longer lists this endpoint, so this app cannot tell what request it takes.',
      ),
    ).toBeInTheDocument()
    // The summary counts the endpoints the list holds, not the route's own.
    expect(
      screen.getByText(
        '2 fal.ai endpoints are listed but not compatible: they make one image per request, or take an input this app cannot send.',
      ),
    ).toBeInTheDocument()
  })
})
