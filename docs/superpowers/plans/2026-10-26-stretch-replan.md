# Short Shots and the Stretch Re-plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag shots that are too short or share a sentence, repair them once automatically at planning, and let the owner re-plan any run of neighbouring shots in one chapter from the plan screen or the board.

**Architecture:** Two pure layers first: word ranges for each shot's quote (timeline package) and timing findings plus stretch cutting over them (apps/web/inngest/lib). The planner gains a stretch request built on the chapter's own shot-list request, answered through the existing two-call ladder with a validator that refuses answers that leave the stretch or overlap. A new Inngest function `stretch-replanner` writes the answer over the old rows in one transaction; the board gains selection, a re-plan bar and timing notes.

**Tech Stack:** TypeScript, Next.js App Router server actions, Inngest, Drizzle/Postgres, Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-10-26-stretch-replan-design.md`

## Global Constraints

- Minimum on-screen time by shot type: `headline` 5 s, `social` 5 s, `chart` 4 s, `map` 4 s, `stock`, `archival`, `still`, `graphic` 3 s (`hero` 3 s, same as stills).
- A shot alone in its paragraph, in a paragraph shorter than its minimum, is never flagged too short.
- Re-plan selections: one or more shots, adjacent, one chapter, while `visualsPhase` is `plan` or `board`.
- A failed, refused or budget-stopped stretch re-plan leaves every old row exactly as it was.
- Nothing outside the stretch is changed, re-fetched or re-timed.
- Mock-provider mode is the default for every test and e2e run; no paid call in development.
- `'use server'` modules export only async functions.
- Run `pnpm format:check` (tracked files only) before every commit; lint and typecheck are zero-warning.
- Database suites run one at a time, Bash `timeout` 600000; scope a vitest run with `pnpm exec vitest run <basename>` from the package directory.
- New UI copy: no em or en dashes, South African spelling.
- Decisions go in PROGRESS.md from the next free number on `origin/master` at merge time (316 is the last today).

## Review Focus

1. **A chapter that already has a headline outside the stretch.** The planner must be told not to plan one, and an answer with a headline must be refused, since `plannedToRows` counts its cap from zero and would let a second headline through. Test in Task 5.
2. **A selected shot that lends its picture to an unselected shot ("Use an existing shot").** The borrower loses its link when the row goes; the bar must say so before sending. Tests in Task 6 (FK) and Task 10 (confirm line).
3. **Narration with no word timings** (takes stored before timings existed, the seeded e2e boards). The stretch cannot be cut; the action refuses in words and no call is made. Tests in Task 3 and Task 8.
4. **A stretch at a chapter edge**: first selected shot is the chapter's first, or the last selected is the chapter's last (the stretch then runs to the end of the chapter's last paragraph). Tests in Task 3.
5. **Two jobs at once**: a stretch over a shot with a refetch in flight, a stretch while Fetch visuals or Re-plan shot list is running, and Re-plan shot list pressed while a stretch runs. All refused. Tests in Task 8.

---

### Task 1: Shared constants and quote word ranges

**Files:**
- Modify: `packages/schemas/src/visuals.ts` (near `SlotJobSchema`, line ~682)
- Modify: `packages/timeline/src/anchor.ts`
- Test: `packages/schemas/src/visuals.test.ts`, `packages/timeline/src/anchor.test.ts`

**Interfaces:**
- Produces: `MIN_SHOT_SECONDS: Record<ShotBrief['type'], number>` from `@boom-busters/schemas`.
- Produces: `SlotJobSchema.kind` accepts `'stretch'` (enum becomes `['refetch', 'redirect', 'stretch']`).
- Produces: `interface WordRange { first: number; last: number }` and `anchorWordRanges(slots: readonly AnchorableSlot[], words: readonly AnchorWord[], paragraphs: readonly ParagraphSpan[]): (WordRange | null)[]` from `@boom-busters/timeline`. Indexes are into `words`, inclusive, in input order; `null` when the quote is not found.

- [ ] **Step 1: Write the failing tests**

```ts
// visuals.test.ts
it('holds the minimum seconds for every shot type', () => {
  expect(MIN_SHOT_SECONDS).toEqual({
    headline: 5, social: 5, chart: 4, map: 4,
    stock: 3, archival: 3, still: 3, graphic: 3, hero: 3,
  })
})
it('accepts a stretch job on a slot', () => {
  expect(SlotJobSchema.parse({ kind: 'stretch', jobId: newId(), startedAt: new Date().toISOString() }).kind).toBe('stretch')
})

