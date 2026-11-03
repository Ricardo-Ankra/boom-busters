import { FIRST_CHANNEL_IN_USE, OutlineSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { MAX_OUTPUT_TOKENS, THINKING_HEADROOM_TOKENS } from '../llm/types'
import { buildOutlineRequest } from './script'

/**
 * What a 240-minute run asks of the script stage (spec section 8). Two
 * formats the owner could plan: a tension format at 150 words a minute and a
 * calm one at 130, both 240 minutes, so about 34,200 and 29,640 words.
 */
const FORMATS = [
  { name: 'tension', wordsPerMinute: 150, intent: 'tension', words: 34_200 },
  { name: 'calm', wordsPerMinute: 130, intent: 'calm', words: 29_640 },
] as const

function outlineFor(minutes: number, wordsPerMinute: number, intent: 'tension' | 'calm') {
  return buildOutlineRequest({
    bible: FIRST_CHANNEL_IN_USE,
    caseTitle: 'Case',
    dossierMd: '# Case',
    claims: [],
    targetRuntimeMin: minutes,
    wordsPerMinute,
    intent,
  })
}

describe('the outline at 240 minutes', () => {
  for (const format of FORMATS) {
    describe(format.name, () => {
      const request = outlineFor(240, format.wordsPerMinute, format.intent)

      it('plans the length the pace gives', () => {
        expect(request.system).toContain(`about ${format.words} words`)
      })

      it('asks for chapters a shot list can hold, and says how many', () => {
        const chapters = Math.ceil(format.words / 1000)
        expect(request.system).toContain('chapters of about 800 to 1,000 words')
        expect(request.system).toContain(`about ${chapters} chapters`)
      })

      it('accepts as many chapters as that plan holds', () => {
        const chapters = Array.from({ length: Math.ceil(format.words / 1000) }, (_, i) => ({
          title: `Chapter ${i + 1}`,
          beat: 'A beat of at least twenty characters.',
          targetWords: 1000,
        }))
        expect(OutlineSchema.safeParse({ chapters }).success).toBe(true)
      })
    })
  }

  it('leaves every script the app allows today as it was', () => {
    // 60 minutes at the top of the pace range, 200 words a minute.
    const longest = outlineFor(60, 200, 'tension')
    expect(longest.system).not.toContain('chapters of about')
    expect(longest.maxTokens).toBe(4000 + THINKING_HEADROOM_TOKENS)
  })
})

describe('the outline answer budget at 240 minutes', () => {
  it.each(FORMATS)('$name: room for every chapter of the plan', (format) => {
    const request = outlineFor(240, format.wordsPerMinute, format.intent)
    const chapters = Math.ceil(format.words / 1000)
    // A chapter's plan runs about 450 tokens: the beat, the tension fields and the claims.
    const needed = chapters * 450
    expect(request.maxTokens).toBeGreaterThanOrEqual(needed + THINKING_HEADROOM_TOKENS)
    expect(request.maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS)
  })

  it('still fits under the ceiling at the longest runtime and fastest pace', () => {
    const request = outlineFor(240, 200, 'tension')
    expect(request.maxTokens).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS)
    expect(request.maxTokens).toBeGreaterThanOrEqual(Math.ceil(45_600 / 1000) * 450 + 4000)
  })
})
