// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { EXEMPLAR_LOGO } from '@/lib/exemplar-translate'
import { EXEMPLAR_LOGO_TITLE, exemplarCodeLogos, exemplarLogoFor } from './exemplar-logo'

const MARK = {
  id: '01J00000000000000000000MK1',
  r2Key: 'boom-busters/logos/mark.png',
  width: 800,
  height: 400,
  url: 'https://r2.test/mark.png?signed',
}

describe('the channel mark in the Exemplars tab (decision 305)', () => {
  it('plays under the title the logo-reveal example was checked with', () => {
    expect(EXEMPLAR_LOGO_TITLE).toBe(EXEMPLAR_LOGO.title)
  })

  it('finds the Brand Kit mark in the library when it can be loaded and laid out', () => {
    const other = { ...MARK, id: 'other', r2Key: 'boom-busters/logos/other.png' }
    expect(exemplarLogoFor([other, MARK], MARK.r2Key)).toEqual({
      assetId: MARK.id,
      url: MARK.url,
      width: 800,
      height: 400,
    })
  })

  it.each([
    ['no channel mark is set', [MARK], null],
    ['the key is not in the library', [MARK], 'boom-busters/logos/gone.png'],
    ['the mark has no URL (mock storage)', [{ ...MARK, url: null }], MARK.r2Key],
    ['the mark has no recorded size', [{ ...MARK, width: null }], MARK.r2Key],
  ] as const)('is null when %s', (_, logos, key) => {
    expect(exemplarLogoFor(logos, key)).toBeNull()
  })

  it('hands the mark to the logo-reveal example only', () => {
    const logo = exemplarLogoFor([MARK], MARK.r2Key)
    expect(exemplarCodeLogos('logo-reveal', logo)).toEqual({ Acme: logo })
    expect(exemplarCodeLogos('stat-counter', logo)).toEqual({})
    expect(exemplarCodeLogos('logo-reveal', null)).toEqual({})
  })
})