// anchor.test.ts — the Theranos pair from the spec, 17 words, 500 ms apart
const text = 'Other tallies went higher. In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.'
const words = text.split(' ').map((t, i) => ({ text: t, startMs: i * 500 }))
const spans = [{ startMs: 0, endMs: 8_500 }]
it('gives each quote its first and last word', () => {
  const ranges = anchorWordRanges(
    [{ startMs: 0, durationMs: 2_000, coversText: text },
     { startMs: 2_000, durationMs: 6_500, coversText: 'In 2021, CNBC reported that Holmes persuaded investors to put up 945 million.' }],
    words, spans)
  expect(ranges).toEqual([{ first: 0, last: 16 }, { first: 4, last: 16 }])
})
it('returns null for a quote that is not spoken', () => { /* coversText 'Nothing like this was said' → [null] */ })
it('clamps a range that matched only its opening to the paragraph end', () => { /* opening 3 tokens match, quote longer than what remains → last === 16 */ })
it('anchorSlots still moves starts exactly as before', () => { /* existing anchorSlots tests stay green unchanged */ })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm exec vitest run visuals.test` in `packages/schemas`, `pnpm exec vitest run anchor.test` in `packages/timeline`
Expected: FAIL, `MIN_SHOT_SECONDS` and `anchorWordRanges` not exported.

- [ ] **Step 3: Implement**

`MIN_SHOT_SECONDS` beside `SlotJobSchema` with a doc comment citing the spec. In `anchor.ts`, pull the per-slot loop of `anchorSlots` into one private walker that returns both the start and the matched word index, so `anchorSlots` and `anchorWordRanges` share the same floor and paragraph rules. `last = min(first + tokens.length - 1, until - 1)`.

- [ ] **Step 4: Run to verify they pass** (same commands). Expected: PASS, and the full timeline suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src/visuals.ts packages/schemas/src/visuals.test.ts packages/timeline/src/anchor.ts packages/timeline/src/anchor.test.ts
git commit -m "feat(timeline): word ranges for each shot's quote; minimum seconds per shot type"
```

---

### Task 2: Timing findings

**Files:**
- Create: `apps/web/inngest/lib/timing-findings.ts`
- Test: `apps/web/inngest/lib/timing-findings.test.ts`

**Interfaces:**
- Consumes: `MIN_SHOT_SECONDS`, `anchorWordRanges` (Task 1); `TimedParagraph` from `./shot-list`.
- Produces:

```ts
export interface TimingSlot {
  chapterId: string
  type: string
  /** Anchored, as `anchoredTimes` returns them. */
  startMs: number
  durationMs: number
  coversText: string | null
}
export type TimingFindingKind = 'too-short' | 'shared-sentence'
export interface TimingFinding {
  kind: TimingFindingKind
  chapterId: string
  /** Input indexes the note is about: one for too-short, two for shared-sentence. */
  slotIndexes: number[]
  /** Input indexes a repair re-plans: contiguous, one chapter, ascending. */
  stretch: number[]
  message: string
}
/** Slots in screen order (chapter, then index). */
export function timingFindings(slots: readonly TimingSlot[], paragraphs: readonly TimedParagraph[]): TimingFinding[]
/** Stretches merged where they share or touch an index inside one chapter. */
export function repairStretches(findings: readonly TimingFinding[]): number[][]
```

Rules (spec 3.1, 3.2):
- Too short: `durationMs < MIN_SHOT_SECONDS[type] * 1000`, except a shot that is the only one starting in its paragraph when that paragraph's `durationMs` is under the minimum. Stretch: the shot and the next shot in the chapter if that one starts in the same paragraph; else the previous one if it starts in the same paragraph; else the shot alone.
- Shared sentence: consecutive shots in one chapter whose `anchorWordRanges` overlap (`a.last >= b.first`). No finding when either range is `null` or the paragraphs carry no words. Stretch: both.
- Messages, exact:
  - too short: `` `this ${TYPE_WORDS[type]} is on screen for ${seconds} s; it needs at least ${min} s` `` with `seconds` to one decimal and `TYPE_WORDS` = `{ headline: 'news headline', social: 'Post on X', chart: 'chart', map: 'map', stock: 'stock shot', archival: 'real footage shot', still: 'AI image', graphic: 'graphic', hero: 'hero shot' }`.
  - shared: `` `this shot and the next both quote "${firstSixWords}…"; one sentence needs one shot` `` where `firstSixWords` is the opening of the later shot's quote.

- [ ] **Step 1: Write the failing tests**

