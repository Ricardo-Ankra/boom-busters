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
- [ ] **M6.8 Preview & render screen** — full-width `@remotion/player` of
      the compiled timeline, chapter markers, caption toggle, duck
      visualisation, music picker (recompile is free), `Render master` with
      est. cost + inline two-step; render-runner (`gate/preview.approved` →
      broker invoke → webhook wait → QC → `project/master.ready`), stop
      semantics with the §8.1 honest caveat, 2 s progress polling.
- [ ] Tests land with every part; CI green on every commit; E2E drives
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

**Status:** `[~]` in progress — branch `m6-assembly` started 2026-08-18;
M6.1–M6.7 done (timeline contract; snap/ducking/compiler with goldens;
word timings at synthesis; music library live in Settings; Remotion
component library with bundled world geometry, fonts, Studio fixtures
and renderStill snapshots; broker + media-utils CDK stacks, tested
offline — DEPLOY still pending: needs AWS credentials for the
Reelscript account, per infra/README.md; assembly-runner compiling
stored timelines and parking at Gate 5a, with the broker hook route
live)

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
