import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOTION_GUIDELINE_FULL, MOTION_GUIDELINE_SHORT } from './motion-guideline'

describe('the motion guideline on the tab (spec 2026-11-04, section 6)', () => {
  it('keeps every heading of docs/motion-references.md, in order', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/motion-references.md'), 'utf8')
    const headings = [...doc.matchAll(/^## (.+)$/gm)].map((match) => match[1])
    expect(MOTION_GUIDELINE_FULL.map((section) => section.heading)).toEqual(headings)
    expect(MOTION_GUIDELINE_SHORT).toHaveLength(6)
    expect(MOTION_GUIDELINE_SHORT[0]).toMatch(/^Four to eight references/)
  })

  it('writes no dash a reader would see', () => {
    const text = [
      ...MOTION_GUIDELINE_SHORT,
      ...MOTION_GUIDELINE_FULL.flatMap((section) => [section.heading, ...section.lines]),
    ].join('\n')
    expect(text).not.toMatch(/[–—]/)
  })
})