```ts
// Same 17-word paragraph as Task 1, chapter 'c1'; A headline 0..2000, B stock 2000..8500.
it('flags the Theranos headline as too short and the pair as sharing a sentence', () => {
  const found = timingFindings([A, B], [paragraph])
  expect(found.map((f) => [f.kind, f.slotIndexes, f.stretch])).toEqual([
    ['too-short', [0], [0, 1]],
    ['shared-sentence', [0, 1], [0, 1]],
  ])
  expect(found[0]!.message).toBe('this news headline is on screen for 2.0 s; it needs at least 5 s')
})
it('does not flag a lone shot in a paragraph shorter than its minimum', () => { /* 2 s paragraph, one stock shot → [] */ })
it('re-plans the previous shot with the last shot of a paragraph', () => { /* short last shot → stretch [prev, it] */ })
it('never builds a stretch across chapters', () => { /* short last shot of c1, next is c2's first → stretch [prev in c1, it] or [it] */ })
it('finds no shared sentence without word timings', () => { /* words: [] → no shared-sentence finding */ })
it('merges touching stretches into one', () => {
  expect(repairStretches([f([0, 1]), f([1, 2]), f([4, 5])])).toEqual([[0, 1, 2], [4, 5]])
})
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run timing-findings` in `apps/web`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** the two functions in `timing-findings.ts`.
- [ ] **Step 4: Run to verify they pass.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(visuals): timing findings, too short and one sentence twice`

---

### Task 3: Cutting a stretch and checking an answer against it

**Files:**
- Create: `apps/web/inngest/lib/stretch.ts`
- Test: `apps/web/inngest/lib/stretch.test.ts`

**Interfaces:**
- Consumes: `anchorWordRanges` (Task 1), `timingFindings` (Task 2), `TimedParagraph`.
- Produces:

```ts
export interface StretchPiece { paragraphIndex: number; text: string; seconds: number }
export interface Stretch {
  chapterId: string
  /** Inclusive indexes into paragraphs.flatMap((p) => p.words). */
  firstWord: number
  lastWord: number
  startMs: number
  endMs: number
  pieces: StretchPiece[]
  /** The stretch's opening words, which the first new quote must start with. */
  opening: string
}
export interface StretchRow { id: string; chapterId: string; index: number; type: string; brief: unknown; startMs: number; durationMs: number; coversText: string | null }
export function cutStretch(input: {
  /** Every row of the selected chapter, screen order, anchored times. */
  chapterRows: readonly StretchRow[]
  selectedIds: readonly string[]
  paragraphs: readonly TimedParagraph[]
}): { ok: true; stretch: Stretch; before: StretchRow | null; after: StretchRow | null } | { ok: false; refused: string }

export function stretchAnswerIssue(input: {
  stretch: Stretch
  rows: readonly { type: string; startMs: number; durationMs: number; coversText: string | null }[]
  /** Slots the answer held before conversion, and why any were dropped. */
  planned: number
  rejected: readonly { reason: string }[]
  paragraphs: readonly TimedParagraph[]
  headlineAllowed: boolean
  /** Timing findings refuse the answer only on the first attempt (spec 3.3). */
  strictTiming: boolean
}): string | null
```

Cut rules: the stretch starts at the first word at or after the first selected row's anchored `startMs`, and ends on the word before the first unselected row after the selection (or the chapter's last paragraph's last word). `pieces` group the stretch's words by paragraph, text joined with single spaces, seconds from the piece's first word to the next word's start (or the paragraph end). `opening` is the first six words.

Refusals, exact copy:
- not adjacent or empty: `'Re-plan works on neighbouring shots in one chapter.'`
- an id outside the chapter: same copy.
- no words in any stretch paragraph: `'This narration has no word timings, so a stretch cannot be cut. Use Re-plan shot list instead.'`

Answer issues (returned strings become the refusal reason the ladder sends back): a dropped slot (`planned !== rows.length`: name each `rejected.reason`); a quote not found; a quote outside the stretch; the first quote not starting at `firstWord`; quotes out of order or overlapping; a headline when `!headlineAllowed`; and, when `strictTiming`, any timing finding on the new rows (its message).

- [ ] **Step 1: Write the failing tests**

```ts
it('cuts the Theranos pair to the whole CNBC paragraph', () => {
  const cut = cutStretch({ chapterRows: [A, B, C], selectedIds: [A.id, B.id], paragraphs })
  expect(cut).toMatchObject({ ok: true, before: null, after: { id: C.id },
    stretch: { firstWord: 0, lastWord: 16, pieces: [{ paragraphIndex: 0, seconds: 8.5 }] } })
})
it('runs a stretch ending on the chapter's last shot to the end of its paragraph', () => { /* select [C] → lastWord = last word of C's paragraph, after: null */ })
it('refuses a selection with a gap', () => { /* [A, C] → refused 'Re-plan works on neighbouring shots in one chapter.' */ })
it('refuses narration without word timings', () => { /* words [] → the no-timings copy */ })
it('accepts two quotes that start at the stretch and do not overlap', () => { /* → null */ })
it('refuses a quote outside the stretch', () => { /* quote from paragraph 1 → issue names it */ })
it('refuses an answer that lost a slot in conversion', () => { /* planned 3, rows 2, rejected [{reason: 'chapter already has 1 headline shot, which is the cap'}] → issue contains that reason */ })
it('refuses a headline where the chapter already has one', () => { /* headlineAllowed false → issue */ })
it('refuses a too-short new shot only on the first attempt', () => { /* strictTiming true → issue; false → null */ })
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run stretch.test` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** `cutStretch` and `stretchAnswerIssue`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(visuals): cut a stretch from a selection and check an answer against it`

