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

  it('returns empty text for a document with no body', async () => {
    expect((await extractText(doc(null, null), 'reporting')).text).toBe('')
  })
})
