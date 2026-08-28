import { describe, expect, it } from 'vitest'
import {
  anchorClaims,
  claimOverlap,
  inlineText,
  overlayAnchors,
  parseDossier,
  parseInline,
  type InlineSegment,
} from './dossier-markdown'

describe('parseDossier', () => {
  it('parses headings at every depth it renders', () => {
    const blocks = parseDossier('# One\n\n## Two\n\n### Three')
    expect(blocks).toEqual([
      { kind: 'heading', depth: 1, inline: [{ kind: 'text', text: 'One' }] },
      { kind: 'heading', depth: 2, inline: [{ kind: 'text', text: 'Two' }] },
      { kind: 'heading', depth: 3, inline: [{ kind: 'text', text: 'Three' }] },
    ])
  })

  it('joins hard-wrapped paragraph lines into one paragraph', () => {
    const blocks = parseDossier('First line\nsecond line.\n\nNext paragraph.')
    expect(blocks).toHaveLength(2)
    expect(inlineText((blocks[0] as { inline: InlineSegment[] }).inline)).toBe(
      'First line second line.',
    )
  })

  it('parses a bulleted list with an indented continuation line as one item', () => {
    const blocks = parseDossier(
      '- The claim is unverified and must be either\n  sourced or quarantined.\n- Second item.',
    )
    expect(blocks).toEqual([
      {
        kind: 'list',
        ordered: false,
        items: [
          [
            {
              kind: 'text',
              text: 'The claim is unverified and must be either sourced or quarantined.',
            },
          ],
          [{ kind: 'text', text: 'Second item.' }],
        ],
      },
    ])
  })

  it('parses an ordered list', () => {
    const blocks = parseDossier('1. First\n2. Second')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true })
    expect((blocks[0] as { items: InlineSegment[][] }).items).toHaveLength(2)
  })

  it('survives CRLF line endings', () => {
    const blocks = parseDossier('# Title\r\n\r\nBody text.')
    expect(blocks).toHaveLength(2)
  })
})

describe('parseInline', () => {
  it('parses bold, italic and links', () => {
    expect(
      parseInline('**1999** — founded, *allegedly*, per [FT](https://ft.com/wirecard)'),
    ).toEqual([
      { kind: 'strong', text: '1999' },
      { kind: 'text', text: ' — founded, ' },
      { kind: 'em', text: 'allegedly' },
      { kind: 'text', text: ', per ' },
      { kind: 'link', text: 'FT', href: 'https://ft.com/wirecard' },
    ])
  })

  it('treats raw HTML and non-http links as literal text — model output is not markup', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { kind: 'text', text: '<script>alert(1)</script>' },
    ])
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1))' },
    ])
  })

  it('leaves unmatched markers as literal text', () => {
    expect(parseInline('a * b ** c')).toEqual([{ kind: 'text', text: 'a * b ** c' }])
  })
})

describe('claimOverlap', () => {
  it('is 1 for the claim restated verbatim', () => {
    const text = 'Wirecard AG filed for insolvency in June 2020.'
    expect(claimOverlap(text, text)).toBe(1)
  })

  it('scores a paraphrase sharing names and figures above the unrelated floor', () => {
    const claim =
      'Wirecard reported €1.9 billion in Philippine trustee accounts that auditors could not confirm existed.'
    const paraphrase =
      'Auditors could not confirm the €1.9bn Wirecard reported in Philippine trustee accounts existed.'
    const unrelated = 'The company was founded in Munich as a payment processor.'
    expect(claimOverlap(claim, paraphrase)).toBeGreaterThan(0.8)
    expect(claimOverlap(claim, unrelated)).toBeLessThan(0.2)
  })

  it('folds bn against billion so the same figure matches either spelling', () => {
    expect(claimOverlap('worth €24 billion', 'worth €24bn')).toBe(1)
  })
})

