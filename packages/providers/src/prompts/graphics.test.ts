import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOTION_IDENTITY,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_BIBLE,
  FIRST_CHANNEL_IN_USE,
  PlannedGraphicCodeSchema,
  ValidationError,
} from '@boom-busters/schemas'
import { PSYCHOLOGY_TEST_BIBLE } from './lift/psychology-bible'
import {
  buildGraphicRequest,
  buildGraphicReviewRequest,
  parseGraphicReview,
  estimatedWords,
  GRAPHIC_ANSWER_TOKENS,
  GRAPHIC_CODE_FIXTURE_SOURCE,
  mockGraphicCode,
  parseGraphicCode,
  wordsInSlot,
  type GraphicDesignInput,
} from './graphics'
import type { Repair } from './repair'
import { REMOTION_RULES } from './remotion-rules'
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
  bible: FIRST_CHANNEL_IN_USE,
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

  it('asks for the concept and the storyboard first, then a title, a facts manifest and the source as one JSON string (decision 388)', () => {
    expect(system).toContain(
      '{"concept": "...", "storyboard": ["...", "..."], "mechanisms": ["..."], "title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}',
    )
    expect(rules).toContain(
      'its keys in this order, so the concept and the storyboard are settled before the code is written',
    )
    expect(rules).toContain('in one line of at most 200 characters')
    expect(rules).toContain('one entry per change, each starting with its time')
    expect(rules).toContain('at most 16 entries. Then write the code to it.')
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
      'motion.ms',
      'motion.frames(',
      'motion.ease',
      'motion.spring',
      'motion.px.rise',
      'motion.scale.enter',
      'motion.stagger(',
      'motion.order',
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
      'Call Remotion.useCurrentFrame(), Remotion.useVideoConfig() and React.useMemo only at the top of Graphic, never inside a helper or a condition; hand a helper the frame and fps as arguments.',
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
    expect(rules).toContain(
      'Its children sit in a full-frame layer laid out as a flex row, unless layout="none".',
    )
  })

  it("times the motion against props.durationMs and the words, not the slot's frame count (final review M2)", () => {
    expect(rules).toContain(
      "Time your motion against props.durationMs and the words' atMs, not durationInFrames",
    )
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

  it('teaches a concept built from moment to moment, not a template (decision 388)', () => {
    expect(rules).toContain(
      'You are a motion designer, not a slide builder: the graphic is one idea that moves.',
    )
    expect(rules).toContain(
      'A centred column of lines, each fading in under the last, is a template, not a design.',
    )
    expect(rules).toContain(
      'Each moment is made out of the one before: an element arrives once and then changes role instead of leaving',
    )
    expect(rules).toContain('A hook in the first half second')
    expect(rules).toContain('Something changes about every 1.5 seconds, and the camera never stops')
    expect(rules).toContain('Blur follows speed')
    expect(rules).toContain('3D when it carries meaning')
    // The owner's review of decision 387: chart marks stay conventional, and no decorative ticks.
    expect(rules).toContain(
      'Charts stay honest and conventional: bars rise out of the baseline, lines draw on',
    )
    expect(rules).toContain(
      'no gridlines or minor ticks, and no bar that travels or morphs from one value to the next',
    )
    expect(rules).toContain(
      'Never: glows, particle bursts, lens flares, camera shake, RGB split, a crossfade from one whole layout to another, decorative gradients, drop shadows for depth.',
    )
  })

  it('fills the craft from the channel identity and keeps the house words at the defaults (spec 2026-11-04)', () => {
    expect(system).toContain('about every 1.5 seconds')
    expect(system).toContain('more than 6 seconds is refused')
    expect(system).toContain('Never: glows, particle bursts')
    expect(system).not.toContain("This channel's motion:")
    const sleepy = buildGraphicRequest(
      input({
        motion: {
          ...DEFAULT_MOTION_IDENTITY,
          changeEveryMs: 6000,
          stillMaxMs: 9000,
          allow: ['glows'],
          threeD: 'never',
          blurFollowsSpeed: false,
          chartsConventional: false,
          cameraRule: 'never moves',
          ms: { enter: 900 },
          styleGuideMd: 'Slow and dark.',
        },
      }),
    ).system
    expect(sleepy).toContain('about every 6 seconds')
    expect(sleepy).toContain('more than 9 seconds is refused')
    expect(sleepy).not.toMatch(/Never:.*glows/)
    expect(sleepy).toContain('Never: particle bursts')
    expect(sleepy).toContain('No 3D')
    expect(sleepy).not.toContain('Blur follows speed')
    expect(sleepy).not.toContain('Charts stay honest and conventional')
    expect(sleepy).toContain('and the camera never moves.')
    expect(sleepy).toContain("This channel's motion:")
    expect(sleepy).toContain('Slow and dark.')
    expect(sleepy).toContain('entrances take 900 ms')
    // The sandbox's numbers are the channel's, not the house's (final review, issue 4).
    expect(sleepy).toContain('{micro 120, enter 900, exit 300, reveal 550')
    expect(sleepy).not.toContain('enter 450')
    expect(system).toContain('{micro 120, enter 450, exit 300, reveal 550')
    expect(system).toContain('motion.px.rise (20 at 1080p')
    const faded = buildGraphicRequest(
      input({ motion: { ...DEFAULT_MOTION_IDENTITY, entrance: 'fade', overshoot: 'none' } }),
    ).system
    expect(faded).toContain('motion.px.rise (0 at 1080p')
    expect(faded).toContain('Nothing passes its mark: the hero spring settles without overshoot')
    expect(faded).not.toContain("snap's hair")
    expect(faded).not.toContain('one small overshoot')
    expect(system).toContain("snap's hair of overshoot")
    // Allow is said, not only subtracted (final review, issue 3).
    expect(sleepy).toContain('Allowed on this channel: glows.')
    expect(system).not.toContain('Allowed on this channel')
    expect(sleepy).not.toContain('—')
    const bare = buildGraphicRequest(
      input({ motion: { ...DEFAULT_MOTION_IDENTITY, never: [], allow: [] } }),
    ).system
    expect(bare).not.toContain('Never:')
  })

  it('says nothing about the tokens to a design stored with motion 1 (spec review focus 4)', () => {
    const request = buildGraphicRequest(
      input({
        current: { title: 'Old', source: 'function Graphic() { return null }', motion: 1 },
      }),
    )
    expect(request.messages[2]!.content).not.toContain('written before the motion tokens')
  })

  it('teaches the craft, and carries none of the old grid', () => {
    expect(rules).toContain('Kinetic type, not paragraphs')
    expect(rules).toContain('One dominant idea with secondary detail')
    expect(rules).not.toContain('A spring or an overshoot where the number is the story')
    expect(rules).toContain('An ending that holds rather than vanishes.')
    expect(rules).toContain('Portrait is a first-class frame, not a squeeze')
    expect(system).not.toContain('12 by 12 grid')
    expect(system).not.toContain('portraitCell')
    expect(system).not.toContain('"kind": "figure"')
  })

  it('puts the motion on tokens: every curve, length and spring is named (decision 301)', () => {
    expect(rules).toContain(
      'The house motion. The scan holds the curve and the spring config: every interpolate names a motion.ease, every spring a motion.spring.',
    )
    expect(rules).toContain(
      'Which curve, which preset, hero once per beat and every length are judged on the board, not checked:',
    )
    expect(rules).not.toContain('The first three are checked')
    expect(rules).toContain(
      "Entrances, exits and moves come from the tokens, in the house motion below. Nothing passes its mark except the one hero spring of a beat and snap's hair of overshoot on small things; nothing spins.",
    )
    expect(rules).toContain(
      'snap for small things only (a tick, a dot, a badge), never a figure or a title.',
    )
    expect(rules).toContain(
      'Anything keyed to the narration keeps its spoken time; stagger only what the narration does not time.',
    )
    expect(rules).toContain(
      'motion: the house motion tokens, declared above your code and read-only.',
    )
    expect(rules).toContain(
      'Every interpolate carries easing: motion.ease.<name>, written inside the call: enter for arrivals, exit for departures, move for a reframe or the camera, emphasis for the one hero figure of the beat, linear for counters and progress only.',
    )
    expect(rules).toContain(
      'A spring is Remotion.spring({ frame, fps, delay, config: motion.spring.<name> }) and nothing else: settle by default (no overshoot), hero at most once per beat',
    )
    expect(rules).toContain('exits are shorter than entrances')
    expect(rules).toContain(
      'Remotion.interpolate(value, inputRange, outputRange, {easing, extrapolateLeft, extrapolateRight, output})',
    )
    expect(rules).toContain("output: 'perceptual-scale' on any interpolate that drives a scale.")
    expect(rules).toContain(
      'A change within a beat transforms what is on screen (it moves, resizes, recolours or docks) rather than clearing it; when something must leave, it exits on motion.ms.exit and what replaces it enters a motion.ms.gap later.',
    )
    expect(rules).not.toContain('A change within a beat is an exit, a motion.ms.gap pause')
    expect(rules).toContain('A group of three or more elements staggers')
    expect(rules).toContain(
      'The hero lands last, with only its note after it: entrances follow motion.order, frame, title, body, hero, note.',
    )
    expect(rules).toContain('A beat gets one kind of entrance.')
    expect(rules).toContain(
      'It refuses Remotion.Easing in any form (the curves are motion.ease), an interpolate with no easing: motion.ease.<name> written inside the call, a spring other than Remotion.spring({ frame, fps, delay, config: motion.spring.<name> })',
    )
    expect(rules).toContain(
      "Remotion['...'], React['...'] or motion['...'], an assignment to motion, a motion binding of your own, a Remotion.spring or Remotion.interpolate read without being called, and a motion.ease or motion.spring name that is not a token.",
    )
    expect(rules).toContain('an assignment to motion, a motion binding of your own')
    expect(rules).toContain(
      'motion.frames(ms, fps), a length in whole frames, at least 1, and a time too: a word at 0 ms starts on frame 1.',
    )
    expect(rules).not.toContain('Remotion.Easing.out(Remotion.Easing.poly(4))')
    expect(rules).not.toContain('16 to 24 px rise')
  })

  it("carries Remotion's own rules, pinned to the vendored files (decision 301)", () => {
    expect(system).toContain(REMOTION_RULES)
  })

  it('carries no worked example: the slot exemplar is the only design shown (decision 386)', () => {
    const text = buildGraphicRequest(input()).system
    expect(text).not.toContain('Example 1, a text-only beat')
    expect(text).not.toContain('Example 2, a chart slot')
    expect(text).not.toContain('both examples')
    expect(text).toContain('Answer with JSON only,')
  })

  it('composes for a bible that still holds the retired keys', () => {
    const old = {
      ...FIRST_CHANNEL_BIBLE,
      examples: { ...FIRST_CHANNEL_BIBLE.examples, 'graphics-worked-beat': 'old' },
    }
    expect(() =>
      buildGraphicRequest(input({ bible: { bible: old, slotIds: EXAMPLE_SLOT_IDS } })),
    ).not.toThrow()
  })

  it('writes no dash a reader would see', () => {
    expect(system).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the designer prompt reads the channel bible', () => {
  const other = buildGraphicRequest(
    input({ bible: { bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS } }),
  ).system

  it("swaps the premise, the nouns and the worked examples for the channel's own", () => {
    expect(other).toContain(
      `a documentary about ${PSYCHOLOGY_TEST_BIBLE.examples['direction-premise']!}, as a React`,
    )
    expect(other).toContain('a film about real ideas and real people')
    expect(other).toContain('A logo earns its place when the idea or person is the subject')
    expect(other).not.toContain('Wirecard')
  })
})

describe('buildGraphicRequest (decision 295)', () => {
  it('carries one exemplar of the slot technique in the slot message, after the data and before the current design (decision 305)', () => {
    const exemplar = {
      technique: 'stat-counter' as const,
      description: 'one large figure counting up to its mark, a label beneath, held',
      mechanisms: ['drum' as const, 'word-splits-open' as const],
      title: 'The 1.2bn',
      source: 'function Graphic(props) {\n  return null\n}',
    }
    const request = buildGraphicRequest(
      input({
        data: CHART_DATA,
        exemplar,
        current: { source: 'function Graphic() { return null }', title: 'Old title', motion: 1 },
      }),
    )
    const slot = request.messages[1]!.content
    expect(slot).toContain(
      "A passing design of this technique (stat-counter: one large figure counting up to its mark, a label beneath, held), in this sandbox and on the tokens, for its mechanics, its timing and its standard. It uses: drum, word splits open. Its concept came from its own narration: find this slot's own rather than reusing its layout. Its words and figures are its own; yours come from this slot and its claims:",
    )
    expect(slot).toContain('````jsx\n' + exemplar.source + '\n````')
    expect(slot.indexOf('Data (draw every point')).toBeLessThan(slot.indexOf('A passing design'))
    expect(request.messages[2]!.content).toContain('The current design')
    expect(request.messages[0]!.content).not.toContain('A passing design')
    expect(request.system).toBe(buildGraphicRequest(input()).system)
  })

  it('lists the mechanisms with their definitions and asks for the design\u2019s own (spec 2026-11-04, section 8.5)', () => {
    const system = buildGraphicRequest(input()).system
    expect(system).toContain('"mechanisms": [')
    expect(system).toContain('- persistent-actor, persistent actor: ')
    expect(system).toContain('- camera-push, camera push: ')
    expect(system).toContain('at most 6')
  })

  it('sends no block when no exemplar is given', () => {
    const request = buildGraphicRequest(input())
    expect(request.messages[1]!.content).not.toContain('A passing design')
    expect(request.messages).toHaveLength(2)
  })

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
          motion: 1,
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
    expect(contents[2]).not.toContain('written before the motion tokens')
    expect(contents[3]).toBe(
      'Your previous answer for this slot was refused: nothing changes between 1.0 s and 8.0 s. Answer again with that fixed.',
    )
    expect(contents[4]).toBe("The producer's steer: Make the number bigger.")
  })

  it('tells a redesign of a design stored before the tokens to move it onto them (decision 301)', () => {
    const request = buildGraphicRequest(
      input({
        current: { title: 'Old title', source: 'function Graphic(props) {\n  return null\n}' },
      }),
    )
    expect(request.messages[2]!.content).toBe(
      'The current design, which the producer wants changed:\nTitle: Old title\n```jsx\nfunction Graphic(props) {\n  return null\n}\n```\nThis design was written before the motion tokens: move every curve onto motion.ease, every spring onto motion.spring, and every length onto motion.ms, keeping what the producer has not asked to change.',
    )
  })
})

