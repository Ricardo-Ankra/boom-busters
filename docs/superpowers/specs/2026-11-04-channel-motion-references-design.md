# Channel motion references and derived exemplars

Date: 2026-11-04. Status: draft for the owner's review. Section 12 holds the
questions still open for the owner; section 13 lists the calls made by the
author that the owner should check while reading.

## 1. Why

The designer writes every graphic from one exemplar of the slot's technique
(decision 305) and that exemplar is the only design it sees (decision 386), so
the exemplar sets the look more than the prompt does. The eighteen exemplars
were translated from MIT Remotion templates and rewritten by hand to a motion
standard that lives in prose (decisions 387 and 388). They were never written
to a piece of footage the owner chose. The owner's words (2026-11-04): "our
exemplars were not built on high quality motion graphics. We have not supplied
frames of a video, applied a motion graphics skill and cannot simply prompt the
changes."

The owner's rulings in the brainstorm, 2026-11-04:

- References design the exemplars; they do not replace them. A reference is a
  video or a still; an exemplar is checked code. Two levels: references feed a
  derivation of the exemplars, and a text form of the channel's motion identity
  feeds every shot.
- References, the motion identity and the derived exemplars are **per
  channel**, held with the channel's branding. The technique catalogue, the
  house exemplars, the tokens' defaults, the checks and the guideline are
  global. Nothing of one channel's taste leaks into another's.
- The plumbing is agnostic to the channel's niche. A sleep-story channel, a
  finance-history channel and a kids channel come through the same door.
  Everything that is one channel's taste leaves the designer's prompt and
  moves into that channel's identity; the house prompt keeps only what is true
  for every channel (the sandbox, the checks, the facts rule, the safe area).
- References are **pictures and files** the owner uploads. A link is kept for
  provenance only; the app never downloads from Instagram, YouTube or
  Pinterest.
- Day one of a new channel: six to eight saved reels and clips, a board of
  stills, a rough sense of fonts and colours, no designer's brief. The owner
  drops them in, marks the two or three seconds on each that matter and says
  why, and the tool builds the channel's motion look. No code, no scripts.
- On the board, the owner steers an exemplar in plain words, sees the new
  version beside the old one, approves once, and a later tweak cannot undo
  what was approved.
- Boom & Busters gets its own pack from the owner's own picks, not from the
  four reels in the Kaye Creatives bundle under `docs/references/`. That bundle
  is the method's worked example, not this channel's look.
- A proper guideline on what material to supply, in what format and how much,
  is a deliverable (section 6).

Research behind the design (2026-11-04; sources listed in the memory note
`motion-reference-research-sources`): HeyGen's Code2Video benchmark (five
scoring axes, pairwise judging, order swapped against position bias, "text is
laid out for the final frame, not for the path it travels"); the Gauntlet
critic loop in echris6/motion-video-kit (builder is not judge, a fresh critic
per round, a verification round that marks each prior defect fixed or still
present, measured frozen time and contrast); ArtimindStudio's style-motion
skill (three or four clean frames per reference into a style file with a
negative list); LottieFiles' motion-design skill (a motion personality is one
signature easing, three durations and one entrance pattern); the iart-ai
brand-motion guideline ("vibes guidelines fail because they have no tokens");
and Lukas Margerie's reference prompt ("take the grammar of the reference,
never its content, logos or characters").

## 2. What the code does today

- **Exemplars are global and in the code.** `DESIGNS` is a generated module
  (`packages/providers/src/exemplars/designs/index.ts:32`); `exemplarFor`
  takes a technique only (`exemplars/index.ts:30`), and `designInput` calls
  `exemplarFor(techniqueFor(...))` with no channel
  (`apps/web/lib/graphic-design-core.ts:222`). The translation script
  (`apps/web/scripts/translate-exemplars.ts`) writes `designs/*.ts` under an
  in-memory `LiveBudget` cap with no ledger row.
- **The designer's prompt carries one channel's taste.** The craft section
  (`packages/providers/src/prompts/graphics.ts`, lines 207 to 260) says no
  glows, charts conventional, a change about every 1.5 s, the hero spring once
  per beat, blur that follows speed, 3D only when it carries meaning, and a
  ban list. The still limit is one global constant, `GRAPHIC_STILL_MAX_MS`
  = 6000 (`packages/schemas/src/graphic-timing.ts:32`). The bible reaches the
  prompt only as the premise example and the subject noun.
