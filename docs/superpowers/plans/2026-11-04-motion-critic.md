# Measured motion and the critic review. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The per-shot review becomes a critic: the design is photographed through its moves as well as at rest, its motion is measured as numbers, its settled text is checked for contrast, and a fresh prompt on its own model route, shown the channel's first two look references, scores the design on five axes and names the fixes worth making; one designer call applies them. The board shows the scores.

**Architecture:** `frames.ts` gains a dense sample set (at most 24 shots per orientation, evenly across the slot), mid-transition layout findings, a colour and ground per text run for a WCAG ratio, and a contact sheet per orientation screenshotted in the same page. `motion-metrics.ts` decodes the landscape dense shots with sharp and reports frozen time, simultaneity, the speed profile and the hold after the last change. A new prompt module `critic.ts` on a new `critic` route builds the critic's request (fixed head cached, images last) and parses its JSON report; `reviewGraphicWith` runs the inspection, the metrics, the critic and, on a fix, one designer call with the fixes as the producer's steer, then the checks as today. The designer's self-review path is removed outright. `MECHANISMS` is a global list the designer may name and the critic checks.

**Tech Stack:** TypeScript, Zod 4, playwright-core Chromium (`frames.ts`), sharp, Next.js server modules, React Testing Library, the lift snapshot fixtures in `packages/providers`.

