# An exemplar corpus for the graphics designer (decision 304)

Status: approved by the owner in conversation on 2026-10-14, section by
section; sub-project 2 of the motion engine research (sub-project 1 shipped
as decision 301). The number is provisional (301 to 303 are taken by parallel sessions,
302 and 303 twice each) and is checked again at the merge.

## 1. The problem

Decision 301 put the designer's motion on tokens and gave it Remotion's own
rules. Its prompt still carries only two worked examples, a kinetic-type
beat and a bar chart, so every design patterns on one of those two. The
research the owner commissioned recommends a corpus of MIT-licensed Remotion
templates as few-shot exemplars, retrieved per request: the model should see
a worked example of the technique the slot calls for (a racing chart, a stat
counter, a lower third) and produce that technique, still inside the sandbox
and on the tokens.

Read-only exploration of the two repositories on 2026-10-14:

- `RenderComp/free-remotion-templates` at commit f648980: 53 components, 80
  to 510 lines each, MIT with a LICENSE file (Trimora Inc).
- `reactvideoeditor/remotion-templates` at commit 6209b72: 81 templates, 45
  to 230 lines each, MIT by the README's statement; the repository has no
  LICENSE file.
- None would pass the sandbox as written: every file imports, nearly every
  file writes hex colours, half use `spring` with their own configs, and
  RenderComp uses `Easing.*` freely. Fed raw, they teach the forms the scan
  refuses.
- The techniques a finance documentary uses are about eighteen of the 134;
  the rest are transitions, particles, galleries and social widgets.

### 1.1 The decision

Owner's rulings, 2026-10-14:

- The exemplars reach the model translated into the house dialect: each a
  sandbox design on the tokens and the brand props, run through the real
  checks, stored with its source hash and licence.
- Retrieval is tags matched from the brief, deterministic, no model call,
  no new brief field.
- The first corpus is about sixteen, one per technique the channel uses.
- Approach A: a paid translation job, run on the owner's go-ahead under a
  budget cap, whose output is gated by `graphicCodeIssue` and by an offline
  test that re-runs every stored design through the checks.

## 2. The corpus

Everything lives in `packages/providers/src/exemplars/`, beside the prompts
that use it.

### 2.1 Files

- `manifest.ts`: one hand-written entry per exemplar.
  - `id`: kebab-case, the technique name.
  - `technique`: one of `TECHNIQUES` (2.2).
  - `description`: one line the prompt shows.
  - `source`: `{ repo: 'rendercomp' | 'rve', path, commit }`.
  - `slot`: a synthetic slot the translation and the test both use:
    `durationMs`, `words` (`{ text, atMs }[]`), and for chart techniques
    `data` (`series`, `takeaway`, one `annotation`). Its claims are derived
    (2.4), so no claim list is hand-written.
- `vendored/rendercomp/<File>.tsx`, `vendored/rve/<file>.tsx`: the original
  template text byte for byte. `vendored/rendercomp/LICENSE` is the
  repository's MIT file; `vendored/rve/LICENSE` is written by hand: the MIT
  licence text, the README's statement quoted, the repository URL, the
  commit and the date fetched. The vendored files are never shown to the
  model; they are provenance and the translation's input.
- `designs/<id>.ts`: the translated exemplar, `export const DESIGN = { title,
  source }`, the source a sandbox design on the tokens. Its header comment
  names the vendored file and the SHA-256 of its text, so a changed vendored
  file is visible and the test (5) can say the design is stale.
- `index.ts`: `EXEMPLARS` (the manifest joined with whatever designs exist),
  `TECHNIQUES`, `techniqueFor(input)` (4) and `exemplarFor(technique)`,
  which returns `{ technique, description, source, title }` or `undefined`
  when no design is stored.

### 2.2 The techniques and their templates

