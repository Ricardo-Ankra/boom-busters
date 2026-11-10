import { describe, expect, it } from 'vitest'
import { hedgeDensity } from './script-measures'

const filler = (count: number) => Array.from({ length: count }, () => 'word').join(' ')

describe('hedgeDensity', () => {
  it('counts hedge phrases per hundred words', () => {
    // Three hedge phrases among 200 words in all.
    const text = `The fund was alleged ${filler(60)} according to the filing ${filler(60)} reportedly ${filler(
      71,
    )}`
    expect(text.split(/\s+/)).toHaveLength(200)
    expect(hedgeDensity([{ contentMd: text }])).toBe(1.5)
  })

  it('is zero for no words', () => {
    expect(hedgeDensity([])).toBe(0)
    expect(hedgeDensity([{ contentMd: '   ' }])).toBe(0)
  })

  it('does not count a pause tag as a word', () => {
    const text = `Allegedly. ${filler(99)} [pause]`
    expect(hedgeDensity([{ contentMd: text }])).toBe(1)
  })
})
