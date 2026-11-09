import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TrackRecordPanel } from './track-record-panel'
import type { TrackRecordData } from './track-record-data'

const actions = vi.hoisted(() => ({
  applySuggestionAction: vi.fn(),
  dismissSuggestionAction: vi.fn(),
  resetTuningAction: vi.fn(),
}))
vi.mock('./tuning-actions', () => actions)

const CHANNEL = '01J0000000000000000000000A'

function data(overrides: Partial<TrackRecordData> = {}): TrackRecordData {
  return {
    counted: 6,
    checks: [
      {
        check: 'demand',
        right: 4,
        counted: 6,
        videos: [
          { projectId: 'p1', title: 'Wirecard collapse', right: true },
          { projectId: 'p2', title: 'WeWork rise', right: false },
        ],
      },
      { check: 'fit', right: 3, counted: 5, videos: [] },
    ],
    suggestions: [
      {
        key: 'demandWarn',
        direction: 'lower',
        from: 1000,
        to: 500,
        support: ['p1', 'p2', 'p3'],
        sentence: 'Demand warned on 3 videos. Lower the warning line to 500?',
      },
    ],
    applied: [
      {
        key: 'openDoorMaxSubscribers',
        value: 200000,
        previous: 100000,
        appliedAt: '2026-11-01T10:00:00.000Z',
        evidence: 'Competition warned on 3 videos.',
      },
    ],
    intents: [{ label: 'how it collapsed', good: 2, total: 3 }],
    ...overrides,
  }
}

function setup(d: TrackRecordData) {
  const run = vi.fn(async (action: () => Promise<{ ok: boolean }>) => (await action()).ok)
  render(<TrackRecordPanel channelId={CHANNEL} data={d} run={run} onClose={vi.fn()} />)
  return run
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset().mockResolvedValue({ ok: true })
})
afterEach(cleanup)

describe('TrackRecordPanel', () => {
  it('shows the waiting line under five videos', () => {
    setup(data({ counted: 3, checks: [], suggestions: [], intents: [] }))
    expect(
      screen.getByText('The track record starts after 5 videos have a day-28 report. So far: 3.'),
    ).toBeTruthy()
    expect(screen.queryByText(/called it right/)).toBeNull()
  })

  it('lists checks with right of counted', async () => {
    setup(data())
    expect(screen.getByText('Demand called it right on 4 of 6 videos')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Demand called it right/ }))
    expect(screen.getByText('Wirecard collapse')).toBeTruthy()
    expect(screen.getByText('WeWork rise')).toBeTruthy()
  })

  it('Apply and Dismiss call their actions', async () => {
    setup(data())
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(actions.applySuggestionAction).toHaveBeenCalledWith(CHANNEL, 'demandWarn', 'lower'),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() =>
      expect(actions.dismissSuggestionAction).toHaveBeenCalledWith(CHANNEL, 'demandWarn', 'lower'),
    )
  })

  it('Reset to default shows on applied values only', async () => {
    setup(data())
    const buttons = screen.getAllByRole('button', { name: 'Reset to default' })
    expect(buttons).toHaveLength(1)
    const applied = buttons[0]!.closest('li') as HTMLElement
    expect(within(applied).getByText(/200,000/)).toBeTruthy()
    expect(within(applied).getByText(/100,000/)).toBeTruthy()
    await userEvent.click(buttons[0]!)
    await waitFor(() =>
      expect(actions.resetTuningAction).toHaveBeenCalledWith(CHANNEL, 'openDoorMaxSubscribers'),
    )
  })

  it('lists intents as plain information with no button', () => {
    setup(data())
    const item = screen.getByText('how it collapsed').closest('li') as HTMLElement
    expect(within(item).getByText(/2 of 3/)).toBeTruthy()
    expect(within(item).queryByRole('button')).toBeNull()
  })
})
