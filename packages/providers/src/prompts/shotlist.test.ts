import { ShotListOutputSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildShotListRequest,
  buildShotRepairRequest,
  mockShotList,
  parseShotList,
  parseShotRepair,
  parseShotRepairAnswers,
  referencesPrefix,
  SHOT_LIST_FLOOR_TOKENS,
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

const STILL_BRIEF = {
  type: 'still' as const,
  coversText: 'By June, the auditors could not find the money.',
  description: 'An empty audit room.',
  shotSize: 'wide' as const,
  motion: { kind: 'static' as const },
  transition: 'cut' as const,
  prompt: 'An empty audit room at dusk, one lamp on.',
}

function baseRequest() {
  return {
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
  }
}

describe('buildShotListRequest', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
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

  it('forbids hero slots while the flag is off', () => {
    expect(request.system).toContain('Never emit type "hero"')
  })
})

describe('the headline shot (decision 257)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
  })

  it('offers the shape, which carries a claim number and nothing else', () => {
    expect(request.system).toContain('"type": "headline"')
    expect(request.system).toContain('"sourceRef": claim number')
  })

  it('tells the model it writes no part of the card, and plans at most one', () => {
    expect(request.system).toContain('not the outlet')
    expect(request.system).toContain('AT MOST ONE headline shot per chapter')
    expect(request.system).toContain('marked NEWS ARTICLE')
  })

  it('parses a headline slot and drops one with no claim number', () => {
    const good = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 7,
            brief: {
              type: 'headline',
              coversText: 'By June, the auditors could not find the money.',
              description: 'The morning the story broke.',
              motion: { kind: 'static' },
              transition: 'cut',
              sourceRef: 2,
            },
          },
        ],
      }),
    )
    expect(good.slots).toHaveLength(1)
    expect(good.malformed).toHaveLength(0)

    // A slot with no claim number is dropped and named, and the rest of the
    // chapter's plan survives it: the whole chapter is never worth one slot.
    const mixed = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 7,
            brief: {
              type: 'headline',
              coversText: 'By June, the auditors could not find the money.',
              description: 'The morning the story broke.',
              motion: { kind: 'static' },
              transition: 'cut',
            },
          },
          {
            paragraphIndex: 1,
            seconds: 6,
            brief: {
              type: 'stock',
              coversText: 'The trail led from Munich to Manila.',
              description: 'Empty office at dusk.',
              motion: { kind: 'static' },
              transition: 'cut',
              query: 'empty office dusk',
              rejectionCriteria: [],
            },
          },
        ],
      }),
    )
    expect(mixed.slots).toHaveLength(1)
    expect(mixed.malformed).toHaveLength(1)
    expect(mixed.malformed[0]?.reason).toContain('sourceRef')
  })
})

describe('the social shot (decision 284)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
  })

  it('offers the shape, which carries a claim number and nothing else', () => {
    expect(request.system).toContain('"type": "social"')
    expect(request.system).toContain('"sourceRef": claim number')
  })

  it('states the three rules verbatim', () => {
    expect(request.system).toContain(
      'Use a social shot where the narration quotes or refers to a post on X that a claim cites.',
    )
    expect(request.system).toContain(
      'Cite the claim NUMBER marked X POST in the list above; any other claim has no post behind it.',
    )
    expect(request.system).toContain(
      "Never write the post's words, the account's name, its handle or the date: the app reads them from the post.",
    )
  })

  it('parses a social slot and drops one with no claim number', () => {
    const good = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 7,
            brief: {
              type: 'social',
              coversText: 'By June, the auditors could not find the money.',
              description: 'The post the narration quotes.',
              motion: { kind: 'static' },
              transition: 'cut',
              sourceRef: 2,
            },
          },
        ],
      }),
    )
    expect(good.slots).toHaveLength(1)
    expect(good.malformed).toHaveLength(0)

    // A slot with no claim number is dropped and named, and the rest of the
    // chapter's plan survives it: the whole chapter is never worth one slot.
    const mixed = parseShotList(
      JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 7,
            brief: {
              type: 'social',
              coversText: 'By June, the auditors could not find the money.',
              description: 'The post the narration quotes.',
              motion: { kind: 'static' },
              transition: 'cut',
            },
          },
          {
            paragraphIndex: 1,
            seconds: 6,
            brief: {
              type: 'stock',
              coversText: 'The trail led from Munich to Manila.',
              description: 'Empty office at dusk.',
              motion: { kind: 'static' },
              transition: 'cut',
              query: 'empty office dusk',
              rejectionCriteria: [],
            },
          },
        ],
      }),
    )
    expect(mixed.slots).toHaveLength(1)
    expect(mixed.malformed).toHaveLength(1)
    expect(mixed.malformed[0]?.reason).toContain('sourceRef')
  })
})

