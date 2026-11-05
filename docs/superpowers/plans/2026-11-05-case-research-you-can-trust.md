# Case Research You Can Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a case's research trustworthy. Every keyword carries the searcher's intent and its fit with the channel. Keywords are grouped into topics. The target is picked by fit, then demand. Who ranks today is checked. Angles cite comment evidence and a niche test. A five-check verdict card heads the brief. All of it adapts to each channel's bible.

**Architecture:** Pure rules (classifier, pick, verdict, credits) live in `@boom-busters/schemas`. Three VidIQ tools join the client in `@boom-busters/providers`, with fixtures from the live probe. Two new model steps join the prompts there. One evidence helper module in `apps/web/lib` is shared by the research run and two new on-demand actions. The verdict is computed on read and never stored.

**Tech Stack:** TypeScript, Zod, Drizzle, Inngest, Next.js App Router (read `apps/web/node_modules/next/dist/docs/` before routing work), React, Tailwind v4 console tokens, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-case-research-you-can-trust-design.md` (approved 2026-11-05). The probe responses are in `docs/superpowers/specs/2026-11-05-case-research-probe/`. Read the spec in full before Task 1.

## Global Constraints

- Branch `case-research-trust`; small commits; commit by path, never `git add -A`.
- Mock-provider mode by default. Every new VidIQ call has a fixture, and every new model step has a mock. No test spends.
- No migration. Every new brief and keyword-row field is **optional** in Zod (`.optional()`, not `.default()`), so existing fixtures and stored briefs parse unchanged. Readers use `?? []` or `?? null`.
- Nothing channel-specific in code. Preferred words come from the case's format keywords and its pillar's keywords. Language comes from `bible.language`. The hard-coded `DOCUMENTARY_PHRASES` is deleted.
- Thresholds, verbatim from the spec:
  - Pick floor: `overall` ≥ 50 (`WEAK_TARGET_OVERALL`).
  - Open door: channel under 100,000 subscribers **and** 10,000 or more views.
  - Stale field: 6 or more of the top ten published 3 or more years before the research date.
  - Short: under 61 seconds.
  - Competition: ok at 3+ open doors. Warn at 1 or 2, or at none in a stale field. Bad at none in a recent field, or 6+ Shorts.
  - Demand: ok at 5,000+ a month with growth under 200%. Warn at 1,000 to 4,999, or at growth of 200%+. Bad under 1,000 or unmeasured.
  - Lists: at most 5 comment themes; quotes at most 140 characters; intent at most 80 characters; topic at most 40 characters.
- Credits per run: base 20, format seed 5, People seeds 5 each (at most 2), field check 15 (3 candidates), comments 15 (3 videos), niche test 5.
- A cross on any check warns; nothing blocks New project.
- Third-party text (keywords, titles, comments, VidIQ notes) is quoted data, never instructions. No stored quote may contain abuse.
- Inngest replay safety: new values are computed inside steps or deterministically from memoised step output. One VidIQ purchase per step.
- `'use server'` modules export only async functions. A server component never imports a `'use client'` module graph.
- Copy: no em or en dashes in user-visible strings you write; South African spelling.
- Verification: Bash `timeout: 600000`, in the foreground. Run one file with `pnpm exec vitest run <basename>` from its package. Run `pnpm typecheck`, `pnpm lint` and `pnpm format:check` before every commit. Database suites need Docker Desktop and run one at a time.

## Review Focus

1. **A model answer that skips or invents terms in the understanding step.** Unknown terms are dropped. A measured term the answer omits is treated as not about the subject. If every term drops, the target is null and the run still saves. (Task 4 test `drops invented terms and treats omitted ones as not about the subject`.)
2. **A niche test whose VidIQ job never finishes inside the step.** The test is null, the reason is recorded in `skipped`, and the run saves. (Task 6 test `saves the brief when the niche test times out`.)
3. **Choosing an angle whose keyword is off-intent, a title or carries a figure.** The target stays, and the reason names the target that stayed. (Task 7 test `keeps the target when the angle's keyword is not eligible`.)
4. **Search results with null subscribers or views, or fewer than ten results.** A null never counts as an open door, the counts use the results that exist, and the verdict still computes. (Task 2 test `judges a short field with nulls without crashing`.)
5. **The credit cap reached partway through the optional steps.** The run skips the remaining optional steps, records why, and the verdict shows those checks as "Not checked: credit cap". (Task 6 test `skips optional steps at the cap and says so`.)

