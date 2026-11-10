# Script Review and Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The script reviewer blocks only on grounding, liability and repeats, advises on everything else, and the gate auto-approves a script with zero blocking warnings, for any channel.

**Architecture:** Severity is a property of a warning kind in `packages/schemas` (`severityOf`, `countBySeverity`), stored on the row only when a pass knows better than the default (the standing pass, per research profile). The claim list prints a legal marker only for `alleged` and `ruled`. The self-check prompt is rewritten around three rules (grounding against claims and scenes, liability on ALLEGED claims, standing per profile) and no longer returns claim refs. Deterministic style and length checks (`scriptLint`) run in the self-check step and store advisory warnings. The gate, the gate line, the project page and Script Studio's gutter read blocking and advisory apart. A scoring script prints the numbers.

**Tech Stack:** TypeScript, Zod 4, Drizzle (Postgres), Inngest (`@inngest/test`), Vitest, Next.js App Router, Playwright, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-10-script-review-and-craft-design.md` (read it first; section numbers below refer to it). This plan is the spec's plan 1 (section 12). Plan 2 (the writer and the craft loop) follows and reuses the interfaces named here.

## Global Constraints

- Boom & Busters' composed prompts DO change in this plan (spec section 4, anti-goals): the lift fixtures `packages/providers/src/prompts/lift/__fixtures__/script-*.json` and `metadata-*.json` are regenerated once, in Task 10, with `-u`, and every changed line of the investigation prompts is listed in PROGRESS. Never regenerate them in any other task.
- A warning row stored before this plan has no `severity`. `severityOf` reads it as its kind's default, and every kind that existed before this plan defaults to `blocking`.
- The reviewer's grounding and liability rules run for every channel; no bible field, profile or format switches them off.
- A research profile with `review: null` adds no standing rule and its reviewer prompt stays free of the word "standing".
- No live provider call in tests. Mock mode stays the default; the mock self-check keeps one blocking warning on the first sentence.
- Prompt text must carry none of `FINANCE_WORDS` (`packages/providers/src/prompts/bible-mocks.ts`): the psychology sweep in `lift/psychology.test.ts` fails on any.
- The runner's step names stay as they are (`load-dossier`, `outline`, `save-outline`, `draft-chapter-N`, `self-check-N`, `mark-shorts`, `finish-draft`, `auto-approve`, `open-gate`, `close-gate`). Anything a step newly needs is read inside that step; a replayed step result may lack any field this plan adds (memory: parked runs replay old step results).
- No migration. `claim_refs` stays as a table, unwritten.
- Decision number 457 is provisional. At merge, compare with `origin/master` and renumber only this branch's lines, in a separate commit.
- Run `pnpm format:check` on tracked files before every commit (CI gates on Prettier).
- Vitest path filter: run `pnpm exec vitest run <basename>` from the package directory. `pnpm --filter <pkg> test -- <path>` runs the whole package.
- Integration suites need Docker Desktop running and the `boom-busters-test-db` container up. Never run two database suites at once.
- Subagents: give every Bash call `timeout: 600000`, and split verification per package.
- Copy rules for UI text: South African spelling, no em or en dashes, button-first. The dash rule is for published copy only; the prompt's claim list keeps its em-dash markers.
- Branch: `script-review-gate` from `master`.

## Review Focus

1. **A chapter row stored before this plan carries 22 warnings of the old kinds and no `severity`.** It must count as 22 blocking, park the gate, and render in the gutter as blocking. Tests in Task 1 (`severityOf` without the field) and Task 8 (the dense fixture).
2. **A run parked at `finish-draft` before the deploy replays a summary with `warnings` and no `blocking`.** The gate must read `blocking` as the old `warnings` count, never as zero. Test in Task 7.
3. **An `overstated-standing` warning whose message carries no recognisable label** (the model paraphrased). It must not silently become advisory. Test in Task 4 (`standingSeverity` returns null, the kind default is blocking).
4. **A dossier row with `research: null`** (researched before grounding, or a fixture). The scene list must come from the markdown's Timeline section, and with neither the reviewer must still run with "No scenes". Test in Task 3.
5. **A chapter made only of narration tags and a fixed line**, or an empty chapter. `scriptLint` must not divide by zero, must not flag the fixed lines, and must anchor every chapter-level finding to a sentence that exists. Test in Task 6.

---

### Task 1: Warning kinds, severity and the counts

**Files:**
- Modify: `packages/schemas/src/script.ts:150-181` (`WARNING_KINDS`, `GutterWarningSchema`, `ClaimRefSchema`, `SelfCheckSchema`)
- Test: `packages/schemas/src/script.test.ts`

**Interfaces:**
- Produces: `WARNING_KINDS` adds `'overstated-standing'`, `'craft'`, `'style'`, `'off-target-length'` after the four existing kinds.
- Produces: `WARNING_SEVERITIES = ['blocking', 'advisory'] as const`, `WarningSeveritySchema`, `type WarningSeverity`.
- Produces: `GutterWarningSchema` gains `severity: WarningSeveritySchema.optional()`.
- Produces: `WARNING_SEVERITY_DEFAULTS: Record<WarningKind, WarningSeverity>` = unsourced-claim, missing-alleged, unsupported-attribution, repeats-earlier, overstated-standing: `blocking`; craft, style, off-target-length: `advisory` (spec 5.2 table; overstated-standing's default is blocking so an unresolved label never relaxes the gate).
- Produces: `severityOf(warning: Pick<GutterWarning, 'kind' | 'severity'>): WarningSeverity` (the stored one, else the kind's default).
- Produces: `countBySeverity(chapters: readonly { warnings: readonly GutterWarning[] }[]): { blocking: number; advisory: number }`.
- Produces: `SelfCheckSchema = z.object({ warnings: z.array(GutterWarningSchema).max(200) })`. `ClaimRefSchema` is deleted. `SelfCheck` has no `refs`.

- [ ] **Step 1: Write the failing tests** in `script.test.ts`, a new `describe('warning severity')`:
  - `it('defaults every kind that existed before severity to blocking')`: for each of the four old kinds, `severityOf({ kind })` is `'blocking'`.
  - `it('defaults craft, style and off-target-length to advisory')`.
  - `it('reads a stored severity over the default')`: `severityOf({ kind: 'overstated-standing', severity: 'advisory' })` is `'advisory'`.
  - `it('counts blocking and advisory across chapters')`: two chapters, warnings `[unsourced-claim, style, { kind: 'overstated-standing', severity: 'advisory' }]` and `[repeats-earlier]` give `{ blocking: 2, advisory: 2 }`.
  - `it('parses a self-check without refs and rejects one with an unknown kind')`: `SelfCheckSchema.parse({ warnings: [] })` succeeds; `{ warnings: [], refs: [] }` still parses (Zod strips the unknown key) so the assertion is on `'refs' in parsed === false`.
- [ ] **Step 2: Run** `pnpm exec vitest run script.test` from `packages/schemas`. Expected: FAIL on the missing exports.
- [ ] **Step 3: Implement** the interfaces above in `script.ts`. Update the doc comment on `WARNING_KINDS` for each new kind in one line each (spec 5.2 table).
- [ ] **Step 4: Run** the same test file. Expected: PASS. Then `pnpm typecheck` from the repo root and fix every consumer of `SelfCheck.refs` and `ClaimRefSchema` that fails to compile: `packages/providers/src/prompts/script.ts` (`mockSelfCheck` returns `{ warnings }`; `parseSelfCheck` unchanged), `packages/providers/src/prompts/script.test.ts` (`parseSelfCheck` tests lose `refs`; delete `it('reads refs back')`), `apps/web/inngest/functions/script-runner.ts` (remove the `saveClaimRefs` call and the `refs` in the step's return, which becomes `{ warnings: number }`), `apps/web/inngest/functions/script-runner.test.ts` (`throughSelfCheck` returns `{ warnings: 0 }`).
- [ ] **Step 5: Delete `saveClaimRefs`** from `packages/db/src/scripts.ts` and its export, and its two tests in `packages/db/src/scripts.integration.test.ts` (the `claimRefsFor` helper goes with them). Amend `docs/03-build-spec.md:185`: "self-check pass (Haiku) writes claim_refs and gutter warnings" becomes "self-check pass (Haiku) writes gutter warnings (blocking and advisory, decision 457)". Leave line 114's table row, with "(unwritten since decision 457)" appended.
- [ ] **Step 6: Verify** `pnpm typecheck` and `pnpm lint` from the root, `pnpm exec vitest run script.test` from `packages/schemas` and `packages/providers`, and with Docker up `pnpm exec vitest run scripts.integration` from `packages/db`. Expected: all PASS.
- [ ] **Step 7: Commit** `feat(schemas): warning severity, and the self-check answer loses claim refs (decision 457)`.

---

### Task 2: The claim list's legal marker

**Files:**
- Modify: `packages/providers/src/prompts/script.ts:54-96` (`ScriptClaim`, `claimList`)
- Modify: `apps/web/inngest/functions/script-runner.ts:250-258` (the claim mapping)
- Modify: `apps/web/inngest/lib/plan-inputs.ts:52`, `apps/web/inngest/functions/visuals-runner.ts:158`, `apps/web/app/(console)/projects/[id]/publish-actions.ts:253` (the other three claim mappings, which never set `adjudicated` and so printed every claim as NOT adjudicated; each gains `legal: claim.legalStatus` so the metadata prompt's allegation rule still has claims to apply to)
- Modify: `packages/providers/src/prompts/metadata.ts:239,344` (the two sentences that say "NOT adjudicated")
- Modify: every fixture that sets `adjudicated`: `packages/providers/src/prompts/script.test.ts:36-50`, `shotlist.test.ts:35,42`, `lift/lift-cases.ts:103-135`, `apps/web/inngest/functions/script-runner.test.ts:294-333`
- Test: `packages/providers/src/prompts/script.test.ts`, `metadata.test.ts:124`, `apps/web/inngest/functions/script-runner.test.ts`

**Interfaces:**
- Produces: `ScriptClaim.legal?: 'ruled' | 'alleged' | 'none'` replaces `adjudicated`. The type is `LegalStatus` from `@boom-busters/schemas` (`LEGAL_STATUSES`).
- Produces: `claimList` prints ` — ALLEGED, not ruled` for `alleged`, ` — RULED` for `ruled`, nothing for `none` or absent. UNVERIFIED, the standing label, NEWS ARTICLE and X POST follow exactly as before.
- Produces: the runner and the three other mappings map `legal: claim.legalStatus`.

- [ ] **Step 1: Write the failing tests.** In `script.test.ts`, replace `it('marks which claims are not adjudicated')` and the two `claimList` tests at lines 1002-1010 with:
  - `it('marks an alleged claim and a ruled claim, and a plain fact not at all')`: three claims; the list contains `${DASH} ALLEGED, not ruled` once, `${DASH} RULED` once, and neither `adjudicated` nor `ADJUDICATED` anywhere.
  - `it("appends a claim's evidence standing after the legal marker")`: `legal: 'none', standing: 'ONE STUDY'` gives `[1] (id: c1) Text ${DASH} ONE STUDY`; `legal: 'alleged', standing: 'ONE STUDY'` gives `[1] (id: c1) Text ${DASH} ALLEGED, not ruled ${DASH} ONE STUDY`.
  In `metadata.test.ts:124` the assertion becomes `/marked ALLEGED/` and `/allegation or a question/` stays.
  In `script-runner.test.ts:294` the test becomes `it('carries each claim's legal status to the claim list')`, expecting `legal: 'ruled'`, `legal: 'alleged'`, `legal: 'none'` and no `adjudicated` key; line 378's expectation becomes `'— CONTESTED'` with no legal marker (the stored claim is `none`).
- [ ] **Step 2: Run** `pnpm exec vitest run script.test metadata.test` from `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.** `claimList` per the interface. `metadata.ts:239` becomes "A claim marked ALLEGED is an allegation: a title may frame it as an …" (keep the rest of the sentence); `metadata.ts:344` becomes "Where a claim is marked ALLEGED, write \"alleged\", \"reportedly\" or \"according to\". Never invent …" (keep the rest). Fixtures: `adjudicated: true` becomes `legal: 'ruled'`; `adjudicated: false` becomes `legal: 'alleged'` where the claim text accuses (script.test's "Former staff say the CEO knew", lift-cases ID_3 "A short seller alleged…") and `legal: 'none'` otherwise (lift-cases ID_1, ID_4).
- [ ] **Step 4: Run** the providers tests again, then with Docker up `pnpm exec vitest run script-runner` from `apps/web`. Expected: PASS except the lift snapshot tests, which fail on the changed claim list and stay failing until Task 10. Confirm the only failing file is `lift.test.ts`.
- [ ] **Step 5: Commit** `feat(prompts): the claim list marks ALLEGED and RULED, and nothing on a plain fact (decision 457)`.

---

### Task 3: The scene list

**Files:**
- Create: `packages/providers/src/prompts/script-scenes.ts`
- Test: `packages/providers/src/prompts/script-scenes.test.ts`

**Interfaces:**
- Produces: `sceneLines(dossier: { research: GroundedResearch | null; contentMd: string }): string[]`. With `research?.scenes` non-empty, one line per scene: `${when} — ${what} (${who}). ${why}` with `what` and `why` trimmed and `what` stripped of a trailing full stop (as `renderDossierMarkdown` does; share its `unstop` by exporting it from `dossier-render.ts`). Otherwise the bullet lines of the markdown's `## Timeline` section, up to the next `## ` heading, each with its leading `- ` removed, markdown emphasis (`**`, `*`) stripped, and any trailing ` ([source](…))` link or `(unplaced)` removed. Empty when neither exists.
- Produces: `sceneList(scenes: readonly string[]): string`: `No scenes.` when empty, else `[S1] …` one per line. The `S` prefix keeps a scene number apart from a claim number.

- [ ] **Step 1: Write the failing tests:**
  - `it('renders the stored scenes when the research carries them')`: a `GroundedResearch` with two scenes (build with `mockScenes()` from `dossier-mocks.ts` wrapped in a grounded ref `{ found: true, … }` as the dossier tests do) gives two lines, the first starting with the scene's `when`.
  - `it('falls back to the Timeline section of the markdown')`: `research: null` and a markdown with `## Timeline` holding two bullets with bold dates and a source link, followed by `## Open questions`; gives two lines, neither containing `**`, `[source]` or `(unplaced)`.
  - `it('is empty with neither, and the list says so')`: `sceneLines({ research: null, contentMd: '# T' })` is `[]`; `sceneList([])` is `'No scenes.'`.
  - `it('numbers scenes with an S')`: `sceneList(['a', 'b'])` is `'[S1] a\n[S2] b'`.
- [ ] **Step 2: Run** `pnpm exec vitest run script-scenes` from `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement** `script-scenes.ts` and export both functions from the package's prompts index (where `claimList` is exported).
- [ ] **Step 4: Run** the test again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prompts): one scene list for the script's drafter and reviewer (decision 457)`.

---

### Task 4: The profile's review block and the standing severity

**Files:**
- Modify: `packages/schemas/src/research-profiles.ts` (`ResearchProfile`, both profiles, new functions)
- Test: `packages/schemas/src/research-profiles.test.ts`

**Interfaces:**
- Produces: `ResearchProfile.review: { standing: { blocking: readonly string[]; advisory: readonly string[] } } | null`. `investigation.review = null`; `science.review = { standing: { blocking: ['contested'], advisory: ['single_study'] } }`.
- Produces: `standingSeverity(profile: ResearchProfile, message: string): WarningSeverity | null`: null when `profile.review` or `profile.evidence` is null; else the first status whose `scriptLabel` the message contains (case-sensitive, the label is upper case) mapped through `review.standing` (blocking list, advisory list, else null); null when no label is found.
- Produces: `withStandingSeverity(profile: ResearchProfile, warnings: readonly GutterWarning[]): GutterWarning[]`: every `overstated-standing` warning gets `severity: standingSeverity(...)` when that is non-null; other warnings and unresolved ones are returned untouched (no `severity` key added).

- [ ] **Step 1: Write the failing tests:**
  - `it('the investigation reviews no standing and the science blocks contested, advises one study')`.
  - `it('reads the label out of the message')`: science, `'CONTESTED: narrated as settled'` is `'blocking'`; `'Narrated as settled, but the claim is ONE STUDY'` is `'advisory'`; `'ESTABLISHED FINDING'` is null (listed in neither); `'no label here'` is null; investigation with `'CONTESTED'` is null.
  - `it('stamps severity on overstated-standing warnings only')`: `withStandingSeverity(science, [{ kind: 'overstated-standing', sentence: 's', message: 'ONE STUDY …' }, { kind: 'unsourced-claim', … }])` gives the first with `severity: 'advisory'` and the second with no `severity` key (`toEqual` on the exact object).
- [ ] **Step 2: Run** `pnpm exec vitest run research-profiles` from `packages/schemas`. Expected: FAIL.
- [ ] **Step 3: Implement.** Import `GutterWarning` and `WarningSeverity` types from `./script` (`research-profiles.ts` already imports from `./dossier`; a type-only import avoids a cycle).
- [ ] **Step 4: Run** the test again. Expected: PASS. `pnpm typecheck` from the root: PASS (`RESEARCH_PROFILES` is typed, so the missing `review` on either profile fails to compile until added).
- [ ] **Step 5: Commit** `feat(schemas): the research profile says which standing statuses block the script gate (decision 457)`.

---

### Task 5: The reviewer prompt

**Files:**
- Modify: `packages/providers/src/prompts/script.ts:730-779` (`buildSelfCheckRequest`, `mockSelfCheck`)
- Modify: `packages/providers/src/prompts/script.ts:338-341` (the outline's `constraints` instruction)
- Modify: `packages/schemas/src/channels.ts:268-275` (`FIRST_CHANNEL_BIBLE.hedgingRules`)
- Modify: `packages/providers/src/prompts/bible-mocks.ts:44-52` (`PSYCHOLOGY_TEST_BIBLE.hedgingRules`)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts:741-748` (the `script-self-check` case gains `scenes`)
- Test: `packages/providers/src/prompts/script.test.ts`, `packages/schemas/src/channels.test.ts`

**Interfaces:**
- Consumes: `claimList`, `sceneList` (Task 3), `researchProfileOf` and the profile's `review`/`evidence` (Task 4), `houseStyle`'s hedging block (`literalBibleText(bible.hedgingRules)`).
- Produces: `buildSelfCheckRequest(input: { bible; chapterTitle; contentMd; claims; scenes?: readonly string[]; intent? })`. `scenes` absent prints `No scenes.`
- Produces: `standingRules(profile: ResearchProfile): string`, exported, `''` when `profile.review` is null.
- Produces: the answer shape is `{"warnings": [{"kind": string, "sentence": string, "message": string}]}`.

- [ ] **Step 1: Write the failing tests** in `script.test.ts`, in `describe('buildSelfCheckRequest')` and a new `describe('the reviewer per profile')`:
  - `it('grounds a sentence on the claims or the scenes, and names what is never unsourced')`: the system contains `claim list or the scene list`, `"It vanished."`, `"She checked her watch"` (the grounded example), and the messages contain `Scenes:\n[S1]` when `scenes: ['A scene']` is given and `Scenes:\nNo scenes.` when it is not.
  - `it('scopes missing-alleged to ALLEGED claims')`: the system contains `marked ALLEGED` and contains neither `NOT adjudicated` nor `adjudicated`.
  - `it("carries the channel's hedging rules")`: with a bible whose `hedgingRules` is `'The hard rules:\n- Kilroy was here.'`, the system contains `Kilroy was here.`
  - `it('asks for warnings only, no refs')`: the system contains `{"warnings": [{"kind": string, "sentence": string, "message": string}]}` and not `"refs"`.
  - `it('adds no standing rule for the investigation')`: with `FIRST_CHANNEL_IN_USE`, the system does not contain `overstated-standing` and `standingRules(RESEARCH_PROFILES.investigation)` is `''`.
  - `it('adds the science standing rule with its labels and which ones block')`: with a bible `{ ...FIRST_CHANNEL_BIBLE, researchProfile: 'science' }`, the system contains `overstated-standing`, `CONTESTED`, `ONE STUDY`, `ESTABLISHED FINDING`, and the sentence `A claim with no such label is outside this rule.`
  - `it('names the four kinds the reviewer may return')`: the system contains `unsourced-claim`, `missing-alleged`, `unsupported-attribution` and, under science, `overstated-standing`; never `repeats-earlier`, `craft`, `style`.
  - `it('keeps one blocking warning in mock mode')`: `mockSelfCheck('First. Second.')` is `{ warnings: [{ kind: 'unsourced-claim', sentence: 'First.', message: expect.any(String) }] }`.
  - The outline test at line 188 gains: the system contains `which ALLEGED claims it narrates` and `a claim with no legal marker needs no attribution and no caveat` and not `what must stay\nattributed`.
  In `channels.test.ts`: `it("the seed bible's hedging rules speak of ALLEGED and RULED, never adjudicated")`: `FIRST_CHANNEL_BIBLE.hedgingRules` contains `marked ALLEGED`, `marked RULED`, `no marker`, and not `adjudicated`.
- [ ] **Step 2: Run** `pnpm exec vitest run script.test` from `packages/providers` and `channels` from `packages/schemas`. Expected: FAIL.
- [ ] **Step 3: Write the seed bible's hedging rules** (spec 6.2, exact text):

  ```
  The hard rules:
  - Assert nothing the claim list and the dossier's scenes do not support.
    Never invent figures, dates, quotes, names or actions by a real person.
  - A claim marked ALLEGED is an accusation no court or regulator has ruled on.
    Where the narration states what that accusation says, carry the hedge
    inline: "alleged", "prosecutors say", "according to the complaint". A
    claim marked RULED is stated as the court or regulator found it. A claim
    with no marker is a fact of the record: state it plainly, with no hedge
    and no attribution unless the attribution is itself the point.
  - Never a sentence of its own saying that nothing was proven, that no court
    has found, that the figures are unaudited, or that this is one reading.
    The one exception is the film's single such sentence, where a chapter's
    constraints ask for it.
  ```

  And the psychology mock bible's, in its own words (no `FINANCE_WORDS`):

  ```
  The hard rules:
  - Assert nothing the claim list and the dossier's scenes do not support.
    Never invent figures, dates, quotes, names or actions by a real person.
  - A claim marked ALLEGED is an accusation nobody with authority has ruled
    on: a charge of misconduct, a retraction demanded and not granted. Where
    the narration states what that accusation says, carry the hedge inline:
    "alleged", "the complaint says", "according to the critics". A claim
    marked RULED is stated as the ruling found. A claim with no marker is a
    fact of the record: state it plainly, with no hedge and no attribution
    unless the attribution is itself the point. A finding's standing (one
    study, contested, established) is a different axis and is narrated as
    its label says.
  - Never a sentence of its own saying that nothing was proven, that the
    science is unsettled, or that this is one reading. The one exception is
    the film's single such sentence, where a chapter's constraints ask for it.
  ```

- [ ] **Step 4: Rewrite the outline's `constraints` instruction** (spec 6.3, exact text, replacing lines 338-341):

  ```
  - "constraints": the wording limits for this chapter: which ALLEGED claims
    it narrates and the hedge each must carry; which figures are UNVERIFIED
    and must not appear; the film's single plain caveat sentence, if this is
    the chapter that carries it. Nothing else: a claim with no legal marker
    needs no attribution and no caveat. They shape the words and are never
    narrated. Put the dossier's corrections here, not in the beat.
  ```

- [ ] **Step 5: Rewrite `buildSelfCheckRequest`.** The system prompt, in this order, keeping the calm/tension opening sentence and the narration-tags paragraph as they are:

  ```
  You are the script's reviewer. You read ONE chapter against the claim list
  and the scene list it was written from, and report only what breaks the
  three rules below. You are not rewriting it, and you are not judging its
  craft.

  Grounding, kind "unsourced-claim". A sentence is unsourced when it states a
  checkable specific (a figure, a date, a name, a quote, an event, an action
  by a named real person) that neither the claim list nor the scene list
  supports. A sentence may rest on a claim or on a scene. Never unsourced: a
  transition, a characterisation, an image, the channel's reading, or a
  generalisation nobody could check.
  - Unsourced: "She checked her watch at 9.40." when no claim or scene has it;
    "Three hundred people were in the room."; "He said it would never work."
  - Never unsourced: "It vanished."; "Nobody was ready for what came next.";
    "Every late order felt like a small betrayal."

  Liability, two kinds. "missing-alleged": the sentence states as fact what a
  claim marked ALLEGED accuses a named person or organisation of. A sentence
  resting on a claim with no marker, or marked RULED, never gets this kind.
  "unsupported-attribution": the sentence attributes an intent or an action
  to a named person beyond what the claims and scenes support.

  {standingRules(profile)}

  The channel's own rules, which the writer followed:
  {literalBibleText(bible.hedgingRules)}

  Quote the sentence EXACTLY as it appears, including its punctuation: it is
  matched back to the text character for character. Report nothing twice;
  a sentence gets its one worst kind.

  {"warnings": [{"kind": string, "sentence": string, "message": string}]}
  {scriptRules(input.bible)}
  ```

  `standingRules(profile)` for the science profile is built from the data, not typed: "Standing, kind \"overstated-standing\". A claim marked {labels joined with commas and \"or\"} is narrated as that label says. A sentence that narrates a {blocking labels} or {advisory labels} claim as settled, proven or beyond dispute gets this kind, with the claim's label as the first word of the message. A claim with no such label is outside this rule." For `review: null` it is `''` and the blank line around it collapses (trim the composed string's double blank lines with `.replace(/\n{3,}/g, '\n\n')`).

  Messages: `[claims]` becomes `Claims:\n${claimList(claims)}\n\nScenes:\n${sceneList(scenes ?? [])}` (one message, still `cacheablePrefixMessages: 1`), then the chapter as before.

  `mockSelfCheck` returns `{ warnings: [...] }` with the same first-sentence warning and no `refs`.

  Add `scenes: ['March 2001 — the board met in the glass room (the directors). To settle who signed.']` to the `script-self-check` lift case.

- [ ] **Step 6: Run** `pnpm exec vitest run script.test script-craft channels` in their packages, then `pnpm exec vitest run psychology` from `packages/providers`. Expected: PASS (psychology must find no finance word in the new prompt; `lift.test.ts` still fails on snapshots until Task 10).
- [ ] **Step 7: Commit** `feat(prompts): the reviewer grounds on claims and scenes and hedges only ALLEGED claims (decision 457)`.

---

### Task 6: The code checks

**Files:**
- Create: `packages/schemas/src/script-lint.ts`
- Modify: `packages/schemas/src/script.ts` (export `scriptTargetWords`; `NARRATION_TAG_MARKUP` becomes exported as `narrationTags(text): string[]`)
- Modify: `packages/schemas/src/index.ts` (export `./script-lint`)
- Modify: `packages/providers/src/prompts/script.ts:115-170,297-302,706` (`BANNED_WORDS` read from schemas; `buildOutlineRequest` calls `scriptTargetWords`; the house style's tag rule; the chapter prompt's length line)
- Test: `packages/schemas/src/script-lint.test.ts`, `packages/schemas/src/script.test.ts`, `packages/providers/src/prompts/script.test.ts`

**Interfaces:**
- Produces: `BANNED_WORDS: readonly string[]` in `script-lint.ts`, the house style's list verbatim: delve, leverage, robust, comprehensive, streamline, foster, facilitate, pivotal, nuanced, multifaceted, tapestry, testament, intricate, landscape, showcase, underscore, crucial, vibrant, furthermore, moreover, notably, "it is important to note", "in conclusion", "at the end of the day", "little did they know". `houseStyle` prints `BANNED_WORDS.join(', ')` in place of the typed list (same words, so the composed text is byte-identical apart from line wrapping; the lift fixture will show that).
- Produces: `scriptTargetWords(targetRuntimeMin: number, format: { wordsPerMinute?: number; introLine?: string; outroLine?: string }): number` in `script.ts` = `max(0, round(min × (wpm ?? 150) × 0.95) − countWords(introLine) − countWords(outroLine))`. `buildOutlineRequest` calls it.
- Produces: `narrationTags(text: string): string[]` (every `[…]` tag as written).
- Produces: `scriptLint(chapters: readonly { index: number; contentMd: string }[], outline: { chapters: readonly { targetWords: number }[] }, targetWords: number): { chapterIndex: number; warning: GutterWarning }[]`. Every warning has `kind: 'style'` or `'off-target-length'` and no `severity` key.
- Produces: `TAG_WORDS = 120`, `CHAPTER_LENGTH_FLOOR = 0.9`, `CHAPTER_LENGTH_CEILING = 1.2`, `SCRIPT_LENGTH_FLOOR = 0.9` exported.

Rules (spec 9), each anchored to a sentence of the chapter, messages as given:
- `style`, a sentence ending in `?` (after `stripNarrationMarkup`): `A rhetorical question. The house style bans them: say the thing.`
- `style`, a banned word or phrase as a whole word, case-insensitive: `Banned word: "{word}".` One warning per sentence, the first word found.
- `style`, three consecutive sentences each over eight words whose word counts are all within two of each other: anchored to the third, `Three sentences of {a}, {b} and {c} words in a row. Vary the length.`
- `style`, a paragraph (per `splitParagraphs`) whose `stripNarrationMarkup` is empty but which is not empty: anchored to the paragraph's text as written (it is the "sentence"), `A tag as its own paragraph. A paragraph is one voice take and must contain spoken words.`
- `style`, more than `ceil(words / TAG_WORDS)` tags in the chapter: anchored to the sentence carrying the tag that crossed the limit, `{n} narration tags in {words} words. At most one every 120 words.`
- `style`, `[long pause]` more than once: anchored to the second, `[long pause] more than once in a chapter. Keep one.`
- `style`, a number written in digits of three or more digits (`\d{3,}` or `\d{1,3}(,\d{3})+`), except a standalone four-digit year 1000 to 2099: `Spell it out: "{match}".` One per sentence, the first match.
- `off-target-length`, chapter words under `0.9 ×` or over `1.2 ×` its outline chapter's `targetWords` (matched by index; a chapter past the outline's length is skipped): anchored to the chapter's last sentence, `{words} words against a target of {target} ({percent}%).`
- `off-target-length`, the whole script's words under `0.9 × targetWords` (when `targetWords > 0`): anchored to the last chapter's last sentence, `The script is {words} words against a target of {targetWords} ({percent}%).`
- A chapter with no sentence gets no warning of any kind.

- [ ] **Step 1: Write the failing tests** in `script-lint.test.ts`, one `it` per rule above with a minimal chapter that trips exactly that rule and `expect(lint).toEqual([{ chapterIndex, warning: { kind, sentence, message } }])`, plus:
  - `it('flags nothing in a clean chapter')`: a chapter of five sentences of varied length, one `[pause]`, a year `2019`, at target length.
  - `it('leaves a four-digit year alone and flags 1,900 and 101')`.
  - `it('counts tags against the stripped word count and anchors the one over the limit')`: 130 words with three tags gives one warning on the third tag's sentence.
  - `it('gives an empty chapter and a tag-only chapter no length or question warning')` (Review Focus 5): `contentMd: ''` gives `[]`; `contentMd: '[pause]'` gives the tag-only paragraph warning and nothing else.
  - `it('skips a chapter the outline does not cover')`.
  In `script.test.ts` (schemas): `it('computes the target words from the pace and the fixed lines')`: `scriptTargetWords(15, { wordsPerMinute: 150, introLine: 'one two', outroLine: 'three' })` is `2135`; with no format fields, `scriptTargetWords(10, {})` is `1425`.
  In `script.test.ts` (providers): the outline's `Produce a chapter plan totalling about 2135 words` for the same inputs; `it('tells the chapter its floor and its ceiling')`: the chapter system contains `Write between 300 and 330 words. Under 300 is too short.` for a 300-word chapter; `it('tells the writer the tag budget')`: `houseStyle` contains `at most one every 120 words, and [long pause] at most once`.
- [ ] **Step 2: Run** `pnpm exec vitest run script-lint script.test` from `packages/schemas`. Expected: FAIL.
- [ ] **Step 3: Implement** `script-lint.ts` and the `script.ts` exports. Sentences come from `splitSentences`, words from `countWords`, paragraphs from `splitParagraphs`. Keep each rule its own function returning warnings, composed by `scriptLint`.
- [ ] **Step 4: Change the prompts.** The chapter prompt's `Target about ${n} words.` becomes `Write between ${n} and ${Math.round(n * 1.1)} words. Under ${n} is too short.` The house style's tag bullet gains, after "and a script that gasps at everything gasps at nothing.", the sentence `A handful of tags per chapter, at most one every 120 words, and [long pause] at most once.` The banned-word bullet prints `BANNED_WORDS` (quoting the multi-word entries as the current text does).
- [ ] **Step 5: Run** the three test files. Expected: PASS (lift snapshots still pending Task 10).
- [ ] **Step 6: Commit** `feat(schemas): deterministic style and length checks for a script (decision 457)`.

---

### Task 7: The runner: scenes, standing, lint and the gate

**Files:**
- Modify: `apps/web/inngest/functions/script-runner.ts:410-520`
- Modify: `apps/web/lib/script-answers.ts` (no change in shape; `selfCheckWith` passes `scenes`)
- Create: `packages/schemas/src/script-measures.ts` (`hedgeDensity`)
- Test: `apps/web/inngest/functions/script-runner.test.ts`, `packages/schemas/src/script-measures.test.ts`

**Interfaces:**
- Consumes: `sceneLines` (Task 3), `withStandingSeverity`, `researchProfileOf` (Task 4), `scriptLint`, `scriptTargetWords` (Task 6), `countBySeverity` (Task 1).
- Produces: `HEDGE_PHRASES: readonly string[]` = alleged, allegedly, reportedly, purportedly, according to, prosecutors say, the complaint says, is said to, were said to, believed to, appears to, suggests, claimed, claims that. `hedgeDensity(chapters: readonly { contentMd: string }[]): number` = phrase hits per 100 words over the stripped text, rounded to one decimal, `0` for no words.
- Produces: the `self-check-N` step, inside the step: reads the channel, the dossier (`getDossier(db, projectId)`) for `sceneLines`, the profile from the frozen bible; calls `selfCheckWith(..., { scenes })` or `mockSelfCheck`; applies `withStandingSeverity(profile, check.warnings)`; appends the chapter's repeats and `scriptLint(written, outline, scriptTargetWords(setup.targetRuntimeMin, channel.format))` filtered to `chapter.index`; stores all with `setChapterWarnings`; returns `{ warnings: number }`.
- Produces: `finish-draft` returns `{ chapters, warnings, blocking, advisory, hedges, runtimeMin, shorts, shortsOff }` where `warnings = blocking + advisory`, `hedges = hedgeDensity(latest.chapters)`.
- Produces: the gate line `Script ready · ${chapters} chapters · ~${runtimeMin} min · ${blocking} blocking · ${advisory} advisory · hedges ${hedges}/100w · ${shorts line}`. A replayed summary without `blocking` reads `blocking = summary.warnings`, `advisory = 0`, `hedges = 0` (hedges printed only when present).
- Produces: auto-approve when `blocking === 0`.

- [ ] **Step 1: Write the failing tests.** In `script-measures.test.ts`: `it('counts hedge phrases per hundred words')`: 200 words with "alleged", "according to" and "reportedly" once each gives `1.5`; no words gives `0`; a `[pause]` tag is not a word. In `script-runner.test.ts`, using `engine.executeStep('self-check-0', …)` with steps through `draft-chapter-0` (as `throughSelfCheck` does, minus its own entry) and `vi.stubEnv('MOCK_PROVIDERS', '')` with `callLlm` resolving a JSON answer:
  - `it('sends the scene list beside the claims, from the dossier row')`: seed the dossier with `research` holding one scene (or a `## Timeline` bullet in `contentMd`); the first message sent contains `Scenes:\n[S1]`.
  - `it('stamps the profile's severity on an overstated-standing warning')`: a science bible (the `channelForProject` mock pattern at lines 359-363), answer `{"warnings":[{"kind":"overstated-standing","sentence":"<first sentence of the chapter>","message":"ONE STUDY narrated as settled"}]}`; the stored chapter warning has `severity: 'advisory'`.
  - `it('stores the style and length checks as advisory beside the model's warnings')`: answer with no warnings, chapter text ending in a question; the stored warnings contain `{ kind: 'style', … }` and `countBySeverity` on the chapter gives `{ blocking: 0, advisory: 1+ }`.
  - `it('auto-approves on zero blocking whatever the advisory count')`: `engine.execute` with `self-check-0` returning `{ warnings: 3 }` and a chapter row saved on `scriptId` with `saveChapter` (index 0, the `draft-chapter-0` handler returns its id) holding three `style` warnings set with `setChapterWarnings` before the run; result `outcome: 'auto-approved'`, and `notify` called with a body containing `0 blocking · 3 advisory` and `hedges `.
  - `it('parks the gate on one blocking warning')`: the row holds one `unsourced-claim`; `ctx.step.run` was called with `'open-gate'` and the gate.opened message contains `1 blocking`.
  - `it('reads a summary replayed without blocking as its warnings count')` (Review Focus 2): `finish-draft` step handler returns `{ chapters: 1, warnings: 2, runtimeMin: 1, shorts: 0, shortsOff: true }`; the run opens the gate, not auto-approve.
- [ ] **Step 2: Run** `pnpm exec vitest run script-measures` from `packages/schemas` and, with Docker up, `pnpm exec vitest run script-runner` from `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the runner changes per the interface. Replace the gate comment at lines 495-504 with three lines: blocking warnings are the reviewer's yes-or-no findings (grounding, liability, standing per profile, repeats); advisory ones are craft, style and length; zero blocking goes to voice without a human (decision 457).
- [ ] **Step 4: Run** both test files again, then the whole `apps/web` Inngest directory `pnpm exec vitest run inngest/functions` from `apps/web`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(script-runner): the gate counts blocking warnings only, with scenes, standing and the code checks in the self-check step (decision 457)`.

---

### Task 8: Script Studio's gutter, the fix button, the project page and the Needs-you card

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/script-studio.tsx:78-90,359,476-525,834-890`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx:486-490,634-650`
- Modify: `packages/db/src/projects.ts:40-100` (`ProjectSummary`, `summaryColumns`)
- Modify: `apps/web/components/needs-you-queue.tsx:60-72`
- Modify: `e2e/global-setup.ts:98-125`
- Modify: `e2e/tests/project-lifecycle.spec.ts:255-275`
- Test: `apps/web/app/(console)/projects/[id]/script-studio.test.tsx`, `apps/web/components/needs-you-queue.test.tsx`, `packages/db/src/projects.integration.test.ts` (create, in the pattern of `scripts.integration.test.ts`), `e2e/tests/project-lifecycle.spec.ts`

**Interfaces:**
- Consumes: `severityOf`, `countBySeverity` (Task 1).
- Produces: `ProjectSummary.gateSummary: string | null`, in `summaryColumns` as a correlated subquery: the `message` of the newest `run_events` row with `kind = 'gate.opened'` whose run (`runs.project_id`) is this project, else null.
- Produces: the Needs-you gate card's context is `${SEGMENT_LABELS[stage]} ready for review · ${category} · ${min} min target` followed, when `gateSummary` is present, by ` · ` and the summary with its first segment (up to and including the first ` · `) removed, so a parked script reads `Script ready for review · Con · 15 min target · 7 chapters · ~14 min · 1 blocking · 9 advisory · hedges 0.8/100w · 3 Shorts candidates`.
- Produces: `ScriptStudio` takes `hedgingRules: string` (the project's frozen bible's, which the page gets from `requireCompleteBible(channel).bible.hedgingRules`, falling back to `channel.bible.hedgingRules` when the frozen bible is incomplete).
- Produces: `hedgeInstruction(hedgingRules: string): string` exported from `script-studio.tsx`'s sibling `apps/web/lib/script-editing.ts`: `This states as fact what an ALLEGED claim only accuses. Rewrite it carrying the hedge inline, as the channel's rules say, changing as little else as possible.\n\nThe channel's rules:\n${hedgingRules}`. Replaces `HEDGE_INSTRUCTION`.
- Produces: `craftInstruction(message: string): string`: `Rewrite this passage. ${message} Change nothing else.`
- Produces: the gutter header `${blocking} blocking · ${advisory} advisory`; each warning's kind line in the warning colour when `severityOf(warning) === 'blocking'` and in `text-[var(--color-text-muted)]` when advisory; a `missing-alleged` warning's button reads `Rewrite with the channel's hedge…`; a `craft` warning gets `Rewrite this passage…` through the same `regenerateSection` path with `craftInstruction(warning.message)`.
- Produces: the outline column's ` · N warnings` stays; the project page's context reads `${total} self-check warnings (${blocking} blocking, ${advisory} advisory). Approving sends this to the voice stage.`
- Produces: the dense fixture's kinds by index: `% 5 === 4` unsupported-attribution, `% 5 === 3` style, else even missing-alleged, odd unsourced-claim (18 blocking, 4 advisory, still 22).

- [ ] **Step 1: Write the failing tests.** In `script-studio.test.tsx`, in the file's existing render pattern: one chapter holding `[unsourced-claim, style, { kind: 'overstated-standing', severity: 'advisory' }]` and `hedgingRules: 'Kilroy.'`; expect the text `1 blocking · 2 advisory`; `getByRole('button', { name: /Rewrite with the channel's hedge/ })` absent (no missing-alleged) and present when a `missing-alleged` warning is added; with a `craft` warning, `getByRole('button', { name: /Rewrite this passage/ })` present. `hedgeInstruction('Kilroy.')` ends with `Kilroy.`. In `needs-you-queue.test.tsx`: `it('carries the gate line after the target')` with `gateSummary: 'Script ready · 2 chapters · ~3 min · 1 blocking · 0 advisory · hedges 0/100w · Shorts off for this format'` expects the context to end with `· 15 min target · 2 chapters · ~3 min · 1 blocking · 0 advisory · hedges 0/100w · Shorts off for this format`, and with `gateSummary: null` the context is unchanged. In `projects.integration.test.ts`: `it('reads the newest gate.opened message as the gate summary')`: two run events on the fixture project's run, the newer `gate.opened` message wins; a project with no run event reads null. In `project-lifecycle.spec.ts`, the dense test gains `await expect(page.getByText(/18 blocking, 4 advisory/)).toBeVisible()` and keeps `/22 warnings/`.
- [ ] **Step 2: Run** `pnpm exec vitest run script-studio needs-you-queue` from `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** per the interface. Pass `hedgingRules` from the page. Update the fixture and its comment ("Twenty-two warnings across the reviewer's kinds and one advisory kind…").
- [ ] **Step 4: Run** the two component tests, with Docker up `pnpm exec vitest run projects.integration` from `packages/db`, `pnpm typecheck`, then the two e2e files from the `e2e` package: `pnpm exec playwright test tests/project-lifecycle.spec.ts tests/writing-room.spec.ts` (free port 3100 first if a run was interrupted). Expected: PASS.
- [ ] **Step 5: Commit** `feat(script-studio): the gutter shows blocking and advisory apart, and the fix button speaks the channel's hedge (decision 457)`.

