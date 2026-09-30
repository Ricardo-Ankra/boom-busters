# Visual Board Job State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the moment a board button starts a background job until the job lands, the card or board says what is running and how long for, and does not offer the same work again.

**Architecture:** A stamp on the row (`shot_slots.pending_job`, `projects.visuals_job`) is written by the server action before it sends the Inngest event, and released by the job with a `jobId` compare, by its `onFailure`, and by Stop. The review model passes the stamps through with the server's clock; the board locks and explains from them, and treats a stamp older than 10 minutes as stale. Fetch visuals hands its stamp over to the stage status once the runner closes the gate.

**Tech Stack:** TypeScript, Zod 4, Drizzle ORM (Postgres), Inngest (`@inngest/test` engine), Next.js App Router server actions, React 19, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-30-visual-board-job-state-design.md` (decision 286). Read it before starting; this plan argues from it.

## Global Constraints

- Branch: `visuals-board-feedback`. Small commits, one logical change each; every commit message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `JOB_STALE_MS = 10 * 60_000`. The board clock ticks every `15_000` ms, only while a stamp is on screen.
- Slot stamp: `{ kind: 'refetch' | 'redirect', jobId, startedAt }`. Project stamp: `{ op: 'shots' | 'repair' | 'direction' | 'fetch', jobId, startedAt }`. `startedAt` is an ISO datetime; `jobId` is `newId()` from `@boom-busters/schemas`.
- Only `visuals/refetch.requested`, `visuals/redirect.requested` and `visuals/replan.requested` gain `jobId`, and it is optional. The plan approval events do not change.
- A stamp that fails `safeParse` reads as no job.
- Job release happens once, in a `release-job` step after the handler body returns. Never wrap steps in `try`/`finally`.
- `'use server'` files export only async functions (a non-function export 500s every action in the segment). New constants go in other modules.
- Strict TypeScript, ESLint with zero warnings, Prettier. Run `npx prettier --write` on each file you touch, and `pnpm format:check` from the repo root before each commit (warnings under `.claude/worktrees/` are local and ignored by git; everything else must be clean).
- DB-backed suites need Docker Desktop running and `TEST_DATABASE_URL` in `.env.local`. Never run two DB suites at once: they deadlock on row locks. Use the Bash `timeout` 600000 for every test run.
- Every Vitest command here runs from the package directory named in it, with file-name filters (`npx vitest run visuals.test`), because bracketed route paths do not match as filters.
- UI copy: no em or en dashes in new strings; the product's voice (plain, specific, says what happens next).

## Review Focus

1. **A job finishing after a newer press.** A refetch lands after the owner, past the 10-minute limit, pressed Regenerate again: the newer stamp must stay. Pinned in Task 2 (DB) and Task 4 (refetcher engine test).
2. **A browser clock that is wrong.** The owner's laptop clock is an hour out: a 1-minute-old stamp must still lock, and one 11 minutes old must not. Pinned in Task 7 (board, fake system time).
3. **Stop in the middle of a fetch.** After Stop the stage is `cancelled`: the plan screen must not read as fetching, and no stamp may survive. Pinned in Task 5 (reconciler) and Task 6 (`isFetching('plan', 'cancelled')`).
4. **An event queued before this ships.** It carries no `jobId`: the job must run normally and release nothing. Pinned in Task 4 (refetcher engine test).
5. **A second Fetch sent straight to the server** (another tab, a stale page). The action must refuse while the fetch runs, not cancel it. Pinned in Task 3 (`approvePlanAction` refuses at `running`).

---

## File Structure

- `packages/schemas/src/visuals.ts`: `SlotJobSchema`, `VisualsJobSchema`, `VISUALS_JOB_OPS` and types. Test: `visuals.test.ts`.
- `packages/schemas/src/events.ts`: optional `jobId` on three events. Test: `events.test.ts`.
- `packages/db/src/schema.ts`: two columns. `packages/db/drizzle/0031_*.sql`: the generated migration.
- `packages/db/src/visuals.ts`: `setSlotJob`, `releaseSlotJob`, `clearProjectJobs`.
- `packages/db/src/projects.ts`: `setVisualsJob`, `releaseVisualsJob`. Test for all five: `visuals.integration.test.ts`.
- `apps/web/app/(console)/projects/[id]/visuals-actions.ts`: stamps in `sendRefetch`, `redirectSceneAction`, `sendReplan`, `approvePlanAction`. Test: `visuals-actions.test.ts`.
- `apps/web/inngest/lib/jobs.ts` (new): the `onFailure` release helpers. Test: `jobs.test.ts` (new).
- `apps/web/inngest/functions/slot-refetcher.ts`, `slot-redirector.ts`: release step and `onFailure`. Tests: their existing test files.
- `apps/web/inngest/functions/visuals-replanner.ts`, `visuals-runner.ts`, `cancel-reconciler.ts`: release step, the fetch handover, Stop. Tests: existing files plus `cancel-reconciler.test.ts` (new).
- `apps/web/lib/visuals-review.ts`: `slotJobView`, `visualsJobView`, `isFetching`, the new model fields. Test: `visuals-review.test.ts`.
- `apps/web/app/(console)/projects/[id]/visual-board.tsx`: the clock, locks, status lines, tallies. Test: `visual-board.test.tsx`.
- `PROGRESS.md`: decision 286.

---

### Task 1: Job stamp schemas and the optional event `jobId`

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (after `SlotRefusalSchema`, near line 614)
- Modify: `packages/schemas/src/events.ts` (`VisualsRefetchRequestedSchema` line 82, `VisualsReplanRequestedSchema` line 134, `VisualsRedirectRequestedSchema` line 158)
- Test: `packages/schemas/src/visuals.test.ts`, `packages/schemas/src/events.test.ts`

**Interfaces:**
- Produces: `SlotJobSchema`, `type SlotJob = { kind: 'refetch' | 'redirect'; jobId: string; startedAt: string }`; `VISUALS_JOB_OPS = ['shots', 'repair', 'direction', 'fetch'] as const`; `VisualsJobSchema`, `type VisualsJob = { op: VisualsJobOp; jobId: string; startedAt: string }`; `type VisualsJobOp`. Events: `jobId?: string` on the three schemas. All exported from `@boom-busters/schemas` through the existing `export * from './visuals'` and `'./events'`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/schemas/src/visuals.test.ts` (add `SlotJobSchema`, `VisualsJobSchema` to its import from `./visuals`, and `import { newId } from './ids'`):

```ts
describe('job stamps (decision 286)', () => {
  const startedAt = '2026-09-30T10:00:00.000Z'

  it('takes a refetch or redirect stamp on a slot, and nothing else', () => {
    const jobId = newId()
    expect(SlotJobSchema.safeParse({ kind: 'refetch', jobId, startedAt }).success).toBe(true)
    expect(SlotJobSchema.safeParse({ kind: 'redirect', jobId, startedAt }).success).toBe(true)
    expect(SlotJobSchema.safeParse({ kind: 'retype', jobId, startedAt }).success).toBe(false)
    expect(SlotJobSchema.safeParse({ kind: 'refetch', jobId, startedAt: 'yesterday' }).success).toBe(
      false,
    )
  })

  it('names the project ops the re-plan event already uses, plus fetch', () => {
    for (const op of ['shots', 'repair', 'direction', 'fetch']) {
      expect(VisualsJobSchema.safeParse({ op, jobId: newId(), startedAt }).success).toBe(true)
    }
    expect(VisualsJobSchema.safeParse({ op: 'replan', jobId: newId(), startedAt }).success).toBe(
      false,
    )
  })
})
```

Append to `packages/schemas/src/events.test.ts` (import the three schemas and `newId` if the file does not already):

```ts
describe('job ids on the side-job events (decision 286)', () => {
  const projectId = newId()
  const slotId = newId()

  it('carries a job id when the action sends one, and parses an older event without', () => {
    const jobId = newId()
    expect(
      VisualsRefetchRequestedSchema.parse({ projectId, slotId, note: 'Regenerate', jobId }).jobId,
    ).toBe(jobId)
    expect(
      VisualsRefetchRequestedSchema.parse({ projectId, slotId, note: 'Regenerate' }).jobId,
    ).toBeUndefined()
    expect(VisualsRedirectRequestedSchema.parse({ projectId, slotId, jobId }).jobId).toBe(jobId)
    expect(VisualsReplanRequestedSchema.parse({ projectId, op: 'shots', jobId }).jobId).toBe(jobId)
    expect(VisualsReplanRequestedSchema.parse({ projectId, op: 'repair' }).jobId).toBeUndefined()
  })

  it('refuses a job id that is not an id', () => {
    expect(
      VisualsRedirectRequestedSchema.safeParse({ projectId, slotId, jobId: 'not-an-id' }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run (from `packages/schemas`): `npx vitest run visuals.test events.test`
Expected: FAIL, `SlotJobSchema` is not exported / `jobId` is `undefined` where an id was sent.

- [ ] **Step 3: Add the schemas**

In `packages/schemas/src/visuals.ts`, after `export type SlotRefusal = ...`:

```ts
/**
 * A background job running on one slot (decision 286): stamped by the server
 * action before it sends the event, released by the job that answers it, and
 * cleared by Stop. `jobId` lets a job clear only its own stamp, so one that
 * finishes late never unlocks a newer press.
 */
