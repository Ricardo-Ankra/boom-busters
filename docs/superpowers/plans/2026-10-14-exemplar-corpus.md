# Exemplar Corpus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The graphics designer's slot message carries one passing, house-dialect exemplar of the technique the slot calls for, chosen deterministically from the brief, from a corpus translated once (on the owner's go-ahead) from MIT-licensed Remotion templates and gated offline by the real checks.

**Architecture:** A manifest in `packages/providers/src/exemplars/` names eighteen techniques, their vendored template files and a synthetic slot each; `techniqueFor` maps a brief to a technique by fixed rules; `exemplarFor` returns a stored design or nothing. `graphic-design-core.ts` fills a new `exemplar` field on the request input and `buildGraphicRequest` renders it as a block in the slot message. A live script in `apps/web/scripts/` translates each template through the designer's own prompt and ladder, keeps only designs `graphicCodeIssue` passes, and writes them to `designs/`; a corpus test re-runs every stored design through the checks and pins each to its vendored file's hash.

**Tech Stack:** TypeScript, Zod 4, Vitest, esbuild (through `compileGraphicSource`), the Anthropic adapter in `@boom-busters/providers`, `LiveBudget`, pnpm workspaces, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-14-exemplar-corpus-design.md` (decision 304, provisional)

**Branch:** `exemplar-corpus`, from `master`.

## Global Constraints

- Decision number 304, provisional; checked against `origin/master` at the merge (301 to 303 are taken, 302 and 303 twice). Renumber only your own lines if it has moved.
- The vendored templates are stored byte for byte as fetched, under `packages/providers/src/exemplars/vendored/<repo>/<name>.tsx.txt` (the `.txt` suffix keeps tsc, eslint and Prettier off them); `vendored/rendercomp/LICENSE` is the repository's MIT file verbatim; `vendored/rve/LICENSE` is hand-written as the spec says. The vendored directory is listed in `.prettierignore`.
- The template sources are `RenderComp/free-remotion-templates` at commit `f648980e528defb7594e24c6447055f0540f340b` and `reactvideoeditor/remotion-templates` at commit `6209b724798e48ff395f8df1a6fa2d26082372b5`.
- A vendored file's hash is the SHA-256, hex, of its text with every `\r\n` replaced by `\n`, so a Windows checkout and a Linux CI agree.
- The vendored files are never shown to the model in the designer's prompt; only `designs/<id>.ts` sources are.
- The translation script runs only with a real key from `.env.local`, refuses to start under `MOCK_PROVIDERS=1`, reserves every call against a `LiveBudget` whose `--cap` defaults to 1 and may not exceed 5 ("A cap above $5 needs the owner's approval first."), never edits the manifest, never writes a design the checks refused, and never runs in CI.
- The system prompt (`SYSTEM` in graphics.ts) does not change in this plan; the exemplar block lives in the slot message only, after the data and before the current design.
- The mock designer (`MOCK_PROVIDERS=1`) sends no exemplar and is unchanged.
- Copy rules for prompt text, descriptions, comments and PROGRESS: South African spelling, no em or en dashes (tests assert none), no "delve", "leverage", "robust".
- Run `pnpm exec prettier --check <files>` on every touched file before each commit (and `--write` if needed) and `pnpm --filter <package> typecheck` for every package touched; CI gates on both.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `pnpm db:migrate` is never run locally. The suites named here need no database.

## Review Focus

1. **An intent that holds both a quotation and a figure** ("He said the £4bn was gone") must pick `quote-card`, not `stat-counter`: the rules are ordered and the first match wins. Test in Task 2 (`picks the first rule that matches`).
2. **A chart brief with an empty series list or no points** must map to `bar-chart` without throwing on `series[0]`. Test in Task 2 (`maps an empty chart to bar-chart`) and in Task 3 (`a chart with no points still reaches the request`).
3. **A technique with no stored design** must leave the request without a block and the prompt unchanged, so the first deploy (empty corpus) changes nothing for the designer. Tests in Task 3 (`sends no block when no design is stored`).
4. **A vendored template changed after its design was written** must fail the corpus gate with a message naming the file, not pass silently with a stale design. Test in Task 4 (`staleDesign names the file whose hash moved`) and the gate in Task 5.
5. **A vendored template that contains a triple backtick** must not break the fenced block in the translation steer: the steer uses a four-backtick fence. Test in Task 4 (`fences the template with four backticks`).

---

### Task 1: The manifest, the vendored templates and the index

**Files:**
- Create: `packages/providers/src/exemplars/manifest.ts`
- Create: `packages/providers/src/exemplars/index.ts`
- Create: `packages/providers/src/exemplars/designs/index.ts`
- Create: `packages/providers/src/exemplars/index.test.ts`
- Create: `packages/providers/src/exemplars/vendored/rendercomp/*.tsx.txt` (8 files) and `LICENSE`
- Create: `packages/providers/src/exemplars/vendored/rve/*.tsx.txt` (10 files) and `LICENSE`
- Modify: `packages/providers/src/index.ts` (one export line)
- Modify: `.prettierignore` (one line)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TECHNIQUES`, `Technique`, `ExemplarEntry`, `ExemplarSlot`, `ExemplarDesign`, `MANIFEST`, `EXEMPLARS`, `exemplarFor(technique): Exemplar | undefined`, `vendoredPath(entry): string` (relative to the exemplars directory), `DESIGNS` (the generated registry, empty now), all exported from `@boom-busters/providers`.

- [ ] **Step 1: Fetch and vendor the templates**

From the repo root, in Git Bash, with a scratch directory outside the repo (never inside it):

```bash
S="$TMP/exemplar-src-$$" && mkdir -p "$S" && cd "$S"
git clone -q https://github.com/RenderComp/free-remotion-templates rendercomp && (cd rendercomp && git checkout -q f648980e528defb7594e24c6447055f0540f340b)
git clone -q https://github.com/reactvideoeditor/remotion-templates rve && (cd rve && git checkout -q 6209b724798e48ff395f8df1a6fa2d26082372b5)
cd "/c/Users/ricar/OneDrive/Desktop/Boom & Busters/boom-busters"
V=packages/providers/src/exemplars/vendored && mkdir -p "$V/rendercomp" "$V/rve"
for f in kpi-counter/KpiCounter bar-chart-anim/BarChartAnim line-chart-anim/LineChartAnim racing-chart/RacingChart kinetic-word-stack/KineticWordStack typewriter/Typewriter chapter-title/ChapterTitle logo-split-reveal/LogoSplitReveal; do
  cp "$S/rendercomp/src/components/$f.tsx" "$V/rendercomp/$(basename "$f").tsx.txt"
done
cp "$S/rendercomp/LICENSE" "$V/rendercomp/LICENSE"
for f in stat-counter comparison-chart donut-chart progress-bars progress-steps text-highlight quote-card animated-list lower-third split-screen; do
  cp "$S/rve/templates/$f.tsx" "$V/rve/$f.tsx.txt"
done
ls "$V/rendercomp" "$V/rve"
```

Expected: 8 `.tsx.txt` files plus LICENSE under `rendercomp`, 10 under `rve`. Then write `packages/providers/src/exemplars/vendored/rve/LICENSE` by hand:

```
MIT License (as stated by the repository's README)

Source: https://github.com/reactvideoeditor/remotion-templates
Commit: 6209b724798e48ff395f8df1a6fa2d26082372b5
Fetched: 2026-10-14

The repository carries no LICENSE file. Its README, section "License", reads:
"All templates in this repository are available under the MIT License. You can
use them in personal and commercial projects, but attribution is appreciated
where applicable."

Copyright (c) the reactvideoeditor.com team

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Add to `.prettierignore` (one line): `packages/providers/src/exemplars/vendored/`.

- [ ] **Step 2: Write the failing index test**

Create `packages/providers/src/exemplars/index.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGNS } from './designs/index'
import { EXEMPLARS, exemplarFor, MANIFEST, TECHNIQUES, vendoredPath } from './index'

const HERE = new URL('./', import.meta.url)
const DASH = /[–—]/

describe('the exemplar manifest (decision 304)', () => {
  it('has exactly one entry per technique, under the technique as its id', () => {
    expect(MANIFEST.map((entry) => entry.technique).sort()).toEqual([...TECHNIQUES].sort())
    for (const entry of MANIFEST) expect(entry.id).toBe(entry.technique)
  })

  it('names a vendored file that exists, beside its licence', () => {
    for (const entry of MANIFEST) {
      const file = new URL(vendoredPath(entry), HERE)
      expect(existsSync(file), `${entry.id}: ${vendoredPath(entry)}`).toBe(true)
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(200)
      expect(existsSync(new URL(`vendored/${entry.source.repo}/LICENSE`, HERE))).toBe(true)
    }
  })

  it('pins each source to one of the two fetched commits', () => {
    for (const entry of MANIFEST) {
      expect(entry.source.commit).toBe(
        entry.source.repo === 'rendercomp'
          ? 'f648980e528defb7594e24c6447055f0540f340b'
          : '6209b724798e48ff395f8df1a6fa2d26082372b5',
      )
    }
  })

  it('gives every entry a synthetic slot with timed words, and data on the chart techniques', () => {
    for (const entry of MANIFEST) {
      expect(entry.slot.durationMs).toBeGreaterThanOrEqual(4000)
      expect(entry.slot.words.length).toBeGreaterThanOrEqual(3)
      let last = -1
      for (const word of entry.slot.words) {
        expect(word.atMs).toBeGreaterThanOrEqual(last)
        expect(word.atMs).toBeLessThan(entry.slot.durationMs)
        last = word.atMs
      }
      if (entry.chart) {
        expect(entry.slot.data).toBeDefined()
        expect(entry.slot.data!.series[0]!.points.length).toBeGreaterThanOrEqual(2)
      } else {
        expect(entry.slot.data).toBeUndefined()
      }
      expect(entry.description).not.toMatch(DASH)
      expect(entry.slot.intent).not.toMatch(DASH)
    }
  })

  it('returns nothing for a technique with no stored design, and the design when one is stored', () => {
    for (const technique of TECHNIQUES) {
      const stored = DESIGNS[technique]
      const found = exemplarFor(technique)
      if (stored === undefined) {
        expect(found).toBeUndefined()
      } else {
        expect(found).toEqual({
          technique,
          description: MANIFEST.find((entry) => entry.technique === technique)!.description,
          title: stored.title,
          source: stored.source,
        })
        expect(stored.source).not.toMatch(DASH)
        expect(stored.title).not.toMatch(DASH)
      }
    }
    expect(EXEMPLARS.map((entry) => entry.id)).toEqual(MANIFEST.map((entry) => entry.id))
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/exemplars/index.test.ts`
Expected: FAIL, `./index` and `./designs/index` cannot be resolved.

- [ ] **Step 4: Write the manifest**

Create `packages/providers/src/exemplars/manifest.ts`:

```ts
import type { ChartKind, ChartSeries } from '@boom-busters/schemas'

/**
 * The exemplar corpus (decision 304): one hand-written entry per technique
 * the channel uses, each naming the MIT-licensed Remotion template it is
 * translated from (vendored byte for byte under `vendored/`, with the
 * repository's licence beside it) and a small synthetic slot that the
 * translation and the corpus test share. The translated designs live in
 * `designs/`; `exemplarFor` joins the two.
 */

