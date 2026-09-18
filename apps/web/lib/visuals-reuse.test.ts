import type { SlotCandidate } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  describeGap,
  reusedByCount,
  reuseView,
  sharedShotWarnings,
  timecode,
  type ReusableRow,
} from './visuals-reuse'

/**
 * The pure half of shot reuse (decision 261): what a card says about its
 * link, and the note when one picture plays twice too close.
 */

const candidate = (id: string, extra: Partial<SlotCandidate> = {}): SlotCandidate => ({
  id,
  provider: 'pexels',
  kind: 'image',
  sourceUrl: `https://images.pexels.com/${id}.jpg`,
  licence: 'Pexels License',
  ...extra,
})

const row = (id: string, startMs: number, extra: Partial<ReusableRow> = {}): ReusableRow => ({
  id,
  chapterIndex: 0,
  startMs,
  status: 'resolved',
  reuseOfSlotId: null,
  candidates: [],
  ...extra,
})

describe('reuseView', () => {
  it('names the source from the column, with its place and status', () => {
    const source = row('A', 0, { chapterIndex: 1, status: 'placeholder' })
    const dependant = row('B', 12_000, { reuseOfSlotId: 'A' })
    expect(reuseView(dependant, [source, dependant])).toEqual({
      sourceSlotId: 'A',
      chapterIndex: 1,
      startMs: 0,
      sourceStatus: 'placeholder',
    })
  })

  it('is null for a slot with its own shot, and for a source that no longer exists', () => {
    expect(reuseView(row('A', 0), [row('A', 0)])).toBeNull()
    expect(reuseView(row('B', 0, { reuseOfSlotId: 'gone' }), [row('B', 0)])).toBeNull()
  })
})

describe('reusedByCount', () => {
  it('counts the slots that show this slot’s shot', () => {
    const rows = [
      row('A', 0),
      row('B', 0, { reuseOfSlotId: 'A' }),
      row('C', 0, { reuseOfSlotId: 'A' }),
    ]
    expect(reusedByCount(rows[0]!, rows)).toBe(2)
    expect(reusedByCount(rows[1]!, rows)).toBe(0)
  })
})

describe('sharedShotWarnings', () => {
  it('notes the same picture chosen twice within a minute, by asset or by provider id', () => {
    const rows = [
      row('A', 0, { candidates: [candidate('p1', { chosen: true })] }),
      row('B', 40_000, { candidates: [candidate('p1', { chosen: true })] }),
      row('C', 100_000, {
        candidates: [candidate('g1', { chosen: true, assetId: '01J000000000000000000000AA' })],
      }),
      row('D', 150_000, {
        candidates: [candidate('g9', { chosen: true, assetId: '01J000000000000000000000AA' })],
      }),
    ]
    expect(sharedShotWarnings(rows)).toEqual([
      'the same shot plays at 0:00 and 0:40, under a minute apart',
      'the same shot plays at 1:40 and 2:30, under a minute apart',
    ])
  })

  it('is silent past a minute, for different pictures, and for slots with nothing chosen', () => {
    expect(
      sharedShotWarnings([
        row('A', 0, { candidates: [candidate('p1', { chosen: true })] }),
        row('B', 61_000, { candidates: [candidate('p1', { chosen: true })] }),
        row('C', 5_000, { candidates: [candidate('p2', { chosen: true })] }),
        row('D', 6_000, { candidates: [candidate('p1')] }),
      ]),
    ).toEqual([])
  })
})

describe('timecode and describeGap', () => {
  it('reads as an editor would say it', () => {
    expect(timecode(6_000)).toBe('0:06')
    expect(timecode(200_000)).toBe('3:20')
    expect(describeGap(12_000, 0)).toBe('12 s earlier')
    expect(describeGap(0, 200_000)).toBe('3 min 20 s later')
  })
})
