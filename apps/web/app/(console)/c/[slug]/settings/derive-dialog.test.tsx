import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeriveDialog } from './derive-dialog'

const deriveExemplarsAction = vi.fn()
vi.mock('./exemplar-actions', () => ({
  deriveExemplarsAction: (...args: unknown[]) => deriveExemplarsAction(...args),
}))
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }))

const techniques = [
  { technique: 'stat-counter' as const, description: 'one figure' },
  { technique: 'bar-chart' as const, description: 'bars' },
  { technique: 'lower-third' as const, description: 'a band' },
]
const table = { perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1 }

function renderDialog(over: Partial<React.ComponentProps<typeof DeriveDialog>> = {}) {
  const onClose = vi.fn()
  const onLaunched = vi.fn()
  render(
    <DeriveDialog
      channelId="01J00000000000000000000CH1"
      techniques={techniques}
      defaults={['stat-counter', 'lower-third']}
      lastRun={null}
      estimateTable={table}
      storageReady
      onClose={onClose}
      onLaunched={onLaunched}
      {...over}
    />,
  )
  return { onClose, onLaunched }
}

describe('DeriveDialog (spec 2026-11-04, section 9.1)', () => {
  beforeEach(() => {
    deriveExemplarsAction.mockReset()
  })

  it('ticks the techniques with no approved version by default', () => {
    renderDialog()
    expect(screen.getByRole('checkbox', { name: /Stat counter/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Lower third/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Bar chart/ })).not.toBeChecked()
    expect(screen.getByLabelText('Rounds')).toHaveValue('2')
    expect(screen.getByText(/one round gives a correct exemplar/)).toBeInTheDocument()
  })

  it('needs a cap and says in red above $20 while still allowing it', () => {
    renderDialog()
    const start = screen.getByRole('button', { name: 'Start deriving' })
    expect(start).toBeDisabled()
    const cap = screen.getByLabelText('Cap in dollars')
    fireEvent.change(cap, { target: { value: '25' } })
    expect(screen.getByText('Above $20. It still runs.')).toBeInTheDocument()
    expect(start).toBeEnabled()
    fireEvent.change(cap, { target: { value: '5' } })
    expect(screen.queryByText('Above $20. It still runs.')).not.toBeInTheDocument()
  })

  it("shows the estimate and the last run's cost per technique", () => {
    renderDialog({ lastRun: [{ technique: 'stat-counter', costUsd: 1.234 }] })
    // Two techniques at two rounds: 2 × (1 + 2 × 0.5 + 1 × 0.1) = 4.2
    expect(screen.getByText('About $4.20 for 2 techniques at 2 rounds')).toBeInTheDocument()
    expect(screen.getByText(/Last run: stat-counter \$1\.23/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: /Lower third/ }))
    expect(screen.getByText('About $2.10 for 1 technique at 2 rounds')).toBeInTheDocument()
  })

  it('says what is missing without storage', () => {
    renderDialog({ storageReady: false })
    expect(screen.getByText(/Without R2 the critic sees no frames/)).toBeInTheDocument()
  })

  it('launches with the ticked techniques, the rounds and the cap', async () => {
    deriveExemplarsAction.mockResolvedValue({ ok: true, derivationId: 'd1' })
    const { onLaunched, onClose } = renderDialog()
    fireEvent.change(screen.getByLabelText('Rounds'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Cap in dollars'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start deriving' }))
    await waitFor(() => expect(onLaunched).toHaveBeenCalledWith('d1'))
    expect(deriveExemplarsAction).toHaveBeenCalledWith('01J00000000000000000000CH1', {
      techniques: ['stat-counter', 'lower-third'],
      rounds: 3,
      capUsd: 8,
    })
    expect(onClose).toHaveBeenCalled()
  })
})
