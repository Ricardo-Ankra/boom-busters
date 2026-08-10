import { describe, expect, it } from 'vitest'
import { isAllowedEmail } from './auth-allowlist'

const OWNER = 'owner@example.com'

describe('isAllowedEmail', () => {
  it('admits exactly the owner', () => {
    expect(isAllowedEmail(OWNER, OWNER)).toBe(true)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(isAllowedEmail('Owner@Example.COM', OWNER)).toBe(true)
    expect(isAllowedEmail('  owner@example.com  ', OWNER)).toBe(true)
    expect(isAllowedEmail(OWNER, '  OWNER@EXAMPLE.COM ')).toBe(true)
  })

  it('rejects every other account', () => {
    expect(isAllowedEmail('someone@example.com', OWNER)).toBe(false)
    expect(isAllowedEmail('owner@example.com.evil.com', OWNER)).toBe(false)
    expect(isAllowedEmail('owner+alias@example.com', OWNER)).toBe(false)
    expect(isAllowedEmail('owner@example.co', OWNER)).toBe(false)
  })

  it('rejects a missing email rather than treating it as a match', () => {
    expect(isAllowedEmail(null, OWNER)).toBe(false)
    expect(isAllowedEmail(undefined, OWNER)).toBe(false)
    expect(isAllowedEmail('', OWNER)).toBe(false)
    expect(isAllowedEmail('   ', OWNER)).toBe(false)
  })

  it('fails closed when OWNER_EMAIL is unset or blank', () => {
    // The dangerous case: a misconfigured deploy must lock everyone out,
    // never let everyone in.
    expect(isAllowedEmail('anyone@example.com', '')).toBe(false)
    expect(isAllowedEmail('anyone@example.com', '   ')).toBe(false)
    expect(isAllowedEmail('', '')).toBe(false)
  })
})
