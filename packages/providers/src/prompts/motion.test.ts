import { DEFAULT_MOTION_IDENTITY, TECHNIQUES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  buildMotionIdentityDraftRequest,
  buildReferenceReadingRequest,
  mockMotionIdentityDraft,
  mockReferenceReading,
  parseMotionIdentityDraft,
  parseReferenceReading,
  type IdentityDraftInput,
} from './motion'

/**
 * The two motion prompts (spec 2026-11-04, sections 7.3 and 8.4): a
 * reference's window read into a one-page reading, and the channel's identity
 * drafted from the readings and the owner's brief. Neither reads the bible,
 * so neither is a lift case.
 */

const reference = {
  title: 'Numeral over a changing background',
  purpose: 'mechanism' as const,
  negative: false,
  carryOver: 'borrow the held numeral, not the story',
  avoid: 'not the glow',
  windowMs: 2500,
}
const images = {
  denseSheet: { mimeType: 'image/jpeg' as const, data: 'AAAA' },
  frames: [{ atMs: 1000, image: { mimeType: 'image/jpeg' as const, data: 'BBBB' } }],
}

const dashes = /[–—]/

function draftInput(over: Partial<IdentityDraftInput> = {}): IdentityDraftInput {
  return {
    current: DEFAULT_MOTION_IDENTITY,
    brief: 'slow and dark, one change every six seconds',
    readings: [
      {
        ...reference,
        reading: {
          medium: 'flat typography on black',
          palette: ['#000', '#f2f2f2'],
          type: 'grotesk, heavy, tight',
          enters: 'rises 20 px and settles',
          exits: 'hard cut',
          motion: 'one numeral holds while the background changes every second',
          absent: 'no glow, no blur',
          notes: '',
          readAt: '2026-11-04T10:00:00.000Z',
          model: 'anthropic/claude-opus-5-5',
        },
      },
    ],
    brand: { colors: { background: '#0b0b0b', text: '#f2f2f2' }, fonts: { heading: 'Inter' } },
    techniques: TECHNIQUES.map((technique) => ({ technique, description: `${technique} does x` })),
    ...over,
  }
}

describe('the reference reading (spec 7.3)', () => {
  it('composes the reading request', async () => {
    await expect(
      JSON.stringify(buildReferenceReadingRequest(reference, images), null, 2) + '\n',
    ).toMatchFileSnapshot('./__fixtures__/motion-reading.json')
  })

  it('puts the sheet and the frames before the ask, in order', () => {
    const request = buildReferenceReadingRequest(reference, images)
    expect(request.task).toBe('graphics')
    const last = request.messages.at(-1)!
    expect(last.images).toEqual([images.denseSheet, images.frames[0]!.image])
    expect(last.content).toContain('Frame at 1.0 s')
    expect(last.content).toContain('borrow the held numeral')
    expect(last.content).toContain('not the glow')
  })

  it('reads a still with no sheet', () => {
    const last = buildReferenceReadingRequest(
      { ...reference, windowMs: null },
      { denseSheet: null, frames: images.frames },
    ).messages.at(-1)!
    expect(last.images).toEqual([images.frames[0]!.image])
    expect(last.content).not.toContain('dense sheet')
  })

  it('reads a reading and cuts a long line to its limit', () => {
    const r = parseReferenceReading(
      JSON.stringify({
        medium: 'x',
        type: 'x',
        enters: 'x',
        exits: 'x',
        motion: 'y'.repeat(500),
        absent: 'x',
        palette: Array(8).fill('#000'),
        notes: '',
      }),
    )
    expect(r.motion).toHaveLength(400)
    expect(r.palette).toHaveLength(6)
  })

  it('fills a field the model left out as empty', () => {
    const r = parseReferenceReading(JSON.stringify({ medium: 'x' }))
    expect(r.absent).toBe('')
    expect(r.palette).toEqual([])
  })

  it('the mock reading is marked and repeats the carry-over line', () => {
    const r = mockReferenceReading(reference)
    expect(r.medium).toMatch(/^\[mock\]/)
    expect(r.notes).toContain(reference.carryOver)
  })
})

