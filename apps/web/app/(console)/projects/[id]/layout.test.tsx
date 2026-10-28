// @vitest-environment node

import {
  createCase,
  createChannel,
  createProjectFromCase,
  ensureFirstChannel,
  requireTestDatabase,
} from '@boom-busters/db'
import { DEFAULT_SETTINGS, EMPTY_BIBLE, FIRST_CHANNEL_SLUG } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import ProjectLayout from './layout'

/**
 * Review Focus 1: a project's screens belong to the project's channel. The
 * last-channel cookie decides only where `/` lands, never what a project page
 * says it is part of.
 */

const jar = vi.hoisted(() => ({
  values: new Map<string, string>(),
  get(name: string) {
    const value = this.values.get(name)
    return value === undefined ? undefined : { name, value }
  },
}))
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve(jar) }))

// The shell is a client tree; this test cares which channel the layout hands it.
vi.mock('@/components/console-shell', () => ({
  ConsoleShell: (props: { channel: { name: string; slug: string } }) => props,
}))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('project layout', () => {
  const tag = Date.now().toString(36)
  let slug = ''
  let name = ''
  let projectId = ''

  beforeEach(async () => {
    await ensureFirstChannel(db)
    slug = `layout-${tag}-${Math.random().toString(36).slice(2, 6)}`
    name = `Channel ${slug}`
    const other = await createChannel(db, {
      name,
      handle: null,
      slug,
      settings: DEFAULT_SETTINGS,
      bible: EMPTY_BIBLE,
    })
    const kase = await createCase(db, {
      title: 'Layout case',
      category: 'collapse',
      channelId: other.id,
    })
    projectId = (await createProjectFromCase(db, { caseId: kase.id, title: 'Layout' })).id
  })

  it("shows the project's channel in the shell whatever the last-channel cookie says", async () => {
    jar.values.set('bb-last-channel', FIRST_CHANNEL_SLUG)

    const element = (await ProjectLayout({
      children: null,
      params: Promise.resolve({ id: projectId }),
    })) as { props: { channel: { name: string; slug: string } } }

    expect(element.props.channel).toMatchObject({ slug, name })
  })

  it('raises not-found for a project that does not exist', async () => {
    const error = await ProjectLayout({
      children: null,
      params: Promise.resolve({ id: '01BB0000000000000000000009' }),
    }).catch((e: unknown) => e)
    expect((error as { digest?: string }).digest).toMatch(
      /^NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    )
  })
})