---

### Task 4: The stretch request, the planning rules and the mock answers

**Files:**
- Create: `packages/providers/src/prompts/stretch.ts`
- Modify: `packages/providers/src/prompts/shotlist.ts` (planning rules at line ~319; `mockShotList` from line ~591)
- Modify: `packages/providers/src/prompts/index.ts` (export the new module)
- Test: `packages/providers/src/prompts/stretch.test.ts`, `packages/providers/src/prompts/shotlist.test.ts`

**Interfaces:**
- Consumes: `MIN_SHOT_SECONDS` (Task 1), `splitSentences` from `@boom-busters/schemas`, `shotListAnswerTokens`, `outputBudget`.
- Produces:

```ts
export interface StretchRequestInput {
  pieces: readonly { paragraphIndex: number; text: string; seconds: number }[]
  opening: string
  before: unknown | null
  after: unknown | null
  headlineAllowed: boolean
  /** The owner's note from the bar; absent when the box was empty. */
  note?: string
  /** Why the app is re-planning it unasked (automatic repair, spec 3.2). */
  reason?: string
}
/** Built on the chapter's own shot-list request, so rules and cached prefix are the plan's. */
export function buildStretchRequest(base: LLMTaskRequest, input: StretchRequestInput): LLMTaskRequest
/** Mock answer: one slot per sentence, at most two, first quoting from `opening`. */
export function mockStretchPlan(input: Pick<StretchRequestInput, 'pieces'>): { slots: PlannedSlot[] }
export const MIN_SHOT_RULE: string
```

`buildStretchRequest` appends one user message to `base.messages` (keep `cacheablePrefixMessages`), sets `maxTokens` to `outputBudget(shotListAnswerTokens(pieces as ShotParagraph-shaped))`. The message says, in this order: re-plan ONLY the stretch below and nothing else in the chapter; the stretch pieces as `[paragraph N, Ms]\n<text>`; the shot before and after as JSON, read only, for continuity; the first slot's `coversText` must start with `opening`; quotes in narration order, every sentence quoted by exactly one shot; the minimums (`MIN_SHOT_RULE`); "Do not plan a headline shot." when `!headlineAllowed`; `Producer's note: ${note}` when present; `Why: ${reason}` when present; `Return JSON: {"slots": [...]}`.

`MIN_SHOT_RULE` is also added to the chapter planning rules after "A slot runs 4-15 seconds", together with: `- Every sentence is quoted by exactly one slot: never start a slot's "coversText" inside the sentence another slot quotes.`

`mockShotList` rewrite (spec 5): each slot on a paragraph quotes its own sentence from `splitSentences(paragraph.text)` in order, and its `seconds` is its share of the paragraph. An extra slot (chart, map, headline, social, graphic) that finds no free sentence on its paragraph moves to the next paragraph with one; the existing claim and ref conditions for each extra are unchanged.

- [ ] **Step 1: Write the failing tests**

```ts
it('appends the stretch to the chapter request and keeps its prefix', () => {
  const req = buildStretchRequest(base, input)
  expect(req.messages.slice(0, base.messages.length)).toEqual(base.messages)
  expect(req.cacheablePrefixMessages).toBe(base.cacheablePrefixMessages)
  const last = req.messages.at(-1)!.content
  expect(last).toContain('[paragraph 0, 9s]')
  expect(last).toContain('must start with "Other tallies went higher. In 2021,"')
  expect(last).toContain("Producer's note: keep the headline card up through the CNBC line")
})
it('forbids a headline when the chapter already has one', () => { /* headlineAllowed false → 'Do not plan a headline shot.' */ })
it('puts the minimums in the chapter planning rules', () => { /* buildShotListRequest(...).system contains MIN_SHOT_RULE and 'exactly one slot' */ })
it('gives each mock slot its own sentence', () => {
  const { slots } = mockShotList({ paragraphs: threeSentenceParagraphs, claimCount: 2, newsClaimRefs: [1], socialClaimRefs: [2], claimTexts: ['Revenue fell 40%', 'x'] })
  const quotes = slots.map((s) => s.brief.coversText)
  expect(new Set(quotes).size).toBe(quotes.length)
  expect(slots.map((s) => s.brief.type)).toEqual(expect.arrayContaining(['chart', 'map', 'headline', 'social', 'graphic']))
})
it('mocks a stretch as at most two slots, the first quoting the opening', () => { /* mockStretchPlan */ })
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run stretch.test shotlist.test` in `packages/providers`.
- [ ] **Step 3: Implement** the module, the rule lines and the mock rewrite.
- [ ] **Step 4: Run the whole providers suite** (`pnpm --filter @boom-busters/providers test`). Expected: PASS; any mock-shape test that asserted the old shared quote is updated to the new one, not deleted.
- [ ] **Step 5: Commit** `feat(providers): the stretch request, one sentence per slot, mock quotes its own sentence`

