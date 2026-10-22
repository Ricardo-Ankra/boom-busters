import { describe, expect, it } from 'vitest'
import { documentByNumber, renderCorpus, type CorpusDocument } from './corpus'

const docs: CorpusDocument[] = [
  {
    id: 'a',
    url: 'https://example.com/ey',
    kind: 'reporting',
    title: 'EY refuses',
    publishedAt: '2020-06-25',
    text: 'First body.',
    archivedUrl: null,
    httpStatus: 200,
  },
  {
    id: 'b',
    url: 'https://example.com/b',
    kind: 'filing',
    title: null,
    publishedAt: null,
    text: 'Second body.',
    archivedUrl: null,
    httpStatus: null,
  },
]

describe('renderCorpus', () => {
  it('numbers documents in order and renders a header line each', () => {
    const out = renderCorpus(docs)
    expect(out).toMatch(/^\[D1\] reporting · EY refuses · 2020-06-25 · https:/)
    expect(out).toContain(
      '\n\n----\n\n[D2] filing · https://example.com/b · undated · https://example.com/b\nSecond body.',
    )
  })

  it('finds a document by its D number', () => {
    expect(documentByNumber(docs, 2)?.id).toBe('b')
    expect(documentByNumber(docs, 0)).toBeUndefined()
    expect(documentByNumber(docs, 3)).toBeUndefined()
  })
})
