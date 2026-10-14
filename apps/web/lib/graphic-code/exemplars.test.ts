// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGNS, MANIFEST, vendoredPath } from '@boom-busters/providers'
import { exemplarBrief, exemplarContext, staleDesign } from '@/lib/exemplar-translate'
import { graphicCodeIssue } from './check'

/**
 * The corpus gate (decision 305): every stored exemplar is a design the
 * checks pass, with its synthetic slot, in both frames; and every design was
 * written from the vendored template as it is now. With no designs stored
 * the gate passes over nothing, and says so.
 */
const EXEMPLARS = new URL('../../../../packages/providers/src/exemplars/', import.meta.url)
const stored = MANIFEST.filter((entry) => DESIGNS[entry.technique] !== undefined)

describe(`the exemplar corpus (decision 305): ${stored.length} of ${MANIFEST.length} designs stored`, () => {
  it('registers every design file present, and only those', () => {
    const files = readdirSync(new URL('designs/', EXEMPLARS))
      .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
      .map((name) => name.slice(0, -3))
      .sort()
    expect(Object.keys(DESIGNS).sort()).toEqual(files)
  })

  it.each(stored.map((entry) => [entry.id, entry] as const))(
    '%s passes the checks with its synthetic slot and matches its vendored template',
    (_id, entry) => {
      const design = DESIGNS[entry.technique]!
      const vendored = readFileSync(new URL(vendoredPath(entry), EXEMPLARS), 'utf8')
      const file = readFileSync(new URL(`designs/${entry.id}.ts`, EXEMPLARS), 'utf8')
      expect(staleDesign(entry, vendored, file)).toBeNull()
      const context = exemplarContext(entry)
      const result = graphicCodeIssue(
        { title: design.title, source: design.source, facts: design.facts },
        context,
        {
          brief: exemplarBrief(entry, context),
          durationMs: entry.slot.durationMs,
          words: entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
        },
      )
      expect(result, `${entry.id}: ${'issue' in result ? result.issue : ''}`).not.toHaveProperty('issue')
    },
  )
})
