# Thumbnail Picture Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a generated thumbnail the owner writes what to change and presses Change picture; the image model edits the stored picture, the headline is set on it again, and Back to previous picture puts the earlier picture back for free.

**Architecture:** The existing `thumbnails/set.requested` event gains a `change` mode that carries the owner's note and the key of the picture it edits. `paintThumbnailPicture` sends that picture to the image adapter as a new `base` reference with a change prompt, and every paint that replaces a picture keeps the one it replaced in a new column, `thumbnail_packages.previous_picture_key`. Two new server actions request the change and swap the two pictures; the card gains one field and two buttons.

**Tech Stack:** Next.js App Router server actions, Inngest (`@inngest/test`), Zod 4, Drizzle (migration 0057), the Gemini and fal image adapters in `@boom-busters/providers`, Vitest, Testing Library, Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-11-27-thumbnail-picture-changes-design.md` (approved by the owner 2026-11-27). Read it in full before Task 1. It adds to `docs/superpowers/specs/2026-11-24-generated-thumbnails-and-title-sets-design.md`; this plan argues from both and does not repeat their reasons.

## Global Constraints

- Branch `worktree-generated-thumbnails` in worktree `.claude/worktrees/generated-thumbnails`, at `bf9dbf4d` (master `9c87f052` plus the spec). Small commits, one logical change each, staged by explicit path, never `git add -A`. Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Constants, exact: `PICTURE_CHANGE_MAX = 300` (characters of a note), `CHANGE_IMAGES_MAX_BYTES = 12 * 1024 * 1024` (images sent with a change, before encoding), ledger note cut at 200 characters, picture size `'2K'`, the thumbnails route's model.
- Card copy, exact: field label `Change the picture`; buttons `Change picture` and `Back to previous picture`; hint `Change picture buys a new image. Back to previous picture is free.`; toasts `Changing the picture` and `Putting the previous picture back`.
- Refusals, exact: `There is no picture to change. Regenerate the picture.`; `Write what to change.`; `A change is at most 300 characters.`; `<name> is not shown in this picture. A change cannot add a person.`; `<name> was removed from the cast.`; `There is no previous picture.`; and the existing `A set is being made. Wait for it to finish.` and `Could not reach Inngest to start the work.`
- The base picture's reference: `{ name: 'The picture to edit', kind: 'base' }`. Its Gemini label reads `Reference image 1 of <total>: The picture to edit. Keep everything in it except what the text asks to change.`
- Masters only, generated packages only. Every action derives the project and the record from the package and applies the editable rule through `loadPackage`.
- Mock-provider mode by default; no test spends and no test calls a real provider. In mock mode a paint writes no object.
- `'use server'` modules export only async functions. Constants and types live in `lib/` or `schemas`.
- Inside Inngest: read rows inside the step that uses them.
- Button-first UI, console tokens only. User-visible copy has no em or en dashes and uses South African spelling.
- Migration numbering: master's last is `0056_thumbnail_packages`; this branch adds `0057`. Compare `packages/db/drizzle/meta/_journal.json` against `origin/master` again at merge and regenerate as the next number if it moved.
- Decision number: 485 is free at the time of writing. Fetch `origin/master` at merge and renumber only this branch's lines if it moved.
- Verification before every commit: `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm format:check` on tracked files. Run one test file with `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and this worktree's own test database (`TEST_DATABASE_URL` pointing at `boom_busters_generated_thumbnails`, migrated with `pnpm db:migrate:test`); never run two database suites at once. Every Bash call that runs tests passes `timeout: 600000`.
- A task that changes a shared schema, type or prompt runs every consuming package's suite, not only its own.

## Review Focus

