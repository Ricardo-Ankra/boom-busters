import { describe, expect, it } from 'vitest'
import { parseLivePlanArgs } from './live-plan-args'

describe('parseLivePlanArgs', () => {
  it('reads a project, a zero-based chapter and a label', () => {
    expect(parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--label', 'before'])).toEqual({
      project: 'P1',
      chapter: 5,
      cap: 1,
      label: 'before',
    })
  })

  it('refuses a missing project or a bad chapter', () => {
    expect(() => parseLivePlanArgs(['--chapter', '5'])).toThrow(/--project/)
    expect(() => parseLivePlanArgs(['--project', 'P1', '--chapter', '-1'])).toThrow(/--chapter/)
    expect(() => parseLivePlanArgs(['--project', 'P1', '--chapter', 'x'])).toThrow(/--chapter/)
  })

  it('keeps the $1 cap rules', () => {
    expect(() => parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--cap', '2'])).toThrow(
      "A cap above $1 needs the owner's approval first.",
    )
  })

  it('refuses a label that is not folder-safe', () => {
    expect(() =>
      parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--label', 'a/b']),
    ).toThrow(/--label/)
  })

  it('takes a previous run to reuse its briefs, and a planner model', () => {
    expect(
      parseLivePlanArgs([
        '--project',
        'P1',
        '--chapter',
        '5',
        '--briefs-from',
        'runs/x',
        '--planner-model',
        'gemini-pro-latest',
      ]),
    ).toMatchObject({ briefsFrom: 'runs/x', plannerModel: 'gemini-pro-latest' })
  })
})
