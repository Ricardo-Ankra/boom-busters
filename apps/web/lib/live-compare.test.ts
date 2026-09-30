import { describe, expect, it } from 'vitest'
import { compareHtml, FAULTS } from './live-compare'

const run = (label: string, prompt: string) => ({
  label,
  project: 'P1',
  chapter: 5,
  createdAt: '2026-09-29T00:00:00Z',
  plannerModel: 'gemini-pro-latest',
  skipped: 0,
  budget: { capUsd: 1, totalUsd: 0.5 },
  stills: [{ index: 0, coversText: 'The board <met>.', file: 'still-0.png', prompt }],
})

describe('compareHtml', () => {
  it('shows both runs side by side with every fault to tick', () => {
    const html = compareHtml(run('before', 'a'), run('after', 'b'), 'runs/before', 'runs/after')
    expect(html).toContain('<title>Before and after</title>')
    for (const fault of FAULTS) expect(html).toContain(fault)
    expect(html).toContain('src="../before/still-0.png"')
    expect(html).toContain('src="still-0.png"')
  })

  it('escapes the sentence and the prompt', () => {
    const html = compareHtml(
      run('before', '<script>'),
      run('after', 'b'),
      'runs/before',
      'runs/after',
    )
    expect(html).toContain('The board &lt;met&gt;.')
    expect(html).toContain('<pre>&lt;script&gt;</pre>')
  })

  it('says why a still has no image', () => {
    const failed = run('after', 'b')
    failed.stills[0] = { index: 0, coversText: 'x', prompt: 'b', error: 'refused' } as never
    expect(compareHtml(run('before', 'a'), failed, 'runs/before', 'runs/after')).toContain(
      'refused',
    )
  })
})
