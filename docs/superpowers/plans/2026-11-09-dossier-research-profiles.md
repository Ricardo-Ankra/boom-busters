# Dossier Research Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dossier researches by a research profile the bible chooses: `investigation` (Boom & Busters, unchanged byte for byte) and `science` (topic subjects, scholarly references, an earned evidence axis).

**Architecture:** Profile data lives in `packages/schemas/src/research-profiles.ts` and its prompt text in `packages/providers/src/prompts/dossier-profiles.ts`. The bible carries `researchProfile`. Every dossier step that needs the profile reads it from the frozen bible inside the step, or from `load-case`, where an older replayed result means `investigation`. The legal grading stays for every profile. The evidence axis sits beside it, and only grounding can raise a claim's standing.

**Tech Stack:** TypeScript, Zod 4, Drizzle (Postgres), Inngest, Vitest, Next.js App Router, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-09-dossier-research-profiles-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Boom & Busters' composed prompts must not change: `packages/providers/src/prompts/lift/__fixtures__/*.json` stay byte-identical (spec section 4, anti-goals). Never run the lift tests with `-u`.
- A stored bible without `researchProfile` reads as `investigation`. So does a replayed step result without it.
- The legal grading (`ruled / alleged / none`, `VERDICT_WORDS`, the court-or-regulator rule) runs for every profile and no profile can turn it off.
- A downgrade is free and an upgrade is earned (spec 5.2): the model may write any status, and grounding lowers an unearned one to the profile's fallback with a repair note.
- No live provider, VidIQ, web or model call in tests. Mock mode stays the default.
- Decision number 446 is provisional. At merge, compare with `origin/master` and renumber only this branch's lines.
- One migration. Another session holds 0052 uncommitted. Generate at execution time and compare `packages/db/drizzle/meta/_journal.json` with master before merging.
- Run `pnpm format:check` on tracked files before every commit (CI gates on Prettier).
- Vitest path filter: run `pnpm exec vitest run <basename>` from the package directory. `pnpm --filter <pkg> test -- <path>` runs the whole package.
- Integration suites need Docker Desktop running and the `boom-busters-test-db` container up. Never run two database suites at once.
- Subagents: give every Bash call `timeout: 600000`, and split verification per package.
- Copy rules for any UI text: South African spelling, no em or en dashes, button-first.

## Review Focus

1. **Boom & Busters' stored bible v3 has no `researchProfile`.** It must read as `investigation`, and its Identity section must not start to look "drafted" or non-empty because of the new default. Tests in Task 2.
2. **A dossier run parked before the deploy replays `load-case` without `researchProfile`.** It must gather and research as `investigation` without throwing. Test in Task 4.
3. **`ncbi.nlm.nih.gov` and `pubmed.ncbi.nlm.nih.gov` are `.gov` hosts.** `isPrimaryReference` would file them as `regulator`. Under `science` the scholarly check must run first, so they become `scholarly`. Test in Task 4.
4. **An `established` claim whose scholarly quotes were not found** (`found: false`) must not count those supports, and must fall to `single_study`. Test in Task 6.
5. **A science subject whose first Wikipedia hit is a disambiguation page or a list** must resolve to the next hit, not come back `unresolved`. Test in Task 4.

---

### Task 1: Storage for the new kind and the evidence columns

**Files:**
- Modify: `packages/schemas/src/dossier.ts` (`DOCUMENT_KINDS`, `DOCUMENT_TIERS`)
- Modify: `packages/providers/src/research/ground.ts:30-39` (`SOURCE_TYPES`)
- Modify: `apps/web/app/(console)/projects/[id]/dossier-review.tsx` (any `Record<DocumentKind, …>` label map)
- Modify: `packages/db/src/schema.ts:698-730` (`claims`)
- Modify: `packages/db/src/dossiers.ts` (`DraftClaimInput`, `saveDossier`)
- Create: `packages/db/drizzle/00NN_<generated>.sql` plus its snapshot and journal entry
- Test: `packages/db/src/dossiers.integration.test.ts`, `packages/schemas/src/dossier.test.ts`

**Interfaces:**
- Produces: `DocumentKind` includes `'scholarly'`; `DOCUMENT_TIERS.scholarly === 2`; `SOURCE_TYPES.scholarly === 'other'`.
- Produces: the `claims` columns `evidenceStatus: text | null` and `evidenceDocumentId: text | null`, the latter referencing `research_documents.id` with on delete set null.
- Produces: `DraftClaimInput.evidenceStatus?: string | null` and `DraftClaimInput.evidenceDocumentId?: string | null`, which `saveDossier` writes through and which default to null.

