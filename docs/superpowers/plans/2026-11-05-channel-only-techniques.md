# Channel-only techniques. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A derivation can propose one technique of the channel's own from its mechanism references (a key, a name, a one-line description, the steer phrases that reach it, the mechanisms it is built on and a synthetic slot), derive it through the same loop as a catalogue technique, store it as a channel exemplar under the new key, and on approval add the key to the channel's techniques in use so a steer that says one of its phrases gets that exemplar on the board; the global catalogue does not change.

**Architecture:** The technique key is widened from the `TECHNIQUES` enum to a validated string (`TechniqueKeySchema`) wherever a channel's own key can flow: the identity's `techniques`, the exemplar rows, the derivation's progress and request, the designer's `Exemplar`, and `techniqueFor`'s return. The proposal itself (`TechniqueProposal`) is stored on every version of the channel-only technique (`channel_exemplars.proposal`, migration 0049), so the deriver, the refiner and the Exemplars tab read the entry from the row where a catalogue technique reads it from `MANIFEST`. One new prompt on the graphics route (`technique-proposal.ts`) answers "a technique, or none" from the mechanism references' readings and the catalogue; the deriver runs it as one step before its loop when the Derive dialogue's "Propose a technique" is ticked, and appends the proposed key to the techniques it derives. `techniqueFor` tries the channel's phrases after the house list with the same negation rule; the house list is never shadowed, because the proposal's parse refuses a phrase the house list already claims.

**Tech Stack:** TypeScript, Zod 4, drizzle (migration 0049), Inngest with `@inngest/test`, Next.js server actions, React Testing Library, Playwright, the lift snapshot fixtures in `packages/providers`.

**Spec:** `docs/superpowers/specs/2026-11-04-channel-motion-references-design.md`, section 8.5 second paragraph, with 8.3 (first match in use wins; steer-only techniques), 9.2 (the loop the proposal runs through), 11 (the Motion and Exemplars tabs) and 13 ("A channel-only technique is reached by steer phrase only, like the five steer-only house techniques"; "Mechanisms are a fixed global list a design names"). This is plan 5 of the design; plan 4 (decision 398) built the derivation it extends and named this plan as the follow-up.

## Calls the author made (check while reading)