describe('the review (decision 389)', () => {
  const design = {
    concept: 'the count is the story',
    storyboard: ['0.3 s the figure counts up'],
    title: 'Raised in one round',
    facts: [{ text: '$4bn', claim: 1 }],
    source: 'function Graphic(props) {\n  return null\n}',
  }
  const frames = [
    { label: '16:9 at 0.9 s', image: { mimeType: 'image/jpeg' as const, data: 'AAAA' } },
    { label: '9:16 at 5.9 s', image: { mimeType: 'image/jpeg' as const, data: 'BBBB' } },
  ]

  it("shares the design's cached start, drops the old design and the refusal, and ends on the frames", () => {
    const base = input({
      current: { source: 'function Graphic() { return null }', title: 'Old', motion: 1 },
      rejection: 'refused once',
      guidance: 'Bigger type.',
    })
    const review = buildGraphicReviewRequest(base, design, frames)
    const design0 = buildGraphicRequest(base)
    expect(review.system).toBe(design0.system)
    expect(review.cacheablePrefixMessages).toBe(1)
    expect(review.messages[0]).toEqual(design0.messages[0])
    const texts = review.messages.map((message) => message.content).join('\n')
    expect(texts).not.toContain('The current design')
    expect(texts).not.toContain('refused once')
    expect(texts).toContain("The producer's steer: Bigger type.")
    const last = review.messages.at(-1)!
    expect(last.images).toEqual(frames.map((frame) => frame.image))
    expect(last.content).toContain('Frame 1: 16:9 at 0.9 s\nFrame 2: 9:16 at 5.9 s')
    expect(last.content).toContain('"concept": "the count is the story"')
    expect(last.content).toContain('answer {"keep": true} and nothing else')
  })

  it('reads a keep, and reads anything else as a whole design', () => {
    expect(parseGraphicReview('{"keep": true}')).toEqual({ keep: true })
    expect(parseGraphicReview(JSON.stringify(design))).toEqual({ keep: false, design })
    expect(() => parseGraphicReview('{"keep": false}')).toThrow(/^The graphic answer is malformed/)
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

  it('reads a concept and a storyboard when the answer carries them (decision 388)', () => {
    const planned = {
      concept: 'the sentence parts and the figure rises out of it',
      storyboard: ['0.0 s the rule draws', '2.0 s "1.2bn": the figure rises out of the gap'],
      ...ANSWER,
    }
    expect(parseGraphicCode(JSON.stringify(planned))).toEqual(planned)
  })

  it('drops an unknown mechanism with a note and caps the rest at six', () => {
    const notes: Repair[] = []
    const parsed = parseGraphicCode(
      JSON.stringify({
        ...ANSWER,
        mechanisms: [
          'persistent-actor',
          'jazz-hands',
          'docking',
          'drum',
          'reel',
          'draw-on',
          'tally',
          'door',
        ],
      }),
      (repair) => notes.push(repair),
    )
    expect(parsed.mechanisms).toEqual([
      'persistent-actor',
      'docking',
      'drum',
      'reel',
      'draw-on',
      'tally',
    ])
    expect(notes.map((n) => n.action)).toEqual(['dropped', 'capped'])
    expect(parseGraphicCode(JSON.stringify(ANSWER)).mechanisms).toBeUndefined()
  })

  it('trims an over-long concept and storyboard and caps the storyboard, saying so (decision 388)', () => {
    const repairs: Repair[] = []
    const parsed = parseGraphicCode(
      JSON.stringify({
        ...ANSWER,
        concept: 'a sentence that parts '.repeat(12),
        storyboard: Array.from({ length: 20 }, (_, index) =>
          index === 0 ? 'x'.repeat(260) : `${index}.0 s a change`,
        ),
      }),
      (repair) => repairs.push(repair),
    )
    expect(parsed.concept!.length).toBeLessThanOrEqual(200)
    expect(parsed.storyboard).toHaveLength(16)
    expect(parsed.storyboard![0]!.length).toBeLessThanOrEqual(200)
    expect(repairs).toEqual([
      { action: 'capped', field: "the graphic's storyboard", kept: 16 },
      { action: 'trimmed', field: "the graphic's concept" },
      { action: 'trimmed', field: 'a storyboard line' },
    ])
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
