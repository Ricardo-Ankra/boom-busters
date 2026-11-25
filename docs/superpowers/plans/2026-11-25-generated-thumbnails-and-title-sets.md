# Generated Thumbnails and Title Sets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A master's Publish card generates up to three packages (a thumbnail and its title, each on a different idea), the owner approves them, the default uploads as today, the rest are handed over for a Test & Compare in Studio, and results are recorded per idea.

**Architecture:** Rules and shapes live in `@boom-busters/schemas` (`thumbnails.ts`). A new table `thumbnail_packages` holds one row per package; `publish_records.uploaded_thumb_keys` stays the only thing the publish runner uploads, written on approval. One LLM call plans the set, the Gemini adapter paints each picture (with a new `style` reference kind), and a pure HTML document is photographed at 1920 by 1080 by the headless browser the designer already uses. An Inngest function runs plan, paint and compose; server actions do the curation.

**Tech Stack:** Next.js App Router, Inngest (`@inngest/test`), Zod 4, Drizzle (migration 0056), `playwright-core` through `apps/web/lib/graphic-code/frames.ts`, `sharp`, Vitest, Testing Library, Playwright e2e in mock-provider mode.

**Spec:** `docs/superpowers/specs/2026-11-24-generated-thumbnails-and-title-sets-design.md` (approved by the owner 2026-11-25). Read it in full before Task 1; this plan argues from it and does not repeat its reasons.

## Global Constraints

