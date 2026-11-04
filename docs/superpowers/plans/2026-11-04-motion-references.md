# Motion references: ingest, readings and the identity draft. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A channel's owner uploads stills and clips, marks the window that matters on each clip, and the tool reads every reference into a one-page reading; "Draft motion identity" proposes the channel's identity from the readings and a brief, shown as a diff with Apply and Discard.

**Architecture:** A `motion_references` table holds each reference's form, frames and reading. The browser decodes the clip and uploads the frames on presigned PUTs; the server recomputes the frame set from the window and verifies every key before it writes a row. An Inngest reader (`motion-reference-reader`) renders the two sheets in the app's Chromium and makes one vision call on the graphics route; the identity draft is one synchronous call from a server action, held in the client until Apply writes it as a `motion` settings patch. Mock mode returns fixtures for both calls.

**Tech Stack:** TypeScript, Zod 4, drizzle (Postgres), Inngest 4 with `@inngest/test`, Next.js app router server actions, presigned R2 PUTs, playwright-core Chromium (`frames.ts`), React Testing Library, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-04-channel-motion-references-design.md`, sections 4, 5.1 to 5.3, 6, 7, 8.4, 11.1 (the draft buttons), 11.2, 12.2 (sheets at 1600 px), 13. This is plan 2 of 4. Plan 1 (branch `motion-identity`, decision 395) built the identity, the tokens, the prompt slots and the Motion tab this plan extends.

## Calls the author made (check while reading)

- `motion_references` gains `readState` (`unread`, `reading`, `read`, `failed`) and `readError`, beyond spec 7.1, so a card can say what the reader is doing and why it stopped.
- The identity draft is a synchronous server action that returns the proposal; nothing is stored until Apply. A reload drops an unapplied proposal.
- The two sheets render whenever storage is configured, mock mode included (Chromium costs nothing); only the model call is mocked. Without storage the sheets step records a skip and the read runs on the single frames.
- A budget stop in the reader has no project to park, so the row records `failed` with the budget's message, as the bible drafter records a unit's error. The Costs screen shows it the same way.
- The frame keys are computed on the server from the content hash, the set and the time, so the finalise verifies exactly the keys it issued, as the own-footage upload does.
- A still's one frame is the still itself: `frames.dense = [{ atMs: 0, r2Key: <the original>, width, height }]`, no overview, no sheets.
- The pack is ordered by insertion; there is no reorder button (spec 11.2 names Add, Edit, Re-mark and Archive). Archiving leaves a gap in `position`; a new reference takes `max + 1`.
- A re-mark uploads a new frame set and leaves the old frame objects in R2 (a lifecycle concern, as `removeLogoAction` says of orphaned bytes).
- The guideline's text in the app is a typed copy of `docs/motion-references.md`; a test keeps the two in step by heading.
- The reading's estimate shown beside "Save and read" is `estimateLlmUsd` on the graphics route with fixed token counts (`READING_INPUT_TOKENS`, `READING_OUTPUT_TOKENS`), computed on the settings page, not by an action.

## Global Constraints

- Paid calls run only on the owner's word: a reference is read on "Save and read" or "Read", never on upload alone; the draft runs on "Draft motion identity" (spec 4). Mock mode (`mockProvidersEnabled()`) returns a fixture for every model call, so the whole flow runs end to end without spend.
- Frames are extracted in the owner's browser, never on the server (spec 4, 13). The server never decodes video.
- A reference's images go to the reader and, in later plans, the critic; never to the designer's per-shot call (spec 3, anti-goals). Nothing in this plan touches `buildGraphicRequest`.
- Links are provenance only; the app never downloads from a URL (spec 3, non-goals).
- Limits, verbatim from spec 6 and 7: stills PNG, JPEG or WebP up to 8 MB; clips MP4, WebM or MOV up to 100 MB and 90 s; the window 1 to 4 s; dense frames every 1/12 s, at most 48, 640 px wide; overview frames every 0.5 s, at most 180, 320 px wide; at most twelve live references per channel; `carryOver` and `avoid` at most 300 characters; the style guide at most 4000; sheets 1600 px wide (12.2), six columns with a timecode under each tile (7.3).
- Vercel's 300 s stands; the sheets step is bounded by `INSPECT_MAX_MS` (45 s) like the layout check.
- No channel name, niche word or taste number in code (spec 3).
- CLAUDE.md: a branch (`motion-references`), tests with the code, `pnpm lint` and `pnpm format:check` at zero warnings before every commit, PROGRESS.md decision at the end, no secrets, button-first UI (every action a labelled button; the window is set by buttons and number fields, not by drag alone).
- Written output in prompts and UI copy carries no em or en dash (the prompt test "writes no dash a reader would see" enforces it, as plan 1's did).
- Migration numbering: read `packages/db/drizzle/meta/_journal.json` before generating; the last entry is `0046_lonely_hellcat` on master at `5f8a7d7f`. If master has moved by merge time, regenerate as the next number (memory: migration numbers collide across sessions).
- Every test that renders `SettingsForm` (`archived-settings`, `brand-look`, `models-tab`, `motion-tab`, `publishing-tab`, `voice-tab`, `youtube-outcome`) must mock `./motion-actions` once it exists, or it fails at suite level (memory: a new tab's actions module).

## Review Focus

1. A clip whose frame grab stalls or returns fewer frames than the window asks for (a seek that never fires): the marker refuses to save and names the count ("Only 31 of 48 frames could be taken; choose another window"), and the server refuses a frame list that does not match the window, so no partial reference is ever written (Task 4 test "reports a grab that returns fewer frames than asked"; Task 5 test "refuses a finalise whose frames do not match the window").
2. The thirteenth live reference: refused at the finalise with "This channel already holds twelve references. Archive one first." and the uploaded object deleted best-effort (Task 2 test "refuses a thirteenth live reference"; Task 5 test "deletes the upload when the pack is full").
3. A reference re-marked after it was read: the old reading and sheets are cleared with the frames, so the card never shows a reading of a window that no longer exists (Task 2 test "a re-mark clears the reading, the sheets and the read state").
4. A draft whose proposal fails the identity schema (a still limit under the cadence, a dropped last resort, a 5000-character style guide): refused as a model refusal with the field named, nothing applied (Task 3 test "refuses a draft the identity schema refuses"; Task 8 test "shows a refusal and applies nothing").
5. A channel whose references are unread when the draft runs: each is listed to the model as unread with its carry-over line rather than dropped, and the draft still runs from the brief alone with no references at all (Task 3 tests "names an unread reference as unread" and "drafts from the brief alone"; Task 9 e2e).

---

### Task 1: Reference schemas, the frame clocks and the event

**Files:**
- Create: `packages/schemas/src/motion-references.ts`
- Modify: `packages/schemas/src/events.ts` (`MotionReferenceIngestedSchema`, `EVENT_SCHEMAS['motion/reference.ingested']`)
- Modify: `packages/schemas/src/index.ts` (export the module)
- Test: `packages/schemas/src/motion-references.test.ts`, `packages/schemas/src/events.test.ts` (one case)

**Interfaces:**
- Produces: `REFERENCE_PURPOSES = ['mechanism', 'look', 'pacing'] as const`, `ReferencePurposeSchema`, `ReferencePurpose`.
- Produces: `REFERENCE_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const`, `REFERENCE_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'] as const`, `ReferenceMimeSchema` (the union), `referenceKind(mime): 'image' | 'video'`, `referenceExtension(mime): 'png' | 'jpg' | 'webp' | 'mp4' | 'webm' | 'mov'`.
- Produces: `REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024`, `REFERENCE_VIDEO_MAX_BYTES = 100 * 1024 * 1024`, `REFERENCE_CLIP_MAX_MS = 90_000`, `REFERENCE_WINDOW_MIN_MS = 1000`, `REFERENCE_WINDOW_MAX_MS = 4000`, `REFERENCE_PACK_MAX = 12`, `DENSE_FRAMES_PER_SECOND = 12`, `DENSE_FRAMES_MAX = 48`, `DENSE_FRAME_WIDTH = 640`, `OVERVIEW_STEP_MS = 500`, `OVERVIEW_FRAMES_MAX = 180`, `OVERVIEW_FRAME_WIDTH = 320`, `REFERENCE_LINE_MAX = 300`.
- Produces: `denseFrameTimes(windowStartMs: number, windowEndMs: number): number[]` (start + i * 1000/12, rounded, while under the end, at most 48) and `overviewFrameTimes(durationMs: number): number[]` (0, 500, ... under the duration, at most 180). Both the browser and the finalise call these, so the server can recompute what the browser was asked for.
- Produces: `ReferenceFrameSchema { atMs: int >= 0, r2Key: string, width: int >= 1, height: int >= 1 }`, `ReferenceFramesSchema { dense: ReferenceFrame[] (max 48), overview: ReferenceFrame[] (max 180) }`, `ReferenceFrames`.
- Produces: `ReferenceReadingSchema { medium, type, enters, exits, motion, absent: string max 400 each; palette: string[] max 6 of max 40; notes: string max 800; readAt: ISO datetime; model: string max 80; editedAt: ISO datetime optional }`, `ReferenceReading`, `ReferenceReadingEditSchema` (the seven text fields and palette only: what the owner edits).
- Produces: `MotionReferenceEditSchema { title: trimmed 1 to 120; sourceUrl: trimmed string max 500, '' reads as null (provenance only, not fetched); rights: trimmed max 200, default 'Reference only'; purpose: ReferencePurposeSchema; negative: boolean default false; carryOver: trimmed max 300; avoid: trimmed max 300 default '' }` (the text fields the owner edits later, with no refinement, so Task 5 parses an edit with it directly). `MotionReferenceInputSchema = MotionReferenceEditSchema.extend({ kind: 'image' | 'video'; windowStartMs: int >= 0 nullable; windowEndMs: int nullable }).superRefine(...)`: a video has both window ends and `windowEndMs - windowStartMs` within 1000 to 4000 ("The window is one to four seconds"); an image has both null. `MotionReferenceInput`, `MotionReferenceEdit`.
- Produces: `MotionIdentityDraftSchema = z.object({ identity: MotionIdentitySchema, why: z.string().trim().max(1200) })`, `MotionIdentityDraft`. The model's proposal is parsed through the identity schema, so every bound and the last resorts hold.
- Produces: `MotionReferenceIngestedSchema { channelId: UlidSchema, referenceId: UlidSchema }`; `EVENT_SCHEMAS['motion/reference.ingested']`.