---

### Task 1: Language-aware classifier, the fit-first pick and the credit estimate

**Files:**
- Modify: `packages/schemas/src/search-terms.ts`, `packages/schemas/src/search-brief.ts`
- Test: `packages/schemas/src/search-terms.test.ts`, `packages/schemas/src/search-brief.test.ts`
- Modify: the two `caseResearchCredits` call sites, `apps/web/app/(console)/c/[slug]/cases/actions.ts:401` and `search-brief-panel.tsx:119,196`

**Interfaces:**
- Produces:
  - `classifySearchTerms(terms: readonly string[], options?: { language?: string }): Map<string, SearchTermKind>`. The accent rule runs only when `language` is undefined, `''`, `'en'` or starts with `'en-'`.
  - `splitSearchTerms(rows, options?: { language?: string })`, with the same option.
  - `preferredWords(keywords: readonly string[], subject: string): string[]`: the distinct lowercased words of the given format and pillar keywords. Words of 2 characters or fewer and words of the subject are dropped.
  - `pickTargetCandidates(rows: readonly SearchKeyword[], options: { preferredWords: readonly string[]; language?: string }): SearchKeyword[]`. Eligible rows are keyword kind, have no figure, and have `overall` ≥ 50. Prefer `fit === 'fits'`, or an undefined `fit`. Only when none qualify, use `fit === 'partly'`. Order: rows containing a preferred word first, then `estimatedMonthlySearch` descending (nulls last). Returns at most 3.
  - `chooseTargetKeyword(rows, subject)` keeps its signature for the upgrade path. Its tie-break no longer uses a phrase list: highest `overall`, then naming the subject, then most searches.
  - `caseResearchCredits(input: { formatSeed: boolean; people: number }): number` = 20 + (formatSeed ? 5 : 0) + 5 × min(people, 2) + 35.

- [ ] **Step 1: Write the failing tests.**
  - `it('keeps accented keywords on a Portuguese channel')`: with `language: 'pt-BR'`, `'dom pedro ii documentário'` is `'keyword'`, and `'dom pedro ii: o último imperador'` is still `'title'`.
  - `it('builds preferred words from bible keywords without the subject')`: `preferredWords(['documentary', 'downfall', 'rise and fall', 'WeWork of', 'ai'], 'WeWork')` equals `['documentary', 'downfall', 'rise', 'and', 'fall']`. "wework" is the subject, and "of" and "ai" have 2 characters or fewer.
  - `it('picks by fit, then bible words, then searches')`: the WeWork rows from the spec (overall estimates 74, 68, 64, 63, 62, 58, 57, with Pune `fit: 'off'` and the scene rows `fit: 'off'`), with preferred words `['documentary']`, give `'wework documentary'` first.
  - `it('falls back to partly when nothing fits')`.
  - `it('never offers a row under 50, with a figure, or a title')`.
  - `it('counts every call in the estimate')`: `{ formatSeed: true, people: 2 }` gives 70, and `{ formatSeed: false, people: 0 }` gives 55.

- [ ] **Step 2: Run to see them fail.** From `packages/schemas`: `pnpm exec vitest run search-terms search-brief`. Expected: FAIL.

- [ ] **Step 3: Implement,** then update the call sites. `people` is `item.people.length`.

- [ ] **Step 4: Run again, then typecheck.** Expected: PASS, exit 0.

- [ ] **Step 5: Commit.** `feat(schemas): language-aware terms, a fit-first target pick from bible words, and the full credit estimate`

---

### Task 2: Brief evidence fields and the verdict

**Files:**
- Modify: `packages/schemas/src/search-brief.ts`
- Create: `packages/schemas/src/brief-verdict.ts`, `packages/schemas/src/brief-verdict.test.ts`
- Modify: `packages/schemas/src/index.ts` (export the new module)