- **Motion tokens are global.** `MOTION_MS`, `MOTION_SPRING`, `MOTION_PX`,
  `MOTION_SCALE`, `MOTION_STAGGER_MS` in
  `packages/compositions/src/lib/motion-tokens.ts`; every stored design carries
  the preamble it was checked with (`code.motion`, `MOTION_VERSION` = 1).
- **Brand is per channel already.** `channels.settings` jsonb holds the brand
  kit (`BrandKitStoredSchema`, `packages/schemas/src/settings.ts:446`) and the
  feature flags; graphics read it live through `resolveBrandKit`. The bible is
  frozen per project (`projects.bibleId`); settings are not.
- **The review is the designer judging itself.** `reviewGraphicWith`
  (`graphic-design-core.ts:404`) sends the designer's own prompt its rendered
  frames and asks keep or revise. The layout check samples rest moments only
  (`frames.ts:121 restMoments`).
- **Uploads.** Logos go browser to R2 on a presigned PUT, then a finalise
  action HEADs the object and inserts an `assets` row (`logo-actions.ts:82`
  and `:119`); own-footage uploads do the same for video up to 200 MB
  (`visuals-actions.ts:1690`). `assets.kind` is image, video, music or logo.
- **Chromium runs in the app** (decision 389): playwright-core locally,
  @sparticuz/chromium on Vercel, one page per inspection, every stage bounded.
- **Paid work is capped twice.** The workspace monthly ceiling through
  `withCost` and `reserve` (`packages/cost/src/guard.ts`), with Inngest
  functions catching `BudgetExceededError` and opening a budget gate
  (`apps/web/inngest/lib/gates.ts:145`); and scripts' in-memory `LiveBudget`.

## 3. Goals, non-goals, anti-goals

**Goals**

1. A channel's motion look is built from references the owner uploads and
   marks, with no code and no scripts, and is shown on the channel's settings.
2. Each channel has its own exemplar for each technique it uses, derived from
   its references through a critic loop, versioned, approved once, and
   refined by a plain-words steer without losing what was approved.
3. The designer's prompt is channel-agnostic: every taste value comes from the
   channel's motion identity, with the house values as the defaults.
4. The per-shot review becomes a critic that sees the channel's references,
   samples frames through transitions, and measures motion rather than
   judging it from stills.
5. A written guideline on reference material, format and quantity, in the
   repo and on the settings page.
6. A new channel can start from another channel's pack by copying it.

**Non-goals**

- Downloading reference media from a URL. Links are provenance only.
- Editing footage: presenter splits, captions, masks, grain on footage. Our
  graphics are standalone slots under narration.
- Sound design for graphics. Noted for later.
- Chapter-level continuity across slots (one title position, one wipe
  direction, a persistent actor). Noted for later; it needs the shot planner.
- Training or fine-tuning a model. The preference ledger records taste; using
  it is a later decision.

**Anti-goals** (a failure even if it works)

- A shared pool of references or exemplars that drifts every channel toward
  one look.
- A refine that overwrites an approved exemplar.
- A reference's pixels, logos or words in a film. References are study
  material; the manifest records that no reuse licence is inferred.
- A channel name, niche word or taste number in code.
- A per-shot cost that grows with the size of the reference pack. Images go
  to the derivation job and the review, never to the designer's per-shot call.

## 4. Constraints

- Vercel: 300 s per function invocation, the design deadline of 240 s, and
  the frames inspection bound of 45 s (`INSPECT_MAX_MS`) stand.
- @sparticuz/chromium is an open-source Chromium build and is not assumed to
  decode H.264. Frames are therefore extracted in the owner's browser at upload
  time (section 7.2), never on the server.
- Paid calls run only on the owner's word: a reference is read when the owner
  presses "Save and read", a derivation starts from a button with a cap the
  owner types. In mock mode every model call returns a fixture (a fixture
  reading, a fixture critic report, the house exemplar as the derived draft,
  marked `mock`), so the whole flow, approve, refine, versions and copy
  included, runs end to end without spend.
- The spec's rules stand: a branch per change, PROGRESS.md decisions, tests
  with the code, Prettier and lint at zero warnings, no secrets, button-first
  UI, dark theme.
