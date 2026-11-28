# The Owner's Picture Brief Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a generated thumbnail the owner reads the brief the picture was painted from, rewrites it in two fields, and Regenerate picture paints from the owner's words, with any cast member they name painted from their portraits.

**Architecture:** The package's `picture` column already holds the brief and the paint already reads it, so nothing new travels in the event. `regenerateThumbnailPicture` gains an optional brief: it works out who the text names with one pure helper in `@boom-busters/schemas`, writes the brief to the row in the same update that marks it `painting`, and sends the existing `paint` event. The card shows the brief in two fields and uses the same helper for a "Will show" line.

**Tech Stack:** Next.js App Router server actions, Inngest, Zod 4, Drizzle (no migration), Vitest, Testing Library, Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-11-27-thumbnail-owner-picture-brief-design.md` (approved by the owner 2026-11-27). Read it in full before Task 1. It adds to `2026-11-24-generated-thumbnails-and-title-sets-design.md` and `2026-11-27-thumbnail-picture-changes-design.md` in the same folder.

## Global Constraints

- Branch `worktree-generated-thumbnails` in worktree `.claude/worktrees/generated-thumbnails`, at `e79223fc` (master `fa4c140a` plus two design docs). Small commits, one logical change each, staged by explicit path, never `git add -A`. One plain git command per Bash call. Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Constants, exact: `PICTURE_SUBJECT_MAX = 400`, `PICTURE_FRAMING_MAX = 400`, `PICTURE_DEPICTS_MAX = 5`. These are the limits `PictureBriefSchema` already holds as literals.
- Card copy, exact: field labels `Picture` and `Framing`; hint `Regenerate picture paints what this says and buys a new image.`; `Will show: <names joined with ", ">` and `Will show: nobody from the cast`. The button stays `Regenerate picture` and its toast stays `Painting a new picture`.
- Refusals, exact: `Write what the picture shows.`; `The picture is at most 400 characters.`; `The framing is at most 400 characters.`; `<name> was removed from the cast.`; `A picture shows at most 5 people from the cast.`; `<name> has no portrait. Add one on the Cast card first.` The existing `A set is being made. Wait for it to finish.`, `Compose this thumbnail again first. It is free.`, `Only a generated thumbnail has a picture to paint again.` and `Could not reach Inngest to start the work.` are unchanged.
- No migration, no new event mode, no new event field, no change to `buildThumbnailPicturePrompt` or to `PictureBriefSchema`'s shape.
- Masters only, generated packages only. The action derives the project and the record from the package through `loadPackage`.
- Mock-provider mode by default; no test spends and no test calls a real provider.
- `'use server'` modules export only async functions. Constants, types and the helper live in `packages/schemas`.
- Button-first UI, console tokens only. User-visible copy has no em or en dashes and uses South African spelling.
- Database tests make their own rows and remove them in `finally`; none renames or mutates the shared fixture project beyond what `thumbnail-actions.test.ts` already does and restores.
- Verification before every commit: `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm format:check` on tracked files. Run one test file with `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and this worktree's own test database (`TEST_DATABASE_URL` pointing at `boom_busters_generated_thumbnails`); never run two database suites at once. Every Bash call that runs tests passes `timeout: 600000`.
- A task that changes a shared schema or type runs every consuming package's suite, not only its own.
- Decision number: 486 is free at the time of writing. Fetch `origin/master` at merge and renumber only this branch's lines if it moved.

## Review Focus

1. **A name the owner writes loosely.** `adam  NEUMANN` names Adam Neumann; `Neumann` alone names nobody, and the card must say so before the owner buys; a name only in Framing still counts. (Task 1 tests `finds a full name whatever its case and spacing`, `a surname alone names nobody`, `a name in the framing counts`; Task 4 test `Will show follows the text`.)
2. **Fields that were opened but not changed.** A brief equal to the stored one after trimming must behave as a plain repaint: the planner's stills stay, nothing is rewritten. Without this every Regenerate press would drop the stills. (Task 2 test `an untouched brief repaints as before`; Task 4 test `Regenerate sends the brief only when a field changed`.)
3. **The send fails after the brief was written.** The row must hold its old brief, people, stills, state and error again, or the card shows a brief no picture was painted from. (Task 2 test `the brief is put back when the send fails`.)
4. **A refresh while the owner is typing.** The card re-reads the route every 3 seconds while another package is being made. Typed text in Picture and Framing must survive it, and the fields must follow the saved brief once the request went through. (Task 4 test `a refresh does not overwrite typing`.)
5. **Someone removed from the cast after the brief was stored.** The paint must buy nothing and fail the package with the person's name, and the owner must be able to rewrite the brief on that failed card. (Task 3 test `a brief naming someone removed from the cast is not bought`; Task 4 test `a failed package still shows its brief fields`.)

