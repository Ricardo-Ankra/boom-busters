# Still Prompts With One Owner Per Fact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every still, plate, sheet and teaser prompt is assembled by one code function from facts that each have one owner, so the image model stops receiving duplicated, contradictory and object-listing text.

**Architecture:** The planner LLM writes only the scene. A pure `assembleStillPrompt` in `apps/web/lib/still-prompt.ts` adds the framing, the camera and room in view, the reference sentences and a qualities-only photograph line, in one fixed order, on every route. Grade and grain move to the compositor. A new live harness runs the real planner on one production chapter (read-only) before and after, so the change is measured, not assumed.

**Tech Stack:** TypeScript, pnpm monorepo, Next.js app (`apps/web`), Inngest, Remotion (`packages/compositions`), Zod schemas (`packages/schemas`), Drizzle/postgres.js (`packages/db`), Vitest, Playwright, Gemini image models.

**Spec:** `docs/superpowers/specs/2026-09-29-still-prompt-ownership-design.md` (decision 287). Read it before starting any task.

## Global Constraints

- Branch: a fresh branch `still-prompt-ownership` from `master`, created only after `social-posts` has merged (spec section 3, decision 5). The spec file is its first commit.
- Mock providers by default. No paid call in any test. Live runs (Tasks 3 and 10) only with the owner's approval at run time, each under the $1 cap that `LiveBudget` enforces.
- Production data is read only: the harness connects with `default_transaction_read_only = on` and refuses to run if the session reports otherwise. Nothing writes to the production database, the cost ledger or R2.
- Owner-facing copy (UI labels, toasts, PROGRESS prose) uses South African English and no em or en dashes. Code comments follow the file's existing style.
- UI is button-first (spec §11.1 of the build spec): every action a visible labelled control.
- `'use server'` files export only async functions.
- Before every commit: `pnpm format:check`, `pnpm lint`, `pnpm typecheck` clean.
- After any change to a shared schema or prompt, run the suite of every package that consumes it, not just the one you edited.
- Never run two database-backed vitest suites at once; Docker Desktop must be running for `packages/db` and `apps/web` database suites. Use the Bash `timeout` 600000 for full suites.
- The bible is edited in `packages/providers/src/prompts/direction-craft.md`, then `pnpm --filter @boom-busters/providers embed:craft`; never hand-edit the embedded string in `direction-craft.ts`. A phrase a test asserts must sit whole on one line of the markdown.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A legacy stored prompt with the pasted lines in an unexpected arrangement** (the house line followed by "Eye level, 35mm lens.", the palette prefix before the anchors, an anchors line with `clean, no grain`): the strip removes only the pasted lines and keeps every word the planner wrote. Pinned by the `sceneOf` tests in Task 5.
2. **An owner-edited prompt that pasted an old "References attached:" declaration**: the scene is cut at the marker and the declaration is written once, fresh. Pinned in Task 5.
3. **A brief naming a set that has an inventory but no plates yet**: the camera sentence still goes (the inventory states the room), no room-reference sentence is written, and no plates are promised. Pinned in Task 5.
4. **A timeline compiled before this work, with no `gradePreset`**: it renders ungraded, exactly as before; a timeline compiled after gets the owner's grade (default muted). Pinned in Task 4.
5. **A negative prompt ending in a full stop, on a prompt ending in a full stop**: one `Avoid:` sentence and no `..`. Pinned in Task 6.

---

### Task 1: Pull the still prompt and reference planning into the pure module (no behaviour change)

Refactor only. `generateStillCandidates`, the price estimate and (later) the harness and the board must build the prompt and count the references with the same code. Today that logic sits inside `visual-assets.ts`, which imports the database client, so nothing outside the app can reuse it.

**Files:**
- Modify: `apps/web/lib/still-prompt.ts` (add `referenceBudgets`, `routeForBrief`, `depictedFrom`, `setFrom`, `planStillReferences`, `assembleStillPrompt`)
- Modify: `apps/web/lib/visual-assets.ts:60-140,169-181,234-278,586-595` (import them back; keep the exports `referenceBudgets` and `routeForBrief` as re-exports so existing importers keep working)
- Test: `apps/web/lib/still-prompt.test.ts` (create if absent)

