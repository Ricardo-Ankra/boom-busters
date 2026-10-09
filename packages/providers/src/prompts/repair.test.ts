import { describe, expect, it } from 'vitest'
import { NOTICE_MESSAGE_MAX } from '@boom-busters/schemas'
import {
  capList,
  describeRepairs,
  dropItems,
  ignoreRepairs,
  overLimit,
  trimField,
  trimText,
} from './repair'
import type { Note, Repair } from './repair'

describe('trimText (decision 292)', () => {
  it('leaves a text inside the limit as it is', () => {
    expect(trimText('Short. Text.', 20)).toBe('Short. Text.')
  })

  it('cuts at the last full sentence inside the limit', () => {
    const text = 'First sentence here. Second one is here. Third runs past the limit by far.'
    expect(trimText(text, 45)).toBe('First sentence here. Second one is here.')
  })

  it('cuts at the last word when the only sentence end is early, like an abbreviation', () => {
    expect(trimText('Dr. Mostaque walked through the glass doors of the office', 30)).toBe(
      'Dr. Mostaque walked through',
    )
  })

  it('does not take a decimal point for the end of a sentence', () => {
    expect(trimText('The round valued it at $1.5 billion and more besides', 26)).toBe(
      'The round valued it at',
    )
  })

  it('cuts hard when the text has no space at all', () => {
    expect(trimText('x'.repeat(10), 4)).toBe('xxxx')
  })
})

describe('repair notes (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('trims a long field and reports it, and leaves a short or non-string value alone', () => {
    const { notes, note } = collect()
    expect(trimField('short', 20, 'the summary', note)).toBe('short')
    expect(trimField(42, 20, 'the summary', note)).toBe(42)
    expect(notes).toEqual([])
    expect(trimField('One sentence here. Two sentence here.', 25, 'the summary', note)).toBe(
      'One sentence here.',
    )
    expect(notes).toEqual([{ action: 'trimmed', field: 'the summary' }])
  })

  it('keeps the first items of a long list and reports how many', () => {
    const { notes, note } = collect()
    expect(capList([1, 2], 2, 'never-shows', note)).toEqual([1, 2])
    expect(capList('not a list', 2, 'never-shows', note)).toBe('not a list')
    expect(notes).toEqual([])
    expect(capList([1, 2, 3], 2, 'never-shows', note)).toEqual([1, 2])
    expect(notes).toEqual([{ action: 'capped', field: 'never-shows', kept: 2 }])
  })

  it('drops the items that break a rule, keeps the rest, and names each drop', () => {
    const { notes, note } = collect()
    const tooLong = (item: unknown) =>
      typeof item === 'string' && item.length > 3 ? 'its text ran long' : null
    expect(
      dropItems(['ok', 'far too long', 'no'], tooLong, (_, at) => `claim ${at + 1}`, note),
    ).toEqual(['ok', 'no'])
    expect(notes).toEqual([{ action: 'dropped', field: 'claim 2', reason: 'its text ran long' }])
    expect(dropItems('not a list', tooLong, () => 'x', note)).toBe('not a list')
  })

  it('says what ran over and by how much, in words', () => {
    expect(overLimit('its text', 1000)).toBe('its text ran over 1,000 characters')
  })

  it('describes the repairs of one answer as one line, grouped by action', () => {
    expect(describeRepairs([])).toBeNull()
    expect(
      describeRepairs([
        { action: 'trimmed', field: 'era rule 1' },
        { action: 'capped', field: 'never-shows', kept: 12 },
        { action: 'trimmed', field: "Emad Mostaque's identity" },
        { action: 'dropped', field: 'claim 37', reason: 'its text ran over 1,000 characters' },
        { action: 'rounded', field: 'the priority score of Stability AI', from: 105, to: 100 },
      ]),
    ).toBe(
      "Trimmed to fit: era rule 1; Emad Mostaque's identity. Kept the first 12 never-shows. " +
        'Dropped claim 37: its text ran over 1,000 characters. ' +
        'Rounded the priority score of Stability AI from 105 to 100.',
    )
  })

  it('keeps a long repair line within the notice limit', () => {
    const many: Repair[] = Array.from({ length: 200 }, (_, at) => ({
      action: 'trimmed' as const,
      field: `the answer to open question ${at + 1}`,
    }))
    const line = describeRepairs(many)
    expect(line).not.toBeNull()
    expect(line!.length).toBeLessThanOrEqual(NOTICE_MESSAGE_MAX)
  })

  it('lets a parser outside the helper repair without reporting', () => {
    expect(trimField('a b c d e f', 6, 'x', ignoreRepairs)).toBe('a b c')
  })
})
