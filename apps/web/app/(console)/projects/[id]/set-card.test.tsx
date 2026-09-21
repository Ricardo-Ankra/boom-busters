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
  plates: [
    {
      r2Key: 'boom-busters/sets/p/bbb.jpg',
      contentHash: 'bbb',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      view: 'establishing',
      origin: 'uploaded',
    },
  ],
}

const boardroom: ProjectSet = {
  id: BOARDROOM,
  projectId: PROJECT,
  name: 'The boardroom',
  look: 'Long table, dark wood, skyline behind',
  plates: [
    {
      r2Key: 'boom-busters/sets/p/ccc.jpg',
      contentHash: 'ccc',
      mimeType: 'image/jpeg',
      width: 1600,
      height: 1200,
      view: 'establishing',
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
    expect(screen.getByRole('button', { name: 'Generate a plate · ≈$0.08' })).toBeInTheDocument()
    const row = screen.getByRole('region', { name: 'The trading floor' })
    const look = within(row).getByLabelText('Look')
    await userEvent.clear(look)
    await userEvent.type(look, 'Rebuilt after the crash: cracked screens, empty desks')
    await userEvent.click(within(row).getByRole('button', { name: 'Save' }))
    expect(actions.updateSetAction).toHaveBeenCalledWith(TRADING_FLOOR, {
      look: 'Rebuilt after the crash: cracked screens, empty desks',
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
    await userEvent.click(screen.getByRole('button', { name: /Generate a plate/ }))

    expect(await screen.findByRole('button', { name: 'Choose plate 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose plate 2' })).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: /Generate a plate/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Choose plate 1' }))

    expect(actions.chooseSetPlateAction).toHaveBeenCalledWith({
      setId: TRADING_FLOOR,
      r2Key: 'boom-busters/generated/cand-1.png',
      sourceUrl: 'https://img.example/cand-1.png',
      width: 1024,
      height: 768,
    })
  })

  it('offers no way to add a plate to a set that already holds four', async () => {
    const full: ProjectSet = {
      ...tradingFloor,
      plates: (['e', 'f', 'g', 'h'] as const).map((hash) => ({
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
    expect(within(row).queryByRole('button', { name: /Generate a plate/ })).not.toBeInTheDocument()
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
})
