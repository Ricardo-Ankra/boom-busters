import { DEFAULT_SETTINGS, ShotListOutputSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildShotListRequest,
  mockShotList,
  parseShotList,
  SHOT_LIST_FLOOR_TOKENS,
  stillStyleAnchors,
} from './shotlist'
import type { ShotParagraph } from './shotlist'
import { mockDirectorsBook } from './direction'
import type { ScriptClaim } from './script'
import { MAX_OUTPUT_TOKENS, outputBudget } from '../llm/types'

const CLAIMS: ScriptClaim[] = [
  {
    id: '01HQ00000000000000000000AA',
    text: 'Wirecard shares fell from €104.50 on 17 June 2020 to €1.28 on 26 June 2020.',
    sourceUrl: 'https://example.com/price',
    confidence: 'sourced',
    adjudicated: true,
  },
  {
    id: '01HQ00000000000000000000AB',
    text: 'EY refused to sign off the 2019 accounts on 18 June 2020.',
    sourceUrl: 'https://example.com/ey',
    confidence: 'sourced',
    adjudicated: true,
  },
]

const PARAGRAPHS: ShotParagraph[] = [
  { index: 0, text: 'By June, the auditors could not find the money.', seconds: 11.4 },
  { index: 1, text: 'The trail led from Munich to Manila.', seconds: 8.2 },
]

const brandKit = DEFAULT_SETTINGS.brandKit

describe('buildShotListRequest', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
  })

  it('routes to the shotlist task', () => {
    expect(request.task).toBe('shotlist')
  })

  it('makes the claim list the cacheable prefix, like every script prompt', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('EY refused to sign off')
  })

  it('shows the model each paragraph with its measured narration length', () => {
    expect(request.messages[1]?.content).toContain('[paragraph 0 — 11s of narration]')
    expect(request.messages[1]?.content).toContain('The trail led from Munich to Manila.')
  })

  it('plans archival as upload-only real footage — nothing is fetched (decision 214)', () => {
    expect(request.system).toContain('sources and uploads by hand')
    expect(request.system).toContain('Nothing is fetched for these slots')
    expect(request.system).toMatch(/"still" is an AI-GENERATED image/)
  })

  it('threads the Brand Kit style anchors into the system prompt', () => {
    expect(request.system).toContain('subtle film grain')
  })

  it('forbids hero slots while the flag is off', () => {
    expect(request.system).toContain('Never emit type "hero"')
  })
})

describe('stillStyleAnchors', () => {
  it('reads grain and palette from the Brand Kit', () => {
    const anchors = stillStyleAnchors(brandKit)
    expect(anchors).toContain('film grain')
    expect(anchors).toContain(brandKit.colors.primary)
  })

  it('does not forbid faces: the bible decides who is shown, by likeness', () => {
    expect(stillStyleAnchors(brandKit)).not.toMatch(/faces/)
  })

  it('says "no grain" rather than "none film grain"', () => {
    const clean = {
      ...brandKit,
      look: { ...brandKit.look, grainPreset: 'none' as const },
    }
    expect(stillStyleAnchors(clean)).toContain('no grain')
    expect(stillStyleAnchors(clean)).not.toContain('none film grain')
  })
})

describe('parseShotList', () => {
  it('parses a fenced completion', () => {
    const output = parseShotList(
      'Here is the plan:\n```json\n' +
        JSON.stringify({
          slots: [
            {
              paragraphIndex: 0,
              seconds: 8,
              brief: {
                type: 'stock',
                coversText: 'By June, the auditors could not find the money.',
                description: 'Deserted office at dusk.',
                motion: { kind: 'static' },
                transition: 'cut',
                query: 'empty office dusk',
                rejectionCriteria: [],
              },
            },
          ],
        }) +
        '\n```',
    )
    expect(output.slots).toHaveLength(1)
  })

  it('refuses a chart slot with no claim refs', () => {
    expect(() =>
      parseShotList(
        JSON.stringify({
          slots: [
            {
              paragraphIndex: 0,
              seconds: 8,
              brief: {
                type: 'chart',
                coversText: 'x',
                description: 'x',
                motion: { kind: 'static' },
                transition: 'cut',
                chartKind: 'line',
                series: [
                  {
                    label: 'p',
                    unit: 'EUR',
                    points: [
                      { x: 'a', y: 1 },
                      { x: 'b', y: 2 },
                    ],
                  },
                ],
                dataRefs: [],
                takeaway: 'x',
                reveal: 'none',
              },
            },
          ],
        }),
      ),
    ).toThrow(/cite the claims/)
  })

  /**
   * The Carillion failure, pinned. Live Haiku plans one-point chart series and
   * array era ranges as habits, so a strict whole-list parse burned five paid
   * retries on the same chapter and then killed the run. A malformed slot is
   * dropped and reported; only a list with nothing usable in it throws.
   */
  it('drops a malformed slot and keeps the rest, reporting why', () => {
    const good = {
      paragraphIndex: 0,
      seconds: 8,
      brief: {
        type: 'stock',
        coversText: 'By June, the auditors could not find the money.',
        description: 'Deserted office at dusk.',
        motion: { kind: 'static' },
        transition: 'cut',
        query: 'empty office dusk',
        rejectionCriteria: [],
      },
    }
    const onePointChart = {
      paragraphIndex: 1,
      seconds: 8,
      brief: {
        type: 'chart',
        coversText: 'x',
        description: 'x',
        motion: { kind: 'static' },
        transition: 'cut',
        chartKind: 'line',
        series: [{ label: 'p', unit: 'GBP', points: [{ x: '2018', y: 845 }] }],
        dataRefs: [1],
        takeaway: 'x',
        reveal: 'none',
      },
    }

    const output = parseShotList(JSON.stringify({ slots: [good, onePointChart] }))
    expect(output.slots).toHaveLength(1)
    expect(output.slots[0]?.brief.type).toBe('stock')
    expect(output.malformed).toHaveLength(1)
    expect(output.malformed[0]).toMatchObject({
      index: 1,
      reason: expect.stringContaining('at least two points'),
    })
  })

  it('accepts an archival era range written as an array', () => {
    const output = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 6,
            brief: {
              type: 'archival',
              coversText: 'Founded in 1919 as a Wolverhampton builder.',
              description: 'The original headquarters.',
              motion: { kind: 'static' },
              transition: 'cut',
              query: 'Carillion headquarters',
              mustShow: 'the Wolverhampton building',
              eraRange: ['1919', '2008'],
            },
          },
        ],
      }),
    )
    expect(output.malformed).toHaveLength(0)
    const brief = output.slots[0]?.brief
    if (brief?.type === 'archival') expect(brief.eraRange).toBe('1919–2008')
  })
})

