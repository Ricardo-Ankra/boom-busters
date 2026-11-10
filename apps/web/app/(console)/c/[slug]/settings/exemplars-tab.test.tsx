import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRITIC_AXES, DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ChannelExemplarVersionView, ChannelExemplarView } from '@/lib/exemplar-channel-views'
import type { ExemplarView } from '@/lib/exemplar-views'
import { ExemplarsTab } from './exemplars-tab'

const actions = vi.hoisted(() => ({
  approveExemplarVersionAction: vi.fn(),
  keepApprovedAction: vi.fn(),
  restoreExemplarVersionAction: vi.fn(),
  refineExemplarAction: vi.fn(),
  deriveExemplarsAction: vi.fn(),
}))
vi.mock('./exemplar-actions', () => actions)
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const TEMPLATE = {
  name: 'stat-counter',
  repository: 'reactvideoeditor/remotion-templates',
  url: 'https://github.com/reactvideoeditor/remotion-templates/blob/6209b72/templates/stat-counter.tsx',
  licence: 'MIT' as const,
}

const WRITTEN: ExemplarView = {
  technique: 'stat-counter',
  description: 'one large figure counting up to its mark, a label beneath, held',
  title: 'The 1.2bn raised',
  template: TEMPLATE,
  code: {
    version: 1,
    source: 'function Graphic() { return null }',
    compiled: 'function Graphic() { return null }',
    title: 'The 1.2bn raised',
    facts: [],
    words: [{ text: 'raised', atMs: 0 }],
    durationMs: 6000,
    motion: 1,
  },
}

const UNWRITTEN: ExemplarView = {
  technique: 'lower-third',
  description: 'a name and a role in a band at the bottom of the frame, sliding in and holding',
  template: { ...TEMPLATE, name: 'lower-third', url: 'https://example.test/lower-third.tsx' },
}

const BROKEN: ExemplarView = {
  technique: 'typewriter',
  description: 'a line typed out character by character with a cursor, then held',
  title: 'Delete everything',
  template: { ...TEMPLATE, name: 'Typewriter', url: 'https://example.test/typewriter.tsx' },
  issue: 'the code does not compile: Unexpected "}"',
}

const brand = DEFAULT_SETTINGS.brandKit