| technique | template (repo, file) |
| --- | --- |
| `stat-counter` | rve `templates/stat-counter.tsx` |
| `kpi-counter` | rendercomp `src/components/kpi-counter/KpiCounter.tsx` |
| `bar-chart` | rendercomp `src/components/bar-chart-anim/BarChartAnim.tsx` |
| `line-chart` | rendercomp `src/components/line-chart-anim/LineChartAnim.tsx` |
| `racing-chart` | rendercomp `src/components/racing-chart/RacingChart.tsx` |
| `comparison-chart` | rve `templates/comparison-chart.tsx` |
| `donut-chart` | rve `templates/donut-chart.tsx` |
| `progress-bars` | rve `templates/progress-bars.tsx` |
| `progress-steps` | rve `templates/progress-steps.tsx` |
| `kinetic-word-stack` | rendercomp `src/components/kinetic-word-stack/KineticWordStack.tsx` |
| `typewriter` | rendercomp `src/components/typewriter/Typewriter.tsx` |
| `text-highlight` | rve `templates/text-highlight.tsx` |
| `quote-card` | rve `templates/quote-card.tsx` |
| `animated-list` | rve `templates/animated-list.tsx` |
| `lower-third` | rve `templates/lower-third.tsx` |
| `chapter-title` | rendercomp `src/components/chapter-title/ChapterTitle.tsx` |
| `logo-reveal` | rendercomp `src/components/logo-split-reveal/LogoSplitReveal.tsx` |
| `split-screen` | rve `templates/split-screen.tsx` |

Eighteen entries. The manifest is the list; the prompt never depends on the
count, and a technique with no stored design is simply not shown.

### 2.3 What makes a design stored

A design is stored only when `graphicCodeIssue` passes it with its synthetic
slot, in both frames: the scan (tokens only), the dry run (no crash, no dead
air, inside the safe area, under the frame budget) and the facts. The test
in section 5 re-runs that offline on every design, so the corpus cannot
drift from the checks.

### 2.4 The synthetic context

`exemplarContext(entry)` builds the `GraphicDesignContext` the translation
and the test share: `caseTitle` "Exemplar", `chapterTitle` the technique,
one claim per figure in the slot (each word that carries digits becomes a
claim sentence "The figure is <word>.", and for a chart each point becomes
"In <x> the value was <y> <unit>."), the logo list `['Acme']` with a
1200 by 400 placeholder mark so a logo technique has a mark to draw, and no
paragraphs. The `facts` the model cites must then resolve against these
claims, which is the same discipline a real slot imposes.

## 3. The translation job

`apps/web/scripts/translate-exemplars.ts`, run as
`pnpm --filter @boom-busters/web live:exemplars -- --cap <usd> [--only <id>]`,
in the shape of `live-set-test.ts`: real providers from `.env.local`, a
`LiveBudget` it refuses to pass, every call ledgered. It runs only on the
owner's go-ahead; mock mode makes no calls and the script refuses to start
under `MOCK_PROVIDERS=1`.

For each manifest entry (or the one named) with no design, or whose vendored
hash no longer matches its design's header:

1. Build the designer's request with `buildGraphicRequest` for the synthetic
   slot and context: the real system prompt, the film message (the derived
   claims and the placeholder logo), the slot message, and as the steer:
   "Translate this Remotion template into the sandbox, keeping its technique
   and its timing idea; the words and figures come from the slot; every
   curve, length and spring from the tokens." followed by the vendored
   template in a fenced block. No exemplar block is attached (4.3): the
   corpus is not its own input.
2. Answer with the designer's ladder (one answer, one retry told the
   refusal), parsed by `parseGraphicCode`, checked by `graphicCodeIssue`
   against `exemplarContext(entry)`.
3. Write a passing design to `designs/<id>.ts` with the vendored hash in its
   header and the model's title. Report a refused one with both refusals and
   write nothing; continue with the next entry; exit non-zero at the end if
   any failed.

The model is the graphics route's model from Settings, so the exemplars are
in the dialect the designer speaks. Expected cost: one or two calls per
exemplar at the graphics answer budget; under five dollars for the set, and
the cap stops it first.

The script never edits the manifest, never writes a failing design, and
never runs in CI. Its pure parts (hashing, header rendering, the
needs-translation decision, `exemplarContext`) are unit-tested; the model
path is exercised by the live run.

## 4. Retrieval and the prompt

### 4.1 `techniqueFor`

A pure function in `exemplars/index.ts`, no model call, deterministic:

```
techniqueFor(input: {
  type: 'graphic' | 'chart'
  chartKind?: ChartKind
  seriesCount?: number
  pointCount?: number
  intent: string
  description: string
  coversText: string
  logos: readonly string[]
  guidance?: string
}): Technique
```

Rules, first match wins:

1. The steer. When `guidance` contains a technique word, that technique:
   "typewriter", "list", "lower third", "progress bar", "steps", "quote",
   "counter", "racing", "donut", "pie", "split", "chapter title", "logo",
   "highlight", "word stack" or "kinetic". `chapter-title`, `typewriter`,
   `animated-list`, `lower-third` and `progress-bars` are reached by the
   steer only: the designer does not know a slot's position in its chapter,
   and the other four are stylistic choices the producer makes.