export const SlotJobSchema = z.object({
  kind: z.enum(['refetch', 'redirect']),
  jobId: UlidSchema,
  startedAt: z.iso.datetime(),
})
export type SlotJob = z.infer<typeof SlotJobSchema>

/**
 * The plan-level jobs (decision 286). The first three are the `op` names
 * `visuals/replan.requested` already carries (`shots` is Re-plan shot list);
 * `fetch` is Fetch visuals between the press and the runner closing the gate.
 */
export const VISUALS_JOB_OPS = ['shots', 'repair', 'direction', 'fetch'] as const
export const VisualsJobSchema = z.object({
  op: z.enum(VISUALS_JOB_OPS),
  jobId: UlidSchema,
  startedAt: z.iso.datetime(),
})
export type VisualsJob = z.infer<typeof VisualsJobSchema>
export type VisualsJobOp = VisualsJob['op']
```

In `packages/schemas/src/events.ts`, add one field to each of the three schemas, last in the object:

```ts
  /**
   * The stamp this job releases when it lands (decision 286). Optional: an
   * event queued before job ids existed still parses, and releases nothing.
   */
  jobId: UlidSchema.optional(),
```

(`VisualsRefetchRequestedSchema` after `note`, `VisualsReplanRequestedSchema` after `op`, `VisualsRedirectRequestedSchema` after `slotId`. `UlidSchema` is already imported in `events.ts`; confirm with a grep.)

- [ ] **Step 4: Run the tests to see them pass**

Run (from `packages/schemas`): `npx vitest run`
Expected: PASS, the whole schemas suite.

- [ ] **Step 5: Typecheck and commit**

Run (from repo root): `pnpm --filter @boom-busters/schemas typecheck`, then `npx prettier --write packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts packages/schemas/src/events.ts packages/schemas/src/events.test.ts`.

```bash
git add packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts packages/schemas/src/events.ts packages/schemas/src/events.test.ts
git commit -m "feat(schemas): job stamps and an optional job id on the side-job events (decision 286)"
```

---

### Task 2: The two columns, the migration and the stamp helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (`shotSlots`, after `refusal` near line 614; `projects`, after `direction` near line 286)
- Create: `packages/db/drizzle/0031_<generated>.sql` (and the `meta/` snapshot drizzle-kit writes)
- Modify: `packages/db/src/visuals.ts`, `packages/db/src/projects.ts`
- Test: `packages/db/src/visuals.integration.test.ts`

**Interfaces:**
- Consumes: `SlotJob`, `VisualsJob`, `VisualsJobOp` from Task 1.
- Produces (all exported from `@boom-busters/db`):
  - `setSlotJob(db: Database, slotId: string, job: SlotJob | null): Promise<void>`
  - `releaseSlotJob(db: Database, slotId: string, jobId: string): Promise<boolean>` (true when it cleared)
  - `clearProjectJobs(db: Database, projectId: string): Promise<void>`
  - `setVisualsJob(db: Database, projectId: string, job: VisualsJob | null): Promise<void>`
  - `releaseVisualsJob(db: Database, projectId: string, match: { jobId: string } | { op: VisualsJobOp }): Promise<boolean>`
  - Row fields: `ShotSlotRow.pendingJob`, `ProjectRow.visualsJob` (both `Record<string, unknown> | null`).

- [ ] **Step 1: Add the columns**

In `packages/db/src/schema.ts`, inside `shotSlots` after the `refusal` column:

```ts
    /**
     * A background job running on this slot (decision 286), `SlotJobSchema`
     * in schemas: stamped by the action before it sends the event, released
     * by the job that answers it (matched on `jobId`), cleared by Stop.
     */
    pendingJob: jsonb('pending_job').$type<Record<string, unknown>>(),
```

Inside `projects` after `direction`:

```ts
    /**
     * A plan-level visuals job in flight (decision 286), `VisualsJobSchema` in
     * schemas: a re-plan, a fix, a redraft, or a fetch not yet picked up.
     */
    visualsJob: jsonb('visuals_job').$type<Record<string, unknown>>(),
```

- [ ] **Step 2: Generate the migration and read it**

Run (from `packages/db`): `pnpm generate`
Expected: a new `drizzle/0031_<name>.sql` containing exactly these two statements (order may differ) and nothing else:

```sql
ALTER TABLE "projects" ADD COLUMN "visuals_job" jsonb;--> statement-breakpoint
ALTER TABLE "shot_slots" ADD COLUMN "pending_job" jsonb;
```

If it contains anything else, stop: the schema and the migrations had drifted before this task, and that must be understood before continuing.

Then apply it to the test database (from repo root): `pnpm db:migrate:test`
Expected: exits 0.

- [ ] **Step 3: Write the failing tests**

In `packages/db/src/visuals.integration.test.ts`, add to the import from `./visuals`: `clearProjectJobs, releaseSlotJob, setSlotJob`; add `releaseVisualsJob, setVisualsJob` to the import from `./projects`; add `import { newId } from '@boom-busters/schemas'` (merge with the existing type import line as a value import). Then, inside `suite('shot slots', () => { ... })`, after the existing tests:

```ts
  describe('job stamps (decision 286)', () => {
    const startedAt = () => new Date().toISOString()
    const slotJob = () => ({ kind: 'refetch' as const, jobId: newId(), startedAt: startedAt() })

    async function twoSlots(): Promise<[string, string]> {
      await replaceShotList(db, projectId, [
        { chapterId: chapterA, index: 0, type: 'stock', brief: stockBrief, startMs: 0, durationMs: 6000 },
        { chapterId: chapterA, index: 1, type: 'stock', brief: stockBrief, startMs: 6000, durationMs: 6000 },
      ])
      const [a, b] = await listShotSlots(db, projectId)
      return [a!.id, b!.id]
    }

    it('releases a slot stamp only for the job that owns it', async () => {
      const [slotId] = await twoSlots()
      const first = slotJob()
      const second = slotJob()
      await setSlotJob(db, slotId, first)
      await setSlotJob(db, slotId, second)

      // The first job finishing late must not unlock the second press.
      expect(await releaseSlotJob(db, slotId, first.jobId)).toBe(false)
      expect((await getShotSlot(db, slotId))!.pendingJob).toEqual(second)

      expect(await releaseSlotJob(db, slotId, second.jobId)).toBe(true)
      expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()
    })

    it('releases a project stamp by its job id, or by its op for the runner', async () => {
      const fetch = { op: 'fetch' as const, jobId: newId(), startedAt: startedAt() }
      await setVisualsJob(db, projectId, fetch)
      expect(await releaseVisualsJob(db, projectId, { op: 'shots' })).toBe(false)
      expect(await releaseVisualsJob(db, projectId, { op: 'fetch' })).toBe(true)
      expect((await getProject(db, projectId))!.visualsJob).toBeNull()

      const shots = { op: 'shots' as const, jobId: newId(), startedAt: startedAt() }
      await setVisualsJob(db, projectId, shots)
      expect(await releaseVisualsJob(db, projectId, { jobId: newId() })).toBe(false)
      expect((await getProject(db, projectId))!.visualsJob).toEqual(shots)
      expect(await releaseVisualsJob(db, projectId, { jobId: shots.jobId })).toBe(true)
    })

    it('clears every stamp on the project for Stop, and only the in-flight retypes', async () => {
      const [a, b] = await twoSlots()
      await setSlotJob(db, a, slotJob())
      await setSlotRetype(db, a, { state: 'drafting', target: 'chart' })
      await setSlotRetype(db, b, { state: 'refused', target: 'map', reason: 'No places in the text.' })
      await setVisualsJob(db, projectId, { op: 'repair', jobId: newId(), startedAt: startedAt() })

      await clearProjectJobs(db, projectId)

      const slotA = (await getShotSlot(db, a))!
      expect(slotA.pendingJob).toBeNull()
      expect(slotA.retype).toBeNull()
      // A refusal is an answer, not a job: it stays until dismissed.
      expect((await getShotSlot(db, b))!.retype).toMatchObject({ state: 'refused' })
      expect((await getProject(db, projectId))!.visualsJob).toBeNull()
    })
  })
```

- [ ] **Step 4: Run the tests to see them fail**

Run (from `packages/db`): `npx vitest run visuals.integration`
Expected: FAIL, the helpers are not exported.

- [ ] **Step 5: Write the helpers**

In `packages/db/src/visuals.ts`, change the drizzle import to `import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'` (keep whatever else it already imports), add `projects` to the `./schema` import, add `SlotJob` to the type import from `@boom-busters/schemas`, and after `setSlotRetype`:

```ts
/**
 * Stamp or clear a slot's background job (decision 286). The action writes it
 * before it sends the event, so the refresh the button triggers already says
 * the job is running; it writes null back if the send fails.
 */
export async function setSlotJob(
  db: Database,
  slotId: string,
  job: SlotJob | null,
): Promise<void> {
  await db
    .update(shotSlots)
    .set({ pendingJob: job as unknown as Record<string, unknown> | null, updatedAt: sql`now()` })
    .where(eq(shotSlots.id, slotId))
}

/**
 * The job's own release: clears the stamp only while it is still this job's,
 * so a run that finishes after a newer press leaves the newer stamp alone.
 * Returns whether it cleared anything.
 */
export async function releaseSlotJob(
  db: Database,
  slotId: string,
  jobId: string,
): Promise<boolean> {
  const cleared = await db
    .update(shotSlots)
    .set({ pendingJob: null, updatedAt: sql`now()` })
    .where(and(eq(shotSlots.id, slotId), sql`${shotSlots.pendingJob}->>'jobId' = ${jobId}`))
    .returning({ id: shotSlots.id })
  return cleared.length > 0
}

/**
 * Stop's sweep (decision 286). `project/cancelled` cancels the side jobs
 * without running their `onFailure`, so nothing else would clear what they
 * stamped: every slot job, the project's plan job, and a re-type or re-brief
 * still marked in flight. A refused re-type, a re-brief refusal and a Fix
 * note are answers, not jobs, and stay.
 */
export async function clearProjectJobs(db: Database, projectId: string): Promise<void> {
  await db
    .update(shotSlots)
    .set({ pendingJob: null, updatedAt: sql`now()` })
    .where(and(eq(shotSlots.projectId, projectId), isNotNull(shotSlots.pendingJob)))
  await db
    .update(shotSlots)
    .set({ retype: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(shotSlots.projectId, projectId),
        inArray(sql`${shotSlots.retype}->>'state'`, ['drafting', 'rebriefing']),
      ),
    )
  await db
    .update(projects)
    .set({ visualsJob: null, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
}
```

In `packages/db/src/projects.ts` (add `and, sql` to its drizzle import if missing, and `VisualsJob, VisualsJobOp` to its schemas type import), after `setProjectDirection`:

```ts
/**
 * Stamp or clear the project's plan-level visuals job (decision 286). Written
 * by the action before it sends the event. `updatedAt` moves, so the page's
 * pulse sees the stamp come and go.
 */
export async function setVisualsJob(
  db: Database,
  id: string,
  job: VisualsJob | null,
): Promise<void> {
  await db
    .update(projects)
    .set({ visualsJob: job as unknown as Record<string, unknown> | null, updatedAt: new Date() })
    .where(eq(projects.id, id))
}

/**
 * Clear the plan-level stamp if it still matches: by `jobId` for the job that
 * owns it, or by `op` for the runner, which learns of a fetch through a parked
 * wait and so never sees its job id. Returns whether it cleared anything.
 */
export async function releaseVisualsJob(
  db: Database,
  id: string,
  match: { jobId: string } | { op: VisualsJobOp },
): Promise<boolean> {
  const matches =
    'jobId' in match
      ? sql`${projects.visualsJob}->>'jobId' = ${match.jobId}`
      : sql`${projects.visualsJob}->>'op' = ${match.op}`
  const cleared = await db
    .update(projects)
    .set({ visualsJob: null, updatedAt: new Date() })
    .where(and(eq(projects.id, id), matches))
    .returning({ id: projects.id })
  return cleared.length > 0
}
```

Confirm `packages/db/src/index.ts` already re-exports `./visuals` and `./projects` (it does for the existing helpers); nothing to add there.

- [ ] **Step 6: Run the tests to see them pass**

Run (from `packages/db`): `npx vitest run visuals.integration`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

Run (from repo root): `pnpm --filter @boom-busters/db typecheck`; prettier on the touched files.

```bash
git add packages/db/src/schema.ts packages/db/drizzle packages/db/src/visuals.ts packages/db/src/projects.ts packages/db/src/visuals.integration.test.ts
git commit -m "feat(db): slot and project job stamps with an owner-only release (decision 286)"
```

---

### Task 3: The actions stamp before they send

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`approvePlanAction` ~367, `sendRefetch` ~1431, `sendReplan` ~1921, `redirectSceneAction` ~1955)
- Test: `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Consumes: `setSlotJob`, `setVisualsJob` (Task 2); `SlotJob`, `VisualsJob`, `newId` (Task 1).
- Produces: the stamps Tasks 4 to 7 read; events with `jobId` for Tasks 4 and 5.

- [ ] **Step 1: Write the failing tests**

In `visuals-actions.test.ts`, add to the `@boom-busters/db` import: `getProject`; add `redirectSceneAction`, `replanShotsAction` to the `./visuals-actions` import. Then add a new `describeDb` block at the end of the file:

```ts
describeDb('job stamps (decision 286)', () => {
  let slotId = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    inngest.send.mockResolvedValue(undefined)
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: stock('One.', 'the lobby'),
        startMs: 0,
        durationMs: 6000,
      },
    ])
    slotId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.id
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'plan')
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'awaiting_review' })
  })

  /** The one event the action sent, and its data. */
  const sent = () => (inngest.send.mock.calls.at(-1)![0] as { data: Record<string, unknown> }).data

  it('stamps a refetch before it sends, with the id the event carries', async () => {
    expect(await refetchSlotAction(FIXTURE_PROJECT_ID, slotId, 'Regenerate')).toEqual({ ok: true })
    const stamp = (await getShotSlot(db, slotId))!.pendingJob as { kind: string; jobId: string }
    expect(stamp.kind).toBe('refetch')
    expect(sent()['jobId']).toBe(stamp.jobId)
  })

  it('takes the stamp back when the event cannot be sent', async () => {
    inngest.send.mockRejectedValueOnce(new Error('Inngest is down'))
    const result = await refetchSlotAction(FIXTURE_PROJECT_ID, slotId, 'Regenerate')
    expect(result.ok).toBe(false)
    expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()
  })

  it('stamps a redirect on the slot', async () => {
    await db
      .update(shotSlots)
      .set({
        type: 'still',
        brief: {
          type: 'still',
          coversText: 'One.',
          description: 'the lobby',
          motion: { kind: 'static' },
          transition: 'cut',
          prompt: 'An empty lobby at dusk.',
        },
      })
      .where(eq(shotSlots.id, slotId))
    expect(await redirectSceneAction(FIXTURE_PROJECT_ID, slotId)).toEqual({ ok: true })
    const stamp = (await getShotSlot(db, slotId))!.pendingJob as { kind: string; jobId: string }
    expect(stamp.kind).toBe('redirect')
    expect(sent()['jobId']).toBe(stamp.jobId)
  })

  it('stamps a re-plan on the project under the op the event names', async () => {
    expect(await replanShotsAction(FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    const stamp = (await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob as {
      op: string
      jobId: string
    }
    expect(stamp.op).toBe('shots')
    expect(sent()).toMatchObject({ op: 'shots', jobId: stamp.jobId })
  })

  it('stamps Fetch visuals, and takes it back when the send fails', async () => {
    expect(await approvePlanAction(FIXTURE_PROJECT_ID)).toEqual({ ok: true })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toMatchObject({ op: 'fetch' })

    inngest.send.mockRejectedValueOnce(new Error('Inngest is down'))
    expect((await approvePlanAction(FIXTURE_PROJECT_ID)).ok).toBe(false)
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })

  it('refuses a second Fetch while the first is running, rather than cancelling it', async () => {
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'running' })
    const result = await approvePlanAction(FIXTURE_PROJECT_ID)
    expect(result).toEqual({
      ok: false,
      error: 'The fetch is already running. The board updates as the shots land.',
    })
    expect(inngest.send).not.toHaveBeenCalled()
  })
})
```

`eq` needs importing from `drizzle-orm` in this test file if it is not already.

- [ ] **Step 2: Run the tests to see them fail**

Run (from `apps/web`): `npx vitest run visuals-actions.test`
Expected: the six new tests FAIL (no stamp written; the second Fetch is sent).

- [ ] **Step 3: Stamp in the four senders**

Add to the imports of `visuals-actions.ts`: `setSlotJob, setVisualsJob` from `@boom-busters/db`; `newId` (value) and `type SlotJob, type VisualsJob` from `@boom-busters/schemas`.

Replace `sendRefetch` with:

```ts
async function sendRefetch(projectId: string, slotId: string, note: string): Promise<ActionResult> {
  // Stamped first (decision 286), so the refresh this action triggers already
  // says the fetch is running, and the card does not offer it again.
  const job: SlotJob = { kind: 'refetch', jobId: newId(), startedAt: new Date().toISOString() }
  await setSlotJob(db, slotId, job)
  try {
    await inngest.send(
      events.visualsRefetchRequested.create({ projectId, slotId, note, jobId: job.jobId }),
    )
    return { ok: true }
  } catch (error) {
    console.error('[visuals] could not send refetch', error)
    await setSlotJob(db, slotId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to re-fetch this slot. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
}
```

In `redirectSceneAction`, replace the `try { await inngest.send(...) } catch { ... }` block with:

```ts
  const job: SlotJob = { kind: 'redirect', jobId: newId(), startedAt: new Date().toISOString() }
  await setSlotJob(db, slotId, job)
  try {
    await inngest.send(
      events.visualsRedirectRequested.create({ projectId, slotId, jobId: job.jobId }),
    )
  } catch (error) {
    console.error('[visuals] could not send redirect', error)
    await setSlotJob(db, slotId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to redirect this scene. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
```

In `sendReplan`, replace its `try`/`catch` with:

```ts
  const job: VisualsJob = { op, jobId: newId(), startedAt: new Date().toISOString() }
  await setVisualsJob(db, projectId, job)
  try {
    await inngest.send(events.visualsReplanRequested.create({ projectId, op, jobId: job.jobId }))
  } catch (error) {
    console.error('[visuals] could not send replan', error)
    await setVisualsJob(db, projectId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to re-plan. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
```

In `approvePlanAction`, after the `visualsPhase !== 'plan'` check, add the guard, and replace its `try`/`catch`:

```ts
  // The plan phase lasts the whole fetch pass (the runner moves to `board`
  // only when every slot has landed), and a second Fetch here would send
  // `fetch.resume`, whose singleton cancels the fetch in flight (decision 286).
  if (project.stageStatus === 'running' || project.stageStatus === 'queued') {
    return { ok: false, error: 'The fetch is already running. The board updates as the shots land.' }
  }

  const job: VisualsJob = { op: 'fetch', jobId: newId(), startedAt: new Date().toISOString() }
  await setVisualsJob(db, projectId, job)
  try {
    await inngest.send(
      project.stageStatus === 'awaiting_review'
        ? events.visualsPlanApproved.create({ projectId })
        : events.visualsFetchResumed.create({ projectId }),
    )
  } catch (error) {
    console.error('[visuals] could not send plan approval', error)
    await setVisualsJob(db, projectId, null)
    return {
      ok: false,
      error:
        'Could not reach Inngest to start the fetch. ' +
        'Start the dev server with `npx inngest-cli@latest dev`, or check INNGEST_EVENT_KEY.',
    }
  }
```

The `SlotJob`/`VisualsJob` imports are type-only; `newId` is a function, so the file still exports only async functions.

- [ ] **Step 4: Run the tests to see them pass**

Run (from `apps/web`): `npx vitest run visuals-actions.test`
Expected: PASS, the whole file (the existing tests assert `{ ok: true }` from these actions, which is unchanged).

- [ ] **Step 5: Typecheck and commit**

Run (from `apps/web`): `npx tsc --noEmit -p .`; prettier on the two files.

```bash
git add "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.test.ts"
git commit -m "feat(visuals): the actions stamp a job before they send it, and refuse a second Fetch (decision 286)"
```

---

### Task 4: The slot jobs release their stamps

**Files:**
- Create: `apps/web/inngest/lib/jobs.ts`, `apps/web/inngest/lib/jobs.test.ts`
- Modify: `apps/web/inngest/functions/slot-refetcher.ts`, `apps/web/inngest/functions/slot-redirector.ts`
- Test: `apps/web/inngest/functions/slot-refetcher.test.ts`, `apps/web/inngest/functions/slot-redirector.test.ts`

**Interfaces:**
- Consumes: `releaseSlotJob`, `releaseVisualsJob`, `setSlotJob` (Task 2); event `jobId` (Task 1).
- Produces: `releaseFailedSlotJob(data: Record<string, unknown>): Promise<void>` and `releaseFailedVisualsJob(data: Record<string, unknown>): Promise<void>` in `apps/web/inngest/lib/jobs.ts` (Task 5 uses the second).

- [ ] **Step 1: Write the failing tests for the failure helpers**

Create `apps/web/inngest/lib/jobs.test.ts`:

```ts
// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotJob,
  setVisualsJob,
  shotSlots,
} from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/lib/db'
import { releaseFailedSlotJob, releaseFailedVisualsJob } from './jobs'

/** What `onFailure` hands back of the event (decision 286). */

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('releasing a failed job’s stamp', () => {
  let slotId = ''

  beforeEach(async () => {
    await seed(db)
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'One.',
          description: 'the lobby',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'lobby',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 6000,
      },
    ])
    slotId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.id
  })

  it('lets go of the failed job’s own slot stamp, and not a newer one', async () => {
    const failed = newId()
    await setSlotJob(db, slotId, { kind: 'refetch', jobId: failed, startedAt: new Date().toISOString() })
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId, jobId: failed })
    expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()

    const newer = { kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() }
    await setSlotJob(db, slotId, newer)
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId, jobId: failed })
    expect((await getShotSlot(db, slotId))!.pendingJob).toEqual(newer)
  })

  it('does nothing for an event sent before job ids existed', async () => {
    const stamp = { kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() }
    await setSlotJob(db, slotId, stamp)
    await releaseFailedSlotJob({ projectId: FIXTURE_PROJECT_ID, slotId })
    expect((await getShotSlot(db, slotId))!.pendingJob).toEqual(stamp)
  })

  it('lets go of the failed job’s own project stamp', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, { op: 'shots', jobId, startedAt: new Date().toISOString() })
    await releaseFailedVisualsJob({ projectId: FIXTURE_PROJECT_ID, op: 'shots', jobId })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run (from `apps/web`): `npx vitest run inngest/lib/jobs.test`