- [ ] **Step 1: Write the failing tests**

  In `dossier.test.ts`: `it('knows the scholarly kind')`, with `expect(DOCUMENT_KINDS).toContain('scholarly')` and `expect(DOCUMENT_TIERS.scholarly).toBe(2)`.

  In `dossiers.integration.test.ts`: `it('stores a claim's evidence status and document')`. It saves one claim with `evidenceStatus: 'single_study'` and `evidenceDocumentId` set to a stored document's id, then expects both on the row read back. A second claim saved without the fields reads back as `null` for both.

- [ ] **Step 2: Run them and see them fail.** From `packages/schemas`, run `pnpm exec vitest run dossier.test`. With Docker up, from `packages/db`, run `pnpm migrate:test`, then `pnpm exec vitest run dossiers.integration`. Expected: FAIL, because the kind is missing and the columns do not exist.
- [ ] **Step 3: Implement.** Add `'scholarly'` to the end of `DOCUMENT_KINDS`, set the tier to 2 and the source type to `'other'`, and give it the review label "Scholarly". Add the two columns to `claims` and pass them through `saveDossier`. Run `pnpm db:generate` from the repo root. The SQL must be `ALTER TYPE "public"."document_kind" ADD VALUE 'scholarly';` plus the two `ALTER TABLE "claims" ADD COLUMN` statements and the foreign key.
- [ ] **Step 4: Run the tests and see them pass.** Run the same commands after `pnpm migrate:test`. Expected: PASS. Then run `pnpm typecheck`, which must be clean, because exhaustive `Record<DocumentKind>` maps break the build until each one has the new key.
- [ ] **Step 5: Commit**

  ```bash
  git add packages/schemas/src/dossier.ts packages/schemas/src/dossier.test.ts packages/providers/src/research/ground.ts "apps/web/app/(console)/projects/[id]/dossier-review.tsx" packages/db/src/schema.ts packages/db/src/dossiers.ts packages/db/src/dossiers.integration.test.ts packages/db/drizzle
  git commit -m "feat(db): a scholarly document kind and a claim's evidence status"
  ```

### Task 2: The bible chooses a research profile