**Interfaces:**
- Produces (all exported from `apps/web/lib/still-prompt.ts`):
  - `referenceBudgets(limits: ReferenceLimits): { characters: number; objects: number }`
  - `depictedFrom(brief: StillBrief, cast: readonly CastMember[]): CastMember[]`
  - `setFrom(brief: StillBrief, sets: readonly ProjectSet[]): ProjectSet | null`
  - `routeForBrief(brief: ShotBrief, cast: readonly CastMember[], sets: readonly ProjectSet[], routing: ModelRouting): StillRoute`
  - `planStillReferences(members: readonly CastMember[], set: ProjectSet | null, budgets: { characters: number; objects: number }, facing?: SetPlateDirection): StillReferencePlan`
  - `interface StillReferencePlan { photos: { member: CastMember; photo: CastPhoto }[]; plates: SetPlate[]; people: { name: string; photos: number }[]; setName: string | null }`
  - `interface StillPromptInput { scene: string; shotSize?: ShotSize; camera?: SetCamera; layout: string; people: readonly { name: string; photos: number }[]; set: { name: string; plates: number } | null; kind?: StillKind }`
  - `type StillKind = 'still' | 'plate' | 'teaser'`
  - `assembleStillPrompt(input: StillPromptInput): string` (this task: today's behaviour exactly)

- [ ] **Step 1: Write the characterisation tests**

Append to `apps/web/lib/still-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { CastMember, ProjectSet } from '@boom-busters/schemas'
import { describeCamera, framingLead } from './set-plates'
import {
  assembleStillPrompt,
  planStillReferences,
  withReferenceClause,
} from './still-prompt'

const photo = (key: string) => ({
  r2Key: key,
  contentHash: key,
  mimeType: 'image/jpeg' as const,
  width: 800,
  height: 800,
  view: 'front' as const,
})
const plate = (view: 'north' | 'east' | 'south' | 'west') => ({
  r2Key: `plate/${view}`,
  contentHash: view,
  mimeType: 'image/png' as const,
  width: 1600,
  height: 900,
  view,
  origin: 'generated' as const,
})
const emad = { name: 'Emad Mostaque', photos: [photo('a'), photo('b')] } as unknown as CastMember
const boardroom = {
  name: 'The Stability AI Boardroom',
  look: 'A stark conference room.',
  layout:
    'North wall: glass windows.\nEast wall: acoustic panels.\nSouth wall: oak double door.\n' +
    'West wall: frosted glass.\nCentre: one long dark table, ten mesh chairs.\nLight: LED panels.',
  plates: [plate('north'), plate('east'), plate('south')],
} as unknown as ProjectSet

describe('planStillReferences', () => {
  it('spends people first and counts what travels', () => {
    const plan = planStillReferences([emad], boardroom, { characters: 3, objects: 2 }, 'south')
    expect(plan.people).toEqual([{ name: 'Emad Mostaque', photos: 2 }])
    expect(plan.setName).toBe('The Stability AI Boardroom')
    expect(plan.plates.map((p) => p.view)[0]).toBe('south')
    expect(plan.plates).toHaveLength(2)
  })

  it('names no set when no plate travels', () => {
    const plan = planStillReferences([], boardroom, { characters: 3, objects: 0 })
    expect(plan.setName).toBeNull()
    expect(plan.plates).toEqual([])
  })
})

describe('assembleStillPrompt (decision 287, Task 1: today behaviour)', () => {
  it('matches the pre-refactor composition exactly', () => {
    const camera = { facing: 'south' as const, position: 'the north windows, seated', lens: '35mm' }
    const scene = 'Emad Mostaque seated at the long table, hands clasped.'
    const expected = withReferenceClause(
      `${framingLead(camera, 'medium')}${scene}`,
      [{ name: 'Emad Mostaque', photos: 2 }],
      { name: 'The Stability AI Boardroom', plates: 2 },
      describeCamera(camera, boardroom.layout, 'medium'),
    )
    expect(
      assembleStillPrompt({
        scene,
        shotSize: 'medium',
        camera,
        layout: boardroom.layout,
        people: [{ name: 'Emad Mostaque', photos: 2 }],
        set: { name: 'The Stability AI Boardroom', plates: 2 },
      }),
    ).toBe(expected)
  })

  it('strips banned words from the scene, as generation always has', () => {
    expect(
      assembleStillPrompt({ scene: 'A cinematic boardroom at dusk.', layout: '', people: [], set: null }),
    ).toBe('A boardroom at dusk.')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @boom-busters/web test -- lib/still-prompt.test.ts`
Expected: FAIL, `planStillReferences` and `assembleStillPrompt` are not exported.

- [ ] **Step 3: Move the code**

In `apps/web/lib/still-prompt.ts`, add these imports at the top (the module stays free of database, storage and env imports):

```ts
import { stripBannedWords } from '@boom-busters/providers'
import type { ReferenceLimits } from '@boom-busters/providers'
import {
  depictedMembers,
  MAX_CHARACTER_REFERENCES,
  MAX_SET_REFERENCES,
  platesForCamera,
  setForBrief,
  spreadReferencePhotos,
} from '@boom-busters/schemas'
import type {
  CastMember,
  CastPhoto,
  ModelRouting,
  ProjectSet,
  SetCamera,
  SetPlate,
  SetPlateDirection,
  ShotBrief,
  ShotSize,
  StillBrief,
  StillRoute,
} from '@boom-busters/schemas'
import { describeCamera, framingLead } from './set-plates'
```

Check each type import against where `visual-assets.ts` imports it today and use the same source (for example `ReferenceLimits` may come from `@boom-busters/providers`; `StillRoute` from schemas).

Move `referenceBudgets` (visual-assets.ts:69-77), `depictedFrom` (99-103), `setFrom` (116-119) and `routeForBrief` (129-140) into `still-prompt.ts` unchanged, with their doc comments, and export all four. Then add:

```ts
/** What one still carries: the photographs and plates that actually travel, and the counts the prompt names. */
export interface StillReferencePlan {
  photos: { member: CastMember; photo: CastPhoto }[]
  plates: SetPlate[]
  people: { name: string; photos: number }[]
  setName: string | null
}

/**
 * The references a still spends (decision 264): people first, because a
 * wrong face is worse than a wrong room, then the plates nearest the camera.
 * Pure, so the generator, the estimate, the board preview and the live
 * harness count exactly the same photographs.
 */
export function planStillReferences(
  members: readonly CastMember[],
  set: ProjectSet | null,
  budgets: { characters: number; objects: number },
  facing?: SetPlateDirection,
): StillReferencePlan {
  const photos = spreadReferencePhotos(members, budgets.characters)
  const plates = set ? platesForCamera(set, facing, budgets.objects) : []
  const names = [...new Set(photos.map(({ member }) => member.name))]
  return {
    photos,
    plates,
    people: names.map((name) => ({
      name,
      photos: photos.filter(({ member }) => member.name === name).length,
    })),
    setName: plates.length > 0 && set ? set.name : null,
  }
}

export type StillKind = 'still' | 'plate' | 'teaser'

export interface StillPromptInput {
  /** The brief's stored prompt. */
  scene: string
  shotSize?: ShotSize
  camera?: SetCamera
  /** The named set's inventory, or '' when the brief names none. */
  layout: string
  people: readonly { name: string; photos: number }[]
  set: { name: string; plates: number } | null
  kind?: StillKind
}

/** The one place a still's prompt is put together (decision 287). */
export function assembleStillPrompt(input: StillPromptInput): string {
  const body = input.camera
    ? `${framingLead(input.camera, input.shotSize)}${input.scene}`
    : input.scene
  return withReferenceClause(
    stripBannedWords(body),
    input.people,
    input.set,
    input.camera ? describeCamera(input.camera, input.layout, input.shotSize) : null,
  )
}
```

`set-plates.ts` imports nothing from `still-prompt.ts`, so there is no cycle.

- [ ] **Step 4: Point visual-assets at the moved code**

In `apps/web/lib/visual-assets.ts`:
- Delete the four moved functions and import them from `@/lib/still-prompt`. Keep `export { referenceBudgets, routeForBrief } from '@/lib/still-prompt'` so every existing importer (grep `routeForBrief\|referenceBudgets` across `apps/web`) keeps compiling.
- In `referenceMaterials` (234-358), replace the lines that compute `photos`, `plates`, `names`, `setName`, `people`, `setPlates` with:

```ts
  const plan = planStillReferences(members, set, budgets, facing)
  const { photos, plates } = plan
  if (photos.length === 0 && plates.length === 0) return none
  const names = plan.people.map((person) => person.name)
  const setName = plan.setName
  const plateName = setName ?? ''
  const people = plan.people
  const setPlates = plates.length
```

- Replace the `prompt` construction at 588-595 with:

```ts
  const prompt = assembleStillPrompt({
    scene: brief.prompt,
    ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
    ...(brief.camera ? { camera: brief.camera } : {}),
    layout: namedSet?.layout ?? '',
    people: cast.people,
    set: cast.setName === null ? null : { name: cast.setName, plates: cast.setPlates },
  })
```

and delete the now-unused `cameraText` local (542-544) and any imports that became unused.

- In `stillBriefPriceUsd` (169-181), replace the two count lines with:

```ts
  const plan = planStillReferences(members, set, budgets, brief.camera?.facing)
  const billed = live.referenceRoute?.(route.model, plan.photos.length + plan.plates.length) ?? null
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @boom-busters/web test -- lib/still-prompt.test.ts lib/visual-assets.test.ts lib/set-plates.test.ts`
Expected: PASS, every existing visual-assets test unchanged and green (Docker Desktop running).

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add apps/web/lib/still-prompt.ts apps/web/lib/still-prompt.test.ts apps/web/lib/visual-assets.ts
git commit -m "refactor(web): one pure module plans a still's references and prompt (decision 287)"
```

---

### Task 2: A pure chapter planner and a read-only database connection

Refactor plus one small option. The harness must run the planner exactly as the app does, without the app's database-writing `callLlm`, and must connect to production in a way that cannot write.

**Files:**
- Create: `apps/web/lib/plan-chapter.ts`
- Modify: `apps/web/inngest/lib/direction.ts:268-460` (use `planChapterWith`; keep exporting `chapterShotListRequest`)
- Modify: `packages/db/src/client.ts:11-40` (`readOnly` option)
- Test: `apps/web/lib/plan-chapter.test.ts`, `packages/db/src/client.integration.test.ts` (or the existing `client.test.ts` if it already connects to the test database; read it first)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `type CompleteFn = (request: LLMTaskRequest, purpose: 'plan' | 'plan-retry' | 'repair') => Promise<{ text: string }>`
  - `planChapterWith(complete: CompleteFn, input: PlanChapterInput): Promise<{ slots: PlannedSlot[]; malformed: number } | null>` (null when the chapter has no narration)
  - `interface PlanChapterInput { caseTitle: string; chapter: { id: string; title: string; number: number }; paragraphs: readonly TimedParagraph[]; claims: readonly ScriptClaim[]; styleAnchors: string; direction: DirectorsBook | null; photographed?: readonly string[]; sets?: readonly { name: string; look: string; layout?: string }[]; logos?: readonly LogoIndex[] }` (`styleAnchors` is removed again in Task 8)
  - `chapterShotListRequest(input: PlanChapterInput): LLMTaskRequest | null` (moved here, re-exported from `inngest/lib/direction.ts`)
  - `createDb(connectionString, { max?, readOnly? })`

- [ ] **Step 1: Write the failing planner test**

Create `apps/web/lib/plan-chapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { ValidationError } from '@boom-busters/schemas'
import { planChapterWith } from './plan-chapter'

const chapter = { id: 'ch1', title: 'The fall', number: 1 }
const paragraphs = [
  { chapterId: 'ch1', index: 0, text: 'The board met in the glass room.', seconds: 8, startMs: 0, durationMs: 8000 },
]
const input = {
  caseTitle: 'Case',
  chapter,
  paragraphs: paragraphs as never,
  claims: [],
  styleAnchors: '',
  direction: null,
}
const oneStill = JSON.stringify({
  slots: [
    {
      paragraphIndex: 0,
      seconds: 8,
      brief: {
        type: 'still',
        coversText: 'The board met in the glass room.',
        description: 'The board at the table.',
        shotSize: 'wide',
        motion: { kind: 'static' },
        transition: 'cut',
        prompt: 'Four directors at a long table, dusk light from the windows. 24mm, eye level.',
      },
    },
  ],
})

describe('planChapterWith', () => {
  it('plans a chapter through the injected completion', async () => {
    const complete = vi.fn().mockResolvedValue({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ task: 'shotlist' }), 'plan')
  })

  it('doubles the budget once when the answer is cut off', async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: '{"slots": [{"paragraphIndex": 0,' })
      .mockResolvedValueOnce({ text: oneStill })
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
    expect(complete.mock.calls[1]?.[1]).toBe('plan-retry')
    expect(complete.mock.calls[1]?.[0].maxTokens).toBeGreaterThan(complete.mock.calls[0]?.[0].maxTokens)
  })

  it('returns null for a chapter with no narration', async () => {
    const complete = vi.fn()
    expect(await planChapterWith(complete, { ...input, paragraphs: [] })).toBeNull()
    expect(complete).not.toHaveBeenCalled()
  })

  it('keeps the plan when the repair call fails', async () => {
    const banned = oneStill.replace('Four directors', 'Four cinematic directors')
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ text: banned })
      .mockRejectedValueOnce(new ValidationError('down'))
    const result = await planChapterWith(complete, input)
    expect(result?.slots).toHaveLength(1)
  })
})
```

The `paragraphs` fixture must match `TimedParagraph` in `apps/web/inngest/lib/shot-list.ts`; read that type and adjust the fixture's field names before running. The last test relies on a banned word being stripped before the repair pass (so the repair may find nothing to do); if `craftFindings` raises no `auto` finding, the test still holds because no repair call is made.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @boom-busters/web test -- lib/plan-chapter.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `apps/web/lib/plan-chapter.ts`**

Move `planWithBudgetEscalation` (direction.ts:268-280), `chapterShotListRequest` (287-322) and `repairPlannedChapter` (334-376) here, changing only how they call the model: each takes `complete: CompleteFn` instead of calling `callLlm`. No import of `@/lib/db`, `@/lib/llm` or `@boom-busters/db` values (types only).

```ts
import {
  BANNED_PROMPT_WORDS,
  buildShotListRequest,
  buildShotRepairRequest,
  MAX_OUTPUT_TOKENS,
  parseShotList,
  parseShotRepair,
  withoutBannedWords,
} from '@boom-busters/providers'
import type { LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import { craftFindings, findingContext, repairTargets, ValidationError } from '@boom-busters/schemas'
import type { DirectorsBook, FindingContext, LogoIndex, PlannedSlot } from '@boom-busters/schemas'
import { promptParagraphs, type TimedParagraph } from '@/inngest/lib/shot-list'

/**
 * One chapter's shot list, planned through whatever completes a request
 * (decision 287). The app passes its ledgered `callLlm`; the live harness
 * passes a Google call held under its own spend cap. Both then plan under
 * exactly the same request, retry and repair rules.
 */
export type CompleteFn = (
  request: LLMTaskRequest,
  purpose: 'plan' | 'plan-retry' | 'repair',
) => Promise<{ text: string }>

export interface PlanChapterInput {
  caseTitle: string
  chapter: { id: string; title: string; number: number }
  paragraphs: readonly TimedParagraph[]
  claims: readonly ScriptClaim[]
  styleAnchors: string
  direction: DirectorsBook | null
  photographed?: readonly string[]
  sets?: readonly { name: string; look: string; layout?: string }[]
  logos?: readonly LogoIndex[]
}

export function chapterShotListRequest(input: PlanChapterInput): LLMTaskRequest | null {
  // body moved verbatim from inngest/lib/direction.ts
}

async function planWithBudgetEscalation(
  complete: CompleteFn,
  request: LLMTaskRequest,
): Promise<ReturnType<typeof parseShotList>> {
  try {
    return parseShotList((await complete(request, 'plan')).text)
  } catch (error) {
    const cutOff = error instanceof ValidationError && error.field === 'maxTokens'
    if (!cutOff || request.maxTokens >= MAX_OUTPUT_TOKENS) throw error
    const bigger = { ...request, maxTokens: Math.min(MAX_OUTPUT_TOKENS, request.maxTokens * 2) }
    return parseShotList((await complete(bigger, 'plan-retry')).text)
  }
}

async function repairPlannedChapter(
  complete: CompleteFn,
  input: { request: LLMTaskRequest; slots: PlannedSlot[]; chapterNumber: number; context: FindingContext },
): Promise<PlannedSlot[]> {
  // body moved verbatim, with `callLlm(buildShotRepairRequest(...), { projectId })`
  // replaced by `complete(buildShotRepairRequest(...), 'repair')`
}

export async function planChapterWith(
  complete: CompleteFn,
  input: PlanChapterInput,
): Promise<{ slots: PlannedSlot[]; malformed: number } | null> {
  const request = chapterShotListRequest(input)
  if (!request) return null
  const parsed = await planWithBudgetEscalation(complete, request)
  const slots = await repairPlannedChapter(complete, {
    request,
    slots: parsed.slots.map((slot) => ({ ...slot, brief: withoutBannedWords(slot.brief) })),
    chapterNumber: input.chapter.number,
    context: findingContext({
      direction: input.direction,
      cast: (input.photographed ?? []).map((name) => ({ name, photographed: true })),
      sets: (input.sets ?? []).map((set) => ({ name: set.name, look: set.look, layout: set.layout })),
      bannedWords: BANNED_PROMPT_WORDS,
    }),
  })
  return { slots, malformed: parsed.malformed.length }
}
```

Fill the two "moved verbatim" bodies from direction.ts; do not leave the comments in place. Keep the doc comments that sat above the moved functions.

- [ ] **Step 4: Point direction.ts at it**

In `apps/web/inngest/lib/direction.ts`, delete the three moved functions, `export { chapterShotListRequest } from '@/lib/plan-chapter'`, and in `planChapterSlots` replace the `else` branch body (427-450) with:

```ts
    const planned = await planChapterWith(
      (request) => callLlm(request, { projectId: input.projectId }),
      input,
    )
    if (!planned) return { rows: [], rejected: 0 }
    dropped = planned.malformed
    slots = planned.slots
```

Remove imports that became unused. `rewriteStoredBriefs` (the Fix button) still calls `chapterShotListRequest`; it keeps working through the re-export.

- [ ] **Step 5: Write the failing read-only test**

Read `packages/db/src/client.test.ts` first. If it does not open a real connection, create `packages/db/src/client.integration.test.ts` following the pattern of an existing `*.integration.test.ts` in that folder (how it reads `TEST_DATABASE_URL` and skips without it):

```ts
import { afterAll, describe, expect, it } from 'vitest'
import { createDb } from './client'

const url = process.env.TEST_DATABASE_URL
describe.skipIf(!url)('createDb readOnly (decision 287)', () => {
  const { sql } = createDb(url!, { max: 1, readOnly: true })
  afterAll(() => sql.end())

  it('opens a session that refuses writes', async () => {
    const [row] = await sql`show default_transaction_read_only`
    expect(row?.default_transaction_read_only).toBe('on')
    await expect(sql`create temporary table t (x int)`).rejects.toThrow(/read-only/)
  })
})
```

Run: `pnpm --filter @boom-busters/db test -- src/client.integration.test.ts`
Expected: FAIL, `default_transaction_read_only` is `off`.

- [ ] **Step 6: Add the option**

In `packages/db/src/client.ts`:

```ts
export function createDb(connectionString: string, options?: { max?: number; readOnly?: boolean }) {
  const sql = postgres(connectionString, {
    max: options?.max ?? 5,
    // ...existing options unchanged...
    prepare: false,
    /**
     * A session that cannot write (decision 287): the live harness reads a
     * production project and must never change it. Sent as a startup
     * parameter, so it needs a direct connection (Neon's unpooled URL);
     * PgBouncer in transaction mode may drop it, which is why the harness
     * checks the setting before its first real query.
     */
    ...(options?.readOnly ? { connection: { default_transaction_read_only: 'on' } } : {}),
  })
  return { sql, db: drizzle(sql, { schema }) }
}
```

- [ ] **Step 7: Run the suites**

Run, one at a time:
`pnpm --filter @boom-busters/db test -- src/client.integration.test.ts`
`pnpm --filter @boom-busters/web test -- lib/plan-chapter.test.ts inngest/lib/direction.test.ts`
Expected: PASS. Then the whole web suite once: `pnpm --filter @boom-busters/web test` (timeout 600000). Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add apps/web/lib/plan-chapter.ts apps/web/lib/plan-chapter.test.ts apps/web/inngest/lib/direction.ts packages/db/src/client.ts packages/db/src/client.integration.test.ts
git commit -m "refactor(web): the chapter planner takes its completion; db gains a read-only session (decision 287)"
```

---

### Task 3: The live plan harness, the comparison page, and the before run

**Files:**
- Modify: `apps/web/lib/live-set-args.ts` (export `readRawFlags`, `optionalText`, `parseCap`)
- Create: `apps/web/lib/live-plan-args.ts`, `apps/web/lib/live-plan-args.test.ts`
- Create: `apps/web/lib/live-compare.ts`, `apps/web/lib/live-compare.test.ts`
- Create: `apps/web/scripts/live-plan-test.ts`, `apps/web/scripts/live-compare.ts`
- Modify: `apps/web/package.json` (scripts `live:plan`, `live:compare`)
- Modify: `.gitignore` (add `live-plan-runs/` beside `live-set-runs/` if that is listed; check first)

**Interfaces:**
- Consumes: Task 1 (`assembleStillPrompt`, `planStillReferences`, `referenceBudgets`, `routeForBrief`, `depictedFrom`, `setFrom`), Task 2 (`planChapterWith`, `createDb({ readOnly })`).
- Produces:
  - `parseLivePlanArgs(argv: readonly string[]): LivePlanArgs`
  - `interface LivePlanArgs { project: string; chapter: number; cap: number; label: string; out?: string; briefsFrom?: string; plannerModel?: string }`
  - `interface PlanRunStill { index: number; coversText: string; set?: string; shotSize?: string; file?: string; prompt: string; error?: string }`
  - `interface PlanRunRecord { label: string; project: string; chapter: number; createdAt: string; plannerModel: string; stills: PlanRunStill[]; skipped: number; budget: { capUsd: number; totalUsd: number } }`
  - `compareHtml(before: PlanRunRecord, after: PlanRunRecord, beforeDir: string, afterDir: string): string`
  - `run.json` in each run folder holds a `PlanRunRecord` plus `briefs: StillBrief[]`.

- [ ] **Step 1: Export the shared flag helpers**

In `apps/web/lib/live-set-args.ts`, add `export` to `readRawFlags`, `optionalText` and `parseCap`. No other change.

- [ ] **Step 2: Write the failing argument tests**

Create `apps/web/lib/live-plan-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseLivePlanArgs } from './live-plan-args'

describe('parseLivePlanArgs', () => {
  it('reads a project, a zero-based chapter and a label', () => {
    expect(
      parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--label', 'before']),
    ).toEqual({ project: 'P1', chapter: 5, cap: 1, label: 'before' })
  })

  it('refuses a missing project or a bad chapter', () => {
    expect(() => parseLivePlanArgs(['--chapter', '5'])).toThrow(/--project/)
    expect(() => parseLivePlanArgs(['--project', 'P1', '--chapter', '-1'])).toThrow(/--chapter/)
    expect(() => parseLivePlanArgs(['--project', 'P1', '--chapter', 'x'])).toThrow(/--chapter/)
  })

  it('keeps the $1 cap rules', () => {
    expect(() =>
      parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--cap', '2']),
    ).toThrow("A cap above $1 needs the owner's approval first.")
  })

  it('refuses a label that is not folder-safe', () => {
    expect(() =>
      parseLivePlanArgs(['--project', 'P1', '--chapter', '5', '--label', 'a/b']),
    ).toThrow(/--label/)
  })

  it('takes a previous run to reuse its briefs, and a planner model', () => {
    expect(
      parseLivePlanArgs([
        '--project', 'P1', '--chapter', '5',
        '--briefs-from', 'runs/x', '--planner-model', 'gemini-pro-latest',
      ]),
    ).toMatchObject({ briefsFrom: 'runs/x', plannerModel: 'gemini-pro-latest' })
  })
})
```

Run: `pnpm --filter @boom-busters/web test -- lib/live-plan-args.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `apps/web/lib/live-plan-args.ts`**

```ts
/**
 * The live plan harness's arguments (decision 287). Pure, like
 * `live-set-args.ts`, whose cap rules it shares: a cap above $1 is the
 * owner's decision, never a flag.
 */
import { optionalText, parseCap, readRawFlags } from './live-set-args'

export interface LivePlanArgs {
  project: string
  /** The chapter's stored index, zero-based (`chapters.index`). */
  chapter: number
  cap: number
  /** Names the run folder: "before", "after", or any folder-safe word. */
  label: string
  out?: string
  /** A previous run folder: generate its briefs again instead of planning afresh. */
  briefsFrom?: string
  /** Overrides the production shot-list model, which must otherwise be a Google one. */
  plannerModel?: string
}

export function parseLivePlanArgs(argv: readonly string[]): LivePlanArgs {
  const raw = readRawFlags(argv)
  const project = optionalText(raw, 'project')
  if (!project) throw new Error('--project is required (the project id).')
  const chapterText = optionalText(raw, 'chapter')
  const chapter = Number(chapterText)
  if (chapterText === undefined || !Number.isInteger(chapter) || chapter < 0) {
    throw new Error('--chapter is required: the zero-based chapter index, for example 5.')
  }
  const label = optionalText(raw, 'label') ?? 'run'
  if (!/^[a-z0-9-]+$/i.test(label)) {
    throw new Error('--label may hold only letters, digits and hyphens.')
  }
  const out = optionalText(raw, 'out')
  const briefsFrom = optionalText(raw, 'briefs-from')
  const plannerModel = optionalText(raw, 'planner-model')
  return {
    project,
    chapter,
    cap: parseCap(raw.cap),
    label,
    ...(out ? { out } : {}),
    ...(briefsFrom ? { briefsFrom } : {}),
    ...(plannerModel ? { plannerModel } : {}),
  }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 4: Write the failing comparison-page test**

Create `apps/web/lib/live-compare.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { compareHtml, FAULTS } from './live-compare'

const run = (label: string, prompt: string) => ({
  label,
  project: 'P1',
  chapter: 5,
  createdAt: '2026-09-29T00:00:00Z',
  plannerModel: 'gemini-pro-latest',
  skipped: 0,
  budget: { capUsd: 1, totalUsd: 0.5 },
  stills: [{ index: 0, coversText: 'The board <met>.', file: 'still-0.png', prompt }],
})

describe('compareHtml', () => {
  it('shows both runs side by side with every fault to tick', () => {
    const html = compareHtml(run('before', 'a'), run('after', 'b'), 'runs/before', 'runs/after')
    expect(html).toContain('<title>Before and after</title>')
    for (const fault of FAULTS) expect(html).toContain(fault)
    expect(html).toContain('src="../before/still-0.png"')
    expect(html).toContain('src="still-0.png"')
  })

  it('escapes the sentence and the prompt', () => {
    const html = compareHtml(run('before', '<script>'), run('after', 'b'), 'runs/before', 'runs/after')
    expect(html).toContain('The board &lt;met&gt;.')
    expect(html).toContain('<pre>&lt;script&gt;</pre>')
  })

  it('says why a still has no image', () => {
    const failed = run('after', 'b')
    failed.stills[0] = { index: 0, coversText: 'x', prompt: 'b', error: 'refused' } as never
    expect(compareHtml(run('before', 'a'), failed, 'runs/before', 'runs/after')).toContain('refused')
  })
})
```

Run: `pnpm --filter @boom-busters/web test -- lib/live-compare.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement `apps/web/lib/live-compare.ts`**

```ts
import path from 'node:path'

/**
 * The before and after page (decision 287, spec 10.1): each run's stills in
 * a column, each with its sentence, its prompt and the five faults to tick.
 * The tally at the top counts ticks per still for each column, which is the
 * number the owner reports. Static HTML beside the after run; nothing is
 * stored anywhere.
 */
export const FAULTS = [
  'Extra furniture',
  'Screen facing wrong',
  'Stray props',
  'Room mirrored',
  'Likeness off',
] as const

export interface PlanRunStill {
  index: number
  coversText: string
  set?: string
  shotSize?: string
  file?: string
  prompt: string
  error?: string
}

export interface PlanRunRecord {
  label: string
  project: string
  chapter: number
  createdAt: string
  plannerModel: string
  stills: PlanRunStill[]
  skipped: number
  budget: { capUsd: number; totalUsd: number }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function column(run: PlanRunRecord, imageBase: string, key: string): string {
  const cards = run.stills
    .map((still) => {
      const image = still.file
        ? `<img src="${escapeHtml(path.posix.join(imageBase, still.file))}" alt="">`
        : `<p class="error">No image: ${escapeHtml(still.error ?? 'not generated')}</p>`
      const boxes = FAULTS.map(
        (fault) =>
          `<label><input type="checkbox" data-column="${key}"> ${escapeHtml(fault)}</label>`,
      ).join('')
      return (
        `<article><p class="sentence">${escapeHtml(still.coversText)}</p>` +
        `<p class="meta">${escapeHtml([still.shotSize, still.set].filter(Boolean).join(' · '))}</p>` +
        `${image}<fieldset>${boxes}</fieldset>` +
        `<details><summary>Prompt sent</summary><pre>${escapeHtml(still.prompt)}</pre></details></article>`
      )
    })
    .join('')
  return (
    `<section><h2>${escapeHtml(run.label)} <span data-tally="${key}"></span></h2>` +
    `<p class="meta">${run.stills.length} stills, $${run.budget.totalUsd.toFixed(2)} spent</p>${cards}</section>`
  )
}

export function compareHtml(
  before: PlanRunRecord,
  after: PlanRunRecord,
  beforeDir: string,
  afterDir: string,
): string {
  const beforeBase = path.posix.relative(afterDir.replace(/\\/g, '/'), beforeDir.replace(/\\/g, '/'))
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Before and after</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root{color-scheme:dark;--bg:#0a0a0b;--fg:#f4f4f5;--muted:#a1a1aa;--line:#27272a}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px}
article{border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 12px}
img{width:100%;border-radius:4px}
.sentence{font-weight:600}.meta{color:var(--muted)}.error{color:#ef4444}
fieldset{border:0;padding:8px 0;display:flex;flex-wrap:wrap;gap:8px 16px}
pre{white-space:pre-wrap;font-size:12px;color:var(--muted)}
</style></head><body>
<h1>Before and after, chapter ${before.chapter}</h1>
<p class="meta">Tick every fault you see. The number beside each run is faults per still.</p>
<main>${column(before, beforeBase, 'before')}${column(after, '', 'after')}</main>
<script>
const stills = { before: ${before.stills.length}, after: ${after.stills.length} };
function tally() {
  for (const key of Object.keys(stills)) {
    const ticked = document.querySelectorAll('input[data-column="' + key + '"]:checked').length;
    const per = stills[key] ? (ticked / stills[key]).toFixed(2) : '0';
    document.querySelector('[data-tally="' + key + '"]').textContent = '(' + ticked + ' faults, ' + per + ' per still)';
  }
}
document.addEventListener('change', tally); tally();
</script></body></html>`
}
```

Run the test. Expected: PASS. If `path.posix.join('', 'still-0.png')` gives `still-0.png` and `relative('runs/after','runs/before')` gives `../before`, both assertions hold.

- [ ] **Step 6: Write the harness script**

Create `apps/web/scripts/live-plan-test.ts`. It reads production read-only, plans one chapter with the real planner (or reuses a run's briefs), and generates one image per still through `assembleStillPrompt`, all under `LiveBudget`.

```ts
#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  createDb,
  getProject,
  getSettings,
  latestScriptParagraphSources,
  listCastMembers,
  listProjectSets,
  listVoiceTakes,
  scriptableClaims,
} from '@boom-busters/db'
import {
  findModel,
  geminiImageGen,
  google,
  imageGenPrice,
  priceOf,
  stillStyleAnchors,
} from '@boom-busters/providers'
import type { ImageReference, LLMTaskRequest, ScriptClaim } from '@boom-busters/providers'
import { DirectorsBookSchema, setForBrief, StillBriefSchema } from '@boom-busters/schemas'
import type { StillBrief } from '@boom-busters/schemas'
import { timedParagraphs } from '@/inngest/lib/shot-list'
import { BudgetExceeded, LiveBudget } from '@/lib/live-budget'
import type { PlanRunRecord, PlanRunStill } from '@/lib/live-compare'
import { parseLivePlanArgs } from '@/lib/live-plan-args'
import { planChapterWith } from '@/lib/plan-chapter'
import {
  assembleStillPrompt,
  depictedFrom,
  planStillReferences,
  referenceBudgets,
  routeForBrief,
  setFrom,
} from '@/lib/still-prompt'

/**
 * The live plan harness (decision 287, spec 10.1): the real planner on one
 * production chapter, then one image per still through the app's own prompt
 * assembly, so a prompt change is measured on what the app actually writes.
 *
 * Reads production and writes nothing to it: the session is read-only and is
 * checked before the first query; R2 is only read; nothing is recorded in the
 * cost ledger. `run.json` in the output folder is the record. Every paid call
 * reserves its estimate first under the owner's $1 cap.
 */

const FALLBACK_STILL_MODEL = 'gemini-3.1-flash-image'
const PLANNER_RESERVE_USD = 0.12

async function main(): Promise<void> {
  const args = parseLivePlanArgs(process.argv.slice(2))
  const apiKey = process.env.GEMINI_API_KEY
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!apiKey) throw new Error('Set GEMINI_API_KEY in .env.local. Nothing was spent.')
  if (!url) throw new Error('Set DATABASE_URL_UNPOOLED in .env.local. Nothing was spent.')

  const { sql, db } = createDb(url, { max: 1, readOnly: true })
  const [guard] = await sql`show default_transaction_read_only`
  if (guard?.default_transaction_read_only !== 'on') {
    await sql.end()
    throw new Error('The database session is not read-only; refusing to go on. Nothing was spent.')
  }

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
    },
  })
  const bytesOf = async (key: string): Promise<string> => {
    const object = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key }))
    const bytes = await object.Body?.transformToByteArray()
    if (!bytes) throw new Error(`R2 object ${key} has no body.`)
    return Buffer.from(bytes).toString('base64')
  }

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outDir = args.out ?? path.join(repoRoot, 'live-plan-runs', `${stamp}-${args.label}`)
  mkdirSync(outDir, { recursive: true })
  const budget = new LiveBudget(args.cap)
  const stills: PlanRunStill[] = []
  let briefs: StillBrief[] = []
  let plannerModel = args.plannerModel ?? ''
  let skipped = 0

  const writeRun = (): void => {
    const record: PlanRunRecord & { briefs: StillBrief[]; entries: unknown } = {
      label: args.label,
      project: args.project,
      chapter: args.chapter,
      createdAt: new Date().toISOString(),
      plannerModel,
      stills,
      skipped,
      budget: { capUsd: args.cap, totalUsd: budget.spentUsd },
      briefs,
      entries: budget.entries,
    }
    writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(record, null, 2))
  }

  try {
    const project = await getProject(db, args.project)
    if (!project) throw new Error(`No project ${args.project}.`)
    const settings = await getSettings(db)
    const cast = await listCastMembers(db, args.project)
    const sets = await listProjectSets(db, args.project)
    const book = DirectorsBookSchema.safeParse(project.direction)

    if (args.briefsFrom) {
      const previous = JSON.parse(readFileSync(path.join(args.briefsFrom, 'run.json'), 'utf8')) as {
        briefs: unknown[]
        plannerModel: string
      }
      briefs = previous.briefs.map((brief) => StillBriefSchema.parse(brief))
      plannerModel = `reused from ${args.briefsFrom} (${previous.plannerModel})`
    } else {
      const routing = settings.modelRouting.shotlist
      plannerModel = args.plannerModel ?? (routing.provider === 'google' ? routing.model : '')
      if (!plannerModel) {
        throw new Error(
          `The shot list runs on ${routing.provider} in production; pass --planner-model <a Google id>. Nothing was spent.`,
        )
      }
      const model = findModel(google, plannerModel)
      if (!model) throw new Error(`--planner-model "${plannerModel}" is not a Google model this app knows.`)

      const sources = await latestScriptParagraphSources(db, args.project)
      const chapter = sources.chapters[args.chapter]
      if (!chapter) throw new Error(`The script has no chapter at index ${args.chapter}.`)
      const takes = await listVoiceTakes(db, args.project)
      const claims = (await scriptableClaims(db, args.project)).map((claim) => ({
        id: claim.id,
        text: claim.text,
        sourceUrl: claim.sourceUrl,
        confidence: claim.confidence,
        sourceType: claim.sourceType,
      })) satisfies ScriptClaim[]

      let call = 0
      const planned = await planChapterWith(
        async (request: LLMTaskRequest, purpose) => {
          const label = `planner-${purpose}-${(call += 1)}`
          budget.reserve(label, PLANNER_RESERVE_USD)
          const result = await google.complete(request, { apiKey, model: plannerModel })
          budget.record(label, priceOf(model, result.usage))
          return { text: result.text }
        },
        {
          caseTitle: project.title,
          chapter: { id: chapter.id, title: chapter.title, number: args.chapter + 1 },
          paragraphs: timedParagraphs({ chapters: sources.chapters, takes }),
          claims,
          styleAnchors: stillStyleAnchors(settings.brandKit),
          direction: book.success ? book.data : null,
          photographed: cast.filter((m) => m.photos.length > 0).map((m) => m.name),
          sets: sets.map(({ name, look, layout }) => ({ name, look, layout })),
        },
      )
      briefs = (planned?.slots ?? [])
        .map((slot) => slot.brief)
        .filter((brief): brief is StillBrief => brief.type === 'still')
    }
    writeRun()

    for (const [index, brief] of briefs.entries()) {
      const members = depictedFrom(brief, cast)
      const set = setFrom(brief, sets)
      const route = routeForBrief(brief, cast, sets, settings.modelRouting)
      const imageModel = route.provider === 'google' ? route.model : FALLBACK_STILL_MODEL
      const plan = planStillReferences(
        members,
        set,
        referenceBudgets(geminiImageGen.referenceLimits(imageModel)),
        brief.camera?.facing,
      )
      const prompt = assembleStillPrompt({
        scene: brief.prompt,
        ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
        ...(brief.camera ? { camera: brief.camera } : {}),
        layout: setForBrief(brief.set, sets)?.layout ?? '',
        people: plan.people,
        set: plan.setName === null ? null : { name: plan.setName, plates: plan.plates.length },
      })
      const entry: PlanRunStill = {
        index,
        coversText: brief.coversText,
        prompt,
        ...(brief.set ? { set: brief.set } : {}),
        ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
      }
      stills.push(entry)
      try {
        budget.reserve(`still-${index}`, imageGenPrice(geminiImageGen, 1, imageModel, '1K'))
      } catch (error) {
        if (!(error instanceof BudgetExceeded)) throw error
        entry.error = 'skipped: the next image would pass the cap'
        skipped = briefs.length - index
        break
      }
      const references: ImageReference[] = []
      for (const { member, photo } of plan.photos) {
        references.push({ name: member.name, kind: 'character', mimeType: photo.mimeType, data: await bytesOf(photo.r2Key) })
      }
      for (const plate of plan.plates) {
        references.push({
          name: plan.setName ?? '',
          kind: 'object',
          mimeType: plate.mimeType,
          data: await bytesOf(plate.r2Key),
          ...(plate.view === 'other' ? {} : { facing: plate.view }),
        })
      }
      try {
        const result = await geminiImageGen.generate(
          {
            prompt,
            ...(brief.negativePrompt ? { negativePrompt: brief.negativePrompt } : {}),
            count: 1,
            model: imageModel,
            size: '1K',
            ...(references.length > 0 ? { references } : {}),
          },
          { apiKey },
        )
        budget.record(`still-${index}`, result.estimatedCostUsd)
        const image = result.images[0]
        if (image) {
          entry.file = `still-${index}.png`
          writeFileSync(path.join(outDir, entry.file), Buffer.from(image.url.slice(image.url.indexOf(',') + 1), 'base64'))
        } else {
          entry.error = 'Gemini returned no image'
        }
      } catch (error) {
        budget.record(`still-${index}`, 0)
        entry.error = error instanceof Error ? error.message : String(error)
      }
      writeRun()
    }
    writeRun()
    console.log(outDir)
    console.log(`Total spent: $${budget.spentUsd.toFixed(4)}`)
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
```

Check against the code before running typecheck: the exact return shapes of `latestScriptParagraphSources` (`sources.chapters` entries carry `id` and `title`, as `visuals-runner.ts:133` uses them; confirm the array is ordered by `chapters.index` so `sources.chapters[args.chapter]` is the chapter at that index, and find it by its index field instead if not), `scriptableClaims` rows, `geminiImageGen.referenceLimits` and `google.complete`'s `usage`. Adjust names to what the code says; the structure stays.

Create `apps/web/scripts/live-compare.ts`:

```ts
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { compareHtml } from '@/lib/live-compare'
import type { PlanRunRecord } from '@/lib/live-compare'

const [beforeDir, afterDir] = process.argv.slice(2)
if (!beforeDir || !afterDir) {
  console.error('Usage: live:compare <before run folder> <after run folder>')
  process.exit(1)
}
const read = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')) as PlanRunRecord
const out = path.join(afterDir, 'compare.html')
writeFileSync(out, compareHtml(read(beforeDir), read(afterDir), beforeDir, afterDir))
console.log(out)
```

In `apps/web/package.json` scripts, beside `live:set`:

```json
    "live:plan": "tsx --env-file=../../.env.local scripts/live-plan-test.ts",
    "live:compare": "tsx scripts/live-compare.ts",
```

- [ ] **Step 7: Typecheck and a dry refusal**

Run: `pnpm typecheck`
Expected: clean.

Run (spends nothing: the missing flag is refused before any read):
`pnpm --filter @boom-busters/web live:plan -- --chapter 5`
Expected: `--project is required (the project id).` and exit 1.

- [ ] **Step 8: Commit**

```bash
pnpm lint && pnpm format:check
git add apps/web/lib/live-set-args.ts apps/web/lib/live-plan-args.ts apps/web/lib/live-plan-args.test.ts apps/web/lib/live-compare.ts apps/web/lib/live-compare.test.ts apps/web/scripts/live-plan-test.ts apps/web/scripts/live-compare.ts apps/web/package.json .gitignore
git commit -m "feat(web): live plan harness and before-and-after page (decision 287)"
```

- [ ] **Step 9: The before run (paid; ask the owner first)**

Tell the owner the command, the chapter and the cap, and wait for a yes. Then:

`pnpm --filter @boom-busters/web live:plan -- --project 01M1F7KDJVGDSJ31WE7BPSBKZR --chapter 5 --label before`

Expected: a folder under `live-plan-runs/` with `run.json` and one `still-N.png` per still, total under $1. If chapter 5 plans fewer than four set shots, run chapter 4 instead (spec 10.1) and tell the owner. Record the folder path; Task 10 needs it. Do not commit the run folder.

---

### Task 4: The compositor grade and the Photographic look card

Must be deployed before prompts stop carrying the anchors (Tasks 5 and 6), so no still is ever ungraded.

**Files:**
- Modify: `packages/schemas/src/settings.ts:353-359` (`gradePreset`), `:611-643` (default), `:651-653` (`resolveBrandKit`)
- Modify: `packages/compositions/src/components/DocumentaryMaster.tsx:137-174` (grade wrapper)
- Modify: `apps/web/app/(console)/settings/settings-form.tsx:422-501` (Photographic look card)
- Test: `packages/schemas/src/settings.test.ts`, `packages/compositions/src/components/DocumentaryMaster.test.tsx` (create if absent; follow `SocialPostCard.test.tsx` for rendering), `apps/web/app/(console)/settings/brand-look.test.tsx` (create; follow `models-tab.test.tsx`)

**Interfaces:**
- Produces:
  - `GRADE_PRESETS = ['none', 'muted', 'strong'] as const`, `type GradePreset`
  - `BrandLookSchema.gradePreset: GradePreset | undefined` (optional: absent in a timeline means compiled before grades existed, and renders ungraded)
  - `resolveBrandKit(settings)` always returns `look.gradePreset` set (`settings.brandKit.look.gradePreset ?? 'muted'`)
  - `GRADE_FILTER: Record<GradePreset, string | undefined>` exported from `DocumentaryMaster.tsx`

- [ ] **Step 1: Failing schema tests**

Add to `packages/schemas/src/settings.test.ts`:

```ts
describe('gradePreset (decision 287)', () => {
  it('is absent from an old timeline brand, which means ungraded', () => {
    const brand = BrandKitTokensSchema.parse({ ...resolveBrandKit(DEFAULT_SETTINGS), look: { ...DEFAULT_SETTINGS.brandKit.look, gradePreset: undefined } })
    expect(brand.look.gradePreset).toBeUndefined()
  })

  it('resolves to muted for settings that never chose one', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    delete (settings.brandKit.look as { gradePreset?: string }).gradePreset
    expect(resolveBrandKit(settings).look.gradePreset).toBe('muted')
  })

  it('keeps a chosen grade', () => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.brandKit.look.gradePreset = 'strong'
    expect(resolveBrandKit(settings).look.gradePreset).toBe('strong')
  })
})
```

Import `resolveBrandKit` and `DEFAULT_SETTINGS` if the file does not already. Run: `pnpm --filter @boom-busters/schemas test -- src/settings.test.ts`. Expected: FAIL.

- [ ] **Step 2: Implement the schema**

In `packages/schemas/src/settings.ts`:

```ts
/**
 * The compositor's colour grade on photographic slots (decision 287). Image
 * prompts carry no grade, grain or colour code; the film is graded once, here.
 * Optional in the schema on purpose: a timeline compiled before grades
 * existed has none and renders exactly as it did, while `resolveBrandKit`
 * gives every new compile the house default.
 */
export const GRADE_PRESETS = ['none', 'muted', 'strong'] as const
export type GradePreset = (typeof GRADE_PRESETS)[number]

export const BrandLookSchema = z.object({
  logoR2Key: z.string().nullable().default(null),
  watermarkPlacement: z.enum(['none', 'tl', 'tr', 'bl', 'br']).default('br'),
  grainPreset: z.enum(['none', 'subtle', 'film', 'heavy']).default('subtle'),
  gradePreset: z.enum(GRADE_PRESETS).optional(),
  lowerThirdVariant: z.enum(['bar', 'stack', 'minimal']).default('bar'),
  chapterCardVariant: z.enum(['full', 'corner', 'minimal']).default('full'),
})
```

In `DEFAULT_SETTINGS.brandKit.look` add `gradePreset: 'muted',`. Replace `resolveBrandKit`:

```ts
export function resolveBrandKit(settings: Settings): BrandKitTokens {
  return {
    ...settings.brandKit,
    look: { ...settings.brandKit.look, gradePreset: settings.brandKit.look.gradePreset ?? 'muted' },
    voice: settings.tts,
  }
}
```

Run the schemas suite. Expected: PASS. Then run `pnpm --filter @boom-busters/timeline test` and `pnpm --filter @boom-busters/web test -- lib/` for consumers of `resolveBrandKit` (a snapshot or deep-equal of a compiled brand may now carry `gradePreset: 'muted'`; update such expectations to include it, never delete the assertion).

- [ ] **Step 3: Failing composition test**

Create or extend `packages/compositions/src/components/DocumentaryMaster.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { GRADE_FILTER } from './DocumentaryMaster'

describe('GRADE_FILTER (decision 287)', () => {
  it('leaves an ungraded film alone', () => {
    expect(GRADE_FILTER.none).toBeUndefined()
  })

  it('mutes photographs, and strong goes further', () => {
    expect(GRADE_FILTER.muted).toMatch(/saturate\(0\.\d+\)/)
    const sat = (f: string | undefined) => Number(/saturate\(([\d.]+)\)/.exec(f ?? '')?.[1])
    expect(sat(GRADE_FILTER.strong)).toBeLessThan(sat(GRADE_FILTER.muted))
  })
})
```

Add a render test in the same file only if an existing test in the package renders `SlotView` or `DocumentaryMaster` with a timeline fixture; if so, assert that an `image` slot's wrapper carries `style.filter === GRADE_FILTER.muted` for a brand with `gradePreset: 'muted'`, that a `chart` slot's does not, and that a brand with no `gradePreset` has no filter. Run: `pnpm --filter @boom-busters/compositions test -- src/components/DocumentaryMaster.test.tsx`. Expected: FAIL.

- [ ] **Step 4: Implement the grade**

In `DocumentaryMaster.tsx`, beside `GRAIN_OPACITY`:

```tsx
/**
 * The film's grade (decision 287): one CSS filter over photographic slots,
 * stills, stock and archival alike, so generated and real pictures sit in
 * one look. Charts, cards, graphics and maps are drawn in brand colours and
 * are never filtered. Values set by eye in the player and a render.
 */
export const GRADE_FILTER: Record<GradePreset, string | undefined> = {
  none: undefined,
  muted: 'saturate(0.82) contrast(1.06) brightness(0.97)',
  strong: 'saturate(0.68) contrast(1.12) brightness(0.94)',
}
```

In `SlotView`, wrap only the `image` and `video` branches:

```tsx
  const grade = GRADE_FILTER[brand.look.gradePreset ?? 'none']
  const graded = (child: React.ReactNode) =>
    grade ? <AbsoluteFill style={{ filter: grade }}>{child}</AbsoluteFill> : child
```

and use `graded(<KenBurnsImage ... />)` and `graded(<StockClip ... />)` in those two branches. Import `GradePreset` from `@boom-busters/schemas` and `React` if the file does not already.

Run the compositions suite alone: `pnpm --filter @boom-busters/compositions test`. If a golden in `src/snapshot/golden` changes because an image slot is now graded, confirm by eye that only the grade differs, regenerate that golden from this package-alone run (never from a full-repo run), and say so in the commit message.

- [ ] **Step 5: Failing settings UI test**

Create `apps/web/app/(console)/settings/brand-look.test.tsx`, copying the setup (mocks of `./actions`, the toast, and how `SettingsForm` is rendered and its Brand Kit tab opened) from `models-tab.test.tsx`:

```tsx
it('offers grain and grade on the Brand Kit tab, and saves a choice', async () => {
  // render SettingsForm with DEFAULT_SETTINGS, open the "Brand Kit" tab as models-tab.test does
  const grade = screen.getByLabelText('Grade')
  expect((grade as HTMLSelectElement).value).toBe('muted')
  await user.selectOptions(grade, 'strong')
  expect(saveSettings).toHaveBeenCalledWith(
    expect.objectContaining({ brandKit: expect.objectContaining({ look: expect.objectContaining({ gradePreset: 'strong' }) }) }),
  )
  expect(screen.getByLabelText('Grain')).toBeInTheDocument()
})
```

Use the exact save mock and argument shape `models-tab.test.tsx` asserts on `commit`. Run it. Expected: FAIL.

- [ ] **Step 6: Implement the card**

In `BrandKitTab`, after the Colours card:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Photographic look</CardTitle>
          <CardDescription>
            Applied to every photograph in the film at render: stills, stock and archival. Image
            prompts carry no grade or grain, so this is the one place the film&apos;s look is set.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-grade">Grade</Label>
            <Select
              id="look-grade"
              aria-label="Grade"
              value={settings.brandKit.look.gradePreset ?? 'muted'}
              disabled={saving}
              onChange={(event) => setLook('gradePreset', event.target.value as GradePreset)}
            >
              <option value="none">None</option>
              <option value="muted">Muted</option>
              <option value="strong">Strong</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="look-grain">Grain</Label>
            <Select
              id="look-grain"
              aria-label="Grain"
              value={settings.brandKit.look.grainPreset}
              disabled={saving}
              onChange={(event) =>
                setLook('grainPreset', event.target.value as Settings['brandKit']['look']['grainPreset'])
              }
            >
              <option value="none">None</option>
              <option value="subtle">Subtle</option>
              <option value="film">Film</option>
              <option value="heavy">Heavy</option>
            </Select>
          </div>
        </CardContent>
      </Card>
```

with, beside `setColor`:

```tsx
  const setLook = <K extends 'gradePreset' | 'grainPreset'>(
    key: K,
    value: Settings['brandKit']['look'][K],
  ) => {
    const next = structuredClone(settings)
    next.brandKit.look[key] = value
    void commit({ brandKit: { ...next.brandKit } }, next)
  }
```

Import `GradePreset` and `Settings` types as the file's other schema imports do. Run the settings tests: `pnpm --filter @boom-busters/web test -- "app/(console)/settings"`. Expected: PASS (every tab test, including `voice-tab.test.tsx`).

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add packages/schemas/src/settings.ts packages/schemas/src/settings.test.ts packages/compositions/src/components/DocumentaryMaster.tsx packages/compositions/src/components/DocumentaryMaster.test.tsx "apps/web/app/(console)/settings/settings-form.tsx" "apps/web/app/(console)/settings/brand-look.test.tsx"
git commit -m "feat: the compositor grades photographs; Brand Kit gains Grade and Grain (decision 287)"
```

Rollout note for Task 10 (not now): `deploy:remotion` and `deploy:stacks boom-busters-broker` must go out before or with the Vercel deploy of this branch.

---

### Task 5: The assembler takes ownership

`assembleStillPrompt` changes behaviour: fixed order, a qualities-only photograph line, legacy pasted lines stripped, framing on every still, positive reference sentences.

**Files:**
- Create: `apps/web/lib/photograph-lines.ts`
- Modify: `apps/web/lib/still-prompt.ts` (`sceneOf`, `referenceSentences`, new `assembleStillPrompt`; delete `withReferenceClause`)
- Modify: `apps/web/lib/set-plates.ts:152-159` (`framingLead` takes an optional camera and returns a sentence)
- Test: `apps/web/lib/still-prompt.test.ts`, `apps/web/lib/set-plates.test.ts:101-106`, `apps/web/lib/visual-assets.test.ts` (prompt assertions at 152-163, 251, 457-483, 717-754, 840, 871-896, 918-980)

**Interfaces:**
- Consumes: Task 1's `StillPromptInput`, `StillKind`.
- Produces:
  - `PHOTOGRAPH_LINE`, `PLATE_PHOTOGRAPH_LINE`, `TEASER_COMPOSITION` (from `photograph-lines.ts`)
  - `sceneOf(prompt: string): string`
  - `referenceSentences(people, set, hasCamera: boolean): string[]`
  - `framingLead(camera: SetCamera | undefined, shotSize?: ShotSize): string` (a whole sentence or '')
  - `REFERENCE_MARKER` unchanged

- [ ] **Step 1: Create the lines module**

`apps/web/lib/photograph-lines.ts`:

```ts
/**
 * The fixed words code adds to image prompts (decision 287). They name
 * qualities, never objects: the house line that named "a coffee ring, cable
 * runs, papers out of line" put a coffee ring in 44 of 46 stills of one film.
 * No lens, no height, no grain, no grade: each shot states its own lens, and
 * the compositor grades the film.
 */
export const PHOTOGRAPH_LINE =
  "An available-light documentary photograph: light from the scene's own sources, surfaces showing ordinary daily use, people caught candid and mid-moment, never posing or acting for the camera."

/** Plates and sheets are rooms without people. */
export const PLATE_PHOTOGRAPH_LINE =
  "An available-light documentary photograph: light from the room's own sources, surfaces showing ordinary daily use."

/** The teaser is cropped to 9:16 by the compositor; this keeps the subject inside the crop. */
export const TEASER_COMPOSITION =
  'The subject sits in the centre third, with headroom above for the hook text and nothing important in the bottom quarter, where captions sit.'
```

- [ ] **Step 2: Write the failing tests**

Replace the Task 1 `assembleStillPrompt` describe block in `still-prompt.test.ts` (and drop its `withReferenceClause`, `describeCamera` and `framingLead` imports, since `withReferenceClause` is deleted in this task) with:

```ts
import { PHOTOGRAPH_LINE, PLATE_PHOTOGRAPH_LINE, TEASER_COMPOSITION } from './photograph-lines'
import { REFERENCE_MARKER, sceneOf } from './still-prompt'

const LEGACY_HOUSE =
  'An available-light documentary photograph, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line; people caught candid and mid-moment, never posing or acting for the camera.'
const LEGACY_ANCHORS =
  'subtle film grain; muted documentary colour grade anchored on #0f1115 and #ef4444 against #0a0a0b; sombre, photographic realism'

describe('sceneOf (decision 287)', () => {
  it('strips the house line and anchors the planner pasted', () => {
    expect(sceneOf(`Emad at the table, hands clasped. ${LEGACY_HOUSE} ${LEGACY_ANCHORS}`)).toBe(
      'Emad at the table, hands clasped.',
    )
  })

  it('strips the palette prefix and keeps the planner words after the anchors', () => {
    expect(
      sceneOf(`A laptop on a desk. ${LEGACY_HOUSE} accent #ef4444, cold; ${LEGACY_ANCHORS}. Eye level, 35mm lens.`),
    ).toBe('A laptop on a desk. Eye level, 35mm lens.')
  })

  it('strips the older house line that still named a lens', () => {
    const older =
      'An available-light documentary photograph, 35mm, eye level, slight grain, mixed colour temperature from window daylight and warm practicals, real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line.'
    expect(sceneOf(`A door. ${older}`)).toBe('A door.')
  })

  it('strips a clean-grain anchors line and the old teaser clause', () => {
    const anchors = 'clean, no grain; muted documentary colour grade anchored on #111 and #222 against #333; sombre, photographic realism'
    const teaser = 'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, nothing important in the bottom quarter where captions sit.'
    expect(sceneOf(`A podium. ${teaser} ${anchors}`)).toBe('A podium.')
  })

  it('cuts an old reference declaration an owner pasted back in', () => {
    expect(sceneOf(`Emad at a podium.\n\n${REFERENCE_MARKER} 2 photographs of Emad.`)).toBe('Emad at a podium.')
  })

  it('leaves a clean scene as it is, and is idempotent', () => {
    const clean = 'Four directors at a long table, dusk light from the windows.'
    expect(sceneOf(clean)).toBe(clean)
    const once = sceneOf(`A desk. ${LEGACY_HOUSE}`)
    expect(sceneOf(once)).toBe(once)
  })
})

describe('assembleStillPrompt (decision 287)', () => {
  const camera = { facing: 'south' as const, position: 'the north windows, seated', lens: '35mm' }
  const base = {
    scene: `Emad Mostaque seated at the long table, hands clasped. ${LEGACY_HOUSE} ${LEGACY_ANCHORS}`,
    shotSize: 'medium' as const,
    camera,
    layout: boardroom.layout,
    people: [{ name: 'Emad Mostaque', photos: 2 }],
    set: { name: 'The Stability AI Boardroom', plates: 2 },
  }

  it('puts framing, camera, scene, references and the photograph line in that order', () => {
    const prompt = assembleStillPrompt(base)
    const at = (text: string) => prompt.indexOf(text)
    expect(at('A medium shot')).toBe(0)
    expect(at('The camera stands at')).toBeGreaterThan(at('A medium shot'))
    expect(at('Emad Mostaque seated')).toBeGreaterThan(at('The camera stands at'))
    expect(at(REFERENCE_MARKER)).toBeGreaterThan(at('Emad Mostaque seated'))
    expect(prompt.endsWith(PHOTOGRAPH_LINE)).toBe(true)
  })

  it('names one lens, one camera, and no grain, hex code or listed prop', () => {
    const prompt = assembleStillPrompt(base)
    expect(prompt.match(/\d+\s?mm/g)).toEqual(['35mm'])
    expect(prompt.match(/The camera stands at/g)).toHaveLength(1)
    expect(prompt).not.toMatch(/grain|#[0-9a-f]{3,8}|coffee|cable runs/i)
  })

  it('frames a still with no camera from its shot size', () => {
    const prompt = assembleStillPrompt({ scene: 'An invoice on a desk.', shotSize: 'close', layout: '', people: [], set: null })
    expect(prompt.startsWith('A close shot:')).toBe(true)
  })

  it('gives a wide or unsized still no framing lead', () => {
    const prompt = assembleStillPrompt({ scene: 'A data centre aisle.', layout: '', people: [], set: null })
    expect(prompt.startsWith('A data centre aisle.')).toBe(true)
  })

  it('sends the camera for a set with an inventory but no plates, and promises no photographs', () => {
    const prompt = assembleStillPrompt({ ...base, people: [], set: null })
    expect(prompt).toContain('The camera stands at')
    expect(prompt).not.toContain(REFERENCE_MARKER)
  })

  it('says a set photograph is new without the edit wording, with or without a camera', () => {
    const withCamera = assembleStillPrompt(base)
    const without = assembleStillPrompt({ ...base, camera: undefined })
    for (const prompt of [withCamera, without]) {
      expect(prompt).toContain("show this room's furniture, materials and light")
      expect(prompt).not.toContain('never reproduce or edit the framing')
    }
  })

  it('builds a plate with no framing lead, no people clause and the plate line', () => {
    const prompt = assembleStillPrompt({
      scene: 'The Stability AI Boardroom, empty of people: a wide photograph of the whole room facing east. A stark room.',
      camera: { facing: 'east', position: 'the middle of the west wall, at eye level', lens: '35mm' },
      layout: boardroom.layout,
      people: [],
      set: { name: 'The Stability AI Boardroom', plates: 1 },
      kind: 'plate',
    })
    expect(prompt.startsWith('The camera stands at')).toBe(true)
    expect(prompt.endsWith(PLATE_PHOTOGRAPH_LINE)).toBe(true)
    expect(prompt).not.toContain('candid')
  })

  it('adds the teaser composition to a teaser', () => {
    const prompt = assembleStillPrompt({ scene: 'Emad at a podium.', layout: '', people: [], set: null, kind: 'teaser' })
    expect(prompt).toContain(TEASER_COMPOSITION)
    expect(prompt).not.toContain('9:16')
  })

  it('keeps every fixed line free of named props', () => {
    for (const line of [PHOTOGRAPH_LINE, PLATE_PHOTOGRAPH_LINE, TEASER_COMPOSITION]) {
      expect(line).not.toMatch(/coffee|cup|mug|cable|paper|laptop|monitor|dust|rain|grain|\d+\s?mm/i)
    }
  })
})
```

In `set-plates.test.ts:101-106` change the expectations to:

```ts
    expect(framingLead(camera, 'close')).toBe(
      'A close shot: the subject fills most of the frame, the background soft and out of focus.',
    )
    expect(framingLead(camera, 'medium')).toBe('A medium shot: the subject from the waist up.')
    expect(framingLead(camera, 'wide')).toBe('')
    expect(framingLead(camera)).toContain('A close shot')
    expect(framingLead(undefined, 'close')).toContain('A close shot')
    expect(framingLead(undefined)).toBe('')
```

Run: `pnpm --filter @boom-busters/web test -- lib/still-prompt.test.ts lib/set-plates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Change `framingLead`**

In `set-plates.ts`:

```ts
export function framingLead(camera: SetCamera | undefined, shotSize?: ShotSize): string {
  const framing = framingOf(shotSize, camera?.lens)
  if (framing === 'close') {
    return 'A close shot: the subject fills most of the frame, the background soft and out of focus.'
  }
  if (framing === 'medium') return 'A medium shot: the subject from the waist up.'
  return ''
}
```

Keep the doc comment above it and add one line: "Every still gets it now, with or without a set (decision 287); it is a sentence of its own because the camera sentence follows it."

- [ ] **Step 4: Rewrite the assembler**

In `still-prompt.ts`, delete `withReferenceClause` and add:

```ts
import { PHOTOGRAPH_LINE, PLATE_PHOTOGRAPH_LINE, TEASER_COMPOSITION } from './photograph-lines'

/*
 * What the planner used to paste into every prompt (decisions 252 to 275),
 * matched by shape rather than by today's Brand Kit values, because a kit
 * edited since planning would otherwise leave its old anchors behind.
 */
const LEGACY_HOUSE_LINE =
  /An available-light documentary photograph,[^;]*?real materials with wear: scuffed edges, cable runs, a coffee ring, papers out of line(?:; people caught candid and mid-moment, never posing or acting for the camera)?\./g
const LEGACY_ANCHORS =
  /(?:[a-z]+ film grain|clean, no grain); muted documentary colour grade anchored on #[0-9a-f]{3,8} and #[0-9a-f]{3,8} against #[0-9a-f]{3,8}; sombre, photographic realism\.?/gi
const LEGACY_PALETTE = /accent #[0-9a-f]{3,8}, (?:cold|neutral|warm);/gi
const LEGACY_TEASER_CLAUSE =
  'Vertical 9:16 frame: subject in the centre third, headroom above for the hook text, nothing important in the bottom quarter where captions sit.'

/**
 * The planner's own words in a stored prompt (decision 287): the scene, with
 * every line code now adds taken back out. Stored briefs are never rewritten,
 * so no brief hash moves and no resolved slot is bought again; the strip
 * happens each time a prompt is read. Idempotent.
 */
export function sceneOf(prompt: string): string {
  const marker = prompt.indexOf(REFERENCE_MARKER)
  const own = marker === -1 ? prompt : prompt.slice(0, marker)
  return own
    .replace(LEGACY_HOUSE_LINE, ' ')
    .replace(LEGACY_ANCHORS, ' ')
    .replace(LEGACY_PALETTE, ' ')
    .split(LEGACY_TEASER_CLAUSE)
    .join(' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/([.;,])(?:\s*[.;,])+/g, '$1')
    .trim()
}

/**
 * What each attached photograph is for (decisions 253, 264, 273, 276): the
 * sentences that used to close the prompt, now one segment of it. Counted
 * from what actually travels.
 */
export function referenceSentences(
  people: readonly { name: string; photos: number }[],
  set: { name: string; plates: number } | null,
  hasCamera: boolean,
): string[] {
  if (people.length === 0 && set === null) return []
  const inventory = andList([
    ...people.map((person) => `${photographCount(person.photos)} of ${person.name}`),
    ...(set ? [`${photographCount(set.plates)} of ${set.name}`] : []),
  ])
  const sentences = [`${REFERENCE_MARKER} ${inventory}.`]
  if (people.length > 0) {
    const names = andList(people.map((person) => person.name))
    sentences.push(
      `The photographs of ${names} are for likeness only: match ` +
        `${people.length === 1 ? 'the face' : 'each face'} exactly, with its hair, facial hair ` +
        `and glasses, while clothing, pose and expression follow the text above.`,
      `Everyone else in the frame is a different person, unlike ` +
        `${people.length === 1 ? names : 'any of them'} in face, hair and age.`,
      `${people.length === 1 ? names : 'Each person'} is photographed in the scene, never ` +
        `pasted onto it: at true scale, seated in a chair or standing on the floor, lit by ` +
        `the scene's own light, and behind anything standing nearer the camera.`,
    )
  }
  if (set) {
    // Positive either way (decision 287): "never reproduce or edit the
    // framing" read as an edit instruction, the fault decision 275 found.
    sentences.push(
      `The photographs of ${set.name} show this room's furniture, materials and light; this ` +
        `photograph is a new one ${hasCamera ? 'from the camera described above' : 'taken inside it'}.`,
    )
  }
  return sentences
}

