# Motion Package and Reading Hold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every motion graphic and chapter or title card holds its final state long enough to read, the chapter and title cards are drawn by exemplar code, and the Brand Kit specimen becomes a package reel of what the pipeline draws.

**Architecture:** The timeline compiler inserts a capped narration pause after a graphic's last word when the next shot would cut too soon, splitting a paragraph's audio with a new `trimStartMs` where needed; the existing piecewise shift moves captions, music and slots. Chapter and title card overlays carry exemplar code resolved at assembly, timed at reading pace, with the old `TitledCard` as fallback. The specimen loads channel-or-house exemplar code on the server and plays it through `GraphicCode`.

**Tech Stack:** TypeScript, Zod, Remotion 4 (`@remotion/player`, `@remotion/media`), Next.js App Router, Inngest, Vitest, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-11-motion-package-and-reading-hold-design.md`

**Execution order:** 1, 2, 3, 4, 7, 5, 6, 8, 9, 10, 11. Task 7 revises the house chapter title to need no label, and Task 5 starts drawing cards with it, so 7 runs first. Task 10 waits for the `hand-exemplars` merge.

## Global Constraints

- Mock providers by default; no task makes a paid call (CLAUDE.md rule 6).
- Every action in the UI is a visible labelled button (spec §11.1); dark theme default.
- Narrated hold: 2000 ms from the start of the last covered word; figure hold 2500 ms; one pause is capped at 1500 ms.
- A pause lands only after a word ending a sentence or clause: `.` `!` `?` `;` `:` `,`, optionally followed by closing quotes or brackets.
- Silent cards: words at 300 ms then every 250 ms; 700 ms settle; 1500 ms rest; card length = max(3200, last word + 700 + 1500 + 900).
- Old timelines (no `trimStartMs`, overlays without `code`, 3200 ms cards) render and cue music exactly as before.
- Timeline schema changes need `deploy:stacks boom-busters-broker` then `deploy:remotion` then Vercel and `PUT /api/inngest`. These are the owner's to run; the plan only records them.
- Run `pnpm format:check` on tracked files before each commit (memory: lint-clean is not format-clean).
- Run tests per package with the Bash `timeout` 600000; never a whole `pnpm test` in one call. Start Docker Desktop before any database suite.
- A change to a shared schema or prompt runs every consuming package's suite, not only its own.
- **Corrections to the spec, found while planning:** Points and teasers compile their own narration (`point.ts`, `teaser.ts`), not a slice of the master, so they get no pauses in this plan; only master-slice Shorts inherit them. The Brand Kit form has no variant pickers today (`chapterCardVariant` and `lowerThirdVariant` appear only in the specimen), so section 7's removal is just the specimen's caption.

## Review Focus

1. A paragraph holding two pauses splits into three narration pieces whose `trimStartMs` and `startMs` line up with the shifted captions. Owned by Task 3, test `splits a paragraph at two pauses into three pieces`.
2. A code slot whose next shot is anchored before its own last word (the planner's quote ran into the next shot's sentence) must get no pause, because the graphic is already gone. Owned by Task 3, test `skips a slot overlapped by the next shot`.
3. A timeline compiled before this change still cues music at its cards and plays every overlay. Owned by Task 4, test `cues music at an old 3200 ms card`, and Task 2, test `renders an overlay without code as TitledCard`.
4. A Short whose window contains a split paragraph compiles, counts the pause in its length and keeps captions on the audio. Owned by Task 6, test `slices a window holding a split paragraph`.
5. A channel's approved chapter-title version checked against a labelled sample must not draw a chapter card that misreads the title. Owned by Task 5, test `falls back to the house chapter title for a labelled channel version`.

---

### Task 1: Timeline schema: narration trim and card code

**Files:**
- Modify: `packages/schemas/src/timeline.ts` (NarrationSegmentSchema at 69, OverlaySchema at 378)
- Test: `packages/schemas/src/timeline.test.ts`

**Interfaces:**
- Produces: `NarrationSegment.trimStartMs?: number` (int, ≥ 0); `CardCodeSchema` and `type CardCode = { version: number; compiled: string; title: string; words: GraphicCodeWord[]; durationMs: number }`; `chapterCard` and `titleCard` overlays gain `code?: CardCode`. Exported from `@boom-busters/schemas`.

- [ ] **Step 1: Write the failing tests**

```ts
it('accepts a narration segment with a trim start', () => {
  const parsed = NarrationSegmentSchema.parse({ ...segment, trimStartMs: 2310 })
  expect(parsed.trimStartMs).toBe(2310)
})
it('refuses a negative trim start', () => {
  expect(NarrationSegmentSchema.safeParse({ ...segment, trimStartMs: -1 }).success).toBe(false)
})
it('accepts a chapter card carrying code and one without', () => {
  const code = { version: GRAPHIC_CODE_VERSION, compiled: 'x', title: 'T', words: [{ text: 'T', atMs: 300 }], durationMs: 3400 }
  expect(OverlaySchema.parse({ kind: 'chapterCard', startMs: 0, durationMs: 3400, props: { index: 2, title: 'T' }, code }).code).toEqual(code)
  expect(OverlaySchema.parse({ kind: 'chapterCard', startMs: 0, durationMs: 3200, props: { index: 2, title: 'T' } })).not.toHaveProperty('code')
})
it('accepts a title card carrying code', () => { /* same shape, kind 'titleCard', props { title } */ })
```

- [ ] **Step 2: Run them to see them fail**

Run (from `packages/schemas`): `pnpm exec vitest run timeline.test` (Bash timeout 600000)
Expected: FAIL on the trim and code cases.

- [ ] **Step 3: Add the fields**

`trimStartMs: z.number().int().min(0).optional()` with a doc comment ("where in the take this piece starts; absent means the take's start"). `CardCodeSchema` beside the overlays, reusing `GraphicCodeWordSchema`; `code: CardCodeSchema.optional()` on both card overlays.

- [ ] **Step 4: Run the schemas suite and every consumer that parses timelines**

Run: `pnpm exec vitest run` in `packages/schemas`, `packages/timeline`, `packages/compositions` (each its own call).
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(schemas): a narration piece can start inside its take, and a card overlay can carry exemplar code`