1. **A retried step after the picture moved.** A `change` or `paint` whose `baseKey` no longer equals the row's `picture_key` must buy nothing, rotate nothing and still let the compose run. Without it a retry applies the change twice and deletes the original. (Task 4 test `a paint whose base moved buys nothing`; Task 4 runner test `a retried change goes straight to the compose`.)
2. **A name written differently in the note.** `add adam  NEUMANN in the doorway` must be refused when Adam Neumann is in the cast but not shown; `make Adam Neumann look older` must pass when he is shown; a removed cast member is refused by name. (Task 1 tests `refuses a cast member the picture does not show`, `lets a shown person be named`, `refuses someone removed from the cast`.)
3. **The same bytes back.** A paint that returns the key the row already holds (a mock repaint, or identical bytes) must rotate nothing and name no object for deletion, or the live picture is deleted. (Task 2 test `the same key rotates nothing`.)
4. **Painted but not composed.** After a change that painted and then failed to compose, the card must show both Compose again and Back to previous picture, and the previous picture must still be stored. (Task 6 test `a painted change that did not compose offers both ways out`.)
5. **A note at the edges.** Whitespace only is refused with `Write what to change.`; exactly 300 characters passes; 301 is refused; a note ending in full stops produces one full stop in the prompt, not two. (Task 1 tests `checks the note's length`; Task 3 test `writes the note once, with one full stop`.)

---

### Task 1: The event and the note's rules

**Files:**

- Modify: `packages/schemas/src/thumbnails.ts`, `packages/schemas/src/thumbnails.test.ts`

**Interfaces:**

- Produces:
  - `PICTURE_CHANGE_MAX = 300`.
  - `ThumbnailSetRequestedSchema`: `mode: z.enum(['set', 'paint', 'compose', 'change'])`; `note: z.string().trim().min(1).max(PICTURE_CHANGE_MAX).optional()`; `baseKey: z.string().min(1).nullable().optional()`. Refinements, beside the existing `packageId` one: `note` is present exactly when `mode === 'change'`; `baseKey` is a string when `mode === 'change'`; `baseKey` is absent on `set` and `compose`. An event with none of the new fields and mode `paint` still parses.
  - `changeNoteIssue(input: { note: string; depicts: string[]; cast: { name: string }[]; dismissed?: { name: string }[] }): string | null`. `cast` arrives not dismissed. Checks in this order, first failure is returned: trimmed note empty; trimmed note longer than `PICTURE_CHANGE_MAX`; a `cast` member named in the note (`namesWholeName`) who is not among `depictedMembers(depicts, cast)`; a `dismissed` entry named in the note, skipped when that person is back in the cast or is a shorter spelling of someone who is (the same skip `firstFailure` applies). The messages are the Global Constraints refusals, with the cast member's own `name`.

- [ ] **Step 1: Write the failing tests** in `thumbnails.test.ts`:
  - `a change event needs its note and its base key`: mode `change` with `packageId`, `note: 'darker sky'`, `baseKey: 'k'` parses; without `note` fails; without `baseKey` fails; with `baseKey: null` fails.
  - `only a change carries a note`: mode `paint` with a `note` fails; mode `compose` with a `baseKey` fails; mode `set` with a `baseKey` fails.
  - `a paint may carry its base key or none`: mode `paint` with `baseKey: null`, with `baseKey: 'k'`, and with no `baseKey` all parse.
  - `checks the note's length`: `'   '` returns `Write what to change.`; a 300-character note returns null; 301 characters returns `A change is at most 300 characters.`
  - `refuses a cast member the picture does not show`: cast `[{ name: 'Adam Neumann' }, { name: 'Masayoshi Son' }]`, depicts `['Masayoshi Son']`, note `add adam  NEUMANN in the doorway` returns `Adam Neumann is not shown in this picture. A change cannot add a person.`
  - `lets a shown person be named`: depicts `['Adam Neumann, co-founder of WeWork']`, note `make Adam Neumann look older` returns null.
  - `refuses someone removed from the cast`: dismissed `[{ name: 'Rebekah Neumann' }]`, note `put Rebekah Neumann beside him` returns `Rebekah Neumann was removed from the cast.`; with her back in `cast` and in `depicts` it returns null.
  - `a name inside a longer word is not a name`: cast `[{ name: 'Son' }]`, depicts `[]`, note `add a personal touch` returns null.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnails.test` in `packages/schemas`. Expected: the new tests fail (`changeNoteIssue` is not exported, mode `change` is refused).
- [ ] **Step 3: Implement** the schema fields, the refinements and `changeNoteIssue` in `thumbnails.ts`. `namesWholeName` and the dismissed skip are reused, not copied.
- [ ] **Step 4: Run** the schemas suite, then `pnpm exec vitest run thumbnail-set-runner thumbnail-actions` in `apps/web` (they parse this event). Expected: all pass.
- [ ] **Step 5: Commit** `feat(thumbnails): the change event and the note's rules`.