/**
 * The one place an image prompt is put together (decision 287). Order:
 * framing, the camera and the room it sees, the scene, what the photographs
 * are for, the photograph line. The opening of a prompt wins (decision 275's
 * live runs), so the geometry comes before the scene rather than after it.
 * The avoid list is the adapter's, which knows whether its model has a real
 * negative field.
 */
export function assembleStillPrompt(input: StillPromptInput): string {
  const kind = input.kind ?? 'still'
  const camera = input.camera ? describeCamera(input.camera, input.layout, input.shotSize) : null
  const references = referenceSentences(input.people, input.set, camera !== null)
  return [
    kind === 'plate' ? '' : framingLead(input.camera, input.shotSize),
    camera ?? '',
    stripBannedWords(sceneOf(input.scene)),
    kind === 'teaser' ? TEASER_COMPOSITION : '',
    references.join(' '),
    kind === 'plate' ? PLATE_PHOTOGRAPH_LINE : PHOTOGRAPH_LINE,
  ]
    .filter((part) => part.trim() !== '')
    .join('\n\n')
}
```

Update the module's top doc comment to say it now assembles the whole prompt (decision 287) and that it stays free of database, storage and env imports.

- [ ] **Step 5: Run and fix the generation tests**

Run: `pnpm --filter @boom-busters/web test -- lib/still-prompt.test.ts lib/set-plates.test.ts`. Expected: PASS.

Run: `pnpm --filter @boom-busters/web test -- lib/visual-assets.test.ts`. Expected: FAIL where tests pin the old order or text. Update each, keeping its intent:
- 457-461 (a prompt already carrying the marker passed through untouched): now expect the declaration written once: `expect(prompt.match(/References attached:/g)).toHaveLength(1)` and `expect(prompt).toContain('Emad Mostaque at a podium.')`.
- 468 (`toBe(still.prompt)` for a plain still): now `toBe(assembleStillPrompt({ scene: still.prompt, layout: '', people: [], set: null, ...(still.shotSize ? { shotSize: still.shotSize } : {}) }))`, or assert it starts with the scene and ends with `PHOTOGRAPH_LINE`.
- 483 (banned word stripped): `expect(prompt).toContain('A boardroom at dusk.')` and `not.toContain('cinematic')`.
- 729-730 (`prompt.startsWith(still.prompt)`): replace with the ordering assertion that the scene comes before `REFERENCE_MARKER`.
- 892 (`Behind the camera, out of frame: glass.`): leave for Task 9, which removes that line; it still passes here.
- 896 (`not.toContain('never reproduce or edit the framing')`): keep.
- 978-979 (`HOUSE_PHOTOGRAPH` once, `anchors` present): replace with `expect(prompt.endsWith(PHOTOGRAPH_LINE)).toBe(true)` and `expect(prompt).not.toMatch(/film grain|#[0-9a-f]{6}/)`.
Re-run until PASS.

- [ ] **Step 6: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add apps/web/lib/photograph-lines.ts apps/web/lib/still-prompt.ts apps/web/lib/still-prompt.test.ts apps/web/lib/set-plates.ts apps/web/lib/set-plates.test.ts apps/web/lib/visual-assets.test.ts
git commit -m "feat(web): one assembler owns every still prompt, in a fixed order (decision 287)"
```

---

### Task 6: Every other route goes through the assembler

Plates, the contact sheet, the teaser, retype to still and the adapters' avoid clause. The Brand Kit anchors stop reaching any image prompt.

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (`generateStillCandidates(brief, projectId, stored?, kind: StillKind = 'still')`)
- Modify: `apps/web/lib/set-plates.ts:53-122` (`buildSetSheetPrompt`, `setPlateBrief` lose `styleAnchors`)
- Modify: `apps/web/app/(console)/projects/[id]/set-actions.ts:416-419`, `apps/web/lib/set-sheet.ts:60-65`
- Modify: `apps/web/inngest/functions/teaser-shot-fetcher.ts:159-176`; delete `packages/providers/src/prompts/teaser-still.ts` and its test, and its export
- Modify: `packages/schemas/src/visuals.ts:515-521` (`convertBrief` still branch), `apps/web/inngest/functions/slot-retyper.ts:112-113`, `apps/web/app/(console)/projects/[id]/visuals-actions.ts:434-435`
- Modify: `packages/providers/src/visuals/gemini.ts:220-222`, `packages/providers/src/visuals/fal.ts:160-163`
- Modify: `apps/web/scripts/live-set-test.ts:284-288,371-376,468-477`
- Test: `apps/web/lib/set-plates.test.ts`, `apps/web/app/(console)/projects/[id]/set-actions.test.ts`, `packages/schemas/src/visuals.test.ts`, `packages/providers/src/visuals/gemini.test.ts`, `packages/providers/src/visuals/fal.test.ts`, the teaser fetcher's test if one exists

**Interfaces:**
- Consumes: Task 5's `assembleStillPrompt`, `PLATE_PHOTOGRAPH_LINE`.
- Produces:
  - `generateStillCandidates(brief: StillBrief, projectId: string, stored?: StillRoute | null, kind?: StillKind)`
  - `setPlateBrief(set, view): StillBrief` (two arguments)
  - `buildSetSheetPrompt({ name, layout, look }): string`
  - `convertBrief(brief, target, options)` with `options.stillStyleAnchors` removed

- [ ] **Step 1: Failing tests**

`set-plates.test.ts`, add:

```ts
it('draws a plate from the room alone, with no house line or anchors (decision 287)', () => {
  const brief = setPlateBrief({ name: 'Boardroom', look: 'A stark room.', plates: [] }, 'north')
  expect(brief.prompt).toBe(
    'Boardroom, empty of people: a wide establishing photograph of the whole room, taken from its entrance at eye level with a 24mm lens. A stark room.',
  )
})

it('ends the sheet with the plate photograph line and no anchors', () => {
  const prompt = buildSetSheetPrompt({ name: 'Boardroom', layout: 'North wall: glass.', look: '' })
  expect(prompt.endsWith(PLATE_PHOTOGRAPH_LINE)).toBe(true)
  expect(prompt).not.toMatch(/film grain|candid/)
})
```

`packages/schemas/src/visuals.test.ts`, change the retype-to-still test to expect `prompt: brief.description` and no anchors option.

`gemini.test.ts` and `fal.test.ts` (FLUX branch), add:

```ts
it('folds the avoid list into one clean sentence (decision 287)', async () => {
  // call generate with prompt 'A desk.' and negativePrompt 'no fax machine.' using the file's existing fetch mock
  expect(sentPrompt).toBe('A desk. Avoid: no fax machine.')
})
```

using each file's existing way of capturing the request body. Run the four files. Expected: FAIL.

- [ ] **Step 2: Implement**

`set-plates.ts`:
- `buildSetSheetPrompt(input: { name: string; layout: string; look: string })`: replace the last two array entries (`HOUSE_PHOTOGRAPH`, `input.styleAnchors`) with `PLATE_PHOTOGRAPH_LINE` imported from `./photograph-lines`. Remove the `HOUSE_PHOTOGRAPH` import.
- `setPlateBrief(set, view)`: drop the `styleAnchors` parameter; `prompt: \`${set.name}, empty of people: ${framing}. ${set.look}\`.trim()`.

`visual-assets.ts`: add `kind: StillKind = 'still'` as the fourth parameter of `generateStillCandidates` and pass `kind` into `assembleStillPrompt`.

`set-actions.ts:416-419`: `const brief = setPlateBrief(set, parsedView.data)` and `generateStillCandidates(brief, set.projectId, undefined, 'plate')`; remove the now-unused `settings` read and `stillStyleAnchors` import if nothing else uses them.

`set-sheet.ts`: `buildSetSheetPrompt({ name: set.name, layout: set.layout, look: set.look })`, wrapped in `stripBannedWords` from `@boom-busters/providers` (spec 7.4).

`teaser-shot-fetcher.ts:159-176`: drop the anchors line; `prompt: data.prompt` and `generateStillCandidates({...}, projectId, undefined, 'teaser')`. Delete `packages/providers/src/prompts/teaser-still.ts` and `teaser-still.test.ts`, and remove their export from the providers index (grep `teaser-still`).

`packages/schemas/src/visuals.ts` still branch:

```ts
    case 'still':
      // The description is the scene; the assembler adds everything else (decision 287).
      return { type: 'still', ...common, prompt: brief.description }
```

Remove `stillStyleAnchors` from `convertBrief`'s options type and from both callers (`slot-retyper.ts:113`, `visuals-actions.ts:435`), with their now-unused imports.

`gemini.ts:220-222` and `fal.ts:160-163`:

```ts
    // One clean sentence (decision 287): a prompt or list ending in a full
    // stop used to leave "..", the join the fold added on top of it.
    const trimmed = (text: string) => text.trim().replace(/[\s.]+$/, '')
    const prompt = request.negativePrompt
      ? `${trimmed(request.prompt)}. Avoid: ${trimmed(request.negativePrompt)}.`
      : request.prompt
```

(in fal, keep the `&& !imagen` condition).

`live-set-test.ts`: `setPlateBrief(..., 'north')` without anchors (284-288); `buildSetSheetPrompt({ name, layout, look })` (371-376); replace the shot prompt (468-477) with `assembleStillPrompt({ scene: shotInput.prompt, shotSize: shotInput.shotSize, camera: shotInput.camera, layout, people, set: { name: args.name, plates: chosen.length } })`; remove `HOUSE_PHOTOGRAPH`, `framingLead`, `describeCamera`, `withReferenceClause` imports that became unused. Keep `--anchors` parsing only if something still reads it; otherwise remove the flag from `live-set-args.ts` and its test, and the `fidelity.anchors` fields.

- [ ] **Step 3: Run every consuming suite, one at a time**

```
pnpm --filter @boom-busters/providers test
pnpm --filter @boom-busters/schemas test
pnpm --filter @boom-busters/web test
```
Expected: PASS. Fix expectations that pinned the anchors in plate or sheet prompts (`set-actions.test.ts`, `set-plates.test.ts`) to the new text, keeping each test's intent.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add -A apps/web packages/providers packages/schemas
git commit -m "feat: plates, sheets, teasers and retypes use the assembler; anchors leave image prompts (decision 287)"
```

---

### Task 7: The board edits the scene and shows the prompt sent

**Files:**
- Modify: `apps/web/lib/visual-assets.ts` (export `stillPromptFor`)
- Modify: `apps/web/lib/visuals-review.ts:94-152,498-552` (`scene`, `promptSent` on `SlotView`)
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx:2175,2234-2244`
- Test: `apps/web/lib/visual-assets.test.ts`, `apps/web/app/(console)/projects/[id]/visual-board.test.tsx` (or the existing BriefEditor test file; grep `Generation prompt` in tests first), one e2e in `e2e/` following an existing board spec

**Interfaces:**
- Consumes: Tasks 1 and 5.
- Produces:
  - `stillPromptFor(brief: StillBrief, cast: readonly CastMember[], sets: readonly ProjectSet[], routing: ModelRouting, stored: StillRoute | null): string`
  - `SlotView.scene: string | null`, `SlotView.promptSent: string | null` (both null for non-still slots)

- [ ] **Step 1: Failing test for `stillPromptFor`**

In `visual-assets.test.ts`, using the file's existing still, cast and set fixtures:

```ts
it('previews exactly the prompt generation sends (decision 287)', async () => {
  const cast = await listCastMembers(db, FIXTURE_PROJECT_ID)
  const sets = await listProjectSets(db, FIXTURE_PROJECT_ID)
  const routing = (await getSettings(db)).modelRouting
  const preview = stillPromptFor(still, cast, sets, routing, null)
  await generateStillCandidates(still, FIXTURE_PROJECT_ID)
  expect(generate.mock.calls[0]?.[0]?.prompt).toBe(preview)
})
```

Run it. Expected: FAIL, not exported.

- [ ] **Step 2: Implement `stillPromptFor`**

In `visual-assets.ts`:

```ts
/**
 * The prompt a still would be sent with now (decision 287), for the board's
 * "Prompt sent to the model". Built by the same pieces generation uses, from
 * lists already loaded, so the preview and the call cannot disagree.
 */
export function stillPromptFor(
  brief: StillBrief,
  cast: readonly CastMember[],
  sets: readonly ProjectSet[],
  routing: ModelRouting,
  stored: StillRoute | null,
): string {
  const derived = routeForBrief(brief, cast, sets, routing)
  const route = stored && adapterOffers(stored) ? stored : derived
  const plan = planStillReferences(
    depictedFrom(brief, cast),
    setFrom(brief, sets),
    referenceBudgets(LIVE_IMAGE_GEN_ADAPTERS[route.provider].referenceLimits(route.model)),
    brief.camera?.facing,
  )
  return assembleStillPrompt({
    scene: brief.prompt,
    ...(brief.shotSize ? { shotSize: brief.shotSize } : {}),
    ...(brief.camera ? { camera: brief.camera } : {}),
    layout: setForBrief(brief.set, sets)?.layout ?? '',
    people: plan.people,
    set: plan.setName === null ? null : { name: plan.setName, plates: plan.plates.length },
  })
}
```

Generation counts people and plates from the photographs that actually loaded, so a storage failure falls back to text there; the preview assumes storage works. That difference is intended and matches the price estimate's rule.

- [ ] **Step 3: Add the fields to the board view**

In `visuals-review.ts` `SlotView`:

```ts
  /** A still's scene: its prompt with the lines code adds taken out (decision 287). */
  scene: string | null
  /** The full prompt the still would be sent with now, for the card's disclosure. */
  promptSent: string | null
```

and in the `slots` map:

```ts
      scene: parsed.success && parsed.data.type === 'still' ? sceneOf(parsed.data.prompt) : null,
      promptSent:
        parsed.success && parsed.data.type === 'still'
          ? stillPromptFor(parsed.data, cast, sets, settings.modelRouting, storedRoute)
          : null,
```

where `storedRoute` is the value the existing `route:` IIFE computes; hoist that IIFE into a `const storedRoute` above the `return` and use it for both `route` and `promptSent`. Update any test fixture that builds a `SlotView` literal (grep `derivedRoute:` in tests) to include `scene: null, promptSent: null`.

- [ ] **Step 4: Failing component test**

In the board's BriefEditor test (create `visual-board.brief-editor.test.tsx` following the file that already renders `VisualBoard` or `BriefEditor`):

```tsx
it('edits the scene and shows the prompt sent, read-only (decision 287)', async () => {
  // render the editor for a still slot with brief.prompt = 'A desk. <legacy house line>',
  // scene = 'A desk.', promptSent = 'A desk.\n\nAn available-light documentary photograph: ...'
  expect(screen.getByLabelText('Scene')).toHaveValue('A desk.')
  await user.click(screen.getByText('Prompt sent to the model'))
  expect(screen.getByText(/An available-light documentary photograph:/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: /Save/ }))
  expect(editBriefAction).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ prompt: 'A desk.' }))
})
```

Run it. Expected: FAIL.

- [ ] **Step 5: Implement the editor**

In `BriefEditor`:

```tsx
  const [prompt, setPrompt] = React.useState(brief?.type === 'still' ? (slot.scene ?? brief.prompt) : '')
```

and replace the still field (2234-2244) with:

```tsx
      {brief.type === 'still' ? (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
            Scene
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={3}
              className={field}
            />
          </label>
          {slot.promptSent ? (
            <details className="text-[12px] text-[var(--color-text-secondary)]">
              <summary className="cursor-pointer">Prompt sent to the model</summary>
              <pre className="mt-1 whitespace-pre-wrap text-[12px] text-[var(--color-text-muted)]">
                {slot.promptSent}
              </pre>
            </details>
          ) : null}
        </>
      ) : null}
```

The disclosure shows the prompt as the brief is stored; it updates after Save.

- [ ] **Step 6: One e2e**

In the e2e board spec that already opens a still's brief editor (grep `Visual description` in `e2e/`), add a step: open the editor on a still, expect the `Scene` field, open "Prompt sent to the model", expect it to contain `An available-light documentary photograph:`. Run from the e2e package, scoped to that file (see the scoped-e2e memory; free port 3100 if a previous run was interrupted).

- [ ] **Step 7: Run and commit**

```
pnpm --filter @boom-busters/web test
```
Expected: PASS.

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add apps/web e2e
git commit -m "feat(web): the board edits a still's scene and shows the prompt sent (decision 287)"
```

---

### Task 8: The bible and the rules, each stated once

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md` (then `embed:craft`), `direction-craft.ts` (delete `HOUSE_PHOTOGRAPH`)
- Modify: `packages/providers/src/prompts/shotlist.ts` (planning rules, still rule, `PEOPLE_RULES`, `SET_RULES`, `styleAnchors` input, delete `stillStyleAnchors`)
- Modify: `packages/providers/src/prompts/direction.ts` (book rules, `styleAnchors` input), `rebrief.ts:131-132`, `retype.ts:137-138`, `redirect.ts:25-30`, `cast-identity.ts:53-54`
- Modify: `packages/schemas/src/direction.ts:68-100` (`renderDirectorsBook` light line and set-aware locations)
- Modify callers of `styleAnchors`: `apps/web/inngest/lib/direction.ts:205`, `apps/web/lib/plan-chapter.ts`, `apps/web/inngest/functions/visuals-runner.ts:145,209`, `visuals-replanner.ts:151`, `apps/web/scripts/live-plan-test.ts`
- Test: `direction-craft.test.ts`, `shotlist.test.ts:681-684`, `direction.test.ts` (providers and schemas), `rebrief.test.ts`, `redirect.test.ts`, `retype.test.ts`, `cast-identity.test.ts`

**Interfaces:**
- Produces:
  - `renderDirectorsBook(book: DirectorsBook, options?: { sets?: readonly string[] }): string`
  - `buildShotListRequest` input without `styleAnchors`; `PlanChapterInput` without `styleAnchors`; `buildDirectorsBookRequest` input without `styleAnchors`
  - `stillStyleAnchors` and `HOUSE_PHOTOGRAPH` no longer exported

- [ ] **Step 1: Failing tests**

`direction-craft.test.ts`, replace the house-line tests (48-61) with:

```ts
it('lists no props and pastes no house line (decision 287)', () => {
  expect(DIRECTION_CRAFT).not.toContain('a coffee ring')
  expect(DIRECTION_CRAFT).not.toContain('a half-drunk coffee')
  expect(DIRECTION_CRAFT).not.toContain('steam off a cup')
  expect(DIRECTION_CRAFT).not.toContain('Brand Kit anchors')
  expect(DIRECTION_CRAFT).not.toContain('no flat screen')
})

it('gives the grade to the compositor and states what code adds', () => {
  expect(DIRECTION_CRAFT).toContain('A prompt never names a grade, grain, film stock or colour code.')
  expect(DIRECTION_CRAFT).toContain('## What code adds')
})

it('asks for facings and counts', () => {
  expect(DIRECTION_CRAFT).toContain('Every screen, seat and person in the frame faces someone or something the prompt names')
  expect(DIRECTION_CRAFT).toContain("the room's one desk")
})

it('limits the avoid list to this frame', () => {
  expect(DIRECTION_CRAFT).toContain('a frame with a laptop never avoids screens')
})
```

`shotlist.test.ts:681-684`, replace with:

```ts
it('asks for the scene alone, and no pasted lines (decision 287)', () => {
  const request = buildShotListRequest({ /* the file's existing minimal input, without styleAnchors */ })
  expect(request.system).toContain('"prompt" is the scene alone')
  expect(request.system).not.toContain('verbatim: "')
  // The bible names the house photograph line as code's; what must be gone is
  // any instruction to paste it, or the anchors themselves.
  expect(request.system).not.toMatch(/film grain|line verbatim|anchors verbatim/)
})
```

`packages/schemas` direction test:

```ts
it('renders the palette as light and skips locations that are sets (decision 287)', () => {
  const text = renderDirectorsBook(book, { sets: ['The Stability AI Boardroom'] })
  expect(text).toContain("Light: this film's light runs cold.")
  expect(text).not.toMatch(/#[0-9a-f]{6}/i)
  expect(text).not.toContain('- The Stability AI Boardroom:')
})
```

using a fixture book with `palette.temperature: 'cold'` and a location named `The Stability AI Boardroom`.

`redirect.test.ts`: `expect(request.system).not.toContain('face turned away')` and `toContain('visible')`. `rebrief.test.ts` and `retype.test.ts`: `expect(request.system).not.toContain('{"kind": "pan"')` and `expect(request.system).toContain('Never "pan"')` (the bible itself mentions "pan", so only the offered shape is tested for absence). `cast-identity.test.ts`: `expect(request.system).toContain('photorealistic')` (a word only the full list carries).

Run: `pnpm --filter @boom-busters/providers test` and `pnpm --filter @boom-busters/schemas test`. Expected: FAIL.

- [ ] **Step 2: Rewrite the bible**

In `direction-craft.md`:

Replace the "Grade and grain" bullet under "The house look" with:

```md
- Grade and grain are the compositor's: the whole film is graded at render.
  A prompt never names a grade, grain, film stock or colour code.
  The book's palette temperature reaches the picture through the light you choose.
```

Replace the whole "## What a still prompt must contain" section with:

```md
## What a still prompt must contain

- One photographable moment. Not a montage, not a concept, not "the fall
  of a company". A room, a time of day, a light source, what is happening.
- The frame holds what the sentence needs, and a set holds what its room
  holds. Nothing is added to make a frame look lived in: the house
  photograph already asks for real use and wear.
- A sign of use belongs only where it carries the beat. Write it as the
  condition of the moment, taken from the sentence or from what the people
  are doing: the table at the end of a long meeting, a desk mid-work, a
  corridor after everyone has left. Never a stock prop.
- No prop or atmospheric device appears twice in a chapter: a drink, dust in a beam, rain on glass, a standby light, a coat on a chair.
- Say which way things face. Every screen, seat and person in the frame faces someone or something the prompt names:
  the monitor faces her, its light on her face; his back to the camera;
  the chair turned from the desk. Say how many where the count matters: the room's one desk, two chairs, three people at the table.
- Written in this order, as prose, not a keyword list: subject, action or
  state, the detail the sentence names, the light of the moment (source,
  direction, quality), then lens and camera height. Lead with the subject;
  the first third of the prompt gets the most attention.
- In a set, the light you write is what the moment adds: the time of day,
  the weather at the glass, a lamp switched on. The room's own fixtures
  come with the room.
- Name the lens: 24mm for a wide that breathes, 35mm for a documentary
  medium, 50mm for a close human scale, 85mm for a portrait, 100mm macro
  for texture. Name the camera's height as well: eye level, seated, low
  to the floor, overhead. On a shot in a set both go in the camera, never
  in the prompt.
- The era lock is a constraint, not a list to paste: every period object
  in the frame comes from it, and the prompt names only the objects
  actually in the frame. Never copy the era lock's list into a prompt; the
  image model reads a list of objects as a list of things to show.
- Add the full name and role of any person shown, and their identity
  string ONLY when no photograph of them exists; where one does, the
  photograph is the likeness and the identity string stays out of the
  prompt.
- Banned words, because they render nothing: (keep the existing list and the "emotion named without a body" sentence exactly as they are)
- The negative prompt names at most five concrete things that would be wrong in this frame for this film's era and story.
  Never a category, and never something the scene itself shows: a frame with a laptop never avoids screens.
- (keep the existing company-marks bullet exactly as it is)

## What code adds

The producer's code writes these into every image prompt, so a prompt
never does: the framing for the shot size, the camera and the room in
view for a shot in a set, what each reference photograph is for, and the
house photograph line. Never write a photograph line, a grade, a palette
line or a Brand Kit anchor into a prompt.
```

In the set bullet under "Shot grammar", after "Never describe its walls, furniture or materials again; the inventory states them.", add one line:

```md
  Name only details on the walls in frame for the camera's facing, never on the wall behind it, or the image model turns to show it.
```

In "## People": change "the prompt names the person and says "the person in the reference photo", and the photos travel with the request" to "the prompt names the person by full name and role, and the photos travel with the request; the code tells the model which photograph is theirs". Change the example sentence to `"Emad Mostaque, founder of Stability AI, sitting at a desk" is right`. In the "A prompt that shows a real person" bullet, change "names them first, by full name and role (...), then gives the identity string" to "gives the identity string, which begins with their full name and role (...)". In the pre-flight list, delete nothing else.

Run `pnpm --filter @boom-busters/providers embed:craft`. In `direction-craft.ts`, delete `HOUSE_PHOTOGRAPH` and its comment (outside the embedded string), and its export from the providers index.

- [ ] **Step 3: Rewrite the planner rules**

In `shotlist.ts`:
- Delete `stillStyleAnchors` and its export. Delete `styleAnchors` from `buildShotListRequest`'s input and its doc comment. Remove the `HOUSE_PHOTOGRAPH` import.
- In "Planning rules", delete the four bullets the bible already states: "The sentence decides the frame...", "Stage an abstract sentence...", "The era lock is a constraint...", "Motifs are seasoning...".
- In the "Each brief is a full creative direction" bullet, change "era, mood, lighting and colour grade" to "era, mood and lighting".
- Replace the still bullet (365-376) with:

```ts
- "still" is an AI-GENERATED image. "prompt" is the scene alone, written as the
  bible's "What a still prompt must contain" says: prose, subject first, the
  detail the sentence names, the light of the moment, then lens and camera
  height (a still that names a set is the exception: its lens and camera
  height go in "camera" instead). Code adds the framing, the room, the
  references and the house photograph line; write none of them, and no
  palette, grade, grain or colour code.
${PEOPLE_RULES}${sets.length > 0 ? SET_RULES : ''}  Never quote the guardrail:
  it decides what you plan, not what the image model reads, and a model
  reads "never in handcuffs" as a request for handcuffs. Put its concrete
  nouns in "negativePrompt" instead.
  ${STILL_GENERATIONS} variants are generated per prompt.
```

- Replace `PEOPLE_RULES` with:

```ts
export const PEOPLE_RULES = `  People come in three kinds and they never mix:
  (a) A name in "Photographed" above. Name them by full name and role and
      write NO physical description of them whatever: no age, build, height,
      hair, beard, glasses, skin or face. The photograph is the likeness.
      Clothing, posture, place, light and what they are doing are yours.
      List them in "depicts" by name alone, never with the role after it.
  (b) A named person NOT in that list. Write their identity string from the
      book as one sentence; it already begins with their full name and role.
      List them in "depicts" by name alone.
  (c) Anyone unnamed: investors, employees, staff, an aide, a driver, a
      crowd. No name and no identity string; the bible's People section says
      how they are written.
`
```

- Replace `SET_RULES` with:

```ts
export const SET_RULES = `  Sets: when the sentence puts us in one of the rooms listed above, name it
  in "set" by name alone, name it in the prompt in the same words, and give
  the still a "camera". "facing" is the wall the camera looks at, by the
  inventory's compass; "position" is where it stands and how high ("the south
  doorway, seated eye height"); "lens" is the lens ("35mm", "85mm, shallow
  focus"). Choose the facing from what the sentence needs in frame, using the
  inventory, and vary facing and position across a chapter's shots of one
  room. The prompt never places the camera and never describes the room; the
  bible's set rules say why. A sentence that happens somewhere else names no set.
`
```

- Pass the set names to the book render: `renderDirectorsBook(input.direction, { sets: sets.map((set) => set.name) })`.

In `schemas/src/direction.ts` `renderDirectorsBook`:

```ts
export function renderDirectorsBook(book: DirectorsBook, options?: { sets?: readonly string[] }): string {
  const setNames = new Set((options?.sets ?? []).map((name) => name.trim().toLowerCase()))
  const lines: string[] = [
    `Visual thesis: ${book.visualThesis}`,
    `Era locks: ${book.eraLocks.map((lock) => `${lock.span}: ${lock.rules}`).join(' | ')}`,
    // Light, not colour (decision 287): the compositor grades; hex codes in
    // a prompt became red props.
    `Light: this film's light runs ${book.palette.temperature}.`,
    `Motifs: ${book.motifs.join('; ')}`,
    `Anchor object: ${book.anchorObject}`,
  ]
  // ...principals unchanged...
  const places = book.locations.filter((place) => !setNames.has(place.name.trim().toLowerCase()))
  if (places.length > 0) {
    lines.push('Locations:')
    for (const place of places) lines.push(`- ${place.name}: ${place.look}`)
  }
  // ...chapters and final image unchanged...
}
```

In `rebrief.ts`, pass `{ sets: sets.map((set) => set.name) }` the same way.

- [ ] **Step 4: The other prompts**

- `direction.ts` (book): delete `- The palette sits inside the Brand Kit grade: "${input.styleAnchors}".` and add in its place `- The palette's temperature is the film's light: cold, neutral or warm. The note says in words where the accent belongs in the story; never a hex code, grain or grade.` Remove `styleAnchors` from the book input type.
- `rebrief.ts:131-132` and `retype.ts:137-138`: replace `} or {"kind": "pan", "path": string}.` with `}. Never "pan": the renderer cannot do one.`
- `redirect.ts`: replace `or\nan anonymous figure described by role, build and clothing with the face turned\naway.` with `or\nan anonymous figure described by role, age range, build and clothing, with a\nnatural face, visible and resembling no real person.`
- `cast-identity.ts:53-54`: `- No banned words: ${BANNED_PROMPT_WORDS.join(', ')}.` importing `BANNED_PROMPT_WORDS` from `./direction-craft`.

- [ ] **Step 5: Remove `styleAnchors` from the callers**

`apps/web/inngest/lib/direction.ts:205` (drop the field from `loadDirectionInputs`' return and its type), `apps/web/lib/plan-chapter.ts` (drop from `PlanChapterInput` and from the `buildShotListRequest` call), `visuals-runner.ts:145` and `:209`, `visuals-replanner.ts:151`, `live-plan-test.ts` (drop the field and the `stillStyleAnchors` import). A run parked before this deploy replays a setup step that still holds `styleAnchors`; the new code never reads it, which is safe (the parked-runs memory warns only about reading a field an old step never saved).

- [ ] **Step 6: Run every consuming suite, one at a time**

```
pnpm --filter @boom-busters/providers test
pnpm --filter @boom-busters/schemas test
pnpm --filter @boom-busters/web test
```
Expected: PASS. A bible phrase that fails to match is almost always a line wrap; move the phrase onto one line of the markdown and re-embed.

- [ ] **Step 7: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add -A packages/providers packages/schemas apps/web
git commit -m "feat(providers): the bible and planner rules state each rule once; prompts carry the scene alone (decision 287)"
```

