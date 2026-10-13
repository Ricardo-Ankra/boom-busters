import {
  OutlineSchema,
  SHORTS_HOOK_MAX,
  TEASER_PARAGRAPH_MAX,
  TEASER_TITLE_MAX,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildChapterRequest,
  claimList,
  buildOutlineRequest,
  buildRegenerateRequest,
  buildSelfCheckRequest,
  buildShortsRequest,
  buildTeaserRequest,
  mockChapter,
  mockOutline,
  mockSelfCheck,
  mockShortsCandidates,
  ownershipBrief,
  parseOutline,
  parseSelfCheck,
  parseShortsCandidates,
  parseTeaser,
  tensionContract,
  tensionFromOutline,
} from './script'
import type { ScriptClaim } from './script'
import type { Note, Repair } from './repair'

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

// Parsed, so the fixture carries the exact Outline shape the runner holds.
// Chapter two has no tension fields — the pre-216 outlines still draft.
const outline = OutlineSchema.parse({
  centralQuestion: 'How did 1.9 billion euros never exist?',
  storylines: ['the money', 'the auditors'],
  close: {
    answer: 'The money never existed; the signatures did.',
    echo: 'The auditors signed.',
    openThread: 'The trial of the chief operating officer has no date.',
  },
  chapters: [
    {
      title: 'The setup',
      beat: 'x'.repeat(30),
      storyline: 'the money',
      claims: [1],
      question: 'Why did the auditors keep signing?',
      withhold: 'The accounts in Manila were empty all along.',
      stakes: 'Thirty thousand pensions',
      constraints: 'Never state that the CEO knew; the claim is single-source.',
      targetWords: 800,
    },
    {
      title: 'The turn',
      beat: 'y'.repeat(30),
      claims: [2],
      reveals: 'The accounts in Manila were empty all along.',
      targetWords: 900,
    },
  ],
})

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

  /**
   * Decision 216: the outline pass designs the tension arc, not just the
   * segmentation — a central question, and per chapter a planted question,
   * a withheld fact and concrete stakes. Without these fields the drafts
   * come out as well-behaved chronological explainers.
   */
  it('asks for the tension contract fields, per the script-craft skill', () => {
    expect(request.system).toContain('Script craft: how the plot builds')
    expect(request.system).toContain('"centralQuestion"')
    expect(request.system).toMatch(/"question"/)
    expect(request.system).toMatch(/"withhold"/)
    expect(request.system).toMatch(/"stakes"/)
    expect(request.system).toMatch(/must NOT answer/)
  })

  /**
   * Decision 296: the outline is a plan. Beats are purpose, the facts are
   * the owned claims, the wording limits have a field of their own, and the
   * return to the cold open is one line.
   */
  it('asks for storylines, claim ownership, reveals and constraints', () => {
    expect(request.system).toContain('"storylines"')
    expect(request.system).toContain('"storyline"')
    expect(request.system).toContain('"claims": [number]')
    expect(request.system).toContain('"reveals"')
    expect(request.system).toContain('"constraints"')
    expect(request.system).toMatch(/exactly one chapter/)
    expect(request.system).toMatch(/never narrated/)
    expect(request.system).toMatch(/one to three sentences/)
    expect(request.system).toMatch(/one line of callback/)
    // The old instruction that produced fact-list beats is gone.
    expect(request.system).not.toMatch(/anything the chapter needs must be in these fields/)
  })

  /**
   * Review of decision 296: with one storyline per chapter, "absent for no
   * more than one chapter in a row" cannot be met by three storylines, and a
   * cold open that owns the claims of the moment it glimpses is told to
   * narrate them in full. The planner is told who owns the glimpsed moment.
   */
  it('asks for the close: answer, echo, open thread (decision 299)', () => {
    expect(request.system).toContain(
      '"close": {"answer": string, "echo": string, "openThread": string}',
    )
    expect(request.system).toMatch(/echo/)
    expect(request.system).toMatch(/open thread/i)
  })

  it('sets a storyline rule a chapter plan can meet, and gives the glimpsed moment to its return', () => {
    expect(request.system).toMatch(/returns in the next/)
    expect(request.system).not.toMatch(/more than one chapter in a row/)
    expect(request.system).toMatch(/opening chapter owns none of the claims/)
  })
})

