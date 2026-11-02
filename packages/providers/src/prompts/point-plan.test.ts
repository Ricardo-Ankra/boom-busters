import { FIRST_CHANNEL_IN_USE, SHORT_RULES, ValidationError } from '@boom-busters/schemas'
import type { PointScript } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildPointPlanRequest, mockPointPlan, parsePointPlan } from './point-plan'
import type { PlanLibraryEntry } from './point-plan'
import type { Note, Repair } from './repair'

const script: PointScript = {
  title: 'The missing billion',
  paragraphs: [
    { phase: 'hook', text: 'A billion euros, and no trace of it.', chapterIndex: 0 },
    { phase: 'stakes', text: 'The auditors could not find the money.', chapterIndex: 0 },
    { phase: 'delivery', text: 'The shares collapsed in nine days.', chapterIndex: 1 },
    { phase: 'resolution', text: 'It never existed in the first place.', chapterIndex: 1 },
    { phase: 'bridge', text: 'Tap the linked video below.', chapterIndex: 2 },
  ],
}
const words = Array.from({ length: 30 }, (_, i) => ({
  index: i,
  text: `w${i}`,
  startMs: i * 400,
}))
const library: PlanLibraryEntry[] = [
  {
    ref: 0,
    type: 'headline',
    payloadKind: 'headline',
    covered: 'The auditors found nothing.',
    brief: 'A bold headline about the missing cash',
    chapterIndex: 0,
  },
  {
    ref: 1,
    type: 'archival',
    payloadKind: 'archival',
    covered: 'The shares collapsed.',
    brief: 'A trading floor in panic',
    chapterIndex: 1,
  },
]
const collect = () => {
  const notes: Repair[] = []
  const note: Note = (repair) => {
    notes.push(repair)
  }
  return { notes, note }
}
const limits = { wordCount: 30, libraryCount: 2 }
const lib = (startWord: number, ref = 0, extra: Record<string, unknown> = {}) => ({
  startWord,
  crop: 'centre',
  motion: 'kenburns-in',
  source: { kind: 'library', ref },
  ...extra,
})
const stock = (startWord: number) => ({
  startWord,
  crop: 'left',
  motion: 'static',
  source: { kind: 'stock', query: 'trading floor' },
})
const still = (startWord: number) => ({
  startWord,
  crop: 'right',
  motion: 'punch',
  source: { kind: 'still', prompt: 'Vertical 9:16 frame, a vault door ajar' },
})
const plan = (shots: unknown[]) => JSON.stringify({ shots })

describe('the point plan request', () => {
  const r = buildPointPlanRequest({
    bible: FIRST_CHANNEL_IN_USE,
    script,
    words,
    library,
    sourceChapters: [0, 1],
    note: 'Keep the cuts tight on the hook',
  })
  const text = [r.system, ...r.messages.map((m) => m.content)].join('\n').replace(/\s+/g, ' ')

  it('carries the library numbers, the word times and the note', () => {
    expect(text).toContain('The auditors found nothing.')
    expect(text).toContain('A trading floor in panic')
    expect(text).toMatch(/\b1\b.*headline/)
    expect(text).toMatch(/\b2\b.*archival/)
    expect(text).toContain('w29')
    expect(text).toContain('11.6')
    expect(text).toContain('Keep the cuts tight on the hook')
    expect(text).toContain('0, 1')
  })

  it('states the pacing numbers from the rule book in seconds', () => {
    expect(text).toContain('1.5')
    expect(text).toContain('2.5')
    expect(text).toContain('3.5')
    expect(text).toContain('4.5')
    expect(text).toContain('1.2')
    expect(text).toContain(String(SHORT_RULES.newImagesMax))
    expect(text).toContain('9:16')
    expect(text).toContain('opening words')
  })

  it('leaves the note out when there is none', () => {
    const none = buildPointPlanRequest({
      bible: FIRST_CHANNEL_IN_USE,
      script,
      words,
      library,
      sourceChapters: [0],
      note: null,
    })
    expect(none.messages.map((m) => m.content).join('\n')).not.toContain('Keep the cuts')
  })
})

