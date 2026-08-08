# Boom-Busters — Build Progress

Milestones follow `docs/03-build-spec.md` §14 and must be executed in order.
A milestone is not started until the previous one's tests are green in CI.

**Legend:** `[ ]` not started · `[~]` in progress · `[x]` done (tests green)

---

## M1 — Skeleton

> Monorepo, env validation, auth (allowlist), DB schema + migrations + seed
> script, settings CRUD, app shell, first-run setup checklist, CI.

**Status:** `[~]` in progress · branch `m1-skeleton`

### Deliverables

- [ ] **Repo hygiene** — docs renamed to kebab-case, initial commit, `m1-skeleton` branch, pnpm activated via corepack
- [ ] **Monorepo scaffold** — pnpm workspace + Turborepo, `tsconfig.base.json` (`strict`), ESLint flat config (zero-warning), Prettier, `.gitignore`
- [ ] **`.env.example`** — every spec §4 variable with placeholder values, no real secrets
- [ ] **`packages/schemas`** — tiered env schema + `requireEnv`, `SettingsSchema` with defaults, ULID branded ids; zero `any`; unit tests
- [ ] **`packages/db`** — full spec §5 Drizzle schema, generated migration checked in, `db:migrate`, `db:seed` fixture case + project, settings query helpers, AES-GCM credential crypto; unit tests
- [ ] **`packages/ui-tokens`** — spec §11.1 app design tokens (zinc/indigo, 8px grid, radius 8, Geist + JetBrains Mono, motion tokens)
- [ ] **Auth** — Auth.js v5 Google provider, hard one-email allowlist (`OWNER_EMAIL`), `proxy.ts` protecting every route, `MOCK_PROVIDERS=1` credentials path for CI only; unit tests
- [ ] **App shell** — left rail (6 items), top bar (breadcrumb · active-runs · cost meter), Activity drawer, dark-default theming, route stubs
- [ ] **Settings CRUD** — single-row settings read/write through `SettingsSchema`, tabbed UI (Models · Budgets · Brand Kit · Publishing · Connections), optimistic updates
- [ ] **First-run setup checklist** — 5 deep-linking items with computed done-state, replaces the dashboard until complete
- [ ] **CI** — GitHub Actions: lint, typecheck, migrate, seed, unit, E2E; green on `m1-skeleton` before merge
- [ ] **E2E** — auth redirect, first-run checklist, settings round-trip, 390px mobile pass, button-only assertion

### Commands that must work when M1 closes

- [ ] `pnpm dev`
- [ ] `pnpm test`
- [ ] `pnpm e2e`
- [ ] `pnpm db:migrate`
- [ ] `pnpm db:seed`
- [ ] `pnpm typecheck`
- [ ] `pnpm lint`

### Blocked on the human

- [ ] `DATABASE_URL` (Neon/Supabase) — needed to apply migrations and run the seed
- [ ] `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — redirect URI `http://localhost:3000/api/auth/callback/google`
- [ ] Confirm `OWNER_EMAIL` for the allowlist

---

## M2 — Orchestration spine

> Inngest wiring, run mirror + activity drawer, cost guard + Costs screen,
> notification plumbing, demo no-op pipeline with two fake gates proving
> park/resume/cancel on production infra.

**Status:** `[ ]` not started

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