---

### Task 9: Room geometry names only what the lens sees

**Files:**
- Modify: `apps/web/lib/set-plates.ts:97-108,202-232` (`describeCamera`; compass views at 35mm)
- Modify: `apps/web/lib/set-layout-prompt.ts:26-42` (counts)
- Modify: `packages/providers/src/prompts/shotlist.ts:105-132` (`referencesPrefix`: inventory alone)
- Modify: `packages/schemas/src/sets.ts:103-113` (`look` comment)
- Test: `apps/web/lib/set-plates.test.ts:60-140`, `apps/web/lib/set-layout-prompt.test.ts` (create if absent), `shotlist.test.ts` (the references-prefix test), `apps/web/lib/visual-assets.test.ts:892`

**Interfaces:**
- Produces: `describeCamera(camera, layout, shotSize?)` (same signature, new text).

- [ ] **Step 1: Failing tests**

In `set-plates.test.ts`:

```ts
const layout =
  'North wall: glass windows.\nEast wall: acoustic panels.\nSouth wall: oak double door.\n' +
  'West wall: frosted glass.\nCentre: the room\'s only table, ten chairs.\nLight: LED panels, daylight from the north.'

it('names nothing behind the camera on a wide shot (decision 287)', () => {
  const text = describeCamera({ facing: 'north', position: 'the south doorway', lens: '24mm' }, layout, 'wide')
  expect(text).not.toContain('Behind the camera')
  expect(text).not.toContain('oak double door')
  expect(text).not.toContain('The room:')
  expect(text).toContain("The room's own light: LED panels, daylight from the north (ahead).")
})

it('keeps an unlabelled inventory on a wide shot, since it is all there is', () => {
  const text = describeCamera({ facing: 'north', position: 'the door' }, 'A long room with one desk.', 'wide')
  expect(text).toContain('The room: A long room with one desk.')
})

it('says ahead, beyond the subject, on a medium shot', () => {
  const text = describeCamera({ facing: 'north', position: 'seated' }, layout, 'medium')
  expect(text).toContain('Ahead, beyond the subject: glass windows.')
  expect(text).not.toMatch(/(^|\. )Behind:/)
})

it('shoots a compass view at 35mm, like the contact sheet', () => {
  const brief = setPlateBrief({ name: 'B', look: '', plates: [{} as never] }, 'east')
  expect(brief.camera?.lens).toBe('35mm')
})
```

