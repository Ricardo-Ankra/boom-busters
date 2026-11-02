# Playbook Shorts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace excerpt and teaser Shorts with three to five purpose-written Shorts per long-form video, one per approved talking point, built to a fixed Shorts rule book.

**Architecture:** On `project/master.ready` the shorts-runner asks a new talking-points runner for a proposal and the stage pauses (`shortsPhase = 'points'`). The owner approves or redoes the set; approval fans out one `point-short-runner` run per point (script, voice, shot plan, new 9:16 images, compile), each ending in the existing `short-render-runner`. A `point` Short carries its own mini master timeline exactly as a teaser does, compiled by a new `compileShortMaster` and windowed by `compileShortTimeline`. The rule book is one constants module that the prompts, the parsers and a findings checker all read.

**Tech Stack:** TypeScript, Zod, Drizzle (Postgres), Inngest, Next.js server actions, Remotion, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-01-playbook-shorts-design.md` (sections cited as §N).

## Global Constraints

- Branch `playbook-shorts`, in a worktree. Small commits, one logical change each; Conventional Commit prefixes as in `git log`.
- Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `pnpm lint`, `pnpm typecheck` and `pnpm format:check` (tracked files only) clean before every commit.
- No paid provider calls in development or tests: every new LLM, TTS and image path has a deterministic mock behind `mockProvidersEnabled()`.
- Rule book values (copy exactly, §4): 110 to 160 words; 45 000 to 60 000 ms runtime; 150 to 170 wpm; phase ends hook 3 000, stakes 15 000, delivery 42 000, resolution 52 000, bridge 60 000 ms; bridge 5 000 to 8 000 ms; shot 1 500 to 3 500 ms (target max 2 500), headline/social/chart cards up to 4 500 ms; punch-in by 1 200 ms at scale 1.15 over 250 ms; tail ≤ 100 ms; safe area x 60 to 960, y 380 to 1540 on 1080 × 1920; at most 4 new images per Short; 3 to 5 points.
- Short types: `forensic-breakdown`, `contrarian-thesis`, `incomplete-mechanism`, `result-first`. Phases: `hook`, `stakes`, `delivery`, `resolution`, `bridge`.
- Every fact in a point Short comes from the approved script; the bridge promises only what `bridgeChapters` contain (§2, §4.1). Prompts say so; tests pin that the prompt says so.
- Existing `excerpt` and `teaser` rows render, publish and open in the old studio exactly as today (§6, §7.1). No code path creates new ones.
- Timeline changes are additive; every stored timeline parses unchanged (§7.2).
- Migration is `0041`; before generating, `git fetch` and confirm origin/master's `packages/db/drizzle/meta/_journal.json` has no `0041` (memory: migration numbers collide).
- Decision numbers in `PROGRESS.md`: fetch origin/master at merge and take the next free number.
- Shared-schema changes: run every consuming package's suite, not only the edited package's (memory: focused suites miss cross-task regressions). Run DB suites one at a time with Bash `timeout` 600000; Docker Desktop must be running.
- UI is button-first (build spec §11.1): every action a visible labelled button.

## Review Focus

1. **Redo while a redo is running.** A second "Redo talking points" click while the runner is live must be refused in words, not queue a second paid call (`talking-points-actions.test.ts`, Task 11).
2. **Approve on a stale version.** Approving version 2 after version 3 landed must be refused ("A newer set of talking points exists"), so the owner never builds a set they did not see (Task 11).
3. **Re-entry after Back to visuals.** `master.ready` firing again with an approved set and built Shorts must not re-pause, re-propose or re-buy; it builds only points with no Short (Task 10).
4. **Shot plan pointing past the library or past the word list.** A library number outside the list, or a `startWord` beyond the Short's words, is refused by the parser, never clamped onto someone else's picture (Task 8).
5. **Scheduling a point Short before its long form.** Refused when the master's publish record is unscheduled or later than the Short's time (Task 14).

---

## File map

| File | Responsibility |
|---|---|
| `packages/schemas/src/short-rules.ts` (new) | Rule book constants, Short types and phases |
| `packages/schemas/src/talking-points.ts` (new) | Talking point, script, voice and plan record schemas |
| `packages/schemas/src/timeline.ts`, `visuals.ts` | `punch` motion, `crop`, `relatedArrow` and `subscribeBadge` overlays |
| `packages/schemas/src/events.ts`, `notices.ts` | New events; notice subjects `points` and `short` |
| `packages/db/src/schema.ts`, `talking-points.ts` (new), `shorts.ts`, `projects.ts` | Migration 0041 and helpers |
| `packages/timeline/src/point.ts` (new), `point-rules.ts` (new), `short.ts`, `compile.ts` | Point mini master, rule findings, `bridge` ending, punch mapping |
| `packages/compositions/src/lib/motion.ts`, `components/*` | Punch, crop, arrow and badge rendering |
| `packages/providers/src/prompts/talking-points.ts` (new), `point-script.ts` (new), `point-plan.ts` (new) | Requests, parsers, mocks |
| `apps/web/lib/point-answers.ts` (new), `apps/web/inngest/lib/point-build.ts` (new) | Answer wrappers and build steps |
| `apps/web/inngest/functions/talking-points-runner.ts`, `point-short-runner.ts` (new); `shorts-runner.ts`, `short-render-runner.ts` | Runners |
| `apps/web/app/(console)/projects/[id]/talking-points-*.ts(x)`, `point-studio*.ts(x)` (new), `shorts-screen.tsx`, `page.tsx`, `publish-actions.ts` | Screens and actions |
| `apps/web/lib/talking-points-review.ts`, `point-studio-model.ts` (new), `run-state.ts` | Screen models, stage controls |
| `e2e/global-setup.ts`, `e2e/tests/playbook-shorts.spec.ts` (new) | Seed and E2E |

---

### Task 1: The rule book and its schemas

**Files:**
- Create: `packages/schemas/src/short-rules.ts`, `packages/schemas/src/talking-points.ts`
- Modify: `packages/schemas/src/index.ts` (export both)
- Test: `packages/schemas/src/short-rules.test.ts`, `packages/schemas/src/talking-points.test.ts`

**Interfaces:**
- Produces:
  - `SHORT_RULES` (readonly object, every value in Global Constraints, keys: `wordsMin, wordsMax, runtimeMinMs, runtimeMaxMs, wpmMin, wpmMax, phaseEndMs: Record<ShortPhase, number>, bridgeMinMs, bridgeMaxMs, shotMinMs, shotTargetMaxMs, shotMaxMs, cardShotMaxMs, hookPunchByMs, punchScale, punchMs, tailMaxMs, safeArea: {x0,x1,y0,y1}, newImagesMax, pointsMin, pointsMax, paragraphGapMs: 150, kenburnsIntensity: 0.3`)
  - `SHORT_TYPES`, `ShortType`, `SHORT_PHASES`, `ShortPhase`, `CARD_SLOT_TYPES = ['headline','social','chart'] as const`
  - `TalkingPointSchema` `{ id: UlidSchema, type, title (3..90), question (10..300), payoff (10..400), bridge (10..400), bridgeChapters: int[] min 1, sourceChapters: int[] min 1, hook (5..300), order: int ≥ 1 }`; `TalkingPointDraftSchema` = the same without `id` (what a model returns)
  - `talkingPointSetIssues(points: readonly TalkingPointDraft[], chapterCount: number): string[]` — empty when valid. Issues: count outside 3..5; a chapter index ≥ chapterCount in either list; fewer than two distinct types; two points with the same question (compared lowercased, punctuation stripped); a chapter that is `sourceChapters[0]` of more than two points; `order` values not exactly 1..n
  - `PointScriptSchema` `{ title (3..90), paragraphs: { phase: ShortPhase, text (10..400), chapterIndex: int ≥ 0 }[] (5..12) }`; `pointScriptIssues(script, chapterCount): string[]` — every phase present, phases non-decreasing in `SHORT_PHASES` order, chapter in range
  - `PointScriptRecordSchema` = `PointScriptSchema.extend({ scriptVersion: int ≥ 1, pointId: UlidSchema })`
  - `PointVoiceRecordSchema` `{ scriptVersion, paragraphs: { textHash: /^[0-9a-f]{12}$/, r2Key, durationMs: int > 0, wordTimings: WordTiming[] | null }[] (1..12) }` (reuse `teaserTextHash` for the digest)
  - `PointShotMotion = 'static' | 'kenburns-in' | 'kenburns-out' | 'punch'`; `CropFocus = 'left' | 'centre' | 'right'`
  - `PointPlanShotSchema` `{ startWord: int ≥ 0, crop: CropFocus, motion: PointShotMotion, slot: TimelineSlotSchema | null, pending: { kind: 'stock', query (2..200) } | { kind: 'still', prompt (4..2000) } | null }` with a refine: exactly one of `slot` and `pending` is non-null
  - `PointPlanRecordSchema` `{ shots: PointPlanShotSchema[] (1..40), plannedFor: { scriptVersion: int, voiceHash: string } }`
  - `PointFetchesRecordSchema` `{ candidates: SlotCandidateSchema[] (max 60), state: TeaserFetchStateSchema | null }`

- [ ] **Step 1: Write the failing tests.** `short-rules.test.ts`: `it('pins the playbook numbers')` asserting every Global Constraints value on `SHORT_RULES` and `SHORT_PHASES` order. `talking-points.test.ts`: `talkingPointSetIssues` returns `[]` for a valid three-point set with two types; one issue each for 2 points, 6 points, chapter 7 of 7, one type only, duplicate question ("Who signed?" vs "who signed"), a chapter that leads three points, orders `[1,1,2]`. `pointScriptIssues` flags a missing `bridge`, `resolution` before `delivery`, chapter out of range. `PointPlanShotSchema` refuses both `slot` and `pending` set, and neither set.
- [ ] **Step 2: Run** `pnpm exec vitest run short-rules talking-points` from `packages/schemas`. Expected: FAIL, modules not found.
- [ ] **Step 3: Implement** both modules with the signatures above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schemas): the Shorts rule book and talking-point records`.

---

### Task 2: Timeline additions (punch, crop, bridge overlays)

**Files:**
- Modify: `packages/schemas/src/timeline.ts` (TimelineMotionSchema :140, TimelineSlotSchema :344, OverlaySchema :369), `packages/schemas/src/visuals.ts` (MotionSpecSchema :82), `packages/timeline/src/compile.ts` (motion mapping :140-153)
- Test: `packages/schemas/src/timeline.test.ts`, `packages/timeline/src/compile.test.ts`

**Interfaces:**
- Produces:
  - `TimelineMotionSchema` gains `{ kind: 'punch', scale: number (1 < s ≤ 1.3), durationMs: int (50..1000) }`
  - `TimelineSlotSchema` gains optional `crop: CropFocus` (import from `short-rules.ts`, or define `CropFocusSchema` there)
  - `OverlaySchema` gains `{ kind: 'relatedArrow', startMs, durationMs, props: { label: string (1..40) } }` and `{ kind: 'subscribeBadge', startMs, durationMs, props: { channelName: string (1..80), handle: string (0..80) } }`
  - `MotionSpecSchema` gains `{ kind: 'punch' }`; compile maps it to `{ kind: 'punch', scale: SHORT_RULES.punchScale, durationMs: SHORT_RULES.punchMs }`

- [ ] **Step 1: Failing tests.** `timeline.test.ts`: each new shape parses; `punch` with scale 1.5 is refused; the committed goldens `packages/timeline/src/golden/master-timeline.json` and `short-timeline.json` still parse (proves additivity). `compile.test.ts`: `it('maps a punch brief to the rule book punch')`.
- [ ] **Step 2: Run** `pnpm exec vitest run timeline` (schemas) and `pnpm exec vitest run compile` (timeline). Expected: FAIL.
- [ ] **Step 3: Implement.** Add the variants; extend the compile switch.
- [ ] **Step 4: Run** both, then the full `packages/timeline` and `packages/compositions` suites (they consume the union; exhaustive switches must still compile). Expected: PASS, goldens unchanged.
- [ ] **Step 5: Commit** `feat(schemas): punch motion, crop focus and the bridge overlays`.

---

### Task 3: Render punch, crop and the bridge overlays

**Files:**
- Modify: `packages/compositions/src/lib/motion.ts`, `components/DocumentaryMaster.tsx` (SlotView :146, overlay mounts :93), `components/KenBurnsImage.tsx:34`, `components/StockClip.tsx:36`
- Create: `components/RelatedArrow.tsx`, `components/SubscribeBadge.tsx`
- Test: `packages/compositions/src/lib/motion.test.ts`, `src/snapshot/render.test.ts` (new CASES), `fixtures/timeline.ts` (vertical fixture with both overlays)

**Interfaces:**
- Produces: `punchScale(scale: number, durationMs: number, tMs: number): number` (1 at t=0, `scale` at t ≥ durationMs, ease-out between); `cropPosition(crop: CropFocus | undefined): string` returning `'0% 50%' | '50% 50%' | '100% 50%'` (undefined → centre)

Rules: SlotView wraps any slot whose motion is `punch` in a scaling container (all payload kinds). Image and video slots set `objectPosition: cropPosition(slot.crop)`. `RelatedArrow`: an arrow in the brand accent colour, label in the captions type role, pulsing, its tip pointing down-left towards (120, 1700) on a 1080 × 1920 frame, the label inside the safe area. `SubscribeBadge`: channel name plus handle, brand fonts and colours, centred horizontally, bottom edge at y ≤ 1540. Both slide in over 200 ms. Both scale with `frameScale` like EndCta. The board preview has no SVG renderer for images or overlays (inventory), so no preview change.

- [ ] **Step 1: Failing tests.** `motion.test.ts`: `punchScale(1.15, 250, 0) === 1`, `punchScale(1.15, 250, 250) === 1.15`, monotonic between; `cropPosition` table. Snapshot CASES `PunchImageFixture` (frame at 300 ms), `RelatedArrowFixture`, `SubscribeBadgeFixture` at 1080 × 1920, plus a test asserting both overlay components' bounding boxes (from their layout constants) sit inside `SHORT_RULES.safeArea` except the arrow tip.
- [ ] **Step 2: Run** `pnpm test` in `packages/compositions`. Expected: FAIL (missing goldens and functions).
- [ ] **Step 3: Implement**, then `REGEN_GOLDEN=1 pnpm test` once for the three new cases only, and open the PNGs to check them by eye.
- [ ] **Step 4: Run** `pnpm test` in `packages/compositions` twice. Expected: PASS; existing goldens unchanged (if a pixel diff appears, re-run the package alone before believing it).
- [ ] **Step 5: Commit** `feat(compositions): punch-in, crop focus, related-video arrow and subscribe badge`.

---

### Task 4: Migration 0041 and DB helpers

**Files:**
- Modify: `packages/db/src/schema.ts` (`shortKindEnum` :172, `projects` :426-439, `shorts` :1052, `noticeSubjectEnum` via `NOTICE_SUBJECTS`), `packages/schemas/src/notices.ts:9`, `packages/db/src/shorts.ts`, `packages/db/src/projects.ts:173`
- Create: `packages/db/src/talking-points.ts`, `packages/db/drizzle/0041_*.sql` (generated)
- Test: `packages/db/src/talking-points.integration.test.ts`, `packages/db/src/shorts.integration.test.ts`

**Interfaces:**
- Produces:
  - `shortKindEnum` adds `'point'`; `NOTICE_SUBJECTS` adds `'points'` and `'short'`
  - `projects.shortsPhase`: `text('shorts_phase', { enum: ['points', 'review'] })`, nullable; `setProjectStage(..., next: { ...; shortsPhase?: 'points' | 'review' | null })`
  - table `talking_point_sets`: `id`, `projectId` (cascade), `version` int, `scriptVersion` int, `points` jsonb (`TalkingPoint[]`), `note` text nullable, `approvedAt` timestamptz nullable, `createdAt`; unique `(projectId, version)`
  - `insertTalkingPointSet(db, input: { projectId: string; scriptVersion: number; points: TalkingPoint[]; note: string | null }): Promise<TalkingPointSetRow>` (version = max + 1, append only)
  - `latestTalkingPointSet(db, projectId): Promise<TalkingPointSetRow | undefined>`; `approvedTalkingPointSet(db, projectId): Promise<TalkingPointSetRow | undefined>` (latest with `approvedAt`)
  - `approveTalkingPointSet(db, projectId: string, version: number): Promise<'approved' | 'stale' | 'missing'>` — `'stale'` when a higher version exists
  - `shorts` columns: `pointId` text nullable, `pointScript`, `pointVoice`, `pointPlan`, `pointFetches` jsonb nullable; `insertShort` and `updateShort` accept them; `shortForPoint(db, projectId, pointId): Promise<ShortRow | undefined>`

- [ ] **Step 1: Failing tests.** Append-only versions 1, 2, 3; `approveTalkingPointSet(…, 2)` returns `'stale'` when 3 exists and approves 3 otherwise; `approvedTalkingPointSet` ignores unapproved later versions; a `point` Short round-trips its five new columns; `setProjectStage` writes and clears `shortsPhase`.
- [ ] **Step 2:** Confirm 0041 is free on origin/master, then `pnpm db:generate`. Inspect the SQL: it must `ALTER TYPE "short_kind" ADD VALUE 'point'` and `ALTER TYPE "notice_subject" ADD VALUE` twice, and nothing destructive.
- [ ] **Step 3:** `pnpm db:migrate:test`, then run the two files alone (`pnpm exec vitest run talking-points.integration shorts.integration`, timeout 600000). Expected: FAIL before helpers, PASS after.
- [ ] **Step 4:** Run `packages/db` suite and `packages/schemas` suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): talking-point sets, point Shorts and the shorts phase (migration 0041)`.

---

### Task 5: The point mini master and the bridge ending

**Files:**
- Create: `packages/timeline/src/point.ts`, `packages/timeline/src/golden/point-timeline.json`
- Modify: `packages/timeline/src/short.ts` (`ending`, overlays :187-199), `packages/timeline/src/index.ts`
- Test: `packages/timeline/src/point.test.ts`, `packages/timeline/src/short.test.ts`

**Interfaces:**
- Consumes: `SHORT_RULES`, `PointPlanShot`, `ShortPhase` (Task 1); punch, crop, overlays (Task 2)
- Produces:
  - `POINT_CHAPTER_ID = '0P01NTP01NTP01NTP01NTP01NT'` (26 valid Crockford characters, like `TEASER_CHAPTER_ID`; the test asserts `UlidSchema` accepts it)
  - `interface PointParagraphAudio { text: string; phase: ShortPhase; r2Key: string; durationMs: number; wordTimings: WordTiming[] | null }`
  - `interface ResolvedPointShot { startWord: number; slot: TimelineSlot; crop: CropFocus; motion: PointShotMotion }`
  - `compileShortMaster(input: { master: Timeline; paragraphs: readonly PointParagraphAudio[]; shots: readonly ResolvedPointShot[]; bridge: { label: string; channelName: string; handle: string } }): Timeline`
  - `ShortCompileInput.ending` becomes `'loop' | 'cta' | 'bridge'`; `'bridge'` carries the window's `relatedArrow` and `subscribeBadge` overlays, re-clocked, and adds no `endCta`

Rules for `compileShortMaster`: narration back to back with `SHORT_RULES.paragraphGapMs` between paragraphs; captions via `snapToScript` and `offsetCaptions` as `compileTeaserMaster` does; a shot starts at the `startMs` of caption word `startWord` (shot 0 at 0 ms regardless) and ends at the next shot's start (last ends at narration end); shot `transition` is always `'cut'`; for `image` and `video` payloads the motion maps `kenburns-in/out` → `kenburns` at `SHORT_RULES.kenburnsIntensity`, `punch` → the rule book punch, `static` → static; other payloads keep their own motion unless the plan says `punch`; `crop` copied on. Both bridge overlays span the first `bridge` paragraph's start to narration end. `music: null`, `overlays` = the two bridge overlays. Throws `ValidationError` for no paragraphs, no shots, or a `startWord` beyond the word count.

- [ ] **Step 1: Failing tests.** Golden `matches the committed golden byte for byte` over a fixed 5-paragraph, 6-shot input; shot boundaries land on word times; a video slot gets kenburns replaced but a chart keeps `draw-on`; `startWord` 999 throws; `compileShortTimeline({ ending: 'bridge' })` over the golden output keeps both overlays and adds no `endCta`; the existing `short-timeline.json` golden is unchanged.
- [ ] **Step 2: Run** `pnpm exec vitest run point short` in `packages/timeline`. Expected: FAIL.
- [ ] **Step 3: Implement**; write the new golden once by temporarily writing the file in the test, then remove the write.
- [ ] **Step 4: Run** the full `packages/timeline` suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(timeline): compile a point Short's own master and the bridge ending`.

---

### Task 6: Rule book findings

**Files:**
- Create: `packages/timeline/src/point-rules.ts`
- Test: `packages/timeline/src/point-rules.test.ts`

**Interfaces:**
- Produces: `interface RuleFinding { rule: 'words' | 'runtime' | 'pace' | 'phase-timing' | 'shot-length' | 'hook-punch' | 'bridge-length' | 'transition' | 'new-images'; message: string; shotIndex?: number; phase?: ShortPhase }`; `checkShortRules(input: { timeline: Timeline; paragraphs: readonly { text: string; phase: ShortPhase }[]; newImageCount: number }): RuleFinding[]`

One finding per broken rule, in §4 terms, with the measured value in the message ("The hook runs 3.4 s; the rule book wants it done by 3 s"). `shot-length` uses `cardShotMaxMs` for slot types in `CARD_SLOT_TYPES`; the last shot is exempt from the minimum. Findings never throw.

- [ ] **Step 1: Failing tests:** the Task 5 golden timeline yields `[]`; one test per rule that breaks exactly that rule and asserts exactly one finding of that kind with the measured number in its message.
- [ ] **Step 2: Run** `pnpm exec vitest run point-rules`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(timeline): check a Short against the rule book`.

---

### Task 7: Prompts: talking points and the point script

**Files:**
- Create: `packages/providers/src/prompts/talking-points.ts`, `packages/providers/src/prompts/point-script.ts`
- Modify: `packages/providers/src/prompts/index.ts`; export `scriptRules` from `prompts/script.ts:162` (currently module-private) so both new prompts append it
- Test: `packages/providers/src/prompts/talking-points.test.ts`, `point-script.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and issue functions; `ShortsTension`, `fillSlots`, `outputBudget`, `BibleInUse`, `Note`, `ValidationError`
- Produces:
  - `buildTalkingPointsRequest(input: { bible: BibleInUse; caseTitle: string; chapters: readonly { index: number; title: string; contentMd: string }[]; claims: readonly string[]; tension?: ShortsTension; redo?: { mode: 'all'; note: string | null; current: readonly TalkingPoint[] } | { mode: 'one'; pointId: string; note: string | null; current: readonly TalkingPoint[] } | { mode: 'add'; note: string | null; current: readonly TalkingPoint[] } }): LLMTaskRequest`
  - `parseTalkingPoints(text: string, chapterCount: number, note?: Note): TalkingPointDraft[]` — repairs as decision 293 (trim fields at a sentence, cap at 5), then throws `ValidationError` with the joined `talkingPointSetIssues` when any remain. For `one` and `add`, the caller validates the merged set (Task 9), so this parser takes an `expect: 'set' | 'single'` third param: `parseTalkingPoints(text, chapterCount, expect, note?)`; `'single'` returns a one-element array and skips set issues
  - `mockTalkingPoints(chapters): TalkingPointDraft[]` — three points, types forensic-breakdown, contrarian-thesis, result-first, `order` 1..3, titles starting `MOCK POINT`
  - `buildPointScriptRequest(input: { bible: BibleInUse; caseTitle: string; point: TalkingPoint; chapters: readonly { index: number; title: string; contentMd: string }[]; ctaLine: string | null }): LLMTaskRequest`
  - `parsePointScript(text: string, chapterCount: number, note?: Note): PointScript` (throws on `pointScriptIssues`)
  - `mockPointScript(point: TalkingPoint): PointScript` — one paragraph per phase, 130 words in all, first paragraph starting `MOCK SHORT`

Prompt content (both prompts carry the bible through `fillSlots` and end with `scriptRules`): the talking-points prompt states §3.2's table and rules, the four types with one line each from §2, and that `payoff` must be something the script states. The script prompt states §4.1's phase table, 110 to 160 words, every fact from the chapters given, the bridge promising only the material in the listed bridge chapters, asking once to tap the linked video below, never asking for a subscribe, like or comment, and the CTA line when given.

- [ ] **Step 1: Failing tests.** Request text contains: each type name; "Every fact"; "only what"; "never ask"; the CTA line when given and no CTA sentence when null; the redo note and the current points in `all`, `one` (naming the point to replace) and `add` modes. Parser: a valid fixture parses; a 6-point answer is capped with a repair note; an all-one-type answer throws naming the issue; `'single'` returns one. Script parser: a valid five-phase fixture parses; a missing bridge throws. Mocks pass their own parsers' issue checks.
- [ ] **Step 2: Run** `pnpm exec vitest run talking-points point-script` in `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full `packages/providers` suite (scriptRules export touches lift cases). Expected: PASS.
- [ ] **Step 5: Commit** `feat(prompts): talking points and the point Short script`.

---

### Task 8: Prompt: the shot plan

**Files:**
- Create: `packages/providers/src/prompts/point-plan.ts`
- Test: `packages/providers/src/prompts/point-plan.test.ts`

**Interfaces:**
- Produces:
  - `interface PlanLibraryEntry { ref: number; type: TimelineSlot['type']; payloadKind: string; covered: string; brief: string; chapterIndex: number }`
  - `buildPointPlanRequest(input: { bible: BibleInUse; script: PointScript; words: readonly { index: number; text: string; startMs: number }[]; library: readonly PlanLibraryEntry[]; sourceChapters: readonly number[]; note: string | null }): LLMTaskRequest`
  - `interface PlannedPointShot { startWord: number; crop: CropFocus; motion: PointShotMotion; source: { kind: 'library'; ref: number } | { kind: 'stock'; query: string } | { kind: 'still'; prompt: string } }`
  - `parsePointPlan(text: string, limits: { wordCount: number; libraryCount: number }, note?: Note): PlannedPointShot[]` — refuses a `ref` outside the library, a `startWord` ≥ wordCount, non-increasing `startWord`s, a first shot not at word 0, or more than `SHORT_RULES.newImagesMax` stock+still sources combined (a repair drops the excess new shots, latest first, with a note; the plan stays valid because the previous shot extends)
  - `mockPointPlan(words, library): PlannedPointShot[]` — a shot every 5 words from the library round-robin, first shot `punch`, one `still` source, meeting the rule book on the mock voice

Prompt content: §4.2 to §4.5 and §5.1 to §5.3 in plain rules, with the numbers from `SHORT_RULES` interpolated, the library as a numbered list, the word list with times, and "prefer source chapters ${…}".

- [ ] **Step 1: Failing tests** for each refusal and the over-cap repair, the request containing the library numbers, the times, the note, and the numbers 1.5, 2.5 and 4.
- [ ] **Step 2: Run** `pnpm exec vitest run point-plan`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prompts): plan a point Short's shots from the long form's library`.

---

### Task 9: Events, answers and the talking-points runner

**Files:**
- Modify: `packages/schemas/src/events.ts` (schemas + `EVENT_SCHEMAS`), `apps/web/inngest/events.ts` (+ `BOUND_EVENT_NAMES`), `apps/web/inngest/functions/index.ts`
- Create: `apps/web/lib/point-answers.ts`, `apps/web/inngest/functions/talking-points-runner.ts`
- Test: `apps/web/inngest/functions/talking-points-runner.test.ts`, `packages/schemas/src/events.test.ts`, `apps/web/inngest/events.test.ts`

**Interfaces:**
- Produces events:
  - `shorts/points.requested`: `{ projectId, mode: 'all' | 'one' | 'add', pointId?: Ulid, note: string | null }`
  - `shorts/point.build.requested`: `{ projectId, pointId: Ulid }`
  - `shorts/point.studio.requested`: `{ projectId, shortId: Ulid, op: 'voice' | 'plan', note: string | null }` (the studio's Re-voice and Re-plan, Task 13)
- Produces `apps/web/lib/point-answers.ts`: `proposeTalkingPointsWith(complete: AnswerComplete, input: Parameters<typeof buildTalkingPointsRequest>[0], expect: 'set' | 'single', chapterCount: number): Promise<{ points: TalkingPointDraft[]; repairs: Repair[] }>`, `writePointScriptWith(...)`, `planPointShotsWith(...)` — each `callForAnswer` + `answerOrStop`, as `markShortsWith`
- Produces `talkingPointsRunner` (id `talking-points-runner`, singleton per project with mode `skip`, so a second request while one runs never cancels paid work; the actions refuse first anyway), trigger `shorts/points.requested`:
  1. Load script, outline (`safeParse`; absent → no tension, §3.5), claims, chapters.
  2. Mock: `mockTalkingPoints`. Live: `proposeTalkingPointsWith` with `completeForProject`. Budget → `markStageFailed` with `budgetGateData`.
  3. `one`: replace that point (keep its `order`); `add`: append with `order` = n + 1; validate the merged set with `talkingPointSetIssues`, a non-empty result is a refusal recorded on subject `points` and nothing is saved.
  4. Assign ULIDs to new points, `insertTalkingPointSet`, `recordRepairs({ projectId, subject: 'points', subjectId: null }, repairs)`.
  5. `setProjectStage(..., { stage: 'shorts', stageStatus: 'awaiting_review', shortsPhase: 'points' })`.

- [ ] **Step 1: Failing tests** (mock mode, the existing runner-test harness used by `shorts-runner.test.ts`): `all` writes version 1 with three points and parks at points; `one` writes version 2 with only that point changed; `add` at five points refuses with a `points` notice and writes nothing; a missing outline still proposes; budget refusal fails the stage with the gate.
- [ ] **Step 2: Run** the runner test file alone and the two events tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them again, then `apps/web/inngest` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): propose and redo talking points in their own runner`.

---

### Task 10: shorts-runner hands over to talking points

**Files:**
- Modify: `apps/web/inngest/functions/shorts-runner.ts` (whole body)
- Test: `apps/web/inngest/functions/shorts-runner.test.ts`

**Interfaces:**
- Consumes: Task 4 helpers, Task 9 events

New body (§3.1, §3.5): mark stage `shorts`/`running`; if `approvedTalkingPointSet` exists, send `shorts/point.build.requested` for each approved point with no `shortForPoint` row and set `awaiting_review`/`review`; otherwise send `shorts/points.requested { mode: 'all', note: null }` (the talking-points runner parks the stage). The excerpt marking, excerpt rows and teaser build are removed from this runner; existing `excerpt`/`teaser` rows are left untouched. `deleteShorts` of stale excerpts stays (decision 300 still applies to legacy rows). The old tests for marking and teasers are deleted with the code they test; keep `seedTitle` only if still imported elsewhere.

- [ ] **Step 1: Failing tests:** no approved set → one `shorts/points.requested` sent, no rows created; approved set of 3 with one built Short → two build events, phase `review`, nothing re-proposed; legacy teaser and excerpt rows survive a run.
- [ ] **Step 2: Run** the file alone. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `apps/web/inngest` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the Shorts stage starts from talking points`.

---

### Task 11: Talking points screen and actions

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/talking-points-actions.ts`, `talking-points-screen.tsx`, `apps/web/lib/talking-points-review.ts`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx` (render the screen when `stage === 'shorts' && shortsPhase === 'points'`), `apps/web/lib/run-state.ts` (no "Continue to publish" at phase `points`)
- Test: `talking-points-actions.test.ts`, `talking-points-screen.test.tsx`, `apps/web/lib/talking-points-review.test.ts`

**Interfaces:**
- Produces actions (all `Promise<ActionResult>`, `'use server'` file exporting only async functions):
  - `approveTalkingPoints(projectId: string, version: number)` — `'stale'` → `{ ok: false, error: 'A newer set of talking points exists. Review it before approving.' }`; on success set phase `review`, `stageStatus: 'running'`, send one `shorts/point.build.requested` per point
  - `redoTalkingPoints(projectId: string, note: string)`, `redoTalkingPoint(projectId: string, pointId: string, note: string)`, `addTalkingPoint(projectId: string, note: string)` — each refuses while a `talking-points-runner` run is live ("Talking points are already being redone."), `addTalkingPoint` refuses at 5
  - `removeTalkingPoint(projectId: string, pointId: string)` — writes a new version without it (note `"Removed: <title>"`), refuses below 3
- Produces model `talkingPointsModel(db, projectId): Promise<{ version: number; points: TalkingPointCard[]; history: { version: number; note: string | null; createdAt: string }[]; estimateUsd: number; busy: boolean }>` where `estimateUsd = points.length × pointShortEstimateUsd(channelId)`, and `pointShortEstimateUsd(channelId: string): Promise<number>` = `4 × stillSlotEstimateUsd(channelId)` + `estimateTtsUsd({ provider, characters: 160 × 6 })` + `estimateLlmUsd` for the script (input 12 000, output 1 500 tokens) and the plan (input 8 000, output 3 000) at the scripting model's price + `estimateRenderCostUsd(55, 'short')` (§5.2)
- Screen: cards in `order` showing type (as words: "Forensic breakdown"), title, question, payoff, bridge, source and bridge chapters by title; per card **Redo this one** (opens a note box with a **Redo** button) and **Remove**; below: **Suggest changes** note box + **Redo talking points**, **Add a point**, "Version N", the note history, "Estimated cost to build: $X.XX (estimate)", and the primary **Approve talking points**. While `busy`, buttons are disabled with "Redoing the talking points…". Notices on subject `points` show above the cards.

- [ ] **Step 1: Failing tests.** Actions: each refusal message above; approve sends N events and sets phase; remove at 3 refuses. Model: estimate arithmetic with mocked price helpers. Screen: every button present and labelled; busy state disables them. Run-state: no publish control at `points`.
- [ ] **Step 2: Run** each file alone (`pnpm exec vitest run talking-points` from `apps/web`). Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the files, then `apps/web` lib and app tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): approve, redo and edit talking points`.

---

### Task 12: Building a point Short

**Files:**
- Create: `apps/web/inngest/lib/point-build.ts`, `apps/web/inngest/functions/point-short-runner.ts`
- Modify: `apps/web/inngest/functions/short-render-runner.ts` (compile-short step), `apps/web/inngest/functions/index.ts`, `apps/web/lib/still-prompt.ts` (`StillKind` adds `'short'`, reusing `TEASER_COMPOSITION`)
- Test: `apps/web/inngest/lib/point-build.test.ts`, `apps/web/inngest/functions/point-short-runner.test.ts`, `short-render-runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5, 7, 8, 9; `synthesise`, `fetchStockCandidates`, `generateStillCandidates`, `ingestCandidateBytes`, `slotFromTeaserCandidate`, `masterChapterIds`, `teaserShotPool`
- Produces in `point-build.ts`:
  - `planLibrary(master: Timeline, script: { chapters: readonly { index: number; contentMd: string }[] }): { entries: PlanLibraryEntry[]; slots: TimelineSlot[] }` — `entries[i].ref === i`, `slots[i]` the full snapshot
  - `writePointScript(projectId: string, point: TalkingPoint): Promise<{ ok: true; script: PointScript; scriptVersion: number } | { ok: false; gate: Record<string, unknown> } | { ok: false; skipped: string }>`
  - `voicePointParagraph(input: { projectId: string; shortKey: string; scriptVersion: number; index: number; text: string }): Promise<TeaserVoiceResult>` with idempotency key `point:${projectId}:${shortKey}:${scriptVersion}:${index}:${teaserTextHash(text)}` and R2 key `boom-busters/voice/${projectId}/point/${shortKey}/v${scriptVersion}-${index}.wav`
  - `planPointShots(projectId: string, input: { script; voice: PointVoiceRecord; master: Timeline; sourceChapters; note: string | null }): Promise<{ ok: true; plan: PointPlanRecord } | { ok: false; gate } | { ok: false; skipped: string }>`
  - `fetchPendingShots(projectId: string, plan: PointPlanRecord): Promise<{ plan: PointPlanRecord; fetches: PointFetchesRecord }>` — stock: first candidate ingested; still: `generateStillCandidates(brief, projectId, null, 'short')`; a failed fetch falls back to the previous shot extending (pending shot removed) with a `short` notice
  - `assemblePointShort(input: { master; script; voice; plan; bridge }): { timeline: Timeline; findings: RuleFinding[] }` (`compileShortMaster` + `checkShortRules`)
- `pointShortRunner` (id `point-short-runner`, concurrency 2, singleton per `pointId` mode `skip`, trigger `shorts/point.build.requested`): steps `write-script`, `tts-${i}`, `plan-shots`, `fetch-new`, `assemble` (insert or update the `point` row: `kind 'point'`, `pointId`, `segmentRef { chapterId: POINT_CHAPTER_ID, fromParagraph: 0, toParagraph: n-1 }`, `sourceTimeline`, the four records, `title` from the script), then send `shorts/render.requested`. Skips record on subject `short` (subjectId = point id until the row exists); budget parks the stage. When every approved point has a row, set `awaiting_review`/`review`.
- `short-render-runner`: `kind === 'point'` uses `sourceTimeline` like a teaser and `ending: 'bridge'`. Bridge props: `label` "Full video", `channelName`/`handle` from the `channels` row (`channelForProject`).

- [ ] **Step 1: Failing tests** (mock mode): a build writes a `point` row whose `sourceTimeline` parses, has narration for five phases and both bridge overlays, then sends one render event; a still fetch failure leaves a valid plan and a notice; budget refusal parks the stage; re-sending the event for a point that has a row does nothing; `short-render-runner` compiles a `point` row with `ending: 'bridge'` (no `endCta`); `planLibrary` refs are stable for one master.
- [ ] **Step 2: Run** the three files alone. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `apps/web/inngest` and `apps/web/lib` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): build each approved talking point into a Short`.

---

### Task 13: The point Short studio

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/point-studio.tsx`, `point-studio-actions.ts`, `apps/web/lib/point-studio-model.ts`, `apps/web/inngest/functions/point-studio-runner.ts` (trigger `shorts/point.studio.requested`; `op: 'voice'` re-voices changed paragraphs through `voicePointParagraph` and stores `pointVoice`; `op: 'plan'` runs `planPointShots` with the note and `fetchPendingShots`, keeping the voice; neither cuts, as the teaser rebuild runner does not)
- Modify: `shorts-screen.tsx` (point cards open `PointStudio`; teaser cards keep `TeaserStudio`; point cards show type, bridge chapters and finding count), `apps/web/lib/shorts-review.ts` (`ShortCardModel.kind` includes `'point'`, adds `point: { type; bridgeChapterTitles; findings: number; scriptBehind: boolean } | null`)
- Test: `point-studio-actions.test.ts`, `point-studio.test.tsx`, `apps/web/lib/point-studio-model.test.ts`, `point-studio-runner.test.ts`, and `voice-tab.test.tsx` only if a Settings tab changes (it should not)

**Interfaces:**
- Actions (`'use server'`, async only): `savePointScript(shortId: string, paragraphs: { phase: ShortPhase; text: string; chapterIndex: number }[])` (refuses on `pointScriptIssues`, bumps `scriptVersion`); `revoicePoint(shortId: string)` → `shorts/point.studio.requested { op: 'voice' }`; `replanPoint(shortId: string, note: string)` → `shorts/point.studio.requested { op: 'plan', note }`; `savePointShot(shortId: string, shotIndex: number, choice: { ref: number } | { candidateId: string }, crop: CropFocus, motion: PointShotMotion)`; `fetchPointShotOptions(shortId: string, shotIndex: number, query: string)`, `generatePointStill(shortId: string, shotIndex: number, prompt: string)` (both through the teaser fetcher's adapters, cooldown as decision 234); `assemblePoint(shortId: string)` (recompile, store findings, request render; refuses mid-render); `rebuildPointFromScript(shortId: string)` (§3.5: re-send `shorts/point.build.requested` after clearing the row's records; offered only when `scriptBehind`)
- Model: `pointStudioModel(db, shortId, { presign }): Promise<{ phases: { phase; paragraphs: { text; chapterIndex; voiced: boolean }[] }[]; words: number; estimatedRuntimeSec: number; shots: { index; startMs; durationMs; thumbUrl: string | null; type; crop; motion; source: 'long form' | 'new' }[]; library: TeaserShotOption[]; fetched: TeaserFetchedOptionProp[]; findings: RuleFinding[]; stillEstimateUsd: number; scriptBehind: boolean }>`
- Studio layout: Script (five labelled phase blocks, word count and "about N s" against "45 to 60 s"), Voice (**Re-voice**), Shots (a scrolling list of shot rows, each with thumbnail, time, **Swap** opening the library and fetched pool, crop **Left/Centre/Right** buttons, motion buttons), **Re-plan shots** with note, Findings list, **Assemble and render**. `scriptBehind` shows the sentence "This Short was written from an earlier script." and **Rebuild from the new script**.

- [ ] **Step 1: Failing tests:** each action's refusals (bad phase order, mid-render, rebuild when not behind); model findings and runtime; studio renders every labelled button; studio runner writes a new plan from the note in mock mode and keeps the voice.
- [ ] **Step 2: Run** each file alone. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `apps/web` app and lib tests. Expected: PASS.
- [ ] **Step 5: Commit** in two: `feat(web): point Short studio actions and model`, `feat(web): the point Short studio screen`.

---

### Task 14: Publishing after the long form

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/publish-actions.ts` (`schedulePublish` :645, `reschedulePublish` :700, `publishNow` :674), `apps/web/lib/schedule-slots.ts`, `apps/web/lib/publish-review.ts:502`
- Test: `publish-actions.test.ts` (or the existing publish tests), `apps/web/lib/schedule-slots.test.ts`

**Interfaces:**
- Produces: `shortSlotsAfter(masterPublishAt: Date, slots: readonly ScheduleSlot[], count: number): Date[]` — the next `count` `short` slot instants strictly after `masterPublishAt`, in order
- Guard: for a `short` target whose row is `kind === 'point'`, refuse when the project's master publish record has no `publishAt` ("Schedule the long-form video first.") or when the Short's time is not after it ("A Short goes out after its long-form video, which is scheduled for <date>."). `publishNow` refuses unless the master is live.
- Publish screen: unscheduled point Shorts are pre-filled in `order` with `shortSlotsAfter(...)`, still requiring the owner's Schedule click.

- [ ] **Step 1: Failing tests** for `shortSlotsAfter` (wraps the week, skips longform slots, strictly after) and for each refusal; legacy `teaser`/`excerpt` Shorts are not guarded (behaviour unchanged).
- [ ] **Step 2: Run** the files alone. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them, then `apps/web` tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): point Shorts publish only after their long form`.

---

### Task 15: E2E, docs and release notes

**Files:**
- Modify: `e2e/global-setup.ts` (new seeded project `PLAYBOOK_SHORTS_TITLE = 'Talking points waiting (E2E)'` at `shorts`/`awaiting_review`/`points` with a done master, a script with an outline and talking-point set version 1)
- Create: `e2e/tests/playbook-shorts.spec.ts`
- Modify: `PROGRESS.md` (decisions; next free number at merge), spec status line to "approved, implemented"

- [ ] **Step 1: Write the spec:** open the seeded project → three cards and **Approve talking points** visible → type a note, **Redo talking points** → "Version 2" → **Redo this one** on card 2 → **Approve talking points** → Shorts screen shows three point cards (mock build) → open the studio on one → findings list and **Assemble and render** visible → Publish screen refuses scheduling before the master. Buttons only.
- [ ] **Step 2: Run** from `e2e`: `pnpm exec playwright test tests/playbook-shorts.spec.ts` (scoped from the package; free port 3100 if a previous run was interrupted). Expected: PASS after the seed lands.
- [ ] **Step 3:** Run the existing `publish.spec.ts` and `project-lifecycle.spec.ts`. Expected: PASS (legacy rows untouched).
- [ ] **Step 4:** Write the PROGRESS decisions: one for the design (talking points, rule book, point Shorts), one each for calls made during the build (Task 12's fallback on a failed fetch, and any other choice an implementer had to make). Add the release notes: migration 0041 on prod, `deploy:stacks boom-busters-broker` and `deploy:remotion` before the first real render, `PUT /api/inngest` after the Vercel deploy.
- [ ] **Step 5: Commit** `test(e2e): talking points to point Shorts` and `docs(progress): playbook Shorts`.

---

## Self-review notes

- Spec coverage: §3.1 Tasks 9 to 12; §3.2 Tasks 1, 7, 9; §3.3 Task 11; §3.4 Task 12; §3.5 Tasks 4, 9, 10, 13; §4 Tasks 1, 5, 6, 8; §4.5 punch Tasks 2, 3; §4.6 Tasks 2, 3, 5, 12; §4.7 Task 3 (safe-area test); §5 Tasks 8, 12; §6 Task 13; §7 Tasks 2 to 5; §8 Task 14; §9 every task plus Task 15.
- §4.7's "where a card layout does not fit 9:16, fix it" is checked by Task 3's safe-area test for the new overlays only; existing card layouts were already judged in both frames (decision on `SOCIAL_FRAMES`). If the Task 15 run shows a clipped card, it is a follow-up, not silent.
