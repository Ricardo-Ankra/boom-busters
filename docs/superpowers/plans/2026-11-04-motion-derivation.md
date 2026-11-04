# Derivation, refine, versions and copy. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each channel gets its own exemplar per technique, derived from its references through the critic loop in an Inngest job the owner launches with a cap, stored as versions the owner approves on the Exemplars tab, refined by a plain-words steer with the two shown side by side, copied whole from another channel, with every verdict the owner gives written to a preference ledger; the designer's per-shot call is shown the channel's approved exemplar in place of the house one.

**Architecture:** Three tables: `channel_exemplars` (one row per version: the plan, the code, the critic's report, the metrics, the frames' keys, the verify verdict, the parent and the steer, a status), `motion_derivations` (one row per launch: what was asked, the progress per technique, the spend) and `motion_verdicts` (the ledger). A storyboard prompt on the graphics route writes the plan and rewrites the catalogue's synthetic slot into the channel's register; the build and the fix reuse `designGraphicWith` with the plan as the steer and the house exemplar pinned; the frames and the critic reuse plan 3's inspection and request, extended with a previous version (the pairwise question, asked twice with the order swapped) and a verify ask. `motion-exemplar-deriver` runs the loop a step per call under a per-job cap summed from the ledger; `motion-exemplar-refiner` runs one build and one verify round from an approved version. The Exemplars tab becomes per channel; the Motion tab gains Derive and Copy. `designInput` takes the exemplar from its caller, so the app can hand it the channel's.

**Tech Stack:** TypeScript, Zod 4, drizzle (migration 0048), Inngest with `@inngest/test`, Next.js server actions, React Testing Library, the lift snapshot fixtures in `packages/providers`, the existing browser inspection and critic modules.

**Spec:** `docs/superpowers/specs/2026-11-04-channel-motion-references-design.md`, sections 3, 4, 5 (concepts 6 and 7), 8.3, 9 (9.1 to 9.4), 10.1 (metrics stored on versions), 11 (the Derive section, the Exemplars tab, the verdict rows), 12.2, 12.3, 13, 14. This is plan 4 of 4. Plan 1 (decision 395) built the identity and the prompt slots, plan 2 (decision 396) the references and their readings, plan 3 (decision 397) the metrics and the critic that this plan runs in a loop.

## Calls the author made (check while reading)

