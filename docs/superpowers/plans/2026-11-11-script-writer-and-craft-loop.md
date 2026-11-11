# Script Writer and Craft Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The chapter writer drafts from the dossier's scenes, for the channel's audience, in the channel's language, and every chapter passes a script editor's craft check with one bounded repair round before its reviewer call.

**Architecture:** The house style opens on the bible's audience and adds a language line when the bible's language is not English. The chapter request's cacheable prefix carries the same scene list the reviewer already reads (`sceneLines`/`sceneList`, decision 458). A new prompt module builds the craft check (the `scripting` route, with thinking room) and the revision request (the chapter request plus one message). Three new runner steps per chapter (`craft-check-N`, `craft-revise-N`, `craft-recheck-N`) sit between the draft and the next chapter. A pure `settleCraft` turns their results into advisory `craft` warnings and notice lines. The warnings are stored by the self-check step and the notices by the Shorts marking, which already owns the script's notice strip.

**Tech Stack:** TypeScript, Zod 4, Inngest (`@inngest/test`), Vitest, pnpm workspaces. No UI change: Script Studio already renders `craft` warnings, the "Rewrite this passage…" button (`craftInstruction`) and "This sentence is no longer in the chapter".

**Spec:** `docs/superpowers/specs/2026-11-10-script-review-and-craft-design.md`. This plan is its plan 2 (section 12): sections 8 and 10, and the cost-estimate line of section 8. Plan 1 (`docs/superpowers/plans/2026-11-10-script-review-and-gate.md`, decision 458) already shipped section 9's length line, tag budget and `scriptLint`, and section 7's scene list. Read both before starting.

## Global Constraints

