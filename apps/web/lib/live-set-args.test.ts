import { describe, expect, it } from 'vitest'
import { parseLiveSetArgs } from './live-set-args'

describe('parseLiveSetArgs', () => {
  it('parses the required flags and defaults the rest', () => {
    expect(parseLiveSetArgs(['--image', 'a.png', '--name', 'The trading floor'])).toEqual({
      image: 'a.png',
      name: 'The trading floor',
      look: '',
      layout: undefined,
      out: undefined,
      shot: undefined,
      cap: 1,
    })
  })

  it('parses every flag, including the "--flag value" form', () => {
    expect(
      parseLiveSetArgs([
        '--image',
        'a.png',
        '--name',
        'The trading floor',
        '--look',
        'cold blue light',
        '--layout',
        'layout.txt',
        '--out',
        'out-dir',
        '--shot',
        'shot.json',
        '--cap',
        '0.5',
      ]),
    ).toEqual({
      image: 'a.png',
      name: 'The trading floor',
      look: 'cold blue light',
      layout: 'layout.txt',
      out: 'out-dir',
      shot: 'shot.json',
      cap: 0.5,
    })
  })

  it('parses the "--flag=value" form, which used to silently become key "cap=5"', () => {
    expect(
      parseLiveSetArgs(['--image', 'a.png', '--name', 'R', '--cap=0.5', '--look=a look']),
    ).toEqual({
      image: 'a.png',
      name: 'R',
      look: 'a look',
      layout: undefined,
      out: undefined,
      shot: undefined,
      cap: 0.5,
    })
  })

  it('refuses a missing --image', () => {
    expect(() => parseLiveSetArgs(['--name', 'R'])).toThrow(
      '--image is required (a jpeg, png or webp file).',
    )
  })

  it('refuses a missing --name', () => {
    expect(() => parseLiveSetArgs(['--image', 'a.png'])).toThrow(
      '--name is required (the set name).',
    )
  })

  describe('--cap', () => {
    const base = ['--image', 'a.png', '--name', 'R']

    it('defaults to 1 when omitted', () => {
      expect(parseLiveSetArgs(base).cap).toBe(1)
    })

    it('accepts a finite number at or under 1', () => {
      expect(parseLiveSetArgs([...base, '--cap', '1']).cap).toBe(1)
      expect(parseLiveSetArgs([...base, '--cap', '0.01']).cap).toBe(0.01)
    })

    it('refuses a cap above $1 with exactly the owner-approval message', () => {
      expect(() => parseLiveSetArgs([...base, '--cap', '5'])).toThrow(
        "A cap above $1 needs the owner's approval first.",
      )
      expect(() => parseLiveSetArgs([...base, '--cap', '1.01'])).toThrow(
        "A cap above $1 needs the owner's approval first.",
      )
    })

    it('refuses a non-number cap with a clear message, rather than silently disabling the cap', () => {
      expect(() => parseLiveSetArgs([...base, '--cap', 'abc'])).toThrow(/not a valid/)
      // A locale-formatted "1,00" parses as NaN via Number(), not 1 or 100 — it
      // must not slip past a `!Number.isFinite` guard.
      expect(() => parseLiveSetArgs([...base, '--cap', '1,00'])).toThrow(/not a valid/)
    })

    it('refuses Infinity, which would make every over-cap check pass', () => {
      expect(() => parseLiveSetArgs([...base, '--cap', 'Infinity'])).toThrow(/not a valid/)
    })

    it('refuses zero and negative caps', () => {
      expect(() => parseLiveSetArgs([...base, '--cap', '0'])).toThrow(/not a valid/)
      expect(() => parseLiveSetArgs([...base, '--cap', '-1'])).toThrow(/not a valid/)
    })
  })
})
