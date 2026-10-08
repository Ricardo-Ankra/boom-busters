# Graphics that move with the narration (decision 290, stage 2 of 289) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A graphic can build in steps (exits, bars that grow one at a time and rescale), move its camera, and emphasise at a set time, so a long graphic keeps changing with the narration instead of sitting still after its last entrance.

**Architecture:** Every new field is optional and lives on the element (`exit`, a timed `emphasis`, a bar item's `atMs`) or on the scene (`camera`). One dependency-free timing module in `packages/schemas` (`graphic-timing.ts`) says when each element is on screen and holds the seven timing rules; the schema, the designer's checks, the layout, the card, the board and the live harness all read it. The render lives once in `packages/compositions` (`graphic.ts` for layout, a new `graphic-motion.ts` for time, `GraphicCard`), and the board's player runs that same card; the board's SVG preview draws any moment of the graphic and shows one small frame per step.

**Tech Stack:** pnpm/turbo monorepo; Zod 4 (`packages/schemas`); prompts and mocks (`packages/providers`); Remotion 4.0.512 (`packages/compositions`), pixelmatch goldens; Next.js App Router, Vitest + Testing Library (`apps/web`); Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-10-08-graphics-motion-design.md`

## Global Constraints

- Every new field is optional; a scene stored under stage 1 parses and renders frame for frame as before. No stage 1 golden PNG may change; never regenerate them.
- Limits: `MAX_GRAPHIC_ELEMENTS = 10` in a scene; `GRAPHIC_MAX_ON_SCREEN = 6` at any moment; an element is on screen from its entrance's start to its exit's start (open-ended without an exit).
- Durations: entrance `GRAPHIC_ENTER_MS = 600`; exit `GRAPHIC_EXIT_MS = 500`; bar grow `GRAPHIC_BAR_GROW_MS = 700`; colour shift `GRAPHIC_COLOR_SHIFT_MS = 400`; camera move `GRAPHIC_CAMERA_MOVE_MS = 1500`; pulse 360 ms (word form 600 ms after the entrance starts); underline sweep 600 ms (word form 500 ms after the entrance starts).
- Camera: up to `MAX_CAMERA_KEYS = 4` keys, `zoom` 1 to `GRAPHIC_MAX_ZOOM = 1.6` (default 1), `focus` an element id or `'all'`.
- Exits: `'fade' | 'drop' | 'wipe'`. Timed emphasis: `{ kind: 'pulse' | 'underline' | 'color', atMs, to? }`; `to` required on `color` and refused otherwise; `color` refused on a logo; timed `underline` only on text and figure; the word forms are not newly restricted.
- The seven timing rules (spec section 3) are worded for the designer's retry; rule 1 keeps stage 1's exact message.
- No `deploy:remotion`, broker deploy or Vercel deploy happens inside Tasks 1 to 10; Task 12 carries them, in the order `deploy:remotion`, `deploy:stacks boom-busters-broker`, push to `master`, `PUT /api/inngest`, and the owner runs them.
- Mock-provider mode makes no paid call. Task 11 (the live loop) spends money only with the owner's explicit go-ahead for each run, $1 cap a run.
- Every action is a visible labelled button (build spec section 11.1); this plan adds no new action, only images and labels.
- Before every commit: `pnpm exec prettier --write` then `pnpm exec prettier --check` on the files touched, and `pnpm exec eslint --max-warnings 0` on them. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Long runs use the Bash tool with `timeout: 600000` in the foreground; never two database suites at once; Docker Desktop must be running for `packages/db` and the web DB tests (`describeDb`).
- When a task changes a shared schema or prompt, run every consuming package's suite, not only the one touched (schemas changes reach providers, compositions, timeline, db and web).
- Work happens on branch `graphics-motion`; the spec is already committed there (`e15d3ea`).

## Review Focus

1. A stage 1 scene must render exactly as before: no camera transform, the bars' scale floor of 1, the word-form pulse and underline at their old offsets, and every stage 1 golden unchanged. Pinned in Task 5 (the stage 1 cases of `barScale`, `pulseScaleAt`, `underlineSweepAt`) and Task 6 (stage 1 goldens pass without regeneration).
2. Add logo on a graphic with a camera track must keep the track: `attachGraphicLogosAction` rebuilt the scene as `{ elements }`. Pinned in Task 3.
3. Several drawings of one graphic on one card (the thumbnail plus its step frames) must not share SVG clip ids, or one frame clips by another's rectangles. Pinned in Task 8.
4. An element entering just as another leaves into the same cell must keep that cell (a cross-fade is not a collision), and in 9:16 the two must share a band. Pinned in Task 4.
5. A later bar smaller than the first (a decline, $4bn then $1bn) must leave the scale where it is: the first bar stays full length, the new one grows to its share. Pinned in Task 5.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/schemas/src/graphic-timing.ts` (new) | timing constants, time on screen, emphasis windows, bar times, the seven rules, change times, longest still | 1, 2 |
| `packages/schemas/src/graphics.ts` | the new fields, limits and schema rules; re-exports the timing module | 1 |
| `packages/schemas/src/visuals.ts` | `resolvePlannedScene` and `toPlannedScene` carry `camera` | 3 |
| `apps/web/app/(console)/projects/[id]/visuals-actions.ts` | Add logo keeps `camera` | 3 |
| `apps/web/lib/graphic-design-core.ts` | `sceneIssue` runs `sceneTimingIssue`; `slotNarration` exported | 2, 9 |
| `packages/compositions/src/lib/graphic.ts` | time-aware `separateOverlaps`, banded `reflowPortrait` | 4 |
| `packages/compositions/src/lib/graphic-motion.ts` (new) | exits, bar scale, colour blend, emphasis, camera, a still moment | 5 |
| `packages/compositions/src/components/GraphicCard.tsx` | renders all of it | 6 |
| `packages/compositions/src/fixtures/graphic.ts`, `Root.tsx`, `snapshot/render.test.ts` | staged fixture, compositions, goldens | 6 |
| `packages/providers/src/prompts/graphics.ts` | vocabulary, rules, fourth example, mock in two steps, answer budget | 7 |
| `apps/web/app/(console)/projects/[id]/slot-previews.tsx`, `visual-board.tsx` | `GraphicPreview` at a moment, `GraphicSteps`, unique clip ids | 8 |
| `packages/compositions/scripts/graphic-frames/frame-times.ts`, `apps/web/lib/live-graphic-still.ts` (new), `apps/web/scripts/live-graphic-test.ts` | harness frames at every change; longest still in `run.json` | 9 |
| `e2e/global-setup.ts`, `e2e/tests/visual-plan.spec.ts`, `PROGRESS.md` | staged seed, e2e, decision 290 | 10 |

---

### Task 1: The vocabulary and the timing module

**Files:**
- Create: `packages/schemas/src/graphic-timing.ts`
- Modify: `packages/schemas/src/graphics.ts` (L17 to 18 `MAX_GRAPHIC_ELEMENTS`; L63 to 124 entrance schema, timing helpers, `elementCommon`; L161 to 166 `barItemFields`; L210 to 257 `sceneRules` and both scene schemas)
- Modify: `packages/providers/src/prompts/graphics.ts` (L5 import and L64, so the prompt keeps saying 6)
- Test: `packages/schemas/src/graphics.test.ts`

**Interfaces:**
- Produces (from `@boom-busters/schemas`, via `graphics.ts` re-exporting `graphic-timing.ts`):
  - constants `GRAPHIC_ENTER_MS` (600), `GRAPHIC_STAGGER_MS` (180), `GRAPHIC_EXIT_MS` (500), `GRAPHIC_BAR_GROW_MS` (700), `GRAPHIC_COLOR_SHIFT_MS` (400), `GRAPHIC_CAMERA_MOVE_MS` (1500), `GRAPHIC_MAX_ON_SCREEN` (6), `GRAPHIC_PULSE_AFTER_ENTER_MS` (600), `GRAPHIC_PULSE_MS` (360), `GRAPHIC_UNDERLINE_AFTER_ENTER_MS` (500), `GRAPHIC_UNDERLINE_MS` (600)
  - `interface GraphicTimingElement { id: string; kind?: string; enter: { atMs: number }; exit?: { atMs: number }; emphasis?: 'pulse' | 'underline' | { kind: 'pulse' | 'underline' | 'color'; atMs: number; to?: string }; items?: readonly { atMs?: number }[] }`
  - `interface GraphicTimingScene { elements: readonly GraphicTimingElement[]; camera?: readonly { atMs: number; focus: string }[] }`
  - `interface OnScreen { fromMs: number; toMs: number }`, `interface EmphasisWindow { kind: 'pulse' | 'underline' | 'color'; atMs: number; durationMs: number; to?: string }`
  - `graphicEnterTimes(scene: GraphicTimingScene): Map<string, number>` (moved, unchanged)
  - `lateEntranceIssue(scene: GraphicTimingScene, durationMs: number): string | null` (moved, unchanged)
  - `graphicOnScreen(scene: GraphicTimingScene): Map<string, OnScreen>`
  - `intervalsMeet(a: OnScreen, b: OnScreen): boolean`
  - `maxOnScreen(scene: GraphicTimingScene): { count: number; atMs: number }`
  - `emphasisWindow(emphasis: GraphicTimingElement['emphasis'], enterAtMs: number): EmphasisWindow | null`
  - `barItemTimes(element: GraphicTimingElement, enterAtMs: number): number[]`
  - from `graphics.ts`: `MAX_GRAPHIC_ELEMENTS` (10), `GRAPHIC_MAX_ZOOM` (1.6), `MAX_CAMERA_KEYS` (4), `GRAPHIC_EXITS`, `GraphicExitSchema`, `type GraphicExit`, `GRAPHIC_EMPHASES`, `GraphicTimedEmphasisSchema`, `GraphicEmphasisSchema`, `type GraphicEmphasis`, `GraphicCameraKeySchema`, `type GraphicCameraKey`; `GraphicScene` and `PlannedGraphicScene` gain `camera?: GraphicCameraKey[]`, every element gains `exit?` and the wider `emphasis?`, a bar item gains `atMs?`.

- [ ] **Step 1: Write the failing tests**

In `packages/schemas/src/graphics.test.ts`, extend the import from `./graphics` with `barItemTimes`, `emphasisWindow`, `graphicOnScreen`, `intervalsMeet`, `maxOnScreen`, then append:

```ts
describe('motion vocabulary (decision 290)', () => {
  const issues = (scene: Record<string, unknown>) => {
    const result = GraphicSceneSchema.safeParse(scene)
    return result.success ? [] : result.error.issues.map((issue) => issue.message)
  }

  it('parses a stage 1 scene as before: no exit, no camera, the word-form emphasis', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [text('t1'), figure('f1', { emphasis: 'underline' })],
    })
    expect(parsed.camera).toBeUndefined()
    expect(parsed.elements[0]).not.toHaveProperty('exit')
    expect(parsed.elements[1]).toMatchObject({ emphasis: 'underline' })
  })

  it('parses an exit, a timed emphasis, a timed bar and a camera track', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [
        text('t1', { exit: { kind: 'drop', atMs: 4000 } }),
        figure('f1', { emphasis: { kind: 'color', atMs: 5000, to: 'collapse' } }),
        {
          kind: 'bars',
          id: 'b1',
          cell: cell(0, 6, 12, 4),
          color: 'series0',
          items: [
            { label: 'then', value: 1, display: '$1bn', claimRef: CLAIM },
            { label: 'later', value: 4, display: '$4bn', claimRef: CLAIM, atMs: 6000 },
          ],
        },
      ],
      camera: [
        { atMs: 7000, focus: 'b1', zoom: 1.3 },
        { atMs: 9000, focus: 'all' },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({ exit: { kind: 'drop', atMs: 4000 } })
    expect(parsed.elements[1]).toMatchObject({
      emphasis: { kind: 'color', atMs: 5000, to: 'collapse' },
    })
    expect(parsed.camera).toEqual([
      { atMs: 7000, focus: 'b1', zoom: 1.3 },
      { atMs: 9000, focus: 'all', zoom: 1 },
    ])
  })

  it('allows ten elements in all when no more than six are on screen at once', () => {
    const first = ['a', 'b', 'c', 'd', 'e'].map((id, i) =>
      text(id, { cell: cell(0, i * 2, 12, 2), exit: { kind: 'fade', atMs: 5000 } }),
    )
    const second = ['f', 'g', 'h', 'i', 'j'].map((id, i) =>
      text(id, { cell: cell(0, i * 2, 12, 2), enter: { kind: 'fade', atMs: 5000 } }),
    )
    expect(issues({ elements: [...first, ...second] })).toEqual([])
  })

  it('refuses a seventh element on screen at once, saying when, and an eleventh in all', () => {
    const seven = Array.from({ length: 7 }, (_, i) => text(`t${i}`))
    // Untimed, they stagger 180 ms apart: the seventh arrives at 1080 ms.
    expect(issues({ elements: seven })).toContain(
      '7 elements are on screen together at 1080 ms; at most 6 may be',
    )
    const eleven = Array.from({ length: 11 }, (_, i) =>
      text(`t${i}`, {
        enter: { kind: 'fade', atMs: 1000 * i },
        exit: { kind: 'fade', atMs: 1000 * i + 900 },
      }),
    )
    expect(GraphicSceneSchema.safeParse({ elements: eleven }).success).toBe(false)
  })

  it('keeps a colour emphasis to colour and off logos, and a timed underline to text and figures', () => {
    const logo = { kind: 'logo', id: 'l1', cell: cell(0, 0), entity: 'Stability AI' }
    const rule = { kind: 'shape', id: 's1', cell: cell(0, 5, 12, 1), form: 'rule', color: 'accent' }
    expect(issues({ elements: [figure('f1', { emphasis: { kind: 'color', atMs: 2000 } })] })).toContain(
      'a colour emphasis names the colour it shifts "to"',
    )
    expect(
      issues({ elements: [figure('f1', { emphasis: { kind: 'pulse', atMs: 2000, to: 'accent' } })] }),
    ).toContain('"to" belongs only to a colour emphasis')
    expect(
      issues({ elements: [{ ...logo, emphasis: { kind: 'color', atMs: 2000, to: 'accent' } }] }),
    ).toContain('a logo is never recoloured')
    expect(issues({ elements: [{ ...rule, emphasis: { kind: 'underline', atMs: 2000 } }] })).toContain(
      'only a text or a figure can be underlined',
    )
    // The word form is not newly restricted, so no stored scene starts failing.
    expect(issues({ elements: [{ ...rule, emphasis: 'underline' }] })).toEqual([])
    expect(
      issues({ elements: [figure('f1', { emphasis: { kind: 'color', atMs: 2000, to: 'collapse' } })] }),
    ).toEqual([])
  })

  it('refuses a camera key on no element, a zoom past 1.6 and a fifth key', () => {
    expect(issues({ elements: [text('t1')], camera: [{ atMs: 1000, focus: 'ghost' }] })).toContain(
      'camera key 1 focuses "ghost", which is not an element of this graphic',
    )
    expect(
      GraphicSceneSchema.safeParse({
        elements: [text('t1')],
        camera: [{ atMs: 1000, focus: 't1', zoom: 1.7 }],
      }).success,
    ).toBe(false)
    const five = [1000, 3000, 5000, 7000, 9000].map((atMs) => ({ atMs, focus: 'all' }))
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1')], camera: five }).success).toBe(
      false,
    )
  })

  it('gives the planned scene the same vocabulary', () => {
    const parsed = PlannedGraphicSceneSchema.parse({
      elements: [figure('f1', { claimRef: 2, exit: { kind: 'wipe', atMs: 3000 } })],
      camera: [{ atMs: 1000, focus: 'f1', zoom: 1.2 }],
    })
    expect(parsed.elements[0]).toMatchObject({ exit: { kind: 'wipe', atMs: 3000 } })
    expect(parsed.camera).toEqual([{ atMs: 1000, focus: 'f1', zoom: 1.2 }])
  })
})

describe('time on screen (decision 290)', () => {
  const el = (id: string, atMs: number, exitAt?: number) => ({
    id,
    enter: { atMs },
    ...(exitAt === undefined ? {} : { exit: { atMs: exitAt } }),
  })

  it('runs from the entrance start to the exit start, open-ended without an exit', () => {
    const spans = graphicOnScreen({ elements: [el('a', 0, 4000), el('b', 4000)] })
    expect(spans.get('a')).toEqual({ fromMs: 0, toMs: 4000 })
    expect(spans.get('b')).toEqual({ fromMs: 4000, toMs: Number.POSITIVE_INFINITY })
    // One leaving as the other arrives is a cross-fade, not two on screen together.
    expect(intervalsMeet(spans.get('a')!, spans.get('b')!)).toBe(false)
  })

  it('counts the most on screen at once, at the first moment it happens', () => {
    expect(maxOnScreen({ elements: [el('a', 0, 4000), el('b', 1000), el('c', 4000)] })).toEqual({
      count: 2,
      atMs: 1000,
    })
  })

  it('times the word-form emphasis as stage 1 did, and the timed form at its own time', () => {
    expect(emphasisWindow('pulse', 1000)).toEqual({ kind: 'pulse', atMs: 1600, durationMs: 360 })
    expect(emphasisWindow('underline', 1000)).toEqual({
      kind: 'underline',
      atMs: 1500,
      durationMs: 600,
    })
    expect(emphasisWindow({ kind: 'color', atMs: 5000, to: 'accent' }, 1000)).toEqual({
      kind: 'color',
      atMs: 5000,
      durationMs: 400,
      to: 'accent',
    })
    expect(emphasisWindow(undefined, 1000)).toBeNull()
  })

  it('grows an untimed bar with its element, and a timed one at its own time', () => {
    expect(
      barItemTimes({ id: 'b', enter: { atMs: 2000 }, items: [{}, { atMs: 9000 }] }, 2000),
    ).toEqual([2000, 9000])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/graphics.test.ts`
Expected: FAIL (`graphicOnScreen` not exported; `exit` stripped; seven elements accepted).

- [ ] **Step 3: Create the timing module**

Create `packages/schemas/src/graphic-timing.ts`:

```ts
/**
 * When things happen inside a graphic (decisions 289 and 290): plain
 * functions over a scene's times, read by the schema's own rules, the
 * designer's checks, the layout, the card, the board's preview and the live
 * harness, so every one of them agrees on when an element is on screen.
 *
 * Structural types only: `graphics.ts` (the zod schemas) imports from here,
 * never the other way round.
 */

/** How long one entrance takes on the card. The render reads this; a check reads it too. */
export const GRAPHIC_ENTER_MS = 600
/** The gap between entrances when a scene times none of them. */
export const GRAPHIC_STAGGER_MS = 180
/** How long one exit takes (decision 290). */
export const GRAPHIC_EXIT_MS = 500
/** How long one bar takes to grow in. */
export const GRAPHIC_BAR_GROW_MS = 700
/** How long a colour emphasis takes to shift. */
export const GRAPHIC_COLOR_SHIFT_MS = 400
/** How long one camera move takes. */
export const GRAPHIC_CAMERA_MOVE_MS = 1500
/** The most elements a graphic shows at any one moment. */
export const GRAPHIC_MAX_ON_SCREEN = 6
/** The word-form pulse: when it fires after its entrance starts, and how long it lasts. */
export const GRAPHIC_PULSE_AFTER_ENTER_MS = 600
export const GRAPHIC_PULSE_MS = 360
/** The word-form underline: when its sweep starts after its entrance starts, and how long it takes. */
export const GRAPHIC_UNDERLINE_AFTER_ENTER_MS = 500
export const GRAPHIC_UNDERLINE_MS = 600

/** The least an element must carry for its times to be read. */
export interface GraphicTimingElement {
  id: string
  kind?: string
  enter: { atMs: number }
  exit?: { atMs: number }
  emphasis?:
    | 'pulse'
    | 'underline'
    | { kind: 'pulse' | 'underline' | 'color'; atMs: number; to?: string }
  items?: readonly { atMs?: number }[]
}

/** The least a scene must carry for its times to be read. */
export interface GraphicTimingScene {
  elements: readonly GraphicTimingElement[]
  camera?: readonly { atMs: number; focus: string }[]
}

/** An element's time on screen: from its entrance's start to its exit's start. */
export interface OnScreen {
  fromMs: number
  toMs: number
}

/** A moment of emphasis: what it does, when it starts and how long it takes. */
export interface EmphasisWindow {
  kind: 'pulse' | 'underline' | 'color'
  atMs: number
  durationMs: number
  /** A colour emphasis: the colour token it shifts to. */
  to?: string
}

/**
 * When each element starts entering, as the card plays it: the authored
 * offsets when any element is timed, otherwise a stagger in scene order. One
 * rule for the card and for the check that keeps entrances inside the slot.
 */
export function graphicEnterTimes(scene: GraphicTimingScene): Map<string, number> {
  const timed = scene.elements.some((element) => element.enter.atMs > 0)
  return new Map(
    scene.elements.map((element, index) => [
      element.id,
      timed ? element.enter.atMs : index * GRAPHIC_STAGGER_MS,
    ]),
  )
}

/**
 * The schema promised that the layout clamps an entrance inside its slot, and
 * nothing did (decision 289). This is the clamp, as a rule the designer is
 * held to: every entrance must have time to finish before the slot ends.
 */
export function lateEntranceIssue(scene: GraphicTimingScene, durationMs: number): string | null {
  const latest = Math.max(0, durationMs - GRAPHIC_ENTER_MS)
  for (const [id, atMs] of graphicEnterTimes(scene)) {
    if (atMs > latest) {
      return `element "${id}" enters at ${atMs} ms, but this ${(durationMs / 1000).toFixed(1)} s slot needs every entrance to start by ${latest} ms`
    }
  }
  return null
}

/**
 * When each element is on screen (decision 290): from its entrance's start to
 * its exit's START, open-ended without an exit. Counting to the exit's start
 * lets an element entering as another leaves take its place: a cross-fade is
 * two elements in one cell, not a collision, and not seven on screen.
 */
export function graphicOnScreen(scene: GraphicTimingScene): Map<string, OnScreen> {
  const enters = graphicEnterTimes(scene)
  return new Map(
    scene.elements.map((element) => [
      element.id,
      {
        fromMs: enters.get(element.id) ?? 0,
        toMs: element.exit?.atMs ?? Number.POSITIVE_INFINITY,
      },
    ]),
  )
}

/** Whether two elements are ever on screen together. */
export function intervalsMeet(a: OnScreen, b: OnScreen): boolean {
  return a.fromMs < b.toMs && b.fromMs < a.toMs
}

/** The most elements on screen at once, and the first moment it happens. */
export function maxOnScreen(scene: GraphicTimingScene): { count: number; atMs: number } {
  const spans = [...graphicOnScreen(scene).values()].sort((a, b) => a.fromMs - b.fromMs)
  let best = { count: 0, atMs: 0 }
  for (const { fromMs } of spans) {
    const count = spans.filter((span) => span.fromMs <= fromMs && fromMs < span.toMs).length
    if (count > best.count) best = { count, atMs: fromMs }
  }
  return best
}

/**
 * When an element's emphasis plays. The word forms keep stage 1's timing,
 * just after the entrance starts; the timed form (decision 290) plays at its
 * own time.
 */
export function emphasisWindow(
  emphasis: GraphicTimingElement['emphasis'],
  enterAtMs: number,
): EmphasisWindow | null {
  if (emphasis === undefined) return null
  if (emphasis === 'pulse') {
    return {
      kind: 'pulse',
      atMs: enterAtMs + GRAPHIC_PULSE_AFTER_ENTER_MS,
      durationMs: GRAPHIC_PULSE_MS,
    }
  }
  if (emphasis === 'underline') {
    return {
      kind: 'underline',
      atMs: enterAtMs + GRAPHIC_UNDERLINE_AFTER_ENTER_MS,
      durationMs: GRAPHIC_UNDERLINE_MS,
    }
  }
  const durationMs =
    emphasis.kind === 'pulse'
      ? GRAPHIC_PULSE_MS
      : emphasis.kind === 'underline'
        ? GRAPHIC_UNDERLINE_MS
        : GRAPHIC_COLOR_SHIFT_MS
  return {
    kind: emphasis.kind,
    atMs: emphasis.atMs,
    durationMs,
    ...(emphasis.to !== undefined ? { to: emphasis.to } : {}),
  }
}

/** When each bar of a bars element grows: its own time, or its element's entrance. */
export function barItemTimes(element: GraphicTimingElement, enterAtMs: number): number[] {
  return (element.items ?? []).map((item) => item.atMs ?? enterAtMs)
}
```

- [ ] **Step 4: Add the fields and rules to the schemas**

In `packages/schemas/src/graphics.ts`:

1. Replace L17 to 18 with:

```ts
export const GRAPHIC_GRID = 12
/** Across the whole slot (decision 290); no more than `GRAPHIC_MAX_ON_SCREEN` at once. */
export const MAX_GRAPHIC_ELEMENTS = 10
```

2. Delete L77 to 115 (`GRAPHIC_ENTER_MS`, `GRAPHIC_STAGGER_MS`, `GraphicTimingScene`, `graphicEnterTimes`, `lateEntranceIssue`: they now live in `graphic-timing.ts`), and at the top of the file, under the existing imports, add:

```ts
import { GRAPHIC_MAX_ON_SCREEN, maxOnScreen } from './graphic-timing'

export * from './graphic-timing'
```

3. After `GraphicEnterSchema` and its type (L70 to 75), add:

```ts
/** Any later time inside a graphic: an offset from the slot's start, bounded like an entrance. */
const GraphicTimeSchema = z.number().int().min(0).max(GRAPHIC_MAX_ENTER_MS)

export const GRAPHIC_EXITS = ['fade', 'drop', 'wipe'] as const
/** Leaving the frame (decision 290); an exit takes `GRAPHIC_EXIT_MS`. */
export const GraphicExitSchema = z.object({
  kind: z.enum(GRAPHIC_EXITS),
  atMs: GraphicTimeSchema,
})
export type GraphicExit = z.infer<typeof GraphicExitSchema>

export const GRAPHIC_EMPHASES = ['pulse', 'underline', 'color'] as const
/**
 * An emphasis at a time the designer chooses (decision 290). `color` shifts
 * the element to the token `to` names and keeps it there.
 */
export const GraphicTimedEmphasisSchema = z.object({
  kind: z.enum(GRAPHIC_EMPHASES),
  atMs: GraphicTimeSchema,
  to: GraphicColorSchema.optional(),
})
/** The word forms fire just after the entrance, as in stage 1; the object form at its own time. */
export const GraphicEmphasisSchema = z.union([
  z.enum(['pulse', 'underline']),
  GraphicTimedEmphasisSchema,
])
export type GraphicEmphasis = z.infer<typeof GraphicEmphasisSchema>

export const GRAPHIC_MAX_ZOOM = 1.6
export const MAX_CAMERA_KEYS = 4
/**
 * A camera key (decision 290): from `atMs` the camera moves, over
 * `GRAPHIC_CAMERA_MOVE_MS`, to frame `focus` (an element id, or 'all') at
 * `zoom`, and holds there until the next key.
 */
export const GraphicCameraKeySchema = z.object({
  atMs: GraphicTimeSchema,
  focus: z.string().min(1).max(40),
  zoom: z.number().min(1).max(GRAPHIC_MAX_ZOOM).default(1),
})
export type GraphicCameraKey = z.infer<typeof GraphicCameraKeySchema>
```

4. In `elementCommon`, replace the `emphasis` line with:

```ts
  /** Absent: the element stays to the end of the slot (decision 290). */
  exit: GraphicExitSchema.optional(),
  emphasis: GraphicEmphasisSchema.optional(),
```

5. In `barItemFields`, after `display`, add:

```ts
  /** When this bar grows in, with its label and value; absent: with its element (decision 290). */
  atMs: GraphicTimeSchema.optional(),
```

6. Replace `sceneRules` and both scene schemas (L210 to 257) with:

```ts
/** What the scene rules read: the parsed scene, stored or planned. */
interface RuleScene {
  elements: readonly {
    kind: string
    id: string
    enter: { kind: string; atMs: number }
    entity?: string
    exit?: { atMs: number }
    emphasis?: GraphicEmphasis
  }[]
  camera?: readonly { atMs: number; focus: string }[]
}

/**
 * The rules no field type can carry: one count per figure, unique ids, one
 * logo per entity, the timed emphasis's own rules, a camera that looks at an
 * element of this scene, and no more than six on screen at once (decision
 * 290). The timing rules that need the slot's length are `sceneTimingIssue`.
 */
function sceneRules(scene: RuleScene, ctx: z.RefinementCtx): void {
  const ids = new Set<string>()
  const entities = new Set<string>()
  scene.elements.forEach((element, index) => {
    if (element.enter.kind === 'count' && element.kind !== 'figure') {
      ctx.addIssue({
        code: 'custom',
        path: ['elements', index, 'enter'],
        message: 'only a figure can count',
      })
    }
    if (ids.has(element.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['elements', index, 'id'],
        message: `duplicate element id "${element.id}"`,
      })
    }
    ids.add(element.id)
    if (element.kind === 'logo' && element.entity !== undefined) {
      const key = normaliseEntity(element.entity)
      if (entities.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['elements', index, 'entity'],
          message: 'one logo per entity',
        })
      }
      entities.add(key)
    }
    const emphasis = element.emphasis
    if (emphasis !== undefined && typeof emphasis !== 'string') {
      const path = ['elements', index, 'emphasis']
      if (emphasis.kind === 'color' && emphasis.to === undefined) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: 'a colour emphasis names the colour it shifts "to"',
        })
      }
      if (emphasis.kind !== 'color' && emphasis.to !== undefined) {
        ctx.addIssue({ code: 'custom', path, message: '"to" belongs only to a colour emphasis' })
      }
      if (emphasis.kind === 'color' && element.kind === 'logo') {
        ctx.addIssue({ code: 'custom', path, message: 'a logo is never recoloured' })
      }
      if (emphasis.kind === 'underline' && element.kind !== 'text' && element.kind !== 'figure') {
        ctx.addIssue({ code: 'custom', path, message: 'only a text or a figure can be underlined' })
      }
    }
  })
  ;(scene.camera ?? []).forEach((key, index) => {
    if (key.focus !== 'all' && !ids.has(key.focus)) {
      ctx.addIssue({
        code: 'custom',
        path: ['camera', index, 'focus'],
        message: `camera key ${index + 1} focuses "${key.focus}", which is not an element of this graphic`,
      })
    }
  })
  const crowd = maxOnScreen(scene)
  if (crowd.count > GRAPHIC_MAX_ON_SCREEN) {
    ctx.addIssue({
      code: 'custom',
      path: ['elements'],
      message: `${crowd.count} elements are on screen together at ${crowd.atMs} ms; at most ${GRAPHIC_MAX_ON_SCREEN} may be`,
    })
  }
}

export const GraphicSceneSchema = z
  .object({
    elements: z.array(GraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS),
    /** Absent: the stage 1 drift alone (decision 290). */
    camera: z.array(GraphicCameraKeySchema).max(MAX_CAMERA_KEYS).optional(),
  })
  .superRefine(sceneRules)
export type GraphicScene = z.infer<typeof GraphicSceneSchema>

export const PlannedGraphicSceneSchema = z
  .object({
    elements: z.array(PlannedGraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS),
    camera: z.array(GraphicCameraKeySchema).max(MAX_CAMERA_KEYS).optional(),
  })
  .superRefine(sceneRules)
export type PlannedGraphicScene = z.infer<typeof PlannedGraphicSceneSchema>
```

7. In `packages/providers/src/prompts/graphics.ts`, so the prompt still says "6" until Task 7 rewrites the line: replace `MAX_GRAPHIC_ELEMENTS,` in the import (L5) with `GRAPHIC_MAX_ON_SCREEN,`, and on L64 replace `${MAX_GRAPHIC_ELEMENTS}` with `${GRAPHIC_MAX_ON_SCREEN}`.

- [ ] **Step 5: Run the schema tests**

Run: `cd packages/schemas && pnpm exec vitest run src/graphics.test.ts`
Expected: PASS, including the existing "refuses a hex colour, a seventh element..." test (it builds `MAX_GRAPHIC_ELEMENTS + 1` = 11 elements, still refused).

- [ ] **Step 6: Typecheck and run every consuming suite**

Run (Bash `timeout: 600000`): `pnpm typecheck` from the repo root, then `cd packages/schemas && pnpm exec vitest run`, `cd packages/providers && pnpm exec vitest run`, `cd packages/compositions && pnpm exec vitest run src/lib`, `cd packages/timeline && pnpm exec vitest run`.
Expected: all PASS. The compositions snapshot suite is not run here (Task 6).

- [ ] **Step 7: Commit**

```bash
git add packages/schemas/src/graphic-timing.ts packages/schemas/src/graphics.ts packages/schemas/src/graphics.test.ts packages/providers/src/prompts/graphics.ts
git commit -m "feat(schemas): exits, timed emphasis, timed bars and a camera track in the graphic vocabulary (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The seven timing rules, and the designer held to them

**Files:**
- Modify: `packages/schemas/src/graphic-timing.ts` (append)
- Modify: `apps/web/lib/graphic-design-core.ts` (L19 to 26 imports; L91 to 100 `sceneIssue`)
- Test: `packages/schemas/src/graphics.test.ts`, `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produced in `graphic-timing.ts`.
- Produces:
  - `sceneTimingIssue(scene: GraphicTimingScene, durationMs: number): string | null`
  - `graphicMotions(scene: GraphicTimingScene): { atMs: number; durationMs: number }[]`
  - `graphicChangeTimes(scene: GraphicTimingScene): number[]` (ascending, distinct)
  - `longestStill(scene: GraphicTimingScene, durationMs: number): { fromMs: number; toMs: number }`
  - `graphicExitTimes(scene: GraphicTimingScene): number[]` (ascending, distinct)

- [ ] **Step 1: Write the failing schema tests**

In `packages/schemas/src/graphics.test.ts`, extend the import from `./graphics` with `graphicChangeTimes`, `graphicExitTimes`, `longestStill`, `sceneTimingIssue`, and `import type { GraphicTimingElement, GraphicTimingScene } from './graphics'`. Append:

```ts
describe('sceneTimingIssue (decision 290)', () => {
  const at = (
    id: string,
    atMs: number,
    extra: Partial<GraphicTimingElement> = {},
  ): GraphicTimingElement => ({ id, kind: 'text', enter: { atMs }, ...extra })
  const SLOT = 10_000

  it('passes a stage 1 scene and a well-timed staged one', () => {
    expect(sceneTimingIssue({ elements: [at('a', 0), at('b', 900)] }, SLOT)).toBeNull()
    expect(
      sceneTimingIssue(
        {
          elements: [
            at('a', 0, { exit: { atMs: 4000 } }),
            at('b', 4000),
            at('f', 900, { kind: 'figure', emphasis: { kind: 'color', atMs: 6000, to: 'accent' } }),
          ],
          camera: [
            { atMs: 5000, focus: 'f' },
            { atMs: 7000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBeNull()
  })

  it('rule 1: keeps the stage 1 late-entrance refusal, word for word', () => {
    expect(sceneTimingIssue({ elements: [at('a', 0), at('b', 9500)] }, SLOT)).toBe(
      'element "b" enters at 9500 ms, but this 10.0 s slot needs every entrance to start by 9400 ms',
    )
  })

  it('rule 2: an exit waits for its entrance and its emphasis, and finishes inside the slot', () => {
    expect(
      sceneTimingIssue({ elements: [at('a', 0, { exit: { atMs: 500 } }), at('b', 100)] }, SLOT),
    ).toBe('element "a" leaves at 500 ms, before its entrance and emphasis finish at 600 ms')
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { emphasis: 'pulse', exit: { atMs: 800 } }), at('b', 100)] },
        SLOT,
      ),
    ).toBe('element "a" leaves at 800 ms, before its entrance and emphasis finish at 960 ms')
    expect(
      sceneTimingIssue({ elements: [at('a', 0, { exit: { atMs: 9600 } }), at('b', 100)] }, SLOT),
    ).toBe('element "a" leaves at 9600 ms, but this 10.0 s slot needs its exit to start by 9500 ms')
  })

  it('rule 3: a timed emphasis plays while its element is fully on screen', () => {
    expect(
      sceneTimingIssue(
        { elements: [at('a', 1000, { emphasis: { kind: 'pulse', atMs: 1200 } })] },
        SLOT,
      ),
    ).toBe('element "a" is emphasised at 1200 ms, before its entrance finishes at 1600 ms')
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { emphasis: { kind: 'color', atMs: 9800, to: 'accent' } })] },
        SLOT,
      ),
    ).toBe(
      'element "a" is emphasised at 9800 ms, but this 10.0 s slot ends before its color emphasis finishes at 10200 ms',
    )
  })

  it('rule 4: each bar grows while its element is on screen, and one grows at the entrance', () => {
    const bars = (items: { atMs?: number }[], extra: Partial<GraphicTimingElement> = {}) =>
      at('b', 1000, { kind: 'bars', items, ...extra })
    expect(sceneTimingIssue({ elements: [bars([{}, { atMs: 500 }])] }, SLOT)).toBe(
      'bar 2 of "b" grows at 500 ms, before its element enters at 1000 ms',
    )
    expect(sceneTimingIssue({ elements: [bars([{}, { atMs: 9500 }])] }, SLOT)).toBe(
      'bar 2 of "b" grows at 9500 ms, but must finish growing by 10000 ms, when the slot ends',
    )
    expect(
      sceneTimingIssue(
        { elements: [bars([{}, { atMs: 3000 }], { exit: { atMs: 3500 } }), at('t', 0)] },
        SLOT,
      ),
    ).toBe(
      'bar 2 of "b" grows at 3000 ms, but must finish growing by 3500 ms, when its element starts to leave',
    )
    expect(sceneTimingIssue({ elements: [bars([{ atMs: 2000 }, { atMs: 3000 }])] }, SLOT)).toBe(
      'element "b" would enter empty: at least one bar must grow at its entrance, 1000 ms',
    )
  })

  it('rule 5: camera keys run in order, finish inside the slot, and rest on an element on screen', () => {
    const f = at('f', 0, { kind: 'figure' })
    expect(
      sceneTimingIssue(
        {
          elements: [f],
          camera: [
            { atMs: 2000, focus: 'f' },
            { atMs: 3000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBe('camera key 2 at 3000 ms must start at least 1500 ms after camera key 1 at 2000 ms')
    expect(sceneTimingIssue({ elements: [f], camera: [{ atMs: 9000, focus: 'f' }] }, SLOT)).toBe(
      'camera key 1 at 9000 ms cannot finish its move in this 10.0 s slot; it must start by 8500 ms',
    )
    expect(
      sceneTimingIssue({ elements: [f, at('g', 4000)], camera: [{ atMs: 2000, focus: 'g' }] }, SLOT),
    ).toBe('camera key 1 focuses "g" at 2000 ms, before it enters at 4000 ms')
    const leaving = at('g', 100, { exit: { atMs: 5000 } })
    expect(
      sceneTimingIssue({ elements: [f, leaving], camera: [{ atMs: 2000, focus: 'g' }] }, SLOT),
    ).toBe('camera key 1 rests on "g" until 10000 ms, but it starts to leave at 5000 ms')
    expect(
      sceneTimingIssue(
        {
          elements: [f, leaving],
          camera: [
            { atMs: 2000, focus: 'g' },
            { atMs: 4000, focus: 'all' },
          ],
        },
        SLOT,
      ),
    ).toBeNull()
    expect(sceneTimingIssue({ elements: [f], camera: [{ atMs: 2000, focus: 'ghost' }] }, SLOT)).toBe(
      'camera key 1 focuses "ghost", which is not an element of this graphic',
    )
  })

  it('rule 6: no more than six on screen at once', () => {
    const seven = Array.from({ length: 7 }, (_, i) => at(`e${i}`, i * 100))
    expect(sceneTimingIssue({ elements: seven }, SLOT)).toBe(
      '7 elements are on screen together at 600 ms; at most 6 may be',
    )
  })

  it('rule 7: a graphic that steps never ends on an empty frame; one that never steps is not held to it', () => {
    expect(
      sceneTimingIssue(
        { elements: [at('a', 0, { exit: { atMs: 3000 } }), at('s', 100, { kind: 'shape' })] },
        SLOT,
      ),
    ).toBe(
      'every element leaves before the end; at least one that is not a shape must stay on screen until the slot ends',
    )
    expect(sceneTimingIssue({ elements: [at('s', 0, { kind: 'shape' })] }, SLOT)).toBeNull()
  })
})

describe('change, stillness and steps (decision 290)', () => {
  // The 22.3 s valuation slot of the live runs, built in steps.
  const staged: GraphicTimingScene = {
    elements: [
      { id: 't', enter: { atMs: 2300 }, exit: { atMs: 13700 } },
      {
        id: 'b',
        kind: 'bars',
        enter: { atMs: 2300 },
        items: [{}, { atMs: 10900 }],
        emphasis: { kind: 'color', atMs: 14200, to: 'accent' },
      },
      { id: 'x', enter: { atMs: 14200 } },
    ],
    camera: [{ atMs: 14200, focus: 'b' }],
  }

  it('finds the dead air after the last entrance of a stage 1 graphic', () => {
    // As the live run drew it: title at 2.3 s, bars at 10.9 s, then nothing for 10.8 s.
    expect(
      longestStill({ elements: [{ id: 't', enter: { atMs: 2300 } }, { id: 'b', enter: { atMs: 10900 } }] }, 22300),
    ).toEqual({ fromMs: 11500, toMs: 22300 })
  })

  it('counts exits, timed bars, emphasis and camera moves as change', () => {
    expect(graphicChangeTimes(staged)).toEqual([2300, 10900, 13700, 14200])
    // Moving until 2.9 s, then still until the second bar at 10.9 s.
    expect(longestStill(staged, 22300)).toEqual({ fromMs: 2900, toMs: 10900 })
  })

  it('is empty when something moves to the very end', () => {
    expect(longestStill({ elements: [{ id: 'a', enter: { atMs: 0 } }] }, 600)).toEqual({
      fromMs: 600,
      toMs: 600,
    })
  })

  it('lists each distinct moment something starts to leave, in order', () => {
    const at = (id: string, enter: number, exit?: number) => ({
      id,
      enter: { atMs: enter },
      ...(exit === undefined ? {} : { exit: { atMs: exit } }),
    })
    expect(
      graphicExitTimes({
        elements: [at('a', 0, 4000), at('b', 100, 4000), at('c', 200, 2000), at('d', 300)],
      }),
    ).toEqual([2000, 4000])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/graphics.test.ts`
Expected: FAIL (`sceneTimingIssue` not exported).

- [ ] **Step 3: Implement the rules and the measures**

Append to `packages/schemas/src/graphic-timing.ts`:

```ts
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

/**
 * The timing rules a designed graphic is held to (decision 290), in the words
 * the designer's retry and the card read: the first rule broken, or null.
 * Rule 1 is stage 1's late entrance, unchanged; the rest keep exits, emphasis,
 * bars and the camera inside the slot and inside each element's time on
 * screen, hold the screen to six elements, and keep a stepped graphic from
 * ending on an empty frame.
 */
export function sceneTimingIssue(scene: GraphicTimingScene, durationMs: number): string | null {
  const late = lateEntranceIssue(scene, durationMs)
  if (late !== null) return late

  const enters = graphicEnterTimes(scene)
  const onScreen = graphicOnScreen(scene)
  for (const element of scene.elements) {
    const enterAt = enters.get(element.id) ?? 0
    const settled = enterAt + GRAPHIC_ENTER_MS
    const emphasis = emphasisWindow(element.emphasis, enterAt)

    // Rule 2: an exit waits for the entrance and any emphasis, and ends inside the slot.
    if (element.exit) {
      const ready = Math.max(settled, emphasis ? emphasis.atMs + emphasis.durationMs : 0)
      if (element.exit.atMs < ready) {
        return `element "${element.id}" leaves at ${element.exit.atMs} ms, before its entrance and emphasis finish at ${ready} ms`
      }
      const latest = durationMs - GRAPHIC_EXIT_MS
      if (element.exit.atMs > latest) {
        return `element "${element.id}" leaves at ${element.exit.atMs} ms, but this ${seconds(durationMs)} slot needs its exit to start by ${latest} ms`
      }
    }

    // Rule 3: a timed emphasis falls while the element is fully on screen.
    // Against an exit, rule 2 has already held it; here only the slot's end is left.
    if (emphasis && typeof element.emphasis === 'object') {
      if (emphasis.atMs < settled) {
        return `element "${element.id}" is emphasised at ${emphasis.atMs} ms, before its entrance finishes at ${settled} ms`
      }
      const ends = emphasis.atMs + emphasis.durationMs
      if (ends > durationMs) {
        return `element "${element.id}" is emphasised at ${emphasis.atMs} ms, but this ${seconds(durationMs)} slot ends before its ${emphasis.kind} emphasis finishes at ${ends} ms`
      }
    }

    // Rule 4: each timed bar grows while its element is on screen; one grows at the entrance.
    if (element.items) {
      const leaveBy = element.exit?.atMs ?? durationMs
      const when = element.exit ? 'when its element starts to leave' : 'when the slot ends'
      for (const [index, item] of element.items.entries()) {
        if (item.atMs === undefined) continue
        if (item.atMs < enterAt) {
          return `bar ${index + 1} of "${element.id}" grows at ${item.atMs} ms, before its element enters at ${enterAt} ms`
        }
        if (item.atMs + GRAPHIC_BAR_GROW_MS > leaveBy) {
          return `bar ${index + 1} of "${element.id}" grows at ${item.atMs} ms, but must finish growing by ${leaveBy} ms, ${when}`
        }
      }
      const times = barItemTimes(element, enterAt)
      if (times.length > 0 && !times.includes(enterAt)) {
        return `element "${element.id}" would enter empty: at least one bar must grow at its entrance, ${enterAt} ms`
      }
    }
  }

  // Rule 5: the camera's keys in order, each move inside the slot, each focus on screen while it rests.
  const keys = scene.camera ?? []
  for (const [index, key] of keys.entries()) {
    const n = index + 1
    const previous = keys[index - 1]
    if (previous && key.atMs < previous.atMs + GRAPHIC_CAMERA_MOVE_MS) {
      return `camera key ${n} at ${key.atMs} ms must start at least ${GRAPHIC_CAMERA_MOVE_MS} ms after camera key ${index} at ${previous.atMs} ms`
    }
    const latest = durationMs - GRAPHIC_CAMERA_MOVE_MS
    if (key.atMs > latest) {
      return `camera key ${n} at ${key.atMs} ms cannot finish its move in this ${seconds(durationMs)} slot; it must start by ${latest} ms`
    }
    if (key.focus === 'all') continue
    const span = onScreen.get(key.focus)
    if (!span) {
      return `camera key ${n} focuses "${key.focus}", which is not an element of this graphic`
    }
    if (span.fromMs > key.atMs) {
      return `camera key ${n} focuses "${key.focus}" at ${key.atMs} ms, before it enters at ${span.fromMs} ms`
    }
    const restsUntil = keys[index + 1]?.atMs ?? durationMs
    if (span.toMs < restsUntil) {
      return `camera key ${n} rests on "${key.focus}" until ${restsUntil} ms, but it starts to leave at ${span.toMs} ms`
    }
  }

  // Rule 6: no more than six on screen at once.
  const crowd = maxOnScreen(scene)
  if (crowd.count > GRAPHIC_MAX_ON_SCREEN) {
    return `${crowd.count} elements are on screen together at ${crowd.atMs} ms; at most ${GRAPHIC_MAX_ON_SCREEN} may be`
  }

  // Rule 7: a graphic that steps never ends on an empty frame. Stage 1 never stepped.
  const steps = scene.elements.some((element) => element.exit)
  if (steps && !scene.elements.some((element) => element.kind !== 'shape' && !element.exit)) {
    return 'every element leaves before the end; at least one that is not a shape must stay on screen until the slot ends'
  }
  return null
}

/** Every motion in a graphic: when it starts and how long it runs. */
export function graphicMotions(scene: GraphicTimingScene): { atMs: number; durationMs: number }[] {
  const enters = graphicEnterTimes(scene)
  const motions: { atMs: number; durationMs: number }[] = []
  for (const element of scene.elements) {
    const enterAt = enters.get(element.id) ?? 0
    motions.push({ atMs: enterAt, durationMs: GRAPHIC_ENTER_MS })
    if (element.exit) motions.push({ atMs: element.exit.atMs, durationMs: GRAPHIC_EXIT_MS })
    const emphasis = emphasisWindow(element.emphasis, enterAt)
    if (emphasis) motions.push({ atMs: emphasis.atMs, durationMs: emphasis.durationMs })
    for (const item of element.items ?? []) {
      if (item.atMs !== undefined) motions.push({ atMs: item.atMs, durationMs: GRAPHIC_BAR_GROW_MS })
    }
  }
  for (const key of scene.camera ?? []) {
    motions.push({ atMs: key.atMs, durationMs: GRAPHIC_CAMERA_MOVE_MS })
  }
  return motions
}

/** Every moment something starts to change on screen, ascending and distinct. */
export function graphicChangeTimes(scene: GraphicTimingScene): number[] {
  return [...new Set(graphicMotions(scene).map((motion) => motion.atMs))].sort((a, b) => a - b)
}

/**
 * The longest stretch, from the first entrance to the slot's end, in which
 * nothing on screen moves: decision 290's measure of dead air. The drift does
 * not count; it never stops, and it never reads as change.
 */
export function longestStill(
  scene: GraphicTimingScene,
  durationMs: number,
): { fromMs: number; toMs: number } {
  const motions = graphicMotions(scene).sort((a, b) => a.atMs - b.atMs)
  let best = { fromMs: durationMs, toMs: durationMs }
  let movingUntil = motions[0]?.atMs ?? durationMs
  for (const motion of motions) {
    if (motion.atMs - movingUntil > best.toMs - best.fromMs) {
      best = { fromMs: movingUntil, toMs: motion.atMs }
    }
    movingUntil = Math.max(movingUntil, motion.atMs + motion.durationMs)
  }
  if (durationMs - movingUntil > best.toMs - best.fromMs) {
    best = { fromMs: movingUntil, toMs: durationMs }
  }
  return best
}

/** The distinct moments anything starts to leave, ascending: where a graphic's steps end. */
export function graphicExitTimes(scene: GraphicTimingScene): number[] {
  const times = scene.elements.flatMap((element) => (element.exit ? [element.exit.atMs] : []))
  return [...new Set(times)].sort((a, b) => a - b)
}
```

- [ ] **Step 4: Run the schema tests**

Run: `cd packages/schemas && pnpm exec vitest run src/graphics.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing designer test**

Append inside `describe('designGraphic (decision 289)', ...)` in `apps/web/lib/graphic-design.test.ts`, after the "refuses an entrance that cannot finish inside the slot" test:

```ts
  it('refuses an exit that cannot finish inside the slot, and retries with the reason (decision 290)', async () => {
    const leaving = {
      text: JSON.stringify({
        scene: {
          elements: [
            {
              kind: 'figure',
              id: 'f',
              cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
              value: '$4bn',
              claimRef: 1,
              color: 'accent',
              enter: { kind: 'count', atMs: 900 },
            },
            {
              kind: 'text',
              id: 't',
              cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
              content: 'Raised',
              role: 'title',
              color: 'textSecondary',
              enter: { kind: 'fade', atMs: 0 },
              exit: { kind: 'fade', atMs: 5800 },
            },
          ],
        },
      }),
    }
    callLlm.mockResolvedValueOnce(leaving).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).toHaveBeenCalledTimes(2)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'element "t" leaves at 5800 ms, but this 6.0 s slot needs its exit to start by 5500 ms',
    )
  })
