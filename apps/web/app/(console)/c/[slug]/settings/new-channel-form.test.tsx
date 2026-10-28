import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NewChannelForm } from './new-channel-form'

const createChannelAction = vi.fn()
vi.mock('./channel-actions', () => ({
  createChannelAction: (...args: unknown[]) => createChannelAction(...args),
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const CHANNELS = [
  { id: '01BB0000000000000000000001', name: 'Boom & Busters' },
  { id: '01BB0000000000000000000002', name: 'Psychology' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NewChannelForm', () => {
  it('prefills the address from the name until the address is edited', async () => {
    render(<NewChannelForm channels={CHANNELS} />)
    const slug = screen.getByLabelText('Address')

    await userEvent.type(screen.getByLabelText('Name'), 'Mind Games')
    expect(slug).toHaveValue('mind-games')

    await userEvent.clear(slug)
    await userEvent.type(slug, 'minds')
    await userEvent.type(screen.getByLabelText('Name'), ' Two')
    expect(slug).toHaveValue('minds')
  })

  it('creates from the house defaults and goes to the new Channel tab', async () => {
    createChannelAction.mockResolvedValue({ ok: true, slug: 'mind-games' })
    render(<NewChannelForm channels={CHANNELS} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Mind Games')
    await userEvent.type(screen.getByLabelText('Handle'), '@mind')
    await userEvent.click(screen.getByRole('button', { name: 'Create channel' }))

    expect(createChannelAction).toHaveBeenCalledWith({
      name: 'Mind Games',
      handle: '@mind',
      slug: 'mind-games',
      startFrom: 'defaults',
    })
    expect(push).toHaveBeenCalledWith('/c/mind-games/settings?tab=channel')
  })

  it('copies from the chosen channel', async () => {
    createChannelAction.mockResolvedValue({ ok: true, slug: 'copy' })
    render(<NewChannelForm channels={CHANNELS} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Copy')
    await userEvent.click(screen.getByLabelText('Copy from'))
    await userEvent.selectOptions(screen.getByLabelText('Channel to copy from'), CHANNELS[1]!.id)
    await userEvent.click(screen.getByRole('button', { name: 'Create channel' }))

    expect(createChannelAction).toHaveBeenCalledWith({
      name: 'Copy',
      handle: null,
      slug: 'copy',
      startFrom: { copyFromChannelId: CHANNELS[1]!.id },
    })
  })

  it('shows a refusal and stays on the form', async () => {
    createChannelAction.mockResolvedValue({ ok: false, error: 'That address is taken' })
    render(<NewChannelForm channels={CHANNELS} />)
    await userEvent.type(screen.getByLabelText('Name'), 'Mind Games')
    await userEvent.click(screen.getByRole('button', { name: 'Create channel' }))

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'That address is taken', variant: 'error' }),
    )
    expect(push).not.toHaveBeenCalled()
  })

  it('makes the Create action a labelled 40 px button', () => {
    render(<NewChannelForm channels={CHANNELS} />)
    const create = screen.getByRole('button', { name: 'Create channel' })
    expect(create.className).toContain('h-10')
  })
})