- Branch `worktree-generated-thumbnails` in worktree `.claude/worktrees/generated-thumbnails`, cut from master at `0605a0bc`. Small commits, one logical change each. Commit messages end with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.
- Phase 1 is Tasks 1 to 11, phase 2 is Tasks 12 and 13. Phase 2 starts only when phase 1's tests are green.
- Masters only. Every new action refuses a Short with `Generated sets are for the full film. A Short's thumbnail is an upload.`
- Constants, exact: `THUMB_WIDTH = 1920`, `THUMB_HEIGHT = 1080`, JPEG quality `90`, `PACKAGES_MAX = 3`, `HEADLINE_WORDS_MAX = 4`, `HEADLINE_MIN_PX = 120` (6.25% of 1920), `HEADLINE_CONTRAST_MIN = 4.5`, `THUMB_MARK_HEIGHT_RATIO = 0.08`, `THUMB_MARK_ALPHA = 0.8`, `THUMB_KEEP_OUT = { left: 0.78, top: 0.84 }` (the region right of 78% and below 84% of the frame), `THUMB_REFERENCES_MAX = 6`, `THUMB_REFERENCES_IN_USE_MAX = 3`, `WINS_MIN_TESTS = 5`.
- Ideas, exact: `person`, `figure`, `object`, `moment`, `contrast`.
- Default route `modelRouting.thumbnails = { provider: 'google', model: 'gemini-3-pro-image' }`, size `'2K'`. The cost shown and reserved is `imageGenPrice(...)` from the adapter's table ($0.15 an image, $0.45 for three), never a figure typed into the UI.
- Mock-provider mode by default; no test spends. In mock mode the compose step launches no browser and writes no object: it stores the key `boom-busters/thumbs/<targetId>/mock-<packageId>.jpg` and no warnings.
- `'use server'` modules export only async functions. Constants and types live in `lib/` or `schemas`.
- The Inngest route cannot import `playwright-core` statically; reach the browser only through `frames.ts`, which lazy-loads it.
- Inside Inngest: read rows inside the step that uses them; never compare step output to jsonb by `JSON.stringify`.
- Button-first UI, console tokens only, dark default. User-visible copy has no em or en dashes and uses South African spelling.
- Migration numbering: master's last is `0055_case_seed_keywords`; this branch adds `0056`. Compare `packages/db/drizzle/meta/_journal.json` against `origin/master` again at merge and regenerate as the next number if it moved.
- Decision number: 484 is free at the time of writing. Fetch `origin/master` at merge and renumber only this branch's lines if it moved.
- Verification before every commit: `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm format:check` on tracked files. Run one test file with `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and this worktree's own test database (`TEST_DATABASE_URL` pointing at `boom_busters_generated_thumbnails`, migrated with `pnpm db:migrate:test`); never run two database suites at once. Every Bash call that runs tests passes `timeout: 600000`.
- A task that changes a shared schema or prompt runs every consuming package's suite, not only its own.

## Review Focus

1. **A planner name written long.** `depicts: ['Adam Neumann, co-founder of WeWork']` must match the cast member "Adam Neumann" through `depictedMembers`, never by exact string, or every person package is dropped. (Task 1 test `matches a depicted name the way the cast does`.)
2. **A figure written two ways.** A title saying "$47 Billion" against a claim reading "valued at $47bn", and "47,000 staff" against "47000 employees", must pass; "$48 Billion" must drop the package. (Task 1 tests `reads a figure whatever its punctuation`, `drops a figure no claim holds`.)
3. **One picture refused, two painted.** A content-policy refusal on one likeness must leave two ready packages, one failed package saying why in words, no spend recorded for the refused image, and an Approve button that still works. (Task 6 test `a refused picture fails its own package only`.)
4. **An upload after a generated set.** Three generated packages plus one uploaded PNG must make Approve refuse in words, never write four keys. (Task 7 test `refuses to approve past three`.)
5. **Headlines at the edges.** An empty headline composes with no scrim, no text box and no warnings; one long word that cannot fit at 120 px warns and is clipped inside the frame, never drawn over the keep-out. (Task 5 tests `composes without a headline`, `warns when a word cannot fit at the floor`.)

---

### Task 1: Shapes, rules and settings

**Files:**
- Create: `packages/schemas/src/thumbnails.ts`, `packages/schemas/src/thumbnails.test.ts`
- Modify: `packages/schemas/src/settings.ts`, `packages/schemas/src/events.ts`, `packages/schemas/src/index.ts`

**Interfaces:**
- Produces, in `thumbnails.ts` (it must not import `settings.ts`):
  - The constants in Global Constraints, `THUMBNAIL_IDEAS`, `type ThumbnailIdea`, `IDEA_LABELS: Record<ThumbnailIdea, string>` (`Person`, `Figure`, `Object`, `Moment`, `Contrast`).
  - `PictureBriefSchema = z.object({ subject: z.string().trim().min(1).max(400), framing: z.string().trim().max(400).default(''), textSide: z.enum(['left', 'right']), stillSlotIds: z.array(z.string()).max(6).default([]), depicts: z.array(z.string()).max(5).default([]) })`, `type PictureBrief`.
  - `PlannedPackageSchema = z.object({ idea: z.enum(THUMBNAIL_IDEAS), angle: z.string().trim().min(1).max(240), title: z.string().trim().min(1).max(100), headline: z.string().trim().max(60), picture: PictureBriefSchema, claimIds: z.array(z.string()).min(1) })`, `type PlannedPackage`.
  - `headlineWords(headline: string): number` (whitespace-separated, empty is 0).
  - `figuresIn(text: string): string[]`: every run matching `/\d[\d,.]*\d|\d/g`, commas removed, a trailing `.` trimmed.
  - `vetPlannedPackages(input: { packages: PlannedPackage[]; cast: { name: string }[]; claims: { id: string; text: string }[]; stills: { slotId: string; depicts: string[] }[]; heldIdeas: ThumbnailIdea[]; places: number }): { kept: PlannedPackage[]; dropped: { idea: ThumbnailIdea; reason: string }[] }`. `cast` and `claims` arrive already filtered (not dismissed, verified). Rules in this order, first failure is the reason: an idea in `heldIdeas` or already kept; every `claimIds` entry in `claims`; every figure of `title` and `headline` among the figures of the cited claims' text; `headlineWords <= HEADLINE_WORDS_MAX`; every `stillSlotIds` entry in `stills`; every `depicts` entry matches a cast member through `depictedMembers`; each depicted member is depicted by at least one named still (matched the same way). `kept` is cut to `places`.
  - `PACKAGE_STATES = ['planned', 'painting', 'ready', 'failed'] as const`, `TEST_RESULTS = ['won', 'lost', 'same', 'inconclusive'] as const`.
  - `ThumbnailReferenceSchema = z.object({ id: UlidSchema, r2Key: z.string().min(1), mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), note: z.string().trim().max(200).default(''), inUse: z.boolean().default(false) })`.
  - `ThumbnailSettingsSchema = z.object({ styleNote: z.string().trim().max(600).default(''), references: z.array(ThumbnailReferenceSchema).max(6).default([]) })` refined: at most 3 `inUse`, message `At most three reference thumbnails can be in use.`
  - `ThumbnailSetRequestedSchema = z.object({ projectId: UlidSchema, targetId: UlidSchema, mode: z.enum(['set', 'paint', 'compose']), packageId: UlidSchema.optional() })` refined: `packageId` required unless `mode === 'set'`.
- Produces, in `settings.ts`: `DEFAULT_THUMBNAIL_ROUTE`; `ModelRoutingSchema.thumbnails: StillRouteSchema.default(DEFAULT_THUMBNAIL_ROUTE)`; `BrandLookSchema.thumbnailMarkPlacement: z.enum(['none', 'tl', 'tr', 'bl']).default('tl')` (no `br`); `SettingsSchema.thumbnails: ThumbnailSettingsSchema.prefault({})`, also in `SettingsPatchSchema` and `DEFAULT_SETTINGS`.
- Produces, in `events.ts`: `'thumbnails/set.requested': ThumbnailSetRequestedSchema` in `EVENT_SCHEMAS`.

- [ ] **Step 1: Write the failing tests** in `thumbnails.test.ts`:
  - `counts headline words`: `''` is 0, `'  The $47bn  lie '` is 3.
  - `reads a figure whatever its punctuation`: `figuresIn('$47 Billion in 2019')` is `['47', '2019']`; `figuresIn('47,000 staff.')` is `['47000']`; a package titled `The $47 Billion Lie` citing a claim `valued at $47bn in 2019` is kept; `47,000 staff` against `47000 employees` is kept.
  - `drops a figure no claim holds`: title `The $48 Billion Lie`, same claim, dropped with a reason naming `48`.
  - `matches a depicted name the way the cast does`: `depicts: ['Adam Neumann, co-founder of WeWork']`, cast `[{ name: 'Adam Neumann' }]`, a still `{ slotId: 's1', depicts: ['Adam Neumann'] }` named in `stillSlotIds`: kept.
  - `drops a person no named still shows`: same package with `stillSlotIds: []`: dropped.
  - `drops a name the cast does not hold`, `drops an unknown claim id`, `drops an unknown still`, `drops a five-word headline`.
  - `never repeats an idea`: two `person` packages keep the first; a `figure` package with `heldIdeas: ['figure']` is dropped.
  - `cuts to the free places`: three valid packages with `places: 2` keep two.
  - `a request for one package needs its id`: `mode: 'paint'` without `packageId` fails; `mode: 'set'` without it passes.
  - In `settings` tests: a stored settings row with no `thumbnails`, no `modelRouting.thumbnails` and no `look.thumbnailMarkPlacement` parses to the defaults; `thumbnailMarkPlacement: 'br'` is refused; four references `inUse` are refused.
- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run thumbnails` from `packages/schemas`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the interfaces above.
- [ ] **Step 4: Run** `pnpm exec vitest run` in `packages/schemas`, then `pnpm typecheck` at the root (the new required-with-default keys must not break any consumer). Expected: PASS.
- [ ] **Step 5: Commit** `feat(schemas): thumbnail package shapes, rules and settings`.

### Task 2: A style channel on the image adapter

