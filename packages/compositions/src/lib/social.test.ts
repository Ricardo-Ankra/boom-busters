import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  POST_MEDIA_ONLY_REASON,
  SocialPayloadSchema,
  articleSourceLabel,
  postInitials,
  postPublicUrl,
  resolveBrandKit,
} from '@boom-busters/schemas'
import type { SocialPostRecord } from '@boom-busters/schemas'
import { graphicDrift, safeArea } from './graphic'
import {
  SOCIAL_EXCERPT_NOT_VERBATIM,
  SOCIAL_EXCERPT_TOO_LONG,
  SOCIAL_HIGHLIGHT_OUTSIDE,
  SOCIAL_MISSING_PREFIX,
  SOCIAL_TOO_LONG,
  buildSocialPayload,
  estimateLines,
  needsExcerpt,
  postSegments,
  socialDisplayText,
  socialLayout,
  socialProgress,
  socialSlotIssues,
  suggestExcerpt,
  wordWidthPx,
} from './social'

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const body = brand.typography.body
const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }
const CLAIM_ID = '01HQ00000000000000000000A1'

// Emad Mostaque's resignation post (spec section 4), extended by one
// sentence to a 280 character fixture of ordinary English words.
const POST_280 =
  'As my notifications are RIP some notes: my shares have majority of vote at StabilityAI and they have full board control. The concentration of power in AI is bad for us all, so I decided to step down to fix this at Stability and elsewhere now. Exciting times. Will share more soon.'

const LONG_SENTENCE =
  'The concentration of power in artificial intelligence is bad for everyone involved and I decided to step down from my board seat to fix this properly at Stability and elsewhere across the whole industry. '
const LONG_1000 = LONG_SENTENCE.repeat(Math.ceil(1000 / LONG_SENTENCE.length)).slice(0, 1000)

const LADDER_WORDS =
  'the quick brown fox jumps over the lazy dog while stability concentrates power across the whole board and every notification arrives faster than the last one during a hectic Tuesday afternoon in March when the markets were already unsettled and traders kept refreshing their screens for news that never quite '
const LADDER_TEXT = LADDER_WORDS.repeat(Math.ceil(600 / LADDER_WORDS.length))

const READY: SocialPostRecord = {
  url: 'https://x.com/i/status/1771400218170519741',
  platform: 'x',
  postId: '1771400218170519741',
  handle: 'EMostaque',
  authorName: 'Emad Mostaque',
  text: 'Short post text here.',
  postedAt: '2024-03-23',
  endedWithMediaLink: false,
  provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
  status: 'fetched',
  failureReason: null,
}

