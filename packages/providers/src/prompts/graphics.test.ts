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

describe('the designer rules (decision 289, round 3)', () => {
  const system = buildGraphicRequest(input()).system
  // The rules are one string, wrapped for reading; compare with the wrapping removed.
  const rules = system.replace(/\s+/g, ' ')

  it('states the size, balance, alignment, emphasis, restraint and portrait rules', () => {
    expect(rules).toContain(
      "A figure's value grows to fill its box (it can be very large); a text's size is set by its role.",
    )
    expect(rules).toContain(
      'a figure box 6 to 10 columns wide and 3 to 5 rows tall reads as the hero',
    )
    expect(rules).toContain(
      "The grid already ends above the captions: use the whole grid. Compose around the middle: the composition's visual centre sits near row 6, with roughly equal empty space above and below it.",
    )
    expect(rules).not.toContain('stay empty for captions')
    expect(rules).not.toContain('Use rows 1 to 9')
    expect(rules).toContain(
      'Every text and figure has an "align" (start, center or end). Align the elements that stack in one column the same way',
    )
    expect(rules).toContain('A figure\'s caption ("label") aligns with its value.')
    expect(rules).toContain(
      '"underline" draws a solid bar under the element; use it on at most one element',
    )
    expect(rules).toContain('"pulse" is for a figure that lands on a spoken number.')
    expect(rules).toContain(
      'no line that only restates another element, no decorative rule or shape unless it separates two compared things, no label that repeats the title',
    )
    expect(rules).toContain(
      'give each a "portraitCell" that stacks them in the portrait frame, centred around row 6. A single-column design needs no portraitCell.',
    )
  })

  it('keeps the rules it did not change', () => {
    expect(rules).toContain(
      'An entrance may start at any time up to 600 ms before the slot ends, so it can finish.',
    )
    expect(rules).toContain('the digits shown must appear in that claim')
    expect(rules).toContain('A figure "count"s up only when the number itself is the story.')
  })

  it('offers align on a figure as well as on a text', () => {
    const lines = system.split('\n')
    const at = lines.findIndex((line) => line.startsWith('{"kind": "figure"'))
    expect(at).toBeGreaterThan(-1)
    expect(`${lines[at]} ${lines[at + 1]}`).toContain('"align"?: "start"|"center"|"end"')
  })

  it('shows three worked examples that parse, are vertically centred on the 12-row grid, and apply the rules', () => {
    const examples = system
      .split('Example,')
      .slice(1)
      .map((block) => block.slice(block.indexOf('\n') + 1).trim())
    expect(examples).toHaveLength(3)
    for (const example of examples) {
      const scene = parseGraphicScene(example)
      // Landscape cells, then the portrait cells where an element has one.
      const placements = [
        scene.elements.map((element) => element.cell),
        scene.elements.map((element) => element.portraitCell ?? element.cell),
      ]
      for (const cells of placements) {
        const top = Math.min(...cells.map((c) => c.row))
        const bottom = Math.max(...cells.map((c) => c.row + c.rowSpan))
        // Equal empty space above and below: the box's middle is row 6.
        expect(top + bottom).toBe(12)
      }
    }
  })
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
