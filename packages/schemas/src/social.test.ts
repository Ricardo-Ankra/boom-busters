import { describe, expect, it } from 'vitest'
import {
  SocialPostRecordSchema,
  claimCarriesPost,
  excerptPlacement,
  missingPostFields,
  normalisePostUrl,
  parsePostUrl,
  phraseIn,
  postInitials,
  postIsRenderable,
  postPublicUrl,
} from './social'
import type { SocialPostRecord } from './social'

const RECORD: SocialPostRecord = {
  url: 'https://x.com/i/status/1771400218170519741',
  platform: 'x',
  postId: '1771400218170519741',
  handle: 'EMostaque',
  authorName: 'Emad',
  text: 'As my notifications are RIP some notes',
  postedAt: '2024-03-23',
  endedWithMediaLink: false,
  provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
  status: 'fetched',
  failureReason: null,
}

describe('SocialPostRecordSchema', () => {
  it('parses a fetched record', () => {
    expect(SocialPostRecordSchema.parse(RECORD)).toEqual(RECORD)
  })

  it('accepts a record with nothing on it but a failure', () => {
    const failed = SocialPostRecordSchema.parse({
      url: RECORD.url,
      platform: 'x',
      postId: RECORD.postId,
      handle: null,
      authorName: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
      status: 'failed',
      failureReason: 'X says this post does not exist or is not public.',
    })
    expect(failed.provenance).toEqual({})
  })

  it('refuses a post id that is not a bare number', () => {
    expect(SocialPostRecordSchema.safeParse({ ...RECORD, postId: '123abc' }).success).toBe(false)
  })

  it('refuses a handle carrying the @ sign', () => {
    expect(SocialPostRecordSchema.safeParse({ ...RECORD, handle: '@EMostaque' }).success).toBe(
      false,
    )
  })
})

describe('parsePostUrl and normalisePostUrl', () => {
  it('folds every way a post is shared to the same key, by id, not by handle', () => {
    const expected = 'https://x.com/i/status/1771400218170519741'
    expect(normalisePostUrl('https://twitter.com/emostaque/status/1771400218170519741')).toBe(
      expected,
    )
    expect(
      normalisePostUrl('https://x.com/EMostaque/status/1771400218170519741/photo/1?s=20'),
    ).toBe(expected)
    expect(
      normalisePostUrl('https://mobile.twitter.com/EMostaque/status/1771400218170519741#m'),
    ).toBe(expected)
    expect(normalisePostUrl('https://x.com/i/web/status/1771400218170519741')).toBe(expected)
  })

  it('refuses anything that is not a post address', () => {
    expect(normalisePostUrl('https://x.com/EMostaque')).toBeNull()
    expect(normalisePostUrl('https://x.com/search?q=stability')).toBeNull()
    expect(normalisePostUrl('https://x.com/i/lists/123')).toBeNull()
    expect(normalisePostUrl('https://semafor.com/status/1')).toBeNull()
    expect(normalisePostUrl('mailto:a@b.c')).toBeNull()
    expect(normalisePostUrl('not a url')).toBeNull()
  })

  it("keeps the handle's case", () => {
    expect(parsePostUrl('https://x.com/EMostaque/status/1771400218170519741')).toEqual({
      postId: '1771400218170519741',
      handle: 'EMostaque',
    })
  })

  it('gives a null handle for the addresses that carry none', () => {
    expect(parsePostUrl('https://x.com/i/status/1771400218170519741')).toEqual({
      postId: '1771400218170519741',
      handle: null,
    })
    expect(parsePostUrl('https://x.com/i/web/status/1771400218170519741')).toEqual({
      postId: '1771400218170519741',
      handle: null,
    })
  })
})

describe('postPublicUrl', () => {
  it('links to the handle when one is known, else to the id-only address', () => {
    expect(postPublicUrl({ handle: 'EMostaque', postId: '1' })).toBe(
      'https://x.com/EMostaque/status/1',
    )
    expect(postPublicUrl({ handle: null, postId: '1' })).toBe('https://x.com/i/status/1')
  })
})

