import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { gatherAt, gatherPassOneAt } from '../evidence'
import { mockYoutube } from '../sources/mock'
import type { YoutubeSource } from '../sources/youtube'
import {
  CHECKED,
  HITLIST,
  cleanGit,
  context,
  dirtyPackage,
  fakeSources,
  writeFixture,
  writeHitlist,
} from './cli-fixtures'
import { POPULATION_DATES, runPopulation } from './population'
import { runBacktest, runSubjects } from './run'

const populationFile = (root: string, mock = true) =>
  path.join(root, '.cache', 'case-finder', ...(mock ? ['mock'] : []), 'population.txt')

/** A YouTube source that fails the test if pass 1 ever reaches it. */
function forbiddenYoutube(): YoutubeSource & { search: ReturnType<typeof vi.fn> } {
  return {
    ...mockYoutube,
    search: vi.fn(async () => {
      throw new Error('pass 1 must not search YouTube')
    }),
    uploads: vi.fn(async () => {
      throw new Error('pass 1 must not read uploads')
    }),
  }
}

describe('gatherPassOneAt', () => {
  it('gives the pass-1 evidence gatherAt starts from, and touches nothing else', async () => {
    const sources = fakeSources()
    const wikidata = { ...sources.wikidata, facts: vi.fn(sources.wikidata.facts) }
    const secReleases = { index: vi.fn(sources.secReleases.index) }
    const youtube = forbiddenYoutube()
    const options = { anchorDay: '2026-10-21' }
    const first = await gatherPassOneAt(
      HITLIST,
      '2020-01-01',
      { ...sources, wikidata, secReleases, youtube },
      () => {},
      options,
    )
    expect(youtube.search).not.toHaveBeenCalled()
    expect(wikidata.facts).not.toHaveBeenCalled()
    expect(secReleases.index).not.toHaveBeenCalled()
    const full = await gatherAt(HITLIST, '2020-01-01', sources, () => {}, options)
    expect(first.map((e) => [e.entry.qid, e.enMonthly, e.tagsAtT])).toEqual(
      full.map((e) => [e.entry.qid, e.enMonthly, e.tagsAtT]),
    )
    expect(first.every((e) => e.search === null && e.documents.length === 0)).toBe(true)
  })
})

describe('the population command', () => {
  it('prints and saves each date’s population, below-floor count and top entries, pass 1 only', async () => {
    const youtube = forbiddenYoutube()
    const ctx = context({ sources: fakeSources(youtube) })
    writeHitlist(ctx)
    expect(await runPopulation(ctx)).toBe(0)
    expect(youtube.search).not.toHaveBeenCalled()
    expect(POPULATION_DATES).toEqual([
      '2018-01-01',
      '2020-01-01',
      '2022-01-01',
      '2024-01-01',
      '2026-01-01',
    ])
    const text = readFileSync(populationFile(ctx.root), 'utf8')
    for (const date of POPULATION_DATES) expect(text).toContain(`## ${date}`)
    // At 2018-01-01 neither LoPucki filing has happened; the founder link counts (1,000 a month).
    const early = text.slice(text.indexOf('## 2018-01-01'), text.indexOf('## 2020-01-01'))
    expect(early).toContain('Population after the floor and top 250: downfall 0, success 1')
    expect(early).toContain('Below the floor: 0')
    expect(early).toContain('1. Beta Inc (Q2): median 1,000; tags at T: founder-link')
    const later = text.slice(text.indexOf('## 2020-01-01'), text.indexOf('## 2022-01-01'))
    expect(later).toContain('downfall 2, success 1')
    expect(later).toContain('1. Alpha Corp (Q1): median 1,000; tags at T: lopucki')
    expect(ctx.lines.join('\n')).toContain('Population after the floor and top 250')
    expect(existsSync(path.join(ctx.root, 'docs'))).toBe(false)
  })

  it('needs the hitlist first', async () => {
    await expect(runPopulation(context())).rejects.toThrow(/run hitlist first/)
  })

  it('--live refuses while the package has uncommitted changes, or on a stale hitlist', async () => {
    const dirty = context({ mock: false, git: { ...cleanGit, porcelain: dirtyPackage } })
    writeHitlist(dirty)
    expect(await runPopulation(dirty)).toBe(1)
    expect(dirty.lines.at(-1)).toMatch(/packages\/case-finder has uncommitted changes/)

    const stale = context({ mock: false, git: { ...cleanGit, objectAt: async () => 'tree2' } })
    writeHitlist(stale)
    expect(await runPopulation(stale)).toBe(1)
    expect(stale.lines.at(-1)).toMatch(/hitlist\.json was not built from the committed/)
    expect(existsSync(populationFile(stale.root, false))).toBe(false)
  })

  it('--live warns how many entries pass 1 walks before it starts; a mock run does not', async () => {
    const live = context({ mock: false })
    writeHitlist(live)
    expect(await runPopulation(live)).toBe(0)
    const warning = live.lines.findIndex((l) => l.includes('several hours'))
    expect(warning).toBeGreaterThan(-1)
    expect(live.lines[warning]).toContain('3 hitlist entries at each of 5 dates')
    expect(warning).toBeLessThan(live.lines.findIndex((l) => l.includes('## 2018-01-01')))
    expect(existsSync(populationFile(live.root, false))).toBe(true)

    const mock = context()
    writeHitlist(mock)
    await runPopulation(mock)
    expect(mock.lines.some((l) => l.includes('several hours'))).toBe(false)
  })

  it('a live run warns before pass 1 too', async () => {
    const ctx = context({ mock: false })
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, CHECKED)
    expect(await runBacktest(ctx, null)).toBe(0)
    expect(ctx.lines.some((l) => l.includes('3 hitlist entries at each of 2 dates'))).toBe(true)
  })
})
