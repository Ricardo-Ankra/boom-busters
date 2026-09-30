# Visual board job state: say a job is running until it lands (decision 286)

Status: design approved in conversation 2026-09-30, section by section; this
document is for the owner's review before an implementation plan is written.

## 1. The problem

The owner, 2026-09-30, after the decision 285 audit: "I want to make sure
... that the user is getting proper feedback on the edits."

Decision 285 made every board button stay busy until its own server action
has returned and the refreshed card is on screen. For the actions that start
background work, that is not long enough. Regenerate, Fetch this slot, Save &
re-fetch, Redirect the scene, Re-plan, Fix, Redraft direction and Fetch
visuals each send an Inngest event and return within a second. Nothing
stored says the job is running, so once the toast fades the card looks
untouched and offers the same paid action again, while the job it started is
still working. A second press is not harmless: every one of these jobs runs
as a singleton in `cancel` mode, so it cancels the first run part-way and
starts again.

The worst case is Fetch visuals. The runner keeps `visuals_phase = 'plan'`
for the whole fetch pass and only moves to `'board'` when every slot has
resolved. For those minutes the plan screen still shows "Fetch visuals · est.
$…" and the editing controls. Pressing Fetch again sends
`visuals/fetch.resume` (the stage is no longer `awaiting_review`), and the
runner's singleton cancels the fetch in flight, cutting off any generation
that is part-way through and may already be billed.

A related hole exists today: Stop sends `project/cancelled`, which cancels
the slot jobs without running their `onFailure`, so a card stamped
`drafting` or `rebriefing` keeps saying so forever.

## 2. Goals and non-goals

Goals:

- From the moment a background job is started until it lands, the card or
  board it affects says what is running and how long it has been running,
  and does not offer the same work again.
- A job that dies without reporting never locks a card for good.
- Stop leaves no card claiming a job is running.
- The second-Fetch hole is closed.

Non-goals:

- A progress bar inside a single job. The fetch pass reports how many slots
  are still to land, because the model already counts them; nothing else
  reports progress.
- Changing the jobs' own behaviour, singletons or retries.
- Instant actions (choosing a candidate, uploads, brief saves in the plan
  phase). Decision 285 already covers them.

## 3. Decisions taken with the owner

- **Lock scope: the whole card.** While a slot job runs, every action on that
  card waits: a candidate chosen or a brief edited mid-regenerate would be
  overwritten when the new candidates land. Other cards stay usable.
  Plan-level jobs lock the whole board the same way.
- **Stuck jobs: unlock and say so.** A stamp older than 10 minutes stops
  locking. The card says it has been running longer than it should, may have
  stopped, and can be tried again. Trying again is safe because the
  singleton cancels the old run if it is somehow alive.
- **Storage: a stamp on the row** (approach A), the pattern the `drafting`
  state already uses. Rejected: reusing the `retype` column (a re-type's
  outcome and a refetch's stamp would overwrite each other, and Fix already
  skips slots whose retype says drafting), and deriving from the run mirror
  (best-effort by design: writes are dropped after 5 seconds, it sees nothing
  until Inngest starts the run, and it has shown zombie runs).

## 4. Data

One migration adds two nullable `jsonb` columns.

`shot_slots.pending_job`, a `SlotJob`:

```ts
{ kind: 'refetch' | 'redirect', jobId: string, startedAt: string /* ISO */ }
```

`projects.visuals_job`, a `VisualsJob`:

```ts
{ op: 'replan' | 'repair' | 'direction' | 'fetch', jobId: string, startedAt: string }
```

Both are Zod schemas in `packages/schemas` (beside `SlotDraftStateSchema`),
parsed with `safeParse` on read; a row that fails to parse reads as no job.
`jobId` is a fresh `newId()` (the monotonic ULID factory) per press.

