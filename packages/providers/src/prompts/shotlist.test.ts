import { DEFAULT_SETTINGS, ShotListOutputSchema } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildShotListRequest,
  buildShotRepairRequest,
  mockShotList,
  parseShotList,
  parseShotRepair,
  SHOT_LIST_FLOOR_TOKENS,
  stillStyleAnchors,
} from './shotlist'
import type { ShotParagraph } from './shotlist'
import { mockDirectorsBook } from './direction'
import { BANNED_PROMPT_WORDS } from './direction-craft'
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

function baseRequest() {
  return {
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
  }
}

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

describe('the headline shot (decision 257)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
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

describe('stillStyleAnchors', () => {
  it('reads grain and palette from the Brand Kit', () => {
    const anchors = stillStyleAnchors(brandKit)
    expect(anchors).toContain('film grain')
    expect(anchors).toContain(brandKit.colors.primary)
  })

  it('does not forbid faces: the bible decides who is shown, by likeness', () => {
    expect(stillStyleAnchors(brandKit)).not.toMatch(/faces/)
  })

  /**
   * The same move as the face ban, for the same reason (decision 263). A
   * documentary about a company shows that company's marks, and the anchors
   * rode on every prompt telling the model not to. The bible decides.
   */
  it('does not forbid logos: a film about a company shows its marks', () => {
    expect(stillStyleAnchors(brandKit)).not.toMatch(/logos/)
  })

  /**
   * The anchors are pasted into every still prompt verbatim, and `planWarnings`
   * scans those prompts for banned words. "cinematic" sat in both, so all 48
   * stills of a live plan warned about a string the app itself wrote.
   */
  it('uses no word the bible bans from prompts', () => {
    const anchors = stillStyleAnchors(brandKit).toLowerCase()
    for (const word of BANNED_PROMPT_WORDS) expect(anchors).not.toContain(word)
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

  it('emits a headline card only when a news claim can back one', () => {
    const without = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2 })
    expect(without.slots.every((slot) => slot.brief.type !== 'headline')).toBe(true)

    const output = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2, newsClaimRefs: [2] })
    expect(() => ShotListOutputSchema.parse(output)).not.toThrow()
    const card = output.slots.find((slot) => slot.brief.type === 'headline')
    expect(card?.brief.type === 'headline' && card.brief.sourceRef).toBe(2)
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
      styleAnchors: stillStyleAnchors(brandKit),
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
      expect(withPhotos.system).toContain('the only thing standing between the image and a')
    })

    it('still describes an unnamed extra by role, age range and build', () => {
      expect(withPhotos.system).toContain('Anyone unnamed')
      expect(withPhotos.system).toContain('role, age range, build and clothing')
      expect(withPhotos.system).toContain('resembling nobody in particular')
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

  describe('the film knows its sets', () => {
    const withSets = buildShotListRequest({
      caseTitle: 'Stability AI',
      chapterTitle: 'The Missing Billions',
      chapterNumber: 2,
      paragraphs: PARAGRAPHS,
      claims: CLAIMS,
      styleAnchors: stillStyleAnchors(brandKit),
      direction,
      sets: [{ name: 'Venture Capital Boardroom', look: 'A long polished table, a glass wall.' }],
    })

    it('lists the sets and their look in the cacheable prefix', () => {
      const prefix = withSets.messages[0]?.content ?? ''
      expect(prefix).toContain('Sets')
      expect(prefix).toContain('- Venture Capital Boardroom: A long polished table, a glass wall.')
    })

    it('asks for the set by name alone and forbids re-describing the room', () => {
      expect(withSets.system).toContain('name it in "set" by name alone')
      expect(withSets.system).toContain('the photographs are the room')
    })

    // The prompt is what the image model reads; `set` only decides which
    // photographs travel. A prompt that never says the room's name leaves the
    // attached plates with no noun to attach to, which is how a shot ends up
    // following the prose and ignoring the reference.
    it('asks for the room to be named in the prompt, not only in the field', () => {
      expect(withSets.system).toContain('Name the room in the prompt as well')
    })

    it('keeps light and weather with the planner and the fabric with the plates', () => {
      // Asserted on the half that sits whole on one line of the source; the
      // sentence wraps, and `toContain` reads the wrap.
      expect(withSets.system).toContain('its walls, furniture and layout are not.')
    })

    it('says nothing about sets when the film has none', () => {
      expect(request.messages[0]?.content).not.toContain('Sets')
      expect(request.system).not.toContain('"set"')
    })
  })
})

describe('the sentence decides the frame (decision 260)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Wirecard',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
    direction: mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 2 }),
  })

  it('puts the sentence rule first among the planning rules', () => {
    const rules = request.system.slice(request.system.indexOf('Planning rules:'))
    const sentence = rules.indexOf('The sentence decides the frame')
    const cover = rules.indexOf('Cover every paragraph')
    expect(sentence).toBeGreaterThan(-1)
    expect(sentence).toBeLessThan(cover)
  })

  it('caps each motif at once per chapter, never adjacent, never the subject', () => {
    expect(request.system).toContain('each motif at most once across the chapter')
    expect(request.system).toContain('never in consecutive slots')
    expect(request.system).toContain('needs no motif at all')
  })
})

describe('the planning rules stage the sentence (decision 271)', () => {
  const request = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The exit',
    paragraphs: [{ index: 0, text: 'He is gone.', seconds: 9 }],
    claims: [],
    styleAnchors: 'a',
  })

  it('stages an abstract sentence through its people and place, never a symbol', () => {
    expect(request.system).toContain('Stage an abstract sentence, never symbolise it.')
    expect(request.system).toContain(
      'it is not a server, a chair or a document standing in for them',
    )
    expect(request.system).not.toContain(
      'the sentence names nothing photographable do you reach for the book',
    )
  })

  it('shows the person a sentence names', () => {
    expect(request.system).toContain('A sentence that names a person shows that person')
  })

  it('treats the era lock as a constraint, and sets no motif minimum', () => {
    expect(request.system).toContain(
      'The era lock is a constraint on what may appear, not a list to paste.',
    )
    expect(request.system).toContain('There is no minimum')
  })
})

describe('buildShotRepairRequest and parseShotRepair (decision 271)', () => {
  const base = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The exit',
    paragraphs: [{ index: 0, text: 'Mostaque told the investors.', seconds: 9 }],
    claims: [],
    styleAnchors: 'a',
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

  it('returns the replacements in order, with the original sentence forced back', () => {
    const reply = JSON.stringify({
      briefs: [{ ...still, coversText: 'rewritten', prompt: 'Emad Mostaque at the table.' }],
    })
    expect(parseShotRepair(reply, [still], { allowStockToStill: false })[0]).toMatchObject({
      type: 'still',
      prompt: 'Emad Mostaque at the table.',
      coversText: 'Mostaque told the investors.',
    })
  })

  it('refuses a type change unless stock-to-still was allowed', () => {
    const reply = JSON.stringify({ briefs: [still] })
    expect(parseShotRepair(reply, [stock], { allowStockToStill: false })).toEqual([null])
    expect(parseShotRepair(reply, [stock], { allowStockToStill: true })[0]).toMatchObject({
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
