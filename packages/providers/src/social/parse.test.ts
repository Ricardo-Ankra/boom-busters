import { describe, expect, it } from 'vitest'
import { parseXOembed } from './parse'
import {
  OEMBED_EMOSTAQUE,
  OEMBED_ENDS_WITH_PIC,
  OEMBED_JACK,
  OEMBED_LONG_POST,
  OEMBED_MEDIA_ONLY,
} from './fixtures'

describe('parseXOembed', () => {
  it('parses a post with entities, a mention and a trailing t.co link', () => {
    const post = parseXOembed(OEMBED_EMOSTAQUE)

    expect(post.authorName).toBe('Emad')
    expect(post.handle).toBe('EMostaque')
    expect(post.postedAt).toBe('2024-03-23')
    expect(post.text).toBe(
      'As my notifications are RIP some notes:\n\n1. My shares have majority of vote @StabilityAI \n2. They have full board control\n\nThe concentration of power in AI is bad for us all\n\nI decided to step down to fix this at Stability & elsewhere\n\nWill be sharing more soon\n\nExciting times',
    )
    expect(post.text).toMatch(/^As my notifications are RIP some notes:\n\n1\. My shares/)
    expect(post.text).toContain('@StabilityAI')
    expect(post.text).toContain('Stability & elsewhere')
    expect(post.text).not.toContain('t.co')
    expect(post.endedWithMediaLink).toBe(true)
  })

  it('parses the oldest surviving post on the platform', () => {
    const post = parseXOembed(OEMBED_JACK)

    expect(post.authorName).toBe('jack')
    expect(post.handle).toBe('jack')
    expect(post.text).toBe('just setting up my twttr')
    expect(post.postedAt).toBe('2006-03-21')
    expect(post.endedWithMediaLink).toBe(false)
  })

  it('joins five paragraphs the way X joins them, with no media link', () => {
    const post = parseXOembed(OEMBED_LONG_POST)

    expect(post.authorName).toBe('River Kade')
    expect(post.handle).toBe('riverkade_dev')
    expect(post.postedAt).toBe('2022-06-05')
    expect(post.text).toBe(
      'Five things I learned building in public this year:\n\n1. Ship broken over ship never\n\n2. Nobody reads the changelog\n\n3. The best feedback comes from people who are annoyed\n\n4. Rewrites are a trap\n\n5. Done beats perfect, every single time',
    )
    expect(post.endedWithMediaLink).toBe(false)
  })

  it('gives a null text, not an empty string, when the post is only a media link', () => {
    const post = parseXOembed(OEMBED_MEDIA_ONLY)

    expect(post.text).toBeNull()
    expect(post.endedWithMediaLink).toBe(true)
    expect(post.authorName).toBe('Priya Osei')
    expect(post.handle).toBe('priyaosei_build')
    expect(post.postedAt).toBe('2021-01-09')
  })

  it('strips a bare pic.twitter.com token with no anchor around it', () => {
    const post = parseXOembed(OEMBED_ENDS_WITH_PIC)

    expect(post.text).toBe('New workspace setup, finally organised.')
    expect(post.endedWithMediaLink).toBe(true)
    expect(post.postedAt).toBe('2023-08-11')
  })

  it('gives every field null, never throwing, for shapes it does not recognise', () => {
    expect(parseXOembed(null)).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
    expect(parseXOembed(undefined)).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
    expect(parseXOembed('just a string')).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
    expect(parseXOembed({})).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
    expect(parseXOembed({ html: 42 })).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
    expect(parseXOembed({ html: '<p>no blockquote wrapper</p>' })).toEqual({
      authorName: null,
      handle: null,
      text: null,
      postedAt: null,
      endedWithMediaLink: false,
    })
  })
})
