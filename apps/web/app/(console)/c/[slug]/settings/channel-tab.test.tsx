import { EMPTY_BIBLE, FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelTab } from './channel-tab'

const archiveChannelAction = vi.fn()
vi.mock('./channel-actions', () => ({
  archiveChannelAction: (...args: unknown[]) => archiveChannelAction(...args),
  createChannelAction: vi.fn(),
  updateChannelAction: vi.fn(),
}))
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

const CHANNEL = {
  id: '01BB0000000000000000000002',
  slug: 'psychology',
  name: 'Psychology',
  handle: '@psych',
  archived: false,
}
const commit = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  commit.mockResolvedValue(undefined)
})

function renderTab(over: Partial<React.ComponentProps<typeof ChannelTab>> = {}) {
  return render(
    <ChannelTab
      channel={{ ...CHANNEL, bible: EMPTY_BIBLE }}
      channels={[]}
      showNew={false}
      saving={false}
      commit={commit}
      {...over}
    />,
  )
}

describe('ChannelTab', () => {
  it('counts what keeps an empty bible incomplete, and says complete for a full one', () => {
    const { unmount } = renderTab()
    expect(screen.getByText('Bible incomplete: 13 fields')).toBeInTheDocument()
    unmount()

    renderTab({ channel: { ...CHANNEL, bible: FIRST_CHANNEL_BIBLE } })
    expect(screen.getByText('Bible complete')).toBeInTheDocument()
  })

  it('gives every bible field its own labelled textarea', () => {
    renderTab()
    for (const label of [
      'Subject',
      'What a case is',
      'How a subject is named',
      'Audience',
      'Narration register',
      'Visual register',
      'Title style',
      'Call to action',
      'Script rules',
      'Direction rules',
    ]) {
      expect(screen.getByLabelText(label).tagName).toBe('TEXTAREA')
    }
  })

  it('saves the name and handle with a Save button', async () => {
    renderTab()
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mind')
    await userEvent.clear(screen.getByLabelText('Handle'))
    await userEvent.click(screen.getByRole('button', { name: 'Save name and handle' }))

    expect(commit).toHaveBeenCalledWith({ name: 'Mind', handle: '' })
  })

  it('saves an edited bible field', async () => {
    renderTab()
    await userEvent.type(screen.getByLabelText('Audience'), 'curious adults')
    await userEvent.click(screen.getByRole('button', { name: 'Save bible' }))

    expect(commit).toHaveBeenCalledWith({
      bible: { ...EMPTY_BIBLE, audience: 'curious adults' },
    })
  })

  it('adds and removes category rows with labelled buttons', async () => {
    renderTab({ channel: { ...CHANNEL, bible: FIRST_CHANNEL_BIBLE } })
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(5)

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(6)

    await userEvent.click(screen.getAllByRole('button', { name: /^Remove category/ })[0]!)
    expect(screen.getAllByRole('button', { name: /^Remove category/ })).toHaveLength(5)
  })

  it('makes every action a labelled button with a 40 px hit target', () => {
    renderTab()
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(4)
    for (const button of buttons) {
      expect(button.textContent?.trim(), 'a visible label').not.toBe('')
      expect(button.className).toContain('h-10')
    }
  })

  describe('archive', () => {
    it('stays disabled until the address is typed exactly', async () => {
      renderTab()
      const archive = screen.getByRole('button', { name: 'Archive channel' })
      expect(archive).toBeDisabled()

      await userEvent.type(screen.getByLabelText('Type psychology to confirm'), 'psycho')
      expect(archive).toBeDisabled()
      await userEvent.type(screen.getByLabelText('Type psychology to confirm'), 'logy')
      expect(archive).toBeEnabled()
    })

    it("goes to the new default channel's dashboard on success", async () => {
      archiveChannelAction.mockResolvedValue({ ok: true, slug: 'boom-busters' })
      renderTab()
      await userEvent.type(screen.getByLabelText('Type psychology to confirm'), 'psychology')
      await userEvent.click(screen.getByRole('button', { name: 'Archive channel' }))

      expect(archiveChannelAction).toHaveBeenCalledWith(CHANNEL.id, 'psychology')
      expect(push).toHaveBeenCalledWith('/c/boom-busters')
    })

    it('shows the refusal and stays put', async () => {
      archiveChannelAction.mockResolvedValue({ ok: false, error: 'A run is still running' })
      renderTab()
      await userEvent.type(screen.getByLabelText('Type psychology to confirm'), 'psychology')
      await userEvent.click(screen.getByRole('button', { name: 'Archive channel' }))

      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'A run is still running', variant: 'error' }),
      )
      expect(push).not.toHaveBeenCalled()
    })

    it('offers no archive for a channel that is already archived', () => {
      renderTab({ channel: { ...CHANNEL, archived: true, bible: EMPTY_BIBLE } })
      expect(screen.queryByRole('button', { name: 'Archive channel' })).toBeNull()
    })
  })

  it('shows the New channel form when asked for', () => {
    renderTab({ showNew: true })
    expect(screen.getByRole('button', { name: 'Create channel' })).toBeInTheDocument()
  })
})
