# Playbook Shorts: every Short written for one talking point (design)

Date: 2026-11-01. Status: approved, implemented.

This design replaces how the Shorts stage makes Shorts. Today a finished
master yields up to ten **excerpts** (slices of the long-form narration,
decision 224) and one **teaser** with its own narration (decisions 225, 227,
230, 231). After this change it yields **three to five Shorts, each written
for one talking point of the long form**, built the way the teaser is built
today and shaped by a fixed Shorts rule book drawn from the owner's YouTube
Shorts playbook.

## 1. What the owner asked for

In the owner's words: create all Shorts "in the same way we create the
teaser, where each short covers a specific talking point of the longform
video", with "the script, and imagery as well as the structure" aligned to
the playbook. The structure "needs to work across different channels but the
structure of the short stays the same, just the content is different".

Agreed in conversation on 2026-11-01:

- **Three to five Shorts per long-form video.** Excerpts are dropped. The
  teaser stops being a special case; it is one of the three to five.
- **The app proposes the talking points, and the stage pauses** so the owner
  approves them before anything is voiced or bought. The owner can write a
  note suggesting changes and have the proposal redone, as many times as
  they like.
- **Pictures come from two places:** the long form's own shots (newspaper
  articles, real photos, AI images, footage, charts, graphics, social post
  cards), and **new images made for the vertical 9:16 frame**.
- **One visual language.** The B-roll types, transitions, camera moves,
  graphics, brand and music treatment of the long form are the Shorts'
  toolkit too. Whatever the long form gains, the Shorts gain.
- **Shorts have their own pacing and rule book.** The toolkit is shared; how
  it is used in a Short is set by the Shorts rule book (section 4), not by the
  long form's pacing.
- **Shorts always go out after the long form.**

## 2. The playbook, as adopted