**Files:**
- Modify: `packages/providers/src/visuals/types.ts`, `gemini.ts`, `fal.ts`, `mock.ts`, `gemini.test.ts`, `adapters.test.ts`

**Interfaces:**
- Produces: `ImageReference.kind: 'character' | 'object' | 'style'`; `ReferenceLimits.styles: number`. Gemini limits: `gemini-3-pro-image` 3; every other row and `UNDOCUMENTED_LIMITS` 0. fal 0. Mock 3.
- `referenceLabel` for a style reference ends: `Use it for the look only: palette, light and finish. Never copy its subject or its layout.`
- Request order: characters, then objects, then styles.
- More styles than the limit throws `ValidationError`: `<label> takes at most <n> style references; this request carries <m>.` and, at a limit of 0, `<label> takes no style references. Route thumbnails at Gemini 3 Pro Image, or switch the references off.`

- [ ] **Step 1: Write the failing tests** in `gemini.test.ts`: `sends style references last, each with its label` (parts order and the label text); `refuses a style reference on a model with no style channel` (3.1 Flash, the 0 message, no fetch made); `refuses a fourth style reference on Pro`; `reports three styles for Pro and none for Flash` (`referenceLimits`).
- [ ] **Step 2: Run** `pnpm exec vitest run gemini` in `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.** `apps/web/lib/still-prompt.ts` `referenceBudgets` keeps returning only `characters` and `objects`; do not thread styles into stills.
- [ ] **Step 4: Run** the providers suite and `apps/web` typecheck. Expected: PASS.
- [ ] **Step 5: Commit** `feat(providers): style references on the Gemini image adapter`.

### Task 3: The planner's prompt and the picture prompt

**Files:**
- Create: `packages/providers/src/prompts/thumbnails.ts`, `packages/providers/src/prompts/thumbnails.test.ts`
- Modify: `packages/providers/src/index.ts`

**Interfaces:**
- Consumes: `PlannedPackage`, `PlannedPackageSchema`, `THUMBNAIL_IDEAS`, `HEADLINE_WORDS_MAX` (Task 1); `ScriptClaim`, `BibleInUse`, `parseJsonCompletion` and the request shape `buildTitlesRequest` returns (read `prompts/metadata.ts` first and follow it).
- Produces:
  - `buildThumbnailSetRequest(input: { bible: BibleInUse; channelName: string; caseTitle: string; hook: string; claims: ScriptClaim[]; cast: { name: string; role: string; guardrail: string }[]; stills: { slotId: string; shows: string; depicts: string[] }[]; places: number; heldIdeas: ThumbnailIdea[]; titleFrame?: { pattern: string; required: readonly string[] }; styleNote: string; referenceNotes: string[]; pastResults?: string })`: same return type as `buildTitlesRequest`.
  - `parseThumbnailSet(text: string): PlannedPackage[]`: a JSON envelope `{ packages: [...] }`; an entry that fails `PlannedPackageSchema` is skipped, not thrown.
  - `mockThumbnailSet(input: { workingTitle: string; places: number; heldIdeas: ThumbnailIdea[]; claimIds: string[] }): PlannedPackage[]`: deterministic, titles and headlines prefixed `[mock]`, ideas taken in `THUMBNAIL_IDEAS` order skipping `person` and held ones, `depicts: []`, `stillSlotIds: []`, `claimIds` the first id given.
  - `buildThumbnailPicturePrompt(input: { picture: PictureBrief; styleNote: string; guardrails: { name: string; guardrail: string }[]; attached: { people: string[]; stills: number; styles: number } }): string`.
- The request's rules, each a sentence the test can find: three different ideas from the list with what each means; the thumbnail must promise only what the claims support and name the claim ids it rests on; a person may appear only if in the cast and only with a still that shows them; the headline is at most four words and adds to the title, never repeats it; the title is at most 100 characters and follows the title frame when one is given; ideas in `heldIdeas` are taken.
- The picture prompt opens with framing, in this order: `A 16:9 photograph.` then the subject filling at least half the frame height, then `The <left|right> third is plain and uncluttered, kept clear for a headline.` It closes with `No text, no letters, no logos, no watermark, no interface elements.` Guardrail text follows any named person. The attached counts are stated only for what actually travels.

- [ ] **Step 1: Write the failing tests:** `asks for the free places only` (places 2 and held ideas named); `shows the claims with their ids`; `shows each still with its slot id and who it depicts`; `carries the title frame when the format has one`; `leaves past results out when none are given`; `parses packages and skips a malformed one`; `mock set never plans a person and never repeats a held idea`; `the picture prompt leads with framing` (the first sentence and the clear-third sentence precede the subject's details); `the picture prompt ends by refusing text and logos`; `declares only the references that travel` (styles 0 says nothing of style).
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnails` in `packages/providers`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the providers suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(providers): the thumbnail set planner and picture prompts`.

### Task 4: The packages table and its helpers

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/thumbnail-packages.ts`, `packages/db/src/thumbnail-packages.integration.test.ts`, `packages/db/drizzle/0056_thumbnail_packages.sql` (generated with `pnpm db:generate`, renamed)