describe('tensionContract', () => {
  it('composes the chapter contract from the outline fields', () => {
    const contract = tensionContract(outline, 0)
    expect(contract).toContain('central question')
    expect(contract).toContain('How did 1.9 billion euros never exist?')
    expect(contract).toContain('Thirty thousand pensions')
    expect(contract).toContain('Why did the auditors keep signing?')
    expect(contract).toContain('The accounts in Manila were empty all along.')
    // The opening chapter has no predecessor question to answer.
    expect(contract).not.toContain('previous chapter left open')
  })

  it('hands the previous chapter its question to answer', () => {
    const contract = tensionContract(outline, 1)
    expect(contract).toContain(
      'Answer the question the previous chapter left open: Why did the auditors keep signing?',
    )
  })

  /**
   * Decision 299: only the final chapter carries the close, as its last
   * paragraphs; an earlier chapter still ends on a turn.
   */
  it('hands the final chapter the close, and no other chapter', () => {
    const last = tensionContract(outline, outline.chapters.length - 1)
    expect(last).toContain('End the film with the close')
    expect(last).toContain('The money never existed; the signatures did.')
    expect(last).toContain('Echo: The auditors signed.')
    expect(last).toContain('The trial of the chief operating officer has no date.')
    expect(last).toMatch(/never a recap/)
    expect(tensionContract(outline, 0)).not.toContain('End the film')
  })

  it('carries the reveal and the wording limits (decision 296)', () => {
    expect(tensionContract(outline, 0)).toContain(
      'never narrated as sentences, except where they ask for one in so many words: ' +
        'Never state that the CEO knew; the claim is single-source.',
    )
    expect(tensionContract(outline, 1)).toContain(
      'Reveal here, for the first time, what an earlier chapter withheld: The accounts in Manila were empty all along.',
    )
    expect(tensionContract(outline, 0)).not.toContain('Reveal here')
  })

  it('is empty for a pre-216 outline with no tension fields', () => {
    const bare = OutlineSchema.parse({
      chapters: [
        { title: 'Act one', beat: 'x'.repeat(30), targetWords: 300 },
        { title: 'Act two', beat: 'y'.repeat(30), targetWords: 300 },
      ],
    })
    expect(tensionContract(bare, 0)).toBe('')
    expect(tensionContract(bare, 1)).toBe('')
  })
})