Expected: FAIL, cannot resolve `./jobs`.

- [ ] **Step 3: Write the helpers**

Create `apps/web/inngest/lib/jobs.ts`:

```ts
import { releaseSlotJob, releaseVisualsJob } from '@boom-busters/db'
import { db } from '@/lib/db'

/**
 * The `onFailure` half of decision 286: a job that failed after its retries
 * lets go of the stamp its action wrote, and only its own (matched on the
 * event's `jobId`). An event with no `jobId` was sent before job ids existed
 * and has nothing of its own to release; the board's 10-minute limit covers
 * whatever it left.
 *
 * Never throws: `onFailure` goes on to say why the job failed, and a release
 * that could not be written must not swallow that.
 */
export async function releaseFailedSlotJob(data: Record<string, unknown>): Promise<void> {
  const { slotId, jobId } = data
  if (typeof slotId !== 'string' || typeof jobId !== 'string') return
  await releaseSlotJob(db, slotId, jobId).catch((error: unknown) => {
    console.error('[jobs] could not release a failed slot job', error)
  })
}

export async function releaseFailedVisualsJob(data: Record<string, unknown>): Promise<void> {
  const { projectId, jobId } = data
  if (typeof projectId !== 'string' || typeof jobId !== 'string') return
  await releaseVisualsJob(db, projectId, { jobId }).catch((error: unknown) => {
    console.error('[jobs] could not release a failed visuals job', error)
  })
}
```

Run: `npx vitest run inngest/lib/jobs.test` (from `apps/web`). Expected: PASS.

- [ ] **Step 4: Write the failing engine tests for the refetcher**

In `slot-refetcher.test.ts`, add `setSlotJob` to the `@boom-busters/db` import and `import { newId } from '@boom-busters/schemas'`. Inside the `describeDb('slot-refetcher (mock mode)', ...)` block, after the existing tests:

```ts
  const refetch = (slotId: string, jobId?: string) => ({
    events: [
      {
        name: 'visuals/refetch.requested',
        data: {
          projectId: FIXTURE_PROJECT_ID,
          slotId,
          note: 'Regenerate',
          ...(jobId ? { jobId } : {}),
        },
      },
    ],
  })
  const stamp = () => ({ kind: 'refetch' as const, jobId: newId(), startedAt: new Date().toISOString() })

  it('releases its own stamp when it lands (decision 286)', async () => {
    const own = stamp()
    await setSlotJob(db, source, own)
    await new InngestTestEngine({ function: slotRefetcher }).execute(refetch(source, own.jobId))
    expect((await getShotSlot(db, source))!.pendingJob).toBeNull()
  })

  it('leaves a newer press’s stamp when it lands late', async () => {
    const late = stamp()
    const newer = stamp()
    await setSlotJob(db, source, newer)
    await new InngestTestEngine({ function: slotRefetcher }).execute(refetch(source, late.jobId))
    expect((await getShotSlot(db, source))!.pendingJob).toEqual(newer)
  })

  it('releases on the linked-slot skip too, the early return', async () => {
    const own = stamp()
    await setSlotJob(db, dependant, own)
    const { result } = await new InngestTestEngine({ function: slotRefetcher }).execute(
      refetch(dependant, own.jobId),
    )
    expect(result).toMatchObject({ status: 'skipped' })
    expect((await getShotSlot(db, dependant))!.pendingJob).toBeNull()
  })

  it('runs an event sent before job ids existed and releases nothing', async () => {
    const other = stamp()
    await setSlotJob(db, source, other)
    const { result } = await new InngestTestEngine({ function: slotRefetcher }).execute(
      refetch(source),
    )
    expect(result).toMatchObject({ outcome: 'refetched' })
    expect((await getShotSlot(db, source))!.pendingJob).toEqual(other)
  })
```

Run (from `apps/web`): `npx vitest run slot-refetcher.test`
Expected: the first and third new tests FAIL (the stamp is still there).

- [ ] **Step 5: Add the release step and `onFailure` to the refetcher**

In `slot-refetcher.ts`, add `releaseSlotJob` to the `@boom-busters/db` import and `import { releaseFailedSlotJob } from '../lib/jobs'`.

In `onFailure`, make the first line:

```ts
    onFailure: async ({ event }) => {
      await releaseFailedSlotJob(event.data.event.data)
      const projectId = event.data.event.data['projectId']
```

Replace the handler so its body runs inside an inner async function and the release runs once after it:

```ts
  async ({ event, step, runId }) => {
    const { projectId, slotId, jobId } = parseEventData('visuals/refetch.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const result = await (async () => {
      // ... the existing body, unchanged: `const outcome = await step.run('refetch-slot', ...)`
      // through `return { projectId, slotId, outcome: 'refetched' as const, ...outcome }` ...
    })()

    // Once, after every step of the body has landed (decision 286), whichever
    // way the body returned: the card stops saying the fetch is running. Plain
    // sequential code, not a finally around the steps, which would run each
    // time Inngest re-enters the function between steps.
    if (jobId) await step.run('release-job', () => releaseSlotJob(db, slotId, jobId))
    return result
  },
```

