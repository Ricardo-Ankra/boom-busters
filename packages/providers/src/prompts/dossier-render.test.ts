import type { GroundedClaim, GroundedRef, GroundedResearch } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { renderDossierMarkdown } from './dossier-render'

const ref = (over: Partial<GroundedRef> = {}): GroundedRef => ({
  documentId: 'doc-1',
  url: 'https://example.com/story',
  found: true,
  locatorSeconds: null,
  quote: 'the words that show it',
  ...over,
})

const scene = (over: { ref?: Partial<GroundedRef> } = {}): GroundedResearch['scenes'][number] => ({
  when: 'June 2020',
  who: 'Markus Braun',
  what: 'Resigned as chief executive',
  why: 'The founder leaves the stage.',
  quote: 'the words that show it',
  ref: ref(over.ref),
})

const grounded = (over: Partial<GroundedResearch> = {}): GroundedResearch => ({
  entity: {
    qid: null,
    titles: [],
    cik: null,
    ticker: null,
    website: null,
    people: [],
    unresolved: false,
    subject: null,
  },
  brief: {
    currentStatus: null,
    summary: 'A payments company that reported cash it did not have.',
    turningPoint: 'The auditors could not find the 1.9 billion.',
    cast: [
      {
        name: 'Markus Braun',
        role: 'chief executive',
        wanted: 'To be the next big payments platform.',
        ref: null,
      },
    ],
    toldAlready: [],
    openQuestions: [],
  },
  scenes: [],
  answers: [],
  corpus: { read: 4, unread: 0, failed: 0 },
  ...over,
})

const withQuestions = (
  openQuestions: string[],
  answers: GroundedResearch['answers'],
): GroundedResearch => {
  const base = grounded({ answers })
  return { ...base, brief: { ...base.brief, openQuestions } }
}

const claim = (over: Partial<GroundedClaim> = {}): GroundedClaim => ({
  text: 'Wirecard reported 1.9 billion euros it did not have.',
  sourceUrl: 'https://example.com/story',
  sourceType: 'major_outlet',
  confidence: 'sourced',
  legalStatus: 'none',
  legalStatusDate: null,
  legalStatusDocumentId: null,
  series: null,
  supports: [],
  ...over,
})

