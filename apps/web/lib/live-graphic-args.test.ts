import { describe, expect, it } from 'vitest'
import { parseLiveGraphicArgs } from './live-graphic-args'

describe('parseLiveGraphicArgs', () => {
  it('defaults to the first five graphics, no steer, no redesign, a $1 cap and the graphics label', () => {
    expect(parseLiveGraphicArgs(['--project', 'P1'])).toEqual({
      project: 'P1',
      selection: { kind: 'first', count: 5 },
      redesign: false,
      cap: 1,
      label: 'graphics',
    })
  })

  it('refuses a missing project', () => {
    expect(() => parseLiveGraphicArgs([])).toThrow(/--project/)
    expect(() => parseLiveGraphicArgs(['--project'])).toThrow(/--project/)
  })

  it('reads a first count, and refuses one that is not a whole number above 0', () => {
    expect(parseLiveGraphicArgs(['--project', 'P1', '--first', '3']).selection).toEqual({
      kind: 'first',
      count: 3,
    })
    for (const bad of ['0', '-2', '2.5', 'x']) {
      expect(() => parseLiveGraphicArgs(['--project', 'P1', '--first', bad])).toThrow(/--first/)
    }
  })

  it('reads a comma-separated slot list, trimmed', () => {
    expect(parseLiveGraphicArgs(['--project', 'P1', '--slots', 'a, b,c']).selection).toEqual({
      kind: 'slots',
      ids: ['a', 'b', 'c'],
    })
  })

  it('refuses an empty or repeated slot list', () => {
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--slots', ' , '])).toThrow(/--slots/)
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--slots', 'a,b,a'])).toThrow(/--slots/)
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--slots'])).toThrow(/--slots/)
  })

  it('refuses --slots and --first together', () => {
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--slots', 'a', '--first', '2'])).toThrow(
      /not both/,
    )
  })

  it('takes a steer, a model, a label and an out folder', () => {
    expect(
      parseLiveGraphicArgs([
        '--project',
        'P1',
        '--steer',
        'make the figure bigger',
        '--model',
        'claude-opus-5-5',
        '--label',
        'round-2',
        '--out',
        'runs/x',
      ]),
    ).toMatchObject({
      steer: 'make the figure bigger',
      model: 'claude-opus-5-5',
      label: 'round-2',
      out: 'runs/x',
    })
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--steer'])).toThrow(/--steer/)
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--model'])).toThrow(/--model/)
  })

  it('turns on redesign with a bare flag, wherever it sits', () => {
    expect(parseLiveGraphicArgs(['--project', 'P1', '--redesign']).redesign).toBe(true)
    expect(parseLiveGraphicArgs(['--redesign', '--project', 'P1']).redesign).toBe(true)
  })

  it('refuses a label that is not folder-safe', () => {
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--label', 'a/b'])).toThrow(/--label/)
  })

  it('keeps the $1 cap rules', () => {
    expect(() => parseLiveGraphicArgs(['--project', 'P1', '--cap', '2'])).toThrow(
      "A cap above $1 needs the owner's approval first.",
    )
    for (const bad of ['0', '-1', 'Infinity', 'NaN', '1,00']) {
      expect(() => parseLiveGraphicArgs(['--project', 'P1', '--cap', bad])).toThrow(/--cap/)
    }
    expect(parseLiveGraphicArgs(['--project', 'P1', '--cap', '0.5']).cap).toBe(0.5)
  })
})