**Interfaces:**
- Consumes: Task 1's `classifySearchTerms`.
- Produces. All new fields are optional:
  - On `SearchKeywordSchema`: `intent?: string` (max 80), `fit?: 'fits' | 'partly' | 'off'`, `topic?: string` (max 40).
  - On `AngleOptionSchema`: `evidence?: string[]` (max 3, each max 160).
  - `FieldResultSchema`: `{ videoId, title, channelTitle: string | null, subscribers: number | null, views: number | null, publishedAt: string | null, seconds: number | null }`
  - `FieldCheckSchema`: `{ keyword: string, checkedAt: string (datetime), results: FieldResult[] (max 10) }`
  - `CommentThemeSchema`: `{ theme: string (max 120), count: int ≥ 1, quote: string (max 140) | null, videoId: string }`
  - `NicheTestSchema`: `{ angle: string, verdict: string (max 300), direct: boolean, evidence: { text: string (max 200), count: number | null }[] (max 3), notes: string (max 500) }`
  - On `SearchBriefSchema`: `language?: string`, `niche?: string` (max 80), `offIntent?: SearchKeyword[]` (max 10), `fieldChecks?: FieldCheck[]` (max 4), `commentThemes?: CommentTheme[]` (max 5), `commentsRead?: { videos: int, comments: int }`, `nicheTests?: NicheTest[]` (max 3), `skipped?: string[]` (max 6).
  - `upgradeSearchBrief` passes `brief.language` to the classifier.
  - Constants: `OPEN_DOOR_MAX_SUBSCRIBERS = 100_000`, `OPEN_DOOR_MIN_VIEWS = 10_000`, `STALE_YEARS = 3`, `STALE_MIN = 6`, `SHORT_MAX_SECONDS = 60`, `SHORTS_BAD = 6`, `DEMAND_OK = 5_000`, `DEMAND_WARN = 1_000`, `SPIKE_GROWTH = 200`.
  - `type VerdictCheck = 'intent' | 'angle' | 'fit' | 'demand' | 'competition'`
  - `interface VerdictLine { check: VerdictCheck; state: 'ok' | 'warn' | 'bad'; reason: string }`
  - `briefHasFullChecks(brief: SearchBrief): boolean`: true when any target or secondary row has `fit` defined, or `fieldChecks` is defined.
  - `topicDemand(brief: SearchBrief): { topic: string | null; searches: number | null; growth: number | null }`
  - `openDoors(check: FieldCheck): number`, `isStaleField(check: FieldCheck, now: Date): boolean`, `shortCount(check: FieldCheck): number`
  - `fieldCompetition(check: FieldCheck, now: Date): 'ok' | 'warn' | 'bad'`: the Competition rule for any one check. `briefVerdict` uses it for the target, and Task 6 uses it to rate each candidate.
  - `briefVerdict(brief: SearchBrief, context: { caseCategory: string | null; checkedAngle: number | null }): VerdictLine[]` returns five lines in the order intent, angle, fit, demand, competition. `checkedAngle` is the chosen option index, else the recommended one. Reasons are plain sentences that name the keyword or topic. The no-check states read `'Not checked for this keyword'` and `'Not checked: credit cap'`, the latter when `skipped` names that check.