describe('renderDossierMarkdown', () => {
  const render = (research: GroundedResearch, claims: GroundedClaim[] = []) =>
    renderDossierMarkdown({ caseTitle: 'Wirecard', research, claims })

  it('leads with the title, the summary and the turn', () => {
    const md = render(grounded())
    expect(md.startsWith('# Wirecard\n\n## Summary\n\nA payments company')).toBe(true)
    expect(md).toContain('## The turn\n\nThe auditors could not find the 1.9 billion.')
  })

  it('lists the principals with what each one wanted', () => {
    expect(render(grounded())).toContain(
      '## Principals\n\n- **Markus Braun** — chief executive. *To be the next big payments platform.*',
    )
  })

  it('renders scenes with a timestamped source and marks an unplaced one', () => {
    const md = render(
      grounded({
        scenes: [
          scene({
            ref: { url: 'https://youtube.com/watch?v=abc', locatorSeconds: 65, found: true },
          }),
          scene({ ref: { found: false } }),
        ],
      }),
    )
    expect(md).toContain('([source](https://youtube.com/watch?v=abc&t=65))')
    expect(md).toContain('(unplaced)')
    expect(md).toContain(
      '- **June 2020** — Resigned as chief executive (Markus Braun). *The founder leaves the stage.* ([source](https://example.com/story)) (unplaced)',
    )
  })

  it('starts a query for a timestamp on a link that has none', () => {
    const md = render(
      grounded({ scenes: [scene({ ref: { url: 'https://youtu.be/abc', locatorSeconds: 5 } })] }),
    )
    expect(md).toContain('([source](https://youtu.be/abc?t=5))')
  })

  it('omits Told already when empty and lists beats otherwise', () => {
    expect(render(grounded())).not.toContain('## Told already')

    const base = grounded()
    const md = renderDossierMarkdown({
      caseTitle: 'Wirecard',
      research: {
        ...base,
        brief: {
          ...base.brief,
          toldAlready: [
            {
              beat: 'The FT investigation and the short sellers.',
              ref: ref({ documentId: 'video-1', url: 'https://youtube.com/watch?v=v1' }),
            },
            {
              beat: 'The raid on the Aschheim office.',
              ref: ref({ documentId: 'video-2', url: 'https://youtube.com/watch?v=v2' }),
            },
          ],
        },
      },
      claims: [],
      documents: [{ id: 'video-1', title: 'How [Wirecard] fooled everyone' }],
    })
    expect(md).toContain('## Told already')
    expect(md).toContain(
      '- The FT investigation and the short sellers. ([How (Wirecard) fooled everyone](https://youtube.com/watch?v=v1))',
    )
    expect(md).toContain(
      '- The raid on the Aschheim office. ([https://youtube.com/watch?v=v2](https://youtube.com/watch?v=v2))',
    )
  })

  it('puts open questions in the document when nothing answered them', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?'],
        [{ index: 1, question: 'What did the board know in 2019?', answer: null, ref: null }],
      ),
    )
    expect(md).not.toContain('## Questions the research answered')
    expect(md).toContain('## Open questions\n\n- What did the board know in 2019?')
  })

  it('places an answer by its index, under the brief wording, linked to its document', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?', 'Who leaked it?'],
        [
          {
            index: 1,
            question: "What was the board's knowledge?",
            answer: 'The special audit found the board was told in 2019.',
            ref: ref({ url: 'https://example.com/kpmg' }),
          },
        ],
      ),
    )
    expect(md).toContain(
      '- **What did the board know in 2019?** — The special audit found the board was told in 2019. ([source](https://example.com/kpmg))',
    )
    expect(md).not.toContain("What was the board's knowledge?")
    expect(md).toContain('## Open questions\n\n- Who leaked it?')
  })

  it('falls back to the folded text when the index is missing or outside the list', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?', 'Who leaked it?'],
        [
          {
            index: 7,
            question: 'What did the board know in 2019.',
            answer: 'The special audit found the board was told.',
            ref: null,
          },
          { question: 'who leaked it', answer: 'A whistleblower in Singapore did.', ref: null },
        ],
      ),
    )
    expect(md).toContain('- **What did the board know in 2019?** — The special audit')
    expect(md).toContain('- **Who leaked it?** — A whistleblower in Singapore did.')
    expect(md).not.toContain('## Open questions')
  })

  it('never discards a real answer it cannot place: it renders under its own words', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?'],
        [
          {
            question: 'How much cash was missing?',
            answer: 'About 1.9 billion euros, per the special audit.',
            ref: null,
          },
        ],
      ),
    )
    expect(md).toContain('- **How much cash was missing?** — About 1.9 billion euros')
    expect(md).toContain('## Open questions\n\n- What did the board know in 2019?')
  })

  it('keeps a second answer to an already answered question, under its own words', () => {
    const md = render(
      withQuestions(
        ['What did the board know in 2019?'],
        [
          {
            index: 1,
            question: 'What did the board know in 2019?',
            answer: 'The special audit found the board was told.',
            ref: null,
          },
          {
            index: 1,
            question: 'When was the board first warned?',
            answer: 'A whistleblower wrote to the board in 2018.',
            ref: null,
          },
        ],
      ),
    )
    expect(md).toContain('- **What did the board know in 2019?** — The special audit')
    expect(md).toContain('- **When was the board first warned?** — A whistleblower wrote')
    expect(md).not.toContain('## Open questions')
  })

  it('says how many claims are unverified, and nothing when none is', () => {
    const md = render(grounded(), [claim({ confidence: 'unverified' }), claim()])
    expect(md).toContain('## Unverified')
    expect(md).toContain('1 claim(s)')
    expect(md).toContain('excluded from scripting')
    expect(render(grounded(), [claim()])).not.toContain('## Unverified')
  })

  it('writes italics with asterisks only, never underscores', () => {
    const md = render(grounded({ scenes: [scene()] }))
    expect(md).not.toMatch(/(^|\s)_\S/m)
  })

  it('is a pure function of its input', () => {
    const research = grounded({ scenes: [scene()] })
    expect(render(research, [claim()])).toBe(render(research, [claim()]))
  })
})
