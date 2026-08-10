import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  DEFERRED_GROUPS,
  EnvValidationError,
  hasEnvGroup,
  isMockMode,
  parseBootEnv,
  requireEnv,
} from './env'

const VALID_KEY = Buffer.alloc(32, 7).toString('base64')

const validBootEnv = (): Record<string, string> => ({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/boom_busters',
  AUTH_SECRET: 'a'.repeat(44),
  AUTH_URL: 'http://localhost:3000',
  AUTH_GOOGLE_ID: 'client-id.apps.googleusercontent.com',
  AUTH_GOOGLE_SECRET: 'GOCSPX-secret',
  OWNER_EMAIL: 'owner@example.com',
  SECRETS_ENCRYPTION_KEY: VALID_KEY,
})

describe('parseBootEnv', () => {
  it('accepts a complete environment', () => {
    const env = parseBootEnv(validBootEnv())
    expect(env.OWNER_EMAIL).toBe('owner@example.com')
    expect(env.MOCK_PROVIDERS).toBe(false)
  })

  it('lists every missing key at once rather than failing on the first', () => {
    const source = validBootEnv()
    delete source['DATABASE_URL']
    delete source['OWNER_EMAIL']
    delete source['SECRETS_ENCRYPTION_KEY']

    try {
      parseBootEnv(source)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError)
      const missing = (error as EnvValidationError).missing
      expect(missing).toEqual(
        expect.arrayContaining(['DATABASE_URL', 'OWNER_EMAIL', 'SECRETS_ENCRYPTION_KEY']),
      )
      expect(missing).toHaveLength(3)
    }
  })

  it('distinguishes a malformed value from a missing one', () => {
    const source = { ...validBootEnv(), OWNER_EMAIL: 'not-an-email' }
    try {
      parseBootEnv(source)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as EnvValidationError).missing).toEqual([])
      expect((error as EnvValidationError).message).toContain('OWNER_EMAIL')
      expect((error as EnvValidationError).message).not.toContain('OWNER_EMAIL: missing')
    }
  })

  it('rejects an encryption key that is not exactly 32 bytes', () => {
    const short = { ...validBootEnv(), SECRETS_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }
    expect(() => parseBootEnv(short)).toThrow(EnvValidationError)

    const long = { ...validBootEnv(), SECRETS_ENCRYPTION_KEY: Buffer.alloc(64).toString('base64') }
    expect(() => parseBootEnv(long)).toThrow(EnvValidationError)
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    const source = { ...validBootEnv(), DATABASE_URL: 'mysql://localhost/db' }
    expect(() => parseBootEnv(source)).toThrow(EnvValidationError)
  })

  it('treats an empty string as missing', () => {
    const source = { ...validBootEnv(), AUTH_GOOGLE_ID: '' }
    try {
      parseBootEnv(source)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as EnvValidationError).missing).toEqual(['AUTH_GOOGLE_ID'])
    }
  })

  it('requires the Google client outside mock mode', () => {
    const source = validBootEnv()
    delete source['AUTH_GOOGLE_ID']

    try {
      parseBootEnv(source)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as EnvValidationError).missing).toEqual(['AUTH_GOOGLE_ID'])
    }
  })

  it('allows the Google client to be absent in mock mode', () => {
    const source: Record<string, string> = { ...validBootEnv(), MOCK_PROVIDERS: '1' }
    delete source['AUTH_GOOGLE_ID']
    delete source['AUTH_GOOGLE_SECRET']

    expect(parseBootEnv(source).MOCK_PROVIDERS).toBe(true)
  })

  it('still requires the Google client in production, even with MOCK_PROVIDERS set', () => {
    const source: Record<string, string> = {
      ...validBootEnv(),
      NODE_ENV: 'production',
      MOCK_PROVIDERS: '1',
    }
    delete source['AUTH_GOOGLE_ID']
    delete source['AUTH_GOOGLE_SECRET']

    expect(() => parseBootEnv(source)).toThrow(EnvValidationError)
  })

  it('parses MOCK_PROVIDERS as a boolean', () => {
    expect(parseBootEnv({ ...validBootEnv(), MOCK_PROVIDERS: '1' }).MOCK_PROVIDERS).toBe(true)
    expect(parseBootEnv({ ...validBootEnv(), MOCK_PROVIDERS: 'true' }).MOCK_PROVIDERS).toBe(true)
    expect(parseBootEnv({ ...validBootEnv(), MOCK_PROVIDERS: '0' }).MOCK_PROVIDERS).toBe(false)
  })
})

describe('requireEnv', () => {
  it('returns the group when every key is present', () => {
    const source = {
      R2_ACCOUNT_ID: 'acct',
      R2_ACCESS_KEY_ID: 'key',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'boom-busters',
    }
    expect(requireEnv('r2', source)).toEqual(source)
  })

  it('throws ConfigError naming only the missing keys', () => {
    const source = { R2_ACCOUNT_ID: 'acct', R2_BUCKET: '   ' }
    try {
      requireEnv('r2', source)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      expect((error as ConfigError).group).toBe('r2')
      expect((error as ConfigError).missing).toEqual([
        'R2_ACCESS_KEY_ID',
        'R2_SECRET_ACCESS_KEY',
        'R2_BUCKET',
      ])
    }
  })

  it('covers every deferred group declared in the spec', () => {
    expect(Object.keys(DEFERRED_GROUPS)).toEqual(['r2', 'broker', 'inngest', 'youtube'])
  })
})

describe('hasEnvGroup', () => {
  it('reports configured and unconfigured groups without throwing', () => {
    expect(hasEnvGroup('inngest', { INNGEST_EVENT_KEY: 'a', INNGEST_SIGNING_KEY: 'b' })).toBe(true)
    expect(hasEnvGroup('inngest', {})).toBe(false)
  })
})

describe('isMockMode', () => {
  it('is enabled by MOCK_PROVIDERS outside production', () => {
    expect(isMockMode({ NODE_ENV: 'test', MOCK_PROVIDERS: '1' })).toBe(true)
    expect(isMockMode({ NODE_ENV: 'development', MOCK_PROVIDERS: 'true' })).toBe(true)
    expect(isMockMode({ NODE_ENV: 'development' })).toBe(false)
  })

  it('can never be enabled in production, whatever the env says', () => {
    expect(isMockMode({ NODE_ENV: 'production', MOCK_PROVIDERS: '1' })).toBe(false)
    expect(isMockMode({ NODE_ENV: 'production', MOCK_PROVIDERS: 'true' })).toBe(false)
  })
})
