import { DEFAULT_SETTINGS, type Settings } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import {
  actionableSetup,
  buildChecklist,
  isSetupComplete,
  pipelineBlockers,
  upcomingSetup,
} from './first-run'

function settingsWith(overrides: (settings: Settings) => void): Settings {
  const settings = structuredClone(DEFAULT_SETTINGS)
  overrides(settings)
  return settings
}

const freshInstall = {
  settings: DEFAULT_SETTINGS,
  youtubeConnected: false,
  musicBedCount: 0,
  caseCount: 0,
}

describe('buildChecklist', () => {
  it('lists the setup items a human can act on, actionable first', () => {
    // Brand Kit is gone: its done-predicate (three chart colours) was
    // satisfied by the schema's own min(3), so it ticked itself on a fresh
    // install and was permanent green noise.
    expect(buildChecklist(freshInstall).map((item) => item.id)).toEqual([
      'voice',
      'cases',
      'music',
      'youtube',
    ])
  })

  it('marks a fresh install as incomplete', () => {
    expect(isSetupComplete(buildChecklist(freshInstall))).toBe(false)
  })

  /**
   * Only the voice blocks. Music beds are needed by assembly (M6) and nothing
   * before it — an item that cannot be completed yet must not claim to block
   * the pipeline, or the dashboard is gated on work the user cannot perform.
   */
  it('blocks the pipeline only on what a run before M6 actually needs', () => {
    const blockers = pipelineBlockers(buildChecklist(freshInstall)).map((item) => item.id)
    expect(blockers).toEqual(['voice'])
  })

  it('does not block the pipeline on YouTube — publishing is the last step', () => {
    const youtube = buildChecklist(freshInstall).find((item) => item.id === 'youtube')
    expect(youtube?.blocksPipeline).toBe(false)
  })

  it('splits the undone items into actionable-today and coming-later', () => {
    const items = buildChecklist(freshInstall)
    expect(actionableSetup(items).map((item) => item.id)).toEqual(['voice', 'cases'])
    expect(upcomingSetup(items).map((item) => item.id)).toEqual(['music', 'youtube'])
  })

  it('counts the voice as done once a voice id is chosen', () => {
    const items = buildChecklist({
      ...freshInstall,
      settings: settingsWith((s) => {
        s.tts.voiceId = 'v-narrator'
      }),
    })
    const voice = items.find((item) => item.id === 'voice')

    expect(voice?.done).toBe(true)
    expect(voice?.detail).toContain('v-narrator')
  })

  it('names the provider alongside the voice', () => {
    const items = buildChecklist({
      ...freshInstall,
      settings: settingsWith((s) => {
        s.tts.voiceId = 'v-narrator'
      }),
    })
    expect(items.find((item) => item.id === 'voice')?.detail).toContain('elevenlabs')
  })

  it('requires three music beds, not one', () => {
    for (const [count, done] of [
      [0, false],
      [1, false],
      [2, false],
      [3, true],
      [9, true],
    ] as const) {
      const items = buildChecklist({ ...freshInstall, musicBedCount: count })
      expect(items.find((item) => item.id === 'music')?.done, `${count} beds`).toBe(done)
    }
  })

  it('reports progress towards the three beds', () => {
    const items = buildChecklist({ ...freshInstall, musicBedCount: 2 })
    expect(items.find((item) => item.id === 'music')?.detail).toBe('2 of 3 uploaded.')
  })

  it('completes once every item is satisfied', () => {
    const items = buildChecklist({
      settings: settingsWith((s) => {
        s.tts.voiceId = 'v-narrator'
      }),
      youtubeConnected: true,
      musicBedCount: 3,
      caseCount: 1,
    })

    expect(isSetupComplete(items)).toBe(true)
    expect(pipelineBlockers(items)).toEqual([])
    expect(actionableSetup(items)).toEqual([])
    expect(upcomingSetup(items)).toEqual([])
  })

  it('says which milestone an unavailable item arrives in — and only unavailable ones', () => {
    const items = buildChecklist(freshInstall)
    // Voice shipped in M4: it is actionable now and must not carry a marker.
    expect(items.find((item) => item.id === 'voice')?.availableFrom).toBeUndefined()
    expect(items.find((item) => item.id === 'music')?.availableFrom).toBe('M6')
    expect(items.find((item) => item.id === 'youtube')?.availableFrom).toBe('M7')
  })

  it('drops the milestone note once an item is done', () => {
    const items = buildChecklist({ ...freshInstall, musicBedCount: 3 })
    const music = items.find((item) => item.id === 'music')
    expect(music?.done).toBe(true)
    expect(music?.availableFrom).toBeUndefined()
  })

  it('gives every item a deep link and a button label', () => {
    for (const item of buildChecklist(freshInstall)) {
      expect(item.href, item.id).toMatch(/^\//)
      expect(item.buttonLabel.length, item.id).toBeGreaterThan(0)
    }
  })
})
