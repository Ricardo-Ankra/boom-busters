# Chapter Marking Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps decision 457 recorded: the owner can rename a project (so title mode shows the title they want), and a format's chapter marking reaches in-flight projects the way the Shorts flag does.

**Architecture:** One database helper per gap in `packages/db` (`renameProject`, `chapterMarkingForProject`), a server action plus a labelled button on the project page for the rename, and the assembly runner's `load-assembly` step reading the marking through the new helper instead of the project's pinned bible. No schema change, no migration.

**Tech Stack:** TypeScript, Drizzle, vitest (database suites in `packages/db` and `apps/web`), React Testing Library, Inngest test engine.

**Spec:** `docs/superpowers/specs/2026-11-10-chapter-marking-design.md` sections 5.1 and 5.2, as amended by the final review (title is the case title fixed at creation; format override reaches a project through its pinned bible). This plan changes both statements; Task 3 rewrites them.

## Global Constraints

- Branch `chapter-marking-gaps` off `origin/master` (db66a095 or later), one logical change per commit, every commit ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Run `pnpm exec vitest run <basename>` from the package directory; database suites (`packages/db`, `apps/web`) never two at once; the worktree gets its own test database (controller sets it up).
- `pnpm format:check` discipline: Prettier on touched files before each commit.
- UI: every action a visible labelled control (button-first, spec 11.1); no em dashes or en dashes in copy the owner reads.
- Rename rules: the title is trimmed, 3 to 200 characters (the project title column is `text` not null; `OutlineChapterSchema` uses the same 3 to 200 window for titles). The action refuses an archived channel the way `moveToLatestBibleAction` does, and refuses while a live run holds the project only if that file's other actions do (mirror `deleteProjectAction`'s guard shape, not its strictness: a rename is safe mid-run).
- The marking helper mirrors `shortsEnabledForProject` (ruling 18, `packages/db/src/channels.ts`): it reads the channel's CURRENT bible for the format and the channel's current settings for the Brand Kit look, and resolves with `resolveChapterMarking(settings.brandKit.look, format)` from `@boom-busters/schemas`.
- Decision number: 459 (master's latest is 458); renumber at merge if taken.

## Review Focus

1. A rename while assembly is running must not corrupt the in-flight compile: the runner reads `project.title` inside `load-assembly`, a memoised step, so a rename after that step does not change the running film. Pinned by Task 3's doc comment and PROGRESS line, not a test.
2. A project whose `formatKey` no longer exists in the current bible must resolve to the primary format, as `resolveFormat` already does. Pinned in Task 1's helper test.
3. An archived channel's project cannot be renamed. Pinned in Task 2's action test.
4. An empty or whitespace title is refused with a plain message. Pinned in Task 2's action test.
5. A channel whose Brand Kit says `none` while the current bible's format says `cards` must resolve to `cards` for every project of that format. Pinned in Task 1's helper test.

---

### Task 1: The two database helpers

**Files:**
- Modify: `packages/db/src/projects.ts` (beside `backdateProject`, line 346)
- Modify: `packages/db/src/channels.ts` (beside `shortsEnabledForProject`, line 366)
- Test: `packages/db/src/projects.test.ts`, `packages/db/src/channels.test.ts` (whichever files already test those modules; create the test beside the existing ones for the same module)

**Interfaces:**
- Produces: `export async function renameProject(db: Database, id: string, title: string): Promise<boolean>` (true when a row changed); `export async function chapterMarkingForProject(db: Database, projectId: string): Promise<ChapterMarking>`; both exported from the package index the way their neighbours are.

- [ ] **Step 1: Write the failing tests**

In the projects test file (seeded fixture project, as the file's other tests do):

```ts
it('renameProject writes the new title and reports whether a row changed', async () => {
  expect(await renameProject(db, FIXTURE_PROJECT_ID, 'The Four Billion Euros')).toBe(true)
  expect((await getProject(db, FIXTURE_PROJECT_ID))?.title).toBe('The Four Billion Euros')
  expect(await renameProject(db, '01J00000000000000000000000', 'Nobody')).toBe(false)
})
```

In the channels test file:

```ts
it('chapterMarkingForProject reads the current bible format and the live Brand Kit (ruling 18)', async () => {
  // Default channel: look cards, format inherit.
  expect(await chapterMarkingForProject(db, FIXTURE_PROJECT_ID)).toBe('cards')
  // The Brand Kit says none and the project's format still inherits.
  await updateChannelSettings(db, FIXTURE_CHANNEL_ID, { brandKit: { ...settings.brandKit, look: { ...settings.brandKit.look, chapterMarking: 'none' } } })
  expect(await chapterMarkingForProject(db, FIXTURE_PROJECT_ID)).toBe('none')
  // A NEW bible version sets the project's format to cards: the pinned version is older, the current one wins.
  await saveBibleVersion(db, FIXTURE_CHANNEL_ID, { ...bible, formats: bible.formats.map((f) => ({ ...f, chapterMarking: 'cards' })) })
  expect(await chapterMarkingForProject(db, FIXTURE_PROJECT_ID)).toBe('cards')
})

it('chapterMarkingForProject falls back to the primary format for a key the current bible no longer has', async () => {
  // set the project's formatKey to 'gone' directly, then assert the primary format's resolution
})
```

Use the file's own helpers for settings and bible writes (`updateChannelSettings` / `saveBibleVersion` are placeholders: the implementer uses the real names, found next to `shortsEnabledForProject`'s test).

- [ ] **Step 2: Run to verify failure**

Run from `packages/db`: `pnpm exec vitest run projects.test channels.test`
Expected: FAIL, functions not exported.

- [ ] **Step 3: Implement**

`renameProject`: `db.update(projects).set({ title, updatedAt: new Date() }).where(eq(projects.id, id)).returning({ id: projects.id })`, true when one row. `chapterMarkingForProject`: select `channelId`, `formatKey` from `projects`; throw `ProjectNotFoundError` when missing (as `shortsEnabledForProject` does); `currentBible(db, channelId)` for the format via `resolveFormat`; `getChannelSettings(db, channelId)` (or the file's existing settings reader) for the look; return `resolveChapterMarking(settings.brandKit.look, format)`. Doc comment: ruling 18 and decision 459.

- [ ] **Step 4: Run, typecheck, commit**

Run from `packages/db`: `pnpm exec vitest run projects.test channels.test`; root `pnpm typecheck`. Expected: green.

```bash
git add packages/db/src/projects.ts packages/db/src/channels.ts packages/db/src/index.ts <test files>
git commit -m "feat(db): renameProject and chapterMarkingForProject, the marking read live like the Shorts flag (decision 459)"
```

---

### Task 2: Rename project, the action and the button

**Files:**
- Modify: `apps/web/app/(console)/projects/actions.ts` (beside `moveToLatestBibleAction`, line 115)
- Modify: `apps/web/app/(console)/projects/[id]/project-controls.tsx` (beside `UseLatestBibleButton`, line 166)
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx:384` (the `<h1>` header)
- Test: `apps/web/app/(console)/projects/actions.test.ts`, `apps/web/app/(console)/projects/[id]/project-controls.test.tsx`

**Interfaces:**
- Consumes: `renameProject` from Task 1.
- Produces: `export async function renameProjectAction(projectId: string, title: string): Promise<ActionResult>`; `export function RenameProjectButton({ projectId, title, disabled }: { projectId: string; title: string; disabled?: boolean })`.

Copy, fixed: the input's visible label `Project title`; the button `Rename project`; success toast `Project renamed`; refusal for a blank or short title `Give the project a title of at least 3 characters.`; refusal for a long one `Keep the title under 200 characters.`; archived channel: the message `moveToLatestBibleAction` uses. Under the control, one line of help: `The title card in title mode shows this; rename before assembling.`

- [ ] **Step 1: Write the failing tests**

Action tests (follow the file's `beforeEach` seed and the archived-channel fixture other tests use):

```ts
describe('renameProjectAction', () => {
  it('renames and refreshes', async () => {
    expect(await renameProjectAction(FIXTURE_PROJECT_ID, '  The Four Billion Euros  ')).toEqual({ ok: true })
    expect((await getProject(db, FIXTURE_PROJECT_ID))?.title).toBe('The Four Billion Euros')
  })
  it('refuses a blank or short title and a long one', async () => {
    expect(await renameProjectAction(FIXTURE_PROJECT_ID, '  ')).toEqual({ ok: false, error: 'Give the project a title of at least 3 characters.' })
    expect(await renameProjectAction(FIXTURE_PROJECT_ID, 'x'.repeat(201))).toEqual({ ok: false, error: 'Keep the title under 200 characters.' })
  })
  it('refuses on an archived channel', async () => { /* archive the fixture channel the way the file's other archived tests do, then expect ok false */ })
})
```

Component test (follow `UseLatestBibleButton`'s test in `project-controls.test.tsx`):

```ts
it('RenameProjectButton is a labelled input and button that calls the action with the typed title', async () => {
  render(<RenameProjectButton projectId={ID} title="Old title" />)
  const input = screen.getByLabelText('Project title')
  expect((input as HTMLInputElement).value).toBe('Old title')
  await user.clear(input); await user.type(input, 'New title')
  await user.click(screen.getByRole('button', { name: 'Rename project' }))
  expect(renameProjectAction).toHaveBeenCalledWith(ID, 'New title')
})
```

- [ ] **Step 2: Run to verify failure**

Run from `apps/web`: `pnpm exec vitest run actions.test project-controls.test` (the first is a database suite; timeout 600000). Expected: FAIL, not exported.

- [ ] **Step 3: Implement**

Action: `auth`/owner check as the file does, ULID check, trim, the two length refusals, the archived-channel refusal via the same helper `moveToLatestBibleAction` uses, `renameProject`, `revalidatePath` for the project page and the channel's projects list as neighbouring actions do. Button: `useAction()`, a controlled `Input` with a visible `Label htmlFor`, the button disabled while busy or when the trimmed value equals the current title or is empty, the help line. Page: render `<RenameProjectButton projectId={project.id} title={project.title} disabled={channel.archived} />` under the `<h1>` (keep the `<h1>` as the heading); use whatever the page already passes for an archived channel to `UseLatestBibleButton`.

- [ ] **Step 4: Run, typecheck, lint, commit**

Run from `apps/web`: `pnpm exec vitest run actions.test project-controls.test`; root `pnpm typecheck` and `pnpm lint`. Expected: green.

```bash
git add "apps/web/app/(console)/projects/actions.ts" "apps/web/app/(console)/projects/actions.test.ts" "apps/web/app/(console)/projects/[id]/project-controls.tsx" "apps/web/app/(console)/projects/[id]/project-controls.test.tsx" "apps/web/app/(console)/projects/[id]/page.tsx"
git commit -m "feat(web): Rename project, a labelled control on the project page (decision 459)"
```

---

### Task 3: The runner reads the marking live, the load step gets its test, the documents

**Files:**
- Modify: `apps/web/inngest/functions/assembly-runner.ts:112-145` (load-assembly)
- Test: `apps/web/inngest/functions/assembly-runner.test.ts`
- Modify: `docs/superpowers/specs/2026-11-10-chapter-marking-design.md` (5.1 title sentence; 5.2 the pinning statement), `PROGRESS.md` (Chapter marking section: a "### Gaps closed (2026-11-10)" subsection with the commits; owner action 5 and the Follow-ups line rewritten; decision 459 after 458)

**Interfaces:**
- Consumes: `chapterMarkingForProject` from Task 1.

- [ ] **Step 1: Write the failing test**

Following the file's engine harness (the compile tests seed `load-assembly`; this one executes it): `engine.executeStep('load-assembly', { events: [...] })` with the fixture project seeded (`seed(db)` in `beforeAll` is already there) and assert the step result's `chapterMarking` equals `await chapterMarkingForProject(db, FIXTURE_PROJECT_ID)` and `filmTitle` equals the fixture project's title. If the step needs approved takes to pass `narrationPlan`, seed the minimum the file's other tests seed, or assert on the thrown/returned shape the step produces for the fixture and still check the two fields are computed (read the runner: the two fields are built before the missing-takes check returns).

- [ ] **Step 2: Run to verify failure**

Run from `apps/web`: `pnpm exec vitest run assembly-runner.test` (timeout 600000). Expected: FAIL on the marking source only if the fixture distinguishes pinned from current; otherwise the test is the regression net and the RED is the missing field after you temporarily remove it. Report which.

- [ ] **Step 3: Implement**

`load-assembly`: `chapterMarking: await chapterMarkingForProject(db, projectId)`; keep `filmTitle: project.title`; drop the `format` destructure if nothing else uses it. Doc comment: the marking is read live like the Shorts flag (ruling 18, decision 459); a rename after this step does not reach the running film.

Documents: spec 5.1 says the owner renames the project on its page before assembling (the "Rename project" control) and a re-assembly picks the new name up; spec 5.2 says the format's marking is read from the channel's current bible at assembly, like Shorts. PROGRESS: the subsection, the owner-action line, the Follow-ups line, and decision 459: "Rename project on the project page; a format's chapter marking is read from the current bible at assembly (ruling 18), so changing it reaches in-flight projects on re-assembly; the load-assembly step is now driven by a test."

- [ ] **Step 4: Verification and commit**

From `apps/web`: `pnpm exec vitest run assembly-runner.test`; root `pnpm typecheck`, `pnpm lint`, Prettier on touched files; then `pnpm --filter @boom-busters/db test` and `pnpm --filter @boom-busters/web test` one after the other (never together). Expected: green.

```bash
git add apps/web/inngest/functions/assembly-runner.ts apps/web/inngest/functions/assembly-runner.test.ts docs/superpowers/specs/2026-11-10-chapter-marking-design.md PROGRESS.md
git commit -m "feat(web): the assembly runner reads the chapter marking from the current bible; docs for decision 459"
```
