# Long renders in parts

Date: 2026-11-10. Status: design for the "Long renders in parts" project named
in PROGRESS.md (phase 5 of the channel formats work, decision 394). The owner
asked for the design to be written without the brainstorm questions; section
13 lists the calls the author made where the owner's words left room, so the
owner can check them while reading. Section 14 holds what stays open.

## 1. Why

A bible may hold formats up to 180 minutes (decision 393), but the start
control offers at most 30 and says longer videos are not supported yet
(decision 394). The evidence behind the 30 came from Remotion's own records of
two real 16.6-minute masters: 29,963 frames in 150 chunks of 200, 41 to 409
seconds a chunk, 742 MB, $1.00 each. From those figures:

- A Remotion chunk must finish inside the render function's 900 seconds. At
  the slowest observed rate that is about 350 frames a chunk, which at the
  broker's fan-out of 150 is about 29 minutes of video in one render. A
  60-minute film would put 720 frames in each chunk and time out.
- Remotion combines its chunks on the render function's 10 GB disk, and
  loudnorm afterwards writes a second copy of the file on media-utils' 10 GB
  disk. Either caps a single file near 112 minutes.
- The full QC decode and the YouTube upload each run inside one 15-minute
  media-utils invocation; a 180-minute master (about 8 GB) does not fit the
  upload with margin.
- The transcription fallback submits one job per untimed paragraph, two
  Inngest steps each; a long film can run over the 1,000-step limit.

The owner's ruling (2026-11-03, "agree and proceed"): the start limit stays 30
until a separate project renders the master as parts of about 15 minutes,
joins them without the whole file on one disk, runs loudnorm and QC part by
part, batches the transcription fallback, and makes the YouTube upload resume
across invocations. This is that project.

## 2. Goals, non-goals, anti-goals

Goals:

- A project of any runtime a bible allows, up to 180 minutes, renders a
  master, passes QC, and uploads to YouTube, with no step holding the whole
  file on one disk or inside one 15-minute invocation.
- The delivered master is one MP4 at the film's full length, at -14 LUFS
  integrated over the whole film, video frames identical to a single render.
- Films of 30 minutes and under render exactly as they do today. Nothing in
  this project changes the proven path.
- The render screen shows one progress bar and one master for a parts render,
  with the parts visible only as a convenience for review.
- Cost shown before the click stays honest: the estimate formula is
  unchanged ($1.00 per 996 seconds of video), the parts' real costs are summed
  into the row and the ledger.

Non-goals:

- Changing the Remotion function's memory, disk or timeout, or the broker's
  fan-out. The part length is chosen so today's deployment renders each part
  with the same margin as today's 16-minute masters.
- Resuming a partly finished master across runs (keeping finished parts when
  the run is restarted). A failed part is retried inside the run; a run that
  fails after that starts over on the next click, and its spend is sunk, as
  with a single render today. Section 14 names this as a later project if the
  owner wants it.
- Changing what Shorts, drafts or the browser preview do. Shorts render from
  the timeline, not the master; drafts stay single renders at half scale.
- A local parts render in mock-provider mode. The mock path keeps rendering
  the 20-second fixture once; the parts machinery is tested at the unit level
  and the live path is asserted up to its first wait, as the render runner's
  tests already do.

Anti-goals (a failure even if it works):

- Normalising each part to -14 LUFS on its own. That changes the level
  between chapters: a quiet chapter would be lifted more than a loud one, and
  the film would breathe wrongly at every join. The target is the integrated
  loudness of the whole film.
- A join that re-encodes video. It would cost a second render's time and a
  generation of quality. Video is copied; only audio is re-encoded, and audio
  must be re-encoded anyway for the loudness pass.
- A join that plays only after a full download. The joined master must play
  progressively from the first bytes, like today's masters.
- A spend that nobody saw coming. Every part is covered by the single
  reservation made before the first invoke; no part is rendered without it.

## 3. Today's pipeline, the facts the design rests on

- `render-runner` (`apps/web/inngest/functions/render-runner.ts`): one
  `renders` row, one broker invoke, one `render/settled` wait, loudnorm on the
  same key, QC, `project/master.ready`. The loudnorm job overwrites the
  master in place; a loudnorm failure downgrades to a QC warning.