describe('mockShotList', () => {
  it('emits a valid plan with a chart and a map, so the board UI is exercised', () => {
    const output = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2 })
    expect(() => ShotListOutputSchema.parse(output)).not.toThrow()

    const types = output.slots.map((slot) => slot.brief.type)
    expect(types.filter((type) => type === 'stock')).toHaveLength(2)
    expect(types).toContain('chart')
    expect(types).toContain('map')
  })

  it('emits no chart when there are no claims to cite', () => {
    const output = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 0 })
    expect(output.slots.every((slot) => slot.brief.type !== 'chart')).toBe(true)
  })
})

describe('buildShotListRequest with direction (decision 252)', () => {
  const direction = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 })
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
    direction,
  })

  it('embeds the bible in the system prompt', () => {
    expect(request.system).toContain('# Direction craft')
  })

  it('puts the rendered book in the cacheable prefix beside the claims', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('Motifs: [mock] reflections in dark glass')
    expect(request.messages[0]?.content).toContain('Claims:')
  })

  it('tells the model which chapter entry is this one', () => {
    expect(request.messages[1]?.content).toContain('This is chapter 2 of the book')
  })

  it('keeps the guardrail out of the image prompt and points at the reference photo', () => {
    expect(request.system).not.toContain('quote their guardrail line in the prompt')
    expect(request.system).toContain('never pasted into the image')
    expect(request.system).toContain('the person in the reference')
    expect(request.system).toContain('Never quote the guardrail')
  })

  it('asks for shotSize on every slot and depicts on likenesses, and bans the pan', () => {
    expect(request.system).toContain('"shotSize"')
    expect(request.system).toContain('"depicts"')
    expect(request.system).toContain('Never "pan"')
  })

  it('sizes the answer budget to the chapter: a long chapter gets room, a short one the floor', () => {
    // Two paragraphs, twenty seconds: the floor. The first live run under the
    // book cut off mid-JSON at the old flat 8,000 because every brief now
    // carries a shot size, physical facts, palette, anchors and a guardrail.
    expect(request.maxTokens).toBe(outputBudget(SHOT_LIST_FLOOR_TOKENS))

    const longChapter = Array.from({ length: 60 }, (_, index) => ({
      index,
      text: `Paragraph ${index} of a long chapter.`,
      seconds: 10,
    }))
    const long = buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'x',
      paragraphs: longChapter,
      claims: CLAIMS,
      styleAnchors: 'a',
      direction,
    })
    expect(long.maxTokens).toBeGreaterThan(request.maxTokens)
    // 600 s of narration → 120 possible slots × 400 tokens = 48,000: capped.
    expect(long.maxTokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it('still works with no book, for re-runs of projects planned before it', () => {
    const bare = buildShotListRequest({
      caseTitle: 'Wirecard',
      chapterTitle: 'x',
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      styleAnchors: 'a',
    })
    expect(bare.messages[0]?.content).not.toContain('Motifs:')
    expect(bare.messages[1]?.content).not.toContain('of the book')
  })

  it('parses shotSize and depicts on a planned still', () => {
    const parsed = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 6,
            brief: {
              type: 'still',
              coversText: 'By June, the auditors could not find the money.',
              description: 'An empty audit room.',
              shotSize: 'wide',
              motion: { kind: 'static' },
              transition: 'cut',
              prompt: 'An empty audit room at dusk, one lamp on.',
              depicts: ['Markus Braun'],
            },
          },
        ],
      }),
    )
    expect(parsed.slots[0]?.brief).toMatchObject({ shotSize: 'wide', depicts: ['Markus Braun'] })
  })

  it('gives the mock plan alternating sizes so the lint stays quiet', () => {
    const plan = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 0 })
    expect(plan.slots.map((slot) => slot.brief.shotSize)).toEqual(['wide', 'medium', 'graphic'])
  })
})
