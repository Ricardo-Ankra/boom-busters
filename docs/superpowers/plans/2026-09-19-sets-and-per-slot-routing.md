# Sets, the reference budget and per-slot routing: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A film's rooms become reference material the way its faces already are, the reference budget splits into characters and objects with per-model limits, and every still slot carries a model the owner can change.

**Architecture:** A `project_sets` table mirrors `cast_members` and is seeded from the Director's Book's `locations` exactly as the cast is seeded from its `principals`. A still brief names a set by name, joined with the same string matcher that joins `depicts` to the cast. Set plates travel to the image model as object references alongside the cast's character references. Each still slot stores the route it will generate on, derived by rule at plan time and editable on the board; the route is part of the resolution hash so changing it makes the slot owe work.

**Tech Stack:** pnpm monorepo, Next.js App Router, Drizzle + Postgres, Zod, Vitest, Playwright, Inngest.

**Spec:** `docs/superpowers/specs/2026-09-19-sets-and-per-slot-routing-design.md`

## Global Constraints

- **No em dashes or en dashes anywhere.** `direction-craft.test.ts` asserts `not.toMatch()` against the two dash code points on the bible. South African English spelling. Ranges read "2022 to 2025".
- **Any phrase a test asserts against `DIRECTION_CRAFT` must sit whole on one line of `direction-craft.md`.** The markdown is hard-wrapped and embedded byte-identically; a phrase straddling a wrap can never match. Edit the `.md`, then run `pnpm --filter @boom-busters/providers embed:craft`. Never hand-edit `direction-craft.ts`.
- **`'use server'` files export only async functions.** An exported const 500s every action in the segment and only e2e catches it.
- **Run `pnpm exec prettier --check .` before every commit.** CI gates on Prettier and lint-clean is not format-clean.
- **Mock providers by default.** No task calls a paid API. `MOCK_PROVIDERS=1` must exercise every new path.
- **Integration tests need Docker Desktop running** for the test database. `requireTestDatabase()` gates them.
- **Every task ends green:** `pnpm typecheck`, `pnpm lint`, and the touched package's tests.
- **Commit at the end of each task**, one logical change, with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `packages/schemas/src/sets.ts` | Set and plate shapes, `MAX_SET_PLATES`, `referencePlates`, `setForBrief` |
| `packages/schemas/src/sets.test.ts` | Its unit tests |
| `packages/db/src/sets.ts` | Every set query and mutation, plus `seedSetsFromLocations` |
| `packages/db/src/sets.integration.test.ts` | Its integration tests |
| `packages/db/drizzle/0026_*.sql` + `meta/0026_snapshot.json` | The `project_sets` table and `shot_slots.route` |
| `apps/web/app/(console)/projects/[id]/set-actions.ts` | Server actions for the Set card |
| `apps/web/app/(console)/projects/[id]/set-actions.test.ts` | Their tests |
| `apps/web/app/(console)/projects/[id]/set-card.tsx` | The Set card |
| `apps/web/app/(console)/projects/[id]/set-card.test.tsx` | Its component tests |

**Modified**

| File | Change |
| --- | --- |
| `packages/schemas/src/cast.ts` | `depictsName` becomes `nameMatches`, shared by both joins |
| `packages/schemas/src/visuals.ts` | `set?` on still and hero briefs |
| `packages/schemas/src/direction.ts` | `planWarnings` gains set counting and the unknown-set note |
| `packages/schemas/src/index.ts` | Export `./sets` |
| `packages/db/src/schema.ts` | `projectSets` table, `shotSlots.route` |
| `packages/db/src/visuals.ts` | `shotBriefHash` covers the route; `setSlotRoute` |
| `packages/db/src/index.ts` | Export `./sets` |
| `packages/providers/src/visuals/types.ts` | `ImageReference.kind`, `referenceLimits` on the provider |
| `packages/providers/src/visuals/gemini.ts` | Per-model limits, two-pool refusal |
| `packages/providers/src/visuals/fal.ts` | `referenceLimits` |
| `packages/providers/src/visuals/mock.ts` | `referenceLimits` |
| `packages/providers/src/prompts/shotlist.ts` | Sets in the prefix, the set rule, the brief shape |
| `packages/providers/src/prompts/direction-craft.md` | The set discipline line |
| `apps/web/lib/visual-assets.ts` | The budget split, plate materials, `routeForBrief`, the stored route |
| `apps/web/lib/visuals-review.ts` | `SlotView.route`, set warnings |
| `apps/web/lib/publish-review.ts` | Follows the `nameMatches` rename |
| `apps/web/inngest/lib/direction.ts` | Seed sets, load them, pass them to planning |
| `apps/web/inngest/functions/visuals-runner.ts` | Sets into planning, routes stamped after parse |
| `apps/web/inngest/functions/visuals-replanner.ts` | The same |
| `apps/web/app/(console)/projects/[id]/page.tsx` | Mount the Set card |
| `apps/web/app/(console)/projects/[id]/visuals-actions.ts` | `setSlotRouteAction` |
| `apps/web/app/(console)/projects/[id]/visual-board.tsx` | The model select in the brief editor |
| `e2e/global-setup.ts`, `e2e/tests/visual-plan.spec.ts` | A seeded set and the round trip |

---

### Task 1: One name matcher, two joins

**Files:**
- Modify: `packages/schemas/src/cast.ts:90`
- Modify: `packages/schemas/src/cast.test.ts`
- Modify: `apps/web/lib/publish-review.ts:19` and its use at line ~92

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `nameMatches(entry: string, name: string): boolean`, exported from `@boom-busters/schemas`. `depictedMembers` keeps its signature exactly. `depictsName` no longer exists.

Decision 262 built this matcher for the cast. Task 2 needs the identical rule for sets, so it is renamed to say what it does rather than which caller came first.

- [ ] **Step 1: Rename the function and widen its doc comment**

In `packages/schemas/src/cast.ts`, rename `depictsName` to `nameMatches` and replace its doc comment's first paragraph so it does not read as cast-only. Keep every line of the bug history: it is why the function exists.

```ts
/**
 * Whether one list entry names this thing, where the join key is an exact
 * name the model was asked to write alone.
 *
 * Two joins use it: a still brief's "depicts" against the cast, and its
 * "set" against the project's sets. The model does not always comply: the
 * plan of 2026-09-19 wrote "Emad Mostaque, founder and former CEO of
 * Stability AI", the prompt's own "full name and role" phrasing carried
 * into the list, and an exact-string join read every such entry as a
 * stranger. Six cast stills were routed, priced and generated as plain
 * ones, with no reference photograph, while the two whose list held the
 * bare name went to the likeness generator.
 *
 * So an entry names a thing when, ignoring case and runs of whitespace, it
 * IS the name, or it begins with the name and goes on with a separator. A
 * name that merely appears inside a longer entry ("an aide to Emad
 * Mostaque") does not match, and neither does a longer name that happens
 * to start the same way.
 */
export function nameMatches(entry: string, name: string): boolean {
  const wanted = normaliseName(name)
  const given = normaliseName(entry)
  if (wanted.length === 0 || given.length === 0) return false
  if (given === wanted) return true
  return given.startsWith(wanted) && AFTER_NAME.test(given.slice(wanted.length))
}
```

Update `depictedMembers`' body to call `nameMatches`, and its doc comment's last sentence to read "Routing, pricing, the photographs sent and the altered-content label all go through it, so none of them can answer differently."

- [ ] **Step 2: Update the tests to the new name**

In `packages/schemas/src/cast.test.ts`, change the import and every call from `depictsName` to `nameMatches`, and rename the describe block from `describe('depictsName', ...)` to `describe('nameMatches', ...)`. Do not change a single assertion: the behaviour is unchanged and the tests prove it.

- [ ] **Step 3: Update the one other caller**

In `apps/web/lib/publish-review.ts`, change the import from `depictsName` to `nameMatches` and the call inside `canonical`.

- [ ] **Step 4: Run the tests**

Run: `cd packages/schemas && pnpm exec vitest run src/cast.test.ts`
Expected: PASS, 11 tests.

Run: `cd apps/web && pnpm exec vitest run lib/publish-review.test.ts`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS. A missed call site fails here, which is the point of doing the rename before anything depends on it.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/cast.ts packages/schemas/src/cast.test.ts apps/web/lib/publish-review.ts
git commit -m "refactor(schemas): the name join is nameMatches, because sets need it too"
```

---

### Task 2: Set and plate shapes

**Files:**
- Create: `packages/schemas/src/sets.ts`
- Create: `packages/schemas/src/sets.test.ts`
- Modify: `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: `nameMatches` from Task 1.
- Produces:
  - `SET_PLATE_VIEWS`, `SetPlateViewSchema`, `SetPlateView`
  - `SetPlateSchema`, `SetPlate`
  - `ProjectSetSchema`, `ProjectSet` with fields `id`, `projectId`, `name`, `look`, `plates`
  - `MAX_SET_PLATES = 4`
  - `referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[]`
  - `setForBrief<T extends Pick<ProjectSet, 'name'>>(set: string | undefined, sets: readonly T[]): T | null`

- [ ] **Step 1: Write the failing tests**

