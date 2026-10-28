// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirectToLandingChannel } from './legacy-redirect'

/** The old list addresses forward to the landing channel and keep their query. */

const nav = vi.hoisted(() => ({ redirect: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: nav.redirect }))

const context = vi.hoisted(() => ({ landingSlug: vi.fn() }))
vi.mock('./channel-context', () => ({ landingSlug: context.landingSlug }))

beforeEach(() => {
  vi.clearAllMocks()
  context.landingSlug.mockResolvedValue('psychology')
})

describe('redirectToLandingChannel', () => {
  it('sends / to the channel dashboard', async () => {
    await redirectToLandingChannel('', Promise.resolve({}))
    expect(nav.redirect).toHaveBeenCalledWith('/c/psychology')
  })

  it.each(['/projects', '/cases', '/calendar', '/costs', '/settings'] as const)(
    'sends %s to the same section of the channel',
    async (section) => {
      await redirectToLandingChannel(section, Promise.resolve({}))
      expect(nav.redirect).toHaveBeenCalledWith(`/c/psychology${section}`)
    },
  )

  it('keeps the query string, taking the first of a repeated parameter', async () => {
    await redirectToLandingChannel(
      '/settings',
      Promise.resolve({ tab: 'voice', sort: ['newest', 'status'], gone: undefined }),
    )
    expect(nav.redirect).toHaveBeenCalledWith('/c/psychology/settings?tab=voice&sort=newest')
  })

  it('uses the slug landingSlug names (the cookie or the default channel)', async () => {
    context.landingSlug.mockResolvedValue('boom-busters')
    await redirectToLandingChannel('/cases', Promise.resolve({ sort: 'priority' }))
    expect(nav.redirect).toHaveBeenCalledWith('/c/boom-busters/cases?sort=priority')
  })
})