describe('buildChapterRequest', () => {
  const request = buildChapterRequest({
    caseTitle: 'Enron',
    outline,
    chapterIndex: 1,
    previousChapters: [
      { title: 'The setup', contentMd: 'The auditors signed it anyway. The money was not there.' },
    ],
    claims,
  })

  /**
   * Decision 296: the drafter reads every chapter so far, in full. With only
   * the previous tail it re-explained the paper in three chapters and told
   * March 2024 twice; it cannot avoid repeating what it has never seen.
   */
  it('hands the drafter every chapter so far, in full, and tells it to move forward', () => {
    const content = JSON.stringify(request.messages)
    expect(content).toContain('## 1. The setup')
    expect(content).toContain('The auditors signed it anyway. The money was not there.')
    expect(content).toContain('Never restate or paraphrase the ending')
    expect(content).not.toContain('Continue from there')
  })

  it('says it is the opening chapter when nothing is drafted yet', () => {
    const first = buildChapterRequest({
      caseTitle: 'Enron',
      outline,
      chapterIndex: 0,
      previousChapters: [],
      claims,
    })
    const content = JSON.stringify(first.messages)
    expect(content).toContain('opening chapter')
    expect(content).not.toContain('script so far')
  })

  it('briefs claim ownership: narrate in full, already told, belonging to later chapters', () => {
    const three = OutlineSchema.parse({
      chapters: [
        { title: 'One', beat: 'x'.repeat(30), claims: [1], targetWords: 300 },
        { title: 'Two', beat: 'y'.repeat(30), claims: [2, 3], targetWords: 300 },
        { title: 'Three', beat: 'z'.repeat(30), claims: [4], targetWords: 300 },
      ],
    })
    const brief = ownershipBrief(three, 1, 4)
    expect(brief).toContain('Narrate in full, once, with attribution: [2], [3]')
    expect(brief).toContain('repeating no figure, date or attribution: [1]')
    expect(brief).toContain('that chapter tells them in full: [4]')
    expect(brief).not.toContain('Do not narrate')
    expect(brief).not.toContain('Not placed by the outline')
    expect(JSON.stringify(request.messages)).toContain(
      'Narrate in full, once, with attribution: [2]',
    )
  })

  it('names the claims the outline placed nowhere, free to any chapter once', () => {
    const brief = ownershipBrief(outline, 1, 4)
    expect(brief).toContain('Not placed by the outline')
    expect(brief).toContain('once in the film: [3], [4]')
    // The request knows the claim list's length, so the drafter sees them too.
    expect(JSON.stringify(request.messages)).not.toContain('Not placed by the outline')
  })

  it('says "none" for an empty ownership line rather than leaving it blank', () => {
    expect(ownershipBrief(outline, 0)).toContain('repeating no figure, date or attribution: none')
  })

  it('sends no ownership brief for an outline drafted before the plan fields (decision 296)', () => {
    const bare = OutlineSchema.parse({
      chapters: [
        { title: 'Act one', beat: 'x'.repeat(30), targetWords: 300 },
        { title: 'Act two', beat: 'y'.repeat(30), targetWords: 300 },
      ],
    })
    expect(ownershipBrief(bare, 1)).toBe('')
    const without = buildChapterRequest({
      caseTitle: 'Enron',
      outline: bare,
      chapterIndex: 1,
      previousChapters: [{ title: 'Act one', contentMd: 'Words.' }],
      claims,
    })
    expect(without.messages.some((message) => message.content.includes('Claim ownership'))).toBe(
      false,
    )
  })

  it('shows each chapter its storyline in the outline summary', () => {
    expect(JSON.stringify(request.messages)).toContain('1. The setup (the money)')
  })

  /**
   * Decision 296: the recap ban reaches mid-chapter, and legal care is the
   * inline hedge, never a sentence saying nothing was proven.
   */
  it('bans summing-up anywhere and narrated caveats', () => {
    expect(request.system).toMatch(/No summing-up anywhere/)
    expect(request.system).toMatch(/no paragraph in its middle restates/)
    expect(request.system).toMatch(/Never a\s+sentence of its own saying that nothing was proven/)
    expect(request.system).not.toMatch(/No summing-up closers/)
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

  /**
   * Decision 216: every drafting request carries the script-craft skill and
   * its chapter's tension contract; a bare pre-216 outline just drops the
   * contract message rather than sending an empty one.
   */
  it('carries the script-craft skill and the tension contract', () => {
    expect(request.system).toContain('Script craft: how the plot builds')
    const contract = request.messages.find((message) =>
      message.content.includes('tension contract'),
    )
    expect(contract?.content).toContain('Why did the auditors keep signing?')

    const bare = OutlineSchema.parse({
      chapters: [
        { title: 'Act one', beat: 'x'.repeat(30), targetWords: 300 },
        { title: 'Act two', beat: 'y'.repeat(30), targetWords: 300 },
      ],
    })
    const withoutContract = buildChapterRequest({
      caseTitle: 'Enron',
      outline: bare,
      chapterIndex: 0,
      previousChapters: [],
      claims,
    })
    expect(
      withoutContract.messages.some((message) => message.content.includes('tension contract')),
    ).toBe(false)
  })

  it('gives the regenerate pass the same craft rules', () => {
    const regenerate = buildRegenerateRequest({
      chapterTitle: 'The turn',
      contentMd: 'Some narration. More narration.',
      selection: 'More narration.',
      note: 'Make it land harder.',
      claims,
    })
    expect(regenerate.system).toContain('Script craft: how the plot builds')
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

  /**
   * Decision 296: a beat over its limit is trimmed at a sentence, a claim
   * listed by two chapters stays with the first, and a number the claim list
   * does not have is dropped; each is reported, none refuses the outline.
   */
  describe('the outline repairs (decision 296)', () => {
    const chapter = (over: Partial<Record<string, unknown>>) => ({
      title: 'A chapter',
      beat: 'What this chapter does.',
      targetWords: 300,
      ...over,
    })
    const collect = () => {
      const repairs: Repair[] = []
      const note: Note = (repair) => repairs.push(repair)
      return { repairs, note }
    }

    it('trims a beat over the limit at a sentence and names the chapter', () => {
      const { repairs, note } = collect()
      const long = `${'A sentence of purpose. '.repeat(40)}The tail.`
      const parsed = parseOutline(
        JSON.stringify({ chapters: [chapter({ beat: long }), chapter({})] }),
        note,
      )
      expect(parsed.chapters[0]!.beat.length).toBeLessThanOrEqual(600)
      expect(parsed.chapters[0]!.beat.endsWith('.')).toBe(true)
      expect(repairs).toEqual([{ action: 'trimmed', field: "chapter 1's beat" }])
    })

    it('keeps a claim with its first owner and drops the later listing, saying whose it is', () => {
      const { repairs, note } = collect()
      const parsed = parseOutline(
        JSON.stringify({
          // The duplicate sits between chapters 2 and 3: the opening chapter
          // glimpses, so a claim it shares goes the other way (next test).
          chapters: [
            chapter({ claims: [1] }),
            chapter({ claims: [2, 3] }),
            chapter({ claims: [3] }),
          ],
        }),
        note,
        3,
      )
      expect(parsed.chapters.map((c) => c.claims)).toEqual([[1], [2, 3], []])
      expect(repairs).toEqual([
        { action: 'dropped', field: "chapter 3's claim 3", reason: 'already owned by chapter 2' },
      ])
    })

    it('drops a number the claim list does not have, and anything that is not a number', () => {
      const { repairs, note } = collect()
      const parsed = parseOutline(
        JSON.stringify({ chapters: [chapter({ claims: [1, 9, 'two', 0] }), chapter({})] }),
        note,
        3,
      )
      expect(parsed.chapters[0]!.claims).toEqual([1])
      expect(repairs).toEqual([
        { action: 'dropped', field: "chapter 1's claim 9", reason: 'the claim list ends at 3' },
        { action: 'dropped', field: "chapter 1's claim two", reason: 'not a claim number' },
        { action: 'dropped', field: "chapter 1's claim 0", reason: 'not a claim number' },
      ])
    })

    it('hands a claim the cold open and a later chapter both list to the later chapter', () => {
      const { repairs, note } = collect()
      const parsed = parseOutline(
        JSON.stringify({
          chapters: [
            chapter({ claims: [1, 2] }),
            chapter({ claims: [3] }),
            chapter({ claims: [1, 4] }),
          ],
        }),
        note,
        4,
      )
      expect(parsed.chapters.map((c) => c.claims)).toEqual([[2], [3], [1, 4]])
      expect(repairs).toEqual([
        {
          action: 'dropped',
          field: "chapter 1's claim 1",
          reason: 'glimpsed in the opening; owned by chapter 3',
        },
      ])
    })

    it('reports a claims field that is not a list, rather than folding it in silence', () => {
      const { repairs, note } = collect()
      const parsed = parseOutline(
        JSON.stringify({ chapters: [chapter({ claims: '1, 2' }), chapter({})] }),
        note,
        2,
      )
      expect(parsed.chapters[0]!.claims).toBeUndefined()
      expect(repairs).toEqual([
        { action: 'dropped', field: "chapter 1's claims", reason: 'not a list of claim numbers' },
      ])
    })

    it('keeps any number when the claim count is not given', () => {
      const parsed = parseOutline(
        JSON.stringify({ chapters: [chapter({ claims: [40] }), chapter({})] }),
      )
      expect(parsed.chapters[0]!.claims).toEqual([40])
    })

    it('still refuses an outline it cannot repair, naming the field', () => {
      expect(() =>
        parseOutline(JSON.stringify({ chapters: [{ title: 'No beat' }, chapter({})] })),
      ).toThrow(/did not match the expected shape/)
    })
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
  it('asks for teaser segments that end before a reveal, not summaries', () => {
    const request = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
    })
    expect(request.system).toMatch(/TEASER, not a summary/)
    expect(request.system).toMatch(/END right BEFORE a reveal/)
    expect(request.system).toMatch(/Never include the sentence that resolves/)
    expect(request.task).toBe('metadata')
  })

  it('threads the tension fields into the message when the outline carries them', () => {
    const request = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
      tension: {
        centralQuestion: 'How did 1.9 billion euros never exist?',
        chapters: [
          { index: 0, question: 'Who signed the audits?', withhold: 'the auditor resigned' },
          { index: 1 },
        ],
      },
    })
    const message = request.messages[0]!.content
    expect(message).toContain('How did 1.9 billion euros never exist?')
    expect(message).toContain('Who signed the audits?')
    expect(message).toContain('withholds: the auditor resigned')
    // A chapter with no tension fields contributes no line.
    expect(message).not.toContain('Chapter 1:')
  })

  it('degrades to text-only for a script whose outline was never kept', () => {
    const request = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
    })
    expect(request.messages[0]!.content).not.toContain('withholds')
    expect(request.messages[0]!.content).toContain('## Chapter 0')
  })
})