export const TECHNIQUES = [
  'stat-counter',
  'kpi-counter',
  'bar-chart',
  'line-chart',
  'racing-chart',
  'comparison-chart',
  'donut-chart',
  'progress-bars',
  'progress-steps',
  'kinetic-word-stack',
  'typewriter',
  'text-highlight',
  'quote-card',
  'animated-list',
  'lower-third',
  'chapter-title',
  'logo-reveal',
  'split-screen',
] as const
export type Technique = (typeof TECHNIQUES)[number]

export interface ExemplarSlot {
  durationMs: number
  /** The narration on the slot's clock, as `props.words` carries it. */
  words: readonly { text: string; atMs: number }[]
  /** What the viewer must take away; the slot message's Intent line. */
  intent: string
  /** A chart technique's `props.data`. */
  data?: {
    series: ChartSeries[]
    takeaway: string
    annotations?: { atX: string; text: string }[]
  }
}

export interface ExemplarEntry {
  id: Technique
  technique: Technique
  /** One line the prompt shows beside the technique's name. */
  description: string
  source: { repo: 'rendercomp' | 'rve'; path: string; commit: string }
  /** A chart technique: its slot carries data and its brief is a chart brief. */
  chart?: { kind: ChartKind }
  slot: ExemplarSlot
}

const RENDERCOMP = 'f648980e528defb7594e24c6447055f0540f340b'
const RVE = '6209b724798e48ff395f8df1a6fa2d26082372b5'

const rendercomp = (path: string) => ({ repo: 'rendercomp' as const, path, commit: RENDERCOMP })
const rve = (path: string) => ({ repo: 'rve' as const, path, commit: RVE })

/** Words spread evenly from `fromMs`, `stepMs` apart. */
const spoken = (text: string, fromMs: number, stepMs: number) =>
  text.split(' ').map((word, index) => ({ text: word, atMs: fromMs + index * stepMs }))

/** One series of yearly points, for the chart techniques. */
const yearly = (label: string, unit: string, values: readonly [string, number][]): ChartSeries => ({
  label,
  unit,
  points: values.map(([x, y]) => ({ x, y })),
})

export const MANIFEST: readonly ExemplarEntry[] = [
  {
    id: 'stat-counter',
    technique: 'stat-counter',
    description: 'one large figure counting up to its mark, a label beneath, held',
    source: rve('templates/stat-counter.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('The company had raised 1.2bn by the end of the year.', 200, 450),
      intent: 'The 1.2bn is the whole story of the year.',
    },
  },
  {
    id: 'kpi-counter',
    technique: 'kpi-counter',
    description: 'three figures counting up side by side, each with its label, the hero last',
    source: rendercomp('src/components/kpi-counter/KpiCounter.tsx'),
    slot: {
      durationMs: 8000,
      words: spoken('Revenue of 4.2bn, a loss of 900m, and 12,000 staff gone.', 200, 500),
      intent: 'Three figures tell the collapse: 4.2bn revenue, a 900m loss, 12,000 staff gone.',
    },
  },
  {
    id: 'bar-chart',
    technique: 'bar-chart',
    description: 'bars drawn on one by one as their years are spoken, the last in the accent',
    source: rendercomp('src/components/bar-chart-anim/BarChartAnim.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'In', atMs: 300 },
        { text: '2019', atMs: 600 },
        { text: 'then', atMs: 2000 },
        { text: '2020', atMs: 2400 },
        { text: 'then', atMs: 3800 },
        { text: '2021', atMs: 4200 },
        { text: 'and', atMs: 5400 },
        { text: '2022', atMs: 5800 },
        { text: 'the', atMs: 6600 },
        { text: 'debt', atMs: 6800 },
        { text: 'grew.', atMs: 7100 },
      ],
      intent: 'The debt grew every year.',
      data: {
        series: [
          yearly('Debt', 'bn', [
            ['2019', 1.1],
            ['2020', 1.8],
            ['2021', 2.6],
            ['2022', 4.0],
          ]),
        ],
        takeaway: 'The debt grew every year',
        annotations: [{ atX: '2022', text: 'Default' }],
      },
    },
  },
  {
    id: 'line-chart',
    technique: 'line-chart',
    description: 'a line drawn across the frame point by point, the last value called out',
    source: rendercomp('src/components/line-chart-anim/LineChartAnim.tsx'),
    chart: { kind: 'line' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'The', atMs: 300 },
        { text: 'share', atMs: 500 },
        { text: 'price', atMs: 800 },
        { text: 'fell', atMs: 1200 },
        { text: 'from', atMs: 1600 },
        { text: '2019', atMs: 2000 },
        { text: 'to', atMs: 3400 },
        { text: '2020', atMs: 3800 },
        { text: 'to', atMs: 5000 },
        { text: '2021', atMs: 5400 },
        { text: 'to', atMs: 6400 },
        { text: '2022.', atMs: 6800 },
      ],
      intent: 'The share price fell every year.',
      data: {
        series: [
          yearly('Share price', 'USD', [
            ['2019', 98],
            ['2020', 71],
            ['2021', 34],
            ['2022', 6],
          ]),
        ],
        takeaway: 'The share price fell every year',
        annotations: [{ atX: '2022', text: 'Delisted' }],
      },
    },
  },
  {
    id: 'racing-chart',
    technique: 'racing-chart',
    description: 'horizontal bars that grow and reorder as the years pass, the leader on top',
    source: rendercomp('src/components/racing-chart/RacingChart.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 10000,
      words: [
        { text: 'Year', atMs: 300 },
        { text: 'by', atMs: 500 },
        { text: 'year', atMs: 700 },
        { text: '2017', atMs: 1200 },
        { text: '2018', atMs: 2600 },
        { text: '2019', atMs: 4000 },
        { text: '2020', atMs: 5400 },
        { text: '2021', atMs: 6800 },
        { text: 'the', atMs: 8000 },
        { text: 'fund', atMs: 8200 },
        { text: 'grew.', atMs: 8500 },
      ],
      intent: 'The fund grew every year for five years.',
      data: {
        series: [
          yearly('Assets', 'bn', [
            ['2017', 2],
            ['2018', 5],
            ['2019', 9],
            ['2020', 14],
            ['2021', 23],
          ]),
        ],
        takeaway: 'The fund grew every year',
      },
    },
  },
  {
    id: 'comparison-chart',
    technique: 'comparison-chart',
    description: 'two series side by side per year, the gap between them the point',
    source: rve('templates/comparison-chart.tsx'),
    chart: { kind: 'bar' },
    slot: {
      durationMs: 8000,
      words: [
        { text: 'Reported', atMs: 300 },
        { text: 'against', atMs: 800 },
        { text: 'real', atMs: 1200 },
        { text: 'in', atMs: 1800 },
        { text: '2020', atMs: 2200 },
        { text: 'and', atMs: 3800 },
        { text: '2021', atMs: 4200 },
        { text: 'and', atMs: 5600 },
        { text: '2022.', atMs: 6000 },
      ],
      intent: 'What was reported was never what was real.',
      data: {
        series: [
          yearly('Reported', 'bn', [
            ['2020', 2.0],
            ['2021', 2.8],
            ['2022', 3.5],
          ]),
          yearly('Real', 'bn', [
            ['2020', 0.9],
            ['2021', 0.7],
            ['2022', 0.2],
          ]),
        ],
        takeaway: 'Reported was never real',
      },
    },
  },
  {
    id: 'donut-chart',
    technique: 'donut-chart',
    description: 'a ring that fills to a percentage, the figure counting up inside it',
    source: rve('templates/donut-chart.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('Forty per cent of the money, 40%, was simply gone.', 200, 450),
      intent: '40% of the money was gone.',
    },
  },
  {
    id: 'progress-bars',
    technique: 'progress-bars',
    description: 'labelled bars filling to their share, one after another',
    source: rve('templates/progress-bars.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('Banks held 60%, funds 30%, and the public 10%.', 200, 500),
      intent: 'Banks held 60%, funds 30%, the public 10%.',
    },
  },
  {
    id: 'progress-steps',
    technique: 'progress-steps',
    description: 'numbered steps lighting up in turn along a line',
    source: rve('templates/progress-steps.tsx'),
    slot: {
      durationMs: 8000,
      words: spoken('First the loan, second the shell company, third the transfer, fourth the silence.', 200, 500),
      intent: 'Four steps: the loan, the shell company, the transfer, the silence.',
    },
  },
  {
    id: 'kinetic-word-stack',
    technique: 'kinetic-word-stack',
    description: 'words stacking in as they are spoken, the last one the biggest',
    source: rendercomp('src/components/kinetic-word-stack/KineticWordStack.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('Nobody asked. Nobody checked. Nobody knew.', 300, 550),
      intent: 'Nobody asked, nobody checked, nobody knew.',
    },
  },
  {
    id: 'typewriter',
    technique: 'typewriter',
    description: 'a line typed out character by character with a cursor, then held',
    source: rendercomp('src/components/typewriter/Typewriter.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('The email said: delete everything tonight.', 300, 600),
      intent: 'The email said to delete everything tonight.',
    },
  },
  {
    id: 'text-highlight',
    technique: 'text-highlight',
    description: 'one phrase in a sentence swept with a highlight as it is said',
    source: rve('templates/text-highlight.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('The auditors signed off every single year.', 300, 500),
      intent: 'The auditors signed off every single year.',
    },
  },
  {
    id: 'quote-card',
    technique: 'quote-card',
    description: 'a quotation in large type with its attribution beneath, entering as it is read',
    source: rve('templates/quote-card.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('"We never saw the money," the chairman told the court.', 300, 500),
      intent: 'The chairman told the court they never saw the money.',
    },
  },
  {
    id: 'animated-list',
    technique: 'animated-list',
    description: 'a list whose items enter one at a time with a marker',
    source: rve('templates/animated-list.tsx'),
    slot: {
      durationMs: 7000,
      words: spoken('Three banks, two funds, one regulator, and no questions.', 300, 500),
      intent: 'Three banks, two funds, one regulator, no questions.',
    },
  },
  {
    id: 'lower-third',
    technique: 'lower-third',
    description: 'a name and a role in a band at the bottom of the frame, sliding in and holding',
    source: rve('templates/lower-third.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Jane Doe, the chief financial officer.', 300, 500),
      intent: 'Jane Doe is the chief financial officer.',
    },
  },
  {
    id: 'chapter-title',
    technique: 'chapter-title',
    description: 'a chapter number and its title, the rule drawing between them',
    source: rendercomp('src/components/chapter-title/ChapterTitle.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Chapter three. The missing billion.', 300, 500),
      intent: 'Chapter three: the missing billion.',
    },
  },
  {
    id: 'logo-reveal',
    technique: 'logo-reveal',
    description: 'a mark revealed from a split, its name settling beneath it',
    source: rendercomp('src/components/logo-split-reveal/LogoSplitReveal.tsx'),
    slot: {
      durationMs: 5000,
      words: spoken('Acme was the name on every door.', 300, 500),
      intent: 'Acme was the name on every door.',
    },
  },
  {
    id: 'split-screen',
    technique: 'split-screen',
    description: 'two halves of the frame, one claim each, the divider drawn between them',
    source: rve('templates/split-screen.tsx'),
    slot: {
      durationMs: 6000,
      words: spoken('What they said, against what they did.', 300, 500),
      intent: 'What they said against what they did.',
    },
  },
]
```

- [ ] **Step 5: Write the empty registry and the index**

Create `packages/providers/src/exemplars/designs/index.ts`:

```ts
import type { Technique } from '../manifest'

