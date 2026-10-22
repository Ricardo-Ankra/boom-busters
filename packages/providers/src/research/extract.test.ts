import { describe, expect, it } from 'vitest'
import { extractText } from './extract'
import type { FetchedDocument } from './fetch'
import { fixture, fixtureBytes } from './test-fixtures'

function doc(contentType: string | null, body: Uint8Array | null): FetchedDocument {
  return {
    url: 'https://example.com/x',
    finalUrl: 'https://example.com/x',
    httpStatus: 200,
    contentType,
    body,
    archivedUrl: null,
    failure: null,
  }
}

const enc = new TextEncoder()

describe('extractText', () => {
  it('routes by content type', async () => {
    const html = await extractText(
      doc('text/html; charset=utf-8', enc.encode(fixture('article.html'))),
      'reporting',
    )
    expect(html.text).toContain('EY refused')
    const pdf = await extractText(doc('application/pdf', fixtureBytes('one-page.pdf')), 'reporting')
    expect(pdf.text).toContain('Hello dossier')
    const plain = await extractText(doc('text/plain', enc.encode('just text')), 'reporting')
    expect(plain.text).toBe('just text')
  })

  it('narrows a 10-K filing to its items', async () => {
    const out = await extractText(doc('text/plain', enc.encode(fixture('tenk.txt'))), 'filing')
    expect(out.text).toContain('We operate')
    expect(out.text).not.toContain('Risk factors body')
  })

  it('reads a PDF sent as octet-stream by its opening bytes', async () => {
    const out = await extractText(
      doc('application/octet-stream', fixtureBytes('one-page.pdf')),
      'reporting',
    )
    expect(out).toMatchObject({ failure: null })
    expect(out.text).toContain('Hello dossier')
  })

  it('reads XML and JSON as text', async () => {
    const xml = await extractText(doc('application/rss+xml', enc.encode('<a>b</a>')), 'reporting')
    expect(xml).toMatchObject({ text: '<a>b</a>', failure: null })
    const json = await extractText(doc('application/json', enc.encode('{"a":1}')), 'figures')
    expect(json).toMatchObject({ text: '{"a":1}', failure: null })
  })

  it('refuses an image or a zip instead of decoding it as text', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
    expect(await extractText(doc('image/png', png), 'reporting')).toEqual({
      title: null,
      text: '',
      publishedAt: null,
      failure: 'not a text document (image/png)',
    })
    const zip = await extractText(doc('application/zip', png), 'reporting')
    expect(zip.failure).toBe('not a text document (application/zip)')
    const unlabelled = await extractText(doc(null, png), 'reporting')
    expect(unlabelled.failure).toBe('not a text document (unknown type)')
    const plain = await extractText(doc(null, enc.encode('no header')), 'reporting')
    expect(plain).toMatchObject({ text: 'no header', failure: null })
  })

  it('returns empty text for a document with no body', async () => {
    expect((await extractText(doc(null, null), 'reporting')).text).toBe('')
  })
})