**Interfaces:**
- Produces, table `thumbnail_packages`: `id`, `publishRecordId` (fk `publish_records.id`, on delete cascade, indexed), `position` integer, `source` text (`generated` or `uploaded`), `state` text (`PACKAGE_STATES`, default `ready`), `idea` text null, `angle` text default `''`, `title` text default `''`, `headline` text default `''`, `picture` jsonb null (`PictureBrief`), `claimIds` text[] default `{}`, `depicts` text[] default `{}`, `pictureKey` text null, `composedKey` text null, `textSide` text default `'left'`, `warnings` jsonb default `[]` (`string[]`), `error` text null, `approvedAt` timestamptz null, `result` text null (`TEST_RESULTS`), `watchTimeShare` real null, `createdAt`, `updatedAt`. `type ThumbnailPackageRow`.
- Produces, on `publish_records`: `testReminderSentAt`, `testStartedAt`, `testEndedAt`, all timestamptz null.
- Produces, in `thumbnail-packages.ts`:
  - `listThumbnailPackages(db, publishRecordId): Promise<ThumbnailPackageRow[]>` by `position`.
  - `getThumbnailPackage(db, id): Promise<ThumbnailPackageRow | undefined>`.
  - `ensureUploadedPackages(db, record: PublishRecordRow): Promise<void>`: one `uploaded`, approved, `ready` row for each key in `uploadedThumbKeys` that no row's `composedKey` holds, positions continuing after the highest. Idempotent.
  - `replaceUnapprovedGenerated(db, publishRecordId, planned: PlannedPackage[]): Promise<{ inserted: ThumbnailPackageRow[]; orphanedKeys: string[] }>`: one transaction; deletes rows with `source = 'generated'` and `approvedAt` null, inserts the planned ones as `planned` at the next positions. `orphanedKeys` are the deleted rows' `pictureKey` and `composedKey`.
  - `updateThumbnailPackage(db, id, patch: Partial<...>): Promise<ThumbnailPackageRow | undefined>`.
  - `addUploadedPackage(db, publishRecordId, key: string): Promise<ThumbnailPackageRow>`.
  - `makeDefaultPackage(db, publishRecordId, packageId): Promise<void>`: one transaction; that package becomes position 0, the rest keep their order; when the package is approved, `uploaded_thumb_keys` is rewritten in the new order and `metadata.title` takes its title when the title is not empty.
  - `approvePackages(db, publishRecordId): Promise<{ ok: true; keys: string[]; title: string | null } | { ok: false; over: number }>`: one transaction; candidates are unapproved rows with a `composedKey` and `state = 'ready'`; when approved plus candidates exceeds 3 it changes nothing and returns `over` (the excess); otherwise stamps them, writes every approved `composedKey` to `uploaded_thumb_keys` in position order, and writes position 0's title to `metadata.title` when not empty.
  - `removeThumbnailPackage(db, id): Promise<{ orphanedKeys: string[] } | undefined>`: one transaction; deletes the row and, when approved, removes its key from `uploaded_thumb_keys`.
  - `approvedDepicts(db, publishRecordId): Promise<string[]>`: distinct `depicts` of approved `generated` rows.
  - `recordsAwaitingTestReminder(db, channelId): Promise<{ id: string; targetId: string; youtubeVideoId: string }[]>`: master records with `status = 'live'`, `testReminderSentAt` null, a video id, and at least two approved packages.

- [ ] **Step 1: Write the failing integration tests** (each makes its own project and publish record and deletes them in `finally`; never touch the shared fixture): `backfills a row per stored key, once`; `replaces unapproved generated packages and keeps approved and uploaded ones`; `approval writes keys in position order and the default's title`; `approval leaves a failed package unapproved`; `refuses approval past three and changes nothing` (returns `{ ok: false, over: 1 }`, `uploaded_thumb_keys` unchanged); `making an approved package the default reorders the keys and the title`; `removing an approved package removes its key`; `lists depicted names of approved generated packages only`; `finds live masters with two approved packages and no reminder`.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-packages` in `packages/db`. Expected: FAIL.
- [ ] **Step 3: Add the table and columns, generate the migration, implement the helpers.**
- [ ] **Step 4: Run** `pnpm db:migrate:test`, then the file again, then the whole db suite alone. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): thumbnail packages and their approval`.

### Task 5: Composing the thumbnail

**Files:**
- Create: `apps/web/lib/thumbnail-document.ts`, `apps/web/lib/thumbnail-document.test.ts`, `apps/web/lib/thumbnail-compose.ts`
- Modify: `apps/web/lib/graphic-code/frames.ts`, `apps/web/lib/storage.ts`

**Interfaces:**
- Consumes: `GraphicProps['brand']`, `fontsHref`, `contrastRatio`, `TextBox`, `launchBrowser` (all in `frames.ts`); the constants of Task 1.
- Produces, in `thumbnail-document.ts` (pure, no server imports):
  - `SCRIM_ALPHA = 0.72`.
  - `headlineFontPx(headline: string): number`: 220 for up to 8 characters, falling linearly to `HEADLINE_MIN_PX` at 28 characters, never below it.
  - `scrimContrast(text: string, background: string, alpha = SCRIM_ALPHA): number | null`: the lower of the text's contrast against the scrim colour laid over white and over black.
  - `thumbnailDocument(input: { pictureSrc: string; headline: string; textSide: 'left' | 'right'; brand: GraphicProps['brand']; mark: { src: string } | { wordmark: string } | null; markPlacement: 'none' | 'tl' | 'tr' | 'bl' }): string`: a full HTML page with `<div id="frame">` 1920 by 1080, the picture `object-fit: cover`, a scrim on the text side only when the headline is not empty, the headline in `brand.fonts.heading` at `headlineFontPx`, upper case, inside the outer 44% of the width on its side and above 84% of the height, and the mark at `THUMB_MARK_HEIGHT_RATIO` and `THUMB_MARK_ALPHA` with a 4% inset. Headline text is HTML-escaped.
  - `thumbnailWarnings(input: { headline: string; fontPx: number; boxes: readonly TextBox[]; contrast: number | null }): string[]`, exact strings: `The headline is <n> words; four is the ceiling.`, `The headline's type is under the size floor.`, `The headline does not stand out enough from what is behind it.`, `The headline runs outside the frame.`, `The headline sits where YouTube draws the duration.`
