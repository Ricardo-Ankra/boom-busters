import { describe, expect, it } from 'vitest'
import {
  BRIDGE_SIGNATURE_HEADER,
  BRIDGE_TIMESTAMP_HEADER,
  MAX_CLOCK_SKEW_MS,
  signBridgeRequest,
  verifyBridgeSignature,
} from './bridge-protocol'

const SECRET = 'a-secret-that-is-long-enough-for-hmac-0123'
const NOW = 1_800_000_000_000
const request = { method: 'POST', path: '/complete', body: '{"model":"claude-opus-5"}' }

function signed(overrides: Partial<typeof request> = {}, now = NOW) {
  const headers = signBridgeRequest(SECRET, { ...request, ...overrides }, now)
  return {
    ...request,
    ...overrides,
    timestamp: headers[BRIDGE_TIMESTAMP_HEADER],
    signature: headers[BRIDGE_SIGNATURE_HEADER],
  }
}

describe('bridge request signing (decision 469)', () => {
  it('accepts a request signed with the same secret', () => {
    expect(verifyBridgeSignature(SECRET, signed(), NOW)).toBe('ok')
  })

  it('refuses a request whose body was changed after signing', () => {
    expect(verifyBridgeSignature(SECRET, { ...signed(), body: '{"model":"x"}' }, NOW)).toBe(
      'mismatch',
    )
  })

  it('refuses a request signed for another path or method', () => {
    expect(verifyBridgeSignature(SECRET, { ...signed(), path: '/health' }, NOW)).toBe('mismatch')
    expect(verifyBridgeSignature(SECRET, { ...signed(), method: 'GET' }, NOW)).toBe('mismatch')
  })

  it('refuses a request signed with a different secret', () => {
    expect(verifyBridgeSignature(`${SECRET}-other`, signed(), NOW)).toBe('mismatch')
  })

  it('refuses a replay older than the allowed skew, even with a good signature', () => {
    expect(verifyBridgeSignature(SECRET, signed(), NOW + MAX_CLOCK_SKEW_MS + 1)).toBe('stale')
    expect(verifyBridgeSignature(SECRET, signed(), NOW + MAX_CLOCK_SKEW_MS)).toBe('ok')
  })

  it('refuses a request without the headers', () => {
    expect(
      verifyBridgeSignature(
        SECRET,
        { ...request, timestamp: undefined, signature: undefined },
        NOW,
      ),
    ).toBe('missing')
  })

  it('refuses a signature of the wrong length without throwing', () => {
    expect(verifyBridgeSignature(SECRET, { ...signed(), signature: 'abcd' }, NOW)).toBe('mismatch')
  })
})