- **The proposal is part of a derivation, not a button of its own.** The spec says the derivation "may lead" to a proposal. The Derive dialogue gains a tick, "Propose a technique from the mechanism references", shown only when the channel has a live, read, non-negative mechanism reference, unticked by default (a paid call the owner opts into). Ticked, the deriver runs one `propose` step before its loop; a proposal becomes one more technique in the same run, under the same cap and rounds. A derivation may be launched with the tick alone and no technique ticked.
- **One proposal per derivation, at most.** The answer is one technique or none ("every move the references carry is covered by a technique in use", with the reason). A channel can hold several channel-only techniques, from several runs.
- **The key is the model's**, validated: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, 3 to 40 characters, not a house key, not a key the channel already holds (a new version of an existing channel-only technique is derived by ticking it in the dialogue, not by proposing it again). Refused keys and phrases are refused answers: retried once with the reason, then the proposal fails with it and the rest of the run continues.
- **Steer phrases are two to four words** of letters, digits and spaces, one to four of them per technique, so an ordinary instruction never picks a technique (the house list's own rule). A phrase the house list claims ("word stack", "pie") is refused at parse time, so `techniqueFor` can try the channel's phrases after the house list and nothing is shadowed in either direction. Matching is whole-word, case-insensitive, hyphen or space between the words, with the house negation rule ("no ledger wipe" leaves the slot to the rules).
- **A channel-only technique is a graphic technique.** No chart kind, no `data`: the mechanism grammar the references carry is graphic, and the chart conventions stay with the catalogue. Its synthetic slot is 3 to 12 seconds with 1 to 80 words on the clock, in order, inside the slot.
- **In use follows approval.** On approve (and restore) of a channel-only version the key is added to `settings.motion.techniques`; on keep (retire) when no approved version of that key remains, it is removed. The owner may also untick it on the Motion tab, which stops its phrase matching without touching the rows. `techniqueFor` honours a channel phrase only while the key is in use and an approved version exists.
- **The identity draft keeps the channel's keys.** "Draft motion identity" chooses from the catalogue; its parse appends the channel-only keys currently in use, so a draft never drops a technique the owner approved.
- **The designer is shown the channel's approved version, or nothing.** For a catalogue technique the loop pins the house design (plan 4). A channel-only technique has no house design: a second derivation or a refine pins the approved version of that key when one exists, else the designer gets no exemplar block and builds from the plan. Mock mode stores the house `kinetic-word-stack` design under the new key, checked against the plan's slot, as it stores the technique's own house design for a catalogue technique.
- **Everything that carries a technique key stays text.** `channel_exemplars.technique`, `motion_derivations.techniques` and `progress` already hold text; no row changes shape. The new columns are `channel_exemplars.proposal` (jsonb, null for a catalogue technique), `motion_derivations.propose` (boolean, default false) and `motion_derivations.proposal` (jsonb, the propose step's outcome, null until it ran).
- **Copy carries the proposal with the row**, and the target's `techniques` come from the source's identity as plan 4 copies it, so a copied channel-only technique is in use on the target at once.
- **The Exemplars tab lists channel-only techniques after the catalogue**, in key order, each a card with the channel's versions, the proposal's description, the reference it came from and the phrases that reach it, and no house example. The "N of M examples written" line counts the catalogue only.
- **Migration number** 0049, after `0048_nasty_glorian`; the executor checks the journal against `origin/master` at merge (the memory note on colliding numbers). The PROGRESS decision number is 410 unless master has moved past it.

## Global Constraints

- Paid calls run only on the owner's word: the proposal runs inside a derivation the owner launched with the tick, under the cap they typed. Mock mode (`mockProvidersEnabled()`) spends nothing and runs no browser, and the whole flow still completes on fixtures.
- Images go to the storyboard and the proposal never (spec 3): `buildTechniqueProposalRequest` takes readings as text.
- Vercel's 300 s stands: the proposal is one call in one step with the storyboard's budget.
- Limits, verbatim: a key of 3 to 40 characters on `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`; a name of at most 40 characters, a description of at most 160; one to four steer phrases of two to four words each, 3 to 40 characters; one to six mechanisms from `MECHANISM_KEYS`; a slot of 3000 to 12000 ms with 1 to `PLAN_WORDS_MAX` words; the "why" at most 600 characters.
- The house catalogue is read-only: `TECHNIQUES`, `MANIFEST`, `DESIGNS`, `LAST_RESORT_TECHNIQUES` and the house steer list do not change. `kinetic-word-stack` and `bar-chart` stay always in use.
- An approved version is never edited in place; adding or removing the key in `techniques` is a settings write, not a row write.
- No channel name, niche word or taste number in code (spec 3).
- CLAUDE.md: a branch (`channel-techniques`), tests with the code, `pnpm lint` and Prettier at zero warnings before every commit, PROGRESS.md decision at the end, no secrets, button-first UI.
- Written output in prompts and UI copy carries no em or en dash (the prompt test "writes no dash a reader would see").
- `'use server'` modules export only async functions; every test that renders `SettingsForm` keeps mocking `./exemplar-actions` and `./motion-actions`.
- The web tests run with `GRAPHIC_FRAMES=off`; the DB suites run one at a time; `pnpm exec vitest run <basename>` from the package directory.

## Review Focus

1. A proposal whose key or phrase collides (a house key, a key the channel holds, a phrase like "word stack" the house list claims): refused, retried once with the reason, then the derivation's proposal outcome is "failed" with that reason and the ticked techniques still run (Task 3 test "refuses a house key, a held key and a phrase the house list claims"; Task 5 test "fails the proposal after one retry and still derives the ticked techniques").
2. A steer that says a channel phrase on a channel where the key was unticked, or whose only version was retired: the rules choose, not the phrase, and the board design still gets a house exemplar (Task 3 test "a channel phrase wins only when the key is in use"; Task 4 test "channelTechniquesFor lists only approved keys in use").
3. "Draft motion identity" on a channel with a channel-only technique in use: the applied draft still lists the key (Task 3 test "keeps the channel's own keys the catalogue does not name"; Task 6 test "the draft keeps a channel-only technique in use").
4. Keep the approved one on a channel-only draft whose technique has no approved version: the key is not in use afterwards and the card still shows the versions (Task 2 test "syncs the key out of use when nothing is approved"; Task 6 test "keep on a channel-only draft takes the key out of use").
5. Copy into a channel from a source with a channel-only technique: the target's rows carry the proposal and the target's identity lists the key (Task 2 test "copies a channel-only technique with its proposal"; Task 8 e2e "copy carries the channel-only technique").

---

### Task 1: The key, the proposal and the schemas that carry a key

**Files:**
- Create: `packages/schemas/src/channel-techniques.ts`
- Modify: `packages/schemas/src/motion-identity.ts` (`techniques` widened)
- Modify: `packages/schemas/src/channel-exemplars.ts` (`TechniqueProgressSchema.technique`, `DeriveRequestSchema`)
- Modify: `packages/schemas/src/index.ts` (export the new module)
- Test: `packages/schemas/src/channel-techniques.test.ts`, `packages/schemas/src/motion-identity.test.ts` (one case), `packages/schemas/src/channel-exemplars.test.ts` (two cases)

**Interfaces:**
- Produces, in `channel-techniques.ts`: `TECHNIQUE_KEY_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`, `TECHNIQUE_KEY_MIN = 3`, `TECHNIQUE_KEY_MAX = 40`; `TechniqueKeySchema = z.string().min(TECHNIQUE_KEY_MIN).max(TECHNIQUE_KEY_MAX).regex(TECHNIQUE_KEY_PATTERN)`, `type TechniqueKey = string`; `isHouseTechnique(key: string): key is Technique`; `ChannelTechniqueKeySchema = TechniqueKeySchema.refine((key) => !isHouseTechnique(key), 'a house technique')`; `STEER_PHRASE_WORDS_MIN = 2`, `STEER_PHRASE_WORDS_MAX = 4`, `STEER_PHRASES_MAX = 4`, `SteerPhraseSchema = z.string().trim().toLowerCase().min(3).max(40).regex(/^[a-z0-9]+(?: [a-z0-9]+){1,3}$/)` (two to four words of letters and digits, single spaces); `PROPOSAL_NAME_MAX = 40`, `PROPOSAL_DESCRIPTION_MAX = 160`, `PROPOSAL_WHY_MAX = 600`, `PROPOSAL_SLOT_MIN_MS = 3000`, `PROPOSAL_SLOT_MAX_MS = 12000`; `TechniqueProposalSchema = z.object({ key: ChannelTechniqueKeySchema, name: z.string().trim().min(1).max(PROPOSAL_NAME_MAX), description: z.string().trim().min(1).max(PROPOSAL_DESCRIPTION_MAX), steerPhrases: z.array(SteerPhraseSchema).min(1).max(STEER_PHRASES_MAX), mechanisms: z.array(MechanismSchema).min(1).max(MECHANISMS_PER_DESIGN_MAX), slot: z.object({ durationMs: z.number().int().min(PROPOSAL_SLOT_MIN_MS).max(PROPOSAL_SLOT_MAX_MS), words: z.array(z.object({ text: z.string().trim().min(1), atMs: z.number().int().min(0) })).min(1).max(PLAN_WORDS_MAX), intent: z.string().trim().min(1).max(PLAN_INTENT_MAX) }), fromReference: z.string().trim().min(1).max(120) })` with a `superRefine` that refuses a word at or past `durationMs` ("a word sits past the slot's end") and words out of order ("the words are not in order on the clock"), and dedupes nothing (two equal phrases are refused: "a phrase is named twice"); `TechniqueProposal`; `TechniqueProposalAnswerSchema = z.object({ proposal: TechniqueProposalSchema.nullable(), why: z.string().trim().min(1).max(PROPOSAL_WHY_MAX) })`, `TechniqueProposalAnswer`; `PROPOSAL_STATES = ['none', 'proposed', 'failed', 'stopped-at-cap'] as const`, `DerivationProposalSchema = z.object({ state: z.enum(PROPOSAL_STATES), technique: TechniqueKeySchema.nullable(), reason: z.string().max(500).nullable() })`, `DerivationProposal`; `ChannelTechniqueSchema = z.object({ technique: ChannelTechniqueKeySchema, description: z.string(), steerPhrases: z.array(SteerPhraseSchema).min(1).max(STEER_PHRASES_MAX) })`, `ChannelTechnique` (what `techniqueFor` and the Motion tab read of a channel-only technique).
- Produces, in `motion-identity.ts`: `techniques: z.array(TechniqueKeySchema).default([...TECHNIQUES])` (the last-resort refinement unchanged); `MotionIdentity['techniques']` is now `string[]`.
- Produces, in `channel-exemplars.ts`: `TechniqueProgressSchema.technique: TechniqueKeySchema`; `DeriveRequestSchema = z.object({ techniques: z.array(TechniqueKeySchema), rounds: ..., capUsd: ..., propose: z.boolean().default(false) }).refine((r) => r.techniques.length > 0 || r.propose, 'tick a technique or the proposal')`.

- [ ] **Step 1: Write the failing tests**

`channel-techniques.test.ts`:

```ts
describe('TechniqueKeySchema and the proposal (spec 2026-11-04, section 8.5)', () => {
  it('accepts a kebab key of 3 to 40 characters and refuses the rest', () => {
    // 'ledger-wipe' ok; 'LedgerWipe', 'wipe', '-wipe', 'a'.repeat(41) refused
  })
  it('isHouseTechnique knows the catalogue and ChannelTechniqueKeySchema refuses it', () => {
    // isHouseTechnique('stat-counter') true, 'ledger-wipe' false; ChannelTechniqueKeySchema refuses 'stat-counter'
  })
  it('a steer phrase is two to four plain words, lower-cased', () => {
    // 'Ledger Wipe' → 'ledger wipe'; 'wipe' refused; 'the ledger wipes across all' (5 words) refused; 'ledger-wipe' refused
  })
  it('a proposal holds its slot on the clock and names at least one mechanism', () => {
    // a full proposal parses; atMs 6000 in a 6000 ms slot refused with "a word sits past the slot's end";
    // words out of order refused; mechanisms [] refused; steerPhrases ['ledger wipe', 'ledger wipe'] refused; durationMs 2000 refused
  })
  it('the answer is a proposal or null with a why', () => {
    // { proposal: null, why: 'covered' } ok; { proposal: null } refused; why of 601 refused
  })
})
```

`motion-identity.test.ts`, one case: "techniques accept a channel's own key beside the catalogue": `MotionIdentitySchema.parse({ techniques: [...TECHNIQUES, 'ledger-wipe'] })` keeps the key; `'Ledger Wipe'` refused; the last-resort rule still refuses a list without `bar-chart`.

`channel-exemplars.test.ts`, two cases: "a progress entry carries a channel-only key" and "a derive request may tick the proposal alone": `DeriveRequestSchema.parse({ techniques: [], rounds: 2, capUsd: 5, propose: true })` ok; `{ techniques: [], rounds: 2, capUsd: 5 }` refused; `propose` defaults to false.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/schemas && pnpm exec vitest run channel-techniques motion-identity channel-exemplars`
Expected: FAIL, `channel-techniques` on a missing module, the other two on the enum refusing the key and the request refusing an empty list.

- [ ] **Step 3: Implement the module and the two widenings**

`channel-techniques.ts` as the Interfaces block; `isHouseTechnique` is `(TECHNIQUES as readonly string[]).includes(key)`. `motion-identity.ts` and `channel-exemplars.ts` import from it. Export from `index.ts` after `./techniques`.

- [ ] **Step 4: Run the package suite**

Run: `cd packages/schemas && pnpm exec vitest run`
Expected: PASS, every file.

- [ ] **Step 5: Typecheck the consumers, then commit**

Run: `pnpm typecheck`
Expected: PASS; where `MotionIdentity['techniques']` was read as `Technique[]` (`graphic-design-core.ts:247`, `motion-tab.tsx`, `prompts/motion.ts`), note the errors for Tasks 3, 4 and 7 rather than fixing them here if they are only type widenings; if any blocks the commit, cast at the call site with a `// plan 5: widened in Task N` comment that the later task removes.

```bash
git add packages/schemas
git commit -m "feat(schemas): the technique key, the technique proposal and the keys a channel's own technique flows through"
```

---

### Task 2: The rows: the proposal column, the derivation's tick and outcome, in use follows approval

**Files:**
- Modify: `packages/db/src/schema.ts` (`channelExemplars.proposal`, `motionDerivations.propose`, `motionDerivations.proposal`; the `Technique` types on these tables become `TechniqueKey`)
- Create: `packages/db/drizzle/0049_<name>.sql` (generated with `pnpm --filter @boom-busters/db db:generate`, the journal checked)
- Modify: `packages/db/src/channel-exemplars.ts` (`insertExemplarVersion.proposal`, copy carries it, `syncChannelTechniqueInUse`, `channelTechniquesFor`)
- Modify: `packages/db/src/motion-derivations.ts` (`createDerivation.propose`, `setDerivationProposal`, `appendTechniqueProgress`)
- Test: `packages/db/src/channel-exemplars.test.ts` (four cases), `packages/db/src/motion-derivations.test.ts` (two cases)

**Interfaces:**
- Consumes: `TechniqueProposal`, `DerivationProposal`, `ChannelTechnique`, `TechniqueKey`, `isHouseTechnique` from Task 1; `getChannelSettings`, `updateChannelSettings` from `channels.ts`.
- Produces: `channelExemplars.proposal: jsonb('proposal').$type<TechniqueProposal>()` (nullable); `motionDerivations.propose: boolean('propose').notNull().default(false)`, `motionDerivations.proposal: jsonb('proposal').$type<DerivationProposal>()` (nullable); `insertExemplarVersion(db, { ..., proposal?: TechniqueProposal | null })`; `copyMotionFromChannel` writes `proposal: row.proposal` on each copied version; `syncChannelTechniqueInUse(db, channelId, technique: TechniqueKey): Promise<'added' | 'removed' | 'unchanged'>` (a house key is always `'unchanged'`; a channel key is in `settings.motion.techniques` after the call iff an approved version of it exists, written through `updateChannelSettings(db, channelId, { motion: { ...motion, techniques } })`); `channelTechniquesFor(db, channelId): Promise<ChannelTechnique[]>` (the approved versions whose `technique` is not a house key and whose `proposal` is not null, as `{ technique, description: proposal.description, steerPhrases: proposal.steerPhrases }`, key order; the caller filters by in use); `createDerivation(db, { channelId, techniques: TechniqueKey[], rounds, capUsd, propose?: boolean })`; `setDerivationProposal(db, id, proposal: DerivationProposal): Promise<void>`; `appendTechniqueProgress(db, id, technique: TechniqueKey): Promise<void>` (adds a `pending` entry when none has that technique, FOR UPDATE as `updateTechniqueProgress`).

- [ ] **Step 1: Write the failing tests**

`channel-exemplars.test.ts`, in the existing `describeDb`:

```ts
it('stores a proposal on a version and lists it as a channel technique', async () => {
  // insertExemplarVersion with technique 'ledger-wipe' and a proposal (steerPhrases ['ledger wipe']) → row.proposal equals it;
  // channelTechniquesFor is [] while the version is a draft; after approveExemplarVersion it is
  // [{ technique: 'ledger-wipe', description, steerPhrases: ['ledger wipe'] }]
})
it('syncs the key into use on approval and out of use when nothing is approved', async () => {
  // before: settings.motion.techniques lacks 'ledger-wipe'; sync after approve → 'added' and the key is listed;
  // sync again → 'unchanged'; retireExemplarVersion then sync → 'removed' and the key is gone;
  // sync for 'stat-counter' → 'unchanged' whatever the rows
})
it('copies a channel-only technique with its proposal', async () => {
  // source: approved 'ledger-wipe' with a proposal; copyMotionFromChannel → the target's approved row carries the same proposal
})
```

`motion-derivations.test.ts`:

```ts
it('records the tick and the proposal outcome', async () => {
  // createDerivation({ ..., techniques: [], rounds: 1, capUsd: 1, propose: true }) → row.propose true, row.proposal null, progress [];
  // setDerivationProposal(db, id, { state: 'proposed', technique: 'ledger-wipe', reason: null }) → getDerivation shows it
})
it('appends a technique to the progress once', async () => {
  // appendTechniqueProgress twice with 'ledger-wipe' → one pending entry; updateTechniqueProgress on it still works
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/db && pnpm exec vitest run channel-exemplars motion-derivations`
Expected: FAIL on the missing column and the missing exports.

- [ ] **Step 3: Add the columns, generate the migration**

Run: `pnpm --filter @boom-busters/db db:generate` after editing `schema.ts`.
Expected: one new file `0049_*.sql` with three `ALTER TABLE ... ADD COLUMN` lines and one journal entry at idx 49. Then `pnpm db:migrate:test` (Docker Desktop running).

- [ ] **Step 4: Implement the functions**

`syncChannelTechniqueInUse` reads the settings, computes `techniques` with the key added or removed, and writes only when the list changed. `channelTechniquesFor` is one select on `status = 'approved'` with `proposal is not null`, filtered by `!isHouseTechnique` in code.

- [ ] **Step 5: Run the db suite alone, then typecheck**

Run: `cd packages/db && pnpm exec vitest run` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): the proposal on a version, the derivation's propose tick and outcome, a channel technique in use follows its approval (migration 0049)"
```

---

### Task 3: The providers: channel phrases in `techniqueFor`, the proposal prompt, the entry a proposal makes

**Files:**
- Modify: `packages/providers/src/exemplars/technique.ts` (`channelTechniques`, `claimedBySteer`, return type)
- Create: `packages/providers/src/exemplars/channel-technique.ts` (`TechniqueEntry`, `entryFromProposal`)
- Modify: `packages/providers/src/exemplars/index.ts` (`Exemplar.technique: TechniqueKey`; exports)
- Create: `packages/providers/src/prompts/technique-proposal.ts`
- Modify: `packages/providers/src/prompts/storyboard.ts` (`StoryboardInput.entry` and `mockStoryboardPlan` typed on `TechniqueEntry`)
- Modify: `packages/providers/src/prompts/motion.ts` (`parseMotionIdentityDraft(text, keep?)`)
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts` (case `graphics-technique-proposal`, beside `graphics-storyboard`)
- Modify: `packages/providers/src/index.ts` (exports)
- Test: `packages/providers/src/exemplars/technique.test.ts` (three cases), `packages/providers/src/prompts/technique-proposal.test.ts`, `packages/providers/src/prompts/motion.test.ts` (one case), `packages/providers/src/prompts/storyboard.test.ts` (one case)

**Interfaces:**
- Consumes: `ChannelTechnique`, `TechniqueProposal`, `TechniqueProposalAnswerSchema`, `TechniqueKey`, `isHouseTechnique`, `SteerPhraseSchema`, `PROPOSAL_*` from Task 1; `ReadingForDraft` and `readingBlock`'s shape from `motion.ts` / `storyboard.ts`.
- Produces, in `technique.ts`: `TechniqueInput.channelTechniques?: readonly ChannelTechnique[]` (tried after the house steer list, in the given order and each phrase in its order, with the same negation rule; a phrase matches as whole words with one space or hyphen between them, case-insensitive); `techniqueFor(input): TechniqueKey`; `claimedBySteer(phrase: string): Technique | undefined` (the house technique the phrase would pick when written as a steer, else undefined).
- Produces, in `channel-technique.ts`: `type TechniqueEntry = Pick<ExemplarEntry, 'description' | 'mechanisms' | 'slot' | 'chart'> & { technique: TechniqueKey }` (an `ExemplarEntry` is one); `entryFromProposal(proposal: TechniqueProposal): TechniqueEntry` (`{ technique: proposal.key, description: proposal.description, mechanisms: proposal.mechanisms, slot: { durationMs, words, intent } }`, no `chart`).
- Produces, in `index.ts`: `Exemplar.technique: TechniqueKey`; `export { entryFromProposal }`, `export type { TechniqueEntry }`, `export { claimedBySteer }`.
- Produces, in `technique-proposal.ts`: `TECHNIQUE_PROPOSAL_OUTPUT_TOKENS = 1200`, `TECHNIQUE_PROPOSAL_INPUT_TOKENS = 5000`; `interface TechniqueProposalInput { motion: MotionIdentity; readings: readonly ReadingForDraft[] /* the mechanism references, read, not negative */; catalogue: readonly { technique: string; description: string; mechanisms: readonly Mechanism[] }[]; channelTechniques: readonly ChannelTechnique[]; rejection?: string }`; `buildTechniqueProposalRequest(input): LLMTaskRequest` (task `graphics`, a system prompt that says: read each mechanism reference's carry-over and reading, decide whether a move is covered by a technique in the catalogue or the channel's own; if every move is covered answer `{"proposal": null, "why": "..."}`; else propose one technique as JSON with the fields and bounds of `TechniqueProposalSchema` in words, a key in kebab case not in the catalogue, steer phrases of two to four words a producer would type that name the move and no house technique, the mechanisms from the list, a synthetic slot of 3 to 12 seconds with its words on the clock in the channel's register, and `fromReference` the title it came from; no dash characters; one user message with `motionIdentityBlock`, the style guide, the catalogue by key with descriptions and mechanisms, the channel's own techniques by key with phrases, the readings through the storyboard's `readingBlock` shape, and the rejection line when given; `maxTokens: outputBudget(TECHNIQUE_PROPOSAL_OUTPUT_TOKENS)`); `parseTechniqueProposal(text: string, taken: { keys: readonly string[] }): TechniqueProposalAnswer` (through `parseJsonCompletion` and the schema; then throws `ValidationError` with `"The key <key> is already a technique"` when `taken.keys` or the house has it, and `"The phrase \"<phrase>\" already reaches <technique>"` when `claimedBySteer` finds one); `mockTechniqueProposal(readings: readonly ReadingForDraft[]): TechniqueProposalAnswer` (the first mechanism reading that is read and not negative → `{ proposal: { key: 'mock-move', name: 'Mock move', description: '[mock] the move carried over from "<title>"', steerPhrases: ['mock move'], mechanisms: ['persistent-actor'], slot: { durationMs: 6000, words: spoken over 'The move carries the whole slot.' from 200 ms every 450 ms, intent: 'The move is the point.' }, fromReference: title }, why: '[mock] proposed from the first mechanism reference' }`; none → `{ proposal: null, why: '[mock] no mechanism reference is read' }`).
- Produces, in `motion.ts`: `parseMotionIdentityDraft(text: string, keep: readonly string[] = []): MotionIdentityDraft` (every key in `keep` that is not a house key is appended to `identity.techniques` when missing).

- [ ] **Step 1: Write the failing tests**

`technique.test.ts`, three cases in a new describe "channel-only techniques (spec 8.5)":

```ts
const ledger = { technique: 'ledger-wipe', description: 'a wipe', steerPhrases: ['ledger wipe', 'wipe the ledger'] }
it('a channel phrase in the steer picks the channel technique, hyphen or space, any case', () => {
  // guidance 'make it a Ledger-wipe here' with channelTechniques [ledger] → 'ledger-wipe'
})
it('the house list is tried first and a negated channel phrase is a refusal', () => {
  // 'a word stack, then the ledger wipe' → 'kinetic-word-stack'; 'no ledger wipe' → the rules' answer, not 'ledger-wipe'
})
it('claimedBySteer names the house technique a phrase would pick', () => {
  // claimedBySteer('word stack') === 'kinetic-word-stack'; claimedBySteer('ledger wipe') undefined; claimedBySteer('pie') === 'donut-chart'
})
```

`technique-proposal.test.ts`:

```ts
it('asks for one technique or none from the mechanism readings, with the catalogue and the channel keys', () => {
  // the request's task is 'graphics'; the user message names every catalogue key, the channel key and its phrases,
  // the reference title, and the line 'Carry over:'; it has no image
})
it('parses a proposal and a null answer', () => { /* both through parseTechniqueProposal */ })
it('refuses a house key, a held key and a phrase the house list claims', () => {
  // key 'stat-counter' → ValidationError /already a technique/; key in taken.keys → the same;
  // steerPhrases ['word stack'] → /already reaches kinetic-word-stack/
})
it('mocks a proposal from the first read mechanism reference and none without one', () => { /* mockTechniqueProposal */ })
it('writes no dash a reader would see', () => { /* the system prompt and a built message */ })
```

`motion.test.ts`, one case: "keeps the channel's own keys the catalogue does not name": a draft text whose `techniques` is the catalogue, parsed with `keep: ['ledger-wipe', 'stat-counter']` → `identity.techniques` ends with `'ledger-wipe'` once.

`storyboard.test.ts`, one case: "plans a channel-only technique from its proposal's entry": `buildStoryboardRequest` with `entry: entryFromProposal(proposal)` and `house: null` has the material say `The technique: ledger-wipe` and `No house design is stored for it.`; `mockStoryboardPlan(entryFromProposal(proposal))` keeps the slot.

- [ ] **Step 2: Run them to verify they fail**

Run: `cd packages/providers && pnpm exec vitest run technique technique-proposal motion storyboard`
Expected: FAIL on the missing exports and the unknown `channelTechniques` field.

- [ ] **Step 3: Implement `techniqueFor`'s channel phrases and `claimedBySteer`**

Factor the house steer loop into `steerMatch(guidance, patterns: readonly [RegExp, string][]): string | undefined`; build a channel pattern per phrase as `new RegExp('\\b' + words.map(escapeRegExp).join('[ -]') + '\\b', 'gi')`; `techniqueFor` tries the house list, then the channel list, then the rules. `claimedBySteer(phrase)` is `steerMatch(phrase, STEER)`.

- [ ] **Step 4: Implement the entry, the prompt, the parse, the mock and the lift case**

The lift case `graphics-technique-proposal` builds a request from a fixture input with one mechanism reading and the catalogue, as `graphics-storyboard` does.

- [ ] **Step 5: Run the providers suite, refresh the lift snapshot if the harness asks, typecheck**

Run: `cd packages/providers && pnpm exec vitest run` then `pnpm typecheck`
Expected: PASS; the type errors noted in Task 1 for `prompts/motion.ts` are gone.

- [ ] **Step 6: Commit**

```bash
git add packages/providers
git commit -m "feat(providers): a channel's steer phrases in techniqueFor, the technique proposal call, the entry a proposal makes"
```

---

### Task 4: The web library: the entry for any key, the pinned exemplar, the board's channel phrases, the estimate

**Files:**
- Create: `apps/web/lib/exemplar-entries.ts`
- Modify: `apps/web/lib/exemplar-derive.ts` (every `ExemplarEntry` parameter becomes `TechniqueEntry`)
- Modify: `apps/web/inngest/lib/exemplar-loop.ts` (`loopSlot`, `buildFromPlan` on `TechniqueEntry`; `buildFromPlan.exemplar`)
- Modify: `apps/web/lib/graphic-design-core.ts` (`slotTechnique(..., channelTechniques?)` returning `TechniqueKey`; `techniques: motion.techniques` typed on the widened identity)
- Modify: `apps/web/lib/graphic-design.ts` (`channelExemplarFor(channelId, technique: TechniqueKey)`; `designGraphic` passes the channel's techniques in use)
- Modify: `apps/web/lib/motion-estimates.ts` (`DERIVE_TOKENS.propose`, `perProposal` in the table), `apps/web/lib/derivation-estimate.ts` (`propose` in the input)
- Test: `apps/web/lib/exemplar-entries.test.ts`, `apps/web/lib/graphic-design-core.test.ts` (one case), `apps/web/lib/graphic-design.test.ts` (one case), `apps/web/lib/derivation-estimate.test.ts` (one case), `apps/web/lib/exemplar-derive.test.ts` (one case)

**Interfaces:**
- Consumes: `TechniqueEntry`, `entryFromProposal`, `exemplarFor`, `MANIFEST` (Task 3); `approvedExemplar`, `channelTechniquesFor`, `listChannelExemplars` (Task 2); `ChannelTechnique`, `isHouseTechnique` (Task 1).
- Produces, in `exemplar-entries.ts`: `techniqueEntryFor(db: Database, channelId: string, technique: TechniqueKey): Promise<TechniqueEntry | null>` (a house key → its `MANIFEST` entry; else the channel's newest version of that key with a proposal → `entryFromProposal`; else null); `pinnedExemplarFor(db, channelId, technique): Promise<Exemplar | null>` (a house key → `exemplarFor(technique) ?? null`; else the approved version as an `Exemplar` with the proposal's description, else null); `channelTechniquesInUse(db, channelId, motion: MotionIdentity): Promise<ChannelTechnique[]>` (`channelTechniquesFor` filtered to keys in `motion.techniques`).
- Produces, in `graphic-design-core.ts`: `slotTechnique(context, slot, motion, guidance?, channelTechniques?: readonly ChannelTechnique[]): TechniqueKey`; the fallback inside `designGraphicWith` (`options.exemplar === undefined`) still calls `exemplarFor` only when the key is a house one, else passes no exemplar.
- Produces, in `exemplar-loop.ts`: `buildFromPlan({ ..., exemplar?: Exemplar | null })` (given, pinned as is; absent, the house `exemplarFor(entry.technique)` for a house key, else null).
- Produces, in `graphic-design.ts`: `channelExemplarFor(channelId, technique: TechniqueKey): Promise<Exemplar | undefined>` (a channel key with no approved version → undefined; the description from the approved row's proposal); `designGraphic` reads `channelTechniquesInUse` and passes it to `slotTechnique`.
- Produces, in the estimates: `DERIVE_TOKENS.propose = { in: TECHNIQUE_PROPOSAL_INPUT_TOKENS, out: TECHNIQUE_PROPOSAL_OUTPUT_TOKENS }`; `DerivationEstimateTable.perProposal: number` (the proposal call on `graphics`); `derivationEstimateUsd(table, { techniques, rounds, propose?: boolean })` adds `perProposal` plus one more technique's cost when `propose`.

- [ ] **Step 1: Write the failing tests**

`exemplar-entries.test.ts` (DB, `describeDb`): "reads a house key from the catalogue and a channel key from its newest version" (stat-counter → the manifest entry; 'ledger-wipe' with two versions → the newer version's proposal; an unknown key → null); "pins the channel's approved version for a channel key and nothing before one" (`pinnedExemplarFor` null while the version is a draft, the `Exemplar` with `technique: 'ledger-wipe'` and the proposal's description after approval; a house key → the house exemplar); "lists only approved keys in use" (`channelTechniquesInUse` with the key approved but unticked → `[]`).

`graphic-design-core.test.ts`, one case: "a steer that says a channel phrase picks the channel technique for the slot" (`slotTechnique(context, slot, motion, 'as a ledger wipe', [ledger])` → `'ledger-wipe'`; without `channelTechniques` → a house key).

`graphic-design.test.ts`, one case (mocks as the file does): "channelExemplarFor hands the designer the channel's approved version of its own technique, and nothing before approval".

`derivation-estimate.test.ts`, one case: "adds the proposal call and one technique when the tick is on" (`derivationEstimateUsd({ perTechniqueFixed: 1, perRound: 0.5, perPairwise: 0.1, perProposal: 0.2 }, { techniques: 1, rounds: 2, propose: true })` is `0.2 + 2 * (1 + 1 + 0.1)` to four places; with `techniques: 0` and `propose: true` it is `0.2 + 2.1`).

`exemplar-derive.test.ts`, one case: "a proposal's entry derives a graphic brief with its own slot" (`derivedBrief(entryFromProposal(proposal), plan, context).type === 'graphic'`, `planBounds` has no `chart`).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run exemplar-entries graphic-design-core graphic-design derivation-estimate exemplar-derive`
Expected: FAIL on the missing module and the unknown argument.

- [ ] **Step 3: Implement**

`techniqueEntryFor` reads `listChannelExemplars` and takes the first row (newest version) with that technique and a proposal.

- [ ] **Step 4: Run the web lib suites and typecheck**

Run: `cd apps/web && pnpm exec vitest run lib` then `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib apps/web/inngest/lib
git commit -m "feat(web): the entry and the pinned exemplar for any technique key, the channel's phrases on the board, the proposal in the estimate"
```

---

### Task 5: The jobs: the propose step, the proposed technique in the loop, the refiner on a channel key

**Files:**
- Modify: `apps/web/inngest/functions/motion-exemplar-deriver.ts`
- Modify: `apps/web/inngest/functions/motion-exemplar-refiner.ts`
- Test: `apps/web/inngest/functions/motion-exemplar-deriver.test.ts` (three cases), `apps/web/inngest/functions/motion-exemplar-refiner.test.ts` (one case)

**Interfaces:**
- Consumes: `buildTechniqueProposalRequest`, `parseTechniqueProposal`, `mockTechniqueProposal`, `TECHNIQUE_PROPOSAL_OUTPUT_TOKENS`, `entryFromProposal` (Task 3); `techniqueEntryFor`, `pinnedExemplarFor` (Task 4); `setDerivationProposal`, `appendTechniqueProgress`, `channelTechniquesFor`, `insertExemplarVersion.proposal` (Task 2).
- Produces, in the deriver: a step `propose` after `load` when `derivation.propose`, returning `{ proposal: TechniqueProposal } | { none: string } | { cap: string } | { failed: string }`: cap checked first; mock → `mockTechniqueProposal(readings)`; else `callForAnswer` with `buildTechniqueProposalRequest({ motion, readings: the mechanism ones that are read and not negative, catalogue: MANIFEST as {technique, description, mechanisms}, channelTechniques: channelTechniquesFor(db, channelId) })`, `parse: (text) => parseTechniqueProposal(text, { keys: [...channel keys] })`, one retry with the reason, errors contained as the storyboard step contains them; the step writes `setDerivationProposal` (`proposed` with the key, `none`, `failed` or `stopped-at-cap` with the reason) and, when proposed, `appendTechniqueProgress`. The loop runs `derivation.techniques` then the proposed key; `deriveTechnique(step, derivation, technique, entry: TechniqueEntry, proposal: TechniqueProposal | null)` takes its entry from the caller (`techniqueEntryFor` for a ticked key, `entryFromProposal` for the proposed one) and writes `proposal` on the version it inserts; the mock build uses `DESIGNS[technique] ?? DESIGNS['kinetic-word-stack']`; the real build passes `exemplar: await pinnedExemplarFor(db, channelId, technique)`.
- Produces, in the refiner: the entry from `techniqueEntryFor(db, parent.channelId, parent.technique)` in each place `MANIFEST.find` was; the build pins `pinnedExemplarFor`; the inserted version carries `proposal: parent.proposal`.

- [ ] **Step 1: Write the failing tests**

Deriver, in the existing harness (mock mode unless said):

```ts
it('proposes a technique in mock mode, derives it under the new key and marks it in the row', async () => {
  // a read mechanism reference seeded on the first channel; createDerivation({ techniques: [], rounds: 1, capUsd: 5, propose: true });
  // after the run: row.proposal.state 'proposed' with technique 'mock-move'; progress has one entry 'mock-move' ready;
  // the version's technique is 'mock-move', its proposal.steerPhrases ['mock move'], its code title the word stack's
})
it('records none when no mechanism reference is read and still derives the ticked techniques', async () => {
  // no references; techniques ['stat-counter'], propose true → row.proposal { state: 'none', technique: null, reason: '[mock] ...' }; stat-counter ready
})
it('fails the proposal after one retry and still derives the ticked techniques', async () => {
  // real path with callLlm stubbed: the proposal call answers a house key twice → row.proposal.state 'failed', reason /already a technique/;
  // callLlm saw two proposal requests, the second carrying 'The previous proposal was refused'; stat-counter's loop then ran
})
```

Refiner, one case: "refines a channel-only version from its proposal's entry and carries the proposal forward" (parent 'ledger-wipe' approved with a proposal; the new draft has the same proposal and technique, and the build request carried the parent's design as the exemplar).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-deriver motion-exemplar-refiner`
Expected: FAIL: no `propose` step, "No catalogue entry for mock-move".

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run both suites one at a time, then the functions registry test and typecheck**

Run: `cd apps/web && pnpm exec vitest run motion-exemplar-deriver` ; `pnpm exec vitest run motion-exemplar-refiner` ; `pnpm exec vitest run functions/index` ; `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/inngest
git commit -m "feat(web): the deriver proposes a technique from the mechanism references and derives it; the refiner reads a channel key's entry from its row"
```

---

### Task 6: The actions and the views: the tick, in use on approve and keep, the draft keeps the keys, the channel-only views

**Files:**
- Modify: `apps/web/app/(console)/c/[slug]/settings/exemplar-actions.ts` (`deriveExemplarsAction` passes `propose`; `approveExemplarVersionAction`, `keepApprovedAction`, `restoreExemplarVersionAction` call `syncChannelTechniqueInUse`; `DerivationView.proposal`, `.propose`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/motion-actions.ts` (the draft's parse keeps the channel's keys)
- Modify: `apps/web/lib/exemplar-channel-views.ts` (`ChannelExemplarView.description`, `.channelOnly`, `.steerPhrases`, `.fromReference`; channel-only views appended)
- Modify: `apps/web/app/(console)/c/[slug]/settings/page.tsx` (`techniqueOptions` includes the channel-only techniques; `mechanismReferences` count; `derivation.proposal`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/settings-form.tsx` (pass-through)
- Modify: `apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx` (the `TechniqueOption` type only; its rendering is Task 7)
- Test: `exemplar-actions.test.ts` (three cases), `motion-actions.test.ts` (one case), `apps/web/lib/exemplar-channel-views.test.ts` (one case)

**Interfaces:**
- Consumes: Tasks 1, 2 and 4.
- Produces: `TechniqueOption { technique: TechniqueKey; description: string; channelOnly?: boolean; steerPhrases?: readonly string[] }` (in `motion-tab.tsx`, widened); `DerivationView.propose: boolean`, `DerivationView.proposal: DerivationProposal | null`; `ChannelExemplarView { technique: TechniqueKey; description: string; channelOnly: boolean; steerPhrases: readonly string[]; fromReference: string | null; approved; pendingDraft; versions }` (the catalogue's views first with the manifest description, then every key in the rows that is not a house key, in key order, with the newest version's proposal); `page.tsx` passes `techniqueOptions = [...MANIFEST options, ...channel-only views as options]` and `mechanismReferences: number` (live, read, not negative, purpose mechanism).

- [ ] **Step 1: Write the failing tests**

`exemplar-actions.test.ts`: "launches a derivation with the proposal ticked and no technique" (`deriveExemplarsAction(channelId, { techniques: [], rounds: 1, capUsd: 2, propose: true })` ok, the row's `propose` true); "approving a channel-only version puts its key in use" (after approve, `getChannelSettings(...).motion.techniques` has `'ledger-wipe'`; a house technique's approval leaves the list as it was); "keep on a channel-only draft takes the key out of use" (an approved 'ledger-wipe' retired by hand, a draft kept → the key is gone; with an approved one still there it stays).

`motion-actions.test.ts`, one case: "the draft keeps a channel-only technique in use" (settings with `'ledger-wipe'` in use, the mock draft applied → still listed; the real parse path is covered in Task 3, here assert the action passes `keep`: spy on `parseMotionIdentityDraft`'s second argument through the mocked providers module, or assert on the mock result, whichever the file's harness allows).

`exemplar-channel-views.test.ts`, one case: "lists a channel-only technique after the catalogue with its proposal's words" (rows for 'ledger-wipe' → the last view has `channelOnly: true`, `steerPhrases: ['ledger wipe']`, `fromReference`, `description` from the proposal; a house view has `channelOnly: false` and the manifest description).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run exemplar-actions motion-actions exemplar-channel-views`
Expected: FAIL on the unknown field and the missing view fields.

- [ ] **Step 3: Implement**

`restoreExemplarVersionAction` and `approveExemplarVersionAction` call `syncChannelTechniqueInUse(db, channelId, version.technique)` after the row write; `keepApprovedAction` after the retire.

- [ ] **Step 4: Run the three suites one at a time (two touch the DB), typecheck**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app apps/web/lib/exemplar-channel-views.ts apps/web/lib/exemplar-channel-views.test.ts
git commit -m "feat(web): the proposal tick launches, approval puts a channel technique in use, the views list the channel's own techniques"
```

---

### Task 7: The UI: the tick in the Derive dialogue, the proposal line, channel-only techniques on the Motion and Exemplars tabs

**Files:**
- Modify: `apps/web/app/(console)/c/[slug]/settings/derive-dialog.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/derive-section.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/exemplars-tab.tsx`
- Test: `derive-dialog.test.tsx` (two cases), `derive-section.test.tsx` (one case), `motion-tab.test.tsx` (one case), `exemplars-tab.test.tsx` (one case)

**Interfaces:**
- Consumes: Task 6's props; `derivationEstimateUsd` with `propose` (Task 4).
- Produces: `DeriveDialog` props gain `mechanismReferences: number`; a checkbox labelled "Propose a technique from the mechanism references" with the help line "One call reads the mechanism references and proposes a technique of this channel's own, or says every move is covered. It is derived like the others." shown only when `mechanismReferences > 0`; the estimate follows the tick; Launch is enabled with the tick alone; the request carries `propose`. `DeriveSection` shows one line above the techniques when `derivation.propose`: "Proposal: waiting" / "Proposal: <name as techniqueName> proposed" / "Proposal: none, <reason>" / "Proposal: failed, <reason>" / "Proposal: stopped at cap". `MotionTab`'s "Techniques in use" lists channel-only options after the catalogue with the label `<key>` and the help "This channel's own, reached by a steer that says: 'ledger wipe', 'wipe the ledger'." and the ordinary checkbox. `ExemplarsTab` renders one card per channel-only view after the catalogue cards: the heading `techniqueName(key)`, the line "This channel's own technique, proposed from "<fromReference>". Reach it with a steer that says: 'ledger wipe'.", no house player, the approved player or "No version is approved yet", the same Derive, Refine, Versions, Approve this and Keep the approved one buttons as a catalogue card.

- [ ] **Step 1: Write the failing tests**

`derive-dialog.test.tsx`: "offers the proposal only when a mechanism reference is read, and prices it" (with `mechanismReferences: 0` no checkbox; with 1, the checkbox, the estimate rising by `perProposal + one technique` when ticked); "launches with the proposal alone" (every technique unticked, the tick on → the action is called with `techniques: []` and `propose: true`).

`derive-section.test.tsx`: "says what the proposal did" (`propose: true` with `proposal: { state: 'proposed', technique: 'ledger-wipe', reason: null }` → text `Proposal: Ledger wipe proposed`; `state: 'none'` with a reason → `Proposal: none, <reason>`).

`motion-tab.test.tsx`: "lists a channel-only technique with its phrases and saves it unticked" (an option `{ technique: 'ledger-wipe', description, channelOnly: true, steerPhrases: ['ledger wipe'] }` renders the phrase line; unticking saves `techniques` without it).

`exemplars-tab.test.tsx`: "shows a channel-only technique's card after the catalogue with the reference and the phrase" (a channel view with `channelOnly: true` → a heading `Ledger wipe`, the text `proposed from "Ledger scene"`, the phrase, no "house" player).

- [ ] **Step 2: Run them to verify they fail**

Run: `cd apps/web && pnpm exec vitest run derive-dialog derive-section motion-tab exemplars-tab`
Expected: FAIL on missing elements.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run the settings component suites, the SettingsForm tests, Prettier and lint**

Run: `cd apps/web && pnpm exec vitest run settings` ; `pnpm lint` ; `pnpm exec prettier --check "apps/web/app/(console)/c/[slug]/settings/*.tsx"`
Expected: PASS, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(console)/c/[slug]/settings"
git commit -m "feat(web): the proposal tick and line, channel-only techniques on the Motion and Exemplars tabs"
```

---

### Task 8: The e2e, the guideline, PROGRESS

**Files:**
- Modify: `e2e/tests/settings-derivation.spec.ts` (a channel-only technique seeded and three checks)
- Modify: `docs/motion-references.md` and `apps/web/lib/motion-guideline.ts` ("What the tool does with them" gains one sentence)
- Modify: `apps/web/lib/motion-guideline.test.ts` (one assertion)
- Modify: `PROGRESS.md` (plan 5 ticked, decision 410)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the failing guideline test and the e2e**

`motion-guideline.test.ts`, in the Derive case: `expect(text).toContain('"Propose a technique')`.

The sentence, after the Copy sentence in both the doc and the embedded copy: `"Propose a technique from the mechanism references" in the Derive dialogue reads those references and, when they carry a move no technique covers, derives a technique of this channel's own that a steer phrase reaches once it is approved.`

`settings-derivation.spec.ts`: `seedVersions` also inserts and approves a `'ledger-wipe'` version on the first channel with a proposal (`steerPhrases: ['ledger wipe']`, `fromReference: 'Ledger scene'`) and calls `syncChannelTechniqueInUse`; `clearVersions` also removes the key from the first channel's `settings.motion.techniques` (an `update channels set settings = jsonb_set(...)` or `updateChannelSettings` through the db package). Three tests:

```ts
test('the channel-only technique shows its card, its phrase and its place in use', ...)
// Exemplars tab: heading 'Ledger wipe', text 'proposed from "Ledger scene"', the phrase; Motion tab: the checkbox for ledger-wipe ticked with the phrase line
test('unticking it on the Motion tab saves, and its card keeps its versions', ...)
// Motion tab: untick ledger-wipe, Save → reload shows it unticked (the phrase line still there);
// Exemplars tab: the 'Ledger wipe' card still lists v1 under Versions. (Keep taking the key out
// of use has no UI path while an approved version stands; it is covered by Task 2 and Task 6.)
test('copy carries the channel-only technique', ...)
// the existing copy test, extended: after copy the second channel's Exemplars tab has the 'Ledger wipe' card
```

- [ ] **Step 2: Run the guideline test to see it fail, then the e2e**

Run: `cd apps/web && pnpm exec vitest run motion-guideline` (FAIL on the missing phrase), then after the sentence lands, `cd e2e && pnpm exec playwright test tests/settings-derivation.spec.ts`
Expected: the derivation spec passes, 7 tests, and `tests/settings-exemplars.spec.ts` and `tests/settings-motion.spec.ts` still pass after it (run the three files in one invocation).

- [ ] **Step 3: PROGRESS**

Tick plan 5 under the motion references section, with the branch `channel-techniques` and the decision number; append decision 410: what was built (the tick, the proposal call, the key's life from proposal to in use, the phrase on the board, the cards) and the calls above in one paragraph (one proposal per run, graphic only, in use follows approval, the house list never shadowed, mock mode's word stack under the new key).

- [ ] **Step 4: Run the whole verification, package by package**

Run: `pnpm typecheck` ; `pnpm lint` ; `pnpm exec prettier --check . --ignore-unknown` ; `cd packages/schemas && pnpm exec vitest run` ; `cd packages/providers && pnpm exec vitest run` ; `cd packages/db && pnpm exec vitest run` ; `cd apps/web && pnpm exec vitest run`
Expected: PASS everywhere except the failures already known on master (name them in the ledger if they recur: the point-studio flake, the workspace form import).

- [ ] **Step 5: Commit**

```bash
git add e2e docs/motion-references.md apps/web/lib/motion-guideline.ts apps/web/lib/motion-guideline.test.ts PROGRESS.md
git commit -m "docs: channel-only techniques on the guideline and in PROGRESS (decision 410); e2e for the card, keep and copy"
```
