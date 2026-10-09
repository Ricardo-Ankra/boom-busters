import {
  AnswerDeclined,
  GRAPHIC_INTENT_MAX,
  ShotBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import type { Repair } from './repair'
import { buildRetypeRequest, mockRetypedBrief, parseRetypedBrief } from './retype'
import { GRAPHIC_INTENT_RULES } from './shotlist'

const CLAIM_A = '01HQ00000000000000000000AA'
const CLAIM_B = '01HQ00000000000000000000AB'

const still: ShotBrief = {
  type: 'still',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk, cool blue grade, no faces.',
  motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
  transition: 'cut',
  prompt: 'Deserted office at dusk, painterly, film grain.',
}

const claims = [
  {
    id: CLAIM_A,
    text: 'The share price fell from 104.5 to 1.28.',
    sourceUrl: 'https://x',
    confidence: 'sourced',
  },
  {
    id: CLAIM_B,
    text: 'The HQ moved from Munich to Manila.',
    sourceUrl: 'https://y',
    confidence: 'sourced',
  },
]

describe('buildRetypeRequest', () => {
  it('asks for a DIFFERENT one when the target is the type it already is', () => {
    // How a chart or map slot gets a new brief (decision 258): the same path,
    // so the claim-number validation is the same, but the framing has to say
    // that a paraphrase of the rejected brief is not an answer.
    const chart = {
      ...still,
      type: 'chart' as const,
      chartKind: 'line' as const,
      series: [],
      dataRefs: [],
      takeaway: 'x',
      reveal: 'none' as const,
    }
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: chart as unknown as ShotBrief,
      targetType: 'chart',
      claims,
      guidance: 'Show the whole decade, not just the collapse.',
    })
    expect(request.system).toContain('DIFFERENT')
    // Not the re-type framing, which would be nonsense here.
    expect(request.system).not.toContain('expressed as type')
    expect(request.messages[request.messages.length - 1]?.content).toContain('the whole decade')
  })

  it('leaves the steer out entirely when there is none', () => {
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'chart',
      claims,
    })
    expect(request.messages.some((message) => message.content.includes('steer'))).toBe(false)
  })

  it('carries the current brief, the claims and the target rules', () => {
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'chart',
      claims,
    })
    expect(request.task).toBe('shotlist')
    expect(request.system).toContain('type "chart"')
    expect(request.system).toContain('refuse')
    expect(request.messages[0]?.content).toContain('104.5')
    expect(request.messages[1]?.content).toContain(still.prompt)
    // The claim list is the cacheable prefix, same as every visuals prompt.
    expect(request.cacheablePrefixMessages).toBe(1)
  })

  it('asks for a graphic intent, by the same rules as the shot list, and lists the held marks', () => {
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'graphic',
      claims,
      logos: ['Wirecard AG'],
    })
    expect(request.system).toContain('"type": "graphic"')
    expect(request.system).toContain('"intent"')
    expect(request.system).toContain('"intentRefs"')
    expect(request.system).toContain(GRAPHIC_INTENT_RULES)
    // The caps the schema enforces, said where the model reads (final review M1).
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intentRefs" lists at most 6 claim numbers/)
    expect(GRAPHIC_INTENT_RULES).toMatch(/"intent" is at most 300 characters/)
    expect(GRAPHIC_INTENT_RULES).not.toMatch(/list every claim/)
    expect(request.system).not.toContain('"kind": "figure"')
    expect(request.system).not.toContain('12 by 12 grid')
    expect(request.messages[0]?.content).toContain('Wirecard AG')
  })

  it('offers no "pan": the renderer cannot do one', () => {
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'chart',
      claims,
    })
    expect(request.system).not.toContain('{"kind": "pan"')
    expect(request.system).toContain('Never "pan"')
  })
})

