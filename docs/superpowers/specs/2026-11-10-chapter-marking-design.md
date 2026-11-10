# Chapter marking

Date: 2026-11-10. Status: approved in chat by the owner (the five points of
the 2026-11-10 assessment); this document is their written form, with the
builder's calls marked. Decision 454 (renumber at merge if another branch took
it).

## 1. Why

The channel design put a chapter card at the start of every chapter. Two
problems came up:

1. **Every film opens on a title card.** The outline makes chapter 1 a cold
   open by rule (a glimpse of the consequence, most detail withheld), and the
   compiler stamps a full-frame card "01 <title>" at t=0, holds it 3200 ms and
   lets the first word land at 2300 ms (`packages/timeline/src/compile.ts`,
   `CHAPTER_CARD_MS`, `CHAPTER_OVERLAP_MS`). The first three seconds of every
   film are static type, which is the opposite of the roadmap's own rule (hook
   in the first seconds) and hides the thing the thumbnail promised at the
   moment the viewer decides whether to swipe. The owner suspects it costs
   retention; an expert would remove it regardless, because a card at frame
   zero has no upside.
2. **Not every channel wants chapters on screen.** Chapters are the right
   writing unit for every format (claim ownership, tension, withholds and
   reveals hang off them) and the right publishing unit (YouTube description
   timestamps, decision 303), but on-screen marking is a presentation choice.
   Today the Brand Kit offers `full`, `corner` or `minimal` and no way to
   turn cards off (`packages/schemas/src/settings.ts`, `chapterCardVariant`).

The expert framing this design follows: separate the three things the word
"chapter" currently fuses.

- **Story chapters**: the writing unit. Unchanged, in every format.
- **YouTube chapters**: description timestamps, "stamp Title: gloss" per
  chapter (`packages/schemas/src/publish.ts`). Unchanged; the gloss already
  gives each chapter a short searchable line, so the "public title" idea from
  the assessment needs nothing new.
- **On-screen marking**: a per-channel choice with a per-format override, and
  a separate rule for the opening.

## 2. Goals

- No film ever opens on a chapter card. Narration starts at the first frame
  of the opening shot.
- A channel chooses how chapter starts are marked on screen; a format can
  override the channel's choice.
- When cards are off, the act break still reads as a beat: a held image, a
  short silence and a music cue, not a seamless run-on.
- Cards that do appear carry the chapter title only. No "01" number.
- The preview screen's chapter list and stats, the publish description's
  chapter block and the music cue points keep working in every mode, and for
  every timeline compiled before this change.

## 3. Non-goals

- The script and outline prompts. Chapter 1 stays the cold open; chapter
  titles stay as they are written.
- A film title card at frame zero. Nothing is ever on screen before the
  first shot.
- Shorts and the teaser. Their end CTA card is a separate overlay and is not
  touched.
- Measuring the retention effect. The owner reads YouTube Studio's intro
  segment (first 30 s) before and after; the console does not report it.
- The board preview. It never drew chapter cards.

## 4. Anti-goals

- Silently changing the look of films on channels that like cards: the
  default for an existing channel keeps cards everywhere except the opening.
- A schema change that makes the broker refuse old timelines, or old
  timelines that fail to parse in the new app.

## 5. The settings

### 5.1 Channel default: Brand Kit look

`BrandLookSchema` gains

```
chapterMarking: z.enum(['cards', 'title', 'none']).default('cards')
```

- `cards`: a card at the start of every chapter after the opening, in the
  existing `chapterCardVariant` look, title only.
