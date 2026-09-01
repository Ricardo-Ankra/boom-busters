import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildAnswersRequest,
  buildBriefRequest,
  buildClaimsRequest,
  buildTimelineRequest,
  mockAnswers,
  mockBrief,
  mockClaims,
  mockTimeline,
  parseAnswers,
  parseBrief,
  parseClaims,
  parseTimeline,
  renderDossierMarkdown,
} from './dossier'

const caseContext = {
  title: 'Enron',
  category: 'collapse',
  angle: 'The auditors, not the traders.',
  demandNotes: null,
}

const brief = {
  summary: 'x'.repeat(60),
  turningPoint: 'The moment the mark-to-market accounting was approved.',
  principals: [{ name: 'Jeffrey Skilling', role: 'CEO' }],
  openQuestions: ['What did the board know in 1999?'],
}

describe('the research prompts', () => {
  it('all route at the research task', () => {
    expect(buildBriefRequest(caseContext).task).toBe('research')
    expect(buildTimelineRequest(caseContext, brief).task).toBe('research')
    expect(buildClaimsRequest(caseContext, brief, []).task).toBe('research')
  })

  it('forbids inventing sources in every pass', () => {
    // The channel's liability lives in this instruction.
    for (const request of [
      buildBriefRequest(caseContext),
      buildTimelineRequest(caseContext, brief),
      buildClaimsRequest(caseContext, brief, []),
    ]) {
      expect(request.system).toMatch(/Never invent a URL/)
      expect(request.system).toMatch(/Never state as fact/)
    }
  })

  it('carries the angle into the research', () => {
    expect(buildBriefRequest(caseContext).messages[0]?.content).toContain('auditors')
  })

  it('feeds each pass the output of the one before', () => {
    expect(JSON.stringify(buildTimelineRequest(caseContext, brief).messages)).toContain(
      'Jeffrey Skilling',
    )
    expect(
      JSON.stringify(
        buildClaimsRequest(caseContext, brief, [{ when: '2001', what: 'Bankruptcy filed.' }])
          .messages,
      ),
    ).toContain('Bankruptcy filed')
  })

  it('marks the repeated case header as cacheable on the later passes', () => {
    expect(buildTimelineRequest(caseContext, brief).cacheablePrefixMessages).toBe(1)
    expect(buildClaimsRequest(caseContext, brief, []).cacheablePrefixMessages).toBe(1)
  })

  it('tells the model not to guess adjudication', () => {
    // "alleged" in the script hangs off this field.
    expect(buildClaimsRequest(caseContext, brief, []).system).toMatch(/do not guess it/)
  })

  /**
   * Decision 200. The old rule — "omit sourceUrl and mark the claim
   * unverified" — coupled confidence to link-availability, and a model
   * researching from memory rarely has the exact article link. It knew the
   * FT reported something, typed it major_outlet, omitted the URL, and the
   * schema's demotion then blocked the gate with a claim that showed no
   * source at all. Confidence describes the record; the URL is the best
   * real starting point, publication-level when the article is not to hand.
   */
  it('decouples confidence from having the exact link, and asks for a URL on every claim', () => {
    const system = buildClaimsRequest(caseContext, brief, []).system
    expect(system).toMatch(/Confidence is about the record, not about links/)
    expect(system).toMatch(/Do NOT downgrade a claim to unverified/)
    expect(system).toMatch(/EVERY claim carries the best real sourceUrl/)
    // And the house rules name the fallback level and ban search links.
    expect(system).toMatch(/publication's or regulator's own site or topic page/)
    expect(system).toMatch(/never give a search-engine link/)
  })
})