Create `packages/schemas/src/sets.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  MAX_SET_PLATES,
  ProjectSetSchema,
  SetPlateSchema,
  referencePlates,
  setForBrief,
} from './sets'
import type { SetPlate } from './sets'

function plate(view: SetPlate['view'], hash = `h-${view}`): SetPlate {
  return {
    r2Key: `boom-busters/sets/p1/${hash}.jpg`,
    contentHash: hash,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 900,
    view,
    origin: 'uploaded',
  }
}

const set = {
  id: 's1',
  projectId: 'p1',
  name: 'Venture Capital Boardroom',
  look: 'A high-end austere meeting room with a long polished table.',
  plates: [plate('detail'), plate('establishing')],
}

describe('set schemas', () => {
  it('parses a set with plates', () => {
    expect(ProjectSetSchema.parse(set).plates).toHaveLength(2)
  })

  it('caps the plates at four', () => {
    const many = { ...set, plates: [1, 2, 3, 4, 5].map((n) => plate('other', `h${n}`)) }
    expect(ProjectSetSchema.safeParse(many).success).toBe(false)
    expect(MAX_SET_PLATES).toBe(4)
  })

  it('refuses a plate type the image models do not take', () => {
    expect(SetPlateSchema.safeParse({ ...plate('other'), mimeType: 'image/gif' }).success).toBe(
      false,
    )
  })

  it('needs a name: it is the join key a brief uses', () => {
    expect(ProjectSetSchema.safeParse({ ...set, name: '  ' }).success).toBe(false)
  })

  it('remembers whether a plate was uploaded or generated', () => {
    expect(SetPlateSchema.parse({ ...plate('other'), origin: 'generated' }).origin).toBe(
      'generated',
    )
    expect(SetPlateSchema.safeParse({ ...plate('other'), origin: 'borrowed' }).success).toBe(false)
  })
})

describe('referencePlates', () => {
  it('sends the establishing view first and honours the limit', () => {
    expect(referencePlates(set, 2).map((p) => p.view)).toEqual(['establishing', 'detail'])
    expect(referencePlates(set, 1).map((p) => p.view)).toEqual(['establishing'])
    expect(referencePlates(set, 0)).toEqual([])
  })
})

describe('setForBrief', () => {
  const boardroom = { name: 'Venture Capital Boardroom' }
  const office = { name: 'Stability AI London Headquarters' }

  it('matches the exact name and a name carrying a description', () => {
    expect(setForBrief('Venture Capital Boardroom', [office, boardroom])).toBe(boardroom)
    expect(setForBrief('Venture Capital Boardroom, at dusk', [office, boardroom])).toBe(boardroom)
  })

  it('returns null for no set, an unknown set, or a name merely mentioned', () => {
    expect(setForBrief(undefined, [boardroom])).toBeNull()
    expect(setForBrief('   ', [boardroom])).toBeNull()
    expect(setForBrief('A car park', [boardroom])).toBeNull()
    expect(setForBrief('outside the Venture Capital Boardroom', [boardroom])).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch every one fail**

Run: `cd packages/schemas && pnpm exec vitest run src/sets.test.ts`
Expected: FAIL, "Failed to resolve import ./sets".

- [ ] **Step 3: Write the module**

Create `packages/schemas/src/sets.ts`:

```ts
import { z } from 'zod'
import { CastPhotoMimeSchema, nameMatches } from './cast'

/**
 * A set (decision 264): a place the film returns to, held as reference
 * photographs so that the same room is the same room in every shot of it.
 *
 * The cast's twin. A text prompt carries a genre of room and never a room,
 * so a film that describes the same boardroom twelve times gets twelve
 * boardrooms; the plates are what make it one. Its own table rather than a
 * field on the Director's Book for the same reason the cast has one: the
 * book's card leaves the screen when the plan is approved, and the rooms
 * are needed for the rest of the film.
 *
 * The book calls these "locations" and seeds them, exactly as its
 * "principals" seed the cast.
 */

export const SET_PLATE_VIEWS = ['establishing', 'detail', 'other'] as const
export const SetPlateViewSchema = z.enum(SET_PLATE_VIEWS)
export type SetPlateView = z.infer<typeof SetPlateViewSchema>

/** Two or three angles pin a room; beyond four the model averages a different one. */
export const MAX_SET_PLATES = 4

export const SetPlateSchema = z.object({
  /** boom-busters/sets/<projectId>/<contentHash>.<ext> */
  r2Key: z.string().min(1),
  contentHash: z.string().min(1),
  mimeType: CastPhotoMimeSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  view: SetPlateViewSchema,
  /**
   * A generated plate is the film's own invention and safe to replace; an
   * uploaded one is evidence the producer chose. The card treats them
   * differently and the ledger only ever paid for the first kind.
   */
  origin: z.enum(['uploaded', 'generated']),
  /** Where an uploaded plate was found. Provenance, not a licence. */
  sourceUrl: z.string().url().optional(),
})
export type SetPlate = z.infer<typeof SetPlateSchema>

export const ProjectSetSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** Exact name: the join key a still brief's "set" names. */
  name: z.string().trim().min(1).max(120),
  /** The book's look line, editable. Used to generate a plate and nothing else. */
  look: z.string().max(600),
  plates: z.array(SetPlateSchema).max(MAX_SET_PLATES),
})
export type ProjectSet = z.infer<typeof ProjectSetSchema>

/** The order plates are sent: an establishing view first, then upload order. */
export function referencePlates(set: Pick<ProjectSet, 'plates'>, limit = 1): SetPlate[] {
  const establishing = set.plates.filter((plate) => plate.view === 'establishing')
  const rest = set.plates.filter((plate) => plate.view !== 'establishing')
  return [...establishing, ...rest].slice(0, Math.max(0, limit))
}

/**
 * The set a brief names, or null. THE join between a brief and the set
 * library, on the same matcher the cast join uses, so a planner that writes
 * the room's name with a description after it still lands on the room
 * (decision 262 is what happens when it does not).
 */
export function setForBrief<T extends Pick<ProjectSet, 'name'>>(
  set: string | undefined,
  sets: readonly T[],
): T | null {
  const wanted = (set ?? '').trim()
  if (wanted.length === 0) return null
  return sets.find((candidate) => nameMatches(wanted, candidate.name)) ?? null
}
```

- [ ] **Step 4: Export it**

In `packages/schemas/src/index.ts`, add `export * from './sets'` immediately after the `export * from './cast'` line so the two read together.

- [ ] **Step 5: Run the tests**

Run: `cd packages/schemas && pnpm exec vitest run src/sets.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src/sets.ts packages/schemas/src/sets.test.ts packages/schemas/src/index.ts
git commit -m "feat(schemas): a set is a room the film returns to, held as plates (decision 264)"
```

---

### Task 3: A brief names a set, and the plan warns about how it is used

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (`StillBriefSchema` ~line 135, `HeroBriefSchema` ~line 245)
- Modify: `packages/schemas/src/direction.ts` (`WarnableSlot` ~line 101, `planWarnings` ~line 149)
- Modify: `packages/schemas/src/visuals.test.ts`, `packages/schemas/src/direction.test.ts`

**Interfaces:**
- Consumes: `setForBrief` from Task 2.
- Produces:
  - `StillBrief.set?: string` and `HeroBrief.set?: string`
  - `WarnableSlot` gains `chapter?: string` (already there) and nothing else; `planWarnings(slots, bannedWords, motifs = [], setNames = [])` gains a fourth parameter.

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/src/visuals.test.ts`:

```ts
describe('a still brief may name a set', () => {
  const base = {
    type: 'still' as const,
    coversText: 'x',
    description: 'x',
    shotSize: 'medium' as const,
    motion: { kind: 'static' as const },
    transition: 'cut' as const,
    prompt: 'p',
  }

  it('accepts a set name and leaves it off when absent', () => {
    expect(StillBriefSchema.parse({ ...base, set: 'Venture Capital Boardroom' }).set).toBe(
      'Venture Capital Boardroom',
    )
    expect(StillBriefSchema.parse(base).set).toBeUndefined()
  })

  it('refuses an empty set name, which would join to nothing', () => {
    expect(StillBriefSchema.safeParse({ ...base, set: '' }).success).toBe(false)
  })
})
```

Append to `packages/schemas/src/direction.test.ts`:

```ts
describe('planWarnings counts sets', () => {
  const slot = (chapter: string, set?: string) => ({
    brief: {
      type: 'still' as const,
      coversText: 'x',
      description: 'x',
      motion: { kind: 'static' as const },
      transition: 'cut' as const,
      prompt: 'a room',
      ...(set ? { set } : {}),
    },
    chapter,
  })

  it('notes a set carrying more than half a chapter of picture briefs', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.some((w) => w.includes('3 of 4 picture briefs in chapter 1'))).toBe(true)
  })

  it('notes a set in two adjacent slots', () => {
    const slots = [
      slot('chapter 1', 'Venture Capital Boardroom'),
      slot('chapter 1', 'Venture Capital Boardroom'),
    ]
    const warnings = planWarnings(slots, [], [], ['Venture Capital Boardroom'])
    expect(warnings.some((w) => w.includes('two adjacent slots'))).toBe(true)
  })

  it('notes a set the project does not hold, because it conditions nothing', () => {
    const warnings = planWarnings([slot('chapter 1', 'A car park')], [], [], ['The boardroom'])
    expect(warnings.some((w) => w.includes('no set named "A car park"'))).toBe(true)
  })

  it('says nothing when no slot names a set', () => {
    expect(planWarnings([slot('chapter 1')], [], [], ['The boardroom'])).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/schemas && pnpm exec vitest run src/visuals.test.ts src/direction.test.ts`
Expected: FAIL. The visuals tests fail because `set` is stripped by the schema; the direction tests fail because `planWarnings` takes three parameters.

- [ ] **Step 3: Add the field to both briefs**

In `packages/schemas/src/visuals.ts`, add to `StillBriefSchema` immediately after its `depicts` field:

```ts
  /**
   * The set this shot happens in, by exact name (decision 264). Its plates
   * ride along with the prompt, so the same room is the same room in every
   * shot of it. A name the project does not hold generates as a plain
   * still and is noted on the plan screen.
   */
  set: z.string().min(1).optional(),
```

Add the identical field to `HeroBriefSchema` after its own `depicts`, with the comment shortened to `/** The set this shot happens in, by exact name (decision 264). */`.

- [ ] **Step 4: Extend planWarnings**

In `packages/schemas/src/direction.ts`, add a private helper beside `motifText`:

```ts
/** The set a warnable slot names, or null. Only picture briefs can name one. */
function slotSet(brief: WarnableSlot['brief']): string | null {
  if (brief.type !== 'still' && brief.type !== 'hero') return null
  return brief.set?.trim() || null
}
```

Change the signature to:

```ts
export function planWarnings(
  slots: readonly WarnableSlot[],
  bannedWords: readonly string[],
  motifs: readonly string[] = [],
  setNames: readonly string[] = [],
): string[] {
```

and append this block immediately before the final `return warnings`:

