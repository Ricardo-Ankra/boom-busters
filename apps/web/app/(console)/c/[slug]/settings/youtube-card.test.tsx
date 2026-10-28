import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { YoutubeCard, type YoutubeConnectionView } from './youtube-card'

/**
 * The YouTube connection card: OAuth, not a key paste. The chip states the
 * health, Connect is a plain link into the consent flow, Verify pings the
 * channel, and a dead consent says "reconnect" in words.
 */

const verifyYoutubeConnection = vi.fn()
vi.mock('./actions', () => ({
  verifyYoutubeConnection: (...args: unknown[]) => verifyYoutubeConnection(...args),
}))

const toast = vi.fn()
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }))

beforeEach(() => {
  vi.clearAllMocks()
  verifyYoutubeConnection.mockResolvedValue({ ok: true, channelTitle: 'Boom & Busters' })
})

function credential(status: YoutubeConnectionView['verifyStatus']): YoutubeConnectionView {
  return {
    masked: '…resh',
    youtubeChannelTitle: 'Boom & Busters',
    verifyStatus: status,
    lastVerifiedAt: status === 'ok' ? new Date('2026-08-22T10:00:00Z') : null,
  }
}

describe('YoutubeCard', () => {
  it('without the env client it explains what to set, and offers no Connect', () => {
    render(
      <YoutubeCard
        channelId="01J00000000000000000000002"
        slug="second"
        connection={undefined}
        envReady={false}
      />,
    )
    expect(screen.getByText('not connected')).toBeInTheDocument()
    expect(screen.getByText(/YOUTUBE_CLIENT_ID/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /connect/i })).not.toBeInTheDocument()
  })

  it('unconnected with env ready: Connect is the primary, a plain link', () => {
    render(
      <YoutubeCard
        channelId="01J00000000000000000000002"
        slug="second"
        connection={undefined}
        envReady={true}
      />,
    )
    const connect = screen.getByRole('link', { name: 'Connect YouTube' })
    expect(connect).toHaveAttribute(
      'href',
      '/api/youtube/connect?channel=01J00000000000000000000002',
    )
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument()
  })

  it('a healthy connection shows the chip, Reconnect and Verify', () => {
    render(
      <YoutubeCard
        channelId="01J00000000000000000000002"
        slug="second"
        connection={credential('ok')}
        envReady={true}
      />,
    )
    expect(screen.getByText('connected')).toBeInTheDocument()
    expect(screen.getByText(/last verified/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument()
  })

  it('verify pings the channel and names it in the toast', async () => {
    const user = userEvent.setup()
    render(
      <YoutubeCard
        channelId="01J00000000000000000000002"
        slug="second"
        connection={credential('ok')}
        envReady={true}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Verify' }))

    expect(verifyYoutubeConnection).toHaveBeenCalledWith('01J00000000000000000000002')
    expect(toast).toHaveBeenCalledWith({ title: 'Connected to "Boom & Busters"' })
  })

  it('a dead consent tells the human to reconnect, in words', async () => {
    verifyYoutubeConnection.mockResolvedValue({
      ok: false,
      needsReconnect: true,
      error: 'Google no longer honours the stored consent - reconnect YouTube.',
    })
    const user = userEvent.setup()
    render(
      <YoutubeCard
        channelId="01J00000000000000000000002"
        slug="second"
        connection={credential('invalid')}
        envReady={true}
      />,
    )

    expect(screen.getByText('needs attention')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Verify' }))
    expect(screen.getByText(/reconnect to grant it again/i)).toBeInTheDocument()
  })
})
