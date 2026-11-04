import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyMotion } from './copy-motion'

const copyMotionFromChannelAction = vi.fn()
vi.mock('./exemplar-actions', () => ({
  copyMotionFromChannelAction: (...args: unknown[]) => copyMotionFromChannelAction(...args),
}))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const sources = [
  { id: '01J00000000000000000000CH2', name: 'Second', archived: false },
  { id: '01J00000000000000000000CH3', name: 'Old', archived: true },
]

describe('CopyMotion (spec 2026-11-04, section 9.4)', () => {
  beforeEach(() => {
    copyMotionFromChannelAction.mockReset()
    toast.mockReset()
    refresh.mockReset()
  })

  it('copies from the chosen channel after a confirm and toasts the note', async () => {
    copyMotionFromChannelAction.mockResolvedValue({
      ok: true,
      note: 'Copied the identity, 2 references and 3 exemplars',
    })
    render(<CopyMotion channelId="01J00000000000000000000CH1" sources={sources} disabled={false} />)
    fireEvent.change(screen.getByLabelText('Copy motion from'), {
      target: { value: '01J00000000000000000000CH2' },
    })
    expect(screen.getByRole('option', { name: 'Old (archived)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy motion from this channel' }))
    expect(screen.getByText(/Replaces this channel's identity/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, copy it' }))
    await waitFor(() =>
      expect(copyMotionFromChannelAction).toHaveBeenCalledWith(
        '01J00000000000000000000CH1',
        '01J00000000000000000000CH2',
      ),
    )
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Copied the identity, 2 references and 3 exemplars' }),
    )
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses to copy into a channel with references', async () => {
    copyMotionFromChannelAction.mockResolvedValue({
      ok: false,
      error: "Archive this channel's references first",
    })
    render(<CopyMotion channelId="01J00000000000000000000CH1" sources={sources} disabled={false} />)
    fireEvent.change(screen.getByLabelText('Copy motion from'), {
      target: { value: '01J00000000000000000000CH2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Copy motion from this channel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, copy it' }))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Archive this channel's references first",
        variant: 'error',
      }),
    )
    expect(refresh).not.toHaveBeenCalled()
  })

  it('needs a channel chosen, and is off while disabled', () => {
    render(<CopyMotion channelId="01J00000000000000000000CH1" sources={sources} disabled={false} />)
    expect(screen.getByRole('button', { name: 'Copy motion from this channel' })).toBeDisabled()
    render(<CopyMotion channelId="01J00000000000000000000CH1" sources={[]} disabled />)
    expect(screen.getByText('No other channel to copy from.')).toBeInTheDocument()
  })
})