---

### Task 9: The scoring script

**Files:**
- Modify: `packages/schemas/src/script-measures.ts` (add the remaining measures)
- Create: `packages/db/src/scripts/score-scripts.ts`
- Modify: `packages/db/package.json` (`"score": "tsx src/scripts/score-scripts.ts"`), root `package.json` (`"script:score": "pnpm --filter @boom-busters/db score"`)
- Test: `packages/schemas/src/script-measures.test.ts`

**Interfaces:**
- Consumes: `hedgeDensity`, `countBySeverity`, `countWords`, `narrationTags`, `splitSentences`.
- Produces in `script-measures.ts`: `tagDensity(chapters): number` (tags per 100 words, one decimal); `chapterEndings(chapters): { questions: number; sameShape: number }` where a chapter "ends on a question" when its last sentence ends in `?` and `sameShape` counts chapters whose last sentence's final three words match another chapter's; `classifyEdit(before: string, after: string): 'tag' | 'number' | 'hedge' | 'other'` (`tag` when `narrationTags(before).length > narrationTags(after).length`; `number` when `before` has a `\d{3,}` match that `after` lacks; `hedge` when `before` has a `HEDGE_PHRASES` hit that `after` lacks; else `other`); `warningsByKind(chapters): Record<string, number>`.
- Produces: `score-scripts.ts`, run as `pnpm script:score [--project <id>] [--prod]`. It reads `TEST_DATABASE_URL` (`testDatabaseUrl()` from `../test-database`) by default and refuses to start without it; with `--prod` it reads `DATABASE_URL_UNPOOLED ?? DATABASE_URL` through `postgres` with `connection: { options: '-c default_transaction_read_only=on' }` and runs every query inside `sql.begin('read only', …)`, printing `show default_transaction_read_only` first and stopping unless it is `on`. Per script version it prints one table row: project title, version, status, words, words against target (`scriptTargetWords` from the project's runtime and the channel's format; `n/a` when the format is unknown), estimated minutes, warnings by kind, blocking and advisory, hedges per 100 words, tags per 100 words, chapters ending on a question, chapters sharing an ending shape, owner edits by `classifyEdit` and by `editType`. No claim text or chapter text is printed.

