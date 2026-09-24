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
    makes the _first_ press a trap: press one voice, and every other voice
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
    audition put the panel that _chooses_ a voice below two panels describing
    one you had not chosen yet, and asked for pronunciation hints for a narrator
    that did not exist. It reads audition → narrator → pronunciation now, which
    is the order the work happens in.

### M4.5 — the lock, deleted (2026-08-13)

Decision 53 kept the lock and made it deliberate. That was still one concept too
many, and the human said so plainly: _"the selecting and unselecting of a voice
and locking in a voice is just so overcomplicated and unnecessary."_ They are
right, and the reasoning in 53 should have carried all the way.

57. **There is no voice lock, in the schema or the UI.** Spec §4 lists
    `locked: boolean` on `settings.tts`, §11.3 has choosing write _and_ lock it,
    and §10 has the unlock ritual with `CHANGE VOICE` typed out. All of it is
    gone: `VoiceConfigSchema` has no `locked` field (Zod strips it from any row
    that still carries one), `lockVoice`/`unlockVoice` are deleted, and
    `chooseVoice` no longer refuses.

    The lock was protecting a single-user console from its single user. Every
    time it fired, it fired on the person it belonged to — and it fired on the
    screen whose entire purpose is trying voices against each other. The risk it
    named is real (swap the narrator mid-channel and every earlier video sounds
    like a different show) but the mitigation for that is _saying so_, which the
    narrator card now does, next to a plain statement of which voice is current.
    A modal ritual is what you build when other people can reach the setting.

58. **Play and Add voice are separate buttons on each card.** The card used to
    _be_ the button, so listening and choosing were the same press and you could
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
    on the screen that _did_ update instantly was going through the optimistic
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

Reported as _"the audio generated is not speech, it's just random sounds"_ on
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
    different ones.** The runner chose the key by _bucket_:

        const key = storageConfigured() ? (await putObject(...)).key
                                        : mockVoiceTakeKey(take.id)

    while the audio route reads it by _provider_ — any `mock://` key is a mock
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

Started from a question — _"if I flag a paragraph and suggest changes, how will
the voice regenerate?"_ — whose honest answer was: it won't.

63. **Flagging is a verdict and no longer spends.** Spec §11.3 has flagging
    "enqueue the retake immediately", and it did: `flagVoiceTake` sent
    `voice/retake.requested`, the retaker re-synthesised the same text in the
    same voice at the same rate, and the note explaining what was wrong was
    stored on the row and never sent anywhere. On Chirp that is identical audio
    by construction. Every flag cost about a cent to reproduce the take just
    rejected, and the form's own copy — _"the note steers the retake"_ — was a
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
    means: _is the current take of this paragraph already this text in this
    voice?_ An explicitly named `takeNumber` still forces a purchase — that is
    how a deliberate second attempt at identical input is requested, and nothing
    but "read it again" should name one.

66. **A re-read edits the script through `editChapter`, not around it.**
    `replaceParagraph` swaps one block and leaves every other byte alone, so the
    edit trail shows the sentence that changed rather than a reflow of the whole
    chapter. Splitting a paragraph in two is refused: it would shift every later
    index and orphan the takes addressed by them (spec §7's stability contract).

67. **The repair is not behind the flag.** Shipped that way for an hour and it
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

68. **A pronunciation is part of a take's identity.** Found by trying to answer
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

69. **A NUL byte was sitting in `voice.ts`, invisible.** The separator in
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
how a paragraph is _spoken_ without changing a character of it — and I missed
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
    fan-out _will_ meet 429s in normal operation — and the runner was counting
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

### M4.13 — the scene becomes Gemini's narration unit (2026-08-14)

The human reported Google's tier caps requests per _day_ (about 200 on their
tier), proposed temperature 0, and asked whether synthesis should go scene by
scene instead of paragraph by paragraph. Verified against Google's docs before
touching anything: **temperature is a placebo here** — "the API ignores the
`temperature`, `top_k` and `top_p` generation config parameters" for
Gemini-TTS — and the text field caps at ~4,000 bytes, which bounds a scene.

89. **The narration unit is the provider's fact.** `narrationUnits` yields
    scenes (a chapter, split only past `SCENE_TEXT_BYTE_BUDGET` = 3,500 bytes,
    always at paragraph boundaries) for prompt-steered narrators, and
    paragraphs for everyone else. One request per scene is one continuous
    performance — the actual fix for the "alternating narrators" drift, per
    Google's own chunking guidance — and it spends ~7 requests per run instead
    of ~38 against a 200/day allowance. Chirp keeps paragraphs: it is
    deterministic (no drift to fix) and its API caps requests at ~4,000 bytes
    anyway. `unitIndex` lives in the `paragraph_index` column; in paragraph
    mode nothing changed at all.

90. **Everything re-derives units from one function.** The runner, retaker,
    review model, retake action and the audio route's mock regeneration all go
    through `narrationUnits` (the web-side take lookup is `takeUnit`);
    `takeWithParagraph` left the db package with its last caller. "Fix the
    words" on a scene replaces exactly the paragraph span the scene covers —
    splits allowed there, since scene addressing is re-packed — while
    paragraph mode keeps the byte-preserving, split-refusing path.

91. **Wording follows the unit.** Coverage, gate context, blocked reasons and
    the row marker say "scenes"/§ on a scene narrator and "paragraphs"/¶
    otherwise. The E2E fixture pins its provider to ElevenLabs (a
    paragraph-unit narrator) so its per-paragraph seeds stay honest; scene
    packing is covered by unit tests.

92. **The E2E suite had quietly rotted, and this session's run found it.**
    Four costs specs still drove the kill switch and per-provider budget
    matrix deleted on 2026-08-13 — the Playwright suite had not been run
    locally since, and the audit updated `console.spec.ts` but missed
    `pipeline.spec.ts`. Rewritten against the one-ceiling screen. Two more
    were latent: the Connections spec's `^google\b` regex started
    double-matching when the `google-cloud-tts` card arrived (fixed by
    asserting all seven cards with a space boundary), and the quarantine spec
    raced the toast against the server re-render (the toast is not the
    re-render; the enabled-check now waits out a cold compile). The lesson: a
    suite that is not run is a suite that agrees with everything — `pnpm e2e`
    belongs in the definition of done for anything that touches a screen.

    And the reason none of this ever showed in CI: **the Prettier format
    check, which gates every later step, had been failing since run 30** — 63
    files of drift, because `format:check` was never part of the local
    pre-push routine (lint and typecheck were). Formatted; the routine now
    includes it. CI's first full run in eleven pushes then found one more
    latent bug, this time in the harness itself: `expectHitTargets` re-queried
    `nth(i)` mid-sweep, so a live-refresh re-render that shrank the control
    list left `boundingBox()` waiting the whole timeout for an index that no
    longer existed. The sweep now walks a snapshot of element handles and
    forgives only vanished elements, never short ones.

### M4.14 — one narrator: the Google vendors are deleted, ElevenLabs Eleven v3 remains (2026-08-14)

The human called it: the style shifting between edits and calls on the Google
narrators is the problem, and ElevenLabs is the vendor with real control —
expression tags, pauses, inline pronunciation. Their instruction was to scrap
the Google architecture and plumbing entirely, not park it. So `gemini.ts`
and `google-cloud.ts` are deleted, `TTS_PROVIDERS` is a list of one, and
every capability abstraction those vendors forced — `promptSteered`,
`rereadCanDiffer`, scene units, the style prompt, the pacing slider, the
per-take `direction` side channel — is gone with them.

93. **The model is Eleven v3, and its direction channel is the text itself.**
    Anything in square brackets is a stage direction, acted on and never
    spoken — `[pause]`, `[whispers]`, `[sighs]`, free-form `[grave,
measured]`. That collapses what used to be three mechanisms (style
    prompt, retake direction, pause markup) into one that already existed
    here: narration tags in `chapters.contentMd`, inserted as buttons in the
    Script Studio and the review's "Fix the words" form, reproduced by every
    re-read, stripped by `stripNarrationMarkup` for captions. `PAUSE_TAGS`
    take v3's spelling (`[short pause]`, not Chirp's `[pause short]`; the
    strip regex accepts both, and on v3 any bracketed run is direction
    anyway), and a curated `EXPRESSION_TAGS` list joins them.

94. **Stability replaces pacing in the settings and in the take key.** v3 has
    no speed parameter and no request stitching; its one delivery control is
    stability, a discrete three-way (0.0/0.5/1.0) surfaced as Creative /
    Natural / Robust buttons. It changes how every paragraph is spoken
    without changing a character of the script, so it joins the fingerprint —
    the pacing lesson, third time applied, first time pre-emptively. Absent
    at the default `natural`, so existing keys hold.

95. **The old settings row migrates by becoming honest.** The production row
    says `gemini`/`Charon`, a voice ElevenLabs has never heard of. A
    `preprocess` on `VoiceConfigSchema` coerces any non-ElevenLabs row to
    `elevenlabs` **and blanks the voice id**: keeping "Charon" would surface
    as a vendor 404 halfway through a paid run, whereas an empty voice id is
    the state every screen already prompts about (first-run checklist,
    runner pre-flight, voice tab warning). Retired fields are stripped by
    Zod; the hint list survives, because it belongs to the channel.

96. **IPA hints are dropped and named, not smuggled.** v3 takes no phoneme
    markup, so `applyPronunciations` substitutes respellings into the text
    and reports IPA hints in `droppedPronunciations` (principle 6: degrade,
    never quietly). The pronunciation check in Settings now says the honest
    thing — write it the way it sounds — and the old `<phoneme>` tag path,
    which multilingual-v2 never actually supported either, is gone.

97. **"Another take" is one press again, and the direction box is deleted.**
    ElevenLabs samples, so a second reading genuinely differs; there is no
    prompt to carry a sentence of English, so offering a textarea would
    re-create the control-that-does-nothing bug (decision 55) in the other
    direction. The toast points at "Fix the words" for steering. The
    `direction` field is gone from the retake event, the retaker, `lib/tts`
    and `TTSRequest`.

98. **Scene units are deleted, not parked.** `narrationUnits` is one unit per
    paragraph, unconditionally; `takeUnit`, the review model, the retaker
    and the audio route keep resolving through it, so the shared-derivation
    property survives the simplification. The per-paragraph rows are what
    make the per-row Regenerate/Another-take buttons meaningful. The
    `google-cloud-tts` value stays in the Postgres enum (dropping an enum
    value means rebuilding the type) with nothing writing it, and a stray
    credential row for it is filtered on read rather than deleted — a stored
    secret should outlive a product decision that might yet be reversed.

### M4.15 — the platform audit: exception-based gates, a reachable dashboard, and the stale machinery swept (2026-08-16)

Before M5, the human asked for a full review — product, engineering,
architecture, UX — with one directive attached: approvals at every step are
friction, especially now that stage navigation lets work move back and forth.
Two read-only reviews (a dead-machinery audit and a screen-by-screen UX walk)
fed one implementation pass.

99. **Gates are exception-based.** A review gate exists to stop something that
    needs a human; when a stage finishes with none of those, parking anyway
    is ceremony — the human walks over, finds a green screen, and presses
    Approve to confirm what the machine already verified. So the dossier gate
    auto-approves when zero claims are unverified-and-unquarantined (the same
    predicate `approveGate` enforces), and the script gate auto-approves when
    the self-check found zero warnings — every sentence traced to a verified
    claim. Both record the same opened-and-closed trail a manual approval
    leaves, marked `auto: true`, and notify with the summary the human would
    have reviewed. The voice gate still parks, deliberately: audio cannot be
    machine-checked, and it is the natural final look before M5's paid
    downstream. The parked path is byte-for-byte the old one, and stage
    navigation can always walk back.

100. **The dashboard is the Needs-you queue, always.** §11.3's full-page setup
     checklist gated the dashboard on _all five_ items being done — and two
     (YouTube, music beds) belong to milestones that have not shipped, so the
     queue was unreachable in the running product, forever. Setup is now a
     strip above the queue showing only items actionable today; future-
     milestone items are one muted "coming with M6/M7" line; the Brand Kit
     item is deleted outright (its done-predicate was satisfied by the
     schema's own `min(3)`, so it ticked itself on a fresh install). And the
     music item no longer claims to block the pipeline — nothing before
     assembly needs a bed.

101. **Failure cards retire themselves.** `listFailedRuns` returned every
     failed run in history, so a failure fixed three weeks ago still sat on
     the queue with a red border — the queue the user is meant to empty could
     not be emptied. It now returns only failures whose project is still
     `failed`; acting on the project clears the card, the same way approving
     clears a gate card.

102. **Request changes exists only where something listens.** The button on
     the script and voice gates sent `gate/*.changes_requested` events with no
     subscriber, toasted "sent back to the runner", and dropped the note — a
     control that teaches the user gates ignore them. It now renders on the
     dossier gate alone (the reviser listens there), and the other gates say
     where changes actually happen: the Studio's editor, the voice rows'
     repairs. Similarly deleted: the `budget/aborted` event, sent on every
     abort and awaited by nothing — aborting _is_ `stopProject`, and now says
     so.

103. **Bulk repairs where the per-row click load was the friction.**
     "Quarantine all N" on the dossier claims header (the twelve-claim triage
     was twelve identical clicks) and "Regenerate all N changed" on the voice
     coverage bar (a settings change staled dozens of rows across collapsed
     chapters, and the blocked-reason copy told the user to re-run a stage
     the screen did not offer). Both compute their set server-side from the
     same predicates the approve action enforces.

104. **Labels stopped lying, in one sweep.** "Resume" ran a stage from
     scratch at full cost → "Re-run stage". "Add voice" replaced the narrator
     → "Use as narrator". The overage card said the extra applied to one
     provider; the ceiling is global, and now it says so. The Connections
     banner pointed at a "Budgets tab" deleted on 08-13 → the Costs screen.
     The four credential cards nothing reads before M5/M6 say so. The re-run
     confirm now warns that hand edits to the current script are not carried
     into a newly drafted one. ConfirmButton's escape says "Cancel" like
     every other way out. The top-bar meter gained its denominator
     ($41.20 / $100, coloured past 80%) — a spend without its ceiling cannot
     tell 41% from 98%, and the first sign of a nearly-spent month must not
     be a parked run. Settings `?tab=` deep links finally land on the tab
     they name.

105. **The dead-machinery sweep, each item verified consumer-by-consumer
     before deletion.** Gone: `FREE_PROVIDERS` (zero consumers, unenforced
     safety claim), `GUARDED_PROVIDERS` + its x === x test (the guard reads
     one ceiling), `resetEnvCache`, `firstRunBlockers` (a second, unreachable
     implementation of what `lib/first-run.ts` owns), `deleteCredential`,
     `listUnlinkedRuns` (demo-only), `stripSlashes`, `VoiceTakeStatusSchema`
     (type stays, derived from the const), `SENTRY_DSN` from `.env.example`
     (names a capability that exists nowhere). Kept deliberately: the demo
     pipeline function + test (the only end-to-end coverage of the
     budget-gate-inside-a-step loop) minus its barrel export, which made an
     unregistered function look registered; the M5-M7 event bindings (settled
     contracts); `resolveBrandKit` (the M6 timeline snapshot). Fixed rather
     than deleted: `WaveformSchema` is now parsed at the one write site, so
     the bound its docstring claimed is enforced; the event-drift test
     `inngest/events.ts` promised for years now exists.

106. **Deferred to the next phase, recorded so they are decisions rather than
     omissions:** re-running an upstream stage still rewinds `project.stage`
     and re-gates everything downstream — the full fix (mark downstream stale
     in place, carry unchanged approvals forward) is the single biggest
     remaining gating reduction and needs the stage model reworked, not
     patched; a row-level "narrate this paragraph" for takes that never got
     audio (today the only exit is Stop + re-run); approve-from-the-card on
     the Needs-you queue; toast action buttons; the activity drawer as a
     work list (filter + linked titles). Push notifications stay absent by
     the M4.9 decision — email fills the gap when a Resend key exists.

### M5 — visuals (2026-08-16)

107. **The shot-list model plans, the runner does the arithmetic.** One Haiku
     call per chapter (claim list as the cacheable prefix, like every script
     prompt); the model anchors slots to paragraph indexes and asks for
     seconds, and `timedParagraphs`/`plannedToRows` turn that into real times
     from MEASURED take durations laid end to end — visuals runs after the
     voice gate, so every duration is a bought take, not an estimate. On the
     wire, charts cite claims by list number (`PlannedChartBriefSchema`),
     because models mistype ULIDs; `resolvePlannedBrief` swaps numbers for
     ids and a chart citing a claim outside the list is REJECTED and counted,
     never stored with invented sourcing.

108. **The chart rule has teeth at three layers.** `ChartBriefSchema.dataRefs`
     is `min(1)` — spec §7.4's "a chart brief without claim refs is a
     ValidationError" enforced by schema, not etiquette; conversion rejects
     ghost refs; and the board renders a broken chart brief as an ERROR CARD
     (`role="alert"`), never as a chart.

109. **Hero stays a switch, not a project.** `HERO_SLOTS_ENABLED = false` in
     one place; the schema and UI badge exist, the prompt forbids emission,
     and resolution marks any hero slot `placeholder`. Flipping the flag is
     the whole feature request.

110. **Stock is Pexels + Pixabay, half photos half clips, HD-capped; archival
     is Wikimedia Commons.** Video files above 1920px are rejected at the
     adapter — the render is 1080p and 4K sources are bandwidth spent making
     the export slower. Commons is keyless and its licence field is the whole
     point: reported verbatim (`LicenseShortName`), `Unknown — verify at
source` when absent, artist HTML stripped to plain-text credits. Stock
     pre-flight needs ONE of the two keys (one missing key degrades coverage,
     loudly); zero is a `ValidationError` naming Settings → Connections.

111. **Scoring is metadata-only and says so.** One batched Haiku call per
     slot; the model sees alt text/tags/descriptions/dimensions, never
     pixels, so scores are a ranking aid and the human still chooses from
     thumbnails. Rejection criteria become hard score caps. A candidate the
     model skipped stays unscored and sorts last — visible, not dropped.
     Free searches are NOT wrapped in `withCost`: a $0 reservation guards
     nothing while still writing ledger rows. fal generation IS wrapped, at
     `estimateImageGenUsd` (price owned by the adapter, ~$0.03/image).

112. **FLUX has no negative-prompt input.** It is guidance-distilled; the
     brief's negative prompt is folded into the prompt as an "Avoid:" clause
     rather than dropped silently (principle 6). `verifyKey` leans on fal
     validating auth before method: 401 is a bad key, 405 is a good one,
     nothing is bought.

113. **The chosen candidate lives in the candidates jsonb, not in
     `chosenAssetId`.** A chosen STOCK candidate has no bytes in our storage
     yet — media never streams through the app layer, so stock is
     materialised by the render side in M6 — and `chosenAssetId` points at an
     `assets` row only when bytes already exist. Generated stills are pulled
     into R2 the moment they exist (fal URLs expire), keyed by content hash
     so `assets.contentHash` dedupe holds; uploads the same.

114. **Resolution pre-chooses the top-scored candidate, and the visuals gate
     ALWAYS parks.** The board is for swapping a default, not assembling one
     from nothing — gate 4 would otherwise be forty mandatory decisions.
     But no auto-close: whether the chosen clip actually fits the sentence is
     precisely what no metadata check can answer, so exception-based gating
     (decision 99) does not apply here, same reasoning as the voice gate.

115. **Placeholders approve only through the button's own wording.** The
     primary button reads "Approve with N placeholders"; the action verifies
     the count the button named against the board as it stands, so a board
     that drifted after render refuses a stale click. Unresolved slots block
     outright.

116. **Chart/map previews are pure SVG, not `@remotion/player`.** Spec §11.3
     asks for small player instances, but the compositions package does not
     exist until M6, and a preview faked with a different renderer would
     drift from the eventual frames anyway. The previews draw from the same
     brief the M6 compositions will consume, with the real Brand Kit tokens
     (palette, chart series, semantic collapse red). Maps are schematic —
     points, labels, route, graticule, auto-zoomed bbox — because the story a
     map slot tells is "the money moved from HERE to THERE", not streets.

117. **The scrubber plays paragraph takes sequentially on the shot-list
     clock.** Clicking a slot (filmstrip or card) seeks the narration to the
     moment the slot is on screen; segments hand over on `ended`. True
     gapless concatenated audio is an M6 alignment product; this is the same
     audio at the same moments. The timeline bar is presentational — a 12px
     band can never be a legal 40px control, so jumping belongs to the
     filmstrip and the cards.

118. **`Upload own` takes images only (≤8 MB).** A video upload would stream
     media bytes through the app layer, which the architecture forbids; a
     poster image is small enough to be the exception the narration WAVs
     already are. Uploads land in R2 keyed by content hash, win the slot's
     choice, and the fetched candidates stay for comparison. Re-fetch and
     regenerate go through `visuals/refetch.requested` → `slot-refetcher`,
     which shares `resolveSlotBrief` with the runner so a re-fetch can never
     behave differently from the pass that made the board.

119. **Gemini is the default still generator; fal is the alternative**
     (2026-08-17, user-directed, supersedes the fal-only reading of §14.5).
     The first real run pre-flighted a fal key the user did not have, while
     the Google key already in Settings drives Gemini 2.5 Flash Image
     ("Nano Banana") — same job, no new account. `imageGenAdapter` now takes
     a provider id; resolution picks `google` whenever that key exists, `fal`
     otherwise; either key satisfies the stills pre-flight. Gemini returns
     bytes inline (surfaced as `data:` URLs and decoded straight into R2 —
     the mock-vs-real test is now mock _mode_, never the URL scheme), has no
     `num_images`, so N variants are N parallel calls at ~$0.04/image
     (1290 output tokens at $30/M, rounded up), and folds the negative
     prompt in as an "Avoid:" clause exactly as FLUX does. Cost estimates
     come from the chosen adapter via `imageGenPrice`; `estimateImageGenUsd`
     and `FAL_PRICE_PER_IMAGE` are gone. Licence lines record the generator:
     "Generated (Gemini 2.5 Flash Image)" / "Generated (FLUX.1 dev via
     fal.ai)".

**Spending:** every fetch, score and generation is mocked by default
(`MOCK_PROVIDERS=1`); a real visuals run costs one Haiku call per chapter +
one per fetched slot (scoring) + ~$0.08 per still slot (2 Gemini images;
~$0.06 on fal). Stock and archival searches are free at any volume.

### M4.8 — what the Chirp 3 HD guide said, and I had not read (2026-08-13)

The human sent Google's Chirp 3 HD page. Two things in it contradict claims I
had made confidently, in code comments and to their face, in this same session.

67. **Chirp 3 HD has a pause control, and I said it had none.** The input has a
    `markup` field alongside `text` carrying `[pause]`, `[pause short]` and
    `[pause long]`. I had told the human the only levers were words, punctuation
    and the global pacing slider — twice — on the strength of an adapter comment
    reading _"Plain text, never SSML: the Chirp families do not accept it"_,
    which I wrote from assumption and never checked. SSML is in fact supported
    too, at Preview.

    The adapter now sends `markup` when a paragraph carries a tag and `text`
    when it does not — routing matters, because `[pause long]` sent as `text`
    would be _read aloud_. The re-read form has the three tags as buttons.

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
    Google validates the _phonemes_ against the voice's language and returns the
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
    pronunciation must use sounds the _voice's language_ has. `checkPronunciation`
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

**Status:** `[x]` **done** — CI green on `master` (2026-08-16), branch
`m5-visuals` merged. Suites at close: schemas 168 · providers 287 · web 252 ·
db 170 · cost 31 unit/component/integration, Playwright 80/80.

### Deliverables

- [x] **Typed briefs (`packages/schemas`)** — discriminated union per slot type
      (`stock|archival|still|chart|map|hero`): common fields (covered script
      text, duration, visual description, motion, transition) plus per-type
      shapes per product-spec §7. Chart briefs REQUIRE ≥1 claim `dataRef` at
      the schema level. `hero` typed but feature-flagged off. Candidate schema
      (source URL, dimensions, licence, attribution, score, summary).
- [x] **Shot-list prompt** — Haiku converts the approved script + non-quarantined
      claims into timed slots, one call per chapter with the claim list as the
      cacheable prefix; instructed never to emit `hero` while the flag is off;
      chart values must be verbatim from claims, cited by claim number.
- [x] **Stock adapters (`packages/providers`)** — Pexels + Pixabay behind the
      `StockQuery` interface (photos and clips half each, HD cap); Wikimedia
      Commons for `archival` with the licence field populated verbatim; mock
      adapters, deterministic, thumbnails as inline SVG data URLs.
- [x] **Candidate scoring** — one Haiku call per slot scoring all candidates
      against the brief + rejection criteria (batched, never per candidate);
      metadata-only, scores stored with candidates, unscored sort last.
- [x] **Flux adapter** — fal.ai FLUX.1 [dev] for `still` slots, 2 generations
      per prompt, pulled into R2 immediately (fal URLs expire) as `assets`;
      mock generator prices at the live figure.
- [x] **DB helpers** — `replaceShotList` (transactional whole-board swap),
      script-order listing, candidate selection, brief edit re-opens the slot,
      asset upsert deduped on `contentHash`.
- [x] **visuals-runner** — `gate/voice.approved` → per-chapter shot-list
      generation → key pre-flight from the types the plan actually needs →
      fan-out per-slot resolution → 15% partial-failure policy (failed slots
      become `placeholder`) → gate 4, which ALWAYS parks. `slot-refetcher`
      handles re-fetch/regenerate (the voice-retaker pattern) through the same
      `resolveSlotBrief` the runner uses.
- [x] **Visual board UI** — filmstrip synced to an audio scrubber playing the
      narration takes on the shot-list clock, slot cards with 4-candidate
      strips (Selected ring, score+reason on hover, licence + attribution as
      the audit line), `Edit brief & re-fetch` / `Regenerate` (cost named on
      stills) / `Upload own` (images only), approve requires explicit
      "Approve with N placeholders" wording verified server-side by count.
- [x] **Chart/map live previews** — pure SVG from the brief + real Brand Kit
      tokens; a broken chart brief renders an error card, never a chart.
- [x] **Connections** — pexels/pixabay/fal verifiable (searches and the fal
      auth-before-method check; none of them spend); purpose lines updated.
- [x] **Tests** — schemas 168 · providers 287 · web 252 unit/component, db
      integration for slots/assets, E2E visual-board spec against a seeded
      board fixture; CI green on the merge.

### Not verified

- **The visuals runner end to end.** Same boundary as every runner since M2:
  `@inngest/test` cannot drive a run past a `waitForEvent`, so the
  visuals-runner and slot-refetcher are proven on Inngest Cloud from the
  deployment — which needs the Vercel deployment updated and a project driven
  through the voice gate with real (or mock) providers.
- **Real-provider fetches.** Pexels/Pixabay/Commons/fal adapters are tested
  against recorded fixtures; nothing has been fetched live. First live run
  needs the three keys entered in Settings → Connections (all free to obtain;
  fal is pay-per-image).

---

## M6 — Assembly & render

> Alignment (Whisper.cpp in media-utils + snap-to-script with golden tests),
> timeline compiler + golden tests, music library + picker, compositions
> library with bundled fonts + Studio fixtures, CDK deploy of broker +
> media-utils, broker URL materialisation, preview screen, render flow +
> webhook + QC + stop semantics.

**Deliverables (spec §14.6, §6, §8, §10.1, §11.3), in build order:**

- [x] **M6.1 Timeline contract** — `TimelineSchema` v1 in `packages/schemas`
      (§8.2: brand snapshot, narration, music + ducking curve, captions in
      `@remotion/captions` word format, slots with typed payloads, overlays;
      storage keys only, never URLs), broker API DTOs (`POST /renders`,
      cancel, progress, webhook, media jobs), alignment request/caption
      schemas. Valid/invalid fixtures per schema.
- [x] **M6.2 `packages/timeline`** — pure, golden-tested: snap-to-script
      (Needleman-Wunsch, case/punctuation-insensitive; TIMINGS from the
      aligner, TEXT from the script; unmatched stretches >1.5 s flagged),
      ducking-curve maths (bed gain + duck depth from Brand Kit, cue points),
      timeline compiler (approved board + takes + music + brand snapshot →
      byte-stable timeline JSON, fixture-project golden test).
- [x] **M6.3 Word timings at synthesis** — ElevenLabs adapter switches to
      `/with-timestamps`; character timings stored on `voice_takes`
      (migration; old takes read as timing-less and fall back to Whisper).
- [x] **M6.4 Music library** — Settings → Music library: upload licensed
      beds to R2 (`assets` kind `music`), licence dropdown REQUIRED
      (`yt-audio-library|epidemic|artlist|generated|other`), mood tags,
      inline preview, delete; first-run checklist item 4 goes live.
- [x] **M6.5 `packages/compositions`** — Remotion project importing only
      from `schemas`: `DocumentaryMaster`, components (`KenBurnsImage`,
      `StockClip`, `ChartReveal`, `AnimatedMap`, `LowerThird`, `ChapterCard`,
      `KaraokeCaptions`, `MusicBed`), `AVAILABLE_FONTS` export (bundled,
      SIL-OFL), Studio fixtures, `renderStill` snapshot tests.
      **`AnimatedMap` draws real land outlines from world geometry bundled
      into the repo (no tiles, no network), and the visual board's
      `MapPreview` reuses the same geometry** — closing the "map has no map"
      gap flagged on the Carillion board (2026-08-18); M5's schematic was
      decision 116's stand-in.
- [x] **M6.6 `infra/` CDK** — `boom-busters-broker` (endpoints per §8,
      bearer token, tombstone cancel set, URL materialisation) +
      `boom-busters-media-utils` (FFmpeg layer + Whisper.cpp; qc, loudnorm,
      transcribe; HMAC completion webhooks) + Remotion Lambda function/site
      deploy scripts, `project=boom-busters` tags, concurrency cap 2,
      CloudWatch alarms. Deploy targets the existing Reelscript AWS account —
      **credentials requested from the human when this lands, not before**.
- [x] **M6.7 assembly-runner** — `gate/visuals.approved` → alignment
      (stored ElevenLabs timings when present, else media-utils Whisper,
      mock in CI) → snap → compile → validate → timeline stored by key →
      preview-ready (Gate 5a always parks).
- [x] **M6.8 Preview & render screen** — full-width `@remotion/player` of
      the compiled timeline, chapter markers, caption toggle, duck
      visualisation, music picker (recompile is free), `Render master` with
      est. cost + inline two-step; render-runner (`gate/preview.approved` →
      broker invoke → webhook wait → QC → `project/master.ready`), stop
      semantics with the §8.1 honest caveat, 2 s progress polling.
- [x] Tests land with every part; CI green on every commit; E2E drives
      preview + a local 20-second `renderMedia` fixture render instead of
      Lambda (spec §13).

**Decisions made (M6, continuing the numbering):**

120. **Compiler mappings that the spec left open** (2026-08-18). A worded
     `pan` brief becomes a medium push-in (`kenburns in, 0.10`) rather than a
     frozen frame — a real pan needs per-image framing data the board does
     not collect. Chart slots' motion is owned by their reveal (`draw-on` or
     `static`); map slots are `static` because `AnimatedMap` animates
     internally. Ken Burns speeds map to scale intensities 0.06/0.10/0.16.
121. **Snap-to-script lets a diagonal mismatch donate its timing.** A
     same-position different-spelling pair ("nineteen" vs "€1.9bn") is the
     mistranscription the snap exists to survive: timing from the audio,
     letters from the script. Bracketed performance tags are stripped before
     alignment so a [pause] can never become a caption. Unheard stretches
     > 1.5 s are returned as QC gaps.
122. **Ducking defaults**: attack 200 ms, release 600 ms, and the bed only
     rises into silences ≥2 s — a breath between sentences is not an
     invitation to swell the soundtrack. Points are absolute dB gains,
     strictly increasing, and `gainAt` is the exact interpolation MusicBed
     will mirror, exported so the preview's gain line and the render can
     never disagree.
123. **Golden regeneration is explicit**: `REGEN_GOLDEN=1 pnpm test` rewrites
     `packages/timeline/src/golden/master-timeline.json`; the diff of the
     golden is the review artefact for any compiler change.

124. **Timings ride the same synthesis call** (M6.3, 2026-08-18). The
     ElevenLabs adapter moved to `/with-timestamps` — same price, same audio,
     plus a character alignment collapsed to word timings on the result and
     stored on the take (`voice_takes.timings`, nullable jsonb, migration
     0010). Bracketed tags never get a timing (direction is not spoken), and
     the alignment of the INPUT text is preferred over the normalised one
     because its words are the script's words. Null timings — old takes, or
     a vendor without alignment — mean Whisper at assembly. The mock adapter
     emits deterministic evenly-spaced timings so the alignment path is
     exercised in CI.

