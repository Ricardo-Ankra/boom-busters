# Graphics Designer (decision 289, stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Graphics get their own model route, prompt and pipeline step (one call per graphic slot), a Redesign graphic button, and an in-board player that runs the real `GraphicCard`.

**Architecture:** The shot list stops composing scenes and writes an `intent` plus `intentRefs`; a new per-slot Inngest step calls the `graphics` route through `callLlm`, checks the scene with the existing citation checks plus a new late-entrance check, retries once with the reason, and stores either the scene or a `designIssue`. Redesign and retype reach the same `designGraphic` service. The board plays the stored scene through `@remotion/player` and `GraphicCard`, so motion has one renderer.

**Tech Stack:** pnpm/turbo monorepo; Zod 4 schemas (`packages/schemas`); prompts and mocks (`packages/providers`); Next.js App Router, server actions, Inngest functions, Vitest + Testing Library (`apps/web`); Remotion 4.0.512 (`packages/compositions`, `@remotion/player`); Playwright e2e (mock providers).

**Spec:** `docs/superpowers/specs/2026-10-06-graphics-designer-design.md`

## Global Constraints

- The task key is `graphics`; the Settings → Models row label is "Motion graphics"; the default route is `{ provider: 'anthropic', model: 'claude-opus-5-5' }`.
- A stored graphic brief: `scene?`, `intent?` (1 to 300 chars), `intentClaimIds?` (0 to 6 ULIDs), `designIssue?` (1 to 500 chars). A stored brief with a scene and no intent (made before this) must parse and render unchanged.
- A planned graphic brief (shot list, retype, repair): common fields plus `intent` (1 to 300 chars) and `intentRefs` (0 to 6 claim numbers, default `[]`); no `scene`.
- An `intentRefs` number outside the claim list drops the planned slot with a reason, as a chart's bad `dataRefs` do.
- The graphics call: system prompt plus one cacheable film message plus one per-slot message, `cacheablePrefixMessages: 1`, `maxTokens: outputBudget(GRAPHIC_ANSWER_TOKENS)` with `GRAPHIC_ANSWER_TOKENS = 3000`; a reply cut off at `maxTokens` gets one retry at double; a parse or check failure gets one retry with the reason; a second failure is "not designed".
- An entrance must start no later than `durationMs - GRAPHIC_ENTER_MS` (600 ms), using the same effective start times the card uses (authored `atMs` when any element is timed, else `index * 180`).
- No change to the render's behaviour, the timeline schema or the broker. No migration. No `deploy:remotion` or broker deploy.
- Every action is a visible labelled button (build spec section 11.1). Player buttons: "Play graphic", "Pause", "Replay", "Portrait" / "Landscape".
- Mock-provider mode (`mockProvidersEnabled()`) makes no paid call anywhere in this feature.
- A new field is read inside an Inngest step, never outside one (decision 279).
- Before every commit: `pnpm exec prettier --check` on the files touched, and `pnpm exec eslint --max-warnings 0` on them. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Long test runs use the Bash tool's `timeout: 600000`; never two database suites at once; Docker Desktop must be running for `packages/db` and web DB tests.

## Review Focus

1. A redesign whose call fails or is rejected must leave the slot's previous scene exactly as it was (the card shows why). Pinned in Task 7.
2. A graphic stored before this feature (scene, no intent) must still preview, play, assemble and be redesignable, with its description standing in as the intent. Pinned in Tasks 2, 4, 8 and 9.
3. The Fix button (`rewriteStoredBriefs`) rewriting a designed graphic must not wipe its scene. Pinned in Task 6 (`keepGraphicDesign`).
4. A sceneless graphic must never reach the timeline: assembly skips it with a reason, the board shows "Not designed", the Fetch count treats it as unresolved. Pinned in Task 2.
5. A slot so short that even unauthored staggered entrances run past its end must come back "not designed" with the timing reason, not crash or ship. Pinned in Task 1 (rule) and Task 4 (service).

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/schemas/src/settings.ts` | `graphics` task and route default | 1 |
| `packages/schemas/src/graphics.ts` | entrance timing constants, `graphicEnterTimes`, `lateEntranceIssue` | 1 |
| `packages/compositions/src/lib/graphic.ts` | `staggeredEnterMs` delegates to `graphicEnterTimes` (same values) | 1 |
| `apps/web/app/(console)/settings/models-tab.tsx` | "Motion graphics" label | 1 |
| `packages/schemas/src/visuals.ts` | stored graphic brief fields, `resolvePlannedScene`, `toPlannedScene`, `graphicIntentOf` | 2 (planned shape in 5) |
| Scene readers in web and assembly | handle a sceneless graphic | 2 |
| `packages/providers/src/prompts/graphics.ts` | graphics request, parse, mock, word offsets | 3 |
| `apps/web/lib/graphic-design.ts` | `designGraphic`, `withDesign`, `loadGraphicContext` | 4 |
| `packages/providers/src/prompts/shotlist.ts`, `retype.ts` | planned graphic becomes intent-only | 5 |
| `apps/web/inngest/lib/graphic-steps.ts` | per-graphic steps for both runners | 6 |
| `visuals-runner.ts`, `visuals-replanner.ts`, `direction.ts` | call the steps; keep designs through the Fix button | 6 |
| `slot-rebriefer.ts`, `slot-retyper.ts` | Redesign graphic and retype reach the designer | 7 |
| `visual-board.tsx`, `visuals-actions.ts` | intent line, Not designed, Redesign copy, intent editing | 8 |
| `apps/web/app/(console)/projects/[id]/graphic-player.tsx` | player, playback context, buttons | 9 |
| `e2e/tests/visual-plan.spec.ts`, `PROGRESS.md` | e2e, decision 289 | 10 |

---

### Task 1: The `graphics` route and the entrance timing rule

**Files:**
- Modify: `packages/schemas/src/settings.ts` (LLM_TASKS L30 to 39, ModelRoutingSchema L186 to 211, DEFAULT_SETTINGS L626 to 647)
- Modify: `packages/schemas/src/graphics.ts` (after `GraphicEnterSchema`, L63 to 68)
- Modify: `packages/compositions/src/lib/graphic.ts` (`ENTER_MS` L70, `STAGGER_MS` L455, `staggeredEnterMs` L477)
- Modify: `apps/web/app/(console)/settings/models-tab.tsx` (`TASK_LABELS` L36 to 44)
- Test: `packages/schemas/src/settings.test.ts`, `packages/schemas/src/graphics.test.ts`, `packages/compositions/src/lib/graphic.test.ts`, `apps/web/app/(console)/settings/models-tab.test.tsx`

**Interfaces:**
- Produces: `LlmTask` includes `'graphics'`; `DEFAULT_GRAPHICS_ROUTE`; `GRAPHIC_ENTER_MS = 600`; `GRAPHIC_STAGGER_MS = 180`; `graphicEnterTimes(scene: { elements: readonly { id: string; enter: { atMs: number } }[] }): Map<string, number>`; `lateEntranceIssue(scene: GraphicTimingScene, durationMs: number): string | null`.

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/schemas/src/settings.test.ts`:

```ts
describe('the graphics route (decision 289)', () => {
  it('is an LLM task with Opus 5.5 as its default', () => {
    expect(LLM_TASKS).toContain('graphics')
    expect(DEFAULT_SETTINGS.modelRouting.graphics).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    })
  })

  it('fills the default into routing stored before it existed', () => {
    const { graphics: _dropped, ...stored } = DEFAULT_SETTINGS.modelRouting
    const parsed = ModelRoutingSchema.parse(stored)
    expect(parsed.graphics).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })
})
```

