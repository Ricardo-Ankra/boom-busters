import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BibleHistory } from './bible-history'

const restoreBibleVersionAction = vi.fn()
const viewBibleVersionAction = vi.fn()
vi.mock('./bible-actions', () => ({
  restoreBibleVersionAction: (...args: unknown[]) => restoreBibleVersionAction(...args),
  viewBibleVersionAction: (...args: unknown[]) => viewBibleVersionAction(...args),
}))
const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))

const CHANNEL_ID = '01J00000000000000000000001'
const stamp = (day: number, hour: number, minute: number) =>
  new Date(2026, 9, day, hour, minute).toISOString()

// Oldest first, as the page passes them.
const VERSIONS = [
  { id: '01J00000000000000000000011', version: 1, note: 'First draft', createdAt: stamp(28, 9, 3) },
  {
    id: '01J00000000000000000000012',
    version: 2,
    note: 'Voice pass',
    createdAt: stamp(29, 10, 30),
  },
  {
    id: '01J00000000000000000000013',
    version: 3,
    note: 'Drafted with AI',
    createdAt: stamp(30, 14, 5),
  },
]

async function openHistory() {
  const user = userEvent.setup()
  render(<BibleHistory channelId={CHANNEL_ID} versions={VERSIONS} disabled={false} open />)
  return user
}

describe('BibleHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    restoreBibleVersionAction.mockResolvedValue({ ok: true })
    viewBibleVersionAction.mockResolvedValue({ ok: true, bible: FIRST_CHANNEL_BIBLE })
  })

  it('lists the versions newest first with the date and the note', async () => {
    await openHistory()
    const names = screen.getAllByText(/^Version \d$/).map((el) => el.textContent)
    expect(names).toEqual(['Version 3', 'Version 2', 'Version 1'])
    expect(screen.getByText('30 Oct 2026, 14:05')).toBeInTheDocument()
    expect(screen.getByText('Voice pass')).toBeInTheDocument()
  })

  it('restores a version after the confirm, and refreshes', async () => {
    const user = await openHistory()
    await user.click(screen.getByRole('button', { name: 'Restore version 2' }))
    await user.click(screen.getByRole('button', { name: 'Restore version 2' }))
    expect(restoreBibleVersionAction).toHaveBeenCalledWith(CHANNEL_ID, VERSIONS[1]!.id)
    expect(refresh).toHaveBeenCalled()
  })

  it('says to save or discard the draft first when one is open', async () => {
    restoreBibleVersionAction.mockResolvedValue({
      ok: false,
      error: 'Save or discard the draft first',
    })
    const user = await openHistory()
    await user.click(screen.getByRole('button', { name: 'Restore version 1' }))
    await user.click(screen.getByRole('button', { name: 'Restore version 1' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Save or discard the draft first')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('shows any other error as it came', async () => {
    restoreBibleVersionAction.mockResolvedValue({ ok: false, error: 'Unknown version' })
    const user = await openHistory()
    await user.click(screen.getByRole('button', { name: 'Restore version 3' }))
    await user.click(screen.getByRole('button', { name: 'Restore version 3' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown version')
  })

  it('opens a version read-only in a dialog', async () => {
    const user = await openHistory()
    await user.click(screen.getByRole('button', { name: 'View version 2' }))
    expect(viewBibleVersionAction).toHaveBeenCalledWith(CHANNEL_ID, VERSIONS[1]!.id)
    const dialog = await screen.findByRole('dialog', { name: 'Version 2' })
    expect(within(dialog).getByText(FIRST_CHANNEL_BIBLE.subject)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).toBeNull()
  })
})
