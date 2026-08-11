import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildBriefRequest,
  buildClaimsRequest,
  buildTimelineRequest,
  mockBrief,
  mockClaims,
  mockTimeline,
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

  it('puts open questions in the document, not only in a side panel', () => {
    // What the research could not establish is the part most likely to be
    // written around confidently if nobody sees it.
    expect(rendered).toContain('## Open questions')
    expect(rendered).toContain('What did the board know in 1999?')
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
