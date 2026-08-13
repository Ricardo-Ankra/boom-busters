import type { Settings } from '@boom-busters/schemas'
import type { Route } from 'next'

/**
 * The first-run setup checklist (build spec section 11.3). On first login
 * with empty settings the dashboard is replaced by this list; each item is a
 * button that deep-links, and each shows a done-state.
 *
 * Items 2-4 block the pipeline: no project can start until the narration
 * voice, Brand Kit and at least three music beds exist. The checklist says so
 * plainly rather than letting a run fail later for a missing bed.
 *
 * Pure so it can be unit-tested without a database.
 */

export interface ChecklistItem {
  id: 'youtube' | 'voice' | 'brand-kit' | 'music' | 'cases'
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
      ...(settings.tts.voiceId.trim() === '' ? { availableFrom: 'M4' } : {}),
    },
    {
      id: 'brand-kit',
      label: 'Set up Brand Kit',
      detail: 'Typography, colours, chart palette and music defaults. Timelines snapshot these.',
      href: '/settings?tab=brand-kit',
      buttonLabel: 'Edit Brand Kit',
      done: brandKitConfigured(settings),
      blocksPipeline: true,
    },
    {
      id: 'music',
      label: 'Add at least 3 music beds',
      detail:
        musicBedCount === 0
          ? 'Download cleared tracks from the YouTube Audio Library and upload them here.'
          : `${musicBedCount} of 3 uploaded.`,
      href: '/settings?tab=music',
      buttonLabel: 'Open music library',
      done: musicBedCount >= 3,
      blocksPipeline: true,
      ...(musicBedCount >= 3 ? {} : { availableFrom: 'M6' }),
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
      ...(caseCount > 0 ? {} : { availableFrom: 'M3' }),
    },
  ]
}

/**
 * The Brand Kit counts as configured once the human has moved it off the
 * shipped defaults in a way that matters to a render: a logo, or an edited
 * chart palette. Anything looser would tick itself on a fresh install.
 */
function brandKitConfigured(settings: Settings): boolean {
  const { look, colors } = settings.brandKit
  return look.logoR2Key !== null || colors.chartSeries.length >= 3
}

export function isSetupComplete(items: ChecklistItem[]): boolean {
  return items.every((item) => item.done)
}

/** Items that must be done before any project can start (section 11.3). */
export function pipelineBlockers(items: ChecklistItem[]): ChecklistItem[] {
  return items.filter((item) => item.blocksPipeline && !item.done)
}