describe('socialLayout', () => {
  it('takes the largest ladder size for a short post', () => {
    const layout = socialLayout({
      text: 'just setting up my twttr',
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(layout.textPx).toBe(60)
    expect(layout.fits).toBe(true)
  })

  it('sizes a 280 character post between 37 and 48 px in WIDE', () => {
    const layout = socialLayout({ text: POST_280, hasMedia: false, frame: WIDE, brand })
    expect(layout.textPx).toBeGreaterThanOrEqual(37)
    expect(layout.textPx).toBeLessThanOrEqual(48)
    expect(layout.fits).toBe(true)
  })

  it('does not fit a 1000 character post in WIDE, and needsExcerpt agrees', () => {
    const layout = socialLayout({ text: LONG_1000, hasMedia: false, frame: WIDE, brand })
    expect(layout.fits).toBe(false)
    expect(needsExcerpt(LONG_1000, false, brand, WIDE)).toBe(true)
  })

  it('never sizes text larger because the card also carries media', () => {
    const withoutMedia = socialLayout({
      text: POST_280,
      hasMedia: false,
      frame: WIDE,
      brand,
    }).textPx
    const withMedia = socialLayout({ text: POST_280, hasMedia: true, frame: WIDE, brand }).textPx
    expect(withMedia).toBeLessThanOrEqual(withoutMedia)
  })

  it('never estimates a height past the card maxHeight when it fits, for every ladder step and both frames', () => {
    for (const frame of [WIDE, TALL]) {
      for (const hasMedia of [false, true]) {
        for (let length = 10; length <= 600; length += 10) {
          const text = LADDER_TEXT.slice(0, length)
          const layout = socialLayout({ text, hasMedia, frame, brand })
          if (layout.fits) {
            expect(layout.estimatedHeight).toBeLessThanOrEqual(layout.card.maxHeight)
          }
        }
      }
    }
  })

  it('sizes the TALL card and band from the frame and the safe area', () => {
    const layout = socialLayout({ text: 'x', hasMedia: false, frame: TALL, brand })
    expect(layout.card.width).toBe(1080 * 0.88)
    expect(layout.band.top).toBeGreaterThanOrEqual(1920 * 0.1)
    const safe = safeArea(TALL)
    expect(layout.band.top + layout.band.height).toBe(safe.y + safe.h)
  })
})

describe('socialProgress', () => {
  it('starts unsettled, with no sweep', () => {
    const progress = socialProgress(0, 30, 180)
    expect(progress.settle).toBe(0)
    expect(progress.sweep).toBe(0)
  })

  it('is settled with a partial sweep a second in', () => {
    const progress = socialProgress(30, 30, 180)
    expect(progress.settle).toBe(1)
    expect(progress.sweep).toBeGreaterThan(0)
    expect(progress.sweep).toBeLessThan(1)
  })

  it('is fully settled and swept by the last frame, drifting like a graphic card', () => {
    const progress = socialProgress(179, 30, 180)
    expect(progress.settle).toBe(1)
    expect(progress.sweep).toBe(1)
    expect(progress.drift).toBe(graphicDrift(179, 180))
  })
})

describe('wordWidthPx', () => {
  it('reads a wide-character word at 1 em a glyph', () => {
    expect(wordWidthPx('日本語のテキスト', 40, body)).toBe(320)
  })

  it('reads an emoji-only word at 1 em a glyph', () => {
    expect(wordWidthPx('🔥', 40, body)).toBe(40)
  })
})

describe('estimateLines', () => {
  it('breaks a word too wide for the line wherever it must', () => {
    expect(estimateLines('x'.repeat(70), 40, 300, body)).toBe(6)
    expect(estimateLines('x'.repeat(70), 40, 300, body)).toBeGreaterThanOrEqual(
      Math.ceil((70 * 0.56 * 40) / 300),
    )
  })

  it('counts a blank line as a line', () => {
    expect(estimateLines('a\n\nb', 40, 900, body)).toBe(3)
  })
})

describe('socialDisplayText', () => {
  it('adds an ellipsis at each cut', () => {
    expect(socialDisplayText('words', true, true)).toBe('… words …')
    expect(socialDisplayText('words', false, false)).toBe('words')
    expect(socialDisplayText('words', true, false)).toBe('… words')
    expect(socialDisplayText('words', false, true)).toBe('words …')
  })
})

describe('postSegments', () => {
  it('marks a mention, a hashtag and a link as entities', () => {
    const segments = postSegments('Hi @StabilityAI see https://t.co/x #ai', undefined)
    const entityText = (needle: string) =>
      segments.find((segment) => segment.text === needle)?.entity
    expect(entityText('@StabilityAI')).toBe(true)
    expect(entityText('https://t.co/x')).toBe(true)
    expect(entityText('#ai')).toBe(true)
    expect(segments.some((segment) => segment.emphasised)).toBe(false)
  })

  it('marks exactly the emphasis phrase, and nothing else, as emphasised', () => {
    const segments = postSegments('We have $101m in cash', '$101m')
    const emphasised = segments
      .filter((segment) => segment.emphasised)
      .map((segment) => segment.text)
      .join('')
    expect(emphasised).toBe('$101m')
    expect(segments.filter((segment) => segment.emphasised)).toHaveLength(1)
  })

  it('still marks the words when the emphasis phrase is split across a newline', () => {
    const display = 'Line one $101m\nin cash today'
    const segments = postSegments(display, '$101m in cash')
    const emphasised = segments
      .filter((segment) => segment.emphasised)
      .map((segment) => segment.text)
      .join('')
    expect(emphasised.replace(/\s+/g, ' ').trim()).toBe('$101m in cash')
  })
})

describe('suggestExcerpt', () => {
  const P1 = 'Paragraph one has some words in it today.'
  const P2 = 'Paragraph two continues the thought further along.'
  const P3 = 'Paragraph three carries the highlight phrase inside it.'
  const P4 = 'Paragraph four wraps up nicely with more words in it.'
  const P5 = 'Paragraph five closes out the whole post finally.'
  const FIVE_PARAGRAPHS = [P1, P2, P3, P4, P5].join('\n')

  it('grows from the paragraph holding the highlight while it fits', () => {
    const fits = (candidate: string) => candidate.length <= 140
    const excerpt = suggestExcerpt(FIVE_PARAGRAPHS, 'carries the highlight phrase', fits)
    expect(excerpt).not.toBeNull()
    expect(excerpt).toContain('Paragraph three')
    expect(fits(excerpt as string)).toBe(true)
  })

  it('starts at the first paragraph when there is no highlight', () => {
    const fits = (candidate: string) => candidate.length <= 140
    const excerpt = suggestExcerpt(FIVE_PARAGRAPHS, undefined, fits)
    expect(excerpt).not.toBeNull()
    expect((excerpt as string).startsWith('Paragraph one')).toBe(true)
  })

  it('returns null when not even one sentence fits', () => {
    expect(suggestExcerpt('This is one short sentence right here.', undefined, () => false)).toBe(
      null,
    )
  })
})

describe('socialSlotIssues', () => {
  it('returns no issues for a complete short post', () => {
    expect(socialSlotIssues({ post: READY, hasMedia: false, frame: WIDE, brand })).toEqual([])
  })

  it('names the missing field for a record lacking its date', () => {
    const issues = socialSlotIssues({
      post: { ...READY, postedAt: null },
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(issues).toEqual([`${SOCIAL_MISSING_PREFIX}the date.`])
  })

  it('gives the media-only reason for a null text post that ended with a media link', () => {
    const issues = socialSlotIssues({
      post: { ...READY, text: null, endedWithMediaLink: true },
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(issues).toEqual([POST_MEDIA_ONLY_REASON])
  })

  it('says a long post with no excerpt is too long', () => {
    const issues = socialSlotIssues({
      post: { ...READY, text: LONG_1000 },
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(issues).toEqual([SOCIAL_TOO_LONG])
  })

  it('refuses a paraphrased excerpt', () => {
    const issues = socialSlotIssues({
      post: READY,
      excerpt: 'not the actual words',
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(issues).toEqual([SOCIAL_EXCERPT_NOT_VERBATIM])
  })

  it('flags a highlight that sits outside the excerpt', () => {
    const issues = socialSlotIssues({
      post: READY,
      excerpt: 'Short post',
      emphasis: 'text here',
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(issues).toEqual([SOCIAL_HIGHLIGHT_OUTSIDE])
  })

  it('says a verbatim excerpt that does not fit is still too long', () => {
    const issues = socialSlotIssues({
      post: { ...READY, text: LONG_1000 },
      excerpt: LONG_1000,
      hasMedia: false,
      frame: WIDE,
      brand,
    })
    expect(SOCIAL_EXCERPT_TOO_LONG).toBe('Still too long for the card.')
    expect(issues).toEqual([SOCIAL_EXCERPT_TOO_LONG])
  })
})

describe('buildSocialPayload', () => {
  it('returns null for an unready post', () => {
    expect(
      buildSocialPayload({
        post: { ...READY, postedAt: null },
        claimId: CLAIM_ID,
        frame: WIDE,
        brand,
      }),
    ).toBeNull()
  })

  it('builds a payload that parses, with sourceLabel and initials from the post', () => {
    const payload = buildSocialPayload({ post: READY, claimId: CLAIM_ID, frame: WIDE, brand })
    expect(payload).not.toBeNull()
    const parsed = SocialPayloadSchema.parse(payload)
    expect(parsed.sourceLabel).toBe(articleSourceLabel(postPublicUrl(READY)))
    expect(parsed.initials).toBe(postInitials(READY.authorName as string))
  })
})
