import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { buildNeedsYouCards, NeedsYouQueue } from './needs-you-queue'

/**
 * The M8 addition to the queue: a dead YouTube connection is a card, aged
 * from the moment the ping stamped it, deep-linking to Connections.
 */

describe('the Reconnect YouTube card', () => {
  const empty = { awaitingReview: [], budgetGates: [], failedRuns: [] }

  it('appears only when the connection is known-dead', () => {
    expect(buildNeedsYouCards(empty)).toHaveLength(0)
    expect(
      buildNeedsYouCards({ ...empty, youtubeReconnect: { needed: false, since: null } }),
    ).toHaveLength(0)

    const cards = buildNeedsYouCards({
      ...empty,
      youtubeReconnect: { needed: true, since: new Date('2026-08-27T06:00:00Z') },
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      kind: 'reconnect',
      href: '/settings?tab=connections',
      buttonLabel: 'Reconnect',
    })
  })

  it('renders with the reconnect button and the consequence spelled out', () => {
    render(
      <NeedsYouQueue
        cards={buildNeedsYouCards({
          ...empty,
          youtubeReconnect: { needed: true, since: new Date() },
        })}
      />,
    )

    expect(screen.getByText('Reconnect YouTube')).toBeInTheDocument()
    expect(screen.getByText(/Uploads, publishing and analytics stop/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Reconnect' })).toHaveAttribute(
      'href',
      '/settings?tab=connections',
    )
  })
})
