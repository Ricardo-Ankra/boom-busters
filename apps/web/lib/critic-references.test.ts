// @vitest-environment node

import type { MotionReferenceRow } from '@boom-busters/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CRITIC_REFERENCES_MAX, criticReferencesFor } from './critic-references'

/**
 * What the critic is shown of the channel (spec 2026-11-04, section 10.4):
 * the first two live references tagged look, a clip by its dense sheet and a
 * still by its original, each held to the model width; none when storage is
 * off, and a missing object skipped rather than thrown.
 */

const listMotionReferences = vi.fn()
vi.mock('@boom-busters/db', () => ({
  listMotionReferences: (...args: unknown[]) => listMotionReferences(...args),
}))
vi.mock('@/lib/db', () => ({ db: {} }))

const getObjectBytes = vi.fn()
let storage = true
vi.mock('@/lib/storage', () => ({
  getObjectBytes: (...args: unknown[]) => getObjectBytes(...args),
  storageConfigured: () => storage,
}))
vi.mock('@/lib/reference-images', () => ({
  imageForModel: async (object: { bytes: Uint8Array; contentType: string }) => ({
    mimeType: 'image/jpeg',
    data: Buffer.from(object.bytes).toString('base64'),
  }),
}))

const row = (over: Partial<MotionReferenceRow>): MotionReferenceRow =>
  ({
    id: 'r',
    title: 'Untitled',
    purpose: 'look',
    kind: 'video',
    carryOver: '',
    denseSheetKey: null,
    frames: {
      dense: [{ atMs: 0, r2Key: 'frames/first.jpg', width: 640, height: 360 }],
      overview: [],
    },
    archivedAt: null,
    ...over,
  }) as unknown as MotionReferenceRow

const object = (key: string) => ({
  bytes: new TextEncoder().encode(key),
  contentType: 'image/jpeg',
})

beforeEach(() => {
  storage = true
  listMotionReferences.mockReset()
  getObjectBytes.mockReset()
  getObjectBytes.mockImplementation(async (key: string) => object(key))
})

describe('criticReferencesFor', () => {
  it('hands the critic the first two look references in order, a still by its original', async () => {
    listMotionReferences.mockResolvedValue([
      row({
        id: 'a',
        purpose: 'mechanism',
        title: 'A drum',
        denseSheetKey: 'sheets/a/dense-sheet.jpg',
      }),
      row({
        id: 'b',
        kind: 'image',
        title: 'Board still',
        carryOver: 'heavy type on dark',
        frames: {
          dense: [{ atMs: 0, r2Key: 'references/b.png', width: 1200, height: 800 }],
          overview: [],
        },
      }),
      row({
        id: 'c',
        title: 'Kaye reel',
        carryOver: 'one actor',
        denseSheetKey: 'sheets/c/dense-sheet.jpg',
      }),
      row({ id: 'd', title: 'A third look', denseSheetKey: 'sheets/d/dense-sheet.jpg' }),
    ])
    const references = await criticReferencesFor('01J00000000000000000000CH1')
    expect(CRITIC_REFERENCES_MAX).toBe(2)
    expect(listMotionReferences).toHaveBeenCalledWith({}, '01J00000000000000000000CH1')
    expect(references.map((r) => [r.title, r.purpose, r.carryOver])).toEqual([
      ['Board still', 'look', 'heavy type on dark'],
      ['Kaye reel', 'look', 'one actor'],
    ])
    expect(getObjectBytes.mock.calls.map((call) => call[0])).toEqual([
      'references/b.png',
      'sheets/c/dense-sheet.jpg',
    ])
    expect(Buffer.from(references[0]!.image.data, 'base64').toString()).toBe('references/b.png')
  })

  it('skips a clip that has no sheet yet', async () => {
    listMotionReferences.mockResolvedValue([
      row({ id: 'a', title: 'Unread clip', denseSheetKey: null }),
      row({ id: 'b', title: 'Read clip', denseSheetKey: 'sheets/b/dense-sheet.jpg' }),
    ])
    const references = await criticReferencesFor('ch')
    expect(references.map((r) => r.title)).toEqual(['Read clip'])
  })

  it('gives no references when storage is off or an object is missing', async () => {
    storage = false
    listMotionReferences.mockResolvedValue([
      row({ id: 'a', denseSheetKey: 'sheets/a/dense-sheet.jpg' }),
    ])
    expect(await criticReferencesFor('ch')).toEqual([])
    expect(listMotionReferences).not.toHaveBeenCalled()

    storage = true
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    listMotionReferences.mockResolvedValue([
      row({ id: 'a', title: 'Gone', denseSheetKey: 'sheets/a/dense-sheet.jpg' }),
      row({ id: 'b', title: 'Here', denseSheetKey: 'sheets/b/dense-sheet.jpg' }),
    ])
    getObjectBytes.mockImplementation(async (key: string) => {
      if (key.includes('/a/')) throw new Error('NoSuchKey')
      return object(key)
    })
    const references = await criticReferencesFor('ch')
    expect(references.map((r) => r.title)).toEqual(['Here'])
    expect(warned).toHaveBeenCalledTimes(1)
    expect(String(warned.mock.calls[0]![0])).toMatch(/Gone/)
    warned.mockRestore()
  })

  it('hands the critic the references the plan named first, then look references, two in all', async () => {
    listMotionReferences.mockResolvedValue([
      row({ id: 'a', title: 'First look', denseSheetKey: 'sheets/a/dense-sheet.jpg' }),
      row({ id: 'b', title: 'Second look', denseSheetKey: 'sheets/b/dense-sheet.jpg' }),
      row({
        id: 'c',
        purpose: 'mechanism',
        title: 'The drum',
        denseSheetKey: 'sheets/c/dense-sheet.jpg',
      }),
    ])
    const named = await criticReferencesFor('ch', ['The drum', 'Not in the pack'])
    expect(named.map((reference) => reference.title)).toEqual(['The drum', 'First look'])
    const none = await criticReferencesFor('ch', [])
    expect(none.map((reference) => reference.title)).toEqual(['First look', 'Second look'])
  })
})
