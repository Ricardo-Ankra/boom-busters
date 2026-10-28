# Multiple Channels, Stage A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One console runs several YouTube channels: a `channels` table owns each channel's settings, bible, YouTube connection, logos, cases, projects and everything under them; list screens live under `/c/<slug>/`; the existing channel carries on unchanged as the first channel.

**Architecture:** Three layers, in order. The schema and database layer first (channel, workspace and YouTube-connection tables, a migration that converts the one settings row, channel-scoped queries, and transitional first-channel wrappers for the old names so every task compiles). Then the request layer: a `/c/[slug]` route tree and a project layout that both resolve the channel from data or the URL and pass `channelId` explicitly into every query, action and runner step. Last, the settings split: prices and the budget move to one workspace row, the old `getSettings`/`updateSettings` are deleted so the typechecker finds every caller, and the Settings screen gains a Channel tab, a workspace page, and a New channel form. Stage B (prompts read the bible, Draft with AI, categories as data, identity in the render) is a separate plan after this branch merges.

**Tech Stack:** TypeScript, Next.js 16 App Router (typedRoutes, `proxy.ts`), server actions, Inngest with `@inngest/test`, Drizzle on Postgres (drizzle-kit migrations), Zod v4, Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-27-multi-channel-design.md`

## Global Constraints

- The channel of a run or an action is derived from its project row or the URL segment, never from a cookie. Runners resolve it inside the step that needs it, never from an earlier step's memoised output.
- `FIRST_CHANNEL_ID = '01BB0000000000000000000001'`, slug `boom-busters`, name `Boom & Busters`, handle `@BoomAndBusters`. It is the only channel ever created implicitly; a missing channel id anywhere else is an error.
- `getSettings(db)` and `updateSettings(db, patch)` are deleted by the end of this plan, not aliased. Until Task 8 they are transitional wrappers over the first channel plus the workspace row.
- Workspace: provider API keys, model catalogue, `modelPrices`, `budgets`, voice auditions, music library, web caches. Channel: everything else in `SettingsSchema`, the bible, the YouTube connection, logos, cases, projects and their trees.
- The budget guard, the budget gate and the top-bar meter keep today's behaviour: one lock, one monthly total, one workspace ceiling.
- No existing row, key or ledger entry is changed by the migration beyond gaining a channel reference. The project page keeps its `/projects/[id]` address.
- No prompt the first channel sends changes in this plan (prompts do not read the bible until stage B).
- Mock-provider mode is the default for every test and e2e run; no paid call in development. `MOCK_PROVIDERS=1` keeps bypassing YouTube.
- `'use server'` modules export only async functions.
- Button-first UI: every action a labelled button, 40 px hit targets, no keyboard-only action. New UI copy: no em or en dashes, South African spelling.
- Run `pnpm format:check` (tracked files only) before every commit; lint and typecheck are zero-warning.
- Database suites run one at a time, Bash `timeout` 600000; scope a vitest run with `pnpm exec vitest run <basename>` from the package directory. e2e runs from the `e2e` directory with `pnpm exec playwright test <file>`; free port 3100 after an interrupted run.
- A new Settings tab adds its action mocks to `voice-tab.test.tsx` (it renders the whole form).
- Branch `multi-channel` off `master`. Decisions go in PROGRESS.md from the next free number on `origin/master` at merge (322 is the last today; this plan assumes 323 to 326).
- After the production deploy: `PUT /api/inngest`. No CDK or Remotion deploy in this plan. Before the production migrate: a Neon branch rehearsal (Task 12).

## Review Focus

1. A project link for channel B's project opened while the last-channel cookie names A renders in B's shell with B's cost figures, never A's (Task 4 layout test; Task 11 e2e).
2. A run parked at a gate before the deploy whose `load-*` step output has no `channelId` resumes and resolves the channel inside the later step (Task 6 harness test).
3. A YouTube callback carrying a state signed for channel B but a missing, stale or replayed nonce writes nothing and lands on a `state-mismatch` outcome (Task 7 route test).
4. Creating a channel with a slug that is taken, reserved (`settings`, `projects`, `cases`, `calendar`, `costs`, `new`), upper-case or ending in a dash is refused with a message, and nothing is inserted (Task 11 action test).
5. An archived channel is skipped by the analytics cron, hidden from the switcher, refused by `createChannel` slug reuse, and still opens read-only (Tasks 7 and 11).

---

### Task 1: Channel schemas and the workspace settings schema

**Files:**
- Create: `packages/schemas/src/channels.ts`
- Create: `packages/schemas/src/channels.test.ts`
- Modify: `packages/schemas/src/settings.ts` (after `BudgetsSchema`, line 490 area)
- Modify: `packages/schemas/src/settings.test.ts`
- Modify: `packages/schemas/src/index.ts` (add `export * from './channels'`)

**Interfaces:**
- Produces, in `channels.ts`:
  - `export const CHANNEL_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/`
  - `export const RESERVED_SLUGS = ['settings', 'projects', 'cases', 'calendar', 'costs', 'new', 'c', 'api'] as const`
  - `export const ChannelSlugSchema` (string matching the pattern, not in `RESERVED_SLUGS`)
  - `export function slugFromName(name: string): string` (lower-case, non `[a-z0-9]` runs to one dash, trimmed of dashes, at most 40 chars)
  - `export const ChannelBibleSchema = z.object({ subject, whatACaseIs, subjectKind, audience, narrationRegister, visualRegister, titleStyle, ctaLine: z.string().default(''), caseCategories: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_-]{0,23}$/), label: z.string().min(1).max(40) })).default([]), scriptRulesMd: z.string().default(''), directionRulesMd: z.string().default('') })`, every string field `.default('')`, `.max(2000)` on the sentence fields and `.max(20000)` on the two `*RulesMd` fields
  - `export type ChannelBible = z.infer<typeof ChannelBibleSchema>`
  - `export const EMPTY_BIBLE: ChannelBible = ChannelBibleSchema.parse({})`
  - `export function isBibleComplete(bible: ChannelBible): boolean` (every field except `ctaLine`, `scriptRulesMd`, `directionRulesMd` non-blank after trim, and at least two categories)
  - `export const FIRST_CHANNEL_ID = '01BB0000000000000000000001'`, `FIRST_CHANNEL_SLUG = 'boom-busters'`, `FIRST_CHANNEL_NAME = 'Boom & Busters'`, `FIRST_CHANNEL_HANDLE = '@BoomAndBusters'`
  - `export const FIRST_CHANNEL_BIBLE: ChannelBible` with the spec's section 4.8 table values: `subject` "corporate collapses, frauds, meltdowns and turnarounds"; `whatACaseIs` the two sentences at `packages/providers/src/prompts/cases.ts:46-49` ("A good case has: ..." through "...what someone was thinking."); `subjectKind` "the company's common name as Wikipedia titles it"; `audience` "adults who watch long-form money documentaries"; `narrationRegister` "plain, specific, unhurried"; `visualRegister` the Register bullet at `packages/providers/src/prompts/direction-craft.md:11-15` from "the Netflix money documentary." to "not the film."; `titleStyle` "Sober, specific, curiosity-driven"; `ctaLine` "The full story is on the channel"; `caseCategories` the five keys `collapse`, `con`, `meltdown`, `turnaround`, `empire` with labels `Collapse`, `Con`, `Meltdown`, `Turnaround`, `Empire`; both `*RulesMd` empty
  - `export const CreateChannelInputSchema = z.object({ name: z.string().trim().min(1).max(80), handle: z.string().trim().max(40).nullable(), slug: ChannelSlugSchema, startFrom: z.union([z.literal('defaults'), z.object({ copyFromChannelId: UlidSchema })]) })`
  - `export type CreateChannelInput`
- Produces, in `settings.ts`: `export const WorkspaceSettingsSchema = z.object({ modelPrices: ModelPricesSchema.default({ llm: {}, image: {} }), budgets: BudgetsSchema })`, `export type WorkspaceSettings`, `export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { modelPrices: { llm: {}, image: {} }, budgets: { monthlyCeilingUsd: 100 } }`, `export const WorkspaceSettingsPatchSchema` (both keys optional, `budgets` via `BudgetsPatchSchema`). `SettingsSchema` is NOT changed in this task.

- [ ] **Step 1: Write the failing tests** in `channels.test.ts`:

```ts
test('FIRST_CHANNEL_ID is a ULID and the first bible is complete', () => {
  expect(UlidSchema.safeParse(FIRST_CHANNEL_ID).success).toBe(true)
  expect(isBibleComplete(FIRST_CHANNEL_BIBLE)).toBe(true)
  expect(FIRST_CHANNEL_BIBLE.caseCategories.map((c) => c.key)).toEqual(['collapse', 'con', 'meltdown', 'turnaround', 'empire'])
})
test('an empty bible parses and is incomplete', () => {
  expect(ChannelBibleSchema.parse({})).toEqual(EMPTY_BIBLE)
  expect(isBibleComplete(EMPTY_BIBLE)).toBe(false)
  expect(isBibleComplete({ ...FIRST_CHANNEL_BIBLE, caseCategories: [FIRST_CHANNEL_BIBLE.caseCategories[0]!] })).toBe(false)
})
test.each(['Settings', 'boom busters', '-boom', 'boom-', 'settings', 'new', 'a'.repeat(41)])('slug %s is refused', (slug) => {
  expect(ChannelSlugSchema.safeParse(slug).success).toBe(false)
})
test('slugFromName', () => {
  expect(slugFromName('Boom & Busters')).toBe('boom-busters')
  expect(slugFromName('  Psychology: The Mind!! ')).toBe('psychology-the-mind')
})
```

And in `settings.test.ts`: `WorkspaceSettingsSchema.parse({})` equals `DEFAULT_WORKSPACE_SETTINGS` with `budgets.monthlyCeilingUsd` 100.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/schemas && pnpm exec vitest run channels settings`
Expected: FAIL, module `./channels` not found.

