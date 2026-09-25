import { ShotBriefSchema } from '@boom-busters/schemas'
import type { ShotBrief } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockDirectorsBook } from './direction'
import { buildRebriefRequest, mockRebriefedBrief, parseRebriefedBrief } from './rebrief'
import { buildRetypeRequest } from './retype'
import { PEOPLE_RULES } from './shotlist'

const stock: ShotBrief = {
  type: 'stock',
  coversText: 'By June, the auditors could not find the money.',
  description: 'Deserted open-plan office at dusk.',
  motion: { kind: 'static' },
  transition: 'cut',
  query: 'empty office dusk',
  rejectionCriteria: ['no watermarks'],
}

describe('buildRebriefRequest', () => {
  const request = buildRebriefRequest({
    caseTitle: 'Wirecard',
    brief: stock,
    guidance: 'Something with people in it, not another empty room.',
    direction: mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1 }),
  })

  it('asks for a different idea in the same format, on the shot-list task', () => {
    expect(request.task).toBe('shotlist')
    expect(request.system).toContain('DIFFERENT')
    // The format is not in question, so the prompt names the one it must keep.
    expect(request.system).toContain('"stock"')
    expect(request.system).toContain('# Direction craft')
  })

  it('carries the steer and the current brief, with the book in the prefix', () => {
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain("Director's book:")
    expect(request.messages[1]?.content).toContain('empty office dusk')
    // The steer goes last, nearest the answer, so it is the thing the model
    // reads immediately before writing.
    expect(request.messages[request.messages.length - 1]?.content).toContain(
      'not another empty room',
    )
  })

  it('still asks without a steer, because "give me another" is an instruction', () => {
    const bare = buildRebriefRequest({ caseTitle: 'Wirecard', brief: stock, direction: null })
    expect(bare.system).toContain('DIFFERENT')
    expect(bare.messages.some((message) => message.content.includes('producer'))).toBe(false)
  })
})

// Decision 276: "Emad Mostaque in the Stability AI Boardroom" as a steer came
// back with no "set", because the redraft neither asked for one nor knew the
// room was a set, so the room's plates never travelled.
describe('buildRebriefRequest for a still', () => {
  const still: ShotBrief = {
    type: 'still',
    coversText: 'Emad Mostaque faced the board alone.',
    description: 'Mostaque at a desk.',
    shotSize: 'medium',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'Emad Mostaque, founder, the person in the reference photo, at a desk.',
    depicts: ['Emad Mostaque'],
  }
  const references = {
    photographed: ['Emad Mostaque'],
    sets: [
      {
        name: 'Stability AI Boardroom',
        look: 'a long glass table',
        layout: 'North wall: a screen',
      },
    ],
  }
  const request = buildRebriefRequest({
    caseTitle: 'Stability AI',
    brief: still,
    guidance: 'Emad Mostaque in the Stability AI Boardroom',
    direction: null,
    ...references,
  })

  it('lists the photographed cast and the sets with their inventories', () => {
    const prefix = request.messages[0]!.content
    expect(prefix).toContain('Photographed')
    expect(prefix).toContain('- Emad Mostaque')
    expect(prefix).toContain('- Stability AI Boardroom: a long glass table')
    expect(prefix).toContain('North wall: a screen')
  })

  it("asks for depicts, set and camera under the planner's people and set rules", () => {
    expect(request.system).toContain('"depicts"?:')
    expect(request.system).toContain('"set"?: the exact name of one set')
    expect(request.system).toContain('"camera"?:')
    expect(request.system).toContain(PEOPLE_RULES)
    expect(request.system).toContain('Sets are the rooms this film returns to')
    expect(request.system).not.toContain('Do not name or describe a real')
  })

  it('offers no set when the film holds none', () => {
    const plain = buildRebriefRequest({
      caseTitle: 'Stability AI',
      brief: still,
      direction: null,
      photographed: ['Emad Mostaque'],
    })
    expect(plain.system).toContain('"depicts"?:')
    expect(plain.system).not.toContain('"set"?:')
    expect(plain.system).not.toContain('Sets are the rooms')
  })

  it('keeps the cast and sets out of a stock redraft', () => {
    const stockRequest = buildRebriefRequest({
      caseTitle: 'Wirecard',
      brief: stock,
      direction: null,
      ...references,
    })
    expect(stockRequest.messages[0]!.content).not.toContain('Photographed')
    expect(stockRequest.system).not.toContain('"set"?:')
  })

  it('keeps the set and camera a new idea names', () => {
    const answer = JSON.stringify({
      brief: {
        ...still,
        prompt:
          'Emad Mostaque, founder, the person in the reference photo, in the Stability AI Boardroom.',
        set: 'Stability AI Boardroom',
        camera: { facing: 'north', position: 'the south doorway, standing height', lens: '35mm' },
      },
    })
    const parsed = parseRebriefedBrief(answer, still as Parameters<typeof parseRebriefedBrief>[1])
    expect(parsed).toMatchObject({
      set: 'Stability AI Boardroom',
      depicts: ['Emad Mostaque'],
      camera: { facing: 'north' },
    })
  })
})

describe('parseRebriefedBrief', () => {
  it('accepts a new idea that keeps the sentence and the format', () => {
    const next = mockRebriefedBrief(stock)
    const parsed = parseRebriefedBrief(JSON.stringify({ brief: next }), stock)
    expect(parsed.type).toBe('stock')
    expect(parsed.coversText).toBe(stock.coversText)
    expect(parsed.description).not.toBe(stock.description)
    expect(ShotBriefSchema.parse(parsed)).toBeTruthy()
  })

  it('refuses a draft that changed the format', () => {
    const wrong = { ...mockRebriefedBrief(stock), type: 'still', prompt: 'A room.' }
    expect(() => parseRebriefedBrief(JSON.stringify({ brief: wrong }), stock)).toThrow(/format/i)
  })

  it('refuses a draft that changed the sentence it covers', () => {
    const wrong = { ...mockRebriefedBrief(stock), coversText: 'Something else entirely.' }
    expect(() => parseRebriefedBrief(JSON.stringify({ brief: wrong }), stock)).toThrow(/covers/i)
  })

  it('passes the model’s own refusal through as a refusal, not a crash', () => {
    expect(() =>
      parseRebriefedBrief(JSON.stringify({ error: 'This beat has only one honest image.' }), stock),
    ).toThrow(/only one honest image/)
  })
})

describe('the chart-kind rules (decision 259)', () => {
  it('tells the re-brief path what each kind is for, and how to split two units', () => {
    const request = buildRetypeRequest({
      caseTitle: 'Wirecard',
      brief: stock,
      targetType: 'chart',
      claims: [
        { id: '01HQ00000000000000000000AA', text: 'x', sourceUrl: null, confidence: 'sourced' },
      ],
    })
    // The gap that made every chart a bar: the shape listed five kinds and
    // never said which was for what.
    expect(request.system).toContain('"line" for a value moving through time')
    expect(request.system).toContain('because it is the safe choice')
    expect(request.system).toContain('"axis": "left"')
  })
})
