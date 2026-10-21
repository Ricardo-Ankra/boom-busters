import { describe, expect, it } from 'vitest'
import { fortuneClimbers, type FortuneRow } from './fortune'

const rows = (company: string, ranks: Record<number, number>): FortuneRow[] =>
  Object.entries(ranks).map(([year, rank]) => ({ year: Number(year), rank, company }))

describe('fortuneClimbers', () => {
  it('a climb of 200 places within 10 years qualifies, 199 does not', () => {
    const out = fortuneClimbers([
      ...rows('Exact', { 1960: 400, 1969: 200 }),
      ...rows('Short', { 1960: 400, 1969: 201 }),
      ...rows('TooSlow', { 1960: 400, 1970: 200 }),
    ])
    expect(out).toEqual([{ company: 'Exact', since: '1969-01-01' }])
  })

  it('a first appearance after 1970 that later reaches the top 100 qualifies', () => {
    const out = fortuneClimbers([
      ...rows('Late', { 1975: 450, 1980: 300, 1990: 100 }),
      ...rows('Early', { 1970: 450, 1990: 50 }),
      ...rows('LateNeverTop', { 1975: 450, 1990: 101 }),
      ...rows('DebutInTop', { 1980: 50 }),
    ])
    expect(out).toEqual([{ company: 'Late', since: '1990-01-01' }])
  })

  it('takes the earlier date when both rules hold, and sorts by company', () => {
    const out = fortuneClimbers([
      ...rows('Zed', { 1980: 480, 1985: 90 }),
      ...rows('Alpha', { 1980: 480, 1985: 250, 1988: 40 }),
    ])
    expect(out).toEqual([
      { company: 'Alpha', since: '1985-01-01' },
      { company: 'Zed', since: '1985-01-01' },
    ])
  })
})
