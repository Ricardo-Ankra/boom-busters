// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  needsExcerptIn,
  SOCIAL_FRAMES,
  SOCIAL_TOO_LONG,
  socialDisplayText,
} from '@boom-busters/compositions/social'
import { DEFAULT_SETTINGS, excerptPlacement, newId, resolveBrandKit } from '@boom-busters/schemas'
import type { CastMember, SocialBrief, SocialPostRecord } from '@boom-busters/schemas'
import { isFetching, slotJobView, socialSlotView, visualsJobView } from './visuals-review'

/**
 * What the board shows for a social slot (decision 284, spec 8.4 and 9),
 * computed from rows already loaded: no database, no storage, no X.
 */

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const PROJECT = '01J0000000000000000000000A'
const CLAIM = '01HQ00000000000000000000S1'
const AVATAR_ASSET = '01HQ00000000000000000000V1'
const MEDIA_ASSET = '01HQ00000000000000000000M1'

const brief: SocialBrief = {
  type: 'social',
  coversText: 'He said it himself, in public.',
  description: 'The post, on screen.',
  motion: { kind: 'static' },
  transition: 'cut',
  sourceClaimId: CLAIM,
  postUrl: 'https://x.com/i/status/1734567890123456789',
}

/** Invented account: a fixture must never carry a real one. */
const post: SocialPostRecord = {
  url: 'https://x.com/i/status/1734567890123456789',
  platform: 'x',
  postId: '1734567890123456789',
  handle: 'DanaOkafor',
  authorName: 'Dana Okafor',
  text: 'The audit is finished and the $1.9 billion is not there.',
  postedAt: '2023-03-14',
  endedWithMediaLink: false,
  provenance: { authorName: 'oembed', handle: 'oembed', text: 'oembed', postedAt: 'oembed' },
  status: 'fetched',
  failureReason: null,
}

function member(overrides: Partial<CastMember>): CastMember {
  return {
    id: '01HQ00000000000000000000C1',
    projectId: PROJECT,
    name: 'Dana Okafor',
    role: 'Auditor',
    identityString: '',
    guardrail: '',
    xHandle: 'danaokafor',
    photos: [
      {
        r2Key: 'boom-busters/cast/p/front.jpg',
        contentHash: 'a'.repeat(64),
        mimeType: 'image/jpeg',
        width: 800,
        height: 800,
        view: 'front',
      },
    ],
    ...overrides,
  }
}

const SENTENCE =
  'The auditors asked three banks to confirm the escrow balances and none of them could. '
const LONG_PARAGRAPH = SENTENCE.repeat(4).trim()
/** Five paragraphs of about 350 characters: far past what one card holds. */
const LONG_TEXT = Array.from({ length: 5 }, () => LONG_PARAGRAPH).join('\n')

const base = {
  brief,
  post,
  cast: [] as CastMember[],
  images: new Map<string, string>(),
  urls: new Map<string, string>(),
  brand,
}

