# Thumbnail Headline Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a generated thumbnail the owner names a word or a run of words from the headline, saves, and the thumbnail is composed again, for free, with the brand accent colour behind those words.

**Architecture:** One pure matching function in `@boom-busters/schemas` decides whether a highlight is a run of the headline's words and splits the headline around it. `thumbnail_packages` gains a `highlight` column. `thumbnailDocument` draws each matched word as an accent block, `saveThumbnailPackage` treats a changed highlight as a retype (the existing free `compose` event), and the card gains one field under Headline. No new event mode, no planner change, no image bought.

**Tech Stack:** Next.js App Router server actions, Zod 4 schemas package, Drizzle (migration 0059), the headless browser in `apps/web/lib/graphic-code/frames.ts`, Vitest, Testing Library, Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-11-27-thumbnail-headline-highlight-design.md` (approved by the owner 2026-11-27; sections 6.1, 6.4, 6.5, 7 and 8 brought up to date on 2026-11-28 after a trial render). Read it in full before Task 1.

## Global Constraints

- Branch `worktree-generated-thumbnails` in worktree `.claude/worktrees/generated-thumbnails`. Another session has used this branch: before starting a task, `git status --short` must be empty and `git log -1` must be the commit the previous task left. If it is not, stop and report; do not build on someone else's commit.
- Small commits, one logical change each, staged by explicit path, never `git add -A`. One plain git command per Bash call. Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Constants, exact: `HIGHLIGHT_MAX = 60`; block side room `padding:0 0.14em;margin:0 -0.14em`; the existing `HEADLINE_CONTRAST_MIN` (4.5).
- Card copy, exact: label `Highlight`; placeholder `A word from the headline`; mismatch line `The highlight must be words from the headline.`
- Refusals, exact: `A highlight is at most 60 characters.`; `An uploaded thumbnail has no headline to highlight.`; `The highlight must be words from the headline.`; and the existing `A set is being made. Wait for it to finish.` and `Could not reach Inngest to start the work.`
- Warning, exact: `The highlighted words do not stand out enough from the accent colour.`
- With no highlight drawn, `thumbnailDocument`'s output is byte for byte what it is today.
- Generated packages only, masters only. The action keeps deriving the record through `loadPackage`.
- Mock-provider mode by default; no test spends and no test calls a real provider. A mocked compose launches no browser.
- `'use server'` modules export only async functions. Constants and pure helpers live in `lib/` or `schemas`.
- Button-first UI, console tokens only. User-visible copy has no em or en dashes and uses South African spelling.
- Migration numbering: the last on `origin/master` is `0058_thumbnail_previous_depicts`; this plan adds `0059`. The controller compares `packages/db/drizzle/meta/_journal.json` against `origin/master` again at merge.
- Decision number: 487 is free at the time of writing. The controller checks again at merge.
- Verification before every commit: `pnpm typecheck`, `pnpm lint` (zero warnings), and `pnpm exec prettier --check` on every file changed. Run one test file with `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and this worktree's own test database (`.env.local` already points `TEST_DATABASE_URL` at `boom_busters_generated_thumbnails`; migrate it with `pnpm db:migrate:test`); never run two database suites at once. Every Bash call that runs tests passes `timeout: 600000` and runs in the foreground.
- A task that changes a shared schema or type runs every consuming package's suite named in its steps, not only its own.

## Review Focus

1. **A headline edited out from under its highlight.** A save that changes only the headline, on a row that holds a highlight the new headline no longer contains, must be refused and write nothing. (Task 4 test `a headline edit that orphans the stored highlight is refused`.)
2. **A fragment, or words that are not neighbours.** `bill` must not match `$2 billion`, and `they billion` must not match `They lost $2 billion`. (Task 1 tests `a fragment of a word is no match`, `words that are not neighbours are no match`.)
3. **Warnings that stop at the block.** With a highlight the headline is several text nodes; a last line that enters the duration corner must still raise its warning. (Task 3 test `the headline's boxes are all of its text nodes`.)
4. **Markup from the owner's text.** A highlighted word such as `<b>` or `"&"` must arrive escaped inside its block, and a stored highlight that is not in the headline must draw the plain headline and not throw. (Task 3 tests `escapes the highlighted words`, `a highlight that is not in the headline draws the plain headline`.)
5. **A brand whose accent is dark, or unreadable.** The type on the block takes the brand colour with the higher contrast, and a colour the reader cannot parse gives no warning and no crash. (Task 3 tests `the type on the block follows the higher contrast`, `an unreadable colour is not a warning`.)

