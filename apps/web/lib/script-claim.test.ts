import { describe, expect, it } from 'vitest'
import { toScriptClaim } from './script-claim'

describe('toScriptClaim', () => {
  it('carries the id, text, source, confidence, source type and legal status', () => {
    expect(
      toScriptClaim({
        id: 'c1',
        text: 'EY refused to sign.',
        sourceUrl: 'https://example.com/a',
        confidence: 'sourced',
        sourceType: 'major_outlet',
        legalStatus: 'alleged',
      }),
    ).toEqual({
      id: 'c1',
      text: 'EY refused to sign.',
      sourceUrl: 'https://example.com/a',
      confidence: 'sourced',
      sourceType: 'major_outlet',
      legal: 'alleged',
    })
  })

  it('keeps a missing source url as null', () => {
    expect(
      toScriptClaim({
        id: 'c2',
        text: 't',
        sourceUrl: null,
        confidence: 'unverified',
        sourceType: 'major_outlet',
        legalStatus: 'none',
      }).sourceUrl,
    ).toBeNull()
  })
})
