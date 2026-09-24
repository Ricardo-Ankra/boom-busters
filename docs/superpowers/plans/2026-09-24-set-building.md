# Set Building Implementation Plan (decision 275)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a set's other views from one image with one Gemini 3 contact sheet and a room inventory, and let every shot inside a set take its own camera while the room stays consistent.

**Architecture:** Plates face compass directions (the first image faces north). A per-set room inventory (six labelled lines) describes every wall, drafted from the first plate by a vision call. "Build the set" makes one 2x2 contact sheet on the `setSheet` route and crops it into four direction-tagged candidates. Still briefs in a set carry a `camera` (facing, position, lens); generation sends the plates nearest that direction, labels each image with its direction, and closes the prompt with the camera and the in-frame and behind-camera inventory lines. A shared house photograph line and a longer banned-word list push output towards photographs.

**Tech Stack:** pnpm monorepo; TypeScript; Zod 4 (`packages/schemas`); Drizzle + Postgres (`packages/db`); provider adapters (`packages/providers`); Next.js App Router server actions and React client components (`apps/web`); `sharp` 0.35 (already an `apps/web` dependency) for cropping; Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-24-set-building-design.md`

## Global Constraints

- Mock providers by default: no test or dev run may call a paid API. Every paid call runs inside `withCost`.
- Pass the Bash tool's `timeout` parameter as 600000 for any suite run; never use background commands; run one database test suite at a time (the test DB is shared, and two runs hang on row locks).
- Start Docker Desktop before any DB-backed test (`pnpm db:migrate:test` needs it).
- Run `pnpm format:check` before every commit; lint-clean is not format-clean.
- A `'use server'` file exports only async functions; an exported const or type-only runtime value 500s every action in the segment.
- A phrase a test asserts in `direction-craft.md` must sit whole on one line of the markdown; after every edit to it run `pnpm --filter @boom-busters/providers embed:craft`.
- Gemini request fields, confirmed against Google's discovery document on 2026-09-24: `generationConfig.imageConfig.imageSize` takes `'1K' | '2K' | '4K'`; `generationConfig.thinkingConfig.thinkingLevel` takes `'HIGH'`, and the API errors if `thinkingConfig` is sent to a model without thinking, so it is sent to `gemini-3.1-flash-image` only. `imageSize` is sent to the Gemini 3 models only.
- User-facing copy uses South African English spelling.
- Commits end with: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Branch: `set-building` (already created; the spec is committed there).

## Review Focus

1. A set whose only plates are uploads recorded as `other` (the owner uploaded several photos before this decision): a faced shot must still send them. Pinned in Task 1 (`platesForCamera` falls back to `other`).
2. An owner's inventory written as free prose with no labels: it must still reach the prompt whole. Pinned in Task 2 (`parseLayout` rest) and Task 10 (`describeCamera` "The room:").
3. A still whose set has an inventory but no plate yet: its camera and inventory must still reach the prompt even though no image travels. Pinned in Task 10.
4. A contact sheet of a pale room, whose panels have near-white areas: the splitter must find the real gutter and not a pale wall. Pinned in Task 6.
5. The camera override on a linked (reuse) slot: refused like every other edit that would change a borrowed picture. Pinned in Task 12.

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `packages/schemas/src/sets.ts` | Compass views, legacy view preprocess, `platesForCamera`, `parseLayout`, `layoutView`, `ProjectSet.layout`, `MAX_SET_PLATES` 6 | 1, 2 |
| `packages/schemas/src/visuals.ts` | `SetCameraSchema`, `StillBriefSchema.camera` | 1 |
| `packages/schemas/src/settings.ts` | `modelRouting.setSheet` | 5 |
| `packages/schemas/src/direction.ts` | `shared-camera` craft finding | 11 |
| `packages/db/src/schema.ts`, `packages/db/src/sets.ts`, `packages/db/drizzle/0028_*.sql` | `layout` column and its read and write | 2 |
| `packages/db/src/settings-merge.ts` | Fold `setSheet` model ids | 5 |
| `packages/providers/src/visuals/types.ts` | `ImageSize`, `size`, `facing`, `pricesBySize`, `imageGenPrice(..., size)` | 4 |
| `packages/providers/src/visuals/gemini.ts` | `imageSize`, reasoning, per-size prices, direction labels, thought parts | 4 |
| `packages/providers/src/prompts/direction-craft.md` / `.ts` | `HOUSE_PHOTOGRAPH`, banned words, set section rewrite | 8, 9 |
| `packages/providers/src/prompts/shotlist.ts` | Inventory in the sets prefix, `camera` field, house line in the still template | 8, 9 |
| `apps/web/lib/set-plates.ts` | `setPlateBrief`, `buildSetSheetPrompt`, `describeCamera` (pure) | 1, 7, 8, 10 |
| `apps/web/lib/set-layout.ts` | `draftSetLayout` (vision call; mock in mock mode) | 3 |
| `apps/web/lib/contact-sheet.ts` | `splitContactSheet`, `mockContactSheet` | 6 |
| `apps/web/lib/set-sheet.ts` | `buildSetSheet` (generate, split, store) | 7 |
| `apps/web/lib/visual-assets.ts` | Plates by camera, `facing` on references, camera clause, `1K`, `setSheetEstimateUsd` | 7, 10 |
| `apps/web/app/(console)/projects/[id]/set-actions.ts` | View requests, layout save and draft, redraft, build the set | 1, 2, 3, 7 |
| `apps/web/app/(console)/projects/[id]/set-card.tsx` | Direction picker, inventory field, Redraft, Build the set | 1, 2, 3, 7 |
| `apps/web/app/(console)/projects/[id]/page.tsx` | View and sheet estimates | 1, 7 |
| `apps/web/app/(console)/projects/[id]/camera-row.tsx` | Board camera override | 12 |
| `apps/web/app/(console)/projects/[id]/visuals-actions.ts` | `editBriefAction` accepts `camera` | 12 |
| `apps/web/app/(console)/settings/settings-form.tsx` | Set sheets route row | 5 |
| `apps/web/inngest/lib/direction.ts` | Pass `layout` into the shot-list request | 9 |
| `apps/web/lib/still-prompt.ts`, `apps/web/lib/set-layout-prompt.ts` | Pure prompt builders moved out of database-bound modules | 13 |
| `apps/web/lib/live-budget.ts`, `apps/web/scripts/live-set-test.ts` | The live set harness and its $1 cap | 13 |
| `PROGRESS.md` | Decision 275 | 14 |

---

### Task 1: Compass plates, view requests and the camera schema

**Files:**
- Modify: `packages/schemas/src/sets.ts`
- Modify: `packages/schemas/src/visuals.ts:138-154` (`StillBriefSchema`)
- Modify: `packages/db/src/sets.ts` (plate-count message)
- Modify: `apps/web/lib/set-plates.ts`
- Modify: `apps/web/app/(console)/projects/[id]/set-actions.ts`
- Modify: `apps/web/app/(console)/projects/[id]/set-card.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx`
- Test: `packages/schemas/src/sets.test.ts`, `packages/schemas/src/visuals.test.ts` (or the file that tests `StillBriefSchema`; find it with `grep -rln "StillBriefSchema" packages/schemas/src/*.test.ts`), `apps/web/app/(console)/projects/[id]/set-card.test.tsx`, `apps/web/app/(console)/projects/[id]/set-actions.test.ts`

**Interfaces:**
- Produces (schemas): `SET_PLATE_DIRECTIONS = ['north','east','south','west'] as const`; `type SetPlateDirection`; `SetPlateDirectionSchema`; `SET_VIEW_REQUESTS = [...SET_PLATE_DIRECTIONS, 'detail'] as const`; `type SetViewRequest`; `SetViewRequestSchema`; `SET_PLATE_VIEWS = [...SET_PLATE_DIRECTIONS, 'detail', 'other'] as const`; `SetPlateViewSchema` (preprocesses `establishing`→`north`, `reverse`→`south`, `side`→`east`); `uploadedPlateView(set): SetPlateView` (`north` first, then `other`); `referencePlates(set, limit)`; `platesForCamera(set, facing: SetPlateDirection | undefined, limit): SetPlate[]`; `OPPOSITE_DIRECTION: Record<SetPlateDirection, SetPlateDirection>`; `MAX_SET_PLATES = 6`; `SetCameraSchema`, `type SetCamera = { facing: SetPlateDirection; position: string; lens?: string }`; `StillBrief.camera?: SetCamera`.
- Produces (web): `setPlateBrief(set, view: SetViewRequest, styleAnchors: string): StillBrief`; `generateSetPlateAction(setId, view: SetViewRequest = 'north')`; card prop `viewEstimatesUsd?: Readonly<Record<string, number>>`; card batch type `{ list: SlotCandidate[]; views: SetPlateView[] }` (one view per candidate, used by Task 7).
- Removes: `SET_PLATE_ANGLES`, `SetPlateAngle`, `SetPlateAngleSchema`, `angleEstimatesUsd`.

- [ ] **Step 1: Write the failing schema tests** in `packages/schemas/src/sets.test.ts`. Replace the `referencePlates` and `uploadedPlateView` describes, and change the fixture helper's default views (`plate('establishing')` becomes `plate('north')`, `plate('detail')` stays):

```ts
describe('plate views', () => {
  it('reads the decision 273/274 names as compass directions', () => {
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'establishing' }).view).toBe('north')
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'reverse' }).view).toBe('south')
    expect(SetPlateSchema.parse({ ...plate('north'), view: 'side' }).view).toBe('east')
    expect(SetPlateSchema.safeParse({ ...plate('north'), view: 'sideways' }).success).toBe(false)
  })

  it('holds six plates: four directions and two details', () => {
    expect(MAX_SET_PLATES).toBe(6)
    const seven = { ...set, plates: [1, 2, 3, 4, 5, 6, 7].map((n) => plate('other', `h${n}`)) }
    expect(ProjectSetSchema.safeParse(seven).success).toBe(false)
  })
})

describe('referencePlates', () => {
  it('sends north first and honours the limit', () => {
    expect(referencePlates(set, 2).map((p) => p.view)).toEqual(['north', 'detail'])
    expect(referencePlates(set, 1).map((p) => p.view)).toEqual(['north'])
    expect(referencePlates(set, 0)).toEqual([])
  })

  it('prefers a second direction over a detail, whatever the upload order', () => {
    const plates = [plate('north'), plate('detail'), plate('south')]
    expect(referencePlates({ plates }, 2).map((p) => p.view)).toEqual(['north', 'south'])
  })
})

describe('platesForCamera', () => {
  const full = [plate('north'), plate('east'), plate('south'), plate('west'), plate('detail')]

  it('sends the facing plate, then an adjacent one, never the opposite', () => {
    expect(platesForCamera({ plates: full }, 'north', 2).map((p) => p.view)).toEqual([
      'north',
      'east',
    ])
    expect(platesForCamera({ plates: full }, 'south', 2).map((p) => p.view)).toEqual([
      'south',
      'west',
    ])
    expect(platesForCamera({ plates: full }, 'east', 3).map((p) => p.view)).toEqual([
      'east',
      'south',
      'north',
    ])
  })

  it('uses an adjacent plate when the facing one is missing', () => {
    const plates = [plate('north'), plate('west')]
    expect(platesForCamera({ plates }, 'south', 2).map((p) => p.view)).toEqual(['west'])
  })

  it('sends the only plate a set has, even facing away from it', () => {
    expect(platesForCamera({ plates: [plate('north')] }, 'south', 2).map((p) => p.view)).toEqual([
      'north',
    ])
  })

  // Review Focus 1: uploads from before this decision are `other`.
  it('sends plates whose direction nobody stated', () => {
    const plates = [plate('other', 'o1'), plate('other', 'o2')]
    expect(platesForCamera({ plates }, 'east', 2).map((p) => p.contentHash)).toEqual(['o1', 'o2'])
  })

  it('falls back to referencePlates with no camera', () => {
    expect(platesForCamera({ plates: full }, undefined, 2).map((p) => p.view)).toEqual([
      'north',
      'south',
    ])
  })
})

describe('uploadedPlateView', () => {
  it("records a set's first upload as north and later ones as other", () => {
    expect(uploadedPlateView({ plates: [] })).toBe('north')
    expect(uploadedPlateView({ plates: [plate('north')] })).toBe('other')
  })
})
```

Update the imports at the top of the file to include `platesForCamera` and keep `uploadedPlateView`, `referencePlates`, `MAX_SET_PLATES`, `ProjectSetSchema`, `SetPlateSchema`, `setForBrief`.

Add to the file that tests `StillBriefSchema`:

```ts
describe('StillBriefSchema camera (decision 275)', () => {
  const still = {
    type: 'still',
    coversText: 'The board met.',
    description: 'The board at the table.',
    shotSize: 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    prompt: 'The board at the table.',
    set: 'The boardroom',
  }

  it('keeps a well-formed camera', () => {
    const camera = { facing: 'south', position: 'the north windows, seated height', lens: '35mm' }
    expect(StillBriefSchema.parse({ ...still, camera }).camera).toEqual(camera)
  })

  it('drops a malformed camera and keeps the brief', () => {
    const parsed = StillBriefSchema.parse({ ...still, camera: { facing: 'up', position: '' } })
    expect(parsed.camera).toBeUndefined()
    expect(parsed.prompt).toBe(still.prompt)
  })
})
```

- [ ] **Step 2: Run the schema tests to see them fail**

Run: `cd packages/schemas && npx vitest run sets visuals`
Expected: FAIL (`platesForCamera` is not exported; views reject `north`).

- [ ] **Step 3: Implement in `packages/schemas/src/sets.ts`.** Replace the `SET_PLATE_ANGLES` block, the `SET_PLATE_VIEWS` block, `uploadedPlateView`, `MAX_SET_PLATES`, `VIEW_RANK` and `referencePlates` with:

```ts
/**
 * Which way a plate's camera faces (decision 275). A set's first image
 * defines north: whatever it looks at is the north wall, and the others
 * follow clockwise seen from above. Directions, not angle names, because a
 * planner can place a camera by a direction and cannot by "reverse".
 */
export const SET_PLATE_DIRECTIONS = ['north', 'east', 'south', 'west'] as const
export const SetPlateDirectionSchema = z.enum(SET_PLATE_DIRECTIONS)
export type SetPlateDirection = z.infer<typeof SetPlateDirectionSchema>

export const OPPOSITE_DIRECTION: Record<SetPlateDirection, SetPlateDirection> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

/** The two directions either side, clockwise first. */
const ADJACENT_DIRECTIONS: Record<SetPlateDirection, readonly [SetPlateDirection, SetPlateDirection]> = {
  north: ['east', 'west'],
  east: ['south', 'north'],
  south: ['west', 'east'],
  west: ['north', 'south'],
}

/** What "Generate a view" may ask for: a direction, or a close detail. */
export const SET_VIEW_REQUESTS = [...SET_PLATE_DIRECTIONS, 'detail'] as const
export const SetViewRequestSchema = z.enum(SET_VIEW_REQUESTS)
export type SetViewRequest = z.infer<typeof SetViewRequestSchema>

/**
 * A plate's view: a direction, a close detail, or `other` for an upload whose
 * direction nobody stated. Plates stored under decisions 273 and 274's names
 * are read forward here, so nothing in the database is migrated.
 */
export const SET_PLATE_VIEWS = [...SET_PLATE_DIRECTIONS, 'detail', 'other'] as const
const LEGACY_PLATE_VIEWS: Record<string, (typeof SET_PLATE_VIEWS)[number]> = {
  establishing: 'north',
  reverse: 'south',
  side: 'east',
}
export const SetPlateViewSchema = z.preprocess(
  (value) => (typeof value === 'string' && value in LEGACY_PLATE_VIEWS ? LEGACY_PLATE_VIEWS[value] : value),
  z.enum(SET_PLATE_VIEWS),
)
export type SetPlateView = z.infer<typeof SetPlateViewSchema>

