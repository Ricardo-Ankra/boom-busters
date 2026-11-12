import { describe, expect, it } from 'vitest'
import { holdMsFor } from './reading-hold'

const fact = (text: string) => ({ text, claimId: 'c1' })

describe('holdMsFor', () => {
  it('gives a chart the figure hold', () => {
    expect(holdMsFor('chart', { facts: [] })).toBe(2500)
  })
  it('gives a graphic citing a figure the figure hold', () => {
    expect(holdMsFor('graphic', { facts: [fact('1.2bn')] })).toBe(2500)
  })
  it('gives a graphic with no facts, or only words, the reading hold', () => {
    expect(holdMsFor('graphic', { facts: [] })).toBe(2000)
    expect(holdMsFor('graphic', { facts: [fact('Nobody')] })).toBe(2000)
  })
})
