# Reviewing a Boom & Busters motion-graphics exemplar

An exemplar is the one finished example the channel's AI designer is shown before it
designs every graphic of the same technique, so its faults are copied into every film.
Judge it as a motion designer would, harshly. The owner reviews it afterwards on a
Remotion player in Settings; your job is to find what they would object to first.

## The channel's motion identity (background)

The owner is making this channel's exemplars to their own taste first and will redraw the
written rules from the approved set afterwards. So the style guide and the never list below
are strong background, not law. What is fixed: the brand's colours, fonts and timings, the
owner's steers and rulings further down, and the placement facts. Where a design departs from
the written guide because its technique or the owner's taste calls for it, judge whether the
departure looks right and say so; do not report it as a breach for that reason alone. The
channel's approved exemplars (bar chart, chapter title, progress steps, stat counter, text
highlight) show the taste in practice.

Style guide, as the owner wrote it:

> Flat typographic graphics with no texture, grain, imagery or depth. Use the brand's dark
> ground with off white text, Inter set heavy and tight in sentence case for headlines, with
> small widely tracked uppercase Inter for kickers and labels. Big figures are in JetBrains
> Mono. Keep labels small but always readable at video size, with generous empty margins.
>
> One idea at a time. Each element arrives only after the previous one has settled, with
> short holds of a third to half a second between beats and a full hold at the end. Words
> build one at a time in step with the narration. Each word appears in grey and settles to
> full off white rather than popping, so the line reads like thinking. Never animate single
> letters.
>
> What has been spoken steps back. Read lines dim in stages from full to mid grey to pale
> grey and stay legible but quiet. Retracted words get a thin strikethrough and the palest
> grey. Only the payoff phrase stays bright. The dimming is a plain tone change with no
> motion. When a new line arrives it sits lower and a touch larger than the old one, and the
> old line slides up to the upper third.
>
> The red accent is the only colour that means something. It is used as a flat highlighter
> bar that wipes left to right behind the key words, one phrase per beat and usually just a
> few words, and as a thinner underline that grows beneath a caption as an echo of it. Red
> also marks the key figure and the endpoint of a chart, which ties the headline to the
> payoff. When a headline is demoted it shrinks upward to a small header and keeps its
> highlight, instead of leaving.
>
> Comparisons start as one joined unit. A dashed rule draws down the seam, the halves slide
> apart with a soft ease into equal symmetric cards, and a small label fades in under each,
> left first, then right. Keep the accent on the same mark in both so their sameness reads
> and only the labels differ.
>
> Sequences and timelines sit on a single hairline axis. The item at the focus point is
> larger and brighter, passed items shrink and fade to pale grey, and the last one switches
> to the accent to say this is where we land. Then a stacked arrival under it: kicker, bold
> line, highlight last.
>
> Charts are clean: one line or set of bars carries the weight, the axis and labels are
> small tracked caps, and one large accent figure anchors the frame. A line draws steadily
> and slows into its end, a hollow ring can wait at the destination before it arrives, and
> the figure lands the moment it does.
>
> Easing is smooth everywhere. Nothing bounces, overshoots, blurs, rotates or glows, and the
> camera never moves. Exits are quiet fades together to the empty ground.

Never: glows, particle bursts, lens flares, camera shake, RGB split, a crossfade from one
whole layout to another, decorative gradients, drop shadows for depth, bounce or overshoot,
motion blur, rotation or tilt for flair, letter by letter animation, more than one
highlighted phrase per beat, a second accent colour in one graphic, decorative shapes,
labels too small to read at video size. The camera never moves. Nothing holds still for
more than 6 s. Charts stay conventional.

Brand colours: ground #0a0a0b, text #f4f4f5, secondary text #a1a1aa, accent red #ef4444;
chart series #f5a524, #3b82f6, #10b981, #a855f7. Timings (ms): enter 250, reveal 350,
move 400, exit 250, draw 1800.

## What the owner has rejected before (from their own steers on this channel)

- Decorative marks that carry no data: a dot riding on top of a bar, a line tracing the
  tops of bars, month notches or minor ticks on a rule. Every one was asked to be removed.
- A key figure larger than its siblings: the emphasis bar's number "disproportionally big", and
  on the progress bars a golden-ratio step ("it should be the same size"). Figures in one set
  share one size; the key one is marked by colour alone.
- A figure that looks thin or outlined instead of solid bold.
- A payoff landing in two motions (word drops, then a separate highlight sweep) when one
  continuous gesture was wanted.
- A figure or label arriving out of step with its siblings.
- Text that is too large for its role; connecting lines removed from a sequence (they wanted
  them kept); the landing item of a sequence not standing out (it should be bold or
  highlighted).
- Charts: bars rise from the baseline as their years are spoken; a single bar travelling and
  morphing between values was disliked.

## The owner's rulings over the style guide

Where the owner has ruled on a design, the ruling wins over the written style guide above.

- The typewriter types its line a letter at a time behind a caret, each word from the moment
  it is spoken (of a version that built whole words: "it doesn't typewrite at all?"). It is the
  one exception to "Never animate single letters" and "letter by letter animation", so do not
  report the typing as a breach. The rest of the identity still applies to it.

## Placement facts you cannot see in the frames

Every design is laid out inside `props.safeArea`, which keeps it clear of the burned-in
captions and the platform's interface. In 16:9 (1920x1080) the safe area runs from 36 px to
810 px down (75% of the height); in 9:16 (1080x1920) from 36 px to 1221 px down (64%), with
the caption band and the platform's buttons below that. So a design centred "in the frame"
sits centred in that area, which reads high in 9:16, and one resting at the bottom of the
safe area is as low as it may go. Judge balance within the safe area, not the whole frame.
The browser layout check (crops, overlaps, text too small to read at full size) has already
passed every design you are shown. The frames are photographed at half size.

The render holds a graphic's final state for at least two seconds after its last word so it
can be read, and the narration waits for it (decision 465). So a design must be at rest from
700 ms after its last word, and the checks refuse one whose text still changes after that. A
design that is still for its last stretch is holding for reading, not stalling.

Figures set in `fonts.numbers` are JetBrains Mono in every frame (checked in the browser: the
face is loaded before the first moment). At half size its digits and "%" can look like a sans;
do not report a change of typeface unless the glyph widths differ between frames.

## How to review

You are given a folder of frames from the real browser render. `sheet-even-*.jpg` shows the
design every 250 ms across the slot; `sheet-storyboard-*.jpg` shows four consecutive frames
at each storyboard moment, so you can see motion in flight; `landscape-*.jpg` and
`portrait-*.jpg` are rest moments at half size (the frame is 1920x1080 or 1080x1920).
`report.json` has the narration's word timings and measured motion. Read the design source
and plan too.

Look at every image. Then report, most severe first:

1. Defects: each with the time and the frame (16:9 or 9:16), what is wrong, and why a viewer
   or the owner would object. Include layout (crowding, cropping, imbalance, margins, empty
   frame), type (size, weight, tracking, hierarchy), timing against the narration, motion
   quality (anything popping, jittering, out of order, two motions where one was meant), and
   any breach of the identity above.
2. Whether the design does its technique's job well, and the one change that would most
   improve it.
3. A verdict: ship, or fix (with the fixes in order).

Report only what you can see in the frames or read in the code. Say so when you are unsure.
Do not edit any files.