describe('the identity draft (spec 8.4)', () => {
  it('composes the draft request', async () => {
    await expect(
      JSON.stringify(buildMotionIdentityDraftRequest(draftInput()), null, 2) + '\n',
    ).toMatchFileSnapshot('./__fixtures__/motion-identity-draft.json')
  })

  it('names an unread reference as unread', () => {
    const text = buildMotionIdentityDraftRequest(
      draftInput({ readings: [{ ...reference, reading: null }] }),
    )
      .messages.map((m) => m.content)
      .join('\n')
    expect(text).toContain('unread')
    expect(text).toContain('borrow the held numeral')
  })

  it('drafts from the brief alone', () => {
    const request = buildMotionIdentityDraftRequest(draftInput({ readings: [] }))
    const text = request.messages.map((m) => m.content).join('\n')
    expect(text).toContain('No references')
    expect(text).toContain('slow and dark')
  })

  it('lists the catalogue and the two techniques that stay', () => {
    const text = buildMotionIdentityDraftRequest(draftInput()).system
    expect(text).toContain('kinetic-word-stack')
    expect(text).toContain('bar-chart')
    expect(text).toContain('4000')
  })

  it('refuses a draft the identity schema refuses', () => {
    expect(() =>
      parseMotionIdentityDraft(
        JSON.stringify({ identity: { changeEveryMs: 3000, stillMaxMs: 2000 }, why: '' }),
      ),
    ).toThrow(/still limit/)
  })

  it('reads a proposal through the identity schema', () => {
    const draft = parseMotionIdentityDraft(
      JSON.stringify({ identity: { overshoot: 'none' }, why: 'the readings never overshoot' }),
    )
    expect(draft.identity.overshoot).toBe('none')
    expect(draft.identity.techniques).toEqual(DEFAULT_MOTION_IDENTITY.techniques)
  })

  it("keeps the channel's own keys the catalogue does not name (spec 8.5)", () => {
    const draft = parseMotionIdentityDraft(
      JSON.stringify({ identity: { techniques: [...TECHNIQUES] }, why: 'all of them' }),
      ['ledger-wipe', 'stat-counter', 'ledger-wipe'],
    )
    expect(draft.identity.techniques.filter((key) => key === 'ledger-wipe')).toHaveLength(1)
    expect(draft.identity.techniques.at(-1)).toBe('ledger-wipe')
    expect(draft.identity.techniques.filter((key) => key === 'stat-counter')).toHaveLength(1)
  })

  it('drops a key the model invented that the channel does not hold (deferred minor)', () => {
    const draft = parseMotionIdentityDraft(
      JSON.stringify({
        identity: { techniques: [...TECHNIQUES, 'ink-blot', 'ledger-wipe'] },
        why: 'two of its own',
      }),
      ['ledger-wipe'],
    )
    expect(draft.identity.techniques).toEqual([...TECHNIQUES, 'ledger-wipe'])
  })

  it('the mock draft differs from the current identity', () => {
    const d = mockMotionIdentityDraft(draftInput({ brief: 'slow and dark' }))
    expect(d.identity.styleGuideMd).toContain('slow and dark')
    expect(d.identity.overshoot).toBe(DEFAULT_MOTION_IDENTITY.overshoot)
    expect(d.why).toMatch(/^\[mock\]/)
  })
})

describe('both prompts', () => {
  it('writes no dash a reader would see', () => {
    for (const request of [
      buildReferenceReadingRequest(reference, images),
      buildMotionIdentityDraftRequest(draftInput()),
    ]) {
      expect(request.system).not.toMatch(dashes)
      for (const message of request.messages) expect(message.content).not.toMatch(dashes)
    }
  })
})