- `code.motion` keeps recording the preamble a design was checked with, so a
  channel's token changes never silently change a stored design.
- Production rows are read only with permission and in a read-only transaction.

## 5. The shape of the thing

Seven concepts, all per channel unless marked global.

1. **Reference.** One uploaded still or clip, with the window the owner marked,
   the frames taken from it, a purpose tag (mechanism, look or pacing), one
   carry-over line, one avoid line, a title, the source link and a rights
   note. A reference can be a negative ("not this").
2. **Reference pack.** The channel's references, ordered, at most twelve.
3. **Reading.** The model's one-page reading of a reference's frames, written
   once at ingest and editable by the owner: medium, palette, type, how text
   enters and exits, what moves and how fast, what is absent. Text only.
4. **Motion identity.** The channel's three constants (signature easing,
   three durations, one entrance pattern), a camera rule, the change cadence
   and still limit, overshoot allowance, a short style guide, a never list and
   an allow list, and the techniques in use. Stored in the channel's settings
   beside the brand kit. The house values are the defaults.
5. **Technique catalogue** (global). The eighteen techniques with their house
   exemplars, mechanics and synthetic slots. A channel picks the ones it uses.
   A derivation can propose a new technique from a reference (section 8.5).
6. **Channel exemplar.** A versioned design of one technique for one channel:
   the code with its concept and storyboard, the mechanisms it names, the
   critic's last report, the measured metrics, the steer that made it, its
   parent version, and a status (draft, approved, retired).
7. **Preference ledger.** Every verdict the owner gives on the board or in
   settings (approve, keep, prefer A over B, revise, steer text), with what it
   was given on.

## 6. The reference guideline (deliverable)

Lives at `docs/motion-references.md` and, shortened, as the help text on the
Motion tab. The builder copies this section; the wording may be tightened.

**What to supply.** Four to eight references per channel; twelve at most.
Each teaches one thing, and is tagged with it:

- *mechanism*: one move (a word that splits open to show a figure, a numeral
  that stays while the background changes, bars rising as years are spoken).
- *look*: palette, type, texture, the weight and spacing of letters. Stills
  are good for look and useless for motion.
- *pacing*: how long things hold, how fast they leave, how much is on screen.

Have at least one of each. Up to two references may be negatives: a clip that
shows what the channel must not do, with the avoid line saying what.

**What makes a good reference.** One idea per clip. Typography, shapes and
charts, because that is what the catalogue can draw: our graphics have no
footage, so a reference built on footage (masks, grain on a face, a presenter
split) teaches nothing the designer can use. A clean background. A move the
owner can describe in one sentence. Quality the channel would be proud of: the
derivation copies the standard as much as the move.

**Format.** Stills: PNG, JPEG or WebP, up to 8 MB. Clips: MP4, WebM or MOV,
up to 100 MB and 90 s. 1080p or better. The marked window is one to four
seconds; the model is shown the window, never the whole clip, so the window
is the reference. No app chrome, captions, watermarks or logos in the window:
crop them out in the marker or choose another window. Silent is fine; sound
is not a reference here.

**What to write for each.** A title. The source link and whose work it is.
A rights note (reference only, unless the owner holds a licence). One
carry-over line of the form "borrow X, not Y" ("borrow the one numeral held
over a changing background, not this numeral or story"). One avoid line, if
anything in the window must not be copied ("not the glow").

**How much is enough.** A window per reference and a sentence each. More than
eight dilutes: the derivation weighs every reference, and twelve mixed
references read as no style. Fewer than four leaves the model guessing on one
of mechanism, look or pacing.

**What the tool does with them.** It reads each window into a one-page
reading the owner can correct, builds the channel's motion identity from the
readings and the owner's words, derives an exemplar per technique the channel
uses, and shows those on the board for approval and steering. The references'
pixels never enter a film.

## 7. Ingest

### 7.1 Data

New table `motion_references`: id (ulid), channelId, kind (image or video),
assetId (the uploaded file's `assets` row, kind image or video; a new
`assets.kind` value `reference` is not needed), title, sourceUrl, rights,
purpose (mechanism, look, pacing), negative (boolean), windowStartMs,
windowEndMs (null for a still), carryOver (text, 300), avoid (text, 300),
reading (jsonb: medium, palette[], type, enters, exits, motion, absent, notes;
plus readAt and model), frames (jsonb: [{atMs, r2Key, width, height}]),
contactSheetKey, denseSheetKey, position (integer), createdAt, archivedAt.
Unique on channelId and position among live rows. `assets.channelId` is set
for reference uploads as it is for logos, with the same dedupe index.

### 7.2 Upload and marking, in the browser

The Motion tab's "Add reference" button opens the picker (accept: the formats
in section 6). The client validates size and type, then:

- A still: converted the way logos are (`client-image.ts`), uploaded on a
  presigned PUT, finalised. Its one frame is the still itself.
- A clip: the owner's browser plays it in a `<video>` with a scrubber and two
  handles for the window (1 to 4 s, enforced). While the owner marks, the
  page draws the video to a canvas at the window's times and produces JPEGs:
  the dense set, every 1/12 s across the window (at most 48 frames, 640 px
  wide), and the overview, every 0.5 s across the whole clip (at most 180
  frames, 320 px wide). The original clip is uploaded on a presigned PUT; the
  frames are uploaded as one zip-free batch of presigned PUTs (one key per
  frame) and listed in the finalise call. The owner's browser decodes the
  video; the server never does.
- Finalise: the form's last button is "Save and read", with the reading's
  estimated cost beside it (one vision call). The server HEADs the clip and
  each frame key, inserts the `assets` row and the `motion_references` row,
  then sends `motion/reference.ingested` {channelId, referenceId}. "Save
  without reading" stores the reference unread; a later "Read" button on the
  card sends the same event. Re-marking shows "Save and re-read".

### 7.3 Reading and sheets, in Inngest

`motionReferenceReader`, singleton per referenceId:

1. `sheets`: in the app's Chromium, render a grid page of the dense frames and
   screenshot it (the dense sheet, 6 columns, timecodes under each tile), and
   the same for the overview (the contact sheet). Store both in R2 under the
   reference. This is the same renderer and bounds as the layout check.
2. `read`: one vision call (the graphics route's model; cost estimated and
   ledgered like any task) with the dense sheet, three or four single frames
   spread across the window at full size, the carry-over and avoid lines, and
   the purpose tag. It answers a reading (section 5.3) in JSON; the parse
   trims lengths. Stored on the row. Budget errors open the usual budget gate.
3. The tab shows the sheet and the reading; the owner edits the reading in
   place ("Edit reading" button) and the edit is kept with `editedAt`.

A reference re-marked (new window) is re-read. Archiving a reference keeps
its rows and files; a derivation ignores archived references.

## 8. The motion identity and the catalogue

### 8.1 Identity schema

`SettingsSchema` gains `motion` (`MotionIdentitySchema`) beside `brandKit`,
not inside it: `BrandKitTokensSchema` is snapshotted into every timeline and
bundled into the broker, and the render needs none of this (the compiled code
carries its preamble). A separate `resolveMotionIdentity(settings)` resolves
it. Every field has the house default so an old settings row reads unchanged.
The first three fields change the numbers a design is checked with; the rest
are words in the prompt:

- `signatureEase`: a named curve set for `motion.ease.enter` and
  `motion.ease.move`: `soft` (the house: poly-4 out, cubic in-out), `crisp`
  (expo out, quart in-out), `gentle` (sine out, sine in-out). `exit`,
  `emphasis` and `linear` stay as they are. Default `soft`.
- `ms`: overrides for `enter`, `exit`, `reveal`, `draw`, `count`, `move`,
  `gap` (each optional, 40 to 3000; defaults from `MOTION_MS`).
- `overshoot`: `none` (hero and snap become critically damped, as settle),
  `hair` (the house springs), `welcome` (hero damping 10, snap damping 14).
  Default `hair`. There is no separate spring field: the springs follow this.
- `entrance`: `rise` (the house: `motion.px.rise` 20), `fade` (rise 0),
  `scale` (rise 0, `motion.scale.enter` 0.9), `wipe` and `slide` (rise 0, and
  a prompt line saying how things arrive). Default `rise`.
- `changeEveryMs` (500 to 10000, default 1500) and `stillMaxMs` (1000 to
  20000, default 6000). The still limit becomes the channel's; the check reads
  it from the props the design is checked with.