The owner supplied a playbook ("The YouTube Shorts Retention and Conversion
Playbook"). What this design takes from it, what it adapts and what it
leaves:

**Adopted.**

- The five-phase timeline: Hook (0 to 3 s), Context and stakes (3 to 15 s),
  Accelerated delivery (15 to 42 s), Micro-resolution (42 to 52 s),
  Bridge (52 to 60 s).
- The four Short types from its handoff table, as the menu each talking point
  picks from: **Forensic breakdown**, **Contrarian thesis**, **Incomplete
  mechanism**, **Result first** (section 3.2).
- **Pay off the small question, open the big one.** Each Short answers its
  own question in the micro-resolution, then points at the deeper material
  only the long form has. This reverses the teaser prompt's "never answer"
  rule: the playbook's point is that a withheld takeaway breeds resentment
  and hurts retention.
- **Split the asks across channels.** The narration asks for the long-form
  click (the high-friction ask); on-screen graphics ask for the subscribe.
  This reverses the teaser prompt's "the words never ask for the click".
- Pacing: a visual change about every 2 seconds, narration at 150 to 170
  words per minute, 45 to 60 seconds in all.
- Safe zones on the 1080 by 1920 canvas: nothing important in the top 380 px,
  the bottom 380 px or the right 120 px.
- Captions 1 to 3 words at a time with the live word highlighted (already how
  `KaraokeCaptions` works, inside `captionSafeArea`).
- Audio at -14 LUFS (the existing loudnorm job), tail trimmed to the last
  word.

**Adapted.**

- Presenter cues (stepping aside, pointing at the button, depth compositing)
  become graphics: an animated arrow towards the Related Video badge in the
  lower left, and a subscribe badge.
- The playbook's sample bridge ("We obtained the leaked financial audit")
  promises material the channel may not have. Here **the bridge may promise
  only what the long form actually covers**, named by chapter, and every fact
  in a Short comes from the long form's approved script, as the teaser prompt
  already requires.
- The playbook wants both a seamless loop and an 8 second CTA close; those
  conflict. Every Short ends on the bridge (section 4.6); the loop ending is
  retired for new Shorts.

**Left out, with the reason.**

- Its benchmark figures (Related Video click-through 2.5 to 4%, 22.7
  subscribers per 10k views, the "1:8 planning ratio") carry no source. They
  are not hard-coded anywhere. The March 2025 change to how Shorts views are
  counted is real and is worth remembering when reading analytics.
- "Open the long form on the Short's exact promise": with three to five
  Shorts per video the long form cannot open on all of them, and the Related
  Video link cannot point at a timestamp. Stated here as a known limitation.
- Impact sound design (hits, whooshes) on the hook and cuts. The music
  library has beds only. Out of scope; a later design.
- The post-release diagnostic (VVSA, APV, Related Video CTR thresholds).
  Out of scope; a later analytics design can read it.

## 3. The flow

### 3.1 Stages

The Shorts stage keeps its trigger (`project/master.ready`) and its place
after the master. Inside it there are now two human stops, the same pattern
as `visualsPhase` plan then board:

1. **Talking points** (new). The runner proposes three to five talking
   points and the stage sits at `awaiting_review` with phase `points`.
   Nothing has been voiced or bought yet; only the proposal call has cost
   anything.
2. **Build.** On approval, each approved point becomes one Short and is built
   end to end: script, voice, shot plan, new images, assemble, render. One
   Inngest run per Short, concurrency capped (as `short-render-runner` is
   today, decision 166).
3. **Review** (today's Shorts screen). The stage sits at `awaiting_review`
   with phase `review`. Every Short can be opened in the Short studio
   (today's teaser studio, section 6) and changed. "Continue to publish"
   works as it does now (decision 178).

### 3.2 The talking-point proposal

One LLM call (`scripting` task, the project's frozen bible in the prompt as
every prompt has it since decision 332) reads the approved script, its stored
outline (central question, per-chapter question, withhold, stakes, reveals,
close) and the claim list, and returns three to five points. Each point has:

| Field | What it is |
|---|---|
| `type` | One of `forensic-breakdown`, `contrarian-thesis`, `incomplete-mechanism`, `result-first` |
| `title` | A working title, editable later on the card |
| `question` | The one question this Short opens with and answers (its micro-question) |
| `payoff` | The answer the micro-resolution gives, in a sentence |
| `bridge` | The deeper thing the long form has that this Short does not, in a sentence |
| `bridgeChapters` | The chapter indexes that hold the bridge's material; must exist |
| `sourceChapters` | The chapter indexes the Short's facts come from; must exist |
| `hook` | A draft of the first line |
| `order` | Suggested publishing order, 1 first |

Rules the prompt states and the parser enforces where it can:

- Points do not overlap: no two share a `question`, and no chapter is the
  main source of more than two points.
- The `payoff` is a fact or reading the script states. The `bridge` names
  material in `bridgeChapters`; the parser refuses a chapter index the film
  does not have, as `parseTeaser` does today.
- At least two different types across the set, so a channel's feed does not
  read as one formula. The model picks the type that fits the material; there
  is no per-channel restriction on types in this version.
- The first point by `order` is the strongest standalone hook; it is the one
  closest to the old teaser.

Repairs follow decision 293's pattern: over-long fields trimmed at a sentence,
more than five points capped at five, fewer than three is a refusal (two
calls, then the stage stops with its reason, decision 292).

### 3.3 Approving and iterating

The Talking points screen shows the three to five point cards in `order`,
each with its type, question, payoff, bridge and source chapters. Buttons:

- **Approve talking points** (primary). Starts the build.
- **Suggest changes**: a text box for a note about the whole set
  (every redo call gets the whole script, the claims and the current set) ("make one
  about the auditors", "fewer contrarian ones"), then **Redo talking
  points**. The note and the current set go into a fresh proposal call, which
  replaces the set. The owner can repeat this as often as they like.
- On each card: **Redo this one** with its own note, which replaces that one
  point and keeps the rest (the call sees the others so it does not
  duplicate them); and **Remove**, refused when it would leave fewer than
  three.
- **Add a point**, with an optional note, refused at five.

Every proposal version is kept (append-only, like bible versions), so the
screen can show "version 3 of the talking points" and a note history. Only
the approved version is built.

### 3.4 Building one Short

For each approved point, in its own run:

1. **Script.** One call writes the narration as the five phases (section
   4.1), 110 to 160 words, with each phase's paragraphs tagged with the phase
   and the chapter it draws on. It gets the point, the bible, the chapters
   named in `sourceChapters` and `bridgeChapters`, and the bible's CTA line.
2. **Voice.** Each paragraph is voiced through the existing budget-guarded,
   idempotency-keyed `synthesise()` (as `voiceTeaserBeat` does).
3. **Shot plan.** One call plans the visual changes against the voiced word
   timings using the Shorts rule book (section 4). Each shot is either a
   **reuse** of a long-form slot (with a crop focus and a motion) or a
   **new** 9:16 brief (stock search or a
   generated still). Section 5 has the picture rules.
4. **New images.** New briefs are fetched through the same adapters the
   teaser studio's fetcher uses (decision 231), framed 9:16, under the
   project budget guard.
5. **Assemble and render.** The Short's own timeline is compiled (section 7)
   and rendered through `ShortVertical` as today, with loudnorm and QC.

A Short whose script is refused twice, or whose build fails, is skipped with
its reason on its card (decision 294's pattern) and the others carry on. A
budget refusal parks the stage as every paid step does.

### 3.5 Phase, missing outline and re-entry (my calls)

- **Phase.** A new nullable `projects.shortsPhase` column (`points` |
  `review`), mirroring `visualsPhase`. "Continue to publish" is not offered at
  `points`; there is nothing to publish yet.
- **No stored outline.** `scripts.outline` is null for older scripts. The
  proposal call then works from the chapter text and claims alone, as the
  Shorts marking does today; it does not refuse.
- **Re-entry** (`master.ready` fires again, for example after Back to visuals
  and a fresh master). A `point` Short carries its own narration and stores
  its shots as full slot snapshots (section 5.1), so a new master never makes
  it unrenderable. Rules: if an approved talking-point version exists, the
  stage does not pause at `points` again, and built Shorts are kept as
  curated (the teaser's rule today). Approved points with no Short yet (one
  skipped, or a run that died) are built. If the script version is newer
  than the one a Short was written from, its card says so and offers
  **Rebuild from the new script**; nothing is rebuilt or re-bought without
  that click. A project with no approved version pauses at `points` as
  normal.

## 4. The Shorts rule book

One rule book in code, the same for every channel. It is used three ways:
stated in the script and shot-plan prompts, enforced by parsers and repairs
where a rule is mechanical, and checked on the assembled Short with findings
shown on the card (the way decision 317 checks long-form shot timing). The
numbers live in one module so the prompts, the checks and the tests read the
same constants.

### 4.1 Structure and script

| Phase | Time | The narration's job |
|---|---|---|
| Hook | 0 to 3 s | The question or the most arresting fact, mid-action. No greeting, no channel name, no "in this video". |
| Stakes | 3 to 15 s | Why it matters: the cost, the paradox, who stood to lose. |
| Delivery | 15 to 42 s | The substance, at speed, with "but" and "then" turns rather than "and". |
| Resolution | 42 to 52 s | The answer to the hook's question, in plain words. |
| Bridge | 52 to 60 s | What the long form has that this Short does not, and the spoken ask to tap the linked video below. |

- 110 to 160 words in all; target 150 to 170 words per minute of voiced
  audio. Total runtime 45 to 60 s (checked on the voiced durations).
- Every fact from the long form's approved script. No invented sources,
  leaks or documents.
- The bridge promises only what `bridgeChapters` contain, and asks once.
  Its wording follows the bible's CTA line where one is set.
- The words never ask for a subscribe, a like or a comment.
- The bible's voice, hedging and naming rules apply as in every prompt.

The phase times are targets the check reports against, not hard cuts: a
Short whose hook runs to 3.4 s gets a finding, not a refusal.

### 4.2 Pacing

- A visual change every 1.5 to 2.5 s; no shot over 3.5 s, except a headline,
  social or chart card which may hold up to 4.5 s so it can be read.
- These replace `MIN_SHOT_SECONDS` for Shorts only. The long-form table is
  unchanged.
- A "change" is a new shot, or the same shot with a new crop, zoom or
  highlight (section 5.3).

### 4.3 The hook frame

- Frame one is already the hook shot: no fade in, no title card, no logo.
- The hook shot gets a **punch-in** (section 4.5) within the first 1.2 s.
- The hook's first words appear as captions from the first frame.

### 4.4 Transitions

- Cuts only. No dissolves in a Short. The long form keeps both.

### 4.5 Motion

From the shared toolkit, used at Shorts speed:

- Ken Burns (`kenburns`) on every photo, still and archival shot, so no
  picture sits still. The timeline's `kenburns` takes a numeric `intensity`
  (at most 0.5) rather than the board's speed words; a Short uses the upper
  part of that range so the move reads within 2 s. The exact values are the
  builder's.
- Map camera paths as the long form has them.
- **Punch-in** (new, section 7.2): an instant or 200 to 300 ms scale from
  100% to about 115%, used on the hook and on emphasis words. It joins the
  shared toolkit, so the long form can use it too.

### 4.6 The close

- The last 5 to 8 seconds carry the spoken bridge.
- During it, two graphics (new overlays, section 7.2): an **arrow** pointing
  down and left at the Related Video badge's position, and a **subscribe
  badge** with the channel's name and wordmark in the lower middle of the safe
  zone. Both in the brand kit's colours and fonts.
- The bridge replaces today's 2.6 s `endCta` card for these Shorts.
- The render ends within 100 ms of the last spoken word.

### 4.7 Frame and captions

- 1080 by 1920. Captions, figures, faces and focal points inside the central
  safe area: x 60 to 960, y 380 to 1540.
- Captions on by default (decision 326), 1 to 3 words a page, live word
  highlighted, as `KaraokeCaptions` already draws them.
- Code-drawn cards keep their own 9:16 layouts (`SOCIAL_FRAMES` and the
  graphics layout module already lay out for both frames). A check confirms
  their text stays inside the safe area at 9:16; where a layout does not,
  fixing that layout is part of this work.

## 5. Pictures

### 5.1 Reusing the long form's shots

The shot-plan call receives the master timeline's slots as a numbered
library: for each, a number, its type (headline, social, chart, map, stock,
archival, still, graphic, hero), the sentence it covered and its brief.
Timeline slots carry no id, so the number is only valid for that one call;
the stored plan keeps each reused shot as a **full slot snapshot**, the rule
decision 230 set for the teaser's shot choices, so a re-assembled master can
never shift a Short's pictures (my call). Rules:

- Prefer shots from the Short's own `sourceChapters`, then the rest of the
  film.
- Code-drawn cards (headline, social, chart, map, graphic) are re-laid out for
  9:16 and can be used as they are.
- Photos, stills, archival images and footage are cover-cropped to 9:16. The
  planner gives a crop focus (left, centre, right) for each, and avoids a
  photo whose subject would be cut out. A wide shot that cannot be cropped
  becomes a slow horizontal pan instead.
- The same long-form shot may appear more than once in a Short with a
  different crop, zoom or highlight; that counts as a visual change.

### 5.2 New 9:16 images

- When the library has nothing that fits a moment, the plan asks for a new
  shot: a stock search or a generated still, both framed for 9:16 (the
  teaser's 9:16 framing clause, decision 252 (f), and the channel's house
  anchors and cast references as every still has them).
- **At most four new images per Short by default** (my call; about $0.56 at
  today's $0.14 a still). The Talking points screen shows an estimated cost
  of the whole build before **Approve** is pressed, worked out per Short from
  constants (the four-still cap, about 160 words of narration at the current
  TTS rate, and the script and shot-plan calls at the configured model
  prices), labelled as an estimate (my call). Stock search is free and not
  counted.
- New images are stored with the project's candidates so the Short studio
  can pick them again. They are **never placed on the long form's board
  automatically**; whether the board should offer them is left open.

### 5.3 Re-cuts of one picture

To reach a change every 2 s without 25 different images, a single picture can
be shown as a sequence: wide, then a punch-in on a detail; a chart, then the
same chart with one bar highlighted; a headline, then a zoom to its key
phrase. The planner may plan these explicitly.

## 6. The Short studio

Today's teaser studio (Script, Voice, Shots, Assemble and render, plus
new-material fetching) becomes the studio for every Short, opened from each
card. Changes:

- **Script** shows the five phases as labelled blocks with live word count and
  estimated runtime against the 45 to 60 s window.
- **Shots** shows the Short's shot list (about 20 to 30 shots), not one shot
  per beat. Each shot can be swapped from the long form's library, from the
  Short's fetched pool, or by a new fetch, as the per-beat picker does now.
  A **Re-plan shots** button re-runs the shot-plan call with an optional
  note.
- **Rule book findings** (section 4) list on the studio and the card, each
  with the shot or phase it concerns. Findings never block a render; they
  tell the owner what the playbook would flag.
- The Short's bridge chapters show on the card, so the owner can see what the
  Short promises.
- Legacy `teaser` rows keep the current teaser studio unchanged and
  `excerpt` cards keep their current controls; no new features reach them
  (my call). The new studio serves `point` Shorts only, so the old one can be
  removed once no legacy row is unpublished.

## 7. Data and rendering

### 7.1 Data

- **Talking points**: a new append-only table of proposal versions per
  project (the set, the note that produced it, which version was approved,
  timestamps). The approved version's points carry stable ids.
- **Shorts rows**: a new `shorts.kind` value (`point`) for this design's
  Shorts, carrying the point id, its script record (phases and paragraphs),
  voice record, shot plan and fetch pool. The existing `excerpt` and
  `teaser` kinds keep rendering and publishing exactly as today, so Shorts
  already made or scheduled are untouched. New projects never create them.
  Whether `point` Shorts reuse the `teaser_*` columns or get new ones is the
  builder's call; the records outgrow the teaser's five-beat caps (section 3.4
  needs paragraphs per phase and 20 to 30 shots).
- Migration numbers: check origin/master's journal before generating (two
  sessions have collided before).

### 7.2 Timeline and compositions

- A Short's timeline is compiled on its own clock, as `compileTeaserMaster`
  does today, then windowed by `compileShortTimeline` to get the 9:16 canvas,
  captions, music bed and ducking. The teaser compiler's forced
  `transition: 'cut'`, empty overlays and missing music go: shots carry their
  own motion, the close's overlays are added, and the Shorts bed is used.
- New motion kind **`punch`** in `TimelineMotionSchema` (and the board's
  `MotionSpec`), rendered by the shared slot components so both formats have
  it.
- New overlay kinds **`relatedArrow`** and **`subscribeBadge`** in
  `OverlaySchema`, drawn inside the safe area.
- New slot field for crop focus on cover-cropped media (or an extension of
  the existing motion), honoured by the image and video slot components in
  both formats.
- Every timeline change here is additive (a new motion kind, new overlay
  kinds, an optional crop field), so stored `excerpt` and `teaser` timelines
  and every master stay valid unchanged.
- Schema changes to the timeline need a broker redeploy and a Remotion site
  redeploy before the first real render (`deploy:stacks boom-busters-broker`,
  `deploy:remotion`). Board preview and render are separate renderers over
  one layout module; both must draw the new overlays and motion.

## 8. Publishing

- A `point` Short cannot be scheduled earlier than its long form's publish
  time. The Publish screen refuses it in words.
- Default schedule: the Shorts take the channel's Short slots (decision 336's
  editable defaults) in their `order`, starting with the first Short slot
  after the long form goes live, one per slot.
- The Related Video reminder (decision 226) stays as it is: set in YouTube
  Studio once the Short is up.

## 9. Mock mode and tests

- Mock providers return a deterministic three-point proposal, a five-phase
  script per point and a shot plan that meets the rule book, so the E2E suite
  can drive: Talking points screen, Suggest changes, Redo, Approve, Shorts
  screen with three cards, open the studio, render (reusing the fixture
  master's file, decision 169).
- Unit tests land with each part: the proposal parser and repairs, the rule
  book checks (each rule a test), the Short timeline compiler (goldens), the
  new motion and overlays (composition snapshots, both renderers), the
  scheduling guard, and the runner's skip and budget paths.
- No paid calls in development. A real-provider run happens only when the
  owner asks.

## 10. Goals, non-goals, anti-goals

**Goals.** Three to five Shorts per long form, each a complete answer to one
question with a spoken bridge to the long form; the same structure on every
channel; one visual language with the long form; owner control over the
talking points before money is spent.

**Non-goals.** Sound design; post-release analytics and the playbook's
diagnostic; per-channel Short types or rule books; setting the Related Video
link through the API; teasers published before the long form; changing the
long form's own pacing.

**Anti-goals.** A Short that invents a source, leak or document to sharpen its
hook. A bridge that promises something the long form does not contain. A
Short that withholds its own answer. Spending on voice or images before the
talking points are approved. Breaking Shorts already made or scheduled.

## 11. Left to the builder

- Column layout for `point` Shorts (reuse or new columns), within section 7.1.
- How the proposal call's notes are phrased into the prompt.
- Concurrency cap for the per-Short build runs (today's render cap is 2).
- The exact punch-in curve and the overlays' animation, within the brand kit.
- How the studio lays out 20 to 30 shots on screen, following the
  button-first UI rules (spec section 11.1).