---

### Task 5: Planning a stretch, and the automatic timing repair

**Files:**
- Create: `apps/web/lib/plan-stretch.ts`
- Modify: `apps/web/lib/plan-chapter.ts` (`planChapterWith`)
- Modify: `apps/web/inngest/lib/shot-list.ts` (`plannedToRows` returns `from`)
- Test: `apps/web/lib/plan-stretch.test.ts`, `apps/web/lib/plan-chapter.test.ts`

**Interfaces:**
- Consumes: `CompleteFn`, `PlanChapterInput`, `chapterShotListRequest` (plan-chapter.ts); `cutStretch`, `stretchAnswerIssue`, `Stretch` (Task 3); `timingFindings`, `repairStretches` (Task 2); `buildStretchRequest` (Task 4); `callForAnswer`, `answerOrStop`; `parseShotList`; `plannedToRows`, `anchoredTimes`.
- Produces:

```ts
export interface PlanStretchInput extends PlanChapterInput {
  stretch: Stretch
  before: unknown | null
  after: unknown | null
  headlineAllowed: boolean
  note?: string
  reason?: string
  /** Index the new rows start from; `replaceStretch` renumbers anyway. */
  startIndex: number
}
export type StretchOutcome =
  | { ok: true; slots: PlannedSlot[]; rows: NewShotSlot[] }
  | { ok: false; issue: string }
export async function planStretchWith(complete: CompleteFn, input: PlanStretchInput): Promise<StretchOutcome>
```

`CompleteFn`'s purpose union gains `'stretch'`. `planStretchWith` calls `callForAnswer` with `parse` = `parseShotList` → `plannedToRows` (with `startIndex`) → `stretchAnswerIssue` (strictTiming true on the first parse, false after) → throw `ValidationError(issue)`; banned words stripped as in chapter planning; the brief repair (`repairPlannedChapter`) runs on the accepted slots. A stopped ladder returns `{ ok: false, issue }`, never throws for an answer problem.

`PlannedConversion` gains `from: number[]`: for each row, the index in `input.planned` it came from (rows are sorted by paragraph and some slots are dropped, so row and slot positions differ).

In `planChapterWith`, after the brief repair: time the slots with `plannedToRows`, run `timingFindings` and `repairStretches`; for each stretch (in reverse order, so earlier indexes hold) cut it with `cutStretch` over the planned rows (ids are synthetic, `String(rowIndex)`), map its rows back through `from` to the planned slots they replace, call `planStretchWith` with `reason` = the findings' messages joined by `; ` and `headlineAllowed` = no headline among the chapter's slots outside the stretch, and splice the answer's slots over the stretch's. A stopped stretch keeps its slots. One pass only (spec 3.2).

- [ ] **Step 1: Write the failing tests**

```ts
// plan-stretch.test.ts, with a scripted complete()
it('returns new rows for an answer that covers the stretch', async () => { /* → ok, rows anchored inside stretch */ })
it('asks once more when a slot is dropped in conversion, then stops with the reason', async () => {
  const outcome = await planStretchWith(alwaysTwoHeadlines, { ...input, headlineAllowed: false })
  expect(outcome).toEqual({ ok: false, issue: expect.stringContaining('headline') })
  expect(calls).toEqual(['stretch', 'retry: refused'])
})
it('accepts a too-short shot on the second answer and leaves it flagged', async () => { /* first answer short → refused; second short → ok */ })
it('sends the owner note and the before and after briefs', async () => { /* inspect captured request */ })

// plan-chapter.test.ts
it('re-plans the Theranos pair once after planning', async () => {
  // first call: chapter plan with the overlapping headline + stock; second: brief repair skipped (clean);
  // third: stretch answer with one headline quoting the whole paragraph
  const planned = await planChapterWith(scripted, theranosInput)
  expect(planned!.slots.map((s) => s.brief.type)).toEqual(['headline'])
  expect(purposes).toEqual(['plan', 'stretch'])
})
it('keeps the planned slots when the timing repair stops', async () => { /* stretch refused twice → original two slots */ })
it('makes no extra call for a chapter with no timing finding', async () => { /* purposes ['plan'] */ })
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run plan-stretch plan-chapter` in `apps/web`.
- [ ] **Step 3: Implement.** Route `'stretch'` in `planChapterSlots`'s `callLlm` purpose mapping (apps/web/inngest/lib/direction.ts ~line 318) so the ledger records it.
- [ ] **Step 4: Run to verify they pass**, then `apps/web/scripts/live-plan-test.ts` typechecks (`pnpm typecheck`).
- [ ] **Step 5: Commit** `feat(visuals): plan a stretch; one automatic timing repair per chapter`