- `cameraRule`: one line (200), default "a slow push over the whole slot,
  2 to 4% on motion.ease.move, anchored so nothing leaves the safe area".
- `blurFollowsSpeed` (default true), `threeD` (`never`, `whenMeaningful`,
  `welcome`; default `whenMeaningful`).
- `never`: list of up to 16 short phrases (default: the current ban list);
  `allow`: up to 16 (default empty). A phrase in `allow` is removed from the
  prompt's never list; the lists cannot both hold one phrase.
- `styleGuideMd`: up to 4000 characters of plain prose for the designer and
  the critic (default empty; the derivation writes a first draft, section
  8.4).
- `techniques`: the techniques in use (default: all eighteen).
- `chartsConventional` (default true: bars rise from the baseline, lines draw
  on, no gridlines or ticks, no travelling bars). A channel that wants
  otherwise turns it off and says so in the style guide.

The tokens preamble is built from the resolved identity
(`motionTokens(easing, identity)`), so a channel's curve set, lengths, springs
and entrance numbers are the `motion.*` values its designs are checked with;
`MOTION_VERSION` becomes 2 and the preamble records the channel values.
`MOTION_EASE_NAMES`, `MOTION_SPRING_NAMES` and the scan do not change, so every
stored design still passes.

Model routes: one new task, `critic`, in `LLM_TASKS`, with its own row on the
Models tab and its own ledger operation, defaulting to the cheaper model of
the two the workspace routes (the Models tab's default for review-shaped
tasks). Round critics and the per-shot review use it. The reading, the
storyboard call, every build and fix, and the one verify call that ends a
technique use the `graphics` route. The critic has a route of its own so the
judge can be changed without a code change.

### 8.2 The designer's prompt

`systemTemplate` takes the resolved identity. The craft section's taste lines
become slots filled from it: the cadence line from `changeEveryMs`, the camera
line from `cameraRule`, the blur and 3D lines from their fields, the never
list from `never` minus `allow`, the chart line from `chartsConventional`,
and a "This channel's motion" block holding `styleGuideMd` and the three
constants in words. The still rule names the channel's `stillMaxMs`. What
remains hard-coded is channel-agnostic: the sandbox, the API, the facts rule,
both frames, the safe area, the motion grammar of the tokens (every
interpolate names a curve, lengths from `motion.ms`, the hero once per beat).
The exemplar block is unchanged in wording and shows the channel's approved
exemplar when one exists, else the house one.

### 8.3 Per-channel exemplar selection

`exemplarFor(technique, channel)` reads `channel_exemplars` for the approved
version of that technique; else the house design. `designInput` gets the
channel from `channelForProject`. `techniqueFor` takes the channel's
`techniques` and its rule "first match wins" becomes "first match in use
wins": the steer is tried first as now, then each rule in order, skipping a
technique the channel has switched off. The two last-resort techniques,
`kinetic-word-stack` for a graphic and `bar-chart` for a chart, cannot be
switched off, so every slot still gets an exemplar. The exemplar shown to the designer carries
`title`, `source`, `description` and, new, `mechanisms` (section 8.5), so the
block can say "it uses: one persistent actor, cause to effect".

### 8.4 Writing the identity's first draft

"Draft motion identity" on the Motion tab (paid, one call) takes the readings
of the live references, the owner's free-text brief (a textarea: "slow, dark,
one change every six seconds"), the brand kit's colours and fonts, and the
house defaults, and proposes the identity: the three constants, the cadence
and still limit, the camera rule, the never and allow lists, and a style guide
of at most 4000 characters. It is shown as a diff against the current
identity with "Apply" and "Discard". A channel with no references can still
draft from the brief alone.

### 8.5 Mechanisms and new techniques

A global list `MECHANISMS` (in `packages/providers/src/exemplars/`), each a key
and a one-line definition, seeded from the 28-film grammar and the current
exemplars: `persistent-actor`, `foreground-becomes-transition`,
`cause-to-effect`, `density-from-hierarchy`, `change-of-speed`, `hard-cut`,
`word-splits-open`, `docking`, `drum`, `reel`, `draw-on`, `rise-from-baseline`,
`tally`, `door`, `marker-stroke`, `camera-push`. A design's `mechanisms` is
filled by the designer in its answer (optional, capped at 6, validated against
the list) and checked by the critic.

