import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CRITIC_AXES, DEFAULT_MOTION_IDENTITY, criticPasses } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  CRITIC_OUTPUT_TOKENS,
  buildCriticRequest,
  buildPairwiseRequest,
  mockCriticReport,
  mockCriticVerify,
  mockPairwise,
  parseCriticReport,
  parseCriticVerify,
  parsePairwise,
  type CriticInput,
  type CriticReference,
} from './critic'
import { motionIdentityBlock } from './graphics'
import type { Repair } from './repair'

/**
 * The critic (spec 2026-11-04, section 10.4): a fresh judge on its own
 * route, shown the plan, the measured motion, the browser's findings, the
 * channel's look references, the contact sheets and the rest frames, and
 * asked for five scores, the defects, three fixes and a keep.
 */

const image = (data: string) => ({ mimeType: 'image/jpeg' as const, data })

const REF_A: CriticReference = {
  title: 'Kaye reel',
  purpose: 'look',
  carryOver: 'one actor carries the change',
  image: image('DDDD'),
}
const REF_B: CriticReference = {
  title: 'Board still',
  purpose: 'look',
  carryOver: 'heavy type on dark',
  image: image('EEEE'),
}
const SHEET_L = image('AAAA')
const SHEET_P = image('BBBB')
const FRAME = { label: '16:9 at 1.6 s', image: image('CCCC') }

const INPUT: CriticInput = {
  motion: DEFAULT_MOTION_IDENTITY,
  plan: {
    title: 'The fall',
    concept: 'the floor gives way',
    storyboard: ['0.0 s the baseline draws', '2.0 s "2019": the first point lands'],
    facts: [{ text: '2022', claim: 1 }],
    mechanisms: ['rise-from-baseline'],
  },
  slot: {
    durationMs: 6000,
    intent: 'The fall from 104.5 to 1.28 euros in nine days is the story.',
    words: [
      { text: 'The', offsetMs: 0 },
      { text: 'share', offsetMs: 300 },
    ],
  },
  metrics: {
    frozenMs: 1000,
    longestFrozenMs: 500,
    frozenCritical: false,
    simultaneity: 0.75,
    holdAfterLastMs: 1000,
    speedProfile: [
      { atMs: 500, change: 0 },
      { atMs: 1000, change: 30 },
    ],
  },
  findings: ['while moving, at 1.3 s in landscape, "a" and "b" overlap'],
  sheets: { landscape: SHEET_L, portrait: SHEET_P },
  frames: [FRAME],
  references: [REF_A, REF_B],
}

const REPORT = {
  scores: Object.fromEntries(
    CRITIC_AXES.map((axis) => [axis, { score: 8, line: `${axis} fine` }]),
  ) as Record<(typeof CRITIC_AXES)[number], { score: number; line: string }>,
  defects: [{ atMs: 1350, orientation: 'landscape' as const, text: 'the lines cross' }],
  fixes: ['bigger type', 'hold the end'],
  mechanisms: [{ key: 'rise-from-baseline' as const, present: true }],
  keep: false,
}

