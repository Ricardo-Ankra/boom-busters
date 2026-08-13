import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { storageConfigured, takeStorage } from './storage'

/**
 * The four combinations of "is there a bucket" and "is the provider real".
 *
 * Three of them were already handled. The fourth — a live vendor with no bucket
 * — used to be treated as the mock case, which meant the voice stage bought
 * narration from Google at $0.03 per thousand characters, discarded every byte,
 * and then played the mock's tone bursts back under a waveform drawn from the
 * audio it had thrown away. It was found by listening, not by any test, because
 * every screen involved looked correct.
 */

const R2 = {
  R2_ACCOUNT_ID: 'account',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket',
}

const original = { ...process.env }

function setEnv(values: Record<string, string | undefined>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
}

beforeEach(() => {
  setEnv({ ...Object.fromEntries(Object.keys(R2).map((k) => [k, undefined])) })
  delete process.env['MOCK_PROVIDERS']
})

afterEach(() => {
  process.env = { ...original }
})

describe('takeStorage', () => {
  it('uploads to R2 when the bucket is configured', () => {
    setEnv(R2)
    expect(storageConfigured()).toBe(true)
    expect(takeStorage()).toBe('r2')
  })

  it('regenerates when the mock made the audio and there is no bucket', () => {
    setEnv({ MOCK_PROVIDERS: '1' })
    expect(takeStorage()).toBe('regenerated')
  })

  it('prefers R2 even in mock mode, so a configured bucket is always used', () => {
    setEnv({ ...R2, MOCK_PROVIDERS: '1' })
    expect(takeStorage()).toBe('r2')
  })

  it('refuses to buy narration it cannot store', () => {
    // The combination that cost money and produced beeps.
    expect(() => takeStorage()).toThrow(/nowhere to be stored/i)
  })

  it('names both ways out of the refusal, not just the bucket', () => {
    // A single-user console needs the cheap escape hatch spelled out: someone
    // trying the stage out should not have to set up object storage first.
    expect(() => takeStorage()).toThrow(/R2_BUCKET/)
    expect(() => takeStorage()).toThrow(/MOCK_PROVIDERS=1/)
  })
})
