import { render, screen } from '@testing-library/react'
import type { ProjectSummary } from '@boom-busters/db'
import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildNeedsYouCards, NeedsYouQueue } from './needs-you-queue'

/**
 * The M8 addition to the queue: a dead YouTube connection is a card, aged
 * from the moment the ping stamped it, deep-linking to Connections.
 */

describe('the Reconnect YouTube card', () => {
  const empty = {
    slug: 'psychology',
    bible: FIRST_CHANNEL_BIBLE,
    awaitingReview: [],
    budgetGates: [],
    failedRuns: [],
  }

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
      href: '/c/psychology/settings?tab=connections',
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
      '/c/psychology/settings?tab=connections',
    )
  })
})

describe('a review card and the case category', () => {
  const project = {
    id: '01J0000000000000000000000P',
    title: 'Wirecard',
    stage: 'script',
    caseCategory: 'con',
    targetRuntimeMin: 15,
    updatedAt: new Date('2026-10-09T10:00:00Z'),
  } as ProjectSummary
  const base = {
    slug: 'psychology',
    budgetGates: [],
    failedRuns: [],
    awaitingReview: [project],
  }

  it("words the category as the channel's bible does", () => {
    const [card] = buildNeedsYouCards({ ...base, bible: FIRST_CHANNEL_BIBLE })
    expect(card!.context).toContain('· Con ·')
  })

  it('shows the key itself when the bible no longer lists it, without error', () => {
    const [card] = buildNeedsYouCards({
      ...base,
      bible: { caseCategories: [{ key: 'bias', label: 'Bias' }] },
    })
    expect(card!.context).toContain('· con ·')
  })
})
