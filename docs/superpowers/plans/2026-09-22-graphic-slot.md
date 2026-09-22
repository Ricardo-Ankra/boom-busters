# Graphic Slot Implementation Plan (decision 268, Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seventh drawn slot type, `graphic`, whose brief is a scene graph the planner composes from a fixed element vocabulary on a 12 by 12 grid, styled only through brand token names, every figure cited to a claim and checked against its text, every logo drawn from the library Plan A built.

**Architecture:** The brief is the payload, as for charts: nothing is fetched, the timeline embeds the scene whole and the logo bytes as `MediaRef`s. One pure layout module in the compositions package computes every box and font size; the board's SVG preview and the Remotion `GraphicCard` both draw from it, so the approved graphic is the rendered graphic. Resolution maps claim numbers to ids, checks a figure's digits against the cited claim's text, and looks each logo element's entity up in the library; a missing mark makes the slot a placeholder whose card offers the upload.

**Tech Stack:** Zod 4 (`packages/schemas`), Drizzle + `drizzle-kit generate` (`packages/db`), Remotion 4.0.512 (`packages/compositions`), Next.js App Router server actions, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-21-motion-graphics-design.md`, sections 3.1 to 3.4, 4, 5, 6.4 and 7. Plan A (`docs/superpowers/plans/2026-09-21-logo-library.md`) is merged; it exports `LogoIndex`, `logoForEntity`, `listLogos`, `logoById`, `createLogoUploadAction`, `finaliseLogoAction`, `toUploadableLogo`, `readImageSize`.

**Deviation from the spec, ruled while planning:** section 5.1 asks for `fitText` from `@remotion/layout-utils`. That measures text on a canvas, and the fonts available to the board's browser and to the render's Chromium differ, so the two would compute different sizes for the same label, which defeats the one-layout rule. The layout module instead fits with a pure estimator (`fitFontPx`, average glyph width 0.56 em) that returns the same number everywhere. No new dependency. Cost if wrong: a label a few pixels tighter or looser than a true measurement; never a mismatch between preview and render.

## Global Constraints

- No em dash (U+2014) or en dash (U+2013) on any added line, in code, comments, tests or docs. Ranges as "2022 to 2025". South African English (colour, licence, organise).
- `'use server'` modules export only async functions.
- Button-first UI: every action is a visible labelled button; controls carry accessible names.
- Nothing calls a paid API. Mock providers stay mocked; every graphic resolves at $0 (nothing is fetched or generated).
- Colours in a scene are token NAMES from `GRAPHIC_COLORS`; a hex string is a schema error. Type is a role name from `GRAPHIC_TYPE_ROLES`. Six elements at most. Every `figure` and every `bars` item cites a claim; the digits shown must occur in that claim's text.
- The bottom two grid rows are the caption band and stay empty of elements at layout time (the planner is told; the layout does not clip).
- Every task: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` clean before its commit; tests in the FOREGROUND only; database suites one file at a time.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Test database needs Docker Desktop; run `pnpm db:migrate:test` after Task 3's migration lands.

---

## File structure

| File | Responsibility |
| --- | --- |
| `packages/schemas/src/graphics.ts` (create) | Scene vocabulary: constants, cell, enter, element union, scene, planned scene, `figureCitesClaim`. Pure. |
| `packages/schemas/src/visuals.ts` (modify) | `graphic` slot type; `GraphicBriefSchema`; planned form; `PlanningClaim.text`; resolution and rejection with a logo index. |
| `packages/schemas/src/timeline.ts` (modify) | `GraphicPayloadSchema`; `graphic` timeline slot type and payload kind. |
| `packages/db/src/schema.ts` + `drizzle/00XX_*.sql` (modify, generate) | `shot_type` enum gains `graphic`. |
| `packages/compositions/src/lib/graphic.ts` (create) | Layout: safe area, grid boxes, font fitting, portrait re-flow, enter progress, digit counting. Exported as `@boom-busters/compositions/graphic`. |
| `packages/compositions/src/components/GraphicCard.tsx` (create), `DocumentaryMaster.tsx`, `Root.tsx`, `snapshot/render.test.ts` (modify) | The component, its dispatch, two fixtures and goldens. `lib/motion.ts` gains `markerSweep`. |
| `packages/timeline/src/compile.ts` (modify) | `CompileSlot.graphic`; payload assembly; static motion. |
| `apps/web/lib/materialise.ts`, `infra/lambdas/broker/core.ts` (modify) | Walk `payload.logos`. |
| `apps/web/inngest/lib/assembly.ts`, `inngest/functions/assembly-runner.ts` (modify) | Build the compile slot from the brief and the loaded logo rows. |
| `apps/web/lib/visual-assets.ts` (modify) | `resolveSlotBrief` case `graphic`. |
| `apps/web/inngest/lib/direction.ts` (modify) | Thread the logo index into planning and the logo titles into the prompt. |
| `packages/providers/src/prompts/shotlist.ts`, `retype.ts` (modify) | Prompt shape and rules; mock slot; retype and rebrief targets. |
| `apps/web/inngest/functions/slot-retyper.ts`, `slot-rebriefer.ts`, `app/(console)/projects/[id]/visuals-actions.ts` (modify) | `graphic` is a model-drafted target; `attachGraphicLogosAction`. |
| `apps/web/lib/visuals-review.ts` (modify) | `SlotView.logoUrls`; the board receives the stored brand kit. |
| `apps/web/app/(console)/projects/[id]/slot-previews.tsx`, `visual-board.tsx`, `page.tsx` (modify) | `GraphicPreview`, `GraphicErrorCard`, `GraphicSlot` with claim chips and the inline logo uploader. |
| `e2e/global-setup.ts` (modify), `e2e/tests/visual-plan.spec.ts` (modify) | Seeded graphic slots; the card on the plan checkpoint. |
| `PROGRESS.md`, `docs/03-build-spec.md`, the spec (modify) | Decision 268 Plan B recorded; the 5.1 deviation noted. |

---

### Task 1: The scene vocabulary and the figure check

**Files:**
- Create: `packages/schemas/src/graphics.ts`
- Create: `packages/schemas/src/graphics.test.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './graphics'` after `./logos`)

**Interfaces:**
- Consumes: `UlidSchema` from `./ids`.
- Produces: `GRAPHIC_GRID = 12`, `MAX_GRAPHIC_ELEMENTS = 6`, `GRAPHIC_COLORS`, `GraphicColorSchema`, `GraphicColor`, `GRAPHIC_TYPE_ROLES`, `GraphicTypeRoleSchema`, `GraphicTypeRole`, `GraphicCellSchema`, `GraphicCell`, `GRAPHIC_ENTERS`, `GraphicEnterSchema`, `GraphicEnter`, `GraphicElementSchema`, `GraphicElement`, `GraphicSceneSchema`, `GraphicScene`, `PlannedGraphicElementSchema`, `PlannedGraphicSceneSchema`, `PlannedGraphicScene`, `figureCitesClaim(value: string, claimText: string): boolean`, `figureDigitGroups(value: string): string[]`.

- [ ] **Step 1: Write the failing tests**

`packages/schemas/src/graphics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  GRAPHIC_COLORS,
  GraphicSceneSchema,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  figureCitesClaim,
  figureDigitGroups,
} from './graphics'

const CLAIM = '01HQ00000000000000000000AA'

const cell = (col: number, row: number, colSpan = 4, rowSpan = 2) => ({ col, row, colSpan, rowSpan })

const text = (id: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'text',
  id,
  cell: cell(0, 0),
  content: 'Raised in one round',
  role: 'heading',
  color: 'textPrimary',
  ...overrides,
})

const figure = (id: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'figure',
  id,
  cell: cell(0, 2, 6, 3),
  value: '$4bn',
  label: 'valuation',
  claimRef: CLAIM,
  color: 'accent',
  enter: { kind: 'count', atMs: 400 },
  ...overrides,
})

describe('GraphicSceneSchema', () => {
  it('accepts a scene of named tokens on the grid', () => {
    const parsed = GraphicSceneSchema.parse({
      elements: [
        text('t1'),
        figure('f1'),
        { kind: 'logo', id: 'l1', cell: cell(8, 0, 4, 3), entity: 'Stability AI' },
        { kind: 'shape', id: 's1', cell: cell(0, 5, 12, 1), form: 'rule', color: 'textSecondary' },
      ],
    })
    expect(parsed.elements).toHaveLength(4)
    // Defaults land: a plain fade at the slot's start, full opacity, start alignment.
    expect(parsed.elements[0]).toMatchObject({ enter: { kind: 'fade', atMs: 0 }, align: 'start' })
    expect(parsed.elements[3]).toMatchObject({ opacity: 1 })
  })

  it('refuses a hex colour, a seventh element, a cell off the grid and an unknown role', () => {
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1', { color: '#ff0000' })] }).success).toBe(false)
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1', { role: 'display' })] }).success).toBe(false)
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1', { cell: cell(9, 0, 4, 2) })] }).success).toBe(false)
    const seven = Array.from({ length: MAX_GRAPHIC_ELEMENTS + 1 }, (_, i) => text(`t${i}`))
    expect(GraphicSceneSchema.safeParse({ elements: seven }).success).toBe(false)
  })

  it('lets only a figure count, keeps ids unique, and names an entity once', () => {
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1', { enter: { kind: 'count', atMs: 0 } })] }).success).toBe(false)
    expect(GraphicSceneSchema.safeParse({ elements: [text('t1'), text('t1')] }).success).toBe(false)
    expect(
      GraphicSceneSchema.safeParse({
        elements: [
          { kind: 'logo', id: 'l1', cell: cell(0, 0), entity: 'Stability AI' },
          { kind: 'logo', id: 'l2', cell: cell(4, 0), entity: 'stability ai' },
        ],
      }).success,
    ).toBe(false)
  })

  it('requires two to five cited bars', () => {
    const bar = (label: string, value: number) => ({ label, value, display: `${value}`, claimRef: CLAIM })
    const bars = (items: unknown[]) => ({ kind: 'bars', id: 'b1', cell: cell(0, 0, 12, 4), items, color: 'accent' })
    expect(GraphicSceneSchema.safeParse({ elements: [bars([bar('a', 1)])] }).success).toBe(false)
    expect(GraphicSceneSchema.safeParse({ elements: [bars([bar('a', 1), bar('b', 2)])] }).success).toBe(true)
    expect(GraphicSceneSchema.safeParse({ elements: [bars([1, 2, 3, 4, 5, 6].map((n) => bar(`x${n}`, n)))] }).success).toBe(false)
  })

  it('exposes the colour names a scene may use, and only those', () => {
    expect(GRAPHIC_COLORS).toEqual([
      'primary', 'accent', 'background', 'surface', 'textPrimary', 'textSecondary',
      'captionHighlight', 'collapse', 'recovery', 'series0', 'series1', 'series2',
    ])
  })
})

describe('PlannedGraphicSceneSchema', () => {
  it('takes claim numbers and entities, never ids', () => {
    const parsed = PlannedGraphicSceneSchema.parse({
      elements: [
        figure('f1', { claimRef: 3 }),
        { kind: 'logo', id: 'l1', cell: cell(8, 0, 4, 3), entity: 'Wirecard AG' },
      ],
    })
    expect(parsed.elements[0]).toMatchObject({ claimRef: 3 })
    expect(PlannedGraphicSceneSchema.safeParse({ elements: [figure('f1', { claimRef: CLAIM })] }).success).toBe(false)
    expect(PlannedGraphicSceneSchema.safeParse({ elements: [figure('f1', { claimRef: 0 })] }).success).toBe(false)
  })
})

describe('figureCitesClaim', () => {
  it('finds every digit group of the shown value in the claim, ignoring separators and scale words', () => {
    expect(figureCitesClaim('$4bn', 'The company raised $4 billion in 2022.')).toBe(true)
    expect(figureCitesClaim('4,000', 'About 4000 staff were let go.')).toBe(true)
    expect(figureCitesClaim('94%', 'Some 94 percent of deposits left in a week.')).toBe(true)
    expect(figureCitesClaim('$1.9bn', 'Auditors could not find $1.9 billion.')).toBe(true)
    expect(figureCitesClaim('EUR 1,900,000,000', 'the missing 1.9 billion euros')).toBe(false)
  })

  it('refuses a value the claim does not carry, and a value with no digits', () => {
    expect(figureCitesClaim('$4.5bn', 'The company raised $4 billion.')).toBe(false)
    expect(figureCitesClaim('2019', 'in late twenty-nineteen')).toBe(false)
    expect(figureCitesClaim('none', 'nothing here')).toBe(false)
  })

  it('exposes the digit groups it compares', () => {
    expect(figureDigitGroups('$4.5bn')).toEqual(['4.5'])
    expect(figureDigitGroups('1,200 staff, 3 sites')).toEqual(['1200', '3'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/schemas`): `npx vitest run src/graphics.test.ts`
