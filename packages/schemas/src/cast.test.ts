import { describe, expect, it } from 'vitest'
import {
  CastMemberSchema,
  CastPhotoSchema,
  castPhotoExtension,
  MAX_CAST_PHOTOS,
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