/**
 * The view an uploaded plate is recorded as (decisions 274, 275): a set's
 * first plate defines north; anything after it is `other` until someone says.
 */
export function uploadedPlateView(set: Pick<ProjectSet, 'plates'>): SetPlateView {
  return set.plates.length === 0 ? 'north' : 'other'
}

/** Four directions and two details (decision 275). At most two travel with a still. */
export const MAX_SET_PLATES = 6
```

and, where `referencePlates` was:

```ts
const VIEW_RANK: Record<SetPlateView, number> = {
  north: 0,
  south: 1,
  east: 2,
  west: 3,
  other: 4,
  detail: 5,
}

/** The best plate of each view first, in `order`, then second plates of a view already taken. */
function distinctFirst(plates: readonly SetPlate[], limit: number): SetPlate[] {
  const seen = new Set<SetPlateView>()
  const distinct: SetPlate[] = []
  const repeats: SetPlate[] = []
  for (const plate of plates) {
    if (seen.has(plate.view)) repeats.push(plate)
    else {
      seen.add(plate.view)
      distinct.push(plate)
    }
  }
  return [...distinct, ...repeats].slice(0, Math.max(0, limit))
}

/**
 * The plates sent with a still that has no camera, at most `limit`
 * (decision 274, directions from 275): two different viewpoints before a
 * second copy of one. Upload order breaks ties.
 */
export function referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[] {
  const ranked = set.plates
    .map((plate, at) => ({ plate, at }))
    .sort((a, b) => VIEW_RANK[a.plate.view] - VIEW_RANK[b.plate.view] || a.at - b.at)
    .map(({ plate }) => plate)
  return distinctFirst(ranked, limit)
}

/**
 * The plates sent with a still whose camera faces `facing` (decision 275):
 * the plate facing the same way, then the adjacent directions, then details,
 * then undirected uploads. Never the opposite direction's plate, which shows
 * what is behind the camera, unless it is all the set holds: a set with one
 * plate sends it whatever the camera faces, and the inventory carries the rest.
 */
export function platesForCamera(
  set: Pick<ProjectSet, 'plates'>,
  facing: SetPlateDirection | undefined,
  limit: number,
): SetPlate[] {
  if (facing === undefined) return referencePlates(set, limit)
  const order: SetPlateView[] = [facing, ...ADJACENT_DIRECTIONS[facing], 'detail', 'other']
  const ordered = order.flatMap((view) => set.plates.filter((plate) => plate.view === view))
  const chosen = distinctFirst(ordered, limit)
  return chosen.length > 0 ? chosen : referencePlates(set, limit)
}
```

Update the `SetPlateSchema.view` field to `view: SetPlateViewSchema` (it already is) and the `plates` cap message comment to "At most six".

In `packages/schemas/src/visuals.ts`, above `StillBriefSchema`, import `SetPlateDirectionSchema` from `./sets` and add:

```ts
/**
 * Where the camera stands in a set (decision 275). Written by the planner for
 * every still that names a set, and overridable per slot on the board.
 */
export const SetCameraSchema = z.object({
  facing: SetPlateDirectionSchema,
  position: z.string().trim().min(3).max(120),
  lens: z.string().trim().min(1).max(40).optional(),
})
export type SetCamera = z.infer<typeof SetCameraSchema>
```

and inside `StillBriefSchema`, after `set`:

```ts
  /**
   * Where the camera stands in `set` (decision 275). A malformed camera is
   * dropped, never fatal: a brief that plans without one still plans.
   */
  camera: SetCameraSchema.optional().catch(undefined),
```

If `./sets` importing from `./visuals` or vice versa creates a cycle, move `SetCameraSchema` into `sets.ts` and import it into `visuals.ts` instead; export it from the package index either way.

- [ ] **Step 4: Run the schema tests to see them pass**

Run: `cd packages/schemas && npx vitest run`
Expected: PASS (all files).

- [ ] **Step 5: Move the web code from angles to view requests.**

`packages/db/src/sets.ts`: the `setSetPlates` doc comment says "At most four"; change it to "At most six". Its error already interpolates `MAX_SET_PLATES`.

`apps/web/lib/set-plates.ts`: replace `ANGLE_FRAMING` and the `setPlateBrief` signature:

```ts
import { OPPOSITE_DIRECTION } from '@boom-busters/schemas'
import type { ProjectSet, SetViewRequest, StillBrief } from '@boom-busters/schemas'

/** The first plate: the room seen whole, before any direction exists. */
const FIRST_PLATE_FRAMING =
  'a wide establishing photograph of the whole room, taken from its entrance at eye level'

const VIEW_FRAMING: Record<SetViewRequest, string> = {
  north: 'a wide photograph of the whole room facing north',
  east: 'a wide photograph of the whole room facing east',
  south: 'a wide photograph of the whole room facing south',
  west: 'a wide photograph of the whole room facing west',
  detail:
    "a close photograph of one part of the room, its furniture, surfaces and materials at arm's length",
}

export function setPlateBrief(
  set: Pick<ProjectSet, 'name' | 'look' | 'plates'>,
  view: SetViewRequest,
  styleAnchors: string,
): StillBrief {
  const referenced = set.plates.length > 0
  const framing = referenced ? VIEW_FRAMING[view] : FIRST_PLATE_FRAMING
  // A compass view of a plated set is shot from the middle of the opposite
  // wall, so the camera sentence and the plates nearest it travel (Task 10).
  const camera =
    referenced && view !== 'detail'
      ? {
          facing: view,
          position: `the middle of the ${OPPOSITE_DIRECTION[view]} wall, at eye level`,
          lens: '24mm',
        }
      : undefined
  return {
    type: 'still',
    coversText: set.name,
    description: set.look,
    shotSize: view === 'detail' ? 'close' : 'wide',
    motion: { kind: 'static' },
    transition: 'cut',
    ...(referenced ? { set: set.name } : {}),
    ...(camera ? { camera } : {}),
    // A plate is the room, not a scene in it: people belong to the stills.
    prompt: `${set.name}, empty of people: ${framing}. ${set.look} ${styleAnchors}`,
    negativePrompt: 'people, figures',
  }
}
```

Keep the module's header comment, updating "angle" to "view".

`apps/web/app/(console)/projects/[id]/set-actions.ts`:
- imports: replace `SetPlateAngleSchema` with `SetViewRequestSchema`, and the type `SetPlateAngle` with `SetViewRequest`;
- `generateSetPlateAction(setId: string, view: SetViewRequest = 'north')`: parse with `SetViewRequestSchema` (error `'Unknown view.'`); when `set.plates.length === 0 && parsedView.data !== 'north'` answer `{ ok: false, error: 'Another view needs a plate to work from. Add or generate the first one.' }`; call `setPlateBrief(set, parsedView.data, stillStyleAnchors(settings.brandKit))`;
- every hard-coded "A set keeps at most four plates; remove one first." becomes `` `A set keeps at most ${MAX_SET_PLATES} plates; remove one first.` ``.

`apps/web/app/(console)/projects/[id]/set-card.tsx`:
- import `SET_VIEW_REQUESTS` (in place of `SET_PLATE_ANGLES`) and the types `SetPlateView`, `SetViewRequest`;
- `VIEW_LABELS` becomes `{ north: 'North', east: 'East', south: 'South', west: 'West', detail: 'Detail', other: 'Other' }`;
- `ANGLE_LABELS` becomes `VIEW_REQUEST_LABELS: Record<SetViewRequest, string> = { north: "North, the first plate's view", east: 'East', south: 'South, the reverse', west: 'West', detail: 'Detail, close on the furniture' }`;
- `CandidateBatch` becomes `interface CandidateBatch { list: SlotCandidate[]; views: SetPlateView[] }` (one view per candidate);
- the prop `angleEstimatesUsd` becomes `viewEstimatesUsd`;
- row state `angle`/`setAngle` becomes `view`/`setView` of type `SetViewRequest`, default `'south'`;
- the choose call passes `...(batch?.views[index] ? { view: batch.views[index] } : {})`, so `choose` takes `(candidate, index)`; the strip passes `index` and the lightbox passes `candidates.indexOf(candidate)`;
- the picker: `aria-label={`View of the next generated plate of ${set.name}`}`, options from `SET_VIEW_REQUESTS` with `VIEW_REQUEST_LABELS`, disabled with value `'north'` while `!plated`;
- the button text is `` `${plated ? 'Generate a view' : 'Generate a plate'} · ≈$${plateEstimateUsd.toFixed(2)}` ``; on press it asks `plated ? view : 'north'` and stores `onBatch({ list, views: list.map(() => asked) })`;
- the hint under the row becomes "Add a plate first, then build the set from it."

`apps/web/app/(console)/projects/[id]/page.tsx`: the estimate loop calls `setPlateBrief(set, 'south', '')` and passes `viewEstimatesUsd={viewEstimates}` (rename the local `angleEstimates` to `viewEstimates`).

- [ ] **Step 6: Update the web tests.** In `set-card.test.tsx`: `view: 'establishing'` in fixtures becomes `'north'`; `'Generate another angle'` becomes `'Generate a view'`; the combobox name `Angle of the next generated plate of …` becomes `View of the next generated plate of …`; the default choose `view: 'reverse'` becomes `view: 'south'`; the reverse-caption test uses `view: 'south'` and expects `'Remove south plate of The trading floor'`; the empty-set test expects the hint `'Add a plate first, then build the set from it.'`; `angleEstimatesUsd` becomes `viewEstimatesUsd`; the detail test still expects `view: 'detail'`. In `set-actions.test.ts`: `generateSetPlateAction(id, 'reverse')` becomes `'south'` and asserts `request?.prompt` contains `'a wide photograph of the whole room facing south'`; the refusal test uses `'east'` and the new message; the first-plate test expects `'The trading floor, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level'`; the upload-view test expects `['north', 'other']`; the address test expects `'north'`.

- [ ] **Step 7: Run typecheck and the affected suites**

Run: `pnpm typecheck` then `cd apps/web && npx vitest run set-card.test set-actions.test visual-assets.test` (Bash `timeout` 600000; Docker running)
Expected: typecheck clean; all PASS. Fix any other type error the view rename surfaces (search `establishing` across `apps/web` and `packages`).

- [ ] **Step 8: Commit**

```bash
pnpm format:check
git add packages/schemas packages/db/src/sets.ts apps/web
git commit -m "feat(sets): plates face compass directions, and still briefs carry a camera (decision 275)"
```

---

### Task 2: The room inventory, stored and edited

**Files:**
- Modify: `packages/db/src/schema.ts:686-711` (`projectSets`)
- Create: `packages/db/drizzle/0028_<generated>.sql` (via `pnpm db:generate`)
- Modify: `packages/db/src/sets.ts` (`toSet`, `updateProjectSet`)
- Modify: `packages/schemas/src/sets.ts` (`ProjectSetSchema.layout`, `parseLayout`, `layoutView`)
- Modify: `apps/web/app/(console)/projects/[id]/set-actions.ts` (`updateSetAction`)
- Modify: `apps/web/app/(console)/projects/[id]/set-card.tsx`
- Test: `packages/schemas/src/sets.test.ts`, `packages/db/src/sets.integration.test.ts`, `apps/web/app/(console)/projects/[id]/set-card.test.tsx`

**Interfaces:**
- Consumes: `SetPlateDirection`, `OPPOSITE_DIRECTION` (Task 1).
- Produces: `ProjectSet.layout: string` (default `''`, max 1500); `interface RoomLayout { north?: string; east?: string; south?: string; west?: string; centre?: string; light?: string; rest: string }`; `parseLayout(text: string): RoomLayout`; `interface LayoutView { inFrame?: string; edges: string[]; behind?: string; centre?: string; light?: string; rest: string }`; `layoutView(layout: RoomLayout, facing: SetPlateDirection): LayoutView`; `updateProjectSet(db, id, patch: Partial<Pick<ProjectSet,'name'|'look'|'layout'>>)`; `updateSetAction(setId, patch: { name?; look?; layout? })`.

- [ ] **Step 1: Failing schema tests** in `packages/schemas/src/sets.test.ts`:

```ts
describe('parseLayout', () => {
  const text = [
    'North wall: three tall windows, overcast city view.',
    'east: walnut credenza, door at the south end',
    'South Wall: glass wall onto the corridor.',
    'West wall: bare concrete, a dark screen.',
    'Center: ten-seat walnut table, black mesh chairs.',
    'Light: overcast daylight from the north windows.',
  ].join('\n')

  it('reads each labelled line, whatever its case, and drops the full stop', () => {
    expect(parseLayout(text)).toEqual({
      north: 'three tall windows, overcast city view',
      east: 'walnut credenza, door at the south end',
      south: 'glass wall onto the corridor',
      west: 'bare concrete, a dark screen',
      centre: 'ten-seat walnut table, black mesh chairs',
      light: 'overcast daylight from the north windows',
      rest: '',
    })
  })

  // Review Focus 2: an owner may write prose with no labels.
  it('keeps unlabelled text whole as the rest', () => {
    expect(parseLayout('A long table.\nWindows behind it.')).toEqual({
      rest: 'A long table. Windows behind it.',
    })
  })
})