Expected: FAIL, `Cannot find module './graphics'`.

- [ ] **Step 3: Write the module**

`packages/schemas/src/graphics.ts`:

```ts
import { z } from 'zod'
import { UlidSchema } from './ids'

/**
 * The scene graph a graphic slot is made of (decision 268, Plan B).
 *
 * A graphic is composed, not chosen from a catalogue: a fixed vocabulary of
 * elements placed in the cells of a coarse grid, styled only by the NAMES of
 * brand tokens, with every number cited to a dossier claim and every logo
 * drawn from the library. The constraints that keep the channel's graphics
 * safe and consistent live here, in the schema, rather than in templates.
 *
 * The planner writes claim NUMBERS and entity NAMES (`Planned*`); resolution
 * maps them to claim ids and library asset ids (the stored `Graphic*` shapes).
 */

export const GRAPHIC_GRID = 12
export const MAX_GRAPHIC_ELEMENTS = 6

/** Colour names a scene may use. The three series colours are enough; a longer palette is confetti. */
export const GRAPHIC_COLORS = [
  'primary',
  'accent',
  'background',
  'surface',
  'textPrimary',
  'textSecondary',
  'captionHighlight',
  'collapse',
  'recovery',
  'series0',
  'series1',
  'series2',
] as const
export const GraphicColorSchema = z.enum(GRAPHIC_COLORS)
export type GraphicColor = z.infer<typeof GraphicColorSchema>

export const GRAPHIC_TYPE_ROLES = ['heading', 'title', 'body', 'numbers', 'captions'] as const
export const GraphicTypeRoleSchema = z.enum(GRAPHIC_TYPE_ROLES)
export type GraphicTypeRole = z.infer<typeof GraphicTypeRoleSchema>

/** A rectangle of grid cells. The refinement keeps it on the grid. */
export const GraphicCellSchema = z
  .object({
    col: z.number().int().min(0).max(GRAPHIC_GRID - 1),
    row: z.number().int().min(0).max(GRAPHIC_GRID - 1),
    colSpan: z.number().int().min(1).max(GRAPHIC_GRID),
    rowSpan: z.number().int().min(1).max(GRAPHIC_GRID),
  })
  .refine((c) => c.col + c.colSpan <= GRAPHIC_GRID && c.row + c.rowSpan <= GRAPHIC_GRID, {
    message: 'a cell must stay on the 12 by 12 grid',
  })
export type GraphicCell = z.infer<typeof GraphicCellSchema>

export const GRAPHIC_ENTERS = ['fade', 'rise', 'wipe', 'count'] as const
export const GraphicEnterSchema = z.object({
  kind: z.enum(GRAPHIC_ENTERS),
  /** Offset from the slot's start. The layout clamps it inside the slot. */
  atMs: z.number().int().min(0).max(8000).default(0),
})
export type GraphicEnter = z.infer<typeof GraphicEnterSchema>

const elementCommon = {
  id: z.string().min(1).max(40),
  cell: GraphicCellSchema,
  /** Absent means "re-flow me in reading order into one column on 9:16". */
  portraitCell: GraphicCellSchema.optional(),
  enter: GraphicEnterSchema.default({ kind: 'fade', atMs: 0 }),
  emphasis: z.enum(['pulse', 'underline']).optional(),
}

const TextElementSchema = z.object({
  kind: z.literal('text'),
  ...elementCommon,
  content: z.string().min(1).max(120),
  role: GraphicTypeRoleSchema,
  color: GraphicColorSchema,
  align: z.enum(['start', 'center', 'end']).default('start'),
})

const figureFields = {
  kind: z.literal('figure'),
  ...elementCommon,
  /** Exactly what is shown: "$4bn", "94%", "1,200 staff". */
  value: z.string().min(1).max(24),
  label: z.string().min(1).max(60).optional(),
  color: GraphicColorSchema,
}

const logoFields = {
  kind: z.literal('logo'),
  ...elementCommon,
  /** The company or person, as the dossier names them: the join to the library. */
  entity: z.string().min(1).max(80),
}

const ShapeElementSchema = z.object({
  kind: z.literal('shape'),
  ...elementCommon,
  form: z.enum(['rect', 'rule', 'disc']),
  color: GraphicColorSchema,
  opacity: z.number().min(0.05).max(1).default(1),
})

const barItemFields = {
  label: z.string().min(1).max(40),
  value: z.number().finite(),
  /** What is written at the end of the bar. */
  display: z.string().min(1).max(24),
}

const barsFields = {
  kind: z.literal('bars'),
  ...elementCommon,
  color: GraphicColorSchema,
  highlightIndex: z.number().int().min(0).max(4).optional(),
}

/** Stored form: claim ids, and a logo that may already carry its library asset. */
export const GraphicElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  z.object({ ...figureFields, claimRef: UlidSchema }),
  z.object({ ...logoFields, assetId: UlidSchema.optional() }),
  ShapeElementSchema,
  z.object({
    ...barsFields,
    items: z.array(z.object({ ...barItemFields, claimRef: UlidSchema })).min(2).max(5),
  }),
])
export type GraphicElement = z.infer<typeof GraphicElementSchema>

/** Planned form: claim NUMBERS into the prompt's list, and no asset ids. */
export const PlannedGraphicElementSchema = z.discriminatedUnion('kind', [
  TextElementSchema,
  z.object({ ...figureFields, claimRef: z.number().int().min(1) }),
  z.object(logoFields),
  ShapeElementSchema,
  z.object({
    ...barsFields,
    items: z.array(z.object({ ...barItemFields, claimRef: z.number().int().min(1) })).min(2).max(5),
  }),
])

function normaliseEntity(entity: string): string {
  return entity.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The rules no field type can carry: one count per figure, unique ids, one logo per entity. */
function sceneRules(
  scene: { elements: readonly { kind: string; id: string; enter: { kind: string }; entity?: string }[] },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>()
  const entities = new Set<string>()
  scene.elements.forEach((element, index) => {
    if (element.enter.kind === 'count' && element.kind !== 'figure') {
      ctx.addIssue({ code: 'custom', path: ['elements', index, 'enter'], message: 'only a figure can count' })
    }
    if (ids.has(element.id)) {
      ctx.addIssue({ code: 'custom', path: ['elements', index, 'id'], message: `duplicate element id "${element.id}"` })
    }
    ids.add(element.id)
    if (element.kind === 'logo' && element.entity !== undefined) {
      const key = normaliseEntity(element.entity)
      if (entities.has(key)) {
        ctx.addIssue({ code: 'custom', path: ['elements', index, 'entity'], message: 'one logo per entity' })
      }
      entities.add(key)
    }
  })
}

export const GraphicSceneSchema = z
  .object({ elements: z.array(GraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS) })
  .superRefine(sceneRules)
export type GraphicScene = z.infer<typeof GraphicSceneSchema>

export const PlannedGraphicSceneSchema = z
  .object({ elements: z.array(PlannedGraphicElementSchema).min(1).max(MAX_GRAPHIC_ELEMENTS) })
  .superRefine(sceneRules)
export type PlannedGraphicScene = z.infer<typeof PlannedGraphicSceneSchema>

/**
 * The digit groups a shown value carries, with thousands separators removed:
 * "$4.5bn" is ["4.5"], "1,200 staff, 3 sites" is ["1200", "3"].
 */
export function figureDigitGroups(value: string): string[] {
  const stripped = value.replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
  return stripped.match(/\d+(?:\.\d+)?/g) ?? []
}

/**
 * Whether every digit group the figure shows occurs, as a whole group, in
 * the cited claim's text. The multiplier ("bn", "billion", "%") is a
 * rendering choice and is not compared; the digits are the fact. A figure
 * with no digits cites nothing.
 */
export function figureCitesClaim(value: string, claimText: string): boolean {
  const shown = figureDigitGroups(value)
  if (shown.length === 0) return false
  const inClaim = new Set(figureDigitGroups(claimText))
  return shown.every((group) => inClaim.has(group))
}
```

Add `export * from './graphics'` to `packages/schemas/src/index.ts` after the `./logos` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/graphics.test.ts`
Expected: PASS (10 tests). `pnpm typecheck` from the root.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/graphics.ts packages/schemas/src/graphics.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): the graphic scene vocabulary and the figure check (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The graphic brief, its planned form, and resolution against claims and logos

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (`SHOT_SLOT_TYPES`, brief union, planned union, `PlanningClaim`, `resolvePlannedBrief`, `plannedBriefRejection`)
- Modify: `packages/schemas/src/timeline.ts` (`GraphicPayloadSchema`, `TIMELINE_SLOT_TYPES`, `SLOT_PAYLOAD_KINDS`)
- Modify: `packages/schemas/src/visuals.test.ts` (or the nearest test of `resolvePlannedBrief`; search `resolvePlannedBrief` in `packages/schemas/src/*.test.ts`)
- Modify: `packages/schemas/src/timeline.test.ts` (search `SLOT_PAYLOAD_KINDS`)

**Interfaces:**
- Consumes: Task 1's schemas; `LogoIndex`, `logoForEntity` from `./logos`; `MediaRefSchema` (already in `timeline.ts`).
- Produces: `'graphic'` in `SHOT_SLOT_TYPES` (before `'hero'`); `GraphicBriefSchema`/`GraphicBrief` (`type: 'graphic'`, `...briefCommon`, `scene: GraphicSceneSchema`); `PlannedGraphicBriefSchema` (`scene: PlannedGraphicSceneSchema`); `PlanningClaim.text?: string`; `resolvePlannedBrief(brief, claims, logos: readonly LogoIndex[] = [])`; `plannedBriefRejection(brief, claims, logos = [])`; `GraphicPayloadSchema`/`GraphicPayload` (`kind: 'graphic'`, `scene`, `logos: Record<elementId, MediaRef & { width, height }>`, `claimIds: string[]`); `'graphic'` in `TIMELINE_SLOT_TYPES` with `SLOT_PAYLOAD_KINDS.graphic = ['graphic']`.

- [ ] **Step 1: Write the failing tests**

Add to the test file that covers `resolvePlannedBrief`:

```ts
import { GraphicBriefSchema, resolvePlannedBrief, plannedBriefRejection, SHOT_SLOT_TYPES } from './visuals'

const CLAIMS = [
  { id: '01HQ00000000000000000000A1', text: 'The company raised $4 billion in 2022.' },
  { id: '01HQ00000000000000000000A2', text: 'Some 94 percent of deposits left.' },
]
const LOGOS = [{ id: '01HQ00000000000000000000L1', title: 'Stability AI' }]

const plannedGraphic = (elements: unknown[]) => ({
  type: 'graphic' as const,
  coversText: 'It raised four billion dollars.',
  description: 'A big number with the mark beside it.',
  motion: { kind: 'static' as const },
  transition: 'cut' as const,
  shotSize: 'graphic' as const,
  scene: { elements },
})
const cell = { col: 0, row: 0, colSpan: 6, rowSpan: 3 }

describe('graphic briefs (decision 268, Plan B)', () => {
  it('is a slot type before hero', () => {
    expect(SHOT_SLOT_TYPES.indexOf('graphic')).toBe(SHOT_SLOT_TYPES.indexOf('hero') - 1)
  })

  it('resolves claim numbers to ids and entities to library assets', () => {
    const resolved = resolvePlannedBrief(
      plannedGraphic([
        { kind: 'figure', id: 'f1', cell, value: '$4bn', claimRef: 1, color: 'accent' },
        { kind: 'logo', id: 'l1', cell: { ...cell, col: 6 }, entity: 'Stability AI, the image company' },
      ]) as never,
      CLAIMS,
      LOGOS,
    )
    expect(resolved?.type).toBe('graphic')
    if (resolved?.type !== 'graphic') return
    expect(resolved.scene.elements[0]).toMatchObject({ claimRef: CLAIMS[0]!.id })
    expect(resolved.scene.elements[1]).toMatchObject({ entity: 'Stability AI, the image company', assetId: LOGOS[0]!.id })
    expect(GraphicBriefSchema.safeParse(resolved).success).toBe(true)
  })

  it('leaves a logo without a mark unresolved rather than refusing the brief', () => {
    const resolved = resolvePlannedBrief(
      plannedGraphic([{ kind: 'logo', id: 'l1', cell, entity: 'Acme Capital' }]) as never,
      CLAIMS,
      LOGOS,
    )
    expect(resolved?.type).toBe('graphic')
    if (resolved?.type !== 'graphic') return
    expect(resolved.scene.elements[0]).toEqual(expect.not.objectContaining({ assetId: expect.anything() }))
  })

  it('refuses a claim number outside the list, and a figure the claim does not carry, in words', () => {
    const outside = plannedGraphic([{ kind: 'figure', id: 'f1', cell, value: '$4bn', claimRef: 9, color: 'accent' }]) as never
    expect(resolvePlannedBrief(outside, CLAIMS, LOGOS)).toBeNull()
    expect(plannedBriefRejection(outside, CLAIMS, LOGOS)).toMatch(/outside the claim list/)

    const wrong = plannedGraphic([{ kind: 'figure', id: 'f1', cell, value: '$4.5bn', claimRef: 1, color: 'accent' }]) as never
    expect(resolvePlannedBrief(wrong, CLAIMS, LOGOS)).toBeNull()
    expect(plannedBriefRejection(wrong, CLAIMS, LOGOS)).toMatch(/\$4\.5bn.*claim 1/)
  })

  it('checks every bar the same way', () => {
    const bars = plannedGraphic([
      {
        kind: 'bars', id: 'b1', cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 }, color: 'accent',
        items: [
          { label: 'raised', value: 4, display: '$4bn', claimRef: 1 },
          { label: 'left', value: 94, display: '94%', claimRef: 2 },
        ],
      },
    ]) as never
    const resolved = resolvePlannedBrief(bars, CLAIMS, LOGOS)
    expect(resolved?.type).toBe('graphic')
    const off = plannedGraphic([
      {
        kind: 'bars', id: 'b1', cell: { col: 0, row: 0, colSpan: 12, rowSpan: 4 }, color: 'accent',
        items: [
          { label: 'raised', value: 4, display: '$4bn', claimRef: 1 },
          { label: 'left', value: 95, display: '95%', claimRef: 2 },
        ],
      },
    ]) as never
    expect(resolvePlannedBrief(off, CLAIMS, LOGOS)).toBeNull()
  })
})
```

Add to `timeline.test.ts`:

```ts
it('a graphic slot carries a graphic payload and nothing else', () => {
  expect(TIMELINE_SLOT_TYPES).toContain('graphic')
  expect(SLOT_PAYLOAD_KINDS.graphic).toEqual(['graphic'])
  const parsed = GraphicPayloadSchema.parse({
    kind: 'graphic',
    scene: { elements: [{ kind: 'text', id: 't', cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }, content: 'Hello', role: 'heading', color: 'textPrimary' }] },
    logos: { l1: { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
    claimIds: ['01HQ00000000000000000000A1'],
  })
  expect(parsed.logos['l1']?.width).toBe(1200)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/visuals.test.ts src/timeline.test.ts` (adjust to the file names you found)
Expected: FAIL on the missing exports.

- [ ] **Step 3: Write the wiring**

In `packages/schemas/src/visuals.ts`:

1. `SHOT_SLOT_TYPES`: insert `'graphic'` between `'headline'` and `'hero'`.
2. Imports: `import { GraphicSceneSchema, PlannedGraphicSceneSchema, figureCitesClaim } from './graphics'` and `import { logoForEntity, type LogoIndex } from './logos'`.
3. After `HeadlineBriefSchema`:

```ts
/**
 * A composed graphic (decision 268, Plan B): the brief IS the scene, as a
 * chart's brief is its series. Nothing is fetched; the timeline embeds it.
 */
