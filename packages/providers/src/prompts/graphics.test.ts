import { describe, expect, it } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import {
  buildGraphicRequest,
  estimatedWords,
  GRAPHIC_ANSWER_TOKENS,
  mockGraphicScene,
  parseGraphicScene,
  wordsInSlot,
  type GraphicDesignInput,
} from './graphics'
import { outputBudget } from '../llm/types'

const CLAIMS = [
  {
    id: '01J00000000000000000000001',
    text: 'Acme raised 4 billion dollars in 2024.',
    sourceUrl: null,
    confidence: 'high',
  },
  {
    id: '01J00000000000000000000002',
    text: 'Rival raised 900 million dollars.',
    sourceUrl: null,
    confidence: 'high',
  },
]

const input = (over: Partial<GraphicDesignInput> = {}): GraphicDesignInput => ({
  caseTitle: 'The Acme collapse',
  claims: CLAIMS,
  logos: ['Acme'],
  chapterTitle: 'The raise',
  coversText: 'Acme raised four billion.',
  paragraphText: 'In 2024 Acme raised four billion. Nobody asked how.',
  durationMs: 6000,
  words: [
    { text: 'Acme', offsetMs: 0 },
    { text: 'raised', offsetMs: 400 },
    { text: 'four', offsetMs: 900 },
    { text: 'billion.', offsetMs: 1200 },
  ],
  wordsEstimated: false,
  intent: 'Four billion in one round is the story.',
  intentRefs: [1],
  ...over,
})

describe('buildGraphicRequest (decision 289)', () => {
  it('routes to graphics with one cacheable film message', () => {
    const request = buildGraphicRequest(input())
    expect(request.task).toBe('graphics')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.maxTokens).toBe(outputBudget(GRAPHIC_ANSWER_TOKENS))
  })

  it('keeps the film message identical across two slots of one film', () => {
    const a = buildGraphicRequest(input())
    const b = buildGraphicRequest(input({ coversText: 'Rival raised less.', intentRefs: [2] }))
    expect(a.system).toBe(b.system)
    expect(a.messages[0]).toEqual(b.messages[0])
    expect(a.messages[0]!.content).toContain(
      '[1] (id: 01J00000000000000000000001) Acme raised 4 billion dollars in 2024.',
    )
    expect(a.messages[0]!.content).toContain('- Acme')
  })

  it('gives the slot its length, its words on the clock, its intent and its claims', () => {
    const slot = buildGraphicRequest(input()).messages[1]!.content
    expect(slot).toContain('Length: 6.0 s')
    expect(slot).toContain('0.9 s  four')
    expect(slot).toContain('Intent: Four billion in one round is the story.')
    expect(slot).toContain('Rests on claims: 1')
  })

  it('says when word times are estimated', () => {
    const slot = buildGraphicRequest(input({ wordsEstimated: true })).messages[1]!.content
    expect(slot).toContain('estimated from the slot length')
  })

  it('carries the current scene and the steer on a redesign, steer last', () => {
    const request = buildGraphicRequest(
      input({
        current: {
          elements: [
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
              content: 'Old',
              role: 'title',
              color: 'textPrimary',
              align: 'start',
              enter: { kind: 'fade', atMs: 0 },
            },
          ],
        },
        guidance: 'Make the number bigger.',
      }),
    )
    const last = request.messages.at(-1)!.content
    expect(request.messages.some((m) => m.content.includes('"content": "Old"'))).toBe(true)
    expect(last).toBe("The producer's steer: Make the number bigger.")
    // A gone claim shows as claimRef 0, which the check refuses; the
    // message says what to do with it (final review M3).
    const current = request.messages.find((m) => m.content.startsWith('The current design'))!
    expect(current.content).toContain(
      'an element citing a claim no longer in the list must cite a listed claim or be dropped',
    )
    expect(current.content).not.toContain('claimRef 0 is a claim no longer in the list')
  })

  it('names the reason a previous answer was refused', () => {
    const request = buildGraphicRequest(input({ rejection: 'element "f" enters at 5800 ms' }))
    expect(request.messages.at(-1)!.content).toContain('element "f" enters at 5800 ms')
  })
})

describe('parseGraphicScene', () => {
  it('reads a scene', () => {
    const scene = parseGraphicScene(
      '{"scene": {"elements": [{"kind": "figure", "id": "f", "cell": {"col": 0, "row": 2, "colSpan": 7, "rowSpan": 4}, "value": "$4bn", "claimRef": 1, "color": "accent", "enter": {"kind": "count", "atMs": 900}}]}}',
    )
    expect(scene.elements[0]).toMatchObject({ kind: 'figure', claimRef: 1 })
  })

  it('refuses a malformed scene in words', () => {
    expect(() => parseGraphicScene('{"scene": {"elements": []}}')).toThrow(ValidationError)
  })
})

describe('word offsets', () => {
  it('keeps the words spoken inside the slot, on the slot clock', () => {
    const words = wordsInSlot(
      [
        { text: 'before', startMs: 900 },
        { text: 'four', startMs: 2100 },
        { text: 'after', startMs: 9000 },
      ],
      1200,
      6000,
    )
    expect(words).toEqual([{ text: 'four', offsetMs: 900 }])
  })

  it('spreads the covered words evenly when no timings exist', () => {
    expect(estimatedWords('one two three four', 4000)).toEqual([
      { text: 'one', offsetMs: 0 },
      { text: 'two', offsetMs: 1000 },
      { text: 'three', offsetMs: 2000 },
      { text: 'four', offsetMs: 3000 },
    ])
  })
})

describe('mockGraphicScene', () => {
  it('builds a figure from the first intent claim’s digits, inside the slot', () => {
    const scene = mockGraphicScene({
      claimTexts: CLAIMS.map((c) => c.text),
      intentRefs: [1],
      logoTitles: ['Acme'],
      durationMs: 6000,
    })
    expect(scene.elements.find((e) => e.kind === 'figure')).toMatchObject({
      value: '$4bn',
      claimRef: 1,
    })
  })

  it('differs when steered, so a redesign proves something offline', () => {
    const plain = mockGraphicScene({ claimTexts: ['4 billion'], intentRefs: [1], durationMs: 6000 })
    const steered = mockGraphicScene({
      claimTexts: ['4 billion'],
      intentRefs: [1],
      durationMs: 6000,
      guidance: 'bigger',
    })
    expect(steered).not.toEqual(plain)
  })
})
