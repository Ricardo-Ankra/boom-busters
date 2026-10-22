import { describe, expect, it } from 'vitest'
import { htmlToText } from './extract-html'
import { fixture } from './test-fixtures'

describe('htmlToText', () => {
  it('extracts the article body and drops navigation', () => {
    const out = htmlToText(fixture('article.html'))
    expect(out.text).toContain('EY refused')
    expect(out.text).not.toContain('Subscribe')
    expect(out.text).not.toContain('tracking')
    expect(out.publishedAt).toBe('2020-06-25')
    expect(out.title).toBe('Auditor walks away - The Ledger')
    expect(out.text).toContain('accounts after months')
    expect(out.text).toContain('\n\n')
  })

  it('reads a JSON-LD date and falls back to the body', () => {
    const out = htmlToText(
      '<html><head><script type="application/ld+json">{"datePublished":"2019-03-04T10:00:00+00:00"}</script></head><body><p>Plain</p></body></html>',
    )
    expect(out.publishedAt).toBe('2019-03-04')
    expect(out.text).toBe('Plain')
    expect(out.title).toBeNull()
  })

  it('separates table cells so a heading is not run together', () => {
    const out = htmlToText('<body><table><tr><td>Item 1.</td><td>Business</td></tr></table></body>')
    expect(out.text).toBe('Item 1. Business')
  })
})