**Files:**
- Create: `packages/schemas/src/research-profiles.ts` (keys and schema only in this task; the profile data comes in Task 3)
- Modify: `packages/schemas/src/channels.ts` (`ChannelBibleSchema`, `BIBLE_SECTIONS.identity`, `FIRST_CHANNEL_BIBLE`)
- Modify: `packages/schemas/src/bible-draft.ts` (`sectionIsEmpty`)
- Modify: `packages/providers/src/prompts/bible-draft.ts` (field description)
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-fields.tsx` (Identity `SectionEditor`, `SectionView`, `initialFormValues`, `formPatch`)
- Modify: `packages/schemas/src/index.ts` (export)
- Test: `packages/schemas/src/channels.test.ts`, `packages/schemas/src/bible-draft.test.ts`, `apps/web/app/(console)/c/[slug]/settings/bible-tab.test.tsx`, `apps/web/app/(console)/c/[slug]/settings/bible-actions.test.ts`

**Interfaces:**
- Produces: `RESEARCH_PROFILE_KEYS = ['investigation', 'science'] as const`, `type ResearchProfileKey`, `ResearchProfileKeySchema`, and `RESEARCH_PROFILE_LABELS: Record<ResearchProfileKey, { label: string; description: string }>`.
- Produces: `ChannelBible.researchProfile: ResearchProfileKey`, which defaults to `'investigation'` and sits in the `identity` section.

- [ ] **Step 1: Write the failing tests**
  - `channels.test.ts`, `it('reads a stored bible without a research profile as investigation')`: `ChannelBibleReadSchema.parse(<FIRST_CHANNEL_BIBLE without researchProfile>).researchProfile === 'investigation'`. Also `ChannelBibleSchema.safeParse({ researchProfile: 'history' }).success === false`.
  - `bible-draft.test.ts`, `it('counts an identity section holding only the default profile as empty')`: `sectionIsEmpty(EMPTY_BIBLE, 'identity') === true`, and `sectionIsEmpty({ ...EMPTY_BIBLE, researchProfile: 'science' }, 'identity') === false`.
  - `bible-tab.test.tsx`, `it('edits the research profile in Identity')`: open the Identity editor, find a select labelled "Research profile" with options "Investigation" and "Science", choose "Science", save, and expect the patch to carry `researchProfile: 'science'`.
  - `bible-actions.test.ts`: in the existing copy-from-channel test, the copied draft carries the source's `researchProfile`.
- [ ] **Step 2: Run each one and see it fail.** Run from `packages/schemas` and from `apps/web` with `pnpm exec vitest run <basename>`.
- [ ] **Step 3: Implement.** Labels: Investigation, "Real organisations and people, graded by what courts and regulators found." Science, "Studies and findings, graded by whether they hold up, with scholarly sources first." The drafting field description is: `'"investigation" or "science": how the dossier researches a case; "science" for channels about studies and findings'`. `FIRST_CHANNEL_BIBLE.researchProfile = 'investigation'`. `sectionIsEmpty` treats `researchProfile === 'investigation'` as empty.
- [ ] **Step 4: Run the tests and see them pass.** Then confirm the lift fixtures are unchanged: from `packages/providers`, run `pnpm exec vitest run lift psychology`. Expected: PASS, and `git status --short packages/providers/src/prompts/lift/__fixtures__` prints nothing.
- [ ] **Step 5: Commit** with the message `feat(bible): a channel chooses its research profile`.

### Task 3: Profile data, with investigation moved out unchanged

**Files:**
- Modify: `packages/schemas/src/research-profiles.ts`
- Modify: `packages/schemas/src/dossier.ts` (`DOCUMENT_TIERS` and `DOSSIER_TIER_SHARES` become aliases of the investigation profile's)
- Create: `packages/providers/src/prompts/dossier-profiles.ts`
- Modify: `packages/providers/src/prompts/dossier.ts:69-101` (`houseRules`, `system`)
- Test: `packages/schemas/src/research-profiles.test.ts`, `packages/providers/src/prompts/dossier-profiles.test.ts`

**Interfaces:**
- Consumes: `ResearchProfileKey` from Task 2.
- Produces (schemas):

  ```ts
  export type Tier = 1 | 2 | 3 | 4 | 5
  export interface EvidenceStatus { key: string; scriptLabel: string; reviewLabel: string }
  export interface EvidenceAxis {
    statuses: readonly EvidenceStatus[]
    earned: { status: string; minScholarlyDocuments: number; reviewWords: readonly string[] }
    fallback: string
  }
  export interface ResearchProfile {
    key: ResearchProfileKey
    subject: { accept: 'business' | 'topic'; relatedWords: RegExp }
    sources: { edgar: boolean; xbrl: boolean; stooq: boolean; wayback: boolean; courtlistener: boolean }
    scholarlyHosts: readonly string[]
    tiers: Record<DocumentKind, Tier>
    tierShares: Record<Tier, number>
    evidence: EvidenceAxis | null
  }
  export const RESEARCH_PROFILES: Record<ResearchProfileKey, ResearchProfile>
  export function researchProfileOf(bible: { researchProfile?: ResearchProfileKey }): ResearchProfile
  export function evidenceLabel(profile: ResearchProfile, status: string | null, where: 'script' | 'review'): string | null
  ```

- Produces (providers): `PROFILE_PROMPTS: Record<ResearchProfileKey, { opening: (bible: ChannelBible) => string; stakes: (bible: ChannelBible) => string; extraRules: readonly string[] }>`. `houseRules(bible)` composes from these.

- [ ] **Step 1: Write the failing tests**
  - `research-profiles.test.ts`:
    - `researchProfileOf({}).key === 'investigation'`.
    - `RESEARCH_PROFILES.investigation.tiers` deep-equals the `DOCUMENT_TIERS` values captured before this change. Write the literal object into the test.
    - `tierShares` equals `{ 1: 0.25, 2: 0.3, 3: 0.15, 4: 0.1, 5: 0.2 }`.
    - `subject.accept === 'business'`.
    - `relatedWords.test('Enron scandal') === true`.
    - Every source is `true`.
    - `scholarlyHosts` is `[]`.
    - `evidence` is `null`.
    - `evidenceLabel(RESEARCH_PROFILES.investigation, 'x', 'script') === null`.
    - Every profile's `tierShares` sum to 1 (to within 1e-9).
  - `dossier-profiles.test.ts`: `it('composes the investigation house rules exactly as before')`, which builds the system prompt for `FIRST_CHANNEL_IN_USE` and compares it with the `system` field of `lift/__fixtures__/dossier-brief-bare.json`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the investigation profile and its prompt text by moving today's values and strings. Add the `science` entry as a copy of investigation for now; Task 7 gives it its own values. Keep `RELATED_WORDS`' regex exactly as it is.
- [ ] **Step 4: Run them and see them pass.** Also run `pnpm exec vitest run lift psychology dossier` in `packages/providers`. Expected: PASS, with no fixture diff.
- [ ] **Step 5: Commit** with the message `refactor(dossier): the investigation research profile holds the corporate rules`.

### Task 4: The gather follows the profile

**Files:**
- Modify: `apps/web/inngest/lib/dossier-discover.ts` (`resolveEntity`, `discoverCandidates`, `REFERENCE_CAPS`)
- Modify: `apps/web/inngest/lib/dossier-gather.ts` (`GatherInput`, `rankAndLink`)
- Modify: `packages/providers/src/research/rank.ts` (`RankOptions`)
- Modify: `apps/web/inngest/functions/dossier-runner.ts` (`load-case`), `apps/web/inngest/functions/dossier-reviser.ts` (the equivalent load step)
- Modify: `apps/web/inngest/lib/dossier-research.ts` (`replayedCase`)
- Test: `apps/web/inngest/lib/dossier-discover.test.ts`, `dossier-gather.test.ts`, `packages/providers/src/research/rank.test.ts`, `apps/web/inngest/functions/dossier-runner.test.ts`, `apps/web/inngest/lib/dossier-research.test.ts`

**Interfaces:**
- Consumes: `RESEARCH_PROFILES` and `ResearchProfile` from Task 3.
- Produces:
  - `resolveEntity(sources, input, profile: ResearchProfile = RESEARCH_PROFILES.investigation)`.
  - `discoverCandidates(sources, entity, input, profile: ResearchProfile = RESEARCH_PROFILES.investigation)`.
  - `GatherInput.profile: ResearchProfileKey`.
  - `RankOptions.tierShares?: Record<Tier, number>`.
  - `replayedCase(...)` also returns `researchProfile: ResearchProfileKey`, which is `'investigation'` when the stored key is missing.
  - `REFERENCE_CAPS.scholarly = 40`.
  - `ResolvedEntity.businessTitle` keeps its name. Replayed steps carry it, and its doc comment says it holds the subject's article for a topic profile.

- [ ] **Step 1: Write the failing tests** (in `dossier-discover.test.ts`, using its `fakeSources`):
  - `it('resolves a topic subject under the science profile')`. The hits are "Stanford prison experiment" with instanceOf `['Q2695280']`. Expected: `unresolved === false` and `businessTitle === 'Stanford prison experiment'`. The same input under investigation gives `unresolved === true`. This test is the before and after evidence.
  - `it('skips a disambiguation page or a list for a topic')`. The first hit's instanceOf is `['Q4167410']`, the second's `['Q13406463']` and the third's `['Q2695280']`. Expected: the third hit is the subject.
  - `it('files nih.gov journal links as scholarly under science')`. The references are `https://pubmed.ncbi.nlm.nih.gov/123/`, `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1/`, `https://doi.org/10.1037/x` and `https://www.sec.gov/x`. Expected kinds: the first three are `scholarly`, and the last is `regulator`. Under investigation the first two are `regulator` and the DOI is `reporting`.
  - `it('asks no keyed source under science')`. EDGAR, Wayback, CourtListener and XBRL spies are not called even when the entity has a `cik`, a `website` and a `businessTitle`.
  - `rank.test.ts`: `it('spends the tier shares it is given')`. Use `corpusTokens: 100_000` and `documentTokens: 100_000`, so the cut per document does not hide the shares. Under shares `{1: 0.4, 2: 0.3, 3: 0.1, 4: 0.05, 5: 0.15}`, a lone tier 1 document of 45k tokens is unread and one of 40k tokens is read. Under the default shares, the 40k one is unread.
  - `dossier-research.test.ts`: `replayedCase({ title: 't' }).researchProfile === 'investigation'`.
  - `dossier-runner.test.ts`: a run whose frozen bible says `science` passes `profile: 'science'` to the gather.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - A topic profile accepts the first hit whose Wikidata classes include neither `Q4167410` (disambiguation) nor `Q13406463` (list). A hit with no facts is accepted.
  - Under a topic profile, the scholarly check runs before `isPrimaryReference`.
  - The keyed sources run only where `profile.sources` allows them.
  - Candidate tiers come from `profile.tiers`. `rankAndLink` passes `profile.tierShares`.
  - `load-case` returns `researchProfile` read from the bible inside the step. The runner reads it with `replayedCase`.