A reference tagged *mechanism* whose carry-over names a move no technique
covers may lead the derivation to propose a technique: a name, a one-line
description, a synthetic slot and the rules by which `techniqueFor` would
reach it (steer phrase only, as the five steer-only techniques are). The
proposal is stored as a channel exemplar with `technique` set to the new key
and shown for approval like any other; approved, the key is added to the
channel's `techniques` and `techniqueFor` accepts it by steer phrase. The
global catalogue does not change; a channel-only technique never becomes a
house one without a code change.

## 9. Derivation: the critic loop

### 9.1 Launch

"Derive exemplars" on the Motion tab: a dialogue with the techniques to derive
(default: those in use with no approved version), the rounds per technique
(1 to 5, default 2) and a cap in dollars the owner types (no default; above
$20 the field says so in red and still allows it). Mock mode refuses with a
notice. It sends `motion/exemplars.derive` {channelId, techniques, rounds,
capUsd}. A derivation runs one at a time per channel (singleton, skip).

The estimate shown before launch: per technique, one storyboard call, one
build, then per round one critic and one fix, plus one verify at the end; with
images in the critic calls. The builder measures real prices on the first run
and the dialogue shows cost per technique from the ledger's last derivation.

### 9.2 The job, per technique

`motionExemplarDeriver`, with the budget gate pattern of `slot-rebriefer`, a
step per call so a parked run resumes, and a per-job cap enforced by summing
this job's ledger rows before every call (over the cap: the technique is left
as a draft with the reason, the job moves on, the tab shows "stopped at cap").
Inputs to every call: the resolved identity, the style guide, the channel's
brand, the catalogue entry (its synthetic slot rewritten into the channel's
register by the storyboard call, so a sleep channel's stat counter counts
something the channel would count), the house exemplar for mechanics, and the
reference pack's readings. Images go only to the critic.

1. `storyboard`: a text call that writes the concept, the storyboard on the
   slot's clock, the mechanisms it will use, and which references it leans on
   and why. Checked for length; stored as the version's plan.
2. `build`: the designer's call and ladder with the plan as the brief, the
   checks as today (compile, scan, dry run, facts, layout). A refused build
   retries once with the refusal, then the technique is left as a draft with
   the refusal shown.
3. `frames`: the browser renders the design: the rest moments as today, plus
   dense shots, four per storyboard moment at 1/24 s steps around it, both
   orientations; a contact sheet page of them; and the motion metrics
   (section 10). Stored on the version.
4. `critic`: a fresh prompt (never the designer's), given the plan, the
   contact sheet, the reference pack's dense sheets for the references the
   plan named (at most three, else the first three by position), the
   metrics, the identity, and, from round two, the previous version's sheet.
   It answers JSON: a score 1 to 10 on each of five axes (engagement,
   intent, composition, temporal, craft) with one line each; the defects,
   ranked, each with a time and an orientation; the three fixes worth making;
   whether each named mechanism is actually present; and, when a previous
   version is given, which of the two it prefers on each axis. The pairwise
   question is asked twice with the sheets swapped, and a preference that
   flips is recorded as a tie.
5. `fix`: the designer's call with the current design, the critic's three
   fixes as the producer's steer, and the plan; the checks again; new frames.
6. Repeat 4 and 5 for the rounds asked, stopping early when the critic scores
   every axis at or above the bar (default 8) and no metric is critical.
7. `verify`: the critic again with the previous report, marking each prior
   defect fixed, partly or still present, and a verdict: ready or one more
   pass. The version is stored as `draft` with the final report and metrics,
   and the tab says "ready for your review" or "the critic wants one more
   pass" with the report behind a button.

Nothing is approved by the job. The owner approves on the tab.

### 9.3 Refine by steer

On a technique's card, "Refine" takes a steer (plain words, 500 characters)
and runs one build from the approved version (or the latest draft when none is
approved) with the steer, the plan and the instruction that what the steer
does not name is kept; then frames, one critic round told to verify against
the parent version with the steer as the brief, and the result stored as a new
draft version with `parentVersion` and `steer`. The card shows the two side by
side (the player for each, both orientations, the concept lines, the critic's
one-line verdict per axis) with "Approve this", "Keep the approved one" and
"Refine again". Approving sets the new version approved and retires the
parent; the parent stays listed under "Versions" and can be restored.

An approved version is never edited in place. A steer never runs the full
loop; the owner can run "Derive" on that technique again for that.

### 9.4 Copy from another channel

"Copy motion from another channel" copies the identity, the references (the
`assets` rows are shared, the `motion_references` rows duplicated with their
readings) and the approved exemplars as approved versions with
`copiedFrom`. It is a fork: later edits to either channel never touch the
other. The existing `copyBibleFromChannelAction` is the pattern.

## 10. Measured motion and the per-shot review

### 10.1 Metrics, in the browser module

`frames.ts` gains `motionMetrics(shots)`: the shots of one orientation,
decoded in Node with a pure-JS JPEG decoder, downscaled to 160 px wide
greyscale, and compared neighbour to neighbour:

- `frozenMs`: total time whose frame difference is under a threshold, and the
  longest such run. Critical above the channel's `stillMaxMs` (the dry run's
  rule already refuses that; this is the measured twin, so the two agree).