- [ ] **Step 1: Write the failing tests** in brief-verdict.test.ts. Use the probe's "wework documentary" results, mapped to `FieldResult` (durations parsed), so the fixture is real:
  - `it('finds no open doors in the WeWork field and calls it recent')`: `openDoors` is 0, `isStaleField(…, new Date('2026-11-05'))` is false, and the competition state is `'bad'` with a reason containing `wework documentary`.
  - `it('counts a small channel with real views as an open door')`
  - `it('warns on no open doors in a stale field')`
  - `it('calls a field of Shorts bad')`
  - `it('judges a short field with nulls without crashing')`: 4 results, some with null views and subscribers, gives a defined state and no throw.
  - `it('sums topic demand over keyword rows that are not off')`: titles excluded, figure rows included.
  - `it('warns on a news spike')`: growth 250 gives demand `'warn'`.
  - `it('marks intent from the target fit')`: fits gives ok, partly gives warn, off or null gives bad.
  - `it('needs comment-theme or direct niche evidence for an ok angle')`
  - `it('shows Not checked for a target with no field check')`
  - `it('shows the credit cap when the run skipped a check')`
  - `it('knows an old brief has no full checks')`

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run brief-verdict search-brief`. Expected: FAIL.

- [ ] **Step 3: Implement.** Parse ISO 8601 durations (`PT2H5M6S`) in the provider's parser (Task 3), not here: `FieldResult.seconds` arrives as a number.

- [ ] **Step 4: Run again, then typecheck.** Expected: PASS, exit 0.

- [ ] **Step 5: Commit.** `feat(schemas): brief evidence fields and the five-check verdict`

---

### Task 3: VidIQ search, comments and the niche test

**Files:**
- Modify: `packages/providers/src/vidiq/shapes.ts`, `client.ts`, `costs.ts`, `mock.ts`
- Create: `packages/providers/src/vidiq/fixtures/youtube_search.json` and `video_comments.json` (from the probe files, as they are), `comment_insights.json` and `job_poll.json` (hand-written; see below)
- Test: `packages/providers/src/vidiq/shapes.test.ts`, `client.test.ts`

**Interfaces:**
- Produces:
  - `VidiqTool` gains `'vidiq_youtube_search' | 'vidiq_video_comments' | 'vidiq_comment_insights' | 'vidiq_job_poll'`.
  - `VIDIQ_CREDIT_COST` gains `youtubeSearch: 5`, `videoComments: 5`, `commentInsights: 5`, `jobPoll: 0`.
  - `interface VidiqSearchResult { videoId: string; title: string; channelTitle: string | null; subscribers: number | null; views: number | null; publishedAt: string | null; seconds: number | null }`
  - `interface VidiqComment { text: string; likes: number; byOwner: boolean; isReply: boolean }`: `text` is decoded (HTML entities, `<br>` to newline, tags stripped).
  - `interface VidiqNicheJob { jobId: string }`
  - `type VidiqJobState = { status: 'inprogress' } | { status: 'completed'; result: unknown } | { status: 'failed' | 'expired'; refunded: boolean }`
  - Client methods:
    - `youtubeSearch(query: string): Promise<VidiqCall<VidiqSearchResult[]>>`, with `type: ['video']`, `limit: 10` and `order: 'relevance'`
    - `videoComments(videoId: string): Promise<VidiqCall<VidiqComment[]>>`, with `order: 'relevance'` and `maxResult: 100`; top comments and their replies flattened
    - `commentInsightsValidate(args: { niche: string; idea: string; language?: string }): Promise<VidiqCall<VidiqNicheJob>>`
    - `jobPoll(jobId: string): Promise<VidiqCall<VidiqJobState>>`
  - Parsers: `parseYoutubeSearch`, `parseVideoComments`, `parseNicheJob`, `parseJobPoll`, `isoDurationSeconds(iso: string | null): number | null`.
- The hand-written insights fixtures follow the tool description: `{ mcpJobId }` for the start, and a completed poll whose `result` holds a verdict, evidence items and `notes`. They are a best guess, marked so in `fixtures/README.md`. Task 9's live run replaces them with real responses.

- [ ] **Step 1: Write the failing tests:**
  - `it('reads the probe search with sizes, views and seconds')`: `c9Xm1bT50DQ` has `subscribers` 1860000 and `seconds` 7506.
  - `it('decodes comment text and flattens replies')`: `He&#39;s still worth 2.3 billion. How?` becomes `He's still worth 2.3 billion. How?` with `isReply: true`, and the owner's comment has `byOwner: true`.
  - `it('parses ISO durations')`: `PT13M29S` gives 809, `PT2H5M6S` gives 7506, and `null` gives null.
  - `it('reads a job id and every poll state')`
  - `it('serves the new fixtures in mock mode')`

- [ ] **Step 2: Run to see them fail.** From `packages/providers`: `pnpm exec vitest run shapes client`. Expected: FAIL.

- [ ] **Step 3: Implement,** following the existing parser idiom (tolerant of missing fields, nulls rather than throws).