Delete or rewrite the old expectations at lines 64 and 139 that asserted `Behind the camera, out of frame: ...`. In `visual-assets.test.ts:892`, change to `expect(prompt).not.toContain('Behind the camera')`.

`set-layout-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { layoutDraftRequest } from './set-layout-prompt'

it('asks for counts, and "the only" where there is one (decision 287)', () => {
  const request = layoutDraftRequest({ name: 'Office', look: '', image: { mimeType: 'image/png', data: '' } })
  expect(request.messages[0]?.content).toContain('Give the number of each piece of furniture')
  expect(request.messages[0]?.content).toContain('"the only"')
})
```

`shotlist.test.ts` references-prefix test:

```ts
it('shows a set by its inventory alone once it has one (decision 287)', () => {
  const text = referencesPrefix([], [{ name: 'B', look: 'Endless racks.', layout: 'North wall: a door.' }])
  expect(text).toContain('- B\n  North wall: a door.')
  expect(text).not.toContain('Endless racks.')
  expect(referencesPrefix([], [{ name: 'C', look: 'A glass box.', layout: '' }])).toContain('- C: A glass box.')
})
```

Run the four files. Expected: FAIL.

- [ ] **Step 2: Implement**

`describeCamera` in `set-plates.ts`:

```ts
export function describeCamera(camera: SetCamera, layout: string, shotSize?: ShotSize): string {
  const lens = camera.lens ? `, ${camera.lens}` : ''
  const sentences = [`The camera stands at ${camera.position}, facing ${camera.facing}${lens}.`]
  const view = layoutView(parseLayout(layout), camera.facing)
  const framing = framingOf(shotSize, camera.lens)
  const light = view.light
    ? `The room's own light: ${orientLight(view.light, camera.facing)}.`
    : null
  if (framing === 'close') {
    if (view.inFrame) sentences.push(`Behind, soft and out of focus: ${view.inFrame}.`)
    if (light) sentences.push(light)
    return sentences.join(' ')
  }
  if (framing === 'medium') {
    if (view.inFrame) sentences.push(`Ahead, beyond the subject: ${view.inFrame}.`)
    if (view.left) sentences.push(`To the camera's left: ${view.left}.`)
    if (view.right) sentences.push(`To the camera's right: ${view.right}.`)
    if (light) sentences.push(light)
    return sentences.join(' ')
  }
  if (view.inFrame) sentences.push(`In frame: ${view.inFrame}.`)
  if (view.left) sentences.push(`Frame left: ${view.left}.`)
  if (view.right) sentences.push(`Frame right: ${view.right}.`)
  if (view.centre) sentences.push(`Centre: ${view.centre}.`)
  if (light) sentences.push(light)
  // The wall behind the camera and the room's other lines are never named
  // (decision 287): a named thing is drawn, and the extra desk came from
  // naming furniture the lens could not see. An inventory with no wall
  // labels is kept, since it is all the room text there is.
  const labelled = view.inFrame ?? view.left ?? view.right ?? view.centre ?? view.light
  if (!labelled && view.rest) sentences.push(`The room: ${view.rest.replace(/\.$/, '')}.`)
  return sentences.join(' ')
}
```

Update the doc comment above it to match (it no longer "names the wall behind it").

`setPlateBrief` camera: `lens: '35mm'`, with the comment "35mm, as the contact sheet's panels are (decision 287)". Update the `VIEW_FRAMING` comment block at 40-45 to say 35mm.

`set-layout-prompt.ts`, after `'no people. '`, insert:

```ts
    'Give the number of each piece of furniture, and write "the only" where there is one ' +
    '(for example "the room\'s only desk, two guest chairs"). ' +
