import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REMOTION_RULE_EXCERPTS, REMOTION_RULES } from './remotion-rules'

/**
 * The excerpts are copies of Remotion's vendored agent rules
 * (`.agents/skills/remotion-markup/`, pinned in `skills-lock.json`). Every
 * line marked vendored must still be in its file, trailing spaces aside, so
 * an `npx skills` upgrade that changes the advice fails here rather than
 * drifting the prompt; the house lines are the sandbox's own.
 */
const VENDORED = new URL('../../../../.agents/skills/remotion-markup/', import.meta.url)

function vendoredLines(file: string): Set<string> {
  const text = readFileSync(new URL(file, VENDORED), 'utf8')
  return new Set(text.split('\n').map((line) => line.trimEnd()))
}

describe("Remotion's rules in the prompt (decision 301)", () => {
  it('excerpts timing.md and sequencing.md, and nothing else', () => {
    expect(REMOTION_RULE_EXCERPTS.map((excerpt) => excerpt.file)).toEqual([
      'timing.md',
      'sequencing.md',
    ])
  })

  it.each(REMOTION_RULE_EXCERPTS)(
    'pins every vendored line of $file to the vendored file',
    (excerpt) => {
      const lines = vendoredLines(excerpt.file)
      for (const line of excerpt.lines) {
        if (line.house) continue
        expect(lines.has(line.text.trimEnd()), `vendored line missing: ${line.text}`).toBe(true)
      }
    },
  )

  it('has at least as many vendored lines as house lines in each excerpt', () => {
    for (const excerpt of REMOTION_RULE_EXCERPTS) {
      const house = excerpt.lines.filter((line) => line.house).length
      expect(excerpt.lines.length - house).toBeGreaterThanOrEqual(house)
    }
  })

  it("still has the advice the house replaced to replace: Remotion's Easing.spring and its keyframe easings", () => {
    const timing = readFileSync(new URL('timing.md', VENDORED), 'utf8')
    expect(timing).toContain('easing: Easing.spring({damping: 200}),')
    expect(timing).toContain(
      'easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.spring({damping: 200})],',
    )
  })

  it('renders each excerpt under its file name, in order', () => {
    expect(REMOTION_RULES.indexOf('timing.md')).toBeGreaterThan(0)
    expect(REMOTION_RULES.indexOf('sequencing.md')).toBeGreaterThan(
      REMOTION_RULES.indexOf('timing.md'),
    )
    for (const excerpt of REMOTION_RULE_EXCERPTS) {
      for (const line of excerpt.lines) expect(REMOTION_RULES).toContain(line.text)
    }
  })

  it('mentions no package but remotion, no Easing member, no import, and no dash a reader would see', () => {
    expect(REMOTION_RULES).not.toMatch(/@remotion\//)
    expect(REMOTION_RULES).not.toMatch(/\bimport\b|\bfrom ["']/)
    expect(REMOTION_RULES).not.toMatch(/\bEasing\s*\./)
    expect(REMOTION_RULES).not.toMatch(/\bSeries\b|premount|Interactive\./)
    expect(REMOTION_RULES).not.toMatch(/[–—]/)
  })
})