describe('the graphic shot (decision 268, Plan B)', () => {
  it('describes the graphic shape, its rules, and lists the marks the library holds', () => {
    const request = buildShotListRequest({
      ...baseRequest(),
      logos: ['Stability AI', 'Wirecard AG'],
    })
    const system = request.system
    expect(system).toContain('"type": "graphic"')
    expect(system).toMatch(/never a chart with fewer points/i)
    expect(system).toMatch(/six elements at most/i)
    expect(system).toMatch(/bottom two rows/i)
    const prefix = request.messages[0]!.content
    expect(prefix).toContain('Logos (marks the producer holds')
    expect(prefix).toContain('- Stability AI')
  })

  it('says nothing about logos when the library is empty', () => {
    const request = buildShotListRequest(baseRequest())
    expect(request.messages[0]?.content).not.toContain('Logos')
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

  it('emits a headline card only when a news claim can back one', () => {
    const without = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2 })
    expect(without.slots.every((slot) => slot.brief.type !== 'headline')).toBe(true)

    const output = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2, newsClaimRefs: [2] })
    expect(() => ShotListOutputSchema.parse(output)).not.toThrow()
    const card = output.slots.find((slot) => slot.brief.type === 'headline')
    expect(card?.brief.type === 'headline' && card.brief.sourceRef).toBe(2)
  })

  it('emits a social card, on the third paragraph, only when socialClaimRefs is given (decision 284)', () => {
    const paragraphsWithThird: ShotParagraph[] = [
      ...PARAGRAPHS,
      { index: 2, text: 'EY refused to sign the accounts.', seconds: 6 },
    ]

    const without = mockShotList({ paragraphs: paragraphsWithThird, claimCount: 2 })
    expect(without.slots.every((slot) => slot.brief.type !== 'social')).toBe(true)

    const output = mockShotList({
      paragraphs: paragraphsWithThird,
      claimCount: 2,
      socialClaimRefs: [2],
    })
    expect(() => ShotListOutputSchema.parse(output)).not.toThrow()
    const card = output.slots.find((slot) => slot.brief.type === 'social')
    expect(card?.paragraphIndex).toBe(2)
    expect(card?.brief.type === 'social' && card.brief.sourceRef).toBe(2)

    // No third paragraph means no social card: there is nowhere to put it.
    const noThird = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2, socialClaimRefs: [2] })
    expect(noThird.slots.every((slot) => slot.brief.type !== 'social')).toBe(true)
  })

  it('the mock plans one graphic citing the first claim, with a mark when the library has one', () => {
    const out = mockShotList({
      paragraphs: PARAGRAPHS,
      claimCount: 2,
      claimTexts: ['The company raised $4 billion.', 'x'],
      logoTitles: ['Wirecard AG'],
    })
    const graphic = out.slots.find((slot) => slot.brief.type === 'graphic')
    expect(graphic).toBeDefined()
    if (!graphic || graphic.brief.type !== 'graphic') return
    const figure = graphic.brief.scene.elements.find((element) => element.kind === 'figure')
    expect(figure).toMatchObject({ claimRef: 1, value: '$4bn' })
    expect(graphic.brief.scene.elements.find((element) => element.kind === 'logo')).toMatchObject({
      entity: 'Wirecard AG',
    })

    const bare = mockShotList({
      paragraphs: PARAGRAPHS,
      claimCount: 1,
      claimTexts: ['Some 94 percent left.'],
    })
    const bareGraphic = bare.slots.find((slot) => slot.brief.type === 'graphic')
    expect(
      bareGraphic && bareGraphic.brief.type === 'graphic'
        ? bareGraphic.brief.scene.elements.some((e) => e.kind === 'logo')
        : true,
    ).toBe(false)
  })

  it('plans a graphic only when the first claim carries a digit to cite', () => {
    const withDigits = mockShotList({
      paragraphs: PARAGRAPHS,
      claimCount: 1,
      claimTexts: ['The company raised $4 billion.'],
    })
    expect(withDigits.slots.some((slot) => slot.brief.type === 'graphic')).toBe(true)

    // No digit anywhere in the cited claim: a figure would cite nothing, so
    // `resolvePlannedBrief` would reject it and drop it without a trace. The
    // mock must not invent a digit to dodge that, so it plans no graphic at
    // all, and the rest of the plan (both stock slots, the chart, the map)
    // is exactly as it would otherwise be.
    const withoutDigits = mockShotList({
      paragraphs: PARAGRAPHS,
      claimCount: 1,
      claimTexts: ['The auditors resigned without warning.'],
    })
    expect(withoutDigits.slots.some((slot) => slot.brief.type === 'graphic')).toBe(false)
    expect(withoutDigits.slots.map((slot) => slot.brief.type)).toEqual([
      'stock',
      'stock',
      'chart',
      'map',
    ])
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

  it('keeps the guardrail out of the image prompt; code owns the reference photo (decision 285)', () => {
    expect(request.system).not.toContain('quote their guardrail line in the prompt')
    expect(request.system).toContain('never pasted into the image')
    expect(request.system).toContain('the code tells the model which photograph is theirs.')
    expect(request.system).toContain('it decides what you plan, not what the image model reads')
  })

  /**
   * The bug this replaced: the rule told the model to write the identity
   * string for anyone shown, so a photographed person's prompt read "Emad
   * Mostaque, founder and former CEO of Stability AI, the person in the
   * reference photo. Emad Mostaque, founder and former CEO of Stability AI,
   * male in his 40s, short dark hair, closely cropped beard..." The model had
   * followed the instruction exactly; the instruction was wrong.
   */
  describe('a photographed person carries no written description', () => {
    const withPhotos = buildShotListRequest({
      caseTitle: 'Stability AI',
      chapterTitle: 'The Missing Billions',
      chapterNumber: 2,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction,
      photographed: ['Emad Mostaque'],
    })

    it('lists the photographed people in the cacheable prefix', () => {
      const prefix = withPhotos.messages[0]?.content ?? ''
      expect(prefix).toContain('Photographed')
      expect(prefix).toContain('- Emad Mostaque')
      // The book's Identity line is planning context, never prompt text.
      expect(prefix).toContain('must never')
    })

    it('forbids age, build and hair for them, and still allows clothing and posture', () => {
      expect(withPhotos.system).toContain('write NO physical description')
      expect(withPhotos.system).toContain('no age, build, height, hair, beard, glasses, skin or')
      expect(withPhotos.system).toContain('Clothing, posture, place, light')
    })

    it('keeps the identity string for a named person who has no photograph', () => {
      expect(withPhotos.system).toContain('A named person NOT in that list')
      expect(withPhotos.system).toContain('it already begins with their full name and role')
    })

    // Decision 285: how an unnamed extra is written is the bible's alone now.
    it('still describes an unnamed extra, from the bible', () => {
      expect(withPhotos.system).toContain('Anyone unnamed')
      expect(withPhotos.system).toContain('role, age range, build and clothing')
    })

    // Decision 273: extras had their faces turned away or shadowed, which the
    // owner read as blurred. Investors and employees get ordinary faces.
    it('gives extras a visible, realistic face that resembles no real person', () => {
      expect(withPhotos.system).toContain('visible and in focus.')
      expect(withPhotos.system).toContain('Their faces resemble no real or public person')
      expect(withPhotos.system).toContain(
        'A face is never blurred, smeared, hidden or turned away as a device.',
      )
      expect(withPhotos.system).not.toContain('face turned away or in shadow')
    })

    // Decision 273: a likeness pasted onto a plate rose through the table.
    // Decision 285: how they are staged is the bible's alone, not the planner's.
    it('stages a photographed person physically in the scene, from the bible', () => {
      expect(withPhotos.system).toContain(
        'A person is photographed in the room, never pasted onto it',
      )
      expect(withPhotos.system).toContain('at true scale')
    })

    it('says nothing about photographs when the cast has none', () => {
      // `request` is built without `photographed`.
      expect(request.messages[0]?.content).not.toContain('Photographed')
    })
  })

  it('asks for shotSize on every slot and depicts on likenesses, and bans the pan', () => {
    expect(request.system).toContain('"shotSize"')
    expect(request.system).toContain('"depicts"')
    expect(request.system).toContain('Never "pan"')
  })

  it('asks each still for its own lens and camera height (decision 275)', () => {
    expect(request.system).toContain('the light of the moment, then lens and camera')
  })

  it('asks for the scene alone, and no pasted lines (decision 285)', () => {
    expect(request.system).toContain('"prompt" is the scene alone')
    expect(request.system).not.toContain('verbatim: "')
    // The bible names the house photograph line as code's; what must be gone is
    // any instruction to paste it, or the anchors themselves.
    expect(request.system).not.toMatch(/film grain|line verbatim|anchors verbatim/)
  })

  it('asks for the name alone in depicts: the role stays in the prompt', () => {
    // The 2026-09-19 plan wrote "Emad Mostaque, founder and former CEO of
    // Stability AI" into the list, and the exact-name join sent every such
    // still to the plain route without its photographs.
    expect(request.system).toContain('by name alone')
    expect(request.system).toContain('never "Jane Doe, chief executive"')
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

  describe('the film knows its sets', () => {
    const withSets = buildShotListRequest({
      caseTitle: 'Stability AI',
      chapterTitle: 'The Missing Billions',
      chapterNumber: 2,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction,
      sets: [{ name: 'Venture Capital Boardroom', look: 'A long polished table, a glass wall.' }],
    })

    const withLayout = buildShotListRequest({
      caseTitle: 'Stability AI',
      chapterTitle: 'The Missing Billions',
      chapterNumber: 2,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      direction,
      sets: [
        {
          name: 'Venture Capital Boardroom',
          look: 'A long polished table, a glass wall.',
          layout: 'North wall: three tall windows.',
        },
      ],
    })

    it('puts a set by its inventory alone in the cacheable prefix, not its look, once it has one (decision 285)', () => {
      const prefix = withLayout.messages[0]?.content ?? ''
      expect(prefix).toContain('- Venture Capital Boardroom\n  North wall: three tall windows.')
      expect(prefix).not.toContain('A long polished table, a glass wall.')
    })

    it('shows a set by its inventory alone once it has one (decision 285)', () => {
      const text = referencesPrefix(
        [],
        [{ name: 'B', look: 'Endless racks.', layout: 'North wall: a door.' }],
      )
      expect(text).toContain('- B\n  North wall: a door.')
      expect(text).not.toContain('Endless racks.')
      expect(referencesPrefix([], [{ name: 'C', look: 'A glass box.', layout: '' }])).toContain(
        '- C: A glass box.',
      )
    })

    it('asks every still in a set for a camera, placed physically', () => {
      expect(withSets.system).toContain(
        '"camera"?: {"facing": "north"|"east"|"south"|"west", "position", "lens"?}',
      )
      expect(withSets.system).toContain('the still a "camera"')
      // The lens and height of a set shot go in "camera", not the prose.
      expect(withSets.system).toContain('its lens and camera height go in "camera" instead')
      expect(withSets.system).not.toContain('"lens" when it matters')
      expect(withSets.system).toContain(
        'Two stills of the same room never share a camera position.',
      )
    })

    // Live run 2 (2026-09-24): a prompt that said "rain beads on the window
    // behind them" turned a south-facing camera to the window wall. Decision
    // 285: this rule now lives once, in the bible.
    it('keeps the details a set prompt names inside the frame of its camera', () => {
      expect(withSets.system).toContain(
        "Name only details on the walls in frame for the camera's facing, " +
          'never on the wall behind it, or the image model turns to show it.',
      )
    })

    it('parses a still with a camera, and one with a broken camera without it', () => {
      const text = JSON.stringify({
        slots: [
          {
            paragraphIndex: 0,
            seconds: 4,
            brief: {
              ...STILL_BRIEF,
              set: 'Venture Capital Boardroom',
              camera: { facing: 'south', position: 'the north windows, seated height' },
            },
          },
          {
            paragraphIndex: 0,
            seconds: 4,
            brief: {
              ...STILL_BRIEF,
              set: 'Venture Capital Boardroom',
              camera: { facing: 'sideways' },
            },
          },
        ],
      })
      const parsed = parseShotList(text)
      expect(parsed.slots).toHaveLength(2)
      expect((parsed.slots[0]!.brief as { camera?: unknown }).camera).toEqual({
        facing: 'south',
        position: 'the north windows, seated height',
      })
      expect((parsed.slots[1]!.brief as { camera?: unknown }).camera).toBeUndefined()
    })

    it('lists the sets and their look in the cacheable prefix', () => {
      const prefix = withSets.messages[0]?.content ?? ''
      expect(prefix).toContain('Sets')
      expect(prefix).toContain('- Venture Capital Boardroom: A long polished table, a glass wall.')
    })

    it('asks for the set by name alone and forbids re-describing the room', () => {
      expect(withSets.system).toContain(
        'in "set" by name alone, name it in the prompt in the same words',
      )
      // The bible states the same rule once (decision 285): the planner is
      // never asked to restate the room's walls, furniture or materials.
      expect(withSets.system).toContain(
        'describe its walls, furniture or materials again; the inventory states them.',
      )
    })

    // Decision 273: every still of a set kept the plate's exact framing.
    // Decision 285: the room-versus-camera split now lives once, in the bible.
    it('asks each still of a set for its own camera position', () => {
      expect(withSets.system).toContain(
        "The plates and the room inventory are the room; the camera is the brief's.",
      )
      expect(withSets.system).toContain(
        'Two stills of the same room never share a camera position.',
      )
      expect(withSets.system).not.toContain('the photographs are the room')
    })

    // Decision 275 final review: a board override changes only "camera", so a
    // camera also written into the prose left a regenerated prompt with two.
    it('keeps the camera out of the prose of a still that names a set', () => {
      expect(withSets.system).toContain(
        'The prompt never places the camera and never describes the room',
      )
      expect(withSets.system).not.toContain('where the camera stands in the room')
      expect(withSets.system).not.toContain('from the head of the table')
      expect(withSets.system).not.toContain('close over one investor')
      expect(withSets.system).not.toContain("never the photographs' framing")
    })

    // The prompt is what the image model reads; `set` only decides which
    // photographs travel. A prompt that never says the room's name leaves the
    // attached plates with no noun to attach to, which is how a shot ends up
    // following the prose and ignoring the reference.
    //
    // Review round 1: SET_RULES used to spell out what to write happening in
    // the room ("who is there, what they are doing and the light"), which
    // duplicated the still bullet's general "prompt is the scene alone" rule
    // and was dropped for it (decision 285). What SET_RULES still carries is
    // that the room itself is named in the prompt, in the sentence's words.
    it('asks for the room to be named in the prompt, not only in the field', () => {
      expect(withSets.system).toContain('name it in the prompt in the same words')
    })

    it('says nothing about sets when the film has none', () => {
      expect(request.messages[0]?.content).not.toContain('Sets')
      expect(request.system).not.toContain('"set"')
    })
  })
})

describe('the sentence, staging and era-lock rules live once, in the bible (decision 285)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    direction: mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 }),
  })

  // The bible already states these (decision 260, 271); a planner rule that
  // paraphrased them was a second place the same rule could drift from.
  it('does not repeat the sentence, staging, era-lock or motif rules in the planning rules', () => {
    const rules = request.system.slice(request.system.indexOf('Planning rules:'))
    expect(rules).not.toContain('The sentence decides the frame')
    expect(rules).not.toContain('Stage an abstract sentence')
    expect(rules).not.toContain('The era lock is a constraint on what may appear')
    expect(rules).not.toContain('each motif at most once across the chapter')
  })

  it('still reaches the model once, through the bible', () => {
    expect(request.system).toContain('The sentence decides the frame')
    expect(request.system).toContain('An abstract sentence is staged, not symbolised.')
    expect(request.system).toContain('The era lock is a constraint, not a list to paste')
    expect(request.system).toContain('each motif at most once per chapter')
  })

  it('drops the colour grade a description used to carry: the compositor grades now', () => {
    expect(request.system).toContain('era, mood and lighting in "description"')
    expect(request.system).not.toContain('colour grade in "description"')
  })
})