Move the existing lines (everything after the `ctx` line to the final `return`) into the inner function verbatim, re-indented by two spaces. Nothing inside changes.

- [ ] **Step 6: Run the refetcher tests**

Run (from `apps/web`): `npx vitest run slot-refetcher.test`
Expected: PASS, old and new.

- [ ] **Step 7: The same for the redirector**

In `slot-redirector.test.ts`, add `setSlotJob` to the db import and `import { newId } from '@boom-busters/schemas'`; inside `describeDb('slot-redirector (mock mode)', ...)` add:

```ts
  it('releases its own stamp when the redirect lands (decision 286)', async () => {
    const jobId = newId()
    await setSlotJob(db, slotId, { kind: 'redirect', jobId, startedAt: new Date().toISOString() })
    const { result } = await engine.execute({
      events: [
        {
          name: 'visuals/redirect.requested',
          data: { projectId: FIXTURE_PROJECT_ID, slotId, jobId },
        },
      ],
    })
    expect(result).toMatchObject({ outcome: 'redirected' })
    expect((await getShotSlot(db, slotId))!.pendingJob).toBeNull()
  })
```

Run it and see it FAIL. Then in `slot-redirector.ts`: add `releaseSlotJob` to the db import and `import { releaseFailedSlotJob } from '../lib/jobs'`; make `onFailure`'s first line `await releaseFailedSlotJob(event.data.event.data)`; and wrap the handler exactly as in Step 5, destructuring `jobId` from `parseEventData('visuals/redirect.requested', event.data)`:

```ts
  async ({ event, step, runId }) => {
    const { projectId, slotId, jobId } = parseEventData('visuals/redirect.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const result = await (async () => {
      // ... the existing body, unchanged, from `const redirected = await step.run('redirect-brief', ...)`
      // through `return { projectId, slotId, outcome: 'redirected' as const }` ...
    })()

    // Once, after the body, whichever of its five returns it took (decision 286).
    if (jobId) await step.run('release-job', () => releaseSlotJob(db, slotId, jobId))
    return result
  },
```

Run (from `apps/web`): `npx vitest run slot-redirector.test`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint and commit**

Run (from `apps/web`): `npx tsc --noEmit -p .` and `npx eslint --max-warnings 0 inngest/lib/jobs.ts inngest/lib/jobs.test.ts inngest/functions/slot-refetcher.ts inngest/functions/slot-redirector.ts inngest/functions/slot-refetcher.test.ts inngest/functions/slot-redirector.test.ts`; prettier on the same files.

```bash
git add apps/web/inngest/lib/jobs.ts apps/web/inngest/lib/jobs.test.ts apps/web/inngest/functions/slot-refetcher.ts apps/web/inngest/functions/slot-refetcher.test.ts apps/web/inngest/functions/slot-redirector.ts apps/web/inngest/functions/slot-redirector.test.ts
git commit -m "feat(inngest): the slot jobs release their own stamps when they land or fail (decision 286)"
```

---

### Task 5: The plan-level jobs, the fetch handover and Stop

**Files:**
- Modify: `apps/web/inngest/functions/visuals-replanner.ts`, `apps/web/inngest/functions/visuals-runner.ts` (`onFailure` ~87, `load-plan` step ~307), `apps/web/inngest/functions/cancel-reconciler.ts`
- Test: `apps/web/inngest/functions/visuals-replanner.test.ts`, `apps/web/inngest/functions/visuals-runner.test.ts`
- Create: `apps/web/inngest/functions/cancel-reconciler.test.ts`

**Interfaces:**
- Consumes: `releaseVisualsJob`, `setVisualsJob`, `clearProjectJobs`, `setSlotJob`, `setSlotRetype` (Task 2); `releaseFailedVisualsJob` (Task 4).
- Produces: nothing new for later tasks; the stamps are now released on every path.

- [ ] **Step 1: Write the failing tests**

In `visuals-replanner.test.ts`, change `replanEvent` to take an optional job id:

```ts
function replanEvent(
  op: 'direction' | 'shots' | 'repair',
  jobId?: string,
): [{ name: string; data: Record<string, unknown> }] {
  return [
    {
      name: 'visuals/replan.requested',
      data: { projectId: FIXTURE_PROJECT_ID, op, ...(jobId ? { jobId } : {}) },
    },
  ]
}
```

and, with `setVisualsJob, getProject` in the db import and `newId` from schemas, add inside `describeDb('visuals-replanner (mock mode)', ...)`:

```ts
  it('releases its own stamp when the re-plan lands (decision 286)', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, { op: 'shots', jobId, startedAt: new Date().toISOString() })
    await engine.execute({ events: replanEvent('shots', jobId) })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })

  it('releases it on the early return outside the plan checkpoint too', async () => {
    const jobId = newId()
    await setVisualsJob(db, FIXTURE_PROJECT_ID, { op: 'shots', jobId, startedAt: new Date().toISOString() })
    await setVisualsPhase(db, FIXTURE_PROJECT_ID, 'board')
    const { result } = await engine.execute({ events: replanEvent('shots', jobId) })
    expect(result).toMatchObject({ outcome: 'not-in-plan' })
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
```

In `visuals-runner.test.ts`, with `setVisualsJob` in the db import and `newId` from schemas, add after `'starts at the fetch pass on a resume, keeping every planned slot'`:

```ts
  it('hands the fetch stamp over when it closes the gate (decision 286)', async () => {
    await engine.executeStep('open-plan-park', {
      events: [{ name: 'gate/voice.approved', data: { projectId: FIXTURE_PROJECT_ID } }],
    })
    await setProjectStage(db, FIXTURE_PROJECT_ID, { stage: 'visuals', stageStatus: 'failed' })
    await setVisualsJob(db, FIXTURE_PROJECT_ID, {
      op: 'fetch',
      jobId: newId(),
      startedAt: new Date().toISOString(),
    })

    const resume = new InngestTestEngine({ function: visualsRunner })
    await resume.executeStep('load-plan', {
      events: [{ name: 'visuals/fetch.resume', data: { projectId: FIXTURE_PROJECT_ID } }],
    })

    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
```

Create `apps/web/inngest/functions/cancel-reconciler.test.ts`:

```ts
// @vitest-environment node

import {
  createScriptVersion,
  FIXTURE_PROJECT_ID,
  getProject,
  getShotSlot,
  listShotSlots,
  replaceShotList,
  requireTestDatabase,
  saveChapter,
  seed,
  setSlotJob,
  setSlotRetype,
  setVisualsJob,
  shotSlots,
  truncateRunMirror,
} from '@boom-busters/db'
import { newId } from '@boom-busters/schemas'
import { InngestTestEngine } from '@inngest/test'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/lib/db'
import { forgetRunRows } from '../middleware/run-mirror'
import { cancelReconciler } from './cancel-reconciler'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

const describeDb = requireTestDatabase() ? describe : describe.skip

describeDb('cancel-reconciler: job stamps (decision 286)', () => {
  let slotId = ''

  beforeEach(async () => {
    await seed(db)
    await truncateRunMirror(db)
    forgetRunRows()
    await db.delete(shotSlots)
    const script = await createScriptVersion(db, FIXTURE_PROJECT_ID)
    const chapter = await saveChapter(db, {
      scriptId: script.id,
      index: 0,
      title: 'The audit',
      contentMd: 'One.',
      estRuntimeSec: 30,
    })
    await replaceShotList(db, FIXTURE_PROJECT_ID, [
      {
        chapterId: chapter.id,
        index: 0,
        type: 'stock',
        brief: {
          type: 'stock',
          coversText: 'One.',
          description: 'the lobby',
          motion: { kind: 'static' },
          transition: 'cut',
          query: 'lobby',
          rejectionCriteria: [],
        },
        startMs: 0,
        durationMs: 6000,
      },
    ])
    slotId = (await listShotSlots(db, FIXTURE_PROJECT_ID))[0]!.id
  })

  it('leaves no card saying a job is running after Stop', async () => {
    const startedAt = new Date().toISOString()
    await setSlotJob(db, slotId, { kind: 'refetch', jobId: newId(), startedAt })
    await setSlotRetype(db, slotId, { state: 'drafting', target: 'chart' })
    await setVisualsJob(db, FIXTURE_PROJECT_ID, { op: 'fetch', jobId: newId(), startedAt })

    await new InngestTestEngine({ function: cancelReconciler }).execute({
      events: [
        { name: 'project/cancelled', data: { projectId: FIXTURE_PROJECT_ID, reason: 'owner' } },
      ],
    })

    const slot = (await getShotSlot(db, slotId))!
    expect(slot.pendingJob).toBeNull()
    expect(slot.retype).toBeNull()
    expect((await getProject(db, FIXTURE_PROJECT_ID))!.visualsJob).toBeNull()
  })
})
```

If `project/cancelled`'s schema names a different `reason` field, read `ProjectCancelledSchema` in `packages/schemas/src/events.ts` and send what it requires.

- [ ] **Step 2: Run to see them fail**

