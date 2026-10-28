# Channel bible, branch 1 (the lift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every sentence that is Boom & Busters' rather than any documentary's is read from a versioned channel bible, and Boom & Busters' prompts, descriptions and rendered frames come out byte for byte as they do today.

**Architecture:** The stage A `ChannelBibleSchema` grows to the full shape (flat fields grouped by a `BIBLE_SECTIONS` map). Today's composed prompts are captured as fixtures before any prompt file moves. Boom & Busters' examples are extracted verbatim into `FIRST_CHANNEL_BIBLE.examples` and an `EXAMPLE_SLOTS` registry, then bibles become append-only `channel_bibles` versions with each project frozen to one. Last, each prompt family swaps its examples for `[[example:<id>]]` markers filled by `fillSlots`, and the fixtures prove nothing changed.

**Tech Stack:** TypeScript, Zod, Drizzle/Postgres, Vitest 4 (`toMatchFileSnapshot`), Next.js server actions, Inngest, Remotion.

**Spec:** `docs/superpowers/specs/2026-10-28-channel-bible-design.md` (sections 4.2, 4.3, 4.5, 4.8, 4.9 and 4.10 item 1), plus section 4.8 of `docs/superpowers/specs/2026-10-27-multi-channel-design.md` for identity on the render and categories as data.

Branch 2 (`bible-drafting`: the Bible tab, history, Draft with AI, the VidIQ connection, Use the latest bible, upload category and language) gets its own plan after this branch merges, because it builds on the interfaces this one produces.

## Global Constraints