- [ ] **Step 1: Write the failing tests** in `script-measures.test.ts`: one `it` per measure with a two-chapter input and exact numbers; `classifyEdit` with the four cases from spec 2.5 (a tag removed, `101` spelt out, a caveat sentence deleted, a word changed).
- [ ] **Step 2: Run** `pnpm exec vitest run script-measures` from `packages/schemas`. Expected: FAIL.
- [ ] **Step 3: Implement** the measures and the script. The script's SQL joins `scripts`, `chapters`, `projects`, `channels` and `script_edits`; keep the query in one function and the printing in another.
- [ ] **Step 4: Run** the test (PASS), `pnpm typecheck` (PASS), and with Docker up and the e2e fixtures seeded (`pnpm db:migrate:test` then the e2e global setup, or any local script rows) `pnpm script:score`. Expected: a table with one row per script version and no error. Paste the local output into the PROGRESS entry's "Measured" line in Task 10.
- [ ] **Step 5: Commit** `feat(db): pnpm script:score prints a script version's numbers (decision 457)`.

---

### Task 10: Lift fixtures, PROGRESS, and the spec amendments

**Files:**
- Modify: `packages/providers/src/prompts/lift/__fixtures__/script-*.json`, `metadata-*.json` (regenerated)
- Modify: `PROGRESS.md` (new section at the end)
- Modify: `docs/03-build-spec.md:185` (already amended in Task 1; re-read it)
- Modify: `docs/superpowers/specs/2026-11-10-script-review-and-craft-design.md` (status line: "plan 1 shipped, decision 457")

