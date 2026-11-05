# Case Library Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep video titles and other-language terms out of a case's keywords and target, rank the angle options (data Demand score plus the model's Recommended pick), and rebuild the Case Library as a list and side panel.

**Architecture:** A pure classifier and brief upgrade in `@boom-busters/schemas` sort measured terms by shape; both brief read paths (cases and projects) parse through an upgrading schema, so old briefs read correctly with no new research. A new "rate the angles" model step lives in `@boom-busters/providers`, is called by the research run and by a server action through one helper in `apps/web/lib`. The page splits into focused client components under `cases/`, with the open case in the URL (`?case=<id>`).

**Tech Stack:** Next.js App Router (read `apps/web/node_modules/next/dist/docs/` before touching routing), React, Tailwind v4 with the console tokens, Zod, Drizzle, Inngest, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-05-case-library-redesign-design.md` (approved 2026-11-05). Read it in full before Task 1; this plan argues from it.

## Global Constraints

- Branch `case-library-redesign` off master; small commits, one logical change each.
- Mock-provider mode by default: no test spends; every model step has a mock answer (`mockProvidersEnabled()`).
- No migration: every new brief field is jsonb with a Zod default.
- Button-first (spec 11.1): every action a visible, labelled button; no overflow menus; spending actions use `ConfirmButton` with the cost in `consequence`.
- Console tokens only (`var(--color-*)`), dark default, existing `Button` variants (`primary` is the one gate action; `selected` for the active toggle).
- Thresholds, verbatim from the spec: title when the term contains `:` `—` `–` `|` `.` `!` `?` `"` `“` `”`, or has 9 or more words, or is the opening words (3 or more) of a title; other language when it has `áàâãäéèêíóôõöúüçñ` or capitals; Demand = round(0.7 × keyword `overall` + 6 × questions answered, max 5), capped at 100; weak target `overall` below 50; competition and volume words 0 to 33 low, 34 to 66 medium (volume: moderate), 67 to 100 high; reason at most 200 characters; lists `searchedTitles` and `otherLanguages` at most 10 each.
- Two panes from `xl` (1280px); below it the list alone, or the open case with "Back to cases".
- `'use server'` modules export only async functions (a const export 500s every action in the segment).
- Verification: `pnpm typecheck`, `pnpm lint` (zero warnings), and Prettier on tracked files (`pnpm format:check`) before every commit. Run a single test file with `pnpm exec vitest run <basename>` from the package directory; `pnpm --filter <pkg> test -- <path>` runs the whole package.
- Database suites need Docker Desktop running and `pnpm db:migrate:test` once; never run two database suites at the same time.
- Every Bash call that runs tests passes `timeout: 600000`; split verification per package rather than one whole `pnpm test`.
- Copy: no em or en dashes in user-visible strings; South African spelling (organise, colour).

## Review Focus

1. **An owner's Make target choice survives the upgrade.** A stored target that is a keyword is kept even when another keyword has a higher `overall`; the upgrade re-picks only when the stored target is a title or another language. (Task 2 test `keeps a keyword target the owner chose`.)
2. **Demand notes written from the old brief follow the new target.** After the upgrade moves a title target out, a save (angle choice, target change, rating) rewrites notes that equal `briefDemandNotes(rawBrief)`; hand-edited notes stay. (Task 3 test `notes from the pre-upgrade brief follow the upgraded target`.)
3. **A rating failure never loses a research run.** The research run's rate step failing (refusal, cut-off, bad index) saves the brief with a null recommendation, and Rate the angles appears. (Task 5 test `saves the brief when the rating cannot be read`.)
4. **Rate the angles races a research run.** The action refuses while a research job is running, and the save refuses when the stored option texts differ from the ones rated. (Task 3 test `refuses a rating for options that changed`, Task 6 test `refuses while research runs`.)
5. **An open case that no longer exists.** `?case=` naming a deleted case, or a case on another channel, opens the first case instead of an empty panel or a crash. (Task 9 test `falls back to the first case for an unknown case id`.)

---

### Task 1: Classify measured terms by shape