---

### Task 1: Who the owner's words name

**Files:**

- Modify: `packages/schemas/src/thumbnails.ts`, `packages/schemas/src/thumbnails.test.ts`

**Interfaces:**

- Produces:
  - `PICTURE_SUBJECT_MAX`, `PICTURE_FRAMING_MAX`, `PICTURE_DEPICTS_MAX`, exported, and used by `PictureBriefSchema` in place of its literals.
  - `dismissedNamed(text: string, cast: { name: string }[], dismissed: { name: string }[]): string | null`. The `name` of the first `dismissed` entry that appears in `text` as whole words (`namesWholeName`), skipping an entry that is back in the cast or is a shorter spelling of someone who is (`isCastSpelling`). Null when none.
  - `ownerBrief(input: { subject: string; framing: string; cast: { name: string; hasPortrait: boolean }[]; dismissed?: { name: string }[] }): { shown: string[]; issue: string | null }`. `cast` arrives not dismissed. `shown` is the cast's own spelling of every member whose name appears as whole words in the subject or the framing, in cast order, each once, never cut. `issue` is the first failure in this order, with the Global Constraints wording: trimmed subject empty; trimmed subject over `PICTURE_SUBJECT_MAX`; trimmed framing over `PICTURE_FRAMING_MAX`; `dismissedNamed` on the two texts joined by a space; `shown` longer than `PICTURE_DEPICTS_MAX`; the first of `shown` whose `hasPortrait` is false.

- [ ] **Step 1: Write the failing tests** in `thumbnails.test.ts`, in a `describe("the owner's brief")`. Cast, unless a test says otherwise: `[{ name: 'Adam Neumann', hasPortrait: true }, { name: 'Masayoshi Son', hasPortrait: true }]`.
  - `finds a full name whatever its case and spacing`: subject `adam  NEUMANN barefoot on a glass floor`, framing `''` gives `{ shown: ['Adam Neumann'], issue: null }`.
  - `a surname alone names nobody`: subject `Neumann barefoot on a glass floor` gives `shown: []`, `issue: null`.
  - `a name in the framing counts`: subject `A glass office floor`, framing `Masayoshi Son in the doorway, out of focus` gives `shown: ['Masayoshi Son']`.
  - `lists people in cast order, each once`: subject `Masayoshi Son beside Adam Neumann, and Adam Neumann again` gives `shown: ['Adam Neumann', 'Masayoshi Son']`.
  - `a name inside a longer word is not a name`: cast `[{ name: 'Son', hasPortrait: true }]`, subject `A personal ledger` gives `shown: []`.
  - `checks the lengths`: subject `'   '` gives `Write what the picture shows.`; a 400-character subject gives null; 401 gives `The picture is at most 400 characters.`; a 401-character framing gives `The framing is at most 400 characters.`
  - `refuses someone removed from the cast`: dismissed `[{ name: 'Rebekah Neumann' }]`, subject `Rebekah Neumann at a desk` gives `Rebekah Neumann was removed from the cast.`; with her back in `cast` it gives null and `shown` holds her.
  - `refuses more than five people`: six cast members with portraits, all named, gives `A picture shows at most 5 people from the cast.` and `shown` of length 6.
  - `refuses a named person with no portrait`: `Masayoshi Son` with `hasPortrait: false`, both named, gives `Masayoshi Son has no portrait. Add one on the Cast card first.`; when only Adam Neumann is named it gives null.
  - `dismissedNamed`: returns `Rebekah Neumann` for text `beside rebekah neumann`; null when the text does not hold the name; null when cast holds `Rebekah Neumann`.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnails.test` in `packages/schemas`. Expected: the new tests fail (`ownerBrief` is not exported).
- [ ] **Step 3: Implement** the constants, `dismissedNamed` and `ownerBrief` in `thumbnails.ts`. `namesWholeName` and `isCastSpelling` are reused. `changeNoteIssue` and `firstFailure` may call `dismissedNamed` in place of their own loops when their tests stay green; otherwise leave them.
- [ ] **Step 4: Run** the schemas suite, then `pnpm exec vitest run thumbnails.test` in `packages/providers` (it parses `PictureBriefSchema`). Expected: all pass.
- [ ] **Step 5: Commit** `feat(thumbnails): who an owner's picture brief names`.