- [ ] **Step 1: Regenerate the fixtures**: from `packages/providers`, `pnpm exec vitest run lift -u`, then `git diff --stat packages/providers/src/prompts/lift/__fixtures__`. Expected: only `script-*.json` and `metadata-*.json` changed. If any other family changed, stop and find the stray edit before continuing.
- [ ] **Step 2: Read the diff** of `script-self-check.json`, `script-outline.json`, `script-chapter-first.json` and one `metadata-*.json` in full, and list every changed line of prompt text (not JSON punctuation) for the PROGRESS entry.
- [ ] **Step 3: Write the PROGRESS section** `## Script review, chosen per channel (2026-11-10)` in the house shape (see the long-renders section at `PROGRESS.md:4877`): the blockquote summary (decision 457, branch, spec and plan paths, no migration); Deliverables, one line per task with its commit hash; "Owner actions at deploy" copied from spec section 13 (paste the hedging rules in the Bible tab; check the `scripting` route; `PUT /api/inngest`); "Prompt changes to the investigation prompts", the list from Step 2; "Measured", the `pnpm script:score` output from Task 9 on the local database; "Decisions made": the severity default for `overstated-standing` (blocking when the label is missing), the scene source (research row, else the Timeline section), `claim_refs` left as a table, the mock reviewer still blocking, the gate path for zero blocking proven in the runner harness rather than Playwright.
- [ ] **Step 4: Run the full verification**, one package at a time: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` on tracked files (memory: `--ignore-unknown`, `xargs -n 80`), `pnpm exec vitest run` from `packages/schemas`, from `packages/providers`, from `packages/db` (Docker up), from `apps/web` split by directory (`inngest/functions`, `lib`, `app`, `components`), then `pnpm e2e`. Expected: all green. Note the composition snapshot memory if a pixel diff appears in an unrelated package: re-run that package alone.
- [ ] **Step 5: Commit** `chore(prompts): regenerate the script and metadata lift fixtures; PROGRESS for decision 457`.
- [ ] **Step 6: Merge preparation.** `git fetch origin master`; compare `PROGRESS.md` decision numbers and `packages/db/drizzle/meta/_journal.json` with `origin/master`; renumber this branch's decision lines in a separate commit if 453 is taken. Do not push: hand the merge and push line to the owner (memory: git push is the owner's action).