/**
 * Every stored design, by technique. Generated by
 * `apps/web/scripts/translate-exemplars.ts`, which rewrites this file from
 * the `designs/*.ts` files present; the corpus test checks the two agree.
 */
export interface ExemplarDesign {
  title: string
  source: string
  facts: { text: string; claim: number }[]
}

export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {}
```

Create `packages/providers/src/exemplars/index.ts`:

```ts
import { DESIGNS } from './designs/index'
import type { ExemplarDesign } from './designs/index'
import { MANIFEST, TECHNIQUES } from './manifest'
import type { ExemplarEntry, ExemplarSlot, Technique } from './manifest'

export { DESIGNS, MANIFEST, TECHNIQUES }
export type { ExemplarDesign, ExemplarEntry, ExemplarSlot, Technique }

/** What the slot message shows: the technique, its one-line description, and the stored design. */
export interface Exemplar {
  technique: Technique
  description: string
  title: string
  source: string
}

/** The manifest joined with whatever designs are stored. */
export const EXEMPLARS: readonly (ExemplarEntry & { design?: ExemplarDesign })[] = MANIFEST.map(
  (entry) => {
    const design = DESIGNS[entry.technique]
    return design ? { ...entry, design } : entry
  },
)

/** The exemplar for a technique, or undefined while no design is stored for it. */
export function exemplarFor(technique: Technique): Exemplar | undefined {
  const entry = EXEMPLARS.find((candidate) => candidate.technique === technique)
  if (!entry?.design) return undefined
  return {
    technique,
    description: entry.description,
    title: entry.design.title,
    source: entry.design.source,
  }
}

/** The vendored template's path, relative to this directory. */
export function vendoredPath(entry: ExemplarEntry): string {
  const name = entry.source.path.split('/').pop() ?? entry.source.path
  return `vendored/${entry.source.repo}/${name}.txt`
}
```

Add to `packages/providers/src/index.ts`, after the `prompts/index` export line:

```ts
export * from './exemplars/index'
```

- [ ] **Step 6: Run the test to verify it passes, then typecheck and format**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/exemplars/index.test.ts`
Expected: PASS (5 tests).

Run: `pnpm --filter @boom-busters/providers typecheck && pnpm exec prettier --check packages/providers/src/exemplars/manifest.ts packages/providers/src/exemplars/index.ts packages/providers/src/exemplars/designs/index.ts packages/providers/src/exemplars/index.test.ts packages/providers/src/index.ts .prettierignore`
Expected: no errors; all formatted. Then confirm Prettier ignores the vendored files: `pnpm exec prettier --check packages/providers/src/exemplars/vendored/rve/stat-counter.tsx.txt` must print that the file is ignored or report nothing to check, and `git status --short packages/providers/src/exemplars/vendored` must show every file as added and unmodified by any formatter.

- [ ] **Step 7: Commit**

```bash
git add .prettierignore packages/providers/src/index.ts packages/providers/src/exemplars
git commit -m "feat(providers): the exemplar manifest, eighteen vendored MIT templates with their licences, and an empty corpus (decision 304)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `techniqueFor`

**Files:**
- Create: `packages/providers/src/exemplars/technique.ts`
- Create: `packages/providers/src/exemplars/technique.test.ts`
- Modify: `packages/providers/src/exemplars/index.ts` (re-export)

**Interfaces:**
- Consumes: `TECHNIQUES`, `Technique` (Task 1); `ChartKind` from `@boom-busters/schemas`.
- Produces: `techniqueFor(input: TechniqueInput): Technique` and `TechniqueInput`, exported from `@boom-busters/providers`.

- [ ] **Step 1: Write the failing test**

Create `packages/providers/src/exemplars/technique.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { techniqueFor } from './technique'
import type { TechniqueInput } from './technique'

const graphic = (over: Partial<TechniqueInput> = {}): TechniqueInput => ({
  type: 'graphic',
  intent: 'The money moved through three shell companies and two banks.',
  description: 'The route of the money.',
  coversText: 'The money moved through three shell companies and two banks.',
  logos: ['Acme', 'Beta Bank'],
  ...over,
})

const chart = (over: Partial<TechniqueInput> = {}): TechniqueInput => ({
  type: 'chart',
  chartKind: 'bar',
  seriesCount: 1,
  xLabels: ['2019', '2020', '2021'],
  intent: 'The debt grew every year.',
  description: 'The debt.',
  coversText: 'The debt grew every year.',
  logos: [],
  ...over,
})