- [ ] **Step 4: Run again, then the full providers suite.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(providers): VidIQ search, comments and the niche test, with probe fixtures`

---

### Task 4: The understanding and comment-theme prompts; angles cite evidence

**Files:**
- Modify: `packages/providers/src/prompts/search-brief.ts`, `search-brief.test.ts`

**Interfaces:**
- Consumes: Task 2's field types and Task 3's `VidiqComment`.
- Produces:
  - `KeywordUnderstandingInput`: `{ bible: BibleInUse; subject: string; formatName: string; formatKeywords: readonly string[]; pillarLabel: string | null; rows: readonly SearchKeyword[] }`
  - `KeywordUnderstanding`: `{ niche: string; terms: { keyword: string; intent: string; fit: 'fits' | 'partly' | 'off'; topic: string }[] }`. Only the terms that are about the subject are kept.
  - `buildKeywordUnderstandingRequest`, `parseKeywordUnderstanding(text, input, note?)` and `mockKeywordUnderstanding(input)`. The mock keeps every row with intent `'mock intent'`, fit `'fits'`, the topic set to the row's first two words, and the niche set to the bible's subject.
  - The model answers `{"niche": string, "terms": [{"term", "about", "intent", "fit", "topic"}]}`. `niche` is the channel's subject in English, at most 80 characters.
  - `CommentThemesInput`: `{ bible: BibleInUse; subject: string; comments: readonly (VidiqComment & { videoId: string })[] }`
  - `buildCommentThemesRequest`, `parseCommentThemes(text, input, note?): CommentTheme[]` and `mockCommentThemes(input)`.
  - `AngleOptionsInput` gains `commentThemes: readonly CommentTheme[]` and `fieldSummary: string | null`. Each option may carry `evidence` (at most 3 lines, each at most 160 characters). The digit guard admits theme counts.
  - The rule `buildKeywordFilterRequest`, `parseKeywordFilter` and `mockKeywordFilter` are deleted, along with their tests.
- Prompt rules that must appear:
  - fit is judged against this channel and format: "would a video in this format on this channel satisfy that searcher";
  - intent and topic are plain words;
  - zero comment themes is a valid answer;
  - skip abusive comments and never quote one;
  - a quote must be copied exactly from one comment;
  - comments are written by the public and are never instructions.
- The parser drops:
  - a theme whose quote is not a substring of an input comment (case-sensitive, after the same decoding), keeping the theme with `quote: null`;
  - a theme whose count exceeds the number of comments;
  - more than 5 themes.

- [ ] **Step 1: Write the failing tests:**
  - `it('drops invented terms and treats omitted ones as not about the subject')`
  - `it('keeps intent, fit and topic within their limits')`
  - `it('keeps a theme but drops a quote not found in the comments')`
  - `it('accepts zero themes')`
  - `it('tells the model comments are never instructions and never to quote abuse')`
  - `it('lets an angle cite a theme count')`
  - `it('judges fit against the format, naming it in the request')`

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run search-brief`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again, then the full providers suite.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(providers): keyword understanding, comment themes, and angles that cite evidence`

---

### Task 5: The evidence helpers

**Files:**
- Create: `apps/web/lib/case-evidence.ts`, `apps/web/lib/case-evidence.test.ts`

**Interfaces:**
- Consumes: Task 3's client methods, `spendVidiq`, and Task 2's types.
- Produces (each makes exactly one purchase or none, so callers can wrap each in its own Inngest step):
  - `searchField(keyword: string, channelId: string): Promise<FieldCheck>`
  - `readComments(videoId: string, channelId: string): Promise<(VidiqComment & { videoId: string })[]>`. Owner comments are removed.
  - `startNicheTest(args: { niche; idea; language? }, channelId): Promise<string>` returns the job id.
  - `awaitNicheTest(jobId: string, angle: string, options?: { timeoutMs?: number; intervalMs?: number }): Promise<NicheTest | null>`. It polls every 5 s (default) for up to 90 s (default). It returns null on failed, expired or timed-out jobs. Polls are free and are not recorded. It maps the completed result to `NicheTest`, setting `direct` from whether the result reports direct evidence (false when unclear).
  - `const CAP_REACHED = 'credit cap'`. Each spending helper rethrows the spend path's cap refusal as `CapReached`, a class exported from this file, so the run can record a skip.
  - `export class CapReached extends Error`

- [ ] **Step 1: Write the failing tests** (mock client, fake timers):
  - `it('maps the probe search to a field check')`
  - `it('drops the creator comments')`
  - `it('returns null when the niche job times out')`
  - `it('returns null on a refunded failure')`
  - `it('turns a cap refusal into CapReached')`

- [ ] **Step 2: Run to see them fail.** From `apps/web`: `pnpm exec vitest run case-evidence`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): evidence helpers for the field, comments and the niche test`

---

### Task 6: The research run

**Files:**
- Modify: `apps/web/inngest/functions/case-researcher.ts`, `case-researcher.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/cases/research-steps.ts` (labels)