- Produces, in `frames.ts`: `screenshotFrame(input: { html: string; width: number; height: number; quality?: number; timeoutMs?: number }): Promise<{ jpeg: Buffer; boxes: TextBox[] }>`: a page at exactly that viewport, `deviceScaleFactor: 1`, not `fullPage`, boxes from the existing in-page measure, same launch, time bounds and `FramesUnavailable` wrapping as `screenshotDocument`.
- Produces, in `storage.ts`: `thumbnailPictureKey({ targetId, contentHash, ext })` giving `boom-busters/thumbs/<targetId>/art-<hash>.<ext>`; `thumbnailComposedKey({ targetId, contentHash })` giving `boom-busters/thumbs/<targetId>/<hash>.jpg`; `thumbnailReferenceKey({ channelId, contentHash, ext })` giving `boom-busters/thumb-refs/<channelId>/<hash>.<ext>`.
- Produces, in `thumbnail-compose.ts` (`server-only`): `composeThumbnail(input: Parameters<typeof thumbnailDocument>[0]): Promise<{ jpeg: Buffer; warnings: string[] }>`: builds the document, calls `screenshotFrame` at 1920 by 1080 quality 90, returns `thumbnailWarnings`.

- [ ] **Step 1: Write the failing tests** in `thumbnail-document.test.ts`: `composes without a headline` (no scrim element, no headline element, `thumbnailWarnings` empty); `puts the scrim and the headline on the asked side`; `escapes the headline` (`<b>` appears as text); `uses the real mark when there is one and the wordmark when there is not`; `leaves the mark out at none`; `never places the mark bottom right` (each of `tl`, `tr`, `bl` yields no `right` plus `bottom` pair); `sizes type between the ceiling and the floor` (8 characters 220, 28 characters 120, 60 characters 120); `warns on five words`; `warns when a word cannot fit at the floor` (a box wider than the frame gives the outside-the-frame warning); `warns when a box enters the keep-out`; `measures contrast against the worse of light and dark` (a mid-grey text on a mid-grey scrim is under 4.5 and warns).
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-document` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the pure module, then `screenshotFrame`, the keys and `composeThumbnail`.
- [ ] **Step 4: Prove the browser path once by hand:** a temporary `.mts` inside `apps/web` that calls `composeThumbnail` with a local picture and writes the JPEG to the scratchpad; open it, check it is 1920 by 1080 with the headline and mark in place; delete the script. Then run the file's tests and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the thumbnail's type and mark, composed in the browser`.

### Task 6: Plan, paint, compose: the runner

**Files:**
- Create: `apps/web/lib/thumbnail-set.ts`, `apps/web/lib/thumbnail-set.test.ts`, `apps/web/lib/publish-grounding.ts`, `apps/web/inngest/functions/thumbnail-set-runner.ts`, `apps/web/inngest/functions/thumbnail-set-runner.test.ts`
- Modify: `apps/web/inngest/events.ts`, `apps/web/inngest/functions/index.ts`, `apps/web/lib/model-catalogue.ts` (add `routing.thumbnails` to the routes `stillCatalogue` lists), `apps/web/app/(console)/projects/[id]/publish-actions.ts` (its private `metadataGrounding` and `titleFrameFor` move to `publish-grounding.ts` unchanged and are imported back, so the planner is grounded exactly as the titles are)

**Interfaces:**
- Consumes: Tasks 1 to 5; `callForAnswer`, `completeForProject`, `withCost`, `stillCatalogue`, `stillGenerator`, `visualCredentials`, `imageGenPrice`, `getObjectBytes`, `putObject`, `presignGet`, `listShotSlots`, `listCastMembers`, `scriptableClaims`, `descriptionIngredients`, `channelForProject`, `resolveBrandKit`, `graphicBrand`, `mockProvidersEnabled`. Read `apps/web/lib/set-sheet.ts` first: the paint step follows its `withCost` shape.
- Produces, in `thumbnail-set.ts` (`server-only`):
  - `thumbnailSetEstimateUsd(channelId: string, images: number): Promise<number>`.
  - `filmStills(projectId: string): Promise<{ slotId: string; shows: string; depicts: string[]; r2Key: string; mimeType: string }[]>`: chosen candidates of `still` and `hero` slots that hold an `r2Key`.
  - `planThumbnailSet(input: { projectId: string; publishRecordId: string }): Promise<{ inserted: string[]; dropped: { idea: ThumbnailIdea; reason: string }[] }>`: reads the record's packages; `places = PACKAGES_MAX` minus the approved ones, `heldIdeas` their ideas; gathers the planner's inputs through `metadataGrounding` and `titleFrameFor`, calls it (mock: `mockThumbnailSet`), vets with `vetPlannedPackages`, asks once more for the missing places when any were dropped (naming the kept ideas as held), then `replaceUnapprovedGenerated` and deletes the orphaned objects. `inserted` is the new package ids in position order.
  - `paintThumbnailPicture(packageId: string): Promise<void>`: sets `painting`; references are the depicted cast members' photos as `character` (at most the model's limit), the named stills as `object`, the channel's in-use references as `style` only when the model's `styles` limit is above 0; one image at `'2K'` inside `withCost` with `operation: 'image.generate'`, `meta.kind: 'thumbnail'`; stores the bytes under `thumbnailPictureKey`; on any error sets `state: 'failed'` and `error` to the message and does not rethrow.
  - `composeThumbnailPackage(packageId: string): Promise<void>`: reads the row, the channel's brand kit and mark, composes, stores under `thumbnailComposedKey`, writes `composedKey`, `warnings`, `state: 'ready'`; when the row is approved it also swaps the old key for the new one in `uploaded_thumb_keys`; deletes the old composed object. Mock mode: the rule in Global Constraints.
- Produces: `events.thumbnailSetRequested`; the function `thumbnailSetRunner`, id `thumbnail-set-runner`, `concurrency: [{ key: 'event.data.targetId', limit: 1 }]`, `retries: 1`, `cancelOn` `project/cancelled` as the publish runner has it. Steps: `set` runs `plan`, then for each inserted package `paint-<id>` and `compose-<id>` (compose skipped when the paint failed); `paint` runs `paint-<id>` then `compose-<id>`; `compose` runs `compose-<id>`. `onFailure` marks every `planned` or `painting` row of the record `failed` with the error's message.

