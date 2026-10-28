import type { SlotCandidate } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { addRegenerated } from './still-candidates'

const image = (id: string, extra: Partial<SlotCandidate> = {}): SlotCandidate => ({
  id,
  provider: 'google',
  kind: 'image',
  sourceUrl: `generated://google/${id}`,
  assetId: `asset-${id}`,
  licence: 'Generated (Gemini 3.1 Flash Image)',
  ...extra,
})

describe('addRegenerated (decision 324)', () => {
  it('keeps the pick and puts the new image beside it, ahead of the older ones', () => {
    const result = addRegenerated({
      existing: [image('old-1', { chosen: true }), image('old-2')],
      existingChosenAssetId: 'asset-old-1',
      // resolveSlotBrief marks its first image chosen; the pick must not move.
      fresh: [image('new-1', { chosen: true })],
    })
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['new-1', 'old-1', 'old-2'])
    expect(result.candidates.filter((candidate) => candidate.chosen).map((c) => c.id)).toEqual([
      'old-1',
    ])
    expect(result.chosenAssetId).toBe('asset-old-1')
  })

  it("keeps the slot's chosen asset when the owner picked an upload", () => {
    const result = addRegenerated({
      existing: [image('upload', { chosen: true, assetId: 'asset-upload' })],
      existingChosenAssetId: 'asset-upload',
      fresh: [image('new-1')],
    })
    expect(result.chosenAssetId).toBe('asset-upload')
  })

  it('makes the first new image the default only when nothing was picked', () => {
    const result = addRegenerated({
      existing: [image('old-1')],
      existingChosenAssetId: null,
      fresh: [image('new-1'), image('new-2')],
    })
    expect(result.candidates.map((candidate) => [candidate.id, candidate.chosen ?? false])).toEqual(
      [
        ['new-1', true],
        ['new-2', false],
        ['old-1', false],
      ],
    )
    expect(result.chosenAssetId).toBe('asset-new-1')
  })

  it('never lists an image the slot already holds twice', () => {
    const result = addRegenerated({
      existing: [image('same', { chosen: true })],
      existingChosenAssetId: 'asset-same',
      fresh: [image('same', { chosen: true })],
    })
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['same'])
  })
})
