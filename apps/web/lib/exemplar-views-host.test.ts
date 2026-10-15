// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type * as Compile from '@/lib/graphic-code/compile'

/** A host where the compiler cannot run: every compile throws, as a missing esbuild binary does. */
const host = vi.hoisted(() => ({ broken: true }))
vi.mock('@/lib/graphic-code/compile', async (importOriginal) => {
  const original = await importOriginal<typeof Compile>()
  return {
    ...original,
    compileGraphicSource: (source: string) => {
      if (host.broken) throw new Error('The package "@esbuild/linux-x64" could not be found')
      return original.compileGraphicSource(source)
    },
  }
})

import { DESIGNS } from '@boom-busters/providers'
import { exemplarViews } from './exemplar-views'

describe('exemplarViews on a host whose compiler cannot run (decision 305)', () => {
  it('says so on every stored design instead of throwing, and does not keep that build', () => {
    const failed = exemplarViews()
    const stored = failed.filter((view) => DESIGNS[view.technique] !== undefined)
    expect(stored.length).toBe(Object.keys(DESIGNS).length)
    for (const view of stored) {
      expect(view.code).toBeUndefined()
      expect(view.title).toBe(DESIGNS[view.technique]!.title)
      expect(view.issue).toBe(
        'the compiler could not run on this host: The package "@esbuild/linux-x64" could not be found',
      )
    }
    // Not cached: the next call builds again.
    expect(exemplarViews()).not.toBe(failed)

    host.broken = false
    const whole = exemplarViews()
    expect(whole.filter((view) => view.code !== undefined)).toHaveLength(stored.length)
    expect(whole.every((view) => view.issue === undefined)).toBe(true)
    // A whole build is kept.
    expect(exemplarViews()).toBe(whole)
  })
})
