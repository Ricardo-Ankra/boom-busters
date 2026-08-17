import { DEFAULT_SETTINGS, ShotListOutputSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildShotListRequest, mockShotList, parseShotList, stillStyleAnchors } from './shotlist'
import type { ShotParagraph } from './shotlist'
import type { ScriptClaim } from './script'

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