### Task 2: The previous picture in the database

**Files:**

- Modify: `packages/db/src/schema.ts`, `packages/db/src/thumbnail-packages.ts`, `packages/db/src/thumbnail-packages.integration.test.ts`
- Create: `packages/db/drizzle/0057_thumbnail_previous_picture.sql` and its `meta` entries, generated

**Interfaces:**

- Produces:
  - `thumbnailPackages.previousPictureKey: text('previous_picture_key')`, nullable.
  - `landPaintedPicture(db: Database, packageId: string, pictureKey: string): Promise<{ landed: boolean; deleteKeys: string[] }>`. In one transaction with the package row locked: the row is gone, `{ landed: false, deleteKeys: [pictureKey] }`. `pictureKey` equals the row's `pictureKey`: set `state: 'painting', error: null`, rotate nothing, `deleteKeys: []`. Otherwise set `pictureKey`, set `previousPictureKey` to the old `pictureKey`, `state: 'painting'`, `error: null`; `deleteKeys` is the old `previousPictureKey` when it is not null and neither key of the row now names it.
  - `swapThumbnailPictures(db: Executor, packageId: string, patch?: Pick<ThumbnailPackagePatch, 'state' | 'error'>): Promise<ThumbnailPackageRow | undefined>`. One `UPDATE` that sets `picture_key = previous_picture_key` and `previous_picture_key = picture_key` with the patch, where `previous_picture_key is not null`. Undefined when there is no previous picture or no row.
  - `removeThumbnailPackage` and `replaceUnapprovedGenerated`: `orphanedKeys` also holds each deleted row's `previousPictureKey`.

- [ ] **Step 1: Add the column** to `schema.ts` and generate the migration: `pnpm --filter @boom-busters/db exec drizzle-kit generate --name thumbnail_previous_picture`. Expected: `0057_thumbnail_previous_picture.sql` holding one `ALTER TABLE "thumbnail_packages" ADD COLUMN "previous_picture_key" text;` and a journal entry after `0056`. Run `pnpm db:migrate:test`.
- [ ] **Step 2: Write the failing tests** in `thumbnail-packages.integration.test.ts`. Each makes its own package row and removes it in `finally`; none touches the shared fixture.
  - `a new picture keeps the one it replaced`: row with `pictureKey: 'a'`; `landPaintedPicture(db, id, 'b')` returns `{ landed: true, deleteKeys: [] }`; the row reads `pictureKey: 'b'`, `previousPictureKey: 'a'`, `state: 'painting'`, `error: null`.
  - `the older previous picture is named for deletion`: row `a` with previous `z`; landing `b` returns `deleteKeys: ['z']`.
  - `the same key rotates nothing`: row `a` with previous `z`; landing `a` returns `deleteKeys: []` and leaves both keys.
  - `a picture that returns to an earlier key deletes nothing still named`: row `a` with previous `z`; landing `z` gives `pictureKey: 'z'`, `previousPictureKey: 'a'`, `deleteKeys: []`.
  - `a first picture has no previous`: row with `pictureKey: null`; landing `a` leaves `previousPictureKey: null`.
  - `a package that is gone lands nothing`: unknown id returns `{ landed: false, deleteKeys: ['b'] }`.
  - `swaps the two pictures and swaps them back`: row `b` with previous `a`; `swapThumbnailPictures(db, id, { state: 'painting', error: null })` returns the row with `pictureKey: 'a'`, `previousPictureKey: 'b'`, `state: 'painting'`; a second call restores `b` and `a`.
  - `there is nothing to swap without a previous picture`: returns undefined and the row is unchanged.
  - `removing a package names its previous picture`: `orphanedKeys` holds the picture, the previous picture and the composite.
  - `a fresh plan names the previous pictures of what it replaces`: `replaceUnapprovedGenerated` returns the previous key of a deleted unapproved generated row.
