# Dossier Subject and Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A case carries a subject and the owner's own sources; the dossier is researched from that subject, runs the story up to today, never approves itself, and can be sent back with a note at any time.

**Architecture:** Three new columns on `cases` flow through the suggestion prompt, the case form, the runner's `load-case` and the gather. Entity resolution searches the subject and the people, refusing non-company hits. The brief gains a dated current status; ranking reads the record newest first. The runner always opens the gate; the reviser is reachable after approval. The back-test gains subject and currency gates.

**Tech Stack:** as the 2026-10-22 plan: TypeScript strict, zod 4, Drizzle, Inngest, Next.js App Router, vitest 4.

**Spec:** `docs/superpowers/specs/2026-10-23-dossier-subject-and-gate-design.md` (amends `docs/superpowers/specs/2026-10-22-dossier-grounded-research-design.md`).

## Global Constraints

- Mock providers by default; no test or e2e run touches the network; every live source takes an injected `fetchImpl`.
- Constants in `packages/schemas`: `CASE_SUBJECT_MIN = 2`, `CASE_SUBJECT_MAX = 120`, `CASE_PEOPLE_MAX = 6`, `CASE_PERSON_MAX = 80`, `CASE_SOURCE_LINKS_MAX = 20`, `PERSON_REFERENCE_CAP = 20`, `DOSSIER_STATUS_MAX = 600`, `BACKTEST_CURRENT_WITHIN_DAYS = 540`, `VERDICT_WORDS = ['convicted', 'found guilty', 'pleaded guilty', 'pled guilty', 'sentenced', 'acquitted', 'fined', 'banned', 'ordered to pay', 'ruled']`.
- Run package suites with `pnpm exec vitest run <path>` from the package directory; the shared test database is re-run alone before a failure is believed; Bash timeout 600000 on long commands.
- Zero-warning lint, strict typecheck, Prettier on tracked files; commits with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; decisions from 311 in PROGRESS.md.
- The dossier markdown subset: headings, lists, paragraphs, `**bold**`, `*italic*`, http links.

## Review Focus

1. A case whose subject is a person-led startup with no Wikipedia company article (resolver finds people but no company): the gather still runs on the owner's links, the people's references and YouTube, and the gate names the unresolved subject. Pinned in Task 4.
2. A reviser run started after approval while the script stage is awaiting review: the project returns to the dossier gate, the script is marked stale, and Approve starts a fresh script. Pinned in Task 5.
3. A brief whose `currentStatus` dates before the turning point (model confusion): accepted, but the renderer shows the date so the reviewer sees it. Pinned in Task 6.
4. A `ruled` claim on a reporting document whose quote says "charged" (not a verdict word): folds to alleged. Pinned in Task 6.
5. A subject naming call that returns a sentence instead of a name: repaired to its first 120 characters and shown on the review screen, never silently used as a search query longer than that. Pinned in Task 3.

---

### Task 1: Schema, migration and case helpers

**Files:**
- Modify: `packages/schemas/src/cases.ts`, `packages/schemas/src/dossier.ts`
- Modify: `packages/db/src/schema.ts` (`cases`), `packages/db/src/cases.ts`, `packages/db/src/fixtures.ts`
- Create: `packages/db/drizzle/0035_*.sql` via `pnpm --filter @boom-busters/db generate`
- Test: `packages/schemas/src/cases.test.ts` (extend or create), `packages/db/src/cases.integration.test.ts` (extend)

