import { describe, expect, it, vi } from 'vitest'
import { laneAt, type Sources } from '../evidence'
import { classify } from '../score/rank'
import type { DatedTag, HitlistEntry } from '../types'
import {
  ANCHOR,
  DOWNFALL,
  T,
  byQid,
  entry,
  fakeWikipedia,
  flatPageviews,
  gather,
  sources,
} from './fixtures'

/** Pass 1's tag dating at T: categories, lists, dated tags, the founder link and the floor. */

describe('tags at T, through gatherAt', () => {
  it("a category tag counts only if the revision before T's month has it", async () => {
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Accounting scandals'] } })
    const hitlist = [
      entry('Q1', {
        tags: [
          { tag: 'category:Accounting scandals', lane: 'downfall', since: null },
          { tag: 'category:Ponzi schemes', lane: 'downfall', since: null },
        ],
      }),
      entry('Q2', {
        tags: [{ tag: 'category:Accounting scandals', lane: 'downfall', since: null }],
      }),
    ]
    const evidence = await gather(hitlist, sources({ wikipedia }))
    expect(wikipedia.revisionBefore).toHaveBeenCalledWith('Article Q1', '2020-03-01')
    expect(byQid(evidence, 'Q1').tagsAtT.map((t) => t.tag)).toEqual([
      'category:Accounting scandals',
    ])
    // Q2's article had no revision before the month, so its category tag is dropped.
    expect(byQid(evidence, 'Q2').tagsAtT).toEqual([])
  })

  it('a dated category tag also needs its date before T', async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': { categories: ['Companies that filed for Chapter 11 bankruptcy in 2020'] },
    })
    const tag: DatedTag = {
      tag: 'category:Companies that filed for Chapter 11 bankruptcy in 2020',
      lane: 'downfall',
      since: '2020-03-15',
    }
    const evidence = await gather([entry('Q1', { tags: [tag] })], sources({ wikipedia }))
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([])
  })

  it('a founder-link tag counts at T only with a 24-month median of 1,000 before T', async () => {
    const founder: DatedTag = { tag: 'founder-link', lane: 'success', since: null }
    const hitlist = [entry('Q1', { tags: [founder] }), entry('Q2', { tags: [founder, DOWNFALL] })]
    const pageviews = flatPageviews({ 'Article Q1': 999, 'Article Q2': 999 })
    const evidence = await gather(hitlist, sources({ pageviews }))
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([])
    expect(byQid(evidence, 'Q2').tagsAtT).toEqual([DOWNFALL])
    const popular = await gather([entry('Q1', { tags: [founder] })], sources())
    expect(popular[0]!.tagsAtT).toEqual([founder])
  })

  it('a LoPucki tag filed after T is ignored', async () => {
    const hitlist = [
      entry('Q1', { tags: [{ tag: 'lopucki', lane: 'downfall', since: '2020-03-15' }] }),
      entry('Q2', { tags: [{ tag: 'lopucki', lane: 'downfall', since: '2020-03-14' }] }),
      entry('Q3', { tags: [{ tag: 'founder-link', lane: 'success', since: null }] }),
    ]
    const evidence = await gather(hitlist, sources())
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([])
    expect(byQid(evidence, 'Q2').tagsAtT.map((t) => t.tag)).toEqual(['lopucki'])
    expect(byQid(evidence, 'Q3').tagsAtT.map((t) => t.tag)).toEqual(['founder-link'])
  })

  it("a list tag counts only when the list page's revision before T's month links to the entry", async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': {},
      'Article Q2': {},
      'List of frauds': { links: ['Article_Q1', 'Something else'] },
    })
    const tag: DatedTag = { tag: 'list:List of frauds', lane: 'downfall', since: null }
    const hitlist = [entry('Q1', { tags: [tag] }), entry('Q2', { tags: [tag] })]
    const evidence = await gather(hitlist, sources({ wikipedia }))
    expect(byQid(evidence, 'Q1').tagsAtT).toEqual([tag])
    expect(byQid(evidence, 'Q2').tagsAtT).toEqual([])
    const listCalls = vi
      .mocked(wikipedia.revisionBefore)
      .mock.calls.filter(([title]) => title === 'List of frauds')
    expect(listCalls).toEqual([['List of frauds', '2020-03-01']])
  })

  it('a list tag also counts when the list links to one of the entry redirects', async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': {},
      'List of frauds': { links: ['Old name of Q1'] },
    })
    vi.mocked(wikipedia.redirectsTo).mockImplementation(async (title) =>
      title === 'Article Q1' ? ['old_name of Q1'] : [],
    )
    const tag: DatedTag = { tag: 'list:List of frauds', lane: 'downfall', since: null }
    const [e] = await gather([entry('Q1', { tags: [tag] })], sources({ wikipedia }))
    expect(e!.tagsAtT).toEqual([tag])
  })

  it('list matching sees a redirect that is not a former title, and pageviews do not', async () => {
    const pageviews = flatPageviews()
    const wikipedia = fakeWikipedia({
      'Article Q1': {},
      'List of frauds': { links: ['Nickname'] },
    })
    vi.mocked(wikipedia.redirectsTo).mockResolvedValue(['Nickname'])
    const tag: DatedTag = { tag: 'list:List of frauds', lane: 'downfall', since: null }
    const [e] = await gather([entry('Q1', { tags: [tag] })], sources({ wikipedia, pageviews }))
    expect(e!.tagsAtT).toEqual([tag])
    for (const [, titles] of vi.mocked(pageviews.monthly).mock.calls) {
      expect(titles).toEqual(['Article Q1'])
    }
  })

  it('an entry below the floor gets no revision call and keeps only its dated plain tags', async () => {
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Ponzi schemes'] } })
    const hitlist = [
      entry('Q1', {
        tags: [
          { tag: 'category:Ponzi schemes', lane: 'downfall', since: null },
          { tag: 'list:List of frauds', lane: 'downfall', since: null },
          { tag: 'lopucki', lane: 'downfall', since: '2019-02-01' },
          { tag: 'wikidata:dissolved-convicted', lane: 'downfall', since: '2021-01-01' },
        ],
      }),
    ]
    const s = sources({ wikipedia, pageviews: flatPageviews({ 'Article Q1': 299 }) })
    const [e] = await gather(hitlist, s)
    expect(wikipedia.revisionBefore).not.toHaveBeenCalled()
    expect(wikipedia.parsed).not.toHaveBeenCalled()
    expect(e!.tagsAtT.map((t) => t.tag)).toEqual(['lopucki'])
  })

  it('a below-floor entry with only category tags is reported below floor', async () => {
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Ponzi schemes'] } })
    const hitlist = [
      entry('Q1', { tags: [{ tag: 'category:Ponzi schemes', lane: 'downfall', since: null }] }),
    ]
    const s = sources({ wikipedia, pageviews: flatPageviews({ 'Article Q1': 299 }) })
    const evidence = await gather(hitlist, s)
    expect(evidence[0]!.tagsAtT).toEqual([])
    expect(classify(evidence).unranked).toEqual([{ qid: 'Q1', lane: null, reason: 'below floor' }])
  })
})

