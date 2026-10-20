import { describe, expect, it } from 'vitest'
import { proposeSubjects, selectTestSet } from './subjects'
import type { SubjectFixture, SubjectProposal } from './subjects'
import type { ChannelUploads, HitlistEntry, Lane, YoutubeVideo } from '../types'

function entry(qid: string, query: string | null): HitlistEntry {
  return { qid, enTitle: query, query, sitelinks: {}, tags: [], country: null, cik: null }
}
function vid(id: string, title: string, publishedAt: string, durationSec = 900): YoutubeVideo {
  return { id, channelId: 'UC1', title, publishedAt, durationSec, views: 1 }
}
const up = (uploads: YoutubeVideo[]): Map<string, ChannelUploads> =>
  new Map([['@Coffeezilla', { channelId: 'UC1', uploads }]])

describe('proposeSubjects', () => {
  it('proposes the longest matching hitlist query', () => {
    const out = proposeSubjects(up([vid('a', 'The Collapse of Lehman Brothers', '2020-01-01')]), [
      entry('Q1', 'Lehman'),
      entry('Q2', 'Lehman Brothers'),
    ])
    expect(out[0]).toMatchObject({
      videoId: 'a',
      channelHandle: '@Coffeezilla',
      proposedQid: 'Q2',
      matchedQuery: 'Lehman Brothers',
    })
  })

  it('breaks length ties by numeric QID', () => {
    const out = proposeSubjects(up([vid('a', 'Enron and Worldcom', '2020-01-01')]), [
      entry('Q100', 'Enron'),
      entry('Q20', 'Enron'),
    ])
    expect(out[0]!.proposedQid).toBe('Q20')
  })

  it('leaves nulls when nothing matches, and ignores null queries', () => {
    const out = proposeSubjects(up([vid('a', 'Random', '2020-01-01')]), [entry('Q1', null)])
    expect(out[0]).toMatchObject({ proposedQid: null, matchedQuery: null })
  })

  it('keeps long-form in range, newest first, ties by id, ends inclusive', () => {
    const out = proposeSubjects(
      up([
        vid('b', 'x', '2020-01-01'),
        vid('a', 'x', '2020-01-01'),
        vid('c', 'x', '2021-01-01'),
        vid('short', 'x', '2020-05-01', 479),
        vid('early', 'x', '2017-12-31'),
        vid('late', 'x', '2026-07-01'),
        vid('first', 'x', '2018-01-01'),
        vid('last', 'x', '2026-06-30'),
      ]),
      [],
    )
    expect(out.map((p) => p.videoId)).toEqual(['last', 'c', 'a', 'b', 'first'])
  })
})

const lanes: Record<string, Lane> = {}
/** Every test subject has the same lane at T as today unless a test says otherwise. */
const laneOf = (q: string) => ({ atT: lanes[q] ?? null, today: lanes[q] ?? null })

function setup(spec: { handle: string; lane: Lane; count: number; prefix: string }[]) {
  const proposals: SubjectProposal[] = []
  const checked: SubjectFixture[] = []
  let day = 1000
  for (const s of spec) {
    for (let i = 0; i < s.count; i++) {
      const videoId = `${s.prefix}${i}`
      const qid = `Q${s.prefix}${i}`
      lanes[qid] = s.lane
      const publishedAt = new Date(Date.UTC(2018, 0, 1) + day-- * 86_400_000)
        .toISOString()
        .slice(0, 10)
      proposals.push({
        videoId,
        channelHandle: s.handle,
        title: videoId,
        publishedAt,
        proposedQid: qid,
        matchedQuery: null,
      })
      checked.push({ videoId, qid, verdict: 'subject' })
    }
  }
  proposals.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  return { proposals, checked }
}