describe('parseClaims', () => {
  const claim = {
    text: 'Enron filed for bankruptcy in December 2001.',
    sourceUrl: 'https://example.com/filing',
    sourceType: 'court',
    confidence: 'sourced',
    adjudicated: true,
  }

  it('reads a well-formed claim', () => {
    expect(parseClaims(JSON.stringify({ claims: [claim] }))).toHaveLength(1)
  })

  it('downgrades a "sourced" claim that carries no source', () => {
    // The single most important rule in the file: "sourced" without a source
    // is the exact shape of an unchecked assertion reaching a script. It is
    // enforced by demotion rather than rejection, so one bad field cannot
    // throw away — and re-charge — a whole research pass.
    const { sourceUrl, ...unsourced } = claim
    void sourceUrl

    const [parsed] = parseClaims(JSON.stringify({ claims: [unsourced] }))

    expect(parsed?.confidence).toBe('unverified')
    expect(parsed?.adjudicated).toBe(false)
  })

  it('downgrades a claim whose source is a citation rather than a URL', () => {
    // What a model actually returns when asked for a sourceUrl it does not
    // have: "Munich court judgment, 2021", "FT, June 2020", "N/A".
    const [parsed] = parseClaims(
      JSON.stringify({ claims: [{ ...claim, sourceUrl: 'Munich court judgment, 2021' }] }),
    )

    expect(parsed?.sourceUrl).toBeUndefined()
    expect(parsed?.confidence).toBe('unverified')
  })

  it('refuses a source that is not a web address at all', () => {
    // Rendered as a link on the review screen, so a javascript: "source" is
    // not merely useless.
    const [parsed] = parseClaims(
      JSON.stringify({ claims: [{ ...claim, sourceUrl: 'javascript:alert(1)' }] }),
    )

    expect(parsed?.sourceUrl).toBeUndefined()
  })

  it('refuses a search-engine link as a source — that is where you LOOK for one', () => {
    // A model that half-remembers the outlet offers a google.com link, which
    // renders as an authoritative-looking citation that cites nothing
    // (decision 200). Dropping it demotes the claim honestly.
    for (const url of [
      'https://www.google.com/search?q=carillion+jobs+at+risk',
      'https://google.co.uk/search?q=x',
      'https://www.bing.com/search?q=x',
      'https://duckduckgo.com/?q=x',
    ]) {
      const [parsed] = parseClaims(JSON.stringify({ claims: [{ ...claim, sourceUrl: url }] }))
      expect(parsed?.sourceUrl, url).toBeUndefined()
      expect(parsed?.confidence, url).toBe('unverified')
    }
  })

  it('does not mistake a real outlet for a search engine', () => {
    const [parsed] = parseClaims(
      JSON.stringify({ claims: [{ ...claim, sourceUrl: 'https://www.theguardian.com/business' }] }),
    )
    expect(parsed?.sourceUrl).toBe('https://www.theguardian.com/business')
  })

  it('keeps a claim whose source really is a URL', () => {
    const [parsed] = parseClaims(JSON.stringify({ claims: [claim] }))

    expect(parsed?.sourceUrl).toBe('https://example.com/filing')
    expect(parsed?.confidence).toBe('sourced')
    expect(parsed?.adjudicated).toBe(true)
  })

  it('allows an unverified claim with no source', () => {
    const { sourceUrl, ...rest } = claim
    void sourceUrl
    expect(
      parseClaims(
        JSON.stringify({
          claims: [{ ...rest, confidence: 'unverified', adjudicated: false }],
        }),
      ),
    ).toHaveLength(1)
  })

  it('refuses a confidence value the review UI cannot render', () => {
    expect(() =>
      parseClaims(JSON.stringify({ claims: [{ ...claim, confidence: 'probably' }] })),
    ).toThrow(ValidationError)
  })

  it('refuses a source type outside the enum', () => {
    expect(() =>
      parseClaims(JSON.stringify({ claims: [{ ...claim, sourceType: 'blog' }] })),
    ).toThrow(ValidationError)
  })

  it('refuses an empty claims list', () => {
    expect(() => parseClaims('{"claims":[]}')).toThrow(ValidationError)
  })
})

describe('parseBrief and parseTimeline', () => {
  it('read well-formed output', () => {
    expect(parseBrief(JSON.stringify(brief)).principals).toHaveLength(1)
    expect(
      parseTimeline(JSON.stringify({ events: [{ when: '2001', what: 'Bankruptcy filed.' }] })),
    ).toHaveLength(1)
  })

  it('rejects a brief too thin to be research', () => {
    expect(() => parseBrief(JSON.stringify({ ...brief, summary: 'It collapsed.' }))).toThrow(
      ValidationError,
    )
  })

  it('rejects an empty timeline', () => {
    expect(() => parseTimeline('{"events":[]}')).toThrow(ValidationError)
  })

  it('keeps a timeline whose sources are citations rather than URLs', () => {
    // This exact payload failed a live run and was retried four times at full
    // price. A timeline entry is context, not an assertion the script narrates,
    // so an unsourced one is simply unsourced.
    const events = parseTimeline(
      JSON.stringify({
        events: [
          { when: '2001', what: 'Bankruptcy filed.', sourceUrl: 'Court records, Houston' },
          { when: '2002', what: 'Executives charged.', sourceUrl: '' },
          { when: '2006', what: 'Convictions returned.', sourceUrl: 'https://example.com/ruling' },
        ],
      }),
    )

    expect(events).toHaveLength(3)
    expect(events[0]?.sourceUrl).toBeUndefined()
    expect(events[1]?.sourceUrl).toBeUndefined()
    expect(events[2]?.sourceUrl).toBe('https://example.com/ruling')
  })

  it('accepts an imprecise date, because the record often is', () => {
    expect(
      parseTimeline(
        JSON.stringify({ events: [{ when: 'late 2019', what: 'Something happened.' }] }),
      ),
    ).toHaveLength(1)
  })
})