- [ ] **Step 4: Run them and see them pass.** Run the whole `apps/web/inngest` directory as one batch, with the Bash timeout at 600000. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(dossier): the gather resolves, finds and ranks by the research profile`.

### Task 5: Two defects from the audit

**Files:**
- Modify: `apps/web/inngest/lib/dossier-research.ts:582-634` (`GateSubject`, `subjectLine`, `gateSubject`)
- Modify: the callers of `gateSubject` in `dossier-runner.ts` and `dossier-reviser.ts`
- Modify: `packages/providers/src/research/ground.ts:34`
- Test: `apps/web/inngest/lib/dossier-research.test.ts`, `packages/providers/src/research/ground.test.ts`

**Interfaces:**
- Produces: `GateSubject.noun: string`. `gateSubject(entity, fallback: { subject; people; noun })`. A blank noun prints no brackets.

- [ ] **Step 1: Write the failing tests**
  - `gateSummary(..., { subject: 'Ego depletion', people: [], unresolved: false, noun: 'topic' })` starts with `'Subject: Ego depletion (topic)'`. With the noun `'company'` it starts with `'Subject: WeWork (company)'`, which is unchanged.
  - In `ground.test.ts`, a claim whose only support is a `video` document grounds with `sourceType === 'other'`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** The noun is `bible.subjectNoun.singular`, read in the step that opens the gate. Set `SOURCE_TYPES.video` to `'other'`. Add decision 446's line for both to `PROGRESS.md` in Task 9.
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** with the message `fix(dossier): the gate names the bible's noun, and a video is not a news outlet`.

