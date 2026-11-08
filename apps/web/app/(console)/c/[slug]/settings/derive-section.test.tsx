import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { DerivationView } from './exemplar-actions'
import { DeriveSection } from './derive-section'

vi.mock('./exemplar-actions', () => ({
  deriveExemplarsAction: vi.fn(),
  latestDerivationAction: vi.fn(async () => ({ ok: true })),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const derivation: DerivationView = {
  id: 'd1',
  state: 'stopped',
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
})