**Interfaces:**
- `cases` gains `subject text` (nullable), `people jsonb` (`string[]`, default `[]`), `sourceLinks jsonb` (`{ url: string; note?: string }[]`, default `[]`).
- `CaseInput` and `updateCase`'s patch carry `subject?: string | null`, `people?: string[]`, `sourceLinks?: { url: string; note?: string }[]`.
- `CaseSuggestionSchema` gains `subject: z.string().trim().min(CASE_SUBJECT_MIN).max(CASE_SUBJECT_MAX)` and `people: z.array(z.string().trim().min(2).max(CASE_PERSON_MAX)).max(CASE_PEOPLE_MAX).default([])`.
- `CaseBriefSchema` gains `currentStatus: z.object({ asOf: z.string().regex(/^\d{4}(-\d{2}){0,2}$/), text: z.string().trim().min(20).max(DOSSIER_STATUS_MAX) }).nullable().default(null)`; `GroundedResearchSchema.brief` carries it through unchanged.
- `ResearchEntitySchema` gains `people: z.array(z.object({ name: z.string(), qid: z.string().nullable(), title: z.string().nullable() })).default([])`, `unresolved: z.boolean().default(false)`, `subject: z.string().nullable().default(null)`.
- Fixture case gains `subject: 'Wirecard'`, `people: ['Markus Braun', 'Jan Marsalek']`, `sourceLinks: []`.

- [ ] Step 1: tests (schema parses the new fields with their limits; db round-trips the three columns; `updateCase` patches them).
- [ ] Step 2: run to fail. Step 3: implement; generate and apply the migration (`migrate:test`). Step 4: `pnpm --filter @boom-busters/schemas test`, `pnpm --filter @boom-busters/db test`, typecheck. Step 5: commit `feat(db): case subject, people and source links (migration 0035)`.

### Task 2: Suggestions and the case form

**Files:**
- Modify: `packages/providers/src/prompts/cases.ts` and its test
- Modify: `apps/web/app/(console)/cases/actions.ts` (`CaseFormSchema`, `addCase`, the edit action, `createSuggestedCases` call), `apps/web/app/(console)/cases/case-library.tsx` (form fields), their tests

