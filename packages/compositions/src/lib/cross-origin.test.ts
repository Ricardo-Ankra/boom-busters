import { describe, expect, it, vi } from 'vitest'
import { mediaCrossOrigin } from './cross-origin'

const environment = vi.hoisted(() => ({ isPlayer: false, isRendering: true }))
vi.mock('remotion', () => ({
  getRemotionEnvironment: () => environment,
}))

describe('mediaCrossOrigin', () => {
  it('is anonymous in the player, so tags and fetch() share CORS-approved cache entries', () => {
    environment.isPlayer = true
    environment.isRendering = false
    expect(mediaCrossOrigin()).toBe('anonymous')
  })

  it('stays undefined offline — the renderer has no page origin the bucket policy lists', () => {
    environment.isPlayer = false
    environment.isRendering = true
    expect(mediaCrossOrigin()).toBeUndefined()
  })
})