- Branch `script-craft-loop`, worktree `.claude/worktrees/script-craft-loop`, from `origin/master` at `937a6f04`.
- Decision number 463 is provisional. At merge, compare `PROGRESS.md` with `origin/master` and renumber only this branch's lines, in a separate commit.
- No migration, no stack deploy. Shipping is a Vercel deploy and `PUT /api/inngest` (the runner's steps change).
- Boom & Busters' composed prompts change on purpose (spec section 4). The lift fixtures (`packages/providers/src/prompts/lift/__fixtures__/script-*.json`) are regenerated once, in Task 5, with `-u`. Never in any other task.
- Prompt text must carry none of `FINANCE_WORDS` (`packages/providers/src/prompts/bible-mocks.ts`). `lift/psychology.test.ts` fails on any.
- No live provider call in tests. The mock craft check returns no findings, so mock runs and e2e never revise.
- A craft finding never parks the gate: every `craft` warning is stored with no `severity` key, and `WARNING_SEVERITY_DEFAULTS.craft` is `advisory`.
- Steps that already exist keep their names and return shapes. Every new step reads the bible, the format and the dossier inside itself. A replayed step result may lack any field this plan adds (memory: parked runs replay old step results).
- The format's fixed lines are the owner's words. The craft check and the revision never see them, and the revision's stored text carries them exactly once.
- Run `pnpm format:check` on tracked files before every commit. Use `--ignore-unknown` and `xargs -n 80`; CI gates on Prettier.
- Vitest path filter: run `pnpm exec vitest run <basename>` from the package directory.
- Integration suites need Docker Desktop and the `boom-busters-test-db` container. Never run two database suites at once.
- Subagents: give every Bash call `timeout: 600000`, and split verification per package and per directory.
- Copy: South African spelling. Prompt text may keep its em dashes; the dash rule is for published copy only.

## Review Focus

1. **A run parked at the script gate before the deploy, approved after it.** Inngest replays it from the top and meets `craft-check-0` with no memo. It must run no craft step: no paid call, no chapter rewritten after the owner approved it. Test in Task 4 (`load-dossier` replayed without `craftLoop`).
2. **A first-pass finding whose sentence the model paraphrased.** It is not in the draft, so it can never be counted as fixed. It reaches the gutter only if the recheck reports it again. Test in Task 3.
3. **A revision that echoes the format's opening or closing line.** The stored chapter must carry each fixed line once. Test in Task 4.
4. **A language code with a region, an English variant, and a code `Intl` cannot name.** `pt-BR` gives "Brazilian Portuguese". `en-GB` and `en` give no line. `xx` gives `xx`, not a crash. Test in Task 1.
5. **A format with Shorts off.** Its mark-shorts step makes no marking, but the craft notices and the outline's repairs must still reach the strip. Test in Task 4.

---

### Task 1: The writer's audience, language and scenes

**Files:**
- Modify: `packages/providers/src/prompts/script.ts:131-183` (`houseStyle`), `:680-735` (`buildChapterRequest`)
- Test: `packages/providers/src/prompts/script.test.ts`

**Interfaces:**
- Consumes: `sceneList(scenes: readonly string[]): string` from `./script-scenes` (already imported in `script.ts`).
- Produces: `buildChapterRequest` input gains `scenes?: readonly string[]`. Its first message becomes `` `Case: ${caseTitle}\n\nClaims:\n${claimList(claims)}\n\nScenes:\n${sceneList(scenes ?? [])}` ``, still the one cacheable prefix message.
- Produces: `export type ChapterRequestInput = Parameters<typeof buildChapterRequest>[0]`.
- Produces: `languageName(code: string): string | null` (exported from `script.ts`). `null` for `''` and for any code whose primary subtag is `en`. Otherwise `new Intl.DisplayNames(['en'], { type: 'language' }).of(code)`, falling back to the code itself when that throws or returns nothing.

Copy (spec section 10):
- The house style's first sentence becomes `` `You write narration for ${audience}, for a documentary channel about` `` followed by the existing `[[example:script-channel-subject]]...` text. `audience` is `literalBibleText(bible.audience.trim())`. With an empty audience the opening stays exactly as today.
- When `languageName(bible.language)` is not null, a paragraph follows the opening: `` `Write every word of the narration in ${name}, whatever language the claims and these rules are in.` ``
- The house style gains this bullet, after the "One canonical name" bullet: `The scenes are the dossier's: use them for what people did, wanted and said. The claims are the facts. A detail in neither is not yours to write.`
- The numbers bullet keeps its `[[example:script-read-aloud-numbers]]` slot. That slot is already the channel's own, so section 10's "the numbers rule's example slot is the channel's own" needs no change.

- [ ] **Step 1: Write the failing tests** in `script.test.ts`, in a new `describe('the writer reads the audience, the language and the scenes (decision 463)')`:
  - `it('opens on the bible's audience')`: `houseStyle(FIRST_CHANNEL_IN_USE.bible)` starts with `You write narration for adults who watch long-form money documentaries, for a documentary channel about`.
  - `it('keeps the old opening when the audience is empty')`: with `{ ...bible, audience: '' }`, it starts with `You write narration for a documentary channel about`.
  - `it('names a non-English language and stays silent for English')`: with `language: 'pt-BR'` the style contains `Write every word of the narration in Brazilian Portuguese`. With `'en'`, `'en-GB'` and `''` it contains no `Write every word of the narration in`.
  - `it('falls back to the code when the language has no name')`: `languageName('xx')` is `'xx'`.
  - `it('tells the writer what the scenes are for')`: the whitespace-collapsed style contains `A detail in neither is not yours to write.`
  - `it('puts the scenes in the cacheable prefix beside the claims')`: `buildChapterRequest({ ...base, scenes: ['March 2001 — the board met.'] })` has `messages[0].content` containing `Claims:\n[1]` and ending `Scenes:\n[S1] March 2001 — the board met.`, and `cacheablePrefixMessages` is `1`.
  - `it('says there are no scenes when none were given')`: without `scenes`, `messages[0].content` ends `Scenes:\nNo scenes.`.
- [ ] **Step 2: Run** `pnpm exec vitest run script.test` from `packages/providers`. Expected: the new tests FAIL. The lift snapshot tests also fail on the changed text; leave them until Task 5.
- [ ] **Step 3: Implement** the interfaces and copy above.
- [ ] **Step 4: Run** the same file. Expected: the new tests PASS. Fix every other test in `script.test.ts` and `script-craft.test.ts` that asserted the old opening or the old first message. Only the `lift` snapshots may still fail.
- [ ] **Step 5: Commit** `feat(prompts): the writer reads the audience, the language and the dossier's scenes (decision 463)`.

---

### Task 2: The craft check and the revision request

**Files:**
- Modify: `packages/schemas/src/script.ts` (beside `SelfCheckSchema`)
- Modify: `packages/providers/src/prompts/script.ts` (export `craftFor` and `scriptRules`; `scriptRules` is already exported)
- Create: `packages/providers/src/prompts/script-craft-check.ts`
- Modify: `packages/providers/src/prompts/index.ts` (add `export * from './script-craft-check'`)
- Test: `packages/schemas/src/script.test.ts`, `packages/providers/src/prompts/script-craft-check.test.ts`

**Interfaces:**
- Produces (schemas): `CRAFT_FINDINGS_MAX = 8`. `CraftFindingSchema = z.object({ sentence: z.string().trim().min(1).max(2000), problem: z.string().trim().min(5).max(300), fix: z.string().trim().min(5).max(300) })`. `CraftCheckSchema = z.object({ findings: z.array(CraftFindingSchema).max(CRAFT_FINDINGS_MAX) })`. Types `CraftFinding` and `CraftCheck`.
- Produces (schemas): `craftWarning(finding: CraftFinding): GutterWarning` = `{ kind: 'craft', sentence: finding.sentence, message }`, where `message` is `` `${problem} Instead: ${fix}` `` cut to 500 characters, ending in `…` when cut. It has no `severity` key.
- Produces (providers): `CRAFT_OUTPUT_TOKENS = 2000` and `CRAFT_THINKING_TOKENS = 10_000`, each with a doc comment citing decision 450's critic precedent. The thinking budget is a ceiling, not a spend.
- Produces (providers): `buildCraftCheckRequest(input: { bible: BibleInUse; outline: Outline; chapterIndex: number; claimCount: number; previousChapters: readonly { title: string; contentMd: string }[]; contentMd: string; intent?: ScriptIntent }): LLMTaskRequest`. It uses `task: 'scripting'` and `maxTokens: outputBudget(CRAFT_OUTPUT_TOKENS, CRAFT_THINKING_TOKENS)`.
- Produces (providers): `parseCraftCheck(text: string, note: Note = ignoreRepairs): CraftCheck`. It runs `capList` on `findings` at `CRAFT_FINDINGS_MAX` (field `craft findings`), then `trimField` on each `problem` and `fix` at 300, then `parseJsonCompletion(…, CraftCheckSchema, 'craft check')`. Model it on `parseShortsCandidates`.
- Produces (providers): `mockCraftCheck(contentMd: string): CraftCheck`, which returns `{ findings: [] }`.
- Produces (providers): `buildChapterRevisionRequest(input: ChapterRequestInput & { draft: string; findings: readonly CraftFinding[] }): LLMTaskRequest`. It is `buildChapterRequest(input)` with one more user message appended, and everything else identical.

The craft check's system prompt, in this order (spec section 8):
1. The framing: `You are the script editor, not the writer. You read ONE chapter against the rules it was drafted under and report where it breaks them. You never rewrite it, and you never judge its facts: another reviewer checks those.`
2. `The rules the writer drafted under:` followed by `houseStyle(bible)`, `craftFor(intent)` and `scriptRules(bible)`, exactly as the chapter request composes them. Pass the whole system through `fillSlots(…, bible)` as `buildChapterRequest` does.
3. The checklist. For tension, each item one line:
   - opening by restating or paraphrasing where the script so far ended
   - ending on resolution, a moral, a summary or a formulaic tease, where a chapter should end on a turn (the final chapter's close, as its contract describes, is the one exception)
   - a recap in the middle
   - a rhetorical question
   - the chapter's planted question answered in the same chapter
   - a withheld fact leaked
   - a stand-alone caveat sentence
   - metronomic sentences
   - tags that gasp at everything
   - a figure, name or attribution the listener has already heard, repeated in full

   For `intent === 'calm'`, use the same list without the planted-question and withheld-fact lines. The ending line becomes: ending on a cliffhanger, a tease or a moral, where a calm chapter settles on its last fact.
4. The limits: `Report at most eight findings, and only what you would make the writer fix. A chapter with nothing worth fixing gets an empty list. A fix never adds a fact, a figure, a name or a quote: it cuts, moves or rewords.`
5. The tag rule from the self-check, word for word: the bracketed tags are direction; never quote one in a sentence.
6. Quoting: `Quote the sentence EXACTLY as it appears, including its punctuation: it is matched back to the text character for character.`
7. The answer: `{"findings": [{"sentence": string, "problem": string, "fix": string}]}`.

The messages: (1) `The script so far, which the listener has just heard:\n\n…`, built with the chapters joined as `scriptSoFar` joins them, or `This is the opening chapter.` when there are none; (2) `ownershipBrief(outline, chapterIndex, claimCount)` and `tensionContract(outline, chapterIndex, intent)`, joined by a blank line and left out when both are empty; (3) `` `Chapter "${outline.chapters[chapterIndex].title}" to review:\n\n${contentMd}` ``. No cacheable prefix: the system is the stable part.

The revision message: `` `Revise this draft. Fix these and change nothing else.\n\nThe draft:\n\n${draft}\n\nThe script editor's notes:\n${notes}` ``. Here `notes` holds one line per finding, `` `${n}. "${sentence}": ${problem} Instead: ${fix}` ``.

- [ ] **Step 1: Write the failing tests.** In `packages/schemas/src/script.test.ts`:
  - `it('makes an advisory craft warning from a finding, cut to the gutter's limit')`: a finding with a 400-character `problem` and a 200-character `fix` gives `kind: 'craft'`, no `severity` key, a message of 500 characters ending in `…`, and `severityOf(warning)` is `'advisory'`.

  In `script-craft-check.test.ts`:
  - `it('judges by the craft file the drafter saw')`: the tension request's system contains a line of `SCRIPT_CRAFT` and `You are the script editor, not the writer`. The calm request's system contains a line of `SCRIPT_CRAFT_CALM` and does not contain `planted question`.
  - `it('runs on the scripting route with thinking room')`: `task` is `'scripting'` and `maxTokens` is `outputBudget(CRAFT_OUTPUT_TOKENS, CRAFT_THINKING_TOKENS)`.
  - `it('sends the script so far, the contract and the chapter, last')`: the last message starts `Chapter "` and ends with the chapter's text. For chapter 0, the first message is `This is the opening chapter.`.
  - `it('names the close as the final chapter's one exception')`: the tension system contains `the final chapter's close`.
  - `it('reads findings back, capping at eight and trimming long fields')`: ten findings give eight, and `note` received `{ action: 'capped', field: 'craft findings', kept: 8 }`.
  - `it('refuses an answer with no findings list')`: `parseCraftCheck('{}')` throws `ValidationError`.
  - `it('revises with the chapter request plus the draft and the notes')`: `buildChapterRevisionRequest({ ...chapterInput, draft: 'D.', findings: [f] })` equals `buildChapterRequest(chapterInput)` except for one more last message. That message starts `Revise this draft. Fix these and change nothing else.` and contains `1. "${f.sentence}": ${f.problem} Instead: ${f.fix}`.
  - `it('carries no finance word under the psychology bible')`: build both requests with the psychology test bible (the `lift/psychology-bible.ts` export). Neither system contains any `FINANCE_WORDS` entry, case-insensitive.
- [ ] **Step 2: Run** `pnpm exec vitest run script.test` from `packages/schemas` and `pnpm exec vitest run script-craft-check` from `packages/providers`. Expected: FAIL on the missing exports.
- [ ] **Step 3: Implement** the interfaces and copy above.
- [ ] **Step 4: Run** both again. Expected: PASS. Then `pnpm typecheck` from the root. Expected: clean.
- [ ] **Step 5: Commit** `feat(prompts): the script editor's craft check and the revision request (decision 463)`.

---

### Task 3: The answer helpers, `settleCraft` and notices beside repairs

**Files:**
- Modify: `apps/web/lib/script-answers.ts`
- Create: `apps/web/lib/script-craft-loop.ts`
- Modify: `apps/web/lib/notices.ts` (`recordRepairs`)
- Test: `apps/web/lib/script-answers.test.ts`, `apps/web/lib/script-craft-loop.test.ts`, `apps/web/lib/notices.test.ts` (create if absent; mock `@boom-busters/db`'s `replaceNotices`)

**Interfaces:**
- Consumes: `buildCraftCheckRequest`, `parseCraftCheck`, `buildChapterRevisionRequest` (Task 2); `callForAnswer`, `callForText`, `Answer` from `@/lib/answer`.
- Produces: `craftCheckWith(complete: AnswerComplete, input: Parameters<typeof buildCraftCheckRequest>[0]): Promise<Answer<CraftCheck>>`. It returns the `Answer` and never throws a stop: a failed check stops only its chapter's loop (spec section 8). A `BudgetExceededError` from `complete` propagates.
- Produces: `reviseChapterWith(complete: AnswerComplete, input: Parameters<typeof buildChapterRevisionRequest>[0]): Promise<Answer<string>>`, on `callForText`. Same rule: it returns, and only a budget error propagates.
- Produces: `type CraftPass = { findings: CraftFinding[]; stopped?: string }`.
- Produces: `settleCraft(input: { chapterNumber: number; draftMd: string; first: CraftPass; revisedMd: string | null; reviseStopped?: string; recheck: CraftPass | null }): { warnings: GutterWarning[]; notices: NewNotice[] }`. `chapterNumber` is 1-based. `draftMd` and `revisedMd` are without fixed lines.
- Produces: `recordRepairs(target, repairs = [], extra: readonly NewNotice[] = [])`. It replaces the subject's notices with the repairs line (when `describeRepairs` gives one) followed by `extra`, in that order. With no repairs and no extra it clears, as today.

`settleCraft` rules. "In" means `text.includes(sentence.trim())`.

| Case | warnings | notices |
|---|---|---|
| `first.stopped` | `[]` | `stopped`: `Chapter {n}: the craft check stopped: {reason}. The chapter keeps its first draft.` |
| no first findings | `[]` | none |
| `reviseStopped` | every first finding, as `craftWarning` | `stopped`: `Chapter {n}: the craft revision stopped: {reason}. Its craft notes are in the gutter.` |
| revised, recheck landed | the recheck's findings | `trimmed` when any finding was fixed: `Chapter {n} revised for craft: {problem}; {problem}.`, cut to `NOTICE_MESSAGE_MAX` |
| revised, `recheck.stopped` | first findings whose sentence is in `revisedMd` | the `trimmed` line as above, then `stopped`: `Chapter {n}: the craft recheck stopped: {reason}.` |

A finding is fixed when its sentence is in `draftMd` and not in `revisedMd`. A paraphrased finding, absent from the draft, is never fixed (Review Focus 2).

- [ ] **Step 1: Write the failing tests.** In `script-craft-loop.test.ts`, one `it` per table row, named for the row. Add:
  - `it('never counts a paraphrased finding as fixed')`: a first finding whose sentence is in neither text, and a recheck with no findings, give no `trimmed` notice.
  - `it('lists each fixed finding once in one notice')`: two findings fixed and one not give one `trimmed` notice naming both problems, and the warnings are the recheck's.

  In `script-answers.test.ts`, a new `describe('the craft loop answers (decision 463)')`:
  - `it('reads a craft check in one call')`
  - `it('returns a stop after two unreadable answers instead of throwing')`: `ok` is `false` and `complete` was called twice.
  - `it('revises on callForText and returns a stop after two cut-offs')`
  - `it('lets a budget stop through')`: `complete` rejects with `BudgetExceededError` for both helpers.

  In `notices.test.ts`:
  - `it('writes the repairs line, then the extra notices, replacing what was there')`
  - `it('writes the extra notices alone when nothing was repaired')`
- [ ] **Step 2: Run** `pnpm exec vitest run script-craft-loop script-answers notices` from `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the craft loop's answers, its settlement and notices beside repairs (decision 463)`.

---

### Task 4: The runner, its scenes, the craft loop and the strip

**Files:**
- Modify: `apps/web/inngest/functions/script-runner.ts`
- Test: `apps/web/inngest/functions/script-runner.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces: a module-level `scenesFor(projectId: string): Promise<string[]>`, which reads `getDossier` and calls `sceneLines`, or returns `[]` with no dossier. The `draft-chapter-N` step and the `self-check-N` step both call it inside the step.
- Produces: `load-dossier` returns `craftLoop: true` beside its existing fields. The chapter loop runs the craft steps only when `setup.craftLoop === true`. A run whose `load-dossier` was memoised before this deploy replays without the field, so it skips the loop entirely (Review Focus 1).
- Produces: `markShortsStep(projectId, input, priorRepairs = [], priorNotices: readonly NewNotice[] = [])`. Each place that writes the strip passes `priorNotices` as `recordRepairs`' `extra`. The stop branch writes when either list is non-empty, then adds its stop.
- Produces: the `written` entry gains `craft: GutterWarning[]`. Its `contentMd` is the revision's when one landed.

Steps per chapter, after `draft-chapter-N` succeeds and only with `craftLoop`:
1. `craft-check-N` reads the channel inside the step (`requireCompleteBible`). In mock mode it returns `{ ok: true, findings: mockCraftCheck(…).findings }`. Live, it calls `craftCheckWith(completeForProject(projectId), …)`. `contentMd` is `dropFixedParagraphs(drafted.contentMd, channel.format)`, and `previousChapters` comes from `written`. It returns `{ ok: true, findings }`, or `{ ok: true, findings: [], stopped: issue }` for a stop. A `BudgetExceededError` returns `{ ok: false, gate: budgetGateData(error) }`.
2. With findings, `craft-revise-N`. It calls `reviseChapterWith` with the same input as the draft step, plus `scenes`, `draft` (without fixed lines) and `findings`. The first-call estimate is `Math.round(chapter.targetWords * 1.6)`, as the draft's. When the revision lands, the step runs `dropFixedParagraphs` on it, then `placeFixedLines`, then `saveChapter` with the new `estRuntimeSec`. It returns `{ ok: true, contentMd }` with the stored text. A stop returns `{ ok: true, stopped: issue }`, and a budget error returns `{ ok: false, gate }`.
3. When the revision landed, `craft-recheck-N` runs as step 1 does, on the revised text without fixed lines.
4. `settleCraft` runs outside any step: it is deterministic over memoised results. Its warnings become the `written` entry's `craft`. Its notices join a run-level `craftNotices: NewNotice[]`.

A `{ ok: false }` from any craft step parks the stage as a chapter does. That is `step.run(`craft-${index}-over-budget`, () => markStageFailed(ctx, gate))` and `return { projectId, outcome: 'over-budget', chaptersWritten: written.length }`.

The `self-check-N` step stores `[...modelWarnings, ...own, ...(chapter.craft ?? []), ...coded]`.

The `mark-shorts` step passes `craftNotices` everywhere it writes:
- live: to `markShortsStep`
- mock: `recordRepairs(target, [], craftNotices)`
- Shorts off: `recordRepairs(target, outlineRepairs, craftNotices)`, where today it writes nothing

Update the function's top comment with one line on the craft loop (decision 463).

Cost (spec section 8, "the stage's cost estimate"): the script stage shows no estimate before it runs, so the budget guard's per-call reservation is the estimate. A craft call reserves at its `maxTokens`, the guard's pessimistic default. A revision reserves at the chapter draft's first-call estimate. Record this in PROGRESS (Task 5).

- [ ] **Step 1: Write the failing tests**, in a new `describe('the craft loop (decision 463)')` inside the existing database suite. A `withCraft` helper adds `craftLoop: true` to `throughSelfCheck()`'s `load-dossier` result. `live(answer)` and `savedChapter()` follow the decision 458 block's pattern.
  - `it('sends the scene list in the chapter request')`: put a `## Timeline` bullet on the dossier, as the decision 458 test does. `executeStep('draft-chapter-0')` live with `callLlm` resolving a chapter text. `callLlm`'s first request has `messages[0].content` containing `Scenes:\n[S1]`.
  - `it('checks the chapter without its fixed lines')`: give the format fixed lines (`FIXED_LINES`). Run `executeStep('craft-check-0')` with the draft step returning `fixedChapter`. The request's last message contains `chapters[0].contentMd` and neither fixed line.
  - `it('returns a stop for an unreadable craft check, never failing the step')`: `callLlm` resolves `'not json'` twice. The result is `{ ok: true, findings: [], stopped: <string> }`.
  - `it('saves the revision with each fixed line once')` (Review Focus 3): `craft-check-0` returns one finding. `callLlm` resolves a revision that begins with `FIXED_LINES[0]`. The chapter row's `contentMd` contains `FIXED_LINES[0]` exactly once and `FIXED_LINES[1]` exactly once, and the step returns that text.
  - `it('hands the revision to the self-check and stores the recheck's findings as advisory craft warnings')`: mock `craft-check-0` (one finding), `craft-revise-0` (`{ ok: true, contentMd: 'REVISED. Text.' }`) and `craft-recheck-0` (one finding on `REVISED.`). Run `executeStep('self-check-0')` live with `callLlm` resolving `{ warnings: [] }`. The self-check request carries `REVISED.`. The stored warnings contain `{ kind: 'craft', sentence: 'REVISED.' }` with no `severity`.
  - `it('skips the revision and the recheck when the first check finds nothing')`: `craft-check-0` returns `{ ok: true, findings: [] }`. Run `executeStep('self-check-0')` live. `callLlm` was called once, for the self-check.
  - `it('runs no craft step for a run that loaded before the deploy')` (Review Focus 1): use `throughSelfCheck()` as is, with no `craftLoop`, then `executeStep('self-check-0')` live. `callLlm` was called once, and no request had `task: 'scripting'`.
  - `it('parks the stage when a craft call is over budget')`: `engine.execute` with `craft-check-0` returning `{ ok: false, gate: { message: 'Over budget' } }`. The outcome is `'over-budget'`.
  - `it('puts the craft notices on the strip in mock mode')`: run `executeStep('mark-shorts')` with the loop's steps mocked so `settleCraft` yields a `trimmed` notice. `recordRepairs` was called with `(SCRIPT_NOTICES, [], [expect.objectContaining({ kind: 'trimmed' })])`.
  - `it('puts the craft notices and the outline repairs on the strip with Shorts off')` (Review Focus 5): use the Shorts-off setup from the existing `describe`. `recordRepairs` was called with the outline's repairs and the craft notices.

  In the `markShortsStep` suite, add `it('writes the craft notices after the repairs, and keeps them when the marking stops')`.
- [ ] **Step 2: Run** `pnpm exec vitest run script-runner` from `apps/web`, with Docker up. Expected: the new tests FAIL and the existing ones PASS.
- [ ] **Step 3: Implement** the interfaces and steps above.
- [ ] **Step 4: Run** `pnpm exec vitest run script-runner`, then `pnpm exec vitest run inngest/functions`, then `pnpm exec vitest run lib`, all from `apps/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(script-runner): each chapter passes a craft check with one repair round, and the drafter reads the scenes (decision 463)`.

---

### Task 5: Lift fixtures, PROGRESS and verification

**Files:**
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts` (new cases)
- Modify: `packages/providers/src/prompts/lift/__fixtures__/script-*.json` (regenerated, new ones created)
- Modify: `PROGRESS.md`; `docs/superpowers/specs/2026-11-10-script-review-and-craft-design.md` (status line)

- [ ] **Step 1: Add the lift cases** with `liftAware`, following `script-self-check`'s shape:
  - `script-chapter-scenes`: `script-chapter-first` with `scenes` set to the self-check case's one scene line.
  - `script-craft-check`: chapter 1 of `OUTLINE`, `previousChapters: [CHAPTER_ONE]`, `contentMd: CHAPTER_TWO.contentMd`, `claimCount: CLAIMS.length`.
  - `script-craft-check-calm`: the same with `intent: 'calm'`.
  - `script-chapter-revise`: `script-chapter-middle`'s input with `draft: CHAPTER_TWO.contentMd` and two findings.

  If `psychology.test.ts` flags case text such as `CHAPTER_TWO`, list those words in the case's `inputText`, as `script-outline-search` does.
- [ ] **Step 2: Regenerate** from `packages/providers`: run `pnpm exec vitest run lift -u`, then `git diff --stat -- src/prompts/lift/__fixtures__`. Expected: only `script-*.json` changed or added. Stop and find the stray edit if any other family moved.
- [ ] **Step 3: Read the diffs** of `script-outline.json`, `script-chapter-first.json` and `script-regenerate.json` in full. List every changed line of prompt text for PROGRESS. Expected: the audience opening, the scenes bullet and the `Scenes:` block, and nothing else.
- [ ] **Step 4: Write the PROGRESS section** `## Script writer and craft loop (2026-11-11)`, in the house shape of the decision 458 section. It holds:
  - The blockquote: decision 463, branch, spec and plan paths, no migration.
  - Deliverables, one line per task with its commit hash.
  - Owner actions at deploy: `PUT /api/inngest`; check the `scripting` route, since the craft check judges on it; the hedging-rules paste from decision 458 if it is still undone.
  - The prompt changes from Step 3.
  - Decision 463's lettered lines:
    - (a) No stage estimate exists, so each craft call is reserved by the guard at its `maxTokens`, and a revision at the chapter's estimate.
    - (b) The loop runs only for a run whose `load-dossier` carries `craftLoop`, so a run parked before the deploy is never revised after approval.
    - (c) One notice per revised chapter, of kind `trimmed`, listing its fixed findings, so a seven-chapter script carries at most seven Dismiss buttons. A new kind would need a migration.
    - (d) A fixed finding is one whose sentence was in the draft and is gone from the revision.
    - (e) A revision stop stores the first findings; a recheck stop stores those still in the revision.
    - (f) The craft notices are written with the strip at mark-shorts, and the Shorts-off branch now writes the outline's repairs too.
    - (g) The mock craft check finds nothing, so mock runs and e2e never revise; the revision path is proven in the runner harness.
    - (h) The calm checklist drops the planted-question and withheld-fact lines.
- [ ] **Step 5: Amend the spec.** Set the status line to `plans 1 and 2 shipped as decisions 458 and 463; plans 3 to 8 open.` In section 8's "Steps and the revised text" paragraph, replace the last sentence ("A run parked before the deploy replays its old steps and meets the new step names only for chapters it has not reached.") with: `A run parked before the deploy replays a load-dossier result without craftLoop and runs no craft step at all: Inngest would otherwise execute the new steps on replay, revising chapters after approval (decision 463).`
- [ ] **Step 6: Verify**, one package at a time:
  - From the root: `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` on tracked files.
  - `pnpm exec vitest run` from `packages/schemas`, then from `packages/providers`.
  - From `apps/web`, by directory: `inngest/functions`, `lib`, `app`, `components`.
  - `pnpm e2e` in batches, from the e2e package (memory: scoped e2e runs).

  Expected: all green, apart from the four local e2e failures that also fail on master (memory).
- [ ] **Step 7: Commit** `chore(prompts): regenerate the script lift fixtures; PROGRESS for decision 463`.
- [ ] **Step 8: Prepare the merge.** Run `git fetch origin master` and compare decision numbers with `origin/master`; renumber in a separate commit if 463 is taken. Merge through a merge branch from the worktree (memory). Push once, and hand the push line to the owner if it is refused.
