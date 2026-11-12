# Script Craft Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three follow-ups parked at decision 464's final review. Script Studio's passage rewrite gets the dossier's scenes. A Shorts budget stop keeps the strip's notices. The craft-loop runner tests stop writing to the shared fixture project.

**Architecture:** Each is a small, independent change in its own commit. The scene read the runner already does moves into one app helper that both the runner and the regenerate action call.

**Tech Stack:** TypeScript, Inngest (`@inngest/test`), Vitest, Next.js server actions.

**Spec:** `docs/superpowers/specs/2026-11-10-script-review-and-craft-design.md`, sections 7 (one scene list for drafter and reviewer) and 10 (the scenes rule in the house style). The parked findings are in `PROGRESS.md`, decision 464, and its final review.

## Global Constraints

- Branch `script-craft-followups`, worktree `.claude/worktrees/script-craft-followups`, from `origin/master` at `294bc085`.
- Decision number 466 is provisional. At merge, compare with `origin/master` and renumber in a separate commit if it is taken.
- No migration, no stack deploy. Shipping is a Vercel deploy only. The runner's step names do not change, so `PUT /api/inngest` is a courtesy, not required.
- The lift fixture `script-regenerate.json` is regenerated once, in Task 1, and no other fixture may move.
- No live provider call in tests. Prompt text must carry none of `FINANCE_WORDS`.
- DB suites run against a private database (another session may share `boom_busters`). Create `boom_busters_followups` in the `boom-busters-test-db` container, migrate it, set `TEST_DATABASE_URL` in the process env, and drop it at the end.
- Run `pnpm format:check` on the touched files before every commit.

## Review Focus

1. **A project whose dossier is gone.** The regenerate action must still rewrite with `No scenes.`, never throw. Test in Task 1.
2. **A Shorts budget stop with nothing to say.** No repairs and no craft notices: the strip must not be cleared or written. Test in Task 2.
3. **The craft-loop suite run alone (`-t "the craft loop"`) on an unseeded database.** It must seed or create everything it needs. Test in Task 3 by running it that way.

---

### Task 1: The passage rewrite reads the scenes

**Files:**
- Create: `apps/web/lib/dossier-scenes.ts`
- Modify: `apps/web/inngest/functions/script-runner.ts` (delete the private `scenesFor`; import the helper)
- Modify: `packages/providers/src/prompts/script.ts` (`buildRegenerateRequest`)
- Modify: `apps/web/app/(console)/projects/[id]/actions.ts` (`regenerateSection`)
- Modify: `packages/providers/src/prompts/lift/__fixtures__/script-regenerate.json` (regenerated)
- Test: `packages/providers/src/prompts/script.test.ts`, `apps/web/app/(console)/projects/[id]/actions.test.ts`

**Interfaces:**
- Produces: `scenesForProject(projectId: string): Promise<string[]>` in `apps/web/lib/dossier-scenes.ts`. It has the body of the runner's current `scenesFor`: `getDossier`, then `sceneLines`, or `[]` with no dossier.
- Produces: `buildRegenerateRequest` input gains `scenes?: readonly string[]`. Its first message becomes `` `Claims:\n${claimList(claims)}\n\nScenes:\n${sceneList(scenes ?? [])}` ``, still the one cacheable prefix message.

- [ ] **Step 1: Write the failing tests.**
  - In `script.test.ts`: `it('gives the passage rewrite the scenes beside the claims')`: with `scenes: ['March 2001 — the board met.']`, the first message ends `Scenes:\n[S1] March 2001 — the board met.`. Without scenes, it ends `Scenes:\nNo scenes.`.
  - In `actions.test.ts` (the `regenerateSection` suite, live mode as its existing tests run it): `it('sends the dossier's scenes with the passage')`. Put a `## Timeline` bullet on the dossier, restored in `finally`. The first message `callLlm` receives contains `Scenes:\n[S1]`.
  - Also there: `it('rewrites with no scenes when the dossier is gone')` (Review Focus 1). Mock `getDossier` to resolve `null`, or use a project with no dossier row. The action returns `ok: true`, and the first message ends `Scenes:\nNo scenes.`.
- [ ] **Step 2: Run** `pnpm exec vitest run script.test` from `packages/providers` and `pnpm exec vitest run actions.test` from `apps/web` (private DB). Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Read the scenes in `regenerateSection` after the chapter is loaded and before the mock branch, beside the claims.
- [ ] **Step 4: Regenerate** `pnpm exec vitest run lift -u` from `packages/providers`. `git diff --stat` on `__fixtures__` must show only `script-regenerate.json`.
- [ ] **Step 5: Run** both test files, plus `pnpm exec vitest run script-runner` from `apps/web` (private DB). Expected: PASS.
- [ ] **Step 6: Commit** `fix(script): the passage rewrite reads the dossier's scenes, from one helper the runner shares (decision 466)`.