Run (from `apps/web`), one file at a time: `npx vitest run visuals-replanner.test`, then `npx vitest run visuals-runner.test`, then `npx vitest run cancel-reconciler.test`
Expected: the new tests FAIL (stamps still present).

- [ ] **Step 3: The re-planner**

In `visuals-replanner.ts`, add `releaseVisualsJob` to the db import and `import { releaseFailedVisualsJob } from '../lib/jobs'`. Make `onFailure`'s first line `await releaseFailedVisualsJob(event.data.event.data)`. Wrap the handler as in Task 4:

```ts
  async ({ event, step, runId }) => {
    const { projectId, op, jobId } = parseEventData('visuals/replan.requested', event.data)
    const ctx: GateContext = { inngestRunId: runId, functionId: FUNCTION_ID, projectId }

    const result = await (async () => {
      // ... the existing body, unchanged, from `const inPlan = await step.run('check-phase', ...)`
      // through `return { projectId, op, outcome: 'replanned' as const, slots: rows.length }` ...
    })()

    // Once, after the body, whichever of its eight returns it took (decision 286).
    if (jobId) await step.run('release-job', () => releaseVisualsJob(db, projectId, { jobId }))
    return result
  },
```

- [ ] **Step 4: The runner's handover**

In `visuals-runner.ts`, add `releaseVisualsJob` to the db import. In the `load-plan` step, directly after the `await closeReviewGate(ctx, { ... })` call:

```ts
      // The fetch has been picked up (decision 286): from here "phase plan,
      // stage running" is what tells the board a fetch is under way, so the
      // stamp Fetch visuals wrote goes. By op, not job id: the approval came
      // through a parked wait, and reading a new field from it outside a step
      // is how decision 279's parked runs crashed. Inside this step, so a run
      // parked before this shipped picks it up when it resumes.
      await releaseVisualsJob(db, projectId, { op: 'fetch' })
```

In the runner's `onFailure`, after `if (typeof projectId !== 'string') return`:

```ts
      // A fetch that died before `load-plan` must not leave "Sending the
      // fetch" on the plan card (decision 286).
      await releaseVisualsJob(db, projectId, { op: 'fetch' }).catch(() => undefined)
```

- [ ] **Step 5: Stop**

In `cancel-reconciler.ts`, add `clearProjectJobs` to the db import, and inside the `release` step, after `await markProjectCancelled(db, projectId)`:

```ts
      // `project/cancelled` cancels the side jobs without their `onFailure`,
      // so nothing else would clear what they stamped (decision 286).
      await clearProjectJobs(db, projectId)
```

- [ ] **Step 6: Run the tests to see them pass**

Run (from `apps/web`), one at a time: `npx vitest run visuals-replanner.test`, `npx vitest run visuals-runner.test`, `npx vitest run cancel-reconciler.test`
Expected: PASS, old and new.

- [ ] **Step 7: Typecheck, lint and commit**

Run (from `apps/web`): `npx tsc --noEmit -p .`; eslint and prettier on the six files.

```bash
git add apps/web/inngest/functions/visuals-replanner.ts apps/web/inngest/functions/visuals-replanner.test.ts apps/web/inngest/functions/visuals-runner.ts apps/web/inngest/functions/visuals-runner.test.ts apps/web/inngest/functions/cancel-reconciler.ts apps/web/inngest/functions/cancel-reconciler.test.ts
git commit -m "feat(inngest): plan jobs release their stamp, the runner takes over the fetch, Stop clears all (decision 286)"
```

---

### Task 6: The review model carries the stamps and the server's clock

**Files:**
- Modify: `apps/web/lib/visuals-review.ts` (`SlotView` ~114, `VisualsReviewModel` ~253, `emptyVisualsModel` ~318, the slot mapping ~741, the model return ~905)
- Test: `apps/web/lib/visuals-review.test.ts`
- Modify (fixtures only): `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**
- Consumes: `SlotJobSchema`, `VisualsJobSchema`, `SlotJob`, `VisualsJobOp` (Task 1); row fields `pendingJob`, `visualsJob` (Task 2).
- Produces (exported from `@/lib/visuals-review`):
  - `interface SlotJobView { kind: SlotJob['kind']; startedAt: string }`
  - `interface VisualsJobView { op: VisualsJobOp; startedAt: string }`
  - `slotJobView(raw: unknown): SlotJobView | null`
  - `visualsJobView(raw: unknown): VisualsJobView | null`
  - `isFetching(phase: 'plan' | 'board' | null, stageStatus: string | undefined): boolean`
  - `SlotView.job: SlotJobView | null`; `VisualsReviewModel.job: VisualsJobView | null`, `.fetching: boolean`, `.renderedAt: string`

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/lib/visuals-review.test.ts` (extend its import from `./visuals-review` with `isFetching, slotJobView, visualsJobView`):

```ts
describe('job stamps as the board reads them (decision 286)', () => {
  const startedAt = '2026-09-30T10:00:00.000Z'
  const jobId = '01J0000000000000000000000J'

  it('passes a slot stamp through without its job id, and reads anything else as no job', () => {
    expect(slotJobView({ kind: 'refetch', jobId, startedAt })).toEqual({ kind: 'refetch', startedAt })
    expect(slotJobView(null)).toBeNull()
    // A stamp that fails its schema must never lock a card.
    expect(slotJobView({ kind: 'refetch', startedAt })).toBeNull()
    expect(slotJobView({ kind: 'teleport', jobId, startedAt })).toBeNull()
  })

  it('passes a project stamp through the same way', () => {
    expect(visualsJobView({ op: 'shots', jobId, startedAt })).toEqual({ op: 'shots', startedAt })
    expect(visualsJobView({ op: 'replan', jobId, startedAt })).toBeNull()
  })

  it('reads a fetch as running only at the plan phase with a live stage', () => {
    expect(isFetching('plan', 'running')).toBe(true)
    expect(isFetching('plan', 'queued')).toBe(true)
    expect(isFetching('plan', 'awaiting_review')).toBe(false)
    // Stop in the middle of a fetch leaves the stage cancelled, not running.
    expect(isFetching('plan', 'cancelled')).toBe(false)
    expect(isFetching('plan', 'failed')).toBe(false)
    expect(isFetching('board', 'running')).toBe(false)
    expect(isFetching(null, 'running')).toBe(false)
  })
})
```

If `'01J0000000000000000000000J'` does not satisfy `UlidSchema` (26 Crockford characters), use `newId()` from `@boom-busters/schemas` instead.

- [ ] **Step 2: Run to see it fail**

Run (from `apps/web`): `npx vitest run lib/visuals-review.test`
Expected: FAIL, the helpers are not exported.

- [ ] **Step 3: Add the helpers and the fields**

In `apps/web/lib/visuals-review.ts`, import `SlotJobSchema, VisualsJobSchema` (values) and `type SlotJob, type VisualsJobOp` from `@boom-busters/schemas`. Near the other exported view types:

```ts
/** A background job on one slot, as the board shows it (decision 286). */
export interface SlotJobView {
  kind: SlotJob['kind']
  startedAt: string
}

/** A plan-level job, as the board shows it (decision 286). */
export interface VisualsJobView {
  op: VisualsJobOp
  startedAt: string
}

/** A stored slot stamp, or null; one that fails its schema is no job. */
export function slotJobView(raw: unknown): SlotJobView | null {
  const parsed = SlotJobSchema.safeParse(raw)
  return parsed.success ? { kind: parsed.data.kind, startedAt: parsed.data.startedAt } : null
}

export function visualsJobView(raw: unknown): VisualsJobView | null {
  const parsed = VisualsJobSchema.safeParse(raw)
  return parsed.success ? { op: parsed.data.op, startedAt: parsed.data.startedAt } : null
}

/**
 * Whether Fetch visuals is under way (decision 286). The runner keeps the
 * plan phase for the whole fetch pass, and the stage reads `running` from the
 * moment it closes the gate, so no stamp is needed; a stopped or failed fetch
 * leaves the stage `cancelled` or `failed`, which is not fetching.
 */
export function isFetching(
  phase: 'plan' | 'board' | null,
  stageStatus: string | undefined,
): boolean {
  return phase === 'plan' && (stageStatus === 'running' || stageStatus === 'queued')
}
```

In `SlotView`, after `refusal`:

```ts
  /** A background job running on this slot (decision 286), or null. */
  job: SlotJobView | null
```

In `VisualsReviewModel`, after `phase`:

```ts
  /** A plan-level job in flight (decision 286), or null. */
  job: VisualsJobView | null
  /** Fetch visuals is under way (decision 286): see `isFetching`. */
  fetching: boolean
  /**
   * The server's clock when this model was built (ISO). The board measures a
   * stamp's age from it, not from the browser's clock (decision 286).
   */
  renderedAt: string
```

In `emptyVisualsModel()`, add `job: null, fetching: false, renderedAt: new Date().toISOString(),`.

In the `rows.map` that builds `SlotView`, after `refusal: ...`: `job: slotJobView(row.pendingJob),`.

In the model's `return { ... }`, after `phase: options.phase ?? null,`:

```ts
    job: visualsJobView(project?.visualsJob),
    fetching: isFetching(options.phase ?? null, project?.stageStatus),
    renderedAt: new Date().toISOString(),
```

- [ ] **Step 4: Update the board test fixtures**