---

### Task 6: Writing a stretch over the old rows

**Files:**
- Modify: `packages/db/src/visuals.ts`
- Test: `packages/db/src/visuals.integration.test.ts`

**Interfaces:**
- Produces:

```ts
/**
 * Delete `removeIds` and insert `rows` in their place in one transaction, then
 * renumber the chapter's `index` by start time so `shot_slots_chapter_index_key`
 * holds. Refuses (throws) when any id is not in `chapterId`, or when any of
 * them no longer carries `pendingJob.jobId === jobId` (a Stop or another job
 * got there first). Returns the new rows' ids in order.
 */
export async function replaceStretch(db: Database, input: {
  projectId: string
  chapterId: string
  removeIds: readonly string[]
  rows: readonly NewShotSlot[]
  jobId: string
}): Promise<string[]>
```

Renumbering: move the chapter's surviving rows to negative indexes first, then assign `0..n-1` by `startMs`, in the same transaction.

- [ ] **Step 1: Write the failing tests**

```ts
it('replaces two rows with one and renumbers the chapter', async () => { /* indexes [0,1,2,3] → remove 1,2, insert one → [0,1,2], others' ids, briefs, candidates unchanged */ })
it('leaves another chapter untouched', async () => {})
it('nulls the link of a row that borrowed from a removed row', async () => { /* reuseOfSlotId → null; its candidates kept */ })
it('changes nothing when a row lost its stretch stamp', async () => { /* pendingJob cleared → throws; rows unchanged */ })
```

- [ ] **Step 2: Run to verify they fail.** Docker Desktop running; `pnpm exec vitest run visuals.integration` in `packages/db`, timeout 600000.
- [ ] **Step 3: Implement** `replaceStretch` and export it from the package index.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(db): replace a stretch of shot rows in one transaction`

---

### Task 7: The `stretch-replanner` function

**Files:**
- Modify: `packages/schemas/src/events.ts`, `apps/web/inngest/events.ts`
- Create: `apps/web/inngest/functions/stretch-replanner.ts`
- Modify: `apps/web/inngest/functions/index.ts`, `apps/web/inngest/lib/jobs.ts`
- Test: `apps/web/inngest/functions/stretch-replanner.test.ts`, `packages/schemas/src/events.test.ts`

**Interfaces:**
- Consumes: `planStretchWith` (Task 5), `cutStretch` (Task 3), `replaceStretch` (Task 6), `designPlannedGraphics`, `markSideJobFailed`, `budgetGateData`, the setup loaders used by `visuals-replanner` (`load-plan-inputs`).
- Produces:

```ts
// schemas/events.ts
export const VisualsStretchRequestedSchema = z.object({
  ...projectRef,
  chapterId: UlidSchema,
  slotIds: z.array(UlidSchema).min(1),
  note: z.string().max(500).optional(),
  jobId: UlidSchema,
})
// registered as 'visuals/stretch.requested'; apps/web events: visualsStretchRequested
// jobs.ts
export async function releaseFailedStretchJob(data: Record<string, unknown>): Promise<void>
export const stretchReplanner: InngestFunction
```

Function config: `id: 'stretch-replanner'`, `name: 'Stretch re-plan'`, `retries: 2`, `concurrency: [{ key: 'event.data.chapterId', limit: 1 }]` (serialises one chapter, never cancels; spec 3.3), `cancelOn` `project/cancelled` as the replanner does, `onFailure` releases every stamped slot and calls `markSideJobFailed(..., 'The stretch re-plan failed', ...)`.

Steps, each its own `step.run` (computed inside steps; see the parked-runs rule):
1. `check-phase`: phase is `plan` or `board`, else outcome `not-open`.
2. `load-plan-inputs`: same shape as visuals-replanner's setup.
3. `cut`: anchored chapter rows (`anchoredTimes`), `cutStretch`; refusal → `markSideJobFailed(ctx, 'The stretch re-plan stopped', { message }, slotSubject(first id))`, outcome `refused`.
4. `plan`: `planStretchWith` bound to `callLlm` with `purpose: 'stretch'`; in mock mode, bound instead to a `complete` that returns `JSON.stringify(mockStretchPlan({ pieces }))`, so the mock answer goes through the same parse and validator. Budget → gate words, outcome `over-budget`. `{ ok: false }` → words `` `${issue}. The shots you had are kept.` ``, outcome `stopped`.
5. Graphics: `designPlannedGraphics` with prefix `stretch-graphic`.
6. `write`: `replaceStretch` with the event's `jobId`.
7. Board phase only: for each new row that is not `archival`, stamp a `refetch` job and send `visuals/refetch.requested` with note `'Stretch re-plan'` (one resolution path, the slot-refetcher).
8. `notify` heads-up: `` `${removed} shots re-planned as ${added}` `` with `href` to the project.

- [ ] **Step 1: Write the failing tests** (mirror `visuals-replanner.test.ts` setup: seeded project, `InngestTestEngine`, mock providers)

```ts
it('replaces only the selected rows on the board and fetches the new ones', async () => { /* ids outside unchanged, refetch events sent for new non-archival rows */ })
it('replaces the rows at the plan checkpoint without fetching', async () => { /* no refetch events */ })
it('keeps the rows and says why when the budget stops it', async () => {})
it('keeps the rows when the answer is refused twice', async () => {})
it('refuses narration without word timings in words', async () => {})
it('runs two stretches in one chapter one after the other', async () => { /* both land, indexes contiguous */ })
it('releases every stamp when it fails past its retries', async () => {})
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run stretch-replanner` in `apps/web`, timeout 600000.
- [ ] **Step 3: Implement**, register in `functions/index.ts`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(visuals): stretch-replanner re-plans selected neighbouring shots`

