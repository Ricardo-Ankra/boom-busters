// @vitest-environment node

import type { AngleOption, SearchBrief } from '@boom-busters/schemas'
import { FIRST_CHANNEL_IN_USE, SearchBriefSchema } from '@boom-busters/schemas'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rateAngles, rateAnglesInput } from './rate-angles'

const row = (keyword: string, overall: number) => ({
  keyword,
  volume: 50,
  competition: 30,
  overall,
  estimatedMonthlySearch: null,
  growthPct: null,
})

const option = (keyword: string, answers: string[] = []): AngleOption => ({
  angle: `An angle about ${keyword}`,
  keyword,
  answers,
  gap: 'A gap nobody has covered yet',
})

const brief = (angleOptions: AngleOption[]): SearchBrief =>
  SearchBriefSchema.parse({
    subject: 'WeWork',
    measuredAt: new Date().toISOString(),
    targetKeyword: row('wework documentary', 60),
    secondaryKeywords: [],
    searchedQuestions: ['why did wework fail'],
    outliers: [],
    titlePatterns: [],
    toldAlready: ['the lease model'],
    angleOptions,
    chosenAngle: null,
    formatKey: null,
    fit: null,
    searchedTitles: [row('wework: the rise and fall', 80)],
  })

const complete = vi.fn()

describe('rate-angles', () => {
  beforeEach(() => {
    vi.stubEnv('MOCK_PROVIDERS', '1')
    complete.mockReset()
  })
  afterEach(() => vi.unstubAllEnvs())

  it('builds options with their Demand', () => {
    const input = rateAnglesInput(
      brief([
        option('wework documentary', ['why did wework fail']),
        option('wework: the rise and fall'),
      ]),
      FIRST_CHANNEL_IN_USE,
    )
    expect(input.subject).toBe('WeWork')
    expect(input.searchedQuestions).toEqual(['why did wework fail'])
    expect(input.toldAlready).toEqual(['the lease model'])
    expect(input.options[0]).toMatchObject({
      keyword: 'wework documentary',
      servesSearchedTerm: false,
      demand: 48,
      keywordOverall: 60,
      answers: 1,
    })
    expect(input.options[1]).toMatchObject({
      servesSearchedTerm: true,
      demand: 0,
      keywordOverall: null,
    })
  })

  it('refuses fewer than two options', async () => {
    const result = await rateAngles(
      brief([option('wework documentary')]),
      FIRST_CHANNEL_IN_USE,
      complete,
    )
    expect(result.ok).toBe(false)
    expect(complete).not.toHaveBeenCalled()
  })

  it('returns the mock rating in mock mode', async () => {
    const result = await rateAngles(
      brief([option('wework: the rise and fall'), option('wework documentary')]),
      FIRST_CHANNEL_IN_USE,
      complete,
    )
    expect(result).toMatchObject({ ok: true, rating: { recommended: 1 } })
    expect(complete).not.toHaveBeenCalled()
  })
})
