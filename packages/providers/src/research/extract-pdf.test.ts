import { describe, expect, it } from 'vitest'
import { pdfToText } from './extract-pdf'
import { fixtureBytes } from './test-fixtures'

describe('pdfToText', () => {
  it('reads a one-page pdf', async () => {
    expect(await pdfToText(fixtureBytes('one-page.pdf'))).toContain('Hello dossier')
  })
})