describe('anchorClaims', () => {
  const md = [
    '# Dossier',
    '',
    'Wirecard AG filed for insolvency in June 2020, days after its auditors refused to sign off the accounts. The collapse ended a decade of growth.',
    '',
    '- EY declined to issue an audit opinion on the 2019 accounts, saying it',
    '  could not verify around €1.9 billion in trustee balances.',
  ].join('\n')

  it('anchors a verbatim claim to exactly its own range', () => {
    const blocks = parseDossier(md)
    const { anchors, unanchoredIds } = anchorClaims(blocks, [
      {
        id: 'c1',
        text: 'Wirecard AG filed for insolvency in June 2020, days after its auditors refused to sign off the accounts.',
      },
    ])
    expect(unanchoredIds).toEqual([])
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ blockIndex: 1, itemIndex: null, start: 0 })
  })

  it('anchors a verbatim claim inside a hard-wrapped list item', () => {
    const blocks = parseDossier(md)
    const { anchors } = anchorClaims(blocks, [
      {
        id: 'c2',
        text: 'EY declined to issue an audit opinion on the 2019 accounts, saying it could not verify around €1.9 billion in trustee balances.',
      },
    ])
    expect(anchors).toHaveLength(1)
    expect(anchors[0]).toMatchObject({ blockIndex: 2, itemIndex: 0 })
  })

  it('falls back to the best sentence for a close paraphrase', () => {
    const blocks = parseDossier(md)
    const { anchors, unanchoredIds } = anchorClaims(blocks, [
      {
        id: 'c3',
        text: 'Wirecard filed for insolvency in June 2020 after auditors refused to sign the accounts.',
      },
    ])
    expect(unanchoredIds).toEqual([])
    // The first sentence of the paragraph, not the whole paragraph.
    expect(anchors[0]).toMatchObject({ blockIndex: 1, itemIndex: null, start: 0 })
    expect(anchors[0]?.end).toBeLessThan(120)
  })

  it('reports a claim the document never states as unanchored, not force-fitted', () => {
    const blocks = parseDossier(md)
    const { anchors, unanchoredIds } = anchorClaims(blocks, [
      {
        id: 'c4',
        text: 'Jan Marsalek is alleged to have maintained contacts with foreign intelligence services.',
      },
    ])
    expect(anchors).toEqual([])
    expect(unanchoredIds).toEqual(['c4'])
  })

  it('never anchors to a heading', () => {
    const blocks = parseDossier('# Wirecard filed for insolvency in June 2020')
    const { unanchoredIds } = anchorClaims(blocks, [
      { id: 'c5', text: 'Wirecard filed for insolvency in June 2020' },
    ])
    expect(unanchoredIds).toEqual(['c5'])
  })

  it('matches through curly quotes and case differences', () => {
    const blocks = parseDossier('Wirecard’s auditors refused to sign, the FT reported.')
    const { anchors } = anchorClaims(blocks, [
      { id: 'c6', text: "wirecard's auditors refused to sign, the ft reported." },
    ])
    expect(anchors).toHaveLength(1)
  })

  it('lets two claims share one sentence', () => {
    const blocks = parseDossier(
      'Markus Braun resigned in June 2020 and was arrested days later, while Jan Marsalek left Germany the same month.',
    )
    const { anchors } = anchorClaims(blocks, [
      { id: 'a', text: 'Markus Braun resigned in June 2020 and was arrested days later.' },
      { id: 'b', text: 'Jan Marsalek left Germany in June 2020.' },
    ])
    expect(anchors.map((anchor) => anchor.claimId).sort()).toEqual(['a', 'b'])
  })
})

describe('overlayAnchors', () => {
  it('returns plain pieces untouched when nothing anchors', () => {
    const inline = parseInline('Just prose.')
    expect(overlayAnchors(inline, [])).toEqual([
      { segment: { kind: 'text', text: 'Just prose.' }, claimIds: [] },
    ])
  })

  it('splits a segment at highlight boundaries', () => {
    const inline = parseInline('before CLAIM after')
    const pieces = overlayAnchors(inline, [{ start: 7, end: 12, claimId: 'c1' }])
    expect(pieces).toEqual([
      { segment: { kind: 'text', text: 'before ' }, claimIds: [] },
      { segment: { kind: 'text', text: 'CLAIM' }, claimIds: ['c1'] },
      { segment: { kind: 'text', text: ' after' }, claimIds: [] },
    ])
  })

  it('keeps formatting when a highlight crosses a bold run', () => {
    const inline = parseInline('The **€1.9bn** vanished entirely.')
    // Highlight "€1.9bn vanished" — starts inside the bold, ends in plain text.
    const pieces = overlayAnchors(inline, [{ start: 4, end: 19, claimId: 'c1' }])
    expect(pieces).toEqual([
      { segment: { kind: 'text', text: 'The ' }, claimIds: [] },
      { segment: { kind: 'strong', text: '€1.9bn' }, claimIds: ['c1'] },
      { segment: { kind: 'text', text: ' vanished' }, claimIds: ['c1'] },
      { segment: { kind: 'text', text: ' entirely.' }, claimIds: [] },
    ])
  })

  it('stacks overlapping claims on the shared piece', () => {
    const inline = parseInline('one two three')
    const pieces = overlayAnchors(inline, [
      { start: 0, end: 7, claimId: 'a' },
      { start: 4, end: 13, claimId: 'b' },
    ])
    expect(pieces.map((piece) => piece.claimIds)).toEqual([['a'], ['a', 'b'], ['b']])
  })
})