describe('the answers pass (decision 201)', () => {
  const request = buildAnswersRequest(caseContext, brief, [])

  it('routes at the research task with the case header cacheable', () => {
    expect(request.task).toBe('research')
    expect(request.cacheablePrefixMessages).toBe(1)
  })

  it('puts the open questions to the model, verbatim and numbered', () => {
    // Numbered because the number is the join key (decision 203): the first
    // live run paraphrased every echoed question, and text matching alone
    // placed none of its answers.
    expect(JSON.stringify(request.messages)).toContain('1. What did the board know in 1999?')
    expect(request.system).toMatch(/"index" is the question's number/)
  })

  it('makes the honest null legal and the invented answer not', () => {
    expect(request.system).toMatch(/set "answer" to null/)
    expect(request.system).toMatch(/an invented answer is a liability/)
    expect(request.system).toMatch(/Never invent a URL/)
  })

  it('routes narratable facts through the claim list, not around it', () => {
    // An answer is prose in the document; only claims are gated, sourced and
    // referenced by the script. An answer that bypassed the list would be an
    // unchecked assertion wearing a heading.
    expect(request.system).toMatch(/must ALSO\s+appear in "claims"/)
  })

  it('parses answers, folding a refusal-as-string into the null it is', () => {
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [
          {
            question: 'What did the board know in 1999?',
            answer: 'The 2002 Powers report found the board approved the structures.',
            sourceUrl: 'https://example.com/powers-report',
          },
          { question: 'Why was it liquidation, not administration?', answer: 'unknown' },
        ],
      }),
    )
    expect(parsed.answers[0]?.answer).toContain('Powers report')
    expect(parsed.answers[1]?.answer).toBeNull()
    expect(parsed.claims).toEqual([])
  })

  it('holds answer-pass claims to the same rules as the claims pass', () => {
    const parsed = parseAnswers(
      JSON.stringify({
        answers: [],
        claims: [
          {
            text: 'The Powers report was published in February 2002.',
            sourceUrl: 'https://www.google.com/search?q=powers+report',
            sourceType: 'other',
            confidence: 'single_source',
            adjudicated: false,
          },
        ],
      }),
    )
    // The search link is scrubbed and the claim demoted, exactly as in pass 3.
    expect(parsed.claims[0]?.sourceUrl).toBeUndefined()
    expect(parsed.claims[0]?.confidence).toBe('unverified')
  })

  it('mock mode answers nothing, loudly', () => {
    const mocked = mockAnswers(brief)
    expect(mocked.answers).toHaveLength(1)
    expect(mocked.answers[0]?.answer).toBeNull()
    expect(mocked.answers[0]?.index).toBe(1)
    expect(mocked.claims).toEqual([])
  })
})

