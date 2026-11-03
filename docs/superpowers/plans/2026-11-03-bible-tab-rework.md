# Bible Tab Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the two graphics worked-example slots and rework the Settings Bible tab so its examples, save action, tools and section cards are grouped, labelled and always in reach.

**Architecture:** The slot registry in `@boom-busters/schemas` loses two slots and gains a human `title` and a stage per slot; the web tab reads those to group and label the Examples section. Three new client components (`bible-examples.tsx`, `bible-save-bar.tsx`, `bible-toolbar.tsx`) take over pieces of `bible-tab.tsx` and `bible-fields.tsx`; the three tool panels become controlled by the tab so one opens at a time.

**Tech Stack:** Next.js App Router, React 19 client components, Tailwind with `var(--color-*)` tokens, lucide-react, Vitest + Testing Library, Playwright (mock-provider mode).

**Spec:** `docs/superpowers/specs/2026-11-03-bible-tab-rework-design.md`

## Global Constraints

- Branch `bible-tab-rework` off `master`; one logical change per commit; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Button-first: every action a visible labelled `Button` from `@/components/ui/button` (the tab test asserts every button carries `h-10`). No keyboard-only actions.
- Colours only through `var(--color-*)` tokens. Dark theme default.
- UI copy: no em or en dashes, South African spelling, sentence case.
- No paid API calls; tests run in mock-provider mode.
- Run `pnpm format:check` on tracked files before each commit (CI gates on Prettier).
- Vitest path filter: from the package directory, `pnpm exec vitest run <basename>`; `pnpm --filter <pkg> test -- <path>` runs the whole package.
- Database suites need Docker Desktop running; never run two DB suites at once. Any Bash call that runs tests passes `timeout: 600000`.
- A change to a shared schema or prompt runs every consuming package's suite (`packages/schemas`, `packages/providers`, `packages/db`, `apps/web`), split per package.

## Review Focus

1. A saved bible or open draft that still holds `graphics-worked-*` keys: prompts compose, no invisible too-close flag is raised on those keys, Approve on Examples is not blocked by them, and the next Examples edit drops them. (Task 1 tests.)
2. "Next missing" when the first empty slot sits in a collapsed group: the group opens and focus lands on that slot's Draft button (view) or textarea (edit); with every slot written the button is absent and the line reads "All 44 examples written". (Task 3 tests.)
3. The save bar on an archived channel or during a running job: Save, Discard and the note are disabled, the blockers still list. (Task 4 tests.)
4. "Try again" on a failed research run must still reopen Draft with AI now that the tab owns which panel is open. (Task 5 test.)
5. Copy from a channel whose bible still holds the retired keys: the copy succeeds and no flag names a retired slot. (Task 1 test.)

---

### Task 1: Retire the graphics worked slots