---

### Task 1: The matching rule

**Files:**

- Modify: `packages/schemas/src/thumbnails.ts`, `packages/schemas/src/thumbnails.test.ts`

**Interfaces:**

- Produces:
  - `HIGHLIGHT_MAX = 60`.
  - `headlineHighlight(headline: string, highlight: string): { before: string; hit: string; after: string } | null`.
    - Both texts are trimmed and split on white space into words. No words on either side: null. More highlight words than headline words: null.
    - Two words are equal when they match after both are lower-cased and stripped, at both ends, of every character that is not a letter or a digit (`\p{L}`, `\p{N}`). A word that strips to nothing is compared as written, lower-cased, so `&` matches `&`.
    - The highlight matches at the first position where its words equal a run of neighbouring headline words.
    - `hit` is the matched headline words as the headline writes them, joined by single spaces. `before` is the words in front joined by single spaces with one trailing space, or `''`. `after` is the words behind with one leading space, or `''`.

- [ ] **Step 1: Write the failing tests** in `thumbnails.test.ts`, in a `describe('headlineHighlight')`:
  - `splits around one word`: `('They lost $2 billion', 'lost')` gives `{ before: 'They ', hit: 'lost', after: ' $2 billion' }`.
  - `takes a run of words, with their punctuation`: `('They lost $2 billion', '2 billion')` gives `{ before: 'They lost ', hit: '$2 billion', after: '' }`.
  - `ignores case`: `('The CRASH nobody saw', 'crash')` gives `hit: 'CRASH'`.
  - `ignores punctuation at the ends of a word`: `('Gone. All of it', 'gone')` and `('Gone. All of it', 'GONE!')` both give `{ before: '', hit: 'Gone.', after: ' All of it' }`.
  - `a fragment of a word is no match`: `('They lost $2 billion', 'bill')` is null.
  - `words that are not neighbours are no match`: `('They lost $2 billion', 'they billion')` is null.
  - `takes the first of two runs`: `('Buy now pay now', 'now')` gives `{ before: 'Buy ', hit: 'now', after: ' pay now' }`.
  - `collapses white space`: `('They   lost  $2 billion', '  lost   $2 ')` gives `{ before: 'They ', hit: 'lost $2', after: ' billion' }`.
  - `a symbol on its own is a word`: `('Boom & bust', '&')` gives `{ before: 'Boom ', hit: '&', after: ' bust' }`.
  - `nothing to match is null`: `('They lost', '')`, `('They lost', '   ')`, `('', 'lost')` and `('Gone', 'gone for good')` are all null.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnails.test` in `packages/schemas`. Expected: the new tests fail (`headlineHighlight` is not exported).
- [ ] **Step 3: Implement** `HIGHLIGHT_MAX` beside `PICTURE_CHANGE_MAX` and `headlineHighlight` in the Rules section of `thumbnails.ts`.
- [ ] **Step 4: Run** the same file, then `pnpm typecheck` from the root. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): which words of a headline a highlight names`.

### Task 2: The column

**Files:**

- Modify: `packages/db/src/schema.ts`, `packages/db/src/thumbnail-packages.integration.test.ts`
- Create: `packages/db/drizzle/0059_thumbnail_highlight.sql` and its `meta` entries, generated

**Interfaces:**

- Produces: `thumbnailPackages.highlight: text('highlight').notNull().default('')`, placed after `headline`. `ThumbnailPackagePatch` and `ThumbnailPackageRow` carry it through their inferred types; no helper changes.

- [ ] **Step 1: Write the failing test** in `thumbnail-packages.integration.test.ts`, on its own package row removed in `finally` (never the shared fixture):
  - `a package holds its headline's highlight`: a newly inserted row reads `highlight: ''`; `updateThumbnailPackage(db, id, { highlight: 'crash' })` returns the row with `highlight: 'crash'`, and `getThumbnailPackage` reads it back.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-packages.integration` in `packages/db`. Expected: the new test fails (the row has no `highlight`).
- [ ] **Step 3: Add the column** and generate the migration: `pnpm --filter @boom-busters/db exec drizzle-kit generate --name thumbnail_highlight`. Expected: `0059_thumbnail_highlight.sql` holding one `ALTER TABLE "thumbnail_packages" ADD COLUMN "highlight" text DEFAULT '' NOT NULL;` and a journal entry after `0058`. Run `pnpm db:migrate:test`.
- [ ] **Step 4: Run** the same file, then `pnpm typecheck` from the root. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): a package stores its headline's highlight`, staging the schema, the test, the `.sql`, `meta/_journal.json` and `meta/0059_snapshot.json` by path.

