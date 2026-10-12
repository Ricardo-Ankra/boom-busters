# The Designer Writes the Graphic (decision 295) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The graphics designer writes each motion graphic (and each chart) as a React component in a sandbox we control, checked by compile, static scan, facts and a frame-by-frame dry run, rendered by one new composition on the board and on Lambda.

**Architecture:** The model answers with `{ source, title, facts }`; the web server scans it, compiles the JSX with esbuild, dry-runs it in a `vm` context at 250 ms steps in both frames, checks its facts against the cited claims (ruling 2's order), and stores `code` on the brief. The timeline carries a new `graphic-code` payload; `GraphicCode` in compositions builds the function once and renders it inside the house frame with an error boundary. The old `scene` graphics and chart briefs without `code` keep their renderers.

**Tech Stack:** Zod 4 (`packages/schemas`), esbuild `transform` (apps/web, server only), Node `vm` + `react-dom/server` (dry run), Remotion 4.0.512 (compositions, `@remotion/player` on the board), Inngest v4, Vitest, Playwright (mock-provider mode).

**Spec:** `docs/superpowers/specs/2026-10-12-graphics-as-code-design.md`

## Global Constraints

- The stored design is `code` on the brief, not `motion` (spec section 3; every brief already carries the Ken Burns `motion` spec).
- `source` at most 16 KB (`GRAPHIC_SOURCE_MAX = 16_384` characters); `title` at most 80 (`GRAPHIC_TITLE_MAX = 80`); answer budget `GRAPHIC_ANSWER_TOKENS = 12_000`.
- The sandbox arguments are exactly `(React, Remotion, props)`; `Remotion` exposes `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`, `Sequence`, `AbsoluteFill`, `Img`, `withAlpha`. Nothing else is reachable.
- Banned in the source (static scan): `import`, `require`, `window`, `document`, `fetch`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `Date`, `Math.random`, `eval`, `Function`, `globalThis`, `process`, `useEffect`, `useLayoutEffect`, `useState`; a `#` hex colour literal; `rgb(`/`rgba(`/`hsl(` literals.
- The dry run samples every 250 ms (`GRAPHIC_SAMPLE_MS = 250`) in 1920x1080 and 1080x1920 at 30 fps; a frame over 2 s or a whole run over 20 s per frame size is a refusal; dead air longer than `GRAPHIC_STILL_MAX_MS` (6000, which Task 1 adds to `graphic-timing.ts`) is a refusal; the last sample must carry visible text.
- Facts: every digit group shown in the dry run's visible text for at least four consecutive samples (1 s) must appear in a claim the `facts` manifest cites (`figureCitesClaim`), or, on a chart, in the chart's own series (ruling 4); each `facts[].text` must appear in its claim.
- Every paid call runs on `callForAnswer` (decision 292): at most two calls, a refusal retried once with its reason, a cut-off once at double the budget. Mock-provider mode makes no paid call: the mock designer returns the fixture source.
- `'use server'` files export only async functions. Inngest step results are plain JSON; a new field read from a step parked before the deploy is read with `?? undefined`.
- Copy: no em or en dashes in new strings; South African spelling. Code and tests are exempt.
- Run `pnpm exec prettier --write` on changed files before each commit; `pnpm typecheck` and `pnpm lint` stay clean. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Never run `pnpm db:migrate` locally. No migration is needed: `code` lives in the brief's JSON column.
- Regexes and template literals are written with the Edit or Write tool, never through a heredoc or sed.

## Review Focus

1. A counting figure shows transient values ("2.3bn" on the way to "4bn"): the facts check must not refuse them. Pinned in Task 3 (a count-up source passes; a settled "7bn" the claims lack is refused).
2. A component whose last second is empty (a `Sequence` that ends early, an exit with nothing after): the owner expects the graphic to hold its ending. Pinned in Task 3 ("the last second of the graphic is empty").
3. A source reading a logo it did not cite (`props.logos['Acme'].src`): a crash at frame 0 must name the frame and the error, never reach the film. Pinned in Task 3.
4. A brief carrying both `scene` (old) and `code` (new, after a Redesign): the timeline must emit `graphic-code` and the board must play the code. Pinned in Task 6 (compile precedence) and Task 7 (player picks `code`).
5. A slow continuous drift in the model's code makes every sample differ and defeats the dead-air measure. Not pinnable by test; the prompt names dead air as the failure and the owner judges on the board. Recorded here so the reviewer knows it is accepted.

## Execution order and controller rulings

Execute the tasks in this order: **1, 2, 3, 4, 8, 5, 6, 7, 9.** Task 8 (the live loop goes) runs before Task 5 because `apps/web/scripts/live-graphic-test.ts` reads `result.scene` and would fail the web typecheck once Task 5 changes `GraphicDesignResult`. Between Task 4 and Task 5 the web package's typecheck is red (Task 4 removes the scene parser and mock that `graphic-design-core.ts` still imports); nothing is pushed in that window and Task 5 follows at once.

Rulings made while reconciling the task drafts (each already applied in the task text below; listed so a reviewer knows they were deliberate):

1. `GRAPHIC_STILL_MAX_MS = 6000` does not exist yet; Task 1 adds it to `packages/schemas/src/graphic-timing.ts`.
2. The checks run compile, scan, dry run, facts, in that order (amended in execution, Task 3 review: the token, colour and assignment checks read esbuild's COMPILED output, where JSX text is a string literal and comments are gone, since blanking raw JSX cannot tell an apostrophe from a quote; the size cap and `function Graphic(` stay on the source; `Suspense` and `lazy` join the ban list; the facts are read off the dry run's text).
3. The dry run uses the house brand (`resolveBrandKit(DEFAULT_SETTINGS)`); no check reads a colour, so `GraphicDesignContext` gains no `brand` field and the runners' `setup` steps are untouched.
4. Chart series are allowed digits: for a chart brief, `graphicCodeIssue` passes one synthetic text built from the series (each label, unit, point `x` and `y` as written) as `extraTexts` to `graphicFactsIssue`, since the series were copied verbatim from claims upstream. A shown digit group passes when a CITED claim or an extra text holds it; an uncited claim never does (the spec's rule, kept).
5. Logos: a code design is handed EVERY library logo, keyed by entity title, in the dry run (placeholder `src`), the assembly (storage keys and sizes) and the board (presigned urls and sizes). One rule everywhere, so the code the dry run proved cannot meet a missing logo later. The slot model's new field is `logoMarks: Record<assetId, { title, width, height }>` covering the whole library.
6. `props.intent` is dropped from `GraphicProps`: the intent reaches the model in the brief message and never needs to be on screen. `DryRunInput.props` and the payload carry no intent.
7. `props.durationMs` is always `payload.durationMs`, the length the dry run checked; a slot the compiler stretched keeps the code's ending held.
8. `withDesign`: a failed redesign sets `designIssue` and keeps the `code` the card already shows; a successful one sets `code` and clears `designIssue`.
9. `current` is `Pick<PlannedGraphicCode, 'source' | 'title'>` in `GraphicDesignInput`; Task 5 passes no facts.
10. The fixture string has ONE text: Task 4's `GRAPHIC_CODE_FIXTURE_SOURCE` (verified by its drafter against esbuild, React and Remotion at slot lengths of 1 s to 30 s) is also Task 2's `GRAPHIC_CODE_SOURCE`, character for character; the equality test lives in Task 4, which reads the compositions file off disk.
11. `mockGraphicCode` substitutes the fixture's `'$4bn'` with `'$<digits>bn'` for the first digit group of the claim it cites, and its `facts` text matches; with no digit-bearing claim it substitutes `''` and cites nothing, so a mock design passes the real checks on any seed.
12. `parseGraphicCode(text, note)` trims an over-long title with `trimField` (decision 293) rather than refusing it; the source and facts are not repairable.
13. Compositions exports the subpaths `./graphic-code` (the sandbox: `graphicFunctionBody`, `buildGraphic`, `remotionScope`, `graphicPropsFor`, `graphicBrand`, `safeInsets`, `withAlpha`, the types) and `./graphic-code-fixture`; server code in Tasks 3 and 5 imports through the subpath, never the barrel (which pulls in fonts, `@remotion/media` and the master). The barrel exports `GraphicCode` and the same names for the board.
14. `safeInsets(frame)` (the insets `{ top, right, bottom, left }` from `safeArea(frame)`, rounded) is one helper in compositions `lib/graphic-code.ts`, used by `GraphicCode`, the dry run and the still.
15. The built function is called the same way everywhere: the outer function returns `Graphic`, and `Graphic` renders as a component with the props. `buildGraphic` (browser, Lambda, the still) and the dry run (which compiles the outer function inside the `vm` context so the timeout covers its top level) are equivalent for a pure component.
16. Task 1 also edits `apps/web/lib/materialise.ts`, `infra/lambdas/broker/core.ts` and the `SLOT_PAYLOAD_KINDS` map so the new union member compiles and the broker presigns a coded graphic's logos (decision 284's precedent). Task 6 edits `assembly-runner.ts` (load every logo) and `visual-assets.ts` (a graphic with `code` and no `scene` is resolved, not a placeholder); Task 1's `keepGraphicDesign` carries `code` through a Fix rewrite for graphics; a chart the planner replaces loses its `code` with its data.
25. A library logo with no recorded size is left out everywhere: `LogoIndex` gains `width` and `height` (nullable), `loadGraphicContextFrom` fills them from the logo rows, the dry run hands the code only sized marks at their real sizes, and the assembly and the board already skip sizeless ones. So a mark the dry run showed is a mark the render has.
26. `graphicBrand(brand: BrandKitTokens): GraphicProps['brand']` is one helper in compositions `lib/graphic-code.ts`, used by `graphicPropsFor`, the dry run and the still.
17. Compositions adds `jsdom` as a dev dependency for the error-boundary test (React's server renderer never calls a boundary).
18. The board plays code at the full 1920x1080 or 1080x1920 (the scene player stays at half size), since model code may size in pixels against the frame the dry run checked. The still runs through `next/dynamic` with `ssr: false`, so model code never runs in the Next server process.
19. e2e seeds a code graphic in `e2e/global-setup.ts` (e2e has no Inngest, so the mock designer never runs there).
20. Shipping order: `deploy:remotion`, then `deploy:stacks boom-busters-broker` (the order decisions 289 and 290 used), then the Vercel deploy and `PUT /api/inngest`. The spec lists the two deploys the other way round; the order between them does not matter, both precede the Vercel deploy.
21. Task 9 adds a check no Vitest test can make: with `pnpm dev` running, `GET /api/inngest` returns 200, proving Next did not bundle the Inngest route with the `react-server` condition (under which `react-dom/server` throws on import). If it fails, `dry-run.ts` loads `react` and `react-dom/server` through a runtime `createRequire`.
22. If the first production compile throws "could not find @esbuild/linux-x64", `next.config.ts` gains an `outputFileTracingIncludes` entry for `/api/inngest`; recorded in PROGRESS as the rollout's check.
23. After the merge the controller edits the memory file `live-set-test-budget.md` to drop the graphics designer loop; the plan does not edit memory.
24. Commit trailers: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/schemas/src/graphic-code.ts` (new) | `GraphicCodeSchema`, `PlannedGraphicCodeSchema`, constants, `graphicFactsIssue`, `shownDigitGroups`. |
| `packages/schemas/src/graphic-timing.ts` | `GRAPHIC_STILL_MAX_MS`, the dead-air limit (Task 1). |
| `packages/schemas/src/visuals.ts` | `code?` on `GraphicBriefSchema` and `ChartBriefSchema`; `designIssue?` on `ChartBriefSchema`; `keepGraphicDesign` keeps `code`. |
| `packages/schemas/src/timeline.ts` | `GraphicCodePayloadSchema`, in `SlotPayloadSchema`; `SLOT_PAYLOAD_KINDS` widened. |
| `packages/schemas/src/logos.ts` | `LogoIndex` carries each mark's `width` and `height`, null when none was recorded (Task 1, ruling 25); every index built from `listLogos` rows carries them. |
| `apps/web/lib/materialise.ts`, `infra/lambdas/broker/core.ts` | Both materialisers sign a `graphic-code` slot's logos (Task 1). |
| `packages/compositions/src/lib/graphic-code.ts` (new) | The sandbox contract: `graphicFunctionBody`, `buildGraphic`, `remotionScope`, `graphicPropsFor`, `graphicBrand`, `safeInsets`, `withAlpha` (re-exported), `GraphicProps`, `GraphicScope`; the subpath `@boom-busters/compositions/graphic-code`. |
| `packages/compositions/src/components/GraphicCode.tsx` (new) | The composition: house frame, props, error boundary, unknown-version card. |
| `packages/compositions/src/fixtures/graphic-code.ts` (new) | `GRAPHIC_CODE_SOURCE` (plain JS, `React.createElement`; Task 4's fixture text, character for character), `GRAPHIC_CODE_PAYLOAD`; the subpath `@boom-busters/compositions/graphic-code-fixture`. |
| `packages/compositions/src/components/DocumentaryMaster.tsx` | Picks `GraphicCode` for `graphic-code`. |
| `packages/compositions/src/Root.tsx`, `src/snapshot/render.test.ts` | Goldens `GraphicCodeWide`, `GraphicCodeTall`. |
| `apps/web/lib/graphic-code/compile.ts` (new) | esbuild `transform`. |
| `apps/web/lib/graphic-code/scan.ts` (new) | The banned list, colours, size. |
| `apps/web/lib/graphic-code/dry-run.ts` (new) | `vm` context, shimmed scope, samples, dead air, safe area, last frame, shown digits. |
| `apps/web/lib/graphic-code/check.ts` (new) | `graphicCodeIssue(answer, context, slot)`: scan, compile, dry run, facts, in that order. |
| `packages/providers/src/prompts/graphics.ts` | Rewritten prompt, `buildGraphicRequest`, `parseGraphicCode`, `mockGraphicCode`. |
| `packages/providers/src/prompts/graphic-code-fixture.ts` (new) | `GRAPHIC_CODE_FIXTURE_SOURCE`, the mock's source; its test holds compositions' copy equal. |
| `packages/providers/src/prompts/shotlist.ts` | `GRAPHIC_INTENT_RULES` widened. |
| `apps/web/lib/graphic-design-core.ts`, `graphic-design.ts` | Designer on code; charts as input; `withDesign` stores `code`. |
| `apps/web/inngest/lib/graphic-steps.ts` | Designs chart rows too. |
| `apps/web/inngest/functions/slot-retyper.ts`, `slot-rebriefer.ts` | A retype to chart is designed after it lands; a chart re-brief is a redesign. |
| `packages/timeline/src/compile.ts` | `CompileSlot.graphicCode`, the `graphic-code` payload. |
| `apps/web/inngest/lib/assembly.ts` | Maps a brief with `code` to `graphicCode`, carrying every library logo by title. |
| `apps/web/inngest/functions/assembly-runner.ts` | Loads the whole logo library by title for code designs. |
| `apps/web/lib/visual-assets.ts` | A graphic with `code` resolves without fetching. |
| `apps/web/lib/visuals-review.ts` | `logoMarks` on the slot model: every library mark, by asset id, with title and size. |
| `apps/web/app/(console)/projects/[id]/graphic-player.tsx`, `graphic-playback.tsx`, `graphic-code-still.tsx` (new), `slot-previews.tsx`, `visual-board.tsx` | The board plays and previews `code`; chart cards get Redesign. |
| `e2e/global-setup.ts`, `e2e/tests/visual-plan.spec.ts` | A seeded code graphic shows its still and plays. |
| `apps/web/scripts/live-graphic-test.ts`, `packages/compositions/scripts/render-graphic-frames.ts` | Deleted. |
| `PROGRESS.md` | Decision 295. |

## Interface contract

Every task writes against these names. A task that needs to change one records why in its report, and the controller rules.

```ts
// packages/schemas/src/graphic-code.ts
export const GRAPHIC_CODE_VERSION = 1
export const GRAPHIC_SOURCE_MAX = 16_384
export const GRAPHIC_TITLE_MAX = 80
export const GRAPHIC_FACTS_MAX = 40
export const GraphicCodeWordSchema = z.object({ text: z.string().min(1), atMs: z.number().int().min(0) })
export const GraphicFactSchema = z.object({ text: z.string().trim().min(1).max(120), claimId: UlidSchema })
export const GraphicCodeSchema = z.object({
  version: z.literal(GRAPHIC_CODE_VERSION),
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  compiled: z.string().min(1),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z.array(GraphicFactSchema).max(GRAPHIC_FACTS_MAX),
  words: z.array(GraphicCodeWordSchema),
  durationMs: z.number().int().positive(),
})
export type GraphicCode = z.infer<typeof GraphicCodeSchema>
/** The wire shape: claim NUMBERS, no compiled code yet. */
export const PlannedGraphicCodeSchema = z.object({
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z.array(z.object({ text: z.string().trim().min(1).max(120), claim: z.number().int().min(1) })).max(GRAPHIC_FACTS_MAX),
})
export type PlannedGraphicCode = z.infer<typeof PlannedGraphicCodeSchema>
/** Digit groups that persisted for `minSamples` consecutive samples of visible text. */
export function shownDigitGroups(samples: readonly string[], minSamples: number): string[]
/**
 * null when every shown group is in a cited claim (or in one of `extraTexts`) and every fact is in its claim; else the refusal.
 * `extraTexts` (a chart's own series, ruling 4) are never citable by number: `facts[].claim` indexes `claims` only.
 */
export function graphicFactsIssue(input: { shown: readonly string[]; facts: readonly { text: string; claim: number }[]; claims: readonly { text: string }[]; extraTexts?: readonly string[] }): string | null

// packages/schemas/src/graphic-timing.ts (re-exported through graphics.ts)
/** The longest a graphic may hold still: decision 290's target, now enforced by the dry run (decision 295). */
export const GRAPHIC_STILL_MAX_MS = 6000

// packages/schemas/src/visuals.ts
GraphicBriefSchema: + code: GraphicCodeSchema.optional()
ChartBriefSchema:   + code: GraphicCodeSchema.optional(), designIssue: z.string().min(1).max(500).optional()
export type DesignableBrief = GraphicBrief | ChartBrief

// packages/schemas/src/timeline.ts
export const GraphicCodePayloadSchema = z.object({
  kind: z.literal('graphic-code'),
  version: z.number().int().positive(),
  compiled: z.string().min(1),
  title: z.string(),
  words: z.array(GraphicCodeWordSchema),
  durationMs: z.number().int().positive(),
  logos: z.record(z.string(), MediaRefSchema.extend({ width: z.number().int().positive(), height: z.number().int().positive() })), // keyed by entity title
  claimIds: z.array(UlidSchema),
  data: z.object({ series: z.array(ChartSeriesSchema), takeaway: z.string(), annotations: z.array(z.object({ atX: z.string(), text: z.string() })).optional() }).optional(),
})
export type GraphicCodePayload = z.infer<typeof GraphicCodePayloadSchema>
// TIMELINE_SLOT_TYPES unchanged: the slot type stays 'graphic' or 'chart'; only the payload kind is new.

// packages/schemas/src/logos.ts
LogoIndex: + width: number | null, height: number | null   // the stored size, null when none was recorded (ruling 25)

// packages/compositions/src/lib/graphic-code.ts
export interface GraphicProps {
  brand: { colors: BrandKitTokens['colors']; fonts: { heading: string; title: string; body: string; numbers: string; captions: string } }
  words: readonly { text: string; atMs: number }[]
  durationMs: number
  safeArea: { top: number; right: number; bottom: number; left: number }
  logos: Readonly<Record<string, { src: string; width: number; height: number }>>
  data?: GraphicCodePayload['data']
}
export interface GraphicScope {
  useCurrentFrame: () => number
  useVideoConfig: () => { width: number; height: number; fps: number; durationInFrames: number }
  interpolate: typeof interpolate; spring: typeof spring; Easing: typeof Easing
  Sequence: ComponentType<{ from?: number; durationInFrames?: number; children?: ReactNode }>
  AbsoluteFill: ComponentType<{ style?: CSSProperties; children?: ReactNode }>
  Img: ComponentType<{ src: string; style?: CSSProperties }>
  withAlpha: (hex: string, alpha: number) => string
}
export type GraphicComponent = (props: GraphicProps) => ReactElement | null
/** `${compiled}\nreturn Graphic` */
export function graphicFunctionBody(compiled: string): string
/** new Function('React', 'Remotion', 'props', graphicFunctionBody(compiled)), bound to the scope. */
export function buildGraphic(compiled: string, scope: GraphicScope): GraphicComponent
/** The real Remotion scope. */
export function remotionScope(): GraphicScope
/** `props.durationMs` is always `payload.durationMs` (ruling 7); `props.safeArea` is `safeInsets(frame)`. */
export function graphicPropsFor(payload: GraphicCodePayload, brand: BrandKitTokens, frame: { width: number; height: number }): GraphicProps
/** A Brand Kit as `props.brand`: its colours and each type role's family (ruling 26; `graphicPropsFor` and the dry run use it). */
export function graphicBrand(brand: BrandKitTokens): GraphicProps['brand']
/** `safeArea(frame)`'s box as rounded insets from each edge (ruling 14). */
export function safeInsets(frame: { width: number; height: number }): { top: number; right: number; bottom: number; left: number }
export { withAlpha }   // re-exported from components/brand.ts
// package.json exports: "./graphic-code" -> src/lib/graphic-code.ts, "./graphic-code-fixture" -> src/fixtures/graphic-code.ts.
// Server code (Task 3) imports only these subpaths; the barrel re-exports the same names, GraphicCode and GRAPHIC_CODE_SOURCE for the board.

// packages/compositions/src/components/GraphicCode.tsx
/** `durationInFrames` is the slot's length, accepted as every card accepts it; the code reads its frame count from `useVideoConfig`. */
export function GraphicCode(props: { payload: GraphicCodePayload; brand: BrandKitTokens; durationInFrames?: number }): JSX.Element

// apps/web/lib/graphic-code/compile.ts
export function compileGraphicSource(source: string): { ok: true; compiled: string } | { ok: false; issue: string }
// apps/web/lib/graphic-code/scan.ts
export function scanGraphicSource(source: string, compiled: string): string | null   // null = clean; size and function Graphic( on source, the rest on compiled
// apps/web/lib/graphic-code/dry-run.ts
export const GRAPHIC_SAMPLE_MS = 250
export interface DryRunInput { compiled: string; props: Omit<GraphicProps, 'safeArea'>; durationMs: number; timeoutMs?: number; frameMaxMs?: number }
export interface DryRunResult { issue: string | null; textSamples: { landscape: string[]; portrait: string[] } }   // visible text per sample, per frame size (amended, final review I4: was landscape only)
export function dryRunGraphic(input: DryRunInput): DryRunResult
// apps/web/lib/graphic-code/check.ts: compile, scan, dry run, facts, in that order (ruling 2, amended).
// The dry run gets the house brand (`graphicBrand`, ruling 26) and every titled library logo with a
// recorded size, by title, at that size (placeholder src; rulings 5 and 25);
// a chart's series are an extra text the shown digits may come from (ruling 4).
// The facts are checked in each frame size's samples apart, never across the two (final review I4).
export function graphicCodeIssue(answer: PlannedGraphicCode, context: GraphicDesignContext, slot: { brief: DesignableBrief; durationMs: number; words: readonly { text: string; atMs: number }[] }): { code: GraphicCode } | { issue: string }

// packages/providers/src/prompts/graphics.ts
export const GRAPHIC_ANSWER_TOKENS = 12_000
export interface GraphicDesignInput { ...as today, plus data?: { series: ChartSeries[]; takeaway: string; annotations?: {atX: string; text: string}[] }; current?: Pick<PlannedGraphicCode, 'source' | 'title'> (the source and title being replaced) }
export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest
/** Trims a title over GRAPHIC_TITLE_MAX with `trimField` (decision 293), reporting it through `note`; nothing else is repaired. */
export function parseGraphicCode(text: string, note?: Note): PlannedGraphicCode   // note defaults to ignoreRepairs
/** The fixture with its '$4bn' figure swapped for '$<digits>bn', the first digit group of the claim it cites; no digit-bearing claim: '' and facts []. */
export function mockGraphicCode(input: { claimTexts: readonly string[]; intentRefs: readonly number[]; guidance?: string; durationMs: number; data?: GraphicDesignInput['data'] }): PlannedGraphicCode
// packages/providers/src/prompts/graphic-code-fixture.ts
export const GRAPHIC_CODE_FIXTURE_SOURCE: string   // compositions' GRAPHIC_CODE_SOURCE is this text, character for character (ruling 10)

// apps/web/lib/graphic-design-core.ts
export type GraphicDesignResult = { ok: true; code: GraphicCode } | { ok: false; issue: string }
export function designGraphicWith(complete, context, slot: GraphicSlotTiming & { brief: DesignableBrief }, options): Promise<GraphicDesignResult>
export function slotIntent(context, brief: DesignableBrief): { intent: string; intentRefs: number[] }   // chart: takeaway + dataRefs
// apps/web/lib/graphic-design.ts
export function withDesign<B extends DesignableBrief>(brief: B, result: GraphicDesignResult): B   // success: sets code, clears designIssue; failure: sets designIssue, keeps any code (ruling 8)

// packages/timeline/src/compile.ts
CompileSlot: + graphicCode?: Omit<GraphicCodePayload, 'kind'>   // checked before chart and graphic
```

---

### Task 1: Schemas: the stored design, the briefs and the payload

**Files:**
- Create: `packages/schemas/src/graphic-code.ts`, `packages/schemas/src/graphic-code.test.ts`
- Modify: `packages/schemas/src/graphic-timing.ts` (`GRAPHIC_STILL_MAX_MS`), `packages/schemas/src/visuals.ts` (GraphicBriefSchema ~:299, ChartBriefSchema ~:183, `keepGraphicDesign`, the planned wire shapes), `packages/schemas/src/timeline.ts` (~:250, `SlotPayloadSchema`, `SLOT_PAYLOAD_KINDS`), `packages/schemas/src/index.ts`, `apps/web/lib/materialise.ts`, `infra/lambdas/broker/core.ts`, `packages/compositions/src/components/DocumentaryMaster.tsx` (a placeholder branch); `packages/schemas/src/logos.ts` (`LogoIndex` size, ruling 25) and the seven places that build a `LogoIndex` from `listLogos` rows: `apps/web/inngest/functions/visuals-runner.ts` (~:146), `visuals-replanner.ts` (~:210), `slot-retyper.ts` (~:157), `slot-rebriefer.ts` (~:197), `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (~:780), `apps/web/lib/graphic-design-core.ts` (~:239), `apps/web/scripts/live-plan-test.ts` (~:195)
- Test: `packages/schemas/src/graphic-code.test.ts`, `packages/schemas/src/visuals.test.ts`, `packages/schemas/src/timeline.test.ts`, `apps/web/lib/materialise.test.ts`, `infra/lambdas/broker/core.test.ts`, `packages/schemas/src/logos.test.ts`, `apps/web/inngest/lib/direction.test.ts` (a fixture)

**Interfaces:**
- Consumes: `UlidSchema`, `MediaRefSchema`, `ChartSeriesSchema`, `figureCitesClaim`, `figureDigitGroups` (all in schemas).
- Produces: everything under `packages/schemas` in the interface contract, `GRAPHIC_STILL_MAX_MS` and `LogoIndex`'s `width` and `height` included; `keepGraphicDesign` keeping `code` (ruling 16: this task owns it, and no other task edits it).

Steps 15 to 18 touch `apps/web/lib/materialise.ts` (+ test), `infra/lambdas/broker/core.ts` (+ test) and `packages/compositions/src/components/DocumentaryMaster.tsx`: a new payload kind falls through to `slot.payload.src` in `materialise.ts` and into the `AnimatedMap` branch of `SlotView`, so `pnpm typecheck` goes red without them, and the broker would hand Lambda a `graphic-code` payload with unsigned logos. Decision 284's schema commit set the same precedent. These are the only edits to the two materialisers in this plan (ruling 16); Task 6 does not touch them.

Steps 19 and 20 give `LogoIndex` each mark's recorded size (ruling 25). The two fields are required, so `pnpm typecheck` finds every place that builds an index from the library, and all of them carry the row's size in the same commit: the runners' `setup` steps included, since they hand `designPlannedGraphics` the logos the dry run reads.

- [ ] **Step 1: Write the failing test for the stored design and its facts check**

Create `packages/schemas/src/graphic-code.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_CODE_VERSION,
  GRAPHIC_FACTS_MAX,
  GRAPHIC_SOURCE_MAX,
  GRAPHIC_TITLE_MAX,
  GraphicCodeSchema,
  PlannedGraphicCodeSchema,
  graphicFactsIssue,
  shownDigitGroups,
} from './graphic-code'
import { GRAPHIC_STILL_MAX_MS } from './graphic-timing'

const CLAIM = '01HQ00000000000000000000AA'

const SOURCE = "function Graphic(props) { return React.createElement('div', null, '$4bn') }"

const DESIGN = {
  version: GRAPHIC_CODE_VERSION,
  source: SOURCE,
  compiled: SOURCE,
  title: 'Four billion, on paper',
  facts: [{ text: '$4bn', claimId: CLAIM }],
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion.', atMs: 380 },
  ],
  durationMs: 6000,
}

describe('GraphicCodeSchema (decision 295)', () => {
  it('accepts a whole design', () => {
    expect(GraphicCodeSchema.parse(DESIGN)).toEqual(DESIGN)
  })

  it('holds the source to 16 KB', () => {
    expect(GRAPHIC_SOURCE_MAX).toBe(16_384)
    const atCap = { ...DESIGN, source: 'x'.repeat(GRAPHIC_SOURCE_MAX) }
    expect(GraphicCodeSchema.safeParse(atCap).success).toBe(true)
    const over = { ...DESIGN, source: 'x'.repeat(GRAPHIC_SOURCE_MAX + 1) }
    expect(GraphicCodeSchema.safeParse(over).success).toBe(false)
  })

  it('holds the title to one line of the slot card, trimmed', () => {
    const long = { ...DESIGN, title: 'x'.repeat(GRAPHIC_TITLE_MAX + 1) }
    expect(GraphicCodeSchema.safeParse(long).success).toBe(false)
    expect(GraphicCodeSchema.parse({ ...DESIGN, title: '  Four billion  ' }).title).toBe(
      'Four billion',
    )
  })

  it('refuses a fact with no text', () => {
    const blank = { ...DESIGN, facts: [{ text: '   ', claimId: CLAIM }] }
    expect(GraphicCodeSchema.safeParse(blank).success).toBe(false)
  })

  it('pins the sandbox version the code was written against', () => {
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, version: 2 }).success).toBe(false)
  })

  it('needs compiled code beside the source', () => {
    expect(GraphicCodeSchema.safeParse({ ...DESIGN, compiled: '' }).success).toBe(false)
  })
})

describe('PlannedGraphicCodeSchema', () => {
  const planned = {
    source: SOURCE,
    title: 'Four billion, on paper',
    facts: [{ text: '$4bn', claim: 1 }],
  }

  it("accepts the model's answer, citing claims by number", () => {
    expect(PlannedGraphicCodeSchema.parse(planned)).toEqual(planned)
  })

  it('refuses a claim number below one, and a fact with no text', () => {
    const zero = { ...planned, facts: [{ text: '$4bn', claim: 0 }] }
    expect(PlannedGraphicCodeSchema.safeParse(zero).success).toBe(false)
    const blank = { ...planned, facts: [{ text: '', claim: 1 }] }
    expect(PlannedGraphicCodeSchema.safeParse(blank).success).toBe(false)
  })

  it('caps the facts manifest', () => {
    const facts = Array.from({ length: GRAPHIC_FACTS_MAX + 1 }, () => ({ text: '$4bn', claim: 1 }))
    expect(PlannedGraphicCodeSchema.safeParse({ ...planned, facts }).success).toBe(false)
  })
})

describe('shownDigitGroups', () => {
  it('judges a count-up by where it lands, not the values on the way', () => {
    expect(shownDigitGroups(['1bn', '2bn', '3bn', '4bn', '4bn', '4bn', '4bn'], 4)).toEqual(['4'])
  })

  it('needs the samples to run in a row', () => {
    expect(shownDigitGroups(['7bn', '7bn', '7bn', '', '7bn', '7bn', '7bn'], 4)).toEqual([])
  })

  it('reads every group in a sample, separators removed, each once, in the order they held', () => {
    const samples = Array.from({ length: 5 }, () => '1,200 staff at 3 sites')
    expect(shownDigitGroups(samples, 4)).toEqual(['1200', '3'])
  })
})

describe('graphicFactsIssue', () => {
  const claims = [
    { text: 'The round valued the company at $4 billion.' },
    { text: 'It gave its product away free.' },
    { text: 'Revenue that year was $7 million.' },
  ]

  it('passes a graphic whose numbers and facts are all in the claims it cites', () => {
    expect(
      graphicFactsIssue({
        shown: ['4'],
        facts: [
          { text: '$4bn', claim: 1 },
          { text: 'gave its product away', claim: 2 },
        ],
        claims,
      }),
    ).toBeNull()
  })

  it('passes a graphic that shows no number and cites nothing', () => {
    expect(graphicFactsIssue({ shown: [], facts: [], claims })).toBeNull()
  })

  it('refuses a number no cited claim contains, naming it, even when an uncited claim holds it', () => {
    const shown = shownDigitGroups(['$7bn', '$7bn', '$7bn', '$7bn'], 4)
    expect(graphicFactsIssue({ shown, facts: [{ text: '$4bn', claim: 1 }], claims })).toBe(
      'the graphic shows 7, which no cited claim contains',
    )
  })

  it('refuses a fact its claim does not hold, in digits or in words', () => {
    expect(graphicFactsIssue({ shown: [], facts: [{ text: '$5bn', claim: 1 }], claims })).toBe(
      'fact "$5bn" is not in claim 1',
    )
    expect(
      graphicFactsIssue({ shown: [], facts: [{ text: 'sold at a loss', claim: 2 }], claims }),
    ).toBe('fact "sold at a loss" is not in claim 2')
  })

  it('reads a quoted phrase without its quote marks, case and spacing aside', () => {
    expect(
      graphicFactsIssue({
        shown: [],
        facts: [{ text: '“Gave its  product away”', claim: 2 }],
        claims,
      }),
    ).toBeNull()
  })

  it('refuses a fact that is nothing but quote marks', () => {
    expect(graphicFactsIssue({ shown: [], facts: [{ text: '""', claim: 2 }], claims })).toBe(
      'fact """" is not in claim 2',
    )
  })

  it('refuses a claim number outside the list', () => {
    expect(graphicFactsIssue({ shown: ['4'], facts: [{ text: '$4bn', claim: 4 }], claims })).toBe(
      'fact "$4bn" cites claim 4, which does not exist',
    )
  })

  it('reports the manifest before what the dry run saw', () => {
    expect(graphicFactsIssue({ shown: ['7'], facts: [{ text: '$5bn', claim: 1 }], claims })).toBe(
      'fact "$5bn" is not in claim 1',
    )
  })

  it("passes a number an extra text holds, which no claim number can cite (a chart's series)", () => {
    const series = 'Share price EUR 2020-06-17 104.5 2020-06-26 1.28'
    expect(graphicFactsIssue({ shown: ['104.5'], facts: [], claims, extraTexts: [series] })).toBeNull()
    expect(graphicFactsIssue({ shown: ['104.5'], facts: [], claims })).toBe(
      'the graphic shows 104.5, which no cited claim contains',
    )
    // A claim number still indexes the real claims only: claim 4 is not the extra text.
    expect(
      graphicFactsIssue({
        shown: [],
        facts: [{ text: '104.5', claim: 4 }],
        claims,
        extraTexts: [series],
      }),
    ).toBe('fact "104.5" cites claim 4, which does not exist')
  })
})

describe('the dead-air limit (decision 295)', () => {
  it("is decision 290's six seconds, which the dry run now enforces", () => {
    expect(GRAPHIC_STILL_MAX_MS).toBe(6000)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/graphic-code.test.ts`
Expected: FAIL, the file cannot import `./graphic-code` ("Failed to load url ./graphic-code" or "Cannot find module").

- [ ] **Step 3: Write the stored design, the wire shape, the facts check and the dead-air limit**

In `packages/schemas/src/graphic-timing.ts`, directly after `export const GRAPHIC_UNDERLINE_MS = 600`, add:

```ts
/** The longest a graphic may hold still: decision 290's target, now enforced by the dry run (decision 295). */
export const GRAPHIC_STILL_MAX_MS = 6000
```

`graphics.ts` already re-exports `graphic-timing` with `export *`, and `index.ts` re-exports `graphics`, so the constant reaches `@boom-busters/schemas` with no further edit. Tasks 3 and 4 import it from there.

Create `packages/schemas/src/graphic-code.ts`:

```ts
import { z } from 'zod'
import { figureCitesClaim, figureDigitGroups } from './graphics'
import { UlidSchema } from './ids'

/**
 * The designer writes the graphic (decision 295).
 *
 * From decision 268 to 290 a graphic was a form the model filled in: a scene
 * of five element kinds on a 12 by 12 grid. The designer now writes the
 * animation itself, as one React component, and the app checks it instead of
 * constraining it: a static scan, a compile, a frame-by-frame dry run and the
 * facts check below, in that order (`apps/web/lib/graphic-code`). What passes is stored
 * on the brief as `code`, not `motion`: every brief already carries the Ken
 * Burns `motion` spec.
 *
 * The model answers in the wire shape (`PlannedGraphicCode`), citing claims by
 * NUMBER as every planning prompt does; the check maps the numbers to ids and
 * adds the compiled code, and only then does the stored shape exist.
 */

/** The sandbox contract the code was written against: its arguments and its banned list. */
export const GRAPHIC_CODE_VERSION = 1
/** One component and its helpers. A source longer than this is a program, not a graphic. */
export const GRAPHIC_SOURCE_MAX = 16_384
/** One line on the slot card. */
export const GRAPHIC_TITLE_MAX = 80
export const GRAPHIC_FACTS_MAX = 40

/** One narrated word, timed from the slot's start: what the code keys its motion to. */
export const GraphicCodeWordSchema = z.object({
  text: z.string().min(1),
  atMs: z.number().int().min(0),
})

/** A number or quoted phrase the graphic shows, and the claim it comes from. */
export const GraphicFactSchema = z.object({
  text: z.string().trim().min(1).max(120),
  claimId: UlidSchema,
})

export const GraphicCodeSchema = z.object({
  version: z.literal(GRAPHIC_CODE_VERSION),
  /** The designer's JSX, kept so a redesign can show the model what it replaces. */
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  /** What the sandbox runs: the source compiled to plain JavaScript. */
  compiled: z.string().min(1),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z.array(GraphicFactSchema).max(GRAPHIC_FACTS_MAX),
  /** The narration the dry run checked the code against. */
  words: z.array(GraphicCodeWordSchema),
  /** The slot length the dry run checked the code at. */
  durationMs: z.number().int().positive(),
})
export type GraphicCode = z.infer<typeof GraphicCodeSchema>

/** The wire shape: claim NUMBERS, no compiled code yet. */
export const PlannedGraphicCodeSchema = z.object({
  source: z.string().min(1).max(GRAPHIC_SOURCE_MAX),
  title: z.string().trim().min(1).max(GRAPHIC_TITLE_MAX),
  facts: z
    .array(z.object({ text: z.string().trim().min(1).max(120), claim: z.number().int().min(1) }))
    .max(GRAPHIC_FACTS_MAX),
})
export type PlannedGraphicCode = z.infer<typeof PlannedGraphicCodeSchema>

/**
 * Digit groups that persisted for `minSamples` consecutive samples of visible text.
 *
 * The dry run reads the visible text every 250 ms. A figure counting up to
 * $4bn passes through 1, 2 and 3 on the way, each for a sample or two; only a
 * group that holds for `minSamples` samples in a row (four: one second) counts
 * as shown, so a count is judged by where it lands. Each group is reported
 * once, in the order it first held.
 */
export function shownDigitGroups(samples: readonly string[], minSamples: number): string[] {
  const shown: string[] = []
  // How many samples in a row each group has been on screen, up to this one.
  let runs = new Map<string, number>()
  for (const sample of samples) {
    const next = new Map<string, number>()
    for (const group of new Set(figureDigitGroups(sample))) {
      const run = (runs.get(group) ?? 0) + 1
      next.set(group, run)
      if (run >= minSamples && !shown.includes(group)) shown.push(group)
    }
    runs = next
  }
  return shown
}

const OUTER_QUOTE_MARKS = /^["'‘’“”]+|["'‘’“”]+$/g

/** A phrase as the comparison reads it: straight apostrophes, single spaces, lower case. */
function phraseKey(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Whether a fact is in its claim. A fact with digits is a figure and is
 * checked as one (`figureCitesClaim`: the digits are the fact, the multiplier
 * is a rendering choice). A fact without digits is a quoted phrase and must
 * appear in the claim's text, its own quote marks, case and spacing aside.
 */
function factInClaim(fact: string, claimText: string): boolean {
  if (figureDigitGroups(fact).length > 0) return figureCitesClaim(fact, claimText)
  const phrase = phraseKey(fact.trim().replace(OUTER_QUOTE_MARKS, ''))
  return phrase !== '' && phraseKey(claimText).includes(phrase)
}

/**
 * null when every shown group is in a cited claim (or in one of `extraTexts`)
 * and every fact is in its claim; else the refusal.
 *
 * The refusal is in the words the designer's retry reads (decision 292). The
 * manifest is checked first, in order: a claim number outside the list, then a
 * fact its claim does not hold. Then what the dry run saw: a shown number must
 * be in a claim the manifest CITES, because a claim the graphic does not name
 * cannot vouch for it. `facts[].claim` is 1-based into `claims`, as in every
 * planning prompt.
 *
 * `extraTexts` are texts a shown number may also come from without a claim
 * number: a chart's own series (decision 295), which were copied verbatim from
 * claims when the chart was planned. They are never citable: a fact's claim
 * number indexes `claims` only.
 */
export function graphicFactsIssue(input: {
  shown: readonly string[]
  facts: readonly { text: string; claim: number }[]
  claims: readonly { text: string }[]
  extraTexts?: readonly string[]
}): string | null {
  const cited: string[] = []
  for (const fact of input.facts) {
    const claim = input.claims[fact.claim - 1]
    if (claim === undefined) {
      return `fact "${fact.text}" cites claim ${fact.claim}, which does not exist`
    }
    if (!factInClaim(fact.text, claim.text)) {
      return `fact "${fact.text}" is not in claim ${fact.claim}`
    }
    cited.push(claim.text)
  }
  const sources = [...cited, ...(input.extraTexts ?? [])]
  for (const group of input.shown) {
    if (!sources.some((text) => figureCitesClaim(group, text))) {
      return `the graphic shows ${group}, which no cited claim contains`
    }
  }
  return null
}
```

In `packages/schemas/src/index.ts`, after `export * from './graphics'`, add:

```ts
export * from './graphic-code'
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/graphic-code.test.ts`
Expected: PASS, 22 tests.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/schemas/src/graphic-code.ts packages/schemas/src/graphic-code.test.ts packages/schemas/src/index.ts packages/schemas/src/graphic-timing.ts
pnpm exec prettier --check packages/schemas/src/graphic-code.ts packages/schemas/src/graphic-code.test.ts packages/schemas/src/index.ts packages/schemas/src/graphic-timing.ts
git add packages/schemas/src/graphic-code.ts packages/schemas/src/graphic-code.test.ts packages/schemas/src/index.ts packages/schemas/src/graphic-timing.ts
git commit -m "feat(schemas): the stored design is code, with its facts check (decision 295)

GraphicCodeSchema is what the designer's answer becomes once it passes:
source, compiled code, title, facts by claim id, the words and the slot
length it was checked at. PlannedGraphicCodeSchema is the wire shape with
claim numbers. shownDigitGroups keeps only the digit groups that held on
screen for a second, so a count-up is judged by where it lands, and
graphicFactsIssue refuses a fact its claim does not hold or a shown number
no cited claim contains; a chart's series pass in as extra texts a shown
number may come from, never citable by number. GRAPHIC_STILL_MAX_MS, decision
290's six seconds, joins graphic-timing for the dry run to enforce.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing tests for the briefs**

In `packages/schemas/src/visuals.test.ts`:

1. Change the first line to:

```ts
import { describe, expect, expectTypeOf, it } from 'vitest'
```

2. Replace `import type { SlotRef } from './visuals'` with:

```ts
import type { ChartBrief, DesignableBrief, GraphicBrief, SlotRef } from './visuals'
import type { GraphicCode } from './graphic-code'
```

3. Append at the end of the file:

```ts
describe('the designer writes the graphic (decision 295)', () => {
  const DESIGNED: GraphicCode = {
    version: 1,
    source: 'function Graphic() { return null }',
    compiled: 'function Graphic() { return null }',
    title: 'Four billion, on paper',
    facts: [{ text: '$4bn', claimId: CLAIM_A }],
    words: [{ text: 'Four', atMs: 0 }],
    durationMs: 6000,
  }
  const graphic = {
    type: 'graphic' as const,
    ...common,
    intent: 'Four billion in one round is the story.',
    intentClaimIds: [CLAIM_A],
  }
  const scene = {
    elements: [
      {
        kind: 'figure' as const,
        align: 'start' as const,
        id: 'f1',
        cell: { col: 0, row: 0, colSpan: 6, rowSpan: 3 },
        value: '$4bn',
        claimRef: CLAIM_A,
        color: 'accent' as const,
        enter: { kind: 'fade' as const, atMs: 0 },
      },
    ],
  }
  const chart = {
    type: 'chart' as const,
    ...common,
    chartKind: 'bar' as const,
    series: [
      {
        label: 'Valuation',
        unit: 'USD Millions',
        points: [
          { x: '2022', y: 1000 },
          { x: '2023', y: 4000 },
        ],
      },
    ],
    dataRefs: [CLAIM_A],
    takeaway: 'Four times in a year.',
    reveal: 'draw-on' as const,
  }

  it('stores the code on a graphic brief, beside a scene from before', () => {
    expect(GraphicBriefSchema.parse({ ...graphic, code: DESIGNED }).code).toEqual(DESIGNED)
    expect(GraphicBriefSchema.parse({ ...graphic, scene, code: DESIGNED })).toMatchObject({
      scene,
      code: DESIGNED,
    })
  })

  it('stores the code on a chart brief, or why the designer could not write it', () => {
    expect(ChartBriefSchema.parse({ ...chart, code: DESIGNED }).code).toEqual(DESIGNED)
    const issue = 'the graphic shows 7, which no cited claim contains'
    expect(ChartBriefSchema.parse({ ...chart, designIssue: issue }).designIssue).toBe(issue)
    expect(ChartBriefSchema.safeParse({ ...chart, designIssue: 'x'.repeat(501) }).success).toBe(
      false,
    )
  })

  it('refuses code that is not a whole design', () => {
    const half = { ...graphic, code: { ...DESIGNED, compiled: '' } }
    expect(GraphicBriefSchema.safeParse(half).success).toBe(false)
  })

  it('never takes a design from the planner', () => {
    const plannedChart = PlannedBriefSchema.parse({
      ...chart,
      dataRefs: [1],
      code: DESIGNED,
      designIssue: 'x',
    })
    expect(plannedChart).not.toHaveProperty('code')
    expect(plannedChart).not.toHaveProperty('designIssue')
    const plannedGraphic = PlannedBriefSchema.parse({
      type: 'graphic',
      ...common,
      intent: graphic.intent,
      intentRefs: [1],
      code: DESIGNED,
    })
    expect(plannedGraphic).not.toHaveProperty('code')
  })

  it('keeps the code through a rewrite, as it keeps a scene', () => {
    const next = { ...graphic, intent: 'The round, not the product, is the story.' }
    expect(keepGraphicDesign({ ...graphic, code: DESIGNED }, next)).toEqual({
      ...next,
      code: DESIGNED,
    })
    expect(keepGraphicDesign({ ...graphic, scene, code: DESIGNED }, next)).toEqual({
      ...next,
      scene,
      code: DESIGNED,
    })
  })

  it('names the briefs the designer works on', () => {
    expectTypeOf<DesignableBrief>().toEqualTypeOf<GraphicBrief | ChartBrief>()
  })
})
```

- [ ] **Step 7: Run them to see them fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/visuals.test.ts`
Expected: FAIL in four of the new tests: "stores the code on a graphic brief" and "stores the code on a chart brief" (the field is stripped, `code` is undefined), "refuses code that is not a whole design" (stripped, so it parses) and "keeps the code through a rewrite" (the code is dropped). "never takes a design from the planner" already passes and pins the omit that Step 8 adds; the type test is checked by `tsc`, not at run time. Every older test still passes.

- [ ] **Step 8: Put the code on the briefs**

In `packages/schemas/src/visuals.ts`:

1. After `import { UlidSchema } from './ids'` add:

```ts
import { GraphicCodeSchema } from './graphic-code'
```

2. In `ChartBriefSchema`, after `reveal: z.enum(['draw-on', 'none']),` add:

```ts
  /**
   * The designer's component for this chart (decision 295), written around
   * `series`. A chart with code plays it; a chart without plays its own
   * reveal (`ChartReveal`), as every chart did before 295.
   */
  code: GraphicCodeSchema.optional(),
  /** Why the designer could not write it. Meaningful only without `code`. */
  designIssue: z.string().min(1).max(500).optional(),
```

3. Replace the `GraphicBriefSchema` doc comment, the schema and its type (from `/**` above `export const GraphicBriefSchema` down to `export type GraphicBrief = z.infer<typeof GraphicBriefSchema>`) with:

```ts
/**
 * A composed graphic (decision 268, Plan B): the brief IS the scene, as a
 * chart's brief is its series. Nothing is fetched; the timeline embeds it.
 *
 * Since decision 289 the shot list writes the intent and a designer of its
 * own composes the scene, so a graphic can be stored before it is designed
 * (no scene, no issue: being designed) or after the designer could not
 * (no scene, `designIssue` says why). A graphic stored before 289 has a
 * scene and no intent, and its description stands in for one.
 *
 * Since decision 295 the designer writes the graphic as code. A brief with
 * `code` plays the code whatever else it carries: one designed as a scene
 * and redesigned after 295 keeps its old `scene` beside the new code.
 */
export const GraphicBriefSchema = z.object({
  type: z.literal('graphic'),
  ...briefCommon,
  scene: GraphicSceneSchema.optional(),
  /** The designer's component (decision 295). Takes precedence over `scene`. */
  code: GraphicCodeSchema.optional(),
  /** What the graphic must get across, not how it looks. */
  intent: z.string().trim().min(1).max(GRAPHIC_INTENT_MAX).optional(),
  /** The claims the beat rests on, as the shot list named them. */
  intentClaimIds: z.array(UlidSchema).max(GRAPHIC_INTENT_REFS_MAX).optional(),
  /** Why the designer could not compose it. Meaningful only without a scene or code. */
  designIssue: z.string().min(1).max(500).optional(),
})
export type GraphicBrief = z.infer<typeof GraphicBriefSchema>

/**
 * The briefs the graphics designer works on (decision 295): a graphic, and a
 * chart, which the designer builds around its real series.
 */
export type DesignableBrief = GraphicBrief | ChartBrief
```

4. Replace `keepGraphicDesign` and its doc comment with:

```ts
/**
 * The Fix button rewrites a graphic's words, never its design (decision 289):
 * a planned graphic carries no scene and no code, so a rewrite of a designed
 * graphic keeps the scene and the code (decision 295) it had, and the owner
 * presses Redesign graphic if the new intent needs a new one.
 */
export function keepGraphicDesign(previous: ShotBrief, next: ShotBrief): ShotBrief {
  if (previous.type !== 'graphic' || next.type !== 'graphic') return next
  const keepScene = previous.scene !== undefined && next.scene === undefined
  const keepCode = previous.code !== undefined && next.code === undefined
  if (!keepScene && !keepCode) return next
  return {
    ...next,
    ...(keepScene ? { scene: previous.scene } : {}),
    ...(keepCode ? { code: previous.code } : {}),
  }
}
```

5. Replace the `PlannedChartBriefSchema` doc comment and declaration with:

```ts
/**
 * The wire shape a chart brief takes inside the model's JSON: identical to
 * `ChartBriefSchema` except `dataRefs` are 1-based claim numbers into the
 * prompt's numbered claim list, and there is no design: the designer writes
 * that after the chart is planned (decision 295). `resolvePlannedBrief`
 * converts.
 */
export const PlannedChartBriefSchema = ChartBriefSchema.omit({
  dataRefs: true,
  code: true,
  designIssue: true,
}).extend({
  dataRefs: z
    .array(z.number().int().min(1))
    .min(1, 'a chart must cite the claims its numbers come from'),
})
```

6. In `PlannedGraphicBriefSchema`, change the omit to:

```ts
export const PlannedGraphicBriefSchema = GraphicBriefSchema.omit({
  scene: true,
  code: true,
  intent: true,
  intentClaimIds: true,
  designIssue: true,
}).extend({
```

(the `.extend({ ... })` body after it is unchanged).

- [ ] **Step 9: Run them to see them pass, and typecheck the package**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/visuals.test.ts src/graphic-code.test.ts`
Expected: PASS.
Run: `pnpm --filter @boom-busters/schemas exec tsc --noEmit`
Expected: no errors (this is where the `expectTypeOf` test is checked).

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts
pnpm exec prettier --check packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts
git add packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts
git commit -m "feat(schemas): graphic and chart briefs carry the designer's code (decision 295)

GraphicBriefSchema gains code beside the old scene; ChartBriefSchema gains
code and designIssue, so a chart is designed the way a graphic is.
DesignableBrief names the two. The planner's wire shapes omit both fields,
so the shot list can never write a design, and keepGraphicDesign keeps a
graphic's code through a rewrite as it keeps its scene.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 11: Write the failing tests for the payload**

In `packages/schemas/src/timeline.test.ts`:

1. Add `GraphicCodePayloadSchema,` to the `./timeline` import, after `gainAt,`.

2. In the test `'a graphic slot carries a graphic payload and nothing else'`, rename it to `'a graphic slot carries a scene graphic payload'` and change its second line to:

```ts
    expect(SLOT_PAYLOAD_KINDS.graphic).toEqual(['graphic', 'graphic-code'])
```

3. Append a new `describe` block after the `TimelineSchema` describe block (before `describe('timelineDurationMs'`):

```ts
describe('the graphic-code payload (decision 295)', () => {
  const payload = {
    kind: 'graphic-code',
    version: 1,
    compiled: 'function Graphic(props) { return null }',
    title: 'Four billion, on paper',
    words: [
      { text: 'Four', atMs: 0 },
      { text: 'billion.', atMs: 380 },
    ],
    durationMs: 6000,
    logos: {
      'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 },
    },
    claimIds: [CLAIM],
  }
  const slot = (type: string, body: object = payload) => ({
    type,
    startMs: 0,
    durationMs: 6000,
    transition: 'cut',
    motion: { kind: 'static' },
    payload: body,
  })

  it('rides a graphic slot or a chart slot, and no other', () => {
    expect(SLOT_PAYLOAD_KINDS.graphic).toEqual(['graphic', 'graphic-code'])
    expect(SLOT_PAYLOAD_KINDS.chart).toEqual(['chart', 'graphic-code'])
    expect(TimelineSlotSchema.parse(slot('graphic')).payload.kind).toBe('graphic-code')
    expect(TimelineSlotSchema.parse(slot('chart')).payload.kind).toBe('graphic-code')
    const still = TimelineSlotSchema.safeParse(slot('still'))
    expect(still.success).toBe(false)
    if (!still.success) {
      expect(still.error.issues[0]?.message).toBe('a still slot cannot carry a graphic-code payload')
    }
  })

  it('refuses a payload kind the timeline does not know', () => {
    const unknown = slot('graphic', { ...payload, kind: 'graphic-script' })
    expect(TimelineSlotSchema.safeParse(unknown).success).toBe(false)
  })

  it("keys its logos by entity and carries a chart's series as data", () => {
    const parsed = GraphicCodePayloadSchema.parse({
      ...payload,
      data: {
        series: [
          {
            label: 'Valuation',
            unit: 'USD Millions',
            points: [
              { x: '2022', y: 1000 },
              { x: '2023', y: 4000 },
            ],
          },
        ],
        takeaway: 'Four times in a year.',
      },
    })
    expect(parsed.logos['Stability AI']?.width).toBe(1200)
    expect(parsed.data?.series[0]?.points).toHaveLength(2)
  })

  it('keeps a sandbox version it does not know, for the renderer to refuse in words', () => {
    expect(GraphicCodePayloadSchema.parse({ ...payload, version: 2 }).version).toBe(2)
    expect(GraphicCodePayloadSchema.safeParse({ ...payload, version: 0 }).success).toBe(false)
  })

  it('needs compiled code to run', () => {
    expect(GraphicCodePayloadSchema.safeParse({ ...payload, compiled: '' }).success).toBe(false)
  })
})
```

- [ ] **Step 12: Run them to see them fail**

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/timeline.test.ts`
Expected: FAIL: the renamed test (`SLOT_PAYLOAD_KINDS.graphic` is still `['graphic']`) and every test in the new block (`GraphicCodePayloadSchema` is not exported yet, so `.parse` reads `undefined`).

- [ ] **Step 13: Add the payload to the timeline**

In `packages/schemas/src/timeline.ts`:

1. After `import { GraphicSceneSchema } from './graphics'` add:

```ts
import { GraphicCodeWordSchema } from './graphic-code'
```

2. After `export type GraphicPayload = z.infer<typeof GraphicPayloadSchema>` add:

```ts
/**
 * A graphic the designer wrote as code (decision 295), embedded whole: the
 * compiled component, the narration it was timed to, the logos it may draw
 * keyed by the entity the dossier names, and every claim it cites for the
 * audit trail. A chart slot carries one too, with its series in `data`.
 *
 * `version` names the sandbox contract the code was written against, and is
 * deliberately not pinned here: a renderer that does not know the version
 * draws the slot's title rather than misrendering, so the timeline must
 * still parse. Like a scene graphic, a render depends on nothing outside the
 * timeline but the logo objects.
 */
export const GraphicCodePayloadSchema = z.object({
  kind: z.literal('graphic-code'),
  version: z.number().int().positive(),
  compiled: z.string().min(1),
  title: z.string(),
  words: z.array(GraphicCodeWordSchema),
  durationMs: z.number().int().positive(),
  logos: z.record(
    z.string(),
    MediaRefSchema.extend({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    }),
  ),
  claimIds: z.array(UlidSchema),
  data: z
    .object({
      series: z.array(ChartSeriesSchema),
      takeaway: z.string(),
      annotations: z.array(z.object({ atX: z.string(), text: z.string() })).optional(),
    })
    .optional(),
})
export type GraphicCodePayload = z.infer<typeof GraphicCodePayloadSchema>
```

3. In `SlotPayloadSchema`, add `GraphicCodePayloadSchema,` after `GraphicPayloadSchema,`.

4. In `SLOT_PAYLOAD_KINDS`, change the `chart` and `graphic` lines to:

```ts
  chart: ['chart', 'graphic-code'],
```

```ts
  graphic: ['graphic', 'graphic-code'],
```

and above `export const SLOT_PAYLOAD_KINDS` extend its doc comment to:

```ts
/**
 * Which payload kinds each slot type may carry. A graphic or a chart the
 * designer wrote as code (decision 295) keeps its slot type and carries a
 * `graphic-code` payload; the slot type is the audit trail back to its brief.
 */
```

- [ ] **Step 14: Run them to see them pass**

Run: `pnpm --filter @boom-busters/schemas exec vitest run`
Expected: PASS, the whole schemas suite.

- [ ] **Step 15: Write the failing tests for the two materialisers**

In `apps/web/lib/materialise.test.ts`, after the test `"resolves a graphic's logo keys, and drops the slot when one will not resolve"`, add:

```ts
  it("resolves a graphic-code payload's logo keys, leaving out one it cannot rather than the slot (decision 295)", async () => {
    const timeline = structuredClone(canonical())
    timeline.slots.push({
      type: 'graphic',
      startMs: 0,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: {
        kind: 'graphic-code',
        version: 1,
        compiled: 'function Graphic() { return null }',
        title: 'Funding round',
        words: [],
        durationMs: 4000,
        logos: {
          'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 },
        },
        claimIds: [],
      },
    })
    const resolved = await materialiseForPreview(timeline, {
      origin: ORIGIN,
      presign: (key) => Promise.resolve(`https://r2.example.com/${key}`),
    })
    const graphic = resolved.timeline.slots.find((slot) => slot.payload.kind === 'graphic-code')
    expect(
      graphic && graphic.payload.kind === 'graphic-code'
        ? graphic.payload.logos['Stability AI']?.url
        : null,
    ).toBe('https://r2.example.com/boom-busters/logos/abc.png')

    // The payload carries the whole library (ruling 5) and the code may read
    // none of it: the slot stays, without the mark it cannot have.
    const unsigned = await materialiseForPreview(timeline, { origin: ORIGIN, presign: null })
    const kept = unsigned.timeline.slots.find((slot) => slot.payload.kind === 'graphic-code')
    expect(kept && kept.payload.kind === 'graphic-code' ? kept.payload.logos : null).toEqual({})
  })
```

In `infra/lambdas/broker/core.test.ts`, after the test `"presigns a graphic's logo keys, and leaves the original untouched"`, add:

```ts
  it("presigns a graphic-code payload's logo keys, and leaves the original untouched (decision 295)", async () => {
    const original = canonicalTimeline()
    original.slots.push({
      type: 'graphic',
      startMs: 8000,
      durationMs: 4000,
      transition: 'cut',
      motion: { kind: 'static' },
      payload: {
        kind: 'graphic-code',
        version: 1,
        compiled: 'function Graphic() { return null }',
        title: 'Funding round',
        words: [],
        durationMs: 4000,
        logos: {
          'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 },
        },
        claimIds: [],
      },
    })
    const copy = await materialiseTimeline(original, (key) =>
      Promise.resolve(`https://signed/${key}`),
    )
    const graphic = copy.slots.find((slot) => slot.payload.kind === 'graphic-code')
    expect(
      graphic && graphic.payload.kind === 'graphic-code'
        ? graphic.payload.logos['Stability AI']?.url
        : null,
    ).toBe('https://signed/boom-busters/logos/abc.png')

    const originalGraphic = original.slots.find((slot) => slot.payload.kind === 'graphic-code')
    expect(
      originalGraphic && originalGraphic.payload.kind === 'graphic-code'
        ? originalGraphic.payload.logos['Stability AI']?.url
        : undefined,
    ).toBeUndefined()
  })
```

Run: `pnpm --filter @boom-busters/web exec vitest run lib/materialise.test.ts` and `pnpm --filter @boom-busters/infra exec vitest run lambdas/broker/core.test.ts`
Expected: FAIL in both new tests. The preview falls through to the image path and throws reading `r2Key` of `undefined` (the payload has no `src`); the broker leaves the logo's `url` undefined.

- [ ] **Step 16: Resolve the logos, and give the master a placeholder branch**

In `apps/web/lib/materialise.ts`, directly after the closing `}` of `if (slot.payload.kind === 'graphic') { ... }`, add:

```ts
    if (slot.payload.kind === 'graphic-code') {
      // The code is data; only the library's marks are bytes (decision 295).
      // The payload carries every mark the library holds and the code may read
      // none of them, so a mark that will not resolve is left out of the copy
      // rather than dropping the slot: code that reads it shows its title card,
      // and the rest of the film plays.
      const logos: typeof slot.payload.logos = {}
      for (const [title, ref] of Object.entries(slot.payload.logos)) {
        const url =
          ref.r2Key !== undefined ? await resolveKey(ref.r2Key, deps) : (ref.externalUrl ?? null)
        if (url !== null) logos[title] = { ...ref, url }
      }
      slots.push({ ...slot, payload: { ...slot.payload, logos } })
      continue
    }
```

(A scene graphic keeps its own rule, unchanged: one mark that will not resolve drops it, because a scene draws every mark it names.)

In `infra/lambdas/broker/core.ts`, replace `if (slot.payload.kind === 'graphic') {` in `materialiseTimeline` with:

```ts
    // A scene graphic's logos and, since decision 295, a coded graphic's.
    if (slot.payload.kind === 'graphic' || slot.payload.kind === 'graphic-code') {
```

In `packages/compositions/src/components/DocumentaryMaster.tsx`, in `SlotView`, replace:

```tsx
      ) : slot.payload.kind === 'social' ? (
```

with:

```tsx
      ) : slot.payload.kind === 'graphic-code' ? null : slot.payload.kind === 'social' ? (
```

(Task 2 replaces this `null` with `GraphicCode`; without the branch the final `AnimatedMap` branch receives a `graphic-code` payload and the package does not typecheck.)

- [ ] **Step 17: Run the tests and the consumers' checks**

Run: `pnpm --filter @boom-busters/web exec vitest run lib/materialise.test.ts` and `pnpm --filter @boom-busters/infra exec vitest run lambdas/broker/core.test.ts`
Expected: PASS.

Run (Bash `timeout: 600000`): `pnpm typecheck`
Expected: every package clean. A red package here is a consumer of the new union member or of the brief fields; fix it in this task, do not defer it.

Run: `pnpm lint`
Expected: zero warnings.

- [ ] **Step 18: Commit**

```bash
pnpm exec prettier --write packages/schemas/src/timeline.ts packages/schemas/src/timeline.test.ts apps/web/lib/materialise.ts apps/web/lib/materialise.test.ts infra/lambdas/broker/core.ts infra/lambdas/broker/core.test.ts packages/compositions/src/components/DocumentaryMaster.tsx
pnpm exec prettier --check packages/schemas/src/timeline.ts packages/schemas/src/timeline.test.ts apps/web/lib/materialise.ts apps/web/lib/materialise.test.ts infra/lambdas/broker/core.ts infra/lambdas/broker/core.test.ts packages/compositions/src/components/DocumentaryMaster.tsx
git add packages/schemas/src/timeline.ts packages/schemas/src/timeline.test.ts apps/web/lib/materialise.ts apps/web/lib/materialise.test.ts infra/lambdas/broker/core.ts infra/lambdas/broker/core.test.ts packages/compositions/src/components/DocumentaryMaster.tsx
git commit -m "feat(schemas): the graphic-code timeline payload (decision 295)

GraphicCodePayloadSchema embeds the compiled component, its words and
length, its logos keyed by entity, its claims and, for a chart, its
series. A graphic or chart slot may carry it; the slot type stays the
audit trail. The version is not pinned in the schema so a renderer that
does not know it can say so instead of failing the parse.

Both materialisers resolve its logos: the broker presigns them as it does
a scene graphic's, and the preview leaves out a mark it cannot resolve
rather than the slot, since the payload carries the whole library and the
code may read none of it. SlotView draws nothing for it until GraphicCode
lands.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 19: Write the failing test for a mark's size (ruling 25)**

In `packages/schemas/src/logos.test.ts`, change the first line to `import { describe, expect, expectTypeOf, it } from 'vitest'` and add `type LogoIndex,` to the import from `'./logos'`, after `logoForEntity,`.

In `describe('logoForEntity')`, replace the `logos` fixture with:

```ts
  const logos: LogoIndex[] = [
    { id: 'a', title: 'Stability AI', width: 1200, height: 400 },
    { id: 'b', title: 'Wirecard AG', width: null, height: null },
  ]
```

Every other mark literal in that `describe` (the two in `withSuffix`, the four inline arrays in `'refuses a name merely contained in a longer title, in either direction'`) gains `width: null, height: null` after its `title`. Then add, after `'returns null for an empty library'`:

```ts
  it('hands back the mark whole, its recorded size or null included (ruling 25)', () => {
    expectTypeOf<LogoIndex['width']>().toEqualTypeOf<number | null>()
    expectTypeOf<LogoIndex['height']>().toEqualTypeOf<number | null>()
    expect(logoForEntity('Stability AI', logos)).toEqual({
      id: 'a',
      title: 'Stability AI',
      width: 1200,
      height: 400,
    })
    expect(logoForEntity('Wirecard AG', logos)).toMatchObject({ width: null, height: null })
  })
```

Run: `pnpm --filter @boom-busters/schemas exec tsc --noEmit`
Expected: FAIL in `src/logos.test.ts` only: `Object literal may only specify known properties, and 'width' does not exist in type 'LogoIndex'`, and the two `expectTypeOf` lines. (Vitest does not typecheck, so the file already passes at run time; the type is what this step pins.)

- [ ] **Step 20: Give `LogoIndex` the size, everywhere it is built**

In `packages/schemas/src/logos.ts`, replace the `LogoIndex` interface and its one-line comment with:

```ts
/**
 * What a resolver needs to know about a mark: its id, the name it answers to
 * and the size it was stored at, null when none was recorded (both columns
 * are nullable). A design written as code is handed only the marks with a
 * size (decision 295, ruling 25): the render cannot place a mark it cannot
 * size, so the dry run never shows the code one.
 */
export interface LogoIndex {
  id: string
  title: string
  width: number | null
  height: number | null
}
```

Every place that builds the index from `listLogos` rows carries the row's size. In each of these seven files, replace `({ id: row.id, title: row.title ?? '' })` with `({ id: row.id, title: row.title ?? '', width: row.width, height: row.height })` (the row is an `assets` row, whose nullable integer `width` and `height` columns are already `number | null`):

- `apps/web/inngest/functions/visuals-runner.ts` (~:146, the `setup` step)
- `apps/web/inngest/functions/visuals-replanner.ts` (~:210, the `setup` step)
- `apps/web/inngest/functions/slot-retyper.ts` (~:157)
- `apps/web/inngest/functions/slot-rebriefer.ts` (~:197)
- `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (~:780)
- `apps/web/lib/graphic-design-core.ts` (~:239, `loadGraphicContextFrom`; Task 5 rewrites the file and keeps the size)
- `apps/web/scripts/live-plan-test.ts` (~:195)

The runners' `setup` is a memoised step, so a run parked before the deploy replays it with no sizes. Nothing reads them before Task 3's dry run, which treats a missing size as none (`!logo.width`): such a run hands the code no marks, never a mark it cannot size.

Two fixtures carry a size too: in `packages/schemas/src/visuals.test.ts` (~:374) `LOGOS`' one mark gains `width: 1200, height: 400`, and in `apps/web/inngest/lib/direction.test.ts` (~:458) the mark `{ id: 'logo-1', title: 'Wirecard AG' }` gains `width: 1200, height: 400`.

Run: `pnpm --filter @boom-busters/schemas exec vitest run src/logos.test.ts src/visuals.test.ts`
Expected: PASS.

Run (Bash `timeout: 600000`): `pnpm typecheck`
Expected: every package clean. A red file is one more place that builds a `LogoIndex`: give it the row's size (or, in a test, a size or `null`) in this step.

Run: `pnpm lint`
Expected: zero warnings.

```bash
pnpm exec prettier --write packages/schemas/src/logos.ts packages/schemas/src/logos.test.ts packages/schemas/src/visuals.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts" apps/web/lib/graphic-design-core.ts apps/web/scripts/live-plan-test.ts apps/web/inngest/lib/direction.test.ts
git add packages/schemas/src/logos.ts packages/schemas/src/logos.test.ts packages/schemas/src/visuals.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts" apps/web/lib/graphic-design-core.ts apps/web/scripts/live-plan-test.ts apps/web/inngest/lib/direction.test.ts
git commit -m "feat(schemas): a logo's index carries the size it was stored at (decision 295)

LogoIndex gains width and height, null when the library recorded none,
and every index built from listLogos rows carries the row's size, the
runners' setup steps included. The designer's dry run will hand code
only the marks with a size, as the assembly and the board already do,
so a mark the dry run showed is a mark the render has (ruling 25).

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 21: Run every consumer's suite (a shared schema changed)**

Start Docker Desktop first (`direction.test.ts` reads the test database), and run nothing else against the test database while this runs.

Run (Bash `timeout: 600000`), one after another:
- `pnpm --filter @boom-busters/schemas exec vitest run`
- `pnpm --filter @boom-busters/timeline exec vitest run`
- `pnpm --filter @boom-busters/providers exec vitest run`
- `pnpm --filter @boom-busters/compositions exec vitest run src/lib src/components src/fixtures`
- `pnpm --filter @boom-busters/infra exec vitest run lambdas/broker/core.test.ts`
- `pnpm --filter @boom-busters/web exec vitest run lib/materialise.test.ts lib/graphic-design.test.ts inngest/lib/direction.test.ts inngest/lib/assembly.test.ts inngest/lib/graphic-steps.test.ts`

Expected: all PASS. A failure here is this task's regression until shown otherwise: re-run the failing file alone before believing it, then fix it in this task.

---

### Task 2: Compositions: the sandbox, `GraphicCode` and its goldens

**Files:**
- Create: `packages/compositions/src/lib/graphic-code.ts`, `packages/compositions/src/lib/graphic-code.test.ts`, `packages/compositions/src/components/GraphicCode.tsx`, `packages/compositions/src/components/GraphicCode.test.tsx`, `packages/compositions/src/fixtures/graphic-code.ts`, goldens `packages/compositions/src/snapshot/golden/GraphicCodeWide.png` and `GraphicCodeTall.png`
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx` (~:178), `packages/compositions/src/Root.tsx`, `packages/compositions/src/snapshot/render.test.ts`, `packages/compositions/src/index.ts`, `packages/compositions/package.json` (subpath exports `./graphic-code` and `./graphic-code-fixture`; `jsdom` as a dev dependency), `pnpm-lock.yaml`
- Test: `packages/compositions/src/lib/graphic-code.test.ts`, `packages/compositions/src/components/GraphicCode.test.tsx`, `packages/compositions/src/components/DocumentaryMaster.test.tsx`, `packages/compositions/src/snapshot/render.test.ts`

**Interfaces:**
- Consumes: Task 1's `GraphicCodePayload`, `GRAPHIC_CODE_VERSION`; `safeArea` from `lib/graphic.ts`; `withAlpha`, `frameScale`, `typeStyle` from `components/brand.ts`; `mediaUrl` from `lib/motion.ts`; `loadBrandFonts`.
- Produces: `graphicFunctionBody`, `buildGraphic`, `remotionScope`, `graphicPropsFor`, `graphicBrand` (ruling 26: the brand mapping `graphicPropsFor` uses, shared with the dry run), `safeInsets`, `withAlpha` (re-exported from `components/brand.ts`), `GraphicProps`, `GraphicScope`, `GraphicComponent`, all on the subpath `@boom-busters/compositions/graphic-code`; `GRAPHIC_CODE_SOURCE` and `GRAPHIC_CODE_PAYLOAD` on the subpath `@boom-busters/compositions/graphic-code-fixture`; `GraphicCode`. The barrel exports `GraphicCode`, `buildGraphic`, `graphicFunctionBody`, `graphicPropsFor`, `graphicBrand`, `remotionScope`, `safeInsets`, `withAlpha`, `GRAPHIC_CODE_SOURCE` and the three types (ruling 13). Server code (Task 3) imports the two subpaths, never the barrel, which pulls in fonts, `@remotion/media` and the master.
- `GRAPHIC_CODE_SOURCE` is, character for character, the `GRAPHIC_CODE_FIXTURE_SOURCE` Task 4 writes in `packages/providers/src/prompts/graphic-code-fixture.ts` (ruling 10: that text was verified against esbuild, React and Remotion at slot lengths of 1 s to 30 s). Compositions may not depend on providers, so the equality test lives in Task 4 (`graphic-code-fixture.test.ts`), which reads this file off disk. The source therefore contains no backtick, no backslash and no `${`.

`GraphicCode.test.tsx` runs in jsdom because React's server renderer never calls an error boundary, and the boundary is what it tests.

- [ ] **Step 1: Write the failing test for the sandbox**

Create `packages/compositions/src/lib/graphic-code.test.ts`:

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Easing, interpolate, spring } from 'remotion'
import { describe, expect, it } from 'vitest'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import { withAlpha } from '../components/brand'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { safeArea } from './graphic'
import {
  buildGraphic,
  graphicBrand,
  graphicFunctionBody,
  graphicPropsFor,
  remotionScope,
  safeInsets,
  withAlpha as sandboxWithAlpha,
  type GraphicScope,
} from './graphic-code'

const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }

const PAYLOAD: GraphicCodePayload = {
  kind: 'graphic-code',
  version: 1,
  compiled: 'function Graphic() { return null }',
  title: 'Four billion, on paper',
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion.', atMs: 380 },
  ],
  durationMs: 6000,
  logos: {},
  claimIds: ['01HQ00000000000000000000AA'],
}

/** The real scope with the test's own clock: outside a composition the hook has no frame to read. */
function scopeAt(frame: number): GraphicScope {
  return { ...remotionScope(), useCurrentFrame: () => frame }
}

function render(compiled: string, scope: GraphicScope): string {
  const Graphic = buildGraphic(compiled, scope)
  return renderToStaticMarkup(createElement(Graphic, graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE)))
}

describe('graphicFunctionBody', () => {
  it('returns the component the source declares', () => {
    expect(graphicFunctionBody('function Graphic() {}')).toBe(
      'function Graphic() {}\nreturn Graphic',
    )
  })
})

describe('buildGraphic (decision 295)', () => {
  it('hands the code React, the Remotion scope and the props, and renders what it returns', () => {
    const compiled =
      "function Graphic(props) { return React.createElement('p', null, Remotion.useCurrentFrame() + '/' + props.durationMs + '/' + Remotion.withAlpha(props.brand.colors.accent, 0.5)) }"
    expect(render(compiled, scopeAt(42))).toBe(
      `<p>42/6000/${withAlpha(FIXTURE_BRAND.colors.accent, 0.5)}</p>`,
    )
  })

  it("runs helpers beside Graphic, and top-level code sees this render's props", () => {
    const compiled = [
      'function label(n) { return n + " ms" }',
      'const outer = props',
      "function Graphic(p) { return React.createElement('b', null, label(p.durationMs) + (outer === p ? ' same' : ' different')) }",
    ].join('\n')
    expect(render(compiled, scopeAt(0))).toBe('<b>6000 ms same</b>')
  })

  it('builds once per code and scope, and again for another scope', () => {
    const compiled = "function Graphic() { return React.createElement('i', null, 'x') }"
    const scope = scopeAt(0)
    expect(buildGraphic(compiled, scope)).toBe(buildGraphic(compiled, scope))
    expect(buildGraphic(compiled, scopeAt(0))).not.toBe(buildGraphic(compiled, scope))
  })

  it('keeps at most 32 builds per scope, dropping the least recently used', () => {
    const scope = scopeAt(0)
    const code = (n: number) =>
      `function Graphic() { return React.createElement('i', null, 'n${n}') }`
    const first = buildGraphic(code(0), scope)
    const second = buildGraphic(code(1), scope)
    for (let n = 2; n < 32; n += 1) buildGraphic(code(n), scope)
    // A hit moves the first build to the back of the queue.
    expect(buildGraphic(code(0), scope)).toBe(first)
    // The 33rd build evicts the coldest, which is now the second.
    buildGraphic(code(32), scope)
    expect(buildGraphic(code(1), scope)).not.toBe(second)
    expect(buildGraphic(code(0), scope)).toBe(first)
  })

  it('throws at build when the code does not parse', () => {
    expect(() => buildGraphic('function Graphic( {', scopeAt(0))).toThrow(SyntaxError)
  })

  it('throws at render, naming Graphic, when the code never declares it', () => {
    expect(() => render('function Chart() { return null }', scopeAt(0))).toThrow(/Graphic/)
  })
})

describe('remotionScope', () => {
  it('is exactly the nine names the sandbox promises, the real ones, frozen and shared', () => {
    const scope = remotionScope()
    expect(Object.keys(scope).sort()).toEqual(
      [
        'AbsoluteFill',
        'Easing',
        'Img',
        'Sequence',
        'interpolate',
        'spring',
        'useCurrentFrame',
        'useVideoConfig',
        'withAlpha',
      ].sort(),
    )
    expect(scope.interpolate).toBe(interpolate)
    expect(scope.spring).toBe(spring)
    expect(scope.Easing).toBe(Easing)
    expect(scope.withAlpha).toBe(withAlpha)
    // The subpath re-exports the same function, for the dry run and the still.
    expect(sandboxWithAlpha).toBe(withAlpha)
    expect(Object.isFrozen(scope)).toBe(true)
    expect(remotionScope()).toBe(scope)
  })
})

describe('safeInsets', () => {
  it("gives the code the graphic card's safe area as rounded insets from each edge", () => {
    expect(safeInsets(WIDE)).toEqual({ top: 36, right: 36, bottom: 270, left: 36 })
    expect(safeInsets(TALL)).toEqual({ top: 36, right: 36, bottom: 699, left: 36 })
    for (const frame of [WIDE, TALL]) {
      const box = safeArea(frame)
      expect(safeInsets(frame)).toEqual({
        top: Math.round(box.y),
        right: Math.round(frame.width - box.x - box.w),
        bottom: Math.round(frame.height - box.y - box.h),
        left: Math.round(box.x),
      })
    }
  })
})

describe('graphicBrand (ruling 26)', () => {
  it("passes the brand's colours and names its loaded font family for each type role", () => {
    const brand = graphicBrand(FIXTURE_BRAND)
    expect(brand.colors).toBe(FIXTURE_BRAND.colors)
    expect(brand.fonts).toEqual({
      heading: FIXTURE_BRAND.typography.heading.family,
      title: FIXTURE_BRAND.typography.title.family,
      body: FIXTURE_BRAND.typography.body.family,
      numbers: FIXTURE_BRAND.typography.numbers.family,
      captions: FIXTURE_BRAND.typography.captions.family,
    })
  })
})

describe('graphicPropsFor', () => {
  it('hands the code the brand as graphicBrand maps it', () => {
    expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE).brand).toEqual(graphicBrand(FIXTURE_BRAND))
  })

  it('hands the code safeInsets for each frame size', () => {
    for (const frame of [WIDE, TALL]) {
      expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, frame).safeArea).toEqual(safeInsets(frame))
    }
  })

  it('hands over the logos by entity as plain sources, the words, the length and any chart data', () => {
    const props = graphicPropsFor(
      {
        ...PAYLOAD,
        logos: {
          'Stability AI': {
            r2Key: 'boom-busters/logos/abc.png',
            url: 'https://example.com/abc.png',
            width: 1200,
            height: 400,
          },
        },
        data: {
          series: [
            {
              label: 'Valuation',
              unit: 'USD Millions',
              points: [
                { x: '2022', y: 1000 },
                { x: '2023', y: 4000 },
              ],
            },
          ],
          takeaway: 'Four times in a year.',
        },
      },
      FIXTURE_BRAND,
      WIDE,
    )
    expect(props.logos).toEqual({
      'Stability AI': { src: 'https://example.com/abc.png', width: 1200, height: 400 },
    })
    expect(props.words).toBe(PAYLOAD.words)
    expect(props.durationMs).toBe(6000)
    expect(props.data?.takeaway).toBe('Four times in a year.')
    expect(graphicPropsFor(PAYLOAD, FIXTURE_BRAND, WIDE)).not.toHaveProperty('data')
  })

  it('refuses an unmaterialised logo, as every composition does', () => {
    const unsigned = {
      ...PAYLOAD,
      logos: { Acme: { r2Key: 'boom-busters/logos/acme.png', width: 10, height: 10 } },
    }
    expect(() => graphicPropsFor(unsigned, FIXTURE_BRAND, WIDE)).toThrow(/unmaterialised/)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/lib/graphic-code.test.ts`
Expected: FAIL, the file cannot import `./graphic-code`.

- [ ] **Step 3: Write the sandbox**

Create `packages/compositions/src/lib/graphic-code.ts`:

```ts
import * as React from 'react'
import type { ComponentType, CSSProperties, ReactElement, ReactNode } from 'react'
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import type { BrandKitTokens, GraphicCodePayload } from '@boom-busters/schemas'
import { withAlpha } from '../components/brand'
import { safeArea } from './graphic'
import { mediaUrl } from './motion'

/** Re-exported for the web server's dry run and the board's still, which build a scope of their own. */
export { withAlpha }

/**
 * The sandbox the designer's graphic runs in (decision 295).
 *
 * The designer writes one React component, `function Graphic(props)`, with
 * helpers beside it. Its compiled code becomes the body of
 * `new Function('React', 'Remotion', 'props', body)`, with `return Graphic`
 * appended, so the code has no module scope: it reaches React, the nine names
 * in `GraphicScope` and its props, and nothing it could import around. The
 * static scan on the web server bans the globals (`window`, `fetch`, timers,
 * `Date`, `Math.random` and the rest) before code is ever stored; this file
 * is the other half, the arguments.
 *
 * One contract, three callers: `GraphicCode` here and on Lambda, the board's
 * player in the browser, and the dry run on the web server, which builds the
 * same body with `graphicFunctionBody` and a scope of plain functions.
 */

/** Everything the code is handed. Colours are hex strings; fonts are loaded family names. */
export interface GraphicProps {
  brand: {
    colors: BrandKitTokens['colors']
    fonts: { heading: string; title: string; body: string; numbers: string; captions: string }
  }
  words: readonly { text: string; atMs: number }[]
  durationMs: number
  safeArea: { top: number; right: number; bottom: number; left: number }
  logos: Readonly<Record<string, { src: string; width: number; height: number }>>
  data?: GraphicCodePayload['data']
}

/** The `Remotion` argument: these nine names and nothing else. `withAlpha` is ours. */
export interface GraphicScope {
  useCurrentFrame: () => number
  useVideoConfig: () => { width: number; height: number; fps: number; durationInFrames: number }
  interpolate: typeof interpolate
  spring: typeof spring
  Easing: typeof Easing
  Sequence: ComponentType<{ from?: number; durationInFrames?: number; children?: ReactNode }>
  AbsoluteFill: ComponentType<{ style?: CSSProperties; children?: ReactNode }>
  Img: ComponentType<{ src: string; style?: CSSProperties }>
  withAlpha: (hex: string, alpha: number) => string
}

export type GraphicComponent = (props: GraphicProps) => ReactElement | null

/** What `new Function` makes of the body: the declarations run, `Graphic` comes back. */
type SandboxFunction = (
  react: typeof React,
  remotion: GraphicScope,
  props: GraphicProps,
) => GraphicComponent

/** `${compiled}\nreturn Graphic` */
export function graphicFunctionBody(compiled: string): string {
  return `${compiled}\nreturn Graphic`
}

/**
 * Builds kept per scope, then per code. A film has a few dozen graphics and a
 * player mounts one at a time, so 32 per scope is plenty; the least recently
 * used build goes first.
 */
const BUILT_MAX = 32
const built = new WeakMap<GraphicScope, Map<string, GraphicComponent>>()

/**
 * new Function('React', 'Remotion', 'props', graphicFunctionBody(compiled)), bound to the scope.
 *
 * Parsed once per code and scope, so a component keeps one identity across
 * frames and React never remounts it. The outer function runs on every
 * render with that render's props and the `Graphic` it returns is called
 * directly, so the hooks inside belong to this component, and top-level
 * code reads the same props the dry run hands it. Code that does not parse
 * throws here; code that never declares `Graphic` throws at its first render.
 *
 * The dry run on the web server takes the equivalent path inside a `vm`
 * context: it compiles the same `graphicFunctionBody` as a function of
 * (React, Remotion, props), calls it with the props and renders the `Graphic`
 * it returns as a component. For a pure component the two paths draw the same
 * frames (ruling 15).
 */
export function buildGraphic(compiled: string, scope: GraphicScope): GraphicComponent {
  let byCode = built.get(scope)
  if (byCode === undefined) {
    byCode = new Map()
    built.set(scope, byCode)
  }
  const cached = byCode.get(compiled)
  if (cached !== undefined) {
    // Most recently used goes to the back, so the bound evicts the coldest.
    byCode.delete(compiled)
    byCode.set(compiled, cached)
    return cached
  }
  const sandbox = new Function(
    'React',
    'Remotion',
    'props',
    graphicFunctionBody(compiled),
  ) as SandboxFunction
  const component: GraphicComponent = (props) => sandbox(React, scope, props)(props)
  if (byCode.size >= BUILT_MAX) {
    const coldest = byCode.keys().next().value
    if (coldest !== undefined) byCode.delete(coldest)
  }
  byCode.set(compiled, component)
  return component
}

let liveScope: GraphicScope | undefined

/**
 * The real Remotion scope. One frozen object, shared: `buildGraphic` keys its
 * builds on the scope, and a graphic cannot reassign a name another graphic
 * reads.
 */
export function remotionScope(): GraphicScope {
  liveScope ??= Object.freeze({
    useCurrentFrame,
    useVideoConfig,
    interpolate,
    spring,
    Easing,
    Sequence,
    AbsoluteFill,
    Img,
    withAlpha,
  })
  return liveScope
}

/**
 * The graphic card's safe area (`safeArea`) as `props.safeArea` carries it:
 * rounded insets from each edge of the frame (the margin, and the caption
 * band at the bottom). One helper for `GraphicCode`, the web server's dry run
 * and the board's still, so all three hand the code the same numbers.
 */
export function safeInsets(frame: { width: number; height: number }): GraphicProps['safeArea'] {
  const box = safeArea(frame)
  return {
    top: Math.round(box.y),
    right: Math.round(frame.width - box.x - box.w),
    bottom: Math.round(frame.height - box.y - box.h),
    left: Math.round(box.x),
  }
}

/**
 * A Brand Kit as `props.brand`: its colours, and each type role's family (the
 * faces `loadBrandFonts` loaded). One helper for `graphicPropsFor` and the web
 * server's dry run (ruling 26), so the code is handed the same names in both.
 */
export function graphicBrand(brand: BrandKitTokens): GraphicProps['brand'] {
  const { heading, title, body, numbers, captions } = brand.typography
  return {
    colors: brand.colors,
    fonts: {
      heading: heading.family,
      title: title.family,
      body: body.family,
      numbers: numbers.family,
      captions: captions.family,
    },
  }
}

/**
 * The props for one frame size: the brand as `graphicBrand` maps it, the
 * safe area as insets from each edge (`safeInsets`), the length the dry run
 * checked the code at (always `payload.durationMs`, ruling 7) and the logos
 * by entity as plain sources. A logo still carrying only a key throws, as
 * every composition does: a render reads materialised timelines only.
 */
export function graphicPropsFor(
  payload: GraphicCodePayload,
  brand: BrandKitTokens,
  frame: { width: number; height: number },
): GraphicProps {
  return {
    brand: graphicBrand(brand),
    words: payload.words,
    durationMs: payload.durationMs,
    safeArea: safeInsets(frame),
    logos: Object.fromEntries(
      Object.entries(payload.logos).map(([entity, ref]) => [
        entity,
        { src: mediaUrl(ref), width: ref.width, height: ref.height },
      ]),
    ),
    ...(payload.data !== undefined ? { data: payload.data } : {}),
  }
}
```

In `packages/compositions/package.json`, in `exports`, after `"./graphic-motion": "./src/lib/graphic-motion.ts",` add:

```json
    "./graphic-code": "./src/lib/graphic-code.ts",
```

- [ ] **Step 4: Run it to see it pass, and typecheck**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/lib/graphic-code.test.ts`
Expected: PASS, 14 tests.
Run: `pnpm --filter @boom-busters/compositions exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/compositions/src/lib/graphic-code.ts packages/compositions/src/lib/graphic-code.test.ts packages/compositions/package.json
pnpm exec prettier --check packages/compositions/src/lib/graphic-code.ts packages/compositions/src/lib/graphic-code.test.ts packages/compositions/package.json
git add packages/compositions/src/lib/graphic-code.ts packages/compositions/src/lib/graphic-code.test.ts packages/compositions/package.json
git commit -m "feat(compositions): the sandbox the designer's graphic runs in (decision 295)

The compiled code becomes the body of new Function('React', 'Remotion',
'props', ...) with return Graphic appended, so it reaches React, nine
Remotion names and its props, and nothing else. buildGraphic parses once
per code and scope and keeps the component's identity across frames;
remotionScope is the real scope, frozen and shared; graphicPropsFor hands
the code the brand's colours and families (graphicBrand, which the dry
run shares), the slot length it was checked at, the safe area as rounded
insets (safeInsets, which the dry run and the board's still share) and
the logos by entity. withAlpha is re-exported for the scopes the dry run
and the still build.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Add jsdom for the boundary test**

Run (Bash `timeout: 600000`): `pnpm --filter @boom-busters/compositions add -D jsdom@^28.0.1`
Expected: `packages/compositions/package.json` gains `"jsdom": "^28.0.1"` under `devDependencies` and `pnpm-lock.yaml` links the 28.1.0 already in the store for `apps/web`. No other package changes.

- [ ] **Step 7: Write the failing test for `GraphicCode` and the fixture**

Create `packages/compositions/src/components/GraphicCode.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { GraphicCodePayloadSchema } from '@boom-busters/schemas'
import type { GraphicCodePayload } from '@boom-busters/schemas'
import { GRAPHIC_CODE_PAYLOAD, GRAPHIC_CODE_SOURCE } from '../fixtures/graphic-code'
import { FIXTURE_BRAND } from '../fixtures/timeline'
import { GraphicCode } from './GraphicCode'

/**
 * `GraphicCode` mounted with React's client renderer in jsdom: the error
 * boundary is the thing under test, and React's server renderer never calls
 * a boundary. The two Remotion hooks are stubbed as in
 * DocumentaryMaster.test.tsx, so the frame and its size are the test's to
 * set; everything else the sandbox hands the code (interpolate, spring,
 * Easing) is Remotion's own.
 */
const clock = vi.hoisted(() => ({ frame: 0, width: 1920, height: 1080 }))

vi.mock('remotion', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    useCurrentFrame: () => clock.frame,
    useVideoConfig: () => ({
      fps: 30,
      width: clock.width,
      height: clock.height,
      durationInFrames: 240,
    }),
  }
})
// A render loads the faces from Google Fonts; a test has no network and needs none.
vi.mock('../fonts/load', () => ({ loadBrandFonts: () => Promise.resolve() }))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Root[] = []

async function mount(element: ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  roots.push(root)
  await act(async () => {
    root.render(element)
  })
  return {
    text: () => host.textContent ?? '',
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(next)
      })
    },
  }
}

let errors: MockInstance<typeof console.error>

beforeEach(() => {
  clock.frame = 0
  clock.width = 1920
  clock.height = 1080
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await act(async () => {
      root.unmount()
    })
  }
  document.body.innerHTML = ''
  errors.mockRestore()
})

/** Our own reports, apart from the one React logs for every error a boundary catches. */
function reports(): string[] {
  return errors.mock.calls
    .map((call) => String(call[0]))
    .filter((message) => message.startsWith('graphic-code:'))
}

function payload(overrides: Partial<GraphicCodePayload>): GraphicCodePayload {
  return { ...GRAPHIC_CODE_PAYLOAD, ...overrides }
}

describe('GraphicCode (decision 295)', () => {
  it('plays the fixture from its first frame: the title is there and the figure counts from nothing', async () => {
    const view = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(view.text()).toContain('Raised in one round')
    expect(view.text()).toContain('$0bn')
    expect(reports()).toEqual([])
  })

  it('holds its ending in both frames: the figure has landed and the second line is up', async () => {
    clock.frame = 240
    const wide = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(wide.text()).toContain('$4bn')
    expect(wide.text()).toContain('Then the next step')

    clock.width = 1080
    clock.height = 1920
    const tall = await mount(
      <GraphicCode payload={GRAPHIC_CODE_PAYLOAD} brand={FIXTURE_BRAND} durationInFrames={240} />,
    )
    expect(tall.text()).toContain('Raised in one round')
    expect(tall.text()).toContain('$4bn')
    expect(tall.text()).toContain('Then the next step')
    expect(reports()).toEqual([])
  })

  it('shows the title card when the code throws, and reports it once', async () => {
    const broken = payload({ compiled: 'function Graphic() { throw new Error("boom") }' })
    const view = await mount(<GraphicCode payload={broken} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(broken.title)

    clock.frame = 30
    await view.rerender(<GraphicCode payload={broken} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(broken.title)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain(broken.title)
  })

  it('shows the title card when the code does not parse', async () => {
    const view = await mount(
      <GraphicCode payload={payload({ compiled: 'function Graphic( {' })} brand={FIXTURE_BRAND} />,
    )
    expect(view.text()).toBe(GRAPHIC_CODE_PAYLOAD.title)
  })

  it('shows the title card for a sandbox version it does not know, without running the code', async () => {
    const future = payload({ version: 2, compiled: 'this is not code' })
    const view = await mount(<GraphicCode payload={future} brand={FIXTURE_BRAND} />)
    expect(view.text()).toBe(future.title)
    await view.rerender(<GraphicCode payload={future} brand={FIXTURE_BRAND} />)
    expect(reports()).toHaveLength(1)
    expect(reports()[0]).toContain('version 2')
  })
})

describe('the fixture graphic', () => {
  it('is a valid graphic-code payload', () => {
    const parsed = GraphicCodePayloadSchema.parse(JSON.parse(JSON.stringify(GRAPHIC_CODE_PAYLOAD)))
    expect(parsed).toEqual(GRAPHIC_CODE_PAYLOAD)
  })

  it('is plain JavaScript that declares Graphic in under 120 lines, with no colour of its own', () => {
    expect(GRAPHIC_CODE_SOURCE).toMatch(/^function Graphic\(props\) \{$/m)
    // No JSX, no hex colour, and nothing that would break the verbatim copy of providers' text.
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/[<#`\\]|\$\{/)
    expect(GRAPHIC_CODE_SOURCE).not.toMatch(/\b(rgb|rgba|hsl)\(/)
    expect(GRAPHIC_CODE_SOURCE.split('\n').length).toBeLessThan(120)
    expect(GRAPHIC_CODE_PAYLOAD.compiled).toBe(GRAPHIC_CODE_SOURCE)
  })
})
```

- [ ] **Step 8: Run it to see it fail**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/GraphicCode.test.tsx`
Expected: FAIL, the file cannot import `../fixtures/graphic-code` or `./GraphicCode`.

- [ ] **Step 9: Write the fixture**

Create `packages/compositions/src/fixtures/graphic-code.ts`:

```ts
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { GraphicCodePayload } from '@boom-busters/schemas'

/**
 * The house fixture for the designer's code (decision 295): the source the
 * mock designer answers with, the dry run's passing case and the source of
 * the `GraphicCodeWide` and `GraphicCodeTall` goldens. It is, character for
 * character, providers' `GRAPHIC_CODE_FIXTURE_SOURCE`
 * (`packages/providers/src/prompts/graphic-code-fixture.ts`), held equal by a
 * test there that reads this file off disk, so it carries no backtick, no
 * backslash and no `${`.
 *
 * It is plain JavaScript with `React.createElement`, not JSX, so the code
 * the sandbox runs is the code written here. It is what the checks ask of
 * any design: it reads the frame and the frame size, lays out for 16:9 and
 * 9:16, takes every colour and face from its props, pads itself in by the
 * safe area and positions nothing absolutely. A title fades in, the figure
 * counts up to $4bn over the first second (the passing values hold for less
 * than a second, so only "$4bn" is shown), an underline sweeps from the count
 * to the slot's end so nothing is ever still, a second line rises in halfway,
 * and the last frame holds with all its text up.
 */
export const GRAPHIC_CODE_SOURCE = `function Graphic(props) {
  const h = React.createElement
  const frame = Remotion.useCurrentFrame()
  const video = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = video.height > video.width
  const unit = Math.min(video.width, video.height) / 1080
  const last = Math.max(1, video.durationInFrames - 1)
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

  // The title fades in; the figure counts up to $4bn over the first second.
  const titleIn = Remotion.interpolate(frame, [0, 12], [0, 1], clamp)
  const landAt = Math.min(9, Math.max(0, last - video.fps))
  const count = Remotion.spring({
    frame: frame,
    fps: video.fps,
    delay: landAt,
    durationInFrames: video.fps,
    config: { damping: 200 },
  })
  const figure = '$' + Math.round(count * 40) / 10 + 'bn'

  // The underline sweeps from the count to the slot's end, so the graphic
  // never sits still; a second line rises in halfway through.
  const sweepFrom = landAt + video.fps
  const sweep = Remotion.interpolate(frame, [sweepFrom, Math.max(sweepFrom + 1, last)], [0, 1], clamp)
  const half = Math.round(last / 2)
  const nextIn = Remotion.interpolate(frame, [half, half + 12], [0, 1], clamp)

  return h(
    Remotion.AbsoluteFill,
    {
      style: {
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
        justifyContent: 'center',
        alignItems: portrait ? 'center' : 'flex-start',
        textAlign: portrait ? 'center' : 'left',
      },
    },
    h(
      'div',
      {
        style: {
          fontFamily: fonts.title,
          fontSize: 56 * unit,
          color: colors.textSecondary,
          opacity: titleIn,
        },
      },
      'Raised in one round',
    ),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.numbers,
          fontSize: 240 * unit,
          lineHeight: 1.1,
          color: colors.accent,
        },
      },
      figure,
    ),
    h('div', {
      style: {
        height: 10 * unit,
        width: sweep * (portrait ? 80 : 50) + '%',
        backgroundColor: colors.accent,
      },
    }),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.body,
          fontSize: 44 * unit,
          marginTop: 24 * unit,
          color: colors.textPrimary,
          opacity: nextIn,
          transform: 'translateY(' + (1 - nextIn) * 24 * unit + 'px)',
        },
      },
      'Then the next step',
    ),
  )
}
`

/**
 * The fixture as a timeline payload: an 8 s slot, no logos, one claim. The
 * claim's text is not in a payload; a test that runs the fixture through the
 * facts check supplies a claim holding "$4 billion".
 */
export const GRAPHIC_CODE_PAYLOAD: GraphicCodePayload = {
  kind: 'graphic-code',
  version: GRAPHIC_CODE_VERSION,
  // Plain JavaScript runs as written.
  compiled: GRAPHIC_CODE_SOURCE,
  title: 'Four billion, on paper',
  words: [
    { text: 'Four', atMs: 0 },
    { text: 'billion', atMs: 360 },
    { text: 'dollars.', atMs: 820 },
  ],
  durationMs: 8000,
  logos: {},
  claimIds: ['01HQ00000000000000000000AA'],
}
```

In `packages/compositions/package.json`, in `exports`, after the `"./graphic-code"` line Step 3 added, add:

```json
    "./graphic-code-fixture": "./src/fixtures/graphic-code.ts",
```

- [ ] **Step 10: Write `GraphicCode`**

Create `packages/compositions/src/components/GraphicCode.tsx`:

```tsx
import { Component, type ReactNode } from 'react'
import { AbsoluteFill, useVideoConfig } from 'remotion'
import { GRAPHIC_CODE_VERSION } from '@boom-busters/schemas'
import type { BrandKitTokens, GraphicCodePayload } from '@boom-busters/schemas'
import { loadBrandFonts } from '../fonts/load'
import { safeArea } from '../lib/graphic'
import {
  buildGraphic,
  graphicPropsFor,
  remotionScope,
  type GraphicProps,
} from '../lib/graphic-code'
import { frameScale, typeStyle } from './brand'

/**
 * The designer's graphic (decision 295): the component the designer wrote,
 * built once from `payload.compiled` and played inside the house frame, the
 * background and radial lift `GraphicCard` draws, in the brand's loaded faces.
 *
 * The code was checked before it was stored (a scan, a compile, a dry run in
 * both frames, the facts), but a render must not depend on the checks having caught
 * everything: an error boundary turns a throw into the slot's title on the
 * brand background, so one graphic can never fail a master render. A payload
 * whose sandbox version this renderer does not know gets the same card, and
 * its code is never run.
 */
export function GraphicCode({
  payload,
  brand,
}: {
  payload: GraphicCodePayload
  brand: BrandKitTokens
  /**
   * The slot's own length, which the master hands every card. Not read: the
   * code reads its frame count from `useVideoConfig`, and `props.durationMs`
   * is always `payload.durationMs`, the length the dry run checked (ruling
   * 7), so a slot the compiler stretched holds the code's ending.
   */
  durationInFrames?: number
}) {
  const { width, height } = useVideoConfig()
  // Idempotent; @remotion/google-fonts handles delayRender internally.
  loadBrandFonts(brand.typography)
  const { colors } = brand
  const titleCard = <GraphicTitleCard title={payload.title} brand={brand} />

  let content: ReactNode = titleCard
  if (payload.version !== GRAPHIC_CODE_VERSION) {
    reportUnknownVersion(payload.version, payload.title)
  } else {
    const props: GraphicProps = graphicPropsFor(payload, brand, { width, height })
    // Keyed on the code, so a redesign gets a boundary that has not failed.
    content = (
      <GraphicBoundary key={payload.compiled} title={payload.title} fallback={titleCard}>
        <SandboxedGraphic compiled={payload.compiled} props={props} />
      </GraphicBoundary>
    )
  }

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      <AbsoluteFill>{content}</AbsoluteFill>
    </AbsoluteFill>
  )
}

/**
 * Builds inside the boundary, so code that does not even parse is caught like
 * code that throws. `buildGraphic` memoises on the code, so this is one build
 * per graphic, not one per frame.
 */
function SandboxedGraphic({ compiled, props }: { compiled: string; props: GraphicProps }) {
  const Graphic = buildGraphic(compiled, remotionScope())
  return <Graphic {...props} />
}

/**
 * Catches a throw anywhere in the designer's component and shows the title
 * card instead. It reports once: the boundary keeps its failed state across
 * frames, so a render logs the failure at the frame it happened and draws the
 * card from then on.
 */
class GraphicBoundary extends Component<
  { title: string; fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error(
      `graphic-code: "${this.props.title}" threw while rendering, so it shows its title card`,
      error,
    )
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Versions already reported, so a render logs an unknown one once, not every frame. */
const reportedVersions = new Set<number>()

function reportUnknownVersion(version: number, title: string): void {
  if (reportedVersions.has(version)) return
  reportedVersions.add(version)
  console.error(
    `graphic-code: "${title}" was written for sandbox version ${version}, and this renderer knows version ${GRAPHIC_CODE_VERSION}, so it shows its title card`,
  )
}

/** The slot's title in the heading type, centred in the safe area, on the frame's background. */
function GraphicTitleCard({ title, brand }: { title: string; brand: BrandKitTokens }) {
  const { width, height } = useVideoConfig()
  const area = safeArea({ width, height })
  return (
    <div
      style={{
        position: 'absolute',
        left: area.x,
        top: area.y,
        width: area.w,
        height: area.h,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          ...typeStyle(brand.typography.heading, 72, frameScale(width, height)),
          color: brand.colors.textPrimary,
          textAlign: 'center',
        }}
      >
        {title}
      </div>
    </div>
  )
}
```

- [ ] **Step 11: Run it to see it pass, and typecheck**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/GraphicCode.test.tsx src/lib/graphic-code.test.ts`
Expected: PASS, 7 tests in `GraphicCode.test.tsx` and 14 in `graphic-code.test.ts`.
Run: `pnpm --filter @boom-busters/compositions exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write packages/compositions/src/components/GraphicCode.tsx packages/compositions/src/components/GraphicCode.test.tsx packages/compositions/src/fixtures/graphic-code.ts packages/compositions/package.json
pnpm exec prettier --check packages/compositions/src/components/GraphicCode.tsx packages/compositions/src/components/GraphicCode.test.tsx packages/compositions/src/fixtures/graphic-code.ts packages/compositions/package.json
git add packages/compositions/src/components/GraphicCode.tsx packages/compositions/src/components/GraphicCode.test.tsx packages/compositions/src/fixtures/graphic-code.ts packages/compositions/package.json pnpm-lock.yaml
git commit -m "feat(compositions): GraphicCode plays the designer's graphic in the house frame (decision 295)

The component the designer wrote runs inside GraphicCard's background and
radial lift, in the brand's loaded faces. An error boundary turns a throw,
or code that does not parse, into the slot's title in the heading type and
reports it once; a sandbox version the renderer does not know gets the
same card without its code being run. The code is handed the length the
dry run checked, never the slot's. The fixture is plain JavaScript, the
mock designer's text character for character: a title, a figure counting
to \$4bn on a spring, an underline sweeping to the slot's end and a second
line at half the slot, in both frames. jsdom joins the dev dependencies
because React's server renderer never calls a boundary.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 13: Write the failing test for the master's dispatch**

In `packages/compositions/src/components/DocumentaryMaster.test.tsx`:

1. After `vi.mock('./ChartReveal', ...)` add:

```tsx
vi.mock('./GraphicCode', () => ({ GraphicCode: () => <div data-testid="graphic-code" /> }))
```

2. After `const CHART_SLOT: TimelineSlot = { ... }` add:

```tsx
const GRAPHIC_CODE_SLOT: TimelineSlot = {
  type: 'graphic',
  startMs: 0,
  durationMs: 4000,
  transition: 'cut',
  motion: { kind: 'static' },
  payload: {
    kind: 'graphic-code',
    version: 1,
    compiled: 'function Graphic() { return null }',
    title: 'Four billion, on paper',
    words: [],
    durationMs: 4000,
    logos: {},
    claimIds: [],
  },
}
```

3. Append at the end of the file:

```tsx
describe('SlotView dispatch (decision 295)', () => {
  it("draws the designer's code with GraphicCode, and never grades it", () => {
    const markup = renderToStaticMarkup(
      <SlotView slot={GRAPHIC_CODE_SLOT} brand={FIXTURE_BRAND} />,
    )
    expect(markup).toContain('data-testid="graphic-code"')
    expect(markup).not.toContain('filter:')
  })
})
```

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/DocumentaryMaster.test.tsx`
Expected: FAIL in the new test: Task 1's placeholder branch renders nothing, so the markup has no `graphic-code` test id.

- [ ] **Step 14: Dispatch to `GraphicCode`, and export the sandbox**

In `packages/compositions/src/components/DocumentaryMaster.tsx`:

1. After `import { GraphicCard } from './GraphicCard'` add:

```tsx
import { GraphicCode } from './GraphicCode'
```

2. In `SlotView`, replace the `graphic-code` branch Task 1 left rendering `null` (the condition `slot.payload.kind === 'graphic-code' ? null :`) so that the chain from the `graphic` branch to the `social` branch reads:

```tsx
      ) : slot.payload.kind === 'graphic' ? (
        <GraphicCard payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : slot.payload.kind === 'graphic-code' ? (
        <GraphicCode payload={slot.payload} brand={brand} durationInFrames={durationInFrames} />
      ) : slot.payload.kind === 'social' ? (
```

In `packages/compositions/src/index.ts`, after `export { GraphicCard } from './components/GraphicCard'` add:

```ts
export { GraphicCode } from './components/GraphicCode'
export {
  buildGraphic,
  graphicBrand,
  graphicFunctionBody,
  graphicPropsFor,
  remotionScope,
  safeInsets,
  withAlpha,
} from './lib/graphic-code'
export type { GraphicComponent, GraphicProps, GraphicScope } from './lib/graphic-code'
export { GRAPHIC_CODE_SOURCE } from './fixtures/graphic-code'
```

These are exactly the names ruling 13 lists for the barrel; the server-side callers in Task 3 import the same names through the `./graphic-code` and `./graphic-code-fixture` subpaths instead.

- [ ] **Step 15: Run it to see it pass**

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/components/DocumentaryMaster.test.tsx`
Expected: PASS, every test in the file.
Run: `pnpm --filter @boom-busters/compositions exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 16: Commit**

```bash
pnpm exec prettier --write packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/components/DocumentaryMaster.test.tsx packages/compositions/src/index.ts
pnpm exec prettier --check packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/components/DocumentaryMaster.test.tsx packages/compositions/src/index.ts
git add packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/components/DocumentaryMaster.test.tsx packages/compositions/src/index.ts
git commit -m "feat(compositions): the master draws a graphic-code slot with GraphicCode (decision 295)

SlotView picks GraphicCode for a graphic-code payload, ungraded like every
drawn card. The barrel exports the component, the sandbox functions
(graphicBrand, safeInsets and withAlpha among them) and their types, and
the fixture source, for the board.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 17: Register the compositions and the snapshot cases**

In `packages/compositions/src/Root.tsx`:

1. After `import { GraphicCard } from './components/GraphicCard'` add:

```tsx
import { GraphicCode } from './components/GraphicCode'
```

2. After `import { GRAPHIC_SCENE, GRAPHIC_STAGED_SCENE } from './fixtures/graphic'` add:

```tsx
import { GRAPHIC_CODE_PAYLOAD } from './fixtures/graphic-code'
```

3. After the `GraphicCardStagedTall` composition add:

```tsx
      <Composition
        id="GraphicCodeWide"
        component={GraphicCode}
        durationInFrames={240}
        {...WIDE}
        defaultProps={{
          payload: GRAPHIC_CODE_PAYLOAD,
          brand: FIXTURE_BRAND,
          durationInFrames: 240,
        }}
      />

      <Composition
        id="GraphicCodeTall"
        component={GraphicCode}
        durationInFrames={240}
        {...TALL}
        defaultProps={{
          payload: GRAPHIC_CODE_PAYLOAD,
          brand: FIXTURE_BRAND,
          durationInFrames: 240,
        }}
      />
```

In `packages/compositions/src/snapshot/render.test.ts`, in `CASES`, after the `GraphicCardStagedTall-8500ms` case add:

```ts
  // The designer's code (decision 295): frame 150 is 5 s into the 8 s slot.
  // The title is up, the figure landed on $4bn at 1.3 s, the underline under
  // it is a little past half its sweep, and the second line (in at 4 s) is up.
  { id: 'GraphicCodeWide', frame: 150, maxDiffRatio: 0.06 },
  { id: 'GraphicCodeTall', frame: 150, maxDiffRatio: 0.06 },
```

- [ ] **Step 18: Run the two new snapshots to see them fail**

Run (Bash `timeout: 600000`): `pnpm --filter @boom-busters/compositions exec vitest run src/snapshot/render.test.ts -t "GraphicCode"`
Expected: FAIL on the missing-golden assertion ("no golden for GraphicCodeWide", followed by the suite's REGEN_GOLDEN hint), and the same for `GraphicCodeTall`. A different failure (a bundle error, a render timeout) is a bug in Steps 3 to 10: fix the code before going on. (The golden frame is 150, not an early one, so the goldens show every element the fixture draws.)

- [ ] **Step 19: Draw the two goldens, and only those**

Run (Bash `timeout: 600000`): `REGEN_GOLDEN=1 pnpm --filter @boom-busters/compositions exec vitest run src/snapshot/render.test.ts -t "GraphicCode"`
Then `git status --short packages/compositions/src/snapshot/golden` must list exactly two new files, `GraphicCodeWide.png` and `GraphicCodeTall.png`, and no modified file. Open both with the Read tool and confirm: wide shows, left-aligned inside the safe area on the dark radial background, "Raised in one round" in the secondary text colour, the figure "$4bn" large in the accent colour, an accent bar under it a little over a quarter of the frame wide (a little past half its sweep to 50%), and "Then the next step" below; tall shows the same four in a centred stack, the bar a little over 40% of the frame wide. Neither shows the title card alone (that would mean the boundary caught a throw: fix the code, not the golden). If a frame is wrong, fix the code and redraw only that case.

- [ ] **Step 20: Run every golden without regeneration**

Run (Bash `timeout: 600000`): `pnpm --filter @boom-busters/compositions exec vitest run src/snapshot/render.test.ts`
Expected: PASS, every golden, none rewritten. Goldens flake in a full run: before believing a pixel-diff failure, re-run that case alone with the compositions package alone (`pnpm --filter @boom-busters/compositions exec vitest run src/snapshot/render.test.ts -t "<name>"`). Never regenerate a golden from a full run.

- [ ] **Step 21: Commit**

```bash
pnpm exec prettier --write packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts
pnpm exec prettier --check packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts
git add packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts packages/compositions/src/snapshot/golden/GraphicCodeWide.png packages/compositions/src/snapshot/golden/GraphicCodeTall.png
git commit -m "test(compositions): goldens for the designer's graphic in both frames (decision 295)

GraphicCodeWide and GraphicCodeTall render the fixture at 5 s through
the real pipeline: the title up, the figure landed on \$4bn, the underline
past halfway and the second line up, left-aligned in 16:9 and centred in
9:16.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 22: Run the package and the repo checks**

Run (Bash `timeout: 600000`), one after another:
- `pnpm --filter @boom-busters/compositions exec vitest run src/lib src/components src/fixtures`
- `pnpm typecheck`
- `pnpm lint`

Expected: all PASS, zero lint warnings.

---

### Task 3: The checks: scan, compile, dry run, facts

**Files:**
- Create: `apps/web/lib/graphic-code/compile.ts`, `apps/web/lib/graphic-code/scan.ts`, `apps/web/lib/graphic-code/dry-run.ts`, `apps/web/lib/graphic-code/check.ts`
- Modify: `apps/web/package.json` (add `esbuild` dependency, the version already in the lockfile for `tsx`), `apps/web/next.config.ts` (`serverExternalPackages` gains `'esbuild'`), `pnpm-lock.yaml`
- Test: `apps/web/lib/graphic-code/compile.test.ts`, `scan.test.ts`, `dry-run.test.ts`, `check.test.ts` (created)

**Interfaces:**
- Consumes: Task 1's schemas, `graphicFactsIssue` (with `extraTexts`), `shownDigitGroups` and `GRAPHIC_STILL_MAX_MS`; Task 2's `graphicFunctionBody`, `graphicBrand` (ruling 26), `safeInsets`, `withAlpha` and the types `GraphicProps`, `GraphicScope`, `GraphicComponent` from `@boom-busters/compositions/graphic-code`, and `GRAPHIC_CODE_SOURCE` from `@boom-busters/compositions/graphic-code-fixture` (the subpaths, never the barrel: ruling 13); `GraphicDesignContext` from `graphic-design-core.ts` (claims, and logos carrying Task 1's `width` and `height`; no brand: ruling 3).
- Produces: `compileGraphicSource`, `scanGraphicSource`, `dryRunGraphic`, `GRAPHIC_SAMPLE_MS`, `graphicCodeIssue`.

Run every command in this task in the foreground with the Bash `timeout` set to 600000. None of these tests touches the database. Every test file here starts with `// @vitest-environment node`: esbuild refuses to run under jsdom, and `vm` wants Node's own globals.

- [ ] **Step 1: Add esbuild to the web app, kept out of the bundle**

`pnpm-lock.yaml` already resolves `esbuild@0.28.1` for `tsx@4.23.12`. In `apps/web/package.json`, add to `dependencies`, between `"diff"` and `"geist"`:

```json
    "esbuild": "0.28.1",
```

In `apps/web/next.config.ts`, replace the `serverExternalPackages` comment and line:

```ts
  // `sharp` is a native module, loaded only when a pasted image turns out to
  // be an AVIF (decision 266, lib/remote-image.ts). Bundling it would break
  // the platform-specific binary, so Next leaves it where it is. `esbuild`
  // is the same kind of package: the graphics designer's compile check
  // (decision 295, lib/graphic-code/compile.ts) runs its native binary.
  serverExternalPackages: ['esbuild', 'postgres', 'sharp'],
```

Run: `pnpm install --offline`
Expected: completes with `+ esbuild 0.28.1` under `apps/web` dependencies; `pnpm-lock.yaml` gains `esbuild: specifier: 0.28.1, version: 0.28.1` in the `apps/web` importer. (If the store has been pruned, run `pnpm install` instead.)

- [ ] **Step 2: Commit**

```bash
pnpm exec prettier --write apps/web/package.json apps/web/next.config.ts
git add apps/web/package.json apps/web/next.config.ts pnpm-lock.yaml
git commit -m "build(web): esbuild for the graphics designer's compile check (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 3: Write the failing compile test**

Create `apps/web/lib/graphic-code/compile.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { compileGraphicSource } from './compile'

describe('compileGraphicSource (decision 295)', () => {
  it('compiles JSX to React.createElement calls and keeps Graphic a plain declaration', () => {
    const result = compileGraphicSource(
      'function Graphic(props) {\n  return <Remotion.AbsoluteFill><div>{props.durationMs}</div></Remotion.AbsoluteFill>\n}\n',
    )
    if (!result.ok) throw new Error(result.issue)
    expect(result.compiled).toContain('function Graphic(props) {')
    expect(result.compiled).toContain('React.createElement(Remotion.AbsoluteFill, null')
    expect(result.compiled).toContain('React.createElement("div", null, props.durationMs)')
    expect(result.compiled).not.toContain('<div>')
  })

  it('compiles a fragment to React.Fragment', () => {
    const result = compileGraphicSource('function Graphic() {\n  return <><b>a</b></>\n}\n')
    if (!result.ok) throw new Error(result.issue)
    expect(result.compiled).toContain('React.createElement(React.Fragment, null')
  })

  it("refuses a syntax error with esbuild's message and its line", () => {
    const result = compileGraphicSource(
      'function Graphic(props) {\n  const a = 1\n  return <div>{a</div>\n}\n',
    )
    expect(result).toEqual({
      ok: false,
      issue: 'the code does not compile: Unterminated regular expression (line 3)',
    })
  })
})
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/compile.test.ts`
Expected: FAIL, `Failed to resolve import "./compile" from "lib/graphic-code/compile.test.ts". Does the file exist?`

- [ ] **Step 5: Write the compiler**

Create `apps/web/lib/graphic-code/compile.ts`:

```ts
import { transformSync, type Message } from 'esbuild'

/**
 * The designer's JSX as plain JavaScript (decision 295): esbuild's
 * `transformSync`, JSX to `React.createElement` calls, ES2020, and no module
 * format, so the top-level `function Graphic` stays a plain declaration the
 * sandbox's appended `return Graphic` can reach. Server only: esbuild runs a
 * native binary, which `serverExternalPackages` keeps out of the bundle.
 */
export function compileGraphicSource(
  source: string,
): { ok: true; compiled: string } | { ok: false; issue: string } {
  try {
    const { code } = transformSync(source, {
      loader: 'jsx',
      jsx: 'transform',
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      target: 'es2020',
    })
    return { ok: true, compiled: code }
  } catch (error) {
    const first = failureMessages(error)[0]
    // Anything but a compile failure (a missing binary, a dead service) is
    // not the designer's mistake, and no retry of the model can fix it.
    if (!first) throw error
    const line = first.location ? ` (line ${first.location.line})` : ''
    return { ok: false, issue: `the code does not compile: ${first.text}${line}` }
  }
}

/** The messages of an esbuild transform failure; none for any other error. */
function failureMessages(error: unknown): Message[] {
  if (typeof error !== 'object' || error === null || !('errors' in error)) return []
  return Array.isArray(error.errors) ? (error.errors as Message[]) : []
}
```

- [ ] **Step 6: Run it to see it pass**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/compile.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
pnpm exec prettier --write apps/web/lib/graphic-code/compile.ts apps/web/lib/graphic-code/compile.test.ts
git add apps/web/lib/graphic-code/compile.ts apps/web/lib/graphic-code/compile.test.ts
git commit -m "feat(web): compile the designer's JSX with esbuild (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 8: Write the failing scan test**

Create `apps/web/lib/graphic-code/scan.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'
import { scanGraphicSource, splitSource } from './scan'

/** A clean graphic with `body` as the first lines of its function. */
const graphic = (body: string) =>
  `function Graphic(props) {\n${body}\n  return <Remotion.AbsoluteFill><div>Acme</div></Remotion.AbsoluteFill>\n}\n`

const PURE = 'a graphic must be a pure function of the frame'
const GIVEN = 'everything it needs arrives as React, Remotion and props'
const COLOURS = 'colours come from props.brand.colors, with Remotion.withAlpha for opacity'

describe('scanGraphicSource (decision 295)', () => {
  it('passes a clean graphic: a function declaration is not the banned Function', () => {
    expect(scanGraphicSource(graphic('  function helper() {\n    return 1\n  }'))).toBeNull()
  })

  it.each([
    ['Math.random', '  const seed = Math.random()', PURE],
    ['Date', '  const now = Date.now()', PURE],
    ['Date', '  const then = new Date(2020, 1, 1)', PURE],
    ['window', '  const wide = window.innerWidth', PURE],
    ['document', '  const title = document.title', PURE],
    ['globalThis', '  const scope = globalThis', PURE],
    ['process', '  const key = process.env.KEY', PURE],
    ['fetch', "  fetch('https://example.com')", PURE],
    ['setTimeout', '  setTimeout(() => {}, 10)', PURE],
    ['setInterval', '  setInterval(() => {}, 10)', PURE],
    ['requestAnimationFrame', '  requestAnimationFrame(() => {})', PURE],
    ['eval', "  const two = eval('1 + 1')", PURE],
    ['Function', "  const make = new Function('return 1')", PURE],
    ['useState', '  const [n] = React.useState(0)', PURE],
    ['useEffect', '  React.useEffect(() => {})', PURE],
    ['useLayoutEffect', '  React.useLayoutEffect(() => {})', PURE],
    ['require', "  const fs = require('fs')", GIVEN],
  ])('refuses %s', (name, line, reason) => {
    expect(scanGraphicSource(graphic(line))).toBe(
      `the code uses ${name}, which the sandbox bans: ${reason}`,
    )
  })

  it('refuses an import', () => {
    expect(scanGraphicSource(`import { useMemo } from 'react'\n${graphic('')}`)).toBe(
      `the code uses import, which the sandbox bans: ${GIVEN}`,
    )
  })

  it('reads words on screen and in strings as words, not code', () => {
    const source = graphic("  const caption = 'Date of the raid: the window closed'").replace(
      '<div>Acme</div>',
      '<div>A leaked document shows the process failed. Function over form.</div>',
    )
    expect(scanGraphicSource(source)).toBeNull()
  })

  it('refuses a hex colour in a string, a template literal or a JSX attribute', () => {
    expect(scanGraphicSource(graphic("  const red = '#ff0000'"))).toBe(
      `the code writes the colour #ff0000: ${COLOURS}`,
    )
    expect(scanGraphicSource(graphic('  const edge = `${props.durationMs}px solid #0af`'))).toBe(
      `the code writes the colour #0af: ${COLOURS}`,
    )
    const attribute = graphic('').replace('<div>Acme</div>', '<svg><rect fill="#00ff00" /></svg>')
    expect(scanGraphicSource(attribute)).toBe(`the code writes the colour #00ff00: ${COLOURS}`)
  })

  it('refuses rgb(), rgba() and hsl() colours', () => {
    expect(scanGraphicSource(graphic("  const shade = 'rgba(0, 0, 0, 0.5)'"))).toBe(
      `the code writes a colour with rgba(): ${COLOURS}`,
    )
    expect(scanGraphicSource(graphic("  const shade = 'hsl(10, 50%, 50%)'"))).toBe(
      `the code writes a colour with hsl(): ${COLOURS}`,
    )
  })

  it('lets a rank through: only a colour-length hex is a colour', () => {
    expect(scanGraphicSource(graphic("  const rank = '#1 in Europe'"))).toBeNull()
  })

  it('refuses a source over the size cap', () => {
    const source = `${graphic('')}//${'x'.repeat(GRAPHIC_SOURCE_MAX)}`
    expect(scanGraphicSource(source)).toBe(
      `the code is ${source.length} characters; at most ${GRAPHIC_SOURCE_MAX} fit`,
    )
  })

  it('refuses a source that does not declare function Graphic', () => {
    expect(scanGraphicSource('const Graphic = (props) => null\n')).toBe(
      'the code does not declare function Graphic(props) at the top level',
    )
  })
})

describe('splitSource', () => {
  it('blanks comments and strings out of the code and keeps the strings', () => {
    const { code, strings } = splitSource(
      "const a = 'one' // Date.now()\n/* window.x */ const b = \"two\"\nconst c = `three ${a + `four`} five`\n",
    )
    expect(code).not.toMatch(/one|two|three|four|five|Date|window/)
    expect(code).toContain('a + ')
    expect(code.split('\n')).toHaveLength(4)
    expect(strings).toEqual(['one', 'two', 'three ', 'four', ' five'])
  })
})
```

- [ ] **Step 9: Run it to see it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/scan.test.ts`
Expected: FAIL, `Failed to resolve import "./scan" from "lib/graphic-code/scan.test.ts". Does the file exist?`

- [ ] **Step 10: Write the scan**

Create `apps/web/lib/graphic-code/scan.ts`:

```ts
import { GRAPHIC_SOURCE_MAX } from '@boom-busters/schemas'

/**
 * The static scan (decision 295): what the designer's code may not touch,
 * read off the source before anything runs. The dry run's `vm` context has
 * no `window`, `fetch` or timers, so code that reaches for them fails there
 * too; `Date`, `Math.random`, `eval`, `Function` and the stateful hooks do
 * exist there, and each makes a frame depend on something other than the
 * frame. The scan is the guard for those. It is not a security boundary:
 * the designer is a model writing honest code, and this keeps it honest.
 *
 * Identifiers are matched in the code with its strings and comments
 * blanked, and the ones that are also English words only in the shapes
 * code uses them (`Date.now`, `new Date`, `window.`, `eval(`), so a caption
 * reading "a leaked document" or "the window closed" is not refused.
 * Colours are matched inside strings, where a CSS colour lives.
 */

const PURE = 'a graphic must be a pure function of the frame'
const GIVEN = 'everything it needs arrives as React, Remotion and props'
const COLOURS = 'colours come from props.brand.colors, with Remotion.withAlpha for opacity'

const BANNED: readonly { name: string; pattern: RegExp; reason: string }[] = [
  { name: 'import', pattern: /(?:^|[;{}])\s*import\b|\bimport\s*\(/m, reason: GIVEN },
  { name: 'require', pattern: /\brequire\s*\(/, reason: GIVEN },
  { name: 'window', pattern: /\bwindow\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'document', pattern: /\bdocument\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'globalThis', pattern: /\bglobalThis\b/, reason: PURE },
  { name: 'process', pattern: /\bprocess\s*(?:\.[\w$]|\[)/, reason: PURE },
  { name: 'fetch', pattern: /\bfetch\s*\(/, reason: PURE },
  { name: 'setTimeout', pattern: /\bsetTimeout\b/, reason: PURE },
  { name: 'setInterval', pattern: /\bsetInterval\b/, reason: PURE },
  { name: 'requestAnimationFrame', pattern: /\brequestAnimationFrame\b/, reason: PURE },
  { name: 'Date', pattern: /\bnew\s+Date\b|\bDate\s*(?:\.[\w$]|\()/, reason: PURE },
  { name: 'Math.random', pattern: /\bMath\s*\.\s*random\b/, reason: PURE },
  { name: 'eval', pattern: /\beval\s*\(/, reason: PURE },
  // Case-sensitive: `function Graphic(` is a declaration, not the constructor.
  { name: 'Function', pattern: /\bnew\s+Function\b|\bFunction\s*\(/, reason: PURE },
  { name: 'useState', pattern: /\buseState\b/, reason: PURE },
  { name: 'useEffect', pattern: /\buseEffect\b/, reason: PURE },
  { name: 'useLayoutEffect', pattern: /\buseLayoutEffect\b/, reason: PURE },
]

/** A colour-length hex literal: #rgb, #rgba, #rrggbb or #rrggbbaa. */
const HEX_COLOUR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/
const COLOUR_FUNCTION = /\b(rgba?|hsla?)\s*\(/i
const DECLARES_GRAPHIC = /\bfunction\s+Graphic\s*\(/

/** null when the source is clean; else the first thing wrong with it, as a sentence. */
export function scanGraphicSource(source: string): string | null {
  if (source.length > GRAPHIC_SOURCE_MAX) {
    return `the code is ${source.length} characters; at most ${GRAPHIC_SOURCE_MAX} fit`
  }
  const { code, strings } = splitSource(source)
  if (!DECLARES_GRAPHIC.test(code)) {
    return 'the code does not declare function Graphic(props) at the top level'
  }
  const banned = BANNED.find(({ pattern }) => pattern.test(code))
  if (banned) return `the code uses ${banned.name}, which the sandbox bans: ${banned.reason}`
  for (const text of strings) {
    const hex = HEX_COLOUR.exec(text)
    if (hex) return `the code writes the colour ${hex[0]}: ${COLOURS}`
    const colour = COLOUR_FUNCTION.exec(text)
    if (colour) return `the code writes a colour with ${(colour[1] ?? '').toLowerCase()}(): ${COLOURS}`
  }
  return null
}

/**
 * The source split for the scan: `code`, with every comment and the text
 * of every string and template blanked (line breaks kept, so `^` still
 * finds a line's start), and `strings`, the text of each string literal and
 * of each template literal's literal parts. A lexer, not a parser: an
 * apostrophe in JSX text opens a "string" to the end of its line, which
 * only ever blanks words on screen, and a regex literal is read as code.
 */
export function splitSource(source: string): { code: string; strings: string[] } {
  let code = ''
  const strings: string[] = []
  // Per open template expression (`${`), how many of its own braces are open.
  const expressions: number[] = []

  // From just inside a template (after its backtick, or after an expression's
  // closing brace) to just past its closing backtick or its next `${`.
  const template = (from: number): number => {
    let text = ''
    let at = from
    while (at < source.length) {
      const char = source[at]
      if (char === '\\') {
        text += source.slice(at, at + 2)
        at += 2
      } else if (char === '`') {
        strings.push(text)
        return at + 1
      } else if (char === '$' && source[at + 1] === '{') {
        strings.push(text)
        expressions.push(0)
        return at + 2
      } else {
        if (char === '\n') code += '\n'
        text += char ?? ''
        at += 1
      }
    }
    strings.push(text)
    return at
  }

  let at = 0
  while (at < source.length) {
    const char = source[at]
    const next = source[at + 1]
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', at)
      at = end === -1 ? source.length : end
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', at + 2)
      const comment = source.slice(at, end === -1 ? source.length : end + 2)
      code += comment.replace(/[^\n]/g, ' ')
      at += comment.length
      continue
    }
    if (char === "'" || char === '"') {
      let text = ''
      let end = at + 1
      while (end < source.length && source[end] !== char && source[end] !== '\n') {
        if (source[end] === '\\') {
          text += source.slice(end, end + 2)
          end += 2
        } else {
          text += source[end] ?? ''
          end += 1
        }
      }
      strings.push(text)
      code += '""'
      at = source[end] === char ? end + 1 : end
      continue
    }
    if (char === '`') {
      code += '""'
      at = template(at + 1)
      continue
    }
    if (expressions.length > 0 && (char === '{' || char === '}')) {
      const depth = expressions[expressions.length - 1] ?? 0
      if (char === '}' && depth === 0) {
        expressions.pop()
        at = template(at + 1)
        continue
      }
      expressions[expressions.length - 1] = depth + (char === '{' ? 1 : -1)
    }
    code += char ?? ''
    at += 1
  }
  return { code, strings }
}
```

- [ ] **Step 11: Run it to see it pass**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/scan.test.ts`
Expected: PASS, 26 tests.

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write apps/web/lib/graphic-code/scan.ts apps/web/lib/graphic-code/scan.test.ts
git add apps/web/lib/graphic-code/scan.ts apps/web/lib/graphic-code/scan.test.ts
git commit -m "feat(web): the static scan of the designer's code (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 13: Write the failing dry-run test**

Create `apps/web/lib/graphic-code/dry-run.test.ts`. The loop that never ends is the last test in the file: a run the `vm` timeout stops skips React's `finally` blocks, and nothing should render after it in the same worker that does not have to.

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { graphicBrand } from '@boom-busters/compositions/graphic-code'
import { GRAPHIC_CODE_SOURCE } from '@boom-busters/compositions/graphic-code-fixture'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import { compileGraphicSource } from './compile'
import { dryRunGraphic, type DryRunInput } from './dry-run'

const PROPS: DryRunInput['props'] = {
  brand: graphicBrand(resolveBrandKit(DEFAULT_SETTINGS)),
  words: [
    { text: 'Acme', atMs: 0 },
    { text: 'raised', atMs: 400 },
    { text: 'four', atMs: 900 },
    { text: 'billion.', atMs: 1200 },
  ],
  durationMs: 4000,
  logos: {},
}

function compiled(source: string): string {
  const result = compileGraphicSource(source)
  if (!result.ok) throw new Error(result.issue)
  return result.compiled
}

function dryRun(
  source: string,
  durationMs = 4000,
  limits: Pick<DryRunInput, 'timeoutMs' | 'frameMaxMs'> = {},
) {
  return dryRunGraphic({
    compiled: compiled(source),
    props: { ...PROPS, durationMs },
    durationMs,
    ...limits,
  })
}

describe('dryRunGraphic (decision 295)', () => {
  it('passes the fixture graphic in both frames, with one text sample per 250 ms', () => {
    const result = dryRun(GRAPHIC_CODE_SOURCE, 6000)
    expect(result.issue).toBeNull()
    expect(result.textSamples).toHaveLength(6000 / 250 + 1)
    expect(result.textSamples.at(-1)).toContain('$4bn')
  })

  it("runs a Sequence's children on a clock from its start, and nothing before it", () => {
    const result = dryRun(`function Clock() {
  return <div>{Remotion.useCurrentFrame()}</div>
}

function Graphic() {
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Sequence from={30}>
        <Clock />
      </Remotion.Sequence>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBeNull()
    expect(result.textSamples[0]).toBe('')
    // 1.5 s is frame 45, fifteen frames into a sequence from frame 30.
    expect(result.textSamples[6]).toBe('15')
  })

  it('names the time, the frame and the error when the code throws', () => {
    // Samples land on frames 38 and 45 around 1.3 s, so frame 45 is the first to throw.
    const result = dryRun(`function Graphic() {
  const frame = Remotion.useCurrentFrame()
  if (frame >= 40) throw new Error('boom')
  return <Remotion.AbsoluteFill><div>{frame}</div></Remotion.AbsoluteFill>
}
`)
    expect(result.issue).toBe('the code failed at 1.5 s (frame 45) in landscape: boom')
  })

  it('names the crash at frame 0 when the code reads a logo it was not given', () => {
    const result = dryRun(`function Graphic(props) {
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Img src={props.logos['Acme'].src} />
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe(
      "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'src')",
    )
  })

  it('refuses code the sandbox cannot run', () => {
    const result = dryRun(`export function Graphic() {
  return <Remotion.AbsoluteFill><div>Hello</div></Remotion.AbsoluteFill>
}
`)
    expect(result.issue).toBe("the code does not run: Unexpected token 'export'")
  })

  it('names a stretch of dead air longer than six seconds', () => {
    const result = dryRun(
      `function Graphic() {
  return <Remotion.AbsoluteFill><div>Raised in one round</div></Remotion.AbsoluteFill>
}
`,
      8000,
    )
    expect(result.issue).toBe('nothing changes between 0.0 s and 8.0 s')
  })

  it('refuses a graphic whose last second is empty', () => {
    const result = dryRun(`function Graphic() {
  const { fps } = Remotion.useVideoConfig()
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Sequence durationInFrames={3 * fps}>
        <div>Gone before the end</div>
      </Remotion.Sequence>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('the last second of the graphic is empty: hold the ending')
  })

  it('names an element placed outside the safe area, and the frame', () => {
    const result = dryRun(`function Graphic() {
  return (
    <Remotion.AbsoluteFill>
      <div style={{ position: 'absolute', left: -10, top: 400 }}>Off the edge</div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('"Off the edge" sits outside the safe area in landscape')
  })

  it('measures an element inside a positioned box from that box, not from the frame', () => {
    const result = dryRun(`function Graphic(props) {
  const inset = props.safeArea
  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
      }}
    >
      <div style={{ position: 'relative', height: 300 }}>
        <div style={{ position: 'absolute', left: 0, bottom: 0 }}>Inside its chart</div>
      </div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBeNull()
  })

  it('checks the portrait frame too, and keeps the landscape text', () => {
    const result = dryRun(`function Graphic() {
  const { width, height } = Remotion.useVideoConfig()
  return (
    <Remotion.AbsoluteFill>
      <div style={{ position: 'absolute', left: height > width ? 10 : 100, top: 200 }}>Tall only</div>
    </Remotion.AbsoluteFill>
  )
}
`)
    expect(result.issue).toBe('"Tall only" sits outside the safe area in portrait')
    expect(result.textSamples).toHaveLength(4000 / 250 + 1)
  })

  it('refuses a frame slower than its limit', () => {
    const result = dryRun(
      `function Graphic() {
  let total = 0
  for (let i = 0; i < 20000000; i += 1) total += i % 7
  return <Remotion.AbsoluteFill><div>{total}</div></Remotion.AbsoluteFill>
}
`,
      4000,
      { frameMaxMs: 1 },
    )
    expect(result.issue).toBe('frame 0 (0.0 s) did not finish in 0.001 s in landscape')
  })

  it('stops a loop that never ends at the run limit', () => {
    const result = dryRun(
      `function Graphic() {
  while (true) {}
}
`,
      4000,
      { timeoutMs: 500 },
    )
    expect(result.issue).toBe('the landscape dry run did not finish in 0.5 s')
  })
})
```

- [ ] **Step 14: Run it to see it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/dry-run.test.ts`
Expected: FAIL, `Failed to resolve import "./dry-run" from "lib/graphic-code/dry-run.test.ts". Does the file exist?`

- [ ] **Step 15: Write the dry run**

The outer function is compiled inside the `vm` context (a `vm.Script` of `graphicFunctionBody`), not built with `buildGraphic`'s `new Function`, so that the code's globals are the context's own and the context's timeout covers the code's top level as well as every sample; for a pure component the two paths draw the same frames (ruling 15). The sandbox's helpers come from the `@boom-busters/compositions/graphic-code` subpath, never the barrel (ruling 13), and `safeInsets` and `withAlpha` are compositions' own (ruling 14), not copies. So is `graphicBrand` (ruling 26): this file has none of its own, and `check.ts` and `dry-run.test.ts` import it from the subpath.

Create `apps/web/lib/graphic-code/dry-run.ts`:

```ts
import vm from 'node:vm'
import {
  graphicFunctionBody,
  safeInsets,
  withAlpha,
} from '@boom-busters/compositions/graphic-code'
import type {
  GraphicComponent,
  GraphicProps,
  GraphicScope,
} from '@boom-busters/compositions/graphic-code'
import { GRAPHIC_STILL_MAX_MS } from '@boom-busters/schemas'
import * as React from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Easing, interpolate, spring } from 'remotion'

/**
 * The dry run (decision 295): the designer's compiled component rendered to
 * markup at every 250 ms of its slot, in the film's 16:9 frame and the
 * Short's 9:16, with Remotion's hooks shimmed. It finds what a machine can:
 * a crash, a frame too slow to render, dead air, an empty ending and an
 * element placed outside the safe area. Whether the graphic is any good is
 * the owner's call on the board.
 *
 * The code runs in a `vm` context of its own, so its globals are that
 * context's (no `require`, `process` or timers), and one call into the
 * context covers a whole frame size, so its timeout stops a loop that never
 * ends. `vm` is not a security boundary; the static scan and an honest
 * designer are.
 */

export const GRAPHIC_SAMPLE_MS = 250
export const GRAPHIC_FPS = 30
/** One frame's render may take this long. */
export const GRAPHIC_FRAME_MAX_MS = 2000
/** One frame size's whole run may take this long; the context's timeout stops it there. */
export const GRAPHIC_DRY_RUN_MAX_MS = 20_000
/** React writes rounded style values; an inset missed by less than this is not a crop. */
const SAFE_AREA_SLACK_PX = 1
/** An error message, cut to fit a refusal the model and the card both read. */
const MESSAGE_MAX = 200

export interface DryRunInput {
  compiled: string
  props: Omit<GraphicProps, 'safeArea'>
  durationMs: number
  /** One frame size's limit, `GRAPHIC_DRY_RUN_MAX_MS` by default; tests shorten it. */
  timeoutMs?: number
  /** One frame's limit, `GRAPHIC_FRAME_MAX_MS` by default; tests shorten it. */
  frameMaxMs?: number
}

export interface DryRunResult {
  issue: string | null
  /** Visible text per sample, landscape. */
  textSamples: string[]
}

const FRAME_SIZES = [
  { orientation: 'landscape', width: 1920, height: 1080 },
  { orientation: 'portrait', width: 1080, height: 1920 },
] as const
type FrameSize = (typeof FRAME_SIZES)[number]

type Sample = { atMs: number; markup: string }
type Run = { samples: Sample[]; failure: string | null }
type GraphicFactory = (react: typeof React, scope: GraphicScope, props: GraphicProps) => unknown
type Side = 'top' | 'right' | 'bottom' | 'left'
type Placement = { label: string; offsets: Partial<Record<Side, number>> }

/** The frame `useCurrentFrame` reads: the sample's, or a `Sequence`'s, counted from its start. */
const FrameContext = React.createContext(0)

/**
 * A full-frame layer, as Remotion's is, spanned with `inset: 0` rather than
 * four zero offsets: the safe-area check reads offsets, and a full-frame
 * layer is the one element allowed to reach the frame's edges.
 */
function AbsoluteFill({ style, children }: { style?: CSSProperties; children?: ReactNode }) {
  return React.createElement(
    'div',
    {
      style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', ...style },
    },
    children,
  )
}

/** Remotion's `Sequence`: its children only inside its window, on a clock from its start, in a full-frame layer. */
function Sequence({
  from = 0,
  durationInFrames,
  children,
}: {
  from?: number
  durationInFrames?: number
  children?: ReactNode
}) {
  const frame = React.useContext(FrameContext)
  if (frame < from) return null
  if (durationInFrames !== undefined && frame >= from + durationInFrames) return null
  return React.createElement(
    FrameContext.Provider,
    { value: frame - from },
    React.createElement(AbsoluteFill, null, children),
  )
}

function Img({ src, style }: { src: string; style?: CSSProperties }) {
  return React.createElement('img', { src, style })
}

/** The sandbox's `Remotion` argument for one frame size: the hooks shimmed, the rest Remotion's own. */
function shimScope(size: FrameSize, durationInFrames: number): GraphicScope {
  const config = { width: size.width, height: size.height, fps: GRAPHIC_FPS, durationInFrames }
  return {
    useCurrentFrame: () => React.useContext(FrameContext),
    useVideoConfig: () => config,
    interpolate,
    spring,
    Easing,
    Sequence,
    AbsoluteFill,
    Img,
    withAlpha,
  }
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/** Every 250 ms from the slot's start, and its last moment. */
function sampleTimes(durationMs: number): number[] {
  const times: number[] = []
  for (let atMs = 0; atMs < durationMs; atMs += GRAPHIC_SAMPLE_MS) times.push(atMs)
  times.push(durationMs)
  return times
}

/** An error's message, whichever realm threw it, cut to fit a refusal. */
function messageOf(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : String(error)
  return message.length > MESSAGE_MAX ? `${message.slice(0, MESSAGE_MAX - 1)}…` : message
}

const isTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&nbsp;': ' ',
}

/**
 * The words a sample shows: its markup without tags, entities decoded,
 * whitespace collapsed. Text at opacity 0 counts: a figure waiting to land
 * is checked against the claims as if it were on screen.
 */
export function visibleText(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#x27|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim()
}

const TAG = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const OFFSET = /(?:^|;)(top|right|bottom|left):(-?\d*\.?\d+(?:e[+-]?\d+)?)(px)?(?=;|$)/g
const FILLS_FRAME = /(?:^|;)inset:0(?:px)?(?=;|$)/

function offsetsOf(style: string): Placement['offsets'] {
  const offsets: Placement['offsets'] = {}
  for (const [, side, value, unit] of style.matchAll(OFFSET)) {
    if (side === undefined || value === undefined) continue
    const px = Number(value)
    // React writes a number as pixels and zero bare; a percentage is not read.
    if (unit === 'px' || px === 0) offsets[side as Side] = px
  }
  return offsets
}

function labelOf(inner: string, tag: string): string {
  const text = visibleText(inner)
  return text ? `"${text.slice(0, 40)}"` : `a ${tag} with no text`
}

/**
 * Every absolutely positioned element whose offsets are measured from the
 * frame, with its text. An element inside a positioned box that does not
 * fill the frame is measured from that box, so it is not read: a label at
 * the foot of its bar is not at the foot of the frame.
 */
export function framePlacements(markup: string): Placement[] {
  const placements: Placement[] = []
  const open: {
    tag: string
    textFrom: number
    childrenFromFrame: boolean
    offsets: Placement['offsets'] | null
  }[] = []
  for (const match of markup.matchAll(TAG)) {
    const [whole, closing, tag = '', attributes = '', selfClosing] = match
    if (closing) {
      const element = open.pop()
      if (element?.offsets) {
        placements.push({
          label: labelOf(markup.slice(element.textFrom, match.index), element.tag),
          offsets: element.offsets,
        })
      }
      continue
    }
    const fromFrame = open.at(-1)?.childrenFromFrame ?? true
    const style = /\sstyle="([^"]*)"/.exec(attributes)?.[1] ?? ''
    const position = /(?:^|;)position:(\w+)/.exec(style)?.[1] ?? 'static'
    const placed = position === 'absolute' || position === 'fixed'
    const offsets = placed && fromFrame ? offsetsOf(style) : null
    // A positioned box measures its children from itself; only a
    // full-frame layer measures them from the frame.
    const childrenFromFrame =
      position === 'static' ? fromFrame : placed && fromFrame && FILLS_FRAME.test(style)
    if (selfClosing || VOID_TAGS.has(tag.toLowerCase())) {
      if (offsets) placements.push({ label: labelOf('', tag), offsets })
      continue
    }
    open.push({ tag, textFrom: match.index + whole.length, childrenFromFrame, offsets })
  }
  return placements
}

function outsideInsets(offsets: Placement['offsets'], insets: GraphicProps['safeArea']): boolean {
  return (['top', 'right', 'bottom', 'left'] as const).some((side) => {
    const value = offsets[side]
    return value !== undefined && value < insets[side] - SAFE_AREA_SLACK_PX
  })
}

/** The longest run of consecutive samples with identical markup, by their times. */
function longestUnchanged(samples: readonly Sample[]): { fromMs: number; toMs: number } {
  let best = { fromMs: 0, toMs: 0 }
  let start = 0
  for (let at = 1; at <= samples.length; at += 1) {
    const first = samples[start]!
    if (at < samples.length && samples[at]!.markup === first.markup) continue
    const last = samples[at - 1]!
    if (last.atMs - first.atMs > best.toMs - best.fromMs) {
      best = { fromMs: first.atMs, toMs: last.atMs }
    }
    start = at
  }
  return best
}

/** What the samples of one frame size show wrong: dead air, an empty ending, a crop. */
function markupIssue(samples: readonly Sample[], size: FrameSize): string | null {
  const where = size.orientation === 'portrait' ? ' in portrait' : ''
  const still = longestUnchanged(samples)
  if (still.toMs - still.fromMs > GRAPHIC_STILL_MAX_MS) {
    return `nothing changes between ${seconds(still.fromMs)} and ${seconds(still.toMs)}${where}`
  }
  const last = samples.at(-1)
  if (last && visibleText(last.markup) === '') {
    return `the last second of the graphic is empty: hold the ending${where}`
  }
  const insets = safeInsets(size)
  for (const sample of samples) {
    const outside = framePlacements(sample.markup).find((placement) =>
      outsideInsets(placement.offsets, insets),
    )
    if (outside) return `${outside.label} sits outside the safe area in ${size.orientation}`
  }
  return null
}

function runFrameSize(
  input: DryRunInput,
  size: FrameSize,
): { issue: string | null; samples: Sample[] } {
  const durationInFrames = Math.max(1, Math.round((input.durationMs * GRAPHIC_FPS) / 1000))
  const props: GraphicProps = { ...input.props, safeArea: safeInsets(size) }
  const scope = shimScope(size, durationInFrames)
  const frameMaxMs = input.frameMaxMs ?? GRAPHIC_FRAME_MAX_MS
  const timeoutMs = input.timeoutMs ?? GRAPHIC_DRY_RUN_MAX_MS

  const sandbox: Record<string, unknown> = {}
  const context = vm.createContext(sandbox)
  let factory: GraphicFactory
  try {
    const script = new vm.Script(
      `(function (React, Remotion, props) {\n${graphicFunctionBody(input.compiled)}\n})`,
      { filename: 'graphic.js' },
    )
    factory = script.runInContext(context) as GraphicFactory
  } catch (error) {
    return { issue: `the code does not run: ${messageOf(error)}`, samples: [] }
  }

  // Called from inside the context, so the context's timeout covers the
  // code's top level and every sample of this frame size.
  sandbox['__run'] = (): Run => {
    const samples: Sample[] = []
    let Graphic: unknown
    try {
      Graphic = factory(React, scope, props)
    } catch (error) {
      return { samples, failure: `the code does not run: ${messageOf(error)}` }
    }
    if (typeof Graphic !== 'function') {
      return { samples, failure: 'the code does not run: Graphic is not a function' }
    }
    for (const atMs of sampleTimes(input.durationMs)) {
      const frame = Math.min(durationInFrames - 1, Math.round((atMs * GRAPHIC_FPS) / 1000))
      const started = performance.now()
      let markup: string
      try {
        markup = renderToStaticMarkup(
          React.createElement(
            FrameContext.Provider,
            { value: frame },
            React.createElement(Graphic as GraphicComponent, props),
          ),
        )
      } catch (error) {
        return {
          samples,
          failure: `the code failed at ${seconds(atMs)} (frame ${frame}) in ${size.orientation}: ${messageOf(error)}`,
        }
      }
      if (performance.now() - started > frameMaxMs) {
        return {
          samples,
          failure: `frame ${frame} (${seconds(atMs)}) did not finish in ${frameMaxMs / 1000} s in ${size.orientation}`,
        }
      }
      samples.push({ atMs, markup })
    }
    return { samples, failure: null }
  }

  let run: Run
  try {
    run = vm.runInContext('__run()', context, { timeout: timeoutMs }) as Run
  } catch (error) {
    if (!isTimeout(error)) throw error
    return {
      issue: `the ${size.orientation} dry run did not finish in ${timeoutMs / 1000} s`,
      samples: [],
    }
  }
  if (run.failure !== null) return { issue: run.failure, samples: run.samples }
  return { issue: markupIssue(run.samples, size), samples: run.samples }
}

/** Landscape, then portrait; the first issue found stops the run. */
export function dryRunGraphic(input: DryRunInput): DryRunResult {
  let textSamples: string[] = []
  for (const size of FRAME_SIZES) {
    const { issue, samples } = runFrameSize(input, size)
    if (size.orientation === 'landscape') {
      textSamples = samples.map((sample) => visibleText(sample.markup))
    }
    if (issue !== null) return { issue, textSamples }
  }
  return { issue: null, textSamples }
}
```

- [ ] **Step 16: Run it to see it pass**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/dry-run.test.ts`
Expected: PASS, 12 tests (`safeInsets`' own test is Task 2's). If the first test fails on the fixture, the fixture is wrong, not the check: report the issue it names (Task 2's `GRAPHIC_CODE_SOURCE`, which is Task 4's fixture text, must pass this dry run at 6000 ms) rather than loosening a rule.

- [ ] **Step 17: Commit**

```bash
pnpm exec prettier --write apps/web/lib/graphic-code/dry-run.ts apps/web/lib/graphic-code/dry-run.test.ts
git add apps/web/lib/graphic-code/dry-run.ts apps/web/lib/graphic-code/dry-run.test.ts
git commit -m "feat(web): dry-run the designer's code in both frames (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 18: Write the failing check test**

Create `apps/web/lib/graphic-code/check.test.ts`:

```ts
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { ChartBrief, GraphicBrief, PlannedGraphicCode } from '@boom-busters/schemas'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { graphicCodeIssue } from './check'

const A = '01J00000000000000000000001'
const B = '01J00000000000000000000002'
const CONTEXT: GraphicDesignContext = {
  projectId: '01J0000000000000000000000P',
  caseTitle: 'Acme',
  claims: [
    { id: A, text: 'Acme raised 4 billion dollars in 2024.', sourceUrl: null, confidence: 'high' },
    { id: B, text: 'Acme raised 1 billion dollars in 2023.', sourceUrl: null, confidence: 'high' },
  ],
  logos: [{ id: '01J000000000000000000000L1', title: 'Acme', width: 1200, height: 400 }],
  paragraphs: [],
  chapterTitle: 'The raise',
}
const GRAPHIC: GraphicBrief = {
  type: 'graphic',
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' },
  transition: 'cut',
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const CHART: ChartBrief = {
  type: 'chart',
  coversText: 'A billion, then four.',
  description: 'Two raises.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'bar',
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  dataRefs: [B, A],
  takeaway: 'Four times in a year',
  reveal: 'draw-on',
}
const WORDS = [
  { text: 'four', atMs: 900 },
  { text: 'billion.', atMs: 1200 },
]
const slot = (brief: GraphicBrief | ChartBrief, durationMs = 6000) => ({
  brief,
  durationMs,
  words: WORDS,
})

/** A count-up to `figure` billion over the first second, then held, with a sweep so it never sits still. */
const countUp = (figure: number) => `function Graphic() {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const count = Remotion.spring({ frame, fps, delay: 6, durationInFrames: fps, config: { damping: 200 } })
  const sweep = Remotion.interpolate(frame, [0, 179], [0, 100], { extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{'$' + Math.round(count * ${figure * 10}) / 10 + 'bn'}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`

const CHART_SOURCE = `function Graphic(props) {
  const points = props.data.series[0].points
  return (
    <Remotion.AbsoluteFill>
      <div>{props.data.takeaway}</div>
      {points.map((point) => (
        <div key={point.x}>{point.x + ': ' + point.y}</div>
      ))}
    </Remotion.AbsoluteFill>
  )
}
`

const answer = (over: Partial<PlannedGraphicCode> = {}): PlannedGraphicCode => ({
  title: 'Raised in one round',
  facts: [{ text: '$4bn', claim: 1 }],
  source: countUp(4),
  ...over,
})

describe('graphicCodeIssue (decision 295)', () => {
  it('keeps a count-up whose passing values flicker by, citing its claim by id', () => {
    const planned = answer()
    expect(graphicCodeIssue(planned, CONTEXT, slot(GRAPHIC))).toEqual({
      code: {
        version: 1,
        source: planned.source,
        compiled: expect.stringContaining('function Graphic()'),
        title: 'Raised in one round',
        facts: [{ text: '$4bn', claimId: A }],
        words: WORDS,
        durationMs: 6000,
      },
    })
  })

  it('refuses a figure that settles on a number no cited claim holds', () => {
    expect(graphicCodeIssue(answer({ source: countUp(7) }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringContaining('7'),
    })
  })

  it('scans before it compiles or runs anything', () => {
    const source = countUp(4).replace('const frame', 'const seed = Math.random()\n  const frame')
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue:
        'the code uses Math.random, which the sandbox bans: a graphic must be a pure function of the frame',
    })
  })

  it('refuses code that does not compile', () => {
    const source = 'function Graphic(props) {\n  return <div>{props.durationMs</div>\n}\n'
    expect(graphicCodeIssue(answer({ source }), CONTEXT, slot(GRAPHIC))).toEqual({
      issue: expect.stringMatching(/^the code does not compile: /),
    })
  })

  it("passes the dry run's refusal through", () => {
    const source = `function Graphic() {
  return <Remotion.AbsoluteFill><div>Raised</div></Remotion.AbsoluteFill>
}
`
    expect(graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(GRAPHIC, 8000))).toEqual({
      issue: 'nothing changes between 0.0 s and 8.0 s',
    })
  })

  it("gives a chart its series as props.data, and a graphic none", () => {
    const facts = [
      { text: '2023', claim: 2 },
      { text: '1', claim: 2 },
      { text: '2024', claim: 1 },
      { text: '4', claim: 1 },
    ]
    const chart = graphicCodeIssue(answer({ source: CHART_SOURCE, facts }), CONTEXT, slot(CHART, 4000))
    expect(chart).toHaveProperty('code')
    const graphic = graphicCodeIssue(
      answer({ source: CHART_SOURCE, facts }),
      CONTEXT,
      slot(GRAPHIC, 4000),
    )
    expect(graphic).toEqual({
      issue:
        "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'series')",
    })
  })

  it("lets a chart show a value from its own series that no claim holds (ruling 4)", () => {
    const shareChart: ChartBrief = {
      ...CHART,
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
    }
    // "104.5" stays on screen the whole slot; no claim in CONTEXT holds it, and
    // the facts cite nothing. A sweep keeps every sample moving.
    const source = `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const sweep = Remotion.interpolate(frame, [0, 119], [0, 100], { extrapolateRight: 'clamp' })
  return (
    <Remotion.AbsoluteFill>
      <div>{String(props.data.series[0].points[0].y)}</div>
      <div style={{ width: sweep + '%', height: 4 }} />
    </Remotion.AbsoluteFill>
  )
}
`
    expect(
      graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(shareChart, 4000)),
    ).toHaveProperty('code')
  })

  it('hands the code every mark the library holds with a size, by title, and no sizeless one (ruling 25)', () => {
    const source = `function Graphic(props) {
  const mark = props.logos['Acme']
  return (
    <Remotion.AbsoluteFill>
      <Remotion.Img src={mark.src} />
      <div>Acme</div>
    </Remotion.AbsoluteFill>
  )
}
`
    expect(graphicCodeIssue(answer({ source, facts: [] }), CONTEXT, slot(GRAPHIC, 4000))).toHaveProperty(
      'code',
    )
    // The same mark with no recorded size is left out of props.logos, as the
    // assembly and the board leave it out, so the code that reads it crashes.
    const sizeless: GraphicDesignContext = {
      ...CONTEXT,
      logos: [{ id: '01J000000000000000000000L1', title: 'Acme', width: null, height: null }],
    }
    expect(graphicCodeIssue(answer({ source, facts: [] }), sizeless, slot(GRAPHIC, 4000))).toEqual({
      issue:
        "the code failed at 0.0 s (frame 0) in landscape: Cannot read properties of undefined (reading 'src')",
    })
  })

  it('refuses a fact citing a claim the list does not have', () => {
    const facts = [
      { text: '$4bn', claim: 1 },
      { text: 'Acme', claim: 9 },
    ]
    expect(graphicCodeIssue(answer({ facts }), CONTEXT, slot(GRAPHIC))).toHaveProperty('issue')
  })
})
```

- [ ] **Step 19: Run it to see it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/check.test.ts`
Expected: FAIL, `Failed to resolve import "./check" from "lib/graphic-code/check.test.ts". Does the file exist?`

- [ ] **Step 20: Write the check**

Create `apps/web/lib/graphic-code/check.ts`:

```ts
import { graphicBrand } from '@boom-busters/compositions/graphic-code'
import {
  DEFAULT_SETTINGS,
  GRAPHIC_CODE_VERSION,
  graphicFactsIssue,
  resolveBrandKit,
  shownDigitGroups,
} from '@boom-busters/schemas'
import type {
  ChartBrief,
  DesignableBrief,
  GraphicCode,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type { GraphicDesignContext } from '@/lib/graphic-design-core'
import { compileGraphicSource } from './compile'
import { dryRunGraphic, GRAPHIC_SAMPLE_MS } from './dry-run'
import { scanGraphicSource } from './scan'

/**
 * Whether a design can be kept (decision 295): the scan, the compile, the
 * dry run and the facts, in that order, cheapest first. The facts come last
 * because they are read off the dry run's text: a digit group counts as
 * shown when it stays on screen for a second, so a counter's passing values
 * ("2.3bn" on the way to "4bn") are never checked and the figure it lands
 * on always is. Synchronous, so it runs inside `callForAnswer`'s parse and a
 * refusal is retried once with its reason.
 */

/** A digit group on screen for this many consecutive samples (one second) is shown. */
const SHOWN_MIN_SAMPLES = 1000 / GRAPHIC_SAMPLE_MS

/**
 * The house brand (ruling 3). The dry run finds crashes, dead air, crops and
 * digits, none of which a colour changes; the real brand reaches the render
 * through the timeline, as it always has.
 */
const DRY_RUN_BRAND = graphicBrand(resolveBrandKit(DEFAULT_SETTINGS))

/**
 * Every mark the library holds, keyed by title (ruling 5), as the assembly and
 * the board hand them over: the code proved here can never meet a missing
 * mark later. The dry run never loads an image, so each `src` is a
 * placeholder, but the size is the mark's own, so code that sizes a logo by
 * its aspect ratio lays it out here as it will on the film. The same rule as
 * the assembly's `logoLibrary` and the board's `codeLogoMarks` (ruling 25): a
 * mark with no title cannot be named and one with no recorded size cannot be
 * placed, so both are left out, and the first mark stored under a title wins.
 * A runner's `setup` memoised before the deploy carries no sizes; a missing
 * size reads as none.
 */
function placeholderLogos(
  context: GraphicDesignContext,
): Record<string, { src: string; width: number; height: number }> {
  const logos: Record<string, { src: string; width: number; height: number }> = {}
  const titles = new Set<string>()
  for (const logo of context.logos) {
    const { title } = logo
    if (title.trim() === '' || titles.has(title) || !logo.width || !logo.height) continue
    titles.add(title)
    logos[title] = { src: `mock://logo/${logo.id}`, width: logo.width, height: logo.height }
  }
  return logos
}

/**
 * A chart's series as one text the shown digits may come from (ruling 4):
 * each series' label and unit, and each point's `x` and `y` (as `String(y)`
 * writes it). The series were copied verbatim from claims when the chart was
 * planned, so a value the code reads off `props.data` needs no claim number.
 * It goes to `graphicFactsIssue` as an extra text, after the real claims and
 * never citable by number.
 */
function seriesText(brief: ChartBrief): string {
  return brief.series
    .map((series) =>
      [
        series.label,
        series.unit,
        ...series.points.flatMap((point) => [point.x, String(point.y)]),
      ].join(' '),
    )
    .join('\n')
}

export function graphicCodeIssue(
  answer: PlannedGraphicCode,
  context: GraphicDesignContext,
  slot: {
    brief: DesignableBrief
    durationMs: number
    words: readonly { text: string; atMs: number }[]
  },
): { code: GraphicCode } | { issue: string } {
  const scanned = scanGraphicSource(answer.source)
  if (scanned !== null) return { issue: scanned }
  const compiled = compileGraphicSource(answer.source)
  if (!compiled.ok) return { issue: compiled.issue }

  const { brief } = slot
  const run = dryRunGraphic({
    compiled: compiled.compiled,
    durationMs: slot.durationMs,
    props: {
      brand: DRY_RUN_BRAND,
      words: slot.words,
      durationMs: slot.durationMs,
      logos: placeholderLogos(context),
      ...(brief.type === 'chart'
        ? {
            data: {
              series: brief.series,
              takeaway: brief.takeaway,
              ...(brief.annotations ? { annotations: brief.annotations } : {}),
            },
          }
        : {}),
    },
  })
  if (run.issue !== null) return { issue: run.issue }

  const factsIssue = graphicFactsIssue({
    shown: shownDigitGroups(run.textSamples, SHOWN_MIN_SAMPLES),
    facts: answer.facts,
    claims: context.claims,
    // After the real claims, so the claim numbers still index them alone.
    ...(brief.type === 'chart' ? { extraTexts: [seriesText(brief)] } : {}),
  })
  if (factsIssue !== null) return { issue: factsIssue }

  const facts: GraphicCode['facts'] = []
  for (const fact of answer.facts) {
    const claim = context.claims[fact.claim - 1]
    if (!claim) return { issue: `the facts cite claim ${fact.claim}, which is not in the list` }
    facts.push({ text: fact.text, claimId: claim.id })
  }
  return {
    code: {
      version: GRAPHIC_CODE_VERSION,
      source: answer.source,
      compiled: compiled.compiled,
      title: answer.title,
      facts,
      words: slot.words.map((word) => ({ text: word.text, atMs: word.atMs })),
      durationMs: slot.durationMs,
    },
  }
}
```

- [ ] **Step 21: Run it to see it pass**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code/check.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 22: Run the folder, the typecheck and the lint**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-code`
Expected: PASS, 4 files, 50 tests (3 compile, 26 scan, 12 dry run, 9 check).

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: exit 0, no output.

Run: `pnpm lint`
Expected: exit 0, no warnings.

Run: `pnpm exec prettier --check apps/web/lib/graphic-code apps/web/package.json apps/web/next.config.ts`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 23: Commit**

```bash
pnpm exec prettier --write apps/web/lib/graphic-code/check.ts apps/web/lib/graphic-code/check.test.ts
git add apps/web/lib/graphic-code/check.ts apps/web/lib/graphic-code/check.test.ts
git commit -m "feat(web): check a design by scan, compile, dry run and facts (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The prompt, the parser and the mock

**Files:**
- Create: `packages/providers/src/prompts/graphic-code-fixture.ts`, `packages/providers/src/prompts/graphic-code-fixture.test.ts`
- Modify: `packages/providers/src/prompts/graphics.ts` (rewrite), `packages/providers/src/prompts/shotlist.ts` (`GRAPHIC_INTENT_RULES` ~:53)
- Delete: `parseGraphicScene`, `mockGraphicScene`, `MOCK_STAGED_MIN_MS` and their tests, inside `graphics.ts` and `graphics.test.ts` (nothing designs a scene after this task; the schema's scene types stay for the renderer)
- Test: `packages/providers/src/prompts/graphics.test.ts` (rewritten), `packages/providers/src/prompts/shotlist.test.ts`, `packages/providers/src/prompts/graphic-code-fixture.test.ts`

**Interfaces:**
- Consumes: Task 1's `PlannedGraphicCodeSchema`, `GRAPHIC_SOURCE_MAX`, `GRAPHIC_TITLE_MAX`, `GRAPHIC_STILL_MAX_MS`; `figureDigitGroups` (schemas); `trimField`, `ignoreRepairs` and `Note` from `./repair` (decision 293).
- Produces: `GRAPHIC_ANSWER_TOKENS`, `GraphicDesignInput` (`current` is `Pick<PlannedGraphicCode, 'source' | 'title'>`, ruling 9), `buildGraphicRequest`, `parseGraphicCode(text, note?)`, `mockGraphicCode`, `GRAPHIC_CODE_FIXTURE_SOURCE`, `GRAPHIC_EXAMPLE_TYPE`, `GRAPHIC_EXAMPLE_CHART`, `GRAPHIC_EXAMPLE_CHART_DATA`.
- `GRAPHIC_CODE_FIXTURE_SOURCE` is the one fixture text (ruling 10). Task 2 already wrote it, character for character, as compositions' `GRAPHIC_CODE_SOURCE`; providers may not depend on compositions, so the equality test lives here and reads compositions' file off disk.

Run every command in this task in the foreground with the Bash `timeout` set to 600000. `packages/providers/src/index.ts` needs no edit: `prompts/index.ts` already re-exports `graphics.ts`, which re-exports the fixture.

**Known red between Task 4 and Task 5:** after Step 13, `pnpm --filter @boom-busters/web typecheck` fails in `apps/web/lib/graphic-design-core.ts` (it imports `parseGraphicScene` and passes a scene as `current`) and `apps/web/lib/graphic-design.ts` (it imports `mockGraphicScene`). Keeping the old exports would not avoid it, since `current` changes type. Task 5 rewrites both files; run Task 8 and then Task 5 next on the same branch (the header's execution order) and push nothing in between.

- [ ] **Step 1: Write the failing shot-list test**

In `packages/providers/src/prompts/shotlist.test.ts`, inside `describe('the graphic shot (decision 268, Plan B)', ...)`, after the test `'asks for a graphic intent and carries no graphic vocabulary (decision 289)'`, add:

```ts
  it('scopes a graphic to what a motion designer would build (decision 295)', () => {
    const rules = GRAPHIC_INTENT_RULES.replace(/\s+/g, ' ')
    expect(rules).toContain(
      "a figure, a comparison, a timeline of dated moments, a diagram of who did what to whom, or a kinetic restatement of the narration's key phrase",
    )
    expect(rules).toContain('a designer writes it afterwards')
    expect(rules).not.toContain('one or two cited figures')
    expect(rules).toContain(
      'never a chart with fewer points: a value moving through time is a "chart"',
    )
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/shotlist.test.ts`
Expected: FAIL, 1 test: `expected 'A "graphic" is for a beat that is one or two cited figures, …' to contain 'a figure, a comparison, a timeline of …'`.

- [ ] **Step 3: Widen the rules**

In `packages/providers/src/prompts/shotlist.ts`, replace the doc comment above `GRAPHIC_INTENT_SHAPE` and the whole `GRAPHIC_INTENT_RULES` constant with:

```ts
/**
 * What a planned graphic is (decision 289): an intent and the claims it rests
 * on, never a design. The graphics designer writes the graphic afterwards
 * (as code since decision 295), so the shot list and the retype prompt share
 * these two pieces and cannot drift. The shape has no leading bullet and the
 * rules no leading dash, so each caller places them in its own list.
 */
```

```ts
export const GRAPHIC_INTENT_RULES = `A "graphic" is for a beat a motion designer would build: a figure, a comparison, a
  timeline of dated moments, a diagram of who did what to whom, or a kinetic restatement of
  the narration's key phrase. It is never a chart with fewer points: a value moving through
  time is a "chart". You do not design it: a designer writes it afterwards from your
  "intent" (what the viewer must take away, not how it looks) and the claims you list in
  "intentRefs". "intentRefs" lists at most ${GRAPHIC_INTENT_REFS_MAX} claim numbers: the claims its figures or names
  come from, most important first. "intent" is at most ${GRAPHIC_INTENT_MAX} characters.`
```

`GRAPHIC_INTENT_SHAPE` itself is unchanged.

- [ ] **Step 4: Run the shot-list and retype tests to see them pass**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/shotlist.test.ts src/prompts/retype.test.ts`
Expected: PASS, both files (the retype test reads the caps from the same constant and still finds them).

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat(providers): the shot list scopes a graphic to what a motion designer builds (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the failing fixture test**

Create `packages/providers/src/prompts/graphic-code-fixture.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from './graphic-code-fixture'

/**
 * The fixture text lives in two places, here and in compositions
 * (`GRAPHIC_CODE_SOURCE`), because providers may not depend on compositions
 * (ruling 10: this is the one text, and compositions holds a copy). Both hold
 * it as a template literal with no backslash, backtick or `${`, so the text
 * between the backticks on disk is the value.
 */
const COMPOSITIONS_FIXTURE = new URL(
  '../../../compositions/src/fixtures/graphic-code.ts',
  import.meta.url,
)

describe('GRAPHIC_CODE_FIXTURE_SOURCE (decision 295)', () => {
  it('is the compositions fixture, character for character', () => {
    const file = readFileSync(COMPOSITIONS_FIXTURE, 'utf8')
    const theirs = /GRAPHIC_CODE_SOURCE(?:: string)? = `([^`]*)`/.exec(file)?.[1]
    expect(theirs).toBe(GRAPHIC_CODE_FIXTURE_SOURCE)
  })

  it('is plain JavaScript a template literal holds verbatim', () => {
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).not.toMatch(/[`\\]|\$\{/)
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).toMatch(/^function Graphic\(props\) \{$/m)
    expect(GRAPHIC_CODE_FIXTURE_SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|<[a-zA-Z]/)
  })
})
```

- [ ] **Step 7: Run it to see it fail**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/graphic-code-fixture.test.ts`
Expected: FAIL, `Failed to resolve import "./graphic-code-fixture" from "src/prompts/graphic-code-fixture.test.ts". Does the file exist?`

- [ ] **Step 8: Write the fixture copy**

Create `packages/providers/src/prompts/graphic-code-fixture.ts`. The string below is the one fixture text (ruling 10), and Task 2 already wrote it, character for character, as `GRAPHIC_CODE_SOURCE` in `packages/compositions/src/fixtures/graphic-code.ts`. If Step 9's equality test fails, one of the two copies was mistyped: make both match the text below, and if compositions' copy changed, redraw its two goldens (Task 2, Steps 18 to 21) before going on.

```ts
/**
 * The graphic the mock designer answers with (decision 295), and the house
 * fixture: compositions holds the same text as `GRAPHIC_CODE_SOURCE`
 * (`packages/compositions/src/fixtures/graphic-code.ts`), because providers
 * may not depend on compositions; `graphic-code-fixture.test.ts` holds the two
 * equal. `mockGraphicCode` swaps its figure for a claim's own. Plain JavaScript with
 * `React.createElement`, so it is its own compiled form: a title fades in,
 * $4bn counts up over the first second, an underline sweeps to the slot's
 * end so nothing is ever still, a second line rises in halfway, and the
 * last frame holds. Colours and type come from `props.brand` only.
 */
export const GRAPHIC_CODE_FIXTURE_SOURCE = `function Graphic(props) {
  const h = React.createElement
  const frame = Remotion.useCurrentFrame()
  const video = Remotion.useVideoConfig()
  const colors = props.brand.colors
  const fonts = props.brand.fonts
  const inset = props.safeArea
  const portrait = video.height > video.width
  const unit = Math.min(video.width, video.height) / 1080
  const last = Math.max(1, video.durationInFrames - 1)
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

  // The title fades in; the figure counts up to $4bn over the first second.
  const titleIn = Remotion.interpolate(frame, [0, 12], [0, 1], clamp)
  const landAt = Math.min(9, Math.max(0, last - video.fps))
  const count = Remotion.spring({
    frame: frame,
    fps: video.fps,
    delay: landAt,
    durationInFrames: video.fps,
    config: { damping: 200 },
  })
  const figure = '$' + Math.round(count * 40) / 10 + 'bn'

  // The underline sweeps from the count to the slot's end, so the graphic
  // never sits still; a second line rises in halfway through.
  const sweepFrom = landAt + video.fps
  const sweep = Remotion.interpolate(frame, [sweepFrom, Math.max(sweepFrom + 1, last)], [0, 1], clamp)
  const half = Math.round(last / 2)
  const nextIn = Remotion.interpolate(frame, [half, half + 12], [0, 1], clamp)

  return h(
    Remotion.AbsoluteFill,
    {
      style: {
        paddingTop: inset.top,
        paddingRight: inset.right,
        paddingBottom: inset.bottom,
        paddingLeft: inset.left,
        justifyContent: 'center',
        alignItems: portrait ? 'center' : 'flex-start',
        textAlign: portrait ? 'center' : 'left',
      },
    },
    h(
      'div',
      {
        style: {
          fontFamily: fonts.title,
          fontSize: 56 * unit,
          color: colors.textSecondary,
          opacity: titleIn,
        },
      },
      'Raised in one round',
    ),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.numbers,
          fontSize: 240 * unit,
          lineHeight: 1.1,
          color: colors.accent,
        },
      },
      figure,
    ),
    h('div', {
      style: {
        height: 10 * unit,
        width: sweep * (portrait ? 80 : 50) + '%',
        backgroundColor: colors.accent,
      },
    }),
    h(
      'div',
      {
        style: {
          fontFamily: fonts.body,
          fontSize: 44 * unit,
          marginTop: 24 * unit,
          color: colors.textPrimary,
          opacity: nextIn,
          transform: 'translateY(' + (1 - nextIn) * 24 * unit + 'px)',
        },
      },
      'Then the next step',
    ),
  )
}
`
```

- [ ] **Step 9: Run it to see it pass**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/graphic-code-fixture.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 10: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/graphic-code-fixture.ts packages/providers/src/prompts/graphic-code-fixture.test.ts
git add packages/providers/src/prompts/graphic-code-fixture.ts packages/providers/src/prompts/graphic-code-fixture.test.ts
git commit -m "test(providers): the mock designer's fixture graphic, held equal to compositions' copy (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 11: Rewrite the failing designer test**

Replace the whole of `packages/providers/src/prompts/graphics.test.ts` with:

````ts
import { describe, expect, it } from 'vitest'
import { PlannedGraphicCodeSchema, ValidationError } from '@boom-busters/schemas'
import {
  buildGraphicRequest,
  estimatedWords,
  GRAPHIC_ANSWER_TOKENS,
  GRAPHIC_CODE_FIXTURE_SOURCE,
  GRAPHIC_EXAMPLE_CHART,
  GRAPHIC_EXAMPLE_CHART_DATA,
  GRAPHIC_EXAMPLE_TYPE,
  mockGraphicCode,
  parseGraphicCode,
  wordsInSlot,
  type GraphicDesignInput,
} from './graphics'
import type { Repair } from './repair'
import { outputBudget } from '../llm/types'

const CLAIMS = [
  {
    id: '01J00000000000000000000001',
    text: 'Acme raised 4 billion dollars in 2024.',
    sourceUrl: null,
    confidence: 'high',
  },
  {
    id: '01J00000000000000000000002',
    text: 'Rival raised 900 million dollars.',
    sourceUrl: null,
    confidence: 'high',
  },
]

const input = (over: Partial<GraphicDesignInput> = {}): GraphicDesignInput => ({
  caseTitle: 'The Acme collapse',
  claims: CLAIMS,
  logos: ['Acme'],
  chapterTitle: 'The raise',
  coversText: 'Acme raised four billion.',
  paragraphText: 'In 2024 Acme raised four billion. Nobody asked how.',
  durationMs: 6000,
  words: [
    { text: 'Acme', offsetMs: 0 },
    { text: 'raised', offsetMs: 400 },
    { text: 'four', offsetMs: 900 },
    { text: 'billion.', offsetMs: 1200 },
  ],
  wordsEstimated: false,
  intent: 'Four billion in one round is the story.',
  intentRefs: [1],
  ...over,
})

const CHART_DATA: NonNullable<GraphicDesignInput['data']> = {
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  takeaway: 'Four times in a year',
  annotations: [{ atX: '2024', text: 'The round' }],
}

describe('the designer prompt (decision 295)', () => {
  const system = buildGraphicRequest(input()).system
  // The rules are one string, wrapped for reading; compare with the wrapping removed.
  const rules = system.replace(/\s+/g, ' ')

  it('asks for a title, a facts manifest and the source as one JSON string', () => {
    expect(system).toContain(
      '{"title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}',
    )
    expect(rules).toContain('one line of at most 80 characters')
    expect(rules).toContain(
      'at most 16384 characters, as one JSON string. Escape its double quotes and line breaks as JSON requires.',
    )
    expect(rules).toContain('A year is a number.')
  })

  it('states the sandbox: its arguments, every Remotion member and every prop', () => {
    expect(rules).toContain('Declare function Graphic(props) at the top level')
    expect(rules).toContain(
      'the sandbox runs your code as the body of a function of (React, Remotion, props) and returns Graphic',
    )
    for (const member of [
      'Remotion.useCurrentFrame()',
      'Remotion.useVideoConfig()',
      'Remotion.interpolate(',
      'Remotion.spring(',
      'Remotion.Easing',
      'Remotion.Sequence',
      'Remotion.AbsoluteFill',
      'Remotion.Img',
      'Remotion.withAlpha(',
      'props.brand.colors',
      'props.brand.fonts',
      'props.words',
      'props.durationMs',
      'props.safeArea',
      'props.logos',
      'props.data',
    ]) {
      expect(system).toContain(member)
    }
    // The intent reaches the model in the slot message, never as a prop (ruling 6).
    expect(system).not.toContain('props.intent')
  })

  it('names every banned identifier and colour literal', () => {
    expect(rules).toContain(
      'Never write import, require, window, document, fetch, setTimeout, setInterval, requestAnimationFrame, Date, Math.random, eval, Function, globalThis, process, useState, useEffect or useLayoutEffect, a # colour, or rgb(), rgba() or hsl(). A scan refuses them.',
    )
  })

  it('states the six rules and what the dry run refuses', () => {
    for (const rule of [
      '1. Facts.',
      '2. Brand.',
      '3. A pure function of the frame.',
      '4. Timing to the narration.',
      '5. Both frames.',
      '6. Safe area.',
    ]) {
      expect(system).toContain(rule)
    }
    expect(rules).toContain(
      "Every number on screen comes from a claim, and its digits appear in that claim's text",
    )
    expect(rules).toContain(
      "a counter's passing values are not checked while they keep moving, so land a count on the claim's figure",
    )
    expect(rules).toContain(
      'Colours come from props.brand.colors only, with Remotion.withAlpha for opacity',
    )
    expect(rules).toContain('a graphic in which nothing changes for more than 6 seconds is refused')
    expect(rules).toContain(
      'the 16:9 frame and the 9:16 frame are both rendered and both checked',
    )
    expect(rules).toContain(
      'Everything sits inside props.safeArea at every frame, entrances included.',
    )
    expect(rules).toContain(
      'a frame that throws, or takes more than 2 seconds, is refused. The last second shows the finished graphic, with words or figures on screen.',
    )
  })

  it('keeps the words rule the scene designer learnt (live run 3, 2026-10-07)', () => {
    expect(rules).toContain('Words on screen say only what the narration or the cited claims say.')
    expect(rules).toContain('no check reads your words, only your numbers.')
  })

  it('teaches the craft, and carries none of the old grid', () => {
    expect(rules).toContain('Kinetic type, not paragraphs')
    expect(rules).toContain('One dominant idea with secondary detail')
    expect(rules).toContain('A spring or an overshoot where the number is the story')
    expect(rules).toContain('An ending that holds rather than vanishes.')
    expect(rules).toContain('Portrait is a first-class frame, not a squeeze')
    expect(system).not.toContain('12 by 12 grid')
    expect(system).not.toContain('portraitCell')
    expect(system).not.toContain('"kind": "figure"')
  })

  it('shows the two worked examples whole, written only against the sandbox', () => {
    expect(system).toContain(GRAPHIC_EXAMPLE_TYPE)
    expect(system).toContain(GRAPHIC_EXAMPLE_CHART)
    expect(system).toContain(JSON.stringify(GRAPHIC_EXAMPLE_CHART_DATA))
    for (const example of [GRAPHIC_EXAMPLE_TYPE, GRAPHIC_EXAMPLE_CHART]) {
      expect(example).toMatch(/^function Graphic\(props\) \{$/m)
      expect(example).not.toMatch(
        /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bDate\b|Math\.random|\bimport\b|\bexport\b|\buseState\b/,
      )
      expect(example).toContain('props.safeArea')
      expect(example).toContain('Remotion.useVideoConfig()')
    }
    expect(GRAPHIC_EXAMPLE_TYPE).toContain('props.words')
    expect(GRAPHIC_EXAMPLE_TYPE).not.toContain('props.data')
    expect(GRAPHIC_EXAMPLE_CHART).toContain('props.data.series')
  })

  it('writes no dash a reader would see', () => {
    expect(system).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('buildGraphicRequest (decision 295)', () => {
  it('routes to graphics with one cacheable film message and the code budget', () => {
    const request = buildGraphicRequest(input())
    expect(request.task).toBe('graphics')
    expect(request.messages).toHaveLength(2)
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(GRAPHIC_ANSWER_TOKENS).toBe(12_000)
    expect(request.maxTokens).toBe(outputBudget(12_000))
  })

  it('keeps the film message identical across two slots of one film', () => {
    const a = buildGraphicRequest(input())
    const b = buildGraphicRequest(input({ coversText: 'Rival raised less.', intentRefs: [2] }))
    expect(a.system).toBe(b.system)
    expect(a.messages[0]).toEqual(b.messages[0])
    expect(a.messages[0]!.content).toContain(
      '[1] (id: 01J00000000000000000000001) Acme raised 4 billion dollars in 2024.',
    )
    expect(a.messages[0]!.content).toContain('- Acme')
  })

  it('gives the slot its length, its words on the clock, its intent and its claims', () => {
    const slot = buildGraphicRequest(input()).messages[1]!.content
    expect(slot).toContain('Length: 6.0 s')
    expect(slot).toContain('0.9 s  four')
    expect(slot).toContain('Intent: Four billion in one round is the story.')
    expect(slot).toContain('Rests on claims: 1')
  })

  it('says when word times are estimated', () => {
    const slot = buildGraphicRequest(input({ wordsEstimated: true })).messages[1]!.content
    expect(slot).toContain('estimated from the slot length')
  })

  it("carries a chart's data, and only on a chart", () => {
    const chart = buildGraphicRequest(input({ data: CHART_DATA })).messages[1]!.content
    expect(chart).toContain(
      `Data (draw every point; values are verbatim from the claims):\n${JSON.stringify(CHART_DATA, null, 2)}`,
    )
    expect(buildGraphicRequest(input()).messages[1]!.content).not.toContain('Data (')
  })

  it('carries the current code in a fenced block on a redesign, then the reason, then the steer', () => {
    const request = buildGraphicRequest(
      input({
        current: {
          title: 'Old title',
          source: 'function Graphic(props) {\n  return null\n}',
        },
        rejection: 'nothing changes between 1.0 s and 8.0 s',
        guidance: 'Make the number bigger.',
      }),
    )
    const contents = request.messages.map((message) => message.content)
    expect(contents).toHaveLength(5)
    expect(contents[2]).toBe(
      'The current design, which the producer wants changed:\nTitle: Old title\n```jsx\nfunction Graphic(props) {\n  return null\n}\n```',
    )
    expect(contents[3]).toBe(
      'Your previous answer for this slot was refused: nothing changes between 1.0 s and 8.0 s. Answer again with that fixed.',
    )
    expect(contents[4]).toBe("The producer's steer: Make the number bigger.")
  })
})

describe('parseGraphicCode (decision 295)', () => {
  const ANSWER = {
    title: 'Raised in one round',
    facts: [{ text: '$4bn', claim: 1 }],
    source: 'function Graphic(props) {\n  return null\n}',
  }

  it('reads an answer, fenced or not', () => {
    expect(parseGraphicCode(JSON.stringify(ANSWER))).toEqual(ANSWER)
    expect(parseGraphicCode(`Here it is:\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``)).toEqual(
      ANSWER,
    )
  })

  it('refuses an answer with no source, naming the field', () => {
    const { source: _source, ...rest } = ANSWER
    expect(() => parseGraphicCode(JSON.stringify(rest))).toThrow(
      /^The graphic answer is malformed: source: /,
    )
  })

  it('trims a title over 80 characters and says so, rather than refusing it (decision 293)', () => {
    const repairs: Repair[] = []
    const long = `${'Raised in one round '.repeat(5)}and then some`
    const parsed = parseGraphicCode(JSON.stringify({ ...ANSWER, title: long }), (repair) =>
      repairs.push(repair),
    )
    expect(parsed.title.length).toBeLessThanOrEqual(80)
    expect(long.startsWith(parsed.title)).toBe(true)
    expect(parsed.source).toBe(ANSWER.source)
    expect(repairs).toEqual([{ action: 'trimmed', field: "the graphic's title" }])
    // Without a note the trim still happens, unreported.
    expect(parseGraphicCode(JSON.stringify({ ...ANSWER, title: long })).title).toBe(parsed.title)
  })

  it('refuses a fact citing claim 0', () => {
    expect(() =>
      parseGraphicCode(JSON.stringify({ ...ANSWER, facts: [{ text: '$4bn', claim: 0 }] })),
    ).toThrow(/facts\.0\.claim: /)
  })

  it('throws a ValidationError on the graphic code field, which the answer helper retries', () => {
    let thrown: unknown
    try {
      parseGraphicCode('{}')
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(ValidationError)
    expect((thrown as ValidationError).field).toBe('graphic code')
  })
})

describe('word offsets', () => {
  it('keeps the words spoken inside the slot, on the slot clock', () => {
    const words = wordsInSlot(
      [
        { text: 'before', startMs: 900 },
        { text: 'four', startMs: 2100 },
        { text: 'after', startMs: 9000 },
      ],
      1200,
      6000,
    )
    expect(words).toEqual([{ text: 'four', offsetMs: 900 }])
  })

  it('spreads the covered words evenly when no timings exist', () => {
    expect(estimatedWords('one two three four', 4000)).toEqual([
      { text: 'one', offsetMs: 0 },
      { text: 'two', offsetMs: 1000 },
      { text: 'three', offsetMs: 2000 },
      { text: 'four', offsetMs: 3000 },
    ])
  })
})

describe('mockGraphicCode (decision 295)', () => {
  const claimTexts = CLAIMS.map((claim) => claim.text)
  /** The fixture's counting figure, which the mock swaps for a claim's own. */
  const COUNTING = "const figure = '$' + Math.round(count * 40) / 10 + 'bn'"
  /** The mock's source with its figure put back: split and join, so no `$` pattern is read. */
  const unswapped = (source: string, line: string) => source.split(line).join(COUNTING)

  it("answers with the fixture graphic, its figure the cited claim's first digit group", () => {
    const mock = mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000 })
    expect(mock.title).toBe('[mock] Raised in one round')
    expect(mock.facts).toEqual([{ text: '$4bn', claim: 1 }])
    expect(mock.source).toContain("const figure = '$4bn'")
    expect(mock.source).not.toContain(COUNTING)
    // Nothing else of the fixture changes.
    expect(unswapped(mock.source, "const figure = '$4bn'")).toBe(GRAPHIC_CODE_FIXTURE_SOURCE)
    expect(PlannedGraphicCodeSchema.safeParse(mock).success).toBe(true)
  })

  it('shows the first digit group of the first intent claim that has one', () => {
    const mock = mockGraphicCode({ claimTexts, intentRefs: [2], durationMs: 6000 })
    expect(mock.facts).toEqual([{ text: '$900bn', claim: 2 }])
    expect(mock.source).toContain("const figure = '$900bn'")
  })

  it('looks past intent claims without digits to the first claim with them', () => {
    const texts = ['No figures here.', 'Rival raised 900 million dollars.']
    expect(mockGraphicCode({ claimTexts: texts, intentRefs: [1], durationMs: 6000 }).facts).toEqual(
      [{ text: '$900bn', claim: 2 }],
    )
    expect(mockGraphicCode({ claimTexts, intentRefs: [], durationMs: 6000 }).facts).toEqual([
      { text: '$4bn', claim: 1 },
    ])
  })

  it('shows no figure and cites nothing when no claim has a digit', () => {
    const mock = mockGraphicCode({
      claimTexts: ['No figures here.'],
      intentRefs: [1],
      durationMs: 6000,
    })
    expect(mock.facts).toEqual([])
    expect(mock.source).toContain("const figure = ''")
    expect(PlannedGraphicCodeSchema.safeParse(mock).success).toBe(true)
  })

  it('differs when steered, so a redesign proves something offline, inside the title cap', () => {
    const steered = mockGraphicCode({
      claimTexts,
      intentRefs: [1],
      durationMs: 6000,
      guidance: 'bigger',
    })
    expect(steered.title).toBe('[mock] Redesigned: bigger')
    const long = mockGraphicCode({
      claimTexts,
      intentRefs: [1],
      durationMs: 6000,
      guidance: 'x'.repeat(200),
    })
    expect(long.title.length).toBeLessThanOrEqual(80)
    expect(PlannedGraphicCodeSchema.safeParse(long).success).toBe(true)
  })

  it('answers the same for a chart slot: the fixture is not a chart', () => {
    expect(
      mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000, data: CHART_DATA }).source,
    ).toBe(mockGraphicCode({ claimTexts, intentRefs: [1], durationMs: 6000 }).source)
  })
})
````

- [ ] **Step 12: Run it to see it fail**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/graphics.test.ts`
Expected: FAIL: the prompt tests fail on the old scene prompt (`expected '…' to contain '{"title": "...", …'`), `parseGraphicCode is not a function`, `mockGraphicCode is not a function`, and `expected 4000 to be 12000`.

- [ ] **Step 13: Rewrite the designer prompt, parser and mock**

Replace the whole of `packages/providers/src/prompts/graphics.ts` with:

````ts
import {
  figureDigitGroups,
  GRAPHIC_SOURCE_MAX,
  GRAPHIC_STILL_MAX_MS,
  GRAPHIC_TITLE_MAX,
  PlannedGraphicCodeSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { ChartSeries, PlannedGraphicCode } from '@boom-busters/schemas'
import { z } from 'zod'
import { GRAPHIC_CODE_FIXTURE_SOURCE } from './graphic-code-fixture'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { ignoreRepairs, trimField, type Note } from './repair'
import { outputBudget, type LLMTaskRequest } from '../llm/types'

export { GRAPHIC_CODE_FIXTURE_SOURCE }

/**
 * The graphics designer (decision 289; it writes code since decision 295):
 * one call per graphic or chart slot, on its own route. The shot list
 * decides that a beat is a graphic and what it must get across; this call
 * writes the graphic, a React component the sandbox in
 * `packages/compositions` runs. The web server checks the answer
 * (`apps/web/lib/graphic-code/`) before it is kept.
 *
 * Three messages: the system rules and the film message are identical for
 * every graphic of a film, so the provider caches them and each graphic pays
 * for its own slot message only.
 */

/** A whole component, with room to think first; a cut-off is asked again at double (decision 292). */
export const GRAPHIC_ANSWER_TOKENS = 12_000

export interface SlotWord {
  text: string
  offsetMs: number
}

export interface GraphicDesignInput {
  caseTitle: string
  /** The film's claims in prompt order: positions are the numbers cited. */
  claims: readonly ScriptClaim[]
  /** Titles the logo library holds. */
  logos: readonly string[]
  chapterTitle: string
  coversText: string
  /** The paragraph or paragraphs the slot sits in, for context. */
  paragraphText: string
  durationMs: number
  words: readonly SlotWord[]
  wordsEstimated: boolean
  intent: string
  intentRefs: readonly number[]
  /** A chart slot: its brief's series, takeaway and annotations, which the code reads as `props.data`. */
  data?: {
    series: ChartSeries[]
    takeaway: string
    annotations?: { atX: string; text: string }[]
  }
  /** A redesign: the source and title being replaced (ruling 9; its facts are not shown). */
  current?: Pick<PlannedGraphicCode, 'source' | 'title'>
  guidance?: string
  /** Why the previous answer to this same slot was refused. */
  rejection?: string
}

/**
 * The prompt's first worked example, a text-only beat. Exported so a test
 * can run it through the web app's checks: an example that crashes or crops
 * teaches the model to be refused.
 */
export const GRAPHIC_EXAMPLE_TYPE = `// Kinetic type: the line builds word by word as it is spoken, the figure
// springs in on "1.9 billion", "never existed" strikes it through, and the
// finished frame holds to the end.
const LINE_UNTIL_MS = 2400
const FIGURE_AT_MS = 2600
const CLOSING_AT_MS = 4400
const STRIKE_AT_MS = 5000

function toFrame(ms, fps) {
  return Math.round((ms / 1000) * fps)
}

function Word(props) {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const enter = Remotion.spring({
    frame, fps, delay: toFrame(props.atMs, fps), config: { damping: 20, stiffness: 200 },
  })
  const rise = 'translateY(' + (1 - enter) * 0.4 + 'em)'
  return (
    <span style={{ display: 'inline-block', marginRight: '0.25em', opacity: enter, transform: rise }}>
      {props.text}
    </span>
  )
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height, fps } = Remotion.useVideoConfig()
  const { colors, fonts } = props.brand
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }

  // The words said before the figure, each entering as it is spoken.
  const line = props.words.filter((word) => word.atMs < LINE_UNTIL_MS)
  // The figure is the story, so it lands with an overshoot.
  const pop = Remotion.spring({
    frame, fps, delay: toFrame(FIGURE_AT_MS, fps), config: { damping: 9, stiffness: 160 },
  })
  const closing = Remotion.interpolate(
    frame, [toFrame(CLOSING_AT_MS, fps), toFrame(CLOSING_AT_MS + 400, fps)], [0, 1], clamp,
  )
  const strike = Remotion.interpolate(
    frame, [toFrame(STRIKE_AT_MS, fps), toFrame(STRIKE_AT_MS + 500, fps)], [0, 1],
    { ...clamp, easing: Remotion.Easing.out(Remotion.Easing.cubic) },
  )

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right,
        paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', gap: 28 * unit,
        alignItems: portrait ? 'center' : 'flex-start', textAlign: portrait ? 'center' : 'left',
      }}
    >
      <div
        style={{
          fontFamily: fonts.heading, fontSize: 72 * unit, lineHeight: 1.15,
          color: colors.textPrimary, maxWidth: portrait ? '100%' : '70%',
        }}
      >
        {line.map((word) => <Word key={word.atMs} text={word.text} atMs={word.atMs} />)}
      </div>
      <div
        style={{
          position: 'relative', fontFamily: fonts.numbers, fontSize: 220 * unit, lineHeight: 1,
          color: colors.accent, transform: 'scale(' + pop + ')',
          transformOrigin: portrait ? 'center' : 'left center',
        }}
      >
        €1.9bn
        <div
          style={{
            position: 'absolute', left: 0, top: '52%', height: 14 * unit,
            width: strike * 100 + '%', backgroundColor: colors.semantic.collapse,
          }}
        />
      </div>
      <div
        style={{
          fontFamily: fonts.title, fontSize: 56 * unit, color: colors.semantic.collapse,
          opacity: closing, transform: 'translateY(' + (1 - closing) * 24 * unit + 'px)',
        }}
      >
        It had never existed.
      </div>
    </Remotion.AbsoluteFill>
  )
}`

/** The second worked example's data, as the slot message would carry it. */
export const GRAPHIC_EXAMPLE_CHART_DATA = {
  series: [
    {
      label: 'Trustee cash reported',
      unit: '€bn',
      points: [
        { x: '2016', y: 0.3 },
        { x: '2017', y: 0.6 },
        { x: '2018', y: 1.1 },
        { x: '2019', y: 1.9 },
      ],
    },
  ],
  takeaway: 'The cash grew every year',
  annotations: [{ atX: '2019', text: 'Never found' }],
}

/** The prompt's second worked example, a chart. Exported for the same reason as the first. */
export const GRAPHIC_EXAMPLE_CHART = `// A chart from props.data: one bar per point, each growing as its year is
// spoken, the takeaway as the title, the annotation landing on its bar after
// the last one has grown, and the finished chart held to the end.
function toFrame(ms, fps) {
  return Math.round((ms / 1000) * fps)
}

// When the narration names a point: the first word that starts with its label.
function spokenAt(point, index, words) {
  const said = words.find((word) => word.text.indexOf(point.x) === 0)
  return said ? said.atMs : 600 + index * 700
}

function Bar(props) {
  const frame = Remotion.useCurrentFrame()
  const { fps } = Remotion.useVideoConfig()
  const { colors, fonts } = props.brand
  const unit = props.unit
  const grow = Remotion.spring({
    frame, fps, delay: toFrame(props.atMs, fps), durationInFrames: 18, config: { damping: 200 },
  })
  const noted = Remotion.spring({
    frame, fps, delay: toFrame(props.noteAtMs, fps), config: { damping: 12, stiffness: 180 },
  })
  const column = { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }
  return (
    <div style={{ ...column, justifyContent: 'flex-end' }}>
      {props.note ? (
        <div
          style={{
            fontFamily: fonts.title, fontSize: 34 * unit, marginBottom: 10 * unit,
            color: colors.semantic.collapse, opacity: noted,
            transform: 'scale(' + (0.8 + 0.2 * noted) + ')',
          }}
        >
          {props.note}
        </div>
      ) : null}
      <div
        style={{
          fontFamily: fonts.numbers, fontSize: 40 * unit, marginBottom: 10 * unit,
          color: props.color, opacity: grow,
        }}
      >
        {String(props.point.y)}
      </div>
      <div
        style={{
          width: '60%', height: props.share * grow * props.plot,
          borderRadius: 6 * unit, backgroundColor: props.color,
        }}
      />
      <div style={{ fontFamily: fonts.body, fontSize: 30 * unit, color: colors.textSecondary }}>
        {props.point.x}
      </div>
    </div>
  )
}

function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { width, height } = Remotion.useVideoConfig()
  const { colors, fonts } = props.brand
  const inset = props.safeArea
  const portrait = height > width
  const unit = Math.min(width, height) / 1080
  const series = props.data.series[0]
  const top = Math.max(...series.points.map((point) => point.y))
  const lands = series.points.map((point, index) => spokenAt(point, index, props.words))
  const last = series.points.length - 1
  const note = (props.data.annotations || [])[0]
  const titleIn = Remotion.interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  const align = portrait ? 'center' : 'left'

  return (
    <Remotion.AbsoluteFill
      style={{
        paddingTop: inset.top, paddingRight: inset.right,
        paddingBottom: inset.bottom, paddingLeft: inset.left,
        justifyContent: 'center', gap: 24 * unit,
      }}
    >
      <div
        style={{
          fontFamily: fonts.heading, fontSize: 60 * unit, lineHeight: 1.1,
          color: colors.textPrimary, opacity: titleIn, textAlign: align,
        }}
      >
        {props.data.takeaway}
      </div>
      <div
        style={{
          fontFamily: fonts.body, fontSize: 28 * unit, color: colors.textSecondary,
          opacity: titleIn, textAlign: align,
        }}
      >
        {series.label + ', ' + series.unit}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 * unit }}>
        {series.points.map((point, index) => (
          <Bar
            key={point.x} brand={props.brand} unit={unit} point={point}
            share={point.y / top} plot={(portrait ? 0.32 : 0.34) * height} atMs={lands[index]}
            color={index === last ? colors.accent : Remotion.withAlpha(colors.textSecondary, 0.55)}
            note={note && note.atX === point.x ? note.text : null} noteAtMs={lands[last] + 1200}
          />
        ))}
      </div>
    </Remotion.AbsoluteFill>
  )
}`

const SYSTEM = `You write ONE motion graphic for a documentary about a corporate collapse, as a React
component. The narration is recorded; your graphic plays over it in the 16:9 film and in
the 9:16 Short, and it lands the beat the narrator is speaking.

You get the case and its numbered claims, the logos the producer holds, and then this
slot: its chapter, the paragraph it sits in, the words it covers, its length, every
spoken word with its time from the slot's start, the intent (what the viewer must take
away) and the claims it rests on. A chart slot also carries its data.

Answer with JSON only:
{"title": "...", "facts": [{"text": "...", "claim": 3}], "source": "..."}
- "title": the slot card's name for the graphic, one line of at most ${GRAPHIC_TITLE_MAX} characters.
- "facts": every number and every quoted phrase the graphic shows, each with the NUMBER
  of the claim it comes from. A year is a number.
- "source": the component, at most ${GRAPHIC_SOURCE_MAX} characters, as one JSON string. Escape
  its double quotes and line breaks as JSON requires.

The sandbox your code runs in:
- Declare function Graphic(props) at the top level; helper components and constants
  beside it are fine. Write no import and no export: the sandbox runs your code as the
  body of a function of (React, Remotion, props) and returns Graphic. JSX compiles to
  React.createElement.
- React: React itself, for elements, React.Fragment and React.useMemo.
- Remotion.useCurrentFrame(): the frame, from 0 at the slot's start, 30 to the second.
- Remotion.useVideoConfig(): {width, height, fps, durationInFrames}; the frame is 1920 by
  1080 or 1080 by 1920.
- Remotion.interpolate(value, inputRange, outputRange, {easing, extrapolateLeft,
  extrapolateRight}): inputRange strictly increasing; "clamp" holds the ends.
- Remotion.spring({frame, fps, delay, durationInFrames, config: {damping, stiffness,
  mass}}): 0 to 1, overshooting when damping is low.
- Remotion.Easing: Remotion's easing functions, such as
  Remotion.Easing.out(Remotion.Easing.cubic) and Remotion.Easing.bezier(0.2, 0, 0, 1).
- Remotion.Sequence {from, durationInFrames}: its children show only inside that window,
  and inside it useCurrentFrame() counts from 0.
- Remotion.AbsoluteFill {style}: a full-frame layer, laid out as a flex column.
- Remotion.Img {src, style}: an image, for a logo.
- Remotion.withAlpha(color, alpha): a brand colour at an opacity from 0 to 1.
- props.brand.colors: primary, accent, background, surface, textPrimary, textSecondary and
  captionHighlight; chartSeries, a list of colours for compared things; semantic.collapse
  and semantic.recovery.
- props.brand.fonts: heading, title, body, numbers and captions, family names for
  fontFamily. Figures are set in numbers.
- props.words: the narration, [{text, atMs}], atMs from the slot's start.
- props.durationMs: the slot's length.
- props.safeArea: {top, right, bottom, left}, insets in pixels for this frame size. The
  captions sit below the bottom inset.
- props.logos: {[title]: {src, width, height}} for the marks in the Logos list, under
  their exact titles. A mark can be missing: draw it only when props.logos holds it.
- props.data: on a chart slot, {series: [{label, unit, points: [{x, y}]}], takeaway,
  annotations?: [{atX, text}]}. Absent otherwise.
Never write import, require, window, document, fetch, setTimeout, setInterval,
requestAnimationFrame, Date, Math.random, eval, Function, globalThis, process, useState,
useEffect or useLayoutEffect, a # colour, or rgb(), rgba() or hsl(). A scan refuses them.

The rules. Each one is checked, and a graphic that breaks one is refused:
1. Facts. Every number on screen comes from a claim, and its digits appear in that
   claim's text ("$4bn" from "4 billion dollars" is fine; "$4.2bn" is not). A number that
   stays on screen for a second must be in a claim your facts cite; a counter's passing
   values are not checked while they keep moving, so land a count on the claim's figure.
   Words on screen say only what the narration or the cited claims say. Never add a
   fact, a judgement, a qualifier or a source note of your own ("never audited", "widely
   cited", "allegedly"): this is a film about real companies and real people, and no
   check reads your words, only your numbers.
2. Brand. Colours come from props.brand.colors only, with Remotion.withAlpha for opacity;
   type comes from props.brand.fonts. The house paints the background behind your
   graphic.
3. A pure function of the frame. The same frame always draws the same picture: no clock,
   no randomness, no state, nothing that runs after the render.
4. Timing to the narration. Each new thing said gets its own change on screen, landing as
   it is said: a figure as its number is spoken, a name as it is named, a bar as its year
   is read. Dead air is the failure to avoid: a graphic in which nothing changes for more
   than ${GRAPHIC_STILL_MAX_MS / 1000} seconds is refused.
5. Both frames. Lay out from useVideoConfig()'s width and height: the 16:9 frame and the
   9:16 frame are both rendered and both checked.
6. Safe area. Everything sits inside props.safeArea at every frame, entrances included.
   Pad a full-frame layer by the insets, place anything absolutely positioned at or
   inside them, and bring an entrance in with opacity, scale or transform, never from
   outside the insets. Only a Remotion.AbsoluteFill spans the whole frame.
The code is run at every 250 ms of the slot in both frames before it is kept: a frame
that throws, or takes more than 2 seconds, is refused. The last second shows the
finished graphic, with words or figures on screen.

Craft:
- Kinetic type, not paragraphs: a few words at a time, big, entering as they are spoken.
  A line can build word by word.
- One dominant idea with secondary detail: one thing is biggest, and the rest supports it.
- Motion keyed to the spoken words: each new thing said gets its own change, whether an
  entrance, a highlight, a bar growing or a line drawing across.
- A spring or an overshoot where the number is the story; ease everything else
  (Remotion.Easing.out(Remotion.Easing.cubic) for an arrival). Stagger related pieces a
  few frames apart rather than landing them together.
- An ending that holds rather than vanishes.
- Portrait is a first-class frame, not a squeeze: stack what sits side by side, and size
  type from Math.min(width, height).
- Colour carries meaning: semantic.collapse for loss and failure, semantic.recovery for
  gain, accent or captionHighlight for the one thing to look at, chartSeries to tell
  compared things apart, textPrimary and textSecondary for words.
- A logo earns its place when the company or person is the subject, not because they
  are mentioned.
- A chart draws every point of props.data, labels each value as its claim states it, and
  says its takeaway.

Example 1, a text-only beat. The slot is 7.5 s; its words are "The" 0.0 s, "auditors"
0.3 s, "could" 0.9 s, "not" 1.2 s, "find" 1.5 s, "1.9" 2.6 s, "billion" 3.0 s, "euros."
3.4 s, "It" 4.4 s, "had" 4.6 s, "never" 5.0 s, "existed." 5.4 s. Claim 2 reads "Wirecard
reported €1.9 billion in trustee accounts that auditors could not confirm existed." The
answer is {"title": "The missing €1.9bn", "facts": [{"text": "€1.9bn", "claim": 2}],
"source": this component as a JSON string}:

${GRAPHIC_EXAMPLE_TYPE}

Example 2, a chart slot. The slot is 7.2 s; "2016" is said at 1.0 s, "2017" at 2.0 s,
"2018" at 3.0 s and "2019" at 4.2 s. Its data is
${JSON.stringify(GRAPHIC_EXAMPLE_CHART_DATA)}
Claims 5 to 8 hold the four years' figures. The answer is {"title": "Trustee cash, year
by year", "facts": [{"text": "2016", "claim": 5}, {"text": "0.3", "claim": 5}, {"text":
"2017", "claim": 6}, {"text": "0.6", "claim": 6}, {"text": "2018", "claim": 7}, {"text":
"1.1", "claim": 7}, {"text": "2019", "claim": 8}, {"text": "1.9", "claim": 8}], "source":
this component as a JSON string}:

${GRAPHIC_EXAMPLE_CHART}`

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest {
  const logos = input.logos.filter((title) => title.trim().length > 0)
  const film =
    `Case: ${input.caseTitle}\n\nClaims:\n${claimList(input.claims)}` +
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds):\n${logos.map((title) => `- ${title}`).join('\n')}`
      : '')

  const words = input.words.map((word) => `${seconds(word.offsetMs)}  ${word.text}`).join('\n')
  const slot =
    `Chapter: ${input.chapterTitle}\n\n` +
    `The paragraph: ${input.paragraphText}\n\n` +
    `This graphic covers: ${input.coversText}\n` +
    `Length: ${seconds(input.durationMs)}\n\n` +
    `Words spoken in it, from its start${input.wordsEstimated ? ' (estimated from the slot length; no recorded timings)' : ''}:\n${words}\n\n` +
    `Intent: ${input.intent}\n` +
    `Rests on claims: ${input.intentRefs.length > 0 ? input.intentRefs.join(', ') : 'none named'}` +
    (input.data
      ? `\n\nData (draw every point; values are verbatim from the claims):\n${JSON.stringify(input.data, null, 2)}`
      : '')

  return {
    task: 'graphics',
    system: SYSTEM,
    messages: [
      { role: 'user', content: film },
      { role: 'user', content: slot },
      ...(input.current ? [{ role: 'user' as const, content: currentDesign(input.current) }] : []),
      ...(input.rejection
        ? [
            {
              role: 'user' as const,
              content: `Your previous answer for this slot was refused: ${input.rejection}. Answer again with that fixed.`,
            },
          ]
        : []),
      // Last, nearest the answer, and only when there is one.
      ...(input.guidance
        ? [{ role: 'user' as const, content: `The producer's steer: ${input.guidance}` }]
        : []),
    ],
    cacheablePrefixMessages: 1,
    maxTokens: outputBudget(GRAPHIC_ANSWER_TOKENS),
  }
}

/** A redesign's starting point: the title, and the code fenced so its JSX reads as code. */
function currentDesign(current: Pick<PlannedGraphicCode, 'source' | 'title'>): string {
  return (
    'The current design, which the producer wants changed:\n' +
    `Title: ${current.title}\n` +
    '```jsx\n' +
    current.source +
    '\n```'
  )
}

/**
 * The designer's answer, validated. The title is free text, so one over
 * `GRAPHIC_TITLE_MAX` is trimmed with `trimField` and the trim reported
 * through `note` (decision 293). Nothing else is repaired: a cut source would
 * not compile, and a claim number or a fact's text is a fact. A malformed
 * answer is refused, and the retry is told why (decision 292).
 */
export function parseGraphicCode(text: string, note: Note = ignoreRepairs): PlannedGraphicCode {
  const raw = parseJsonCompletion(text, z.looseObject({}), 'graphic code')
  const parsed = PlannedGraphicCodeSchema.safeParse({
    ...raw,
    title: trimField(raw['title'], GRAPHIC_TITLE_MAX, "the graphic's title", note),
  })
  if (!parsed.success) {
    throw new ValidationError(`The graphic answer is malformed: ${formatIssues(parsed.error)}`, {
      field: 'graphic code',
    })
  }
  return parsed.data
}

/** The words spoken inside a slot, on the slot's own clock. */
export function wordsInSlot(
  words: readonly { text: string; startMs: number }[],
  startMs: number,
  durationMs: number,
): SlotWord[] {
  return words
    .filter((word) => word.startMs >= startMs && word.startMs < startMs + durationMs)
    .map((word) => ({ text: word.text, offsetMs: word.startMs - startMs }))
}

/** No recorded timings: the covered words spread evenly across the slot. */
export function estimatedWords(coversText: string, durationMs: number): SlotWord[] {
  const words = coversText.split(/\s+/).filter(Boolean)
  const step = words.length > 0 ? durationMs / words.length : 0
  return words.map((text, at) => ({ text, offsetMs: Math.round(at * step) }))
}

/**
 * The fixture's counting figure, which lands on "$4bn". The mock swaps the
 * whole expression for a literal figure built from a claim's own digits.
 */
const FIXTURE_FIGURE = "'$' + Math.round(count * 40) / 10 + 'bn'"

/**
 * Deterministic design for MOCK_PROVIDERS=1 (decision 295; ruling 11): the
 * fixture graphic, its figure swapped for `'$<digits>bn'`, where the digits
 * are the first digit group of the claim it cites (the first intent claim
 * with a digit, else the first claim with one), and its one fact that figure
 * on that claim. With no digit-bearing claim the figure is `''` and the
 * design cites nothing. Either way it passes the real checks on any seed.
 * Steered, the title says so, so a redesign proves something offline. The
 * fixture reads its frame and length from the sandbox: the slot's length and
 * a chart's data change nothing, and are taken so the mock is called as the
 * designer is.
 */
export function mockGraphicCode(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  guidance?: string
  durationMs: number
  data?: GraphicDesignInput['data']
}): PlannedGraphicCode {
  const cited = mockFigure(input.claimTexts, input.intentRefs)
  const figure = cited?.text ?? ''
  return {
    title: input.guidance
      ? `[mock] Redesigned: ${input.guidance}`.slice(0, GRAPHIC_TITLE_MAX).trim()
      : '[mock] Raised in one round',
    facts: cited ? [cited] : [],
    // A replacer function, so the `$` in the figure is never read as a pattern.
    source: GRAPHIC_CODE_FIXTURE_SOURCE.replace(FIXTURE_FIGURE, () => `'${figure}'`),
  }
}

/** `'$<digits>bn'` on the claim it comes from, or null when no claim has a digit. */
function mockFigure(
  claimTexts: readonly string[],
  intentRefs: readonly number[],
): { text: string; claim: number } | null {
  const everyClaim = claimTexts.map((_, index) => index + 1)
  for (const claim of [...intentRefs, ...everyClaim]) {
    const digits = figureDigitGroups(claimTexts[claim - 1] ?? '')[0]
    if (digits !== undefined) return { text: `$${digits}bn`, claim }
  }
  return null
}
````

- [ ] **Step 14: Run it to see it pass**

Run: `pnpm --filter @boom-busters/providers vitest run src/prompts/graphics.test.ts`
Expected: PASS, 27 tests.

- [ ] **Step 15: Run the package, its typecheck and the lint**

Run: `pnpm --filter @boom-busters/providers test`
Expected: PASS, every file (the retype and shot-list tests included).

Run: `pnpm --filter @boom-busters/providers typecheck`
Expected: exit 0, no output.

Run: `pnpm lint`
Expected: exit 0, no warnings.

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: FAIL with exactly the errors this task leaves for Task 5: `lib/graphic-design-core.ts` (`'"@boom-busters/providers"' has no exported member named 'parseGraphicScene'`, and the scene passed as `current` is not assignable to `Pick<PlannedGraphicCode, 'source' | 'title'>`) and `lib/graphic-design.ts` (no exported member `mockGraphicScene`). Any other error is a regression: fix it before committing.

Run: `pnpm exec prettier --check packages/providers/src/prompts`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 16: Commit**

```bash
pnpm exec prettier --write packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts
git add packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts
git commit -m "feat(providers): the designer writes the graphic as code (decision 295)" -m "The prompt states the sandbox, the six rules, the craft and two worked components; the intent stays in the slot message, never a prop. The answer is title, facts and source; an over-long title is trimmed and reported (decision 293), nothing else repaired. The mock answers with the fixture graphic, its figure swapped for the cited claim's own digits, so it passes the real checks on any seed. apps/web typechecks again once Task 5 lands." -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The designer on code, and the runners that call it

**Files:**
- Modify: `apps/web/lib/graphic-design-core.ts`, `apps/web/lib/graphic-design.ts`, `apps/web/inngest/lib/graphic-steps.ts`, `apps/web/inngest/functions/slot-retyper.ts` (~:258-310), `apps/web/inngest/functions/slot-rebriefer.ts` (~:160-200)
- Test: `apps/web/lib/graphic-design.test.ts` (rewritten), `apps/web/inngest/lib/graphic-steps.test.ts` (rewritten), `apps/web/inngest/functions/visuals-runner.test.ts`, `apps/web/inngest/functions/slot-retyper.test.ts`, `apps/web/inngest/functions/slot-rebriefer.test.ts`; `apps/web/inngest/functions/visuals-replanner.test.ts` is run, not changed

**Interfaces:**
- Consumes: Task 3's `graphicCodeIssue`; Task 4's `buildGraphicRequest`, `parseGraphicCode(text, note)`, `mockGraphicCode`; Task 1's `DesignableBrief`, `GraphicCode`.
- Produces: `GraphicDesignResult`, `designGraphicWith`, `designGraphic`, `withDesign`, `slotIntent` as in the contract; `designPlannedGraphics` designing rows of type `graphic` or `chart` that lack `code`; `designableBrief`. `GraphicDesignContext` gains no field (ruling 3: the dry run uses the house brand), so `visuals-runner.ts` and `visuals-replanner.ts` are not edited here: their `setup` already carries everything the designer reads, each logo's size included since Task 1 (ruling 25).

**Parked runs.** `designPlannedGraphics` designs each row inside its own step and hands the rows back whole, so nothing reads a new field from a step result written before the deploy: a graphic step replayed from before the deploy returns a brief with a `scene`, which is stored as it was, and the `undesigned` count reads `designIssue`, which old and new results set the same way. Graphics keep their step ids (`<prefix>-<n>`, counting graphics only); charts take new ones (`<prefix>-chart-<n>`), so a run planning across the deploy runs them fresh instead of reading a graphic's memo into a chart row. No new field is read outside a step. The retyper's design step and the rebriefer's redesign read the slot fresh inside their own steps.

**Database suites.** `visuals-runner.test.ts`, `visuals-replanner.test.ts`, `slot-retyper.test.ts` and `slot-rebriefer.test.ts` run against the test database: start Docker Desktop first, run one database suite at a time, in the foreground with a Bash `timeout` of 600000. A suite reported as skipped means the test database is not up; that is not a pass.

- [ ] **Step 1: Rewrite the designer's test for code**

Replace the whole of `apps/web/lib/graphic-design.test.ts` with:

```ts
// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BudgetExceededError,
  ChartBriefSchema,
  GraphicBriefSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type {
  ChartBrief,
  GraphicBrief,
  GraphicCode,
  PlannedGraphicCode,
} from '@boom-busters/schemas'
import type * as Providers from '@boom-busters/providers'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
let mock = false
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  mockProvidersEnabled: () => mock,
}))

import { graphicCodeIssue } from './graphic-code/check'
import { slotIntent } from './graphic-design-core'
import {
  designGraphic,
  designGraphicWith,
  designIssueText,
  GRAPHIC_DESIGN_DEADLINE_MS,
  withDesign,
  type GraphicDesignContext,
} from './graphic-design'

const A = '01J00000000000000000000001'
const CONTEXT: GraphicDesignContext = {
  projectId: '01J0000000000000000000000P',
  caseTitle: 'Acme',
  claims: [{ id: A, text: 'Acme raised 4 billion dollars.', sourceUrl: null, confidence: 'high' }],
  logos: [],
  paragraphs: [
    {
      chapterId: 'c1',
      index: 0,
      text: 'Acme raised four billion.',
      startMs: 0,
      durationMs: 6000,
      words: [{ text: 'four', startMs: 900 }],
    },
  ],
  chapterTitle: 'The raise',
}
const BRIEF: GraphicBrief = {
  type: 'graphic',
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' },
  transition: 'cut',
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const CHART: ChartBrief = {
  type: 'chart',
  coversText: 'Acme raised four billion.',
  description: 'The raise, drawn.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'bar',
  series: [
    {
      label: 'Raised',
      unit: 'USD bn',
      points: [
        { x: '2023', y: 1 },
        { x: '2024', y: 4 },
      ],
    },
  ],
  dataRefs: [A],
  takeaway: 'Four billion in a year.',
  reveal: 'draw-on',
}
const SLOT = { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: BRIEF }
/** The slot's words as the code reads them: "four" at 0.9 s. */
const WORDS = [{ text: 'four', atMs: 900 }]

/**
 * A title over a figure that lands as "four" is said, with a slow drift so no
 * stretch of the slot is still. `value` is the figure on screen.
 */
const figureSource = (value: string) => `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { durationInFrames } = Remotion.useVideoConfig()
  const land = Remotion.interpolate(frame, [27, 42], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const drift = Remotion.interpolate(frame, [0, durationInFrames], [1, 1.04])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: props.brand.colors.background, transform: 'scale(' + drift + ')' }}>
      <div style={{ color: props.brand.colors.textSecondary, fontFamily: props.brand.fonts.title, fontSize: 56 }}>Raised in one round</div>
      <div style={{ opacity: land, color: props.brand.colors.accent, fontFamily: props.brand.fonts.numbers, fontSize: 220 }}>${value}</div>
    </div>
  )
}`

const planned = (value: string): PlannedGraphicCode => ({
  source: figureSource(value),
  title: 'Raised in one round',
  facts: [{ text: '4 billion', claim: 1 }],
})
const answer = (value: string) => ({ text: JSON.stringify(planned(value)) })

/** A component that throws once the reveal comes. */
const THROWS: PlannedGraphicCode = {
  source: `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  if (frame >= 40) throw new Error('boom at the reveal')
  return <div style={{ color: props.brand.colors.textPrimary }}>Raised</div>
}`,
  title: 'Raised',
  facts: [],
}

/** A component esbuild cannot compile. */
const BROKEN: PlannedGraphicCode = {
  source: 'function Graphic(props) { return <div>Raised</ }',
  title: 'Raised',
  facts: [],
}

/** An answer cut off mid-JSON. */
const HALF = { text: '{"source": "function Graphic(props) {', truncated: true }

/**
 * The refusal the checks give a design in this slot, worded as the checks
 * word it: the retry and the stored issue carry exactly this.
 */
function issueOf(design: PlannedGraphicCode): string {
  const checked = graphicCodeIssue(design, CONTEXT, {
    brief: BRIEF,
    durationMs: 6000,
    words: WORDS,
  })
  if ('code' in checked) throw new Error('expected the checks to refuse this design')
  return checked.issue
}

/** Every message one call sent, as one text, however the prompt splits it. */
const sent = (call = 0) =>
  (callLlm.mock.calls[call]![0].messages as { content: string }[])
    .map((message) => message.content)
    .join('\n\n')

/** A stored design, for the redesign and `withDesign` tests. */
const CODE: GraphicCode = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'function Graphic() {\n  return null;\n}\n',
  title: 'Raised in one round',
  facts: [{ text: '4 billion', claimId: A }],
  words: WORDS,
  durationMs: 6000,
}

beforeEach(() => {
  callLlm.mockReset()
  mock = false
})

afterEach(() => {
  vi.useRealTimers()
})

const CUT_OFF = "the designer's answer was cut off at its length limit"
const TOO_LONG = 'the designer took too long; press Redesign graphic to try again'

describe('designGraphic (decisions 289, 295)', () => {
  it('stores code that passes every check, compiled, its facts on claim ids and its words on the slot clock', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toMatchObject({
      ok: true,
      code: {
        version: 1,
        source: figureSource('$4bn'),
        title: 'Raised in one round',
        facts: [{ text: '4 billion', claimId: A }],
        words: WORDS,
        durationMs: 6000,
      },
    })
    if (!result.ok) throw new Error('unreachable')
    // Plain JavaScript: the JSX is compiled away, so the sandbox builds it as it is.
    expect(result.code.compiled).not.toContain('<div')
    expect(sent()).toContain('four')
  })

  it('asks once more with the reason, and takes the second answer', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      issueOf(planned('$5bn')),
    )
    expect(callLlm.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
  })

  it('gives up after the second refusal, with the reason', async () => {
    callLlm.mockResolvedValue(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: issueOf(planned('$5bn')),
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('refuses code that throws while it plays, naming the error (decision 295)', async () => {
    callLlm.mockResolvedValue({ text: JSON.stringify(THROWS) })
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toEqual({ ok: false, issue: issueOf(THROWS) })
    expect(result.ok ? '' : result.issue).toContain('boom at the reveal')
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries a cut-off answer once at double the budget', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
  })

  it('refuses code that does not compile, and retries with the reason (decision 295)', async () => {
    callLlm
      .mockResolvedValueOnce({ text: JSON.stringify(BROKEN) })
      .mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(issueOf(BROKEN))
  })

  it('reports an answer cut off twice as a design issue, without a reason-retry', async () => {
    callLlm.mockRejectedValue(new ValidationError('cut off', { field: 'maxTokens' }))
    await expect(designGraphic(CONTEXT, SLOT)).resolves.toEqual({ ok: false, issue: CUT_OFF })
    // The first try and its doubled retry; a third call at the doubled
    // budget would be cut off again (final review I2).
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('retries an answer cut off mid-JSON at double the budget', async () => {
    callLlm.mockResolvedValueOnce(HALF).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
    // The doubled call is the same request, not a reason-retry.
    expect(callLlm.mock.calls[1]![0].messages).toEqual(callLlm.mock.calls[0]![0].messages)
  })

  it('ends the design at once when the doubled answer is cut off mid-JSON too', async () => {
    callLlm.mockResolvedValue(HALF)
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the retry after a refusal is cut off (decision 292)', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(HALF)
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: CUT_OFF })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('stops at two calls when the doubled answer is refused (decision 292)', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: issueOf(planned('$5bn')),
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('gives every call a signal that aborts at the design deadline', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[0]![1]).toMatchObject({
      projectId: CONTEXT.projectId,
      signal: expect.any(AbortSignal),
    })
  })

  it('reports a call that fails after the deadline as too long, without throwing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS + 1)
      throw new Error('This operation was aborted')
    })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: TOO_LONG })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('does not start a second attempt with under 15 s left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS - 14_000)
      return answer('$5bn')
    })
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({ ok: false, issue: TOO_LONG })
    expect(callLlm).toHaveBeenCalledTimes(1)
  })

  it('lets a budget stop through even past the deadline', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    callLlm.mockImplementation(async () => {
      vi.setSystemTime(1_000_000 + GRAPHIC_DESIGN_DEADLINE_MS + 1)
      throw new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 10,
        monthSpendUsd: 10,
        estimateUsd: 0.1,
      })
    })
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toBeInstanceOf(BudgetExceededError)
  })

  it('lets a failure inside the deadline through', async () => {
    callLlm.mockRejectedValue(new Error('provider down'))
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toThrow('provider down')
  })

  it('lets any other ValidationError from the call through', async () => {
    callLlm.mockRejectedValue(
      new ValidationError('anthropic rejected the API key (401).', {
        field: 'connections.anthropic',
      }),
    )
    await expect(designGraphic(CONTEXT, SLOT)).rejects.toThrow('rejected the API key')
  })

  it('shows a redesign the current code, then the steer last', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const designed = await designGraphic(CONTEXT, SLOT)
    if (!designed.ok) throw new Error('setup design failed')
    callLlm.mockReset()
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(
      CONTEXT,
      { ...SLOT, brief: { ...BRIEF, code: designed.code } },
      { redesign: true, guidance: 'Make the number bigger.' },
    )
    // The component being replaced reaches the model; `fontSize: 220` is in its source only.
    expect(sent()).toContain('fontSize: 220')
    const messages = callLlm.mock.calls[0]![0].messages as { content: string }[]
    expect(messages.at(-1)!.content).toBe("The producer's steer: Make the number bigger.")
  })

  it('designs from the description when the graphic predates intents', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const { intent: _i, intentClaimIds: _c, ...legacy } = BRIEF
    await designGraphic(CONTEXT, { ...SLOT, brief: legacy })
    expect(sent()).toContain('The figure.')
  })

  it('sends a chart its series and takeaway, and stores the code (decision 295)', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, { ...SLOT, brief: CHART })
    expect(result).toMatchObject({
      ok: true,
      code: { title: 'Raised in one round', facts: [{ claimId: A }] },
    })
    expect(sent()).toContain('Four billion in a year.')
    expect(sent()).toContain('USD bn')
  })

  it('makes no call in mock mode, and the fixture passes every check (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, SLOT)
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      code: { version: 1, title: expect.stringMatching(/^\[mock\]/) },
    })
    if (!result.ok) throw new Error('unreachable')
    expect(typeof result.code.compiled).toBe('string')
    // The mock's figure cites the claim the intent rests on.
    expect(result.code.facts).toContainEqual(expect.objectContaining({ claimId: A }))
  })

  it('designs a 12 s slot in mock mode, through the same dead-air check (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, durationMs: 12_000 })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, code: { durationMs: 12_000 } })
  })

  it('designs a chart in mock mode around its series (decision 295)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, brief: CHART })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result.ok).toBe(true)
  })
})

describe('slotIntent', () => {
  it('designs a graphic from its intent and the claims it names', () => {
    expect(slotIntent(CONTEXT, BRIEF)).toEqual({
      intent: 'Four billion is the story.',
      intentRefs: [1],
    })
  })

  it('designs a chart from its takeaway, resting on its data refs (decision 295)', () => {
    expect(slotIntent(CONTEXT, CHART)).toEqual({
      intent: 'Four billion in a year.',
      intentRefs: [1],
    })
  })

  it('drops a data ref the claim list no longer holds', () => {
    expect(
      slotIntent(CONTEXT, { ...CHART, dataRefs: ['01J0000000000000000000000Z'] }).intentRefs,
    ).toEqual([])
  })
})

describe('withDesign', () => {
  it('stores the code and clears any old issue', () => {
    const designed = withDesign({ ...BRIEF, designIssue: 'old' }, { ok: true, code: CODE })
    expect(designed.designIssue).toBeUndefined()
    expect(designed.code).toEqual(CODE)
  })

  it('stores the issue without code', () => {
    expect(withDesign(BRIEF, { ok: false, issue: 'why' })).toEqual({ ...BRIEF, designIssue: 'why' })
  })

  it('keeps the code a refused redesign would have replaced (decision 295)', () => {
    const kept = withDesign({ ...BRIEF, code: CODE }, { ok: false, issue: 'why' })
    expect(kept.code).toEqual(CODE)
    expect(kept.designIssue).toBe('why')
  })

  it("stores a chart's code on the chart, which still parses as one (decision 295)", () => {
    const designed = ChartBriefSchema.parse(withDesign(CHART, { ok: true, code: CODE }))
    expect(designed).toMatchObject({ type: 'chart', series: CHART.series, code: CODE })
  })

  it('caps an overlong issue so the stored brief still parses (final review I1)', () => {
    const issue = `The graphic is malformed: ${'elements.0.cell: too wide; '.repeat(40)}`.slice(
      0,
      900,
    )
    expect(issue).toHaveLength(900)
    const designed = withDesign(BRIEF, { ok: false, issue })
    const parsed = GraphicBriefSchema.parse(designed)
    expect(parsed.designIssue!.length).toBeLessThanOrEqual(500)
    expect(parsed.designIssue!.endsWith('…')).toBe(true)
    expect(issue.startsWith(parsed.designIssue!.slice(0, -1))).toBe(true)
  })
})

describe('designGraphicWith (the model call is injected)', () => {
  it('designs through the function it is given, handing it the request and a signal, and never touches callLlm', async () => {
    const complete = vi.fn().mockResolvedValue(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, code: { facts: [{ claimId: A }] } })
    expect(complete).toHaveBeenCalledTimes(1)
    const [request, options] = complete.mock.calls[0]!
    expect(
      (request.messages as { content: string }[]).map((message) => message.content).join('\n\n'),
    ).toContain('four')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(callLlm).not.toHaveBeenCalled()
  })

  it('keeps the cut-off doubling of the app path, and stops at two calls (decision 292)', async () => {
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$5bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result.ok).toBe(false)
    expect(complete).toHaveBeenCalledTimes(2)
    expect(complete.mock.calls[1]![0].maxTokens).toBe(complete.mock.calls[0]![0].maxTokens * 2)
    expect(complete.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: cut off' })
  })

  it('keeps the reason-retry of the app path', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(answer('$5bn'))
      .mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphicWith(complete, CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(complete.mock.calls[1]![0].messages.at(-1).content).toContain(
      issueOf(planned('$5bn')),
    )
    expect(complete.mock.calls[1]![1]).toMatchObject({ purpose: 'retry: refused' })
  })
})

describe('designIssueText', () => {
  it('leaves a short issue as it is, trimmed', () => {
    expect(designIssueText('  why  ')).toBe('why')
  })

  it('cuts at a word boundary and marks the cut', () => {
    const text = designIssueText(`${'word '.repeat(180)}`)
    expect(text.length).toBeLessThanOrEqual(500)
    expect(text).toMatch(/word…$/)
  })

  it('cuts a 900-character issue to at most 500', () => {
    const text = designIssueText('x'.repeat(900))
    expect(text.length).toBe(500)
    expect(text.endsWith('…')).toBe(true)
  })
})
```

The file opts into the `node` environment: the checks run esbuild, which refuses to load under jsdom.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-design.test.ts`
Expected: FAIL. The designer still parses a scene (`parseGraphicScene` is gone after Task 4, so every real-model test throws `TypeError: ... is not a function`), the mock path calls the deleted `mockGraphicScene`, `result.code` is undefined, and `slotIntent` reads a chart through `graphicIntentOf` (its description, no refs).

- [ ] **Step 3: Put the designer on code**

Replace the whole of `apps/web/lib/graphic-design-core.ts` with:

```ts
import {
  getProject,
  latestScriptParagraphSources,
  listLogos,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import type { Database } from '@boom-busters/db'
import {
  buildGraphicRequest,
  estimatedWords,
  parseGraphicCode,
  wordsInSlot,
  type GraphicDesignInput,
  type LLMTaskRequest,
  type ScriptClaim,
} from '@boom-busters/providers'
import { BudgetExceededError, graphicIntentOf, ValidationError } from '@boom-busters/schemas'
import type { ChartBrief, DesignableBrief, GraphicCode, LogoIndex } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { callForAnswer, type AnswerComplete } from '@/lib/answer'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import { timedParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * The graphics designer's own logic (decisions 289 and 295), with no
 * database connection of its own, no ledgered model call and no
 * `server-only` import: the model call and the connection are parameters.
 * That keeps it testable against a stubbed call, with the attempts, the
 * cut-off doubling, the deadline and the checks in one place.
 * `graphic-design.ts` binds it to the app's `db` and `callLlm`.
 *
 * Since decision 295 the designer writes the graphic as code: one React
 * component, which `graphicCodeIssue` scans, compiles, dry-runs and checks
 * against the cited claims before it is stored as `code` on the brief. A
 * chart is designed the same way, around its brief's own series.
 */

export interface GraphicDesignContext {
  projectId: string
  caseTitle: string
  claims: readonly ScriptClaim[]
  logos: readonly LogoIndex[]
  paragraphs: readonly TimedParagraph[]
  chapterTitle: string
}

export interface GraphicSlotTiming {
  chapterId: string
  startMs: number
  durationMs: number
}

export type GraphicDesignResult = { ok: true; code: GraphicCode } | { ok: false; issue: string }

/**
 * Whatever completes a request: the app's ledgered `callLlm`, or a test's
 * stub. `purpose` labels a retry in the ledger (decision 292).
 */
export type GraphicCompleteFn = (
  request: LLMTaskRequest,
  options: { signal?: AbortSignal; purpose?: string },
) => Promise<{ text: string; truncated?: boolean }>

/** The paragraphs a slot overlaps, and its words on the slot clock, as the prompt and the dry run read them. */
export function slotNarration(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
) {
  const end = slot.startMs + slot.durationMs
  const overlapping = context.paragraphs.filter(
    (p) =>
      p.chapterId === slot.chapterId && p.startMs < end && p.startMs + p.durationMs > slot.startMs,
  )
  const timed = wordsInSlot(
    overlapping.flatMap((p) => p.words),
    slot.startMs,
    slot.durationMs,
  )
  return {
    paragraphText: overlapping.map((p) => p.text).join('\n\n') || slot.brief.coversText,
    words: timed.length > 0 ? timed : estimatedWords(slot.brief.coversText, slot.durationMs),
    wordsEstimated: timed.length === 0,
  }
}

/** The slot's words as the code reads them, `props.words` (decision 295). */
export function slotWords(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
): { text: string; atMs: number }[] {
  return slotNarration(context, slot).words.map((word) => ({
    text: word.text,
    atMs: word.offsetMs,
  }))
}

/** What a chart's code reads as `props.data` (decision 295): its series, takeaway and annotations. */
export function chartData(brief: ChartBrief): NonNullable<GraphicDesignInput['data']> {
  return {
    series: brief.series,
    takeaway: brief.takeaway,
    ...(brief.annotations !== undefined ? { annotations: brief.annotations } : {}),
  }
}

/**
 * A stored design as a redesign shows it to the designer (ruling 9): its
 * source and title only. Its facts are not passed; the designer cites claims
 * afresh from the numbered list, and the checks hold it to them.
 */
function currentDesign(code: GraphicCode): NonNullable<GraphicDesignInput['current']> {
  return { source: code.source, title: code.title }
}

/**
 * The wall time one graphic's design may take, from its start (final review
 * I3). The route's `maxDuration` is 300 s and the worst ladder is two Opus
 * calls (decision 292); a killed invocation is retried and buys every call
 * again, so the ladder stops itself with room left to write the outcome.
 */
export const GRAPHIC_DESIGN_DEADLINE_MS = 240_000
/** Less than this left: a call would only be aborted, so none is started. */
const MIN_CALL_MS = 15_000

const CUT_OFF_ISSUE = "the designer's answer was cut off at its length limit"
const TOO_LONG_ISSUE = 'the designer took too long; press Redesign graphic to try again'

/** The design is over with this issue; no further call can help. */
class DesignEnded extends Error {
  constructor(readonly issue: string) {
    super(issue)
  }
}

/**
 * The intent a slot is designed from, and its claim numbers into the prompt's
 * claim list. A chart's intent is its takeaway, resting on the claims its
 * series come from (decision 295).
 */
export function slotIntent(
  context: GraphicDesignContext,
  brief: DesignableBrief,
): { intent: string; intentRefs: number[] } {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, claimIds: intentClaimIds } =
    brief.type === 'chart'
      ? { intent: brief.takeaway, claimIds: brief.dataRefs }
      : graphicIntentOf(brief)
  const intentRefs = intentClaimIds.map((id) => claimIds.indexOf(id) + 1).filter((n) => n > 0)
  return { intent, intentRefs }
}

/**
 * The whole real-model path: the attempts, the cut-off doubling, the
 * deadline and the checks. `complete` is injected, so the tests drive every
 * branch without a model and the app hands it the ledgered `callLlm`; it is
 * handed the deadline's abort signal.
 */
export async function designGraphicWith(
  complete: GraphicCompleteFn,
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  const { brief } = slot
  const { intent, intentRefs } = slotIntent(context, brief)
  const narration = slotNarration(context, slot)
  // The same words the prompt lists, as the dry run hands them to the code.
  const words = narration.words.map((word) => ({ text: word.text, atMs: word.offsetMs }))

  const base: GraphicDesignInput = {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText: brief.coversText,
    ...narration,
    durationMs: slot.durationMs,
    intent,
    intentRefs,
    ...(brief.type === 'chart' ? { data: chartData(brief) } : {}),
    // A scene from before decision 295 is not shown: the designer writes code
    // from the intent, and the scene stays on the brief untouched.
    ...(options.redesign && brief.code ? { current: currentDesign(brief.code) } : {}),
    ...(options.guidance ? { guidance: options.guidance } : {}),
  }

  const deadline = Date.now() + GRAPHIC_DESIGN_DEADLINE_MS
  const call: AnswerComplete = async (request, label) => {
    const remaining = deadline - Date.now()
    if (remaining < MIN_CALL_MS) throw new DesignEnded(TOO_LONG_ISSUE)
    return complete(request, {
      signal: AbortSignal.timeout(remaining),
      ...(label === 'answer' ? {} : { purpose: label }),
    })
  }

  try {
    // At most two calls (decision 292): the checks refuse a design inside the
    // parse (scan, compile, dry run, facts; decision 295), so a refusal is
    // retried once with its reason and a cut-off once at double the budget,
    // then the design stops. A trimmed title is reported through `note`
    // (decision 293).
    const answer = await callForAnswer({
      request: buildGraphicRequest(base),
      parse: (text, note) => {
        const checked = graphicCodeIssue(parseGraphicCode(text, note), context, {
          brief,
          durationMs: slot.durationMs,
          words,
        })
        if ('issue' in checked) {
          throw new ValidationError(checked.issue, { field: 'graphic code' })
        }
        return checked.code
      },
      complete: call,
      // The designer's request carries the reason before the producer's
      // steer, which stays the last thing the model reads.
      retryWithReason: (reason) => buildGraphicRequest({ ...base, rejection: reason }),
      cutOffIssue: CUT_OFF_ISSUE,
    })
    return answer.ok ? { ok: true, code: answer.value } : { ok: false, issue: answer.issue }
  } catch (error) {
    if (error instanceof DesignEnded) return { ok: false, issue: error.issue }
    // A budget stop parks the run whenever it comes. Anything else once the
    // deadline has passed (the abort itself, or a failure that raced it) is
    // the clock's doing: a retried step would only buy the same calls again.
    if (error instanceof BudgetExceededError) throw error
    if (Date.now() >= deadline) return { ok: false, issue: TOO_LONG_ISSUE }
    // Inside the deadline any other failure (provider, a rejected key) goes through.
    throw error
  }
}

/**
 * What a side job (Redesign, retype) needs to design one graphic or chart,
 * read from the connection it is handed, so this module imports no
 * `server-only` database of its own.
 */
export async function loadGraphicContextFrom(
  database: Database,
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  const project = await getProject(database, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const [sources, takes, claims, logos] = await Promise.all([
    latestScriptParagraphSources(database, projectId),
    listVoiceTakes(database, projectId),
    scriptableClaims(database, projectId),
    listLogos(database),
  ])
  const chapter = sources.chapters.find((c) => c.id === chapterId)
  return {
    projectId,
    caseTitle: project.title,
    claims: claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      sourceUrl: claim.sourceUrl,
      confidence: claim.confidence,
      sourceType: claim.sourceType,
    })),
    // Each mark's recorded size, null when none was (Task 1, ruling 25): the
    // dry run hands the code only the marks the render can size.
    logos: logos.map((row) => ({
      id: row.id,
      title: row.title ?? '',
      width: row.width,
      height: row.height,
    })),
    paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
    chapterTitle: chapter?.title ?? '',
  }
}
```

`sceneIssue` is gone with its imports (`parseGraphicScene`, `sceneTimingIssue`, `resolvePlannedScene`, `toPlannedScene`): nothing designs a scene after this task.

- [ ] **Step 4: Bind the app path, the mock and `withDesign` to code**

Replace the whole of `apps/web/lib/graphic-design.ts` with:

```ts
import { mockGraphicCode, mockProvidersEnabled } from '@boom-busters/providers'
import type { DesignableBrief } from '@boom-busters/schemas'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { graphicCodeIssue } from '@/lib/graphic-code/check'
import {
  chartData,
  designGraphicWith,
  loadGraphicContextFrom,
  slotIntent,
  slotWords,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

/**
 * The graphics designer, as the app calls it (decisions 289 and 295): the
 * pipeline's per-design step, Redesign graphic, Redesign chart and a retype
 * to graphic or chart all come here, so a design is made one way whichever
 * button asked.
 *
 * The attempts, deadline and checks live in `graphic-design-core.ts`, which
 * takes the model call and the connection as parameters: it imports nothing
 * `server-only`, so its tests run it against a stubbed call. This file binds
 * that path to the app's ledgered `callLlm` and its database.
 */

export {
  designGraphicWith,
  GRAPHIC_DESIGN_DEADLINE_MS,
  type GraphicCompleteFn,
  type GraphicDesignContext,
  type GraphicDesignResult,
  type GraphicSlotTiming,
} from '@/lib/graphic-design-core'

export async function designGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: DesignableBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  if (mockProvidersEnabled()) {
    // The fixture component (decision 295), through the same scan, compile,
    // dry run and facts as a real answer, so the runners, the retyper and the
    // rebriefer exercise every check without spending. Its figure is the
    // cited claim's own digits, or none (ruling 11), so it passes on any seed.
    const { brief } = slot
    const { intentRefs } = slotIntent(context, brief)
    const planned = mockGraphicCode({
      claimTexts: context.claims.map((claim) => claim.text),
      intentRefs: intentRefs.length > 0 ? intentRefs : [1],
      ...(options.guidance ? { guidance: options.guidance } : {}),
      durationMs: slot.durationMs,
      ...(brief.type === 'chart' ? { data: chartData(brief) } : {}),
    })
    const checked = graphicCodeIssue(planned, context, {
      brief,
      durationMs: slot.durationMs,
      words: slotWords(context, slot),
    })
    return 'code' in checked
      ? { ok: true, code: checked.code }
      : { ok: false, issue: checked.issue }
  }

  return designGraphicWith(
    (request, callOptions) => callLlm(request, { projectId: context.projectId, ...callOptions }),
    context,
    slot,
    options,
  )
}

const DESIGN_ISSUE_MAX = 500

/**
 * An issue as a stored brief can hold it (`designIssue` is at most 500
 * characters; final review I1). A parse failure quoting five schema issues
 * runs longer, and a brief stored over the cap fails every later parse: the
 * card breaks and Redesign disappears. Cut at the last word boundary at or
 * before character 499 and mark the cut.
 */
export function designIssueText(issue: string): string {
  const text = issue.trim()
  if (text.length <= DESIGN_ISSUE_MAX) return text
  // The last whitespace among the first 500 characters: a cut there keeps
  // at most 499, which leaves room for the mark.
  const boundary = text.slice(0, DESIGN_ISSUE_MAX).search(/\s\S*$/)
  const cut = boundary > 0 ? text.slice(0, boundary).trimEnd() : text.slice(0, DESIGN_ISSUE_MAX - 1)
  return `${cut}…`
}

/**
 * A brief with the design's outcome on it (decision 295; ruling 8): a
 * success sets `code` and clears any old `designIssue`; a failure sets
 * `designIssue` and leaves a stored `code` where it is, so a refused
 * redesign keeps the graphic the card already plays.
 */
export function withDesign<B extends DesignableBrief>(brief: B, result: GraphicDesignResult): B {
  if (!result.ok) return { ...brief, designIssue: designIssueText(result.issue) }
  const { designIssue: _old, ...rest } = brief
  // Spreading the rest loses the generic; it is still a B, now with its code.
  return { ...rest, code: result.code } as unknown as B
}

/** What a side job (Redesign, retype) needs to design one graphic or chart, read fresh. */
export async function loadGraphicContext(
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  return loadGraphicContextFrom(db, projectId, chapterId)
}
```

Task 8 ran before this task (the header's execution order) and deleted the live harness, so these two files carry no comment that names it, and `loadGraphicContext` loses the `database` parameter only the harness's design called for (no caller passes it).

- [ ] **Step 5: Run the designer's test and watch it pass**

Run: `pnpm --filter @boom-busters/web vitest run lib/graphic-design.test.ts`
Expected: PASS, every test.

- [ ] **Step 6: Rewrite the plan step's test for charts and code**

Replace the whole of `apps/web/inngest/lib/graphic-steps.test.ts` with:

```ts
// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BudgetExceededError } from '@boom-busters/schemas'
import type * as GraphicDesign from '@/lib/graphic-design'

const designGraphic = vi.fn()
vi.mock('@/lib/graphic-design', async (importOriginal) => ({
  ...(await importOriginal<typeof GraphicDesign>()),
  designGraphic: (...args: unknown[]) => designGraphic(...args),
}))

import { designPlannedGraphics } from './graphic-steps'

const graphic = (coversText: string) => ({
  chapterId: 'c1',
  index: 0,
  type: 'graphic',
  startMs: 0,
  durationMs: 6000,
  brief: {
    type: 'graphic',
    coversText,
    description: 'd',
    motion: { kind: 'static' },
    transition: 'cut',
    intent: 'i',
    intentClaimIds: [],
  },
})
const still = {
  chapterId: 'c1',
  index: 1,
  type: 'still',
  startMs: 6000,
  durationMs: 3000,
  brief: { type: 'still' },
}
/** A chart as the shot list plans it, or (with `code`) one designed before. */
const chart = (code?: unknown) => ({
  chapterId: 'c1',
  index: 2,
  type: 'chart',
  startMs: 9000,
  durationMs: 6000,
  brief: {
    type: 'chart',
    coversText: 'Acme raised four billion.',
    description: 'The raise, drawn.',
    motion: { kind: 'static' },
    transition: 'cut',
    chartKind: 'bar',
    series: [
      {
        label: 'Raised',
        unit: 'USD bn',
        points: [
          { x: '2023', y: 1 },
          { x: '2024', y: 4 },
        ],
      },
    ],
    dataRefs: ['01J00000000000000000000001'],
    takeaway: 'Four billion in a year.',
    reveal: 'draw-on',
    ...(code ? { code } : {}),
  },
})
const CODE = {
  version: 1,
  source: 'function Graphic() { return null }',
  compiled: 'function Graphic() {\n  return null;\n}\n',
  title: 'Designed before',
  facts: [],
  words: [],
  durationMs: 6000,
}
const CONTEXT = {
  projectId: 'p',
  caseTitle: 'c',
  claims: [],
  logos: [],
  paragraphs: [],
}

beforeEach(() => {
  designGraphic.mockReset()
})

describe('designPlannedGraphics (decisions 289, 295)', () => {
  it('runs one named step per graphic and leaves other rows alone', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, code: CODE })
      .mockResolvedValueOnce({ ok: false, issue: 'no digits' })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [graphic('a'), still, graphic('b')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
      },
    )
    expect(ids).toEqual(['graphic-0-0', 'graphic-0-1'])
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ code: CODE })
    expect(result.rows[1]).toBe(still)
    expect(result.rows[2]!.brief).toMatchObject({ designIssue: 'no digits' })
  })

  it('designs a chart without code in a step of its own, and counts a refused design (decision 295)', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, code: CODE })
      .mockResolvedValueOnce({ ok: false, issue: 'nothing changes between 1.0 s and 8.0 s' })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      {
        prefix: 'graphic-0',
        rows: [chart(), graphic('a')] as never,
        context: CONTEXT,
        chapterTitle: 'One',
      },
    )
    // A chart takes ids of its own; graphics keep the numbering they had.
    expect(ids).toEqual(['graphic-0-chart-0', 'graphic-0-0'])
    expect(designGraphic.mock.calls[0]![1]).toMatchObject({
      chapterId: 'c1',
      startMs: 9000,
      durationMs: 6000,
      brief: { type: 'chart', takeaway: 'Four billion in a year.' },
    })
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ type: 'chart', code: CODE })
    expect(result.rows[1]!.brief).toMatchObject({
      type: 'graphic',
      designIssue: 'nothing changes between 1.0 s and 8.0 s',
    })
  })

  it('leaves a chart that already carries code alone (decision 295)', async () => {
    const designed = chart(CODE)
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [designed] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(designGraphic).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, undesigned: 0 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]).toBe(designed)
  })

  it('returns a gate when the budget runs out', async () => {
    designGraphic.mockRejectedValueOnce(
      new BudgetExceededError({
        provider: 'anthropic',
        operation: 'llm.graphics',
        budgetUsd: 5,
        monthSpendUsd: 5,
        estimateUsd: 0.05,
      }),
    )
    const result = await designPlannedGraphics(async (_id, fn) => fn(), {
      prefix: 'graphic-0',
      rows: [graphic('a')] as never,
      context: CONTEXT,
      chapterTitle: 'One',
    })
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 7: Run it and watch it fail**

Run: `pnpm --filter @boom-busters/web vitest run inngest/lib/graphic-steps.test.ts`
Expected: FAIL. The first test passes; the chart test fails because the step ids are `['graphic-0-0']` (the chart row is passed over) and the chart has no `code`; the third passes by accident (charts are never designed yet).

- [ ] **Step 8: Design chart rows in the plan step**

Replace the whole of `apps/web/inngest/lib/graphic-steps.ts` with:

```ts
import type { NewShotSlot } from '@boom-busters/db'
import { BudgetExceededError, ChartBriefSchema, GraphicBriefSchema } from '@boom-busters/schemas'
import type { DesignableBrief } from '@boom-busters/schemas'
import { designGraphic, withDesign, type GraphicDesignContext } from '@/lib/graphic-design'
import { budgetGateData } from './gates'

/** `step.run`, as the helper needs it; the runners pass `(id, fn) => step.run(id, fn)`. */
export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>

/**
 * The brief the designer writes for (decision 295): a graphic's or a chart's,
 * as its own schema reads it. Null for any other row, or one that no longer
 * parses.
 */
export function designableBrief(row: { type: string; brief: unknown }): DesignableBrief | null {
  if (row.type === 'graphic') {
    const parsed = GraphicBriefSchema.safeParse(row.brief)
    return parsed.success ? parsed.data : null
  }
  if (row.type === 'chart') {
    const parsed = ChartBriefSchema.safeParse(row.brief)
    return parsed.success ? parsed.data : null
  }
  return null
}

/**
 * Each planned graphic and chart designed in its own step (decisions 289,
 * 295), so an Inngest retry repeats one design and never the chapter. A
 * design the designer could not write keeps its brief and says why; it is
 * never dropped and never stops the plan. Running out of budget stops it.
 *
 * Graphics keep the step ids they had before charts were designed
 * (`<prefix>-<n>`, counting graphics only) and charts take their own
 * (`<prefix>-chart-<n>`), so a run planning across the deploy replays every
 * graphic step it already holds against the row it belongs to. A result
 * replayed from before the deploy carries a scene, not code, so the count of
 * undesigned rows reads `designIssue`, which both kinds of result set alike.
 */
export async function designPlannedGraphics(
  run: StepRunner,
  input: {
    prefix: string
    rows: readonly NewShotSlot[]
    context: Omit<GraphicDesignContext, 'chapterTitle'>
    chapterTitle: string
  },
): Promise<
  | { ok: true; rows: NewShotSlot[]; undesigned: number }
  | { ok: false; gate: Record<string, unknown> }
> {
  const rows: NewShotSlot[] = []
  let undesigned = 0
  let graphics = 0
  let charts = 0
  for (const row of input.rows) {
    const brief = designableBrief(row)
    if (!brief || brief.code) {
      rows.push(row)
      continue
    }
    const id =
      brief.type === 'chart' ? `${input.prefix}-chart-${charts}` : `${input.prefix}-${graphics}`
    if (brief.type === 'chart') charts += 1
    else graphics += 1
    const outcome = await run(id, async () => {
      try {
        const result = await designGraphic(
          { ...input.context, chapterTitle: input.chapterTitle },
          {
            chapterId: row.chapterId,
            startMs: row.startMs,
            durationMs: row.durationMs,
            brief,
          },
        )
        return { ok: true as const, brief: withDesign(brief, result) }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }
    })
    if (!outcome.ok) return { ok: false, gate: outcome.gate }
    if (outcome.brief.designIssue !== undefined) undesigned += 1
    rows.push({ ...row, brief: outcome.brief })
  }
  return { ok: true, rows, undesigned }
}
```

- [ ] **Step 9: Run it and watch it pass**

Run: `pnpm --filter @boom-busters/web vitest run inngest/lib/graphic-steps.test.ts`
Expected: PASS, four tests.

- [ ] **Step 10: Point the runner's graphic tests at code**

In `apps/web/inngest/functions/visuals-runner.test.ts`, add directly below `const describeDb = requireTestDatabase() ? describe : describe.skip`:

```ts
/**
 * A text-only design (decision 295): it shows no digit, so it passes whatever
 * the fixture's claims say, and a slow drift keeps every stretch of it moving.
 */
const TEXT_DESIGN = {
  source: `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { durationInFrames } = Remotion.useVideoConfig()
  const opacity = Remotion.interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' })
  const spacing = Remotion.interpolate(frame, [0, durationInFrames], [0, 0.08])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: props.brand.colors.background }}>
      <div style={{ opacity, letterSpacing: spacing + 'em', color: props.brand.colors.textPrimary, fontFamily: props.brand.fonts.heading, fontSize: 120 }}>
        The money is gone
      </div>
    </div>
  )
}`,
  title: 'The money is gone',
  facts: [],
}
```

Replace the test `'designs each planned graphic before the plan is saved (decision 289)'` with:

```ts
  it('designs each planned graphic before the plan is saved (decisions 289, 295)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    const planned = {
      paragraphIndex: 0,
      seconds: 6,
      brief: {
        type: 'graphic',
        coversText: 'By June, the auditors could not find the money.',
        description: 'The missing sum, large.',
        shotSize: 'graphic',
        motion: { kind: 'static' },
        transition: 'cut',
        intent: 'The money is simply gone.',
        intentRefs: [],
      },
    }
    callLlm.mockReset()
    callLlm.mockImplementation((request: { task: string }) => {
      if (request.task === 'direction') return Promise.resolve({ text: JSON.stringify(book) })
      if (request.task === 'graphics') return Promise.resolve({ text: JSON.stringify(TEXT_DESIGN) })
      return Promise.resolve({ text: JSON.stringify({ slots: [planned] }) })
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const stored = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find((s) => s.type === 'graphic')
    expect(stored?.brief).toMatchObject({
      intent: 'The money is simply gone.',
      code: { version: 1, source: TEXT_DESIGN.source, title: 'The money is gone' },
    })
    const code = (stored?.brief as { code?: { compiled: string } }).code
    expect(code?.compiled).not.toContain('<div')
  })
```

Replace the test `'stores an undesigned graphic with its reason (decision 289)'` with:

```ts
  it('stores an undesigned graphic with its reason (decision 289)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    callLlm.mockReset()
    callLlm.mockImplementation((request: { task: string }) => {
      if (request.task === 'direction') return Promise.resolve({ text: JSON.stringify(book) })
      // Never a usable design: both attempts are refused.
      if (request.task === 'graphics')
        return Promise.resolve({ text: '{"scene": {"elements": []}}' })
      return Promise.resolve({
        text: JSON.stringify({
          slots: [
            {
              paragraphIndex: 0,
              seconds: 6,
              brief: {
                type: 'graphic',
                coversText: 'By June, the auditors could not find the money.',
                description: 'd',
                motion: { kind: 'static' },
                transition: 'cut',
                intent: 'The money is gone.',
              },
            },
          ],
        }),
      })
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const stored = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find((s) => s.type === 'graphic')
    expect(stored?.brief).toMatchObject({ designIssue: expect.stringMatching(/\S/) })
    expect((stored?.brief as { code?: unknown }).code).toBeUndefined()
  })
```

- [ ] **Step 11: Run both runners' suites and watch them pass**

The runners themselves are not edited (ruling 3): their `setup` already hands `designPlannedGraphics` the claims, logos and paragraphs the designer reads, the dry run uses the house brand, and Steps 3 to 8 moved the designer they call onto code. Step 10's tests therefore pass as soon as they are written. `visuals-replanner.test.ts` needs no change: it asserts no design; it runs here to show the shared plan step still works there.

Run, one after the other (Docker Desktop running, Bash `timeout` 600000 each):
`pnpm --filter @boom-busters/web vitest run inngest/functions/visuals-runner.test.ts`
`pnpm --filter @boom-busters/web vitest run inngest/functions/visuals-replanner.test.ts`
Expected: PASS, both, with the tests run rather than skipped. A failing `'designs each planned graphic before the plan is saved (decisions 289, 295)'` means a check refused `TEXT_DESIGN`: read the stored `designIssue`, which names the check, and fix the design or the check that is wrong; do not add a field to the runners' context.

- [ ] **Step 12: Point the retyper's and rebriefer's graphic tests at code**

The design steps of the retyper and the rebriefer are unchanged for graphics; only what lands on the brief is now `code`. In `apps/web/inngest/functions/slot-retyper.test.ts`:

Replace the test `'designs a slot retyped to a graphic (decision 289)'` with:

```ts
  it('designs a slot retyped to a graphic (decisions 289, 295)', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'graphic' })

    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('graphic')
    expect(slot?.brief).toMatchObject({
      type: 'graphic',
      intent: '[mock] The figure, large, with the mark beside it.',
      code: expect.objectContaining({ title: expect.stringMatching(/^\[mock\]/) }),
    })
    expect(slot?.retype).toBeNull()
  })
```

In `'holds the drafting marker while the graphic is designed, and clears it after (final review I4)'`, replace `expect(slot?.brief).toHaveProperty('scene')` with `expect(slot?.brief).toHaveProperty('code')`.

In `'keeps the reason on the brief when the designer refuses a retyped graphic'` and in `'says why on the brief when a retyped graphic runs out of budget'`, replace `expect(slot?.brief).not.toHaveProperty('scene')` with `expect(slot?.brief).not.toHaveProperty('code')`.

In `apps/web/inngest/functions/slot-rebriefer.test.ts`, replace the test `'redesigns a graphic from its intent with the steer (decision 289)'` with:

```ts
  it('redesigns a graphic from its intent with the steer (decisions 289, 295)', async () => {
    const graphicId = await seedSlot(designedGraphic)
    await setSlotRetype(db, graphicId, { state: 'rebriefing' })
    const { result } = await engine.execute({ events: rebriefEvent(graphicId, 'bigger') })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const slot = await getShotSlot(db, graphicId)
    const brief = slot?.brief as { intent: string; code?: { title: string } }
    // A redesign keeps the intent; the mock designer titles a steered design with the steer.
    expect(brief.intent).toBe('The money is simply gone.')
    expect(brief.code?.title).toMatch(/^\[mock\]/)
    expect(brief.code?.title).toContain('bigger')
    expect(slot?.retype).toBeNull()
  })
```

- [ ] **Step 13: Run both side jobs' suites and watch them pass**

Run, one after the other (Docker Desktop running, Bash `timeout` 600000 each):
`pnpm --filter @boom-busters/web vitest run inngest/functions/slot-retyper.test.ts`
`pnpm --filter @boom-busters/web vitest run inngest/functions/slot-rebriefer.test.ts`
Expected: PASS, both. The chart tests still pass on the old chart paths, which the next steps change.

- [ ] **Step 14: Confirm nothing designs a scene any more**

Run: `git grep -n -e mockGraphicScene -e parseGraphicScene -e MOCK_STAGED_MIN_MS -e sceneIssue -- apps packages e2e infra`
Expected: no output. Task 4 deleted the three providers exports and their tests (its Files block); this task removed their last importers and `sceneIssue`.

Run: `git grep -n -i -e "live harness" -e "live-graphic" -e "harness's" -- apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.ts apps/web/lib/graphic-design.test.ts`
Expected: no output. Task 8 deleted the harness before this task, and these three files were rewritten whole above without it. (Other files that say "live harness" mean the `live:set` and `live:plan` harnesses, which stay.)

- [ ] **Step 15: Typecheck, lint, format, commit**

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: no errors. Task 8 runs before this task (the execution order in the header), so `apps/web/scripts/live-graphic-test.ts`, which read `result.scene`, is already gone; an error naming it means Task 8 was skipped.

Run: `pnpm lint`
Expected: no warnings, no errors.

Run: `pnpm exec prettier --write apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.ts apps/web/lib/graphic-design.test.ts apps/web/inngest/lib/graphic-steps.ts apps/web/inngest/lib/graphic-steps.test.ts apps/web/inngest/functions/visuals-runner.test.ts apps/web/inngest/functions/slot-retyper.test.ts apps/web/inngest/functions/slot-rebriefer.test.ts`

```bash
git add apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.ts apps/web/lib/graphic-design.test.ts apps/web/inngest/lib/graphic-steps.ts apps/web/inngest/lib/graphic-steps.test.ts apps/web/inngest/functions/visuals-runner.test.ts apps/web/inngest/functions/slot-retyper.test.ts apps/web/inngest/functions/slot-rebriefer.test.ts
git commit -m "feat(graphics): the designer writes code, for planned graphics and charts (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 16: Write the retyper's chart tests**

In `apps/web/inngest/functions/slot-retyper.test.ts`, replace the test `'drafts a chart citing the project’s real claims, and plan phase stays unfetched'` with:

```ts
  it('drafts a chart citing the project’s real claims, designs it, and plan phase stays unfetched (decision 295)', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'chart' })

    const slot = await getShotSlot(db, slotId)
    const brief = slot?.brief as {
      type: string
      dataRefs?: string[]
      code?: { title: string; compiled: string }
    }
    expect(brief.type).toBe('chart')
    // The mock cites the first claim — a ULID that exists on this project,
    // because `resolvePlannedBrief` would refuse anything else.
    expect(brief.dataRefs).toHaveLength(1)
    // The designer wrote the chart around the drafted series, through every check.
    expect(brief.code?.title).toMatch(/^\[mock\]/)
    expect(typeof brief.code?.compiled).toBe('string')
    // Plan phase: the draft LANDS, nothing is fetched for it.
    expect(slot?.status).toBe('unresolved')
    expect(slot?.candidates).toEqual([])
    expect(slot?.retype).toBeNull()
  })
```

Add these two tests directly after `'says why once on the slot card when a parked plan runs out of budget designing a retyped graphic (decisions 293, 294)'`, inside `describeDb('slot-retyper (mock mode)', ...)`:

```ts
  it('holds the drafting marker while a retyped chart is designed, and clears it after (decision 295)', async () => {
    const design = await import('@/lib/graphic-design')
    const real = design.designGraphic
    let during: unknown = 'not read'
    const spy = vi.spyOn(design, 'designGraphic').mockImplementationOnce(async (...args) => {
      during = (await getShotSlot(db, slotId))?.retype
      return real(...args)
    })
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })
      expect(result).toMatchObject({ outcome: 'retyped', targetType: 'chart' })
      // The format picker and Redesign stay locked while the call is in flight.
      expect(during).toEqual({ state: 'drafting', target: 'chart' })
      // The designer is handed the chart, series and all.
      expect(spy.mock.calls[0]![1]).toMatchObject({ brief: { type: 'chart' } })
      const slot = await getShotSlot(db, slotId)
      expect(slot?.retype).toBeNull()
      expect(slot?.brief).toHaveProperty('code')
    } finally {
      spy.mockRestore()
    }
  })

  it('keeps the reason on the chart when the designer refuses a retyped chart (decision 295)', async () => {
    const design = await import('@/lib/graphic-design')
    const refuse = vi
      .spyOn(design, 'designGraphic')
      .mockResolvedValueOnce({ ok: false, issue: 'nothing changes between 4.2 s and 11.0 s' })
    try {
      const { result } = await engine.execute({ events: retypeEvent(slotId, 'chart') })
      expect(result).toMatchObject({ outcome: 'retyped', targetType: 'chart' })

      const slot = await getShotSlot(db, slotId)
      expect(slot?.type).toBe('chart')
      // The chart keeps its drafted series and says why it has no design.
      expect(slot?.brief).toMatchObject({
        type: 'chart',
        designIssue: 'nothing changes between 4.2 s and 11.0 s',
      })
      expect((slot?.brief as { dataRefs: string[] }).dataRefs).toHaveLength(1)
      expect(slot?.brief).not.toHaveProperty('code')
      expect(slot?.retype).toBeNull()
    } finally {
      refuse.mockRestore()
    }
  })
```

- [ ] **Step 17: Run it and watch the chart tests fail**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run inngest/functions/slot-retyper.test.ts`
Expected: FAIL on the three chart tests: a retyped chart lands without `code` (no design step runs for it), `during` stays `'not read'`, and the refused design never reaches the brief. The rest pass.

- [ ] **Step 18: Design a chart after its retype lands**

In `apps/web/inngest/functions/slot-retyper.ts`:

Add this import directly after `import { budgetGateData, markSideJobFailed, slotSubject, type GateContext } from '../lib/gates'`:

```ts
import { designableBrief } from '../lib/graphic-steps'
```

In `onFailure`, replace:

```ts
        // A slot retyped to a graphic holds an intent and no design until the
        // designer answers; a dead run must not leave it reading "being
        // designed" forever (decision 289).
        await (async () => {
          const slot = await getShotSlot(db, slotId)
          const brief = GraphicBriefSchema.safeParse(slot?.brief)
          if (!brief.success || brief.data.scene || brief.data.designIssue) return
```

with:

```ts
        // A slot retyped to a graphic holds an intent and no design until the
        // designer answers; a dead run must not leave it reading "being
        // designed" forever (decision 289). A chart without a design still
        // plays its own reveal (decision 295), so it is left as it landed.
        await (async () => {
          const slot = await getShotSlot(db, slotId)
          const brief = GraphicBriefSchema.safeParse(slot?.brief)
          if (!brief.success || brief.data.scene || brief.data.code || brief.data.designIssue) {
            return
          }
```

In the `convert-brief` step, replace:

```ts
      // A graphic is not done until it is designed, in the next step: keep
      // the card saying "drafting" until then, so the format picker and
      // Redesign stay locked while the design call is in flight (final
      // review I4). The design step clears it on every outcome.
      if (targetType === 'graphic') {
        await setSlotRetype(db, slotId, { state: 'drafting', target: 'graphic' })
      }
```

with:

```ts
      // A graphic or a chart is not done until it is designed, in the next
      // step (decisions 289, 295): keep the card saying "drafting" until
      // then, so the format picker and Redesign stay locked while the design
      // call is in flight (final review I4). The design step clears it on
      // every outcome.
      if (targetType === 'graphic' || targetType === 'chart') {
        await setSlotRetype(db, slotId, { state: 'drafting', target: targetType })
      }
```

Replace the whole design block, from `// A slot retyped to a graphic arrives with an intent and no design` down to the closing `}` of `if (targetType === 'graphic') {` (the line before `// Board phase: the owner is looking at candidate strips`), with:

```ts
    // A slot retyped to a graphic arrives with an intent and no design
    // (decision 289), and one retyped to a chart with its drafted series and
    // no design (decision 295); the designer writes either in a step of its
    // own.
    if (targetType === 'graphic' || targetType === 'chart') {
      const designed = await step.run('design-graphic', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-retype`)
        const brief = designableBrief(slot)
        if (!brief || brief.type !== targetType) {
          throw new NonRetriableError(`Shot slot ${slotId} is no longer a ${targetType}`)
        }
        /**
         * The design lands only on a slot that is still the type this retype
         * made it (final review I4). A second retype cancels this run, but a
         * step already in flight still finishes; written blind, its brief
         * would sit on a slot of another type. Then the drafting marker goes,
         * but only this run's: a newer retype's marker is that run's to clear.
         */
        const land = async (designed: Parameters<typeof withDesign>[1]) => {
          const latest = await getShotSlot(db, slotId)
          if (latest?.type !== targetType) return
          await updateSlotBrief(db, slotId, withDesign(brief, designed))
          const marker = latest.retype
          if (marker?.['state'] === 'drafting' && marker['target'] === targetType) {
            await setSlotRetype(db, slotId, null)
          }
        }
        try {
          const context = await loadGraphicContext(projectId, slot.chapterId)
          const result = await designGraphic(context, {
            chapterId: slot.chapterId,
            startMs: slot.startMs,
            durationMs: slot.durationMs,
            brief,
          })
          await land(result)
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            const gate = budgetGateData(error)
            // The slot has no design; say why on the brief, or a graphic's
            // card reads "being designed" for good and a chart's says nothing.
            await land({ ok: false, issue: String(gate['message'] ?? 'Over budget') })
            return { ok: false as const, gate }
          }
          throw error
        }
      })
      if (!designed.ok) {
        // The brief's design issue is the card's "Not designed" line, so no
        // notice repeats it (decision 294).
        await step.run('design-over-budget', () =>
          markSideJobFailed(
            ctx,
            targetType === 'chart'
              ? 'The chart could not be designed'
              : 'The graphic could not be designed',
            designed.gate,
            null,
          ),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }
```

The step keeps its id `design-graphic`, so a graphic retype parked across the deploy replays the step it already ran.

- [ ] **Step 19: Run it and watch it pass**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run inngest/functions/slot-retyper.test.ts`
Expected: PASS, every test in both `describeDb` blocks.

- [ ] **Step 20: Typecheck, format, commit**

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm exec prettier --write apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-retyper.test.ts`

```bash
git add apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-retyper.test.ts
git commit -m "feat(graphics): a slot retyped to a chart is designed once it lands (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 21: Write the rebriefer's chart tests**

In `apps/web/inngest/functions/slot-rebriefer.test.ts`:

In the `@boom-busters/db` import, remove `claims,`: the only test that read it (deleting the project's claims) is replaced below, and lint refuses an unused import.

Replace the type import `import type { GraphicBrief, ShotBrief } from '@boom-busters/schemas'` with:

```ts
import type { ChartBrief, GraphicBrief, ShotBrief } from '@boom-busters/schemas'
```

Replace the file's doc comment (the block under the imports that starts "The slot-rebriefer against the real database") with:

```ts
/**
 * The slot-rebriefer against the real database, in mock-provider mode
 * (decision 258): a new brief lands whole and keeps the sentence it covers,
 * the steer reaches the draft, a chart is redesigned from the data it has
 * (decision 295), and a slot the button is not offered on refuses in words
 * rather than leaving the card drafting something that never arrives.
 */
```

Add directly after the `stockBrief` constant:

```ts
const chartBrief: ChartBrief = {
  type: 'chart',
  coversText: stockBrief.coversText,
  description: 'The collapse, drawn on.',
  motion: { kind: 'static' },
  transition: 'cut',
  chartKind: 'line',
  series: [
    {
      label: 'Share price',
      unit: 'EUR',
      points: [
        { x: '2020-06-17', y: 104.5 },
        { x: '2020-06-26', y: 1.28 },
      ],
    },
  ],
  // A chart may never cite nothing, by schema, so even the fixture names a claim.
  dataRefs: [SOME_CLAIM],
  takeaway: 'The nine-day collapse.',
  reveal: 'draw-on',
}

/** A design stored on a chart redesigned before (decision 295). */
const STORED_CODE = {
  version: 1 as const,
  source: 'function Graphic(props) { return null }',
  compiled: 'function Graphic(props) {\n  return null;\n}\n',
  title: 'The collapse, as it stands',
  facts: [],
  words: [],
  durationMs: 8000,
}

/**
 * A text-only design (decision 295): it shows no digit, so it passes whatever
 * claims the project holds, and a slow drift keeps every stretch of it moving.
 */
const TEXT_DESIGN = {
  source: `function Graphic(props) {
  const frame = Remotion.useCurrentFrame()
  const { durationInFrames } = Remotion.useVideoConfig()
  const spacing = Remotion.interpolate(frame, [0, durationInFrames], [0, 0.08])
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: props.brand.colors.background }}>
      <div style={{ letterSpacing: spacing + 'em', color: props.brand.colors.textPrimary, fontFamily: props.brand.fonts.heading, fontSize: 120 }}>
        The collapse
      </div>
    </div>
  )
}`,
  title: 'The collapse',
  facts: [],
}
```

Replace the test `'sends a chart back through the claim-validated path'` with:

```ts
  it('redesigns a chart from its series with the steer, never re-drafting its data (decision 295)', async () => {
    const chartSlot = await seedSlot(chartBrief)
    await setSlotRetype(db, chartSlot, { state: 'rebriefing' })

    const { result } = await engine.execute({
      events: rebriefEvent(chartSlot, 'The whole decade, not just the crash.'),
    })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const slot = await getShotSlot(db, chartSlot)
    const brief = slot?.brief as ChartBrief & { code?: { title: string } }
    // Still the same chart: its data comes from the shot list and a retype,
    // and a steer changes only its design.
    expect(brief.type).toBe('chart')
    expect(brief.series).toEqual(chartBrief.series)
    expect(brief.dataRefs).toEqual([SOME_CLAIM])
    expect(brief.takeaway).toBe(chartBrief.takeaway)
    expect(brief.code?.title).toMatch(/^\[mock\]/)
    expect(slot?.retype).toBeNull()
  })
```

Replace the test `'refuses on the row when the claims cannot support a new chart'` with:

```ts
  it('keeps the chart and the design it has when the redesign is refused (decision 295)', async () => {
    const design = await import('@/lib/graphic-design')
    const refuse = vi
      .spyOn(design, 'designGraphic')
      .mockResolvedValueOnce({ ok: false, issue: 'nothing changes between 4.2 s and 11.0 s' })
    try {
      const chartSlot = await seedSlot({
        ...chartBrief,
        takeaway: 'The one the owner is keeping.',
        code: STORED_CODE,
      })
      const { result } = await engine.execute({ events: rebriefEvent(chartSlot) })
      expect(result).toMatchObject({ outcome: 'refused' })

      const slot = await getShotSlot(db, chartSlot)
      // The brief it has survives, design and all, and the reason is where the board reads it.
      const brief = slot?.brief as { takeaway: string; code?: unknown }
      expect(brief.takeaway).toBe('The one the owner is keeping.')
      expect(brief.code).toEqual(STORED_CODE)
      expect(slot?.retype).toEqual({
        state: 'rebrief-refused',
        reason: 'nothing changes between 4.2 s and 11.0 s',
      })
    } finally {
      refuse.mockRestore()
    }
  })
```

Add this test at the end of `describeDb('slot-rebriefer on the answer helper (decision 293)', ...)`:

```ts
  it('redesigns a chart on the designer and asks for no new brief (decision 295)', async () => {
    const slotId = await seedOne(chartBrief)
    callLlm.mockResolvedValue({ text: JSON.stringify(TEXT_DESIGN) })

    const { result } = await engine.execute({ events: rebriefEvent(slotId, 'Calmer.') })

    expect(result).toMatchObject({ outcome: 'rebriefed' })
    // One call, and it is the designer's: the retype prompt is never asked.
    expect(callLlm).toHaveBeenCalledTimes(1)
    expect(callLlm.mock.calls[0]![0]).toMatchObject({ task: 'graphics' })
    const brief = (await getShotSlot(db, slotId))?.brief as ChartBrief & {
      code?: { title: string }
    }
    expect(brief.code?.title).toBe('The collapse')
    expect(brief.series).toEqual(chartBrief.series)
  })
```

- [ ] **Step 22: Run it and watch the chart tests fail**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run inngest/functions/slot-rebriefer.test.ts`
Expected: FAIL on the three chart tests: a chart still goes through the retype drafting path, so the mock replaces its series and takeaway with `[mock]` ones and stores no `code`, the spied refusal is never reached, and the live-path test sees a `retype` task call instead of `graphics`. The rest pass.

- [ ] **Step 23: Redesign a chart instead of re-drafting it**

In `apps/web/inngest/functions/slot-rebriefer.ts`, replace the three bullets of the file's doc comment:

```ts
 * - stock, real footage and AI image briefs are ideas, so `buildRebriefRequest`
 *   asks for another one under the same Director's Book craft rules.
 * - chart and map briefs are data, so they go back through the re-type
 *   drafting path with the target set to the type they already have. That is
 *   not a shortcut: it is how the claim-number validation stays exactly where
 *   it is, and a redrawn chart cannot cite numbers the dossier does not hold
 *   (decision 268, Plan B).
 * - a graphic is redesigned (decision 289): its intent stays and the graphics
 *   designer composes the scene again, so it never reaches the retype prompt.
```

with:

```ts
 * - stock, real footage and AI image briefs are ideas, so `buildRebriefRequest`
 *   asks for another one under the same Director's Book craft rules.
 * - a map brief is data, so it goes back through the re-type drafting path
 *   with the target set to the type it already has. That is not a shortcut:
 *   it is how the validation stays exactly where it is (decision 268, Plan B).
 * - a graphic or a chart is redesigned (decisions 289, 295): a graphic's
 *   intent and a chart's series stay, and the graphics designer writes the
 *   code again, so neither reaches the retype prompt. A chart's data comes
 *   from the shot list and a retype; a steer changes its design.
```

Replace:

```ts
      // A graphic is redesigned, not re-briefed (decision 289): its intent
      // stays, the designer composes again from it, the current scene and the
      // steer. A refusal leaves the scene the card already shows.
      if (brief.type === 'graphic') {
```

with:

```ts
      // A graphic or a chart is redesigned, not re-briefed (decisions 289,
      // 295): its intent or its series stay, and the designer writes it again
      // from them, the current code and the steer. A refusal leaves the
      // design the card already shows.
      if (brief.type === 'graphic' || brief.type === 'chart') {
```

Replace:

```ts
        if (brief.type === 'chart' || brief.type === 'map') {
          const claims = await scriptableClaims(db, projectId)
          // The logo library's index (decision 268, Plan B): a redrafted
          // graphic may name a mark the producer already holds.
```

with:

```ts
        if (brief.type === 'map') {
          const claims = await scriptableClaims(db, projectId)
          // The logo library's index (decision 268, Plan B), which the
          // re-type prompt lists for every target.
```

Replace:

```ts
        // The mock refuses as the live parser does (a chart with no claims to
        // cite), and its refusal lands on the card the same way below.
```

with:

```ts
        // The mock refuses as the live parser does, and its refusal lands on
        // the card the same way below.
```

The redesign branch's body is unchanged: `designGraphic` takes a `DesignableBrief` and `withDesign` keeps the brief's own type.

- [ ] **Step 24: Run it and watch it pass**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run inngest/functions/slot-rebriefer.test.ts`
Expected: PASS, every test in all three `describeDb` blocks.

- [ ] **Step 25: Typecheck, lint, format, commit**

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm lint`
Expected: no warnings, no errors.

Run: `pnpm exec prettier --write apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-rebriefer.test.ts`

```bash
git add apps/web/inngest/functions/slot-rebriefer.ts apps/web/inngest/functions/slot-rebriefer.test.ts
git commit -m "feat(graphics): a chart re-brief is a redesign on the designer (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 26: Run every consumer of the designer**

`GraphicDesignResult`, `designGraphic`, `withDesign` and `designPlannedGraphics` changed shape, so every suite under `lib` and `inngest` runs, not only the files above.

Run (Docker Desktop running, Bash `timeout` 600000, nothing else using the test database): `pnpm --filter @boom-busters/web vitest run lib inngest`
Expected: PASS. A failure here in a file this task did not touch is this task's regression until shown otherwise: re-run that file alone before believing it.

---

### Task 6: The timeline carries the code

**Files:**
- Modify: `packages/timeline/src/compile.ts` (CompileSlot ~:50-100, emission ~:265), `apps/web/inngest/lib/assembly.ts` (~:278 chart, ~:334 graphic), `apps/web/inngest/functions/assembly-runner.ts` (loads the logo library by title), `apps/web/lib/visual-assets.ts` (a graphic with `code` resolves; today a graphic without a scene is a placeholder, and assembly skips placeholders)
- Test: `packages/timeline/src/compile.test.ts`, `apps/web/inngest/lib/assembly.test.ts`, `apps/web/lib/visual-assets.test.ts`

**Interfaces:**
- Consumes: Task 1's `GraphicCodePayload` and the two materialisers' `graphic-code` branches (Task 1 Steps 15 to 18 own `materialise.ts` and the broker's `core.ts`; this task does not touch them, ruling 16); `keepGraphicDesign` already keeps `code` through a Fix rewrite (Task 1 Step 8; a chart the planner replaces loses its `code` with its data); assembly's existing logo join (~:222).
- Produces: `CompileSlot.graphicCode`; a brief with `code` compiles to `graphic-code` whatever else it carries; a chart brief without `code` compiles to `chart`; a graphic brief with only `scene` compiles to `graphic`; `slotPlan`'s `logoLibrary` input, every library mark by title (ruling 5).

**The logo join.** The existing join (`assembly-runner.ts` ~:278) loads only the marks a stored scene cites, by asset id, and the scene keys them by element id. Code names no element and no asset: it reads `props.logos[title]`, and nothing in the source says which titles it reads. So the runner loads the whole library once (`listLogos`), keyed by title, first mark stored under a title winning, and every design written as code carries all of it, graphics and charts alike, as the dry run that checked the design was handed every library title (ruling 5). A graphic or chart with `code` therefore never skips for a missing mark: one it reads but the library lacks makes the composition's error boundary show the title card.

- [ ] **Step 1: Write the compiler's tests for the `graphic-code` payload**

In `packages/timeline/src/compile.test.ts`, add below the existing type import `import type { CompileInput, CompileSlot } from './compile'`:

```ts
import type { GraphicCodePayload } from '@boom-busters/schemas'
```

Add these three tests at the end of `describe('resolveMotion', ...)`, after `'lets a draw-on chart reveal own the slot motion'`:

```ts
  /** A stored design as the assembly hands it over (decision 295). */
  const CODE: Omit<GraphicCodePayload, 'kind'> = {
    version: 1,
    compiled: 'function Graphic(props) {\n  return null;\n}\n',
    title: 'Raised in one round',
    words: [{ text: 'four', atMs: 900 }],
    durationMs: 6000,
    logos: { 'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
    claimIds: ['01HQ00000000000000000000A1'],
  }

  it('compiles a graphic carrying code to a graphic-code payload, whatever scene it also holds (decision 295)', () => {
    const slot: CompileSlot = {
      type: 'graphic',
      startMs: 0,
      durationMs: 6000,
      transition: 'cut',
      motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
      coversText: 'It raised four billion dollars.',
      // The scene a Redesign left beside the code: the code wins.
      graphic: {
        scene: {
          elements: [
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
              content: 'Raised',
              role: 'heading',
              color: 'textPrimary',
              align: 'start',
              enter: { kind: 'fade', atMs: 0 },
            },
          ],
        },
        logos: {},
        claimIds: [],
      },
      graphicCode: CODE,
    }
    const timeline = compileTimeline({ ...goldenInput(), slots: [slot] })
    const compiled = timeline.slots[0]!
    // The slot keeps its board type; only the payload says how it is drawn.
    expect(compiled.type).toBe('graphic')
    expect(compiled.payload).toEqual({ kind: 'graphic-code', ...CODE })
    // The code animates itself: no Ken Burns on top of it.
    expect(compiled.motion).toEqual({ kind: 'static' })
    expect(canonicalTimelineIssues(timeline)).toEqual([])
  })

  it('compiles a chart carrying code to a graphic-code payload on a chart slot, its series as data (decision 295)', () => {
    const series = [
      {
        label: 'Share price',
        unit: 'EUR',
        points: [
          { x: '2020-06-17', y: 104.5 },
          { x: '2020-06-26', y: 1.28 },
        ],
      },
    ]
    const slot: CompileSlot = {
      ...still,
      type: 'chart',
      chart: {
        chartKind: 'line',
        series,
        dataRefs: [CLAIM],
        takeaway: 'The nine-day collapse.',
        reveal: 'draw-on',
      },
      graphicCode: {
        ...CODE,
        logos: {},
        claimIds: [CLAIM],
        data: { series, takeaway: 'The nine-day collapse.' },
      },
    }
    const timeline = compileTimeline({ ...goldenInput(), slots: [slot] })
    const compiled = timeline.slots[0]!
    expect(compiled.type).toBe('chart')
    expect(compiled.payload).toMatchObject({
      kind: 'graphic-code',
      claimIds: [CLAIM],
      data: { series, takeaway: 'The nine-day collapse.' },
    })
    // The draw-on belongs to the chart's own reveal, which this slot no longer plays.
    expect(compiled.motion).toEqual({ kind: 'static' })
  })

  it('still compiles a chart without code to its own reveal', () => {
    const timeline = compileTimeline(goldenInput())
    const chart = timeline.slots.find((slot) => slot.type === 'chart')!
    expect(chart.payload.kind).toBe('chart')
    expect(chart.motion).toEqual({ kind: 'draw-on' })
  })
```

- [ ] **Step 2: Run them and watch the first two fail**

Run: `pnpm --filter @boom-busters/timeline vitest run src/compile.test.ts`
Expected: FAIL on the two `graphic-code` tests: the compiler ignores `graphicCode`, so the first emits `kind: 'graphic'` and the second `kind: 'chart'` with `draw-on` motion. `'still compiles a chart without code to its own reveal'` and the golden pass. (A failure reading "a chart slot cannot carry a graphic-code payload" after Step 3 means Task 1 did not widen `SLOT_PAYLOAD_KINDS`; stop and report it.)

- [ ] **Step 3: Emit `graphic-code` before chart and graphic**

In `packages/timeline/src/compile.ts`:

Add `GraphicCodePayload,` to the `import type { ... } from '@boom-busters/schemas'` list, directly after `ChartBrief,`.

In `CompileSlot`, directly after the `graphic?: { ... }` field and its doc comment, add:

```ts
  /**
   * A graphic or a chart the designer wrote as code (decision 295), embedded
   * whole: the compiled component, the words it times itself to, the logo
   * library's marks by title, the claims it cites and, for a chart, its
   * series. Checked before `chart` and `graphic`: a brief that carries code
   * plays the code, whatever older design it also holds.
   */
  graphicCode?: Omit<GraphicCodePayload, 'kind'>
```

In `resolveMotion`, replace:

```ts
  if (slot.chart) return { kind: slot.chart.reveal === 'draw-on' ? 'draw-on' : 'static' }
```

with:

```ts
  // Code animates itself (decision 295); a chart's draw-on is its own reveal's.
  if (slot.graphicCode) return { kind: 'static' }
  if (slot.chart) return { kind: slot.chart.reveal === 'draw-on' ? 'draw-on' : 'static' }
```

In the slot emission, replace:

```ts
    if (slot.chart) {
      return { ...base, payload: { kind: 'chart' as const, ...slot.chart } }
    }
```

with:

```ts
    // Before the chart and the scene: a brief with code plays the code
    // (decision 295). The slot's own type passes through as it is.
    if (slot.graphicCode) {
      return { ...base, payload: { kind: 'graphic-code' as const, ...slot.graphicCode } }
    }
    if (slot.chart) {
      return { ...base, payload: { kind: 'chart' as const, ...slot.chart } }
    }
```

- [ ] **Step 4: Run them and watch them pass**

Run: `pnpm --filter @boom-busters/timeline vitest run src/compile.test.ts`
Expected: PASS, the golden byte for byte included (its fixture carries no code).

- [ ] **Step 5: Typecheck, format, commit**

Run: `pnpm --filter @boom-busters/timeline typecheck`
Expected: no errors.

Run: `pnpm exec prettier --write packages/timeline/src/compile.ts packages/timeline/src/compile.test.ts`

```bash
git add packages/timeline/src/compile.ts packages/timeline/src/compile.test.ts
git commit -m "feat(timeline): a slot carrying code compiles to the graphic-code payload (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 6: Write the assembly's tests for briefs with code**

In `apps/web/inngest/lib/assembly.test.ts`, add this `describe` inside `describe('slotPlan', ...)`, directly after the closing `})` of `describe('graphic slots (decision 268, Plan B)', ...)`:

```ts
  describe('designs written as code (decision 295)', () => {
    const CLAIM_A = '01HQ00000000000000000000A2'
    const CLAIM_B = '01HQ00000000000000000000A3'
    const CODE = {
      version: 1,
      source: 'function Graphic() { return null }',
      compiled: 'function Graphic() {\n  return null;\n}\n',
      title: 'Raised in one round',
      facts: [
        { text: '4 billion', claimId: CLAIM_A },
        { text: 'Series C', claimId: CLAIM_A },
      ],
      words: [{ text: 'four', atMs: 900 }],
      durationMs: 4000,
    }
    const LIBRARY = new Map([
      ['Stability AI', { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 }],
      ['OpenAI', { r2Key: 'boom-busters/logos/def.png', width: 800, height: 800 }],
    ])
    const SERIES = [
      {
        label: 'Price',
        unit: '€',
        points: [
          { x: 'A', y: 1 },
          { x: 'B', y: 2 },
        ],
      },
    ]

    function chartRow(code?: unknown) {
      return slotRow({
        type: 'chart',
        brief: {
          type: 'chart',
          coversText: 'covers',
          description: 'desc',
          motion: { kind: 'static' },
          transition: 'dissolve',
          chartKind: 'line',
          series: SERIES,
          dataRefs: [CLAIM_B],
          takeaway: 'Up and to the right, then not.',
          annotations: [{ atX: 'B', text: 'The peak' }],
          reveal: 'draw-on',
          ...(code ? { code } : {}),
        } as unknown as Record<string, unknown>,
        candidates: [],
      })
    }

    it('carries a graphic with code as code, every mark in the library by title, even beside an old scene', () => {
      const plan = slotPlan({
        slots: [
          slotRow({
            type: 'graphic',
            brief: {
              type: 'graphic',
              coversText: 'covers',
              description: 'desc',
              motion: { kind: 'static' },
              transition: 'cut',
              intent: 'The figure is the story.',
              intentClaimIds: [CLAIM_B],
              // A scene from before whose mark was never uploaded: on its own
              // it would skip the slot; the code does not draw it.
              scene: {
                elements: [
                  {
                    kind: 'logo',
                    id: 'l1',
                    cell: { col: 6, row: 0, colSpan: 6, rowSpan: 3 },
                    entity: 'Nobody Uploaded This',
                    enter: { kind: 'fade', atMs: 0 },
                  },
                ],
              },
              code: CODE,
            } as unknown as Record<string, unknown>,
            candidates: [],
          }),
        ],
        assetsById: new Map(),
        logos: new Map(),
        logoLibrary: LIBRARY,
      })
      expect(plan.skipped).toEqual([])
      expect(plan.slots[0]).toMatchObject({
        type: 'graphic',
        graphicCode: {
          version: 1,
          compiled: CODE.compiled,
          title: 'Raised in one round',
          words: CODE.words,
          durationMs: 4000,
          logos: {
            'Stability AI': { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 },
            OpenAI: { r2Key: 'boom-busters/logos/def.png', width: 800, height: 800 },
          },
          // The facts' claims, each once, then the intent's.
          claimIds: [CLAIM_A, CLAIM_B],
        },
      })
      expect(plan.slots[0]?.graphic).toBeUndefined()
      expect(plan.slots[0]?.graphicCode).not.toHaveProperty('data')
    })

    it('carries a chart with code as code on a chart slot, its series as data and its refs as claims', () => {
      const plan = slotPlan({
        slots: [chartRow(CODE)],
        assetsById: new Map(),
        logoLibrary: LIBRARY,
      })
      expect(plan.slots[0]).toMatchObject({
        type: 'chart',
        graphicCode: {
          title: 'Raised in one round',
          // The data refs first, then any other claim the facts cite.
          claimIds: [CLAIM_B, CLAIM_A],
          data: {
            series: SERIES,
            takeaway: 'Up and to the right, then not.',
            annotations: [{ atX: 'B', text: 'The peak' }],
          },
          logos: {
            'Stability AI': { r2Key: 'boom-busters/logos/abc.png' },
            OpenAI: { r2Key: 'boom-busters/logos/def.png' },
          },
        },
      })
      expect(plan.slots[0]?.chart).toBeUndefined()
    })

    it('carries a chart without code as the chart it always was', () => {
      const plan = slotPlan({ slots: [chartRow()], assetsById: new Map(), logoLibrary: LIBRARY })
      expect(plan.slots[0]).toMatchObject({
        type: 'chart',
        chart: { chartKind: 'line', dataRefs: [CLAIM_B], reveal: 'draw-on' },
      })
      expect(plan.slots[0]?.graphicCode).toBeUndefined()
    })

    it('gives code no marks when the runner passes no library', () => {
      const plan = slotPlan({ slots: [chartRow(CODE)], assetsById: new Map() })
      expect(plan.slots[0]?.graphicCode?.logos).toEqual({})
    })
  })
```

The existing `'skips a graphic that has not been designed, in words (decision 289)'` stays as it is: a brief with neither `code` nor `scene` still skips with that reason.

- [ ] **Step 7: Run them and watch them fail**

Run: `pnpm --filter @boom-busters/web vitest run inngest/lib/assembly.test.ts`
Expected: FAIL on three of the four new tests (and a type error on `logoLibrary` under typecheck): the graphic slot skips with `a logo for "Nobody Uploaded This" has not been uploaded`, and the chart slots carry `chart`, not `graphicCode`. `'carries a chart without code as the chart it always was'` passes.

- [ ] **Step 8: Map a brief with code to `graphicCode`**

In `apps/web/inngest/lib/assembly.ts`:

Replace the `import type { ... } from '@boom-busters/schemas'` block with:

```ts
import type {
  ArticleMetadata,
  BrandKitTokens,
  Caption,
  GraphicCode,
  GraphicCodePayload,
  SocialPostRecord,
  WordTiming,
} from '@boom-busters/schemas'
```

Directly above `export function slotPlan(`, add:

```ts
type LogoBytes = { r2Key: string; width: number; height: number }

/**
 * A stored design as the timeline carries it (decision 295), less the claims
 * and the data, which each brief type gathers its own way. The code reads its
 * marks as `props.logos[title]` and nothing in it says which titles, so it
 * carries every mark the library holds, as the dry run that checked it was
 * handed every library title.
 */
function codePayload(
  code: GraphicCode,
  library: ReadonlyMap<string, LogoBytes> | undefined,
): Omit<GraphicCodePayload, 'kind' | 'claimIds' | 'data'> {
  return {
    version: code.version,
    compiled: code.compiled,
    title: code.title,
    words: code.words,
    durationMs: code.durationMs,
    logos: Object.fromEntries(library ?? []),
  }
}
```

In `slotPlan`'s input type, directly after the `logos?: ReadonlyMap<...>` field and its doc comment, add:

```ts
  /**
   * Every mark the logo library holds, by TITLE (decision 295), for the
   * designs written as code. Absent, a design gets no marks: one that reads a
   * mark then shows its title card rather than failing the render.
   */
  logoLibrary?: ReadonlyMap<string, LogoBytes>
```

Replace the chart branch:

```ts
    if (brief.type === 'chart') {
      slots.push({
        ...base,
        type: 'chart',
        chart: {
```

with:

```ts
    if (brief.type === 'chart') {
      // The designer's chart (decision 295): code built around the brief's
      // own series, which ride along as `props.data`. A chart with no design
      // yet keeps its own reveal.
      if (brief.code) {
        slots.push({
          ...base,
          type: 'chart',
          graphicCode: {
            ...codePayload(brief.code, input.logoLibrary),
            claimIds: [
              ...new Set([...brief.dataRefs, ...brief.code.facts.map((fact) => fact.claimId)]),
            ],
            data: {
              series: brief.series,
              takeaway: brief.takeaway,
              ...(brief.annotations !== undefined ? { annotations: brief.annotations } : {}),
            },
          },
        })
        continue
      }
      slots.push({
        ...base,
        type: 'chart',
        chart: {
```

(the rest of the existing chart push, its `continue` and closing brace stay as they are).

In the graphic branch, replace:

```ts
    if (brief.type === 'graphic') {
      // The scene keys its logos by ELEMENT id; `input.logos` (loaded once by
```

with:

```ts
    if (brief.type === 'graphic') {
      // A design written as code (decision 295) plays as code, whatever older
      // scene the brief still holds: a Redesign leaves the scene beside it,
      // and the code is what the board shows.
      if (brief.code) {
        slots.push({
          ...base,
          type: 'graphic',
          graphicCode: {
            ...codePayload(brief.code, input.logoLibrary),
            claimIds: [
              ...new Set([
                ...brief.code.facts.map((fact) => fact.claimId),
                ...(brief.intentClaimIds ?? []),
              ]),
            ],
          },
        })
        continue
      }
      // The scene keys its logos by ELEMENT id; `input.logos` (loaded once by
```

(the rest of the scene path, the "has not been designed" skip included, stays as it is).

In `slotPlan`'s doc comment, replace:

```ts
 * Board rows → compiler slots. Chart and map slots carry their brief's
 * data; media slots carry a storage key (our bytes win over any URL) or
```

with:

```ts
 * Board rows → compiler slots. Chart and map slots carry their brief's
 * data, and a graphic or chart the designer wrote carries its code
 * (decision 295); media slots carry a storage key (our bytes win over any URL) or
```

- [ ] **Step 9: Run them and watch them pass**

Run: `pnpm --filter @boom-busters/web vitest run inngest/lib/assembly.test.ts`
Expected: PASS, every test.

- [ ] **Step 10: The assembly runner loads the library by title**

In `apps/web/inngest/functions/assembly-runner.ts`:

In the `@boom-busters/db` import, add `listLogos,` directly after `listCastMembers,`.

In the `compile-timeline` step, directly after the closing `}` of the loop that fills `logos` (the one under `// The marks every graphic draws, read once by asset id (decision 268).`), add:

```ts
      // Every mark in the library by title, for the designs written as code
      // (decision 295): the code reads `props.logos[title]`, and nothing in
      // it says which titles, so the whole library rides along. The first
      // mark stored under a title wins, in `listLogos` order.
      const logoLibrary = new Map<string, { r2Key: string; width: number; height: number }>()
      for (const asset of await listLogos(db)) {
        const title = asset.title ?? ''
        if (title.trim() === '' || logoLibrary.has(title) || !asset.width || !asset.height) {
          continue
        }
        logoLibrary.set(title, { r2Key: asset.r2Key, width: asset.width, height: asset.height })
      }
```

In the `slotPlan({ ... })` call in the same step, add `logoLibrary,` directly after `logos,`.

- [ ] **Step 11: Typecheck, format, commit**

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: no errors.

Run: `pnpm exec prettier --write apps/web/inngest/lib/assembly.ts apps/web/inngest/lib/assembly.test.ts apps/web/inngest/functions/assembly-runner.ts`

```bash
git add apps/web/inngest/lib/assembly.ts apps/web/inngest/lib/assembly.test.ts apps/web/inngest/functions/assembly-runner.ts
git commit -m "feat(assembly): a graphic or chart with code reaches the timeline as code (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 12: Write the resolver's test for a graphic with code**

In `apps/web/lib/visual-assets.test.ts`, inside `describeDb('generateStillCandidates with the cast', ...)`, directly after the test `'a graphic whose matched mark was since deleted returns to placeholder, not resolved'`, add:

```ts
  it('resolves a graphic written as code at no cost, whatever older scene it holds (decision 295)', async () => {
    const designed: GraphicBrief = {
      type: 'graphic',
      coversText: 'x',
      description: 'y',
      motion: { kind: 'static' },
      transition: 'cut',
      shotSize: 'graphic',
      code: {
        version: 1,
        source: 'function Graphic() { return null }',
        compiled: 'function Graphic() {\n  return null;\n}\n',
        title: 'Raised in one round',
        facts: [],
        words: [],
        durationMs: 6000,
      },
    }
    expect(
      await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief: designed, route: null }),
    ).toEqual({ candidates: [], status: 'resolved' })
    // A scene from before whose mark was never uploaded: the code does not draw it.
    const redesigned: GraphicBrief = {
      ...designed,
      scene: {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 },
            entity: 'Stability AI',
            enter: { kind: 'fade', atMs: 0 },
          },
        ],
      },
    }
    expect(
      await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief: redesigned, route: null }),
    ).toEqual({ candidates: [], status: 'resolved' })
    expect(generate).not.toHaveBeenCalled()
  })
```

- [ ] **Step 13: Run it and watch it fail**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run lib/visual-assets.test.ts`
Expected: FAIL on the new test: both briefs resolve to `placeholder` (the first has no scene; the second's scene owes a mark). The rest pass.

- [ ] **Step 14: A graphic with code resolves**

In `apps/web/lib/visual-assets.ts`, in `case 'graphic':`, replace:

```ts
      // A graphic stored before it is designed (decision 289) has no scene
      // yet: it waits as a placeholder, and the designer fills it in.
      if (!brief.scene) return { candidates: [], status: 'placeholder' }
```

with:

```ts
      // A graphic written as code (decision 295) waits for no mark: the code
      // reads what the library holds when the film is compiled, and it plays
      // whatever older scene the brief still carries.
      if (brief.code) return { candidates: [], status: 'resolved' }
      // A graphic stored before it is designed (decision 289) has no scene
      // yet: it waits as a placeholder, and the designer fills it in.
      if (!brief.scene) return { candidates: [], status: 'placeholder' }
```

A chart already resolves at once (`case 'chart':`), with or without code.

- [ ] **Step 15: Run it and watch it pass**

Run (Docker Desktop running, Bash `timeout` 600000): `pnpm --filter @boom-busters/web vitest run lib/visual-assets.test.ts`
Expected: PASS, with the tests run rather than skipped.

- [ ] **Step 16: Format, commit**

Run: `pnpm exec prettier --write apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts`

```bash
git add apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts
git commit -m "feat(visuals): a graphic written as code resolves without fetching (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 17: Run the consumers, the typecheck and the lint**

The two materialisers already sign a `graphic-code` slot's logos: Task 1 (Steps 15 to 18) owns those edits and their tests (ruling 16), and the preview's rule there, a mark that will not resolve left out rather than the slot dropped, is the one a payload carrying the whole library needs. This task does not edit them; it confirms the payload `slotPlan` now emits still passes through them.

Run (Docker Desktop running, nothing else using the test database, Bash `timeout` 600000), one after another:
- `pnpm --filter @boom-busters/timeline exec vitest run`
- `pnpm --filter @boom-busters/web exec vitest run inngest/lib/assembly.test.ts lib/visual-assets.test.ts lib/materialise.test.ts`
- `pnpm --filter @boom-busters/infra exec vitest run lambdas/broker/core.test.ts`
- `pnpm typecheck`
- `pnpm lint`

Expected: all PASS, zero lint warnings. Nothing is committed here: Steps 5, 11 and 16 committed this task's changes.

---

### Task 7: The board plays and previews the code

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/graphic-code-still.tsx`, `apps/web/app/(console)/projects/[id]/graphic-code-still.test.tsx`
- Modify: `apps/web/lib/visuals-review.ts` (the slot model's `logoMarks`), `apps/web/app/(console)/projects/[id]/graphic-player.tsx`, `graphic-playback.tsx`, `visual-board.tsx` (graphic card ~:2250, Redesign ~:2560, chart card), `slot-previews.tsx` (~:981)
- Test: `apps/web/lib/visuals-review.test.ts`, `apps/web/app/(console)/projects/[id]/graphic-player.test.tsx`, `visual-board.test.tsx`, `graphic-code-still.test.tsx`; `slot-previews.test.tsx` is run, not changed

**Interfaces:**
- Consumes: Task 2's `GraphicCode`, `buildGraphic`, `graphicPropsFor`, `withAlpha`, `GRAPHIC_CODE_SOURCE` and the types `GraphicProps`, `GraphicScope`, all from the `@boom-busters/compositions` barrel (client side; `graphicPropsFor` applies `safeInsets`); Task 1's `GraphicCode` type; `rebriefSlotAction`/the existing Redesign wiring.
- Produces: `GraphicPlayerFrame` taking a `GraphicDesign` (`{ kind: 'code' }` or `{ kind: 'scene' }`); `GraphicCodeStill`; `codeLogoMarks`, `LogoMark` and `SlotView.logoMarks`; `codeLogosFor`, `codePayloadFor`, `CodeLogos`; `designNoun`; a chart card with `code` showing title, Play and Redesign.

What the code says about the logo join (read before Step 1): the board's `SlotView.logoUrls` is one board-wide object keyed by ASSET id, built in `apps/web/lib/visuals-review.ts` (~:822-845) from the asset ids a `scene`'s logo elements carry, and only when storage is configured. Nothing on the slot model carries a logo's title or size. A design in code names its marks by entity TITLE (`props.logos['Acme']`) and the render's payload carries each mark's real `width` and `height`. So this task adds `logoMarks: Record<assetId, { title, width, height }>` to the slot model (named `logoMarks`, not `logoTitles`, because it carries the size too: a component that sizes a logo by its aspect ratio would draw it square at 1 by 1). Ruling 5 makes it the WHOLE library: when the board holds any design in code, every titled, sized library mark is signed and listed, first mark under a title winning as in the assembly, and the board joins the two into title-keyed marks with `codeLogosFor`, so the player and the still hand the code exactly what the dry run and the render hand it.

The compositions barrel already exports `withAlpha` and `safeInsets` (Task 2, Step 14); this task does not edit `packages/compositions/src/index.ts`.

Every command runs in the foreground with the Bash tool's `timeout` parameter set to 600000. Never use background commands.

- [ ] **Step 1: Write the failing test for the library's marks**

In `apps/web/lib/visuals-review.test.ts`, add `codeLogoMarks` to the import from `'./visuals-review'`:

```ts
import {
  codeLogoMarks,
  isFetching,
  jobsNeedPolling,
  slotJobView,
  socialSlotView,
  visualsJobView,
} from './visuals-review'
```

and append at the end of the file:

```ts
describe('codeLogoMarks (decision 295)', () => {
  const library = [
    { id: 'A1', title: 'Acme', width: 400, height: 200 },
    { id: 'A2', title: 'Globex', width: 300, height: 300 },
    { id: 'A3', title: null, width: 100, height: 100 },
    { id: 'A4', title: 'Initech', width: null, height: 50 },
    { id: 'A5', title: 'Acme', width: 800, height: 800 },
    { id: 'A6', title: '   ', width: 100, height: 100 },
  ]

  it('lists every titled, sized mark in the library, whatever the code reads (ruling 5)', () => {
    expect(codeLogoMarks(library)).toEqual({
      A1: { title: 'Acme', width: 400, height: 200 },
      A2: { title: 'Globex', width: 300, height: 300 },
    })
  })

  it('keeps the first mark stored under a title, as the assembly does', () => {
    expect(codeLogoMarks(library)).not.toHaveProperty('A5')
  })

  it('lists nothing for an empty library', () => {
    expect(codeLogoMarks([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @boom-busters/web vitest run lib/visuals-review.test.ts`
Expected: FAIL, the three new tests with `TypeError: codeLogoMarks is not a function`; every older test in the file passes.

- [ ] **Step 3: Add `logoMarks` to the slot model**

In `apps/web/lib/visuals-review.ts`:

Add `listLogos` to the `@boom-busters/db` import, between `listCastMembers` and `listProjectSets`:

```ts
  listCastMembers,
  listLogos,
  listProjectSets,
```

In `SlotView`, directly after the `logoUrls: Record<string, string>` field and its comment, add:

```ts
  /**
   * The marks a design written as code may draw (decision 295; ruling 5: the
   * whole library), by asset id: the entity title its source keys a mark by
   * (`props.logos['Acme']`) and the size the render's payload carries.
   * Board-wide and shared like `logoUrls`, which holds their signed URLs;
   * empty when storage is not configured or no design on the board is code.
   */
  logoMarks: Record<string, LogoMark>
```

Directly after the `SlotView` interface's closing brace, add:

```ts
/** A library mark as a design in code names it (decision 295). */
export interface LogoMark {
  title: string
  width: number
  height: number
}

/**
 * Every library mark a design written as code may draw (decision 295; ruling
 * 5): the whole library, keyed by asset id, with the entity title the code
 * keys it by and its size, because nothing in a source says which titles it
 * reads and the dry run handed it every one. The same rule as the assembly's
 * `logoLibrary`: a mark with no title or no size is left out, and the first
 * mark stored under a title wins, in `listLogos` order.
 */
export function codeLogoMarks(
  logos: readonly {
    id: string
    title: string | null
    width: number | null
    height: number | null
  }[],
): Record<string, LogoMark> {
  const marks: Record<string, LogoMark> = {}
  const titles = new Set<string>()
  for (const logo of logos) {
    const title = logo.title ?? ''
    if (title.trim() === '' || titles.has(title) || !logo.width || !logo.height) continue
    titles.add(title)
    marks[logo.id] = { title, width: logo.width, height: logo.height }
  }
  return marks
}
```

Replace the whole presign block in `visualsReviewModel` (the comment beginning "Every graphic logo's presigned URL, board-wide" through the closing brace of `if (storageConfigured()) { ... }`) with:

```ts
  /**
   * Every graphic logo's presigned URL, board-wide, the same shared-object
   * shape `page.tsx` builds `photoUrls` in (decision 268, Plan B): read here
   * rather than there, because only this function has already parsed every
   * brief to find which asset ids a scene cites. Mock storage (no R2) leaves
   * this empty, same as `photoUrls`, so a matched mark falls back to the
   * preview's "upload" box rather than a broken `<image>`.
   *
   * A design written as code (decision 295) names its marks by title in its
   * source, not by asset id, and is handed the whole library (ruling 5): when
   * the board holds one, every library mark is signed too, and
   * `graphicLogoMarks` gives the board each one's title and size, so the
   * player and the still key and size them as the render does.
   */
  const graphicLogoUrls: Record<string, string> = {}
  const graphicLogoMarks: Record<string, LogoMark> = {}
  if (storageConfigured()) {
    const assetIds = new Set(
      briefs.flatMap((parsed) =>
        parsed.success && parsed.data.type === 'graphic'
          ? (parsed.data.scene?.elements ?? []).flatMap((element) =>
              element.kind === 'logo' && element.assetId !== undefined ? [element.assetId] : [],
            )
          : [],
      ),
    )
    for (const assetId of assetIds) {
      const logo = await logoById(db, assetId)
      if (logo) graphicLogoUrls[assetId] = await presignGet(logo.r2Key)
    }

    const anyCode = briefs.some(
      (parsed) =>
        parsed.success &&
        (parsed.data.type === 'graphic' || parsed.data.type === 'chart') &&
        parsed.data.code !== undefined,
    )
    if (anyCode) {
      const library = await listLogos(db)
      Object.assign(graphicLogoMarks, codeLogoMarks(library))
      for (const logo of library) {
        if (graphicLogoMarks[logo.id] && graphicLogoUrls[logo.id] === undefined) {
          graphicLogoUrls[logo.id] = await presignGet(logo.r2Key)
        }
      }
    }
  }
```

In the `slots` map's returned object, directly after `logoUrls: graphicLogoUrls,` add:

```ts
      logoMarks: graphicLogoMarks,
```

- [ ] **Step 4: Give the board's slot fixtures the new field**

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, every `SlotView` fixture (`stockSlot`, `chartSlot`, `headlineSlot`, `graphicSlot`, `brokenSlot` and the post card's fixture near :2330) has the line `  logoUrls: {},`. Replace all six with the Edit tool (`replace_all: true`):

old:
```ts
  logoUrls: {},
```
new:
```ts
  logoUrls: {},
  logoMarks: {},
```

- [ ] **Step 5: Run the test and the type check**

Run: `pnpm --filter @boom-busters/web vitest run lib/visuals-review.test.ts`
Expected: PASS, every test in the file.

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: exits 0 with no output from `tsc`. (Storage is not configured in unit tests or in e2e, so the presign block itself is reached by neither; `codeLogoMarks` is its tested part.)

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write apps/web/lib/visuals-review.ts apps/web/lib/visuals-review.test.ts "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git add apps/web/lib/visuals-review.ts apps/web/lib/visuals-review.test.ts "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "$(cat <<'EOF'
feat(board): the slot model signs the whole logo library for designs in code (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Write the failing player tests**

In `apps/web/app/(console)/projects/[id]/graphic-player.test.tsx`:

Directly after the `fire` helper, add:

```tsx
/** Every Player render's component and props, newest last. */
const played = vi.hoisted(() => vi.fn())
```

Replace the `@remotion/player` and `@boom-busters/compositions` mocks with:

```tsx
vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    React.forwardRef(function MockPlayer(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { component, durationInFrames, compositionWidth, compositionHeight, inputProps }: any,
      ref,
    ) {
      React.useImperativeHandle(ref, () => handle as never)
      played({ component, inputProps })
      return (
        <div data-testid="player">
          frames:{durationInFrames} size:{compositionWidth}x{compositionHeight} logos:
          {Object.keys(inputProps.payload.logos).join(',')}
        </div>
      )
    }),
    { displayName: 'Player' },
  ),
}))
vi.mock('@boom-busters/compositions', () => ({
  GraphicCard: () => null,
  GraphicCode: () => null,
  loadBrandFonts: () => Promise.resolve(),
  msToFrames: (ms: number, fps: number) => Math.round((ms * fps) / 1000),
}))

import { GraphicCode } from '@boom-busters/compositions'
```

(the existing `import { GraphicPlayback, GraphicPlaybackProvider } from './graphic-playback'` stays directly below it).

Append at the end of the file:

```tsx
/** A design written as code (decision 295). Plain JS: the source is its own compiled form. */
const CODE_SOURCE = "function Graphic(props) { return props.logos['Acme'] ? null : null }"
const CODE = {
  version: 1 as const,
  source: CODE_SOURCE,
  compiled: CODE_SOURCE,
  title: 'Acme, counted up',
  facts: [],
  words: [{ text: 'four', atMs: 300 }],
  durationMs: 6000,
}
const ACME = { assetId: 'A1', url: 'https://r2.example/acme.png', width: 400, height: 200 }
const DATA = {
  series: [
    {
      label: 'Share price',
      unit: 'EUR',
      points: [
        { x: '2020-06-17', y: 104.5 },
        { x: '2020-06-26', y: 1.28 },
      ],
    },
  ],
  takeaway: 'From €104 to €1.28 in nine days.',
}

describe('GraphicPlayback with code (decision 295)', () => {
  it('plays the code on GraphicCode in the full frame, its marks keyed by title', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        code={CODE}
        codeLogos={{ Acme: ACME }}
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    // The frame the dry run checked the code in; the Player scales it to the card.
    expect(await screen.findByTestId('player')).toHaveTextContent(
      'frames:180 size:1920x1080 logos:Acme',
    )
    expect(played).toHaveBeenLastCalledWith({
      component: GraphicCode,
      inputProps: {
        payload: {
          kind: 'graphic-code',
          version: 1,
          compiled: CODE_SOURCE,
          title: 'Acme, counted up',
          words: CODE.words,
          durationMs: 6000,
          logos: { Acme: { r2Key: 'logos/A1', url: ACME.url, width: 400, height: 200 } },
          claimIds: [],
        },
        brand: expect.objectContaining({ colors: expect.any(Object) }),
        durationInFrames: 180,
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    expect(await screen.findByTestId('player')).toHaveTextContent('size:1080x1920')
  })

  it('plays the code when the brief still carries the scene it replaced', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        scene={SCENE}
        code={CODE}
        codeLogos={{}}
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{ A1: 'https://r2.example/acme.png' }}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await screen.findByTestId('player')
    expect(played).toHaveBeenLastCalledWith(expect.objectContaining({ component: GraphicCode }))
  })

  it('names a chart on its button, and hands its code the series', async () => {
    render(
      <GraphicPlayback
        slotId="s1"
        code={CODE}
        data={DATA}
        noun="chart"
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Play chart' }))
    await screen.findByTestId('player')
    expect(played).toHaveBeenLastCalledWith(
      expect.objectContaining({
        inputProps: expect.objectContaining({
          payload: expect.objectContaining({ kind: 'graphic-code', data: DATA }),
        }),
      }),
    )
  })

  it('offers nothing to play without a scene or code', () => {
    const { container } = render(
      <GraphicPlayback
        slotId="s1"
        brand={DEFAULT_SETTINGS.brandKit}
        logoUrls={{}}
        durationMs={6000}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
```

- [ ] **Step 8: Run them and watch them fail**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/graphic-player.test.tsx"`
Expected: FAIL, the four new tests: the code-only test with `TypeError: Cannot read properties of undefined (reading 'elements')` (the frame is handed no scene), the scene-and-code test with `played` last called with the mocked `GraphicCard` instead of `GraphicCode`, the chart test with `Unable to find an accessible element with the role "button" and name "Play chart"`, and the last with the container still holding the Play graphic button. The eight older tests pass.

- [ ] **Step 9: Write the light half: what plays, and the helpers both halves share**

Replace the whole of `apps/web/app/(console)/projects/[id]/graphic-playback.tsx` with:

```tsx
'use client'

import type {
  BrandKitStored,
  GraphicCode,
  GraphicCodePayload,
  GraphicScene,
} from '@boom-busters/schemas'
import type { PlayerRef } from '@remotion/player'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/**
 * The light half of the board's playback (decision 289): which graphic is
 * playing, and the buttons that drive it. The board imports this statically,
 * so nothing here may import `@remotion/player` or `@boom-busters/compositions`
 * at runtime (types only). The heavy half, `GraphicPlayerFrame`, is fetched
 * the first time a frame renders, which is after Play is pressed.
 *
 * Since decision 295 a graphic or a chart may be designed as code. The pure
 * helpers the player, the still and the board share live here, in the module
 * the board already loads: every library mark the board signed, keyed by
 * title (`codeLogosFor`; ruling 5), and the `graphic-code` payload a design
 * plays as (`codePayloadFor`), built the way the timeline builds it.
 */

const GraphicPlayerFrame = dynamic(
  () => import('./graphic-player').then((module) => module.GraphicPlayerFrame),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="p-3 text-[13px] text-[var(--color-text-muted)]">
        Loading the player…
      </p>
    ),
  },
)

/** The library's marks for a design in code, keyed by entity title as `props.logos` is (decision 295). */
export type CodeLogos = Readonly<
  Record<string, { assetId: string; url: string; width: number; height: number }>
>

const NO_LOGOS: CodeLogos = {}

/**
 * What the player mounts: the designer's code (decision 295), or a scene
 * composed before it. Code carries its own marks, by title; a scene's are
 * looked up by asset id.
 */
export type GraphicDesign =
  | { kind: 'scene'; scene: GraphicScene }
  | { kind: 'code'; code: GraphicCode; data?: GraphicCodePayload['data']; logos: CodeLogos }

/**
 * The marks a design in code is handed (decision 295; ruling 5): every
 * library mark the board signed (`logoMarks` is the whole library), keyed by
 * its title, whatever the source reads, as the dry run and the render hand
 * them over.
 */
export function codeLogosFor(
  logoUrls: Readonly<Record<string, string>>,
  logoMarks: Readonly<Record<string, { title: string; width: number; height: number }>>,
): CodeLogos {
  const logos: Record<string, CodeLogos[string]> = {}
  for (const [assetId, mark] of Object.entries(logoMarks)) {
    const url = logoUrls[assetId]
    if (url !== undefined && logos[mark.title] === undefined) {
      logos[mark.title] = { assetId, url, width: mark.width, height: mark.height }
    }
  }
  return logos
}

/**
 * The `graphic-code` payload a design in code plays as, the shape the
 * timeline gives `GraphicCode` (decision 295). The board holds signed URLs,
 * so each mark carries its URL and a stand-in key the component never reads.
 */
export function codePayloadFor(
  code: GraphicCode,
  logos: CodeLogos,
  data?: GraphicCodePayload['data'],
): GraphicCodePayload {
  return {
    kind: 'graphic-code',
    version: code.version,
    compiled: code.compiled,
    title: code.title,
    words: code.words,
    durationMs: code.durationMs,
    logos: Object.fromEntries(
      Object.entries(logos).map(([title, logo]) => [
        title,
        { r2Key: `logos/${logo.assetId}`, url: logo.url, width: logo.width, height: logo.height },
      ]),
    ),
    claimIds: [],
    ...(data ? { data } : {}),
  }
}

const PlaybackContext = React.createContext<{
  playing: string | null
  setPlaying: (slotId: string | null) => void
} | null>(null)

/** One graphic plays at a time across the board. */
export function GraphicPlaybackProvider({ children }: { children: React.ReactNode }) {
  const [playing, setPlaying] = React.useState<string | null>(null)
  const value = React.useMemo(() => ({ playing, setPlaying }), [playing])
  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>
}

export function useGraphicPlayback(slotId: string) {
  const context = React.useContext(PlaybackContext)
  const [local, setLocal] = React.useState(false)
  // Outside a provider (a story, a lone test) each card plays on its own.
  if (!context) return { playing: local, play: () => setLocal(true), stop: () => setLocal(false) }
  return {
    playing: context.playing === slotId,
    play: () => context.setPlaying(slotId),
    stop: () => context.setPlaying(null),
  }
}

export function GraphicPlayback({
  slotId,
  scene,
  code,
  data,
  codeLogos = NO_LOGOS,
  noun = 'graphic',
  brand,
  logoUrls,
  durationMs,
}: {
  slotId: string
  /** A scene composed before decision 295. */
  scene?: GraphicScene
  /** The designer's code (decision 295): played in preference to a scene beside it. */
  code?: GraphicCode
  /** A chart's series, handed to its code as `props.data`. */
  data?: GraphicCodePayload['data']
  /** The library's marks, by title (`codeLogosFor`). */
  codeLogos?: CodeLogos
  /** What the Play button calls the design. */
  noun?: 'graphic' | 'chart'
  brand: BrandKitStored
  /** A scene's marks, by asset id. */
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
}) {
  const { playing, play, stop } = useGraphicPlayback(slotId)
  const [portrait, setPortrait] = React.useState(false)
  // The Player's own state, not the last button pressed: it ends by itself and
  // a remount (Portrait / Landscape) starts it again.
  const [running, setRunning] = React.useState(true)
  // The frame mounts after its chunk loads, so the Player reaches us by callback.
  const [player, setPlayer] = React.useState<PlayerRef | null>(null)

  React.useEffect(() => {
    if (!player) return
    setRunning(player.isPlaying())
    const onPlay = () => setRunning(true)
    const onStopped = () => setRunning(false)
    player.addEventListener('play', onPlay)
    player.addEventListener('pause', onStopped)
    player.addEventListener('ended', onStopped)
    return () => {
      player.removeEventListener('play', onPlay)
      player.removeEventListener('pause', onStopped)
      player.removeEventListener('ended', onStopped)
    }
  }, [player])

  // The code wins over a scene the brief still carries from before a
  // redesign (decision 295), as it does when the timeline is compiled.
  const design: GraphicDesign | null = code
    ? { kind: 'code', code, logos: codeLogos, ...(data ? { data } : {}) }
    : scene
      ? { kind: 'scene', scene }
      : null
  if (!design) return null

  if (!playing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={play}>
          Play {noun}
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <GraphicPlayerFrame
        key={portrait ? 'portrait' : 'landscape'}
        design={design}
        brand={brand}
        logoUrls={logoUrls}
        durationMs={durationMs}
        portrait={portrait}
        onPlayer={setPlayer}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            if (running) player?.pause()
            else player?.play()
          }}
        >
          {running ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            player?.seekTo(0)
            player?.play()
          }}
        >
          Replay
        </Button>
        <Button variant="outline" onClick={() => setPortrait((value) => !value)}>
          {portrait ? 'Landscape' : 'Portrait'}
        </Button>
        <Button variant="ghost" onClick={stop}>
          Close player
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 10: Write the heavy half: the player mounts the code**

Replace the whole of `apps/web/app/(console)/projects/[id]/graphic-player.tsx` with:

```tsx
'use client'

import { GraphicCard, GraphicCode, loadBrandFonts, msToFrames } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import { Player, type PlayerRef } from '@remotion/player'
import * as React from 'react'
import { codePayloadFor, type GraphicDesign } from './graphic-playback'

/**
 * The heavy half of the board's playback (decision 289): the same composition
 * the render mounts, at the slot's own length, so the motion the owner
 * approves is the motion the film shows. A scene plays on `GraphicCard`; a
 * design written as code (decision 295) plays on `GraphicCode`, the code
 * winning over a scene the brief still carries, as it does in the render.
 *
 * `graphic-playback` imports this module through `next/dynamic` (`ssr: false`)
 * and renders it only after Play is pressed, so the player and the composition
 * library are never fetched by a board nobody plays.
 *
 * The player ships with the Vercel deploy while renders use the uploaded
 * Remotion bundle: a composition change must ship with `deploy:remotion` for
 * the two to match.
 */

/** Half of 1080p, as the brand specimen plays: frameScale sizes everything. */
const LANDSCAPE = { width: 960, height: 540 }
const PORTRAIT = { width: 540, height: 960 }
/**
 * The full frames for code (decision 295): the designer's code may size in
 * pixels against the 1080p frame the dry run checked it in, so it plays at
 * that size and the Player scales the frame down to the card.
 */
const CODE_LANDSCAPE = { width: 1920, height: 1080 }
const CODE_PORTRAIT = { width: 1080, height: 1920 }

/**
 * A scene's marks, by element id. The card reads only each logo's URL; the
 * size fields the timeline schema requires are not read by the component, so
 * the board passes 1 by 1.
 */
function sceneLogos(scene: GraphicScene, logoUrls: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    scene.elements.flatMap((element) =>
      element.kind === 'logo' && element.assetId && logoUrls[element.assetId]
        ? [
            [
              element.id,
              {
                r2Key: `logos/${element.assetId}`,
                url: logoUrls[element.assetId]!,
                width: 1,
                height: 1,
              },
            ],
          ]
        : [],
    ),
  )
}

export function GraphicPlayerFrame({
  design,
  brand,
  logoUrls,
  durationMs,
  portrait,
  onPlayer,
}: {
  design: GraphicDesign
  brand: BrandKitStored
  /** A scene's marks, by asset id; a design in code carries its own, by title. */
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
  portrait: boolean
  /** Handed the Player once it is attached, and null when this frame goes away. */
  onPlayer: (player: PlayerRef | null) => void
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    void loadBrandFonts(tokens.typography)
  }, [tokens])
  const playerRef = React.useRef<PlayerRef>(null)
  React.useEffect(() => {
    onPlayer(playerRef.current)
    return () => onPlayer(null)
  }, [onPlayer])
  const durationInFrames = Math.max(1, msToFrames(durationMs, MASTER_FPS))
  const size =
    design.kind === 'code'
      ? portrait
        ? CODE_PORTRAIT
        : CODE_LANDSCAPE
      : portrait
        ? PORTRAIT
        : LANDSCAPE
  return (
    <div
      role="region"
      aria-label="Graphic playback"
      className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
    >
      {design.kind === 'code' ? (
        <Player
          ref={playerRef}
          component={GraphicCode}
          inputProps={{
            payload: codePayloadFor(design.code, design.logos, design.data),
            brand: tokens,
            durationInFrames,
          }}
          durationInFrames={durationInFrames}
          fps={MASTER_FPS}
          compositionWidth={size.width}
          compositionHeight={size.height}
          autoPlay
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      ) : (
        <Player
          ref={playerRef}
          component={GraphicCard}
          inputProps={{
            payload: {
              kind: 'graphic',
              scene: design.scene,
              logos: sceneLogos(design.scene, logoUrls),
              claimIds: [],
            },
            brand: tokens,
            durationInFrames,
          }}
          durationInFrames={durationInFrames}
          fps={MASTER_FPS}
          compositionWidth={size.width}
          compositionHeight={size.height}
          autoPlay
          acknowledgeRemotionLicense
          style={{ width: '100%' }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 11: Run the player tests, the board's and the type check**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/graphic-player.test.tsx"`
Expected: PASS, all twelve tests (the eight older ones unchanged: a scene still plays at 960x540 with `logos:l1`).

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: PASS. The board still hands `GraphicPlayback` a `scene`, which it still takes.

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: exits 0.

- [ ] **Step 12: Commit**

```bash
pnpm exec prettier --write "apps/web/app/(console)/projects/[id]/graphic-playback.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.test.tsx"
git add "apps/web/app/(console)/projects/[id]/graphic-playback.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.test.tsx"
git commit -m "$(cat <<'EOF'
feat(board): the player plays a design in code on GraphicCode (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 13: Confirm the barrel exports what the still imports**

Run: `git grep -n -e "withAlpha" -e "safeInsets" -e "graphicPropsFor" -e "buildGraphic" -- packages/compositions/src/index.ts`
Expected: each name in the block Task 2 (Step 14) added, re-exported from `./lib/graphic-code`. If a name is missing, Task 2 was not finished: stop and report it rather than adding an export here (ruling 13 gives the barrel's list to Task 2).

- [ ] **Step 14: Write the failing still tests**

Create `apps/web/app/(console)/projects/[id]/graphic-code-still.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type * as Compositions from '@boom-busters/compositions'
import { GRAPHIC_CODE_SOURCE } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'
import type { GraphicCode } from '@boom-busters/schemas'
import { GraphicCodeStill } from './graphic-code-still'

/**
 * The board's still of a design written as code (decision 295): the real
 * sandbox (`buildGraphic`, `graphicPropsFor`) over the still's own one-frame
 * scope. Only the font loader is stubbed: jsdom has no fonts to fetch.
 */
vi.mock('@boom-busters/compositions', async (importOriginal) => ({
  ...(await importOriginal<typeof Compositions>()),
  loadBrandFonts: () => Promise.resolve(),
}))

const BRAND = DEFAULT_SETTINGS.brandKit

/** Plain JS, so each source is its own compiled form. */
const code = (source: string, overrides: Partial<GraphicCode> = {}): GraphicCode => ({
  version: 1,
  source,
  compiled: source,
  title: 'Four billion, counted up',
  facts: [],
  words: [
    { text: 'Four', atMs: 300 },
    { text: 'billion', atMs: 700 },
  ],
  durationMs: 6000,
  ...overrides,
})

/** Writes out what the scope hands the code, so each part can be asserted. */
const PROBE = [
  'function Stamp(props) {',
  '  return React.createElement("span", null, props.label + " " + Remotion.useCurrentFrame())',
  '}',
  'function Graphic(props) {',
  '  const frame = Remotion.useCurrentFrame()',
  '  const video = Remotion.useVideoConfig()',
  '  const acme = props.logos["Acme"]',
  '  return React.createElement(',
  '    Remotion.AbsoluteFill,',
  '    { style: { background: Remotion.withAlpha(props.brand.colors.background, 0.5) } },',
  '    React.createElement("p", null, "at " + frame + " of " + video.durationInFrames + " in " + video.width + "x" + video.height + " at " + video.fps),',
  '    React.createElement(Remotion.Sequence, { from: 100 }, React.createElement(Stamp, { label: "inside" })),',
  '    React.createElement(Remotion.Sequence, { from: 150 }, React.createElement(Stamp, { label: "later" })),',
  '    React.createElement(Remotion.Sequence, { from: 0, durationInFrames: 50 }, React.createElement(Stamp, { label: "over" })),',
  '    acme ? React.createElement(Remotion.Img, { src: acme.src }) : null,',
  '    props.data ? React.createElement("p", null, props.data.takeaway) : null,',
  '  )',
  '}',
].join('\n')

const ACME = { Acme: { assetId: 'A1', url: 'https://r2.example/acme.png', width: 400, height: 200 } }

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GraphicCodeStill (decision 295)', () => {
  it('draws the code 60% of the way through, in the 1080p frame, at a quarter size', () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} />)
    // 6 s at 30 fps is 180 frames; 60% of the way through is frame 108.
    expect(screen.getByText('at 108 of 180 in 1920x1080 at 30')).toBeInTheDocument()
    expect(
      screen.getByRole('img', { name: 'Graphic still: Four billion, counted up' }),
    ).toHaveStyle({ width: '480px', height: '270px' })
  })

  it('draws the portrait frame when asked', () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} portrait />)
    expect(screen.getByText('at 108 of 180 in 1080x1920 at 30')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Graphic still:/ })).toHaveStyle({
      width: '270px',
      height: '480px',
    })
  })

  it("counts a Sequence's frames from its start, and shows it only inside its window", () => {
    render(<GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={{}} />)
    expect(screen.getByText('inside 8')).toBeInTheDocument()
    expect(screen.queryByText(/^later/)).toBeNull()
    expect(screen.queryByText(/^over/)).toBeNull()
  })

  it("hands the code the library's marks, by title, and a chart its data", () => {
    const data = {
      series: [
        {
          label: 'Share price',
          unit: 'EUR',
          points: [
            { x: '2020-06-17', y: 104.5 },
            { x: '2020-06-26', y: 1.28 },
          ],
        },
      ],
      takeaway: 'From €104 to €1.28 in nine days.',
    }
    const { container } = render(
      <GraphicCodeStill code={code(PROBE)} brand={BRAND} logos={ACME} data={data} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://r2.example/acme.png')
    expect(screen.getByText('From €104 to €1.28 in nine days.')).toBeInTheDocument()
  })

  it('draws the fixture the composition renders, without falling back to its title', () => {
    render(
      <GraphicCodeStill
        code={code(GRAPHIC_CODE_SOURCE, { title: 'The fixture' })}
        brand={BRAND}
        logos={{}}
      />,
    )
    expect(screen.queryByText('The fixture')).toBeNull()
    const still = screen.getByRole('img', { name: 'Graphic still: The fixture' })
    expect(still.textContent?.trim()).not.toBe('')
  })

  it('shows the title when the code throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <GraphicCodeStill
        code={code('function Graphic() { throw new Error("boom") }')}
        brand={BRAND}
        logos={{}}
      />,
    )
    expect(screen.getByText('Four billion, counted up')).toBeInTheDocument()
  })

  it('shows the title when the code does not even build', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<GraphicCodeStill code={code('function Graphic( {')} brand={BRAND} logos={{}} />)
    expect(screen.getByText('Four billion, counted up')).toBeInTheDocument()
  })
})
```

- [ ] **Step 15: Run them and watch them fail**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/graphic-code-still.test.tsx"`
Expected: FAIL at suite level with `Failed to resolve import "./graphic-code-still"`.

- [ ] **Step 16: Write the still**

Create `apps/web/app/(console)/projects/[id]/graphic-code-still.tsx`:

```tsx
'use client'

import {
  buildGraphic,
  graphicPropsFor,
  loadBrandFonts,
  msToFrames,
  withAlpha,
  type GraphicProps,
  type GraphicScope,
} from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicCode, GraphicCodePayload } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import * as React from 'react'
import { Easing, interpolate, spring } from 'remotion'
import { codePayloadFor, type CodeLogos } from './graphic-playback'

/**
 * The board's still of a graphic or chart the designer wrote as code
 * (decision 295), in place of the SVG preview a scene gets: the designer's own
 * component, built by the sandbox the render uses (`buildGraphic`), drawn at
 * one moment, 60% of the way through, where the build is usually done and the
 * ending not yet begun.
 *
 * There is no Player here, so the Remotion half of the sandbox is a scope of
 * our own that holds that one frame: `useCurrentFrame` reads it, a `Sequence`
 * shows its children only inside its window and counts their frames from its
 * start, as Remotion's does, and `interpolate`, `spring` and `Easing` are
 * Remotion's own pure functions. The frame is laid out at its full 1920 by
 * 1080 (or 1080 by 1920) and scaled to a quarter, so every size the code chose
 * is the size the render draws at.
 *
 * Code that throws, or does not build, shows the title on the brand's
 * background, as the composition's own boundary does, so one bad design never
 * takes the board down. The board loads this module in the browser only
 * (`GraphicCodePreview` in `slot-previews.tsx`).
 */

const LANDSCAPE = { width: 1920, height: 1080 }
const PORTRAIT = { width: 1080, height: 1920 }
/** A quarter of the frame: 480 by 270 on the card. */
const STILL_SCALE = 0.25
/** How far through the graphic the still is taken. */
export const STILL_AT = 0.6

/** The frame the code sees, shifted inside a Sequence as Remotion shifts it. */
const StillFrame = React.createContext(0)

function useStillFrame(): number {
  return React.useContext(StillFrame)
}

/** Remotion's AbsoluteFill: the whole frame, its children in a flex column. */
function StillFill({ style, children }: { style?: React.CSSProperties; children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/**
 * Remotion's Sequence at one frame: nothing outside its window, and inside it
 * the children count from its start, laid out in a fill of their own.
 */
function StillSequence({
  from = 0,
  durationInFrames = Infinity,
  children,
}: {
  from?: number
  durationInFrames?: number
  children?: React.ReactNode
}) {
  const frame = useStillFrame()
  if (frame < from || frame >= from + durationInFrames) return null
  return (
    <StillFrame.Provider value={frame - from}>
      <StillFill>{children}</StillFill>
    </StillFrame.Provider>
  )
}

/** A plain `img`: the board has no frames to hold for a picture. */
function StillImg({ src, style }: { src: string; style?: React.CSSProperties }) {
  return <img src={src} alt="" style={style} />
}

/** The sandbox's Remotion argument for a still of one frame size. */
export function stillScope(
  size: { width: number; height: number },
  durationInFrames: number,
): GraphicScope {
  return {
    useCurrentFrame: useStillFrame,
    useVideoConfig: () => ({
      width: size.width,
      height: size.height,
      fps: MASTER_FPS,
      durationInFrames,
    }),
    interpolate,
    spring,
    Easing,
    Sequence: StillSequence,
    AbsoluteFill: StillFill,
    Img: StillImg,
    withAlpha,
  }
}

/** Code that throws, or does not build, shows the fallback instead. */
class StillBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** The designer's component, built once per compiled source and scope. */
function StillGraphic({
  compiled,
  scope,
  props,
}: {
  compiled: string
  scope: GraphicScope
  props: GraphicProps
}) {
  const Graphic = React.useMemo(() => buildGraphic(compiled, scope), [compiled, scope])
  return <Graphic {...props} />
}

export function GraphicCodeStill({
  code,
  brand,
  logos,
  data,
  portrait = false,
}: {
  code: GraphicCode
  brand: BrandKitStored
  /** The library's marks, by title (`codeLogosFor`). */
  logos: CodeLogos
  /** A chart's series, handed to its code as `props.data`. */
  data?: GraphicCodePayload['data']
  portrait?: boolean
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    // The same guarded call the post card makes: a family the catalogue does
    // not bundle throws, and the still draws in the fallback face.
    try {
      void loadBrandFonts(tokens.typography).catch(() => undefined)
    } catch {
      // The Brand Kit screen is where a bad family is fixed.
    }
  }, [tokens])

  const size = portrait ? PORTRAIT : LANDSCAPE
  const durationInFrames = Math.max(1, msToFrames(code.durationMs, MASTER_FPS))
  const frame = Math.min(durationInFrames - 1, msToFrames(code.durationMs * STILL_AT, MASTER_FPS))
  const scope = React.useMemo(() => stillScope(size, durationInFrames), [size, durationInFrames])
  const props = graphicPropsFor(codePayloadFor(code, logos, data), tokens, size)
  const fallback = (
    <div
      className="flex h-full w-full items-center justify-center p-4 text-center text-[15px]"
      style={{ background: tokens.colors.background, color: tokens.colors.textPrimary }}
    >
      {code.title}
    </div>
  )

  return (
    <div
      role="img"
      aria-label={`Graphic still: ${code.title}`}
      className="relative max-w-full overflow-hidden rounded-[8px] border border-[var(--color-border)]"
      style={{ width: size.width * STILL_SCALE, height: size.height * STILL_SCALE }}
    >
      {/* Keyed on the code, so a redesign that lands gets a fresh boundary. */}
      <StillBoundary key={code.compiled} fallback={fallback}>
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size.width,
            height: size.height,
            transform: `scale(${STILL_SCALE})`,
            transformOrigin: '0 0',
            overflow: 'hidden',
            background: tokens.colors.background,
            color: tokens.colors.textPrimary,
            fontFamily: `"${tokens.typography.body.family}", sans-serif`,
          }}
        >
          <StillFrame.Provider value={frame}>
            <StillGraphic compiled={code.compiled} scope={scope} props={props} />
          </StillFrame.Provider>
        </div>
      </StillBoundary>
    </div>
  )
}
```

- [ ] **Step 17: Run the still tests and the type checks**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/graphic-code-still.test.tsx"`
Expected: PASS, all seven tests (the two throwing ones print nothing, `console.error` is stubbed).

Run: `pnpm --filter @boom-busters/compositions typecheck`
Expected: exits 0.

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: exits 0.

- [ ] **Step 18: Commit**

```bash
pnpm exec prettier --write "apps/web/app/(console)/projects/[id]/graphic-code-still.tsx" "apps/web/app/(console)/projects/[id]/graphic-code-still.test.tsx"
git add "apps/web/app/(console)/projects/[id]/graphic-code-still.tsx" "apps/web/app/(console)/projects/[id]/graphic-code-still.test.tsx"
git commit -m "$(cat <<'EOF'
feat(board): a still of a design in code, drawn by its own component (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 19: Write the failing board tests**

In `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, replace the `./graphic-player` mock with:

```tsx
/** The real player is graphic-player.test's; the board only has to mount a frame with a design. */
vi.mock('./graphic-player', () => ({
  GraphicPlayerFrame: ({ design }: { design: { kind: string } }) => (
    <div data-testid="player-frame" data-design={design.kind} />
  ),
}))

/** The still is graphic-code-still.test's; here the board only has to hand it the design. */
const stillProps = vi.hoisted(() => vi.fn())
vi.mock('./graphic-code-still', () => ({
  GraphicCodeStill: (props: Record<string, unknown>) => {
    stillProps(props)
    return <div data-testid="graphic-code-still" />
  },
}))
```

Insert this `describe` directly after the `describe('the graphic card (decision 289)', ...)` block:

```tsx
describe('a design written as code (decision 295)', () => {
  /** Plain JS, so the source is its own compiled form. */
  const CODE_SOURCE =
    "function Graphic(props) { return React.createElement('p', null, props.logos['Acme'] ? 'Acme' : 'none') }"
  const CODE = {
    version: 1 as const,
    source: CODE_SOURCE,
    compiled: CODE_SOURCE,
    title: 'Four billion, counted up',
    facts: [{ text: '4', claimId: CLAIM }],
    words: [{ text: 'four', atMs: 300 }],
    durationMs: 6000,
  }
  const { scene: _scene, ...unscened } = graphicSlot.brief as Record<string, unknown>
  const codedGraphic = {
    ...graphicSlot,
    status: 'resolved',
    brief: { ...unscened, intent: 'Four billion is the story.', code: CODE },
  } as SlotView
  const codedChart = {
    ...chartSlot,
    brief: { ...chartSlot.brief!, code: { ...CODE, title: 'The fall, in nine days' } },
  } as SlotView
  const chartSeries = (chartSlot.brief as Extract<ShotBrief, { type: 'chart' }>).series

  it('shows a coded graphic by its title and its own still, with Play and no SVG preview', async () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([codedGraphic])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(screen.getByText('Four billion, counted up')).toBeInTheDocument()
    expect(await screen.findByTestId('graphic-code-still')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play graphic' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redesign graphic' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^graphic:/ })).toBeNull()
    expect(screen.queryByText(/Being designed/)).toBeNull()
    // The chips are the claims the code's facts cite.
    expect(screen.getByTitle(CLAIM)).toHaveTextContent('claim 1')
  })

  it('hands the still every mark in the library, keyed by title, whatever the code reads (ruling 5)', async () => {
    const slot = {
      ...codedGraphic,
      logoUrls: { A1: 'https://r2.example/acme.png', A2: 'https://r2.example/globex.png' },
      logoMarks: {
        A1: { title: 'Acme', width: 400, height: 200 },
        A2: { title: 'Globex', width: 300, height: 300 },
      },
    } as SlotView
    render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
    await screen.findByTestId('graphic-code-still')
    // The code reads only Acme; it is handed Globex too, as the dry run and the render hand it.
    expect(stillProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        code: CODE,
        logos: {
          Acme: { assetId: 'A1', url: 'https://r2.example/acme.png', width: 400, height: 200 },
          Globex: { assetId: 'A2', url: 'https://r2.example/globex.png', width: 300, height: 300 },
        },
      }),
    )
  })

  it('plays the code when the brief still carries the scene it replaced', async () => {
    const slot = {
      ...graphicSlot,
      brief: { ...graphicSlot.brief!, code: CODE },
    } as SlotView
    render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
    expect(screen.queryByRole('img', { name: /^graphic:/ })).toBeNull()
    // The old scene's missing mark is not asked for: the code draws the card now.
    expect(screen.queryByRole('button', { name: /^Add logo for/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(await screen.findByTestId('player-frame')).toHaveAttribute('data-design', 'code')
  })

  it('shows a coded chart by its title and still, with Play chart and Redesign chart', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([codedChart])} colors={COLORS} brand={BRAND} />,
    )
    expect(screen.getByText('The fall, in nine days')).toBeInTheDocument()
    expect(await screen.findByTestId('graphic-code-still')).toBeInTheDocument()
    expect(stillProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { series: chartSeries, takeaway: 'From €104 to €1.28 in nine days.' },
      }),
    )
    expect(screen.queryByRole('img', { name: /line chart/ })).toBeNull()
    expect(screen.getByText('From €104 to €1.28 in nine days.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Redesign chart' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draft a different brief' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play chart' }))
    expect(await screen.findByTestId('player-frame')).toHaveAttribute('data-design', 'code')
  })

  it('says why a chart was not designed, and keeps the chart it renders', () => {
    const slot = {
      ...chartSlot,
      brief: { ...chartSlot.brief!, designIssue: 'no claim holds 7bn' },
    } as SlotView
    render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
    expect(screen.getByText('Not designed: no claim holds 7bn')).toBeInTheDocument()
    // Persistent state, not an event: nothing announces it on load.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('img', { name: /line chart/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play chart' })).toBeNull()
  })

  it('redesigns a chart from its own form', async () => {
    render(
      <VisualBoard projectId={PROJECT} model={model([chartSlot])} colors={COLORS} brand={BRAND} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Redesign chart' }))
    expect(screen.getByLabelText('What should change? (optional)')).toBeInTheDocument()
    expect(
      screen.getByText(
        "The designer starts from this chart's data and its current design, if it has one. The steer is used once and not kept.",
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Redesign it' }))
    expect(rebriefSlotAction).toHaveBeenCalledWith(PROJECT, chartSlot.id, '')
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Redesigning: this card updates when it lands' }),
    )
  })

  it('words a running chart redesign as a design', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([{ ...chartSlot, retype: { state: 'rebriefing' } }])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(
      screen.getByText('Claude is redesigning this chart. This card updates when it lands.'),
    ).toBeInTheDocument()
  })

  it('words a refused chart redesign as a design, and says the chart keeps its own', () => {
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([
          { ...chartSlot, retype: { state: 'rebrief-refused', reason: 'no claim holds 7bn' } },
        ])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    expect(
      screen.getByText('No new design: no claim holds 7bn The chart keeps the one it has.'),
    ).toBeInTheDocument()
  })
})
```

`chartSeries` needs the brief type: change the file's `import type { Notice } from '@boom-busters/schemas'` to:

```tsx
import type { Notice, ShotBrief } from '@boom-busters/schemas'
```

- [ ] **Step 20: Run them and watch them fail**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: FAIL, the eight new tests: the two coded-graphic tests and the coded-chart test with `Unable to find an element with the text: Four billion, counted up` (or `The fall, in nine days`) or a `findByTestId('graphic-code-still')` timeout; the scene-and-code test finding the SVG preview; the designIssue test with `Unable to find an element with the text: Not designed: no claim holds 7bn`; the form test with `Unable to find an accessible element with the role "button" and name "Redesign chart"`; the two wording tests finding "Claude is drafting a new brief" and "No new brief" instead. Every older test passes.

- [ ] **Step 21: The lazy still in the previews module**

In `apps/web/app/(console)/projects/[id]/slot-previews.tsx`:

Add, directly after `import * as React from 'react'`:

```tsx
import dynamic from 'next/dynamic'
```

Replace:

```tsx
/** A graphic the designer has composed: the only kind the preview can draw. */
export type DesignedGraphicBrief = GraphicBrief & { scene: GraphicScene }
```

with:

```tsx
/** A graphic composed as a scene (decision 268): the kind the SVG preview draws. */
export type DesignedGraphicBrief = GraphicBrief & { scene: GraphicScene }

/**
 * A graphic or chart the designer wrote as code (decision 295): drawn by its
 * own component at one moment (`graphic-code-still.tsx`), in place of the SVG
 * preview a scene gets. Loaded in the browser only: the designer's code runs
 * in the owner's browser and on Lambda, never in the server process that
 * renders this page and holds the app's secrets. Until the module lands, a box
 * the still's size keeps the card from jumping.
 */
export const GraphicCodePreview = dynamic(
  () => import('./graphic-code-still').then((module) => module.GraphicCodeStill),
  {
    ssr: false,
    loading: () => (
      <div
        aria-hidden
        className="h-[270px] w-[480px] max-w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)]"
      />
    ),
  },
)
```

- [ ] **Step 22: The graphic card plays and previews the code**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`:

Replace the `./graphic-playback` import with:

```tsx
import {
  codeLogosFor,
  GraphicPlayback,
  GraphicPlaybackProvider,
  useGraphicPlayback,
  type CodeLogos,
} from './graphic-playback'
```

Add `GraphicCodePreview` to the `./slot-previews` import, after `ChartPreview`:

```tsx
  ChartPreview,
  GraphicCodePreview,
  GraphicPreview,
```

Add `GraphicCodePayload` to the schemas type import, after `BrandKitStored`:

```tsx
  BrandKitStored,
  GraphicCodePayload,
  GraphicElement,
```

Replace the whole `GraphicSlot` function and the doc comment above it with:

```tsx
/**
 * The graphic card (decision 268, Plan B): the same preview the board shows
 * beside a headline card, the claim chips over what the scene cites, and one
 * `Add logo for <entity>` button per mark the library does not yet hold.
 * Resolution, flipping the slot to resolved once every mark is found, is
 * `attachGraphicLogosAction`'s job (Task 9); this card only calls it.
 *
 * A graphic the designer wrote as code (decision 295) shows its title, a still
 * of its own component and Play instead, and its chips are the claims its
 * facts cite. The code wins over a scene the brief still carries from before a
 * redesign, as it does in the render.
 */
function GraphicSlot({
  slot,
  brief,
  projectId,
  act,
  brand,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'graphic' }>
  projectId: string
  act: Act
  brand: BrandKitStored
}) {
  const scene = brief.scene
  const code = brief.code
  const { intent } = graphicIntentOf(brief)
  // Play swaps the thumbnail for the player; it comes back on Close.
  const { playing } = useGraphicPlayback(slot.id)
  // While a redesign or a retype's design runs, the format row's own line is
  // the one that announces.
  const redesigning = slot.retype?.state === 'rebriefing' || slot.retype?.state === 'drafting'
  const claimIds = code
    ? [...new Set(code.facts.map((fact) => fact.claimId))]
    : scene
      ? graphicSceneClaimIds(scene)
      : (brief.intentClaimIds ?? [])
  // An `assetId` alone is not proof the mark is still there: the library row
  // it names can have been deleted since this brief was resolved. The board
  // offers the same repair either way, keyed off whether the preview can
  // actually draw it, not off whether the brief once thought it could. Code
  // names its marks by title and has no logo element to repair.
  const missingLogos: Extract<GraphicElement, { kind: 'logo' }>[] = code
    ? []
    : (scene?.elements ?? []).filter(
        (element): element is Extract<GraphicElement, { kind: 'logo' }> =>
          element.kind === 'logo' &&
          (element.assetId === undefined || slot.logoUrls[element.assetId] === undefined),
      )
  const codeLogos: CodeLogos = code ? codeLogosFor(slot.logoUrls, slot.logoMarks) : {}

  return (
    <div className="flex flex-col gap-2">
      {code ? (
        <>
          <p className="text-[13px] text-[var(--color-text-primary)]">{code.title}</p>
          {playing ? null : <GraphicCodePreview code={code} brand={brand} logos={codeLogos} />}
        </>
      ) : scene ? (
        playing ? null : (
          <>
            <GraphicPreview brief={{ ...brief, scene }} brand={brand} logoUrls={slot.logoUrls} />
            <GraphicSteps brief={{ ...brief, scene }} brand={brand} logoUrls={slot.logoUrls} />
          </>
        )
      ) : redesigning ? null : brief.designIssue ? (
        // Persistent state, not an event: no role, so a board of undesigned
        // graphics does not announce assertively on load.
        <p className="text-[13px] text-[var(--color-warning)]">Not designed: {brief.designIssue}</p>
      ) : (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
          Being designed. This card updates when it lands.
        </p>
      )}
      {code || scene ? (
        <GraphicPlayback
          slotId={slot.id}
          scene={scene}
          code={code}
          codeLogos={codeLogos}
          brand={brand}
          logoUrls={slot.logoUrls}
          durationMs={slot.durationMs}
        />
      ) : null}
      <p className="text-[12px] text-[var(--color-text-secondary)]">Intent: {intent}</p>
      {claimIds.length > 0 ? (
        <div className="flex flex-wrap gap-1" aria-label="Source claims">
          {claimIds.map((claimId, index) => (
            <span
              key={claimId}
              title={claimId}
              className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
            >
              claim {index + 1}
            </span>
          ))}
        </div>
      ) : null}
      {missingLogos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {missingLogos.map((element) => (
            <GraphicLogoUploader
              key={element.id}
              entity={element.entity}
              projectId={projectId}
              slotId={slot.id}
              act={act}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** What a chart's code is handed as `props.data` (decision 295), as the timeline carries it. */
function chartDataOf(
  brief: Extract<ShotBrief, { type: 'chart' }>,
): NonNullable<GraphicCodePayload['data']> {
  return {
    series: brief.series,
    takeaway: brief.takeaway,
    ...(brief.annotations ? { annotations: brief.annotations } : {}),
  }
}

/**
 * The chart card. A chart the designer wrote as code (decision 295) shows its
 * title, a still of its own component and Play chart, as a graphic card does;
 * a chart with no code keeps the SVG of the reveal it renders with, and says
 * why when the designer could not write one.
 */
function ChartSlot({
  slot,
  brief,
  brand,
  colors,
}: {
  slot: SlotView
  brief: Extract<ShotBrief, { type: 'chart' }>
  brand: BrandKitStored
  colors: BrandChartColors
}) {
  const code = brief.code
  // Play swaps the still for the player; it comes back on Close.
  const { playing } = useGraphicPlayback(slot.id)
  // While a redesign runs, the format row's own line is the one that announces.
  const redesigning = slot.retype?.state === 'rebriefing' || slot.retype?.state === 'drafting'
  const data = chartDataOf(brief)
  const codeLogos: CodeLogos = code ? codeLogosFor(slot.logoUrls, slot.logoMarks) : {}

  return (
    <div className="flex flex-col gap-2">
      {code ? <p className="text-[13px] text-[var(--color-text-primary)]">{code.title}</p> : null}
      {playing ? null : code ? (
        <GraphicCodePreview code={code} brand={brand} logos={codeLogos} data={data} />
      ) : (
        <ChartPreview brief={brief} colors={colors} />
      )}
      {!code && !redesigning && brief.designIssue ? (
        // Persistent state, as on a graphic: nothing announces it on load.
        <p className="text-[13px] text-[var(--color-warning)]">Not designed: {brief.designIssue}</p>
      ) : null}
      {code ? (
        <GraphicPlayback
          slotId={slot.id}
          code={code}
          data={data}
          codeLogos={codeLogos}
          noun="chart"
          brand={brand}
          logoUrls={slot.logoUrls}
          durationMs={slot.durationMs}
        />
      ) : null}
      <p className="text-[12px] text-[var(--color-text-secondary)]">{brief.takeaway}</p>
      <div className="flex flex-wrap gap-1" aria-label="Source claims">
        {brief.dataRefs.map((claimId, index) => (
          <span
            key={claimId}
            title={claimId}
            className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
          >
            claim {index + 1}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * What the slot's Redesign button and form call its design (decisions 289
 * and 295): a graphic or a chart is redesigned, every other brief is drafted
 * again.
 */
function designNoun(brief: ShotBrief | null): 'graphic' | 'chart' | null {
  return brief?.type === 'graphic' || brief?.type === 'chart' ? brief.type : null
}
```

- [ ] **Step 23: The slot card wires the chart card, the label and the form**

Still in `visual-board.tsx`, in `SlotCard`:

Replace:

```tsx
  // A graphic with no scene says so on its own card, not in the generic lines.
  const undesignedGraphic = brief?.type === 'graphic' && brief.scene === undefined
```

with:

```tsx
  // A graphic with no design yet says so on its own card, not in the generic lines.
  const undesignedGraphic =
    brief?.type === 'graphic' && brief.scene === undefined && brief.code === undefined
  // A graphic or a chart is redesigned rather than re-briefed (decision 295).
  const design = designNoun(brief)
```

Replace the chart branch of the type-specific middle:

```tsx
        ) : brief?.type === 'chart' ? (
          <div className="flex flex-col gap-2">
            <ChartPreview brief={brief} colors={colors} />
            <p className="text-[12px] text-[var(--color-text-secondary)]">{brief.takeaway}</p>
            <div className="flex flex-wrap gap-1" aria-label="Source claims">
              {brief.dataRefs.map((claimId, index) => (
                <span
                  key={claimId}
                  title={claimId}
                  className="rounded-full border border-[var(--color-border-strong)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-text-secondary)]"
                >
                  claim {index + 1}
                </span>
              ))}
            </div>
          </div>
        ) : brief?.type === 'map' ? (
```

with:

```tsx
        ) : brief?.type === 'chart' ? (
          <ChartSlot slot={slot} brief={brief} brand={brand} colors={colors} />
        ) : brief?.type === 'map' ? (
```

Replace the Redesign button's label:

```tsx
                    {rebriefing
                      ? 'Close'
                      : brief.type === 'graphic'
                        ? 'Redesign graphic'
                        : 'Draft a different brief'}
```

with:

```tsx
                    {rebriefing
                      ? 'Close'
                      : design
                        ? `Redesign ${design}`
                        : 'Draft a different brief'}
```

Replace the form's mount:

```tsx
          <RebriefForm
            slot={slot}
            projectId={projectId}
            act={act}
            graphic={brief.type === 'graphic'}
            onDone={() => setRebriefing(false)}
          />
```

with:

```tsx
          <RebriefForm
            slot={slot}
            projectId={projectId}
            act={act}
            design={design}
            onDone={() => setRebriefing(false)}
          />
```

- [ ] **Step 24: The form and the format row word a chart's redesign as a design**

Still in `visual-board.tsx`, in `RebriefForm`, replace the `graphic` prop's declaration and every use:

```tsx
  /** A graphic is redesigned from its intent and current design (decision 289). */
  graphic: boolean
```

becomes:

```tsx
  /**
   * A graphic or a chart is redesigned, not re-briefed (decisions 289 and
   * 295): the designer starts from what it must say and its current design.
   */
  design: 'graphic' | 'chart' | null
```

the destructured `graphic,` in the parameter list becomes `design,`, and the body from `<form` to `</form>` becomes:

```tsx
    <form
      className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void act(
          slot.id,
          () => rebriefSlotAction(projectId, slot.id, guidance),
          design
            ? 'Redesigning: this card updates when it lands'
            : 'Drafting a new brief — this card updates when it lands',
          'rebrief',
        ).then((result) => {
          if (result.ok) onDone()
        })
      }}
    >
      <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
        {design ? 'What should change? (optional)' : 'What are you picturing? (optional)'}
        <textarea
          value={guidance}
          onChange={(event) => setGuidance(event.target.value)}
          rows={2}
          maxLength={600}
          placeholder={
            design
              ? 'Leave this empty to just ask for a different design.'
              : 'Leave this empty to just ask for a different idea.'
          }
          className="rounded-[8px] border border-[var(--color-border-strong)] bg-[var(--color-background)] p-2 text-[13px] text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)]"
        />
      </label>
      <p className="text-[12px] text-[var(--color-text-muted)]">
        {design === 'graphic' ? (
          "The designer starts from this graphic's intent and current design. The steer is used once and not kept."
        ) : design === 'chart' ? (
          "The designer starts from this chart's data and its current design, if it has one. The steer is used once and not kept."
        ) : (
          <>
            This replaces the brief this slot has. The steer is used once and not kept, so
            re-planning the shot list later will draft this slot again from the Director&rsquo;s
            Book.
          </>
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" busy={pressed === 'rebrief'} disabled={busy}>
          {design ? 'Redesign it' : 'Draft it'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
```

(The em dash in "Drafting a new brief — this card…" is the existing string, unchanged; no new string carries one.)

In `TypePicker`, replace:

```tsx
  // A graphic is redesigned, not re-briefed: the card words it as a design.
  const graphic = slot.brief?.type === 'graphic'
  // A refused redesign of a graphic that was never composed keeps nothing.
  const graphicHasScene = slot.brief?.type === 'graphic' && slot.brief.scene !== undefined
```

with:

```tsx
  // A graphic or a chart is redesigned, not re-briefed (decisions 289 and
  // 295): the card words it as a design.
  const design = designNoun(slot.brief)
  // A refused redesign of a graphic that was never designed keeps nothing. A
  // chart always keeps one: with no code it renders its reveal.
  const graphicHasDesign =
    slot.brief?.type === 'graphic' &&
    (slot.brief.scene !== undefined || slot.brief.code !== undefined)
```

the rebriefing line:

```tsx
          {graphic
            ? 'Claude is redesigning this graphic. This card updates when it lands.'
            : 'Claude is drafting a new brief. This card updates when it lands.'}
```

becomes:

```tsx
          {design
            ? `Claude is redesigning this ${design}. This card updates when it lands.`
            : 'Claude is drafting a new brief. This card updates when it lands.'}
```

and the refused line:

```tsx
            {graphic
              ? graphicHasScene
                ? `No new design: ${rebriefRefused.reason} The graphic keeps the one it has.`
                : `No new design: ${rebriefRefused.reason}`
              : `No new brief: ${rebriefRefused.reason} The slot keeps the one it has.`}
```

becomes:

```tsx
            {design === 'graphic'
              ? graphicHasDesign
                ? `No new design: ${rebriefRefused.reason} The graphic keeps the one it has.`
                : `No new design: ${rebriefRefused.reason}`
              : design === 'chart'
                ? `No new design: ${rebriefRefused.reason} The chart keeps the one it has.`
                : `No new brief: ${rebriefRefused.reason} The slot keeps the one it has.`}
```

- [ ] **Step 25: Run the board's suites**

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/visual-board.test.tsx"`
Expected: PASS, every test, the eight new ones included.

Run: `pnpm --filter @boom-busters/web vitest run "app/(console)/projects/[id]/slot-previews.test.tsx" "app/(console)/projects/[id]/graphic-player.test.tsx" "app/(console)/projects/[id]/graphic-code-still.test.tsx" lib/visuals-review.test.ts`
Expected: PASS, all four files.

- [ ] **Step 26: Type check, lint and format the task's files**

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: exits 0.

Run: `pnpm exec eslint --max-warnings 0 "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/slot-previews.tsx" "apps/web/app/(console)/projects/[id]/graphic-code-still.tsx" "apps/web/app/(console)/projects/[id]/graphic-code-still.test.tsx" "apps/web/app/(console)/projects/[id]/graphic-playback.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.tsx" "apps/web/app/(console)/projects/[id]/graphic-player.test.tsx" apps/web/lib/visuals-review.ts apps/web/lib/visuals-review.test.ts`
Expected: no output, exit 0.

Run: `pnpm exec prettier --write "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/slot-previews.tsx"`
Expected: the three files listed; re-run the board suite once if Prettier changed `visual-board.test.tsx`.

- [ ] **Step 27: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/slot-previews.tsx"
git commit -m "$(cat <<'EOF'
feat(board): a design in code shows its title, its still and Play; a chart is redesigned (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The live loop goes

**Files:**
- Delete: `apps/web/scripts/live-graphic-test.ts`, `apps/web/lib/live-graphic-args.ts`, `apps/web/lib/live-graphic-args.test.ts`, `apps/web/lib/live-graphic-refusal.ts`, `apps/web/lib/live-graphic-refusal.test.ts`, `apps/web/lib/live-graphic-still.ts`, `apps/web/lib/live-graphic-still.test.ts`, `packages/compositions/scripts/render-graphic-frames.ts`, `packages/compositions/scripts/graphic-frames/Root.tsx`, `packages/compositions/scripts/graphic-frames/entry.ts`, `packages/compositions/scripts/graphic-frames/frame-times.ts`, `packages/compositions/scripts/graphic-frames/frame-times.test.ts`
- Modify: `apps/web/package.json` (`live:graphic`), `packages/compositions/package.json` (`render:graphics`), root `package.json` (`render:graphics`)

**When this runs.** Between Task 4 and Task 5 (the header's execution order: 1, 2, 3, 4, 8, 5): the harness reads `result.scene`, which Task 5 removes. In that window the web package's typecheck is red with exactly Task 4's known errors, in `apps/web/lib/graphic-design-core.ts` and `apps/web/lib/graphic-design.ts`. This task does not edit those two files or `graphic-design.test.ts`: Task 5 replaces all three whole, right after, and its text already carries the harness-free comments, the describe title `'designGraphicWith (the model call is injected)'` and a `loadGraphicContext` without the `database` parameter.

What goes with the two scripts, read from the code: the harness alone imports `apps/web/lib/live-graphic-args.ts`, `live-graphic-refusal.ts` and `live-graphic-still.ts` (each with a test), and the frame renderer alone bundles `packages/compositions/scripts/graphic-frames/` (`Root.tsx`, `entry.ts`, `frame-times.ts`, `frame-times.test.ts`). `apps/web/lib/live-budget.ts`, `answer.ts`'s injected call and `answer-call.ts` stay: `live:set` and `live:plan` use them, and their comments saying "live harness" mean those harnesses. The `.gitignore` entry for `live-graphic-runs/` stays, so the saved runs (kept as a record) never reach git. `loadGraphicContext`'s `database` parameter was there for the harness, which in fact called `loadGraphicContextFrom` directly; no caller passes it, so Task 5's rewrite drops it. `slotNarration` stays exported: the designer uses it.

Every command runs in the foreground with the Bash tool's `timeout` parameter set to 600000.

- [ ] **Step 1: Confirm nothing else reaches the harness**

Run: `git grep -n "live-graphic\|render-graphic-frames\|graphic-frames/\|live:graphic\|render:graphics\|stillOf\|refusalReasonOf\|parseLiveGraphicArgs\|framesToRender" -- . ':!docs' ':!PROGRESS.md'`
Expected: hits only in the files this task deletes, in the three `package.json` script lines, in `.gitignore` (the `live-graphic-runs/` entry) and in `apps/web/lib/graphic-design-core.ts`'s opening comment (Task 5 replaces that file). Any other hit is a caller this task did not foresee: stop and report it.

- [ ] **Step 2: Delete the scripts, their helpers and their tests**

```bash
git rm apps/web/scripts/live-graphic-test.ts \
  apps/web/lib/live-graphic-args.ts apps/web/lib/live-graphic-args.test.ts \
  apps/web/lib/live-graphic-refusal.ts apps/web/lib/live-graphic-refusal.test.ts \
  apps/web/lib/live-graphic-still.ts apps/web/lib/live-graphic-still.test.ts \
  packages/compositions/scripts/render-graphic-frames.ts \
  packages/compositions/scripts/graphic-frames/Root.tsx \
  packages/compositions/scripts/graphic-frames/entry.ts \
  packages/compositions/scripts/graphic-frames/frame-times.ts \
  packages/compositions/scripts/graphic-frames/frame-times.test.ts
```

Expected: twelve `rm '...'` lines.

- [ ] **Step 3: Drop the three script entries**

In `apps/web/package.json`, delete the line:

```json
    "live:graphic": "tsx --env-file=../../.env.local scripts/live-graphic-test.ts",
```

In `packages/compositions/package.json`, replace:

```json
    "render:timeline": "tsx scripts/render-timeline.ts",
    "render:graphics": "tsx scripts/render-graphic-frames.ts"
```

with:

```json
    "render:timeline": "tsx scripts/render-timeline.ts"
```

In the root `package.json`, delete the line:

```json
    "render:graphics": "pnpm --filter @boom-busters/compositions render:graphics",
```

No lockfile change: only scripts moved.

- [ ] **Step 4: Confirm the harness's own files and scripts are gone**

Run: `git grep -n "live-graphic\|live:graphic\|render:graphics\|render-graphic-frames\|graphic-frames/" -- apps packages package.json`
Expected: one hit only, in `apps/web/lib/graphic-design-core.ts`'s opening comment (`scripts/live-graphic-test.ts`), which Task 5 replaces with the file. (Hits under `docs/`, in `PROGRESS.md` and in `.gitignore` are history and stay. "live harness" is not searched here: `answer.ts`, `answer-call.ts`, `live-budget.ts`, `plan-chapter.ts` and the db client use it for the `live:set` and `live:plan` harnesses, which stay; Task 5, Step 14 checks the designer's three files for it.)

- [ ] **Step 5: Type check, format and run the packages that lost files**

Run: `pnpm exec prettier --write apps/web/package.json packages/compositions/package.json package.json`
Expected: the three files listed.

Run: `pnpm --filter @boom-busters/compositions typecheck`
Expected: exits 0.

Run: `pnpm --filter @boom-busters/compositions exec vitest run src/lib src/components src/fixtures`
Expected: PASS (the deleted `frame-times.test.ts` was the only test under `scripts/`).

Run: `pnpm --filter @boom-busters/web typecheck`
Expected: FAIL with exactly the errors Task 4 left for Task 5, in `lib/graphic-design-core.ts` and `lib/graphic-design.ts`, and no error naming a file this task deleted (`live-graphic-*`, `scripts/live-graphic-test.ts`). Any other error is this task's regression: fix it before committing. Push nothing until Task 5 has run.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json packages/compositions/package.json package.json
git commit -m "$(cat <<'EOF'
chore(graphics): the live loop goes; the board and Redesign are the loop now (decision 295)

The harness, the frame renderer, their helpers and tests, and the three
script entries. The saved runs stay in live-graphic-runs/ as a record.
The designer's own files lose their mentions of the harness when the next
commit rewrites them for code.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

(The deletions were staged by `git rm` in Step 2.)

---

### Task 9: PROGRESS, e2e and the full run

**Files:**
- Modify: `PROGRESS.md` (decision 295), `e2e/global-setup.ts` (seeds a graphic written as code, ruling 19; exports `CODED_GRAPHIC_TITLE`)
- Test: `e2e/tests/visual-plan.spec.ts` (the coded graphic shows its still and plays)
- Conditional: `apps/web/lib/graphic-code/dry-run.ts`, only if Step 11's check fails (ruling 21)

What the e2e can reach, read from the code: `visual-plan.spec.ts` already plays and redesigns a graphic, the seeded "raised four billion" card, whose brief is a `scene`; it stays as it is, since old scenes keep rendering on `GraphicCard`. The e2e run has no Inngest ("the e2e run has no Inngest to hand the work to"), so the mock designer never runs there and no card carries a mock "[mock]" design. A card designed as code therefore has to be seeded (ruling 19): one more graphic slot on the plan project in `e2e/global-setup.ts`, resolved, its brief carrying `code` written in plain JS (its own compiled form). The e2e package depends on schemas, db, cost and timeline, not compositions, so the seed carries its own small source rather than `GRAPHIC_CODE_SOURCE`. A resolved slot is not counted by "Fetch visuals · 3 slots · est. $0.14", so that assertion holds.

Every command runs in the foreground with the Bash tool's `timeout` parameter set to 600000, except the dev server in Step 11, which that step starts in the background and stops itself. Never two database suites at once: before Step 3 and Step 10, check that no other `vitest`, `turbo` or `playwright` process is running, and that port 3100 is free.

- [ ] **Step 1: Write the failing e2e test**

In `e2e/tests/visual-plan.spec.ts`, change the setup import to:

```ts
import { CODED_GRAPHIC_TITLE, VISUAL_PLAN_TITLE } from '../global-setup'
```

and add this test inside `test.describe('a graphic slot (decision 268, Plan B)', ...)`, after the "plays the real graphic and offers a redesign" test:

```ts
  test('a graphic written as code shows its title and its own still, and plays (decision 295)', async ({
    page,
  }) => {
    const coded = page.locator('[id^="slot-"]').filter({ hasText: 'arrived in a single round' })
    await expect(coded.getByText(CODED_GRAPHIC_TITLE, { exact: true })).toBeVisible()
    // The still is the designer's own component at 60%, not the SVG preview a
    // scene gets. The dev server compiles its chunk on the first visit.
    await expect(
      coded.getByRole('img', { name: `Graphic still: ${CODED_GRAPHIC_TITLE}` }),
    ).toBeVisible({ timeout: 30_000 })
    await expect(coded.getByText('Four billion, raised', { exact: true })).toBeVisible()
    await expect(coded.getByRole('img', { name: /^graphic:/ })).toHaveCount(0)
    await coded.getByRole('button', { name: 'Play graphic' }).click()
    // The player is fetched on the first press; the region waits for it.
    await expect(coded.getByRole('region', { name: 'Graphic playback' })).toBeVisible()
    await coded.getByRole('button', { name: 'Close player' }).click()
    await expect(coded.getByRole('button', { name: 'Redesign graphic' })).toBeVisible()
    await expectHitTargets(page)
  })
```

- [ ] **Step 2: Add the title the test reads to the setup's exports**

In `e2e/global-setup.ts`, directly after `export const VISUAL_PLAN_TITLE = 'Shot plan awaiting fetch (E2E)'`, add:

```ts
/** The plan board's graphic written as code (decision 295), and its title. */
export const CODED_GRAPHIC_TITLE = 'Four billion, counted (E2E)'
/**
 * Plain JS, which is its own compiled form, using only what the sandbox
 * hands it. Seeded straight into the brief: e2e has no Inngest, so the mock
 * designer never runs here.
 */
const CODED_GRAPHIC_SOURCE = [
  'function Graphic(props) {',
  '  const frame = Remotion.useCurrentFrame()',
  '  const { fps } = Remotion.useVideoConfig()',
  '  const rise = Remotion.spring({ frame, fps })',
  '  return React.createElement(',
  '    Remotion.AbsoluteFill,',
  "    { style: { alignItems: 'center', justifyContent: 'center' } },",
  '    React.createElement(',
  "      'div',",
  '      {',
  '        style: {',
  '          opacity: rise,',
  '          color: props.brand.colors.textPrimary,',
  '          fontFamily: props.brand.fonts.heading,',
  '          fontSize: 140,',
  '        },',
  '      },',
  "      'Four billion, raised',",
  '    ),',
  '  )',
  '}',
].join('\n')
```

- [ ] **Step 3: Run the spec and watch the new test fail**

Run: `pnpm --filter @boom-busters/e2e exec playwright test tests/visual-plan.spec.ts`
Expected: the new test FAILS waiting for `getByText('Four billion, counted (E2E)')` inside a card that does not exist (`element(s) not found`); every other test in the file passes. Confirm from the summary that only `visual-plan.spec.ts` ran.

- [ ] **Step 4: Seed the coded graphic on the plan board**

In `e2e/global-setup.ts`, in the plan project's `replaceShotList(connection.db, plan.id, [...])` call, add a fifth row after the placeholder graphic (index 3):

```ts
        {
          // Decision 295: a graphic the designer wrote as code. Seeded
          // resolved, as a designed graphic with no mark to find lands; the
          // code is plain JS, so the source is its own compiled form.
          chapterId: planChapter.id,
          index: 4,
          type: 'graphic',
          brief: {
            type: 'graphic',
            motion: { kind: 'static' as const },
            transition: 'cut' as const,
            coversText: 'The money arrived in a single round.',
            description: 'The raise, as the designer wrote it.',
            intent: 'Four billion arrived at once.',
            intentClaimIds: [fundingClaimId],
            code: {
              version: 1 as const,
              source: CODED_GRAPHIC_SOURCE,
              compiled: CODED_GRAPHIC_SOURCE,
              title: CODED_GRAPHIC_TITLE,
              facts: [],
              words: [
                { text: 'The', atMs: 0 },
                { text: 'money', atMs: 300 },
                { text: 'arrived', atMs: 700 },
              ],
              durationMs: 6000,
            },
          },
          startMs: 24000,
          durationMs: 6000,
        },
```

and after the two existing `setSlotResolution` calls for the plan's graphics, add:

```ts
      const codedGraphic = planSlots.find((slot) => slot.index === 4)!
      await setSlotResolution(connection.db, codedGraphic.id, {
        status: 'resolved',
        candidates: [],
        answered: { brief: codedGraphic.brief, route: codedGraphic.route },
      })
```

- [ ] **Step 5: Run the spec and the e2e type check**

Run: `pnpm --filter @boom-busters/e2e exec playwright test tests/visual-plan.spec.ts`
Expected: PASS, every test in the file, the new one included, and "Fetch visuals · 3 slots · est. $0.14" still found by the first two.

Run: `pnpm --filter @boom-busters/e2e typecheck`
Expected: exits 0.

- [ ] **Step 6: Commit the e2e**

```bash
pnpm exec prettier --write e2e/global-setup.ts e2e/tests/visual-plan.spec.ts
git add e2e/global-setup.ts e2e/tests/visual-plan.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): a graphic written as code shows its still and plays on the plan board (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Check the decision number against master**

Run: `git fetch origin && git show origin/master:PROGRESS.md | grep -n "^29[0-9]\. " | tail -3`
Expected: the last entry is 294. If master has taken 295, this work becomes the next free number: renumber only this branch's own lines (those whose text is on this branch and not on `origin/master`), in a commit of its own, as the decision-numbers memory rule says.

- [ ] **Step 8: Write the PROGRESS entry**

Append to `PROGRESS.md`, after decision 294's last line ("Remotion or broker deploy."), one blank line and then:

```markdown
295. **The designer writes the graphic** (2026-10-12, owner). Decisions
     268, 289 and 290 had the model fill in a form: five element kinds on
     a 12x12 grid, four entrances, three exits, one camera track, every
     duration a constant, and a prompt that pushed restraint. The live
     runs of 8 October drew two to four elements in one column every
     time. The owner found the brand fonts and colours used well, the
     motion unpolished and the graphics simplistic, text-only ones most
     of all, and the chart format's single draw-on reveal behind them
     both; the guardrails and the structure were what held them back.
     Owner's rulings: the designer writes the animation itself, as a
     React component, with guardrails on facts, brand, timing and frame
     purity and none on layout, element count, easing or motion; charts
     move onto the same designer, built around their real series, and
     the chart reveal stays only for a chart with no design yet; the $1
     live loop goes, since the board plays the real composition and
     Redesign runs the real designer, and stills cannot show whether a
     spring settles.
     What shipped: the designer answers `{ source, title, facts }`. The
     web server scans the source (the banned globals and hooks, hex and
     `rgb(` literals, the 16 KB cap), compiles the JSX with esbuild,
     dry-runs it in a `vm` context every 250 ms in 1920x1080 and
     1080x1920 at 30 fps, and checks every digit group on screen for a
     second against the claims its facts cite (on a chart, or against
     its own series). A throw, a frame over
     2 s, more than 6 s with nothing changing, text outside the safe
     area or an empty last frame is a refusal that names it, retried
     once with the reason (decision 292). A design that passes is stored
     as `code` on the brief, beside any older `scene`, and a timeline
     payload of its own, `graphic-code`, carries the compiled function
     to `GraphicCode`, which builds it once and draws it in the house
     frame behind an error boundary that shows the title. Chart briefs
     gain `code` and `designIssue` and are designed like graphics: in
     the visuals run, after a retype and on Redesign chart. On the board
     a design in code plays in the Player at the full 1080p frame and
     shows a still of its own component at 60% under its title; a chart
     card gets Play chart, Redesign chart and the "Not designed" line.
     The prompt is rewritten around the sandbox, the six rules, a short
     craft section and two worked components; the answer budget is
     12,000 tokens; the shot list's graphic intents widen to what a
     motion designer would build for the beat. `pnpm live:graphic` and
     `pnpm render:graphics` are deleted; the saved runs stay as a record.
     Decisions made where the spec left room:
     <!-- controller: rulings -->
     Shipping, in this order because the timeline schema gained a
     payload and an older broker refuses it: `deploy:remotion`, then
     `deploy:stacks boom-busters-broker` (the Lambda recipe, run by the
     owner), then the Vercel deploy and `PUT /api/inngest`. No
     migration: `code` lives in the brief's JSON column. Older `scene`
     graphics keep rendering on `GraphicCard`, and a chart with no code
     on `ChartReveal`.
     The rollout's check: esbuild is a server external with a native
     binary, so if the first production compile throws "could not find
     @esbuild/linux-x64", `next.config.ts` gains an
     `outputFileTracingIncludes` entry for `/api/inngest` that traces
     the binary in. Under `pnpm dev`, `GET /api/inngest` answers 200,
     so Next does not bundle the route with the `react-server`
     condition that makes `react-dom/server` throw.
     Left: the cost per graphic, read off the Costs screen after the
     owner's first Redesign (about $0.30 to $0.60 on Opus 5.5 by token
     counts, against about $0.03 before); the owner decides from it
     whether the route stays on Opus.
     The number 295 is checked against `origin/master` at the merge.
```

Keep every backtick span on one line, as here: Prettier cannot settle a span that breaks across lines.

- [ ] **Step 9: The controller fills in the decisions**

Hand the entry back. The controller replaces the line `<!-- controller: rulings -->` with the decisions collected from the plan's "Execution order and controller rulings" and from every task's report (Step 11's outcome included), each in the house form ("...; cost if wrong: ..."), indented five spaces like the rest of the entry. That line is the one placeholder in this plan; no commit carries it.

Run after the controller's edit: `grep -c "controller: rulings" PROGRESS.md`
Expected: `0`.

- [ ] **Step 10: The full run**

First: `docker ps` (if it errors, start Docker Desktop, wait about a minute, run it again; the `boom-busters-test-db` container comes up by itself). Then check that nothing else holds the test database or port 3100: no other `vitest`, `turbo` or `playwright` process, and `netstat -ano | grep :3100` prints nothing.

Run: `pnpm typecheck`
Expected: every package succeeds.

Run: `pnpm exec eslint apps packages e2e --max-warnings 0`
Expected: no output, exit 0. (This is what CI lints. The root `pnpm lint` also walks other sessions' `.claude/worktrees/` and reports thousands of errors that are not this branch's; if `pnpm lint` is wanted anyway and is polluted, lint this branch's changed files with `git diff --name-only --diff-filter=d origin/master...HEAD -- '*.ts' '*.tsx' | xargs pnpm exec eslint --max-warnings 0`, which skips the files this branch deleted.)

Run: `git ls-files -z | xargs -0 -n 80 pnpm exec prettier --check --ignore-unknown`
Expected: every batch ends "All matched files use Prettier code style!" and xargs exits 0. (Tracked files only, in batches of 80: Windows refuses one long command line, and a refused batch looks like a formatting failure.)

Run: `pnpm test`
Expected: turbo reports every package's `test` task successful (about six minutes). A failure in one database suite is re-run alone before it is believed; a composition snapshot failure is re-run with `pnpm --filter @boom-busters/compositions test` alone before it is believed, and goldens are never regenerated from a full run.

Run: `pnpm e2e`
Expected: every spec passes on both projects (about four minutes). If a run is interrupted, free port 3100 before the next one.

- [ ] **Step 11: Check the Inngest route under Next (ruling 21)**

No Vitest test can make this check: a Vitest run never bundles, and Next may bundle the Inngest route with the `react-server` condition, under which `react-dom/server` throws on import. The dry run (`apps/web/lib/graphic-code/dry-run.ts`) imports it, and the route reaches it through `graphic-design.ts`.

Check that port 3000 is free (`netstat -ano | grep :3000` prints nothing). Start the dev server with the Bash tool's `run_in_background: true` (the one background command in this plan): `pnpm dev`. When its output shows `Ready`, run in the foreground: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/inngest`.
Expected: `200`. The first request compiles the route; if it prints `000`, wait ten seconds and run it again. Then stop the dev server (stop the background task; if the port is still held, `netstat -ano | grep :3000` and `taskkill //PID <pid> //F`) and confirm port 3000 is free.

If it answers 500 and the dev server's output names `react-dom/server` (or says it is not supported in React Server Components), load React at run time in `dry-run.ts`: replace its two value imports `import * as React from 'react'` and `import { renderToStaticMarkup } from 'react-dom/server'` with

```ts
import { createRequire } from 'node:module'
import type * as ReactModule from 'react'
import type * as ReactDomServer from 'react-dom/server'

// Next bundles the Inngest route with the `react-server` condition, under
// which `react-dom/server` throws on import (ruling 21). A require at run
// time resolves the plain Node builds instead.
const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react') as typeof ReactModule
const { renderToStaticMarkup } = nodeRequire('react-dom/server') as typeof ReactDomServer
```

keeping `import type { CSSProperties, ReactNode } from 'react'`. Then run `pnpm --filter @boom-busters/web vitest run lib/graphic-code` (PASS, 50 tests), repeat this step (Expected: `200`), and commit `dry-run.ts` alone:

```bash
pnpm exec prettier --write apps/web/lib/graphic-code/dry-run.ts
git add apps/web/lib/graphic-code/dry-run.ts
git commit -m "fix(web): the dry run loads react-dom/server at run time, out of Next's react-server bundle (decision 295)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

In that case also change the PROGRESS entry's sentence "Under `pnpm dev`, `GET /api/inngest` answers 200, so Next does not bundle the route with the `react-server` condition that makes `react-dom/server` throw." to say that Next did bundle the route that way and that `dry-run.ts` now loads React through `createRequire`; report it to the controller as a decision.

- [ ] **Step 12: Commit PROGRESS**

```bash
pnpm exec prettier --check PROGRESS.md
git add PROGRESS.md
git commit -m "$(cat <<'EOF'
docs(progress): the designer writes the graphic (decision 295)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
)"
```

---

## Reconciliation log

- A: Task 1 Step 3 adds `GRAPHIC_STILL_MAX_MS = 6000` with its doc comment to `graphic-timing.ts` (it reaches the index through `graphics.ts`'s `export *`), Step 1 tests it, Step 5 commits it; Global Constraints, the contract and the file table say Task 1 adds it; Tasks 3 and 4 import it from schemas.
- B: the contract's and the file table's `check.ts` lines read scan, compile, dry run, facts; Task 3's heading, the `GraphicCode`, `graphic-code.ts` and `graphic-design-core.ts` doc comments, the Architecture line and the PROGRESS text use the same order.
- C: `brand` removed from `GraphicDesignContext`, `loadGraphicContextFrom` (and its `getSettings` read), both Task 5 test CONTEXTs and the parked-runs note; the runner and replanner brand steps (old Steps 12 and 13) are deleted and both files leave Task 5, which changed nothing else in them; Step 11 now runs both runner suites green, later steps renumbered 12 to 26.
- D: `graphicFactsIssue` takes `extraTexts?` (Task 1 code, doc and test; contract); Task 3's `check.ts` builds `seriesText(brief)` for a chart and passes it after the real claims; `check.test.ts` gains the "104.5" chart case (9 tests, folder still 50).
- E: the dry run hands every titled library logo as `mock://logo/<id>` at 1 by 1; Task 6 already carried the whole library, charts too (wording added); Task 7's `codeLogoMarks(logos)` lists the whole library with the assembly's first-title-wins rule, the slot model signs it whenever any design is code, `codeLogosFor(logoUrls, logoMarks)` loses the source filter, and its tests and the board's still test are whole-library assertions.
- F: `intent` removed from `GraphicProps` (Task 2, contract), the dry-run test props, `check.ts` (with its `graphicIntentOf` import) and the prompt's props list; a prompt test asserts `props.intent` is absent.
- G: `GraphicCode` no longer turns `durationInFrames` into `durationMs`; the prop is still accepted and documented as unread; no test pinned the old behaviour.
- H: the contract's `withDesign` comment says a failure keeps `code`; Task 5's doc cites ruling 8.
- I: `GraphicDesignInput.current` is `Pick<PlannedGraphicCode, 'source' | 'title'>` (Task 4 code, contract, Task 4's expected type error); Task 5's `currentDesign(code)` returns `{ source, title }`; the redesign request test drops `facts`.
- J: Task 2's `GRAPHIC_CODE_SOURCE` is now Task 4's fixture text (the two blocks diffed identical); its doc comment, the `GraphicCode` tests ("Raised in one round", "Then the next step"), the fixture regex, the golden frame (now 150, 5 s, so every element is on screen), the golden description and commit text follow; Task 2's Interfaces and Task 4's Step 8 say the text is Task 4's and the equality test lives in Task 4.
- K: `mockGraphicCode` swaps the fixture's figure for `'$<digits>bn'` from the first digit group of the first intent claim with a digit, else the first claim with one, with a matching fact, and for `''` with `facts: []` when no claim has a digit (a replacer function, so `$` is never read as a pattern); tests rewritten (27 in the file); Task 5's mock tests still hold. The fixture has no literal `'$4bn'` (it counts up), so the whole counting expression is what is swapped.
- L: `parseGraphicCode(text, note = ignoreRepairs)` trims the title with `trimField` and reports it; the over-80 test asserts the trim and the note; Task 5 passes `note` from `callForAnswer`'s `(text, note)`.
- M: Task 2's `lib/graphic-code.ts` exports `safeInsets` (rounded) and re-exports `withAlpha`, `graphicPropsFor` uses `safeInsets`, and `index.ts` exports exactly ruling 13's names; the `safeInsets` value test moved from Task 3 to Task 2; the dry run imports `graphicFunctionBody`, `safeInsets`, `withAlpha` and the types from `@boom-busters/compositions/graphic-code` and its test the fixture from `/graphic-code-fixture`, deleting its own `safeInsets` and `withAlpha`; Task 3's Consumes line matches; Task 7 keeps its barrel imports and its old export step became a check.
- N: Task 3 Step 15 says why the outer function is compiled inside the `vm` context; `buildGraphic`'s doc names the dry run's equivalent path.
- O: Task 1 has the materialise, broker and `SLOT_PAYLOAD_KINDS` steps; Task 6's duplicate materialise and broker steps (old 17 to 25) are replaced by a consumer run; Task 6's preview rule (leave out a mark that will not resolve, keep the slot) moved into Task 1, because with the whole library on every payload the old drop-the-slot rule would drop every coded graphic from a preview without storage; `keepGraphicDesign` stays only in Task 1; the Files blocks of Tasks 1, 6 and 7 list every file touched.
- P: Task 9 has the e2e seed (Files block now lists `e2e/global-setup.ts`), a new Step 11 that runs `pnpm dev` and `GET /api/inngest` with the `createRequire` fallback written out, remotion-then-stacks shipping in the PROGRESS text, and the esbuild tracing check added to it; Step 9 no longer points at a missing "Notes for the controller".
- Q: nothing needed: every one of the 29 commits already ends with the Fable 5.1 trailer.
- R: Task 8 runs before Task 5 but edited files Task 5 rewrites whole, and expected a green typecheck and designer tests in a window where both are red; Task 8 now only deletes and drops script entries, Task 5's rewrites carry its harness-free comments, the describe title and `loadGraphicContext` without `database`, and Task 5 Step 14 greps for the harness; Task 8's old "no output" grep would have hit the `live:set` and `live:plan` harness comments, so it is narrowed; the "if Task 8 has not run" caveats and Task 4's known-red note follow the execution order; the refusal texts Task 5 asserts come from `graphicCodeIssue` itself, so they match.
- S: the only placeholder left is `<!-- controller: rulings -->`; the dangling "Notes for the controller" references (Tasks 5, 6 and 9) and Task 8's "any test of either" are gone.
- T: every task's Files block now lists Create, Modify, Delete and Test as its steps do them (Task 4 drops the unedited providers `index.ts`, Task 5 lists `visuals-replanner.test.ts` as run, not changed, Task 7 drops compositions `index.ts`).
- Note: header ruling 16 still says Task 6 carries `keepGraphicDesign`; the plan keeps it in Task 1, as instructed. Review Focus 3's "a logo it did not cite" now means a logo the library lacks. `chartData` (Task 5, server, imports the database) and `chartDataOf` (Task 7, client) stay separate across the server and client line.
- Settled (amended ruling 4): a shown group passes only when a CITED claim or an extra text holds it, which is what the plan already says; nothing changed.
- Settled (ruling 25): `LogoIndex` (`packages/schemas/src/logos.ts`) gains required `width` and `height` (`number | null`) in new Task 1 Steps 19 and 20 (old Step 19 is now 21). Being required, the fields reach every place that builds an index from `listLogos` rows, so the same commit adds the row's size in all seven: both runners' `setup` steps, which feed `designPlannedGraphics`, and the retyper, rebriefer, `visuals-actions.ts`, `graphic-design-core.ts` and `live-plan-test.ts`. Two test fixtures gain sizes too. Task 5's `loadGraphicContextFrom` keeps `width: row.width, height: row.height` (the columns are already `number | null`, so `?? null` would do nothing). Task 3's `placeholderLogos` hands the dry run only titled marks that have a size, at that size, with the first mark under a title winning as in the assembly and on the board. A missing size from a `setup` memoised before the deploy counts as none. `check.test.ts`'s CONTEXT mark carries 1200 by 400, and the whole-library test now also shows that the same source crashes with "Cannot read properties of undefined (reading 'src')" when Acme is sizeless. Task 6's `logoLibrary` and Task 7's `codeLogoMarks` already skipped sizeless marks (`!width || !height`), so neither changed.
- Settled (ruling 26): `graphicBrand` lives in compositions `lib/graphic-code.ts`. `graphicPropsFor` calls it, it is on the subpath and in the barrel (Task 2 Steps 3 and 14), and its own test asserts the five font names (Task 2 now has 14 tests in that file). `dry-run.ts` no longer has its own copy or the `BrandKitTokens` import, and `check.ts` and `dry-run.test.ts` import it from `@boom-busters/compositions/graphic-code`. Task 3's Interfaces, the contract and the file table say the same. Task 7's still never built the mapping itself (it calls `graphicPropsFor`), so it did not change.