describe('layoutView', () => {
  it('puts the facing wall in frame, its neighbours at the edges and the opposite behind', () => {
    const view = layoutView(
      parseLayout('North wall: windows\nEast wall: credenza\nSouth wall: glass\nWest wall: concrete'),
      'south',
    )
    // Facing south, the adjacent walls are west then east.
    expect(view).toEqual({
      inFrame: 'glass',
      edges: ['concrete', 'credenza'],
      behind: 'windows',
      rest: '',
    })
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/schemas && npx vitest run sets`
Expected: FAIL (`parseLayout` not exported).

- [ ] **Step 3: Implement in `packages/schemas/src/sets.ts`.** In `ProjectSetSchema` add `layout: z.string().max(1500).default('')`. Then:

```ts
/**
 * A set's room inventory, read line by line (decision 275). Six labels are
 * known: the four walls, the centre, the light. Anything else is kept whole
 * as `rest`, so an owner who writes prose loses nothing.
 */
export interface RoomLayout {
  north?: string
  east?: string
  south?: string
  west?: string
  centre?: string
  light?: string
  rest: string
}

const LAYOUT_LINE =
  /^\s*(north|east|south|west|centre|center|light)(?:\s+wall)?\s*:\s*(.+?)\s*\.?\s*$/i

export function parseLayout(text: string): RoomLayout {
  const layout: RoomLayout = { rest: '' }
  const rest: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const match = LAYOUT_LINE.exec(line)
    if (!match) {
      rest.push(line.trim())
      continue
    }
    const label = match[1]!.toLowerCase()
    const key = (label === 'center' ? 'centre' : label) as Exclude<keyof RoomLayout, 'rest'>
    layout[key] = match[2]!
  }
  layout.rest = rest.join(' ')
  return layout
}

export interface LayoutView {
  inFrame?: string
  edges: string[]
  behind?: string
  centre?: string
  light?: string
  rest: string
}

/** What a camera facing `facing` sees of the room, and what is behind it. */
export function layoutView(layout: RoomLayout, facing: SetPlateDirection): LayoutView {
  const view: LayoutView = {
    edges: ADJACENT_DIRECTIONS[facing]
      .map((direction) => layout[direction])
      .filter((line): line is string => line !== undefined),
    rest: layout.rest,
  }
  if (layout[facing] !== undefined) view.inFrame = layout[facing]
  const behind = layout[OPPOSITE_DIRECTION[facing]]
  if (behind !== undefined) view.behind = behind
  if (layout.centre !== undefined) view.centre = layout.centre
  if (layout.light !== undefined) view.light = layout.light
  return view
}
```

Fix the `layoutView` test so a key absent from the layout is absent from the result (the test's `toEqual` with no `centre`/`light` keys relies on that).

- [ ] **Step 4: Schema tests pass**

Run: `cd packages/schemas && npx vitest run`
Expected: PASS.

- [ ] **Step 5: The column.** In `packages/db/src/schema.ts`, in `projectSets` after `look`:

```ts
    /**
     * The room inventory (decision 275): one line per wall, then Centre and
     * Light. Drafted from the first plate, corrected by the owner, and sent
     * with every shot in this room so walls no plate shows stay consistent.
     */
    layout: text('layout').notNull().default(''),
```

Run: `pnpm db:generate`
Expected: a new `packages/db/drizzle/0028_*.sql` containing exactly `ALTER TABLE "project_sets" ADD COLUMN "layout" text DEFAULT '' NOT NULL;` (plus the meta snapshot and journal updates). Open it and confirm nothing else changed.

Run: `pnpm db:migrate:test` (Docker running)
Expected: migration applied.

- [ ] **Step 6: Read and write it.** In `packages/db/src/sets.ts`, `toSet` passes `layout: row.layout`; `updateProjectSet` accepts `'layout'` in its patch type and adds:

```ts
  if (patch.layout !== undefined) {
    const layout = patch.layout.trim()
    if (layout.length > 1500) {
      throw new ValidationError('The room inventory is at most 1,500 characters.', {
        field: 'layout',
      })
    }
    values.layout = layout
  }
```

Add to `packages/db/src/sets.integration.test.ts`:

```ts
  it('stores and trims a room inventory, and refuses one over 1,500 characters', async () => {
    const set = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name: 'Inventory room' })
    expect(set.layout).toBe('')
    const updated = await updateProjectSet(db, set.id, { layout: '  North wall: windows  ' })
    expect(updated.layout).toBe('North wall: windows')
    await expect(updateProjectSet(db, set.id, { layout: 'x'.repeat(1501) })).rejects.toThrow(
      /at most 1,500/,
    )
  })
```

Use the suite's existing fixture project and cleanup pattern (read the file's `beforeEach` first; add `'Inventory room'` to whatever names it clears).

Run: `cd packages/db && npx vitest run sets` (Bash `timeout` 600000)
Expected: PASS.

- [ ] **Step 7: The card field and the save action.** `updateSetAction(setId, patch: { name?: string; look?: string; layout?: string })` passes `layout` through unchanged (the db function validates). In `set-card.tsx` `SetRow`, add state and a textarea after Look:

```tsx
  const [layout, setLayout] = React.useState(set.layout)
  // The server drafts the inventory after the first plate lands (Task 3), so
  // a changed stored value replaces the field.
  React.useEffect(() => setLayout(set.layout), [set.layout])
```

```tsx
      <div className="space-y-1">
        <Label htmlFor={`set-${set.id}-layout`}>Room inventory</Label>
        <textarea
          id={`set-${set.id}-layout`}
          rows={6}
          maxLength={1500}
          value={layout}
          onChange={(event) => setLayout(event.target.value)}
          placeholder={'North wall: …\nEast wall: …\nSouth wall: …\nWest wall: …\nCentre: …\nLight: …'}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-[12px]"
        />
        <p className="text-[12px] text-[var(--color-text-muted)]">
          One line per wall, then Centre and Light. It travels with every shot in this room, so
          walls no plate shows stay the same.
        </p>
      </div>
```

The Save button's patch gains `if (layout !== set.layout) patch.layout = layout` (widen its type to include `layout`). Update every `ProjectSet` fixture in `set-card.test.tsx` with `layout: ''` and add:

```tsx
  it('saves an edited room inventory with the rest of the set', async () => {
    render(<SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.type(screen.getByLabelText('Room inventory'), 'North wall: windows')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.updateSetAction).toHaveBeenCalledWith(TRADING_FLOOR, {
      layout: 'North wall: windows',
    })
  })
```

- [ ] **Step 8: Run and commit**

Run: `pnpm typecheck` then `cd apps/web && npx vitest run set-card.test set-actions.test` (Bash `timeout` 600000)
Expected: PASS. Fix other `ProjectSet` fixtures the new required field breaks (search `plates: [` in `apps/web` test files that build a `ProjectSet`).

```bash
pnpm format:check
git add packages/db packages/schemas apps/web
git commit -m "feat(sets): each set keeps a room inventory, one line per wall (decision 275)"
```

---

### Task 3: Draft the inventory from the first plate

**Files:**
- Create: `apps/web/lib/set-layout.ts`
- Modify: `apps/web/app/(console)/projects/[id]/set-actions.ts`
- Modify: `apps/web/app/(console)/projects/[id]/set-card.tsx`
- Test: `apps/web/app/(console)/projects/[id]/set-actions.test.ts`, `apps/web/app/(console)/projects/[id]/set-card.test.tsx`

**Interfaces:**
- Consumes: `ProjectSet.layout`, `updateProjectSet` (Task 2); `platesForCamera` (Task 1).
- Produces: `MOCK_LAYOUT: string`; `draftSetLayout(input: { projectId: string; name: string; look: string; plate: SetPlate }): Promise<string | null>`; `redraftSetLayoutAction(setId: string): Promise<ActionResult & { layout?: string }>`.

- [ ] **Step 1: Failing action tests** in `set-actions.test.ts` (mock mode, DB):

```ts
  it('drafts the room inventory when the first plate lands, and never overwrites it', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({ setId: id, mimeType: 'image/jpeg', contentHash: HASH_A, width: 10, height: 10 })
    let [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe(MOCK_LAYOUT)

    await updateSetAction(id, { layout: 'North wall: my own words' })
    await finaliseSetPlateAction({ setId: id, mimeType: 'image/jpeg', contentHash: HASH_B, width: 10, height: 10 })
    ;[set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe('North wall: my own words')
  })

  it('redrafts the inventory on request, replacing the owner’s edits', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({ setId: id, mimeType: 'image/jpeg', contentHash: HASH_A, width: 10, height: 10 })
    await updateSetAction(id, { layout: 'North wall: my own words' })
    expect(await redraftSetLayoutAction(id)).toEqual({ ok: true, layout: MOCK_LAYOUT })
    const [set] = await listProjectSets(db, FIXTURE_PROJECT_ID)
    expect(set?.layout).toBe(MOCK_LAYOUT)
  })

  it('refuses to redraft a set with no plate', async () => {
    const id = await addTradingFloor()
    expect(await redraftSetLayoutAction(id)).toEqual({
      ok: false,
      error: 'Add a plate first; the inventory is drafted from it.',
    })
  })
```

Import `MOCK_LAYOUT` from `@/lib/set-layout` and `redraftSetLayoutAction`, `updateSetAction` from `./set-actions`.

- [ ] **Step 2: Run to fail**

Run: `cd apps/web && npx vitest run set-actions.test` (Bash `timeout` 600000)
Expected: FAIL (module `@/lib/set-layout` not found).

- [ ] **Step 3: Implement `apps/web/lib/set-layout.ts`:**

```ts
import { mockProvidersEnabled } from '@boom-busters/providers'
import type { SetPlate } from '@boom-busters/schemas'
import { callLlm } from '@/lib/llm'
import { getObjectBytes } from '@/lib/storage'

/**
 * The room inventory, drafted from a set's first plate (decision 275): one
 * vision call on the `shotlist` route, a picture-planning task, well under a
 * cent. The owner corrects it once; after that it travels with every shot
 * in the room, so walls no plate shows stay the same wall.
 */

/** What mock mode drafts: fixed, so tests can assert it. */
export const MOCK_LAYOUT = [
  'North wall: [mock] three tall windows, overcast city view.',
  'East wall: [mock] walnut credenza, a door at the south end.',
  'South wall: [mock] glass wall onto the corridor.',
  'West wall: [mock] bare concrete, a dark wall screen.',
  'Centre: [mock] a long walnut table, black mesh chairs, an open laptop.',
  'Light: [mock] overcast daylight from the north windows.',
].join('\n')

const SYSTEM =
  "You describe rooms for a documentary's art department. You write what a location scout " +
  'would note, plainly, and nothing else.'

function request(name: string, look: string): string {
  return (
    `This photograph shows ${name}, facing north.` +
    (look.trim() ? ` The room's look: ${look.trim()}.` : '') +
    ' Write the room inventory as exactly six lines, each starting with its label: ' +
    '"North wall:", "East wall:", "South wall:", "West wall:", "Centre:", "Light:". ' +
    'North is the wall this photograph faces; east is to its right. Describe fixed things ' +
    'only: architecture, furniture, fittings, materials, light sources; no people. Describe ' +
    'the walls the photograph shows as they are, and invent the unseen walls plausibly and ' +
    'consistently with it. At most 25 words per line. Reply with the six lines only.'
  )
}

/** The drafted inventory, or null when the call or the storage read fails. */
export async function draftSetLayout(input: {
  projectId: string
  name: string
  look: string
  plate: SetPlate
}): Promise<string | null> {
  if (mockProvidersEnabled()) return MOCK_LAYOUT
  try {
    const object = await getObjectBytes(input.plate.r2Key)
    const result = await callLlm(
      {
        task: 'shotlist',
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: request(input.name, input.look),
            images: [
              { mimeType: input.plate.mimeType, data: Buffer.from(object.bytes).toString('base64') },
            ],
          },
        ],
        maxTokens: 600,
      },
      { projectId: input.projectId },
    )
    const text = result.text.trim().slice(0, 1500)
    return text === '' ? null : text
  } catch (error) {
    console.error('[sets] inventory draft failed', error)
    return null
  }
}
```

Check `mockProvidersEnabled`'s real import path first (`grep -n "mockProvidersEnabled" apps/web/inngest/lib/direction.ts`) and use the same one. Check `getObjectBytes`' return shape in `apps/web/lib/storage.ts` and match it.

- [ ] **Step 4: Wire it into the actions.** In `set-actions.ts` add a private helper and call it after each successful `setSetPlates` in `finaliseSetPlateAction`, `addSetPlateFromUrlAction` and `chooseSetPlateAction`, passing the set as it was before the plate was added and the new plate:

```ts
/**
 * Draft the inventory when a set's first plate lands, unless the owner has
 * already written one (decision 275). Failure leaves the field empty; the
 * card says so and offers Redraft.
 */
async function draftLayoutIfFirst(before: ProjectSet, plate: SetPlate): Promise<void> {
  if (before.plates.length > 0 || before.layout.trim() !== '') return
  const layout = await draftSetLayout({
    projectId: before.projectId,
    name: before.name,
    look: before.look,
    plate,
  })
  if (layout === null) return
  const current = await getProjectSet(db, before.id)
  if (current && current.layout.trim() === '') await updateProjectSet(db, before.id, { layout })
}

export async function redraftSetLayoutAction(
  setId: string,
): Promise<ActionResult & { layout?: string }> {
  await requireOwner()
  const invalid = badIds(setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  const [plate] = platesForCamera(set, 'north', 1)
  if (!plate) return { ok: false, error: 'Add a plate first; the inventory is drafted from it.' }
  const layout = await draftSetLayout({ projectId: set.projectId, name: set.name, look: set.look, plate })
  if (layout === null) {
    return { ok: false, error: 'The inventory could not be drafted. Try again, or write it by hand.' }
  }
  await updateProjectSet(db, set.id, { layout })
  refresh(set.projectId)
  return { ok: true, layout }
}
```

`draftLayoutIfFirst` is not exported (a `'use server'` file exports only async functions, and this one must not be callable from the browser). Call it before `refresh(...)` in each action.

- [ ] **Step 5: The card.** Beside the inventory textarea's helper line, add:

```tsx
        {set.plates.length > 0 && set.layout.trim() === '' ? (
          <p className="text-[12px] text-[var(--color-warning)]" role="status">
            The inventory could not be drafted; write it, or press Redraft from plate.
          </p>
        ) : null}
        {set.plates.length > 0 ? (
          <ConfirmButton
            variant="outline"
            busy={rowBusy}
            label="Redraft from plate"
            confirmLabel="Replace the inventory"
            consequence="It is drafted again from the first plate, and your edits to it are lost."
            onConfirm={() =>
              act(`${set.id}:layout`, () => redraftSetLayoutAction(set.id), 'Inventory redrafted', (result) =>
                setLayout((result as { layout?: string }).layout ?? layout),
              )
            }
          />
        ) : null}
```

Widen `ActResult` to `ActionResult & { candidates?: SlotCandidate[]; layout?: string }` so the cast is unnecessary, and add `redraftSetLayoutAction` to the card's imports and to the test file's hoisted `actions` mock. Card test:

```tsx
  it('redrafts the inventory only after a confirm', async () => {
    actions.redraftSetLayoutAction.mockResolvedValue({ ok: true, layout: 'North wall: drafted' })
    render(<SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Redraft from plate' }))
    expect(actions.redraftSetLayoutAction).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Replace the inventory' }))
    expect(actions.redraftSetLayoutAction).toHaveBeenCalledWith(TRADING_FLOOR)
    expect(screen.getByLabelText('Room inventory')).toHaveValue('North wall: drafted')
  })
```

- [ ] **Step 6: Run and commit**

Run: `cd apps/web && npx vitest run set-actions.test set-card.test` (Bash `timeout` 600000)
Expected: PASS.

```bash
pnpm format:check
git add apps/web
git commit -m "feat(sets): the room inventory is drafted from the first plate, and can be redrafted (decision 275)"
```

---

### Task 4: Gemini 3 in the image adapter: size, reasoning, prices, direction labels

**Files:**
- Modify: `packages/providers/src/visuals/types.ts`
- Modify: `packages/providers/src/visuals/gemini.ts`
- Test: `packages/providers/src/visuals/gemini.test.ts`, `packages/providers/src/visuals/adapters.test.ts` (if it asserts `imageGenPrice`)

**Interfaces:**
- Produces: `type ImageSize = '1K' | '2K' | '4K'`; `ImageGenRequest.size?: ImageSize`; `ImageReference.facing?: 'north' | 'east' | 'south' | 'west' | 'detail'`; `ImageGenModel.pricesBySize?: Partial<Record<ImageSize, number>>`; `imageGenPrice(provider, count, modelId?, size?: ImageSize): number`; `referenceLabel(reference: Pick<ImageReference,'name'|'kind'|'facing'>, position, total)`.

- [ ] **Step 1: Failing adapter tests** in `gemini.test.ts` (use the file's existing `fetchRecording`, `IMAGE_REPLY` helpers):

```ts
describe('Gemini 3 options (decision 275)', () => {
  const bodyOf = (calls: { body: unknown }[]) =>
    calls[0]!.body as { generationConfig: Record<string, unknown> }

  it('asks 3.1 Flash for the size and for high reasoning', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      { prompt: 'x', count: 1, model: 'gemini-3.1-flash-image', size: '1K' },
      { apiKey: 'k', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )
    expect(bodyOf(calls).generationConfig).toEqual({
      imageConfig: { aspectRatio: '16:9', imageSize: '1K' },
      thinkingConfig: { thinkingLevel: 'HIGH' },
    })
  })

  it('asks 3 Pro for the size and never for reasoning, which it rejects', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      { prompt: 'x', count: 1, model: 'gemini-3-pro-image', size: '4K' },
      { apiKey: 'k', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )
    expect(bodyOf(calls).generationConfig).toEqual({
      imageConfig: { aspectRatio: '16:9', imageSize: '4K' },
    })
  })

  it('sends 2.5 Flash neither, since it takes neither', async () => {
    const calls: { url: string; body: unknown }[] = []
    await geminiImageGen.generate(
      { prompt: 'x', count: 1, model: 'gemini-2.5-flash-image', size: '1K' },
      { apiKey: 'k', fetchImpl: fetchRecording(calls, IMAGE_REPLY) },
    )
    expect(bodyOf(calls).generationConfig).toEqual({ imageConfig: { aspectRatio: '16:9' } })
  })

  it('prices each size from the published rates, rounded up', async () => {
    expect(imageGenPrice(geminiImageGen, 1, 'gemini-3.1-flash-image', '1K')).toBeCloseTo(0.07)
    expect(imageGenPrice(geminiImageGen, 1, 'gemini-3.1-flash-image', '4K')).toBeCloseTo(0.16)
    expect(imageGenPrice(geminiImageGen, 1, 'gemini-3-pro-image', '4K')).toBeCloseTo(0.24)
    expect(imageGenPrice(geminiImageGen, 2, 'gemini-2.5-flash-image', '4K')).toBeCloseTo(0.08)
    const result = await geminiImageGen.generate(
      { prompt: 'x', count: 1, model: 'gemini-3-pro-image', size: '4K' },
      { apiKey: 'k', fetchImpl: fetchRecording([], IMAGE_REPLY) },
    )
    expect(result.estimatedCostUsd).toBeCloseTo(0.24)
  })

  it('names the direction a set plate faces in its label', () => {
    expect(
      referenceLabel({ name: 'The boardroom', kind: 'object', facing: 'south' }, 2, 3),
    ).toBe(
      "Reference image 2 of 3: The boardroom, facing south. Use it for the place's design only " +
        '(architecture, materials, furniture, light), never its framing or camera position.',
    )
  })

  it('takes the answer image and skips a thought image', async () => {
    const reply = {
      candidates: [
        {
          content: {
            parts: [
              { thought: true, inlineData: { mimeType: 'image/png', data: 'VEhPVUdIVA==' } },
              { inlineData: { mimeType: 'image/png', data: 'QU5TV0VS' } },
            ],
          },
        },
      ],
    }
    const result = await geminiImageGen.generate(
      { prompt: 'x', count: 1, model: 'gemini-3.1-flash-image' },
      { apiKey: 'k', fetchImpl: fetchRecording([], reply) },
    )
    expect(result.images[0]!.url).toBe('data:image/png;base64,QU5TV0VS')
  })
})
```

Import `imageGenPrice` and `referenceLabel` in the test file. If `fetchRecording` expects its reply in another shape, read it first and match.

- [ ] **Step 2: Run to fail**

Run: `cd packages/providers && npx vitest run gemini`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `types.ts`:

```ts
/** Output size for models that take one (decision 275). */
export type ImageSize = '1K' | '2K' | '4K'
```

`ImageReference` gains:

```ts
  /** For a set plate: the direction it faces, named in the image's label (decision 275). */
  facing?: 'north' | 'east' | 'south' | 'west' | 'detail'
