import { MANIFEST, entryFromProposal } from '@boom-busters/providers'
import type { ExemplarPlan } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { DENSE_SHOTS_MAX, denseMoments } from './graphic-code/frames'
import {
  derivedBrief,
  derivedContext,
  derivedSlot,
  planBounds,
  planOfDesign,
  planSteer,
  refineSteer,
  storyboardMoments,
} from './exemplar-derive'

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const bar = MANIFEST.find((entry) => entry.id === 'bar-chart')!

const PLAN: ExemplarPlan = {
  slot: {
    intent: 'The 40 minutes is the whole story of the night.',
    words: [
      { text: 'She', atMs: 200 },
      { text: 'slept', atMs: 650 },
      { text: '40', atMs: 1100 },
      { text: 'minutes', atMs: 1550 },
      { text: 'and', atMs: 2000 },
      { text: 'lost', atMs: 2450 },
      { text: '$2bn', atMs: 2900 },
    ],
  },
  concept: 'the sentence parts for the figure',
  storyboard: ['0.0 s the sentence lands', '2.0 s the figure rises', '4.5 s the rule fills'],
  mechanisms: ['word-splits-open', 'drum'],
  leansOn: [{ title: 'Numeral over a changing background', why: 'the held numeral' }],
}

describe('the derived slot (spec 2026-11-04, section 9.2)', () => {
  it('derives one claim per figure the plan speaks and per charted point', () => {
    const context = derivedContext(stat, PLAN)
    expect(context.claims.map((claim) => claim.text)).toEqual([
      'The figure is 40.',
      'The figure is $2bn.',
    ])
    expect(context.chapterTitle).toBe('stat-counter')
    expect(context.paragraphs).toEqual([])
    const chartPlan: ExemplarPlan = {
      ...PLAN,
      slot: {
        ...PLAN.slot,
        data: {
          series: [
            {
              label: 'Hours slept',
              unit: 'h',
              points: [
                { x: '2019', y: 7 },
                { x: '2020', y: 5 },
              ],
            },
          ],
          takeaway: 'down',
        },
      },
    }
    const chartContext = derivedContext(bar, chartPlan)
    expect(chartContext.claims.map((claim) => claim.text)).toContain('In 2019 the value was 7 h.')
  })

  it("the brief carries the plan's intent, words and data", () => {
    const context = derivedContext(stat, PLAN)
    const brief = derivedBrief(stat, PLAN, context)
    expect(brief.type).toBe('graphic')
    if (brief.type === 'graphic') {
      expect(brief.intent).toBe(PLAN.slot.intent)
      expect(brief.coversText).toBe('She slept 40 minutes and lost $2bn')
      expect(brief.intentClaimIds).toEqual(context.claims.map((claim) => claim.id))
    }
    const slot = derivedSlot(stat, PLAN, context)
    expect(slot).toMatchObject({
      chapterId: 'exemplar',
      startMs: 0,
      durationMs: stat.slot.durationMs,
    })
    expect(slot.brief).toEqual(brief)
    expect(planBounds(stat)).toEqual({
      durationMs: stat.slot.durationMs,
      wordCount: stat.slot.words.length,
    })
    expect(planBounds(bar)).toEqual({
      durationMs: bar.slot.durationMs,
      wordCount: bar.slot.words.length,
      chart: { series: 1, points: bar.slot.data!.series[0]!.points.length },
    })
  })

  it('storyboardMoments takes four shots a frame apart from each timed line, inside the slot, at most 24', () => {
    expect(storyboardMoments(PLAN.storyboard, 6000)).toEqual([
      0, 42, 83, 125, 2000, 2042, 2083, 2125, 4500, 4542, 4583, 4625,
    ])
    expect(storyboardMoments(['5.95 s the end'], 6000)).toEqual([5950, 5992])
    const many = Array.from({ length: 10 }, (_, i) => `${i * 0.5} s beat ${i}`)
    expect(storyboardMoments(many, 6000)).toHaveLength(DENSE_SHOTS_MAX)
    expect(storyboardMoments(['2 s twice', '2.0 s again'], 6000)).toEqual([2000, 2042, 2083, 2125])
  })

  it('falls back to the even set when no line is timed', () => {
    expect(storyboardMoments(['the sentence lands', 'the figure rises'], 6000)).toEqual(
      denseMoments(6000),
    )
  })

  it('the plan steer carries the plan and asks the build to keep to it', () => {
    const steer = planSteer(PLAN)
    expect(steer).toContain(
      'The plan to build, as agreed: concept the sentence parts for the figure',
    )
    expect(steer).toContain('1. 0.0 s the sentence lands')
    expect(steer).toContain('built on: word splits open, drum')
    expect(steer).toContain('Keep to it.')
  })

  it("the refine's steer leads, the plan is context, and the steer wins where they disagree", () => {
    const refined = refineSteer('slower', PLAN)
    // The request writes "The producer's steer: " itself, so the text opens on the owner's words.
    expect(refined.startsWith('slower\nApply every part of the steer.\n')).toBe(true)
    expect(refined).not.toContain("The producer's steer:")
    expect(refined).toContain(
      'The design was built to this plan: concept the sentence parts for the figure. Storyboard: 1. 0.0 s the sentence lands 2. 2.0 s the figure rises 3. 4.5 s the rule fills; built on: word splits open, drum.',
    )
    expect(refined).not.toContain('Keep to it.')
    expect(
      refined.endsWith(
        'Where the steer and the plan disagree, the steer wins. Change nothing the steer does not name: everything else is kept exactly as it is.',
      ),
    ).toBe(true)
  })

  it("carries the version's layout refusal with the refine's steer (decision 445)", () => {
    const refused = 'at 5.4 s in landscape, "LOSS" is set at 25 px'
    const refined = refineSteer('slower', PLAN, refused)
    expect(
      refined.startsWith(
        `slower\nApply every part of the steer. The layout check refused the version this refines: ${refused}. Fix that too.\n`,
      ),
    ).toBe(true)
    expect(refineSteer('slower', PLAN, null)).toBe(refineSteer('slower', PLAN))
  })

  it("a refined version's plan takes the design's concept, storyboard and mechanisms, keeping the slot and the references", () => {
    const written = {
      concept: 'the bars alone',
      storyboard: ['0.0 s the first bar rises'],
      mechanisms: ['drum' as const],
    }
    expect(planOfDesign(PLAN, written)).toEqual({ ...PLAN, ...written })
    // A design that wrote no plan of its own leaves the plan as it was.
    expect(planOfDesign(PLAN, {})).toEqual(PLAN)
    expect(planOfDesign(PLAN, { storyboard: [] })).toEqual(PLAN)
  })

  it('writes no dash', () => {
    expect(planSteer(PLAN) + refineSteer('x', PLAN)).not.toMatch(/[–—]/)
  })

  it("a proposal's entry derives a graphic brief with its own slot (spec 8.5)", () => {
    const entry = entryFromProposal({
      key: 'ledger-wipe',
      name: 'Ledger wipe',
      description: 'a ruled line wipes the old figure away',
      steerPhrases: ['ledger wipe'],
      mechanisms: ['persistent-actor'],
      slot: {
        durationMs: 8000,
        words: [
          { text: 'The', atMs: 200 },
          { text: 'figure', atMs: 650 },
        ],
        intent: 'The old figure is gone.',
      },
      fromReference: 'Ledger scene',
    })
    const plan: ExemplarPlan = { ...PLAN, slot: { intent: 'gone', words: [...entry.slot.words] } }
    const context = derivedContext(entry, plan)
    expect(context.chapterTitle).toBe('ledger-wipe')
    const brief = derivedBrief(entry, plan, context)
    expect(brief.type).toBe('graphic')
    expect(brief.description).toBe('a ruled line wipes the old figure away')
    expect(derivedSlot(entry, plan, context).durationMs).toBe(8000)
    expect(planBounds(entry)).toEqual({ durationMs: 8000, wordCount: 2 })
  })
})
