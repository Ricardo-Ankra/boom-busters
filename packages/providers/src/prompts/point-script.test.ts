import {
  FIRST_CHANNEL_IN_USE,
  SHORT_PHASES,
  SHORT_RULES,
  ValidationError,
  countWords,
  pointScriptIssues,
} from '@boom-busters/schemas'
import type { TalkingPoint } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildPointScriptRequest, mockPointScript, parsePointScript } from './point-script'
import type { Note, Repair } from './repair'

const chapters = [
  { index: 0, title: 'The audit', contentMd: 'By June, the auditors could not find the money.' },
  { index: 1, title: 'The collapse', contentMd: 'The shares collapsed in nine days.' },
  { index: 2, title: 'The trial', contentMd: 'The court heard the accounts were falsified.' },
]
const point: TalkingPoint = {
  id: '01ABCDEFGHJKMNPQRSTVWXYZ01',
  type: 'forensic-breakdown',
  title: 'The missing billion',
  question: 'Where did the billion go?',
  payoff: 'It never existed in the first place.',
  bridge: 'The trial shows how the accounts were built.',
  bridgeChapters: [2],
  sourceChapters: [0, 1],
  hook: 'A billion euros, and no trace of it.',
  order: 1,
}
const paragraphs = (over: Record<string, unknown> = {}) =>
  SHORT_PHASES.map((phase, i) => ({
    phase,
    text: `This is the ${phase} paragraph of the Short, said plainly.`,
    chapterIndex: i % 3,
    ...over,
  }))
const script = (ps: unknown[] = paragraphs()) =>
  JSON.stringify({ title: 'The missing billion', paragraphs: ps })
const collect = () => {
  const notes: Repair[] = []
  const note: Note = (repair) => {
    notes.push(repair)
  }
  return { notes, note }
}
const flat = (ctaLine: string | null) => {
  const r = buildPointScriptRequest({
    bible: FIRST_CHANNEL_IN_USE,
    caseTitle: 'Wirecard',
    point,
    chapters,
    ctaLine,
  })
  return [r.system, ...r.messages.map((m) => m.content)].join('\n').replace(/\s+/g, ' ')
}

describe('the point script request', () => {
  it('states the phases, the limits and the rules', () => {
    const text = flat(null)
    for (const phase of SHORT_PHASES) expect(text).toContain(phase.toUpperCase())
    expect(text).toContain(`${SHORT_RULES.wordsMin} to ${SHORT_RULES.wordsMax} words`)
    expect(text).toContain('Every fact')
    expect(text).toContain('only what')
    expect(text).toContain('never ask')
    expect(text).toContain('tap the linked video below')
  })

  it('carries the point and its chapters', () => {
    const text = flat(null)
    expect(text).toContain('Where did the billion go?')
    expect(text).toContain('It never existed in the first place.')
    expect(text).toContain('The court heard the accounts were falsified.')
  })

  it('carries the CTA line when given and no CTA sentence when null', () => {
    expect(flat('Watch the full case below')).toContain('Watch the full case below')
    expect(flat(null)).not.toContain('The channel call to action')
    expect(flat('Watch the full case below')).toContain('The channel call to action')
  })
})

describe('parsePointScript', () => {
  it('reads a valid five-phase script, noting nothing', () => {
    const { notes, note } = collect()
    const parsed = parsePointScript(script(), 3, note)
    expect(parsed.paragraphs).toHaveLength(5)
    expect(notes).toEqual([])
  })

  it('refuses a script with no bridge', () => {
    const noBridge = [...paragraphs().slice(0, 4), paragraphs()[3]!]
    expect(() => parsePointScript(script(noBridge), 3)).toThrow(/no bridge paragraph/)
    expect(() => parsePointScript(script(noBridge), 3)).toThrow(ValidationError)
  })

  it('refuses a chapter the film does not have', () => {
    expect(() => parsePointScript(script(paragraphs({ chapterIndex: 5 })), 3)).toThrow(
      /past the last chapter/,
    )
  })

  it('trims an over-long paragraph at a sentence, keeping its phase', () => {
    const { notes, note } = collect()
    const long = paragraphs()
    long[2] = { ...long[2]!, text: 'The money moved in small steps. '.repeat(20) }
    const parsed = parsePointScript(script(long), 3, note)
    expect(parsed.paragraphs[2]!.text.length).toBeLessThanOrEqual(400)
    expect(parsed.paragraphs[2]!.phase).toBe('delivery')
    expect(notes).toContainEqual({ action: 'trimmed', field: 'the delivery paragraph' })
  })
})

describe('mockPointScript', () => {
  it('has one paragraph per phase, 130 words, starting MOCK SHORT', () => {
    const mock = mockPointScript(point)
    expect(mock).toEqual(mockPointScript(point))
    expect(mock.paragraphs.map((p) => p.phase)).toEqual([...SHORT_PHASES])
    expect(mock.paragraphs[0]!.text.startsWith('MOCK SHORT')).toBe(true)
    expect(mock.paragraphs.reduce((n, p) => n + countWords(p.text), 0)).toBe(130)
    expect(pointScriptIssues(mock, 3)).toEqual([])
    expect(parsePointScript(JSON.stringify(mock), 3)).toEqual(mock)
  })

  it('cites the bridge chapter on the bridge paragraph', () => {
    expect(mockPointScript(point).paragraphs[4]!.chapterIndex).toBe(2)
  })
})