```ts
  // Sets carry decision 260's risk in a new place: a room named on every
  // brief is the new empty chair. Counted per chapter, like a motif, and
  // never a rejection.
  const byChapter = new Map<string, { total: number; sets: Map<string, number> }>()
  for (const slot of slots) {
    const chapter = slot.chapter ?? 'the film'
    const entry = byChapter.get(chapter) ?? { total: 0, sets: new Map() }
    if (slot.brief.type === 'still' || slot.brief.type === 'hero') {
      entry.total += 1
      const named = slotSet(slot.brief)
      if (named) entry.sets.set(named, (entry.sets.get(named) ?? 0) + 1)
    }
    byChapter.set(chapter, entry)
  }
  for (const [chapter, entry] of byChapter) {
    for (const [name, count] of entry.sets) {
      if (entry.total > 1 && count * 2 > entry.total) {
        warnings.push(
          `the set "${name}" carries ${count} of ${entry.total} picture briefs in ${chapter}`,
        )
      }
    }
  }

  for (const [index, slot] of slots.entries()) {
    const here = slotSet(slot.brief)
    const next = slots[index + 1] ? slotSet(slots[index + 1]!.brief) : null
    if (here && next && here === next) {
      warnings.push(`the set "${here}" fills two adjacent slots (from slot ${index})`)
    }
  }

  // A set nothing holds conditions nothing, exactly like a depicts name with
  // no photograph, and is worth saying before the money is spent.
  if (setNames.length > 0) {
    const unknown = new Set<string>()
    for (const slot of slots) {
      const named = slotSet(slot.brief)
      if (named && !setNames.some((name) => nameMatches(named, name))) unknown.add(named)
    }
    for (const name of unknown) {
      warnings.push(`the film has no set named "${name}", so that shot is generated plain`)
    }
  }
```

Import `nameMatches` from `./cast` at the top of the file.

- [ ] **Step 5: Run the tests**

Run: `cd packages/schemas && pnpm exec vitest run`
Expected: PASS, all files. Existing three-argument callers still compile because the fourth parameter defaults.

- [ ] **Step 6: Commit**

```bash
git add packages/schemas/src
git commit -m "feat(schemas): a brief names its set, and the plan counts how often (decision 264)"
```

---

### Task 4: The table and the route column

**Files:**
- Modify: `packages/db/src/schema.ts` (after the `castMembers` table, ~line 667; and `shotSlots`, ~line 631)
- Create: `packages/db/drizzle/0026_*.sql` and `packages/db/drizzle/meta/0026_snapshot.json` (both generated)
- Modify: `packages/db/drizzle/meta/_journal.json` (generated)

**Interfaces:**
- Consumes: nothing.
- Produces: `projectSets` table and `ProjectSetRow`, and `shotSlots.route`.

- [ ] **Step 1: Add the table**

In `packages/db/src/schema.ts`, immediately after the `castMembers` table and its `CastMemberRow` type, add:

```ts
/**
 * A film's sets (decision 264): the rooms it returns to, with the reference
 * plates that keep them the same room in every shot.
 *
 * The cast's twin, and its own table for the same reason: the Director's
 * Book's card leaves the screen when the plan is approved, and the rooms are
 * needed for every still after that. Seeded from the book's locations.
 */
export const projectSets = pgTable(
  'project_sets',
  {
    id: id(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Exact name: the join key a still brief's `set` names. */
    name: text('name').notNull(),
    /** The book's look line, editable. Used to generate a plate, and nowhere else. */
    look: text('look').notNull().default(''),
    plates: jsonb('plates')
      .notNull()
      .default(sql`'[]'::jsonb`)
      .$type<Record<string, unknown>[]>(),
    /**
     * Set when the producer removes a set the Director's Book named. The row
     * stays so the next draft of the book does not add it back; the sets the
     * app shows and generates from are the rows where this is null.
     */
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('project_sets_project_name_idx').on(t.projectId, t.name)],
)
export type ProjectSetRow = typeof projectSets.$inferSelect
```

Add `projectSets: many(projectSets),` to the projects relations object, beside the `castMembers` line.

- [ ] **Step 2: Add the route column**

In the `shotSlots` table, immediately after `reuseOfSlotId`, add:

```ts
    /**
     * The image route this slot generates on (decision 264), as
     * `{ provider, model }`. Derived by rule when the shot list is planned
     * and changed by the owner in the brief editor; null means fall back to
     * the derived route at generation time. It is part of the resolution
     * hash, so changing the model makes the slot owe work.
     */
    route: jsonb('route').$type<Record<string, unknown>>(),
```

- [ ] **Step 3: Generate the migration**

Run: `pnpm --filter @boom-busters/db generate`

Expected: a new `0026_<name>.sql` holding `CREATE TABLE "project_sets"`, its foreign key, its unique index, and `ALTER TABLE "shot_slots" ADD COLUMN "route" jsonb;`. Read the generated SQL and confirm it contains nothing else. If drizzle-kit proposes dropping or renaming anything, stop and report it rather than applying it.

- [ ] **Step 4: Apply it to the test database and prove it landed**

Run: `pnpm --filter @boom-busters/db migrate:test`

Expected: applies cleanly. Docker Desktop must be running first.

Run: `cd packages/db && pnpm exec vitest run src/db.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(db): a project holds sets, and a slot holds its route (decision 264)"
```

---

### Task 5: Set queries

**Files:**
- Create: `packages/db/src/sets.ts`
- Create: `packages/db/src/sets.integration.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `projectSets` from Task 4; `ProjectSet`, `SetPlate`, `MAX_SET_PLATES` from Task 2.
- Produces, all exported from `@boom-busters/db`:
  - `listProjectSets(db, projectId): Promise<ProjectSet[]>`, active only, oldest first
  - `getProjectSet(db, id): Promise<ProjectSet | null>`, active only
  - `insertProjectSet(db, input: { projectId: string; name: string; look?: string }): Promise<ProjectSet>`
  - `updateProjectSet(db, id, patch: Partial<Pick<ProjectSet, 'name' | 'look'>>): Promise<ProjectSet>`
  - `setSetPlates(db, id, plates: readonly SetPlate[]): Promise<ProjectSet>`
  - `dismissProjectSet(db, id): Promise<void>`
  - `deleteProjectSet(db, id): Promise<void>`
  - `seedSetsFromLocations(db, projectId, locations: readonly { name: string; look: string }[]): Promise<ProjectSet[]>`

This file is `packages/db/src/cast.ts` with different nouns. Read that file in full first and mirror it exactly: the private `toSet` parser that runs every row through the schema, the private `active` predicate combining `eq(projectId)` with `isNull(dismissedAt)`, `ValidationError` on an empty name, the revive-a-dismissed-row branch inside insert, the `isNull(dismissedAt)` guard on every update, and `onConflictDoNothing()` in the seeder.

The differences from `cast.ts`, in full, are only these five:

1. There is no `role`, `identityString` or `guardrail`. There is `look`, which may be empty.
2. `insertProjectSet` takes an optional `look` defaulting to `''`. A revived row takes the new `look` and starts with no plates, exactly as a revived cast member takes the new role and starts with no photos.
3. The plate cap message reads ``A set keeps at most ${MAX_SET_PLATES} plates; remove one first.``
4. `seedSetsFromLocations` takes `{ name, look }` pairs rather than principals, so it has no `depiction` to skip on. It still skips a name already taken live or dismissed, case-insensitively.
5. The error messages say set: `A set needs a name.`, `A set with that exact name already exists.`, ``Set ${id} no longer exists``.

- [ ] **Step 1: Write the failing integration tests**

Create `packages/db/src/sets.integration.test.ts`, mirroring the setup in `packages/db/src/cast.integration.test.ts` exactly: the `requireTestDatabase()` gate, the `describeDb` constant, the seeded fixture project, and the per-test cleanup. Cover these ten cases, one `it` each:

```
lists only the sets that are not dismissed, oldest first
refuses a second set with the same name in one project
allows the same set name in a different project
revives a dismissed set rather than refusing the name, with the new look and no plates
refuses a set with no name
keeps at most four plates
updating a set that was dismissed throws
dismissing empties the plates and hides the set from the list
seedSetsFromLocations inserts the book's locations and skips one already held
seedSetsFromLocations does not resurrect a dismissed set
```

Every assertion is against the returned `ProjectSet`, never against a raw row.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && pnpm exec vitest run src/sets.integration.test.ts`

Expected: FAIL, "Failed to resolve import ./sets".

- [ ] **Step 3: Write the module**

Create `packages/db/src/sets.ts` following the five differences above, headed with:

```ts
/**
 * The set library (decision 264): a project's rooms and the reference plates
 * that keep each one the same room in every shot of it.
 *
 * Deliberately `cast.ts` with different nouns, down to the dismissal
 * behaviour, because a producer who has learned the Cast card has learned
 * this one too. The Director's Book seeds both.
 */
```

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts`, add `export * from './sets'` immediately after the `./cast` export.

- [ ] **Step 5: Run the tests**

Run: `cd packages/db && pnpm exec vitest run src/sets.integration.test.ts`

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/sets.ts packages/db/src/sets.integration.test.ts packages/db/src/index.ts
git commit -m "feat(db): the set library, seeded from the book's locations (decision 264)"
```

---

### Task 6: The route lives on the slot, and the hash covers it

**Files:**
- Modify: `packages/db/src/visuals.ts:40` (`shotBriefHash`), `:47` (`slotNeedsResolution`), and add `setSlotRoute`
- Modify: `packages/db/src/visuals.integration.test.ts`
- Modify: every non-test caller of `shotBriefHash`

**Interfaces:**
- Consumes: the `route` column from Task 4.
- Produces:
  - `shotBriefHash(brief: unknown, route?: unknown): string`
  - `slotNeedsResolution(slot: { status; brief; resolvedBriefHash; reuseOfSlotId?; route? }): boolean`
  - `setSlotRoute(db, slotId: string, route: StillRoute | null): Promise<void>`, where `StillRoute` is the existing `{ provider, model }` type from `@boom-busters/schemas`. Import it; do not redeclare it.

This is its own task for one reason. Without the hash change, an owner changes a slot's model, presses Fetch visuals, and nothing happens, because the brief did not change and the pass skips a resolved slot. That is a silent dead button, and it is the single most likely way this feature ships broken.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/visuals.integration.test.ts`. Write a small `onlySlot()` helper in the file that seeds one still slot and returns it, following whatever the existing tests in that file already do to get a slot.

