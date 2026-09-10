import { describe, expect, it } from 'vitest'
import { caseCategoryLabel } from './case-category'

describe('caseCategoryLabel', () => {
  it('turns the stored enum into a word', () => {
    expect(caseCategoryLabel('con')).toBe('Con')
    expect(caseCategoryLabel('collapse')).toBe('Collapse')
  })

  it('never shows an unknown category as nothing', () => {
    expect(caseCategoryLabel('heist')).toBe('Heist')
  })
})
