# The motion package and the reading hold

Date: 2026-11-11. Status: approved by the owner in chat on 2026-11-11
("Proceed"), with the builder's calls marked **(builder's call)**. Decision
number taken at merge (another session holds 462).

## 1. Why

Two things came up together.

1. **The Brand Kit's live specimen is out of date.** It plays four fixed
   components: `ChapterCard`, `LowerThird`, `ChartReveal` and
   `KaraokeCaptions` (`apps/web/app/(console)/c/[slug]/settings/brand-specimen.tsx`).
   Since decisions 295 and 386 to 388, what a film actually shows is drawn
   by the designer from the per-technique exemplars. `ChartReveal` is only
   the fallback for a chart with no design. The compiler never emits a
   `lowerThird` overlay, so the fixed `LowerThird` appears only in the
   specimen and in fixtures. Real lower thirds come from graphic slots built
   on the lower-third exemplar.
2. **The overlays look older than the graphics around them.** Chapter cards
   and the film title card (decision 457) are drawn by the fixed
   `TitledCard`, a fade-and-rise. The chapter-title and lower-third
   exemplars were rewritten to the decision 387 standard. The owner's ruling:
   the title card and chapter card overlays come from the exemplars.

A third thing came up while reviewing the second, and it applies to every
motion graphic, not just the cards.