```ts
describe('the route a slot generates on', () => {
  it('changing the route makes a resolved slot owe work again', async () => {
    const slot = await onlySlot()
    await setSlotResolution(db, slot.id, { status: 'resolved', candidates: [] })
    expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(false)

    await setSlotRoute(db, slot.id, { provider: 'google', model: 'gemini-3-pro-image' })
    expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(true)
  })

  it('clearing the route back to null makes it owe work again too', async () => {
    const slot = await onlySlot()
    await setSlotRoute(db, slot.id, { provider: 'google', model: 'gemini-3-pro-image' })
    await setSlotResolution(db, slot.id, { status: 'resolved', candidates: [] })
    expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(false)

    await setSlotRoute(db, slot.id, null)
    expect(slotNeedsResolution((await getShotSlot(db, slot.id))!)).toBe(true)
  })

  it('a brief edit leaves the route alone', async () => {
    const slot = await onlySlot()
    const route = { provider: 'google' as const, model: 'gemini-3-pro-image' }
    await setSlotRoute(db, slot.id, route)
    await updateSlotBrief(db, slot.id, { ...(slot.brief as ShotBrief), description: 'new words' })
    expect((await getShotSlot(db, slot.id))?.route).toEqual(route)
  })

  it('a slot with no route hashes exactly as it did before routes existed', () => {
    const brief = { type: 'still', prompt: 'p' }
    expect(shotBriefHash(brief)).toBe(shotBriefHash(brief, null))
    expect(shotBriefHash(brief)).not.toBe(
      shotBriefHash(brief, { provider: 'google', model: 'gemini-3-pro-image' }),
    )
  })
})
```

That last case is the migration safety net: every `resolved_brief_hash` already in the production database was computed without a route, and must keep matching.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/db && pnpm exec vitest run src/visuals.integration.test.ts`

Expected: FAIL, `setSlotRoute is not exported`.

- [ ] **Step 3: Make the hash cover the route**

Replace `shotBriefHash` in `packages/db/src/visuals.ts`:

```ts
/**
 * The no-waste guard's fingerprint (staged-visuals design 2026-08-26), over
 * the brief AND the route it generates on (decision 264).
 *
 * The route is in here because changing the model is a reason to re-buy a
 * shot, and it is the only such reason that does not touch the brief. Left
 * out, the owner picks a different model on the board, presses Fetch
 * visuals, and the pass skips the slot as already resolved.
 *
 * A slot with no route hashes exactly as it did before this existed, so
 * every stamp already in the database stays valid and no live board
 * suddenly owes work for every slot it holds.
 */
export function shotBriefHash(brief: unknown, route?: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(route ? { brief, route } : brief))
    .digest('hex')
}
```

and widen the guard:

```ts
export function slotNeedsResolution(slot: {
  status: ShotSlotStatus
  brief: unknown
  resolvedBriefHash: string | null
  reuseOfSlotId?: string | null | undefined
  route?: unknown
}): boolean {
  if (slot.reuseOfSlotId) return false
  return (
    slot.status !== 'resolved' || slot.resolvedBriefHash !== shotBriefHash(slot.brief, slot.route)
  )
}
```

- [ ] **Step 4: Add the writer**

Add beside `updateSlotBrief`:

```ts
/**
 * Set or clear the route one slot generates on (decision 264). It does not
 * touch status: the hash covers the route, so the next pass sees that the
 * slot owes work without anything else being written.
 */
export async function setSlotRoute(
  db: Database,
  slotId: string,
  route: StillRoute | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({ route: route as Record<string, unknown> | null, updatedAt: new Date() })
    .where(eq(shotSlots.id, slotId))
}
```

- [ ] **Step 5: Fix every caller that stamps the hash**

Every place that writes `resolvedBriefHash` must now pass the route, or it stamps a hash the slot will never match and the slot owes work forever. Find them:

```bash
grep -rn "shotBriefHash" --include=*.ts apps packages | grep -v node_modules | grep -v "\.test\."
```

At each site pass the slot's `route` as the second argument. `setSlotResolution` in this same file is the main one: give it the route, either by reading the row inside it or by taking it in its input, whichever fits that function's existing shape better.

- [ ] **Step 6: Run the tests**

Run: `cd packages/db && pnpm exec vitest run`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/visuals.ts packages/db/src/visuals.integration.test.ts
git commit -m "feat(db): a slot's route is part of what a fetch pass compares (decision 264)"
```

---

### Task 7: Two reference pools, with the limits each model documents

**Files:**
- Modify: `packages/providers/src/visuals/types.ts:76` (`ImageReference`) and the `ImageGenProvider` interface, ~line 159
- Modify: `packages/providers/src/visuals/gemini.ts:58` (`GEMINI_MAX_REFERENCES`) and `generate`, ~line 96
- Modify: `packages/providers/src/visuals/fal.ts`, `packages/providers/src/visuals/mock.ts`
- Modify: `packages/providers/src/visuals/gemini.test.ts`, `packages/providers/src/visuals/adapters.test.ts`
- Modify: `apps/web/lib/visual-assets.ts` (`referenceMaterials`, to satisfy the new required field)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ImageReference.kind: 'character' | 'object'`, required
  - `ReferenceLimits { characters: number; objects: number }`
  - `ImageGenProvider.referenceLimits(modelId?: string): ReferenceLimits`, a required member

Google documents the two budgets separately and they differ by model. Our own three-in-total constant was written for Gemini 2.5, whose limits Google does not document at all.

| model | characters | objects |
| --- | --- | --- |
| `gemini-3.1-flash-image` | 4 | 10 |
| `gemini-3-pro-image` | 5 | 6 |
| `gemini-2.5-flash-image` | 3 | 0 |

The 2.5 row is a conservative stand-in for an undocumented limit: exactly today's behaviour, three character references and no object one. Guessing higher spends money to discover the ceiling.

- [ ] **Step 1: Write the failing tests**

Append to `packages/providers/src/visuals/gemini.test.ts`. Reuse whatever helper the file already has for a successful fake image response rather than writing a second one; it is called `okResponse` below.

```ts
describe('referenceLimits', () => {
  it('reads the documented budget for each model', () => {
    expect(geminiImageGen.referenceLimits('gemini-3.1-flash-image')).toEqual({
      characters: 4,
      objects: 10,
    })
    expect(geminiImageGen.referenceLimits('gemini-3-pro-image')).toEqual({
      characters: 5,
      objects: 6,
    })
  })

  it('keeps the old conservative budget for the model Google does not document', () => {
    expect(geminiImageGen.referenceLimits('gemini-2.5-flash-image')).toEqual({
      characters: 3,
      objects: 0,
    })
  })

  it('defaults to the first model when none is named', () => {
    expect(geminiImageGen.referenceLimits()).toEqual(
      geminiImageGen.referenceLimits(geminiImageGen.models[0]!.id),
    )
  })
})