export const GraphicBriefSchema = z.object({
  type: z.literal('graphic'),
  ...briefCommon,
  scene: GraphicSceneSchema,
})
export type GraphicBrief = z.infer<typeof GraphicBriefSchema>
```

   and add `GraphicBriefSchema` to `ShotBriefSchema`'s union (before `HeroBriefSchema`).
4. After `PlannedHeadlineBriefSchema`:

```ts
/** The wire shape of a graphic brief: claim numbers and entity names, no ids. */
export const PlannedGraphicBriefSchema = GraphicBriefSchema.omit({ scene: true }).extend({
  scene: PlannedGraphicSceneSchema,
})
export type PlannedGraphicBrief = z.infer<typeof PlannedGraphicBriefSchema>
```

   and add it to `PlannedBriefSchema` before `HeroBriefSchema`.
5. `PlanningClaim` gains `text?: string` with the comment: "the claim's wording; a graphic's figures are checked against it".
6. `resolvePlannedBrief(brief, claims, logos: readonly LogoIndex[] = [])`: add before the final `return brief`:

```ts
  if (brief.type === 'graphic') {
    const claimIds = claims.map((claim) => claim.id)
    const elements = []
    for (const element of brief.scene.elements) {
      if (element.kind === 'figure') {
        const mapped = mapClaimRefs([element.claimRef], claimIds)
        if (!mapped || !figureCitesClaim(element.value, claims[element.claimRef - 1]?.text ?? '')) return null
        elements.push({ ...element, claimRef: mapped[0]! })
      } else if (element.kind === 'bars') {
        const items = []
        for (const item of element.items) {
          const mapped = mapClaimRefs([item.claimRef], claimIds)
          if (!mapped || !figureCitesClaim(item.display, claims[item.claimRef - 1]?.text ?? '')) return null
          items.push({ ...item, claimRef: mapped[0]! })
        }
        elements.push({ ...element, items })
      } else if (element.kind === 'logo') {
        // A missing mark is not a refusal: the fix is an upload, not a redraft,
        // so the slot is stored and resolves to a placeholder that asks for it.
        const logo = logoForEntity(element.entity, logos)
        elements.push(logo ? { ...element, assetId: logo.id } : element)
      } else {
        elements.push(element)
      }
    }
    return { ...brief, scene: { elements } } as ShotBrief
  }
```

7. `plannedBriefRejection(brief, claims, logos = [])`: add a `graphic` branch that walks the same way and returns the first of: `'graphic cited a claim number outside the claim list'`, or `` `graphic showed a number the cited claim does not contain: ${value} against claim ${ref}` ``; null when clean. (Factor a small internal `graphicCitationIssue(brief, claims): string | null` used by both functions so the two never disagree.)

In `packages/schemas/src/timeline.ts`: import `GraphicSceneSchema`; add

```ts
/**
 * A composed graphic, embedded whole (decision 268, Plan B): the scene, the
 * logo bytes it draws keyed by element id, and every claim it cites for the
 * audit trail. Like a chart's series, a render never depends on anything
 * outside the timeline but the logo objects, which ride the still path.
 */
export const GraphicPayloadSchema = z.object({
  kind: z.literal('graphic'),
  scene: GraphicSceneSchema,
  logos: z.record(
    z.string(),
    MediaRefSchema.extend({ width: z.number().int().positive(), height: z.number().int().positive() }),
  ),
  claimIds: z.array(UlidSchema).min(1),
})
export type GraphicPayload = z.infer<typeof GraphicPayloadSchema>
```

   add it to `SlotPayloadSchema`, `'graphic'` to `TIMELINE_SLOT_TYPES` (after `'headline'`), and `graphic: ['graphic']` to `SLOT_PAYLOAD_KINDS`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run` (from `packages/schemas`; the package suite is pure). Expected: all PASS including the new ones. `pnpm typecheck` from the root: expect errors where switch statements over `ShotBrief['type']` or `SlotPayload['kind']` are exhaustive (`assembly.ts`, `compile.ts`, `materialise.ts`, `visual-assets.ts`, `slot-previews`, `visual-board`); those are the later tasks' work. If typecheck fails ONLY in those files, note each in your report and proceed; the branch is red at the typecheck gate until Task 9 and that is expected. If it fails inside `packages/schemas`, fix it.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/visuals.ts packages/schemas/src/timeline.ts packages/schemas/src/visuals.test.ts packages/schemas/src/timeline.test.ts
git commit -m "feat(schemas): the graphic brief, its wire form, and resolution against claims and logos (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The enum value and its migration

**Files:**
- Modify: `packages/db/src/schema.ts:121-129`
- Generate: `packages/db/drizzle/0027_<name>.sql`, `drizzle/meta/0027_snapshot.json`, `drizzle/meta/_journal.json`

**Interfaces:** none new; `shot_type` gains `graphic`.

- [ ] **Step 1: Add the value and generate**

In `schema.ts` `shotTypeEnum`, insert `'graphic',` between `'headline',` and `'hero',`. Then from the repo root: `pnpm db:generate`. Open the generated SQL; it must contain exactly `ALTER TYPE "public"."shot_type" ADD VALUE 'graphic' BEFORE 'hero';--> statement-breakpoint` and nothing else (drizzle-kit may omit `BEFORE 'hero'` and append instead; either is acceptable, but no other statement may appear). The journal gains an `idx: 27` entry.

- [ ] **Step 2: Apply to the test database and prove it**

