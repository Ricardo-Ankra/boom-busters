# Bible drafting: pre-merge review fixes

Status: written 2026-11-02 from the static pre-merge review of
`d66b4a5..8933e34`. The owner asked for these fixes before merging.

**Spec:** `docs/superpowers/specs/2026-10-28-channel-bible-design.md`, with
the plan it was built from, `docs/superpowers/plans/2026-10-29-channel-bible-drafting.md`
(its Global Constraints and Review Focus bind here too). VidIQ parts also
follow `docs/superpowers/specs/2026-10-28-vidiq-search-research-design.md`
section 5.

## Global Constraints

- Work on branch `bible-drafting` in `.claude/worktrees/bible-drafting`. Never commit to master, never push, never merge.
- No migration unless a task says so. JSON columns change by Zod schema only, and a new field on a stored shape is optional or has `.catch`/`.default` so rows written before it still parse.
- Boom & Busters byte-identical: nothing under `packages/providers/src/prompts/lift/__fixtures__/` changes. Never run Vitest with `-u` or `--update`.
- Mock providers only. No paid LLM or VidIQ call from code or tests.
- Inngest: anything new is read or computed inside a `step.run`, never from an earlier step's stored output (parked runs replay old step results).
- `'use server'` files export only async functions.
- A test that renders the whole `SettingsForm` mocks every tab's actions: `voice-tab.test.tsx`, `archived-settings.test.tsx`, `brand-look.test.tsx`, `models-tab.test.tsx`, `publishing-tab.test.tsx`, `youtube-outcome.test.tsx`, plus `workspace-form.test.tsx`.
- Every action is a visible labelled shared `Button` at its default size. UI copy: no em or en dashes, South African spelling.
- Before every commit: `git ls-files -z '*.ts' '*.tsx' '*.md' '*.json' | xargs -0 -n 80 pnpm exec prettier --check` (tracked files only), `pnpm lint`, `pnpm typecheck`.
- Single-file Vitest: `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and never run concurrently with another database suite. Every verification command runs in the foreground with the Bash `timeout` set to 600000, one package at a time; never a whole `pnpm test` in one call.
- A change to a shared schema (`packages/schemas`) runs every consuming package's suite (schemas, db, providers, web), one at a time.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The drafting job's lifecycle (stale runs, ownership, Try again)

Review findings 1, 2 and nit 1. Files: `packages/schemas/src/bible-draft.ts`,
`apps/web/inngest/functions/bible-drafter.ts`, `apps/web/inngest/functions/bible-researcher.ts`,
`apps/web/app/(console)/c/[slug]/settings/bible-tab.tsx`,
`apps/web/app/(console)/c/[slug]/settings/bible-actions.ts`, their tests.

Problems:
- `jobIsRunning` (bible-draft.ts:174-178) treats a job as dead 30 minutes after `startedAt`, which is set once. A full draft is 17 units with up to two model calls each, so a healthy run passes 30 minutes. Once stale: polling stops; the tab shows no progress, no error and no Try again (state is still `'running'`); the owner can edit, approve and save; the drafter keeps writing with `allowWhileRunning`, resets edited sections to `drafted`, and `finish` writes `done` over whatever job is current. A run cancelled in the Inngest dashboard (no `onFailure`) or a lost `bible/draft.requested` event shows the same blank state.
- `tryAgain` (bible-tab.tsx:106-115) redrafts the sections named in `draft.errors`, else all seven, with no steer. Failed jobs from `onFailure` or a failed `inngest.send` (bible-actions.ts:270-291) write no `errors`, so Try again redrafts the whole bible and overwrites hand-edited sections.
- `startBibleResearchAction` (bible-actions.ts:~144) and `draftBibleAction` (~236) call `openBibleDraft` before their refusal checks, so a refused action leaves an empty draft that shows Save and Discard and blocks History Restore.

Required:
1. `BibleDraftJobSchema` gains optional `heartbeatAt` (ISO datetime), `units` (the requested sections, for a draft job) and `steer` (string, optional). Old rows without them parse.
2. `jobIsRunning` measures 30 minutes from `heartbeatAt ?? startedAt`. Keep the 30-minute rule (plan Review Focus 4 requires it).
3. Every per-unit progress write in the drafter, and each step of the researcher that writes the job, refreshes `heartbeatAt`.
4. The drafter's `finish` step and its fail writer, and the researcher's equivalents, change the job only when the stored `job.startedAt` equals the `startedAt` of the job this run owns (read inside the step). A run that no longer owns the job leaves it alone, and a unit write from a run that no longer owns the job does not write its section.
5. `BibleTab` renders a job with `state === 'running'` that `jobIsRunning` rejects exactly as a failed job: the error line reads "The run stopped answering" and Try again shows. Editing stays locked only while `jobIsRunning` is true.
6. A draft job stores the requested `units` (sections) and `steer` when it starts. Try again on a failed or stale draft job resends exactly those sections and that steer. It never falls back to all seven sections; if a job has no stored `units` (written before this change), Try again resends the sections named in `draft.errors`, and with none, shows no Try again for that job but the per-section Draft buttons stay available.
7. Both actions run their refusal checks (cap, balance, Inngest available, validation) before `openBibleDraft`; a refused action leaves no draft row behind.

Tests: a heartbeat keeps a 40-minute-old job running; a job with no heartbeat for 31 minutes is stale; a stale job renders as failed with Try again; Try again sends the stored sections and steer; a run that lost ownership does not overwrite a newer job or a section; refused research and draft actions leave no draft.

### Task 2: VidIQ key verification and the credits ledger arguments

Review finding 3 and nit 5. Files: `apps/web/app/(console)/settings/workspace-form.tsx`,
`apps/web/app/(console)/settings/vidiq-connection.test.tsx`,
`apps/web/app/(console)/settings/workspace-actions.ts`,
`packages/providers/src/vidiq/client.ts`, `packages/providers/src/vidiq/shapes.ts`,
`apps/web/inngest/functions/bible-researcher.ts`, their tests.

Problems:
- `verifiable` in workspace-form.tsx:241-248 omits `vidiq`, so the Verify button never shows, although `verifiableKey` in workspace-actions.ts:153-168 has a `vidiq` branch (a free `balance()` call). The Task 3 test asserts "offers no Verify button for the VidIQ key yet".
- `VidiqError` is not a `PipelineError`, so `isRetriable` treats it as retriable and a wrong key reports "could not be reached" and never records `invalid`.
- `recordVidiqCredits` stores the method's arguments (`{ channel }`, `{ ids }`, bible-researcher.ts:166, 182) instead of what was sent (`{ channelId, videoFormat, popular }`, `{ videoIds }`). The VidIQ spec section 5 says the ledger records the tool and its arguments.

Required:
1. Add `vidiq` to `verifiable`; flip the test to assert the button shows and that pressing it calls the verify action.
2. The VidIQ client marks an authentication failure (HTTP 401 or 403 from the transport, or an MCP error that says unauthorised) so that verification records the key as `invalid` with a message saying the key was refused, and a network failure still reports it could not be reached. Use whatever the existing verify path uses for other providers' auth failures; do not invent a second mechanism.
3. Each `VidiqCall` result carries the wire arguments it sent (`args`), and the researcher records those in the ledger.

Tests: Verify button present for VidIQ; a 401 records `invalid`; a network error does not; ledger rows carry the wire arguments.

### Task 3: Language codes, the frozen-bible message, and moving a running project

Review findings 4, 5 and 6. Files: `packages/schemas/src/channels.ts`,
`apps/web/inngest/functions/publish-runner.ts`, `apps/web/inngest/lib/channel.ts`,
`apps/web/lib/bible-gate.ts`, `apps/web/app/(console)/projects/actions.ts`, their tests.

Problems:
- `bible.language` is `z.string().max(12)` (channels.ts:82) but goes to YouTube as a BCP-47 code (publish-runner.ts:372-387) and to VidIQ's `language`. A model-written "English" fails the upload.
- A project frozen to an incomplete bible version fails with "Complete the channel bible in Settings first" (channel.ts:17-21 with bible-gate.ts:6). After the owner completes and saves the bible, Restart fails again because the project still points at the old version.
- `moveToLatestBibleAction` (projects/actions.ts:114-137) is allowed while a stage is running; runners re-read the bible in every step, so a script stage could take its outline from version n and chapters from n+1.

Required:
1. `language` is trimmed and must be empty or match `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`. A stored bible that fails this must still parse on read (the strip-on-read schema used everywhere for stored bibles): an invalid stored value reads as empty, so the upload omits the language rather than failing. The drafting prompt or unit schema rejects an invalid value at write time so the model is retried.
2. The runner gate for a frozen project whose version is incomplete uses its own message that names the **Use the latest bible** button on the project page. The Settings-side gate keeps its current message.
3. `moveToLatestBibleAction` refuses with a clear message while the project's `stageStatus` is `'running'`; it is allowed while parked at a review gate, after a failure and when idle.

Tests: language validation (valid, invalid, trimmed, stored-invalid reads empty); the publish runner omits an empty language; the frozen-gate message; the move refused while running and allowed at a gate (in the existing `use-latest-bible` test file).

### Task 4: Restore race, list entries, preview requests, e2e setup cleanup

Review nits 2, 3, 4 and the e2e setup gap. Files: `packages/db/src/bibles.ts`,
`apps/web/app/(console)/c/[slug]/settings/bible-fields.tsx`,
`apps/web/app/(console)/c/[slug]/settings/bible-preview.tsx`, `e2e/global-setup.ts`, their tests.

Problems:
- `restoreBibleVersion` checks for an open draft with an unlocked read (bibles.ts:158-163), and `saveBibleDraft` never compares `draft.baseBibleId` with the channel's current version, so a draft opened at the moment of a restore can save over the restore silently.
- Hooks, openings and titles lists have no Add or Remove in the Bible tab (bible-fields.tsx:427-467), and blanking an entry's text is refused (`min(1)`), so a flagged entry can only be reworded or redrafted.
- `bible-preview.tsx:24-32`: a reply for the previous stage can land after a stage change, and every 3 s refresh during a run re-requests the preview.
- `e2e/global-setup.ts` deletes `bible_drafts` but not `vidiq_credits` before deleting the `e2e-second` and `third-channel` channels; `vidiq_credits.channel_id` is ON DELETE restrict, so one ledger row for those channels breaks every later e2e setup.

Required:
1. `saveBibleDraft` refuses, inside its transaction with the channel's row locked, when `draft.baseBibleId` is not the channel's current bible version, with a message telling the owner the bible changed since the draft opened and to discard and redraft. `restoreBibleVersion` takes the same lock before its draft check.
2. Each list (hooks, openings, titles) gets an **Add** button and a per-entry **Remove** button, within the list's schema limits (Add disabled at the max; Remove disabled at the min). Adding or removing marks the section `drafted` and recomputes its overlap flags the same way an edit does.
3. The preview ignores a reply whose request is older than the latest, and re-requests only when the stage or the bible content changes (key on a serialised bible), not on every poll.
4. `global-setup.ts` deletes `vidiq_credits` rows for those channels before deleting the channels.
5. (From the parent plan's Task 14 review.) `e2e/tests/bible.spec.ts` resets the `e2e-second` channel in a `beforeAll` of its serial group, with the same `resetSecondChannel` helper the setup uses, so a CI retry (`retries: 1`) does not rerun on dirty state.

Tests: save refused on a stale base (db integration test); restore under the lock; Add and Remove buttons and their limits; the preview drops a stale reply and does not re-request on an unchanged bible.

### Task 5: PROGRESS

Add one decision per ruling the fixes made (next free numbers after this branch's 358, checked against `origin/master`), tick the review fixes under the bible-drafting section, and add to "Owner actions at deploy": run, with the owner's permission, a read-only production query listing non-archived projects whose frozen bible version fails `isBibleComplete`, before deploying.

From the parent plan's Task 14 review: in the "Channel bible, drafting" section's "Owner actions at deploy", replace item 4 (it repeats Task 13's item 6: deploy media-utils then the broker for `categoryId`, `defaultLanguage`, `defaultAudioLanguage`) with a one-line pointer to that item 6. In master's playbook-shorts owner actions, mark migration 0041 done (applied on production 2026-11-02, 42 migrations verified) so both lists agree.