describe('socialSlotView', () => {
  it('carries its post and, when nothing is missing, a payload for the preview', () => {
    const view = socialSlotView(base)

    expect(view.post).toEqual(post)
    expect(view.issues).toEqual([])
    expect(view.payload).toMatchObject({
      kind: 'social',
      authorName: 'Dana Okafor',
      handle: 'DanaOkafor',
      text: post.text,
      initials: 'DO',
      claimId: CLAIM,
    })
  })

  it('names what is missing and draws no payload while it is', () => {
    const view = socialSlotView({ ...base, post: { ...post, postedAt: null } })

    expect(view.issues).toEqual([
      'A post card needs the name, the handle, the text and the date. Missing: the date.',
    ])
    expect(view.payload).toBeNull()
  })

  it('takes the uploaded profile picture first', () => {
    const view = socialSlotView({
      ...base,
      brief: { ...brief, avatarAssetId: AVATAR_ASSET },
      cast: [member({})],
      images: new Map([[AVATAR_ASSET, 'boom-busters/uploads/p/avatar.png']]),
      urls: new Map([
        ['boom-busters/uploads/p/avatar.png', 'https://r2.example/avatar.png'],
        ['boom-busters/cast/p/front.jpg', 'https://r2.example/front.jpg'],
      ]),
    })

    expect(view.avatar).toEqual({
      source: 'upload',
      url: 'https://r2.example/avatar.png',
      castName: null,
      castId: null,
    })
    expect(view.payload?.avatar).toMatchObject({ url: 'https://r2.example/avatar.png' })
  })

  it('falls back to the cast member whose handle matches, whatever its case', () => {
    const view = socialSlotView({
      ...base,
      cast: [
        member({ id: '01HQ00000000000000000000C0', name: 'Someone Else', xHandle: null }),
        member({}),
      ],
      urls: new Map([['boom-busters/cast/p/front.jpg', 'https://r2.example/front.jpg']]),
    })

    expect(view.avatar).toEqual({
      source: 'cast',
      url: 'https://r2.example/front.jpg',
      castName: 'Dana Okafor',
      castId: '01HQ00000000000000000000C1',
    })
  })

  it('never matches a cast member by name, and draws initials when nothing matches', () => {
    const view = socialSlotView({ ...base, cast: [member({ xHandle: 'someoneelse' })] })

    expect(view.avatar).toEqual({ source: 'initials', url: null, castName: null, castId: null })
    expect(view.payload?.avatar).toBeUndefined()
  })

  it('carries the attached image address', () => {
    const view = socialSlotView({
      ...base,
      brief: { ...brief, mediaAssetId: MEDIA_ASSET },
      images: new Map([[MEDIA_ASSET, 'boom-busters/uploads/p/media.png']]),
      urls: new Map([['boom-busters/uploads/p/media.png', 'https://r2.example/media.png']]),
    })

    expect(view.mediaUrl).toBe('https://r2.example/media.png')
    expect(view.payload?.media).toMatchObject({ url: 'https://r2.example/media.png' })
  })

  it('suggests no excerpt for a post that fits', () => {
    expect(socialSlotView(base).suggestedExcerpt).toBeNull()
  })

  it('suggests a word-for-word excerpt when the post is too long and none is chosen', () => {
    const view = socialSlotView({ ...base, post: { ...post, text: LONG_TEXT } })

    expect(view.issues).toEqual([SOCIAL_TOO_LONG])
    expect(view.suggestedExcerpt).not.toBeNull()
    expect(excerptPlacement(LONG_TEXT, view.suggestedExcerpt!)).not.toBeNull()
    expect(view.suggestedExcerpt!.length).toBeLessThan(LONG_TEXT.length)
  })

  it('suggests nothing once an excerpt is chosen', () => {
    const view = socialSlotView({
      ...base,
      post: { ...post, text: LONG_TEXT },
      brief: { ...brief, excerpt: LONG_PARAGRAPH },
    })

    expect(view.issues).toEqual([])
    expect(view.suggestedExcerpt).toBeNull()
    expect(view.payload).toMatchObject({ text: LONG_PARAGRAPH, cutAfter: true })
  })

  it('names the linked member even when they have no photo, so the link can be undone', () => {
    const view = socialSlotView({ ...base, cast: [member({ photos: [] })] })

    expect(view.avatar).toEqual({
      source: 'initials',
      url: null,
      castName: 'Dana Okafor',
      castId: '01HQ00000000000000000000C1',
    })
  })

  // Nine lines of about 46 characters: room on the landscape card, none on
  // the Shorts card that draws the same slot at 1080x1920.
  it('calls a post too long when it fits 16:9 but not 9:16, and suggests a cut that fits both', () => {
    const line = 'Our auditors could not find the missing money.'
    const text = Array.from({ length: 9 }, () => line).join('\n')
    const view = socialSlotView({ ...base, post: { ...post, text } })

    expect(view.issues).toEqual([SOCIAL_TOO_LONG])
    expect(view.payload).toBeNull()
    const suggested = view.suggestedExcerpt
    expect(suggested).not.toBeNull()
    const cuts = excerptPlacement(text, suggested!)!
    expect(
      needsExcerptIn(
        socialDisplayText(suggested!, cuts.cutBefore, cuts.cutAfter),
        false,
        brand,
        SOCIAL_FRAMES,
      ),
    ).toBe(false)
  })

  it('has no post, and says so, when nothing has been read', () => {
    const view = socialSlotView({ ...base, post: null })

    expect(view.post).toBeNull()
    expect(view.issues).toHaveLength(1)
    expect(view.payload).toBeNull()
    expect(view.suggestedExcerpt).toBeNull()
  })
})

describe('job stamps as the board reads them (decision 286)', () => {
  const startedAt = '2026-09-30T10:00:00.000Z'
  const jobId = newId()

  it('passes a slot stamp through without its job id, and reads anything else as no job', () => {
    expect(slotJobView({ kind: 'refetch', jobId, startedAt })).toEqual({
      kind: 'refetch',
      startedAt,
    })
    expect(slotJobView(null)).toBeNull()
    // A stamp that fails its schema must never lock a card.
    expect(slotJobView({ kind: 'refetch', startedAt })).toBeNull()
    expect(slotJobView({ kind: 'teleport', jobId, startedAt })).toBeNull()
  })

  it('passes a project stamp through the same way', () => {
    expect(visualsJobView({ op: 'shots', jobId, startedAt })).toEqual({ op: 'shots', startedAt })
    expect(visualsJobView({ op: 'replan', jobId, startedAt })).toBeNull()
  })

  it('reads a fetch as running only at the plan phase with a live stage', () => {
    expect(isFetching('plan', 'running')).toBe(true)
    expect(isFetching('plan', 'queued')).toBe(true)
    expect(isFetching('plan', 'awaiting_review')).toBe(false)
    // Stop in the middle of a fetch leaves the stage cancelled, not running.
    expect(isFetching('plan', 'cancelled')).toBe(false)
    expect(isFetching('plan', 'failed')).toBe(false)
    expect(isFetching('board', 'running')).toBe(false)
    expect(isFetching(null, 'running')).toBe(false)
  })
})
