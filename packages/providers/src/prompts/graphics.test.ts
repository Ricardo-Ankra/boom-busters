import { describe, expect, it } from 'vitest'
import { PlannedGraphicCodeSchema, ValidationError } from '@boom-busters/schemas'
import {
  buildGraphicRequest,
  estimatedWords,
  GRAPHIC_ANSWER_TOKENS,
  GRAPHIC_CODE_FIXTURE_SOURCE,
  GRAPHIC_EXAMPLE_CHART,
  GRAPHIC_EXAMPLE_CHART_DATA,
  GRAPHIC_EXAMPLE_TYPE,
  mockGraphicCode,
  parseGraphicCode,
  wordsInSlot,
  type GraphicDesignInput,
} from './graphics'
import type { Repair } from './repair'
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

const CHART_DATA: NonNullable<GraphicDesignInput['data']> = {
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  takeaway: 'Four times in a year',
  annotations: [{ atX: '2024', text: 'The round' }],
}

describe('the designer prompt (decision 295)', () => {
  const system = buildGraphicRequest(input()).system
  // The rules are one string, wrapped for reading; compare with the wrapping removed.
  const rules = system.replace(/\s+/g, ' ')

  it('asks for a title, a facts manifest and the source as one JSON string', () => {
    expect(system).toContain(
      '{"title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}',
    )
    expect(rules).toContain('one line of at most 80 characters')
    expect(rules).toContain(
      'at most 16384 characters, as one JSON string. Escape its double quotes and line breaks as JSON requires.',
    )
    expect(rules).toContain('A year is a number.')
  })

  it('states the sandbox: its arguments, every Remotion member and every prop', () => {
    expect(rules).toContain('Declare function Graphic(props) at the top level')
    expect(rules).toContain(
      'the sandbox runs your code as the body of a function of (React, Remotion, props) and returns Graphic',
    )
    for (const member of [
      'Remotion.useCurrentFrame()',
      'Remotion.useVideoConfig()',
      'Remotion.interpolate(',
      'Remotion.spring(',
      'Remotion.Easing',
      'Remotion.Sequence',
      'Remotion.AbsoluteFill',
      'Remotion.Img',
      'Remotion.withAlpha(',
      'props.brand.colors',
      'props.brand.fonts',
      'props.words',
      'props.durationMs',
      'props.safeArea',
      'props.logos',
      'props.data',
    ]) {
      expect(system).toContain(member)
    }
    // The intent reaches the model in the slot message, never as a prop (ruling 6).
    expect(system).not.toContain('props.intent')
  })

  it('says a helper is a plain function called directly, never a component', () => {
    expect(rules).toContain(
      'A helper is a plain function you call directly, row(label, value), never a React component rendered with createElement or JSX',
    )
    expect(rules).toContain('is parsed once and run again for every frame')
    expect(rules).toContain('would remount its subtree on every frame')
    expect(rules).not.toContain('rebuilds')
  })

  it('keeps the hooks at the top of Graphic, out of every helper', () => {
    expect(rules).toContain(
      'Call Remotion.useCurrentFrame(), Remotion.useVideoConfig() and React.useMemo only at the top of Graphic, never inside a helper or a condition; hand a helper the frame and fps as arguments, as both examples do.',
    )
  })

  it('caps the facts at 40 and says a chart reads its digits off props.data', () => {
    expect(rules).toContain('At most 40 entries: more is refused, not cut.')
    expect(rules).toContain("A chart's digits read off props.data need no entry.")
  })

  it('names every banned identifier and colour literal', () => {
    expect(rules).toContain(
      'Never write import, require, window, document, fetch, setTimeout, setInterval, requestAnimationFrame, Date, Math.random, eval, Function, globalThis, process, useState, useEffect or useLayoutEffect, React.Suspense, React.lazy, a # colour, or rgb(), rgba(), hsl() or hsla(); and assign to nothing under React or Remotion. A scan refuses them.',
    )
    expect(rules).toContain(
      "It also refuses constructor, prototype, __proto__, getPrototypeOf, Reflect, Proxy, self, navigator, XMLHttpRequest, WebSocket, EventSource, localStorage, sessionStorage, indexedDB, postMessage, importScripts, Worker and dangerouslySetInnerHTML; top, parent, frames, opener and location read or called as the browser's (a style's top is fine); and a script, iframe, object, embed, link, style, meta, base or form element.",
    )
  })

  it("says a Sequence's length is at least 1 and how it lays out its children (decision 295)", () => {
    expect(rules).toContain(
      "A Sequence's durationInFrames is at least 1 and its from a finite number",
    )
    expect(rules).toContain('Its children sit in a full-frame layer laid out as a flex row.')
  })

  it('has the digits written by hand and the motion driven by the frame (decision 295)', () => {
    expect(rules).toContain(
      'Format a number by hand ("1.9", "4,000,000"), never with toLocaleString or Intl',
    )
    expect(rules).toContain(
      'Motion comes from the frame alone: no CSS transition, animation or @keyframes',
    )
  })

  it('states the six rules and what the dry run refuses', () => {
    for (const rule of [
      '1. Facts.',
      '2. Brand.',
      '3. A pure function of the frame.',
      '4. Timing to the narration.',
      '5. Both frames.',
      '6. Safe area.',
    ]) {
      expect(system).toContain(rule)
    }
    expect(rules).toContain(
      "Every number on screen comes from a claim, and its digits appear in that claim's text",
    )
    expect(rules).toContain(
      "a counter's passing values are not checked while they keep moving, so land a count on the claim's figure",
    )
    expect(rules).toContain(
      'Colours come from props.brand.colors only, with Remotion.withAlpha for opacity',
    )
    expect(rules).toContain('a graphic in which nothing changes for more than 6 seconds is refused')
    expect(rules).toContain('the 16:9 frame and the 9:16 frame are both rendered and both checked')
    expect(rules).toContain(
      'Everything sits inside props.safeArea at every frame, entrances included.',
    )
    expect(rules).toContain(
      'a frame that throws, or takes more than 2 seconds, is refused. The last second shows the finished graphic, with words or figures on screen.',
    )
  })

  it('keeps the words rule the scene designer learnt (live run 3, 2026-10-07)', () => {
    expect(rules).toContain('Words on screen say only what the narration or the cited claims say.')
    expect(rules).toContain('no check reads your words, only your numbers.')
  })

  it('teaches the craft, and carries none of the old grid', () => {
    expect(rules).toContain('Kinetic type, not paragraphs')
    expect(rules).toContain('One dominant idea with secondary detail')
    expect(rules).toContain('A spring or an overshoot where the number is the story')
    expect(rules).toContain('An ending that holds rather than vanishes.')
    expect(rules).toContain('Portrait is a first-class frame, not a squeeze')
    expect(system).not.toContain('12 by 12 grid')
    expect(system).not.toContain('portraitCell')
    expect(system).not.toContain('"kind": "figure"')
  })

  it('shows the two worked examples whole, written only against the sandbox', () => {
    expect(system).toContain(GRAPHIC_EXAMPLE_TYPE)
    expect(system).toContain(GRAPHIC_EXAMPLE_CHART)
    expect(system).toContain(JSON.stringify(GRAPHIC_EXAMPLE_CHART_DATA))
    for (const example of [GRAPHIC_EXAMPLE_TYPE, GRAPHIC_EXAMPLE_CHART]) {
      expect(example).toMatch(/^function Graphic\(props\) \{$/m)
      expect(example).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bDate\b|Math\.random|\bimport\b|\bexport\b|\buseState\b/,
      )
      expect(example).toContain('props.safeArea')
      expect(example).toContain('Remotion.useVideoConfig()')
      // A helper is called, never rendered: no capitalised JSX tag but Remotion's own.
      expect(example).not.toMatch(/<(?!Remotion\.)[A-Z]/)
    }
    expect(GRAPHIC_EXAMPLE_TYPE).toContain('props.words')
    expect(GRAPHIC_EXAMPLE_TYPE).not.toContain('props.data')
    expect(GRAPHIC_EXAMPLE_CHART).toContain('props.data.series')
  })

  it('writes no dash a reader would see', () => {
    expect(system).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('buildGraphicRequest (decision 295)', () => {
  it('routes to graphics with one cacheable film message and the code budget', () => {
    const request = buildGraphicRequest(input())
    expect(request.task).toBe('graphics')
    expect(request.messages).toHaveLength(2)
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(GRAPHIC_ANSWER_TOKENS).toBe(12_000)
    expect(request.maxTokens).toBe(outputBudget(12_000))
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

  it("carries a chart's data, and only on a chart", () => {
    const chart = buildGraphicRequest(input({ data: CHART_DATA })).messages[1]!.content
    expect(chart).toContain(
      `Data (draw every point; values are verbatim from the claims):\n${JSON.stringify(CHART_DATA, null, 2)}`,
    )
    expect(buildGraphicRequest(input()).messages[1]!.content).not.toContain('Data (')
  })

  it('carries the current code in a fenced block on a redesign, then the reason, then the steer', () => {
    const request = buildGraphicRequest(
      input({
        current: {
          title: 'Old title',
          source: 'function Graphic(props) {\n  return null\n}',
        },
        rejection: 'nothing changes between 1.0 s and 8.0 s',
        guidance: 'Make the number bigger.',
      }),
    )
    const contents = request.messages.map((message) => message.content)
    expect(contents).toHaveLength(5)
    expect(contents[2]).toBe(
      'The current design, which the producer wants changed:\nTitle: Old title\n```jsx\nfunction Graphic(props) {\n  return null\n}\n```',
    )
    expect(contents[3]).toBe(
      'Your previous answer for this slot was refused: nothing changes between 1.0 s and 8.0 s. Answer again with that fixed.',
    )
    expect(contents[4]).toBe("The producer's steer: Make the number bigger.")
  })
})

describe('parseGraphicCode (decision 295)', () => {
  const ANSWER = {
    title: 'Raised in one round',
    facts: [{ text: '$4bn', claim: 1 }],
    source: 'function Graphic(props) {\n  return null\n}',
  }

  it('reads an answer, fenced or not', () => {
    expect(parseGraphicCode(JSON.stringify(ANSWER))).toEqual(ANSWER)
    expect(parseGraphicCode(`Here it is:\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)).toEqual(
      ANSWER,
    )
  })

  it('refuses an answer with no source, naming the field', () => {
    const { source: _source, ...rest } = ANSWER
    expect(() => parseGraphicCode(JSON.stringify(rest))).toThrow(
      /^The graphic answer is malformed: source: /,
    )
  })

  it('trims a title over 80 characters and says so, rather than refusing it (decision 293)', () => {
    const repairs: Repair[] = []
    const long = `${'Raised in one round '.repeat(5)}and then some`
    const parsed = parseGraphicCode(JSON.stringify({ ...ANSWER, title: long }), (repair) =>
      repairs.push(repair),
    )
    expect(parsed.title.length).toBeLessThanOrEqual(80)
    expect(long.startsWith(parsed.title)).toBe(true)
    expect(parsed.source).toBe(ANSWER.source)
    expect(repairs).toEqual([{ action: 'trimmed', field: "the graphic's title" }])
    // Without a note the trim still happens, unreported.
    expect(parseGraphicCode(JSON.stringify({ ...ANSWER, title: long })).title).toBe(parsed.title)
  })

  it('refuses a fact citing claim 0', () => {
    expect(() =>
      parseGraphicCode(JSON.stringify({ ...ANSWER, facts: [{ text: '$4bn', claim: 0 }] })),
    ).toThrow(/facts\.0\.claim: /)
  })

  it('throws a ValidationError on the graphic code field, which the answer helper retries', () => {
    let thrown: unknown
    try {
      parseGraphicCode('{}')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ValidationError)
    expect((thrown as ValidationError).field).toBe('graphic code')
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

describe('mockGraphicCode (decision 295)', () => {
  const claimTexts = CLAIMS.map((claim) => claim.text)
  /** The fixture's counting figure, which the mock swaps for a claim's own. */
  const COUNTING = "const figure = '$' + Math.round(count * 40) / 10 + 'bn'"
  /** The mock's source with its figure put back: split and join, so no `$` pattern is read. */
  const unswapped = (source: string, line: string) => source.split(line).join(COUNTING)

  it("answers with the fixture graphic, its figure the cited claim's first digit group", () => {
    const mock = mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000 })
    expect(mock.title).toBe('[mock] Raised in one round')
    expect(mock.facts).toEqual([{ text: '$4bn', claim: 1 }])
    expect(mock.source).toContain("const figure = '$4bn'")
    expect(mock.source).not.toContain(COUNTING)
    // Nothing else of the fixture changes.
    expect(unswapped(mock.source, "const figure = '$4bn'")).toBe(GRAPHIC_CODE_FIXTURE_SOURCE)
    expect(PlannedGraphicCodeSchema.safeParse(mock).success).toBe(true)
  })

  it('shows the first digit group of the first intent claim that has one', () => {
    const mock = mockGraphicCode({ claimTexts, intentRefs: [2], durationMs: 6000 })
    expect(mock.facts).toEqual([{ text: '$900bn', claim: 2 }])
    expect(mock.source).toContain("const figure = '$900bn'")
  })

  it('looks past intent claims without digits to the first claim with them', () => {
    const texts = ['No figures here.', 'Rival raised 900 million dollars.']
    expect(mockGraphicCode({ claimTexts: texts, intentRefs: [1], durationMs: 6000 }).facts).toEqual(
      [{ text: '$900bn', claim: 2 }],
    )
    expect(mockGraphicCode({ claimTexts, intentRefs: [], durationMs: 6000 }).facts).toEqual([
      { text: '$4bn', claim: 1 },
    ])
  })

  it('shows no figure and cites nothing when no claim has a digit', () => {
    const mock = mockGraphicCode({
      claimTexts: ['No figures here.'],
      intentRefs: [1],
      durationMs: 6000,
    })
    expect(mock.facts).toEqual([])
    expect(mock.source).toContain("const figure = ''")
    expect(PlannedGraphicCodeSchema.safeParse(mock).success).toBe(true)
  })

  it('differs when steered, so a redesign proves something offline, inside the title cap', () => {
    const steered = mockGraphicCode({
      claimTexts,
      intentRefs: [1],
      durationMs: 6000,
      guidance: 'bigger',
    })
    expect(steered.title).toBe('[mock] Redesigned: bigger')
    const long = mockGraphicCode({
      claimTexts,
      intentRefs: [1],
      durationMs: 6000,
      guidance: 'x'.repeat(200),
    })
    expect(long.title.length).toBeLessThanOrEqual(80)
    expect(PlannedGraphicCodeSchema.safeParse(long).success).toBe(true)
  })

  it('answers the same for a chart slot: the fixture is not a chart', () => {
    expect(
      mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000, data: CHART_DATA }).source,
    ).toBe(mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000 }).source)
  })
})