- [ ] **Step 3: Run** `pnpm exec vitest run thumbnail-packages.integration` in `packages/db`. Expected: the new tests fail.
- [ ] **Step 4: Implement** the two helpers and the two `orphanedKeys` changes. Export the helpers from the package index beside `landComposedThumbnail`.
- [ ] **Step 5: Run** the same file. Expected: all pass.
- [ ] **Step 6: Commit** `feat(thumbnails): a package keeps its previous picture`.

### Task 3: The base picture and the change prompt

**Files:**

- Modify: `packages/providers/src/visuals/types.ts`, `packages/providers/src/visuals/gemini.ts`, `packages/providers/src/visuals/gemini.test.ts`, `packages/providers/src/visuals/adapters.test.ts`, `packages/providers/src/prompts/thumbnails.ts`, `packages/providers/src/prompts/thumbnails.test.ts`

**Interfaces:**

- Produces:
  - `ImageReference.kind: 'character' | 'object' | 'style' | 'base'`.
  - Gemini `generate`: at most one `base` reference, else a `ValidationError` on field `references` saying `A request edits one picture; this one carries <n>.` The `base` is outside the character, object and style budgets and is sent first, before the characters. `referenceLabel` gives it the role in Global Constraints.
  - fal `generate`: unchanged. Its images are `referenceUrls` in the caller's order.
  - `buildThumbnailChangePrompt(input: { note: string; textSide: 'left' | 'right'; styleNote: string; guardrails: { name: string; guardrail: string }[]; attached: { people: string[] } }): string`. Sentences joined by one space, in this order:
    1. `Edit the attached picture.`
    2. `Change only this: <note>.` with the note trimmed and its trailing full stops removed.
    3. `Keep everything else as it is: the composition, the framing, the people, the light and the colour.`
    4. `A 16:9 photograph. The <textSide> third stays plain and uncluttered, kept clear for a headline.`
    5. One line per guardrail, as `buildThumbnailPicturePrompt` writes it (`<name>: <guardrail>`, or `<name>: shown as themselves.`), then `Attached for likeness: <n> portrait(s) of <names>.` when `attached.people` is not empty.
    6. `Style: <styleNote>` when the note is not blank.
    7. The two closing lines of `buildThumbnailPicturePrompt`, unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `gemini.test.ts`, `sends the picture to edit first, under its own label`: a request with one `base` and two `character` references posts parts whose first text is `Reference image 1 of 3: The picture to edit. Keep everything in it except what the text asks to change.`, followed by the base's `inlineData`, then the characters.
  - `gemini.test.ts`, `the picture to edit spends no reference budget`: one `base` plus the model's full `characters` limit is accepted.
  - `gemini.test.ts`, `refuses two pictures to edit`: two `base` references throw before any fetch.
  - `adapters.test.ts`, `fal sends its images in the caller's order`: `referenceUrls: ['https://x/base', 'https://x/face']` on a FLUX.1 model posts `image_urls` in that order to Kontext multi; one URL posts `image_url` to Kontext single.
  - `thumbnails.test.ts`, `the change prompt opens with the edit and closes on the rules`: the exact string for note `fewer people in the queue`, text side `right`, no guardrails, no style: `Edit the attached picture. Change only this: fewer people in the queue. Keep everything else as it is: the composition, the framing, the people, the light and the colour. A 16:9 photograph. The right third stays plain and uncluttered, kept clear for a headline. No recognisable real person appears. No text, no letters, no logos, no watermark, no interface elements.`
  - `thumbnails.test.ts`, `writes the note once, with one full stop`: note ` darker sky...` gives `Change only this: darker sky.`
  - `thumbnails.test.ts`, `names the people shown and the portraits sent`: one guardrail for `Adam Neumann` with text `in a dark suit.` and `attached.people: ['Adam Neumann']` gives `Adam Neumann: in a dark suit.`, `Attached for likeness: 1 portrait of Adam Neumann.` and `No recognisable real person appears other than Adam Neumann.`