The events that start these jobs gain an optional `jobId`:
`visuals/refetch.requested`, `visuals/redirect.requested`,
`visuals/replan.requested`, `visuals/plan.approved` and
`visuals/fetch.resume`. Optional so an event already queued when this ships
still parses; a job with no `jobId` releases nothing (the stamp's 10-minute
limit covers it).

`packages/db` gains four helpers:

- `setSlotJob(db, slotId, job)` and `setVisualsJob(db, projectId, job)`,
  which write unconditionally (the action's stamp).
- `releaseSlotJob(db, slotId, jobId)` and
  `releaseVisualsJob(db, projectId, jobId)`: one `UPDATE ... WHERE` the stored
  `jobId` equals the one given, so a job that finishes late never clears a
  newer press's stamp.
- `clearProjectJobs(db, projectId)`: every slot's `pending_job`, the project's
  `visuals_job`, and any slot `retype` in `drafting` or `rebriefing`, set to
  null. For Stop.

## 5. Who writes a stamp

Every write happens in the server action, before `inngest.send`, so the
refresh the button itself triggers already shows the job. If the send
throws, the action writes null back before returning its error.

| Action | Stamp |
|---|---|
| `sendRefetch` (all 12 callers: Regenerate, Fetch this slot, Save & re-fetch, cast link and unlink, format changes, …) | slot `refetch` |
| `redirectSceneAction` | slot `redirect` |
| `sendReplan` for `replanShotsAction`, `repairPlanAction`, `redraftDirectionAction` | project `replan`, `repair`, `direction` |
| `approvePlanAction` | project `fetch` |

## 6. Who clears a stamp

**The job, once, after its body returns.** In `slot-refetcher`,
`slot-redirector` and `visuals-replanner`, the existing handler body moves
into an inner async function. The handler awaits it, then runs one step,
`release-job`, calling the matching `release…Job` with the event's `jobId`,
then returns the body's result. This covers every return path (the
refetcher's success, refusal, linked-slot skip and budget stop; the
redirector's five; the re-planner's eight) without a clear at each one, and
a return added later cannot forget it. It is sequential code, not a wrapper
around the steps, so it behaves under Inngest's re-entry: the release step
runs only after every step of the body has completed.

**The job's `onFailure`**, with the same `jobId` check, after the existing
`markSideJobFailed`.

**Stop.** `cancel-reconciler` (the job `project/cancelled` triggers) calls
`clearProjectJobs`. This also clears the stuck `drafting` and `rebriefing`
stamps of section 1.

**Fetch visuals hands over.** The runner calls `releaseVisualsJob` inside the
existing `load-plan` step, right after `closeReviewGate` sets the stage to
`running`. From there the board reads "phase `plan` and stage `running` or
`queued`" as fetching, which needs no stamp and never goes stale: if the
runner fails, `onFailure` marks the stage failed. The runner's `onFailure`
also releases the stamp, for a failure before `load-plan`. Runs parked on the
plan before this deploy pick up the new call, because `load-plan` has not
run for them yet (the parked-run replay rule: new work goes inside a step
that has not executed).

## 7. The review model

`visualsReviewModel` already loads the project and the slot rows.

- `SlotView.job: { kind, startedAt } | null`, from `pending_job`.
- `VisualsReviewModel.job: { op, startedAt } | null`, from `visuals_job`.
- `VisualsReviewModel.fetching: boolean`: `phase === 'plan'` and the
  project's `stageStatus` is `running` or `queued`.

Staleness is not decided here. A job that dies sends nothing that would
refresh the page, so a card rendered at minute 3 would still be locked at
minute 30 if the server had judged it.

## 8. The board

A `useNow(15_000)` clock in `VisualBoard` re-renders every 15 seconds while
any stamp is on screen, and not otherwise. `JOB_STALE_MS = 10 * 60_000`.

**A slot with a live stamp** (younger than the limit):