3. **Graphics cut away before the viewer has read them.** Words land as
   they are spoken, and the hero lands last (graphics prompt, "the hero lands
   last"). Since decision 255 a slot lasts until the next shot's words begin
   (`packages/timeline/src/compile.ts`, the seam pass). So the thing that
   matters most gets only the narrator's breath between sentences before the
   cut. The prompt asks for "an ending that holds rather than vanishes", but
   nothing gives it the time. The exemplar samples hide this: their sample
   slots leave 1.3 to 3.3 s after the last word, which real slots do not.

The owner asked for the expert's view. A broadcast package designer treats
the film title, chapter breaks, lower thirds and graphics as one family, gives
on-screen text the time it takes to read, and signs off the package as a
reel. That framing drives this design.

## 2. Goals

- Every graphic's final state stays on screen long enough to read, however
  short the narrator's pause after it.
- Chapter cards and the film title card are drawn by exemplar code, the
  channel's approved version where one exists.
- Silent cards are timed to reading, not to imitation speech, and their
  length follows their text.
- The Brand Kit specimen becomes a package reel: what the pipeline draws,
  with the form's live tokens.
- No render ever fails because exemplar code fails.

## 3. Non-goals

- The designer's choice of technique, the critic loop, Derive and Refine.
- Narration, script or shot-list prompts.
- Watermark, end CTA, related arrow and subscribe badge overlays.
- Captions. Their beat stays in the reel, shown in the Short's frame.

## 4. Anti-goals (a failure even if it works)

- A film that feels stalled: pauses so long or so frequent that the narration
  drags. The pause has a cap and only fills a shortfall.
- Picture lagging narration. Decision 255 fixed this; the hold must never be
  bought by keeping a graphic on screen over the next sentence.
- A specimen that shows something the render does not draw.

## 5. The reading hold

### 5.1 The rule

**(builder's call on the numbers; tune by eye on real renders.)**

- A narrated graphic's final state stays on screen for at least **2.0 s**
  from the start of the last spoken word it covers. Chart and counter
  techniques (bar-chart, line-chart, racing-chart, comparison-chart,
  donut-chart, stat-counter, kpi-counter, progress-bars) get **2.5 s**,
  since figures are compared, not just read.
- The entrance of that last word takes about 0.7 s to settle (`SETTLE_MS` in
  `apps/web/lib/graphic-code/frames.ts`), so 2.0 s leaves about 1.3 s fully
  at rest.

### 5.2 How the render makes the time

The compiler lets the narration wait. It already inserts pauses at paragraph
starts (`PARAGRAPH_GAP_MS`) and chapter breaks, and moves captions, music and
slots by the same piecewise shift (`breakpoints`, `shiftAt`).

- For each graphic or chart slot that plays code, the compiler finds the
  start of the last spoken word the slot covers (from the timed narration
  words, not from the design's own `words`, since anchoring can move a slot)
  and the slot's end after the seam pass.
- If the time between them is under the hold, the compiler inserts a pause
  of the shortfall **right after that word ends**, capped at **1.5 s**
  **(builder's call)**.
- **A pause only lands where a reader would pause.** The last covered word
  must end a sentence or a clause (it ends in `.`, `!`, `?`, `;`, `:`, `,`
  or a closing quote after one of those). Briefs quote whole sentences, so
  this is the usual case. A slot whose last word sits mid-clause gets no
  pause, and the compiler reports it in the assembly summary. A silence
  inside a clause breaks the voice's prosody, which is worse than a short
  hold. **(builder's call)**
- **Which hold applies** is worked out in the web layer at assembly, which
  knows the slot's technique, and passed to the compiler as `holdMs` on the
  compile slot. The timeline package stays free of technique names, and the
  stored timeline schema gains nothing for it. **(builder's call)**
- **Slots with no last word:** a slot covering no timed words gets no
  pause. The film's last shot keeps its planned duration as today; if that
  leaves less than the hold after its last word, the film's end is extended
  by the shortfall (no narration follows, so nothing is split).
  **(builder's call)**
- **No film-level budget.** At 1.5 s a pause, a twelve-minute film with
  twenty short-changed graphics gains at most 30 s and in practice about
  half that. The assembly summary reports the number of pauses and the total
  added time, so a film that drags is visible and the constants can be
  tuned. **(builder's call)**
- A pause that falls at a paragraph end adds to the existing paragraph gap;
  a pause inside a paragraph splits that paragraph's narration into two or
  more segments, one per pause plus one. `NarrationSegment` gains an
  optional `trimStartMs` (an offset into the take) so each later piece plays
  from the right point. Old timelines have no such field and play as before;
  the render reads it through Remotion's audio trim, and the broker's
  bundled schema must accept it (it is the same broker redeploy as 6.5).
  Every split piece keeps its `chapterId` and `paragraphIndex`.
- **Shorts, Points and teasers inherit the pauses.** They slice the master,
  so a pause inside the slice comes with it. Their compilers group narration
  by paragraph rather than assuming one segment per paragraph
  (`packages/timeline/src/short.ts` throws today when the counts differ),
  re-clock captions across the split, and count the added time against
  their length limits (180 s for a Short). **(builder's call)**
- The graphic's slot stretches across the pause, the way a slot ending at a
  paragraph boundary already stretches across the gap. `GraphicCode` already
  holds the code's ending when a slot is longer than the design
  (`packages/compositions/src/components/GraphicCode.tsx`, ruling 7).
- Music ducking, caption timing, chapter cue points and the YouTube chapter
  timestamps all follow the shift. Check every consumer of `breakpoints` and
  of narration segment boundaries, including `music.ts` and the Short and
  teaser compilers.

### 5.3 The designer and the exemplars

- The craft line "An ending that holds rather than vanishes" becomes the
  rule in words: the last thing said lands as it is said; after it, the
  finished graphic holds, and the render guarantees that time. Nothing new
  enters, draws or moves into place after the last word's entrance has
  settled; only the camera push continues.
- The exemplar sample slots are re-timed so each sample's time after its
  last word equals its technique's hold (2.0 or 2.5 s), so the check and the
  designer see the tail a real slot will get. **(builder's call)** An
  exemplar that then fails `exemplar:check`, or finishes animating late, is
  revised by hand under the decision 387 standard and reviewed with the
  reviewer loop.
- The dry run gains a check: after the last word plus 0.7 s, no text or
  figure on screen changes (the rest moments already sample this).
  **(builder's call)** A design that fails it is refused with its reason and
  retried once, as other refusals are.

## 6. Exemplar overlays

### 6.1 Which exemplar draws which overlay

- **Chapter card** (`chapterCard`, `cards` marking): the chapter-title
  technique, **title only** (owner, 2026-11-11, keeping decision 457: no
  number, no label). The house chapter-title exemplar is revised so its label
  is optional: with no label, the short rule is the hook, draws out to the
  title's width, and the title drops from it word by word. A card passes the
  title words alone. A channel's approved chapter-title version written
  around a label is checked against a title-only sample at assembly; if it
  fails the check or misreads the title, the card uses the house design and
  the assembly summary says so.
- **Film title card** (`titleCard`, `title` marking): a new **film-title**
  technique, hand-made under the decision 387 standard and the decision 462
  process (`exemplar:hand`, reviewer loop). The film title outranks a
  chapter break, so it is its own design, not a chapter card with a made-up
  label. It is reserved for the title card: the designer never picks it for
  an ordinary slot, so it stays out of the designer's technique list.
  Its look is the builder's to propose and the owner's to approve through
  the reviewer loop, the same as every hand-made exemplar.
  **(builder's call)**
- **Order:** `exemplar:hand` lives on the `hand-exemplars` branch (decision
  462), not yet on master. The film-title exemplar is the last task and
  waits for that merge. Until it lands, a `title`-marking film falls back to
  `TitledCard`, so nothing else waits on it.
- The version used is the channel's approved version of that technique
  where one exists, else the house design: the rule the designer already
  uses (`exemplarFromApproved`).
- It is resolved and compiled **at assembly** and stored in the timeline, so
  an assembled timeline never changes. A newly approved version reaches a
  project on its next assembly, the same as chapter marking (decision 459).
  **(builder's call)**

### 6.2 Timing a silent card

Cards play in silence, so the code is fed made-up word timings at reading
pace.

- Words land 250 ms apart starting at 300 ms **(builder's call)**.
- After the last word's entrance settles (0.7 s), the card rests for at
  least **1.5 s** before its exit starts.
- Card length = max(3200 ms, last word time + 700 + 1500 + 900 overlap).
  `CHAPTER_CARD_MS` becomes a function of the text. The chapter break shift,
  the overlap with the next chapter's first words and the assertion in
  `packages/timeline/src/music.ts` follow the computed length.

### 6.3 The exit

The host fades the overlay out over the last 700 ms, inside the 900 ms
overlap, as `TitledCard` does today. **(builder's call)** A designed exit per
exemplar would be better motion, but every channel's approved versions were
written without one, and a host fade works for all of them.

### 6.4 Fallback

The overlay renders through `GraphicCode`, whose error boundary already
replaces throwing code with a title card. For overlays, the fallback is the
current `TitledCard` with the title, so a failed card looks like today's card
rather than a blank. Missing code (an assembly that could not compile the
exemplar) falls back the same way, and the assembly records why.

### 6.5 Schema and deploys

`chapterCard` and `titleCard` overlays gain an optional code payload
(compiled code, words, duration). An overlay without one renders as today,
so timelines compiled before this change still play. This is a timeline
schema change: `deploy:stacks boom-busters-broker`, then `deploy:remotion`,
then the Vercel deploy and `PUT /api/inngest`.

## 7. The Brand Kit specimen becomes a package reel

- The reel plays, in order: film title, chapter card, lower third, one chart
  (bar-chart) and one counter (stat-counter), each drawn by the channel's
  approved exemplar or the house design, with the form's live tokens. Then
  karaoke captions in the 9:16 frame, labelled as Shorts only.
- A labelled button pair switches the reel between 16:9 and 9:16 (spec
  §11.1, button-first).
- Each piece uses the exemplar's own sample words and data, re-timed per
  section 5.3, so the reel shows the real reading hold. The chapter card and
  film title use the silent-card timing from 6.2 with fixture titles.
- The code is compiled on the server the way the Exemplars tab compiles it
  (`apps/web/lib/exemplar-views.ts`, `exemplar-channel-views.ts`), passed to
  the client, and played through `GraphicCode`. A piece that cannot compile
  says so in the caption under the player, and the reel plays the rest.
- The caption under the player names each piece and whether it is the
  channel's version or the house design.
- `chapterCardVariant` and `lowerThirdVariant` leave the Brand Kit form,
  since they no longer change what a film shows. The stored fields stay in
  the schema; `chapterCardVariant` still styles the fallback card and old
  timelines without code. `lowerThirdVariant` has no reader left and is
  ignored. **(builder's call)**

## 8. Constraints

- Mock providers by default; no paid calls. Hand-made exemplars are written
  in session (decision 462), not derived.
- The parallel `hand-exemplars` branch (decision 462) is uploading channel
  exemplar versions now. Merge order and any manifest changes are agreed at
  merge; re-timing the samples (5.3) must not invalidate their review
  without saying so.
- Board preview and render are two renderers (memory): the board's graphic
  player and still must show the stretched slot and the hold too.
- Parked Inngest runs replay old step results: any new field read during
  assembly is computed inside a step.

## 9. Testing

- Compiler: hold insertion at a paragraph end and mid-paragraph, the cap,
  no pause when the slot already has the time, captions and music shifted,
  narration segments split with the right offsets, computed card length,
  golden timelines regenerated on purpose.
- Compositions: an overlay with code, an overlay whose code throws (falls
  back to `TitledCard`), an old overlay with no code; snapshots run per
  package before trusting a diff.
- Graphics check: the new no-change-after-settle rule refuses a late
  animation and passes a design at rest.
- Web: the reel component and its server loader (channel version, house
  fallback, a piece that fails to compile); e2e on the Brand Kit tab.
- Every consuming package's suite runs, not only the changed one.

## 10. Left to the builder

The exact constants beyond those named above, the file layout, how the reel's
server loader is shared with the Exemplars tab, and the commit and task
breakdown.
