import { describe, expect, it } from 'vitest'
import { narrationUnitKind, narrationUnits, SCENE_TEXT_BYTE_BUDGET } from './units'

const LIVE = { MOCK_PROVIDERS: undefined }

const chapters = [
  {
    id: 'c1',
    title: 'The audit',
    contentMd: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
  },
  { id: 'c2', title: 'The unwind', contentMd: 'Fourth paragraph.' },
]

describe('narrationUnitKind', () => {
  it('is the scene on Gemini and the paragraph everywhere else', () => {
    expect(narrationUnitKind('gemini', LIVE)).toBe('scene')
    expect(narrationUnitKind('google-cloud-tts', LIVE)).toBe('paragraph')
    expect(narrationUnitKind('elevenlabs', LIVE)).toBe('paragraph')
  })

  it('answers the same in mock mode, so dev and E2E exercise the real shape', () => {
    expect(narrationUnitKind('gemini', { MOCK_PROVIDERS: '1' })).toBe('scene')
    expect(narrationUnitKind('elevenlabs', { MOCK_PROVIDERS: '1' })).toBe('paragraph')
  })
})

describe('narrationUnits, paragraph mode', () => {
  it('is one unit per paragraph, exactly as narration always worked', () => {
    const units = narrationUnits({ provider: 'google-cloud-tts', chapters, env: LIVE })

    expect(units.map((u) => [u.chapterId, u.unitIndex, u.text])).toEqual([
      ['c1', 0, 'First paragraph.'],
      ['c1', 1, 'Second paragraph.'],
      ['c1', 2, 'Third paragraph.'],
      ['c2', 0, 'Fourth paragraph.'],
    ])
    expect(units[1]?.paragraphSpan).toEqual([1, 2])
  })
})

describe('narrationUnits, scene mode', () => {
  it('packs a chapter into one continuous unit — one request, one performance', () => {
    const units = narrationUnits({ provider: 'gemini', chapters, env: LIVE })

    expect(units).toHaveLength(2)
    expect(units[0]).toMatchObject({
      chapterId: 'c1',
      unitIndex: 0,
      text: 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.',
      paragraphSpan: [0, 3],
    })
    expect(units[1]).toMatchObject({ chapterId: 'c2', unitIndex: 0, text: 'Fourth paragraph.' })
  })

  it('splits an oversized chapter at paragraph boundaries, never inside one', () => {
    const big = 'x'.repeat(2_000)
    const oversized = [
      { id: 'c1', title: 'Long', contentMd: [big, big, 'Short tail.'].join('\n\n') },
    ]

    const units = narrationUnits({ provider: 'gemini', chapters: oversized, env: LIVE })

    expect(units).toHaveLength(2)
    expect(units[0]?.text).toBe(big)
    expect(units[0]?.paragraphSpan).toEqual([0, 1])
    expect(units[1]?.text).toBe(`${big}\n\nShort tail.`)
    expect(units[1]?.paragraphSpan).toEqual([1, 3])
    for (const unit of units) {
      expect(Buffer.byteLength(unit.text, 'utf8')).toBeLessThanOrEqual(SCENE_TEXT_BYTE_BUDGET)
    }
  })

  it('gives a single paragraph beyond the budget a unit of its own', () => {
    // A boundary inside a paragraph would be audible; an oversized request is
    // the vendor's problem to refuse, and the error will name the paragraph.
    const huge = 'y'.repeat(SCENE_TEXT_BYTE_BUDGET + 500)
    const units = narrationUnits({
      provider: 'gemini',
      chapters: [{ id: 'c1', title: 'Huge', contentMd: `Intro.\n\n${huge}\n\nOutro.` }],
      env: LIVE,
    })

    expect(units.map((u) => u.paragraphSpan)).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
    ])
    expect(units[1]?.text).toBe(huge)
  })

  it('produces nothing for an empty chapter rather than an empty unit', () => {
    expect(
      narrationUnits({
        provider: 'gemini',
        chapters: [{ id: 'c1', title: 'Empty', contentMd: '   ' }],
        env: LIVE,
      }),
    ).toEqual([])
  })

  it('is deterministic — the unit text is what fingerprints are computed from', () => {
    const a = narrationUnits({ provider: 'gemini', chapters, env: LIVE })
    const b = narrationUnits({ provider: 'gemini', chapters, env: LIVE })
    expect(a).toEqual(b)
  })
})