- The slot lock (decision 285's `SlotLockContext`) reads busy, so every
  action on the card stands down. `pressed` is `regenerate` for a refetch and
  `redirect` for a redirect, so that button keeps spinning. When a brief save
  or a cast link started the refetch, Regenerate spins, because the card's
  fetch is what is running.
- A `role="status"` line under the card header: "Regenerating, started 0:42
  ago. The new candidates replace these when they land." In the plan phase:
  "Fetching this slot, started 0:42 ago. The card updates when it lands."
  For a redirect: "Redirecting the scene without the likeness, started 0:42
  ago."

**A slot with a stale stamp:** no lock. The line is amber: "This has been
running for 12 minutes, longer than it should. It may have stopped. You can
try again."

**The plan card and the board, during a plan-level job or the fetch:**

- A `role="status"` line at the top of the Shot plan card: "Re-planning the
  shot list, started 1:05 ago. The plan below is replaced when it lands.",
  "Fixing the flagged slots, started …", "Redrafting the direction, started
  …", "Sending the fetch, started …" (the stamp's few seconds), and while
  fetching: "Fetching visuals: 18 slots still to land." (`model.toFetch`).
- Every slot card is locked and the five plan-card actions are disabled; the
  one pressed (`plan`, `repair`, `replan`, `direction-redraft`) spins.
- A stale plan job behaves like a stale card: unlocked, with the amber line.
  Fetching never goes stale.

**Chapter tallies:** "drafting" becomes "in progress" and also counts live
refetch and redirect stamps; a stale stamp counts under "to look at".

When the job lands, the page refreshes as it does today (`LiveRefresh`
already polls while the run is live, and the run mirror moves the pulse), the
stamp is gone and the card unlocks. No toast: the new candidates are the
feedback.

## 9. Testing

- **`packages/db`** (integration, needs Docker's test DB): each writer; a
  release with the right `jobId` clears, a wrong one does not;
  `clearProjectJobs` clears both stamps and `drafting`/`rebriefing` retypes
  and leaves `refused` and `fix-note` alone.
- **`packages/schemas`**: the two job schemas and the optional `jobId` on
  each event.
- **Inngest functions** (existing test files): each function releases with
  its own `jobId` on success, on every early return named in section 6, and
  in `onFailure`; an event without `jobId` releases nothing; the runner
  releases in `load-plan`.
- **Actions**: the stamp is written before the send, with the same `jobId`
  the event carries; a failed send writes null.
- **Review model**: stamps pass through; `fetching` is true only for plan
  phase with a running or queued stage.
- **Board**: a live slot stamp locks the card, spins its button and shows the
  line; with fake timers past 10 minutes it unlocks and shows the amber line;
  a plan job locks every card and the plan buttons; fetching shows the count
  and locks; tallies count in progress and stale.
- **E2E**: the existing specs stay green. E2E runs without Inngest, so the job
  paths are covered by the suites above.

## 10. Build order and shipping

1. Schemas: the two job schemas and the optional event `jobId`.
2. DB: migration and the helpers.
3. Actions: stamps.
4. Jobs: release steps, `onFailure`, the runner's `load-plan`, the cancel
   reconciler.
5. Review model.
6. Board.

Shipping needs `db:migrate` against Neon before the Vercel deploy that reads
the columns, then the usual `PUT /api/inngest`. No broker or Remotion
redeploy: the render timeline does not change.

## 11. Failure behaviour

- **The send fails:** the stamp is written back to null and the action
  returns its existing error; the card never shows a job that was not sent.
- **The job never starts** (Inngest down, a wedged queue): the stamp goes
  stale at 10 minutes and the card says so.
- **The job fails:** `onFailure` releases it, and the existing side-job
  failure notice explains why.
- **Stop:** the reconciler clears every stamp on the project.
- **A job finishes after a newer press:** the `jobId` check leaves the newer
  stamp in place.
- **A stamp that fails to parse** reads as no job, so bad data can unlock a
  card but never lock one.
