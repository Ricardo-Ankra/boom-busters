import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DerivationView } from './exemplar-actions'
import { DeriveSection } from './derive-section'

const stopDerivationAction = vi.hoisted(() => vi.fn(async () => ({ ok: true })))
vi.mock('./exemplar-actions', () => ({
  deriveExemplarsAction: vi.fn(),
  latestDerivationAction: vi.fn(async () => ({ ok: true })),
  stopDerivationAction,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const derivation: DerivationView = {
  id: 'd1',
  state: 'stopped',
  propose: false,
  proposal: null,
  techniques: ['stat-counter', 'bar-chart', 'lower-third'],
  rounds: 2,
  capUsd: 5,
  spentUsd: 5.2,
  progress: [
    { technique: 'stat-counter', state: 'ready', versionId: 'v1', reason: null, costUsd: 3.1 },
    {
      technique: 'bar-chart',
      state: 'stopped-at-cap',
      versionId: 'v2',
      reason: 'The cap of $5 was reached at $5.20',
      costUsd: 2.1,
    },
    { technique: 'lower-third', state: 'wants-pass', versionId: 'v3', reason: null, costUsd: 0 },
  ],
  error: null,
  createdAt: '2026-11-04T10:00:00.000Z',
  finishedAt: '2026-11-04T10:20:00.000Z',
}

const techniques = [
  { technique: 'stat-counter' as const, description: 'one figure' },
  { technique: 'bar-chart' as const, description: 'bars' },
  { technique: 'lower-third' as const, description: 'a band' },
]

describe('DeriveSection (spec 2026-11-04, section 11.3)', () => {
  it('shows the latest derivation per technique in words with the cost and the state', () => {
    render(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={derivation}
        jobRunning={false}
        techniques={techniques}
        defaults={['lower-third']}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(screen.getByText('Stat counter')).toBeInTheDocument()
    expect(screen.getByText('ready for your review')).toBeInTheDocument()
    expect(
      screen.getByText('stopped at cap: The cap of $5 was reached at $5.20'),
    ).toBeInTheDocument()
    expect(screen.getByText('the critic wants one more pass')).toBeInTheDocument()
    expect(screen.getByText('$3.10')).toBeInTheDocument()
    expect(screen.getByText('Stopped at the cap, $5.20 of $5 spent.')).toBeInTheDocument()
    const launch = screen.getByRole('button', { name: 'Derive exemplars' })
    expect(launch).toBeEnabled()
    fireEvent.click(launch)
    expect(screen.getByRole('dialog', { name: 'Derive exemplars' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /Lower third/ })).toBeChecked()
    expect(
      screen.getByText(/Last run: stat-counter \$3\.10, bar-chart \$2\.10/),
    ).toBeInTheDocument()
  })

  it('disables the launch while a job runs or the channel is archived', () => {
    const { rerender } = render(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={{ ...derivation, state: 'running', finishedAt: null }}
        jobRunning
        techniques={techniques}
        defaults={[]}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(screen.getByRole('button', { name: 'Derive exemplars' })).toBeDisabled()
    expect(screen.getByText('Running.')).toBeInTheDocument()
    rerender(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={null}
        jobRunning={false}
        techniques={techniques}
        defaults={[]}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived
      />,
    )
    expect(screen.getByRole('button', { name: 'Derive exemplars' })).toBeDisabled()
    expect(screen.getByText('No derivation has run yet.')).toBeInTheDocument()
  })

  it('offers Stop while a derivation runs, and sends it (decision 445)', async () => {
    render(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={{ ...derivation, state: 'running', finishedAt: null }}
        jobRunning
        techniques={techniques}
        defaults={[]}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(
      screen.getByText('Stop ends the run after the call in progress. Drafts already stored stay.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop the derivation' }))
    await waitFor(() =>
      expect(stopDerivationAction).toHaveBeenCalledWith('01J00000000000000000000CH1', 'd1'),
    )
  })

  it('has no Stop once the derivation ended, and says how a stopped one ended (decision 445)', () => {
    render(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={{
          ...derivation,
          spentUsd: 1.2,
          error: 'Stopped from the Derive section',
          progress: [
            {
              technique: 'stat-counter',
              state: 'ready',
              versionId: 'v1',
              reason: null,
              costUsd: 1.2,
            },
            { technique: 'bar-chart', state: 'running', versionId: null, reason: null, costUsd: 0 },
            {
              technique: 'lower-third',
              state: 'pending',
              versionId: null,
              reason: null,
              costUsd: 0,
            },
          ],
        }}
        jobRunning={false}
        techniques={techniques}
        defaults={[]}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Stop the derivation' })).toBeNull()
    expect(
      screen.getByText('Stopped from the Derive section, $1.20 of $5 spent.'),
    ).toBeInTheDocument()
    expect(screen.getByText('stopped before it finished')).toBeInTheDocument()
    expect(screen.getByText('not run')).toBeInTheDocument()
  })

  it('says what the proposal did (spec 8.5)', () => {
    const { rerender } = render(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={{
          ...derivation,
          propose: true,
          proposal: { state: 'proposed', technique: 'ledger-wipe', reason: null },
        }}
        jobRunning={false}
        techniques={techniques}
        defaults={['lower-third']}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(screen.getByText('Proposal: Ledger wipe proposed')).toBeInTheDocument()
    rerender(
      <DeriveSection
        channelId="01J00000000000000000000CH1"
        derivation={{
          ...derivation,
          propose: true,
          proposal: { state: 'none', technique: null, reason: 'every move is covered' },
        }}
        jobRunning={false}
        techniques={techniques}
        defaults={['lower-third']}
        estimateTable={{ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }}
        storageReady
        archived={false}
      />,
    )
    expect(screen.getByText('Proposal: none, every move is covered')).toBeInTheDocument()
  })
})
