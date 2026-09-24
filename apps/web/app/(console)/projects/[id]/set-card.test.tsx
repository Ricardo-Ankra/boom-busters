import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSet } from '@boom-busters/schemas'
import { SetCard } from './set-card'

const actions = vi.hoisted(() => ({
  addSetAction: vi.fn(),
  updateSetAction: vi.fn(),
  removeSetAction: vi.fn(),
  createSetPlateUploadAction: vi.fn(),
  finaliseSetPlateAction: vi.fn(),
  addSetPlateFromUrlAction: vi.fn(),
  removeSetPlateAction: vi.fn(),
  generateSetPlateAction: vi.fn(),
  chooseSetPlateAction: vi.fn(),
}))
vi.mock('./set-actions', () => actions)

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const PROJECT = '01J0000000000000000000000A'
const TRADING_FLOOR = '01J0000000000000000000000B'
const BOARDROOM = '01J0000000000000000000000C'

const tradingFloor: ProjectSet = {
  id: TRADING_FLOOR,
  projectId: PROJECT,
  name: 'The trading floor',
  look: 'Glass walls, dual monitors, city view at dusk',
  layout: '',
  plates: [
    {
      r2Key: 'boom-busters/sets/p/bbb.jpg',
      contentHash: 'bbb',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      view: 'north',
      origin: 'uploaded',
    },
  ],
}

const boardroom: ProjectSet = {
  id: BOARDROOM,
  projectId: PROJECT,
  name: 'The boardroom',
  look: 'Long table, dark wood, skyline behind',
  layout: '',
  plates: [
    {
      r2Key: 'boom-busters/sets/p/ccc.jpg',
      contentHash: 'ccc',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      view: 'north',
      origin: 'uploaded',
    },
    {
      r2Key: 'boom-busters/sets/p/ddd.jpg',
      contentHash: 'ddd',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      view: 'detail',
      origin: 'uploaded',
    },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of Object.values(actions)) action.mockResolvedValue({ ok: true })
  actions.createSetPlateUploadAction.mockResolvedValue({
    ok: true,
    url: 'https://r2.example/put',
    key: 'k',
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 })),
  )
})