- The broker (`infra/lambdas/broker/core.ts`, `handler.ts`): `POST /renders`
  validates and materialises the timeline, sizes `framesPerLambda` as total
  frames over `RENDER_FANOUT` (150), calls `renderMediaOnLambda`, and keys
  everything by the app's render ULID. Its `GET /renders/:id` presigns the
  finished file from Remotion's bucket for the player. State is JSON in the
  state bucket. Render cap `RENDER_CAP` is 2.
- media-utils (`infra/lambdas/media-utils/handler.ts`, `commands.ts`): jobs
  `qc`, `loudnorm`, `transcribe`, `upload-youtube`, each one async invocation
  of at most 15 minutes, 3,008 MB (the account's cap; the stack asks for
  10,240 when the quota allows), 10 GB of `/tmp`. Keys under `boom-busters/`
  live in R2, everything else in the render bucket. Every job ends in an
  HMAC-signed callback to `/api/hooks/broker`, which emits one Inngest event.
- The upload (`youtube-upload.ts`) already reads the video in 8 MB ranges
  and resumes on 308 inside one invocation. It cannot outlive the invocation.
- The publish runner mints a one-hour access token, submits one upload job
  and waits up to 7 hours for one completion.
- The assembly runner's alignment loop submits one `transcribe` job per
  paragraph that has no stored timings (two steps each). Stored ElevenLabs
  timings make this the fallback, not the rule.
- Remotion Lambda's `renderMediaOnLambda` accepts `frameRange: [start, end]`
  (inclusive) for the same composition and props, so a part is the same
  timeline rendered over a window of frames. Each render has its own Remotion
  id and output key, `renders/<remotionRenderId>/out.mp4`.
- Remotion Lambda already joins separately encoded files by stream copy:
  every master today is 150 chunks, each encoded on its own Lambda, that the
  main function concatenates without re-encoding video. Joining 12 parts from
  the same function with the same encoder settings is the same operation one
  level up. Section 7.3 records the local proof.
- `settings.render.concurrency` exists (`RenderSettingsSchema`, 1 to 10,
  default 2) and nothing reads it yet; `timeoutMinutes` is read by every
  render runner.
- The broker checks no budget. The app's reservation before the first invoke
  is the only spend gate; the broker's cap is a concurrency guard, answered
  409, which the app's step retries.
- Every consumer of a master key routes by prefix: `renders/…` is the render
  bucket, `boom-busters/…` is R2. The publish upload, QC and the broker
  presign all work on a `renders/` key already.
- The render screen polls `/api/renders/:id/progress` at 2 seconds; that route
  proxies the broker by the row's `brokerRenderId` and plays the master from
  the broker's presigned `outputUrl`.
- The stop action cancels the in-flight row's broker render by its id; the
  broker tombstones it and emits nothing when the webhook lands.

## 4. The shape of the change

A master longer than the single-render limit is planned as N parts of equal
length, each a frame window of the one timeline. The parts render through the
existing broker, up to `settings.render.concurrency` at a time. Each finished
part is measured once by media-utils: the QC scan and the loudnorm measurement
in one job, on one download. The measurements are combined into the film's
loudness, and a new `join` job streams the parts from the render bucket
through ffmpeg (video copied, audio normalised and re-encoded) into a
multipart upload of one fragmented MP4, so no disk ever holds more than one
part and no invocation holds the whole file. The upload to YouTube becomes a
loop of invocations sharing one resumable session. The transcription fallback
batches its paragraphs. The start limit rises to the bible's outer limit.

```
timeline (one JSON)                      renders row (kind master, parts[])
   │                                          │
   ├─ part 0: frames [0, L)      ──► broker ──► render/settled ─┐
   ├─ part 1: frames [L, 2L)     ──► broker ──► render/settled ─┤  C at a time
   └─ part N-1 ...               ──► broker ──► render/settled ─┘
                                                                 │
   per part: media-utils qc (+loudnorm measure, offset)  ◄───────┘
                                                                 │
   combineLoudness(parts) ─► media-utils join ─► renders/<id>/master.mp4
                                                                 │
   QC report = part issues (offset) + loudness of the join ─► master.ready
                                                                 │
   publish: upload rounds of ≤ 12 min, one resumable session ─► videoId
```