### Task 3: The page draws the highlight

**Files:**

- Modify: `apps/web/lib/thumbnail-document.ts`, `apps/web/lib/thumbnail-document.test.ts`, `apps/web/lib/thumbnail-compose.ts`, `apps/web/lib/thumbnail-set.ts`, `apps/web/lib/thumbnail-set.test.ts`
- Create: `apps/web/lib/thumbnail-compose.test.ts`

**Interfaces:**

- Consumes: `headlineHighlight` (Task 1), `row.highlight` (Task 2).
- Produces, in `thumbnail-document.ts`:
  - `highlightInk(brand: GraphicProps['brand']): { color: string; contrast: number | null }`. Of `brand.colors.background` and `brand.colors.textPrimary`, the one with the higher `contrastRatio` against `brand.colors.accent`; a tie, or a ratio that is null, gives the background colour. `contrast` is the chosen colour's ratio, or null when it could not be read.
  - `thumbnailDocument(input)`: `input` gains `highlight: string` (required). With `headlineHighlight(headline, highlight)` null, the output is unchanged. Otherwise the headline's inner `<span>` holds, in order: `before` escaped; each word of `hit` (split on single spaces) as `<span data-role="highlight" style="display:inline-block;background:<accent>;color:<ink>;padding:0 0.14em;margin:0 -0.14em">` + the word escaped + `</span>`, the blocks joined by one space; `after` escaped. `<accent>` is `brand.colors.accent`, `<ink>` is `highlightInk(brand).color`. Nothing else in the page changes; the type size is still `headlineFontPx(headline)`.
  - `headlineTextNodes(headline: string, highlight: string): number`. `0` for a blank headline; `1` when `headlineHighlight` is null; otherwise the number of words in `hit`, plus one when `before` is not blank, plus one when `after` is not blank.
  - `headlineBoxes(boxes: readonly TextBox[], nodes = 1): TextBox[]`. The boxes whose `node` is among the first `nodes` distinct node numbers, in the order the boxes arrive. `nodes` of 0 gives `[]`.
  - `thumbnailWarnings(input)`: `input` gains `highlightContrast?: number | null`. When it is a number under `HEADLINE_CONTRAST_MIN`, the warning in Global Constraints is added after the existing contrast warning. Undefined or null adds nothing.
- Produces, in `thumbnail-compose.ts`: `composeThumbnail` passes `headlineBoxes(boxes, headlineTextNodes(input.headline, input.highlight))`, and `highlightContrast: highlightInk(input.brand).contrast` when `headlineHighlight(input.headline, input.highlight)` is not null.
- Produces, in `thumbnail-set.ts`: `composeThumbnailPackage` passes `highlight: row.highlight` to `composeThumbnail`.

- [ ] **Step 1: Write the failing tests** in `thumbnail-document.test.ts`. Add `accent: '#f5a524'` to the file's `BRAND` colours and `highlight: ''` to its `document()` helper's defaults.
  - `no highlight leaves the page as it was`: `document({ highlight: '' })` contains `<span>The crash nobody saw</span>` and no `data-role="highlight"`.
  - `sets each highlighted word on an accent block`: `document({ headline: 'They lost $2 billion', highlight: '2 billion' })` contains exactly `<span>They lost <span data-role="highlight" style="display:inline-block;background:#f5a524;color:#101418;padding:0 0.14em;margin:0 -0.14em">$2</span> <span data-role="highlight" style="display:inline-block;background:#f5a524;color:#101418;padding:0 0.14em;margin:0 -0.14em">billion</span></span>`.
  - `keeps the words after the block`: headline `The crash nobody saw`, highlight `crash`: the inner span reads `The ` + one block holding `crash` + ` nobody saw`.
  - `the type size does not change with a highlight`: both pages for `The crash nobody saw` contain `font-size:160px`.
  - `escapes the highlighted words`: headline `Say <b> "&" now`, highlight `<b> "&"`: the page contains `&lt;b&gt;` and `&quot;&amp;&quot;` inside highlight blocks and no raw `<b>`.
  - `a highlight that is not in the headline draws the plain headline`: `document({ highlight: 'bankrupt' })` equals `document({ highlight: '' })`.
  - `the type on the block follows the higher contrast`: `highlightInk` with accent `#f5a524` gives `color: '#101418'`; with accent `#3a0d0d` gives `color: '#f4f1ea'`; both `contrast` values are above 4.5.
  - `an unreadable colour is not a warning`: `highlightInk` with accent `'not-a-colour'` gives `{ color: '#101418', contrast: null }`.
  - `counts the headline's text nodes`: `headlineTextNodes('', 'x')` is 0; `('The crash nobody saw', '')` is 1; `('The crash nobody saw', 'crash')` is 3; `('They lost $2 billion', '2 billion')` is 3; `('Bankrupt', 'bankrupt')` is 1.
  - `the headline's boxes are all of its text nodes`: boxes for nodes 1 (`THE`), 2 (`CRASH`), 3 (`NOBODY SAW`, two lines) and 5 (the wordmark); `headlineBoxes(boxes, 3)` returns the first four and not the wordmark; with the last `NOBODY SAW` line placed at `x: 1400, y: 950`, `thumbnailWarnings` over those boxes holds `The headline sits where YouTube draws the duration.`; `headlineBoxes(boxes)` still returns node 1 alone, and `headlineBoxes(boxes, 0)` is `[]`.
  - `warns when the highlighted words do not stand out`: `thumbnailWarnings({ ...OK, highlightContrast: 4.4 })` holds the new warning; `4.5`, `null` and an absent value do not.