- [ ] **Step 1: Write the failing tests.** In `thumbnail-set.test.ts` (adapters and db mocked): `estimates three images at the routed model's 2K price` (0.45 on the default); `plans only the free places and tells the planner the held ideas`; `asks once more when a package is dropped, never twice`; `sends style references only to a model that takes them`; `a refused picture fails its own package only` (the adapter throws `ContentPolicyError` for one of three: two rows `ready`, one `failed` with the reason, and the refused image recorded as no spend); `a budget refusal fails the package in words`; `composing an approved package swaps its key in the record`. In `thumbnail-set-runner.test.ts` with `@inngest/test`: `a set plans, then paints and composes each package` (step ids in order, three image calls counted); `paint mode touches one package`; `compose mode buys nothing` (zero image calls); `a crash marks unfinished packages failed`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files, then the whole `apps/web/inngest` directory, then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): the thumbnail set runner`.

### Task 7: The actions

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/thumbnail-actions.ts`, `thumbnail-actions.test.ts`
- Modify: `apps/web/app/(console)/projects/[id]/publish-actions.ts` (`uploadThumbnail` calls `addUploadedPackage`; `removeThumbnail` calls `removeThumbnailPackage` for the row holding that key)

**Interfaces:**
- Consumes: Task 4 helpers (the db's `approvePackages` is what the action `approveThumbnailSet` calls), `events.thumbnailSetRequested`, `thumbnailSetEstimateUsd`. Follow `publish-actions.ts` for `requireOwner`, `parseTarget`, the editable rule (`draft` or `failed`; reuse its two refusal sentences) and the complete-bible gate; move those helpers to a shared non-`'use server'` module only if importing them is otherwise impossible.
- Produces, all returning `ActionResult`:
  - `generateThumbnailSet(targetType: string, targetId: string)`. Refusals, exact: three approved `Three thumbnails are already approved. Remove one to generate more.`; a package `planned` or `painting` `A set is being made. Wait for it to finish.`; no stored key for the routed provider outside mock mode `Thumbnails run on <provider>, but no <provider> key is stored in Settings, Connections.`; no verified claim `There are no verified claims to build a thumbnail on.` Otherwise `ensureUploadedPackages`, then sends `mode: 'set'`.
  - `regenerateThumbnailPicture(packageId: string)`: generated, unapproved or approved, record editable; sends `mode: 'paint'`.
  - `saveThumbnailPackage(packageId: string, patch: { title?: string; headline?: string; textSide?: 'left' | 'right'; idea?: ThumbnailIdea | null })`: title at most 100; a changed `headline` or `textSide` on a generated package sends `mode: 'compose'`; a changed title on the approved default also writes `metadata.title`; `idea` only on an uploaded package.
  - `makeDefaultThumbnail(packageId: string)`, `removeThumbnailPackageAction(packageId: string)` (deletes the orphaned objects after the row).
  - `approveThumbnailSet(targetType: string, targetId: string)`: on `{ ok: false, over }` returns `Three thumbnails at most. Remove <over> before approving.`; nothing to approve returns `There is nothing new to approve.`

- [ ] **Step 1: Write the failing tests** (db against the test database as `publish-actions.test.ts` does, Inngest `send` mocked): `refuses a Short`; `refuses when the record is on YouTube`; `refuses a second set while one is being made`; `refuses with three approved`; `sends one set request and backfills uploads first`; `a headline edit recomposes and buys nothing` (one `compose` event, no `paint`); `a title edit on the approved default updates the upload title`; `refuses to approve past three` (three ready generated plus one upload: the exact sentence, keys unchanged); `approval replaces a saved title with the default's`; `an uploaded PNG gets a package row, and removing it removes both`.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-actions` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then `pnpm exec vitest run publish-actions` alone. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): generate, edit and approve a thumbnail set`.

### Task 8: The Publish card

**Files:**
- Create: `apps/web/app/(console)/projects/[id]/thumbnail-set.tsx`, `thumbnail-set.test.tsx`
- Modify: `apps/web/lib/publish-review.ts`, `apps/web/app/(console)/projects/[id]/publish-screen.tsx`, `publish-screen.test.tsx` (every literal record gains `packages: []` and the new fields)

**Interfaces:**
- Produces, in `publish-review.ts`: `interface ThumbnailPackageProp { id: string; position: number; source: 'generated' | 'uploaded'; state: 'planned' | 'painting' | 'ready' | 'failed'; idea: ThumbnailIdea | null; angle: string; title: string; headline: string; textSide: 'left' | 'right'; depicts: string[]; warnings: string[]; error: string | null; approved: boolean; url: string | null; result: 'won' | 'lost' | 'same' | 'inconclusive' | null; watchTimeShare: number | null; slotMisses: TitleSlot[] }`; `PublishRecordProp` gains `packages: ThumbnailPackageProp[]`, `testStartedAtIso: string | null`, `testEndedAtIso: string | null`; `PublishItemModel` gains `thumbnailSetCostUsd: number | null` (master only, for the free places), `studioUrl: string | null` (`https://studio.youtube.com/video/<id>/edit` when a video id exists) and `styleReferencesLeftOut: string | null` (the routed model's label when its `styles` limit is 0 and the channel has references in use, else null). `publishModel` calls `ensureUploadedPackages` for a master's record and computes `slotMisses` with `missingTitleSlots` when the format has a title frame.
- Produces: `<ThumbnailSet item={PublishItemModel} busy={boolean} />`, a client component, shown for masters in place of the tile strip; Shorts keep today's strip unchanged.
- Layout and copy follow spec 7.7. Exact labels: `Generate a set · about $<cost>`, `Regenerate picture`, `Text left`, `Text right`, `Make default`, `Remove`, `Approve this set`, `Download thumbnail`, `Copy title`, `Open this video in Studio`. Section headings `Thumbnails and titles` and `Test & Compare in Studio`. Under a package that depicts someone: `Shows: <names>`. Beside Approve when a different title is saved: `This replaces the saved title "<title>".` A failed package shows its `error`. Style references left out on a model without a style channel: `Reference thumbnails were left out: <model label> takes none.`
- Each ready package shows the composed image large, then at 320 px and 168 px wide on a dark and a light ground with its title beneath in the console's body face.
- While any package is `planned` or `painting` the component refreshes the route every 3 seconds and the Generate and Approve buttons are disabled.
- The hand-off panel shows when the record's status is `uploaded`, `scheduled` or `live` and at least two packages are approved: `Variant 1 is on the video. Start a test with the other two:` then one row per other approved package.

- [ ] **Step 1: Write the failing component tests:** `shows the cost on the generate button`; `shows each package with its idea, promise, title and headline`; `shows who a package depicts`; `shows a warning and still allows approval`; `shows a failed package's reason and a regenerate button`; `disables generate and approve while a set is being made`; `names the title approval will replace`; `only the first package lacks a Make default button`; `shows the hand-off after upload with a download and a copy per other variant`; `a Short keeps the plain upload strip`.
- [ ] **Step 2: Run** `pnpm exec vitest run thumbnail-set` in `apps/web`. Expected: FAIL.
- [ ] **Step 3: Implement** the model fields, the component and the wiring.
- [ ] **Step 4: Run** `thumbnail-set`, `publish-screen` and `publish-review` files, then `pnpm typecheck` and `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): the thumbnail set on the Publish card`.

### Task 9: The channel's thumbnail references and routing

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/thumbnails-tab.tsx`, `thumbnails-tab.test.tsx`, `thumbnail-reference-actions.ts`, `thumbnail-reference-actions.test.ts`
- Modify: `apps/web/app/(console)/c/[slug]/settings/page.tsx` (`TABS` gains `'thumbnails'` after `'logos'`), `settings-form.tsx`, `models-tab.tsx` (`ImageRoute` gains `'thumbnails'`, label `Thumbnails`), `voice-tab.test.tsx` (mock the new actions module, or that file fails at suite level)

**Interfaces:**
- Consumes: `ThumbnailSettingsSchema`, `thumbnailReferenceKey`; follow `logo-actions.ts` and `logos-tab.tsx` for upload, validation and layout.
- Produces, all returning `ActionResult`: `uploadThumbnailReference(formData: FormData)` (fields `slug`, `file`; PNG, JPEG or WebP, at most 8 MB; refuses a seventh with `Six reference thumbnails at most. Remove one first.`); `saveThumbnailReference(slug: string, id: string, patch: { note?: string; inUse?: boolean })` (a fourth in use refused with the schema's sentence); `removeThumbnailReference(slug: string, id: string)` (deletes the object when no other row holds it); `saveThumbnailStyle(slug: string, input: { styleNote: string; markPlacement: 'none' | 'tl' | 'tr' | 'bl' })`.
- The tab: a `Style note` field with a Save button, a `Mark on thumbnails` choice (`Top left`, `Top right`, `Bottom left`, `None`) with the line `Bottom right is where YouTube draws the duration.`, an upload button `Add a reference thumbnail`, and one card per reference with its picture, a note field, an `In use` switch and a `Remove` button. Under the list: `References steer the look. They are never published and never copied.`

- [ ] **Step 1: Write the failing tests:** actions `stores a reference and its note`, `refuses a seventh reference`, `refuses a fourth in use`, `removing a reference deletes its object`, `saves the style note and the mark's corner`; tab `lists references with their notes and switches`, `offers no bottom right corner`; models tab `routes thumbnails on their own row`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the whole `settings` directory's tests (they share mocks), then `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(settings): thumbnail references, style note and routing`.

### Task 10: The label and the reminder

**Files:**
- Modify: `apps/web/inngest/functions/publish-runner.ts`, `publish-runner.test.ts`, `apps/web/inngest/functions/analytics-runner.ts`, its test, `apps/web/lib/publish-review.ts` (the card's `syntheticLikenesses` list)

**Interfaces:**
- Consumes: `approvedDepicts`, `recordsAwaitingTestReminder`, `updatePublishRecord`, `notify`.
- Produces: in the runner's `preflight` step, `containsSyntheticMedia` is true when `syntheticLikenesses(...)` is non-empty or `approvedDepicts(db, record.id)` is non-empty, for a master. The card's list is the union, deduplicated through the cast's spelling.
- Produces: in the analytics run, after `reconcile-live-<channelId>`, a step `test-reminders-<channelId>`: for each record from `recordsAwaitingTestReminder`, `notify({ kind: 'heads-up', title: 'Start the Test & Compare', body: '<title> is public. Variant 1 is on the video; the other approved variants are waiting on its Publish card.', href: '/projects/<projectId>?stage=publish' })`, then stamp `testReminderSentAt`. Mock mode included.

- [ ] **Step 1: Write the failing tests:** runner `labels the upload when an approved generated thumbnail shows a cast member` (film slots have no generated likeness); `an unapproved package labels nothing`; analytics `reminds once when a master with two approved packages goes live` (second run sends nothing); `sends no reminder for a single thumbnail`.
- [ ] **Step 2: Run** `pnpm exec vitest run publish-runner` and `analytics-runner`. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the approved packages inside the step that uses them.
- [ ] **Step 4: Run** both files and the `inngest` directory. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): thumbnails count toward the altered-content label; a reminder to start the test`.

### Task 11: End to end, and the record of the decision

**Files:**
- Create: `e2e/tests/thumbnail-set.spec.ts`
- Modify: `PROGRESS.md`, `docs/03-build-spec.md` (section 2's out-of-scope line and the thumbnails bullet in section 9), `docs/02-app-spec-and-dev-plan.md` (the non-goal and the thumbnail lane), `apps/web/lib/thumbnail-rules.ts` (`thumbnailHint` for a master: `Thumbnail: generate a set, or export from Canva. 16:9, 1280×720 ideal, up to 3, 2 MB max for an upload. Masters need one before upload.`)

- [ ] **Step 1: Write the e2e spec** (mock mode, own project made in the test and removed after): open the master's Publish card, press `Generate a set`, wait for three packages, edit one headline, press `Approve this set`, see the first package marked Default and the title field holding its title, schedule into a past slot, see `Test & Compare in Studio` with two `Copy title` buttons.
- [ ] **Step 2: Run it from the `e2e` package with its own port** (`E2E_PORT` off 3100), this spec only. Expected: PASS. Then run the existing `publish.spec.ts` the same way.
- [ ] **Step 3: Record decision 484** in `PROGRESS.md` (check the number against `origin/master` first): what changed, that it reverses the spec's out-of-scope line at the owner's request of 2026-11-24, the calls the spec marks as the builder's, and a checklist section for this work. Amend the two spec documents to say thumbnails may be generated in the app or uploaded from Canva.
- [ ] **Step 4: Full verification, split:** each package's suite on its own, `apps/web` by directory, the e2e suite in batches, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`. Expected: all PASS; rule any of the five known local e2e failures as pre-existing only after baselining it on master.
- [ ] **Step 5: Commit** `test(e2e): generate, approve and hand over a thumbnail set` and `docs: decision 484, generated thumbnails and title sets`.

Phase 1 ends here. A paid check on real pictures ($0.45 a set) is the owner's to ask for before merge; confirm `gemini-3-pro-image` against the key's own `ListModels` first.

### Task 12: Test started, and how it ended (phase 2)

**Files:**
- Modify: `apps/web/app/(console)/projects/[id]/thumbnail-actions.ts`, `thumbnail-actions.test.ts`, `thumbnail-set.tsx`, `thumbnail-set.test.tsx`, `apps/web/app/(console)/projects/[id]/publish-actions.ts`
- Create: `apps/web/lib/test-running.ts`, `apps/web/lib/test-running.test.ts`

**Interfaces:**
- Produces, in `test-running.ts`: `testRunningReason(record: { testStartedAt: Date | null; testEndedAt: Date | null }): string | null`, returning `A Test & Compare is running on this video. YouTube stops the test if its title or thumbnail changes; record how it ended first.` while started and not ended.
- Produces: `markTestStarted(targetType: string, targetId: string)`: record `uploaded`, `scheduled` or `live` with at least two approved packages; stamps `testStartedAt`. `recordTestResult(targetType: string, targetId: string, input: { outcome: { winner: string } | 'same' | 'inconclusive'; shares?: Record<string, number> })`: `winner` is a package id, which gets `won` and the other approved packages `lost`; `same` and `inconclusive` are written to every approved package; a share is 0 to 100 and stored per package; stamps `testEndedAt`. Refused before `markTestStarted`.
- `schedulePublish` calls `testRunningReason` and refuses with its sentence.
- UI, exact labels: `I have started the test`; then `How did the test end?` with `<n> won` per approved package, `Performed the same`, `Inconclusive`, and optional `Watch time share` fields.

- [ ] **Step 1: Write the failing tests:** `a running test has a reason, an ended or unstarted one has none`; `marks a test started only with two approved packages on an uploaded video`; `a winner marks the others lost`; `the same and inconclusive are never recorded as wins or losses`; `refuses a result before the test started`; `refuses a share above 100`; `refuses a new schedule while a test runs`; component `offers the result buttons only after the test started`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** them and `publish-actions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(publish): record a Test & Compare's start and result`.

### Task 13: What has won (phase 2)

**Files:**
- Modify: `packages/db/src/thumbnail-packages.ts` and its integration test, `packages/schemas/src/thumbnails.ts` and its test, `apps/web/lib/thumbnail-set.ts` and its test, `thumbnails-tab.tsx` and its test, `thumbnail-reference-actions.ts` and its test, `thumbnail-set.tsx` and its test, `PROGRESS.md`

**Interfaces:**
- Produces, db: `ideaResults(db, channelId): Promise<{ idea: ThumbnailIdea; tests: number; wins: number }[]>` over packages with a result and an idea, a test counted once per record per idea; `finishedTests(db, channelId): Promise<{ withWinner: number; same: number; inconclusive: number }>`.
- Produces, schemas: `whatHasWon(results: { idea: ThumbnailIdea; tests: number; wins: number }[], withWinner: number): string | null`: null below `WINS_MIN_TESTS`; otherwise one sentence per idea, `Person: won 3 of 4 tests.`, most tests first.
- `planThumbnailSet` passes `whatHasWon(...)` as `pastResults` when not null.
- Settings tab card `What has won`: the counts per idea, the counts of tests that ended the same or inconclusive, and below five tests with a winner the line `<n> of 5 tests with a winner. The planner is told nothing until there are five.`
- `addWinnerToReferences(packageId: string)` in `thumbnail-reference-actions.ts`: a package with `result = 'won'`; copies its composed object to a reference key, note `Won its test: <title>`, `inUse: false`; refuses a seventh with the sentence from Task 9. Button `Add to references` on a winning package.

- [ ] **Step 1: Write the failing tests:** db `counts tests and wins per idea, one test per video`; schemas `says nothing below five tests with a winner`, `lists ideas most tested first`; lib `tells the planner what has won only when there is something to tell`; tab `shows the counts and how many tests are still needed`; action `adds a winner as a reference that is not in use`, `refuses a package that did not win`.
- [ ] **Step 2: Run** the files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Full verification as in Task 11 Step 4.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(thumbnails): what has won, told to the planner`, then tick phase 2 in `PROGRESS.md`.
