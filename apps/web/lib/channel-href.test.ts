import { describe, expect, it } from 'vitest'
import { channelHref, LAST_CHANNEL_COOKIE, slugFromPath } from './channel-href'

describe('channelHref', () => {
  it('builds a section path with its query string', () => {
    expect(channelHref('boom-busters', '/settings', { tab: 'voice' })).toBe(
      '/c/boom-busters/settings?tab=voice',
    )
  })

  it('defaults to the channel root with no query', () => {
    expect(channelHref('x')).toBe('/c/x')
    expect(channelHref('x', '/projects', {})).toBe('/c/x/projects')
  })
})

describe('slugFromPath', () => {
  it('reads the segment after /c/', () => {
    expect(slugFromPath('/c/psy/projects')).toBe('psy')
    expect(slugFromPath('/c/psy')).toBe('psy')
  })

  it('is null outside a channel', () => {
    expect(slugFromPath('/projects/01ABC')).toBeNull()
    expect(slugFromPath('/c/')).toBeNull()
    expect(slugFromPath('/')).toBeNull()
  })

  it('names the cookie', () => {
    expect(LAST_CHANNEL_COOKIE).toBe('bb-last-channel')
  })
})