describe('ExemplarsTab (decision 305)', () => {
  it('says how many examples are written', () => {
    render(<ExemplarsTab exemplars={[WRITTEN, UNWRITTEN, BROKEN]} brand={brand} />)
    expect(screen.getByText('2 of 3 examples written')).toBeInTheDocument()
  })

  it('shows a written example with its title, its template and licence, and a Play button', () => {
    render(<ExemplarsTab exemplars={[WRITTEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByText(WRITTEN.description)).toBeInTheDocument()
    expect(within(card).getByText('The 1.2bn raised')).toBeInTheDocument()
    const link = within(card).getByRole('link', { name: 'stat-counter (opens in a new tab)' })
    expect(link).toHaveAttribute('href', TEMPLATE.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(within(card).getByText(/MIT licence/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Play example' })).toBeInTheDocument()
  })

  it('marks a technique with no design as not written, with nothing to play', () => {
    render(<ExemplarsTab exemplars={[UNWRITTEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Lower third' })
    expect(within(card).getByText('Not written yet')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Play example' })).not.toBeInTheDocument()
  })

  it('says why a stored design cannot play, rather than hiding it', () => {
    render(<ExemplarsTab exemplars={[BROKEN]} brand={brand} />)
    const card = screen.getByRole('region', { name: 'Typewriter' })
    expect(within(card).getByRole('status')).toHaveTextContent(/does not compile/)
    expect(within(card).queryByRole('button', { name: 'Play example' })).not.toBeInTheDocument()
  })
})

const channelVersion = (over: Partial<ChannelExemplarVersionView>): ChannelExemplarVersionView => ({
  id: 'v',
  version: 1,
  status: 'approved',
  parentId: null,
  steer: null,
  concept: 'the channel concept',
  storyboard: ['0.0 s a'],
  mechanisms: ['drum'],
  scores: Object.fromEntries(
    CRITIC_AXES.map((axis) => [axis, { score: 9, line: `${axis} good` }]),
  ) as ChannelExemplarVersionView['scores'],
  verdict: 'ready',
  metrics: null,
  code: { ...WRITTEN.code!, title: 'The channel version' },
  createdAt: '2026-11-04T10:00:00.000Z',
  approvedAt: '2026-11-04T10:00:00.000Z',
  copiedFrom: null,
  refusal: null,
  ...over,
})

const channelView = (over: Partial<ChannelExemplarView>): ChannelExemplarView => ({
  technique: 'stat-counter',
  name: null,
  description: 'one large figure rises out of the sentence',
  channelOnly: false,
  steerPhrases: [],
  fromReference: null,
  approved: null,
  pendingDraft: null,
  versions: [],
  ...over,
})

const channelProps = {
  channelId: '01J00000000000000000000CH1',
  archived: false,
  jobRunning: false,
  techniqueOptions: [{ technique: 'stat-counter' as const, description: WRITTEN.description }],
  estimateTable: { perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 },
  storageReady: true,
  lastRun: null,
  techniquesInUse: ['stat-counter'] as const,
}

describe('ExemplarsTab per channel (spec 2026-11-04, sections 9.3 and 11.4)', () => {
  beforeEach(() => {
    actions.approveExemplarVersionAction.mockReset()
    actions.refineExemplarAction.mockReset()
    actions.restoreExemplarVersionAction.mockReset()
    toast.mockReset()
    refresh.mockReset()
  })

  it('shows the house exemplar when the channel has no version', () => {
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        channel={[channelView({})]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByText('House exemplar')).toBeInTheDocument()
    expect(within(card).getByText('The 1.2bn raised')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Derive this one' })).toBeEnabled()
    expect(within(card).queryByRole('button', { name: 'Refine' })).toBeNull()
  })

  it("shows the approved version's player, scores and Refine", async () => {
    actions.refineExemplarAction.mockResolvedValue({ ok: true })
    const approved = channelVersion({ id: 'v1' })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        channel={[channelView({ approved, versions: [approved] })]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByText(/Approved v1, derived/)).toBeInTheDocument()
    expect(within(card).getByText('The channel version')).toBeInTheDocument()
    expect(within(card).getByText('the channel concept')).toBeInTheDocument()
    expect(within(card).getByText('Reviewed by the critic: ready.')).toBeInTheDocument()
    expect(
      within(card).getByText('Engagement 9 · Intent 9 · Composition 9 · Temporal 9 · Craft 9'),
    ).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Show review' }))
    expect(within(card).getByText('Engagement 9: engagement good')).toBeInTheDocument()
    expect(within(card).queryByText(/Refine builds from the approved version/)).toBeNull()
    fireEvent.change(within(card).getByLabelText(/Refine with a steer/), {
      target: { value: 'slower' },
    })
    fireEvent.click(within(card).getByRole('button', { name: 'Refine' }))
    await waitFor(() =>
      expect(actions.refineExemplarAction).toHaveBeenCalledWith(
        '01J00000000000000000000CH1',
        'v1',
        'slower',
      ),
    )
    expect(within(card).getByRole('button', { name: 'Refining' })).toBeDisabled()
  })

  it('shows the side by side with Approve this, Keep the approved one and Refine again when a draft has a parent', async () => {
    actions.approveExemplarVersionAction.mockResolvedValue({ ok: true })
    const approved = channelVersion({ id: 'v1' })
    const draft = channelVersion({
      id: 'v2',
      version: 2,
      status: 'draft',
      parentId: 'v1',
      steer: 'slower',
      approvedAt: null,
      concept: 'the refined concept',
    })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        channel={[channelView({ approved, pendingDraft: draft, versions: [draft, approved] })]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByRole('heading', { name: 'New' })).toBeInTheDocument()
    expect(within(card).getByText('the refined concept')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Keep the approved one' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Refine again' })).toBeInTheDocument()
    // A refine builds from the approved version, never from the draft shown (decision 398's ruling).
    expect(
      within(card).getByText(
        'Refine builds from the approved version. Approve this draft first to build on it.',
      ),
    ).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Approve this' }))
    await waitFor(() =>
      expect(actions.approveExemplarVersionAction).toHaveBeenCalledWith(
        '01J00000000000000000000CH1',
        'v2',
      ),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('shows a refused draft with its refusal, no Approve, and Refine ready to fix it (decision 445)', async () => {
    actions.refineExemplarAction.mockResolvedValue({ ok: true })
    const draft = channelVersion({
      id: 'v1',
      status: 'draft',
      approvedAt: null,
      scores: null,
      verdict: null,
      refusal: 'at 5.4 s in landscape, "LOSS" is set at 25 px',
    })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        channel={[channelView({ pendingDraft: draft, versions: [draft] })]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(
      within(card).getByText(
        'The layout check refused this draft: at 5.4 s in landscape, "LOSS" is set at 25 px. Refine it to fix that; it cannot be approved as it is.',
      ),
    ).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Approve this' })).toBeDisabled()
    expect(within(card).getByLabelText(/Refine with a steer/)).toHaveValue(
      'Fix what the layout check refused.',
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Refine' }))
    await waitFor(() =>
      expect(actions.refineExemplarAction).toHaveBeenCalledWith(
        '01J00000000000000000000CH1',
        'v1',
        'Fix what the layout check refused.',
      ),
    )
  })

  it('lists the versions behind Versions with Restore on a retired one', async () => {
    actions.restoreExemplarVersionAction.mockResolvedValue({ ok: true })
    const retired = channelVersion({ id: 'v1', status: 'retired', approvedAt: null })
    const approved = channelVersion({ id: 'v2', version: 2 })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        channel={[channelView({ approved, versions: [approved, retired] })]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    fireEvent.click(within(card).getByRole('button', { name: 'Versions' }))
    const items = within(card).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    fireEvent.click(within(items[1]!).getByRole('button', { name: 'Restore' }))
    await waitFor(() =>
      expect(actions.restoreExemplarVersionAction).toHaveBeenCalledWith(
        '01J00000000000000000000CH1',
        'v1',
      ),
    )
  })

  it('disables Refine and Derive while a job runs', () => {
    const approved = channelVersion({ id: 'v1' })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        jobRunning
        channel={[channelView({ approved, versions: [approved] })]}
      />,
    )
    const card = screen.getByRole('region', { name: 'Stat counter' })
    expect(within(card).getByRole('button', { name: 'Refine' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Derive this one' })).toBeDisabled()
  })

  it("shows a channel-only technique's card after the catalogue with the reference and the phrase (spec 8.5)", () => {
    const approved = channelVersion({ id: 'w1' })
    render(
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        techniquesInUse={['stat-counter', 'ledger-wipe']}
        channel={[
          channelView({}),
          channelView({
            technique: 'ledger-wipe',
            description: 'a ruled line wipes the old figure away',
            channelOnly: true,
            steerPhrases: ['ledger wipe'],
            fromReference: 'Ledger scene',
            approved,
            versions: [approved],
          }),
          channelView({
            technique: 'ink-blot',
            description: 'an ink blot spreads',
            channelOnly: true,
            steerPhrases: ['ink blot'],
            fromReference: 'Blot scene',
          }),
        ]}
      />,
    )
    const regions = screen.getAllByRole('region')
    expect(
      regions.map(
        (region) =>
          region.getAttribute('aria-labelledby') && within(region).getByRole('heading').textContent,
      ),
    ).toEqual(['Stat counter', 'Ledger wipe', 'Ink blot'])
    const card = screen.getByRole('region', { name: 'Ledger wipe' })
    expect(
      within(card).getByText(/This channel's own technique, proposed from "Ledger scene"/),
    ).toBeInTheDocument()
    expect(
      within(card).getByText(/Reach it with a steer that says: 'ledger wipe'\./),
    ).toBeInTheDocument()
    expect(within(card).queryByText('House exemplar')).toBeNull()
    expect(within(card).getByText('The channel version')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Refine' })).toBeInTheDocument()
    const blot = screen.getByRole('region', { name: 'Ink blot' })
    expect(within(blot).getByText('No version is approved yet')).toBeInTheDocument()
    expect(within(blot).getByRole('button', { name: 'Derive this one' })).toBeEnabled()
  })

  it('names a channel-only technique by its proposal, and says when its steer reaches it (deferred minors)', () => {
    const approved = channelVersion({ id: 'w1' })
    const ledger = {
      technique: 'ledger-wipe',
      name: 'The ledger wipe',
      description: 'a ruled line wipes the old figure away',
      channelOnly: true,
      steerPhrases: ['ledger wipe'],
      fromReference: 'Ledger scene',
    } as const
    const tab = (inUse: readonly string[], view: Partial<ChannelExemplarView>) => (
      <ExemplarsTab
        exemplars={[WRITTEN]}
        brand={brand}
        {...channelProps}
        techniquesInUse={inUse}
        channel={[channelView(view)]}
      />
    )
    const { rerender } = render(
      tab(['stat-counter', 'ledger-wipe'], { ...ledger, approved, versions: [approved] }),
    )
    const card = () => screen.getByRole('region', { name: 'The ledger wipe' })
    expect(
      within(card()).getByText(/Reach it with a steer that says: 'ledger wipe'\./),
    ).toBeInTheDocument()

    rerender(tab(['stat-counter'], { ...ledger, approved, versions: [approved] }))
    expect(
      within(card()).getByText(
        /Unticked on the Motion tab, so a steer that says 'ledger wipe' does not reach it\./,
      ),
    ).toBeInTheDocument()

    rerender(tab(['stat-counter'], ledger))
    expect(
      within(card()).getByText(
        /Once a version is approved, reach it with a steer that says: 'ledger wipe'\./,
      ),
    ).toBeInTheDocument()
  })
})