**Spec:** `docs/superpowers/specs/2026-11-04-channel-motion-references-design.md`, sections 4, 8.5, 10 (10.1 to 10.4), 11 (the board's review line and the Models switch), 12.1, 12.2 (the critic route, two reference sheets at 1600 px, 24 tiles per orientation, the cached head), 13, 14. This is plan 3 of 4. Plan 1 (decision 395) built the identity and the prompt slots; plan 2 (decision 396) built the references, their readings and dense sheets, which this plan shows the critic.

## Calls the author made (check while reading)

- The metrics decode with sharp, already a web dependency used on the Inngest route (`reference-images.ts`), not a pure-JS JPEG decoder; spec 14 leaves the decoder to the builder.
- The dense set for the per-shot review is evenly spaced across the slot at `max(250 ms, duration / 24)`, capped at 24 per orientation, in both orientations; it serves the mid-transition layout check and the contact sheet. The metrics are computed from the landscape dense shots only (spec 10.1: "the shots of one orientation"). `FramesInput.dense` takes any list of moments, so plan 4's derivation can pass four per storyboard moment at 1/24 s steps.
- The contact sheet of the rendered frames is screenshotted in the inspection's own page after the orientation's samples, on the same browser launch, so the whole inspection stays inside `INSPECT_MAX_MS`. `sheetDocument` moves to a pure module both the reference sheets and the frames use.
- The dense set and the sheets are best effort: when the inspection's time is nearly spent, the result carries the rest shots it has, the dense shots taken so far and a finding saying the set was cut short; the critic still runs. A review is never skipped for want of dense shots.
- Mid-transition layout issues and contrast are findings handed to the critic, never refusals (spec 10.2, 10.3): `FramesResult.findings`. The designer's ladder keeps refusing on rest moments only.
- The ground a text run is measured against is the first ancestor that paints a background colour, else the brand background (spec 10.3); a sibling drawn behind the text is not seen. Contrast is measured at rest moments only, on text being read (opacity at least 0.5, not under a blur).
- The critic's report is stored on the design as `code.critique` (the five scores and lines, the defects, the fixes asked, whether it kept), beside `review: kept | revised` which keeps its meaning. The per-shot metrics are not stored: plan 4 stores them on exemplar versions, where a later refine reads them.
- The fix is one designer call: the design under review as `current`, the critic's three fixes as the producer's steer after any steer the redesign carried. The checks and the layout inspection run on it as today; a refused fix keeps the design, critique stored.
- The critic's default route is `claude-sonnet-5` (the bible route's model, vision-capable), per the owner's ruling that the critic runs on a cheaper model (spec 12.2). The Settings switch "Review each graphic on its rendered frames" keeps its name and its flag (`features.graphicReview`) and moves under the critic's route row.
- Mock mode keeps decision 389's rule: no browser and no review in the per-shot path. `mockCriticReport` exists for the tests and for plan 4's derivation fixture.
- `MECHANISMS` lives in `packages/schemas` beside `TECHNIQUES` (the designer's answer schema needs the enum), re-exported from the exemplars index; spec 8.5 names the providers package, and the same move was made for the technique keys in plan 1.
- Each house exemplar's mechanisms are filled by hand in the manifest from its description and its design (one to four from the list); the implementer chooses them, a test holds the bounds.
- The critic sees the first two live references tagged `look`, in position order, each with a dense sheet (a clip) or its original (a still); a channel with none gets a critic with no references. Plan 4 adds "the ones the channel's exemplar for this technique named".
- The pairwise question (two versions, order swapped) and the verify round are plan 4's; the critic input leaves room for a previous version and this plan does not build it.
- `motion_verdicts` rows (spec 11) record the owner's verdicts and are plan 4's preference ledger; the critic's keep or revise is the model's, not the owner's, and writes none.

## Global Constraints

- Paid calls run only on the owner's word and only where they ran before: the critic and its fix replace the review call that `features.graphicReview` already switches; nothing new runs on upload or on the board. Mock mode (`mockProvidersEnabled()`) runs no critic in the per-shot path (decision 389).
- The old self-review is removed, not kept beside the critic (spec 12.1): `buildGraphicReviewRequest`, `parseGraphicReview`, `GraphicReview` and the `graphics-review` lift case go.
- A reference's images go to the critic only, never to the designer's call (spec 3): `buildGraphicRequest` takes no image. Per-shot cost rises by at most two reference images, each held to 1600 px wide by `imageForModel`, and by the contact sheets, at most 24 tiles per orientation (spec 12.2).
- Vercel's 300 s stands: the review keeps `GRAPHIC_DESIGN_DEADLINE_MS` (240 s); every inspection is bounded by `INSPECT_MAX_MS` (45 s); the fix call starts only with 60 s left.
- Limits, verbatim from spec 10: dense shots capped at 24 per orientation; the metrics on 160 px wide greyscale; simultaneity over the busiest 250 ms; contrast under 3 for type of 24 px or more and under 4.5 for smaller type is a finding; the five axes scored 1 to 10 with a bar of 8; at most three fixes; a design names at most six mechanisms.
- No channel name, niche word or taste number in code (spec 3). The critic's prompt names no technique of one channel; the identity and the style guide carry the taste.
- CLAUDE.md: a branch (`motion-critic`), tests with the code, `pnpm lint` and Prettier at zero warnings before every commit, PROGRESS.md decision at the end, no secrets, button-first UI.
- Written output in prompts and UI copy carries no em or en dash (the prompt test "writes no dash a reader would see" enforces it, as plans 1 and 2 did).
- No migration in this plan: `critique` and `mechanisms` live inside the `code` jsonb a brief already carries, and the `critic` route inside `settings` jsonb with a default. If a task finds it needs one, the journal's last entry is `0047_nifty_roulette` on master at `702ae88b`.
- The web tests run with `GRAPHIC_FRAMES=off`; every test of the review path stubs `browserFrames` as `graphic-design.test.ts` does today, and the browser-backed `frames.test.ts` cases skip where no browser starts.
- Every test that renders `SettingsForm` already mocks `./motion-actions`; nothing here adds a tab or an actions module.

## Review Focus

1. A long slot or a slow host where the dense set cannot finish inside the inspection's time: the review runs on the rest shots and whatever dense shots were taken, with a finding saying so, and never skips (Task 3 test "cuts the dense set short and says so when its time is spent"; Task 6 test "runs the critic without metrics when the dense set is empty").
2. A critic answer that is not a report (a missing axis, a score of 11, prose): the design is kept unmarked by the critic, the reason logged, and nothing else is called (Task 4 test "refuses a report missing an axis or scored past ten"; Task 6 test "keeps the design and logs when the critic's report is malformed").
3. A channel with no look references, or whose look references are stills, or storage off: the critic runs with none, a still's original stands in for its sheet, and the request never fails on a missing object (Task 7 tests "hands the critic the first two look references in order, a still by its original" and "gives no references when storage is off or an object is missing").
4. A fix the checks or the layout refuse: the design is kept with the critique stored, so the board shows the scores even though nothing changed (Task 6 test "keeps the design with its critique when the fix is refused"; Task 8 test "shows the critic's scores on a kept design").
5. Text on a transparent ground over the brand background: the ratio is measured against the brand background, never reported as unreadable or skipped (Task 3 test "measures against the brand background when no ancestor paints one").

---

### Task 1: The critic's schemas, the mechanisms and the route

**Files:**
- Create: `packages/schemas/src/critic.ts`
- Create: `packages/schemas/src/mechanisms.ts`
- Modify: `packages/schemas/src/settings.ts` (`LLM_TASKS`, `DEFAULT_CRITIC_ROUTE`, `ModelRoutingSchema.critic`, `DEFAULT_SETTINGS.modelRouting.critic`)
- Modify: `packages/schemas/src/graphic-code.ts` (`mechanisms` on both code schemas, `critique` on the stored one)
- Modify: `packages/schemas/src/index.ts` (export both modules)
- Test: `packages/schemas/src/critic.test.ts`, `packages/schemas/src/mechanisms.test.ts`, `packages/schemas/src/settings.test.ts` (one describe), `packages/schemas/src/graphic-code.test.ts` (two cases)

**Interfaces:**
- Produces: `MECHANISMS: readonly { key: Mechanism; definition: string }[]` with exactly these sixteen keys in this order: `persistent-actor`, `foreground-becomes-transition`, `cause-to-effect`, `density-from-hierarchy`, `change-of-speed`, `hard-cut`, `word-splits-open`, `docking`, `drum`, `reel`, `draw-on`, `rise-from-baseline`, `tally`, `door`, `marker-stroke`, `camera-push`; `MECHANISM_KEYS` (the keys as a tuple), `MechanismSchema = z.enum(MECHANISM_KEYS)`, `Mechanism`, `MECHANISMS_PER_DESIGN_MAX = 6`, `mechanismName(key): string` (the key with its hyphens as spaces: "persistent actor").
- Produces: `CRITIC_AXES = ['engagement', 'intent', 'composition', 'temporal', 'craft'] as const`, `CriticAxis`, `CRITIC_BAR = 8`, `CRITIC_LINE_MAX = 200`, `CRITIC_FIXES_MAX = 3`, `CRITIC_FIX_MAX = 300`, `CRITIC_DEFECTS_MAX = 8`, `CriticScoreSchema = z.object({ score: z.number().int().min(1).max(10), line: z.string().trim().min(1).max(CRITIC_LINE_MAX) })`, `CriticReportSchema = z.object({ scores: z.object({ engagement, intent, composition, temporal, craft }) (each CriticScoreSchema), defects: z.array(z.object({ atMs: z.number().int().min(0), orientation: z.enum(['landscape', 'portrait']), text: z.string().trim().min(1).max(CRITIC_LINE_MAX) })).max(CRITIC_DEFECTS_MAX), fixes: z.array(z.string().trim().min(1).max(CRITIC_FIX_MAX)).max(CRITIC_FIXES_MAX), mechanisms: z.array(z.object({ key: MechanismSchema, present: z.boolean() })).max(MECHANISMS_PER_DESIGN_MAX), keep: z.boolean() })`, `CriticReport`, `criticPasses(report): boolean` (every axis at or above `CRITIC_BAR`).
- Produces: `MotionMetricsSchema = z.object({ frozenMs: int min 0, longestFrozenMs: int min 0, frozenCritical: boolean, simultaneity: number min 0 max 1, holdAfterLastMs: int min 0, speedProfile: z.array(z.object({ atMs: int min 0, change: number min 0 })).max(64) })`, `MotionMetrics`.
- Produces: `'critic'` in `LLM_TASKS` after `'graphics'`; `DEFAULT_CRITIC_ROUTE = { provider: 'anthropic', model: 'claude-sonnet-5' } as const`; `ModelRoutingSchema.critic: ModelRefSchema.default(DEFAULT_CRITIC_ROUTE)`; `PlannedGraphicCodeSchema.mechanisms` and `GraphicCodeSchema.mechanisms`: `z.array(MechanismSchema).max(MECHANISMS_PER_DESIGN_MAX).optional()`; `GraphicCodeSchema.critique: CriticReportSchema.optional()`.

- [ ] **Step 1: Write the failing tests**

`mechanisms.test.ts`:

```ts
it('lists sixteen unique kebab-case keys, each with a one-line definition', () => {
  expect(MECHANISMS).toHaveLength(16)
  expect(new Set(MECHANISMS.map((m) => m.key)).size).toBe(16)
  for (const { key, definition } of MECHANISMS) {
    expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/)
    expect(definition.length).toBeLessThanOrEqual(140)
    expect(definition).not.toMatch(/[–—]/)
  }
  expect(mechanismName('rise-from-baseline')).toBe('rise from baseline')
})
```

`critic.test.ts`:

```ts
const report = { scores: Object.fromEntries(CRITIC_AXES.map((a) => [a, { score: 8, line: 'fine' }])), defects: [], fixes: [], mechanisms: [], keep: true }
it('accepts a full report and refuses a score past ten or a missing axis', () => {
  expect(CriticReportSchema.safeParse(report).success).toBe(true)
  expect(CriticReportSchema.safeParse({ ...report, scores: { ...report.scores, craft: { score: 11, line: 'x' } } }).success).toBe(false)
  const { craft: _c, ...four } = report.scores
  expect(CriticReportSchema.safeParse({ ...report, scores: four }).success).toBe(false)
})
it('passes at the bar on every axis and not one under it', () => {
  expect(criticPasses(CriticReportSchema.parse(report))).toBe(true)
  expect(criticPasses(CriticReportSchema.parse({ ...report, scores: { ...report.scores, temporal: { score: 7, line: 'late' } } }))).toBe(false)
})
it('caps fixes at three and defects at eight', () => {
  expect(CriticReportSchema.safeParse({ ...report, fixes: ['a', 'b', 'c', 'd'] }).success).toBe(false)
})
it('holds motion metrics with simultaneity inside 0 to 1', () => {
  expect(MotionMetricsSchema.safeParse({ frozenMs: 0, longestFrozenMs: 0, frozenCritical: false, simultaneity: 1.2, holdAfterLastMs: 0, speedProfile: [] }).success).toBe(false)
})
```

`settings.test.ts`, a describe `'the critic route (spec 10.4, 12.2)'` mirroring the graphics one at line 414: `LLM_TASKS` contains `'critic'`; the default is `{ provider: 'anthropic', model: 'claude-sonnet-5' }`; a routing stored without `critic` parses with the default filled.

`graphic-code.test.ts`: "a design may name up to six mechanisms from the list" (seven refused, an unknown key refused); "a stored design may carry the critic's report" (`critique` parses, an old row without it parses).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/schemas && pnpm exec vitest run critic mechanisms settings graphic-code`
Expected: FAIL, the two new modules cannot be resolved and `LLM_TASKS` lacks `critic`.

- [ ] **Step 3: Implement the modules and the four edits**

The sixteen definitions, one line each, in the author's words (the builder may sharpen them): persistent actor, one element stays on and carries every change; foreground becomes transition, an element grows or moves to become the next layout; cause to effect, one thing visibly makes the next happen; density from hierarchy, the busiest layer is the least important; change of speed, a fast move reads against a slow one; hard cut, a change with no transition at all; word splits open, a word parts to let the next thing through; docking, a moving element settles into a slot made for it; drum, a count that strikes each figure in turn; reel, a column that spins and stops on the answer; draw on, a line or shape drawn as the viewer watches; rise from baseline, bars and figures grow up from their rule; tally, marks that accumulate one at a time; door, a panel that opens to reveal; marker stroke, a hand-drawn underline or circle; camera push, the whole frame drifts slowly in.

- [ ] **Step 4: Run the package suite**

Run: `cd packages/schemas && pnpm exec vitest run`
Expected: PASS, every file (the two `LLM_TASKS` loops at settings.test.ts:53 and :271 now cover `critic`).

- [ ] **Step 5: Typecheck the workspace**

Run: `pnpm typecheck 2>&1 | tail -5`
Expected: errors only in `apps/web/.../models-tab.tsx` (`TASK_LABELS` lacks `critic`); Task 7 owns that file. If any other file errs, fix it here.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): the critic's report, motion metrics, the mechanisms list and the critic route"
```

---

### Task 2: Motion metrics from the dense shots

**Files:**
- Create: `apps/web/lib/graphic-code/motion-metrics.ts`
- Test: `apps/web/lib/graphic-code/motion-metrics.test.ts` (`// @vitest-environment node`)

**Interfaces:**
- Consumes: `MotionMetrics` from Task 1; `FrameShot` from `frames.ts` (`{ orientation, atMs, jpeg }`, base64 JPEG).
- Produces: `METRICS_WIDTH = 160`, `FROZEN_THRESHOLD = 2` (mean absolute grey difference per pixel, 0 to 255), `SIMULTANEITY_WINDOW_MS = 250`; `decodeGrey(jpegBase64: string): Promise<{ width: number; height: number; data: Uint8Array }>` (sharp: resize to `METRICS_WIDTH` wide, greyscale, raw); `frameChange(a: Uint8Array, b: Uint8Array): number` (mean absolute difference; throws on unequal lengths); `metricsFromChanges(changes: readonly { atMs: number; change: number }[], durationMs: number, stillMaxMs: number): MotionMetrics` (pure); `motionMetrics(shots: readonly FrameShot[], durationMs: number, stillMaxMs: number): Promise<MotionMetrics | null>` (the landscape shots sorted by time; null with fewer than two; the change of each shot is against the one before it, so `speedProfile` has one entry per shot after the first).

The pure rules, in `metricsFromChanges`: a pair is frozen when its change is under `FROZEN_THRESHOLD`; `frozenMs` is the sum of frozen pairs' spans; `longestFrozenMs` the longest run of consecutive frozen pairs by span; `frozenCritical` is `longestFrozenMs > stillMaxMs`; `simultaneity` is the largest share of the total change inside any window of `SIMULTANEITY_WINDOW_MS` starting at a shot (0 when the total is 0); `holdAfterLastMs` is `durationMs` minus the time of the last pair whose change is at or above the threshold (`durationMs` when none).

- [ ] **Step 1: Write the failing tests**

```ts
it('sums frozen pairs, finds the longest run, and flags it past the still limit', () => {
  const m = metricsFromChanges([{ atMs: 500, change: 0 }, { atMs: 1000, change: 30 }, { atMs: 1500, change: 0 }], 2000, 400)
  expect(m).toMatchObject({ frozenMs: 1000, longestFrozenMs: 500, frozenCritical: true, holdAfterLastMs: 1000, simultaneity: 1 })
  expect(m.speedProfile).toEqual([{ atMs: 500, change: 0 }, { atMs: 1000, change: 30 }, { atMs: 1500, change: 0 }])
})
it('shares the change across the busiest 250 ms', () => {
  const m = metricsFromChanges([{ atMs: 100, change: 10 }, { atMs: 200, change: 10 }, { atMs: 300, change: 10 }, { atMs: 2000, change: 10 }], 3000, 6000)
  expect(m.simultaneity).toBeCloseTo(0.75)
  expect(m.frozenCritical).toBe(false)
})
it('reports no change as all frozen with the hold at the whole slot', () => {
  expect(metricsFromChanges([{ atMs: 1000, change: 0 }], 4000, 6000)).toMatchObject({ frozenMs: 1000, simultaneity: 0, holdAfterLastMs: 4000 })
})
it('decodes a JPEG to 160 px greyscale and measures the change between two frames', async () => {
  const black = await sharp({ create: { width: 320, height: 180, channels: 3, background: '#000' } }).jpeg().toBuffer()
  const struck = await sharp(black).composite([{ input: { create: { width: 160, height: 180, channels: 3, background: '#fff' } }, left: 0, top: 0 }]).jpeg().toBuffer()
  const a = await decodeGrey(black.toString('base64'))
  const b = await decodeGrey(struck.toString('base64'))
  expect(a.width).toBe(160)
  expect(frameChange(a.data, a.data)).toBe(0)
  expect(frameChange(a.data, b.data)).toBeGreaterThan(100)
})
it('measures the landscape shots only, in time order, and needs two', async () => {
  // black at 0 and 1000, struck at 500 (given out of order), a portrait shot ignored
  const m = await motionMetrics([...], 2000, 6000)
  expect(m?.speedProfile.map((p) => p.atMs)).toEqual([500, 1000])
  expect(await motionMetrics([one landscape shot], 2000, 6000)).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run motion-metrics`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `motion-metrics.ts`**

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && pnpm exec vitest run motion-metrics`
Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/graphic-code/motion-metrics.ts apps/web/lib/graphic-code/motion-metrics.test.ts
git commit -m "feat(web): motion metrics from the dense shots: frozen time, simultaneity, speed profile, hold"
```

---

### Task 3: Dense shots, findings through transitions, contrast and the contact sheet

**Files:**
- Create: `apps/web/lib/graphic-code/sheet-document.ts` (`SHEET_WIDTH`, `SHEET_COLUMNS`, `SheetTile`, `sheetDocument`, moved verbatim from `reference-sheets.ts`)
- Modify: `apps/web/lib/reference-sheets.ts` (import the four from the new module and re-export them, so its callers and `reference-sheets.test.ts` stand)
- Modify: `apps/web/lib/graphic-code/frames.ts`
- Test: `apps/web/lib/graphic-code/frames.test.ts`

**Interfaces:**
- Consumes: `sheetDocument(tiles)` and `SHEET_WIDTH` from the new module; `GRAPHIC_SAMPLE_MS` (250) from `dry-run.ts`.
- Produces on `TextBox`: `color: string` (the computed `color`), `ground: string | null` (the `backgroundColor` of the nearest ancestor inside `#frame` that paints one, else null).
- Produces on `FramesInput`: `dense?: readonly number[]` (moments photographed at the review's size and measured in flight; none when absent), `sheets?: boolean` (a contact sheet per orientation of that orientation's dense shots, taken in the same page), `denseMaxMs?: number` (the longest the dense set and the sheets may take, after the rest moments; the remaining budget less 5 s when absent).
- Produces on `FramesResult`: `findings: string[]` (at most `FINDINGS_MAX = 8`: mid-transition layout issues prefixed `while moving, ` and contrast findings, in time order; then the cut-short line when there is one), `dense: FrameShot[]`, `sheets: Partial<Record<FrameSize['orientation'], string>>` (base64 JPEG).
- Produces: `DENSE_SHOTS_MAX = 24`; `denseMoments(durationMs: number): number[]` (from one step in, every `max(GRAPHIC_SAMPLE_MS, ceil(durationMs / DENSE_SHOTS_MAX))` while under `durationMs`, at most 24); `contrastRatio(foreground: string, background: string): number | null` (CSS `rgb()`/`rgba()` strings; an `rgba` foreground is blended over the background; null when either cannot be read or the background has no alpha); `CONTRAST_LARGE_PX = 24`, `CONTRAST_LARGE_MIN = 3`, `CONTRAST_SMALL_MIN = 4.5`; `contrastFindingIn(boxes: readonly TextBox[], size: FrameSize, atMs: number, brandBackground: string): string | null` (the first run being read whose ratio against its ground, or the brand background when it has none, is under its bar: `at 1.6 s in landscape, "Loss" reads at 2.4:1 on its ground; 4.5:1 is needed`).
- `inspectWith`: the times are the union of the measured, the wanted and the dense moments; a measured moment refuses on `layoutIssueIn` as today and then adds a contrast finding; a dense moment adds a `while moving, ` finding from `layoutIssueIn` and is photographed (JPEG quality 60, same half size); with `sheets`, after an orientation's samples the page is set to `sheetDocument` of that orientation's dense shots at `SHEET_WIDTH` and screenshotted full page (JPEG quality 80), then the next orientation resets the viewport. The dense moments and the sheets run under a soft clock of `denseMaxMs`: past it, no further dense sample is taken, no sheet is made, and `findings` ends with `the dense set was cut short at N of M shots`.

- [ ] **Step 1: Write the failing pure tests**

```ts
describe('denseMoments (spec 10.2)', () => {
  it('samples every 250 ms on a short slot and thins a long one to 24', () => {
    expect(denseMoments(6000)).toHaveLength(23)
    expect(denseMoments(6000).slice(0, 3)).toEqual([250, 500, 750])
    expect(denseMoments(30000)).toHaveLength(23)
    expect(denseMoments(30000)[0]).toBe(1250)
    expect(denseMoments(500)).toEqual([250])
  })
})
describe('contrast (spec 10.3)', () => {
  it('reads WCAG ratios from CSS colours and blends a translucent foreground', () => {
    expect(contrastRatio('rgb(255, 255, 255)', 'rgb(0, 0, 0)')).toBeCloseTo(21, 0)
    expect(contrastRatio('rgba(255, 255, 255, 0.5)', 'rgb(0, 0, 0)')).toBeLessThan(6)
    expect(contrastRatio('red', 'rgb(0, 0, 0)')).toBeNull()
  })
  it('finds a run under its bar by size, naming the run, the ratio and the bar', () => {
    const faint = { ...box, text: 'Loss', fontPx: 40, color: 'rgb(90, 90, 90)', ground: 'rgb(20, 20, 20)' }
    expect(contrastFindingIn([faint], LANDSCAPE, 1600, '#000')).toMatch(/at 1\.6 s in landscape, "Loss" reads at \d\.\d:1 on its ground; 3:1 is needed/)
    expect(contrastFindingIn([{ ...faint, fontPx: 20 }], LANDSCAPE, 1600, '#000')).toMatch(/4\.5:1 is needed/)
    expect(contrastFindingIn([{ ...faint, color: 'rgb(255, 255, 255)' }], LANDSCAPE, 1600, '#000')).toBeNull()
  })
  it('measures against the brand background when no ancestor paints one', () => {
    const bare = { ...box, text: 'Loss', fontPx: 40, color: 'rgb(30, 30, 30)', ground: null }
    expect(contrastFindingIn([bare], LANDSCAPE, 1600, '#101010')).toMatch(/reads at/)
    expect(contrastFindingIn([bare], LANDSCAPE, 1600, '#ffffff')).toBeNull()
  })
  it('skips text passing through: faint or blurred', () => { ... opacity 0.3 and moving true give null ... })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run frames`
Expected: FAIL on the three new exports; the existing cases still pass.

- [ ] **Step 3: Implement the pure parts and the page measure** (`color` and `ground` in `MEASURE_IN_PAGE`; `TextBox` fields; `denseMoments`; `contrastRatio`; `contrastFindingIn`; the `sheet-document.ts` move)

- [ ] **Step 4: Run to verify they pass**

Run: `cd apps/web && pnpm exec vitest run frames reference-sheets`
Expected: PASS.

- [ ] **Step 5: Write the failing browser-backed tests** (inside the existing `describe.skipIf(!(await browserAvailable()))`)

```ts
it('photographs the dense moments and returns a contact sheet per orientation', async () => {
  const result = await browserFrames().inspect({ compiled: stored(twoLines(40)), props, durationMs: 3000, shots: true, dense: [250, 1250, 2250], sheets: true })
  expect(result.dense.map((s) => [s.orientation, s.atMs])).toEqual([['landscape', 250], ['landscape', 1250], ['landscape', 2250], ['portrait', 250], ['portrait', 1250], ['portrait', 2250]])
  expect(Buffer.from(result.sheets.landscape!, 'base64')[0]).toBe(0xff)
  expect(result.sheets.portrait).toBeDefined()
  expect(result.layoutIssue).toBeNull()
}, 60_000)
it('reports a collision in flight as a finding, not a refusal', async () => {
  // crossing(): two lines that overlap only while the second slides in, apart at rest
  const result = await browserFrames().inspect({ compiled: stored(crossing()), props, durationMs: 3000, shots: false, dense: [1250, 1300] })
  expect(result.layoutIssue).toBeNull()
  expect(result.findings.some((f) => /^while moving, at 1\.[23] s in landscape, "Revenue" and "Loss" overlap/.test(f))).toBe(true)
}, 60_000)
it("reads each run's colour and its painted ground, or none", async () => {
  // carded(): the second line inside a div with background rgb(20, 20, 20); the first bare
  const result = await browserFrames().inspect({ compiled: stored(carded()), props, durationMs: 3000, shots: false })
  expect(result.findings).toEqual([]) // both runs read white on dark
}, 60_000)
it('reports settled text under the contrast bar as a finding', async () => {
  // dim(): the second line in rgb(60, 60, 60) on the brand background
  const result = await browserFrames().inspect({ compiled: stored(dim()), props, durationMs: 3000, shots: false })
  expect(result.layoutIssue).toBeNull()
  expect(result.findings[0]).toMatch(/"Loss" reads at \d\.\d:1 on its ground; 3:1 is needed/)
}, 60_000)
it('cuts the dense set short and says so when its time is spent', async () => {
  const result = await browserFrames().inspect({ compiled: stored(twoLines(40)), props, durationMs: 3000, shots: true, dense: [250, 1250, 2250], sheets: true, denseMaxMs: 0 })
  expect(result.shots.length).toBeGreaterThan(0)
  expect(result.dense).toEqual([])
  expect(result.sheets).toEqual({})
  expect(result.findings.at(-1)).toBe('the dense set was cut short at 0 of 6 shots')
}, 60_000)
```

- [ ] **Step 6: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run frames`
Expected: FAIL on `dense`, `sheets` and `findings` being undefined (or the suite skipped: then set `GRAPHIC_CHROMIUM_PATH` to the Playwright Chromium the e2e suite installed and run again; a run with the browser is required for this task).

- [ ] **Step 7: Implement `inspectWith`'s dense moments, findings, sheets and the soft clock**

- [ ] **Step 8: Run to verify they pass, then the design core's tests**

Run: `cd apps/web && pnpm exec vitest run frames graphic-design dry-run check`
Expected: PASS; `graphic-design.test.ts` still passes because its `inspect` stub ignores the new fields.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/graphic-code apps/web/lib/reference-sheets.ts
git commit -m "feat(web): dense shots, layout findings in flight, settled contrast and a contact sheet from one inspection"
```

---

### Task 4: The critic's prompt

**Files:**
- Create: `packages/providers/src/prompts/critic.ts`
- Create: `packages/providers/src/prompts/__fixtures__/critic-report.json` (the mock's shape)
- Modify: `packages/providers/src/prompts/graphics.ts` (export `motionIdentityBlock(motion: MotionIdentity): string`, the "This channel's motion" block `systemTemplate` already builds, so the critic says the identity in the same words)
- Modify: `packages/providers/src/index.ts` (export the module)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts` (a `graphics-critic` case) and its fixture `lift/__fixtures__/graphics-critic.json`
- Test: `packages/providers/src/prompts/critic.test.ts`, `packages/providers/src/prompts/graphics.test.ts` (one case on `motionIdentityBlock`)

**Interfaces:**
- Consumes: `CriticReportSchema`, `CriticReport`, `CRITIC_AXES`, `CRITIC_BAR`, `MECHANISMS`, `MotionMetrics`, `MotionIdentity`, `ReferencePurpose` (Task 1 and plan 2); `MsgImage`, `LLMTaskRequest`, `outputBudget` from `../llm/types`; `parseJsonCompletion`, `capList`, `trimField`, `Note`, `ignoreRepairs`.
- Produces: `CRITIC_OUTPUT_TOKENS = 1500`, `CRITIC_INPUT_TOKENS = 7000` (for estimates); `ReviewFrame` moves here from `graphics.ts` (`{ label: string; image: MsgImage }`), re-exported from the index as before; `CriticReference { title: string; purpose: ReferencePurpose; carryOver: string; image: MsgImage }`; `CriticPlan { title: string; concept?: string; storyboard?: string[]; facts: { text: string; claim: number }[]; mechanisms?: Mechanism[] }`; `CriticInput { motion: MotionIdentity; plan: CriticPlan; slot: { durationMs: number; intent: string; words: { text: string; offsetMs: number }[] }; metrics: MotionMetrics | null; findings: readonly string[]; sheets: { landscape?: MsgImage; portrait?: MsgImage }; frames: readonly ReviewFrame[]; references: readonly CriticReference[] }`.
- Produces: `buildCriticRequest(input: CriticInput): LLMTaskRequest` with `task: 'critic'`, `cacheablePrefixMessages: 1`, `maxTokens: outputBudget(CRITIC_OUTPUT_TOKENS)`, three user messages: (1) the head: `motionIdentityBlock(input.motion)` and the mechanisms list with definitions; (2) the material: the plan as JSON, the slot's intent, length and words with times, the metrics as numbers in words (`Longest frozen run 500 ms (limit 6000 ms), frozen in total 1000 ms, 75% of the change inside one 250 ms window, the ending holds 1000 ms, change per shot: 0.5 s 0, 1.0 s 30, ...`) or `No motion was measured.`, and the findings as a numbered list or `The browser found nothing wrong at rest or in flight.`; (3) the ask with the images in this order: the references (`Reference N: <title> (<purpose>): <carryOver>`), the contact sheets (`Contact sheet 16:9: N frames, timecodes under each`), the rest frames (`Frame N: <label>`). The system prompt is the critic's role: a fresh judge, never the designer; the references are grammar to learn from, never content to copy; the five axes with one line each (engagement: does it hold the eye and earn the next second; intent: does the viewer take away the slot's one point; composition: hierarchy, reading order, safe area, type that reads on a phone; temporal: the beats land on their words, nothing freezes, nothing happens all at once; craft: easing, overshoot, blur and 3D as the identity allows, no banned move), each scored 1 to 10 against a bar of `CRITIC_BAR`; the answer shape, keys in this order: `{"scores": {"engagement": {"score": 8, "line": "..."}, "intent": ..., "composition": ..., "temporal": ..., "craft": ...}, "defects": [{"atMs": 1350, "orientation": "landscape", "text": "..."}], "fixes": ["...", "...", "..."], "mechanisms": [{"key": "...", "present": true}], "keep": true}`; `keep` true only when no fix is worth a designer's call; at most three fixes, in the order they are worth making, each one concrete change the designer can make; `mechanisms` lists each mechanism the plan names and whether the frames show it.
- Produces: `parseCriticReport(text: string, note: Note = ignoreRepairs): CriticReport` (fixes capped at `CRITIC_FIXES_MAX` and defects at `CRITIC_DEFECTS_MAX` with notes, lines trimmed to their limits with notes, a mechanism whose key is not in the list dropped with a note; anything else the schema refuses throws `ValidationError('The critic report is malformed: ...', { field: 'critic report' })`).
- Produces: `mockCriticReport(plan: CriticPlan): CriticReport` (every axis `CRITIC_BAR` with a line starting `[mock]`, no defects, no fixes, the plan's mechanisms all present, `keep: true`; equal to the fixture).

- [ ] **Step 1: Write the failing tests**

```ts
describe('buildCriticRequest (spec 10.4)', () => {
  it('runs on the critic route with a cached head, the material, then the images and the ask', () => {
    const request = buildCriticRequest(INPUT)
    expect(request.task).toBe('critic')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.messages).toHaveLength(3)
    expect(request.messages[0]!.content).toContain(motionIdentityBlock(INPUT.motion))
    expect(request.messages[0]!.content).toContain('persistent actor: ')
    expect(request.messages[0]!.images).toBeUndefined()
    expect(request.messages[1]!.content).toContain('"concept": "the floor gives way"')
    expect(request.messages[1]!.content).toContain('Longest frozen run 500 ms (limit 6000 ms)')
    expect(request.messages[1]!.content).toContain('1. while moving, at 1.3 s')
    const last = request.messages[2]!
    expect(last.images).toEqual([REF_A.image, REF_B.image, SHEET_L, SHEET_P, FRAME.image])
    expect(last.content).toMatch(/Reference 1: Kaye reel \(look\): one actor carries the change/)
    expect(last.content).toContain('Contact sheet 16:9')
    expect(last.content).toContain('Frame 1: 16:9 at 1.6 s')
    expect(request.system).toContain('"keep": true')
  })
  it('says when nothing was measured and nothing was found', () => {
    const request = buildCriticRequest({ ...INPUT, metrics: null, findings: [], references: [], sheets: {} })
    expect(request.messages[1]!.content).toContain('No motion was measured.')
    expect(request.messages[1]!.content).toContain('The browser found nothing wrong at rest or in flight.')
    expect(request.messages[2]!.images).toEqual([FRAME.image])
  })
  it('writes no dash a reader would see', () => {
    const request = buildCriticRequest(INPUT)
    for (const text of [request.system, ...request.messages.map((m) => m.content)]) expect(text).not.toMatch(/[–—]/)
  })
})
describe('parseCriticReport', () => {
  it('reads a full report', () => { expect(parseCriticReport(JSON.stringify(REPORT))).toEqual(REPORT) })
  it('caps four fixes at three with a note and drops an unknown mechanism', () => {
    const notes: string[] = []
    const parsed = parseCriticReport(JSON.stringify({ ...REPORT, fixes: ['a', 'b', 'c', 'd'], mechanisms: [{ key: 'drum', present: true }, { key: 'jazz-hands', present: false }] }), (n) => notes.push(n))
    expect(parsed.fixes).toEqual(['a', 'b', 'c'])
    expect(parsed.mechanisms).toEqual([{ key: 'drum', present: true }])
    expect(notes.length).toBeGreaterThan(0)
  })
  it('refuses a report missing an axis or scored past ten', () => {
    expect(() => parseCriticReport(JSON.stringify({ ...REPORT, scores: { ...REPORT.scores, craft: { score: 11, line: 'x' } } }))).toThrow(/^The critic report is malformed/)
    const { craft: _c, ...four } = REPORT.scores
    expect(() => parseCriticReport(JSON.stringify({ ...REPORT, scores: four }))).toThrow(/^The critic report is malformed/)
    expect(() => parseCriticReport('Looks fine to me.')).toThrow()
  })
})
it('mocks a passing report equal to the fixture', () => {
  const mock = mockCriticReport({ title: 'The fall', facts: [], mechanisms: ['drum'] })
  expect(criticPasses(mock)).toBe(true)
  expect(mock).toEqual(JSON.parse(readFileSync(fixturePath, 'utf8')))
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/providers && pnpm exec vitest run critic`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `critic.ts`, the fixture, `motionIdentityBlock` and the index export**

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/providers && pnpm exec vitest run critic graphics`
Expected: PASS.

- [ ] **Step 5: Add the lift case and write its fixture**

The case `graphics-critic` builds `buildCriticRequest` from `DEFAULT_MOTION_IDENTITY`, the plan the `graphics-review` case uses today (`concept: 'the floor gives way'`, two storyboard lines, title `The fall`, one fact, `mechanisms: ['rise-from-baseline']`), a slot of 6000 ms with two words, metrics `{ frozenMs: 1000, longestFrozenMs: 500, frozenCritical: false, simultaneity: 0.75, holdAfterLastMs: 1000, speedProfile: [{ atMs: 500, change: 0 }, { atMs: 1000, change: 30 }] }`, one finding, sheets `AAAA`/`BBBB`, one frame `CCCC`, one reference `DDDD`.

Run: `cd packages/providers && pnpm exec vitest run lift`
Expected: PASS, with `lift/__fixtures__/graphics-critic.json` written on this first run; read it and check the message order and that `motionIdentityBlock`'s text matches the `graphics` fixture's block word for word.

- [ ] **Step 6: Run the package suite**

Run: `cd packages/providers && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/providers
git commit -m "feat(providers): the critic's prompt: five axes, defects, three fixes, mechanisms, with a mock and a lift case"
```

---

### Task 5: Mechanisms in the designer's answer and the catalogue

**Files:**
- Modify: `packages/providers/src/exemplars/manifest.ts` (`ExemplarEntry.mechanisms`, filled on all eighteen entries)
- Modify: `packages/providers/src/exemplars/index.ts` (`Exemplar.mechanisms`; `exemplarFor` carries them; re-export `MECHANISMS`, `MechanismSchema`, `Mechanism` from schemas)
- Modify: `packages/providers/src/prompts/graphics.ts` (the answer shape gains `"mechanisms"` after `"storyboard"`; the list with definitions in the system prompt; `parseGraphicCode` caps and drops; `exemplarBlock` says what the exemplar uses)
- Modify: `apps/web/lib/graphic-code/check.ts` (`graphicCodeIssue` carries `answer.mechanisms` onto the stored code)
- Modify: the lift fixtures `graphics*.json` (regenerated; read the diff)
- Test: `packages/providers/src/exemplars/index.test.ts` (one case), `packages/providers/src/prompts/graphics.test.ts` (three cases), `apps/web/lib/graphic-code/check.test.ts` (one case)

**Interfaces:**
- Consumes: `MECHANISMS`, `MechanismSchema`, `MECHANISMS_PER_DESIGN_MAX`, `mechanismName` (Task 1).
- Produces: `ExemplarEntry.mechanisms: readonly Mechanism[]` (one to four per entry); `Exemplar.mechanisms: readonly Mechanism[]`; the designer's answer key `"mechanisms": ["rise-from-baseline"]`, described as "the moves the design is built on, from this list, at most 6, or none"; `exemplarBlock` gains one sentence after the description: `It uses: rise from baseline, docking.`

- [ ] **Step 1: Write the failing tests**

`exemplars/index.test.ts`: "every entry names one to four mechanisms from the list, and the exemplar carries them" (each entry's `mechanisms` length in 1..4, every key in `MECHANISM_KEYS`, `exemplarFor('bar-chart')!.mechanisms` equals the manifest's).

`graphics.test.ts`: "lists the mechanisms with their definitions and asks for the design's own" (the system prompt contains `"mechanisms": [` and `persistent actor: `); "drops an unknown mechanism with a note and caps at six" (`parseGraphicCode` on an answer with seven keys and one unknown returns six known, two notes); "says what the exemplar uses" (the slot message contains `It uses: ` followed by the exemplar's mechanism names).

`check.test.ts`: "keeps the design's mechanisms on the stored code" (`graphicCodeIssue` of an answer with `mechanisms: ['drum']` yields `code.mechanisms` `['drum']`; an answer without yields none).

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/providers && pnpm exec vitest run exemplars/index graphics` and `cd apps/web && pnpm exec vitest run check`
Expected: FAIL on the missing field and the missing prompt text.

- [ ] **Step 3: Implement** (the manifest's eighteen lists are the implementer's reading of each description and design; a mechanism key that names a technique is named by that technique's entry)

- [ ] **Step 4: Regenerate the lift fixtures and read the diff**

Run: `cd packages/providers && pnpm exec vitest run lift -u && git diff --stat src/prompts/lift/__fixtures__`
Expected: every `graphics*.json` changes in the system prompt (the list) and the slot message (`It uses:`); no other fixture changes. Then `pnpm exec vitest run` in the package: PASS.

- [ ] **Step 5: Run the web checks**

Run: `cd apps/web && pnpm exec vitest run check graphic-design dry-run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/providers packages/schemas apps/web/lib/graphic-code/check.ts apps/web/lib/graphic-code/check.test.ts
git commit -m "feat(graphics): mechanisms: the catalogue names each exemplar's, the designer names its own, the critic checks them"
```

---

### Task 6: The review becomes the critic

**Files:**
- Modify: `apps/web/lib/graphic-design-core.ts` (`reviewGraphicWith`, `inspector`'s mode, `CriticReference` re-export)
- Modify: `packages/providers/src/prompts/graphics.ts` (delete `buildGraphicReviewRequest`, `parseGraphicReview`, `GraphicReview`; `currentDesign` stays), `packages/providers/src/prompts/lift/lift-cases.ts` (delete the `graphics-review` case) and delete `lift/__fixtures__/graphics-review.json`; `packages/providers/src/prompts/graphics.test.ts` (delete the review cases at lines 549 to 568)
- Modify: `apps/web/lib/graphic-design.ts` (re-export unchanged; the app binding is Task 7)
- Test: `apps/web/lib/graphic-design.test.ts` (the `reviewGraphic` describe rewritten)

**Interfaces:**
- Consumes: `denseMoments`, `FramesResult.findings/dense/sheets` (Task 3); `motionMetrics` (Task 2); `buildCriticRequest`, `parseCriticReport`, `CriticReference`, `CriticPlan` (Task 4); `buildGraphicRequest`, `parseGraphicCode`, `currentDesign`'s input shape (`current` on `GraphicDesignInput`).
- Produces: `reviewGraphicWith(complete, context, slot, options: { bible; motion?; guidance?; references?: readonly CriticReference[] } & FramesOptions): Promise<GraphicReviewResult>` with the same result type; `inspector`'s mode becomes `Pick<FramesInput, 'shots' | 'measure'> & Partial<Pick<FramesInput, 'dense' | 'sheets'>>`; `FIX_MIN_MS = 60_000`; `criticSteer(fixes: readonly string[], guidance?: string): string` (the producer's steer, then `The critic's fixes, in order: 1. ... 2. ... 3. ...`).

The path: the plan shown to the critic is the design as answered (`title`, `concept`, `storyboard`, `facts` by claim number, `mechanisms` when the design names any); inspect `{ shots: true, measure: false, dense: denseMoments(slot.durationMs), sheets: true }`; no result or no rest shots → `skipped('no frames to show')`; `metrics = await motionMetrics(result.dense, slot.durationMs, motion.stillMaxMs)`; with under `MIN_CALL_MS` left → `skipped('no time left for the call')`; the critic call with `purpose: 'critic'`; `parseCriticReport` throws → `kept` with the log line `review kept the design: the critic's report was malformed: <message>` and no `critique`; `report.keep` → `{ outcome: 'kept', code: { ...code, review: 'kept', critique: report } }` logged `the critic kept it`; else with under `FIX_MIN_MS` left → kept with critique, logged `no time left for the fix`; else the fix call `buildGraphicRequest({ ...base, current: currentDesign(code), guidance: criticSteer(report.fixes, options.guidance) })` with `purpose: 'fix'`, `parseGraphicCode`, `graphicCodeIssue`, inspect `{ shots: false, measure: true }`; a refusal keeps with critique (`the fix was refused: <issue>`); a pass → `{ outcome: 'revised', code: { ...checked.code, review: 'revised', critique: report } }`. Any thrown error stays `skipped('the review failed: ...')` as today.

- [ ] **Step 1: Rewrite the failing tests** (mock `@/lib/graphic-code/motion-metrics` so `motionMetrics` returns `METRICS` or null; the `inspect` stub returns `{ layoutIssue: null, shots: [SHOT], dense: [DENSE_A, DENSE_B], sheets: { landscape: 'AAAA', portrait: 'BBBB' }, findings: ['while moving, at 1.3 s in landscape, "a" and "b" overlap; ...'] }`)

```ts
it('photographs the design through its moves, measures it, and asks the critic with the references', async () => {
  // callLlm: a keep report
  expect(result).toMatchObject({ outcome: 'kept', code: { review: 'kept', critique: { keep: true } } })
  expect(inspect.mock.calls[0]![0]).toMatchObject({ shots: true, measure: false, sheets: true })
  expect(inspect.mock.calls[0]![0].dense).toHaveLength(23)
  const [request, options] = callLlm.mock.calls[0]!
  expect(request.task).toBe('critic')
  expect(options).toMatchObject({ purpose: 'critic' })
  expect(request.messages[1].content).toContain('Longest frozen run 500 ms')
  expect(request.messages[1].content).toContain('1. while moving, at 1.3 s')
  expect(request.messages[2].images).toEqual([REF.image, { mimeType: 'image/jpeg', data: 'AAAA' }, { mimeType: 'image/jpeg', data: 'BBBB' }, { mimeType: 'image/jpeg', data: '/9j/AAAA' }])
})
it('applies the three fixes as the steer of one designer call and takes a revision that passes', async () => {
  // callLlm: a report with keep false and three fixes, then a passing design
  expect(result).toMatchObject({ outcome: 'revised', code: { title: 'Four billion, one round', review: 'revised', critique: { keep: false } } })
  const [fix, fixOptions] = callLlm.mock.calls[1]!
  expect(fix.task).toBe('graphics')
  expect(fixOptions).toMatchObject({ purpose: 'fix' })
  expect(fix.messages.at(-1).content).toMatch(/The producer's steer: Slower\.\nThe critic's fixes, in order: 1\. bigger type 2\. hold the end 3\. one spring/)
  expect(fix.messages.some((m) => m.content.includes('The current design'))).toBe(true)
  expect(inspect.mock.calls[1]![0]).toMatchObject({ shots: false, measure: true })
})
it('keeps the design with its critique when the fix is refused', async () => { /* a fix whose figure is not a claim's, then a fix the layout refuses */ })
it('keeps the design and logs when the critic\'s report is malformed', async () => {
  // callLlm: '{"keep": true}' (the old shape) → kept, no critique, one call only
  expect(result).toMatchObject({ outcome: 'kept', code: { review: 'kept' } })
  expect(result.code.critique).toBeUndefined()
  expect(callLlm).toHaveBeenCalledTimes(1)
  expect(String(logged.mock.calls[0]![0])).toMatch(/the critic's report was malformed/)
})
it('runs the critic without metrics when the dense set is empty', async () => {
  // inspect: dense [], sheets {}, findings ['the dense set was cut short at 0 of 46 shots']; motionMetrics null
  expect(request.messages[1].content).toContain('No motion was measured.')
  expect(request.messages[1].content).toContain('cut short')
})
it('keeps the design when the fix would not fit the deadline', async () => {
  // fake timers: the critic's mock advances the clock by 200 s before answering keep false
  expect(result).toMatchObject({ outcome: 'kept', code: { critique: { keep: false } } })
  expect(callLlm).toHaveBeenCalledTimes(1)
})
it('skips, saying why at error level, when the critic call fails or the budget stops it', ...) // as today, operation llm.critic
it('skips with no frames to show, and when Settings has it off, without a call', ...) // as today
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run graphic-design`
Expected: FAIL, the critic path does not exist (the first call is still the designer's review).

- [ ] **Step 3: Implement the critic path in `reviewGraphicWith`; delete the old builder, parser, type, lift case and fixture**

- [ ] **Step 4: Run to verify they pass, both packages**

Run: `cd apps/web && pnpm exec vitest run graphic-design graphic-steps slot-rebriefer slot-retyper` and `cd packages/providers && pnpm exec vitest run`
Expected: PASS; the lift suite no longer lists `graphics-review`.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck 2>&1 | tail -5`
Expected: errors only in `models-tab.tsx` (Task 7).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.test.ts packages/providers
git commit -m "feat(graphics): the critic reviews each design through its moves and applies its fixes in one designer call; the self-review goes"
```

---

### Task 7: The references the critic sees, and the Models tab

**Files:**
- Create: `apps/web/lib/critic-references.ts`
- Modify: `apps/web/lib/graphic-design.ts` (`reviewGraphic` loads and passes `references`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/models-tab.tsx` (`TASK_LABELS.critic`, the switch under the critic row, its help text)
- Test: `apps/web/lib/critic-references.test.ts` (`// @vitest-environment node`), `apps/web/lib/graphic-design.test.ts` (one case), `apps/web/app/(console)/c/[slug]/settings/models-tab.test.tsx` (two cases changed)

**Interfaces:**
- Consumes: `listMotionReferences(db, channelId)` (plan 2; rows with `purpose`, `kind`, `denseSheetKey`, `frames.dense[0].r2Key`, `title`, `carryOver`, `archivedAt`), `getObjectBytes`, `storageConfigured`, `imageForModel`, `CriticReference` (Task 4).
- Produces: `CRITIC_REFERENCES_MAX = 2`; `criticReferencesFor(channelId: string): Promise<CriticReference[]>` (live rows tagged `look` in position order; a video with a `denseSheetKey` by that sheet, a still by `frames.dense[0].r2Key`, a video without a sheet skipped; stops at two; `[]` when storage is off; an object that cannot be read is skipped with one `console.warn` line, never thrown).
- Produces: `TASK_LABELS.critic = 'Motion critic'`; the switch block renders when `task === 'critic'` with the help text: `Once a design passes its checks, this model is shown it rendered, through its moves and beside two of the channel's look references, and scores it on five axes. What it finds worth fixing goes to the Motion graphics model as one fix. Two calls with pictures per graphic, so each costs about three times a bare design. The layout check in the browser runs either way.`

- [ ] **Step 1: Write the failing tests**

`critic-references.test.ts` (mock `@/lib/db`'s `db`, `@boom-busters/db`'s `listMotionReferences`, `@/lib/storage`, `@/lib/reference-images`): "hands the critic the first two look references in order, a still by its original" (rows: a `mechanism` clip, a `look` still, a `look` clip with a sheet, a third `look` clip → two references: the still's original key then the clip's sheet key, titles and carry-over lines carried, `imageForModel` called twice); "gives no references when storage is off or an object is missing" (`storageConfigured` false → `[]`; `getObjectBytes` rejecting on the first → the second alone, one warning).

`graphic-design.test.ts`: "hands the critic the channel's look references" (mock `@/lib/critic-references` → `[REF]`; the request's last message images start with `REF.image`).

`models-tab.test.tsx`: the switch test renamed "switches the graphics review off and on beside the Motion critic route, on by default" (unchanged assertions); "offers a Motion critic route defaulting to Sonnet 5" (`combobox 'Motion critic model'` has value `claude-sonnet-5`).

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run critic-references graphic-design models-tab`
Expected: FAIL: module not found, no references on the request, no critic row.

- [ ] **Step 3: Implement the module, the binding and the tab**

- [ ] **Step 4: Run to verify they pass, then typecheck and lint**

Run: `cd apps/web && pnpm exec vitest run critic-references graphic-design models-tab settings-form` then `pnpm typecheck 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: PASS; 0 errors; 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/critic-references.ts apps/web/lib/critic-references.test.ts apps/web/lib/graphic-design.ts apps/web/lib/graphic-design.test.ts "apps/web/app/(console)/c/[slug]/settings/models-tab.tsx" "apps/web/app/(console)/c/[slug]/settings/models-tab.test.tsx"
git commit -m "feat(web): the critic sees the channel's first two look references; the Motion critic route on the Models tab"
```

---

### Task 8: The board's review line

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/graphic-plan.tsx`
- Test: `apps/web/app/(console)/projects/[id]/graphic-plan.test.tsx`

**Interfaces:**
- Consumes: `GraphicCode['critique']` (Task 1), `CRITIC_AXES`.
- Produces: `GraphicPlan({ code: Pick<GraphicCode, 'concept' | 'storyboard' | 'review' | 'critique'> })`. With a `critique`, the review line reads `Reviewed by the critic: kept as designed.` or `Reviewed by the critic: revised on its fixes.`, followed by a ghost button `Show review` / `Hide review` (`aria-expanded`, `aria-controls`) over a list hidden until opened: one line per axis, `Engagement 8: <line>` in `CRITIC_AXES` order with the axis capitalised, then, when `fixes` is not empty, `Fixes asked: 1. ... 2. ...`. Without a `critique`, the two lines of decision 389 stand for designs reviewed before this.

- [ ] **Step 1: Write the failing tests**

```ts
it("shows the critic's five scores behind Show review, and the fixes asked", async () => {
  render(<GraphicPlan code={{ concept: 'one bar per year', review: 'revised', critique: REPORT_WITH_FIXES }} />)
  expect(screen.getByText('Reviewed by the critic: revised on its fixes.')).toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: 'Show review' })
  expect(screen.getByText('Engagement 8: holds the eye')).not.toBeVisible()
  await userEvent.click(toggle)
  expect(screen.getByText('Engagement 8: holds the eye')).toBeVisible()
  expect(screen.getByText(/Fixes asked: 1\. bigger type 2\. hold the end/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Hide review' })).toBeInTheDocument()
})
it("shows the critic's scores on a kept design, and the old line on a design reviewed before the critic", () => {
  const { rerender } = render(<GraphicPlan code={{ review: 'kept', critique: REPORT_KEEP }} />)
  expect(screen.getByText('Reviewed by the critic: kept as designed.')).toBeInTheDocument()
  rerender(<GraphicPlan code={{ review: 'kept' }} />)
  expect(screen.getByText('Reviewed on its rendered frames: kept as designed.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show review' })).toBeNull()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run graphic-plan`
Expected: FAIL, the critic's line and button are absent.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run to verify they pass, with the board**

Run: `cd apps/web && pnpm exec vitest run graphic-plan visual-board`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/graphic-plan.tsx" "apps/web/app/(console)/projects/[id]/graphic-plan.test.tsx"
git commit -m "feat(web): the board's review line shows the critic's five scores behind Show review"
```

---

### Task 9: Docs and the decision

**Files:**
- Modify: `PROGRESS.md` (tick plan 3 in the "Channel motion references" list with branch `motion-critic` and decision 397; append decision 397)
- Modify: `docs/motion-references.md` (one sentence under the purposes: the critic that reviews each graphic is shown the first two look references, so the two that matter most go first)
- Modify: `apps/web/lib/motion-guideline.ts` (the same sentence in `MOTION_GUIDELINE_FULL`, so the in-step test holds)
- Test: `apps/web/lib/motion-guideline.test.ts` (already compares the two by heading; run it)

- [ ] **Step 1: Write decision 397** in the register's voice: what shipped (the dense set, the findings, the contrast, the metrics, the critic on its route, the fix call, the board's scores, the mechanisms), the author calls above that survived execution, the costs (two calls with pictures per reviewed graphic, at most two reference images and two sheets), and what plan 4 takes from here (metrics on versions, the pairwise and verify rounds, the exemplar's named references).

- [ ] **Step 2: Run the guideline test and the format check**

Run: `cd apps/web && pnpm exec vitest run motion-guideline` then `git diff --name-only master | xargs -n 80 pnpm exec prettier --check --ignore-unknown`
Expected: PASS; all matched files use Prettier code style.

- [ ] **Step 3: Commit**

```bash
git add PROGRESS.md docs/motion-references.md apps/web/lib/motion-guideline.ts
git commit -m "docs: decision 397, measured motion and the critic review"
```

---

## Verification before hand-over

- `cd packages/schemas && pnpm exec vitest run`; `cd packages/providers && pnpm exec vitest run`; `cd packages/compositions && pnpm exec vitest run`; `cd packages/cost && pnpm exec vitest run`; `cd packages/db && pnpm exec vitest run` (one DB suite at a time); `cd apps/web && pnpm exec vitest run` (with a browser available for `frames.test.ts`, or that describe skips and the task's own browser-backed run stands as its evidence).
- `pnpm typecheck`, `pnpm lint`, Prettier on the branch's tracked files.
- e2e: `cd e2e && pnpm exec playwright test settings-motion visual-board` (the review is skipped in mock mode, so the board's e2e proves only that nothing else moved).
- Not automated: one real review on a deployed design, reading `[graphics]` log lines for `the critic kept it` or `review revised the design`, and the Costs screen for `llm.critic` beside `llm.graphics` with purposes `critic` and `fix`.
