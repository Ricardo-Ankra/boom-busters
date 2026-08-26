import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CalendarDay } from '@/lib/calendar-view'
import { CalendarWeek } from './calendar-week'

/**
 * The global calendar's one job: say what sits where, whose it is, and where
 * to go to change it — scheduling lives on the project's Publish screen.
 */

const PROJECT = '01HQ00000000000000000000P1'

const days: CalendarDay[] = [
  {
    dayIso: '2026-08-24T00:00:00.000Z',
    items: [],
    openSlots: [],
  },
  {
    dayIso: '2026-08-28T00:00:00.000Z',
    items: [
      {
        id: 'rec-1',
        targetType: 'master',
        projectId: PROJECT,
        projectTitle: 'Wirecard: The €1.9 Billion That Never Existed',
        label: 'Wirecard: The €1.9 Billion That Never Existed',
        status: 'scheduled',
        publishAtIso: '2026-08-28T15:00:00.000Z',
        youtubeVideoId: null,
      },
    ],
    openSlots: [],
  },
  {
    dayIso: '2026-08-29T00:00:00.000Z',
    items: [],
    openSlots: [{ iso: '2026-08-29T09:00:00.000Z', kind: 'short' }],
  },
]

describe('CalendarWeek', () => {
  it('shows a slotted item with its status and a deep link to its Publish screen', () => {
    render(<CalendarWeek days={days} todayIso="2026-08-24T00:00:00.000Z" />)

    const friday = screen.getByRole('region', { name: /Friday/ })
    expect(within(friday).getByText('Scheduled')).toBeInTheDocument()
    expect(within(friday).getByText(/long-form/)).toBeInTheDocument()
    expect(within(friday).getByRole('link', { name: /Wirecard/ })).toHaveAttribute(
      'href',
      `/projects/${PROJECT}?stage=publish`,
    )
  })

  it('marks today, offers open slots, and says when a day is empty', () => {
    render(<CalendarWeek days={days} todayIso="2026-08-24T00:00:00.000Z" />)

    const monday = screen.getByRole('region', { name: /Monday/ })
    expect(within(monday).getByText('Today')).toBeInTheDocument()
    expect(within(monday).getByText('Nothing this day.')).toBeInTheDocument()

    const saturday = screen.getByRole('region', { name: /Saturday/ })
    expect(within(saturday).getByText(/Open slot/)).toBeInTheDocument()
    expect(within(saturday).getByText('short')).toBeInTheDocument()
  })
})