- **Channel-only techniques (spec 8.5, second paragraph) are not in this plan.** A technique the derivation proposes from a mechanism reference needs the identity's `techniques` enum, the designer's answer schema, `techniqueFor`'s steer phrases and the catalogue's thumbnails to accept a key that is not in `TECHNIQUES`. That is its own change with its own migration of stored settings; it is named in PROGRESS as a follow-up (plan 5) and the owner decides when. Everything else in sections 8.3, 9, 11 and 12 is here.
- **Mock mode runs the whole flow on fixtures**, never refusing (spec 4 and 13, written after the builder check, over 9.1's older "refuses with a notice"): the deriver stores the house design, checked under the channel's identity, as the draft with `mockCriticReport` and a verify verdict of ready, no browser, no storage, no spend; the refiner stores the parent's code under the mock steer. The e2e suite reaches derive, approve, refine, keep, restore and copy without a key.
- **One version per technique per derivation.** The loop's fix replaces the draft's code in place, as plan 3's review replaces a slot's; the round before is kept only as its sheets' keys, so the pairwise question has a previous to show. Rounds are not versions.
- **The pairwise question is asked twice as the spec says, the second time as a light call**: the critic's main call in round two and later carries the previous round's sheets and the pairwise question (A the new, B the previous); a second call with only the two pairs of sheets, swapped, asks the pairwise question alone. A preference that flips is a tie. The light call costs two images, not seven.
- **Verify runs the critic's prompt on the graphics route** (spec 12.2: the strong model for "the one verify call that ends a technique"): `CriticInput.strong: true` sets the request's task to `graphics`. The refiner's one critic round is a verify against the parent, on the critic route.
- **The per-job cap is checked before every step that pays**, by summing this job's ledger rows (`meta.jobId`), and the month ceiling guards the calls inside a step: `designGraphicWith` may make a second call on a refusal or a cut-off before the next check. Over the cap, the technique keeps what it has as a draft with the reason and the job moves to the next technique, which stops at once for the same reason.
- **Frames go to R2, not through step output.** The frames step stores the shots and the sheets under the version's keys and returns the keys, the findings and the metrics; the critic step reads the images back. Without R2 the derivation still runs: the frames step returns no shots, the critic is skipped with the reason "no frames to show", and the version is stored as a draft with its plan and code so the owner can play it. Derive is never refused for want of storage; the dialogue says what will be missing.
- **The designer's exemplar comes from the caller.** `designGraphicWith` and `reviewGraphicWith` take `exemplar?: Exemplar | null`; absent, they choose as today. `slotTechnique` is exported so the app can pick the channel's approved version for that technique (`channelExemplarFor`) before the call. The core module keeps importing no database.
- **The storyboard rewrites the slot, inside bounds.** It keeps the catalogue slot's length, its word count within a third, and for a chart the series count and the point count; words must sit on the clock in order. A plan outside these is refused and retried once with the reason, then the technique fails with it.
- **Copy refuses a target with live references** ("Archive this channel's references first"), so the pack never exceeds twelve and the fork is clean; approved exemplars copy as approved versions with `copiedFrom`, retiring any approved version the target had for that technique, which stays under Versions. The `assets` rows are shared, the reference rows duplicated with their readings and their sheet keys.
- **Verdict kinds, by button:** `approve` (Approve this on a version with no parent, Restore), `prefer` (Approve this on the side by side, with the two ids), `keep-approved` (Keep the approved one, with the two ids), `steer` (Refine, with the text), `redesign` (the board's Redesign on a graphic or chart slot, with the slot id and the steer). `revise` is in the enum for a later board button and nothing writes it.
- **The restore of a retired version** is an approve: it becomes approved, the current approved retires, and the ledger gets an `approve` row.
- **Derive and Refine do not run at once on a channel**: each job is a singleton on `event.data.channelId` (mode `skip`), and each action refuses while the other kind is running ("A derivation is running on this channel").
- **The estimate** prices the calls on their routes with fixed token counts (storyboard and build on graphics, critic and pairwise on critic, verify on graphics) and shows beside it the last run's cost per technique from `motion_derivations.progress`.
- **The dense moments for a derivation** are four per storyboard moment at 1/24 s steps (the moment itself and the three after it), from the leading time of each storyboard line ("2.0 s …"), capped at `DENSE_SHOTS_MAX`; a storyboard with no timed line falls back to `denseMoments`.
- **At most two reference sheets per critic call** (spec 12.2's cost ruling) although 9.2 says three: the plan's `leansOn` names up to three titles, and the critic is shown the first two of them that are live references with a sheet, then look references by position until two are filled.
- **A refused refine leaves no row.** The refiner writes a `heads-up` notification with the designer's refusal and the Exemplars card shows no new draft; the owner reads the refusal in the notifications list, as a failed read of a reference reads on its card. The tab polls for the new draft for up to five minutes after Refine.
- **The technique column is text**, validated in code against `TECHNIQUES`, so plan 5's channel-only keys need no migration of this table.
- **Migration number** 0048, after `0047_nifty_roulette`; the executor checks the journal against `origin/master` at merge (the memory note on colliding numbers).

## Global Constraints

- Paid calls run only on the owner's word: Derive and Refine start from buttons, with the cap the owner types for a derivation; nothing runs on upload, on the board, or on a settings change. Mock mode (`mockProvidersEnabled()`) spends nothing and runs no browser, and every job and action still completes with fixtures.
- Images go to the storyboard never, to the critic only (spec 3): `buildStoryboardRequest` and `buildGraphicRequest` take no image; the critic gets at most two reference sheets, the two contact sheets and the rest frames, each held to 1600 px by `imageForModel`.
- Vercel's 300 s stands: every step is one call or one inspection; `designGraphicWith` keeps its 240 s deadline, every inspection its 45 s bound, the critic and pairwise calls an abort at 120 s.
- Limits, verbatim from the spec: rounds 1 to 5, default 2; the cap typed every time, red above $20 and still allowed; a steer of at most 500 characters; at most three references named by a plan; the critic's bar 8; a design names at most six mechanisms; at most 24 dense shots per orientation; the early stop when every axis is at or above the bar and no metric is critical.
- An approved version is never edited in place (spec 3): every write to `channel_exemplars.code` is on a draft; approve and retire change `status` only.
- No channel name, niche word or taste number in code (spec 3). The storyboard prompt says "this channel" and reads the identity, the brand and the readings.
- CLAUDE.md: a branch (`motion-derivation`), tests with the code, `pnpm lint` and Prettier at zero warnings before every commit, PROGRESS.md decision at the end, no secrets, button-first UI (every action a labelled button; the side by side is two players and three buttons).
- Written output in prompts and UI copy carries no em or en dash (the prompt test "writes no dash a reader would see", as plans 1 to 3).
- `'use server'` modules export only async functions; every test that renders `SettingsForm` mocks `./exemplar-actions` as it mocks `./motion-actions` (the memory note: a new actions module must be mocked in each, or that file fails at suite level).
- The web tests run with `GRAPHIC_FRAMES=off`; every test of the deriver and the refiner stubs the browser and runs in mock mode or with an injected `complete`; the DB suites run one at a time.
- `code.motion` keeps recording the preamble a design was checked with; a derived version's code is checked under the channel's identity at the time of its build.

## Review Focus

1. The cap crossed between a build and its frames: the version keeps its plan and code as a draft, the progress says "stopped at cap" with the budget's words, the next technique stops at once, and the tab shows both (Task 5 test "stops the technique at the cap with what it has and skips the rest").
2. A storyboard whose words run past the slot or a chart plan with the wrong series count: refused and retried once with the reason, then the technique fails with it and nothing is built (Task 3 test "parses a plan and refuses one whose words run past the slot or whose chart lost a series"; Task 5 test "fails the technique with the storyboard's reason after one retry").
3. Approve on a draft whose parent is no longer the approved version (another refine was approved first): the draft still becomes approved, the current approved retires, the ledger row names the parent it was compared with (Task 2 test "approves a draft whose parent has already retired"; Task 8 test "approves this version and retires the one approved now").
4. Copy into a channel that already holds an approved version of a technique: the copied one is approved, the old one retires and stays listed, and a target with live references is refused (Task 2 test "copies approved exemplars as approved, retiring the target's own"; Task 8 test "refuses to copy into a channel with references").
5. The browser down or storage off during a derivation: the frames step returns no shots, the critic and the verify are skipped with the reason, and the version is stored as a draft the owner can play (Task 5 test "stores a playable draft and skips the critic when there are no frames").

---

### Task 1: The schemas and the events

**Files:**
- Create: `packages/schemas/src/channel-exemplars.ts`
- Modify: `packages/schemas/src/critic.ts` (the verify and pairwise shapes)
- Modify: `packages/schemas/src/events.ts` (two events)
- Modify: `packages/schemas/src/index.ts` (export the new module)
- Test: `packages/schemas/src/channel-exemplars.test.ts`, `packages/schemas/src/critic.test.ts` (one describe), `packages/schemas/src/events.test.ts` (two cases)

**Interfaces:**
- Produces, in `channel-exemplars.ts`: `EXEMPLAR_STATUSES = ['draft', 'approved', 'retired'] as const`, `ExemplarStatus`; `DERIVE_ROUNDS_MIN = 1`, `DERIVE_ROUNDS_MAX = 5`, `DERIVE_ROUNDS_DEFAULT = 2`, `DERIVE_CAP_WARN_USD = 20`, `EXEMPLAR_STEER_MAX = 500`, `PLAN_LEANS_ON_MAX = 3`, `PLAN_WORDS_MAX = 80`, `PLAN_WHY_MAX = 200`; `ExemplarPlanSchema = z.object({ slot: z.object({ intent: z.string().trim().min(1).max(300), words: z.array(z.object({ text: z.string().trim().min(1), atMs: z.number().int().min(0) })).min(1).max(PLAN_WORDS_MAX), data: <the chart data shape of GraphicDesignInput['data']: series ChartSeriesSchema[], takeaway string, annotations optional>.optional() }), concept: z.string().trim().min(1).max(GRAPHIC_CONCEPT_MAX), storyboard: z.array(z.string().trim().min(1).max(GRAPHIC_STORYBOARD_LINE_MAX)).min(1).max(GRAPHIC_STORYBOARD_MAX), mechanisms: z.array(MechanismSchema).max(MECHANISMS_PER_DESIGN_MAX), leansOn: z.array(z.object({ title: z.string().trim().min(1).max(200), why: z.string().trim().min(1).max(PLAN_WHY_MAX) })).max(PLAN_LEANS_ON_MAX) })`, `ExemplarPlan`; `ExemplarFramesSchema = z.object({ shots: z.array(z.object({ orientation: z.enum(['landscape','portrait']), atMs: z.number().int().min(0), r2Key: z.string().min(1) })).max(16), sheets: z.object({ landscape: z.string().min(1).optional(), portrait: z.string().min(1).optional() }), round: z.number().int().min(1) })`, `ExemplarFrames`; `DERIVATION_STATES = ['running', 'done', 'stopped', 'failed'] as const`; `TECHNIQUE_PROGRESS_STATES = ['pending', 'running', 'ready', 'wants-pass', 'no-frames', 'refused', 'stopped-at-cap', 'failed'] as const`, `TechniqueProgressSchema = z.object({ technique: z.enum(TECHNIQUES), state: z.enum(TECHNIQUE_PROGRESS_STATES), versionId: UlidSchema.nullable(), reason: z.string().max(500).nullable(), costUsd: z.number().min(0) })`, `DerivationProgress = TechniqueProgress[]`; `VERDICT_KINDS = ['approve', 'keep-approved', 'prefer', 'revise', 'steer', 'redesign'] as const`, `VerdictKind`; `DeriveRequestSchema = z.object({ techniques: z.array(z.enum(TECHNIQUES)).min(1), rounds: z.number().int().min(DERIVE_ROUNDS_MIN).max(DERIVE_ROUNDS_MAX), capUsd: z.number().positive().max(10_000) })`; `ExemplarSteerSchema = z.string().trim().min(1).max(EXEMPLAR_STEER_MAX)`; `planIssue(plan: ExemplarPlan, bounds: { durationMs: number; wordCount: number; chart?: { series: number; points: number } }): string | null` (the slot rewrite's bounds: every word `atMs < durationMs` in ascending order; the word count within a third of `bounds.wordCount` either way; a chart plan has `data` with exactly `bounds.chart.series` series of exactly `bounds.chart.points` points each; a graphic plan has no `data`; the first failing rule as one sentence, else null).
- Produces, in `critic.ts`: `PRIOR_DEFECT_STATES = ['fixed', 'partly', 'present'] as const`; `CriticVerifySchema = CriticReportSchema.extend({ priorDefects: z.array(z.object({ index: z.number().int().min(1), state: z.enum(PRIOR_DEFECT_STATES) })).max(CRITIC_DEFECTS_MAX), verdict: z.enum(['ready', 'one-more-pass']) })`, `CriticVerify`; `PAIRWISE_ANSWERS = ['A', 'B', 'same'] as const`, `PairwiseAnswerSchema = z.object({ engagement, intent, composition, temporal, craft })` each `z.enum(PAIRWISE_ANSWERS)`, `PairwiseAnswer`; `PAIRWISE_OUTCOMES = ['new', 'previous', 'tie'] as const`, `PairwiseOutcomeSchema` (the five axes, each `z.enum(PAIRWISE_OUTCOMES)`), `PairwiseOutcome`; `pairwiseOutcome(first: PairwiseAnswer, swapped: PairwiseAnswer): PairwiseOutcome` (in `first` A is the new version; in `swapped` B is the new version; an axis is `new` when first says A and swapped says B, `previous` when first says B and swapped says A, `tie` otherwise).
- Produces, in `events.ts`: `MotionExemplarsDeriveSchema = z.object({ channelId: UlidSchema, derivationId: UlidSchema })` as `'motion/exemplars.derive'`; `MotionExemplarRefineSchema = z.object({ channelId: UlidSchema, parentId: UlidSchema, steer: ExemplarSteerSchema })` as `'motion/exemplar.refine'`.

- [ ] **Step 1: Write the failing tests**

`channel-exemplars.test.ts`:

```ts
describe('the exemplar plan (spec 2026-11-04, section 9.2)', () => {
  it('accepts a plan with a rewritten slot, a storyboard, mechanisms and three references', ...)
  it('refuses more than three references, more than six mechanisms, or an empty storyboard', ...)
  it('planIssue names words past the clock, out of order, or a third too many', () => {
    expect(planIssue(plan({ words: [{ text: 'a', atMs: 6000 }] }), { durationMs: 6000, wordCount: 1 }))
      .toMatch(/past the slot/)
    expect(planIssue(plan({ words: [w(0), w(500), w(400)] }), { durationMs: 6000, wordCount: 3 }))
      .toMatch(/in order/)
    expect(planIssue(plan({ words: twelve }), { durationMs: 6000, wordCount: 6 })).toMatch(/words/)
    expect(planIssue(plan({ words: six }), { durationMs: 6000, wordCount: 6 })).toBeNull()
  })
  it('planIssue holds a chart plan to the series and point counts, and a graphic plan to no data', ...)
  it('the derive request holds rounds to 1..5 and needs a positive cap', ...)
  it('a technique progress row names a state from the list', ...)
})
```

`critic.test.ts`, a describe "the verify and pairwise shapes (spec 9.2, steps 4 and 7)": a verify report with `priorDefects` and `verdict: 'ready'` parses; `pairwiseOutcome` gives `new` for A then B, `previous` for B then A, `tie` for A then A, `tie` for same then anything.

`events.test.ts`: `parseEventData('motion/exemplars.derive', …)` accepts the two ids and refuses a missing one; `'motion/exemplar.refine'` refuses a steer of 501 characters.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/schemas && pnpm exec vitest run channel-exemplars critic events`
Expected: FAIL, the new module and exports missing.

- [ ] **Step 3: Implement the schemas**

`channel-exemplars.ts` as the Interfaces block says; the chart data shape is the same object `GraphicDesignInput['data']` describes, built from `ChartSeriesSchema` (already in the schemas package). `planIssue` sentences: "a word sits past the slot's end", "the words are not in order on the clock", "the plan has N words; the slot speaks M, keep within a third of that", "a chart plan needs N series of M points", "a graphic plan carries no chart data". Add `export * from './channel-exemplars'` to the index. The events: the two schemas, their `EVENT_SCHEMAS` entries, and in `apps/web/inngest/events.ts` the two `eventType` bindings `motionExemplarsDerive` and `motionExemplarRefine` (the drift test holds the two lists together).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/schemas && pnpm exec vitest run` then `cd apps/web && pnpm exec vitest run events`
Expected: PASS, all green, including the web events drift test.

- [ ] **Step 5: Commit**

```bash
git add packages/schemas/src apps/web/inngest/events.ts
git commit -m "feat(schemas): the exemplar plan, the derivation progress, the verdict kinds, the critic's verify and pairwise shapes, two motion events"
```

---

### Task 2: The tables, the migration and the queries

**Files:**
- Modify: `packages/db/src/schema.ts` (three tables, three enums, row types)
- Create: `packages/db/drizzle/0048_<name>.sql` and the journal entry (generated)
- Create: `packages/db/src/channel-exemplars.ts`, `packages/db/src/motion-derivations.ts`, `packages/db/src/motion-verdicts.ts`
- Modify: `packages/db/src/index.ts` (export the three)
- Test: `packages/db/src/channel-exemplars.integration.test.ts`, `packages/db/src/motion-derivations.integration.test.ts`, `packages/db/src/motion-verdicts.integration.test.ts` (the `requireTestDatabase` / `describe.skip` pattern of `motion-references.integration.test.ts`)

**Interfaces:**
- Produces, tables: `exemplar_status` enum (`EXEMPLAR_STATUSES`), `derivation_state` enum (`DERIVATION_STATES`), `verdict_kind` enum (`VERDICT_KINDS`). `channel_exemplars`: `id`, `channelId` (references channels, restrict), `technique text not null`, `version integer not null`, `status exemplar_status not null default 'draft'`, `parentId text null` (self reference, set null), `steer text null`, `plan jsonb not null $type<ExemplarPlan>`, `code jsonb not null $type<GraphicCode>`, `critique jsonb null $type<CriticReport>`, `verify jsonb null $type<CriticVerify>`, `pairwise jsonb null $type<PairwiseOutcome>`, `metrics jsonb null $type<MotionMetrics>`, `frames jsonb null $type<ExemplarFrames>`, `derivationId text null`, `copiedFrom text null`, `costUsd numeric(10,4) null`, `createdAt`, `updatedAt`, `approvedAt timestamptz null`; unique index on `(channel_id, technique, version)`; a partial unique index `channel_exemplars_approved_key` on `(channel_id, technique) where status = 'approved'`; index on `channel_id`. `motion_derivations`: `id`, `channelId`, `techniques jsonb not null $type<Technique[]>`, `rounds integer not null`, `capUsd numeric(10,4) not null`, `state derivation_state not null default 'running'`, `progress jsonb not null $type<DerivationProgress>`, `spentUsd numeric(10,4) not null default 0`, `error text null`, `createdAt`, `updatedAt`, `finishedAt timestamptz null`; index on `channel_id`. `motion_verdicts`: `id`, `channelId`, `kind verdict_kind not null`, `exemplarId text null`, `slotId text null`, `comparison jsonb null $type<{ a: string; b: string }>`, `steer text null`, `createdAt`; index on `channel_id`.
- Produces, `channel-exemplars.ts`: `insertExemplarVersion(db, input: { channelId; technique: Technique; plan: ExemplarPlan; code: GraphicCode; parentId?: string | null; steer?: string | null; derivationId?: string | null; copiedFrom?: string | null; status?: ExemplarStatus }): Promise<ChannelExemplarRow>` (version = max + 1 for the channel and technique, in a transaction); `updateExemplarDraft(db, id, patch: Partial<Pick<ChannelExemplarRow, 'code' | 'critique' | 'verify' | 'pairwise' | 'metrics' | 'frames' | 'costUsd'>>): Promise<ChannelExemplarRow>` (throws `ValidationError('An approved version is never edited')` on a non-draft row); `exemplarVersionById(db, id): Promise<ChannelExemplarRow | null>`; `listChannelExemplars(db, channelId): Promise<ChannelExemplarRow[]>` (every row, technique then version descending); `approvedExemplar(db, channelId, technique): Promise<ChannelExemplarRow | null>`; `approveExemplarVersion(db, id): Promise<{ approved: ChannelExemplarRow; retired: ChannelExemplarRow | null }>` (in a transaction: the row becomes approved with `approvedAt`, the channel's approved row of that technique, if another, becomes retired; a draft or a retired row may be approved); `retireExemplarVersion(db, id): Promise<ChannelExemplarRow>` (a draft or approved row becomes retired); `copyMotionFromChannel(db, targetId, sourceId): Promise<{ references: number; exemplars: number }>` (one transaction: the source's live `motion_references` rows duplicated for the target in position order with the same `assetId`, frames, reading, sheet keys and read state; the source's approved exemplars inserted for the target as approved versions with `copiedFrom` the source row's id, any approved version the target held for that technique retired; throws `ValidationError('Archive this channel's references first')` when the target has a live reference). The settings copy is the action's (Task 7).
- Produces, `motion-derivations.ts`: `createDerivation(db, input: { channelId; techniques: Technique[]; rounds: number; capUsd: number }): Promise<MotionDerivationRow>` (progress one `pending` row per technique, cost 0); `getDerivation(db, id)`, `latestDerivation(db, channelId): Promise<MotionDerivationRow | null>`; `runningDerivation(db, channelId): Promise<MotionDerivationRow | null>`; `updateTechniqueProgress(db, id, technique, patch: Partial<Omit<TechniqueProgress, 'technique'>>): Promise<void>`; `finishDerivation(db, id, outcome: { state: 'done' | 'stopped' | 'failed'; spentUsd: number; error?: string }): Promise<void>`.
- Produces, `motion-verdicts.ts`: `recordVerdict(db, input: { channelId; kind: VerdictKind; exemplarId?: string | null; slotId?: string | null; comparison?: { a: string; b: string } | null; steer?: string | null }): Promise<MotionVerdictRow>`; `listVerdicts(db, channelId, limit = 50): Promise<MotionVerdictRow[]>` (newest first).

- [ ] **Step 1: Write the failing integration tests**

`channel-exemplars.integration.test.ts`: "numbers versions per channel and technique from one"; "refuses to edit an approved version in place"; "approves a version and retires the one approved before it"; "approves a draft whose parent has already retired" (approve v2 with parent v1, then v3 with parent v2 after v2 retired by a v4 approval: v3 becomes approved, v4 retires); "restores a retired version by approving it again"; "copies approved exemplars as approved, retiring the target's own"; "copies the live references with their readings and shares the asset rows"; "refuses to copy into a channel with live references".
`motion-derivations.integration.test.ts`: "creates a derivation with a pending row per technique", "updates one technique's progress and leaves the others", "finishes with the spend".
`motion-verdicts.integration.test.ts`: "records a verdict with a comparison and lists newest first".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/db && pnpm exec vitest run channel-exemplars motion-derivations motion-verdicts`
Expected: FAIL (modules missing). Docker Desktop must be up for the test database (memory note).

- [ ] **Step 3: Add the tables, generate the migration, write the queries**

Schema as the Interfaces block says; `pnpm db:generate` names the file `0048_*`; check `drizzle/meta/_journal.json` ends at idx 48. Queries as named. `copyMotionFromChannel` reads `listMotionReferences(db, sourceId)` and inserts with `position` 1..n.

- [ ] **Step 4: Migrate the test database and run the tests**

Run: `pnpm db:migrate:test` then `cd packages/db && pnpm exec vitest run`
Expected: PASS, the whole db suite green.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): channel exemplar versions, derivations and the preference ledger, migration 0048"
```

---

### Task 3: The storyboard prompt, the critic's previous version, verify and pairwise

**Files:**
- Create: `packages/providers/src/prompts/storyboard.ts`
- Modify: `packages/providers/src/prompts/critic.ts` (`CriticInput.previous`, `CriticInput.verify`, `CriticInput.strong`, `buildPairwiseRequest`, `parseCriticVerify`, `parsePairwise`, `mockCriticVerify`, `mockPairwise`)
- Modify: `packages/providers/src/prompts/index.ts` (export storyboard)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts` (three cases) and `__fixtures__` (generated with `-u`)
- Test: `packages/providers/src/prompts/storyboard.test.ts`, `packages/providers/src/prompts/critic.test.ts`

**Interfaces:**
- Consumes: `ExemplarPlanSchema`, `planIssue`, `CriticVerifySchema`, `PairwiseAnswerSchema` (Task 1); `motionIdentityBlock`, `MsgImage`, `ReviewFrame` (plan 3); `ExemplarEntry`, `ExemplarSlot` (the manifest); `ReadingForDraft` (`motion.ts`).
- Produces, `storyboard.ts`: `STORYBOARD_OUTPUT_TOKENS = 2500`, `STORYBOARD_INPUT_TOKENS = 6000`; `StoryboardInput { motion: MotionIdentity; brand: IdentityDraftInput['brand']; entry: Pick<ExemplarEntry, 'technique' | 'description' | 'mechanisms' | 'slot' | 'chart'>; house: { title: string; concept?: string; storyboard?: string[] } | null; readings: readonly ReadingForDraft[]; rejection?: string }`; `buildStoryboardRequest(input): LLMTaskRequest` (task `graphics`; system: the role "you plan one motion graphic for this channel, writing nothing but the plan"; the identity block and the style guide as the first user message, `cacheablePrefixMessages: 1`; the material: the technique, its description and mechanisms, the house design's concept and storyboard as mechanics, the synthetic slot verbatim with the instruction to rewrite its words and figures into something this channel would say and count, keeping the length and, for a chart, the series and point counts; the readings as "Reference N: title (purpose): carry over / avoid / reading"; the answer shape as JSON `{"slot": {"intent": "...", "words": [{"text": "...", "atMs": 0}], "data": {...}}, "concept": "...", "storyboard": ["0.0 s ..."], "mechanisms": ["..."], "leansOn": [{"title": "...", "why": "..."}]}`, a storyboard line beginning with its time in seconds); `parseStoryboardPlan(text, bounds: Parameters<typeof planIssue>[1], note?): ExemplarPlan` (JSON through `ExemplarPlanSchema` with lines trimmed and unknown mechanisms dropped with a note, as `parseCriticReport` does; then `planIssue`, whose sentence becomes `ValidationError`); `mockStoryboardPlan(entry): ExemplarPlan` (the slot as is, concept `[mock] the house design, unchanged`, storyboard `['0.0 s the house design plays as written']`, the entry's mechanisms, no leansOn).
- Produces, `critic.ts`: `CriticInput.previous?: { sheets: { landscape?: MsgImage; portrait?: MsgImage }; label: string }` (shown after the design's sheets as "Previous A/B …" with the pairwise question added to the answer shape: `"prefers": {"engagement": "A", ...}` with A the design under review, B the previous); `CriticInput.verify?: { prior: CriticReport; brief: string }` (the prior report's defects listed by number, the brief "verify against …", the answer shape gaining `"priorDefects": [{"index": 1, "state": "fixed"}]` and `"verdict": "ready"`); `CriticInput.strong?: boolean` (task `graphics` when true); `buildPairwiseRequest(input: { motion: MotionIdentity; plan: CriticPlan; a: CriticInput['sheets']; b: CriticInput['sheets'] }): LLMTaskRequest` (task `critic`, the head cached, the two pairs of sheets labelled A and B, the pairwise question alone, answer `{"prefers": {...}}`); `parseCriticVerify(text, note?): CriticVerify` (the report parser plus the two fields; a missing `priorDefects` is `[]`, a missing verdict is `one-more-pass`); `parsePairwise(text): PairwiseAnswer` (from `prefers`); `mockCriticVerify(plan): CriticVerify` (the mock report, every prior defect `fixed`, verdict `ready`); `mockPairwise(): PairwiseAnswer` (every axis `same`).

- [ ] **Step 1: Write the failing tests**

`storyboard.test.ts`: "builds a graphics request with the identity cached first, the slot verbatim and the readings"; "names no reference image and takes none"; "writes no dash a reader would see"; "parses a plan and refuses one whose words run past the slot"; "retries with the rejection before the material"; "the mock plan is the slot unchanged with a mock concept".
`critic.test.ts`, a describe "the previous version, verify and pairwise (spec 9.2, steps 4 and 7)": "shows the previous version's sheets after the design's and asks which it prefers"; "asks the verify question with the prior defects numbered"; "runs on the graphics route when strong"; "the pairwise request carries two pairs of sheets and nothing else"; "parses a verify report and a pairwise answer, defaulting a missing verdict to one more pass".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/providers && pnpm exec vitest run storyboard critic`
Expected: FAIL.

- [ ] **Step 3: Implement the storyboard prompt and the critic's additions**

As the Interfaces block says. The critic's `SYSTEM` is unchanged; the extra questions go in the third message's ask after the picture labels, so the cached head is the same across a derivation.

- [ ] **Step 4: Add the lift cases and regenerate the fixtures**

`liftAware('graphics-storyboard', …)` with the `stat-counter` entry and two readings; `liftAware('graphics-critic-verify', …)` the plan 3 critic case plus `previous` and `verify`; `liftAware('graphics-pairwise', …)`. Run: `cd packages/providers && pnpm exec vitest run lift -u` then `pnpm exec vitest run`
Expected: PASS; three new fixture files; no other fixture changed (`git status` shows only the three).

- [ ] **Step 5: Commit**

```bash
git add packages/providers/src
git commit -m "feat(providers): the storyboard prompt, the critic's previous version, verify ask and pairwise request"
```

---

### Task 4: The core takes its exemplar from the caller; the photograph and the plan are reusable; the ledger carries a job id

**Files:**
- Create: `apps/web/lib/exemplar-derive.ts`
- Modify: `apps/web/lib/graphic-design-core.ts` (`slotTechnique`, `exemplar` option, `photographForCritic`, `criticPlanOf`)
- Modify: `apps/web/lib/graphic-design.ts` (`channelExemplarFor`, both callers pass `exemplar`)
- Modify: `apps/web/lib/llm.ts` (`CallOptions.meta`)
- Modify: `packages/cost/src/ledger.ts` (`jobSpendUsd`)
- Test: `apps/web/lib/exemplar-derive.test.ts`, `apps/web/lib/graphic-design.test.ts` (three cases), `apps/web/lib/graphic-design-core.test.ts` or the existing design describe (two cases), `apps/web/lib/llm.test.ts` (one case), `packages/cost/src/ledger.integration.test.ts` (one case)

**Interfaces:**
- Consumes: `ExemplarPlan`, `planIssue` (Task 1); `exemplarContext`, `exemplarBrief` (`exemplar-translate.ts`); `denseMoments`, `DENSE_SHOTS_MAX`, `FramesResult` (plan 3); `motionMetrics`; `approvedExemplar` (Task 2).
- Produces, `exemplar-derive.ts` (pure, no database): `derivedContext(entry: ExemplarEntry, plan: ExemplarPlan): GraphicDesignContext` (as `exemplarContext`, but the claims come from the plan's words and data; `chapterTitle` the technique); `derivedBrief(entry, plan, context): DesignableBrief` (as `exemplarBrief` with the plan's intent, words and data); `derivedSlot(entry, plan, context): GraphicSlotTiming & { brief: DesignableBrief }` (`chapterId: 'exemplar'`, `startMs: 0`, `durationMs: entry.slot.durationMs`); `planBounds(entry): Parameters<typeof planIssue>[1]`; `storyboardMoments(storyboard: readonly string[], durationMs: number): number[]` (each line's leading `N.N s` or `N s`, four moments at 0, 42, 83 and 125 ms after it, within the slot, unique, ascending, capped at `DENSE_SHOTS_MAX`; `denseMoments(durationMs)` when no line carries a time); `planSteer(plan): string` ("The plan to build, as agreed: concept …; storyboard: 1. … 2. …; built on: drum, draw on. Keep to it."); `refineSteer(steer, plan): string` ("The producer's steer: <steer>\nWhat the steer does not name is kept exactly as it is.\n" then `planSteer`). The context carries no paragraphs, as the corpus's does not.
- Produces, `graphic-design-core.ts`: `export function slotTechnique(context, slot, motion, guidance?): Technique` (the `techniqueFor` call lifted out of `designInput`); `designGraphicWith` and `reviewGraphicWith` options gain `exemplar?: Exemplar | null` (given, used as is, `null` meaning none; absent, `exemplarFor(slotTechnique(...))` as today); `export async function photographForCritic(context, slot, code, options: FramesOptions & { motion: MotionIdentity; dense: readonly number[]; deadline: number }): Promise<{ photographed: FramesResult; metrics: MotionMetrics | null } | null>` (the inspection with `shots: true, measure: 'findings', sheets: true` and the metrics; null when the browser is off or returns no shots; `reviewGraphicWith` calls it, its tests unchanged); `export function criticPlanOf(code: GraphicCode, context): CriticPlan`.
- Produces, `graphic-design.ts`: `channelExemplarFor(channelId: string, technique: Technique): Promise<Exemplar | undefined>` (the approved version as `{ technique, description: the manifest's, mechanisms: version.plan.mechanisms, title: version.code.title, source: version.code.source }`, else `exemplarFor(technique)`); `designGraphic` and `reviewGraphic` pass `exemplar: await channelExemplarFor(inUse.channelId, slotTechnique(...))`.
- Produces, `llm.ts`: `CallOptions.meta?: Record<string, unknown>` merged into the ledger row's `meta` after `task`, `model` and `purpose`.
- Produces, `ledger.ts`: `jobSpendUsd(db: DbLike, jobId: string): Promise<number>` (the sum of `coalesce(actual_usd, estimated_usd)` over rows whose `meta->>'jobId'` is the id, rounded to four places).

- [ ] **Step 1: Write the failing tests**

`exemplar-derive.test.ts`: "derives one claim per figure the plan speaks and per charted point"; "the brief carries the plan's intent, words and data"; "storyboardMoments takes four shots a frame apart from each timed line, inside the slot, at most 24"; "falls back to the even set when no line is timed"; "the steers carry the plan and the refine keeps what is not named"; "writes no dash".
`graphic-design.test.ts`: "shows the designer the channel's approved exemplar for the slot's technique" (mock `channelExemplarFor` through `@boom-busters/db`'s `approvedExemplar`); "shows the house exemplar when the channel has no approved version"; "the review passes the same exemplar to the fix".
Core: "uses the exemplar it is given and none when given null"; "photographForCritic returns the shots and the metrics, null without a browser".
`llm.test.ts`: "writes the call's meta onto the ledger row".
`ledger.integration.test.ts`: "sums a job's rows by meta.jobId, settled or reserved".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run exemplar-derive graphic-design llm` and `cd packages/cost && pnpm exec vitest run ledger`
Expected: FAIL.

- [ ] **Step 3: Implement**

As the Interfaces block says. `reviewGraphicWith`'s body moves its inspection and metrics into `photographForCritic` and its plan into `criticPlanOf` with no change of behaviour: the existing review describe stays green untouched.

- [ ] **Step 4: Run the suites**

Run: `cd apps/web && pnpm exec vitest run graphic-design exemplar-derive llm graphic-code` and `cd packages/cost && pnpm exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib packages/cost/src
git commit -m "feat(web): the designer takes the channel's exemplar, the photograph and the plan are reusable, the ledger carries a job id"
```

---

### Task 5: The deriver job

**Files:**
- Create: `apps/web/inngest/functions/motion-exemplar-deriver.ts`
- Create: `apps/web/lib/exemplar-keys.ts` (`exemplarFrameKey({ channelId, versionId, round, orientation, atMs })`, `exemplarSheetKey({ channelId, versionId, round, orientation })` under `boom-busters/exemplars/<channelId>/<versionId>/round-<n>/…`)
- Create: `apps/web/inngest/lib/exemplar-loop.ts` (the pieces the deriver and the refiner share)
- Modify: `apps/web/inngest/functions/index.ts` (register)
- Test: `apps/web/inngest/functions/motion-exemplar-deriver.test.ts` (the `InngestTestEngine` pattern of `motion-reference-reader.test.ts`, mock mode and an injected `complete` through `vi.mock('@/lib/llm')`, storage mocked as the reader's test mocks it), `apps/web/lib/exemplar-keys.test.ts`, `apps/web/inngest/lib/exemplar-loop.test.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4; `getChannel`, `getChannelSettings`, `listMotionReferences` (db); `requireCompleteBible` (`inngest/lib/channel.ts`); `completeForChannel` (`answer-call.ts`); `callLlm` with `meta`; `browserFrames`, `graphicBrand`, `resolveBrandKit`, `resolveMotionIdentity`; `imageForModel`, `getObjectBytes`, `putObject`, `storageConfigured`; `criticReferencesFor` (plan 3) extended with a second parameter `titles?: readonly string[]` (the plan's `leansOn` titles first, then look references, at most two; the plan 3 test stays green with no titles).
- Produces, `exemplar-loop.ts`: `LoopChannel { channelId; motion: MotionIdentity; bible: BibleInUse; brand: GraphicProps['brand']; log: (line: string) => void }`; `loopChannel(channelId): Promise<LoopChannel>` (`getChannel`, `requireCompleteBible`, the settings resolved); `completeForJob(channelId, jobId, technique): GraphicCompleteFn` (`callLlm` with `channelId`, `meta: { jobId, technique }` and the call's `purpose`); `buildFromPlan(input: { channel: LoopChannel; entry: ExemplarEntry; plan: ExemplarPlan; current?: GraphicCode; guidance: string; complete: GraphicCompleteFn; frames?: GraphicFrames }): Promise<GraphicDesignResult>` (`designGraphicWith` on `derivedSlot`, `exemplar: exemplarFor(entry.technique)`, `redesign: true` with the brief carrying `current` when given); `photographVersion(input: { channel: LoopChannel; entry; plan; versionId; round; code: GraphicCode; frames: GraphicFrames }): Promise<{ frames: ExemplarFrames; findings: string[]; metrics: MotionMetrics | null } | null>` (null when storage is off, "no storage to keep the frames", or `photographForCritic` returns null; the shots and the sheets put under the keys); `criticRound(input: { channel: LoopChannel; plan: CriticPlan; slot: CriticInput['slot']; frames: ExemplarFrames; findings; metrics; references: CriticReference[]; previous?: ExemplarFrames; verify?: CriticInput['verify']; strong?: boolean; complete: GraphicCompleteFn }): Promise<{ report: CriticReport | CriticVerify; pairwise: PairwiseAnswer | null }>` (the images read back from R2 and held to the model width; the pairwise answer from the main call when `previous` is given); `pairwiseSwapped(input: { channel; plan; current: ExemplarFrames; previous: ExemplarFrames; complete }): Promise<PairwiseAnswer>`; `loopSlot(entry, plan): CriticInput['slot']`.
- Produces: `motionExemplarDeriver` on `events.motionExemplarsDerive`, id `motion-exemplar-deriver`, `retries: 1`, `singleton: { key: 'event.data.channelId', mode: 'skip' }`, `onFailure` marks the derivation `failed` with the error's message. Per technique in the event's order, the steps named `<technique>/storyboard`, `<technique>/build`, `<technique>/frames-<round>`, `<technique>/critic-<round>`, `<technique>/pairwise-<round>`, `<technique>/fix-<round>`, `<technique>/verify`, `<technique>/done`; each paid step starts with `const spent = await jobSpendUsd(db, derivationId); if (spent >= capUsd) → stopped-at-cap` with the reason `The cap of $X was reached at $Y`. Every `callLlm` carries `meta: { jobId: derivationId, technique }`. The mock path (`mockProvidersEnabled()`) stores per technique: `mockStoryboardPlan(entry)`, the house design through `graphicCodeIssue` under the channel's identity (a house design the checks refuse under this identity fails the technique with the issue), `mockCriticReport`, `mockCriticVerify`, no frames, no metrics, cost 0, state `ready`. The real path: storyboard through `callForAnswer` with `parseStoryboardPlan` and `retryWithReason` (a refused plan after one retry → `failed` with the issue); build through `designGraphicWith` with `exemplar: exemplarFor(technique)`, `guidance: planSteer(plan)`, `motion`, the browser and the brand (a refusal is retried inside it once; `ok: false` → `refused` with the issue); the version inserted as a draft; frames through `photographForCritic` with `dense: storyboardMoments(plan.storyboard, durationMs)` stored to R2 (null → the technique's state `no-frames`, the loop ends, the version kept); critic through `buildCriticRequest` with `references: await criticReferencesFor(channelId, plan.leansOn.map(l => l.title))`, round ≥ 2 adding `previous` (the round before's sheets) and a pairwise call swapped; the early stop; fix through `designGraphicWith` with `current: currentDesign(code)` carried by the `redesign` option of a slot whose brief holds the code, `guidance: criticSteer(report.fixes, planSteer(plan))`; verify through `buildCriticRequest({ …, verify: { prior: lastReport, brief: 'the derivation is over; is it ready?' }, strong: true })`; the version updated with `critique`, `verify`, `pairwise`, `metrics`, `frames`, `costUsd`; progress `ready` when `verify.verdict === 'ready'`, else `wants-pass`. At the end `finishDerivation` with `done`, or `stopped` when any technique stopped at the cap, and `spentUsd = jobSpendUsd`.

- [ ] **Step 1: Write the failing tests**

"derives every technique in mock mode as a playable draft with the mock report and a ready verdict"; "writes the progress per technique and the derivation's state and spend"; "skips a second launch on the same channel while one runs" (two events, the singleton); "stops the technique at the cap with what it has and skips the rest" (an injected ledger sum over the cap after the build); "fails the technique with the storyboard's reason after one retry" (an injected `complete` whose plan runs past the clock twice); "stores a playable draft and skips the critic when there are no frames" (browser stub returns no shots); "stops early when the critic passes every axis in round one" (injected report at the bar, one critic call, no fix); "asks the pairwise question twice from round two and records a flip as a tie"; "the verify call runs on the graphics route".
`exemplar-keys.test.ts`: the two keys' shape.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-deriver exemplar-keys`
Expected: FAIL.

- [ ] **Step 3: Implement the job**

As the Interfaces block says, in the shape of `motion-reference-reader.ts` (a channel job, no project to park) with the step naming above so a parked run resumes at its step.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-deriver exemplar-keys functions/index`
Expected: PASS, the registry test counting the new function.

- [ ] **Step 5: Commit**

```bash
git add apps/web/inngest apps/web/lib/exemplar-keys.ts apps/web/lib/exemplar-keys.test.ts apps/web/lib/critic-references.ts apps/web/lib/critic-references.test.ts
git commit -m "feat(web): motion-exemplar-deriver, the critic loop per technique under a per-job cap"
```

---

### Task 6: The refiner job

**Files:**
- Create: `apps/web/inngest/functions/motion-exemplar-refiner.ts`
- Modify: `apps/web/inngest/functions/index.ts`
- Test: `apps/web/inngest/functions/motion-exemplar-refiner.test.ts`

**Interfaces:**
- Consumes: Task 5's `exemplar-loop.ts` (`loopChannel`, `completeForJob` with the refiner's run id as the job id, `buildFromPlan`, `photographVersion`, `criticRound`, `loopSlot`); `notify` (`@/lib/notify`, kind `heads-up`).
- Produces: `motionExemplarRefiner` on `events.motionExemplarRefine`, id `motion-exemplar-refiner`, `retries: 1`, singleton on `event.data.channelId` mode `skip`. Steps `build`, `frames`, `verify`, `done`. The parent is `exemplarVersionById(parentId)`; a parent that is gone ends the run with `{ outcome: 'gone' }`. Build: `buildFromPlan` with the parent's plan, `current: parent.code`, `guidance: refineSteer(steer, parent.plan)`; `ok: false` writes a `heads-up` notification titled "Refine refused" with the issue, inserts nothing and returns `{ outcome: 'refused' }`. A passing build inserts a draft with `parentId` and `steer`, then `photographVersion` (round 1), then one `criticRound` with `previous: parent.frames` (when the parent has frames) and `verify: { prior: parent.critique ?? <a report of five 8s and no defects>, brief: "The producer's steer: <steer>" }` on the critic route; the version updated with `critique`, `verify`, `pairwise` (the main call's answer as an outcome with no swap, every `A` read as `new`, `B` as `previous`: a refine's pairwise informs, the owner decides), `metrics`, `frames`, `costUsd`. Mock mode: the parent's code with the title prefixed `[mock] Refined:` through `graphicCodeIssue`, `mockCriticVerify`, no frames.

- [ ] **Step 1: Write the failing tests**

"refines in mock mode into a draft with the parent and the steer"; "ends when the parent is gone"; "a refused build inserts nothing and leaves a heads-up"; "verifies against the parent's sheets with the steer as the brief" (injected complete: the request carries `previous` and `verify`); "skips a refine while one runs on the channel".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-refiner`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-refiner motion-exemplar-deriver functions/index`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/inngest
git commit -m "feat(web): motion-exemplar-refiner, one build and one verify round from an approved version"
```

---

### Task 7: The actions, the verdicts and the estimate

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/exemplar-actions.ts`
- Modify: `apps/web/app/(console)/projects/[id]/visuals-actions.ts` (`rebriefSlotAction` writes a `redesign` verdict)
- Modify: `apps/web/lib/motion-estimates.ts` (`derivationEstimateUsd`)
- Test: `apps/web/app/(console)/c/[slug]/settings/exemplar-actions.test.ts`, `apps/web/app/(console)/projects/[id]/visuals-actions.test.ts` (one case), `apps/web/lib/motion-estimates.test.ts` (two cases)

**Interfaces:**
- Consumes: Tasks 1, 2, 5, 6; `channelGate` pattern (`motion-actions.ts`: `requireOwner`, `UlidSchema`, `channelWriteRefusal`); `inngest.send` with `events.motionExemplarsDerive.create` and `events.motionExemplarRefine.create`; `recordVerdict`; `copyMotionFromChannel`; `updateChannelSettings`; `channelForProject`.
- Produces, `exemplar-actions.ts` (`'use server'`, async exports only): `deriveExemplarsAction(channelId, input: unknown): Promise<ActionResult & { derivationId?: string }>` (`DeriveRequestSchema`; refuses while a derivation or a refine runs: "A derivation is running on this channel"; creates the row, sends the event; a failed send marks the row `failed` and returns the Inngest message as `rebriefSlotAction` does); `refineExemplarAction(channelId, parentId, steer: unknown): Promise<ActionResult>` (`ExemplarSteerSchema`; the parent must belong to the channel and be approved or, when none is approved for the technique, the latest draft; refuses while a job runs; records `steer` with `exemplarId: parentId`; sends the event); `approveExemplarVersionAction(channelId, versionId): Promise<ActionResult>` (`approveExemplarVersion`; records `prefer` with `comparison: { a: versionId, b: parentId }` when the version has a parent, else `approve`); `keepApprovedAction(channelId, draftId): Promise<ActionResult>` (`retireExemplarVersion(draftId)`; records `keep-approved` with `comparison: { a: approvedId, b: draftId }`); `restoreExemplarVersionAction(channelId, versionId): Promise<ActionResult>` (a retired version approved again; records `approve`); `copyMotionFromChannelAction(channelId, sourceChannelId): Promise<ActionResult & { note?: string }>` (refuses the same channel and an unknown one; `updateChannelSettings(db, channelId, { motion: source.settings.motion })`, then `copyMotionFromChannel`; the note "Copied the identity, N references and M exemplars"); `latestDerivationAction(channelId): Promise<ActionResult & { derivation?: DerivationView }>` for the tab's poll. Every action ends with `revalidatePath('/c/[slug]', 'layout')`.
- Produces, `visuals-actions.ts`: after the event is sent, when `current.data.type` is `graphic` or `chart`, `recordVerdict(db, { channelId: (await channelForProject(db, projectId)).channelId, kind: 'redesign', slotId, steer: steer ?? null })`; a failure to write the row is logged, never surfaced (the redesign has been sent).
- Produces, `motion-estimates.ts`: `DERIVE_TOKENS = { storyboard: { in: 6000, out: 2500 }, build: { in: 9000, out: 12000 }, critic: { in: 14000, out: 1500 }, pairwise: { in: 5000, out: 200 }, fix: { in: 12000, out: 12000 }, verify: { in: 14000, out: 1500 } }`; `DerivationEstimateTable { perTechniqueFixed: number; perRound: number; perPairwise: number }`; `derivationEstimateTable(settings, workspace): DerivationEstimateTable` (fixed: storyboard, build and verify on the graphics route; per round: critic on the critic route plus fix on graphics; pairwise on the critic route); `derivationEstimateUsd(table, input: { techniques: number; rounds: number }): number` (pure: `techniques × (fixed + rounds × perRound + (rounds − 1) × perPairwise)`), so the dialogue recomputes as the owner ticks and chooses.

- [ ] **Step 1: Write the failing tests**

`exemplar-actions.test.ts` (mock `@/lib/db`, `@boom-busters/db`, `@/inngest/client` as `motion-actions.test.ts` does): "launches a derivation with the techniques, rounds and cap, and sends the event"; "refuses a launch while a derivation runs"; "refines the approved version with the steer and records the steer verdict"; "approves a draft with a parent as a preference over it"; "keeps the approved one and retires the draft"; "restores a retired version"; "copies the identity, the references and the exemplars from another channel"; "refuses to copy into a channel with references" (the db function's `ValidationError` becomes the action's error).
`visuals-actions.test.ts`: "a redesign on a graphic slot records a redesign verdict with its steer".
`motion-estimates.test.ts`: "a derivation's estimate grows with techniques and rounds on the two routes"; "one round asks no pairwise".

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run exemplar-actions visuals-actions motion-estimates`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm exec vitest run exemplar-actions visuals-actions motion-estimates`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/c/[slug]/settings/exemplar-actions.ts" "apps/web/app/(console)/c/[slug]/settings/exemplar-actions.test.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.ts" "apps/web/app/(console)/projects/[id]/visuals-actions.test.ts" apps/web/lib/motion-estimates.ts apps/web/lib/motion-estimates.test.ts
git commit -m "feat(web): derive, refine, approve, keep, restore and copy actions, the verdict ledger written, the derivation estimate"
```

---

### Task 8: The Exemplars tab per channel and the Motion tab's Derive and Copy

**Files:**
- Create: `apps/web/lib/exemplar-channel-views.ts` (server-only: `channelExemplarViews(db, channelId, brand): Promise<ChannelExemplarView[]>`)
- Create: `apps/web/app/(console)/c/[slug]/settings/derive-dialog.tsx`, `apps/web/app/(console)/c/[slug]/settings/derive-section.tsx`, `apps/web/app/(console)/c/[slug]/settings/copy-motion.tsx`, `apps/web/app/(console)/c/[slug]/settings/exemplar-versions.tsx` (the side by side and the Versions list)
- Modify: `apps/web/app/(console)/c/[slug]/settings/exemplars-tab.tsx`, `motion-tab.tsx`, `settings-form.tsx`, `page.tsx`
- Modify: every test that renders `SettingsForm` (`vi.mock('./exemplar-actions', …)`): `voice-tab.test.tsx` and the others `grep -l "SettingsForm" apps/web/app/\(console\)/c/\[slug\]/settings/*.test.tsx` lists
- Test: `exemplars-tab.test.tsx`, `derive-dialog.test.tsx`, `derive-section.test.tsx`, `copy-motion.test.tsx`, `exemplar-versions.test.tsx`, `apps/web/lib/exemplar-channel-views.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 7; `GraphicPlayback` (`code`, `data`, `brand`, `durationMs`); `Dialog`, `ConfirmButton`, `useToast`; `ExemplarView` (the house views, unchanged); `DerivationProgress`.
- Produces, `exemplar-channel-views.ts`: `ChannelExemplarVersionView { id; version; status; parentId; steer; concept; storyboard; mechanisms; scores: Record<CriticAxis, { score; line }> | null; verdict: 'ready' | 'one-more-pass' | null; metrics: MotionMetrics | null; code: GraphicCode; data?: GraphicCodePayload['data']; createdAt: string; approvedAt: string | null; copiedFrom: string | null }`, `ChannelExemplarView { technique; approved: ChannelExemplarVersionView | null; pendingDraft: ChannelExemplarVersionView | null (the newest draft, with its parent as `pendingDraft.parentId`); versions: ChannelExemplarVersionView[] (newest first) }`; the stored `code` plays as is (`compiled` carries the channel preamble).
- Produces, `exemplars-tab.tsx`: props gain `channel: readonly ChannelExemplarView[]`, `channelId`, `archived`, `jobRunning: boolean`; each card shows the approved version's player and concept, "Approved vN, derived <date>" or "House exemplar" with the house player as today, the critic's last scores as "Engagement 8 · Intent 9 · …" with "Show review" (the lines, as the board), a steer textarea (`#refine-<technique>`, 500) with "Refine", "Derive this one" (opens the dialogue with that technique ticked), "Versions" (toggles the list: version, status, date, steer, "Restore" on a retired one); when `pendingDraft` exists, the side by side above the buttons: two players (the draft left, its parent or the approved right; "New" and "Approved" headings; both orientations through the player's own switch), the two concept lines, the critic's one line per axis for each, and the buttons "Approve this", "Keep the approved one", "Refine again" (focuses the steer). A draft with no parent (the first derivation) shows one player with "Approve this" and "Versions".
- Produces, `derive-dialog.tsx`: `DeriveDialog({ channelId, techniques: TechniqueOption[], defaults: Technique[], lastRun: { technique; costUsd }[] | null, estimate: (techniques: number, rounds: number) => number, storageReady, onClose, onLaunched })`: a checkbox per technique (ticked by default when in `defaults`; `kinetic-word-stack` and `bar-chart` are listed too, so a derivation can rebuild a last-resort technique), a rounds select 1 to 5 default 2 with the words "one round gives a correct exemplar, two a tuned one, three a polished one", a cap input (`#derive-cap`, required, a number; above 20 the line "Above $20. It still runs." in `--color-danger`), the estimate line "About $X for N techniques at R rounds" and, with a last run, "Last run: technique $Y, …", the storage line "Without R2 the critic sees no frames; each technique is stored unreviewed" when `!storageReady`, "Start deriving" (disabled until a cap is typed), "Cancel".
- Produces, `derive-section.tsx`: `DeriveSection({ channelId, derivation: DerivationView | null, jobRunning, techniques, defaults, lastRun, estimate, storageReady })`: "Derive exemplars" opens the dialogue; the latest derivation as a list, one row per technique: the name, the state in words ("waiting", "running", "ready for your review", "the critic wants one more pass", "stored without frames", "refused: …", "stopped at cap: …", "failed: …"), the cost; the total and the state ("running", "done", "stopped at the cap", "failed: …"); polls `latestDerivationAction` every 5 s while running (the References section's pattern).
- Produces, `copy-motion.tsx`: `CopyMotion({ channelId, sources: { id; name; archived }[], disabled, onCopied })`: a select of the other channels and a `ConfirmButton` "Copy motion from this channel" with the consequence "Replaces this channel's identity, adds the references and the approved exemplars"; the note toasted.
- Produces, `page.tsx`: loads `channelExemplarViews`, `latestDerivation` and `runningDerivation` (the `jobRunning` boolean is a running derivation; a refine is short, and its draft's arrival is what the poll sees), and `derivationEstimateTable(settings, workspace.settings)` passed as `estimateTable`; the dialogue multiplies with `derivationEstimateUsd`.
- Produces, `settings-form.tsx`: the new props threaded to the two tabs; the Motion tab gets `DeriveSection` after References and `CopyMotion` after it. After Refine the Exemplars tab calls `router.refresh()` every 5 s until a draft newer than the click appears or five minutes pass, with the steer's button reading "Refining" meanwhile.

- [ ] **Step 1: Write the failing tests**

`exemplar-channel-views.test.ts`: "builds one view per manifest technique with the approved, the pending draft and the versions newest first".
`exemplars-tab.test.tsx`: "shows the house exemplar when the channel has no version"; "shows the approved version's player, scores and Refine"; "shows the critic's scores on a kept design" is plan 3's; here: "shows the side by side with Approve this, Keep the approved one and Refine again when a draft has a parent"; "approves this version and retires the one approved now" (the action called with the draft's id, the toast); "lists the versions behind Versions with Restore on a retired one"; "disables Refine and Derive while a job runs".
`derive-dialog.test.tsx`: "ticks the techniques with no approved version by default"; "needs a cap and says in red above $20 while still allowing it"; "shows the estimate and the last run's cost per technique"; "launches with the ticked techniques, the rounds and the cap".
`derive-section.test.tsx`: "shows the latest derivation per technique in words with the cost and the state".
`copy-motion.test.tsx`: "copies from the chosen channel after a confirm and toasts the note"; "refuses to copy into a channel with references" (the action's error toasted).
The SettingsForm-rendering tests: each gains the `./exemplar-actions` mock; run them to see they still pass.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run exemplars-tab derive-dialog derive-section copy-motion exemplar-versions exemplar-channel-views`
Expected: FAIL.

- [ ] **Step 3: Implement**

As the Interfaces block says. Copy: "Approved v2, derived 4 Nov 2026"; "Reviewed by the critic: ready" / "the critic wants one more pass"; the steer textarea's label "Refine with a steer (plain words, 500 characters)".

- [ ] **Step 4: Run the settings tests**

Run: `cd apps/web && pnpm exec vitest run "settings/"` then `pnpm exec vitest run`
Expected: PASS, the whole web suite green (`point-studio-model` may need a run alone: leftover state, memory note).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/c/[slug]/settings" apps/web/lib/exemplar-channel-views.ts apps/web/lib/exemplar-channel-views.test.ts
git commit -m "feat(web): the Exemplars tab per channel with the side by side and Versions, Derive and Copy motion on the Motion tab"
```

---

### Task 9: End to end in mock mode, the docs and the decision

**Files:**
- Create: `e2e/tests/settings-derivation.spec.ts`
- Modify: `docs/motion-references.md` ("What the tool does with them": the derivation, the versions, the refine, the copy, in four sentences) and `apps/web/lib/motion-guideline.ts` (the same, re-embedded; the memory note: a phrase a test asserts sits whole on one line)
- Modify: `PROGRESS.md` (plan 4 ticked with the branch and decision 398; decision 398 appended; a "Next" line naming channel-only techniques as plan 5)
- Test: the e2e spec; `apps/web/lib/motion-guideline.test.ts` (one case)

- [ ] **Step 1: Write the failing e2e test**

`settings-derivation.spec.ts`, `test.describe('Derivation')`: "derives one technique in mock mode, approves it, refines it, keeps the approved one, and restores" (Motion tab → Derive exemplars → untick all but Stat counter → cap 5 → Start deriving → the Derive section's row reads "ready for your review" (poll) → Exemplars tab → the Stat counter card shows "Approve this" → click → "Approved v1" → steer "slower" → Refine → the side by side appears (poll) → "Keep the approved one" → "Approved v1" stays → Versions → v2 retired → Restore on v2 → "Approved v2"); "copies motion to the second channel" (the second seeded channel: Motion tab → Copy motion from this channel → confirm → the toast "Copied the identity, 0 references and 1 exemplars" → Exemplars tab shows "Approved v1" on Stat counter).

- [ ] **Step 2: Run it to verify it fails**

Run: `cd e2e && pnpm exec playwright test settings-derivation` (the memory note: scope from the e2e package; free port 3100 after an interrupted run)
Expected: FAIL on the first missing button.

- [ ] **Step 3: Make it pass**

Whatever the previous tasks left out of the mock flow (ids, labels, the poll). Then the docs and PROGRESS.

- [ ] **Step 4: Run the suites**

Run: `cd e2e && pnpm exec playwright test settings-derivation settings-motion settings-exemplars`; `cd apps/web && pnpm exec vitest run motion-guideline`; `pnpm typecheck`; `pnpm lint`; Prettier on the tracked changed files (memory note).
Expected: PASS; typecheck and lint clean; Prettier clean.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/settings-derivation.spec.ts docs/motion-references.md apps/web/lib/motion-guideline.ts apps/web/lib/motion-guideline.test.ts PROGRESS.md
git commit -m "docs: decision 398, derivation per channel, refine, versions and copy; the mock flow end to end"
```

---

## Verification (whole branch, before the final review)

- `pnpm --filter @boom-busters/schemas test`, `@boom-busters/providers`, `@boom-busters/cost`, `@boom-busters/db` (Docker up, one DB suite at a time), `apps/web` (`GRAPHIC_FRAMES=off`), the e2e specs for settings-derivation, settings-motion, settings-exemplars and visual-board (the board test "a post card needs a date…" fails on master before this branch; name it, do not fix it here).
- `pnpm typecheck`, `pnpm lint`, Prettier on the tracked changed files.
- The drizzle journal: `0048` is the only new entry, after `0047_nifty_roulette`; compare against `origin/master` at merge.
- Nothing in `packages/providers` or `apps/web/lib` names a channel, a niche word or a taste number.
- After deploy, the owner's actions: PUT `/api/inngest` (two new functions); on the first channel derive one technique twice, once on each critic route, and compare before the pack runs (spec 12.2); note the measured cost per technique in the Derive dialogue's "Last run" for the next PROGRESS note.
