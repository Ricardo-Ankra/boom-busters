import type { Settings } from '@boom-busters/schemas'
import type { Route } from 'next'

/**
 * The first-run setup checklist (build spec section 11.3), reduced to items a
 * human can actually act on.
 *
 * §11.3 sketches this as a page that *replaces* the dashboard until all five
 * items are done. Built that way, it locked the dashboard forever: YouTube
 * connects in M7 and music beds upload in M6, so two items could never be
 * ticked and the Needs-you queue — the whole point of the dashboard — was
 * unreachable in the running product. By decision (2026-08-16) the checklist
 * is a strip *above* the queue instead, and an item whose milestone has not
 * arrived is listed as coming rather than counted as undone.
 *
 * The Brand Kit item is gone entirely: its done-predicate (three chart
 * colours) was satisfied by the schema's own `min(3)`, so it ticked itself on
 * a fresh install and was permanent green noise. It returns in M6 when the
 * specimen panel exists and "configured" can mean something.
 *
 * Pure so it can be unit-tested without a database.
 */

export interface ChecklistItem {
  id: 'youtube' | 'voice' | 'music' | 'cases'
  label: string
  detail: string
  /** Typed against the app's real routes, so a rename breaks the build. */
  href: Route
  buttonLabel: string
  done: boolean
  /** Whether leaving this undone stops a project from starting. */
  blocksPipeline: boolean
  /** Set when the item cannot be completed in the current milestone. */
  availableFrom?: string
}

export interface FirstRunInput {
  settings: Settings
  youtubeConnected: boolean
  musicBedCount: number
  caseCount: number
}

export function buildChecklist(input: FirstRunInput): ChecklistItem[] {
  const { settings, youtubeConnected, musicBedCount, caseCount } = input

  return [
    {
      id: 'voice',
      label: 'Choose narration voice',
      detail:
        settings.tts.voiceId.trim() === ''
          ? 'The voice is a brand asset: chosen once, by audition.'
          : `${settings.tts.provider} · ${settings.tts.voiceId}`,
      href: '/settings?tab=voice',
      buttonLabel: settings.tts.voiceId.trim() === '' ? 'Open audition' : 'Review voice',
      done: settings.tts.voiceId.trim() !== '',
      blocksPipeline: true,
    },
    {
      id: 'cases',
      label: 'Add your first cases',
      detail:
        caseCount === 0
          ? 'The backlog the pipeline draws from.'
          : `${caseCount} case${caseCount === 1 ? '' : 's'} in the library.`,
      href: '/cases',
      buttonLabel: caseCount === 0 ? 'Add cases' : 'Open Case Library',
      done: caseCount > 0,
      blocksPipeline: false,
    },
    {
      id: 'music',
      label: 'Add at least 3 music beds',
      detail:
        musicBedCount === 0
          ? 'Download licensed beds (the YouTube Audio Library is free) and upload them.'
          : `${musicBedCount} of 3 uploaded.`,
      href: '/settings?tab=music',
      buttonLabel: 'Open music library',
      done: musicBedCount >= 3,
      // Assembly is what needs beds; nothing before it does. The library
      // arrived with M6.4, so the item is actionable now — but a missing bed
      // still only bites at the preview screen's music picker.
      blocksPipeline: false,
    },
    {
      id: 'youtube',
      label: 'Connect YouTube',
      detail: youtubeConnected
        ? 'Connected.'
        : 'Needed only to publish. Everything up to the publish gate works without it.',
      href: '/settings?tab=connections',
      buttonLabel: youtubeConnected ? 'Manage connection' : 'Connect',
      done: youtubeConnected,
      blocksPipeline: false,
      ...(youtubeConnected ? {} : { availableFrom: 'M7' }),
    },
  ]
}

export function isSetupComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.done)
}

/**
 * Items that must be done before any project can start — and that *can* be
 * done: an item whose milestone has not arrived is coming, not blocking, or
 * the dashboard would be gated on work the user cannot perform.
 */
export function pipelineBlockers(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => item.blocksPipeline && !item.done && !item.availableFrom)
}

/** Undone items the user can act on today — the setup strip's button rows. */
export function actionableSetup(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => !item.done && !item.availableFrom)
}

/** Undone items whose milestone has not arrived — one muted line, no buttons. */
export function upcomingSetup(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => !item.done && item.availableFrom !== undefined)
}
