# VidIQ case research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner adds a case by subject, presses **Research with VidIQ**, picks an angle from a measured search brief, and that brief, frozen onto the project, shapes the dossier, the script outline, titles, description and tags.

**Architecture:** A Zod `SearchBrief` lives on `cases.search_brief` and is copied to `projects.search_brief` when a project starts. A new Inngest function `case-researcher` makes four VidIQ calls (costed through one shared spend helper with the bible researcher) and three model calls, writing progress to `cases.search_job`. Every downstream prompt builder takes an optional `searchBrief` and adds text only when one is present, so a project without a brief, and every Boom & Busters lift fixture, stays byte-identical.

**Tech Stack:** Next.js (App Router, this repo's version: read `apps/web/node_modules/next/dist/docs/` before Next-specific code), Inngest, Drizzle + Postgres, Zod, Vitest, Playwright, the VidIQ MCP client in `@boom-busters/providers/vidiq`.

**Spec:** `docs/superpowers/specs/2026-10-28-vidiq-search-research-design.md`. The owner approved it on 2026-11-02 with these answers: remove **Suggest cases** and retire the case-finder ranking code; score the top 3 titles automatically (**Score all** for the rest); offer a refresh when a brief is over 30 days old; leave the `case-finder-seed-quality` branch alone.

## Global Constraints

- Branch `vidiq-case-research` in `.claude/worktrees/vidiq-case-research`, from master 8c7e279. Never commit to master, push or merge.
- One migration, `0043`, made with `pnpm db:generate` (drizzle-kit). Compare `packages/db/drizzle/meta/_journal.json` with `origin/master` before merging.
- PROGRESS decisions start at **371**; check `origin/master` first and renumber only this branch's lines.
- Boom & Busters byte-identical: no existing file under `packages/providers/src/prompts/lift/__fixtures__/` changes, except the fixtures of builders Task 10 deletes. New brief cases get new fixtures. Never run Vitest with `-u`/`--update` on existing fixtures. `script-craft.md` is not edited (its text is embedded in every script prompt).
- Every brief-dependent prompt line, including blank-line separators, is emitted only when `searchBrief` is non-null.
- Mock providers only. No paid LLM or VidIQ call from code or tests. VidIQ read-only tools only. Estimated credits are shown before any spend; a run whose estimate exceeds the cap left this month (`settings.vidiq.monthlyCreditCap`, default 1,000) or the live balance is refused before any call, with the numbers.
- A keyword that contains a digit or a currency amount is never the target keyword; title and description prompts see such keywords with the figure replaced by `{figure}`. Any figure in a title or description still comes from a claim (decision 303).
- Inngest: anything new is read or computed inside a `step.run`; a field missing from a replayed step result defaults (`?? null`), as `replayedCase` does.
- `'use server'` files export only async functions. A test rendering the whole `SettingsForm`/`WorkspaceForm` mocks every tab's actions.
- Every action is a visible labelled shared `Button` at its default size (40 px); no keyboard-only actions. UI copy: no em or en dashes, South African spelling.
- Before every commit: `git ls-files -z '*.ts' '*.tsx' '*.md' '*.json' | xargs -0 -n 80 pnpm exec prettier --check` (read all output; a warning on an untouched file is CRLF in the working copy, check `git show HEAD:<path> | pnpm exec prettier --check --stdin-filepath <path>`), `pnpm lint`, `pnpm typecheck`.
- Tests: `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and never run concurrently with another database suite; if another session holds the shared test DB, use this worktree's own database. Every verification command in the foreground with the Bash `timeout` 600000; never a whole apps/web suite in one call (run `inngest`, `app`, `lib components` separately). A change to `packages/schemas` runs the schemas, db, providers and web suites. e2e from `e2e/`: `pnpm exec playwright test <files>`; never stop a Playwright run part-way (it orphans the dev server on port 3100).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A subject VidIQ barely knows** (few or no keyword rows, no outliers). The run completes with a brief that says so (empty lists, no target keyword) and offers angle options from the subject and the bible alone; it never fails or invents volumes. Test in Task 5.
2. **VidIQ unreachable or the key refused mid-run.** The case row shows the failure with **Try again**; credits already spent stay in the ledger; nothing is half-written to `cases.search_brief`. Test in Task 5.
3. **The owner edits the case's subject after research.** The brief belongs to the old subject: the row says the research is for a different subject and offers **Research with VidIQ** again; a project started meanwhile freezes no brief. Test in Task 6.
4. **Every keyword carries a figure** (all rows like "$47 billion to bankruptcy"). No target keyword is chosen; the brief keeps them as secondary keywords and tags; titles still get no figure that is not in a claim. Test in Task 1.
5. **The cap is reached between the estimate and a later VidIQ call.** The run stops on that call with the cap message, the job shows it, and no further call is made. Test in Task 5.

---

### Task 1: The search brief schema and its rules (schemas)

**Files:**
- Create: `packages/schemas/src/search-brief.ts`, `packages/schemas/src/search-brief.test.ts`
- Modify: `packages/schemas/src/index.ts` (export it)

**Interfaces:**
- Produces:
  - `SearchKeywordSchema` / `SearchKeyword`: `{ keyword: string; volume: number|null; competition: number|null; overall: number|null; estimatedMonthlySearch: number|null; growthPct: number|null }`.
  - `SearchOutlierSchema` / `SearchOutlier`: `{ videoId: string; title: string; channel: string|null; subscribers: number|null; views: number|null; breakoutScore: number|null; publishedAt: string|null; tags: string[] }`.
  - `AngleOptionSchema` / `AngleOption`: `{ angle: string (20 to 400 chars); keyword: string; answers: string[] (searched questions it answers, max 5); gap: string (max 300) }`.
  - `SearchBriefSchema` / `SearchBrief`: `{ subject: string; measuredAt: string (datetime); targetKeyword: SearchKeyword|null; secondaryKeywords: SearchKeyword[] (max 10); searchedQuestions: string[] (max 10); outliers: SearchOutlier[] (max 10); titlePatterns: string[] (max 5); toldAlready: string[] (max 8); angleOptions: AngleOption[] (max 3); chosenAngle: number|null }`.
  - `CaseResearchJobSchema` / `CaseResearchJob`: `{ state: 'running'|'done'|'failed'; current: string|null; error: string|null; startedAt: string; heartbeatAt?: string; subject: string }` and `caseResearchJobIsRunning(job, now?: Date): boolean` (30 minutes from `heartbeatAt ?? startedAt`, as `jobIsRunning` in `bible-draft.ts`).
  - `keywordHasFigure(keyword: string): boolean`, `maskFigures(keyword: string): string`, `chooseTargetKeyword(rows: readonly SearchKeyword[], subject: string): SearchKeyword|null`, `briefDemandNotes(brief: SearchBrief): string`, `briefIsStale(brief: SearchBrief, now?: Date): boolean` (over 30 days), `SEARCH_BRIEF_STALE_DAYS = 30`, `CASE_RESEARCH_CREDITS = 20`.

- [ ] **Step 1: Write the failing tests** in `search-brief.test.ts`:
  - `keywordHasFigure`: true for `'how wework went from $47 billion to bankruptcy'`, `'wework 2019'`, `'€1.9 billion'`; false for `'wework documentary'`.
  - `maskFigures('how wework went from $47 billion to bankruptcy')` is `'how wework went from {figure} to bankruptcy'`; a phrase with no figure comes back unchanged.
  - `chooseTargetKeyword`, with the recon rows (`'wework documentary'` overall 63, `'the rise and fall of wework'` overall 50, `'how wework went from $47 billion to bankruptcy'` overall 70), returns `'wework documentary'`: the figure row is excluded despite the higher score. On an overall tie, `'what happened to wework'` beats `'wework office'` (it names the subject and reads as a documentary search: `documentary`, `what happened to`, `rise and fall of`, `story`, `collapse`, `bankruptcy`). It returns `null` when every row carries a figure (Review Focus 4) or the list is empty.
  - `briefDemandNotes` produces `'wework documentary: 64 volume, competition 38; 6 winning videos, best 172,000 views at 40x'` from a fixture brief (target keyword, outlier count, the best outlier's views and breakout score). With no target keyword it produces `'No searched keyword measured; N winning videos'`.
  - `briefIsStale` is false at 30 days and true at 31.
  - `SearchBriefSchema.parse` accepts the fixture and refuses a fourth angle option; `CaseResearchJobSchema` parses a job without `heartbeatAt`.
- [ ] **Step 2: Run** `pnpm exec vitest run search-brief` from `packages/schemas`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `search-brief.ts`. A figure is any digit, or a currency symbol (`$ € £ R`) followed by a digit. Masking replaces each maximal run of a currency symbol, digits, separators and an optional scale word (`million|billion|bn|m|k`) with `{figure}`.
- [ ] **Step 4: Run** the test, then the schemas suite in full. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schemas): the search brief, its target keyword rule and freshness`.

### Task 2: The VidIQ client reads what the brief needs (providers)

**Files:**
- Modify: `packages/providers/src/vidiq/client.ts`, `shapes.ts`, `costs.ts`, `mock.ts`, `fixtures/README.md`
- Create: `packages/providers/src/vidiq/fixtures/keyword-questions.ts` (a recorded-shape `questions` table, embedded like `keyword-research.ts`)
- Test: `client.test.ts`, `shapes.test.ts`, `mock` tests

**Interfaces:**
- Consumes: the existing `VidiqClient` and `VidiqCall<T>` (`{data, credits, args}`).
- Produces (changed signatures; update the bible researcher's call sites to match, keeping its wire arguments identical):
  - `keywordResearch(keyword: string, options?: { mode?: 'matching_terms'|'questions'; limit?: number }): Promise<VidiqCall<VidiqKeywordRow[]>>`. The default is `{ mode: 'matching_terms', limit: 8 }`, today's call.
  - `VidiqKeywordRow` gains `estimatedMonthlySearch: number|null` and `growthPct: number|null`, read from the `estimatedMonthlySearch` and `searchDemandGrowthPct` columns.
  - `outliers(args: { keyword: string; language?: string; limit?: number; requireAllTitleTerms?: boolean; publishedWithin?: 'allTime'|'year'|'month' })`. Each new key is sent only when given.
  - `VidiqVideo` gains `subscribers: number|null`, read from the outliers data.
  - `scoreTitle(args: { title: string; channelId?: string; type?: 'long'|'short' })`. `type` defaults to `'long'`; `channelId` is sent only when given.

- [ ] **Step 1: Write the failing tests:**
  - `keywordResearch('wework', { mode: 'questions', limit: 10 })` sends exactly `{ keyword: 'wework', mode: 'questions', limit: 10 }` and parses the questions table.
  - The default call still sends `{ keyword, mode: 'matching_terms', limit: 8 }`.
  - The parsed `wework documentary` row has `estimatedMonthlySearch` and `growthPct` from the fixture.
  - `outliers({ keyword: 'wework', requireAllTitleTerms: true, publishedWithin: 'allTime', limit: 25 })` sends those keys.
  - The parsed outliers carry `subscribers`.
  - `scoreTitle({ title: 'x', channelId: 'UCzg' })` sends `{ title: 'x', type: 'long', channelId: 'UCzg' }`.
  - The mock client answers a `questions` call with the questions fixture.
- [ ] **Step 2: Run** `pnpm exec vitest run vidiq` from `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the column names from the recorded fixtures, not from memory. The mock branches on `args.mode`.
- [ ] **Step 4: Run** the providers suite and the web `bible-researcher` test. Expected: PASS, with the bible research ledger arguments unchanged.
- [ ] **Step 5: Commit** `feat(providers): VidIQ keyword questions, demand columns, outlier filters and channel-aware title scores`.

### Task 3: Brief columns, the frozen copy and subject uniqueness (db)

**Files:**
- Modify: `packages/db/src/schema.ts` (`cases`: `searchBrief` jsonb nullable `$type<SearchBrief>()`, `searchJob` jsonb nullable `$type<CaseResearchJob>()`; `projects`: `searchBrief` jsonb nullable), `packages/db/src/cases.ts`, `packages/db/src/projects.ts`
- Create: migration `packages/db/drizzle/0043_*.sql` via `pnpm db:generate`
- Test: `packages/db/src/cases.integration.test.ts` (or the existing cases integration test), `projects` integration test

**Interfaces:**
- Produces:
  - `CaseSummary` and `summaryColumns` gain `searchBrief: SearchBrief|null` and `searchJob: CaseResearchJob|null`, both parsed on read with `.nullable().catch(null)`.
  - `caseSubjectTaken(db, channelId: string, subject: string, exceptId?: string): Promise<boolean>` compares case-insensitively and trimmed.
  - `writeCaseResearchJob(db, caseId: string, update: (job: CaseResearchJob|null) => CaseResearchJob|null): Promise<CaseResearchJob|null>` locks the row (`for update`).
  - `saveCaseSearchBrief(db, caseId: string, brief: SearchBrief, jobStartedAt: string): Promise<boolean>`. It writes the brief and marks the job `done` only while `searchJob.startedAt === jobStartedAt`, in one transaction; it returns false otherwise.
  - `chooseCaseAngle(db, caseId: string, choice: { option: number } | { own: string }): Promise<CaseSummary>` writes `cases.angle` (the option's angle or the owner's text), `searchBrief.chosenAngle` (the index, or null for their own angle) and `demandNotes = briefDemandNotes(brief)`.
  - `setCaseTargetKeyword(db, caseId: string, keyword: string): Promise<CaseSummary>` moves the chosen secondary keyword to `targetKeyword` and the old target into the secondaries. It refuses a keyword with a figure.
  - `createProjectFromCase(db, { caseId, title, targetRuntimeMin?, bibleId? })` copies `cases.search_brief` into `projects.search_brief` in the same transaction as the insert, only when `brief.subject` equals the case's current subject (Review Focus 3).
  - `ProjectSummary` gains `searchBrief: SearchBrief|null`.

- [ ] **Step 1: Write the failing integration tests:**
  - `caseSubjectTaken` is true for `' WeWork '` against `'wework'` in the same channel, and false in another channel or for the case itself.
  - `saveCaseSearchBrief` refuses a stale `jobStartedAt` and leaves the brief null.
  - `chooseCaseAngle` writes the angle, `chosenAngle` and the demand notes line.
  - `setCaseTargetKeyword` swaps the keywords and refuses a figure keyword.
  - `createProjectFromCase` freezes the brief, and a later case edit does not change the project's copy.
  - A brief whose `subject` differs from the case's subject is not frozen.
  - A row written before the migration reads `searchBrief: null`.
- [ ] **Step 2: Run** `pnpm exec vitest run cases projects` from `packages/db`. Expected: FAIL.
- [ ] **Step 3: Implement the columns, run `pnpm db:generate`, and implement the functions.** Check that the generated SQL only adds three nullable columns.
- [ ] **Step 4: Run** the db suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): the search brief on cases and frozen on projects, its research job, and one case per subject`.

### Task 4: The brief's three model steps (providers prompts)

**Files:**
- Create: `packages/providers/src/prompts/search-brief.ts`, `search-brief.test.ts`; mocks in the same file
- Modify: `packages/providers/src/prompts/index.ts`, `lift/lift-cases.ts` (three new cases with new fixtures)

**Interfaces:**
- Consumes: `SearchKeyword`, `SearchOutlier`, `AngleOption`, `BibleInUse`.
- Produces (task `'research'`; each parser returns the answer-helper shape the other passes use, with `repairs`):
  - `buildKeywordFilterRequest(input: { subject: string; rows: readonly SearchKeyword[] }): LLMTaskRequest`, then `parseKeywordFilter(text, rows): string[]`. It returns the kept keywords, a subset of `rows` only; an unknown keyword is dropped and repaired.
  - `buildWinnersRequest(input: { subject: string; outliers: readonly SearchOutlier[]; descriptions: Record<string, string> }): LLMTaskRequest`, then `parseWinners(text): { titlePatterns: string[]; toldAlready: string[] }`. Patterns use `{subject}` and `{figure}`; a pattern with a raw digit is dropped and repaired.
  - `buildAngleOptionsRequest(input: { bible: BibleInUse; subject: string; angleIdea: string|null; targetKeyword: string|null; secondaryKeywords: readonly string[]; searchedQuestions: readonly string[]; toldAlready: readonly string[] }): LLMTaskRequest`, then `parseAngleOptions(text, input): AngleOption[]` (2 or 3 options). An option whose angle contains a digit not present in the inputs is dropped and repaired (anti-goal: angles are directions, not facts). When `angleIdea` is given, the system text requires that the first option develops it.
  - `mockKeywordFilter`, `mockWinners`, `mockAngleOptions`.

- [ ] **Step 1: Write the failing tests:**
  - `parseKeywordFilter` keeps only listed rows.
  - `parseWinners` drops `'From $818 Million to Nothing: {subject}'` but keeps `'From {figure} to Nothing: How {subject} Lost Everything'`.
  - `parseAngleOptions` drops an option stating `'lost $47 billion'` when no input has 47, keeps at most 3, and refuses fewer than 2 (an answer the helper retries).
  - With `angleIdea`, the system text contains the line that the first option develops the owner's idea; without it, that line is absent.
  - Add the three lift cases with `FIRST_CHANNEL_IN_USE` and write their new fixtures.
- [ ] **Step 2: Run** `pnpm exec vitest run search-brief lift` from `packages/providers`. Expected: FAIL, then only the new fixtures are written. Confirm with `git status` that no existing fixture changed.
- [ ] **Step 3: Implement** the prompts in the style of `cases.ts` and `dossier.ts`.
- [ ] **Step 4: Run** the providers suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prompts): keyword filter, winning-video patterns and angle options for a search brief`.

### Task 5: The case research run, its estimate and one VidIQ spend path (web, Inngest)

**Files:**
- Create: `apps/web/lib/vidiq-spend.ts` (+ test), `apps/web/inngest/functions/case-researcher.ts` (+ test)
- Modify: `apps/web/inngest/functions/bible-researcher.ts` and `apps/web/app/(console)/c/[slug]/settings/bible-actions.ts` (use the shared helpers; their behaviour and copy are unchanged), `packages/schemas/src/events.ts`, `apps/web/inngest/events.ts`, `apps/web/inngest/functions/index.ts`, `apps/web/app/(console)/c/[slug]/cases/actions.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces:
  - In `apps/web/lib/vidiq-spend.ts`:
    - `checkVidiqBudget(estimate: number): Promise<{ ok: true; balance: number; capLeft: number } | { ok: false; error: string }>`. This is the cap-then-balance check lifted from `checkResearch`, with the same copy: "Add a VidIQ key in Settings, Connections", "VidIQ did not answer: …", "This run needs about N credits; M are left of this month's cap of C.", "This run needs about N credits; the VidIQ balance is B."
    - `spendVidiq<T>(input: { channelId: string; projectId?: string; purpose: 'bible-research'|'case-research'|'title-score'; cost: number }, call: (client: VidiqClient) => Promise<VidiqCall<T>>): Promise<VidiqCall<T>>`. This is the per-call cap check, then the call, then `recordVidiqCredits` with `result.args`. It is lifted from `bible-researcher`'s `spend()`, with the same copy: "The VidIQ cap is reached: X of C credits used this month", raised as a `NonRetriableError`.
  - Event `case/research.requested`: `{ caseId: Ulid, jobStartedAt: datetime }`. Schema in `packages/schemas/src/events.ts`, bound in `apps/web/inngest/events.ts`, registered in `functions/index.ts`.
  - Function `case-researcher`. Concurrency is one run per `event.data.caseId`. It has `onFailure`, which marks the job failed when it still owns it. Steps, each beating `heartbeatAt` and checking ownership as `bible-researcher` does:
    1. `keywords-terms`: `keywordResearch(subject, { mode: 'matching_terms', limit: 20 })`.
    2. `keywords-filter`: model; under mock, `mockKeywordFilter`.
    3. `keywords-questions`: `keywordResearch(subject, { mode: 'questions', limit: 10 })`.
    4. `outliers`: `outliers({ keyword: subject, requireAllTitleTerms: true, publishedWithin: 'allTime', limit: 25 })`.
    5. `outlier-details`: `getVideosByIds` on the top 10 by `breakoutScore`. Skipped with no outliers.
    6. `winners`: model.
    7. `angles`: model, with the channel's current bible from `currentBible` (a case has no frozen one).
    8. `save-brief`: `chooseTargetKeyword`, then `saveCaseSearchBrief`.

    Steps 1, 3, 4 and 5 use `spendVidiq` with purpose `'case-research'`. Only the brief's digest-sized fields are stored: no transcripts and no full descriptions.
  - Action `researchCaseAction(caseId: string): Promise<{ ok: true } | { ok: false; error: string }>` in `cases/actions.ts`. It checks, in order: owner, case exists and not retired, channel not archived, `checkVidiqBudget(CASE_RESEARCH_CREDITS)`, and no running job (`caseResearchJobIsRunning`, refused with "Research is already running for this case"). Then it stamps the job (`subject` = the case's subject) and sends the event. On a send failure it marks the job failed with the same Inngest copy `startBibleResearchAction` uses.
  - Action `caseResearchEstimate(caseId: string): Promise<{ ok: true; credits: number; capLeft: number; balance: number } | { ok: false; error: string }>`, for the button label.

- [ ] **Step 1: Write the failing tests:**
  - `vidiq-spend.test.ts`: cap refusal before any call; balance refusal; the ledger row carries `purpose` and the wire `args`; a throwing call writes no row.
  - `case-researcher.test.ts` (mock providers, the `@inngest/test` pattern of `bible-researcher.test.ts`):
    - A full run saves a brief with a target keyword, 10 or fewer of each list, and two or three angle options. The ledger gets four rows, totalling 20 credits.
    - Review Focus 1: empty keyword and outlier answers save a brief with `targetKeyword: null`, empty lists, and still two angle options.
    - Review Focus 2: a `VidiqError` on `outliers` fails the job with its message; the earlier two ledger rows remain; `cases.search_brief` stays null.
    - Review Focus 5: the cap is reached at `outlier-details`, so the job fails with the cap message and no fifth call is made.
    - A run that lost ownership writes nothing.
  - `cases/actions.test.ts`: the estimate and cap refusals come before the stamp; a second press while running is refused; an Inngest send failure marks the job failed.
  - The existing `bible-researcher` and `bible-actions` tests still pass unchanged.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**, then refactor the bible researcher and bible actions onto the shared helpers.
- [ ] **Step 4: Run** the web `inngest` and `app` directories, then `lib`. Expected: PASS.
- [ ] **Step 5: Commit** in two parts: `refactor(web): one VidIQ budget check and spend path for every caller`, then `feat(inngest): Research with VidIQ for a case, costed, capped and kept to a brief`.

### Task 6: The case row: subject first, research, brief, angle and the start check (web UI)

**Files:**
- Modify: `apps/web/app/(console)/c/[slug]/cases/case-library.tsx`, `cases/actions.ts`, `cases/page.tsx`, `case-library.test.tsx`, `actions.test.ts`
- Create: `apps/web/app/(console)/c/[slug]/cases/search-brief-panel.tsx` (+ test)

**Interfaces:**
- Consumes: Task 3 db functions; Task 5 actions.
- Produces, in `cases/actions.ts`:
  - `chooseAngleAction(caseId: string, choice: { option: number } | { own: string }): Promise<ActionResult>`
  - `setTargetKeywordAction(caseId: string, keyword: string): Promise<ActionResult>`
  - `addCase` and `editCase` refuse a duplicate subject with "A case for this subject already exists".
  - `startProjectFromCase(id, targetRuntimeMin?)`, unchanged in shape. The project freezes the brief through `createProjectFromCase`. The stale-brief check lives in the UI; the action never refreshes.

UI rules, button-first, with exact labels:
- **Add case form.** It leads with **Subject** (required, as searched, e.g. "Iomega"), then **Angle idea** (optional, the owner's words, stored as `angle` until a brief option is chosen), then the existing fields (category, title, people, source links; no new competitor-links field).
  - The title defaults from the subject, the reverse of how `subjectFromTitle` works today.
  - The **Priority** field is removed; new cases write `priorityScore` 0.
- **Row facts.** They no longer show `priority N`, and the **Priority** sort button is removed (`CASE_SORTS` keeps `'priority'` so old URLs still parse, but the default sort is `newest`).
- **Research button.** **Research with VidIQ (about 20 credits)** is a `ConfirmButton`, so the confirm step shows the estimate, cap left and balance from `caseResearchEstimate`.
  - While the job runs, the row shows `Researching: <current step label>` and polls every 3 s, as the Bible tab does.
  - A failed or stale job shows its error and **Try again**.
- **Brief panel.** Once a brief exists, the row gets a **Search brief** panel (a plain `<details>`, collapsed by default) showing:
  - the measured date;
  - the target keyword with its numbers;
  - the secondary keywords, each with **Make target** (absent on figure keywords);
  - the searched questions;
  - the outliers (title, channel, views, breakout);
  - what's told already;
  - the angle options, each with **Use this angle**, plus **Keep my own angle**.

  The chosen option is marked.
- **Subject mismatch.** When `brief.subject` differs from the case's subject, the panel says "This research is for <old subject>. Research again for <new subject>." and the research button reads **Research again with VidIQ (about 20 credits)** (Review Focus 3).
- **New project.** When the brief is older than 30 days, **New project** opens an inline panel: "The search research is N days old." It offers **Refresh research (about 20 credits)**, which starts the run and starts no project, and **Start without refreshing**. With a fresh or absent brief it starts directly, as today.

- [ ] **Step 1: Write the failing component and action tests:**
  - The subject-first add form.
  - The duplicate-subject refusal.
  - The research button and its running, failed and Try again states.
  - The brief panel: **Use this angle** calls `chooseAngleAction(id, { option: 1 })`; **Make target** is hidden on a figure keyword.
  - The subject mismatch copy.
  - The stale-brief start panel and both of its buttons.
  - `priority` not rendered.
  - A frozen brief on the project started.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the `app` directory of apps/web. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cases): subject-first intake, Research with VidIQ, the search brief and the angle choice`.

### Task 7: The brief in the dossier (prompts, render, runner, reviser)

**Files:**
- Modify: `packages/providers/src/prompts/dossier.ts` (`CaseContext` gains `searchBrief?: SearchBrief|null`; `caseHeader`; `buildBriefRequest`), `dossier-render.ts`, `apps/web/inngest/lib/dossier-research.ts` (its `CaseContext`), `apps/web/inngest/functions/dossier-runner.ts`, `dossier-reviser.ts`, `lift/lift-cases.ts` (new brief cases)
- Test: `dossier.test.ts`, `dossier-render.test.ts`, `dossier-runner.test.ts`, `dossier-reviser.test.ts`, lift

**Interfaces:**
- Consumes: `projects.searchBrief` via `getProject` (Task 3).
- Produces:
  - **`caseHeader`, when a brief exists.** It appends these lines after the existing ones:
    - "What viewers search for (answer these where the record allows; never answer one from the keyword):"
    - `Target search: <keyword>`
    - `Searched questions:` followed by one question per line.
  - **`buildBriefRequest`, when a brief exists.** It adds the rule: "Searched questions are candidates for `openQuestions`: keep each one the documents can address; a question the record cannot answer stays open and is never answered from the keyword."
  - **`renderDossierMarkdown`.** It takes `searchBrief?: SearchBrief|null` and, when present, emits a `## Search` section after `## Told already`. The section holds the target keyword, then each searched question marked `answered` or `open`. A question is answered when it appears among `brief.openQuestions` and has an entry in `research.answers`; it is open otherwise.
  - **Runner and reviser `load-case`.** Each returns `searchBrief: project.searchBrief`. The `caseContext` literal reads `searchBrief: loaded.searchBrief ?? null`, which covers results replayed from before the change.
  - **Competitor links.** The outlier watch URLs (`https://www.youtube.com/watch?v=<id>`) are appended to the `competitorLinks` passed to the gather, deduplicated by video id.
- [ ] **Step 1: Write the failing tests:**
  - Brief-free requests equal today's: assert the existing lift fixtures are untouched.
  - The header lines and the brief rule appear only with a brief.
  - The Search section's answered and open marking.
  - The runner passes the brief and the outlier URLs. A replayed `load-case` without `searchBrief` runs as before.
  - New lift cases `dossier-brief-search`, `dossier-header-search`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the providers suite and web `inngest`. Expected: PASS, and `git status` shows no existing fixture changed.
- [ ] **Step 5: Commit** `feat(dossier): the search brief's keyword and questions guide the research and close the dossier`.

### Task 8: The brief in the script outline

**Files:**
- Modify: `packages/providers/src/prompts/script.ts` (`buildOutlineRequest` input gains `searchBrief?: SearchBrief|null`), `apps/web/lib/script-answers.ts` (passes it through), `apps/web/inngest/functions/script-runner.ts` (the `outline` step reads `getProject(db, projectId).searchBrief` inside the step), `lift/lift-cases.ts`
- Test: `script.test.ts`, `script-runner.test.ts`, lift

**Interfaces:**
- Produces, only when a brief exists:
  - **In the system text, after the `centralQuestion` rule.** A block of three rules:
    - "The central question is one a person searching \"<target keyword>\" would recognise as theirs."
    - "Name <subject> in the first 30 seconds of narration."
    - "The phrase \"<target keyword>\" may be spoken once where it is natural; never repeat it, or bend a sentence toward it, for search."
  - **In the user message, after the dossier.** `Searched questions:` with one per line.
  - **No keyword.** With a brief but no target keyword, only the subject line and the questions are emitted.
- [ ] **Step 1: Write the failing tests:**
  - Brief-free outline requests are unchanged.
  - The three rules appear with a brief; the keyword rules are absent without a target keyword.
  - The runner reads the brief inside the step.
  - New lift case `script-outline-search`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the providers suite and web `inngest` and `lib`. Expected: PASS, with no existing fixture changed.
- [ ] **Step 5: Commit** `feat(script): the outline answers what searchers ask, without writing for the algorithm`.

### Task 9: Titles, description and tags from the brief, and VidIQ title scores (prompts, publish)

**Files:**
- Modify: `packages/providers/src/prompts/metadata.ts`, `packages/schemas/src/publish.ts` (`PublishDraftSchema` gains `titleScores: z.record(z.string(), z.number().nullable()).default({})` and `searchTags: z.array(z.string()).default([])`), `apps/web/app/(console)/projects/[id]/publish-actions.ts`, `publish-screen.tsx`, `apps/web/lib/publish-review.ts`, `lift/lift-cases.ts`
- Create: `apps/web/lib/search-tags.ts` (+ test)
- Test: `metadata.test.ts`, `publish-actions.test.ts`, `publish-screen` tests, lift

**Interfaces:**
- Consumes: `projects.searchBrief`, read in each action alongside `completeFrozenBible`; `spendVidiq` (Task 5); `maskFigures` (Task 1).
- Produces:
  - **`buildTitlesRequest` input gains `searchBrief?: SearchBrief|null`.** With a brief:
    - For a master, it adds the target keyword, two secondary keywords (figures masked) and the `titlePatterns`, and the rule "At least half the titles contain \"<target keyword>\" or <subject> as people search it; any figure still comes only from the claims."
    - For a short, it adds the target keyword only.
  - **`buildDescriptionRequest` input gains `searchBrief?: SearchBrief|null`.** With a brief it adds:
    - the target keyword, the secondary keywords (masked) and the searched questions;
    - the rule that the target keyword appears in the first 150 characters;
    - the body shape: an opening dated scene with a figure from the claims, a line saying this is the full story, a closing comment question.
  - **Tags.** `searchTags(brief: SearchBrief, cast: readonly string[]): string[]` in `apps/web/lib/search-tags.ts`. It returns, in order:
    1. the target keyword and the secondary keywords, in brief order;
    2. tags that appear on at least two outliers and mention the subject, a cast name or a year in the brief, plus "business documentary" when any outlier has it;
    3. the cast names.

    The list is deduplicated case-insensitively. `generateDescription` then joins `joinTags(ownerTags, [...searchTags(brief, cast), ...answer.tags])` and stores `searchTags` on the draft.
  - **Title scores.** After `generateTitles` for a master with a brief and a VidIQ key, it scores the model's first three titles. Each score is a `spendVidiq` call with purpose `'title-score'`, cost 5 each, `channelId` the channel's YouTube channel id when connected, checked with `checkVidiqBudget(15)` first, and stored in `titleScores`.
    - A refusal or failure keeps the titles and stores no scores; a note under the list says why.
    - Action `scoreAllTitlesAction(targetType, targetId)` scores the unscored rest after `checkVidiqBudget(5 × count)`.
  - **Publish screen.**
    - Each title option shows `VidIQ score N` when it has one.
    - A **Score all titles (about N credits)** `ConfirmButton` appears when some are unscored and a brief exists.
    - Tags that came from `searchTags` carry a `from VidIQ` marker.
- [ ] **Step 1: Write the failing tests:**
  - Brief-free titles and description requests are byte-identical: the 12 metadata fixtures are untouched.
  - With a brief, figure keywords reach the prompt masked.
  - The half-of-titles rule; short titles get the keyword only.
  - `searchTags` order and the two-outlier rule.
  - `generateTitles` scores three under mock and records three ledger rows; a cap refusal keeps the titles with no scores.
  - **Score all** scores the rest.
  - The screen shows the scores and the markers.
  - New lift cases `metadata-titles-search`, `metadata-description-search`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the providers and schemas suites, then web `app` and `lib`. Expected: PASS.
- [ ] **Step 5: Commit** in two parts: `feat(metadata): titles, description and tags chase the frozen search brief`, then `feat(publish): VidIQ scores the top three titles, Score all scores the rest`.

### Task 10: Retire Suggest cases and the case-finder ranking code

**Files:**
- Delete: the `suggestCases` action and `SuggestButton`/suggest panel in `case-library.tsx`; `buildSuggestCasesRequest`, `parseSuggestedCases`, `fileCaseRepairs`, `buildScoreNamedCasesRequest`, `parseNamedCaseScores`, `mockSuggestedCases` from `packages/providers/src/prompts/cases.ts` (delete the file if nothing else remains), their lift cases and those builders' fixtures only; `packages/case-finder/src/{hitlist,score,gather,backtest}/`, `evidence.ts`, `stats.ts` and their tests, `packages/case-finder/scripts/backtest.ts`
- Modify: `packages/case-finder/src/index.ts` (drop the hitlist and stats exports), `src/config.ts` (keep `PRIMARY_*` and `EDGAR_*` only; trim `config.test.ts`), `packages/case-finder/package.json` (drop the backtest script), `eslint.config.mjs` (drop the case-finder scripts glob), `.env.example` (drop the back-test cache comment; keep the evidence-source variables), `packages/db/src/cases.ts` (`createSuggestedCases`, `existingCaseTitles` if unused), `docs/superpowers/specs/2026-10-20-case-finder-evidence-ranking-design.md` (status line: "Dropped 2026-10-28, superseded by 2026-10-28-vidiq-search-research-design.md")

**Interfaces:**
- Must keep working: every import of `@boom-busters/case-finder` from `apps/web` (`research-sources.ts`, `dossier-discover.ts`, `dossier-gather.ts` and their tests). Re-grep before deleting.

- [ ] **Step 1: Grep** every symbol slated for deletion across `apps`, `packages` and `e2e`. List any user outside the deletion set, and stop if one is a dossier source path.
- [ ] **Step 2: Delete and trim.** Remove the case-library tests and e2e steps for **Suggest cases** (`e2e/tests/*`, grep `Suggest cases`).
- [ ] **Step 3: Run** typecheck, lint, the case-finder, providers and db suites, and web `inngest` (the dossier discover and gather tests). Expected: PASS. `git status` lists only the deleted builders' fixtures under `__fixtures__`.
- [ ] **Step 4: Commit** `refactor: retire Suggest cases and the case-finder ranking; the dossier sources stay`.

### Task 11: End to end, PROGRESS and the branch check

**Files:**
- Create: `e2e/tests/case-research.spec.ts`
- Modify: `e2e/global-setup.ts` (delete `vidiq_credits` rows for test cases before deleting cases, if any test case ledger rows exist), `PROGRESS.md`

- [ ] **Step 1: Write the e2e spec** (mock providers, no Inngest dev server, the way `bible.spec.ts` seeds what a run would leave):
  - Add a case by subject. A duplicate subject is refused.
  - **Research with VidIQ** shows its estimate. Without Inngest it says so.
  - Seed a brief the way the runner would, then choose **Use this angle**; the angle and demand line show.
  - **Make target** on a secondary keyword.
  - A stale seeded brief shows the refresh panel, and **Start without refreshing** starts a project whose brief is frozen.
  - At 390 px the brief panel has no sideways scroll and every control is at least 40 px.
- [ ] **Step 2: Run** `case-research.spec.ts`, then the full e2e suite once (it runs about 15 minutes: start it with `run_in_background` writing to a log and wait with a bounded `until` loop on the summary line). Expected: all pass.
- [ ] **Step 3: Write PROGRESS** decisions from 371, one per ruling below and any the tasks made. Add the owner actions at deploy: migration 0043, `PUT /api/inngest` (new function), and check the VidIQ key and cap. Record as an open owner item that the 30-day freshness was chosen to match YouTube API Services data-storage rules (spec 6.3 asks the builder to check them); the owner confirms it against the current policy before the first real run.
  - Rulings to record:
    1. The anti-keyword rule lives in the outline's brief block, not `script-craft.md`, to keep every brief-free prompt identical.
    2. The model steps use the `research` route.
    3. Outlier videos join the gather as competitor links.
    4. One shared VidIQ spend path.
    5. Title scores and VidIQ tags are stored on the publish draft.
    6. The brief freezes only when its subject matches the case.
    7. The Priority field and sort leave the UI, but the column stays.
- [ ] **Step 4: Branch check.**
  - Run each package suite in turn: schemas, providers, db, case-finder, then web `inngest`, `app`, and `lib components`.
  - Run lint, typecheck and the tracked-file Prettier check.
  - `git diff master -- packages/providers/src/prompts/lift/__fixtures__` shows only additions and the deletions from Task 10.
  - Compare the drizzle journal with `origin/master`.
- [ ] **Step 5: Commit** `docs(progress): VidIQ case research, decisions 371 to N`.
