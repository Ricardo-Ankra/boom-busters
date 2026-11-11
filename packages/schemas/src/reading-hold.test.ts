import { describe, expect, it } from 'vitest'
import { cardDurationMs, cardWords, holdShortfallMs } from './reading-hold'

describe('reading hold', () => {
  it('times each card word on the silent reading pace', () => {
    const words = cardWords("The Money That Wasn't There")
    expect(words.map((w) => w.atMs)).toEqual([300, 550, 800, 1050, 1300])
    expect(words.map((w) => w.text)).toEqual(['The', 'Money', 'That', "Wasn't", 'There'])
  })
  it('drops empty tokens', () => {
    expect(cardWords('  a   b ').map((w) => w.text)).toEqual(['a', 'b'])
    expect(cardWords('   ')).toEqual([])
  })
  it('sizes a card from its last word', () => {
    expect(cardDurationMs('Fraud')).toBe(3400)
    expect(cardDurationMs("The Money That Wasn't There")).toBe(4400)
    expect(cardDurationMs('')).toBe(3400)
  })
  it('reports how much hold a graphic is short of', () => {
    expect(holdShortfallMs(4000, 4600, 2000)).toBe(1400)
    expect(holdShortfallMs(4000, 7000, 2000)).toBe(0)
  })
})