```

- [ ] **Step 6: Run it to see it fail**

Run: `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: FAIL (the late exit is accepted; one call only).

- [ ] **Step 7: Hold the designer to the rules**

In `apps/web/lib/graphic-design-core.ts`, replace `lateEntranceIssue,` in the import from `@boom-busters/schemas` with `sceneTimingIssue,`, and in `sceneIssue` replace

```ts
  const timing = lateEntranceIssue(scene, durationMs)
```

with

```ts
  // Every timing rule (decision 290), stage 1's late entrance first.
  const timing = sceneTimingIssue(scene, durationMs)
```

- [ ] **Step 8: Run the web and schema tests**

Run: `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts` and `cd packages/schemas && pnpm exec vitest run`
Expected: PASS (the existing "refuses an entrance..." test still matches `/^element "f" enters at 5800 ms/`).

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src/graphic-timing.ts packages/schemas/src/graphics.test.ts apps/web/lib/graphic-design-core.ts apps/web/lib/graphic-design.test.ts
git commit -m "feat(graphics): the seven timing rules, and the designer held to them (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The camera track survives resolution, redesign and Add logo

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (L908 `resolvePlannedScene` return; L936 to 951 `toPlannedScene`)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (L791)
- Test: `packages/schemas/src/visuals.test.ts`, `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Consumes: `GraphicScene.camera`, `PlannedGraphicScene.camera` (Task 1).
- Produces: `resolvePlannedScene` and `toPlannedScene` return the input's `camera` when it has one and no `camera` key when it has none.

- [ ] **Step 1: Write the failing schema tests**

In `packages/schemas/src/visuals.test.ts`, make sure `resolvePlannedScene`, `toPlannedScene` are imported from `./visuals` and `PlannedGraphicSceneSchema` and `type GraphicScene` from `./graphics`. Append:

```ts
describe('the camera track survives resolution and the redesign mapping (decision 290)', () => {
  const planned = PlannedGraphicSceneSchema.parse({
    elements: [
      {
        kind: 'text',
        id: 't',
        cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
        content: 'Raised',
        role: 'title',
        color: 'textPrimary',
        exit: { kind: 'fade', atMs: 3000 },
      },
      {
        kind: 'text',
        id: 'u',
        cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
        content: 'Then',
        role: 'title',
        color: 'textPrimary',
        enter: { kind: 'fade', atMs: 3000 },
      },
    ],
    camera: [{ atMs: 3500, focus: 'u', zoom: 1.2 }],
  })

  it('keeps the camera and the exits when a planned scene is resolved', () => {
    expect(resolvePlannedScene(planned, [])).toEqual({ scene: planned })
  })

  it('keeps them when a stored scene goes back to the designer', () => {
    expect(toPlannedScene(planned as unknown as GraphicScene, [])).toEqual(planned)
  })

  it('adds no camera to a scene that has none', () => {
    const resolved = resolvePlannedScene({ elements: planned.elements }, [])
    expect('scene' in resolved && 'camera' in resolved.scene).toBe(false)
    expect('camera' in toPlannedScene({ elements: planned.elements } as GraphicScene, [])).toBe(
      false,
    )
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/visuals.test.ts`
Expected: FAIL (the camera is dropped).

- [ ] **Step 3: Carry the camera**

In `packages/schemas/src/visuals.ts`, replace L908 `return { scene: { elements } }` with:

```ts
  // The camera track (decision 290) has no claim or logo in it to map.
  return { scene: { ...(scene.camera ? { camera: scene.camera } : {}), elements } }
```

and in `toPlannedScene` replace `return {` / `elements: scene.elements.map(` (L936 to 937) so the returned object starts:

```ts
  return {
    ...(scene.camera ? { camera: scene.camera } : {}),
    elements: scene.elements.map((element) => {
```

(the rest of the function unchanged).

- [ ] **Step 4: Run the schema tests**

Run: `cd packages/schemas && pnpm exec vitest run src/visuals.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing Add logo test**

In `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`, inside `describeDb('attaching an uploaded mark to a waiting graphic (decision 268, Plan B)', ...)`, after "stays a placeholder without a match", add:

```ts
  it('keeps the camera track when it writes the asset id back (decision 290)', async () => {
    const brief: ShotBrief = {
      type: 'graphic',
      coversText: 'Four.',
      description: 'a graphic',
      motion: { kind: 'static' },
      transition: 'cut',
      scene: {
        elements: [
          {
            kind: 'logo',
            id: 'l1',
            cell: { col: 0, row: 0, colSpan: 4, rowSpan: 4 },
            enter: { kind: 'fade', atMs: 0 },
            entity: 'Wirecard AG',
          },
        ],
        camera: [{ atMs: 1000, focus: 'l1', zoom: 1.2 }],
      },
    }
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      { chapterId, index: 0, type: 'graphic', brief, startMs: 0, durationMs: 6000 },
    ])
    const [slot] = await listShotSlots(db, FIXTURE_PROJECT_ID)
    await setSlotResolution(db, slot!.id, { status: 'placeholder', candidates: [] })
    await db
      .insert(assets)
      .values({
        id: '01HQ00000000000000000000M1',
        kind: 'logo',
        r2Key: 'boom-busters/logos/wirecard.png',
        contentHash: 'fixture-logo-wirecard-ag',
        licence: 'Uploaded by owner',
        title: 'Wirecard AG',
        width: 200,
        height: 200,
      })
      .onConflictDoNothing()

    expect(await attachGraphicLogosAction(FIXTURE_PROJECT_ID, slot!.id)).toEqual({ ok: true })

    const stored = (await getShotSlot(db, slot!.id))!.brief as unknown as {
      scene: { camera?: unknown }
    }
    expect(stored.scene.camera).toEqual([{ atMs: 1000, focus: 'l1', zoom: 1.2 }])
  })
```

- [ ] **Step 6: Run it to see it fail**

Start Docker Desktop first. Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run visuals-actions -t "camera track"`
Expected: FAIL (`stored.scene.camera` is undefined).

- [ ] **Step 7: Keep the scene's other fields**

In `apps/web/app/(console)/projects/[id]/visuals-actions.ts` L791, replace

```ts
  const brief = { ...parsed.data, scene: { elements } }
```

with

```ts
  // Only the marks change; the camera track and anything else on the scene stay (decision 290).
  const brief = { ...parsed.data, scene: { ...scene, elements } }
```

- [ ] **Step 8: Run the action tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run visuals-actions`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.test.ts"
git commit -m "fix(graphics): resolution, redesign and Add logo keep a graphic's camera track (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Layout over time

**Files:**
- Modify: `packages/compositions/src/lib/graphic.ts` (L1 import; `reflowPortrait` L309 to 376; `separateOverlaps` L388 to 448)
- Test: `packages/compositions/src/lib/graphic.test.ts`

**Interfaces:**
- Consumes: `graphicOnScreen`, `intervalsMeet` (Task 1).
- Produces: `separateOverlaps(scene: GraphicScene): GraphicScene` and `reflowPortrait(scene: GraphicScene): GraphicScene` (same signatures), both time-aware and both returning `{ ...scene, elements }`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/compositions/src/lib/graphic.test.ts`:

```ts
describe('layout over time (decision 290)', () => {
  const textAt = (
    id: string,
    row: number,
    enterAt: number,
    exitAt?: number,
  ): GraphicScene['elements'][number] => ({
    kind: 'text',
    id,
    cell: { col: 0, row, colSpan: 12, rowSpan: 2 },
    content: id,
    role: 'title',
    color: 'textPrimary',
    align: 'start',
    enter: { kind: 'fade', atMs: enterAt },
    ...(exitAt === undefined ? {} : { exit: { kind: 'fade' as const, atMs: exitAt } }),
  })

  it('lets an element take the cell of one that has left, in landscape', () => {
    const staged: GraphicScene = { elements: [textAt('a', 4, 0, 4000), textAt('b', 4, 4000)] }
    expect(separateOverlaps(staged)).toEqual(staged)
  })

  it('still separates two elements that are on screen together', () => {
    const crowded: GraphicScene = { elements: [textAt('a', 4, 0, 4000), textAt('b', 4, 3000)] }
    expect(separateOverlaps(crowded).elements[1]!.cell.row).toBe(6)
  })

  it('stacks elements never on screen together in one portrait band', () => {
    // A title that stays; a line that gives way to a second; a note that arrives with the second.
    const staged: GraphicScene = {
      elements: [
        textAt('title', 0, 0),
        textAt('one', 2, 300, 5000),
        textAt('two', 2, 5000),
        textAt('note', 4, 5000),
      ],
    }
    const rows = reflowPortrait(staged).elements.map((element) => element.portraitCell!.row)
    // Three bands of two rows, centred on the 12-row grid: 3, 5 and 7; "one" and "two" share 5.
    expect(rows).toEqual([3, 5, 5, 7])
  })

  it('carries the camera track through both layout passes', () => {
    const tracked: GraphicScene = {
      elements: [textAt('a', 4, 0)],
      camera: [{ atMs: 1000, focus: 'a', zoom: 1.2 }],
    }
    expect(separateOverlaps(tracked).camera).toEqual(tracked.camera)
    expect(reflowPortrait(tracked).camera).toEqual(tracked.camera)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/compositions && pnpm exec vitest run src/lib/graphic.test.ts`
Expected: FAIL (the cross-fade is pushed down; four bands; camera dropped).

- [ ] **Step 3: Make both passes time-aware**

In `packages/compositions/src/lib/graphic.ts`:

1. Replace L1 with:

```ts
import {
  GRAPHIC_ENTER_MS,
  GRAPHIC_GRID,
  graphicEnterTimes,
  graphicOnScreen,
  intervalsMeet,
} from '@boom-busters/schemas'
```

2. In `reflowPortrait`, add to its doc comment, before the closing `*/`:

```ts
 *
 * Over time (decision 290): flowing elements that are never on screen together share a
 * band, so a graphic built in steps does not shrink every step to make room for the
 * others. Each joins the first band none of whose occupants it ever meets on screen.
 * In a scene where nothing leaves, every element meets every other, so each gets a band
 * of its own and the stack is exactly what it always was.
```

and replace the body from `const top = ...` (L341) to the end of the function (L376) with:

```ts
  const onScreen = graphicOnScreen(scene)
  const spanOf = (index: number) => onScreen.get(scene.elements[index]!.id)!
  const bands: { indices: number[]; want: number }[] = []
  for (const entry of flowing) {
    const span = spanOf(entry.index)
    const want = Math.min(entry.element.cell.rowSpan, GRAPHIC_GRID)
    const shared = bands.find((band) =>
      band.indices.every((other) => !intervalsMeet(span, spanOf(other))),
    )
    if (shared) {
      shared.indices.push(entry.index)
      shared.want = Math.max(shared.want, want)
    } else {
      bands.push({ indices: [entry.index], want })
    }
  }

  const top = GRAPHIC_GRID - pinnedBottom >= bands.length ? pinnedBottom : 0
  let remaining = GRAPHIC_GRID - top
  let left = bands.length
  let cursor = top

  const placed: { indices: number[]; row: number; rowSpan: number }[] = []
  for (const band of bands) {
    // Reserve one row for every band still to be placed, so the running total can
    // never exceed what is left and this never needs a clamp.
    const rowSpan = Math.max(1, Math.min(band.want, remaining - (left - 1)))
    placed.push({ indices: band.indices, row: cursor, rowSpan })
    cursor += rowSpan
    remaining -= rowSpan
    left -= 1
  }

  // With nothing pinned the stack is the whole composition, and stacked from the top it
  // left the rest of a tall frame empty: centre it. Any pin keeps the flow where it was
  // put, below the pin, because the pin is the author's own placement of the rest.
  const shift = pinnedBottom === 0 ? Math.floor((GRAPHIC_GRID - (cursor - top)) / 2) : 0
  const cellByIndex = new Map<number, GraphicCell>()
  for (const band of placed) {
    for (const index of band.indices) {
      cellByIndex.set(index, {
        col: 0,
        row: band.row + shift,
        colSpan: GRAPHIC_GRID,
        rowSpan: band.rowSpan,
      })
    }
  }

  const elements = scene.elements.map((element, index) =>
    element.portraitCell ? element : { ...element, portraitCell: cellByIndex.get(index)! },
  )
  return { ...scene, elements }
}
```

3. In `separateOverlaps`, add to its doc comment, before the closing `*/`:

```ts
 *
 * Over time (decision 290): two elements collide only when they are on screen together.
 * An element entering as another leaves may take its cell; that is a cross-fade, not an
 * overlap. In a scene where nothing leaves, every pair is on screen together, so this is
 * the same pass it always was.
```

and replace its body (L414 to 447) with:

```ts
  const onScreen = graphicOnScreen(scene)
  const taken: { id: string; cell: GraphicCell }[] = []
  const blocked = (id: string, cell: GraphicCell) =>
    taken.some(
      (other) =>
        cellsIntersect(cell, other.cell) &&
        intervalsMeet(onScreen.get(id)!, onScreen.get(other.id)!),
    )
  const elements = scene.elements.map((element) => {
    if (element.kind === 'shape') return element

    const planned = element.cell
    if (!blocked(element.id, planned)) {
      taken.push({ id: element.id, cell: planned })
      return element
    }

    // Downward from where it was asked to sit, and only then upward. Down
    // first is what keeps reading order: a figure that collided with the
    // heading above it must not be answered by putting it above the heading.
    const maxRow = GRAPHIC_GRID - planned.rowSpan
    const below = Array.from(
      { length: Math.max(0, maxRow - planned.row + 1) },
      (_, i) => planned.row + i,
    )
    const above = Array.from(
      { length: Math.min(planned.row, maxRow + 1) },
      (_, i) => planned.row - 1 - i,
    )
    for (const row of [...below, ...above]) {
      const candidate = { ...planned, row }
      if (!blocked(element.id, candidate)) {
        taken.push({ id: element.id, cell: candidate })
        return { ...element, cell: candidate }
      }
    }
    // Nowhere clear at this size: keep what was planned rather than lose the element.
    taken.push({ id: element.id, cell: planned })
    return element
  })
  return { ...scene, elements }
```

- [ ] **Step 4: Run the layout tests**

Run: `cd packages/compositions && pnpm exec vitest run src/lib/graphic.test.ts`
Expected: PASS, every existing `reflowPortrait` and `separateOverlaps` test included.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/lib/graphic.ts packages/compositions/src/lib/graphic.test.ts
git commit -m "feat(graphics): layout reads time, so a step can take the cell the last one left (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The motion module

**Files:**
- Create: `packages/compositions/src/lib/graphic-motion.ts`
- Modify: `packages/compositions/package.json` (`exports`)
- Test: `packages/compositions/src/lib/graphic-motion.test.ts` (new)

**Interfaces:**
- Consumes: `emphasisWindow`, `graphicOnScreen`, `GRAPHIC_BAR_GROW_MS`, `GRAPHIC_CAMERA_MOVE_MS`, `GRAPHIC_EXIT_MS`, `GRAPHIC_MAX_ZOOM`, `type EmphasisWindow` (Task 1); `safeArea`, `tokenColor`, `type Box`, `type ElementBox`, `type GraphicFrame` from `./graphic`; `easeInOut` from `./motion`.
- Produces (importable as `@boom-busters/compositions/graphic-motion`):
  - `spanProgress(timeMs: number, atMs: number, durationMs: number): number`
  - `exitProgress(timeMs: number, exitAtMs: number): number`
  - `barGrowth(timeMs: number, atMs: number): number`
  - `barScale(items: readonly { value: number; atMs: number }[], timeMs: number): number`
  - `settledBarScale(items: readonly { value: number; atMs: number }[], timeMs: number): number`
  - `mixColor(from: string, to: string, t: number): string`
  - `elementColorAt(color: GraphicColor, window: EmphasisWindow | null, timeMs: number, brand: BrandKitTokens): string`
  - `colorTokenAt(color: GraphicColor, window: EmphasisWindow | null, timeMs: number): GraphicColor`
  - `pulseScaleAt(timeMs: number, window: EmphasisWindow | null): number`
  - `underlineSweepAt(timeMs: number, window: EmphasisWindow | null): number | undefined`
  - `interface CameraView { scale: number; x: number; y: number }`, `CAMERA_REST: CameraView`
  - `cameraFraming(focus: Box | null, zoom: number, frame: GraphicFrame): CameraView`
  - `graphicCamera(scene: GraphicScene, boxes: readonly ElementBox[], frame: GraphicFrame, timeMs: number): CameraView`
  - `onScreenAt(scene: GraphicScene, timeMs: number): Set<string>`

- [ ] **Step 1: Write the failing tests**

Create `packages/compositions/src/lib/graphic-motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, emphasisWindow, resolveBrandKit } from '@boom-busters/schemas'
import type { GraphicScene } from '@boom-busters/schemas'
import { safeArea, tokenColor } from './graphic'
import {
  barGrowth,
  barScale,
  CAMERA_REST,
  cameraFraming,
  colorTokenAt,
  elementColorAt,
  exitProgress,
  graphicCamera,
  mixColor,
  onScreenAt,
  pulseScaleAt,
  settledBarScale,
  spanProgress,
  underlineSweepAt,
} from './graphic-motion'

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const WIDE = { width: 1920, height: 1080 }

describe('spans, exits and bars growing', () => {
  it('eases 0 to 1 across a span, 0 before it and 1 after', () => {
    expect(spanProgress(900, 1000, 500)).toBe(0)
    expect(spanProgress(1250, 1000, 500)).toBeCloseTo(0.5)
    expect(spanProgress(2000, 1000, 500)).toBe(1)
  })

  it('takes 500 ms to leave and 700 ms to grow a bar', () => {
    expect(exitProgress(4250, 4000)).toBeCloseTo(0.5)
    expect(exitProgress(4500, 4000)).toBe(1)
    expect(barGrowth(2350, 2000)).toBeCloseTo(0.5)
    expect(barGrowth(2700, 2000)).toBe(1)
  })
})

describe('barScale: the value a full-length bar stands for', () => {
  it('holds still for bars that all grow at the entrance, as stage 1 drew them', () => {
    const items = [
      { value: 4, atMs: 300 },
      { value: 3.9, atMs: 300 },
    ]
    expect(barScale(items, 0)).toBe(4)
    expect(barScale(items, 5000)).toBe(4)
  })

  it('keeps stage 1 floor of 1 for small values', () => {
    expect(
      barScale(
        [
          { value: 0.5, atMs: 0 },
          { value: 0.3, atMs: 0 },
        ],
        1000,
      ),
    ).toBe(1)
  })

  it('eases up to a larger bar while it grows, so the first shrinks to its share', () => {
    const items = [
      { value: 1, atMs: 300 },
      { value: 4, atMs: 10_000 },
    ]
    expect(barScale(items, 5000)).toBe(1)
    expect(barScale(items, 10_350)).toBeCloseTo(2.5)
    expect(barScale(items, 11_000)).toBe(4)
  })

  it('never comes back down for a smaller later bar (a decline)', () => {
    const items = [
      { value: 4, atMs: 300 },
      { value: 1, atMs: 10_000 },
    ]
    expect(barScale(items, 10_350)).toBe(4)
    expect(barScale(items, 11_000)).toBe(4)
  })

  it('settles at the largest bar grown by a moment, for a still frame', () => {
    const items = [
      { value: 1, atMs: 300 },
      { value: 4, atMs: 10_000 },
    ]
    expect(settledBarScale(items, 5000)).toBe(1)
    expect(settledBarScale(items, 10_000)).toBe(4)
  })
})

describe('colour, pulse and underline at a time', () => {
  it('blends two hex colours', () => {
    expect(mixColor('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('shifts an element to its colour emphasis and holds it there', () => {
    const shift = emphasisWindow({ kind: 'color', atMs: 5000, to: 'collapse' }, 0)
    const own = tokenColor('accent', brand)
    const target = tokenColor('collapse', brand)
    expect(elementColorAt('accent', shift, 4000, brand)).toBe(own)
    expect(elementColorAt('accent', shift, 5200, brand)).toBe(mixColor(own, target, 0.5))
    expect(elementColorAt('accent', shift, 9000, brand)).toBe(mixColor(own, target, 1))
    // No colour emphasis: the token itself, exactly as stage 1 drew it.
    expect(elementColorAt('accent', emphasisWindow('pulse', 0), 9000, brand)).toBe(own)
    expect(colorTokenAt('accent', shift, 4999)).toBe('accent')
    expect(colorTokenAt('accent', shift, 5000)).toBe('collapse')
  })

  it('pulses and sweeps where stage 1 did for the word forms', () => {
    // Word-form pulse on an element entering at 1000 ms: 1600 to 1960 ms, peak 4% at 1780.
    const pulse = emphasisWindow('pulse', 1000)
    expect(pulseScaleAt(1600, pulse)).toBe(1)
    expect(pulseScaleAt(1780, pulse)).toBeCloseTo(1.04)
    expect(pulseScaleAt(1960, pulse)).toBe(1)
    // Word-form underline: its sweep runs 1500 to 2100 ms.
    const underline = emphasisWindow('underline', 1000)
    expect(underlineSweepAt(1500, underline)).toBe(0)
    expect(underlineSweepAt(1800, underline)).toBeCloseTo(0.5)
    expect(underlineSweepAt(9000, underline)).toBe(1)
    expect(underlineSweepAt(9000, pulse)).toBeUndefined()
  })
})

describe('the camera', () => {
  const safe = safeArea(WIDE)
  const centre = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 }

  it('cannot pan at zoom 1', () => {
    expect(cameraFraming({ x: 1400, y: 200, w: 300, h: 200 }, 1, WIDE)).toEqual(CAMERA_REST)
  })

  it('puts a box at the safe area centre', () => {
    const box = { x: centre.x - 200, y: centre.y - 100, w: 400, h: 200 }
    const view = cameraFraming(box, 1.4, WIDE)
    expect(view.scale).toBe(1.4)
    expect(view.x + view.scale * centre.x).toBeCloseTo(centre.x)
    expect(view.y + view.scale * centre.y).toBeCloseTo(centre.y)
  })

  it('caps the pan so the composition edges never come inside the frame', () => {
    const view = cameraFraming({ x: 1700, y: 60, w: 180, h: 120 }, 1.5, WIDE)
    expect(view.x).toBeCloseTo(WIDE.width * (1 - 1.5))
    expect(view.y).toBe(0)
  })

  it('caps the zoom so the box still fits the safe area', () => {
    const box = { x: safe.x, y: safe.y, w: safe.w / 1.2, h: safe.h / 2 }
    expect(cameraFraming(box, 1.6, WIDE).scale).toBeCloseTo(1.2)
  })

  it('rests until the first key, moves over 1.5 s, holds, and moves on from there', () => {
    const scene: GraphicScene = {
      elements: [
        {
          kind: 'text',
          id: 'a',
          cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
          content: 'a',
          role: 'title',
          color: 'textPrimary',
          align: 'start',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
      camera: [
        { atMs: 2000, focus: 'a', zoom: 1.4 },
        { atMs: 6000, focus: 'all', zoom: 1 },
      ],
    }
    const boxes = [{ id: 'a', x: 100, y: 100, w: 600, h: 200 }]
    const framed = cameraFraming(boxes[0]!, 1.4, WIDE)
    expect(graphicCamera(scene, boxes, WIDE, 1000)).toEqual(CAMERA_REST)
    expect(graphicCamera(scene, boxes, WIDE, 2750).scale).toBeCloseTo(1.2)
    expect(graphicCamera(scene, boxes, WIDE, 5000)).toEqual(framed)
    expect(graphicCamera(scene, boxes, WIDE, 9000)).toEqual(CAMERA_REST)
    expect(graphicCamera({ elements: scene.elements }, boxes, WIDE, 5000)).toEqual(CAMERA_REST)
  })
})

describe('onScreenAt: what a still frame of a moment shows', () => {
  it('shows what has entered and has not started to leave', () => {
    const scene: GraphicScene = {
      elements: (['a', 'b'] as const).map((id, index) => ({
        kind: 'text' as const,
        id,
        cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
        content: id,
        role: 'title' as const,
        color: 'textPrimary' as const,
        align: 'start' as const,
        enter: { kind: 'fade' as const, atMs: index * 4000 },
        ...(index === 0 ? { exit: { kind: 'fade' as const, atMs: 4000 } } : {}),
      })),
    }
    expect([...onScreenAt(scene, 3999)]).toEqual(['a'])
    expect([...onScreenAt(scene, 4000)]).toEqual(['b'])
    expect([...onScreenAt(scene, Number.MAX_SAFE_INTEGER)]).toEqual(['b'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/compositions && pnpm exec vitest run src/lib/graphic-motion.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `packages/compositions/src/lib/graphic-motion.ts`:

```ts
import {
  GRAPHIC_BAR_GROW_MS,
  GRAPHIC_CAMERA_MOVE_MS,
  GRAPHIC_EXIT_MS,
  GRAPHIC_MAX_ZOOM,
  graphicOnScreen,
} from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  EmphasisWindow,
  GraphicColor,
  GraphicScene,
} from '@boom-busters/schemas'
import { safeArea, tokenColor, type Box, type ElementBox, type GraphicFrame } from './graphic'
import { easeInOut } from './motion'

/**
 * A graphic over time (decision 290): exits, bars that grow one at a time and
 * rescale, colour shifts, timed emphasis and the camera. Pure and unit-tested,
 * like `graphic.ts`; `GraphicCard` reads it frame by frame, and the board's
 * preview reads the still moments, so the two never keep their own copies.
 */

/** Eased 0..1 through a span that starts at `atMs`: 0 before it, 1 after it. */
export function spanProgress(timeMs: number, atMs: number, durationMs: number): number {
  const t = timeMs - atMs
  if (t <= 0) return 0
  return easeInOut(Math.min(1, t / durationMs))
}

/** How far an exit has gone at this time. */
export function exitProgress(timeMs: number, exitAtMs: number): number {
  return spanProgress(timeMs, exitAtMs, GRAPHIC_EXIT_MS)
}

/** How far one bar has grown at this time. */
export function barGrowth(timeMs: number, atMs: number): number {
  return spanProgress(timeMs, atMs, GRAPHIC_BAR_GROW_MS)
}

/**
 * The value a full-length bar stands for at this time. Bars that grow at the
 * entrance set it at once, as they always have, never below 1 (stage 1's
 * floor). A later, larger bar eases it up over the 700 ms it grows, so the
 * bars already there shrink to their share as it arrives; a smaller one
 * leaves it where it is. It never comes back down.
 */
export function barScale(items: readonly { value: number; atMs: number }[], timeMs: number): number {
  if (items.length === 0) return 1
  const first = Math.min(...items.map((item) => item.atMs))
  let scale = Math.max(
    1,
    ...items.filter((item) => item.atMs === first).map((item) => Math.abs(item.value)),
  )
  const later = [...new Set(items.map((item) => item.atMs).filter((at) => at > first))].sort(
    (a, b) => a - b,
  )
  for (const at of later) {
    const growth = barGrowth(timeMs, at)
    if (growth <= 0) break
    const target = Math.max(
      scale,
      ...items.filter((item) => item.atMs === at).map((item) => Math.abs(item.value)),
    )
    scale += (target - scale) * growth
  }
  return scale
}

/** The scale once every bar grown by `timeMs` has finished growing: what a still frame shows. */
export function settledBarScale(
  items: readonly { value: number; atMs: number }[],
  timeMs: number,
): number {
  if (items.length === 0) return 1
  const first = Math.min(...items.map((item) => item.atMs))
  const grown = items.filter((item) => item.atMs === first || item.atMs <= timeMs)
  return Math.max(1, ...grown.map((item) => Math.abs(item.value)))
}

/** A blend of two `#rrggbb` colours, `t` of the way from `from` to `to`. */
export function mixColor(from: string, to: string, t: number): string {
  const clamped = Math.min(1, Math.max(0, t))
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16)
  const mixed = [1, 3, 5].map((at) =>
    Math.round(channel(from, at) + (channel(to, at) - channel(from, at)) * clamped),
  )
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

/**
 * An element's colour at this time: its own token, blended over 400 ms to the
 * token a colour emphasis names once that emphasis starts, and held there.
 * With no colour emphasis it is the token itself, exactly as stage 1 drew it.
 */
export function elementColorAt(
  color: GraphicColor,
  window: EmphasisWindow | null,
  timeMs: number,
  brand: BrandKitTokens,
): string {
  const own = tokenColor(color, brand)
  if (window?.kind !== 'color' || window.to === undefined) return own
  const shift = spanProgress(timeMs, window.atMs, window.durationMs)
  if (shift <= 0) return own
  return mixColor(own, tokenColor(window.to as GraphicColor, brand), shift)
}

/** The colour token a still frame of this moment draws an element in. */
export function colorTokenAt(
  color: GraphicColor,
  window: EmphasisWindow | null,
  timeMs: number,
): GraphicColor {
  return window?.kind === 'color' && window.to !== undefined && window.atMs <= timeMs
    ? (window.to as GraphicColor)
    : color
}

/** The pulse emphasis: a 4% swell and back across its window. */
export function pulseScaleAt(timeMs: number, window: EmphasisWindow | null): number {
  if (window?.kind !== 'pulse') return 1
  const t = timeMs - window.atMs
  if (t <= 0 || t >= window.durationMs) return 1
  return 1 + 0.04 * Math.sin((t / window.durationMs) * Math.PI)
}

/** The underline emphasis's sweep, 0 to 1, or undefined when the element has none. */
export function underlineSweepAt(
  timeMs: number,
  window: EmphasisWindow | null,
): number | undefined {
  if (window?.kind !== 'underline') return undefined
  return spanProgress(timeMs, window.atMs, window.durationMs)
}

/** Where the camera sits: `translate(x, y) scale(scale)` about the frame's top-left corner. */
export interface CameraView {
  scale: number
  x: number
  y: number
}

export const CAMERA_REST: CameraView = { scale: 1, x: 0, y: 0 }

/**
 * The camera framing `focus` (a laid-out box, or null for the whole
 * composition) at `zoom`: the box's centre aimed at the safe area's centre,
 * the zoom capped so the box still fits the safe area (a push in never puts
 * it under the captions), and the pan capped so the composition's edges never
 * come inside the frame. At zoom 1 there is nowhere to pan.
 */
export function cameraFraming(focus: Box | null, zoom: number, frame: GraphicFrame): CameraView {
  const safe = safeArea(frame)
  const fit = focus ? Math.min(safe.w / focus.w, safe.h / focus.h) : Number.POSITIVE_INFINITY
  const scale = Math.max(1, Math.min(zoom, GRAPHIC_MAX_ZOOM, fit))
  const box = focus ?? safe
  const target = { x: safe.x + safe.w / 2, y: safe.y + safe.h / 2 }
  const clamp = (value: number, size: number) => Math.min(0, Math.max(size * (1 - scale), value))
  return {
    scale,
    x: clamp(target.x - scale * (box.x + box.w / 2), frame.width),
    y: clamp(target.y - scale * (box.y + box.h / 2), frame.height),
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/**
 * The camera at this time (decision 290): at rest until the first key, then
 * each key's move eased over `GRAPHIC_CAMERA_MOVE_MS` from wherever the camera
 * was, holding between keys. It frames laid-out boxes, so one track serves
 * 16:9 and 9:16 alike. A scene with no camera is always at rest.
 */
export function graphicCamera(
  scene: GraphicScene,
  boxes: readonly ElementBox[],
  frame: GraphicFrame,
  timeMs: number,
): CameraView {
  const keys = [...(scene.camera ?? [])].sort((a, b) => a.atMs - b.atMs)
  let view = CAMERA_REST
  for (const key of keys) {
    if (timeMs <= key.atMs) break
    const box = key.focus === 'all' ? null : (boxes.find((b) => b.id === key.focus) ?? null)
    const target = cameraFraming(box, key.zoom, frame)
    const p = spanProgress(timeMs, key.atMs, GRAPHIC_CAMERA_MOVE_MS)
    view = {
      scale: lerp(view.scale, target.scale, p),
      x: lerp(view.x, target.x, p),
      y: lerp(view.y, target.y, p),
    }
  }
  return view
}

/** Which elements a still frame of this moment shows: entered by it, not yet leaving. */
export function onScreenAt(scene: GraphicScene, timeMs: number): Set<string> {
  const ids = new Set<string>()
  for (const [id, span] of graphicOnScreen(scene)) {
    if (span.fromMs <= timeMs && timeMs < span.toMs) ids.add(id)
  }
  return ids
}
```

In `packages/compositions/package.json`, under `exports`, after `"./graphic": "./src/lib/graphic.ts",` add:

```json
    "./graphic-motion": "./src/lib/graphic-motion.ts",
```

- [ ] **Step 4: Run the tests**

Run: `cd packages/compositions && pnpm exec vitest run src/lib/graphic-motion.test.ts src/lib/graphic.test.ts`
Expected: PASS. If `graphicCamera(..., 5000)` is not exactly `framed` because of floating point in the lerp at p = 1, it is: `lerp(a, b, 1)` is `a + (b - a)`, which can differ from `b` in the last bit; in that case change the hold assertion to `toMatchObject` with `toBeCloseTo` on each field rather than loosening anything else.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/lib/graphic-motion.ts packages/compositions/src/lib/graphic-motion.test.ts packages/compositions/package.json
git commit -m "feat(graphics): exits, rescaling bars, colour shifts, timed emphasis and the camera, as pure functions (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The card plays it, with goldens

**Files:**
- Modify: `packages/compositions/src/components/GraphicCard.tsx`
- Modify: `packages/compositions/src/fixtures/graphic.ts` (append `GRAPHIC_STAGED_SCENE`)
- Modify: `packages/compositions/src/Root.tsx` (after `GraphicCardTall`, L350)
- Modify: `packages/compositions/src/snapshot/render.test.ts` (`SnapshotCase`, `CASES`, the loop)
- Modify: `packages/compositions/src/fixtures/fixtures.test.ts` (append)
- Create: four golden PNGs under `packages/compositions/src/snapshot/golden/`

**Interfaces:**
- Consumes: Task 5's module; `barItemTimes`, `emphasisWindow`, `sceneTimingIssue`, `GraphicPayloadSchema`, `type GraphicExit` from `@boom-busters/schemas`.
- Produces: `GRAPHIC_STAGED_SCENE: GraphicPayload` and `GRAPHIC_STAGED_DURATION_MS = 9000` from `fixtures/graphic.ts`; compositions `GraphicCardStagedWide` and `GraphicCardStagedTall` (270 frames).

- [ ] **Step 1: Write the staged fixture and its failing check**

Append to `packages/compositions/src/fixtures/graphic.ts`:

```ts
/** The staged fixture's slot: 9 s, 270 frames at 30 fps. */
export const GRAPHIC_STAGED_DURATION_MS = 9000

/**
 * A graphic built in steps (decision 290), one of each new motion: a title
 * that leaves and a second that takes its cell, bars that grow one at a time
 * and rescale, a colour shift and a camera push. At 1.5 s the first bar fills
 * the width alone; at 4 s the second has grown and the first is a quarter; at
 * 8.5 s the second title is up, the bars are red and the camera is in.
 */
export const GRAPHIC_STAGED_SCENE: GraphicPayload = {
  kind: 'graphic',
  scene: {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 1, row: 2, colSpan: 10, rowSpan: 1 },
        content: 'Valuation, on paper',
        role: 'title',
        color: 'textSecondary',
        align: 'center',
        enter: { kind: 'fade', atMs: 0 },
        exit: { kind: 'fade', atMs: 4000 },
      },
      {
        kind: 'text',
        id: 't2',
        cell: { col: 1, row: 2, colSpan: 10, rowSpan: 1 },
        content: 'Four times in six months',
        role: 'title',
        color: 'textPrimary',
        align: 'center',
        enter: { kind: 'rise', atMs: 4500 },
      },
      {
        kind: 'bars',
        id: 'b1',
        cell: { col: 1, row: 3, colSpan: 10, rowSpan: 5 },
        color: 'series0',
        highlightIndex: 1,
        enter: { kind: 'wipe', atMs: 300 },
        emphasis: { kind: 'color', atMs: 5500, to: 'collapse' },
        items: [
          { label: 'Oct 2022', value: 1, display: '$1bn', claimRef: '01HQ00000000000000000000AA' },
          {
            label: 'Sought, 2023',
            value: 4,
            display: '$4bn',
            claimRef: '01HQ00000000000000000000AB',
            atMs: 2000,
          },
        ],
      },
    ],
    camera: [{ atMs: 6000, focus: 'b1', zoom: 1.25 }],
  },
  logos: {},
  claimIds: ['01HQ00000000000000000000AA', '01HQ00000000000000000000AB'],
}
```

Append to `packages/compositions/src/fixtures/fixtures.test.ts` (adding `GraphicPayloadSchema`, `sceneTimingIssue` to its `@boom-busters/schemas` import and `GRAPHIC_STAGED_DURATION_MS`, `GRAPHIC_STAGED_SCENE` from `./graphic`):

```ts
describe('the staged graphic fixture (decision 290)', () => {
  it('is a valid payload that passes every timing rule for its slot', () => {
    const parsed = GraphicPayloadSchema.parse(JSON.parse(JSON.stringify(GRAPHIC_STAGED_SCENE)))
    expect(sceneTimingIssue(parsed.scene, GRAPHIC_STAGED_DURATION_MS)).toBeNull()
  })
})
```

Run: `cd packages/compositions && pnpm exec vitest run src/fixtures/fixtures.test.ts`
Expected: PASS (the fixture and the rules already exist; this pins the fixture before goldens are drawn from it).

- [ ] **Step 2: Add the compositions and the snapshot cases**

In `packages/compositions/src/Root.tsx`, import `GRAPHIC_STAGED_SCENE` next to `GRAPHIC_SCENE`, and after the `GraphicCardTall` composition add:

```tsx
      <Composition
        id="GraphicCardStagedWide"
        component={GraphicCard}
        durationInFrames={270}
        {...WIDE}
        defaultProps={{ payload: GRAPHIC_STAGED_SCENE, brand: FIXTURE_BRAND, durationInFrames: 270 }}
      />

      <Composition
        id="GraphicCardStagedTall"
        component={GraphicCard}
        durationInFrames={270}
        {...TALL}
        defaultProps={{ payload: GRAPHIC_STAGED_SCENE, brand: FIXTURE_BRAND, durationInFrames: 270 }}
      />
```

In `packages/compositions/src/snapshot/render.test.ts`:

1. Add to `SnapshotCase`:

```ts
  /** The golden's name, when one composition is pinned at more than one frame. */
  name?: string
```

2. After the `GraphicCardTall` case add:

```ts
  // Graphics that move with the narration (decision 290): one staged scene at
  // three moments. 1.5 s: the first bar alone fills the width. 4 s: the second
  // bar has grown, the first is a quarter, and the first title is about to
  // leave. 8.5 s: the second title, the bars shifted to red, the camera in.
  { id: 'GraphicCardStagedWide', name: 'GraphicCardStagedWide-1500ms', frame: 45, maxDiffRatio: 0.06 },
  { id: 'GraphicCardStagedWide', name: 'GraphicCardStagedWide-4000ms', frame: 120, maxDiffRatio: 0.06 },
  { id: 'GraphicCardStagedWide', name: 'GraphicCardStagedWide-8500ms', frame: 255, maxDiffRatio: 0.06 },
  { id: 'GraphicCardStagedTall', name: 'GraphicCardStagedTall-8500ms', frame: 255, maxDiffRatio: 0.06 },
```

3. In the loop, use the name for the test title, the output and the golden:

```ts
  for (const snapshot of CASES) {
    const name = snapshot.name ?? snapshot.id
    it(`${name} still matches its golden frame`, async () => {
      const composition = await selectComposition({ serveUrl, id: snapshot.id })
      const output = path.join(outDir, `${name}.png`)
```

and replace both later uses of `` `${snapshot.id}.png` `` and `snapshot.id` in the golden path and the two failure messages with `name`.

- [ ] **Step 3: Run the staged snapshots to see them fail**

Run (Bash `timeout: 600000`): `cd packages/compositions && pnpm exec vitest run src/snapshot/render.test.ts -t "GraphicCardStaged"`
Expected: FAIL with "no golden for GraphicCardStagedWide-1500ms" (and the other three).

- [ ] **Step 4: Teach the card the motion**

In `packages/compositions/src/components/GraphicCard.tsx`:

1. Replace the imports (L1 to 23) with:

```tsx
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import { barItemTimes, emphasisWindow } from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  GraphicElement,
  GraphicExit,
  GraphicPayload,
} from '@boom-busters/schemas'
import {
  barLengthPx,
  barsGapPx,
  barsGeometry,
  countedValue,
  enterProgress,
  figureLabelBasePx,
  figureLabelGapPx,
  graphicDrift,
  graphicLayout,
  LINE_HEIGHT_EM,
  roleFontPx,
  ruleThicknessPx,
  staggeredEnterMs,
  underlineBar,
  type ElementBox,
} from '../lib/graphic'
import {
  barGrowth,
  barScale,
  elementColorAt,
  exitProgress,
  graphicCamera,
  pulseScaleAt,
  underlineSweepAt,
} from '../lib/graphic-motion'
import { mediaUrl } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'
```

2. In the file's doc comment, after "bar that sweeps in beneath the text.", add: "Since decision 290 an element may leave, a bar may grow at its own time (the scale easing to the largest bar on screen), an emphasis may fall at a set time or shift the element's colour, and a camera may push in on one element; every one of these reads `graphic-motion.ts`."

3. Delete `PULSE_AT_MS`, `PULSE_MS`, `BAR_GROW_MS` (L35 to 37) and the `pulseScale` function (L73 to 78). After `enterStyle`, add:

```tsx
/** Leaving the frame (decision 290): the entrances in reverse, over `GRAPHIC_EXIT_MS`. */
function exitStyle(kind: GraphicExit['kind'], progress: number, scale: number): CSSProperties {
  switch (kind) {
    case 'drop':
      return { opacity: 1 - progress, transform: `translateY(${progress * 24 * scale}px)` }
    case 'wipe':
      return { clipPath: `inset(0 0 0 ${progress * 100}%)` }
    case 'fade':
      return { opacity: 1 - progress }
  }
}
```

4. In `GraphicCard`, replace the lines from `const frame = useCurrentFrame()` to `const { colors, typography } = brand` with:

```tsx
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const timeMs = (frame / fps) * 1000
  const scale = frameScale(width, height)
  const boxes = graphicLayout(payload.scene, { width, height }, brand)
  const byId = new Map(boxes.map((box) => [box.id, box]))
  const enterAt = staggeredEnterMs(payload.scene)
  const drift = durationInFrames === undefined ? 1 : graphicDrift(frame, durationInFrames)
  // A scene with no camera keeps the stage 1 card exactly: no transform at all.
  const camera =
    payload.scene.camera && payload.scene.camera.length > 0
      ? graphicCamera(payload.scene, boxes, { width, height }, timeMs)
      : null
  const { colors, typography } = brand
```

5. Wrap the drift `<div>` (the one with `transform: \`scale(${drift})\``) in a camera `<div>`, so the JSX after the gradient reads:

```tsx
      {/*
        The camera (decision 290) wraps the drift: it reframes the composition, and the
        drift keeps running inside it so the frame is never dead still.
      */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          ...(camera
            ? {
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
                transformOrigin: '0 0',
              }
            : {}),
        }}
      >
        {/* existing drift <div> with its elements, unchanged except as below */}
      </div>
```

6. Replace the per-element prelude, from `const box = byId.get(element.id) as ElementBox` to the `const underlineProgress = ...` statement, with:

```tsx
          const box = byId.get(element.id) as ElementBox
          const atMs = enterAt.get(element.id) ?? element.enter.atMs
          const progress = enterProgress(frame, fps, atMs)
          const leaving = element.exit ? exitProgress(timeMs, element.exit.atMs) : 0
          // Gone once its exit has finished (decision 290).
          if (leaving >= 1) return null
          const emphasis = emphasisWindow(element.emphasis, atMs)
          const pulse = pulseScaleAt(timeMs, emphasis)
          // The checks finish an entrance before its exit starts, so a leaving
          // element's style is its exit's alone.
          const motion =
            element.exit && leaving > 0
              ? exitStyle(element.exit.kind, leaving, scale)
              : enterStyle(element.enter.kind, progress, scale)
          const base: CSSProperties = {
            position: 'absolute',
            left: box.x,
            top: box.y,
            width: box.w,
            height: box.h,
            ...motion,
            ...(pulse !== 1 ? { transform: `scale(${pulse})` } : {}),
            transformOrigin: 'center',
          }
          const underlineProgress = underlineSweepAt(timeMs, emphasis)
```

7. Colours: in the `text` case replace `color: tokenColor(element.color, brand),` with `color: elementColorAt(element.color, emphasis, timeMs, brand),`; in the `figure` case replace the value span's `color: tokenColor(element.color, brand),` the same way; in the `shape` case replace `const colour = withAlpha(tokenColor(element.color, brand), element.opacity)` with `const colour = withAlpha(elementColorAt(element.color, emphasis, timeMs, brand), element.opacity)`. Remove `tokenColor` from the `../lib/graphic` import if nothing else uses it (step 1's import already omits it).

8. Replace the `bars` case's opening lines and row loop so it reads:

```tsx
            case 'bars': {
              // Each bar grows at its own time (decision 290); the scale eases to the
              // largest bar on screen. Bars that all grow at the entrance hold one scale,
              // exactly as before.
              const times = barItemTimes(element, atMs)
              const full = barScale(
                element.items.map((item, index) => ({
                  value: item.value,
                  atMs: times[index] ?? atMs,
                })),
                timeMs,
              )
              const litColour = elementColorAt(element.color, emphasis, timeMs, brand)
              const { rowH, labelPx } = barsGeometry(box, element.items.length, { width, height })
              return (
                <div key={element.id} style={base}>
                  {element.items.map((item, index) => {
                    const lit =
                      element.highlightIndex === undefined || element.highlightIndex === index
                    const colour = lit ? litColour : withAlpha(colors.textSecondary, 0.5)
                    const grow = barGrowth(timeMs, times[index] ?? atMs)
                    const barW = barLengthPx(box.w, Math.abs(item.value) / full, grow)
                    return (
                      <div
                        key={item.label}
                        style={{
                          position: 'absolute',
                          top: rowH * index,
                          height: rowH,
                          width: box.w,
                          display: 'flex',
                          alignItems: 'center',
                          gap: barsGapPx({ width, height }),
                          // A timed bar's label and value arrive with it.
                          ...(item.atMs !== undefined ? { opacity: grow } : {}),
                        }}
                      >
```

(the three children of the row, label span, bar div and value span, unchanged).

- [ ] **Step 5: Typecheck and run the unit tests**

Run: `cd packages/compositions && pnpm exec tsc --noEmit && pnpm exec vitest run src/lib src/fixtures`
Expected: PASS.

- [ ] **Step 6: Draw the four new goldens, and only those**

Run (Bash `timeout: 600000`): `cd packages/compositions && REGEN_GOLDEN=1 pnpm exec vitest run src/snapshot/render.test.ts -t "GraphicCardStaged"`
Then `git status --short packages/compositions/src/snapshot/golden` must list exactly four new files (`GraphicCardStagedWide-1500ms.png`, `-4000ms.png`, `-8500ms.png`, `GraphicCardStagedTall-8500ms.png`) and no modified file. Open each PNG with the Read tool and confirm: 1500 ms shows "Valuation, on paper" and one full-length bar; 4000 ms shows both bars with the first about a quarter of the second and the first title still up; 8500 ms shows "Four times in six months", the lit bar in the collapse red, and the bars larger and centred (the camera in); the tall frame shows the same in 9:16. If any frame is wrong, fix the code, not the golden, and redraw only that case.

- [ ] **Step 7: Run every golden without regeneration**

Run (Bash `timeout: 600000`): `cd packages/compositions && pnpm exec vitest run src/snapshot/render.test.ts`
Expected: PASS, every stage 1 golden included and none rewritten. If a stage 1 graphic golden fails here, run that case alone (`-t "GraphicCardWide"`) before believing it (goldens flake under a full run); a real failure means the card changed a stage 1 frame, which this plan forbids: fix the code.

- [ ] **Step 8: Commit**

```bash
git add packages/compositions/src/components/GraphicCard.tsx packages/compositions/src/fixtures/graphic.ts packages/compositions/src/fixtures/fixtures.test.ts packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts packages/compositions/src/snapshot/golden/GraphicCardStaged*.png
git commit -m "feat(graphics): the card plays exits, timed bars, colour shifts, timed emphasis and the camera (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The designer learns the vocabulary; the mock builds in steps

**Files:**
- Modify: `packages/providers/src/prompts/graphics.ts` (imports; `GRAPHIC_ANSWER_TOKENS` L26; `SYSTEM` L55 to 137; `mockGraphicScene` L226 to 283)
- Test: `packages/providers/src/prompts/graphics.test.ts`, `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: `GRAPHIC_EXIT_MS`, `GRAPHIC_MAX_ON_SCREEN`, `MAX_GRAPHIC_ELEMENTS`, `sceneTimingIssue` (Tasks 1 and 2); Task 3's camera carry-through (the web mock test reads `scene.camera` after resolution).
- Produces: `GRAPHIC_ANSWER_TOKENS = 4000`; `MOCK_STAGED_MIN_MS = 8000`; `mockGraphicScene` returns a two-step scene with a camera key for slots of 8 s or more.

- [ ] **Step 1: Write the failing prompt and mock tests**

In `packages/providers/src/prompts/graphics.test.ts`, add `import { PlannedGraphicSceneSchema, sceneTimingIssue } from '@boom-busters/schemas'` (merging with the existing `ValidationError` import) and `MOCK_STAGED_MIN_MS` to the import from `./graphics`.

Change the examples test: rename it to `'shows four worked examples that parse, are vertically centred on the 12-row grid, and pass the timing rules in a 22.3 s slot'`, change `expect(examples).toHaveLength(3)` to `toHaveLength(4)`, and inside its `for` loop, after `const scene = parseGraphicScene(example)`, add `expect(sceneTimingIssue(scene, 22_300)).toBeNull()`.

Append:

```ts
describe('the motion vocabulary in the prompt (decision 290)', () => {
  const system = buildGraphicRequest(input()).system
  const rules = system.replace(/\s+/g, ' ')

  it('states the limits and teaches exits, timed emphasis, timed bars and the camera', () => {
    expect(rules).toContain('6 on screen at once is the ceiling, and 10 across the whole slot')
    expect(rules).toContain(
      'A graphic on screen for more than about 8 s changes each time the words bring something new',
    )
    expect(rules).toContain('A step makes way for the next rather than piling up')
    expect(rules).toContain('Move the camera to what is being said, never at random')
    expect(rules).toContain('"exit" is {"kind": "fade"|"drop"|"wipe", "atMs"}')
    expect(rules).toContain(
      '{"kind": "pulse"|"underline"|"color", "atMs", "to"?} at a time you choose',
    )
    expect(rules).toContain('A bar item\'s "atMs" is when that bar grows in')
    expect(rules).toContain('"camera" (optional, on the scene) is up to 4 keys')
    expect(rules).toContain('at least one bar grows with the entrance')
  })

  it('shows a long slot built in steps as its fourth example', () => {
    const last = system.split('Example,').at(-1)!
    const scene = parseGraphicScene(last.slice(last.indexOf('\n') + 1).trim())
    expect(scene.elements.some((element) => element.exit)).toBe(true)
    expect(scene.camera).toHaveLength(1)
  })

  it('gives the answer more room for a longer scene', () => {
    expect(GRAPHIC_ANSWER_TOKENS).toBe(4000)
  })
})

describe('mockGraphicScene in steps (decision 290)', () => {
  it('builds a long slot in two steps that pass the timing rules', () => {
    const scene = mockGraphicScene({
      claimTexts: CLAIMS.map((c) => c.text),
      intentRefs: [1],
      logoTitles: ['Acme'],
      durationMs: 12_000,
    })
    expect(scene.elements.map((element) => element.id)).toEqual(['t1', 't2', 'f1', 'l1'])
    expect(scene.elements[0]).toMatchObject({ exit: { kind: 'fade', atMs: 6000 } })
    expect(scene.elements[1]).toMatchObject({
      cell: scene.elements[0]!.cell,
      enter: { kind: 'rise', atMs: 6500 },
    })
    expect(scene.camera).toEqual([{ atMs: 6500, focus: 'f1', zoom: 1.2 }])
    expect(PlannedGraphicSceneSchema.safeParse(scene).success).toBe(true)
    expect(sceneTimingIssue(scene, 12_000)).toBeNull()
  })

  it('keeps a slot under 8 s to one step, as before', () => {
    expect(MOCK_STAGED_MIN_MS).toBe(8000)
    const scene = mockGraphicScene({ claimTexts: ['4 billion'], intentRefs: [1], durationMs: 6000 })
    expect(scene.elements.some((element) => element.exit)).toBe(false)
    expect(scene.camera).toBeUndefined()
    expect(sceneTimingIssue(scene, 6000)).toBeNull()
  })
})
```

In `apps/web/lib/graphic-design.test.ts`, after the "makes no call in mock mode" test, add:

```ts
  it('designs a long slot in two steps in mock mode, through the same checks (decision 290)', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, { ...SLOT, durationMs: 12_000 })
    expect(callLlm).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      ok: true,
      scene: { camera: [{ atMs: 6500, focus: 'f1', zoom: 1.2 }] },
    })
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/graphics.test.ts` and `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: FAIL (three examples; rules missing; mock has one step; budget 3000).

- [ ] **Step 3: Rewrite the prompt's vocabulary and add the rules**

In `packages/providers/src/prompts/graphics.ts`:

1. The import from `@boom-busters/schemas` becomes:

```ts
import {
  figureDigitGroups,
  GRAPHIC_COLORS,
  GRAPHIC_EXIT_MS,
  GRAPHIC_MAX_ON_SCREEN,
  GRAPHIC_TYPE_ROLES,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  ValidationError,
} from '@boom-busters/schemas'
```

2. `export const GRAPHIC_ANSWER_TOKENS = 4000` with its comment changed to: "A scene of ten elements and a camera track is well under this; the rest is the model's room to think."

3. In `SYSTEM`, replace `Return JSON only: {"scene": {"elements": [element, ...]}}.` with `Return JSON only: {"scene": {"elements": [element, ...], "camera"?: [key, ...]}}.`

4. Replace the "Fewer elements beat more." bullet with:

```
- Fewer elements beat more. Two or three on screen at once is common;
  ${GRAPHIC_MAX_ON_SCREEN} on screen at once is the ceiling, and ${MAX_GRAPHIC_ELEMENTS} across the whole slot.
```

5. After the "Time entrances to the words." bullet (the one ending "so it can finish."), insert:

```
- Keep a long graphic moving with the narration. A graphic on screen for more
  than about 8 s changes each time the words bring something new: an element
  enters or leaves, a bar grows, a colour shifts, or the camera moves. A long
  stretch where nothing changes while the narrator keeps talking is the
  failure to avoid.
- Build in steps. A step makes way for the next rather than piling up: give
  what the narration has finished with an "exit", and let the next element
  take its cell. Bars can arrive one at a time, each as its amount is named
  (an "atMs" on the item); the scale rescales as a bigger bar grows in.
- Move the camera to what is being said, never at random: push in on the
  element the narrator is talking about, or back out to "all". The camera
  rests on an element only while that element is on screen.
- Motion earns its place like everything else: one change for each new thing
  said, never motion for its own sake.
- Timing limits, all from the slot's start: an exit starts once its element's
  entrance (600 ms) and emphasis have finished, and its ${GRAPHIC_EXIT_MS} ms end by the slot's
  end; a timed emphasis starts after its element's entrance has finished; a
  bar's own "atMs" falls while its element is on screen, and at least one bar
  grows with the entrance; camera keys run in order, at least 1.5 s apart, and
  each move ends by the slot's end; and when anything leaves, at least one
  element that is not a shape stays to the end.
```

6. Replace the element and field lines (from `{"kind": "text", ...` through `"emphasis" is "pulse"|"underline". Ids are unique; one logo per entity.`) with:

```
{"kind": "text", "id", "cell", "content" (max 120 chars), "role": ${GRAPHIC_TYPE_ROLES.map((r) => `"${r}"`).join('|')},
 "color", "align"?: "start"|"center"|"end", "enter"?, "exit"?, "emphasis"?}
{"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
 "claimRef": claim number, "color", "align"?: "start"|"center"|"end", "enter"?, "exit"?, "emphasis"?}
{"kind": "logo", "id", "cell", "entity": the exact name, "enter"?, "exit"?, "emphasis"? (a pulse only)}
{"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1, "exit"?, "emphasis"?}
{"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number, "atMs"?}] (2 to 5),
 "color", "highlightIndex"?, "enter"?, "exit"?, "emphasis"?}
"cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid (0-based).
"portraitCell" (optional, same shape) places the element on the 9:16 Shorts
frame; leave it out to let the layout stack elements in reading order.
"color" is one of ${GRAPHIC_COLORS.join(', ')}.
"enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"} ("count" only on a figure); an entrance takes 600 ms.
"exit" is {"kind": "fade"|"drop"|"wipe", "atMs"}: the element leaves, taking ${GRAPHIC_EXIT_MS} ms. Leave it out and the element stays to the end.
"emphasis" is "pulse"|"underline" (just after the entrance), or
 {"kind": "pulse"|"underline"|"color", "atMs", "to"?} at a time you choose. "color" shifts the element to the colour "to" names and keeps it; never on a logo. "underline" only on a text or a figure.
A bar item's "atMs" is when that bar grows in (700 ms), with its label and value; leave it out and it grows with the element.
"camera" (optional, on the scene) is up to 4 keys {"atMs", "focus": an element id or "all", "zoom": 1 to 1.6}; each starts a 1.5 s move to frame its focus, then holds.
Ids are unique; one logo per entity.
```

7. After the third example (the relationship between named marks), append:

```

Example, a long slot built in steps (22.3 s; "1 billion" said at 2.3 s, "4 billion" at 10.9 s, "Four times" at 14.2 s):
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "Stability AI valuation", "role": "title", "color": "textSecondary", "align": "center", "enter": {"kind": "fade", "atMs": 2300}, "exit": {"kind": "fade", "atMs": 13700}},
 {"kind": "text", "id": "x", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 1}, "content": "Four times", "role": "title", "color": "accent", "align": "center", "enter": {"kind": "rise", "atMs": 14200}},
 {"kind": "bars", "id": "b", "cell": {"col": 1, "row": 4, "colSpan": 10, "rowSpan": 5}, "items": [{"label": "Oct 2022", "value": 1, "display": "$1bn", "claimRef": 5}, {"label": "Sought, 2023", "value": 4, "display": "$4bn", "claimRef": 6, "atMs": 10900}], "color": "series0", "highlightIndex": 1, "enter": {"kind": "wipe", "atMs": 2300}, "emphasis": {"kind": "color", "atMs": 14200, "to": "accent"}}],
 "camera": [{"atMs": 14200, "focus": "b", "zoom": 1.15}]}}
```

(the template literal's closing backtick moves to after this example).

- [ ] **Step 4: The mock builds in steps**

Replace `mockGraphicScene` with:

```ts
/** The shortest slot the mock builds in two steps (decision 290). */
export const MOCK_STAGED_MIN_MS = 8000

/**
 * Deterministic design for MOCK_PROVIDERS=1: the figure's digits truly come
 * from the cited claim. A slot of 8 s or more is built in two steps (decision
 * 290): halfway through, the title leaves, a second line takes its cell, and
 * the camera pushes in on the figure, so tests and e2e see a staged graphic
 * without spending.
 */
export function mockGraphicScene(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  logoTitles?: readonly string[]
  guidance?: string
  durationMs: number
}): PlannedGraphicScene {
  const ref = input.intentRefs.find(
    (n) => figureDigitGroups(input.claimTexts[n - 1] ?? '').length > 0,
  )
  const text = ref ? input.claimTexts[ref - 1]! : ''
  const digits = figureDigitGroups(text)[0]
  const value = text.toLowerCase().includes('billion') ? `$${digits}bn` : digits
  const landAt = Math.min(900, Math.max(0, input.durationMs - 700))
  const title = input.guidance
    ? `[mock] Redesigned: ${input.guidance}`.slice(0, 120)
    : '[mock] Raised in one round'
  const logoTitle = input.logoTitles?.[0]
  const hasFigure = ref !== undefined && digits !== undefined
  const titleCell = { col: 0, row: 0, colSpan: 7, rowSpan: 2 }
  const staged = input.durationMs >= MOCK_STAGED_MIN_MS
  const half = Math.floor(input.durationMs / 2)
  const stepTwoAt = half + GRAPHIC_EXIT_MS
  return {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: titleCell,
        content: title,
        role: 'title',
        color: 'textSecondary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
        ...(staged ? { exit: { kind: 'fade' as const, atMs: half } } : {}),
      },
      ...(staged
        ? [
            {
              kind: 'text' as const,
              id: 't2',
              cell: titleCell,
              content: '[mock] Then the next step',
              role: 'title' as const,
              color: 'textSecondary' as const,
              align: 'start' as const,
              enter: { kind: 'rise' as const, atMs: stepTwoAt },
            },
          ]
        : []),
      ...(hasFigure
        ? [
            {
              kind: 'figure' as const,
              id: 'f1',
              cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 },
              value: value ?? digits,
              claimRef: ref,
              color: 'accent' as const,
              enter: { kind: 'count' as const, atMs: landAt },
            },
          ]
        : []),
      ...(logoTitle
        ? [
            {
              kind: 'logo' as const,
              id: 'l1',
              cell: { col: 8, row: 1, colSpan: 4, rowSpan: 4 },
              entity: logoTitle,
              enter: { kind: 'fade' as const, atMs: 0 },
            },
          ]
        : []),
    ],
    ...(staged && hasFigure ? { camera: [{ atMs: stepTwoAt, focus: 'f1', zoom: 1.2 }] } : {}),
  } as PlannedGraphicScene
}
```

- [ ] **Step 5: Run the provider and web tests**

Run: `cd packages/providers && pnpm exec vitest run` and `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: PASS. If the examples test fails on the fourth example's centring (`top + bottom` must be 12), the cells above are rows 3 to 9; recheck you copied them exactly.

- [ ] **Step 6: Commit**

```bash
git add packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts apps/web/lib/graphic-design.test.ts
git commit -m "feat(prompts): the graphics designer learns steps, the camera and timed emphasis; the mock builds in two steps (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The board shows any moment, and a frame per step

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/slot-previews.tsx` (imports L14 to 35; `GraphicPreview` L561 to 905; append `GraphicSteps`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (import of `GraphicPreview` near L99; `GraphicSlot` L1255 to 1258)
- Test: `apps/web/app/(console)/projects/[id]/slot-previews.test.tsx`

**Interfaces:**
- Consumes: `onScreenAt`, `colorTokenAt`, `settledBarScale` from `@boom-busters/compositions/graphic-motion` (Task 5); `barItemTimes`, `emphasisWindow`, `graphicEnterTimes`, `graphicExitTimes` from `@boom-busters/schemas` (Tasks 1 and 2).
- Produces: `GraphicPreview({ brief, brand, logoUrls, atMs?, label? })` where `atMs` defaults to the end of the graphic (`Number.MAX_SAFE_INTEGER`) and `label` overrides the SVG's accessible name; `GraphicSteps({ brief, brand, logoUrls })`, a `<ul aria-label="Graphic steps">` of frames named `Step: At m:ss` and `Step: End`, or nothing when no element exits.

- [ ] **Step 1: Write the failing tests**

In `apps/web/app/(console)/projects/[id]/slot-previews.test.tsx`, add `within` to the `@testing-library/react` import, `barLengthPx` to the import from `@boom-busters/compositions/graphic`, and `GraphicSteps` to the import from `./slot-previews`. Append:

```tsx
describe('a graphic built in steps (decision 290)', () => {
  const staged: DesignedGraphicBrief = {
    type: 'graphic',
    coversText: 'It was worth one billion, then four.',
    description: 'Two steps.',
    motion: { kind: 'static' },
    transition: 'cut',
    scene: {
      elements: [
        {
          kind: 'text',
          id: 't1',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          content: 'On paper',
          role: 'title',
          color: 'textSecondary',
          align: 'start',
          enter: { kind: 'fade', atMs: 0 },
          exit: { kind: 'fade', atMs: 4000 },
        },
        {
          kind: 'text',
          id: 't2',
          cell: { col: 0, row: 0, colSpan: 12, rowSpan: 2 },
          content: 'Four times',
          role: 'title',
          color: 'textPrimary',
          align: 'start',
          enter: { kind: 'rise', atMs: 4500 },
          emphasis: { kind: 'color', atMs: 6000, to: 'collapse' },
        },
        {
          kind: 'bars',
          id: 'b1',
          cell: { col: 0, row: 3, colSpan: 12, rowSpan: 4 },
          color: 'series0',
          enter: { kind: 'fade', atMs: 300 },
          items: [
            { label: 'then', value: 1, display: '$1bn', claimRef: CLAIM },
            { label: 'later', value: 4, display: '$4bn', claimRef: CLAIM, atMs: 2000 },
          ],
        },
      ],
    },
  }
  const tokens = resolveBrandKit(DEFAULT_SETTINGS)
  const barsBox = graphicLayout(staged.scene, GRAPHIC_FRAME, tokens).find((b) => b.id === 'b1')!
  const barWidth = (display: string) =>
    Number(screen.getByText(display).previousElementSibling?.getAttribute('width'))

  it('draws the end by default: what stays, every bar on the final scale, colours after their shift', () => {
    render(<GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    expect(screen.queryByText('On paper')).toBeNull()
    expect(screen.getByText('Four times')).toHaveAttribute('fill', tokens.colors.semantic.collapse)
    expect(barWidth('$1bn')).toBeCloseTo(barLengthPx(barsBox.w, 1 / 4))
    expect(barWidth('$4bn')).toBeCloseTo(barLengthPx(barsBox.w, 1))
  })

  it('draws an earlier moment: who is on screen then, the bars grown by then, on their scale then', () => {
    render(
      <GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} atMs={1000} />,
    )
    expect(screen.getByText('On paper')).toBeInTheDocument()
    expect(screen.queryByText('Four times')).toBeNull()
    expect(screen.queryByText('$4bn')).toBeNull()
    // Alone, the first bar is the full length.
    expect(barWidth('$1bn')).toBeCloseTo(barLengthPx(barsBox.w, 1))
  })

  it('shows a frame per step, labelled by time, and nothing for a graphic that never steps', () => {
    render(<GraphicSteps brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
    const list = screen.getByRole('list', { name: 'Graphic steps' })
    expect(within(list).getAllByRole('img').map((img) => img.getAttribute('aria-label'))).toEqual([
      'Step: At 0:04',
      'Step: End',
    ])
    expect(within(list).getAllByText('On paper')).toHaveLength(1)

    const { container } = render(
      <GraphicSteps brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('gives every drawing its own clip ids, so two frames of one graphic never share one', () => {
    const { container } = render(
      <>
        <GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />
        <GraphicPreview brief={staged} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} atMs={1000} />
      </>,
    )
    const ids = [...container.querySelectorAll('clipPath')].map((clip) => clip.id)
    expect(ids.length).toBeGreaterThan(1)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd apps/web && pnpm exec vitest run slot-previews`
Expected: FAIL (`GraphicSteps` not exported; "On paper" drawn at the end; clip ids repeat).

- [ ] **Step 3: Draw any moment**

In `apps/web/app/(console)/projects/[id]/slot-previews.tsx`:

1. After the `@boom-busters/compositions/graphic` import add:

```ts
import {
  colorTokenAt,
  onScreenAt,
  settledBarScale,
} from '@boom-busters/compositions/graphic-motion'
```

and change the `@boom-busters/schemas` value import to:

```ts
import {
  barItemTimes,
  DEFAULT_SETTINGS,
  emphasisWindow,
  graphicEnterTimes,
  graphicExitTimes,
  resolveBrandKit,
} from '@boom-busters/schemas'
```

2. After `GRAPHIC_FRAME`, add:

```ts
/** The end of any graphic: every entrance has happened and every exit is over. */
const GRAPHIC_END_MS = Number.MAX_SAFE_INTEGER
```

3. Change the doc comment's first line to "The graphic preview (decision 268, Plan B): one moment of the graphic, the end unless `atMs` says otherwise (decision 290), drawn from the SAME geometry the render uses, ...", and the signature and setup to:

```tsx
export function GraphicPreview({
  brief,
  brand,
  logoUrls,
  atMs = GRAPHIC_END_MS,
  label,
}: {
  brief: DesignedGraphicBrief
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
  /** The moment drawn, from the slot's start; the end of the graphic by default. */
  atMs?: number
  /** The drawing's accessible name, when it is not the card's own thumbnail. */
  label?: string
}) {
  // The layout wants the resolved shape; `voice` is unused by a still preview.
  const brandTokens = resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand })
  const boxes = graphicLayout(brief.scene, GRAPHIC_FRAME, brandTokens)
  const byId = new Map(boxes.map((box) => [box.id, box]))
  const visible = onScreenAt(brief.scene, atMs)
  const enters = graphicEnterTimes(brief.scene)
  // Clip ids are document-wide: a card draws one graphic more than once (decision 290),
  // and two graphics can share an element id, so each drawing gets its own prefix.
  const clipPrefix = React.useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const { colors, typography } = brandTokens
```

4. `aria-label={`graphic: ${brief.coversText}`}` becomes `aria-label={label ?? `graphic: ${brief.coversText}`}`.

5. At the top of the `brief.scene.elements.map` callback, replace

```tsx
        const box = byId.get(element.id)
        if (!box) return null
```

with

```tsx
        const box = byId.get(element.id)
        if (!box || !visible.has(element.id)) return null
        const enterAt = enters.get(element.id) ?? 0
        const emphasis = emphasisWindow(element.emphasis, enterAt)
        const underlined = emphasis?.kind === 'underline' && emphasis.atMs <= atMs
```

6. In the `text` case: the clip ids become `` `${clipPrefix}-clip-${element.id}` `` in both the `clipPath` attribute (`url(#...)`) and the `<clipPath id>`; `element.emphasis === 'underline'` becomes `underlined`; `fill={tokenColor(element.color, brandTokens)}` becomes `fill={tokenColor(colorTokenAt(element.color, emphasis, atMs), brandTokens)}`.

7. In the `figure` case: `element.emphasis === 'underline'` becomes `underlined`; the value's `fill` becomes `tokenColor(colorTokenAt(element.color, emphasis, atMs), brandTokens)`.

8. In the `shape` case: `const colour = tokenColor(element.color, brandTokens)` becomes `const colour = tokenColor(colorTokenAt(element.color, emphasis, atMs), brandTokens)`.

9. In the `bars` case replace

```tsx
            const max = Math.max(...element.items.map((item) => Math.abs(item.value)), 1)
```

with

```tsx
            // The bars grown by this moment, on the scale they settle at (decision 290).
            const times = barItemTimes(element, enterAt)
            const max = settledBarScale(
              element.items.map((item, index) => ({
                value: item.value,
                atMs: times[index] ?? enterAt,
              })),
              atMs,
            )
            const litColour = tokenColor(colorTokenAt(element.color, emphasis, atMs), brandTokens)
```

and inside `element.items.map((item, index) => {`, first thing:

```tsx
                  if ((times[index] ?? enterAt) > atMs) return null
```

and the bar's `fill={lit ? tokenColor(element.color, brandTokens) : colors.textSecondary}` becomes `fill={lit ? litColour : colors.textSecondary}`.

10. Append after `GraphicPreview`:

```tsx
/** A slot clock, as the board writes it elsewhere: 4000 is "0:04". */
function clockOf(ms: number): string {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * A graphic built in steps (decision 290): one small frame just before each
 * moment something leaves, and one of the end, so every word and figure can
 * be checked without pressing Play. Nothing at all for a graphic that never
 * steps. The frames leave the camera out, so the whole composition shows.
 */
export function GraphicSteps({
  brief,
  brand,
  logoUrls,
}: {
  brief: DesignedGraphicBrief
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
}) {
  const exits = graphicExitTimes(brief.scene)
  if (exits.length === 0) return null
  const frames = [
    ...exits.map((exitAt) => ({ key: String(exitAt), atMs: exitAt - 1, label: `At ${clockOf(exitAt)}` })),
    { key: 'end', atMs: GRAPHIC_END_MS, label: 'End' },
  ]
  return (
    <ul aria-label="Graphic steps" className="grid grid-cols-3 gap-1">
      {frames.map((frame) => (
        <li key={frame.key} className="flex flex-col gap-0.5">
          <GraphicPreview
            brief={brief}
            brand={brand}
            logoUrls={logoUrls}
            atMs={frame.atMs}
            label={`Step: ${frame.label}`}
          />
          <span className="text-[11px] text-[var(--color-text-secondary)]">{frame.label}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 4: Put the steps on the card**

In `apps/web/app/(console)/projects/[id]/visual-board.tsx`, import `GraphicSteps` next to `GraphicPreview`, and in `GraphicSlot` replace

```tsx
        playing ? null : (
          <GraphicPreview brief={{ ...brief, scene }} brand={brand} logoUrls={slot.logoUrls} />
        )
```

with

```tsx
        playing ? null : (
          <>
            <GraphicPreview brief={{ ...brief, scene }} brand={brand} logoUrls={slot.logoUrls} />
            <GraphicSteps brief={{ ...brief, scene }} brand={brand} logoUrls={slot.logoUrls} />
          </>
        )
```

- [ ] **Step 5: Run the board tests**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm exec vitest run slot-previews visual-board graphic-player`
Expected: PASS. If an existing test locates the thumbnail with `getByRole('img', { name: /graphic: / })` and now finds more than one, it is a staged scene only in this task's tests; stage 1 fixtures draw no strip.

- [ ] **Step 6: Typecheck and lint the web app**

Run (Bash `timeout: 600000`): `pnpm typecheck` and `cd apps/web && pnpm exec eslint --max-warnings 0 "app/(console)/projects/[id]/slot-previews.tsx" "app/(console)/projects/[id]/visual-board.tsx"`
Expected: no errors, no warnings.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/slot-previews.tsx" "apps/web/app/(console)/projects/[id]/slot-previews.test.tsx" "apps/web/app/(console)/projects/[id]/visual-board.tsx"
git commit -m "feat(board): a graphic card draws any moment and a frame per step, with clip ids of its own (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The harness sees the new motion and measures dead air

**Files:**
- Modify: `packages/compositions/scripts/graphic-frames/frame-times.ts`
- Test: `packages/compositions/scripts/graphic-frames/frame-times.test.ts`
- Create: `apps/web/lib/live-graphic-still.ts`, `apps/web/lib/live-graphic-still.test.ts`
- Modify: `apps/web/lib/graphic-design-core.ts` (export `slotNarration`)
- Modify: `apps/web/scripts/live-graphic-test.ts` (`SlotRecord`; after `record.after = result.scene`; the closing summary)

**Interfaces:**
- Consumes: `graphicChangeTimes`, `longestStill` (Task 2).
- Produces: `framesToRender(scene: GraphicTimingScene, durationMs: number): number[]` takes a frame 700 ms after every change; `stillOf(scene: GraphicScene, durationMs: number, words: readonly { offsetMs: number }[]): { fromMs: number; toMs: number; words: number }`; `slotNarration` exported from `graphic-design-core.ts`; `SlotRecord.still?`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/compositions/scripts/graphic-frames/frame-times.test.ts`, inside its `describe`:

```ts
  it('takes a frame after every change: exits, timed bars and camera moves too (decision 290)', () => {
    const staged = {
      elements: [
        { id: 't', enter: { atMs: 0 }, exit: { atMs: 2000 } },
        { id: 'b', enter: { atMs: 300 }, items: [{}, { atMs: 1000 }] },
      ],
      camera: [{ atMs: 2500, focus: 'b' }],
    }
    // Changes at 0, 300, 1000, 2000 and 2500 ms, each plus 700 ms.
    expect(framesToRender(staged, 4000)).toEqual([9, 21, 30, 51, 81, 96, 119])
  })
```

Create `apps/web/lib/live-graphic-still.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { GraphicScene } from '@boom-busters/schemas'
import { stillOf } from './live-graphic-still'

describe('stillOf (decision 290)', () => {
  it('reports the longest still stretch and how many words are spoken in it', () => {
    const scene: GraphicScene = {
      elements: [
        {
          kind: 'text',
          id: 't',
          cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 },
          content: 'Stability AI valuation',
          role: 'title',
          color: 'textSecondary',
          align: 'center',
          enter: { kind: 'fade', atMs: 2300 },
        },
      ],
    }
    const words = [{ offsetMs: 1000 }, { offsetMs: 5000 }, { offsetMs: 12_000 }]
    expect(stillOf(scene, 22_300, words)).toEqual({ fromMs: 2900, toMs: 22_300, words: 2 })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/compositions && pnpm exec vitest run scripts/graphic-frames` and `cd apps/web && pnpm exec vitest run lib/live-graphic-still.test.ts`
Expected: FAIL (exits and camera moves give no frame; module not found).

- [ ] **Step 3: Frames at every change, and the still measure**

Replace `packages/compositions/scripts/graphic-frames/frame-times.ts` with:

```ts
import { graphicChangeTimes } from '@boom-busters/schemas'
import type { GraphicTimingScene } from '@boom-busters/schemas'
import { msToFrames } from '../../src/lib/motion'

export const FPS = 30
/** The first look: before most entrances, so the empty or half-built card shows. */
export const FIRST_LOOK_MS = 300
/** An entrance takes 600 ms and a bar's growth 700, so this shows each change settled. */
export const SETTLE_MS = 700

/**
 * The frames worth looking at in a graphic of this length: 0.3 s, every
 * change (an entrance, an exit, a timed bar, an emphasis, a camera move;
 * decision 290) plus 700 ms, and the last frame. Clamped inside the slot,
 * distinct and ascending.
 */
export function framesToRender(scene: GraphicTimingScene, durationMs: number): number[] {
  const last = Math.max(0, msToFrames(durationMs, FPS) - 1)
  const wanted = [
    msToFrames(FIRST_LOOK_MS, FPS),
    ...graphicChangeTimes(scene).map((atMs) => msToFrames(atMs + SETTLE_MS, FPS)),
    last,
  ]
  return [...new Set(wanted.map((frame) => Math.min(last, Math.max(0, frame))))].sort(
    (a, b) => a - b,
  )
}
```

Create `apps/web/lib/live-graphic-still.ts`:

```ts
import { longestStill } from '@boom-busters/schemas'
import type { GraphicScene } from '@boom-busters/schemas'

/**
 * A designed graphic's longest still stretch, for the live harness's record
 * (decision 290): where nothing on screen changes, and how many words the
 * narrator speaks meanwhile. A long stretch with words in it is dead air.
 */
export function stillOf(
  scene: GraphicScene,
  durationMs: number,
  words: readonly { offsetMs: number }[],
): { fromMs: number; toMs: number; words: number } {
  const still = longestStill(scene, durationMs)
  return {
    ...still,
    words: words.filter((word) => word.offsetMs >= still.fromMs && word.offsetMs < still.toMs)
      .length,
  }
}
```

- [ ] **Step 4: Record it in the harness**

In `apps/web/lib/graphic-design-core.ts`, change `function slotNarration(` to `export function slotNarration(` and add to its doc comment: "Exported for the live harness's still measure (decision 290)."

In `apps/web/scripts/live-graphic-test.ts`:

1. Import `slotNarration` alongside `designGraphicWith, loadGraphicContextFrom` from `@/lib/graphic-design-core`, and `import { stillOf } from '@/lib/live-graphic-still'`.

2. In `SlotRecord`, after `after?: GraphicScene`, add:

```ts
  /** The designed scene's longest still stretch on the slot clock, and the words spoken in it (decision 290). */
  still?: { fromMs: number; toMs: number; words: number }
```

3. Replace

```ts
        if (result.ok) {
          record.after = result.scene
        } else {
```

with

```ts
        if (result.ok) {
          record.after = result.scene
          const timing = {
            chapterId: slot.chapterId,
            startMs: slot.startMs,
            durationMs: slot.durationMs,
            brief,
          }
          record.still = stillOf(
            result.scene,
            slot.durationMs,
            slotNarration(context, timing).words,
          )
        } else {
```

4. After `console.log(\`Total spent: $${budget.spentUsd.toFixed(4)}\`)`, add:

```ts
    for (const record of slots) {
      if (!record.still) continue
      const seconds = ((record.still.toMs - record.still.fromMs) / 1000).toFixed(1)
      console.log(
        `slot ${record.index}: longest still ${seconds} s of ${(record.durationMs / 1000).toFixed(1)} s, ${record.still.words} words spoken in it`,
      )
    }
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `cd packages/compositions && pnpm exec vitest run scripts/graphic-frames`, `cd apps/web && pnpm exec vitest run lib/live-graphic-still.test.ts lib/graphic-design.test.ts`, then `pnpm typecheck`
Expected: PASS; the existing frame-times tests are unchanged in outcome.

- [ ] **Step 6: Render the staged fixture through the harness's renderer**

Run (Bash `timeout: 600000`): `cd packages/compositions && pnpm render:graphics --fixture` and open the printed folder's PNGs with the Read tool. Expected: frames at each change of the stage 1 fixture, as before (the fixture run uses `GRAPHIC_SCENE`). No paid call is made.

- [ ] **Step 7: Commit**

```bash
git add packages/compositions/scripts/graphic-frames/frame-times.ts packages/compositions/scripts/graphic-frames/frame-times.test.ts apps/web/lib/live-graphic-still.ts apps/web/lib/live-graphic-still.test.ts apps/web/lib/graphic-design-core.ts apps/web/scripts/live-graphic-test.ts
git commit -m "feat(graphics): the live harness frames every change and records each graphic's longest still stretch (decision 290)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: e2e, the full suite and PROGRESS

**Files:**
- Modify: `e2e/global-setup.ts` (the resolved graphic's scene, near L950 to 980)
- Modify: `e2e/tests/visual-plan.spec.ts` (the "a graphic card plays the real graphic" test, L224 to 241)
- Modify: `PROGRESS.md` (append decision 290)

**Interfaces:**
- Consumes: everything above.
- Produces: the seeded resolved graphic has a line that leaves at 3 s; PROGRESS decision 290.

- [ ] **Step 1: Seed a staged graphic**

In `e2e/global-setup.ts`, in the resolved graphic's `scene.elements` (the one whose `coversText` is `'It raised four billion dollars.'`), after the logo element `l1`, add:

```ts
                {
                  // Decision 290: a line that leaves at 3 s, so the card shows its steps.
                  kind: 'text',
                  id: 't2',
                  cell: { col: 0, row: 9, colSpan: 12, rowSpan: 2 },
                  enter: { kind: 'fade', atMs: 0 },
                  exit: { kind: 'fade', atMs: 3000 },
                  content: 'In one round',
                  role: 'body',
                  color: 'textSecondary',
                  align: 'start',
                },
```

- [ ] **Step 2: Assert the steps in e2e**

In `e2e/tests/visual-plan.spec.ts`, at the start of the test `'a graphic card plays the real graphic and offers a redesign (decision 289)'`, after the `const resolved = ...` line, add:

```ts
    // Decision 290: the seeded graphic has a line that leaves at 3 s, so the
    // card shows a frame per step under its thumbnail.
    const steps = resolved.getByRole('list', { name: 'Graphic steps' })
    await expect(steps.getByRole('img', { name: 'Step: At 0:03' })).toBeVisible()
    await expect(steps.getByRole('img', { name: 'Step: End' })).toBeVisible()
```

- [ ] **Step 3: Run the e2e file**

Run (Bash `timeout: 600000`), from the e2e package so only this file runs: `cd e2e && pnpm exec playwright test tests/visual-plan.spec.ts`
Expected: PASS. If port 3100 is held by an orphaned dev server from an interrupted run, free it before re-running.

- [ ] **Step 4: Run the whole suite**

With Docker Desktop running, from the repo root, one at a time (Bash `timeout: 600000` each): `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`.
Expected: all PASS. A composition golden that fails only in the full run is re-run alone (`cd packages/compositions && pnpm exec vitest run src/snapshot/render.test.ts -t "<name>"`) before it is believed; never regenerate a golden from a full run.

- [ ] **Step 5: Record decision 290**

Append to `PROGRESS.md`, after decision 289's follow-up:

```markdown
290. **Graphics that move with the narration (stage 2 of 289)** (2026-10-08,
     owner, having watched stage 1's graphics: dead air in long slots). In
     the live runs, a 22.3 s graphic's bars wiped in at 10.9 s and nothing
     moved for the next 10.8 s while the narrator said "Four times the
     number from six months earlier."
     Owner's rulings: staged builds (with exits, and bars that grow one at a
     time), camera moves and timed emphasis; easing and duration per
     entrance left out, since they do least for dead air; six elements on
     screen at once and ten across the slot; bars rescale as each arrives;
     the timing lives on each element plus a camera track on the scene; the
     board shows the final frame and one small frame per step.
     What shipped: every new field optional, so a stage 1 scene renders
     frame for frame as before (every stage 1 golden unchanged). An element
     may `exit` (fade, drop or wipe, 500 ms); `emphasis` keeps its word form
     and gains a timed form, including `color`, which shifts the element to
     another token over 400 ms (never a logo; a timed underline only on text
     and figures); a bar item may grow at its own `atMs`, the scale easing up
     to the largest bar on screen and never back down; the scene may carry a
     `camera` of up to four keys (focus an element or `all`, zoom 1 to 1.6,
     a 1.5 s move each, holding between), over the drift, its zoom capped so
     the focus fits the safe area and its pan so the composition's edges never
     enter the frame. One timing module (`graphic-timing.ts`) holds when each
     element is on screen (entrance start to exit start, so a cross-fade is
     not a collision) and the seven rules the designer is held to, worded for
     its retry; the six-on-screen rule and the camera's focus are also schema
     rules, so the timeline and broker enforce them. Layout reads time: a
     step takes the cell the last one left, and in 9:16 elements never on
     screen together share a band. The designer prompt teaches the
     vocabulary, the rule that a graphic over about 8 s changes with each new
     thing said, and a fourth example built in steps; its answer budget is
     4,000 tokens. The mock builds a slot of 8 s or more in two steps. The
     board draws any moment of a graphic and a frame per step ("At 0:04",
     "End"), with clip ids of its own per drawing. Resolution, redesign and
     Add logo keep the camera track. The live harness frames every change and
     records each graphic's longest still stretch and the words spoken in it.
     Decisions made where the spec left room: an exit's style replaces the
     entrance's, since the checks finish the entrance first (cost if wrong: a
     scene saved by some other path that exits mid-entrance jumps); a timed
     bar's label and value fade in with its bar, an untimed one's keep the
     element's entrance (cost if wrong: none for stage 1, whose bars are all
     untimed); the step frames are taken 1 ms before each distinct exit time,
     labelled by that time rounded to the second (cost if wrong: two exits
     within a second share a label); the bars' scale keeps stage 1's floor of
     1 (cost if wrong: values under 1 never fill the width alone).
     Shipping, in this order because the timeline schema changed (an older
     broker refuses more than six elements and strips the new fields):
     `deploy:remotion`, then `deploy:stacks boom-busters-broker`, then the
     push to `master` and `PUT /api/inngest`.
     The number 290 is checked against `origin/master` at the merge.
```

- [ ] **Step 6: Commit**

```bash
git add e2e/global-setup.ts e2e/tests/visual-plan.spec.ts PROGRESS.md
git commit -m "test(e2e): a staged graphic shows its steps; PROGRESS decision 290

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The live loop (controller and owner; paid)

Not for a subagent: every run spends money and needs the owner's go-ahead first.

**Files:**
- Modify (between runs, only as the frames show is needed): `packages/providers/src/prompts/graphics.ts` and its tests; `PROGRESS.md`

- [ ] **Step 1: Ask the owner for the first run**

State: the Stability AI film (project `01M1F7KDJVGDSJ31WE7BPSBKZR`), its five graphics redesigned, $1 cap, the stored production Anthropic key decrypted in memory and never printed, production read only. Wait for an explicit yes.

- [ ] **Step 2: Run, render, look**

Run (Bash `timeout: 600000`): `cd apps/web && pnpm live:graphic --project 01M1F7KDJVGDSJ31WE7BPSBKZR --first 5 --redesign --label s2-run1`, then `cd packages/compositions && pnpm render:graphics <the printed run folder>`. Read `run.json` (each slot's `still`, `refusals`, `usd`) and open the frames with the Read tool.

- [ ] **Step 3: Judge against the target**

The target (spec section 7): no graphic longer than 8 s has a still stretch over about 6 s with words spoken in it; every word on screen traces to the narration or a cited claim; no refusals. Report to the owner what the frames show and what, if anything, the prompt should change.

- [ ] **Step 4: Fix, test, and run again only with a fresh go-ahead**

A prompt change lands with a test (in `graphics.test.ts`, a phrase on one unwrapped line) and its own commit; each further run is asked for again. Stop when a run meets the target or the owner says so.

- [ ] **Step 5: Record the loop**

Append a "Follow-up (live loop)" paragraph to decision 290 in `PROGRESS.md`: the runs, their cost, what each showed, what changed, and the final run's longest still stretches. Commit with `docs(progress): decision 290's live loop`.

---

### Task 12: Merge and rollout (owner runs the deploys)

- [ ] **Step 1: Merge**

Use superpowers:finishing-a-development-branch. Before merging, fetch `origin/master` and check 290 is still free in its PROGRESS; if another session took it, renumber only this branch's lines in a separate commit.

- [ ] **Step 2: The Remotion bundle**

Hand the owner `pnpm deploy:remotion` (it uploads the new `GraphicCard`). Wait for it to finish.

- [ ] **Step 3: The broker**

Write the deploy wrapper into the scratchpad as the lambda redeploy recipe describes (profile `reelscript`; `REMOTION_FUNCTION_NAME`, `REMOTION_SERVE_URL`, `RENDER_BUCKET`, `CALLBACK_URL`, `SENTRY_DSN`, `RENDER_CAP`, `RENDER_FANOUT` read from the live broker Lambda's environment without printing secrets, refusing to run if any is empty; `SENTRY_RELEASE` the short SHA), and hand the owner `pnpm deploy:stacks boom-busters-broker` through it. Verify afterwards with the same query.

- [ ] **Step 4: Vercel and Inngest**

Push `master`; once the deployment is Ready, `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`.

- [ ] **Step 5: See it**

On the production board, press Redesign graphic on a long graphic, check its step frames, and play it.
