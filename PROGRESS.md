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

**Status:** `[~]` code complete, suites green — branch `m2-orchestration`.
The one item still open is the "on production infra" proof, which needs the
Inngest keys listed under _Blocked on the human_.

### Verified

- **Locally against Neon:** `pnpm test` — 241 tests across 5 workspaces
  (schemas 74 · db 62 · cost 29 · ui-tokens 21 · web 55).
- **`pnpm e2e`** — 33 Playwright tests, mock-provider mode, including the
  project screens, the gate action bar, the Costs screen and a 390px pass.
- **`pnpm build`** — production bundle with `/api/inngest` registered.

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
- [ ] **Verified on production infra** — the demo pipeline driven end to end
      against Inngest Cloud from the Vercel deployment. Needs the two Inngest
      keys below; everything else is green locally and in CI.

### Blocked on the human

- [ ] **`INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`** — needed only to run on
      Inngest Cloud. Local development and CI use the Inngest Dev Server
      (`npx inngest-cli@latest dev`), which needs no keys, so this blocks
      nothing except the "on production infra" verification above.
- [ ] **`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`** — generated locally, no
      account needed:
      `pnpm --filter @boom-busters/web exec web-push generate-vapid-keys`.
      Without them the app logs what it would have sent and carries on.
      `RESEND_API_KEY` + `NOTIFY_FROM_EMAIL` are optional on top.

---

## M3 — Writing room

> Case Library (+ suggestions), dossier-runner + review UI, script-runner +
> Script Studio (editor, warnings, diff regenerate, edit trail), model router
> with fallback.

**Status:** `[ ]` not started

---

## M4 — Voice

> TTS adapters (Gemini batch, ElevenLabs), voice-runner, review UI with
> retakes, phoneme hints, idempotent takes, voice-audition panel in Settings.

**Status:** `[ ]` not started

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