### Task 6: The evidence axis, from prompt to grounding

**Files:**
- Modify: `packages/schemas/src/dossier.ts` (`ResearchClaimSchema`, `GroundedClaimSchema`)
- Modify: `packages/providers/src/prompts/dossier.ts` (`CLAIM_SHAPE` becomes `claimShape(profile)` and `CLAIM_RULES` becomes `claimRules(profile)`; `parseClaims`, `parseAnswers`, `repairClaims`)
- Modify: `packages/providers/src/prompts/dossier-profiles.ts` (`evidenceShape`, `evidenceRules`)
- Create: `packages/providers/src/research/evidence.ts`
- Modify: `packages/providers/src/research/ground.ts` (`GroundInput.profile?`, `groundClaim`)
- Modify: `apps/web/inngest/lib/dossier-research.ts` (`researchDossier` input `profile`, the parse lambdas, `toDraftClaims`)
- Test: `packages/providers/src/research/evidence.test.ts`, `packages/providers/src/prompts/dossier.test.ts`, `packages/providers/src/research/ground.test.ts`, `apps/web/inngest/lib/dossier-research.test.ts`

**Interfaces:**
- Consumes: `ResearchProfile` and `EvidenceAxis` (Task 3); the `claims` columns (Task 1).
- Produces:
  - `ResearchClaim.evidence: { status: string; doc: number } | null`, which defaults to null. The status is 1 to 40 characters.
  - `GroundedClaim.evidence: { status: string; documentId: string | null } | null`, which defaults to null.
  - `parseClaims(text, note?, profile: ResearchProfileKey = 'investigation')` and `parseAnswers(text, note?, profile = 'investigation')`.
  - In `evidence.ts`: `groundEvidence(claim: ResearchClaim, found: readonly { doc: CorpusDocument; support: GroundedSupport }[], documents: readonly CorpusDocument[], profile: ResearchProfile, note: Note, n: number): GroundedClaim['evidence']`.
  - `researchDossier` input `profile: ResearchProfileKey`. `toDraftClaims` maps `evidence` to `evidenceStatus` and `evidenceDocumentId`.