describe('techniqueFor (decision 304)', () => {
  it.each([
    ['bar, one series', chart(), 'bar-chart'],
    ['stacked', chart({ chartKind: 'stacked' }), 'bar-chart'],
    ['line', chart({ chartKind: 'line' }), 'line-chart'],
    ['area', chart({ chartKind: 'area' }), 'line-chart'],
    ['waterfall', chart({ chartKind: 'waterfall' }), 'comparison-chart'],
    ['bar, two series', chart({ seriesCount: 2 }), 'comparison-chart'],
    [
      'bar, one series, five years',
      chart({ xLabels: ['2017', '2018', '2019', '2020', '2021'] }),
      'racing-chart',
    ],
    [
      'bar, one series, five labels that are not years',
      chart({ xLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'] }),
      'bar-chart',
    ],
  ])('maps a chart by its kind and shape: %s', (_name, input, technique) => {
    expect(techniqueFor(input)).toBe(technique)
  })

  it('maps an empty chart to bar-chart', () => {
    expect(techniqueFor(chart({ seriesCount: 0, xLabels: [] }))).toBe('bar-chart')
    expect(techniqueFor({ type: 'chart', intent: '', description: '', coversText: '', logos: [] })).toBe(
      'bar-chart',
    )
  })

  it.each([
    ['a quotation', graphic({ coversText: '"We never saw it," he said.' }), 'quote-card'],
    ['said', graphic({ intent: 'The chairman said the money was safe.' }), 'quote-card'],
    ['a percentage sign', graphic({ intent: '40% of the money was gone.' }), 'donut-chart'],
    ['per cent', graphic({ intent: 'Forty per cent was gone.' }), 'donut-chart'],
    ['share of', graphic({ intent: 'The share of debt that was real.' }), 'donut-chart'],
    ['versus', graphic({ intent: 'Reported versus real.' }), 'split-screen'],
    ['side by side', graphic({ description: 'The two claims side by side.' }), 'split-screen'],
    ['a logo title in the intent', graphic({ intent: 'Acme was the name on every door.' }), 'logo-reveal'],
    ['two figures', graphic({ intent: 'Revenue of 4.2bn and a loss of 900m.' }), 'kpi-counter'],
    ['one figure', graphic({ intent: 'The company raised 1.2bn.' }), 'stat-counter'],
    ['a short intent', graphic({ intent: 'Nobody asked.' }), 'text-highlight'],
    ['the fallthrough', graphic(), 'kinetic-word-stack'],
  ])('maps a graphic by keyword: %s', (_name, input, technique) => {
    expect(techniqueFor(input)).toBe(technique)
  })

  it('picks the first rule that matches: a quotation with a figure is a quote card', () => {
    expect(techniqueFor(graphic({ intent: 'He said the £4bn was gone.' }))).toBe('quote-card')
    expect(techniqueFor(graphic({ intent: '40% of the 4bn was gone.' }))).toBe('donut-chart')
  })

  it('counts a figure by its unit or currency, not by every number', () => {
    expect(
      techniqueFor(graphic({ intent: 'In 2019 the three men met in a room above the bank.' })),
    ).toBe('kinetic-word-stack')
    expect(techniqueFor(graphic({ intent: 'The $4bn and the €900m were both gone.' }))).toBe(
      'kpi-counter',
    )
  })

  it('ignores a blank logo title and matches a title case-insensitively', () => {
    expect(techniqueFor(graphic({ logos: ['', '  '], intent: 'Acme was everywhere.' }))).toBe(
      'text-highlight',
    )
    expect(techniqueFor(graphic({ intent: 'ACME was everywhere.' }))).toBe('logo-reveal')
  })

  it.each([
    ['typewriter', 'typewriter'],
    ['make it a list', 'animated-list'],
    ['a lower third please', 'lower-third'],
    ['progress bar', 'progress-bars'],
    ['show the steps', 'progress-steps'],
    ['as a quote', 'quote-card'],
    ['a counter', 'stat-counter'],
    ['racing bars', 'racing-chart'],
    ['a donut', 'donut-chart'],
    ['pie', 'donut-chart'],
    ['split it', 'split-screen'],
    ['a chapter title', 'chapter-title'],
    ['the logo', 'logo-reveal'],
    ['highlight the phrase', 'text-highlight'],
    ['word stack', 'kinetic-word-stack'],
    ['kinetic', 'kinetic-word-stack'],
  ])('lets the steer "%s" choose the technique over every rule', (guidance, technique) => {
    expect(techniqueFor(chart({ guidance }))).toBe(technique)
    expect(techniqueFor(graphic({ guidance, intent: '"Quoted," he said.' }))).toBe(technique)
  })

  it('leaves a steer with no technique word to the rules', () => {
    expect(techniqueFor(graphic({ guidance: 'bigger and bolder' }))).toBe('kinetic-word-stack')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/exemplars/technique.test.ts`
Expected: FAIL, `./technique` cannot be resolved.

- [ ] **Step 3: Write `techniqueFor`**

Create `packages/providers/src/exemplars/technique.ts`:

```ts
import type { ChartKind } from '@boom-busters/schemas'
import type { Technique } from './manifest'

/**
 * Which exemplar a slot gets (decision 304): a pure function of the brief's
 * fields, the film's logo titles and the producer's steer. No model call,
 * deterministic, first match wins. The steer beats every rule, and five
 * techniques are reached by the steer only (the designer does not know a
 * slot's place in its chapter, and the other four are the producer's
 * stylistic choices): chapter-title, typewriter, animated-list, lower-third
 * and progress-bars.
 */
export interface TechniqueInput {
  type: 'graphic' | 'chart'
  chartKind?: ChartKind
  seriesCount?: number
  /** The first series' x labels, for the years test. */
  xLabels?: readonly string[]
  intent: string
  description: string
  coversText: string
  /** The titles the logo library holds. */
  logos: readonly string[]
  /** The producer's steer on a redesign. */
  guidance?: string
}

/** Steer words, in the order they are tried: the more specific phrase first. */
const STEER: readonly [RegExp, Technique][] = [
  [/\blower[ -]third\b/i, 'lower-third'],
  [/\bprogress[ -]bars?\b/i, 'progress-bars'],
  [/\bchapter[ -]title\b/i, 'chapter-title'],
  [/\bword[ -]stack\b|\bkinetic\b/i, 'kinetic-word-stack'],
  [/\btypewriter\b/i, 'typewriter'],
  [/\bsteps?\b/i, 'progress-steps'],
  [/\bquote\b/i, 'quote-card'],
  [/\bcounter\b/i, 'stat-counter'],
  [/\bracing\b/i, 'racing-chart'],
  [/\bdonut\b|\bpie\b/i, 'donut-chart'],
  [/\bsplit\b/i, 'split-screen'],
  [/\blogo\b/i, 'logo-reveal'],
  [/\bhighlight\b/i, 'text-highlight'],
  [/\blist\b/i, 'animated-list'],
]

const QUOTE = /["“”][^"“”]+["“”]|\b(?:said|wrote|told)\b/i
const PERCENT = /%|\bper ?cent\b|\bshare of\b/i
const VERSUS = /\bversus\b|\bvs\.?\b|\bcompared\b|\bagainst\b|\bside by side\b/i
/** A figure with a unit or a currency: "1.2bn", "900m", "12,000 staff" is not one, "$4bn" is. */
const FIGURE =
  /[$€£]\s?\d[\d,.]*(?:\s?(?:bn|m|k|billion|million|thousand))?\b|\b\d[\d,.]*\s?(?:bn|m|k|billion|million|thousand)\b/gi
const YEAR = /^\d{4}$/

export function techniqueFor(input: TechniqueInput): Technique {
  if (input.guidance) {
    for (const [pattern, technique] of STEER) {
      if (pattern.test(input.guidance)) return technique
    }
  }
  if (input.type === 'chart') return chartTechnique(input)
  const text = [input.intent, input.description, input.coversText].join('\n')
  if (QUOTE.test(text)) return 'quote-card'
  if (PERCENT.test(text)) return 'donut-chart'
  if (VERSUS.test(text)) return 'split-screen'
  const intent = input.intent.toLowerCase()
  if (input.logos.some((title) => title.trim().length > 1 && intent.includes(title.trim().toLowerCase()))) {
    return 'logo-reveal'
  }
  const figures = text.match(FIGURE)?.length ?? 0
  if (figures >= 2) return 'kpi-counter'
  if (figures === 1) return 'stat-counter'
  if (input.intent.trim().split(/\s+/).filter(Boolean).length <= 8) return 'text-highlight'
  return 'kinetic-word-stack'
}

function chartTechnique(input: TechniqueInput): Technique {
  const series = input.seriesCount ?? 0
  const labels = input.xLabels ?? []
  switch (input.chartKind) {
    case 'line':
    case 'area':
      return 'line-chart'
    case 'waterfall':
      return 'comparison-chart'
    case 'bar':
      if (series >= 2) return 'comparison-chart'
      if (series === 1 && labels.length >= 5 && labels.every((label) => YEAR.test(label))) {
        return 'racing-chart'
      }
      return 'bar-chart'
    case 'stacked':
    default:
      return 'bar-chart'
  }
}
```

Add to `packages/providers/src/exemplars/index.ts`:

```ts
export { techniqueFor } from './technique'
export type { TechniqueInput } from './technique'
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/exemplars/technique.test.ts`
Expected: PASS. The default `graphic()` intent has ten words on purpose: the short-intent rule is "eight words or fewer", so the fallthrough case must sit above it.

Run: `pnpm --filter @boom-busters/providers typecheck && pnpm exec prettier --check packages/providers/src/exemplars/technique.ts packages/providers/src/exemplars/technique.test.ts packages/providers/src/exemplars/index.ts`
Expected: no errors; all formatted.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/exemplars/technique.ts packages/providers/src/exemplars/technique.test.ts packages/providers/src/exemplars/index.ts
git commit -m "feat(providers): techniqueFor picks a slot's exemplar from the brief, the logos and the steer (decision 304)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The exemplar in the request

**Files:**
- Modify: `packages/providers/src/prompts/graphics.ts` (`GraphicDesignInput`, `buildGraphicRequest`)
- Modify: `packages/providers/src/prompts/graphics.test.ts`
- Modify: `apps/web/lib/graphic-design-core.ts` (`designGraphicWith`)
- Modify: `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: `techniqueFor`, `exemplarFor`, `Exemplar` (Tasks 1 and 2).
- Produces: `GraphicDesignInput.exemplar?: Exemplar`; the slot message block; `graphic-design-core.ts` fills `exemplar` from the brief, the context's logo titles and the guidance.

- [ ] **Step 1: Write the failing prompt tests**

In `packages/providers/src/prompts/graphics.test.ts`, add inside `describe('buildGraphicRequest (decision 295)', ...)`:

```ts
  it('carries one exemplar of the slot technique in the slot message, after the data and before the current design (decision 304)', () => {
    const exemplar = {
      technique: 'stat-counter' as const,
      description: 'one large figure counting up to its mark, a label beneath, held',
      title: 'The 1.2bn',
      source: 'function Graphic(props) {\n  return null\n}',
    }
    const request = buildGraphicRequest(
      input({
        data: CHART_DATA,
        exemplar,
        current: { source: 'function Graphic() { return null }', title: 'Old title', motion: 1 },
      }),
    )
    const slot = request.messages[1]!.content
    expect(slot).toContain(
      'A passing design of this technique (stat-counter: one large figure counting up to its mark, a label beneath, held), in this sandbox and on the tokens, to pattern on. Its words and figures are its own; yours come from this slot and its claims:',
    )
    expect(slot).toContain('```jsx\n' + exemplar.source + '\n```')
    expect(slot.indexOf('Data (draw every point')).toBeLessThan(slot.indexOf('A passing design'))
    expect(request.messages[2]!.content).toContain('The current design')
    expect(request.messages[0]!.content).not.toContain('A passing design')
    expect(request.system).toBe(buildGraphicRequest(input()).system)
  })

  it('sends no block when no exemplar is given', () => {
    const request = buildGraphicRequest(input())
    expect(request.messages[1]!.content).not.toContain('A passing design')
    expect(request.messages).toHaveLength(2)
  })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/graphics.test.ts`
Expected: FAIL: a type error on `exemplar` (vitest reports it at run time as the block missing) and the first test's `toContain` fails.

- [ ] **Step 3: Add the field and the block**

In `packages/providers/src/prompts/graphics.ts`:

Add to the imports: `import type { Exemplar } from '../exemplars/index'`.

In `GraphicDesignInput`, after `guidance?: string`, add:

```ts
  /** A passing design of the slot's technique, shown in the slot message (decision 304). */
  exemplar?: Exemplar
```

In `buildGraphicRequest`, after the `slot` constant's data clause, extend the expression: replace

```ts
    (input.data
      ? `\n\nData (draw every point; values are verbatim from the claims):\n${JSON.stringify(input.data, null, 2)}`
      : '')
```

with

```ts
    (input.data
      ? `\n\nData (draw every point; values are verbatim from the claims):\n${JSON.stringify(input.data, null, 2)}`
      : '') +
    (input.exemplar ? `\n\n${exemplarBlock(input.exemplar)}` : '')
```

and add after `buildGraphicRequest`:

```ts
/**
 * The slot's exemplar (decision 304): one passing design of the technique
 * the brief calls for, in the sandbox and on the tokens, so the model
 * patterns on the technique and not on the system prompt's two examples. It
 * sits in the slot message, after the data, so the cached film message and
 * the system prompt are untouched.
 */
function exemplarBlock(exemplar: Exemplar): string {
  return (
    `A passing design of this technique (${exemplar.technique}: ${exemplar.description}), in this ` +
    'sandbox and on the tokens, to pattern on. Its words and figures are its own; yours come ' +
    'from this slot and its claims:\n' +
    '```jsx\n' +
    exemplar.source +
    '\n```'
  )
}
```

- [ ] **Step 4: Run the prompt tests to verify they pass**

Run: `pnpm --filter @boom-busters/providers exec vitest run src/prompts/graphics.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing design-core tests**

In `apps/web/lib/graphic-design.test.ts`, add inside the `describe` that holds the real-model path tests (the one using `designGraphicWith` with a stubbed `complete`; find it with `grep -n "describe(" apps/web/lib/graphic-design.test.ts`), using that file's existing `CONTEXT`, `BRIEF`, `CHART` and `sent()` helpers:

```ts
  it('sends the slot an exemplar of its technique when one is stored, and none before (decision 304)', async () => {
    const providers = await import('@boom-busters/providers')
    const expected = providers.exemplarFor(
      providers.techniqueFor({
        type: 'graphic',
        intent: BRIEF.intent ?? '',
        description: BRIEF.description,
        coversText: BRIEF.coversText,
        logos: [],
      }),
    )
    callLlm.mockResolvedValueOnce({ text: JSON.stringify(planned('$4bn')) })
    await designGraphicWith(
      (request, options) => callLlm(request, options),
      CONTEXT,
      { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: BRIEF },
    )
    if (expected) {
      expect(sent()).toContain(`A passing design of this technique (${expected.technique}:`)
      expect(sent()).toContain(expected.source)
    } else {
      expect(sent()).not.toContain('A passing design of this technique')
    }
  })

  it('a chart with no points still reaches the request, as a bar chart (decision 304)', async () => {
    const providers = await import('@boom-busters/providers')
    const empty: ChartBrief = { ...CHART, series: [{ label: 'Raised', unit: 'USD bn', points: [] }] }
    expect(
      providers.techniqueFor({
        type: 'chart',
        chartKind: empty.chartKind,
        seriesCount: empty.series.length,
        xLabels: [],
        intent: empty.takeaway,
        description: empty.description,
        coversText: empty.coversText,
        logos: [],
      }),
    ).toBe('bar-chart')
    callLlm.mockResolvedValueOnce({ text: JSON.stringify(planned('$4bn')) })
    await designGraphicWith(
      (request, options) => callLlm(request, options),
      CONTEXT,
      { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: empty },
    )
    expect(callLlm).toHaveBeenCalledTimes(1)
  })
```

If `planned` in that file builds a source that the empty chart's checks refuse (the chart source reads `props.data.series[0].points`, which is an empty array and draws nothing: the dead-air rule then refuses it), the second test only needs the request to have been sent once; assert `callLlm` was called and ignore the result, as written.

- [ ] **Step 6: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-design.test.ts`
Expected: the first new test passes vacuously (no design is stored, so `expected` is undefined and the request has no block) and the second passes. Both must still be in the file: they pin the empty-corpus behaviour now and the stored-corpus behaviour after the live run. Confirm by temporarily making `exemplarFor` return a stub (do not commit that) that the first test's `expected` branch would run; or trust the prompt test, which pins the block.

- [ ] **Step 7: Fill `exemplar` in the design core**

In `apps/web/lib/graphic-design-core.ts`:

Add `exemplarFor` and `techniqueFor` to the `@boom-busters/providers` import.

In `designGraphicWith`, after `const words = ...` and before `const base`, add:

```ts
  // The slot's exemplar (decision 304): the technique from the brief, the
  // logo titles and the steer; absent while the corpus holds no design for it.
  const exemplar = exemplarFor(
    techniqueFor({
      type: brief.type,
      ...(brief.type === 'chart'
        ? {
            chartKind: brief.chartKind,
            seriesCount: brief.series.length,
            xLabels: brief.series[0]?.points.map((point) => point.x) ?? [],
          }
        : {}),
      intent,
      description: brief.description,
      coversText: brief.coversText,
      logos: context.logos.map((logo) => logo.title),
      ...(options.guidance ? { guidance: options.guidance } : {}),
    }),
  )
```

and in `base`, after the `data` spread, add:

```ts
    ...(exemplar ? { exemplar } : {}),
```

- [ ] **Step 8: Run the web design tests, typechecks and format**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-design.test.ts lib/graphic-code/check.test.ts`
Expected: PASS.

Run: `pnpm --filter @boom-busters/providers typecheck && pnpm --filter @boom-busters/web typecheck && pnpm exec prettier --check packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.test.ts`
Expected: no errors; all formatted.

- [ ] **Step 9: Commit**

```bash
git add packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.test.ts
git commit -m "feat(graphics): the slot message carries one exemplar of the slot's technique when the corpus holds one (decision 304)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The translation job

**Files:**
- Create: `apps/web/lib/exemplar-translate.ts` (the pure parts)
- Create: `apps/web/lib/exemplar-translate.test.ts`
- Create: `apps/web/scripts/translate-exemplars.ts`
- Modify: `apps/web/package.json` (`live:exemplars` script)

**Interfaces:**
- Consumes: `MANIFEST`, `ExemplarEntry`, `vendoredPath`, `DESIGNS`, `Technique` (Task 1); `buildGraphicRequest`, `parseGraphicCode`, `GraphicDesignInput` (Task 3's shape, without `exemplar`); `graphicCodeIssue` (`@/lib/graphic-code/check`); `callForAnswer` (`@/lib/answer`); `LiveBudget`, `BudgetExceeded` (`@/lib/live-budget`); `readRawFlags`, `optionalText` (`@/lib/live-set-args`); `anthropic`, `findModel`, `priceOf`, `mockProvidersEnabled` from `@boom-busters/providers`; `DEFAULT_SETTINGS` from `@boom-busters/schemas`.
- Produces: `vendoredHash(text)`, `designHeader(entry, hash)`, `renderDesignFile(entry, hash, design)`, `storedHash(designFile)`, `staleDesign(entry, vendoredText, designFile | undefined)`, `exemplarContext(entry)`, `exemplarBrief(entry)`, `exemplarInput(entry, vendoredText)`, `renderRegistry(ids)`, `parseExemplarArgs(argv)`, `TRANSLATE_STEER`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/lib/exemplar-translate.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { MANIFEST } from '@boom-busters/providers'
import {
  designHeader,
  exemplarBrief,
  exemplarContext,
  exemplarInput,
  parseExemplarArgs,
  renderDesignFile,
  renderRegistry,
  staleDesign,
  storedHash,
  TRANSLATE_STEER,
  vendoredHash,
} from './exemplar-translate'

const stat = MANIFEST.find((entry) => entry.id === 'stat-counter')!
const bar = MANIFEST.find((entry) => entry.id === 'bar-chart')!

describe('exemplar translation, the pure parts (decision 304)', () => {
  it('hashes a vendored file the same whatever its line endings', () => {
    expect(vendoredHash('a\r\nb\r\n')).toBe(vendoredHash('a\nb\n'))
    expect(vendoredHash('a\nb\n')).toMatch(/^[0-9a-f]{64}$/)
    expect(vendoredHash('a\nb\n')).not.toBe(vendoredHash('a\nc\n'))
  })

  it('renders a design file whose header carries the vendored hash, and reads it back', () => {
    const hash = vendoredHash('x')
    const file = renderDesignFile(stat, hash, { title: 'The 1.2bn', source: 'function Graphic() {\n  return `a${1}`\n}', facts: [{ text: '1.2bn', claim: 1 }] })
    expect(file).toContain(designHeader(stat, hash))
    expect(file).toContain('vendored/rve/stat-counter.tsx.txt')
    expect(file).toContain(`vendored sha256: ${hash}`)
    expect(storedHash(file)).toBe(hash)
    expect(file).toContain('export const DESIGN')
    expect(file).toContain('facts: [{"text":"1.2bn","claim":1}]')
    // The source round-trips through a JSON string, so backticks and ${ are safe.
    const match = /source: ("(?:[^"\\]|\\.)*")/.exec(file)
    expect(JSON.parse(match![1]!)).toBe('function Graphic() {\n  return `a${1}`\n}')
    expect(file).not.toMatch(/[–—]/)
  })

  it('staleDesign names the file whose hash moved, and is quiet when nothing is stored or it matches', () => {
    const hash = vendoredHash('the template')
    const file = renderDesignFile(stat, hash, { title: 't', source: 's', facts: [] })
    expect(staleDesign(stat, 'the template', file)).toBeNull()
    expect(staleDesign(stat, 'the template', undefined)).toBeNull()
    expect(staleDesign(stat, 'the template, changed', file)).toBe(
      'stat-counter: vendored/rve/stat-counter.tsx.txt changed since its design was written',
    )
  })

  it('derives a context whose claims hold every figure the slot speaks or charts', () => {
    const context = exemplarContext(bar)
    expect(context.caseTitle).toBe('Exemplar')
    expect(context.chapterTitle).toBe('bar-chart')
    expect(context.logos).toEqual([
      { id: '01J00000000000000000000EX1', title: 'Acme', width: 1200, height: 400 },
    ])
    const texts = context.claims.map((claim) => claim.text)
    for (const year of ['2019', '2020', '2021', '2022']) {
      expect(texts.some((text) => text.includes(year))).toBe(true)
    }
    expect(texts).toContain('In 2022 the value was 4 bn.')
    expect(exemplarContext(stat).claims.map((claim) => claim.text)).toContain('The figure is 1.2bn.')
    expect(new Set(context.claims.map((claim) => claim.id)).size).toBe(context.claims.length)
  })

  it('builds a chart brief for a chart technique and a graphic brief otherwise, citing every claim', () => {
    const chart = exemplarBrief(bar, exemplarContext(bar))
    expect(chart.type).toBe('chart')
    if (chart.type === 'chart') {
      expect(chart.chartKind).toBe('bar')
      expect(chart.series).toEqual(bar.slot.data!.series)
      expect(chart.takeaway).toBe(bar.slot.data!.takeaway)
      expect(chart.dataRefs.length).toBeGreaterThan(0)
    }
    const graphic = exemplarBrief(stat, exemplarContext(stat))
    expect(graphic.type).toBe('graphic')
    if (graphic.type === 'graphic') {
      expect(graphic.intent).toBe(stat.slot.intent)
      expect(graphic.intentClaimIds!.length).toBe(exemplarContext(stat).claims.length)
    }
  })

  it('builds the designer input with the steer and the template in a four-backtick fence, and no exemplar', () => {
    const input = exemplarInput(stat, 'const x = `tpl`\n```\n')
    expect(input.caseTitle).toBe('Exemplar')
    expect(input.words).toEqual(stat.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })))
    expect(input.wordsEstimated).toBe(false)
    expect(input.intent).toBe(stat.slot.intent)
    expect(input.intentRefs.length).toBe(exemplarContext(stat).claims.length)
    expect(input.guidance).toContain(TRANSLATE_STEER)
    expect(input.guidance).toContain('````tsx\nconst x = `tpl`\n```\n\n````')
    expect(input.exemplar).toBeUndefined()
    expect(input.current).toBeUndefined()
    expect(input.data).toBeUndefined()
    expect(exemplarInput(bar, 't').data).toEqual(bar.slot.data)
  })

  it('renders the registry in sorted order, as one import per design', () => {
    const file = renderRegistry(['stat-counter', 'bar-chart'])
    expect(file).toContain("import { DESIGN as barChart } from './bar-chart'")
    expect(file).toContain("import { DESIGN as statCounter } from './stat-counter'")
    expect(file.indexOf('barChart')).toBeLessThan(file.indexOf('statCounter'))
    expect(file).toContain("'bar-chart': barChart,")
    expect(file).toContain('export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {')
    expect(renderRegistry([])).toContain('= {}')
  })

  it('parses the cap (default 1, at most 5), --only and --model', () => {
    expect(parseExemplarArgs([])).toEqual({ cap: 1, model: 'claude-opus-5-5' })
    expect(parseExemplarArgs(['--cap', '3', '--only', 'stat-counter', '--model', 'claude-sonnet-5-5'])).toEqual({
      cap: 3,
      only: 'stat-counter',
      model: 'claude-sonnet-5-5',
    })
    expect(() => parseExemplarArgs(['--cap', '6'])).toThrow("A cap above $5 needs the owner's approval first.")
    expect(() => parseExemplarArgs(['--cap', 'abc'])).toThrow('not a valid dollar amount')
    expect(() => parseExemplarArgs(['--only', 'nope'])).toThrow('--only "nope" is not a manifest id')
  })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/exemplar-translate.test.ts`
Expected: FAIL, `./exemplar-translate` cannot be resolved.

- [ ] **Step 3: Write the pure parts**

Create `apps/web/lib/exemplar-translate.ts`:

```ts
import { createHash } from 'node:crypto'
import { MANIFEST, vendoredPath } from '@boom-busters/providers'
import type { ExemplarDesign, ExemplarEntry, GraphicDesignInput, ScriptClaim, Technique } from '@boom-busters/providers'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { ChartBrief, DesignableBrief, GraphicBrief } from '@boom-busters/schemas'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { optionalText, readRawFlags } from '@/lib/live-set-args'

/**
 * The exemplar translation's pure parts (decision 304): the hash that pins a
 * design to its vendored template, the design and registry files, the
 * synthetic context and brief the translation and the corpus test share,
 * the designer input with the steer, and the script's arguments. No file,
 * network or env access here; `scripts/translate-exemplars.ts` does the
 * reading, the calls and the writing.
 */

export const TRANSLATE_STEER =
  'Translate this Remotion template into the sandbox, keeping its technique and its timing idea; ' +
  'the words and figures come from the slot; every curve, length and spring from the tokens. ' +
  'Write it as function Graphic(props) with helpers beside it, colours from props.brand.colors, ' +
  'type from props.brand.fonts, and nothing imported:'

export const EXEMPLAR_PROJECT_ID = '01J00000000000000000000EXP'
export const EXEMPLAR_LOGO = { id: '01J00000000000000000000EX1', title: 'Acme', width: 1200, height: 400 }
const CAP_ABOVE_FIVE = "A cap above $5 needs the owner's approval first."

/** SHA-256 of the text with CRLF folded to LF, so Windows and Linux checkouts agree. */
export function vendoredHash(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
}

export function designHeader(entry: ExemplarEntry, hash: string): string {
  return (
    `// Exemplar "${entry.id}" (decision 304), translated from ${vendoredPath(entry)}\n` +
    `// vendored sha256: ${hash}\n` +
    '// Written by apps/web/scripts/translate-exemplars.ts; a passing design under graphicCodeIssue.'
  )
}

/** The design file: the header, then the design with its source as a JSON string (backticks and ${ stay literal). */
export function renderDesignFile(entry: ExemplarEntry, hash: string, design: ExemplarDesign): string {
  return (
    `${designHeader(entry, hash)}\n` +
    `import type { ExemplarDesign } from './index'\n\n` +
    `export const DESIGN: ExemplarDesign = {\n` +
    `  title: ${JSON.stringify(design.title)},\n` +
    `  source: ${JSON.stringify(design.source)},\n` +
    `  facts: ${JSON.stringify(design.facts)},\n` +
    `}\n`
  )
}

/** The hash a design file's header records, or null when the file has none. */
export function storedHash(designFile: string): string | null {
  return /^\/\/ vendored sha256: ([0-9a-f]{64})$/m.exec(designFile)?.[1] ?? null
}

/** A sentence when the stored design was written from a different vendored text; null otherwise. */
export function staleDesign(
  entry: ExemplarEntry,
  vendoredText: string,
  designFile: string | undefined,
): string | null {
  if (designFile === undefined) return null
  if (storedHash(designFile) === vendoredHash(vendoredText)) return null
  return `${entry.id}: ${vendoredPath(entry)} changed since its design was written`
}

/** A ULID-shaped id for the n-th derived claim. */
const claimId = (n: number) => `01J${String(n).padStart(23, '0')}`

/**
 * The context the translation and the corpus test share: one claim per
 * figure the slot speaks ("The figure is 1.2bn.") and per charted point
 * ("In 2022 the value was 4 bn."), one placeholder logo, no paragraphs.
 */
export function exemplarContext(entry: ExemplarEntry): GraphicDesignContext {
  const texts: string[] = []
  for (const word of entry.slot.words) {
    const figure = word.text.replace(/^[^\d$€£]+|[^\w%]+$/g, '')
    if (/\d/.test(figure)) texts.push(`The figure is ${figure}.`)
  }
  for (const series of entry.slot.data?.series ?? []) {
    for (const point of series.points) {
      texts.push(`In ${point.x} the value was ${point.y} ${series.unit}.`)
    }
  }
  const claims: ScriptClaim[] = [...new Set(texts)].map((text, index) => ({
    id: claimId(index + 1),
    text,
    sourceUrl: null,
    confidence: 'high',
  }))
  return {
    projectId: EXEMPLAR_PROJECT_ID,
    caseTitle: 'Exemplar',
    claims,
    logos: [EXEMPLAR_LOGO],
    paragraphs: [],
    chapterTitle: entry.technique,
  }
}

/** The brief the checks are run against: a chart brief for a chart technique, a graphic brief otherwise. */
export function exemplarBrief(entry: ExemplarEntry, context: GraphicDesignContext): DesignableBrief {
  const coversText = entry.slot.words.map((word) => word.text).join(' ')
  const claimIds = context.claims.map((claim) => claim.id)
  if (entry.chart && entry.slot.data) {
    const chart: ChartBrief = {
      type: 'chart',
      coversText,
      description: entry.description,
      motion: { kind: 'static' },
      transition: 'cut',
      chartKind: entry.chart.kind,
      series: entry.slot.data.series,
      dataRefs: claimIds,
      takeaway: entry.slot.data.takeaway,
      reveal: 'draw-on',
      ...(entry.slot.data.annotations ? { annotations: entry.slot.data.annotations } : {}),
    }
    return chart
  }
  const graphic: GraphicBrief = {
    type: 'graphic',
    coversText,
    description: entry.description,
    motion: { kind: 'static' },
    transition: 'cut',
    intent: entry.slot.intent,
    intentClaimIds: claimIds,
  }
  return graphic
}

/** The designer's input for a translation: the synthetic slot, the steer with the template, and no exemplar. */
export function exemplarInput(entry: ExemplarEntry, vendoredText: string): GraphicDesignInput {
  const context = exemplarContext(entry)
  const coversText = entry.slot.words.map((word) => word.text).join(' ')
  return {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText,
    paragraphText: coversText,
    durationMs: entry.slot.durationMs,
    words: entry.slot.words.map((word) => ({ text: word.text, offsetMs: word.atMs })),
    wordsEstimated: false,
    intent: entry.slot.intent,
    intentRefs: context.claims.map((_, index) => index + 1),
    ...(entry.slot.data ? { data: entry.slot.data } : {}),
    guidance: `${TRANSLATE_STEER}\n\`\`\`\`tsx\n${vendoredText}\n\`\`\`\``,
  }
}

/** `designs/index.ts` for the given design ids, sorted, one import each. */
export function renderRegistry(ids: readonly string[]): string {
  const sorted = [...ids].sort()
  const camel = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  const header =
    "import type { Technique } from '../manifest'\n\n" +
    '/**\n' +
    ' * Every stored design, by technique. Generated by\n' +
    ' * `apps/web/scripts/translate-exemplars.ts`, which rewrites this file from\n' +
    ' * the `designs/*.ts` files present; the corpus test checks the two agree.\n' +
    ' */\n' +
    'export interface ExemplarDesign {\n  title: string\n  source: string\n  facts: { text: string; claim: number }[]\n}\n\n'
  if (sorted.length === 0) {
    return `${header}export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {}\n`
  }
  const imports = sorted.map((id) => `import { DESIGN as ${camel(id)} } from './${id}'`).join('\n')
  const entries = sorted.map((id) => `  '${id}': ${camel(id)},`).join('\n')
  return (
    `${imports}\n${header}` +
    `export const DESIGNS: Partial<Record<Technique, ExemplarDesign>> = {\n${entries}\n}\n`
  )
}

export interface ExemplarArgs {
  cap: number
  only?: Technique
  model: string
}

export function parseExemplarArgs(argv: readonly string[]): ExemplarArgs {
  const raw = readRawFlags(argv)
  const capRaw = raw.cap
  let cap = 1
  if (capRaw !== undefined && capRaw.trim() !== '') {
    cap = Number(capRaw)
    if (!Number.isFinite(cap) || cap <= 0) {
      throw new Error(`--cap "${capRaw}" is not a valid dollar amount; give a number greater than 0.`)
    }
    if (cap > 5) throw new Error(CAP_ABOVE_FIVE)
  }
  const only = optionalText(raw, 'only')
  if (only !== undefined && !MANIFEST.some((entry) => entry.id === only)) {
    throw new Error(`--only "${only}" is not a manifest id`)
  }
  const model = optionalText(raw, 'model') ?? DEFAULT_SETTINGS.modelRouting.graphics.model
  return { cap, model, ...(only !== undefined ? { only: only as Technique } : {}) }
}
```

Note: `renderRegistry` places the imports before the header comment because the file's imports must come first; the registry Task 1 wrote by hand is the `sorted.length === 0` form of this function. Confirm the two are identical after this task by running `renderRegistry([])` in the test above against the file on disk, adding to the registry test:

```ts
    expect(renderRegistry([])).toBe(
      readFileSync(new URL('../../../packages/providers/src/exemplars/designs/index.ts', import.meta.url), 'utf8'),
    )
```

(with `import { readFileSync } from 'node:fs'`); if the two differ by whitespace, make the hand-written file match `renderRegistry([])` exactly, since the script will overwrite it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/exemplar-translate.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the script and its npm entry**

Create `apps/web/scripts/translate-exemplars.ts`:

```ts
#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { anthropic, buildGraphicRequest, findModel, MANIFEST, mockProvidersEnabled, parseGraphicCode, priceOf, vendoredPath } from '@boom-busters/providers'
import type { ExemplarEntry, LLMTaskRequest } from '@boom-busters/providers'
import { ValidationError } from '@boom-busters/schemas'
import { callForAnswer } from '@/lib/answer'
import {
  exemplarBrief,
  exemplarContext,
  exemplarInput,
  parseExemplarArgs,
  renderDesignFile,
  renderRegistry,
  staleDesign,
  vendoredHash,
} from '@/lib/exemplar-translate'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'

/**
 * The exemplar translation job (decision 304): for each manifest entry with
 * no stored design, or whose vendored template changed, ask the graphics
 * model to translate the template into a sandbox design through the
 * designer's own prompt and ladder, check the answer with the real
 * `graphicCodeIssue`, and write a passing design to `designs/<id>.ts`.
 *
 * Never part of `pnpm test`: it needs a real Anthropic key and spends
 * money, under a `LiveBudget` cap (default $1, at most $5). It writes
 * nothing to any database and does not record to the app's cost ledger;
 * the console is the record. It never edits the manifest and never writes
 * a design the checks refused.
 */

/** A reserve never drops below this: a translation reads a long template and writes a long design. */
const MIN_RESERVE_USD = 0.05

const EXEMPLARS_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'packages', 'providers', 'src', 'exemplars')
const DESIGNS_DIR = path.join(EXEMPLARS_DIR, 'designs')

