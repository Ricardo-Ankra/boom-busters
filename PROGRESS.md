# Boom-Busters — Build Progress

Milestones follow `docs/03-build-spec.md` §14 and must be executed in order.
A milestone is not started until the previous one's tests are green in CI.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done (tests green)

---

## M1 — Skeleton

> Monorepo, env validation, auth (allowlist), DB schema + migrations + seed
> script, settings CRUD, app shell, first-run setup checklist, CI.

**Status:** `[x]` **done** — CI green, merged to `master` (2026-08-10)

### Deliverables

- [x] **Repo hygiene** — docs renamed to kebab-case, initial commit, `m1-skeleton` branch, pnpm 11.20 installed
- [x] **Monorepo scaffold** — pnpm workspace + Turborepo, `tsconfig.base.json` (`strict`), ESLint flat config (zero-warning), Prettier, `.gitignore`
- [x] **`.env.example`** — every spec §4 variable with placeholder values, no real secrets
- [x] **`packages/schemas`** — tiered env schema + `requireEnv`, `SettingsSchema` with defaults, ULID branded ids; zero `any`; 41 unit tests
- [x] **`packages/db`** — full spec §5 Drizzle schema (21 tables, one migration), `db:migrate`, `db:seed` fixture case + project, settings query helpers, AES-GCM credential crypto; 36 tests (26 unit + 10 integration)
- [x] **`packages/ui-tokens`** — spec §11.1 app design tokens (zinc/indigo, 8px grid, radius 8, Geist + JetBrains Mono, motion tokens); 21 tests including WCAG AA contrast in both themes
- [x] **Auth** — Auth.js v5 Google provider, hard one-email allowlist (`OWNER_EMAIL`), `proxy.ts` protecting every route, `MOCK_PROVIDERS=1` credentials path for dev/CI only
- [x] **App shell** — left rail (6 items), top bar (breadcrumb · active-runs · cost meter), Activity drawer, dark-default theming, route stubs
- [x] **Settings CRUD** — single-row settings read/write through `SettingsSchema`, tabbed UI (Models · Budgets · Brand Kit · Publishing · Connections), optimistic updates with rollback toast
- [x] **First-run setup checklist** — 5 deep-linking items with computed done-state, replaces the dashboard until complete
- [x] **CI** — GitHub Actions: lint, format, typecheck, migrate, seed, unit, E2E against a Postgres service container
- [x] **E2E** — 19 Playwright tests: auth redirect, first-run checklist, settings round-trip, 390px mobile pass, 40px hit-target audit, credential masking

### Commands that must work when M1 closes

- [x] `pnpm dev`
- [x] `pnpm test` — 125 tests across 4 workspaces
- [x] `pnpm e2e` — 19 tests, mock-provider mode
- [x] `pnpm db:migrate`
- [x] `pnpm db:seed`
- [x] `pnpm typecheck`
- [x] `pnpm lint`

### Verified