describe('parseRetypedBrief', () => {
  it('maps chart claim numbers back to ids and returns a valid brief', () => {
    const text = JSON.stringify({
      brief: {
        type: 'chart',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        chartKind: 'line',
        series: [
          {
            label: 'Share price',
            unit: 'EUR',
            points: [
              { x: '2020-06-17', y: 104.5 },
              { x: '2020-06-26', y: 1.28 },
            ],
          },
        ],
        dataRefs: [1],
        takeaway: 'Nine days, gone.',
        reveal: 'draw-on',
      },
    })
    const brief = parseRetypedBrief(text, {
      targetType: 'chart',
      claims: [{ id: CLAIM_A }, { id: CLAIM_B }],
    })
    expect(brief).toMatchObject({ type: 'chart', dataRefs: [CLAIM_A] })
    expect(ShotBriefSchema.parse(brief)).toBeTruthy()
  })

  it('surfaces the model refusal as the action error', () => {
    expect(() =>
      parseRetypedBrief(JSON.stringify({ error: 'No sourced numbers cover this beat.' }), {
        targetType: 'chart',
        claims: [{ id: CLAIM_A }],
      }),
    ).toThrow(/No sourced numbers/)
  })

  it('rejects a brief of the wrong type — the model does not get to change its mind', () => {
    const text = JSON.stringify({
      brief: {
        type: 'map',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        locations: [{ label: 'Munich', lat: 48.14, lon: 11.58 }],
        route: false,
      },
    })
    expect(() =>
      parseRetypedBrief(text, { targetType: 'chart', claims: [{ id: CLAIM_A }] }),
    ).toThrow(/got "map"/)
  })

  it('rejects a chart citing claim numbers that do not exist', () => {
    const text = JSON.stringify({
      brief: {
        type: 'chart',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        chartKind: 'line',
        series: [
          {
            label: 'Share price',
            unit: 'EUR',
            points: [
              { x: 'a', y: 1 },
              { x: 'b', y: 2 },
            ],
          },
        ],
        dataRefs: [9],
        takeaway: 'x',
        reveal: 'none',
      },
    })
    expect(() =>
      parseRetypedBrief(text, { targetType: 'chart', claims: [{ id: CLAIM_A }] }),
    ).toThrow(/do not exist/)
  })
})

describe('mockRetypedBrief', () => {
  it('produces a valid chart citing a real claim', () => {
    const brief = mockRetypedBrief({ brief: still, targetType: 'chart', claimIds: [CLAIM_A] })
    expect(ShotBriefSchema.parse(brief)).toMatchObject({
      type: 'chart',
      dataRefs: [CLAIM_A],
      coversText: still.coversText,
    })
  })

  it('refuses a mock chart when the project has no claims — same rule as live', () => {
    expect(() => mockRetypedBrief({ brief: still, targetType: 'chart', claimIds: [] })).toThrow(
      ValidationError,
    )
  })

  it('produces a valid map carrying the slot identity across', () => {
    const brief = mockRetypedBrief({ brief: still, targetType: 'map', claimIds: [] })
    expect(ShotBriefSchema.parse(brief)).toMatchObject({ type: 'map', route: true })
  })

  it('produces a graphic intent citing the first claim, with no scene (decision 289)', () => {
    const brief = mockRetypedBrief({
      brief: still,
      targetType: 'graphic',
      claimIds: [CLAIM_A],
    })
    expect(ShotBriefSchema.parse(brief)).toMatchObject({
      type: 'graphic',
      intent: '[mock] The figure, large, with the mark beside it.',
      intentClaimIds: [CLAIM_A],
    })
    expect(brief).not.toHaveProperty('scene')
  })

  it('reads a steer into the mock graphic intent', () => {
    const brief = mockRetypedBrief({
      brief: still,
      targetType: 'graphic',
      claimIds: [CLAIM_A],
      guidance: 'Make it about the price',
    })
    expect(brief).toMatchObject({ intent: '[mock] Drafted again: Make it about the price' })
  })

  it('parses a drafted graphic into an intent with claim ids and no scene', () => {
    const text = JSON.stringify({
      brief: {
        type: 'graphic',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        intent: 'The price, collapsing.',
        intentRefs: [1],
      },
    })
    const brief = parseRetypedBrief(text, {
      targetType: 'graphic',
      claims: [{ id: CLAIM_A }, { id: CLAIM_B }],
    })
    expect(brief).toMatchObject({ type: 'graphic', intentClaimIds: [CLAIM_A] })
    expect(brief).not.toHaveProperty('scene')
  })

  it('refuses a mock graphic when the project has no claims, matching the live rule', () => {
    expect(() => mockRetypedBrief({ brief: still, targetType: 'graphic', claimIds: [] })).toThrow(
      ValidationError,
    )
  })
})

