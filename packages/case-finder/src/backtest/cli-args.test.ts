import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCliArgs, rawCacheDir } from './cli-args'

describe('parseCliArgs', () => {
  it('reads a command with the defaults', () => {
    expect(parseCliArgs(['run'])).toEqual({
      command: 'run',
      live: false,
      baseline: null,
      dailyUnits: 10000,
      spentToday: 0,
      lopucki: null,
    })
  })

  it('reads numbers in both flag forms and refuses anything but a whole number', () => {
    const args = parseCliArgs(['subjects', '--daily-units', '5000', '--spent-today=120'])
    expect(args).toMatchObject({ command: 'subjects', dailyUnits: 5000, spentToday: 120 })
    expect(() => parseCliArgs(['run', '--daily-units', 'lots'])).toThrow(/--daily-units/)
    expect(() => parseCliArgs(['run', '--spent-today', '-5'])).toThrow(/--spent-today/)
    expect(() => parseCliArgs(['run', '--daily-units'])).toThrow(/--daily-units/)
  })

  it('refuses an unknown flag, a missing or unknown command and a stray argument', () => {
    expect(() => parseCliArgs(['run', '--frobnicate'])).toThrow(/--frobnicate/)
    expect(() => parseCliArgs([])).toThrow(/command/)
    expect(() => parseCliArgs(['score'])).toThrow(/score/)
    expect(() => parseCliArgs(['run', 'extra'])).toThrow(/extra/)
  })

  it('--baseline without --live is refused', () => {
    const paid = ['--baseline', '--baseline-provider', 'anthropic', '--baseline-model', 'm1']
    expect(() => parseCliArgs(['run', ...paid])).toThrow(/--live/)
    expect(parseCliArgs(['run', '--live', ...paid]).baseline).toEqual({
      provider: 'anthropic',
      model: 'm1',
    })
  })

  it('--baseline needs a known provider and a model, and only on run', () => {
    expect(() => parseCliArgs(['run', '--live', '--baseline', '--baseline-model', 'm'])).toThrow(
      /--baseline-provider/,
    )
    expect(() =>
      parseCliArgs(['run', '--live', '--baseline', '--baseline-provider', 'mistral']),
    ).toThrow(/mistral/)
    expect(() =>
      parseCliArgs(['run', '--live', '--baseline', '--baseline-provider', 'openai']),
    ).toThrow(/--baseline-model/)
    expect(() => parseCliArgs(['run', '--live', '--baseline-model', 'm'])).toThrow(/--baseline/)
    const paid = ['--baseline', '--baseline-provider', 'google', '--baseline-model', 'm']
    expect(() => parseCliArgs(['hitlist', '--live', ...paid])).toThrow(/run/)
  })

  it('the raw cache sits in the repo unless CASE_FINDER_CACHE_DIR moves it', () => {
    const root = path.join('C:', 'repo')
    expect(rawCacheDir({}, root)).toBe(path.join(root, '.cache', 'case-finder'))
    expect(rawCacheDir({ CASE_FINDER_CACHE_DIR: '  ' }, root)).toBe(
      path.join(root, '.cache', 'case-finder'),
    )
    expect(rawCacheDir({ CASE_FINDER_CACHE_DIR: ' D:/cf-cache ' }, root)).toBe(
      path.resolve('D:/cf-cache'),
    )
  })

  it('reads the population command, mock or live, and refuses the baseline on it', () => {
    expect(parseCliArgs(['population']).command).toBe('population')
    expect(parseCliArgs(['population', '--live']).live).toBe(true)
    const paid = ['--baseline', '--baseline-provider', 'google', '--baseline-model', 'm']
    expect(() => parseCliArgs(['population', '--live', ...paid])).toThrow(/run/)
  })

  it('reads the LoPucki path and ignores a leading -- from pnpm', () => {
    expect(parseCliArgs(['--', 'hitlist', '--lopucki', 'C:/data/lopucki.csv']).lopucki).toBe(
      'C:/data/lopucki.csv',
    )
  })
})
