import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mockWikipedia } from '../sources/mock'
import { QuotaExhaustedError } from '../sources/quota'
import type { HitlistEntry } from '../types'
import {
  CHECKED,
  HITLIST,
  MODERN_UPLOADS,
  NOW,
  cleanGit,
  context,
  COMMIT,
  dirtyPackage,
  fakeBaseline,
  fakeSources,
  fakeYoutube,
  flatPageviews,
  readJson,
  reportPath,
  video,
  writeFixture,
  writeHitlist,
} from './cli-fixtures'
import { FIXTURE_PATH, runBacktest, runHitlist, runSubjects } from './run'

describe('the back-test commands', () => {
  it('hitlist writes the snapshot with the unresolved counts', async () => {
    const ctx = context({ sources: { ...fakeSources(), wikipedia: mockWikipedia } })
    expect(
      await runHitlist(ctx, { fetchText: async () => 'rank,company\n', loPuckiCsv: null }),
    ).toBe(0)
    const snapshot = readJson(ctx, '.cache', 'case-finder', 'mock', 'hitlist.json')
    expect(snapshot.builtOn).toBe('2026-10-21')
    expect(snapshot.entries.length).toBeGreaterThan(0)
    expect(snapshot.unresolvedBySeed).toEqual({})
    expect(ctx.lines.some((l) => l.includes('downfall'))).toBe(true)
  })

  it('subjects needs the hitlist first', async () => {
    await expect(runSubjects(context())).rejects.toThrow(/run hitlist first/)
  })

  it('subjects writes the uploads, the proposals and a draft fixture for the hand-check', async () => {
    const ctx = context()
    writeHitlist(ctx)
    expect(await runSubjects(ctx)).toBe(0)
    const dir = ['.cache', 'case-finder', 'mock']
    const uploads = readJson(ctx, ...dir, 'channel-uploads.json')
    expect(uploads.channels['@ModernMBA'].uploads).toHaveLength(4)
    expect(uploads).toMatchObject({ fetchedOn: '2026-10-21', codeTree: null })
    const proposals = readJson(ctx, ...dir, 'subject-proposals.json')
    expect(proposals.codeTree).toBeNull()
    expect(proposals.proposals.map((p: { videoId: string }) => p.videoId)).toEqual([
      'a1',
      'd1',
      'b1',
      'g1',
    ])
    expect(readJson(ctx, ...dir, 'backtest-subjects.draft.json')).toEqual([
      { videoId: 'a1', qid: 'Q1', verdict: 'subject' },
      { videoId: 'd1', qid: null, verdict: 'miss-not-on-hitlist', note: 'lane: ?' },
      { videoId: 'b1', qid: 'Q2', verdict: 'subject' },
      { videoId: 'g1', qid: 'Q3', verdict: 'subject' },
    ])
  })

  it('a full mock run writes a MOCK report with the case table, the unusable case left out', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    expect(await runBacktest(ctx, null)).toBe(0)
    const report = readFileSync(reportPath(ctx), 'utf8')
    expect(report.startsWith('# MOCK')).toBe(true)
    expect(report).toContain('| Video | Channel |')
    expect(report).toContain('| a1 | @ModernMBA |')
    expect(report).toContain('| b1 | @ModernMBA |')
    expect(report).not.toContain('| g1 |')
    expect(report).toContain('- g1 (Gamma explained): No settled peer uploads for video g1')
    expect(report).toContain('not decided: baseline not run')
    expect(report).toContain('Unresolved seed names: 4')
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    expect(cases.rows.map((r: { videoId: string }) => r.videoId)).toEqual(['a1', 'b1'])
    expect(cases.rows.map((r: { T: string }) => r.T)).toEqual(['2021-05-31', '2021-02-28'])
    expect(cases.unusable.map((u: { videoId: string }) => u.videoId)).toEqual(['g1'])
    expect(existsSync(reportPath(ctx, '.md'))).toBe(false)
  })

  it('the baseline scores every usable case by its subject, a miss by its note name', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, CHECKED)
    const { baseline, ask } = fakeBaseline()
    expect(await runBacktest(ctx, baseline)).toBe(0)
    expect(ask).toHaveBeenCalledWith(['Alpha Corp', 'Delta Holdings', 'Beta Inc'])
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    expect(
      cases.rows.map((r: { status: string; baseline: number }) => [r.status, r.baseline]),
    ).toEqual([
      [expect.not.stringMatching(/^miss$/), 10],
      ['miss', 20],
      [expect.not.stringMatching(/^miss$/), 30],
    ])
    expect(ctx.lines.some((l) => l.includes('test-model') && l.includes('0.0123'))).toBe(true)
    const report = readFileSync(reportPath(ctx), 'utf8')
    expect(report).toContain('model test-model')
    expect(report).toContain('- Baseline scored: 3 of 3 cases asked')
  })

  it('a partial baseline is not decided, and the raw reply is kept', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, CHECKED)
    const reply = JSON.stringify({
      scores: [
        { title: 'Alpha Corp', priorityScore: 80 },
        { title: 'Beta Inc', priorityScore: 40 },
      ],
    })
    expect(await runBacktest(ctx, fakeBaseline(() => reply).baseline)).toBe(0)
    expect(readFileSync(reportPath(ctx), 'utf8')).toContain(
      '**Verdict: not decided: baseline scored 2 of 3 cases.**',
    )
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    expect(cases.verdict.pass).toBe(false)
    expect(cases.meta).toMatchObject({ baselineAsked: 3, baselineScored: 2 })
    expect(
      readFileSync(
        path.join(ctx.root, '.cache', 'case-finder', 'mock', 'baseline-2026-10-21.txt'),
        'utf8',
      ),
    ).toBe(reply)
  })

  it('a baseline reply that does not parse is saved before the run fails', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, CHECKED)
    await expect(
      runBacktest(ctx, fakeBaseline(() => 'I would rather not').baseline),
    ).rejects.toThrow(/baseline-2026-10-21\.txt/)
    expect(
      readFileSync(
        path.join(ctx.root, '.cache', 'case-finder', 'mock', 'baseline-2026-10-21.txt'),
        'utf8',
      ),
    ).toBe('I would rather not')
    expect(existsSync(reportPath(ctx))).toBe(false)
  })

  it('a subject with no lane at T stays in the set, in its lane today, as no lane', async () => {
    const epsilon: HitlistEntry = {
      ...HITLIST[0]!,
      qid: 'Q4',
      enTitle: 'Epsilon',
      query: 'Epsilon',
      sitelinks: { enwiki: 'Epsilon' },
      // Filed years after the video: at T the subject had no lane.
      tags: [{ tag: 'lopucki', lane: 'downfall', since: '2024-01-01' }],
    }
    const uploads = [...MODERN_UPLOADS, video('e1', 'Epsilon unravels', '2021-05-01', 4000)]
    const ctx = context({ sources: fakeSources(fakeYoutube({}, uploads)) })
    writeHitlist(ctx, { entries: [...HITLIST, epsilon] })
    await runSubjects(ctx)
    expect(await runBacktest(ctx, null)).toBe(0)
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    const e1 = cases.rows.find((r: { videoId: string }) => r.videoId === 'e1')
    expect(e1).toMatchObject({ status: 'no lane', lane: 'downfall', qid: 'Q4', pct: null })
    expect(cases.meta.selectionNote).toMatch(/1 kept with no lane at T/)
    expect(readFileSync(reportPath(ctx), 'utf8')).toContain('- No lane at T: 1 of 3 cases')
  })

  it('a run on a later day asks the sources what the hitlist build day asked', async () => {
    const monthly = vi.fn(flatPageviews.monthly)
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    ctx.now = new Date('2027-01-15T09:00:00Z')
    ctx.sources = { ...fakeSources(), pageviews: { ...flatPageviews, monthly } }
    expect(await runBacktest(ctx, null)).toBe(0)
    // The hitlist was built on 2026-10-21, so every series ends with September 2026.
    expect(new Set(monthly.mock.calls.map((c) => c[3]))).toEqual(new Set(['2026-09']))
    expect(
      readFileSync(reportPath(ctx, '-mock.md').replace('2026-10-21', '2027-01-15'), 'utf8'),
    ).toContain('- Run date: 2027-01-15')
  })

  it('outcomes are measured on the day the uploads were fetched, and both dates are shown', async () => {
    const ctx = context({ now: new Date('2021-08-15T12:00:00Z') })
    writeHitlist(ctx)
    await runSubjects(ctx)
    ctx.now = NOW
    expect(await runBacktest(ctx, null)).toBe(0)
    const cases = JSON.parse(readFileSync(reportPath(ctx, '-mock-cases.json'), 'utf8'))
    // Measured on 2021-08-15, a1 (2021-06-01) is not yet settled, so b1's only peer is d1.
    const b1 = cases.rows.find((r: { videoId: string }) => r.videoId === 'b1')
    expect(b1.outcome).toBe(3)
    const report = readFileSync(reportPath(ctx), 'utf8')
    expect(report).toContain('- Run date: 2026-10-21')
    expect(report).toContain('- Outcomes measured on: 2021-08-15')
  })

  it('hitlist --live and subjects --live refuse while the package has uncommitted changes', async () => {
    const porcelain = vi.fn(dirtyPackage)
    const ctx = context({ mock: false, git: { ...cleanGit, porcelain } })
    const deps = { fetchText: async () => 'rank,company\n', loPuckiCsv: null }
    expect(await runHitlist(ctx, deps)).toBe(1)
    expect(existsSync(path.join(ctx.root, '.cache', 'case-finder', 'hitlist.json'))).toBe(false)
    writeHitlist(ctx)
    expect(await runSubjects(ctx)).toBe(1)
    expect(existsSync(path.join(ctx.root, '.cache', 'case-finder', 'channel-uploads.json'))).toBe(
      false,
    )
    expect(porcelain).toHaveBeenCalledWith('packages/case-finder')
    expect(ctx.lines.join('\n')).toMatch(/packages\/case-finder has uncommitted changes/)
    expect(ctx.lines.join('\n')).toContain('src/hitlist/seeds.ts')
  })

  it('a live hitlist records the code tree it was built from', async () => {
    const objectAt = vi.fn(async () => 'tree1')
    const ctx = context({
      mock: false,
      git: { ...cleanGit, objectAt },
      sources: { ...fakeSources(), wikipedia: mockWikipedia },
    })
    await runHitlist(ctx, { fetchText: async () => 'rank,company\n', loPuckiCsv: null })
    expect(readJson(ctx, '.cache', 'case-finder', 'hitlist.json').codeTree).toBe('tree1')
    expect(objectAt).toHaveBeenCalledWith('packages/case-finder/src')
  })

  it('run --live completes on clean snapshots and refuses ones built from other code', async () => {
    const ctx = context({ mock: false })
    writeHitlist(ctx)
    expect(await runSubjects(ctx)).toBe(0)
    expect(readJson(ctx, '.cache', 'case-finder', 'subject-proposals.json').codeTree).toBe('tree1')
    writeFixture(ctx, CHECKED)
    expect(await runBacktest(ctx, null)).toBe(0)
    const report = readFileSync(reportPath(ctx, '.md'), 'utf8')
    expect(report.startsWith('# Case-finder')).toBe(true)
    expect(report).toContain(`- Commit: ${COMMIT}`)

    ctx.git = { ...cleanGit, objectAt: async () => 'tree2' }
    expect(await runBacktest(ctx, null)).toBe(1)
    const said = ctx.lines.at(-1)!
    for (const file of ['hitlist.json', 'channel-uploads.json', 'subject-proposals.json']) {
      expect(said).toContain(file)
    }
    expect(said).toContain('packages/case-finder/src')
    expect(said).toMatch(/rebuild with hitlist --live then subjects --live/i)
  })

  it('run --live refuses a subject whose QID is not on the hitlist', async () => {
    const ctx = context({ mock: false })
    writeHitlist(ctx)
    await runSubjects(ctx)
    writeFixture(ctx, [...CHECKED.slice(0, 3), { videoId: 'g1', qid: 'Q99', verdict: 'subject' }])
    expect(await runBacktest(ctx, null)).toBe(1)
    expect(ctx.lines.at(-1)).toMatch(/g1 \(Q99\)/)
    expect(ctx.lines.at(-1)).toMatch(/miss-not-on-hitlist/)
  })

  it('an invalid fixture is refused with the zod issues', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    const file = path.join(ctx.root, FIXTURE_PATH)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify([{ videoId: 'a1', qid: 'Q1', verdict: 'maybe' }]))
    expect(await runBacktest(ctx, null)).toBe(1)
    expect(ctx.lines.at(-1)).toMatch(/0\.verdict/)
  })

  it('run --live refuses while anything in the package has uncommitted changes', async () => {
    const porcelain = vi.fn(dirtyPackage)
    const ctx = context({ mock: false, git: { ...cleanGit, porcelain } })
    expect(await runBacktest(ctx, null)).toBe(1)
    expect(porcelain).toHaveBeenCalledWith('packages/case-finder')
    expect(ctx.lines.join('\n')).toMatch(/packages\/case-finder has uncommitted changes/)
  })

  it('a mock run skips the git guards', async () => {
    const git = { ...cleanGit, porcelain: vi.fn(dirtyPackage), objectAt: vi.fn(cleanGit.objectAt) }
    const ctx = context({ git })
    writeHitlist(ctx)
    expect(await runSubjects(ctx)).toBe(0)
    expect(await runBacktest(ctx, null)).toBe(0)
    expect(git.porcelain).not.toHaveBeenCalled()
    expect(git.objectAt).not.toHaveBeenCalled()
  })

  it('run --live refuses when the subjects fixture is not committed', async () => {
    const untracked = context({ mock: false, git: { ...cleanGit, isTracked: async () => false } })
    expect(await runBacktest(untracked, null)).toBe(1)
    expect(untracked.lines.join('\n')).toMatch(/backtest-subjects\.json is not committed/)
    const porcelain = async (p: string) =>
      p === 'packages/case-finder' ? ' M ' + FIXTURE_PATH : ''
    const edited = context({ mock: false, git: { ...cleanGit, porcelain } })
    expect(await runBacktest(edited, null)).toBe(1)
    expect(edited.lines.join('\n')).toMatch(/uncommitted changes.*backtest-subjects\.json/)
  })

  it('QuotaExhaustedError stops the run with exit code 2 and says how far it got', async () => {
    const ctx = context()
    writeHitlist(ctx)
    await runSubjects(ctx)
    ctx.sources = fakeSources(
      fakeYoutube({
        search: async () => {
          throw new QuotaExhaustedError('out of units')
        },
      }),
    )
    expect(await runBacktest(ctx, null)).toBe(2)
    expect(ctx.lines.join('\n')).toMatch(/0 of 2 test dates complete, 2 remain/)
    expect(existsSync(reportPath(ctx))).toBe(false)
  })
})