- [ ] **Step 1: Write the failing tests**
  - `dossier.test.ts`:
    - Under investigation, a claim carrying `"evidence": {"status": "established", "doc": 1}` parses to `evidence: null` and records no repair note.
    - Under a test axis profile, a status outside the axis (`"replicated"`) parses to `evidence: null`, keeps the claim, and records a note with `field: 'the evidence of claim 1'`.
    - The claims request built for `FIRST_CHANNEL_IN_USE` does not contain `"evidence"`.
  - `evidence.test.ts` (with a test axis that is the science axis of spec 7.2):
    - `established` with two found supports on two distinct `scholarly` documents stays `established`.
    - `established` with one found `scholarly` support whose quote says "a meta-analysis of 88 studies" stays `established`.
    - `established` with one scholarly support and a quote of "was not replicated" falls to `single_study` with a note that reason contains `'needs'`.
    - `established` whose two scholarly supports have `found: false` falls to `single_study` (Review Focus 4).
    - `contested` on a `reporting` document stays `contested`.
    - An evidence `doc` the corpus does not have gives `null` with the not-given note.
  - `ground.test.ts`: under investigation every grounded claim has `evidence === null`, and the existing expectations are unchanged.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** For a profile without an axis, `claimShape` and `claimRules` return today's strings exactly. A profile with an axis adds the `evidence` line to the shape and its rules paragraph after the `legal` rule. Earning is as spec 7.2 says. Words are matched as whole phrases, case-insensitively, the way `VERDICT` is built in `ground.ts:44`. Only `found` supports count, and distinct documents are counted by `documentId`. The repair-notice wording for unknown statuses is `"its evidence status was not one of <list>"`.
- [ ] **Step 4: Run them and see them pass.** Also run `pnpm exec vitest run lift psychology` in `packages/providers`. Expected: PASS, with no fixture diff.
- [ ] **Step 5: Commit** with the message `feat(dossier): an evidence axis the model writes and grounding earns`.

### Task 7: The science profile

**Files:**
- Modify: `packages/schemas/src/research-profiles.ts` (the `science` entry)
- Modify: `packages/providers/src/prompts/dossier-profiles.ts` (science text)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts` and `lift/psychology.test.ts`
- Create: `packages/providers/src/prompts/lift/__fixtures__/dossier-*-science.json` (new snapshots only)
- Test: `packages/schemas/src/research-profiles.test.ts`, `packages/providers/src/prompts/lift/psychology.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3 and 6.
- Produces: `RESEARCH_PROFILES.science` with the values in spec 6.3 and 7.2, copied exactly: the host list, the shares, the related words, the sources all `false`, the statuses, labels, earning words, fallback `single_study`, and `minScholarlyDocuments: 2`.

- [ ] **Step 1: Write the failing tests**
  - In `research-profiles.test.ts`:
    - `science.subject.accept === 'topic'`.
    - `science.tiers.scholarly === 1`.
    - `science.tierShares` equals spec 6.3.
    - `evidenceLabel(science, 'single_study', 'script') === 'ONE STUDY'`.
    - `evidenceLabel(science, 'contested', 'review') === 'Contested'`.
    - `science.scholarlyHosts` includes `'doi.org'` and `'psycnet.apa.org'`.
  - In `psychology.test.ts`, for the dossier builders with `{ ...PSYCHOLOGY_TEST_BIBLE, researchProfile: 'science' }`:
    - The system prompt contains `'MEASURED'` and `'never turn a finding into advice'`.
    - The claims request contains `"evidence"`.
    - The finance-word check passes with the same one exemption.
  - In `lift-cases.ts`, add the science cases. Their new fixtures are written on the first run, which is the only fixture change this plan allows.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** the science values and prompt text in the words of spec 6.3.
- [ ] **Step 4: Run them and see them pass.** Read each new `-science.json` fixture by eye, then confirm that `git status` shows only new fixture files under `__fixtures__` and none modified.
- [ ] **Step 5: Commit** with the message `feat(dossier): the science research profile`.

### Task 8: The script and the review show a claim's standing

**Files:**
- Modify: `packages/providers/src/prompts/script.ts:54-86` (`ScriptClaim`, `claimList`)
- Modify: `apps/web/inngest/functions/script-runner.ts:215-245` (`load-dossier`)
- Modify: `apps/web/app/(console)/projects/[id]/dossier-review.tsx` (the claim row near line 572), and `page.tsx` (pass the profile key)
- Test: `packages/providers/src/prompts/script.test.ts`, `apps/web/inngest/functions/script-runner.test.ts`, `apps/web/app/(console)/projects/[id]/dossier-review.test.tsx`