- [ ] **Step 3: Implement `channels.ts` and the workspace schema** per the Interfaces block. `FIRST_CHANNEL_BIBLE` values are copied verbatim from the two prompt files named above.

- [ ] **Step 4: Run to verify they pass**

Run: `cd packages/schemas && pnpm exec vitest run` then `pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas
git commit -m "feat(schemas): channel bible, first-channel constants and workspace settings"
```

---

### Task 2: Tables, migration 0037 and the channel queries

**Files:**
- Modify: `packages/db/src/schema.ts` (new tables after `settings` at line 223; `channelId` columns on `cases` 296, `projects` 325, `assets` 699, `publishRecords` 1041, `costLedger` 1089, `runs` 1114, `analyticsSnapshots` 1195; delete `settings` 223-228 and `SettingsRow` 1359)
- Create: `packages/db/drizzle/0037_channels.sql` and `drizzle/meta/0037_snapshot.json`, journal entry
- Create: `packages/db/src/channels.ts`, `packages/db/src/workspace.ts`, `packages/db/src/youtube-connections.ts`
- Create: `packages/db/src/channels.integration.test.ts`, `packages/db/src/migration-0037.test.ts`
- Modify: `packages/db/src/queries.ts` (lines 19-62 settings; 188-249 youtube), `packages/db/src/seed.ts:33`, `packages/db/src/index.ts`, `packages/db/src/db.integration.test.ts` (lines 62-101)

**Interfaces:**
- Schema: `channels` (id text PK, slug text unique not null, name text not null, handle text, bible jsonb not null `$type<ChannelBible>`, settings jsonb not null `$type<Settings>`, archivedAt timestamptz, createdAt, updatedAt); `workspace` (id text PK default `'singleton'`, value jsonb not null `$type<WorkspaceSettings>`, defaultChannelId text references channels, createdAt, updatedAt); `youtubeConnections` (channelId text PK references channels on delete restrict, encryptedRefreshToken text not null, keyHint text not null, youtubeChannelId text, youtubeChannelTitle text, verifyStatus verifyStatusEnum not null default `'unchecked'`, lastVerifiedAt timestamptz, createdAt, updatedAt). `channelId` columns: `cases`, `projects`, `publishRecords`, `analyticsSnapshots` not null; `costLedger`, `runs`, `assets` nullable; all `references(() => channels.id, { onDelete: 'restrict' })`; index `<table>_channel_idx` on each. `assets` indexes: `uniqueIndex('assets_content_hash_shared_key').on(t.contentHash).where(sql\`channel_id is null\`)` and `uniqueIndex('assets_content_hash_channel_key').on(t.contentHash, t.channelId).where(sql\`channel_id is not null\`)`; `assets_content_hash_key` removed. Exported row types `ChannelRow`, `WorkspaceRow`, `YoutubeConnectionRow`.
- `channels.ts`:
  - `export interface Channel { id: string; slug: string; name: string; handle: string | null; bible: ChannelBible; settings: Settings; archivedAt: Date | null }`
  - `export async function ensureFirstChannel(db: Database): Promise<Channel>` (inserts `FIRST_CHANNEL_*` with `DEFAULT_SETTINGS` and `FIRST_CHANNEL_BIBLE`, `onConflictDoNothing` on id, and the workspace row with `DEFAULT_WORKSPACE_SETTINGS` and `defaultChannelId`; idempotent)
  - `export async function getChannel(db: Database, channelId: string): Promise<Channel>` (throws `ChannelNotFoundError` from `@boom-busters/schemas` errors, message `channel <id> does not exist`)
  - `export async function getChannelBySlug(db: Database, slug: string): Promise<Channel | undefined>`
  - `export async function listChannels(db: Database, options: { includeArchived?: boolean } = {}): Promise<Channel[]>` (by `createdAt`)
  - `export async function createChannel(db: Database, input: { name: string; handle: string | null; slug: string; settings: Settings; bible: ChannelBible }): Promise<Channel>` (throws `ChannelSlugTakenError` on the unique violation, archived channels included)
  - `export async function updateChannel(db: Database, channelId: string, patch: { name?: string; handle?: string | null; bible?: ChannelBible }): Promise<Channel>`
  - `export async function archiveChannel(db: Database, channelId: string): Promise<Channel>`
  - `export async function getChannelSettings(db: Database, channelId: string): Promise<Settings>` (`normaliseSettings(row.settings)`)
  - `export async function updateChannelSettings(db: Database, channelId: string, patch: SettingsPatch): Promise<Settings>` (`mergeSettings`, one `UPDATE`)
  - `export async function channelForProject(db: Database, projectId: string): Promise<{ channelId: string; slug: string; settings: Settings; bible: ChannelBible }>` (one join; throws when the project is missing)
- `workspace.ts`: `getWorkspace(db): Promise<{ settings: WorkspaceSettings; defaultChannelId: string | null }>` (lazy insert of `DEFAULT_WORKSPACE_SETTINGS`), `updateWorkspace(db, patch: WorkspaceSettingsPatch): Promise<WorkspaceSettings>`, `setDefaultChannel(db, channelId)`.
- `youtube-connections.ts`: `channelYoutubeConnection(db, channelId): Promise<YoutubeConnectionRow | undefined>`, `saveChannelYoutubeConnection(db, channelId, input: { refreshToken: string; encryptionKey: string; youtubeChannelId: string | null; youtubeChannelTitle: string | null })`, `channelYoutubeToken(db, channelId, encryptionKey): Promise<string | undefined>`, `channelYoutubeConnected(db, channelId): Promise<boolean>` (`verifyStatus === 'ok'`), `channelYoutubeReconnectNeeded(db, channelId): Promise<{ needed: boolean; since: Date | null }>`, `recordChannelYoutubeVerify(db, channelId, status: 'ok' | 'invalid', youtubeChannelId?: string)` (an `ok` whose id differs from a stored non-null id writes `invalid` instead), `connectedChannelIds(db): Promise<string[]>` (status `ok`, channel not archived).
- Transitional wrappers kept in `queries.ts`, each marked `/** @deprecated transitional, deleted in Task 8 */`: `getSettings(db)` returns `getChannelSettings(db, FIRST_CHANNEL_ID)` spread with the workspace's `modelPrices` and `budgets`; `updateSettings(db, patch)` routes `modelPrices` and `budgets` to `updateWorkspace` and the rest to `updateChannelSettings(db, FIRST_CHANNEL_ID, ...)`, then returns `getSettings`; `youtubeRefreshToken`, `isYoutubeConnected`, `youtubeReconnectNeeded` call the `channelYoutube*` functions with `FIRST_CHANNEL_ID`; `recordVerifyResult(db, 'youtube', status)` routes to `recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, status)`; `setCredential(db, 'youtube', ...)` throws (`youtube is a channel connection`). `MaskedCredential.provider` loses `'youtube'`; `listCredentials` never lists it.

