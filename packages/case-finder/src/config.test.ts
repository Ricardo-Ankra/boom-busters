import { describe, expect, it } from 'vitest'
import { EDGAR_FORMS, EDGAR_8K_DOWNFALL_ITEM, PRIMARY_HOSTS } from './config'

describe('source config', () => {
  it('pins the EDGAR forms and the 8-K item', () => {
    expect(EDGAR_FORMS.downfall).toContain('NT 10-K')
    expect(EDGAR_FORMS.success).toContain('424B4')
    expect(EDGAR_8K_DOWNFALL_ITEM).toBe('4.02')
    expect(PRIMARY_HOSTS).toContain('sec.gov')
  })
})