```

`referencesPrefix` in `shotlist.ts`:

```ts
            return inventory
              ? `- ${set.name}\n${inventory
                  .split(/\r?\n/)
                  .filter((line) => line.trim() !== '')
                  .map((line) => `  ${line.trim()}`)
                  .join('\n')}`
              : `- ${set.name}: ${set.look}`
```

with a comment: "One description per room (decision 287): the inventory once it exists; the look only before."

`schemas/src/sets.ts:103-113`: the `look` comment becomes `/** The book's look line, editable. Draws the first plate, and stands in for the inventory until one is drafted. */`.

- [ ] **Step 3: Run every consuming suite, one at a time**

```
pnpm --filter @boom-busters/providers test
pnpm --filter @boom-busters/schemas test
pnpm --filter @boom-busters/web test
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm typecheck && pnpm lint && pnpm format:check
git add -A apps/web packages/providers packages/schemas
git commit -m "feat(web): the camera sentence names only what the lens sees; inventories count furniture (decision 287)"
```

---

### Task 10: Full verification, the after run, the record, the rollout

**Files:**
- Modify: `PROGRESS.md` (decision 287 entry)
- Modify: memory files under `C:\Users\ricar\.claude\projects\c--Users-ricar-OneDrive-Desktop-Boom---Busters-boom-busters\memory\` (update `image-prompts-lead-with-framing.md` with what the after run shows)

- [ ] **Step 1: Full verification**

Run, one at a time (timeout 600000 each):
```
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm e2e
```
Expected: all clean and green. Record the per-package test counts for PROGRESS.

- [ ] **Step 2: The after run (paid; ask the owner first)**

Tell the owner the two commands and wait for a yes:

```
pnpm --filter @boom-busters/web live:plan -- --project 01M1F7KDJVGDSJ31WE7BPSBKZR --chapter 5 --label after
pnpm --filter @boom-busters/web live:compare -- <before folder from Task 3> <after folder>
```

Expected: an after folder with its stills under $1, and `compare.html` in it. Open it for the owner with the Artifact tool only if they ask for a shareable page; otherwise give them the local path.

If the owner wants the prompt change isolated from the planner's own variation, offer a third run, `--briefs-from <before folder> --label after-same-briefs` (same briefs, new assembly), under its own $1 cap.

- [ ] **Step 3: Settle the four open questions from the owner's ticks**

For each, record the outcome in PROGRESS:
1. Camera ahead of the scene (spec 5.2): if "Room mirrored" or wrong-wall faults rose on set shots, move `camera` after `references` in `assembleStillPrompt`, re-run the after run on `--briefs-from`, and compare again.
2. Likeness without "the person in the reference photo" (spec 6.2.7): if "Likeness off" rose, add a code sentence in `referenceSentences` naming each person as "the person in reference images N to M", not planner text.
3. "Surfaces showing ordinary daily use" (spec 5.3): if "Stray props" did not fall, drop that phrase from both photograph lines.
4. Grade values: the owner judges the player and one render.

Each follow-up change gets its own test and commit.

- [ ] **Step 4: PROGRESS entry**

Add decision 287 to `PROGRESS.md` in the house format of decisions 275 to 284: the owner's report quoted, the evidence (44 of 46, 3 of 46, 6 stills, dust 14, rain 9), the causes, what changed task by task, the before and after tallies, the four settled questions, the verification counts, and the rollout below. Run `pnpm format:check` after, since Prettier reflows PROGRESS.

- [ ] **Step 5: Commit and hand over the rollout**

```bash
git add PROGRESS.md
git commit -m "docs: record decision 287, still prompts with one owner per fact"
```

Rollout, in this order (the owner runs the deploy scripts, following the Lambda redeploy memory; write any wrapper script into the scratchpad and hand it over):
1. In `infra/`: `pnpm deploy:remotion` (the grade in rendered video).
2. In `infra/`: `pnpm deploy:stacks boom-busters-broker`, profile `reelscript`, with the Remotion values and `SENTRY_DSN` read from the live broker Lambda (the broker's schemas then accept `gradePreset`).
3. Merge the branch and deploy to Vercel; then `curl -X PUT https://boom-busters-web-rho.vercel.app/api/inngest`.
4. Confirm Settings, Brand Kit, Photographic look reads Muted (it defaults there).
5. Offer the owner a Redraft of the executive office inventory (one vision call, a few cents; ask first), so its desk and credenza are counted and told apart.

