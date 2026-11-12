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
  it('glues an abbreviation to the word after it, so no card word but the last ends in a full stop', () => {
    const nbsp = String.fromCharCode(0xa0)
    expect(cardWords('Mr. Madoff Goes to Washington').map((w) => w.text)).toEqual([
      `Mr.${nbsp}Madoff`,
      'Goes',
      'to',
      'Washington',
    ])
    expect(cardWords('The U.S. Response').map((w) => w.text)).toEqual([
      'The',
      `U.S.${nbsp}Response`,
    ])
    expect(cardWords("Dr. Braun's Empire").map((w) => w.text)).toEqual([
      `Dr.${nbsp}Braun's`,
      'Empire',
    ])
    // The pair is one word: one entrance, one timing step.
    expect(cardWords('Mr. Madoff Goes to Washington').map((w) => w.atMs)).toEqual([
      300, 550, 800, 1050,
    ])
    // A last word that ends in a full stop is left alone, and so is a title without one.
    expect(cardWords('Made in the U.S.').map((w) => w.text)).toEqual(['Made', 'in', 'the', 'U.S.'])
    expect(cardWords("The Money That Wasn't There")).toHaveLength(5)
  })
  it('keeps an existing non-breaking space inside its word', () => {
    expect(cardWords(`Mr.${String.fromCharCode(0xa0)}Madoff Falls`).map((w) => w.text)).toEqual([
      `Mr.${String.fromCharCode(0xa0)}Madoff`,
      'Falls',
    ])
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