describe('refusing more references than the model takes', () => {
  const ref = (kind: 'character' | 'object', n: number) => ({
    name: `r${n}`,
    kind,
    mimeType: 'image/jpeg' as const,
    data: 'AAAA',
  })

  it('refuses a fifth person on the model that takes four, before spending', async () => {
    const fetchImpl = vi.fn()
    await expect(
      geminiImageGen.generate(
        {
          prompt: 'x',
          count: 1,
          model: 'gemini-3.1-flash-image',
          references: [1, 2, 3, 4, 5].map((n) => ref('character', n)),
        },
        { apiKey: 'k', fetchImpl },
      ),
    ).rejects.toThrow(/at most 4 reference photographs of people/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses a set plate on the model that takes none', async () => {
    const fetchImpl = vi.fn()
    await expect(
      geminiImageGen.generate(
        { prompt: 'x', count: 1, model: 'gemini-2.5-flash-image', references: [ref('object', 1)] },
        { apiKey: 'k', fetchImpl },
      ),
    ).rejects.toThrow(/takes no set plates/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts people and plates together inside both budgets', async () => {
    const fetchImpl = vi.fn(okResponse)
    await geminiImageGen.generate(
      {
        prompt: 'x',
        count: 1,
        model: 'gemini-3.1-flash-image',
        references: [ref('character', 1), ref('character', 2), ref('object', 3)],
      },
      { apiKey: 'k', fetchImpl },
    )
    const body = JSON.parse(fetchImpl.mock.calls[0]![1].body)
    expect(body.contents[0].parts).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/providers && pnpm exec vitest run src/visuals/gemini.test.ts`

Expected: FAIL, `referenceLimits is not a function`.

- [ ] **Step 3: Add the kind and the contract**

In `packages/providers/src/visuals/types.ts`, add to `ImageReference`:

```ts
  /**
   * Which budget this spends (decision 264). Google documents the two
   * separately and by different amounts: a face the model must keep is a
   * character, a room or a prop it must reproduce is an object.
   */
  kind: 'character' | 'object'
```

and above the `ImageGenProvider` interface:

```ts
/** What one call may carry, per model (decision 264). */
export interface ReferenceLimits {
  characters: number
  objects: number
}
```

with this required member on `ImageGenProvider`:

```ts
  /**
   * How many references of each kind this model takes. The caller spends the
   * budget before building the request, because a refusal after the money is
   * committed is a refusal that cost something, and because "some of the
   * cast" is not an answer the producer asked for.
   */
  referenceLimits(modelId?: string): ReferenceLimits
```

Required, not optional, so every adapter has to answer.

- [ ] **Step 4: Implement it on each adapter**

In `gemini.ts`, delete `GEMINI_MAX_REFERENCES` and add:

```ts
/**
 * What each model takes, from Google's own documentation, read 2026-09-19.
 * The 2.5 row is not documented; it keeps exactly the budget this adapter
 * enforced before the two pools existed, because guessing a limit upward
 * spends money to discover it.
 */
const REFERENCE_LIMITS: Record<string, ReferenceLimits> = {
  'gemini-2.5-flash-image': { characters: 3, objects: 0 },
  'gemini-3.1-flash-image': { characters: 4, objects: 10 },
  'gemini-3-pro-image': { characters: 5, objects: 6 },
}
```

and the member:

```ts
  referenceLimits(modelId?: string): ReferenceLimits {
    const model = imageGenModel(geminiImageGen, modelId)
    return REFERENCE_LIMITS[model.id] ?? { characters: 3, objects: 0 }
  },
```

Replace the single length check inside `generate` with a per-pool one, leaving the existing "a reference without bytes" check above it untouched:

```ts
    const limits = geminiImageGen.referenceLimits(request.model)
    const characters = references.filter((reference) => reference.kind === 'character')
    const objects = references.filter((reference) => reference.kind === 'object')
    if (characters.length > limits.characters) {
      throw new ValidationError(
        `${model.label} takes at most ${limits.characters} reference photographs of people in ` +
          `one still; this brief shows ${characters.length}. Plan the group anonymously or ` +
          `split the shot.`,
        { field: 'references' },
      )
    }
    if (objects.length > limits.objects) {
      throw new ValidationError(
        limits.objects === 0
          ? `${model.label} takes no set plates. Route this slot at a Gemini 3 model, or drop ` +
            `the set from the brief.`
          : `${model.label} takes at most ${limits.objects} set plates in one still; this brief ` +
            `carries ${objects.length}.`,
        { field: 'references' },
      )
    }
```

Order the parts characters first, then objects, then the text, so the model reads the faces, then the room, then what to do with them.

In `fal.ts`, add:

```ts
  /**
   * fal caps nothing; its reference endpoint simply costs more per image
   * above one (see `resolveReferenceRoute`). These are the app's own limits,
   * chosen for what a still can usefully carry rather than what the endpoint
   * will accept.
   */
  referenceLimits(): ReferenceLimits {
    return { characters: 3, objects: 2 }
  },
```

In `mock.ts`, return the most generous shape so mock mode never refuses a path the live adapters allow: `{ characters: 4, objects: 10 }`.

- [ ] **Step 5: Give every existing construction site a kind**

`pnpm typecheck` now fails everywhere an `ImageReference` is built without `kind`. In `apps/web/lib/visual-assets.ts` (`referenceMaterials`) that is `kind: 'character'` on both the Gemini and the fal branch. In the tests it is whatever the case under test means. Fix them all; there is no default, on purpose.

- [ ] **Step 6: Run the tests**

Run: `cd packages/providers && pnpm exec vitest run src/visuals`

Expected: PASS.

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/visuals apps/web/lib/visual-assets.ts
git commit -m "feat(visuals): characters and objects are separate reference budgets (decision 264)"
```

---

### Task 8: The shot list learns what a set is

**Files:**
- Modify: `packages/providers/src/prompts/shotlist.ts` (`SLOT_SHAPES` still line ~102, `buildShotListRequest` input ~line 136, the prefix ~line 164, the person rules ~line 226)
- Modify: `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildShotListRequest` gains `sets?: readonly { name: string; look: string }[]`.

The prompt already has the exact pattern to copy: `photographed` is a list of names in the cacheable prefix plus a rule in the system prompt. Sets are the same shape, and they are listed with their look so the planner knows which room a sentence is in.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('buildShotListRequest with direction (decision 252)', ...)` block in `packages/providers/src/prompts/shotlist.test.ts`:

```ts
describe('the film knows its sets', () => {
  const withSets = buildShotListRequest({
    caseTitle: 'Stability AI',
    chapterTitle: 'The Missing Billions',
    chapterNumber: 2,
    paragraphs: PARAGRAPHS,
    claims: CLAIMS,
    styleAnchors: stillStyleAnchors(brandKit),
    direction,
    sets: [
      { name: 'Venture Capital Boardroom', look: 'A long polished table, a glass wall.' },
    ],
  })

  it('lists the sets and their look in the cacheable prefix', () => {
    const prefix = withSets.messages[0]?.content ?? ''
    expect(prefix).toContain('Sets')
    expect(prefix).toContain('- Venture Capital Boardroom: A long polished table, a glass wall.')
  })

  it('asks for the set by name alone and forbids re-describing the room', () => {
    expect(withSets.system).toContain('name it in "set" by name alone')
    expect(withSets.system).toContain('the photographs are the room')
  })

  it('says nothing about sets when the film has none', () => {
    expect(request.messages[0]?.content).not.toContain('Sets')
    expect(request.system).not.toContain('"set"')
  })
})
```

The third case matters: a project with no sets must not carry a rule about a thing it does not have, exactly as `photographed` is absent when nobody is photographed.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/shotlist.test.ts`

Expected: FAIL on all three.

- [ ] **Step 3: Take the sets as input**

Add to the `buildShotListRequest` input type, immediately after `photographed`:

```ts
  /**
   * The film's sets (decision 264): the rooms it returns to, each held as
   * reference photographs. A brief that names one is generated with those
   * photographs attached, so the room is the same room every time. Absent
   * on a project with no sets, and then no rule about them is sent.
   */
  sets?: readonly { name: string; look: string }[]
```

- [ ] **Step 4: List them in the cacheable prefix**

Beside the existing `photographed` block, add:

```ts
  const sets = (input.sets ?? []).filter((set) => set.name.trim().length > 0)
```

and extend the `prefix` expression with a third conditional section, after the photographed one:

```ts
    (sets.length > 0
      ? `\n\nSets (the rooms this film returns to; the producer holds reference ` +
        `photographs of each, so naming one puts the shot in that exact room):\n` +
        sets.map((set) => `- ${set.name}: ${set.look}`).join('\n')
      : '')
```

- [ ] **Step 5: Add the rule and the brief shape**

In `SLOT_SHAPES`, change the still line to carry the field:

```
- {"type": "still", "coversText", "description", "shotSize", "motion", "transition",
   "prompt", "negativePrompt"?, "depicts"?: [each real person shown by likeness, by
   full name alone: "Jane Doe", never "Jane Doe, chief executive"],
   "set"?: the exact name of one set listed above, alone}
```

In the planning rules, immediately after the three-kinds-of-people block inside the `"still"` rule, add this paragraph. It is only emitted when the film has sets, so wrap it the way `HERO_SLOTS_ENABLED` wraps its line:

```
  Sets are the rooms this film returns to, and the producer holds
  photographs of each. When the sentence puts us in one, name it in "set" by
  name alone and write the shot that happens inside it: what the camera
  sees, who is there, what they are doing, the light. Do not describe the
  room itself; the photographs are the room, and a written description only
  argues with them. A sentence that happens somewhere else names no set: a
  room on every slot is the same mistake as a motif on every slot.
```

- [ ] **Step 6: Run the tests**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/shotlist.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/providers/src/prompts/shotlist.ts packages/providers/src/prompts/shotlist.test.ts
git commit -m "feat(shotlist): the planner knows the film's sets and names one by name (decision 264)"
```

---

### Task 9: The bible's line on sets

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md`
- Modify: `packages/providers/src/prompts/direction-craft.ts` (generated, never by hand)
- Modify: `packages/providers/src/prompts/direction-craft.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing in code. The bible reaches the shot list, the re-brief and the redirect prompts, so one edit governs all three.

**Read the Global Constraints on the bible before starting.** The asserted phrase must sit whole on one line of the markdown, and the `.ts` is generated.

- [ ] **Step 1: Write the failing assertions**

In `packages/providers/src/prompts/direction-craft.test.ts`, add to the existing craft-rules test:

```ts
    expect(DIRECTION_CRAFT).toContain('A set is a room the film returns to')
    expect(DIRECTION_CRAFT).toContain('the photographs are the room')
    expect(DIRECTION_CRAFT).toContain('A room on every slot is a motif on every slot')
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd packages/providers && pnpm exec vitest run src/prompts/direction-craft.test.ts`

Expected: FAIL on the first new assertion.

- [ ] **Step 3: Add the rule to the markdown**

In `packages/providers/src/prompts/direction-craft.md`, in the shot-grammar section immediately after the motif bullet, add. Mind the wrapping: each asserted phrase sits whole on one line here.

```
- A set is a room the film returns to, and the producer holds
  photographs of it. Name one on a brief when the sentence puts us in
  that room, and then write only what happens inside it: the camera, the
  people, what they are doing, the light. Never describe the room again;
  the photographs are the room. A set named on a shot that happens
  somewhere else is worse than no set at all.
  A room on every slot is a motif on every slot, and that mistake has
  been made once already.
```

- [ ] **Step 4: Re-embed and run**

Run: `pnpm --filter @boom-busters/providers embed:craft`

Run: `cd packages/providers && pnpm exec vitest run src/prompts`

Expected: PASS, including the byte-identity test and the no-dash test.

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src/prompts/direction-craft.md packages/providers/src/prompts/direction-craft.ts packages/providers/src/prompts/direction-craft.test.ts
git commit -m "feat(bible): a set is a room the film returns to, named where the sentence is (decision 264)"
```

---

### Task 10: Plates ride along, and the budget is spent by kind

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (`MAX_STILL_REFERENCES` ~line 57, `spreadReferences` ~line 75, `depictedFrom` ~line 112, `referenceMaterials` ~line 177, `withReferenceClause` ~line 229, `generateStillCandidates` ~line 372)
- Modify: `apps/web/lib/visual-assets.test.ts`

**Interfaces:**
- Consumes: `setForBrief`, `referencePlates`, `MAX_SET_PLATES` from Task 2; `listProjectSets` from Task 5; `ImageReference.kind` and `referenceLimits` from Task 7.
- Produces: no new exports. `generateStillCandidates(brief, projectId)` keeps its signature and now attaches plates.

The app's own policy sits under the model's: at most 3 character photographs and at most 2 set plates in one still, and never more than the routed model's own limits. Ten object references buys nothing for a room and lengthens every request.

The spend order is people first, because a wrong face is worse than a wrong room and a likeness is what a viewer recognises:

1. One front view for each person in the frame, in cast order.
2. One establishing plate for the named set.
3. Whatever character slots remain, round-robin over further angles of the same people, exactly as today.
4. One more set plate if an object slot remains.

- [ ] **Step 1: Write the failing tests**

Append to the `describeDb('generateStillCandidates with the cast', ...)` block in `apps/web/lib/visual-assets.test.ts`. Use the existing `generate` spy on `mockImageGen` and the existing `photo` helper; add a `plate` helper beside it.

```ts
describe('a still that names a set', () => {
  beforeEach(async () => {
    await updateSettings(db, {
      modelRouting: {
        stills: { provider: 'google', model: 'gemini-3.1-flash-image' },
        stillsLikeness: null,
      },
    })
  })

  it('sends the set plate as an object reference beside the person', async () => {
    const emad = await insertCastMember(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Emad Mostaque',
      role: 'Founder',
    })
    await setCastPhotos(db, emad.id, [photo('front-1', 'front')])
    const room = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Venture Capital Boardroom',
      look: 'A long polished table.',
    })
    await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

    await generateStillCandidates(
      { ...still, set: 'Venture Capital Boardroom' },
      FIXTURE_PROJECT_ID,
    )

    const sent = generate.mock.calls[0]?.[0].references ?? []
    expect(sent.filter((r) => r.kind === 'character')).toHaveLength(1)
    expect(sent.filter((r) => r.kind === 'object')).toHaveLength(1)
  })

  it('names the room in the prompt, so the model knows which image is which', async () => {
    const room = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Venture Capital Boardroom',
      look: 'A long polished table.',
    })
    await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

    await generateStillCandidates(
      { ...still, depicts: [], set: 'Venture Capital Boardroom' },
      FIXTURE_PROJECT_ID,
    )
    expect(generate.mock.calls[0]?.[0].prompt).toContain(
      'Venture Capital Boardroom, the room in the reference photograph',
    )
  })

  it('spends people before plates when the budget is tight', async () => {
    for (const name of ['Emad Mostaque', 'Prem Akkaraju', 'Sean Parker']) {
      const member = await insertCastMember(db, {
        projectId: FIXTURE_PROJECT_ID,
        name,
        role: 'Principal',
      })
      await setCastPhotos(db, member.id, [photo(`front-${name}`, 'front')])
    }
    const room = await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Venture Capital Boardroom',
      look: 'A long polished table.',
    })
    await setSetPlates(db, room.id, [plate('plate-1', 'establishing')])

    await generateStillCandidates(
      {
        ...still,
        depicts: ['Emad Mostaque', 'Prem Akkaraju', 'Sean Parker'],
        set: 'Venture Capital Boardroom',
      },
      FIXTURE_PROJECT_ID,
    )
    const sent = generate.mock.calls[0]?.[0].references ?? []
    expect(sent.filter((r) => r.kind === 'character')).toHaveLength(3)
    expect(sent.filter((r) => r.kind === 'object')).toHaveLength(1)
  })

  it('treats a set the project does not hold as no set at all', async () => {
    await generateStillCandidates(
      { ...still, depicts: [], set: 'A car park' },
      FIXTURE_PROJECT_ID,
    )
    expect(generate.mock.calls[0]?.[0].references ?? []).toHaveLength(0)
  })

  it('sends no plate for a set that holds none', async () => {
    await insertProjectSet(db, {
      projectId: FIXTURE_PROJECT_ID,
      name: 'Venture Capital Boardroom',
      look: 'A long polished table.',
    })
    await generateStillCandidates(
      { ...still, depicts: [], set: 'Venture Capital Boardroom' },
      FIXTURE_PROJECT_ID,
    )
    expect(generate.mock.calls[0]?.[0].references ?? []).toHaveLength(0)
  })
})
```

Clear the sets between tests the way the file already clears the cast, in the outer `beforeEach`.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run lib/visual-assets.test.ts`

Expected: FAIL. The schema accepts `set` after Task 3 but nothing reads it.

- [ ] **Step 3: Replace the single budget with two**

Delete `MAX_STILL_REFERENCES` and put the app's policy beside the model's:

```ts
/**
 * What one still carries, as the app's own policy (decision 264). The routed
 * model's own limits sit above this and are asked for separately; these are
 * what a still can usefully hold.
 *
 * Character slots are spent on the people in the frame first and then on
 * further angles of them (decision 253, amended). Object slots hold the
 * named set's plates. People come first when both cannot fit, because a
 * wrong face is worse than a wrong room.
 */
export const MAX_CHARACTER_REFERENCES = 3
export const MAX_SET_REFERENCES = 2
```

Every existing import of `MAX_STILL_REFERENCES` becomes `MAX_CHARACTER_REFERENCES`; `pnpm typecheck` finds them.

- [ ] **Step 4: Resolve the set and gather its plates**

Add beside `depictedCast`:

```ts
/**
 * The set this still is shot in, if the project holds it and it has a plate.
 * A named set nobody has photographed conditions nothing, exactly like a
 * `depicts` name with no photograph, so it is treated as no set at all and
 * the plan screen says so.
 */
async function setForStill(
  brief: StillBrief,
  projectId: string,
): Promise<ProjectSet | null> {
  if (!brief.set) return null
  const found = setForBrief(brief.set, await listProjectSets(db, projectId))
  return found && found.plates.length > 0 ? found : null
}
```

- [ ] **Step 5: Spend the budget by kind**

Give `referenceMaterials` the set and both limits, and have it return plates as `kind: 'object'` references. The signature becomes:

```ts
async function referenceMaterials(
  members: readonly CastMember[],
  set: ProjectSet | null,
  provider: 'google' | 'fal',
  limits: ReferenceLimits,
  mocked: boolean,
): Promise<{
  names: string[]
  setName: string | null
  references: ImageReference[]
  referenceUrls: string[]
}>
```

Inside, cap the character spend at `Math.min(MAX_CHARACTER_REFERENCES, limits.characters)` and the object spend at `Math.min(MAX_SET_REFERENCES, limits.objects)`, keep `spreadReferences` for the character round-robin, and use `referencePlates(set, objectBudget)` for the objects. Build the references array characters first, then objects, so it matches the order the Gemini adapter wants. On the fal branch `referenceUrls` must stay in the same order as `references`, which the existing code already relies on.

Every reference gains `kind`. The mock branch keeps returning `bW9jaw==` bytes for both kinds.

- [ ] **Step 6: Name the room in the prompt**

Extend `withReferenceClause` to take the set name. The model is sent flat inline parts, so only the prompt can say which image is which:

```ts
/**
 * "Emad Mostaque, the person in the reference photo, in Venture Capital
 * Boardroom, the room in the reference photograph." The adapter sends flat
 * inline images, so the prompt is the only thing that can label them.
 */
function withReferenceClause(
  prompt: string,
  names: readonly string[],
  setName: string | null,
): string
```

Keep the existing early return when the planner already wrote the person clause, and add the room clause only when `setName` is given and the prompt does not already contain it.

- [ ] **Step 7: Wire it through the generator and the estimate**

In `generateStillCandidates`, resolve the set before the route is chosen, ask the routed model for its limits with `LIVE_IMAGE_GEN_ADAPTERS[provider].referenceLimits(route.model)`, and pass both into `referenceMaterials`. Add the set name to the ledger meta beside `references`, as `set`.

In `stillBriefPriceUsd`, count the plates in the reference count handed to `referenceRoute`, since on fal a second reference changes the endpoint and the price.

- [ ] **Step 8: Run the tests**

Run: `cd apps/web && pnpm exec vitest run lib/visual-assets.test.ts`

Expected: PASS, including every test that existed before.

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts
git commit -m "feat(visuals): a still carries its set's plates beside its faces (decision 264)"
```

---

### Task 11: The route is chosen by rule and stored on the slot

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (`routeFor` ~line 124, `stillBriefPriceUsd` ~line 134, `stillsEstimateUsd` ~line 158, `generateStillCandidates` ~line 372)
- Modify: `packages/schemas/src/settings.ts` (the `stills` default, ~line 535)
- Modify: `apps/web/lib/visual-assets.test.ts`, `packages/schemas/src/settings.test.ts`

**Interfaces:**
- Consumes: `setSlotRoute` from Task 6; `setForBrief` from Task 2.
- Produces:
  - `routeForBrief(brief: ShotBrief, cast: readonly CastMember[], sets: readonly ProjectSet[], routing: ModelRouting): StillRoute` exported from `apps/web/lib/visual-assets.ts`
  - `generateStillCandidates(brief, projectId, route?: StillRoute | null)` gains a third parameter: the slot's stored route, which wins when given.

| the brief | route |
| --- | --- |
| names a photographed cast member | `modelRouting.stillsLikeness`, else `modelRouting.stills` |
| names a set that holds a plate | `modelRouting.stillsLikeness`, else `modelRouting.stills` |
| neither | `modelRouting.stills` |

`stillsLikeness` is null by default and stays null, so every row resolves to `stills` unless an owner configures a split. A set-conditioned still takes the likeness route when there is one because that route is the reference-capable one, not because a room is a likeness.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/visual-assets.test.ts`:

```ts
describe('routeForBrief', () => {
  const routing = {
    stills: { provider: 'fal' as const, model: 'fal-ai/flux-2' },
    stillsLikeness: { provider: 'google' as const, model: 'gemini-3-pro-image' },
  } as ModelRouting

  const cast = [{ name: 'Emad Mostaque', photos: [{}] }] as unknown as CastMember[]
  const sets = [{ name: 'Venture Capital Boardroom', plates: [{}] }] as unknown as ProjectSet[]

  it('sends a still of a photographed person to the likeness route', () => {
    expect(routeForBrief({ ...still, depicts: ['Emad Mostaque'] }, cast, sets, routing)).toEqual(
      routing.stillsLikeness,
    )
  })

  it('sends a still in a photographed set to the likeness route too', () => {
    expect(
      routeForBrief(
        { ...still, depicts: [], set: 'Venture Capital Boardroom' },
        cast,
        sets,
        routing,
      ),
    ).toEqual(routing.stillsLikeness)
  })

  it('leaves a still of nobody, nowhere, on the ordinary route', () => {
    expect(routeForBrief({ ...still, depicts: [] }, cast, sets, routing)).toEqual(routing.stills)
  })

  it('falls back to the ordinary route when no split is configured', () => {
    const noSplit = { ...routing, stillsLikeness: null } as ModelRouting
    expect(routeForBrief({ ...still, depicts: ['Emad Mostaque'] }, cast, sets, noSplit)).toEqual(
      noSplit.stills,
    )
  })
})

describe('the route stored on a slot wins', () => {
  it('generates on the stored route, not the derived one', async () => {
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/flux-2' }, stillsLikeness: null },
    })
    await generateStillCandidates({ ...still, depicts: [] }, FIXTURE_PROJECT_ID, {
      provider: 'google',
      model: 'gemini-3-pro-image',
    })
    expect(await lastLedgerModel()).toBe('gemini-3-pro-image')
  })

  it('prices a slot on its stored route', async () => {
    await updateSettings(db, {
      modelRouting: { stills: { provider: 'fal', model: 'fal-ai/flux-2' }, stillsLikeness: null },
    })
    const stored = { provider: 'google' as const, model: 'gemini-3-pro-image' }
    expect(
      await stillsEstimateUsd([{ ...still, depicts: [] }], FIXTURE_PROJECT_ID, [stored]),
    ).toBeCloseTo(0.15 * STILL_GENERATIONS)
  })
})
```

`stillsEstimateUsd` gains an optional third parameter, a per-brief list of stored routes in the same order as the briefs, so the plan screen can price what will actually run. A missing or null entry means derive.

Its one caller outside the tests is `apps/web/lib/visuals-review.ts`, at the `fetchEstimateUsd` line. Pass each slot's stored route there in the same order as the briefs, or the plan screen quotes a price for a model the fetch will not use.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run lib/visual-assets.test.ts`

Expected: FAIL, `routeForBrief is not exported`.

- [ ] **Step 3: Replace routeFor with routeForBrief**

```ts
/**
 * Where a still goes, before the owner has said otherwise (decision 264).
 *
 * A still that carries any reference needs the reference-capable route, and
 * that is what `stillsLikeness` is; the setting keeps its name because a
 * likeness is still the reason it exists. A null split means there is one
 * route and this changes nothing.
 */
export function routeForBrief(
  brief: ShotBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
  routing: ModelRouting,
): StillRoute {
  if (brief.type !== 'still' && brief.type !== 'hero') return routing.stills
  const people = depictedMembers(brief.depicts, cast).filter((m) => m.photos.length > 0)
  const set = setForBrief(brief.set, sets)
  const conditioned = people.length > 0 || (set !== null && set.plates.length > 0)
  return conditioned && routing.stillsLikeness ? routing.stillsLikeness : routing.stills
}
```

- [ ] **Step 4: Let the stored route win**

Give `generateStillCandidates` its third parameter and use it: `const route = stored ?? routeForBrief(brief, cast, sets, routing)`. Everything downstream already reads `route`.

- [ ] **Step 5: Move the default**

In `packages/schemas/src/settings.ts`, change the `stills` default from `gemini-2.5-flash-image` to `gemini-3.1-flash-image`, leaving `stillsLikeness: null`. Add to its doc comment:

```
   * The default is the model that takes both kinds of reference
   * (decision 264): people and set plates, four and ten of them. A project
   * configured before this keeps what it has.
```

Update the settings test that asserts the default.

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm exec vitest run lib/visual-assets.test.ts`
Run: `cd packages/schemas && pnpm exec vitest run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/visual-assets.ts apps/web/lib/visual-assets.test.ts packages/schemas/src/settings.ts packages/schemas/src/settings.test.ts
git commit -m "feat(visuals): a slot's route is derived by rule and overridable (decision 264)"
```

---

### Task 12: Server actions for the set library

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/set-actions.ts`
- Create: `apps/web/app/(console)/projects/[id]/set-actions.test.ts`
- Modify: `apps/web/lib/storage.ts` (add `setPlateKey`)

**Interfaces:**
- Consumes: every function from Task 5; `MAX_SET_PLATES`, `SetPlate` from Task 2; `generateStillCandidates` from Task 10.
- Produces, every one an `async function` (a `'use server'` module exports nothing else, and an exported const 500s every action in the segment):
  - `addSetAction(projectId: string, input: { name: string; look: string }): Promise<ActionResult & { id?: string }>`
  - `updateSetAction(setId: string, patch: { name?: string; look?: string }): Promise<ActionResult>`
  - `removeSetAction(setId: string): Promise<ActionResult>`
  - `createSetPlateUploadAction(input: { setId: string; mimeType: string; fileSize: number; contentHash: string }): Promise<ActionResult & { url?: string; key?: string }>`
  - `finaliseSetPlateAction(input: { setId: string; mimeType: string; contentHash: string; width: number; height: number; view: SetPlateView; sourceUrl?: string }): Promise<ActionResult>`
  - `addSetPlateFromUrlAction(input: { setId: string; url: string; view: SetPlateView }): Promise<ActionResult>`
  - `removeSetPlateAction(input: { setId: string; contentHash: string }): Promise<ActionResult>`
  - `generateSetPlateAction(setId: string): Promise<ActionResult & { candidates?: SlotCandidate[] }>`
  - `chooseSetPlateAction(input: { setId: string; candidateUrl: string }): Promise<ActionResult>`

This is `apps/web/app/(console)/projects/[id]/cast-actions.ts` with different nouns. Read that file in full and mirror it exactly: `requireOwner()`, `badIds()`, `refresh(projectId)`, the `failure()` helper mapping Postgres `23505` to a friendly duplicate-name message, the 15 MB cap, the `/^[0-9a-f]{64}$/` hash check, `storageConfigured()`, the `headObject` proof after upload, and the content-hash dedupe.

The differences from `cast-actions.ts`:

1. No `describeCastMemberAction`. A set has no identity string; its `look` is typed by the owner or seeded from the book.
2. Two new actions, `generateSetPlateAction` and `chooseSetPlateAction`, described below.
3. `setPlateKey` rather than `castPhotoKey`.
4. Every stored plate needs an `origin`: `'uploaded'` on both upload paths.
5. Messages say set: `This set no longer exists.`, `A set keeps at most four plates; remove one first.`

- [ ] **Step 1: Add the storage key**

In `apps/web/lib/storage.ts`, beside `castPhotoKey`:

```ts
/**
 * A set's reference plates (decision 264), content-hash keyed under the
 * project: the same plate uploaded twice is one object, and a film's rooms
 * go with the film.
 */
export function setPlateKey(input: {
  projectId: string
  contentHash: string
  ext: 'jpg' | 'png' | 'webp'
}): string {
  return `${R2_PREFIX}/sets/${input.projectId}/${input.contentHash}.${input.ext}`
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/app/(console)/projects/[id]/set-actions.test.ts`, mirroring `cast-actions.test.ts`'s mocks exactly: auth, `next/cache`, the Inngest client, storage and remote-image. Cover:

```
adds a set and refuses a duplicate name in words, not a stack trace
refuses a set with no name
updates the name and the look
removing a set deletes its plate objects and hides it
an upload is refused past four plates
an upload is refused for a MIME type the image models do not take
an upload is refused past fifteen megabytes
finalising stores the plate with origin "uploaded" and dedupes on content hash
a plate added from a web address stores its source URL
generating a plate returns candidates and spends nothing in mock mode
choosing a generated plate stores it with origin "generated"
every action refuses a caller who is not the owner
```

- [ ] **Step 3: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/set-actions.test.ts"`

Expected: FAIL, module not found.

- [ ] **Step 4: Write the actions**

Create the module, headed:

```ts
'use server'

/**
 * The Set card's actions (decision 264). Deliberately `cast-actions.ts` with
 * different nouns, including the two-step presigned upload, because the
 * bytes cannot travel through the app: Vercel rejects a body over about
 * 4.5 MB (decision 205).
 */
```

`generateSetPlateAction` builds a `StillBrief` from the set's `look` and the Brand Kit anchors and calls `generateStillCandidates` with no set and no cast, so it conditions on nothing and invents the room once:

```ts
const brief: StillBrief = {
  type: 'still',
  coversText: set.name,
  description: set.look,
  shotSize: 'wide',
  motion: { kind: 'static' },
  transition: 'cut',
  prompt: `${set.look} ${stillStyleAnchors(settings.brandKit)}`,
}
```

It returns the candidates rather than storing one: the owner picks. `chooseSetPlateAction` takes the chosen URL, pulls the bytes into R2 under `setPlateKey`, and appends the plate with `origin: 'generated'` and `view: 'establishing'`.

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/set-actions.test.ts"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/set-actions.ts" "apps/web/app/(console)/projects/[id]/set-actions.test.ts" apps/web/lib/storage.ts
git commit -m "feat(sets): add a set, upload or generate its plates (decision 264)"
```

---

### Task 13: The Set card

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/set-card.tsx`
- Create: `apps/web/app/(console)/projects/[id]/set-card.test.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (the data load ~line 99, the render ~line 389)

**Interfaces:**
- Consumes: every action from Task 12; `ProjectSet`, `SET_PLATE_VIEWS` from Task 2.
- Produces: `export interface SetCardProps { projectId: string; sets: readonly ProjectSet[]; plateUrls: Readonly<Record<string, string>> }` and `export function SetCard(props: SetCardProps)`. `plateUrls` is keyed by content hash, exactly as `CastCardProps.photoUrls` is.

This is `apps/web/app/(console)/projects/[id]/cast-card.tsx` with different nouns. Read it in full and mirror its structure: the `act(key, run, success)` busy and toast wrapper, the collapsed summary row, the expanded per-item rows, the file input plus view `Select`, the "Or paste an image address" field, the `ConfirmButton` for removal, and `readImageSize`.

The differences from `cast-card.tsx`:

1. Opens itself when `sets.length === 0 || sets.some((s) => s.plates.length === 0)`, and the warning counts sets with no plate.
2. Per set: a name input, a `look` textarea, the plate grid, Add plate with a `SET_PLATE_VIEWS` select, the web-address field, Save, Remove set.
3. One extra button per set, **Generate a plate**, labelled with its cost the way the cast card labels Describe from photos. Pressing it calls `generateSetPlateAction` and renders the returned candidates as a row of choices, each a button that calls `chooseSetPlateAction`. Nothing is stored until the owner picks one.
4. Help text under the plate grid reads: "Up to two plates travel with every still shot in this room."
5. There is no identity string and no guardrail.

- [ ] **Step 1: Write the failing component tests**

Create `set-card.test.tsx`, mirroring `cast-card.test.tsx`'s setup. Cover:

```
renders each set with its plate count
opens itself when a set has no plate, and says how many
adding a set calls the action with the typed name and look
saving a set sends only the fields that changed
removing a set asks for confirmation first
generating a plate shows the candidates and stores nothing until one is chosen
choosing a candidate calls chooseSetPlateAction with that URL
the card is collapsed when every set has a plate
```

Give every interactive element an accessible name; `getByRole` has no `exact` option, so name the buttons distinctly enough to select without one.

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]/set-card.test.tsx"`

Expected: FAIL, module not found.

- [ ] **Step 3: Write the card**

Mirror `cast-card.tsx` with the five differences above.

- [ ] **Step 4: Mount it**

In `page.tsx`, beside the cast load:

```ts
const sets = showCast ? await listProjectSets(db, project.id) : []
const setPlateUrls: Record<string, string> = {}
if (showCast && storageConfigured()) {
  for (const set of sets)
    for (const plate of set.plates) setPlateUrls[plate.contentHash] = await presignGet(plate.r2Key)
}
```

and render it immediately after `CastCard`, gated on the same `showCast`. Reuse that flag rather than adding a second one: the cast and the sets appear together, from the script stage onward.

- [ ] **Step 5: Run the tests**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]"`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/set-card.tsx" "apps/web/app/(console)/projects/[id]/set-card.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -m "feat(board): the Set card, beside the Cast card (decision 264)"
```

---

### Task 14: The model select on a shot

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (add `setSlotRouteAction`)
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView`, the row mapping ~line 335)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (the brief editor ~line 1749)
- Modify: their tests

**Interfaces:**
- Consumes: `setSlotRoute` from Task 6; `routeForBrief` from Task 11.
- Produces:
  - `setSlotRouteAction(projectId: string, slotId: string, route: { provider: string; model: string } | null): Promise<ActionResult>`
  - `SlotView.route: { provider: string; model: string } | null` and `SlotView.derivedRoute: { provider: string; model: string }`

Both are needed on the view: the select shows the stored route when there is one, and marks the derived one as the default so the owner can see what the plan chose and put it back.

- [ ] **Step 1: Write the failing tests**

In `visuals-actions.test.ts`:

```
stores a route on a still slot and makes it owe work again
clears the route back to the derived one
refuses a model the provider does not offer, in words
refuses a route on a slot that is not a still or hero
refuses a linked slot, which shows another slot's shot
refuses a slot in another project
```

The refusal for a linked slot reuses `linkedSlotRefusal`, which decision 261 built for exactly this class of action.

In `visual-board.test.tsx`:

```
the brief editor offers a model select on a still card
the select shows the stored route when there is one
the select marks the plan's own choice as the default
a chart card has no model select
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]"`

Expected: FAIL.

- [ ] **Step 3: Write the action**

Follow the shape of every other action in that file: `requireOwner()`, `badIds()`, load the slot, refuse what must be refused, write, `refresh(projectId)`. Validate the model through `imageGenModel(LIVE_IMAGE_GEN_ADAPTERS[provider], model)`, which throws on an id the adapter does not list, and turn that throw into an `ActionResult` refusal rather than a 500. Do not send a refetch event: the hash now covers the route, so the next Fetch picks it up, and re-buying a shot is the owner's button to press.

- [ ] **Step 4: Surface both routes on the view**

In `visuals-review.ts`, add `route` read from the slot row and `derivedRoute` computed as `routeForBrief(brief, cast, sets, settings.modelRouting)`.

That file already loads the cast, for `castWarnings`. Add one `listProjectSets(db, project.id)` beside it and hoist both above the slot mapping so every slot uses the same pair. Task 15 then reuses exactly these two loads for the set warnings; do not add a second pair there.

- [ ] **Step 5: Add the select**

In the brief editor form in `visual-board.tsx`, for `still` and `hero` briefs only, add a labelled `Select` above the Save button. Its options are every model from both image providers, grouped by provider, plus a first option reading `Planned default (<label>)` with an empty value that clears the override. Changing it calls `setSlotRouteAction` through the existing `act` wrapper with the success message `Model changed; re-fetch this shot to buy it`.

The message matters: nothing regenerates on its own, and a control that silently changes nothing visible is a control the owner will not trust.

- [ ] **Step 6: Run the tests**

Run: `cd apps/web && pnpm exec vitest run "app/(console)/projects/[id]" lib/visuals-review.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visual-board.tsx" apps/web/lib/visuals-review.ts apps/web/app/\(console\)/projects/\[id\]/*.test.* apps/web/lib/visuals-review.test.ts
git commit -m "feat(board): a shot says which model it generates on, and takes another (decision 264)"
```

---

### Task 15: The runner seeds the sets, plans with them, and stamps the routes

**Files:**
- Modify: `apps/web/inngest/lib/direction.ts` (`loadDirectionInputs` ~line 68, `draftDirectorsBook` ~line 138, `planChapterSlots` ~line 198)
- Modify: `apps/web/inngest/functions/visuals-runner.ts` (~line 130 and the slot write after parsing)
- Modify: `apps/web/inngest/functions/visuals-replanner.ts` (the same two places)
- Modify: `apps/web/lib/visuals-review.ts` (pass set names to `planWarnings`)
- Modify: their tests

**Interfaces:**
- Consumes: `seedSetsFromLocations`, `listProjectSets` from Task 5; `buildShotListRequest`'s `sets` from Task 8; `routeForBrief` from Task 11; `setSlotRoute` from Task 6.
- Produces: nothing new. This is the wiring that makes Tasks 2 to 14 run in a real pass.

- [ ] **Step 1: Write the failing tests**

In `apps/web/inngest/lib/direction.test.ts` (or the runner tests, wherever `draftDirectorsBook` is already covered):

```
drafting the book seeds a set for each of its locations
a second draft does not duplicate the sets
the shot-list request carries the project's sets
```

In the runner tests:

```
a planned still that shows a photographed person is stamped with the likeness route
a planned still of nobody is stamped with the ordinary route
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm exec vitest run inngest`

Expected: FAIL.

- [ ] **Step 3: Seed the sets where the cast is seeded**

In `draftDirectorsBook`, immediately after `seedCastFromPrincipals`:

```ts
// The book's locations are the film's sets, exactly as its principals are
// the film's cast (decision 264). Seeded once; the producer's removals stick.
await seedSetsFromLocations(db, projectId, book.locations)
```

- [ ] **Step 4: Load and pass them**

In `loadDirectionInputs`, load `listProjectSets(db, projectId)` and return `sets: sets.map(({ name, look }) => ({ name, look }))` beside `photographed`. Thread it through `planChapterSlots` into `buildShotListRequest`, exactly as `photographed` is threaded, including the "only when non-empty" spread.

- [ ] **Step 5: Stamp the route on every planned still**

After a chapter's slots are written, for each still or hero slot call `setSlotRoute(db, slot.id, routeForBrief(brief, cast, sets, routing))`. Do it in the same step that writes the slots, so a retry does not leave half the chapter unstamped.

Do the same in the replanner.

- [ ] **Step 6: Warn about sets on the plan screen**

In `visuals-review.ts`, pass the project's set names as the fourth argument to `planWarnings`, beside the motifs that already go in as the third.

- [ ] **Step 7: Run the tests**

Run: `cd apps/web && pnpm exec vitest run`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/inngest apps/web/lib/visuals-review.ts
git commit -m "feat(runner): the book seeds the sets, the plan uses them, every still gets a route (decision 264)"
```

---

### Task 16: End to end

**Files:**
- Modify: `e2e/global-setup.ts` (the plan-stage project, ~line 536)
- Modify: `e2e/tests/visual-plan.spec.ts`

**Interfaces:**
- Consumes: everything.
- Produces: nothing.

Read the memory on scoped e2e runs before starting: `pnpm e2e -- <paths>` silently runs the whole suite, and an interrupted run orphans `next dev` on port 3100. Scope with `cd e2e && pnpm exec playwright test <paths>` and confirm with `--list` first.

- [ ] **Step 1: Seed a set**

In `global-setup.ts`, give the plan-stage project one `project_sets` row named `Venture Capital Boardroom` with a look and one plate, and give one still slot a brief carrying `set: 'Venture Capital Boardroom'`.

- [ ] **Step 2: Write the failing spec**

Append to `e2e/tests/visual-plan.spec.ts`:

```ts
test.describe('sets', () => {
  test('the Set card lists the film rooms and takes a new one', async ({ page }) => {
    await page.goto(`/projects/${PLAN_PROJECT_ID}`)
    await page.getByRole('button', { name: 'Sets' }).click()
    await expect(page.getByText('Venture Capital Boardroom')).toBeVisible()
    await expect(page.getByText('Up to two plates travel with every still shot in this room')).toBeVisible()

    await page.getByLabel('Set name').fill('Stability AI London Headquarters')
    await page.getByLabel('Look').fill('An open-plan office at night, monitors glowing.')
    await page.getByRole('button', { name: 'Add set' }).click()
    await expect(page.getByText('Stability AI London Headquarters')).toBeVisible()
  })

  test('a slot can be pointed at a different model', async ({ page }) => {
    await page.goto(`/projects/${PLAN_PROJECT_ID}`)
    const card = page.getByRole('group', { name: /still/i }).first()
    await card.getByRole('button', { name: 'Edit brief' }).click()
    await card.getByLabel('Image model').selectOption({ label: /Gemini 3 Pro Image/ })
    await expect(page.getByText('Model changed; re-fetch this shot to buy it')).toBeVisible()
  })
})
```

Two of those strings are fixed by earlier tasks and must match them exactly: the plate help text from Task 13 and the toast from Task 14. If either changed during implementation, change it here rather than loosening the assertion. `PLAN_PROJECT_ID` is the constant the file already uses for the plan-stage project; do not introduce a second one.

- [ ] **Step 3: Run the two files, scoped**

Run: `cd e2e && pnpm exec playwright test tests/visual-plan.spec.ts --list`

Confirm the list holds only that file, then run it without `--list`.

Expected: PASS.

- [ ] **Step 4: Run the whole suite once**

Run: `pnpm e2e`

Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "test(e2e): the Set card and the per-shot model select (decision 264)"
```

---

## After the last task

1. Run the full verification on the merged tree: `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`, `pnpm test`, `pnpm e2e`.
2. Write the decision 264 entry in `PROGRESS.md` and amend `docs/03-build-spec.md` line 185, following the shape of entries 44 to 47.
3. Use superpowers:finishing-a-development-branch.
4. Tell the owner two things the code cannot do for them: their live project is still routed at fal and Gemini 2.5, which is one change in Settings, and their existing plan names no sets until it is re-planned or the briefs are edited by hand.
