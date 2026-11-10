import type { GroundedResearch } from '@boom-busters/schemas'
import { describe, expect, it } from 'vitest'
import { mockScenes } from './dossier-mocks'
import { renderDossierMarkdown } from './dossier-render'
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
      '- **2020** — Resigned (A Person). *The end.* ([source](https://en.wikipedia.org/wiki/Foo_(bar)?t=9)) (unplaced)',
      '',
      '## Open questions',
      '',
      '- Why?',
    ].join('\n')
    const lines = sceneLines({ research: null, contentMd })
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe('2019 — Promised growth (A Person). The high point. (unplaced)')
    expect(lines[2]).toBe('2020 — Resigned (A Person). The end. (unplaced)')
    for (const line of lines) {
      expect(line).not.toContain('**')
      expect(line).not.toContain('wikipedia')
      expect(line).not.toContain('[source]')
    }
    expect(lines[0]).toBe('June 2018 — Declined to sign (Two auditors). The first sign.')
  })

  it('marks a scene whose quote was not found, in the research branch', () => {
    const scenes = mockScenes()
    const research = researchWith(scenes)
    research.scenes[1]!.ref.found = false
    const lines = sceneLines({ research, contentMd: '# T' })
    expect(lines[0]).not.toContain('(unplaced)')
    expect(lines[1]!.endsWith(' (unplaced)')).toBe(true)
  })

  it('reads the dossier markdown the same as the stored research, markers included', () => {
    const research = {
      ...researchWith(mockScenes()),
      brief: {
        currentStatus: null,
        summary: 'A summary.',
        turningPoint: 'The turn.',
        cast: [],
        toldAlready: [],
        openQuestions: [],
      },
      answers: [],
    } as unknown as GroundedResearch
    research.scenes[1]!.ref.found = false
    const contentMd = renderDossierMarkdown({ caseTitle: 'T', research, claims: [] })
    expect(sceneLines({ research: null, contentMd })).toEqual(
      sceneLines({ research, contentMd: '# T' }),
    )
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
