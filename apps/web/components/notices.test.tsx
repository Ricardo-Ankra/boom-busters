import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Notice } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
const dismissNoticeAction = vi.fn()
vi.mock('@/app/(console)/notice-actions', () => ({ dismissNoticeAction }))

const { Notices } = await import('./notices')

const notice = (id: string, message: string): Notice => ({
  id,
  projectId: '01J0000000000000000000000P',
  subject: 'direction',
  subjectId: null,
  kind: 'trimmed',
  message,
  createdAt: new Date('2026-10-09T10:00:00Z'),
})

describe('Notices (decision 293)', () => {
  beforeEach(() => {
    refresh.mockReset()
    dismissNoticeAction.mockReset()
  })

  it('renders nothing without notices', () => {
    const { container } = render(<Notices notices={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows each notice with its own Dismiss button', () => {
    render(
      <Notices
        notices={[
          notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.'),
          notice('01J0000000000000000000000B', 'The redraft stopped: cut off.'),
        ]}
      />,
    )
    expect(screen.getAllByRole('status').map((line) => line.textContent)).toEqual([
      expect.stringContaining('Trimmed to fit: era rule 1.'),
      expect.stringContaining('The redraft stopped: cut off.'),
    ])
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(2)
  })

  it('dismisses a notice and refreshes the page', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <Notices notices={[notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.')]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(dismissNoticeAction).toHaveBeenCalledWith('01J0000000000000000000000A')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('says so when a dismiss fails, and keeps the notice', async () => {
    dismissNoticeAction.mockResolvedValue({ ok: false, error: 'Unknown id' })
    const user = userEvent.setup()
    render(
      <Notices notices={[notice('01J0000000000000000000000A', 'Trimmed to fit: era rule 1.')]} />,
    )
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not dismiss: Unknown id')
    expect(refresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled()
  })
})
