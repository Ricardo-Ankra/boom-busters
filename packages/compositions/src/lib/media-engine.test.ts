import { describe, expect, it, vi } from 'vitest'
import { mediaEngine } from './media-engine'

const environment = vi.hoisted(() => ({ isPlayer: false, isRendering: true }))
vi.mock('remotion', () => ({
  getRemotionEnvironment: () => environment,
}))

describe('mediaEngine', () => {
  it('keeps the golden-pinned core tags for the offline render', () => {
    environment.isRendering = true
    environment.isPlayer = false
    expect(mediaEngine()).toBe('core-tags')
  })

  it('gives the player WebCodecs — no shared-tag swaps, no corrective seeks', () => {
    environment.isRendering = false
    environment.isPlayer = true
    expect(mediaEngine()).toBe('webcodecs')
  })
})