describe('parsePointPlan', () => {
  it('reads a valid plan', () => {
    const shots = parsePointPlan(plan([lib(0), stock(5), still(10), lib(15, 1)]), limits)
    expect(shots).toHaveLength(4)
    expect(shots[0]).toEqual({
      startWord: 0,
      crop: 'centre',
      motion: 'kenburns-in',
      source: { kind: 'library', ref: 0 },
    })
    expect(shots[1]!.source).toEqual({ kind: 'stock', query: 'trading floor' })
  })

  it('refuses a library number outside the list, never clamping it', () => {
    expect(() => parsePointPlan(plan([lib(0), lib(5, 2)]), limits)).toThrow(ValidationError)
    expect(() => parsePointPlan(plan([lib(0), lib(5, -1)]), limits)).toThrow(ValidationError)
  })

  it('refuses a startWord beyond the words, never clamping it', () => {
    expect(() => parsePointPlan(plan([lib(0), lib(30)]), limits)).toThrow(ValidationError)
    expect(() => parsePointPlan(plan([lib(0), lib(99)]), limits)).toThrow(ValidationError)
  })

  it('refuses start words that do not increase', () => {
    expect(() => parsePointPlan(plan([lib(0), lib(8), lib(8)]), limits)).toThrow(ValidationError)
    expect(() => parsePointPlan(plan([lib(0), lib(8), lib(4)]), limits)).toThrow(ValidationError)
  })

  it('refuses a first shot that is not at word 0', () => {
    expect(() => parsePointPlan(plan([lib(2), lib(8)]), limits)).toThrow(ValidationError)
  })

  it('refuses an empty plan, a bad crop and a malformed answer', () => {
    expect(() => parsePointPlan(plan([]), limits)).toThrow(ValidationError)
    expect(() => parsePointPlan(plan([lib(0, 1, { crop: 'top' })]), limits)).toThrow(
      ValidationError,
    )
    expect(() => parsePointPlan('no json here', limits)).toThrow(ValidationError)
  })

  it('drops new shots over the cap, latest first, with a note', () => {
    const { notes, note } = collect()
    const shots = parsePointPlan(
      plan([lib(0), stock(3), still(6), stock(9), still(12), lib(15, 1), stock(18), stock(21)]),
      limits,
      note,
    )
    expect(shots.map((s) => s.startWord)).toEqual([0, 3, 6, 9, 12, 15])
    expect(shots.filter((s) => s.source.kind !== 'library')).toHaveLength(SHORT_RULES.newImagesMax)
    expect(notes).toHaveLength(2)
    expect(notes.every((n) => n.action === 'dropped')).toBe(true)
  })

  it('does not drop when the cap is met exactly', () => {
    const { notes, note } = collect()
    const shots = parsePointPlan(
      plan([lib(0), stock(3), still(6), stock(9), still(12)]),
      limits,
      note,
    )
    expect(shots).toHaveLength(5)
    expect(notes).toHaveLength(0)
  })
})

describe('mockPointPlan', () => {
  const check = (
    shots: ReturnType<typeof mockPointPlan>,
    wordCount: number,
    libraryCount: number,
  ) => parsePointPlan(JSON.stringify({ shots }), { wordCount, libraryCount })

  it('plans a shot every 5 words, round-robin, punching first, with one still', () => {
    const shots = mockPointPlan(words, library)
    expect(shots.map((s) => s.startWord)).toEqual([0, 5, 10, 15, 20, 25])
    expect(shots[0]!.motion).toBe('punch')
    expect(shots.filter((s) => s.source.kind === 'still')).toHaveLength(1)
    // the still takes the second shot's turn in the round-robin
    expect(shots.map((s) => (s.source.kind === 'library' ? s.source.ref : -1))).toEqual([
      0, -1, 0, 1, 0, 1,
    ])
    expect(check(shots, 30, 2)).toEqual(shots)
    expect(mockPointPlan(words, library)).toEqual(shots)
  })

  it('copes with a library of one entry', () => {
    const shots = mockPointPlan(words, [library[0]!])
    expect(check(shots, 30, 1)).toEqual(shots)
  })

  it('copes with fewer than 5 words', () => {
    const shots = mockPointPlan(words.slice(0, 3), library)
    expect(shots).toHaveLength(1)
    expect(shots[0]!.startWord).toBe(0)
    expect(check(shots, 3, 2)).toEqual(shots)
  })
})
