import { ShotBriefSchema, ValidationError } from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildRetypeRequest, mockRetypedBrief, parseRetypedBrief } from './retype'

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
})