---

### Task 2: Compositions: trimmed narration and code-drawn cards

**Files:**
- Create: `packages/compositions/src/components/CardOverlay.tsx`
- Modify: `packages/compositions/src/components/GraphicCode.tsx` (add `fallback` prop), `DocumentaryMaster.tsx:72-115` (cards), `DocumentaryMaster.tsx:122-136` and `NarrationAudio` (trim)
- Test: `packages/compositions/src/components/CardOverlay.test.tsx`, `DocumentaryMaster.test.tsx`

**Interfaces:**
- Consumes: `CardCode` (Task 1).
- Produces: `CardOverlay({ title, code, brand, durationInFrames }: { title: string; code?: CardCode; brand: BrandKitTokens; durationInFrames: number })`; `GraphicCode` gains `fallback?: ReactNode` (default stays `GraphicTitleCard`).

- [ ] **Step 1: Write the failing tests**

- `renders an overlay without code as TitledCard`: no `code` → the title text renders with today's `TitledCard` markup.
- `renders card code through the sandbox`: `code.compiled` is a tiny compiled component drawing `props.words.map(w => w.text).join(' ')`; the words appear.
- `falls back to TitledCard when card code throws`: compiled code that throws → the title renders via `TitledCard`, not `GraphicTitleCard`.
- `fades a code card out over its last 700 ms`: at frame `durationInFrames - 1` the wrapper's opacity is below 0.1; at the middle frame it is 1.
- `plays a trimmed narration piece from its offset`: a segment with `trimStartMs: 2310` mounts its audio with `trimBefore` equal to `msToFrames(2310, fps)`; a segment without it mounts no trim.

- [ ] **Step 2: Run them to see them fail**

Run (from `packages/compositions`): `pnpm exec vitest run CardOverlay DocumentaryMaster`
Expected: FAIL.

- [ ] **Step 3: Implement**

`CardOverlay`: with `code`, render `GraphicCode` with payload `{ kind: 'graphic-code', ...code, logos: {}, claimIds: [] }` and `fallback={<TitledCard .../>}`, inside an `AbsoluteFill` whose opacity is the existing `FADE_MS = 700` exit curve from `ChapterCard.tsx` (export it). No entrance fade: the exemplar has its own. Without `code`, render `TitledCard`. `DocumentaryMaster` routes `chapterCard` and `titleCard` overlays through `CardOverlay`. `NarrationAudio` takes `trimBefore?: number` (frames) and passes it to both `Audio` and `WebCodecsAudio`; check the installed Remotion version names the prop `trimBefore` (older: `startFrom`) in `node_modules/remotion` before writing it.