**Files:**
- Modify: `packages/schemas/src/bible-slots.ts` (drop both slots; `kind` becomes `'line' | 'passage'`; `direction-worked-example` becomes `passage`; add `RETIRED_SLOT_IDS`)
- Modify: `packages/schemas/src/first-channel-examples.ts` (delete both keys)
- Modify: `packages/schemas/src/bible-slots.test.ts`
- Modify: `packages/db/src/migration-0039.test.ts`
- Modify: `packages/providers/src/prompts/graphics.ts:255-257` (remove both markers and the blank lines before them)
- Modify: `packages/providers/src/prompts/graphics.test.ts:281-363` (remove the worked-example tests; add the two below)
- Delete: `packages/providers/src/prompts/lift/graphic-examples.ts`; remove the `"./test-helpers"` export from `packages/providers/package.json`
- Modify: `packages/providers/src/prompts/bible-mocks.ts:100-103,195-198` (delete both keys from both mocks)
- Modify: `apps/web/lib/bible-overlap-sources.ts` (delete `WORKED_PATHS` and its use)
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-actions.ts:330-333` (`recheckedFlags` checks registered slots only)
- Modify: `apps/web/lib/graphic-code/check.test.ts:266-354` (delete the "passes both of the prompt's worked examples" test; `exemplars.test.ts` already runs every stored design through the checks)
- Modify: `apps/web/inngest/functions/bible-drafter.test.ts:307-327`
- Modify: `PROGRESS.md` (decision 386)

**Interfaces:**
- Produces: `RETIRED_SLOT_IDS: readonly ['graphics-worked-beat', 'graphics-worked-chart']` exported from `@boom-busters/schemas`. `EXAMPLE_SLOTS.length === 44`. `ExampleSlot['kind']` is `'line' | 'passage'`.

- [ ] **Step 1: Write the failing tests**

In `bible-slots.test.ts`:

```ts
it('holds 44 slots and none of the retired ones', () => {
  expect(EXAMPLE_SLOTS).toHaveLength(44)
  for (const id of RETIRED_SLOT_IDS) expect(EXAMPLE_SLOT_IDS).not.toContain(id)
  expect(EXAMPLE_SLOTS.find((s) => s.id === 'direction-worked-example')?.kind).toBe('passage')
})
```

In `migration-0039.test.ts`, the two existing comparisons become comparisons with the retired slots taken out of the migration's literal (the migration is applied and is not edited):

```ts
const parsed = JSON.parse(literal!.replaceAll("''", "'")) as ChannelBible
for (const id of RETIRED_SLOT_IDS) delete parsed.examples[id]
expect(parsed).toEqual(FIRST_CHANNEL_BIBLE)
// and for the slot-id arrays:
expect(ids.filter((id) => !(RETIRED_SLOT_IDS as readonly string[]).includes(id))).toEqual([
  ...EXAMPLE_SLOT_IDS,
])
```

In `graphics.test.ts`, replacing the removed worked-example tests:

```ts
it('carries no worked example: the slot exemplar is the only design shown (decision 386)', () => {
  const system = buildGraphicRequest(baseInput()).system
  expect(system).not.toContain('Example 1, a text-only beat')
  expect(system).not.toContain('Example 2, a chart slot')
  expect(system).toContain('Answer with JSON only:')
})
it('composes for a bible that still holds the retired keys', () => {
  const old = { ...FIRST_CHANNEL_BIBLE, examples: { ...FIRST_CHANNEL_BIBLE.examples, 'graphics-worked-beat': 'old' } }
  expect(() => buildGraphicRequest({ ...baseInput(), bible: inUse(old) })).not.toThrow()
})
```

Use the file's existing input fixture and `BibleInUse` helper in place of `baseInput()` / `inUse()`.

In `bible-drafter.test.ts`, replace the "does not compare a worked slot" test with:

```ts
it('compares every slot kind with Boom & Busters, the craft wording aside', async () => {
  // same body as before with only passage and line, plus:
  // direction-worked-example copied ten words from Boom & Busters now flags
})
```

In `bible-actions.test.ts`, add:

```ts
it('neither flags nor keeps a retired slot key on an Examples edit', async () => {
  // second channel; draft bible examples hold 'graphics-worked-beat' copied from Boom & Busters;
  // edit Examples with a patch that leaves it out
  // expect result.draft.tooClose has no key starting 'examples.graphics-worked'
  // expect result.draft.bible.examples has no 'graphics-worked-beat'
})
```

- [ ] **Step 2: Run them to see them fail**

From each package directory: `pnpm exec vitest run bible-slots`, `pnpm exec vitest run migration-0039`, `pnpm exec vitest run graphics.test`, then (Docker running, one at a time) `pnpm exec vitest run bible-drafter` and `pnpm exec vitest run bible-actions`.
Expected: FAIL (46 slots; worked text in the prompt; worked slot unflagged).

- [ ] **Step 3: Make the changes listed under Files**

`recheckedFlags` builds its examples list from `EXAMPLE_SLOTS.filter((slot) => slot.id in bible.examples)` instead of `Object.entries(bible.examples)`. `formPatch` already writes only what the form holds; Task 3's editor holds only registered slots, so the retired keys drop on the next Examples edit.

- [ ] **Step 4: Run every consuming suite**

From `packages/schemas`, `packages/providers`, `packages/db` and `apps/web` in turn: `pnpm test` (Bash `timeout: 600000`; `apps/web` split by directory if it nears the limit). Then `pnpm typecheck` and `pnpm lint` from the root.
Expected: all PASS, zero warnings.

- [ ] **Step 5: Record decision 386 in `PROGRESS.md`**

Under the current milestone's decisions, after 385: **386. The graphics worked examples leave the Bible** (2026-11-03): the two slots, their prompt markers and the `worked` kind are gone; the per-technique exemplar (305) is the designer's only design; `direction-worked-example` is a passage and is overlap-checked; decision 357's skip is retired; saved versions keep their stamped slot ids.

- [ ] **Step 6: Commit**

```bash
git add -A packages/schemas packages/providers packages/db apps/web PROGRESS.md
git commit -m "feat(bible): retire the graphics worked-example slots (decision 386)"
```

---

### Task 2: Give every slot a title and a stage

**Files:**
- Modify: `packages/schemas/src/bible-slots.ts`
- Test: `packages/schemas/src/bible-slots.test.ts`

**Interfaces:**
- Consumes: Task 1's 44-slot registry.
- Produces: `ExampleSlot.title: string`; `type SlotStage = 'script' | 'research' | 'direction' | 'shotlist' | 'metadata'`; `SLOT_STAGES: readonly SlotStage[]` in that order; `SLOT_STAGE_LABELS: Record<SlotStage, string>` = Script, Research, Direction, Shot list, Titles and descriptions; `slotStage(slot: ExampleSlot): SlotStage` (by id prefix: `script-`, `dossier-` and `digest-` to research, `direction-`, `shotlist-`, `metadata-`).

- [ ] **Step 1: Write the failing tests**

```ts
it('gives every slot a short, unique, human title', () => {
  const titles = EXAMPLE_SLOTS.map((s) => s.title)
  expect(new Set(titles).size).toBe(EXAMPLE_SLOTS.length)
  for (const slot of EXAMPLE_SLOTS) {
    expect(slot.title.length).toBeGreaterThan(0)
    expect(slot.title.length).toBeLessThanOrEqual(48)
    expect(slot.title).not.toMatch(/[–—]/)
    expect(slot.title).not.toContain(slot.id)
  }
})
it('places every slot in a stage, in stage order', () => {
  const counts = Object.fromEntries(SLOT_STAGES.map((s) => [s, EXAMPLE_SLOTS.filter((x) => slotStage(x) === s).length]))
  expect(counts).toEqual({ script: 13, research: 6, direction: 17, shotlist: 4, metadata: 4 })
  expect(slotStage(EXAMPLE_SLOTS.find((s) => s.id === 'digest-channel-subject')!)).toBe('research')
})
```

- [ ] **Step 2: Run to see it fail**

`cd packages/schemas && pnpm exec vitest run bible-slots` → FAIL (`title` undefined).

- [ ] **Step 3: Add the titles and the stage helpers**

Titles, exact copy:

| id | title |
|---|---|
| script-channel-subject | What the channel is about |
| script-elegant-variation | Stand-in names to avoid |
| script-storyline-examples | Storylines a film runs in parallel |
| script-subject-with-article | One subject, with its article |
| script-close-hedge | How the ending is qualified |
| script-opening-collapse | What the opening makes the viewer feel |
| script-concrete-figure | A concrete figure, not a vague phrase |
| script-implicit-question | A question raised without asking it |
| script-foreshadow | A foreshadowing line |
| script-middle-turn | Who the middle turn reaches |
| script-legal-care | How legal care is carried |
| script-read-aloud-numbers | Numbers as they are read aloud |
| script-hedge-kind | The kind of hedges the rules require |
| dossier-channel-subject | What the researcher looks for |
| dossier-wanted-example | What a person in the story wanted |
| dossier-scene-examples | Moments a film can show |
| dossier-claims-focus | The facts to pull out |
| dossier-status-subject | Who the status note follows |
| digest-channel-subject | The subject, for research digests |
| direction-abstract-example | An abstract line, staged concretely |
| direction-subject-marks | The subject's own logos and signs |
| direction-background-people | Who fills the background |
| direction-identity-example | A name and role |
| direction-worked-example | A right prompt and the mistake |
| direction-never-acts | Acts a real person is never shown doing |
| direction-guardrail-rule | How a guardrail is written |
| direction-preflight-settings | Settings a guardrail never rules out |
| direction-premise | What each film is about |
| direction-motif-generic | The subject in general terms |
| direction-never-show-examples | Dishonesties never shown |
| direction-guardrail-book | What a guardrail lists |
| direction-default-guardrail | The starting guardrail |
| direction-cast-settings | Settings a cast member keeps |
| direction-era-objects | Objects of the period |
| direction-emotion-body | An emotion shown through the body |
| direction-recreated-scenes | Where re-created scenes are set |
| shotlist-two-units | Two measures that need two axes |
| shotlist-headline-cue | How the narrator cites a publication |
| shotlist-guardrail-negation | A guardrail phrase an image model misreads |
| shotlist-map-route-example | Routes a story moves along |
| metadata-channel-subject | What the channel publishes |
| metadata-title-mechanisms | Ways a title hooks |
| metadata-description-opening | What a description opens with |
| metadata-tag-kinds | Kinds of search tag |

`title` sits after `id` in each entry. Export the new names from the schemas barrel the way `EXAMPLE_SLOTS` is exported.

- [ ] **Step 4: Run schemas and providers suites** (the drafter prompt prints slots; the extra field must not change it)

`cd packages/schemas && pnpm test`, then `cd packages/providers && pnpm test`, `pnpm typecheck`. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(schemas): a title and a stage for every bible example slot"`

