import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * AES-256-GCM for provider API keys and the YouTube refresh token
 * (build spec section 4). The key is `SECRETS_ENCRYPTION_KEY`, a base64
 * 32-byte value validated at boot.
 *
 * Ciphertext format: `v1.<iv>.<authTag>.<ciphertext>`, each part base64url.
 * The version prefix exists so a future key rotation can re-encrypt in place
 * without guessing at the old format.
 */

const VERSION = 'v1'
const IV_BYTES = 12 // GCM standard
const KEY_BYTES = 32

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptionError'
  }
}

function toKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new DecryptionError(
      `SECRETS_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes, got ${key.length}`,
    )
  }
  return key
}

export function encryptSecret(plaintext: string, keyB64: string): string {
  const key = toKey(keyB64)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSecret(payload: string, keyB64: string): string {
  const key = toKey(keyB64)
  const parts = payload.split('.')
  if (parts.length !== 4) {
    throw new DecryptionError('Malformed ciphertext: expected 4 dot-separated parts')
  }
  const [version, ivB64, tagB64, dataB64] = parts as [string, string, string, string]
  if (version !== VERSION) {
    throw new DecryptionError(`Unsupported ciphertext version "${version}"`)
  }

  const iv = Buffer.from(ivB64, 'base64url')
  const tag = Buffer.from(tagB64, 'base64url')
  if (iv.length !== IV_BYTES || tag.length !== 16) {
    throw new DecryptionError('Malformed ciphertext: bad IV or auth tag length')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // Wrong key or tampered payload — GCM cannot tell us which, and it does
    // not matter: both mean "do not trust this value".
    throw new DecryptionError('Authentication failed: wrong key or tampered ciphertext')
  }
}

/** Last four characters, stored alongside the ciphertext for masked display. */
export function keyHint(plaintext: string): string {
  return plaintext.slice(-4)
}

/**
 * The Settings -> Connections display, e.g. `••••4f2a`. A key is never
 * returned to the client after save (spec section 4), so this is built from
 * the stored hint, never from the decrypted value.
 */
export function maskKey(hint: string): string {
  return `••••${hint}`
}

/** Constant-time comparison for broker tokens and webhook HMACs. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
