import {
  CAST_GUARDRAIL_MAX,
  CAST_IDENTITY_MAX,
  EXAMPLE_SLOT_IDS,
  FIRST_CHANNEL_IN_USE,
  ValidationError,
} from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildCastIdentityRequest,
  defaultGuardrail,
  mockCastIdentity,
  parseCastIdentity,
} from './cast-identity'
import { PSYCHOLOGY_TEST_BIBLE } from './lift/psychology-bible'
import type { Note, Repair } from './repair'

const photo = { mimeType: 'image/jpeg' as const, data: 'QUJD' }

// Boom & Busters' own starting guardrail, as it was sent before the bible held it.
const DEFAULT_GUARDRAIL =
  'never handling cash or signing an invented contract; never in handcuffs; ' +
  'never mocked, caricatured or shown in humiliation'

const parse = (text: string, note?: Note) => parseCastIdentity(text, note, FIRST_CHANNEL_IN_USE)

describe('buildCastIdentityRequest', () => {
  const request = buildCastIdentityRequest({
    bible: FIRST_CHANNEL_IN_USE,
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
    expect(() =>
      buildCastIdentityRequest({ bible: FIRST_CHANNEL_IN_USE, name: 'x', role: 'y', photos: [] }),
    ).toThrow(ValidationError)
  })
})

describe('parseCastIdentity', () => {
  it('parses a fenced answer', () => {
    const parsed = parse(
      '```json\n{"identityString": "Emad Mostaque, founder: oval face, short dark hair", "guardrail": "never mocked"}\n```',
    )
    expect(parsed.identityString).toBe('Emad Mostaque, founder: oval face, short dark hair')
    expect(parsed.guardrail).toBe('never mocked')
  })

  it('falls back to the default guardrail when the model leaves it empty', () => {
    expect(parse('{"identityString": "x face", "guardrail": ""}').guardrail).toBe(DEFAULT_GUARDRAIL)
    expect(parse('{"identityString": "x face"}').guardrail).toBe(DEFAULT_GUARDRAIL)
  })

  it('refuses an answer with no identity string', () => {
    expect(() => parse('{"guardrail": "x"}')).toThrow(ValidationError)
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
    const parsed = parse(JSON.stringify({ identityString: long, guardrail: 'never mocked' }), note)
    expect(parsed.identityString.length).toBeLessThanOrEqual(CAST_IDENTITY_MAX)
    expect(long.startsWith(parsed.identityString)).toBe(true)
    expect(parsed.guardrail).toBe('never mocked')
    expect(notes).toEqual([{ action: 'trimmed', field: 'the identity' }])
  })

  it('trims a guardrail over its limit', () => {
    const { notes, note } = collect()
    const guardrail = 'never mocked; never in handcuffs; '.repeat(25)
    const parsed = parse(
      JSON.stringify({ identityString: 'Emad Mostaque, founder: oval face', guardrail }),
      note,
    )
    expect(parsed.guardrail.length).toBeLessThanOrEqual(CAST_GUARDRAIL_MAX)
    expect(guardrail.startsWith(parsed.guardrail)).toBe(true)
    expect(notes).toEqual([{ action: 'trimmed', field: 'the guardrail' }])
  })

  it('notes nothing for an answer within its limits', () => {
    const { notes, note } = collect()
    parse('{"identityString": "x face", "guardrail": "never mocked"}', note)
    expect(notes).toEqual([])
  })
})

describe('mockCastIdentity', () => {
  it('is deterministic and names the person', () => {
    const a = mockCastIdentity({
      bible: FIRST_CHANNEL_IN_USE,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    expect(a).toEqual(
      mockCastIdentity({ bible: FIRST_CHANNEL_IN_USE, name: 'Emad Mostaque', role: 'Founder' }),
    )
    expect(a.identityString).toContain('[mock] Emad Mostaque, Founder')
    expect(a.guardrail).toBe(DEFAULT_GUARDRAIL)
  })
})

describe('the cast prompts for a second channel (the channel bible lift)', () => {
  const second = { bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS }

  it("starts the guardrail from the channel's own first clause and keeps the shared one", () => {
    const guardrail = defaultGuardrail(second)
    expect(guardrail).toBe(
      `${PSYCHOLOGY_TEST_BIBLE.examples['direction-default-guardrail']}; ` +
        'never mocked, caricatured or shown in humiliation',
    )
    expect(guardrail).not.toContain('handcuffs')
    expect(mockCastIdentity({ bible: second, name: 'A', role: 'B' }).guardrail).toBe(guardrail)
    expect(parseCastIdentity('{"identityString": "x face"}', undefined, second).guardrail).toBe(
      guardrail,
    )
  })

  it('sends that guardrail and its own settings in the prompt', () => {
    const { system } = buildCastIdentityRequest({
      bible: second,
      name: 'A',
      role: 'B',
      photos: [photo],
    })
    expect(system).toContain(`Start from: "${defaultGuardrail(second)}"`)
    expect(system).toContain(
      `ordinary settings such as ${PSYCHOLOGY_TEST_BIBLE.examples['direction-cast-settings']}.`,
    )
    expect(system).not.toContain('boardrooms')
  })
})
