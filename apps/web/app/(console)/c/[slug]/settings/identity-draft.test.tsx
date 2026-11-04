import { DEFAULT_MOTION_IDENTITY } from '@boom-busters/schemas'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IdentityDraft } from './identity-draft'

/**
 * "Draft motion identity" (spec 2026-11-04, section 8.4): a brief, one paid
 * call, the proposal shown as a diff against the current identity with its
 * why, and Apply or Discard. Nothing is applied until Apply.
 */

const CH = '01J00000000000000000000001'

const actions = vi.hoisted(() => ({ draftMotionIdentityAction: vi.fn() }))
vi.mock('./motion-actions', () => actions)
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const onApply = vi.fn(async () => {})

const PROPOSAL = {
  identity: {
    ...DEFAULT_MOTION_IDENTITY,
    overshoot: 'none' as const,
    styleGuideMd: 'Slow and dark.',
  },
  why: 'The readings never overshoot.',
}

function renderDraft() {
  return render(
    <IdentityDraft
      channelId={CH}
      current={DEFAULT_MOTION_IDENTITY}
      draftEstimateUsd={0.31}
      disabled={false}
      onApply={onApply}
    />,
  )
}

async function draft() {
  await userEvent.type(screen.getByLabelText(/What this channel should move like/), 'slow and dark')
  await userEvent.click(screen.getByRole('button', { name: 'Draft motion identity' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.draftMotionIdentityAction.mockResolvedValue({ ok: true, draft: PROPOSAL })
})

describe('IdentityDraft', () => {
  it('names the cost and shows the proposal as a diff with its why', async () => {
    renderDraft()
    expect(screen.getByText(/about \$0\.31/)).toBeInTheDocument()
    await draft()
    expect(actions.draftMotionIdentityAction).toHaveBeenCalledWith(CH, { brief: 'slow and dark' })
    expect(await screen.findByText('The readings never overshoot.')).toBeInTheDocument()
    const row = screen.getByRole('row', { name: /Overshoot/ })
    expect(row).toHaveTextContent('hair')
    expect(row).toHaveTextContent('none')
    expect(screen.getByRole('row', { name: /Style guide/ })).toHaveTextContent('Slow and dark.')
  })

  it('applies the whole proposal as one motion patch', async () => {
    renderDraft()
    await draft()
    await userEvent.click(await screen.findByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(PROPOSAL.identity))
    expect(screen.queryByText('The readings never overshoot.')).not.toBeInTheDocument()
  })

  it('discards a proposal and keeps the brief', async () => {
    renderDraft()
    await draft()
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText('The readings never overshoot.')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/What this channel should move like/)).toHaveValue('slow and dark')
  })

  it('shows a refusal and applies nothing', async () => {
    actions.draftMotionIdentityAction.mockResolvedValue({
      ok: false,
      error: 'stillMaxMs: The still limit is at least the cadence',
    })
    renderDraft()
    await draft()
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringContaining('still limit') }),
      ),
    )
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
  })

  it('says the draft keeps every field when nothing differs', async () => {
    actions.draftMotionIdentityAction.mockResolvedValue({
      ok: true,
      draft: { identity: DEFAULT_MOTION_IDENTITY, why: 'Nothing argued for a change.' },
    })
    renderDraft()
    await draft()
    expect(await screen.findByText('The draft keeps every field as it is.')).toBeInTheDocument()
  })
})