125. **Music beds get a `title` column** (M6.4, migration 0011). Assets
     never needed display names until a human had to pick one from a list;
     stock keeps its metadata in candidates, so the column is nullable and
     music simply uses it. Re-uploading the same bytes is a rename/re-tag,
     never a duplicate (content-hash conflict refreshes title/licence/tags
     and keeps the original key). Deletes are DB-first; R2 removal is
     best-effort because orphaned bytes are a lifecycle-rule problem while
     missing rows with live bytes are no problem at all.

126. **The map's world is data in the repo** (M6.5, 2026-08-18). Natural
     Earth 1:110m `ne_110m_land` (public domain), coordinates rounded to
     0.01°, ~75 KB of compact JSON — no tiles, no network, no API key. One
     shared module, `@boom-busters/compositions/geo` (no React/Remotion
     imports), is drawn by BOTH the `AnimatedMap` composition and the
     visual board's `MapPreview`, so the board can never show a different
     world than the render — this closes the "map shot has no map" gap
     from the Carillion board. Projection is equirectangular over the
     fitted window (`fitBounds` extracted verbatim from the M5 preview).
     Visibility culling is bbox + any-vertex-in-window + point-in-polygon
     on the window centre: continent-sized bounding boxes blanket oceans
     they never touch, and Kansas has no coastline vertices yet must
     still be land.

127. **Two contract additions the compositions forced** (M6.5). `gainAt`
     moved from `packages/timeline` into the schemas contract — MusicBed
     may import only schemas, and one interpolation must serve both the
     preview's gain line and the render (timeline re-exports it, one
     import path for the app). `NarrationSegmentSchema`/`MusicTrackSchema`
     gained the optional materialised `url` field MediaRef already had
     (the broker resolves r2Keys at invoke time and needs somewhere to put
     them); `canonicalTimelineIssues` now flags those too.

128. **Snapshots are perceptual, not byte-exact** (M6.5). `renderStill`
     at 0.25 scale through the real webpack + headless-Chrome pipeline,
     compared with pixelmatch (threshold 0.1, allowed differing-pixel
     ratio 3% — 6% for text-heavy frames): Chrome rasterises fonts
     differently per OS, so goldens regenerated on Windows must still pass
     on Linux CI. `REGEN_GOLDEN=1 pnpm test` rewrites them, same
     convention as the timeline goldens; the golden dir and the geometry
     JSON are prettier-ignored. A webpack override strips the `node:`
     scheme and drops `crypto` — schemas hashes content for cache keys,
     compositions never do, and if one ever called `createHash` in a
     render it SHOULD fail loudly.

129. **Three fonts, loaded at render time, unbundled means refuse**
     (M6.5). `AVAILABLE_FONTS` = Inter, Archivo, JetBrains Mono, all
     SIL OFL 1.1, exported as pure data via
     `@boom-busters/compositions/fonts` for the Brand Kit UI (which today
     has no typography editor — the specimen panel era reads it).
     Loading rides `@remotion/google-fonts` (spec-blessed, section 8.2);
     a timeline naming any other family throws before a frame renders —
     never a silent OS-font fallback.

130. **Deliberate stand-ins, recorded** (M6.5). `ShortVertical` (spec
     §8.3) waits for the shorts milestone — the master is what M6 needs,
     and `KaraokeCaptions` already carries the tested 9:16 safe zones.
     The watermark overlay renders a typographic "Boom & Busters"
     wordmark until a logo pipeline exists (brand.look has a logo r2Key
     but no materialisation path yet). The StockClip Studio fixture
     points at a public sample MP4 — dev-only; renders and snapshots
     never touch it. The fixture timeline is a materialised copy with
     data-URI media, and its test asserts the canonical guard FLAGS it —
     the guard working is part of the fixture's job.

131. **The broker API DTOs live in schemas, built with M6.6 not M6.1**
     (2026-08-18). M6.1's checklist named them but only the timeline
     contract was actually built then — corrected here rather than
     papered over. `broker.ts` now carries render requests/progress/
     cancel, the loose Remotion webhook shape, the four media jobs with
     typed results (qc report, loudnorm, whisper words, YouTube upload),
     the callback envelopes, and the HMAC sign/verify pair both sides of
     every webhook share. The broker never invents IDs: the app's ULIDs
     key every record, tombstone and callback.

132. **One callback route for everything asynchronous** (M6.6). The
     broker's normalised render outcome and every media-utils completion
     POST HMAC-signed payloads to a single app hook (built in M6.7); the
     app verifies and emits the Inngest events. The Lambdas never hold
     Inngest credentials, and dev/CI work identically because events
     enter through the app.

133. **Lambda Function URL, S3 state, no DynamoDB** (M6.6). The spec
     allowed API Gateway or function URLs — the URL costs nothing and
     bearer auth is app-level either way. Render records, the remotion-id
     index and the 8.1 tombstones are S3 objects in the state bucket
     (lifecycle: renders 90 d, broker state 180 d); at one-user render
     volume a database would be ceremony. Cancel tombstones BEFORE
     updating the record, so racing the webhook can never emit a
     completion event. The concurrency cap (2) counts running state
     records and refuses with 409 before any money moves.

134. **Remotion keeps its version-encoded function name** (M6.6).
     Remotion Lambda does not support custom function names;
     `boom-busters-render` stays the logical name, the deploy script
     prints the physical one into REMOTION_FUNCTION_NAME, and the
     cost-allocation tag does the accounting. The deploy script also
     publishes the compositions site through the same webpackOverride the
     snapshot tests bundle with — one bundling path, no drift.

135. **QC thresholds and media-job conventions** (M6.6). Silence ≥ 2.5 s
     at -45 dB, black ≥ 1.5 s, frozen frame ≥ 0.5 s ("glitch scan"),
     integrated loudness within ±1.5 LU of target (-14 master / -16
     voice); an unmeasurable loudness FAILS QC, never passes it. Storage
     routing is by prefix: keys under `boom-busters/` are R2, anything
     else is the Remotion render bucket — the two never share a prefix.
     Whisper tokens (-ml 1) join into words on the leading-space
     convention; bracketed noise is dropped. Daily spend guarding is an
     AWS Budget (email direct), not billing-metric gymnastics; alarms
     cover errors, 5xx, signature failures and cap-busting concurrency.

136. **One snap pipeline, whatever the timing source** (M6.7). Takes
     with stored ElevenLabs timings and takes transcribed by Whisper both
     go through the same snap-to-script and the same QC-gap definition —
     ElevenLabs timings are already script text, so the snap is a no-op
     there, and uniformity means one code path, one gap report, one set
     of tests. In mock-provider mode alignment is evenly-spaced words
     across the take's measured duration, so CI exercises the exact
     snap/offset arithmetic live audio would.

137. **Assembly is restartable; the beyond-runners fixture moves on**
     (M6.7). `assembly` joined RESTARTABLE_STAGES (re-enters on
     `gate/visuals.approved`, requires a script). The production-shaped
     "past the last runner" e2e fixture moved from `assembly` to `shorts`
     — its own comment says the shape moves with every milestone. The
     broker hook route (`/api/hooks/broker`) is live: HMAC-verified
     callbacks become `render/completed`, `render/failed` or the new
     `media/job.completed` event; signature failures are logged and
     401'd, signed-but-unreadable payloads are logged and 200'd so a
     version skew can never become a retry storm.

138. **Timeline plumbing defaults** (M6.7). Versions are append-only
     (`insertTimeline` validates against TimelineSchema on the way in;
     an old renders row must be able to say exactly what it rendered
     forever); the compiled JSON is uploaded to
     `boom-busters/timelines/<project>/v<n>.json` when storage is
     configured. The first preview's music bed is simply the newest
     track in the library — the M6.8 picker swaps beds and recompiles
     for free, so this is a starting point, not a verdict. Slots that
     cannot compile (placeholders, hero, missing bytes) are skipped AND
     counted into the gate summary; Gate 5a always parks.

139. **One cost estimate, two quoters; one interpolation, three readers**
     (M6.8). `estimateRenderCostUsd` moved into `schemas` beside `gainAt`:
     the Render button's number and the broker's accept response come from
     the same formula, and the preview's gain line, `MusicBed` and the
     ducking compiler all read the same `gainAt`. `RenderProgressSchema`
     gained an optional `outputUrl` — the broker presigns the finished
     master on progress requests, because it is the only party holding AWS
     credentials, and "the master playable from S3" needs a URL the app
     can hand a <video>.

