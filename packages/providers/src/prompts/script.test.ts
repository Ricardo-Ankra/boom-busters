import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildChapterRequest,
  buildOutlineRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  chapterTail,
  mockChapter,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
  scriptWordCount,
} from './script'
import type { ScriptClaim } from './script'

const claims: ScriptClaim[] = [
  {
    id: '01ABCDEFGHJKMNPQRSTVWXYZ00',
    text: 'A court found the accounts were falsified.',
    sourceUrl: 'https://example.com/judgment',
    confidence: 'sourced',
    adjudicated: true,
  },
  {
    id: '01ABCDEFGHJKMNPQRSTVWXYZ01',
    text: 'Former staff say the CEO knew.',
    sourceUrl: 'https://example.com/interview',
    confidence: 'single_source',
    adjudicated: false,
  },
]

const outline = {
  chapters: [
    { title: 'The setup', beat: 'x'.repeat(30), targetWords: 800 },
    { title: 'The turn', beat: 'y'.repeat(30), targetWords: 900 },
  ],
}

describe('buildOutlineRequest', () => {
  const request = buildOutlineRequest({
    caseTitle: 'Enron',
    dossierMd: '# Enron',
    claims,
    targetRuntimeMin: 18,
  })

  it('routes at the scripting task', () => {
    expect(request.task).toBe('scripting')
  })

  it('sizes the script from the target runtime', () => {
    // 18 minutes at 150wpm, minus pacing headroom.
    expect(request.system).toMatch(/about 2565 words/)
  })

  it('marks which claims are not adjudicated', () => {
    const content = JSON.stringify(request.messages)
    expect(content).toContain('ADJUDICATED')
    expect(content).toContain('NOT adjudicated')
  })

  it('carries the house rules against inventing facts', () => {
    expect(request.system).toMatch(/Never invent figures/)
    expect(request.system).toMatch(/Assert nothing the claim list does not support/)
  })
})

describe('buildChapterRequest', () => {
  const request = buildChapterRequest({
    caseTitle: 'Enron',
    outline,
    chapterIndex: 1,
    previousTail: 'The auditors signed it anyway.',
    claims,
  })

  it('seams onto the previous chapter', () => {
    // Without this the script reads as separate essays, each re-introducing
    // the same people.
    expect(JSON.stringify(request.messages)).toContain('The auditors signed it anyway.')
  })

  it('says it is the opening chapter when there is no tail', () => {
    const first = buildChapterRequest({
      caseTitle: 'Enron',
      outline,
      chapterIndex: 0,
      previousTail: '',
      claims,
    })
    expect(JSON.stringify(first.messages)).toContain('opening chapter')
  })

  it('shows the whole outline and marks the current chapter', () => {
    expect(JSON.stringify(request.messages)).toContain('<- writing this one')
  })

  it('puts the claim list in the cacheable prefix', () => {
    // It is the largest part of the prompt and identical for every chapter.
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages[0]?.content).toContain('A court found')
  })

  it('forbids headings but asks for narration tags inline — the text is read aloud', () => {
    expect(request.system).toMatch(/No headings/)
    expect(request.system).toMatch(/read aloud exactly as written/)
    // The reversal of the original "no stage directions" rule (decision 199):
    // Eleven v3's direction channel is inline, everything downstream reads
    // the script through stripNarrationMarkup, so drafting is where the
    // delivery belongs — not paragraph-by-paragraph repair at retake prices.
    expect(request.system).toMatch(/Place them inline/)
    expect(request.system).not.toMatch(/no stage directions/)
  })

  /**
   * The humanize block (decision 199, distilled from
   * github.com/harshaneel/humanize): the tells a listener hears — banned
   * AI vocabulary, metronomic pacing, elegant variation, symmetric
   * contrasts — are banned at drafting time. The two deliberate
   * exceptions stay: em dashes are the hesitation channel, and the legal
   * hedges are mandatory, so the block must never tell the model to cut
   * "alleged".
   */
  it('carries the humanize rules, minus the two exceptions', () => {
    expect(request.system).toContain('Sound like a person')
    expect(request.system).toMatch(/Never write: delve, leverage/)
    expect(request.system).toMatch(/Never three same-length sentences/)
    expect(request.system).toMatch(/One canonical name/)
    expect(request.system).toMatch(/not just X/)
    // The legal hedges survive hedge surgery, in so many words.
    expect(request.system).toMatch(/hard rules below are the\s+opposite of empty and are never cut/)
    // And the em dash stays a pacing lever, not a banned mark.
    expect(request.system).toMatch(/em dash or ellipsis is a hesitation/)
  })

  /**
   * The script's only consumer is a TTS narrator whose levers are the words,
   * the punctuation, and pause markup. That is drafting guidance, and drafting
   * is where it has to live — teaching it to the reviewer instead means every
   * script is written for the eye and then repaired paragraph by paragraph at
   * synthesis prices.
   */
  it('writes for the ear: punctuation as pacing, pauses as markup', () => {
    expect(request.system).toContain('Written for the ear')
    expect(request.system).toContain('[pause]')
    expect(request.system).toMatch(/contractions/i)
  })

  /**
   * A paragraph is one TTS request, so a tag standing alone as its own
   * paragraph is a request with no words — a guaranteed synthesis failure.
   * `splitParagraphs` drops such blocks as a backstop, but the drafter should
   * not write them in the first place; the old wording ("write [pause] on its
   * own") is exactly what taught it to.
   */
  it('forbids a tag as its own paragraph — a take must contain spoken words', () => {
    expect(request.system).toMatch(/Never write a tag as its own\s+paragraph/)
    expect(request.system).not.toMatch(/write \[pause\] on its own,/)
  })

  it('gives the outline pass the same voice rules as the chapters', () => {
    // The outline sets each chapter's beat; a beat written for the eye
    // produces chapters written for the eye.
    const outlineRequest = buildOutlineRequest({
      caseTitle: 'Enron',
      dossierMd: '# Dossier',
      claims,
      targetRuntimeMin: 18,
    })
    expect(outlineRequest.system).toContain('Written for the ear')
  })

  it('budgets tokens from the chapter target, with headroom', () => {
    expect(request.maxTokens).toBeGreaterThan(900 * 1.6)
  })
})

