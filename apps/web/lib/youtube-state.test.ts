// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { signOauthState, verifyOauthState } from './youtube-state'

const KEY = 'k'.repeat(44)
const CHANNEL = '01J00000000000000000000001'
const NONCE = 'nonce-abcdef'

function decode(state: string): string {
  return Buffer.from(state, 'base64url').toString('utf8')
}

function encode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url')
}

describe('OAuth state', () => {
  it('round trips the channel id', () => {
    const state = signOauthState(CHANNEL, NONCE, KEY)
    expect(verifyOauthState(state, NONCE, KEY)).toEqual({ channelId: CHANNEL })
  })

  it('is base64url of channelId.nonce.hmac', () => {
    const parts = decode(signOauthState(CHANNEL, NONCE, KEY)).split('.')
    expect(parts[0]).toBe(CHANNEL)
    expect(parts[1]).toBe(NONCE)
    expect(parts[2]).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses a tampered channel id', () => {
    const parts = decode(signOauthState(CHANNEL, NONCE, KEY)).split('.')
    const forged = encode(['01J00000000000000000000002', parts[1], parts[2]].join('.'))
    expect(verifyOauthState(forged, NONCE, KEY)).toBeNull()
  })

  it('refuses a wrong nonce', () => {
    const state = signOauthState(CHANNEL, NONCE, KEY)
    expect(verifyOauthState(state, 'another-nonce', KEY)).toBeNull()
  })

  it('refuses a wrong key', () => {
    const state = signOauthState(CHANNEL, NONCE, KEY)
    expect(verifyOauthState(state, NONCE, 'z'.repeat(44))).toBeNull()
  })

  it('refuses garbage and truncated signatures without throwing', () => {
    expect(verifyOauthState('', NONCE, KEY)).toBeNull()
    expect(verifyOauthState('not-a-state', NONCE, KEY)).toBeNull()
    const parts = decode(signOauthState(CHANNEL, NONCE, KEY)).split('.')
    const short = encode([parts[0], parts[1], parts[2]!.slice(0, 10)].join('.'))
    expect(verifyOauthState(short, NONCE, KEY)).toBeNull()
  })
})
