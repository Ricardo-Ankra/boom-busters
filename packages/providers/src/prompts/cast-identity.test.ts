import { CAST_GUARDRAIL_MAX, CAST_IDENTITY_MAX, ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildCastIdentityRequest,
  DEFAULT_GUARDRAIL,
  mockCastIdentity,
  parseCastIdentity,
} from './cast-identity'
import type { Note, Repair } from './repair'

const photo = { mimeType: 'image/jpeg' as const, data: 'QUJD' }

describe('buildCastIdentityRequest', () => {
  const request = buildCastIdentityRequest({
    name: 'Emad Mostaque',
    role: 'Founder and former CEO, Stability AI',
    photos: [photo],
  })

  it('routes to the direction task, the vision-capable drafting tier', () => {
    expect(request.task).toBe('direction')
  })

  it('puts the photographs on the user message ahead of the question', () => {
    expect(request.messages[0]?.images).toEqual([photo])
    expect(request.messages[0]?.content).toContain('Describe Emad Mostaque')
  })

  it('asks for the face in photographer order and forbids inference', () => {
    expect(request.system).toContain('face\n  shape; hair')
    expect(request.system).toContain('Only what is visible')
    expect(request.system).toContain(DEFAULT_GUARDRAIL)
  })

  it('bans the full word list the bible bans, not a shorter copy of it', () => {
    // A word only the full list carries (decision 287): the banned words are
    // stated once, in direction-craft.ts, and this prompt reads them from
    // there instead of keeping its own shorter copy to drift out of step.
    expect(request.system).toContain('photorealistic')
  })

  it('states both limits in characters, not words (decision 293)', () => {
    expect(request.system.replace(/\s+/g, ' ')).toContain(
      'Limits (the app checks them): "identityString" at most 600 characters; ' +
        '"guardrail" at most 600 characters.',
    )
    expect(request.system).not.toContain('60 words')
  })

  it('refuses to describe nobody: photographs are the point', () => {
    expect(() => buildCastIdentityRequest({ name: 'x', role: 'y', photos: [] })).toThrow(
      ValidationError,
    )
  })
})

describe('parseCastIdentity', () => {
  it('parses a fenced answer', () => {
    const parsed = parseCastIdentity(
      '```json\n{"identityString": "Emad Mostaque, founder: oval face, short dark hair", "guardrail": "never mocked"}\n```',
    )
    expect(parsed.identityString).toBe('Emad Mostaque, founder: oval face, short dark hair')
    expect(parsed.guardrail).toBe('never mocked')
  })

  it('falls back to the default guardrail when the model leaves it empty', () => {
    expect(parseCastIdentity('{"identityString": "x face", "guardrail": ""}').guardrail).toBe(
      DEFAULT_GUARDRAIL,
    )
    expect(parseCastIdentity('{"identityString": "x face"}').guardrail).toBe(DEFAULT_GUARDRAIL)
  })

  it('refuses an answer with no identity string', () => {
    expect(() => parseCastIdentity('{"guardrail": "x"}')).toThrow(ValidationError)
  })
})

describe('parseCastIdentity repairs (decision 293)', () => {
  const collect = () => {
    const notes: Repair[] = []
    const note: Note = (repair) => {
      notes.push(repair)
    }
    return { notes, note }
  }

  it('trims an identity over its limit at the end, keeping the name and role it begins with', () => {
    const { notes, note } = collect()
    const long =
      'Emad Mostaque, founder: ' + 'oval face, short dark hair, close-cropped beard, '.repeat(15)
    const parsed = parseCastIdentity(
      JSON.stringify({ identityString: long, guardrail: 'never mocked' }),
      note,
    )
    expect(parsed.identityString.length).toBeLessThanOrEqual(CAST_IDENTITY_MAX)
    expect(long.startsWith(parsed.identityString)).toBe(true)
    expect(parsed.guardrail).toBe('never mocked')
    expect(notes).toEqual([{ action: 'trimmed', field: 'the identity' }])
  })

  it('trims a guardrail over its limit', () => {
    const { notes, note } = collect()
    const guardrail = 'never mocked; never in handcuffs; '.repeat(25)
    const parsed = parseCastIdentity(
      JSON.stringify({ identityString: 'Emad Mostaque, founder: oval face', guardrail }),
      note,
    )
    expect(parsed.guardrail.length).toBeLessThanOrEqual(CAST_GUARDRAIL_MAX)
    expect(guardrail.startsWith(parsed.guardrail)).toBe(true)
    expect(notes).toEqual([{ action: 'trimmed', field: 'the guardrail' }])
  })

  it('notes nothing for an answer within its limits', () => {
    const { notes, note } = collect()
    parseCastIdentity('{"identityString": "x face", "guardrail": "never mocked"}', note)
    expect(notes).toEqual([])
  })
})

describe('mockCastIdentity', () => {
  it('is deterministic and names the person', () => {
    const a = mockCastIdentity({ name: 'Emad Mostaque', role: 'Founder' })
    expect(a).toEqual(mockCastIdentity({ name: 'Emad Mostaque', role: 'Founder' }))
    expect(a.identityString).toContain('[mock] Emad Mostaque, Founder')
    expect(a.guardrail).toBe(DEFAULT_GUARDRAIL)
  })
})