### Task 2: Regenerate takes the owner's brief

**Files:**

- Modify: `apps/web/app/(console)/projects/[id]/thumbnail-actions.ts`, `apps/web/app/(console)/projects/[id]/thumbnail-actions.test.ts`

**Interfaces:**

- Consumes: `ownerBrief` from Task 1; `listCastMembers`, `listDismissedCastNames`, `updateThumbnailPackage` from `@boom-busters/db`. `hasPortrait` is `member.photos.length > 0`.
- Produces: `regenerateThumbnailPicture(packageId: string, brief?: { subject: string; framing: string }): Promise<ActionResult>`.
  - A `brief` that is not an object holding two strings is refused with `Write what the picture shows.` A server action takes whatever the client sends.
  - The brief is **unchanged** when the row has a `picture` and both trimmed texts equal `picture.subject` and `picture.framing`. No brief, or an unchanged one: the action does exactly what it does today.
  - A changed brief, after the existing guards in their existing order: run `ownerBrief`; an `issue` is returned as the error before the row is touched. Then one `updateThumbnailPackage` writes `state: 'painting'`, `error: null`, `depicts: shown`, and `picture` as the row's picture with `subject` and `framing` trimmed, `depicts: shown`, `stillSlotIds: []`. A row whose `picture` is null takes `textSide` from the row.
  - The `paint` event is sent as today, with `baseKey: row.pictureKey`. If the send fails, `state`, `error`, `picture` and `depicts` go back to what the row held.

- [ ] **Step 1: Write the failing tests** in `thumbnail-actions.test.ts`, in a `describe("the owner's brief")` beside the regenerate tests. Each makes a generated, `ready` package with `pictureKey: 'boom-busters/thumbs/p/a.png'` and `picture: { subject: 'A tired auditor over a ledger', framing: 'Close, eye level', textSide: 'right', stillSlotIds: ['s1'], depicts: [] }`, and a cast member `Adam Neumann` with one photo, removed in `finally`.
  - `an untouched brief repaints as before`: brief `{ subject: ' A tired auditor over a ledger ', framing: 'Close, eye level' }` returns ok; the row's `picture` deep-equals what it held (`stillSlotIds: ['s1']`); one event, mode `paint`, `baseKey` the picture key.
  - `the owner's brief is stored with the painting mark`: brief `{ subject: 'Adam Neumann barefoot on a glass office floor', framing: '' }` returns ok; the row reads `state: 'painting'`, `error: null`, `depicts: ['Adam Neumann']`, and `picture` equal to `{ subject: 'Adam Neumann barefoot on a glass office floor', framing: '', textSide: 'right', stillSlotIds: [], depicts: ['Adam Neumann'] }`; one event, mode `paint`, `baseKey` the picture key, no `note`.
  - `a refused brief touches nothing`: for each of an empty subject, a 401-character subject, a dismissed name and a named member with no photo, the result is the Global Constraints refusal, the row is unchanged and no event is sent.
  - `a brief that is not text is refused`: `{ subject: 5, framing: null }` cast to the parameter type returns `Write what the picture shows.`
  - `the brief is put back when the send fails`: `send` rejects; the result is `Could not reach Inngest to start the work.`; the row's `state`, `error`, `depicts` and `picture` equal what they held.
  - `the existing guards come first`: with a changed brief, an in-flight package returns the in-flight refusal, a painted package in state `failed` returns `Compose this thumbnail again first. It is free.`, and an uploaded package returns its existing refusal; the row's `picture` is unchanged in each.
  - `a failed package with no picture takes a new brief`: `state: 'failed'`, `pictureKey: null`; a changed brief returns ok and the event's `baseKey` is null.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-actions.test` in `apps/web`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the optional parameter in `regenerateThumbnailPicture`.