- [ ] **Step 2: Run** `pnpm exec vitest run gemini.test adapters.test thumbnails.test` in `packages/providers`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Check every `switch` or chain on `ImageReference.kind` in the repo (`referenceLabel` falls through to the set-plate wording today) so `base` never reads as a plate.
- [ ] **Step 4: Run** the whole providers suite, and `pnpm typecheck` from the root. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): a picture to edit and the change prompt`.

### Task 4: Painting a change

**Files:**

- Modify: `apps/web/lib/thumbnail-set.ts`, `apps/web/lib/thumbnail-set.test.ts`, `apps/web/inngest/functions/thumbnail-set-runner.ts`, `apps/web/inngest/functions/thumbnail-set-runner.test.ts`

**Interfaces:**

- Consumes: `landPaintedPicture` (Task 2); `buildThumbnailChangePrompt`, kind `base` (Task 3); the event's `note` and `baseKey` (Task 1).
- Produces:
  - `paintThumbnailPicture(packageId: string, options?: { baseKey?: string | null; note?: string }): Promise<void>`. Still never throws.
    - `options.baseKey !== undefined` and it differs from the row's `pictureKey`: return at once. Nothing is bought, written or deleted.
    - With a `note`: the references are the current picture as `{ name: 'The picture to edit', kind: 'base', mimeType: <from the key's extension>, data }`, then the depicted people's portraits from `spreadReferencePhotos` as now, added in order while the raw bytes of all images sent stay at or under `CHANGE_IMAGES_MAX_BYTES`. No stills, no styles. On fal `referenceUrls` is the base's presigned URL, then the portraits'. The prompt is `buildThumbnailChangePrompt` with `attached.people` naming only the portraits sent, the package's `textSide`, the channel's style note and the depicted people's guardrails. A row with no `pictureKey` fails with `There is no picture to change. Regenerate the picture.`
    - The estimate is worked out as now. On fal `referenceUrls.length` counts the base, so `referenceRoute` prices the edit endpoint that will run.
    - The ledger `meta` gains `change: note.slice(0, 200)` on a change.
    - Mock key on a change: content hash `mock-<packageId>-<first 8 hex of sha256(note)>`, extension `png`.
    - Both paths store through `landPaintedPicture` and delete the keys it returns, under the conditions the old picture is deleted under today (not mocked, storage configured, not a mock key). The direct delete of `previous` goes.
  - Runner: `change` is handled as `paint`. Both pass `{ baseKey: request.baseKey, note: request.note }` to the paint, then compose when the package still has a picture and is not failed.

- [ ] **Step 1: Write the failing tests** in `thumbnail-set.test.ts`, beside the existing paint tests and with their fakes (the image adapter is a spy; no provider is called):
  - `a change sends the picture and the portraits, and no stills or styles`: a package depicting one cast member, with a still and a style reference in use; the adapter receives references of kinds `['base', 'character']` and a prompt starting `Edit the attached picture. Change only this: fewer people.`
  - `a change keeps the picture it replaced`: after a change the row has the new `pictureKey`, `previousPictureKey` equal to the old one, state `painting`.
  - `a repaint keeps the picture it replaced too`: `paintThumbnailPicture(id)` on a package with a picture leaves the old key in `previousPictureKey`.
  - `a paint whose base moved buys nothing`: row `pictureKey: 'b'`, `paintThumbnailPicture(id, { baseKey: 'a', note: 'x' })`; the adapter spy is not called, no ledger row is written, both keys are unchanged.
  - `a failed change leaves both pictures and the composite`: the adapter throws; the row is `failed` with the error, and `pictureKey`, `previousPictureKey` and `composedKey` are what they were.
  - `portraits past the size cap are left out`: two portraits whose bytes with the base exceed `CHANGE_IMAGES_MAX_BYTES`; only the first travels and the prompt says `1 portrait of`.
  - `a change records its note on the ledger`: `meta.change` is the note, cut at 200 characters.
  - `a mock change gets a key of its own`: in mock mode the new key differs from `mock-<packageId>` and `previousPictureKey` is the old key.
- [ ] **Step 2: Write the failing tests** in `thumbnail-set-runner.test.ts`:
  - `a change paints with the note and the base key, then composes`: the event `{ mode: 'change', packageId, note: 'darker sky', baseKey }` calls the paint with `{ baseKey, note: 'darker sky' }` and then the compose.
  - `a retried change goes straight to the compose`: the row's `pictureKey` already differs from the event's `baseKey`; nothing is bought and the compose runs.
  - `a paint sent before the base key existed paints as before`: mode `paint` with no `baseKey`.
- [ ] **Step 3: Run** `pnpm exec vitest run thumbnail-set.test` then `pnpm exec vitest run thumbnail-set-runner` in `apps/web`, one after the other. Expected: the new tests fail.
- [ ] **Step 4: Implement** in `thumbnail-set.ts` and the runner.
- [ ] **Step 5: Run** both files again, then `pnpm typecheck`. Expected: pass.
- [ ] **Step 6: Commit** `feat(thumbnails): a change edits the stored picture`.

### Task 5: The two actions

**Files:**

- Modify: `apps/web/app/(console)/projects/[id]/thumbnail-actions.ts`, `apps/web/app/(console)/projects/[id]/thumbnail-actions.test.ts`

**Interfaces:**

- Consumes: `changeNoteIssue` (Task 1), `swapThumbnailPictures` (Task 2).
- Produces:
  - `sendPackageEvent(loaded, mode: 'paint' | 'compose' | 'change', extra?: { note?: string; baseKey?: string | null })`.
  - `regenerateThumbnailPicture`: sends `baseKey: loaded.row.pictureKey`. Nothing else changes.
  - `changeThumbnailPicture(packageId: string, note: string): Promise<ActionResult>`. In order: `requireOwner`; `loadPackage`; not generated or no `pictureKey`, `There is no picture to change. Regenerate the picture.`; in flight or planning, the in-flight refusal; `changeNoteIssue` with the package's `depicts` and the project's cast, split into not dismissed and dismissed the way `planThumbnailSet` splits it; mark `{ state: 'painting', error: null }`; send `change` with the trimmed note and `baseKey: row.pictureKey`; on a failed send put `state` and `error` back and return the failure; `revalidatePath`.
  - `switchThumbnailPicture(packageId: string): Promise<ActionResult>`. In order: `requireOwner`; `loadPackage`; not generated or no `previousPictureKey`, `There is no previous picture.`; in flight or planning, the in-flight refusal; `swapThumbnailPictures(db, id, { state: 'painting', error: null })`; send `compose`; on a failed send swap back with the old `state` and `error`; `revalidatePath`.

- [ ] **Step 1: Write the failing tests** in `thumbnail-actions.test.ts`, with the file's existing mocks for Inngest and the owner:
  - `a change marks the package and sends the note with its base key`: the event is `{ mode: 'change', packageId, note: 'darker sky', baseKey: <the row's pictureKey> }` (the note sent trimmed from `'  darker sky '`), and the row is `painting`.
  - `a change is refused without a picture`, `while the package is being made`, `while a set is being planned`, `for an empty note`, `for a note past 300 characters`, `for a cast member the picture does not show`, `for someone removed from the cast`: each returns its exact refusal, sends no event and leaves the row as it was.
  - `a change is refused on a record that is uploading`: the editable rule's own words, no event.
  - `a change that cannot be requested puts the state back`: `inngest.send` rejects; the row's `state` and `error` are restored and the result is `Could not reach Inngest to start the work.`
  - `regenerate sends the picture it replaces`: the `paint` event carries `baseKey` equal to the row's `pictureKey`, and `null` for a package with no picture.
  - `back to previous swaps the pictures and composes`: keys swapped, row `painting`, a `compose` event sent with no `note` and no `baseKey`.
  - `back to previous is refused without a previous picture`: `There is no previous picture.`, no event.
  - `back to previous that cannot be requested swaps back`: `inngest.send` rejects; both keys, `state` and `error` are what they were.
  - `back to previous on an approved package leaves the record's keys alone`: `publish_records.uploaded_thumb_keys` is unchanged by the action (the compose replaces the composite when it lands, as it does today).
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-actions` in `apps/web`. Expected: the new tests fail.
- [ ] **Step 3: Implement** the two actions and the `sendPackageEvent` change.
- [ ] **Step 4: Run** the file again, then `pnpm typecheck` and `pnpm lint`. Expected: pass.
- [ ] **Step 5: Commit** `feat(thumbnails): ask for a change, and put the previous picture back`.

### Task 6: The card

**Files:**

- Modify: `apps/web/lib/publish-review.ts`, `apps/web/lib/publish-review.integration.test.ts`, `apps/web/app/(console)/projects/[id]/thumbnail-set.tsx`, `apps/web/app/(console)/projects/[id]/thumbnail-set.test.tsx`

**Interfaces:**

- Consumes: `changeThumbnailPicture`, `switchThumbnailPicture` (Task 5); `PICTURE_CHANGE_MAX` (Task 1).
- Produces: `ThumbnailPackageProp.hasPrevious: boolean`, true when the row's `previousPictureKey` is not null.

**What the card does** (spec 6.1), on a generated package while the record is open:

- With `hasPicture`: a field labelled `Change the picture` (`maxLength` 300, disabled while the card waits), the button `Change picture` (disabled while the card waits or the trimmed note is empty), and the hint line. A successful request empties the field; a refused one keeps the words.
- With `hasPrevious`: the button `Back to previous picture`, disabled while the card waits.
- Neither shows on an uploaded package or on a record that is not open.

- [ ] **Step 1: Write the failing tests** in `thumbnail-set.test.tsx`, with the file's `pack()` helper (add `hasPrevious: false` to its defaults) and its mocked actions:
  - `a generated package with a picture offers a change`: the field, `Change picture` (disabled) and the hint show; typing `darker sky` enables the button; pressing it calls `changeThumbnailPicture(pack.id, 'darker sky')`.
  - `the note empties when the change is requested`, `the note stays when the change is refused`.
  - `back to previous shows only with a previous picture`: absent with `hasPrevious: false`; present with `true`, and pressing it calls `switchThumbnailPicture(pack.id)`.
  - `a painted change that did not compose offers both ways out`: `state: 'failed'`, `hasPicture: true`, `hasPrevious: true` shows `Compose again` and `Back to previous picture`.
  - `an uploaded thumbnail has no change field`, `a closed record has no change field`.
  - `the change waits while the package is being made`: with `inFlight: true` the field and both buttons are disabled.
- [ ] **Step 2: Write the failing test** in `publish-review.integration.test.ts`: a package row with `previousPictureKey` set maps to `hasPrevious: true`, and the existing expected props gain `hasPrevious: false`. This test makes its own rows and removes them.
- [ ] **Step 3: Run** `pnpm exec vitest run thumbnail-set.test.tsx`, then `pnpm exec vitest run publish-review.integration` in `apps/web`. Expected: the new tests fail.
- [ ] **Step 4: Implement** the prop and the card.
- [ ] **Step 5: Run** both files, then `pnpm typecheck`, `pnpm lint`. Expected: pass.
- [ ] **Step 6: Commit** `feat(thumbnails): the change field and the way back on the card`.

### Task 7: The flow end to end, and the record

**Files:**

- Modify: `e2e/tests/thumbnail-set.spec.ts`, `PROGRESS.md`

- [ ] **Step 1: Extend the e2e test** `a set is generated, edited, approved and handed over for a Studio test`, before the approval: on the first generated card fill `Change the picture` with `fewer people in the queue`, press `Change picture`, wait for the card to stop showing `Being made`, expect `Back to previous picture` to be visible, press it, and wait for the card to settle again with the button still visible.
- [ ] **Step 2: Run it**, scoped from the `e2e` package with `E2E_PORT` off 3100 and this worktree's own database: `pnpm exec playwright test thumbnail-set`. Expected: pass. Five specs fail locally at master itself (deletion, channels bible save, post-card date, pipeline-unreachable copy, the Logos channel mark); none is in this file.
- [ ] **Step 3: Write decision 485** in `PROGRESS.md` under the thumbnails milestone: what the change does, that every paint keeps the picture it replaced, the base key that makes a retry safe, the calls in spec section 8, and what stays open (no picture history, no preview of the previous picture).
- [ ] **Step 4: Verify the whole change.** `pnpm typecheck`, `pnpm lint`, `pnpm format:check`; then, one at a time, the suites of `packages/schemas`, `packages/providers`, `packages/db` and, in `apps/web`, the files this plan touched plus `lib/thumbnail` and `inngest/functions`. Expected: all pass.
- [ ] **Step 5: Commit** `test(thumbnails): a picture is changed and put back end to end` and `docs(thumbnails): decision 485, changes to a picture`.
