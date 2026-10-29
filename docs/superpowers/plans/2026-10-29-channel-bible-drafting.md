# Channel bible, branch 2 (Bible tab and drafting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner can build, edit, version and restore a channel's bible on its own Bible tab, drafted by AI from their description and VidIQ research, with nothing used until approved, and can move a project onto the latest bible.

**Architecture:** An unsaved draft lives in one `bible_drafts` row per channel, holding the working bible, each section's approval status, overlap flags, the owner's inputs and the research digest. Two Inngest functions write it: a research run (VidIQ calls through a typed MCP client, each costed in a credits ledger and capped monthly) and a drafting run (one LLM call per section, task `bible`, Examples split by craft file). Save validates the draft and appends a `channel_bibles` version through branch 1's `appendBibleVersion`, so versions stay the only thing runners trust. Branch 1's carried items (runner gates, digest skip, slot-pass rules, slot length checks) land first.

**Tech Stack:** TypeScript, Zod 4, Drizzle/Postgres, Inngest, `@modelcontextprotocol/sdk` (new), Next.js server actions and client components, Vitest 4, Playwright, CDK (media-utils Lambda).

**Spec:** `docs/superpowers/specs/2026-10-28-channel-bible-design.md` sections 4.4 to 4.10 (item 2), 5, 6 and 9; section 5 of `docs/superpowers/specs/2026-10-28-vidiq-search-research-design.md` (the VidIQ connection, which spec 4.7 moves into this branch; that file is untracked in the main checkout, copy it into the branch in Task 3's commit); `PROGRESS.md` "Carried to branch 2".

## Global Constraints

- Branch `bible-drafting` from `master` at or after 6a44762. Worktree under `.claude/worktrees/bible-drafting`.
- Migration: one new migration at the next free number on master (0041 as of 6a44762). Compare `packages/db/drizzle/meta/_journal.json` with `origin/master` before merging (memory: migration numbers collide).
- Boom & Busters byte-identical: nothing under `packages/providers/src/prompts/lift/__fixtures__/` changes on this branch. Never run Vitest with `-u` or `--update`. Task 14 checks with `git diff master -- packages/providers/src/prompts/lift/__fixtures__` (empty).
- Mock providers only. No paid LLM or VidIQ call from code or tests. The single exception is Task 4 Step 1, run by the controller session (never a subagent) only after the owner approves it.
- VidIQ: read-only tools only (`balance`, `channel_videos`, `outliers`, `get_videos_by_ids`, `video_transcript`, `keyword_research`, `score_title`). Endpoint `https://mcp.vidiq.com/mcp`, bearer API key. Monthly credit cap default **1,000**. Only the research digest is stored, never a full transcript.
- Bibles are read inside the Inngest step that uses them, via `channelForProject` or `currentBible`, never from an earlier step's output (memory: parked runs replay old step results).
- `'use server'` files export only async functions.
- A new Settings tab adds its actions mock to every test that renders the whole `SettingsForm`: `voice-tab.test.tsx`, `archived-settings.test.tsx`, `brand-look.test.tsx`, `models-tab.test.tsx`, `publishing-tab.test.tsx`, `youtube-outcome.test.tsx` (all in `apps/web/app/(console)/c/[slug]/settings/`).
- Every button is the shared `Button` at its default size (`h-10`, 40 px). Collapsible cards are plain `<details>`, as `models-tab.tsx:274`.
- UI copy: no em or en dashes, South African spelling. Exact copy fixed by the spec is quoted in the tasks; use it verbatim.
- Before every commit: `pnpm format:check` on tracked files (`git ls-files -z '*.ts' '*.tsx' '*.md' '*.json' | xargs -0 -n 80 pnpm exec prettier --check`), `pnpm lint`, `pnpm typecheck`.
- Single-file Vitest runs: `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and never run concurrently with another database suite. Verification commands run in the foreground with the Bash `timeout` at 600000, one package or one e2e batch at a time, never a whole `pnpm test` in one call.
- An implementer who changes a shared schema or prompt runs every consuming package's suite, not only their own (memory: focused suites miss cross-task regressions).
- PROGRESS.md decision numbers: fetch `origin/master` first and take the next free number; renumber only this branch's lines, in a separate commit.

## Review Focus

1. **VidIQ unreachable, or the key is wrong, when the owner asks for an estimate.** The estimate must say "VidIQ did not answer" with the reason and start nothing, rather than throwing or starting a run that fails on its first step. Test in Task 7.
2. **A model answer with the wrong keys.** A drafted section that names a slot id outside its group, adds an unknown field or overruns a slot's `maxLength` is refused by the unit schema, retried once with the error, then shown on the card. It never reaches the draft. Tests in Tasks 6 and 8.
3. **The owner edits a section while a drafting run writes the draft.** The second writer must not silently overwrite the first. Edits and approvals are refused while a job is running, and every draft write takes the row lock. Test in Task 2.
4. **A run that dies midway.** A research or drafting run that fails or is cancelled leaves `job.state = 'running'` unless `onFailure` clears it. The draft must show the failure with **Try again**, and a job running for more than 30 minutes counts as failed. Tests in Tasks 7 and 9.
5. **Owner input that does not parse.** A video link that is not a YouTube video, or a channel typed as a full URL, must be refused or normalised with a message naming it, before credits are estimated. Test in Task 4.

---

### Task 1: Draft shapes, save rules and the overlap check (schemas)

**Files:**
- Create: `packages/schemas/src/bible-draft.ts`, `packages/schemas/src/bible-draft.test.ts`, `packages/schemas/src/bible-overlap.ts`, `packages/schemas/src/bible-overlap.test.ts`
- Modify: `packages/schemas/src/channels.ts` (read schema), `packages/schemas/src/cast.ts` (suffix constant), `packages/providers/src/prompts/cast-identity.ts:30` (use the constant; same bytes), `packages/schemas/src/index.ts`

**Interfaces:**
- Consumes: `ChannelBibleSchema`, `BIBLE_SECTIONS`, `BibleSection`, `EXAMPLE_SLOTS`, `EXAMPLE_SLOT_IDS`, `CAST_GUARDRAIL_MAX`, `BibleExampleEntrySchema`.
- Produces:
  - `ChannelBibleReadSchema = z.object(ChannelBibleSchema.shape)` (strips unknown keys). Reads of stored versions use it; writes keep the strict schema (carried item "strict on write, strip on read").
  - `DEFAULT_GUARDRAIL_SUFFIX = '; never mocked, caricatured or shown in humiliation'` in `cast.ts`; `cast-identity.ts:30` becomes `'[[example:direction-default-guardrail]]' + DEFAULT_GUARDRAIL_SUFFIX`.
  - `bibleProblems(bible: ChannelBible, slotIds?: readonly string[]): string[]`: one message per example over its slot's `maxLength` (`examples.<id> is <n> characters; the limit is <max>`) and one when `examples['direction-default-guardrail'].length + DEFAULT_GUARDRAIL_SUFFIX.length > CAST_GUARDRAIL_MAX`.
  - `type BibleSectionStatus = 'approved' | 'drafted'`; `BIBLE_SECTION_LABELS: Record<BibleSection, string>` = Identity, Voice, Look, Examples, `Hooks, openings and titles`, Search, Publishing; `BIBLE_SECTION_ORDER: readonly BibleSection[]` in that order.
  - `sectionIsEmpty(bible: ChannelBible, section: BibleSection): boolean` (every key in the section is `''`, `[]`, `{}` or null; for `identity`, `caseCategories` empty too).
  - `BibleDraftInputsSchema = { description: string 1..1000, audience: string ≤600, admiredChannels: string ≤200 [] ≤5, videos: string ≤200 [] ≤10, avoid: string ≤600 }`.
  - `ResearchSourceSchema = { videoId: string, channel: string, title: string, own: boolean }`; `BibleResearchDigestSchema = { patterns: { kind: 'title' | 'hook' | 'opening' | 'audience', pattern: string 1..300, quote: string ≤200 | null, sources: ResearchSource[] 1..5 }[] ≤40, videos: { videoId, channel, title, views: number | null, own: boolean }[] ≤60 }`.
  - `type BibleDraftUnit = { section: Exclude<BibleSection, 'examples'> } | { section: 'examples'; source: string } | { section: 'examples'; slotId: string }`; `bibleDraftUnits(sections?: readonly BibleSection[]): BibleDraftUnit[]` returns units in `BIBLE_SECTION_ORDER`, with `examples` expanded to one unit per distinct `EXAMPLE_SLOTS[].source` in registry order; `unitKey(unit): string` (`identity`, `examples:<source>`, `slot:<id>`).
  - `BibleDraftJobSchema = { kind: 'research' | 'draft', state: 'running' | 'done' | 'failed', current: string | null, error: string | null, startedAt: string (ISO) }`; `jobIsRunning(job, now = new Date()): boolean` (running and started under 30 minutes ago).
  - `TooCloseSchema = z.record(z.string(), { source: string, run: string })`, keyed by field path (`examples.<id>`, `hooks.<i>`, `openings.<i>`, `titles.<i>`).
  - `BibleDraftSchema = { channelId, baseBibleId, bible: ChannelBibleSchema, statuses: Record<BibleSection, BibleSectionStatus>, tooClose, errors: Record<string, string> (by unit key), inputs: BibleDraftInputs | null, research: BibleResearchDigest | null, job: BibleDraftJob | null, updatedAt: string }`.
  - `bibleSaveBlockers(draft: BibleDraft): string[]`: `<label> is drafted, not approved` for each non-empty drafted section, `<path> is too close to its source` per flag, then `bibleProblems(draft.bible)`. Empty sections never block (spec 4.6).
  - In `bible-overlap.ts`: `overlapWords(text: string): string[]` (NFKC, lower case, curly quotes to straight, split on `/[^\p{L}\p{N}']+/u`, drop empties); `tooCloseTo(text: string, sources: readonly { label: string; text: string }[], minWords = 8): { source: string; run: string } | null` (first shared run of `minWords` consecutive words; `run` is those words joined by spaces).

- [ ] **Step 1: Write the failing tests**

```ts
test('an eight-word run is too close, seven is not', () => {
  const src = [{ label: 'v1', text: 'Nobody at the bank asked where the money had gone that year' }]
  expect(tooCloseTo('so nobody at the bank asked where the money went', src)).toEqual({ source: 'v1', run: 'nobody at the bank asked where the money' })
  expect(tooCloseTo('nobody at the bank asked where the cash', src)).toBeNull()
})
test('punctuation and case do not hide a copy', () => {
  expect(tooCloseTo('NOBODY, at the bank — asked where the “money” had', [{ label: 'v', text: "nobody at the bank asked where the 'money' had" }])).not.toBeNull()
})
test('a slot over its maxLength and an over-long default guardrail are problems', () => {
  const slot = EXAMPLE_SLOTS[0]
  const long = { ...FIRST_CHANNEL_BIBLE, examples: { ...FIRST_CHANNEL_BIBLE.examples, [slot.id]: 'x'.repeat(slot.maxLength + 1) } }
  expect(bibleProblems(long)).toContain(`examples.${slot.id} is ${slot.maxLength + 1} characters; the limit is ${slot.maxLength}`)
  const guard = { ...FIRST_CHANNEL_BIBLE, examples: { ...FIRST_CHANNEL_BIBLE.examples, 'direction-default-guardrail': 'x'.repeat(CAST_GUARDRAIL_MAX) } }
  expect(bibleProblems(guard).some((p) => p.includes('guardrail'))).toBe(true)
  expect(bibleProblems(FIRST_CHANNEL_BIBLE)).toEqual([])
})
test('a drafted section blocks save, an empty one does not', () => {
  const draft = draftOf(FIRST_CHANNEL_BIBLE, { voice: 'drafted', hooks: 'drafted' }) // hooks lists are empty in the first bible
  expect(bibleSaveBlockers(draft)).toEqual(['Voice is drafted, not approved'])
})
test('a stored version with a key the schema dropped still reads', () => {
  expect(ChannelBibleReadSchema.parse({ ...FIRST_CHANNEL_BIBLE, musicMood: 'x' })).not.toHaveProperty('musicMood')
  expect(ChannelBibleSchema.safeParse({ ...FIRST_CHANNEL_BIBLE, musicMood: 'x' }).success).toBe(false)
})
test('examples expand into one unit per craft file, in registry order', () => {
  const units = bibleDraftUnits(['examples'])
  expect(units.map(unitKey)).toEqual([...new Set(EXAMPLE_SLOTS.map((s) => s.source))].map((s) => `examples:${s}`))
})
test('a job running for over thirty minutes is not running', () => {
  const startedAt = new Date(Date.now() - 31 * 60_000).toISOString()
  expect(jobIsRunning({ kind: 'draft', state: 'running', current: null, error: null, startedAt })).toBe(false)
})
```

`draftOf(bible, statuses)` is a test helper in the test file: every section `approved` unless named.

- [ ] **Step 2: Run** `pnpm exec vitest run bible-draft bible-overlap` in `packages/schemas`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the Produces list. `tooCloseTo` builds a `Set` of source shingles joined by a space, then scans the text's shingles.
- [ ] **Step 4: Run** the two files, then the whole `packages/schemas` suite and `pnpm exec vitest run lift` in `packages/providers` (the suffix constant must leave the fixtures byte-identical). Expected: PASS.
- [ ] **Step 5: Commit** `feat(schemas): the bible draft's shapes, its save rules and the overlap check`.

---

### Task 2: Drafts, the credits ledger and moving a project's bible (db)

**Files:**
- Modify: `packages/db/src/schema.ts` (enum value, two tables), `packages/db/src/bibles.ts` (read with `ChannelBibleReadSchema`; restore), `packages/db/src/projects.ts` (move), `packages/db/src/index.ts`
- Create: `packages/db/drizzle/0041_bible_drafts_vidiq.sql` (generated, next free number), `packages/db/src/bible-drafts.ts`, `packages/db/src/vidiq-credits.ts`, `packages/db/src/bible-drafts.integration.test.ts`, `packages/db/src/vidiq-credits.integration.test.ts`

**Interfaces:**
- Consumes: Task 1's schemas; `appendBibleVersion(tx, channelId, bible, note, options)` (`bibles.ts:34`), `currentBible`, `bibleVersionById`, `monthKey` (`settings.ts:536`).
- Produces:
  - `providerEnum` gains `'vidiq'` (the migration's `ALTER TYPE "public"."provider" ADD VALUE 'vidiq'`, as 0007).
  - Table `bible_drafts`: `channel_id` text pk references `channels` on delete cascade, `base_bible_id` text not null references `channel_bibles`, `bible` jsonb, `statuses` jsonb, `too_close` jsonb, `errors` jsonb, `inputs` jsonb null, `research` jsonb null, `job` jsonb null, `updated_at` timestamptz.
  - Table `vidiq_credits`: `id` ulid pk, `channel_id` not null references `channels`, `project_id` null references `projects` on delete set null, `purpose` text (`'bible-research'` for now), `tool` text, `args` jsonb, `credits` integer, `occurred_at` timestamptz default now.
  - `bible-drafts.ts`:
    - `getBibleDraft(db, channelId): Promise<BibleDraft | null>`.
    - `openBibleDraft(db, channelId): Promise<BibleDraft>` returns the draft, or creates one from the current version with every section `approved`.
    - `writeBibleDraft(db, channelId, change: (draft: BibleDraft) => BibleDraft): Promise<BibleDraft>` locks the row (`SELECT … FOR UPDATE`), applies `change`, parses with `BibleDraftSchema`, writes, all in one transaction. Every draft write goes through it.
    - `discardBibleDraft(db, channelId): Promise<void>`.
    - `saveBibleDraft(db, channelId, note: string): Promise<BibleVersionRow>` runs in one transaction: lock, `bibleSaveBlockers`, strict parse, `appendBibleVersion`, delete the draft. It throws `BibleDraftBlockedError` (exported, `.blockers: string[]`) when blocked, and `BibleDraftBusyError` while `jobIsRunning(draft.job)`.
    - `class BibleDraftBusyError`.
  - `bibles.ts`: `restoreBibleVersion(db, channelId, versionId): Promise<BibleVersionRow>` appends a copy with note `Restored version <n>`. It refuses another channel's version and refuses while a draft exists (throws `BibleDraftExistsError`).
  - `projects.ts`: `moveProjectBible(db, projectId, bibleId): Promise<void>` asserts the version belongs to the project's channel, then sets `projects.bible_id`.
  - `vidiq-credits.ts`: `recordVidiqCredits(db, { channelId, projectId?, purpose, tool, args, credits }): Promise<void>` and `vidiqCreditsThisMonth(db, now = new Date()): Promise<number>`, which is workspace-wide and sums the UTC month of `monthKey(now)`.

- [ ] **Step 1: Write the failing tests** (DB suites, `TEST_DATABASE_URL` gate as `notices.integration.test.ts`):
  - `openBibleDraft` on a channel with no draft copies the current version, all sections `approved`, and `baseBibleId` is the current version's id.
  - `saveBibleDraft` with a drafted Voice throws `BibleDraftBlockedError` whose blockers equal `['Voice is drafted, not approved']`; after approving it, save appends version n+1, moves `current_bible_id`, deletes the draft, and version n's row is unchanged.
  - `saveBibleDraft` and `writeBibleDraft` called from an action path while `job` is running throw `BibleDraftBusyError` (Review Focus 3). Two concurrent `writeBibleDraft` calls that each append one `errors` key both survive.
  - `restoreBibleVersion` appends a copy of version 1 as version 3 with note `Restored version 1`; it refuses a version of another channel and refuses while a draft exists.
  - `moveProjectBible` moves to a newer version of the same channel and refuses another channel's version.
  - `vidiqCreditsThisMonth` counts this month's rows only (insert one row dated last month).
  - `currentBible` reads a version whose stored jsonb carries an extra key (insert via raw SQL) without throwing.
- [ ] **Step 2: Run** `pnpm db:migrate:test` after `pnpm --filter @boom-busters/db generate`, then `pnpm exec vitest run bible-drafts vidiq-credits` in `packages/db`. Expected: FAIL (helpers missing).
- [ ] **Step 3: Implement** the Produces list. `writeBibleDraft` takes an `{ allowWhileRunning?: boolean }` option, true only for the Inngest functions, so actions get `BibleDraftBusyError` while a job runs.
- [ ] **Step 4: Run** both files, then the full `packages/db` suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): bible drafts, restore, moving a project's bible and the VidIQ credits ledger`.

---

### Task 3: VidIQ in Settings, Connections, with the monthly cap

**Files:**
- Modify: `packages/schemas/src/settings.ts` (`PROVIDERS`, `WorkspaceSettingsSchema.vidiq`), `packages/schemas/src/env.ts:245` (`PROVIDER_ENV_SEEDS`), `.env.example`, `packages/db/src/queries.ts` (credential reader), `apps/web/app/(console)/settings/workspace-form.tsx`, `apps/web/app/(console)/settings/workspace-actions.ts`
- Create: `apps/web/app/(console)/settings/vidiq-connection.test.tsx`; copy `docs/superpowers/specs/2026-10-28-vidiq-search-research-design.md` from the main checkout into the branch

**Interfaces:**
- Produces:
  - `'vidiq'` in `PROVIDERS` (not in `LLM_PROVIDERS`); `PROVIDER_ENV_SEEDS.vidiq = 'VIDIQ_API_KEY'`; `.env.example` line `VIDIQ_API_KEY=` under the other provider keys.
  - `WorkspaceSettingsSchema.vidiq = z.object({ monthlyCreditCap: z.number().int().min(0).max(100000).catch(1000) }).catch({ monthlyCreditCap: 1000 })` so stored workspaces without it parse; matching patch schema.
  - `vidiqCredential(db, encryptionKey): Promise<string | undefined>` in `queries.ts`, shaped like `ttsCredential` (undecryptable key reads as missing).
  - Verifying the key is Task 4's, since it needs the client.
  - The Connections card for VidIQ (generated from `PROVIDERS`) gains a "Monthly VidIQ credit cap" number field saved through `saveWorkspaceSettings`, with the hint "Bible research and topic research stop before crossing it."

- [ ] **Step 1: Write the failing tests**: `WorkspaceSettingsSchema.parse({...stored without vidiq})` gives `monthlyCreditCap: 1000`; the Connections tab renders a VidIQ card and the cap field, and saving 500 calls `saveWorkspaceSettings({ vidiq: { monthlyCreditCap: 500 } })`.
- [ ] **Step 2: Run** them (`packages/schemas`, then `apps/web`). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `packages/schemas`, the settings folder of `apps/web` (`pnpm exec vitest run settings`), and `packages/db`'s `queries` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): a VidIQ key and a monthly credit cap under Connections`.

---

### Task 4: The VidIQ client, its fixtures and the research plan (providers)

**Files:**
- Create: `packages/providers/src/vidiq/{client.ts,shapes.ts,plan.ts,mock.ts,index.ts}`, `packages/providers/src/vidiq/fixtures/*.json`, `packages/providers/src/vidiq/{shapes,plan,client}.test.ts`
- Modify: `packages/providers/package.json` (add `@modelcontextprotocol/sdk`, latest release at least two weeks old, exact version), `packages/providers/src/index.ts`, `apps/web/app/(console)/settings/workspace-actions.ts:120` (`verifiableKey` verifies `vidiq` by calling `balance()` on `createVidiqClient(key)`; test with the client module mocked)

**Interfaces:**
- Produces:
  - `interface VidiqCall<T> { data: T; credits: number }` (`credits` from the response's `_credits.used`, else `VIDIQ_CREDIT_COST[tool]`).
  - `VIDIQ_CREDIT_COST = { balance: 0, channelVideos: 5, outliers: 5, getVideosByIds: 5, videoTranscript: 5, keywordResearch: 5, scoreTitle: 5 } as const` (the tools' documented costs, 2026-10-29).
  - `interface VidiqClient`:
    - `balance(): Promise<VidiqBalance>`, where `VidiqBalance` is `{ totalCredits: number; renewableResetsAt: string | null }`.
    - `channelVideos(channel: string): Promise<VidiqCall<VidiqVideo[]>>` calls `vidiq_channel_videos` with `{ channelId: channel, videoFormat: 'long', popular: true }`. The tool accepts a handle.
    - `outliers(args: { keyword: string; language?: string; limit?: number }): Promise<VidiqCall<VidiqVideo[]>>`, with `limit` defaulting to 20.
    - `getVideosByIds(ids: string[]): Promise<VidiqCall<VidiqVideoDetail[]>>`.
    - `videoTranscript(args: { videoId: string; language?: string }): Promise<VidiqCall<VidiqTranscript>>`.
    - `keywordResearch(keyword: string): Promise<VidiqCall<VidiqKeywordRow[]>>` parses the markdown table.
    - `scoreTitle(title: string): Promise<VidiqCall<{ score: number | null }>>`.
    - `close(): Promise<void>`.
  - Shapes in `shapes.ts`. Missing values are kept as `null`, never zero.
    - `VidiqVideo` is `{ videoId, title, channel, channelId: string | null, views: number | null, publishedAt: string | null, breakoutScore: number | null }`.
    - `VidiqVideoDetail` is `VidiqVideo & { description: string | null, tags: string[] | null }`.
    - `VidiqTranscript` is `{ segments: { start: number | null; text: string }[] }`.
    - `VidiqKeywordRow` is `{ keyword, volume: number | null, competition: number | null, overall: number | null }`.
    - `parseVidiqResult(tool, result: { structuredContent?: unknown; content?: { type: string; text?: string }[] }): unknown`: prefer `structuredContent`, else `JSON.parse` of the first text block, else the raw text for `keyword_research`.
  - `createVidiqClient(apiKey: string, options?: { endpoint?: string }): VidiqClient`: the SDK's `Client` over `StreamableHTTPClientTransport(new URL(endpoint ?? 'https://mcp.vidiq.com/mcp'), { requestInit: { headers: { Authorization: \`Bearer ${apiKey}\` } } })`, connected lazily on first call. A tool error surfaces as `VidiqError` (exported; `.tool`, `.message`).
  - `mockVidiqClient(): VidiqClient` serves `fixtures/*.json` through the same parsers.
  - `vidiqClientFor(apiKey: string | undefined): VidiqClient | null` returns the mock when `mockProvidersEnabled()`, null without a key, else the live client.
  - `plan.ts`:
    - `videoIdFromUrl(input: string): string | null` accepts `watch?v=`, `youtu.be/`, `/shorts/`, `/live/` and a bare 11-character id.
    - `channelRefFromInput(input: string): string | null` turns `@handle`, a `youtube.com/@handle` URL or a `/channel/UC…` URL into the handle or id.
    - `planResearch(inputs: BibleDraftInputs, own: { handle: string | null; language: string | null }): ResearchPlan | { error: string }`, where `ResearchPlan` is `{ channels: { ref: string; own: boolean }[], videoIds: string[], outlierKeyword: string, language: string | null }`. It returns `error` naming the first input that does not parse (Review Focus 5).
    - `TRANSCRIPT_CAP = 4`.
    - `estimateResearchCredits(plan): number` is 5 × (channels + (videoIds ? 1 : 0) + 1 + `TRANSCRIPT_CAP`).
    - `transcriptOpening(t: VidiqTranscript, seconds = 60): string` keeps segments starting before `seconds`. Without timings it keeps the first 900 characters.

- [ ] **Step 1 (controller only, owner-approved, about 30 credits): record fixtures.** Through this session's VidIQ MCP tools, call each of the seven tools once on the recon's subjects:
  - `balance`;
  - `channel_videos` for `@boom-busters`;
  - `outliers` on "business collapse documentary";
  - `get_videos_by_ids` for two of the outliers;
  - `video_transcript` for one;
  - `keyword_research` on "wework";
  - `score_title` on "How WeWork Lost $47 Billion".

  Save each raw text response as `fixtures/<tool>.json`. Run `vidiq_balance` before and after, and note the difference in the commit message. If the owner declines, hand-write fixtures from the recon numbers in the VidIQ design's section 3. Mark them `"recorded": false` and keep the shapes nullable.
- [ ] **Step 2: Write the failing tests:**

```ts
test('links and ids resolve, junk is named', () => {
  expect(videoIdFromUrl('https://youtu.be/dQw4w9WgXcQ?t=3')).toBe('dQw4w9WgXcQ')
  expect(videoIdFromUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  expect(videoIdFromUrl('https://vimeo.com/123')).toBeNull()
  expect(channelRefFromInput('https://www.youtube.com/@SomeChannel/videos')).toBe('@SomeChannel')
  expect(planResearch({ ...inputs, videos: ['https://vimeo.com/123'] }, own)).toEqual({ error: 'Not a YouTube video link: https://vimeo.com/123' })
})
test('the estimate counts every call the run will make', () => {
  const plan = planResearch({ ...inputs, admiredChannels: ['@a', '@b'], videos: ['dQw4w9WgXcQ'] }, { handle: '@own', language: 'en' })
  expect(estimateResearchCredits(plan as ResearchPlan)).toBe(5 * (3 + 1 + 1 + 4))
})
test('the mock client parses every fixture into its shape, nulls kept', async () => {
  const c = mockVidiqClient()
  expect((await c.channelVideos('@boom-busters')).data.length).toBeGreaterThan(0)
  expect((await c.getVideosByIds(['x'])).data.some((v) => v.tags === null || Array.isArray(v.tags))).toBe(true)
  expect((await c.keywordResearch('wework')).data[0]).toEqual(expect.objectContaining({ keyword: expect.any(String) }))
})
test('the transcript opening stops at sixty seconds', () => {
  expect(transcriptOpening({ segments: [{ start: 0, text: 'a' }, { start: 59, text: 'b' }, { start: 61, text: 'c' }] })).toBe('a b')
})
test('a tool error becomes a VidiqError naming the tool', async () => { /* parseVidiqResult on an isError result */ })
```

- [ ] **Step 3: Run** `pnpm exec vitest run vidiq` in `packages/providers`. Expected: FAIL.
- [ ] **Step 4: Implement.** Do not test the live transport beyond construction; no test opens a network connection.
- [ ] **Step 5: Run** the three files and the whole `packages/providers` suite. Expected: PASS. Run `pnpm typecheck` (the SDK's ESM types).
- [ ] **Step 6: Commit** `feat(providers): a typed VidIQ client over MCP, with recorded fixtures and a research plan`.

---

### Task 5: Branch 1's carried gates

**Files:**
- Modify:
  - `apps/web/inngest/functions/*-runner.ts`, `slot-*.ts` and `dossier-reviser.ts` (every function that calls `channelForProject` and builds a prompt);
  - `apps/web/inngest/functions/analytics-runner.ts:369`;
  - `packages/providers/src/prompts/rebrief.ts:139` and `redirect.ts:39`;
  - `packages/providers/src/prompts/lift/psychology.test.ts`.
- Test:
  - `apps/web/inngest/functions/script-runner.test.ts` (or that runner's existing harness test);
  - `analytics-runner.test.ts`;
  - `packages/providers/src/prompts/lift/psychology.test.ts`.

**Interfaces:**
- Consumes: `requireCompleteBible(inUse & { slug })` (`apps/web/inngest/lib/channel.ts:13`), `directionRules(inUse)` (`direction-craft-text.ts:47`), `isBibleComplete`.
- Produces:
  - Every prompt-building runner calls `requireCompleteBible` straight after `channelForProject`, inside the same step, so a project frozen to an incomplete version fails with `BIBLE_INCOMPLETE_MESSAGE` and sends no prompt. That message is in `apps/web/lib/bible-gate.ts:6`; the dossier runner already does this.
  - The weekly digest skips a channel whose current bible is incomplete and goes on to the next channel. It does not fail the run.
  - `buildRebriefRequest` and `buildRedirectRequest` append `${directionRules(input.bible)}` after `directionCraft(...)`, as `direction.ts:108`. `retype.ts` carries no direction craft and is left alone (my call: rules without the craft they amend would read out of context).

- [ ] **Step 1: Write the failing tests:**
  - The script runner's harness, with a project frozen to an incomplete version (`EMPTY_BIBLE` saved for a second channel), fails with `BIBLE_INCOMPLETE_MESSAGE` and the LLM mock records zero calls.
  - `analytics-runner`'s digest with two channels, the first incomplete, produces the second channel's digest and does not throw.
  - In `psychology.test.ts`, with `directionRulesMd: 'Never show a patient's face.'`, the rebrief and redirect system prompts contain `This channel's rules` and that line.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** List the runners touched in the commit body.
- [ ] **Step 4: Run** `pnpm exec vitest run lift psychology` in `packages/providers` (the fixtures must not change: `FIRST_CHANNEL_BIBLE.directionRulesMd` is empty, so `channelRulesBlock` returns `''`), then `apps/web`'s `inngest` folder. Expected: PASS, and `git status` shows no fixture file changed.
- [ ] **Step 5: Commit** `fix(inngest): every stage refuses an incomplete frozen bible; the digest skips one; slot passes carry the channel's direction rules`.

---

### Task 6: The `bible` task, drafting and digest prompts, and their mocks (providers)

**Files:**
- Modify: `packages/schemas/src/settings.ts` (`LLM_TASKS`, `ModelRoutingSchema`), the Models tab task labels (`apps/web/app/(console)/c/[slug]/settings/models-tab.tsx`)
- Create: `packages/providers/src/prompts/bible-draft.ts`, `packages/providers/src/prompts/bible-digest.ts`, `packages/providers/src/prompts/bible-mocks.ts`, tests beside each
- Move: `PSYCHOLOGY_TEST_BIBLE` and `FINANCE_WORDS` from `prompts/lift/psychology-bible.ts` into `bible-mocks.ts` (re-export from the old path so the lift tests keep their imports)

**Interfaces:**
- Consumes: Task 1's `BibleDraftUnit`, `BibleDraftInputs`, `BibleResearchDigest`, `BIBLE_SECTIONS`, `EXAMPLE_SLOTS`; `parseJsonCompletion` (`prompts/json.ts:70`); `LLMTaskRequest`.
- Produces:
  - `'bible'` in `LLM_TASKS`; `ModelRoutingSchema.bible = ModelRefSchema.default(DEFAULT_BIBLE_ROUTE)`, where `DEFAULT_BIBLE_ROUTE` equals `DEFAULT_SETTINGS`' scripting route (spec 4.7: scripting tier). A stored routing row without `bible` parses. The Models tab label is "Bible drafting".
  - `bibleUnitSchema(unit: BibleDraftUnit): z.ZodType<Partial<ChannelBible>>`:
    - a section unit is the strict pick of `BIBLE_SECTIONS[section]` from `ChannelBibleSchema`;
    - an `examples` unit is a strict `{ examples: { <id>: string 1..slot.maxLength } }` with exactly that group's (or that one slot's) ids, all required.
  - `buildBibleUnitRequest(input: { unit; channelName: string; inputs: BibleDraftInputs | null; research: BibleResearchDigest | null; draft: ChannelBible; steer?: string; previousError?: string }): LLMTaskRequest` with task `'bible'`. The prompt holds, in this order:
    - the owner's inputs;
    - the digest;
    - the sections already in `draft`;
    - the unit's fields with their descriptions;
    - for an examples unit, each slot's `id`, `teaches` and `kind`;
    - `FIRST_CHANNEL_BIBLE`'s same keys under the heading "An example of shape and level of detail, from another channel. Do not reuse its subjects or words.";
    - for the hooks unit, the rule "Write each entry as this channel's own line for a case it could make. Name the pattern in `note` and list the videos it came from in `drawnFrom`, from the research sources only. Never copy a line from them.";
    - `steer` as "The owner asks: …";
    - `previousError` as "Your last answer was refused: …".

    It asks for JSON only.
  - `parseBibleUnit(unit, text: string): Partial<ChannelBible>` via `parseJsonCompletion(text, bibleUnitSchema(unit), 'bible section')`.
  - `mergeBibleUnit(draft: ChannelBible, unit, answer): ChannelBible` merges `examples` by key and replaces other keys.
  - `buildResearchDigestRequest(input: { channelName; inputs: BibleDraftInputs; videos: BibleResearchDigest['videos']; openings: { videoId: string; text: string }[]; ownLines: string[] }): LLMTaskRequest` with task `'bible'`. Each pattern keeps its source ids, and at most a 200-character quote.
  - `parseResearchDigest(text): BibleResearchDigest`.
  - `mockBibleUnit(unit): Partial<ChannelBible>` answers from `PSYCHOLOGY_TEST_BIBLE`, with two `hooks`, two `openings` and two `titles` entries added to the mock bible for the hooks unit.
  - `mockResearchDigest(inputs): BibleResearchDigest` returns a fixed digest whose sources come from the VidIQ fixtures.

- [ ] **Step 1: Write the failing tests:**
  - For every unit from `bibleDraftUnits()`, `bibleUnitSchema(unit).parse(mockBibleUnit(unit))` passes, and merging all of them into `EMPTY_BIBLE` gives `isBibleComplete(...) === true` with no `FINANCE_WORDS` in any text.
  - An examples answer with an id from another group, an extra key, or an entry over `maxLength` is refused (Review Focus 2).
  - `buildBibleUnitRequest` for `{ section: 'voice' }` contains the example heading, the steer line when given, and none of the psychology words when the draft is empty.
  - The digest schema refuses a 201-character quote.
  - `ModelRoutingSchema.parse(storedWithoutBible).bible` equals `DEFAULT_BIBLE_ROUTE`.
- [ ] **Step 2: Run** `pnpm exec vitest run bible-draft bible-digest bible-mocks` in `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, the whole `packages/providers` suite, `packages/schemas`, and `apps/web`'s `models-tab.test.tsx`. Expected: PASS, fixtures unchanged.
- [ ] **Step 5: Commit** `feat(prompts): the bible task, section drafting and research digest prompts, with mocks`.

---

### Task 7: The research run (Inngest) and its estimate

**Files:**
- Modify: `packages/schemas/src/events.ts` (`EVENT_SCHEMAS`), `apps/web/inngest/events.ts`, `apps/web/inngest/functions/index.ts`
- Create: `apps/web/inngest/functions/bible-researcher.ts`, `apps/web/inngest/functions/bible-researcher.test.ts`, `apps/web/app/(console)/c/[slug]/settings/bible-actions.ts` (research actions only in this task), `apps/web/app/(console)/c/[slug]/settings/bible-actions.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4 and 6; `vidiqCredential`; `WorkspaceSettings.vidiq.monthlyCreditCap`; `channelWriteRefusal` (`lib/channel-lookup.ts:26`); the digest's LLM call path as `analytics-runner.ts` uses it (mock branch on `mockProvidersEnabled()`).
- Produces:
  - The event `bible/research.requested`, `{ channelId: string }`.
  - `estimateBibleResearchAction(channelId: string, inputs: unknown): Promise<{ ok: true; estimate: number; balance: number; capLeft: number } | { ok: false; error: string }>`. It returns an error in four cases:
    - no key: "Add a VidIQ key in Settings, Connections";
    - `planResearch` errors;
    - `balance()` throws: `VidIQ did not answer: <message>` (Review Focus 1);
    - the estimate is above `capLeft` or `balance`: `This run needs about <n> credits; <m> are left of this month's cap of <cap>.`, or `…; the VidIQ balance is <b>.`
  - `startBibleResearchAction(channelId, inputs): Promise<ActionResult>`. It re-runs every check, then calls `writeBibleDraft` to set `inputs` and `job = { kind: 'research', state: 'running', … }`, then sends the event. It refuses while `jobIsRunning`.
  - `bibleResearcher`, with `concurrency: [{ key: 'event.data.channelId', limit: 1 }]` and `retries: 2`. It reads the draft's `inputs` inside its first step, and each VidIQ call is its own step that records credits in `vidiq_credits` inside that step. Its steps are:
    - `plan`;
    - `channel-videos-<i>`, one per planned channel, top 10 kept;
    - `videos-by-ids`, when any;
    - `outliers`;
    - `own-lines`, free: the opening 300 characters of the channel's approved scripts, up to 10, through a db helper `approvedScriptOpenings(db, channelId, limit)` added in this task;
    - `transcript-<videoId>` for the top `TRANSCRIPT_CAP` videos by views across non-own lists, each step returning only `transcriptOpening(...)`. A transcript error is recorded as no opening, not a failed run;
    - `digest`, the `bible` task: one retry with the error, then failure;
    - `save-digest`, which writes `research` and sets `job.state = 'done'`, then sends `bible/draft.requested` for every unit.

    The own channel is included in `planResearch` when `approvedScriptOpenings` returns any line and the channel row has a handle (generalising spec 4.7's "for the first channel").

    `onFailure` sets `job = { state: 'failed', error }` (Review Focus 4).

- [ ] **Step 1: Write the failing tests** (Inngest harness, mock providers, the test database):
  - A run with two admired channels records 4 + `TRANSCRIPT_CAP` ledger rows, whose total equals the estimate. The draft's `research` parses as `BibleResearchDigestSchema`, and no stored field holds a string longer than 900 characters (no transcript stored).
  - Re-running the function from a memoised state after the `outliers` step adds no duplicate ledger rows (restart between steps).
  - A failing digest leaves `job.state === 'failed'` with the message.
  - `estimateBibleResearchAction` without a key, with a `balance()` that throws, and with `vidiqCreditsThisMonth` at 990 of a 1,000 cap returns the three exact errors above.
  - `startBibleResearchAction` while a job runs returns an error and sends nothing.
- [ ] **Step 2: Run** `pnpm exec vitest run bible-researcher bible-actions` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the event to both event lists. The test that keeps them in step must pass.
- [ ] **Step 4: Run** the files and `apps/web`'s `inngest` folder. Expected: PASS.
- [ ] **Step 5: Commit** `feat(inngest): VidIQ research for a bible draft, costed, capped and kept to a digest`.

---

### Task 8: The drafting run (Inngest)

**Files:**
- Modify: `packages/schemas/src/events.ts`, `apps/web/inngest/events.ts`, `apps/web/inngest/functions/index.ts`, `bible-actions.ts`
- Create: `apps/web/inngest/functions/bible-drafter.ts`, `bible-drafter.test.ts`

**Interfaces:**
- Produces:
  - The event `bible/draft.requested`, `{ channelId: string; units: BibleDraftUnit[]; steer?: string }`.
  - `draftBibleAction(channelId, request: { inputs?: unknown; sections?: BibleSection[]; slotId?: string; steer?: string }): Promise<ActionResult>`. It covers **Draft without VidIQ** (inputs, all sections), **Redraft** (one section and an optional steer) and the per-slot **Draft**. It saves `inputs` when given, sets the job, and refuses while `jobIsRunning`. Without inputs and without saved inputs it refuses with "Describe the channel first".
  - `bibleDrafter`, with `concurrency: [{ key: 'event.data.channelId', limit: 1 }]`. It runs one step per unit, `draft-<unitKey>`. Inside each step it:
    - reads the draft;
    - builds the request with the current `draft.bible`, so each unit sees the ones before;
    - calls the `bible` task (`mockBibleUnit` under mocks);
    - parses the answer. On a refusal it calls again once with `previousError`, and on a second refusal it writes `errors[unitKey]` and moves on to the next unit;
    - merges the answer and sets that section's status to `drafted`;
    - clears `errors[unitKey]`;
    - runs the overlap check on every drafted example and hooks, openings and titles entry, and writes `tooClose`.

    The overlap sources are:
    - the digest quotes whose sources are all `own: false`;
    - on any channel other than `FIRST_CHANNEL_ID`, the first channel's current bible `examples` values and hooks, openings and titles texts.

    The channel's own words are never a source (spec 4.7, call 17). The last step sets `job.state = 'done'`. `onFailure` sets `failed`.
  - `job.current` names the unit in progress (its section label), for the tab's progress line.

- [ ] **Step 1: Write the failing tests** (harness, mocks, test DB):
  - Drafting all units into an empty second channel leaves every non-empty section `drafted`, `isBibleComplete(draft.bible)` true, and `bibleSaveBlockers` listing each section.
  - A mocked first answer with a foreign slot id, then a good answer, ends with the good answer and no error. Two bad answers write `errors['examples:<source>']` and the next unit still drafts (Review Focus 2).
  - A drafted hook sharing 8 words with a digest quote from another channel is flagged. The same words from an `own: true` source are not.
  - On a second channel, an example sharing 8 words with Boom & Busters' current bible is flagged.
  - A redraft of `voice` with steer "more clinical" puts "The owner asks: more clinical" into the recorded request and changes only Voice's keys.
- [ ] **Step 2: Run** `pnpm exec vitest run bible-drafter` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, `bible-actions`, and the `inngest` folder. Expected: PASS.
- [ ] **Step 5: Commit** `feat(inngest): draft a bible section by section, with redraft, retries and the overlap check`.

---

### Task 9: The Bible tab, sections, approval and save

**Files:**
- Modify:
  - `apps/web/app/(console)/c/[slug]/settings/page.tsx:22` (`TABS`: `bible` second, after `channel`; loads the draft, versions and `vidiqReady`);
  - `settings-form.tsx` (trigger "Bible" second; props);
  - `channel-tab.tsx` (remove `BibleCard`, keep name and handle, show the status line with a link to the Bible tab);
  - `channel-actions.ts` (`ChannelPatch` loses `bible`; `updateChannelAction` refuses a bible patch);
  - `bible-actions.ts`;
  - `channel-view-fixture.ts`;
  - the six `SettingsForm` tests (add `vi.mock('./bible-actions', …)`).
- Create: `bible-tab.tsx`, `bible-section-card.tsx`, `bible-fields.tsx` (field editors per kind), `bible-tab.test.tsx`
- Move: the categories editor out of `BibleCard` into `bible-fields.tsx`

**Interfaces:**
- Produces:
  - `editBibleSectionAction(channelId, section: BibleSection, patch: unknown): Promise<ActionResult>`. It validates against the strict pick of that section's keys, merges, and sets the status to `approved` (the owner's typing counts as approval). It re-runs the overlap check on the edited example and entry fields: a field that no longer overlaps loses its flag, and one that still does keeps it (my call, so pasting a source back does not pass).
  - `approveBibleSectionAction(channelId, section)` refuses while the section has a `tooClose` flag.
  - `saveBibleAction(channelId, note: string)` maps `BibleDraftBlockedError` to its blockers. The note defaults to "Edited in the Bible tab", or "Drafted with AI" when the draft has `research` or any drafted unit.
  - `discardBibleDraftAction(channelId)`.
  - Every action refuses while `jobIsRunning` with "Wait for the draft to finish" (Review Focus 3), and refuses an archived channel through `channelWriteRefusal`.
  - `BibleTab({ channel, draft, versions, currentVersion, vidiqReady, archived })` renders the seven sections in `BIBLE_SECTION_ORDER` as `<details>` cards. Each card shows:
    - its label and status chip: "Approved", "Drafted, not approved" or "Empty" (the last from `sectionIsEmpty`);
    - the buttons **Redraft**, **Approve** and **Edit**, with **Done** while editing;
    - the section's error from `errors`, if any.
  - In Examples, each slot shows its id, its `teaches` line, "In: <source>" and the text. A slot with no entry shows "New slot, needs an example" and a **Draft** button that drafts that slot alone. A flagged field shows "Too close to its source" with the shared run and the source label, and **Approve** is disabled.
  - Hooks, openings and titles show `text`, `note` and `drawnFrom` as "From: <title> (<channel>)".
  - Under the sections, **Save** is disabled while `bibleSaveBlockers` is non-empty and lists them. **Discard draft** is a `ConfirmButton`.
  - While a job runs, the tab shows "Researching" or "Drafting <section>" and refreshes every 3 seconds (`router.refresh()` on an interval while `jobIsRunning`). A failed job shows its error and **Try again**, which repeats the last request.
  - Channel tab status line: `Bible complete` or `Bible incomplete: <n> missing`, followed by the link "Open the Bible tab" (carried item).

- [ ] **Step 1: Write the failing tests** (`bible-tab.test.tsx`, Testing Library):
  - The statuses render for an approved, a drafted and an empty section.
  - Save is disabled with "Voice is drafted, not approved" listed, and enabled after Approve.
  - A flagged field disables Approve and shows the run.
  - Every button has the `h-10` class.
  - A missing slot shows "New slot, needs an example" and **Draft**.
  - A running job shows "Drafting Voice" and disables Edit.
  - A failed job shows **Try again**.
  - In `channel-tab.test.tsx`, the Bible card is gone and the link points to `?tab=bible`.
- [ ] **Step 2: Run** `pnpm exec vitest run bible-tab channel-tab` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.** The page passes `vidiqReady = mockProvidersEnabled() || (await hasCredential(db, 'vidiq'))` (my call: mocks stand in for the key, as for the other providers).
- [ ] **Step 4: Run** the settings folder (`pnpm exec vitest run settings`). All six `SettingsForm` tests must pass with the new mock. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): the Bible tab, with section approval, save and discard`.

---

### Task 10: Draft with AI

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/draft-with-ai.tsx`, `draft-with-ai.test.tsx`
- Modify: `bible-tab.tsx`, `bible-section-card.tsx` (Redraft with an optional line)

**Interfaces:**
- Consumes: `estimateBibleResearchAction`, `startBibleResearchAction`, `draftBibleAction`.
- Produces:
  - The **Draft with AI** button at the top of the tab opens a card with these fields, using the spec's labels:
    - "Describe the channel in a few lines", prefilled with `<name> (<handle>)`, or the saved inputs;
    - "Who is it for?";
    - "Channels you admire", up to 5 lines;
    - "Videos that feel right", up to 10 lines;
    - "Anything you don't want".
  - The card's buttons are **Research with VidIQ, then draft** and **Draft without VidIQ**.
  - Research first calls the estimate, then shows "About <n> VidIQ credits. Balance: <b>." with **Start** and **Cancel**. Without `vidiqReady` it is disabled with the hint "Add a VidIQ key in Settings, Connections". An estimate error shows in place of the confirm.
  - **Redraft** on a card opens an optional "What should change?" line and sends `draftBibleAction({ sections: [section], steer })`.

- [ ] **Step 1: Write the failing tests:**
  - The confirm shows the exact copy with the mocked estimate 45 and balance 1,474, and **Start** calls `startBibleResearchAction` with the inputs.
  - Without `vidiqReady` the research button is disabled with the hint.
  - An estimate error is shown and **Start** is absent.
  - Six admired channels cannot be entered (the sixth line is refused with "Up to 5 channels").
  - Redraft with "more clinical" calls `draftBibleAction({ sections: ['voice'], steer: 'more clinical' })`.
- [ ] **Step 2: Run** `pnpm exec vitest run draft-with-ai bible-tab`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the settings folder. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): Draft with AI, with the VidIQ estimate shown first`.

---

### Task 11: History and "What the models are told"

**Files:**
- Create: `packages/providers/src/prompts/preview.ts`, `preview.test.ts`, `apps/web/app/(console)/c/[slug]/settings/bible-history.tsx`, `bible-preview.tsx`, tests beside each
- Modify: `bible-actions.ts`, `bible-tab.tsx`

**Interfaces:**
- Consumes: `LIFT_CASES` (`prompts/lift/lift-cases.ts:1291`), `restoreBibleVersion`, `listBibleVersions`, `bibleVersionById`.
- Produces:
  - `PREVIEW_STAGES = ['script', 'shotlist', 'direction', 'graphics', 'metadata', 'dossier'] as const`.
  - `PREVIEW_CASE: Record<PreviewStage, string>` names one `LIFT_CASES` entry per stage (the implementer picks the main builder's case).
  - `composeStagePrompt(stage: PreviewStage, bible: ChannelBible): string` composes that case with `{ bible: previewBible, slotIds: EXAMPLE_SLOT_IDS }`. In `previewBible`, every missing or blank example becomes `[example needed: <id>]`, so an incomplete draft previews instead of throwing.
  - `previewStagePromptAction(channelId, stage: string, bible: unknown): Promise<{ ok: true; text: string } | { ok: false; error: string }>`. It parses with the strict schema and returns the schema error on failure.
  - `restoreBibleVersionAction(channelId, versionId)` maps `BibleDraftExistsError` to "Save or discard the draft first".
  - `BibleHistory` is the **History** button. It lists versions newest first as `Version <n>`, the date (`d MMM yyyy, HH:mm`) and the note, each with **View** and **Restore**. **View** opens the version read-only in a `Dialog`. **Restore** is a `ConfirmButton`.
  - `BiblePreview` is the "What the models are told" card under the sections. It has a stage `<select>` with the six stages, and renders the draft's composed prompt in a scrolling `<pre>`. It re-requests 500 ms after the draft changes or the stage changes.

- [ ] **Step 1: Write the failing tests:**
  - Every `PREVIEW_CASE` name exists in `LIFT_CASES`.
  - `composeStagePrompt(stage, FIRST_CHANNEL_BIBLE)` equals that case's fixture file for each stage (byte-identical).
  - `composeStagePrompt('script', EMPTY_BIBLE)` does not throw and contains `[example needed: script-`.
  - The history lists three versions newest first. Restore calls the action, and a draft-exists error shows "Save or discard the draft first".
  - Changing the stage selector requests the new stage, and the shown text follows the mocked response.
- [ ] **Step 2: Run** `pnpm exec vitest run preview` (providers), then `bible-history bible-preview` (web). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both packages' affected folders. Expected: PASS, fixtures unchanged.
- [ ] **Step 5: Commit** `feat(settings): bible history with restore, and the composed prompt per stage`.

---

### Task 12: Use the latest bible, the start gate's link, the audition fallback

**Files:**
- Modify:
  - `apps/web/app/(console)/projects/actions.ts`;
  - `apps/web/app/(console)/projects/[id]/page.tsx:338-347`;
  - `project-controls.tsx`;
  - `apps/web/lib/bible-gate.ts`;
  - `apps/web/app/(console)/c/[slug]/cases/case-library.tsx:111-115,472-489`;
  - `apps/web/app/(console)/c/[slug]/settings/voice-tab.tsx:41,178`.
- Test: `apps/web/app/(console)/projects/use-latest-bible.test.ts`, `project-controls.test.tsx`, `apps/web/lib/publish-review.test.ts` (or its integration twin), `case-library.test.tsx`, `voice-tab.test.tsx`

**Interfaces:**
- Produces:
  - `useLatestBibleAction(projectId: string): Promise<ActionResult>`. It refuses in two cases:
    - when the channel's current version fails `isBibleComplete(bible, EXAMPLE_SLOT_IDS)`, with "The latest bible is incomplete. Complete it in the Bible tab first." (carried item);
    - when the project already uses the current version, with "This project already uses the latest bible".

    Otherwise it calls `moveProjectBible`.
  - The project page sub-line gains `Bible version <n>`. When the current version is newer, it shows the **Use the latest bible** button with the note "Stages already done keep their text; stages run after this use the new bible." The button is a `useAction` button like `RestartRunButton`.
  - `case-library.tsx`: when the bible is incomplete, the blocked reason is followed by the link "Open the Bible tab" to `/c/<slug>/settings?tab=bible` (multi-channel design 4.5).
  - `voice-tab.tsx`: the fallback when `auditionLine` is blank becomes `NEUTRAL_SAMPLE = 'This is a short sample, read so you can hear the voice before you choose it. Write the channel\'s own audition line in its bible.'`. Boom & Busters' bible already holds `DEFAULT_SAMPLE`'s text, so its audition is unchanged (carried item).

- [ ] **Step 1: Write the failing tests:**
  - **DB-backed action tests.** Moving to a complete v2 works. An incomplete v2 is refused with the message. A second press on the same version is refused.
  - **Publish.** After `moveProjectBible` to a v2 whose disclaimer differs, `descriptionIngredients` returns v2's disclaimer. This is spec 9's "a scheduled upload after Use the latest bible reads the newer disclaimer".
  - **Project controls.** The button and note render only when a newer version exists.
  - **Case library.** A case in an incomplete channel shows the link.
  - **Voice tab.** A blank `auditionLine` shows `NEUTRAL_SAMPLE`, and the first bible's line shows unchanged.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the `projects`, `cases`, `settings` and `lib` folders of `apps/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(projects): Use the latest bible; the start gate links to the Bible tab; a neutral audition line`.

---

### Task 13: Upload category and language

**Files:**
- Modify: `packages/schemas/src/broker.ts:177` (`UploadYoutubeJobSchema`), `apps/web/inngest/functions/publish-runner.ts:366-385`, `infra/lambdas/media-utils/handler.ts:223`
- Test: `packages/schemas/src/broker.test.ts`, `publish-runner.test.ts`, `infra/lambdas/media-utils/handler.test.ts`

**Interfaces:**
- Produces:
  - `UploadYoutubeJobSchema` gains three optional fields:
    - `categoryId?: string /^\d{1,3}$/`;
    - `defaultLanguage?: string ≤12`;
    - `defaultAudioLanguage?: string ≤12`.
  - The publish runner re-reads `channelForProject` inside the submit step. It sends `categoryId` when `bible.youtubeCategoryId` is not null. It sends both language fields from `bible.language` only when the channel is not `FIRST_CHANNEL_ID` and `language` is non-empty (spec 4.8 table, call 8). The first channel's opt-in has no switch yet; it is a one-line change when the owner asks (my call).
  - The handler's `snippet` adds each key only when present, so the body for Boom & Busters is byte-identical: `JSON.stringify` of today's snippet.

- [ ] **Step 1: Write the failing tests:**
  - **Handler, no fields.** Built from a job without the new fields, the request body equals today's snippet exactly.
  - **Handler, with fields.** With `categoryId: '27'` and the language fields, the snippet carries them.
  - **Runner, first channel.** For a first-channel project it submits a job with none of the new keys.
  - **Runner, second channel.** For a second-channel project with category 27 and `language: 'en'` it submits all three.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** Grep the broker Lambda for `MediaJobSchema`. If the broker parses media jobs, it also needs a redeploy; record which stacks need one in PROGRESS "Owner actions at deploy".
- [ ] **Step 4: Run** `packages/schemas`, the `infra` handler tests, and `apps/web`'s `inngest` folder. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): send YouTube category and language from the frozen bible`.

---

### Task 14: End to end, PROGRESS and the branch check

**Files:**
- Create: `e2e/tests/bible.spec.ts`
- Modify: `e2e/tests/channels.spec.ts:80` (fill the second channel's bible through the Bible tab), `PROGRESS.md`

- [ ] **Step 1: Write `bible.spec.ts`** (mock providers), following spec 9's E2E list:
  - On `e2e-second`, open the Bible tab and press **Draft with AI**.
  - Fill the inputs and press **Research with VidIQ, then draft**. See the estimate, then press **Start**.
  - Wait for "Drafted, not approved" on all sections.
  - Redraft Voice with a steer.
  - Approve all, Save, and see `Version 2` in History (version 1 is the empty bible).
  - Start a project from a shortlisted case.
  - Edit Voice, Save, and see version 3.
  - Open the project and see `Bible version 2`. Press **Use the latest bible** and see `Bible version 3`.
  - Run the same tab at 390 px: no horizontal scroll, and the buttons stay 40 px.
- [ ] **Step 2: Run** `pnpm --filter @boom-busters/e2e exec playwright test tests/bible.spec.ts tests/channels.spec.ts` from the e2e package, foreground, timeout 600000 (memory: scope from the e2e package; free port 3100 after an interrupted run). Expected: PASS.
- [ ] **Step 3: PROGRESS.md.**
  - Add a "Channel bible, drafting" section. Clear the "Carried to branch 2" list item by item, naming where each went.
  - Add "Owner actions at deploy":
    - the media-utils CDK deploy, and the broker deploy if Task 13 found it parses media jobs;
    - `PUT /api/inngest`, since there are two new functions;
    - add the VidIQ key and check the cap.
  - Add decisions at the next free numbers, one line each, for this plan's calls:
    - the draft row;
    - the client in providers;
    - the credits table;
    - Examples drafted per craft file;
    - edits re-checked for overlap;
    - Restore refused while a draft exists;
    - the own channel included when it has approved scripts;
    - retype left without rules;
    - the 30-minute stale job;
    - `TRANSCRIPT_CAP` 4;
    - language not sent for the first channel;
    - mocks standing in for the VidIQ key.
- [ ] **Step 4: Branch check.**
  - `git diff master -- packages/providers/src/prompts/lift/__fixtures__` prints nothing.
  - Run each package's suite in turn: `schemas`, `db`, `providers`, `cost`, `apps/web`, `infra` handler tests.
  - Run `pnpm lint`, `pnpm typecheck` and the format check. Expected: all green.
- [ ] **Step 5: Commit** `test(e2e): a second channel's bible drafted, saved, frozen and moved forward` and `docs(progress): the Bible tab and drafting, decisions <n> to <m>`.

Branch 3 (Boom & Busters' hooks) is the owner's run of Draft for the hooks section once this is live; the fixtures are re-captured then, in a commit that says so.