2. A chart brief, by `chartKind`: `bar` with two or more series →
   `comparison-chart`; `bar` with one series and five or more points whose
   `x` are years → `racing-chart`; `bar` and `stacked` → `bar-chart`; `line`
   and `area` → `line-chart`; `waterfall` → `comparison-chart`.
3. A graphic brief, by keyword over `intent`, `description` and
   `coversText` joined: a pair of quotation marks (straight or curly) or
   "said", "wrote", "told" → `quote-card`; a percentage sign, "per cent",
   "percent" or "share of" → `donut-chart`; "versus", "compared", "against",
   "side by side" → `split-screen`; a title from `logos` present in the
   intent → `logo-reveal`; two or more figures with a unit (digits followed
   by bn, m, k, %, or preceded by $, €, £) → `kpi-counter`; one such figure
   → `stat-counter`; an intent of eight words or fewer → `text-highlight`;
   otherwise `kinetic-word-stack`.

One technique, one exemplar. A second exemplar of another technique is not
sent: the system prompt's two examples already give the model a second
shape.

### 4.2 The input

`GraphicDesignInput` gains `exemplar?: { technique, description, source }`.
`graphic-design-core.ts` fills it: it calls `techniqueFor` with the brief's
fields, the context's logo titles and the guidance, then `exemplarFor`; when
no design is stored the field is absent. The providers package therefore
needs no brief type, and the mock designer and older callers send nothing.

### 4.3 The slot message

After the data block and before the current design, when `exemplar` is set:

"A passing design of this technique (`<technique>`: <description>), in
this sandbox and on the tokens, to pattern on. Its words and figures are its
own; yours come from this slot and its claims:" then the design's source in
a fenced `jsx` block. On a redesign the block still appears and the current
design follows it. The system prompt does not change, so the cache holds;
the slot message grows by the exemplar, roughly 1,500 to 2,500 input tokens,
uncached, a fraction of a cent per slot.

## 5. Tests

- `apps/web/lib/graphic-code/exemplars.test.ts`, the corpus gate: every
  manifest entry's design, when stored, runs through `graphicCodeIssue` with
  its synthetic slot and `exemplarContext`, and passes; every stored design's
  header hash equals the SHA-256 of its vendored file; with zero designs the
  test passes vacuously and says so in its name.
- `packages/providers/src/exemplars/index.test.ts`: `techniqueFor` table,
  one row per rule, the ordering cases (a quote that also holds a figure is a
  quote card; a steer beats every rule), the fallthrough; `exemplarFor`
  returns the manifest's description and the stored design; every technique
  in `TECHNIQUES` has exactly one manifest entry; every manifest entry's
  vendored file exists and each vendored directory has its LICENSE; no
  description, title or design carries an em or en dash.
- `graphics.test.ts`: the slot message carries the block and the design when
  `exemplar` is set and nothing when it is not; the system prompt is byte
  for byte what it was.
- `graphic-design.test.ts`: a chart brief and a graphic brief each reach the
  request with the expected `exemplar` once a design is stored for that
  technique, and with none before.
- `translate-exemplars.test.ts`: the hash, the header, the
  needs-translation decision (no design; stale hash; `--only`), and
  `exemplarContext` (claims from words and data; the placeholder logo).

## 6. Rollout

Two steps.

1. The code: manifest, vendored files and licences, script, retrieval,
   prompt block and tests merge with an empty `designs/`. The corpus test
   passes over zero designs, `exemplarFor` returns nothing, the block is
   omitted, and nothing changes for the designer. A Vercel deploy and
   `PUT /api/inngest` are harmless but not needed for this step.
2. The live run, on the owner's go-ahead and cap: the designs land in a
   second commit after each has been looked at (the file by eye, or on the
   board through a temporary brief), and from that deploy the slot messages
   carry exemplars. A Vercel deploy and `PUT /api/inngest`. No migration, no
   Lambda or broker deploy: the stored shape of a design is unchanged.

PROGRESS records the decision under the next free number, checked against
`origin/master` at the merge.

## 7. Out of scope

- A second exemplar per slot; embedding retrieval; a planner-chosen
  technique field on the brief.
- The full forty-template corpus; the sixteen to eighteen here are the first
  batch, and the manifest is where more are added.
- Lottie and `@remotion/lottie`.
- Re-vendoring on a schedule: the hash test says when a template changed,
  and re-translation is a hand decision.
- Showing an exemplar on the board: the owner views a design by reading its
  file or by a temporary brief.