- [ ] **Step 2: Write the failing test** in `thumbnail-set.test.ts`, beside the existing compose tests and with the file's mock of `@/lib/thumbnail-compose`:
  - `a compose sets the package's highlight`: a painted row with `headline: 'They lost $2 billion'`, `highlight: 'billion'`; after `composeThumbnailPackage`, `compose.composeThumbnail` was called with an input holding `highlight: 'billion'`.
- [ ] **Step 3: Write the real-browser test** in the new `thumbnail-compose.test.ts`. The whole `describe` is skipped when `screenshotFrame` on a trivial page throws `FramesUnavailable` (the pattern of `browserAvailable` in `graphic-code/frames.test.ts`); each test has a 60 s timeout. The picture is a `data:image/svg+xml` rectangle, the brand is `graphicBrand(resolveBrandKit(DEFAULT_SETTINGS, { name: 'Boom & Busters', handle: '@boombusters' }))`, the mark is `{ wordmark: 'Boom & Busters' }`.
  - `a highlight never moves a letter`: for each of `['Bankrupt', 'bankrupt', 'left']`, `['The crash nobody saw', 'crash', 'left']`, `['They lost $2 billion', '2 billion', 'left']`, `['Nobody checked the books', 'checked', 'right']`: photograph `thumbnailDocument` with `highlight: ''` and with the highlight; take `headlineBoxes(boxes, headlineTextNodes(...))` of each; group by rounded `y` into lines of `[min x, max x + width]`, rounded; the two lists are equal.
  - `the highlighted words report their block`: in the `crash` page, the box whose text is `crash` has a `ground` that `rgbOf` reads as the accent and a `color` that `rgbOf` reads as `highlightInk(brand).color`.
  - `a good highlighted headline composes without warnings`: `composeThumbnail` for `The crash nobody saw` with `crash` returns a JPEG (bytes `0xff 0xd8`) and `warnings: []`.
- [ ] **Step 4: Run** `pnpm exec vitest run thumbnail-document`, then `pnpm exec vitest run thumbnail-compose`, then `pnpm exec vitest run thumbnail-set.test` in `apps/web`, one after the other. Expected: the new tests fail. Say in the report whether the real-browser tests ran or were skipped.
- [ ] **Step 5: Implement** in the four source files.
- [ ] **Step 6: Run** the three files again, then `pnpm typecheck`. Expected: pass, with the real-browser tests run, not skipped, on this machine.
- [ ] **Step 7: Commit** `feat(thumbnails): the page sets a highlighted word on the accent`.

### Task 4: Saving a highlight

**Files:**

- Modify: `apps/web/app/(console)/projects/[id]/thumbnail-actions.ts`, `apps/web/app/(console)/projects/[id]/thumbnail-actions.test.ts`

**Interfaces:**

