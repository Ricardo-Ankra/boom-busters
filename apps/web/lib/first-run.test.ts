import { DEFAULT_SETTINGS, type Settings } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { buildChecklist, isSetupComplete, pipelineBlockers } from './first-run'

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
  it('lists the five setup items from the spec, in order', () => {
    expect(buildChecklist(freshInstall).map((item) => item.id)).toEqual([
      'youtube',
      'voice',
      'brand-kit',
      'music',
      'cases',
    ])
  })

  it('marks a fresh install as incomplete', () => {
    expect(isSetupComplete(buildChecklist(freshInstall))).toBe(false)
  })

  it('names which items block the pipeline', () => {
    const blockers = pipelineBlockers(buildChecklist(freshInstall)).map((item) => item.id)
    expect(blockers).toEqual(['voice', 'music'])
  })

  it('does not block the pipeline on YouTube — publishing is the last step', () => {
    const youtube = buildChecklist(freshInstall).find((item) => item.id === 'youtube')
    expect(youtube?.blocksPipeline).toBe(false)
  })

  it('counts the voice as done once a voice id is chosen', () => {
    const items = buildChecklist({
      ...freshInstall,
      settings: settingsWith((s) => {
        s.tts.voiceId = 'Charon'
      }),
    })
    const voice = items.find((item) => item.id === 'voice')

    expect(voice?.done).toBe(true)
    expect(voice?.detail).toContain('Charon')
  })

  it('names the provider alongside the voice, so two Charons are told apart', () => {
    const items = buildChecklist({
      ...freshInstall,
      settings: settingsWith((s) => {
        s.tts.provider = 'elevenlabs'
        s.tts.voiceId = 'Charon'
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
        s.tts.voiceId = 'Charon'
      }),
      youtubeConnected: true,
      musicBedCount: 3,
      caseCount: 1,
    })

    expect(isSetupComplete(items)).toBe(true)
    expect(pipelineBlockers(items)).toEqual([])
  })

  it('says which milestone an unavailable item arrives in', () => {
    const items = buildChecklist(freshInstall)
    expect(items.find((item) => item.id === 'voice')?.availableFrom).toBe('M4')
    expect(items.find((item) => item.id === 'music')?.availableFrom).toBe('M6')
  })

  it('drops the milestone note once an item is done', () => {
    const items = buildChecklist({ ...freshInstall, caseCount: 4 })
    const cases = items.find((item) => item.id === 'cases')
    expect(cases?.done).toBe(true)
    expect(cases?.availableFrom).toBeUndefined()
  })

  it('gives every item a deep link and a button label', () => {
    for (const item of buildChecklist(freshInstall)) {
      expect(item.href, item.id).toMatch(/^\//)
      expect(item.buttonLabel.length, item.id).toBeGreaterThan(0)
    }
  })
})