describe('buildCriticRequest (spec 10.4)', () => {
  it('runs on the critic route with a cached head, the material, then the images and the ask', () => {
    const request = buildCriticRequest(INPUT)
    expect(request.task).toBe('critic')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.maxTokens).toBeGreaterThanOrEqual(CRITIC_OUTPUT_TOKENS)
    expect(request.messages).toHaveLength(3)
    const [head, material, ask] = request.messages
    expect(head!.content).toContain(motionIdentityBlock(INPUT.motion))
    expect(head!.content).toContain('persistent actor: ')
    expect(head!.images).toBeUndefined()
    expect(material!.content).toContain('"concept": "the floor gives way"')
    expect(material!.content).toContain('Longest frozen run 500 ms (limit 6000 ms)')
    expect(material!.content).toContain('75% of the change inside one 250 ms window')
    expect(material!.content).toContain('1. while moving, at 1.3 s')
    expect(material!.content).toContain('0.3 s "share"')
    expect(material!.images).toBeUndefined()
    expect(ask!.images).toEqual([REF_A.image, REF_B.image, SHEET_L, SHEET_P, FRAME.image])
    expect(ask!.content).toMatch(/Reference 1: Kaye reel \(look\): one actor carries the change/)
    expect(ask!.content).toMatch(/Reference 2: Board still \(look\): heavy type on dark/)
    expect(ask!.content).toContain('Contact sheet 16:9')
    expect(ask!.content).toContain('Contact sheet 9:16')
    expect(ask!.content).toContain('Frame 1: 16:9 at 1.6 s')
    expect(request.system).toContain('"keep": true')
    expect(request.system).toContain('engagement')
    expect(request.system).toContain('at or above 8')
  })

  it('says when nothing was measured and nothing was found', () => {
    const request = buildCriticRequest({
      ...INPUT,
      metrics: null,
      findings: [],
      references: [],
      sheets: {},
    })
    expect(request.messages[1]!.content).toContain('No motion was measured.')
    expect(request.messages[1]!.content).toContain(
      'The browser found nothing wrong at rest or in flight.',
    )
    expect(request.messages[2]!.images).toEqual([FRAME.image])
    expect(request.messages[2]!.content).not.toContain('Reference 1')
    expect(request.messages[2]!.content).not.toContain('Contact sheet')
  })

  it('flags a frozen run past the still limit', () => {
    const request = buildCriticRequest({
      ...INPUT,
      metrics: { ...INPUT.metrics!, longestFrozenMs: 7000, frozenCritical: true },
    })
    expect(request.messages[1]!.content).toContain(
      'Longest frozen run 7000 ms (limit 6000 ms), past the limit',
    )
  })

  it('writes no dash a reader would see', () => {
    const request = buildCriticRequest(INPUT)
    for (const text of [request.system, ...request.messages.map((m) => m.content)]) {
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

describe('parseCriticReport', () => {
  it('reads a full report', () => {
    expect(parseCriticReport(JSON.stringify(REPORT))).toEqual(REPORT)
  })

  it('caps four fixes at three with a note and drops an unknown mechanism', () => {
    const notes: Repair[] = []
    const parsed = parseCriticReport(
      JSON.stringify({
        ...REPORT,
        fixes: ['a', 'b', 'c', 'd'],
        mechanisms: [
          { key: 'drum', present: true },
          { key: 'jazz-hands', present: false },
        ],
      }),
      (repair) => notes.push(repair),
    )
    expect(parsed.fixes).toEqual(['a', 'b', 'c'])
    expect(parsed.mechanisms).toEqual([{ key: 'drum', present: true }])
    expect(notes.map((n) => n.action)).toEqual(['capped', 'dropped'])
  })

  it('trims a long line and caps the defects at eight', () => {
    const notes: Repair[] = []
    const parsed = parseCriticReport(
      JSON.stringify({
        ...REPORT,
        scores: { ...REPORT.scores, craft: { score: 9, line: 'x'.repeat(300) } },
        defects: Array.from({ length: 9 }, () => REPORT.defects[0]),
      }),
      (repair) => notes.push(repair),
    )
    expect(parsed.scores.craft.line.length).toBeLessThanOrEqual(200)
    expect(parsed.defects).toHaveLength(8)
  })

  it('reads the frame names as the pictures were labelled, rounds, and drops a defect it cannot place (final review, issue 5)', () => {
    const notes: Repair[] = []
    const parsed = parseCriticReport(
      JSON.stringify({
        ...REPORT,
        scores: { ...REPORT.scores, craft: { score: 7.6, line: 'rounded' } },
        defects: [
          { atMs: 1350.4, orientation: '16:9', text: 'the lines cross' },
          { atMs: 5900, orientation: '9:16', text: 'the end fades' },
          { atMs: 100, orientation: 'sideways', text: 'nowhere' },
          { atMs: -5, orientation: 'landscape' },
        ],
        mechanisms: Array.from({ length: 8 }, (_, i) => ({
          key: ['drum', 'reel', 'door', 'tally', 'docking', 'draw-on', 'hard-cut', 'camera-push'][
            i
          ],
          present: true,
        })),
      }),
      (repair) => notes.push(repair),
    )
    expect(parsed.scores.craft.score).toBe(8)
    expect(parsed.defects).toEqual([
      { atMs: 1350, orientation: 'landscape', text: 'the lines cross' },
      { atMs: 5900, orientation: 'portrait', text: 'the end fades' },
    ])
    expect(parsed.mechanisms).toHaveLength(6)
    expect(notes.filter((n) => n.action === 'dropped')).toHaveLength(2)
    expect(notes.some((n) => n.action === 'capped')).toBe(true)
  })

  it('refuses a report missing an axis or scored past ten', () => {
    expect(() =>
      parseCriticReport(
        JSON.stringify({
          ...REPORT,
          scores: { ...REPORT.scores, craft: { score: 11, line: 'x' } },
        }),
      ),
    ).toThrow(/^The critic report is malformed/)
    const { craft: _craft, ...four } = REPORT.scores
    expect(() => parseCriticReport(JSON.stringify({ ...REPORT, scores: four }))).toThrow(
      /^The critic report is malformed/,
    )
    expect(() => parseCriticReport('Looks fine to me.')).toThrow()
    expect(() => parseCriticReport('{"keep": true}')).toThrow(/^The critic report is malformed/)
  })
})

describe('mockCriticReport', () => {
  it('passes, marks every line, names the plan’s mechanisms present, and equals the fixture', () => {
    const mock = mockCriticReport({ title: 'The fall', facts: [], mechanisms: ['drum'] })
    expect(criticPasses(mock)).toBe(true)
    expect(mock.keep).toBe(true)
    expect(mock.scores.engagement.line).toMatch(/^\[mock\]/)
    expect(mock.mechanisms).toEqual([{ key: 'drum', present: true }])
    expect(mock).toEqual(
      JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'critic-report.json'), 'utf8')),
    )
  })
})

describe('motionIdentityBlock', () => {
  it('says the identity whole, house values included, for a prompt that has no craft section', () => {
    const block = motionIdentityBlock(DEFAULT_MOTION_IDENTITY)
    expect(block).toContain("This channel's motion:")
    expect(block).toContain('The curves are soft')
    expect(block).toContain('Things arrive by rise')
    expect(block).toContain('Something changes about every 1.5 s')
    expect(block).toContain('Nothing may stay still longer than 6 s')
    expect(block).toContain('Never: ')
    expect(block).not.toMatch(/[–—]/)
    const guided = motionIdentityBlock({
      ...DEFAULT_MOTION_IDENTITY,
      styleGuideMd: 'Slow and dark.',
    })
    expect(guided).toContain('Slow and dark.')
  })
})

describe('the previous version, verify and pairwise (spec 9.2, steps 4 and 7)', () => {
  const PREVIOUS = {
    sheets: { landscape: image('EEEE'), portrait: image('FFFF') },
    label: 'round 1',
  }

  it("shows the previous version's sheets after the design's and asks which it prefers", () => {
    const request = buildCriticRequest({ ...INPUT, previous: PREVIOUS })
    const ask = request.messages[2]!
    const images = ask.images ?? []
    // The references, the two sheets, the frame, then the previous version's two sheets.
    expect(images).toHaveLength(7)
    expect(images.slice(-2).map((i) => i.data)).toEqual(['EEEE', 'FFFF'])
    expect(ask.content).toContain('Previous version (B), 16:9')
    expect(ask.content).toContain('the design under review is A')
    expect(ask.content).toContain('"prefers"')
    expect(request.messages[0]!.content).toBe(buildCriticRequest(INPUT).messages[0]!.content)
    expect(buildCriticRequest(INPUT).messages[2]!.content).not.toContain('"prefers"')
  })

  it('asks the verify question with the prior defects numbered', () => {
    const prior = {
      ...REPORT,
      defects: [
        { atMs: 1350, orientation: 'landscape' as const, text: 'the label clips' },
        { atMs: 2000, orientation: 'portrait' as const, text: 'the figure is small' },
      ],
    }
    const request = buildCriticRequest({
      ...INPUT,
      verify: { prior, brief: "The producer's steer: slower." },
    })
    const ask = request.messages[2]!.content
    expect(ask).toContain("The producer's steer: slower.")
    expect(ask).toContain('1. at 1.4 s in landscape: the label clips')
    expect(ask).toContain('2. at 2.0 s in portrait: the figure is small')
    expect(ask).toContain('"priorDefects"')
    expect(ask).toContain('"verdict"')
    expect(request.task).toBe('critic')
  })

  it('leaves the critic room to think over its pictures and still answer (decision 450)', () => {
    // Sonnet 5 thinks unless told not to, and spent all of 5,500 tokens
    // thinking over the sheets in production; the designer's 16,000 fits the
    // same 300 s step.
    expect(buildCriticRequest(INPUT).maxTokens).toBe(16_000)
    expect(buildCriticRequest({ ...INPUT, strong: true }).maxTokens).toBe(16_000)
    const pairwise = buildPairwiseRequest({
      motion: INPUT.motion,
      plan: INPUT.plan,
      a: { landscape: SHEET_L, portrait: SHEET_P },
      b: PREVIOUS.sheets,
    })
    expect(pairwise.maxTokens).toBe(16_000)
  })

  it('runs on the graphics route when strong', () => {
    expect(buildCriticRequest({ ...INPUT, strong: true }).task).toBe('graphics')
  })

  it('the pairwise request carries two pairs of sheets and nothing else', () => {
    const request = buildPairwiseRequest({
      motion: INPUT.motion,
      plan: INPUT.plan,
      a: { landscape: SHEET_L, portrait: SHEET_P },
      b: PREVIOUS.sheets,
    })
    expect(request.task).toBe('critic')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]!.content).toBe(buildCriticRequest(INPUT).messages[0]!.content)
    const ask = request.messages[request.messages.length - 1]!
    expect((ask.images ?? []).map((i) => i.data)).toEqual(['AAAA', 'BBBB', 'EEEE', 'FFFF'])
    expect(ask.content).toContain('"prefers"')
    expect(ask.content).not.toContain('"scores"')
    expect(request.messages).toHaveLength(2)
  })

  it('parses a verify report and a pairwise answer, defaulting a missing verdict to one more pass', () => {
    const verify = parseCriticVerify(
      JSON.stringify({ ...REPORT, priorDefects: [{ index: 1, state: 'fixed' }], verdict: 'ready' }),
    )
    expect(verify.verdict).toBe('ready')
    expect(verify.priorDefects).toEqual([{ index: 1, state: 'fixed' }])
    const bare = parseCriticVerify(JSON.stringify(REPORT))
    expect(bare.verdict).toBe('one-more-pass')
    expect(bare.priorDefects).toEqual([])
    const prefers = Object.fromEntries(CRITIC_AXES.map((axis) => [axis, 'A']))
    expect(parsePairwise(JSON.stringify({ prefers })).craft).toBe('A')
    expect(() => parsePairwise(JSON.stringify({ prefers: { ...prefers, craft: 'C' } }))).toThrow()
    const mock = mockCriticVerify(INPUT.plan)
    expect(mock.verdict).toBe('ready')
    expect(mock.scores.craft.score).toBe(8)
    expect(mockPairwise().engagement).toBe('same')
  })
})