## 5. The part plan

Pure, in `packages/schemas` (`render-parts.ts`), tested without I/O:

- `RENDER_SINGLE_MAX_SEC = 30 * 60`. A film at or under it renders as one
  piece, today's path, untouched.
- `RENDER_PART_TARGET_SEC = 15 * 60`. Above the single limit, the part count
  is `N = ceil(durationSec / RENDER_PART_TARGET_SEC)` and the part length in
  frames is `ceil(totalFrames / N)`, so a 31-minute film is three parts of
  about 10 minutes, not 15, 15 and 1. The last part takes the remainder.
- `planRenderParts(timeline): RenderPartPlan[]` returns, per part: `index`,
  `frameRange: [first, last]` (inclusive, Remotion's convention), `startMs`,
  `durationMs`. Frames are `msToFrames(timelineDurationMs(timeline), fps)`,
  the same count the composition's `calculateMetadata` reports, so the parts
  cover exactly the frames a single render would.
- Part boundaries fall on whatever frame the arithmetic names. The join copies
  video frames, so a boundary inside a transition or a slot is invisible; the
  audio is decoded and re-encoded across the boundary, and each part's MP4
  carries the encoder's edit list, so the join is gapless. No snapping to
  slot or chapter boundaries.
- At 180 minutes and 30 fps: 324,000 frames, 12 parts of 27,000 frames, 180
  frames a Lambda chunk at the fan-out of 150, about half of today's 200 and a
  fifth of the 900-second limit's 350. Each part is about 15 minutes of video,
  about 700 MB of H.264 plus about 170 MB of PCM audio, about 7 minutes to
  render.

## 6. The broker

- `RenderRequestSchema` gains `frameRange: [int, int]` (optional). A request
  with it is a part: the broker passes the range to `renderMediaOnLambda`,
  sizes `framesPerLambda` from the window's length, not the whole timeline's,
  and renders it as `codec: 'h264-mkv'` with `audioCodec: 'pcm-16'`, so the
  parts abut exactly when joined (section 7.3's evidence). Its output key is
  `renders/<remotionRenderId>/out.mkv`; `outputKeyFrom`'s fallback follows
  the container. A request without a range behaves exactly as today. The
  `RenderRecord` stores the range for audit.
- `expectedDurationSec` on a part request is the part's duration, so the
  accept response's `estimatedCostUsd` is the part's share.
- New route `POST /presign` with body `{ key }`: a 24-hour presigned GET for a
  key in the render bucket. It refuses keys outside `renders/` with 400. The
  app needs it because the joined master is written by media-utils, not by
  Remotion, so no broker render record exists for it, and the app holds no
  AWS credentials (spec 11.3). Bearer-authenticated like every other route.
- New media route `POST /media/join`, dispatched like the others.
- The render cap is unchanged. The runner submits at most
  `settings.render.concurrency` parts at a time (default 2, equal to the
  cap's default); a 409 from a cap that is lower is retried by the step as
  today.

## 7. media-utils

### 7.1 Measure a part: the `qc` job, extended

`QcJobSchema` gains two optional fields:

- `offsetMs` (default 0): added to every issue's `atMs`, so a part's findings
  are placed on the film's clock, not the part's.
- `withLoudnorm` (default false): after the QC pass, a second ffmpeg pass on
  the same downloaded file with `-vn` and loudnorm's measurement filter
  (`loudnormMeasureArgs`), its JSON returned on the report as `loudnorm:
  LoudnormMeasurement`. The report's `integratedLufs` stays the ebur128
  figure from the QC pass.

`QcReportSchema` gains `loudnorm` (optional) and `durationMs` (optional, from
ffmpeg's reported duration, used by the combination below). The single-render
path sends neither field and reads an unchanged report.

Budget: the QC pass decodes video at several times real time (a 15-minute
part in about 3 minutes on the 3,008 MB Lambda) and the measurement pass is
audio only, under a minute. One 700 MB download fits `/tmp` beside the
whisper assets. The runner's 30-minute wait per part stands.

### 7.2 Combine the loudness of the parts

Pure, in `packages/schemas`: `combineLoudness(parts: { measurement,
durationMs }[]): LoudnormMeasurement`.

- `input_i`: the duration-weighted power mean of the parts' integrated
  loudness, `-0.691 + 10 log10( Σ d_k 10^((I_k + 0.691) / 10) / Σ d_k )`.
  Integrated loudness is a gated mean of power; this is exact for the
  absolute gate and ignores the relative gate's small movement between a
  part and the whole, which is a fraction of 1 LU for narrated film and well
  inside QC's 1.5 LU tolerance.
- `input_tp`: the maximum of the parts' true peaks.
- `input_lra`: the maximum of the parts' loudness ranges. Loudnorm's linear
  mode needs `measured_LRA` at or under the target LRA (11); when the maximum
  exceeds it, the filter falls back to its dynamic mode on its own, which
  still lands the integrated target and is the behaviour today's two-pass
  job has on such a file. Linear mode (one gain over the film) is the aim;
  the maximum of the parts is the honest input for that decision because a
  part's range is never wider than the film's.
- `input_thresh`: the combined `input_i` minus 10 (the relative gate's
  definition).
- `target_offset`: "0.00". Linear mode overwrites the offset with target
  minus measured, so the value is not used; it is present because the
  existing `loudnormApplyFilter` reads it.

Unit tests pin: equal parts combine to their common value; a silent part
weighted by duration lowers the mean by the expected amount; a single part
returns itself.

When the join's measured loudness lands outside QC's 1.5 LU tolerance, the
report carries a loudness warning and the master is ready, exactly as a
failed loudnorm is handled today (decision 188: a warning, never a dead end).
No correction pass. The owner sees the figure on the QC card and decides.

### 7.3 The `join` job

```
JoinJobSchema = {
  kind: 'join', jobId, projectId, callbackUrl,
  partS3Keys: string[] (min 2, in order),
  outputS3Key: string (render bucket, under renders/),
  targetLufs: number (default -14),
  measured: LoudnormMeasurement,      // combined, from 7.2
}
JoinResultSchema = { outputS3Key, integratedLufs: number | null, bytes: number,
                     elapsedMs: number }
```

The handler:

1. Presigns every part key (its own S3 client, 24 hours) and writes a concat
   list to `/tmp`: one `file '<url>'` line per part.
2. Runs ffmpeg with the command under "Evidence" below: the concat demuxer
   over the presigned URLs, `-c:v copy`, the loudnorm apply filter followed
   by `ebur128` (which passes the audio through and prints the delivered
   film's integrated loudness at the end of stderr), AAC at 192 kbps and 48
   kHz, a fragmented MP4 with ten-second fragments to stdout. Ten-second
   fragments keep the fragment count near a thousand for a 180-minute film,
   which browsers seek through comfortably.
3. Streams stdout into an S3 multipart upload at `outputS3Key`: parts of 64
   MB, `CreateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, all
   from `@aws-sdk/client-s3`, which the Lambda already bundles externally.
   Any failure aborts the multipart upload and fails the job. Nothing of the
   output touches `/tmp`.
4. Returns the output key, the integrated loudness parsed from ffmpeg's
   stderr (`parseIntegratedLufs`), and the byte count.

Pure and tested in `commands.ts`: `joinArgs`, the concat list text, and a
`multipartUpload(stream, put)` helper with the S3 calls injected. The media
stack's policy on the render bucket gains `s3:AbortMultipartUpload` and
`s3:ListMultipartUploadParts` beside the existing get, put and list.

Budget: a 180-minute join moves about 8 GB in and 8 GB out through one
3,008 MB Lambda. At 150 MB/s each way that is about 2 minutes; at a third of
that, 6 minutes. Audio encoding at 192 kbps runs far faster than real time.
The runner waits 20 minutes and retries a failed or timed-out join once with a
fresh job id (the output key is the same; a half-written multipart upload is
aborted by the failing invocation, and S3 keeps nothing visible until
completion). The join itself has no resume: a join that cannot finish inside
15 minutes fails twice the same way. The job's callback carries its elapsed
milliseconds, and the first live parts render (section 12) reads it; if a
join runs over half its budget, the follow-up is a staged join (groups of
parts joined first), which this design does not build.

Why a fragmented MP4 plays: a browser's MP4 demuxer (Chrome's libavformat,
Firefox's mp4parse, Safari's own) reads a fragmented file's `moof` headers
over range requests on open and plays and seeks it like any MP4; screen
recorders have shipped fragmented MP4 as their default output for years, and
YouTube ingests them. `x-upload-content-type: video/mp4` is the right type.
If the first live render's player balks, the fallback is a second join
variant that writes the master to `/tmp` with `+faststart` for films that
fit (under about 100 minutes at 6 Mbps) and keeps the fragmented stream for
the rest; this design does not build it.

### Evidence: the fixture joined on this machine (2026-11-10)

A throwaway script rendered the 20-second fixture (600 frames at 30 fps)
whole and as two frame-range parts with Remotion 4.0.512's `renderMedia`,
joined the parts with Remotion's bundled ffmpeg, and probed every file with
its ffprobe. Three findings shaped the design:

1. **MP4 parts do not abut.** A part rendered as `h264` in MP4 carries AAC
   audio 48 ms longer than its video (encoder padding: 10.048 s of audio for
   10.000 s of frames). The concat demuxer takes a segment's length from the
   file, so part two's video started 48 ms late, a two-frame hold at every
   join.
2. **MKV parts with PCM audio abut exactly.** Rendered as `h264-mkv` with
   `audioCodec: 'pcm-16'`, each part is 10.000 s of video and 10.000 s of
   audio. Joined with `-c:v copy` and the audio re-encoded, the output has
   600 of 600 frames, video duration 20.000 s, audio 20.022 s (AAC's own end
   padding, the same as the single render's 20.053). The join of the fixture
   took under a second; it is I/O bound.
3. **`delay_moov` is required.** Without it the fragmented output's video
   started at 67 ms (the B-frame delay with no edit list, because the header
   is written before the first packet is seen); with
   `empty_moov+default_base_moof+delay_moov` both streams start at 0.000.

Therefore a part is rendered as `h264-mkv` with `pcm-16` audio (section 6),
about a quarter larger than an MP4 part at 6 Mbps (1.5 Mbps of PCM), still
one download on a 10 GB disk, and the join's ffmpeg command is:

```
ffmpeg -hide_banner -nostats -protocol_whitelist file,https,tls,tcp
  -f concat -safe 0 -i /tmp/join-list.txt
  -c:v copy
  -af "<loudnormApplyFilter(target, measured)>,ebur128"
  -c:a aac -b:a 192k -ar 48000
  -movflags empty_moov+default_base_moof+delay_moov -frag_duration 10000000
  -f mp4 pipe:1
```

(`ebur128` was absent from Remotion's trimmed desktop ffmpeg and so left out
of the local proof; the Lambda layer's static ffmpeg has it, and today's QC
job uses it there.) A part file is not browser-playable, which the design
does not need: the joined master is what plays, uploads and is kept.

### 7.4 The upload: one session across invocations

`UploadYoutubeJobSchema` gains:

- `resume: { uploadUrl, offset }` (optional). Present, the handler skips the
  resumable-init request and continues the session at `offset` after asking
  the session where it stands (`PUT` with `Content-Range: bytes */total`,
  which answers 308 with the bytes received, or 200/201 if it is already
  complete).
- `budgetMs` (optional, default 12 minutes). The handler stops taking new
  chunks once the budget is spent and reports where it got to.

`UploadYoutubeResultSchema` becomes a union:

- `{ videoId, status }` as today, on completion;
- `{ status: 'in-progress', uploadUrl, offset, total }` when the budget ran
  out first.

The publish runner loops: `submit-upload-<round>`, `await-upload-<round>`.
An in-progress result mints a fresh token (`mint-token-<round>`, a token lasts
an hour and a round at most 15 minutes) and resubmits with `resume`. A
completed result continues to the existing record and thumbnail steps. Rounds
are capped at 30 (7.5 hours of invocations against the existing 7-hour
`UPLOAD_TIMEOUT`); a failed round goes through the existing error mapper and
retry path, which starts a new session on the next attempt. The first round
sends `x-upload-content-type: video/mp4`; a fragmented MP4 is an MP4.

Pure and tested: the chunk loop's budget cut-off (`putInChunks` gains
`deadline` and returns the in-progress shape), and the status query's
308-range parsing.

### 7.5 The transcription fallback, batched

`TranscribeJobSchema` gains `audioS3Keys: string[]` (optional, at most 8) as
an alternative to `audioS3Key`; the result gains `results: { audioS3Key, words
}[]` for a batched job. The handler downloads, converts and transcribes each
key in turn (the whisper binary and model are pulled once per cold start) and
returns the words per key. A batched job that fails on one key fails whole;
the runner's existing failure message names the batch.

The assembly runner groups the untimed paragraphs into batches of 8 when one
job a paragraph would not fit: `2 × untimed + ASSEMBLY_FIXED_STEPS + stock
steps + STEP_MARGIN > STEP_LIMIT`, where the stock steps are one a slot when
the stock ingest runs per slot and `ceil(stock / 8)` when it batches (the
mirror of `assemblyOtherSteps`, which already counts the transcription steps
for the stock decision). Batched jobs run under ids `transcribe-batch-<n>`
and `transcribe-batch-wait-<n>` that no older run used; a run that fits keeps
its per-paragraph ids. With stored timings present, nothing changes.

## 8. The runner

`render-runner`'s live path forks after `load-render` on the plan:

- `load-render` plans the parts (`planRenderParts`) when the duration exceeds
  `RENDER_SINGLE_MAX_SEC`, writes them to the new `renders.parts` column
  (section 9) with a fresh ULID per part, and returns them. The estimate is
  the whole film's, as today.
- `invoke-broker` keeps one reservation for the whole estimate. For a parts
  render, the step submits nothing; the loop below does.
- Waves: parts are taken in order, `settings.render.concurrency` at a time.
  For each part in a wave, `submit-part-<i>` posts to the broker with the
  part's frame range and duration, then records the part's broker ids and
  status `rendering` on the row. Then, for each part in the wave in order,
  `await-part-<i>` waits for `render/settled` where `renderId` is the part's
  ULID, with the same timeout as today (`timeoutMinutes` plus the 10-minute
  grace). `record-part-<i>` writes the outcome, output key and cost to the
  row and the overall `progressPct` as finished frames over total frames.
- A failed or timed-out part is submitted once more under a new ULID
  (`submit-part-<i>-retry`, `await-part-<i>-retry`). Before the resubmit,
  the retry step cancels the first attempt on the broker (the section 8.1
  tombstone), so a render that is merely late is discarded when its webhook
  lands and its `render/settled` is never emitted; the first ULID moves to
  the part's `priorRenderIds` for the ledger. A second failure fails the stage
  with the part named ("part 7 of 12 failed twice: <reason>").
- The ledger settles at the sum over every attempt of every part: a
  completed attempt at its reported cost, a failed or timed-out attempt at
  the part's estimate share (`estimate × part frames / total frames`), since
  Lambda ran or may have. A part that failed once and then completed counts
  both. This is today's "spend is sunk" rule applied per attempt.
- A 409 from the broker (its cap is below the wave) throws in the submit
  step; Inngest retries the step with backoff within the function's four
  retries, then the run fails and `onFailure` marks the row and stage. The
  defaults match (cap 2, concurrency 2); a mismatch is a configuration error
  the failure message names.
- Measure: `submit-qc-part-<i>` for every part (all at once; media-utils
  invocations run in parallel), each with `offsetMs` the part's `startMs` and
  `withLoudnorm` true; then `await-qc-part-<i>` in order, 30 minutes each. A
  part whose QC did not run fails the stage as today ("rendered but QC did not
  run").
- Combine and join: `submit-join` with the parts' output keys in order, the
  output key `renders/<masterRenderId>/master.mp4`, and
  `combineLoudness(parts)`. `await-join` waits 20 minutes; a failure or
  timeout retries once (`submit-join-retry`, `await-join-retry`), then fails
  the stage ("the parts rendered; the join failed: <reason>").
- The report: `mergeQcReports(parts, join)` (pure, schemas) concatenates the
  parts' issues (already on the film's clock) without their per-part
  loudness issues, sorts by `atMs`, and adds one loudness issue when the
  join's measured `integratedLufs` is null or outside the 1.5 LU tolerance,
  the same test `buildQcReport` applies. `integratedLufs` on the report is
  the join's figure. `passed` follows the issues.
- `master-ready` writes `outputS3Key` as the join's key, the report, status
  `done`, and leaves the stage as today. The ledger settles at the sum of the
  parts' reported costs.
- The single-render path is the existing code. The one shared change: its QC
  job sends no new fields and its report reads as before.

Step count at 180 minutes: 12 parts × (submit, await, record) plus 12 × (QC
submit, await) plus the join's four and the frame's eight, about 75. Well
under 1,000 alongside nothing else; this runner has no per-slot steps.

## 9. Data

- Migration: `renders.parts jsonb` (nullable; null means a single render).
  Drizzle numbering: master's last migration is 0053 on 2026-11-10, so this is
  0054; the plan compares journals again at merge (the collision memory).
- `RenderPartSchema` in `packages/schemas`:

```
{ index, renderId (ULID, the current attempt), frameRange: [int, int],
  startMs, durationMs,
  status: 'queued' | 'rendering' | 'completed' | 'failed',
  attempt: int (1 or 2), priorRenderIds: ULID[] (the tombstoned first attempt),
  remotionRenderId?, outputS3Key?, costUsd?, message?, qc?: QcReport }
```

- `packages/db` helper `updateRenderParts(db, renderId, parts)` and a
  `parts` reader on `RenderRow`. `renderInFlight` is unchanged (the master
  row's own status carries the in-flight state).
- The broker's `RenderRecord` gains `frameRange?`.

## 10. The render screen and the stop action

- `/api/renders/:id/progress`: when the row has `parts`, progress comes from
  the row's `progressPct` (written per finished part) plus, for every part
  with status `rendering`, the broker's `GET /renders/:partId` progress
  weighted by the part's frames, so the bar moves inside a part. A part the
  broker reports failed is written failed on the row's parts, and the row is
  failed as today only when the runner's retry is also gone (the runner owns
  the retry; the route only mirrors). For a `done` row with parts, `outputUrl`
  is the broker's `POST /presign` of the row's `outputS3Key`.
- `FileStage` on the preview screen plays the joined master from `outputUrl`
  exactly as today. Under the player, a parts master shows a row of buttons
  "Part 1 · 0:00", "Part 2 · 15:00", ... that seek the player to the part's
  `startMs`. No second player, no part files in the UI: the parts are MKV
  files with raw audio, not playable in a browser and not the deliverable.
  The master label and the QC card are unchanged.
- The progress text while rendering reads "Rendering master · part 3 of 12 ·
  41%" for a parts render.
- The stop action: for a row with parts, cancel every part with status
  `rendering` on the broker (each has its own ULID), then mark the row
  cancelled as today. The confirm's wording for a parts render reads "The
  parts in flight can't be aborted; they finish in the background and are
  discarded, about $<estimate / parts> each", computed on the client from the
  row's `costUsd` (the estimate) and `parts.length`, both of which the
  preview screen already receives on the render row.

## 11. The start limit

`RUNTIME_START_MAX` becomes `RUNTIME_OUTER_MAX` (180). The case actions and
the search brief panel keep reading the format's own `runtime.max`, so the
"not supported yet" note and the refusal never fire; both are removed with
their tests rather than left dead. The runtime default in `RuntimeSchema`
stays 15 and the schema's default maximum stays 30 (a bible's choice, not the
app's ceiling); the formats spec's "startable once long renders come in parts"
is now true.

## 12. Deploy and verification

Owner actions at deploy, in order. The stacks go first because the app calls
routes and fields that do not exist until they do; every stack change is
additive (optional fields, new routes), so the old app keeps working against
the new stacks, and a single render in flight across the deploy finishes on
whichever code its invocation started with.

1. `deploy:stacks boom-busters-media-utils` (the join, the batched
   transcribe, the resumable upload, the measure fields, the multipart
   policy), then `deploy:stacks boom-busters-broker` (frame ranges, the
   presign and join routes). The broker bundles `packages/schemas` at deploy.
   No Remotion function or site redeploy: the frame range is a client option.
2. Merge; the Vercel production build applies migration 0054
   (`deploy-migrate.mjs`).
3. `PUT /api/inngest` after the Vercel deploy.
4. YouTube Studio: "Intermediate features" verified for uploads over 15
   minutes (carried from decision 393's list).

Not verified by this project without spending: a live parts render. The first
real one should be the shortest film above 30 minutes the owner has, about
$2 to $3, approved separately. The pure parts are tested exhaustively; the
runner's live path is asserted to its first wait and its step ids are fixed by
test so a parked run replays exactly.

Tests, per package:

- schemas: the plan (counts, equal parts, the inclusive last frame, the
  30-minute boundary), `combineLoudness`, `mergeQcReports`, every schema
  change (an old payload parses unchanged).
- broker core: a request with a frame range sizes chunks from the window;
  `/presign` refuses keys outside `renders/`; `/media/join` dispatches.
- media-utils commands: `joinArgs`, the concat list, the multipart helper
  (part boundaries, abort on failure), `putInChunks` with a deadline, the
  session status parse, the transcribe batch result shape, QC with an offset
  and the loudnorm measurement.
- infra stacks: the multipart actions in the media policy.
- db: the parts column round-trips through `updateRenderParts`.
- web: the runner's parts path to its first wait (parts on the row, one
  reservation, the first wave's submits with frame ranges and the right
  ULIDs); the progress route's weighting and presign; the stop action's
  per-part cancel; the publish runner's resume round; the assembly runner's
  batch ids; the start control without the note.
- e2e: the existing preview render spec unchanged (single fixture render).

## 13. Calls made by the author

1. Parts above 30 minutes only, equal lengths from the part count, 15-minute
   target. Films at or under 30 minutes keep the single render.
1a. Parts are rendered as MKV with PCM audio so they join exactly; the local
   proof in 7.3 showed MP4 parts cannot.
2. Loudness measured per part and applied as one film-wide gain in the join,
   with the combination formula in 7.2, instead of normalising each part.
3. The join streams through ffmpeg into a multipart upload of a fragmented
   MP4 with ten-second fragments, rather than writing to `/tmp`, because
   `+faststart` needs a second copy and a 180-minute film does not fit twice
   on a 10 GB disk.
4. The join re-encodes audio to AAC 192 kbps at 48 kHz, the same settings the
   loudnorm video pass uses today.
5. A failed part and a failed join are each retried once inside the run; a
   second failure fails the stage and the spend is sunk, like today.
6. Waves of `settings.render.concurrency` parts, awaited in order.
7. QC per part carries the film offset in the job rather than the runner
   shifting issues afterwards, so the report on the row reads correctly
   whichever side merges it.
8. A new `POST /presign` on the broker for the joined master's playable URL,
   rather than registering the join's output as a broker render record.
9. The preview screen plays only the joined master, with part buttons that
   seek it.
10. The upload's budget per round is 12 minutes of a 15-minute invocation;
    rounds are capped at 30.
11. Transcription batches of 8, under the same step-fit rule as slots and
    stock.
12. `RUNTIME_START_MAX` becomes 180; the note and the refusal are removed.
13. No change to the render cost estimate or the Stop confirm's formula beyond
    the per-part wording.

## 14. Open for the owner

- Whether the first live parts render is run at the owner's request on a real
  project (about $2 to $3 for the shortest film over 30 minutes) or waits for
  the first production need.
- Whether a later project should keep finished parts across runs, so a master
  that fails at part 11 of 12 resumes rather than re-rendering 10 parts (about
  $9 at 180 minutes). This design leaves the parts on the row, so that project
  would read them.