function designFileOf(entry: ExemplarEntry): string | undefined {
  const file = path.join(DESIGNS_DIR, `${entry.id}.ts`)
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined
}

function storedIds(): string[] {
  return readdirSync(DESIGNS_DIR)
    .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
    .map((name) => name.slice(0, -3))
}

/** Roughly four characters a token, over the system prompt and every message. */
function promptTokens(request: LLMTaskRequest): number {
  const chars = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0)
  return Math.ceil(chars / 4)
}

async function main(): Promise<void> {
  const args = parseExemplarArgs(process.argv.slice(2))
  if (mockProvidersEnabled()) throw new Error('MOCK_PROVIDERS is set; the translation needs the real model. Nothing was spent.')
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Set ANTHROPIC_API_KEY in .env.local. Nothing was spent.')
  const model = findModel(anthropic, args.model)
  if (!model) throw new Error(`${args.model} is not an Anthropic model this build knows. Nothing was spent.`)
  const budget = new LiveBudget(args.cap)

  const entries = MANIFEST.filter((entry) => args.only === undefined || entry.id === args.only)
  const failed: string[] = []
  for (const entry of entries) {
    const vendoredText = readFileSync(path.join(EXEMPLARS_DIR, vendoredPath(entry)), 'utf8')
    const existing = designFileOf(entry)
    const stale = staleDesign(entry, vendoredText, existing)
    if (existing !== undefined && stale === null && args.only === undefined) {
      console.log(`${entry.id}: stored and current, skipped`)
      continue
    }
    if (stale !== null) console.log(stale)
    const context = exemplarContext(entry)
    const brief = exemplarBrief(entry, context)
    const words = entry.slot.words.map((word) => ({ text: word.text, atMs: word.atMs }))
    const input = exemplarInput(entry, vendoredText)
    let calls = 0
    try {
      const answer = await callForAnswer({
        request: buildGraphicRequest(input),
        parse: (text, note) => {
          const checked = graphicCodeIssue(parseGraphicCode(text, note), context, {
            brief,
            durationMs: entry.slot.durationMs,
            words,
          })
          if ('issue' in checked) throw new ValidationError(checked.issue, { field: 'graphic code' })
          return checked.code
        },
        complete: async (request, call) => {
          calls += 1
          const label = `${entry.id} ${call}`
          const estimate = priceOf(model, { inputTokens: promptTokens(request), outputTokens: request.maxTokens })
          budget.reserve(label, Math.max(MIN_RESERVE_USD, estimate))
          try {
            const result = await anthropic.complete(request, { apiKey, model: model.id })
            budget.record(label, priceOf(model, result.usage))
            return { text: result.text, truncated: result.truncated }
          } catch (error) {
            budget.record(label, 0)
            throw error
          }
        },
        retryWithReason: (reason) => buildGraphicRequest({ ...input, rejection: reason }),
      })
      if (!answer.ok) {
        failed.push(entry.id)
        console.log(`${entry.id}: refused after ${answer.calls} call(s): ${answer.issue}`)
        continue
      }
      // The stored design keeps its facts as claim numbers against the derived
      // claims, which are deterministic per entry, so the corpus gate can
      // re-run the facts check without the model.
      const file = renderDesignFile(entry, vendoredHash(vendoredText), {
        title: answer.value.title,
        source: answer.value.source,
        facts: answer.value.facts.map((fact) => ({
          text: fact.text,
          claim: context.claims.findIndex((claim) => claim.id === fact.claimId) + 1,
        })),
      })
      writeFileSync(path.join(DESIGNS_DIR, `${entry.id}.ts`), file)
      writeFileSync(path.join(DESIGNS_DIR, 'index.ts'), renderRegistry(storedIds()))
      console.log(`${entry.id}: stored "${answer.value.title}" after ${calls} call(s); spent so far $${budget.spentUsd.toFixed(2)}`)
    } catch (error) {
      if (error instanceof BudgetExceeded) {
        console.log(`${entry.id}: ${error.message}`)
        failed.push(entry.id)
        break
      }
      throw error
    }
  }
  console.log(`Done. Spent $${budget.spentUsd.toFixed(2)} of $${args.cap.toFixed(2)}.`)
  for (const item of budget.entries) console.log(`  ${item.label}: $${item.usd.toFixed(4)}${item.settled ? '' : ' (reserved)'}`)
  if (failed.length > 0) {
    console.log(`Not stored: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
```

Add to `apps/web/package.json` `scripts`, after `live:plan`:

```json
    "live:exemplars": "tsx --env-file=../../.env.local scripts/translate-exemplars.ts",
```

The `ExemplarDesign` type the design files import (`import type { ExemplarDesign } from './index'`) is the one the registry exports; confirm `renderDesignFile`'s import line resolves (`designs/index.ts` exports `ExemplarDesign`).

- [ ] **Step 6: Typecheck, lint, format and a dry run of the script's refusals**

Run: `pnpm --filter @boom-busters/web typecheck && pnpm exec eslint --max-warnings 0 apps/web/scripts/translate-exemplars.ts apps/web/lib/exemplar-translate.ts apps/web/lib/exemplar-translate.test.ts && pnpm exec prettier --check apps/web/scripts/translate-exemplars.ts apps/web/lib/exemplar-translate.ts apps/web/lib/exemplar-translate.test.ts apps/web/package.json`
Expected: no errors; all formatted.

Run, from `apps/web`, with no key available: `MOCK_PROVIDERS=1 pnpm exec tsx scripts/translate-exemplars.ts --cap 1`
Expected: prints `MOCK_PROVIDERS is set; the translation needs the real model. Nothing was spent.` and exits 1. Then `ANTHROPIC_API_KEY= pnpm exec tsx scripts/translate-exemplars.ts` without the env file: prints `Set ANTHROPIC_API_KEY in .env.local. Nothing was spent.` and exits 1. No design file appears in `packages/providers/src/exemplars/designs/`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/exemplar-translate.ts apps/web/lib/exemplar-translate.test.ts apps/web/scripts/translate-exemplars.ts apps/web/package.json packages/providers/src/exemplars/designs/index.ts
git commit -m "feat(web): the exemplar translation job, under a budget cap, gated by the real checks (decision 304)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The corpus gate, PROGRESS and the whole suite

**Files:**
- Create: `apps/web/lib/graphic-code/exemplars.test.ts`
- Modify: `PROGRESS.md` (a new decision entry)

**Interfaces:**
- Consumes: everything above.
- Produces: the corpus gate and the record of decision 304.

- [ ] **Step 1: Write the corpus gate**

Create `apps/web/lib/graphic-code/exemplars.test.ts`:

```ts
// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGNS, MANIFEST, vendoredPath } from '@boom-busters/providers'
import { exemplarBrief, exemplarContext, staleDesign } from '@/lib/exemplar-translate'
import { graphicCodeIssue } from './check'

/**
 * The corpus gate (decision 304): every stored exemplar is a design the
 * checks pass, with its synthetic slot, in both frames; and every design was
 * written from the vendored template as it is now. With no designs stored
 * the gate passes over nothing, and says so.
 */
const EXEMPLARS = new URL('../../../../packages/providers/src/exemplars/', import.meta.url)
const stored = MANIFEST.filter((entry) => DESIGNS[entry.technique] !== undefined)

describe(`the exemplar corpus (decision 304): ${stored.length} of ${MANIFEST.length} designs stored`, () => {
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
```

The facts are the model's own, stored on the design as claim numbers against the derived claims (which `exemplarContext` makes deterministically per entry), because `graphicFactsIssue` refuses any shown digit group that no cited claim contains: with no facts the gate would refuse every design that shows a figure.

- [ ] **Step 2: Run the gate**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/exemplars.test.ts`
Expected: PASS with the describe name reading `0 of 18 designs stored`, one test run (the registry check) and the `it.each` over zero entries. If vitest refuses an empty `it.each` table, guard it: `if (stored.length > 0) it.each(...)` with a sibling `it('stores no design yet', () => expect(stored).toHaveLength(0))` under `else`.

- [ ] **Step 3: Write the PROGRESS entry**

Check the number: `git fetch origin && git show origin/master:PROGRESS.md | grep -o "^30[0-9]\. " | sort -u | tail -1`. Use the next free number (304 if 303 is the last); if it is not 304, use the free one here and in the spec's and plan's titles. Add after the last numbered entry:

```markdown
304. **The designer gets an exemplar of the slot's technique** (2026-10-14,
     owner: "proceed" to sub-project 2 of the motion engine research;
     rulings: exemplars translated into the house dialect, tags matched from
     the brief, about sixteen to start, a paid translation job gated by the
     checks). The prompt's two worked examples were the only shapes the
     designer had; every design patterned on one of them. The research
     recommended MIT-licensed Remotion templates as few-shot exemplars,
     retrieved per request.
     What shipped. `packages/providers/src/exemplars/`: a manifest of
     eighteen techniques (stat and KPI counters, bar, line, racing,
     comparison and donut charts, progress bars and steps, kinetic word
     stack, typewriter, text highlight, quote card, animated list, lower
     third, chapter title, logo reveal, split screen), each naming its
     template in `RenderComp/free-remotion-templates` (f648980) or
     `reactvideoeditor/remotion-templates` (6209b72), vendored byte for byte
     as `.tsx.txt` with each repository's MIT notice beside it, and a small
     synthetic slot. `techniqueFor` maps a brief to a technique by fixed
     rules (the steer first; a chart by its kind and shape; a graphic by
     quotation, percentage, versus, a logo title, figures with units, a short
     intent, else the word stack); `exemplarFor` returns the stored design or
     nothing. `designGraphicWith` fills `exemplar` on the request and
     `buildGraphicRequest` renders it in the slot message after the data, so
     the cached system prompt is untouched. The translation job
     (`pnpm --filter @boom-busters/web live:exemplars -- --cap <usd>`) sends
     each template through the designer's own prompt and ladder, keeps only a
     design `graphicCodeIssue` passes, writes it to `designs/` with the
     vendored file's hash, and regenerates the registry; a corpus test re-runs
     every stored design through the checks and fails on a stale hash.
     Decisions made where the spec left room: the vendored files carry a
     `.txt` suffix and a `.prettierignore` line so no tool reformats them;
     the hash folds CRLF to LF; `chapter-title`, `typewriter`,
     `animated-list`, `lower-third` and `progress-bars` are reached by the
     steer only, since the designer does not know a slot's place in its
     chapter and the rest are the producer's choices; the cap parser allows
     up to $5 on the owner's word in the brainstorm, above the live
     harnesses' $1.
     Rollout, step one: this merge, with an empty corpus; nothing changes for
     the designer. Step two, on the owner's go-ahead: the live run, each
     design looked at, a second commit, a Vercel deploy and
     `PUT /api/inngest`. No migration, no Lambda or broker deploy.
     The number 304 is checked against `origin/master` at the merge.
```

- [ ] **Step 4: Run the whole suite, lint, typecheck and format**

Run: `pnpm typecheck` then `pnpm exec eslint --max-warnings 0 $(git diff --name-only master..HEAD | grep -E '\.(ts|tsx)$' | grep -v vendored)` (lint on the changed files; `pnpm lint` over the whole tree is polluted by other sessions' worktrees under `.claude/worktrees`).
Expected: no errors.

Run: `pnpm test` (Docker Desktop running for the web app's database suites; timeout 600000). If a compositions golden fails under the full run, re-run `pnpm --filter @boom-busters/compositions test` alone before believing it.
Expected: PASS.

Run: `git ls-files -z | xargs -0 -n 80 pnpm exec prettier --check` and confirm no file under `exemplars/vendored` is reported as unformatted (it is ignored).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/graphic-code/exemplars.test.ts PROGRESS.md
git commit -m "test(web): the exemplar corpus gate; PROGRESS records decision 304

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the plan

Not part of any task; the owner's calls:

- Merge `exemplar-corpus` into `master` after the final review, with the number re-checked against `origin/master`; push.
- Step two of the rollout, on the owner's go-ahead with a cap: `pnpm --filter @boom-busters/web live:exemplars -- --cap 5` from a checkout with `ANTHROPIC_API_KEY` in `.env.local`; run `pnpm exec prettier --write packages/providers/src/exemplars/designs` (the script writes plain text; CI gates on Prettier); read each `designs/<id>.ts` (or view it on the board through a temporary brief); run `pnpm --filter @boom-busters/web exec vitest run lib/graphic-code/exemplars.test.ts` to see the gate pass over the stored designs; commit `designs/`; deploy (Vercel, then `PUT /api/inngest`).
