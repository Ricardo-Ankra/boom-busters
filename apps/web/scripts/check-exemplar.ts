#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { MANIFEST, vendoredPath } from '@boom-busters/providers'
import type { ExemplarEntry } from '@boom-busters/providers'
import {
  exemplarBrief,
  exemplarContext,
  renderDesignFile,
  renderRegistry,
  vendoredHash,
} from '@/lib/exemplar-translate'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { readRawFlags } from '@/lib/live-set-args'

/**
 * Checks a hand-written exemplar design and, when it passes, stores it
 * (decision 305): the same `graphicCodeIssue` the designer's answers go
 * through, with the entry's synthetic slot, in both frames. No model call,
 * no spend. The paid route is `translate-exemplars.ts`; this is the route for
 * designs written by hand.
 *
 *   pnpm --filter @boom-busters/web exemplar:check -- --id stat-counter --claims
 *     prints the derived claims, numbered, for the facts manifest
 *   pnpm --filter @boom-busters/web exemplar:check -- --id stat-counter \
 *       --source <file.jsx> --title "The 1.2bn" --facts '[{"text":"1.2bn","claim":1}]' [--write]
 *     runs the checks; with --write, a passing design is stored in
 *     packages/providers/src/exemplars/designs/ and the registry regenerated
 *
 * After --write, run Prettier on the stored files, which are written unformatted:
 *   pnpm exec prettier --write packages/providers/src/exemplars/designs
 */

const EXEMPLARS_DIR = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'providers',
  'src',
  'exemplars',
)
const DESIGNS_DIR = path.join(EXEMPLARS_DIR, 'designs')

function entryOf(id: string | undefined): ExemplarEntry {
  const entry = MANIFEST.find((candidate) => candidate.id === id)
  if (!entry) throw new Error(`--id "${id ?? ''}" is not a manifest id`)
  return entry
}

function storedIds(): string[] {
  return readdirSync(DESIGNS_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -3))
}

function main(): void {
  const raw = readRawFlags(process.argv.slice(2))
  const entry = entryOf(raw.id)
  const context = exemplarContext(entry)
  if ('claims' in raw) {
    context.claims.forEach((claim, index) => console.log(`${index + 1}. ${claim.text}`))
    return
  }
  if (!raw.source || !raw.title) throw new Error('--source <file> and --title are required')
  const source = readFileSync(raw.source, 'utf8')
  const facts = JSON.parse(raw.facts ?? '[]') as { text: string; claim: number }[]
  const result = graphicCodeIssue({ title: raw.title, source, facts }, context, {
    brief: exemplarBrief(entry, context),
    durationMs: entry.slot.durationMs,
    words: entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
  })
  if ('issue' in result) {
    console.log(`REFUSED ${entry.id}: ${result.issue}`)
    process.exitCode = 1
    return
  }
  console.log(`PASSED ${entry.id}`)
  if ('write' in raw) {
    const vendored = readFileSync(path.join(EXEMPLARS_DIR, vendoredPath(entry)), 'utf8')
    const file = renderDesignFile(
      entry,
      vendoredHash(vendored),
      { title: raw.title, source, facts },
      'hand',
    )
    writeFileSync(path.join(DESIGNS_DIR, `${entry.id}.ts`), file)
    writeFileSync(path.join(DESIGNS_DIR, 'index.ts'), renderRegistry(storedIds()))
    console.log(`stored designs/${entry.id}.ts`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