describe('missingPostFields and postIsRenderable', () => {
  it('names each missing field, in order', () => {
    expect(missingPostFields(RECORD)).toEqual([])
    expect(
      missingPostFields({ authorName: null, handle: null, text: null, postedAt: null }),
    ).toEqual(['the name', 'the handle', 'the text', 'the date'])
    expect(missingPostFields({ ...RECORD, postedAt: null })).toEqual(['the date'])
  })

  it('needs all four fields', () => {
    expect(postIsRenderable(RECORD)).toBe(true)
    expect(postIsRenderable({ ...RECORD, handle: null })).toBe(false)
    expect(postIsRenderable({ ...RECORD, authorName: null })).toBe(false)
    expect(postIsRenderable({ ...RECORD, text: null })).toBe(false)
    expect(postIsRenderable({ ...RECORD, postedAt: null })).toBe(false)
  })
})

describe('claimCarriesPost', () => {
  it('is true for a claim sourced to a post address, whatever its sourceType', () => {
    expect(claimCarriesPost({ sourceUrl: 'https://twitter.com/a/status/9' })).toBe(true)
  })

  it('is false for anything that is not a post address', () => {
    expect(claimCarriesPost({ sourceUrl: 'https://ft.example/content/abc' })).toBe(false)
    expect(claimCarriesPost({ sourceUrl: 'https://x.com/EMostaque' })).toBe(false)
    expect(claimCarriesPost({ sourceUrl: null })).toBe(false)
    expect(claimCarriesPost(undefined)).toBe(false)
  })
})

describe('postInitials', () => {
  it('takes the first letters of the first two words, upper case', () => {
    expect(postInitials('Emad Mostaque')).toBe('EM')
    expect(postInitials('jack')).toBe('J')
    expect(postInitials('')).toBe('?')
  })
})

describe('excerptPlacement', () => {
  const text = 'As my notifications are RIP some notes about the company'

  it('marks both ends cut when the excerpt sits in the middle', () => {
    expect(excerptPlacement(text, 'RIP some notes')).toEqual({
      cutBefore: true,
      cutAfter: true,
    })
  })

  it('marks no cut before the excerpt when it opens the text', () => {
    expect(excerptPlacement(text, 'As my notifications')).toEqual({
      cutBefore: false,
      cutAfter: true,
    })
  })

  it('refuses a paraphrase', () => {
    expect(excerptPlacement(text, 'my notifications have gone')).toBeNull()
  })

  it('matches across the whitespace the renderer collapses', () => {
    const messy = 'As my  notifications are RIP\nsome notes about the company'
    expect(excerptPlacement(messy, 'RIP some notes')).toEqual({ cutBefore: true, cutAfter: true })
  })

  it('refuses an excerpt that starts in the middle of a word', () => {
    expect(excerptPlacement('I will never resign', 'ever resign')).toBeNull()
  })

  it('refuses an excerpt that ends in the middle of a word', () => {
    expect(excerptPlacement('I will never resign today', 'I will never res')).toBeNull()
  })

  it('accepts an excerpt that ends just before a comma', () => {
    expect(excerptPlacement('I will never resign, not today.', 'I will never resign')).toEqual({
      cutBefore: false,
      cutAfter: true,
    })
  })

  it('takes a later whole-word occurrence when the first is inside a word', () => {
    expect(excerptPlacement('forever and ever', 'ever')).toEqual({
      cutBefore: true,
      cutAfter: false,
    })
  })
})

describe('phraseIn', () => {
  it('is the whitespace-collapsing substring test', () => {
    expect(phraseIn('Auditors cannot  find the  money', 'cannot find')).toBe(true)
    expect(phraseIn('Auditors cannot find the money', 'could not find')).toBe(false)
  })
})