describe('selectTestSet', () => {
  it('names only the unchecked proposals the walk reached before the set filled', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 12, prefix: 'a' },
      { handle: '@B', lane: 'downfall', count: 12, prefix: 'b' },
      { handle: '@D', lane: 'success', count: 12, prefix: 'd' },
      { handle: '@E', lane: 'downfall', count: 12, prefix: 'e' },
    ])
    // setup numbers days downwards, so a0 is the newest proposal and e11 the oldest.
    const reached = proposals[5]!.videoId
    const beyond = proposals.at(-1)!.videoId
    const fx = checked.filter((c) => c.videoId !== reached && c.videoId !== beyond)
    const { selected, unchecked } = selectTestSet(fx, proposals, laneOf)
    expect(selected).toHaveLength(40)
    expect(unchecked).toEqual([reached])
  })

  it('caps a channel at 12', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 20, prefix: 'a' },
    ])
    const { selected, note } = selectTestSet(checked, proposals, laneOf)
    expect(selected).toHaveLength(12)
    expect(note).toMatch(/8 capped by channel/)
  })

  it('after 28 downfalls it takes only success stories', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 12, prefix: 'a' },
      { handle: '@B', lane: 'downfall', count: 12, prefix: 'b' },
      { handle: '@C', lane: 'downfall', count: 12, prefix: 'c' },
      { handle: '@D', lane: 'success', count: 12, prefix: 'd' },
      { handle: '@E', lane: 'downfall', count: 12, prefix: 'e' },
    ])
    const { selected, note } = selectTestSet(checked, proposals, laneOf)
    expect(selected.filter((s) => s.lane === 'downfall')).toHaveLength(28)
    expect(selected.filter((s) => s.lane === 'success')).toHaveLength(12)
    expect(selected).toHaveLength(40)
    expect(note).toMatch(/28 downfall/)
    expect(note).toMatch(/12 success/)
    expect(note).toMatch(/success minimum \(12\) reached/)
  })

  it('misses stay in the set, with their lane from the note', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 2, prefix: 'a' },
    ])
    checked[0] = { videoId: 'a0', qid: null, verdict: 'miss-not-on-hitlist', note: 'lane: success' }
    const { selected } = selectTestSet(checked, proposals, laneOf)
    expect(selected).toHaveLength(2)
    const miss = selected.find((s) => s.videoId === 'a0')!
    expect(miss.lane).toBe('success')
    expect(miss.channelHandle).toBe('@A')
  })

  it('throws on a miss without a lane note', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 1, prefix: 'a' },
    ])
    checked[0] = { videoId: 'a0', qid: null, verdict: 'miss-not-on-hitlist', note: 'hmm' }
    expect(() => selectTestSet(checked, proposals, laneOf)).toThrow(/a0/)
  })

  it('counts unchecked, not-single and no-lane without failing', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 4, prefix: 'a' },
    ])
    const fx: SubjectFixture[] = [
      { videoId: proposals[0]!.videoId, qid: 'x', verdict: 'skip-not-single' },
      { videoId: proposals[1]!.videoId, qid: 'Qnolane', verdict: 'subject' },
      checked.find((c) => c.videoId === proposals[2]!.videoId)!,
    ]
    const { selected, note, unchecked } = selectTestSet(fx, proposals, laneOf)
    expect(selected).toHaveLength(1)
    expect(unchecked).toEqual([proposals[3]!.videoId])
    expect(note).toMatch(/1 skipped as not single/)
    expect(note).toMatch(/1 unchecked/)
    expect(note).toMatch(/1 skipped with no lane even today/)
  })

  it('keeps a subject with no lane at T, filling the quota by its lane today', () => {
    const { proposals, checked } = setup([{ handle: '@A', lane: 'success', count: 3, prefix: 'a' }])
    const late = proposals[0]!.videoId
    const { selected, note } = selectTestSet(checked, proposals, (qid, videoId) =>
      videoId === late ? { atT: null, today: 'success' } : laneOf(qid),
    )
    expect(selected).toHaveLength(3)
    expect(selected.find((s) => s.videoId === late)).toMatchObject({
      lane: 'success',
      noLaneAtT: true,
    })
    expect(selected.filter((s) => s.noLaneAtT)).toHaveLength(1)
    expect(note).toMatch(/3 success/)
    expect(note).toMatch(/1 kept with no lane at T/)
  })

  it('the lane callback is told which video it is for', () => {
    const proposals: SubjectProposal[] = ['v1', 'v2'].map((videoId, i) => ({
      videoId,
      channelHandle: '@A',
      title: 'Same subject',
      publishedAt: `2020-0${i + 1}-01`,
      proposedQid: 'Q1',
      matchedQuery: 'Same',
    }))
    const checked: SubjectFixture[] = proposals.map((p) => ({
      videoId: p.videoId,
      qid: 'Q1',
      verdict: 'subject',
    }))
    const { selected } = selectTestSet(checked, proposals, (_qid, videoId) =>
      videoId === 'v1' ? { atT: 'success', today: 'success' } : { atT: null, today: null },
    )
    expect(selected.map((s) => [s.videoId, s.lane])).toEqual([['v1', 'success']])
  })

  it('reports an unreached success minimum', () => {
    const { proposals, checked } = setup([
      { handle: '@A', lane: 'downfall', count: 3, prefix: 'a' },
    ])
    expect(selectTestSet(checked, proposals, laneOf).note).toMatch(/not reached/)
  })
})