describe('laneAt', () => {
  const lane = (e: HitlistEntry, s: Sources, asOf = T) => laneAt(e, asOf, s, { anchorDay: ANCHOR })

  it("dates a category tag against the revision before T's month, with no floor check", async () => {
    const pageviews = flatPageviews({ 'Article Q1': 1, 'Article Q2': 1 })
    const wikipedia = fakeWikipedia({ 'Article Q1': { categories: ['Ponzi schemes'] } })
    const tag: DatedTag = { tag: 'category:Ponzi schemes', lane: 'downfall', since: null }
    const s = sources({ pageviews, wikipedia })
    expect(await lane(entry('Q1', { tags: [tag] }), s)).toBe('downfall')
    expect(await lane(entry('Q2', { tags: [tag] }), s)).toBeNull()
    expect(wikipedia.revisionBefore).toHaveBeenCalledWith('Article Q1', '2020-03-01')
    expect(pageviews.monthly).not.toHaveBeenCalled()
  })

  it('a tag dated on or after T does not count, and a downfall tag wins', async () => {
    const s = sources()
    const success: DatedTag = { tag: 'founder-link', lane: 'success', since: null }
    const late: DatedTag = { tag: 'lopucki', lane: 'downfall', since: T }
    expect(await lane(entry('Q1', { tags: [success, late] }), s)).toBe('success')
    expect(await lane(entry('Q1', { tags: [success, DOWNFALL] }), s)).toBe('downfall')
    expect(await lane(entry('Q1', { tags: [late] }), s)).toBeNull()
  })

  it('a list tag counts when the list before T links to one of the redirects', async () => {
    const wikipedia = fakeWikipedia({
      'Article Q1': {},
      'List of frauds': { links: ['Old name of Q1'] },
    })
    vi.mocked(wikipedia.redirectsTo).mockResolvedValue(['Old name of Q1'])
    const tag: DatedTag = { tag: 'list:List of frauds', lane: 'downfall', since: null }
    expect(await lane(entry('Q1', { tags: [tag] }), sources({ wikipedia }))).toBe('downfall')
  })

  it('an entry with no English title keeps only its plain dated tags', async () => {
    const tags: DatedTag[] = [
      { tag: 'category:Ponzi schemes', lane: 'downfall', since: null },
      { tag: 'lopucki', lane: 'downfall', since: '2019-01-01' },
    ]
    expect(await lane(entry('Q1', { enTitle: null, tags }), sources())).toBe('downfall')
  })

  it('a founder-link tag needs its 24-month median before T, read from the same series', async () => {
    const founder: DatedTag = { tag: 'founder-link', lane: 'success', since: null }
    const pageviews = flatPageviews({ 'Article Q1': 999 })
    expect(await lane(entry('Q1', { tags: [founder] }), sources({ pageviews }))).toBeNull()
    expect(pageviews.monthly).toHaveBeenCalledWith(
      'en.wikipedia',
      ['Article Q1'],
      '2015-07',
      '2026-09',
    )
    expect(await lane(entry('Q2', { tags: [founder] }), sources())).toBe('success')
    expect(await lane(entry('Q3', { enTitle: null, tags: [founder] }), sources())).toBeNull()
  })
})