**Interfaces:**
- Consumes: `evidenceLabel` (Task 3); the `claims.evidenceStatus` column (Task 1).
- Produces: `ScriptClaim.standing?: string`. `claimList` appends `' — ' + standing` directly after the UNVERIFIED marker, matching the file's existing marker style. `DossierReview` gets the prop `researchProfile: ResearchProfileKey`.

- [ ] **Step 1: Write the failing tests**
  - `script.test.ts`: a claim with `standing: 'ONE STUDY'` lists as `[1] (id: c1) Text — NOT adjudicated — ONE STUDY`. A claim without one lists exactly as before.
  - `script-runner.test.ts`: under a science bible, a claim stored with `evidenceStatus: 'contested'` reaches the outline request as `— CONTESTED`. Under the first channel's bible, no claim carries a standing.
  - `dossier-review.test.tsx`: a claim with `evidenceStatus: 'single_study'` under `researchProfile="science"` shows "One study" beside its confidence. Under `investigation` nothing extra shows.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `load-dossier` reads `channelForProject` inside the step to get the profile. A replayed `load-dossier` without `standing` lists as before.
- [ ] **Step 4: Run them and see them pass.** Also run `pnpm exec vitest run lift` in `packages/providers`. Expected: PASS, with no fixture modified.
- [ ] **Step 5: Commit** with the message `feat(script): a claim's evidence standing reaches the script and the review`.

### Task 9: Back-test per profile, progress and the whole-branch check

**Files:**
- Modify: `apps/web/lib/dossier-backtest.ts` (`BACKTEST_CASES`, `BACKTEST_TARGETS`, `CaseRun`, `scoreRuns`, `renderReport`)
- Modify: `apps/web/scripts/live-dossier-backtest.ts` (`parseArgs` gains `--profile`)
- Modify: `PROGRESS.md` (a section for this work, plus decision 446)
- Test: `apps/web/lib/dossier-backtest.test.ts`

**Interfaces:**
- Produces:
  - `BACKTEST_CASES[n].profile: ResearchProfileKey`. The five existing cases are `investigation`. The five science cases of spec section 11 use `expectedTitle` equal to their Wikipedia titles, and `recentOutcome: false`.
  - `BACKTEST_TARGETS.scholarlyShare = 0.2`.
  - `CaseRun.readKinds: Partial<Record<DocumentKind, number>>`.
  - `Report` gains, per profile: the resolved rate, the scholarly share, and the evidence status mix.

- [ ] **Step 1: Write the failing tests.**
  - `scoreRuns` over one science run with `readKinds { scholarly: 3, reporting: 7 }` reports a scholarly share of `0.3`, which passes.
  - Over `{ scholarly: 1, reporting: 9 }` it reports `0.1` and the report marks it below target.
  - The status mix counts claims by `evidence.status`, with `null` reported as "no finding".
  - `renderReport` groups its tables by profile.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** `--profile science` selects the science cases and researches them with `{ ...PSYCHOLOGY_TEST_BIBLE, researchProfile: 'science' }`. The script runs live only when the owner asks; it spends money.
- [ ] **Step 4: Run them and see them pass.** Then verify the whole branch, one package at a time, each with the 600000 timeout:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm format:check`
  - `pnpm --filter @boom-busters/schemas test`
  - `pnpm --filter @boom-busters/providers test`
  - `pnpm --filter @boom-busters/db test` (with Docker up)
  - `apps/web` in two or three directory batches
  - From the e2e package, the `bible`, `pipeline` and `writing-room` specs
  - Expected: all green. `git diff master --stat -- packages/providers/src/prompts/lift/__fixtures__` lists only the new `-science.json` files.
- [ ] **Step 5: Write the PROGRESS section and commit.**

  The PROGRESS section has these parts:
  - A summary line.
  - Deliverables, one line per task with its commit.
  - Decision 446: the profile seam, the evidence axis, the earned-upgrade rule, video typed `other`, and the gate noun.
  - Owner actions at deploy: the one migration, `PUT /api/inngest`, and an optional live science back-test.
  - Not verified: no live run, and paywalled journals.

  ```bash
  git add apps/web/lib/dossier-backtest.ts apps/web/lib/dossier-backtest.test.ts apps/web/scripts/live-dossier-backtest.ts PROGRESS.md
  git commit -m "docs: decision 446, research profiles, and a back-test per profile"
  ```
