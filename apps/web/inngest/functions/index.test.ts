import { describe, expect, it } from 'vitest'
import { functions } from './index'

/**
 * The singleton map (decision 233): which functions refuse to run twice at
 * once, and on what key. A duplicate trigger event is skipped, never stacked;
 * stacked duplicates are how a double-fired approve once started two script
 * runs and re-opened a gate the human had just closed.
 *
 * This test is the drift guard. A new runner added without a deliberate
 * decision here fails the suite, because "no singleton" must be a choice, not
 * an omission.
 */
const SINGLETONS: Record<string, { key: string; mode: 'skip' } | null> = {
  // Per project: one live run each. Their trigger events double as gate
  // resolutions, so duplicates are cheap to fire and expensive to run.
  'dossier-runner': { key: 'event.data.projectId', mode: 'skip' },
  'dossier-reviser': { key: 'event.data.projectId', mode: 'skip' },
  'script-runner': { key: 'event.data.projectId', mode: 'skip' },
  'voice-runner': { key: 'event.data.projectId', mode: 'skip' },
  'visuals-runner': { key: 'event.data.projectId', mode: 'skip' },
  'assembly-runner': { key: 'event.data.projectId', mode: 'skip' },
  'draft-runner': { key: 'event.data.projectId', mode: 'skip' },
  'render-runner': { key: 'event.data.projectId', mode: 'skip' },
  'shorts-runner': { key: 'event.data.projectId', mode: 'skip' },

  // Finer keys: parallel work on different rows stays legal, only the same
  // row is protected from itself.
  'voice-retaker': { key: 'event.data.takeId', mode: 'skip' },
  'slot-refetcher': { key: 'event.data.slotId', mode: 'skip' },
  'slot-retyper': { key: 'event.data.slotId', mode: 'skip' },
  'short-render-runner': { key: 'event.data.shortId', mode: 'skip' },
  'teaser-rebuild-runner': { key: 'event.data.shortId', mode: 'skip' },
  'publish-runner': { key: 'event.data.targetId', mode: 'skip' },

  // Deliberately none:
  // - analytics-runner runs on a cron with no event data to key on; its
  //   `concurrency: [{ limit: 1 }]` queues the manual refresh instead.
  // - cancel-reconciler is idempotent, and a skipped second sweep could miss
  //   runs that started between the two cancels.
  // - cancellation-mirror is idempotent for the same reason, and every
  //   cancellation deserves its own pass.
  // - teaser-shot-fetcher works per beat, and two beats of the same Short
  //   fetching at once is a feature; the action refuses per-beat duplicates
  //   against the stored fetch state instead.
  'analytics-runner': null,
  'cancel-reconciler': null,
  'cancellation-mirror': null,
  'teaser-shot-fetcher': null,
}

describe('function singletons (decision 233)', () => {
  it('covers every registered function, and only registered functions', () => {
    const registered = functions.map((fn) => fn.id()).sort()
    expect(registered).toEqual(Object.keys(SINGLETONS).sort())
  })

  it.each(functions.map((fn) => [fn.id(), fn] as const))(
    '%s carries its decided singleton config',
    (id, fn) => {
      const opts = (fn as unknown as { opts: { singleton?: unknown } }).opts
      expect(opts.singleton ?? null).toEqual(SINGLETONS[id])
    },
  )
})