Run: `pnpm db:migrate:test` (Docker Desktop running). Then from `packages/db`: `npx vitest run src/shots.integration.test.ts` if such a file exists, else `npx vitest run src/visuals.integration.test.ts`; whichever inserts a `shot_slots` row. Add one test there inserting a row with `type: 'graphic'` and a minimal valid graphic brief (one `text` element) and reading it back; RED before the migration is applied is not demonstrable here, so state that in the report and show GREEN.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): shot_type gains graphic, migration 0027 (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The layout module

**Files:**
- Create: `packages/compositions/src/lib/graphic.ts`
- Create: `packages/compositions/src/lib/graphic.test.ts`
- Modify: `packages/compositions/package.json` (`"./graphic": "./src/lib/graphic.ts"` in `exports`)

**Interfaces:**
- Consumes: `GraphicScene`, `GraphicElement`, `GraphicCell`, `GraphicColor`, `GraphicTypeRole`, `GRAPHIC_GRID` from `@boom-busters/schemas`; `BrandKitTokens`; `captionSafeArea` from `./captions`; `easeInOut` from `./motion`.
- Produces:
  - `interface GraphicFrame { width: number; height: number }`
  - `interface Box { x: number; y: number; w: number; h: number }`
  - `interface ElementBox extends Box { id: string; fontPx?: number }`
  - `GRAPHIC_MARGIN_PX = 36`, `GRAPHIC_GUTTER_PX = 8`, `AVERAGE_GLYPH_EM = 0.56`
  - `safeArea(frame): Box` (the frame minus the caption band from `captionSafeArea` and the scaled margin)
  - `fitFontPx(text: string, boxWidth: number, basePx: number): number` (never above `basePx`, never below 12)
  - `reflowPortrait(scene): GraphicScene` (elements without `portraitCell` get `col 0, colSpan 12`, stacked by reading order with `rowSpan` kept, capped at the grid)
  - `graphicLayout(scene, frame, brand): ElementBox[]` (uses `portraitCell` or the re-flow when `height > width`)
  - `roleBasePx(role): number` (`heading 72, title 48, body 32, numbers 96, captions 24`)
  - `tokenColor(name: GraphicColor, brand): string`
  - `enterProgress(frameIndex, fps, atMs, durationMs = 600): number` (eased 0..1 from `atMs`)
  - `countedValue(value: string, progress: number): string` (digits tween from 0, every other character kept in place, landing exactly on `value` at 1)

- [ ] **Step 1: Write the failing tests**

`packages/compositions/src/lib/graphic.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { GraphicScene } from '@boom-busters/schemas'
import {
  countedValue,
  enterProgress,
  fitFontPx,
  graphicLayout,
  reflowPortrait,
  roleBasePx,
  safeArea,
  tokenColor,
} from './graphic'

const brand = resolveBrandKit(DEFAULT_SETTINGS)
const WIDE = { width: 1920, height: 1080 }
const TALL = { width: 1080, height: 1920 }

const scene: GraphicScene = {
  elements: [
    { kind: 'text', id: 't', cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 }, content: 'Raised in one round', role: 'heading', color: 'textPrimary', align: 'start', enter: { kind: 'fade', atMs: 0 } },
    { kind: 'figure', id: 'f', cell: { col: 0, row: 2, colSpan: 6, rowSpan: 3 }, value: '$4bn', label: 'valuation', claimRef: '01HQ00000000000000000000A1', color: 'accent', enter: { kind: 'count', atMs: 400 } },
    { kind: 'logo', id: 'l', cell: { col: 8, row: 0, colSpan: 4, rowSpan: 3 }, entity: 'Stability AI', enter: { kind: 'rise', atMs: 200 } },
  ],
}

describe('safeArea', () => {
  it('keeps clear of the caption band and the margin in both orientations', () => {
    const wide = safeArea(WIDE)
    expect(wide.x).toBe(36)
    expect(wide.y).toBe(36)
    expect(wide.w).toBe(1920 - 72)
    // Landscape captions end at 88% of the height.
    expect(wide.y + wide.h).toBeLessThanOrEqual(1080 * 0.88)
    const tall = safeArea(TALL)
    expect(tall.y + tall.h).toBeLessThanOrEqual(1920 * 0.72)
  })
})

describe('graphicLayout', () => {
  it('places each element in its cells with the gutter, and fits text to its box', () => {
    const boxes = graphicLayout(scene, WIDE, brand)
    const [t, f, l] = boxes
    const safe = safeArea(WIDE)
    const cellW = safe.w / 12
    expect(t).toMatchObject({ id: 't', x: safe.x + 4, y: safe.y + 4 })
    expect(t!.w).toBeCloseTo(cellW * 6 - 8, 5)
    expect(l!.x).toBeCloseTo(safe.x + cellW * 8 + 4, 5)
    expect(t!.fontPx).toBeLessThanOrEqual(roleBasePx('heading'))
    expect(f!.fontPx).toBeLessThanOrEqual(roleBasePx('numbers'))
    expect(l!.fontPx).toBeUndefined()
  })

  it('re-flows elements without a portrait cell into one column on 9:16, in reading order', () => {
    const boxes = graphicLayout(scene, TALL, brand)
    const safe = safeArea(TALL)
    for (const box of boxes) {
      expect(box.x).toBeCloseTo(safe.x + 4, 5)
      expect(box.w).toBeCloseTo(safe.w - 8, 5)
    }
    // Reading order is row then column: t (row 0) and l (row 0, col 8) before f (row 2).
    expect(boxes.map((box) => box.id)).toEqual(['t', 'l', 'f'])
    expect(boxes[0]!.y).toBeLessThan(boxes[1]!.y)
    expect(boxes[1]!.y).toBeLessThan(boxes[2]!.y)
  })

  it('honours a portrait cell when one is given', () => {
    const withPortrait: GraphicScene = {
      elements: [{ ...scene.elements[2]!, portraitCell: { col: 4, row: 6, colSpan: 4, rowSpan: 2 } }],
    }
    const [box] = graphicLayout(withPortrait, TALL, brand)
    const safe = safeArea(TALL)
    expect(box!.x).toBeCloseTo(safe.x + (safe.w / 12) * 4 + 4, 5)
  })
})

describe('reflowPortrait', () => {
  it('stacks rows and never runs off the grid', () => {
    const tall = reflowPortrait({
      elements: Array.from({ length: 6 }, (_, i) => ({
        kind: 'shape' as const, id: `s${i}`, cell: { col: 0, row: i, colSpan: 12, rowSpan: 3 }, form: 'rect' as const, color: 'surface' as const, opacity: 1, enter: { kind: 'fade' as const, atMs: 0 },
      })),
    })
    for (const element of tall.elements) {
      const cell = element.portraitCell!
      expect(cell.row + cell.rowSpan).toBeLessThanOrEqual(12)
    }
  })
})

describe('fitFontPx', () => {
  it('never exceeds the role size and shrinks a long label to its box', () => {
    expect(fitFontPx('Hi', 2000, 72)).toBe(72)
    const fitted = fitFontPx('A very long label that will not fit at full size', 300, 72)
    expect(fitted).toBeLessThan(72)
    expect(fitted).toBeGreaterThanOrEqual(12)
    // The estimate: glyphs at 0.56 em must fit the width.
    expect('A very long label that will not fit at full size'.length * 0.56 * fitted).toBeLessThanOrEqual(300)
  })
})

describe('tokenColor and roleBasePx', () => {
  it('resolves every token name to a brand colour', () => {
    expect(tokenColor('accent', brand)).toBe(brand.colors.accent)
    expect(tokenColor('collapse', brand)).toBe(brand.colors.semantic.collapse)
    expect(tokenColor('series1', brand)).toBe(brand.colors.chartSeries[1])
    expect(roleBasePx('numbers')).toBe(96)
  })
})

describe('enterProgress and countedValue', () => {
  it('eases from the offset over 600 ms', () => {
    expect(enterProgress(0, 30, 400)).toBe(0)
    expect(enterProgress(12, 30, 400)).toBe(0)
    expect(enterProgress(21, 30, 400)).toBeGreaterThan(0)
    expect(enterProgress(30, 30, 400)).toBe(1)
  })

  it('tweens the digits and keeps every other character in place, landing exactly', () => {
    expect(countedValue('$4bn', 0)).toBe('$0bn')
    expect(countedValue('$4bn', 1)).toBe('$4bn')
    expect(countedValue('1,200 staff', 1)).toBe('1,200 staff')
    expect(countedValue('1,200 staff', 0.5)).toMatch(/^\d{1,3},?\d* staff$/)
    expect(countedValue('94%', 0.5)).toBe('47%')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `packages/compositions`): `npx vitest run src/lib/graphic.test.ts`
Expected: FAIL, `Cannot find module './graphic'`.

- [ ] **Step 3: Write the module**

`packages/compositions/src/lib/graphic.ts`:

```ts
import { GRAPHIC_GRID } from '@boom-busters/schemas'
import type {
  BrandKitTokens,
  GraphicCell,
  GraphicColor,
  GraphicElement,
  GraphicScene,
  GraphicTypeRole,
} from '@boom-busters/schemas'
import { captionSafeArea } from './captions'
import { easeInOut } from './motion'

/**
 * Graphic geometry, pure and unit-tested (decision 268, Plan B). The board's
 * SVG preview and the Remotion card both call this, so the approved graphic
 * is the rendered graphic. Nothing here touches the DOM: text is fitted with
 * an estimate rather than measured, because a measurement made in the
 * board's browser and one made in the render's Chromium would disagree.
 */

export interface GraphicFrame {
  width: number
  height: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface ElementBox extends Box {
  id: string
  /** Text and figures only: the fitted size, so both drawers use one number. */
  fontPx?: number
}

export const GRAPHIC_MARGIN_PX = 36
export const GRAPHIC_GUTTER_PX = 8
/** A conservative average glyph width, in em, for the fit estimate. */
export const AVERAGE_GLYPH_EM = 0.56
const MIN_FONT_PX = 12
const ENTER_MS = 600

function scaleOf(frame: GraphicFrame): number {
  return Math.min(frame.width, frame.height) / 1080
}

/** The frame minus the caption band and the margin: where elements may sit. */
export function safeArea(frame: GraphicFrame): Box {
  const margin = Math.round(GRAPHIC_MARGIN_PX * scaleOf(frame))
  const captions = captionSafeArea(frame.width, frame.height)
  // The caption block's top: its bottom edge less roughly two lines of caption.
  const captionTop = frame.height * captions.bottomFraction - 140 * captions.fontScale * scaleOf(frame)
  return {
    x: margin,
    y: margin,
    w: frame.width - margin * 2,
    h: Math.max(1, Math.min(frame.height - margin, captionTop) - margin),
  }
}

export function roleBasePx(role: GraphicTypeRole): number {
  switch (role) {
    case 'heading':
      return 72
    case 'title':
      return 48
    case 'body':
      return 32
    case 'numbers':
      return 96
    case 'captions':
      return 24
  }
}

export function tokenColor(name: GraphicColor, brand: BrandKitTokens): string {
  const { colors } = brand
  switch (name) {
    case 'collapse':
      return colors.semantic.collapse
    case 'recovery':
      return colors.semantic.recovery
    case 'series0':
    case 'series1':
    case 'series2': {
      const index = Number(name.slice('series'.length))
      return colors.chartSeries[index] ?? colors.accent
    }
    default:
      return colors[name]
  }
}

/** The largest size at or under `basePx` at which `text` fits `boxWidth` by the estimate. */
export function fitFontPx(text: string, boxWidth: number, basePx: number): number {
  const glyphs = Math.max(1, text.length)
  const fitted = Math.floor(boxWidth / (glyphs * AVERAGE_GLYPH_EM))
  return Math.max(MIN_FONT_PX, Math.min(basePx, fitted))
}

function cellBox(cell: GraphicCell, safe: Box, scale: number): Box {
  const cellW = safe.w / GRAPHIC_GRID
  const cellH = safe.h / GRAPHIC_GRID
  const gutter = Math.round((GRAPHIC_GUTTER_PX / 2) * scale)
  return {
    x: safe.x + cellW * cell.col + gutter,
    y: safe.y + cellH * cell.row + gutter,
    w: cellW * cell.colSpan - gutter * 2,
    h: cellH * cell.rowSpan - gutter * 2,
  }
}

function readingOrder(a: GraphicElement, b: GraphicElement): number {
  return a.cell.row - b.cell.row || a.cell.col - b.cell.col
}

/**
 * Portrait: an element with its own `portraitCell` keeps it; the rest are
 * stacked full-width in reading order, each keeping its row span, and the
 * stack is clamped to the grid so nothing falls off the bottom.
 */
export function reflowPortrait(scene: GraphicScene): GraphicScene {
  const ordered = [...scene.elements].sort(readingOrder)
  let row = 0
  const elements = ordered.map((element) => {
    if (element.portraitCell) return element
    const rowSpan = Math.min(element.cell.rowSpan, GRAPHIC_GRID)
    const start = Math.min(row, GRAPHIC_GRID - rowSpan)
    row = start + rowSpan
    return { ...element, portraitCell: { col: 0, row: start, colSpan: GRAPHIC_GRID, rowSpan } }
  })
  return { elements }
}

/** Every element's box, in scene order for landscape and reading order for portrait. */
export function graphicLayout(scene: GraphicScene, frame: GraphicFrame, _brand: BrandKitTokens): ElementBox[] {
  const portrait = frame.height > frame.width
  const laid = portrait ? reflowPortrait(scene) : scene
  const safe = safeArea(frame)
  const scale = scaleOf(frame)
  return laid.elements.map((element) => {
    const cell = portrait ? (element.portraitCell ?? element.cell) : element.cell
    const box = cellBox(cell, safe, scale)
    if (element.kind === 'text') {
      return { id: element.id, ...box, fontPx: fitFontPx(element.content, box.w, roleBasePx(element.role) * scale) }
    }
    if (element.kind === 'figure') {
      return { id: element.id, ...box, fontPx: fitFontPx(element.value, box.w, roleBasePx('numbers') * scale) }
    }
    return { id: element.id, ...box }
  })
}

/** Eased 0..1 from `atMs` over the entrance's length, at this frame. */
export function enterProgress(frameIndex: number, fps: number, atMs: number, durationMs = ENTER_MS): number {
  const t = (frameIndex / fps) * 1000 - atMs
  if (t <= 0) return 0
  return easeInOut(Math.min(1, t / durationMs))
}

/**
 * The figure part-way through its count: each digit group scaled by
 * `progress`, formatted with the same number of decimals and the same
 * thousands separators the final value shows, every other character kept.
 */
export function countedValue(value: string, progress: number): string {
  if (progress >= 1) return value
  return value.replace(/\d[\d,]*(?:\.\d+)?/g, (group) => {
    const decimals = group.includes('.') ? group.split('.')[1]!.length : 0
    const grouped = group.includes(',')
    const number = Number(group.replace(/,/g, '')) * Math.max(0, progress)
    const fixed = number.toFixed(decimals)
    if (!grouped) return fixed
    const [whole, fraction] = fixed.split('.')
    const withCommas = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return fraction === undefined ? withCommas : `${withCommas}.${fraction}`
  })
}
```

Add `"./graphic": "./src/lib/graphic.ts"` to the compositions `package.json` `exports`, after `./chart`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/graphic.test.ts`. Expected: PASS (10 tests). If `countedValue('1,200 staff', 0.5)` yields `'600 staff'` the regex accepts it. `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/lib/graphic.ts packages/compositions/src/lib/graphic.test.ts packages/compositions/package.json
git commit -m "feat(compositions): the graphic layout module, one geometry for preview and render (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `GraphicCard`, its fixtures and goldens

**Files:**
- Create: `packages/compositions/src/components/GraphicCard.tsx`
- Modify: `packages/compositions/src/lib/motion.ts` (add `markerSweep`)
- Modify: `packages/compositions/src/components/HeadlineCard.tsx` (use `markerSweep` instead of its local `marker`)
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx` (dispatch `graphic`)
- Modify: `packages/compositions/src/Root.tsx` (a `GRAPHIC_SCENE` payload, `GraphicCardWide` and `GraphicCardTall` compositions)
- Modify: `packages/compositions/src/snapshot/render.test.ts` (two cases)
- Create: `snapshot/golden/GraphicCardWide.png`, `GraphicCardTall.png` (generated once)

**Interfaces:**
- Consumes: Task 4's module; `GraphicPayload`, `BrandKitTokens`; `typeStyle`, `withAlpha`, `frameScale` from `./brand`; `mediaUrl` from `../lib/motion`.
- Produces: `GraphicCard({ payload, brand })`; `markerSweep(accent: string, sweep: number): CSSProperties` in `lib/motion.ts`.

- [ ] **Step 1: Write the failing test**

Add to `CASES` in `render.test.ts`:

```ts
  // A composed graphic (decision 268, Plan B): frame 45 is 1.5 s in, every
  // element has entered and the figure has finished counting.
  { id: 'GraphicCardWide', frame: 45, maxDiffRatio: 0.06 },
  { id: 'GraphicCardTall', frame: 45, maxDiffRatio: 0.06 },
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/snapshot/render.test.ts -t GraphicCard`. Expected: FAIL, no such compositions.

- [ ] **Step 3: Write the component and register the fixtures**

In `lib/motion.ts` add (moved from `HeadlineCard`'s private `marker`, which then imports this):

```ts
/** The highlighter: an accent wash under the bottom third of the glyphs, swept to `sweep`. */
export function markerSweep(accent: string, sweep: number): CSSProperties {
  return {
    backgroundImage: `linear-gradient(transparent 58%, ${withAlpha(accent, 0.55)} 58%)`,
    backgroundSize: `${Math.min(1, Math.max(0, sweep)) * 100}% 100%`,
    backgroundRepeat: 'no-repeat',
    paddingInline: '0.04em',
  }
}
```

(`motion.ts` gains `import type { CSSProperties } from 'react'` and `import { withAlpha } from '../components/brand'`; if that import direction creates a cycle, place `markerSweep` in `components/brand.ts` instead and say so.)

`components/GraphicCard.tsx`:

```tsx
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion'
import type { CSSProperties } from 'react'
import type { BrandKitTokens, GraphicElement, GraphicPayload } from '@boom-busters/schemas'
import {
  countedValue,
  enterProgress,
  graphicLayout,
  tokenColor,
  type ElementBox,
} from '../lib/graphic'
import { markerSweep, mediaUrl } from '../lib/motion'
import { frameScale, typeStyle, withAlpha } from './brand'

/**
 * A composed graphic (decision 268, Plan B). Every box and font size comes
 * from `graphicLayout`, the module the board's preview also draws from, so
 * what was approved is what renders. Each element enters at its own offset;
 * a figure may count up; an emphasis is a single pulse or the headline
 * card's highlighter sweep. Logos are drawn as they are: contained, never
 * stretched, never recoloured.
 */

const PULSE_AT_MS = 600
const PULSE_MS = 360
const BAR_GROW_MS = 700

function pulseScale(frame: number, fps: number, atMs: number): number {
  const t = (frame / fps) * 1000 - (atMs + PULSE_AT_MS)
  if (t <= 0 || t >= PULSE_MS) return 1
  const phase = Math.sin((t / PULSE_MS) * Math.PI)
  return 1 + 0.04 * phase
}

function enterStyle(kind: GraphicElement['enter']['kind'], progress: number, scale: number): CSSProperties {
  switch (kind) {
    case 'rise':
      return { opacity: progress, transform: `translateY(${(1 - progress) * 24 * scale}px)` }
    case 'wipe':
      return { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` }
    case 'fade':
    case 'count':
      return { opacity: progress }
  }
}