describe('tensionFromOutline', () => {
  it('carries the question and withhold per chapter, indexed by position', () => {
    expect(tensionFromOutline(outline)).toEqual({
      centralQuestion: 'How did 1.9 billion euros never exist?',
      chapters: [
        {
          index: 0,
          question: 'Why did the auditors keep signing?',
          withhold: 'The accounts in Manila were empty all along.',
        },
        { index: 1, question: undefined, withhold: undefined },
      ],
    })
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

  it('carries every plan field so CI exercises the shape (decision 296)', () => {
    const mocked = mockOutline(10)
    expect(mocked.storylines?.length).toBeGreaterThan(0)
    expect(mocked.chapters[0]).toMatchObject({
      storyline: expect.any(String),
      claims: [],
      constraints: expect.any(String),
    })
    expect(mocked.chapters[0]!.reveals).toBeUndefined()
    expect(mocked.chapters[1]!.reveals).toBe('Mock withheld fact 1')
    expect(mocked.close).toMatchObject({
      answer: expect.any(String),
      echo: expect.any(String),
      openThread: expect.any(String),
    })
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

describe('claimList', () => {
  const base = { text: 'A newspaper reported the accounts were empty.', confidence: 'sourced' }

  it('marks the claims a headline card may cite (decision 257)', () => {
    const list = claimList([
      {
        ...base,
        id: '01ABCDEFGHJKMNPQRSTVWXYZ01',
        sourceType: 'major_outlet',
        sourceUrl: 'https://news.example/story',
      },
    ])
    expect(list).toContain('NEWS ARTICLE')
  })

  it('does not mark a news claim whose URL did not survive research', () => {
    const list = claimList([
      { ...base, id: '01ABCDEFGHJKMNPQRSTVWXYZ02', sourceType: 'major_outlet', sourceUrl: null },
    ])
    expect(list).not.toContain('NEWS ARTICLE')
  })

  it('does not mark a court or regulator source, which has no article to quote', () => {
    const list = claimList([
      {
        ...base,
        id: '01ABCDEFGHJKMNPQRSTVWXYZ03',
        sourceType: 'court',
        sourceUrl: 'https://courts.example/judgment',
      },
    ])
    expect(list).not.toContain('NEWS ARTICLE')
  })

  it('marks a claim sourced to an X post, with brackets rather than a dash (decision 284)', () => {
    const list = claimList([
      {
        ...base,
        id: '01ABCDEFGHJKMNPQRSTVWXYZ04',
        sourceUrl: 'https://x.com/a/status/1',
      },
    ])
    expect(list).toContain('(X POST)')
    // The marker is bracketed, never the em dash the other markers use.
    // Built from a code point so this source file carries no dash itself.
    expect(list).not.toContain(String.fromCharCode(0x2014) + ' X POST')
  })

  it('does not mark an article claim as an X post', () => {
    const list = claimList([
      {
        ...base,
        id: '01ABCDEFGHJKMNPQRSTVWXYZ05',
        sourceType: 'major_outlet',
        sourceUrl: 'https://news.example/story',
      },
    ])
    expect(list).not.toContain('X POST')
  })
})

describe('the teaser (decision 293)', () => {
  const chapters = [
    { index: 0, title: 'The audit', contentMd: 'By June, the auditors could not find the money.' },
    { index: 1, title: 'The collapse', contentMd: 'The shares collapsed in nine days.' },
  ]
  const first = { text: 'One number was missing, and it was billions.', chapterIndex: 0 }
  const second = { text: 'The auditors finally refused to sign anything at all.', chapterIndex: 1 }
  const teaser = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ title: 'The audit that said no', paragraphs: [first, second], ...overrides })
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('states every limit in the prompt', () => {
    const { system } = buildTeaserRequest({ caseTitle: 'Wirecard', chapters })
    expect(system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): title 3 to 90 characters; 2 to 5 paragraphs, each 10 to ' +
        '400 characters; chapterIndex is the number of a chapter below, 0 to 1.',
    )
  })

  it('reads a clean teaser as written, noting nothing', () => {
    const { notes, note } = collect()
    expect(parseTeaser(teaser(), 2, note)).toEqual({
      title: 'The audit that said no',
      paragraphs: [first, second],
    })
    expect(notes).toEqual([])
  })

  it('trims the title at a word and a long beat at a sentence, keeping its chapter', () => {
    const { notes, note } = collect()
    const title = 'The auditors could not find the money '.repeat(3)
    const long = {
      text: 'One number was missing, and it was billions. '.repeat(10),
      chapterIndex: 1,
    }
    const parsed = parseTeaser(teaser({ title, paragraphs: [long, second] }), 2, note)
    expect(parsed.title.length).toBeLessThanOrEqual(TEASER_TITLE_MAX)
    expect(title.startsWith(parsed.title)).toBe(true)
    expect(title[parsed.title.length]).toBe(' ')
    expect(parsed.paragraphs[0]!.text.length).toBeLessThanOrEqual(TEASER_PARAGRAPH_MAX)
    expect(parsed.paragraphs[0]!.text.endsWith('it was billions.')).toBe(true)
    expect(parsed.paragraphs.map((paragraph) => paragraph.chapterIndex)).toEqual([1, 1])
    expect(notes).toEqual([
      { action: 'trimmed', field: 'the title' },
      { action: 'trimmed', field: 'beat 1' },
    ])
  })

  it('keeps the first five beats', () => {
    const { notes, note } = collect()
    const six = Array.from({ length: 6 }, (_, at) => ({
      text: `Beat number ${at + 1} of the story.`,
      chapterIndex: 0,
    }))
    const parsed = parseTeaser(teaser({ paragraphs: six }), 2, note)
    expect(parsed.paragraphs).toHaveLength(5)
    expect(parsed.paragraphs[4]!.text).toBe('Beat number 5 of the story.')
    expect(notes).toEqual([{ action: 'capped', field: 'beats', kept: 5 }])
  })

  it('refuses a beat drawn from a chapter the film does not have, naming the range', () => {
    expect(() =>
      parseTeaser(teaser({ paragraphs: [first, { ...second, chapterIndex: 2 }] }), 2),
    ).toThrow('beat 2 draws from chapter 2, but the chapters run 0 to 1')
  })

  it('still refuses a teaser of one beat', () => {
    expect(() => parseTeaser(teaser({ paragraphs: [first] }), 2)).toThrow(ValidationError)
  })
})

describe('the Shorts marking limits (decision 293)', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    chapterIndex: 0,
    startSentence: 'EY refused to sign the accounts.',
    endSentence: 'The shares collapsed in nine days.',
    hookRationale: 'The auditor said no.',
    ...over,
  })

  const collect = () => {
    const notes: Repair[] = []
    return {
      notes,
      note: (repair: Repair) => {
        notes.push(repair)
      },
    }
  }

  it('states every limit in the prompt', () => {
    const rules = buildShortsRequest({
      chapters: [{ index: 0, title: 'One', contentMd: 'Text.' }],
    }).system.replace(/\s+/g, ' ')
    expect(rules).toContain(
      'Limits (the app checks them): at most 10 candidates; "startSentence" and "endSentence" at most 2000 characters each; "hookRationale" at most 1000 characters.',
    )
  })

  it('trims a hook over its limit at a sentence and names the candidate, leaving its anchors alone', () => {
    const { notes, note } = collect()
    const long = 'The auditor said no. ' + 'That is the whole scandal in one line. '.repeat(40)
    const parsed = parseShortsCandidates(
      JSON.stringify({ candidates: [candidate(), candidate({ hookRationale: long })] }),
      note,
    )
    expect(parsed[1]!.hookRationale.length).toBeLessThanOrEqual(SHORTS_HOOK_MAX)
    expect(parsed[1]!.hookRationale.endsWith('in one line.')).toBe(true)
    expect(parsed[1]).toMatchObject({
      chapterIndex: 0,
      startSentence: 'EY refused to sign the accounts.',
      endSentence: 'The shares collapsed in nine days.',
    })
    expect(notes).toEqual([{ action: 'trimmed', field: "candidate 2's hook" }])
  })

  it('drops a candidate whose start or end sentence runs over its limit, keeps the rest, and numbers them as written', () => {
    const { notes, note } = collect()
    const parsed = parseShortsCandidates(
      JSON.stringify({
        candidates: [
          candidate(),
          candidate({ startSentence: 'A'.repeat(2001) }),
          // Dropped whole: its long hook is not trimmed first.
          candidate({ endSentence: 'B'.repeat(2001), hookRationale: 'x'.repeat(1200) }),
          candidate({ chapterIndex: 1 }),
        ],
      }),
      note,
    )
    expect(parsed.map((kept) => kept.chapterIndex)).toEqual([0, 1])
    expect(notes).toEqual([
      {
        action: 'dropped',
        field: 'candidate 2',
        reason: 'its start sentence ran over 2,000 characters',
      },
      {
        action: 'dropped',
        field: 'candidate 3',
        reason: 'its end sentence ran over 2,000 characters',
      },
    ])
  })

  it('keeps the first ten of more', () => {
    const { notes, note } = collect()
    const parsed = parseShortsCandidates(
      JSON.stringify({
        candidates: Array.from({ length: 12 }, (_, at) => candidate({ chapterIndex: at })),
      }),
      note,
    )
    expect(parsed.map((kept) => kept.chapterIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(notes).toEqual([{ action: 'capped', field: 'Shorts candidates', kept: 10 }])
  })

  it('still refuses a candidate it cannot repair', () => {
    expect(() =>
      parseShortsCandidates(
        JSON.stringify({ candidates: [candidate({ hookRationale: 'short' })] }),
      ),
    ).toThrow(ValidationError)
  })
})