(Add `ModelRoutingSchema` and `LLM_TASKS` to the file's import from `./settings` if absent.)

Append to `packages/schemas/src/graphics.test.ts`:

```ts
describe('entrance timing (decision 289)', () => {
  const el = (id: string, atMs: number) => ({ id, enter: { atMs } })

  it('staggers unauthored entrances 180 ms apart', () => {
    const times = graphicEnterTimes({ elements: [el('a', 0), el('b', 0), el('c', 0)] })
    expect([...times.values()]).toEqual([0, 180, 360])
  })

  it('uses authored times as written once any element is timed', () => {
    const times = graphicEnterTimes({ elements: [el('a', 0), el('b', 900)] })
    expect([...times.values()]).toEqual([0, 900])
  })

  it('accepts entrances that finish inside the slot', () => {
    expect(lateEntranceIssue({ elements: [el('a', 0), el('b', 2400)] }, 3000)).toBeNull()
  })

  it('names the first entrance that cannot finish before the slot ends', () => {
    expect(lateEntranceIssue({ elements: [el('a', 0), el('b', 2500)] }, 3000)).toBe(
      'element "b" enters at 2500 ms, but this 3.0 s slot needs every entrance to start by 2400 ms',
    )
  })

  it('applies to staggered entrances too', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => el(id, 0))
    // Sixth element enters at 900 ms; a 1.4 s slot needs starts by 800 ms.
    expect(lateEntranceIssue({ elements: six }, 1400)).toMatch(/^element "f" enters at 900 ms/)
  })
})
```

(Import `graphicEnterTimes` and `lateEntranceIssue` from `./graphics`.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/settings.test.ts src/graphics.test.ts`
Expected: FAIL (`graphics` missing from routing; `graphicEnterTimes` not exported).

- [ ] **Step 3: Implement the route**

In `packages/schemas/src/settings.ts`, append `'graphics'` to `LLM_TASKS` with a doc comment:

```ts
  /** One call per graphic slot (decision 289): what it shows, its layout and its motion. */
  'graphics',
```

Above `ModelRoutingSchema` add:

```ts
/**
 * The graphics designer's default (decision 289): the most capable model,
 * because a graphic is composed whole in one call and nothing downstream
 * improves it. A row stored before the route existed reads this.
 */
export const DEFAULT_GRAPHICS_ROUTE = { provider: 'anthropic', model: 'claude-opus-5-5' } as const
```

In `ModelRoutingSchema`, after `direction`:

```ts
  graphics: ModelRefSchema.default(DEFAULT_GRAPHICS_ROUTE),
```

In `DEFAULT_SETTINGS.modelRouting`, after `direction`:

```ts
    // Graphics get a designer of their own (decision 289).
    graphics: DEFAULT_GRAPHICS_ROUTE,
```

If `DEFAULT_SET_SHEET_ROUTE` is typed with a spread rather than `as const`, match its style so `DEFAULT_SETTINGS` still satisfies `Settings`.

- [ ] **Step 4: Implement the timing rule**

In `packages/schemas/src/graphics.ts`, after `GraphicEnterSchema`:

```ts
/** How long one entrance takes on the card. The render reads this; a check reads it too. */
export const GRAPHIC_ENTER_MS = 600
/** The gap between entrances when a scene times none of them. */
export const GRAPHIC_STAGGER_MS = 180

/** The least a scene must carry for its entrances to be timed. */
export interface GraphicTimingScene {
  elements: readonly { id: string; enter: { atMs: number } }[]
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
```

Update the `atMs` doc comment in `GraphicEnterSchema` to: `/** Offset from the slot's start. The designer is held to \`lateEntranceIssue\`. */`

- [ ] **Step 5: Point the card at the shared rule (no behaviour change)**

In `packages/compositions/src/lib/graphic.ts`: import `GRAPHIC_ENTER_MS`, `GRAPHIC_STAGGER_MS`, `graphicEnterTimes` from `@boom-busters/schemas`; replace `const ENTER_MS = 600` with `const ENTER_MS = GRAPHIC_ENTER_MS`; replace `const STAGGER_MS = 180` with `const STAGGER_MS = GRAPHIC_STAGGER_MS` (keep it if other code reads it, else delete); replace the body of `staggeredEnterMs` with `return graphicEnterTimes(scene)`, keeping its doc comment. Add to `graphic.test.ts`:

```ts
it('times entrances by the shared rule the designer is checked against (decision 289)', () => {
  expect(staggeredEnterMs(GRAPHIC_FIXTURE_SCENE)).toEqual(graphicEnterTimes(GRAPHIC_FIXTURE_SCENE))
})
```

where `GRAPHIC_FIXTURE_SCENE` is whichever scene fixture the file already uses for `staggeredEnterMs` tests (reuse it; do not add a new fixture).

- [ ] **Step 6: Label the row**

In `models-tab.tsx` `TASK_LABELS`, after `direction`: `graphics: 'Motion graphics',`. In `models-tab.test.tsx`, add:

```ts
it('offers a Motion graphics route (decision 289)', () => {
  renderModelsTab()
  expect(screen.getByRole('combobox', { name: 'Motion graphics model' })).toHaveValue(
    'claude-opus-5-5',
  )
})
```

If `renderModelsTab()`'s default options lack `claude-opus-5-5`, the select still shows it via the "(unlisted)" guard; assert the value only.

- [ ] **Step 7: Run every consumer**

Run (one at a time, `timeout: 600000`): `cd packages/schemas && pnpm exec vitest run`; `cd packages/compositions && pnpm exec vitest run src/lib`; `cd apps/web && pnpm exec vitest run "app/(console)/settings"`; `pnpm typecheck`.
Expected: PASS. Any `Record<LlmTask, ...>` that fails to compile gets a `graphics` entry (search `Record<LlmTask`). If a settings fixture elsewhere spreads a full routing object, it needs no change because of the default.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src/settings.ts packages/schemas/src/settings.test.ts packages/schemas/src/graphics.ts packages/schemas/src/graphics.test.ts packages/compositions/src/lib/graphic.ts packages/compositions/src/lib/graphic.test.ts "apps/web/app/(console)/settings/models-tab.tsx" "apps/web/app/(console)/settings/models-tab.test.tsx"
git commit -m "feat(settings): a Motion graphics route, and the entrance clamp as a rule (decision 289)"
```

---

### Task 2: A stored graphic can be undesigned

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (`GraphicBriefSchema` L278 to 283; `graphicCitationIssue` L806 to 830; graphic branch of `resolvePlannedBrief` L884 to 909)
- Modify: `apps/web/lib/visual-assets.ts` (graphic case ~L785)
- Modify: `apps/web/inngest/lib/assembly.ts` (~L334 to 367), `apps/web/inngest/functions/assembly-runner.ts` (~L283)
- Modify: `apps/web/lib/visuals-review.ts` (~L835)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`attachGraphicLogosAction` ~L760 to 800)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`GraphicSlot` L1236 to 1291, minimal guard only; Task 8 builds the UI)
- Test: `packages/schemas/src/visuals.test.ts`, `apps/web/lib/visual-assets.test.ts`, `apps/web/inngest/lib/assembly.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `GraphicBrief` = common fields + `scene?: GraphicScene` + `intent?: string` + `intentClaimIds?: string[]` + `designIssue?: string`.
  - `resolvePlannedScene(scene: PlannedGraphicScene, claims: readonly PlanningClaim[], logos?: readonly LogoIndex[]): { scene: GraphicScene } | { issue: string }`
  - `toPlannedScene(scene: GraphicScene, claimIds: readonly string[]): PlannedGraphicScene` (claim ids not in the list become claim number 0, which the designer is told is "not in the current list")
  - `graphicIntentOf(brief: GraphicBrief): { intent: string; claimIds: string[] }`
  - `graphicSceneClaimIds(scene: GraphicScene): string[]` (scene order, each once; moves here from the board's `graphicClaimIds`)

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/schemas/src/visuals.test.ts` (reuse the file's existing claim and ULID fixtures; `CLAIM_A`/`CLAIM_B` below stand for two ULIDs already defined there, with texts containing "4 billion" and "1,200" respectively; rename to match):

```ts
describe('an undesigned graphic (decision 289)', () => {
  const common = {
    coversText: 'It raised four billion.',
    description: 'The figure, large.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }

  it('parses with an intent and no scene', () => {
    const parsed = ShotBriefSchema.parse({
      type: 'graphic',
      ...common,
      intent: 'Four billion in one round is the story.',
      intentClaimIds: [CLAIM_A],
    })
    expect(parsed.type === 'graphic' && parsed.scene).toBeUndefined()
  })

  it('still parses a graphic stored before intents existed', () => {
    const parsed = ShotBriefSchema.parse({ type: 'graphic', ...common, scene: STORED_SCENE })
    expect(parsed.type === 'graphic' && parsed.intent).toBeUndefined()
  })

  it('reads the description as the intent of a graphic stored before intents', () => {
    const brief = GraphicBriefSchema.parse({ type: 'graphic', ...common, scene: STORED_SCENE })
    expect(graphicIntentOf(brief)).toEqual({
      intent: 'The figure, large.',
      claimIds: graphicSceneClaimIds(STORED_SCENE),
    })
  })

  it('resolves a planned scene to claim ids, and refuses a number the claim lacks', () => {
    const claims = [
      { id: CLAIM_A, text: 'It raised 4 billion dollars.' },
      { id: CLAIM_B, text: 'It employs 1,200 people.' },
    ]
    const ok = resolvePlannedScene(
      { elements: [{ kind: 'figure', id: 'f', cell: CELL, value: '$4bn', claimRef: 1, color: 'accent', enter: { kind: 'count', atMs: 0 } }] },
      claims,
    )
    expect('scene' in ok && ok.scene.elements[0]).toMatchObject({ claimRef: CLAIM_A })
    const bad = resolvePlannedScene(
      { elements: [{ kind: 'figure', id: 'f', cell: CELL, value: '$5bn', claimRef: 1, color: 'accent', enter: { kind: 'fade', atMs: 0 } }] },
      claims,
    )
    expect(bad).toEqual({
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
  })

  it('turns a stored scene back into claim numbers for a redesign', () => {
    const planned = toPlannedScene(STORED_SCENE, [CLAIM_B, CLAIM_A])
    // STORED_SCENE's figure cites CLAIM_A, which is number 2 in this list.
    expect(planned.elements.find((e) => e.kind === 'figure')).toMatchObject({ claimRef: 2 })
  })
})
```

`STORED_SCENE` and `CELL`: use a scene fixture already in `visuals.test.ts` for graphics (one figure citing `CLAIM_A`) and `{ col: 0, row: 0, colSpan: 6, rowSpan: 3 }`. Import `GraphicBriefSchema`, `graphicIntentOf`, `graphicSceneClaimIds`, `resolvePlannedScene`, `toPlannedScene`.

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/visuals.test.ts`
Expected: FAIL (scene required; functions missing).

- [ ] **Step 3: Implement the stored shape and helpers**

In `visuals.ts`, replace `GraphicBriefSchema`:

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
 */
export const GraphicBriefSchema = z.object({
  type: z.literal('graphic'),
  ...briefCommon,
  scene: GraphicSceneSchema.optional(),
  /** What the graphic must get across, not how it looks. */
  intent: z.string().trim().min(1).max(300).optional(),
  /** The claims the beat rests on, as the shot list named them. */
  intentClaimIds: z.array(UlidSchema).max(6).optional(),
  /** Why the designer could not compose it. Meaningful only without a scene. */
  designIssue: z.string().min(1).max(500).optional(),
})
```

Leave `PlannedGraphicBriefSchema` as `GraphicBriefSchema.omit({ scene: true, intent: true, intentClaimIds: true, designIssue: true }).extend({ scene: PlannedGraphicSceneSchema })` for now (Task 5 changes it), so the shot list keeps working.

Refactor `graphicCitationIssue` to take a scene:

```ts
function sceneCitationIssue(
  scene: PlannedGraphicScene,
  claims: readonly PlanningClaim[],
): string | null {
  // body unchanged, iterating scene.elements instead of brief.scene.elements
}
```

and add:

```ts
/**
 * A designed scene made storable (decision 289): claim numbers become ids,
 * logos are matched against the library. Refused, with the words the board
 * and the designer's retry read, when a figure cites a claim that does not
 * hold its digits.
 */
export function resolvePlannedScene(
  scene: PlannedGraphicScene,
  claims: readonly PlanningClaim[],
  logos: readonly LogoIndex[] = [],
): { scene: GraphicScene } | { issue: string } {
  const issue = sceneCitationIssue(scene, claims)
  if (issue !== null) return { issue }
  const claimIds = claims.map((claim) => claim.id)
  const elements: GraphicElement[] = []
  for (const element of scene.elements) {
    // The four branches moved verbatim from resolvePlannedBrief's graphic case.
  }
  return { scene: { elements } }
}

/** Every claim a scene's figures and bars cite, in scene order, each once. */
export function graphicSceneClaimIds(scene: GraphicScene): string[] {
  const ids: string[] = []
  for (const element of scene.elements) {
    const cited =
      element.kind === 'figure'
        ? [element.claimRef]
        : element.kind === 'bars'
          ? element.items.map((item) => item.claimRef)
          : []
    for (const id of cited) if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * A stored scene in the designer's wire shape, for a redesign: claim ids
 * become numbers in `claimIds`' order and logos lose their asset ids. A
 * claim no longer in the list becomes 0, which the prompt explains.
 */
export function toPlannedScene(
  scene: GraphicScene,
  claimIds: readonly string[],
): PlannedGraphicScene {
  const number = (id: string) => claimIds.indexOf(id) + 1
  return {
    elements: scene.elements.map((element) => {
      if (element.kind === 'figure') return { ...element, claimRef: number(element.claimRef) }
      if (element.kind === 'bars') {
        return {
          ...element,
          items: element.items.map((item) => ({ ...item, claimRef: number(item.claimRef) })),
        }
      }
      if (element.kind === 'logo') {
        const { assetId: _assetId, ...rest } = element
        return rest
      }
      return element
    }),
  } as PlannedGraphicScene
}

/** The intent a graphic is designed from: its own, or (stored before 289) its description. */
export function graphicIntentOf(brief: GraphicBrief): { intent: string; claimIds: string[] } {
  return {
    intent: brief.intent ?? brief.description,
    claimIds: brief.intentClaimIds ?? (brief.scene ? graphicSceneClaimIds(brief.scene) : []),
  }
}
```

Rewrite the graphic branch of `resolvePlannedBrief` to call `resolvePlannedScene(brief.scene, claims, logos)` and return `null` on an issue, `{ ...brief, scene: resolved.scene }` otherwise; `plannedBriefRejection`'s graphic branch returns `sceneCitationIssue(brief.scene, claims)`. Export the three new functions from the package barrel if `visuals.ts` exports are re-exported selectively (check `packages/schemas/src/index.ts`).

- [ ] **Step 4: Run the schema tests**

Run: `cd packages/schemas && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 5: Write the failing web tests for a sceneless graphic**

In `apps/web/lib/visual-assets.test.ts`, beside the existing graphic resolution tests:

```ts
it('holds a graphic with no scene as a placeholder (decision 289)', async () => {
  const resolution = await resolveSlotBrief({
    projectId: PROJECT,
    brief: { ...GRAPHIC_BRIEF, scene: undefined, designIssue: 'no claim held the figure' },
    route: null,
  })
  expect(resolution).toEqual({ candidates: [], status: 'placeholder' })
})
```

In `apps/web/inngest/lib/assembly.test.ts`, beside the graphic slot tests, a graphic brief without a scene must be skipped with the reason `'graphic "<coversText>" has not been designed'` in whatever list the existing "a logo for X has not been uploaded" skip lands in (mirror that test's assertions exactly).

- [ ] **Step 6: Make every scene reader handle no scene**

- `visual-assets.ts` graphic case: first line `if (!brief.scene) return { candidates: [], status: 'placeholder' }`.
- `assembly.ts` graphic branch: before the logo loop, `if (!brief.scene) { <skip exactly as the missing-logo skip does, with reason \`graphic "${brief.coversText}" has not been designed\`>; continue }`. Use `brief.scene` via a local `const scene = brief.scene` after the guard.
- `assembly-runner.ts` ~L283: `for (const element of brief.data.scene?.elements ?? [])`.
- `visuals-review.ts` ~L835: `parsed.data.scene?.elements.flatMap(...) ?? []`.
- `visuals-actions.ts` `attachGraphicLogosAction`: after parsing, `if (!parsed.data.scene) return { ok: false, error: 'This graphic has not been designed yet.' }`.
- `visual-board.tsx` `GraphicSlot`: replace the board-local `graphicClaimIds(brief.scene)` with `brief.scene ? graphicSceneClaimIds(brief.scene) : (brief.intentClaimIds ?? [])`, delete the board's local `graphicClaimIds` (L1213 to 1227) if nothing else uses it, compute `missingLogos` from `brief.scene?.elements ?? []`, and render `<GraphicPreview .../>` only when `brief.scene` is set (Task 8 adds the undesigned UI).

- [ ] **Step 7: Run every consuming suite**

Run, one at a time (`timeout: 600000`): `cd apps/web && pnpm exec vitest run lib inngest "app/(console)/projects"`; `pnpm typecheck`; `cd packages/timeline && pnpm exec vitest run`; `cd infra/lambdas/broker && pnpm exec vitest run` if it has its own config (else the root `pnpm test` covers it in Task 10).
Expected: PASS. A type error anywhere `brief.scene` is read means a reader this list missed: guard it the same way.

- [ ] **Step 8: Commit**

```bash
git add packages/schemas/src apps/web/lib apps/web/inngest "apps/web/app/(console)/projects/[id]"
git commit -m "feat(visuals): a graphic can be stored before it is designed (decision 289)"
```

---

### Task 3: The graphics prompt, parser and mock

**Files:**
- Create: `packages/providers/src/prompts/graphics.ts`
- Modify: `packages/providers/src/index.ts` (export the new module's public names)
- Test: `packages/providers/src/prompts/graphics.test.ts`

**Interfaces:**
- Consumes: `PlannedGraphicSceneSchema`, `GRAPHIC_COLORS`, `GRAPHIC_TYPE_ROLES`, `MAX_GRAPHIC_ELEMENTS`, `figureDigitGroups` (schemas); `claimList`, `ScriptClaim` (`./script`); `parseJsonCompletion`, `formatIssues` (`./json`); `outputBudget`, `LLMTaskRequest` (`../llm/types`).
- Produces:
  ```ts
  export const GRAPHIC_ANSWER_TOKENS = 3000
  export interface SlotWord { text: string; offsetMs: number }
  export interface GraphicDesignInput {
    caseTitle: string
    claims: readonly ScriptClaim[]
    logos: readonly string[]
    chapterTitle: string
    coversText: string
    paragraphText: string
    durationMs: number
    words: readonly SlotWord[]
    wordsEstimated: boolean
    intent: string
    intentRefs: readonly number[]
    current?: PlannedGraphicScene
    guidance?: string
    rejection?: string
  }
  export function wordsInSlot(words: readonly { text: string; startMs: number }[], startMs: number, durationMs: number): SlotWord[]
  export function estimatedWords(coversText: string, durationMs: number): SlotWord[]
  export function buildGraphicRequest(input: GraphicDesignInput): LLMTaskRequest
  export function parseGraphicScene(text: string): PlannedGraphicScene
  export function mockGraphicScene(input: { claimTexts: readonly string[]; intentRefs: readonly number[]; logoTitles?: readonly string[]; guidance?: string; durationMs: number }): PlannedGraphicScene
  ```

- [ ] **Step 1: Write the failing tests**

`packages/providers/src/prompts/graphics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import {
  buildGraphicRequest,
  estimatedWords,
  GRAPHIC_ANSWER_TOKENS,
  mockGraphicScene,
  parseGraphicScene,
  wordsInSlot,
  type GraphicDesignInput,
} from './graphics'
import { outputBudget } from '../llm/types'

const CLAIMS = [
  { id: '01J00000000000000000000001', text: 'Acme raised 4 billion dollars in 2024.', sourceUrl: null, confidence: 'high' },
  { id: '01J00000000000000000000002', text: 'Rival raised 900 million dollars.', sourceUrl: null, confidence: 'high' },
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

describe('buildGraphicRequest (decision 289)', () => {
  it('routes to graphics with one cacheable film message', () => {
    const request = buildGraphicRequest(input())
    expect(request.task).toBe('graphics')
    expect(request.cacheablePrefixMessages).toBe(1)
    expect(request.maxTokens).toBe(outputBudget(GRAPHIC_ANSWER_TOKENS))
  })

  it('keeps the film message identical across two slots of one film', () => {
    const a = buildGraphicRequest(input())
    const b = buildGraphicRequest(input({ coversText: 'Rival raised less.', intentRefs: [2] }))
    expect(a.system).toBe(b.system)
    expect(a.messages[0]).toEqual(b.messages[0])
    expect(a.messages[0]!.content).toContain('1. Acme raised 4 billion dollars in 2024.')
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

  it('carries the current scene and the steer on a redesign, steer last', () => {
    const request = buildGraphicRequest(
      input({
        current: { elements: [{ kind: 'text', id: 't', cell: { col: 0, row: 0, colSpan: 6, rowSpan: 2 }, content: 'Old', role: 'title', color: 'textPrimary', align: 'start', enter: { kind: 'fade', atMs: 0 } }] },
        guidance: 'Make the number bigger.',
      }),
    )
    const last = request.messages.at(-1)!.content
    expect(request.messages.some((m) => m.content.includes('"content": "Old"'))).toBe(true)
    expect(last).toBe("The producer's steer: Make the number bigger.")
  })

  it('names the reason a previous answer was refused', () => {
    const request = buildGraphicRequest(input({ rejection: 'element "f" enters at 5800 ms' }))
    expect(request.messages.at(-1)!.content).toContain('element "f" enters at 5800 ms')
  })
})

describe('parseGraphicScene', () => {
  it('reads a scene', () => {
    const scene = parseGraphicScene(
      '{"scene": {"elements": [{"kind": "figure", "id": "f", "cell": {"col": 0, "row": 2, "colSpan": 7, "rowSpan": 4}, "value": "$4bn", "claimRef": 1, "color": "accent", "enter": {"kind": "count", "atMs": 900}}]}}',
    )
    expect(scene.elements[0]).toMatchObject({ kind: 'figure', claimRef: 1 })
  })

  it('refuses a malformed scene in words', () => {
    expect(() => parseGraphicScene('{"scene": {"elements": []}}')).toThrow(ValidationError)
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

describe('mockGraphicScene', () => {
  it('builds a figure from the first intent claim’s digits, inside the slot', () => {
    const scene = mockGraphicScene({
      claimTexts: CLAIMS.map((c) => c.text),
      intentRefs: [1],
      logoTitles: ['Acme'],
      durationMs: 6000,
    })
    expect(scene.elements.find((e) => e.kind === 'figure')).toMatchObject({ value: '$4bn', claimRef: 1 })
  })

  it('differs when steered, so a redesign proves something offline', () => {
    const plain = mockGraphicScene({ claimTexts: ['4 billion'], intentRefs: [1], durationMs: 6000 })
    const steered = mockGraphicScene({ claimTexts: ['4 billion'], intentRefs: [1], durationMs: 6000, guidance: 'bigger' })
    expect(steered).not.toEqual(plain)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/graphics.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `graphics.ts`**

```ts
import {
  figureDigitGroups,
  GRAPHIC_COLORS,
  GRAPHIC_TYPE_ROLES,
  MAX_GRAPHIC_ELEMENTS,
  PlannedGraphicSceneSchema,
  ValidationError,
} from '@boom-busters/schemas'
import type { PlannedGraphicScene } from '@boom-busters/schemas'
import { z } from 'zod'
import { claimList, type ScriptClaim } from './script'
import { formatIssues, parseJsonCompletion } from './json'
import { outputBudget, type LLMTaskRequest } from '../llm/types'

/**
 * The graphics designer (decision 289): one call per graphic slot, on its own
 * route. The shot list decides that a beat is a graphic and what it must get
 * across; this call decides what is on screen, where, and when it enters.
 *
 * Three messages: the system rules and the film message are identical for
 * every graphic of a film, so the provider caches them and each graphic pays
 * for its own slot message only.
 */

/** A scene of six elements is well under this; the rest is the model's room to think. */
export const GRAPHIC_ANSWER_TOKENS = 3000

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
  /** A redesign: the scene being replaced, in claim numbers. */
  current?: PlannedGraphicScene
  guidance?: string
  /** Why the previous answer to this same slot was refused. */
  rejection?: string
}

const SYSTEM = `You design ONE motion graphic for a documentary about a corporate collapse.
The narration is recorded. You decide what is on screen, where, and when each
piece enters, so the graphic lands the beat the narrator is speaking.

Return JSON only: {"scene": {"elements": [element, ...]}}.

Design rules:
- One idea per graphic. One element dominates (usually the figure); everything
  else supports it. A viewer gets it in the first second.
- Fewer elements beat more. ${MAX_GRAPHIC_ELEMENTS} is the ceiling, not the target; two or three is common.
- Leave room. Do not fill the grid. The bottom two rows (row 10 and 11) stay
  empty: captions sit there.
- Colour carries meaning: "collapse" for loss and failure, "recovery" for
  gain, "accent" or "captionHighlight" for the one thing to look at, "series0"
  to "series2" to tell compared things apart. Text is "textPrimary" or
  "textSecondary". Never colour for decoration.
- Time entrances to the words. Each slot comes with the words spoken in it and
  when; a figure should land as its number is said, a logo as its name is
  said. An element enters by "atMs" from the slot's start. Every entrance must
  START at least 600 ms before the slot ends, so it can finish.
- A figure "count"s up only when the number itself is the story.
- Two or three amounts compared read better as "bars" than as figures side by side.
- A logo earns its place when the company or person is the subject, not
  because they are mentioned. Name them exactly as the Logos list does; if
  they are not listed, still name them and the producer will upload the mark.
- Every number shown cites the claim it comes from, by NUMBER, and the digits
  shown must appear in that claim's text ("$4bn" from "4 billion" is fine;
  "$4.2bn" is not). The intent names the claims the beat rests on; you may
  cite any claim in the list when it holds the number better.
- Words on screen are short: a title is a few words, never a sentence of narration.

Elements:
{"kind": "text", "id", "cell", "content" (max 120 chars), "role": ${GRAPHIC_TYPE_ROLES.map((r) => `"${r}"`).join('|')},
 "color", "align"?: "start"|"center"|"end", "enter"?, "emphasis"?}
{"kind": "figure", "id", "cell", "value" (exactly what is shown, e.g. "$4bn"), "label"?,
 "claimRef": claim number, "color", "enter"?, "emphasis"?}
{"kind": "logo", "id", "cell", "entity": the exact name, "enter"?}
{"kind": "shape", "id", "cell", "form": "rect"|"rule"|"disc", "color", "opacity"?: 0.05-1}
{"kind": "bars", "id", "cell", "items": [{"label", "value": number, "display", "claimRef": claim number}] (2 to 5),
 "color", "highlightIndex"?}
"cell" is {"col", "row", "colSpan", "rowSpan"} on a 12 by 12 grid (0-based).
"portraitCell" (optional, same shape) places the element on the 9:16 Shorts
frame; leave it out to let the layout stack elements in reading order.
"color" is one of ${GRAPHIC_COLORS.join(', ')}.
"enter" is {"kind": "fade"|"rise"|"wipe"|"count", "atMs"} ("count" only on a figure).
"emphasis" is "pulse"|"underline". Ids are unique; one logo per entity.

Example, a single number that is the story:
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 2, "colSpan": 8, "rowSpan": 1}, "content": "Raised in one round", "role": "title", "color": "textSecondary", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "figure", "id": "f", "cell": {"col": 1, "row": 3, "colSpan": 8, "rowSpan": 4}, "value": "$4bn", "claimRef": 3, "color": "accent", "enter": {"kind": "count", "atMs": 900}, "emphasis": "underline"}]}}

Example, two amounts compared:
{"scene": {"elements": [
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 1, "colSpan": 10, "rowSpan": 1}, "content": "2024 revenue", "role": "title", "color": "textSecondary", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "bars", "id": "b", "cell": {"col": 1, "row": 3, "colSpan": 10, "rowSpan": 5}, "items": [{"label": "Nvidia", "value": 130, "display": "$130bn", "claimRef": 4}, {"label": "Intel", "value": 53, "display": "$53bn", "claimRef": 7}], "color": "series0", "highlightIndex": 0, "enter": {"kind": "wipe", "atMs": 600}}]}}

Example, a relationship between named marks:
{"scene": {"elements": [
 {"kind": "logo", "id": "a", "cell": {"col": 1, "row": 3, "colSpan": 4, "rowSpan": 3}, "entity": "Acme", "enter": {"kind": "fade", "atMs": 0}},
 {"kind": "shape", "id": "r", "cell": {"col": 5, "row": 4, "colSpan": 2, "rowSpan": 1}, "form": "rule", "color": "accent"},
 {"kind": "logo", "id": "b", "cell": {"col": 7, "row": 3, "colSpan": 4, "rowSpan": 3}, "entity": "Rival", "enter": {"kind": "fade", "atMs": 1400}},
 {"kind": "text", "id": "t", "cell": {"col": 1, "row": 7, "colSpan": 10, "rowSpan": 1}, "content": "Bought for $900m", "role": "body", "color": "textPrimary", "align": "center", "enter": {"kind": "rise", "atMs": 2200}}]}}`

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
    `Rests on claims: ${input.intentRefs.length > 0 ? input.intentRefs.join(', ') : 'none named'}`

  return {
    task: 'graphics',
    system: SYSTEM,
    messages: [
      { role: 'user', content: film },
      { role: 'user', content: slot },
      ...(input.current
        ? [
            {
              role: 'user' as const,
              content:
                'The current design, which the producer wants changed (claimRef 0 is a claim no longer in the list):\n' +
                JSON.stringify(input.current, null, 2),
            },
          ]
        : []),
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

const GraphicEnvelopeSchema = z.object({ scene: z.unknown() })

export function parseGraphicScene(text: string): PlannedGraphicScene {
  const envelope = parseJsonCompletion(text, GraphicEnvelopeSchema, 'graphic scene')
  const parsed = PlannedGraphicSceneSchema.safeParse(envelope.scene)
  if (!parsed.success) {
    throw new ValidationError(`The graphic is malformed: ${formatIssues(parsed.error)}`, {
      field: 'graphic scene',
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

/** Deterministic design for MOCK_PROVIDERS=1: the figure's digits truly come from the cited claim. */
export function mockGraphicScene(input: {
  claimTexts: readonly string[]
  intentRefs: readonly number[]
  logoTitles?: readonly string[]
  guidance?: string
  durationMs: number
}): PlannedGraphicScene {
  const ref = input.intentRefs.find((n) => figureDigitGroups(input.claimTexts[n - 1] ?? '').length > 0)
  const text = ref ? input.claimTexts[ref - 1]! : ''
  const digits = figureDigitGroups(text)[0]
  const value = text.toLowerCase().includes('billion') ? `$${digits}bn` : digits
  const landAt = Math.min(900, Math.max(0, input.durationMs - 700))
  const title = input.guidance ? `[mock] Redesigned: ${input.guidance}`.slice(0, 120) : '[mock] Raised in one round'
  const logoTitle = input.logoTitles?.[0]
  return {
    elements: [
      {
        kind: 'text',
        id: 't1',
        cell: { col: 0, row: 0, colSpan: 7, rowSpan: 2 },
        content: title,
        role: 'title',
        color: 'textSecondary',
        align: 'start',
        enter: { kind: 'fade', atMs: 0 },
      },
      ...(ref && digits !== undefined
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
  } as PlannedGraphicScene
}
```

Check `claimList`'s numbering format against `script.ts` before relying on the `'1. Acme raised...'` test line; adjust the test's expected string to the real format, not the code.

Export from `packages/providers/src/index.ts`: `buildGraphicRequest, parseGraphicScene, mockGraphicScene, wordsInSlot, estimatedWords, GRAPHIC_ANSWER_TOKENS` and types `GraphicDesignInput, SlotWord`, following how `buildRetypeRequest` is exported.

- [ ] **Step 4: Run tests**

Run: `cd packages/providers && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/graphics.ts packages/providers/src/prompts/graphics.test.ts packages/providers/src/index.ts
git commit -m "feat(providers): a graphics designer prompt of its own (decision 289)"
```

---

### Task 4: The design service

**Files:**
- Create: `apps/web/lib/graphic-design.ts`
- Test: `apps/web/lib/graphic-design.test.ts`

**Interfaces:**
- Consumes: Task 2's `resolvePlannedScene`, `toPlannedScene`, `graphicIntentOf`, `lateEntranceIssue`; Task 3's `buildGraphicRequest`, `parseGraphicScene`, `mockGraphicScene`, `wordsInSlot`, `estimatedWords`, `MAX_OUTPUT_TOKENS`; `callLlm` (`@/lib/llm`); `timedParagraphs`, `TimedParagraph` (`@/inngest/lib/shot-list`); db: `getProject`, `latestScriptParagraphSources`, `listVoiceTakes`, `scriptableClaims`, `listLogos`.
- Produces:
  ```ts
  export interface GraphicDesignContext {
    projectId: string
    caseTitle: string
    claims: readonly ScriptClaim[]
    logos: readonly LogoIndex[]
    paragraphs: readonly TimedParagraph[]
    chapterTitle: string
  }
  export interface GraphicSlotTiming { chapterId: string; startMs: number; durationMs: number }
  export type GraphicDesignResult =
    | { ok: true; scene: GraphicScene }
    | { ok: false; issue: string }
  export async function designGraphic(
    context: GraphicDesignContext,
    slot: GraphicSlotTiming & { brief: GraphicBrief },
    options?: { guidance?: string; redesign?: boolean },
  ): Promise<GraphicDesignResult>
  export function withDesign(brief: GraphicBrief, result: GraphicDesignResult): GraphicBrief
  export async function loadGraphicContext(projectId: string, chapterId: string): Promise<GraphicDesignContext>
  ```
  `designGraphic` throws `BudgetExceededError` and provider errors through; it never throws for a bad answer.

- [ ] **Step 1: Write the failing tests**

`apps/web/lib/graphic-design.test.ts` (mock `@/lib/llm` and `@boom-busters/providers`' `mockProvidersEnabled`; follow the mocking style of an existing `apps/web/lib/*.test.ts` that mocks `callLlm`, for example the still prompt or plan-chapter tests):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'

const callLlm = vi.fn()
vi.mock('@/lib/llm', () => ({ callLlm: (...args: unknown[]) => callLlm(...args) }))
let mock = false
vi.mock('@boom-busters/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@boom-busters/providers')>()),
  mockProvidersEnabled: () => mock,
}))

import { designGraphic, withDesign, type GraphicDesignContext } from './graphic-design'

const A = '01J00000000000000000000001'
const CONTEXT: GraphicDesignContext = {
  projectId: '01J0000000000000000000000P',
  caseTitle: 'Acme',
  claims: [{ id: A, text: 'Acme raised 4 billion dollars.', sourceUrl: null, confidence: 'high' }],
  logos: [],
  paragraphs: [
    { chapterId: 'c1', index: 0, text: 'Acme raised four billion.', startMs: 0, durationMs: 6000, words: [{ text: 'four', startMs: 900 }] },
  ],
  chapterTitle: 'The raise',
}
const BRIEF = {
  type: 'graphic' as const,
  coversText: 'Acme raised four billion.',
  description: 'The figure.',
  motion: { kind: 'static' as const },
  transition: 'cut' as const,
  intent: 'Four billion is the story.',
  intentClaimIds: [A],
}
const SLOT = { chapterId: 'c1', startMs: 0, durationMs: 6000, brief: BRIEF }
const answer = (value: string, atMs = 900) => ({
  text: JSON.stringify({ scene: { elements: [{ kind: 'figure', id: 'f', cell: { col: 0, row: 2, colSpan: 7, rowSpan: 4 }, value, claimRef: 1, color: 'accent', enter: { kind: 'count', atMs } }] } }),
})

beforeEach(() => {
  callLlm.mockReset()
  mock = false
})

describe('designGraphic (decision 289)', () => {
  it('stores a scene that passes, with claim ids', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toMatchObject({ ok: true, scene: { elements: [{ claimRef: A }] } })
    expect(callLlm.mock.calls[0]![0].messages[1].content).toContain('0.9 s  four')
  })

  it('asks once more with the reason, and takes the second answer', async () => {
    callLlm.mockResolvedValueOnce(answer('$5bn')).mockResolvedValueOnce(answer('$4bn'))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm.mock.calls[1]![0].messages.at(-1).content).toContain(
      'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    )
  })

  it('gives up after the second refusal, with the reason', async () => {
    callLlm.mockResolvedValue(answer('$5bn'))
    expect(await designGraphic(CONTEXT, SLOT)).toEqual({
      ok: false,
      issue: 'graphic showed a number the cited claim does not contain: $5bn against claim 1',
    })
    expect(callLlm).toHaveBeenCalledTimes(2)
  })

  it('refuses an entrance that cannot finish inside the slot', async () => {
    callLlm.mockResolvedValue(answer('$4bn', 5800))
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result).toEqual({ ok: false, issue: expect.stringMatching(/^element "f" enters at 5800 ms/) })
  })

  it('retries a cut-off answer once at double the budget', async () => {
    callLlm
      .mockRejectedValueOnce(new ValidationError('cut off', { field: 'maxTokens' }))
      .mockResolvedValueOnce(answer('$4bn'))
    await designGraphic(CONTEXT, SLOT)
    expect(callLlm.mock.calls[1]![0].maxTokens).toBe(callLlm.mock.calls[0]![0].maxTokens * 2)
  })

  it('designs from the description when the graphic predates intents', async () => {
    callLlm.mockResolvedValueOnce(answer('$4bn'))
    const { intent: _i, intentClaimIds: _c, ...legacy } = BRIEF
    await designGraphic(CONTEXT, { ...SLOT, brief: legacy })
    expect(callLlm.mock.calls[0]![0].messages[1].content).toContain('Intent: The figure.')
  })

  it('makes no call in mock mode', async () => {
    mock = true
    const result = await designGraphic(CONTEXT, SLOT)
    expect(result.ok).toBe(true)
    expect(callLlm).not.toHaveBeenCalled()
  })
})

describe('withDesign', () => {
  it('stores the scene and clears any old issue', () => {
    const designed = withDesign({ ...BRIEF, designIssue: 'old' }, { ok: true, scene: { elements: [] } as never })
    expect(designed.designIssue).toBeUndefined()
    expect(designed.scene).toEqual({ elements: [] })
  })

  it('stores the issue without a scene', () => {
    expect(withDesign(BRIEF, { ok: false, issue: 'why' })).toEqual({ ...BRIEF, designIssue: 'why' })
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import {
  getProject,
  latestScriptParagraphSources,
  listLogos,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import {
  buildGraphicRequest,
  estimatedWords,
  MAX_OUTPUT_TOKENS,
  mockGraphicScene,
  mockProvidersEnabled,
  parseGraphicScene,
  wordsInSlot,
  type GraphicDesignInput,
  type ScriptClaim,
} from '@boom-busters/providers'
import {
  graphicIntentOf,
  lateEntranceIssue,
  resolvePlannedScene,
  toPlannedScene,
  ValidationError,
} from '@boom-busters/schemas'
import type { GraphicBrief, GraphicScene, LogoIndex, PlannedGraphicScene } from '@boom-busters/schemas'
import { NonRetriableError } from 'inngest'
import { db } from '@/lib/db'
import { callLlm } from '@/lib/llm'
import { timedParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * The graphics designer, as the app calls it (decision 289): the pipeline's
 * per-graphic step, Redesign graphic and a retype to graphic all come here,
 * so a graphic is designed one way whichever button asked.
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

export type GraphicDesignResult = { ok: true; scene: GraphicScene } | { ok: false; issue: string }

/** The paragraphs a slot overlaps, and its words on the slot clock. */
function slotNarration(context: GraphicDesignContext, slot: GraphicSlotTiming & { brief: GraphicBrief }) {
  const end = slot.startMs + slot.durationMs
  const overlapping = context.paragraphs.filter(
    (p) => p.chapterId === slot.chapterId && p.startMs < end && p.startMs + p.durationMs > slot.startMs,
  )
  const timed = wordsInSlot(overlapping.flatMap((p) => p.words), slot.startMs, slot.durationMs)
  return {
    paragraphText: overlapping.map((p) => p.text).join('\n\n') || slot.brief.coversText,
    words: timed.length > 0 ? timed : estimatedWords(slot.brief.coversText, slot.durationMs),
    wordsEstimated: timed.length === 0,
  }
}

/** Why a parsed scene cannot be stored, in the words the retry and the card read. */
function sceneIssue(
  scene: PlannedGraphicScene,
  context: GraphicDesignContext,
  durationMs: number,
): { scene: GraphicScene } | { issue: string } {
  const timing = lateEntranceIssue(scene, durationMs)
  if (timing !== null) return { issue: timing }
  return resolvePlannedScene(scene, context.claims, context.logos)
}

async function complete(
  context: GraphicDesignContext,
  input: GraphicDesignInput,
): Promise<string> {
  const request = buildGraphicRequest(input)
  try {
    return (await callLlm(request, { projectId: context.projectId })).text
  } catch (error) {
    // The shot list's rule (plan-chapter.ts): a cut-off answer is retried
    // once at double the room, because the same budget is cut off again.
    const cutOff = error instanceof ValidationError && error.field === 'maxTokens'
    if (!cutOff || request.maxTokens >= MAX_OUTPUT_TOKENS) throw error
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    return (await callLlm(bigger, { projectId: context.projectId })).text
  }
}

export async function designGraphic(
  context: GraphicDesignContext,
  slot: GraphicSlotTiming & { brief: GraphicBrief },
  options: { guidance?: string; redesign?: boolean } = {},
): Promise<GraphicDesignResult> {
  const claimIds = context.claims.map((claim) => claim.id)
  const { intent, claimIds: intentClaimIds } = graphicIntentOf(slot.brief)
  const intentRefs = intentClaimIds.map((id) => claimIds.indexOf(id) + 1).filter((n) => n > 0)

  if (mockProvidersEnabled()) {
    const scene = mockGraphicScene({
      claimTexts: context.claims.map((claim) => claim.text),
      intentRefs: intentRefs.length > 0 ? intentRefs : [1],
      logoTitles: context.logos.map((logo) => logo.title),
      ...(options.guidance ? { guidance: options.guidance } : {}),
      durationMs: slot.durationMs,
    })
    const checked = sceneIssue(scene, context, slot.durationMs)
    return 'scene' in checked ? { ok: true, scene: checked.scene } : { ok: false, issue: checked.issue }
  }

  const base: GraphicDesignInput = {
    caseTitle: context.caseTitle,
    claims: context.claims,
    logos: context.logos.map((logo) => logo.title),
    chapterTitle: context.chapterTitle,
    coversText: slot.brief.coversText,
    ...slotNarration(context, slot),
    durationMs: slot.durationMs,
    intent,
    intentRefs,
    ...(options.redesign && slot.brief.scene
      ? { current: toPlannedScene(slot.brief.scene, claimIds) }
      : {}),
    ...(options.guidance ? { guidance: options.guidance } : {}),
  }

  let rejection: string | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = await complete(context, rejection ? { ...base, rejection } : base)
    let checked: { scene: GraphicScene } | { issue: string }
    try {
      checked = sceneIssue(parseGraphicScene(text), context, slot.durationMs)
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error
      checked = { issue: error.message }
    }
    if ('scene' in checked) return { ok: true, scene: checked.scene }
    rejection = checked.issue
  }
  return { ok: false, issue: rejection! }
}

/** A brief with the design's outcome on it: a scene, or the reason there is none. */
export function withDesign(brief: GraphicBrief, result: GraphicDesignResult): GraphicBrief {
  const { designIssue: _old, ...rest } = brief
  return result.ok ? { ...rest, scene: result.scene } : { ...rest, designIssue: result.issue }
}

/** What a side job (Redesign, retype) needs to design one graphic, read fresh. */
export async function loadGraphicContext(
  projectId: string,
  chapterId: string,
): Promise<GraphicDesignContext> {
  const project = await getProject(db, projectId)
  if (!project) throw new NonRetriableError(`Project ${projectId} no longer exists`)
  const [sources, takes, claims, logos] = await Promise.all([
    latestScriptParagraphSources(db, projectId),
    listVoiceTakes(db, projectId),
    scriptableClaims(db, projectId),
    listLogos(db),
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
    logos: logos.map((row) => ({ id: row.id, title: row.title ?? '' })),
    paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
    chapterTitle: chapter?.title ?? '',
  }
}
```

If `MAX_OUTPUT_TOKENS` is not exported from `@boom-busters/providers`, it is (plan-chapter.ts imports it). If `TimedParagraph.words` items carry more fields than `{ text, startMs }`, `wordsInSlot` still accepts them.

- [ ] **Step 4: Run tests**

Run: `cd apps/web && pnpm exec vitest run lib/graphic-design.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/graphic-design.ts apps/web/lib/graphic-design.test.ts
git commit -m "feat(visuals): design one graphic, checked, retried once with the reason (decision 289)"
```

---

### Task 5: The shot list and retype write intents

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (`PlannedGraphicBriefSchema`; graphic branches of `resolvePlannedBrief` and `plannedBriefRejection`)
- Modify: `packages/providers/src/prompts/shotlist.ts` (graphic shape L219 to 232; graphic rule bullet L356 to 364; logos prefix wording L287 to 290; `mockShotList` graphic L681 to 740)
- Modify: `packages/providers/src/prompts/retype.ts` (graphic target L89 to 112; `mockRetypedBrief` graphic branch)
- Test: `packages/schemas/src/visuals.test.ts`, `packages/providers/src/prompts/shotlist.test.ts`, `packages/providers/src/prompts/retype.test.ts`, and any web test asserting a planned graphic's scene (search `scene:` in `apps/web/inngest/lib/shot-list.test.ts`, `apps/web/lib/plan-chapter*.test.ts`)

**Interfaces:**
- Produces: `PlannedGraphicBrief` = common fields + `intent: string` + `intentRefs: number[]` (default `[]`). `resolvePlannedBrief` returns a sceneless `GraphicBrief` with `intent` and `intentClaimIds`; `null` (with `plannedBriefRejection` reason `'graphic named a claim number outside the claim list'`) when any `intentRefs` number is out of range.

- [ ] **Step 1: Write the failing tests**

In `packages/schemas/src/visuals.test.ts`:

```ts
describe('a planned graphic is an intent (decision 289)', () => {
  const planned = {
    type: 'graphic' as const,
    coversText: 'It raised four billion.',
    description: 'The figure.',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
    intent: 'Four billion is the story.',
    intentRefs: [1],
  }

  it('resolves to a graphic with intent claim ids and no scene', () => {
    const stored = resolvePlannedBrief(planned, [{ id: CLAIM_A, text: '4 billion' }])
    expect(stored).toEqual({
      type: 'graphic',
      coversText: planned.coversText,
      description: planned.description,
      motion: planned.motion,
      transition: planned.transition,
      intent: planned.intent,
      intentClaimIds: [CLAIM_A],
    })
  })

  it('refuses a claim number outside the list, in words', () => {
    const bad = { ...planned, intentRefs: [3] }
    expect(resolvePlannedBrief(bad, [{ id: CLAIM_A }])).toBeNull()
    expect(plannedBriefRejection(bad, [{ id: CLAIM_A }])).toBe(
      'graphic named a claim number outside the claim list',
    )
  })

  it('no longer accepts a scene from the planner', () => {
    expect(PlannedBriefSchema.safeParse({ ...planned, intent: undefined, scene: { elements: [] } }).success).toBe(false)
  })
})
```

Delete or rewrite the existing tests that resolve a *planned* scene through `resolvePlannedBrief` (their checks now live in Task 2's `resolvePlannedScene` tests); keep their claim-digit assertions by pointing them at `resolvePlannedScene`.

In `shotlist.test.ts`:

```ts
it('asks for a graphic intent and carries no graphic vocabulary (decision 289)', () => {
  const request = buildShotListRequest(SHOT_LIST_INPUT)
  expect(request.system).toContain('"intent"')
  expect(request.system).toContain('"intentRefs"')
  expect(request.system).not.toContain('"kind": "figure"')
  expect(request.system).not.toContain('12 by 12 grid')
})

it('plans a mock graphic as an intent citing claim 1', () => {
  const graphic = mockShotList(MOCK_INPUT).slots.find((s) => s.brief.type === 'graphic')
  expect(graphic?.brief).toMatchObject({ intentRefs: [1] })
  expect(graphic?.brief).not.toHaveProperty('scene')
})
```

(`SHOT_LIST_INPUT`/`MOCK_INPUT`: the fixtures the file already uses; the mock input must include `claimTexts` with digits and `claimCount >= 1`.)

In `retype.test.ts`: the graphic target asks for `"intent"`; `mockRetypedBrief({ ..., targetType: 'graphic' })` returns `{ type: 'graphic', intent: ..., intentClaimIds: [claimIds[0]] }` with no scene; with `guidance`, the intent reads `'[mock] Drafted again: <guidance>'`.

- [ ] **Step 2: Run to see them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/visuals.test.ts` then `cd packages/providers && pnpm exec vitest run src/prompts`
Expected: FAIL.

- [ ] **Step 3: Change the planned shape**

```ts
/**
 * The wire shape of a graphic brief since decision 289: what it must get
 * across and the claims it rests on. The designer composes the scene after.
 */
export const PlannedGraphicBriefSchema = GraphicBriefSchema.omit({
  scene: true,
  intent: true,
  intentClaimIds: true,
  designIssue: true,
}).extend({
  intent: z.string().trim().min(1).max(300),
  intentRefs: z.array(z.number().int().min(1)).max(6).default([]),
})
```

`resolvePlannedBrief` graphic branch:

```ts
  if (brief.type === 'graphic') {
    const mapped = mapClaimRefs(brief.intentRefs, claims.map((claim) => claim.id))
    if (!mapped) return null
    const { intentRefs: _refs, ...rest } = brief
    return { ...rest, intentClaimIds: mapped }
  }
```

(Check `mapClaimRefs([], ids)` returns `[]` rather than `null`; if it returns `null` for empty input, special-case `brief.intentRefs.length === 0 ? [] : mapClaimRefs(...)`.)

`plannedBriefRejection` graphic branch:

```ts
  if (brief.type === 'graphic') {
    void logos
    return mapClaimRefs(brief.intentRefs, claims.map((claim) => claim.id)) || brief.intentRefs.length === 0
      ? null
      : 'graphic named a claim number outside the claim list'
  }
```

- [ ] **Step 4: Rewrite the prompts**

`shotlist.ts` graphic shape (replace the whole `{"type": "graphic", ...}` block through the `"emphasis"` line):

```ts
- {"type": "graphic", "coversText", "description", "motion", "transition",
   "intent": what the graphic must get across, in one or two sentences,
   "intentRefs": [claim numbers the beat rests on]}
```

Graphic rule bullet:

```ts
- A "graphic" is for a beat that is one or two cited figures, a company's or a person's
  mark, or a relationship between named things (a before and after, a comparison of two or
  three amounts, three dated moments). It is never a chart with fewer points: a value moving
  through time is a "chart". You do not design it: a designer composes it afterwards from
  your "intent" (what the viewer must take away, not how it looks) and the claims you list in
  "intentRefs", so list every claim whose number or name it may show.
```

Logos prefix line: `Logos (marks the producer holds; a graphic may show them):`.

`mockShotList` graphic: replace `scene: {...}` with:

```ts
        intent: '[mock] The figure, large, with the mark beside it.',
        intentRefs: [1],
```

`retype.ts` graphic target: replace the graphic shape and rules with the same intent shape and the same bullet text as the shot list (one exported constant `GRAPHIC_INTENT_RULES` in `shotlist.ts`, imported by `retype.ts`, so the two cannot drift). `mockRetypedBrief` graphic branch returns:

```ts
    return {
      type: 'graphic',
      ...common,
      intent: input.guidance
        ? `[mock] Drafted again: ${input.guidance}`.slice(0, 300)
        : '[mock] The figure, large, with the mark beside it.',
      intentClaimIds: [claimId],
    }
```

(`claimTexts` and `logoTitles` stay accepted and unused by the graphic branch; leave them for the chart and other callers or remove them only if nothing else reads them.)

- [ ] **Step 5: Run every consumer**

Run, one at a time (`timeout: 600000`): `cd packages/schemas && pnpm exec vitest run`; `cd packages/providers && pnpm exec vitest run`; `cd apps/web && pnpm exec vitest run inngest lib "app/(console)/projects"`; `pnpm typecheck`.
Expected: PASS. A web test that expected a planned graphic to arrive with a scene now sees `intent`; update it to assert the intent (Task 6 adds the design).

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src packages/providers/src apps/web
git commit -m "feat(visuals): the shot list writes a graphic's intent, not its design (decision 289)"
```

---

### Task 6: Each graphic gets its own step in both runners

**Files:**
- Create: `apps/web/inngest/lib/graphic-steps.ts`
- Modify: `apps/web/inngest/functions/visuals-runner.ts` (shot-list loop ~L171 to 210; summary ~L247 to 270)
- Modify: `apps/web/inngest/functions/visuals-replanner.ts` (re-plan loop ~L310 to 340)
- Modify: `apps/web/inngest/lib/direction.ts` (`rewriteStoredBriefs`, keep a designed scene)
- Modify: `packages/schemas/src/visuals.ts` (add `keepGraphicDesign`)
- Test: `apps/web/inngest/lib/graphic-steps.test.ts`, `apps/web/inngest/functions/visuals-runner.test.ts`, `packages/schemas/src/visuals.test.ts`

**Interfaces:**
- Consumes: Task 4's `designGraphic`, `withDesign`, `GraphicDesignContext`.
- Produces:
  ```ts
  export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>
  export async function designPlannedGraphics(
    run: StepRunner,
    input: {
      prefix: string
      rows: readonly NewShotSlot[]
      context: Omit<GraphicDesignContext, 'chapterTitle'>
      chapterTitle: string
    },
  ): Promise<{ ok: true; rows: NewShotSlot[]; undesigned: number } | { ok: false; gate: Record<string, unknown> }>
  ```
  Each graphic row without a scene is designed in `run(\`${prefix}-${n}\`, ...)`, `n` counting graphics from 0.
  ```ts
  // packages/schemas/src/visuals.ts
  export function keepGraphicDesign(previous: ShotBrief, next: ShotBrief): ShotBrief
  ```

- [ ] **Step 1: Write the failing helper test**

`apps/web/inngest/lib/graphic-steps.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { BudgetExceededError } from '@boom-busters/schemas'

const designGraphic = vi.fn()
vi.mock('@/lib/graphic-design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/graphic-design')>()),
  designGraphic: (...args: unknown[]) => designGraphic(...args),
}))

import { designPlannedGraphics } from './graphic-steps'

const graphic = (coversText: string) => ({
  chapterId: 'c1',
  index: 0,
  type: 'graphic',
  startMs: 0,
  durationMs: 6000,
  brief: { type: 'graphic', coversText, description: 'd', motion: { kind: 'static' }, transition: 'cut', intent: 'i', intentClaimIds: [] },
})
const still = { chapterId: 'c1', index: 1, type: 'still', startMs: 6000, durationMs: 3000, brief: { type: 'still' } }
const CONTEXT = { projectId: 'p', caseTitle: 'c', claims: [], logos: [], paragraphs: [] }

describe('designPlannedGraphics (decision 289)', () => {
  it('runs one named step per graphic and leaves other rows alone', async () => {
    designGraphic
      .mockResolvedValueOnce({ ok: true, scene: { elements: [] } })
      .mockResolvedValueOnce({ ok: false, issue: 'no digits' })
    const ids: string[] = []
    const result = await designPlannedGraphics(
      async (id, fn) => {
        ids.push(id)
        return fn()
      },
      { prefix: 'graphic-0', rows: [graphic('a'), still, graphic('b')] as never, context: CONTEXT, chapterTitle: 'One' },
    )
    expect(ids).toEqual(['graphic-0-0', 'graphic-0-1'])
    expect(result).toMatchObject({ ok: true, undesigned: 1 })
    if (!result.ok) throw new Error('unreachable')
    expect(result.rows[0]!.brief).toMatchObject({ scene: { elements: [] } })
    expect(result.rows[1]).toBe(still)
    expect(result.rows[2]!.brief).toMatchObject({ designIssue: 'no digits' })
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

If `BudgetExceededError`'s constructor takes more fields than these five, copy the call in `apps/web/inngest/lib/gates.test.ts` L177.

- [ ] **Step 2: Run to see it fail**

Run: `cd apps/web && pnpm exec vitest run inngest/lib/graphic-steps.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the helper**

```ts
import type { NewShotSlot } from '@boom-busters/db'
import { BudgetExceededError, GraphicBriefSchema } from '@boom-busters/schemas'
import { designGraphic, withDesign, type GraphicDesignContext } from '@/lib/graphic-design'
import { budgetGateData } from './gates'

/** `step.run`, as the helper needs it; the runners pass `(id, fn) => step.run(id, fn)`. */
export type StepRunner = <T>(id: string, fn: () => Promise<T>) => Promise<T>

/**
 * Each planned graphic designed in its own step (decision 289), so an
 * Inngest retry repeats one graphic and never the chapter. A graphic the
 * designer could not compose keeps its intent and says why; it is never
 * dropped and never stops the plan. Running out of budget stops it.
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
  let n = 0
  for (const row of input.rows) {
    const brief = GraphicBriefSchema.safeParse(row.brief)
    if (row.type !== 'graphic' || !brief.success || brief.data.scene) {
      rows.push(row)
      continue
    }
    const outcome = await run(`${input.prefix}-${n}`, async () => {
      try {
        const result = await designGraphic(
          { ...input.context, chapterTitle: input.chapterTitle },
          { chapterId: row.chapterId, startMs: row.startMs, durationMs: row.durationMs, brief: brief.data },
        )
        return { ok: true as const, brief: withDesign(brief.data, result) }
      } catch (error) {
        if (error instanceof BudgetExceededError) {
          return { ok: false as const, gate: budgetGateData(error) }
        }
        throw error
      }
    })
    n += 1
    if (!outcome.ok) return { ok: false, gate: outcome.gate }
    if (!outcome.brief.scene) undesigned += 1
    rows.push({ ...row, brief: outcome.brief })
  }
  return { ok: true, rows, undesigned }
}
```

(If `NewShotSlot.brief` is typed `ShotBrief`, the spread type-checks; if it is `unknown`, keep the cast-free form above since `GraphicBrief` is assignable.)

- [ ] **Step 4: Call it from the runner**

In `visuals-runner.ts`, add `let undesignedGraphics = 0` beside `rejectedSlots`. After `if (!planned.ok) {...}` and before `allRows.push(...)`:

```ts
        // Each graphic gets a designer of its own (decision 289), one step
        // each, before the plan is saved.
        const designed = await designPlannedGraphics((id, fn) => step.run(id, fn), {
          prefix: `graphic-${index}`,
          rows: planned.rows,
          context: {
            projectId,
            caseTitle: setup.caseTitle,
            claims: setup.claims,
            logos: setup.logos,
            paragraphs: setup.paragraphs,
          },
          chapterTitle: chapter.title,
        })
        if (!designed.ok) {
          await step.run(`graphic-${index}-over-budget`, () => markStageFailed(ctx, designed.gate))
          return { projectId, outcome: 'over-budget' as const }
        }
        undesignedGraphics += designed.undesigned
```

and push `designed.rows` instead of `planned.rows`. In the summary string, after the rejected-slots clause:

```ts
            (undesignedGraphics > 0
              ? ` · ${undesignedGraphics} graphic${undesignedGraphics === 1 ? '' : 's'} not designed`
              : '') +
```

`setup.paragraphs` is `TimedParagraph[]` already; `setup.logos` is `{ id, title }[]`. If `step.run`'s inferred return type (Inngest's `Jsonify<T>`) does not satisfy `StepRunner`, write the adapter as `(id, fn) => step.run(id, fn) as never` with a one-line comment that the step results are plain JSON.

- [ ] **Step 5: Call it from the replanner**

Same block in `visuals-replanner.ts` after `if (!planned.ok) {...}`, prefix `replan-graphic-${index}`, over budget handled as its existing `replan-${index}-over-budget` step does (`markSideJobFailed(ctx, 'The re-plan stopped', designed.gate)`), and `rows.push(...designed.rows)`. Use `setup.caseTitle`, `setup.claims`, `setup.logos`, `setup.paragraphs` (all present in its setup; if `logos` is `LogoIndex[]` there already, pass it as is).

- [ ] **Step 6: Keep designs through the Fix button**

`rewriteStoredBriefs` has no direct test (it calls the model and returns early in mock mode), so the rule is a pure function in schemas, tested there. Append to `packages/schemas/src/visuals.test.ts`:

```ts
describe('keepGraphicDesign (decision 289)', () => {
  const common = {
    coversText: 'c',
    description: 'd',
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
  }

  it('keeps a designed scene when a rewrite returns an intent-only graphic', () => {
    const previous = { type: 'graphic' as const, ...common, intent: 'old', scene: STORED_SCENE }
    const next = { type: 'graphic' as const, ...common, intent: 'new', intentClaimIds: [] }
    expect(keepGraphicDesign(previous, next)).toEqual({ ...next, scene: STORED_SCENE })
  })

  it('leaves every other rewrite alone', () => {
    const still = { type: 'still' as const, ...common, prompt: 'p' }
    const next = { type: 'graphic' as const, ...common, intent: 'new' }
    expect(keepGraphicDesign(still as never, next)).toBe(next)
    const undesigned = { type: 'graphic' as const, ...common, intent: 'old' }
    expect(keepGraphicDesign(undesigned, next)).toBe(next)
  })
})
```

(`STORED_SCENE` is Task 2's fixture.) Implement in `visuals.ts`:

```ts
/**
 * The Fix button rewrites a graphic's words, never its design (decision 289):
 * a planned graphic carries no scene, so a rewrite of a designed graphic keeps
 * the scene it had, and the owner presses Redesign graphic if the new intent
 * needs a new one.
 */
export function keepGraphicDesign(previous: ShotBrief, next: ShotBrief): ShotBrief {
  if (previous.type !== 'graphic' || next.type !== 'graphic' || !previous.scene || next.scene) {
    return next
  }
  return { ...next, scene: previous.scene }
}
```

In `direction.ts` `rewriteStoredBriefs`, after the `if (!stored) {...}` check: `const kept = keepGraphicDesign(target.brief, stored)`, and store `kept` instead of `stored` in both the `updateSlotBrief` and the `retypeShotSlot` branch.

- [ ] **Step 7: Runner tests**

`visuals-runner.test.ts` is a database test (`describeDb`, `InngestTestEngine`, `callLlm` mocked with `vi.hoisted`). Add beside "leaves every planned slot without a route of its own" (L259), in live-model mode so the shot list can be made to plan a graphic:

```ts
  it('designs each planned graphic before the plan is saved (decision 289)', async () => {
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
    // A text-only scene cites no claim, so it passes whatever the fixture's claims say.
    const scene = {
      elements: [
        {
          kind: 'text',
          id: 't',
          cell: { col: 1, row: 3, colSpan: 10, rowSpan: 2 },
          content: 'The money is gone',
          role: 'heading',
          color: 'textPrimary',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
    }
    callLlm.mockReset()
    callLlm.mockImplementation((request: { task: string }) => {
      if (request.task === 'direction') return Promise.resolve({ text: JSON.stringify(book) })
      if (request.task === 'graphics') return Promise.resolve({ text: JSON.stringify({ scene }) })
      return Promise.resolve({ text: JSON.stringify({ slots: [planned] }) })
    })

    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    const stored = (await listShotSlots(db, FIXTURE_PROJECT_ID)).find((s) => s.type === 'graphic')
    expect(stored?.brief).toMatchObject({
      intent: 'The money is simply gone.',
      scene: { elements: [{ id: 't', content: 'The money is gone' }] },
    })
  })

  it('stores an undesigned graphic with its reason (decision 289)', async () => {
    vi.stubEnv('MOCK_PROVIDERS', '')
    const book = mockDirectorsBook({ caseTitle: 'Wirecard', chapterCount: 1, cast: [] })
    callLlm.mockReset()
    callLlm.mockImplementation((request: { task: string }) => {
      if (request.task === 'direction') return Promise.resolve({ text: JSON.stringify(book) })
      // Never a usable scene: both attempts are refused.
      if (request.task === 'graphics') return Promise.resolve({ text: '{"scene": {"elements": []}}' })
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
    expect(stored?.brief).toMatchObject({
      designIssue: expect.stringMatching(/^The graphic is malformed/),
    })
    expect((stored?.brief as { scene?: unknown }).scene).toBeUndefined()
  })
```

The harness may replay the function before settling on the named step, which is why `callLlm` answers by task rather than by call order (the file's own note at `stubDirectionAndShotList`). The "1 graphic not designed" summary is covered by `designPlannedGraphics`' `undesigned` count in Step 1; assert the summary string here too only if the file already reads the gate's summary somewhere.

- [ ] **Step 8: Run**

Run, one at a time (`timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest`; `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/inngest
git commit -m "feat(visuals): every planned graphic is designed in a step of its own (decision 289)"
```

---

### Task 7: Redesign graphic and retype reach the designer

**Files:**
- Modify: `apps/web/inngest/functions/slot-rebriefer.ts` (graphic branch in `draft-brief`, ~L154 to 190)
- Modify: `apps/web/inngest/functions/slot-retyper.ts` (after `retypeShotSlot`, ~L188)
- Test: `apps/web/inngest/functions/slot-rebriefer.test.ts`, `apps/web/inngest/functions/slot-retyper.test.ts` (create beside the functions if absent, following an existing function test such as `slot-redirector.test.ts`)

**Interfaces:**
- Consumes: Task 4's `designGraphic`, `withDesign`, `loadGraphicContext`; db `getShotSlot`, `updateSlotBrief`, `setSlotRetype`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

Both files are database tests in mock-provider mode (`describeDb`, `InngestTestEngine`, `seed(db)`), so the mock designer (Task 3) answers. In `slot-rebriefer.test.ts`, inside `describeDb('slot-rebriefer (mock mode)')`, using its `seedSlot` and `rebriefEvent`:

```ts
  const designedGraphic: ShotBrief = {
    type: 'graphic',
    coversText: stockBrief.coversText,
    description: 'The missing sum, large.',
    motion: { kind: 'static' },
    transition: 'cut',
    intent: 'The money is simply gone.',
    scene: {
      elements: [
        {
          kind: 'text',
          id: 'old',
          cell: { col: 1, row: 3, colSpan: 10, rowSpan: 2 },
          content: 'Old design',
          role: 'heading',
          color: 'textPrimary',
          enter: { kind: 'fade', atMs: 0 },
        },
      ],
    },
  }

  it('redesigns a graphic from its intent with the steer (decision 289)', async () => {
    const graphicId = await seedSlot(designedGraphic)
    await setSlotRetype(db, graphicId, { state: 'rebriefing' })
    const { result } = await engine.execute({ events: rebriefEvent(graphicId, 'bigger') })
    expect(result).toMatchObject({ outcome: 'rebriefed' })

    const slot = await getShotSlot(db, graphicId)
    const brief = slot?.brief as { intent: string; scene: { elements: { content?: string }[] } }
    // A redesign keeps the intent; the mock designer titles a steered design with the steer.
    expect(brief.intent).toBe('The money is simply gone.')
    expect(brief.scene.elements[0]?.content).toBe('[mock] Redesigned: bigger')
    expect(slot?.retype).toBeNull()
  })

  it('keeps the old design when the redesign is refused (decision 289)', async () => {
    const design = await import('@/lib/graphic-design')
    const refuse = vi
      .spyOn(design, 'designGraphic')
      .mockResolvedValueOnce({ ok: false, issue: 'element "f" enters at 900 ms' })
    try {
      const graphicId = await seedSlot(designedGraphic)
      const { result } = await engine.execute({ events: rebriefEvent(graphicId) })
      expect(result).toMatchObject({ outcome: 'refused' })

      const slot = await getShotSlot(db, graphicId)
      expect((slot?.brief as { scene: unknown }).scene).toEqual(designedGraphic.scene)
      expect(slot?.retype).toEqual({
        state: 'rebrief-refused',
        reason: 'element "f" enters at 900 ms',
      })
    } finally {
      refuse.mockRestore()
    }
  })
```

If `vi.spyOn` on the ESM namespace fails ("cannot redefine property"), declare at the top of the file `vi.mock('@/lib/graphic-design', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/graphic-design')>()), designGraphic: vi.fn((...args) => realDesign(...args)) }))` with `realDesign` captured from `importOriginal`, and use `vi.mocked(designGraphic).mockResolvedValueOnce(...)` in the test instead.

In `slot-retyper.test.ts`, inside `describeDb('slot-retyper (mock mode)')`:

```ts
  it('designs a slot retyped to a graphic (decision 289)', async () => {
    const { result } = await engine.execute({ events: retypeEvent(slotId, 'graphic') })
    expect(result).toMatchObject({ outcome: 'retyped', targetType: 'graphic' })

    const slot = await getShotSlot(db, slotId)
    expect(slot?.type).toBe('graphic')
    expect(slot?.brief).toMatchObject({
      type: 'graphic',
      intent: '[mock] The figure, large, with the mark beside it.',
      scene: { elements: expect.arrayContaining([expect.objectContaining({ id: 't1' })]) },
    })
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run inngest/functions/slot-rebriefer.test.ts inngest/functions/slot-retyper.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rebriefer**

In `draft-brief`, before the `if (brief.type === 'chart' || brief.type === 'map' || brief.type === 'graphic')` branch, add a graphic branch and drop `'graphic'` from that condition:

```ts
      // A graphic is redesigned, not re-briefed (decision 289): its intent
      // stays, the designer composes again from it, the current scene and the
      // steer. A refusal leaves the scene the card already shows.
      if (brief.type === 'graphic') {
        try {
          const context = await loadGraphicContext(projectId, slot.chapterId)
          const result = await designGraphic(
            context,
            { chapterId: slot.chapterId, startMs: slot.startMs, durationMs: slot.durationMs, brief },
            { redesign: true, ...(guidance === undefined ? {} : { guidance }) },
          )
          if (!result.ok) {
            // The bare reason; the card words it (Task 8).
            await setSlotRetype(db, slotId, { state: 'rebrief-refused', reason: result.issue })
            return { ok: false as const, refused: result.issue }
          }
          await updateSlotBrief(db, slotId, withDesign(brief, result))
          await setSlotRetype(db, slotId, null)
          return { ok: true as const, resolveNow: project.visualsPhase === 'board' }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      }
```

The card words a graphic's refusal as "No new design: {reason} The graphic keeps the one it has." (Task 8), so the stored reason is the bare issue.

- [ ] **Step 4: Retyper**

After `await retypeShotSlot(db, slotId, targetType, next)` the step returns as before. Then, after the over-budget and refused checks and before `if (converted.resolveNow)`, add:

```ts
    // A slot retyped to a graphic arrives with an intent and no design
    // (decision 289); the designer composes it in a step of its own.
    if (targetType === 'graphic') {
      const designed = await step.run('design-graphic', async () => {
        const slot = await getShotSlot(db, slotId)
        if (!slot) throw new NonRetriableError(`Shot slot ${slotId} vanished mid-retype`)
        const brief = GraphicBriefSchema.parse(slot.brief)
        try {
          const context = await loadGraphicContext(projectId, slot.chapterId)
          const result = await designGraphic(context, {
            chapterId: slot.chapterId,
            startMs: slot.startMs,
            durationMs: slot.durationMs,
            brief,
          })
          await updateSlotBrief(db, slotId, withDesign(brief, result))
          return { ok: true as const }
        } catch (error) {
          if (error instanceof BudgetExceededError) {
            return { ok: false as const, gate: budgetGateData(error) }
          }
          throw error
        }
      })
      if (!designed.ok) {
        await step.run('design-over-budget', () =>
          markSideJobFailed(ctx, 'The graphic could not be designed', designed.gate),
        )
        return { projectId, slotId, outcome: 'over-budget' as const }
      }
    }
```

Import `GraphicBriefSchema`, `getShotSlot`, `updateSlotBrief`, `designGraphic`, `withDesign`, `loadGraphicContext` as needed. `updateSlotBrief` must not reset the slot's type; it does not (it is the rebriefer's store).

- [ ] **Step 5: Run**

Run (`timeout: 600000`): `cd apps/web && pnpm exec vitest run inngest`; `pnpm typecheck`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/inngest/functions
git commit -m "feat(visuals): Redesign graphic and a retype to graphic go to the designer (decision 289)"
```

---

### Task 8: The graphic card's intent, undesigned state and Redesign copy

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`GraphicSlot` L1236 to 1291; rebrief button L2496 to 2504; `rebriefing` status L2950 to 2954; `rebriefRefused` alert ~L2978; `RebriefForm` L3186 to 3250; `BriefEditor` L3575 to 3660)
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`BriefPatchSchema` L252 to 259)
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`, `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Consumes: Task 2's stored shape (`intent`, `intentClaimIds`, `designIssue`, optional `scene`), `graphicIntentOf`.
- Produces: `BriefPatchSchema` accepts `intent`.

- [ ] **Step 1: Write the failing component tests**

In `visual-board.test.tsx`, a `describe('the graphic card (decision 289)')` using the file's `model([...])` helper and an existing graphic slot fixture (search `type: 'graphic'` in the file; call it `graphicSlot` here):

```tsx
it('shows the intent under the preview', () => {
  const slot = { ...graphicSlot, brief: { ...graphicSlot.brief, intent: 'Four billion is the story.' } }
  render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
  expect(screen.getByText('Intent: Four billion is the story.')).toBeInTheDocument()
})

it('reads the description as the intent of an older graphic', () => {
  render(<VisualBoard projectId={PROJECT} model={model([graphicSlot])} colors={COLORS} brand={BRAND} />)
  expect(screen.getByText(`Intent: ${graphicSlot.brief.description}`)).toBeInTheDocument()
})

it('says why a graphic was not designed, beside Redesign graphic', () => {
  const { scene: _scene, ...rest } = graphicSlot.brief
  const slot = { ...graphicSlot, brief: { ...rest, intent: 'i', designIssue: 'no claim holds $5bn' } }
  render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
  expect(screen.getByText('Not designed: no claim holds $5bn')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Redesign graphic' })).toBeInTheDocument()
  expect(screen.queryByRole('img', { name: /^graphic:/ })).toBeNull()
})

it('says a graphic is being designed when it has neither scene nor issue', () => {
  const { scene: _scene, ...rest } = graphicSlot.brief
  const slot = { ...graphicSlot, brief: { ...rest, intent: 'i' } }
  render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
  expect(screen.getByText('Being designed. This card updates when it lands.')).toBeInTheDocument()
})

it('offers Redesign graphic, with its own form', async () => {
  render(<VisualBoard projectId={PROJECT} model={model([graphicSlot])} colors={COLORS} brand={BRAND} />)
  expect(screen.queryByRole('button', { name: 'Draft a different brief' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Redesign graphic' }))
  expect(screen.getByLabelText('What should change? (optional)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Redesign it' }))
  expect(rebriefSlotAction).toHaveBeenCalledWith(PROJECT, graphicSlot.id, '')
})

it('words a running and a refused redesign as a design', () => {
  render(
    <VisualBoard
      projectId={PROJECT}
      model={model([{ ...graphicSlot, retype: { state: 'rebriefing' } }])}
      colors={COLORS}
      brand={BRAND}
    />,
  )
  expect(screen.getByText('Claude is redesigning this graphic. This card updates when it lands.')).toBeInTheDocument()
})

it('edits the intent from Edit brief', async () => {
  const slot = { ...graphicSlot, brief: { ...graphicSlot.brief, intent: 'Old intent.' } }
  render(<VisualBoard projectId={PROJECT} model={model([slot])} colors={COLORS} brand={BRAND} />)
  await userEvent.click(screen.getByRole('button', { name: /Edit brief/ }))
  const intent = screen.getByLabelText('Intent')
  await userEvent.clear(intent)
  await userEvent.type(intent, 'New intent.')
  await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
  expect(editBriefAction).toHaveBeenCalledWith(PROJECT, slot.id, expect.objectContaining({ intent: 'New intent.' }))
})
```

Also add a refused case: `retype: { state: 'rebrief-refused', reason: 'no claim holds $5bn' }` shows `No new design: no claim holds $5bn The graphic keeps the one it has.`

In `visuals-actions.test.ts`, beside `editBriefAction` tests: an `intent` patch on a graphic stores it; an `intent` patch on a still is refused with `'That edit does not fit this slot type.'` (it is: `ShotBriefSchema` strips unknown keys for a still? If Zod strips rather than refuses, assert instead that the stored still has no `intent`).

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/visual-board.test.tsx" "app/(console)/projects/[id]/visuals-actions.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement the card**

`GraphicSlot` body, replacing the preview line and adding the intent and state lines:

```tsx
  const { intent } = graphicIntentOf(brief)
  return (
    <div className="flex flex-col gap-2">
      {brief.scene ? (
        <GraphicPreview brief={brief} brand={brand} logoUrls={slot.logoUrls} />
      ) : brief.designIssue ? (
        <p role="alert" className="text-[13px] text-[var(--color-warning)]">
          Not designed: {brief.designIssue}
        </p>
      ) : (
        <p role="status" className="text-[13px] text-[var(--color-text-secondary)]">
          Being designed. This card updates when it lands.
        </p>
      )}
      <p className="text-[12px] text-[var(--color-text-secondary)]">Intent: {intent}</p>
      {/* claim chips and logo uploaders as before */}
    </div>
  )
```

Rebrief button label: `{rebriefing ? 'Close' : brief.type === 'graphic' ? 'Redesign graphic' : 'Draft a different brief'}`. For an undesigned graphic, the same button is the one beside "Not designed" (it is already on the card; no second button).

`rebriefing` status line: `brief?.type === 'graphic' ? 'Claude is redesigning this graphic. This card updates when it lands.' : 'Claude is drafting a new brief. This card updates when it lands.'` (thread `brief` to wherever the status renders if it is not in scope).

`rebriefRefused` alert text for a graphic: `No new design: {reason} The graphic keeps the one it has.`

`RebriefForm`: add a `graphic: boolean` prop (pass `brief.type === 'graphic'`). When true: label `What should change? (optional)`, placeholder `Leave this empty to just ask for a different design.`, note `The designer starts from this graphic's intent and current design. The steer is used once and not kept.`, submit label `Redesign it`, toast `Redesigning: this card updates when it lands`.

`BriefEditor`: `const [intent, setIntent] = React.useState(brief?.type === 'graphic' ? (brief.intent ?? brief.description) : '')`; include `...(brief.type === 'graphic' ? { intent } : {})` in the `editBriefAction` patch; render for graphics:

```tsx
      {brief.type === 'graphic' ? (
        <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
          Intent
          <textarea
            value={intent}
            onChange={(event) => setIntent(event.target.value)}
            rows={2}
            maxLength={300}
            className={field}
          />
        </label>
      ) : null}
```

`visuals-actions.ts` `BriefPatchSchema`: add `intent: z.string().trim().min(1).max(300).optional(),`. A graphic edit on the board refetches today; a graphic's refetch only re-resolves (no spend), so leave that path as is.

- [ ] **Step 4: Run**

Run (`timeout: 600000`): `cd apps/web && pnpm exec vitest run "app/(console)/projects"`; `pnpm typecheck`.
Expected: PASS. Existing tests asserting "Draft a different brief" on a graphic card change to "Redesign graphic"; on other types they stay.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]"
git commit -m "feat(board): a graphic card shows its intent, says when it is undesigned, and redesigns (decision 289)"
```

---

### Task 9: Play the real graphic on the board

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/graphic-player.tsx`
- Modify: `packages/compositions/src/index.ts` (export `GraphicCard`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`GraphicSlot`; wrap the board in `GraphicPlaybackProvider`)
- Test: `apps/web/app/(console)/projects/[id]/graphic-player.test.tsx`, `visual-board.test.tsx`

**Interfaces:**
- Consumes: `GraphicCard` from `@boom-busters/compositions`; `Player`, `PlayerRef` from `@remotion/player`; `MASTER_FPS` from `@boom-busters/timeline` (exported through `./compile`); `resolveBrandKit`, `DEFAULT_SETTINGS` (schemas); `loadBrandFonts` (compositions).
- Produces:
  ```tsx
  export function GraphicPlaybackProvider({ children }: { children: React.ReactNode }): JSX.Element
  export function useGraphicPlayback(slotId: string): { playing: boolean; play: () => void; stop: () => void }
  export function GraphicPlayerFrame(props: {
    scene: GraphicScene
    brand: BrandKitStored
    logoUrls: Readonly<Record<string, string>>
    durationMs: number
    portrait: boolean
  }): JSX.Element
  export function GraphicPlayback(props: {
    slotId: string
    scene: GraphicScene
    brand: BrandKitStored
    logoUrls: Readonly<Record<string, string>>
    durationMs: number
  }): JSX.Element
  ```

- [ ] **Step 1: Write the failing tests**

`graphic-player.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@boom-busters/schemas'

vi.mock('@remotion/player', () => ({
  Player: Object.assign(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ durationInFrames, compositionWidth, compositionHeight, inputProps }: any) => (
      <div data-testid="player">
        frames:{durationInFrames} size:{compositionWidth}x{compositionHeight} logos:
        {Object.keys(inputProps.payload.logos).join(',')}
      </div>
    ),
    { displayName: 'Player' },
  ),
}))
vi.mock('@boom-busters/compositions', () => ({
  GraphicCard: () => null,
  loadBrandFonts: () => Promise.resolve(),
}))

import { GraphicPlayback, GraphicPlaybackProvider } from './graphic-player'

const SCENE = {
  elements: [
    { kind: 'logo' as const, id: 'l1', cell: { col: 0, row: 0, colSpan: 4, rowSpan: 4 }, entity: 'Acme', assetId: 'A1', enter: { kind: 'fade' as const, atMs: 0 } },
  ],
}
const card = (slotId: string) => (
  <GraphicPlayback
    slotId={slotId}
    scene={SCENE}
    brand={DEFAULT_SETTINGS.brandKit}
    logoUrls={{ A1: 'https://r2.example/acme.png' }}
    durationMs={6000}
  />
)

describe('GraphicPlayback (decision 289)', () => {
  it('mounts the player only when Play graphic is pressed, at the slot length', async () => {
    render(<GraphicPlaybackProvider>{card('s1')}</GraphicPlaybackProvider>)
    expect(screen.queryByTestId('player')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    expect(await screen.findByTestId('player')).toHaveTextContent('frames:180 size:960x540 logos:l1')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Replay' })).toBeInTheDocument()
  })

  it('plays the portrait frame on Portrait', async () => {
    render(<GraphicPlaybackProvider>{card('s1')}</GraphicPlaybackProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'Play graphic' }))
    await userEvent.click(screen.getByRole('button', { name: 'Portrait' }))
    expect(await screen.findByTestId('player')).toHaveTextContent('size:540x960')
    expect(screen.getByRole('button', { name: 'Landscape' })).toBeInTheDocument()
  })

  it('plays one graphic at a time', async () => {
    render(
      <GraphicPlaybackProvider>
        {card('s1')}
        {card('s2')}
      </GraphicPlaybackProvider>,
    )
    const [first, second] = screen.getAllByRole('button', { name: 'Play graphic' })
    await userEvent.click(first!)
    await userEvent.click(second!)
    expect(screen.getAllByTestId('player')).toHaveLength(1)
  })
})
```

In `visual-board.test.tsx`, mock `./graphic-player` with a stub exporting `GraphicPlaybackProvider` (renders children) and `GraphicPlayback` (renders `<button>Play graphic</button>`), then assert a designed graphic card has a "Play graphic" button and an undesigned one does not.

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/graphic-player.test.tsx"`
Expected: FAIL (module missing).

- [ ] **Step 3: Export the card**

In `packages/compositions/src/index.ts`: `export { GraphicCard } from './components/GraphicCard'`. The barrel comment says it re-exports what apps/web consumes; this is now consumed.

- [ ] **Step 4: Implement the player**

```tsx
'use client'

import { GraphicCard, loadBrandFonts } from '@boom-busters/compositions'
import { DEFAULT_SETTINGS, resolveBrandKit } from '@boom-busters/schemas'
import type { BrandKitStored, GraphicScene } from '@boom-busters/schemas'
import { MASTER_FPS } from '@boom-busters/timeline'
import { Player, type PlayerRef } from '@remotion/player'
import dynamic from 'next/dynamic'
import * as React from 'react'
import { Button } from '@/components/ui/button'

/**
 * The board plays the real graphic (decision 289): the same `GraphicCard` the
 * render mounts, at the slot's own length, so the motion the owner approves is
 * the motion the film shows. The resting-frame SVG stays the thumbnail.
 *
 * The player ships with the Vercel deploy while renders use the uploaded
 * Remotion bundle: a composition change must ship with `deploy:remotion` for
 * the two to match.
 */

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

/** Half of 1080p, as the brand specimen plays: frameScale sizes everything. */
const LANDSCAPE = { width: 960, height: 540 }
const PORTRAIT = { width: 540, height: 960 }

export function GraphicPlayerFrame({
  scene,
  brand,
  logoUrls,
  durationMs,
  portrait,
  playerRef,
}: {
  scene: GraphicScene
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
  portrait: boolean
  playerRef?: React.Ref<PlayerRef>
}) {
  const tokens = React.useMemo(
    () => resolveBrandKit({ ...DEFAULT_SETTINGS, brandKit: brand }),
    [brand],
  )
  React.useEffect(() => {
    void loadBrandFonts(tokens.typography)
  }, [tokens])
  const durationInFrames = Math.max(1, Math.round((durationMs / 1000) * MASTER_FPS))
  // The card reads only each logo's URL; the size fields the timeline schema
  // requires are not read by the component, so the board passes 1 by 1.
  const logos = Object.fromEntries(
    scene.elements.flatMap((element) =>
      element.kind === 'logo' && element.assetId && logoUrls[element.assetId]
        ? [[element.id, { r2Key: `logos/${element.assetId}`, url: logoUrls[element.assetId]!, width: 1, height: 1 }]]
        : [],
    ),
  )
  const size = portrait ? PORTRAIT : LANDSCAPE
  return (
    <div
      role="region"
      aria-label="Graphic playback"
      className="overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-black"
    >
      <Player
        ref={playerRef}
        component={GraphicCard}
        inputProps={{ payload: { kind: 'graphic', scene, logos, claimIds: [] }, brand: tokens, durationInFrames }}
        durationInFrames={durationInFrames}
        fps={MASTER_FPS}
        compositionWidth={size.width}
        compositionHeight={size.height}
        autoPlay
        acknowledgeRemotionLicense
        style={{ width: '100%' }}
      />
    </div>
  )
}

/** Loaded on the first Play: the board never pays for the player until asked. */
const LazyFrame = dynamic(() => Promise.resolve(GraphicPlayerFrame), { ssr: false })

export function GraphicPlayback({
  slotId,
  scene,
  brand,
  logoUrls,
  durationMs,
}: {
  slotId: string
  scene: GraphicScene
  brand: BrandKitStored
  logoUrls: Readonly<Record<string, string>>
  durationMs: number
}) {
  const { playing, play, stop } = useGraphicPlayback(slotId)
  const [portrait, setPortrait] = React.useState(false)
  const [paused, setPaused] = React.useState(false)
  const ref = React.useRef<PlayerRef>(null)

  if (!playing) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => { setPaused(false); play() }}>
          Play graphic
        </Button>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <LazyFrame
        key={portrait ? 'portrait' : 'landscape'}
        scene={scene}
        brand={brand}
        logoUrls={logoUrls}
        durationMs={durationMs}
        portrait={portrait}
        playerRef={ref}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            if (paused) ref.current?.play()
            else ref.current?.pause()
            setPaused(!paused)
          }}
        >
          {paused ? 'Play' : 'Pause'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            ref.current?.seekTo(0)
            ref.current?.play()
            setPaused(false)
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

Notes for the implementer:
- `dynamic(() => Promise.resolve(GraphicPlayerFrame))` keeps the frame out of server rendering; the real code split comes from `visual-board.tsx` importing `GraphicPlayback` through `next/dynamic` as `settings-form.tsx` imports the brand specimen (do that in Step 5) so `@remotion/player` and the composition library load on the first Play only. If the double `dynamic` is awkward, drop `LazyFrame` and render `GraphicPlayerFrame` directly; the board-level dynamic import is the one that matters.
- `dynamic` with a `ref` prop: pass the ref as `playerRef` (a plain prop), as written, not as `ref`.
- Check `Button`'s import path and variants against `visual-board.tsx`'s own import.
- If `PlayerRef` lacks `seekTo`/`play`/`pause` in 4.0.512's types, read `node_modules/@remotion/player/dist/*.d.ts` for the exact method names before writing them.

- [ ] **Step 5: Mount it on the card**

In `visual-board.tsx`:

```tsx
const GraphicPlayback = dynamic(
  () => import('./graphic-player').then((module) => module.GraphicPlayback),
  { ssr: false, loading: () => null },
)
import { GraphicPlaybackProvider } from './graphic-player'
```

(The provider is tiny; importing it statically is fine. If it pulls `@remotion/player` into the board's first load because it shares the module, move the provider and hook into `graphic-playback.tsx` and import that statically instead.)

Wrap `VisualBoard`'s returned tree in `<GraphicPlaybackProvider>`. In `GraphicSlot`, below the preview and only when `brief.scene` is set:

```tsx
      {brief.scene ? (
        <GraphicPlayback
          slotId={slot.id}
          scene={brief.scene}
          brand={brand}
          logoUrls={slot.logoUrls}
          durationMs={slot.durationMs}
        />
      ) : null}
```

- [ ] **Step 6: Run**

Run (`timeout: 600000`): `cd apps/web && pnpm exec vitest run "app/(console)/projects"`; `pnpm typecheck`; `pnpm exec eslint apps/web packages/compositions --max-warnings 0`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/compositions/src/index.ts "apps/web/app/(console)/projects/[id]"
git commit -m "feat(board): play the real graphic, landscape or portrait, one at a time (decision 289)"
```

---

### Task 10: End to end, PROGRESS, and the full suite

**Files:**
- Modify: `e2e/tests/visual-plan.spec.ts` (the `a graphic slot (decision 268, Plan B)` describe, ~L190)
- Modify: `PROGRESS.md`

- [ ] **Step 1: Write the e2e test**

Inside the existing graphic describe, after its first test:

```ts
  test('a graphic card plays the real graphic and offers a redesign (decision 289)', async ({
    page,
  }) => {
    const resolved = page.locator('[id^="slot-"]').filter({ hasText: 'raised four billion' })
    await resolved.getByRole('button', { name: 'Play graphic' }).click()
    await expect(resolved.getByRole('region', { name: 'Graphic playback' })).toBeVisible()
    await resolved.getByRole('button', { name: 'Portrait' }).click()
    await expect(resolved.getByRole('button', { name: 'Landscape' })).toBeVisible()
    await resolved.getByRole('button', { name: 'Close player' }).click()

    await resolved.getByRole('button', { name: 'Redesign graphic' }).click()
    await expect(resolved.getByLabel('What should change? (optional)')).toBeVisible()
    // Stops at the ask, like the re-brief case in visual-board.spec.ts: the
    // e2e run has no Inngest to hand the work to.
    await expect(resolved.getByRole('button', { name: 'Redesign it' })).toBeVisible()
    await resolved.getByRole('button', { name: 'Cancel' }).click()
    await expectHitTargets(page)
  })
```

The seeded graphics predate intents, so the card's intent line shows their description; add `await expect(resolved.getByText(/^Intent: /)).toBeVisible()` to the first assertion block.

- [ ] **Step 2: Run the e2e file**

Run from the e2e package (memory: scoped runs from the root run everything): `cd e2e && pnpm exec playwright test tests/visual-plan.spec.ts` with `timeout: 600000`. Free port 3100 first if a previous run was interrupted.
Expected: PASS.

- [ ] **Step 3: PROGRESS**

Add decision 289 under the latest decisions (after 288), in the file's own voice: the owner's ask and rulings (spec 1.2), what shipped in stage 1 (intent in the shot list, the `graphics` route on Opus 5.5, one step per graphic with one reasoned retry, "Not designed" kept never dropped, the late-entrance rule enforced in the app, Redesign graphic, retype designing, the Fix button keeping designs, the board player with Portrait and one-at-a-time), what did not change (render, timeline schema, broker; no `deploy:remotion`), and what is next (stage 2's own spec after the owner has watched stage 1). Note the decision number is checked against `origin/master` at merge.

- [ ] **Step 4: Full verification**

Run the whole suite in the background with the session's `verify-merged.sh` (unit, typecheck, lint, format, e2e), Docker up, port 3100 free. Every failure is investigated, not re-run until green; a failure in a package this plan touched is this plan's regression until shown otherwise.
Expected: ALL GREEN.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/visual-plan.spec.ts PROGRESS.md
git commit -m "test(e2e): play and redesign a graphic; PROGRESS decision 289"
```
