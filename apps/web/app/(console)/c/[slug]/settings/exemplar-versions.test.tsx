import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRITIC_AXES, DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ChannelExemplarVersionView } from '@/lib/exemplar-channel-views'
import { SideBySide, VersionsList } from './exemplar-versions'

const approveExemplarVersionAction = vi.fn()
const keepApprovedAction = vi.fn()
const restoreExemplarVersionAction = vi.fn()
vi.mock('./exemplar-actions', () => ({
  approveExemplarVersionAction: (...args: unknown[]) => approveExemplarVersionAction(...args),
  keepApprovedAction: (...args: unknown[]) => keepApprovedAction(...args),
  restoreExemplarVersionAction: (...args: unknown[]) => restoreExemplarVersionAction(...args),
}))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('../../../projects/[id]/graphic-playback', () => ({
  GraphicPlayback: ({ slotId }: { slotId: string }) => <div data-testid={`player-${slotId}`} />,
  GraphicPlaybackProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

const version = (over: Partial<ChannelExemplarVersionView>): ChannelExemplarVersionView => ({
  id: 'v',
  version: 1,
  status: 'draft',
  parentId: null,
  steer: null,
  concept: 'the concept',
  storyboard: ['0.0 s a'],
  mechanisms: ['drum'],
  scores: Object.fromEntries(
    CRITIC_AXES.map((axis) => [axis, { score: 8, line: `${axis} fine` }]),
  ) as ChannelExemplarVersionView['scores'],
  verdict: 'ready',
  metrics: null,
  code: {
    version: 1,
    source: 's',
    compiled: 'c',
    title: 'T',
    facts: [],
    words: [],
    durationMs: 6000,
    motion: 2,
  },
  createdAt: '2026-11-04T10:00:00.000Z',
  approvedAt: null,
  copiedFrom: null,
  refusal: null,
  ...over,
})

const approved = version({
  id: 'v1',
  status: 'approved',
  approvedAt: '2026-11-04T09:00:00.000Z',
  concept: 'the old concept',
})
const draft = version({
  id: 'v2',
  version: 2,
  parentId: 'v1',
  steer: 'slower',
  concept: 'the new concept',
})

describe('SideBySide (spec 2026-11-04, section 9.3)', () => {
  beforeEach(() => {
    approveExemplarVersionAction.mockReset()
    keepApprovedAction.mockReset()
    toast.mockReset()
    refresh.mockReset()
  })

  it("shows the two players, the concepts, the critic's lines, and the three buttons", () => {
    const onRefineAgain = vi.fn()
    render(
      <SideBySide
        channelId="01J00000000000000000000CH1"
        technique="stat-counter"
        draft={draft}
        against={approved}
        brand={DEFAULT_SETTINGS.brandKit}
        disabled={false}
        onRefineAgain={onRefineAgain}
      />,
    )
    expect(screen.getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Approved' })).toBeInTheDocument()
    expect(screen.getByTestId('player-exemplar-stat-counter-v2')).toBeInTheDocument()
    expect(screen.getByTestId('player-exemplar-stat-counter-v1')).toBeInTheDocument()
    expect(screen.getByText('the new concept')).toBeInTheDocument()
    expect(screen.getByText('the old concept')).toBeInTheDocument()
    expect(screen.getAllByText('Engagement 8: engagement fine')).toHaveLength(2)
    expect(screen.getByText('Steer: slower')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refine again' }))
    expect(onRefineAgain).toHaveBeenCalled()
  })

  it('approves this version and retires the one approved now', async () => {
    approveExemplarVersionAction.mockResolvedValue({ ok: true })
    render(
      <SideBySide
        channelId="01J00000000000000000000CH1"
        technique="stat-counter"
        draft={draft}
        against={approved}
        brand={DEFAULT_SETTINGS.brandKit}
        disabled={false}
        onRefineAgain={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Approve this' }))
    await waitFor(() =>
      expect(approveExemplarVersionAction).toHaveBeenCalledWith('01J00000000000000000000CH1', 'v2'),
    )
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Approved v2' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('keeps the approved one', async () => {
    keepApprovedAction.mockResolvedValue({ ok: true })
    render(
      <SideBySide
        channelId="01J00000000000000000000CH1"
        technique="stat-counter"
        draft={draft}
        against={approved}
        brand={DEFAULT_SETTINGS.brandKit}
        disabled={false}
        onRefineAgain={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Keep the approved one' }))
    await waitFor(() =>
      expect(keepApprovedAction).toHaveBeenCalledWith('01J00000000000000000000CH1', 'v2'),
    )
    expect(refresh).toHaveBeenCalled()
  })
})

describe('VersionsList', () => {
  beforeEach(() => {
    restoreExemplarVersionAction.mockReset()
    refresh.mockReset()
  })

  it('lists the versions with Restore on a retired one', async () => {
    restoreExemplarVersionAction.mockResolvedValue({ ok: true })
    const retired = version({ id: 'v0', version: 1, status: 'retired', steer: 'first try' })
    render(
      <VersionsList
        channelId="01J00000000000000000000CH1"
        versions={[draft, { ...approved, version: 2 }, retired]}
        disabled={false}
      />,
    )
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(within(items[0]!).getByText(/v2, draft/)).toBeInTheDocument()
    expect(within(items[2]!).getByText(/v1, retired/)).toBeInTheDocument()
    expect(within(items[2]!).getByText(/Steer: first try/)).toBeInTheDocument()
    expect(within(items[0]!).queryByRole('button', { name: 'Restore' })).toBeNull()
    fireEvent.click(within(items[2]!).getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(restoreExemplarVersionAction).toHaveBeenCalledWith('01J00000000000000000000CH1', 'v0'),
    )
    expect(refresh).toHaveBeenCalled()
  })
})
