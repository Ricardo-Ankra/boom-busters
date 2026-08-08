# Boom-Busters — Claude Code Project Instructions

You are building **Boom-Busters**, a single-user production console for the
Boom & Busters YouTube channel. The authoritative build specification is
`docs/03-build-spec.md` — read it fully before writing any code. Where that
spec and convenience conflict, the spec wins.

## Documents

- `docs/03-build-spec.md` — THE executable spec: stack, repo layout, data
  model, orchestration, error handling, UI, tests, milestones. Your contract.
- `docs/02-app-spec-and-dev-plan.md` — product context and architecture
  rationale. Read once for the "why"; the build spec overrides it on detail.
- `docs/01-channel-roadmap.md` — channel strategy. Background only; never a
  source of engineering requirements.

## Working rules

1. **Work milestone by milestone** (spec §14, M1→M8). Do not start a
   milestone until the previous one's tests are green. Never reorder.
2. **Track progress in `PROGRESS.md`**: one section per milestone with a
   checklist of its deliverables, updated as you go, plus a short "decisions
   made" note whenever the spec left something open and you chose an
   implementation. Read `PROGRESS.md` at the start of every session to
   re-orient before touching code.
3. **Tests are part of every task**, not a later milestone: unit tests land
   with the code they test (spec §13). CI must stay green on every commit.
4. **Naming**: kebab-case `boom-busters` everywhere per spec §3. "Boom &
   Busters" (ampersand) only in public-facing channel copy.
5. **Never commit secrets.** Maintain `.env.example` with every variable
   from spec §4 and placeholder values. Validate env at boot with Zod.
6. **Ask before spending**: anything that would call a paid external API
   during development must be mocked by default (mock-provider mode per
   spec §13); real-provider runs only when explicitly requested.
7. **UI**: button-first per spec §11.1 — every action a visible labelled
   button; no keyboard-only actions; no command palette. Dark theme default.
8. **Git hygiene**: small commits, one logical change each; a branch per
   milestone (`m1-skeleton`, `m2-orchestration`, ...) merged when green.

## Commands (keep these working from M1 onward)

- `pnpm dev` — run the web app locally
- `pnpm test` — all unit + component tests
- `pnpm e2e` — Playwright suite (mock-provider mode)
- `pnpm db:migrate` / `pnpm db:seed` — migrations and fixture seed
- `pnpm typecheck` / `pnpm lint` — strict, zero-warning policy

## External accounts the human must provide (ask when needed, don't block early milestones)

Infrastructure (env vars): Neon/Supabase DB URL · Cloudflare R2 credentials ·
Inngest keys · `SECRETS_ENCRYPTION_KEY` · AWS credentials for the existing
Reelscript account (M6) · Google OAuth client for YouTube (M7) · Sentry DSN ·
Resend key (optional).

Provider API keys (Anthropic, OpenAI, Gemini, ElevenLabs, Pexels, Pixabay,
fal.ai) are entered in **Settings → Connections** and stored encrypted in the
DB; matching env vars are optional seeds for local dev only (spec §4).

M1-M5 can be built and tested end to end with only: DB, R2, Inngest, and
mock providers.