**Files:**
- Create: `packages/schemas/src/search-terms.ts`
- Create: `packages/schemas/src/search-terms.test.ts`
- Modify: `packages/schemas/src/search-brief.ts` (`chooseTargetKeyword`)
- Modify: `packages/schemas/src/search-brief.test.ts`
- Modify: `packages/schemas/src/index.ts` (export the new module)

**Interfaces:**
- Produces:
  - `type SearchTermKind = 'keyword' | 'title' | 'other-language'`
  - `isTitleShaped(term: string): boolean`: punctuation or 9+ words (no prefix rule).
  - `hasDiacritic(term: string): boolean`
  - `classifySearchTerms(terms: readonly string[]): Map<string, SearchTermKind>`, keyed by `term.trim().toLowerCase()`; applies the prefix rule across the list.
  - `splitSearchTerms(rows: readonly SearchKeyword[]): { keywords: SearchKeyword[]; searchedTitles: SearchKeyword[]; otherLanguages: SearchKeyword[] }`: keywords keep input order; the other two are sorted by `estimatedMonthlySearch` descending, nulls last, and capped at `SEARCHED_TERMS_MAX = 10`.
  - `chooseTargetKeyword(rows, subject)` keeps its signature and now skips any row `classifySearchTerms(rows)` does not call a keyword.

- [ ] **Step 1: Write the failing tests** in `search-terms.test.ts`. Use the ten Stellantis rows from the spec's worked example verbatim and assert each row's kind matches the table. Then:
  - `it('keeps a seven-word search as a keyword')`: `'sears holdings prairie stone hoffman estates headquarters'` is `'keyword'`.
  - `it('does not treat a hyphen as punctuation')`: `'wework co-founder adam neumann'` is `'keyword'`.
  - `it('needs three words for the prefix rule')`: with `'stellantis: the fall'` in the list, `'stellantis'` stays `'keyword'`.
  - `it('matches the prefix on whole words')`: with `'stellantis is losing everything: jeep'` in the list, `'stellantis is losing ever'` stays `'keyword'`.
  - `it('files a title in another language as other language')`.
  - `it('sorts titles by monthly searches, nulls last, at most ten')`.
  - In `search-brief.test.ts`: `it('never picks a title as the target')`. Feed the Stellantis rows with their screenshot `overall` values (75, 73, 70, 68, 68, 66, 65, 65, 64, 63) and expect `'leapmotor stellantis'`.

- [ ] **Step 2: Run to see them fail.** From `packages/schemas`: `pnpm exec vitest run search-terms search-brief`. Expected: FAIL, module not found, and the target test picks the colon title.

- [ ] **Step 3: Implement `search-terms.ts` and update `chooseTargetKeyword`.** Words come from splitting on whitespace and stripping the listed punctuation from each token. The prefix rule compares a term's word array with the start of each title-shaped term's word array.

