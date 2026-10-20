import { describe, expect, it } from 'vitest'
import {
  BACKTEST,
  EDGAR_FORMS,
  EDGAR_8K_DOWNFALL_ITEM,
  HITLIST_EXCLUDED_CLASSES,
  PRIMARY_HOSTS,
  WEIGHTS,
} from './config'

describe('pre-registered config', () => {
  it('weights are the pre-registered ones and sum to 1', () => {
    expect(WEIGHTS).toEqual({ D: 0.4, G: 0.3, S: 0.15, W: 0.15 })
    expect(WEIGHTS.D + WEIGHTS.G + WEIGHTS.S + WEIGHTS.W).toBeCloseTo(1, 10)
  })
  it('pins the back-test rule', () => {
    expect(BACKTEST).toMatchObject({
      size: 40,
      maxPerChannel: 12,
      minSuccess: 12,
      passRho: 0.3,
      bootstrap: 2000,
    })
  })
  it('pins the EDGAR forms and the 8-K item', () => {
    expect(EDGAR_FORMS.downfall).toContain('NT 10-K')
    expect(EDGAR_FORMS.success).toContain('424B4')
    expect(EDGAR_8K_DOWNFALL_ITEM).toBe('4.02')
    expect(PRIMARY_HOSTS).toContain('sec.gov')
  })
  it('pins the classes the hitlist excludes', () => {
    expect(Object.keys(HITLIST_EXCLUDED_CLASSES)).toEqual([
      'Q5',
      'Q6256',
      'Q3624078',
      'Q11424',
      'Q5398426',
      'Q7725634',
      'Q571',
      'Q49371',
      'Q327333',
    ])
  })
})