describe('SetCard', () => {
  it('renders each set with its plate count', () => {
    render(
      <SetCard
        projectId={PROJECT}
        sets={[tradingFloor, boardroom]}
        plateUrls={{}}
        plateEstimateUsd={0.08}
      />,
    )
    const list = screen.getByRole('list', { name: 'Set list' })
    expect(within(list).getByText('The trading floor')).toBeInTheDocument()
    expect(within(list).getByText(/1 plate$/)).toBeInTheDocument()
    expect(within(list).getByText('The boardroom')).toBeInTheDocument()
    expect(within(list).getByText(/2 plates/)).toBeInTheDocument()
  })

  it('opens itself when a set has no plate, and says how many', () => {
    const empty: ProjectSet = { ...boardroom, id: '01J0000000000000000000000D', plates: [] }
    render(
      <SetCard
        projectId={PROJECT}
        sets={[tradingFloor, empty]}
        plateUrls={{}}
        plateEstimateUsd={0.08}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('1 set still needs a plate.')
    expect(screen.queryByRole('list', { name: 'Set list' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'The trading floor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide sets' })).toBeInTheDocument()
  })

  it('adding a set calls the action with the typed name and look', async () => {
    render(<SetCard projectId={PROJECT} sets={[]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.type(screen.getByLabelText('Name'), 'The trading floor')
    await userEvent.type(screen.getByLabelText('Look'), 'Glass walls, dual monitors')
    await userEvent.click(screen.getByRole('button', { name: 'Add set' }))
    expect(actions.addSetAction).toHaveBeenCalledWith(PROJECT, {
      name: 'The trading floor',
      look: 'Glass walls, dual monitors',
    })
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('saving a set sends only the fields that changed', async () => {
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    // The label quotes the routed stills model's price, not a constant.
    expect(screen.getByRole('button', { name: 'Generate a view · ≈$0.08' })).toBeInTheDocument()
    const row = screen.getByRole('region', { name: 'The trading floor' })
    const look = within(row).getByLabelText('Look')
    await userEvent.clear(look)
    await userEvent.type(look, 'Rebuilt after the crash: cracked screens, empty desks')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(actions.updateSetAction).toHaveBeenCalledWith(TRADING_FLOOR, {
      look: 'Rebuilt after the crash: cracked screens, empty desks',
    })
  })

  it('saves an edited room inventory with the rest of the set', async () => {
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.type(screen.getByLabelText('Room inventory'), 'North wall: windows')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.updateSetAction).toHaveBeenCalledWith(TRADING_FLOOR, {
      layout: 'North wall: windows',
    })
  })

  it('offers AVIF at the plate picker, which converts before it uploads', async () => {
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    expect(screen.getByLabelText('Upload a plate of The trading floor')).toHaveAttribute(
      'accept',
      expect.stringContaining('image/avif'),
    )
  })

  it('removing a set asks for confirmation first', async () => {
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove set' }))
    expect(actions.removeSetAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove The trading floor' }))
    expect(actions.removeSetAction).toHaveBeenCalledWith(TRADING_FLOOR)
  })

  it('generating a plate shows the candidates and stores nothing until one is chosen', async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [
        {
          id: 'cand-1',
          provider: 'fal',
          kind: 'image',
          sourceUrl: 'https://img.example/cand-1.png',
          thumbUrl: 'https://img.example/cand-1-thumb.png',
          r2Key: 'boom-busters/generated/cand-1.png',
          width: 1024,
          height: 768,
          licence: 'generated',
        },
        {
          id: 'cand-2',
          provider: 'fal',
          kind: 'image',
          sourceUrl: 'https://img.example/cand-2.png',
          thumbUrl: 'https://img.example/cand-2-thumb.png',
          r2Key: 'boom-busters/generated/cand-2.png',
          width: 1024,
          height: 768,
          licence: 'generated',
        },
      ],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))

    expect(await screen.findByRole('listitem', { name: 'Choose plate 1' })).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: 'Choose plate 2' })).toBeInTheDocument()
    expect(actions.chooseSetPlateAction).not.toHaveBeenCalled()
  })

  it("choosing a candidate calls chooseSetPlateAction with that candidate's storage key, address and size", async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [
        {
          id: 'cand-1',
          provider: 'fal',
          kind: 'image',
          sourceUrl: 'https://img.example/cand-1.png',
          thumbUrl: 'https://img.example/cand-1-thumb.png',
          r2Key: 'boom-busters/generated/cand-1.png',
          width: 1024,
          height: 768,
          licence: 'generated',
        },
      ],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))
    await userEvent.click(await screen.findByRole('listitem', { name: 'Choose plate 1' }))

    expect(actions.chooseSetPlateAction).toHaveBeenCalledWith({
      setId: TRADING_FLOOR,
      r2Key: 'boom-busters/generated/cand-1.png',
      sourceUrl: 'https://img.example/cand-1.png',
      width: 1024,
      height: 768,
      // The set already holds a plate, so the default is the south view,
      // recorded under its own name (decision 275).
      view: 'south',
    })
  })

  it('offers no way to add a plate to a set that already holds six', async () => {
    const full: ProjectSet = {
      ...tradingFloor,
      plates: (['e', 'f', 'g', 'h', 'i', 'j'] as const).map((hash) => ({
        r2Key: `boom-busters/sets/p/${hash}.jpg`,
        contentHash: hash,
        mimeType: 'image/jpeg' as const,
        width: 1600,
        height: 1200,
        view: 'other' as const,
        origin: 'uploaded' as const,
      })),
    }
    render(<SetCard projectId={PROJECT} sets={[full]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    const row = screen.getByRole('region', { name: 'The trading floor' })
    expect(within(row).queryByRole('button', { name: 'Add plate' })).not.toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /^Generate/ })).not.toBeInTheDocument()
  })

  it('the card is collapsed when every set has a plate', () => {
    render(
      <SetCard
        projectId={PROJECT}
        sets={[tradingFloor, boardroom]}
        plateUrls={{}}
        plateEstimateUsd={0.08}
      />,
    )
    expect(screen.queryByRole('region', { name: 'The trading floor' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Set list' })).toBeInTheDocument()
  })

  /**
   * What `generateStillCandidates` returns for a live generation: bytes in
   * R2 behind an asset row, and no `thumbUrl`. The card once read `thumbUrl`
   * alone, so every live candidate rendered as an empty tile.
   */
  function liveCandidate(n: number, hash: string) {
    return {
      id: `google-${hash.slice(0, 12)}`,
      provider: 'google' as const,
      kind: 'image' as const,
      sourceUrl: `generated://google/${hash.slice(0, 12)}`,
      r2Key: `boom-busters/stills/${PROJECT}/${hash}.png`,
      assetId: `asset-${n}`,
      width: 1344,
      height: 768,
      licence: 'Generated (Gemini 2.5 Flash Image)',
      summary: `Generated from: candidate ${n}`,
    }
  }

  it('shows a live candidate through its asset, which has no thumbUrl', async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [liveCandidate(1, 'a'.repeat(64)), liveCandidate(2, 'b'.repeat(64))],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))

    const first = await screen.findByRole('listitem', { name: 'Choose plate 1' })
    expect(within(first).getByRole('img')).toHaveAttribute('src', '/api/assets/asset-1/file')
    const second = screen.getByRole('listitem', { name: 'Choose plate 2' })
    expect(within(second).getByRole('img')).toHaveAttribute('src', '/api/assets/asset-2/file')
  })

  it('Preview opens the candidates full size and can add the one on screen', async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [liveCandidate(1, 'a'.repeat(64)), liveCandidate(2, 'b'.repeat(64))],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    const dialog = screen.getByRole('dialog', {
      name: 'Preview: The trading floor candidate plates',
    })
    expect(within(dialog).getByText(/candidate 1 of 2/)).toBeInTheDocument()
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', '/api/assets/asset-1/file')
    expect(within(dialog).getByRole('button', { name: 'Previous' })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: /Next/ }))
    expect(within(dialog).getByText(/candidate 2 of 2/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add as a plate' }))

    expect(actions.chooseSetPlateAction).toHaveBeenCalledWith({
      setId: TRADING_FLOOR,
      r2Key: `boom-busters/stills/${PROJECT}/${'b'.repeat(64)}.png`,
      sourceUrl: `generated://google/${'b'.repeat(12)}`,
      width: 1344,
      height: 768,
      view: 'south',
    })
    expect(await within(dialog).findByRole('button', { name: 'Added as a plate' })).toBeDisabled()
  })

  it('keeps the other candidates after one is added, marking the added one', async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [liveCandidate(1, 'a'.repeat(64)), liveCandidate(2, 'b'.repeat(64))],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))
    await userEvent.click(await screen.findByRole('listitem', { name: 'Choose plate 1' }))

    expect(await screen.findByRole('listitem', { name: 'Plate 1 added' })).toBeDisabled()
    expect(screen.getByRole('listitem', { name: 'Choose plate 2' })).toBeEnabled()
  })

  it('recognises a candidate already held as a plate by its storage key', async () => {
    const hash = 'c'.repeat(64)
    const plated: ProjectSet = {
      ...tradingFloor,
      plates: [
        ...tradingFloor.plates,
        {
          r2Key: `boom-busters/sets/${PROJECT}/${hash}.png`,
          contentHash: hash,
          mimeType: 'image/png',
          width: 1344,
          height: 768,
          view: 'north',
          origin: 'generated',
        },
      ],
    }
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [liveCandidate(1, hash), liveCandidate(2, 'd'.repeat(64))],
    })
    render(<SetCard projectId={PROJECT} sets={[plated]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))

    expect(await screen.findByRole('listitem', { name: 'Plate 1 added' })).toBeDisabled()
    expect(screen.getByRole('listitem', { name: 'Choose plate 2' })).toBeEnabled()
  })

  it('hiding the sets keeps the candidates that were paid for', async () => {
    actions.generateSetPlateAction.mockResolvedValue({
      ok: true,
      candidates: [liveCandidate(1, 'a'.repeat(64))],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: /^Generate/ }))
    await screen.findByRole('listitem', { name: 'Choose plate 1' })

    await userEvent.click(screen.getByRole('button', { name: 'Hide sets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    expect(screen.getByRole('listitem', { name: 'Choose plate 1' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear candidates' }))
    expect(screen.queryByRole('listitem', { name: 'Choose plate 1' })).not.toBeInTheDocument()
  })

  // Decision 273, amended 275: one plate gave every still of a set one viewpoint to copy.
  describe('views', () => {
    it('generates the first plate of an empty set as the north view, the views greyed out', async () => {
      const empty: ProjectSet = { ...boardroom, id: '01J0000000000000000000000D', plates: [] }
      actions.generateSetPlateAction.mockResolvedValue({ ok: true, candidates: [] })
      render(
        <SetCard
          projectId={PROJECT}
          sets={[empty]}
          plateUrls={{}}
          plateEstimateUsd={0.08}
          viewEstimatesUsd={{ [empty.id]: 0.2 }}
        />,
      )
      // Decision 274: the views are visible from the start, with the reason
      // they are not offered yet.
      const picker = screen.getByRole('combobox', { name: /View of the next/ })
      expect(picker).toBeDisabled()
      expect(picker).toHaveAccessibleDescription('Add a plate first, then build the set from it.')
      await userEvent.click(screen.getByRole('button', { name: 'Generate a plate · ≈$0.08' }))
      expect(actions.generateSetPlateAction).toHaveBeenCalledWith(empty.id, 'north')
    })

    it('offers another view of a plated set, priced as a referenced still', async () => {
      actions.generateSetPlateAction.mockResolvedValue({ ok: true, candidates: [] })
      render(
        <SetCard
          projectId={PROJECT}
          sets={[tradingFloor]}
          plateUrls={{}}
          plateEstimateUsd={0.08}
          viewEstimatesUsd={{ [TRADING_FLOOR]: 0.12 }}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
      const picker = screen.getByRole('combobox', {
        name: 'View of the next generated plate of The trading floor',
      })
      expect(picker).toHaveValue('south')
      await userEvent.selectOptions(picker, 'detail')
      await userEvent.click(screen.getByRole('button', { name: 'Generate a view · ≈$0.12' }))
      expect(actions.generateSetPlateAction).toHaveBeenCalledWith(TRADING_FLOOR, 'detail')
    })

    it('records a chosen detail candidate as a detail plate', async () => {
      actions.generateSetPlateAction.mockResolvedValue({
        ok: true,
        candidates: [liveCandidate(1, 'a'.repeat(64))],
      })
      render(
        <SetCard
          projectId={PROJECT}
          sets={[tradingFloor]}
          plateUrls={{}}
          plateEstimateUsd={0.08}
        />,
      )
      await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: /View of the next generated plate/ }),
        'detail',
      )
      await userEvent.click(screen.getByRole('button', { name: /^Generate a view/ }))
      await userEvent.click(await screen.findByRole('listitem', { name: 'Choose plate 1' }))
      expect(actions.chooseSetPlateAction).toHaveBeenCalledWith(
        expect.objectContaining({ setId: TRADING_FLOOR, view: 'detail' }),
      )
    })
  })

  // Decision 274: the upload's view picker only ever decided which plates
  // travel, and `referencePlates` now decides that from the views themselves.
  it('asks no view for an upload or an address; the server records it', async () => {
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    expect(
      screen.queryByRole('combobox', { name: /View of the next plate/ }),
    ).not.toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Or paste an image address'), 'https://e.x/r.jpg')
    await userEvent.click(screen.getByRole('button', { name: 'Add from address' }))
    expect(actions.addSetPlateFromUrlAction).toHaveBeenCalledWith({
      setId: TRADING_FLOOR,
      url: 'https://e.x/r.jpg',
    })
  })

  it('captions a generated view with its own name', async () => {
    const angled: ProjectSet = {
      ...tradingFloor,
      plates: [
        ...tradingFloor.plates,
        { ...tradingFloor.plates[0]!, contentHash: 'rev', view: 'south', origin: 'generated' },
      ],
    }
    render(<SetCard projectId={PROJECT} sets={[angled]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    expect(
      screen.getByRole('button', { name: 'Remove south plate of The trading floor' }),
    ).toBeInTheDocument()
  })
})