**Interfaces:**
- Consumes: Tasks 1 to 5. The bible's `language`, the case's `people`, its format, and its category's pillar keywords.
- Steps, in this order. New step ids are exact:
  1. `load` gains `people` (the first 2 names), `language`, `formatName`, `formatKeywords` and `pillarKeywords`.
  2. `keywords-terms` and `keywords-format`, as today.
  3. `keywords-people-0` and `keywords-people-1`: matching terms for each name, when present.
  4. `keywords-understand` replaces `keywords-filter`. Off rows go to `offIntent`; the rest are split with the brief language.
  5. `fit`, `keywords-questions`, `outliers` and `outlier-details`, as today.
  6. `field-0`, `field-1` and `field-2` for `pickTargetCandidates(...)`.
  7. The target is the first candidate whose `fieldCompetition(check, now)` is not `'bad'`; else the first candidate.
  8. `comments-0`, `comments-1` and `comments-2` for the top 3 winning videos, then `comment-themes`.
  9. `winners`, then `angles` (with themes and a one-line field summary), then `rate-angles`.
  10. `niche-start`, then `niche-wait`, for the recommended angle.
  11. `save-brief`, which writes every new field, plus `language`, `niche` and `skipped`.
- A `CapReached` in an optional step (`field-*`, `comments-*`, `niche-*`) records a skip such as `'field check: credit cap'` and skips the rest of that group. It never fails the run. Any other failure in an optional step is logged, and the step returns null.
- Labels:
  - `keywords-people-*`: Finding what people search for the people
  - `keywords-understand`: Understanding what searchers want
  - `field-*`: Checking who ranks now
  - `comments-*` and `comment-themes`: Reading what viewers asked for
  - `niche-*`: Testing the angle against the niche

- [ ] **Step 1: Write the failing tests** against the existing harness and mock client:
  - `it('stores intent, fit and topic, and keeps off rows apart')`
  - `it('picks the first candidate whose field is not bad')`
  - `it('stores comment themes and how many comments were read')`
  - `it('stores the niche test for the recommended angle')`
  - `it('saves the brief when the niche test times out')`
  - `it('skips optional steps at the cap and says so')`
  - `it('seeds research with up to two people')`

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run case-researcher`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again, then typecheck.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): research measures intent, the field, the comments and the niche`

---

### Task 7: Angle follows target; on-demand checks

**Files:**
- Modify: `packages/db/src/cases.ts`, `cases.integration.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/cases/actions.ts`, `actions.test.ts`

**Interfaces:**
- Produces:
  - `chooseCaseAngle(db, caseId, choice)` returns `{ summary: CaseSummary; targetChange: { to: string } | { keptBecause: string } | null }`. On `{ option }`, when the option's keyword is a secondary keyword (case-insensitive), is of keyword kind, has no figure and is not the target, it swaps it in the way `setCaseTargetKeyword` does, with the same notes rule. When it is not eligible, it returns `keptBecause`:
    - `"This angle's keyword has a figure, so the target stays <target>"`
    - `"This angle serves a searched title, so the target stays <target>"`
    - `"This angle's keyword does not fit this channel, so the target stays <target>"`

    Own angles and an angle whose keyword equals the target return null.
  - `saveCaseFieldCheck(db, caseId, check: FieldCheck): Promise<CaseSummary | null>` and `saveCaseNicheTest(db, caseId, test: NicheTest): Promise<CaseSummary | null>`. Both work under `lockCaseResearch`. They replace any entry for the same keyword or angle, keep within the list caps, and safeParse before writing.
  - `chooseAngleAction` returns `ActionResult & { targetChange?: … }`.
  - `checkWhoRanksAction(caseId): Promise<ActionResult>` runs a field check for the current target. It refuses when no target exists, when the target is already checked, or while research runs.
  - `testAngleAction(caseId, option: number): Promise<ActionResult>` runs the niche test for that option (start, then await, inline). It refuses while research runs and when the brief has no `niche`.
  - `evidenceEstimate(caseId): Promise<{ ok: true; credits: { whoRanks: 5; angleTest: 5 } } | { ok: false; error: string }>`

- [ ] **Step 1: Write the failing tests:**
  - `it('makes the chosen angle\'s keyword the target')`
  - `it('keeps the target when the angle\'s keyword is not eligible')`
  - `it('saves a field check for the target and replaces an older one')`
  - `it('saves a niche test for a chosen angle')`
  - In actions.test:
    - `it('checks who ranks for an unchecked target')`
    - `it('refuses a check while research runs')`
    - `it('tests the chosen angle')`