describe('renderDossierMarkdown', () => {
  const rendered = renderDossierMarkdown({
    caseTitle: 'Enron',
    brief,
    timeline: [{ when: '2001', what: 'Bankruptcy filed.', sourceUrl: 'https://example.com' }],
    claims: [
      {
        text: 'An unsourced assertion.',
        sourceType: 'other',
        confidence: 'unverified',
        adjudicated: false,
      },
    ],
  })

  it('leads with the case title', () => {
    expect(rendered.startsWith('# Enron')).toBe(true)
  })

  it('links a timeline source', () => {
    expect(rendered).toContain('([source](https://example.com))')
  })

  it('puts open questions in the document when no answers pass ran', () => {
    // What the research could not establish is the part most likely to be
    // written around confidently if nobody sees it.
    expect(rendered).toContain('## Open questions')
    expect(rendered).toContain('What did the board know in 1999?')
  })

  it('renders an answered question as answered, and only nulls stay open', () => {
    const withAnswers = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief: { ...brief, openQuestions: ['What did the board know in 1999?', 'Who leaked it?'] },
      timeline: [],
      claims: [],
      answers: [
        {
          question: 'What did the board know in 1999.', // punctuation drift tolerated
          answer: 'The Powers report found the board approved the structures.',
          sourceUrl: 'https://example.com/powers-report',
        },
        { question: 'Who leaked it?', answer: null },
      ],
    })

    expect(withAnswers).toContain('## Questions the research answered')
    expect(withAnswers).toContain('Powers report')
    expect(withAnswers).toContain('([source](https://example.com/powers-report))')
    expect(withAnswers).toContain('## Open questions')
    expect(withAnswers).toContain('- Who leaked it?')
    expect(withAnswers).not.toContain('- What did the board know in 1999?')
  })

  it('drops the Open questions section entirely when every question is answered', () => {
    const complete = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief,
      timeline: [],
      claims: [],
      answers: [
        {
          question: 'What did the board know in 1999?',
          answer: 'It approved the structures, per the Powers report.',
        },
      ],
    })
    expect(complete).toContain('## Questions the research answered')
    expect(complete).not.toContain('## Open questions')
  })

  it('places an answer by its index even when the model paraphrased the question (decision 203)', () => {
    // The first live run: Haiku rewrote every question it echoed back, the
    // folded-text match placed nothing, and every real answer vanished while
    // the questions stayed "open". The index is the deterministic join key.
    const withIndex = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief: { ...brief, openQuestions: ['What did the board know in 1999?', 'Who leaked it?'] },
      timeline: [],
      claims: [],
      answers: [
        {
          index: 1,
          question: "What was the board's knowledge?", // paraphrased — must not matter
          answer: 'The Powers report found the board approved the structures.',
        },
      ],
    })
    expect(withIndex).toContain('## Questions the research answered')
    // Rendered under the brief's own wording, not the paraphrase.
    expect(withIndex).toContain('- **What did the board know in 1999?** —')
    expect(withIndex).not.toContain("What was the board's knowledge?")
    expect(withIndex).toContain('- Who leaked it?')
  })

  it('never discards a real answer it cannot place — it renders under its own words', () => {
    const unplaced = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief: { ...brief, openQuestions: ['What did the board know in 1999?'] },
      timeline: [],
      claims: [],
      answers: [
        {
          question: 'How much did the partnerships hide?', // no index, no text match
          answer: 'Over one billion dollars in debt, per the Powers report.',
        },
      ],
    })
    // The answer was paid for and may be true: it renders. The question it
    // failed to place against honestly stays open.
    expect(unplaced).toContain('- **How much did the partnerships hide?** —')
    expect(unplaced).toContain('## Open questions')
    expect(unplaced).toContain('- What did the board know in 1999?')
  })

  it('ignores an index pointing outside the question list rather than mis-filing the answer', () => {
    const outside = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief: { ...brief, openQuestions: ['What did the board know in 1999?'] },
      timeline: [],
      claims: [],
      answers: [
        {
          index: 7,
          question: 'What did the board know in 1999?', // text still matches
          answer: 'It approved the structures, per the Powers report.',
        },
      ],
    })
    // The bad index falls back to the text match, so the answer still lands.
    expect(outside).toContain('- **What did the board know in 1999?** —')
    expect(outside).not.toContain('## Open questions')
  })

  it('says how many claims are unverified and why it matters', () => {
    expect(rendered).toContain('## Unverified')
    expect(rendered).toContain('excluded from scripting')
  })

  it('omits the unverified section when every claim is sourced', () => {
    const clean = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief,
      timeline: [],
      claims: [
        {
          text: 'A sourced assertion.',
          sourceUrl: 'https://example.com',
          sourceType: 'court',
          confidence: 'sourced',
          adjudicated: true,
        },
      ],
    })
    expect(clean).not.toContain('## Unverified')
  })

  it('is a pure function of its input', () => {
    const again = renderDossierMarkdown({
      caseTitle: 'Enron',
      brief,
      timeline: [{ when: '2001', what: 'Bankruptcy filed.', sourceUrl: 'https://example.com' }],
      claims: [
        {
          text: 'An unsourced assertion.',
          sourceType: 'other',
          confidence: 'unverified',
          adjudicated: false,
        },
      ],
    })
    expect(again).toBe(rendered)
  })
})

describe('mock research', () => {
  it('says in the dossier itself that nothing was researched', () => {
    // A mock dossier that reads plausibly is one somebody eventually approves
    // by accident.
    expect(mockBrief(caseContext).summary).toMatch(/MOCK DOSSIER/)
    expect(mockBrief(caseContext).summary).toMatch(/No research was performed/)
  })

  it('produces claims that are all unverified, so nothing looks checked', () => {
    for (const claim of mockClaims()) {
      expect(claim.confidence).toBe('unverified')
      expect(claim.adjudicated).toBe(false)
      expect(claim.sourceUrl).toBeUndefined()
    }
  })

  it('validates against the same schema as real output', () => {
    expect(() => parseClaims(JSON.stringify({ claims: mockClaims() }))).not.toThrow()
    expect(() => parseBrief(JSON.stringify(mockBrief(caseContext)))).not.toThrow()
    expect(() => parseTimeline(JSON.stringify({ events: mockTimeline() }))).not.toThrow()
  })

  it('is deterministic', () => {
    expect(mockBrief(caseContext)).toEqual(mockBrief(caseContext))
  })
})