Run (from `apps/web`): `npx tsc --noEmit -p .`
Expected: errors in `visual-board.test.tsx` only, at each full `SlotView` literal (missing `job`) and at the `model()` helper (missing `job`, `fetching`, `renderedAt`).

In `visual-board.test.tsx`:
- Add `job: null,` after `refusal: null,` in every full `SlotView` literal the compiler names (`stockSlot`, `chartSlot`, `headlineSlot`, `graphicSlot`, `brokenSlot`, `socialSlot`, and any other it lists). Spread literals (`{ ...stockSlot, ... }`) inherit it.
- Near `PROJECT`, add `const RENDERED_AT = '2026-09-30T10:00:00.000Z'`.
- In `model()`'s return, after `phase: 'board',`, add `job: null, fetching: false, renderedAt: RENDERED_AT,`.

Run `npx tsc --noEmit -p .` again. Expected: no errors.

- [ ] **Step 5: Run the tests**

Run (from `apps/web`): `npx vitest run lib/visuals-review.test`, then `npx vitest run visual-board.test`
Expected: PASS both (the board ignores the new fields until Task 7).

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/visuals-review.ts apps/web/lib/visuals-review.test.ts "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "feat(visuals): the review model carries job stamps, the fetch state and the server clock (decision 286)"
```

---

### Task 7: The board says what is running, locks for it, and lets go when it is stale

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx`
- Test: `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**
- Consumes: `SlotView.job`, `VisualsReviewModel.job`, `.fetching`, `.renderedAt`, `SlotJobView`, `VisualsJobView` (Task 6); `VisualsJobOp` (Task 1); the board's existing `locks`, `SlotLock`, `SlotLockContext`, `PLAN_KEYS`, `chapterTally`, `ChapterSection`, `SlotCard` (decision 285); `timecode` from `@/lib/visuals-reuse`.
- Produces: the user-facing behaviour; nothing for later tasks.

- [ ] **Step 1: Write the failing tests**

In `visual-board.test.tsx`, add `act` to the `@testing-library/react` import and `afterEach` to the `vitest` import. Append:

```ts
describe('background jobs on the board (decision 286)', () => {
  /** An ISO time `ms` before the model was rendered. */
  const ago = (ms: number) => new Date(Date.parse(RENDERED_AT) - ms).toISOString()

  afterEach(() => {
    vi.useRealTimers()
  })

  it('locks a card while its regenerate runs, keeps the button spinning, and says for how long', () => {
    const running: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(42_000) } }
    render(
      <VisualBoard projectId={PROJECT} model={model([running])} colors={COLORS} brand={BRAND} />,
    )

    const regenerate = screen.getByRole('button', { name: 'Regenerate' })
    expect(regenerate).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Upload own' })).toBeDisabled()
    for (const candidate of within(screen.getByRole('list', { name: 'Candidates' })).getAllByRole(
      'button',
    )) {
      expect(candidate).toBeDisabled()
    }
    expect(
      screen.getByText(
        `Regenerating, started ${timecode(42_000)} ago. The new candidates replace these when they land.`,
      ),
    ).toBeInTheDocument()
  })

  it('lets go of a stamp older than 10 minutes and says it may have stopped', () => {
    const stuck: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(11 * 60_000) } }
    render(<VisualBoard projectId={PROJECT} model={model([stuck])} colors={COLORS} brand={BRAND} />)

    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
    expect(
      screen.getByText(
        'This has been running for 11 minutes, longer than it should. It may have stopped. You can try again.',
      ),
    ).toBeInTheDocument()
  })

  it('unlocks on its own once the clock passes the limit', () => {
    vi.useFakeTimers()
    const nearly: SlotView = {
      ...stockSlot,
      job: { kind: 'refetch', startedAt: ago(10 * 60_000 - 5_000) },
    }
    render(<VisualBoard projectId={PROJECT} model={model([nearly])} colors={COLORS} brand={BRAND} />)
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeEnabled()
  })

  it('judges age by the server’s clock, so a wrong browser clock changes nothing', () => {
    vi.useFakeTimers()
    // The laptop thinks it is three months later than the server does.
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const fresh: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(60_000) } }
    render(<VisualBoard projectId={PROJECT} model={model([fresh])} colors={COLORS} brand={BRAND} />)
    act(() => {
      vi.advanceTimersByTime(15_000)
    })
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeDisabled()
  })

  it('says a redirect is running in its own words', () => {
    const redirecting: SlotView = { ...stockSlot, job: { kind: 'redirect', startedAt: ago(5_000) } }
    render(
      <VisualBoard projectId={PROJECT} model={model([redirecting])} colors={COLORS} brand={BRAND} />,
    )
    expect(
      screen.getByText(`Redirecting the scene without the likeness, started ${timecode(5_000)} ago.`),
    ).toBeInTheDocument()
  })

  it('locks the whole board while the shot list is re-planned', () => {
    const planned: SlotView = { ...stockSlot, status: 'unresolved', candidates: [], needsFetch: true }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned, { ...planned, id: SLOT_B }], {
          phase: 'plan',
          job: { op: 'shots', startedAt: ago(65_000) },
        })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(
      screen.getByText(
        `Re-planning the shot list, started ${timecode(65_000)} ago. The plan below is replaced when it lands.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-plan shot list/ })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('button', { name: /Fetch visuals/ })).toBeDisabled()
    for (const fetch of screen.getAllByRole('button', { name: 'Fetch this slot' })) {
      expect(fetch).toBeDisabled()
    }
  })

  it('says how many slots are still to land while Fetch visuals runs, and offers no second fetch', () => {
    const planned: SlotView = { ...stockSlot, status: 'unresolved', candidates: [], needsFetch: true }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([planned, { ...planned, id: SLOT_B }], { phase: 'plan', fetching: true })}
        colors={COLORS}
        brand={BRAND}
      />,
    )

    expect(screen.getByText('Fetching visuals: 2 slots still to land.')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing has been fetched or generated yet/)).not.toBeInTheDocument()
    const fetch = screen.getByRole('button', { name: /Fetch visuals/ })
    expect(fetch).toBeDisabled()
    expect(fetch).toHaveAttribute('aria-busy', 'true')
  })

  it('counts running jobs as in progress and stuck ones as to look at on the chapter', () => {
    const running: SlotView = { ...stockSlot, job: { kind: 'refetch', startedAt: ago(1_000) } }
    const stuck: SlotView = {
      ...chartSlot,
      job: { kind: 'refetch', startedAt: ago(20 * 60_000) },
    }
    render(
      <VisualBoard
        projectId={PROJECT}
        model={model([running, stuck])}
        colors={COLORS}
        brand={BRAND}
      />,
    )
    const header = screen.getByRole('button', { name: /^Chapter 1/ })
    expect(header).toHaveTextContent('1 in progress')
    expect(header).toHaveTextContent('1 to look at')
  })
})
```

Also update the existing test `'counts a chapter’s drafting and refused cards on its header'`: change `expect(header).toHaveTextContent('1 drafting')` to `expect(header).toHaveTextContent('1 in progress')`.

- [ ] **Step 2: Run to see them fail**

Run (from `apps/web`): `npx vitest run visual-board.test`
Expected: the new tests and the updated one FAIL.

- [ ] **Step 3: The clock and the job words**

In `visual-board.tsx`, add `type VisualsJobOp` to the `@boom-busters/schemas` type import and `type SlotJobView, type VisualsJobView` to the `@/lib/visuals-review` type import. After `PLAN_KEYS`:

```ts
/** How old a job stamp may be before the board stops trusting it (decision 286). */
const JOB_STALE_MS = 10 * 60_000

/**
 * The server's clock, carried forward here (decision 286): the model's
 * `renderedAt` plus the time that has passed in this browser since it arrived.
 * A browser clock that is hours out cannot lock a fresh card or unlock a live
 * one, and the first render matches the server's. Ticks every 15 s, only
 * while there is a stamp to age.
 */
function useServerNow(renderedAt: string, ticking: boolean): number {
  const base = Date.parse(renderedAt)
  const [now, setNow] = React.useState(base)
  React.useEffect(() => {
    const arrived = Date.now()
    setNow(base)
    if (!ticking) return
    const timer = window.setInterval(() => setNow(base + (Date.now() - arrived)), 15_000)
    return () => window.clearInterval(timer)
  }, [base, ticking])
  return now
}

const jobAgeMs = (startedAt: string, now: number) => Math.max(0, now - Date.parse(startedAt))
const jobIsLive = (startedAt: string, now: number) => jobAgeMs(startedAt, now) < JOB_STALE_MS

/** The amber line a stale stamp gets, on a card or on the plan card. */
function staleJobWords(startedAt: string, now: number): string {
  const minutes = Math.floor(jobAgeMs(startedAt, now) / 60_000)
  return `This has been running for ${minutes} minutes, longer than it should. It may have stopped. You can try again.`
}

/** Which plan-card control spins for a plan-level job (the decision 285 press names). */
const PLAN_JOB_PRESS: Record<VisualsJobOp, string> = {
  fetch: 'plan',
  repair: 'repair',
  shots: 'replan',
  direction: 'direction-redraft',
}

const PLAN_JOB_WORDS: Record<VisualsJobOp, { doing: string; then: string }> = {
  shots: { doing: 'Re-planning the shot list', then: ' The plan below is replaced when it lands.' },
  repair: { doing: 'Fixing the flagged slots', then: ' The flagged cards change when it lands.' },
  direction: { doing: 'Redrafting the direction', then: ' The book above is replaced when it lands.' },
  fetch: { doing: 'Sending the fetch', then: '' },
}

/** What a card says while its own job runs. */
function slotJobWords(job: SlotJobView, now: number, planning: boolean): string {
  const age = timecode(jobAgeMs(job.startedAt, now))
  if (job.kind === 'redirect') return `Redirecting the scene without the likeness, started ${age} ago.`
  return planning
    ? `Fetching this slot, started ${age} ago. The card updates when it lands.`
    : `Regenerating, started ${age} ago. The new candidates replace these when they land.`
}
```

- [ ] **Step 4: Locks from the stamps**

In `VisualBoard`, replace the `planBusy` and `slotLock` lines (from decision 285) with:

```ts
  // Background jobs (decision 286): a stamp younger than the limit locks what
  // it affects just as a press in flight does, and names the control to spin.
  const stamped = model.job !== null || model.fetching || allSlots.some((slot) => slot.job !== null)
  const now = useServerNow(model.renderedAt, stamped)
  const boardJob: VisualsJobView | null =
    model.job && jobIsLive(model.job.startedAt, now) ? model.job : null
  const boardLocked = model.fetching || boardJob !== null
  const boardPress = model.fetching ? 'plan' : boardJob ? PLAN_JOB_PRESS[boardJob.op] : null
  const planPressed = (key: string) => locks.has(key) || boardPress === key

  const planBusy = PLAN_KEYS.some((key) => locks.has(key)) || boardLocked
  const slotLock = (slot: SlotView): SlotLock => {
    const lock = locks.get(slot.id)
    const job = slot.job && jobIsLive(slot.job.startedAt, now) ? slot.job : null
    const jobPress = job ? (job.kind === 'refetch' ? 'regenerate' : 'redirect') : null
    return {
      busy: lock !== undefined || job !== null || boardLocked,
      pressed: lock?.pressed ?? jobPress,
    }
  }
```

Update the uses:
- `<SlotLockContext.Provider key={slot.id} value={slotLock(slot)}>` (it took `slot.id` before).
- The three plan `ConfirmButton`s: `busy={planPressed('plan')}`, `busy={planPressed('repair')}`, `busy={planPressed('replan')}` (keep `disabled={planBusy}`).
- `DirectionCard`'s `pressed`: `planPressed('direction-save') ? 'direction-save' : planPressed('direction-redraft') ? 'direction-redraft' : null`.

- [ ] **Step 5: The plan card's status line**

In the Shot plan `CardContent`, replace the intro paragraph (`Nothing has been fetched or generated yet. ...`) with:

```tsx
              {model.fetching ? (
                <p className="text-[13px] text-[var(--color-text-primary)]" role="status">
                  Fetching visuals: {model.toFetch} slot{model.toFetch === 1 ? '' : 's'} still to
                  land.
                </p>
              ) : model.job && !boardJob ? (
                <p className="text-[13px] text-[var(--color-warning)]" role="status">
                  {staleJobWords(model.job.startedAt, now)}
                </p>
              ) : boardJob ? (
                <p className="text-[13px] text-[var(--color-text-primary)]" role="status">
                  {PLAN_JOB_WORDS[boardJob.op].doing}, started{' '}
                  {timecode(jobAgeMs(boardJob.startedAt, now))} ago.
                  {PLAN_JOB_WORDS[boardJob.op].then}
                </p>
              ) : (
                <p className="text-[13px] text-[var(--color-text-secondary)]">
                  Nothing has been fetched or generated yet. Edit any brief, change a slot&apos;s
                  format, or fetch a single slot to try it; when the plan reads right, fetch the lot.
                  Slots already fetched for their current brief are never bought twice.
                </p>
              )}
```

(Keep the last branch's text exactly as the paragraph it replaces reads today.) Run prettier; if it splits the JSX text so the test's exact string no longer matches, the text content is unchanged, `getByText` matches the element's normalised text.

- [ ] **Step 6: The card's status line and the tallies**

Pass `now` down: add `now: number` to `SlotCard`'s props and `now={now}` at its call site; add `now: number` to `ChapterSection`'s props and `now={now}` at its call site, and pass it into `chapterTally(chapter.slots, phase, slotNotes, now)`.

In `SlotCard`, directly after `<CardContent className="flex flex-col gap-3">`:

```tsx
        {slot.job ? (
          <p
            role="status"
            className={
              jobIsLive(slot.job.startedAt, now)
                ? 'text-[13px] text-[var(--color-text-primary)]'
                : 'text-[13px] text-[var(--color-warning)]'
            }
          >
            {jobIsLive(slot.job.startedAt, now)
              ? slotJobWords(slot.job, now, planning)
              : staleJobWords(slot.job.startedAt, now)}
          </p>
        ) : null}
```

In `chapterTally`, add the `now: number` parameter and replace the `drafting` and `toLookAt` counts:

```ts
  const liveJob = (slot: SlotView) => slot.job !== null && jobIsLive(slot.job.startedAt, now)
  const inProgress = count(
    (slot) =>
      slot.retype?.state === 'drafting' || slot.retype?.state === 'rebriefing' || liveJob(slot),
  )
  // Everything the card itself asks the producer to act on, a stuck job included.
  const toLookAt = count(
    (slot) =>
      slot.refusal !== null ||
      slot.retype?.state === 'refused' ||
      slot.retype?.state === 'rebrief-refused' ||
      slot.retype?.state === 'fix-note' ||
      (slot.job !== null && !liveJob(slot)),
  )
```

and in `parts.push(...)` change `{ n: drafting, text: \`${drafting} drafting\`, warn: false }` to `{ n: inProgress, text: \`${inProgress} in progress\`, warn: false }`.

- [ ] **Step 7: Run the tests to see them pass**

Run (from `apps/web`): `npx vitest run visual-board.test`
Expected: PASS, old and new.

- [ ] **Step 8: Typecheck, lint, format and commit**

Run (from `apps/web`): `npx tsc --noEmit -p .`; `npx eslint --max-warnings 0 "app/(console)/projects/[id]/visual-board.tsx" "app/(console)/projects/[id]/visual-board.test.tsx"`; prettier on both.

```bash
git add "apps/web/app/(console)/projects/[id]/visual-board.tsx" "apps/web/app/(console)/projects/[id]/visual-board.test.tsx"
git commit -m "feat(visuals): the board says what is running, locks for it, and lets go when stale (decision 286)"
```

---

### Task 8: Whole-branch verification and the record

**Files:**
- Modify: `PROGRESS.md` (append decision 286 after 285)

- [ ] **Step 1: The full suites, one at a time**

From the repo root, sequentially (never two DB suites at once):
- `pnpm --filter @boom-busters/schemas test`
- `pnpm --filter @boom-busters/db test`
- `cd apps/web && npx vitest run` (about 6 minutes)
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`

Expected: all PASS (format warnings only under `.claude/worktrees/`).

- [ ] **Step 2: The visuals e2e specs**

Check port 3100 is free (`netstat -ano | grep ":3100 "`; stop any stray `node` on it). Then from `e2e/`: `pnpm exec playwright test tests/visual-plan.spec.ts tests/visual-board.spec.ts --reporter=line`
Expected: 26 passed. The seeded board has no stamps, so nothing on it should change.

- [ ] **Step 3: Record the decision**

Append to `PROGRESS.md`:

```markdown
286. **The board says a background job is running until it lands**
     (2026-09-30, owner, after decision 285: proper feedback on edits).
     Regenerate, Fetch this slot, Save & re-fetch, Redirect, Re-plan, Fix,
     Redraft and Fetch visuals each sent an event and returned, and nothing
     stored said the job was running, so the card went back to offering the
     same paid action while it worked; a second press cancelled the first
     run (every one is a `cancel` singleton). Worst was Fetch visuals: the
     plan phase lasts the whole fetch pass, so the plan screen kept offering
     Fetch, and a second press sent `fetch.resume` and cancelled the fetch
     in flight. Now the action stamps the row before it sends
     (`shot_slots.pending_job`, `projects.visuals_job`, each with a
     `jobId`), and the job releases only its own stamp, once, in a
     `release-job` step after its body returns (so none of the re-planner's
     eight exits can forget it), and again in `onFailure`. Stop clears every
     stamp on the project, and the stuck `drafting`/`rebriefing` re-types
     it used to leave behind. Fetch visuals hands over at the gate close:
     the runner clears the `fetch` stamp by op inside `load-plan` (not by
     job id, which would mean reading a new field from a parked wait, the
     decision 279 crash), and from there "plan phase, stage running" is the
     signal; `approvePlanAction` also refuses a second Fetch while it runs.
     The board locks the card (or, for plan jobs, the whole board), keeps
     the pressed button spinning, and says what is running and for how
     long; past 10 minutes a stamp stops locking and the card says it may
     have stopped. Age is measured on the server's clock (`renderedAt` plus
     time elapsed in the browser), so a wrong laptop clock changes nothing.
     Ships with `db:migrate` before the Vercel deploy, then
     `PUT /api/inngest`; no broker or Remotion redeploy.
```

Run `npx prettier --check PROGRESS.md`.

```bash
git add PROGRESS.md
git commit -m "docs(progress): decision 286, job state on the visual board"
```