describe('the retype limits (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    return {
      notes,
      note: (repair: Repair) => {
        notes.push(repair)
      },
    }
  }

  const graphic = (over: Record<string, unknown>) =>
    JSON.stringify({
      brief: {
        type: 'graphic',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        intent: 'The price, collapsing.',
        intentRefs: [1],
        ...over,
      },
    })

  /** Seven claim ids, numbered 1 to 7 as the prompt's claim list numbers them. */
  const sevenClaims = Array.from({ length: 7 }, (_, at) => ({
    id: `01HQ0000000000000000000${at}AA`,
  }))

  it("states the graphic's and the map's limits in the prompt", () => {
    const forGraphic = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'graphic',
      claims,
    }).system.replace(/\s+/g, ' ')
    expect(forGraphic).toContain('"intentRefs" lists at most 6 claim numbers')
    expect(forGraphic).toContain('"intent" is at most 300 characters')

    const forMap = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: still,
      targetType: 'map',
      claims,
    }).system
    expect(forMap).toContain('"locations": [{"label", "lat": number, "lon": number}] (1-8 entries)')
  })

  it("trims a graphic's intent over its limit at a sentence, and says so", () => {
    const { notes, note } = collect()
    const brief = parseRetypedBrief(
      graphic({ intent: 'The price collapsed in nine days. '.repeat(12) }),
      { targetType: 'graphic', claims: [{ id: CLAIM_A }] },
      note,
    )
    const intent = (brief as { intent: string }).intent
    expect(intent.length).toBeLessThanOrEqual(GRAPHIC_INTENT_MAX)
    expect(intent.endsWith('in nine days.')).toBe(true)
    // The claim it rests on is a fact: untouched.
    expect(brief).toMatchObject({ intentClaimIds: [CLAIM_A] })
    expect(notes).toEqual([{ action: 'trimmed', field: "the graphic's intent" }])
  })

  it("keeps a graphic's first six references, in the order the model gave them", () => {
    const { notes, note } = collect()
    const brief = parseRetypedBrief(
      graphic({ intentRefs: [7, 6, 5, 4, 3, 2, 1] }),
      { targetType: 'graphic', claims: sevenClaims },
      note,
    )
    expect((brief as { intentClaimIds: string[] }).intentClaimIds).toEqual(
      [7, 6, 5, 4, 3, 2].map((number) => sevenClaims[number - 1]!.id),
    )
    expect(notes).toEqual([{ action: 'capped', field: "of the graphic's references", kept: 6 }])
  })

  it("keeps a map's first eight places with their coordinates as given", () => {
    const { notes, note } = collect()
    const places = Array.from({ length: 9 }, (_, at) => ({
      label: `City ${at + 1}`,
      lat: 10 + at,
      lon: 20 + at,
    }))
    const text = JSON.stringify({
      brief: {
        type: 'map',
        coversText: still.coversText,
        description: still.description,
        motion: { kind: 'static' },
        transition: 'cut',
        locations: places,
        route: true,
      },
    })
    const brief = parseRetypedBrief(text, { targetType: 'map', claims: [] }, note)
    expect((brief as { locations: unknown[] }).locations).toEqual(places.slice(0, 8))
    expect(notes).toEqual([{ action: 'capped', field: "of the map's places", kept: 8 }])
  })

  it('notes nothing for a brief within its limits', () => {
    const { notes, note } = collect()
    parseRetypedBrief(graphic({}), { targetType: 'graphic', claims: [{ id: CLAIM_A }] }, note)
    expect(notes).toEqual([])
  })

  it("throws the model's own reason as a decline, which the answer helper takes as final", () => {
    const declining = () =>
      parseRetypedBrief(JSON.stringify({ error: 'No sourced numbers cover this beat.' }), {
        targetType: 'chart',
        claims: [{ id: CLAIM_A }],
      })
    expect(declining).toThrow(AnswerDeclined)
    expect(declining).toThrow(/^No sourced numbers cover this beat\.$/)
  })
})
