import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { defaultInventoryModel, parseLiveSetArgs } from './live-set-args'

describe('parseLiveSetArgs', () => {
  it('parses the required flags and defaults the rest', () => {
    expect(parseLiveSetArgs(['--image', 'a.png', '--name', 'The trading floor'])).toEqual({
      image: 'a.png',
      name: 'The trading floor',
      look: '',
      layout: undefined,
      out: undefined,
      shot: undefined,
      anchors: undefined,
      inventoryModel: 'gemini-3.5-flash-lite',
      cap: 1,
      generateFirst: false,
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
        '--anchors',
        'heavy film grain; cold blue grade',
        '--inventory-model',
        'gemini-3.5-flash',
      ]),
    ).toEqual({
      image: 'a.png',
      name: 'The trading floor',
      look: 'cold blue light',
      layout: 'layout.txt',
      out: 'out-dir',
      shot: 'shot.json',
      anchors: 'heavy film grain; cold blue grade',
      inventoryModel: 'gemini-3.5-flash',
      cap: 0.5,
      generateFirst: false,
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
      anchors: undefined,
      inventoryModel: 'gemini-3.5-flash-lite',
      cap: 0.5,
      generateFirst: false,
    })
  })

  describe('--inventory-model', () => {
    it("defaults to the production shotlist model when it is Google's", () => {
      const routing = DEFAULT_SETTINGS.modelRouting
      expect(
        defaultInventoryModel({
          ...routing,
          shotlist: { provider: 'google', model: 'gemini-3.5-flash' },
        }),
      ).toBe('gemini-3.5-flash')
    })

    it('falls back to gemini-3.5-flash-lite when the shotlist route is not Google', () => {
      // The settings default routes the shot list at Anthropic.
      expect(DEFAULT_SETTINGS.modelRouting.shotlist.provider).not.toBe('google')
      expect(defaultInventoryModel(DEFAULT_SETTINGS.modelRouting)).toBe('gemini-3.5-flash-lite')
    })

    it('refuses an empty --inventory-model or --anchors rather than sending nothing', () => {
      const base = ['--image', 'a.png', '--name', 'R']
      expect(() => parseLiveSetArgs([...base, '--inventory-model', ''])).toThrow(
        /--inventory-model/,
      )
      expect(() => parseLiveSetArgs([...base, '--anchors='])).toThrow(/--anchors/)
    })
  })

  it('refuses a missing --image', () => {
    expect(() => parseLiveSetArgs(['--name', 'R'])).toThrow(
      '--image is required (a jpeg, png or webp file), or pass --generate-first with --look, or --from-run <folder>.',
    )
  })

  describe('--from-run', () => {
    it('takes the place of --image, reusing a previous run', () => {
      const args = parseLiveSetArgs(['--from-run', 'runs/one', '--name', 'R'])
      expect(args.fromRun).toBe('runs/one')
      expect(args.image).toBeUndefined()
    })

    it('refuses to be combined with --image or --generate-first', () => {
      expect(() =>
        parseLiveSetArgs(['--from-run', 'runs/one', '--image', 'a.png', '--name', 'R']),
      ).toThrow('Pass one of --image, --from-run, not several.')
    })
  })

  describe('--generate-first', () => {
    it('takes the place of --image when a look is given', () => {
      const args = parseLiveSetArgs(['--generate-first', '--name', 'R', '--look', 'A long table'])
      expect(args.generateFirst).toBe(true)
      expect(args.image).toBeUndefined()
      expect(args.look).toBe('A long table')
    })

    it('needs a look to generate from', () => {
      expect(() => parseLiveSetArgs(['--generate-first', '--name', 'R'])).toThrow(
        '--generate-first needs --look: the first plate is drawn from the look alone.',
      )
    })

    it('refuses --generate-first with --image, which would spend on a plate it then ignores', () => {
      expect(() =>
        parseLiveSetArgs(['--generate-first', '--image', 'a.png', '--name', 'R', '--look', 'L']),
      ).toThrow('Pass one of --image, --generate-first, not several.')
    })
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
