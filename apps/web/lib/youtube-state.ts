import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * The OAuth `state` parameter for the YouTube connect flow (multi-channel
 * design, section 4.2). It names the channel the grant belongs to, and a
 * signature over channel id and nonce stops anyone swapping the channel on
 * the way back. The nonce itself lives in an httpOnly cookie, so a state
 * replayed from another browser fails too.
 */

function signature(channelId: string, nonce: string, key: string): string {
  return createHmac('sha256', key).update(`${channelId}.${nonce}`).digest('hex')
}

export function signOauthState(channelId: string, nonce: string, key: string): string {
  const raw = `${channelId}.${nonce}.${signature(channelId, nonce, key)}`
  return Buffer.from(raw, 'utf8').toString('base64url')
}

export function verifyOauthState(
  state: string,
  nonce: string,
  key: string,
): { channelId: string } | null {
  const parts = Buffer.from(state, 'base64url').toString('utf8').split('.')
  if (parts.length !== 3) return null
  const [channelId, stateNonce, given] = parts as [string, string, string]
  if (!channelId || !nonce || stateNonce !== nonce) return null

  const expected = Buffer.from(signature(channelId, nonce, key), 'utf8')
  const actual = Buffer.from(given, 'utf8')
  if (expected.length !== actual.length) return null
  if (!timingSafeEqual(expected, actual)) return null
  return { channelId }
}
