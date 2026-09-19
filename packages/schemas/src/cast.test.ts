import { describe, expect, it } from 'vitest'
import {
  CastMemberSchema,
  castPhotoExtension,
  CastPhotoSchema,
  depictedMembers,
  MAX_CAST_PHOTOS,
  nameMatches,
  referencePhotos,
} from './cast'
import type { CastPhoto } from './cast'

function photo(view: CastPhoto['view'], hash = `h-${view}`): CastPhoto {
  return {
    r2Key: `boom-busters/cast/p1/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 1600,
    view,
  }
}

const member = {
  id: 'c1',
  projectId: 'p1',
  name: 'Emad Mostaque',
  role: 'Founder and former CEO, Stability AI',
  identityString: '',
  guardrail: '',
  photos: [photo('three-quarter'), photo('front')],
}

describe('cast schemas', () => {
  it('parses a member with photos', () => {
    expect(CastMemberSchema.parse(member).photos).toHaveLength(2)
  })

  it('caps the photos at four', () => {
    const five = Array.from({ length: MAX_CAST_PHOTOS + 1 }, (_, i) => photo('other', `h${i}`))
    expect(CastMemberSchema.safeParse({ ...member, photos: five }).success).toBe(false)
  })

  it('refuses a photo type the image models do not take', () => {
    expect(CastPhotoSchema.safeParse({ ...photo('front'), mimeType: 'image/gif' }).success).toBe(
      false,
    )
  })

  it('needs a name: it is the join key for depicts and the book', () => {
    expect(CastMemberSchema.safeParse({ ...member, name: '   ' }).success).toBe(false)
  })
})

describe('referencePhotos', () => {
  it('sends the front view first and honours the limit', () => {
    expect(referencePhotos(member, 1).map((p) => p.view)).toEqual(['front'])
    expect(referencePhotos(member, 3).map((p) => p.view)).toEqual(['front', 'three-quarter'])
    expect(referencePhotos({ photos: [] }, 2)).toEqual([])
  })
})

describe('castPhotoExtension', () => {
  it('maps the three accepted types', () => {
    expect(castPhotoExtension('image/jpeg')).toBe('jpg')
    expect(castPhotoExtension('image/png')).toBe('png')
    expect(castPhotoExtension('image/webp')).toBe('webp')
  })
})

/**
 * The join between a brief's "depicts" list and the cast. The planner is
 * asked for the name alone and on 2026-09-19 wrote the role after it, which
 * an exact-string join read as a stranger: six cast stills were routed and
 * priced as plain ones, with no reference photograph.
 */
describe('nameMatches', () => {
  it('matches the exact name, ignoring case and runs of whitespace', () => {
    expect(nameMatches('Emad Mostaque', 'Emad Mostaque')).toBe(true)
    expect(nameMatches('  emad   mostaque ', 'Emad Mostaque')).toBe(true)
  })

  it('matches the name followed by a role, however it is punctuated', () => {
    expect(
      nameMatches('Emad Mostaque, founder and former CEO of Stability AI', 'Emad Mostaque'),
    ).toBe(true)
    expect(nameMatches('Sean Parker, investor', 'Sean Parker')).toBe(true)
    expect(nameMatches('Prem Akkaraju (CEO of Stability AI)', 'Prem Akkaraju')).toBe(true)
    expect(nameMatches('Prem Akkaraju - CEO', 'Prem Akkaraju')).toBe(true)
    expect(nameMatches('Prem Akkaraju: CEO', 'Prem Akkaraju')).toBe(true)
  })

  it('does not match a name that merely appears inside a longer entry', () => {
    expect(nameMatches('an aide to Emad Mostaque', 'Emad Mostaque')).toBe(false)
    expect(nameMatches("Emad Mostaque's assistant", 'Emad Mostaque')).toBe(false)
    expect(nameMatches('Emad Mostaque Junior', 'Emad Mostaque')).toBe(false)
    expect(nameMatches('Emad Mostaquevich', 'Emad Mostaque')).toBe(false)
    expect(nameMatches('Emad', 'Emad Mostaque')).toBe(false)
    expect(nameMatches('', 'Emad Mostaque')).toBe(false)
  })
})

describe('depictedMembers', () => {
  const prem = { ...member, id: 'c2', name: 'Prem Akkaraju' }
  const sean = { ...member, id: 'c3', name: 'Sean Parker' }

  it('returns the members some entry names, in cast order, once each', () => {
    expect(
      depictedMembers(
        ['Sean Parker, investor', 'Emad Mostaque', 'emad mostaque, founder'],
        [member, prem, sean],
      ),
    ).toEqual([member, sean])
  })

  it('returns nothing for no list, an empty list or strangers', () => {
    expect(depictedMembers(undefined, [member])).toEqual([])
    expect(depictedMembers([], [member])).toEqual([])
    expect(depictedMembers(['Nobody Known', '  '], [member])).toEqual([])
  })
})
