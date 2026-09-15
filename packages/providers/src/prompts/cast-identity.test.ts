import { ValidationError } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildCastIdentityRequest,
  DEFAULT_GUARDRAIL,
  mockCastIdentity,
  parseCastIdentity,
} from './cast-identity'

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

describe('mockCastIdentity', () => {
  it('is deterministic and names the person', () => {
    const a = mockCastIdentity({ name: 'Emad Mostaque', role: 'Founder' })
    expect(a).toEqual(mockCastIdentity({ name: 'Emad Mostaque', role: 'Founder' }))
    expect(a.identityString).toContain('[mock] Emad Mostaque, Founder')
    expect(a.guardrail).toBe(DEFAULT_GUARDRAIL)
  })
})
