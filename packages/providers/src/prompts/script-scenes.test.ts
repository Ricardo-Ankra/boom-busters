import type { GroundedResearch } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockScenes } from './dossier-mocks'
import { sceneLines, sceneList } from './script-scenes'

const researchWith = (scenes: ReturnType<typeof mockScenes>): GroundedResearch =>
  ({
    scenes: scenes.map(({ when, who, what, why }) => ({
      when,
      who,
      what,
      why,
      ref: {
        documentId: 'd1',
        url: 'https://example.test/a',
        found: true,
        locatorSeconds: null,
        quote: null,
      },
    })),
  }) as unknown as GroundedResearch

describe('sceneLines', () => {
  it('renders the stored scenes when the research carries them', () => {
    const scenes = mockScenes()
    const lines = sceneLines({ research: researchWith(scenes), contentMd: '# T' })
    expect(lines).toHaveLength(2)
    expect(lines[0]!.startsWith(scenes[0]!.when)).toBe(true)
    expect(lines[0]).toBe(
      'Mock June 2018 — Declined to sign the mock accounts (Two mock auditors). The first mock sign that the mock ledger did not add up.',
    )
  })

  it('falls back to the Timeline section of the markdown', () => {
    const contentMd = [
      '# T',
      '',
      '## Timeline',
      '',
      '- **June 2018** — Declined to sign (Two auditors). *The first sign.* ([source](https://example.test/a?t=5))',
      '- **2019** — Promised growth (A Person). *The high point.* (unplaced)',
      '',
      '## Open questions',
      '',
      '- Why?',
    ].join('\n')
    const lines = sceneLines({ research: null, contentMd })
    expect(lines).toHaveLength(2)
    for (const line of lines) {
      expect(line).not.toContain('**')
      expect(line).not.toContain('[source]')
      expect(line).not.toContain('(unplaced)')
    }
    expect(lines[0]).toBe('June 2018 — Declined to sign (Two auditors). The first sign.')
  })

  it('is empty with neither, and the list says so', () => {
    expect(sceneLines({ research: null, contentMd: '# T' })).toEqual([])
    expect(sceneList([])).toBe('No scenes.')
  })
})

describe('sceneList', () => {
  it('numbers scenes with an S', () => {
    expect(sceneList(['a', 'b'])).toBe('[S1] a\n[S2] b')
  })
})