- **CI (GitHub Actions, run #4):** lint → format → typecheck → migrate → seed →
  131 unit/component tests → 19 Playwright tests, all green against a Postgres
  service container.
- **Locally against Neon:** migrate, idempotent seed, full suites, `pnpm dev`.
- `next build` produces a working production bundle with the proxy registered.

### Blocked on the human

- [x] **`DATABASE_URL`** — Neon (`eu`/`us-east-1`, pooled) plus `DATABASE_URL_UNPOOLED`
      for migrations.
- [x] **`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`** — Google OAuth client created; real
      sign-in verified on the production deployment
      (`https://boom-busters-web-rho.vercel.app`, 2026-08-10).
- [x] `OWNER_EMAIL` — `ricardo@ankra.solutions`. Sign-in must use that exact Google
      account; every other identity is refused.

---

## M2 — Orchestration spine

> Inngest wiring, run mirror + activity drawer, cost guard + Costs screen,
> notification plumbing, demo no-op pipeline with two fake gates proving
> park/resume/cancel on production infra.

**Status:** `[x]` **done** — CI green, merged to `master` (2026-08-10), and
proven on production infrastructure (2026-08-11).

### Verified

- **On production infra (2026-08-11):** the demo pipeline driven end to end
  against Inngest Cloud from the Vercel deployment, mirrored into Neon. The run
  trace reads `run.started` → `spend-demo-research-0` (a real reservation
  through the cost guard) → `gate.opened` → `gate.closed` → `gate.opened` →
  `gate.closed` → `run.completed`: park, resume, park, resume, complete. A
  separate `cancel-reconciler` run confirms cancellation on the same infra.
- **Locally against Neon:** `pnpm test` — 241 tests across 5 workspaces
  (schemas 74 · db 62 · cost 29 · ui-tokens 21 · web 55).
- **`pnpm e2e`** — 33 Playwright tests, mock-provider mode, including the
  project screens, the gate action bar, the Costs screen and a 390px pass.
- **`pnpm build`** — production bundle with `/api/inngest` registered.
- **The test-database guard works (2026-08-11):** with `TEST_DATABASE_URL` set
  to a Neon branch, a full `pnpm test` wrote its 4 runs and its ledger row to
  the branch and left production's rows untouched.

### Deliverables

- [x] **Error taxonomy (`packages/schemas`)** — `TransientProviderError`,
      `RateLimitError` (carries `retryAfterMs`), `ValidationError`,
      `ContentPolicyError`, `BudgetExceededError`, plus the `isRetriable()`
      predicate the runners' retry policy reads (spec §7)
- [x] **Event contracts (`packages/schemas`)** — every `project/*`, `gate/*`,
      `budget/*`, `render/*` and demo event as a Zod schema, one exported map,
      typed end to end into the Inngest client
- [x] **`packages/cost`** — price tables, `monthSpend` aggregate, `withCost()`
      budget guard with an advisory-locked reservation, kill switch
- [x] **Run mirror (`packages/db`)** — `runs`/`run_events` helpers written by
      Inngest middleware, so the drawer never depends on the Inngest dashboard
- [x] **Inngest wiring** — client with typed events, run-mirror middleware,
      `/api/inngest` serve route (signing-key verified, `maxDuration=300`)
- [x] **Demo pipeline** — no-op function with two gates, proving park →
      resume → cancel, plus the budget gate on `BudgetExceededError`
- [x] **Costs screen** — per-provider spend vs budget bars, per-project
      breakdown, filterable ledger, kill-switch toggle, budget editors
- [x] **Activity drawer** — live feed from `run_events` (steps, retries,
      fallbacks, spend)
- [x] **Top bar live** — active-runs indicator and month cost meter fed by the
      run mirror and the ledger instead of placeholders
- [x] **Project screens** — projects list with mini pipeline rail; project view
      with the stage rail, gate action bar (`Approve` / `Request changes`) and
      the two-step `Stop`
- [x] **Needs-you queue** — open gates, budget gates and failed runs as cards
      that deep-link into the review screen
- [x] **Notifications** — web push (VAPID) + optional Resend email on
      gate-open, run-failure and budget-gate
- [x] **Tests** — cost guard (cap edges, kill switch, concurrent reservation),
      Inngest harness (parking, budget gate, cancellation), gate helpers
      (resume), fan-out partial-failure thresholds, component and E2E
- [x] **Verified on production infra** — the demo pipeline driven end to end
      against Inngest Cloud from the Vercel deployment (2026-08-11), with the
      full park/resume/park/resume/complete trace in the run mirror.

### Blocked on the human

- [x] **`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`** — set in Vercel. Local
      development and CI use the Inngest Dev Server
      (`npx inngest-cli@latest dev`), which needs no keys.
- [x] **`INNGEST_SERVE_ORIGIN`** — set to the stable production alias. Vercel's
      per-deployment URLs sit behind Deployment Protection and answer Inngest's
      sync with a 302 to an SSO page; without this the SDK advertises one of
      those and every sync lands in "Unattached Syncs".
- [~] **Notification delivery is deliberately deferred** (decided 2026-08-11).
  The plumbing is built and tested; no keys are set, so `notify()` logs what
  it would have sent and carries on. Nothing depends on it — the Needs-you
  queue reads from the database and is always correct.

      **Email (Resend) is the channel to enable, not push**, and it lands as a
      final layer rather than now. Web push reaches a desktop browser that is
      running; on iOS it needs the site installed to the home screen as a PWA,
      which is not how anyone expects "push" to behave. Email reaches a phone
      with nothing installed.

      Revisit when waits get long enough to walk away from — M6 renders are the
      first real case. To enable then: `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL`,
      and optionally
      `pnpm --filter @boom-busters/web exec web-push generate-vapid-keys` for
      `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`.

---

## M3 — Writing room

> Case Library (+ suggestions), dossier-runner + review UI, script-runner +
> Script Studio (editor, warnings, diff regenerate, edit trail), model router
> with fallback.

**Status:** `[x]` **done** — merged to `master` (2026-08-11)

### Verified

- **`pnpm test`** — 531 tests across 6 workspaces (schemas 97 · db 113 ·
  providers 167 · cost 30 · ui-tokens 21 · web 103).
- **`pnpm e2e`** — 42 Playwright tests, mock-provider mode, including the Case
  Library triage flow and the dossier gate's approval blocker.
- **`pnpm build`** — production bundle, TipTap included.
- Not verified: the runners themselves end to end. `@inngest/test` cannot drive
  a run past a `waitForEvent` (decision 20), so `dossier-runner`,
  `dossier-reviser` and `script-runner` are proven the way M2's demo pipeline
  was — by running against Inngest Cloud from the deployment.

### Known gaps

- **Shorts candidates are generated and then discarded.** `script-runner`
  marks them, the gate card counts them ("5 Shorts candidates"), and nothing
  persists them — Script Studio is handed an empty array, so its panel says
  "None marked in this chapter" beside a gate that just claimed five. A model
  call is paid for on every script run and thrown away. This is the first
  thing to fix in M4.
- **The chapter outline does not drag-reorder.** Spec §11.3 asks for it;
  selection and per-chapter runtime are built, reordering is not.
  (An earlier note here claimed reordering would invalidate the `claim_ref`
  sentence hashes. That is wrong: refs key on `chapterId`, which reordering
  does not change. The real costs are smaller — the `(scriptId, index)` unique
  index needs a two-phase swap, and reordering does not rewrite the prose
  seams the sequential drafting created.)
- **The one-click "insert 'alleged'" fix prefixes rather than placing the hedge
  mid-sentence.** An awkward hedge beats a fix that silently does nothing, but
  a human will often prefer to edit by hand.

**Spending:** every provider call is mocked by default (`MOCK_PROVIDERS=1`).
Real API calls happen only when the human explicitly asks for a live run
(CLAUDE.md rule 6), so this milestone can be built and tested end to end
without spending anything. **The Vercel deployment is not mocked** — it has no
`MOCK_PROVIDERS`, so every run there is real spend against the caps.

### M3.1 — what the first live walkthrough found (2026-08-11)

Five faults, four of them one fault. Recorded in full because the pattern
matters more than the fixes: **every one was invisible to the test suite
because the suite only ever drove the middle of a project's life.**

Global setup parked the seeded fixture at the dossier gate with a live run
behind it, and every project test opened that fixture. Nothing ever loaded the
screen a human meets _first_.

1. **The project screen offered "Start demo pipeline" as its only button.** M2
   scaffolding that nothing removed when the real runners arrived. Research
   already begins on `project/created`, so the only start-shaped control on the
   screen started a _second_, no-op run — which then opened and closed genuine
   review gates on a genuine project. The production run mirror shows four
   `demo-runner` rows racing the real ones on a single project.
2. **Approving a demo gate sent the script runner after a dossier that was
   never written** — `The dossier is gone, so there is nothing to script from`,
   four times.
3. **A stopped or failed project had no way back.** Its only button was the
   same demo pipeline, so "press Stop" was a one-way door.
4. **The gate bar's "Handed to the pipeline" note never cleared.** It was a
   boolean with no reset whose only escape was unmounting — which needed the
   server to be observed with no gate open. A stale demo run held the project
   at `awaiting_review` straight across the dossier-to-script handover, the
   three-second poll never caught the one-second gap, and the script gate
   inherited the dossier's flag. A finished script arrived with no Approve and
   no Request changes.
5. **A truncated completion was reported as malformed JSON.** Independent of
   the above: the adapter catches a completion with _no_ text, but one cut off
   mid-object fell through to the parser, which blamed the prompt instead of
   `maxTokens`.

**Fixed by:** `projectControl()` — one pure, exhaustively tested function that
answers "what does this header offer, and why" for every (stage × status ×
live-run) combination; a real `restartStage` action re-entering `dossier` on
`project/created` and `script` on `gate/dossier.approved`; the hand-off note
keyed to the gate it belongs to, with a manual escape and a 30-second expiry;
`stopProject` sending before it stamps, so a stop that failed is not reported
as a stop that worked; and `startProjectFromCase` marking a project `failed`
when the event could not be sent, rather than leaving it `queued` and looking
like it is on its way.

**The demo pipeline is unregistered** (`apps/web/inngest/functions/index.ts`).
Removing the button was not enough: `demoPipeline` waits on the same
`gate/dossier.approved` and `gate/script.approved` events the real runners do,
so a demo run already parked on a real project would resume on that project's
next approval — and its `finish` step drops the project straight to `done`.
Production had exactly that: a stale `demo-runner` parked at the script gate of
a project whose real script was written and waiting for review. Unregistering
archives it on the next Inngest sync, which is what stops those parked runs
resuming at all.

The function and its tests stay in the tree, so `pnpm test` still exercises the
orchestration spine end to end. Its production proof is the M2 trace above, and
that stands.

**And the suite now covers the beginning of a project's life:**
`e2e/tests/project-lifecycle.spec.ts` drives a fresh project, a project created
from a case, and a stopped project, asserting in each that no start-shaped
button exists and that a stopped stage always has a way back. Global setup
seeds the two extra states — and `deleteProjectsExcept` clears them, because
they hang off the _fixture_ case that `deleteCasesExcept` deliberately keeps,
so without it they accumulated two per run.

### Deliverables

- [x] **`packages/providers`** — the `LLMProvider` interface, three adapters
      (Anthropic, OpenAI, Google) normalising messages/batch/caching behind one
      `LLMTask` shape, each exposing its known-model list and price table, plus
      a deterministic mock adapter used by every test
- [x] **Model router** — resolves `task → {provider, model}` from settings at
      call time; on `overloaded`/5xx after retries falls back one tier down
      within the provider, then to the configured cross-provider chain; every
      downgrade written to `run_events` so the UI can show "written with
      fallback model"; a task whose provider has no working key fails at
      pre-flight with a `ValidationError` pointing at Settings → Connections
- [x] **Case Library** — sortable table, `Suggest cases` streaming proposals
      into draft rows, per-row `Accept` / `Dismiss`, `New project` from a
      shortlisted case
- [x] **dossier-runner** — research passes (brief → timeline → claims with
      sources) → dossier + claims rows → gate, with a revision step on
      `gate/dossier.changes_requested`
- [x] **Dossier review UI** — two-pane document + claims table, source
      favicon/domain, type and confidence chips, quarantine, unverified claims
      amber and floated to top, approve blocked while any claim is neither
      verified nor quarantined
- [x] **script-runner** — outline → chapters drafted sequentially (each step
      fed the outline, previous chapter tail and only non-quarantined claims)
      → self-check pass writing `claim_refs` and gutter warnings → Shorts
      candidate marking → gate
- [x] **Script Studio** — outline column, markdown-backed editor, context panel
      (claim popovers, warnings, Shorts segments), gutter markers with one-click
      fixes, select → `Regenerate…` → diff with per-hunk accept/reject,
      autosave with visible saved state, every human edit written to
      `script_edits`
- [x] **Tests** — router fallback and pre-flight, adapters against recorded
      fixtures, claim quarantine exclusion, self-check warning generation, the
      diff/hunk logic, component tests per screen, E2E through the writing room

---

## M3.2 — Stage navigation and staleness

> Make the pipeline rail navigable, let any completed stage be read and re-run
> from anywhere, and model what a re-run invalidates downstream.

**Status:** `[x]` **done** (2026-08-12) — inserted before M4 by decision.

### Why here, and not later

Two of these are corrections, not new scope. Spec §11.3 says the rail's
segments are **clickable** and they were built as plain `<div>`s — an M2
deliverable ticked off with only its display half done. And `restartStage` can
only re-run the stage a project is _currently_ on, so once a project reaches
`script` its dossier is unreachable: there is no "go back".

The third is genuinely new. Spec principle 5 ("every pipeline step can be
re-run without side effects or double spend") is about idempotency, not about
what a re-run _invalidates_. Nothing models staleness.

It goes before M4 because **voice is the first stage that produces expensive
artefacts**. A staleness model built after there are takes and renders to
protect is a model retrofitted onto exactly the thing it exists to protect.

### Decisions made

- **Downstream work is kept and marked stale, never deleted** (decided
  2026-08-12). A re-run of the dossier leaves the script readable, badged
  "written from an older dossier", with its own re-run button. The alternative
  — deleting downstream artefacts on re-run — makes a mis-click destroy paid-for
  work with no way back. Branching the whole project into versions was
  considered and rejected as far more change than the problem needs: every table
  would grow a version axis to solve a problem that only exists across stage
  boundaries.
- **Staleness is derived, not stored.** Each artefact records the version of the
  input it was built from (`scripts.built_from_dossier_version`), and stale-ness
  is that number differing from the current one. A stored `isStale` flag would
  be a second version of the truth that nothing keeps in step.
- **The rail stops deriving state from position.** `segmentState` called every
  stage before the current one `approved`, which cannot represent "the dossier
  is done, and the project has gone back to it" or "the script exists but the
  project is on dossier again". It is given what each stage actually has.

### Deliverables

- [x] **Schema** — `dossiers.version`, `scripts.built_from_dossier_version`,
      migration `0005`, applied to production 2026-08-12
- [x] **Versioning in `packages/db`** — `saveDossier` bumps the version in the
      same statement as the write; `createScriptVersion` stamps the dossier
      version it is about to be written from
- [x] **Staleness model** — `apps/web/lib/stage-view.ts`, one pure function
      mapping (project, dossier, script) to per-stage state, with the shape
      M4-M7 extend
- [x] **Navigable rail** — every stage with something to show is a link; the
      segment on screen is `aria-current`; stale stages carry their own state
      and their own icon
- [x] **Read any stage from anywhere** — `?stage=` on the project screen,
      no gate bar outside the current stage, and a banner saying which stage you
      are reading and which the project is on
- [x] **Re-run any completed stage** — `restartStage(projectId, stage)`, with a
      confirm that names the downstream stage by name and says it is kept
- [x] **Tests** — 17 staleness unit tests, 8 rail component tests, 9 E2E across
      navigation and staleness

### Verified

- **`pnpm test`** — 593 tests across 6 workspaces (schemas 97 · db 124 ·
  providers 179 · cost 30 · ui-tokens 21 · web 142).
- **`pnpm e2e`** — 58 Playwright tests, run twice to catch state leaks.
- **Production migrated** (2026-08-12): both columns present. Existing scripts
  carry `built_from_dossier_version = null` and are reported as
  `unknown-provenance` — "which dossier this was written from is not recorded"
  — rather than being assumed current. That is the honest reading and it is why
  the column is nullable rather than defaulted to 1.

### Two things the new fixture found on its first run

Both were live defects, neither had anything to do with staleness, and both
were invisible until an E2E opened a Script Studio that had chapters in it:

- **The chapter reorder buttons were 32px**, against the 40px minimum in spec
  §11.1. Stacked vertically they could not be made compliant without an 80px
  column beside a shorter row, so they are side by side now.
- **The rail called an outdated stage "approved"** when the project was sitting
  on it. True and misleading together: it _was_ approved, and what it was
  approved against had been replaced. Staleness now overrides `approved` and
  nothing else — a running or failed stage is describing something happening
  now, which matters more.

---

## M3.3 — Deleting a project, and three UI corrections

**Status:** `[x]` **done** (2026-08-12).

Project deletion was in no milestone. The spec's only danger-zone action is
cancel-all-runs (§11.3), so the ability to remove a project you have decided
against did not exist anywhere on the roadmap.

### Decisions made

- **A hard delete, not an archive** (2026-08-12). A project you have abandoned
  is clutter on the one screen you use to see what needs you, and an archive
  nothing can filter is a second list nobody reads. This follows `deleteCase`:
  destroy when nothing depends on it, refuse when something does.
- **The spend survives.** `cost_ledger.project_id` is `set null`, so deleting a
  project leaves its ledger rows attributed to no project. A Costs screen that
  got cheaper whenever you tidied up could not answer "what has this channel
  cost me", which is the only question it exists for.
- **The case survives.** A case is a story worth telling; abandoning one attempt
  at it does not retract that. It simply reads as having nothing produced from
  it, and becomes startable again.
- **Two refusals, both about incoherence rather than loss.** A live run, because
  its next step would write against a project row that no longer exists. And
  anything published: `publish_records` is polymorphic, so no foreign key stops
  a delete stranding a row that points at a live YouTube video.

### Deliverables

- [x] **`projectDeletionSummary`** — counts what would go (claims, chapters,
      runs) and what it cost, so the confirm names it. "This cannot be undone"
      is a warning nobody can weigh
- [x] **`deleteProject` + `deleteProjectAction`** with both guards
- [x] **A delete control** at the foot of the project screen, a long way from
      Approve, replaced by an explanation while a run is live
- [x] **Tests** — 8 db integration tests (cascade, ledger survival, case
      survival), 2 E2E

### Three UI corrections shipped alongside

- **The rail spun when nothing was running.** `stageStatus` reads `running`
  from the moment a runner sets it until something sets it otherwise, which
  includes every run that failed, was cancelled or was superseded — so a project
  untouched for a day still turned a spinner. The spinner is now spent only on a
  run the mirror can see; the current stage otherwise stays accent-coloured and
  still. `isMoving` was wrong the same way and polled forever on it.
- **The gate action bar was moved out of the sticky footer**, up beside `Stop`
  and the re-run controls. This is a deliberate deviation from spec §11.3
  ("sticky gate action bar (bottom)"): on the dossier it was fine, but on the
  Script Studio it permanently covered the last lines of the chapter you were
  reading — a control bar competing with the content it acts on, on the one
  screen whose whole job is reading.
- **The chapter reorder chevrons are gone.** They were redundant — the rows
  were already draggable — and once widened to the 40px minimum they overflowed
  the narrow outline column into the editor beside it. Replaced by a single grip
  handle with a visible instruction, a drop-target ring, and arrow-key support,
  because spec §11.1 rules out anything reachable by pointer alone and drag is
  exactly that.

### Verified

- **`pnpm test`** — 604 tests across 6 workspaces (schemas 97 · db 132 ·
  providers 179 · cost 30 · ui-tokens 21 · web 145).
- **`pnpm e2e`** — 60 Playwright tests, run twice.

---

## M3.4 — Fixtures built from production, not from assumptions

**Status:** `[x]` **done** (2026-08-12).

Four consecutive rounds of live defects had the same cause, and it was not any
of the individual bugs: **every fixture was designed from what a project was
expected to look like.** The seeded project sat at a gate with a live run —
the middle of a project's life — and nothing else existed. So nothing tested
the beginning, the dead ends, or the densities.

`pnpm survey` now answers "what states has production actually produced",
read-only against the live database. It is meant to be run before designing
fixtures for a milestone and after any walkthrough that turns something up:
read the output, find a row the fixtures cannot produce, add it.

### What the first survey found

Two live bugs, neither previously visible:

- **A script stage could be re-run with no dossier behind it.** The script
  runner's first step loads the dossier and gives up without one, so the button
  could only ever fail — and did, in production, on `load-dossier`. Both the
  action and `projectControl` now require the inputs a stage runs _from_ to
  exist. `ControlInputs.hasDossier` is required rather than defaulted, because
  defaulting it true is precisely the assumption that shipped the bug.
- **`OutlineChapterSchema.targetWords` rejected on `min(200)`.** `targetWords`
  is a hint that sizes a prompt and a token budget, not a contract, and a short
  closing chapter is a reasonable thing for a model to plan. Rejecting binned
  the whole outline and paid for the pass again — the run mirror holds three
  consecutive Opus outline calls thrown away on `targetWords: Too small`. It is
  clamped into [120, 4000] now, which costs nothing and loses nothing.

### Fixtures rebuilt from real shapes

- **The seeded dossier carries 19 claims, in production's proportions** — 11
  single-source from a major outlet, 6 corroborated, 1 from a regulator, 1
  unverified — instead of one tidy example per confidence level. The
  proportions are the point: most of what a model returns is single-source
  reporting, so the review screen's real job is triaging a long list. Exactly
  one blocker remains, because that is the state the gate must show.
- **A project past the last runner that exists** (`voice`/`running`, no live
  run) — approved through the script gate into a stage M4 has not built.
- **A project on the script stage with no dossier**, the shape that produced
  the re-run bug above.
- **A chapter carrying 22 warnings across all three kinds**, which is
  production's densest. Fixtures with two clean chapters never showed whether
  the gutter survives that.

### Verified

- **`pnpm test`** — 609 tests across 6 workspaces (schemas 100 · db 132 ·
  providers 179 · cost 30 · ui-tokens 21 · web 147).
- **`pnpm e2e`** — 65 Playwright tests, run twice.

---

## M4 — Voice

> TTS adapters (Gemini batch, ElevenLabs), voice-runner, review UI with
> retakes, phoneme hints, idempotent takes, voice-audition panel in Settings.

**Status:** `[x]` **done** (2026-08-12)

### Deliverables

- [x] **TTS layer (`packages/providers/src/tts`)** — one `TTSProvider`
      interface, Gemini and ElevenLabs adapters, a deterministic mock, and the
      registry that swaps them on `MOCK_PROVIDERS=1`. Prices live on the
      adapters and `packages/cost` derives `TTS_PRICES` from them (decision 23)
- [x] **Audio, in pure TypeScript** — PCM in, WAV out, duration from the byte
      count and a 160-bucket waveform from a scan. No FFmpeg, no decoder, no
      binary dependency
- [x] **Phoneme hints** — a channel-wide list on `settings.tts`, matched
      whole-word per paragraph, rendered as prompt instructions for Gemini and
      inline `<phoneme>` markup for ElevenLabs
- [x] **Idempotent takes** — `takeIdempotencyKey(projectId, chapterId,
paragraphIndex, textHash, voiceId)`, and a `claimTake` that reserves the
      row in one statement before anything is bought
- [x] **`voice-runner`** — pre-flight, fan-out TTS in bounded batches, the 15%
      partial-failure policy, gate
- [x] **`voice-retaker`** — its own function on `voice/retake.requested`, so the
      main run stays parked while a listen-through produces a dozen retakes
- [x] **Voice review UI** — chapter accordion, waveform strip, duration, take
      number, status chip, `Play`/`Flag`, 1×/1.25×/1.5×, continuous
      listen-through that scrolls the playing row into view, coverage bar, A/B
      toggle between takes
- [x] **The zero-flagged gate rule**, enforced in `approveGate` server-side and
      not only by a disabled button
- [x] **Settings → Voice** — audition panel (through `withCost`), the narrator,
      and the pronunciation editor. Spec §11.3's lock and its typed
      `CHANGE VOICE` unlock were built, used, and removed — decision 57.
- [x] **Voice staleness** — `voice_takes.built_from_script_version`, migration
      `0006`, and `voiceView` in the stage model, which inherits the script's
      staleness as well as carrying its own
- [x] **Tests** — 23 schema, 71 provider, 16 db integration, 60 web unit and
      component, 6 E2E

### Decisions made

37. **Gemini TTS uses the synchronous endpoint, not the batch API.** Spec §6
    says "Gemini adapter uses the batch API", under the general rule "batch APIs
    where latency is irrelevant". For narration latency is _not_ irrelevant — a
    human is waiting at the voice gate, and batch turnaround is hours. Taking it
    would mean approving a script on Monday and being offered its audio on
    Tuesday, to save roughly fifteen cents a video. It would also need a
    submit → `step.sleep()` → poll state machine per paragraph to satisfy the
    step-duration rule (§7), where fanning out sixty short synchronous calls
    gets the same throughput with none of it. Revisit if TTS spend ever becomes
    material against the cap; only `gemini.ts` changes.

38. **Adapters return raw PCM; the container is written once, above them.** Both
    vendors will emit 16-bit mono PCM when asked, so a WAV is a 44-byte header,
    the duration is a division and the waveform is a scan — no decoder and no
    FFmpeg in the web layer. Two adapters each writing their own header would be
    two chances to disagree about how long a paragraph is.

39. **The web layer holds audio bytes, briefly, and this is a deviation.**
    Design principle 2 says "the web layer never streams, transforms or holds a
    video/audio byte; all media flows R2/S3 ↔ Lambda". The Lambda it means —
    media-utils, with its FFmpeg layer — is deployed in M6. The choice was to
    hold a paragraph of narration for as long as a `PutObject` takes, or to
    defer the whole voice stage to M6 and reorder the milestones. The part of
    the principle that actually protects the app is kept intact: the browser is
    never handed bytes, only a presigned URL it fetches from R2 itself.

40. **Loudness normalisation is not done, and says so.** §7.3 has the runner
    normalise each chunk to -16 LUFS in media-utils. That needs FFmpeg, so it
    waits for M6 — and rather than leave the gap in a document, the runner
    writes a `step.skipped` run event on every voice run. It shows up in the
    activity drawer, which is where somebody will actually see it.

41. **Gemini spend is attributed to `google`.** "Gemini" is a model line, not a
    vendor: the TTS endpoint takes the same API key as the Gemini text models,
    on the same billing account. `TTS_CREDENTIAL_PROVIDER` maps it, so narration
    lands under the cap that key already has rather than in a second budget for
    one bill.

42. **The ElevenLabs pronunciation-dictionary endpoint is not used.** §6 names
    it. A dictionary is an account-level resource that must be created,
    versioned and referenced by id — three round trips and a piece of vendor
    state to keep in step with a list a human edits in Settings. Inline markup
    says the same thing per request, needs nothing stored anywhere, and is a
    pure string function this package can test. Revisit if a hint list ever
    grows large enough to matter per request.

43. **A retake never destroys the take it replaces.** Take numbers accumulate
    under one idempotency key; the review row A/Bs between them. A retake you
    like less than the original is a real outcome, and without the earlier take
    there is no way back from it. Only the highest take number counts as
    current, which `latestTakes` in `packages/schemas` decides — one function,
    so the runner, the gate and the screen cannot disagree about which audio is
    the one that will be assembled.

44. **Mock takes carry a `mock://` key rather than a plausible one.** A
    `MOCK_PROVIDERS=1` run has no bucket, and writing a real-looking
    `boom-busters/…` path that points at nothing is the kind of thing that gets
    discovered three milestones later, at assembly. Marked keys mean the audio
    route regenerates the bytes deterministically instead — which is what lets
    an E2E actually press Play.

### M4.4 — the Voice screen, audited (2026-08-13)

Four faults found by using it, all of them mine and all of them the same shape:
a screen built by someone who knew what the code did rather than by someone
trying to choose a voice.

53. **Choosing a voice locked it, so the second press failed.** Spec §11.3 says
    "choosing writes and locks the Brand Kit voice", and taken literally that
    makes the *first* press a trap: press one voice, and every other voice
    answers "Could not choose that voice — the narration voice is locked", with
    the unlock ritual in a section further down the page. Auditioning is
    inherently comparative. Choosing now selects and nothing more; **Lock this
    voice in** is a separate, deliberate press. §10's purpose survives — a brand
    asset that cannot be swapped by accident once the channel is producing —
    without the console trapping you the first time you use it.

    **Superseded by decision 57**, which deletes the lock outright. Half-fixing
    it here was the mistake: the argument that the lock should not fire on the
    first press is the same argument for it not existing.

54. **Leaving the screen meant paying to hear the same voice again.** The cache
    lived in React state and died with the page, which is exactly the moment you
    leave and come back to compare. Auditions are cached server-side now
    (`voice_auditions`, migration `0008`), keyed by provider, voice and sample,
    pruned to the most recent 120 — comfortably more than one provider's
    catalogue. §10.1 puts these in R2 and the adapter writes them there when
    storage is configured; this is where they live until it is.
    `MAX_SAMPLE_CHARS` dropped from 600 to 280 at the same time: two sentences
    is what you actually listen to before deciding, and it halves both the cost
    and the stored bytes.

55. **"Delivery direction" did nothing on Cloud TTS.** `stylePrompt` is read by
    the Gemini adapter alone — Cloud TTS is a speech service with no prompt
    steering, and ElevenLabs applies its own voice settings instead. The field
    was a live-looking control that changed nothing on the provider actually in
    use. It is shown only where it works; elsewhere the screen says plainly
    what does shape the delivery (the voice, the pacing, the punctuation).

56. **The sections were in the wrong order.** Narrator → pronunciation →
    audition put the panel that *chooses* a voice below two panels describing
    one you had not chosen yet, and asked for pronunciation hints for a narrator
    that did not exist. It reads audition → narrator → pronunciation now, which
    is the order the work happens in.

### M4.5 — the lock, deleted (2026-08-13)

Decision 53 kept the lock and made it deliberate. That was still one concept too
many, and the human said so plainly: *"the selecting and unselecting of a voice
and locking in a voice is just so overcomplicated and unnecessary."* They are
right, and the reasoning in 53 should have carried all the way.

57. **There is no voice lock, in the schema or the UI.** Spec §4 lists
    `locked: boolean` on `settings.tts`, §11.3 has choosing write *and* lock it,
    and §10 has the unlock ritual with `CHANGE VOICE` typed out. All of it is
    gone: `VoiceConfigSchema` has no `locked` field (Zod strips it from any row
    that still carries one), `lockVoice`/`unlockVoice` are deleted, and
    `chooseVoice` no longer refuses.

    The lock was protecting a single-user console from its single user. Every
    time it fired, it fired on the person it belonged to — and it fired on the
    screen whose entire purpose is trying voices against each other. The risk it
    named is real (swap the narrator mid-channel and every earlier video sounds
    like a different show) but the mitigation for that is *saying so*, which the
    narrator card now does, next to a plain statement of which voice is current.
    A modal ritual is what you build when other people can reach the setting.

58. **Play and Add voice are separate buttons on each card.** The card used to
    *be* the button, so listening and choosing were the same press and you could
    not hear a voice without adopting it. Now the card is a card: name and
    description on the left, **+ Add voice** in the top-right corner, and a full
    width **Play** below it whose label carries the price before the press
    (§11.1). Only Play spends. Adding is a radio rather than a checkbox — there
    is one narrator, so adding a voice drops the previous one and there is
    nothing to untick, which is what removed the "unselecting" the human was
    complaining about.

    The grid went from four columns to three to give the two buttons room.

59. **A settings write must go through `commit`, not through a server action and
    `router.refresh()`.** `Add voice` shipped as its own action that wrote
    `settings.tts` and refreshed — and the card did not change until the page
    was reloaded. `SettingsForm` holds the settings in `useState`, seeded once
    from `initialSettings`; refreshing re-renders the server component, which
    hands down a new prop that the already-mounted state ignores. Every control
    on the screen that *did* update instantly was going through the optimistic
    `commit` from M1, and the voice was the one that had grown its own path.

    `chooseVoice` is deleted. There is now one way to write a setting from this
    screen, which is also the way that rolls back with a toast when the write is
    refused.

    Guarded by `voice-tab.test.tsx`, which renders `SettingsForm` rather than
    `VoiceTab` — the fault was in who owns the state, so a panel tested in
    isolation with a stub `commit` passes every assertion in that file while the
    browser still shows the old narrator. Confirmed by reverting `add` to the
    server-only write: three of the six fail.

### M4.6 — narration that was paid for and thrown away (2026-08-13)

Reported as *"the audio generated is not speech, it's just random sounds"* on
project `0PRJECT0000000000000000001`. It was not a codec, a sample rate, or the
X-SAMPA work. The audio was real and it no longer exists.

**How it was established, because guessing is what caused it.** `.env.local`
carries `MOCK_PROVIDERS="1"`, which looks like the whole answer and is not: the
cost ledger shows `tts.google-cloud-tts` at $0.0103 for 345 characters and
$0.0138 for 460, which is exactly Chirp 3 HD's $0.03/1k. The mock's rate is
$0.015/1k and would have written half those figures. So the live adapter ran —
almost certainly from the Vercel deployment, where `.env.local` does not apply.
Confirmed independently against `voice_takes.waveform`, which is computed from
whatever PCM the adapter returned: the stored peaks vary like speech
(`63, 74, 90, 77, 72, 20`) while the mock's are pinned near 28 by its fixed
7,000-amplitude envelope, and the durations disagree by seconds (24,644 ms
stored against 21,000 ms for the mock).

60. **`mock://` meant two different things, and the two halves of the app read
    different ones.** The runner chose the key by *bucket*:

        const key = storageConfigured() ? (await putObject(...)).key
                                        : mockVoiceTakeKey(take.id)

    while the audio route reads it by *provider* — any `mock://` key is a mock
    take, so it regenerates the bytes from `mockNarrationPcm`. With live
    providers and no `R2_*` configured the two disagree, and every paragraph was
    synthesised by Google, charged, discarded unstored, and played back as the
    mock's 90–150 Hz tone bursts. The waveform strip above the player was drawn
    from the real narration, so the screen looked correct while the speaker did
    not — which is why this survived a green suite and a live walkthrough.

    `mock://` now means one thing: the mock made this. `takeStorage()` returns
    `'r2' | 'regenerated'` and **throws** for live-providers-with-no-bucket,
    because that is a configuration error and not a fallback.

61. **The refusal happens at pre-flight, not at the store.** Both runners call
    `takeStorage()` before the first claim — the runner beside `requireTtsKey`,
    the retaker before it burns a take number. Spec §6's "fail at the key, not
    mid-pipeline" is the same argument: a missing bucket will not fix itself
    between retries, and each retry of the voice stage is another sixty paid
    calls. The message names both ways out, R2 or `MOCK_PROVIDERS=1`, because
    the cheap one should not need discovering.

62. **The existing takes say what happened rather than impersonating audio.**
    Their bytes are gone and cannot be recovered. Rather than keep serving tone
    bursts, the route answers 409 with the reason whenever a `mock://` take is
    read while providers are live.

    Covered by `lib/storage.test.ts` over all four combinations of bucket ×
    provider. Not covered: the runners' call into it — `@inngest/test` cannot
    drive a voice run (decision 20), so that wiring is one reviewed line.

### M4.7 — the flag that bought nothing, and the pause control I said did not exist (2026-08-13)

Started from a question — *"if I flag a paragraph and suggest changes, how will
the voice regenerate?"* — whose honest answer was: it won't.

63. **Flagging is a verdict and no longer spends.** Spec §11.3 has flagging
    "enqueue the retake immediately", and it did: `flagVoiceTake` sent
    `voice/retake.requested`, the retaker re-synthesised the same text in the
    same voice at the same rate, and the note explaining what was wrong was
    stored on the row and never sent anywhere. On Chirp that is identical audio
    by construction. Every flag cost about a cent to reproduce the take just
    rejected, and the form's own copy — *"the note steers the retake"* — was a
    promise the code never kept.

    What flagging is actually for survives untouched: `voiceApprovalBlockedReason`
    refuses the gate while anything is flagged, so a listen-through can mark six
    problems and the stage stays shut until each is dealt with. That is a review
    ledger and it is worth keeping. The repair is now a second, explicit press.

64. **Two repairs, and a provider fact that decides which is offered.**
    `TTSProvider.rereadCanDiffer` — true for ElevenLabs (`stability: 0.38`, no
    seed) and Gemini (an LLM taking a style prompt), false for Cloud TTS (no
    temperature, seed or style field). `Read it again` appears only where it is
    true, and `retakeVoiceTake` re-checks server-side rather than trusting the
    button. `Fix the words` appears everywhere, because on Chirp the input is
    the only lever there is.

65. **`claimTake` recognises a paragraph by its words, not by its take number.**
    It matched `(idempotencyKey, takeNumber)` with the runner always asking for
    take 1 — right only while a paragraph has exactly one take. After any retake
    the good audio sits at take 2 under a key derived from the current text, and
    the next stage re-run asked for take 1 of that key, found nothing, and
    bought words it was already holding. Every stage re-run after any retake
    paid for the retaken paragraph again. It now asks the question the caller
    means: *is the current take of this paragraph already this text in this
    voice?* An explicitly named `takeNumber` still forces a purchase — that is
    how a deliberate second attempt at identical input is requested, and nothing
    but "read it again" should name one.

66. **A re-read edits the script through `editChapter`, not around it.**
    `replaceParagraph` swaps one block and leaves every other byte alone, so the
    edit trail shows the sentence that changed rather than a reflow of the whole
    chapter. Splitting a paragraph in two is refused: it would shift every later
    index and orphan the takes addressed by them (spec §7's stability contract).

71. **The repair is not behind the flag.** Shipped that way for an hour and it
    was wrong: it made the human flag a take, type a note, and press again
    before they could change a word — three steps to fix a comma. The
    justification would have been that the flag holds the gate shut while the
    repair is in flight, but a re-read already does that on its own: the new
    take is `pending`, and `voiceApprovalBlockedReason` refuses approval while
    anything is pending.

    So the row offers three independent things in any order — `Fix the words`,
    `Read it again` where it can differ, and `Flag` for a problem to come back
    to. Flagging is now purely triage: mark six things during a listen-through
    without stopping, deal with them after.

72. **A pronunciation is part of a take's identity.** Found by trying to answer
    "how do I make the narrator say Jan the English way?" and discovering the
    answer was: you cannot. `takeIdempotencyKey` hashed
    `(project, chapter, paragraph, text, voice)` — the pronunciation list was
    nowhere in it. So correcting a hint changed the audio without changing a
    character of the script, and every door was shut: a stage re-run matched the
    old key and handed back the take that says it wrong, `Fix the words` refused
    because the words had not changed, and `Read it again` does not exist on
    Chirp. The only way through was to edit the paragraph into something you did
    not want, purely to force a new hash.

    The key now folds in the hints **that match this paragraph**, so a term
    added for "Theranos" re-reads the paragraphs saying Theranos and nothing
    else — and only when there are matching hints at all, so a project with an
    empty list keeps every key it has and this change re-narrates nothing on its
    own. Sorted before hashing, because a list reordered in Settings is the same
    instructions.

    `matchedHints` moved from `providers` to `schemas` and is re-exported, so
    the key and the vendor request cannot disagree about which hints apply. Two
    copies of that regex would eventually mean a key claiming pronunciations the
    request never carried.

73. **A NUL byte was sitting in `voice.ts`, invisible.** The separator in
    `takeIdempotencyKey`'s `join()` was a literal control character, so the
    source read `join('')` and was not — which is why `grep` had been reporting
    the file as binary. It is written `'\u0000'` now. The separator itself is
    kept exactly: it stops `("ab", "c")` hashing the same as `("a", "bc")`, and
    every take in the database was keyed with it, so "tidying" it to `''` would
    have silently re-narrated everything.

### M4.9 — the audit: dead machinery out, voice-first scripting in (2026-08-13)

A review the human asked for, with three decisions that deviate from spec and
one structural correction they diagnosed themselves.

74. **Web push (VAPID) is gone entirely.** Spec §11.4 asks for it; it was
    built — key pair, service worker, subscriptions table, Settings toggle —
    and its one visible effect was a permanent Settings popup demanding VAPID
    keys nobody intended to create. Deleted: the toggle, the worker, the API
    routes, `packages/db/src/push.ts`, the `push_subscriptions` table
    (migration `0009`, applied to production), the env group, and the
    `web-push` dependency. `notify()` keeps the email path (inert until a
    Resend key exists — notifications' "final layer" is deferred, not
    abandoned) and otherwise logs.

75. **Budgets are one number.** Spec §4's per-provider cap matrix and §11.3's
    kill switch are removed: `budgets` is now `{ monthlyCeilingUsd,
    approvedOverage? }`, checked by the same guard under one advisory lock
    against `monthTotalUsd`. A ceiling of zero refuses everything, which is all
    the kill switch ever did as a separate concept. Chosen over "remove
    everything" deliberately: the ceiling is the only automatic brake between a
    runaway paid fan-out and a card, and the voice stage buys sixty calls in
    seconds. `.catch(100)` on the schema field so the production row's old
    shape parses instead of taking the app down. The Budgets tab is gone; the
    one input lives on the Costs screen next to the number it limits.

76. **The scripting prompt writes for the ear.** The human's diagnosis was
    exact: the voice stage was doing script work — pauses and pronunciations
    patched in at review, paragraph by paragraph, at synthesis prices — because
    the drafting prompt did not know its output would be read aloud. It does
    now: punctuation-as-pacing, contractions, breath-length sentences, numbers
    written as speech, and `[pause]` markup where silence is the point, all in
    `HOUSE_STYLE` so the outline's beats and every chapter get it. The
    self-check is told the markup is pacing, not words. Prosodic continuity is
    a drafting property — Chirp is stateless and deterministic, so there is no
    tone drift between paragraphs to fix downstream; what reads wrong aloud was
    written wrong.

77. **Pause and pronunciation tools live in the Script Studio.** The same three
    pause buttons as the voice review's re-read form, inserting at the cursor;
    and selecting a name offers "Save pronunciation" — the same add-and-check
    the Settings editor does (`addPronunciation`), without the three-screen
    round trip. Because a hint is part of each take's identity (decision 72),
    saving one from here is also what makes the next voice run re-read exactly
    the paragraphs that contain the term.

78. **A density pass, inside the spec's floor.** Card padding 16→12px, page
    stacks 24→16px, shell padding and top bar tightened, default button text
    13px. The 40px hit target (§11.1) is untouched — it is asserted by an E2E
    test and it is the floor the button-first rule stands on; what read as
    "aggressive padding" was the compounding of container paddings, not the
    controls.

### M4.10 — pacing in the take key, and staleness made visible (2026-08-13)

The human asked whether re-running the voice stage re-reads only changed
paragraphs (yes), then found the hole: changing the pacing slider changed
nothing. Same class of bug as the pronunciations (decision 72) — pacing alters
how a paragraph is *spoken* without changing a character of it — and I missed
it when I fixed that one.

79. **Pacing is part of a take's identity.** `takeIdempotencyKey` folds
    `settings.tts.pacing` in, but only when it is off the default 1×, so every
    take already bought (all made at 1×) keeps its key and this change alone
    re-buys nothing. Moving the slider changes every fingerprint and the next
    run re-reads the whole script at the new speed — which is what a global
    speed change honestly costs. The segment is written `pacing=<value>`,
    prefixed so it can never hash-collide with the pronunciation segment.

80. **Staleness is computed from the fingerprint and shown like a flag.** The
    human's second point: after a change, nothing on screen said a re-run was
    needed — the parked run reads "running", every row reads "Generated", and
    the only way to hear that the audio was old was by ear. `voiceReviewModel`
    now recomputes each paragraph's expected key (same function the runner buys
    with, so screen and purchase cannot disagree) and marks rows whose current
    take was bought under a different one: a "Changed since read" chip on the
    row, a count on the chapter header and the coverage line, and — the part
    that bites — approval is blocked while anything is stale, because approving
    audio of words, a voice, a speed or a pronunciation the project no longer
    has is approving the wrong video. No `isStale` column anywhere: it is
    derived on read, per M3's "staleness is derived, not stored" rule, so no
    write can forget to set it.

### M4.11 — Gemini as the narrator, and the review screen grows up (2026-08-13)

The human switched to Gemini TTS by ear ("the voice sounds more natural"), hit
an error completing a run, and listed four review-screen frictions in one
message. Google's TTS prompting guide reviewed (2026-08-13) before touching the
adapter.

81. **Rate limits are weather, not failure.** Gemini's preview TTS models carry
    single-digit RPM caps and rolling spend windows, so a sixty-paragraph
    fan-out *will* meet 429s in normal operation — and the runner was counting
    each one as a permanently failed paragraph, killing the run on the 15%
    tolerance. `withRateLimitPatience` now wraps every synthesis: retry only
    `RateLimitError`, honour the vendor's retry-after, back off 5/15/30s when
    it is silent, give up rather than wait past a minute. A plain in-process
    wait, not an Inngest sleep — throwing to reach a durable sleep would retry
    the whole batch and re-buy whatever was in flight. Gemini also fans out two
    abreast instead of five (`ttsConcurrency`).

82. **The Gemini prompt follows Google's guide.** Director's-notes block, then
    "Read the following narration aloud, exactly as written:" — an LLM given
    direction and transcript in one blob sometimes reads the direction aloud
    or paraphrases the words. `[pause]` markup gets an explanatory note
    (Gemini has no markup field; sent bare it risks being spoken). Style,
    pacing words, per-take direction and pronunciation hints all live in the
    notes.

83. **The flag note now steers the retake — the workflow as originally
    intended, unlocked by a steerable narrator.** "Read it again" (which the
    human could not guess the purpose of) became "Another take": a form with
    an optional direction box, prefilled from the flag note, sent through the
    retake event into the Gemini prompt. Direction travels only where the
    narrator can act on it; the parameterised vendors never receive one.

84. **Stale rows regenerate in place.** The row's "Regenerate" button enqueues
    the retaker, which recomputes the fingerprint from current text and
    settings — exactly a one-paragraph re-run, no walk to the top of the page.
    Allowed on every narrator (the server checks staleness itself): the
    `rereadCanDiffer` gate is about identical input, and a stale row's input
    is different by definition.

85. **Playback: a row's Play is a spot check.** Only "Listen through" rolls on
    to the next paragraph; a row's Play ends where the paragraph does. And
    Pause now calls `pause()` on the element — clearing the `src` attribute
    alone does not interrupt a playing element, which is why Pause appeared to
    wait politely for the end of the take.

### M4.12 — the narrator instructions join the take's identity (2026-08-14)

The human rewrote the narrator brief and re-ran the voice stage: "nothing
happened." The run mirror confirms it did exactly what it was built to —
"Narration ready · 37 paragraphs · 37 reused", sixteen seconds, $0 — because
the instructions were not part of any take's fingerprint. Third member of the
same bug class (pronunciations, decision 72; pacing, decision 79): something
that changes how a paragraph is spoken without changing a character of it.

86. **`promptSteered` is an adapter fact.** Only Gemini receives the
    instructions at all — Cloud TTS takes text and a speaking rate, ElevenLabs
    text and voice settings — so folding the brief into every provider's keys
    would re-buy byte-identical audio on two of the three. The flag lives on
    the adapter beside `rereadCanDiffer`, is resolved through the registry
    (mock mirrors the stood-in provider), and replaced the hand-rolled
    `STEERABLE_PROVIDERS` list in the voice tab — which was a second copy of
    the same fact waiting to disagree.

87. **`voiceKeyFacts` is the one assembly of settings-owned identity.** Four
    places compute take fingerprints (runner, retaker, review model, retake
    action) and each had hand-assembled voice/pronunciations/pacing. All four
    now spread one helper, which is also where the `promptSteered` gate lives.
    A fifth field joining the key touches one function.

88. **Re-running the stage stays reuse-by-default, deliberately.** The human
    proposed re-run = fresh takes on everything, now that single rows can be
    retaken. Declined in favour of the fingerprint doing the work: with the
    instructions in the key, "I changed the brief, re-run" re-reads everything
    anyway — while a re-run after a crash (nothing changed) still resumes
    free, which is what let the rate-limit-killed Gemini run recover without
    re-buying 37 paragraphs. Re-run means "make the audio match the project";
    the fingerprint decides what that costs.

### M4.8 — what the Chirp 3 HD guide said, and I had not read (2026-08-13)

The human sent Google's Chirp 3 HD page. Two things in it contradict claims I
had made confidently, in code comments and to their face, in this same session.

67. **Chirp 3 HD has a pause control, and I said it had none.** The input has a
    `markup` field alongside `text` carrying `[pause]`, `[pause short]` and
    `[pause long]`. I had told the human the only levers were words, punctuation
    and the global pacing slider — twice — on the strength of an adapter comment
    reading *"Plain text, never SSML: the Chirp families do not accept it"*,
    which I wrote from assumption and never checked. SSML is in fact supported
    too, at Preview.

    The adapter now sends `markup` when a paragraph carries a tag and `text`
    when it does not — routing matters, because `[pause long]` sent as `text`
    would be *read aloud*. The re-read form has the three tags as buttons.

    SSML is still not used, and now by decision rather than by error:
    `customPronunciations` and `markup` cover narration, and they are documented
    for this family without the Preview caveat that took `gemini-*-preview` away
    from us this week.

68. **Pause markup is the one thing in a script that is not words.** It lives in
    `chapters.contentMd`, because a pause is a property of how the line is
    written and a re-read has to reproduce it. So everything that is not the
    synthesiser reads through `stripNarrationMarkup`: `countWords` (and through
    it every runtime estimate and length warning) and `sentenceHash` (so adding
    a pause to a sentence does not orphan the claim pinned to it). Captions,
    alignment and Shorts segments must do the same when M6 builds them — a
    caption reading "[pause long]" is this decision's failure mode.

69. **IPA works, X-SAMPA was never needed, and the whole layer is deleted.**
    Settled with a live probe (four calls, about $0.0004), authorised for this
    purpose. The earlier finding — "Cloud TTS rejects `PHONETIC_ENCODING_IPA`
    outright, verified on every voice family and every phrase" — was wrong, and
    the shape of the error is the lesson.

    That test used `/ˈvaɪɐkart/`. It carries `ɐ`, which is not an en-GB phoneme.
    Google validates the *phonemes* against the voice's language and returns the
    same "custom pronunciation phrases are invalid" either way, so a bad phoneme
    is indistinguishable from a bad encoding unless you hold one of them still.
    I changed both at once, saw the X-SAMPA arm pass, and concluded the encoding
    was at fault.

    Re-run holding the sounds constant and varying only the encoding:

        "cat"  IPA ˈkæt   → 200      X-SAMPA "k{t → 200
        "dog"  IPA ˈdɒɡ   → 200      X-SAMPA "dQg → 200
        "Wirecard"  IPA ˈvaɪɐkart → 400 invalid phrases: Wirecard

    The conversion had never been load-bearing either: `ipaToXSampa` renders `ɐ`
    as `6`, the same phoneme, equally refused. What actually kept those
    paragraphs alive was the drop-and-retry.

    So `x-sampa.ts` and its tests are deleted, and a hint reaches the vendor as
    the human typed it. That removes a lossy step which silently dropped any
    symbol missing from its table — a transform that could only ever turn a
    correct transcription into a quieter wrong one.

    The real constraint is unchanged and now stated correctly everywhere: a
    pronunciation must use sounds the *voice's language* has. `checkPronunciation`
    catching that at the moment of typing is the thing that matters, and it
    already did.

70. **Pacing floors at 0.25, not 0.5.** `speakingRate` accepts 0.25–2.0, so the
    slider offers what the vendor offers.

### M4.2 — Google Cloud TTS (Chirp 3 HD) as the narrator (2026-08-13)

Chosen by the human over Gemini TTS, and it is a deviation from spec §2 worth
recording properly.

45. **Cloud Text-to-Speech is a third TTS provider, and its own credential.**
    Spec §2 names "Gemini Flash TTS (batch) default; ElevenLabs behind the same
    interface". Cloud TTS is a different product on a different host with its
    own enablement — a Gemini key is refused by `texttospeech.googleapis.com`
    and a Cloud key is refused by `generativelanguage.googleapis.com`, both
    observed. So it is `google-cloud-tts` in the provider enum (migration
    `0007`) rather than sharing the `google` row: one credential for both would
    mean whichever key you saved last broke the other half of the pipeline.

    The reasons for choosing it over Gemini TTS: Chirp 3 HD is GA where every
    Gemini TTS model on offer is a `-preview` id — the exact kind that was
    withdrawn under us this week; the same text in the same voice comes back
    the same, where a language model performing a line varies run to run; and
    delivery is set by parameters rather than by persuasion.

46. **Chirp 3 HD does not take SSML, which undercuts part of the reason it was
    chosen.** The `<phoneme>` tag the older WaveNet and Neural2 voices support
    is not available on the Chirp families. Pronunciation goes in
    `customPronunciations` instead — a structured field carrying a phrase and
    its IPA — and a hint written as a plain respelling still has nowhere to go
    but the text, the same fallback ElevenLabs uses. Worth stating plainly
    rather than leaving the impression that full SSML is available.

47. **The voice list is queried, never shipped.** Today's lesson applied before
    it could happen again: a hand-written list of voice names is a list of
    assumptions, and this API answers the question for free. Filtered to the
    Chirp families — an audition panel with two hundred voices in it is a wall,
    not a choice. Verified live: 33 offered from 63 en-GB voices.

48. **Cloud TTS wraps LINEAR16 in a WAV container**, where Gemini and
    ElevenLabs return bare samples. Everything above the adapters assumes raw
    PCM, so the header is detected and stripped by walking the chunk list —
    detected rather than assumed, because an encoding change that silently ate
    the first 44 bytes of every take would be very hard to see.

### M4.3 — what a real synthesis found (2026-08-13)

The `synthesize` path is now proven end to end against the live key: 236 KB of
bare PCM for a 72-character sentence, header stripped, 4.92 s, $0.00216, a
waveform with real dynamic range, and a re-wrapped WAV that reads back. Getting
there turned up four more faults, three of them mine.

49. **`GUARDED_PROVIDERS` was a hand-written copy of `PROVIDERS` and drifted.**
    `google-cloud-tts` reached the enum, the price table and the settings
    screen, and the first audition through it died on "google-cloud-tts is not
    a guarded provider". Failing closed on a spend path is the right failure,
    but the list should never have been separate — it is derived now, and the
    advisory-lock key is a hash of the provider name rather than its index in a
    hand-ordered list, so ordering is no longer load-bearing either.

50. **Cloud TTS rejects IPA outright and accepts X-SAMPA.** Verified on every
    voice family, every phrase and every symbol set tried. The adapter sent
    `PHONETIC_ENCODING_IPA`, so _every_ pronunciation hint would have failed.
    Hints stay IPA where a human writes them — that is what Wiktionary prints
    and what ElevenLabs takes — and `ipaToXSampa` converts at the one adapter
    that needs it.

51. **Correct X-SAMPA is necessary and not sufficient.** Google validates a
    pronunciation against the _voice's own phoneme inventory_: `aI` is accepted
    for en-GB and a bare `a` is refused, so a perfectly good IPA transcription
    of a German name is rejected wholesale. That cannot be predicted from the
    notation, and encoding Google's inventory would be guesswork of exactly the
    kind that has cost this project two days. So two things instead: the adapter
    **drops a refused pronunciation and retries once**, because a hint is a
    nicety and the sentence being spoken is not — otherwise one bad entry in
    Settings would permanently fail every paragraph containing that word — and
    Settings **checks a hint with the vendor when it is typed**, where a human
    is present to fix it. A refusal is a free 400; an acceptance synthesises the
    term alone.

52. **The audition panel is one press, not four.** It used to be: tick up to six
    voices, press Generate, press Play on each, press "Choose this voice". Four
    presses to answer _what does this sound like_, which only listening answers.
    A press now synthesises, plays and selects, and **the selected voice is the
    narrator** — there is nothing else to confirm. Each voice is bought once per
    sample and the price is on the button before you press it.

### M4.1 — what the first live Gemini key found (2026-08-13)

The first real key ever pointed at this app found four faults, and **every one
of them reported itself as something other than what it was.** Recorded in full
because the pattern is the M3.1 pattern again: nothing here was reachable by any
test, because every test in the suite talks to a mock.

1. **A Google Cloud Text-to-Speech key is not a Gemini key.** They are different
   products on different hosts — `texttospeech.googleapis.com` versus
   `generativelanguage.googleapis.com` — and a Cloud key restricted to the first
   answers the second with `API_KEY_SERVICE_BLOCKED`. Not a code fault, but the
   console said "the key was refused", which sends you to rotate a key that was
   perfectly good. Worth knowing the two exist.
2. **`gemini-3-pro` and `gemini-3-flash` never existed.** They were written from
   assumption in M3 and carried a "prices are provisional" note that said
   nothing about the ids. `verifyKey` calls the cheapest model, so the first
   press of Verify with a valid key got a 404 and reported it as a refusal. The
   list is now read off `GET /v1beta/models` with a live key.
3. **A model in the catalogue is not a model you can call.** `gemini-2.5-pro`
   and `gemini-2.5-flash` are both listed by `GET /models` and both answer
   `generateContent` with "no longer available to new users". A listing is not
   an offer, which is why the replacement ids were each proved with a real
   one-token call rather than taken from the list.
4. **A 429 that means "you have run out of money" is not a rate limit.** Google
   returns `RESOURCE_EXHAUSTED` for both capacity and billing, and only the body
   separates them. Treating "your prepayment credits are depleted" as transient
   meant four retries with backoff into a wall, then a failure card describing a
   provider outage — pointing at a status page instead of a billing page. It is
   a `ValidationError` now, and it says the key itself is fine.

**Also fixed:** ElevenLabs had no Verify button. M4 gave its adapter a working
`verifyKey` and then left `verifiable` hardcoded to the three LLM providers, so
the one TTS provider with a key of its own was the one you could not check.

**Still outstanding, and not a code problem:** the Gemini account has no
prepaid credits, so nothing will run against it until it is topped up. The key,
the models and the adapter are all confirmed good — `geminiTts.verifyKey`
passes, and every text model returns 429-billing rather than 404.

### Where the fixture had to move

`BEYOND_RUNNERS_TITLE` — "a project past the last runner we have built" — sat at
`voice`/`running`. M4 built that runner, so the fixture moved to `visuals`. The
state it tests is unchanged, and it will have to move again at M5: "past the
last runner" is a target that moves with every milestone, which is worth saying
out loud in the fixture rather than rediscovering when the assertion goes red.

### Not built, and deliberately

- **Loudness normalisation** — decision 40, lands with media-utils in M6.
- **ElevenLabs `with-timestamps`** — spec §2 makes it the free path to alignment,
  skipping Whisper entirely when ElevenLabs is the narrator. That is an M6
  concern; the adapter is built so it can be added without touching anything
  above it.
- **Claim-level invalidation** — still outstanding from M3.2, still belongs with
  the self-check pass.

### Two things adding the fixtures found

Both were live defects in code M4 did not write, and both were invisible because
a test was quietly driving the wrong screen:

- **The dossier's source links were 24px**, against the 40px minimum in spec
  §11.1 — the smallest control in the app, and the one most worth pressing,
  since checking where a claim's source actually points is the entire job of
  that screen. The audit that should have caught it opened whichever project
  came first in the list, which stopped being the dossier fixture as soon as the
  suite gained projects in other states. Scoping the fixture by title rather
  than by position is what surfaced it.
- **`.first()` had rotted a second time.** M3.4 replaced "the first row" with
  "the row that has a Review link"; M4 added two projects parked at the voice
  gate and that broke too. Both were selectors describing where the fixture
  happened to sit rather than what it is. It is opened by title now, through one
  `openFixtureProject` helper, so the next milestone's fixtures cannot move it
  again.

And one test was reporting on the clock rather than on the code: "queued and
young" has a three-minute shelf life by design, and a fixture seeded once in
global setup ages past it as the suite grows. That test re-stamps the row before
it looks at it, which is the only way to assert on a time-bounded state without
making the window configurable from outside — and the second would be production
code shaped by a test.

### Verified

- **`pnpm test`** — 759 tests across 6 workspaces (schemas 123 · db 148 ·
  providers 250 · cost 30 · ui-tokens 21 · web 187), clean run, exit 0.
- **`pnpm e2e`** — 71 Playwright tests, run twice to catch state leaks.
- **`pnpm build`** — production bundle, with `/api/voice-takes/[id]/audio`
  registered.
- **Production migrated** (2026-08-12): `voice_takes.waveform` and
  `voice_takes.built_from_script_version` both present. Existing takes — there
  are none — would read as `unknown-provenance` rather than being assumed
  current, which is why the column is nullable.
- **Not verified: the runners themselves end to end.** `@inngest/test` cannot
  drive a run past a `waitForEvent` (decision 20), so `voice-runner` and
  `voice-retaker` are proven the way every runner since M2 has been — by running
  against Inngest Cloud from the deployment. That has not happened yet, and it
  is the next thing to do.

**Spending:** every TTS call is mocked by default (`MOCK_PROVIDERS=1`), so this
milestone was built and tested without spending anything. **The Vercel
deployment is not mocked** — a voice run there is real spend against the caps,
and narration is the first stage that fans out over dozens of paid calls in
seconds.

---

## M5 — Visuals

> Shot-list generation with typed briefs, stock/archival adapters + scoring,
> Flux adapter, visual board UI, chart/map live previews.

**Status:** `[ ]` not started

---

## M6 — Assembly & render

> Alignment (Whisper.cpp in media-utils + snap-to-script with golden tests),
> timeline compiler + golden tests, music library + picker, compositions
> library with bundled fonts + Studio fixtures, CDK deploy of broker +
> media-utils, broker URL materialisation, preview screen, render flow +
> webhook + QC + stop semantics.

**Status:** `[ ]` not started

---

## M7 — Shorts & publish

> Shorts-runner + UI, YouTube OAuth + resumable upload + error mapping +
> quota queue, publish calendar + thumbnail dropzone, private-until-audit
> checklist mode.

**Status:** `[ ]` not started

---

## M8 — Analytics & polish

> Analytics-runner + retention-vs-chapter overlay, weekly digest, alarms,
> mobile passes, button-affordance audit, empty states, Lighthouse, full E2E,
> staging render, one real video produced.

**Status:** `[ ]` not started

---

# Decisions made

Recorded whenever the spec left something open and an implementation was chosen.

### M1

1. **Only three packages are created in M1: `schemas`, `db`, `ui-tokens`.**
   Spec §3 lists seven packages, but also requires every package to have its own
   tests — an empty stub cannot. `cost` arrives in M2, `providers` in M3,
   `timeline` and `compositions` in M6. The §3 layout is honoured by the time
   M6 closes.

2. **The full spec §5 data model ships in one migration in M1.** The schema is
   the contract every later milestone codes against; introducing it
   table-by-table per milestone would guarantee repeated migration churn.
   Tables that no milestone exercises yet simply have no query helpers.

3. **Env validation is tiered.** Spec §4 requires the app to "refuse to start
   listing missing keys", but M1 predates the R2/Inngest/broker/YouTube
   infrastructure. `packages/schemas/src/env.ts` therefore splits §4's
   variables into _required at boot_ (`DATABASE_URL`, `AUTH_SECRET`,
   `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_URL`, `OWNER_EMAIL`,
   `SECRETS_ENCRYPTION_KEY`) and _required at first use_ (`R2_*`,
   `AWS_BROKER_*`, `INNGEST_*`, `YOUTUBE_*`), the latter reached only through a
   `requireEnv()` accessor that throws a typed `ConfigError` naming the missing
   keys. Boot-time failure still lists every missing required key at once.

4. **Settings tabs implemented in M1:** Models (routing matrix fed by a static
   `KNOWN_MODELS` table in `packages/schemas` until the adapters land in M3),
   Budgets, Publishing defaults, Brand Kit token editors, and Connections with
   masked key display and replace-key. **Deferred with their dependencies:**
   the Brand Kit live specimen panel and Music library (need Remotion, M6), the
   `Verify` button on Connections (needs provider adapters, M3), Voice audition
   (M4), and the Danger zone cancel-all-runs (needs Inngest, M2).

5. **Next 16 renamed `middleware.ts` to `proxy.ts`.** Spec §2's
   "middleware-protected everything" is implemented as `apps/web/proxy.ts`;
   the behaviour is unchanged.

6. **Version pins.** The spec names the stack but not versions. Pinned:
   Next 16.3, React 19.2, Tailwind 4.3 + shadcn/ui, Drizzle 0.45 /
   drizzle-kit 0.31, Zod 4.4, TanStack Query 5.101, Auth.js 5.0.0-beta.32 with
   `@auth/drizzle-adapter` 1.11 (exact pin, no caret — it is the only line
   targeting the Next 16 App Router), Vitest 4.1, Playwright 1.62,
   Turborepo 2.10, pnpm 11.20 via corepack.

7. **A `MOCK_PROVIDERS=1` credentials auth path exists** so Playwright can drive
   the app without real Google OAuth (spec §13 requires an env-switched
   mock-provider mode). It is hard-guarded: the provider is never registered
   when `NODE_ENV === 'production'`.

8. **Docs renamed** to `01-channel-roadmap.md`, `02-app-spec-and-dev-plan.md`
   and `03-build-spec.md` to match CLAUDE.md's references and the kebab-case
   rule in spec §3. Content unchanged.

9. **No `users` / `accounts` / `sessions` tables.** Auth.js runs with the JWT
   session strategy. The app has exactly one allowlisted account, so a sessions
   table would hold a single row, and a database adapter would force `proxy.ts`
   off the edge runtime purely to read it. This also keeps the schema to
   exactly the tables spec §5 names — it lists no auth tables.

10. **The narration voice is stored once.** Spec §4 calls it `settings.tts` and
    §10 calls it `brandKit.voice`, describing the same five fields. It is stored
    at `settings.tts` and projected into the Brand Kit snapshot by
    `resolveBrandKit()`; two writable copies of the same fact would drift.

11. **One `.env.local` at the repository root**, not one per workspace. The same
    `DATABASE_URL` and `SECRETS_ENCRYPTION_KEY` are needed by `pnpm db:migrate`,
    `pnpm db:seed` and the web app. Next only reads env from the app directory,
    so `apps/web/next.config.ts` loads the root file explicitly, with real
    environment variables (Vercel, CI) still winning.

12. **E2E runs against `next dev`, not a production build.** The mock credentials
    provider is hard-guarded off when `NODE_ENV=production` — that guard is the
    point, so the suite works with it rather than around it. Playwright sets
    `AUTH_URL` to its own base URL, because Auth.js rewrites the request origin
    from it and `proxy.ts` builds redirects from that.

13. **`devIndicators: false`.** Next's floating dev-tools button is a 32px control
    that fails the 40px hit-target audit the E2E suite runs over every visible
    control, and it is not part of the app.

### M2

14. **The error taxonomy and event contracts live in `packages/schemas`.** Spec
    §6 associates the error types with the provider layer, but `cost`, the
    Inngest runners and the UI all classify errors, and none of them may depend
    on the provider adapters (§3: `providers` never imports from `db`). Putting
    them in the contract package everything already depends on avoids a
    dependency inversion when `providers` lands in M3.

15. **Event payloads carry no `.default()`.** Inngest 4 replaced `EventSchemas`
    with `eventType(name, {schema})` over Standard Schema, and rejects any
    schema whose input and output types differ — a default is a transform. It
    is the right constraint for wire payloads anyway: a field the sender omits
    should be absent, not filled in with a value the sender never chose. A
    schemas test asserts no default creeps back in.

16. **Cancellation is a separate `cancel-reconciler` function, not a `finally`
    handler.** Spec §7 describes a `finally` that writes `stageStatus='cancelled'`
    and releases resources. A cancelled Inngest run cannot durably execute new
    steps, so a `finally` block cannot reliably write that state — which is
    exactly the state the UI reads. A function triggered by the same
    `project/cancelled` event gives the guarantee without the fragility, and
    works whoever emitted the event. It excludes its own mirror row, since the
    event names the project it is itself attributed to.

17. **Approved budget overages live in `settings.budgets.approvedOverages`,
    keyed by month.** Spec §6 says the run parks on `waitForEvent('budget/approved')`
    but not where the granted headroom is recorded. Settings is where the cap
    already lives, so the guard and the Costs screen read one number — and a
    month key means March's generosity expires without anyone remembering to
    revoke it.

18. **A gate is not a table.** A review gate _is_ `projects.stageStatus =
'awaiting_review'`; a budget gate _is_ a run at `awaiting_gate` with its
    latest `gate.opened` event unclosed. A `gates` table would be a second home
    for a fact that already has one, and two homes eventually disagree.

19. **`push_subscriptions` is a new table, beyond spec §5.** VAPID push has no
    server-side identity: the browser returns an endpoint plus two keys, and
    without somewhere to keep them there is no way to tell anyone a gate opened.

20. **Memoisation is not asserted through the Inngest harness.**
    `@inngest/test` 1.0.0 persists no step state between executions and cannot
    mock a non-runnable step, so it can neither drive a run past a gate nor
    observe "the provider was called once". The tests assert what is genuinely
    observable — deterministic step ids, which is the property that makes
    memoisation work — and the resume half of park/resume is asserted against
    the gate helpers directly. Recorded here because the gap is deliberate.

21. **`pnpm test` runs `turbo run test --concurrency=1`.** Three workspaces now
    exercise the same database and truncate each other's tables; in parallel
    they fail in ways that look like logic bugs. It is the same reason
    `fileParallelism: false` is already set inside each package.

22. **E2E covers the screens; the orchestration is covered by the harness.**
    Driving a real run through Playwright would mean running the Inngest Dev
    Server inside CI to assert things the unit-level harness already asserts
    deterministically. The `pnpm e2e` global setup resets the fixture project,
    run mirror and ledger, so the suite does not inherit whatever the
    orchestration tests left behind.

### M3

23. **The adapters own the model list and the price table.** Spec §6 puts both
    on each `LLMProvider`, so `packages/cost` now derives `LLM_PRICES` from
    `LLM_MODELS` instead of keeping the hand-written copy M1 shipped. Two
    tables drift, and the one the guard happened to read would decide whether
    a cap held. A test asserts the numbers are identical by construction.
    **The figures themselves are still provisional** — carried over from M2 and
    accepted as-is by the human (2026-08-11) rather than verified against the
    vendors' current price lists.

24. **Model ids moved from short names to wire ids**, and `normaliseSettings`
    rewrites `opus`/`sonnet`/`haiku` on read. `SettingsSchema` accepts any
    non-empty string as a model, so an M1-era settings row parses cleanly and
    would only fail later, at the router's pre-flight, as "anthropic does not
    offer opus" — halfway into a run and nowhere near the cause.

25. **Prompt builders and response parsers live in `packages/providers`.** They
    are logic, and spec §3 keeps logic in packages rather than in
    `apps/web/lib`. `providers` still imports nothing from `db`: the router
    takes decrypted credentials as an argument and reports downgrades through a
    callback, so the "adapters are pure" rule survives.

26. **`parseJsonCompletion` extracts JSON but never repairs it.** Fences and
    prose around the object are stripped, because that is presentation. A
    trailing comma is not: malformed JSON means the generation went wrong, and
    patching the syntax yields a dossier with half a claim in it. The runner
    retries instead.

27. **Change requests are a separate Inngest function, not a second wait.**
    `dossier-runner` waits only on `gate/dossier.approved`; `dossier-reviser`
    triggers on `gate/dossier.changes_requested`, re-researches and re-opens the
    gate while the main run stays parked. Racing two `waitForEvent` steps
    leaves the losing wait of every round outstanding in the run plan, and
    cannot be tested — `@inngest/test` cannot drive a run past a
    `waitForEvent` at all (see decision 20). `cancel-reconciler` proved this
    shape in M2.

28. **Nothing crosses a step boundary except plain JSON.** Inngest serialises
    step return values, so a `BudgetExceededError` arrives as a shapeless
    object that `instanceof` will not recognise — it would have been re-thrown
    as an unknown error and retried four times. Budget gates travel as the same
    plain record the Needs-you card renders from.

29. **The dossier approval blocker is enforced in the server action.** A
    disabled button is a hint; `approveGate` refuses outright while any claim
    is unsourced and unquarantined, so a stale tab or a replayed post cannot
    walk an unchecked assertion into a script. The predicate lives in
    `lib/claim-review.ts` and is read by the screen, the gate bar and the
    action alike.

30. **Sentence splitting and hashing live in `packages/schemas`.** Three places
    must agree on what a sentence is: the self-check that warns against one,
    the `claim_ref` that pins a claim to one, and the Studio gutter that draws a
    marker beside one. The hash normalises whitespace, case and punctuation, so
    fixing a typo does not orphan every claim reference in the chapter — only a
    real rewording breaks the link, which is exactly when the claim should be
    re-checked.

31. **Chapters are drafted sequentially, not fanned out.** Each is fed the tail
    of the previous one. Parallel chapters read like separate essays about the
    same company, each re-introducing the principals. Each chapter is still its
    own step, so a failure in chapter six does not re-charge one to five.

32. **Warnings are a `jsonb` column on `chapters`, not a table.** A warning has
    no identity beyond the sentence it points at and is replaced wholesale on
    every re-check. Migration `0003`.

33. **The Studio editor is TipTap over a paragraph-only document.** Narration
    has no other structure — the drafting prompt forbids headings, bullets and
    stage directions because the text is read aloud exactly as written — so the
    markdown round trip is lossless without a parser inventing structure. Warned
    sentences are a ProseMirror _decoration_, never a wrapper node: what reaches
    the voice stage must be exactly what the human saw.

34. **Regenerate returns a proposal and never writes.** The human accepts or
    rejects each hunk and only that decision is saved. Nothing is accepted by
    default, and applying zero hunks returns the original byte for byte — the
    property that makes "Reject all" safe. The diff is by sentence, matching the
    unit warnings and claims already use.

35. **The seed resets fixture claims rather than skipping them.**
    `onConflictDoNothing` left a claim quarantined by a previous E2E run, so the
    fixture's whole point — one unverified claim blocking the dossier gate —
    quietly stopped being true on the second run. `deleteCasesExcept` likewise
    clears rows the suite created, because repeatability is the value of having
    a fixture at all.

36. **`pnpm db:migrate:test`.** A Neon branch is a point-in-time clone, not a
    follower, so migrations must be applied to it too. The obvious
    `DATABASE_URL=… pnpm db:migrate` trips the same-database guard by leaving a
    stale `DATABASE_URL_UNPOOLED` pointing at production — the guard is right,
    so the script exists instead.