- [ ] **Step 4: Run the package suite, then again alone if a snapshot fails** (memory: composition snapshots flake under the full suite)

Run: `pnpm exec vitest run` in `packages/compositions`.
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(compositions): card overlays draw exemplar code with the old card as fallback; narration pieces play from their trim`

---

### Task 3: Compiler: the reading pause

**Files:**
- Create: `packages/timeline/src/reading-hold.ts`, `packages/timeline/src/reading-hold.test.ts`
- Modify: `packages/timeline/src/compile.ts` (CompileSlot, the paragraph loop at 230-288, `shiftAt`, narration build), `packages/timeline/src/index.ts` (exports)
- Test: `packages/timeline/src/compile.test.ts`, goldens in `packages/timeline/src/golden/`

**Interfaces:**
- Consumes: `anchorWordRanges` and `ParagraphSpan` from `anchor.ts`; `trimStartMs` (Task 1).
- Produces:
  - `export const READING_HOLD_MS = 2000`, `FIGURE_HOLD_MS = 2500`, `READING_PAUSE_CAP_MS = 1500`
  - `export function endsClause(text: string): boolean`, true for `/[.!?;:,]["'”’)\]]*$/`
  - `export interface ReadingPause { slotIndex: number; cutMs: number; pauseMs: number; paragraphEnd: boolean }` (`cutMs` on the pre-shift clock)
  - `export interface ReadingHoldReport { pauses: number; addedMs: number; midClause: number; overlapped: number }`
  - `export function planReadingPauses(input: { slots: readonly { startMs: number; holdMs?: number }[]; ranges: readonly (WordRange | null)[]; words: readonly Caption[]; spans: readonly ParagraphSpan[]; shiftAt: (tMs: number) => number }): { pauses: ReadingPause[]; report: ReadingHoldReport }`
  - `export function holdShortfallMs(lastWordAtMs: number, endMs: number, holdMs: number): number`, `Math.max(0, holdMs - (endMs - lastWordAtMs))`
  - `CompileSlot.holdMs?: number`
  - `export function compileTimelineWithReport(input: CompileInput): { timeline: Timeline; readingHold: ReadingHoldReport }`; `compileTimeline` returns its `.timeline`.

**The algorithm `planReadingPauses` follows** (all times on the pre-shift clock, `shiftAt` carrying only the paragraph and chapter gaps):

```
for each slot i with holdMs, in clock order, whose range r is not null:
  last = words[r.last]
  next = the next slot's startMs in clock order (undefined for the film's last slot)
  if next === undefined: skip (Task 3 step 3 extends the last slot instead)
  if last.startMs >= next: overlapped += 1; skip
  available = (next + shiftAt(next)) - (last.startMs + shiftAt(last.startMs))
  shortfall = holdMs - available
  if shortfall <= 0: skip
  if !endsClause(last.text): midClause += 1; skip
  isParagraphEnd = r.last is the last word inside its span
  cutMs = isParagraphEnd ? the next span's startMs
                         : round((last.endMs + words[r.last + 1].startMs) / 2)
  push { slotIndex: i, cutMs, pauseMs: min(shortfall, READING_PAUSE_CAP_MS), paragraphEnd: isParagraphEnd }
```

- [ ] **Step 1: Write the failing tests** (`reading-hold.test.ts`, fixtures of 3-4 words a paragraph)

- `pauses a graphic whose next shot follows its last word too closely`: last word starts at 4000, next slot at 4400, hold 2000 → one pause, `pauseMs` 1500 (capped), `cutMs` the midpoint of the word gap.
- `adds no pause when the slot already has the time`: next slot at 6200 → no pause.
- `counts the paragraph gap as available time`: last word ends its paragraph, the next paragraph starts after `PARAGRAPH_GAP_MS` → available includes the 700 ms; shortfall reduced by 700; `paragraphEnd: true`, `cutMs` = next span start.
- `skips a mid-clause last word`: last word `'the'` → no pause, `report.midClause` 1.
- `skips a slot overlapped by the next shot`: next slot starts before the last word → no pause, `report.overlapped` 1.
- `uses the figure hold`: `holdMs` 2500 with 1200 available → `pauseMs` 1300.
- `endsClause`: true for `'gone.'`, `'year,'`, `'"done."'`, `'(2020).'`; false for `'the'`, `'4.2bn'`.

In `compile.test.ts`:
- `splits a paragraph at two pauses into three pieces`: pieces have `trimStartMs` absent, `c1 - spanStart`, `c2 - spanStart`; each piece's `startMs` equals the first caption word inside it after the shift, minus that word's offset from the cut; durations sum to the paragraph's.
- `stretches the graphic across its pause`: the code slot's compiled `durationMs` grows by `pauseMs`; the next slot's `startMs` moves by `pauseMs`.
- `shifts captions after a pause and not before`.
- `extends the film's last graphic to its hold`: the last slot's last word leaves 900 ms → the slot's `durationMs` grows by 1100 (no cap applies: nothing follows).
- `reports pauses and added time`: `compileTimelineWithReport(...).readingHold` equals `{ pauses: 2, addedMs: <sum>, midClause: 0, overlapped: 0 }`.
- `leaves a timeline without holds unchanged`: no `holdMs` anywhere → output deep-equals today's for the existing fixtures.

- [ ] **Step 2: Run them to see them fail**

Run (from `packages/timeline`): `pnpm exec vitest run reading-hold compile`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `compile.ts`, keep the paragraph loop as the first pass (it builds the gap breakpoints). Move the anchoring (`spans`, `anchorSlots`) above narration building, call `anchorWordRanges` with the same inputs, run `planReadingPauses`, then merge each pause into `breakpoints`: a `paragraphEnd` pause adds `pauseMs` to that paragraph's breakpoint and every later one; a mid-paragraph pause inserts `{ oldStartMs: cutMs, shiftMs: previous + pauseMs }` and adds `pauseMs` to every later breakpoint. Keep `breakpoints` sorted. Build narration after the merge: a paragraph with cuts becomes one piece per cut plus one, each with `startMs = pieceStart + shiftAt(pieceStart)`, `durationMs = pieceEnd - pieceStart` and `trimStartMs = pieceStart - spanStart` when non-zero, keeping `chapterId` and `paragraphIndex`. The last-slot extension happens after the seam pass: if the film's last code slot has `holdMs` and a range, extend its `durationMs` by `holdShortfallMs(lastWordShifted - slotStart, durationMs, holdMs)`.

- [ ] **Step 4: Regenerate the goldens on purpose and read the diff**

Run: the package's golden update command (see `packages/timeline/package.json`), then `git diff packages/timeline/src/golden`.
Expected: no change, since the golden inputs carry no `holdMs`. A change means step 3 broke the no-hold path; fix it rather than accept the golden.

- [ ] **Step 5: Run the package suite**

Run: `pnpm exec vitest run` in `packages/timeline`.
Expected: PASS.

- [ ] **Step 6: Commit**

`feat(timeline): a graphic holds its last words long enough to read, the narration waits for it`

---

### Task 4: Compiler: silent cards timed to reading, carrying code

**Files:**
- Modify: `packages/timeline/src/compile.ts` (constants at 177-205, the chapter switch at 241-275), `packages/timeline/src/music.ts:36-41`
- Test: `packages/timeline/src/compile.test.ts`, `packages/timeline/src/music.test.ts`, goldens

**Interfaces:**
- Consumes: `CardCode` (Task 1).
- Produces:
  - `export const CARD_FIRST_WORD_MS = 300`, `CARD_WORD_STEP_MS = 250`, `CARD_SETTLE_MS = 700`, `CARD_REST_MS = 1500`
  - `export function cardWords(title: string): GraphicCodeWord[]`, the title split on whitespace, word i at `300 + 250 * i`
  - `export function cardDurationMs(title: string): number`, `max(CHAPTER_CARD_MS, lastAt + 700 + 1500 + CHAPTER_OVERLAP_MS)`
  - `CompileInput.cardCode?: { chapter?: Omit<CardCode, 'words' | 'durationMs'>; title?: Omit<CardCode, 'words' | 'durationMs'> }`

- [ ] **Step 1: Write the failing tests**

- `cardWords('The Money That Wasn't There')` → five words at 300, 550, 800, 1050, 1300.
- `cardDurationMs('Fraud')` is 3400 (300 + 700 + 1500 + 900: a one-word card already passes the 3200 floor) and the five-word title gives 4400.
- `lengthens a chapter break for a long title`: with `cards` marking, the overlay's `durationMs` is `cardDurationMs(title)` and the next chapter's first narration starts at `overlay.startMs + overlay.durationMs - CHAPTER_OVERLAP_MS`.
- `attaches card code with reading-paced words`: with `cardCode.chapter`, the overlay's `code.words` equals `cardWords(title)` and `code.durationMs` equals the overlay's.
- `title card uses the title code`: `title` marking with `cardCode.title` → `titleCard` overlay carries it; without → no `code`.
- `cues music at an old 3200 ms card` (music.test.ts): a hand-built pre-change timeline with 3200 ms cards gives the same cue points as before.
- `cues music at a lengthened card`.

- [ ] **Step 2: Run them to see them fail**

Run (from `packages/timeline`): `pnpm exec vitest run compile music`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use `cardDurationMs(title)` wherever the switch uses `CHAPTER_CARD_MS` (overlay length and the shift). Attach `code: { ...cardCode.chapter, words: cardWords(title), durationMs }` when given. In `music.ts`, match a card by `overlay.startMs + overlay.durationMs - CHAPTER_OVERLAP_MS === first.startMs`; old cards have `durationMs` 3200, so their cue is unchanged.

- [ ] **Step 4: Regenerate goldens and read the diff**

Expected: card overlays lengthen to `cardDurationMs` of their titles and later times shift by the difference; nothing else changes. Record the reason in the commit body.

- [ ] **Step 5: Run the package suite**

Run: `pnpm exec vitest run` in `packages/timeline`. Expected: PASS.

- [ ] **Step 6: Commit**

`feat(timeline): chapter and title cards last as long as their titles take to read, and carry exemplar code`

---

### Task 5: Assembly: holds per slot and card code per channel

**Files:**
- Create: `apps/web/lib/card-exemplars.ts`, `apps/web/lib/card-exemplars.test.ts`, `apps/web/lib/reading-hold.ts`, `apps/web/lib/reading-hold.test.ts`
- Modify: `apps/web/inngest/lib/assembly.ts` (`slotPlan`, the chart branch at 310 and the graphic branch), `apps/web/inngest/functions/assembly-runner.ts:440-490`
- Test: `apps/web/inngest/lib/assembly.test.ts`, `apps/web/inngest/functions/assembly-runner.test.ts`

**Interfaces:**
- Consumes: `READING_HOLD_MS`, `FIGURE_HOLD_MS`, `compileTimelineWithReport` (Task 3); `CompileInput.cardCode` (Task 4); `approvedExemplar` (`@boom-busters/db`); `DESIGNS` (`@boom-busters/providers`); `compileGraphicSource` (`apps/web/lib/graphic-code/compile.ts`); `MOTION_PREAMBLE` (`@boom-busters/compositions/motion-tokens`).
- Produces:
  - `export function holdMsFor(type: 'chart' | 'graphic', code: Pick<GraphicCode, 'facts'>): number` in `apps/web/lib/reading-hold.ts` (no server-only imports; the board imports it in Task 8): `FIGURE_HOLD_MS` for a chart, or a graphic whose `code.facts` has any `text` matching `/\d/`; else `READING_HOLD_MS`. (The brief carries no technique; a cited figure is the proxy for "chart or counter".)
  - `export function isTitleOnlySample(words: readonly GraphicCodeWord[]): boolean`: no word before the last ends in `.`
  - `export async function cardCodesFor(db: Database, channelId: string): Promise<{ chapter: Omit<CardCode,'words'|'durationMs'> | null; title: Omit<CardCode,'words'|'durationMs'> | null; notes: string[] }>`

- [ ] **Step 1: Write the failing tests**

- `holdMsFor`: 2500 for a chart; 2500 for a graphic whose facts include `'1.2bn'`; 2000 for a graphic with no facts or only `'Nobody'`.
- `slotPlan` puts `holdMs` on every slot that carries `graphicCode` and on no other.
- `cardCodesFor` (mock the db functions): uses the channel's approved chapter-title when `isTitleOnlySample(row.code.words)`; `falls back to the house chapter title for a labelled channel version` with a note naming the version; house design when none approved; `title` is null while no `film-title` design exists (Task 10 fills it).
- assembly-runner: the compile step passes `cardCode` and stores `readingHold` and the card notes beside `skipped` in the step's result.

- [ ] **Step 2: Run them to see them fail**

Run (from `apps/web`): `pnpm exec vitest run card-exemplars reading-hold assembly` (timeout 600000). Expected: FAIL.

- [ ] **Step 3: Implement**

`cardCodesFor` compiles the house source with `compileGraphicSource` under `MOTION_PREAMBLE` the way `exemplar-views.ts` does (`viewOf`), and returns `{ version: GRAPHIC_CODE_VERSION, compiled, title }`. Call it **inside** the existing compile `step.run` (memory: parked runs replay old step results). Replace `compileTimeline` with `compileTimelineWithReport`. Follow `compiled.skipped` to where the gate summary shows it, and show beside it: "Reading pauses: N, adding X.X s" and, when non-zero, "N graphics end mid-sentence and get no pause". Card notes show in the same list.

- [ ] **Step 4: Run the web suites that consume these** (`apps/web/inngest`, `apps/web/lib`, each its own call, timeout 600000). Expected: PASS.

- [ ] **Step 5: Commit**

`feat(web): assembly sets each graphic's reading hold and draws cards from the channel's chapter title`

---

### Task 6: Shorts slice a split paragraph

**Files:**
- Modify: `packages/timeline/src/short.ts:113-160`, `apps/web/lib/shorts-review.ts:178-190`
- Test: `packages/timeline/src/short.test.ts`, `apps/web/lib/shorts-review.test.ts`

**Interfaces:**
- Consumes: `trimStartMs` (Task 1).

- [ ] **Step 1: Write the failing tests**

- `slices a window holding a split paragraph`: master with paragraph 1 in two pieces → the Short compiles; its narration has both pieces with `trimStartMs` kept; `durationMs` equals the window's extent including the pause; captions re-clock onto the pieces.
- `still refuses a window missing a paragraph`: a paragraph with no piece → the existing error.
- shorts-review: the window length for a split paragraph is the extent (first piece start to last piece end), not the sum of piece durations.

- [ ] **Step 2: Run them to see them fail.** Expected: FAIL with "has 3 of the 2 narration segment(s)".

- [ ] **Step 3: Implement**

Count distinct `paragraphIndex` values against `expected` instead of `segments.length`; copy `trimStartMs` when present. In shorts-review, compute the extent.

- [ ] **Step 4: Run `packages/timeline` and `apps/web/lib` suites.** Expected: PASS.

- [ ] **Step 5: Commit**

`fix(timeline): a Short slices a paragraph the reading pause split`

---

### Task 7: The designer, the rest check and the exemplar samples

**Files:**
- Create: `apps/web/lib/graphic-code/rest.ts`, `apps/web/lib/graphic-code/rest.test.ts`
- Modify: `packages/providers/src/prompts/graphics.ts:367`, `apps/web/lib/graphic-code/check.ts` (after the dry run), `packages/providers/src/exemplars/manifest.ts` (every slot's `durationMs`), `packages/providers/src/exemplars/designs/chapter-title.ts`
- Test: `packages/providers/src/prompts/graphics.test.ts`, `apps/web/lib/graphic-code/check.test.ts`, `apps/web/lib/graphic-code/exemplars.test.ts`

**Interfaces:**
- Consumes: `READING_HOLD_MS`, `FIGURE_HOLD_MS` (Task 3); `GRAPHIC_SAMPLE_MS`, `DryRunResult.textSamples`.
- Produces: `export function restIssue(textSamples: readonly string[], words: readonly GraphicCodeWord[], sampleMs: number): string | null`: null when every sample at or after `lastWord.atMs + 700` shows the same text as the final sample; otherwise `"the graphic is still changing <n> ms after its last word; after the last word lands, only the camera may move"`.

- [ ] **Step 1: Write the failing tests**

- `restIssue`: null for samples constant after settle; an issue for text that changes 1500 ms after the last word; null when there are no words.
- `graphicCodeIssue` refuses a design that types a word after the last spoken word and passes one at rest, in both frames (portrait issue suffixed `", in portrait"` like the facts issue).
- graphics prompt: contains `the finished graphic holds` and `only the camera push continues`, and no longer contains `An ending that holds rather than vanishes.`
- manifest: for every entry, `slot.durationMs - lastWord.atMs` equals `FIGURE_HOLD_MS` for the eight chart and counter techniques (`bar-chart`, `line-chart`, `racing-chart`, `comparison-chart`, `donut-chart`, `stat-counter`, `kpi-counter`, `progress-bars`) and `READING_HOLD_MS` otherwise, except `chapter-title`, whose sample is now title only: `words` equal `cardWords('The missing billion.')` and `durationMs` equals `cardDurationMs('The missing billion.')`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement the prompt line and the check**

Craft line, replacing line 367: `- The ending holds. The last thing said lands as it is said; after it, the finished graphic holds, and the render gives it the time to be read. Nothing new enters, draws or moves into place once the last word's entrance has settled; only the camera push continues.`

- [ ] **Step 4: Re-time the samples, revise the chapter title, and run `exemplar:check` on all eighteen**

Re-time per the manifest test. Revise `chapter-title` so the label is optional: with no word ending in `.` before the last, there is no label, the short rule is the hook, draws out to the title's width as the first word lands, and each title word drops from under it. Then, for each id: `pnpm --filter @boom-busters/web exemplar:check -- --id <id> --source <file> --title <title> --facts <facts> --write` (Docker not needed; a browser is). Any design that now fails the rest check or a layout check is revised by hand to the decision 387 standard and reviewed by a fresh reviewer (memory: hand-made exemplars and the reviewer loop). List every revised design in the commit body; the owner sees the revised chapter title in the specimen before merge.

- [ ] **Step 5: Re-capture the graphics prompt fixtures** (the `graphics-exemplar-*` lift fixtures and any snapshot of the craft section), then run `packages/providers` and `apps/web/lib/graphic-code` suites. Expected: PASS.

- [ ] **Step 6: Commit** (two commits: the prompt and check; then the samples and revised designs)

`feat(graphics): a graphic is at rest after its last word, and the designer is told the render holds it`
`feat(exemplars): samples leave the real hold after their last word; the chapter title needs no label`

---

### Task 8: The board plays the hold

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/graphic-player.tsx` (`GraphicPlayerFrame`) and its caller that passes `durationMs`
- Test: `apps/web/app/(console)/projects/[id]/graphic-player.test.tsx`

**Interfaces:**
- Consumes: `holdShortfallMs`, `READING_HOLD_MS`, `FIGURE_HOLD_MS` (Task 3).
- Produces: `GraphicPlayerFrame` gains `holdMs?: number`; it plays `durationMs + holdShortfallMs(lastWord.atMs, durationMs, holdMs)` frames for a code design.

- [ ] **Step 1: Write the failing test**: a code design whose last word sits 600 ms before its end, `holdMs` 2000 → the Player's `durationInFrames` is `msToFrames(durationMs + 1400, 30)`; a scene design is unchanged.
- [ ] **Step 2: Run it to see it fail.**
- [ ] **Step 3: Implement**; the caller passes `holdMsFor(slotType, design.code)` from `apps/web/lib/reading-hold.ts` (Task 5).
- [ ] **Step 4: Run the file's suite and the e2e board spec that plays a graphic** (scoped from the e2e package, memory). Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the board's graphic player holds the ending as the render will`

---

### Task 9: The Brand Kit package reel

**Files:**
- Create: `apps/web/lib/specimen-reel.ts`, `apps/web/lib/specimen-reel.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/settings/brand-specimen.tsx` (rewrite), `settings-form.tsx:595-610` (props and copy), `page.tsx` (load the reel)
- Test: `apps/web/app/(console)/c/[slug]/settings/brand-specimen.test.tsx`, the Brand Kit e2e spec

**Interfaces:**
- Consumes: `channelExemplarViews` (`apps/web/lib/exemplar-channel-views.ts`), `exemplarViews` (`apps/web/lib/exemplar-views.ts`), `cardWords`, `cardDurationMs` (Task 4), `GraphicCode` with `fallback` (Task 2).
- Produces:
  - `export interface ReelPiece { technique: TechniqueKey; label: string; source: 'channel' | 'house'; payload?: GraphicCodePayload; issue?: string }` (a payload's `logos` is `{}` and `claimIds` is `[]`)
  - `export function specimenReel(house: ExemplarView[], channel: ChannelExemplarView[]): ReelPiece[]` (pure; the page passes what it already loads)
  - `BrandSpecimenPanel({ settings, reel }: { settings: Settings; reel: ReelPiece[] })`

- [ ] **Step 1: Write the failing tests**

- `specimenReel` orders `film-title` (only when either side has it), `chapter-title`, `lower-third`, `bar-chart`, `stat-counter`; labels "Film title", "Chapter card", "Lower third", "Chart", "Counter"; prefers the channel's approved code; marks `source`; card pieces get `cardWords('The Money That Wasn't There')` and `cardDurationMs` of it; others keep the exemplar's sample words and data; a house view with `issue` becomes a piece with that `issue` and no payload.
- panel: renders buttons "Landscape 16:9" and "Portrait 9:16" (button-first); landscape plays the pieces only; portrait adds a final "Captions (Shorts only)" beat with the existing `SPECIMEN_WORDS`; the caption lists each piece as "Chapter card · channel version" or "· house design", and a piece with an issue as "Chart · could not compile: <issue>"; the Player's total frames equal the sum of the playable pieces.
- panel: a colour change in `settings` re-renders with the new `brand` (keep the existing optimistic-state test).

- [ ] **Step 2: Run them to see them fail.**
- [ ] **Step 3: Implement.** The settings page already awaits `channelExemplarViews(db, channel.id)` and calls `exemplarViews()`; compute `specimenReel` there and pass it through `SettingsForm` to the panel (still `next/dynamic`, `ssr: false`). Card copy: title "Live specimen", description "The film title, chapter card, lower third, a chart and a counter, drawn by this channel's approved exemplars (or the house designs) with these exact values. Colour edits above show up here as they save."
- [ ] **Step 4: Run the settings suites, including `voice-tab.test.tsx`** (memory: SettingsForm tests mock every tab's actions), then the Brand Kit e2e spec scoped from the e2e package. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the Brand Kit specimen plays the channel's motion package`

---

### Task 10: The film-title exemplar (blocked until decision 462's `hand-exemplars` branch merges)

**Files:**
- Modify: `packages/schemas/src/techniques.ts` (`TECHNIQUES` gains `'film-title'`), `packages/providers/src/exemplars/manifest.ts` (entry), `apps/web/lib/card-exemplars.ts` (`title`), the Motion tab's tick list
- Create: `packages/providers/src/exemplars/designs/film-title.ts` (by `exemplar:hand`/`exemplar:check`)
- Test: `packages/providers/src/exemplars/technique.test.ts`, `apps/web/lib/card-exemplars.test.ts`

**Interfaces:**
- Consumes: `cardWords`, `cardDurationMs` (Task 4); `exemplar:hand` (decision 462).

- [ ] **Step 1: Confirm the gate.** `git log origin/master --oneline | grep -m1 "hand-exemplars"` shows the merge, and `apps/web/package.json` has `exemplar:hand`. If not, stop and report; Tasks 1 to 9 ship without this one.
- [ ] **Step 2: Write the failing tests**: `techniqueFor` never returns `'film-title'` for any graphic or chart input in the existing technique fixtures; the Motion tab does not offer it as a tick; `cardCodesFor` returns the house film-title design for `title` (and the channel's approved one when its sample is title-only).
- [ ] **Step 3: Add the technique and the manifest entry** (sample: `cardWords('The Wirecard Collapse')`, `durationMs: cardDurationMs(...)`, description in the manifest's style, mechanisms chosen with the design).
- [ ] **Step 4: Write the design by hand** to the decision 387 standard: the film's title outranks a chapter break, so it is the package's largest type and its own concept, not the chapter title with a different size. Pass `exemplar:check`, then a fresh reviewer, revise, and show the owner stills before `--write`. Ask before any upload batch (memory).
- [ ] **Step 5: Run `packages/schemas`, `packages/providers`, `apps/web/lib` suites.** Expected: PASS.
- [ ] **Step 6: Commit** `feat(exemplars): the film title gets its own exemplar, reserved for the title card`

---

### Task 11: Progress, decision and deploy notes

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1:** Add the decision (number taken at merge from `origin/master`; memory: decision numbers collide) recording: the hold numbers, the clause rule, the cap, card timing, card code resolution (channel version only when its sample is title only), the Points and teasers exclusion, the board hold, the reel, the `holdMsFor` digit proxy, and the deploy order: `deploy:stacks boom-busters-broker`, `deploy:remotion`, Vercel, `PUT /api/inngest`.
- [ ] **Step 2:** `pnpm format:check` on tracked files (memory recipe), `pnpm typecheck`, `pnpm lint`. Expected: clean.
- [ ] **Step 3: Commit** `docs: the motion package and the reading hold in PROGRESS`