---

## Self-Review

**Spec coverage:**
- §4 ownership and §5.1 routes: Tasks 1, 5, 6, 7 (planner stills, rebrief, redirect, retype and owner edits all reach generation through `generateStillCandidates`, which Task 1 and 5 put on the assembler; teaser, plates, sheet and harness in Tasks 3 and 6).
- §5.2 order: Task 5. Step 7 (avoid) is amended: the fold stays in the adapters, because only they know that Imagen has a real negative field; Task 6 removes the doubled full stop there. Record this amendment in PROGRESS.
- §5.3 photograph lines: Task 5. §5.4 legacy strip: Task 5. §5.5 board: Task 7.
- §6.1 and §6.2 rules: Task 8 (6.2.6 light split in the bible; the room's light line in Task 9). §6.3 contradictions: Task 8 (redirect, pan, banned list), Task 9 (`look` comment).
- §7.1 to §7.4 geometry: Task 9 (camera sentence, counts, one description), Task 6 (sheet strip), Task 5 (detail plate wording, now positive for every set shot without a camera).
- §8 grade: Task 4, with one amendment: `gradePreset` is optional in the schema, so a timeline compiled before this work renders ungraded, and `resolveBrandKit` supplies `muted` to every new compile. The spec's "default muted" holds for settings; record the amendment in PROGRESS. The Brand Kit tab had no Grain control, so the new card holds both.
- §9 data: Task 4. §10 tests: every task. §10.1 live proof: Tasks 3 and 10. §11 order: Tasks 3 (before run) then 4 (grade) then 5 to 9, then 10. §12 failure behaviour: Review Focus 1 to 3, Task 4 (old broker, old timeline). §13 owner checks: Task 10. §14 open questions: Task 10 Step 3.

**Placeholders:** the two "moved verbatim" bodies in Task 2 name their exact source lines; fixture shapes the implementer must match to real types are called out where they occur.

**Type consistency:** `StillPromptInput`, `StillKind`, `planStillReferences`, `assembleStillPrompt`, `CompleteFn`, `PlanChapterInput`, `PlanRunRecord`, `PlanRunStill`, `stillPromptFor`, `GRADE_FILTER`, `GradePreset` are defined once and used with the same names and shapes in later tasks.
