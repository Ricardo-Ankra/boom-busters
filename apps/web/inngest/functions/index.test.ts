import { describe, expect, it } from 'vitest'
import { functions } from './index'

/**
 * The singleton map (decision 233): which functions refuse to run twice at
 * once, and on what key. A duplicate trigger cancels the run it duplicates
 * rather than stacking beside it; stacked duplicates are how a double-fired
 * approve once started two script runs and re-opened a gate the human had
 * just closed.
 *
 * Every mode is `cancel` rather than `skip` (amended 2026-09-16). `skip`
 * silently drops the new trigger, and a lock left behind by a cancelled run
 * is never released, so the project can never run that function again: the
 * production visuals stage took five `gate/voice.approved` events with the
 * function matched, no run created, and nothing running to explain it.
 * `cancel` keeps the same guarantee — never two live runs for one key — and
 * makes a trigger always produce a run.
 *
 * This test is the drift guard. A new runner added without a deliberate
 * decision here fails the suite, because "no singleton" must be a choice, not
 * an omission.
 */
const SINGLETONS: Record<string, { key: string; mode: 'cancel' } | null> = {
  // Per project: one live run each. Their trigger events double as gate
  // resolutions, so duplicates are cheap to fire and expensive to run.
  'dossier-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'dossier-reviser': { key: 'event.data.projectId', mode: 'cancel' },
  'script-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'voice-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'visuals-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'assembly-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'draft-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'render-runner': { key: 'event.data.projectId', mode: 'cancel' },
  'shorts-runner': { key: 'event.data.projectId', mode: 'cancel' },

  // Finer keys: parallel work on different rows stays legal, only the same
  // row is protected from itself.
  'voice-retaker': { key: 'event.data.takeId', mode: 'cancel' },
  'slot-refetcher': { key: 'event.data.slotId', mode: 'cancel' },
  'slot-retyper': { key: 'event.data.slotId', mode: 'cancel' },
  'slot-rebriefer': { key: 'event.data.slotId', mode: 'cancel' },
  'slot-redirector': { key: 'event.data.slotId', mode: 'cancel' },
  'visuals-replanner': { key: 'event.data.projectId', mode: 'cancel' },
  'short-render-runner': { key: 'event.data.shortId', mode: 'cancel' },
  'teaser-rebuild-runner': { key: 'event.data.shortId', mode: 'cancel' },
  'publish-runner': { key: 'event.data.targetId', mode: 'cancel' },

  // Deliberately none:
  // - analytics-runner runs on a cron with no event data to key on; its
  //   `concurrency: [{ limit: 1 }]` queues the manual refresh instead.
  // - cancel-reconciler is idempotent, and losing a sweep to a duplicate
  //   could miss runs that started between the two cancels.
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

  /**
   * The regression that cost a production evening: `skip` drops the new
   * trigger, so a singleton left locked by a cancelled run wedges the key for
   * good. No singleton may go back to `skip`.
   */
  it('never skips a trigger: a stale lock must not be able to swallow a restart', () => {
    const modes = functions
      .map((fn) => (fn as unknown as { opts: { singleton?: { mode?: string } } }).opts.singleton)
      .filter((singleton): singleton is { mode?: string } => singleton != null)
      .map((singleton) => singleton.mode)
    expect(modes.length).toBeGreaterThan(0)
    expect([...new Set(modes)]).toEqual(['cancel'])
  })
})
