import { describe, expect, it } from 'vitest'
import {
  DecryptionError,
  decryptSecret,
  encryptSecret,
  keyHint,
  maskKey,
  safeEqual,
} from './crypto'

const KEY = Buffer.alloc(32, 1).toString('base64')
const OTHER_KEY = Buffer.alloc(32, 2).toString('base64')

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a provider API key', () => {
    const secret = 'sk-ant-api03-abcdefghijklmnop4f2a'
    expect(decryptSecret(encryptSecret(secret, KEY), KEY)).toBe(secret)
  })

  it('round-trips unicode and empty values', () => {
    expect(decryptSecret(encryptSecret('', KEY), KEY)).toBe('')
    expect(decryptSecret(encryptSecret('clé—ünïcode', KEY), KEY)).toBe('clé—ünïcode')
  })

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-secret', KEY)
    const b = encryptSecret('same-secret', KEY)
    expect(a).not.toBe(b)
    expect(decryptSecret(a, KEY)).toBe(decryptSecret(b, KEY))
  })

  it('emits a versioned four-part payload', () => {
    const parts = encryptSecret('x', KEY).split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
  })

  it('never leaks the plaintext into the ciphertext', () => {
    expect(encryptSecret('sk-supersecret', KEY)).not.toContain('supersecret')
  })

  it('rejects the wrong key', () => {
    const payload = encryptSecret('sk-secret', KEY)
    expect(() => decryptSecret(payload, OTHER_KEY)).toThrow(DecryptionError)
  })

  it('rejects a tampered ciphertext', () => {
    const parts = encryptSecret('sk-secret', KEY).split('.')
    const data = Buffer.from(parts[3] as string, 'base64url')
    data[0] = (data[0]! ^ 0xff) & 0xff
    const tampered = [parts[0], parts[1], parts[2], data.toString('base64url')].join('.')
    expect(() => decryptSecret(tampered, KEY)).toThrow(DecryptionError)
  })

  it('rejects a tampered auth tag', () => {
    const parts = encryptSecret('sk-secret', KEY).split('.')
    const tag = Buffer.from(parts[2] as string, 'base64url')
    tag[0] = (tag[0]! ^ 0xff) & 0xff
    const tampered = [parts[0], parts[1], tag.toString('base64url'), parts[3]].join('.')
    expect(() => decryptSecret(tampered, KEY)).toThrow(DecryptionError)
  })

  it('rejects a malformed payload', () => {
    expect(() => decryptSecret('not-a-payload', KEY)).toThrow(DecryptionError)
    expect(() => decryptSecret('v1.a.b', KEY)).toThrow(DecryptionError)
  })

  it('rejects an unknown ciphertext version', () => {
    const payload = encryptSecret('x', KEY).replace(/^v1\./, 'v2.')
    expect(() => decryptSecret(payload, KEY)).toThrow(/Unsupported ciphertext version/)
  })

  it('rejects an encryption key that is not 32 bytes', () => {
    const short = Buffer.alloc(16).toString('base64')
    expect(() => encryptSecret('x', short)).toThrow(DecryptionError)
    expect(() => decryptSecret(encryptSecret('x', KEY), short)).toThrow(DecryptionError)
  })
})

describe('keyHint / maskKey', () => {
  it('keeps only the last four characters', () => {
    expect(keyHint('sk-ant-api03-abcdef4f2a')).toBe('4f2a')
  })

  it('renders a mask that reveals nothing but the hint', () => {
    const masked = maskKey(keyHint('sk-ant-api03-abcdef4f2a'))
    expect(masked).toBe('••••4f2a')
    expect(masked).not.toContain('abcdef')
  })
})

describe('safeEqual', () => {
  it('matches identical strings and rejects differing ones', () => {
    expect(safeEqual('token-abc', 'token-abc')).toBe(true)
    expect(safeEqual('token-abc', 'token-abd')).toBe(false)
    expect(safeEqual('token-abc', 'token-abcd')).toBe(false)
    expect(safeEqual('', '')).toBe(true)
  })
})
