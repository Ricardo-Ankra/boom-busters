import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GateActionBar } from './project-controls'

/**
 * The gate action bar's own state, which is where a production bug lived that
 * no E2E could reach: approving needs Inngest to accept the event, and the E2E
 * suite runs without an Inngest Dev Server, so the path after a *successful*
 * approval was untestable there and untested anywhere.
 */

const approveGate = vi.fn()
const requestChanges = vi.fn()
const refresh = vi.fn()

vi.mock('../actions', () => ({
  approveGate: (...args: unknown[]) => approveGate(...args),
  requestChanges: (...args: unknown[]) => requestChanges(...args),
  restartStage: vi.fn(),
  stopProject: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  approveGate.mockResolvedValue({ ok: true })
})

function renderBar(stage = 'dossier') {
  return render(
    <GateActionBar projectId="01J0000000000000000000000A" stage={stage} context="2 claims" />,
  )
}

describe('GateActionBar', () => {
  it('stands its buttons down once an approval is handed over', async () => {
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))

    // A second approval would land on a run no longer waiting for one.
    expect(screen.getByText(/Handed to the pipeline/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('stays put when the approval was refused', async () => {
    approveGate.mockResolvedValue({ ok: false, error: 'No run is waiting at this gate.' })
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))

    // Nothing was handed anywhere, so hiding the buttons would strand the user
    // on a screen that had refused them.
    expect(screen.queryByText(/Handed to the pipeline/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('gives up waiting and puts the buttons back on its own', async () => {
    render(
      <GateActionBar
        projectId="01J0000000000000000000000A"
        stage="dossier"
        context="2 claims"
        handOffTimeoutMs={40}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/Handed to the pipeline/i)).toBeInTheDocument()

    // If the run has not moved on by the time this expires it is not coming
    // back on its own, and a note about a hand-off that evidently did not
    // happen is worse than the buttons.
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  /**
   * The regression itself.
   *
   * The flag was a boolean with no reset, so its only escape was unmounting —
   * which needed the server to be observed with no gate open. A stale run held
   * the project at `awaiting_review` straight across the dossier-to-script
   * handover, the three-second poll never caught the one-second gap between the
   * two gates, and the script gate inherited the dossier's flag. A finished
   * script arrived at its gate with no Approve and no Request changes.
   */
  it('does not carry one gate’s hand-off into the next gate', async () => {
    const view = renderBar('dossier')
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(screen.getByText(/Handed to the pipeline/i)).toBeInTheDocument()

    // The same component instance, now rendering the *script* gate — the exact
    // reconciliation the page produced in production.
    view.rerender(
      <GateActionBar projectId="01J0000000000000000000000A" stage="script" context="6 chapters" />,
    )

    expect(screen.queryByText(/Handed to the pipeline/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  /**
   * Request changes exists only where something listens. The dossier reviser
   * subscribes to `gate/dossier.changes_requested`; the script and voice
   * equivalents had no subscriber, so the button collected a note, toasted
   * success, and dropped both. On those stages the change channel is the
   * screen itself, and the bar says so instead.
   */
  it('offers Request changes on the dossier gate only', () => {
    const view = renderBar('dossier')
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument()

    view.rerender(
      <GateActionBar projectId="01J0000000000000000000000A" stage="script" context="6 chapters" />,
    )
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument()
    expect(screen.getByText(/Changes happen in the Studio/i)).toBeInTheDocument()

    view.rerender(
      <GateActionBar projectId="01J0000000000000000000000A" stage="voice" context="12 takes" />,
    )
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument()
    expect(screen.getByText(/Changes happen on the rows/i)).toBeInTheDocument()
  })

  it('refuses an empty change request without asking the server', async () => {
    requestChanges.mockResolvedValue({ ok: false, error: 'Say what needs to change.' })
    renderBar()

    await userEvent.click(screen.getByRole('button', { name: 'Request changes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Send change request' }))

    expect(requestChanges).toHaveBeenCalledWith('01J0000000000000000000000A', 'dossier', '')
  })

  it('disables Approve and says why when the gate is blocked', () => {
    render(
      <GateActionBar
        projectId="01J0000000000000000000000A"
        stage="dossier"
        context="2 claims"
        blockedReason="1 unsourced claim(s) — verify or quarantine each one"
      />,
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(screen.getByText(/verify or quarantine each one/)).toBeInTheDocument()
  })

  /**
   * Spec 11.3: placeholders can be approved past "only via explicit 'approve
   * with N placeholders' wording". The wording is the button's own label, and
   * the count it names is the count the server verifies — a board that
   * drifted after render is a refused approval, not a silent wave-through.
   */
  it('approves visuals placeholders only through the explicit wording', async () => {
    render(
      <GateActionBar
        projectId="01J0000000000000000000000A"
        stage="visuals"
        context="12 slots"
        placeholders={2}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve with 2 placeholders' }))
    expect(approveGate).toHaveBeenCalledWith('01J0000000000000000000000A', 'visuals', {
      acknowledgePlaceholders: 2,
    })
  })

  it('keeps the plain Approve on a clean visuals board', async () => {
    render(
      <GateActionBar projectId="01J0000000000000000000000A" stage="visuals" context="12 slots" />,
    )

    expect(screen.getByText(/Changes happen on the cards/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(approveGate).toHaveBeenCalledWith('01J0000000000000000000000A', 'visuals', undefined)
  })
})