**Interfaces:**
- Suggestion prompt rules added verbatim: "`title` is a working title: the company and the turn in plain words, no verdicts, no questions, no colon-and-subtitle; the hook belongs to `angle`." and "`subject` is the company's common name as Wikipedia titles it, nothing else; `people` are the main people, at most ${CASE_PEOPLE_MAX}, full names." Output shape gains `"subject": string, "people": [string]`. Repairs: a subject over its limit is cut at the limit with a note; people over the cap are capped with a note.
- Form: `Subject` (required for a new case, prefilled from the title's text before the first colon), `People` (comma separated), `Source links` (one URL per line, each validated as http(s), at most `CASE_SOURCE_LINKS_MAX`); the edit form shows the same three.
- `CaseFormSchema` gains `subject: z.string().trim().min(CASE_SUBJECT_MIN).max(CASE_SUBJECT_MAX)`, `people: z.array(...).max(CASE_PEOPLE_MAX).default([])`, `sourceLinks: z.array(z.object({ url: z.string().url(), note: z.string().max(500).optional() })).max(CASE_SOURCE_LINKS_MAX).default([])`.

- [ ] Step 1: tests (the prompt carries both rules; a suggestion without `subject` is refused; the form rejects a non-http source link; the add action stores the three fields). Step 2: fail. Step 3: implement. Step 4: providers and web tests for the touched files, typecheck, lint. Step 5: commit `feat(cases): subject, people and source links on a case`.

### Task 3: Naming a subject for a case that has none

**Files:**
- Create: `packages/providers/src/prompts/subject.ts` (+ test), `apps/web/inngest/lib/name-subject.ts` (+ test)
- Modify: `apps/web/inngest/functions/dossier-runner.ts` and `dossier-reviser.ts` (`load-case`), `packages/providers/src/prompts/index.ts`

**Interfaces:**
- `buildNameSubjectRequest(input: { title: string; angle: string | null; category: string }): LLMTaskRequest` on task `digest`, asking for `{"subject": string, "people": [string]}` with the same two rules as Task 2; `parseNameSubject(text, note?)` repairs as Task 2; `mockNameSubject(title)` returns `{ subject: <text before the first colon, or the title>, people: [] }`.
- `nameSubjectIfMissing(db, caseRow, deps: { complete: AnswerComplete; mocked: boolean }): Promise<{ subject: string; people: string[] }>`: returns the stored values when `subject` is set; otherwise one `callForAnswer`, stores the result with `updateCase`, returns it.
- `load-case` in both functions calls it inside the step and returns `subject`, `people`, `sourceLinks` beside the existing fields.

- [ ] Step 1: tests (prompt shape; a sentence-long subject is cut to 120 with a note; `load-case` stores a named subject once and reuses it on replay). Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint. Step 5: commit `feat(dossier): name a case's subject when it has none`.

### Task 4: Resolve from the subject; people, owner sources and ranking

**Files:**
- Modify: `apps/web/inngest/lib/dossier-discover.ts` (+ test), `apps/web/inngest/lib/dossier-gather.ts` (+ test), `apps/web/lib/research-sources.ts` if a source is missing, `packages/providers/src/research/rank.ts` (+ test)
- Modify: `packages/case-finder/src/sources/wikidata.ts` only if `instanceOf` does not already expose Q5 (human); otherwise none

**Interfaces:**
- `resolveEntity(sources, input: { subject: string; people: readonly string[] }): Promise<ResolvedEntity>`: search the subject (top five), first hit whose `instanceOf` contains a `BUSINESS_CLASSES` entry; none → `unresolved: true`, `titles: []`, `qid: null`; `relatedTitles` as before from the subject's hits; for each person: search the name (top three), first hit whose `instanceOf` contains `Q5`, record `{ name, qid, title }`.
- `discoverCandidates(sources, entity, input: { competitorLinks; sourceLinks; subject })`: owner `sourceLinks` first as tier 1, kind `reporting`, `meta: { pinned: true }`; when unresolved, no Wikipedia references for the company; each resolved person's article references join tier 2 under `PERSON_REFERENCE_CAP`; YouTube search uses `subject`.
- `rankCorpus` options gain `pinnedFirst` behaviour: within a tier, documents with `meta.pinned` (passed as a `pinned: boolean` on `RankableDocument`) come first; tier 5 is ordered newest first regardless of the anchor; tier 2 is ordered by interleaving nearest-the-anchor and newest (first nearest, then newest, alternating, each list skipping documents already taken).
- `gatherCorpus` input gains `subject`, `people`, `sourceLinks`; the entity step stores `subject` and `people` on the entity; the gate summary (Task 5) reads them.

- [ ] Step 1: tests (subject resolves to the business hit; an editorial headline as subject with no business hit → unresolved and no company references; a person resolves to a Q5 hit and contributes references capped at 20; owner links are tier 1 pinned and ranked first; tier 5 newest first; tier 2 interleaved). Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint. Step 5: commit `feat(dossier): resolve the subject, read the people and the owner's sources, run the record to today`.

### Task 5: The gate always opens; request changes at any time

**Files:**
- Modify: `apps/web/inngest/functions/dossier-runner.ts` (remove the auto-approve branch; the gate summary opens with `Subject: <subject>` and the people, or `Subject not found on Wikipedia: check the case's Subject` when unresolved), `apps/web/inngest/lib/dossier-research.ts` (`gateSummary`), `apps/web/inngest/functions/dossier-reviser.ts` (works when the project is past the dossier stage: it re-opens the dossier gate with `projectStage: 'dossier'`; verify `openReviewGate` sets the stage and that the script's staleness derives from `dossiers.version`), `apps/web/app/(console)/projects/[id]/project-controls.tsx` and `actions.ts` (`requestChanges` for the dossier is allowed whenever a dossier exists and no dossier run is active; the bar shows the note box on the dossier section in those states), tests for each.
- Modify: `e2e/tests/writing-room.spec.ts` only if an assertion depended on auto-approval.

- [ ] Step 1: tests (a fully grounded dossier still opens the gate; the summary names the subject; an unresolved subject's summary says so; `requestChanges` after approval emits the event and the reviser re-opens the gate with the script marked stale; Approve after that re-emits `gate/dossier.approved`). Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint. Step 5: commit `feat(dossier): the gate always opens; changes can be requested after approval`.

### Task 6: Where it stands now; verdicts reported by the press

**Files:**
- Modify: `packages/providers/src/prompts/dossier.ts` (case header shows `Subject:` and `People:` and `Working title:`; brief pass asks for `currentStatus` with the rule "dated from the newest document that speaks to the outcome; null when the documents say nothing after the turn"), `dossier-render.ts` (`## Where it stands now` with the date in bold, after `## The turn`), `packages/providers/src/research/ground.ts` (`ruled` on a `reporting` document is kept when the claim text or any support quote contains a `VERDICT_WORDS` entry, case-insensitive; otherwise folds as before), their tests; `dossier-mocks.ts` (mock brief carries a status).
- Check: no legal label appears in the rendered dossier (it does not today; add a test that pins it).

- [ ] Step 1: tests (prompt sentences; render section and ordering; a status dated before the turn still renders with its date; ruled kept on "was convicted", folded on "was charged"). Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint. Step 5: commit `feat(dossier): where it stands now; a reported verdict counts as ruled`.

### Task 7: The review screen names the subject

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/dossier-review.tsx` (+ test), `page.tsx` (passes the case id for the edit link).

**Interfaces:**
- Above the corpus line: `Subject: <subject> (company), <person> (person), ...` from `research.entity`; when `unresolved`, the line reads `Subject not found on Wikipedia: <subject>` in the warning colour; beside it a `Research again` button (calls `restartStage(projectId, 'dossier')` with the existing confirm) and an `Edit case` link to `/cases?edit=<caseId>` (or the library's existing edit affordance; use what exists).

- [ ] Step 1: component tests (resolved line; unresolved warning; buttons present and 40 px). Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint. Step 5: commit `feat(web): the dossier review names its subject`.

### Task 8: Back-test subjects and currency; docs

**Files:**
- Modify: `apps/web/lib/dossier-backtest.ts` (+ test), `apps/web/scripts/live-dossier-backtest.ts`, `PROGRESS.md`, `docs/03-build-spec.md` (one amendment sentence), `.env.example` unchanged.

**Interfaces:**
- `BACKTEST_CASES` entries gain `subject`, `people`, `expectedTitle`, `recentOutcome`: Wirecard (subject Wirecard, people Markus Braun and Jan Marsalek, expected "Wirecard", recent false), Enron (Enron; Kenneth Lay, Jeffrey Skilling; "Enron"; false), Theranos (title "Theranos on the Record: Why the Jury Convicted Elizabeth Holmes for Defrauding Investors but Not Patients"; subject Theranos; people Elizabeth Holmes, Ramesh Balwani; expected "Theranos"; true), FTX (FTX; Sam Bankman-Fried; "FTX"; true), SVB Financial (SVB Financial Group; Greg Becker; "Silicon Valley Bank"; false).
- `CaseRun` gains `resolvedTitle: string | null`, `currentStatusAsOf: string | null`; `scoreRuns` fails by name `subject: <case> resolved to <title>` and `currentStatus: <case> has none` or `... dated <date>, older than 540 days`; `renderReport` adds a Subject table (expected, resolved) and a Current status table.
- PROGRESS: decisions 311 (gate always opens), 312 (subject separate from title; naming call for old cases), 313 (people and owner sources; record newest first), 314 (where it stands now; reported verdicts are ruled), 315 (back-test subject and currency gates), with the owner's words from the spec.

- [ ] Step 1: tests. Step 2: fail. Step 3: implement. Step 4: tests, typecheck, lint, then `pnpm typecheck`, scoped lint, prettier on tracked files, the four package suites, `pnpm e2e`. Step 5: commit `feat(backtest): subject and currency gates; decisions 311 to 315`.