---

### Task 3: Group the Examples section

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/bible-examples.tsx`
- Create: `apps/web/app/(console)/c/[slug]/settings/bible-examples.test.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-fields.tsx` (the `examples` branches of `SectionView` and `SectionEditor` render the new components; delete `SlotHeader`; export `FlagNote`, `textareaClass`, `mutedClass` for reuse)
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-tab.test.tsx:183-195` (the "offers to draft a slot" test moves to the new file's wording)

**Interfaces:**
- Consumes: `EXAMPLE_SLOTS`, `SLOT_STAGES`, `SLOT_STAGE_LABELS`, `slotStage` (Task 2).
- Produces:
  - `ExamplesView({ examples: Record<string, string>; flags: TooCloseFlags; disabled: boolean; onDraftSlot: (slotId: string) => void })`
  - `ExamplesEditor({ examples: Record<string, string>; flags: TooCloseFlags; disabled: boolean; onChange: (next: Record<string, string>) => void })`. `onChange` always passes an object holding only registered slot ids.
  - `examplesWritten(examples: Record<string, string>): number`: registered slots whose text is not blank. Task 6 uses it.

Behaviour both components share:
- Summary line: `"{written} of {total} examples written"`, or `"All {total} examples written"`; a "Next missing" `Button` (outline) beside it unless all are written.
- One `<details>` per stage in `SLOT_STAGES` order. Its `<summary>` holds an `h4` with the stage label and a muted `"{n} of {m} written"`. A group starts open when it has an empty or flagged slot. Open state per group is held in component state so "Next missing" can open one.
- Each slot: `Label` (view: a `span` with the same class) with `slot.title`; the `teaches` text as a muted `p` with an id, referenced by the textarea's `aria-describedby`; no slot id, no source file.
- View, empty slot: muted "No example yet" and a `Button` "Draft" with `aria-label={`Draft ${slot.title}`}`.
- Editor: `textarea` with `id`, `rows={slot.kind === 'line' ? 2 : 6}` (drop `min-h-24` for these), and the count `"{n} of {max} characters"` in `--color-warning` once `n >= 0.9 * max`.
- "Next missing": opens the first empty slot's group, then focuses that slot's Draft button (view) or textarea (edit) on the next frame.

- [ ] **Step 1: Write the failing tests** in `bible-examples.test.tsx`

```tsx
it('groups the slots by stage with a written count', () => {
  render(<ExamplesView examples={{}} flags={{}} disabled={false} onDraftSlot={vi.fn()} />)
  expect(screen.getByText('0 of 44 examples written')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 4, name: 'Direction' })).toBeInTheDocument()
  expect(screen.getAllByText('No example yet')).toHaveLength(44)
  expect(screen.queryByText(/^In: /)).toBeNull()
  expect(screen.queryByText('script-foreshadow')).toBeNull()
})
it('drafts one slot by its title', async () => {
  const onDraftSlot = vi.fn()
  render(<ExamplesView examples={{}} flags={{}} disabled={false} onDraftSlot={onDraftSlot} />)
  await userEvent.click(screen.getByRole('button', { name: 'Draft A foreshadowing line' }))
  expect(onDraftSlot).toHaveBeenCalledWith('script-foreshadow')
})
it('Next missing opens a collapsed group and focuses its first empty slot', async () => {
  const all = Object.fromEntries(EXAMPLE_SLOTS.map((s) => [s.id, 'x']))
  delete all['shotlist-two-units']
  render(<ExamplesEditor examples={all} flags={{}} disabled={false} onChange={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: 'Next missing' }))
  await waitFor(() => expect(screen.getByLabelText('Two measures that need two axes')).toHaveFocus())
})
it('says all are written and offers no Next missing when every slot has text', () => {
  const all = Object.fromEntries(EXAMPLE_SLOTS.map((s) => [s.id, 'x']))
  render(<ExamplesView examples={all} flags={{}} disabled={false} onDraftSlot={vi.fn()} />)
  expect(screen.getByText('All 44 examples written')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Next missing' })).toBeNull()
})
it('labels each box by title, describes it by what it teaches, and sizes it by kind', () => {
  render(<ExamplesEditor examples={{}} flags={{}} disabled={false} onChange={vi.fn()} />)
  const legal = screen.getByLabelText('How legal care is carried')
  expect(legal).toHaveAccessibleDescription(/Never narrate the caveat/)
  expect(legal).toHaveAttribute('rows', '6')
  expect(screen.getByLabelText('What the channel is about')).toHaveAttribute('rows', '2')
})
it('warns at 90 percent of the limit', () => {
  render(<ExamplesEditor examples={{ 'direction-premise': 'x'.repeat(54) }} flags={{}} disabled={false} onChange={vi.fn()} />)
  expect(screen.getByText('54 of 60 characters').className).toContain('--color-warning')
})
it('drops keys the registry does not hold when it changes', async () => {
  const onChange = vi.fn()
  render(<ExamplesEditor examples={{ 'graphics-worked-beat': 'old' }} flags={{}} disabled={false} onChange={onChange} />)
  await userEvent.type(screen.getByLabelText('A foreshadowing line'), 'a')
  expect(onChange.mock.lastCall![0]).not.toHaveProperty('graphics-worked-beat')
})
```

- [ ] **Step 2: Run to see them fail**

`cd apps/web && pnpm exec vitest run bible-examples` → FAIL (module not found).

- [ ] **Step 3: Implement `bible-examples.tsx` and wire it into `bible-fields.tsx`**

- [ ] **Step 4: Run the settings tests**

`cd apps/web && pnpm exec vitest run bible-examples bible-tab bible-fields`. Update `bible-tab.test.tsx`'s "offers to draft a slot" test to `getAllByText('No example yet')` with `EXAMPLE_SLOTS.length` and the `Draft ${SLOT.title}` button name; delete its `In:` assertion. Expected: PASS.

- [ ] **Step 5: Commit**

`git commit -m "feat(bible): group the examples by stage with titles, counts and Next missing"`

---

### Task 4: The save bar

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/bible-save-bar.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-tab.tsx:280-325` (replace the panel with `<BibleSaveBar>`, rendered last)
- Test: `apps/web/app/(console)/c/[slug]/settings/bible-tab.test.tsx`

**Interfaces:**
- Produces: `BibleSaveBar({ nextVersion: number; blockers: string[]; note: string; onNote: (note: string) => void; disabled: boolean; onSave: () => void; onDiscard: () => Promise<void> })`.

Layout: `sticky bottom-0 z-20` with `bg-[var(--color-surface)]`, a top border and `shadow-lg`, matching `projects/[id]/stretch-bar.tsx:139`. Left: status text, `"Unsaved draft. Saving makes version {nextVersion}."` when there are no blockers, else `"Unsaved draft. {n} thing(s) to fix before saving."` with a ghost `Button` "Show what to fix" / "Hide" (`aria-expanded`) that toggles the warning list above the row. Right: the `Version note` input (`id="bible-note"`, same `maxLength` and placeholder as now), `Save` (primary, disabled when `disabled` or blockers exist) and the existing `ConfirmButton` "Discard draft". The tab passes `currentVersion.version + 1`.

- [ ] **Step 1: Write the failing tests** (add to `bible-tab.test.tsx`)

```tsx
it('keeps the draft bar along the bottom with the next version number', () => {
  renderTab(draftOf())
  const bar = screen.getByRole('region', { name: 'Unsaved draft' })
  expect(bar.className).toContain('sticky')
  expect(within(bar).getByText(/Saving makes version 4/)).toBeInTheDocument()
})
it('counts what stops Save and lists it on request', async () => {
  renderTab(draftOf({ statuses: { ...draftOf().statuses, voice: 'drafted', look: 'drafted' } }))
  expect(screen.getByText(/2 things to fix before saving/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show what to fix' }))
  expect(screen.getByText('Voice is drafted, not approved')).toBeVisible()
})
it('holds Save, Discard and the note on an archived channel', () => {
  renderTab(draftOf(), { archived: true })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  expect(screen.getByLabelText('Version note')).toBeDisabled()
})
```

The bar is a `<section aria-label="Unsaved draft">`. The existing test at `:130-142` asserts the blocker text is visible without a click: change it to click "Show what to fix" first.

- [ ] **Step 2: Run to see them fail**: `pnpm exec vitest run bible-tab` → FAIL.

- [ ] **Step 3: Implement and wire it in**

- [ ] **Step 4: Run** `pnpm exec vitest run bible-tab` → PASS.

- [ ] **Step 5: Commit**: `git commit -m "feat(bible): a sticky draft bar with the next version and what stops Save"`

---

### Task 5: One header row, one panel at a time, and a start block

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/bible-toolbar.tsx`
- Modify: `draft-with-ai.tsx`, `copy-from-channel.tsx`, `bible-history.tsx` (become controlled panels: props `open: boolean`, `onOpenChange: (open: boolean) => void`; return `null` when closed; drop their own opening buttons; every internal `setOpen(x)` becomes `onOpenChange(x)`; Draft with AI's `retryToken` effect calls `onOpenChange(true)`)
- Modify: `bible-tab.tsx:183-220`
- Test: `bible-tab.test.tsx`, `draft-with-ai.test.tsx`, `bible-history.test.tsx` (render the panels with `open` and `onOpenChange`)

**Interfaces:**
- Consumes: `isBibleComplete`, `EXAMPLE_SLOT_IDS` from schemas.
- Produces: `type BiblePanel = 'history' | 'copy' | 'draft' | null`; `BibleToolbar({ version: number; panel: BiblePanel; onPanel: (panel: BiblePanel) => void; showDrafting: boolean; historyDisabled: boolean; draftingDisabled: boolean; canCopy: boolean })`.

The tab holds `const [panel, setPanel] = useState<BiblePanel>(null)`. Toolbar row (flex, wraps at 390 px): the version sentence, then `History` (outline, `aria-expanded`), `Copy from another channel` (outline, only when `canCopy`, which is `!archived`) and `Draft with AI` (primary), the last two only when `showDrafting`. Pressing the open panel's button closes it. The panel renders directly below the row.

Start block: when `draft === null`, the channel is not archived and `!isBibleComplete(currentVersion.bible, EXAMPLE_SLOT_IDS)`, render above the sections a bordered block with the `h3` "Start here", the text "This channel's bible is not finished, so new projects cannot start yet. Draft it with AI from a short description, or copy another channel's and change what differs.", and the two buttons; `showDrafting` is then `false` so the row does not repeat them. Before writing that sentence, confirm `apps/web/app/(console)/projects/actions.ts:132` still refuses a project for an incomplete bible.

- [ ] **Step 1: Write the failing tests** (in `bible-tab.test.tsx`)

```tsx
it('opens one tool panel at a time', async () => {
  renderTab(null)
  await userEvent.click(screen.getByRole('button', { name: 'History' }))
  expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Copy from another channel' }))
  expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByLabelText(COPY_SOURCE_LABEL)).toBeInTheDocument()
})
it('offers a start block for an unfinished bible with no draft', () => {
  render(<BibleTab {...props} currentVersion={{ id: 'x', version: 1, bible: { ...FIRST_CHANNEL_BIBLE, examples: {} } }} draft={null} />)
  expect(screen.getByRole('heading', { level: 3, name: 'Start here' })).toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'Draft with AI' })).toHaveLength(1)
})
it('reopens Draft with AI when a failed research is tried again', async () => {
  renderTab(draftOf({ job: { kind: 'research', state: 'failed', current: null, error: 'VidIQ refused', startedAt: new Date().toISOString() } }))
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByLabelText('Describe the channel')).toBeInTheDocument()
})
```

Use the labels the panels actually render in place of `Describe the channel` (a `draft-with-ai.tsx` field) and `COPY_SOURCE_LABEL` (the `copy-source` select's label in `copy-from-channel.tsx`), and `tabElement`'s props in place of `props`.

- [ ] **Step 2: Run to see them fail**: `pnpm exec vitest run bible-tab draft-with-ai bible-history copy-from-channel` → FAIL.

- [ ] **Step 3: Implement the toolbar, the controlled panels and the start block**

- [ ] **Step 4: Run the settings directory**: `cd apps/web && pnpm exec vitest run settings` (`timeout: 600000`) → PASS, including `voice-tab.test.tsx`.

- [ ] **Step 5: Commit**: `git commit -m "feat(bible): one tool row, one panel at a time, and a start block for an unfinished bible"`

---

### Task 6: Section cards that say what they hold

**Files:**
- Modify: `packages/schemas/src/bible-draft.ts` (export `sectionProgress`)
- Test: `packages/schemas/src/bible-draft.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-section-card.tsx:31-35,94-97`
- Modify: `apps/web/app/(console)/c/[slug]/settings/bible-tab.tsx` (add `<h2 className="sr-only">Channel bible</h2>` first)
- Test: `bible-tab.test.tsx`

**Interfaces:**
- Consumes: `examplesWritten` (Task 3) is web-side; the schemas helper counts registered slots itself.
- Produces: `sectionProgress(bible: ChannelBible, section: BibleSection): string`. Copy:
  - `examples`: `"{written} of {44} examples written"` (registered slots only)
  - `hooks`: `"{h} hooks, {o} openings, {t} titles"` (singular `hook`/`opening`/`title` at 1)
  - every other section: `"{filled} of {total} filled"` over `BIBLE_SECTIONS[section]`, a field filled when not `valueIsEmpty` (and `subjectNoun` when either form is set)

Card summary: `<h3 className="text-[15px] font-medium">` with the section label, the chip as icon plus text (`Check` for Approved, `CircleDot` for Drafted, not approved, `Circle` for Empty, from `lucide-react`, `aria-hidden`, size 14), then `sectionProgress` in muted 13 px. The chip text stays exactly as now so the e2e `chips` helper keeps working.

- [ ] **Step 1: Write the failing tests**

```ts
// bible-draft.test.ts
it('says how much of a section is filled', () => {
  expect(sectionProgress({ ...FIRST_CHANNEL_BIBLE, examples: {} }, 'examples')).toBe('0 of 44 examples written')
  expect(sectionProgress({ ...FIRST_CHANNEL_BIBLE, hooks: [], openings: [], titles: [] }, 'hooks')).toBe('0 hooks, 0 openings, 0 titles')
  expect(sectionProgress({ ...FIRST_CHANNEL_BIBLE, channelTags: [] }, 'search')).toBe('3 of 4 filled')
  expect(sectionProgress({ ...FIRST_CHANNEL_BIBLE, examples: { ...FIRST_CHANNEL_BIBLE.examples, 'graphics-worked-beat': 'x' } }, 'examples')).toBe('44 of 44 examples written')
})
```

```tsx
// bible-tab.test.tsx
it('heads each card with its name and says what it holds', () => {
  renderTab(null)
  expect(screen.getByRole('heading', { level: 2, name: 'Channel bible' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 3, name: 'Examples' })).toBeInTheDocument()
  expect(within(card('Examples')).getByText('44 of 44 examples written')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to see them fail**: `cd packages/schemas && pnpm exec vitest run bible-draft`; `cd apps/web && pnpm exec vitest run bible-tab` → FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run** both again → PASS; `pnpm typecheck`.

- [ ] **Step 5: Commit**: `git commit -m "feat(bible): section cards with a heading, an icon chip and what they hold"`

---

### Task 7: End-to-end, detector and the record

**Files:**
- Modify: `e2e/tests/bible.spec.ts:395-400` (the 390 px check opens History, then Copy, then Draft with AI in turn, since only one panel opens at a time, checking for no horizontal scroll after each)
- Modify: `PROGRESS.md` (a checklist entry for this rework under the current milestone)

- [ ] **Step 1: Run the Bible e2e spec alone**

From `e2e/`: `pnpm exec playwright test tests/bible.spec.ts tests/settings-exemplars.spec.ts` (`timeout: 600000`; free port 3100 first if a previous run was interrupted).
Expected: PASS after the 390 px test is updated. Fix any selector that relied on the old layout without changing the copy fixed above.

- [ ] **Step 2: Run the Impeccable detector on the changed UI files**

`"C:/Users/ricar/.claude/plugins/cache/impeccable/impeccable/4.5.2/skills/impeccable/scripts/impeccable" detect --json` with the seven settings files plus `bible-examples.tsx`, `bible-save-bar.tsx`, `bible-toolbar.tsx`. Expected: exit 0, or every finding fixed or explained.

- [ ] **Step 3: Full verification**

`pnpm typecheck`, `pnpm lint`, `pnpm format:check` (tracked files), then `pnpm test` per package (`timeout: 600000` each). Expected: all green.

- [ ] **Step 4: Commit**

`git commit -m "test(e2e): the Bible tab at 390 px opens one panel at a time"` and `git commit -m "docs(progress): Bible tab rework done"`
