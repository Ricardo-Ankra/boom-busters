import { FIRST_CHANNEL_BIBLE } from '@boom-busters/schemas'
import type { ChannelBible } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { caseCategoryLabel, caseCategoryKeys } from './case-category'

/** A channel whose categories are not Boom & Busters' (as the providers' psychology test bible). */
const PSYCHOLOGY: ChannelBible = {
  ...FIRST_CHANNEL_BIBLE,
  caseCategories: [
    { key: 'experiment', label: 'Experiment' },
    { key: 'bias', label: 'Bias' },
    { key: 'replication', label: 'Replication' },
  ],
}

describe('caseCategoryLabel', () => {
  it("returns the label the channel's bible gives the key", () => {
    expect(caseCategoryLabel(FIRST_CHANNEL_BIBLE, 'con')).toBe('Con')
    expect(caseCategoryLabel(FIRST_CHANNEL_BIBLE, 'collapse')).toBe('Collapse')
    expect(caseCategoryLabel(PSYCHOLOGY, 'bias')).toBe('Bias')
  })

  it('falls back to the key itself when the bible no longer lists it', () => {
    expect(caseCategoryLabel(PSYCHOLOGY, 'collapse')).toBe('collapse')
    expect(caseCategoryLabel(FIRST_CHANNEL_BIBLE, 'heist')).toBe('heist')
  })
})

describe('caseCategoryKeys', () => {
  it("lists the bible's keys in its order", () => {
    expect(caseCategoryKeys(FIRST_CHANNEL_BIBLE)).toEqual([
      'collapse',
      'con',
      'meltdown',
      'turnaround',
      'empire',
    ])
    expect(caseCategoryKeys(PSYCHOLOGY)).toEqual(['experiment', 'bias', 'replication'])
  })
})