- [ ] **Step 2: Run to see them fail.** The DB file runs alone. `pnpm exec vitest run cases.integration` (packages/db), then `pnpm exec vitest run cases/actions` (apps/web). Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run again, then typecheck.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat: an angle carries its keyword to the target; check who ranks and test an angle on demand`

---

### Task 8: The verdict card and the evidence on screen

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/cases/verdict-card.tsx`, `verdict-card.test.tsx`, `who-ranks.tsx`, `who-ranks.test.tsx`
- Modify: `case-panel.tsx`, `search-demand-section.tsx`, `angle-section.tsx` and their tests

**Interfaces:**
- Consumes: Task 2's `briefVerdict` and `briefHasFullChecks`; Task 7's actions.
- Produces, per the spec's "On screen":
  - **VerdictCard** sits under the next-step strip. Five rows, each with an icon and a token colour, a check name and the reason. Each row is a link to its block's id (`#evidence-intent` and so on). An old brief shows the single line `Researched before the full checks. Research again for intent, demand and competition evidence.`.
  - **Target card** gains the intent phrase, the fit word and the topic with its monthly searches.
  - **Other keywords** are grouped under topic headings, and each row shows its intent phrase.
  - **Doesn't fit this channel** is a collapsed group of `offIntent` rows with their intent phrases.
  - **Make target cell on a figure row** reads `Has a figure, can't be the target`.
  - **WhoRanks block** lists the top ten for the target as rows: channel subscribers, views, age, length, Short, and an "Open door" marker. A toggle shows the other candidates. When the target has no check, a `ConfirmButton` labelled `Check who ranks now` carries the consequence `About 5 VidIQ credits.`.
  - **Angle cards** list their evidence lines.
  - **What viewers asked for** is a collapsed block of the themes with their counts and quotes, plus the line `Read <n> comments on <m> videos.`. With no themes it reads `Read <n> comments on <m> videos; no clear requests.`.
  - **Niche verdict** shows on the checked angle. When the chosen angle has no test, a `ConfirmButton` reads `Test this angle` with `About 5 VidIQ credits.`.
  - **Choosing an angle** toasts `Target keyword is now <keyword>` or shows the `keptBecause` sentence.

- [ ] **Step 1: Write the failing tests:**
  - `it('shows five checks with reasons and links to their evidence')`
  - `it('shows the old-brief line instead of a verdict')`
  - `it('explains why a figure row has no Make target')`
  - `it('groups keywords by topic and hides off-intent rows in their own group')`
  - `it('marks open doors and offers a check for an unchecked target')`
  - `it('says honestly when comments held no requests')`
  - `it('toasts the target change when an angle is chosen')`
  - `it('offers Test this angle for a chosen angle without a test')`

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run verdict-card who-ranks case-panel search-demand-section angle-section`. Expected: FAIL.

- [ ] **Step 3: Implement** with console tokens. Read Impeccable's `reference/craft-floor.md` first (`C:\Users\ricar\.claude\plugins\cache\impeccable\impeccable\4.5.2\skills\impeccable\reference\craft-floor.md`). Afterwards, run the detector on the cases folder.

- [ ] **Step 4: Run again, then typecheck and lint.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): the verdict card and its evidence on the case panel`

---

### Task 9: End to end, progress notes, finish

**Files:**
- Modify: `e2e/tests/case-research.spec.ts`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Extend the seeded brief in the e2e spec.**
  - Add intent, fit and topic on its rows, one off row, a field check with one open door, two comment themes, and a niche test.
  - Assert the verdict card's five rows and the "Who ranks now" open-door marker.
  - Assert that choosing an angle whose keyword is a secondary toasts the target change.
  - Assert the figure-row reason.

- [ ] **Step 2: Run it scoped** from the e2e package: `pnpm exec playwright test tests/case-research.spec.ts`. Expected: PASS.

- [ ] **Step 3: Write the PROGRESS.md section** `## Case research you can trust (2026-11-05)`. It holds the deliverables with commits; decisions numbered from the next free number on `origin/master` at merge; and the owner actions:
  - `PUT /api/inngest` after deploy (new steps);
  - no migration;
  - one live research run with the owner's go-ahead, about 70 credits, to replace the hand-written comment-insights fixtures with real responses.

- [ ] **Step 4: Run the full checks per package** (schemas, providers, db, apps/web split by directory). Then `pnpm typecheck`, `pnpm lint` and `pnpm format:check`. Expected: green, apart from known pre-existing failures named in the report.

- [ ] **Step 5: Commit.** `docs: case research you can trust, progress and decisions`
