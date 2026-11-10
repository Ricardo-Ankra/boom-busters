# Long Renders in Parts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a master longer than 30 minutes as parts of about 15 minutes, join them into one normalised master without any disk or invocation holding the whole film, QC part by part, resume the YouTube upload across invocations, batch the transcription fallback, and raise the start limit to 180 minutes.

**Architecture:** Pure planning and merging live in `@boom-busters/schemas` (`render-parts.ts`): the part plan, the loudness combination, the QC merge, the progress weighting and the ledger sum. The broker learns one optional field (`frameRange`) and two routes (`/presign`, `/media/join`); media-utils learns a streaming `join` job, a budgeted and resumable upload, a batched transcribe and a QC job that also measures loudness. The render runner forks after `load-render` on the plan and drives parts in waves; the single-render path is untouched. A new jsonb column `renders.parts` carries the parts for the progress route, the stop action and the preview screen.

**Tech Stack:** Next.js App Router, Inngest (`@inngest/test`), Zod 4, Drizzle (migration 0054), AWS CDK, `@remotion/lambda` 4.0.512 (`frameRange`, `h264-mkv`, `pcm-16`), ffmpeg (concat demuxer, loudnorm, ebur128, fragmented MP4), `@aws-sdk/client-s3` multipart, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-10-long-renders-design.md` (written 2026-11-10; the owner asked for it without brainstorm questions). Read it in full before Task 1, including the "Evidence" subsection of 7.3; this plan argues from it.

## Global Constraints

- Branch `long-renders` (worktree `.claude/worktrees/long-renders`, master merged 2026-11-10); small commits, one logical change each; commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Films at or under `RENDER_SINGLE_MAX_SEC = 1800` render exactly as today: no single-render step id, payload or result shape changes. Parts above it, `RENDER_PART_TARGET_SEC = 900`, `N = ceil(durationSec / 900)`, part length `ceil(totalFrames / N)` frames, frames counted as the composition does: `Math.round(durationMs * fps / 1000)`.
- A part request carries `frameRange: [first, last]` inclusive and is rendered `codec: 'h264-mkv'`, `audioCodec: 'pcm-16'`, output `renders/<remotionRenderId>/out.mkv`. A request without `frameRange` is unchanged.
- The join command is the one in the spec's Evidence block, verbatim flags: concat demuxer over presigned URLs, `-c:v copy`, `<loudnormApplyFilter>,ebur128`, `-c:a aac -b:a 192k -ar 48000`, `-movflags empty_moov+default_base_moof+delay_moov -frag_duration 10000000 -f mp4 pipe:1`, streamed into a multipart upload of 64 MiB parts. Nothing of the output touches `/tmp`.
- Loudness: per part `loudnorm` measurement; combined `input_i = -0.691 + 10 log10(Σ d_k 10^((I_k + 0.691)/10) / Σ d_k)`, `input_tp = max`, `input_lra = max`, `input_thresh = input_i - 10`, `target_offset = "0.00"`. Out of tolerance (1.5 LU) is a QC warning, never a failed stage.
- Retry: a failed or timed-out part is cancelled on the broker (tombstone) then resubmitted once under a new ULID; the join is retried once with a new job id. Second failures fail the stage. Ledger: completed attempts at reported cost, failed attempts at `estimate × partFrames / totalFrames`.
- Upload rounds: budget 12 minutes (`720_000` ms) per invocation, at most 30 rounds, one resumable session.
- Transcription batches of 8 when `2 × untimed + ASSEMBLY_FIXED_STEPS + stockSteps + STEP_MARGIN > STEP_LIMIT`; batched ids `transcribe-batch-<n>`, `transcribe-batch-wait-<n>`; a run that fits keeps its per-paragraph ids.
- Migration numbering: master's last is `0053_lyrical_gabe_jones`; this branch adds 0054. Compare `packages/db/drizzle/meta/_journal.json` against `origin/master` again at merge.
- Mock-provider mode by default; no test spends; the mock render path is unchanged (one fixture render).
- `'use server'` modules export only async functions.
- Button-first UI, console tokens only, dark default. Copy: no em or en dashes in user-visible strings; South African spelling.
- Verification before every commit: `pnpm typecheck`, `pnpm lint` (zero warnings), `pnpm format:check` on tracked files. Run one test file with `pnpm exec vitest run <basename>` from the package directory. Database suites need Docker Desktop and this worktree's own test database (`.env.local` here points `TEST_DATABASE_URL` at `boom_busters_long_renders`, migrated 2026-11-10); never run two database suites at once. Every Bash call that runs tests passes `timeout: 600000`.

## Review Focus

1. **A part whose first attempt settles late.** After a timeout the first render may still finish; its webhook must emit nothing and its artefacts must be discarded, or the runner's retry wait could match the wrong `render/settled` and the ledger double-count. (Task 7 test `cancels a timed-out part on the broker before resubmitting it`.)
2. **An old `qc` or `upload-youtube` payload from a parked run.** Jobs submitted before the deploy carry none of the new fields; the Lambda and the runner's parsers must read them exactly as before. (Task 2 tests `an upload job without resume parses as before`, `a QC report without loudnorm parses as before`.)
3. **The combined loudness with one silent part.** A part whose measurement is `-70` (ffmpeg's floor for silence) must not drag `input_i` to nonsense through the log, and must not make `input_thresh` exceed `input_i`. (Task 1 test `a silent part weighs its duration, nothing more`.)
4. **A stop while parts render.** Two parts in flight and ten queued: the stop must cancel exactly the rendering parts' ULIDs on the broker, never the master row's id (which the broker does not know), and the row must read cancelled. (Task 8 test `cancels every rendering part, not the master row`.)
5. **Progress for a parts render must never go backwards or past 100.** A part the broker reports at 0.4 while four of twelve are done gives 36.7 percent, rounded 37; a completed part counts whole whatever the broker still says. (Task 1 test `weights live progress by part frames and clamps`.)

---

### Task 1: The part plan, the loudness combination and the merges

**Files:**
- Create: `packages/schemas/src/render-parts.ts`
- Create: `packages/schemas/src/render-parts.test.ts`
- Modify: `packages/schemas/src/broker.ts` (add `LoudnormMeasurementSchema`; `QcReportSchema` gains `loudnorm` and `durationMs`, both optional)
- Modify: `packages/schemas/src/index.ts` (export `./render-parts`)

**Interfaces:**
- Produces, in `broker.ts`:
  - `LoudnormMeasurementSchema = z.object({ input_i, input_tp, input_lra, input_thresh, target_offset }: all z.string())`, `type LoudnormMeasurement`.
  - `QcReportSchema` gains `loudnorm: LoudnormMeasurementSchema.optional()` and `durationMs: z.number().int().min(0).optional()`.
- Produces, in `render-parts.ts`:
  - `RENDER_SINGLE_MAX_SEC = 1800`, `RENDER_PART_TARGET_SEC = 900`.
  - `rendersInParts(durationSec: number): boolean` (strictly greater than the single limit).
  - `interface RenderPartPlan { index: number; frameRange: [number, number]; startMs: number; durationMs: number }`.
  - `planRenderParts(timeline: Timeline): RenderPartPlan[]`: frames `Math.round(timelineDurationMs(timeline) * fps / 1000)`; `startMs = Math.round(first * 1000 / fps)`, `durationMs = Math.round((last - first + 1) * 1000 / fps)`.
  - `RenderPartStatusSchema = z.enum(['queued', 'rendering', 'completed', 'failed'])`.
  - `RenderPartSchema = z.object({ index, renderId: UlidSchema, frameRange: z.tuple([int, int]), startMs, durationMs, status, attempt: z.number().int().min(1).max(2), priorRenderIds: z.array(UlidSchema).default([]), remotionRenderId: z.string().optional(), outputS3Key: z.string().optional(), costUsd: z.number().min(0).optional(), message: z.string().optional(), qc: QcReportSchema.optional() })`, `RenderPartsSchema = z.array(RenderPartSchema)`, `type RenderPart`.
  - `combineLoudness(parts: { measurement: LoudnormMeasurement; durationMs: number }[]): LoudnormMeasurement` (formula in Global Constraints; strings formatted with two decimals like ffmpeg prints them).
  - `mergeQcReports(parts: { qc: QcReport }[], join: { integratedLufs: number | null }, targetLufs: number): QcReport`: part issues minus `kind === 'loudness'`, sorted by `atMs`; one loudness issue when `join.integratedLufs` is null or differs from the target by more than `QC_LOUDNESS_TOLERANCE_LU = 1.5` (define the constant here; it duplicates `commands.ts`'s value by design, the contract package cannot import infra); `integratedLufs` is the join's figure or 0; `passed = issues.length === 0`.
  - `partsProgressPct(parts: RenderPart[], live: Record<string, number>): number`: `Σ frames(part) × (status completed ? 1 : live[part.renderId] ?? 0) / totalFrames × 100`, `Math.round`, clamped 0 to 100.
  - `partEstimateUsd(estimateUsd: number, part: RenderPart, totalFrames: number): number` (rounded to 4 places).
  - `settleRenderParts(parts: RenderPart[], estimateUsd: number, totalFrames: number): number`: completed parts at `costUsd ?? partEstimateUsd`, plus `partEstimateUsd` for each entry of `priorRenderIds` and for each part with status `failed`; rounded to 4 places.
  - `partWaves<T>(items: T[], size: number): T[][]`.

- [ ] **Step 1: Write the failing tests** in `render-parts.test.ts`:
  - `it('renders at or under 30 minutes as one piece')`: `rendersInParts(1800)` false, `rendersInParts(1801)` true.
  - `it('plans equal parts from the count, the last taking the remainder')`: a 31-minute timeline at 30 fps (55,800 frames) gives 3 parts, frame ranges `[0, 18599]`, `[18600, 37199]`, `[37200, 55799]`; `startMs` 0, 620000, 1240000; the last `durationMs` 620000.
  - `it('plans twelve parts for 180 minutes')`: 324,000 frames at 30 fps gives 12 parts of 27,000 frames; the last range ends at 323999.
  - `it('counts frames as the composition does')`: a timeline of 20,017 ms at 30 fps plans to 601 frames (round, not ceil).
  - `it('combines equal parts to their common value')`: two parts at `-18.00` give `input_i` `-18.00`, `input_tp` the maximum, `input_lra` the maximum, `input_thresh` `-28.00`, `target_offset` `"0.00"`.
  - `it('a silent part weighs its duration, nothing more')`: parts `-14.00` for 900 s and `-70.00` for 900 s combine to `-17.01` (±0.02); `input_thresh` is `input_i - 10`.
  - `it('returns a single part unchanged except the offset')`.
  - `it('merges part issues on the film clock and judges loudness from the join')`: two parts, one with a `silence` at 5000 and a per-part `loudness` issue, the other with `black-frames` at 905000; join `-14.4`: issues are the silence and the black, in that order, `passed` true; join `-16.2` adds one `loudness` issue at 0 and `passed` false; join `null` adds `integrated loudness could not be measured`.
  - `it('weights live progress by part frames and clamps')`: twelve equal parts, four completed, the fifth live at 0.4 gives 37; a completed part with live 0.1 counts whole; live above 1 clamps to 100 at most.
  - `it('settles completed parts at cost and every failed attempt at its share')`: estimate 11.00 over 12 equal parts: parts 0 and 1 completed at 0.93 and 0.95, part 2 completed at 0.94 with one prior id, part 3 failed gives `0.93 + 0.95 + 0.94 + 0.9167 + 0.9167 = 4.6534` (±0.0001).
  - `it('splits into waves')`: 5 items by 2 gives `[[a,b],[c,d],[e]]`.
  - In `broker.test.ts`: `it('a QC report without loudnorm parses as before')` (the existing report shape parses, `loudnorm` undefined) and `it('carries the loudnorm measurement and duration on a part report')`.

- [ ] **Step 2: Run them to see them fail.** From `packages/schemas`: `pnpm exec vitest run render-parts broker`. Expected: module not found / schema fields missing.

- [ ] **Step 3: Implement** `render-parts.ts` and the `broker.ts` additions per Interfaces. `combineLoudness` parses the strings with `Number`, computes in linear power, and formats with `toFixed(2)`.

- [ ] **Step 4: Run the tests.** `pnpm exec vitest run render-parts broker` from `packages/schemas`. Expected: PASS. Then `pnpm typecheck` at the root.

- [ ] **Step 5: Commit** `feat(schemas): the part plan, loudness combination and QC merge for long renders`.

---

### Task 2: The contract changes for the broker and media-utils jobs

**Files:**
- Modify: `packages/schemas/src/broker.ts`
- Modify: `packages/schemas/src/broker.test.ts`
- Modify: `packages/schemas/src/events.ts:208-215` (`MediaJobCompletedSchema.kind` gains `'join'`)

**Interfaces:**
- Produces:
  - `RenderRequestSchema` gains `frameRange: z.tuple([z.number().int().min(0), z.number().int().min(0)]).optional()`, refined `first <= last`.
  - `QcJobSchema` gains `offsetMs: z.number().int().min(0).default(0)` and `withLoudnorm: z.boolean().default(false)`.
  - `MEDIA_JOB_KINDS` gains `'join'`; `JoinJobSchema = z.object({ kind: z.literal('join'), ...jobCommon, partS3Keys: z.array(z.string().min(1)).min(2), outputS3Key: z.string().regex(/^renders\//), targetLufs: z.number().max(0).default(-14), measured: LoudnormMeasurementSchema })`; `JoinResultSchema = z.object({ outputS3Key, integratedLufs: z.number().nullable(), bytes: z.number().int().min(0), elapsedMs: z.number().int().min(0) })`; `MediaJobSchema` and `MediaJobCallbackSchema` gain the join member (callback `result: JoinResultSchema.optional()`).
  - `UploadYoutubeJobSchema` gains `resume: z.object({ uploadUrl: z.url(), offset: z.number().int().min(0) }).optional()` and `budgetMs: z.number().int().positive().optional()`.
  - `UploadYoutubeResultSchema = z.union([ z.object({ videoId: z.string().min(1), status: z.string().min(1) }), z.object({ status: z.literal('in-progress'), uploadUrl: z.url(), offset: z.number().int().min(0), total: z.number().int().positive() }) ])`, `type UploadYoutubeResult`.
  - `TranscribeJobSchema`: `audioS3Key` becomes optional, gains `audioS3Keys: z.array(z.string().min(1)).min(1).max(8).optional()`, refined exactly one of the two present. `TranscribeResultSchema = z.union([ z.object({ words: z.array(CaptionSchema) }), z.object({ results: z.array(z.object({ audioS3Key: z.string().min(1), words: z.array(CaptionSchema) })) }) ])`.
  - `PresignRequestSchema = z.object({ key: z.string().regex(/^renders\/.+/) })`, `PresignResponseSchema = z.object({ url: z.url() })`.

- [ ] **Step 1: Write the failing tests** in `broker.test.ts`:
  - `it('accepts a part request with an inclusive frame range and refuses a reversed one')`.
  - `it('defaults a QC job to no offset and no loudnorm measurement')`: the existing qc payload parses with `offsetMs` 0, `withLoudnorm` false.
  - `it('accepts a join job and refuses an output outside renders/')`.
  - `it('an upload job without resume parses as before')` and `it('reads an in-progress upload result and a finished one')`.
  - `it('accepts a transcribe job with one key or a batch, never both or neither')`.
  - `it('presigns only render-bucket keys')`: `boom-busters/x` refused.
  - In `events.test.ts` (exists beside events.ts; add if not): `it('media/job.completed accepts the join kind')`.

- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run broker events` from `packages/schemas`.

- [ ] **Step 3: Implement** per Interfaces. Keep every new field optional or defaulted so an old payload serialises and parses unchanged.

- [ ] **Step 4: Run the tests and typecheck.** `pnpm exec vitest run broker events`; root `pnpm typecheck` (the assembly runner's `TranscribeResultSchema.parse(...).words` no longer typechecks; make it `'words' in parsed ? parsed.words : parsed.results[0]?.words ?? []` for now, Task 10 rewrites the loop).

- [ ] **Step 5: Commit** `feat(schemas): frame ranges, the join job, resumable uploads and batched transcription in the broker contract`.

---

### Task 3: The parts column

**Files:**
- Modify: `packages/db/src/schema.ts:1500-1527` (`parts: jsonb('parts').$type<RenderPart[]>()`)
- Create: `packages/db/drizzle/0054_<drizzle name>.sql` via `pnpm --filter @boom-busters/db generate`
- Modify: `packages/db/src/renders.ts` (`updateRender` patch gains `parts: RenderPart[]`; add `updateRenderParts`)
- Modify: `packages/db/src/renders.integration.test.ts`

**Interfaces:**
- Produces: `RenderRow.parts: RenderPart[] | null`; `updateRenderParts(db, id, parts: RenderPart[]): Promise<void>`; `updateRender(db, id, { parts })` also accepted.

- [ ] **Step 1: Write the failing test** in `renders.integration.test.ts`: `it('round-trips the parts of a long render')`: insert a master row, `updateRenderParts` with two parts (one `rendering`, one `queued`, `priorRenderIds` empty), `getRender` returns them equal; a fresh row has `parts` null.
- [ ] **Step 2: Run it to see it fail.** From `packages/db`: `pnpm exec vitest run renders.integration` (timeout 600000). Expected: column does not exist / helper missing.
- [ ] **Step 3: Add the column, generate the migration** (`pnpm --filter @boom-busters/db generate`; confirm the journal's new tag starts `0054_` and the SQL is one `ALTER TABLE "renders" ADD COLUMN "parts" jsonb;`), apply it to this worktree's test database (`pnpm db:migrate:test`), and add the helpers.
- [ ] **Step 4: Run the test.** `pnpm exec vitest run renders.integration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): renders.parts for long renders (migration 0054)`.

---

### Task 4: The broker: frame ranges, the presign route and the join dispatch

**Files:**
- Modify: `infra/lambdas/broker/core.ts`
- Modify: `infra/lambdas/broker/handler.ts`
- Modify: `infra/lambdas/broker/core.test.ts`
- Modify: `apps/web/lib/broker.ts`

**Interfaces:**
- Consumes: Task 2's schemas.
- Produces:
  - `RenderRecord.frameRange?: [number, number]`.
  - `RemotionClient.render` input gains `frameRange?: [number, number]`; the handler maps its presence to `codec: 'h264-mkv'`, `audioCodec: 'pcm-16'`, and passes `frameRange` through.
  - `StorageClient.presignOutput(key: string): Promise<string>` (render bucket, 24 h; handler uses `RENDER_BUCKET`).
  - Routes: `POST /presign` (bearer) → 200 `PresignResponseSchema`, 400 on a key outside `renders/`; `POST /media/join` in `MEDIA_PATHS`.
  - `handleCreateRender`: with a range, 400 when `last >= totalFrames`; `framesPerLambda = max(4, ceil((last - first + 1) / renderFanout))`.
  - `outputKeyFrom` fallback `renders/<remotionRenderId>/out.mkv` when the record has a range.
  - App client: `presignRenderOutput(key: string): Promise<string>` in `apps/web/lib/broker.ts`; `MEDIA_PATHS.join = '/media/join'`.

- [ ] **Step 1: Write the failing tests** in `core.test.ts`:
  - `it('sizes a part's chunks from its frame range and renders it as MKV with PCM audio')`: a 31-minute canonical timeline, range `[0, 18599]`, fan-out 150 → `remotion.render` called with `framesPerLambda` 124 and `frameRange [0, 18599]`; the stored record carries the range.
  - `it('refuses a frame range past the timeline's last frame')`: 400, nothing rendered.
  - `it('falls back to out.mkv for a part's webhook with no outputFile')`.
  - `it('presigns a render-bucket key and refuses any other')`: `POST /presign` `{ key: 'renders/x/master.mp4' }` → 200 with the url from `presignOutput`; `boom-busters/x` → 400; no bearer → 401.
  - `it('dispatches a join job on its route')`.
- [ ] **Step 2: Run to see them fail.** From `infra`: `pnpm exec vitest run core`.
- [ ] **Step 3: Implement** core and handler; in the handler's `render`, spread `...(frameRange ? { frameRange, codec: 'h264-mkv' as const, audioCodec: 'pcm-16' as const } : { codec: 'h264' as const })`. Add `presignRenderOutput` to the app client (`POST /presign`, parse `PresignResponseSchema`, return `url`).
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(broker): part renders by frame range, a presign route and the join dispatch`.

---

### Task 5: media-utils: measure a part and join the parts

**Files:**
- Modify: `infra/lambdas/media-utils/commands.ts`
- Create: `infra/lambdas/media-utils/multipart.ts`
- Create: `infra/lambdas/media-utils/multipart.test.ts`
- Modify: `infra/lambdas/media-utils/commands.test.ts`
- Modify: `infra/lambdas/media-utils/handler.ts`
- Modify: `infra/lib/media-utils-stack.ts`, `infra/test/stacks.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces, `commands.ts`:
  - `LoudnormMeasurement` is now imported from `@boom-busters/schemas` and re-exported.
  - `buildQcReport(input & { offsetMs?: number; loudnorm?: LoudnormMeasurement; durationMs?: number })`: every issue's `atMs` plus the offset; `loudnorm` and `durationMs` copied onto the report when given.
  - `parseDurationMs(stderr: string): number | null` from ffmpeg's `Duration: HH:MM:SS.cc` line.
  - `loudnormMeasureArgs(inputPath, targetLufs, options?: { audioOnly: boolean })`: `-vn` before `-i` when audio only.
  - `concatListText(urls: string[]): string`: one `file '<url>'` line each, single quotes in a url escaped as `'\''`.
  - `joinArgs(listPath: string, targetLufs: number, measured: LoudnormMeasurement): string[]`: the spec's command verbatim, ending `'-f', 'mp4', 'pipe:1'`.
- Produces, `multipart.ts`:
  - `MULTIPART_PART_BYTES = 64 * 1024 * 1024`.
  - `uploadStreamMultipart(input: { stream: Readable; partBytes?: number; create: () => Promise<string>; uploadPart: (uploadId: string, partNumber: number, body: Buffer) => Promise<string>; complete: (uploadId: string, parts: { partNumber: number; etag: string }[]) => Promise<void>; abort: (uploadId: string) => Promise<void> }): Promise<{ bytes: number; parts: number }>`: buffers to `partBytes`, uploads sequentially, the last part may be short, aborts and rethrows on any error (including a stream error), rejects an empty stream after aborting.
- Produces, `handler.ts`: `runJoin(job)`; `runQc` honours `offsetMs` and `withLoudnorm` (second pass with `loudnormMeasureArgs(input, target, { audioOnly: true })`, parsed with `parseLoudnormJson`); the switch gains `case 'join'`.
- Produces, stack: the render-bucket policy gains `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts`.

- [ ] **Step 1: Write the failing tests**:
  - `commands.test.ts`: `it('shifts every issue by the part offset and carries the measurement')`; `it('reads the duration line')` (`Duration: 00:15:00.03` → 900030); `it('measures audio only when asked')` (`-vn` precedes `-i`); `it('writes one file line per url and escapes a quote')`; `it('joins by stream copy with the loudness filter, fragmented, to stdout')` (asserts `-c:v copy`, the `loudnorm=…linear=true,ebur128` filter, `empty_moov+default_base_moof+delay_moov`, `-frag_duration 10000000`, ends with `-f mp4 pipe:1`, includes `-protocol_whitelist file,https,tls,tcp`).
  - `multipart.test.ts`: `it('uploads in parts of the given size, the last one short, and completes in order')` (a 10-byte stream with `partBytes` 4 → parts of 4, 4, 2, `complete` with part numbers 1 to 3 and the etags); `it('aborts and rethrows when a part upload fails')`; `it('aborts when the stream errors')`.
  - `stacks.test.ts`: `it('lets media-utils abort and list multipart uploads on the render bucket')`.
- [ ] **Step 2: Run to see them fail.** From `infra`: `pnpm exec vitest run commands multipart stacks`.
- [ ] **Step 3: Implement.** `runJoin`: presign each part key with `getSignedUrl(s3, GetObjectCommand{ Bucket: RENDER_BUCKET })` (24 h), write `/tmp/join-list.txt`, `spawn(FFMPEG, joinArgs(...))` with stdout piped into `uploadStreamMultipart` whose S3 calls use `CreateMultipartUploadCommand`, `UploadPartCommand`, `CompleteMultipartUploadCommand`, `AbortMultipartUploadCommand` (content type `video/mp4`); collect stderr; await both the upload and the process exit; non-zero exit throws after the upload aborted (call `abort` from the exit handler path only if the upload has not completed; the simplest correct shape: run the upload and the exit promise with `Promise.all`, and let a rejection of either abort). Result `{ outputS3Key, integratedLufs: parseIntegratedLufs(stderr), bytes, elapsedMs }`.
- [ ] **Step 4: Run the tests, typecheck and lint.** Also run the whole infra package once: `pnpm --filter @boom-busters/infra test`.
- [ ] **Step 5: Commit** `feat(media-utils): measure a part's loudness in its QC job, and join parts by streaming into a multipart upload`.

---

### Task 6: media-utils: the resumable upload and the batched transcribe

**Files:**
- Modify: `infra/lambdas/media-utils/youtube-upload.ts`, `youtube-upload.test.ts`
- Modify: `infra/lambdas/media-utils/handler.ts`

**Interfaces:**
- Consumes: Task 2's `UploadYoutubeResult`, `TranscribeResult`.
- Produces:
  - `UPLOAD_BUDGET_MS = 12 * 60_000`.
  - `putInChunks(input & { startOffset?: number; deadlineAt?: number; now?: () => number }): Promise<UploadYoutubeResult>`: starts at `startOffset`; before each chunk, when `now() >= deadlineAt`, returns `{ status: 'in-progress', uploadUrl, offset, total }`; otherwise as today, returning `{ videoId, status }`.
  - `querySessionOffset(input: { uploadUrl: string; total: number; fetchImpl: typeof fetch }): Promise<{ kind: 'offset'; offset: number } | { kind: 'done'; videoId: string; status: string }>`: `PUT` with `content-length: 0` and `content-range: bytes */<total>`; 308 with `range: bytes=0-N` → `N + 1`, 308 without a range → 0; 200 or 201 → done with the body's id and status; anything else throws `youtube session status <code>`.
  - `runUploadYoutube`: with `job.resume`, skips the init request, queries the session, and continues from its offset (or returns the done result); without it, as today; both paths pass `deadlineAt = Date.now() + (job.budgetMs ?? UPLOAD_BUDGET_MS)`.
  - `runTranscribe`: keys `job.audioS3Keys ?? [job.audioS3Key!]`; one key with `audioS3Key` given returns `{ words }`; `audioS3Keys` given returns `{ results: [{ audioS3Key, words }] }` in input order.

- [ ] **Step 1: Write the failing tests** in `youtube-upload.test.ts`: `it('stops at the deadline and reports where it got to')` (3 chunks, a clock that passes the deadline after the first, result in-progress with `offset` = one chunk); `it('resumes from the given offset')` (first PUT's `content-range` starts at the offset); `it('reads the session offset from a 308 range and a finished session from a 200')`.
- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run youtube-upload` from `infra`.
- [ ] **Step 3: Implement**, keeping today's behaviour when no deadline, offset or resume is given.
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(media-utils): a YouTube upload that resumes across invocations, and transcription in batches`.

---

### Task 7: The render runner's parts path

**Files:**
- Modify: `apps/web/inngest/functions/render-runner.ts`
- Modify: `apps/web/inngest/functions/render-runner.test.ts`

**Interfaces:**
- Consumes: Task 1 (`planRenderParts`, `rendersInParts`, `combineLoudness`, `mergeQcReports`, `partsProgressPct`, `settleRenderParts`, `partWaves`, `RenderPart`), Task 3 (`updateRenderParts`), Task 4 (`submitRender` with `frameRange`, `cancelRender`), Task 2 (`JoinResultSchema`, `QcJobSchema` fields).
- Produces: the live path below; step ids are part of the contract (a parked run replays by id).

Flow, after `load-render` (which now also returns `parts: RenderPart[] | null`, `totalFrames`, `concurrency: settings.render.concurrency`, writing the parts with status `queued`, `attempt` 1, fresh `newId<'render'>()` ULIDs):

- `invoke-broker` unchanged for a single render. For parts it only reserves (same ledger meta plus `parts: N`) and returns `{ ok: true, ledgerId }` without a submit.
- For each wave of `partWaves(parts, concurrency)`: `submit-part-<i>` per part (post `{ projectId, renderId: part.renderId, kind: 'master', timelineS3Key, composition: 'DocumentaryMaster', expectedDurationSec: part.durationMs / 1000, frameRange }`; on the master row set `status: 'rendering'` once; on the part set `remotionRenderId`, `status: 'rendering'`). Then `await-part-<i>` per part (`render/settled`, `if async.data.renderId == "<part.renderId>"`, timeout `timeoutMinutes + 10` minutes). Then `record-part-<i>`: completed → part `completed`, `outputS3Key`, `costUsd`, row `progressPct = partsProgressPct(parts, {})`; failed or null → `retry-part-<i>` (only once: `cancelRender(part.renderId)` in a try/catch, push the id to `priorRenderIds`, new ULID, `attempt` 2, resubmit as `submit-part-<i>-retry`, wait `await-part-<i>-retry`, record `record-part-<i>-retry`); a second failure → `part-failed-<i>`: row failed with `part <i+1> of <N> failed twice: <detail>`, ledger settled at `settleRenderParts`, `markStageFailed`, return `{ outcome: 'failed' }`.
- `submit-qc-part-<i>` for every part (kind `qc`, `s3Key: part.outputS3Key`, `targetLufs: -14`, `offsetMs: part.startMs`, `withLoudnorm: true`), then `await-qc-part-<i>` (30 minutes each). A missing or `ok !== true` result → `qc-errored` as today, naming the part.
- `submit-join` with `partS3Keys` in order, `outputS3Key: renders/<renderId>/master.mp4`, `measured: combineLoudness(...)` from each part's `qc.loudnorm` and `qc.durationMs ?? part.durationMs`; `await-join` 20 minutes; failure → `submit-join-retry`, `await-join-retry`; second failure → `join-failed`: row failed `the parts rendered; the join failed: <detail>`, ledger settled, stage failed.
- `master-ready`: `qcReport = mergeQcReports(parts, join, -14)`, row `done`, `outputS3Key` the join's, `costUsd` the settled sum, `settle(ledger, settleRenderParts(...))`, `leaveMaster`; then `emit-master-ready` as today.
- `onFailure` unchanged.

- [ ] **Step 1: Write the failing tests** in `render-runner.test.ts`, under `describe('live path, in parts')`, with a `longTimeline()` helper that stretches `canonicalTimeline()`'s narration and slot to 1,860,000 ms:
  - `it('plans the parts on the row, reserves once and submits the first wave with frame ranges')`: `engine.executeStep('submit-part-1', …)`; the row has 3 parts; `submitRender` called twice, with `frameRange` `[0, 18599]` and `[18600, 37199]`, `renderId` the parts' ULIDs, `expectedDurationSec` 620; the ledger holds one unsettled `render-master` entry at the whole estimate; the row's `brokerRenderId` is null and its status `rendering`.
  - `it('cancels a timed-out part on the broker before resubmitting it')`: drive to `submit-part-0-retry` with the step harness's event injection for `await-part-0` returning null (see `demo-pipeline.test.ts` for the pattern; if the harness cannot inject a null wait, test the retry branch through an exported pure `retryPlan(part)` that returns the cancel id and the new part shape, and assert the ids differ and the old one is in `priorRenderIds`); `cancelRender` called with the first ULID.
  - `it('keeps the single-render path byte for byte')`: the existing live test still passes with `invoke-broker` submitting; no `parts` on its row.
- [ ] **Step 2: Run to see them fail.** From `apps/web`: `pnpm exec vitest run render-runner` (timeout 600000; the database suite).
- [ ] **Step 3: Implement.** Keep the single-render code where it is; add the parts branch as a separate async function `renderInParts(ctx, step, setup, invoked)` in the same file so the single path's diff is a few lines.
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): render a long master in parts, QC each, and join them (decision 452)`.

---

### Task 8: Progress, the stop action and the preview screen

**Files:**
- Modify: `apps/web/app/api/renders/[id]/progress/route.ts`
- Create: `apps/web/app/api/renders/[id]/progress/route.test.ts`
- Modify: `apps/web/app/(console)/projects/actions.ts:505-525`, `actions.test.ts`
- Modify: `apps/web/app/(console)/projects/[id]/page.tsx:332-345`, `preview-screen.tsx`, `preview-screen.test.tsx`, `project-controls.tsx:195-225`

**Interfaces:**
- Consumes: Task 1 (`partsProgressPct`), Task 4 (`presignRenderOutput`, `fetchRenderProgress`, `cancelRender`), Task 3 (`RenderRow.parts`).
- Produces:
  - Progress response gains `partNote?: string` (`Part <k> of <N>` for the lowest-index part still rendering) and `parts?: { index: number; startMs: number }[]`. For a row with parts: `progressPct = max(row.progressPct, partsProgressPct(parts, live))` where `live` holds `overallProgress` from `fetchRenderProgress(part.renderId)` for each part with status `rendering` (a failed call leaves that part out); for status `done`, `outputUrl = await presignRenderOutput(row.outputS3Key)` when the key starts with `renders/`.
  - `PreviewRenderProp` gains `parts: { index: number; startMs: number }[] | null`; `FileStage` appends ` · ${partNote}` to the rendering label and, for a done parts master, shows buttons labelled `Part ${index + 1} · ${fmtClock(startMs)}` that set `fileRef.current.currentTime = startMs / 1000`.
  - Stop wording when `render.parts` is non-null: `The parts in flight can't be aborted; they finish in the background and are discarded, about $<(costUsd / parts.length).toFixed(2)> each.` in both `preview-screen.tsx` and `StopButton` (new optional prop `partEstimateUsd?: number`, computed in `page.tsx`).
  - `stopProject`: when `inFlight.parts` is non-null, `cancelRender(part.renderId)` for each part with status `rendering`, each in its own try/catch; never `cancelRender(inFlight.id)` for a parts row.

- [ ] **Step 1: Write the failing tests**:
  - `route.test.ts` (mock `@/auth`, `@/lib/broker`, use the test database like `actions.test.ts` does): `it('weights a parts render by frames and names the part')` (12 parts, 4 done, part 5 live at 0.4 → `progressPct` 37, `partNote` `Part 5 of 12`); `it('presigns the joined master for a done parts render')`.
  - `actions.test.ts`: `it('cancels every rendering part, not the master row')`.
  - `preview-screen.test.tsx`: `it('seeks the master to a part')` (a done master with three parts shows `Part 2 · 15:00`; clicking sets the video's `currentTime` to 900); `it('names the parts in the Stop confirm')`.
- [ ] **Step 2: Run to see them fail.** From `apps/web`: `pnpm exec vitest run progress/route actions preview-screen` (one database suite at a time: run `route` and `actions` separately).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): parts progress, per-part stop and part seeking on the preview screen`.

---

### Task 9: The publish runner's upload rounds

**Files:**
- Modify: `apps/web/inngest/functions/publish-runner.ts:367-480`
- Modify: `apps/web/inngest/functions/publish-runner.test.ts`

**Interfaces:**
- Consumes: Task 2 (`UploadYoutubeResultSchema`, `resume`, `budgetMs`).
- Produces: `UPLOAD_ROUNDS_MAX = 30`, `UPLOAD_BUDGET_MS = 720_000`. The submit and wait become a loop over `round` from 0: step ids `submit-upload` and `await-upload` for round 0 (unchanged, so parked runs replay), `mint-token-<round>`, `submit-upload-<round>`, `await-upload-<round>` for rounds 1 and up. A completion parsed as `status: 'in-progress'` mints a fresh token and resubmits the same job with `resume: { uploadUrl, offset }`; a `videoId` result continues to `record-video` as today; `!ok`, null, or round `>= UPLOAD_ROUNDS_MAX` goes through the existing error mapper (the round cap maps as a `retry` with message `the upload did not finish in 30 rounds`). Every job carries `budgetMs: UPLOAD_BUDGET_MS`.

- [ ] **Step 1: Write the failing tests**: in the live path describe, `it('sends the budget and no resume on the first round')` (the submitted job has `budgetMs` 720000 and no `resume`); and a pure test of an exported `nextUploadRound(result: unknown): { kind: 'done'; videoId: string } | { kind: 'resume'; resume: { uploadUrl: string; offset: number } } | { kind: 'unreadable' }`: three cases.
- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run publish-runner` from `apps/web` (timeout 600000).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): the YouTube upload continues in rounds until it finishes`.

---

### Task 10: The transcription fallback in batches

**Files:**
- Modify: `apps/web/inngest/lib/slot-steps.ts`, create `apps/web/inngest/lib/slot-steps.test.ts` (if `long-runtime-steps.test.ts` already covers this module, add there)
- Modify: `apps/web/inngest/functions/assembly-runner.ts:160-275`

**Interfaces:**
- Consumes: Task 2 (`audioS3Keys`, `TranscribeResultSchema` union).
- Produces: `TRANSCRIBE_BATCH = 8`; `transcribePerParagraphFits(untimed: number, stockSteps: number): boolean` (`2 * untimed + ASSEMBLY_FIXED_STEPS + stockSteps + STEP_MARGIN <= STEP_LIMIT`); `batchParagraphs<T>(items: T[], size: number): T[][]`. In the runner: `stockSteps = perSlot ? stockSlots.length : Math.ceil(stockSlots.length / RESOLUTION_STEP_SLOTS)`; when the per-paragraph path fits, the loop is unchanged; otherwise `transcribe-batch-<n>` submits `{ kind: 'transcribe', audioS3Keys }` and `transcribe-batch-wait-<n>` waits `TRANSCRIBE_TIMEOUT`; results are matched to paragraphs by `audioS3Key === paragraph.r2Key`; a failed batch fails the stage naming `batch <n+1>`.

- [ ] **Step 1: Write the failing tests**: `it('fits one job a paragraph until the step limit, then batches')` (`transcribePerParagraphFits(200, 100)` true; `(440, 100)` false since `880 + 9 + 100 + 20 = 1009`); `it('batches eight at a time, the last short')`.
- [ ] **Step 2: Run to see them fail.** `pnpm exec vitest run slot-steps long-runtime-steps` from `apps/web`.
- [ ] **Step 3: Implement**, and update the doc comment block above `ASSEMBLY_FIXED_STEPS` to name the batch ids.
- [ ] **Step 4: Run the tests, typecheck and lint.**
- [ ] **Step 5: Commit** `feat(web): transcription fallback in batches of eight when one job a paragraph would not fit`.

---

### Task 11: The start limit, the docs and the finish

**Files:**
- Modify: `packages/schemas/src/formats.ts:7-10, 25, 46` (rename `RUNTIME_START_MAX` to `RUNTIME_DEFAULT_MAX = 30`, used only as the schema default)
- Modify: `apps/web/app/(console)/c/[slug]/cases/actions.ts:282-300`, `actions.test.ts:740-800`
- Modify: `apps/web/app/(console)/c/[slug]/cases/search-brief-panel.tsx:70-80, 214-232`, `case-library.test.tsx:880-960`
- Modify: `PROGRESS.md` (the Channel formats section's "Next project" checkbox ticked with a pointer; a new section `## Long renders in parts (2026-11-10)` with deliverables per task and "Owner actions at deploy" from spec section 12; decision 452 appended after 449 (master took 450 and 451))
- Modify: `infra/README.md` (the join job, the presign route, part renders), `docs/03-build-spec.md` section 8 (an italic amendment: masters over 30 minutes render in parts, decision 452), `docs/superpowers/specs/2026-11-03-channel-formats-and-keywords-design.md:201` (the "startable once long renders come in parts" note now true, one line)

- [ ] **Step 1: Update the tests first**: in `actions.test.ts` the two refusals at 743 and 751 become acceptance of a 60-minute start for a format whose max is 180, and the test at 796 goes; in `case-library.test.tsx` the "not supported yet" assertions at 883 and 957 become assertions that the runtime field's maximum is the format's own `runtime.max` and no note shows. Run them to see them fail (`pnpm exec vitest run cases/actions case-library` from `apps/web`).
- [ ] **Step 2: Implement**: the actions and the panel read `format.runtime.max` alone; delete `NOT_SUPPORTED_NOTE`, `tooLong`, `outOfRange` and the refusal branches; keep the min/max validation. `formats.test.ts` references updated if any.
- [ ] **Step 3: Run the tests, typecheck and lint.**
- [ ] **Step 4: Write the docs**: PROGRESS.md section and decision 452 (date 2026-11-10; what shipped, the calls from spec section 13 in one paragraph each where they settle something the spec left open, the fixture proof's three findings, the owner actions, "Not verified: a live parts render"); the infra README; the build spec amendment; the formats spec note.
- [ ] **Step 5: Whole-tree verification**: `pnpm typecheck`, `pnpm lint`, `pnpm format:check`; per package `pnpm --filter @boom-busters/schemas test`, `@boom-busters/infra test`, `@boom-busters/db test` (database), then `apps/web` in two halves (`pnpm exec vitest run inngest` then `pnpm exec vitest run app lib components`), each in its own Bash call with timeout 600000; `pnpm e2e -- tests/preview-render.spec.ts` from the e2e package only if the dev server port 3100 is free. Record any failure verbatim in the hand-back.
- [ ] **Step 6: Commit** `docs: long renders in parts shipped, start limit 180 (decision 452)` and `feat(web): the start limit follows the format's own maximum`.