- `title`: one card, after the opening chapter, carrying the film's title
  and no chapter title; every later chapter start is unmarked. This is the
  documentary convention: the hook lands, then the title arrives as a reward
  and a promise of structure. The film's title is the project's title column
  (the working title the project was started with), the builder's call: the
  YouTube headline is chosen at publish, after the render, and is a different
  kind of line (a search promise, not a film's name), so it is never burned
  into the picture. The owner renames the project before assembling when the
  working title is not the one to show; a re-assembly picks the new name up.
- `none`: no cards. Every chapter start after the opening is an unmarked
  break (section 6.2).

It is edited in Settings, Brand tab, beside Grade and Grain, as a labelled
select "Chapter marking" with the three options spelled out in plain words
("A card at every chapter", "The film's title after the opening, then no
cards", "No cards"). The Brand Kit specimen caption names the chosen marking.
`chapterCardVariant` stays as it is and still has no control (as today); it
styles whichever card appears.

Timelines snapshot the brand at compile time (spec section 8.2), so the
resolved `brand.look.chapterMarking` travels with every timeline. The compiler
reads the resolved value from its input, never the settings row.

### 5.2 Format override

`ChannelFormatSchema` gains

```
chapterMarking: z.enum(['inherit', 'cards', 'title', 'none']).default('inherit')
```

`inherit` takes the channel's Brand Kit value. The stored field is
preprocessed so `""`, `null` and absent all read as `inherit` (a plain enum
default rejects `""`, and Draft with AI may write it). The field sits in the
format editor beside the intro rule, as a select "Chapter marking" whose first option
reads "Channel default". `defaultFormat()` and `formatIsDefault()` include it;
the format summary lists it only when it is not `inherit`. The bible-draft
prompt's format description names the field with its four values so Draft
with AI can set it; `""`/absent parses to `inherit`.

`resolveChapterMarking(look, format)` in `packages/schemas/src/formats.ts`
returns the format's value unless it is `inherit`. The assembly runner calls
it with the project's format from `channelForProject` and the resolved brand
look, and passes the result to the compiler.

## 6. The compiler

### 6.1 The opening

The first chapter never gets a card, in any mode. Its narration starts on the
plan's clock with no inserted lead, hold or card. The opening shot keeps the
start the plan gave it (the existing "nothing can hold the screen before the
first shot" rule). The music cue at t=0 stays (the bed's start).

### 6.2 Chapter starts after the opening

`CompileInput` gains `chapterMarking: ChapterMarking` (required; the runner
always resolves one) and `filmTitle: string` (the project title, used by
`title` mode only).

Per chapter start after the first, by mode:

| Mode | Inserted silence | Overlay | Narration resumes |
|------|------------------|---------|-------------------|
| `cards` | lead 800 + card 3200 − overlap 900 | `chapterCard` at lead, 3200 ms | card start + 2300 ms |
| `title`, chapter 2 | as `cards` | `titleCard` at lead, 3200 ms | as `cards` |
| `title`, chapter 3+ | lead 800 + hold 1400 | none | 2200 ms after the last word |
| `none` | lead 800 + hold 1400 | none | 2200 ms after the last word |

New constant `CHAPTER_HOLD_MS = 1400`: the unmarked break's hold after the
lead. The break totals 2200 ms, three times a paragraph gap, and reads as a
beat on the held outgoing shot (the seam-closing pass stretches that shot to
the next slot's start, as today). The length is not arbitrary: the ducking
curve only lets the bed rise in a silence of `DEFAULT_RISE_THRESHOLD_MS`
(2000 ms) or more (`packages/timeline/src/ducking.ts`), and the music turn
is what marks an act break when no card does, so the break must clear that
threshold. The builder's call on the 200 ms margin; the owner tunes it by
ear from the preview.

Every other track moves by the same piecewise shift function as today; only
the per-chapter amount changes.

A film with a single chapter gets no card in any mode, `title` included: the
outline requires at least two chapters, so this only reaches the compiler
from hand-built input, and the compiler simply has no second chapter start
to mark.

### 6.3 Cards

- `chapterCard` overlay props stay `{ index, title }` (the index is the
  preview's match key for old timelines). The `ChapterCard` component stops
  rendering the number in all three variants: title only, with the accent rule
  kept in `full`. The `ChapterCardFull` snapshot golden is regenerated from a
  run of the compositions package alone.
- New overlay kind `titleCard`, props `{ title }`, rendered by a `TitleCard`
  component that reuses the chapter card's variant styling (full, corner or
  minimal) with the film title. Same fades, same `FADE_MS` constraint against
  `CHAPTER_OVERLAP_MS`. `DocumentaryMaster` maps it; `Root.tsx` registers a
  `TitleCardFull` composition for the snapshot suite with its own golden.
- The Brand Kit specimen keeps showing the chapter card.

### 6.4 Music cues

A cue of style `chapter` sits at every chapter's break point: t=0 for the
opening, the card's start for a chapter with a card, and the lead point (last
word end + 800 ms) for an unmarked break. One helper,
`chapterCuePoints(timeline)` in `packages/timeline/src/music.ts`, derives
these from a compiled timeline. For a timeline that carries the `chapters`
list (section 6.5, so one compiled by this design): cards and title cards by
their start; the opening at 0; any other chapter without a card by its first
segment's start minus `CHAPTER_HOLD_MS`, floored at 0. For a timeline
without the list (compiled before this design) the helper keeps today's rule
exactly: every card's start, or, when it has no cards at all (cards edited
away), every chapter's first segment start. `compileTimeline` writes cues
that equal the helper's result (a test asserts it), and `swapMusicBed` uses
the helper so a timeline compiled without a bed gains the same cues when one
is chosen, and an old timeline keeps the cues it has.

### 6.5 Chapter titles on the timeline

`TimelineSchema` gains an optional `chapters` array in script order,
`{ id: UlidSchema, title: string.min(1) }`, written by the compiler from the
paragraphs. `timelineChapters` in `apps/web/lib/preview-review.ts` takes a
chapter's title from this list first, then the matching card by index, then
"Chapter N". Old timelines keep their cards, so nothing on the preview
changes for them. `TimelineSchema` is a plain `z.object`, so the broker's
bundled copy strips the unknown key from an old deploy rather than refusing
the render.

## 7. Deploy

- No migration: both new fields live in jsonb with zod defaults.
- `deploy:stacks boom-busters-broker` (the `titleCard` overlay kind is a new
  union member; the broker's bundled schema 422s a render carrying one until
  then) and `deploy:remotion` (the `TitleCard` component and the number-free
  `ChapterCard`; rendered video keeps the old bundle until the site is
  re-uploaded). Until both run, `title` mode renders fail and `cards` mode
  renders still show numbers. `none` mode needs neither.
- `PUT /api/inngest` after the Vercel deploy, as always.
- Existing channels: `chapterMarking` resolves to `cards`, so their only
  visible change is the opening card's removal and the dropped numbers.
  The owner sets the channels that want no cards by hand in Settings.

## 8. Tests

- `packages/schemas`: both enums, defaults, `inherit` resolution,
  `formatIsDefault`, the `titleCard` overlay, the optional `chapters` list.
- `packages/timeline`: the compile golden regenerated (`REGEN_GOLDEN=1`) and
  its diff reviewed; narration starts at 0; per-mode silence and overlays per
  the table; cue points equal `chapterCuePoints`; `swapMusicBed` on a
  cardless timeline; the seam-closing pass still reaches the resumed
  narration across an unmarked break; `chapters` written in order.
- `packages/compositions`: `ChapterCardFull` golden regenerated,
  `TitleCardFull` golden added, both from a package-alone run.
- `apps/web`: `timelineChapters` with the list, with cards only, with
  neither; the Brand tab select and the format editor select save through
  their actions (component tests); the runner passes the resolved marking and
  the film title (unit test on the resolver call, the runner itself is not
  driven).
- e2e: the Brand tab select is visible and labelled (button-first rule).

## 9. Left to the builder

- Exact copy of the two selects' option labels and the specimen caption.
- Whether `TitleCard` is a new file or a mode of `ChapterCard`; the design
  only fixes the overlay kind and the look.
- The order of the format editor's fields around the new select.
- Where `resolveChapterMarking` is unit-tested (schemas or timeline).