---

### Task 8: The action and its refusals

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts`
- Test: `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts`

**Interfaces:**
- Consumes: `visualsStretchRequested` (Task 7), `cutStretch` (Task 3), `setSlotJob`.
- Produces:

```ts
export async function replanStretchAction(projectId: string, slotIds: string[], note: string): Promise<ActionResult>
```

Refusals, exact copy, checked in this order:
- phase not `plan` or `board`: `'The visuals stage is not open on this project.'`
- `project.visualsJob` set (fetch, re-plan, redraft, fix in flight): `'Wait for the running plan job to finish.'`
- any selected row with a live `pendingJob` (not stale by `JOB_STALE_MS`): `'One of these shots is still busy. Wait for it to finish.'`
- `cutStretch` refusal: its own copy.
- note over 500 characters: `'Keep the note under 500 characters.'`

Then stamp `{ kind: 'stretch', jobId, startedAt }` on every selected row, send the event (on send failure clear the stamps and return the Inngest copy used by `sendReplan`), `refresh(projectId)`.

`sendReplan` gains one refusal before stamping: any slot of the project with a live `stretch` job → `'Wait for the stretch re-plan to finish.'`

- [ ] **Step 1: Write the failing tests** — one per refusal above, plus: `'stamps every selected shot and sends one event with the note'`, `'clears the stamps when Inngest cannot be reached'`, `'refuses Re-plan shot list while a stretch runs'`.
- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run visuals-actions` in `apps/web`, timeout 600000.
- [ ] **Step 3: Implement.** Keep the module's exports async-only.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(visuals): replanStretchAction and the one-job-at-a-time rules`

---

### Task 9: Timing notes in the board model and the gate summary

**Files:**
- Modify: `apps/web/lib/visuals-review.ts`, `apps/web/inngest/functions/visuals-runner.ts` (gate summary, line ~322)
- Test: `apps/web/lib/visuals-review.test.ts`, `apps/web/inngest/functions/visuals-runner.test.ts`

**Interfaces:**
- Consumes: `timingFindings` (Task 2).
- Produces on `VisualsReviewModel`:

```ts
export interface TimingNoteView {
  /** The shots the note is about. */
  slotIds: string[]
  /** The shots "Re-plan this stretch" selects. */
  stretch: string[]
  message: string
  /** `${message} (ch N · m:ss)`, as the craft notes are listed. */
  listed: string
}
timingNotes: TimingNoteView[]
```

Built from the same anchored `times` the model already computes; never added to `warnings`, `slotNotes` or `repair` (spec 3.1, Fix ignores them). `emptyVisualsModel()` returns `timingNotes: []`. The plan-phase gate summary adds `` ` · ${n} timing note${n === 1 ? '' : 's'}` `` after the craft-note count, computed inside the existing step.

