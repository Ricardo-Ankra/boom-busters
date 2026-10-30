import { readFileSync } from 'node:fs'
import { EMPTY_BIBLE, FIRST_CHANNEL_BIBLE, PREVIEW_STAGES } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { LIFT_CASES } from './lift/lift-cases'
import { PREVIEW_CASE, composeStagePrompt } from './preview'

describe('the stage prompt preview', () => {
  it('names a lift case that exists for every stage', () => {
    const names = new Set(LIFT_CASES.map((c) => c.name))
    for (const stage of PREVIEW_STAGES) expect(names.has(PREVIEW_CASE[stage])).toBe(true)
  })

  it.each(PREVIEW_STAGES)(
    "composes the first channel's %s prompt byte for byte as the case captured it",
    (stage) => {
      const fixture = JSON.parse(
        readFileSync(
          new URL(`./lift/__fixtures__/${PREVIEW_CASE[stage]}.json`, import.meta.url),
          'utf8',
        ),
      ) as { system: string }
      expect(composeStagePrompt(stage, FIRST_CHANNEL_BIBLE, 'Boom & Busters')).toBe(fixture.system)
    },
  )

  it('previews an empty bible with a placeholder for each missing example', () => {
    const text = composeStagePrompt('script', EMPTY_BIBLE, 'Test Channel')
    expect(text).toContain('[example needed: script-')
  })

  it('does not throw for an empty bible at any stage', () => {
    for (const stage of PREVIEW_STAGES) {
      expect(() => composeStagePrompt(stage, EMPTY_BIBLE, 'Test Channel')).not.toThrow()
    }
  })

  it('names the real channel in the metadata preview, never an imagined one', () => {
    const text = composeStagePrompt('metadata', EMPTY_BIBLE, 'Test Channel')
    expect(text).toContain('Test Channel')
    expect(text).not.toContain('Mind Matters')
  })
})