- [ ] **Step 1: Write the failing tests** in `motion-references.test.ts`:

```ts
it('refuses a window shorter than a second or longer than four', () => {
  const base = { kind: 'video', title: 'A', purpose: 'mechanism', carryOver: 'borrow the hold, not the glow' }
  expect(MotionReferenceInputSchema.safeParse({ ...base, windowStartMs: 0, windowEndMs: 900 }).success).toBe(false)
  expect(MotionReferenceInputSchema.safeParse({ ...base, windowStartMs: 0, windowEndMs: 4001 }).success).toBe(false)
  expect(MotionReferenceInputSchema.safeParse({ ...base, windowStartMs: 2000, windowEndMs: 5000 }).success).toBe(true)
})
it('gives a still no window and reads an empty link as null', () => {
  const r = MotionReferenceInputSchema.parse({ kind: 'image', title: 'A', purpose: 'look', carryOver: 'x', sourceUrl: '', windowStartMs: null, windowEndMs: null })
  expect(r.sourceUrl).toBeNull()
  expect(MotionReferenceInputSchema.safeParse({ kind: 'image', title: 'A', purpose: 'look', carryOver: 'x', windowStartMs: 0, windowEndMs: 2000 }).success).toBe(false)
})
it('spaces dense frames a twelfth of a second apart across the window, at most 48', () => {
  expect(denseFrameTimes(1000, 2000)).toHaveLength(12)
  expect(denseFrameTimes(1000, 2000).slice(0, 3)).toEqual([1000, 1083, 1167])
  expect(denseFrameTimes(0, 4000)).toHaveLength(48)
})
it('spaces overview frames half a second apart across the clip, at most 180', () => {
  expect(overviewFrameTimes(3000)).toEqual([0, 500, 1000, 1500, 2000, 2500])
  expect(overviewFrameTimes(90_000)).toHaveLength(180)
  expect(overviewFrameTimes(200_000)).toHaveLength(180)
})
it('refuses a reading line over its limit and a palette over six', () => {
  const reading = { medium: 'x', type: 'x', enters: 'x', exits: 'x', motion: 'x', absent: 'x', palette: [], notes: '', readAt: new Date().toISOString(), model: 'm' }
  expect(ReferenceReadingSchema.safeParse({ ...reading, motion: 'y'.repeat(401) }).success).toBe(false)
  expect(ReferenceReadingSchema.safeParse({ ...reading, palette: Array(7).fill('#fff') }).success).toBe(false)
})
it('reads a draft through the identity schema', () => {
  expect(MotionIdentityDraftSchema.parse({ identity: {}, why: 'house' }).identity).toEqual(DEFAULT_MOTION_IDENTITY)
  expect(MotionIdentityDraftSchema.safeParse({ identity: { techniques: ['stat-counter'] }, why: '' }).success).toBe(false)
})
```

In `events.test.ts` add: `it('registers the reference ingest event', () => { expect(EVENT_SCHEMAS['motion/reference.ingested'].parse({ channelId: FIRST_CHANNEL_ID, referenceId: FIRST_CHANNEL_ID })).toBeTruthy() })`.