- [ ] **Step 1: Write the failing tests.** `channels.integration.test.ts` (pattern B from `logos.integration.test.ts`, truncating `channels`, `workspace`, `youtube_connections`, `projects`, `cases` cascade):

```ts
test('ensureFirstChannel creates the first channel and workspace once', async () => {
  const a = await ensureFirstChannel(db); const b = await ensureFirstChannel(db)
  expect(a.id).toBe(FIRST_CHANNEL_ID); expect(b.id).toBe(a.id)
  expect((await listChannels(db)).length).toBe(1)
  expect((await getWorkspace(db)).defaultChannelId).toBe(FIRST_CHANNEL_ID)
})
test('getChannel for an unknown id throws, never creates', async () => {
  await expect(getChannel(db, '01BB0000000000000000000009')).rejects.toThrow(ChannelNotFoundError)
  expect((await listChannels(db)).length).toBe(0)
})
test('createChannel refuses a taken slug, archived included', ...)   // ChannelSlugTakenError twice: live and after archiveChannel
test('listChannels hides archived unless asked', ...)
test('updateChannelSettings merges one channel only', ...)            // tts.voiceId on B leaves A at DEFAULT_SETTINGS
test('channelForProject returns the project channel', ...)            // case on B, project from it, expect channelId B and slug
test('getSettings wrapper merges workspace prices and budgets', ...)  // updateSettings({ budgets: { monthlyCeilingUsd: 7 } }) lands in the workspace row; getSettings().budgets.monthlyCeilingUsd is 7
test('the same logo hash on two channels is two rows; the same music hash twice is one', ...) // raw inserts into assets
test('recordChannelYoutubeVerify marks invalid when the YouTube channel id changes', ...)
```

`migration-0037.test.ts` (unit, no DB): reads `drizzle/0037_channels.sql`, extracts the `'{...}'::jsonb` literal of the `INSERT INTO "channels"` statement and asserts `JSON.parse(literal)` deep-equals `FIRST_CHANNEL_BIBLE`; asserts the file contains `DROP TABLE "settings"` after the `INSERT INTO "channels"`.

`db.integration.test.ts`: replace the three settings tests (70-101) with one: after `seed(db)`, `getSettings(db)` equals `{ ...DEFAULT_SETTINGS, ...DEFAULT_WORKSPACE_SETTINGS }` and `channels` has one row; drop `settings` from the TRUNCATE list.

- [ ] **Step 2: Run to verify they fail**

Run: `cd packages/db && pnpm exec vitest run channels migration-0037` (timeout 600000)
Expected: FAIL, modules not found.

- [ ] **Step 3: Edit `schema.ts`** per the Interfaces block, then `pnpm db:generate` to get the DDL and snapshot. Rename the generated SQL to `0037_channels.sql` (update the journal tag) and edit it into this order, `--> statement-breakpoint` between statements:

```sql
-- 1 create channels, workspace, youtube_connections (generated DDL)
-- 2 first channel + workspace from the settings row, if one exists
INSERT INTO "channels" (id, slug, name, handle, bible, settings)
SELECT '01BB0000000000000000000001', 'boom-busters', 'Boom & Busters', '@BoomAndBusters',
       '<FIRST_CHANNEL_BIBLE json>'::jsonb, value - 'modelPrices' - 'budgets'
FROM "settings" WHERE id = 'singleton';
INSERT INTO "workspace" (id, value, default_channel_id)
SELECT 'singleton', jsonb_build_object('modelPrices', coalesce(value->'modelPrices', '{"llm":{},"image":{}}'::jsonb), 'budgets', coalesce(value->'budgets', '{"monthlyCeilingUsd":100}'::jsonb)), '01BB0000000000000000000001'
FROM "settings" WHERE id = 'singleton';
-- 3 youtube credential, if any
INSERT INTO "youtube_connections" (channel_id, encrypted_refresh_token, key_hint, verify_status, last_verified_at)
SELECT '01BB0000000000000000000001', encrypted_key, key_hint, verify_status, last_verified_at
FROM "provider_credentials" WHERE provider = 'youtube' AND EXISTS (SELECT 1 FROM "channels");
-- 4 add every channel_id column NULL (generated ALTERs without NOT NULL), backfill, then SET NOT NULL
UPDATE "cases" SET channel_id = '01BB0000000000000000000001';
UPDATE "projects" SET channel_id = '01BB0000000000000000000001';
UPDATE "publish_records" SET channel_id = '01BB0000000000000000000001';
UPDATE "analytics_snapshots" SET channel_id = '01BB0000000000000000000001';
UPDATE "cost_ledger" SET channel_id = '01BB0000000000000000000001';
UPDATE "runs" SET channel_id = '01BB0000000000000000000001';
UPDATE "assets" SET channel_id = '01BB0000000000000000000001' WHERE kind = 'logo';
ALTER TABLE "cases" ALTER COLUMN channel_id SET NOT NULL;  -- and projects, publish_records, analytics_snapshots
-- 5 indexes: drop assets_content_hash_key, create the two partial unique indexes, the channel indexes, the FKs
-- 6 cleanup
DELETE FROM "provider_credentials" WHERE provider = 'youtube';
DROP TABLE "settings";
```

The FK constraints go after the backfill. On a fresh database every `SELECT ... FROM "settings"` inserts nothing and the backfills touch no rows.

- [ ] **Step 4: Implement the three query modules, the wrappers and `seed.ts`** (`ensureFirstChannel(db)` replaces `getSettings(db)` at line 33; `SeedResult.settingsCreated` becomes `firstChannelCreated`). Add `ChannelNotFoundError` and `ChannelSlugTakenError` to `packages/schemas/src/errors.ts`.

- [ ] **Step 5: Migrate the test database and run the package**

Run: `pnpm db:migrate:test` then `cd packages/db && pnpm exec vitest run` (timeout 600000), then `pnpm typecheck` at the root
Expected: migration applies; db suite PASS; typecheck clean everywhere (the wrappers keep every caller compiling). Also run `cd packages/cost && pnpm exec vitest run` (its guard test seeds and reads settings through the wrapper).

- [ ] **Step 6: Commit**

```bash
git add packages/db packages/schemas/src/errors.ts
git commit -m "feat(db): channels, workspace and youtube_connections tables with migration 0037"
```

---

### Task 3: The channel context helpers and the proxy cookie

**Files:**
- Create: `apps/web/lib/channel-context.ts`, `apps/web/lib/channel-context.test.ts`
- Create: `apps/web/lib/channel-href.ts`, `apps/web/lib/channel-href.test.ts`
- Modify: `apps/web/proxy.ts`