- Consumes: `headlineHighlight`, `HIGHLIGHT_MAX` (Task 1), the column (Task 2).
- Produces: `saveThumbnailPackage(packageId, patch)` where `patch` gains `highlight?: string`. After the text side is read and before the idea:
  1. `patch.highlight !== undefined` and not a string: `The highlight must be words from the headline.`
  2. Trimmed; longer than `HIGHLIGHT_MAX`: `A highlight is at most 60 characters.`
  3. Different from `row.highlight`: on an upload, `An uploaded thumbnail has no headline to highlight.`; otherwise `changes.highlight` is set and the save is a retype.
  4. When `changes.headline` or `changes.highlight` is set: the pair is `changes.headline ?? row.headline` and `changes.highlight ?? row.highlight`; a pair whose highlight is not empty and for which `headlineHighlight` is null is refused with `The highlight must be words from the headline.` A save that touches neither is not checked.
  5. The existing in-flight refusal, mark, `compose` send and title sync are unchanged. The roll-back after a failed send also writes `highlight: row.highlight`.

- [ ] **Step 1: Write the failing tests** in the file's `describe('saveThumbnailPackage')`, with its existing mocks:
  - `a highlight saves and recomposes for free`: a ready painted row with headline `They lost $2 billion`; saving `{ highlight: ' Billion ' }` stores `highlight: 'Billion'`, marks the row `painting`, sends exactly one `compose` event and writes no cost.
  - `an unchanged highlight sends nothing`: saving the stored value returns ok and sends no event.
  - `clearing a highlight recomposes`: stored `billion`, saving `{ highlight: '' }` stores `''` and sends one `compose`.
  - `a highlight on a package with no picture is stored without a compose`: a planned row with `pictureKey: null`; stored, no event.
  - `a highlight that is not in the headline is refused`: `{ highlight: 'bankrupt' }` returns the exact words, sends no event and leaves the row as it was.
  - `a headline edit that orphans the stored highlight is refused`: stored highlight `billion`; saving `{ headline: 'They lost it all' }` returns the exact words; headline and highlight are unchanged.
  - `a headline and a highlight are checked as a pair`: stored highlight `billion`; saving `{ headline: 'Nobody checked', highlight: 'checked' }` stores both and sends one `compose`.
  - `a title save is not held up by the highlight`: a row written with headline `Gone` and highlight `billion` (a pair that does not match); saving `{ title: 'A new title' }` succeeds.
  - `a highlight past 60 characters is refused` (`A highlight is at most 60 characters.`), `a highlight that is not text is refused` (`42 as unknown as string`; `The highlight must be words from the headline.`), `an uploaded thumbnail takes no highlight` (`An uploaded thumbnail has no headline to highlight.`), `a highlight is refused while the package is being made` (`A set is being made. Wait for it to finish.`): each sends no event and leaves the row as it was.
  - `a compose that cannot be requested puts the highlight back`: `inngest.send` rejects; the row's `highlight`, `state` and `error` are what they were and the result is `Could not reach Inngest to start the work.`
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-actions` in `apps/web`. Expected: the new tests fail.
- [ ] **Step 3: Implement** in `saveThumbnailPackage`.
- [ ] **Step 4: Run** the file again, then `pnpm typecheck` and `pnpm lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): save a headline's highlight`.

### Task 5: The field on the card

**Files:**

- Modify: `apps/web/lib/publish-review.ts`, `apps/web/lib/publish-review.integration.test.ts`, `apps/web/app/(console)/projects/[id]/thumbnail-set.tsx`, `apps/web/app/(console)/projects/[id]/thumbnail-set.test.tsx`, and any test fixture that builds a `ThumbnailPackageProp` (typecheck names them; `publish-screen.test.tsx` is one)

**Interfaces:**