describe('buildShotRepairRequest and parseShotRepair (decision 271)', () => {
  const base = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The exit',
    paragraphs: [{ index: 0, text: 'Mostaque told the investors.', seconds: 9 }],
    claims: [],
  })
  const still = {
    type: 'still',
    coversText: 'Mostaque told the investors.',
    description: 'A server rack.',
    shotSize: 'close',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'A server rack in the dark.',
  }
  const stock = {
    type: 'stock',
    coversText: 'Mostaque told the investors.',
    description: 'An office.',
    shotSize: 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    query: 'office',
    rejectionCriteria: [],
  }

  it("asks under the chapter's own rules and prefix, adding one message", () => {
    const repair = buildShotRepairRequest(
      base,
      [{ brief: still, problems: ['Emad Mostaque is named here and photographed'] }],
      { allowStockToStill: false },
    )
    expect(repair.system).toBe(base.system)
    expect(repair.cacheablePrefixMessages).toBe(base.cacheablePrefixMessages)
    expect(repair.messages.slice(0, base.messages.length)).toEqual(base.messages)
    expect(repair.messages).toHaveLength(base.messages.length + 1)
    const ask = repair.messages.at(-1)?.content ?? ''
    expect(ask).toContain('Emad Mostaque is named here and photographed')
    expect(ask).toContain('"briefs"')
    expect(ask).toContain('Keep each brief\'s "type" exactly as it is.')
  })

  it('lets the Fix button turn stock into a still, and says so', () => {
    const repair = buildShotRepairRequest(base, [{ brief: stock, problems: ['p'] }], {
      allowStockToStill: true,
    })
    expect(repair.messages.at(-1)?.content).toContain('may become a "still"')
  })

  // Decision 277: a Fix that kept a brief said nothing about why.
  it('says why each refused answer was kept', () => {
    const originals = [still, still, still, stock]
    const answer = JSON.stringify({
      briefs: [
        { ...still, coversText: 'Something else entirely.' },
        { type: 'still' },
        { ...stock, coversText: still.coversText },
      ],
    })
    expect(
      parseShotRepairAnswers(answer, originals, { allowStockToStill: false }).map((a) =>
        'kept' in a ? a.kept : 'used',
      ),
    ).toEqual([
      'the answer changed the sentence it covers',
      'the answer was not a valid brief',
      'the answer changed its format',
      'no answer came back for it',
    ])
  })

  it('reads a brief wrapped as a planned slot', () => {
    const answer = JSON.stringify({
      briefs: [{ paragraphIndex: 0, seconds: 9, brief: { ...still, prompt: 'New.' } }],
    })
    expect(parseShotRepair(answer, [still], { allowStockToStill: false })[0]).toMatchObject({
      prompt: 'New.',
    })
  })

  it('treats straightened quotes and dashes as the same sentence, and keeps the original', () => {
    const curly = {
      ...still,
      coversText: '“It’s over” — Mostaque told the investors.',
    }
    const answer = JSON.stringify({
      briefs: [
        { ...curly, coversText: '"It\'s over" - Mostaque told the investors.', prompt: 'New.' },
      ],
    })
    expect(parseShotRepair(answer, [curly], { allowStockToStill: false })[0]).toMatchObject({
      prompt: 'New.',
      coversText: curly.coversText,
    })
  })

  it('returns the replacements in order, with the original sentence forced back', () => {
    const rewritten = JSON.stringify({
      briefs: [{ ...still, coversText: 'rewritten', prompt: 'Emad Mostaque at the table.' }],
    })
    expect(parseShotRepair(rewritten, [still], { allowStockToStill: false })).toEqual([null])
    const respaced = JSON.stringify({
      briefs: [
        {
          ...still,
          coversText: 'Mostaque  told the investors.  ',
          prompt: 'Emad Mostaque at the table.',
        },
      ],
    })
    expect(parseShotRepair(respaced, [still], { allowStockToStill: false })[0]).toMatchObject({
      type: 'still',
      prompt: 'Emad Mostaque at the table.',
      coversText: 'Mostaque told the investors.',
    })
  })

  it('refuses a reply that has shifted onto the wrong brief', () => {
    const second = { ...still, coversText: 'The money was gone.' }
    // The model skipped brief 1: its first answer is brief 2's.
    const reply = JSON.stringify({ briefs: [second] })
    expect(parseShotRepair(reply, [still, second], { allowStockToStill: false })).toEqual([
      null,
      null,
    ])
  })

  it('refuses stock to still for a slot not cleared to become one, even when the call allows it', () => {
    const reply = JSON.stringify({ briefs: [still] })
    expect(parseShotRepair(reply, [stock], { allowStockToStill: true })).toEqual([null])
  })

  it('refuses a type change unless stock-to-still was allowed', () => {
    const reply = JSON.stringify({ briefs: [still] })
    const cleared = { ...stock, mayBecomeStill: true }
    expect(parseShotRepair(reply, [cleared], { allowStockToStill: false })).toEqual([null])
    expect(parseShotRepair(reply, [cleared], { allowStockToStill: true })[0]).toMatchObject({
      type: 'still',
    })
    // Only stock may change, and only into a still.
    const toStock = JSON.stringify({ briefs: [stock] })
    expect(parseShotRepair(toStock, [still], { allowStockToStill: true })).toEqual([null])
  })

  it('keeps the original where a reply is missing or malformed, and ignores extras', () => {
    const short = JSON.stringify({ briefs: [{ type: 'still' }] })
    expect(parseShotRepair(short, [still, still], { allowStockToStill: false })).toEqual([
      null,
      null,
    ])
    const extra = JSON.stringify({ briefs: [still, still, still] })
    expect(parseShotRepair(extra, [still], { allowStockToStill: false })).toHaveLength(1)
  })

  it('throws on an answer that is not JSON, for the caller to handle', () => {
    expect(() => parseShotRepair('no json here', [still], { allowStockToStill: false })).toThrow()
  })
})