- [ ] **Step 4: Run the tests again.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(schemas): classify measured search terms by shape and keep titles out of the target`

---

### Task 2: Brief fields, the upgrade, Demand and progress helpers

**Files:**
- Modify: `packages/schemas/src/search-brief.ts`
- Modify: `packages/schemas/src/search-brief.test.ts`
- Modify every fixture typed `SearchBrief` so typecheck passes. These are the files that construct one today: `apps/web/app/(console)/c/[slug]/cases/case-library.test.tsx`, `apps/web/app/(console)/projects/[id]/publish-actions.test.ts`, `apps/web/inngest/functions/{dossier-reviser,dossier-runner,script-runner,case-researcher}.test.ts`, `apps/web/lib/{publish-review.integration,search-tags}.test.ts`, `packages/db/src/cases.integration.test.ts`, `packages/providers/src/prompts/{dossier-render,dossier,metadata,script,search-brief}.test.ts`, `packages/providers/src/prompts/lift/lift-cases.ts`, `e2e/tests/case-research.spec.ts`. `pnpm typecheck` lists any others.

**Interfaces:**
- Consumes: Task 1's `splitSearchTerms`, `classifySearchTerms`, `chooseTargetKeyword`.
- Produces:
  - `SearchBriefSchema` gains `searchedTitles: SearchKeyword[]` (max 10, default `[]`), `otherLanguages` (same), `recommendedAngle: number | null` (int ≥ 0, default null), `recommendationReason: string | null` (max 200, default null), `ownAngle: boolean` (default false).
  - `upgradeSearchBrief(brief: SearchBrief): SearchBrief`: moves title and other-language rows out of `targetKeyword` and `secondaryKeywords` into the two lists (merged with what is there, deduplicated case-insensitively, sorted, capped). It re-picks the target with `chooseTargetKeyword` only when the stored target is not a keyword. A recommendation index out of range becomes null. It returns a deep-equal brief when nothing moves.
  - `StoredSearchBriefSchema = SearchBriefSchema.transform(upgradeSearchBrief)`
  - `WEAK_TARGET_OVERALL = 50`
  - `interface AngleDemand { score: number; keyword: string | null; keywordOverall: number | null; servesSearchedTerm: boolean; answers: number }`
  - `angleDemand(option: AngleOption, brief: SearchBrief): AngleDemand`. The keyword is looked up case-insensitively among the target and secondaries. `servesSearchedTerm` is true when the keyword is found in `searchedTitles` or `otherLanguages`, and then the keyword part is 0. `answers` counts distinct `option.answers` matching `brief.searchedQuestions` case-insensitively, trimmed, at most 5.
  - `angleIsChosen(brief: SearchBrief): boolean` is `chosenAngle !== null || ownAngle`.
  - `briefNeedsResearch(brief: SearchBrief): boolean`: the target is null, its `overall` is below 50 (null counts as 0), or any option has `servesSearchedTerm`.

- [ ] **Step 1: Write the failing tests** in `search-brief.test.ts`:
  - `it('parses a brief stored before the new fields')`: the new fields come back at their defaults.
  - `it('moves the Stellantis titles out and re-picks the target')`: a brief with the worked example's target and secondaries upgrades to target `leapmotor stellantis`, `secondaryKeywords` `[]`, 5 `searchedTitles` and 4 `otherLanguages`.
  - `it('is idempotent')`: `upgradeSearchBrief(upgradeSearchBrief(b))` deep-equals `upgradeSearchBrief(b)`.
  - `it('keeps a keyword target the owner chose')`: target `overall` 40 with a keyword secondary at 70 keeps the 40 target.
  - `it('scores demand from overall and answered questions')`: overall 63 and 2 matching answers gives 56; overall 100 and 5 answers gives 100.
  - `it('scores a title-serving option on questions only')`: option keyword in `searchedTitles` with 1 answer gives `{ score: 6, servesSearchedTerm: true }`.
  - `it('counts an own angle as chosen')`, and `it('flags a weak or missing target for research')`.

- [ ] **Step 2: Run to see them fail.** From `packages/schemas`: `pnpm exec vitest run search-brief`. Expected: FAIL.

- [ ] **Step 3: Implement** the fields and functions in `search-brief.ts`. Then add the new fields to every fixture (`searchedTitles: []`, `otherLanguages: []`, `recommendedAngle: null`, `recommendationReason: null`, `ownAngle: false`). In `case-researcher.ts`'s save step, pass them for now with `[]`/null/false; Task 5 fills them.

- [ ] **Step 4: Run the schema tests, then typecheck.** Expected: `pnpm exec vitest run search-brief` passes; `pnpm typecheck` from the repo root exits 0.

- [ ] **Step 5: Commit.** `feat(schemas): brief title and language lists, the read-time upgrade and angle Demand`

---

### Task 3: Both read paths upgrade; database writers follow

**Files:**
- Modify: `packages/db/src/cases.ts` (`storedBrief`, `lockCaseResearch`, `chooseCaseAngle`, `setCaseTargetKeyword`, new `saveCaseAngleRating`)
- Modify: `packages/db/src/projects.ts:163` (`storedBrief`)
- Modify: `packages/db/src/cases.integration.test.ts`
- Modify: the projects integration test that reads a frozen brief (find with `grep -rn "searchBrief" packages/db/src/*projects*.test.ts`), or add one to `packages/db/src/projects.integration.test.ts`

**Interfaces:**
- Consumes: `StoredSearchBriefSchema`, `classifySearchTerms`, `briefDemandNotes`.
- Produces:
  - `lockCaseResearch` returns `{ brief, rawBrief, job }`. `rawBrief` is parsed with `SearchBriefSchema` (no upgrade) and is used only for the notes comparison.
  - `chooseCaseAngle` sets `ownAngle: true` for `{ own }` and `false` for `{ option }`.
  - `setCaseTargetKeyword` throws `'a searched video title or another language cannot be the target keyword'` when `classifySearchTerms` over the brief's target and secondaries does not call `keyword` a keyword.
  - `saveCaseAngleRating(db, caseId, rating: { options: readonly string[]; recommended: number; reason: string }): Promise<CaseSummary | null>` saves under the lock. It returns null without writing when the brief is gone or `brief.angleOptions.map(o => o.angle)` differs from `rating.options`. It writes the upgraded brief with the recommendation, and rewrites `demandNotes` when they equal `briefDemandNotes(rawBrief)` or `briefDemandNotes(brief)`.
  - `setCaseTargetKeyword` uses the same two-way notes comparison.

- [ ] **Step 1: Write the failing integration tests:**
  - `it('reads an old brief upgraded')`: a raw row with a colon-title target reads back with the title in `searchedTitles`.
  - `it('reads a frozen project brief upgraded')` in the projects test.
  - `it('refuses a searched title as the target')`.
  - `it('marks an own angle chosen and clears it for an option')`.
  - `it('saves a rating for the options it rated')`.
  - `it('refuses a rating for options that changed')`: expect null and no write.
  - `it('notes from the pre-upgrade brief follow the upgraded target')`.

- [ ] **Step 2: Run to see them fail.** Start Docker Desktop and run `pnpm db:migrate:test` if needed. From `packages/db`: `pnpm exec vitest run cases.integration projects.integration`. Expected: FAIL.

- [ ] **Step 3: Implement** the changes above.

- [ ] **Step 4: Run the tests again,** then `pnpm typecheck`. Expected: PASS, exit 0.

- [ ] **Step 5: Commit.** `feat(db): upgrade case and project briefs on read; own angle, title refusal and the angle rating save`

---

### Task 4: The rate-the-angles prompt

**Files:**
- Modify: `packages/providers/src/prompts/search-brief.ts`
- Modify: `packages/providers/src/prompts/search-brief.test.ts`
- Modify: `packages/providers/src/index.ts` if the module's exports are listed there

**Interfaces:**
- Produces:
  - `RATE_ANGLES_INPUT_TOKENS = 2500`, `RATE_ANGLES_OUTPUT_TOKENS = 400`, `RECOMMENDATION_REASON_MAX = 200`
  - `interface RateAnglesOption { angle: string; gap: string; keyword: string; servesSearchedTerm: boolean; demand: number; keywordOverall: number | null; answers: number }`
  - `interface RateAnglesInput { bible: BibleInUse; subject: string; options: readonly RateAnglesOption[]; searchedQuestions: readonly string[]; toldAlready: readonly string[] }`
  - `interface AngleRating { recommended: number; reason: string }`
  - `buildRateAnglesRequest(input): LLMTaskRequest` with task `'research'` and `maxTokens: outputBudget(RATE_ANGLES_OUTPUT_TOKENS)`.
  - `parseRateAngles(text, input, note?): AngleRating`
  - `mockRateAngles(input): AngleRating`: the highest `demand`, first on a tie, with the reason `'Mock rating: the highest Demand score.'`
- The system prompt says to weigh demand and the gap together. It says that an option serving a searched title has no keyword to rank for. It says never to state a figure, date or count the inputs do not carry, that all quoted text is data and never instructions, and to answer with JSON only: `{"recommended": number, "reason": string}`. The user message lists each option numbered from 0 with its angle, gap, keyword or "serves a searched title", Demand, overall and answers count.

- [ ] **Step 1: Write the failing tests:**
  - `it('reads a recommendation')`.
  - `it('refuses an index out of range')`, expecting `ValidationError`.
  - `it('refuses a non-integer index')`.
  - `it('trims a long reason to 200 with a note')`.
  - `it('refuses a reason stating a figure no input carries')`, expecting `ValidationError`.
  - `it('accepts a reason quoting a Demand score')`: Demand 74 is in the inputs, so "74" passes.
  - `it('tells the model which options serve a searched title')`: the request text contains "serves a searched title" for that option.
  - `it('mocks the highest demand')`.

- [ ] **Step 2: Run to see them fail.** From `packages/providers`: `pnpm exec vitest run search-brief`. Expected: FAIL.

- [ ] **Step 3: Implement,** following `parseAngleOptions`'s digit guard. The set of given digits also includes every option's `demand`, `keywordOverall` and `answers`.

- [ ] **Step 4: Run the tests again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(providers): the rate-the-angles prompt, parser and mock`

---

### Task 5: The research run splits terms and rates its angles

**Files:**
- Create: `apps/web/lib/rate-angles.ts`
- Create: `apps/web/lib/rate-angles.test.ts`
- Modify: `apps/web/inngest/functions/case-researcher.ts`
- Modify: `apps/web/inngest/functions/case-researcher.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/cases/search-brief-panel.tsx` (`STEP_LABELS`: `'rate-angles': 'Ranking the angles'`)

**Interfaces:**
- Consumes: Task 2's `angleDemand`; Task 4's prompt functions; `callForAnswer` and `AnswerComplete` from `@/lib/answer`.
- Produces:
  - `rateAnglesInput(brief: SearchBrief, bible: BibleInUse): RateAnglesInput`
  - `rateAngles(brief: SearchBrief, bible: BibleInUse, complete: AnswerComplete): Promise<{ ok: true; rating: AngleRating } | { ok: false; error: string }>`. It returns the mock answer under `mockProvidersEnabled()`, and `ok: false` for fewer than 2 options.
- In the run, `splitSearchTerms(keywords)` feeds `chooseTargetKeyword(split.keywords, subject)` and the secondaries. The split happens outside any step, from the memoised `keywords`, so a parked run replays it the same way. A new step `rate-angles` runs after `angles`. It calls `beat` and builds a candidate brief from the values the save step would write. On `ok: false` it returns null, and the run carries on. The save step writes `searchedTitles`, `otherLanguages`, `recommendedAngle` and `recommendationReason`.

- [ ] **Step 1: Write the failing tests.** In `rate-angles.test.ts`:
  - `it('builds options with their Demand')`.
  - `it('refuses fewer than two options')`.
  - `it('returns the mock rating in mock mode')`.

  In `case-researcher.test.ts`, using the harness's mock VidIQ rows with a colon title added:
  - `it('stores titles apart from keywords')`.
  - `it('stores a recommendation')`.
  - `it('saves the brief when the rating cannot be read')`: stub `rateAngles` to `{ ok: false }` and expect a saved brief with `recommendedAngle: null`.

- [ ] **Step 2: Run to see them fail.** From `apps/web`: `pnpm exec vitest run rate-angles case-researcher`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests again,** then `pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): research keeps titles apart and rates its angles`

---

### Task 6: Rate the angles action and its estimate

**Files:**
- Modify: `apps/web/app/(console)/c/[slug]/cases/actions.ts`
- Modify: `apps/web/app/(console)/c/[slug]/cases/actions.test.ts`
- Create: `apps/web/lib/rate-angles-estimate.ts`, priced like `motion-estimates.ts` on `settings.modelRouting.research` with `estimateLlmUsd`, `RATE_ANGLES_INPUT_TOKENS` and `RATE_ANGLES_OUTPUT_TOKENS`

**Interfaces:**
- Produces:
  - `rateAnglesEstimate(caseId: string): Promise<{ ok: true; usd: number; model: string } | { ok: false; error: string }>`
  - `rateAnglesAction(caseId: string): Promise<ActionResult>`. It runs `requireOwner`, then `writableCase`, and needs a brief with 2 or more options whose subject matches the case (`briefMatchesSubject`). It refuses while `caseResearchJobIsRunning`, with `RESEARCH_RUNNING`. It calls `rateAngles` with `completeForChannel(channelId, { estimateOutputTokens: RATE_ANGLES_OUTPUT_TOKENS })`, then `saveCaseAngleRating`. A null save returns `{ ok: false, error: 'The angles changed while they were being rated. Rate them again.' }`. It maps `BudgetExceededError` to its message and calls `revalidatePath('/c/[slug]', 'layout')` on success.
- `rateAnglesEstimateUsd(settings, workspace): number` lives in the lib file, because `actions.ts` is `'use server'` and may export only async functions.

- [ ] **Step 1: Write the failing tests:**
  - `it('rates and saves the angles')`.
  - `it('refuses while research runs')`.
  - `it('refuses a brief for another subject')`.
  - `it('says so when the angles changed')`.
  - `it('estimates on the research route')`.

- [ ] **Step 2: Run to see them fail.** From `apps/web`: `pnpm exec vitest run actions.test`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): Rate the angles action and estimate`

---

### Task 7: Progress, list signal and score words

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/cases/case-progress.ts`
- Create: `apps/web/app/(console)/c/[slug]/cases/case-progress.test.ts`

**Interfaces:**
- Produces:
  - `type StepState = 'done' | 'current' | 'todo'`
  - `caseProgress(item: CaseSummary): { steps: { label: 'Researched' | 'Angle chosen' | 'Start a project'; state: StepState }[]; next: string }`. "Start a project" is done when `projectCount > 0` or the status is `in_production` or `published`. The next sentence for each case:
    - no subject: `'Next: give the case a subject, then research it'`
    - no brief: `'Next: research the subject with VidIQ'`
    - no angle chosen: `'Next: choose an angle'`
    - shortlisted: `'Next: start a project from the chosen angle'`
    - `retired`: `'Retired'`
    - not shortlisted yet: `'Next: shortlist the case to start a project'`
    - project started: `'Nothing waiting on you here'`
  - `listSignal(item: CaseSummary): { keyword: string | null; angle: { text: string; tone: 'success' | 'warning' | 'muted' } | null }`:
    - running job: `researchStepLabel(job.current)`, muted
    - `angleIsChosen`: `'Angle chosen'`, success
    - n options: `` `${n} angles, pick one` ``, warning
    - no brief: `'Not researched'`, muted
  - `scoreWord(value: number, kind: 'competition' | 'volume'): string`: `low`, `medium` or `moderate`, `high`.

- [ ] **Step 1: Write the failing tests,** one per branch above, plus the boundaries 33, 34, 66 and 67.

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run case-progress`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): case progress, list signal and score words`

---

### Task 8: Angle and Search demand sections

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/cases/angle-section.tsx`
- Create: `apps/web/app/(console)/c/[slug]/cases/angle-section.test.tsx`
- Create: `apps/web/app/(console)/c/[slug]/cases/search-demand-section.tsx`
- Create: `apps/web/app/(console)/c/[slug]/cases/search-demand-section.test.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/cases/search-brief-panel.tsx`. Remove `SearchBriefPanel` and its helpers once Task 9 stops importing it. Keep `ResearchControl`, `FormatPicker`, `NewProjectButton`, `researchStepLabel`, `briefMatchesSubject` and `FormatsContext`.

**Interfaces:**
- Consumes: Task 2's `angleDemand`, `angleIsChosen` and `briefNeedsResearch`; Task 6's actions; Task 7's `scoreWord`.
- Produces:
  - `AngleSection({ item, run, researchControl }: { item: CaseSummary; run: Run; researchControl: React.ReactNode })`. It renders:
    - the Research again suggestion (the `researchControl` slot) when `briefNeedsResearch`, with the sentence `'This brief has no strong keyword to aim at. Research again to measure fresh terms.'`;
    - one card per option: Demand number and bar, the keyword line (`Serves <keyword>`, or `Serves a searched title, not a keyword`, or nothing when the keyword is empty), the answers count, and the gap at primary text colour behind the label `The gap:`;
    - the Recommended badge and `Why recommended: <reason>` on `recommendedAngle`, and the Chosen badge on `chosenAngle`;
    - `Use this angle` with the accessible name `` `Use this angle: ${angle.slice(0, 60)}` ``;
    - a `ConfirmButton` "Rate the angles", whose consequence is `` `About $${usd.toFixed(2)} on ${model}. No VidIQ credits.` `` from `rateAnglesEstimate` on arm, shown when there are 2 or more options and `recommendedAngle === null`, and disabled with the title `'Research is running'` while a research job runs;
    - `Write my own angle` with today's textarea, Save my angle and Cancel.

    Use this angle, Rate the angles and Write my own angle show only when the brief matches the subject. Demand gets a `title` attribute with its breakdown and, below `sm`, a text line.
  - `SearchDemandSection({ item, run }: { item: CaseSummary; run: Run })`. It renders:
    - the target card with four labelled figures: `Searches a month` (`~n`, "VidIQ estimate"), `Search volume` (`n/100` and a word), `Competition` (`n/100` and a word), `Trend` (signed %), each omitted when null;
    - the no-target sentence from the spec when the target is null;
    - Other keywords as a table, with `Make target` in the last column and the accessible name `` `Make target: ${keyword}` ``, shown only when the brief matches the subject and the keyword has no figure. Below `sm` each keyword's figures stack under it;
    - Searched video titles with the spec's one-line explanation;
    - Evidence as `<details>` collapsed, with these closed-line summaries: winning videos (`n videos · best Nx breakout`), searched questions (`n questions`), told already (`n beats to avoid retelling`), other languages (`n searches in other languages`).

- [ ] **Step 1: Write the failing tests:**
  - Angle section:
    - `it('marks the recommended angle with its reason')`.
    - `it('shows Demand and its parts')`.
    - `it('names the angle in Use this angle')`.
    - `it('says when an angle serves a searched title')`.
    - `it('offers Rate the angles only without a recommendation')`.
    - `it('rates after confirming the cost')`: `rateAnglesAction` is called with the case id.
    - `it('suggests research for a weak target')`.
    - `it('hides choices for a brief on another subject')`.
  - Demand section:
    - `it('labels scores out of 100 apart from searches a month')`.
    - `it('names the keyword in Make target')`.
    - `it('lists searched titles apart')`.
    - `it('offers no Make target on a title')`.
    - `it('summarises evidence while collapsed')`.

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run angle-section search-demand-section`. Expected: FAIL.

- [ ] **Step 3: Implement** with the console tokens and the mockup's structure (`.superpowers/brainstorm/2418-1793868795/content/layout.html`, uncommitted, for reference only).

- [ ] **Step 4: Run the tests again.** Expected: PASS.

- [ ] **Step 5: Commit.** `feat(web): Angle and Search demand sections`

---

### Task 9: List, panel and page

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/cases/case-list.tsx` (sort toggle, Suggested group, rows as links)
- Create: `apps/web/app/(console)/c/[slug]/cases/case-panel.tsx` (header, next-step strip, warnings, sections in spec order, footer)
- Create: `apps/web/app/(console)/c/[slug]/cases/case-forms.tsx` (moved from `case-library.tsx`: `SubjectField`, `PeopleAndLinksFields`, `EditDetails`, `AddCaseForm`, with fixed widths replaced by `w-full sm:w-64`-style widths)
- Modify: `apps/web/app/(console)/c/[slug]/cases/case-library.tsx` (shell: providers, page header with Add case, the two panes)
- Modify: `apps/web/app/(console)/c/[slug]/cases/page.tsx` (read `case` from `searchParams`)
- Modify: `apps/web/app/(console)/c/[slug]/cases/case-library.test.tsx`
- Create: `apps/web/app/(console)/c/[slug]/cases/case-panel.test.tsx`

**Interfaces:**
- Consumes: Tasks 7 and 8; `channelHref(slug, '/cases', { sort, case })`.
- Produces:
  - `CaseLibrary` gains `selectedId: string | null` and `explicit: boolean`, where `explicit` means the URL named a case that exists. `page.tsx` resolves `selectedId`: the `case` param when it names a case in `cases`, else the first backlog case, else the first suggestion, else null.
  - Row links use `<Link scroll={false}>`. The open row gets `aria-current="true"`. The list sits in a `<nav aria-label="Cases">`, and the panel is a `<section aria-labelledby>` pointing at its h2. Headings run h1 for the page, h2 for the case title, and h3 for the panel sections.
  - Below `xl`, with `explicit`, the list is hidden and the panel shows a `Back to cases` link to `channelHref(slug, '/cases', { sort })`. Without `explicit`, the panel is hidden. From `xl` up, both show.
  - In the panel header: status `Select` (or Accept and Dismiss for an `idea` row), `FormatPicker`, and `ResearchControl`. The research control moves into the Angle section's suggestion slot when `briefNeedsResearch`. The `Start a project` section (`NewProjectButton`) shows for `shortlisted` cases. The footer holds the summary line, `Edit details` and `Remove case` (`ConfirmButton`, today's consequences).
  - `Add case` stays the page header's primary button. Its form renders in the panel area.

- [ ] **Step 1: Adapt `case-library.test.tsx`.** Every behaviour it tests today (accept, dismiss, remove, status, format, research, new project, stale-brief question, edit details, add case, notices) is kept and rewritten for the new structure: find the case's controls inside the panel after rendering with `selectedId`. Delete no test whose behaviour still exists; the old `SearchBriefPanel` tests move to Task 8's files. Add:
  - `it('opens the first case without a case id')`.
  - `it('falls back to the first case for an unknown case id')`. This one is page-level: test `page.tsx`'s resolver, extracted as `resolveSelected(cases, param): { selectedId: string | null; explicit: boolean }` in `case-progress.ts`.
  - `it('links each row to its case and keeps the sort')`.
  - `it('marks the open row current')`.
  - `it('shows the next step')`.
  - `it('keeps Remove case in the footer')`.

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run case-library case-panel case-progress`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run the tests again,** then `pnpm typecheck` and `pnpm lint`. Expected: PASS, exit 0.

- [ ] **Step 5: Run the Impeccable detector:** `"C:/Users/ricar/.claude/plugins/cache/impeccable/impeccable/4.5.2/skills/impeccable/scripts/impeccable" detect --json "apps/web/app/(console)/c/[slug]/cases"`. Expected: `[]`, or each finding fixed or noted as a false positive in the commit body.

- [ ] **Step 6: Commit.** `feat(web): Case Library as a list and side panel`

---

### Task 10: End to end, progress notes, finish

**Files:**
- Modify: `e2e/tests/case-research.spec.ts`
- Modify: `PROGRESS.md` (a new section, `## Case Library redesign (2026-11-05)`)

- [ ] **Step 1: Update the e2e spec.** Add a colon title row to the seeded brief's secondaries. The flow:
  1. Open the case from the list.
  2. Assert the target card's labelled figures.
  3. Assert the title is under "Searched video titles" with no Make target.
  4. Press `Make target: <secondary>`.
  5. Press Rate the angles and confirm (mock mode), then assert the Recommended badge.
  6. Press `Use this angle: …` and assert "Angle chosen" in the list row.

  Keep `expectHitTargets` on the panel, and the existing New project and cleanup steps.

- [ ] **Step 2: Run it scoped from the e2e package.** `cd e2e && pnpm exec playwright test tests/case-research.spec.ts`. Expected: PASS. Free port 3100 first if an earlier run was interrupted.

- [ ] **Step 3: Write the PROGRESS.md section.** Include the deliverables checklist with commit hashes and the decisions: the title rule, the upgrade on read for cases and projects, the Demand formula, the separate rate step that is non-fatal in research, the own-angle flag, and the `xl` breakpoint. Take decision numbers from the next free number on `origin/master` at merge time, never from this plan. Add the owner actions at deploy:
  - `PUT /api/inngest` after the Vercel deploy, because `case-researcher` has a new step.
  - No migration.
  - Check the Stellantis project's publish screen shows the re-picked target.

- [ ] **Step 4: Run the whole check per package:** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, then `pnpm exec vitest run` from each of `packages/schemas`, `packages/providers`, `packages/db` and `apps/web`, each with `timeout: 600000`. Expected: all green. A failure in a package you did not touch is a regression from an earlier task until proven otherwise.

- [ ] **Step 5: Commit.** `docs: Case Library redesign progress and decisions`