- [ ] **Step 1: Write the failing tests:** `'lists the Theranos pair as two timing notes with one stretch'`, `'keeps timing notes out of the craft notes and the Fix count'`, `'counts timing notes in the plan summary'`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(visuals): timing notes on the board model and the plan summary`

---

### Task 10: Selecting shots and the re-plan bar

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/stretch-bar.tsx`
- Modify: `apps/web/app/(console)/projects/[id]/visual-board.tsx` (`VisualBoardContent`, `ChapterSection`, `SlotCard`, the plan card's notes list)
- Test: `apps/web/app/(console)/projects/[id]/stretch-bar.test.tsx`, `apps/web/app/(console)/projects/[id]/visual-board.test.tsx`

**Interfaces:**
- Consumes: `replanStretchAction` (Task 8), `TimingNoteView` (Task 9), the board's `Act`.
- Produces:

```ts
export function useStretchSelection(chapters: VisualsReviewModel['chapters']): {
  selected: readonly string[]
  toggle: (slotId: string) => void
  selectStretch: (slotIds: readonly string[]) => void
  clear: () => void
  /** null when valid; the refusal copy otherwise. */
  problem: string | null
  chapterId: string | null
}
export function StretchBar(props: {
  projectId: string
  selection: ReturnType<typeof useStretchSelection>
  chapters: VisualsReviewModel['chapters']
  act: Act
}): React.ReactElement | null
export const STRETCH_REPLAN_ESTIMATE = '≈$0.03'
```

Behaviour (spec 3.3, 3.4; button first, spec 11.1):
- Each `SlotCard` shows a visible `Select` / `Selected` toggle button (`aria-pressed`) in both phases, hidden while the card has a job. Selected cards get the accent outline.
- `StretchBar` renders when `selected.length > 0`, sticky at the bottom: `Re-plan these ${n} shots · ${STRETCH_REPLAN_ESTIMATE}`, a labelled note box `What should change? (optional)` with placeholder `keep the headline card up through the CNBC line`, and `Clear selection`. When `problem` is set the button is disabled and the copy shows beside it.
- When an unselected shot borrows from a selected one, a line above the button: `` `The shot at ${timecode} uses this shot's image and will lose it.` `` (one line per borrower).
- On success the selection clears; the cards show their `stretch` job as `Re-planning` through the existing slot job words.
- Timing notes: on each card whose id is in a note's `slotIds`, in both phases, a warning list item with the message and a `Re-plan this stretch` button that calls `selectStretch(note.stretch)`. On the plan card, timing notes get their own list headed `Timing notes`, apart from craft notes.

- [ ] **Step 1: Write the failing tests**

```tsx
it('selects neighbouring shots and sends them with the note', async () => { /* click Select ×2, type note, click 'Re-plan these 2 shots · ≈$0.03' → action called with ids in order and the note */ })
it('refuses a selection with a gap', () => { /* button disabled, 'Re-plan works on neighbouring shots in one chapter.' shown */ })
it('names the shot that will lose its borrowed image', () => {})
it('shows timing notes on board cards and selects their stretch', async () => { /* phase 'board'; click 'Re-plan this stretch' → both cards Selected */ })
it('lists timing notes apart from craft notes on the plan card', () => {})
it('hides Select on a busy card', () => {})
```

- [ ] **Step 2: Run to verify they fail.** `pnpm exec vitest run stretch-bar visual-board` in `apps/web`.
- [ ] **Step 3: Implement.** Mock `replanStretchAction` wherever `visual-board.test.tsx` mocks the visuals actions.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat(board): select neighbouring shots, re-plan bar, timing notes on cards`

---

### Task 11: End to end, decisions and the full run

**Files:**
- Modify: `e2e/global-setup.ts`
- Create: `e2e/tests/stretch-replan.spec.ts`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: fixture `STRETCH_BOARD_TITLE = 'Stretch re-plan board (E2E)'`: one chapter, the 17-word CNBC paragraph plus one more paragraph, takes stored **with word timings** (`storeTakeAudio(..., { timings })`), board phase, a headline slot quoting the whole first paragraph and a stock slot quoting from "In 2021", then a stock slot on paragraph 2.

- [ ] **Step 1: Write the failing e2e test**

```ts
test('re-plans the short headline and its neighbour without touching the next shot', async ({ page }) => {
  // open the fixture board; expect the card text 'this news headline is on screen for'
  // click 'Re-plan this stretch' on the headline card; type a note; click 'Re-plan these 2 shots'
  // expect the two cards replaced (mock: one or two new cards quoting the CNBC paragraph)
  // expect the paragraph-2 card's id and chosen image unchanged; no timing note left on the new cards
})
```

- [ ] **Step 2: Run to verify it fails.** From the `e2e` package: `pnpm exec playwright test tests/stretch-replan.spec.ts`. Free port 3100 first if a previous run was interrupted.
- [ ] **Step 3: Seed the fixture**; the test passes against Tasks 1 to 10.
- [ ] **Step 4: Full verification**, each must pass: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` (database suites one at a time), `pnpm e2e`.
- [ ] **Step 5: PROGRESS.md.** Under M5, decisions from the next free number on `origin/master`: (a) timing checks and minimums; (b) timing notes are their own list, Fix ignores them; (c) the automatic one-pass timing repair; (d) the stretch re-plan (selection, validator, refusals, concurrency per chapter); (e) the mock quotes one sentence per slot. Shipping note: new Inngest function, so `PUT /api/inngest` after the Vercel deploy; no migration (the `pending_job` kind lives in JSON).
- [ ] **Step 6: Commit** `test(e2e): stretch re-plan on the board; docs(progress): decisions`