export function GraphicCard({ payload, brand }: { payload: GraphicPayload; brand: BrandKitTokens }) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const scale = frameScale(width, height)
  const boxes = graphicLayout(payload.scene, { width, height }, brand)
  const byId = new Map(boxes.map((box) => [box.id, box]))
  const { colors, typography } = brand

  return (
    <AbsoluteFill style={{ backgroundColor: colors.background }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(90% 75% at 50% 44%, ${colors.surface} 0%, ${colors.background} 72%)`,
        }}
      />
      {payload.scene.elements.map((element) => {
        const box = byId.get(element.id) as ElementBox
        const progress = enterProgress(frame, fps, element.enter.atMs)
        const pulse = element.emphasis === 'pulse' ? pulseScale(frame, fps, element.enter.atMs) : 1
        const base: CSSProperties = {
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.w,
          height: box.h,
          ...enterStyle(element.enter.kind, progress, scale),
          ...(pulse !== 1 ? { transform: `scale(${pulse})` } : {}),
          transformOrigin: 'center',
        }
        const underline = element.emphasis === 'underline' ? markerSweep(colors.accent, enterProgress(frame, fps, element.enter.atMs + 500)) : {}

        switch (element.kind) {
          case 'text':
            return (
              <div
                key={element.id}
                style={{
                  ...base,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: element.align === 'center' ? 'center' : element.align === 'end' ? 'flex-end' : 'flex-start',
                  ...typeStyle(typography[element.role], box.fontPx ?? 32, 1),
                  color: tokenColor(element.color, brand),
                  textAlign: element.align,
                }}
              >
                <span style={underline}>{element.content}</span>
              </div>
            )
          case 'figure': {
            const shown = element.enter.kind === 'count' ? countedValue(element.value, progress) : element.value
            return (
              <div key={element.id} style={{ ...base, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <span style={{ ...typeStyle(typography.numbers, box.fontPx ?? 96, 1), color: tokenColor(element.color, brand), ...underline }}>
                  {shown}
                </span>
                {element.label ? (
                  <span style={{ ...typeStyle(typography.captions, 24 * scale, 1), color: colors.textSecondary, marginTop: 6 * scale }}>
                    {element.label}
                  </span>
                ) : null}
              </div>
            )
          }
          case 'logo': {
            const logo = payload.logos[element.id]
            if (!logo) return null
            return (
              <div key={element.id} style={{ ...base, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Img src={mediaUrl(logo)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              </div>
            )
          }
          case 'shape': {
            const colour = withAlpha(tokenColor(element.color, brand), element.opacity)
            if (element.form === 'rule') {
              return <div key={element.id} style={{ ...base, height: Math.max(2, 3 * scale), top: box.y + box.h / 2, backgroundColor: colour }} />
            }
            return <div key={element.id} style={{ ...base, backgroundColor: colour, borderRadius: element.form === 'disc' ? '50%' : 0 }} />
          }
          case 'bars': {
            const max = Math.max(...element.items.map((item) => Math.abs(item.value)), 1)
            const grow = enterProgress(frame, fps, element.enter.atMs, BAR_GROW_MS)
            const rowH = box.h / element.items.length
            const labelPx = Math.max(12, Math.min(28 * scale, rowH * 0.32))
            return (
              <div key={element.id} style={base}>
                {element.items.map((item, index) => {
                  const lit = element.highlightIndex === undefined || element.highlightIndex === index
                  const colour = lit ? tokenColor(element.color, brand) : withAlpha(colors.textSecondary, 0.5)
                  const barW = (Math.abs(item.value) / max) * box.w * 0.62 * grow
                  return (
                    <div key={item.label} style={{ position: 'absolute', top: rowH * index, height: rowH, width: box.w, display: 'flex', alignItems: 'center', gap: 12 * scale }}>
                      <span style={{ ...typeStyle(typography.captions, labelPx, 1), color: colors.textSecondary, width: box.w * 0.2, textAlign: 'end' }}>{item.label}</span>
                      <div style={{ height: rowH * 0.5, width: barW, backgroundColor: colour }} />
                      <span style={{ ...typeStyle(typography.numbers, labelPx * 1.2, 1), color: colors.textPrimary }}>{item.display}</span>
                    </div>
                  )
                })}
              </div>
            )
          }
        }
      })}
    </AbsoluteFill>
  )
}
```

In `DocumentaryMaster.tsx`: import `GraphicCard`; add `) : slot.payload.kind === 'graphic' ? (<GraphicCard payload={slot.payload} brand={brand} />` beside the `headline` branch.

In `Root.tsx`: import `GraphicCard` and the `GraphicPayload` type; add

```tsx
const GRAPHIC_SCENE: GraphicPayload = {
  kind: 'graphic',
  scene: {
    elements: [
      { kind: 'text', id: 't1', cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 }, content: 'Raised in a single round', role: 'title', color: 'textSecondary', align: 'start', enter: { kind: 'fade', atMs: 0 } },
      { kind: 'figure', id: 'f1', cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 }, value: '$4bn', label: 'valuation, 2022', claimRef: '01HQ00000000000000000000AA', color: 'accent', enter: { kind: 'count', atMs: 300 }, emphasis: 'underline' },
      { kind: 'logo', id: 'l1', cell: { col: 8, row: 1, colSpan: 4, rowSpan: 4 }, entity: 'Stability AI', assetId: '01HQ00000000000000000000L1', enter: { kind: 'rise', atMs: 500 } },
      { kind: 'shape', id: 's1', cell: { col: 0, row: 7, colSpan: 12, rowSpan: 1 }, form: 'rule', color: 'textSecondary', opacity: 0.4, enter: { kind: 'wipe', atMs: 700 } },
      { kind: 'bars', id: 'b1', cell: { col: 0, row: 8, colSpan: 12, rowSpan: 2 }, color: 'collapse', highlightIndex: 1, enter: { kind: 'fade', atMs: 900 }, items: [
        { label: 'raised', value: 4, display: '$4bn', claimRef: '01HQ00000000000000000000AA' },
        { label: 'burned', value: 3.9, display: '$3.9bn', claimRef: '01HQ00000000000000000000AB' },
      ] },
    ],
  },
  logos: { l1: { url: FIXTURE_IMAGE_SKYLINE, width: 1200, height: 400 } },
  claimIds: ['01HQ00000000000000000000AA', '01HQ00000000000000000000AB'],
}
```

and two compositions `GraphicCardWide` (`{...WIDE}`) and `GraphicCardTall` (`{...TALL}`), `durationInFrames={120}`, `defaultProps={{ payload: GRAPHIC_SCENE, brand: FIXTURE_BRAND }}`. If `MediaRefSchema` requires `r2Key` when `url` is present, include `r2Key: 'boom-busters/logos/fixture.png'` too.

- [ ] **Step 4: Generate the two goldens, then run the whole snapshot file**

`REGEN_GOLDEN=1 npx vitest run src/snapshot/render.test.ts -t GraphicCard` (PowerShell: set and remove `$env:REGEN_GOLDEN`). `git status --short src/snapshot/golden` must show exactly the two new PNGs and no modified golden (restore any with `git checkout --`). Open both PNGs: the figure reads `$4bn` at full size, the mark sits top right, the two bars are drawn with the second lit, and in the tall frame everything is one column above the caption band. Then the whole file: `npx vitest run src/snapshot/render.test.ts`, all PASS, including `HeadlineCardWide` and `HeadlineCardTall` after the `markerSweep` move.

- [ ] **Step 5: Commit**

```bash
git add packages/compositions/src/components/GraphicCard.tsx packages/compositions/src/components/HeadlineCard.tsx packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/lib/motion.ts packages/compositions/src/Root.tsx packages/compositions/src/snapshot/render.test.ts packages/compositions/src/snapshot/golden/GraphicCardWide.png packages/compositions/src/snapshot/golden/GraphicCardTall.png
git commit -m "feat(compositions): GraphicCard draws a composed scene, two fixtures and goldens (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Compile and materialise a graphic

**Files:**
- Modify: `packages/timeline/src/compile.ts:40-125` and the payload branch near line 245
- Modify: `packages/timeline/src/compile.test.ts`
- Modify: `apps/web/lib/materialise.ts`, `apps/web/lib/materialise.test.ts`
- Modify: `infra/lambdas/broker/core.ts:155-178`, `infra/lambdas/broker/core.test.ts`

**Interfaces:**
- Produces: `CompileSlot.type` admits `'graphic'`; `CompileSlot.graphic?: { scene: GraphicScene; logos: Record<string, { r2Key: string; width: number; height: number }>; claimIds: string[] }`; `resolveMotion` returns `{ kind: 'static' }` for a graphic; the compiled payload is `{ kind: 'graphic', ...slot.graphic }`. Both materialisers resolve every `payload.logos[id].r2Key` to `url`; the preview drops the slot when one cannot resolve (like a still), the broker presigns each.

- [ ] **Step 1: Write the failing tests**

`compile.test.ts`, beside the headline case:

```ts
it('compiles a graphic to a payload embedding its scene, logos and claims', () => {
  const slot: CompileSlot = {
    type: 'graphic', startMs: 0, durationMs: 6000, transition: 'cut', motion: { kind: 'kenburns', direction: 'in', speed: 'slow' },
    coversText: 'It raised four billion dollars.',
    graphic: {
      scene: { elements: [{ kind: 'text', id: 't', cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 }, content: 'Raised', role: 'heading', color: 'textPrimary', align: 'start', enter: { kind: 'fade', atMs: 0 } }] },
      logos: { l1: { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
      claimIds: ['01HQ00000000000000000000A1'],
    },
  }
  const timeline = compileTimeline({ ...baseInput(), slots: [slot] })
  const compiled = timeline.slots[0]!
  expect(compiled.type).toBe('graphic')
  expect(compiled.payload).toMatchObject({ kind: 'graphic', claimIds: ['01HQ00000000000000000000A1'] })
  expect(compiled.motion).toEqual({ kind: 'static' })
})
```

(`baseInput()` stands for whatever builder the file uses to make a valid `CompileInput`; use the file's own.)

`materialise.test.ts`:

```ts
it('resolves a graphic\'s logo keys, and drops the slot when one will not resolve', async () => {
  const timeline = structuredClone(canonical())
  timeline.slots.push({
    type: 'graphic', startMs: 0, durationMs: 4000, transition: 'cut', motion: { kind: 'static' },
    payload: {
      kind: 'graphic',
      scene: { elements: [{ kind: 'logo', id: 'l1', cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }, entity: 'Stability AI', assetId: '01HQ00000000000000000000L1', enter: { kind: 'fade', atMs: 0 } }] },
      logos: { l1: { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 } },
      claimIds: ['01HQ00000000000000000000A1'],
    },
  })
  const resolved = await materialiseForPreview(timeline, { origin: ORIGIN, presign: (key) => Promise.resolve(`https://r2.example.com/${key}`) })
  const graphic = resolved.timeline.slots.find((slot) => slot.payload.kind === 'graphic')
  expect(graphic && graphic.payload.kind === 'graphic' ? graphic.payload.logos['l1']?.url : null).toBe('https://r2.example.com/boom-busters/logos/abc.png')

  const dropped = await materialiseForPreview(timeline, { origin: ORIGIN, presign: null })
  expect(dropped.timeline.slots.some((slot) => slot.payload.kind === 'graphic')).toBe(false)
  expect(dropped.dropped.slots).toBeGreaterThanOrEqual(1)
})
```

`core.test.ts` (`materialiseTimeline` describe): a graphic slot with one logo key comes back with `payload.logos.l1.url === 'https://signed/boom-busters/logos/abc.png'` and the original is untouched.

- [ ] **Step 2: Run to verify they fail**

From `packages/timeline`: `npx vitest run src/compile.test.ts`; from `apps/web`: `npx vitest run lib/materialise.test.ts`; from `infra`: `npx vitest run lambdas/broker/core.test.ts`. Expected: type errors or failures on the graphic branches.

- [ ] **Step 3: Implement**

`compile.ts`: add `'graphic'` to `CompileSlot.type`; add the `graphic?` field with the doc comment "A composed graphic, embedded whole with the logo keys it draws (decision 268, Plan B)"; in `resolveMotion` add `if (slot.graphic) return { kind: 'static' }` after the map line; in the payload builder add `if (slot.graphic) return { ...base, payload: { kind: 'graphic' as const, ...slot.graphic } }` after the headline branch.

`materialise.ts`, in the slots loop before the `src` handling:

```ts
    if (slot.payload.kind === 'graphic') {
      // The scene is data; only its logos are bytes. One that will not resolve
      // drops the slot, as a still would: a card with a hole is not a preview.
      const logos: typeof slot.payload.logos = {}
      let complete = true
      for (const [id, ref] of Object.entries(slot.payload.logos)) {
        const url = ref.r2Key !== undefined ? await resolveKey(ref.r2Key, deps) : (ref.externalUrl ?? null)
        if (url === null) {
          complete = false
          break
        }
        logos[id] = { ...ref, url }
      }
      if (!complete) {
        dropped.slots += 1
        continue
      }
      slots.push({ ...slot, payload: { ...slot.payload, logos } })
      continue
    }
```

and extend the existing `chart || map || headline` pass-through condition so it no longer needs to mention graphic (it is handled above).

`core.ts` `materialiseTimeline`, in the slots loop:

```ts
    if (slot.payload.kind === 'graphic') {
      for (const ref of Object.values(slot.payload.logos)) {
        if (ref.r2Key !== undefined) ref.url = await presign(ref.r2Key)
        else if (ref.externalUrl !== undefined) ref.url = ref.externalUrl
      }
    }
```

- [ ] **Step 4: Run to verify they pass**

The three commands from Step 2: PASS. `pnpm typecheck` (compile, materialise and the broker now know `graphic`; `assembly.ts`, `visual-assets.ts` and the board may still be red until their tasks).

- [ ] **Step 5: Commit**

```bash
git add packages/timeline/src/compile.ts packages/timeline/src/compile.test.ts apps/web/lib/materialise.ts apps/web/lib/materialise.test.ts infra/lambdas/broker/core.ts infra/lambdas/broker/core.test.ts
git commit -m "feat(render): a graphic compiles to an embedded payload and both materialisers resolve its logos (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Resolution and assembly

**Files:**
- Modify: `apps/web/lib/visual-assets.ts:785-800` (`resolveSlotBrief` case `graphic`) and its test `visual-assets.test.ts`
- Modify: `apps/web/inngest/lib/assembly.ts:150-300` and `assembly.test.ts`
- Modify: `apps/web/inngest/functions/assembly-runner.ts:255-280`

**Interfaces:**
- Consumes: `logoById` from `@boom-busters/db`; `GraphicBrief`.
- Produces: `resolveSlotBrief` returns `{ candidates: [], status: 'resolved' }` when every `logo` element has an `assetId`, else `placeholder`. `AssemblySlotRow.type` admits `'graphic'`; `planSlots` input gains `logos?: ReadonlyMap<string, { r2Key: string; width: number; height: number }>` keyed by asset id; a graphic whose logo element lacks an asset, or whose asset is not in the map, is skipped with `` `a logo for "${entity}" has not been uploaded` ``; otherwise the compile slot carries `graphic: { scene, logos (by element id), claimIds }`. `assembly-runner` loads every cited logo asset with `logoById` into that map before `planSlots`.

- [ ] **Step 1: Write the failing tests**

`visual-assets.test.ts`:

```ts
it('a graphic resolves at no cost when every logo has a mark, and waits as a placeholder otherwise', async () => {
  const brief = (assetId?: string): GraphicBrief => ({
    type: 'graphic', coversText: 'x', description: 'y', motion: { kind: 'static' }, transition: 'cut', shotSize: 'graphic',
    scene: { elements: [{ kind: 'logo', id: 'l1', cell: { col: 0, row: 0, colSpan: 4, rowSpan: 2 }, entity: 'Stability AI', enter: { kind: 'fade', atMs: 0 }, ...(assetId ? { assetId } : {}) }] },
  })
  expect(await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief: brief('01HQ00000000000000000000L1'), route: null })).toEqual({ candidates: [], status: 'resolved' })
  expect(await resolveSlotBrief({ projectId: FIXTURE_PROJECT_ID, brief: brief(), route: null })).toEqual({ candidates: [], status: 'placeholder' })
  expect(generate).not.toHaveBeenCalled()
})
```

`assembly.test.ts` (use the file's row builder):

```ts
it('compiles a graphic with its logo bytes, and skips one whose mark is missing, in words', () => {
  const scene = { elements: [
    { kind: 'figure', id: 'f1', cell: { col: 0, row: 0, colSpan: 6, rowSpan: 3 }, value: '$4bn', claimRef: CLAIM_A, color: 'accent', enter: { kind: 'count', atMs: 0 } },
    { kind: 'logo', id: 'l1', cell: { col: 6, row: 0, colSpan: 6, rowSpan: 3 }, entity: 'Stability AI', assetId: LOGO_ID, enter: { kind: 'fade', atMs: 0 } },
  ] }
  const row = graphicRow({ scene })
  const plan = planSlots({ ...baseInput(), slots: [row], logos: new Map([[LOGO_ID, { r2Key: 'boom-busters/logos/abc.png', width: 1200, height: 400 }]]) })
  expect(plan.slots[0]).toMatchObject({ type: 'graphic', graphic: { logos: { l1: { r2Key: 'boom-busters/logos/abc.png' } }, claimIds: [CLAIM_A] } })

  const missing = planSlots({ ...baseInput(), slots: [graphicRow({ scene: { elements: [{ ...scene.elements[1], assetId: undefined }] } })], logos: new Map() })
  expect(missing.slots).toEqual([])
  expect(missing.skipped[0]?.reason).toBe('a logo for "Stability AI" has not been uploaded')
})
```

- [ ] **Step 2: Run to verify they fail**

From `apps/web`: `npx vitest run lib/visual-assets.test.ts` then `npx vitest run inngest/lib/assembly.test.ts` (one at a time; both touch the test database). Expected: FAIL on the graphic cases.

- [ ] **Step 3: Implement**

`visual-assets.ts` `resolveSlotBrief`, after the `headline` case:

```ts
    case 'graphic': {
      // Nothing is fetched and nothing is spent: the scene is the payload. A
      // logo the library does not hold yet is the one thing that can be
      // missing, and the card asks for the upload rather than a redraft.
      const owed = brief.scene.elements.some((element) => element.kind === 'logo' && element.assetId === undefined)
      return { candidates: [], status: owed ? 'placeholder' : 'resolved' }
    }
```

`assembly.ts`: `AssemblySlotRow.type` and the `planSlots` input gain `graphic` and `logos?: ReadonlyMap<string, { r2Key: string; width: number; height: number }>`; after the headline branch:

```ts
    if (brief.type === 'graphic') {
      const logos: Record<string, { r2Key: string; width: number; height: number }> = {}
      let missing: string | null = null
      for (const element of brief.scene.elements) {
        if (element.kind !== 'logo') continue
        const asset = element.assetId ? input.logos?.get(element.assetId) : undefined
        if (!asset) {
          missing = element.entity
          break
        }
        logos[element.id] = asset
      }
      if (missing !== null) {
        skipped.push({ slotId: row.id, reason: `a logo for "${missing}" has not been uploaded` })
        continue
      }
      const claimIds = [...new Set(brief.scene.elements.flatMap((element) =>
        element.kind === 'figure' ? [element.claimRef] : element.kind === 'bars' ? element.items.map((item) => item.claimRef) : [],
      ))]
      slots.push({ ...base, type: 'graphic', graphic: { scene: brief.scene, logos, claimIds } })
      continue
    }
```

`assembly-runner.ts`, beside the articles map:

```ts
      // The marks every graphic draws, read once by asset id (decision 268).
      const logos = new Map<string, { r2Key: string; width: number; height: number }>()
      for (const row of rows) {
        const brief = ShotBriefSchema.safeParse(row.brief)
        if (!brief.success || brief.data.type !== 'graphic') continue
        for (const element of brief.data.scene.elements) {
          if (element.kind !== 'logo' || !element.assetId || logos.has(element.assetId)) continue
          const asset = await logoById(db, element.assetId)
          if (asset?.width && asset.height) logos.set(asset.id, { r2Key: asset.r2Key, width: asset.width, height: asset.height })
        }
      }
```

and pass `logos` into `planSlots`. Fit the variable names to the file's own (it loops `rows` for headlines already).

- [ ] **Step 4: Run to verify they pass**

Both test files, one at a time: PASS. `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts apps/web/inngest/lib/assembly.ts apps/web/inngest/lib/assembly.test.ts apps/web/inngest/functions/assembly-runner.ts
git commit -m "feat(visuals): a graphic resolves free, waits for its marks, and assembles with their bytes (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The planner writes graphics

**Files:**
- Modify: `packages/providers/src/prompts/shotlist.ts` (`slotShapes`, rules, `buildShotListRequest` input `logos?: readonly string[]`, `mockShotList` input `logoTitles?: readonly string[]`)
- Modify: `packages/providers/src/prompts/shotlist.test.ts`
- Modify: `apps/web/inngest/lib/direction.ts:205-262` (`planChapterSlots` input `logos?: readonly LogoIndex[]`, threaded to `mockShotList`, `buildShotListRequest` and `plannedToRows`)
- Modify: `apps/web/inngest/lib/direction.test.ts`
- Modify: `packages/schemas/src/visuals.ts` `plannedToRows` (input `logos?: readonly LogoIndex[]`, passed to `resolvePlannedBrief` and `plannedBriefRejection`)

**Interfaces:**
- Produces: the prompt's `graphic` shape and rules; the `Logos` list in the cacheable prefix; the mock emits one graphic when `claimCount > 0` (a `figure` citing claim 1 whose value is the first digit group of that claim's text, a `text` label, and a `logo` for the first logo title, or none when the library is empty); `planChapterSlots` gathers nothing itself (the caller passes `logos`), and the runner that calls it passes `await listLogos(db)` mapped to `{ id, title }`.

- [ ] **Step 1: Write the failing tests**

`shotlist.test.ts`:

```ts
it('describes the graphic shape, its rules, and lists the marks the library holds', () => {
  const request = buildShotListRequest({ ...baseRequest(), logos: ['Stability AI', 'Wirecard AG'] })
  const system = request.system
  expect(system).toContain('"type": "graphic"')
  expect(system).toMatch(/never a chart with fewer points/i)
  expect(system).toMatch(/six elements at most/i)
  expect(system).toMatch(/bottom two rows/i)
  const prefix = request.messages[0]!.content
  expect(prefix).toContain('Logos (marks the producer holds')
  expect(prefix).toContain('- Stability AI')
})

it('the mock plans one graphic citing the first claim, with a mark when the library has one', () => {
  const out = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 2, claimTexts: ['The company raised $4 billion.', 'x'], logoTitles: ['Wirecard AG'] })
  const graphic = out.slots.find((slot) => slot.brief.type === 'graphic')
  expect(graphic).toBeDefined()
  if (!graphic || graphic.brief.type !== 'graphic') return
  const figure = graphic.brief.scene.elements.find((element) => element.kind === 'figure')
  expect(figure).toMatchObject({ claimRef: 1, value: '$4bn' })
  expect(graphic.brief.scene.elements.find((element) => element.kind === 'logo')).toMatchObject({ entity: 'Wirecard AG' })
  const bare = mockShotList({ paragraphs: PARAGRAPHS, claimCount: 1, claimTexts: ['Some 94 percent left.'] })
  const bareGraphic = bare.slots.find((slot) => slot.brief.type === 'graphic')
  expect(bareGraphic && bareGraphic.brief.type === 'graphic' ? bareGraphic.brief.scene.elements.some((e) => e.kind === 'logo') : true).toBe(false)
})
```

(`mockShotList` gains `claimTexts?: readonly string[]` so the mock figure's digits truly come from the claim; `figureDigitGroups` from `@boom-busters/schemas` picks the first group, and the mock writes `$<group>bn` when the claim mentions "billion", else the bare group.)

`direction.test.ts`: `planChapterSlots` with mock providers, two claims and `logos: [{ id, title: 'Wirecard AG' }]` yields one `graphic` row whose logo element carries that `assetId` and whose figure's `claimRef` is the first claim's id; with `logos: []` the row is stored with the logo element lacking `assetId`.

- [ ] **Step 2: Run to verify they fail**

From `packages/providers`: `npx vitest run src/prompts/shotlist.test.ts`; from `apps/web`: `npx vitest run inngest/lib/direction.test.ts`.

- [ ] **Step 3: Implement**

`shotlist.ts` `slotShapes(hasSets, hasLogos)`: add after the headline shape:

```
- {"type": "graphic", "coversText", "description", "motion", "transition",
   "scene": {"elements": [element, ...]}} where each element is one of:
   {"kind": "text", "id", "cell", "content" (max 120 chars), "role": "heading"|"title"|"body"|"numbers"|"captions",
    "color", "align"?: "start"|"center"|"end", "enter"?, "emphasis"?}
   {"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
    "claimRef": claim number, "color", "enter"?, "emphasis"?}
   {"kind": "logo", "id", "cell", "entity": the company or person's exact name, "enter"?}
   {"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1}
   {"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number}] (2 to 5),
    "color", "highlightIndex"?}
   "cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid; "color" is one of
   primary, accent, background, surface, textPrimary, textSecondary, captionHighlight, collapse,
   recovery, series0, series1, series2; "enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"}
   ("count" only on a figure); "emphasis" is "pulse"|"underline".
```

and in the planning rules:

```
- A "graphic" is for a beat that is one or two cited figures, a company's or a person's
  mark, or a relationship between named things (a before and after, a comparison of two or
  three amounts, three dated moments). It is never a chart with fewer points: a value moving
  through time is a "chart". Every "figure" and every "bars" item cites the claim NUMBER its
  value comes from, and the digits shown must appear in that claim. Colours and type roles
  are the names listed; there is no other styling. Six elements at most; leave the bottom two
  rows clear for captions. A "logo" names the company or person exactly as listed under
  Logos; if no mark is listed for them, still name them and the producer will upload it.
```

`buildShotListRequest` input gains `logos?: readonly string[]`; the prefix gains, after Sets:

```ts
    (logos.length > 0
      ? `\n\nLogos (marks the producer holds; a graphic's "logo" names one exactly):\n` +
        logos.map((title) => `- ${title}`).join('\n')
      : '')
```

`mockShotList` input gains `claimTexts?: readonly string[]` and `logoTitles?: readonly string[]`; after the map slot, when `first && input.claimCount > 0`, push a graphic slot on `first.index`, `seconds: 6`, brief `{ type: 'graphic', coversText, description: '[mock] The figure, large, with the mark beside it.', shotSize: 'graphic', motion: { kind: 'static' }, transition: 'cut', scene: { elements: [text t1 (role title, textSecondary, cell 0,0,7,2, content '[mock] Raised in one round'), figure f1 (cell 0,2,7,4, value from claim 1, claimRef 1, color accent, enter count 300), ...(logoTitles[0] ? [logo l1 (cell 8,1,4,4, entity: logoTitles[0])] : [])] } }`.

`plannedToRows` in `visuals.ts` gains `logos?: readonly LogoIndex[]` and passes `input.logos ?? []` to both resolution functions. `planChapterSlots` gains `logos?: readonly LogoIndex[]`, passes `logoTitles: input.logos?.map((l) => l.title)` and `claimTexts: input.claims.map((c) => c.text)` to the mock, `logos: input.logos?.map((l) => l.title)` to the request, and `logos: input.logos` to `plannedToRows`. Find the caller of `planChapterSlots` (grep in `apps/web/inngest`) and pass `logos: (await listLogos(db)).map((row) => ({ id: row.id, title: row.title ?? '' }))`.

- [ ] **Step 4: Run to verify they pass**

The two files from Step 2: PASS. `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts packages/schemas/src/visuals.ts apps/web/inngest/lib/direction.ts apps/web/inngest/lib/direction.test.ts apps/web/inngest/functions
git commit -m "feat(plan): the planner composes graphics from the vocabulary, cites claims, names marks (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Graphic is a model-drafted format on the board

**Files:**
- Modify: `packages/providers/src/prompts/retype.ts` (`RetypeInput.targetType` admits `'graphic'`; the target shape; `mockRetypedBrief` graphic branch; `parseRetypedBrief` and `buildRetypeRequest` take `logos?: readonly string[]` / `logos?: readonly LogoIndex[]`)
- Modify: `packages/providers/src/prompts/retype.test.ts`
- Modify: `apps/web/inngest/functions/slot-retyper.ts:111-175`, `slot-rebriefer.ts:125-140` (`graphic` joins `chart || map`; both pass the logo index)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (the retype toast condition `type === 'chart' || type === 'map'` gains `graphic`; add `attachGraphicLogosAction`)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Produces: `attachGraphicLogosAction(projectId: string, slotId: string): Promise<ActionResult>`: re-runs `logoForEntity` over the stored scene's logo elements against `listLogos`, writes the brief with the new `assetId`s, sets the slot `resolved` when none is missing, else leaves `placeholder`; no model call.

- [ ] **Step 1: Write the failing tests**

`retype.test.ts`: `mockRetypedBrief({ brief, targetType: 'graphic', claimIds: [A], claimTexts: ['raised $4 billion'], logoTitles: ['Wirecard AG'] })` returns a graphic whose figure cites `A` with value `$4bn` and whose logo names `Wirecard AG`; `buildRetypeRequest({ ..., targetType: 'graphic' })` names the graphic shape and the rule "never a chart with fewer points".

`visuals-actions.test.ts`: seed a graphic slot whose logo element has no `assetId` (status `placeholder`), insert a logo titled to match, call `attachGraphicLogosAction`, read the row: the element carries the asset id and the status is `resolved`; with no matching logo the status stays `placeholder` and the result says `A mark for "X" is still missing.`

- [ ] **Step 2: Run to verify they fail**

From `packages/providers`: `npx vitest run src/prompts/retype.test.ts`; from `apps/web`: `npx vitest run "app/(console)/projects/[id]/visuals-actions.test.ts"`.

- [ ] **Step 3: Implement**

`retype.ts`: widen `targetType` to `Extract<ShotSlotType, 'chart' | 'map' | 'graphic'>`; add a `graphic` target string (the same shape text as Task 8's, followed by the same rule paragraph); `mockRetypedBrief` gains `claimTexts?` and `logoTitles?` and a `graphic` branch mirroring Task 8's mock; `parseRetypedBrief(output, { targetType, claims, logos = [] })` passes `logos` into `resolvePlannedBrief`.

`slot-retyper.ts` line 117 and `slot-rebriefer.ts` line 129: `chart || map` becomes `chart || map || graphic`; both load `const logos = (await listLogos(db)).map((row) => ({ id: row.id, title: row.title ?? '' }))` and pass `logoTitles`/`logos` through. The retyper's refusal text for non-model targets is unchanged.

`visuals-actions.ts`: the toast condition in the board (in `visual-board.tsx`, `type === 'chart' || type === 'map'`) is Task 10's; here add:

```ts
/**
 * A graphic waiting on a mark, re-joined to the library after an upload
 * (decision 268, Plan B). No model runs: the scene names its entities and
 * the library either holds them now or still does not.
 */
export async function attachGraphicLogosAction(projectId: string, slotId: string): Promise<ActionResult> {
  await requireOwner()
  const invalid = badIds(projectId, slotId)
  if (invalid) return invalid
  const slot = await getShotSlot(db, slotId)
  if (!slot || slot.projectId !== projectId) return { ok: false, error: 'This slot no longer exists.' }
  const parsed = ShotBriefSchema.safeParse(slot.brief)
  if (!parsed.success || parsed.data.type !== 'graphic') return { ok: false, error: 'This slot is not a graphic.' }

  const logos = (await listLogos(db)).map((row) => ({ id: row.id, title: row.title ?? '' }))
  let missing: string | null = null
  const elements = parsed.data.scene.elements.map((element) => {
    if (element.kind !== 'logo') return element
    const logo = logoForEntity(element.entity, logos)
    if (!logo) {
      missing ??= element.entity
      return element
    }
    return { ...element, assetId: logo.id }
  })
  const brief = { ...parsed.data, scene: { elements } }
  await updateShotBrief(db, slotId, brief)
  await setSlotStatus(db, slotId, missing === null ? 'resolved' : 'placeholder')
  refresh(projectId)
  return missing === null ? { ok: true } : { ok: false, error: `A mark for "${missing}" is still missing.` }
}
```

Use the file's own helpers for reading a slot, writing a brief and setting status (search `editBriefAction` for the names it uses: they exist because that action writes a brief). If no status setter exists, use `setSlotResolution` from `@boom-busters/db` with `{ status, candidates: [], answered: { brief, route: null } }` in the shape `visual-assets.ts` uses.

- [ ] **Step 4: Run to verify they pass**

Both files: PASS. `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/retype.ts packages/providers/src/prompts/retype.test.ts apps/web/inngest/functions/slot-retyper.ts apps/web/inngest/functions/slot-rebriefer.ts "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.test.ts"
git commit -m "feat(board): graphic is a model-drafted format, and an uploaded mark re-joins a waiting graphic (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: The preview and the card

**Files:**
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView.logoUrls: Record<string, string>` keyed by asset id; the review model carries `brandKit: BrandKitStored`)
- Modify: `apps/web/app/(console)/projects/[id]/slot-previews.tsx` (`GraphicPreview`, `GraphicErrorCard`) and `slot-previews.test.tsx` (create if absent)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`GraphicSlot`; the format picker's drafting toast; `brand` prop) and `visual-board.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (pass `brand={settings.brandKit}` and the logo URLs)

**Interfaces:**
- Consumes: `graphicLayout`, `safeArea`, `tokenColor`, `roleBasePx` from `@boom-busters/compositions/graphic`; `resolveBrandKit`; `createLogoUploadAction`, `finaliseLogoAction` from `@/app/(console)/settings/logo-actions`; `toUploadableLogo`, `readImageSize` from `@/lib/client-image`; `attachGraphicLogosAction` (Task 9).
- Produces: `GraphicPreview({ brief, brand, logoUrls })` (SVG, 480 by 270, the resting frame; a logo without an asset draws a dashed box labelled `logo: <entity> (upload)`; one with a URL draws `<image>`); `GraphicErrorCard({ message })`; `GraphicSlot({ slot, brief, projectId, act, brand })` with the preview, the claim chips over the scene's claim ids, and for each unresolved logo element an `Add logo for <entity>` button that opens an inline picker (`accept={LOGO_ACCEPT}`), converts, presigns, PUTs, finalises with the entity as the name, then calls `attachGraphicLogosAction`. `VisualBoard` gains `brand: BrandKitStored`.

- [ ] **Step 1: Write the failing tests**

`slot-previews.test.tsx`:

```tsx
it('draws the resting frame from the shared layout, and a dashed box where a mark is missing', () => {
  render(<GraphicPreview brief={graphicBrief} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{}} />)
  const svg = screen.getByRole('img', { name: /graphic: It raised four billion/ })
  expect(svg).toBeInTheDocument()
  expect(screen.getByText('$4bn')).toBeInTheDocument()
  expect(screen.getByText('logo: Stability AI (upload)')).toBeInTheDocument()
})

it('draws the mark when the library holds it', () => {
  render(<GraphicPreview brief={withAsset} brand={DEFAULT_SETTINGS.brandKit} logoUrls={{ [LOGO_ID]: 'https://r2.example/abc.png' }} />)
  expect(document.querySelector('image')?.getAttribute('href')).toBe('https://r2.example/abc.png')
})
```

`visual-board.test.tsx`: a graphic slot renders `Graphic` as its badge, the claim chips (`claim 1`), and, when a logo element lacks an asset, a button `Add logo for Stability AI`; clicking it and choosing a PNG calls `createLogoUploadAction`, `finaliseLogoAction` with `title: 'Stability AI'`, then `attachGraphicLogosAction` (mock all three plus `@/lib/client-image`). The format picker offers `Graphic` and its click toasts `Drafting the graphic`.

- [ ] **Step 2: Run to verify they fail**

From `apps/web`: `npx vitest run "app/(console)/projects/[id]/slot-previews.test.tsx" "app/(console)/projects/[id]/visual-board.test.tsx"`.

- [ ] **Step 3: Implement**

`GraphicPreview`: `const brandTokens = resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand })` (the layout wants the resolved shape; `voice` is unused); `const boxes = graphicLayout(brief.scene, { width: 480, height: 270 }, brandTokens)`; render `<svg viewBox="0 0 480 270" role="img" aria-label={`graphic: ${brief.coversText}`}>`, a `<rect>` of `colors.background`, then per element: text and figure as `<text>` with `fontSize={box.fontPx}` and `fontFamily` from the role's `family`, `fill` from `tokenColor`; shape as `<rect>`/`<circle>`; bars as proportional `<rect>`s with `<text>` displays; logo as `<image href preserveAspectRatio="xMidYMid meet">` when `logoUrls[assetId]` exists, else a dashed `<rect>` with `<text>` `logo: ${entity} (upload)`. Reuse `ChartErrorCard`'s markup for `GraphicErrorCard` (or export a shared `DrawnCardError` and alias both).

`visual-board.tsx`: `GraphicSlot` beside `HeadlineSlot`; the type-specific middle gains `brief?.type === 'graphic' ? <GraphicSlot .../>`; the drafting toast condition gains `graphic`; the board's `slotTypeLabel` gains `Graphic`. The inline uploader is a small `GraphicLogoUploader({ entity, projectId, slotId, act })` in the same file: a hidden `<input type="file" accept={LOGO_ACCEPT} aria-label={`Choose a logo file for ${entity}`}>` and the `Add logo for ${entity}` button; on change: `toUploadableLogo` then hash, `createLogoUploadAction`, `fetch` PUT, `readImageSize`, `finaliseLogoAction({ key, contentHash, title: entity, width, height })`, then `attachGraphicLogosAction(projectId, slotId)`, all inside `act(slot.id, ..., 'Mark added; the graphic has it now')`.

`visuals-review.ts`: while building `SlotView`s, collect every graphic logo `assetId`, load them with `logoById`, presign when storage is configured (like `photoUrls`), and set `slot.logoUrls`. `page.tsx` passes `brand={settings.brandKit}`.

- [ ] **Step 4: Run to verify they pass**

The two test files: PASS. `pnpm typecheck` is now expected clean across the repo; `pnpm lint`, `pnpm format:check`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/visuals-review.ts "apps/web/app/(console)/projects/[id]/slot-previews.tsx" "apps/web/app/(console)/projects/[id]/slot-previews.test.tsx" "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -m "feat(board): the graphic card, its SVG preview from the shared layout, and Add logo for a missing mark (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Seeded graphics and the e2e

**Files:**
- Modify: `e2e/global-setup.ts` (two graphic slots on the plan-checkpoint project: one resolved with the seeded `Wirecard AG (E2E)` mark, one placeholder naming `Acme Capital (E2E)`)
- Modify: `e2e/tests/visual-plan.spec.ts`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing spec**

```ts
test('a graphic card previews from the shared layout, chips its claims, and asks for a missing mark', async ({ page }) => {
  const resolved = page.locator('[id^="slot-"]').filter({ hasText: 'raised four billion' })
  await expect(resolved.getByRole('img', { name: /^graphic:/ })).toBeVisible()
  await expect(resolved.getByText('claim 1')).toBeVisible()
  await expect(resolved.getByText('Graphic', { exact: true })).toBeVisible()

  const waiting = page.locator('[id^="slot-"]').filter({ hasText: 'Acme Capital' })
  await expect(waiting.getByRole('button', { name: 'Add logo for Acme Capital (E2E)' })).toBeVisible()
  await expect(waiting.getByText('logo: Acme Capital (E2E) (upload)')).toBeVisible()
  // The price is unchanged: a graphic costs nothing to fetch.
  await expect(page.getByRole('button', { name: 'Fetch visuals · 2 slots · est. $0.14' })).toBeVisible()
  await expectHitTargets(page)
})
```

- [ ] **Step 2: Run to verify it fails**

From `e2e`: `npx playwright test tests/visual-plan.spec.ts --project=desktop`. Expected: the graphic cards are not there.

- [ ] **Step 3: Seed**

In `global-setup.ts`, beside the seeded chart slot (index positions after the existing ones), two rows with `type: 'graphic'`: the first with a `text`, a `figure` (`value: '$4bn'`, `claimRef` the seeded claim id whose text carries `4 billion`; if no seeded claim does, add `4 billion` to the seeded claim's text used for `dataRefs`), and a `logo` with `entity: 'Wirecard AG (E2E)'` and `assetId` set to the seeded logo's id (read it back with `findLogoByName`), `status: 'resolved'`, `coversText: 'It raised four billion dollars.'`; the second with a `logo` element `entity: 'Acme Capital (E2E)'` and no `assetId`, `status: 'placeholder'`, `coversText: 'Acme Capital led the round.'`. Both `startMs`/`durationMs` after the existing slots.

- [ ] **Step 4: Run to verify it passes, then the whole suite**

`npx playwright test tests/visual-plan.spec.ts`, then `pnpm e2e` from the root (foreground). Expected: the new test passes on both projects; total 117 plus the new cases; the price assertion still holds.

- [ ] **Step 5: Commit**

```bash
git add e2e/global-setup.ts e2e/tests/visual-plan.spec.ts
git commit -m "test(e2e): seeded graphics preview, chip their claims, and ask for a missing mark (decision 268, Plan B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Record the decision

**Files:**
- Modify: `PROGRESS.md` (entry 53)
- Modify: `docs/03-build-spec.md` (section 5 `shot_slots.type` list at line 114; section 8.2 payload union at line 224; section 8.3 inventory at line 234; section 11.3 visual board at line 320)
- Modify: `docs/superpowers/specs/2026-09-21-motion-graphics-design.md` section 5.1 (the `fitText` deviation)

- [ ] **Step 1: Write**

PROGRESS entry 53, in entry 52's shape: title **The graphic slot: a scene the planner composes** (decision 268, Plan B; 2026-09-22); paragraphs on the vocabulary and its rules with teeth (token names only, six elements, figures checked against claim text in code), the one-layout rule and why the fit is an estimate rather than a measurement, resolution (numbers to ids, entities to marks, a missing mark is a placeholder with an upload button, never a refusal), the planner and the two model-drafted paths, the migration (0027, one enum value), and `_Tests._` with counts from your final run.

Build-spec amendments (italic parentheticals, appended): section 5 adds `graphic` to the type list; 8.2 adds `GraphicPayload` (scene, logos by element id, claim ids); 8.3 adds `GraphicCard` and the shared `graphic` layout module; 11.3 adds the graphic card's preview, claim chips and `Add logo for …`.

Spec 5.1: append `*(Amended while planning Plan B: text is fitted with a pure estimator in the layout module, not measured with `@remotion/layout-utils`, so the board's browser and the render's Chromium compute the same size.)*`

- [ ] **Step 2: Check and commit**

Dash scan of added lines (node, the two code points hex 2013 and hex 2014; must print nothing); `npx prettier --check PROGRESS.md`; `pnpm format:check`.

```bash
git add PROGRESS.md docs/03-build-spec.md docs/superpowers/specs/2026-09-21-motion-graphics-design.md
git commit -m "docs: decision 268 Plan B, the graphic slot, recorded

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage.** 3.1 slot type: Tasks 2 and 3. 3.2 scene: Task 1. 3.3 payload: Task 2 (schema), Task 6 (compile and materialise). 3.4 planned form: Tasks 1 and 2. 4.1 prompt: Task 8; retype and rebrief: Task 9. 4.2 resolution: Task 2 (pure), Task 7 (`resolveSlotBrief`), Task 9 (`attachGraphicLogosAction`). 4.3 `figureCitesClaim`: Task 1. 5.1 layout: Task 4 (with the ruled deviation). 5.2 `GraphicCard`: Task 5. 5.3 compile and materialise: Tasks 6 and 7. 5.4 preview: Task 10. 6.4 board upload: Task 10. 7 card: Task 10. 8 cost: Task 7 ($0) and Task 11's price assertion. 9 tests: every task. 10 migration: Task 3; the Remotion redeploy is the owner's script and is noted for the handoff.

**Placeholders.** None: each step names its code or command. Where a file's own helper name is needed (`baseInput()`, `canonical()`, `graphicRow()`, the slot-writing helpers in `visuals-actions.ts`) the step says to use the file's own and names what it must do.

**Type consistency.** `GraphicScene`/`GraphicElement` (Task 1) are what Tasks 4, 5, 6, 7 and 10 consume. `GraphicPayload.logos` is keyed by element id everywhere (Task 2 schema, Task 5 fixture, Task 6 compile and materialisers, Task 7 assembly). `resolvePlannedBrief(brief, claims, logos)` (Task 2) is called with the same third argument by `plannedToRows` (Task 8) and `parseRetypedBrief` (Task 9). `LogoIndex` `{ id, title }` (Plan A) is the shape every caller maps `listLogos` rows onto. `attachGraphicLogosAction(projectId, slotId)` (Task 9) is what the card calls (Task 10).