- Start from `master` **after the `multi-channel` branch (stage A) has merged**. Branch name `bible-lift`. Code paths below are as of stage A's worktree (`.claude/worktrees/multi-channel`, tip 655efe6).
- Migration number: the next free number on master at the time (0039 if nothing else lands after stage A's 0038).
- Boom & Busters byte-identical: after Task 2's commit, nothing under `packages/providers/src/prompts/lift/__fixtures__/` changes on this branch. Never run Vitest with `-u` or `--update`. Task 12 checks this with `git diff`.
- No prompt file (`packages/providers/src/prompts/*.ts`, `*.md`) changes before Task 2's commit.
- Marker syntax: `[[example:<slot-id>]]`. `[[if:<slot-id>]] ... [[/if]]` is implemented and tested, but no lift slot uses it (spec 4.3).
- Slot ids: kebab-case, prefixed with their source (`script-`, `direction-`, `shotlist-`, `graphics-`, `dossier-`, `metadata-`, `subject-`, `digest-`). At most `MAX_EXAMPLE_SLOTS = 40`. If the inventory in Task 4 needs more, stop and report the list to the owner before going on (spec 4.2).
- `cases.ts` (Suggest cases, named-case scoring) is not parameterised; project 2 deletes it (spec section 8, call 10).
- Mock providers only. No paid API call anywhere in this branch.
- Bibles are read inside the Inngest step that builds the prompt, via `channelForProject`, never from an earlier step's memoised output (memory: parked runs replay old step results).
- `'use server'` files export only async functions.
- Before every commit: `pnpm format:check` on tracked files, `pnpm lint`, `pnpm typecheck`.
- Single-file Vitest runs: `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop running and must never run concurrently with another database suite.
- Verification commands run in the foreground with the Bash `timeout` at 600000, one package or one e2e batch at a time, never a whole `pnpm test` in one call.
- UI copy: no em or en dashes, South African spelling.
- PROGRESS.md decision numbers: fetch `origin/master` first and take the next free number. Renumber only this branch's lines, in a separate commit.

## Review Focus

1. **Replacement patterns in bible text.** An example containing `$&`, `$1` or `$$` (an owner typing "$5bn" or a regex) must be inserted literally. `String.prototype.replace` with a string replacement would mangle it. A test sits in Task 3.
2. **A run parked before the deploy.** A dossier, script or visuals run waiting at a gate resumes into a step that now builds its prompt from the bible. It must resolve `channelForProject` inside that step, and a project whose `bible_id` the migration backfilled must compose identically. A test sits in Task 6.
3. **A channel created under stage A with an old-shape bible.** Its stored jsonb has none of the new keys. It must parse with defaults, become version 1 with `complete = false`, and show "Bible incomplete" rather than throwing. Tests sit in Tasks 1 and 5.
4. **A project pointed at another channel's bible.** `projects.bible_id` must reference a version of the project's own channel. `createProjectFromCase` asserts it and the test proves a mismatch is refused. A test sits in Task 5.
5. **A case whose category key the bible no longer lists.** Existing rows keep their key. The label falls back to the key itself rather than crashing the Cases screen or the project page. A test sits in Task 11.

---

### Task 1: The bible schema grows to its full shape

**Files:**
- Modify: `packages/schemas/src/channels.ts`
- Create: `packages/schemas/src/bible-slots.ts`, `packages/schemas/src/bible-slots.test.ts`
- Modify: `packages/schemas/src/channels.test.ts`, `packages/schemas/src/index.ts`
- Modify: `packages/db/src/migration-0037.test.ts` (it compares 0037's literal with `FIRST_CHANNEL_BIBLE`; freeze the stage A value as `FIRST_CHANNEL_BIBLE_AT_0037` inside the test file so it keeps testing what 0037 wrote)

**Interfaces:**
- Consumes: stage A's `ChannelBibleSchema`, `FIRST_CHANNEL_BIBLE`, `isBibleComplete`, `PUBLISH_DISCLAIMER` (`packages/schemas/src/publish.ts:24`).
- Produces:
  - `ChannelBibleSchema`, now `.strict()`, with stage A's fields unchanged plus: `subjectNoun: { singular: string ≤60, plural: string ≤60 }` (default both `''`); `voiceDos`, `voiceDonts`: `string ≤300[] ≤12` (default `[]`); `hedgingRules: string ≤4000`; `examples: Record<SlotId, string ≤6000>` (keys match the slot id regex `^[a-z]+(-[a-z0-9]+)+$`, default `{}`); `hooks`, `openings`, `titles`: `BibleExampleEntry[] ≤12` (default `[]`); `language: string ≤12`, `country: string ≤2`, `keywordContext: string ≤60`, `channelTags: string ≤30[] ≤15`; `disclaimer: string ≤1000`; `youtubeCategoryId: string /^\d{1,3}$/ | null` (default null); `auditionLine: string ≤400`. Every new string defaults to `''`.
  - `BibleExampleEntrySchema = { text: string 1..2500, note: string ≤300, drawnFrom: { videoId: string, channel: string, title: string }[] ≤5 }`.
  - `type BibleSection = 'identity' | 'voice' | 'look' | 'examples' | 'hooks' | 'search' | 'publishing'` and `BIBLE_SECTIONS: Record<BibleSection, readonly (keyof ChannelBible)[]>`, grouped as the spec 4.2 table, with `titleStyle` and `ctaLine` under publishing.
  - In `bible-slots.ts`: `interface ExampleSlot { id: string; source: string; teaches: string; kind: 'line' | 'passage' | 'worked'; maxLength: number }`, `EXAMPLE_SLOTS: readonly ExampleSlot[]` (empty in this task), `EXAMPLE_SLOT_IDS: readonly string[]`, `MAX_EXAMPLE_SLOTS = 40`, `interface BibleInUse { bible: ChannelBible; slotIds: readonly string[] }`.
  - `isBibleComplete(bible: ChannelBible, slotIds: readonly string[] = EXAMPLE_SLOT_IDS): boolean` and `missingBibleFields(bible, slotIds = EXAMPLE_SLOT_IDS): string[]`. Missing items are named by field key, or by `examples.<slot-id>` for a slot. Required: stage A's seven fields, `subjectNoun.singular`, `subjectNoun.plural`, `hedgingRules`, `disclaimer`, `auditionLine`, at least two categories, and an entry for every id in `slotIds`. Optional: `ctaLine`, the two `*RulesMd`, `voiceDos`, `voiceDonts`, hooks, openings, titles, every search field, `youtubeCategoryId`.
  - `FIRST_CHANNEL_BIBLE` gains:
    - `subjectNoun: { singular: 'company', plural: 'companies' }`;
    - `hedgingRules`: the legal-hedge lines of `HOUSE_STYLE` (`packages/providers/src/prompts/script.ts`, about lines 156 to 164), copied verbatim from the first word to the last character, without the leading newline;
    - `disclaimer: PUBLISH_DISCLAIMER`;
    - `auditionLine`: the `DEFAULT_SAMPLE` text from `apps/web/app/(console)/c/[slug]/settings/voice-tab.tsx`, verbatim, as one string;
    - `language: 'en'`, `country: 'US'`, `keywordContext: 'documentary'`, `channelTags: []`, `youtubeCategoryId: null`;
    - empty `examples`, lists and `*RulesMd`.
  - `FIRST_CHANNEL_IN_USE: BibleInUse = { bible: FIRST_CHANNEL_BIBLE, slotIds: EXAMPLE_SLOT_IDS }`, in `channels.ts`. `bible-slots.ts` imports `ChannelBible` as a type only, so the two files have no runtime cycle.

- [ ] **Step 1: Write the failing tests** in `channels.test.ts` and `bible-slots.test.ts`:

```ts
test('a stage A bible parses with every new field defaulted', () => {
  const parsed = ChannelBibleSchema.parse(FIRST_CHANNEL_BIBLE_AT_0037_SHAPE) // the 11 stage A keys only
  expect(parsed.examples).toEqual({})
  expect(parsed.youtubeCategoryId).toBeNull()
  expect(isBibleComplete(parsed)).toBe(false)
  expect(missingBibleFields(parsed)).toEqual(expect.arrayContaining(['subjectNoun.singular', 'hedgingRules', 'disclaimer', 'auditionLine']))
})
test('an unknown key is refused, not stripped', () => {
  expect(ChannelBibleSchema.safeParse({ ...FIRST_CHANNEL_BIBLE, tone: 'x' }).success).toBe(false)
})
test('every slot id in the list must have an entry', () => {
  expect(isBibleComplete(FIRST_CHANNEL_BIBLE, ['script-x'])).toBe(false)
  expect(missingBibleFields(FIRST_CHANNEL_BIBLE, ['script-x'])).toEqual(['examples.script-x'])
  expect(isBibleComplete({ ...FIRST_CHANNEL_BIBLE, examples: { 'script-x': 'y' } }, ['script-x'])).toBe(true)
})
test('the first bible is complete and carries today\'s fixed strings', () => {
  expect(isBibleComplete(FIRST_CHANNEL_BIBLE)).toBe(true)
  expect(FIRST_CHANNEL_BIBLE.disclaimer).toBe(PUBLISH_DISCLAIMER)
  expect(FIRST_CHANNEL_BIBLE.subjectNoun).toEqual({ singular: 'company', plural: 'companies' })
})
test('every field belongs to exactly one section', () => {
  const keys = Object.values(BIBLE_SECTIONS).flat()
  expect(new Set(keys).size).toBe(keys.length)
  expect([...keys].sort()).toEqual(Object.keys(ChannelBibleSchema.shape).sort())
})
```

`FIRST_CHANNEL_BIBLE_AT_0037_SHAPE` is a literal in the test file with stage A's 11 keys and values. The `hedgingRules` and `auditionLine` copies are proven verbatim in Task 2's fixtures and Task 10.

- [ ] **Step 2: Run** `cd packages/schemas && pnpm exec vitest run channels bible-slots`. Expected: FAIL (`missingBibleFields` is not exported, and the unknown key is accepted).
- [ ] **Step 3: Implement** the Interfaces block in `channels.ts` and `bible-slots.ts`. Export both from `index.ts`. Update `migration-0037.test.ts` to compare with its frozen copy.
- [ ] **Step 4: Run** `pnpm exec vitest run channels bible-slots` in packages/schemas, then `cd packages/db && pnpm exec vitest run migration-0037`, then `pnpm typecheck`. Expected: PASS. If stage A's Channel tab breaks the typecheck (it renders the bible fields), make the smallest change that compiles; Task 5 owns its behaviour.
- [ ] **Step 5: Commit** `feat(schemas): the channel bible's full shape, sections and slot registry`.

---

### Task 2: Capture today's prompts as the lift fixtures

**Files:**
- Create: `packages/providers/src/prompts/lift/lift-cases.ts`, `packages/providers/src/prompts/lift/lift.test.ts`, `packages/providers/src/prompts/lift/__fixtures__/*.json` (written by the first run)

**Interfaces:**
- Consumes: every exported `build*Request` in `packages/providers/src/prompts` except `buildSuggestCasesRequest` and `buildScoreNamedCasesRequest`; `BibleInUse`, `FIRST_CHANNEL_IN_USE`.
- Produces: `interface LiftCase { name: string; build: (bible: BibleInUse) => LLMTaskRequest; bibleAware: boolean }` and `LIFT_CASES: readonly LiftCase[]`. Every case has `bibleAware: false` and a `build` that ignores its argument. Tasks 6 to 9 change `build` to pass the bible and set `bibleAware: true`.

- [ ] **Step 1: Write `lift-cases.ts`.** Add one case per builder and per branch that changes the system or user text:
  - metadata: titles, plus description for `master`, `short` without a clip and `short` with `shortText`;
  - shot list with `hasSets` true and false;
  - outline;
  - chapter: first, a middle one and the last;
  - self-check, shorts, teaser and regenerate;
  - directors book and shot repair;
  - graphics: one case per example type the builder selects;
  - dossier: brief, scenes, claims and answers;
  - name-subject, rebrief, retype, redirect, stretch, scoring, cast identity and digest.

  Inputs are fixed literals (reuse each builder's existing test inputs where they exist) with no `Date.now()` or randomness. Case names are kebab-case and unique, such as `metadata-description-short-clip`.
- [ ] **Step 2: Write `lift.test.ts`:**

```ts
describe.each(LIFT_CASES)('$name', (c) => {
  it('composes exactly the captured prompt from the first channel', async () => {
    await expect(JSON.stringify(c.build(FIRST_CHANNEL_IN_USE), null, 2) + '\n')
      .toMatchFileSnapshot(`./__fixtures__/${c.name}.json`)
  })
})
```

- [ ] **Step 3: Run** `cd packages/providers && pnpm exec vitest run lift` with `CI` unset. Expected: PASS, with one new fixture file per case. Open three fixtures and confirm they hold the full system text.
- [ ] **Step 4: Run it again** with `CI=1 pnpm exec vitest run lift`. Expected: PASS with no files written.
- [ ] **Step 5: Commit** `test(prompts): capture the lift fixtures before the bible moves`. Note the commit SHA in the PROGRESS.md stage section (Task 12 diffs against it).

---

### Task 3: `fillSlots`, the channel rules block and the noun helper

**Files:**
- Create: `packages/providers/src/prompts/bible.ts`, `packages/providers/src/prompts/bible.test.ts`
- Modify: `packages/providers/src/prompts/index.ts`

**Interfaces:**
- Consumes: `BibleInUse`, `ChannelBible`.
- Produces:
  - `fillSlots(text: string, inUse: BibleInUse): string`. It processes each `[[if:<id>]]…[[/if]]` block first: the inner text is kept, without the two markers, when `<id>` is in `inUse.slotIds`, and the whole block is removed when it isn't. It then replaces each `[[example:<id>]]` with `inUse.bible.examples[id]` using a replacer function, so the inserted text is literal and never re-scanned. It throws `BibleSlotMissingError` (with `slotId`) for a marker with no entry. Nested `[[if:` throws `Error('nested [[if:]] blocks are not supported')`.
  - `markersIn(text: string): string[]`: the slot ids of every `[[example:…]]` and `[[if:…]]` marker, in order, without duplicates.
  - `noun(bible: ChannelBible, form: 'singular' | 'plural'): string`.
  - `channelRulesBlock(bible: ChannelBible, stage: 'script' | 'direction'): string`. It returns `''` when that stage's `*RulesMd` is blank and, for script, `voiceDos` and `voiceDonts` are empty. Otherwise it returns `\n\n## This channel's rules\n\n` followed by the dos as `- Do: …` lines, the donts as `- Don't: …` lines and the markdown.

- [ ] **Step 1: Write the failing tests:**
  - a marker is replaced;
  - `examples['a-b'] = 'costs $& and $1'` comes out literally;
  - an example containing `[[example:a-c]]` is not expanded;
  - a missing entry throws `BibleSlotMissingError` with the id;
  - an `[[if:a-b]]x[[/if]]` block is kept as `x` when the id is listed and removed when it isn't;
  - a nested if throws;
  - `markersIn` finds both kinds;
  - `channelRulesBlock(FIRST_CHANNEL_BIBLE, 'script') === ''`;
  - a bible with one do and a rules paragraph yields the heading, the `- Do:` line and the paragraph, in that order.
- [ ] **Step 2: Run** `pnpm exec vitest run bible` in packages/providers. Expected: FAIL.
- [ ] **Step 3: Implement** per the Interfaces block.
- [ ] **Step 4: Run** `pnpm exec vitest run bible lift`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(prompts): fill bible example slots literally, with conditional blocks`.

---

### Task 4: Extract Boom & Busters' examples into the bible (no prompt file changes)

**Files:**
- Modify: `packages/schemas/src/bible-slots.ts` (fill `EXAMPLE_SLOTS`), `packages/schemas/src/channels.ts` (fill `FIRST_CHANNEL_BIBLE.examples`)
- Create: `packages/providers/src/prompts/lift/psychology-bible.ts` (the test bible), `packages/providers/src/prompts/lift/extraction.test.ts`

**Interfaces:**
- Consumes: the inventory in spec section 2, and the prompt files as they stand.
- Produces:
  - the final `EXAMPLE_SLOTS` (each with `id`, `source` as the file basename such as `script-craft.md` or `graphics.ts`, `teaches`, `kind` and `maxLength`);
  - `FIRST_CHANNEL_BIBLE.examples` with one entry per slot, holding the exact text that will be cut from the source;
  - `PSYCHOLOGY_TEST_BIBLE: ChannelBible`, a complete bible for a psychology channel. Its `subject` is about how minds work, its nouns are "idea" and "ideas", and every slot is filled with a psychology example written to its `teaches` line. It contains none of `FINANCE_WORDS`.
  - `FINANCE_WORDS = ['compan', 'pension', 'fraud', 'share price', 'financial advice', 'wirecard', 'stability ai', 'investor', 'regulator', 'bankrupt']`, matched case-insensitively.

How to choose slots: walk every prompt file named in spec section 2 and ask of each channel-flavoured sentence, "would a psychology channel want different words here?" If yes, and the sentence is an example or a worked example, it becomes a slot. A rule that merely names the subject is a field (`subject`, `noun(...)`, `hedgingRules`, `visualRegister` and so on), not a slot. A sentence that needs grammar the noun field can't give becomes a slot (spec 4.2). Slot text runs from the first character of the example to its last, excluding the surrounding rule's punctuation, so the marker sits where the example sat.

- [ ] **Step 1: Write the failing test `extraction.test.ts`:**

```ts
it.each(EXAMPLE_SLOTS)('$id is cut verbatim from its source', (slot) => {
  const source = readPromptFile(slot.source) // reads packages/providers/src/prompts/<source>, CRLF normalised
  const text = FIRST_CHANNEL_BIBLE.examples[slot.id]!
  expect(source.includes(text) || markersIn(source).includes(slot.id)).toBe(true)
  expect(text.length).toBeLessThanOrEqual(slot.maxLength)
})
it('the registry is within the ceiling and ids are unique', () => {
  expect(EXAMPLE_SLOTS.length).toBeLessThanOrEqual(MAX_EXAMPLE_SLOTS)
  expect(new Set(EXAMPLE_SLOT_IDS).size).toBe(EXAMPLE_SLOT_IDS.length)
  expect(Object.keys(FIRST_CHANNEL_BIBLE.examples).sort()).toEqual([...EXAMPLE_SLOT_IDS].sort())
})
it('the psychology test bible is complete and finance-free', () => {
  expect(isBibleComplete(PSYCHOLOGY_TEST_BIBLE)).toBe(true)
  expect(FINANCE_WORDS.some((w) => JSON.stringify(PSYCHOLOGY_TEST_BIBLE).toLowerCase().includes(w))).toBe(false)
})
```

- [ ] **Step 2: Run** `pnpm exec vitest run extraction` in packages/providers. Expected: FAIL (the registry is empty).
- [ ] **Step 3: Fill the registry, the first bible's examples and the psychology bible.** If the count passes 40, stop here and report the list.
- [ ] **Step 4: Run** `pnpm exec vitest run extraction lift`, then `cd packages/schemas && pnpm exec vitest run`. Expected: PASS, with the lift fixtures untouched.
- [ ] **Step 5: Commit** `feat(schemas): Boom & Busters' examples and the slot registry, lifted verbatim`.

---

### Task 5: Bible versions and the project freeze

**Files:**
- Modify: `packages/db/src/schema.ts`
- Create: `packages/db/drizzle/00NN_channel_bibles.sql` (and its meta entry), `packages/db/src/bibles.ts`, `packages/db/src/bibles.test.ts`, `packages/db/src/migration-00NN.test.ts`
- Modify: `packages/db/src/channels.ts` (`Channel`, `getChannel`, `createChannel`, `updateChannel`, `ensureFirstChannel`, `channelForProject`), `packages/db/src/projects.ts` (`createProjectFromCase` at about line 430), `apps/web/inngest/lib/channel.ts`, `apps/web/app/(console)/c/[slug]/settings/channel-tab.tsx` (the "Bible incomplete" line), `apps/web/app/(console)/c/[slug]/settings/channel-actions.ts`, `apps/web/app/(console)/projects/actions.ts` (gate), and the seed and e2e global-setup if they insert projects directly
- Test: the tests above, plus `dossier-runner.test.ts` and `channel-actions.test.ts`

**Interfaces:**
- Consumes: `ChannelBible`, `EXAMPLE_SLOT_IDS`, `isBibleComplete`, `missingBibleFields`, `FIRST_CHANNEL_*`.
- Produces:
  - The table `channel_bibles`: `id` text PK, `channel_id` text not null references `channels` (restrict), `version` integer not null, `bible` jsonb not null, `slot_ids` text[] not null, `complete` boolean not null, `note` text not null, `created_at` timestamptz not null default now(), and a unique index on (`channel_id`, `version`). Drizzle `channelBibles`, row type `BibleVersionRow`.
  - `channels.current_bible_id` text references `channel_bibles`. It stays nullable in SQL because the keys are circular; the app treats null as an error outside `createChannel`'s transaction. `channels.bible` is dropped.
  - `projects.bible_id` text not null references `channel_bibles` (restrict).
  - `FIRST_CHANNEL_BIBLE_ID = '01BB0000000000000000000002'` in `packages/schemas/src/channels.ts`.
  - In `bibles.ts`:
    - `saveBibleVersion(db, channelId: string, bible: ChannelBible, note: string): Promise<BibleVersionRow>`. In one transaction it takes the next version, stamps `slotIds = EXAMPLE_SLOT_IDS` and `complete = isBibleComplete(bible)`, inserts the row and points `current_bible_id` at it.
    - `currentBible(db, channelId): Promise<BibleVersionRow>`.
    - `bibleVersionById(db, id): Promise<BibleVersionRow>`.
  - `Channel` replaces `bible: ChannelBible` with `bible: ChannelBible; slotIds: string[]; bibleId: string; bibleVersion: number`, read from the current version. Structurally that satisfies `BibleInUse`.
  - `channelForProject(db, projectId)` returns `{ channelId, slug, settings, bible, slotIds, bibleId, bibleVersion }` from the **project's** `bible_id`.
  - `createChannel` writes version 1 (note "Created"). `updateChannel`'s `bible` patch calls `saveBibleVersion` with the note "Edited in Settings". `ensureFirstChannel` writes version 1 with `FIRST_CHANNEL_BIBLE_ID`, `FIRST_CHANNEL_BIBLE` and the note "Lifted from code".
  - `createProjectFromCase` sets `bible_id` to the channel's current version and throws `Error('bible version belongs to another channel')` if the version's channel differs from the case's.
  - `requireCompleteBible(inUse: BibleInUse & { slug: string })` checks `isBibleComplete(inUse.bible, inUse.slotIds)`. The New project gate checks `isBibleComplete(channel.bible, EXAMPLE_SLOT_IDS)`.
  - The Channel tab's line reads "Bible incomplete: " followed by `missingBibleFields(...).length` and "missing". Its Save goes through `updateChannelAction` as before, so every save is a version.

Migration, in one transaction:
1. Create `channel_bibles` and add the two columns, nullable.
2. Insert the first channel's version 1. Use `FIRST_CHANNEL_BIBLE_ID`, `FIRST_CHANNEL_BIBLE` as a JSON literal, `EXAMPLE_SLOT_IDS` as an array literal, complete true and the note "Lifted from code". Write it `WHERE EXISTS` the first channel, so a fresh database inserts nothing.
3. Insert version 1 for every other channel. Copy `channels.bible`, take the same slot-id literal, set complete false and the note "Carried over from the Channel tab". Generate the id as `'0' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 25))`, and confirm against `ULID_PATTERN` that it parses.
4. Set `current_bible_id`, then backfill `projects.bible_id` from each project's channel. Set `projects.bible_id` not null and drop `channels.bible`.

- [ ] **Step 1: Write the failing tests:**
  - `migration-00NN.test.ts` (no database): the literal parses and deep-equals `FIRST_CHANNEL_BIBLE`, the slot array literal equals `EXAMPLE_SLOT_IDS`, and the file contains `DROP COLUMN "bible"` after the insert.
  - `bibles.test.ts` (test database): save appends version 2 and moves the current pointer while version 1 is unchanged. Saving `EMPTY_BIBLE` stores `complete` false. `createProjectFromCase` freezes the current version, and after a further save `channelForProject` still returns the older one. A version from channel B refused for a case on channel A gives the error above. `ensureFirstChannel` run twice leaves one version.
  - `dossier-runner.test.ts`: a project frozen to an incomplete version fails with "channel bible incomplete" and sends no LLM request.
  - `channel-actions.test.ts`: saving the bible twice gives versions 1 to 3 (created, then two edits).
- [ ] **Step 2: Run** `cd packages/db && pnpm exec vitest run migration-00NN bibles` with Docker running. Expected: FAIL.
- [ ] **Step 3: Implement** the schema, migration, helpers and call-site changes. Run `pnpm db:migrate:test` against the test database.
- [ ] **Step 4: Run**, one at a time: `pnpm exec vitest run bibles migration-00NN channels` in packages/db, then in apps/web `pnpm exec vitest run dossier-runner channel-actions`, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): append-only bible versions; a project freezes the one it started with`.

From here on, if a later task has to correct an entry in `FIRST_CHANNEL_BIBLE`, it updates this migration's literal in the same commit (the migration test fails until it does), then drops and re-migrates the local test database.

---

### Task 6: The script family reads the bible

**Files:**
- Modify: `packages/providers/src/prompts/script.ts`, `script-craft.md`, `script-craft.ts`, `script.test.ts`, `script-craft.test.ts`, `packages/providers/scripts/embed-direction-craft.mjs` (extend it to re-embed `script-craft.md` into `script-craft.ts` too, with the same `${` and backtick refusal; keep the script name and the `embed:craft` command)
- Modify: `apps/web/lib/script-answers.ts`, `apps/web/inngest/lib/teaser-build.ts`, `apps/web/app/(console)/projects/[id]/actions.ts` (regenerate), and their tests
- Modify: `packages/providers/src/prompts/lift/lift-cases.ts`, and create `lift/psychology.test.ts`

**Interfaces:**
- Consumes: `fillSlots`, `noun`, `channelRulesBlock`, `BibleInUse`, `channelForProject` (Task 5).
- Produces: `bible: BibleInUse` as a required input on `buildOutlineRequest`, `buildChapterRequest`, `buildSelfCheckRequest`, `buildShortsRequest`, `buildTeaserRequest` and `buildRegenerateRequest`. `HOUSE_STYLE` becomes `houseStyle(bible: ChannelBible): string`, reading `narrationRegister`, `hedgingRules` and the noun. Each builder runs `fillSlots` once on its finished system text and appends `channelRulesBlock(bible.bible, 'script')` where the multi-channel spec 4.8 puts "This channel's rules": after the craft text.
- Produces for later tasks: `lift/psychology.test.ts`, which for every `bibleAware` case asserts that `c.build({ bible: PSYCHOLOGY_TEST_BIBLE, slotIds: EXAMPLE_SLOT_IDS }).system` contains no `FINANCE_WORDS` entry and does contain `PSYCHOLOGY_TEST_BIBLE.subject`.

- [ ] **Step 1: Update the tests first.**
  - In `lift-cases.ts`, change the script family's `build` to pass `bible` and set `bibleAware: true`.
  - Add `psychology.test.ts`.
  - In `script-craft.test.ts`, keep the byte-identity test. Move any `toContain` that asserts example text which is now a slot so that it asserts on `buildChapterRequest({ ..., bible: FIRST_CHANNEL_IN_USE }).system`.
  - Add a harness test in `script-answers.test.ts`: a memoised earlier step output with no bible field still builds the chapter request, because the bible is read in the build step itself.
- [ ] **Step 2: Run** `pnpm exec vitest run psychology lift` in packages/providers. Expected: FAIL on psychology (finance words present), with the lift fixtures passing.
- [ ] **Step 3: Implement.**
  - Replace each script slot's text in `script-craft.md`, `script.ts` and `HOUSE_STYLE` with its marker, and the subject and noun sentences with fields.
  - Run `pnpm --filter @boom-busters/providers embed:craft`.
  - Thread `bible` through the call sites, each resolving `channelForProject` inside the step or action that builds the request.
- [ ] **Step 4: Run** `pnpm exec vitest run lift psychology script extraction bible` in packages/providers, then in apps/web `pnpm exec vitest run script-answers teaser-build actions`, then `pnpm typecheck`. Expected: PASS, with `git diff --stat <Task 2 SHA> -- packages/providers/src/prompts/lift/__fixtures__` empty.
- [ ] **Step 5: Commit** `feat(script): the script prompts read the channel bible`.

---

### Task 7: The dossier and subject naming read the bible

**Files:**
- Modify: `packages/providers/src/prompts/dossier.ts`, `subject.ts` and their tests, `apps/web/inngest/lib/dossier-research.ts`, `apps/web/inngest/lib/name-subject.ts` and their tests, `lift/lift-cases.ts`

**Interfaces:**
- Consumes: as Task 6; for case-level work, `currentBible(db, channelId)` (Task 5).
- Produces: `bible: BibleInUse` on `buildBriefRequest`, `buildScenesRequest`, `buildClaimsRequest`, `buildAnswersRequest` (positional builders take it as a new last parameter) and `buildNameSubjectRequest`. `name-subject.ts` passes the channel's **current** bible when the case has no project, and the project's frozen bible when it has one. The claim shape and its rules (dossier.ts, about lines 411 to 441) stay unchanged (spec section 2).

- [ ] **Step 1:** In `lift-cases.ts`, set these cases `bibleAware` and pass `bible`. Fix `subject.test.ts:18-22` and the dossier tests to pass `FIRST_CHANNEL_IN_USE`, keeping their assertions.
- [ ] **Step 2: Run** `pnpm exec vitest run psychology lift`. Expected: psychology FAILS for the dossier and subject cases.
- [ ] **Step 3: Implement**: markers and fields in place of the channel text ("(company)" at dossier.ts:105 becomes the noun), with call sites threaded as in Task 6.
- [ ] **Step 4: Run** `pnpm exec vitest run lift psychology dossier subject extraction` in packages/providers, then in apps/web `pnpm exec vitest run dossier-research name-subject dossier-runner`, then `pnpm typecheck`. Expected: PASS, with the fixtures unchanged.
- [ ] **Step 5: Commit** `feat(dossier): research and subject prompts read the channel bible`.

---

### Task 8: Direction, shot list and the slot passes read the bible

**Files:**
- Modify: `packages/providers/src/prompts/direction-craft.md`, `direction-craft.ts` (re-embedded), `direction.ts`, `shotlist.ts`, `rebrief.ts`, `retype.ts`, `redirect.ts`, `stretch.ts`, `scoring.ts`, `cast-identity.ts` and their tests
- Modify: `apps/web/inngest/lib/direction.ts`, `apps/web/lib/plan-shared.ts`, `apps/web/lib/plan-stretch.ts`, `apps/web/lib/visual-assets.ts`, `apps/web/inngest/functions/slot-rebriefer.ts`, `slot-retyper.ts`, `slot-redirector.ts`, `apps/web/app/(console)/projects/[id]/cast-actions.ts` and their tests, `lift/lift-cases.ts`

**Interfaces:**
- Consumes: as Task 6.
- Produces: `bible: BibleInUse` on `buildDirectorsBookRequest`, `buildShotRepairRequest`, `buildShotListRequest`, `buildRebriefRequest`, `buildRetypeRequest`, `buildRedirectRequest`, `buildStretchRequest`, `buildScoringRequest` and `buildCastIdentityRequest`. A builder with no channel text still takes it, so that every builder has one signature rule and the psychology sweep covers it. The Register bullet (direction-craft.md:11 to 15) reads `visualRegister`. The Stability AI worked example becomes the `direction-worked-example` slot (or whatever id Task 4 chose). `channelRulesBlock(bible.bible, 'direction')` is appended after the craft text in the directors book and shot list prompts. `PEOPLE_RULES`, `SET_RULES` and `GRAPHIC_INTENT_RULES` stay exported constants if they hold no channel text; any that does becomes a function of the bible.

- [ ] **Step 1:** Update `lift-cases.ts` (`bibleAware`, pass `bible`). Make the `direction-craft.test.ts` and `direction.test.ts:54-55` assertions on slot text assert on the composed prompt.
- [ ] **Step 2: Run** `pnpm exec vitest run psychology lift`. Expected: psychology FAILS for these cases.
- [ ] **Step 3: Implement**: markers and fields, then `pnpm --filter @boom-busters/providers embed:craft`, then thread the call sites.
- [ ] **Step 4: Run**, one at a time: `pnpm exec vitest run lift psychology direction shotlist rebrief retype redirect stretch scoring cast-identity extraction` in packages/providers. Then in apps/web, run the tests of each modified file by basename. Then `pnpm typecheck`. Expected: PASS, with the fixtures unchanged.
- [ ] **Step 5: Commit** `feat(direction): direction, shot list and slot passes read the channel bible`.

---

### Task 9: Graphics, metadata and the weekly digest read the bible

**Files:**
- Modify: `packages/providers/src/prompts/graphics.ts`, `metadata.ts`, `digest.ts` and their tests
- Modify: `apps/web/lib/graphic-design-core.ts`, `apps/web/app/(console)/projects/[id]/publish-actions.ts`, `apps/web/inngest/functions/analytics-runner.ts`, `apps/web/scripts/translate-exemplars.ts` (passes `FIRST_CHANNEL_IN_USE`), their tests, `lift/lift-cases.ts`

**Interfaces:**
- Consumes: as Task 6; `currentBible` for the digest, which belongs to a channel, not a project.
- Produces: `bible: BibleInUse` on `buildGraphicRequest`, `buildTitlesRequest`, `buildDescriptionRequest` and `buildDigestRequest`. The opening line of the description system prompt reads the subject from the bible; the channel name comes from the `channels` row via a new `channelName: string` input. The Wirecard worked example (graphics.ts, about lines 491 to 508) becomes its slot; `GRAPHIC_EXAMPLE_CHART_DATA`, if channel-flavoured, comes from that slot's text or stays as code if it is only data shape. `titleStyle` replaces metadata.ts:77. The graphics **user** prompt keeps the exemplar corpus (graphics.ts:532), which this branch defers, so the psychology sweep checks the system prompt only.

- [ ] **Step 1:** Update `lift-cases.ts`. In `psychology.test.ts`, add a final assertion that every case in `LIFT_CASES` is `bibleAware` (this now passes only when all four families are done).
- [ ] **Step 2: Run** `pnpm exec vitest run psychology lift`. Expected: FAIL.
- [ ] **Step 3: Implement** and thread the call sites. In `publish-actions.ts` the project's frozen bible comes from `channelForProject`; in `analytics-runner.ts` the current bible is read inside the per-channel digest step.
- [ ] **Step 4: Run** `pnpm exec vitest run lift psychology graphics metadata digest extraction` in packages/providers, then in apps/web `pnpm exec vitest run graphic-design-core publish-actions analytics-runner`, then `pnpm typecheck`. Expected: PASS, with the fixtures unchanged, and the extraction test now finds every slot as a marker, not as text.
- [ ] **Step 5: Commit** `feat(publish): graphics, titles, descriptions and the digest read the channel bible`.

---

### Task 10: The fixed strings and the wordmark come from the channel

**Files:**
- Modify: `packages/schemas/src/publish.ts` (`composeDescription` at about line 178), `packages/schemas/src/settings.ts` (`BrandKitTokensSchema` at about line 448, `resolveBrandKit` at about line 749), `packages/timeline/src/short.ts` and its callers, `packages/compositions/src/components/EndCta.tsx`, `Watermark.tsx`, `apps/web/inngest/functions/assembly-runner.ts`, `apps/web/app/(console)/c/[slug]/settings/voice-tab.tsx`, `apps/web/app/(console)/projects/[id]/publish-actions.ts`, and the tests of each

**Interfaces:**
- Consumes: the project's frozen bible (`channelForProject`); the channel row's `name` and `handle`.
- Produces:
  - `composeDescription` takes `disclaimer: string` (required) in place of the constant. `PUBLISH_DISCLAIMER` stays exported as Boom & Busters' value.
  - `BrandKitTokensSchema` gains `identity: { name: string; handle: string | null }` optional. `resolveBrandKit(settings: Settings, channel?: { name: string; handle: string | null }): BrandKitTokens` sets it when given.
  - `EndCta` and `Watermark` draw `brand.identity?.name ?? 'Boom & Busters'`.
  - The short compile passes `ctaText: bible.ctaLine || DEFAULT_CTA_TEXT`.
  - The voice tab's sample comes from the channel's current `bible.auditionLine`, falling back to `DEFAULT_SAMPLE` when blank. The constant stays for the fallback.

- [ ] **Step 1: Write the failing tests:**
  - `composeDescription` with `FIRST_CHANNEL_BIBLE.disclaimer` equals today's output for the existing fixture, and with `PSYCHOLOGY_TEST_BIBLE.disclaimer` ends with that text.
  - `resolveBrandKit(DEFAULT_SETTINGS)` has no `identity`, and with a channel it carries the identity.
  - The short timeline for the first channel has CTA text `'The full story is on the channel'`.
  - `FIRST_CHANNEL_BIBLE.auditionLine` equals the voice tab's `DEFAULT_SAMPLE`; export the constant for the test.
  - The voice tab renders the bible's line.
  - The compositions render test still matches its golden PNGs. Re-run that package alone before believing a pixel diff (memory: composition snapshots flake in a full run).
- [ ] **Step 2: Run** `pnpm exec vitest run publish settings` in packages/schemas. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, one package at a time: packages/schemas, packages/timeline, packages/compositions (`pnpm exec vitest run render`), then apps/web for `voice-tab assembly-runner publish-actions`, then `pnpm typecheck`. Expected: PASS, with no golden image regenerated.
- [ ] **Step 5: Commit** `feat(brand): disclaimer, CTA, audition line and wordmark come from the channel`.

---

### Task 11: Case categories become the channel's

**Files:**
- Modify: `packages/db/src/schema.ts` (`cases.category` from the pgEnum to text), create `packages/db/drizzle/00NN+1_case_category_text.sql`
- Modify: `packages/schemas/src/cases.ts`, `apps/web/lib/case-category.ts`, the cases actions (add and edit), the Cases screen filter (`apps/web/app/(console)/c/[slug]/cases/`), `apps/web/app/(console)/c/[slug]/projects/page.tsx`, `apps/web/app/(console)/projects/[id]/page.tsx`, `apps/web/components/needs-you-queue.tsx`, and the tests of each

**Interfaces:**
- Consumes: the channel's current bible.
- Produces:
  - In SQL, `cases.category` becomes text with `CHECK (category <> '')`, through `ALTER COLUMN … TYPE text USING category::text`, and the enum type is dropped.
  - `caseCategoryLabel(bible: ChannelBible, key: string): string` returns the label, or `key` itself when the bible no longer lists it.
  - The add and edit actions refuse a key the channel's current bible does not list, with "That category is not in this channel's bible".
  - The Cases filter lists the bible's categories.
  - **Suggest cases** renders only when `channelId === FIRST_CHANNEL_ID`, and its action refuses on any other channel. Its prompt still uses the five keys (spec section 8, call 10).

- [ ] **Step 1: Write the failing tests:**
  - an unknown key is refused at the action and nothing is inserted;
  - the five first-channel keys pass;
  - `caseCategoryLabel(PSYCHOLOGY_TEST_BIBLE, 'collapse')` returns `'collapse'`;
  - a case row with a key no longer in the bible renders on the Cases screen and the project page without error (Review Focus 5);
  - Suggest cases is absent on a second channel and its action refuses there.
- [ ] **Step 2: Run** the new tests by basename in packages/db and apps/web. Expected: FAIL.
- [ ] **Step 3: Implement** and migrate the test database.
- [ ] **Step 4: Run** each touched test file by basename, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cases): categories come from the channel bible`.

---

### Task 12: End to end, the proof of no change, decisions and the full run

**Files:**
- Modify: `apps/e2e/tests/channels.spec.ts` and the e2e global-setup, `PROGRESS.md`

- [ ] **Step 1: Update e2e.** The stage A step that filled the second channel's bible and expected Suggest cases enabled changes. It now fills the Channel tab fields, saves, and sees "Bible incomplete" naming the missing examples. New project is disabled with the bible notice and Suggest cases is absent. The first channel's existing specs run unchanged.
- [ ] **Step 2: Run e2e** from the e2e package in batches (memory: scoped e2e runs; free port 3100 after an interrupted run): first `channels.spec.ts`, then the rest in batches of a few spec files. Expected: PASS.
- [ ] **Step 3: Prove no change.** `git diff --stat <Task 2 SHA> -- packages/providers/src/prompts/lift/__fixtures__` prints nothing. `CI=1 pnpm exec vitest run lift psychology extraction` in packages/providers passes. Every `LIFT_CASES` entry is `bibleAware`.
- [ ] **Step 4: Full verification, one package at a time.** Run `pnpm exec vitest run` in packages/schemas, packages/providers, packages/db, packages/timeline and packages/compositions, then apps/web split by directory, then `pnpm typecheck`, `pnpm lint` and `pnpm format:check` (tracked files). Expected: all green.
- [ ] **Step 5: PROGRESS.md.** Add a "Channel bible, the lift" section with this plan's task checklist and the Task 2 SHA. Add decisions from the next free number on `origin/master`:
  - (a) the bible's full shape and the example slots, with the slot count;
  - (b) append-only versions and the project freeze;
  - (c) fixed strings and the wordmark from the channel;
  - (d) categories as data, with Suggest cases kept for the first channel only.

  Then commit `docs(progress): the channel bible lift`.
- [ ] **Step 6: Deploy notes, owner actions after merge** (do not run them): `deploy:stacks boom-busters-broker`, because `identity` is a timeline schema change; `deploy:remotion`, because EndCta and Watermark changed; `pnpm db:migrate` against a Neon branch first, with the row counts checked (every project has a `bible_id`, the first channel has version 1 complete), then production; and `PUT /api/inngest` after the Vercel deploy.