140. **`DocumentaryMaster` gained `calculateMetadata`** (M6.8) — a latent
     M6.5/M6.6 bug: the composition's duration was pinned to the 14-second
     Studio fixture, so any real timeline handed to the deployed site would
     have rendered exactly 14 seconds and stopped. Duration, fps and frame
     size now follow the inputProps timeline. Also new:
     `renderFixtureTimeline()`, a 20-second extension of the fixture
     (deep-cloned; the snapshot goldens' fixture is never touched) and
     `scripts/render-timeline.ts`, the local `renderMedia` path used by
     mock-mode renders and the E2E suite alike.

141. **`Render master` IS the gate approval** (M6.8). Section 7.6 triggers
     the render-runner on `gate/preview.approved`, so the button calls
     `approveGate(projectId, 'preview')` — one click, one event, and the
     assembly-runner's park closes as the render begins. The runner
     reserves the spend on the cost ledger BEFORE the broker invoke
     (provider `remotion` — `CostSpec` widened to the ledger's own enum,
     since Remotion and YouTube spend money without holding an API-key
     card) and settles it from the webhook's actual cost.

142. **Mock renders render the 20-second fixture, for real** (M6.8). In
     mock-provider mode the render-runner spawns a genuine local
     `renderMedia` — bundle, Chrome, h264 — but of the self-contained
     fixture rather than the project timeline, whose mock narration lives
     behind the app's authenticated audio route that headless Chrome has
     no session for. QC is a constructed pass (media-utils does not exist
     locally); the file lands under `RENDER_LOCAL_DIR` as `local://<id>`
     and is served by `/api/renders/[id]/file` in mock mode only. E2E
     renders the same fixture once in global-setup (cached in
     `e2e/.artifacts`), seeds it as a done render, and asserts the QC
     card, a playable ~20 s master, and the two-step confirm.

143. **The preview materialiser drops what it cannot resolve, and says
     so** (M6.8). Compositions throw on unmaterialised media by design; a
     preview exists to be looked at now, so `materialiseForPreview`
     resolves `mock://` narration to the voice-audio route, presigns real
     keys when R2 exists, passes external URLs through — and DROPS
     anything unresolvable, counted into an "N items not previewable"
     notice instead of a crashed player. Stopping mid-render marks the
     row cancelled and tombstones the broker from the stop action itself
     (the cancelled Inngest run can no longer do it); the Stop confirm
     carries the §8.1 caveat verbatim, and a finished master beside an
     open gate offers "Render again" — a music swap is free, but pixels
     are an explicit spend decision every time.

### M6.9 — the AWS deploy, and what only a real account teaches (2026-08-18)

The M6.6 stacks were "deployable and tested offline"; deploying them for
real surfaced five faults, none visible to the template tests, every one
found by driving the deployed thing and reading its logs.

144. **A stale CDK v1 flag broke every CLI invocation.**
     `infra/cdk.json` carried `@aws-cdk/core:enableStackNameDuplicates`,
     which the v2 CLI rejects outright. The template tests construct
     `App` directly and never read `cdk.json`, so this shipped green.
     Removed; there is no offline guard for it, but the very first
     `cdk synth` of any deploy now covers it.

145. **`RENDER_BUCKET` was a hardcoded placeholder.** The media-utils
     stack ignored the export the README asked for and baked in
     `remotionlambda-unset` — QC of a finished master would have hit a
     bucket that does not exist. Wired through `InfraConfig.renderBucket`
     with a template test pinning it (test-first; it failed red).

146. **The account caps Lambda memory at 3008 MB.** AWS tiers new
     accounts: the "Max allocated MicroVM memory" quota reads 8 GB
     against a service default of 400, and the increase API refuses
     requests below the default — the tier rises with account history,
     not on request. `MEDIA_LAMBDA_MEMORY_MB` overrides per deploy
     (deployed at 3008); the spec's 10,240 stays the default and the
     template test still asserts it.

147. **The broker died at init: CJS bundling vs `@remotion/lambda`.**
     Remotion calls `createRequire(import.meta.url)` at module scope and
     esbuild's CommonJS output rewrites `import.meta.url` to `undefined`,
     so every invocation was a 502 before any code of ours ran. Both
     Lambdas now bundle as ESM with the documented aliased banner
     (`createRequire as topLevelCreateRequire` — unaliased, it collides
     with the bundle's own declaration). Proven by curl: 401 without a
     token, 401 with a wrong one, 404 with the right one.

148. **A whisper binary that runs on Amazon Linux is not one that runs
     on Lambda.** The default build links `libgomp.so.1`; the Lambda
     Node 20 runtime image ships no OpenMP, so transcription would have
     crashed on first use. Built with `GGML_OPENMP=OFF` (ggml's own
     thread pool) and `GGML_NATIVE=OFF`, and verified inside
     `public.ecr.aws/lambda/nodejs:20` before upload — the layer README
     now records the exact commands, because "build per whisper.cpp's
     README" is precisely what produces the broken one.

     Also new: `pnpm deploy:stacks` (`scripts/deploy-stacks.ts`) replaces
     the README's manual export dance — R2 values and the owner email
     read from `.env.local`, the broker token from
     `~/.boom-busters-broker-token`, the Remotion outputs required from
     the environment because they change with every Remotion version.

     **Deployed and live (2026-08-18):** CDK bootstrapped in `eu-west-1`;
     Remotion function `remotion-render-4-0-512-mem2048mb-disk10240mb-240sec`
     - compositions site; both stacks CREATE_COMPLETE; whisper binary and
       `ggml-base.en.bin` in the WhisperAssets bucket; `AWS_BROKER_URL` /
       `AWS_BROKER_TOKEN` in `.env.local`. Still open: the same two
       variables in Vercel (production calls the broker from there), the
       SNS subscription confirmation email, and the real staging render.

### M6.10 — the first production preview, and what it taught (2026-08-19)

Driving the stranded Carillion project through assembly on the deployed
app found two faults the suites could not see, both now guarded:

149. **The proxy ate every Lambda callback.** `/api/hooks/broker` was not
     in PUBLIC_PATHS, so completion POSTs from the broker and media-utils
     were 307'd to /signin; fetch followed, took the sign-in page's 200 as
     delivery, and the waiting run timed out 30 minutes later — twice,
     while Whisper succeeded both times in 12 seconds. The route's unit
     tests call the handler directly, so the proxy never sat between
     them; `broker-hook.spec.ts` now POSTs through the real proxy
     (unsigned must get the route's own 401, never a redirect).

150. **The preview player needs browser-frame-rate discipline the render
     never does.** Offline, a frame may take as long as it likes; the
     @remotion/player has 33 ms. Three fixes, snapshot-verified: the map
     projects the world geometry once and plays the camera settle as an
     affine group transform (the projection is linear, so pixels are
     identical; strokes keep width via vector-effect); the chart layout
     is memoised off the frame path; and narration sequences premount
     4 s early with `pauseWhenBuffering`, because an <Audio> mounting at
     the frame it must already be playing is an audible glitch at every
     paragraph boundary.

     Also: both Lambdas moved to Node 24 (AWS retired nodejs20.x, Health
     notice 2026-08-19); the whisper binary re-verified in the Node 24
     runtime image before the redeploy.

151. **Chosen stock is ingested into R2 at assembly time; the timeline
     never hotlinks a provider URL again.** The candidate contract always
     said stock "is pulled into storage by the render side in M6"
     (`SlotCandidateSchema`), but M6's assembly instead wrote
     `candidate.sourceUrl` into the timeline as an `externalUrl`. Pixabay
     download URLs are session-signed and die within a day: in the first
     live preview all 16 Pixabay shots were HTTP 400 broken images, and
     the master render would have failed on the same URLs. Now
     `apps/web/lib/stock-ingest.ts` downloads each resolved stock or
     archival slot's chosen candidate (one Inngest step per slot),
     stores it content-hash keyed under `boom-busters/stock/`, records
     an asset row, and writes the key back into the candidate jsonb.
     When the stored URL has already expired, the provider's new
     `refetch` (Pexels and Pixabay, by permanent id — a Pixabay id
     lookup answers 400 for "gone", not 404) mints a fresh one. A slot
     ingestion cannot secure bytes for is SKIPPED with the reason
     (`slotPlan`'s `unusable` map), never hotlinked: a URL that just
     refused a download is a URL the render cannot trust either. Bytes
     do stream through the app layer here — the same documented trade
     as fal stills and narration; a broker `ingest` job can take over
     the transport later. Re-running the assembly stage repairs a
     timeline compiled before this fix.

152. **The preview can be fully buffered on demand.** "Buffer full
     preview (N files)" on the preview screen pulls every media URL the
     materialised timeline references into blob URLs via Remotion's
     `prefetch` (four at a time, freed on unmount), so playback then
     never touches the network — no mid-play buffering and no presigned
     URL expiring mid-session (they live one hour). A button rather
     than automatic, per the button-first rule and because it moves
     hundreds of megabytes the human should choose to download.

153. **The R2 bucket needs a browser CORS policy for the buffer button.**
     `prefetch` is a `fetch()`, and fetch enforces CORS where the player's
     media tags never did — so a bucket with no CORS policy plays back
     fine and fails every single prefetch (all 89 files, 2026-08-20).
     The app's R2 token is object-scoped and cannot edit bucket settings
     (`PutBucketCors` → AccessDenied), so the policy is set once by hand:
     Cloudflare dashboard → R2 → bucket → Settings → CORS policy, allowing
     GET/HEAD from the deployed origin and localhost:3000. The catch in
     `BufferControl` now `console.warn`s each failed URL so the browser
     names the reason instead of a bare count.

154. **Player media tags send CORS requests (`crossOrigin="anonymous"`),
     player only.** With the bucket policy in place, buffering still
     failed for exactly the files the player had already preloaded: media
     tags fetch without an Origin header, the browser caches those
     header-less responses, and the buffer button's `fetch()` of the same
     URL is answered from that cache and CORS-blocked (the console's
     `ERR_FAILED 304` was the tell). `mediaCrossOrigin()` returns
     `anonymous` under `isPlayer` and undefined offline, so both consumers
     make CORS requests and agree on the cached copy while the renderer —
     which has no page origin the bucket policy lists — is untouched.
     Consequence, noted on decision 153: the R2 CORS policy is now
     required for live preview PLAYBACK, not just buffering.

155. **The buffer stopped sharing the browser's HTTP cache with the
     player.** Decision 154's crossOrigin pass fixed most poisoned-cache
     failures but one image (the paused player's frame-0 poster) kept
     losing the race, so the dependence on cache-entry compatibility went
     away entirely: `BufferControl` now downloads with `cache: 'no-store'`
     (always a fresh CORS request — verified good against R2 for the
     failing object, preflight included) and the player is handed a
     timeline whose media URLs are replaced outright by blob URLs
     (`substituteMedia`). "Plays from memory" is now literal, Remotion's
     internal prefetch registry is no longer involved, and a URL the blob
     map lacks degrades to exactly the pre-buffer behaviour. Blob URLs are
     revoked on unmount; a recompiled timeline (music swap) resets the
     control via `key={version}`.

156. **The player's media engine is WebCodecs (`@remotion/media`);
     the render's is unchanged.** With the network fully out of the
     picture (89/89 buffered to blob URLs), small playback glitches
     remained. Root cause research: in the @remotion/player the core
     tags are HTML5 media elements — video stays in sync by corrective
     seeking (0.45 s drift threshold) and audio plays through a pool of
     five shared tags whose src is swapped at every Sequence boundary.
     With 37 narration paragraphs and 50-odd slots, every swap and seek
     is a small glitch by construction; premounting, half-resolution and
     buffering could shrink but never remove them. `mediaEngine()` now
     forks the three media tags (StockClip, narration, MusicBed): the
     offline render keeps OffthreadVideo/core Audio — the goldens pin
     that path byte-for-byte — while the player gets @remotion/media,
     which decodes with WebCodecs, paints video frame-exact onto a
     canvas, schedules audio sample-accurately through Web Audio, and
     falls back to the core tags automatically if a codec, CORS or the
     browser refuses. The Player also keeps its AudioContext alive
     across pauses (`_experimentalKeepAudioContextAlive`). If glitches
     ever matter again beyond this, the remaining option is a cheap
     draft render for moderation — the master render was always
     perfectly smooth; only the live preview ever glitched.

157. **Preview proxies: videos are ingested twice, full-quality for the
     render and a small variant for the browser.** With the WebCodecs
     engine live and everything buffered, playback measured clean here
     (55 fps, one 51 ms long task in 22 s — the earlier "stalls" were
     the measurement's own screenshot overhead), yet still hiccuped
     rhythmically on the production machine, whose graphics acceleration
     had been off. Decode cost scales with SOURCE pixels: the ingested
     clips are 1080-1920 px, and a machine on software decode cannot hold
     30 fps on them — the engine then pauses honestly (buffer state),
     which reads as "buffering every few seconds". So ingestion now also
     stores the provider's small variant (Pexels SD, Pixabay small/tiny —
     smallest ≥426 px wide; `previewSourceUrl` on the candidate,
     `previewR2Key` once ingested, minted fresh by id when expired), the
     timeline's MediaRef carries it, browser materialisation presigns it
     as `previewUrl`, and the player's `<Video>` decodes the proxy — about
     nine times cheaper — while `OffthreadVideo` offline always uses the
     full clip. A missing proxy is never an error, and re-running
     assembly gives already-ingested videos a preview-only pass.

158. **Assembly's output is a watchable draft, not only a timeline.** The
     proxies made the live player good, not smooth: at a 6x CPU throttle
     (the production machine's shape) it manages 14 fps with nineteen
     half-second pauses in 20 s, while a native `<video>` element playing
     the same proxy file holds a locked 60 fps with zero drops — per-frame
     React on the main thread is the ceiling, not the data. So the
     assembly-runner now sends `render/draft.requested` after storing a
     timeline (live mode with broker and R2 only — mock stays free), and a
     new `draft-runner` renders a half-resolution copy on Remotion Lambda:
     renders `kind: 'draft'` (enum migration 0012), Remotion `scale` from
     `RENDER_SCALES` in the contract, cost a quarter of the master's
     (scale squared) through `reserve`/`settle` as `render-draft`. The
     draft never touches gates or stages — Gate 5a still parks, "Render
     master" is still the spend decision, and a draft failure (budget
     included) fails only its own renders row. The preview screen's Draft
     card plays the file natively, shows which timeline version it
     rendered (a free music swap leaves it a version behind, said out
     loud), and offers "Re-render draft" as an explicit ~$0.06 confirm.

159. **LiveRefresh polls a pulse, not the page — Neon's transfer
     allowance was going into a 3-second loop.** One project-page render
     from assembly onward reads ~400 KB out of Postgres (timeline JSON
     45 KB, voice takes 101 KB, slot candidates 138 KB+, measured
     2026-08-21 on a 7 MB database), and LiveRefresh re-ran the whole
     page every 3 s for as long as any run was moving: ~8 MB of Neon
     egress per run-minute, which is what emptied the month's transfer
     quota. Now `/api/pulse` answers an opaque change token (epoch of
     the newest change to the project row, its run mirror, or a run
     event; `projectPulse`/`globalPulse` in the db package) and
     LiveRefresh re-renders only when the token moves — a failing pulse
     degrades to the old refresh-every-tick bargain rather than going
     stale. Renders are deliberately outside the pulse: their progress
     writes land every 2 s and the render panel already self-polls;
     the run mirror still moves on every runner step, so terminal
     transitions refresh. Also: `deploy:stacks` now defaults
     MEDIA_LAMBDA_MEMORY_MB to 3008 (the account's Lambda cap) so
     `--all` deploys stop tripping over the spec's 10,240 MB ask;
     export the big number once the quota increase lands.

160. **The first live draft failed silently — three fixes from one 502.**
     `POST /renders` died because `renderMediaOnLambda` discovers
     Remotion's bucket via `s3:ListAllMyBuckets`, an account-wide read
     the broker's role must not have (the M6.6 smoke test only exercised
     GET routes, so no live invoke had ever run). The bucket is known at
     deploy time: the broker now carries `RENDER_BUCKET` and passes
     `forceBucketName`. Around the failure, two silences: (a) the run
     died after retries with the renders row still 'queued', so the
     Draft card showed an honest-looking 0% forever — both runners'
     `onFailure` now calls `failInFlightRenders` (new db helper) so the
     row says why, and the progress route promotes a broker-reported
     failure onto the row immediately instead of waiting out the
     30-minute webhook grace; (b) each retry of the invoke step
     re-reserved the estimate and never settled it — three phantom
     $0.0572 reservations counted against the ceiling (released by
     hand). `submitRender` failures now release their reservation
     before rethrowing, in both runners. The Draft card also shows a
     pulsing "Rendering" cue while in flight.

161. **The render fan-out is capped to fit a 10-concurrency account.**
     The retried draft got past the invoke and died on Remotion's side:
     "AWS Concurrency limit reached (Rate Exceeded)". This account's
     Lambda concurrency quota is 10 (verified via get-account-settings —
     the new-account throttle; mature accounts get 1000), and Remotion's
     default fan-out for a 14-minute video spawns far more chunk lambdas
     than that. The broker now computes `framesPerLambda` from the
     timeline's own clock so a render fits in `RENDER_FANOUT` chunks
     (default 4: one orchestrator + four renderers + the broker + a
     webhook stays inside 10). Fewer chunks means bigger ones, so the
     Remotion function is redeployed at Lambda's 900 s maximum timeout
     (was 240 s — 6,300-frame chunks need the headroom); its name embeds
     the timeout, so the broker's REMOTION_FUNCTION_NAME moved with it.
     The real fix is the quota: request "Lambda Concurrent executions →
     1000" in Service Quotas, then raise RENDER_FANOUT and enjoy fast
     renders. (Both happened: the quota landed 2026-08-22, fan-out 150
     deployed; the 240 s function was deleted 2026-08-23.)

162. **The player's residual glitch was the page refreshing under it;
     with that gone, the buffer button and the automatic draft are
     withdrawn.** A run parked at Gate 5a still counts as live, so
     LiveRefresh's 3-second full-page loop ran through every moderation
     session — each refresh re-materialised the timeline with freshly
     signed URLs, the player saw "new" sources mid-play and re-decoded
     (the rhythmic hiccup), the buffer button's blob map was keyed to
     URLs each refresh replaced (why buffering "didn't persist"), and a
     paused frame blinked as its source was swapped. The pulse (159)
     removed the loop and the already-shipped player fixes (WebCodecs
     engine, preview proxies) finally showed: playback is smooth from
     the network. So: the buffer button and `substituteMedia` are
     deleted; the automatic draft request is removed from the
     assembly-runner (158 withdrawn); and the preview screen offers two
     explicit spend choices side by side — "Render draft" (~quarter
     price, half resolution, the real-output check) and "Render master"
     (still the gate approval). The draft card remains, display-only,
     shown when a draft exists.

### Verified (M6.8, 2026-08-18)

- **`pnpm typecheck`** and **`pnpm lint`** clean, zero warnings.
- **`pnpm test`** — 1161 tests across 9 workspaces (schemas 199 · db 178 ·
  providers 297 · web 299 · cost 31 · ui-tokens 21 · timeline 35 ·
  compositions 58 · infra 43).
- **`pnpm e2e`** — 85 Playwright tests, mock-provider mode, including
  `preview-render.spec.ts` against a real ~20 s local `renderMedia` master
  rendered once in global setup and cached in `e2e/.artifacts`.
- One flake fixed during verification: the CDK synth `beforeAll` in
  `infra/test/stacks.test.ts` now carries an explicit 120 s timeout. Under
  full-suite load its module import alone took 18 s and the synth blew
  vitest's 10 s default; alone, the same file passes in under 9 s. Timing,
  not a regression.

**Status:** `[x]` complete (closed 2026-08-22, branch `m6-assembly` merged
to master). M6.1 to M6.10 done: timeline contract; snap/ducking/compiler
with goldens; word timings at synthesis; music library live in Settings;
Remotion component library with bundled world geometry, fonts, Studio
fixtures and renderStill snapshots; broker + media-utils CDK stacks
deployed to the Reelscript account in eu-west-1, whisper assets uploaded,
broker smoke-tested live; assembly-runner compiling stored timelines and
parking at Gate 5a; preview & render screen live in production with
pulse-driven refresh and side-by-side draft/master render buttons, the
render fan-out capped to fit the account's 10-concurrency quota.

One item deliberately deferred, not dropped: the **real staging master
render on Lambda** could not complete until AWS granted the concurrent-
executions quota increase. UPDATE 2026-08-22: the 2026-08-19 request had
landed in us-east-1 (wrong region — quotas are per-region); the eu-west-1
case filed 2026-08-22 was GRANTED the same day (1000 concurrent).
`RENDER_FANOUT` raised to 150 and the broker redeployed. The old 240 s
Remotion function was deleted 2026-08-23 (existence verified, the broker
confirmed pointing at the 900 s one, delete returned 204, gone on
re-read). Still open: the FUNCTION MEMORY cap is a separate limit (a
10,240 MB media-utils deploy was attempted and refused with "MemorySize
must be ≤ 3008"; clean rollback) — it needs a Support Center
service-limit case, human action. The staging render itself remains with
M8, now unblocked.

---

## M7 — Shorts & publish

> Shorts-runner + UI, YouTube OAuth + resumable upload + error mapping +
> quota queue, publish calendar + thumbnail dropzone, private-until-audit
> checklist mode.

**What already exists** (surveyed 2026-08-22, before the first M7 commit):
the `shorts` and `publish_records` tables shipped in the M1 skeleton;
script-runner stores `shortsCandidates` on the script (5 segments with hook
rationale); `project/master.ready` is in the events registry and
render-runner's QC step is specced to emit it; media-utils already
implements the `upload-youtube` resumable job (8 MB chunks, resume on
5xx/308); `KaraokeCaptions` has 9:16 safe zones. What does not exist:
`ShortVertical` composition, a vertical timeline compiler, shorts-runner,
publish-runner, the YouTube OAuth flow, the error mapper + quota queue,
and the Shorts and Publish screens.

**Deliverables (spec §14.7, §9, §7.2 items 7-8, §11.3), in build order:**

- [x] **M7.1 Vertical timeline** — `compileShortTimeline` in
      `packages/timeline` slices the canonical MASTER timeline by
      segmentRef (decision 163): narration re-clocked to zero, captions
      windowed with text untouched, slots clipped (front-clipped videos
      gain trimStartMs), 1080×1920, shorts-style bed with a rebuilt
      ducking curve, loop/CTA ending (decision 164, new `endCta` overlay
      variant in the contract), 180 s ceiling enforced. Golden
      `short-timeline.json` plus 9 behaviour tests; full suite green
      (9 workspaces), typecheck and lint clean.
- [x] **M7.2 `ShortVertical` composition** — registered as its own id
      with 9:16 fixture defaults and timeline-driven metadata, but ONE
      renderer serves both formats (decision 165): the component wraps
      the master's, which gained an `EndCta` branch in its overlay
      chain. New `EndCta` card component; `FIXTURE_SHORT_TIMELINE`
      (hand-built vertical materialised fixture); snapshots for
      `ShortVertical` (chart + live caption + CTA card in one frame)
      and `EndCtaFixture`, goldens reviewed visually; 66 compositions
      tests green. NOTE: the deployed Remotion site must be redeployed
      before the first live Short render — it predates `ShortVertical`.
- [x] **M7.3 shorts-runner + Shorts screen** — two runners, not one
      (decision 166): `shorts-runner` (`project/master.ready`) resolves
      each candidate's sentence anchors to a paragraph range
      (`resolveCandidateSegment` in schemas, sharing `sentenceHash`'s
      normal form), compiles as validation, writes `shorts` rows and
      fans out one `shorts/render.requested` per row; a re-fired
      master.ready keeps curated rows (decision 167).
      `short-render-runner` (concurrency 2) compiles the Short at its
      CURRENT ending + shorts-style bed, invokes `ShortVertical` via
      the broker, waits the webhook, runs QC; failures mark only that
      Short's row; a step retry reuses its queued row instead of
      orphaning it. Mock mode finishes the bookkeeping reusing the
      local fixture master's file (decision 169). Shorts screen per
      §11.3: card grid, 9:16 player off the 2 s progress poll's
      presigned URL, explicit Save for title/description, ending
      toggle that nulls `renderId` with an inline consequence when a
      render exists (decision 168), two-step Render with est. cost,
      related-link chip. Tests: 4 schemas resolver, 4 db shorts
      integration, 3+4 runner, 9 component.
- [x] **M7.4 YouTube OAuth** — `lib/youtube.ts` (auth URL with exactly
      the three §9 scopes + `access_type=offline&prompt=consent`, code
      exchange, access-token refresh distinguishing `invalid_grant` as
      needs-reconnect, `channels.list` ping);
      `/api/youtube/connect` + `/callback` (state cookie as the CSRF
      lock, declined consent is not an error, refresh token stored
      AES-GCM under provider `youtube`, ping verdict stamped in the
      same breath so the first-run "Connect YouTube" only completes
      against a real channel); `youtubeRefreshToken(db, key)` reader;
      Connections tab gains the YouTube card (OAuth, not a key paste:
      health chip, Connect/Reconnect link, Verify button). The DAILY
      ping rides M8's analytics cron — the only cron (decision 171);
      the media-utils token-refresh callback endpoint lands with the
      publish-runner (M7.6), its first caller. Tests: 9 lib, 6 route,
      5 card.
- [x] **M7.5 Error mapper + quota queue primitives** —
      `mapYoutubeError` in schemas: vendor strings in, five typed actions
      out (`requeue-tomorrow`, `pause-queue 24h`, `reconnect`, `retry`,
      `fail`), reason tokens outranking the HTTP status because a 403 is
      three different stories; `describeYoutubeAction` for
      notifications; `quotaDayStartUtc` bounds "today" at midnight
      PACIFIC, where YouTube actually resets quota (decision 172).
      DB side: `publish_records.upload_started_at` (migration 0013,
      applied to prod + test), `beginUpload` (the §5 atomic
      `draft→uploading` with the stamp inside it), `countUploadsSince`
      (failures included — their quota units were spent). The runner
      wires these in M7.6. Tests: 12 mapper/quota-day, 3 integration.
- [x] **M7.6 publish-runner** — one `publish/requested` per item
      (`{targetType, targetId, attempt?}`), concurrency 1. Preconditions checked
      in words and refusals leave the record in `draft` with the reason
      in its error field (decision 173): slot chosen, metadata parses
      against `PublishMetadataSchema` (YouTube's own limits), thumbnail
      present (masters), related-link ticked + finished render (Shorts),
      YouTube connected (live). Daily budget over → notify + sleep into
      the next Pacific quota day, re-check once, defer honestly if still
      spent. Then the §5 atomic claim, the media-utils `upload-youtube`
      job carrying a freshly minted SHORT-LIVED access token and
      `privacyStatus:'private'` + `publishAt`, the webhook wait (7 h),
      failures through the error mapper (requeue/pause re-emit after
      their sleeps; `retry` re-emits with an attempt cap of 3;
      `reconnect` stamps the credential invalid), `thumbnails.set` for
      masters (a failure warns, never unschedules), a bounded processing
      poll, `status='scheduled'`, notification. Mid-upload token refresh
      DEFERRED (decision 174). Tests: 6 with the Inngest harness.
- [x] **M7.7 Publish screen** — the next 14 days of the Publishing
      settings' UTC slots as a calendar (labels local), click-first
      scheduling (select an item, press the slot's button) with
      drag-to-slot layered on top (decision 177); one item per
      publishable thing — the master, then each Short — with status
      chips `draft→uploading→uploaded→scheduled→live`, the mapped error
      and a Retry on `failed`, and every runner refusal readable on the
      card (decision 173 pays off here). Item editor: title free-edit +
      the 8 generated options as radios (the 'metadata' LLM task via
      `buildTitlesRequest`/`parseTitleOptions`, `mockTitleOptions` for
      free in mock mode), description live preview composed by
      `composeDescription` — editable opening seeded with the script's
      hook paragraph, then chapter stamps (≥3, first forced to 0:00),
      dossier sources, and the baked-in disclaimer, sources trimmed
      from the end to fit 5000 (decision 176) — tags, and for masters a
      thumbnail dropzone (PNG-only, ≤2 MB, ≥1280×720 — IHDR-parsed
      server-side, decision 181; up to 3, first "set via the API", rest
      flagged for manual Test & Compare in Studio, Canva template
      link). `schedulePublish` writes the `publish_records` row FIRST —
      `ensurePublishRecord` (lazy create, decision 179), composed final
      metadata validated against `PublishMetadataSchema` — then emits
      `publish/requested`. Shorts→publish is the Shorts screen's
      explicit "Continue to Publish" button (decision 178).
      **Private-until-audit**: while `apiAuditPassed` is unset, the
      checklist ends in "flip it to public in YouTube Studio". Tests:
      8 prompt, 9 composer, 2 db integration, 16 screen, +2 elsewhere.
- [x] **M7.8 E2E** — a seeded project at the shorts stage (three
      chapters for the stamp block, a verified sourced claim, a
      compiled timeline, a finished master, one schedulable Short and
      one unrendered) driven through the whole fifth gate by visible
      buttons only: the Shorts screen's curation and its "Continue to
      Publish" handover, the audit checklist and budget line, mock
      title generation → radio pick → explicit save → persistence
      across reload, the composed description preview (hook, 0:00
      stamps, source URL, disclaimer), a master refused at the slot in
      words while it has no thumbnail, and a Short's schedule click
      proven record-FIRST: the slot survives a reload whatever the
      orchestrator's availability. 6 tests; the suite total is 93.
      (Also: global-setup now clears `publish_records` — polymorphic,
      no FK, so nothing cascades it away — before seeding, or the
      runner unit tests' upload starts count against the budget line.)
- [x] Tests land with every part; CI green on every commit.

**Decisions made (M7, continuing the numbering):**

163. **The Short compiler slices the compiled master, never the board**
     (2026-08-22). `compileShortTimeline` takes the canonical master
     timeline plus a segmentRef and re-clocks the window to zero. The
     master already carries everything in its final, human-approved form:
     measured narration audio, captions snapped to the script, visuals
     whose bytes were ingested at assembly. Recompiling from board rows
     would re-run that work and could drift from what the preview gate
     approved. Re-framing 16:9 media into 9:16 is not the compiler's job
     either: the slot components cover-crop whatever canvas they are
     given. A video slot clipped at the window's front gains trimStartMs
     so its visible frames match what played at that moment of the master.
164. **Ending semantics: a loop is an absence, a CTA is an overlay**
     (2026-08-22). A loop ending adds nothing to the timeline; the cut
     itself hands the last frame back to the first. A CTA ending is a new
     `endCta` overlay variant in the contract (props: text), emitted over
     the final 2600 ms — the chapter card's screen time. Masters never
     carry it. The compiler also enforces YouTube's 180 s Shorts ceiling
     as a hard ValidationError, because an overlong vertical would not
     fail — it would silently upload as a regular video.
165. **One timeline renderer, two registered compositions** (2026-08-22).
     `ShortVertical` wraps `DocumentaryMaster` rather than duplicating
     it: everything format-specific (canvas, windows, safe zones, the
     ending) lives in the timeline the Short compiler produced, and the
     slot components cover-crop into whatever canvas they get. A second
     renderer would be a second place for the formats to drift. The
     separate registration exists so the broker addresses
     `ShortVertical` by id and Studio shows the vertical fixture.
166. **Shorts render as one Inngest run per Short, not one parent loop**
     (2026-08-22). `waitForEvent` only matches events arriving AFTER the
     wait starts, so a parent waiting on N completions in sequence would
     miss any render that finished before its turn. Per-Short runs give
     every render a wait that starts before its own submit; the
     function's `concurrency: 2` is the spec's "parallel, capped", and it
     matches the broker stack's RENDER_CAP so the queue forms in Inngest,
     visibly, instead of as broker 429s.
167. **A re-fired master.ready never recreates shorts rows**
     (2026-08-22). The rows carry human curation — titles, endings,
     related-link ticks. If any exist, the runner keeps them all and
     creates none; re-rendering against the new master is each card's
     explicit button. Candidate resolution failures are skipped with a
     reason in the run result, never guessed at: a mis-anchored segment
     would put the wrong words in a Short.
168. **`shorts.renderId` points at the render of the CURRENT
     configuration** (2026-08-22). Toggling the ending nulls it (with an
     inline-two-step consequence when a render exists) rather than
     leaving it aimed at a render of something else; the old render row
     survives in `renders` because its cost was real. Title and
     description do not null it — they are publish copy, not pixels.
169. **Mock Short renders reuse the local fixture master's file**
     (2026-08-22). Rendering a real vertical per Short in CI would cost
     minutes each; skipping entirely (the draft's choice) would leave the
     Shorts screen and the E2E suite with no cards to drive. So mock mode
     completes the row against the master's `local://` file — a 16:9
     file in a 9:16 player is visibly a stand-in, which is honest.
170. **The OAuth flow forces `prompt=consent` and treats the state cookie
     as the lock** (2026-08-22). Without forced consent Google omits the
     refresh token on a repeat grant — the connection would store nothing
     and read as connected. The state rides an httpOnly cookie scoped to
     `/api/youtube` and is deleted on arrival whatever happens; a
     mismatch refuses before any token call. `invalid_grant` is
     distinguished everywhere as "needs reconnect": it is the one failure
     a retry can never fix, and the chip says so in words.
171. **The daily `channels.list` ping rides M8's analytics cron**
     (2026-08-22). Spec §7 is explicit that the analytics-runner is "the
     only cron"; adding a second scheduler for a 1-unit health ping would
     contradict it. Until M8, health is stamped at connect time and by
     the card's Verify button — the same check, human-triggered.
172. **The upload budget counts STARTS, in Pacific time** (2026-08-22).
     YouTube's API quota resets at midnight America/Los_Angeles, not UTC;
     a UTC day would free the budget seven-to-eight hours early. And a
     start that later failed still spent its 1600 units, so
     `uploadStartedAt` is stamped inside the atomic `draft→uploading`
     transition and counted regardless of what became of the upload.
173. **A refused precondition is not a failure** (2026-08-22). The
     publish-runner writes the reason into the record's error field and
     leaves it `draft`: the Publish screen shows why and the same button
     works once it is fixed. Only a real upload failure (or a dead run's
     onFailure) moves a record to `failed`.
174. **The §9 mid-upload token-refresh callback is deferred**
     (2026-08-22). The spec sketches media-utils calling back to the web
     app if an upload outlives its access token. Tokens live ~1 h; a
     master streams S3 → YouTube on Lambda's NIC in minutes. The
     machinery (a new endpoint, HMAC auth for it, Lambda-side refresh
     handling) is real cost against a failure mode nothing has exhibited
     — build it when a real upload ever dies at the ~1 h mark, which the
     mapped timeout error would make visible.
175. **Deferrals sleep in the run, not in a scheduler** (2026-08-22).
     Requeue-tomorrow and pause-queue both `sleepUntil` inside the same
     durable run and re-emit `publish/requested` — no cron, no second
     queue, and the Inngest dashboard shows exactly what is waiting and
     until when. The `retry` action re-emits with `attempt+1`, capped at
     3, so a flapping YouTube cannot loop forever.
176. **The description is composed, never generated** (2026-08-23). Only
     titles come from a model; the description's blocks all exist on
     file already (hook paragraph, chapter stamps from the master
     timeline, sources from the dossier's verified un-quarantined
     claims), and a model restating facts is how a description ends up
     contradicting its video. The 5000-char ceiling is met by dropping
     sources from the end, never by truncating — a cut-off disclaimer is
     a liability, not a description. The disclaimer itself (with the
     AI-disclosure sentence, spec §9) is a baked-in constant rather than
     a setting: it is legal copy, and a configurable field makes "forgot
     to set it" a publishable state. `descriptionBody` (the human's
     opening) lives beside the final `title/description/tags` in the
     same metadata jsonb; the runner's schema ignores the extra keys.
177. **Scheduling is click-first; drag is a layer on top** (2026-08-23).
     Spec §13 has the E2E suite assert no action needs anything but a
     visible button, so drag-to-slot cannot be the only path. Select an
     item (or it self-selects), and every eligible future slot carries
     its own "Schedule here" button; the same cells accept a dragged
     card. Long-form slots refuse Shorts and vice versa, in words.
178. **Shorts→publish is a button, not a gate** (2026-08-23). Curation
     has no machine-detectable "done", so no runner waits on the Shorts
     screen and an approval event would fall on no one. "Continue to
     Publish" moves the stage directly; `projectControl` now treats
     `shorts`/`publish` at `awaiting_review` with no live run as the
     designed state ("working"), not a stranding to warn about.
179. **Publish records are created lazily, by the screen's first touch**
     (2026-08-23). `ensurePublishRecord` (INSERT … ON CONFLICT DO
     NOTHING, then read) backs every action — a saved draft, a
     thumbnail, generated titles, the schedule click — so the row exists
     the moment anything is worth keeping and never exists twice. The
     schedule action writes slot + composed metadata to the row FIRST
     and only then emits `publish/requested`, the spec §7.2 ordering: a
     runner firing between the two finds a claimable record.
180. **Scheduling falls back to the working title** (2026-08-23). The
     editor's title field shows the Short's (or project's) title before
     any draft is saved, so refusing the schedule click for "no title"
     would contradict a screen that plainly displays one. A saved draft
     title wins; otherwise the working title is written into the final
     metadata, cut to YouTube's 100. A slot occupied by the SELECTED
     draft also keeps offering its button ("Start the upload again"):
     a runner refusal or a failed event send leaves a draft-with-slot,
     and re-pressing the slot is the way to ask again once fixed.
181. **Thumbnail dimensions are read from the PNG's IHDR bytes**
     (2026-08-23). YouTube wants ≥1280×720 and ≤2 MB; the server
     re-checks what the client validated, and pulling an image library
     into the web app for two big-endian uint32s at fixed offsets is not
     worth the dependency. Non-PNG bytes fail the signature check and
     are refused with "export one from Canva" — the workflow the spec
     names. The Canva link goes to their YouTube-thumbnail templates;
     no per-channel template URL exists anywhere to deep-link.

182. **One `render/settled` event; never two waits under `Promise.all`**
     (2026-08-23, found live). The first real draft render finished on
     Lambda in four minutes and the screen said "Rendering 100%" for
     forty: the runners waited on a `render/completed`/`render/failed`
     PAIR with `Promise.all`, which cannot settle until BOTH waits do —
     and the event that never fires only settles at its timeout
     (timeoutMinutes + 10 grace). Diagnosed from production evidence:
     render row parked, broker record `completed` with the webhook
     logged at 18:53, run mirror showing the runner asleep since
     18:49, and the 21st's draft waking at exactly the 40-minute mark.
     The broker hook now emits ONE `render/settled {result}` event
     (§9's own wording — "normalise into one Inngest event") and all
     three render runners wait exactly once. The `@inngest/test` suites
     never caught it because they resolve waits instantly; only wall
     clocks exhibit it.
183. **The broker normalises Remotion's URL-shaped `outputFile` to a
     key** (2026-08-23, found live). Remotion's completion webhook
     reports the output as a full `https://s3…/bucket/renders/…` URL
     while its progress API reports the same file as a key; the broker
     forwarded the webhook's version, a URL landed in
     `renders.output_s3_key`, every downstream presign broke on it,
     and the draft player got an unloadable source. The broker now
     derives the key (path-style and virtual-hosted URLs both handled,
     deterministic `renders/<id>/out.mp4` fallback), with core tests
     pinning it. The one affected production row and its broker state
     record were hand-repaired the same day; the file verified
     servable (206, video/mp4) afterwards.
184. **QC findings are warnings, not a verdict** (2026-08-23, decided by
     the owner after the first real master render). That render came out
     fine and QC rejected it anyway: 219 "frozen frame" flags (slow Ken
     Burns zooms and static title cards sitting under `freezedetect`'s
     0.003 noise threshold, which identical-by-design frames will always
     trip) plus one real loudness miss (-18.7 LUFS against -14, since
     nothing in the pipeline loudnorms the final mix). A hard fail on a
     playable file was a dead end with no reason shown. Now: the master
     and Short runners mark the render `done` with the report attached,
     the stage moves on and `project/master.ready` still fires; the
     preview screen shows the report as located warnings: chapter-level
     grouping, a per-kind likely cause and fix, raw timestamps behind a
     labelled button. Spec §7.6's "never auto-publish around a QC
     failure" holds by construction because publishing is a human button;
     only QC that never RAN still fails the stage. Same day, same screen:
     the "Handed to the render pipeline" note returned whenever the run
     SETTLED (both done and failed are `!inFlight`) and sat on top of the
     report and the master; it now clears the first time the run is seen
     in flight, with a regression test.

185. **The test database is a local Docker container, never a Neon
     branch** (2026-08-24, decided by the owner after an outage). Neon
     meters data transfer per PROJECT and the free plan caps it at 5 GB
     per month; the Neon-branch test database shared that quota with
     production, the network-hosted integration suites drained it, and
     when it ran out Neon refused every query (PostgresError 53000,
     "exceeded the data transfer quota") and the deployed site 500'd on
     all pages (surfacing as minified React #441, the RSC error wrapper).
     Diagnosed by reproducing locally: dev server against the same
     DATABASE_URL, mock sign-in, full stack in the dev output. Now:
     `TEST_DATABASE_URL` points at `boom-busters-test-db`, a local
     `postgres:16-alpine` container on port 5433 (matching CI's service
     image), migrated via `pnpm db:migrate:test`; all guidance texts
     (test-database.ts, migrate-test.ts, e2e/database.ts, .env.example)
     now prescribe the container. Neon carries production traffic only.
     Side benefit: the db suite dropped from network-bound to 45 s. The
     human still owns two console actions: upgrade the Neon plan (the
     block lifts within minutes; nothing needs redeploying) and delete
     the now-unused test branch.

186. **Project-page review models load per view** (2026-08-24, the data
     side of decision 185's diet). The page used to fetch every stage's
     review model on every server render: the dossier with all claims,
     the full script, the voice takes, the visual board, and from
     assembly onwards the timeline JSON — roughly 400 KB a render, most
     of it for stages nobody was looking at. Now `viewing` is resolved
     FIRST and each model loads only when its stage is on screen or is
     the project's current stage (the gate action bar needs its context
     and blockers); presence flags for `projectControl` and the re-run
     guard come from the summary row (`dossierVersion`, `hasScript`),
     because "not loaded" must never read as "does not exist". The
     preview model also loads while the project sits at assembly with
     another stage on screen: the header's Stop must know whether a
     master render is in flight. New `emptyVoiceModel`/
     `emptyVisualsModel` mirror the existing empty preview/shorts/
     publish shapes.

187. **The preview screen is one stage with three cuts** (2026-08-24,
     redesign approved by the owner). Preview, Draft and Master are the
     same video at three levels of reality, but the old layout scattered
     them: the free approximation owned the hero surface for ever while
     the deliverable played inside a 340px sidebar card, which is where
     both of the week's confusions ("the draft won't play", "the master
     doesn't show") came from. Now three labelled tab buttons above ONE
     large surface, each carrying its state (version, rendering %, QC
     warnings, cost); the most final cut is the default; starting a
     render switches the stage to it; chapter buttons seek whichever cut
     is showing (the Player for the preview, the <video> element for a
     file — that is how a QC warning gets scrubbed); the QC report sits
     directly under the master it describes. The sidebar keeps only
     decisions and facts: stats, music, the Render card (spends,
     failures, Stop). A failed cut still gets no tab — its reason lives
     beside the button that retries it.
188. **Loudnorm before QC, same key in and out** (2026-08-24). Section
     7.6 always said "loudnorm to -14 LUFS integrated"; the QC job only
     ever MEASURED, which is why the first real master failed at -18.7.
     Now the master and Short runners submit a loudnorm job between
     completion and QC: media-utils is container-aware (an .mp4 output
     copies the video stream untouched, re-encodes only the audio to
     AAC, keeps `+faststart`), and the job overwrites the SAME S3 key —
     safe because the upload only happens after ffmpeg succeeded — so
     the broker presign, the stage player and the YouTube upload all get
     the corrected file with zero bookkeeping. A loudnorm that fails or
     times out downgrades to a warning, never a dead end: QC still runs
     on the original file and its loudness finding says what happened.
     Voice chunks keep the original wav path untouched.

189. **The visuals stage is staged: an editable plan before any asset is
     fetched** (2026-08-26, owner-approved design at
     `docs/superpowers/specs/2026-08-26-staged-visuals-design.md`). The
     runner now parks TWICE inside the one stage: after shot-list
     generation it stops with nothing fetched and nothing spent
     (`visuals_phase='plan'`); the owner edits briefs, re-types slots and
     optionally pre-fetches single ones; "Fetch visuals · N slots ·
     est. $X" (`visuals/plan.approved`) wakes it to resolve and park on
     the familiar board (gate 4, `visuals_phase='board'`). The no-waste
     guard: every resolution stores `resolved_brief_hash`, and any fetch
     pass skips a slot resolved for its current brief, so nothing is
     bought twice — uploads stamp the hash too. Re-typing
     (`visuals/retype.requested` → slot-retyper): stock/archival/still
     convert mechanically (`convertBrief`); chart and map get one small
     model call that drafts the series/claim-refs or coordinates,
     schema-validated and refusable (a chart still may never cite
     nothing). In board phase a retype re-fetches immediately; in plan
     phase it stops at the brief. The generic GateActionBar is
     suppressed during plan phase — its Approve would speak an event the
     runner is not listening for. In-flight caveat at deploy: no
     production run was parked at the visuals gate (the one live project
     is at shorts), so the changed step sequence strands nothing.

190. **The format picker converts text-driven types inside the button
     press; only chart and map go through the retyper — and both of
     those states are visible on the card** (2026-08-27, fixing the
     owner's "switching is glitchy, chart and map don't work"). The
     first cut sent EVERY re-type through `visuals/retype.requested`,
     so the action returned, toasted success and refreshed before the
     retyper had written anything: the badge only changed on a second
     click's refresh (or the next pulse tick), and a chart/map draft,
     which adds a model call, looked entirely dead — worse, a refusal
     lived only in the run's return value, which nothing reads.
     Now: stock/archival/still convert in `retypeSlotAction` itself —
     `convertBrief` is pure and moves no money, the same class of write
     as a brief edit, which the actions file already applies directly
     (board phase then re-fetches through the existing refetch event).
     Chart and map stamp the new `shot_slots.retype` jsonb (`drafting`)
     before the event goes, so the very refresh the button triggers
     already says what is happening; the retyper replaces the marker
     with `refused` + the model's reason (dismissable on the card, new
     `dismissRetypeAction`), clears it on success/no-op/budget-gate, and
     `onFailure` clears it too — a dead run must not say "drafting"
     forever. Migration 0015 (additive) applied to the test container;
     production migrates on deploy.

191. **The Calendar rail page is the cross-project week view; scheduling
     stays on each project's Publish screen** (2026-08-27). The M7
     placeholder promised "drag-to-slot scheduling" globally, but
     slotting an item needs its draft metadata, thumbnails and
     description composer — all of which live on the per-project Publish
     screen M7 built. Duplicating that machinery globally would be a
     second scheduler to keep honest. So `/calendar` shows one
     Monday-anchored UTC week of EVERYTHING slotted across every project
     (new `scheduledPublishItems` join — `publish_records` carries no
     projectId, masters join `projects` directly, Shorts through their
     card), status chips through draft→uploading→scheduled→live, the
     still-open default slots from Settings → Publishing, week
     navigation as visible link-buttons, and a deep link per item to
     `?stage=publish` on its project. Days group by UTC day, the same
     convention the per-project calendar established; only labels are
     local. The `MilestonePlaceholder` component is gone — that was its
     last user.

192. **The Brand Kit live specimen panel exists** (2026-08-27, closing
     the deferred half of decision 4 — M6 shipped its dependencies but
     never circled back). Settings → Brand Kit now mounts one
     `@remotion/player` cycling four three-second beats — chapter card,
     lower third, chart, karaoke captions — through the SAME components
     the render farm uses, with `resolveBrandKit` over the form's own
     optimistic state, so a colour edit re-renders the specimen as it
     saves. Fixture content on purpose: fixed words make two palettes
     comparable. Loaded via `next/dynamic` (`ssr: false`) so the other
     five settings tabs never pay for Remotion in their bundle.

### M8

193. **Analytics snapshots store lifetime-to-date numbers, and the digest
     subtracts two of them** (2026-08-27). Per-day deltas from the API
     would go silently wrong the first day a cron never ran; two
     lifetime totals subtract correctly across any gap. Two honesty
     limits recorded with the data: the Analytics API exposes no
     impressions CTR, so the spec §5 `ctrBySource` column carries views
     by traffic source type (the closest thing the API answers); and
     `rpm` stays null until the `yt-analytics-monetary.readonly` scope
     is granted, which means a reconnect and is therefore an owner
     decision, not a default.

194. **The cron is the system's only schedule, and the manual refresh is
     an event** (2026-08-27). `analytics/refresh.requested` exists so the
     owner has a button and the tests a trigger, but it feeds the same
     function with a concurrency limit of 1 — the cron and a manual
     refresh can never interleave their upserts.

195. **Two app-wide a11y corrections from the Lighthouse pass**
     (2026-08-27): `CardTitle` renders h2 (h1→h3 fails heading-order on
     every screen whose cards sit directly under the page title), and
     dark `--color-text-muted` moved zinc-500 → `#84848e` with a
     ui-tokens test now holding muted ≥ 4.5:1 on background and surface
     in both themes — the token was theorised as decoration but actually
     captions facts at 12px. Scores after: dashboard 100, Script Studio
     100, Publish 100.

**Blocked on the human (2026-08-24):** the Neon plan upgrade landed the
same day — the site is back, Neon carries production only. Previously:
nothing as of 2026-08-23 — the OAuth client,
redirect URIs, API enablement, test user and both environments' env vars
are all in place (see the status block above). Everything was built and
tested mock-first per CLAUDE.md rule 6; the first live connect is a
button press away.

**Status:** `[x]` **done** — all eight parts landed on `m7-shorts`,
merged to `master` and deployed (2026-08-23); suites at close:
schemas 227 · providers 308 · db 193 · web 397 · e2e 93, typecheck and
lint clean. Live YouTube is fully provisioned by the human
(2026-08-23): OAuth client (shared with sign-in), both redirect URIs,
YouTube Data API v3 enabled, test user added,
`YOUTUBE_CLIENT_ID`/`SECRET` in `.env.local` AND Vercel production —
Settings → Connections → Connect is ready to press. Testing-status
caveat: Google expires the refresh token after 7 days until the app is
published and audited. The daily `channels.list` health ping and the
"Reconnect YouTube" Needs-you card ride M8's analytics work
(decision 171).

---

## M8 — Analytics & polish

> Analytics-runner + retention-vs-chapter overlay, weekly digest, alarms,
> mobile passes, button-affordance audit, empty states, Lighthouse, full E2E,
> staging render, one real video produced.

**Status:** `[~]` in progress — branch `m8-analytics-polish`, started 2026-08-27.

### Deliverables

- [x] **M8.1 analytics-runner** — daily cron (the only cron, spec §7.2 item 9):
      `channels.list` health ping stamping the YouTube credential's
      verifyStatus (decision 171); scheduled→live reconciliation via
      `videos.list` privacyStatus (nothing else ever flips a record to live —
      the human publishes in Studio while `apiAuditPassed` is off); YouTube
      Analytics snapshots (retention curve, views, avg view duration, traffic
      sources) per live video into `analytics_snapshots`; mock-provider mode
      end to end. Plus `analytics/refresh.requested` so the owner has a
      button and the tests a trigger.
- [x] **"Reconnect YouTube" Needs-you card** — driven by
      verifyStatus='invalid' on the youtube credential row, aged from the
      stamp, deep-linking to Connections.
- [x] **M8.2 retention-vs-chapter overlay** — the master's watch ratio over
      its own chapter boundaries, server-rendered SVG on the Publish screen,
      present once a snapshot exists, honest when the curve is not out yet.
- [x] **M8.3 weekly digest** — Mondays inside the cron: deltas computed in
      code from snapshot pairs, narrated by the `digest`-routed model,
      delivered through `notify()`. Over-budget digests are skipped, never
      parked.
- [x] **M8.4 Sentry** — web + Inngest (one init in `instrumentation.ts` —
      the functions run inside the Next server) + both Lambdas
      (`wrapHandler`), release-tagged from the deploy SHA, INERT until a DSN
      exists: the SDK is not even imported without one. No sourcemap upload
      by decision — a build that needs a Sentry account is a build that
      fails for the wrong reasons. Lambdas read SENTRY_DSN/SENTRY_RELEASE
      at CDK deploy; needs a redeploy plus a DSN from the human to go live.
- [x] **M8.5 CDK alarms** — found already SHIPPED with M6.6, not owed:
      broker errors, broker 5xx, webhook signature failures, render
      concurrency at the cap, media-utils errors and throttles, and the
      daily AWS spend budget, all → the `boom-busters-alerts` SNS topic
      with the ALERT_EMAIL subscription. §12's remaining item, YouTube
      quota exhaustion, is app-level by design: the M7 error mapper
      requeues and notifies on quotaExceeded. M8 added only the Sentry
      env passthrough test. Verify ALERT_EMAIL was set at the last stack
      deploy (and confirm the SNS subscription email) — human action.
- [x] **M8.6 polish pass** — audited rather than assumed: empty states were
      already on every list screen (verified, not built); the ≥40px audit
      already runs on every major screen via `expectHitTargets`; the 390px
      passes gained the two review screens §13 names (dossier approvable
      from a phone with the gate bar live; Script Studio single-column, no
      sideways scroll). **Lighthouse a11y: dashboard 100, Script Studio
      100, Publish 100** (bar: ≥95), after three real fixes — the icon-only
      Sign out button below the `sm` breakpoint gained its aria-label; dark
      `--color-text-muted` raised zinc-500 → `#84848e` (zinc-500 was 3.66:1
      on the card surface, and the token captions real facts at 12px — age
      labels, timecodes, licence lines; a ui-tokens test now locks muted ≥
      4.5 on background and surface in both themes); `CardTitle` renders h2,
      not h3 (cards sit directly under most screens' h1, and h1→h3 fails
      heading-order). Method: real Lighthouse runs against the mock dev
      server with a session cookie, errors-only pages, scores in the JSON.
- [x] **M8.7 E2E gaps** — the staged-visuals leftovers all paid: slot-retyper
      integration tests (mechanical, chart-with-claims, refusal-on-the-row,
      no-op clears the marker), the plan-phase e2e spec on a new seeded
      fixture (priced Fetch button, planned chips, no generic Approve,
      save-only edits, re-type landing in-click), `visuals_phase` nulled on
      visuals restart. The §13 "full flow" is covered piecewise across the
      spec files — writing room (case → dossier → script), voice, visual
      board and plan, preview + local render + QC, shorts, publish — which
      is the shape the fixture-seeded, no-live-Inngest suite supports; the
      one uncut end-to-end pass is what M8.8's real video IS. e2e suite: 96
      desktop + 6 mobile.
- [ ] **M8.8 staging render + first real video** — the real-Lambda staging
      master of the fixture project, then one real 15-minute video end to
      end. Both spend real money; both wait for the owner's explicit
      go-ahead.

---

## Post-M8 UX — inline dossier claims, wider Studio

> Owner-requested spec amendments (2026-08-28) after reviewing the deployed
> pipeline on a real project: the dossier read as raw markdown next to a
> half-screen claims table, and the Script Studio's context panel spent
> 280px repeating the gutter. Spec §11.3 amended in place; branch
> `ux-dossier-script`.

### Deliverables

- [x] Dossier renders as formatted text (own minimal parser, never HTML);
      claims anchor inline as pressable highlights opening a modal with the
      full row actions; a claims bar always lists whatever blocks approval,
      anchored or not, plus a list-all toggle and Quarantine all.
- [x] Script Studio context panel dropped; Shorts candidates fold into a
      strip under the selected chapter's editor; the editor takes the width.
- [x] Voice `Flag` kept as-is by decision after discussion: it is the
      zero-cost bookmark of the listen-through, distinct from the two paid
      repairs; revisit after the first real video.
- [x] A scheduled video's slot can be moved (owner request, 2026-09-01):
      `reschedulePublish` re-points the YouTube `publishAt` then the row;
      the screen offers "Move the slot" on scheduled items and "Move here"
      on empty matching slots, drag included. Live items refuse.
- [x] The dossier answers its own open questions (owner request,
      2026-09-01): a fourth research pass takes the brief's open questions
      and answers each from the record before the dossier lands; answered
      questions render as "Questions the research answered" with sources,
      facts surfaced while answering join the claim list, and only honest
      nulls remain under "Open questions".
- [x] Claims carry their source URL even at low confidence (owner report,
      2026-09-01): the extraction prompt no longer couples confidence to
      having the exact article link — outlet-level URLs are the named
      fallback, search-engine links are scrubbed at the schema, and only a
      claim whose origin cannot even be named arrives URL-less.
- [x] Scripts are humanized and performance-directed at drafting time
      (owner request, 2026-09-01): the house style gained a "Sound like a
      person" block distilled from github.com/harshaneel/humanize, and the
      chapter prompt's "no stage directions" rule is reversed — the drafter
      now places [pause] and expression tags inline, where the voice stage
      reads them.

**Decisions (continuing the numbering):**

196. **Claims anchor to the dossier text fuzzily and honestly**
     (2026-08-28). `lib/dossier-markdown.ts` parses a deliberate markdown
     subset (headings, lists, paragraphs, bold, italic, http links; anything
     else stays literal text — model output is never interpreted as HTML,
     preserving the old `<pre>`'s injection stance) and anchors each claim
     by folded verbatim match first, then best-sentence token overlap ≥
     0.55, else reports it unanchored. Unanchored claims are listed, never
     hidden, and every blocking claim is always on screen: a claim you
     cannot find is a gate you cannot pass. Inline highlights are real
     buttons — the 40px hit target bought with padding + negative margin so
     the prose line flow is untouched. The seed's dossier body now states
     two fixture claims verbatim (and upserts contentMd on conflict) so the
     highlight path is testable end to end.

197. **The Studio's third column is gone** (2026-08-28). Its warnings
     section duplicated the gutter markers and the outline's per-chapter
     counts; its only unique content, the Shorts candidates, moved to a
     collapsible strip under the selected chapter's editor that renders
     nothing when the chapter has none. The editor gets the 280px back,
     which is where a 15-minute script is actually read.

198. **Rescheduling reads the status back before writing it** (2026-09-01).
     "Once it's set it's set" was a gap, not a rule: a scheduled video is
     private with a `publishAt`, and `videos.update` moves it. Two things
     shaped the implementation. First, the update replaces the WHOLE status
     object, so `movePublishAt` reads it back and writes it whole with only
     the moment changed — a bare `{publishAt}` would silently reset
     embeddability, licence and the made-for-kids declaration. Second,
     YouTube is written before the row: the row must never claim a moment
     the platform does not hold. Only `scheduled` moves; `live` refuses
     (nothing left to move), `uploading` refuses (nothing settled yet), and
     the action runs in the server action directly — the same place the
     Settings Verify button already talks to providers — because a 2-call
     JSON update needs no runner. In the e2e suite `scheduled` is
     unreachable through the UI (no orchestrator), so the spec promotes the
     record directly, the same pattern as `touchQueuedProject`.

199. **Humanize at drafting time, and let the drafter direct the read**
     (2026-09-01, owner request). The house style prompt gained a "Sound
     like a person" block distilled from github.com/harshaneel/humanize
     (MIT): banned AI vocabulary, hard sentence-length variance, one
     canonical name per referent, asymmetric contrasts, hedge surgery, no
     summing-up closers. Two of its rules are deliberately rejected — em
     dashes stay (they are the narrator's hesitation channel), and the
     legal hedges ("alleged", "reportedly") are mandatory, not filler; a
     humanizer that cut them would walk defamation into a script. And the
     chapter prompt's "no stage directions" line — which contradicted the
     same prompt's own tag guidance and is why generated scripts carried no
     expressions — is reversed: the drafter places [pause] and expression
     tags inline. Safe because everything downstream already reads the
     script through `stripNarrationMarkup` (captions proven by
     snap.test.ts; warnings, claim refs and Shorts anchors match through
     `normaliseForMatch`), which is exactly why the tags were put in
     `contentMd` in the first place.

200. **Confidence describes the record; the URL is the starting point**
     (2026-09-01, owner report). The extraction rule "omit sourceUrl and
     mark the claim unverified" coupled two different things: a model
     researching from memory knew the FT reported something (sourceType
     major_outlet) but lacked the article link, so it omitted the URL, and
     `DraftClaimSchema`'s demotion — which stays, it is the right guard —
     then blocked the gate with claims that showed no source at all. Now
     the prompt asks for the most specific REAL URL on every claim,
     publication- or regulator-level when the article is not to hand, and
     defines unverified as "cannot say who reported it". Search-engine
     links (google/bing/duckduckgo/yahoo) are scrubbed in
     `usableSourceUrl`: a search engine is where you look for a source,
     not a source, and a scrubbed link demotes the claim honestly. Net
     effect: fewer false blockers, and the ones that remain carry a
     starting point for the verify flow.

201. **The dossier answers its own open questions** (2026-09-01, owner
     request: "the Dossier should be a complete brief"). A fourth research
     pass — `research-answers-{round}`, shared by runner and reviser via
     `researchDossier`, skipped when the brief raised nothing — puts the
     brief's open questions back to the model with the timeline in hand.
     Each answer needs a source; any narratable fact inside an answer must
     ALSO appear in the claims output (an answer is prose, only claims are
     gated), and those claims merge into the list deduplicated by
     normalised text. The one thing the owner's "no open questions" did
     not get: `answer: null` stays legal, rendered under a now-smaller
     "Open questions" section, because the record genuinely does not
     answer some questions (sealed, unreported, before a court) and a
     model forced to answer anyway would invent — which is the exact
     liability the claims gate exists to stop. Mock mode answers nothing,
     loudly, so no fixture ever looks researched.

202. **A paragraph with no spoken words is not a narration unit**
     (2026-09-01, owner bug report: a lone `[long pause]` block became its
     own voice paragraph and failed synthesis forever). Root cause was the
     drafting prompt itself — "write [pause] on its own" taught the model
     to put tags on their own line. Three-part fix: the prompt now says a
     tag is never its own paragraph; `splitParagraphs` drops any block
     whose `stripNarrationMarkup` form is empty (a paragraph is one TTS
     request, and a request with no words can only fail — the silence
     between paragraphs is assembly's gap, not the vendor's); and
     `replaceParagraph` skips the same blocks when counting and refuses a
     tag-only replacement, so a Fix-the-words edit cannot make a paragraph
     vanish and shift every later index. Existing tag-only blocks stay in
     `contentMd` (visible in the Studio) but never become units; a voice
     re-run renumbers units past the block and claims fresh takes for the
     shifted keys, orphaning the stale pending row nothing addresses.

203. **Answers are placed by question number, and a real answer is never
     discarded** (2026-09-01, owner bug report: a fresh dossier still showed
     every open question). The first live run of decision 201's answers
     pass proved the join key wrong: the cost ledger showed the answers
     call produced the largest output of all four passes (about two
     thousand tokens of real answers), yet the dossier rendered no
     answered section — Haiku paraphrased every question it echoed back,
     the folded-text match placed none of them, and the renderer silently
     dropped the lot. Now the request numbers the questions, the schema
     carries an optional 1-based `index` (optional so a forgetful model
     does not fail the parse), and the renderer places by index first,
     falls back to folded text, and renders any non-null answer it still
     cannot place under the model's own wording rather than discarding
     research that was paid for — with the unplaced answer's question
     honestly left open. Placed answers render under the brief's wording,
     because the brief is what the human read.

204. **Music uploads must fit through the framework's own door**
     (2026-09-01, owner bug report: "Add to library" did nothing). Next
     caps server-action request bodies at 1 MB by default, so every real
     audio file was refused before `uploadMusicBedAction` ever ran; the
     awaited call rejected, the component had no catch, and the button
     silently did nothing — the worst possible answer to a press.
     Three-part fix: `experimental.serverActions.bodySizeLimit: '30mb'`
     in next.config (25 MB per MUSIC_MAX_BYTES plus multipart headroom);
     the component now catches a rejected action call and says so in a
     toast, for upload and delete both; and a client-side size check
     refuses a >25 MB file before uploading a byte the server would
     refuse anyway.

205. **Music uploads go browser → R2 directly** (2026-09-01, superseding
     decision 204's body-cap raise, which proved insufficient). Measured
     on production: a 3 MB POST reaches the app, a 5 MB POST is 413'd at
     Vercel's edge — the platform caps request bodies at about 4.5 MB
     regardless of Next's `bodySizeLimit`, so a 5-10 MB music bed can
     never travel through a server action. Design principle 2 now applies
     on the way in as on the way out: `createMusicUploadAction` validates
     type/size/fingerprint and issues a presigned PUT URL for the
     content-hash key (15 min TTL, content type in the signature); the
     browser PUTs the bytes to R2 itself; `finaliseMusicBedAction`
     verifies with `headObject` that an object of legal size exists at a
     key this flow could have issued, then writes the row. The SHA-256 is
     computed in the browser over the same bytes that upload — trusted
     for key-picking in a single-owner console, verified for existence
     and size server-side. The `bodySizeLimit` raise was reverted with a
     comment saying why it cannot work. MANUAL STEP: the R2 bucket needs
     a CORS rule allowing PUT from the app's origins (the app's R2 token
     cannot manage CORS — set in the Cloudflare dashboard).

206. **A variant sourceType label folds onto the enum, never fails the
     pass** (2026-09-01, owner bug report: dossier re-run died with
     "Invalid option" on three of nineteen claims' sourceType). The same
     demotion-not-rejection rule that already governed sourceUrl and
     confidence now covers sourceType: recognisable variants keep their
     strength ("court_documents" → court, "SEC filing" → regulator,
     "news_article" → major_outlet), anything unrecognisable lands in
     "other", the designed weakest bucket. Refusing was strictness with
     nothing to protect — the field drives display and self-check tone,
     not money or publication — and it threw away a paid research pass
     over labels. The old "refuses a source type outside the enum" test
     is deliberately reversed.

207. **A music bed carries its licence text, and the description publishes
     it** (2026-09-01, owner request: "add the license text file to the
     audio so that when we upload to youtube the license is submitted
     already"). YouTube offers no licence-submission channel at upload —
     Content ID disputes happen after a claim, in Studio — so the
     practical equivalent ships instead: the upload form gains an
     optional attribution/licence textarea (≤3000 chars, stored in the
     existing `assets.attributionText` column — no migration), the bed
     card shows it, and `composeDescription` gains a `Music:` block
     (after chapters, before sources) published verbatim on every video
     whose timeline uses the track — masters and Shorts both. Like the
     disclaimer, the music block never loses to the 5000-character
     squeeze; sources drop first. The publish path resolves the bed by
     the timeline's music `r2Key` (`musicBedByR2Key`), so the preview and
     the scheduled description can never disagree. A claim is then
     answered by the video's own description, and the certificate is on
     file in Settings for the dispute form.

208. **The still-image model is routed, not hard-coded** (2026-09-03,
     owner request: unable to change which image model generates stills).
     `modelRouting` gains a `stills` route ({provider: 'google'|'fal',
     model}) with a Settings → Models row like the LLM tasks; each image
     adapter now publishes a model list with per-model prices (Google:
     Gemini 2.5 Flash Image $0.04, Gemini 3 Pro Image $0.15; fal: FLUX.1
     dev $0.03, FLUX.1 schnell $0.01, FLUX1.1 pro $0.04, ids being fal's
     endpoint paths) and refuses an unlisted id before any money is
     spent. `generateStillCandidates` obeys the route instead of
     inferring the provider from which key exists — a routed provider
     whose key is missing fails loudly, naming both the setting and the
     Connections tab. Estimates and the cost ledger price from the LIVE
     adapter's per-model price in mock mode too, and the asset licence
     line now names the model, not just the provider. Old settings rows
     come forward via `normaliseSettings` with the Gemini default; the
     mock adapter deliberately ignores the model id, since it serves for
     both provider ids.

209. **Imagen joins the Google still models** (2026-09-03, owner request).
     Imagen 3 ($0.03), Imagen 4 ($0.04) and Imagen 4 Fast ($0.02) join
     the routing list. Same key, same host, different wire dialect: the
     adapter branches on the `imagen-` prefix to `:predict` with
     `instances`/`parameters` (N images in ONE call via `sampleCount`,
     bytes as base64 predictions) instead of Gemini's `:generateContent`
     (N parallel calls, inline parts). Imagen 4 Ultra is deliberately
     absent — it takes one image per request, which breaks the N-variant
     call shape. Also diagnosed this session: the owner's fal key verify
     "rejection" was fal answering 403 "User is locked. Reason: TOP_UP"
     to a VALID key — an unfunded account, not a key problem; the verify
     chip already surfaces fal's own message.

210. **The fal list grows only by schema check** (2026-09-03, owner asked
     why fal offers 3 models when fal hosts hundreds). The list is a
     promise: every id is verified against fal's OpenAPI schema for this
     adapter's exact contract (prompt + image_size with landscape_16_9 +
     num_images in, images[] out) and carries a price the budget maths
     can trust — an unchecked id would fail mid-run with money spent.
     FLUX.2 dev ($0.02, $0.012/MP) and FLUX.1 Krea dev ($0.03) passed the
     check and joined; FLUX.2 pro and FLUX1.1 ultra were checked and
     excluded — no num_images, one image per request, the same shape
     that keeps Imagen 4 Ultra out. A test pins the id list so nothing
     drifts in without the check being redone.

211. **Imagen is gone from the Google list; the ids fold forward**
     (2026-09-03, owner hit a 404 the first time an Imagen route ran:
     "imagen-3.0-generate-002 is not found for API version v1beta, or is
     not supported for predict"). Decision 209 shipped Imagen ids off
     documentation; the owner's own key's `ListModels` is the truth, and
     it serves NO `imagen-*` model — every image model on this API is
     Gemini-family via `generateContent` (Imagen lives behind Vertex AI's
     separate auth). The Google list is rebuilt from that listing, pinned
     by test: gemini-2.5-flash-image ($0.04, default),
     gemini-3.1-flash-image ($0.07, ~$0.067/1K image), gemini-3-pro-image
     ($0.15 — the preview id went GA). gemini-3.1-flash-lite-image is
     served but absent until it has a trustworthy price. Retired stored
     ids fold forward on read via `LEGACY_STILL_MODEL_IDS`, the exact
     `LEGACY_MODEL_IDS` precedent: Imagen ids → the default flash model,
     preview → GA. The Imagen `:predict` dialect branch is deleted.
     Lesson recorded: a model id joins a list only after the key's own
     ListModels (or the vendor's live schema) confirms it — decision
     210's rule, now applied to Google too.

212. **Imagen 3 returns, via fal** (2026-09-03, owner asked whether Imagen
     needs another API). It does not: fal hosts Google's Imagen, so
     `fal-ai/imagen3` ($0.05/image, schema-verified) joins the fal list
     as a second dialect behind the same contract — `aspect_ratio:
'16:9'` instead of `image_size`, and a REAL `negative_prompt` field,
     so for Imagen the brief's negative prompt travels as itself instead
     of folded into an "Avoid:" clause. Imagen 4 on fal was checked and
     NOT added: every id (`fal-ai/imagen4/preview`, `/fast`, `/ultra`,
     GA-shaped guesses, the google/ namespace) 404s on fal's own schema
     endpoint — withdrawn. Using it needs the funded fal account
     (decision 209's TOP_UP note).

213. **"Upload own" goes browser → R2, and no board action fails
     silently** (2026-09-03, owner bug report: clicking Upload own did
     nothing). Two layers, both the decision-205 disease: the action
     carried the image bytes, so Next's 1 MB action cap (and Vercel's
     ~4.5 MB edge cap) killed any real photo before validation, and the
     board's `act` helper had try/finally with no catch, so the rejected
     call showed nothing. Now `createOwnUploadAction` validates and
     issues a presigned PUT URL, the browser uploads to R2 itself, and
     `finaliseOwnUploadAction` recomputes the key from the fingerprint
     (never trusting the caller's), verifies the object with headObject,
     and writes the asset + chosen candidate exactly as before. All
     three steps run inside one `act` call for the busy state, `act`
     gained a catch that toasts, and an oversized pick is refused before
     a byte is uploaded.

214. **The slot taxonomy says where pixels come from** (2026-09-03, owner
     request: archival is real footage nobody can fetch; still is AI
     only). Wire ids stay — they live in stored briefs, a pg enum and
     timeline JSON — but the semantics and words changed. `archival` is
     now upload-only real footage, image OR video (mp4/mov/webm ≤200 MB,
     via the decision-213 presigned path; the browser reads duration and
     dimensions from a clip before it uploads): the runner fetches
     nothing for it (the old Wikimedia search produced lookalikes where
     authenticity was the point) and resolves it straight to
     `placeholder`, which the board renders as "yours to source" with an
     "Upload footage" button — never as a fetch failure. The shot-list
     prompt tells the model archival slots are manual work for a human
     ("query" = where to look, "mustShow" = the acceptance test) and
     that `still` is an AI-GENERATED image. Refetch is refused for
     archival server-side, brief edits save without refetching, and the
     board labels read "real footage" / "AI image" / "AI video" (hero).
     The Wikimedia adapter stays for candidates fetched before this
     decision. Generative video was reviewed and deliberately deferred:
     the `hero` type + `features.heroSlots` flag already reserve its
     place, and enabling it needs a fal video model chosen, schema- and
     price-verified, and its per-clip cost accepted — a decision of its
     own. Hard-won footnote: a `'use server'` module may only export
     async functions — exporting the video-size constant from
     visuals-actions.ts compiled fine and passed every unit test, but
     broke the whole projects route's server-action manifest at runtime
     (15 e2e tests across publish/pipeline/writing-room timed out on
     mutations that silently 500'd). Only e2e catches this class.

215. **Breathing room in the cut** (2026-09-03, owner review of the first
     assembled preview: chapter transitions too abrupt, chapter cards
     colliding with the chapter's first image, `[long pause]` visible in
     captions, chart text unreadably small). Three fixes:
     - **The compiler stretches the clock** (compile.ts): paragraphs get a
       PARAGRAPH_GAP_MS (300) breath; each chapter start gets
       CHAPTER_LEAD_MS (800) of silence, a CHAPTER_CARD_MS (3200) card,
       and narration resuming CHAPTER_OVERLAP_MS (900) before the card
       ends — the card (fades now 700ms, was 400) is still opaque when
       the slots swap underneath, so its fade-out always lands on the new
       chapter's first visual. Slots shift AND stretch (start and end move
       independently); caption words ride their paragraph's shift; the
       ducking curve follows the shifted narration, so the bed swells to
       full level under every card and re-ducks at the first words; music
       cues sit at card starts. `swapMusicBed` reads cues back from the
       chapterCard overlays (narration-derived stays as the fallback for
       card-less timelines). Goldens regenerated; the shorts compiler
       inherits the breath inside a chapter window. Publish chapter stamps
       derive from the timeline and the first is already clamped to 0:00,
       so YouTube chapters stay valid. The preview screen's chapter list
       matches cards by their number now, not by equal start times.
     - **Tags can never reach captions** (snap.ts): script tokens are now
       produced from `stripNarrationMarkup` BEFORE whitespace-splitting —
       the old per-token test let every multi-word tag through
       ("[long pause]" splits into "[long" and "pause]").
     - **Chart text scaled to the bars** (ChartReveal): takeaway 40→52,
       axis/annotation text 20→30 with a paint-order background stroke,
       left pad widened for the bigger numbers, and annotations stagger
       down three rows instead of colliding on one; map labels 26→34.

216. **The script-craft skill** (2026-09-03, owner review: "the plot isn't
     building — context before stakes, nothing withheld, no questions per
     beat"). Narrative craft now lives in
     `packages/providers/src/prompts/script-craft.md` (stakes before
     context / cold open, a question engine — one central question plus one
     planted-and-not-answered question per chapter, withholding as a named
     rule, escalation, end-on-a-turn), threaded into the outline, chapter
     and regenerate prompts below HOUSE_STYLE and above nothing: the hard
     rules (claim-list supremacy, legal hedges) stay supreme, and the
     rhetorical-question ban holds — tension comes from sequencing, never
     from asking the audience. The markdown is the human-editable source;
     the shipped constant in `script-craft.ts` is held byte-identical by a
     unit test, because a runtime file read does not survive every bundler
     this package runs under. Structurally, the outline schema gains a
     tension contract: `centralQuestion` on the root and `question` /
     `withhold` / `stakes` per chapter — all optional hints in the
     targetWords mould (trimmed, clamped to 500 chars, empty or invalid
     folds to absent via `.catch`, never a rejected outline), and
     `tensionContract()` assembles each chapter's drafting message: answer
     the predecessor's question, plant your own, do not leak the withhold.
     Pre-216 outlines still draft — they simply carry no contract message.
     Mock outline carries all fields so CI exercises the shape.

217. **A failed synthesis gets a button** (2026-09-03, owner report:
     project 01M1F7KDJVGDSJ31WE7BPSBKZR "stuck" with one paragraph never
     synthesised). The voice runner swallows per-take synthesis failures by
     design (fan-out tolerance) and parks at the gate saying "1 failed,
     flagged for you" — but the row's every repair (Fix the words, Another
     take/Regenerate, Flag) gated on `hasAudio`, so the one paragraph that
     most needed an action had none, and the stage was unfinishable from
     the UI (spec §11.1 button-first violated). A pending take with no
     audio now shows a primary "Synthesise" button riding the existing
     `retakeVoiceTake` action (the retaker re-derives text, key and
     settings; it never reads the old audio). Fix the words stays
     audio-gated; the purchase does not. The old test asserting the dead
     end was deliberately reversed.

218. **Staleness is judged on the takes in play** (2026-09-04, owner
     report: the "Read from an older script" banner would not clear after
     a full re-narration). `voiceBuiltFromScriptVersion` in the project
     summary was `min(built_from_script_version)` over ALL voice takes, so
     the 45 orphaned takes left behind by a script re-run — the ones the
     review screen ignores and assembly never reads — pinned the banner at
     the old version forever. The min now runs over takes whose chapter
     belongs to the LATEST script (a script re-run creates new chapter
     rows, so orphanhood is expressible in SQL), with the unfiltered min
     as coalesce fallback so a project whose voice stage has not been
     re-run at all still reads honestly as stale rather than
     unknown-provenance. Integration tests pin both directions.

219. **A failed retake flags its row, never the stage** (2026-09-04, owner
     report: voice warning would not clear and Approve was unreachable).
     Two Synthesise clicks made while the mis-pasted ElevenLabs key was
     stored failed with 401, and voice-retaker's onFailure called
     markStageFailed — which set `stageStatus='failed'` and tore down the
     OPEN review gate (a gate IS `awaiting_review`; the voice-runner was
     still parked at `awaiting_gate` the whole time). The later successful
     retake completed but nothing restores the room, so a project whose
     every paragraph had audio was unapprovable. New `markRetakeFailed` in
     gates.ts: when the stage is parked at review, flag the take with
     "Retake failed: <error>" (the row names the problem — the
     error-visibility gap from decision 217 — and the approval blocker
     holds the gate shut) and notify; only when no review room is open does
     it escalate to markStageFailed as before. The retaker's over-budget
     path keeps markStageFailed deliberately — budget gates are their own
     mechanism. The stuck project itself is unblocked by "Re-run stage" on
     Voice, which reuses every generated take free and re-opens the gate.

220. **Bounded mirror writes and pooled-socket staleness** (2026-09-04, owner
     report: visuals re-runs "stuck or taking exceptionally longer than
     usual"). Inngest's trace showed the truth the app could not: the next
     step was dispatched with 0ms delay and the execution request then sat
     open in "Your server" for 18+ minutes, with no step-start row and no
     ledger row ever written. The hang was the run-mirror's `onStepStart`
     insert issued down a dead pooled Postgres socket: Fluid Compute freezes
     instances between invocations, a frozen socket Neon has since dropped
     still looks alive to the client (keepalive probes cannot run while
     frozen), and postgres.js has no client-side query timeout, so the query
     waits out TCP retransmission. Which instance a request landed on was the
     coin-flip that made runs advance one or two chapters and then stall.
     Fixes (1ea0ab3): db client `max_lifetime: 300` recycles every pooled
     connection within five minutes, and every mirror write races a 5s
     timeout — the file's "mirroring never fails a run" promise now also
     covers hangs, which the try/catch alone could not see. Same evening,
     same project, a related find: a run cancelled in the app's mirror can
     stay alive inside Inngest and hold up the account's event processing;
     the recovery is the app's Stop (which sweeps and reconciles), never
     cancelling individual runs only in the Inngest dashboard. Open debts
     from the night: one-run-per-project on the runners (stacked re-run
     events started duplicate runs), the gate re-open race (a late duplicate
     re-opens an approved gate and misses the approval forever), and
     reconciling dashboard cancellations via `inngest/function.cancelled`.

221. **Slot seams close after the shift** (2026-09-07, owner report: quick
     black frames between some shots in the assembled preview). The board's
     plan routinely leaves 40-440ms rounding seams between consecutive slots,
     and decision 215's inserted pauses widened exactly those: a slot whose
     old end sits even 1ms before a paragraph boundary misses that
     boundary's breakpoint, takes the smaller shift, and the seam grows by
     the pause — 300ms of black mid-chapter, and over a second before a
     chapter card fades in. The production timeline carried 17 gaps across
     86 boundaries. The compiler already documented the intent ("a slot
     ending at a boundary holds under the card"); a closing pass now makes
     it true for every seam: slots ordered by start, any slot ending before
     the next start is stretched to butt. Overlaps stay untouched. Golden
     unchanged (its fixture butts exactly). Existing timelines keep their
     baked-in gaps — re-running Assembly recompiles them away for free.

222. **The paragraph breath is 700ms** (2026-09-07, owner review after the
     seam fix: "timings seeming rushed, almost clipped right at the end,
     before quickly transitioning"). With seams closed, the cut lands
     exactly on the next paragraph's first word, and the 300ms
     `PARAGRAPH_GAP_MS` between a statement's last word and that cut read
     as clipped. Raised to 700ms: the audio pause and the visual hold grow
     together, because the shift stretches slots across the pause and the
     seam pass covers the rest — the pause is felt as a held image. Chapter
     choreography (800ms lead + card + overlap) is untouched. Goldens
     regenerated; the diff is uniformly +400ms on every post-gap clock.
     If 700ms still reads wrong in preview it is one constant to tune.

223. **The shorts stage marks its own candidates and never reviews nothing**
     (2026-09-07, owner report: shorts "waiting for approval" but "no shorts
     yet"). Script v2's marking response failed to parse on 2026-09-03; the
     script-runner's catch deliberately swallows that (the narration is the
     script stage's deliverable) and stored an empty list — the only trace
     was "0 Shorts candidates" in a gate summary. The shorts-runner then
     parked `awaiting_review` over zero rows: a dead end with no button.
     Three changes: (1) shorts-runner marks candidates itself when the
     latest script has none (mock-aware, budget-gated; a marking failure
     fails THIS stage loudly — picking segments IS its work); (2) zero
     created and zero reused now fails the stage with the skip reasons
     instead of parking a review over nothing; (3) restartStage maps
     `shorts` to `project/master.ready` carrying the latest done master
     render's id, so the stage's Re-run button works at all (it previously
     answered "no runner yet"). Follow-up the same evening: the header
     control never OFFERED the button — `shorts` was missing from
     RESTARTABLE_STAGES, and the awaiting_review branch called every shorts
     review "curation" even over zero rows. `projectControl` gains
     `hasMaster` (shorts re-enter only from a done master render; the guard
     the action enforces, said honestly on the button) and `hasShorts`
     (zero rows at awaiting_review is a stranding that offers the re-run,
     not a curation message); the page loads the shorts model whenever the
     project SITS at shorts, like the preview model. Recovery for the stuck
     project: Re-run stage on Shorts.

224. **Shorts are marked as teasers, selected by the outline's tension
     fields** (2026-09-08, owner direction: a run should yield the full
     video, one dedicated teaser Short, and smarter excerpt Shorts; this
     decision ships the excerpt half). The marking prompt asked for segments
     that "stand alone", which selects summaries; a segment that resolves
     its own tension gives a scroller no reason to click through. The
     rewritten prompt selects funnels: open on the most arresting sentence,
     end right before a reveal, never include the resolving sentence. To
     select by tension the outline now SURVIVES: migration 0016 adds
     `scripts.outline` (nullable jsonb; the outline was previously in-memory
     only), the script-runner persists it after the outline step, and both
     marking call sites thread `tensionFromOutline` into the prompt. The
     shorts-runner safeParses the stored outline so a pre-224 script or a
     malformed row costs the hints, never the marking. The dedicated teaser
     Short (its own 25-40s script, TTS and mini-timeline) is the next
     feature, on its own branch.

225. **Every run yields a teaser Short with its own narration** (2026-09-08,
     owner direction; branch `teaser-short`). An excerpt slices what was
     said; the teaser says something new: a 25-40s script written from the
     chapters and the outline's tension fields (cold open, escalation,
     cliffhanger, never the answer), synthesised through the same
     budget-guarded `synthesise()` the voice stage buys with
     (idempotency-keyed, so a re-run re-serves paragraphs already bought),
     and cut over slots LIFTED from the master timeline: each teaser beat
     names the chapter it draws from, and `pickTeaserSlot` takes that
     chapter's best already-resolved slot (video, then image, then whatever
     it has). Nothing is re-fetched or re-generated. The result is a mini
     master `Timeline` stored on the shorts row (`shorts.kind='teaser'`,
     `shorts.sourceTimeline`, migration 0017), whose narration lives in the
     fixed pseudo chapter `TEASER_CHAPTER_ID` (a well-formed ULID, because
     the schema demands one), and the short-render-runner windows it with
     `compileShortTimeline` exactly as an excerpt windows the project
     master, buying the vertical canvas, end CTA, shorts bed and QC with no
     second render path. A teaser failure SKIPS with its reason instead of
     failing the stage (the excerpts are complete deliverables); budget
     refusals park the stage like every other paid step. The Shorts screen
     badges the card "Teaser". Test-suite lesson recorded in the runner
     test: seeding never resets the settings row, so the suite starts each
     test voiceless and the teaser tests opt in explicitly. Amended same
     day: the re-entry guard originally skipped the teaser whenever ANY rows
     existed, which locked out every project whose excerpts predate the
     feature (production hit this within the hour). Re-entry now keeps every
     existing row as curated but builds a missing teaser — the guard is
     "does a teaser row exist", not "do rows exist".

226. **The Publish stage's four logic fixes** (2026-09-08, owner report:
     "broken logic or weird logic on the Publish Stage"; branch
     `publish-flow-fixes`). Four changes, one theme — the screen was more
     restrictive than YouTube:
     (a) _The related-link chip no longer gates scheduling._ Spec §11.3 said
     the chip "must be checked before the Short can be scheduled", but the
     Studio act it records — setting the Short's related-video link — is only
     possible AFTER the Short is uploaded, and it points at the full video,
     which also has to be up. The gate demanded proof of an act it made
     impossible: a deadlock, hit in production. The chip is now bookkeeping;
     the Publish screen shows the reminder on scheduled/live Short cards
     (one click records it via `setShortRelatedLink`), and the model exposes
     `relatedLinkChecked` per item. Spec deviation, deliberate.
     (b) _Publish → done is a button._ The stage enum always had `done` and
     nothing ever set it (deferred decision, now made): `markProjectDone` on
     the Publish screen moves publish → done (stage guard + no-live-run
     guard), the same human-decision shape as the shorts → publish handover.
     `projectControl` stops saying "the next stage starts on its own" on the
     last stage.
     (c) _Publish now._ `publishNow` writes the record with `publishAt = now`
     and `privacyStatus` decided by the audit flag: 'public' after the audit
     (live as soon as processing ends), 'private' before it (the human flips
     it in Studio — the checklist's existing step). The runner's preflight
     passes `record.privacyStatus` through to the upload job and includes
     `publishAt` ONLY for a private video whose moment is still ahead —
     YouTube rejects a past `publishAt`, and the old code always sent it
     (a scheduled item whose slot passed while quota-deferred would have
     died on that; now it uploads private with an honest "flip it in
     Studio" notification). `schedulePublish` writes `privacyStatus:
'private'` explicitly so a re-scheduled publish-now goes back to being
     a scheduled private video.
     (d) _Custom times._ The calendar only materialised the Settings
     default slots; the backend always took any future ISO. A
     datetime-local input + "Schedule at this time" / "Move to this time"
     button on the Schedule card now takes any moment, in the owner's
     timezone. Test-suite lesson: the runner fixtures' hardcoded
     `publishAt: 2026-08-28` rotted into the past and silently became a
     publish-now — fixture moments are computed (`now + 24h`) from here on.

227. **The teaser studio** (2026-09-08, owner direction; branch
     `teaser-studio`). The owner asked whether the teaser should appear as a
     tab on the Script, Voice and Assembly pages. Decided against: those are
     gate screens for the master (a tab would make one Approve silently
     cover two artefacts), the teaser's inputs are only final after
     assembly (its visuals are lifted from the resolved board, its cut
     windowed against the finished master, so an early teaser goes stale on
     every upstream re-run), and a tab per derivative artefact is clutter
     by construction. Instead the teaser gets ONE home at the moment
     everything it depends on is final: an "Open the teaser studio" button
     on the teaser card expands a full-width panel below the grid with the
     same three views the tabs would have had — Script (the 2-5 beats,
     editable, each tagged with the chapter it cuts over), Voice (the
     beat's current audio, presigned from R2, playable inline) and the
     rebuild. The contract mirrors the console: Save never spends (it
     stores the script and nulls `renderId` — the old render is a render of
     the old words, the ending toggle's rule); "Re-voice & recut" is the
     spend and queues a fresh render. Mechanics: `shorts.teaserScript`
     jsonb (migration 0018, applied to prod and test) stores
     `TeaserScriptRecordSchema` ({title, paragraphs, scriptVersion}),
     written by the shorts-runner's assemble step; the build steps moved to
     the shared `inngest/lib/teaser-build.ts` so the shorts-runner and the
     new `teaser-rebuild-runner` (event `teaser/rebuild.requested`) cannot
     disagree about keys; the rebuild re-voices from the stored script,
     recuts over the CURRENT board, updates the row in place (curated title
     untouched) and never touches the project stage — it can run while the
     project sits at publish, so failures notify instead of failing a
     stage. A teaser built before the column existed has no stored script;
     its first rebuild regenerates one from the outline and stores it. Bug
     fixed in passing: the TTS idempotency key hashed only the text LENGTH,
     so an edit that kept the character count would have been handed the
     old audio back — the key now carries a sha256 prefix of the text
     (one-time consequence: beats already bought under the old key format
     re-bill once on their next rebuild, pennies).

228. **Start over on YouTube** (2026-09-10, owner report: the account's OAuth
     consent had picked the WRONG of its two channels, so every upload —
     two masters and a Short — landed there, and `scheduled`/`live` records
     were locked with no way back). `unlinkPublishRecord` resets the record
     to draft (video id, moment and privacy cleared), offered as a
     confirmed "Start over on YouTube" button on any card whose record
     holds a video id at `scheduled`/`live`/`failed`. Deliberately does NOT
     delete from YouTube: the stray video is the human's act in Studio, on
     the channel that holds it. Recovery sequence documented for the owner:
     reconnect in Settings → Connections choosing the right channel on
     Google's chooser (Verify toasts the connected channel's name), delete
     the strays in Studio, Start over, re-schedule. Also from this
     incident: the analytics pass got its long-promised manual button
     ("Refresh analytics now" on the Publish screen) after a snapshot
     failed on the Google-side YouTube Analytics API toggle with no retry
     short of the next 06:00 UTC cron.

229. **A public /privacy page** (2026-09-10, same incident chain). Google
     refused to let the OAuth consent screen leave Testing mode without a
     live privacy-policy URL — and Testing-mode refresh tokens expire every
     7 days, which would break uploads and analytics weekly. The page is
     static, honest about the single-operator reality (what YouTube data is
     used, AES-GCM token storage, no third parties, deletion via disconnect
     or Google's permissions page), and `/privacy` joins PUBLIC_PATHS in
     proxy.ts — the one console route reachable without a session, holding
     no data and no actions. Owner-side sequence recorded: add the brand
     account's pages.plusgoogle.com address as a TEST USER first (the 403
     access_denied on reconnect was the brand identity missing from the
     test-user list), fill Branding (app name, support email, homepage =
     the app URL, privacy policy = /privacy), publish to production, THEN
     reconnect so the stored refresh token is the durable kind.

230. **The teaser studio grows the full mini pipeline** (2026-09-10, owner
     direction: "the same as our normal video — script, voice, shot list,
     assemble and render", with reuse of the full video's footage AND room
     for new shots later). Phase 1 of two, chosen by the owner: the acts
     split and the shot picker lands; NEW-material fetching (per-beat stock
     search and paid still generation) is phase 2. The studio is now Script
     → Voice → Shots → Assemble & render:
     (a) _Voice split from the cut._ The teaser-rebuild-runner (event name
     kept) voices the stored script and stops: beats land in
     `shorts.teaserVoice` (migration 0019, applied to prod and test) as
     `{textHash, r2Key, durationMs, wordTimings}` per beat —
     `teaserTextHash` moved into `@boom-busters/schemas` so "is this beat's
     audio current?" and the TTS idempotency key are the same digest. The
     shorts-runner's initial build stores the same record so a fresh teaser
     opens consistent.
     (b) _Shots._ Per beat, a picker over `teaserShotPool` (the exact pool
     the auto-pick chooses from, extracted so the studio and the auto-pick
     can never disagree), capped at 12 thumbnails per beat, plus an Auto
     chip. Choices live on `shorts.teaserShots` as FULL SLOT SNAPSHOTS,
     never indexes — a re-assembled master reorders its slots, and an index
     would silently point a human's choice at other footage.
     `compileTeaserMaster` gained `chosen?: (TimelineSlot | null)[]`.
     (c) _Assemble & render is a server action._ `assembleTeaser` compiles
     from the stored voice + choices (free, synchronous, no vendor),
     refuses in words when any beat's textHash has fallen behind the
     script, writes the cut, nulls the render pointer and queues the
     render. Spend contract unchanged: script saves and shot picks are
     free, voicing buys only changed beats, assemble spends only on the
     render.

231. **The teaser studio fetches new material** (2026-09-10, phase 2 of
     decision 230, owner said "Proceed with Phase 2"). Two per-beat acts
     behind a "Fetch new shots for this beat" toggle, both handled by one
     new Inngest function (`teaser-shot-fetcher`, event
     `teaser/shots.requested` with ops `stock`/`still`/`ingest`):
     (a) _Fetch stock options_, free. An editable query seeded from the
     beat's words runs through the exact `fetchStockCandidates` path the
     visual board uses (both providers, no key = degraded not dead),
     UNSCORED on purpose: the strip is picked by eye, and a scoring pass
     would spend an LLM call to rank twelve thumbnails a human is already
     looking at. A re-search replaces the beat's stock results; bought
     stills always survive.
     (b) _Generate a still_, paid. An editable prompt through the exact
     `generateStillCandidates` path (`modelRouting.stills`, `withCost`,
     bytes in R2 at birth); the ConfirmButton quotes
     `stillSlotEstimateUsd()`, the same number the plan screen quotes.
     (c) _Picking_ honours the storage law (spec section 8.2, the Pixabay
     expiring-URL incident): a candidate whose bytes are settled (stills,
     mock mode, re-picks) carries a pre-built slot from
     `slotFromTeaserCandidate` and is picked synchronously via the existing
     `saveTeaserShot`; live stock without bytes goes through the runner's
     `ingest` op (`ingestCandidateBytes`, the middle of `ingestSlotStock`
     extracted) and only then becomes the beat's choice. New images get a
     gentle kenburns push-in; videos stay static because they already move.
     (d) _State is words, never a spinner._ Per-beat request state plus
     candidate pools live on `shorts.teaser_fetches` (migration 0020,
     `TeaserFetchesRecordSchema`), a SEPARATE column from `teaser_shots`
     so the runner's writes and the human's picks cannot clobber each
     other. The action writes `fetching` before emitting; the runner ends
     every path in `null` or `failed{reason}`; the studio polls
     `router.refresh()` every 2.5s only while a beat is fetching. Failures
     also notify, for a studio closed mid-fetch, and never touch the stage.

232. **Shorts get the thumbnail dropzone, and the strip stops moving the
     page** (2026-09-10, owner request plus owner bug report: "when a
     thumbnail is uploaded it causes this shift or offset in the panel...
     its drastic").
     (a) _Per-target thumbnails._ `uploadThumbnail`/`removeThumbnail` take
     the publish target instead of assuming the master; keys live at
     `thumbs/<targetId>/<hash>.png` (the master's targetId IS the project
     id, so its historical keys keep their shape); the publish model
     presigns Short thumbs too; the runner's `set-thumbnail` step runs for
     any target that stored one. The REQUIREMENT stays masters-only: a
     Short uploads fine without one (the feed plays the video itself;
     search and channel pages show the thumb when set).
     (b) _The layout shift, root-caused._ Reproduced with a Playwright
     `layout-shift` PerformanceObserver: each upload grew the dropzone by
     ~96px mid-page and lurched the Schedule card below. 96, not the 53 the
     class names read, because `--spacing: 8px` (the deliberate 8px grid in
     ui-tokens) makes every numeric Tailwind utility DOUBLE its default:
     `h-10` buttons are 80px tall. Fix: the strip's geometry is RESERVED —
     a constant `min-h-[158px]` region (one tile on the real grid: 45 image
     - 16 caption + 80 button + two 8px gaps) holding 100px-wide tiles side
       by side, a placeholder when empty, and the Test-and-Compare note
       static below. Re-measured after: zero layout-shift entries, dropzone
       box byte-identical before and after an upload.
       (c) The repro also caught that e2e's dev server inherits `.env.local`,
       so its thumbnail uploads had written real R2 objects under the seeded
       project ids — deleted; no committed test uploads thumbnails.

233. **One live run per key: every runner carries an Inngest singleton**
     (2026-09-10, backend audit phase A; clears half the decision 220 debt).
     Stage runners key on `event.data.projectId`, row workers on their row
     (takeId, slotId, shortId, publish targetId), all `mode: 'skip'`: a
     duplicate trigger event is skipped, never stacked. This is the durable
     fix for the gate re-open race too, because `gate/X.approved` is both
     what a parked run resolves on and the NEXT runner's trigger, so a
     double-fired approve used to start two runs of the next stage.
     Deliberately none on `teaser-shot-fetcher` (two beats of one Short
     fetching at once is a feature; the action guards per beat),
     `analytics-runner` (cron, no event data; its `concurrency` queues the
     manual refresh) and the reconcilers (idempotent, every pass welcome).
     `inngest/functions/index.test.ts` pins the whole map so a new runner
     must decide. Known trade of `skip`: a restart aimed at a zombie run
     (mirror closed, Inngest alive) is skipped silently; the recovery stays
     Stop (which cancels via `cancelOn`) then restart.
     _Amended 2026-09-16: every mode is now `cancel`, not `skip`._ The known
     trade turned out to be a wedge with no recovery at all. After the owner
     stopped a parked visuals run on the Stability AI project, the singleton
     lock was never released, and `skip` then dropped five consecutive
     `gate/voice.approved` events over 40 minutes: the Inngest Events page
     showed the event received and "Visual planning" matched on every one,
     the Runs list showed no run created, and the Running filter was empty,
     so nothing was alive to explain the skip. Stop-then-restart cannot help,
     because the thing holding the lock is already cancelled. `cancel` keeps
     decision 233's actual guarantee — never two live runs for one key, so a
     double-fired approve still ends with exactly one run — while making a
     trigger always produce a run, which is what a restart means. The cost is
     that an accidental duplicate now cancels and redoes work instead of
     being free; a wedged stage that no button can clear is the worse trade.
     `index.test.ts` grew a second assertion so no singleton can return to
     `skip`.

234. **Side jobs never fail a parked review, and buttons refuse to spend
     twice** (2026-09-10, audit phase A). The slot re-fetcher, slot re-typer
     and the retaker's over-budget path all called `markStageFailed` while
     the review gate they serve was parked open: the decision 219 bug in
     three more places. `markSideJobFailed` in `gates.ts` generalises the
     rule: words (and row-level state; the re-typer writes its refusal onto
     the card channel it already had) while `awaiting_review`, stage
     escalation only otherwise. `budgetGateData` now carries the error's own
     message, ending "A run failed: Unknown error" for the one failure known
     to the cent. Action-level guards: a beat already `fetching` refuses a
     second teaser fetch (10 minute cooldown via a new `startedAt` on the
     state, the escape hatch for a runner that died without a trace); a
     Short or draft mid-render refuses re-render and re-assemble. First
     server-action test file (`shorts-actions.test.ts`) covers the guards.

235. **Outside cancellations reconcile via `inngest/function.cancelled`**
     (2026-09-10, audit phase A; the last decision 220 debt). A dashboard or
     API cancellation fires no mirror hook, so the run row stayed live
     forever (restarts refused, Stop offered for a ghost). The new
     `cancellation-mirror` function closes the row in words; when the dead
     run was a stage runner and nothing else moves, the stage goes `failed`
     with a notification saying it was cancelled outside the app. The app's
     own Stop lands here after its sweep already closed the rows, and doing
     nothing twice is part of the tested contract.

236. **Every failure notifies once, and only once** (2026-09-10, audit
     phase A, notification inventory). Delivery is email-or-log only (there
     is no in-app notification surface; the Activity drawer reads
     `run_events`), which reframed the audit: gate notifications are the
     product, silence and repetition are the bugs. Seven silent failure
     paths gained notifications (Short render and draft render onFailure,
     publish-runner onFailure, the queued-upload budget re-check,
     teaser-voicing onFailure, analytics onFailure, cancel-reconciler
     onFailure). 'YouTube needs reconnecting' notified from three sites on
     two kinds, one a daily cron with no memory: all three now notify only
     on the TRANSITION to invalid (`youtubeReconnectNeeded` read before the
     stamp) under the one `reconnect-youtube` kind. `qc-failed` (declared
     M6, never emitted) retired; `heads-up` added for the two notifications
     that were mislabelled `gate-auto`. Known non-change: `run_events` has
     no retention and grows forever; deleting audit trail is an owner call,
     flagged rather than made.

237. **Screen loads batch their reads; presigned URLs stop cache-busting**
     (2026-09-10, audit phase A, query pass). Measured: the Shorts and
     Publish screens ran ~11 sequential DB round trips (six of them a
     per-card `getRender` loop, run twice when both models load).
     `getRendersByIds` answers the batch in one query; the publish model's
     music attribution, retention snapshot and master thumbs join the
     parallel batch; the project page's master-render lookup joins the main
     `Promise.all`. `presignGet` floors its signing time to a 15 minute
     bucket so the same key presigns to the SAME url across live-refresh
     re-renders. Before, every 3 s refresh minted fresh query strings for
     every thumbnail and audio element, so the browser cache never hit and
     R2 egress was re-paid for held bytes. Deferred, recorded here so it is
     not re-found: `getSettings`/`latestTimeline`/`latestScriptParagraphSources`
     still run once per model that wants them (2 to 3 duplicates per
     request); a `React.cache()` wrapper is the fix if screen loads still
     feel slow after this pass.

238. **API routes answer in words and let the browser keep bytes**
     (2026-09-10, audit phase A, endpoint pass). The asset and voice-take
     file routes guard their presign (R2 down answered a raw 500 per
     thumbnail) and stamp `Cache-Control: private, max-age=2400` on the 302,
     sized inside the presigned URL's remaining life (3600 s TTL minus at
     most one signing bucket). The YouTube callback wraps its post-exchange
     tail (a store/ping failure mid-OAuth landed on a raw error page) and
     logs only messages, since Google's error bodies can echo the
     authorisation code. The broker hook treats a missing token as a bad
     signature, not a 500 to an unauthenticated caller. Audited and left
     alone: `/api/pulse` (30-byte payload, sound design), the render
     progress route's payload (qcReport is null for the whole in-flight
     window, so trimming it saves nothing), `/api/inngest` and the auth
     handler (SDK-owned).

239. **The dead-code sweep, and the bug hiding in it** (2026-09-10, audit
     phase A1). Removed with zero consumers verified per item: the fan-out
     helper module (`inngest/lib/fan-out.ts`, superseded by the runners' own
     partial-failure handling), the one-time `clear-unstored-takes` repair
     script, `@tanstack/react-query` (never imported), cost's `postgres` and
     `dotenv` devDependencies, and about twenty exports whose only consumer
     was their own test (`closeDb`, the truncate helpers, `safeEqual`,
     `countActiveRuns`, `hedgeSentence` and kin), plus the branded-id
     aliases in `ids.ts` (fourteen types nothing used; ids travel as plain
     strings and `UlidSchema` guards the boundaries). Eight stale comments
     fixed (phantom `containsHedge`/`composePublishDescription`/`stageOf`
     names, the fonts-subpath claim, a `noImplicitReturns` justification for
     a compiler option that is not on). The bug: the spec section 13 promise
     "mock mode is never active in a production build" was enforced only by
     `isMockMode`, a helper NOTHING called; `mockProvidersEnabled`, the
     check every runner and screen actually uses, had no guard. The guard
     moved to the real check, with tests. Kept deliberately: demo-pipeline
     (the documented orchestration test harness), the drizzle relations and
     enum exports (convention-consumed), ui-tokens' palette mirror (a
     contrast guard against tokens.css), and ~330 exports used only inside
     their own file (tightening `export` keywords is churn, not cleanup).
     Owner-side note, not code: `.env.local` holds `ELEVEN_LABS_API_KEY`
     and `FAL_AI_API_KEY`, near-misses for the real `ELEVENLABS_API_KEY`
     and `FAL_API_KEY`, plus `GOOGLE_CLOUD_TTS_API_KEY`, `R2_TOKEN` and
     `R2_JURISDICTION_ENDPOINT`, which nothing reads. Harmless (keys enter
     via Settings and are stored encrypted) but worth tidying by hand.

240. **A pressed button stays busy until the new data is on screen**
     (2026-09-10, audit phase B1). `useAction` returns `{ act, busy,
pressed }`: a ref guards the call so a double-click fires the server
     action once however fast the second lands (the approve event is also
     the next runner's trigger, so two clicks used to mean two runs at the
     Inngest layer too, now guarded at both layers); the `router.refresh()`
     runs inside a React transition, so `busy` spans the whole round trip
     instead of ending while the screen still shows stale data, which was
     exactly the window that invited the second click. Multi-button
     components name each press, so the pressed control spins while its
     siblings stand disabled; `ConfirmButton` merges an external busy with
     its own await. Every consumer wired: gate bar, restart, stop, delete,
     Shorts cards, the whole teaser studio, Publish scheduling and metadata,
     the music picker and both render buttons. A failed change request now
     keeps its note for the retry instead of clearing it.

241. **Navigation shows pending on the clicked rail item; the background run
     gets named** (2026-09-10, audit phase B2/B3). Clicking a rail item used
     to give no feedback until the next screen's whole query batch finished,
     so the app read as frozen at its busiest moments. First attempt was a
     segment `loading.tsx` skeleton, REJECTED by its own E2E run: a Suspense
     boundary makes every route stream in two chunks, and Playwright's
     strict text locators transiently matched both the hidden streamed copy
     and the placed one (two tests failed on strict-mode violations; every
     text locator in the suite would have become a race). Shipped instead:
     `useLinkStatus` inside each rail link swaps the clicked item's icon for
     a spinner while its navigation is pending, feedback exactly where the
     click happened and no change to how routes render. On a project screen,
     viewing an earlier stage while the pipeline works used to hint at the
     run only through the header's pulse dot; a status line now names the
     stage that is moving. Audited and left as they were: the settings and
     cases screens (their buttons already disable and speak while saving),
     the render progress bars, the teaser fetch word states, and
     LiveRefresh's "Updating automatically" cue.

242. **The spacing unit is 4px, so the console renders at the size its
     classes say** (2026-09-10, audit phase C, the UX/UI pass with the
     impeccable and intent skills; the critique that opened the phase is
     archived under `apps/web/.impeccable/critique/`, gitignored). Tailwind
     v4 computes every numeric utility as `calc(var(--spacing) * n)`, and
     `--spacing` had been 8px since M1, where spec 11.1's "8px grid" was
     read as the unit. Every control, gap and icon rendered at exactly 2x:
     a 448px rail, a 96px top bar, 80px buttons carrying 13px labels, 32px
     icons, 32px card padding. Decision 232 measured the symptom and
     reserved geometry around it. The unit is now 4px (the framework
     default and what every `h-10` "40px hit target" comment assumed); the
     8px grid is kept by using even steps, and `ui-tokens` tests pin the
     unit in both the TypeScript source and `tokens.css`. Everything that
     only met the 40px target through the doubling was repaired by an
     every-screen sweep of sub-40px controls: the Switch is a 40px button
     drawing its 24px track with a pseudo-element, the toast Dismiss is
     40px, the pipeline segments carry `min-h-10`, the inline claim
     phrases pad to 40px, the music-source select is 40px, and the publish
     thumbnail strip's reserved height is re-derived (109px, was 158). Before
     and after screenshots of all 42 screens were compared; the mobile
     captures were the proof, since at 390px the doubled scale had squeezed
     Needs-you titles to a single letter.

243. **A blocked stage offers the button for the stage it is blocked on**
     (2026-09-10, phase C). "There is no dossier to write this script from,
     run the dossier stage first" was shown on a screen whose only control
     was Delete this project. `projectControl`'s blocked result now names
     the `prerequisite` stage and the header renders that stage's re-run
     button beside the message; `run-state.test.ts` covers every
     missing-artefact block. Stages with no runner stay blocked without a
     prerequisite.

244. **A phone has navigation** (2026-09-10, phase C). The rail was
     `hidden md:flex` with nothing in its place and the breadcrumb was plain
     spans, so from a notification deep link the only way off a project was
     the browser's back button, on the device spec 11.4 calls first-class.
     `MobileNav` is a fixed bottom bar below md with the six rail
     destinations (icon over label, 56px rows, safe-area padding), sharing
     the rail's `NAV` array and its `aria-label="Primary"`, so the E2E rail
     test drives both. Breadcrumb ancestors are links, and a project id in
     the trail reads "Project" (the h1 carries the title). The top bar
     truncates the trail instead of painting it under the controls, shows
     the spend meter at every width (it was hidden below sm), says "near the
     ceiling" or "over the ceiling" in words beside the tone, and the
     Activity button goes icon-only below sm like its neighbours. Settings
     tabs scroll in one row below sm instead of wrapping to three.

245. **Needs-you cards say what is waiting, and stack on a phone**
     (2026-09-10, phase C). The card title is the project; the context line
     leads with "Dossier ready for review" and then the category and target
     runtime. "con · 18 min target" told the owner the category of a video
     they already knew. The category enum is shown as a word everywhere
     (`caseCategoryLabel`: Con, Collapse, Meltdown, Turnaround, Empire),
     never as a monospace identifier. Below sm the card stacks: title on its
     own line (two lines allowed, never truncated), age and button on the
     row beneath.

246. **Contrast tokens for the places the palette was actually used**
     (2026-09-10, phase C). Three failures the M8.6 Lighthouse pass could
     not see because it measured text on the card surface only:
     indigo-600 as TEXT on the dark surfaces was 2.8:1 at 11 to 13px in nine
     files (links, "Today", the running segment's label); `border-strong`
     was 1.7:1 dark and 2.5:1 light against the 3:1 a control boundary
     needs; muted text on the raised surface was 4.0:1. New
     `--color-accent-text` (indigo-400 on dark, indigo-600 on light) is
     used wherever the accent is foreground text; the accent FILL is
     unchanged. `border-strong` is zinc-500 in both themes; muted is
     `#909099` dark and `#6b6b74` light. The focus ring uses the text accent
     so it is visible on raised rows, and text selection and the caret take
     the palette. The `ui-tokens` contrast tests now assert muted on all
     three surfaces, accent-text on all three, border-strong at 3:1 and the
     status colours at 4.5:1 on surface as well as background.

247. **The accent fill means the gate action and nothing else**
     (2026-09-10, phase C). Playback speed, the previewed cut, the ledger
     filter, the publish item being edited, the accepted diff hunk, the
     voice stability tier and the chosen candidate all used the primary
     fill for "selected", so every review screen had five indigo buttons
     and Approve was one of them. `Button` gains a `selected` variant
     (raised surface, accent-text border) and every toggle uses it; the
     Projects list's Review and Re-run stage keep the fill because they are
     actions.

248. **Confirming keeps its focus and its reason** (2026-09-10, phase C).
     Arming `ConfirmButton` unmounted the focused trigger, so a keyboard
     user pressing Enter on Stop, Delete, Render master or Publish now was
     dropped to the document body and heard nothing. Focus now moves to the
     confirm button, which is `aria-describedby` the consequence sentence,
     and Cancel returns it to the trigger. The consequence is 14px primary
     text: it is the most important sentence on the screen at that moment.
     The disabled Approve is described by its blocked reason, which was a
     sibling span nothing pointed at. `confirm-button.test.tsx` is the
     first test file for the component.

249. **The pipeline rail never truncates a stage name** (2026-09-10,
     phase C). At 1440px the segments read "Doss…", "Visu…", "Asse…",
     "Sho…", "Publ…"; at 390px they were eight blank coloured boxes, which
     the file's own comment says must never happen. The rail is a 4-column
     grid below lg and 8 columns from lg, labels `whitespace-nowrap`, icons
     `shrink-0`.

250. **One Badge** (2026-09-10, phase C). Seventeen hand-rolled chip styles
     (three radii, four font sizes, border-only beside tinted, `uppercase`
     on some, raw enum strings on others) and three copies of the publish
     status map became `components/ui/badge.tsx` with two shapes (`pill` for
     a state, `tag` for a kind) and six tones, plus `lib/publish-status.ts`
     shared by the calendar and the Publish screen. Copy tidied on the way:
     "1 placeholders", "waiting moments", "waiting for Inngest", and a
     Projects empty state that still pointed at `pnpm db:seed` and "M3".
     Deferred from the critique, recorded so they are decisions: Projects
     filter chips (spec 11.3), stage-specific counts on Needs-you cards (the
     summary row carries no claim or flag counts; a join is the price), and
     the Music tab leading with its add form.

251. **A Short's thumbnail is vertical** (2026-09-11, owner report: the
     dropzone refused a Canva Shorts export with "YouTube wants at least
     1280×720"). It was the app's rule, not YouTube's, and it was the wrong
     one. YouTube documents two shapes: a long-form thumbnail is 16:9 with a
     minimum WIDTH of 640px, a Short's is 9:16 with a minimum HEIGHT of
     640px. Decision 232 extended the dropzone to Shorts and inherited the
     master's 1280×720 check, which neither side branched on `targetType`
     even though the action already resolved it, so 1080×1920 (the Canva
     Shorts preset, and legal by YouTube's rule at 1920 high) was refused for
     being 1080 wide. Worse than refusing a good file: YouTube replaces a
     16:9 thumbnail on a vertical video with an auto-generated 4:5 crop on
     some surfaces, so the old rule steered the owner toward an asset that
     would partly be discarded. `lib/thumbnail-rules.ts` now holds one rule
     per target (master 1280×720 16:9, short 720×1280 9:16 with 1080×1920
     recommended) plus the refusal wording and the dropzone hint, imported by
     both the client and the `'use server'` action — which is legal, since
     only EXPORTS must be async, and it ends the duplicated literals the old
     comment apologised for. Because each floor names both dimensions, the
     pair rejects the wrong ORIENTATION with no separate ratio check: a
     landscape PNG fails a Short's height, a portrait one fails a master's
     width. The floors are the app's own (a quarter of YouTube's recommended
     resolution in each orientation, the posture the master rule always had)
     and the message no longer attributes them to YouTube. Audited and left
     alone: the 2 MB ceiling is right for this app because the Data API caps
     `thumbnails.set` at 2 MB whatever Studio's web uploader allows, and
     PNG-only is an app choice for the Canva workflow though YouTube also
     takes JPEG. Unverified and worth one real upload: YouTube's help page
     says custom thumbnails for Shorts can currently only be added in Studio
     on a computer, while the API reference documents no such restriction and
     the publish runner sets thumbnails through `thumbnails.set` for both
     types. _Verified 2026-09-14 on the first real Short (the Stability AI
     teaser): the call returned 2xx, no failure was logged, and YouTube kept
     its own auto-generated frame. The help page is right; the API reference
     is silent. A Short's thumbnail is set in Studio on a computer._

252. **Visual direction: a House Visual Bible and a per-film Director's
     Book** (2026-09-14, owner request: "master the direction and shot
     briefing so videos are extremely high quality, like professional
     documentaries"; spec `docs/superpowers/specs/2026-09-14-visual-direction-design.md`,
     plan `docs/superpowers/plans/2026-09-14-visual-direction.md`).
     _Research first._ Every published Claude skill for AI filmmaking is
     written for fiction with actors and free-form prompts; none knows typed
     briefs, claim-sourced charts, a renderer with a fixed motion vocabulary
     or an archival-poor format, so none was adopted. Three sources were
     mined for craft: visual-skills by Serge Shima (CC BY 4.0: the three
     physical facts per shot, the banned-word list, one move and one action
     per clip, the named final image, the montage staircase), DirectorSKILL
     (MIT: invariant clauses pasted verbatim into every prompt, the S2 video
     prompt shape) and the Black Forest Labs and Google prompt guides (FLUX
     order, no negatives on FLUX, hex colours, Imagen's subject-context-style).
     (a) _Two layers._ The bible is fixed and lives in the repo as
     `direction-craft.md`, embedded as `DIRECTION_CRAFT` with the byte-identity
     test of decision 216: the Netflix money-documentary register, shot
     grammar for a film made of stills, what a still prompt must contain,
     the motion the renderer can do (never a pan: the compiler turns one into
     a push-in), per-model recipes, the people rules, a pre-flight list. The
     Director's Book is per film (`DirectorsBookSchema`): visual thesis, era
     locks, a palette inside the house grade, exactly three motifs, an anchor
     object, never-show, principals with an identity string and a guardrail
     each, locations, one entry per chapter (dominant shot family, mood
     shift, key image) and the final image. Drafted once by a new LLM task
     `direction` (Sonnet by default, one call per film), stored on
     `projects.direction`, reused on a re-run so the owner's edits survive.
     (b) _Every chapter plans against both._ The shot-list prompt embeds the
     bible and puts the rendered book in the cacheable prefix beside the
     claims; briefs carry an optional `shotSize` and stills and heroes an
     optional `depicts`. `planWarnings` turns craft misses (three adjacent
     slots at one size, a banned word) into notes on the plan screen, never
     rejections. The per-chapter planning moved into `inngest/lib/direction.ts`
     so the runner and the new `visuals-replanner` share it; the replanner
     redrafts the book or re-plans the slots at the plan checkpoint while the
     runner stays parked, and the plan screen grew a Direction card whose
     fields hold raw text until Save (parsing on every keystroke rewrote the
     field under the cursor, caught by the component test).
     (c) _People, as the owner decided._ Real principals may be shown by
     likeness, the altered-content label is set, and the bible guards against
     defamation and mockery: documentary-neutral situations the claims
     support, never an invented act that implies guilt, no caricature, mood
     in the light and never the face, one guardrail line per principal
     quoted in every prompt. Noted and accepted: Black Forest Labs' usage
     policy forbids likenesses of public figures without consent and Google's
     image models refuse named people in practice, so a share of these
     prompts will be refused. Hence (d).
     (d) _The refusal fallback._ Gemini's empty or image-less reply is now a
     `ContentPolicyError` (fal's refusal bodies already were); the runner and
     the refetcher turn one into a `placeholder` with the refusal ON THE ROW
     (`shot_slots.refusal`), and the card offers Redirect the scene
     (`slot-redirector`: the same beat without the person, `coversText`
     unchanged, `depicts` stripped, validated) or Upload a real image with
     the depiction brief above the dropzone.
     (e) _The label._ `syntheticLikenesses` lists the people shown by a
     CHOSEN generated still; the Publish screen says so on every item, and
     the upload job carries `containsSyntheticMedia`, which media-utils sets
     on `status`. media-utils redeployed 2026-09-15 (release 4a31362,
     memory 3008 MB, Sentry DSN carried forward), so the flag now reaches
     YouTube on every upload; the on-screen line stays as the record of why.
     (f) _Teaser stills_ get the house anchors and a 9:16 framing clause
     appended once, server-side.
     (g) _First live run, 2026-09-15._ The Stability AI chapter 1 shot list
     cut off mid-JSON three times: the prompt's flat 8,000-token answer
     budget was sized for a brief that was a query and a sentence, and a
     brief under the book runs 300 to 400 tokens. `shotListAnswerTokens`
     now sizes the budget from the chapter's narration (seconds / 5 slots
     × 400 tokens, floor 8,000, clamped by `outputBudget` at the 32,000
     provider ceiling), and the book's budget grows 300 tokens per chapter.
     A chapter past about 30 minutes of narration could still hit the
     ceiling; splitting such a chapter's plan into two calls is the next
     lever if it ever happens.
     (h) _Same evening, the real cause._ The bigger budget passed chapter 1
     and chapter 2 still cut off: the ledger showed the shot-list task
     routed to `gemini-pro-latest`, successful chapters billing about
     3,000 answer tokens, and the failures taking 100 s each. Gemini 3
     thinks at its default depth before it writes and every thought token
     is spent from the same `maxOutputTokens`; the answer had 14,000 of
     room and reasoning ate it. Three changes: the Google adapter sends
     the request budget plus a 16,000-token thinking allowance (clamped at
     the 65,536 ceiling) and asks for "low" thinking on the cheap-tier
     tasks (editing, shotlist, metadata, digest); thought tokens now count
     as output in usage, so the ledger stops under-charging Gemini; and
     `planChapterSlots` retries a cut-off shot list once at double the
     budget instead of leaving Inngest to replay the identical request.
     An Inngest retry on a truncation was four paid copies of one failure.
     (i) _The first real book, read._ The Stability AI book downgraded
     three of five principals to "archival-only", described the other two
     generically ("a man in his 40s, clean-shaven"), and wrote guardrails
     and never-show lines that fenced them away from desks, documents and
     boardrooms. Three causes, all ours: the Brand Kit anchors appended to
     every still prompt ended "no identifiable real faces", which fought
     every likeness the bible asked for; the bible's own example guardrail
     was "never at a desk with documents"; and the book rules told the
     model to pick "archival-only" itself. Now: likeness is the default for
     every named public figure and only the producer downgrades it; a
     prompt names the person by full name and role before the identity
     string, so the image is of them and not a stand-in; guardrails and
     never-show lines are limited to defamation, mockery and fabricated
     evidence, never ordinary settings; the face clause is gone from the
     anchors; and the publish disclaimer says AI likenesses are illustrative
     re-creations. Stored books keep their old principals until "Redraft
     direction" is pressed. Open: an on-screen "Real footage" tag for
     archival slots and an opening illustrative card need the compositor.
     Attribution: shot rules adapted in part from visual-skills by Serge
     Shima (github.com/smixs/visual-skills, CC BY 4.0) and DirectorSKILL
     (MIT); the bible's footer carries the same line.

**Status:** `[x]` done — dossier + Studio shipped with unit, component and
e2e coverage; spec §11.3 amended in place with dated notes. Decision 252
shipped on branch `visual-direction` with unit, integration and component
coverage; media-utils redeployed 2026-09-15; merged and live the same day,
and the first real film exposed and fixed the shot-list budget, Gemini
thinking, the guardrail-in-prompt and the likeness defaults (decision 252
(g) to (i)). Decision 253 (cast references) shipped on branch
`cast-references`; migration 0022 applies on the production build.

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

23.  **The adapters own the model list and the price table.** Spec §6 puts both
     on each `LLMProvider`, so `packages/cost` now derives `LLM_PRICES` from
     `LLM_MODELS` instead of keeping the hand-written copy M1 shipped. Two
     tables drift, and the one the guard happened to read would decide whether
     a cap held. A test asserts the numbers are identical by construction.
     **The figures themselves are still provisional** — carried over from M2 and
     accepted as-is by the human (2026-08-11) rather than verified against the
     vendors' current price lists.

24.  **Model ids moved from short names to wire ids**, and `normaliseSettings`
     rewrites `opus`/`sonnet`/`haiku` on read. `SettingsSchema` accepts any
     non-empty string as a model, so an M1-era settings row parses cleanly and
     would only fail later, at the router's pre-flight, as "anthropic does not
     offer opus" — halfway into a run and nowhere near the cause.

25.  **Prompt builders and response parsers live in `packages/providers`.** They
     are logic, and spec §3 keeps logic in packages rather than in
     `apps/web/lib`. `providers` still imports nothing from `db`: the router
     takes decrypted credentials as an argument and reports downgrades through a
     callback, so the "adapters are pure" rule survives.

26.  **`parseJsonCompletion` extracts JSON but never repairs it.** Fences and
     prose around the object are stripped, because that is presentation. A
     trailing comma is not: malformed JSON means the generation went wrong, and
     patching the syntax yields a dossier with half a claim in it. The runner
     retries instead.

27.  **Change requests are a separate Inngest function, not a second wait.**
     `dossier-runner` waits only on `gate/dossier.approved`; `dossier-reviser`
     triggers on `gate/dossier.changes_requested`, re-researches and re-opens the
     gate while the main run stays parked. Racing two `waitForEvent` steps
     leaves the losing wait of every round outstanding in the run plan, and
     cannot be tested — `@inngest/test` cannot drive a run past a
     `waitForEvent` at all (see decision 20). `cancel-reconciler` proved this
     shape in M2.

28.  **Nothing crosses a step boundary except plain JSON.** Inngest serialises
     step return values, so a `BudgetExceededError` arrives as a shapeless
     object that `instanceof` will not recognise — it would have been re-thrown
     as an unknown error and retried four times. Budget gates travel as the same
     plain record the Needs-you card renders from.

29.  **The dossier approval blocker is enforced in the server action.** A
     disabled button is a hint; `approveGate` refuses outright while any claim
     is unsourced and unquarantined, so a stale tab or a replayed post cannot
     walk an unchecked assertion into a script. The predicate lives in
     `lib/claim-review.ts` and is read by the screen, the gate bar and the
     action alike.

30.  **Sentence splitting and hashing live in `packages/schemas`.** Three places
     must agree on what a sentence is: the self-check that warns against one,
     the `claim_ref` that pins a claim to one, and the Studio gutter that draws a
     marker beside one. The hash normalises whitespace, case and punctuation, so
     fixing a typo does not orphan every claim reference in the chapter — only a
     real rewording breaks the link, which is exactly when the claim should be
     re-checked.

31.  **Chapters are drafted sequentially, not fanned out.** Each is fed the tail
     of the previous one. Parallel chapters read like separate essays about the
     same company, each re-introducing the principals. Each chapter is still its
     own step, so a failure in chapter six does not re-charge one to five.

32.  **Warnings are a `jsonb` column on `chapters`, not a table.** A warning has
     no identity beyond the sentence it points at and is replaced wholesale on
     every re-check. Migration `0003`.

33.  **The Studio editor is TipTap over a paragraph-only document.** Narration
     has no other structure — the drafting prompt forbids headings, bullets and
     stage directions because the text is read aloud exactly as written — so the
     markdown round trip is lossless without a parser inventing structure. Warned
     sentences are a ProseMirror _decoration_, never a wrapper node: what reaches
     the voice stage must be exactly what the human saw.

34.  **Regenerate returns a proposal and never writes.** The human accepts or
     rejects each hunk and only that decision is saved. Nothing is accepted by
     default, and applying zero hunks returns the original byte for byte — the
     property that makes "Reject all" safe. The diff is by sentence, matching the
     unit warnings and claims already use.

35.  **The seed resets fixture claims rather than skipping them.**
     `onConflictDoNothing` left a claim quarantined by a previous E2E run, so the
     fixture's whole point — one unverified claim blocking the dossier gate —
     quietly stopped being true on the second run. `deleteCasesExcept` likewise
     clears rows the suite created, because repeatability is the value of having
     a fixture at all.

36.  **`pnpm db:migrate:test`.** A Neon branch is a point-in-time clone, not a
     follower, so migrations must be applied to it too. The obvious
     `DATABASE_URL=… pnpm db:migrate` trips the same-database guard by leaving a
     stale `DATABASE_URL_UNPOOLED` pointing at production — the guard is right,
     so the script exists instead.

37.  **Cast references: real faces in generated stills** (2026-09-15, owner
     request after the first Stability AI stills: "it's important that any
     person or character we show actually looks like the person"; spec
     `docs/superpowers/specs/2026-09-15-cast-references-design.md`, plan
     `docs/superpowers/plans/2026-09-15-cast-references.md`).
     _Why._ A text prompt cannot reproduce a face the image model never
     memorised, and neither stills route was ever shown a photograph; the
     prompt also quoted the guardrail ("never in handcuffs"), which image
     models read as suggestion. The owner chose a per-project cast over a
     channel-wide library, both image routes with Gemini first, and identity
     strings written by a vision model.
     _What._ (a) `cast_members` (migration 0022): name, role, identity
     string, guardrail, up to four photos in R2 under
     `boom-busters/cast/<projectId>/`; unique name per project; gone with the
     project. (b) The Cast card on the project page from the script stage
     onward, in every phase: add a person, four photo tiles with a view
     label, presigned PUT uploads (the decision 213 shape), Save, Describe
     from photos (≈$0.02), Remove. (c) `Msg.images` on LLM messages, emitted
    by all three adapters ahead of the text; `cast-identity.ts` writes the
    identity string and a default guardrail from the photos on the
    `direction` task, once per person on the first photo. (d) The book is
    drafted from the cast: "Cast, already photographed" with one likeness
    principal per member, exact name, identity string verbatim;
    `castWarnings` notes any member the book forgot. (e) Generation:
    `ImageGenRequest.references` and `referenceUrls`; Gemini sends inline
    parts before the prompt (three at most, refused before spending);
    fal switches to `fal-ai/flux-pro/kontext` (one) or
    `fal-ai/flux-pro/kontext/max/multi` (several), both answering 405 to a
    GET with the live key on 2026-09-15; `generateStillCandidates` looks
    up depicted cast members, prepends "<name>, the person in the reference
    photo" if the planner forgot, records `references` on the candidate,
    and falls back to text when storage cannot be read. (f) The guardrail
    leaves the image prompt for good; its nouns go to the negative prompt.
    _Not done._ Hero video conditioning (the field is shaped for it), face
    cropping on upload, a channel-wide library, and the on-screen "Real
    footage" tag. In mock storage the e2e cannot upload a photo (the
    action refuses without R2), so the spec covers add, edit and save.
    _Addendum (j), 2026-09-16, owner: "the cast needs to actually be created
    based on the script ... all I should do is upload the photo"._ The cast
    is seeded from the Director's Book. Every draft of the book
    (`draftDirectorsBook`, so the first visuals run and every Redraft
    direction) calls `seedCastFromPrincipals`: each named principal
    (depiction likeness or archival-only; anonymous ones have no name to
    photograph) becomes a member with the book's role, identity string and
    guardrail, so the name and description are written before the card is
    opened and the photo upload does not spend a vision call (the first-photo
    describe only runs on an empty identity string). Names already present,
    compared without regard to case, are left alone. "Remove person" now
    dismisses instead of deleting (`cast_members.dismissed_at`, migration
    0023): the photos are deleted, the row stays invisible to every reader,
    and the next draft cannot seed the same name again; re-adding by hand
    revives the row. The card opens itself while anyone lacks a photo, counts
    them in a status line, and marks each unphotographed row. The cast still
    fills at the start of the visuals stage, when the book is drafted, so the
    photos are uploaded at the plan checkpoint before the stills run.
    _Addendum (k), 2026-09-16, owner: "instead of uploading a photo
    physically, what about using the image URL?"_ A photo can also arrive by
    its web address, which the server fetches once and stores in R2 exactly
    as an upload does, keeping the address in the existing `sourceUrl` field
    as provenance. The link is never the reference: Gemini is handed the
    photo as inline base64 read back from storage, so a remote URL could not
    be used directly, and a link that rots would break every later still of
    that person. `apps/web/lib/remote-image.ts` does the fetching, and is
    deliberately dependency-free and byte-level: the format is read from the
    magic bytes rather than the Content-Type, which is a claim and is
    routinely wrong; the pixel size is parsed from the image's own header
    (PNG IHDR, JPEG SOF, WebP VP8/VP8L/VP8X) because there is no server-side
    decoder in this app and the browser's `createImageBitmap` is not
    available here; redirects are followed by hand so every hop is
    re-checked, not only the first; and the resolved address must be public,
    so a pasted or redirected URL cannot make the deployment fetch its own
    private network or the cloud metadata endpoint. Refusals are written as
    instructions rather than codes: a page address says to copy the image
    address instead, a 401 or 403 says to save the file and use Add photo,
    and anything whose shorter edge is under 320 px is refused as a
    thumbnail, because a small face makes a worse likeness. That floor is on
    the URL route only; a file picked off disk is a deliberate choice and
    its dimensions are browser-reported and may legitimately be zero.
    _Addendum (l), 2026-09-16, owner: "the character reference images are
    working with Google's image generator, but not the fal router with flux 2
    dev"._ fal's reference routing left the family the producer chose. When a
    still depicted cast members the adapter abandoned the routed model for
    FLUX.1 Kontext, whatever had been routed, because no text-to-image
    endpoint takes a photograph. For FLUX.2 that was both wrong and
    unnecessary: checked against fal's OpenAPI schema on 2026-09-16,
    `fal-ai/flux-2` and `fal-ai/flux-2-dev` have no image input at all, so
    FLUX.2 dev could never carry a reference itself, but `fal-ai/flux-2/edit`
    does, taking an `image_urls` array for one reference or several and
    speaking the FLUX dialect (`image_size`, not Kontext's `aspect_ratio`).
    References now route inside the family: FLUX.2 to `flux-2/edit`,
    everything else to Kontext (single or multi), Imagen borrowing Kontext
    because it has none of its own and a likeness the producer asked for
    beats staying in family. The schema is now the only accepted proof that
    a fal id exists: the previous check, a GET to the run endpoint answering
    405, proves only that the key is live, because fal validates the key
    before the method, so it would answer 405 for a path that does not
    exist. Two consequences of the old routing were invisible and are fixed
    with it: the ledger recorded the routed model though a different endpoint
    was billed, and the estimate reserved at the routed model's price, which
    under-reserves by two to four times against Kontext. `referenceRoute` is
    now part of the `ImageGenProvider` contract, declaring before the call
    which endpoint will be billed, so the reservation, the ledger's
    `meta.model` and the asset's licence line all name what actually ran.
    Gemini implements none of it: it takes its references inline on the same
    model, which is why that route was working all along.
    _Addendum (m), 2026-09-16, owner comparing the two routes: "it did work,
    but it isn't nearly as good as Gemini Flash Image"._ Part of that gap was
    self-inflicted. `MAX_STILL_REFERENCES` was a cap on how many PEOPLE a
    still could be conditioned on, and each of them contributed exactly one
    photograph, so the common case — one person in the frame — spent one
    slot and wasted two, while the Cast card asked the producer for two to
    four angles that were then never sent. The three slots are now spent
    round-robin: every depicted person gets a photograph first, because a
    face that is never shown cannot be matched, and what is left goes to
    further angles of those same people, front view first. A cast holding a
    single front view each behaves exactly as before, so nothing changes
    until the producer actually uploads angles. Billing follows the route,
    and only one route charges for it: Gemini and `flux-2/edit` are flat per
    image whatever they are given, while FLUX.1 moves from Kontext pro
    ($0.04) to Kontext max multi ($0.08) at two or more references. Since
    (l) the reservation and `meta.model` already name the endpoint that will
    be billed, so that doubling shows up on the Costs screen rather than
    arriving as a surprise. Gemini 2.5 Flash Image remains the default stills
    route: it is natively multimodal, which is why it holds a real face
    better than a diffusion edit pass, and it needs no second account.
    _Addendum (n), 2026-09-16, owner: "route different image models to
    different briefs — briefs with people use Gemini, briefs that don't need
    character likeness use the cheaper FLUX.2"._ `modelRouting.stillsLikeness`
    is a second stills route, used only when a still shows someone the cast
    holds a photograph of; null (the default) means no split and `stills`
    generates everything, exactly as before. The test is deliberately "can
    this still carry a likeness at all", not "does the brief name a person":
    a name the cast has never seen, or one with no photograph yet, buys
    nothing from the dearer generator and is routed as a plain still. That
    forced a small split in `visual-assets.ts` — `depictedCast` (database
    only) now runs BEFORE the route is chosen, and `referenceMaterials`
    fetches the bytes or presigns the URLs afterwards, because the old
    combined function needed the provider in order to decide, and the
    provider is what was being decided. `stillSlotEstimateUsd` quotes the
    dearer of the two routes, since the plan screen prices a slot before
    anything has been planned and must never promise less than the run can
    cost. Settings → Models grows one row, "Stills showing the cast",
    defaulting to "same as above". Both routes fold retired model ids on read
    (decision 211). Worth remembering when setting it: the cheap route is
    only cheap for the frames it takes, and a still wrongly classified as
    plain cannot be rescued by a better prompt, which is why the split keys
    on a photograph existing rather than on the planner's wording.
    _Addendum (o), 2026-09-16, owner: "I need that cost estimate for shots to
    be accurate otherwise what is the point"._ Fair. "Fetch visuals · est.
    $X" was slot count times one flat per-slot price, and (n) had made that
     price the dearer of the two routes, so a film of mostly plain stills was
     quoted as though every frame carried a likeness. The estimate is now
     computed brief by brief (`stillsEstimateUsd`): every brief is already
     written when the plan checkpoint is on screen, so which route a slot
     takes, and how many reference photographs travel with it, are known
     facts. On fal it also prices the reference endpoint rather than the
     routed model, and Kontext's single-versus-multi tier by the number of
     photographs that will actually be sent. A test pins the thing that
     matters: the number quoted for a brief equals the amount the ledger then
     reserves when that brief is generated. `depictedFrom` is now the one pure
     rule for whom a still shows, shared by the generator and the estimate,
     because the drift between them is what produced a useless number in the
     first place; `castMembersNamed` went with it, being a second way to ask
     the same question and now unused. `stillSlotEstimateUsd` survives for the
     teaser studio alone, which generates a beat at a time before any brief
     exists and so can only be quoted conservatively; its comment says as much.
     _Addendum (p), 2026-09-17, owner reading a generated prompt: "only include
     descriptions for non-named characters ... those descriptions are not
     necessary and may confuse the image generation"._ The prompt read "Emad
     Mostaque, founder and former CEO of Stability AI, the person in the
     reference photo. Emad Mostaque, founder and former CEO of Stability AI,
     male in his 40s, short dark hair, closely cropped beard, medium build,
     ..." The model had followed its instruction exactly, and the instruction
     was wrong: the still rule said to name the person, add the reference-photo
     clause, AND paste the identity string. The House Visual Bible had said
     both things too, telling the planner to append "the full name and identity
     string of any person shown" in one section while forbidding facial
     descriptors that contradict a photograph in another. The planner also had
     no way to tell who was photographed, since the book's principals record an
     identity string whether a photograph exists or not. Fixed on both counts.
     `buildShotListRequest` takes `photographed`, the exact names the cast holds
     photographs of, listed in the cacheable prefix with the note that their
     Identity line is planning context and must never reach a prompt. The still
     rule now splits people into three kinds that never mix: a photographed
     person gets name, role and the reference-photo clause and NO physical
     description at all, since the photograph is the likeness and prose only
     argues with it, while clothing, posture, place and light stay the
     planner's to direct; a named person with no photograph still gets the
     identity string, being all that stands between the image and a stand-in;
     an unnamed extra gets role, age range, build and clothing and no name.
     The bible's contradiction is resolved the same way, with the offending
     prompt quoted in it as the worked example of the mistake. `photographed`
     is carried by `loadDirectionInputs` and by both runners' own setup steps.
     _Addendum (q), 2026-09-17, owner: "put the Re-plan shot list button next
     to the Fetch visuals button in the Shot Plan card."_ Moved. Re-planning
     acts on the plan, not on the book, and the producer decides a plan reads
     wrong while reading the plan. The two spends now sit in one row, so the
     choice they present is the real one: fetch this plan, or plan again. The
     Direction card keeps Save and Redraft, which do act on the book, and its
     now-unused `slotsFetched` prop went with the button, the consequence line
     that named the discarded slots having moved too.

     _Addendum (r), 2026-09-17, owner: "for uploading footage for a shot,
     particularly for the Real footage category, I should be able to add an
     image via URL, same way we did for the cast."_ Added.
     `addSlotImageFromUrlAction` fetches the address server-side through the
     same `lib/remote-image.ts` the Cast card uses, with its magic-byte format
     check, header-read dimensions, per-hop redirect checks and refusal of
     private and link-local addresses, and stores the bytes under the same
     uploads key a browser upload would have used. Two deliberate limits.
     Images only: video is legal on an archival slot by file, but pulling
     200 MB through the server is precisely the byte handling decision 213
     removed, and the presigned path already exists for it. And the fetched
     image is still put past `uploadRules`, so an address cannot place an
     image where a file of the same type could not go. The fetcher took two
     options (`maxBytes`, `minEdge`) so a slot can use its own 8 MB image
     ceiling rather than the cast's 15 MB. Everything from the asset row
     onwards is now one shared `attachOwnFile`, because the file route and the
     address route differ only in how the bytes arrive, and two copies of the
     candidate-and-resolution logic would drift. The resolved address is kept
     as the candidate's `sourceUrl`, so the board shows where footage came
     from.

38.  **Every bar says its own number** (decision 254; 2026-09-17, owner watching
     a preview: "instead of having USD Millions / 4.0K, because it currently
     overlays on top of the title text, we should just have the figures sit on
     top or under each bar, like $1 Billion, $4 Billion. Because those are the
     numbers we are trying to show and it's not clear. This should be a rule
     across all bar charts we do"). The chart on screen was asking the viewer
     to read "4.0k" against a "USD Millions" caption in the corner and do the
     multiplication, while the caption itself sat over the third line of the
     takeaway. Both problems were the same problem: the number the chart came
     to show was not written anywhere.

     `formatFigure(value, unit)` in `packages/compositions/src/lib/chart.ts`
     is the one rule. The unit is prose from the planner ("USD Millions",
     "€bn", "%", "GBP"), so it is parsed for a currency and a scale, and the
     SCALE IS FOLDED INTO THE NUMBER: 4000 in "USD Millions" is four billion
     dollars, and "$4 Billion" is what the screen says. Below a million the
     figure stays itself, grouped and trimmed ("£4,000", "€1.28"); a unit that
     is neither currency nor scale rides along while it is short enough to sit
     under a bar ("4,000 jobs"), and is dropped when it is not. It replaces
     `niceNumber`, which existed twice, identically, in the render and the
     board.

     `barFigures` puts one figure on every bar for grouped bars and
     waterfalls, and one per column for a stack, reading the column's TOTAL.
     Each sits at the END of its bar, above when the bar grew upward and under
     when it fell. That is what a waterfall needs to be read at all: a falling
     segment's level is at its bottom edge, so that is where its figure goes.
     Line and area charts get none: a line has no bar to sit a figure on, and
     labelling every point is noise. They keep their two extremes, now written
     the same way.

     Consequences worth stating. Bar charts no longer draw y-axis numbers or a
     corner unit at all, so the left gutter decision 215 widened for them is
     gone (150px → 40 at 1080p, 52 → 12 on the board) and the top pad grew
     instead (30 → 72) to seat the figures above the tallest bar. One type
     size serves every figure on a chart (`fitFigureSize` takes the largest
     that fits the tightest slot, floor 20px), because a chart whose numbers
     change size between bars looks broken. And the board preview now calls
     `chartLayout` instead of recomputing the same geometry by hand, which is
     what the lib's doc comment had claimed since M6: the board is where the
     human approves the chart, so it has to be the chart. New
     `ChartRevealBar` fixture and golden; the waterfall, line, master and
     Short goldens moved with the change.

39.  **A shot sits on the words it covers** (decision 255; 2026-09-17, owner
     watching the cut: "there is something off with the timing for showing the
     image with Prem Akkaraju. For the first few seconds it is still showing
     the previous image, so the image is not updating on the beat of when the
     narration says Prem. This likely happens in other parts as well"). It did
     happen elsewhere, everywhere, by construction.

     The shot list is planned before a word of it has been timed. The model
     says how many seconds it wants per slot, and `plannedToRows` lays a
     paragraph's slots end to end from the paragraph's start, so those guessed
     seconds ARE the timing. A slot that asks two seconds more than its
     sentence takes pushes every slot behind it two seconds late, and since the
     seam pass holds the outgoing shot until the next one starts (decision
     215), what the viewer sees is the previous image still on screen while the
     narration has moved on. The drift resets at each paragraph boundary,
     because the cursor restarts there, which is why it shows on a paragraph's
     second and third shots and never its first.

     By assembly the narration is timed word by word (snap-to-script), and
     every brief already quotes the sentences it plays under: the shot-list
     prompt asks for `coversText` "EXACTLY as written". So `anchorSlots`
     (`packages/timeline/src/anchor.ts`) moves each slot's start to the first
     word of its own quote, and the compiler runs it before any shifting,
     while slots, captions and paragraph spans still share one gapless clock.
     The search is bounded to the slot's OWN paragraph (paragraph spans are
     measured take durations, the one thing the planner gets exactly right), so
     a repeated sentence cannot move a shot into another paragraph, and a
     monotonic floor stops a repeat pulling a later shot backwards. The whole
     quote is tried first, then its opening three words, which survives a model
     that trimmed a clause or fixed a typo on the way past. A slot whose quote
     is not found keeps its planned start, so nothing is worse than before.

     The seam pass now settles ends as well as gaps: a shot lasts exactly as
     long as its narration does, ending where the next shot's words begin,
     floored at `MIN_SHOT_MS` (1s) for the degenerate case of two slots quoting
     one sentence. Planned durations therefore survive only on the film's last
     shot.

     The fix is in the COMPILER, not the planner, so it reaches every project
     already planned without a re-plan (no cost, no re-fetch, no lost
     selections): re-running the preview build is enough.

     _Addendum (a), 2026-09-17, owner: make the board agree too._ It now does,
     at both ends. `TimedParagraph` carries the paragraph's script words on the
     project clock (snapped to the current take exactly as assembly snaps them,
     empty when a take has no stored timings), so `plannedToRows` anchors the
     rows it writes and the board's own `visualsReviewModel` anchors what it
     displays. One function does it in all three places, `anchoredTimes` over
     `anchorSlots`, and ends are scoped to the paragraph so that anchoring one
     chapter at planning and the whole film on the board give the same answer.
     Recomputing on the board rather than trusting the row is the same choice
     the scrubber's clock already made: a project planned before this rule, or
     re-voiced since, shows the times the render will cut to instead of the
     times the planner guessed. The cost is about 90 KB of words crossing the
     visuals runner's setup step for a 15-minute film, well inside Inngest's
     step output limit.

40.  **The music bed loops without a seam** (decision 256; 2026-09-17, owner
     watching the end of the cut: "we can hear the fade out of the background
     track, the delay, and then the start of the music loop again before the
     video ends, which sounds bad because you can hear that change. Is there a
     way we can blend the loop nicely so there isn't an obvious start and end
     as it loops"). A library track is written to end: it fades out and leaves
     a tail of silence. `<Audio loop>` restarts the file at that end, so the
     written ending became a seam in the middle of the film, the most obviously
     machine-made sound in the cut.

     The bed is now laid down as overlapping copies. Each copy stops a
     crossfade short of the file's end, which is where the fade-out lives, and
     the next starts a crossfade before that, so the two overlap for five
     seconds: the outgoing follows cos, the incoming sin. That pair is the one
     that holds a constant loudness for uncorrelated signals, and a track's
     tail against its own intro is as uncorrelated as it gets, where a straight
     linear crossfade dips in the middle. The film's last 2.5 seconds take the
     bed down the same curve, so the music follows the picture out instead of
     stopping mid-chord on the final frame. The maths is pure and unit-tested
     in `packages/compositions/src/lib/music-loop.ts`; the component reads the
     numbers out.

     Overlapping copies need the track's LENGTH, and nothing server-side can
     read one out of an MP3. So the browser measures it, where the file and a
     decoder both are: at upload from the file itself, and for beds already in
     the library, from the `<audio>` element the music tab already renders for
     each one, posted back through `recordMusicBedDurationAction`. The write
     only ever fills a blank (`setMusicBedDuration` has `isNull` in its where
     clause), which is safe because a bed's bytes are content-addressed. The
     length then travels with the key into the timeline (`MusicTrack.durationMs`,
     set by both the compiler and `swapMusicBed`), so the renderer is
     synchronous and every frame of a render sees the same soundtrack. A bed
     with no measured length still plays: it falls back to the plain loop,
     because an audible seam beats silence.

     Two notes. The preview screen's gain line is drawn from the ducking curve
     alone, so it shows neither the crossfades nor the outro fade; the curve is
     still the whole truth about ducking, which is what the line is for. And an
     existing timeline carries no length until it is recompiled, so a project
     planned before this needs the library page opened once (which measures the
     bed) and its preview rebuilt.

41.  **A headline shot quotes a real article, and cannot invent one**
     (decision 257; 2026-09-17, owner: "I want to create a new format for shots
     which is a Headline or Article where we use remotion to create what looks
     like a snapshot of the headline of a news article. The Headline, Author,
     and News outlet should match the real news article, as well as the publish
     date, just the format looks the same for consistency across brand"). The
     film quotes reporting constantly and had no way to show it: a sentence
     leaning on what a paper found played over a stock shot of an office, the
     weakest frame in the vocabulary.

     A seventh slot type, `headline`, draws the approved clipping: warm paper
     on the dark grade, the masthead over a double rule, the headline in Source
     Serif 4, a highlighter under the phrase the narration is on, and the
     byline, date and source address along the foot. It is the most dangerous
     card in the set, because it looks like evidence, so the whole design
     answers one question: where does every string on it come from.

     **The model writes none of it.** The shot-list prompt emits
     `{"type": "headline", "sourceRef": <claim number>}` and nothing else about
     the article, the same way a chart cites `dataRefs`. `resolvePlannedBrief`
     maps the number to a claim id and refuses any claim that is not
     `major_outlet` with a surviving URL, so a card citing a court filing or an
     unsourced claim is dropped at plan time with its reason on the board. The
     claim list marks the eligible ones NEWS ARTICLE so the model can aim, and
     the rule is enforced in the runner regardless, because a prompt rule with
     no enforcement is a suggestion. One card a chapter: it is bright, and it
     works by being rare.

     **The app reads the article itself.** Resolution fetches the claim's URL
     once and takes the publisher's own declared metadata: JSON-LD first, then
     Open Graph, then the meta tags, then the `<title>` with the masthead
     trimmed off. JSON-LD wins because it is the publisher's structured record
     of the piece and `og:title` is its sharing copy, and they disagree ("$1.9
    billion" against "$1.9bn"). `dateModified` is never promoted to the
     publication date, which is the single most tempting mistake here: it sits
     beside `datePublished` in nearly every block and would put 2024 on screen
     for a piece written in 2019. Each field records where it came from, and
     the board shows that, so an outlet guessed from the hostname never reads
     as a fact.

     The fetch is deliberately dull: honest user agent, no cookies, no browser
     spoofing, eight seconds, five redirect hops, the body abandoned at
     `</head>` or 512 KB. Because the URL originates from the research model it
     is the one piece of attacker-adjacent input in the feature, so every hop
     is checked against `assertSafeArticleUrl`, which refuses non-web schemes,
     odd ports, raw addresses and any hostname resolving into a private range.
     A page that will not answer gets one attempt at a Wayback snapshot, which
     is keyless and is the difference between working and not for decade-old
     reporting.

     **What it cannot read, you type.** Paywalls, consent walls and dead links
     all land on a stored record with its reason, a placeholder slot and a card
     that says "Open it and fill these in" rather than showing an error: for a
     paywalled piece that is the normal path, not a repair. A record the owner
     has corrected is `manual` and no later fetch overwrites it.

     Records live in `article_sources`, keyed by normalised URL rather than by
     slot, for two reasons: the no-waste guard hashes the brief, so resolution
     writing into it would re-fetch forever, and one article backs several
     claims, several shots and several films. Assembly then embeds the five
     strings in the timeline payload, like a chart's series, because a render
     six months later must not depend on the page still being online.

     Three legal choices are encoded rather than documented. The outlet's name
     is set in our own type and there is no logo field at all, because a
     masthead is an artistic work and a trade mark while a name is a citation.
     Every card is identical whatever ran the story, which is what separates a
     quotation from an imitation of somebody's page. And the marker phrase must
     occur in the headline word for word or it is dropped, because a highlight
     over words the publication did not print is the same kind of error as a
     wrong byline, only smaller.

     **Amended 2026-09-18** (owner: "When I click on headline, and it redrafts,
     the message that appears is 'Claude is drafting the map locations' so is it
     linking correctly"). Adding a seventh slot type put a Headline button on
     every card automatically, and nothing was behind it. `convertBrief` had no
     case for it, so the board read that null the way it reads a chart's: it
     stamped the slot `drafting` and sent the retyper an event. The card then
     announced the draft through a two-way ternary that called everything which
     was not a chart a map, and seconds later the retyper refused the target and
     the card reverted with a generic failure.

     The fix is not a noun. A headline card is unlike a chart or a map: the
     model may write no part of it, so there is nothing to draft and no call to
     pay for. The only open question is which article, and the owner is standing
     right there. The picker now opens a chooser of this project's
     news-sourced claims, and picking one writes the brief inside the click, the
     way still becomes stock. `convertBrief` takes the claim as an argument and
     still returns null without one, so the conversion cannot be made by
     accident from anywhere. An empty list says so rather than offering a button
     that can only fail. And the drafting sentence is now a lookup with a
     fallback that names the format, so an eighth slot type cannot inherit the
     map's wording the way the seventh did.

     The same chooser closes a gap the original decision shipped with: which
     article a card quotes was set once, by the shot list, with no way to
     change it. A headline slot's own format button now stays live where every
     other current-format button is disabled, because on that slot it does not
     change the format, it changes the article. The row the card already quotes
     is marked rather than offered. `convertBrief` had to learn the same
     distinction: a card moved to a different article is a real change even
     though its type has not moved, so it no longer takes the same-type short
     circuit. What survives the move is how the card is drawn; the highlight
     does not, because it names words the previous headline printed.

42.  **A shot can be asked for a different idea** (decision 258; 2026-09-18,
     owner: "I can't re-generate a new visual brief for a shot. So if I don't
     like it at all, I can't ask to create a new one and provide some guidance
     of what I am thinking"). The board had two ways to change a brief and
     nothing in between: retype the words yourself, or re-plan every slot in
     every chapter. Rejecting one idea meant either writing the replacement by
     hand or throwing away the whole board to get a second opinion on one shot.

     "Draft a different brief" sits beside Edit brief and opens a box for what
     the owner is picturing. The steer is optional, because "I do not like this
     one, give me another" is a complete instruction and demanding a reason for
     it would turn a small button into a form. It is also one-off, and the form
     says so: a later re-plan drafts the slot again from the Director's Book,
     exactly as it already overwrites hand-edits.

     The format is deliberately not in question. A re-type changes what KIND of
     shot this is and has its own button; this changes the idea inside the kind
     already chosen, which is what keeps the anti-slop rules where they are. Two
     prompt paths sit behind the one button, because two kinds of brief exist.
     Stock, real footage and AI image briefs are ideas, so a new prompt asks for
     another one under the same craft rules the redirect already follows. Chart
     and map briefs are data, so they go back through the re-type drafting path
     with the target set to the type they already have: not a shortcut, but how
     a redrawn chart still cannot cite numbers the dossier does not hold.

     A headline card is never offered the button at all. Every word on it is
     read from the article, so there is no idea to have again, and changing
     which article it quotes is the chooser's job (decision 257).

     The work runs in a `slot-rebriefer` function behind the cost guard, the
     third instance of the pattern the retyper and redirector established, and
     a refusal comes back in the model's own words on the card rather than as a
     failed stage. The pending state shares the `retype` column, which now means
     "a model is rewriting this slot's brief" whichever button asked: one slot
     may only have one such job at a time, and sharing the state is what lets
     each button disable while the other one's work is in flight.

43.  **A chart is the kind its data is, and may carry two measures**
     (decision 259; 2026-09-18, owner: "it feels like there isn't any ability to
     generate different chart types. Its fixed to bar charts, because I asked it
     to create a chart like this 'Valuation vs Profitability line charts showing
     the valuation increasing overtime, but the profitability growing negatively
     exponentially' and it just generated the same bar chart").

     Three separate things were wrong, and the first was not what it looked
     like. The five chart kinds were already supported end to end: schema,
     prompt, board preview and render all branch on all of them, and the preview
     and the render share one geometry module. Nothing was fixed to bars.

     What actually happened is that no model ever saw the request. On a chart
     slot "Edit brief" can only change `description`, which is not what draws the
     chart, and "Regenerate" re-fetches candidates, of which a chart has none.
     The sequence saved a sentence into a field nobody reads and redrew the
     identical chart. Decision 258's button is the one that reaches a model, and
     it had shipped minutes earlier.

     **Nothing told the model how to choose.** The prompts listed five kinds and
     never said which was for what, and the Director's Book craft notes mention
     charts three times without naming a kind. A model with no rule falls back on
     its habit, and its habit is bars. Both prompts now carry the rule: a value
     through time is a line, a filled line when the size of it is the point, a
     comparison across things is a bar, parts of a whole are stacked, a bridge
     between totals is a waterfall, and never a bar because it is the safe
     choice.

     **And the chart asked for could not be drawn at all.** `chartLayout` pooled
     every series into one y scale and took one unit from the first series, so a
     valuation in billions against a margin in percent put the margin flat along
     the floor, labelled in dollars. Series now carry an optional
     `axis: 'left' | 'right'`, the layout builds a scale per side, and every
     drawing path asks which scale a series belongs to. When the model omits the
     field but the units differ, the split is inferred rather than drawn
     misleadingly: a forgotten field must not produce a chart that lies. Stacks
     and waterfalls never split, because adding two units together means nothing.

     Rebasing both series to an index of 100 was the other way to do this, and
     was rejected: every figure on screen comes from a claim verbatim, and an
     index puts computed numbers on screen that appear in no claim.

     The golden caught what code review would not have. With two scales the
     axis extremes land beside the WRONG line: the valuation's top sits exactly
     where the margin begins. Each axis now names its series and takes that
     series' colour, and the name is cut to the gutter it has, because the SVG
     edge was silently swallowing "Operating margin" down to "Operating".

44.  **A frame shows what its sentence says; motifs are a detail, not the
     subject** (decision 260; 2026-09-18, owner: "the Director's Book is
     sticking too strongly with the motifs and elements ... what would have
     been better is to have looked at the narration text and created a shot
     that actually captures what the narrator just said").

     The cause was in the fixed bible, not the per-film book. "What a still
     prompt must contain" required three physical facts in every prompt, the
     third being "one motif from the director's book", so every AI still was
     required to carry a motif: a chapter with twelve stills got twelve empty
     chairs. The chapter rule ("each chapter shows at least one") was a floor
     with no ceiling, and the per-still rule made the floor irrelevant. Three
     things compounded it: nothing tied the picture to the sentence
     (`coversText` had to quote it, nothing had to show it); the book prompt
     asked for three motifs with no guidance on choosing them, so the model
     restated the house look; and the redirect fallback named "the empty
     chair" as its first example.

     Five changes, all prompt craft, no model call added. The bible's shot
     grammar opens with "the sentence decides the frame" (a viewer with the
     sound off should be able to guess the sentence); motifs keep the floor
     and gain a ceiling (each at most once per chapter, never adjacent, never
     the subject unless the sentence is about it); the third physical fact is
     a detail drawn from the sentence, with a motif allowed to stand in once
     per chapter. The shot-list prompt carries the same rule first in its
     planning rules, in numbers. The book prompt says motifs are this story's
     own objects from the claims, never the house furniture. A chapter's
     dominant family renders as "leans towards", so it is not read as the only
     family. And `planWarnings` counts motifs per chapter by head noun (the
     last word, plural stripped: "server racks" matches "rack"), warning when
     one appears in more than one picture brief of a chapter or in adjacent
     slots. A note, never a rejection: the match is a heuristic. The markdown
     bible is now re-embedded by
     `pnpm --filter @boom-busters/providers embed:craft` rather than by hand.

45.  **A slot may show another slot's shot** (decision 261; 2026-09-18, owner:
     "there may also be instances where some shots can be re-used ... from a
     cost and efficiency perspective it's not a bad idea, as long as the shot
     fits the narrative and the context and is done so sparingly"; spec
     `docs/superpowers/specs/2026-09-18-sentence-first-briefs-and-shot-reuse-design.md`).

     _Who decides._ The owner, on the board, in either phase. Chapters are
     planned by separate calls that cannot see each other, so a model cannot
     spot a cross-chapter repeat at plan time, and "sparingly, when it fits"
     is a taste judgment. A model-proposed pass is a possible later decision
     on the same link.

     _The mechanism_ (approach A of three). `shot_slots.reuse_of_slot_id`
     (migration 0025) records the link. Before Fetch the link stands alone:
     `slotNeedsResolution` never owes a linked slot a fetch, so no still is
     generated for it, and a new runner step `copy-reused-shots` after the
     fan-out copies each source's chosen candidate into its dependants,
     repeating the pass while a fill makes another possible so the write is
     right whatever order rows arrive in (status resolved, the target's own
     brief hash, the source's asset id; a source with nothing chosen leaves
     a placeholder). On the board the action copies at once. Every
     downstream reader keeps reading `candidates` as it did: assembly,
     ingestion, the gate, shorts and the teaser. The copy carries
     `reusedFrom: { slotId, depicts }` and drops the source's score (judged
     against another brief); `syntheticLikenesses` reads
     `reusedFrom.depicts`, so a likeness reused into a stock slot still sets
     the altered-content label. A live link (every reader follows the
     column) was rejected as five readers and a gate rule for re-planned
     sources; a copy with no column was rejected because before Fetch there
     is nothing to copy, and the saving before Fetch was the point.

     _Rules._ Only stock, still and archival slots reuse or are reused; no
     self-reuse; no chains (a pick that is itself a dependant re-points to
     the original, and a slot other slots show cannot itself be linked);
     same project only. Every rule lives in the server action, and every
     fetch-shaped action (Regenerate, Fetch this slot, Draft a different
     brief, Redirect, Upload, re-type) refuses a linked slot in words; a
     brief edit saves and never fetches for one, and `updateSlotBrief` keeps
     a linked slot's status. The refetcher skips a linked slot for an event
     already in flight.

     _The board._ "Use an existing shot" on picture cards opens a panel of
     the film's other originals grouped by chapter: the covered sentence,
     "ch 2 · 3:10", the gap ("3 min 20 s earlier"), one "Use this" per
     candidate the app holds bytes for (the chosen one, the paid-for still
     variant nobody chose, uploads), and before Fetch one "Use whatever this
     slot chooses". Under a minute apart is a note, not a block, and the
     review model repeats it as "the same shot plays at 3:10 and 3:40". A
     linked card shows the copy with the chip "Reused from ch 2 · 3:10",
     keeps Edit brief, hides everything that would fetch, and offers "Choose
     its own shot". A source card says "Also used at 7:42". The model
     carries `reuse` per slot; the per-slot `reusedBy` count the spec named
     was dropped as unread, since the card derives "Also used at" from the
     slots it already holds.

     _Tests._ Pure: the guard, the schema, `reuseView` and the spacing note.
     DB: link with and without a candidate, copy on resolve, unlink, the
     brief edit. Runner: the copy step is one line over `copyReusedShots`,
     which the db suite proves, because the test harness cannot drive a run
     past `step.waitForEvent`; the refetcher's skip is proved by driving the
     refetcher, which has no wait in front of it. Actions: chains, types,
     other films, the refusals. Board: the picker and the linked card.
     E2E: the round trip on the seeded plan project (link, the bill drops to
     one slot, unlink), and the picker on the seeded board's placeholder,
     cancelled, because a board copy cannot be put back into the exact
     seeded state from the UI.

46.  **A cast name with a role after it was a stranger** (decision 262;
     2026-09-19, owner: "the shots whose briefs specifically mention a
     character in the Cast ... it's just routing to flux and not to Gemini who
     currently is assigned to do the cast AI image generation").

     The join between a brief and the cast is the exact full name, and
     `depictedFrom` implemented it as exact string equality. The shot-list
     prompt, however, told the planner to "name them by full name and role"
     in the prompt and then "list them in depicts" in the same breath, and on
     the Stability AI plan the model carried the role into the list: six of
     the eight cast stills read `["Emad Mostaque, founder and former CEO of
Stability AI"]` where two read `["Emad Mostaque"]`. Equality saw a
     stranger, so `members` came back empty, `routeFor` took the plain
     route, and those six went to `fal-ai/flux-2` at $0.04 with no reference
     photograph attached, while the two bare-name slots went to
     `gemini-2.5-flash-image` with the photographs. The cost ledger shows
     both, minutes apart, on the same film: `refs: null` beside
     `refs: ["Emad Mostaque"]`.

     The fix is one join, in schemas beside the cast itself:
     `depictsName(entry, name)` matches when the entry IS the name or begins
     with the name and goes on with a separator (a comma, a bracket, a colon,
     a dash), all case- and whitespace-insensitive, and `depictedMembers`
     applies it across the cast in cast order. "An aide to Emad Mostaque",
     "Emad Mostaque's assistant" and "Emad Mostaque Junior" are not him.
     Routing, the estimate, the photographs sent and the altered-content
     label now all go through it, which is what stops the estimate and the
     ledger disagreeing again.

     Tightening the prompt alone was rejected as the whole fix: the same
     instruction has been followed loosely twice now (the identity-string
     duplication of decision 253 was the first), and a planner's near-miss
     should not silently change which generator is billed. The prompt is
     tightened as well ("by name alone, never with the role after it", in the
     slot shape, the person rules and the bible's pre-flight), so new plans
     write the clean form and old plans still route correctly.

     _Not done._ Slots already generated keep their flux images; the brief
     has not changed, so a re-fetch skips them on the resolved-brief hash.
     Regenerate is the board button for that, per slot, and it is the owner's
     to spend.

     _Tests._ Schemas: the matcher against the bare name, the role forms, and
     the four near-misses. Web (DB-backed): a role-suffixed `depicts` routes
     to the likeness model and carries one reference, and prices at the
     likeness rate. Publish: two spellings of one person are one name on the
     label. Prompts: the shot list and the bible ask for the name alone.

47.  **The style anchors argued with the bible, in every prompt** (decision
     263; 2026-09-19, owner: "in our Directors bible I think we should allow
     logos to be included, especially for a documentary channel on companies
     as logos are identifiable").

     `stillStyleAnchors` ended with "cinematic, sombre, photographic realism;
     no text, no logos, no watermarks", and the shot-list prompt tells the
     planner to paste the anchors verbatim into every still prompt. On the
     live Stability AI plan that string sat in all 48 of them. Two things were
     wrong with it.

     **The logo ban fought the genre.** A film about a company is about an
     identifiable company, and the sign above the door, the badge on a laptop
     lid and the lanyard on the desk are what make a frame look like it is
     about that company rather than about an office. Worse, the bible's own
     rule two sections down says image models read negation as suggestion, and
     that "never in handcuffs" in a prompt invites handcuffs. The ban printed
     the word "logos" into every prompt it was meant to keep logos out of.
     There was already a precedent for exactly this removal: the anchors once
     carried "no identifiable real faces", and that came out under decision
     252 because it fought every likeness the bible asked for. A test locks
     that removal in, and this decision adds its twin.

     **"cinematic" is on the banned list.** `BANNED_PROMPT_WORDS` bans it, and
     `planWarnings` scans every still prompt for banned words, so all 48
     stills raised a craft warning against a word this function had supplied.
     The warning was correct and the prompt was the app's own.

     The anchors now carry positive direction only: grain, the graded palette,
     sombre, photographic realism. The bible decides marks per shot. It allows
     a real company's own marks in frame, refuses a mark the frame must render
     as legible letters (a generated wordmark is a wrong one, and a wrong one
     reads as a forgery), and keeps titles, captions and lower thirds with the
     compositor. A slot that genuinely needs an exclusion still has its own
     negative prompt, which is the per-shot instrument the blanket string was
     standing in for.

     The headline card is untouched and stays untouched. Its outlet name is set
     in the house serif with no logo field, and that decision (257) is about
     reproducing a publisher's page, not about showing a company's mark in a
     film about that company. Generated logos remain out; the owner's plan is
     to upload real logo files and composite them, which is the asset library
     the motion-graphics work will carry.

     _Tests._ The anchors forbid no logos, the twin of the faces assertion; the
     anchors contain no word from `BANNED_PROMPT_WORDS`; the bible carries the
     new rule in all three of its parts.

48.  **A room is the cast's twin, and a shot says which model it spends on**
     (decision 264; 2026-09-19 to 2026-09-21, owner: "we upload a few
     examples of an Office set and the same office set can be used with the
     characters in the image generation ... like any documentary or movie,
     the person's office doesn't change" and "when we edit a brief, we should
     have a drop down to actually change the model ... when the shot list is
     created a model gets picked based on the brief but we can change it").

     The Cast (decision 253) gave a film's people a face the image model
     could hold. Its rooms had nothing: the Director's Book already named
     them as `locations`, but a boardroom was re-invented on every still, and
     an Apple laptop on one desk was a generic one on the next. Sets are the
     cast's twin, down to the module shape: a `project_sets` table beside
     `cast_members`, a Set card beside the Cast card, `set-actions.ts`
     mirroring `cast-actions.ts`, and `setForBrief` joining a brief's new
     `set` field to the library through the same tolerant `nameMatches` the
     cast join uses. The book seeds a set for each location when it is
     drafted, once; the producer's removals stick. Up to four plates per set,
     uploaded or generated from the set's own look and chosen by the owner,
     establishing view first.

     **Two reference pools, with the limits each model documents.** Google
     budgets character references and object references separately and the
     numbers differ by model: gemini-3.1-flash-image takes 4 and 10,
     gemini-3-pro-image 5 and 6, and gemini-2.5-flash-image is undocumented,
     so it keeps the old conservative 3 and 0. Every `ImageReference` now
     carries a `kind`, every adapter exposes `referenceLimits(model)`, and
     the Gemini adapter refuses a request that exceeds either pool rather
     than letting the endpoint fail it. Above the model's limits sits the
     app's own policy: at most three character photographs and two set
     plates in one still, spent people first (one front view each, then one
     establishing plate, then further angles, then one more plate), because
     a wrong face is worse than a wrong room. The prompt names only the
     people whose photographs actually travel, so a tighter model can never
     be told about a face it was not shown.

     **The route is chosen by rule and stored on the slot.** `routeForBrief`
     sends a still that shows a photographed person or a photographed set to
     the reference-capable route (`stillsLikeness`, else `stills`) and
     everything else to `stills`. Nothing is written at plan time: the brief
     editor's `Image model` select shows the rule's choice as the Planned
     default, and only an owner's change is stored on the slot, where it
     wins in generation and in the estimate. The stored route is part of the
     fingerprint the fetch pass compares, so changing the model makes the
     slot owe work again and nothing regenerates on its own: the toast says
     so in words. A re-plan replaces the slot rows and the board warns that
     model choices go with them. A stored model an adapter later retires
     falls back to the rule rather than breaking the page. The first cut
     stamped a derived route on every planned slot; the whole-branch review
     showed that made the Settings default inert for any existing plan, and
     the stamp came out. The default stills model moves from
     gemini-2.5-flash-image to gemini-3.1-flash-image, the one that takes
     both kinds of reference; a project configured before this keeps what it
     has. At two variants a slot, flux-2 is $0.04, 2.5 flash $0.08, 3.1
     flash $0.14 and 3 pro $0.30; a 48-still film all on 3.1 flash is $6.72
    against $2.24 today.

     **Two leaks closed on the way.** Deriving the resolution stamp inside
     `setSlotResolution` from the row, instead of trusting each caller to
     pass it, exposed two paths that never stamped: the single-slot
     refetcher left a shot it had just paid for marked as owed, so the next
     Fetch bought it again, and stock ingestion wiped the runner's stamp so
     every ingested stock slot was re-fetched on the following pass. Both
     stamp correctly now. The first cut re-read the row to derive the stamp
     and accepted a race; the whole-branch review showed a route changed
     mid-fetch would then stamp a correct-looking picture against a model
     that never ran. So a resolved outcome now carries the brief and route
     the candidates answered, as a required argument, and the stamp is
     computed from that snapshot in the one place that writes it. Forgetting
     is a type error, which is the property the first cut was reaching for.

     **Plan warnings know about rooms.** A set carrying more than half a
     chapter's picture briefs, the same set on adjacent slots, and a set the
     film does not hold each get one note, in the words the plan screen
     already uses for motifs and unphotographed names. The shot-list prompt
     lists the film's sets with their look, and the bible's new line says
     what a set is for: "the photographs are the room", name one when the
     sentence is in it, and never describe the room again.

     _Not done._ The owner's live project is still routed at fal for plain
     stills and Gemini 2.5 for likeness; that is one change in Settings. Its
     existing plan names no sets until it is re-planned or the briefs are
     edited by hand. No paid generation was run in development; the one
     spike that would prove the plates change a real Gemini frame (about
     $0.21) waits for the owner's go-ahead. The Generate a plate label quotes
    the default model's price ($0.14) as a constant, the way the cast card's
     Describe button does, so it is off for an owner who routes stills at
     fal; the ledger charges the true amount.

     _Tests._ Final run on the branch head: schemas 316, db 256, providers 484, apps/web 774 across 77 files, e2e 114; typecheck 10 of 10, lint and prettier clean, no dash on any added line. Schemas: set and plate shapes, the
     establishing-first order, the tolerant join, the three set warnings and
     the exact-half boundary. DB: the set library round trips, seeding
     idempotence, the byte-identical no-route hash, a route change making a
     slot owe work. Providers: the limits table, refusal when either pool
     overflows and acceptance at the limit, the prompt's sets block and its
     byte-identical no-sets path, the bible phrases. Web: plates ride beside
     faces in the request sent, the spend order, a name only with a photo
     behind it, the route by rule, a stored route winning in generation and
     in the estimate, every set action against the database including the
     chosen plate copied from storage, the Set card, the model select and
     its six refusals, the runner seeding sets and leaving every route
     null after a plan. e2e: the Set card
     takes a new room and a slot takes a new model.

49.  **A reused book never seeded its rooms, and the plate price was a
     constant** (decision 265; 2026-09-21, owner: "I re-ran the Visuals stage,
     and no Sets were created" and "the default Model ... should be whatever
     is set in the Settings").

     Set seeding lived in `draftDirectorsBook` only, and a re-run of the
     stage goes through `loadOrDraftDirectorsBook`, which returns the stored
     book untouched so an owner's edits survive. The live project's book
     names three locations; after the re-run it held zero sets. The reuse
     path now seeds cast and sets as well. Both seeders skip names that exist
     and names the owner dismissed, so a re-run with nothing new is free.

     Every routing decision already read Settings: the board's planned
     default, the estimate and generation all derive from
     `modelRouting.stills`, which on the live install is Gemini 2.5 for both
     routes. What did not was the Set card's Generate a plate label, a
     constant $0.14 copied from the cast card's pattern, which named the
     schema default's price whatever Settings said. It now quotes the routed
     stills model's price, computed on the page. The schema default for a
     fresh install with no settings row stays gemini-3.1-flash-image; an
     existing install is never moved by it.

     _Tests._ direction.test.ts: a stored book with two locations seeds both
     on reuse and adds nothing on a second reuse. set-card.test.tsx: the
     label quotes the price it is given. Full app suite 77 files, 775.

50.  **AVIF is accepted at every image door and stored as JPEG**
     (decision 266; 2026-09-21, owner: "please can you also support avif for
     image uploads, whether its manual or through pasting an image address").

     No image model reads AVIF: Gemini takes PNG, JPEG, WebP, HEIC and HEIF,
     Anthropic takes PNG, JPEG, GIF and WebP. A stored AVIF would have looked
     healthy in the console and failed at the moment a still was generated,
     which is the moment money is spent. So AVIF is converted at the door and
     the union of stored formats stays the three every model reads:
     `CAST_PHOTO_MIME`, `ImageReference`, `MsgImage` and every provider
     adapter are untouched, and no migration was needed.

     The two doors convert in different places because the bytes are in
     different places. A picked file goes browser to R2 on a presigned PUT
     (decision 205) and the server never sees it, so the new
     `lib/client-image.ts` converts it before the hash: what is
     fingerprinted, uploaded and recorded is the JPEG. A pasted address is
     fetched by the server, so `lib/remote-image.ts` converts it there with
     `sharp`, imported inside the AVIF branch only so that nothing else
     loads the native module. `sharp` is a new explicit dependency of
     apps/web; it was already in the lockfile under Next 16 and is named in
     `serverExternalPackages` so Next leaves the platform binary alone.

     Both sides cap the longest edge at 3072, because a 15 MB AVIF holds far
     more pixels than a 15 MB JPEG and only a conversion re-encodes. Both
     take a format argument and can write PNG instead, for the uploaded logos
     the motion-graphics work will need. The thumbnail floor now measures the
     converted file, which is the one the model is given. `readImageSize`,
     byte-identical in both cards, moved into the new module beside its
     conversion sibling.

     _Tests._ remote-image.test.ts: a real AVIF encoded in the test sniffs by
     major brand and by a compatible one, comes back as true JPEG bytes at
     its true size, is held to the same thumbnail floor, is capped at 3072
     when huge, and is refused when damaged. client-image.test.ts: the
     browser decode and encode sit behind a codec seam, and the rest is
     exercised for real, including the rename, the PNG option, and both
     failure paths. cast-card.test.tsx: proved red first, the card uploads
     the converted file rather than the AVIF. Full suite 9 of 9 workspaces,
     apps/web 78 files, e2e 114.

     _Noticed here, fixed in 51._ An intermittent reference-order failure in
     visual-assets.test.ts. The first diagnosis, that `newId` was not
     monotonic, was a real defect but not this one.

51.  **A re-added person came back in their old place, and `newId` was not
     monotonic** (decision 267; 2026-09-21, found while finishing 50).

     `visual-assets.test.ts` failed intermittently on the order of the
     reference photographs sent to the image model: Prem before Emad, when
     the test inserts Emad first. Run alone it failed, run with its file it
     passed, which is the shape of a test reading state the shared test
     database was left in rather than state it set.

     _The cause._ Dismissing is a soft delete, and `insertCastMember`
     revives a dismissed row rather than refusing the name. The revival kept
     the row's original `createdAt`, and `listCastMembers` orders by
     `(createdAt, id)`. So a person re-added after being dismissed came back
     wherever the Director's Book first put them, weeks of edits ago. The
     test's `beforeEach` dismisses the fixture's cast, so every later insert
     was a revival carrying the seed's order. `insertProjectSet` had the
     same shape. Both now stamp `createdAt` afresh: re-adding is adding.
     The order this decides is not cosmetic. It is the order the references
     reach the image model in, and the first one carries the most weight.

     _And a second, real defect found on the way._ `newId` called `ulid()`,
     whose random half is fresh every call, so two ids minted in the same
     millisecond sorted by coin flip. Rows created in one loop, which is how
     the book seeds its principals and its locations, share a `created_at`
     to the millisecond and are tie-broken on the id. It now uses
     `monotonicFactory()`. The comments in `listCastMembers` and
     `listProjectSets` asserting that ULIDs are monotonic were, until this
     change, simply false; they now name the reason. This was the first
     diagnosis of the failure above and it was wrong: the fix is kept because
     the defect is real, not because it fixed that test.

     _Tests._ ids.test.ts: 500 ids minted in a tight loop already sort in
     creation order, which was red on `ulid()`. Its predecessor compared two
     identical sorts and could not fail; it is gone. cast.integration and
     sets.integration: a revived person, and a revived room, sort after the
     one added while they were away. Both red first. Full suite 9 of 9
     workspaces, typecheck 10 of 10, e2e 114.

52.  **The logo library, and the watermark draws the channel mark**
     (decision 268, Plan A; 2026-09-21, owner: "logos shouldn't be generated,
     they should be uploaded and then composited").

     Marks are `assets` rows of kind `logo`, the enum value that has existed
     since M1 with nothing writing it, channel-wide and deduped by content hash
     like music, titled with the entity's name as the dossier writes it. That
     name is the join: `logoForEntity` matches a graphic's "logo" element to
     the library with the cast's tolerant `nameMatches`, ready for Plan B.

     Stored marks are always raster. SVG and AVIF are drawn to PNG at the door
     (the browser's canvas for a picked file, sharp for a pasted address, 2048
     px on the long edge, transparency kept), so the render's Chromium never
     executes anything an upload contained. The spec had named an SVG
     sanitiser; rasterising is smaller and closes the hole completely, and the
     spec was amended to say so.

     `brand.look.logoR2Key`, empty since M6, is now set from the Logos tab;
     both materialisers resolve it to `look.logoUrl`, which exists only in the
     resolved brand form, and `Watermark`, now its own component, draws the
     mark at 1.6 caption heights and 0.6 alpha with the typographic wordmark as
     the fallback.

     Finishing this entry: `e2e/playwright.config.ts` now blanks the four
     `R2_*` variables in the web-server env, mirroring the broker guard,
     because a developer machine's `.env.local` held real R2 credentials and
     "Add from address" reached the network during the suite; the e2e suite
     therefore never exercises configured storage, which the action and
     component tests cover. A final review also widened `logoForEntity` to
     check both directions, so a stored title carrying a role or suffix is
     found too, not only a query written that way.

     _Tests._ Schema: stored formats, the picker's accept string, the entity
     matcher including the contained-name refusal, the resolved-only URL.
     Database: dedupe on re-upload as a rename, the name join, never a bed.
     Browser: SVG and AVIF to PNG through the codec and rasteriser seams.
     Server: a pasted SVG comes back as PNG bytes with alpha at 2048 px; the 4
     MB cap; no thumbnail floor for a mark. Actions: the presign refuses SVG
     and AVIF by design; finalise checks the key shape; add by address hashes
     the fetched bytes; the channel mark cannot be removed while chosen. Tab:
     the whole browser-to-R2 path, the JPEG warning, rename, confirm-remove.
     Materialisers: both resolve the mark; the preview drops nothing for one it
     cannot. Snapshot: `WatermarkLogo`, new golden only. e2e: seeded marks,
     channel mark chosen and cleared across a reload, rename round trip. Full
     suite 9 of 9 workspaces, apps/web 80 files, typecheck 10 of 10, e2e 117.

     _Polish (2026-09-22)._ Decision 268's parked finding, closed:
     `insertLogo`'s upsert now updates a conflicting row only when it is
     already a logo (`setWhere`), returning null otherwise, so a content-hash
     collision with an asset of another kind is refused rather than silently
     renamed and resized; `finaliseLogoAction` and `addLogoFromUrlAction` check
     for null instead of inspecting the row's kind after the write. The mark
     tile in Settings now sits on the brand background (spec 6.3), passed down
     as `settings.brandKit.colors.background`, not the console's own ground.
     The corner watermark falls back to the typographic wordmark when its image
     fails to load, through `Img`'s `onError`, making good on the component's
     own comment. A picked AVIF mark is now rasterised at the 2048 px logo edge
     like every other path into the library, not the wider 3072 px pasted-image
     cap. Also done: one settings test file instead of two; one import in
     `remote-image.ts`; the oversize-delete branch and several refusal paths
     now have tests; a single `logoById` read replaces two `listLogos` scans on
     remove and on choosing the channel mark; both insert paths clamp width and
     height alike; and the `Watermark` file comment now sits on the function it
     describes.

53.  **The graphic slot: a scene the planner composes**
     (decision 268, Plan B; 2026-09-22).

     A graphic is composed, not picked from a catalogue of templates.
     `packages/schemas/src/graphics.ts` fixes the vocabulary: at most six
     elements, from `text`, `figure`, `logo`, `shape` and `bars`, placed on
     a 12 by 12 grid, coloured only by the NAMES of Brand Kit tokens (never
     a hex value), with type sized by a role (heading, title, body,
     numbers, captions) rather than a chosen pixel size. The rules live in
     the schema rather than in a template, and they have teeth: every
     `figure` and every `bars` item carries a `claimRef`, and
     `figureCitesClaim` checks the digit groups the shown value carries
     against the cited claim's own text (thousands separators stripped, any
     surrounding word or symbol such as "bn", "%" or "billion" a rendering
     choice and not compared), so a figure cannot state a number the
     dossier does not support. A `logo` element names its entity exactly as
     the dossier writes it and carries no styling of its own; nothing in
     the scene is a raw colour or a raw font size.

     One pure layout module, `packages/compositions/src/lib/graphic.ts`,
     computes every box and font size a graphic uses, and both the board's
     SVG preview and the Remotion `GraphicCard` call it, so the graphic the
     owner approves is the graphic that renders. The design document's
     section 5.1 had specified `fitText` from `@remotion/layout-utils`,
     which measures text on a canvas; the board runs in the owner's browser
     and the render runs in headless Chromium, and the two carry different
     fonts, so a measurement taken in one would not match a measurement
     taken in the other, and the preview would drift from the render.
     `fitFontPx` fits with a pure estimator instead, a conservative average
     glyph width of 0.56 em, which returns the same number wherever it runs
     and needed no new dependency; the trade is a label a few pixels
     tighter than a true measurement would give it. The estimate never
     returns below 12 pixels: past that point a long label overflows its
     box rather than shrink further, because type under 12 pixels is a
     smudge on a phone screen. Both are deliberate trades, recorded here so
     neither reads as an oversight later.

     Portrait re-flow (`reflowPortrait`) ranks its invariants rather than
     honouring both at once. Auto-flowed elements must never collide with
     each other, because that silently drops content off the card, and
     that outranks the milder preference of starting the flow below
     whatever the author pinned: when the rows left beneath the pins cannot
     seat every flowed element, the flow claims the whole grid instead and
     may land on top of a pin. An overlapped pin is visible and the author
     can move it; two elements sharing a row is content that vanished
     without a trace, which is the failure this ranking exists to rule out.

     Resolution is `resolvePlannedBrief`
     (`packages/schemas/src/visuals.ts`), the same function a chart or a
     headline brief already goes through: the claim NUMBERS the model
     wrote become claim ids, checked against the claim list and, for a
     `figure` or a `bars` item, against the cited claim's own text. A
     `logo` element's entity name is joined to the asset library through
     `logoForEntity`, the cast's tolerant `nameMatches` run in both
     directions so a stored title carrying a role or a suffix still
     matches a bare query, and a query carrying one still matches a bare
     title. A mark the library does not hold is not a refusal: the element
     is stored as written, the slot resolves to `placeholder`, and the
     board's card offers an `Add logo for <entity>` button rather than an
     error. Nothing is fetched and nothing is spent either way: resolved
     or placeholder, `resolveSlotBrief` prices a graphic at $0.

     The planner drafts a graphic the same call it drafts everything else:
     the shot-list prompt (`packages/providers/src/prompts/shotlist.ts`)
     writes the vocabulary out in full for the model, the element shapes,
     the 12 by 12 cell, the token colour names, and the rule for reaching
     for a graphic instead of a chart (one or two cited figures, a mark, or
     a relationship between named things, never a value moving through
     time). The other two model-drafted paths, re-typing a slot to
     `graphic` and asking "Draft a different brief" on a slot that already
     is one, both go through the same structured drafting request a chart
     or map redraft takes, rather than the free-form idea path a stock or
     still redraft takes, because a graphic is data; that keeps the
     claim-number check in the one place resolution already enforces it.
     Migration 0027 is the only schema change the database needed: one new
     `shot_type` enum value, `graphic`, ahead of `hero`.

     _Not done._ A placeholder graphic still counts toward the board's
     "Fetch visuals" action, because `slotNeedsResolution` reads status and
     brief hash only and has never special-cased a type; fetching buys a
     waiting graphic nothing, since only an upload resolves it. That is not
     a bug for `slotNeedsResolution` to fix by excluding graphics: the
     approval gate (`visualsApprovalBlockedReason`, `visualsCoverage`)
     reads `slot.status` directly rather than the fetch count, so a
     placeholder graphic already forces the same explicit "approve with N
     placeholders" wording a placeholder photograph does. The wart is
     narrower: the fetch button is the wrong affordance for one slot type,
     a board question, not a resolution bug. Rendered video does not carry
     `GraphicCard` yet either: a web deploy ships the board's preview only,
     and the render gets new or changed compositions only once the owner's
     `deploy:remotion` script re-uploads the Remotion site.

     _Tests._ Schema: the vocabulary's own rules (six elements at most, a
     `count` entrance reserved to figures alone, unique ids, one logo per
     entity, the grid refinement), `figureCitesClaim` against separators, scale
     words and a claim that does not carry the number, and
     `resolvePlannedBrief` mapping claim numbers to ids and entity names to
     library assets, including a logo left unresolved rather than refused.
     Database: a `graphic` row round-trips through the real `shot_type`
     enum. Compositions: `fitFontPx`'s fit and its floor,
     `reflowPortrait`'s pin and collision invariants under a starved grid,
     and `GraphicCard`'s two goldens (wide and tall) against a composed
     scene with a counting figure, a pulse and an underline. Web: the
     board's preview reading the same layout module the card does, down to
     the role's size scale, the claim chips, the missing-mark uploader,
     `attachGraphicLogosAction` re-matching a whole scene on one upload,
     and `resolveSlotBrief` pricing a graphic at $0. e2e: a resolved
     graphic citing a seeded mark and a claim, and a placeholder graphic
     asking for one that does not exist. Full suite 9 of 9 workspaces,
     apps/web 80 files, typecheck 10 of 10, e2e 118 (last measured; not
     re-run here).

54.  **References the plan never names, and graphics that never move**
     (2026-09-22, owner report: "I have added references, but it doesn't
     seem like they are being used to generate any of the shots... It's
     hard from the briefs to actually identify which briefs are calling on
     them... The motion graphics are also very bare, and mostly still, with
     some even having overlapping text").

    Two unrelated faults, both of them silence rather than breakage.

    _The references._ The cast and sets systems are wired end to end and
    were almost never invoked, because the whole chain hangs on two
    OPTIONAL fields the shot-list model has to volunteer — a still's
    `depicts` and its `set`. `generateStillCandidates` reads
    `listCastMembers` only when `depicts` is non-empty and
    `listProjectSets` only when `set` is set, so a brief that names
    neither never opens the tables at all, and the photographs the
    producer uploaded condition nothing. Nothing inferred the reference
    from the prompt text, nothing warned, and the board rendered neither
    field: `depicts` appeared only inside the policy-refusal block and
    `set` appeared nowhere, so a shot about to buy a likeness looked
    exactly like one about to buy a stranger. Every existing note pointed
    the other way — `planWarnings` warns when a set is named too OFTEN,
    `castWarnings` when the book forgot a person. Now `referenceWarnings`
    covers the silent direction, and every slot card carries a chip per
    call with whether anything backs it, resolved by the generator's own
    rule so the card cannot promise a photograph the run will not send.
    Deliberately NOT done: filling `depicts` or `set` in by inference. The
    producer keeps the call; the screen just stops hiding it.

    _The graphics._ Three causes, compounding. `GraphicCard` was the only
    card never handed `durationInFrames` — `ChartReveal` and `AnimatedMap`
    both take it, and `HeadlineCard` carries a drift with the comment "so
    the card is never a dead still" — so its whole animation budget was a
    600 ms entrance and then five frozen seconds. `enter` is optional and
    defaults to `{ fade, atMs: 0 }`, so the ordinary planner output gave
    every element the same offset and six things faded up in unison, which
    is one cross-fade. And `reflowPortrait` runs only when the frame is
    taller than it is wide, so on 16:9 the planner's cells were used
    exactly as written and two elements on the same rows drew over each
    other, with no scene rule and no test able to see it. Fixed as
    `graphicDrift` across the slot, `staggeredEnterMs` when nothing in the
    scene asks for a time (any explicit offset and every offset is left
    alone), and `separateOverlaps` sliding a collision down to the first
    clear row, keeping column and reading order, shapes exempt both ways
    because a panel behind a figure is drawn to be overlapped.

    _The fourth preview-versus-render divergence._ Text wrapped in the
    render and could not wrap in the board, because the card lays out HTML
    divs and the preview draws SVG `<text>`. `fitFontPx` fits by width and
    stops at a legibility floor, so a long string wrapped to three lines
    and spilled over its neighbour in the video while the board showed one
    clean line. Both now clip to the cell. This is the third time this
    feature has let the approved picture and the shipped one disagree, and
    the third time no test caught it: the goldens only prove the render
    did not move, and nothing compares the two renderers to each other.

    _Open._ The bible asks every still prompt for "an environmental
    pressure (rain on the window, a flickering tube)" while the set rule
    says "Do not describe the room itself; the photographs are the room".
    For a shot that names a set those pull opposite ways. Left as-is: it
    is a prompt change with a spend attached to validating it, and the
    owner chose the visibility route first.

    _Tests._ Schemas: `referenceWarnings` at zero usage, at partial usage,
    against a role-suffixed `depicts` entry (decision 262's join), and
    silent both when nothing is held and when there are no picture briefs.
    Compositions: `separateOverlaps` as a no-op on a clear scene, sliding
    a collision, ignoring elements in other columns, never moving a shape
    nor letting one push anything, and keeping the planned cell when the
    grid has no room; `staggeredEnterMs` spreading and deferring;
    `graphicDrift` monotonic and a no-op on a one-frame slot. Web: the
    chip row naming a resolved and an unresolved reference with its title,
    and absent for a brief that names nothing. Goldens pass unchanged and
    were not regenerated — the fixture times its own entrances and passes
    no duration, so neither new behaviour moves it.

270. **An undocumented model gets the app's policy, never a zero**
(2026-09-23, owner question: "Why is gemini 2.5 declaring objects as 0?
... why cant gemini 2.5 and 3.1 have the same declarations? The only
different should be the model not what we give it").

    Decision 264 gave each image model two reference pools, characters and
    objects, from Google's published table. Google publishes one for the
    Gemini 3 models and none for `gemini-2.5-flash-image`, and the missing
    row was written as `{ characters: 3, objects: 0 }` to preserve the
    budget from before set plates existed.

    That zero was wrong on every count. It was not a capability: the API
    takes one flat list of `inlineData` parts, and "character" and "object"
    are this app's own bookkeeping, so there is no object channel a model
    could decline. It therefore refused nothing and disabled a feature
    instead, and silently — `referenceBudgets` clamped the pool to nothing,
    `referencePlates` returned none, `setName` resolved to null, and a still
    routed at 2.5 was generated with no plate AND a prompt that never named
    the room. Every project on 2.5 had inert sets and no way to see it. And
    the stated reason, that guessing a limit upward spends money to discover
    it, was false: `pricePerImage` bills the image GENERATED, so what a call
    carries in does not change what it costs.

    The adapter beside it had already answered the same question correctly.
    fal publishes no per-model figures either, and `falImageGen.
    referenceLimits` returns the app's own caps unconditionally. So two
    adapters facing one question — what to allow when the provider documents
    nothing — answered it as policy in one file and as zero in the other,
    with nothing to justify the difference.

    Now both answer policy. `UNDOCUMENTED_LIMITS` is one constant serving the
    2.5 row and the lookup's fallback, so a future undocumented model cannot
    lose its plates the way this one did, and a test holds it equal to fal's
    answer. The Gemini 3 rows keep Google's real figures: those models do
    differ, and 4/10 against 5/6 is a difference worth respecting. What is
    not respected any more is silence read as a refusal.

    _Not done._ Nothing verifies 2.5 against five inline images in anger;
    Google documents no ceiling, so the app's own 3 and 2 is the only number
    with reasoning behind it, and the failure mode if it is too generous is
    a weaker composition rather than an error or a charge.

    _Tests._ 2.5 reports the policy budget, equals fal's answer, carries two
    plates through a real call, and refuses a third by name.

271. **Contextual briefs: people and place first, and a lint that acts**
(2026-09-23, owner report: "the prompt is trying to be too symbolic, or is
actually showing some irrelevant to the narration ... It recognises that
there are all these issues, but does nothing about it").

    Measured on the live Stability AI plan (read-only): 55 of 62 picture
    briefs mention a server, rack or blade, and 21 describe an empty,
    unpeopled scene; only 7 of 53 stills name a person, against 26 of 53 that
    name a set. Six causes, all upstream of the lint. The Director's Book
    converges on one symbol: the same server sits in the visual thesis, the
    anchor object, a motif, and three of seven key images. The era lock is
    pasted verbatim into every still prompt, so all 53 prompts ask for
    period servers whatever their subject. The house look defaults to empty
    rooms and "never the face", working against the cast photographs the
    producer uploaded. An abstract sentence goes straight to a book symbol,
    with nothing telling the model to stage it through the people and place
    it concerns instead. A motif floor forces at least one motif into every
    chapter. And the lint itself is advisory and overcounts: `motifPattern`
    matches a motif's head noun inside the pasted era-lock text as readily as
    inside the sentence, so "10 of 10 picture briefs" meant every still
    rather than a real repeat, and a number that wrong cannot drive a repair.

    _The prompt changes._ Three prompts move together. The bible
    (`direction-craft.md`, re-embedded through `embed:craft`) replaces "Rooms
    after the people have left" and "never the face" with staging the
    people, in the rooms where it happened, lit by the scene's own sources;
    replaces the abstraction fallback with staging a sentence's people and
    place first, reaching for the book only when a sentence names neither;
    drops the motif floor, letting a motif stand only where the sentence has
    room for it; and stops copying the era lock's object list into a prompt,
    keeping it a constraint on what a frame may contain rather than a list to
    paste. The Director's Book prompt (`prompts/direction.ts`) keeps the
    anchor object out of the motif list, forces the three motifs to share no
    head noun with each other or the anchor, and has each chapter's key image
    lead with that chapter's own people and place. The shot-list prompt
    (`prompts/shotlist.ts`) carries the same rules into planning: a sentence
    naming a photographed cast member, or a held set's place, is shown there.

    _The graded findings._ `craftFindings`
    (`packages/schemas/src/direction.ts`) is a pure function returning one
    finding per problem per slot - `size-run`, `motif-repeat`, `set-run`,
    `ignored-person`, `ignored-set` - each graded `auto` or `manual`. The
    grade follows what the fix would cost. A photographed cast member named
    in a still or hero's sentence but left off `depicts` is `auto`: the fix
    only adds a name to a list the photograph already backs. An
    unphotographed member named the same way is `manual`, because the fix
    would draw a real face from a text description alone, which tends to
    read as a stranger and draws model refusals (decision 253). Anyone named
    against a stock brief is `manual` too, because the fix turns a free slot
    into a paid, generated still - a spending decision, not a lint's to make
    alone. `ignored-set` follows the same split: an unheld or wrongly-set
    still or hero is `auto`, the same miss on a stock brief is `manual`.
    `planWarnings` keeps its own strings and signature and shares its
    predicates with `craftFindings` (`motifPattern`, an era-lock-aware
    `motifText`, `slotSet`, `setKeyNoun`, `containsPhrase`) rather than being
    rewritten over it, so the plan screen and the repair pass cannot disagree
    about what is wrong.

    _Banned words are removed, not reported._ `stripBannedWords` strips a
    banned word or phrase from a still or hero prompt as a whole word,
    ignoring case, then tidies the punctuation and spacing the removal
    leaves behind. It runs at three points: inside `planChapterSlots`, over
    every planned slot's brief, which covers the plan and the re-plan alike;
    on every accepted repair reply, automatic and Fix-button both; and in
    `generateStillCandidates`, the last line before the image model, so a
    brief stored or hand-edited before this change is still cleaned at the
    point it would do harm. A `banned-word` finding can therefore only
    describe a brief stored before this change and never fetched since, and
    it stays a `planWarnings` note rather than something a repair spends on.

    _Automatic repair and the Fix button._ After each chapter is planned,
    `planChapterSlots` computes `craftFindings` over that chapter alone and,
    if any finding is `auto`, makes one further repair call naming each
    flagged slot and its findings, answered as `{"briefs": [...]}` rather
    than slots so a reply can only ever replace a brief. `coversText`,
    `paragraphIndex` and `seconds` are forced back to the original's
    regardless of what the model returns; a replacement whose brief type
    differs from the original's is dropped; and any repair failure keeps the
    unrepaired, still-valid plan. That type guard is what makes the
    automatic pass safe to run unasked: a stock slot can never come back a
    still without the producer's consent. The plan screen's "Fix these N
    slots · ≈$X" button is that consent: it computes findings over the whole
    film, the same as the board shows, and repairs chapter by chapter on
    both `auto` and `manual` findings, so it may turn a stock slot into a
    still - and it says how many before it is pressed, since that also
    raises the Fetch estimate. Mock mode makes no repair call in either
    path: `callLlm` has no mock shot-list path, and the mock plan (one stock
    slot per paragraph, alternating sizes, no motif) produces no `auto`
    finding to act on.

    _The seven Rulings this plan's header recorded, refining the spec:_
    `repair` is `'auto' | 'manual'` only, and no `'none'` finding is ever
    emitted, since `planWarnings` already carries those notes. `planWarnings`
    keeps its own strings and predicates rather than being rewritten over
    `craftFindings`. A repair answers with briefs, never slots, and
    `coversText` is forced back to the original's. Banned words are stripped
    by `withoutBannedWords` inside `planChapterSlots`, on every repair
    output, and in `generateStillCandidates` - not inside `plannedToRows`,
    which the Fix button's path does not pass through. A set run is not a
    finding when the slot's own sentence puts it in that set, in both
    `craftFindings` and `planWarnings`, so the two rules cannot ping-pong
    against each other. The Fix button computes findings over the whole film
    and repairs chapter by chapter, while the automatic pass computes per
    chapter because a chapter is all it ever has in hand. And mock mode
    makes no repair call in either path. One rule sits outside the numbered
    seven but binds both paths the same way: automatic repair never changes
    a slot's type; only the Fix button may turn stock into a still.

    _Not done._ No deterministic lint runs on the Director's Book itself;
    the three prompt changes are the only guard against convergence on one
    symbol, and a book-level check is left for a later decision if the
    prompt alone does not hold it. Existing films are not touched
    automatically: the Stability AI film changes only after the owner
    presses Redraft direction, then Re-plan.

    _After the whole-branch review._ The shot-list prompt's step-by-step
    still template still asked for "the book's era lock and palette", which
    undid cause #2 in the one instruction the model follows line by line; it
    now asks for the palette line and says the era lock only limits which
    period objects are named, never to be pasted. Stock-to-still is now
    permitted per slot rather than per call: `parseShotRepair` retypes a stock
    slot only when its target is cleared by `mayBecomeStill` (a stock slot
    with an `ignored-person` or `ignored-set` finding), the same predicate
    behind the button's "N become stills", so the job cannot retype more
    slots than the button disclosed. Surnames match with case, a deliberate
    deviation from spec section 5's "ignoring case": Jobs, Lay, Gates, Cook
    and Page are ordinary words in a money documentary, and automatic repair
    acts only where the problem is unambiguous; a trailing Jr., Sr., II, III
    or IV is skipped to find the surname. A cast member the book shows other
    than by likeness is left out of the person rule by `findingContext`,
    because "archival-only" is the producer's legal call and a finding asking
    the repair to show that person argues against it. A reuse-linked slot
    carries no finding, since its picture is another slot's and a retype
    would break `linkedSlotRefusal`; it still counts toward runs, and a size
    run that reaches three on a linked slot keeps counting, so the next slot
    that can be repaired is the one flagged. A repair reply whose
    `coversText` does not match its slot's (beyond whitespace) is refused
    rather than forced back, so a model that skips a brief cannot shift every
    later answer onto the wrong slot. A still already in any of the rooms its
    sentence names passes the set rule, and a sentence naming several rooms
    raises one finding that names them all. The plan screen's
    three-adjacent-sizes note and the `size-run` finding now share one rule
    (`runSize`), so a chart breaks both. The Fix job's failure reads "The
    fix failed", and a Fix that rewrote nothing says why.

    _Still open_, parked for the owner: the repair shares the planning
    Inngest step, so time it on the first live Re-plan and split it out if a
    chapter nears the step limit; Fix stays pressable while its job runs and
    shares Re-plan's cancel key; mid-job races with plan approval and brief
    edits are unhandled; repair spend carries no ledger marker of its own;
    and there is no per-slot "leave as is".

    _Tests._ Package totals are as they stood at each task. Task 1: the bible stages people in place, drops the motif
    floor, and stays byte-identical to its markdown (495 of 495,
    packages/providers). Task 2: the Director's Book and shot-list prompts
    carry the new rules, every asserted phrase whole on one line (501 of
    501, packages/providers). Task 3: `stripBannedWords` against words,
    phrases, case and punctuation, wired into `generateStillCandidates` (14
    provider tests, 35 web tests). Task 4: `planWarnings` ignores a motif
    noun inside pasted era-lock text and drops a set-run finding when the
    sentence itself places the slot there (352 of 352, packages/schemas).
    Task 5: `craftFindings` grades every kind by the section 5 table,
    including the photographed, unphotographed and stock split, a chart
    breaking a run of photographs, and the generic-room-word fallback (374
    of 374, packages/schemas). Task 6: `buildShotRepairRequest` and
    `parseShotRepair` reuse the chapter's own system prompt and keep the
    original brief for a missing or malformed reply, ignoring extras (514 of
    514, packages/providers). Task 7: `planChapterSlots` makes no repair
    call for a clean chapter or one with only manual findings, and exactly
    one for a chapter with an auto finding (19 of 19, apps/web, DB-backed).
    Task 8: the visuals-replanner's `repair` op includes manual findings,
    may turn a stock slot into a still, and touches only flagged slots (7 of
    7 then, 8 of 8 after the review, apps/web, DB-backed). Task 9: the plan
    screen's warnings gain the ignored-person and ignored-set lines, and the
    Fix button appears only when something is flagged, names the chapter
    count and the still count, and calls `repairPlanAction` (52 of 52,
    apps/web). The final fix wave: each item test-first (packages/schemas 383
    of 383, packages/providers 517 of 517, and 114 of 114 across the web
    direction, replanner, visual-board and visual-assets files), then
    `pnpm test` at 9 of 9 tasks, apps/web 872 of 872.

272. **Generated plate candidates show and choose like a slot's**
(2026-09-24, owner report: "When using the generate plate button. The
candidates don't reveal and don't have the same preview, and select
functionality, like the shots").

    The Set card drew each candidate from `thumbUrl`, which only a mock
    generation carries. A live generation from `generateStillCandidates`
    keeps its bytes in R2 behind an asset row and has no `thumbUrl`, so every
    live candidate rendered as an empty square. The card's tests passed
    because every fixture had a `thumbUrl`. The board had always resolved the
    picture through `/api/assets/<id>/file`.

    The thumbnail and full-size helpers and the lightbox moved out of
    `visual-board.tsx` into `components/candidate-media.tsx`, and both
    screens now use them, so the two cannot drift again. The board's
    lightbox is a thin wrapper and renders what it did before. The Set card
    now shows the board's 168 by 104 strip, a Preview button that opens the
    same full-size lightbox with Previous and Next, and "Add as a plate"
    inside it. Adding one no longer clears the rest, since a set carries up
    to four plates; an added candidate is marked "Added" (recognised by its
    storage key, which ends in the plate's content hash, or by this
    session's choice for a mock). The candidates are held by the card, not
    the row, so Hide sets no longer throws away generations that were paid
    for, and "Clear candidates" dismisses them.

    Still open: candidates live in the browser only. A page reload loses
    them, although their stills and asset rows stay in R2 and the DB.
    Keeping them across reloads would need a column on `project_sets`.

    Verified: `set-card.test.tsx` gains five tests (a live candidate with no
    `thumbUrl` shows through its asset, Preview and add, the rest survive an
    add, a held plate is recognised, Hide keeps them and Clear removes
    them); `pnpm test` 9 of 9 tasks, apps/web 877 of 877.

273. **References say what they are for: new camera positions, people in the room, faces on extras**
(2026-09-24, owner report with three boardroom stills: "the scene is being
used consistently which is good. But how the characters are integrated into
the scene now is terrible, and clearly fake, because Emad is coming through
the middle of the table ... The sets are also fixed to the same perspective
as the reference"; and, asked what "refrain from generating ... blurred
faces" meant: "for human extras and anonymous characters, we shouldn't blur
their faces (e.g., Investors, Employees, etc.)").

    Cause: the sentence decision 269 closed every referenced prompt with.
    "The photographs are authoritative for the likeness of X and the room;
    match them exactly. The text above describes only what happens in them"
    reads as an edit instruction: keep the plate, put the person in it. So
    every still of a set kept the plate's framing, and the person was pasted
    onto it at the wrong scale. Three things made it worse. The shot-list
    rule forbade describing the room, so no brief ever named a camera
    position. The images reached Gemini as one unlabelled list. And a set
    usually had one plate, so there was one viewpoint to copy.

    What changed:
    - `withReferenceClause` gives each kind of photograph one job. A
      person's are "for likeness only: match the face exactly, while
      clothing, pose and expression follow the text above", and the person
      "is photographed in the scene, never pasted onto it: at true scale,
      seated in a chair or standing on the floor, lit by the scene's own
      light, and behind anything standing nearer the camera". A room's are
      "for the room's design only", and "This is a new photograph taken
      inside that room from the camera position the text above describes;
      never reproduce or edit the framing of its photographs."
    - The Gemini adapter puts a label before each image (`referenceLabel`):
      likeness only for a person, the place's design and never its framing
      for a plate.
    - The shot-list prompt and the House Visual Bible ask every still of a
      set for its own camera position (head of the table, low across it from
      the window side, through the glass from the corridor, over a
      shoulder), and two stills of one room never share one. Walls,
      furniture and materials stay with the photographs. People are staged
      physically in the scene.
    - Extras and anonymous figures get natural, realistic faces, visible
      and in focus, resembling no real or public person; never blurred,
      hidden or turned away as a device. This reverses the "face turned
      away or in shadow" rule.
    - A set with a plate can generate another angle (reverse, side, detail,
      or establishing again), conditioned on the plates it holds through
      `setPlateBrief`, and the chosen plate records the matching view
      (`plateAngleView`). The first plate is still generated from the look
      alone, now as an empty establishing view with "people, figures" as the
      negative prompt. Another angle is priced as the referenced still it
      is, per set, on the page.

    Untouched: stock scoring still rejects identifiable faces, a licensing
    rule about real strangers, not a look. Plans already drafted keep their
    old briefs until re-planned; the reference sentence and the labels apply
    to every generation from now on.

    Verified: the new wording, labels, staging and face rules, angle
    generation and view recording are each pinned by tests (providers 523,
    schemas 384, the set actions and visual-assets DB suites 57, the Set
    card 18); `pnpm test` 9 of 9 tasks, apps/web 884 of 884.

274. **A plate's view is its angle, and the two that travel are two viewpoints**
(2026-09-24, owner question on the upload's view picker: "the dropdown of
Establishing, Detail, and Other is not serving any purpose then?").

    It served almost none. A set plate's view never reached a prompt or the
    image model. It did two things: captioned the thumbnail, and, because
    `referencePlates` sent establishing plates first, decided which two of
    up to four plates travel with a still. Detail and Other were treated
    identically. With decision 273's angles that rule chose badly: an
    establishing view, a detail and a reverse sent the detail whenever it
    was uploaded first, where two viewpoints teach the model the room.

    What changed:
    - `SET_PLATE_VIEWS` is now the angles plus `other`: establishing,
      reverse, side, detail, other. A generated plate records the angle it
      came from under its own name, so `plateAngleView` is gone. Stored
      plates stay valid; no migration.
    - The upload's view picker is removed. An upload or an address with no
      view is recorded by `uploadedPlateView`: establishing for a set's
      first plate, other after it. The actions still accept an explicit view.
    - `referencePlates` ranks establishing, reverse, side, other, detail,
      sends the best plate of each distinct view first, and only then a
      second plate of a view already sent. Upload order breaks ties.
    - The angle picker is shown from the start, greyed out before a set has
      a plate, with "Add a plate first, then generate other angles from it."
      as its description.

    Verified: `referencePlates` and `uploadedPlateView` in packages/schemas
    (387 of 387); the actions record an upload and an address with no view
    as establishing then other; the card asks no view, captions a reverse
    plate by name, records a chosen reverse candidate as `reverse`, and
    shows the angles disabled with the hint before the first plate (set
    card, set actions and visual-assets files 79 of 79); `pnpm test` 9 of 9
    tasks, apps/web 888 of 888.

275. **Set building from one image, and shots from any camera**
(2026-09-24, owner report: "When choosing the different angles, more or
less the same image is being generated. The angles, perspective are not
changing. Furthermore, the depictions don't seem realistic. What I want to
be able to do is upload an image or generate an image. Then from that
image, we generate different perspectives of the first image to build the
set ... even the Shot itself should be able to change the angle, the
camera angles, and perspectives ... the references angles should just
help the image generator build a more accurate and consistent scene ...
the desk, the chair, the laptop should remain consistent").

    Research found four causes. Editing models keep the input's framing:
    they learn from before-and-after pairs that share geometry, and favour
    preserving the image over a camera instruction; SpatialEdit and
    CameraEditor both measure Nano Banana, GPT-Image-1, Seedream 4.0 and
    similar editors as conservative about viewpoint. A reverse shot needs
    the wall behind the original camera, information one plate never
    holds. The owner's stills ran on gemini-2.5-flash-image, which Google
    lists as Legacy and which does no reasoning, while the Gemini 3 image
    models reason before drawing. And the reference sentence from decision
    269 reads as an edit instruction ("never reproduce or edit the
    framing"), so a still copied the plate it was given rather than taking
    its own camera position; the pass toward realism therefore lands on a
    rendered look wherever a still leans on a reference.

    What changed, task by task:
    - Task 1: plates face a compass direction (north, east, south, west,
      detail, other) instead of an angle name, and StillBriefSchema gains
      an optional camera (facing, position, lens).
    - Task 2: a set's room inventory is written as layout text, one line
      per wall, and layoutView/parseLayout turn it into the in-frame,
      edge, centre and behind lines a camera sentence needs.
    - Task 3: the inventory is drafted once from the first plate and never
      overwritten by a later one; Redraft asks again on demand.
    - Task 4: the Gemini adapter takes a size and high reasoning per call,
      priced per size (3.1 Flash, 3 Pro, 2.5 Flash), with direction labels
      on referenced images.
    - Task 5: set sheets get their own model route (`modelRouting.setSheet`),
      Gemini 3 Pro Image by default, shown on the Models tab.
    - Task 6: `splitContactSheet` finds the sheet's gutters by luminance and
      cuts four panels, or refuses with null when it cannot find clean
      borders, rather than guessing.
    - Task 7: Build the set turns one contact sheet into four candidate
      views with directions attached; a sheet that will not split returns
      one candidate, never the whole grid (the plan's amendment to spec
      5.3: an unsplittable sheet is a refusal, not something offered as a
      plate, since a 2x2 grid chosen as a plate would teach every later
      still of the room to draw a grid).
    - Task 8: `HOUSE_PHOTOGRAPH`, the documentary-photograph line, lands on
      every plate, sheet and still prompt; `BANNED_PROMPT_WORDS` gains
      ultra-detailed, 8k, 4k, 3d render, cgi, octane, unreal engine,
      hyperrealistic and photorealistic, while the plan keeps plain render
      and rendered allowed as ordinary verbs (the amendment to spec 7.2).
    - Task 9: the shot-list planner places a camera on every still that
      names a set, reading the room inventory from the cacheable prefix.
      Ruling R1 resolved a conflicting test: the system prompt's
      `slotShapes` text keeps `camera` optional (`"camera"?: ...`),
      matching the `"set"?:` convention beside it, so the test was
      mistyped and not the spec. Ruling R2 kept the bible's existing line
      ("A room on every slot is a motif on every slot...") directly after
      the rewritten set bullet, since the task's replacement text covered
      only the bullet.
    - Task 10: `platesForCamera` sends the plates nearest a shot's camera
      (the same direction, then an adjacent one, never the opposite wall)
      and `withReferenceClause` writes what the camera sees. This is where
      Ruling R3 landed: spec 7.1 says a camera's lens replaces the house
      line's 35mm, which no earlier task implemented; Task 10 built it
      inline in the still-prompt path.
    - Task 11: a linked slot's camera, and an unlinked slot sharing a
      camera with another, are both covered by the plan check.
    - Task 12: the board gets a Camera row (four direction buttons,
      Position, Lens, Save camera) on a set shot's card; a same-task fix
      resyncs the row when the stored camera changes underneath it (a
      re-plan), so Save can no longer overwrite the planner's camera with
      a stale row.
    - Task 13: the live set harness (`pnpm --filter @boom-busters/web
      live:set`), added to the plan at the owner's request ("I want you to
      be able to do single set tests, with permission to use costs to test
      a set ... just ensure that spend doesn't exceed $1 per test. Then it
      must ask for my approval"), runs inventory, the 4K contact sheet, the
      split and one still against real Gemini, and writes every image,
      prompt and cost to a run folder. Review found the harness's own
      `--cap` flag unvalidated (NaN or Infinity would disable the budget)
      and its shot prompt skipping the R3 lens swap; the fix makes
      `LiveBudget` refuse a non-finite, non-positive or above-$1 cap ("A
      cap above $1 needs the owner's approval first."), and extracts the
      R3 swap into `withCameraLens` in `apps/web/lib/still-prompt.ts`,
      shared by `generateStillCandidates` and the harness, so the
      harness's prompt can never drift from the app's.
    - Task 14 (this entry): full verification and this record.

    Two regressions surfaced between tasks, each fixed by the task that
    hit it rather than by returning to the task that caused it: Task 1
    never ran the db package, so its compass-direction change left the
    four-plate integration test asserting the old cap; Task 2's fix made
    it track `MAX_SET_PLATES`. Task 10 gave `setPlateBrief`'s compass views
    a camera, correctly replacing the "never reproduce or edit the
    framing" sentence with the camera one, but Task 10 never ran
    set-actions.test; Task 13's fix updated the stale assertion to check
    for the camera sentence and the absence of the framing line.

    The owner's $1 cap is enforced by `LiveBudget`: every call's estimate
    is reserved before it is made, and a call that would take the run past
    the cap is refused before it spends. A typical harness run costs about
    $0.32.

    Unverified, left for the owner's live run: how much reasoning on high
    helps camera placement, and how cleanly Gemini 3 Pro draws uniform
    gutters at 4K (the splitter refuses rather than guesses, so the cost
    of a miss is one redo).

    What the owner does next: switch Settings → Models → Stills to Gemini
    3.1 Flash Image; put a Google AI Studio key in .env.local as
    GEMINI_API_KEY for the live harness; run the harness on the boardroom
    at most $1 per run, review the images, and improve the prompts from
    what comes back. After merge, Build the set on the boardroom costs
    about $0.24, and regenerating a still about $0.13.

    Verified: `pnpm format:check`, `pnpm lint` and `pnpm typecheck` clean
    across all 10 packages; `pnpm test` 9 of 9 tasks, 2,531 tests passed
    (infra 52, db 268, timeline 119, cost 28, compositions 144, web 954,
    providers 536, schemas 400, ui-tokens 30).
