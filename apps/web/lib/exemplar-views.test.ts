// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MOTION_PREAMBLE } from '@boom-busters/compositions/motion-tokens'
import { DESIGNS, MANIFEST } from '@boom-busters/providers'
import { exemplarViews } from './exemplar-views'

describe('exemplarViews (decision 305)', () => {
  const views = exemplarViews()

  it('gives one view per manifest entry, in the manifest order', () => {
    expect(views.map((view) => view.technique)).toEqual(MANIFEST.map((entry) => entry.technique))
  })

  it('compiles every stored design under the motion preamble, with its own narration', () => {
    const stored = views.filter((view) => view.code !== undefined)
    expect(stored).toHaveLength(Object.keys(DESIGNS).length)
    for (const view of stored) {
      const entry = MANIFEST.find((candidate) => candidate.technique === view.technique)!
      const code = view.code!
      expect(code.compiled.startsWith(`${MOTION_PREAMBLE}\n`)).toBe(true)
      expect(code.compiled).toContain('function Graphic(')
      expect(code.source).toBe(DESIGNS[view.technique]!.source)
      expect(code.title).toBe(DESIGNS[view.technique]!.title)
      expect(code.motion).toBe(1)
      expect(code.words).toEqual(entry.slot.words)
      expect(code.durationMs).toBe(entry.slot.durationMs)
      expect(view.title).toBe(code.title)
      expect(view.issue).toBeUndefined()
    }
  })

  it('hands a chart its sample data, and nothing else any data', () => {
    for (const view of views) {
      const entry = MANIFEST.find((candidate) => candidate.technique === view.technique)!
      if (entry.chart) expect(view.data).toEqual(entry.slot.data)
      else expect(view.data).toBeUndefined()
    }
  })

  it('names each template, links it at its pinned commit, and states the licence', () => {
    const racing = views.find((view) => view.technique === 'racing-chart')!
    expect(racing.template).toEqual({
      name: 'RacingChart',
      repository: 'RenderComp/free-remotion-templates',
      url: 'https://github.com/RenderComp/free-remotion-templates/blob/f648980e528defb7594e24c6447055f0540f340b/src/components/racing-chart/RacingChart.tsx',
      licence: 'MIT',
    })
    const stat = views.find((view) => view.technique === 'stat-counter')!
    expect(stat.template.url).toBe(
      'https://github.com/reactvideoeditor/remotion-templates/blob/6209b724798e48ff395f8df1a6fa2d26082372b5/templates/stat-counter.tsx',
    )
    expect(stat.template.name).toBe('stat-counter')
  })

  it('builds once per server instance', () => {
    expect(exemplarViews()).toBe(views)
  })
})