- `simultaneity`: the share of total change that lands inside the single
  busiest 250 ms. High means everything triggers at once.
- `speedProfile`: the change per shot, so the critic can see where the beats
  are without being asked to infer motion from stills.
- `holdAfterLast`: time from the last change to the end (the ending holds).

The metrics are stored with the version and shown to the critic as numbers.

### 10.2 Layout through transitions

`layoutIssueIn` runs on the dense shots as well as the rest moments, with the
same rules (overlap of the ink bands, past the safe area, font under 26 px).
A moving element is judged by its ink band at that instant; blur and opacity
under 0.5 are excluded as now. The designer's ladder keeps refusing on the
rest moments only, as today. An issue found only mid-transition does not
refuse; it goes to the critic as a finding ("at 1.35 s, while 'asked.'
moves"), so a design that passes today still passes, and the critic decides.

### 10.3 Settled text contrast

For each rest moment, the page measures each visible text run's colour and
the colour under its box's centre (the painted background of the ancestor,
or the brand background behind the graphic) and reports the WCAG ratio. A
ratio under 3 for type of 24 px or more, or under 4.5 for smaller type, is a
finding for the critic, not a refusal.

### 10.4 The review step

`reviewGraphicWith` becomes a critic: a prompt of its own (shared with the
derivation's critic, with the slot's brief as the plan), given the rendered
contact sheet, the metrics, the identity and the dense sheets of at most two
references (the ones the channel's exemplar for this technique named, else
the first two *look* references). It answers keep, or the three fixes; a fix
is applied by one designer call and checked. The critic replaces the
designer's self-review outright: the old path is removed, not kept beside it.
The Settings switch "Review each graphic on its rendered frames" keeps its
name and now means this, and it stays on by default. A keep costs one call as
today; a revise costs two where today it costs one (the designer's revised
design came back in the review's own answer). Per-shot cost also rises by the
reference sheets (two images). The board's review line gains the five axis
scores behind "Show review". The review step keeps its own 240 s deadline;
with dense shots the inspection stays inside `INSPECT_MAX_MS` by capping the
dense set at 24 shots per orientation.

## 11. The Motion tab and the board

A new channel settings tab, Motion, between Brand kit and Exemplars:

1. **Identity**: the three constants, cadence and still limit, camera rule,
   overshoot and 3D, never and allow lists, the style guide, techniques in
   use; "Draft motion identity" (paid, with a notice), "Apply", "Discard".
2. **References**: the ordered pack as cards (title, purpose, the marked
   window's first frame, the carry-over line); "Add reference", "Edit",
   "Re-mark", "Archive"; each card opens the contact sheet, the dense sheet
   and the reading with "Edit reading". The guideline's short form sits above
   the list with "Read the full guideline".
3. **Derive**: the launch dialogue (section 9.1), progress per technique, and
   the last run's cost.
4. The existing Exemplars tab becomes per channel: each technique card shows
   the approved version (or "house exemplar" when none), the player, the
   concept, the critic's last scores, "Refine", "Derive this one", "Versions".
   The side-by-side after a refine lives here.

On the project board nothing changes in layout. The review line shows the
critic's verdict; "Redesign" works as today and the designer gets the
channel's exemplar.

Every verdict writes a `motion_verdicts` row: channelId, kind (approve,
keep-approved, prefer, revise, steer, redesign), exemplar version or slot id,
the comparison (A and B ids when pairwise), the steer text, createdAt. The tab
and the board do not read it yet.

## 12. Open for the owner

Asked and answered 2026-11-04 after the builder check.

1. **The critic replaces today's self-review outright** (owner: "Replace it
   outright then"). Same switch, on by default, the old path removed. It
   lands last in the build order so Boom & Busters sees the change once.
2. **Cost, the owner's ruling: the best and most efficient way.** The
   package: the `critic` route defaults to a cheaper model, and the strong
   (graphics) model is used for every build and fix and for the one verify
   call that ends a technique; rounds default to 2 with the early stop
   (section 9.2); Derive defaults to the techniques in use with no approved
   version, after the identity draft has pruned the list; the critic gets at
   most two reference sheets per call, every sheet downscaled to 1600 px
   wide, and the rendered contact sheet is capped at 24 tiles per
   orientation; the system prompt, identity and style guide are the prompt's
   fixed head and are cached across a derivation, with images and per-round
   material last; the job writes cost per technique to the ledger and the
   Derive dialogue shows the last run's figures; on the first channel, one
   technique is derived twice, once with each critic, for the owner to
   compare before the rest of the pack runs. Expected: $20 to $40 for a full
   pack, measured on the first run.
   Rounds in words: one round gives a correct exemplar, two a tuned one, three
   a polished one; the owner's Refine on the board is a round with a better
   judge.
3. **Techniques per channel** are the identity's `techniques` list, shown on
   the Motion tab as the catalogue with a tick per technique, a thumbnail of
   the house exemplar and its one-line description; all ticked by default;
   `kinetic-word-stack` and `bar-chart` cannot be unticked; "Draft motion
   identity" proposes the list and says why; a steer naming a technique still
   wins and gets the house exemplar when the channel has no version.

## 13. Calls the author made

- Frames are extracted in the owner's browser, not on the server, because
  the app's Chromium build is not assumed to decode H.264 and a video scrubber
  is the marking UI anyway.
- The identity lives in `channels.settings.motion`, beside the brand kit, not
  in the bible and not in the brand tokens. The bible is frozen per project
  and settings are read live, so a motion change applies to the next design
  as a colour change does; the brand tokens are snapshotted into timelines
  and bundled into the broker, which the render does not need for this.
- After the builder check: a reference is read on "Save and read" (the
  owner's word), never silently; mock mode returns fixtures for every call so
  the end-to-end suite reaches the whole flow; mid-transition overlaps and
  contrast are the critic's findings, not refusals, so nothing that passes
  today fails; a switched-off technique is skipped by `techniqueFor` with two
  last-resort techniques that cannot be switched off; `signatureEase`,
  `overshoot` and `entrance` change the token numbers and there is no
  separate spring field; the critic has its own model route.
- `stillMaxMs` and `changeEveryMs` are identity fields with the house values
  as defaults, so the one global constant becomes a per-channel value and the
  checks read it from the props.
- The critic's five axes are HeyGen's, scored 1 to 10 with a bar of 8; the
  pairwise question is asked twice with the order swapped.
- Rounds default to 2 and are capped at 5. The owner types the cap every time.
- References are capped at twelve; windows at one to four seconds; the dense
  rate is 1/12 s and the overview rate 0.5 s.
- The tokens preamble becomes per channel (`MOTION_VERSION` 2); the scan's
  grammar does not change, so every stored design still passes.
- A channel-only technique is reached by steer phrase only, like the five
  steer-only house techniques.
- Mechanisms are a fixed global list a design names; the critic checks
  presence, nothing else enforces it.

## 14. Left to the builder

- The exact JPEG decoder, downscale and difference threshold for the metrics.
- The contact sheet page's layout and tile sizes within the 16 MB artifact and
  the inspection time bound.
- The reading's JSON shape beyond the fields named in section 5.3.
- The critic prompt's wording, lift fixtures and tests.
- Migration numbering (check the journal against master first), the drizzle
  tables' indexes, and the `assets` dedupe index reuse.
- The order of milestones. A suggested order: identity and prompt slots
  (channel-agnostic prompt, no behaviour change at defaults); references
  ingest and reading; metrics and the critic review; derivation; refine and
  side-by-side; copy. Each lands behind a flag or a default that leaves
  Boom & Busters' output unchanged until the owner acts.