**Interfaces:**
- `channel-href.ts` (no server imports, usable from client components): `export type ChannelSection = '' | '/projects' | '/cases' | '/calendar' | '/costs' | '/settings'`; `export function channelHref(slug: string, section: ChannelSection = '', query?: Record<string, string>): Route` (`/c/<slug><section>` plus the query string); `export const LAST_CHANNEL_COOKIE = 'bb-last-channel'`; `export function slugFromPath(pathname: string): string | null` (the segment after `/c/`).
- `channel-context.ts` (`server-only`): `export async function channelFromSlug(slug: string): Promise<Channel>` (`getChannelBySlug`, `notFound()` on miss); `export async function channelForProjectOrNotFound(projectId: string)` (wraps `channelForProject`); `export async function landingSlug(): Promise<string>` (the `LAST_CHANNEL_COOKIE` value when it names a live channel, else the workspace `defaultChannelId`'s slug, else `ensureFirstChannel(db).slug`).
- `proxy.ts`: on a signed-in request whose pathname matches `/c/<slug>` the response sets `LAST_CHANNEL_COOKIE` to the slug (httpOnly, sameSite lax, path `/`, maxAge 365 days). No other change.

- [ ] **Step 1: Write the failing tests.** `channel-href.test.ts`: `channelHref('boom-busters', '/settings', { tab: 'voice' })` is `/c/boom-busters/settings?tab=voice`; `channelHref('x')` is `/c/x`; `slugFromPath('/c/psy/projects')` is `psy`; `slugFromPath('/projects/01…')` is null. `channel-context.test.ts` (node environment, test DB, two channels seeded): `channelFromSlug('missing')` throws the Next `notFound` error; `landingSlug()` returns the cookie's slug when live, the default channel's when the cookie names an archived or unknown slug.

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run channel-href channel-context`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the two modules and the proxy change.** Mock `next/headers` cookies in the context test the way `callback/route.test.ts` does.

- [ ] **Step 4: Run to verify they pass**, then `pnpm typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/channel-href.ts apps/web/lib/channel-href.test.ts apps/web/lib/channel-context.ts apps/web/lib/channel-context.test.ts apps/web/proxy.ts
git commit -m "feat(web): channel context, channel hrefs and the last-channel cookie"
```

---

### Task 4: The `/c/[slug]` route tree and the shell

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/layout.tsx`, `apps/web/app/(console)/c/[slug]/page.tsx`
- Move: `(console)/projects/page.tsx`, `(console)/cases/*`, `(console)/calendar/*`, `(console)/costs/*`, `(console)/settings/*` to the same names under `(console)/c/[slug]/` (git mv; `projects/[id]/*` and `projects/actions.ts` stay)
- Create: `apps/web/app/(console)/projects/[id]/layout.tsx`
- Replace: `(console)/page.tsx`, `(console)/projects/page.tsx`, and new thin `(console)/cases/page.tsx`, `calendar/page.tsx`, `costs/page.tsx`, `settings/page.tsx` as redirects
- Modify: `(console)/layout.tsx`, `components/app-rail.tsx`, `components/mobile-nav.tsx`, `components/top-bar.tsx`, `components/breadcrumb.tsx`
- Create: `components/console-shell.tsx`, `components/console-shell.test.tsx`, `components/channel-switcher.tsx`, `components/channel-switcher.test.tsx`
- Modify: `e2e/tests/fixtures.ts`, every spec in section 3 of the inventory that calls `page.goto` on a list route, `e2e/global-setup.ts`
- Modify: `apps/web/lib/first-run.ts` (hrefs), `inngest/lib/gates.ts:181`, `inngest/functions/analytics-runner.ts` (104-108, 137-141, 158-162, 312-316), `inngest/functions/publish-runner.ts:322`, `components/needs-you-queue.tsx` hrefs, `revalidatePath` calls in `settings/actions.ts`, `cases/actions.ts`, `projects/actions.ts`, `projects/[id]/*-actions.ts`

**Interfaces:**
- `console-shell.tsx`: `export function ConsoleShell({ channel, monthSpendUsd, ceilingUsd, activeRuns, activity, channels, children }: { channel: { id: string; slug: string; name: string; archivedAt: Date | null }; channels: SwitcherEntry[]; ... })` renders `AppRail`, `TopBar`, `MobileNav` and `main`; `AppRail`/`MobileNav` take `{ slug: string; name: string }` and build `NAV` hrefs with `channelHref`; `TopBar` gains `channels` and `current` for the switcher.
- `channel-switcher.tsx`: `export interface SwitcherEntry { id; slug; name; needsYou: number }`; `export function ChannelSwitcher({ current, channels, section }: { current: string; channels: SwitcherEntry[]; section: ChannelSection })` is a 40 px button labelled with the current name that opens a list; each entry is a button (link) to `channelHref(entry.slug, section)` showing the name and the count; the foot is a button "New channel" to `/c/<current>/settings?tab=channel&new=1` (Task 11 wires it). From a project page `section` is `''`.
- `c/[slug]/layout.tsx`: `channelFromSlug(params.slug)`, loads what `(console)/layout.tsx` loads today (`monthTotalUsd`, `listActiveRuns`, `listActivity`, workspace budgets via the `getSettings` wrapper until Task 9) plus `listChannels` with counts (Task 11 adds counts; until then 0) and renders `ConsoleShell`. `projects/[id]/layout.tsx` does the same from `channelForProjectOrNotFound(params.id)`. `(console)/layout.tsx` keeps only `dynamic = 'force-dynamic'` and returns children.
- `landingSlug()` drives `(console)/page.tsx` (`redirect(channelHref(slug))`) and the four thin list redirects (`redirect(channelHref(slug, '/projects'))` and so on, preserving `?tab=` and other query strings). A fifth thin redirect at `(console)/settings/page.tsx` sends `/settings?tab=x` to the channel's settings tab until Task 9 replaces it with the workspace page.
- Every link the app sends carries the channel: `buildChecklist` gains `slug: string` and builds hrefs with `channelHref`; `notify` callers in gates.ts (`'/costs'`) and analytics-runner and publish-runner (`'/settings?tab=connections'`, `'/'`) take the slug from `channelForProject` or, in analytics-runner, from the first channel through the wrapper until Task 7 loops channels.
- e2e: `fixtures.ts` exports `FIRST_SLUG = 'boom-busters'` and `channelPath(section: string): string` (`/c/boom-busters${section}`); `openFixtureProject` goes to `channelPath('/projects')`; every list `goto` in auth, console, mobile, pipeline, project-lifecycle, writing-room, settings-* specs uses `channelPath`; `console.spec.ts` rail test expects `/\/c\/boom-busters\/projects/` and so on; `auth.spec.ts:49-50` expects the signed-in landing to be `/c/boom-busters` and the callbackUrl assertions use the prefixed path.

- [ ] **Step 1: Write the failing tests.** `console-shell.test.tsx`: renders with channel `{ name: 'Psychology', slug: 'psychology' }` and asserts the rail header reads "Psychology", the Projects link href is `/c/psychology/projects`, and the switcher button is labelled "Psychology" with a 40 px min height (reuse the hit-target assertion from the settings tests). `channel-switcher.test.tsx`: opening the list shows every entry as a button with its count, the current one marked, and "New channel" last. A route test `projects/[id]/layout.test.tsx` (node, test DB): a project on channel B rendered through the layout shows B's name in the shell regardless of a `bb-last-channel` cookie naming A (Review Focus 1).

- [ ] **Step 2: Run to verify they fail**

Run: `cd apps/web && pnpm exec vitest run console-shell channel-switcher layout`
Expected: FAIL.

- [ ] **Step 3: Move the directories and build the shell.** `git mv` the five directories, fix the `@/app/(console)/...` imports the typechecker reports (`cost-controls.tsx`, tests, `voice-tab.test.tsx` paths), add the two layouts and the redirect pages, update `breadcrumb.tsx` to skip the `c/<slug>` pair and label from the section, change `revalidatePath` calls to `revalidatePath('/c/[slug]', 'layout')` where they revalidated `/` or `/settings`, and prefix the notify and checklist hrefs. Metadata titles keep "· Boom-Busters" (the console's name).

- [ ] **Step 4: Run the unit suites and typecheck**

Run: `cd apps/web && pnpm exec vitest run` (timeout 600000), `pnpm typecheck`, `pnpm lint`
Expected: PASS, clean.

- [ ] **Step 5: Update the e2e specs and run the affected ones**

Run: `cd e2e && pnpm exec playwright test auth console mobile pipeline project-lifecycle writing-room settings-models settings-logos settings-exemplars` (timeout 600000)
Expected: PASS. Then the remaining specs in one more run (they reach projects through `openFixtureProject`).

- [ ] **Step 6: Commit**

```bash
git add -A apps/web e2e
git commit -m "feat(web): channel route tree under /c/[slug], console shell and switcher"
```

---

### Task 5: Cases and projects belong to a channel

**Files:**
- Modify: `packages/db/src/cases.ts` (73, 102, 115, 143, 215), `packages/db/src/projects.ts` (154, 164, 427), `packages/db/src/queries.ts:177` (`countCases`), `packages/db/src/fixtures.ts` (`fixtureCase` gains `channelId: FIRST_CHANNEL_ID`)
- Modify: `packages/db/src/cases.integration.test.ts`, `projects` tests
- Modify: `apps/web/app/(console)/c/[slug]/cases/page.tsx`, `cases/actions.ts`, `c/[slug]/projects/page.tsx`, `c/[slug]/page.tsx`, `(console)/projects/actions.ts`, `e2e/global-setup.ts` (every `createProjectFromCase`), the apps/web tests that create cases or projects

**Interfaces:**
- `CaseInput.channelId: string` (required); `listCases(db, channelId, options)`, `existingCaseTitles(db, channelId)`, `createSuggestedCases(db, channelId, inputs)` (dedupe within the channel), `countCases(db, channelId)`.
- `createProjectFromCase(db, input)` reads the case's `channelId` and writes it on the project; `listProjects(db, channelId)`, `listProjectsAwaitingReview(db, channelId)`. `getProject` and `getCase` are unchanged (by id).
- Pages take `channelId` from `channelFromSlug`; `cases/actions.ts` actions take `channelId` as their first argument (validated with `UlidSchema`) and `suggestCases` passes it to `callLlm` options as `projectId: undefined` (unchanged) and to `createSuggestedCases`.

- [ ] **Step 1: Write the failing tests.** `cases.integration.test.ts`: two channels; `listCases(db, A)` never returns B's case; `createSuggestedCases(db, B, [{ title: sameAsA }])` creates (dedupe is per channel); `countCases` per channel. `projects.integration.test.ts`: `createProjectFromCase` on B's case sets `channelId` B; `listProjects(db, A)` excludes it.

- [ ] **Step 2: Run to verify they fail**, `cd packages/db && pnpm exec vitest run cases projects` (timeout 600000).

- [ ] **Step 3: Change the signatures and fix every caller the typechecker reports** (apps/web pages and actions, e2e global-setup, tests, `seed.ts`).

- [ ] **Step 4: Run** `cd packages/db && pnpm exec vitest run` then `cd apps/web && pnpm exec vitest run` (each timeout 600000), `pnpm typecheck`; then `cd e2e && pnpm exec playwright test writing-room project-lifecycle console`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/db apps/web e2e
git commit -m "feat(db): cases and projects carry their channel; list queries take it"
```

---

### Task 6: Runs, the ledger and activity are attributed to the channel

**Files:**
- Modify: `packages/db/src/runs.ts` (68 `ensureRun`, 199, 251, 308, 366), `packages/db/src/pulse.ts:36`, `packages/cost/src/ledger.ts` (71, 87, 103, 141, 149, 182), `packages/cost/src/guard.ts` (50 `CostSpec`, the insert inside `reserve`)
- Modify: `apps/web/app/(console)/c/[slug]/layout.tsx`, `projects/[id]/layout.tsx`, `c/[slug]/page.tsx`, `c/[slug]/costs/page.tsx`, `components/needs-you-queue.tsx`
- Tests: `packages/db/src/runs.integration.test.ts`, `packages/cost/src/guard.integration.test.ts`, `apps/web/inngest/functions/dossier-runner.test.ts`

**Interfaces:**
- `ensureRun` sets `channelId` to `(select channel_id from projects where id = <projectId>)` when `projectId` is given, else `identity.channelId ?? null`; `RunIdentity.channelId?: string | null`.
- `listActivity(db, { channelId?, projectId?, limit? })`, `listActiveRuns(db, channelId)`, `listFailedRuns(db, channelId, limit)`, `listOpenBudgetGates(db, channelId)`: rows where `runs.channel_id = channelId OR runs.channel_id IS NULL` (the cron's rows show everywhere). `globalPulse(db, channelId)` over that channel's projects and runs.
- `CostSpec.channelId?: string | null`; `reserve` and `recordCost` write `channel_id = coalesce(spec.channelId, (select channel_id from projects where id = spec.projectId))`. `monthTotalUsd` stays global. `monthSpendByProvider(db, when, channelId?)`, `monthSpendByProject(db, when, channelId)`, `LedgerFilter.channelId?`; new `monthOtherChannelsUsd(db, when, channelId): Promise<number>`.
- Review Focus 2 lives here: in `dossier-runner.test.ts` add a case that replays a memoised `load-case` step output without `channelId` and asserts the later step that needs settings (today through the wrapper, from Task 8 through `channelForProject`) completes. Until Task 8 the assertion is that the run completes and the ledger row carries the project's channel.

- [ ] **Step 1: Write the failing tests.** runs: a run for a project on B lists under B and not A; a cron run with `channelId: null` lists under both. guard: `reserve` with only `projectId` writes the project's channel on the ledger row; with `channelId` and no project writes it; `monthSpendByProject(db, NOW, A)` never lists B's projects; `monthOtherChannelsUsd` sums B's rows from A's view; one ceiling parks a reservation on B after A spent to it.

- [ ] **Step 2: Run to verify they fail** (`packages/db` runs, `packages/cost` guard, one at a time, timeout 600000).

- [ ] **Step 3: Implement**, then thread `channelId` from the two layouts, the dashboard, the costs page and the queue component. The costs page gains the "other channels this month" line under its per-provider table.

- [ ] **Step 4: Run** the three package suites one at a time and `pnpm typecheck`; `cd e2e && pnpm exec playwright test pipeline console`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/db packages/cost apps/web
git commit -m "feat(cost): runs and ledger rows carry the channel; activity and costs read per channel"
```

---

### Task 7: Publishing, YouTube connections and analytics per channel

**Files:**
- Modify: `packages/db/src/publish.ts` (26, 143, 194, 219), `packages/db/src/analytics.ts` (16, 34, 80), tests for both
- Modify: `apps/web/app/api/youtube/connect/route.ts`, `callback/route.ts`, `callback/route.test.ts`, `apps/web/lib/youtube.ts` (125, 247), `lib/youtube-state.ts` (create) with test
- Modify: `c/[slug]/settings/youtube-card.tsx`, `settings/actions.ts:406` (`verifyYoutubeConnection(channelId)`), `c/[slug]/page.tsx` (37, 53), `c/[slug]/calendar/page.tsx`, `projects/[id]/publish-actions.ts` (727, 737, 767), `lib/publish-review.ts`
- Modify: `apps/web/inngest/functions/publish-runner.ts` (168, 172, 301-312, 322, 414), `analytics-runner.ts` (whole handler), `inngest/events.ts:123`, `packages/schemas/src/events.ts:345`, `analytics-runner.test.ts`, `publish-runner.test.ts`, `shorts-runner.test.ts`, `teaser-rebuild-runner.test.ts` (replace `setCredential(db,'youtube',…)` with `saveChannelYoutubeConnection`)
- Modify: `e2e/global-setup.ts` (seed the first channel's mock connection), `packages/db/src/queries.ts` (delete the four youtube wrappers and the `setCredential` youtube branch)

**Interfaces:**
- `ensurePublishRecord(db, targetType, targetId)` derives `channel_id` in SQL (master: the project; short: `shorts` join `projects`). `scheduledPublishItems(db, channelId)`, `videoBackedRecords(db, channelId)`, `countUploadsSince(db, channelId, since)`.
- `AnalyticsSnapshotInput.channelId: string`; `snapshotsSince(db, channelId, since)`.
- `lib/youtube-state.ts`: `signOauthState(channelId: string, nonce: string, key: string): string` (base64url of `channelId.nonce.hmacSha256(channelId + '.' + nonce)`), `verifyOauthState(state: string, nonce: string, key: string): { channelId: string } | null`. Connect takes `?channel=<id>`, validates it is a live channel, signs the state with `env.SECRETS_ENCRYPTION_KEY`, keeps the nonce in `STATE_COOKIE`. Callback verifies, writes `saveChannelYoutubeConnection` with the ping's id and title, and `back()` redirects to `channelHref(slug, '/settings', { tab: 'connections', youtube: outcome })`; a bad signature, missing cookie or nonce mismatch is `state-mismatch` and writes nothing.
- `ChannelPing` gains `channelId?: string`; `pingChannel` requests `part=id,snippet`.
- `YoutubeCard({ connection, envReady, channelId, slug })`; its Connect anchor is `/api/youtube/connect?channel=<id>`.
- `publish-runner`: the `preflight` and `mint-token` steps call `channelForProject` then `channelYoutubeToken(db, channelId, key)`; `countUploadsSince(db, channelId, since)` against that channel's `dailyUploadBudget`; `recordChannelYoutubeVerify`; the reconnect notify href is `channelHref(slug, '/settings', { tab: 'connections' })`.
- `analytics-runner`: step `list-channels` returns `connectedChannelIds(db)` (archived excluded); then per channel the steps `mint-access-token-${channelId}`, `ping-channel-${channelId}`, `reconcile-live-${channelId}`, `list-live-videos-${channelId}`, `snapshot-${channelId}-${videoId}`, `weekly-digest-${channelId}`; a dead token marks that channel and notifies with that channel's href; the onFailure href is the first listed channel's `/costs`. `AnalyticsRefreshRequestedSchema` gains `channelId: UlidSchema.optional()`; when present the loop runs only that channel. `refreshAnalytics(projectId)` sends the project's channel.
- e2e global-setup: after seed, `saveChannelYoutubeConnection(db, FIRST_CHANNEL_ID, { refreshToken: 'mock-refresh', encryptionKey, youtubeChannelId: 'UC-mock-first', youtubeChannelTitle: 'Boom & Busters (mock)' })` then `recordChannelYoutubeVerify(db, FIRST_CHANNEL_ID, 'ok', 'UC-mock-first')`. The `encryptionKey` comes from the same env the web server runs with (`SECRETS_ENCRYPTION_KEY` from `.env.local`); `MOCK_PROVIDERS` keeps YouTube unreachable. Check `console.spec.ts:16-25` (the first-run strip) still holds; if "Connect YouTube" leaving the checklist changes a visible state, update that assertion in the same commit and say so in the commit body.

- [ ] **Step 1: Write the failing tests.** `youtube-state.test.ts`: round trip; a tampered channel id, a wrong nonce and a wrong key each verify to null. `callback/route.test.ts`: success writes the connection for the state's channel and redirects to that channel's Connections tab; missing cookie is `state-mismatch` with no write (Review Focus 3); a ping that returns a different id than a stored one records `invalid`. `publish.integration.test.ts`: `countUploadsSince` per channel; `scheduledPublishItems` per channel. `analytics.integration.test.ts`: `snapshotsSince` per channel. `analytics-runner.test.ts`: two channels, one connected: one token minted, one digest, no run failure, the other channel's connection untouched; an archived connected channel is skipped (Review Focus 5); `index.test.ts` keeps passing (ids unchanged).

- [ ] **Step 2: Run to verify they fail** (apps/web first, then packages/db, one DB suite at a time).

- [ ] **Step 3: Implement** per the Interfaces block; delete the four youtube wrappers from `queries.ts` and fix what the typechecker reports.

- [ ] **Step 4: Run** `cd apps/web && pnpm exec vitest run` (timeout 600000), `cd packages/db && pnpm exec vitest run publish analytics`, `pnpm typecheck`; `cd e2e && pnpm exec playwright test publish console`.

- [ ] **Step 5: Commit**

```bash
git add -A packages apps/web e2e
git commit -m "feat(youtube): one connection per channel, signed OAuth state, analytics cron loops channels"
```

---

### Task 8: Settings are read through the channel

**Files:**
- Modify: every `getSettings`/`updateSettings` call site in section 1 of the web inventory (pages, actions, lib, runners, scripts, tests), `e2e/global-setup.ts:1323-1344`, `e2e/tests/fixtures.ts:109-117`, `packages/db/src/queries.ts` (delete both wrappers and `SETTINGS_ID`), `packages/db/src/seed.ts`
- Modify: `apps/web/lib/llm.ts` (29, 55), `lib/tts.ts:93`, `lib/visual-assets.ts` (134, 407, 414, 425, 508, 772), `lib/set-sheet.ts:72`, `lib/model-catalogue.ts` (135, 207), `lib/visuals-review.ts:900`, `lib/voice-review.ts:132`, `lib/publish-review.ts:370`, `inngest/lib/gates.ts:201`

**Interfaces:**
- `callLlm(request, options: CallOptions & { channelId: string })`: settings via `getChannelSettings`; prices and budgets via the `getSettings` wrapper's replacement, `getWorkspace` (Task 9 moves the keys; until then `settings.modelPrices` and `settings.budgets` are still on the channel settings and read from there).
- `synthesise(input, settings: Settings)` (required; the override becomes the only path). `loadModelOptions(settings)` and `stillCatalogue(settings, slotRoutes)` keep taking `Settings` until Task 9.
- Every lib function that takes `projectId` (`stillsEstimateUsd`, `generateStillCandidates`, `resolveSlotBrief`, `buildSetSheet` via its set's project, the three review models) resolves `channelForProject(db, projectId)` inside itself; the three `*EstimateUsd()` with no project gain a `channelId` parameter.
- Runners: each step listed in the web inventory's Inngest table calls `channelForProject(db, projectId)` inside that step and uses `.settings`; `grantOverage(channelId, additionalUsd, now)` writes `budgets.approvedOverage` through `updateChannelSettings` on the project's channel until Task 9, which drops the `channelId` parameter and writes the workspace row.
- Settings page and actions (`c/[slug]/settings/*`): `saveSettings(channelId, patch)`, `generateAuditions(channelId, …)`, `addPronunciation(channelId, …)`, `checkPronunciation(channelId, …)`, `setChannelMarkAction(channelId, id)`, `removeLogoAction(channelId, id)`; `SettingsForm` takes `channelId` and `slug` and its `commit` passes them. `voice-tab.test.tsx` and the other settings tests pass `channelId: FIRST_CHANNEL_ID`.
- Tests that seeded with `updateSettings(db, …)` call `updateChannelSettings(db, FIRST_CHANNEL_ID, …)`; e2e global-setup and fixtures do the same, with `budgets` and `modelPrices` through `updateWorkspace`.
- `seed()` returns `{ firstChannelCreated, credentialsImported }`.

- [ ] **Step 1: Delete `getSettings`, `updateSettings` and `SETTINGS_ID` from `queries.ts`**, run `pnpm typecheck` and keep the error list as the work list (expected: about 50 sites across apps/web, packages/cost, e2e).

- [ ] **Step 2: Write the failing tests first for the three load-bearing paths:** `llm.test.ts` (or the existing nearest test) asserts `callLlm` routes with channel B's `modelRouting.scripting` when `channelId` is B and A's differs; `voice-runner.test.ts` asserts the `load-script` step reads B's `tts.voiceId` for a project on B; `dossier-runner.test.ts` Review Focus 2 case now asserts the later step resolves B's settings with a memoised `load-case` output that has no `channelId`.

- [ ] **Step 3: Work the typecheck list to zero** per the Interfaces block. Rule for each site: a page has the slug; an action has a project id or receives `channelId` as its first argument; a runner calls `channelForProject` inside the step; a lib function with a project id resolves it itself.

- [ ] **Step 4: Run** `cd apps/web && pnpm exec vitest run` (timeout 600000; split by directory if it nears the limit: `app`, `inngest`, `lib components`), `cd packages/cost && pnpm exec vitest run`, `cd packages/db && pnpm exec vitest run`, `pnpm typecheck`, `pnpm lint`; then the full e2e run `cd e2e && pnpm exec playwright test` (timeout 600000, split in two batches if needed).

- [ ] **Step 5: Commit**

```bash
git add -A packages apps/web e2e
git commit -m "refactor(settings): every reader resolves its channel; getSettings and updateSettings are gone"
```

---

### Task 9: Prices and the budget move to the workspace; the workspace settings page

**Files:**
- Modify: `packages/schemas/src/settings.ts` (567 `SettingsSchema` loses `modelPrices` and `budgets`; 608 `SettingsPatchSchema` likewise; 637 `DEFAULT_SETTINGS`), `settings.test.ts`, `packages/db/src/settings-merge.ts` (+ test: an old value with the two keys normalises without them)
- Modify: `packages/cost/src/guard.ts` (64 `WithCostOptions.budgets?: Budgets`, 78, 105 `reserve(db, spec, budgets, now)`, 185 `budgetStatus(db, budgets, …)`), `guard.integration.test.ts`
- Modify: `apps/web/lib/llm.ts`, `lib/model-catalogue.ts` (`loadModelOptions({ routing, prices })`, `stillCatalogue({ routing, prices }, slotRoutes)`), `lib/visual-assets.ts`, `lib/set-sheet.ts`, `inngest/lib/gates.ts:201` (`grantOverage` writes `updateWorkspace`), the four runners that pass budgets to `reserve`, `demo-pipeline.ts:162`
- Modify: `c/[slug]/layout.tsx` and `projects/[id]/layout.tsx` (ceiling from `getWorkspace`), `c/[slug]/costs/page.tsx` and `cost-controls.tsx` (`saveWorkspaceSettings`), `c/[slug]/settings/page.tsx`, `settings-form.tsx`, `models-tab.tsx` (price table out), `price-forms.tsx`, `music-tab.tsx` (out of the channel form)
- Create: `apps/web/app/(console)/settings/page.tsx` (workspace), `settings/workspace-form.tsx`, `settings/workspace-actions.ts`, `settings/workspace-form.test.tsx`, `settings/workspace-actions.test.ts`
- Modify: `(console)/settings` old deep links: `lib/first-run.ts` music item href becomes `/settings?tab=music`; `components/needs-you-queue.tsx`; `e2e/tests/settings-models.spec.ts` (price assertions move to the workspace page)

**Interfaces:**
- `WithCostOptions { now?: Date; budgets?: Budgets }`; when absent `withCost` reads `getWorkspace(db).settings.budgets`. `reserve(db, spec, budgets: Budgets, now)`. `budgetStatus(db, budgets, options)`.
- Workspace page at `/settings` with tabs `connections` (provider keys: the cards from `ConnectionsTab` minus the YouTube card), `prices` (the price table from the Models tab), `music` (the Music tab as is), rendered by `WorkspaceForm({ initialSettings: WorkspaceSettings, credentials, mockProviders, musicBeds, modelOptions, initialTab })`. `workspace-actions.ts`: `saveWorkspaceSettings(patch: unknown): Promise<ActionResult>` (validated with `WorkspaceSettingsPatchSchema`), and the music actions moved from `settings/actions.ts` (`createMusicUploadAction`, `finaliseMusicBedAction`, `recordMusicBedDurationAction`, `deleteMusicBedAction`), `saveProviderKey`, `verifyProviderKey`.
- Channel settings tabs become: `models` (routing and fallback only), `brand-kit`, `voice`, `logos`, `exemplars`, `publishing`, `connections` (YouTube card only, with a line linking to the workspace keys page). The `TABS` whitelist in both pages matches. A workspace link sits in the rail under Settings labelled "Workspace" (a 40 px button-link to `/settings`).
- `CeilingEditor` calls `saveWorkspaceSettings({ budgets: { monthlyCeilingUsd } })`.

- [ ] **Step 1: Write the failing tests.** `settings.test.ts`: `SettingsSchema.parse(DEFAULT_SETTINGS)` has no `modelPrices` or `budgets` key; `SettingsPatchSchema.safeParse({ budgets: {} })` fails. `settings-merge.test.ts`: `normaliseSettings({ ...DEFAULT_SETTINGS, budgets: { monthlyCeilingUsd: 5 } })` drops `budgets`. `guard.integration.test.ts`: `withCost` with no `budgets` option reads the workspace ceiling; `reserve` takes `budgets`. `workspace-actions.test.ts`: `saveWorkspaceSettings({ budgets: { monthlyCeilingUsd: 250 } })` lands in the workspace row; `{ tts: {} }` is refused. `workspace-form.test.tsx`: the three tabs render with their actions mocked; the channel `SettingsForm` no longer renders a price table or the music tab (update `models-tab.test.tsx`, `music-tab.test.tsx` imports and `voice-tab.test.tsx` mocks accordingly).

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Remove the two keys from `SettingsSchema`, run `pnpm typecheck`, work the list to zero** per the Interfaces block, building the workspace page as you go.

- [ ] **Step 4: Run** the schemas, cost, db and web suites one at a time, `pnpm typecheck`, `pnpm lint`; `cd e2e && pnpm exec playwright test settings-models console pipeline`.

- [ ] **Step 5: Commit**

```bash
git add -A packages apps/web e2e
git commit -m "feat(settings): prices and the budget live on the workspace; workspace settings page"
```

---

### Task 10: Logos per channel, music shared

**Files:**
- Modify: `packages/db/src/logos.ts` (17, 42, 115, 123), `logos.integration.test.ts`; `music.ts` unchanged
- Modify: `c/[slug]/settings/logo-actions.ts` (every action takes `channelId` first), `logos-tab.tsx`, `logos-tab.test.tsx`, `logo-actions.test.ts`, `e2e/global-setup.ts` (the two `insertLogo` calls), `e2e/tests/settings-logos.spec.ts`
- Modify: `lib/first-run.ts` (music count is the shared library's; `buildChecklist` input keeps `musicBedCount`)

**Interfaces:**
- `listLogos(db, channelId)`, `insertLogo(db, channelId, input)` (conflict target `(contentHash, channelId)`, `setWhere` kind logo), `findLogoByName(db, channelId, name)`, `logoByR2Key(db, channelId, r2Key)`. `logoById`, `renameLogo`, `removeLogo` unchanged (by id). `upsertAssetByHash` keeps the shared index (`channelId` never set).

- [ ] **Step 1: Write the failing tests.** `logos.integration.test.ts`: the same bytes inserted for A and B are two rows with one `r2Key`; `listLogos(db, A)` has one; `findLogoByName(db, B, name)` finds B's only. `logo-actions.test.ts`: `setChannelMarkAction(B, id)` writes B's `brandKit.look.logoR2Key`, A's unchanged.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** and fix the callers the typechecker reports.

- [ ] **Step 4: Run** `cd packages/db && pnpm exec vitest run logos music visuals`, `cd apps/web && pnpm exec vitest run logo logos`, `pnpm typecheck`; `cd e2e && pnpm exec playwright test settings-logos`.

- [ ] **Step 5: Commit**

```bash
git add -A packages/db apps/web e2e
git commit -m "feat(logos): one logo library per channel; music stays shared"
```

---

### Task 11: Create, switch and archive a channel; the Channel tab and the bible gate

**Files:**
- Create: `c/[slug]/settings/channel-tab.tsx`, `channel-tab.test.tsx`, `channel-actions.ts`, `channel-actions.test.ts`, `new-channel-form.tsx`, `new-channel-form.test.tsx`
- Modify: `settings-form.tsx` (tab `channel` first, label "Channel"), `settings/page.tsx` (`TABS`, `?new=1`), `voice-tab.test.tsx` (mock `./channel-actions`), `components/channel-switcher.tsx` (New channel target), `c/[slug]/layout.tsx` and `projects/[id]/layout.tsx` (counts)
- Create: `apps/web/lib/needs-you-count.ts` with test
- Modify: `c/[slug]/cases/case-library.tsx` and `c/[slug]/page.tsx` (Suggest cases and New project disabled with the bible notice), `cases/actions.ts` and `projects/actions.ts` (refuse when the bible is incomplete), `lib/first-run.ts` (first item "Write the channel bible", href the Channel tab, done when `isBibleComplete`), `first-run.test.ts`
- Create: `apps/web/inngest/lib/channel.ts` with `requireCompleteBible(channel: { bible: ChannelBible; slug: string }): void` (throws `NonRetriableError('channel bible incomplete')` when `!isBibleComplete(bible)`); called by `dossier-runner.ts` in its first step after `channelForProject`, because every later stage follows a dossier; test in `dossier-runner.test.ts`

**Interfaces:**
- `channel-actions.ts`: `createChannelAction(input: unknown): Promise<ActionResult & { slug?: string }>` (validates `CreateChannelInputSchema`; `startFrom: 'defaults'` uses `DEFAULT_SETTINGS`; `copyFromChannelId` copies `brandKit`, `tts`, `modelRouting`, `fallbackChain`, `render`, `publish` from that channel and nothing else; bible `EMPTY_BIBLE`; refuses a reserved or taken slug with "That address is taken" or "That address is reserved"); `updateChannelAction(channelId, patch: unknown)` (name, handle, bible; validated with `ChannelBibleSchema`); `archiveChannelAction(channelId, typedSlug: string)` (refuses unless `typedSlug === slug`; refuses with the reason while `listActiveRuns` has a run for the channel, `listOpenBudgetGates` is non-empty, or `scheduledPublishItems` has a `scheduled` item; on success the switcher cookie is cleared and the action returns the default channel's slug for the client to navigate to).
- `needs-you-count.ts`: `needsYouCount(db, channelId): Promise<number>` = `buildNeedsYouCards(...)` length for that channel (awaiting review, budget gates, failed runs, reconnect). The layouts map `listChannels` through it for the switcher.
- `ChannelTab({ channel, saving, commit })`: name, handle (inputs, Save button), the bible fields one labelled textarea each (categories as rows of key and label with Add and Remove buttons), a "Bible complete" or "Bible incomplete: n fields" line, and an Archive card with the typed-slug confirm. `NewChannelForm({ channels })` renders inside the Channel tab when `?new=1`: name, handle, slug (prefilled by `slugFromName` on name input until edited), Start from (radio: House defaults, Copy from <select of channels>), Create button; success navigates to `channelHref(slug, '/settings', { tab: 'channel' })`.
- `isBibleComplete` gate: `suggestCases`, `createProject` actions return `{ ok: false, error: 'Complete the channel bible in Settings first' }`; the buttons render disabled with that text and a link to the tab. The first channel's bible is complete from the migration.

- [ ] **Step 1: Write the failing tests.** `channel-actions.test.ts` (node, test DB): create with defaults lands with `EMPTY_BIBLE` and `DEFAULT_SETTINGS`; copy from A carries A's `tts.voiceId` and not A's YouTube connection or logos; each refused slug in Review Focus 4 inserts nothing; archive refuses with a live run, with an open budget gate, with a scheduled publish, and with a wrong typed slug, then succeeds and `listChannels` hides it. `needs-you-count.test.ts`: counts per channel. `channel-tab.test.tsx`, `new-channel-form.test.tsx`: every action is a labelled 40 px button; the slug follows the name until edited. `first-run.test.ts`: the bible item is first and done only when complete. `dossier-runner.test.ts`: a project on a channel with `EMPTY_BIBLE` fails with `channel bible incomplete` and sends no LLM request.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** per the Interfaces block.

- [ ] **Step 4: Run** `cd apps/web && pnpm exec vitest run` (timeout 600000, split by directory if needed), `pnpm typecheck`, `pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add -A apps/web
git commit -m "feat(channels): create, switch and archive a channel; Channel tab and the bible gate"
```

---

### Task 12: End to end, the migration rehearsal, decisions and the full run

**Files:**
- Modify: `e2e/global-setup.ts` (second fixture channel), `e2e/tests/fixtures.ts`
- Create: `e2e/tests/channels.spec.ts`
- Modify: `e2e/tests/mobile.spec.ts` (switcher and Channel tab at 390 px)
- Modify: `PROGRESS.md`, `docs/03-build-spec.md` (section 4 settings and section 9 YouTube gain a short "per channel" note pointing at the design), `.env.example` (no new variables; confirm)
- Modify: `README.md` or `docs/` runbook if one lists the deploy steps: add the Neon rehearsal and `PUT /api/inngest`

**Interfaces:**
- Global-setup: after the first channel's fixtures, `createChannel(db, { name: 'Second Channel', handle: null, slug: 'e2e-second', settings: DEFAULT_SETTINGS, bible: EMPTY_BIBLE })` with no connection, no cases, no logos. `fixtures.ts` exports `SECOND_SLUG = 'e2e-second'` and `channelPath(section, slug = FIRST_SLUG)`.
- `channels.spec.ts`, in order: sign in; open the switcher, see both channels with counts, choose Second Channel, land on `/c/e2e-second`; the first-run strip's first item is "Write the channel bible"; Suggest cases is disabled with the notice; open Settings, Channel tab, fill every bible field and two categories, Save, return and see Suggest cases enabled; change the Brand Kit accent on Second Channel and read the first channel's unchanged; add a case on Second Channel and read the first channel's library unchanged; open Second Channel's calendar and see no first-channel items; the top-bar meter shows the same workspace figure on both; create a third channel through New channel with a slug the form prefilled, land on its Channel tab; archive it with the typed slug and land on the default channel; the workspace Music tab lists the same beds from both channels' Settings links.

- [ ] **Step 1: Write `channels.spec.ts` and the second fixture channel**, run `cd e2e && pnpm exec playwright test channels` (timeout 600000). Expected: PASS.

- [ ] **Step 2: Mobile pass**: add the switcher and the Channel tab to `mobile.spec.ts` hit-target checks; `pnpm exec playwright test --project=mobile-390`.

- [ ] **Step 3: Full verification**

Run, one at a time: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, then per package `pnpm exec vitest run` in schemas, db, cost, providers, timeline, compositions, case-finder, apps/web (timeout 600000 each; compositions snapshot flakes are re-run alone before being believed), then `cd e2e && pnpm exec playwright test` in two batches.
Expected: all green.

- [ ] **Step 4: Migration rehearsal on a Neon branch.** Hand the owner this runbook in the final message rather than running it: create a Neon branch from production; `DATABASE_URL=<branch> pnpm db:migrate`; then, read-only, compare counts: `select count(*) from cases where channel_id = '01BB0000000000000000000001'` equals the pre-migration case count, same for projects, publish_records, analytics_snapshots, cost_ledger, runs, and `assets where kind='logo'`; `select count(*) from assets where kind='music' and channel_id is null` equals the music count; `select slug, (settings ? 'budgets') from channels` returns `boom-busters | f`; `select value->'budgets' from workspace`; `select verify_status from youtube_connections`. Only then production.

- [ ] **Step 5: PROGRESS.md decisions** from the next free number on `origin/master` (fetch first; renumber only these lines; separate commit): one decision each for (a) channels and the workspace split with the first channel's constant id and the migration, (b) channel resolution from data or URL and the `/c/<slug>` routes with the project page unprefixed, (c) one YouTube connection per channel with the signed OAuth state and the stored channel id, (d) the bible as structured fields stored in stage A and the completeness gate, with stage B named as the next plan. Add a Stage A section under the current milestone with the deliverables checklist.

- [ ] **Step 6: Commit and hand over**

```bash
git add -A e2e PROGRESS.md docs
git commit -m "test(e2e): channels spec and second fixture channel; docs(progress): decisions 323 to 326"
```

Then `superpowers:finishing-a-development-branch`: merge `multi-channel` into `master` with `--no-ff` once the owner has run the Neon rehearsal; after the deploy, `PUT /api/inngest`.
