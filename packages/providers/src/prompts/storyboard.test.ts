import { DEFAULT_MOTION_IDENTITY, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { MANIFEST } from '../exemplars/manifest'
import { motionIdentityBlock } from './graphics'
import {
  STORYBOARD_OUTPUT_TOKENS,
  buildStoryboardRequest,
  mockStoryboardPlan,
  parseStoryboardPlan,
  type StoryboardInput,
} from './storyboard'

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const bar = MANIFEST.find((entry) => entry.id === 'bar-chart')!

const INPUT: StoryboardInput = {
  motion: { ...DEFAULT_MOTION_IDENTITY, styleGuideMd: 'Dark, slow, one figure at a time.' },
  brand: { colors: { background: '#000', accent: '#f00' }, fonts: { display: 'Inter' } },
  entry: stat,
  house: {
    title: 'Raised in one round',
    concept: 'the sentence parts for the figure',
    storyboard: ['0.0 s the sentence lands', '1.5 s the figure rises'],
  },
  readings: [
    {
      title: 'Numeral over a changing background',
      purpose: 'look',
      negative: false,
      carryOver: 'borrow the held numeral',
      avoid: '',
      reading: {
        medium: 'flat typography',
        palette: ['#111'],
        type: 'grotesk, heavy',
        enters: 'rises',
        exits: 'cuts',
        motion: 'one numeral holds',
        absent: 'no glow',
        notes: '',
        readAt: '2026-11-04T00:00:00.000Z',
        model: 'test/model',
      },
    },
    {
      title: 'Unread one',
      purpose: 'pacing',
      negative: true,
      carryOver: 'not this pace',
      avoid: 'the jitter',
      reading: null,
    },
  ],
}

const PLAN = {
  slot: {
    intent: 'The 40 minutes is the whole story of the night.',
    words: stat.slot.words.map((word, index) => ({ text: `w${index}`, atMs: word.atMs })),
  },
  concept: 'the sentence parts for the figure',
  storyboard: ['0.0 s the sentence lands', '2.0 s the figure rises'],
  mechanisms: ['word-splits-open', 'drum'],
  leansOn: [{ title: 'Numeral over a changing background', why: 'the held numeral' }],
}

const bounds = { durationMs: stat.slot.durationMs, wordCount: stat.slot.words.length }

describe('buildStoryboardRequest (spec 2026-11-04, section 9.2, step 1)', () => {
  it('builds a graphics request with the identity cached first, the slot verbatim and the readings', () => {
    const request = buildStoryboardRequest(INPUT)
    expect(request.task).toBe('graphics')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.maxTokens).toBeGreaterThanOrEqual(STORYBOARD_OUTPUT_TOKENS)
    const head = request.messages[0]!.content
    expect(head).toContain(motionIdentityBlock(INPUT.motion).trim())
    expect(head).toContain('Dark, slow, one figure at a time.')
    const material = request.messages[1]!.content
    expect(material).toContain('stat-counter')
    expect(material).toContain(stat.description)
    expect(material).toContain('word splits open')
    expect(material).toContain('the sentence parts for the figure')
    expect(material).toContain('"The company had raised 1.2bn by the end of the year."')
    expect(material).toContain('Reference 1: "Numeral over a changing background" (look)')
    expect(material).toContain('Reference 2: "Unread one" (pacing, negative)')
    expect(material).toContain('Reading: unread.')
    expect(material).toContain('background #000')
    expect(request.system).toContain('"leansOn"')
  })

  it('names no reference image and takes none', () => {
    const request = buildStoryboardRequest(INPUT)
    expect(request.messages.every((message) => !('images' in message))).toBe(true)
  })

  it('asks a chart technique to keep its series and point counts', () => {
    const request = buildStoryboardRequest({ ...INPUT, entry: bar, house: null })
    const material = request.messages[1]!.content
    expect(material).toMatch(/1 series of 4 points/)
    expect(material).toContain('"data"')
    expect(material).toContain('No house design is stored for it.')
  })

  it('writes no dash a reader would see', () => {
    const request = buildStoryboardRequest(INPUT)
    const text = [request.system, ...request.messages.map((m) => m.content)].join('\n')
    expect(text).not.toMatch(/[–—]/)
  })

  it('retries with the rejection before the material', () => {
    const request = buildStoryboardRequest({
      ...INPUT,
      rejection: "a word sits past the slot's end",
    })
    const material = request.messages[1]!.content
    expect(material.indexOf("a word sits past the slot's end")).toBeLessThan(
      material.indexOf('stat-counter'),
    )
  })
})

describe('parseStoryboardPlan', () => {
  it('parses a plan and refuses one whose words run past the slot or whose chart lost a series', () => {
    const parsed = parseStoryboardPlan(JSON.stringify(PLAN), bounds)
    expect(parsed.mechanisms).toEqual(['word-splits-open', 'drum'])
    expect(parsed.leansOn).toHaveLength(1)
    const late = { ...PLAN, slot: { ...PLAN.slot, words: [{ text: 'late', atMs: 6000 }] } }
    expect(() => parseStoryboardPlan(JSON.stringify(late), { ...bounds, wordCount: 1 })).toThrow(
      /past the slot/,
    )
    const chart = {
      ...PLAN,
      slot: {
        ...PLAN.slot,
        data: {
          series: [
            {
              label: 'S',
              unit: 'bn',
              points: [
                { x: '2019', y: 1 },
                { x: '2020', y: 2 },
              ],
            },
          ],
          takeaway: 'up',
        },
      },
    }
    expect(() =>
      parseStoryboardPlan(JSON.stringify(chart), { ...bounds, chart: { series: 1, points: 4 } }),
    ).toThrow(/1 series of 4 points/)
    expect(() => parseStoryboardPlan('not json', bounds)).toThrow(ValidationError)
  })

  it('drops an unknown mechanism with a note and trims a long line', () => {
    const notes: string[] = []
    const loose = {
      ...PLAN,
      mechanisms: ['drum', 'jazz-hands'],
      storyboard: ['0.0 s ' + 'x'.repeat(260)],
    }
    const parsed = parseStoryboardPlan(JSON.stringify(loose), bounds, (repair) =>
      notes.push(repair.kind),
    )
    expect(parsed.mechanisms).toEqual(['drum'])
    expect(parsed.storyboard[0]!.length).toBeLessThanOrEqual(200)
    expect(notes.length).toBeGreaterThan(0)
  })

  it('the mock plan is the slot unchanged with a mock concept', () => {
    const plan = mockStoryboardPlan(stat)
    expect(plan.slot.words).toEqual(stat.slot.words.map((w) => ({ text: w.text, atMs: w.atMs })))
    expect(plan.slot.intent).toBe(stat.slot.intent)
    expect(plan.concept).toBe('[mock] the house design, unchanged')
    expect(plan.mechanisms).toEqual([...stat.mechanisms])
    expect(plan.leansOn).toEqual([])
    expect(mockStoryboardPlan(bar).slot.data).toEqual(bar.slot.data)
  })
})