```

`ImageGenRequest` gains `size?: ImageSize` with a comment "Honoured by the Gemini 3 models; ignored elsewhere." `ImageGenModel` gains `readonly pricesBySize?: Partial<Record<ImageSize, number>>`. `imageGenPrice` becomes:

```ts
/** USD for a generation call, from the adapter's own price for that model and size. */
export function imageGenPrice(
  provider: ImageGenProvider,
  count: number,
  modelId?: string,
  size?: ImageSize,
): number {
  const model = imageGenModel(provider, modelId)
  return ((size ? model.pricesBySize?.[size] : undefined) ?? model.pricePerImage) * count
}
```

In `gemini.ts`:
- `MODELS` becomes:

```ts
const MODELS = [
  { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image', pricePerImage: 0.04 },
  {
    id: 'gemini-3.1-flash-image',
    label: 'Gemini 3.1 Flash Image',
    pricePerImage: 0.07,
    pricesBySize: { '1K': 0.07, '2K': 0.11, '4K': 0.16 },
  },
  {
    id: 'gemini-3-pro-image',
    label: 'Gemini 3 Pro Image',
    pricePerImage: 0.15,
    pricesBySize: { '1K': 0.15, '2K': 0.15, '4K': 0.24 },
  },
] as const
```

and extend the prices comment: "Per size, from Google's pricing page (2026-09-24): 3.1 Flash $0.067 at 1K, $0.101 at 2K, $0.151 at 4K; 3 Pro $0.134 at 1K or 2K, $0.24 at 4K; each rounded up."
- add:

```ts
/** Models that take `imageConfig.imageSize`; 2.5 Flash has one size and would be refused. */
const SIZED_MODELS = new Set(['gemini-3.1-flash-image', 'gemini-3-pro-image'])
/**
 * Models that take `thinkingConfig`. The API errors when it is set on a model
 * without thinking, and 3 Pro always reasons without being asked (decision 275).
 */
const THINKING_MODELS = new Set(['gemini-3.1-flash-image'])

/** Pixel size reported for each output size at 16:9; the bytes are what they are. */
const DIMENSIONS: Record<ImageSize, { width: number; height: number }> = {
  '1K': { width: 1344, height: 768 },
  '2K': { width: 2688, height: 1536 },
  '4K': { width: 5376, height: 3072 },
}
```

- `referenceLabel` gains the facing:

```ts
export function referenceLabel(
  reference: Pick<ImageReference, 'name' | 'kind' | 'facing'>,
  position: number,
  total: number,
): string {
  const role =
    reference.kind === 'character'
      ? 'use it for the likeness only; pose, clothing and framing come from the text'
      : "use it for the place's design only (architecture, materials, furniture, light), never its framing or camera position"
  const facing =
    reference.facing === undefined
      ? ''
      : reference.facing === 'detail'
        ? ', a close detail'
        : `, facing ${reference.facing}`
  return `Reference image ${position} of ${total}: ${reference.name}${facing}. ${role[0]!.toUpperCase()}${role.slice(1)}.`
}
```

- the request body's `generationConfig` becomes:

```ts
            generationConfig: {
              imageConfig: {
                aspectRatio: ASPECT_RATIO,
                ...(request.size && SIZED_MODELS.has(model.id) ? { imageSize: request.size } : {}),
              },
              ...(THINKING_MODELS.has(model.id) ? { thinkingConfig: { thinkingLevel: 'HIGH' } } : {}),
            },
```

- the response part schema gains `thought: z.boolean().optional()`; the image is the LAST part with `inlineData` and without `thought: true`:

```ts
      const image = (parsed.candidates ?? [])
        .flatMap((candidate) => candidate.content?.parts ?? [])
        .filter((part) => part.inlineData && part.thought !== true)
        .at(-1)?.inlineData
```

- width and height come from `DIMENSIONS[request.size && SIZED_MODELS.has(model.id) ? request.size : '1K']`;
- `estimatedCostUsd` is `imageGenPrice(geminiImageGen, images.length, model.id, request.size)` (import `imageGenPrice` from `./types`).

Update the existing test that asserted `referenceLabel` without a facing only if it now fails (it should not: no `facing` means no suffix).

- [ ] **Step 4: Run to pass**

Run: `cd packages/providers && npx vitest run`
Expected: PASS (whole package).

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/providers
git commit -m "feat(providers): Gemini 3 image calls take a size and high reasoning, priced per size, with direction labels (decision 275)"
```

---

### Task 5: The `setSheet` route

**Files:**
- Modify: `packages/schemas/src/settings.ts` (`ModelRoutingSchema`, `DEFAULT_SETTINGS`)
- Modify: `packages/db/src/settings-merge.ts` (`canonicaliseRouting`)
- Modify: `apps/web/app/(console)/settings/settings-form.tsx` (`ModelsTab`)
- Test: `packages/schemas/src/settings.test.ts`, `packages/db/src/settings-merge.test.ts`, the settings form test that covers the Models tab (find it with `grep -rln "Still images provider" apps/web`)

**Interfaces:**
- Produces: `DEFAULT_SET_SHEET_ROUTE: StillRoute = { provider: 'google', model: 'gemini-3-pro-image' }`; `ModelRouting.setSheet: StillRoute` (a stored row without it reads the default).

- [ ] **Step 1: Failing tests.** `settings.test.ts`:

```ts
  it('routes set sheets to Gemini 3 Pro Image by default, and fills it for an older row', () => {
    expect(DEFAULT_SETTINGS.modelRouting.setSheet).toEqual({
      provider: 'google',
      model: 'gemini-3-pro-image',
    })
    const { setSheet: _dropped, ...older } = DEFAULT_SETTINGS.modelRouting
    expect(ModelRoutingSchema.parse(older).setSheet).toEqual(DEFAULT_SET_SHEET_ROUTE)
  })
```

`settings-merge.test.ts`:

```ts
  it('folds a retired set-sheet model id forward', () => {
    const stored = {
      ...DEFAULT_SETTINGS,
      modelRouting: {
        ...DEFAULT_SETTINGS.modelRouting,
        setSheet: { provider: 'google', model: 'gemini-3-pro-image-preview' },
      },
    }
    expect(normaliseSettings(stored).modelRouting.setSheet.model).toBe('gemini-3-pro-image')
  })
```

Settings form test (Models tab), in the file's existing style:

```tsx
  it('routes set sheets among the Google image models', async () => {
    // render the Models tab as the file's other Models tests do
    const select = screen.getByRole('combobox', { name: 'Set sheets model' })
    expect(select).toHaveValue('gemini-3-pro-image')
    await userEvent.selectOptions(select, 'gemini-3.1-flash-image')
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRouting: { setSheet: { provider: 'google', model: 'gemini-3.1-flash-image' } },
      }),
    )
  })
```

Name the save mock whatever that file already names it.

- [ ] **Step 2: Run to fail**

Run: `cd packages/schemas && npx vitest run settings` and `cd packages/db && npx vitest run settings-merge`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `settings.ts` above `ModelRoutingSchema`:

```ts
/**
 * Where "Build the set" draws its contact sheet (decision 275): one 4K image
 * of a room from four sides. Gemini 3 Pro Image by default, because the
 * consistency of four views in one pass is the whole point of it.
 */
export const DEFAULT_SET_SHEET_ROUTE: StillRoute = {
  provider: 'google',
  model: 'gemini-3-pro-image',
}
```

and in `ModelRoutingSchema` after `stillsLikeness`:

```ts
  /** The contact-sheet generator (decision 275); a row stored before it reads the default. */
  setSheet: StillRouteSchema.default(DEFAULT_SET_SHEET_ROUTE),
```

`DEFAULT_SETTINGS.modelRouting` gains `setSheet: DEFAULT_SET_SHEET_ROUTE`. In `canonicaliseRouting` add:

```ts
  migrated.setSheet = {
    ...migrated.setSheet,
    model: canonicalStillModelId(migrated.setSheet.model),
  }
```

In `ModelsTab` add, after the likeness row:

```tsx
        {/* The set-sheet generator (decision 275): Google models only, because
            the four-view contact sheet and its 4K output are Gemini features. */}
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto]">
          <Label htmlFor="route-set-sheet-model">Set sheets (Build the set)</Label>
          <Select
            id="route-set-sheet-model"
            aria-label="Set sheets model"
            value={settings.modelRouting.setSheet.model}
            disabled={saving}
            onChange={(event) => {
              const route = { provider: 'google' as const, model: event.target.value }
              const next = structuredClone(settings)
              next.modelRouting.setSheet = route
              void commit({ modelRouting: { setSheet: route } }, next)
            }}
            className="sm:w-48"
          >
            {LIVE_IMAGE_GEN_ADAPTERS.google.models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </Select>
        </div>
```

- [ ] **Step 4: Run to pass, fix fixtures**

Run: `pnpm typecheck`, then `cd packages/schemas && npx vitest run`, `cd packages/db && npx vitest run settings-merge`, and the settings form test file.
Expected: PASS. A test fixture that builds a full `ModelRouting` literal now needs `setSheet`; add `setSheet: DEFAULT_SET_SHEET_ROUTE` where typecheck says so.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/schemas packages/db apps/web
git commit -m "feat(settings): set sheets have their own route, Gemini 3 Pro Image by default (decision 275)"
```

---

### Task 6: Split a contact sheet

**Files:**
- Create: `apps/web/lib/contact-sheet.ts`
- Test: `apps/web/lib/contact-sheet.test.ts`

**Interfaces:**
- Consumes: `SetPlateDirection` (Task 1).
- Produces: `interface SheetPanel { direction: SetPlateDirection; bytes: Buffer; width: number; height: number }`; `splitContactSheet(input: Buffer): Promise<SheetPanel[] | null>` (order: north, east, south, west); `mockContactSheet(): Promise<Buffer>` (a 640x360 PNG with white gutters, for mock mode).

- [ ] **Step 1: Failing tests** in `apps/web/lib/contact-sheet.test.ts`:

```ts
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { mockContactSheet, splitContactSheet } from './contact-sheet'

/** A sheet: four grey panels on white, `gutter` px apart, `border` px of white round the edge. */
async function sheet(options: {
  width?: number
  height?: number
  gutter?: number
  border?: number
  panel?: number
}): Promise<Buffer> {
  const { width = 800, height = 450, gutter = 8, border = 0, panel = 90 } = options
  const inner = { w: width - 2 * border, h: height - 2 * border }
  const pw = Math.floor((inner.w - gutter) / 2)
  const ph = Math.floor((inner.h - gutter) / 2)
  const tile = (shade: number) =>
    sharp({ create: { width: pw, height: ph, channels: 3, background: { r: shade, g: shade, b: shade } } })
      .png()
      .toBuffer()
  const tiles = await Promise.all([tile(panel), tile(panel + 20), tile(panel + 40), tile(panel + 60)])
  return sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .composite([
      { input: tiles[0]!, left: border, top: border },
      { input: tiles[1]!, left: border + pw + gutter, top: border },
      { input: tiles[2]!, left: border, top: border + ph + gutter },
      { input: tiles[3]!, left: border + pw + gutter, top: border + ph + gutter },
    ])
    .png()
    .toBuffer()
}

describe('splitContactSheet', () => {
  it('cuts a clean sheet into four panels, north east south west', async () => {
    const panels = await splitContactSheet(await sheet({}))
    expect(panels?.map((panel) => panel.direction)).toEqual(['north', 'east', 'south', 'west'])
    for (const panel of panels ?? []) {
      expect(panel.width).toBe(396)
      expect(panel.height).toBe(221)
    }
    // Each panel is the right tile: the south panel is the third shade.
    const south = await sharp(panels![2]!.bytes).greyscale().raw().toBuffer()
    expect(south[0]).toBe(130)
  })

  it('trims a white outer border', async () => {
    const panels = await splitContactSheet(await sheet({ border: 12 }))
    expect(panels).toHaveLength(4)
    expect(panels![0]!.width).toBe(384)
  })

  it('refuses a sheet with no gutter rather than guessing', async () => {
    const plain = await sharp({
      create: { width: 800, height: 450, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .png()
      .toBuffer()
    expect(await splitContactSheet(plain)).toBeNull()
  })

  it('refuses a gutter outside the middle of the sheet', async () => {
    const lopsided = await sharp({
      create: { width: 800, height: 450, channels: 3, background: { r: 90, g: 90, b: 90 } },
    })
      .composite([
        {
          input: await sharp({ create: { width: 800, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer(),
          left: 0,
          top: 60,
        },
      ])
      .png()
      .toBuffer()
    expect(await splitContactSheet(lopsided)).toBeNull()
  })

  // Review Focus 4: a pale room must not read as a gutter.
  it('finds the real gutter in a sheet of pale panels', async () => {
    // Shades 170, 190, 210 and 230: pale, but under the 235 border threshold.
    const panels = await splitContactSheet(await sheet({ panel: 170 }))
    expect(panels).toHaveLength(4)
    expect(panels![0]!.width).toBe(396)
  })

  it('splits its own mock sheet', async () => {
    expect(await splitContactSheet(await mockContactSheet())).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `cd apps/web && npx vitest run contact-sheet`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `apps/web/lib/contact-sheet.ts`:**

```ts
import sharp from 'sharp'
import type { SetPlateDirection } from '@boom-busters/schemas'

/**
 * Cutting a set's contact sheet into its four views (decision 275). The
 * sheet is asked for with thin white borders; the cut is made where those
 * borders are found, never at a guessed half, because a panel cut through
 * the middle of a room becomes a plate that teaches every later still a
 * seam. No clear border, no cut: the caller says so and the owner builds it
 * again.
 */

export interface SheetPanel {
  direction: SetPlateDirection
  bytes: Buffer
  width: number
  height: number
}

/** Mean luminance at or above this, across a whole row or column, is border. */
const WHITE = 235
/** A gutter narrower than this is a highlight, not a border. */
const MIN_GUTTER = 4

/** The widest run of white lines between `from` and `to`, or null. */
function band(means: Float64Array, from: number, to: number): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null
  let start = -1
  for (let at = from; at <= to; at += 1) {
    const white = at < to && means[at]! >= WHITE
    if (white && start === -1) start = at
    if (!white && start !== -1) {
      if (!best || at - start > best.end - best.start) best = { start, end: at }
      start = -1
    }
  }
  return best && best.end - best.start >= MIN_GUTTER ? best : null
}

/** First index from the start (or the end) that is not white: the outer border's edge. */
function edge(means: Float64Array, fromEnd: boolean): number {
  const n = means.length
  for (let step = 0; step < n; step += 1) {
    const at = fromEnd ? n - 1 - step : step
    if (means[at]! < WHITE) return fromEnd ? at + 1 : at
  }
  return fromEnd ? n : 0
}

export async function splitContactSheet(input: Buffer): Promise<SheetPanel[] | null> {
  const { data, info } = await sharp(input).greyscale().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const rows = new Float64Array(height)
  const cols = new Float64Array(width)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = data[(y * width + x) * channels]!
      rows[y]! += value
      cols[x]! += value
    }
  }
  for (let y = 0; y < height; y += 1) rows[y] = rows[y]! / width
  for (let x = 0; x < width; x += 1) cols[x] = cols[x]! / height

  const across = band(rows, Math.floor(height * 0.4), Math.ceil(height * 0.6))
  const down = band(cols, Math.floor(width * 0.4), Math.ceil(width * 0.6))
  if (!across || !down) return null

  const top = edge(rows, false)
  const bottom = edge(rows, true)
  const left = edge(cols, false)
  const right = edge(cols, true)

  const boxes: { direction: SetPlateDirection; left: number; top: number; width: number; height: number }[] = [
    { direction: 'north', left, top, width: down.start - left, height: across.start - top },
    { direction: 'east', left: down.end, top, width: right - down.end, height: across.start - top },
    { direction: 'south', left, top: across.end, width: down.start - left, height: bottom - across.end },
    { direction: 'west', left: down.end, top: across.end, width: right - down.end, height: bottom - across.end },
  ]
  if (boxes.some((box) => box.width < 16 || box.height < 16)) return null

  return Promise.all(
    boxes.map(async (box) => ({
      direction: box.direction,
      width: box.width,
      height: box.height,
      bytes: await sharp(input)
        .extract({ left: box.left, top: box.top, width: box.width, height: box.height })
        .png()
        .toBuffer(),
    })),
  )
}

/** The sheet mock mode "generates": four grey panels with white gutters. */
export async function mockContactSheet(): Promise<Buffer> {
  const pw = 316
  const ph = 176
  const tile = (shade: number) =>
    sharp({ create: { width: pw, height: ph, channels: 3, background: { r: shade, g: shade, b: shade } } })
      .png()
      .toBuffer()
  const tiles = await Promise.all([tile(80), tile(110), tile(140), tile(170)])
  return sharp({ create: { width: 640, height: 360, channels: 3, background: '#ffffff' } })
    .composite([
      { input: tiles[0]!, left: 0, top: 0 },
      { input: tiles[1]!, left: pw + 8, top: 0 },
      { input: tiles[2]!, left: 0, top: ph + 8 },
      { input: tiles[3]!, left: pw + 8, top: ph + 8 },
    ])
    .png()
    .toBuffer()
}
```

Check the expected panel sizes in the tests against this arithmetic before running (800 wide, 8 gutter: `pw = 396`; 450 high: `ph = 221`; with a 12px border: `pw = floor((776 - 8) / 2) = 384`). Adjust an expectation only if the arithmetic, not the code, is wrong.

- [ ] **Step 4: Run to pass**

Run: `cd apps/web && npx vitest run contact-sheet`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add apps/web/lib/contact-sheet.ts apps/web/lib/contact-sheet.test.ts
git commit -m "feat(sets): split a four-view contact sheet at its borders, refusing a guess (decision 275)"
```

---

### Task 7: Build the set

**Files:**
- Modify: `apps/web/lib/set-plates.ts` (`buildSetSheetPrompt`)
- Create: `apps/web/lib/set-sheet.ts`
- Modify: `apps/web/lib/visual-assets.ts` (`setSheetEstimateUsd`)
- Modify: `apps/web/app/(console)/projects/[id]/set-actions.ts` (`buildSetSheetAction`)
- Modify: `apps/web/app/(console)/projects/[id]/set-card.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx`
- Test: `apps/web/lib/set-plates.test.ts` (create), `apps/web/app/(console)/projects/[id]/set-actions.test.ts`, `apps/web/app/(console)/projects/[id]/set-card.test.tsx`

**Interfaces:**
- Consumes: `splitContactSheet`, `mockContactSheet` (Task 6); `modelRouting.setSheet` (Task 5); `imageGenPrice(..., '4K')`, `ImageReference.facing` (Task 4); `platesForCamera`, `MAX_SET_PLATES` (Task 1); `ProjectSet.layout` (Task 2); card batch `{ list, views }` (Task 1).
- Produces: `buildSetSheetPrompt(input: { name: string; layout: string; look: string; styleAnchors: string }): string`; `buildSetSheet(set: ProjectSet): Promise<{ candidates: SlotCandidate[]; views: SetPlateDirection[] }>` (throws `ValidationError` with the unsplit message); `setSheetEstimateUsd(): Promise<number>`; `buildSetSheetAction(setId): Promise<ActionResult & { candidates?: SlotCandidate[]; views?: SetPlateView[] }>`; card prop `sheetEstimateUsd?: number`.

- [ ] **Step 1: Failing prompt test** in new `apps/web/lib/set-plates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildSetSheetPrompt } from './set-plates'

describe('buildSetSheetPrompt', () => {
  it('states the grid, each panel’s direction, then the room', () => {
    const prompt = buildSetSheetPrompt({
      name: 'The boardroom',
      layout: 'North wall: windows',
      look: 'A long table',
      styleAnchors: 'fine grain',
    })
    expect(prompt).toContain(
      'A 2x2 contact sheet of four photographs of one room, The boardroom, separated by thin white borders of equal width, each panel 16:9.',
    )
    expect(prompt).toContain('Top left: facing north, the view in reference image 1.')
    expect(prompt).toContain('Top right: facing east. Bottom left: facing south. Bottom right: facing west.')
    expect(prompt).toContain('The room: North wall: windows')
    expect(prompt).not.toContain('A long table')
    expect(prompt.endsWith('fine grain')).toBe(true)
  })

  it('falls back to the look when there is no inventory', () => {
    expect(
      buildSetSheetPrompt({ name: 'R', layout: '', look: 'A long table', styleAnchors: 'a' }),
    ).toContain('The room: A long table')
  })
})
```

- [ ] **Step 2: Run to fail**

Run: `cd apps/web && npx vitest run set-plates`
Expected: FAIL.

- [ ] **Step 3: Implement `buildSetSheetPrompt`** in `set-plates.ts`:

```ts
/**
 * The contact sheet's prompt (decision 275): the grid first, then each
 * panel's direction, then the room. Four panels labelled by direction cannot
 * all copy the reference, and one pass resolves the whole room, so the walls
 * the reference never showed agree with each other.
 */
export function buildSetSheetPrompt(input: {
  name: string
  layout: string
  look: string
  styleAnchors: string
}): string {
  const room = input.layout.trim() !== '' ? input.layout.trim() : input.look.trim()
  return [
    `A 2x2 contact sheet of four photographs of one room, ${input.name}, separated by thin white borders of equal width, each panel 16:9.`,
    'All four show the same room at the same moment in the same light, each taken at eye level with a 35mm lens from the middle of the opposite wall, with no people in the room.',
    'Top left: facing north, the view in reference image 1.',
    'Top right: facing east. Bottom left: facing south. Bottom right: facing west.',
    `The room: ${room.replace(/\r?\n/g, ' ')}`,
    input.styleAnchors,
  ].join('\n')
}
```

Task 8 inserts the house photograph line before `input.styleAnchors`.

- [ ] **Step 4: Failing action tests** in `set-actions.test.ts` (mock mode):

```ts
  it('builds the set: one sheet, four candidates tagged by direction', async () => {
    const id = await addTradingFloor()
    await finaliseSetPlateAction({ setId: id, mimeType: 'image/jpeg', contentHash: HASH_A, width: 10, height: 10 })
    const result = await buildSetSheetAction(id)
    expect(result.ok).toBe(true)
    expect(result.views).toEqual(['north', 'east', 'south', 'west'])
    expect(result.candidates).toHaveLength(4)
    for (const candidate of result.candidates ?? []) {
      expect(candidate.sourceUrl.startsWith('data:image/png;base64,')).toBe(true)
    }
  })

  it('refuses to build a set with no plate', async () => {
    const id = await addTradingFloor()
    expect(await buildSetSheetAction(id)).toEqual({
      ok: false,
      error: 'Add a plate first, then build the set from it.',
    })
  })

  it('refuses to build a set with fewer than three plates free', async () => {
    const id = await addTradingFloor()
    for (const letter of ['1', '2', '3', '4']) {
      await finaliseSetPlateAction({ setId: id, mimeType: 'image/png', contentHash: letter.repeat(64), width: 10, height: 10 })
    }
    expect(await buildSetSheetAction(id)).toEqual({
      ok: false,
      error: 'Building the set adds three views. Remove 1 plate first.',
    })
  })
```

Choosing a candidate with `view: 'east'` is already covered by `chooseSetPlateAction`'s view test; do not duplicate it.

- [ ] **Step 5: Implement `apps/web/lib/set-sheet.ts`:**

```ts
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import {
  imageGenAdapter,
  imageGenModel,
  imageGenPrice,
  LIVE_IMAGE_GEN_ADAPTERS,
  mockProvidersEnabled,
  stillStyleAnchors,
} from '@boom-busters/providers'
import { getSettings, upsertAssetByHash, visualCredentials } from '@boom-busters/db'
import { platesForCamera, ValidationError } from '@boom-busters/schemas'
import type { ProjectSet, SetPlateDirection, SlotCandidate } from '@boom-busters/schemas'
import { withCost } from '@boom-busters/cost'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { getObjectBytes, putObject, stillKey } from '@/lib/storage'
import { mockContactSheet, splitContactSheet } from '@/lib/contact-sheet'
import { buildSetSheetPrompt } from '@/lib/set-plates'

/**
 * "Build the set" (decision 275): one contact sheet of the room from four
 * sides, on the `setSheet` route at 4K, with the set's north plate as the
 * reference, cut into four candidates the Set card offers like any other.
 */

export const UNSPLIT_SHEET =
  'The sheet came back without clear borders, so it was not split; build the set again.'

export async function buildSetSheet(
  set: ProjectSet,
): Promise<{ candidates: SlotCandidate[]; views: SetPlateDirection[] }> {
  const settings = await getSettings(db)
  const route = settings.modelRouting.setSheet
  if (route.provider !== 'google') {
    throw new ValidationError(
      'Set sheets need a Google image model; change Settings → Models → Set sheets.',
      { field: 'modelRouting.setSheet' },
    )
  }
  const prompt = buildSetSheetPrompt({
    name: set.name,
    layout: set.layout,
    look: set.look,
    styleAnchors: stillStyleAnchors(settings.brandKit),
  })
  const mocked = mockProvidersEnabled()

  let sheet: Buffer
  if (mocked) {
    sheet = await mockContactSheet()
  } else {
    const keys = await visualCredentials(db, env.SECRETS_ENCRYPTION_KEY)
    if (!keys.google) {
      throw new ValidationError(
        'Set sheets run on Gemini, but no Google key is stored in Settings → Connections.',
        { field: 'modelRouting.setSheet' },
      )
    }
    const [plate] = platesForCamera(set, 'north', 1)
    if (!plate) throw new ValidationError('Add a plate first, then build the set from it.')
    const object = await getObjectBytes(plate.r2Key)
    const live = LIVE_IMAGE_GEN_ADAPTERS.google
    const result = await withCost(
      db,
      {
        provider: 'google',
        operation: 'image.generate',
        projectId: set.projectId,
        estimateUsd: imageGenPrice(live, 1, route.model, '4K'),
        meta: { model: route.model, set: set.name, kind: 'set-sheet', prompt: prompt.slice(0, 200) },
      },
      async () => {
        const generated = await imageGenAdapter('google').generate(
          {
            prompt,
            count: 1,
            model: route.model,
            size: '4K',
            references: [
              {
                name: set.name,
                kind: 'object',
                facing: 'north',
                mimeType: plate.mimeType,
                data: Buffer.from(object.bytes).toString('base64'),
              },
            ],
          },
          { apiKey: keys.google },
        )
        return { result: generated, actualUsd: generated.estimatedCostUsd }
      },
    )
    const url = result.images[0]!.url
    sheet = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  }

  const panels = await splitContactSheet(sheet)
  if (!panels) throw new ValidationError(UNSPLIT_SHEET)

  const label = imageGenModel(LIVE_IMAGE_GEN_ADAPTERS.google, route.model).label
  const candidates = await Promise.all(
    panels.map(async (panel): Promise<SlotCandidate> => {
      const summary = `${set.name}, facing ${panel.direction}`
      if (mocked) {
        // A self-contained data: thumbnail, as every mock candidate is;
        // `chooseSetPlateAction` decodes it in place.
        const small = await sharp(panel.bytes).resize(320).png().toBuffer()
        return {
          id: `google-mock-sheet-${panel.direction}`,
          provider: 'google',
          kind: 'image',
          sourceUrl: `data:image/png;base64,${small.toString('base64')}`,
          thumbUrl: `data:image/png;base64,${small.toString('base64')}`,
          width: panel.width,
          height: panel.height,
          licence: '[mock] Generated set sheet',
          summary: `[mock] ${summary}`,
        }
      }
      const contentHash = createHash('sha256').update(panel.bytes).digest('hex')
      const { key } = await putObject(stillKey({ projectId: set.projectId, contentHash }), panel.bytes, 'image/png')
      const sourceUrl = `generated://google/${contentHash.slice(0, 12)}`
      const asset = await upsertAssetByHash(db, {
        kind: 'image',
        r2Key: key,
        sourceUrl,
        licence: `Generated (${label}, set sheet)`,
        contentHash,
        width: panel.width,
        height: panel.height,
      })
      return {
        id: `google-${contentHash.slice(0, 12)}`,
        provider: 'google',
        kind: 'image',
        sourceUrl,
        r2Key: key,
        assetId: asset.id,
        width: panel.width,
        height: panel.height,
        licence: asset.licence,
        summary,
      }
    }),
  )
  return { candidates, views: panels.map((panel) => panel.direction) }
}
```

Match every import to where `generateStillCandidates` in `apps/web/lib/visual-assets.ts` gets the same names (`withCost`, `visualCredentials`, `upsertAssetByHash`, `imageGenAdapter`, `env`, `putObject`, `stillKey`); copy its import lines rather than trusting the ones above. Candidate ids repeat in mock mode; that is fine because a card batch holds one sheet at a time.

In `visual-assets.ts` add:

```ts
/** What "Build the set" will spend: one 4K image on the set-sheet route (decision 275). */
export async function setSheetEstimateUsd(): Promise<number> {
  const route = (await getSettings(db)).modelRouting.setSheet
  return round4(imageGenPrice(LIVE_IMAGE_GEN_ADAPTERS[route.provider], 1, route.model, '4K'))
}
```

In `set-actions.ts`:

```ts
/**
 * Build the set (decision 275): four views of the room from one sheet. The
 * owner keeps the views they like; each becomes a plate facing its direction.
 */
export async function buildSetSheetAction(
  setId: string,
): Promise<ActionResult & { candidates?: SlotCandidate[]; views?: SetPlateView[] }> {
  await requireOwner()
  const invalid = badIds(setId)
  if (invalid) return invalid
  const set = await getProjectSet(db, setId)
  if (!set) return { ok: false, error: 'This set no longer exists.' }
  if (set.plates.length === 0) {
    return { ok: false, error: 'Add a plate first, then build the set from it.' }
  }
  const free = MAX_SET_PLATES - set.plates.length
  if (free < 3) {
    const remove = 3 - free
    return {
      ok: false,
      error: `Building the set adds three views. Remove ${remove} plate${remove === 1 ? '' : 's'} first.`,
    }
  }
  try {
    const built = await buildSetSheet(set)
    return { ok: true, candidates: built.candidates, views: built.views }
  } catch (error) {
    return failure(error, 'The set could not be built.')
  }
}
```

- [ ] **Step 6: The card and the page.** `SetCardProps` gains `sheetEstimateUsd?: number`, passed through to `SetRow`. Beside the Generate button, when `room && plated && MAX_SET_PLATES - set.plates.length >= 3`:

```tsx
          <Button
            variant="outline"
            disabled={rowBusy}
            onClick={() =>
              void act(
                `${set.id}:sheet`,
                () => buildSetSheetAction(set.id),
                'Four views ready',
                (result) =>
                  onBatch({ list: result.candidates ?? [], views: result.views ?? [] }),
              )
            }
          >
            {`Build the set · ≈$${(sheetEstimateUsd ?? 0).toFixed(2)}`}
          </Button>
```

Widen `ActResult` with `views?: SetPlateView[]`. The candidate strip's text above the tiles already reads "Generated from the look…"; change it to "Click one to add it as a plate, or Preview them full size first." and give each tile a caption under the image from `batch.views[index]` via `VIEW_LABELS` (a `<span>` in the tile's bottom-left like the "Added" badge on the right). In `page.tsx` compute `const sheetEstimate = showCast ? await setSheetEstimateUsd() : 0` and pass `sheetEstimateUsd={sheetEstimate}`.

Card tests:

```tsx
  it('builds the set and offers four views, each added under its direction', async () => {
    actions.buildSetSheetAction.mockResolvedValue({
      ok: true,
      candidates: [1, 2, 3, 4].map((n) => liveCandidate(n, String(n).repeat(64))),
      views: ['north', 'east', 'south', 'west'],
    })
    render(
      <SetCard projectId={PROJECT} sets={[tradingFloor]} plateUrls={{}} plateEstimateUsd={0.08} sheetEstimateUsd={0.24} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit sets' }))
    await userEvent.click(screen.getByRole('button', { name: 'Build the set · ≈$0.24' }))
    await userEvent.click(await screen.findByRole('listitem', { name: 'Choose plate 3' }))
    expect(actions.chooseSetPlateAction).toHaveBeenCalledWith(
      expect.objectContaining({ setId: TRADING_FLOOR, view: 'south' }),
    )
  })

  it('offers no Build the set before the first plate', () => {
    const empty: ProjectSet = { ...boardroom, id: '01J0000000000000000000000D', plates: [] }
    render(<SetCard projectId={PROJECT} sets={[empty]} plateUrls={{}} plateEstimateUsd={0.08} sheetEstimateUsd={0.24} />)
    expect(screen.queryByRole('button', { name: /Build the set/ })).not.toBeInTheDocument()
  })
```

Add `buildSetSheetAction` to the hoisted `actions` mock.

- [ ] **Step 7: Run and commit**

Run: `pnpm typecheck`, then `cd apps/web && npx vitest run set-plates contact-sheet set-actions.test set-card.test` (Bash `timeout` 600000)
Expected: PASS.

```bash
pnpm format:check
git add apps/web
git commit -m "feat(sets): Build the set makes four views of the room from one contact sheet (decision 275)"
```

---

### Task 8: The house photograph line and the longer banned list

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md` and `direction-craft.ts` (constant outside the embedded literal)
- Modify: `packages/providers/src/prompts/shotlist.ts` (still template)
- Modify: `apps/web/lib/set-plates.ts` (`setPlateBrief`, `buildSetSheetPrompt`)
- Test: `packages/providers/src/prompts/direction-craft.test.ts`, `packages/providers/src/prompts/shotlist.test.ts`, `apps/web/lib/set-plates.test.ts`

**Interfaces:**
- Produces: `HOUSE_PHOTOGRAPH: string` exported from `@boom-busters/providers` (via `prompts/direction-craft.ts`); `BANNED_PROMPT_WORDS` gains `'ultra-detailed', '8k', '4k', '3d render', 'cgi', 'octane', 'unreal engine', 'hyperrealistic', 'photorealistic'`.

- [ ] **Step 1: Failing tests.** `direction-craft.test.ts`:

```ts
  it('states the house photograph line in the bible, word for word (decision 275)', () => {
    expect(DIRECTION_CRAFT).toContain(HOUSE_PHOTOGRAPH)
    expect(HOUSE_PHOTOGRAPH).toBe(
      'An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.',
    )
  })

  it('bans the words that pull a prompt towards a render (decision 275)', () => {
    for (const word of ['ultra-detailed', '8k', '4k', '3d render', 'cgi', 'octane', 'unreal engine', 'hyperrealistic', 'photorealistic']) {
      expect(BANNED_PROMPT_WORDS).toContain(word)
    }
    expect(stripBannedWords('A photorealistic, 8K boardroom')).toBe('A boardroom')
  })
```

`shotlist.test.ts` (in the existing "with direction" describe, on `request.system`):

```ts
    it('puts the house photograph line into every still prompt (decision 275)', () => {
      expect(request.system).toContain(`then the house photograph line verbatim: "${HOUSE_PHOTOGRAPH}"`)
    })
```

`set-plates.test.ts`:

```ts
describe('setPlateBrief', () => {
  it('asks for a photograph, then the Brand Kit anchors', () => {
    const brief = setPlateBrief({ name: 'R', look: 'A long table', plates: [] }, 'north', 'fine grain')
    expect(brief.prompt).toBe(
      `R, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level. A long table ${HOUSE_PHOTOGRAPH} fine grain`,
    )
  })
})
```

and in the `buildSetSheetPrompt` describe:

```ts
  it('asks for photographs before the anchors', () => {
    const prompt = buildSetSheetPrompt({ name: 'R', layout: '', look: 'L', styleAnchors: 'a' })
    expect(prompt.endsWith(`${HOUSE_PHOTOGRAPH}\na`)).toBe(true)
  })
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/providers && npx vitest run direction-craft shotlist` and `cd apps/web && npx vitest run set-plates`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `direction-craft.md`, in "What a still prompt must contain", add a bullet whose second line is the sentence alone, whole on one line:

```
- Every photograph is written as a photograph, in the house line, before the Brand Kit anchors:
  An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.
  A lens the camera names replaces the 35mm.
```

Extend the bible's "Banned words" line so it lists the new words too (the existing test holds every `BANNED_PROMPT_WORDS` entry to appear in the bible): add ", ultra-detailed, 8k, 4k, 3d render, cgi, octane, unreal engine, hyperrealistic, photorealistic" to that list, keeping any phrase a test asserts on one line. Run `pnpm --filter @boom-busters/providers embed:craft`.

In `direction-craft.ts`, after `BANNED_PROMPT_WORDS` (outside the embedded literal), add the new words to the array and:

```ts
/**
 * The house photograph line (decision 275): what makes a generated still read
 * as a photograph and not a render. Light with a direction, real materials
 * with wear, grain. Stated once here and in the bible, and sent on every
 * plate, sheet and still prompt before the Brand Kit anchors.
 */
export const HOUSE_PHOTOGRAPH =
  'An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.'
```

Export it from the package index the same way `BANNED_PROMPT_WORDS` is exported. In `shotlist.ts`'s still template, change "then the book's palette line (the era lock only limits which period objects you name; never paste its list), then these Brand Kit anchors verbatim" to "then the book's palette line (the era lock only limits which period objects you name; never paste its list), then the house photograph line verbatim: \"${HOUSE_PHOTOGRAPH}\", then these Brand Kit anchors verbatim" (import `HOUSE_PHOTOGRAPH`; keep the asserted substring on one source line or assert a substring that is).

In `set-plates.ts`: `setPlateBrief`'s prompt becomes `` `${set.name}, empty of people: ${framing}. ${set.look} ${HOUSE_PHOTOGRAPH} ${styleAnchors}` ``, and `buildSetSheetPrompt` inserts `HOUSE_PHOTOGRAPH` as the line before `input.styleAnchors`.

- [ ] **Step 4: Run to pass**

Run: `cd packages/providers && npx vitest run` and `cd apps/web && npx vitest run set-plates set-actions.test` (Bash `timeout` 600000)
Expected: PASS. Update the Task 1 first-plate assertion in `set-actions.test.ts` only if it compared the whole prompt (it should use `toContain`).

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/providers apps/web
git commit -m "feat(prompts): a house photograph line on every plate, sheet and still, and render words banned (decision 275)"
```

---

### Task 9: The planner writes a camera for every set shot

**Files:**
- Modify: `packages/providers/src/prompts/shotlist.ts` (`buildShotListRequest`, `slotShapes`, the sets rule)
- Modify: `packages/providers/src/prompts/direction-craft.md` / `.ts` (set section)
- Modify: `apps/web/inngest/lib/direction.ts` (pass `layout`)
- Test: `packages/providers/src/prompts/shotlist.test.ts`, `packages/providers/src/prompts/direction-craft.test.ts`

**Interfaces:**
- Consumes: `SetCameraSchema` on `StillBriefSchema` (Task 1); `ProjectSet.layout` (Task 2).
- Produces: `buildShotListRequest({ ..., sets?: readonly { name: string; look: string; layout?: string }[] })`.

- [ ] **Step 1: Failing tests** in `shotlist.test.ts` (build `withSets` as the file does, now with a layout):

```ts
    it('lists each set with its room inventory in the cacheable prefix (decision 275)', () => {
      const prefix = withLayout.messages[0]?.content ?? ''
      expect(prefix).toContain('- Venture Capital Boardroom: A long polished table, a glass wall.')
      expect(prefix).toContain('  North wall: three tall windows.')
    })

    it('asks every still in a set for a camera, placed physically', () => {
      expect(withSets.system).toContain('"camera": {"facing": "north"|"east"|"south"|"west", "position", "lens"?}')
      expect(withSets.system).toContain('Every still that names a set carries "camera".')
      expect(withSets.system).toContain('Two stills of the same room never share a camera position.')
    })

    it('parses a still with a camera, and one with a broken camera without it', () => {
      const text = JSON.stringify({
        slots: [
          { paragraphIndex: 0, seconds: 4, brief: { ...STILL_BRIEF, set: 'Venture Capital Boardroom', camera: { facing: 'south', position: 'the north windows, seated height' } } },
          { paragraphIndex: 0, seconds: 4, brief: { ...STILL_BRIEF, set: 'Venture Capital Boardroom', camera: { facing: 'sideways' } } },
        ],
      })
      const parsed = parseShotList(text)
      expect(parsed.slots).toHaveLength(2)
      expect((parsed.slots[0]!.brief as { camera?: unknown }).camera).toEqual({ facing: 'south', position: 'the north windows, seated height' })
      expect((parsed.slots[1]!.brief as { camera?: unknown }).camera).toBeUndefined()
    })
```

Define `withLayout` like `withSets` with `sets: [{ name: 'Venture Capital Boardroom', look: 'A long polished table, a glass wall.', layout: 'North wall: three tall windows.' }]`, and use whatever still-brief fixture the file already has for `STILL_BRIEF` (or define one with `type: 'still'`, `coversText`, `description`, `shotSize: 'wide'`, `motion: { kind: 'static' }`, `transition: 'cut'`, `prompt`).

`direction-craft.test.ts`:

```ts
  it("places a set shot's camera physically, from the brief (decision 275)", () => {
    expect(DIRECTION_CRAFT).toContain("The plates and the room inventory are the room; the camera is the brief's.")
    expect(DIRECTION_CRAFT).toContain('Place it by where it stands, how high, which way it faces and the lens, never by an angle name.')
  })
```

- [ ] **Step 2: Run to fail**

Run: `cd packages/providers && npx vitest run shotlist direction-craft`
Expected: FAIL.

- [ ] **Step 3: Implement.**

`buildShotListRequest` input `sets?: readonly { name: string; look: string; layout?: string }[]`; the prefix listing becomes:

```ts
        sets
          .map((set) => {
            const inventory = (set.layout ?? '').trim()
            return inventory
              ? `- ${set.name}: ${set.look}\n${inventory
                  .split(/\r?\n/)
                  .filter((line) => line.trim() !== '')
                  .map((line) => `  ${line.trim()}`)
                  .join('\n')}`
              : `- ${set.name}: ${set.look}`
          })
          .join('\n')
```

`slotShapes(hasSets)`: after the `"set"?` line, when `hasSets`, add `,\n   "camera"?: {"facing": "north"|"east"|"south"|"west", "position", "lens"?}` (kept on one source line so the test's substring holds).

The sets rule (the block starting "Sets are the rooms this film returns to") gains, after "Two stills of the same room never share a camera position.":

```
  Every still that names a set carries "camera". "facing" is the wall the
  camera looks at, by the inventory's compass; "position" is where it stands
  and how high ("the south doorway, seated eye height", "low across the table
  from the window side"); "lens" when it matters ("85mm, shallow focus").
  Choose the facing from what the sentence needs in frame, using the
  inventory: the windows are north, so a shot that must show the windows
  faces north. Vary facing and position across a chapter's shots of one room.
```

Keep "Two stills of the same room never share a camera position." whole on one line (it already is).

`direction-craft.md`: rewrite the set bullet (the one beginning "A set is a room the film returns to") to:

```
- A set is a room the film returns to, and the producer holds
  photographs of it and a room inventory, one line per wall.
  The plates and the room inventory are the room; the camera is the brief's.
  Name the set on a brief when the sentence puts us in that room, and write
  what happens inside it: the people, what they are doing, the light. Name
  the room in the prompt itself, in the same words the set list uses. Never
  describe its walls, furniture or materials again; the inventory states them.
  Every still in a set is a new photograph from its own camera.
  Place it by where it stands, how high, which way it faces and the lens, never by an angle name.
  Across a chapter the camera moves around the room the way a crew's would.
  Two stills of the same room never share a camera position. A set named
  on a shot that happens somewhere else is worse than no set at all.
```

Update the decision 273 tests that asserted the removed sentences ("They never give the picture: every still in a set is a new photograph from its own camera position.", "the photographs give the room's design") to the new wording, or drop the assertion where the new test replaces it. Run `pnpm --filter @boom-busters/providers embed:craft`.

`apps/web/inngest/lib/direction.ts`: wherever `sets` is handed to `buildShotListRequest` (lines near 250 and 370), map each set to `{ name: set.name, look: set.look, layout: set.layout }`.

- [ ] **Step 4: Run to pass**

Run: `cd packages/providers && npx vitest run` then `cd apps/web && npx vitest run direction` (Bash `timeout` 600000)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm format:check
git add packages/providers apps/web/inngest
git commit -m "feat(prompts): the planner places a camera in every set shot, reading the room inventory (decision 275)"
```

---

### Task 10: Generation follows the camera

**Files:**
- Modify: `apps/web/lib/set-plates.ts` (`describeCamera`)
- Modify: `apps/web/lib/visual-assets.ts` (`referenceMaterials`, `stillBriefPriceUsd`, `withReferenceClause`, `generateStillCandidates`)
- Test: `apps/web/lib/set-plates.test.ts`, `apps/web/lib/visual-assets.test.ts`

**Interfaces:**
- Consumes: `platesForCamera`, `SetCamera` (Task 1); `parseLayout`, `layoutView` (Task 2); `ImageReference.facing`, `size`, `imageGenPrice(..., size)` (Task 4).
- Produces: `describeCamera(camera: SetCamera, layout: string): string`.

- [ ] **Step 1: Failing pure tests** in `set-plates.test.ts`:

```ts
describe('describeCamera', () => {
  const layout = [
    'North wall: three tall windows.',
    'East wall: walnut credenza.',
    'South wall: glass wall onto the corridor.',
    'West wall: bare concrete.',
    'Centre: ten-seat walnut table.',
    'Light: overcast daylight from the north.',
  ].join('\n')

  it('places the camera, then what is in frame, at the edges and behind it', () => {
    expect(
      describeCamera({ facing: 'north', position: 'the south doorway, seated eye height', lens: '35mm' }, layout),
    ).toBe(
      'The camera stands at the south doorway, seated eye height, facing north, 35mm. ' +
        'In frame: three tall windows. At the edges: walnut credenza; bare concrete. ' +
        'Centre: ten-seat walnut table. Light: overcast daylight from the north. ' +
        'Behind the camera, out of frame: glass wall onto the corridor.',
    )
  })

  it('says only where the camera is when there is no inventory', () => {
    expect(describeCamera({ facing: 'east', position: 'the window' }, '')).toBe(
      'The camera stands at the window, facing east.',
    )
  })

  it('carries an unlabelled inventory whole', () => {
    expect(describeCamera({ facing: 'east', position: 'the window' }, 'A long table.')).toBe(
      'The camera stands at the window, facing east. The room: A long table.',
    )
  })
})
```

Add, in the `setPlateBrief` describe:

```ts
  it('shoots a compass view of a plated set from the opposite wall', () => {
    const plated = { name: 'R', look: 'L', plates: [{ view: 'north' }] } as unknown as Parameters<typeof setPlateBrief>[0]
    expect(setPlateBrief(plated, 'south', 'a').camera).toEqual({
      facing: 'south',
      position: 'the middle of the north wall, at eye level',
      lens: '24mm',
    })
    expect(setPlateBrief(plated, 'detail', 'a').camera).toBeUndefined()
    expect(setPlateBrief({ name: 'R', look: 'L', plates: [] }, 'north', 'a').camera).toBeUndefined()
  })
```

- [ ] **Step 2: Run to fail, then implement** in `set-plates.ts`:

```ts
/**
 * The camera sentence and what it sees (decision 275): where the camera
 * stands, then the inventory lines for the wall in frame, the walls at the
 * edges, the centre and the light, and the wall behind it. Stated positively,
 * so the model is given the new picture to make rather than an old one to avoid.
 */
export function describeCamera(camera: SetCamera, layout: string): string {
  const lens = camera.lens ? `, ${camera.lens}` : ''
  const sentences = [`The camera stands at ${camera.position}, facing ${camera.facing}${lens}.`]
  const view = layoutView(parseLayout(layout), camera.facing)
  if (view.inFrame) sentences.push(`In frame: ${view.inFrame}.`)
  if (view.edges.length > 0) sentences.push(`At the edges: ${view.edges.join('; ')}.`)
  if (view.centre) sentences.push(`Centre: ${view.centre}.`)
  if (view.light) sentences.push(`Light: ${view.light}.`)
  if (view.behind) sentences.push(`Behind the camera, out of frame: ${view.behind}.`)
  if (view.rest) sentences.push(`The room: ${view.rest.replace(/\.$/, '')}.`)
  return sentences.join(' ')
}
```

Run: `cd apps/web && npx vitest run set-plates`
Expected: PASS.

- [ ] **Step 3: Failing generation tests** in `visual-assets.test.ts` (mock mode, DB; reuse the file's `plate(...)` helper and set fixtures, updating its views to compass names):

```ts
  describe('the camera (decision 275)', () => {
    it('sends the plates nearest the camera, each labelled by direction', async () => {
      const room = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name: 'Venture Capital Boardroom', look: 'A long table.' })
      await setSetPlates(db, room.id, [plate('p-n', 'north'), plate('p-e', 'east'), plate('p-s', 'south')])
      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom', camera: { facing: 'south', position: 'the north windows' } },
        FIXTURE_PROJECT_ID,
      )
      const request = generate.mock.calls[0]?.[0]
      expect(request?.references?.map((reference) => reference.facing)).toEqual(['south', 'east'])
      expect(request?.size).toBe('1K')
    })

    it('closes the prompt with the camera and what it sees', async () => {
      const room = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name: 'Venture Capital Boardroom', look: 'A long table.' })
      await updateProjectSet(db, room.id, { layout: 'North wall: windows\nSouth wall: glass' })
      await setSetPlates(db, room.id, [plate('p-n', 'north')])
      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom', camera: { facing: 'north', position: 'the south doorway' } },
        FIXTURE_PROJECT_ID,
      )
      const prompt = generate.mock.calls[0]?.[0].prompt ?? ''
      expect(prompt).toContain('The camera stands at the south doorway, facing north. In frame: windows.')
      expect(prompt).toContain('Behind the camera, out of frame: glass.')
      expect(prompt).toContain(
        "The photographs of Venture Capital Boardroom show this room's furniture, materials and light; this photograph is a new one from the camera above.",
      )
      expect(prompt).not.toContain('never reproduce or edit the framing')
    })

    // Review Focus 3: no plate yet, but the camera and inventory still count.
    it('sends the camera and inventory for a set with no plate', async () => {
      const room = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name: 'Venture Capital Boardroom', look: 'A long table.' })
      await updateProjectSet(db, room.id, { layout: 'East wall: credenza' })
      await generateStillCandidates(
        { ...still, set: 'Venture Capital Boardroom', camera: { facing: 'east', position: 'the window' } },
        FIXTURE_PROJECT_ID,
      )
      const request = generate.mock.calls[0]?.[0]
      expect(request?.references ?? []).toEqual([])
      expect(request?.prompt).toContain('The camera stands at the window, facing east. In frame: credenza.')
    })

    it('keeps the decision 273 ending for a set shot with no camera', async () => {
      const room = await insertProjectSet(db, { projectId: FIXTURE_PROJECT_ID, name: 'Venture Capital Boardroom', look: 'A long table.' })
      await setSetPlates(db, room.id, [plate('p-n', 'north')])
      await generateStillCandidates({ ...still, set: 'Venture Capital Boardroom' }, FIXTURE_PROJECT_ID)
      expect(generate.mock.calls[0]?.[0].prompt).toContain('never reproduce or edit the framing of its photographs')
    })
  })
```

- [ ] **Step 4: Implement in `visual-assets.ts`.**
- `referenceMaterials(members, set, provider, budgets, mocked, facing?: SetPlateDirection)`: `const plates = set ? platesForCamera(set, facing, budgets.objects) : []`; every object reference it builds (mock, Gemini and fal branches) carries `facing: plate.view === 'other' ? undefined : plate.view` (omit the key when undefined).
- `stillBriefPriceUsd`: `const plateCount = set ? platesForCamera(set, brief.camera?.facing, budgets.objects).length : 0`, and the non-fal price is `imageGenPrice(live, STILL_GENERATIONS, route.model, '1K')`; the fal `billed` path is unchanged.
- `withReferenceClause(prompt, people, set, camera: string | null)`: when `camera` is non-null and `set` is non-null, the two set sentences become the single sentence ``The photographs of ${set.name} show this room's furniture, materials and light; this photograph is a new one from the camera above.``; the camera text goes after the people sentences and before that set sentence. When there are no references but `camera` is non-null, return `` `${prompt.trimEnd()}\n\n${camera}` ``. When `camera` is null, behaviour is unchanged. The marker check stays first.
- `generateStillCandidates`: compute

```ts
  // The camera reaches the prompt whether or not the set has a plate yet: the
  // inventory alone still says what the camera sees (decision 275).
  const namedSet = brief.set ? setForBrief(brief.set, projectSets) : null
  const cameraText = brief.camera ? describeCamera(brief.camera, namedSet?.layout ?? '') : null
```

pass `brief.camera?.facing` to `referenceMaterials` and `cameraText` to `withReferenceClause`; the adapter request gains `size: '1K'`; the `withCost` estimate uses `imageGenPrice(live, STILL_GENERATIONS, route.model, '1K')` on the non-fal path. `setForBrief` is already imported where `setFrom` uses it; import `describeCamera` from `@/lib/set-plates` and `platesForCamera` from `@boom-busters/schemas`.

- [ ] **Step 5: Run to pass**

Run: `cd apps/web && npx vitest run set-plates visual-assets.test` (Bash `timeout` 600000)
Expected: PASS. Update the file's decision 273 assertions only where a test now builds a brief with a camera.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/web/lib
git commit -m "feat(visuals): a set shot sends the plates nearest its camera and says what the camera sees (decision 275)"
```

---

### Task 11: A shared camera is a plan finding

**Files:**
- Modify: `packages/schemas/src/direction.ts` (`FindingBrief`, `CraftFindingKind`, `craftFindings`)
- Test: `packages/schemas/src/direction.test.ts` (or the file that tests `craftFindings`)

**Interfaces:**
- Consumes: `StillBrief.camera` (Task 1).
- Produces: `FindingBrief.camera?: { facing: string; position: string } | undefined`; `CraftFindingKind` gains `'shared-camera'`.

- [ ] **Step 1: Failing test:**

```ts
describe('shared camera (decision 275)', () => {
  const brief = (position: string, facing = 'north') => ({
    type: 'still',
    coversText: 'They met.',
    set: 'The boardroom',
    camera: { facing, position },
  })
  const context = { motifs: [], eraLocks: [], cast: [], sets: ['The boardroom'] }

  it('flags the second still in a set with the same facing and position', () => {
    const findings = craftFindings(
      [{ brief: brief('The South doorway ') }, { brief: brief('the south doorway') }, { brief: brief('the window') }],
      context,
    ).filter((finding) => finding.kind === 'shared-camera')
    expect(findings).toEqual([
      {
        kind: 'shared-camera',
        slotIndex: 1,
        repair: 'auto',
        message:
          'an earlier still in "The boardroom" already stands at "the south doorway" facing north; move the camera',
      },
    ])
  })

  it('does not flag a different facing from the same place, or a linked slot', () => {
    const findings = craftFindings(
      [{ brief: brief('the doorway') }, { brief: brief('the doorway', 'east') }, { brief: brief('the doorway'), linked: true }],
      context,
    ).filter((finding) => finding.kind === 'shared-camera')
    expect(findings).toEqual([])
  })
})
```

The two slots in the first test are not adjacent-in-set violations of `set-run` only if their sentences place them; filter by kind as written so the test pins only this rule.

- [ ] **Step 2: Run to fail, then implement.** `FindingBrief` gains `camera?: { facing: string; position: string } | undefined`; `CraftFindingKind` gains `| 'shared-camera'`. In `craftFindings`, after the set-runs loop:

```ts
  // Shared cameras (decision 275): two stills in one room from the same place
  // facing the same way are the same picture twice. The later one moves.
  const cameras = new Map<string, number>()
  for (const [index, { brief, linked }] of slots.entries()) {
    const set = slotSet(brief)
    if (!set || !brief.camera) continue
    const position = brief.camera.position.trim().toLowerCase()
    const key = `${set}|${brief.camera.facing}|${position}`
    if (cameras.has(key) && !linked) {
      findings.push({
        kind: 'shared-camera',
        slotIndex: index,
        repair: 'auto',
        message: `an earlier still in "${set}" already stands at "${position}" facing ${brief.camera.facing}; move the camera`,
      })
      continue
    }
    if (!cameras.has(key)) cameras.set(key, index)
  }
```

`slotSet` returns the set name as the finding messages already use it; confirm it returns the set's display name (not lower-cased) and adjust the expected message if it does not.

Run: `cd packages/schemas && npx vitest run direction`
Expected: PASS.

- [ ] **Step 3: Confirm the callers pass the camera.** `apps/web/inngest/lib/direction.ts:272` and `apps/web/inngest/functions/visuals-replanner.ts:201` pass `slot.brief` objects; a parsed `StillBrief` carries `camera`, so no change is needed if they pass the parsed brief. If either maps fields by hand, add `camera`. Run `cd apps/web && npx vitest run direction visuals-replanner` (Bash `timeout` 600000). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm format:check
git add packages/schemas apps/web/inngest
git commit -m "feat(schemas): two stills sharing a camera in one room is a finding the repair moves (decision 275)"
```

---

### Task 12: The Camera row on the board

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/camera-row.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`BriefPatchSchema`, `editBriefAction`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (render `CameraRow` in the slot card)
- Test: `apps/web/app/(console)/projects/[id]/camera-row.test.tsx` (create), `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Consumes: `SetCameraSchema`, `SET_PLATE_DIRECTIONS` (Task 1).
- Produces: `CameraRow({ slotId, projectId, camera, busy, act })`; `editBriefAction(projectId, slotId, { camera })`.

- [ ] **Step 1: Failing action tests** in `visuals-actions.test.ts` (use the file's existing helpers to seed a still slot with `set`):

```ts
  it('saves a camera on a still in a set, which then owes work (decision 275)', async () => {
    // seed a still slot whose brief names a set, as the file's other still tests do
    const result = await editBriefAction(PROJECT_ID, slotId, {
      camera: { facing: 'west', position: 'the corridor glass', lens: '50mm' },
    })
    expect(result.ok).toBe(true)
    const stored = await getShotSlot(db, slotId)
    expect((stored?.brief as { camera?: unknown }).camera).toEqual({
      facing: 'west',
      position: 'the corridor glass',
      lens: '50mm',
    })
  })

  it('refuses a camera on a slot that names no set', async () => {
    // seed a still slot with no set
    expect(await editBriefAction(PROJECT_ID, slotId, { camera: { facing: 'west', position: 'x y z' } })).toEqual({
      ok: false,
      error: 'Only a still in a set has a camera to place.',
    })
  })

  // Review Focus 5.
  it('refuses a camera on a linked slot', async () => {
    // seed a still-in-a-set slot that reuses another slot's shot, as the file's linked tests do
    const result = await editBriefAction(PROJECT_ID, linkedSlotId, { camera: { facing: 'west', position: 'x y z' } })
    expect(result.ok).toBe(false)
  })
```

- [ ] **Step 2: Run to fail, then implement the action.** `BriefPatchSchema` gains `camera: SetCameraSchema.optional()`. In `editBriefAction`, after `current` parses and before merging:

```ts
  if (parsedPatch.data.camera !== undefined) {
    if (current.data.type !== 'still' || !current.data.set) {
      return { ok: false, error: 'Only a still in a set has a camera to place.' }
    }
    const linked = await linkedSlotRefusal(slot)
    if (linked) return linked
  }
```

(`linkedSlotRefusal` is already used by `setSlotRouteAction` in the same file.)

Run: `cd apps/web && npx vitest run visuals-actions.test` (Bash `timeout` 600000)
Expected: PASS.

- [ ] **Step 3: Failing component test** in `camera-row.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CameraRow } from './camera-row'

const actions = vi.hoisted(() => ({ editBriefAction: vi.fn(async () => ({ ok: true })) }))
vi.mock('./visuals-actions', () => actions)

describe('CameraRow', () => {
  it('shows the camera and saves a new facing, position and lens', async () => {
    const act = vi.fn(async (_slot: string, run: () => Promise<{ ok: boolean }>) => run())
    render(
      <CameraRow
        slotId="s1"
        projectId="p1"
        camera={{ facing: 'north', position: 'the south doorway', lens: '35mm' }}
        busy={false}
        act={act}
      />,
    )
    expect(screen.getByRole('button', { name: 'North' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'East' }))
    const position = screen.getByLabelText('Position')
    await userEvent.clear(position)
    await userEvent.type(position, 'the window seat')
    await userEvent.click(screen.getByRole('button', { name: 'Save camera' }))
    expect(actions.editBriefAction).toHaveBeenCalledWith('p1', 's1', {
      camera: { facing: 'east', position: 'the window seat', lens: '35mm' },
    })
  })

  it('says when a slot has no camera yet, and saves nothing until a position is given', () => {
    render(<CameraRow slotId="s1" projectId="p1" camera={undefined} busy={false} act={vi.fn()} />)
    expect(screen.getByText('No camera yet; set one, or re-plan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save camera' })).toBeDisabled()
  })
})
```

- [ ] **Step 4: Implement `camera-row.tsx`:**

```tsx
'use client'

import * as React from 'react'
import { SET_PLATE_DIRECTIONS } from '@boom-busters/schemas'
import type { SetCamera, SetPlateDirection } from '@boom-busters/schemas'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { editBriefAction } from './visuals-actions'
import type { ActionResult } from './visuals-actions'

/**
 * Where the camera stands in a set shot (decision 275). The planner writes
 * it; this row lets the owner move it before regenerating. Saving changes the
 * brief, so the slot owes work and Regenerate uses the new camera and the
 * plates nearest it.
 */

const LABELS: Record<SetPlateDirection, string> = {
  north: 'North',
  east: 'East',
  south: 'South',
  west: 'West',
}

export function CameraRow({
  slotId,
  projectId,
  camera,
  busy,
  act,
}: {
  slotId: string
  projectId: string
  camera: SetCamera | undefined
  busy: boolean
  act: (slotId: string, run: () => Promise<ActionResult>, success: string) => Promise<ActionResult>
}) {
  const [facing, setFacing] = React.useState<SetPlateDirection>(camera?.facing ?? 'north')
  const [position, setPosition] = React.useState(camera?.position ?? '')
  const [lens, setLens] = React.useState(camera?.lens ?? '')
  const ready = position.trim().length >= 3

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-[var(--color-border)] p-3">
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Camera
        {camera ? null : (
          <span className="text-[var(--color-text-muted)]"> · No camera yet; set one, or re-plan.</span>
        )}
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Facing">
        {SET_PLATE_DIRECTIONS.map((direction) => (
          <Button
            key={direction}
            variant={facing === direction ? 'primary' : 'outline'}
            aria-pressed={facing === direction}
            onClick={() => setFacing(direction)}
          >
            {LABELS[direction]}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <div className="space-y-1">
          <Label htmlFor={`camera-${slotId}-position`}>Position</Label>
          <Input
            id={`camera-${slotId}-position`}
            value={position}
            maxLength={120}
            placeholder="the south doorway, seated eye height"
            onChange={(event) => setPosition(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`camera-${slotId}-lens`}>Lens</Label>
          <Input
            id={`camera-${slotId}-lens`}
            value={lens}
            maxLength={40}
            placeholder="35mm"
            onChange={(event) => setLens(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Button
          variant="outline"
          disabled={!ready}
          busy={busy}
          onClick={() =>
            void act(
              slotId,
              () =>
                editBriefAction(projectId, slotId, {
                  camera: {
                    facing,
                    position: position.trim(),
                    ...(lens.trim() ? { lens: lens.trim() } : {}),
                  },
                }),
              'Camera saved',
            )
          }
        >
          Save camera
        </Button>
      </div>
    </div>
  )
}
```

If `ActionResult` is not exported as a type from `visuals-actions.ts`, import it from wherever `visual-board.tsx` imports it. A type-only import from a `'use server'` file is fine; only runtime exports are restricted.

In `visual-board.tsx`, in the slot card, render directly after the `TypePicker` block:

```tsx
        {!linked && brief?.type === 'still' && brief.set && !slot.briefError ? (
          <CameraRow
            slotId={slot.id}
            projectId={projectId}
            camera={brief.camera}
            busy={busy}
            act={act}
          />
        ) : null}
```

Import `CameraRow` from `./camera-row`. The `key` of the card already changes per slot; the row's state initialises from the stored camera on mount.

- [ ] **Step 5: Run and commit**

Run: `pnpm typecheck`, then `cd apps/web && npx vitest run camera-row visual-board.test visuals-actions.test` (Bash `timeout` 600000)
Expected: PASS.

```bash
pnpm format:check
git add apps/web
git commit -m "feat(board): a Camera row places a set shot's camera before regenerating (decision 275)"
```

---

### Task 13: The live set harness, capped at $1 a run

The owner's instruction, 2026-09-24: "I want you to be able to do single set tests, with permission to use costs to test a set, and then test how it translates to a shot, then you can review the images generated from the sets and then output of the shot and then review and improve ... just ensure that spend doesn't exceed $1 per test. Then it must ask for my approval."

A command-line harness that runs the real set-to-shot path against Gemini outside the app, writes every image and prompt to a folder for review, and refuses any call that would take the run past $1. It is never part of `pnpm test` or `pnpm e2e` (it needs a real key and spends money); only its budget guard and argument parsing are unit-tested.

**Files:**
- Create: `apps/web/lib/still-prompt.ts` (moved, pure: `withReferenceClause` and its helpers)
- Create: `apps/web/lib/set-layout-prompt.ts` (moved, pure: the inventory draft request)
- Modify: `apps/web/lib/visual-assets.ts`, `apps/web/lib/set-layout.ts` (import the moved code)
- Create: `apps/web/lib/live-budget.ts`
- Create: `apps/web/scripts/live-set-test.ts`
- Modify: `apps/web/package.json` (script `live:set`)
- Test: `apps/web/lib/live-budget.test.ts`

**Interfaces:**
- Consumes: `buildSetSheetPrompt`, `setPlateBrief`, `describeCamera` (Tasks 7, 1, 10); `splitContactSheet` (Task 6); `geminiImageGen` with `size` and `facing` (Task 4); `platesForCamera`, `parseLayout` (Tasks 1, 2); `HOUSE_PHOTOGRAPH`, `stillStyleAnchors` (Task 8).
- Produces: `withReferenceClause(prompt, people, set, camera)` exported from `apps/web/lib/still-prompt.ts` (unchanged behaviour); `layoutDraftRequest(input: { name: string; look: string; image: { mimeType; data } }): LLMTaskRequest` from `apps/web/lib/set-layout-prompt.ts`; `class LiveBudget { constructor(capUsd: number); reserve(label: string, estimateUsd: number): void; record(label: string, actualUsd: number): void; get spentUsd(): number; get entries(): { label: string; usd: number }[] }` and `class BudgetExceeded extends Error`.

- [ ] **Step 1: Move the pure prompt code out of database-bound modules.** The harness must not import `visual-assets.ts` or `set-layout.ts`, which import the database client at module load. Move `withReferenceClause`, `REFERENCE_MARKER`, `photographCount` and `andList` from `visual-assets.ts` into `apps/web/lib/still-prompt.ts` unchanged (export `withReferenceClause` and `REFERENCE_MARKER`), and import them back into `visual-assets.ts`. Move `SYSTEM` and `request()` from `set-layout.ts` into `apps/web/lib/set-layout-prompt.ts` as:

```ts
export function layoutDraftRequest(input: {
  name: string
  look: string
  image: { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string }
}): LLMTaskRequest {
  return {
    task: 'shotlist',
    system: SYSTEM,
    messages: [{ role: 'user', content: request(input.name, input.look), images: [input.image] }],
    maxTokens: 600,
  }
}
```

and have `draftSetLayout` call `callLlm(layoutDraftRequest({...}), { projectId })`. Run `cd apps/web && npx vitest run visual-assets.test set-actions.test` (Bash `timeout` 600000). Expected: PASS with no test changes (pure move).

- [ ] **Step 2: Failing budget tests** in `apps/web/lib/live-budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BudgetExceeded, LiveBudget } from './live-budget'

describe('LiveBudget', () => {
  it('lets calls through while the estimate fits, and records what they cost', () => {
    const budget = new LiveBudget(1)
    budget.reserve('sheet', 0.24)
    budget.record('sheet', 0.24)
    budget.reserve('shot', 0.07)
    budget.record('shot', 0.07)
    expect(budget.spentUsd).toBeCloseTo(0.31)
    expect(budget.entries).toEqual([
      { label: 'sheet', usd: 0.24 },
      { label: 'shot', usd: 0.07 },
    ])
  })

  it('refuses the call that would pass the cap, before it is made', () => {
    const budget = new LiveBudget(1)
    budget.reserve('a', 0.9)
    budget.record('a', 0.9)
    expect(() => budget.reserve('b', 0.24)).toThrow(BudgetExceeded)
    expect(() => budget.reserve('b', 0.24)).toThrow(
      'b would take this run to $1.14, past its $1.00 cap. Ask the owner before spending more.',
    )
    expect(budget.spentUsd).toBeCloseTo(0.9)
  })

  it('counts an unrecorded reservation, so two quick calls cannot both slip under', () => {
    const budget = new LiveBudget(0.5)
    budget.reserve('a', 0.3)
    expect(() => budget.reserve('b', 0.3)).toThrow(BudgetExceeded)
  })
})
```

- [ ] **Step 3: Implement `apps/web/lib/live-budget.ts`:**

```ts
/**
 * The spend cap on a live harness run (decision 275; the owner's rule: at
 * most $1 per test, and ask before more). Every paid call reserves its
 * estimate first and is refused if the run would pass the cap; `record`
 * replaces the reservation with what the call actually cost.
 */
export class BudgetExceeded extends Error {}

export class LiveBudget {
  private readonly items: { label: string; usd: number; settled: boolean }[] = []

  constructor(private readonly capUsd: number) {}

  get spentUsd(): number {
    return this.items.reduce((total, item) => total + item.usd, 0)
  }

  get entries(): { label: string; usd: number }[] {
    return this.items.map(({ label, usd }) => ({ label, usd }))
  }

  reserve(label: string, estimateUsd: number): void {
    const next = this.spentUsd + estimateUsd
    if (next > this.capUsd + 1e-9) {
      throw new BudgetExceeded(
        `${label} would take this run to $${next.toFixed(2)}, past its $${this.capUsd.toFixed(2)} cap. ` +
          'Ask the owner before spending more.',
      )
    }
    this.items.push({ label, usd: estimateUsd, settled: false })
  }

  record(label: string, actualUsd: number): void {
    const item = this.items.find((entry) => entry.label === label && !entry.settled)
    if (item) {
      item.usd = actualUsd
      item.settled = true
    } else {
      this.items.push({ label, usd: actualUsd, settled: true })
    }
  }
}
```

Run: `cd apps/web && npx vitest run live-budget`. Expected: PASS.

- [ ] **Step 4: The harness `apps/web/scripts/live-set-test.ts`.** Run as `pnpm --filter @boom-busters/web live:set -- --image <path> --name "<set name>" [--look "<look>"] [--layout <file>] [--out <dir>] [--shot <file.json>] [--cap 1]`. Add to `apps/web/package.json` scripts: `"live:set": "tsx --env-file=../../.env.local scripts/live-set-test.ts"` (use `node --env-file` with `tsx/esm` if the installed tsx does not accept `--env-file`).

Behaviour, in order; every paid call goes through `budget.reserve(label, estimate)` before it is made and `budget.record(label, actual)` after:
1. Read `GEMINI_API_KEY` from the environment. If it is missing, print `Set GEMINI_API_KEY in .env.local (a Google AI Studio key). Nothing was spent.` and exit 1. Never print the key or any part of it.
2. Read `--image` (jpeg, png or webp) as the set's first plate, facing north.
3. The inventory: `--layout` file contents if given; otherwise one call to `google.complete(layoutDraftRequest({ name, look, image }), { apiKey, model: 'gemini-3.5-flash-lite' })`, reserved at $0.01, recorded at `result`'s token cost (use the adapter's own pricing helper if one is exported; else record $0.01).
4. The sheet: `buildSetSheetPrompt({ name, layout, look, styleAnchors: stillStyleAnchors(DEFAULT_SETTINGS.brandKit) })`, generated with `geminiImageGen.generate({ prompt, count: 1, model: 'gemini-3-pro-image', size: '4K', references: [{ name, kind: 'object', facing: 'north', mimeType, data }] }, { apiKey })`, reserved at `imageGenPrice(geminiImageGen, 1, 'gemini-3-pro-image', '4K')`, recorded at `estimatedCostUsd`. Save `sheet.png`. Split with `splitContactSheet`; if it returns null, write `run.json` and exit 2 with `The sheet came back without clear borders; see sheet.png.`. Save `panel-north.png` … `panel-west.png`.
5. The plates the shot may use: the original image as `north`, and the east, south and west panels.
6. The shot: from `--shot` (JSON: `{ "prompt": string, "camera": { "facing", "position", "lens"? } }`) or the default `{ prompt: 'Two investors in dark suits argue across the table, one leaning forward with both hands flat on the wood, the other sitting back with arms folded.', camera: { facing: 'south', position: 'the north windows, seated eye height', lens: '35mm' } }`. Choose plates with `platesForCamera(set, camera.facing, 2)`; build the prompt as generation does: `withReferenceClause(stripBannedWords(prompt + ' ' + HOUSE_PHOTOGRAPH + ' ' + anchors), [], { name, plates: chosen.length }, describeCamera(camera, layout))`; generate one image on `gemini-3.1-flash-image` at `'1K'` with the chosen plates as `object` references carrying their `facing`, reserved at `imageGenPrice(geminiImageGen, 1, 'gemini-3.1-flash-image', '1K')`. Save `shot.png`.
7. Write `run.json` to the output folder: every prompt sent, the inventory, which plates travelled with the shot, each call's label and cost, and the total. Print the folder path and the total spent.
8. On `BudgetExceeded`, write `run.json` with what was spent so far, print the error's message, and exit 3.

The default output folder is `live-set-runs/<ISO timestamp>` under the repo root; add `live-set-runs/` to `.gitignore`. The harness writes nothing to any database and does not record to the app's cost ledger; `run.json` is the record.

- [ ] **Step 5: Verify without spending.** Run `pnpm --filter @boom-busters/web live:set -- --image x.png --name R` with `GEMINI_API_KEY` unset in a subshell (`env -u GEMINI_API_KEY pnpm ...`). Expected: the "Set GEMINI_API_KEY" line, exit 1, no network call. Run `pnpm typecheck` and `pnpm lint`.

- [ ] **Step 6: Commit**

```bash
pnpm format:check
git add apps/web .gitignore
git commit -m "feat(sets): a live set-to-shot harness for reviewing real output, capped at \$1 a run (decision 275)"
```

The live runs themselves happen after the whole branch is reviewed, by the controller, with the owner's key in `.env.local`, each capped at $1.

---

### Task 14: Record decision 275 and verify the branch

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Full verification**

Run, each with the Bash `timeout` 600000, one at a time: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`.
Expected: all clean; 9 of 9 test tasks pass. Report the per-package counts.

- [ ] **Step 2: Append decision 275 to `PROGRESS.md`**, in the file's decision style (numbered heading, date, the owner's words, then an indented body): the owner's report; the research findings (editing models keep framing; the reverse wall is missing information; 2.5 Flash is Legacy with no reasoning; references pass on a rendered look); what changed, one bullet per task; the two planning amendments (an unsplittable sheet is an error, not a candidate; `render`/`rendered` stay allowed); what is unverified (how much `HIGH` reasoning helps, how cleanly 3 Pro draws gutters at 4K); what the owner does next (switch Settings → Models → Stills to Gemini 3.1 Flash Image; Build the set on the boardroom, about $0.24; regenerate two or three boardroom stills, about $0.13 each); the verification counts from Step 1.

- [ ] **Step 3: Commit**

```bash
pnpm format:check
git add PROGRESS.md
git commit -m "docs(progress): decision 275, set building from one image and shots from any camera"
```