- [ ] **Step 2: Run them**: `cd packages/schemas && pnpm exec vitest run motion-references events`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `motion-references.ts`, the event schema, the barrel export. `referenceExtension('video/quicktime')` is `'mov'`.
- [ ] **Step 4: Run** `pnpm exec vitest run` in `packages/schemas` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add packages/schemas && git commit -m "feat(schemas): motion reference inputs, frames, readings and the ingest event"`.

### Task 2: The `motion_references` table and its queries

**Files:**
- Modify: `packages/db/src/schema.ts` (after `assets`, around line 985: `referencePurposeEnum`, `referenceReadStateEnum`, `motionReferences`, `MotionReferenceRow`)
- Create: `packages/db/src/motion-references.ts`
- Create: `packages/db/drizzle/0047_<name>.sql` by `pnpm --filter @boom-busters/db generate`
- Modify: `packages/db/src/index.ts` (export the module)
- Test: `packages/db/src/motion-references.test.ts` (test database, `requireTestDatabase`)

**Interfaces:**
- Consumes: `ReferenceFrames`, `ReferenceReading`, `ReferencePurpose`, `REFERENCE_PACK_MAX` from Task 1.
- Produces: table `motion_references`: `id`, `channelId` (not null, restrict), `assetId` (text, references `assets.id`, restrict), `kind` (`assetKindEnum`, image or video), `title` text, `sourceUrl` text nullable, `rights` text, `purpose` (`referencePurposeEnum`), `negative` boolean default false, `windowStartMs` integer nullable, `windowEndMs` integer nullable, `carryOver` text, `avoid` text default '', `frames` jsonb `$type<ReferenceFrames>()` not null, `reading` jsonb `$type<ReferenceReading>()` nullable, `contactSheetKey` text nullable, `denseSheetKey` text nullable, `readState` (`referenceReadStateEnum`: unread, reading, read, failed; default unread), `readError` text nullable, `position` integer not null, `createdAt`, `updatedAt`, `archivedAt` timestamp nullable. Indexes: unique `(channel_id, position) where archived_at is null`; index on `channel_id`.
- Produces: `upsertChannelAsset(db, channelId, input: { kind: 'image' | 'video'; r2Key; contentHash; width; height; durationMs?: number | null; title }): Promise<AssetRow>` on the `(contentHash, channelId)` partial index as `insertLogo` does, `set` title, width, height, durationMs, updatedAt; licence `'Uploaded by owner, reference only'`.
- Produces: `listMotionReferences(db, channelId): Promise<MotionReferenceRow[]>` (live rows by position), `motionReferenceById(db, id): Promise<MotionReferenceRow | null>`, `insertMotionReference(db, channelId, input: { assetId; kind; title; sourceUrl: string | null; rights; purpose; negative; windowStartMs: number | null; windowEndMs: number | null; carryOver; avoid; frames: ReferenceFrames }): Promise<MotionReferenceRow>` (position `max(live) + 1`, in a transaction; throws `ValidationError('This channel already holds twelve references. Archive one first.', { field: 'references' })` at `REFERENCE_PACK_MAX`), `updateMotionReference(db, id, patch: Partial<Pick<..., 'title' | 'sourceUrl' | 'rights' | 'purpose' | 'negative' | 'carryOver' | 'avoid'>>)`, `remarkMotionReference(db, id, input: { windowStartMs; windowEndMs; frames })` (also sets `reading`, `contactSheetKey`, `denseSheetKey`, `readError` to null and `readState` to `unread`), `setReferenceReadState(db, id, state, error?: string | null)`, `setReferenceSheets(db, id, keys: { contactSheetKey: string | null; denseSheetKey: string | null })`, `setReferenceReading(db, id, reading: ReferenceReading)` (also `readState` `read`, `readError` null), `archiveMotionReference(db, id): Promise<MotionReferenceRow | null>`. Every writer returns the row or null when gone.

- [ ] **Step 1: Write the failing tests** (seed a channel with `seed`; a helper `anAsset()` through `upsertChannelAsset`; a helper `aReference(n)`):

```ts
it('numbers references in insertion order and lists live ones only', async () => { /* insert two, archive the first, list has one at position 2 */ })
it('refuses a thirteenth live reference', async () => { /* twelve inserts pass; the thirteenth rejects with /twelve references/ ; archive one; a new insert passes at position 13 */ })
it('a re-mark clears the reading, the sheets and the read state', async () => { /* setReferenceReading + setReferenceSheets, then remark; reading null, both keys null, readState 'unread', frames replaced */ })
it('stores the same bytes once per channel and refreshes the title', async () => { /* upsertChannelAsset twice with one hash: same id, second title */ })
it('a reading sets the state read and clears an old error', async () => { /* setReferenceReadState failed with error, then setReferenceReading: state read, readError null */ })
```

- [ ] **Step 2: Run**: `cd packages/db && pnpm exec vitest run motion-references`. Expected: FAIL (no table, no module).
- [ ] **Step 3: Implement** the table, then `pnpm --filter @boom-busters/db generate` (Expected: one new file `0047_*.sql` and journal idx 47; read the SQL: one table, two enums, two indexes), then `pnpm --filter @boom-busters/db migrate:test` (Docker Desktop must be running), then the queries.
- [ ] **Step 4: Run** `pnpm exec vitest run` in `packages/db` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add packages/db && git commit -m "feat(db): the motion_references table and its queries"`.

### Task 3: The reading and the identity draft prompts

**Files:**
- Create: `packages/providers/src/prompts/motion.ts`
- Modify: `packages/providers/src/prompts/index.ts` (export)
- Test: `packages/providers/src/prompts/motion.test.ts` with fixtures `packages/providers/src/prompts/__fixtures__/motion-reading.json` and `motion-identity-draft.json` (`toMatchFileSnapshot`, as `lift.test.ts` does; these prompts read no bible, so they are not lift cases and `psychology.test.ts` is untouched)

**Interfaces:**
- Consumes: `MsgImage`, `LLMTaskRequest` from `../llm/types`; `parseJsonCompletion` from `./json`; `MotionIdentity`, `MotionIdentityDraftSchema`, `ReferenceReading`, `ReferencePurpose`, `TECHNIQUES` from `@boom-busters/schemas`; `outputBudget` as `graphics.ts` uses it.
- Produces: `READING_INPUT_TOKENS = 9000`, `READING_OUTPUT_TOKENS = 1200`, `DRAFT_OUTPUT_TOKENS = 2500`.
- Produces: `ReferenceForReading { title: string; purpose: ReferencePurpose; negative: boolean; carryOver: string; avoid: string; windowMs: number | null }`; `ReadingImages { denseSheet: MsgImage | null; frames: { atMs: number; image: MsgImage }[] }`; `buildReferenceReadingRequest(reference: ReferenceForReading, images: ReadingImages): LLMTaskRequest` (task `graphics`; the system prompt: a reading is study notes on the grammar of a clip, never its content; name no brand, product, person, logo or the words on screen; text only; one field each for medium, palette (up to six hex or plain colour words), type (face, weight, case, spacing), enters, exits, motion (what moves, how fast, what holds), absent (what the clip does not do); notes for anything else, under 800 characters; a negative reference is read the same way and the notes say what to avoid; answer JSON only. The user message lists the images in order (the dense sheet first when present, then "Frame at 1.25 s"), the purpose, the window length, the carry-over and avoid lines, and the ask; `maxTokens: outputBudget(READING_OUTPUT_TOKENS)`).
- Produces: `parseReferenceReading(text: string): Omit<ReferenceReading, 'readAt' | 'model'>` (`parseJsonCompletion` on a loose object, every string trimmed and cut to its limit, palette to six, then `ReferenceReadingEditSchema.parse`); `mockReferenceReading(reference: ReferenceForReading): Omit<ReferenceReading, 'readAt' | 'model'>` (every field starts `[mock]`; `notes` repeats the carry-over line).
- Produces: `ReadingForDraft { title; purpose; negative; carryOver; avoid; reading: ReferenceReading | null }`; `IdentityDraftInput { current: MotionIdentity; brief: string; readings: ReadingForDraft[]; brand: { colors: Record<string, string>; fonts: Record<string, string> }; techniques: { technique: string; description: string }[] }`; `buildMotionIdentityDraftRequest(input): LLMTaskRequest` (task `graphics`; the system prompt: propose the whole identity as JSON under `identity`, every field with its bound written out (signatureEase soft, crisp or gentle; ms 40 to 3000 for enter, exit, reveal, draw, count, move, gap, omit to keep the house value; overshoot none, hair or welcome; entrance rise, fade, scale, wipe or slide; changeEveryMs 500 to 10000; stillMaxMs 1000 to 20000 and at least the cadence; cameraRule under 200 characters completing "and the camera ..."; blurFollowsSpeed; threeD never, whenMeaningful or welcome; never and allow up to 16 phrases of 60; styleGuideMd up to 4000 characters of plain prose; techniques from the list given, always including kinetic-word-stack and bar-chart; chartsConventional) and `why` under 1200 characters saying what in the readings and the brief led to each choice; the user message: the brief, the brand colours and fonts, the catalogue with descriptions, each reading in full or "unread" with its carry-over line, and the current identity as JSON; `maxTokens: outputBudget(DRAFT_OUTPUT_TOKENS)`).
- Produces: `parseMotionIdentityDraft(text: string): MotionIdentityDraft` (`parseJsonCompletion(text, MotionIdentityDraftSchema, 'motion identity draft')`, so a schema refusal is a `ValidationError` naming the field); `mockMotionIdentityDraft(input: IdentityDraftInput): MotionIdentityDraft` (the current identity with `styleGuideMd` = `[mock] ${brief}` cut to 4000, `why: '[mock] The brief, folded into the style guide; everything else kept.'`).

- [ ] **Step 1: Write the failing tests**:

```ts
const reference = { title: 'Numeral over a changing background', purpose: 'mechanism' as const, negative: false, carryOver: 'borrow the held numeral, not the story', avoid: 'not the glow', windowMs: 2500 }
const images = { denseSheet: { mimeType: 'image/jpeg' as const, data: 'AAAA' }, frames: [{ atMs: 1000, image: { mimeType: 'image/jpeg' as const, data: 'BBBB' } }] }
it('composes the reading request', async () => { await expect(JSON.stringify(buildReferenceReadingRequest(reference, images), null, 2) + '\n').toMatchFileSnapshot('./__fixtures__/motion-reading.json') })
it('puts the sheet and the frames before the ask, in order', () => { const last = buildReferenceReadingRequest(reference, images).messages.at(-1)!; expect(last.images).toEqual([images.denseSheet, images.frames[0]!.image]); expect(last.content).toContain('Frame at 1.0 s') })
it('reads a reading and cuts a long line to its limit', () => { const r = parseReferenceReading(JSON.stringify({ medium: 'x', type: 'x', enters: 'x', exits: 'x', motion: 'y'.repeat(500), absent: 'x', palette: Array(8).fill('#000'), notes: '' })); expect(r.motion).toHaveLength(400); expect(r.palette).toHaveLength(6) })
it('composes the draft request', async () => { /* snapshot buildMotionIdentityDraftRequest(draftInput()) */ })
it('names an unread reference as unread', () => { const text = buildMotionIdentityDraftRequest(draftInput({ readings: [{ ...reference, reading: null }] })).messages.map((m) => m.content).join('\n'); expect(text).toContain('unread'); expect(text).toContain('borrow the held numeral') })
it('drafts from the brief alone', () => { expect(() => buildMotionIdentityDraftRequest(draftInput({ readings: [] }))).not.toThrow() })
it('refuses a draft the identity schema refuses', () => { expect(() => parseMotionIdentityDraft(JSON.stringify({ identity: { changeEveryMs: 3000, stillMaxMs: 2000 }, why: '' }))).toThrow(/still limit/) })
it('the mock draft differs from the current identity', () => { const d = mockMotionIdentityDraft(draftInput({ brief: 'slow and dark' })); expect(d.identity.styleGuideMd).toContain('slow and dark'); expect(d.identity.overshoot).toBe(DEFAULT_MOTION_IDENTITY.overshoot) })
it('writes no dash a reader would see', () => { /* both requests' system and message text, as graphics.test.ts asserts */ })
```

