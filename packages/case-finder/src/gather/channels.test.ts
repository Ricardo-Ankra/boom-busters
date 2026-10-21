import { describe, expect, it, vi } from 'vitest'
import { mockYoutube } from '../sources/mock'
import { YoutubeNotFoundError, type YoutubeSource } from '../sources/youtube'
import { minusDays } from '../dates'
import type { ChannelUploads, IsoDate, YoutubeVideo } from '../types'
import { channelMemo, historyNeeded } from './channels'

const upload = (id: string, publishedAt: IsoDate, channelId = 'UCa'): YoutubeVideo => ({
  id,
  channelId,
  title: `[fake] ${id}`,
  publishedAt,
  durationSec: 900,
  views: 1000,
})

/**
 * A channel whose fetch stops on the first upload strictly older than asked
 * (published the day before), and is complete only from `endsAt`; when `cap`
 * is set, no fetch reaches past it.
 */
function fakeYoutube({ endsAt = '2000-01-01', cap }: { endsAt?: IsoDate; cap?: IsoDate } = {}) {
  const uploads = vi.fn(
    async (
      channelId: string,
      _playlist: string,
      options: { until?: IsoDate } = {},
    ): Promise<ChannelUploads> => {
      const until = options.until === undefined ? endsAt : minusDays(options.until, 1)
      const oldest = [until, endsAt, cap ?? ''].reduce((a, b) => (a > b ? a : b))
      return {
        channelId,
        uploads: [upload('new', '2026-01-01', channelId), upload('old', oldest, channelId)],
        fetchedOn: '2026-10-20',
        complete: oldest === endsAt,
      }
    },
  )
  const youtube: YoutubeSource = { ...mockYoutube, uploads }
  return { youtube, uploads }
}

describe('channelMemo', () => {
  it('asks for the history back to `until`, at most 20 pages', async () => {
    const { youtube, uploads } = fakeYoutube()
    const memo = channelMemo(youtube)
    const got = await memo.fetch('UCa', '2018-12-01')
    expect(uploads).toHaveBeenCalledWith('UCa', 'UUa', { until: '2018-12-01', maxPages: 20 })
    expect(got?.uploads.at(-1)?.publishedAt).toBe('2018-11-30')
  })

  it('serves a request the held history already reaches without fetching again', async () => {
    const { youtube, uploads } = fakeYoutube()
    const memo = channelMemo(youtube)
    await memo.fetch('UCa', '2018-12-01')
    await memo.fetch('UCa', '2018-12-01')
    await memo.fetch('UCa', '2019-06-01')
    expect(uploads).toHaveBeenCalledTimes(1)
  })

  it('fetches again, deeper, when a request needs older history', async () => {
    const { youtube, uploads } = fakeYoutube()
    const memo = channelMemo(youtube)
    await memo.fetch('UCa', '2018-12-01')
    const deeper = await memo.fetch('UCa', '2017-07-01')
    expect(uploads).toHaveBeenCalledTimes(2)
    expect(uploads.mock.calls[1]![2]).toEqual({ until: '2017-07-01', maxPages: 20 })
    expect(deeper?.uploads.at(-1)?.publishedAt).toBe('2017-06-30')
  })

  it('a held history whose oldest upload is on the date asked is not old enough', async () => {
    const { youtube, uploads } = fakeYoutube()
    const memo = channelMemo(youtube)
    await memo.fetch('UCa', '2018-12-01')
    // The held oldest upload is 2018-11-30: strictly before 2018-12-01, but not before itself.
    await memo.fetch('UCa', '2018-11-30')
    expect(uploads).toHaveBeenCalledTimes(2)
  })

  it('never fetches a complete history again', async () => {
    const { youtube, uploads } = fakeYoutube({ endsAt: '2019-01-01' })
    const memo = channelMemo(youtube)
    expect((await memo.fetch('UCa', '2018-12-01'))?.complete).toBe(true)
    await memo.fetch('UCa', '2010-01-01')
    expect(uploads).toHaveBeenCalledTimes(1)
  })

  it('never fetches again once the page cap stopped a history short', async () => {
    const { youtube, uploads } = fakeYoutube({ cap: '2020-01-01' })
    const memo = channelMemo(youtube)
    const capped = await memo.fetch('UCa', '2018-12-01')
    expect(capped?.complete).toBe(false)
    await memo.fetch('UCa', '2010-01-01')
    expect(uploads).toHaveBeenCalledTimes(1)
  })

  it('a missing uploads playlist is null, and remembered; any other error throws', async () => {
    const gone = vi.fn(async () => {
      throw new YoutubeNotFoundError('playlist UUa not found')
    })
    const memo = channelMemo({ ...mockYoutube, uploads: gone })
    expect(await memo.fetch('UCa', '2018-12-01')).toBeNull()
    expect(await memo.fetch('UCa', '2010-01-01')).toBeNull()
    expect(gone).toHaveBeenCalledTimes(1)

    const broken = channelMemo({
      ...mockYoutube,
      uploads: async () => {
        throw new Error('status 500')
      },
    })
    await expect(broken.fetch('UCa', '2018-12-01')).rejects.toThrow(/500/)
  })
})

describe('historyNeeded', () => {
  it('gives each channel the window start of its oldest counted video, in search order', () => {
    const needed = historyNeeded([
      upload('a', '2019-08-31', 'UCb'),
      upload('b', '2019-06-01', 'UCa'),
      upload('c', '2018-08-31', 'UCb'),
    ])
    expect([...needed]).toEqual([
      ['UCb', '2018-02-28'],
      ['UCa', '2018-12-01'],
    ])
  })
})