- [ ] **Step 4: Run** the same file. Expected: all pass, the earlier regenerate tests included.
- [ ] **Step 5: Commit** `feat(thumbnails): regenerate paints from the owner's brief`.

### Task 3: The paint refuses a brief that names a removed person

**Files:**

- Modify: `apps/web/lib/thumbnail-set.ts`, `apps/web/lib/thumbnail-set.test.ts`

**Interfaces:**

- Consumes: `dismissedNamed` from Task 1.
- Produces: in `paintThumbnailPicture`, on a paint from the brief (`note === undefined`), before any reference is read or anything is bought: `dismissedNamed` on the row's subject and framing joined by a space, against the cast and `listDismissedCastNames`. A name throws `ValidationError('<name> was removed from the cast.')`, which the function's own catch turns into a failed row. A change (`note` given) is not checked this way: it does not send the brief.

- [ ] **Step 1: Write the failing tests** in the `painting` block of `thumbnail-set.test.ts`, using its existing adapter seam and helpers.
  - `an owner's brief sends portraits and style references and no stills`: a film with one chosen still, a channel with one style reference in use on a model that takes styles, a cast member with a photo, and a package whose `picture` has `depicts: ['Adam Neumann']` and `stillSlotIds: []`. The adapter's `references` hold kinds `character` and `style` and none of kind `object`; the prompt does not contain `film still`.
  - `a brief naming someone removed from the cast is not bought`: the package's subject names a dismissed person. The adapter is not called; the row reads `state: 'failed'`, `error: 'Rebekah Neumann was removed from the cast.'`, and its `pictureKey` is unchanged; no cost ledger row is written for the package.
  - `a change does not read the brief`: the same package with a stored picture and a `note` that names nobody is painted.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-set.test` in `apps/web`. Expected: the second test fails; the first passes already and stays as the pin for spec 6.4.
- [ ] **Step 3: Implement** the check.
- [ ] **Step 4: Run** `pnpm exec vitest run thumbnail-set.test thumbnail-set-runner` in `apps/web`. Expected: all pass.
- [ ] **Step 5: Commit** `fix(thumbnails): a paint refuses a brief naming someone removed from the cast`.

### Task 4: The brief on the card

**Files:**

- Modify: `apps/web/lib/publish-review.ts`, `apps/web/lib/publish-review.integration.test.ts` (the props are built from rows), `apps/web/app/(console)/projects/[id]/thumbnail-set.tsx`, `apps/web/app/(console)/projects/[id]/thumbnail-set.test.tsx`
- Modify, only if they build `ThumbnailPackageProp` or `PublishRecordProp` literals: `publish-screen.test.tsx` and any other fixture `pnpm typecheck` names.

**Interfaces:**

- Consumes: `ownerBrief`, `PICTURE_SUBJECT_MAX`, `PICTURE_FRAMING_MAX` from Task 1; `regenerateThumbnailPicture(packageId, brief?)` from Task 2.
- Produces:
  - `ThumbnailPackageProp.subject: string` and `.framing: string`, from `row.picture`, `''` when there is none.
  - `PublishRecordProp.thumbnailCast: { name: string; hasPortrait: boolean }[]` and `.thumbnailDismissed: string[]`, filled for the master's record from `listCastMembers` (already read in `publishModel`) and `listDismissedCastNames`; empty arrays for a Short.
  - On `PackageCard`, when `open && generated`, above the Change the picture block:
    - a `textarea` labelled `Picture`, 2 rows, `maxLength={PICTURE_SUBJECT_MAX}`, and one labelled `Framing`, 2 rows, `maxLength={PICTURE_FRAMING_MAX}`, both through `useDraft` on the saved values and both disabled while `waiting`;
    - the hint, always;
    - the Will show line, only while the brief differs from the saved one after trimming, from `ownerBrief(...).shown`.
  - Regenerate picture calls `regenerateThumbnailPicture(pack.id, brief)` where `brief` is `{ subject, framing }` trimmed when the brief differs and `undefined` otherwise. It is also disabled while the brief differs and the trimmed Picture field is empty. Its other disabling rules are unchanged.
  - `changed`, which shows Save changes, does not count the brief. `saveThumbnailPackage` is never sent it.

- [ ] **Step 1: Write the failing tests.**
  - `publish-review` test: a generated package's prop carries `subject` and `framing` from its row; an uploaded one carries two empty strings; the master's record prop lists a cast member with a photo as `hasPortrait: true`, one without as `false`, and a dismissed name in `thumbnailDismissed`.
  - `thumbnail-set.test.tsx`, in a `describe('the picture brief')`, with a generated ready package `subject: 'A tired auditor over a ledger'`, `framing: 'Close, eye level'` and cast `Adam Neumann` with a portrait:
    - `the fields open filled`: textbox `Picture` holds the subject and textbox `Framing` the framing; the hint is on screen; no `Will show` text.
    - `Will show follows the text`: typing `Adam Neumann at a desk` into Picture shows `Will show: Adam Neumann`; replacing it with `Neumann at a desk` shows `Will show: nobody from the cast`.
    - `Regenerate sends the brief only when a field changed`: a press with untouched fields calls the action with `(pack.id, undefined)`; after typing ` A vault door left open ` into Picture, a press calls it with `(pack.id, { subject: 'A vault door left open', framing: 'Close, eye level' })`.
    - `an empty picture holds Regenerate back`: clearing Picture disables Regenerate picture.
    - `Save changes does not send the brief`: with Picture and Title both edited, Save changes calls `saveThumbnailPackage` with the title only and does not call `regenerateThumbnailPicture`.
    - `a refresh does not overwrite typing`: after typing into Picture, a rerender with the same saved subject leaves the typed text; a rerender whose saved subject equals the typed text keeps it and hides `Will show`.
    - `a failed package still shows its brief fields`: `state: 'failed'`, `hasPicture: false` shows both fields enabled and Regenerate picture enabled.
    - `an uploaded thumbnail has no brief`: no textbox `Picture`.
    - `a locked record has no brief`: with the record uploading, no textbox `Picture`.
- [ ] **Step 2: Run** `pnpm exec vitest run publish-review thumbnail-set.test` in `apps/web`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the props in `publish-review.ts`, thread `thumbnailCast` and `thumbnailDismissed` from `ThumbnailSet` to `PackageCard`, and add the fields.
- [ ] **Step 4: Run** `pnpm exec vitest run publish-review thumbnail-set.test publish-screen` in `apps/web`, then `pnpm typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(thumbnails): the picture brief on the card`.

### Task 5: End to end, and the record

**Files:**

- Modify: `e2e/tests/thumbnail-set.spec.ts`, `PROGRESS.md`

**Interfaces:**

- Consumes: the card of Task 4. The e2e suite runs no Inngest, so a repaint stays `Being made`; the test proves the card and the stored brief, as the Change picture test does.

- [ ] **Step 1: Write the e2e test** `the owner rewrites the picture brief`, after `seedReadyPackages`, on the first package. Playwright matches a role's name by substring, so every locator here passes `exact: true`: `Picture` would otherwise match `Change the picture`.
  - The textbox `Picture` holds `A tired auditor over a ledger`.
  - Fill it with `A vault door left open at night`; `Will show: nobody from the cast` is visible.
  - Press `Regenerate picture`; the package shows `Being made`.
  - Reload; the first package's `Picture` holds `A vault door left open at night` and its `Framing` holds `Close, eye level`.
  - The spec's existing `restore` puts the record back.
- [ ] **Step 2: Run** from the `e2e` package: `pnpm exec playwright test thumbnail-set` with `E2E_PORT` set off 3100 and this worktree's database. Expected: the file passes. If a page takes seconds to load, rebuild this worktree's test database first.
- [ ] **Step 3: Add decision 486 to `PROGRESS.md`**: what it does, the owner's words of 2026-11-27, the eight calls in spec section 8, that Regenerate after a failed paint still waits for Compose again (decision 485 (i)), and that the e2e test proves the card and the stored brief, not a painted picture.
- [ ] **Step 4: Verify the branch**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, then the suites of `packages/schemas`, `packages/providers`, `packages/db` and `apps/web` one at a time. Expected: all green, or failures shown to exist at `fa4c140a`.
- [ ] **Step 5: Commit** `test(thumbnails): the owner's brief end to end` and `docs(thumbnails): decision 486, the owner's picture brief`, as two commits.