- [ ] **Step 2: Run**: `cd packages/providers && pnpm exec vitest run prompts/motion`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `motion.ts` and the export. Run the snapshot tests once with `-u` to write the two fixtures, then read both fixtures in full.
- [ ] **Step 4: Run** `pnpm exec vitest run` in `packages/providers` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add packages/providers && git commit -m "feat(providers): the reference reading and the motion identity draft prompts, with mocks"`.

### Task 4: Frames taken in the browser

**Files:**
- Create: `apps/web/lib/client-video.ts`
- Create: `apps/web/lib/client-hash.ts` (`fingerprint(file: File): Promise<string>`, moved verbatim from `logos-tab.tsx:52-58`; the tab imports it)
- Modify: `apps/web/app/(console)/c/[slug]/settings/logos-tab.tsx:52-58`
- Test: `apps/web/lib/client-video.test.ts` (jsdom), `apps/web/lib/client-hash.test.ts`

**Interfaces:**
- Consumes: `denseFrameTimes`, `overviewFrameTimes`, `DENSE_FRAME_WIDTH`, `OVERVIEW_FRAME_WIDTH` from Task 1.
- Produces: `fittedWidth(width: number, height: number, maxWidth: number): { width: number; height: number }` (never enlarged, both even, at least 2).
- Produces: `interface FrameGrabber { seek(atMs: number): Promise<void>; draw(size: { width: number; height: number }): Promise<Blob> }`; `browserGrabber(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameGrabber` (seek sets `currentTime` and resolves on `seeked`, rejecting after 5 s with `Error('the clip did not seek to <t> s')`; draw paints the video to the canvas at the size and encodes JPEG at quality 0.85).
- Produces: `GrabbedFrame { atMs: number; blob: Blob; width: number; height: number }`; `grabFrames(grabber: FrameGrabber, times: readonly number[], size, onProgress?: (done: number, total: number) => void): Promise<GrabbedFrame[]>` (sequential; a seek failure stops and rejects with the frame count in the message: "Only 31 of 48 frames could be taken").
- Produces: `readVideoMeta(file: File): Promise<{ durationMs: number; width: number; height: number }>` on an object URL and `loadedmetadata`, revoked after.
- Produces: `referenceFrameSets(window: { startMs; endMs }, durationMs): { dense: number[]; overview: number[] }` (the two clocks from Task 1, for the marker and the finalise to share).

- [ ] **Step 1: Write the failing tests** (a `fakeGrabber(failAt?: number)` records seeks and returns a 1-byte blob):

```ts
it('fits a 1920 by 1080 frame to 640 wide', () => { expect(fittedWidth(1920, 1080, 640)).toEqual({ width: 640, height: 360 }) })
it('never enlarges a small frame and keeps even sides', () => { expect(fittedWidth(321, 181, 640)).toEqual({ width: 320, height: 180 }) })
it('grabs a frame per time in order and reports progress', async () => { /* times [0, 83, 167]; three blobs; progress calls (1,3) (2,3) (3,3) */ })
it('reports a grab that returns fewer frames than asked', async () => { await expect(grabFrames(fakeGrabber(31), denseFrameTimes(0, 4000), size)).rejects.toThrow('Only 31 of 48 frames could be taken') })
it('fingerprints a file as 64 hex characters', async () => { /* client-hash */ })
```

- [ ] **Step 2: Run**: `cd apps/web && pnpm exec vitest run client-video client-hash`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both modules; point `logos-tab.tsx` at `client-hash.ts`.
- [ ] **Step 4: Run** `pnpm exec vitest run client-video client-hash logos-tab` in `apps/web`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add apps/web/lib/client-video.ts apps/web/lib/client-video.test.ts apps/web/lib/client-hash.ts apps/web/lib/client-hash.test.ts "apps/web/app/(console)/c/[slug]/settings/logos-tab.tsx" && git commit -m "feat(web): frames taken from a clip in the browser"`.

### Task 5: The reference actions and the identity draft action

**Files:**
- Create: `apps/web/app/(console)/c/[slug]/settings/motion-actions.ts` (`'use server'`: async exports only)
- Create: `apps/web/lib/reference-keys.ts` (`referenceKey`, `referenceFrameKey`, `referenceSheetKey`; pure, so the reader and the actions share them and a `'use server'` file exports no constant)
- Create: `apps/web/lib/motion-estimates.ts`
- Modify: `apps/web/lib/answer-call.ts` (`completeForChannel`)
- Test: `apps/web/app/(console)/c/[slug]/settings/motion-actions.test.ts` (test database; `vi.mock('@/lib/storage')` with `storageConfigured: () => true`, `presignPut: async (key) => 'https://put/' + key`, `headObject: vi.fn(async () => ({ size: 10, contentType: 'image/jpeg' }))`, `deleteObject: vi.fn()`; `vi.mock('@/inngest/client', () => ({ inngest: { send: vi.fn() } }))`; `vi.mock('@/auth', ...)` as `logo-actions.test.ts` does), `apps/web/lib/reference-keys.test.ts`, `apps/web/lib/motion-estimates.test.ts`

**Interfaces:**
- Consumes: Task 1 schemas and clocks; Task 2 queries; Task 3 prompts and mocks; `channelWriteRefusal`, `requireOwner` shape from `logo-actions.ts`; `resolveBrandKit`, `resolveMotionIdentity`; `MANIFEST` from `@boom-busters/providers`; `callForAnswer`; `estimateLlmUsd`, `canonicalModelId`; `events` and `inngest` from `@/inngest`.
- Produces (`reference-keys.ts`): `referenceKey({ channelId, contentHash, ext })` = `${R2_PREFIX}/references/${channelId}/${contentHash}.${ext}`; `referenceFrameKey({ channelId, contentHash, set: 'dense' | 'overview', atMs })` = `.../${contentHash}/${set}/${atMs}.jpg`; `referenceSheetKey({ channelId, contentHash, sheet: 'dense' | 'contact' })` = `.../${contentHash}/${sheet}-sheet.jpg`.
- Produces (`answer-call.ts`): `completeForChannel(channelId: string, firstCall: { estimateOutputTokens?: number } = {}): AnswerComplete` (as `completeForProject`, with no project).
- Produces (`motion-estimates.ts`): `readingEstimateUsd(settings: Settings, workspace: WorkspaceSettings): number` and `identityDraftEstimateUsd(settings, workspace, readings: number): number` (input tokens 3000 + 900 per reading, output `DRAFT_OUTPUT_TOKENS`), both on `settings.modelRouting.graphics`.
- Produces (`motion-actions.ts`), every one `requireOwner`, `UlidSchema` on ids, `channelWriteRefusal`:
  - `createReferenceUploadAction(channelId, input: { fileType: string; fileSize: number; contentHash: string; durationMs?: number }): Promise<ActionResult & { url?: string; key?: string }>`. Refusals in words: a type outside the two lists ("A reference is a PNG, JPEG or WebP still, or an MP4, WebM or MOV clip."), a still over 8 MB, a clip over 100 MB or over 90 s ("That clip is over 90 seconds. Trim it first."), an empty file, a bad fingerprint, no storage ("Reference uploads need R2 configured; there is nowhere to store them.").
  - `createReferenceFrameUploadsAction(channelId, input: { contentHash: string; dense: number[]; overview: number[] }): Promise<ActionResult & { uploads?: { set: 'dense' | 'overview'; atMs: number; key: string; url: string }[] }>` (refuses over 48 or 180; one presigned PUT per frame, `image/jpeg`).
  - `finaliseReferenceAction(channelId, input: { contentHash: string; fileType: string; width: number; height: number; durationMs?: number; frames: { set: 'dense' | 'overview'; atMs: number; width: number; height: number }[]; input: unknown; read: boolean }): Promise<ActionResult & { id?: string }>`: parse `input` with `MotionReferenceInputSchema` (a refusal names the first issue as `settingsErrorMessage` does); `kind` must match `fileType`; for a clip, the frame times must equal `referenceFrameSets(window, durationMs)` exactly ("The frames do not match the window. Mark it again."); HEAD the original and every frame key, eight at a time ("A frame never arrived in storage. Try again."); `upsertChannelAsset`; `insertMotionReference` (a still: `frames.dense = [{ atMs: 0, r2Key: original, width, height }]`, `overview: []`); the pack-full `ValidationError` is returned in words and the original object deleted best-effort; `read` true: `setReferenceReadState(reading)` then `inngest.send(events.motionReferenceIngested.create({ channelId, referenceId }))`; `revalidatePath('/c/[slug]', 'layout')`.
  - `updateReferenceAction(channelId, input: { id: string; input: unknown })` (the text fields only, parsed through `MotionReferenceEditSchema`; the row must belong to the channel).
  - `remarkReferenceAction(channelId, input: { id: string; windowStartMs: number; windowEndMs: number; frames: [...]; read: boolean })` (a clip only; the same frame verification; `remarkMotionReference`; the event when `read`).
  - `readReferenceAction(channelId, id: string)` (state `reading`, the event; a reference already `reading` is refused: "This reference is being read.").
  - `saveReadingAction(channelId, input: { id: string; reading: unknown })` (`ReferenceReadingEditSchema`; keeps `readAt` and `model`, sets `editedAt` now).
  - `archiveReferenceAction(channelId, id: string)`.
  - `draftMotionIdentityAction(channelId, input: { brief: string }): Promise<ActionResult & { draft?: MotionIdentityDraft }>` (brief trimmed, at most 1000: "The brief is over 1000 characters."; readings from `listMotionReferences`; brand colours and fonts from `resolveBrandKit(settings)`; techniques from `MANIFEST`; mock mode: `mockMotionIdentityDraft`; else `callForAnswer({ request, parse: parseMotionIdentityDraft, complete: completeForChannel(channelId, { estimateOutputTokens: DRAFT_OUTPUT_TOKENS }) })`; a `BudgetExceededError` and a refused answer come back as `{ ok: false, error }` in words).

- [ ] **Step 1: Write the failing tests**:

```ts
it('refuses a clip over 90 seconds and a still over 8 MB', async () => { /* two createReferenceUploadAction calls, messages matched */ })
it('issues one frame URL per time under the reference key', async () => { const r = await createReferenceFrameUploadsAction(FIRST_CHANNEL_ID, { contentHash: HASH, dense: [1000, 1083], overview: [0, 500] }); expect(r.uploads!.map((u) => u.key)).toEqual([referenceFrameKey({ channelId: FIRST_CHANNEL_ID, contentHash: HASH, set: 'dense', atMs: 1000 }), /* ... */]) })
it('refuses a finalise whose frames do not match the window', async () => { /* a clip with window 1000 to 2000 and dense frames for 0 to 1000: /do not match the window/ , no row */ })
it("stores a still as its own one frame and reads it on the owner's word", async () => { /* read: true -> a row with frames.dense[0].r2Key = referenceKey(...), readState 'reading', inngest.send called once with motion/reference.ingested; read: false -> readState 'unread', send not called */ })
it('deletes the upload when the pack is full', async () => { /* twelve rows seeded through insertMotionReference; finalise -> /twelve references/ and deleteObject called with the original key */ })
it('drafts the identity from the brief in mock mode and leaves the settings untouched', async () => { const r = await draftMotionIdentityAction(FIRST_CHANNEL_ID, { brief: 'slow and dark' }); expect(r.draft!.identity.styleGuideMd).toContain('slow and dark'); expect((await getChannelSettings(db, FIRST_CHANNEL_ID)).motion.styleGuideMd).toBe('') })
it('keeps readAt and model when the owner edits a reading', async () => { /* saveReadingAction; editedAt set */ })
// motion-estimates.test.ts
it('prices a reading and a draft on the graphics route', () => { expect(readingEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS)).toBeGreaterThan(0); expect(identityDraftEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, 8)).toBeGreaterThan(identityDraftEstimateUsd(DEFAULT_SETTINGS, DEFAULT_WORKSPACE_SETTINGS, 0)) })
```

- [ ] **Step 2: Run**: `cd apps/web && pnpm exec vitest run motion-actions reference-keys motion-estimates`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the four modules. Add `motionReferenceIngested: eventType('motion/reference.ingested', { schema: MotionReferenceIngestedSchema })` to `apps/web/inngest/events.ts` now (the action sends it; Task 6 serves it). `apps/web/inngest/events.test.ts` passes once both sides list it.
- [ ] **Step 4: Run** `pnpm exec vitest run motion-actions reference-keys motion-estimates answer-call events` in `apps/web` and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add apps/web/app/\(console\)/c/\[slug\]/settings/motion-actions.ts apps/web/app/\(console\)/c/\[slug\]/settings/motion-actions.test.ts apps/web/lib/reference-keys.ts apps/web/lib/reference-keys.test.ts apps/web/lib/motion-estimates.ts apps/web/lib/motion-estimates.test.ts apps/web/lib/answer-call.ts apps/web/inngest/events.ts && git commit -m "feat(web): reference uploads verified against the window, and the identity draft action"`.

### Task 6: The reader: sheets in Chromium, one vision call

**Files:**
- Modify: `apps/web/lib/graphic-code/frames.ts` (export `screenshotDocument`)
- Create: `apps/web/lib/reference-sheets.ts`
- Create: `apps/web/inngest/functions/motion-reference-reader.ts`
- Modify: `apps/web/inngest/functions/index.ts` (register and export)
- Test: `apps/web/lib/graphic-code/frames.test.ts` (one case under the existing `describe.skipIf(!(await browserAvailable()))`), `apps/web/lib/reference-sheets.test.ts`, `apps/web/inngest/functions/motion-reference-reader.test.ts` (`InngestTestEngine`, test database, mock mode, as `keyword-measurer.test.ts`)

**Interfaces:**
- Consumes: Task 2 queries; Task 3 prompts; Task 5 keys and `completeForChannel`; `getObjectBytes`, `putObject`, `storageConfigured` from `@/lib/storage`; `INSPECT_MAX_MS`, `FramesUnavailable` from `frames.ts`.
- Produces (`frames.ts`): `screenshotDocument(input: { html: string; width: number; timeoutMs?: number }): Promise<Buffer>` (the launch, a page at `width` by 800 with `deviceScaleFactor` 1, `setContent` with `waitUntil: 'load'`, a `fullPage` JPEG at quality 80, the close; every stage under `withinTime` as `browserFrames` does; throws `FramesUnavailable`).
- Produces (`reference-sheets.ts`): `SHEET_WIDTH = 1600`, `SHEET_COLUMNS = 6`; `SheetTile { atMs: number; dataUri: string; width: number; height: number }`; `sheetDocument(tiles: readonly SheetTile[]): string` (a dark page, a six-column grid of `<img>` tiles each with its timecode `1.25 s` under it in 14 px system sans; the page's width `SHEET_WIDTH`); `renderSheets(reference: { channelId; contentHash; frames: ReferenceFrames }): Promise<{ denseSheetKey: string | null; contactSheetKey: string | null; skipped?: string }>` (fetches the frames' bytes eight at a time, renders each set that has frames, puts each JPEG under `referenceSheetKey`, bounded by `INSPECT_MAX_MS` for both sheets together; a `FramesUnavailable` is returned as `skipped` with its message, never thrown).
- Produces: `motionReferenceReader` (`id: 'motion-reference-reader'`, `retries: 1`, `singleton: { key: 'event.data.referenceId', mode: 'cancel' }`, trigger `events.motionReferenceIngested`, `onFailure` sets `readState` `failed` with `serialiseError(...).message`). Steps:
  1. `sheets`: the row (a missing or archived row ends the run with `{ outcome: 'gone' }`); a still, or `!storageConfigured()`: `{ skipped: 'no sheets for a still' | 'no storage' }`; else `renderSheets` and `setReferenceSheets`.
  2. `read`: the row again; `ReferenceForReading` from it; mock mode: `mockReferenceReading`; else images: the dense sheet's bytes when present, and four single frames spread over `frames.dense` (indices `0`, `⌊n/3⌋`, `⌊2n/3⌋`, `n-1`, deduplicated; a still has one), each as `{ mimeType: 'image/jpeg', data }` (a still of another type keeps its own mime); `callForAnswer({ request: buildReferenceReadingRequest(...), parse: parseReferenceReading, complete: completeForChannel(channelId, { estimateOutputTokens: READING_OUTPUT_TOKENS }) })`; a `BudgetExceededError` or `!answer.ok` → `setReferenceReadState(id, 'failed', message)` and `{ outcome: 'failed' }`; else `setReferenceReading(id, { ...answer.value, readAt: now, model: \`${route.provider}/${route.model}\` })` with the route from `getChannelSettings(db, channelId).modelRouting.graphics` (mock mode writes `mock/reading`) and `{ outcome: 'read' }`.

- [ ] **Step 1: Write the failing tests**:

```ts
// reference-sheets.test.ts
it('lays the tiles in six columns with a timecode under each', () => { const html = sheetDocument(tiles(14)); expect(html).toContain('grid-template-columns: repeat(6'); expect((html.match(/<img /g) ?? []).length).toBe(14); expect(html).toContain('1.08 s') })
it('skips the sheets without storage and says so', async () => { /* storageConfigured false -> { denseSheetKey: null, contactSheetKey: null, skipped: 'no storage' } */ })
// frames.test.ts, inside the real-browser describe
it('screenshots a document at the width asked', async () => { const jpeg = await screenshotDocument({ html: '<html><body style="width:1600px;height:300px;background:#123"></body></html>', width: 1600 }); expect(jpeg.length).toBeGreaterThan(1000) })
// motion-reference-reader.test.ts
it('reads a still in mock mode: the fixture reading, state read, no spend', async () => { /* insert a still reference, send the event through the engine, row.reading.medium starts '[mock]', readState 'read', model 'mock/reading', cost ledger has no row */ })
it('a re-read replaces the reading', async () => { /* setReferenceReading with 'old', run, medium no longer 'old' */ })
it('ends quietly when the reference is gone', async () => { /* a random ulid: result outcome 'gone', no throw */ })
```

- [ ] **Step 2: Run**: `cd apps/web && pnpm exec vitest run reference-sheets motion-reference-reader`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `screenshotDocument`, `reference-sheets.ts`, the function, the registration. The function stays off any `project/cancelled` cancel list: it has no project.
- [ ] **Step 4: Run** `pnpm exec vitest run reference-sheets motion-reference-reader frames functions/index events` in `apps/web` (the frames browser case runs where Chromium is present; read the skip line when it is not) and `pnpm -r typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add apps/web/lib/graphic-code/frames.ts apps/web/lib/graphic-code/frames.test.ts apps/web/lib/reference-sheets.ts apps/web/lib/reference-sheets.test.ts apps/web/inngest/functions/motion-reference-reader.ts apps/web/inngest/functions/motion-reference-reader.test.ts apps/web/inngest/functions/index.ts && git commit -m "feat(web): the reference reader renders the sheets and reads the window once"`.

### Task 7: The references on the Motion tab, and the marker

**Files:**
- Create: `apps/web/lib/motion-guideline.ts` (`MOTION_GUIDELINE_SHORT: readonly string[]`, six lines, the first "Four to eight references per channel, twelve at most."; then one of each purpose; one idea per clip, typography, shapes and charts; stills PNG, JPEG or WebP to 8 MB, clips MP4, WebM or MOV to 100 MB and 90 s; the window one to four seconds, no chrome, captions or logos in it; a title, the source, a rights note, one "borrow X, not Y" line and an avoid line. `MOTION_GUIDELINE_FULL: readonly { heading: string; lines: readonly string[] }[]`, the six sections of `docs/motion-references.md`)
- Create: `apps/web/app/(console)/c/[slug]/settings/reference-marker.tsx`
- Create: `apps/web/app/(console)/c/[slug]/settings/references-section.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx` (render `ReferencesSection` after the Techniques card; new props `channelId: string`, `archived: boolean`, `references: readonly ReferenceView[]`, `storageReady: boolean`, `readingEstimateUsd: number`, all passed from `settings-form.tsx`, which already holds `channelId` and `channel.archived`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/settings-form.tsx` (props `references?: ReferenceView[]`, `readingEstimateUsd?: number`, `draftEstimateUsd?: number`, `storageReady?: boolean`, passed to `MotionTab`)
- Modify: `apps/web/app/(console)/c/[slug]/settings/page.tsx` (load `listMotionReferences`, build the views with presigned URLs, the two estimates, `storageConfigured()`)
- Modify: every `SettingsForm` test listed in Global Constraints (`vi.mock('./motion-actions', () => ({ ...every export as vi.fn() }))`)
- Test: `apps/web/lib/motion-guideline.test.ts`, `apps/web/app/(console)/c/[slug]/settings/reference-marker.test.tsx`, `apps/web/app/(console)/c/[slug]/settings/references-section.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`fingerprint`, `readVideoMeta`, `browserGrabber`, `grabFrames`, `fittedWidth`, `referenceFrameSets`), `toUploadableImage`, `readImageSize` from `client-image.ts`; Task 5 actions; `Dialog`, `Button`, `Input`, `NumberInput`, `Label`, `Select`, `Switch`, `useToast`; `useRouter`.
- Produces: `ReferenceView { id: string; kind: 'image' | 'video'; title: string; sourceUrl: string | null; rights: string; purpose: ReferencePurpose; negative: boolean; windowStartMs: number | null; windowEndMs: number | null; carryOver: string; avoid: string; readState: 'unread' | 'reading' | 'read' | 'failed'; readError: string | null; reading: ReferenceReading | null; thumbUrl: string | null; denseSheetUrl: string | null; contactSheetUrl: string | null; clipUrl: string | null; contentHash: string; durationMs: number | null; width: number; height: number }` (in `references-section.tsx`; the page builds it with `presignGet` for `thumbUrl` (the first dense frame), the sheets and, for a clip, the original so Re-mark can play it; null without storage or for a `mock://` key).
- Produces: `ReferenceMarker({ channelId, mode: { kind: 'add' } | { kind: 'remark'; reference: ReferenceView }, storageReady, readingEstimateUsd, onClose })` in a `Dialog` labelled "Add reference" or "Re-mark reference". The form: file picker (`accept` the six mimes; hidden input behind a "Choose file" button), title (`#reference-title`), source link, rights (default "Reference only"), purpose `Select` (`#reference-purpose`), "This is a negative: what the channel must not do" `Switch`, carry-over (`#reference-carry-over`, 300), avoid (`#reference-avoid`, 300). For a clip: a `<video controls>` on the object URL, the window as two `NumberInput`s in seconds (`#reference-window-start`, `#reference-window-end`, step 0.1) with "Set start here" and "Set end here" buttons reading `video.currentTime`, a line "Window 2.5 s: 30 frames" counting the dense set from `referenceFrameSets`, a red line when outside 1 to 4 s ("The window is one to four seconds."). The buttons: "Save and read" with "about $X" beside it (`readingEstimateUsd`, 3 decimals), "Save without reading", "Cancel". The save: a still → `toUploadableImage` → `fingerprint` → `createReferenceUploadAction` → PUT → `readImageSize` → `finaliseReferenceAction`; a clip → `fingerprint` → `createReferenceUploadAction` (with `durationMs`) → PUT the clip → `grabFrames` for dense and overview with the progress line "Taking frames 12 of 78" → `createReferenceFrameUploadsAction` → PUT each frame, four at a time → `finaliseReferenceAction`. Re-mark skips the clip upload and calls `remarkReferenceAction`. Every refusal is a toast with the action's words; a grab failure shows its message under the window. Without storage every save button is disabled and a line says "Reference uploads need R2 configured; there is nowhere to store them."
- Produces: `ReferencesSection({ channelId, references, storageReady, readingEstimateUsd, archived })`: a `Card` "References" whose description is `MOTION_GUIDELINE_SHORT` as a list with a "Read the full guideline" button opening a `Dialog` of `MOTION_GUIDELINE_FULL`; "Add reference" (`#reference-add`); the cards in order: the thumbnail (or "No preview" without storage), title, purpose and "negative" badges, the window "1.0 to 3.5 s" or "still", the carry-over line, the read state ("Unread", "Reading...", "Read", "Failed: <reason>"), buttons "Edit" (inline form of the text fields, "Save" and "Cancel", `updateReferenceAction`), "Re-mark" (clips only, opens the marker), "Read" (unread or failed; `readReferenceAction`), "Archive" (`archiveReferenceAction`, confirmed by a second "Archive for good" button), "Details" toggling the contact sheet, the dense sheet and the reading as a definition list with "Edit reading" (one textarea per field, palette one per line, "Save reading" → `saveReadingAction`, "Cancel"). While any reference is `reading`, `setInterval(() => router.refresh(), 4000)` as the Bible tab polls. An archived channel renders the list with every button disabled.

- [ ] **Step 1: Write the failing tests**:

```ts
// motion-guideline.test.ts
it('keeps every heading of docs/motion-references.md', () => { const doc = readFileSync(resolve(__dirname, '../../../docs/motion-references.md'), 'utf8'); for (const section of MOTION_GUIDELINE_FULL) expect(doc).toContain(`## ${section.heading}`); expect(MOTION_GUIDELINE_SHORT).toHaveLength(6) })
// references-section.test.tsx (render the section directly, actions mocked)
it('shows the short guideline and opens the full one', async () => { /* six lines; click "Read the full guideline"; a dialog with "What makes a good reference" */ })
it('says why uploads need storage and disables Add reference', () => { /* storageReady false: the line, button disabled */ })
it('lists a reference with its purpose, window, carry-over and read state', () => { /* a video view reading: "Reading..." ; a failed view: "Failed: over budget" */ })
it('reads an unread reference on the owner\'s word', async () => { /* click Read -> readReferenceAction(channelId, id) */ })
it('archives after a second confirmation', async () => { /* Archive, then "Archive for good" -> archiveReferenceAction once */ })
it('saves an edited reading with every field', async () => { /* Details, Edit reading, change motion, Save reading -> saveReadingAction with reading.motion changed and palette as lines */ })
// reference-marker.test.tsx (jsdom; fetch, createObjectURL and the video seams mocked; the actions mocked to succeed)
it('uploads a still through presign, PUT and finalise, and reads it on Save and read', async () => { /* a PNG File; fill title, purpose, carry-over; click "Save and read"; finaliseReferenceAction called with read: true, frames [] and the form */ })
it('refuses a window outside one to four seconds before any upload', async () => { /* a clip with start 0 and end 0.5 s: the red line; Save disabled; createReferenceUploadAction not called */ })
it('counts the frames the window asks for', async () => { /* start 1.0 end 3.5 on a 10 s clip: "Window 2.5 s: 30 frames" */ })
```

Testing the clip path in jsdom: `readVideoMeta` and `browserGrabber` are module seams; `vi.mock('@/lib/client-video', async (importOriginal) => ({ ...original, readVideoMeta: async () => ({ durationMs: 10_000, width: 1920, height: 1080 }), browserGrabber: () => fakeGrabber }))`.

- [ ] **Step 2: Run**: `cd apps/web && pnpm exec vitest run motion-guideline references-section reference-marker`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the guideline module, the section, the marker, the tab, form and page wiring, and the `./motion-actions` mock in the seven `SettingsForm` tests. The page's `ReferenceView` building follows `logoViews`: `storageConfigured() && !key.startsWith('mock://')`.
- [ ] **Step 4: Run** `pnpm exec vitest run "settings/"` in `apps/web` (every settings test, the seven `SettingsForm` ones included), then `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`. Expected: PASS, zero warnings.
- [ ] **Step 5: Commit**: `git add apps/web/lib/motion-guideline.ts apps/web/lib/motion-guideline.test.ts "apps/web/app/(console)/c/[slug]/settings/" && git commit -m "feat(web): references on the Motion tab: add, mark, read, edit, archive"`.

### Task 8: Draft motion identity

**Files:**
- Create: `apps/web/lib/identity-diff.ts`
- Create: `apps/web/app/(console)/c/[slug]/settings/identity-draft.tsx`
- Modify: `apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx` (render `IdentityDraft` under the Motion identity card's fields; props `draftEstimateUsd`, `archived`)
- Test: `apps/web/lib/identity-diff.test.ts`, `apps/web/app/(console)/c/[slug]/settings/identity-draft.test.tsx`

**Interfaces:**
- Consumes: `draftMotionIdentityAction` (Task 5); `MotionIdentity`, `MotionIdentityDraft`; the tab's `commit(patch, optimistic)`.
- Produces (`identity-diff.ts`): `IdentityChange { field: keyof MotionIdentity; label: string; current: string; proposed: string }`; `identityDiff(current: MotionIdentity, proposed: MotionIdentity): IdentityChange[]` (one row per field whose value differs; lists joined with ", "; `ms` as "enter 900, exit 300"; the style guide shown in full; the labels are the tab's own words: "Signature easing", "Lengths", "Overshoot", "Entrance", "Change cadence (ms)", "Still limit (ms)", "The camera", "Blur follows speed", "3D", "Never", "Allow", "Style guide", "Techniques in use", "Charts stay conventional").
- Produces: `IdentityDraft({ channelId, current: MotionIdentity, draftEstimateUsd, disabled, onApply: (identity: MotionIdentity) => Promise<void> })`: a textarea `#motion-brief` ("What this channel should move like, in a few lines", 1000), a line "Paid: one call on the graphics route, about $X. A channel with no references drafts from the brief alone.", the button "Draft motion identity" (busy "Drafting..."); the proposal: `why` as a paragraph, the diff as a table (field, now, proposed) or "The draft keeps every field as it is." when empty, buttons "Apply" (`onApply(draft.identity)`, then the proposal clears) and "Discard". A refusal is a toast with the action's words and nothing applied. In `motion-tab.tsx`, `onApply` is `commit({ motion: identity }, { ...settings, motion: identity })`.

- [ ] **Step 1: Write the failing tests**:

```ts
// identity-diff.test.ts
it('lists only the fields that change, in the tab\'s words', () => { const d = identityDiff(DEFAULT_MOTION_IDENTITY, { ...DEFAULT_MOTION_IDENTITY, overshoot: 'none', ms: { enter: 900 } }); expect(d.map((c) => c.label)).toEqual(['Lengths', 'Overshoot']); expect(d[0]!.proposed).toBe('enter 900') })
it('is empty for an identical proposal', () => { expect(identityDiff(DEFAULT_MOTION_IDENTITY, { ...DEFAULT_MOTION_IDENTITY })).toEqual([]) })
// identity-draft.test.tsx (draftMotionIdentityAction mocked)
it('shows the proposal as a diff with its why', async () => { /* mock returns a draft with overshoot none and a why; type a brief, click; the why paragraph, a row Overshoot: a hair -> none */ })
it('applies the whole proposal as one motion patch', async () => { /* Apply -> onApply called with draft.identity; the proposal gone */ })
it('discards a proposal', async () => { /* Discard -> onApply not called, the diff gone, the brief kept */ })
it('shows a refusal and applies nothing', async () => { /* mock { ok: false, error: 'still limit: ...' } -> toast with it; onApply not called */ })
```

- [ ] **Step 2: Run**: `cd apps/web && pnpm exec vitest run identity-diff identity-draft`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** the three files. In `motion-tab.test.tsx` add one case: "applies a drafted identity through one motion patch" (the mocked action returns a draft; Apply; `saveSettings` called once with `{ motion: <the whole identity> }`).
- [ ] **Step 4: Run** `pnpm exec vitest run identity-diff identity-draft motion-tab` in `apps/web`, `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add apps/web/lib/identity-diff.ts apps/web/lib/identity-diff.test.ts "apps/web/app/(console)/c/[slug]/settings/identity-draft.tsx" "apps/web/app/(console)/c/[slug]/settings/identity-draft.test.tsx" "apps/web/app/(console)/c/[slug]/settings/motion-tab.tsx" "apps/web/app/(console)/c/[slug]/settings/motion-tab.test.tsx" && git commit -m "feat(web): Draft motion identity, shown as a diff with Apply and Discard"`.

### Task 9: End to end, the guideline's pointer, PROGRESS

**Files:**
- Modify: `e2e/tests/settings-motion.spec.ts` (two new tests)
- Modify: `docs/motion-references.md` (one sentence under "What the tool does with them": a reference is read only on "Save and read" or "Read", and the reading can be edited on its card)
- Modify: `PROGRESS.md` (tick plan 2 in the "Channel motion references (2026-11-04)" checklist; decision 396 appended after 395: the table, the browser frames, the reader, the draft action, and every call listed under "Calls the author made" above, plus any ledgered ruling)

- [ ] **Step 1: Write the failing e2e tests** (mock mode, no storage: `playwright.config` blanks `R2_*`):

```ts
test('the references section explains storage and opens the full guideline', async ({ page }) => {
  await signIn(page)
  await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
  await expect(page.getByText('Four to eight references').first()).toBeVisible()
  await expect(page.locator('#reference-add')).toBeDisabled()
  await expect(page.getByText(/R2 configured/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Read the full guideline' }).click()
  await expect(page.getByText('What makes a good reference')).toBeVisible()
})
test('drafts the identity from the brief alone, applies it, and puts it back', async ({ page }) => {
  await signIn(page)
  await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
  await page.locator('#motion-brief').fill('slow and dark, one change every six seconds')
  await page.getByRole('button', { name: 'Draft motion identity' }).click()
  await expect(page.getByText('Style guide').first()).toBeVisible()
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByText('Saved').first()).toBeVisible()
  await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
  await expect(page.locator('#motion-guide')).toHaveValue(/^\[mock\] slow and dark/)
  await page.locator('#motion-guide').fill('')
  await page.locator('#motion-guide').blur()
  await expect(page.getByText('Saved').first()).toBeVisible()
  await page.goto(channelPath('/settings?tab=motion', FIRST_SLUG))
  await expect(page.locator('#motion-guide')).toHaveValue('')
})
```

- [ ] **Step 2: Run** from the e2e package: `cd e2e && pnpm exec playwright test tests/settings-motion.spec.ts` (free port 3100 first if an earlier run left a dev server; memory: scoped e2e runs). Expected: the two new tests FAIL against the old tab, the existing one passes.
- [ ] **Step 3: Implement** nothing new in code unless the tests found a gap; write the doc sentence and the PROGRESS entries.
- [ ] **Step 4: Run** the spec again. Expected: 3 passed. Then the full verification: `pnpm --filter @boom-busters/schemas test`, `pnpm --filter @boom-busters/db test`, `pnpm --filter @boom-busters/providers test`, `pnpm --filter @boom-busters/compositions test`, `cd apps/web && pnpm exec vitest run` (one web run at a time: the test database is shared), `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check`. Expected: every suite green, zero warnings.
- [ ] **Step 5: Commit**: `git add e2e/tests/settings-motion.spec.ts docs/motion-references.md PROGRESS.md && git commit -m "docs: decision 396, the motion references ingest and the identity draft"`.

---

## Self-review notes

- Spec coverage: 5.1 to 5.3 (Task 1, 2); 6 on the tab (Task 7, guideline module); 7.1 (Task 2); 7.2 (Tasks 4, 5, 7); 7.3 (Task 6, with the owner's edit in Task 7); 8.4 (Tasks 3, 5, 8); 11.1 draft buttons (Task 8); 11.2 (Task 7); 4's mock rule (Tasks 3, 5, 6); 12.2's 1600 px sheets (Task 6). Spec 9 (derivation), 10 (metrics and the critic), 9.4 (copy) and 11.3 to 11.4 are plans 3 and 4. The `motion_verdicts` table (spec 11) lands with the first verdict in plan 4.
- Type consistency: `ReferenceFrames` (Task 1) is the `frames` column (Task 2), the finalise input's shape (Task 5) and `renderSheets`' input (Task 6). `ReferenceForReading` (Task 3) is built from `MotionReferenceRow` in Task 6 and from `ReferenceView` nowhere (the tab never calls the prompt). `MotionIdentityDraft.identity` is a full `MotionIdentity`, so Task 8's `commit({ motion: identity })` passes `patchSection(MotionIdentitySchema)` whole.
- Proportion: the spec's sections for this plan run about 120 lines; the plan is longer because it carries the test cases and the copy, not the bodies.