- Consumes: `headlineHighlight`, `HIGHLIGHT_MAX` (Task 1), `saveThumbnailPackage`'s `highlight` (Task 4).
- Produces:
  - `ThumbnailPackageProp.highlight: string`, mapped from `row.highlight` beside `headline`.
  - On a generated package, directly under the Headline field: a text input labelled `Highlight`, placeholder `A word from the headline`, `maxLength={HIGHLIGHT_MAX}`, disabled exactly when Headline is. It is a `useDraft(pack.highlight)` draft.
  - `highlightChanged` is `generated && highlight.trim() !== pack.highlight` and joins `changed`. Save sends `highlight: highlight.trim()` only when it changed, with the other changed fields as today.
  - While the typed highlight is not blank and `headlineHighlight(headline, highlight)` (the two typed values) is null: the mismatch line shows under the field in the danger colour (`text-[var(--color-danger)]`, 12 px, as the card's error lines are), and `Save changes` is disabled.
  - An uploaded package shows no Highlight field.

- [ ] **Step 1: Write the failing tests.**
  - `publish-review.integration.test.ts`, `a package's highlight reaches the card`: a package row with `highlight: 'crash'` gives a prop with `highlight: 'crash'`. Its own row, removed in `finally`.
  - `thumbnail-set.test.tsx`, `a generated package has a highlight field under its headline`: the textbox named `Highlight` holds the prop's value and has the placeholder; an uploaded package has no such textbox.
  - `thumbnail-set.test.tsx`, `saving sends only the highlight when only it changed`: headline `They lost $2 billion`; typing `billion` and pressing `Save changes` calls `saveThumbnailPackage(id, { highlight: 'billion' })`.
  - `thumbnail-set.test.tsx`, `a highlight that is not in the headline holds the save back`: typing `bankrupt` shows the mismatch line and disables `Save changes`; clearing the field removes the line.
  - `thumbnail-set.test.tsx`, `editing the headline away from its highlight says so`: prop highlight `billion`; changing Headline to `They lost it all` shows the mismatch line and disables `Save changes`.
  - `thumbnail-set.test.tsx`, `the highlight waits with the headline`: when the record is not open, the field is disabled.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-set.test.tsx` in `apps/web`, then `pnpm exec vitest run publish-review.integration`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the prop and the field. Add `highlight: ''` to every fixture `pnpm typecheck` names.
- [ ] **Step 4: Run** both files again, then `pnpm exec vitest run publish-screen`, then `pnpm typecheck` and `pnpm lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): the highlight field on the card`.

### Task 6: End to end, and the decision

**Files:**

- Modify: `e2e/tests/thumbnail-set.spec.ts`, `PROGRESS.md`

**Interfaces:**

- Consumes: the card (Task 5). The e2e suite runs no Inngest: a package there has no picture until the spec writes one by SQL, so a save on the second card stores without a compose.

- [ ] **Step 1: Extend the spec**, directly after the existing headline edit on the second card (`Nobody checked`, then `Changes saved`):
  - Fill `Highlight` on the second card with `banks`: `The highlight must be words from the headline.` is visible inside that card and `Save changes` is disabled.
  - Fill it with `checked`: the line is gone. Press `Save changes`.
  - Reload the page inside `expect(...).toPass` as the spec's other reloads do: the second card's `Highlight` has the value `checked` and its `Headline` still has `Nobody checked`.
- [ ] **Step 2: Run** from the `e2e` directory with a port of its own: `E2E_PORT=3197 pnpm exec playwright test tests/thumbnail-set.spec.ts` (Bash `timeout: 600000`, foreground). Expected: 1 passed, with `[WebServer]` lines in the output. If port 3197 is held, free it or pick another; never leave a dev server running.
- [ ] **Step 3: Write decision 487** at the end of `PROGRESS.md`, in the form of decision 486 above it (indented lettered parts, about 80 columns, plain, South African spelling, no em or en dashes): (a) what the owner asked on 2026-11-27 and why the Change the picture note could not do it; (b) the owner picks the words per card, the planner does not; (c) the look, a solid accent block per word with the type taken by contrast, and why not the film's marker band; (d) the matching rule; (e) a changed highlight is a retype, free, through the existing `compose` event, and a save that would orphan the highlight is refused; (f) the column and migration `0059_thumbnail_highlight`; (g) the two CSS rules and how they are held (`inline-block`, padding cancelled by margin, the real-browser test); (h) `headlineBoxes` now covers every text node of the headline; (i) what is not built: the planner's pick, more than one run, a colour choice, uploads, Shorts.
- [ ] **Step 4: Run** `pnpm exec prettier --check PROGRESS.md e2e/tests/thumbnail-set.spec.ts`, `pnpm typecheck`, `pnpm lint`. Expected: clean.
- [ ] **Step 5: Commit** in two commits: `test(thumbnails): a headline's highlight end to end`, then `docs(thumbnails): decision 487, a highlighted word in the headline`.

---

## After the tasks (the controller, not a task)

1. The whole-branch review, its fix wave and the scoped re-review.
2. Verification of the final tree, one suite at a time: typecheck, lint, the format check on tracked files, schemas, db, the three web batches, and the e2e spec.
3. Stills for the owner: a throwaway script in `apps/web/scripts/` renders four highlighted thumbnails with the default kit in the local browser, at no cost, and is deleted after. The owner sees them before any merge.
4. No merge and no push until the owner says so for this work.