---

### Task 2: A Shorts budget stop keeps the strip's notices

**Files:**
- Modify: `apps/web/inngest/functions/script-runner.ts` (`markShortsStep`, the `BudgetExceededError` branch)
- Test: `apps/web/inngest/functions/script-runner.test.ts` (the `markShortsStep` suite)

**Interfaces:**
- `markShortsStep` writes the strip before it returns `{ ok: false, gate }` for a budget stop. It uses the same call as its other stop branch: `writeStrip(target, priorRepairs, priorNotices)`, made only when either list is non-empty. No stop notice is added: the budget gate on the stage already says why.

- [ ] **Step 1: Write the failing tests.** The existing `it('hands a budget stop back for the run to park, with no notice')` stays as it is (Review Focus 2: with no prior repairs or notices, `recordRepairs` and `recordStop` are not called). Add `it('keeps the outline repairs and the craft notices on the strip when the marking is over budget')`: given one prior repair and one `trimmed` notice, `recordRepairs` is called with both, `recordStop` is not called, and the result is `{ ok: false, gate }`.
- [ ] **Step 2: Run** `pnpm exec vitest run script-runner` from `apps/web` (private DB). Expected: the new test FAILS.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.
- [ ] **Step 5: Commit** `fix(script-runner): a Shorts budget stop keeps the outline repairs and the craft notices on the strip (decision 466)`.

---

### Task 3: The craft-loop tests own their project

**Files:**
- Modify: `apps/web/inngest/functions/script-runner.test.ts` (the `describeDb('the craft loop (decision 464)')` suite only)

**Interfaces:**
- The suite creates its own project in `beforeEach`, with `createProjectFromCase(db, { caseId: FIXTURE_CASE_ID, title: 'Craft loop test' })` after `seed(db)`, as `renameProjectAction`'s suite does in `apps/web/app/(console)/projects/actions.test.ts:358`. It also creates that project's own dossier row when a test needs scenes. `afterEach` calls `deleteProject(db, projectId)`.
- Every event, step mock and helper in the suite uses that `projectId`, not `FIXTURE_PROJECT_ID`. The scenes test edits only its own project's dossier, so its `finally` restore of the fixture dossier goes away.
- `seed(db)` upserts the fixture rows; it does not truncate. Check that before relying on it. If it does anything destructive, create the channel and case the project needs without it. The suite still never calls `truncateRunMirror`.
- The mocked `channelForProject`, `scriptableClaims` and `shortsEnabledForProject` keep working for the new id. Check that each mock ignores the id or is set up for it.

- [ ] **Step 1: Refactor the suite** as above. Keep every test's assertions unchanged.
- [ ] **Step 2: Run the suite alone** on a freshly created, migrated, empty private database (Review Focus 3): `pnpm exec vitest run script-runner -t "the craft loop"`. Expected: PASS.
- [ ] **Step 3: Run** the whole file, then `pnpm exec vitest run script-runner bible-researcher slot-rebriefer motion-exemplar-deriver` twice, then `pnpm exec vitest run inngest/functions` once, all from `apps/web` on the private DB. Expected: PASS each time.
- [ ] **Step 4: Commit** `test(script-runner): the craft loop suite owns its project and leaves the fixture alone (decision 466)`.

---

### Task 4: PROGRESS and verification

- [ ] **Step 1: Add the decision 466 entry to PROGRESS.md**, as the last numbered decision, in the shape of 464. Title it "**The craft loop's follow-ups**" (2026-11-12, branch `script-craft-followups`, no migration). Give it lettered lines:
  - (a) the passage rewrite reads the scenes from `scenesForProject`, which the runner now shares;
  - (b) a Shorts budget stop writes the outline's repairs and the craft notices before parking;
  - (c) the craft-loop suite owns its project;
  - (d) decision 464 (c), one notice per revised chapter, stays as decided.
- [ ] **Step 2: Verify**, one at a time:
  - From the root: `pnpm typecheck`, `pnpm lint`, Prettier on the touched files.
  - `pnpm exec vitest run` from `packages/providers`.
  - From `apps/web`, with the private DB: `lib`, `inngest/functions` and `components`, then `app` started deliberately in the background, since it runs past 600 s, with nothing else on that database until it reports.
  - e2e from `e2e` on the private DB with a fresh `E2E_PORT`: `writing-room`, `notices`, `pipeline` and `project-lifecycle`, with `--retries=1`.
- [ ] **Step 3: Commit** `docs: decision 466 in PROGRESS, the craft loop's follow-ups`.