describe('chapterTail', () => {
  it('takes the last sentences', () => {
    expect(chapterTail('One. Two. Three.')).toBe('Two. Three.')
  })

  it('copes with a chapter shorter than the tail', () => {
    expect(chapterTail('Only one.')).toBe('Only one.')
  })

  it('is empty for empty text', () => {
    expect(chapterTail('')).toBe('')
  })
})

describe('buildSelfCheckRequest', () => {
  const request = buildSelfCheckRequest({
    chapterTitle: 'The turn',
    contentMd: 'Some narration.',
    claims,
  })

  it('routes at the cheap editing task, not scripting', () => {
    expect(request.task).toBe('editing')
  })

  it('insists the sentence is quoted exactly', () => {
    // It is matched back to the chapter text character for character to place
    // the gutter marker.
    expect(request.system).toMatch(/EXACTLY as it appears/)
  })

  it('names all three warning kinds the schema accepts', () => {
    expect(request.system).toContain('unsourced-claim')
    expect(request.system).toContain('missing-alleged')
    expect(request.system).toContain('unsupported-attribution')
  })
})

describe('parseSelfCheck', () => {
  it('accepts a clean chapter', () => {
    expect(parseSelfCheck('{"warnings":[],"refs":[]}').warnings).toEqual([])
  })

  it('rejects a warning kind the gutter cannot render', () => {
    expect(() =>
      parseSelfCheck('{"warnings":[{"kind":"iffy","sentence":"x","message":"hello"}],"refs":[]}'),
    ).toThrow(ValidationError)
  })

  it('reads refs back', () => {
    const check = parseSelfCheck(
      '{"warnings":[],"refs":[{"claimId":"abc","sentence":"A sentence."}]}',
    )
    expect(check.refs).toHaveLength(1)
  })
})

describe('parseOutline and parseShortsCandidates', () => {
  it('reads a well-formed outline', () => {
    expect(parseOutline(JSON.stringify(outline)).chapters).toHaveLength(2)
  })

  it('rejects a single-chapter outline', () => {
    expect(() => parseOutline(JSON.stringify({ chapters: [outline.chapters[0]] }))).toThrow(
      ValidationError,
    )
  })

  it('reads Shorts candidates', () => {
    const parsed = parseShortsCandidates(
      JSON.stringify({
        candidates: [
          {
            chapterIndex: 0,
            startSentence: 'A.',
            endSentence: 'B.',
            hookRationale: 'It is surprising.',
          },
        ],
      }),
    )
    expect(parsed).toHaveLength(1)
  })

  it('accepts an empty candidate list — not every script has five', () => {
    expect(parseShortsCandidates('{"candidates":[]}')).toEqual([])
  })
})

describe('buildShortsRequest', () => {
  it('asks for segments that stand alone', () => {
    const request = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
    })
    expect(request.system).toMatch(/stands alone/)
    expect(request.task).toBe('metadata')
  })
})

describe('mock script output', () => {
  it('says in the narration itself that it must never be narrated', () => {
    expect(mockChapter('The turn')).toMatch(/MOCK NARRATION/)
    expect(mockChapter('The turn')).toMatch(/must never be narrated/)
  })

  it('scales the outline to the target runtime', () => {
    expect(mockOutline(6).chapters.length).toBeLessThan(mockOutline(24).chapters.length)
  })

  it('always produces at least two chapters, as the schema requires', () => {
    expect(mockOutline(1).chapters.length).toBeGreaterThanOrEqual(2)
    expect(() => parseOutline(JSON.stringify(mockOutline(1)))).not.toThrow()
  })

  it('emits a warning rather than reporting clean', () => {
    // A mock that always returns no problems ships the warning UI untested
    // and teaches the reviewer that the gutter is always empty.
    const check = mockSelfCheck('First sentence. Second sentence.')
    expect(check.warnings).toHaveLength(1)
    expect(check.warnings[0]?.sentence).toBe('First sentence.')
  })

  it('quotes a sentence that exists in the text, so the gutter can match it', () => {
    const content = mockChapter('X')
    const check = mockSelfCheck(content)
    expect(content).toContain(check.warnings[0]?.sentence)
  })

  it('produces Shorts candidates whose sentences exist in their chapter', () => {
    const chapters = [{ index: 0, contentMd: mockChapter('X') }]
    const [candidate] = mockShortsCandidates(chapters)
    expect(chapters[0]!.contentMd).toContain(candidate!.startSentence)
  })

  it('produces nothing for an empty chapter rather than an invalid candidate', () => {
    expect(mockShortsCandidates([{ index: 0, contentMd: '' }])).toEqual([])
  })
})

describe('scriptWordCount', () => {
  it('totals every chapter', () => {
    expect(scriptWordCount([{ contentMd: 'one two' }, { contentMd: 'three' }])).toBe(3)
  })
})
